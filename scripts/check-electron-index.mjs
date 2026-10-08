/**
 * Non-régression de L'INDEX ET DU SURVEILLANT DÉBOUNCÉ, côté processus
 * principal Electron (tâche 2 de
 * docs/superpowers/plans/2026-09-11-migration-electron.md).
 *
 * `apps/windows/electron/index-fichiers.ts` est du Node pur (chokidar +
 * `node:path`) : ce contrôle tourne sur un VRAI dossier temporaire
 * (`fs.mkdtemp`), retiré dans un `finally`. CHAQUE cas reçoit sa PROPRE
 * sous-racine vide : `surveiller` fait un parcours initial (`ignoreInitial:
 * false`, chokidar émet `add` pour les fichiers déjà présents), et partager un
 * même dossier entre les cas ferait ressurgir les fichiers des cas précédents
 * comme autant de faux événements — c'est exactement ce qui a fait rougir ce
 * script à sa première rédaction, pour un mauvais motif.
 *
 * Les DIX-SEPT cas des deux fonctions pures (`horsCatalogue`,
 * `evenementDeRenommage`) ne sont PAS repris ici : ils vivent déjà dans
 * `check-windows-host.mjs` (groupe « index »), qui les importe depuis
 * `apps/windows/src/host/fs.ts` — CE fichier les réexporte désormais depuis
 * `apps/windows/electron/catalogue.ts`, où ils ont été relogés (voir l'en-tête
 * de `catalogue.ts` : le brief de la tâche voulait les déplacer dans
 * `index-fichiers.ts`, ce qui aurait fait tirer Node au futur import côté
 * rendu de la tâche 4). Ce contrôle-ci éprouve les cas neufs du surveillant
 * chokidar et de `contratDepuisAbsolu` — dix, depuis la ronde de correction 1
 * qui a scindé le cas « hors racine » en deux (voir sa note ci-dessous).
 *
 * Chaque cas est isolé dans son propre `try/catch` (`cas()`, même patron que
 * `check-electron-fs.mjs`) : une exception non prévue devient un échec NOMMÉ
 * au lieu de faire mourir le script et de cacher les cas suivants en silence.
 *
 *     npm run check:electron-index
 */
import { mkdir, mkdtemp, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const attendre = (ms) => new Promise(r => setTimeout(r, ms));

/** Exécute un cas ; une exception NON prévue devient un échec NOMMÉ au lieu de
    faire mourir le script — voir le commentaire d'en-tête. */
async function cas(r, nom, fn) {
	try {
		await fn();
	} catch (e) {
		r.check(nom, "EXCEPTION: " + (e && e.message ? e.message : String(e)), "pas d'exception");
	}
}

await withSrcModule(["apps/windows/electron/index-fichiers.ts", "apps/windows/electron/fichiers.ts"], async ({ creerIndex, contratDepuisAbsolu, renameDirVersAbsolu }, { creerFichiers }) => {
	const r = makeReporter("Électron — index et surveillant");
	const base = await mkdtemp(join(tmpdir(), "electron-index-check-"));
	let n = 0;
	/** Une sous-racine VIDE, dédiée à un seul cas. */
	async function racineNeuve() {
		const d = join(base, `cas-${n++}`);
		await mkdir(d, { recursive: true });
		return d;
	}

	try {
		await cas(r, "créer un fichier émet create", async () => {
			const racine = await racineNeuve();
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				await attendre(200); // laisse le parcours initial (dossier vide) se stabiliser
				await writeFile(join(racine, "a.md"), "un");
				await attendre(500);
				r.check("créer un fichier émet create", evs.some(e => e.kind === "create"), true);
			} finally {
				arreter();
			}
		});

		await cas(r, "modifier émet modify avec le mtime neuf", async () => {
			const racine = await racineNeuve();
			const p = join(racine, "b.md");
			await writeFile(p, "un"); // déjà présent AVANT que le surveillant démarre
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				// Le parcours initial doit peupler l'index (event `create` pour b.md
				// déjà là) avant qu'on ne le modifie.
				await attendre(400);
				const avant = index.get("0/b.md");
				const marque = evs.length;
				await attendre(30);
				await writeFile(p, "un-deux-trois-quatre");
				await attendre(600);
				const modif = evs.slice(marque).find(e => e.kind === "modify");
				r.check("modifier émet modify avec le mtime neuf",
					Boolean(modif) && avant !== null && modif.file.mtime > avant.mtime, true);
			} finally {
				arreter();
			}
		});

		await cas(r, "supprimer émet delete", async () => {
			const racine = await racineNeuve();
			const p = join(racine, "c.md");
			await writeFile(p, "un"); // déjà présent AVANT que le surveillant démarre
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				await attendre(400); // parcours initial : c.md entre au catalogue
				const marque = evs.length;
				await unlink(p);
				await attendre(500);
				r.check("supprimer émet delete", evs.slice(marque).some(e => e.kind === "delete"), true);
			} finally {
				arreter();
			}
		});

		await cas(r, "deux écritures rapprochées n'émettent qu'UN événement", async () => {
			const racine = await racineNeuve(); // vide : rien à découvrir au parcours initial
			const p = join(racine, "d.md");
			const index = creerIndex([racine]);
			const evs = [];
			// `delayMs` élevé : les deux écritures, à quelques millisecondes
			// d'écart, doivent se fondre en un seul événement grâce au débounce
			// (`awaitWriteFinish`) de chokidar.
			const arreter = index.surveiller(ev => evs.push(ev), 400);
			try {
				await attendre(150); // le watcher doit être prêt avant la première écriture
				await writeFile(p, "un");
				await attendre(30);
				await writeFile(p, "un-deux");
				await attendre(900);
				r.check("deux écritures rapprochées n'émettent qu'UN événement",
					evs.filter(e => e.kind === "create" || e.kind === "modify").length, 1);
			} finally {
				arreter();
			}
		});

		await cas(r, "un fichier sous .trash/ n'émet RIEN", async () => {
			const racine = await racineNeuve();
			await mkdir(join(racine, ".trash"), { recursive: true });
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				await attendre(200);
				await writeFile(join(racine, ".trash", "e.md"), "corbeille");
				await attendre(500);
				r.check("un fichier sous .trash/ n'émet RIEN", evs.length, 0);
			} finally {
				arreter();
			}
		});

		/*
		 * Le cas ci-dessus (« un fichier sous .trash/ n'émet RIEN ») ne
		 * discrimine PAS l'option `ignored` posée par cette tâche : il reste
		 * vert avec ou sans elle, puisque `horsCatalogue` (dans `surFichier`)
		 * filtre déjà l'événement après coup. Ce qui suit prouve que le dossier
		 * ignoré n'est plus SURVEILLÉ du tout — pas seulement filtré à la
		 * sortie — via `getWatched()` de chokidar, exposé au minimum par
		 * `ArreterSurveillance` pour cette seule raison (voir sa doc dans
		 * `index-fichiers.ts`).
		 */
		await cas(r, "un dossier ignoré (node_modules) n'entre jamais dans la table interne de chokidar", async () => {
			const racine = await racineNeuve();
			await mkdir(join(racine, "node_modules", "un-paquet"), { recursive: true });
			await writeFile(join(racine, "node_modules", "un-paquet", "index.js"), "module.exports = {};");
			const index = creerIndex([racine]);
			const arreter = index.surveiller(() => {}, 50);
			try {
				await attendre(400); // laisse le parcours initial se dérouler en entier
				const watches = JSON.stringify(arreter.getWatched());
				r.check("un dossier ignoré (node_modules) n'entre jamais dans la table interne de chokidar",
					watches.includes("node_modules") || watches.includes("un-paquet"), false);
			} finally {
				arreter();
			}
		});

		/*
		 * Le piège que la tâche demande d'éprouver : une racine surveillée dont
		 * un ANCÊTRE (hors de la racine elle-même) porte un nom qui commence par
		 * un point. Une règle qui testerait tous les segments du chemin ABSOLU
		 * (au lieu du chemin RELATIF à la racine, via `contratDepuisAbsolu`)
		 * ignorerait la racine elle-même à cause de `.racine-cachee` et
		 * n'émettrait plus AUCUN événement, en silence — ce cas doit rester vert.
		 */
		await cas(r, "une racine sous un ancêtre au nom caché reste surveillée (piège absolu vs relatif)", async () => {
			const parent = await racineNeuve();
			const racine = join(parent, ".racine-cachee", "vault");
			await mkdir(racine, { recursive: true });
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				await attendre(200);
				await writeFile(join(racine, "quiz.md"), "un vrai quiz");
				await attendre(500);
				r.check("une racine sous un ancêtre au nom caché reste surveillée (piège absolu vs relatif)",
					evs.some(e => e.kind === "create"), true);
			} finally {
				arreter();
			}
		});

		/*
		 * CHOIX ASSUMÉ, écrit en commentaire sur `ignorerChemin`
		 * (`index-fichiers.ts`) : un FICHIER caché directement sous une racine
		 * (`racine/.gitignore`) reste SURVEILLÉ, pour ne pas diverger de
		 * `parcours.ts` (le parcours initial qui hydrate le rendu), qui
		 * n'exclut que les DOSSIERS. Le choix est écrit en commentaire, mais
		 * rien ne le prouvait : un resserrement futur de `ignorerChemin` sur le
		 * nom du fichier lui-même ne ferait rougir aucun cas. Celui-ci le fige.
		 */
		await cas(r, "un fichier caché directement sous la racine (.gitignore) reste surveillé", async () => {
			const racine = await racineNeuve();
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				await attendre(200);
				await writeFile(join(racine, ".gitignore"), "node_modules");
				await attendre(500);
				r.check("un fichier caché directement sous la racine (.gitignore) reste surveillé",
					evs.some(e => e.kind === "create"), true);
			} finally {
				arreter();
			}
		});

		/*
		 * DEUX cas distincts pour « hors racine », depuis la ronde de correction
		 * 1 (commit 6581ec5) : le premier, initialement seul, ne discriminait
		 * PAS — `watch(racinesAbs, …)` ne reçoit que les racines exactes, donc
		 * chokidar ne soumet JAMAIS un chemin hors racine à `contratDepuisAbsolu`
		 * dans ce scénario ; casser SEULEMENT le garde-fou (`contratDepuisAbsolu`)
		 * laissait le cas vert, parce que la promesse de chokidar de ne
		 * surveiller que ce qu'on lui donne suffisait déjà à le faire réussir.
		 * Il fallait casser LES DEUX à la fois (le périmètre physique du watcher
		 * ET le garde-fou) pour le voir rougir — la preuve que ce cas n'éprouve,
		 * isolément, QUE la promesse de chokidar, jamais le garde-fou lui-même.
		 */
		await cas(r, "le surveillant n'est monté que sur les racines qu'on lui donne (chokidar, pas le garde-fou)", async () => {
			const parent = await racineNeuve();
			const racine = join(parent, "surveillee");
			const dehors = join(parent, "pas-surveillee");
			await mkdir(racine, { recursive: true });
			await mkdir(dehors, { recursive: true });
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				await attendre(200);
				await writeFile(join(dehors, "f.md"), "hors racine");
				await attendre(500);
				r.check("le surveillant n'est monté que sur les racines qu'on lui donne (chokidar, pas le garde-fou)",
					evs.length, 0);
			} finally {
				arreter();
			}
		});

		await cas(r, "contratDepuisAbsolu rend null hors de toute racine", () => {
			// DÉTERMINISTE, sans surveillant, sans délai : éprouve directement le
			// garde-fou que le cas ci-dessus ne pouvait pas atteindre — voir sa
			// note. Un chemin qui n'est ni une racine donnée ni sous l'une
			// d'elles doit rendre `null`, quel que soit ce que chokidar aurait
			// ou non transmis.
			r.check("contratDepuisAbsolu rend null hors de toute racine",
				contratDepuisAbsolu(["/vault/quiz"], "/ailleurs/note.md"), null);
		});

		await cas(r, "contratDepuisAbsolu rend un chemin du contrat sous la racine", () => {
			// Non-régression du même garde-fou, côté chemin VALIDE : un cas qui
			// n'éprouverait que le rejet pourrait rester vert même si la
			// correspondance positive était cassée.
			r.check("contratDepuisAbsolu rend un chemin du contrat sous la racine",
				contratDepuisAbsolu(["/vault/quiz"], "/vault/quiz/Cours/ch1.md"), "0/Cours/ch1.md");
		});

		/* PURE, sans watcher ni délai : c'est ce qui la rend éprouvable par
		   discriminance ICI plutôt que dans `canaux.ts` (qui importe `electron`
		   et qu'aucun harnais ne peut charger) — voir la ronde de correction 1
		   du rapport de tâche 5. */
		await cas(r, "renameDirVersAbsolu traduit les deux chemins d'un renommage apparié en absolu", () => {
			r.check("renameDirVersAbsolu traduit les deux chemins d'un renommage apparié en absolu",
				renameDirVersAbsolu(["/vault/quiz"], { kind: "renameDir", from: "0/Cours", to: "0/Cours B2" }),
				{ fromAbs: "/vault/quiz/Cours", toAbs: "/vault/quiz/Cours B2" });
		});

		await cas(r, "renameDirVersAbsolu rend null si TO ne désigne aucune racine (FROM valide)", () => {
			// `from` seul valide : un défaut qui casserait la garde côté `to`
			// UNIQUEMENT doit rougir ici — voir son symétrique ci-dessous, qui
			// éprouve l'autre moitié séparément.
			r.check("renameDirVersAbsolu rend null si TO ne désigne aucune racine (FROM valide)",
				renameDirVersAbsolu(["/vault/quiz"], { kind: "renameDir", from: "0/Cours", to: "9/Cours B2" }),
				null);
		});

		await cas(r, "renameDirVersAbsolu rend null si FROM ne désigne aucune racine (TO valide)", () => {
			// Le symétrique : `to` seul valide. Sans ce cas, un défaut qui
			// casserait la garde côté `from` UNIQUEMENT passerait inaperçu — le
			// cas précédent ne l'aurait pas fait rougir.
			r.check("renameDirVersAbsolu rend null si FROM ne désigne aucune racine (TO valide)",
				renameDirVersAbsolu(["/vault/quiz"], { kind: "renameDir", from: "9/Cours", to: "0/Cours B2" }),
				null);
		});

		await cas(r, "après une écriture par index.write, get() rend le mtime NEUF sans attendre le surveillant", async () => {
			const racine = await racineNeuve();
			const index = creerIndex([racine]);
			// AUCUN `surveiller()` démarré : la fraîcheur doit tenir sans lui.
			await index.write("0/g.md", "contenu neuf");
			const file = index.get("0/g.md");
			r.check("après une écriture par index.write, get() rend le mtime NEUF sans attendre le surveillant",
				file !== null && typeof file.mtime === "number" && file.mtime > 0, true);
			// The creation time rides along (0 is left out: the host then falls back to mtime).
			r.check("index.write: ctime, when the filesystem records it, is a positive number",
				file !== null && (file.ctime === undefined || file.ctime > 0), true);
		});

		await cas(r, "surveiller rend une fonction qui arrête vraiment l'écoute", async () => {
			const racine = await racineNeuve();
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			await attendre(200); // laisse le parcours initial (dossier vide) se stabiliser
			arreter();
			await writeFile(join(racine, "h.md"), "après arrêt");
			await attendre(400);
			r.check("surveiller rend une fonction qui arrête vraiment l'écoute", evs.length, 0);
		});

		/* ─── L'APPARIEMENT D'UN RENOMMAGE DE DOSSIER — tâche 5 ───

		   `evenementDeRenommageDossier` (catalogue.ts) est éprouvée pure dans
		   `check-windows-host.mjs` ; les cas ci-dessous éprouvent le CÂBLAGE
		   réel : chokidar → `unlinkDir`/`addDir` → la fenêtre de débounce → la
		   règle pure → `onEvenement({ kind: "renameDir", … })`. La fenêtre est
		   fixe (voir `FENETRE_RENOMMAGE_DOSSIER_MS`, 300 ms) : chaque cas
		   attend au moins ce délai après son dernier geste sur le disque avant
		   de lire `evs`. */

		await cas(r, "renommer un dossier émet UN renameDir avec ses deux chemins du contrat", async () => {
			const racine = await racineNeuve();
			await mkdir(join(racine, "Cours"), { recursive: true });
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				// Initial scan: generous wait (a loaded Linux CI runner can take
				// longer than 300 ms to arm inotify, so the rename is never seen).
				await attendre(1500);
				await rename(join(racine, "Cours"), join(racine, "Cours B2"));
				// Wait on the event itself, not a fixed sleep.
				for (let i = 0; i < 100 && !evs.some(e => e.kind === "renameDir"); i++) await attendre(100);
				await attendre(400); // a second (wrong) renameDir would show up here
				const renames = evs.filter(e => e.kind === "renameDir");
				r.check("renommer un dossier émet UN renameDir avec ses deux chemins du contrat",
					renames, [{ kind: "renameDir", from: "0/Cours", to: "0/Cours B2" }]);
			} finally {
				arreter();
			}
		});

		await cas(r, "supprimer un dossier seul (sans création) n'émet aucun renameDir", async () => {
			const racine = await racineNeuve();
			await mkdir(join(racine, "Vide"), { recursive: true });
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				await attendre(300);
				await rm(join(racine, "Vide"), { recursive: true });
				await attendre(500);
				r.check("supprimer un dossier seul (sans création) n'émet aucun renameDir",
					evs.filter(e => e.kind === "renameDir").length, 0);
			} finally {
				arreter();
			}
		});

		await cas(r, "deux renommages de dossier simultanés n'apparient rien", async () => {
			const racine = await racineNeuve();
			await mkdir(join(racine, "A"), { recursive: true });
			await mkdir(join(racine, "B"), { recursive: true });
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				await attendre(300);
				await rename(join(racine, "A"), join(racine, "A2"));
				await rename(join(racine, "B"), join(racine, "B2"));
				await attendre(500);
				r.check("deux renommages de dossier simultanés n'apparient rien",
					evs.filter(e => e.kind === "renameDir").length, 0);
			} finally {
				arreter();
			}
		});

		await cas(r, "un renommage vers un dossier ignoré (.trash) n'émet aucun renameDir", async () => {
			const racine = await racineNeuve();
			await mkdir(join(racine, "Cours"), { recursive: true });
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				await attendre(300);
				// Même PARENT des deux côtés : c'est bien la garde « dossier
				// ignoré » qui doit refuser ce cas, pas la garde « même parent ».
				await rename(join(racine, "Cours"), join(racine, ".trash"));
				await attendre(500);
				r.check("un renommage vers un dossier ignoré (.trash) n'émet aucun renameDir",
					evs.filter(e => e.kind === "renameDir").length, 0);
			} finally {
				arreter();
			}
		});

		/* A folder holding a sub-folder cannot be renamed under a live chokidar
		   watcher on Windows (EPERM: an OS handle is open on every watched
		   directory). `suspendre` closes the watcher around the production rename,
		   restarts it and reconciles the index. Real temp dirs, the real
		   `fichiers.rename` (the function the IPC handler calls). */
		await cas(r, "un dossier se déplace entre deux racines sous suspendre", async () => {
			const rootA = await racineNeuve();
			const rootB = await racineNeuve();
			const fichiers = creerFichiers();
			await mkdir(join(rootA, "Module", "sub"), { recursive: true });
			await writeFile(join(rootA, "Module", "sub", "q.md"), "un");
			await writeFile(join(rootA, "keep.md"), "reste");
			const index = creerIndex([rootA, rootB]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				await attendre(600); // initial crawl
				r.check("setup : q.md est indexé", index.get("0/Module/sub/q.md") !== null, true);
				evs.length = 0;
				let erreur = null;
				try {
					await index.suspendre(() => fichiers.rename(join(rootA, "Module"), join(rootB, "Module")));
				} catch (e) {
					erreur = e;
				}
				r.check("le déplacement du dossier réussit (pas d'EPERM)", erreur ? String(erreur.message ?? erreur) : null, null);
				r.check("l'index liste la nouvelle place", index.get("1/Module/sub/q.md") !== null, true);
				r.check("l'index n'a plus l'ancienne place", index.get("0/Module/sub/q.md"), null);
				r.check("un fichier non touché reste indexé", index.get("0/keep.md") !== null, true);
				r.check("delete émis pour l'ancienne place",
					evs.some(e => e.kind === "delete" && e.path === "0/Module/sub/q.md"), true);
				r.check("create émis pour la nouvelle place",
					evs.some(e => e.kind === "create" && e.file.path === "1/Module/sub/q.md"), true);
				r.check("aucun événement pour un fichier inchangé",
					evs.filter(e => (e.path ?? e.file?.path) === "0/keep.md").length, 0);
				// Watcher is back: a new file under the moved folder is reported.
				evs.length = 0;
				await writeFile(join(rootB, "Module", "sub", "n.md"), "neuf");
				await attendre(600);
				r.check("le surveillant est reparti après la suspension",
					evs.some(e => e.kind === "create" && e.file.path === "1/Module/sub/n.md"), true);
			} finally {
				arreter();
			}
		});

		await cas(r, "fn qui jette : l'erreur remonte et le surveillant repart", async () => {
			const racine = await racineNeuve();
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				await attendre(300);
				let message = null;
				await index.suspendre(async () => { throw new Error("boom"); }).catch(e => { message = e.message; });
				r.check("l'erreur de fn est relancée", message, "boom");
				await writeFile(join(racine, "apres.md"), "x");
				await attendre(600);
				r.check("un fichier créé après l'échec est rapporté",
					evs.some(e => e.kind === "create" && e.file.path === "0/apres.md"), true);
			} finally {
				arreter();
			}
		});

		await cas(r, "suspendre sans surveillant lance fn directement", async () => {
			const racine = await racineNeuve();
			const index = creerIndex([racine]);
			r.check("fn est exécutée et sa valeur rendue", await index.suspendre(async () => 42), 42);
		});

		await cas(r, "un fichier se renomme sans suspendre, sous le surveillant", async () => {
			const racine = await racineNeuve();
			const fichiers = creerFichiers();
			await writeFile(join(racine, "a.md"), "un");
			const index = creerIndex([racine]);
			const arreter = index.surveiller(() => {}, 50);
			try {
				await attendre(500);
				await fichiers.rename(join(racine, "a.md"), join(racine, "b.md"));
				r.check("le fichier est renommé", (await readdir(racine)).includes("b.md"), true);
				await attendre(500);
				r.check("l'index suit le renommage",
					[index.get("0/a.md") === null, index.get("0/b.md") !== null], [true, true]);
			} finally {
				arreter();
			}
		});

		await cas(r, "deux suspendre concurrents sont sérialisés", async () => {
			const racine = await racineNeuve();
			const index = creerIndex([racine]);
			const arreter = index.surveiller(() => {}, 50);
			try {
				await attendre(300);
				const ordre = [];
				const a = index.suspendre(async () => { ordre.push("a+"); await attendre(100); ordre.push("a-"); });
				const b = index.suspendre(async () => { ordre.push("b+"); ordre.push("b-"); });
				await Promise.all([a, b]);
				r.check("pas d'entrelacement", ordre.join(","), "a+,a-,b+,b-");
			} finally {
				arreter();
			}
		});

	} finally {
		// `finally` : le dossier temporaire doit disparaître même si un cas a
		// jeté une erreur inattendue, pas seulement un échec d'assertion.
		await rm(base, { recursive: true, force: true });
	}

	r.done();
});
