/* ══════════════════════════════════════════════════════════
   L'INDEX EN MÉMOIRE ET LE SURVEILLANT DÉBOUNCÉ, CÔTÉ PROCESSUS PRINCIPAL

   Tâche 2 de la migration Tauri → Electron
   (docs/superpowers/plans/2026-09-11-migration-electron.md). Consomme
   `creerFichiers()` et `stat()` de `./fichiers` (tâche 1), et les deux
   fonctions PURES de `./catalogue` (tâche 2 — voir l'en-tête de ce module
   pour pourquoi elles n'y sont pas restées à l'intérieur de CE fichier-ci).

   POURQUOI CHOKIDAR : `fs.watch` récursif est notoirement inégal sous Windows
   (doublons, événements manquants). Chokidar est la bibliothèque que
   l'écosystème emploie pour ça depuis dix ans.

   RÈGLE DE CHEMINS : ce module ne connaît PAS `CarteRacines` (qui vit côté
   rendu, dans `apps/windows/src/host/roots.ts`, et ne bouge pas). Il reçoit
   une simple liste de racines ABSOLUES et fabrique lui-même des chemins de la
   forme CONTRAT que `horsCatalogue`/`evenementDeRenommage` attendent : le
   PREMIER segment est l'INDICE de la racine dans le tableau reçu (« 0 »,
   « 1 »…), jamais un chemin réel — ces deux fonctions ne regardent que la
   FORME du premier segment (un identifiant, quel qu'il soit), jamais son
   contenu. La tâche 3 (pont IPC) choisira ce que le rendu voit réellement
   passer ; ce n'est pas à cette tâche de l'anticiper.
══════════════════════════════════════════════════════════ */

import { watch } from "chokidar";
import type { Stats } from "node:fs";
import * as path from "node:path";
import { LOG_PREFIX } from "../../../src/branding";
import type { HostFile, HostFileEvent } from "../../../src/host/types";
import { dossierHorsCatalogue, evenementDeRenommageDossier, horsCatalogue } from "./catalogue";
import { creerFichiers, stat } from "./fichiers";
/* `normaliser` vient de `./parcours`, la copie du PRINCIPAL : ce module en
   gardait une deuxième, octet pour octet, sans qu'aucune frontière ne le
   justifie (les deux tirent `node:fs` ; revue finale, M3). Deux copies d'une
   même règle dans un même processus finissent par diverger, et la divergence
   ferait tomber les événements du surveillant dans le vide. */
import { listerRacine, normaliser } from "./parcours";

/**
 * Ce qu'un renommage de DOSSIER, apparié, doit pousser vers le rendu — tâche
 * 5. `from`/`to` sont des chemins du CONTRAT (l'indice de racine en tête,
 * comme le reste de ce module) : c'est `canaux.ts` qui les retraduit en
 * absolu avant de franchir le pont, exactement comme il le fait déjà pour
 * `create`/`modify`/`delete`.
 */
export interface EvenementRenommageDossier {
	kind: "renameDir";
	from: string;
	to: string;
}

/** Ce que `surveiller` peut pousser : un événement de FICHIER (`HostFileEvent`,
    jamais `rename` — voir sa doc), ou un renommage de DOSSIER apparié. */
export type EvenementSurveillant = HostFileEvent | EvenementRenommageDossier;

/**
 * Ce que `surveiller` rend : une fonction D'ARRÊT, comme avant — tout appelant
 * de production (`canaux.ts`) continue de l'appeler comme une simple
 * `() => void`, ce qui reste valide (une fonction porteuse d'une propriété
 * supplémentaire est toujours assignable à `() => void`).
 *
 * `getWatched`, ajouté en PLUS pour cette tâche : le SEUL moyen de prouver,
 * dans `check-electron-index.mjs`, qu'un dossier ignoré n'est jamais ENTRÉ
 * dans la table interne de chokidar (`watcher.getWatched()`) — pas seulement
 * filtré après coup à la sortie. `surveiller` ne rendait pas son watcher avant
 * cette tâche, et il n'y a aucune autre raison de l'exposer : c'est le minimum
 * qu'un contrôle déterministe demande.
 */
export interface ArreterSurveillance {
	(): void;
	getWatched(): Record<string, string[]>;
}

/** La fenêtre d'appariement d'un renommage de dossier : le temps qu'on laisse
    à un `addDir` pour rejoindre l'`unlinkDir` qui vient de le précéder (ou
    l'inverse — l'ordre entre les deux n'est pas garanti). Fixe et distincte de
    `delayMs` (la stabilisation des ÉCRITURES de fichier, `awaitWriteFinish`) :
    les deux mesurent des choses différentes, et coupler la seconde à zéro
    (comme le fait le cas « delayMs à 0 » du contrôle) ne doit pas désactiver
    l'appariement des dossiers. */
const FENETRE_RENOMMAGE_DOSSIER_MS = 300;

/** What `monter` hands back: an awaitable stop, the `ready` signal, the watch table. */
interface Montage {
	arreter(): Promise<void>;
	pret: Promise<void>;
	getWatched(): Record<string, string[]>;
}

/** L'index en mémoire, plus la surveillance qui le tient à jour. */
export interface Index {
	all(): HostFile[];
	get(chemin: string): HostFile | null;
	apply(ev: HostFileEvent): void;
	/**
	 * Enveloppe `fichiers.write` puis RECALE l'entrée sur ce que le disque dit
	 * MAINTENANT, sans attendre le surveillant — c'est la promesse du contrat
	 * (`src/host/types.ts`, « LA FRAÎCHEUR APRÈS UNE ÉCRITURE ») : au retour
	 * de `write`, `get(chemin)` doit rendre le `mtime` NEUF. Sans ce recalage,
	 * l'index n'apprendrait le changement que du surveillant, débouncé —
	 * exactement le défaut mesuré côté Tauri (6000 vs 1000, voir
	 * `apps/windows/src/host/fs.ts`) qui produisait une Notice « modifié
	 * dehors » mensongère après chaque sauvegarde. `fichiers.ts` ne connaît
	 * pas l'index : c'est forcément CE module, qui connaît les deux, qui fait
	 * le lien — deux voies possibles, celle-ci (l'index enveloppe l'écriture)
	 * plutôt qu'un recalage optimiste avant même que l'écriture ait réussi.
	 */
	write(chemin: string, donnees: string): Promise<void>;
	/**
	 * Démarre la surveillance de TOUTES les racines et abonne `onEvenement`.
	 * `delayMs` est le délai de stabilité de chokidar (`awaitWriteFinish`) :
	 * un éditeur écrit souvent une note en plusieurs passes rapprochées, et
	 * sans délai chaque passe repeindrait sa propre notification. Rend une
	 * fonction qui ARRÊTE VRAIMENT l'écoute (ferme le watcher chokidar, et
	 * annule la minuterie d'appariement des dossiers avec lui — tâche 5) :
	 * sinon chaque remontage de fenêtre fuit un observateur.
	 *
	 * `onEvenement` peut aussi recevoir un renommage de DOSSIER apparié — voir
	 * `EvenementRenommageDossier` : il est PORTÉ, jamais deviné (tâche 5,
	 * `evenementDeRenommageDossier`).
	 */
	surveiller(onEvenement: (ev: EvenementSurveillant) => void, delayMs?: number): ArreterSurveillance;
	/**
	 * Runs `fn` while the file watcher is fully CLOSED (every OS directory
	 * handle released), then restarts it on the same roots and reconciles the
	 * index with the disk: entries gone emit `delete`, new ones `create`, a
	 * changed `.md` mtime `modify`; unchanged entries emit nothing (the restart
	 * does not re-announce every file).
	 *
	 * WHY: chokidar keeps one OS handle per watched directory, and Windows
	 * refuses to rename a directory while a handle is open on it or on any
	 * descendant (EPERM). `watcher.unwatch(dir)` does not release them; only
	 * `close()` does. A folder move therefore has to run inside this.
	 *
	 * Without a running watcher `fn` runs directly. If `fn` throws, the watcher
	 * is restarted anyway and the error is rethrown. Concurrent calls are
	 * serialised. Pairing a moved folder into a `renameDir` event is NOT done
	 * here: the reconciliation only sees files, so a move surfaces as
	 * `delete`s then `create`s (the caller that moved the folder already
	 * transposes review history and stats by prefix).
	 */
	suspendre<T>(fn: () => Promise<T>): Promise<T>;
}

/** Le `HostFile` d'un chemin déjà au format contrat (indice de racine en
    tête). Même découpe que `toHostFile` de l'hôte du rendu : un point de TÊTE
    de nom n'est pas une extension (« .gitignore »). */
function toHostFile(cheminContrat: string, mtime: number, ctime?: number): HostFile {
	const p = normaliser(cheminContrat);
	const name = p.split("/").pop() || p;
	const point = name.lastIndexOf(".");
	return {
		path: p,
		name,
		basename: point > 0 ? name.slice(0, point) : name,
		extension: point > 0 ? name.slice(point + 1) : "",
		mtime,
		...(ctime ? { ctime } : {}),
	};
}

/**
 * Le chemin du contrat correspondant à un chemin ABSOLU du disque, ou `null`
 * s'il ne tombe sous AUCUNE des racines données — le surveillant est borné à
 * ces racines, jamais à leur dossier parent.
 *
 * EXPORTÉE, en dehors de `creerIndex`, pour être ÉPROUVÉE DIRECTEMENT : c'est
 * ce garde-fou (et lui seul) qui décide qu'un chemin hors racine ne doit rien
 * produire. Un cas qui passerait par `surveiller()` pour l'atteindre
 * n'éprouverait en réalité que la promesse de chokidar de ne surveiller que ce
 * qu'on lui donne (`watch(racinesAbs, …)`) — jamais ce garde-fou lui-même,
 * puisqu'un chemin hors racine n'atteint alors jamais cette fonction. Voir
 * `scripts/check-electron-index.mjs`, cas « contratDepuisAbsolu rend null hors
 * de toute racine », et la ronde de correction qui l'a exigé.
 */
export function contratDepuisAbsolu(racinesAbs: string[], absolu: string): string | null {
	const a = normaliser(absolu);
	for (let i = 0; i < racinesAbs.length; i++) {
		const base = normaliser(racinesAbs[i]);
		if (a.toLowerCase() === base.toLowerCase()) return String(i);
		if (a.toLowerCase().startsWith(base.toLowerCase() + "/")) {
			return `${i}/${a.slice(base.length + 1)}`;
		}
	}
	return null;
}

/**
 * Le chemin ABSOLU disque d'un chemin du contrat (indice de racine en tête),
 * ou `null` si cet indice ne désigne aucune racine connue. L'exact symétrique
 * de `contratDepuisAbsolu` ci-dessus.
 *
 * EXPORTÉE, en dehors de `creerIndex`, pour la même raison que sa jumelle mais
 * avec un appelant de plus : le pont de la tâche 3 (`main.ts`) ne fait jamais
 * franchir l'IPC à la convention INTERNE de ce module (« 0/Cours/ch1.md ») —
 * il retraduit en absolu chaque événement qu'il émet, parce que les chemins du
 * CONTRAT sont les clés du journal de révision et que `src/host/types.ts`
 * interdit qu'un second endroit les recompose. Sans cet export, cette règle
 * serait RECOPIÉE là-bas, et deux copies d'une même règle ont déjà divergé une
 * fois dans ce dépôt.
 */
export function absoluDepuisContrat(racinesAbs: string[], cheminContrat: string): string | null {
	const barre = cheminContrat.indexOf("/");
	const idStr = barre === -1 ? cheminContrat : cheminContrat.slice(0, barre);
	const i = Number(idStr);
	if (!Number.isInteger(i) || i < 0 || i >= racinesAbs.length) return null;
	const relatif = barre === -1 ? "" : cheminContrat.slice(barre + 1);
	return relatif ? path.join(racinesAbs[i], relatif) : racinesAbs[i];
}

/**
 * Traduit un renommage de DOSSIER apparié (chemins du CONTRAT, l'indice de
 * racine en tête) en ses deux chemins ABSOLUS — ce que `canaux.ts` pousse
 * ensuite vers le pont. `null` si l'un des deux ne désigne aucune racine
 * connue (ne devrait pas arriver : `evenementDeRenommageDossier` n'a reçu que
 * des chemins déjà produits par `contratDepuisAbsolu`, mais un défaut
 * silencieux d'un côté ne doit pas fabriquer un chemin absolu inventé de
 * l'autre).
 *
 * PURE : `absoluDepuisContrat` et `normaliser`, toutes deux déjà de ce
 * module — c'est ce qui la rend éprouvable par discriminance, ICI, plutôt
 * que dans `canaux.ts`, qui importe `electron` et qu'aucun harnais ne peut
 * charger (voir `check-electron-index.mjs`, qui charge CE module).
 */
export function renameDirVersAbsolu(
	racinesAbs: string[],
	ev: EvenementRenommageDossier,
): { fromAbs: string; toAbs: string } | null {
	const fromAbs = absoluDepuisContrat(racinesAbs, ev.from);
	const toAbs = absoluDepuisContrat(racinesAbs, ev.to);
	if (!fromAbs || !toAbs) return null;
	return { fromAbs: normaliser(fromAbs), toAbs: normaliser(toAbs) };
}

/** Construit l'index en mémoire pour ces racines (chemins ABSOLUS du disque).
    Démarre VIDE : c'est `surveiller()` (via le parcours initial de chokidar,
    `ignoreInitial: false`) qui le peuple — voir l'en-tête pour pourquoi ce
    module ne fait pas lui-même un parcours disque séparé. Une `Map` et pas un
    tableau : `get` est appelé par chemin, et un balayage linéaire d'un vault
    de milliers de fichiers se paierait à chaque rendu. */
export function creerIndex(racines: string[]): Index {
	const racinesAbs = racines.map(normaliser);
	const parChemin = new Map<string, HostFile>();
	const fichiers = creerFichiers();

	function apply(ev: HostFileEvent): void {
		switch (ev.kind) {
			case "create":
			case "modify":
				// La même écriture pour les deux : `set` remplace l'entrée, donc une
				// modification met la date à jour sans jamais dupliquer.
				parChemin.set(ev.file.path, ev.file);
				return;
			case "delete":
				parChemin.delete(ev.path);
				return;
			case "rename":
				// Les DEUX opérations, dans cet ordre — oublier le `delete` laisserait
				// un quiz fantôme, que plus aucun fichier ne peut mettre à jour.
				parChemin.delete(ev.oldPath);
				parChemin.set(ev.file.path, ev.file);
				return;
		}
	}

	/** RECALE l'entrée d'un chemin sur ce que le disque dit MAINTENANT — voir
	    la doc de `Index.write`. Un `stat` qui échoue ne fait PAS échouer
	    l'écriture qui vient de réussir : le surveillant recalera plus tard,
	    c'est la seule fenêtre où la promesse peut ne pas être tenue. */
	async function recaler(cheminContrat: string): Promise<void> {
		if (horsCatalogue(cheminContrat)) return;
		const absolu = absoluDepuisContrat(racinesAbs, cheminContrat);
		if (!absolu) return;
		const info = await stat(absolu);
		if (!info) return;
		const file = toHostFile(cheminContrat, info.mtime, info.ctime);
		apply(parChemin.has(cheminContrat) ? { kind: "modify", file } : { kind: "create", file });
	}

	/** One chokidar watcher on every root. `ignoreInitial` true is the RESTART
	    after `suspendre`: nothing is re-announced, `reconcilier` diffs the disk
	    against the index instead. */
	function monter(onEvenement: (ev: EvenementSurveillant) => void, delayMs: number, ignoreInitial: boolean): Montage {
		/**
		 * La fonction `ignored` de chokidar : ce chemin doit-il rester HORS du
		 * crawl ET de la surveillance — pas seulement filtré après coup ? Sans
		 * elle, chokidar crawle et pose un watcher OS sur `.git/`, `.obsidian/`,
		 * `node_modules/` et tout leur contenu, alors que `horsCatalogue` les
		 * écarte de toute façon ensuite : c'est ce crawl, dans le processus
		 * PRINCIPAL, qui le rend sourd à l'IPC pendant tout son déroulement.
		 *
		 * Chokidar 5 a retiré les globs : `ignored` est une fonction qui reçoit
		 * un chemin ABSOLU natif (`\` sous Windows) et, TANTÔT SEULEMENT, ses
		 * `stats` — chokidar refait un premier appel sans elles sur un chemin
		 * déjà tranché ailleurs AVEC elles (son propre crawl les a déjà). Ne
		 * jamais s'appuyer sur `stats` pour distinguer un fichier d'un dossier
		 * dans le cas général ; sans elles, ne rien ignorer ici ne laisse rien
		 * passer qui ne sera pas rejugé juste après, stats en main.
		 *
		 * PIÈGE, et c'est le point important : la règle porte sur le chemin
		 * RELATIF à la racine surveillée (`contratDepuisAbsolu`), JAMAIS sur
		 * l'absolu entier — un vault peut vivre sous un dossier caché
		 * (`C:\Users\X\.mes-vaults\Personal`) ; tester tous les segments de
		 * l'absolu ignorerait alors la racine elle-même et couperait TOUT
		 * événement, en silence.
		 *
		 * RÉUTILISE `dossierHorsCatalogue` (dossiers) / `horsCatalogue`
		 * (fichiers) de `catalogue.ts` — jamais une recopie de leur règle : deux
		 * copies divergeraient en silence, comme l'en-tête de ce fichier le
		 * rappelle déjà pour `normaliser`.
		 *
		 * CHOIX — un FICHIER caché directement sous une racine
		 * (`racine/.gitignore`, `racine/.note.md`) reste SURVEILLÉ :
		 * `horsCatalogue` ne teste que les segments INTERMÉDIAIRES d'un chemin de
		 * fichier, jamais son propre nom, et `parcours.ts` (le parcours initial
		 * qui hydrate le rendu) ne l'exclut pas non plus — il n'écarte que les
		 * DOSSIERS (`dossierIgnore` n'y est appliqué qu'à `entree.isDirectory()`).
		 * L'exclure ICI ferait diverger le surveillant du parcours initial : un
		 * fichier listé au démarrage dont plus aucune modification ne serait
		 * jamais rapportée, en silence. Un DOSSIER caché/`node_modules` est donc
		 * écarté sur son propre nom ; un FICHIER ne l'est que par un dossier
		 * ignoré sur son chemin, jamais par son propre nom.
		 */
		function ignorerChemin(absolu: string, stats?: Stats): boolean {
			const chemin = contratDepuisAbsolu(racinesAbs, absolu);
			// `null` : hors de toute racine — ne devrait jamais arriver, chokidar ne
			// présente que ce qu'il trouve SOUS `racinesAbs` (voir le cas « le
			// surveillant n'est monté que sur les racines qu'on lui donne » du
			// contrôle) ; chemin réduit à l'indice (ex. « 0 ») : la racine
			// elle-même, jamais ignorée.
			if (chemin === null || !chemin.includes("/")) return false;
			if (!stats) return false;
			return stats.isDirectory() ? dossierHorsCatalogue(chemin) : horsCatalogue(chemin);
		}

		const watcher = watch(racinesAbs, {
			ignoreInitial,
			ignored: ignorerChemin,
			// `false` et non `{ stabilityThreshold: 0, … }` : chokidar traite un
			// seuil de zéro comme « toujours instable » sur certains systèmes de
			// fichiers, alors que `false` désactive proprement l'attente — c'est
			// la rupture du cas « delayMs à 0 » du contrôle.
			awaitWriteFinish: delayMs > 0
				? { stabilityThreshold: delayMs, pollInterval: Math.min(50, delayMs) }
				: false,
		});

		/* Un `add`/`change` a besoin du `mtime` NEUF : chokidar ne le porte pas
		   lui-même dans ces événements de façon fiable sur tous les systèmes de
		   fichiers, donc on repasse par `stat` (la même primitive que
		   `recaler`) plutôt que de lui faire confiance. */
		function surFichier(kind: "create" | "modify", absolu: string): void {
			const chemin = contratDepuisAbsolu(racinesAbs, absolu);
			if (chemin === null || horsCatalogue(chemin)) return;
			void stat(absolu).then(info => {
				if (!info) return; // disparu entre l'événement et le `stat`.
				const file = toHostFile(chemin, info.mtime, info.ctime);
				const ev: HostFileEvent = { kind, file };
				apply(ev);
				onEvenement(ev);
			});
		}

		function surSuppression(absolu: string): void {
			const chemin = contratDepuisAbsolu(racinesAbs, absolu);
			if (chemin === null || horsCatalogue(chemin)) return;
			// Garde : ne pas annoncer la suppression d'un fichier qui n'a jamais
			// été au catalogue (un `.tmp` d'éditeur, par exemple) — même règle
			// que la réconciliation Tauri.
			if (!parChemin.has(chemin)) return;
			const ev: HostFileEvent = { kind: "delete", path: chemin };
			apply(ev);
			onEvenement(ev);
		}

		watcher.on("add", p => surFichier("create", p));
		watcher.on("change", p => surFichier("modify", p));
		watcher.on("unlink", surSuppression);

		/* ─── l'appariement d'un renommage de DOSSIER — tâche 5 ───

		   Chokidar remonte `unlinkDir` et `addDir` séparément, sans jamais
		   les lier. On les ACCUMULE dans une fenêtre fixe
		   (`FENETRE_RENOMMAGE_DOSSIER_MS`, distincte de `delayMs` — voir sa
		   doc), puis on demande à `evenementDeRenommageDossier` (PURE, dans
		   `catalogue.ts`) si la paire est CERTAINE. Rien n'est deviné ici :
		   toute la décision vit dans cette fonction, ce module ne fait que
		   lui fournir sa fenêtre. */
		let dossiersSupprimes: string[] = [];
		let dossiersCrees: string[] = [];
		let minuterieDossier: ReturnType<typeof setTimeout> | null = null;

		function planifierAppariement(): void {
			if (minuterieDossier) clearTimeout(minuterieDossier);
			minuterieDossier = setTimeout(() => {
				minuterieDossier = null;
				const supprimes = dossiersSupprimes;
				const crees = dossiersCrees;
				dossiersSupprimes = [];
				dossiersCrees = [];
				const paire = evenementDeRenommageDossier(supprimes, crees);
				if (paire) onEvenement({ kind: "renameDir", from: paire.from, to: paire.to });
			}, FENETRE_RENOMMAGE_DOSSIER_MS);
		}

		watcher.on("unlinkDir", absolu => {
			const chemin = contratDepuisAbsolu(racinesAbs, absolu);
			// FILTRÉ ICI, pas seulement dans la règle pure : un vault porte des
			// centaines de sous-dossiers `.git`/`node_modules` que le parcours
			// initial de chokidar (`ignoreInitial: false`) traverse aussi pour
			// les DOSSIERS (rien ne les en exclut, à la différence des fichiers
			// qui passent par `horsCatalogue` avant d'atteindre `onEvenement`) ;
			// les laisser entrer dans la fenêtre ajouterait des candidats
			// fantômes qui feraient échouer l'appariement d'un renommage
			// pourtant univoque ailleurs dans le vault.
			if (chemin === null || dossierHorsCatalogue(chemin)) return;
			dossiersSupprimes.push(chemin);
			planifierAppariement();
		});
		watcher.on("addDir", absolu => {
			const chemin = contratDepuisAbsolu(racinesAbs, absolu);
			if (chemin === null || dossierHorsCatalogue(chemin)) return;
			dossiersCrees.push(chemin);
			planifierAppariement();
		});

		let arretee = false;
		/* Awaits `close()`: only once it resolves are the OS directory handles
		   really released, which `suspendre` relies on before it lets a folder
		   rename run. */
		async function arreter(): Promise<void> {
			if (arretee) return;
			arretee = true;
			if (minuterieDossier) clearTimeout(minuterieDossier);
			await watcher.close();
		}
		const pret = new Promise<void>(resolve => { watcher.once("ready", () => resolve()); });
		return { arreter, pret, getWatched: () => watcher.getWatched() };
	}

	/** The running subscription, so `suspendre` can restart it after closing it. */
	let courant: {
		onEvenement: (ev: EvenementSurveillant) => void;
		delayMs: number;
		monte: Montage | null;
		arretee: boolean;
	} | null = null;

	/** Diffs the disk against the index and emits what changed while the
	    watcher was closed. Same filters as the watcher (`horsCatalogue`). */
	async function reconcilier(onEvenement: (ev: EvenementSurveillant) => void): Promise<void> {
		const surDisque = new Map<string, { mtime: number; ctime: number }>();
		for (let i = 0; i < racinesAbs.length; i++) {
			for (const entree of await listerRacine(racinesAbs[i])) {
				const chemin = contratDepuisAbsolu(racinesAbs, entree.chemin);
				if (chemin === null || horsCatalogue(chemin)) continue;
				surDisque.set(chemin, { mtime: entree.mtime, ctime: entree.ctime ?? 0 });
			}
		}
		for (const chemin of [...parChemin.keys()]) {
			if (surDisque.has(chemin)) continue;
			const ev: HostFileEvent = { kind: "delete", path: chemin };
			apply(ev);
			onEvenement(ev);
		}
		for (const [chemin, { mtime, ctime }] of surDisque) {
			const connu = parChemin.get(chemin);
			// `mtime` is 0 for non-`.md` files (the walk does not stat them): an
			// unknown date never counts as a change.
			if (connu && (mtime === 0 || mtime === connu.mtime)) continue;
			const file = toHostFile(chemin, mtime, ctime);
			const ev: HostFileEvent = { kind: connu ? "modify" : "create", file };
			apply(ev);
			onEvenement(ev);
		}
	}

	async function executerSuspendu<T>(fn: () => Promise<T>): Promise<T> {
		const ecoute = courant;
		if (!ecoute || !ecoute.monte) return fn();
		const ancien = ecoute.monte;
		ecoute.monte = null;
		await ancien.arreter();
		try {
			return await fn();
		} finally {
			// Restart even when `fn` threw, unless the caller stopped the
			// subscription meanwhile.
			if (!ecoute.arretee) {
				const neuf = monter(ecoute.onEvenement, ecoute.delayMs, true);
				ecoute.monte = neuf;
				try {
					await neuf.pret;
					await reconcilier(ecoute.onEvenement);
				} catch (e) {
					// Must not mask the error of `fn`; the next watcher events recalibrate.
					console.warn(LOG_PREFIX, "index reconciliation failed after a suspension:", e);
				}
			}
		}
	}
	let fileSuspension: Promise<unknown> = Promise.resolve();

	return {
		all() {
			return [...parChemin.values()];
		},
		get(chemin) {
			return parChemin.get(normaliser(chemin)) ?? null;
		},
		apply,
		async write(chemin, donnees) {
			const absolu = absoluDepuisContrat(racinesAbs, chemin);
			if (!absolu) throw new Error(`chemin hors des racines surveillées : ${chemin}`);
			await fichiers.write(absolu, donnees);
			await recaler(chemin);
		},
		surveiller(onEvenement, delayMs = 300) {
			if (racinesAbs.length === 0) {
				return Object.assign(() => {}, { getWatched: () => ({}) as Record<string, string[]> });
			}
			const ecoute = { onEvenement, delayMs, monte: monter(onEvenement, delayMs, false) as Montage | null, arretee: false };
			courant = ecoute;
			const arreter = (): void => {
				if (ecoute.arretee) return;
				ecoute.arretee = true;
				if (courant === ecoute) courant = null;
				void ecoute.monte?.arreter();
			};
			// `getWatched` is grafted on the stop function: see `ArreterSurveillance`.
			return Object.assign(arreter, { getWatched: () => ecoute.monte?.getWatched() ?? {} });
		},
		suspendre(fn) {
			const course = fileSuspension.then(() => executerSuspendu(fn));
			fileSuspension = course.then(() => undefined, () => undefined);
			return course;
		},
	};
}
