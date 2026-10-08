/**
 * Non-régression des PRIMITIVES DE FICHIERS du processus principal Electron
 * (tâche 1 de docs/superpowers/plans/2026-09-11-migration-electron.md).
 *
 * `apps/windows/electron/fichiers.ts` est du Node pur : ce contrôle tourne
 * sur un VRAI dossier temporaire (`fs.mkdtemp`), retiré dans un `finally` —
 * pas de double, pas de faux système de fichiers à faire diverger.
 *
 * Onze cas, pas huit : le brief de la tâche cite `stat` (absent du contrat
 * `HostFs`, `src/host/types.ts`) et omet `list`, `remove`, `rename`, qui y
 * sont — voir le ruling 1 du journal de migration
 * (`.superpowers/sdd/2026-09-11-migration-electron/progress.md`). Ce
 * contrôle éprouve donc les huit cas du brief PLUS un par méthode ajoutée.
 *
 * Puis les primitives nées à la tranche 5, tâche 5 (le sélecteur « @ » sur
 * le contrat) : `listerDossier`, `statEntree` et `readBinary`, derrière les
 * canaux `HostFs.listDir` et `HostFs.externe`. Elles sont éprouvées ICI sur
 * leur comportement disque ; leur BORNAGE (« hors périmètre → refus nommé »)
 * est celui de `perimetre.borner`, que `canaux.ts` applique à chaque canal
 * `fichiers.*` et que `npm run check:electron-reglages` éprouve — `canaux.ts`
 * tire Electron et ne se charge pas ici.
 *
 * Chaque cas est isolé dans son propre `try/catch` (`cas()` ci-dessous) : une
 * rupture (écriture non attendue, par exemple) jette parfois une exception
 * NON CAPTURÉE par une assertion — sans cette isolation, ce cas ferait
 * MOURIR le script et cacherait tous les cas suivants en silence, exactement
 * le défaut nommé pour `check:lesson` dans `CLAUDE.md`.
 *
 *     npm run check:electron-fs
 */
import { mkdtemp, rm, readFile, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/**
 * Verrouille `chemin` en ouvrant un VRAI handle Windows SANS
 * `FILE_SHARE_DELETE` (un `powershell.exe` enfant, `[IO.File]::Open(...,
 * [IO.FileShare]::Read)`) — c'est ce que font OneDrive, un antivirus ou un
 * éditeur ouvert dessus, et c'est ce qui fait échouer un `unlink` avec
 * `EBUSY` de façon DÉTERMINISTE (revue 2026-09-27, Important 2). Rend une
 * fonction qui libère le verrou ; l'appelant doit l'attendre avant de nettoyer
 * le dossier temporaire.
 */
async function verrouiller(chemin) {
	// Hors Windows, pas de `powershell.exe` ni de verrou sans partage : le
	// cas appelant se déclare IGNORÉ plutôt que de faire mourir le script
	// (le `spawn` échoué émet une erreur que `cas()` ne capture pas).
	if (process.platform !== "win32") return null;
	const enfant = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
		`$f = [IO.File]::Open('${chemin}', [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read); Start-Sleep -Seconds 20; $f.Close()`,
	], { stdio: "ignore" });
	// Laisse PowerShell ouvrir le handle avant de rendre la main : sans cette
	// attente, le `rename` du cas pourrait s'exécuter avant que le verrou
	// n'existe et ne rien reproduire du tout.
	await new Promise((res) => setTimeout(res, 1000));
	return async () => {
		enfant.kill();
		// Laisse Windows relâcher le handle avant que le `finally` du cas
		// n'essaie de nettoyer le dossier temporaire.
		await new Promise((res) => setTimeout(res, 300));
	};
}

/** `true` si l'appel a rejeté, `false` sinon — pour comparer contre un
    booléen attendu, dans le même style que le reste du dépôt. */
async function aRejete(fn) {
	try {
		await fn();
		return false;
	} catch {
		return true;
	}
}

/** `true` si le chemin se lit, `false` s'il est absent. */
async function existeEncore(chemin) {
	try {
		await readFile(chemin);
		return true;
	} catch {
		return false;
	}
}

/** Exécute un cas ; une exception NON prévue devient un échec NOMMÉ au lieu
    de faire mourir le script — voir le commentaire d'en-tête. */
async function cas(r, nom, fn) {
	try {
		await fn();
	} catch (e) {
		r.check(nom, "EXCEPTION: " + (e && e.message ? e.message : String(e)), "pas d'exception");
	}
}

await withSrcModule("apps/windows/electron/fichiers.ts", async ({ creerFichiers, statEntree, renameParCopie, retirerSourceApresPose, memeFichier }) => {
	const r = makeReporter("Primitives de fichiers Electron");
	const dir = await mkdtemp(join(tmpdir(), "electron-fs-check-"));

	try {
		const fichiers = creerFichiers();

		await cas(r, "write puis read rend le même texte", async () => {
			const p = join(dir, "a.txt");
			await fichiers.write(p, "bonjour");
			r.check("write puis read rend le même texte", await fichiers.read(p), "bonjour");
		});

		await cas(r, "process reçoit le contenu ACTUEL et écrit ce que le rappel rend", async () => {
			const p = join(dir, "b.txt");
			await fichiers.write(p, "un");
			await fichiers.process(p, (contenu) => contenu + "-deux");
			r.check("process reçoit le contenu ACTUEL et écrit ce que le rappel rend",
				await fichiers.read(p), "un-deux");
		});

		await cas(r, "process sur un fichier absent rejette", async () => {
			const p = join(dir, "absent.txt");
			r.check("process sur un fichier absent rejette",
				await aRejete(() => fichiers.process(p, (c) => c + "x")), true);
		});

		await cas(r, "writeBinary écrit les octets exacts d'une vue partielle", async () => {
			const p = join(dir, "c.bin");
			const tampon = new Uint8Array([1, 2, 3, 4, 5, 6]);
			// Une vue PARTIELLE sur un tampon plus grand : seuls ses propres
			// octets doivent atterrir sur le disque, jamais tout le tampon.
			const vue = tampon.subarray(2, 4);
			await fichiers.writeBinary(p, vue);
			const relu = await readFile(p);
			r.check("writeBinary écrit les octets exacts d'une vue partielle", [...relu], [3, 4]);
		});

		await cas(r, "append ajoute sans relire tout le fichier", async () => {
			const p = join(dir, "d.txt");
			await fichiers.write(p, "1");
			// DEUX appels CONCURRENTS (`Promise.all`, pas l'un après l'autre) :
			// c'est l'atomicité de l'ajout, pas la valeur finale d'une séquence
			// déjà ordonnée, que ce cas éprouve. Un `append` qui relit puis
			// réécrit fait chacun des deux partir du même contenu lu, et l'un des
			// deux ajouts se perd — c'est exactement le défaut que le journal de
			// révision ne doit jamais subir.
			await Promise.all([fichiers.append(p, "2"), fichiers.append(p, "3")]);
			const relu = await fichiers.read(p);
			// L'ORDRE des deux ajouts concurrents n'est pas garanti — seule leur
			// PRÉSENCE l'est : les deux caractères doivent survivre, dans un ordre
			// ou dans l'autre.
			r.check("append ajoute sans relire tout le fichier",
				[...relu].sort().join(""), ["1", "2", "3"].sort().join(""));
		});

		await cas(r, "mkdirs sur un dossier existant ne rejette pas", async () => {
			// Un chemin à DEUX niveaux (parent inexistant au départ) : sans
			// `recursive: true`, la création réussirait la première fois par
			// chance sur un dossier à un seul niveau, et masquerait la rupture.
			const p = join(dir, "e-parent", "e-dossier");
			await fichiers.mkdirs(p);
			r.check("mkdirs sur un dossier existant ne rejette pas",
				await aRejete(() => fichiers.mkdirs(p)), false);
		});

		await cas(r, "trash DÉPLACE (source disparue) et ne supprime pas (contenu retrouvé)", async () => {
			const p = join(dir, "f.txt");
			await fichiers.write(p, "corbeille");
			await fichiers.trash(p, dir);
			const encore = await existeEncore(p);
			const cible = join(dir, ".trash", "f.txt");
			r.check("trash DÉPLACE (source disparue) et ne supprime pas (contenu retrouvé)",
				[encore, await fichiers.read(cible)], [false, "corbeille"]);
		});

		await cas(r, "un homonyme déjà en corbeille n'est pas écrasé (numéroté à côté)", async () => {
			const p1 = join(dir, "g.txt");
			await fichiers.write(p1, "premier");
			await fichiers.trash(p1, dir);
			const p2 = join(dir, "g.txt");
			await fichiers.write(p2, "second");
			await fichiers.trash(p2, dir);
			r.check("un homonyme déjà en corbeille n'est pas écrasé (numéroté à côté)",
				[
					await fichiers.read(join(dir, ".trash", "g.txt")),
					await fichiers.read(join(dir, ".trash", "g-2.txt")),
				],
				["premier", "second"]);
		});

		/* VENU DE `check:windows-host` À LA TÂCHE 4, ronde 1, et il lui manquait
		   un NOM. La création du dossier de corbeille était éprouvée là-bas par
		   « le dossier de la corbeille est créé avant le déplacement » ; ici,
		   elle n'était garantie qu'EN SUBSTANCE (sans elle, les deux cas
		   ci-dessus rougissent, puisqu'ils tournent dans un dossier temporaire
		   neuf où `.trash/` n'existe pas). Une assertion retirée d'un groupe sans
		   nom d'accueil ailleurs, c'est exactement la façon dont une migration
		   triche sans le dire — elle en a un désormais.
		   Le cas vise un SOUS-DOSSIER : `<racine>/.trash/` seul serait créé par
		   le premier `trash` de n'importe quel fichier, alors que
		   `<racine>/.trash/Cours/Reseau/` exige que `trash` crée toute la
		   branche du chemin relatif, et non le seul dossier de tête. */
		await cas(r, "le dossier de la corbeille est créé avant le déplacement, sous-dossiers compris", async () => {
			const sous = join(dir, "Cours", "Reseau");
			await fichiers.mkdirs(sous);
			const p = join(sous, "ch1.md");
			await fichiers.write(p, "profond");
			r.check("le dossier de la corbeille n'existe pas encore pour ce chemin",
				await fichiers.exists(join(dir, ".trash", "Cours", "Reseau")), false);
			await fichiers.trash(p, dir);
			r.check("le dossier de la corbeille est créé avant le déplacement, sous-dossiers compris",
				[
					await fichiers.exists(join(dir, ".trash", "Cours", "Reseau")),
					await fichiers.read(join(dir, ".trash", "Cours", "Reseau", "ch1.md")),
				],
				[true, "profond"]);
		});

		/* La numérotation d'un
		   homonyme vivait côté rendu sous Tauri, elle vit ici depuis que le pont
		   la porte. Un fichier SANS extension mis deux fois à la corbeille :
		   `.trash` porte un point, et couper au dernier point du chemin ENTIER
		   numéroterait le DOSSIER (« <racine>/-2.trash/README ») au lieu du
		   fichier — les deux versions finiraient dans deux dossiers différents
		   au lieu d'être côte à côte. */
		await cas(r, "un fichier sans extension est numéroté sur son NOM, pas sur .trash", async () => {
			const p = join(dir, "README");
			await fichiers.write(p, "premier");
			await fichiers.trash(p, dir);
			await fichiers.write(p, "second");
			await fichiers.trash(p, dir);
			r.check("un fichier sans extension est numéroté sur son NOM, pas sur .trash",
				[
					await fichiers.read(join(dir, ".trash", "README")),
					await fichiers.read(join(dir, ".trash", "README-2")),
				],
				["premier", "second"]);
		});

		await cas(r, "list d'un dossier absent rend []", async () => {
			const abs = join(dir, "n-existe-pas");
			r.check("list d'un dossier absent rend []", await fichiers.list(abs), []);
		});

		await cas(r, "remove ne rejette pas si le fichier est déjà absent", async () => {
			const p = join(dir, "h-absent.txt");
			r.check("remove ne rejette pas si le fichier est déjà absent",
				await aRejete(() => fichiers.remove(p)), false);
		});

		await cas(r, "rename REJETTE si la destination existe (source intacte)", async () => {
			const de = join(dir, "i-source.txt");
			const vers = join(dir, "i-dest.txt");
			await fichiers.write(de, "source");
			await fichiers.write(vers, "déjà là");
			const rejette = await aRejete(() => fichiers.rename(de, vers));
			// La source ne doit pas avoir bougé : un rejet doit être franc, pas
			// partiel — sinon un renommage refusé perdrait quand même le fichier.
			r.check("rename REJETTE si la destination existe (source intacte)",
				[rejette, await fichiers.read(de)], [true, "source"]);
		});

		/* REVUE 2026-09-27 (constat 1) : la garde d'avant (`exists` PUIS
		   `rename`) n'était PAS atomique — une fenêtre entre les deux `await`
		   laissait passer une écriture concurrente, que `fs.rename` de Node
		   écrase alors en silence. Sur l'ANCIEN code, les DEUX renommages
		   ci-dessous réussissaient (aucun `exists(vers)` ne voyait l'autre à
		   temps) et l'un des deux fichiers sources disparaissait sans laisser
		   de trace nulle part — silencieusement perdu. La garde par `fs.link`
		   (atomique au niveau du système de fichiers) fait qu'un seul des deux
		   peut réussir, quel que soit l'ordre d'exécution. */
		/* REVUE 2026-09-27 (re-revue, Mineur 6) : sur l'ANCIEN code (garde par
		   `fs.link`, mais SANS file de sérialisation), la course n'était pas
		   fermée pour de bon — deux appels DANS LE MÊME PROCESSUS pouvaient
		   chacun poser leur propre lien avant qu'aucun des deux n'ait retiré
		   sa source : 21 « réussites » sur 30 essais mesurés par la re-revue.
		   Boucler N fois ici, et vérifier pas seulement le COMPTE mais aussi
		   le CONTENU (la cible porte celui du gagnant, la source du perdant
		   est intacte) — un cas qui ne comptait que les succès pouvait rester
		   vert sur un double silencieux si les deux comptes s'annulaient par
		   hasard. */
		await cas(r, "rename : N renommages concurrents vers la même cible, un seul réussit à chaque fois", async () => {
			const N = 20;
			let echecsComptage = 0;
			let echecsContenu = 0;
			for (let i = 0; i < N; i++) {
				const vers = join(dir, `m-cible-${i}.txt`);
				const deA = join(dir, `m-source-a-${i}.txt`);
				const deB = join(dir, `m-source-b-${i}.txt`);
				await fichiers.write(deA, "A" + i);
				await fichiers.write(deB, "B" + i);
				const [resA, resB] = await Promise.allSettled([
					fichiers.rename(deA, vers),
					fichiers.rename(deB, vers),
				]);
				const reussis = [resA, resB].filter(x => x.status === "fulfilled").length;
				const rejetes = [resA, resB].filter(x => x.status === "rejected").length;
				if (reussis !== 1 || rejetes !== 1) { echecsComptage++; continue; }
				const gagnantA = resA.status === "fulfilled";
				const contenuCible = await fichiers.read(vers);
				const contenuAttendu = gagnantA ? "A" + i : "B" + i;
				const sourcePerdante = gagnantA ? deB : deA;
				const perdanteIntacte = await existeEncore(sourcePerdante)
					&& await fichiers.read(sourcePerdante) === (gagnantA ? "B" + i : "A" + i);
				if (contenuCible !== contenuAttendu || !perdanteIntacte) echecsContenu++;
			}
			r.check("rename : N renommages concurrents vers la même cible, un seul réussit à chaque fois",
				[echecsComptage, echecsContenu], [0, 0]);
		});

		/* REVUE 2026-09-27 (re-revue, Important 2b / point 3 du correctif) :
		   LA MÊME source déplacée vers DEUX cibles DIFFÉRENTES en parallèle —
		   scénario distinct du précédent (deux SOURCES vers une même cible,
		   déjà fermé par `fs.link`). Ici `fs.link` ne voit AUCUNE collision
		   (les cibles diffèrent), donc les DEUX liens se posaient avant que
		   l'un ou l'autre appel n'ait retiré la source : sur le code d'avant
		   cette tâche, 20 essais sur 20 donnaient les DEUX cibles à la fois —
		   un quiz devenu deux, un seul gardant l'historique. La file de
		   sérialisation du processus principal (`serialise`, dans
		   `creerFichiers`) ferme cette fenêtre : le second appel ne démarre
		   qu'une fois le premier terminé, et trouve alors la source déjà
		   partie (rejet `ENOENT` franc, jamais un second doublon). */
		await cas(r, "rename : la même source vers deux cibles concurrentes, une seule cible existe à la fois", async () => {
			const N = 20;
			let doublons = 0;
			for (let i = 0; i < N; i++) {
				const de = join(dir, `q-source-${i}.txt`);
				await fichiers.write(de, "contenu" + i);
				const versX = join(dir, `q-x-${i}.txt`);
				const versY = join(dir, `q-y-${i}.txt`);
				await Promise.allSettled([fichiers.rename(de, versX), fichiers.rename(de, versY)]);
				if (await existeEncore(versX) && await existeEncore(versY)) doublons++;
			}
			r.check("rename : la même source vers deux cibles concurrentes, une seule cible existe à la fois",
				doublons, 0);
		});

		/* REVUE 2026-09-27 (re-revue, Important 1) : un code d'erreur de
		   `fs.link` AUTRE que `EEXIST`/`ENOENT` doit se replier sur la copie,
		   pas jeter — `EXDEV`/`EPERM` n'étaient pas les seuls motifs de refus
		   (`EISDIR` sur FAT32/exFAT, `ENOTSUP` sur certains partages réseau,
		   non reproductibles sur ce volume NTFS). La limite RÉELLE et
		   reproductible ICI : NTFS refuse un lien dur au-delà de 1023 noms
		   pour un même fichier — Node rend un code qui n'est ni `EEXIST` ni
		   `EPERM` ni `EXDEV` (souvent `UNKNOWN`, faute de correspondance
		   POSIX). C'est un CAS RÉEL de « code inattendu », pas un simulacre. */
		await cas(r, "rename : un code de link inattendu (limite NTFS des liens durs) se replie sur la copie", async () => {
			const de = join(dir, "n-source.txt");
			await fichiers.write(de, "contenu-n");
			for (let i = 0; i < 1023; i++) await link(de, join(dir, `n-lien-${i}.txt`));
			const vers = join(dir, "n-dest.txt");
			await fichiers.rename(de, vers);
			r.check("rename : un code de link inattendu (limite NTFS des liens durs) se replie sur la copie",
				[await existeEncore(de), await fichiers.read(vers)], [false, "contenu-n"]);
		});

		/* REVUE 2026-09-27 (re-revue, Important 2, reproduit déterministe) :
		   un `unlink(de)` qui échoue APRÈS un `link` réussi (source verrouillée
		   par un autre processus — OneDrive, un antivirus, un éditeur, sans
		   `FILE_SHARE_DELETE`) laissait la source ET la cible sur le disque,
		   un doublon silencieux jamais annoncé (le rejet ne le dit pas). Le
		   correctif retire le lien qu'il vient de poser avant de relancer. */
		await cas(r, "rename : unlink après link échoue (source verrouillée) — rejette SANS doublon", async () => {
			const de = join(dir, "o-source.txt");
			await fichiers.write(de, "verrouille-moi");
			const liberer = await verrouiller(de);
			if (!liberer) { console.log("  (ignoré hors Windows : verrou sans FILE_SHARE_DELETE)"); return; }
			try {
				const vers = join(dir, "o-dest.txt");
				const rejette = await aRejete(() => fichiers.rename(de, vers));
				r.check("rename : unlink après link échoue (source verrouillée) — rejette SANS doublon",
					[rejette, await existeEncore(de), await existeEncore(vers)], [true, true, false]);
			} finally {
				await liberer();
			}
		});

		/* Même principe pour le repli par copie : si le retrait de la source
		   échoue, la copie qu'on venait de poser (`vers`) est retirée à son
		   tour plutôt que de laisser un doublon. */
		await cas(r, "renameParCopie : si le retrait de la source échoue, la copie est retirée elle aussi", async () => {
			const de = join(dir, "p-source.txt");
			await fichiers.write(de, "verrouille-copie");
			const liberer = await verrouiller(de);
			if (!liberer) { console.log("  (ignoré hors Windows : verrou sans FILE_SHARE_DELETE)"); return; }
			try {
				const vers = join(dir, "p-dest.txt");
				const rejette = await aRejete(() => renameParCopie(de, vers));
				r.check("renameParCopie : si le retrait de la source échoue, la copie est retirée elle aussi",
					[rejette, await existeEncore(de), await existeEncore(vers)], [true, true, false]);
			} finally {
				await liberer();
			}
		});

		/* LA SOURCE DÉJÀ PARTIE après la pose de la cible (2026-09-27) : un
		   autre acteur a retiré `de` entre le `link` (ou la copie) et son
		   `unlink`. La donnée est à `vers`, rien n'est plus à `de` : le
		   déplacement a RÉUSSI et ne doit pas rejeter — sinon « Déplacer
		   vers » l'annonçait comme un échec et sautait la transposition de
		   l'historique. Provoqué ici sans course : `de` n'existe pas. */
		for (const parIno of [true, false]) {
			const nom = `retirerSourceApresPose : une source déjà partie est un déplacement réussi (${parIno ? "lien" : "copie"})`;
			await cas(r, nom, async () => {
				const de = join(dir, `s-source-${parIno}.txt`);
				const vers = join(dir, `s-dest-${parIno}.txt`);
				await fichiers.write(vers, "posee");
				const rejette = await aRejete(() => retirerSourceApresPose(de, vers, parIno));
				r.check(nom, [rejette, await fichiers.read(vers)], [false, "posee"]);
			});
		}

		/* L'IDENTITÉ D'UN FICHIER en `bigint` (2026-09-27) : deux
		   identifiants NTFS voisins au-delà de 2^53 sont DISTINCTS, alors
		   qu'en `number` ils s'arrondissent au même — la garde retirerait
		   alors un fichier étranger. */
		await cas(r, "memeFichier : deux identifiants voisins au-delà de 2^53 restent distincts", async () => {
			const a = { ino: 2n ** 60n, dev: 7n };
			const b = { ino: 2n ** 60n + 1n, dev: 7n };
			r.check("préalable : en number, ces deux identifiants se confondent", Number(a.ino) === Number(b.ino), true);
			r.check("memeFichier : deux identifiants voisins au-delà de 2^53 restent distincts",
				[memeFichier(a, b), memeFichier(a, { ino: 2n ** 60n, dev: 7n }), memeFichier(a, { ino: a.ino, dev: 8n })],
				[false, true, false]);
		});

		/* Le repli copie (`renameParCopie`, emprunté par `rename` sur
		   `EXDEV`/`EPERM`, non reproductibles sans un second volume — voir le
		   commentaire de la fonction) : mêmes garanties qu'un `fs.link`
		   direct, éprouvées ici en l'appelant hors de tout `EXDEV` réel. */
		await cas(r, "renameParCopie (repli) déplace le fichier ET refuse d'écraser une cible existante", async () => {
			const de = join(dir, "m2-source.txt");
			const vers = join(dir, "m2-dest.txt");
			await fichiers.write(de, "contenu");
			await renameParCopie(de, vers);
			const dejaLa = join(dir, "m2-source-2.txt");
			const versOccupe = join(dir, "m2-dest.txt"); // déjà écrit ci-dessus
			await fichiers.write(dejaLa, "autre contenu");
			const rejette = await aRejete(() => renameParCopie(dejaLa, versOccupe));
			r.check("renameParCopie (repli) déplace le fichier ET refuse d'écraser une cible existante",
				[
					await existeEncore(de),
					await fichiers.read(vers),
					rejette,
					await existeEncore(dejaLa),
				],
				[false, "contenu", true, true]);
		});

		/* Tâche 3 : « Déplacer vers… » déplace un DOSSIER, pas seulement un
		   fichier — c'est ce que `HostFs.rename` promet désormais
		   explicitement (`src/host/types.ts`). Sur le même volume que ce
		   dossier temporaire, `fs.rename` de Node le fait nativement ; le
		   repli EXDEV (deux volumes) n'est pas reproductible ici sans un
		   second disque, mais le comportement OBSERVABLE — les fichiers
		   suivent, la source disparaît — doit être identique dans les deux
		   cas, donc ce cas couvre déjà le contrat que le repli doit tenir. */
		await cas(r, "rename déplace un dossier avec tout son contenu (les fichiers suivent, la source disparaît)", async () => {
			const de = join(dir, "k-module");
			const vers = join(dir, "k-module-deplace");
			await fichiers.mkdirs(de);
			await fichiers.write(join(de, "q1.md"), "un");
			await fichiers.write(join(de, "q2.md"), "deux");
			await fichiers.rename(de, vers);
			r.check("rename déplace un dossier avec tout son contenu (les fichiers suivent, la source disparaît)",
				[
					await existeEncore(join(de, "q1.md")),
					await fichiers.read(join(vers, "q1.md")),
					await fichiers.read(join(vers, "q2.md")),
				],
				[false, "un", "deux"]);
		});

		await cas(r, "rename d'un dossier REJETTE si la destination existe déjà", async () => {
			const de = join(dir, "l-module");
			const vers = join(dir, "l-module-existe");
			await fichiers.mkdirs(de);
			await fichiers.mkdirs(vers);
			await fichiers.write(join(de, "q1.md"), "source");
			await fichiers.write(join(vers, "deja-la.md"), "déjà là");
			const rejette = await aRejete(() => fichiers.rename(de, vers));
			r.check("rename d'un dossier REJETTE si la destination existe déjà",
				[rejette, await existeEncore(join(de, "q1.md"))], [true, true]);
		});

		/* ── tranche 5, tâche 5 : listerDossier, statEntree, readBinary ── */

		await cas(r, "listerDossier rend les entrées avec leur type", async () => {
			const d = join(dir, "j-dossier");
			await fichiers.mkdirs(join(d, "Sous"));
			await fichiers.write(join(d, "a.md"), "a");
			await fichiers.write(join(d, "b.png"), "b");
			const entrees = (await fichiers.listerDossier(d)).sort((x, y) => x.name.localeCompare(y.name));
			/* Des NOMS avec leur type, jamais des chemins : c'est le rendu qui
			   recompose (contrat ou absolu). Un chemin rendu ici serait
			   réempilé une seconde fois par l'hôte du rendu. */
			r.check("listerDossier rend les entrées avec leur type",
				entrees,
				[{ name: "a.md", isFolder: false }, { name: "b.png", isFolder: false }, { name: "Sous", isFolder: true }]);
		});

		await cas(r, "listerDossier d'un dossier absent rend []", async () => {
			r.check("listerDossier d'un dossier absent rend []",
				await fichiers.listerDossier(join(dir, "n-existe-pas")), []);
		});

		await cas(r, "statEntree distingue fichier et dossier, null si absent", async () => {
			const f = join(dir, "k-fichier.txt");
			const d = join(dir, "k-dossier");
			await fichiers.write(f, "x");
			await fichiers.mkdirs(d);
			const sf = await statEntree(f);
			const sd = await statEntree(d);
			/* `stat` (celui de la fraîcheur) rend `null` pour un dossier ; ici,
			   c'est le `mtime` du DOSSIER qui invalide l'index d'une racine
			   externe — un `null` le laisserait périmé à jamais. */
			r.check("statEntree distingue fichier et dossier, null si absent",
				[sf?.isFile, sf?.mtimeMs > 0, sf?.size, sd?.isFile, sd?.mtimeMs > 0, await statEntree(join(dir, "k-rien"))],
				[true, true, 1, false, true, null]);
		});

		await cas(r, "readBinary rend les octets en Uint8Array, jamais un Buffer", async () => {
			const p = join(dir, "l-octets.bin");
			await fichiers.writeBinary(p, new Uint8Array([0, 255, 7]));
			const lu = await fichiers.readBinary(p);
			/* Un `Buffer` peut être une VUE sur le pool partagé de Node : le
			   clonage structuré de l'IPC emporterait tout le tampon. */
			r.check("readBinary rend les octets en Uint8Array, jamais un Buffer",
				[lu.constructor.name, [...lu]], ["Uint8Array", [0, 255, 7]]);
		});
	} finally {
		// `finally` : le dossier temporaire doit disparaître même si un cas a
		// jeté une erreur inattendue, pas seulement un échec d'assertion.
		await rm(dir, { recursive: true, force: true });
	}

	r.done();
});
