/* ══════════════════════════════════════════════════════════
   LE STYLE D'UNE LECTURE — module PUR (ni hôte, ni DOM, ni i18n)

   Spec : docs/superpowers/specs/2026-09-26-styles-de-lecture-design.md §2.
   Une carte `role: "read"` porte quatre champs OPTIONNELS, clés du format
   (données persistées, jamais traduites) :

     lecture: "page" | "etapes" | "tableau"      (défaut "page")
     etapes:  ["idée 1", "idée 2", …]
     tableau: { colonnes: [...], lignes: [[...], …] }
     retenir: { forme: "cartes" | "recap", items: [...] }

   Ce module est la SEULE lecture de ces champs : le moteur (rendu), l'aperçu
   de l'éditeur et `check:quiz-format` la partagent. Il ne lève jamais : une
   valeur qu'il ne comprend pas retombe sur le comportement d'avant (une page
   sans « À retenir »), parce qu'un modèle qui écrit mal un champ ne doit
   jamais rendre une lecture illisible.

   L'écriture, elle, ne passe PAS par ici : ces clés voyagent par
   `_extraFields` (editor/convert.ts, editor/export.ts), recopiées telles
   qu'elles ont été lues — une valeur inconnue de `lecture` reste dans la
   note, seul son RENDU retombe sur « page ».
══════════════════════════════════════════════════════════ */

export const STYLES_LECTURE = ["page", "etapes", "tableau"] as const;
export type StyleLecture = typeof STYLES_LECTURE[number];

export const FORMES_RETENIR = ["cartes", "recap"] as const;
export type FormeRetenir = typeof FORMES_RETENIR[number];

export interface CarteRetenir { recto: string; verso: string }

export type Retenir =
	| { forme: "cartes"; items: CarteRetenir[] }
	| { forme: "recap"; items: string[] };

export interface TableauLecture { colonnes: string[]; lignes: string[][] }

export interface LectureStylee {
	style: StyleLecture;
	/** Les étapes ÉCRITES (`etapes`), sans les chaînes vides ; vide si absentes. */
	etapes: string[];
	/** Le tableau, RECTANGULAIRE (lignes complétées de cases vides) ; null s'il est absent ou vide. */
	tableau: TableauLecture | null;
	/** « À retenir » valide et non vide ; null sinon. */
	retenir: Retenir | null;
}

type Brut = Record<string, unknown>;

const objet = (v: unknown): v is Brut => !!v && typeof v === "object" && !Array.isArray(v);

/** Une case de texte : une chaîne telle quelle, un nombre écrit, tout le reste vide. */
function cellule(v: unknown): string {
	if (typeof v === "string") return v;
	if (typeof v === "number" && Number.isFinite(v)) return String(v);
	return "";
}

/** Le champ `cle` de l'élément : sur l'élément BRUT d'un bloc (moteur,
    scanner), ou dans `_extraFields` d'une question du BROUILLON de
    l'éditeur (editor/convert.ts l'y range) — la fiche, l'éditeur et
    `src/lecture-etape.ts` lisent des brouillons, et un style qu'ils ne
    verraient pas y compterait une lecture absorbée comme un écran. */
function champ(item: unknown, cle: string): unknown {
	if (!objet(item)) return undefined;
	if (item[cle] !== undefined) return item[cle];
	const extra = item._extraFields;
	return objet(extra) ? extra[cle] : undefined;
}

/** Le style déclaré, `page` pour toute valeur inconnue ou absente. */
export function styleDeLecture(item: unknown): StyleLecture {
	const v = champ(item, "lecture");
	return typeof v === "string" && (STYLES_LECTURE as readonly string[]).includes(v) ? v as StyleLecture : "page";
}

/** Les étapes écrites, sans les entrées vides ou d'un autre type. */
export function etapesDeLecture(item: unknown): string[] {
	const v = champ(item, "etapes");
	if (!Array.isArray(v)) return [];
	return v.filter((e): e is string => typeof e === "string" && e.trim() !== "");
}

/**
 * Le tableau, COMPLÉTÉ : chaque ligne (et l'en-tête) a autant de cases que la
 * plus longue, les manquantes vides — un modèle qui oublie une case ne doit
 * pas décaler toute la ligne (spec §7). Une ligne qui n'est pas un tableau
 * est écartée. `null` sans aucune ligne.
 */
export function tableauDeLecture(item: unknown): TableauLecture | null {
	const v = champ(item, "tableau");
	if (!objet(v)) return null;
	const colonnes = Array.isArray(v.colonnes) ? v.colonnes.map(cellule) : [];
	const lignes = Array.isArray(v.lignes)
		? v.lignes.filter(Array.isArray).map(l => (l as unknown[]).map(cellule))
		: [];
	if (lignes.length === 0) return null;
	const largeur = Math.max(colonnes.length, ...lignes.map(l => l.length));
	const completer = (l: string[]): string[] => l.concat(new Array<string>(largeur - l.length).fill(""));
	return {
		// Un en-tête entièrement vide n'en est pas un : aucun `<th>` à poser.
		colonnes: colonnes.some(c => c.trim() !== "") ? completer(colonnes) : [],
		lignes: lignes.map(completer),
	};
}

/**
 * « À retenir », ou `null` s'il est absent ou MAL FORMÉ (forme inconnue,
 * `items` qui n'est pas une liste, aucun élément valide) — ignoré sans
 * erreur. Les éléments invalides sont écartés un à un : une carte sans verso
 * ne se retourne sur rien, une ligne de récapitulatif vide ne dit rien.
 */
export function retenirDeLecture(item: unknown): Retenir | null {
	const v = champ(item, "retenir");
	if (!objet(v) || !Array.isArray(v.items)) return null;
	if (v.forme === "cartes") {
		const items = v.items
			.filter(objet)
			.map(c => ({ recto: cellule(c.recto), verso: cellule(c.verso) }))
			.filter(c => c.recto.trim() !== "" && c.verso.trim() !== "");
		return items.length ? { forme: "cartes", items } : null;
	}
	if (v.forme === "recap") {
		const items = v.items.filter((e): e is string => typeof e === "string" && e.trim() !== "");
		return items.length ? { forme: "recap", items } : null;
	}
	return null;
}

/** Les quatre champs d'une lecture, normalisés. */
export function lireLecture(item: unknown): LectureStylee {
	return {
		style: styleDeLecture(item),
		etapes: etapesDeLecture(item),
		tableau: tableauDeLecture(item),
		retenir: retenirDeLecture(item),
	};
}

/** Les paragraphes d'un texte (séparés par une ligne vide) : les étapes d'une
    lecture `etapes` qui n'en écrit pas. Un bloc de code garde ses lignes
    vides : on ne coupe pas au milieu d'une clôture ```. */
export function paragraphes(texte: string): string[] {
	const out: string[] = [];
	let courant: string[] = [];
	let dansCode = false;
	for (const ligne of texte.split(/\r?\n/)) {
		if (/^\s*```/.test(ligne)) dansCode = !dansCode;
		if (!dansCode && ligne.trim() === "") {
			if (courant.length) out.push(courant.join("\n"));
			courant = [];
		} else courant.push(ligne);
	}
	if (courant.length) out.push(courant.join("\n"));
	return out.filter(p => p.trim() !== "");
}

/** Minutes de lecture annoncées sur une page : mots / 200, arrondi, au moins 1. */
export function minutesDeLecture(texte: string): number {
	const mots = texte.split(/\s+/).filter(Boolean).length;
	return Math.max(1, Math.round(mots / 200));
}
