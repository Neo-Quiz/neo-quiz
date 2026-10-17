import { currentHost } from "../host/current";
import type { DirEntry } from "../host/types";

/* ══════════════════════════════════════════════════════════
   LE CONTENU D'UN DOSSIER — documents, notes, liens

   Ce qu'un dossier de cours contient en plus de ses quiz (référence
   StudySmarter, capture Ahmed 2026-09-17) : les DOCUMENTS (PDF, images, tout
   ce qui n'est pas une note), les NOTES (les `.md` qui ne sont pas des quiz)
   et les LIENS (des URL). Les trois sections de la page d'un dossier en
   vivent, et « Créer avec l'IA » depuis ce dossier joint les deux premières.

   LES LIENS VIVENT DANS UNE NOTE, `Liens.md`, une puce par lien — décision
   d'Ahmed du 2026-09-17. C'est la promesse « des fichiers dans un dossier »
   tenue jusqu'au bout : la liste se lit dans Obsidian, se partage avec le
   dossier, survit à une réinstallation. Les réglages de l'application, eux,
   sont propres à une machine. La note est EXCLUE des notes de la section
   « Notes » : elle est la section « Liens ».

   Les fonctions de TRI et de FORMAT sont pures (`npm run check:folder-
   contents`) ; seules `lireContenuDossier` et `ajouterLien` touchent l'hôte.
══════════════════════════════════════════════════════════ */

export const LIENS_NOTE = "Liens.md";
/** The links of the matching Moodle course, WRITTEN BY THE APP (2026-10-17):
    on disk so that the AI working in the folder reads them like the rest, and
    the phone gets them through the sync. Rewritten only when they change;
    shown in the Links tab, never in Notes, never removable from there. */
export const LIENS_MOODLE_NOTE = "Liens Moodle.md";

export interface LienDossier {
	url: string;
	/** Le texte du lien, ou l'URL elle-même faute de titre. */
	title: string;
}

export interface ContenuDossier {
	documents: DirEntry[];
	notes: DirEntry[];
	liens: LienDossier[];
	/** L'entrée de `Liens.md` si elle existe — pour l'ouvrir, pas pour la lister. */
	liensNote: DirEntry | null;
	/** The links of `Liens Moodle.md` (see `LIENS_MOODLE_NOTE`). */
	liensMoodle: LienDossier[];
}

/** Le nom sans son extension : « CM1 - Introduction.pdf » → « CM1 - Introduction ». */
export function nomSansExtension(nom: string): string {
	const point = nom.lastIndexOf(".");
	return point > 0 ? nom.slice(0, point) : nom;
}

/** L'extension en minuscules, sans le point ; chaîne vide s'il n'y en a pas. */
export function extensionDe(nom: string): string {
	const point = nom.lastIndexOf(".");
	return point > 0 ? nom.slice(point + 1).toLowerCase() : "";
}

/**
 * Répartit les entrées d'un dossier. PURE : `estQuiz` est la seule chose qui
 * vienne d'ailleurs (le catalogue), et c'est l'appelant qui la fournit.
 *
 * - les sous-dossiers et les fichiers cachés (`.…`) sont ignorés — un
 *   `.neo-quiz/` ou un `.obsidian/` n'est pas un document ;
 * - `Liens.md` est mis à part ;
 * - un `.md` qui est un quiz n'est ni une note ni un document : il est déjà
 *   dans la grille au-dessus ;
 * - tout le reste est un document.
 *
 * Tri par nom, insensible à la casse, pour que la liste ne change pas d'ordre
 * selon le système de fichiers qui l'a rendue.
 */
export function trierContenu(
	entrees: readonly DirEntry[],
	estQuiz: (path: string) => boolean,
): { documents: DirEntry[]; notes: DirEntry[]; liensNote: DirEntry | null; liensMoodleNote: DirEntry | null } {
	const documents: DirEntry[] = [];
	const notes: DirEntry[] = [];
	let liensNote: DirEntry | null = null;
	let liensMoodleNote: DirEntry | null = null;
	for (const e of entrees) {
		if (e.isFolder || e.name.startsWith(".")) continue;
		if (e.name === LIENS_NOTE) { liensNote = e; continue; }
		if (e.name === LIENS_MOODLE_NOTE) { liensMoodleNote = e; continue; }
		if (extensionDe(e.name) === "md") {
			if (!estQuiz(e.path)) notes.push(e);
			continue;
		}
		documents.push(e);
	}
	const parNom = (a: DirEntry, b: DirEntry) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	documents.sort(parNom);
	notes.sort(parNom);
	return { documents, notes, liensNote, liensMoodleNote };
}

/* Une puce « - [titre](url) », une puce « - url », ou une URL nue sur sa
   ligne. Seules les URL `http(s)` comptent : une ligne de texte libre dans la
   note (un titre, un commentaire) n'est pas un lien, et n'est pas perdue non
   plus — `ajouterLien` AJOUTE, il ne réécrit jamais la note. */
const LIGNE_LIEN_TITRE = /^\s*[-*+]?\s*\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)\s*$/i;
const LIGNE_LIEN_NU = /^\s*[-*+]?\s*<?(https?:\/\/\S+?)>?\s*$/i;

export function parseLiens(texte: string): LienDossier[] {
	const liens: LienDossier[] = [];
	for (const brut of String(texte ?? "").split(/\r?\n/)) {
		const titre = brut.match(LIGNE_LIEN_TITRE);
		if (titre) { liens.push({ url: titre[2], title: titre[1].trim() || titre[2] }); continue; }
		const nu = brut.match(LIGNE_LIEN_NU);
		if (nu) liens.push({ url: nu[1], title: nu[1] });
	}
	return liens;
}

/** La ligne qu'`ajouterLien` écrit : toujours la forme titrée, pour qu'une
    relecture dans Obsidian montre un texte cliquable et non une URL brute. */
export function ligneDeLien(lien: LienDossier): string {
	const titre = (lien.title || lien.url).replace(/[\[\]]/g, "");
	return `- [${titre}](${lien.url})`;
}

/** Une URL acceptable pour la note : `http(s)` seulement, et sans blanc — on
    n'écrit pas dans un fichier de l'utilisateur ce qu'un navigateur refuserait. */
export function urlValide(brut: string): string | null {
	const u = String(brut ?? "").trim();
	if (!/^https?:\/\/\S+$/i.test(u)) return null;
	try { new URL(u); } catch { return null; }
	return u;
}

/** Le titre déduit d'une URL faute de mieux : l'hôte sans « www. », ou le
    nom de la vidéo ne se devine pas — ce sera l'hôte. */
export function titreDepuisUrl(url: string): string {
	try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

/** Le contenu du dossier tel que « Créer avec l'IA » le joint : documents et
    notes, dans cet ordre — jamais `Liens.md` (un lien ne se lit pas), jamais
    un quiz (il est déjà dans la grille). PURE. */
export function cheminsAJoindre(contenu: Pick<ContenuDossier, "documents" | "notes">): string[] {
	return [...contenu.documents, ...contenu.notes].map(e => e.path);
}

/** Le contenu du dossier `folder` (chemin du CONTRAT). Un dossier absent ou
    illisible rend trois listes vides plutôt qu'une erreur : la page se rend
    quand même, avec ses trois états vides. */
export async function lireContenuDossier(folder: string, estQuiz: (path: string) => boolean): Promise<ContenuDossier> {
	const host = currentHost();
	let entrees: DirEntry[] = [];
	try { entrees = await host.fs.listDir(folder); } catch { entrees = []; }
	const tri = trierContenu(entrees, estQuiz);
	let liens: LienDossier[] = [];
	if (tri.liensNote) {
		/* `read`, pas `readCached` : la note vient peut-être d'être écrite par
		   `ajouterLien`, et c'est la valeur du DISQUE qu'on affiche. */
		try { liens = parseLiens(await host.fs.read(tri.liensNote.path)); } catch { liens = []; }
	}
	let liensMoodle: LienDossier[] = [];
	if (tri.liensMoodleNote) {
		try { liensMoodle = parseLiens(await host.fs.read(tri.liensMoodleNote.path)); } catch { liensMoodle = []; }
	}
	const { liensMoodleNote: _m, ...reste } = tri;
	return { ...reste, liens, liensMoodle };
}

/** The text of `Liens Moodle.md`: one bullet per link, readable by a person
    and by the AI. A `]` in a title or a `)` in an address would end the
    Markdown link: replaced. PURE. */
export function noteLiensMoodle(liens: readonly LienDossier[]): string {
	const lignes = liens.map(l => `- [${l.title.replace(/[[\]]/g, m => (m === "[" ? "(" : ")")).replace(/\s+/g, " ").trim()}](${l.url.replace(/\)/g, "%29").replace(/\s/g, "%20")})`);
	return `# Moodle\n\n${lignes.join("\n")}\n`;
}

/** Writes `Liens Moodle.md` when its links changed; true when it wrote. An empty
    list writes nothing (the course may just be unreachable right now). */
export async function ecrireLiensMoodle(folder: string, liens: readonly LienDossier[]): Promise<boolean> {
	if (!liens.length) return false;
	const host = currentHost();
	const path = folder ? `${folder}/${LIENS_MOODLE_NOTE}` : LIENS_MOODLE_NOTE;
	const texte = noteLiensMoodle(liens);
	try { if (await host.fs.exists(path) && (await host.fs.read(path)) === texte) return false; } catch { /* rewritten below */ }
	await host.fs.write(path, texte);
	return true;
}

/** Les lignes de `texte` SANS celles qui portent le lien `url` — et rien
    d'autre ne bouge : un titre, une phrase, une ligne vide restent à leur
    place. PURE. Rend `null` si aucune ligne ne portait ce lien, pour que
    l'appelant n'écrive pas une note identique. */
export function sansLien(texte: string, url: string): string | null {
	const lignes = String(texte ?? "").split(/\r?\n/);
	const gardees = lignes.filter(l => parseLiens(l).every(lien => lien.url !== url));
	if (gardees.length === lignes.length) return null;
	return gardees.join("\n");
}

/** Retire un lien de `Liens.md` (la seule RÉÉCRITURE de la note, et elle ne
    touche que les lignes de ce lien — voir `sansLien`). */
export async function retirerLien(folder: string, url: string): Promise<void> {
	const host = currentHost();
	const path = folder ? `${folder}/${LIENS_NOTE}` : LIENS_NOTE;
	if (!(await host.fs.exists(path))) return;
	const apres = sansLien(await host.fs.read(path), url);
	if (apres !== null) await host.fs.write(path, apres);
}

/** Ajoute un lien à `Liens.md` du dossier (créée si absente). AJOUT en fin de
    note, jamais une réécriture : ce qu'Ahmed y a écrit à la main reste. */
export async function ajouterLien(folder: string, lien: LienDossier): Promise<void> {
	const host = currentHost();
	const path = folder ? `${folder}/${LIENS_NOTE}` : LIENS_NOTE;
	let texte = "";
	if (await host.fs.exists(path)) {
		try { texte = await host.fs.read(path); } catch { texte = ""; }
	}
	const fin = texte.length === 0 || texte.endsWith("\n") ? "" : "\n";
	await host.fs.write(path, texte + fin + ligneDeLien(lien) + "\n");
}
