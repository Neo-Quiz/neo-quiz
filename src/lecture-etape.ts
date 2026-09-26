import { QUESTION_ROLES } from "./types/quiz";
import type { QuestionRole } from "./types/quiz";
import { styleDeLecture } from "./lecture-style";

/* ══════════════════════════════════════════════════════════
   LE COURS D'UNE ÉTAPE, ABSORBÉ PAR SES QUESTIONS (2026-09-26)

   Dans un Learn, la carte de LECTURE (`role: "read"`) d'une étape
   (`slice`) n'est plus un écran : le cours s'affiche, replié, au-dessus de
   CHAQUE question de son étape (engine/passage.ts). Un cours seul n'est pas
   une question, et le montrer deux fois était du gaspillage.

   UNE SEULE RÈGLE, ici, PURE (ni hôte, ni DOM) : le moteur, la page d'un
   quiz, l'éditeur, le scanner et la coquille de l'application la lisent
   tous. Deux lectures de « qui est absorbé » qui divergent, et la question
   Q3 d'un écran devient la Q4 d'un autre — ou un clic ouvre l'éditeur sur
   la mauvaise question.

   Règle : dans un bloc LEARN (`estLecon`, le mode du bloc normalisé comme
   le moteur le fait : `extractExamOptions(...).quizMode === "lesson"`), la
   PREMIÈRE lecture d'une étape est ABSORBÉE si l'étape contient AU MOINS
   UNE question qui n'est pas une lecture, quel que soit son rôle. Hors
   Learn, rien n'est absorbé : le moteur joue alors chaque lecture comme un
   écran, et tous les lecteurs doivent compter pareil (revue du
   2026-09-26). Une seconde lecture dans la même étape reste un écran
   autonome : elle n'a pas de place au-dessus des questions, qui n'en
   montrent qu'une, et l'absorber la ferait disparaître.

   RÉVISION DU MÊME JOUR, décision d'Ahmed : le STYLE de la lecture
   (src/lecture-style.ts) départage. Une lecture `page` — ou sans champ
   `lecture`, donc tous les quiz d'avant — n'est JAMAIS absorbée : elle
   redevient un écran à part, à sa place dans l'étape, sans numéro de
   question. Seules les lectures `etapes` et `tableau` sont absorbées.
   `coursDeLEtape` dit, pour une question, quelle lecture est son cours,
   absorbée ou non ; le moteur décide selon le style et le rôle s'il le
   montre (engine/passage.ts `passageVisibility`).

   Les INDEX ne changent jamais : les lectures restent dans les données, à
   leur place. Seuls l'affichage, la numérotation et les comptes les sautent.

   `npm run check:passage` éprouve ce module.
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

/** Les étapes qui ont au moins une question qui n'est pas une lecture. */
function etapesAvecQuestion(items: readonly unknown[]): Set<number> {
	const avecQuestion = new Set<number>();
	items.forEach(it => {
		const s = trancheDe(it);
		if (s !== null && roleDe(it) !== "read") avecQuestion.add(s);
	});
	return avecQuestion;
}

/** Les index des lectures absorbées par leur étape. Vide hors Learn.

    LE STYLE COMPTE (décision du 2026-09-26, plus récente que l'en-tête) :
    une lecture en style `page` (maquette B, un texte suivi) n'est JAMAIS
    absorbée — elle reste un écran à part, à sa place dans l'étape, après
    les questions « Avant la lecture ». Seules les lectures `etapes` et
    `tableau` s'affichent au-dessus des questions. Une lecture SANS champ
    `lecture` (tous les quiz d'avant les styles) vaut `page`
    (src/lecture-style.ts `styleDeLecture`). */
export function lecturesAbsorbees(items: readonly unknown[], estLecon: boolean): Set<number> {
	const out = new Set<number>();
	if (!estLecon) return out;
	const avecQuestion = etapesAvecQuestion(items);
	/* Une seule lecture absorbée par étape : la première. */
	const dejaAbsorbee = new Set<number>();
	items.forEach((it, i) => {
		const s = trancheDe(it);
		if (s === null || roleDe(it) !== "read" || !avecQuestion.has(s) || dejaAbsorbee.has(s)) return;
		dejaAbsorbee.add(s);
		if (styleDeLecture(it) !== "page") out.add(i);
	});
	return out;
}

/**
 * Le COURS montré au-dessus de la question `qi`, ou `null` : la PREMIÈRE
 * lecture de son étape, qu'elle soit absorbée (`etapes`, `tableau`) ou
 * restée un écran (`page`). La même lecture que `lecturesAbsorbees`
 * considère : une seconde lecture de l'étape n'est jamais un cours.
 * `null` hors Learn, pour une lecture, sans étape, ou dans une étape sans
 * lecture. Le moteur (engine/passage.ts) décide ensuite, selon le style et
 * le rôle, s'il le montre et comment.
 */
export function coursDeLEtape(items: readonly unknown[], estLecon: boolean, qi: number): { index: number; absorbee: boolean } | null {
	if (!estLecon) return null;
	const s = trancheDe(items[qi]);
	if (s === null || roleDe(items[qi]) === "read") return null;
	for (let i = 0; i < items.length; i++) {
		if (trancheDe(items[i]) !== s || roleDe(items[i]) !== "read") continue;
		return { index: i, absorbee: styleDeLecture(items[i]) !== "page" };
	}
	return null;
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
    (« Reprendre · Q3/7 ») : celui de la question qui le montre
    (`questionHote`) ; pour une lecture restée un écran, qui n'a pas de
    numéro, celui de la question qui la suit, à défaut de la précédente ;
    1 si le bloc n'a aucune question numérotée. */
export function numeroDeReprise(items: readonly unknown[], estLecon: boolean, i: number): number {
	const numeros = numerosAffiches(items, estLecon);
	const hote = questionHote(items, estLecon, i);
	if (numeros[hote] > 0) return numeros[hote];
	for (let k = hote + 1; k < numeros.length; k++) if (numeros[k] > 0) return numeros[k];
	for (let k = hote - 1; k >= 0; k--) if (numeros[k] > 0) return numeros[k];
	return 1;
}

/** Le nombre de QUESTIONS d'un bloc, tel que les compteurs l'annoncent :
    en Learn, aucune lecture (absorbée ou écran à part) n'en est une. */
export function nombreDeQuestions(items: readonly unknown[], estLecon: boolean): number {
	return numerosAffiches(items, estLecon).filter(n => n > 0).length;
}

/** Le nombre de LECTURES d'un bloc (compteur « N lectures », à côté de « N
    questions ») : TOUTES les lectures de l'étape (`role: "read"`), qu'elles
    soient absorbées au-dessus des questions ou restées un écran à part
    (`styleDeLecture` ne compte pas ici, contrairement à `lecturesAbsorbees`).
    0 hors Learn : une lecture y est jouée comme une question ordinaire, déjà
    comptée par `nombreDeQuestions` (revue du 2026-09-26, compteur d'une fiche). */
export function nombreDeLectures(items: readonly unknown[], estLecon: boolean): number {
	if (!estLecon) return 0;
	let n = 0;
	items.forEach(it => { if (roleDe(it) === "read") n++; });
	return n;
}

/**
 * L'index de la lecture ABSORBÉE de l'étape de `qi`, ou `null` : hors
 * Learn, `qi` est lui-même une lecture, n'a pas d'étape, ou son étape n'a
 * pas de lecture absorbée.
 */
export function lectureDeLEtape(items: readonly unknown[], estLecon: boolean, qi: number, absorbees: ReadonlySet<number> = lecturesAbsorbees(items, estLecon)): number | null {
	const s = trancheDe(items[qi]);
	if (s === null || roleDe(items[qi]) === "read") return null;
	for (let i = 0; i < items.length; i++) {
		if (absorbees.has(i) && trancheDe(items[i]) === s) return i;
	}
	return null;
}

/**
 * La question à MONTRER pour `qi` : `qi` lui-même, sauf pour une lecture
 * absorbée — elle n'a plus d'écran — qui renvoie à la première question de
 * son étape placée APRÈS elle (la question qu'on lisait en la quittant), à
 * défaut à la première de son étape. Sert à reprendre une session, ou à
 * ouvrir l'éditeur, sur un index qui pointait une lecture.
 */
export function questionHote(items: readonly unknown[], estLecon: boolean, qi: number, absorbees: ReadonlySet<number> = lecturesAbsorbees(items, estLecon)): number {
	if (!absorbees.has(qi)) return qi;
	const s = trancheDe(items[qi]);
	let premiere = -1;
	for (let i = 0; i < items.length; i++) {
		if (absorbees.has(i) || trancheDe(items[i]) !== s || roleDe(items[i]) === "read") continue;
		if (i > qi) return i;
		if (premiere < 0) premiere = i;
	}
	return premiere >= 0 ? premiere : qi;
}

/** Les index VISIBLES (tout sauf les lectures absorbées), dans l'ordre. */
export function questionsVisibles(items: readonly unknown[], estLecon: boolean, absorbees: ReadonlySet<number> = lecturesAbsorbees(items, estLecon)): number[] {
	const out: number[] = [];
	for (let i = 0; i < items.length; i++) if (!absorbees.has(i)) out.push(i);
	return out;
}

/** Le NUMÉRO affiché de chaque index (à partir de 1), qui saute les
    lectures ; 0 pour une lecture, qui n'en a pas. En Learn, AUCUNE lecture
    n'est numérotée, absorbée ou restée un écran (décision du 2026-09-26) :
    ce n'est pas une question. Hors Learn, tout est numéroté. */
export function numerosAffiches(items: readonly unknown[], estLecon: boolean, absorbees: ReadonlySet<number> = lecturesAbsorbees(items, estLecon)): number[] {
	let n = 0;
	return items.map((it, i) => (absorbees.has(i) || (estLecon && roleDe(it) === "read") ? 0 : ++n));
}
