import { currentHost } from "../host/current";
import type { DirEntry, HostFile } from "../host/types";
import { fuzzyMatch } from "../text-search";

/* Une entrée listable dans le picker de mentions. Le picker ne connaît que
   ce type : d'où vient l'entrée (vault, disque) ne le regarde pas. */
export interface FileEntry {
	/** Nom affiché : « TD3.md », « Cours ». */
	name: string;
	/** Vault → chemin relatif au vault. Externe → chemin relatif à la racine
	    configurée, PRÉFIXÉ par le nom de cette racine (ex.
	    « Downloads/pdf/TD3.pdf ») — symétrique du vault, jamais de chemin
	    absolu ici. `resolveExternalPath` fait l'inverse (relatif → absolu),
	    à appeler juste avant tout accès disque ou tout appel de callback. */
	path: string;
	isFolder: boolean;
	source: "vault" | "external";
}

/* Formats que le composer sait réellement attacher (cf. addComposerFiles
   dans ai.ts : images → vision, PDF → texte extrait, texte → chip).
   Tout le reste est masqué : ne jamais proposer ce qu'on refusera. */
const TEXT_EXT = ["md", "txt", "csv", "json", "yaml", "yml", "xml", "html", "css", "js", "ts"];
const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"];
/* Exporté : `prompt-paths.ts` en dérive sa détection d'extensions dans le
   texte du composer. Une seule liste, sinon un format attachable ici
   resterait invisible là-bas (et l'utilisateur verrait son chemin ignoré
   sans savoir pourquoi). */
export const ATTACHABLE_EXT = new Set([...TEXT_EXT, ...IMAGE_EXT, "pdf"]);

export function isAttachable(name: string): boolean {
	const i = name.lastIndexOf(".");
	if (i < 0) return false;
	return ATTACHABLE_EXT.has(name.slice(i + 1).toLowerCase());
}

/* What the « @ » picker SUGGESTS: the documents a quiz is made from (notes, text,
   PDFs) and images. `ATTACHABLE_EXT` stays wider, for a path TYPED in the
   composer, but a script or a stylesheet is never a source to offer
   (`@Tests` suggested `valorantRefresh.js`). */
const PICKABLE_EXT = new Set(["md", "txt", "pdf", ...IMAGE_EXT]);

export function isPickable(name: string): boolean {
	const i = name.lastIndexOf(".");
	return i >= 0 && PICKABLE_EXT.has(name.slice(i + 1).toLowerCase());
}

/** The words of a file or folder name, lower case and without accents: split on
    anything that is not a letter or digit and on camelCase, the extension left
    out (« valorantRefresh.js » → valorant, refresh). */
export function nameWords(name: string, isFolder: boolean): string[] {
	const dot = name.lastIndexOf(".");
	const bare = !isFolder && dot > 0 ? name.slice(0, dot) : name;
	return bare.normalize("NFD").replace(/\p{M}/gu, "")
		.replace(/(\p{Ll}|\d)(\p{Lu})/gu, "$1 $2")
		.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Does `query` pick this entry? Every word typed must OPEN a word of its NAME:
    « tests » finds « Tests », never « stw-storm-shard.png » or a file that only
    has the letters scattered along its path. A typed « dir/ » part must be a
    folder somewhere in the path. */
export function matchesName(entry: FileEntry, query: string): boolean {
	const cut = query.lastIndexOf("/");
	const dir = cut < 0 ? "" : query.slice(0, cut).toLowerCase();
	if (dir && !entry.path.toLowerCase().includes(dir + "/")) return false;
	const typed = nameWords(query.slice(cut + 1), true);
	if (!typed.length) return true;
	const words = nameWords(entry.name, entry.isFolder);
	return typed.every(w => words.some(n => n.startsWith(w)));
}

/* Tri de la référence (capture Claude Code) : fichiers et dossiers
   MÉLANGÉS, alphabétique insensible à la casse. Pas de dossiers d'abord. */
function compareEntries(a: FileEntry, b: FileEntry): number {
	return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function toVaultEntry(e: DirEntry): FileEntry {
	return { name: e.name, path: e.path, isFolder: e.isFolder, source: "vault" };
}

/* Contenu d'un dossier du vault. folderPath vide → racine.
   Par `host.fs.listDir`, la seule voie du contrat qui nomme les
   SOUS-DOSSIERS : `list` ne rend que les fichiers, et la navigation du
   sélecteur (« @Cours/ ») descend précisément dans les dossiers. Un dossier
   absent rend `[]`, comme le contrat le promet. */
export async function listVaultFolder(folderPath: string): Promise<FileEntry[]> {
	const entrees = await currentHost().fs.listDir(folderPath);
	return entrees
		.filter(e => e.isFolder || isPickable(e.name))
		.map(toVaultEntry)
		.sort(compareEntries);
}

/** Vrai si `folderPath` est un dossier RÉEL du vault. `listDir` rend `[]` pour
    un dossier absent, hors des racines (« @Downloads/ » : une racine EXTERNE,
    que l'appelant essaie ensuite) comme pour un dossier vide : c'est `getFile` qui
    tranche l'autre moitié (un fichier n'est pas un dossier), et un dossier
    vide reste un dossier — on y descend, et on n'y trouve rien. */
export async function isVaultFolder(folderPath: string): Promise<boolean> {
	const fs = currentHost().fs;
	if (fs.getFile(folderPath)) return false;
	if ((await fs.listDir(folderPath)).length > 0) return true;
	/* Vide ou absent : le parent le sait. `listDir` du parent nomme ses
	   sous-dossiers, vides compris. */
	const coupe = folderPath.lastIndexOf("/");
	const parent = coupe < 0 ? "" : folderPath.slice(0, coupe);
	const nom = coupe < 0 ? folderPath : folderPath.slice(coupe + 1);
	return (await fs.listDir(parent)).some(e => e.isFolder && e.name === nom);
}

/* ── Racines hors vault (desktop uniquement) ──
   Tout accès au disque hors vault passe par `host.fs.externe`
   (`src/host/types.ts`) : sous Obsidian c'est `fs` de Node, dans
   l'application les canaux BORNÉS du pont — une racine hors périmètre y rend
   `[]`/`null`, jamais une lecture. `isDesktopApp` reste la garde du code
   partagé : sur mobile, l'hôte n'a pas de disque à offrir. */

/** Gardes anti-explosion : un utilisateur peut pointer C:\ ou un dossier de projets. */
const MAX_DEPTH = 8;
const MAX_ENTRIES = 20000;
// .git et .obsidian ne sont PAS listés ici : déjà exclus par le test
// `d.name.startsWith(".")` qui précède systématiquement ce garde (dossiers
// cachés), l'un et l'autre commençant par un point.
const SKIP_DIRS = new Set(["node_modules"]);

interface ExternalIndex { entries: FileEntry[]; mtimeMs: number; truncated: boolean }
/** L'INSTANTANÉ que `searchAll` lit de façon synchrone : rempli par
    `primeExternalIndex` / `revalidateExternalIndex`, jamais par `searchAll`
    lui-même — l'accès disque est asynchrone (le pont, dans l'application), et
    la recherche tourne à chaque frappe. */
const externalCache = new Map<string, ExternalIndex>();
/** Les parcours EN VOL, par racine : deux appelants concurrents (le prime à
    l'ouverture du menu, la revalidation de la première frappe) partagent le
    même parcours au lieu d'en lancer deux. */
const enCours = new Map<string, Promise<ExternalIndex | null>>();

function baseName(p: string): string {
	const norm = p.replace(/[\\/]+$/, "");
	const i = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
	return i < 0 ? norm : norm.slice(i + 1);
}

/** Normalise un chemin de racine externe pour le STOCKAGE (réglage
    `aiMentionExtraFolders`) : séparateurs unifiés en « / », sans séparateur
    final. Sans ça, `C:\...\Downloads` et `C:/.../Downloads` sont vus comme
    deux racines distinctes (double parcours, chaque fichier listé deux fois),
    et une racine saisie avec un séparateur final casse la navigation
    (`dir.startsWith(r + "/")` dans mention-picker.ts ne matche jamais). */
export function normalizeExternalRoot(path: string): string {
	return path.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
}

/** Longueur du préfixe « parent de la racine » à retirer d'un chemin absolu
    pour obtenir le chemin relatif préfixé par le nom de la racine (ex.
    « Downloads/pdf/x.pdf »). */
function rootParentLen(root: string): number {
	const trimmed = root.replace(/[\\/]+$/, "");
	return trimmed.length - baseName(trimmed).length;
}

/** Chemin absolu → chemin relatif (préfixé du nom de la racine). */
function toRelPath(absPath: string, root: string): string {
	return absPath.slice(rootParentLen(root));
}

/** Inverse de `toRelPath` : chemin relatif du picker (« Downloads/pdf ») →
    chemin absolu, en retrouvant la racine configurée dont le nom de base
    préfixe ce chemin. Résolution déterministe : la PREMIÈRE racine qui
    matche (ordre du réglage) l'emporte.
    Ambiguïté connue et non résolue : deux racines de même nom de base (ex.
    « D:/Cours » et « C:/Travail/Cours ») ne sont pas distinguables depuis ce
    chemin relatif seul — la seconde racine devient alors inatteignable en
    tapant, et leurs entrées s'affichent avec un sous-titre identique dans la
    liste (cf. rapport de tâche, doute correspondant).
    Renvoie null si aucune racine ne correspond (dossier hors des racines
    configurées, ou racine retirée entre-temps). */
export function resolveExternalPath(roots: string[], relPath: string): { absPath: string; root: string } | null {
	for (const root of roots) {
		const trimmed = root.replace(/[\\/]+$/, "");
		const label = baseName(trimmed);
		if (relPath === label || relPath.startsWith(label + "/")) {
			return { absPath: trimmed.slice(0, rootParentLen(trimmed)) + relPath, root: trimmed };
		}
	}
	return null;
}

/** Les racines configurées, en entrées listables (fin de la liste initiale). */
export function listExternalRoots(roots: string[]): FileEntry[] {
	if (!currentHost().platform.isDesktopApp) return [];
	return roots.map(r => ({
		name: baseName(r), path: baseName(r), isFolder: true, source: "external" as const,
	}));
}

/** Une entrée du disque, telle que le sélecteur la montre — ou `null` si
    elle est cachée, ignorée, ou d'un format qu'on refuserait d'attacher. La
    MÊME règle pour la navigation (`listExternalFolder`) et le parcours
    (`walk`) : deux copies avaient chacune leur chance de diverger. */
function externalEntryOf(e: DirEntry, root: string): FileEntry | null {
	if (e.name.startsWith(".")) return null;
	if (e.isFolder ? SKIP_DIRS.has(e.name) : !isPickable(e.name)) return null;
	return { name: e.name, path: toRelPath(e.path, root), isFolder: e.isFolder, source: "external" };
}

/** Contenu d'un dossier externe. Lecture du SEUL dossier affiché : le coût
    ne dépend pas de la taille du disque. `root` = la racine configurée dont
    `dirPath` descend, nécessaire pour reconstruire un chemin relatif correct
    même en profondeur (sinon on ne verrait que le nom du dossier courant,
    pas tout le chemin depuis la racine — cf. `walk`). */
export async function listExternalFolder(dirPath: string, root: string): Promise<FileEntry[]> {
	const host = currentHost();
	if (!host.platform.isDesktopApp) return [];
	const entrees = await host.fs.externe.list(dirPath.replace(/[\\/]+$/, ""));
	return entrees
		.map(e => externalEntryOf(e, root))
		.filter((e): e is FileEntry => e !== null)
		.sort(compareEntries);
}

async function walk(root: string): Promise<ExternalIndex> {
	const externe = currentHost().fs.externe;
	const entries: FileEntry[] = [];
	let truncated = false;
	const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
	// Étiquette sur le while : le `break` de la garde MAX_ENTRIES doit sortir
	// des DEUX boucles d'un coup. Un `break` nu ne quitterait que le `for`
	// interne — le `while` reprendrait alors la pile et referait une lecture
	// par dossier déjà empilé, pour re-déclencher aussitôt le même garde :
	// borné, mais du travail disque pour rien.
	outer: while (stack.length) {
		const cur = stack.pop();
		if (!cur) break;
		if (cur.depth > MAX_DEPTH) { truncated = true; continue; }
		// Un dossier illisible rend `[]` par contrat : on passe au suivant.
		const dirents = await externe.list(cur.dir.replace(/[\\/]+$/, ""));
		for (const d of dirents) {
			if (entries.length >= MAX_ENTRIES) { truncated = true; break outer; }
			const entry = externalEntryOf(d, root);
			if (!entry) continue;
			entries.push(entry);
			if (d.isFolder) stack.push({ dir: d.path, depth: cur.depth + 1 });
		}
	}
	const info = await externe.stat(root);
	return { entries, mtimeMs: info?.mtimeMs ?? 0, truncated };
}

/** L'index d'une racine, à jour : réutilisé si le `mtime` de la racine n'a
    pas bougé, reparcouru sinon. `null` si la racine n'existe pas (ou, dans
    l'application, si elle est hors périmètre — `stat` y rend `null`). */
async function indexOf(root: string): Promise<ExternalIndex | null> {
	const host = currentHost();
	if (!host.platform.isDesktopApp) return null;
	const info = await host.fs.externe.stat(root);
	if (!info) return null;
	const hit = externalCache.get(root);
	if (hit && hit.mtimeMs === info.mtimeMs) return hit;
	const deja = enCours.get(root);
	if (deja) return deja;
	const parcours = walk(root)
		.then(fresh => { externalCache.set(root, fresh); return fresh; })
		.finally(() => { enCours.delete(root); });
	enCours.set(root, parcours);
	return parcours;
}

/** Préchauffe l'index (première ouverture du picker) : le vault s'affiche
    tout de suite, le disque se greffe ensuite — l'appelant n'attend cette
    promesse que s'il veut la recherche COMPLÈTE dès la première frappe.
    Vide le cache AVANT de relancer l'indexation. Pourquoi : `externalCache`
    est une Map de MODULE, donc persistante tant que le plugin est chargé, et
    `indexOf` ne réinvalide que si le mtime de la RACINE elle-même a changé.
    Or ajouter un fichier dans un SOUS-dossier (ex. `Downloads/cours/`) met à
    jour le mtime de ce sous-dossier, jamais celui de la racine — sur NTFS
    comme ailleurs. Sans ce clear, un fichier ajouté en profondeur resterait
    invisible à la recherche jusqu'au rechargement du plugin (la navigation,
    elle, n'est pas touchée : `listExternalFolder` lit le disque à chaque
    appel).
    Ne PAS remplacer ce clear par un scan récursif des mtimes de
    sous-dossiers pour décider s'il faut invalider : ce serait aussi coûteux
    que le parcours qu'on cherche à éviter. Le compromis retenu marche parce
    que (a) un parcours complet coûte quelques millisecondes sur un dossier
    réel (mesuré, Node, à chaud : Downloads — 18 entrées, 4 dossiers, < 1 ms ;
    pire cas plausible C:\Users\Ahmed — 12309 entrées, 7383 dossiers, ~158 ms)
    et (b) le contrôle de mtime dans `indexOf` garde tout son intérêt PENDANT
    la frappe : tant que le menu reste OUVERT, chaque frappe
    (`revalidateExternalIndex`, sans passer par ce prime) réutilise l'index
    déjà calculé, sans reclear.
    ATTENTION, ce n'est PAS « un seul clear par session de menu » : choisir un
    dossier FERME le menu (`closeMenu()` dans ui-select.ts tourne avant
    `item.onChoose()`, y compris au clic comme à Entrée/Tab) puis le rouvre
    aussitôt (`refresh` revoit `menu === null`) — donc un clear (et un
    parcours) par NIVEAU de navigation descendu, pas un seul pour toute la
    session. Le coût reste borné (mesures ci-dessus), mais ne pas décrire ce
    comportement comme « un seul clear » : ce projet s'est déjà fait piéger
    par un commentaire qui promettait moins de travail que le code n'en fait
    réellement. Ne pas retirer ce clear pour « optimiser ».
    Un parcours encore EN VOL au moment du clear n'est pas relancé : `indexOf`
    le partage, et son résultat est assez frais pour ce que le clear cherche. */
export async function primeExternalIndex(roots: string[]): Promise<void> {
	if (!currentHost().platform.isDesktopApp) return;
	externalCache.clear();
	await Promise.all(roots.map(r => indexOf(r)));
}

/** La revalidation PENDANT la frappe : le contrôle de mtime d'`indexOf`, sans
    le clear du prime. À attendre avant `searchAll`, qui ne lit que
    l'instantané. */
export async function revalidateExternalIndex(roots: string[]): Promise<void> {
	if (!currentHost().platform.isDesktopApp) return;
	await Promise.all(roots.map(r => indexOf(r)));
}

/** Les dossiers du vault, DÉRIVÉS des chemins de fichiers : chaque préfixe
    d'un chemin est un dossier. Un dossier vide n'y figure pas — il n'a rien à
    attacher (voir `HostFs.listFiles`). */
function vaultFoldersOf(files: HostFile[]): FileEntry[] {
	const chemins = new Set<string>();
	for (const f of files) {
		let coupe = f.path.indexOf("/");
		while (coupe > 0) {
			chemins.add(f.path.slice(0, coupe));
			coupe = f.path.indexOf("/", coupe + 1);
		}
	}
	return [...chemins].map(p => ({ name: baseName(p), path: p, isFolder: true, source: "vault" as const }));
}

/* Recherche fuzzy FUSIONNÉE : vault et racines externes scorés avec le
   MÊME fuzzyMatch(query), puis triés ENSEMBLE par score décroissant.
   Sans fusion (une simple concaténation vault puis externe), un vault de
   plusieurs milliers de fichiers remplit à lui seul la limite d'affichage
   avant que les externes soient pris en compte : un fichier de Downloads ne
   remonterait qu'avec une requête très spécifique — l'intention d'Ahmed
   (« chercher dans TOUT le vault ET TOUT Downloads ») ne serait pas tenue.
   `truncated` nomme les racines externes où une garde a coupé le parcours
   (jamais de troncature silencieuse).
   SYNCHRONE : elle ne lit que l'index en mémoire du vault (`listFiles`) et
   l'instantané des racines externes — c'est `primeExternalIndex` /
   `revalidateExternalIndex` qui le remplissent, avant. Une racine qui n'y est
   pas encore (parcours en vol) n'apparaît simplement pas à cette frappe. */
export function searchAll(roots: string[], query: string): { entries: FileEntry[]; truncated: string[] } {
	const host = currentHost();
	const fuzzy = fuzzyMatch(query);
	const scored: { entry: FileEntry; score: number }[] = [];

	// Vault : chemin complet, toujours global (décision d'Ahmed) — « Cours/ja »
	// matche « Cours/Java/TD3.md » parce que le motif tapé fait simplement
	// partie du chemin, sans notion de périmètre.
	const files = host.fs.listFiles();
	/* Matched on the NAME's words (`matchesName`), then ranked by the fuzzy score
	   of the path as before: the fuzzy match alone finds any subsequence, and a
	   long path always has one. */
	for (const f of files) {
		if (!isPickable(f.name)) continue;
		const entry: FileEntry = { name: f.name, path: f.path, isFolder: false, source: "vault" };
		const r = matchesName(entry, query) && fuzzy(f.path);
		if (r) scored.push({ entry, score: r.score });
	}
	for (const entry of vaultFoldersOf(files)) {
		const r = matchesName(entry, query) && fuzzy(entry.path);
		if (r) scored.push({ entry, score: r.score });
	}

	// Externe (desktop uniquement) : chaque racine configurée, intégralement.
	// `entry.path` (produit par `walk`) est DÉJÀ le chemin relatif préfixé du
	// nom de la racine (« Downloads/x.pdf »), symétrique du chemin relatif du
	// vault — même échelle pour `fuzzyMatch`, pas de biais de préfixe absolu
	// (~25 caractères de bruit de tête sinon, qui handicaperait
	// systématiquement l'externe dans le tri par score commun).
	const truncated: string[] = [];
	if (host.platform.isDesktopApp) {
		for (const root of roots) {
			const idx = externalCache.get(root);
			if (!idx) continue;
			if (idx.truncated) truncated.push(baseName(root));
			for (const entry of idx.entries) {
				const r = matchesName(entry, query) && fuzzy(entry.path);
				if (r) scored.push({ entry, score: r.score });
			}
		}
	}

	scored.sort((a, b) => b.score - a.score);
	return { entries: scored.map(x => x.entry), truncated };
}
