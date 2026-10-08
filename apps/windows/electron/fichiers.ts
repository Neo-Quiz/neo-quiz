/* ══════════════════════════════════════════════════════════
   LES PRIMITIVES DE FICHIERS DU PROCESSUS PRINCIPAL ELECTRON

   Tâche 1 de la migration Tauri → Electron
   (docs/superpowers/plans/2026-09-11-migration-electron.md). Ce module ne
   CONSOMME rien : ni Electron, ni fenêtre, ni IPC, ni le reste du dépôt — que
   `node:fs/promises` et `node:path`. C'est ce qui permet à son contrôle de
   tourner sur un vrai dossier temporaire, sans aucun double.

   Les méthodes portent les mêmes NOMS et la même SÉMANTIQUE que `HostFs`
   (`src/host/types.ts`), à une différence près, volontaire : les chemins
   reçus ici sont des chemins ABSOLUS du disque, jamais des chemins du
   contrat. La conversion contrat ↔ absolu reste côté rendu, dans
   `apps/windows/src/host/roots.ts` (`CarteRacines`), qui ne bouge pas — et
   que ce module n'importe pas non plus : `roots.ts` vit dans l'arbre bundlé
   par Vite pour la fenêtre, `fichiers.ts` dans celui du processus principal.
   Les faire dépendre l'un de l'autre brouillerait la frontière que les
   tâches suivantes (2 et 3) posent explicitement.

   ÉCART AU BRIEF DE LA TÂCHE, tranché en pré-vol (ruling 1 du journal de
   migration) : le brief cite `stat`, absent du contrat `HostFs`, et omet
   `list`, `remove` et `rename`, qui y sont. Ce fichier suit le CONTRAT, qui
   fait autorité sur le plan : les onze méthodes ci-dessous sont `read`,
   `readCached`, `write`, `process`, `writeBinary`, `append`, `exists`,
   `mkdirs`, `trash`, `list`, `remove`, `rename`. `stat` reste une primitive
   INTERNE (l'index de la tâche 2 en aura besoin pour les `mtime`), jamais
   présentée comme une méthode du contrat.
══════════════════════════════════════════════════════════ */

import * as fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import * as path from "node:path";

/** Les primitives de fichiers du processus principal. Onze méthodes du
    contrat, plus `readBinary` et `listerDossier` (tranche 5, tâche 5 — les
    racines externes du sélecteur « @ », `HostFs.externe`), plus `stat` et
    `statEntree` — internes, voir plus haut et plus bas. */
export interface PrimitivesFichiers {
	/** Lit un fichier texte. Rejette si absent ou illisible. */
	/** `maxOctets`: the read itself is bounded (rejects when the file is over it, even if it grew after a size check). */
	read(chemin: string, maxOctets?: number): Promise<string>;
	/** Lit des OCTETS. Rejette si absent ou illisible. Sert
	    `HostFs.externe.readBinary` (les images jointes hors vault). */
	readBinary(chemin: string): Promise<Uint8Array>;
	/** Pas de cache ici — voir le commentaire sur `readCached` ci-dessous. */
	readCached(chemin: string): Promise<string>;
	/** CRÉE OU REMPLACE, sans jamais rejeter parce que la cible existe déjà. */
	write(chemin: string, donnees: string): Promise<void>;
	/** Lecture-modification-écriture : le rappel reçoit le contenu ACTUEL du
	    fichier et rend ce qui doit être écrit. Le rappel peut être REJOUÉ —
	    `detail-io.ts` (côté rendu) en dépend pour son compare-and-swap. */
	process(chemin: string, muter: (contenu: string) => string): Promise<void>;
	/** Écrit des OCTETS. Il faut écrire la VUE reçue, jamais son tampon
	    sous-jacent (`data.buffer`) : une vue partielle sur un tampon partagé
	    (image collée depuis un plus grand buffer) verrait sinon tout le
	    tampon écrit à sa place. */
	writeBinary(chemin: string, donnees: Uint8Array): Promise<void>;
	/** Ajoute SANS relire tout le fichier : c'est l'atomicité de l'ajout qui
	    protège le journal de révision d'une fermeture au mauvais moment. */
	append(chemin: string, donnees: string): Promise<void>;
	exists(chemin: string): Promise<boolean>;
	/** Crée le dossier et ses parents ; ne rejette pas s'il existe déjà. */
	mkdirs(chemin: string): Promise<void>;
	/** Déplace vers `<racine>/.trash/<chemin relatif à la racine>` — ne
	    SUPPRIME jamais. `racine` est un paramètre explicite (et non déduit du
	    chemin) : ce module ne connaît pas la notion de racines multiples,
	    c'est `CarteRacines` côté rendu qui la porte ; voir le pont de la
	    tâche 3 (`Pont.fichiers.trash(abs, racine)`), dont ceci reprend la
	    forme. Un homonyme déjà présent dans la corbeille est NUMÉROTÉ, jamais
	    écrasé — la corbeille est l'endroit où rien ne disparaît. */
	trash(chemin: string, racine: string): Promise<void>;
	/** Les FICHIERS d'un dossier, sans descendre dans les sous-dossiers. Un
	    dossier absent rend `[]` : ce n'est pas une erreur. */
	list(dossier: string): Promise<string[]>;
	/** TOUTES les entrées d'un dossier, fichiers ET sous-dossiers, avec leur
	    type, sans descendre. Le NOM seul, jamais un chemin : c'est le rendu qui
	    recompose `dossier + "/" + nom` (contrat ou absolu, il est seul à le
	    savoir — voir l'en-tête de `pont.ts`). Un dossier absent rend `[]`. Un
	    lien symbolique n'est ni fichier ni dossier ici (`isDirectory()` est
	    faux sur un `Dirent` de lien) : il n'est pas descendu, comme dans
	    `parcours.ts`. Sert `HostFs.listDir` et `HostFs.externe.list`. */
	listerDossier(dossier: string): Promise<Array<{ name: string; isFolder: boolean }>>;
	/** Retire un fichier. Ne rejette PAS si le fichier est déjà absent. */
	remove(chemin: string): Promise<void>;
	/** Renomme. REJETTE si la destination existe déjà — la migration du
	    journal de révision s'en sert pour ne jamais écraser une sauvegarde. */
	rename(de: string, vers: string): Promise<void>;
}

/** Vrai si le chemin existe sur le disque (fichier ou dossier). */
async function existeSurDisque(chemin: string): Promise<boolean> {
	try {
		await fs.access(chemin);
		return true;
	} catch {
		return false;
	}
}

/**
 * Coupe un chemin en base + EXTENSION, le point cherché dans le DERNIER
 * SEGMENT seulement — même règle que `couperExtension` de `roots.ts` (côté
 * rendu), reprise ici en local plutôt qu'importée : voir le commentaire
 * d'en-tête sur la frontière principal/rendu. Un point de TÊTE de nom n'est
 * pas une extension (« .gitignore »).
 */
function couperExtension(chemin: string): { base: string; ext: string } {
	const nomFichier = path.basename(chemin);
	const point = nomFichier.lastIndexOf(".");
	if (point <= 0) return { base: chemin, ext: "" };
	const coupe = chemin.length - (nomFichier.length - point);
	return { base: chemin.slice(0, coupe), ext: chemin.slice(coupe) };
}

/**
 * Le premier chemin LIBRE de la forme `base`, `base-2`, `base-3`… + `ext`.
 * NE RÉSERVE RIEN : un appel concurrent peut encore retrouver le même nom
 * libre. Ici, un seul appelant (`trash`) l'utilise et la course entre deux
 * mises à la corbeille du même chemin ne peut de toute façon pas se produire
 * (la seconde ne retrouve plus sa source, déjà déplacée par la première).
 */
async function cheminLibre(base: string, ext: string): Promise<string> {
	for (let n = 1; n <= 50; n++) {
		const candidat = n === 1 ? base + ext : `${base}-${n}${ext}`;
		if (!(await existeSurDisque(candidat))) return candidat;
	}
	throw new Error("aucun nom de fichier libre après 50 essais : " + base + ext);
}

/** Deux `stat` désignent-ils le MÊME fichier ? Lus en `bigint`, jamais en
    `number` : un identifiant de fichier NTFS porte son numéro de séquence
    dans ses 16 bits hauts et dépasse presque toujours 2^53 — en `number`,
    deux fichiers voisins dans la table MFT s'arrondissent au même `ino`, et
    la garde de `retirerSourceApresPose` retirerait un fichier que quelqu'un
    d'autre vient de poser. Le type exige des `bigint` : un appel qui
    oublierait `{ bigint: true }` ne compile pas (`check:app`). */
export function memeFichier(a: { ino: bigint; dev: bigint }, b: { ino: bigint; dev: bigint }): boolean {
	return a.ino === b.ino && a.dev === b.dev;
}

/**
 * Achève un déplacement dont la cible `vers` est DÉJÀ posée (lien dur ou
 * copie) en retirant la source `de`.
 *
 * `ENOENT` : la source est déjà partie — un autre acteur (l'Explorateur, une
 * synchronisation) l'a retirée entre la pose de `vers` et ce retrait. La
 * donnée est à `vers`, plus rien n'est à `de` : c'est un déplacement RÉUSSI,
 * qui ne doit pas être annoncé comme un échec (ni priver l'appelant de la
 * transposition de l'historique qui suit un succès).
 *
 * Tout autre échec : `vers` est retiré avant de relancer l'erreur, mais
 * SEULEMENT s'il est encore, sans le moindre doute, la même donnée que `de`
 * — jamais un fichier que quelqu'un d'autre aurait posé là entre-temps. `de`
 * existe encore (l'`unlink` qui a échoué l'a laissé en place) ; si la
 * comparaison est impossible, on ne retire RIEN — un doublon coûte moins
 * cher qu'un retrait sur un pari.
 *
 * `parIno` : `true` compare `ino`/`dev` (cas du lien dur — `vers` et `de`
 * sont alors littéralement le même fichier). `false` retire `vers`
 * inconditionnellement (cas de la copie — `vers` est une donnée que CE code
 * vient de créer lui-même, personne d'autre n'a pu s'en emparer entre la
 * copie et cet appel).
 *
 * EXPORTÉE pour que le contrôle éprouve le cas `ENOENT` de façon
 * déterministe : la course réelle (source retirée entre deux `await`) ne se
 * provoque pas à coup sûr.
 */
export async function retirerSourceApresPose(de: string, vers: string, parIno: boolean): Promise<void> {
	try {
		await fs.unlink(de);
		return;
	} catch (erreur) {
		if ((erreur as NodeJS.ErrnoException)?.code === "ENOENT") return;
		try {
			if (parIno) {
				const [infoDe, infoVers] = await Promise.all([fs.stat(de, { bigint: true }), fs.stat(vers, { bigint: true })]);
				if (memeFichier(infoDe, infoVers)) await fs.unlink(vers);
			} else {
				await fs.unlink(vers);
			}
		} catch {
			// Incertain (l'un des deux a disparu, ou le retrait lui-même a
			// échoué) : on laisse le doublon plutôt que de risquer de retirer
			// autre chose que ce qu'on vient de poser.
		}
		throw erreur;
	}
}

/**
 * Repli de `rename` pour un FICHIER quand `fs.link` ne peut pas être posé.
 * `COPYFILE_EXCL` rejette avec `EEXIST` si `vers` existe déjà, donc la garde
 * anti-écrasement reste ATOMIQUE même sur ce chemin — jamais un `exists` +
 * `copyFile` qui rouvrirait la même fenêtre de course que l'ancien
 * `exists` + `rename`.
 *
 * Une COPIE, jamais un lien : `de` n'est retiré qu'APRÈS qu'elle a réussi —
 * une erreur d'écriture au milieu ne perd donc jamais la source (une coupure
 * BRUTALE du processus, elle, peut laisser `vers` tronqué ; voir `rename`).
 * Si le retrait de la source échoue ensuite, `vers` (CETTE copie, que
 * personne d'autre n'a pu toucher) est retiré à son tour plutôt que de
 * laisser un doublon.
 *
 * EXPORTÉE séparément de `rename` UNIQUEMENT pour que le contrôle puisse
 * l'éprouver directement : un `EXDEV`/`EPERM`/`EISDIR`/`ENOTSUP` réel ne se
 * produit qu'entre deux volumes distincts ou systèmes de fichiers différents,
 * non reproductible dans un unique dossier temporaire de test (même limite
 * déjà assumée par le repli `EXDEV` du renommage d'un DOSSIER, plus bas).
 */
export async function renameParCopie(de: string, vers: string): Promise<void> {
	try {
		await fs.copyFile(de, vers, fsConstants.COPYFILE_EXCL);
	} catch (e) {
		if ((e as NodeJS.ErrnoException)?.code === "EEXIST") throw new Error(`${vers} existe déjà`);
		throw e;
	}
	await retirerSourceApresPose(de, vers, false);
}

/** Crée un dossier et ses parents ; ne rejette pas s'il existe déjà — une
    course entre deux écritures ne doit pas faire échouer l'une d'elles. */
async function creerDossiers(chemin: string): Promise<void> {
	try {
		await fs.mkdir(chemin, { recursive: true });
	} catch (e) {
		if (!(await existeSurDisque(chemin))) throw e;
	}
}

/** La date de modification d'un fichier, ou `null` s'il est absent ou si le
    chemin désigne un dossier. Primitive INTERNE — voir l'en-tête : la tâche 2
    (l'index) en aura besoin pour les `mtime`, mais elle n'est présentée à
    personne comme une méthode du contrat `HostFs`. */
export async function stat(chemin: string): Promise<{ mtime: number } | null> {
	try {
		const info = await fs.stat(chemin);
		if (info.isDirectory()) return null;
		return { mtime: info.mtimeMs };
	} catch {
		return null;
	}
}

/** Fichier ou dossier, avec sa date : ce que `HostFs.externe.stat` demande.
    DISTINCTE de `stat` ci-dessus, qui rend `null` pour un dossier et dont
    `fraicheur` (canaux.ts) et `parcours.ts` dépendent : l'index d'une racine
    externe s'invalide sur le `mtime` de la RACINE, qui est un dossier. */
export async function statEntree(chemin: string): Promise<{ isFile: boolean; mtimeMs: number; size: number } | null> {
	try {
		const info = await fs.stat(chemin);
		return { isFile: info.isFile(), mtimeMs: info.mtimeMs, size: info.size };
	} catch {
		return null;
	}
}

/** Construit les primitives de fichiers du processus principal. */
export function creerFichiers(): PrimitivesFichiers {
	const primitives: PrimitivesFichiers = {
		async read(chemin, maxOctets) {
			if (maxOctets === undefined) return await fs.readFile(chemin, "utf-8");
			const h = await fs.open(chemin, "r");
			try {
				// One byte more than the cap: reading it proves the file is over, whatever its size said.
				const buf = Buffer.alloc(maxOctets + 1);
				const { bytesRead } = await h.read(buf, 0, maxOctets + 1, 0);
				if (bytesRead > maxOctets) throw new Error("file too large");
				return buf.subarray(0, bytesRead).toString("utf-8");
			} finally { await h.close(); }
		},
		/* `new Uint8Array(buffer)` et non le `Buffer` de Node : un `Buffer` peut
		   être une VUE sur un tampon partagé plus grand (le pool de Node pour
		   les petits fichiers), et le clonage structuré de l'IPC emporterait
		   tout le tampon avec lui. La copie coûte la taille du fichier, une
		   fois. */
		async readBinary(chemin) {
			return new Uint8Array(await fs.readFile(chemin));
		},
		/* PAS de cache : un processus unique, sans autre écrivain que lui-même,
		   n'a rien à gagner à en inventer un — même raison que l'hôte Windows
		   actuel (`apps/windows/src/host/fs.ts`). */
		async readCached(chemin) {
			return await fs.readFile(chemin, "utf-8");
		},
		async write(chemin, donnees) {
			await fs.writeFile(chemin, donnees, "utf-8");
		},
		async process(chemin, muter) {
			const contenu = await fs.readFile(chemin, "utf-8");
			await fs.writeFile(chemin, muter(contenu), "utf-8");
		},
		async writeBinary(chemin, donnees) {
			await fs.writeFile(chemin, donnees);
		},
		/* `flag: "a"` : l'ajout est porté par le système de fichiers lui-même,
		   jamais un lire-puis-réécrire qui perdrait l'atomicité. */
		async append(chemin, donnees) {
			await fs.appendFile(chemin, donnees, { encoding: "utf-8" });
		},
		exists: existeSurDisque,
		mkdirs: creerDossiers,
		async trash(chemin, racine) {
			const relatif = path.relative(racine, chemin).split(path.sep).join("/");
			const vise = path.join(racine, ".trash", relatif).split(path.sep).join("/");
			const { base, ext } = couperExtension(vise);
			const cible = await cheminLibre(base, ext);
			await creerDossiers(path.dirname(cible));
			await fs.rename(chemin, cible);
		},
		async list(dossier) {
			try {
				const entrees = await fs.readdir(dossier, { withFileTypes: true });
				return entrees.filter(e => e.isFile()).map(e => path.join(dossier, e.name));
			} catch {
				// Dossier absent (ou illisible) : le contrat demande `[]`, pas une
				// exception.
				return [];
			}
		},
		async listerDossier(dossier) {
			try {
				const entrees = await fs.readdir(dossier, { withFileTypes: true });
				return entrees.map(e => ({ name: e.name, isFolder: e.isDirectory() }));
			} catch {
				// Absent ou illisible : `[]`, comme `list`.
				return [];
			}
		},
		async remove(chemin) {
			try {
				await fs.unlink(chemin);
			} catch (e) {
				if (await existeSurDisque(chemin)) throw e;
			}
		},
		rename,
	};

	/* Les fonctions ci-dessous complètent `primitives.rename` — déclarées ici
	   (portée de fonction, hissées) pour rester lisibles à la SUITE de la
	   liste des méthodes plutôt qu'imbriquées dedans ; `return primitives`
	   n'arrive qu'à la toute fin de `creerFichiers`, une fois qu'elles
	   existent. */

	/* ── SÉRIALISATION (revue 2026-09-27, constat 2b) ──
	   Deux renommages lancés en parallèle DANS ce processus (deux clics
	   rapprochés, deux fenêtres de la même app) pouvaient tous les deux
	   « réussir » : `fs.link` est atomique contre un acteur EXTERNE, mais rien
	   n'empêchait ici deux appels internes de poser chacun leur lien sur la
	   MÊME source avant qu'aucun des deux n'ait eu le temps de la retirer —
	   chacun voyait alors sa propre cible, aucun des deux ne rejetait, et la
	   source finissait dupliquée deux fois plutôt qu'une. Une file simple —
	   une chaîne de promesses, jamais deux `rename` de ce processus en vol à
	   la fois — ferme cette fenêtre : `link` reste la garde contre un
	   acteur hors de ce processus (l'Explorateur, un autre processus). */
	let file: Promise<unknown> = Promise.resolve();
	function serialise<T>(tache: () => Promise<T>): Promise<T> {
		const course = file.then(tache, tache);
		// La file continue même si `tache` a rejeté : sinon un seul échec
		// bloquerait tout renommage suivant pour le reste de la session.
		file = course.then(() => undefined, () => undefined);
		return course;
	}

	/* Pas d'écrasement : la migration du journal s'appuie sur ce refus (voir
	   `apps/windows/src/host/fs.ts`, même remarque) — écraser une sauvegarde
	   `review-log.jsonl.migrated` déjà là la détruirait.

	   REVUE (2026-09-27) : `if (await existe(vers)) throw` PUIS `fs.rename`
	   porte une fenêtre de course — entre les deux `await`, un AUTRE
	   renommage (ou une écriture) vers `vers` peut créer la cible, et
	   `fs.rename` de Node l'écrase alors en silence (Windows comme POSIX).
	   Pour un FICHIER, la garde est rendue atomique par `fs.link` : il pose
	   un second nom sur les mêmes octets et REJETTE avec `EEXIST` si `vers`
	   existe déjà — aucune fenêtre entre la vérification et l'écriture,
	   contrairement à `exists` + `rename`. La source est ensuite retirée
	   (`unlink`), ce qui est bien un déplacement du point de vue de
	   l'appelant.
	   Un DOSSIER (ou un LIEN — jonction, symlink) ne peut pas se lier ainsi
	   (`fs.link` ne sait lier que des fichiers RÉGULIERS) : la garde y reste
	   `exists` + `rename`, avec sa fenêtre résiduelle assumée — Windows
	   refuse déjà nativement d'écraser un dossier existant via `MoveFileEx`
	   (pas de remplacement pour un dossier), ce qui borne le risque en
	   pratique à une course sur un dossier CRÉÉ entre les deux `await`, plus
	   étroite que celle d'un fichier. */
	async function rename(de: string, vers: string): Promise<void> {
		return serialise(() => renameInterne(de, vers));
	}

	async function renameInterne(de: string, vers: string): Promise<void> {
		const source = await fs.lstat(de).catch(() => null);
		// `isSymbolicLink` avant `isDirectory` (Mineur 2, revue 2026-09-27) :
		// une JONCTION vers un dossier serait sinon prise pour un dossier —
		// `fs.link` échouerait sur elle sans jamais l'atteindre, alors que
		// `fs.rename` natif la déplace très bien telle quelle, comme
		// n'importe quel autre lien.
		if (source?.isDirectory() || source?.isSymbolicLink()) {
			if (await existeSurDisque(vers)) throw new Error(`${vers} existe déjà`);
			try {
				await fs.rename(de, vers);
			} catch (e) {
				/* EXDEV : la source et la destination sont sur deux VOLUMES
				   distincts (« Déplacer vers… » peut traverser un vault sur
				   `D:` et `C:\Neo Quiz`) — `fs.rename` de Node ne sait
				   déplacer que sur un même volume. Repli : copie récursive
				   puis suppression de la source. Pas atomique, mais c'est la
				   seule option hors du volume ; la garde d'écrasement
				   ci-dessus a déjà eu lieu.
				   `force: false, errorOnExist: true` (Mineur 1, revue
				   2026-09-27) : `fs.cp` écrase par défaut (`force` vaut
				   `true`) — si un `vers` homonyme apparaissait entre le
				   `existeSurDisque` ci-dessus et cette copie (deux volumes,
				   création concurrente), l'ancien réglage l'aurait écrasé
				   avant de jeter la source ; désormais `cp` rejette et `rm`
				   n'est jamais atteint. */
				if ((e as NodeJS.ErrnoException)?.code !== "EXDEV") throw e;
				await fs.cp(de, vers, { recursive: true, force: false, errorOnExist: true });
				await fs.rm(de, { recursive: true, force: true });
			}
			return;
		}
		try {
			await fs.link(de, vers);
		} catch (e) {
			const code = (e as NodeJS.ErrnoException)?.code;
			if (code === "EEXIST") throw new Error(`${vers} existe déjà`);
			// `ENOENT` : `de` (la source) ou le dossier PARENT de `vers` sont
			// absents — une absence réelle, jamais un système de fichiers qui
			// refuserait le lien dur. Le repli par copie échouerait de la
			// même façon (elle lit `de` puis écrit dans le même dossier
			// parent) ; autant jeter tout de suite l'erreur brute.
			if (code === "ENOENT") throw e;
			/* TOUT AUTRE CODE (revue 2026-09-27, Important 1) : un lien dur
			   peut être refusé pour bien plus de raisons qu'`EXDEV` (deux
			   volumes) et `EPERM` (permission) — `EISDIR` sur FAT32/exFAT
			   (c'est l'erreur Windows « Fonction incorrecte » que traduit
			   libuv, la même que `mklink /H` sur une clé USB), `ENOTSUP` sur
			   certains partages réseau ou WebDAV, `EMLINK` si le fichier a
			   déjà atteint son nombre maximal de liens. Aucun de ces codes
			   n'a de raison de faire ÉCHOUER le déplacement : `COPYFILE_EXCL`
			   garde la même garde atomique quel que soit le motif du refus
			   de `link`, donc le repli s'applique à tout sauf `EEXIST` (une
			   vraie collision, pas la peine d'essayer une copie qui
			   rejetterait pareil) et `ENOENT` (une absence, pas la peine non
			   plus). */
			await renameParCopie(de, vers);
			return;
		}
		/* Le lien est posé : la source devient superflue, la retirer achève
		   le déplacement. REVUE (2026-09-27, Important 2) : un AUTRE processus
		   qui tient la source ouverte sans `FILE_SHARE_DELETE` (OneDrive, un
		   antivirus, un éditeur) laisse `link` réussir puis fait échouer cet
		   `unlink` — sans rattrapage, la source ET la cible existaient toutes
		   les deux, un doublon silencieux. `retirerSourceApresPose` retire alors
		   le lien qu'on vient de poser (s'il porte encore le même `ino`/`dev`
		   que `de`) avant de relancer ; une source déjà partie, elle, est un
		   succès. */
		await retirerSourceApresPose(de, vers, true);
	}

	return primitives;
}
