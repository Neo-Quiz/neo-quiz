/**
 * Non-régression des trois modules du processus principal Electron que la
 * fenêtre ne peut pas éprouver à sa place : les RÉGLAGES (`reglages.ts`), les
 * VAULTS d'Obsidian (`vaults.ts`) et le PÉRIMÈTRE (`perimetre.ts`) — tâche 3
 * de docs/superpowers/plans/2026-09-11-migration-electron.md, ronde de
 * correction 1.
 *
 * Les trois sont du Node pur, écrits pour recevoir leurs chemins en paramètre
 * : ce contrôle tourne sur un VRAI dossier temporaire (`fs.mkdtemp`), retiré
 * dans un `finally`. Aucun double.
 *
 * Ce qu'il empêche, et qui échouerait EN SILENCE :
 * — un fichier de réglages réécrit à partir d'une table VIDE parce qu'une
 *   lecture a transitoirement échoué (tous les dossiers de l'utilisateur
 *   perdus, sans message) ;
 * — un JSON corrompu ÉCRASÉ au lieu d'être mis de côté ;
 * — deux écritures concurrentes qui se renomment l'une l'autre ;
 * — un chemin du pont hors des dossiers ouverts — `..`, jonction, racine de
 *   corbeille inconnue — qui atteindrait une primitive.
 *
 * Chaque cas est isolé dans `cas()` : une exception non prévue devient un
 * échec NOMMÉ, jamais une mort du script qui cacherait les cas suivants.
 *
 *     npm run check:electron-reglages
 */
import { mkdtemp, rm, readFile, readdir, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

async function aRejete(fn) {
	try {
		await fn();
		return false;
	} catch {
		return true;
	}
}

async function cas(r, nom, fn) {
	try {
		await fn();
	} catch (e) {
		r.check(nom, "EXCEPTION: " + (e && e.message ? e.message : String(e)), "pas d'exception");
	}
}

/* ─────────── les réglages ─────────── */

await withSrcModule("apps/windows/electron/reglages.ts", async ({ creerReglages }) => {
	const r = makeReporter("Électron — réglages");
	const dir = await mkdtemp(join(tmpdir(), "electron-reglages-"));
	try {
		await cas(r, "ecrire puis lire rend la valeur, et aucun fichier temporaire ne reste", async () => {
			const d = join(dir, "un");
			await mkdir(d);
			const reg = creerReglages(join(d, "settings.json"));
			await reg.ecrire("folders", [{ path: "C:/x" }]);
			r.check("ecrire puis lire rend la valeur, et aucun fichier temporaire ne reste",
				{ relu: await reg.lire("folders"), fichiers: await readdir(d) },
				{ relu: [{ path: "C:/x" }], fichiers: ["settings.json"] });
		});

		await cas(r, "deux ecrire CONCURRENTS sont sérialisés : les deux clés survivent", async () => {
			const d = join(dir, "deux");
			await mkdir(d);
			const reg = creerReglages(join(d, "settings.json"));
			await Promise.all([reg.ecrire("a", 1), reg.ecrire("b", 2)]);
			const disque = JSON.parse(await readFile(join(d, "settings.json"), "utf-8"));
			r.check("deux ecrire CONCURRENTS sont sérialisés : les deux clés survivent",
				{ disque, fichiers: await readdir(d) },
				{ disque: { a: 1, b: 2 }, fichiers: ["settings.json"] });
		});

		await cas(r, "un JSON illisible est MIS DE CÔTÉ, jamais écrasé", async () => {
			const d = join(dir, "trois");
			await mkdir(d);
			await writeFile(join(d, "settings.json"), "{ ceci n'est pas du JSON", "utf-8");
			const reg = creerReglages(join(d, "settings.json"));
			await reg.ecrire("a", 1);
			const fichiers = await readdir(d);
			const sauvegarde = fichiers.find(f => f.startsWith("settings.json.corrompu-"));
			r.check("un JSON illisible est MIS DE CÔTÉ, jamais écrasé",
				{
					sauvegardeContenu: sauvegarde ? await readFile(join(d, sauvegarde), "utf-8") : null,
					neuf: JSON.parse(await readFile(join(d, "settings.json"), "utf-8")),
				},
				{ sauvegardeContenu: "{ ceci n'est pas du JSON", neuf: { a: 1 } });
		});

		await cas(r, "une lecture IMPOSSIBLE (pas ENOENT) fait rejeter lire ET ecrire, sans rien écraser", async () => {
			const d = join(dir, "quatre");
			await mkdir(d);
			// Le chemin des réglages est un DOSSIER : `readFile` échoue en EISDIR,
			// l'équivalent déterministe d'un EBUSY d'antivirus.
			const chemin = join(d, "settings.json");
			await mkdir(chemin);
			await writeFile(join(chemin, "temoin"), "je suis toujours là", "utf-8");
			const reg = creerReglages(chemin);
			const lireRejette = await aRejete(() => reg.lire("folders"));
			const ecrireRejette = await aRejete(() => reg.ecrire("a", 1));
			r.check("une lecture IMPOSSIBLE (pas ENOENT) fait rejeter lire ET ecrire, sans rien écraser",
				{ lireRejette, ecrireRejette, temoin: await readFile(join(chemin, "temoin"), "utf-8") },
				{ lireRejette: true, ecrireRejette: true, temoin: "je suis toujours là" });
		});

		await cas(r, "supprimer retire la clé du fichier", async () => {
			const d = join(dir, "cinq");
			await mkdir(d);
			const reg = creerReglages(join(d, "settings.json"));
			await reg.ecrire("folder", "C:/ancien");
			await reg.ecrire("folders", []);
			await reg.supprimer("folder");
			r.check("supprimer retire la clé du fichier",
				JSON.parse(await readFile(join(d, "settings.json"), "utf-8")), { folders: [] });
		});

		await cas(r, "lire sur un fichier absent rend undefined et ne crée rien", async () => {
			const d = join(dir, "six");
			await mkdir(d);
			const reg = creerReglages(join(d, "settings.json"));
			r.check("lire sur un fichier absent rend undefined et ne crée rien",
				{ valeur: await reg.lire("folders"), fichiers: await readdir(d) },
				{ valeur: undefined, fichiers: [] });
		});

		/* LA CLÉ VIENT DU RENDU (revue finale, M6) : `ecrire("__proto__", …)`
		   n'écrivait aucune propriété propre, il remplaçait le PROTOTYPE de la
		   table, et toute clé absente lue ensuite remontait jusqu'à sa valeur.
		   Les DEUX moitiés : le refus est une erreur NOMMÉE, et une clé
		   ordinaire lue après reste intacte — un `folders` qui remonterait au
		   prototype empoisonné passerait sinon pour un réglage. */
		await cas(r, "une clé de prototype (__proto__, constructor, prototype) est refusée et n'empoisonne pas la table", async () => {
			const d = join(dir, "sept");
			await mkdir(d);
			const reg = creerReglages(join(d, "settings.json"));
			await reg.ecrire("folders", []);
			const cause = async (fn) => { try { await fn(); return "accepté"; } catch (e) { return String(e.message).split(" : ")[0]; } };
			r.check("une clé de prototype (__proto__, constructor, prototype) est refusée et n'empoisonne pas la table",
				{
					proto: await cause(() => reg.ecrire("__proto__", { folders: [{ path: "C:/" }] })),
					constructor: await cause(() => reg.ecrire("constructor", 1)),
					prototype: await cause(() => reg.supprimer("prototype")),
					folders: await reg.lire("folders"),
					absente: await reg.lire("jamais-ecrite"),
					disque: JSON.parse(await readFile(join(d, "settings.json"), "utf-8")),
				},
				{
					proto: "clé de réglage refusée", constructor: "clé de réglage refusée", prototype: "clé de réglage refusée",
					folders: [], absente: undefined, disque: { folders: [] },
				});
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
	r.done();
});

/* ─────────── les vaults d'Obsidian ─────────── */

await withSrcModule("apps/windows/electron/vaults.ts", async ({ vaultsObsidian }) => {
	const r = makeReporter("Électron — vaults Obsidian");
	const dir = await mkdtemp(join(tmpdir(), "electron-vaults-"));
	try {
		await cas(r, "seuls les dossiers existants portant un .obsidian sont rendus, triés par nom", async () => {
			const appData = join(dir, "appdata");
			await mkdir(join(appData, "obsidian"), { recursive: true });
			const zeta = join(dir, "Zeta");
			const alpha = join(dir, "alpha");
			const sansPoint = join(dir, "sans-obsidian");
			await mkdir(join(zeta, ".obsidian"), { recursive: true });
			await mkdir(join(alpha, ".obsidian"), { recursive: true });
			await mkdir(sansPoint, { recursive: true });
			await writeFile(join(appData, "obsidian", "obsidian.json"), JSON.stringify({
				vaults: {
					a: { path: zeta, ts: 1 },
					b: { path: join(dir, "disparu"), ts: 2 },
					c: { path: sansPoint, ts: 3 },
					d: { path: alpha, ts: 4 },
				},
			}), "utf-8");
			r.check("seuls les dossiers existants portant un .obsidian sont rendus, triés par nom",
				await vaultsObsidian(appData),
				[{ chemin: alpha, nom: "alpha" }, { chemin: zeta, nom: "Zeta" }]);
		});

		await cas(r, "sans obsidian.json, la liste est vide (pas une erreur)", async () => {
			r.check("sans obsidian.json, la liste est vide (pas une erreur)",
				await vaultsObsidian(join(dir, "nulle-part")), []);
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
	r.done();
});

/* ─────────── le dossier par défaut ─────────── */

await withSrcModule("apps/windows/electron/dossier-defaut.ts", async ({ cheminDossierDefaut }) => {
	const r = makeReporter("Électron — dossier de quiz par défaut");
	r.check("Windows : fixe, à la racine du disque système, jamais sous le dossier personnel",
		cheminDossierDefaut("win32", "C:/Users/x"), "C:/Neo Quiz");
	r.check("Linux : sous le dossier personnel (pas de C:, l'AppImage doit démarrer)",
		cheminDossierDefaut("linux", "/home/x"), "/home/x/Neo Quiz");
	r.done();
});

/* ─────────── le périmètre ─────────── */

await withSrcModule("apps/windows/electron/perimetre.ts", async ({ creerPerimetre, perimetreInitial }) => {
	const r = makeReporter("Électron — périmètre");
	const dir = await mkdtemp(join(tmpdir(), "electron-perimetre-"));
	try {
		await cas(r, "le dossier de réglages (userData) est HORS périmètre au démarrage, les dossiers qu'il liste y sont", async () => {
			/* Ruling 12. `settings.json` nourrit le périmètre (clé `folders`) au
			   démarrage suivant : si son propre dossier y entrait, `fichiers.write`
			   pourrait le réécrire en brut et y glisser `C:/`, hors de la garde de
			   `reglages.ecrire`. Le module de réglages est chargé À PART, sans
			   double : c'est lui qui écrit le fichier que `perimetreInitial` lit. */
			const donnees = join(dir, "userData");
			const vault = join(dir, "vault-demarrage");
			await mkdir(join(vault, ".obsidian"), { recursive: true });
			await mkdir(donnees, { recursive: true });
			await writeFile(join(donnees, "settings.json"), JSON.stringify({ folders: [{ id: "v", path: vault, name: "v" }] }), "utf-8");
			await withSrcModule("apps/windows/electron/reglages.ts", async ({ creerReglages }) => {
				const p = await perimetreInitial({ dossierDonnees: donnees, reglages: creerReglages(join(donnees, "settings.json")), dossierDefaut: join(dir, "defaut-absent-1") });
				r.check("le dossier de réglages (userData) est HORS périmètre au démarrage, les dossiers qu'il liste y sont",
					{
						settings: await aRejete(() => p.borner(join(donnees, "settings.json"))),
						vault: await aRejete(() => p.borner(join(vault, "note.md"))),
					},
					{ settings: true, vault: false });
			});
		});

		await cas(r, "le dossier du fond d'écran persisté est admis au démarrage, comme les dossiers de quiz", async () => {
			const donnees = join(dir, "userData-fond");
			const dossierFond = join(dir, "fond");
			await mkdir(dossierFond, { recursive: true });
			await mkdir(donnees, { recursive: true });
			await writeFile(join(donnees, "settings.json"), JSON.stringify({ fond: { dossier: dossierFond, image: "a.jpg" } }), "utf-8");
			await withSrcModule("apps/windows/electron/reglages.ts", async ({ creerReglages }) => {
				const p = await perimetreInitial({ dossierDonnees: donnees, reglages: creerReglages(join(donnees, "settings.json")), dossierDefaut: join(dir, "defaut-absent-2") });
				r.check("le dossier du fond d'écran persisté est admis au démarrage, comme les dossiers de quiz",
					await aRejete(() => p.borner(join(dossierFond, "a.jpg"))), false);
			});
		});

		await cas(r, "discriminance : un fond avec un dossier non-chaîne ou vide n'admet rien", async () => {
			/* `p.racines()` plutôt qu'un `borner` sur un chemin quelconque : un
			   `dossier` vide résolu à la légère (`"" || "."`) admettrait le
			   dossier COURANT sans qu'aucun chemin de ce test ne tombe dedans,
			   laissant le bug passer inaperçu — c'est arrivé une fois, ici même.
			   `racines()` doit rester VIDE, un fait que seul le vrai bug ferait mentir. */
			const donnees = join(dir, "userData-fond-invalide");
			await mkdir(donnees, { recursive: true });
			await writeFile(join(donnees, "settings.json"), JSON.stringify({ fond: { dossier: "", image: "a.jpg" } }), "utf-8");
			await withSrcModule("apps/windows/electron/reglages.ts", async ({ creerReglages }) => {
				const p = await perimetreInitial({ dossierDonnees: donnees, reglages: creerReglages(join(donnees, "settings.json")), dossierDefaut: join(dir, "defaut-absent-3") });
				r.check("discriminance : un fond avec un dossier non-chaîne ou vide n'admet rien",
					p.racines(), []);
			});
		});

		await cas(r, "le défaut est dans racines() même sans réglage (premier lancement)", async () => {
			/* C'est TOUTE la raison d'être de `dossierDefaut` : un utilisateur qui
			   n'a jamais rien réglé (`settings.json` absent) doit quand même
			   pouvoir écrire dans le dossier par défaut dès le premier
			   lancement — sans lui, le premier `Nouveau quiz` échouerait
			   « chemin hors des dossiers ouverts ». */
			const donnees = join(dir, "userData-premier-lancement");
			const defaut = join(dir, "defaut-premier-lancement");
			await mkdir(defaut, { recursive: true });
			await withSrcModule("apps/windows/electron/reglages.ts", async ({ creerReglages }) => {
				const p = await perimetreInitial({
					dossierDonnees: donnees,
					reglages: creerReglages(join(donnees, "settings.json")),
					dossierDefaut: defaut,
				});
				r.check("le défaut est dans racines() même sans réglage (premier lancement)",
					p.racines(), [defaut.replace(/\\/g, "/")]);
			});
		});

		const racine = join(dir, "vault");
		const ailleurs = join(dir, "ailleurs");
		await mkdir(join(racine, "Cours"), { recursive: true });
		await mkdir(ailleurs, { recursive: true });
		await writeFile(join(ailleurs, "secret.md"), "secret", "utf-8");
		const p = creerPerimetre();
		await p.autoriser(racine);

		await cas(r, "un chemin DANS une racine est accepté, normalisé", async () => {
			r.check("un chemin DANS une racine est accepté, normalisé",
				await p.borner(join(racine, "Cours", "nouveau.md")),
				join(racine, "Cours", "nouveau.md").replace(/\\/g, "/"));
		});

		await cas(r, "un chemin HORS racine est refusé", async () => {
			r.check("un chemin HORS racine est refusé",
				await aRejete(() => p.borner(join(ailleurs, "secret.md"))), true);
		});

		await cas(r, "un .. qui SORT de la racine est refusé", async () => {
			/* CONCATÉNÉ, pas `path.join` : `join` replie déjà les `..` et le cas
			   n'éprouverait alors plus rien (il a été vert quoi qu'on casse, une
			   fois, pour cette raison exacte). */
			r.check("un .. qui SORT de la racine est refusé",
				await aRejete(() => p.borner(racine + "/Cours/../../ailleurs/secret.md")), true);
		});

		await cas(r, "une jonction posée dans la racine et pointant dehors est refusée", async () => {
			await symlink(ailleurs, join(racine, "lien"), "junction");
			r.check("une jonction posée dans la racine et pointant dehors est refusée",
				await aRejete(() => p.borner(join(racine, "lien", "secret.md"))), true);
		});

		await cas(r, "estRacine : la racine oui, un sous-dossier ou un dossier étranger non", async () => {
			r.check("estRacine : la racine oui, un sous-dossier ou un dossier étranger non",
				{
					racine: await p.estRacine(racine),
					sousDossier: await p.estRacine(join(racine, "Cours")),
					etranger: await p.estRacine(ailleurs),
				},
				{ racine: true, sousDossier: false, etranger: false });
		});

		await cas(r, "un FICHIER admis se lit et s'ouvre, mais ne s'écrit pas", async () => {
			const choisi = join(ailleurs, "choisi.pdf");
			await writeFile(choisi, "%PDF", "utf-8");
			await p.autoriserFichier(choisi);
			r.check("un FICHIER admis se lit et s'ouvre, mais ne s'écrit pas",
				{
					lecture: await p.borner(choisi),
					ecriture: await aRejete(() => p.bornerEcriture(choisi)),
					voisin: await aRejete(() => p.borner(join(ailleurs, "secret.md"))),
					racineEcriture: await p.bornerEcriture(join(racine, "Cours", "n.md")),
				},
				{
					lecture: choisi.replace(/\\/g, "/"),
					ecriture: true,
					voisin: true,
					racineEcriture: join(racine, "Cours", "n.md").replace(/\\/g, "/"),
				});
		});

		await cas(r, "autoriserFichier ignore un dossier et un chemin absent", async () => {
			await p.autoriserFichier(ailleurs);
			await p.autoriserFichier(join(ailleurs, "absent.pdf"));
			r.check("autoriserFichier ignore un dossier et un chemin absent",
				{ dossier: await aRejete(() => p.borner(join(ailleurs, "secret.md"))), absent: await aRejete(() => p.borner(join(ailleurs, "absent.pdf"))) },
				{ dossier: true, absent: true });
		});

		await cas(r, "un argument qui n'est pas une chaîne est refusé AVEC SA CAUSE", async () => {
			/* La CAUSE, pas seulement le rejet : sans la garde `typeof`, un objet
			   ferait jeter `path.resolve` (une TypeError sans rapport) et une
			   chaîne vide se résoudrait sur le dossier courant — deux rejets qui
			   diraient autre chose que ce qui s'est passé. */
			const cause = async (v) => { try { await p.borner(v); return "accepté"; } catch (e) { return String(e.message).split(" : ")[0]; } };
			r.check("un argument qui n'est pas une chaîne est refusé AVEC SA CAUSE",
				{ objet: await cause({ toString: () => racine }), vide: await cause("") },
				{ objet: "chemin invalide", vide: "chemin invalide" });
		});

		/* LE PROTOCOLE DES RESSOURCES, BORNÉ PAR CE MÊME PÉRIMÈTRE (Ruling 13).
		   `protocol.handle` (`electron/main.ts`) sert les images d'un quiz, et
		   c'est la SEULE autre porte du principal vers le disque avec les canaux
		   `fichiers.*`. Lui donner sa propre liste blanche, c'est la faire
		   diverger de l'autre — la porte que la tâche 3 a mis deux rondes à
		   fermer. `resoudreRessource` vit dans `electron/ressources.ts` et non
		   dans `main.ts` pour être éprouvable ici : `main.ts` importe Electron,
		   aucun contrôle ne peut le charger.
		   Les DEUX moitiés, sinon un périmètre vide ferait passer le cas : une
		   image DANS la racine est servie, la même URL hors racine est
		   REFUSÉE (`null`, que le gestionnaire traduit en 403). */
		await cas(r, "le protocole des ressources est borné par le MÊME périmètre", async () => {
			await withSrcModule("apps/windows/electron/ressources.ts", async ({ urlDeRessource, resoudreRessource }) => {
				const dedans = join(racine, "Cours", "schema.png").replace(/\\/g, "/");
				const dehors = join(ailleurs, "secret.md").replace(/\\/g, "/");
				r.check("le protocole des ressources est borné par le MÊME périmètre",
					{
						dedans: await resoudreRessource(p, urlDeRessource(dedans)),
						dehors: await resoudreRessource(p, urlDeRessource(dehors)),
						/* Un `..` ENCODÉ dans l'URL arrive ici décodé : c'est
						   `borner` qui le replie, jamais une comparaison de
						   chaîne. Concaténé et non `path.join`, qui replierait
						   déjà (le cas d'à côté a été vert pour cette raison). */
						remontee: await resoudreRessource(p, urlDeRessource(racine + "/Cours/../../ailleurs/secret.md")),
						/* Une URL d'un autre protocole n'est pas à nous. */
						etrangere: await resoudreRessource(p, "https://exemple.test/x.png"),
					},
					{ dedans, dehors: null, remontee: null, etrangere: null });
			});
		});

		/* LA PORTE D'EXÉCUTION SOUS LE PÉRIMÈTRE (revue finale, I1). Le périmètre
		   borne l'écriture et la lecture ; `systeme.ouvrir` (`shell.openPath`)
		   EXÉCUTE un `.bat` ou un `.exe` — et `write` puis `ouvrir` sont deux
		   appels bornés, chacun dans les règles. Le prédicat vit dans
		   `ressources.ts` (sans Node ni Electron) pour être éprouvé ici ;
		   `canaux.ts`, qui l'applique, importe `electron`. Les DEUX moitiés :
		   une liste vide accepterait tout et un prédicat constant refuserait
		   tout — chacune serait verte seule. La casse (`X.BAT`), le double
		   suffixe (`notes.pdf.exe`) et le chemin sans extension sont les trois
		   façons de se tromper sur « l'extension ». */
		await cas(r, "ouvrir refuse les extensions exécutables, quelle que soit la casse, et laisse passer les documents", async () => {
			await withSrcModule("apps/windows/electron/ressources.ts", async ({ extensionRefusee, EXTENSIONS_EXECUTABLES }) => {
				r.check("ouvrir refuse les extensions exécutables, quelle que soit la casse, et laisse passer les documents",
					{
						bat: extensionRefusee(join(racine, "Cours", "x.bat")),
						casse: extensionRefusee(join(racine, "Cours", "X.BAT")),
						doubleSuffixe: extensionRefusee(join(racine, "Cours", "notes.pdf.exe")),
						ps1: extensionRefusee(join(racine, "Cours", "script.ps1")),
						lnk: extensionRefusee(join(racine, "Cours", "raccourci.lnk")),
						pdf: extensionRefusee(join(racine, "Cours", "fiche.pdf")),
						md: extensionRefusee(join(racine, "Cours", "ch1.md")),
						sansExtension: extensionRefusee(join(racine, "Cours", "Makefile")),
						pointDeTete: extensionRefusee(join(racine, "Cours", ".bat")),
						/* Le nom lu COMME WINDOWS (2026-09-25) : Win32 retire points
						   et espaces de fin, donc ces trois-là OUVRENT `x.bat`. */
						pointFinal: extensionRefusee(join(racine, "Cours", "x.bat.")),
						espaceFinal: extensionRefusee(join(racine, "Cours", "x.bat ")),
						melange: extensionRefusee(join(racine, "Cours", "x.bat. . ")),
						flux: extensionRefusee(join(racine, "Cours", "x.bat::$DATA")),
						cpl: extensionRefusee(join(racine, "Cours", "x.cpl")),
						psm1: extensionRefusee(join(racine, "Cours", "x.psm1")),
						appref: extensionRefusee(join(racine, "Cours", "x.appref-ms")),
						docx: extensionRefusee(join(racine, "Cours", "cours.docx")),
						ipynb: extensionRefusee(join(racine, "Cours", "tp.ipynb")),
						pdfPointFinal: extensionRefusee(join(racine, "Cours", "fiche.pdf.")),
						iso: extensionRefusee(join(racine, "Cours", "x.iso")),
						rdp: extensionRefusee(join(racine, "Cours", "x.rdp")),
						themepack: extensionRefusee(join(racine, "Cours", "x.themepack")),
						gitignore: extensionRefusee(join(racine, "Cours", ".gitignore")),
						/* Le socle de la revue, entier : une extension retirée « par
						   simplification » rougirait ici, nommée. */
						socle: ["bat", "cmd", "com", "exe", "hta", "js", "jse", "lnk", "msi", "pif", "ps1", "reg", "scr", "url", "vbe", "vbs", "wsf", "wsh"]
							.filter(e => !EXTENSIONS_EXECUTABLES.has(e)),
					},
					{
						bat: true, casse: true, doubleSuffixe: true, ps1: true, lnk: true,
						pdf: false, md: false, sansExtension: false, pointDeTete: true,
						pointFinal: true, espaceFinal: true, melange: true, flux: true,
						cpl: true, psm1: true, appref: true,
						docx: false, ipynb: false, pdfPointFinal: false,
						iso: true, rdp: true, themepack: true, gitignore: false,
						socle: [],
					});
			});
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
	r.done();
});

/**
 * LA BORNE DES CANAUX `fichiers.*`, STATIQUEMENT (tranche 5, tâche 5, ruling
 * 14). `canaux.ts` tire Electron et ne se charge dans aucun script : la
 * preuve que CHAQUE canal de fichiers passe par le périmètre était donc
 * celle de personne — un canal ajouté sans sa borne (c'est arrivé trois fois
 * d'un coup à la tranche 5 : `listerDossier`, `statEntree`, `readBinary`)
 * serait un accès disque total depuis la fenêtre, et aucun contrôle ne
 * rougirait. Ici : la liste des canaux est DÉRIVÉE de `CANAUX` (`pont.ts`, sans
 * Node), jamais recopiée ; chaque `ipcMain.handle(CANAUX.<x>, …)` dont le canal
 * commence par `neo:fichiers/` doit contenir `perimetre.borner(` OU
 * `perimetre.bornerEcriture(` dans son corps — délimité par les parenthèses
 * équilibrées de l'appel, pas par une regex de ligne, parce qu'un gestionnaire
 * s'étend souvent sur dix lignes. Depuis le 2026-09-17, le périmètre a DEUX
 * portes (`bornerEcriture` pour ce qui écrit, déplace ou efface) : ce test ne
 * distingue pas laquelle, seulement qu'AU MOINS UNE des deux borne le canal —
 * `check:electron-reglages` (groupe « périmètre ») éprouve LAQUELLE pour
 * chaque canal, par ses cas de comportement, pas par cette liste statique.
 */
await withSrcModule("apps/windows/electron/pont.ts", async ({ CANAUX }) => {
	const r = makeReporter("Périmètre — chaque canal fichiers.* est borné (statique)");
	const source = await readFile("apps/windows/electron/canaux.ts", "utf-8");
	const canauxFichiers = Object.entries(CANAUX)
		.filter(([, canal]) => String(canal).startsWith("neo:fichiers/"))
		.map(([nom]) => nom);

	/** Le corps d'un `ipcMain.handle(CANAUX.<nom>, …)` : du `(` de l'appel à sa
	    parenthèse fermante, en comptant les niveaux (les chaînes et
	    commentaires du gestionnaire ne contiennent pas de parenthèse
	    déséquilibrée — vérifié sur le fichier, et un déséquilibre rendrait
	    `null`, donc rouge, jamais vert par accident). */
	const corpsDe = (nom) => {
		const debut = source.indexOf(`ipcMain.handle(CANAUX.${nom},`);
		if (debut < 0) return null;
		let niveau = 0;
		for (let i = source.indexOf("(", debut); i < source.length; i++) {
			if (source[i] === "(") niveau++;
			else if (source[i] === ")" && --niveau === 0) return source.slice(debut, i + 1);
		}
		return null;
	};

	const sansGestionnaire = canauxFichiers.filter(nom => corpsDe(nom) === null);
	r.check("chaque canal fichiers.* de CANAUX a un gestionnaire dans canaux.ts", sansGestionnaire, []);
	const nonBornes = canauxFichiers.filter(nom => {
		const corps = corpsDe(nom);
		return corps !== null && !corps.includes("perimetre.borner(") && !corps.includes("perimetre.bornerEcriture(");
	});
	r.check("chaque gestionnaire fichiers.* appelle perimetre.borner( ou perimetre.bornerEcriture(", nonBornes, []);
	/* La liste dérivée n'est pas vide, et elle contient les trois canaux de la
	   tranche 5 : sans ce cas, un `CANAUX` renommé (« neo:fs/… ») viderait la
	   liste et rendrait les deux cas ci-dessus verts sur rien. */
	r.check("la liste dérivée de CANAUX contient les canaux attendus",
		["read", "write", "listerDossier", "statEntree", "readBinary"].filter(n => !canauxFichiers.includes(n)), []);
	r.done();
});

/**
 * LA GARDE DE LA CLÉ `ai` (tranche 5, tâche 6, ruling R-B). La clé `ai` des
 * réglages est la première que le RENDU écrit et que le PRINCIPAL relit pour
 * élargir ce qu'il accepte : l'hôte d'`aiOllamaUrl` entre dans la liste du
 * réseau (`reseau.ts`), `aiMentionExtraFolders` désigne des dossiers lus par
 * les canaux `fichiers.*`. Sans garde, un rendu compromis écrivait
 * `{ aiOllamaUrl: "https://attaquant.example" }` et obtenait cet hôte au
 * prochain lancement — le résiduel que `reseau.ts` nommait jusqu'ici.
 *
 * Le verdict est PUR (`garde-ia.ts`, ni `electron` ni `node:*`) : il se
 * charge ici tel quel, avec un périmètre doublé par une simple liste. Le
 * dialogue natif et l'admission (`canaux.ts`) ne se chargent pas — la
 * dernière assertion, STATIQUE comme celle des canaux `fichiers.*`, vérifie
 * que `reglagesEcrire` appelle la garde AVANT `.ecrire(`.
 */
await withSrcModule("apps/windows/electron/garde-ia.ts", async ({ cheminCliPourLancement, estDossierSortieIaValide, hoteEstPrive, validerReglagesIa }) => {
	const r = makeReporter("Électron — la garde de la clé ai");

	/* ── hoteEstPrive : la boucle locale, la RFC 1918, `.local`, et rien d'autre ── */
	const prives = ["localhost", "127.0.0.1", "127.9.9.9", "::1", "[::1]", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.10", "mon-nas.local"];
	r.check("les hôtes de la boucle locale, des plages RFC 1918 et .local sont privés",
		prives.filter(h => !hoteEstPrive(h)), []);
	const publics = ["172.15.0.1", "172.32.0.1", "8.8.8.8", "11.0.0.1", "example.com", "ollama.com", "monnas.localhost.example", ""];
	r.check("un hôte public, une plage voisine de 172.16/12, ou un nom Internet ne sont pas privés",
		publics.filter(h => hoteEstPrive(h)), []);

	/* ── validerReglagesIa : les trois verdicts ──

	   DEUX prédicats, et ils ne se confondent pas. Le PÉRIMÈTRE juge les
	   dossiers que le sélecteur « @ » lira. L'EXISTENCE juge le chemin d'un
	   exécutable de CLI — lequel vit précisément HORS du périmètre (un CLI est
	   dans `Program Files`, jamais dans un dossier de quiz) : le borner serait
	   refuser d'avance tout chemin valide. Les doubles sont de simples listes,
	   comme le vrai `perimetre.contient` et le vrai `statEntree` vus d'ici. */
	const contient = async (chemin) => chemin.startsWith("D:/Quiz");
	/* « outils/claude.exe » EXISTE dans le double, exprès : sans lui, retirer
	   la garde « absolu » laisserait le refus tomber sur « ne désigne aucun
	   fichier », et le cas resterait VERT sur la mauvaise raison. */
	const fichiersReels = new Set(["c:/outils/claude.exe", "c:/outils/codex.cmd", "c:/outils/note.docx", "c:/outils/lance.ps1", "c:/outils/shim.js", "c:/outils/claude", "outils/claude.exe", "d:/quiz/cours/claude.cmd"]);
	const existe = async (chemin) => fichiersReels.has(chemin.toLowerCase());
	const valider = (v) => validerReglagesIa(v, contient, existe);
	await cas(r, "une valeur qui n'est pas un objet est refusée", async () => {
		const verdicts = await Promise.all([null, "x", 3, [1]].map(v => valider(v)));
		r.check("une valeur qui n'est pas un objet est refusée",
			verdicts.map(v => "refus" in v), [true, true, true, true]);
	});
	await cas(r, "sans aiOllamaUrl, rien à admettre", async () => {
		r.check("sans aiOllamaUrl, rien à admettre",
			await valider({ aiModel: "x" }), { ok: true, admettre: null });
	});
	await cas(r, "aiOutputFolder accepte seulement un chemin relatif sûr", async () => {
		const valides = ["Generated", "Quiz générés", "Cours/IA_2026"];
		const invalides = ["", "   ", "/Generated", "C:/Generated", "../Generated", "Generated/../Privé", "Generated\\Privé", "Generated:Privé", "Generated?", "Generated//Privé", "./Generated"];
		r.check("aiOutputFolder accepte seulement un chemin relatif sûr",
			{
				valides: valides.map(v => estDossierSortieIaValide?.(v)),
				invalides: invalides.map(v => estDossierSortieIaValide?.(v)),
			},
			{ valides: [true, true, true], invalides: Array(11).fill(false) });
	});
	await cas(r, "aiOutputFolder est gardé comme une chaîne et un chemin relatif sûr", async () => {
		const verdicts = await Promise.all([
			valider({ aiOutputFolder: "Generated/Cours" }),
			valider({ aiOutputFolder: 42 }),
			valider({ aiOutputFolder: "C:/Generated" }),
			valider({ aiOutputFolder: "Generated/../Privé" }),
			valider({ aiOutputFolder: "Generated?" }),
		]);
		r.check("aiOutputFolder est gardé comme une chaîne et un chemin relatif sûr",
			[
				verdicts[0],
				...verdicts.slice(1).map(v => "refus" in v && v.refus.includes("aiOutputFolder")),
			],
			[{ ok: true, admettre: null }, true, true, true, true]);
	});
	/* `aiExamDurationMinutes` (the Generate page's Exam duration) is a RETIRED
	   setting: a value an earlier version already wrote is ignored, whatever it
	   is — valid, out of range or nonsense — and never refused, or the write of
	   EVERY `ai` setting would fail. Ignoring it must not loosen any other
	   rule: the refusals of its neighbours still hold with it present. */
	await cas(r, "aiExamDurationMinutes (retired): any value is accepted and ignored", async () => {
		const anciennes = [1, 30, 300, null, undefined, 0, -5, 301, 1.5, NaN, Infinity, "60", "", true, [60], {}];
		const verdicts = await Promise.all(anciennes.map(v => valider({ aiExamDurationMinutes: v })));
		r.check("aiExamDurationMinutes (retired): any value is accepted and ignored, nothing to admit",
			verdicts, Array(anciennes.length).fill({ ok: true, admettre: null }));
	});
	await cas(r, "aiExamDurationMinutes (retired): the other refusals still hold beside it", async () => {
		const [dossier, url, perimetre, hote] = await Promise.all([
			valider({ aiExamDurationMinutes: 90, aiOutputFolder: "../Privé" }),
			valider({ aiExamDurationMinutes: 999, aiOllamaUrl: "ftp://localhost/x" }),
			valider({ aiExamDurationMinutes: 90, aiMentionExtraFolders: ["E:/hors-perimetre"] }),
			valider({ aiExamDurationMinutes: 90, aiOllamaUrl: "https://Attaquant.Example:8443/api" }),
		]);
		r.check("aiExamDurationMinutes (retired): the other refusals still hold beside it",
			[
				"refus" in dossier && dossier.refus.includes("aiOutputFolder"),
				"refus" in url && url.refus.includes("aiOllamaUrl"),
				"refus" in perimetre && perimetre.refus.includes("E:/hors-perimetre"),
				"confirmer" in hote && hote.confirmer,
			],
			[true, true, true, "attaquant.example"]);
	});
	await cas(r, "une URL illisible, non-chaîne ou hors http(s) est refusée, nommée", async () => {
		const [pasChaine, illisible, fichier, ftp] = await Promise.all([
			valider({ aiOllamaUrl: 42 }),
			valider({ aiOllamaUrl: "pas une url" }),
			valider({ aiOllamaUrl: "file://127.0.0.1/C:/x" }),
			valider({ aiOllamaUrl: "ftp://localhost/x" }),
		]);
		r.check("une URL illisible, non-chaîne ou hors http(s) est refusée, nommée",
			[pasChaine, illisible, fichier, ftp].map(v => "refus" in v && /aiOllamaUrl/.test(v.refus)), [true, true, true, true]);
	});
	await cas(r, "un hôte de la liste ou du réseau local passe, et l'hôte est à admettre", async () => {
		r.check("un hôte de la liste ou du réseau local passe, et l'hôte est à admettre",
			await Promise.all([
				valider({ aiOllamaUrl: "http://localhost:11434" }),
				valider({ aiOllamaUrl: "HTTP://192.168.1.10:11434/" }),
				valider({ aiOllamaUrl: "https://ollama.com" }),
				valider({ aiOllamaUrl: "http://mon-nas.local:11434" }),
			]),
			[
				{ ok: true, admettre: "localhost" },
				{ ok: true, admettre: "192.168.1.10" },
				{ ok: true, admettre: "ollama.com" },
				{ ok: true, admettre: "mon-nas.local" },
			]);
	});
	await cas(r, "un hôte Internet hors liste demande confirmation, par son nom", async () => {
		r.check("un hôte Internet hors liste demande confirmation, par son nom",
			await valider({ aiOllamaUrl: "https://Attaquant.Example:8443/api" }),
			{ confirmer: "attaquant.example" });
	});
	await cas(r, "aiMentionExtraFolders : un dossier hors périmètre est refusé, nommé", async () => {
		const v = await valider({ aiMentionExtraFolders: ["D:/Quiz/Cours", "E:/Ailleurs"] });
		r.check("aiMentionExtraFolders : un dossier hors périmètre est refusé, nommé",
			"refus" in v && v.refus.includes("E:/Ailleurs"), true);
	});
	await cas(r, "aiMentionExtraFolders : tous dans le périmètre passe ; une forme autre qu'un tableau de chaînes est refusée", async () => {
		const [ok, pasTableau, pasChaines] = await Promise.all([
			valider({ aiMentionExtraFolders: ["D:/Quiz/Cours"] }),
			valider({ aiMentionExtraFolders: "D:/Quiz" }),
			valider({ aiMentionExtraFolders: [1] }),
		]);
		r.check("aiMentionExtraFolders : tous dans le périmètre passe ; une forme autre qu'un tableau de chaînes est refusée",
			[ok, "refus" in pasTableau, "refus" in pasChaines], [{ ok: true, admettre: null }, true, true]);
	});
	await cas(r, "le refus d'un dossier prime sur l'URL : rien n'est admis quand une moitié est refusée", async () => {
		const v = await valider({ aiOllamaUrl: "http://localhost:11434", aiMentionExtraFolders: ["E:/x"] });
		r.check("le refus d'un dossier prime sur l'URL : rien n'est admis quand une moitié est refusée", "refus" in v, true);
	});

	/* ── LES CHEMINS DE CLI RÉGLÉS À LA MAIN N'EXISTENT PLUS (2026-09-17) ──

	   Cinq cas vivaient ici : un chemin de CLI devait être absolu, existant,
	   d'une extension lançable, et HORS du périmètre — sans quoi
	   `fichiers.write("<racine>/x.cmd")` puis ce chemin dans le réglage
	   faisaient lancer au principal ce que le rendu venait d'écrire. Les deux
	   champs des Réglages sont partis avec leur garde : aucun chemin
	   d'exécutable ne vient plus de la fenêtre, ni par l'IPC ni par les
	   réglages, et ce qui lance un CLI est un NOM de la liste blanche résolu
	   sur le `PATH` (`check:electron-process`).

	   Le cas ci-dessous est ce qui reste de cette règle, et il vaut CLIQUET :
	   la garde n'a plus aucune clé qui désigne un programme. Remettre un
	   `cheminClaude` sans remettre sa garde ne rougirait nulle part. */
	await cas(r, "aucune clé de chemin d'exécutable n'est admise en silence", async () => {
		const source = await readFile("apps/windows/electron/garde-ia.ts", "utf-8");
		r.check("aucune clé de chemin d'exécutable n'est admise en silence",
			/cheminClaude|cheminCodex/.test(source.replace(/\/\*[\s\S]*?\*\//g, "")), false);
	});

	/* ── STATIQUE : la garde est appelée AVANT l'écriture, dans le gestionnaire ── */
	const source = await readFile("apps/windows/electron/canaux.ts", "utf-8");
	const debut = source.indexOf("ipcMain.handle(CANAUX.reglagesEcrire,");
	let corps = null;
	if (debut >= 0) {
		let niveau = 0;
		for (let i = source.indexOf("(", debut); i < source.length; i++) {
			if (source[i] === "(") niveau++;
			else if (source[i] === ")" && --niveau === 0) { corps = source.slice(debut, i + 1); break; }
		}
	}
	const garde = corps ? corps.indexOf("garderReglagesIa(") : -1;
	const ecriture = corps ? corps.indexOf(".ecrire(") : -1;
	r.check("reglagesEcrire garde la clé ai (garderReglagesIa) AVANT d'écrire",
		{ gardee: garde >= 0, avantEcriture: garde >= 0 && ecriture > garde }, { gardee: true, avantEcriture: true });
	r.check("garderReglagesIa passe par le verdict pur validerReglagesIa, et n'écrit qu'après avoir admis l'hôte",
		// L'appel tient sur plusieurs lignes depuis qu'il porte DEUX prédicats
		// (périmètre, existence) : le motif tolère le retour à la ligne, il ne
		// tolère pas un autre premier argument que `valeur`.
		{ verdict: /validerReglagesIa\(\s*valeur\s*,/.test(source), admet: source.includes("autoriserHote(verdict.") },
		{ verdict: true, admet: true });
	r.done();
});

/**
 * LA GARDE DE LA CLÉ DU FOND D'ÉCRAN (revue finale de la tranche 8). Comme
 * `folders`, `fond.dossier` nourrit le périmètre au démarrage suivant
 * (`perimetreInitial`) : sans garde à l'écriture, un rendu compromis obtient
 * n'importe quel dossier du disque au périmètre à la session suivante.
 *
 * `canaux.ts` tire Electron et ne se charge dans aucun script (comme pour
 * `verifierDossiers`) : la preuve est donc STATIQUE, sur le module réel, et
 * NOMMÉE par discriminance (retirer la garde du gestionnaire fait rougir
 * exactement ce cas — vérifié à la main pendant l'écriture de ce contrôle).
 */
{
	const r = makeReporter("Électron — la garde de la clé du fond d'écran");
	const source = await readFile("apps/windows/electron/canaux.ts", "utf-8");
	const debut = source.indexOf("ipcMain.handle(CANAUX.reglagesEcrire,");
	let corps = null;
	if (debut >= 0) {
		let niveau = 0;
		for (let i = source.indexOf("(", debut); i < source.length; i++) {
			if (source[i] === "(") niveau++;
			else if (source[i] === ")" && --niveau === 0) { corps = source.slice(debut, i + 1); break; }
		}
	}
	const garde = corps ? corps.indexOf("verifierDossierFond(") : -1;
	const ecriture = corps ? corps.indexOf(".ecrire(") : -1;
	r.check("reglagesEcrire garde la clé du fond (verifierDossierFond) AVANT d'écrire",
		{ gardee: garde >= 0, avantEcriture: garde >= 0 && ecriture > garde }, { gardee: true, avantEcriture: true });
	r.check("verifierDossierFond rejette un dossier hors périmètre, une image absolue/traversante, accepte null (retrait)",
		{
			perimetreVerifie: source.includes("perimetre.contient(dossier)"),
			imageBornee: /image\.includes\("\/"\)/.test(source) && /image\.includes\("\.\."\)/.test(source),
			nullAccepte: /valeur === null \|\| valeur === undefined\) return;/.test(source),
		},
		{ perimetreVerifie: true, imageBornee: true, nullAccepte: true });
	r.done();
}
