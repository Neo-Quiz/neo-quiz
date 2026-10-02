import { QUESTION_ROLES } from "./types/quiz";
import type { QuestionRole } from "./types/quiz";
import { estMethode, etapesDeLecture, motsDeLecture, paragraphes, retenirDeLecture, styleDeLecture } from "./lecture-style";

/* ══════════════════════════════════════════════════════════
   LES LECTURES D'UN LEARN : UN ÉCRAN CHACUNE, SANS NUMÉRO (2026-09-26)

   Décision d'Ahmed, la dernière du 2026-09-26, qui remplace toutes les
   règles d'« absorption » de la journée : TOUTE lecture (`role: "read"`),
   quel que soit son style (`page`, `etapes`, `tableau`,
   src/lecture-style.ts), a SON PROPRE ÉCRAN dans le quiz, à sa place dans
   son étape. Elle n'apparaît plus jamais au-dessus d'une question. Dans un
   Learn, elle n'a pas de numéro de question, ne compte pas dans le score ni
   dans le nombre de questions, et son onglet est un livre.

   UNE SEULE RÈGLE, ici, PURE (ni hôte, ni DOM) : le moteur, la page d'un
   quiz, l'éditeur, le scanner et la coquille de l'application la lisent
   tous. Deux numérotations qui divergent, et la Q3 d'un écran devient la
   Q4 d'un autre.

   EXCEPTION, règle finale d'Ahmed le même soir : une lecture `etapes` sans
   « À retenir », COURTE ou marquée MÉTHODE (`methode: true`) — voir
   `estLectureCourte` — n'a pas d'écran. Elle s'affiche ouverte, en
   étapes légères, sans cadre, au-dessus de la PREMIÈRE question de son étape
   qui n'est ni une lecture ni une « Avant la lecture » — sa question
   HÔTE —, et nulle part ailleurs. Sans hôte (étape faite de lectures et de
   pré-questions), elle garde son écran. Elle ne compte pas dans
   « N lectures » : ce n'est pas un écran.

   Learn (`estLecon`) : le mode du bloc normalisé comme le moteur le fait
   (`extractExamOptions(...).quizMode === "lesson"`). Hors Learn, une
   lecture est jouée et numérotée comme une question ordinaire.

   Les INDEX ne changent jamais : seuls la numérotation et les comptes
   sautent les lectures. `npm run check:passage` éprouve ce module.
══════════════════════════════════════════════════════════ */

/** Ce que la règle lit d'un élément du tableau : rien d'autre. */
type Brut = { role?: unknown; slice?: unknown } | null | undefined;

/** Entier ≥ 1, et rien d'autre : « 2 » (chaîne) ou 0 ne font pas une étape.
    La même règle que le moteur (`engine/lesson.ts`). */
export function trancheValide(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

/** Le rôle déclaré, `test` par défaut (comme `buildLessonModel.roleOf`). */
function roleDe(item: unknown): QuestionRole {
	const r = item && typeof item === "object" ? (item as Brut)?.role : undefined;
	return typeof r === "string" && (QUESTION_ROLES as readonly string[]).includes(r) ? r as QuestionRole : "test";
}

function trancheDe(item: unknown): number | null {
	return item && typeof item === "object" ? trancheValide((item as Brut)?.slice) : null;
}

/** Au plus ce nombre de mots (texte et étapes : `motsDeLecture`), une
    lecture `etapes` est COURTE. « Environ 60 mots » : la décision d'Ahmed. */
export const SEUIL_LECTURE_COURTE = 60;

/** Au plus ce nombre d'étapes, une lecture `etapes` est COURTE : au-delà,
    même en peu de mots, elle déborderait de la question qu'elle surplombe. */
export const PLAFOND_ETAPES_COURTES = 4;

/**
 * Une lecture SANS ÉCRAN, lue au-dessus de sa question hôte (règle finale
 * d'Ahmed, 2026-09-26). SEUL le style `etapes`, sans « À retenir », et
 * dans l'un de deux cas :
 * 1. COURTE : au plus `SEUIL_LECTURE_COURTE` mots et
 *    `PLAFOND_ETAPES_COURTES` étapes (les écrites, sinon les paragraphes du
 *    texte, qui en tiennent lieu au rendu) ;
 * 2. une MÉTHODE à appliquer sur la question qui suit (`methode: true`,
 *    écrit par l'IA ou l'éditeur), quelle que soit sa longueur.
 * `page` (ou sans style), `tableau` et toute lecture avec « À retenir » ont
 * TOUJOURS leur écran.
 */
export function estLectureCourte(item: unknown): boolean {
	if (roleDe(item) !== "read" || styleDeLecture(item) !== "etapes" || retenirDeLecture(item) !== null) return false;
	if (estMethode(item)) return true;
	const etapes = etapesDeLecture(item).length || paragraphes(String((item as { prompt?: unknown }).prompt ?? "")).length;
	if (etapes > PLAFOND_ETAPES_COURTES) return false;
	const n = motsDeLecture(item);
	return n > 0 && n <= SEUIL_LECTURE_COURTE;
}

/** Les lectures SANS ÉCRAN d'un Learn (`estLectureCourte` : étapes courtes
    ou méthode — « courtes » pour faire court) et leur question HÔTE : index de la
    lecture → index de la question au-dessus de laquelle elle se lit. Vide
    hors Learn. Une lecture courte sans hôte n'y figure pas : elle garde son
    écran. */
export function lecturesCourtes(items: readonly unknown[], estLecon: boolean): Map<number, number> {
	const out = new Map<number, number>();
	if (!estLecon) return out;
	items.forEach((it, i) => {
		if (!estLectureCourte(it)) return;
		const s = trancheDe(it);
		if (s === null) return;
		const hote = items.findIndex(q => trancheDe(q) === s && roleDe(q) !== "read" && roleDe(q) !== "pre");
		/* Une hôte ne porte qu'UNE lecture : la première de son étape. Une
		   suivante qui la viserait aussi GARDE SON ÉCRAN — jamais perdue (revue
		   du 2026-09-26 : elle n'avait ni écran ni place au-dessus). */
		if (hote >= 0 && ![...out.values()].includes(hote)) out.set(i, hote);
	});
	return out;
}

/** La lecture courte à lire au-dessus de la question `qi`, ou `null`. Une
    hôte n'en porte qu'une : la première de son étape. */
export function lectureCourteDe(items: readonly unknown[], estLecon: boolean, qi: number): number | null {
	for (const [lecture, hote] of lecturesCourtes(items, estLecon)) if (hote === qi) return lecture;
	return null;
}

/** La question à MONTRER pour l'index `i` : sa question hôte pour une
    lecture courte, qui n'a pas d'écran ; `i` lui-même sinon. Sert à
    reprendre une session ou à ouvrir l'éditeur sur un index qui la visait. */
export function questionHote(items: readonly unknown[], estLecon: boolean, i: number): number {
	return lecturesCourtes(items, estLecon).get(i) ?? i;
}

/** Les index qui ont un ÉCRAN (tout sauf les lectures courtes), dans l'ordre. */
export function questionsVisibles(items: readonly unknown[], estLecon: boolean): number[] {
	const courtes = lecturesCourtes(items, estLecon);
	return items.map((_, i) => i).filter(i => !courtes.has(i));
}

/** Le NUMÉRO affiché de chaque index (à partir de 1) ; 0 pour une lecture
    de Learn, qui n'en a pas. Hors Learn, tout est numéroté. */
export function numerosAffiches(items: readonly unknown[], _estLecon: boolean): number[] {
	let n = 0;
	return items.map(it => (roleDe(it) === "read" ? 0 : ++n));
}

/** Le numéro AFFICHÉ de l'index `i`, 0 pour une lecture de Learn (elle
    n'en a pas) ; l'index + 1 seulement pour un index hors du tableau.
    `??` et JAMAIS `||` : le 0 d'une lecture est une valeur, pas une
    absence — `||` lui fabriquait un numéro de question (revue du
    2026-09-26, page d'un quiz). Même règle que `ctx.numeroAffiche` du
    moteur (engine.ts). */
export function numeroAffiche(items: readonly unknown[], estLecon: boolean, i: number): number {
	return numerosAffiches(items, estLecon)[i] ?? i + 1;
}

/** Le numéro à annoncer pour une session posée sur l'index `i`
    (« Reprendre · Q3/7 ») : le sien ; pour une lecture, qui n'a pas de
    numéro, celui de la question qui la suit, à défaut de la précédente ;
    1 si le bloc n'a aucune question numérotée. */
export function numeroDeReprise(items: readonly unknown[], estLecon: boolean, index: number): number {
	const numeros = numerosAffiches(items, estLecon);
	// Une lecture courte se lit sur sa question hôte : son numéro.
	const i = questionHote(items, estLecon, index);
	if (numeros[i] > 0) return numeros[i];
	for (let k = i + 1; k < numeros.length; k++) if (numeros[k] > 0) return numeros[k];
	for (let k = i - 1; k >= 0; k--) if (numeros[k] > 0) return numeros[k];
	return 1;
}

/** Le nombre de QUESTIONS d'un bloc, tel que les compteurs l'annoncent :
    en Learn, aucune lecture n'en est une. */
export function nombreDeQuestions(items: readonly unknown[], estLecon: boolean): number {
	return numerosAffiches(items, estLecon).filter(n => n > 0).length;
}

/** Le nombre de LECTURES d'un bloc (compteur « N lectures », à côté de « N
    questions ») : ses lectures qui ont un ÉCRAN — une lecture courte, lue
    au-dessus de sa question hôte, n'en est pas un. 0 hors Learn : une
    lecture y est jouée comme une question ordinaire, déjà comptée par
    `nombreDeQuestions` (revue du 2026-09-26, compteur d'une fiche). */
export function nombreDeLectures(items: readonly unknown[], estLecon: boolean): number {
	const courtes = lecturesCourtes(items, estLecon);
	let n = 0;
	items.forEach((it, i) => { if (roleDe(it) === "read" && !courtes.has(i)) n++; });
	return n;
}
