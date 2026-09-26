import { QUESTION_ROLES } from "./types/quiz";
import type { QuestionRole } from "./types/quiz";

/* ══════════════════════════════════════════════════════════
   LE COURS D'UNE ÉTAPE, ABSORBÉ PAR SES QUESTIONS (2026-09-26)

   Dans un Learn, la carte de LECTURE (`role: "read"`) d'une étape
   (`slice`) n'est plus un écran : le cours s'affiche, replié, au-dessus de
   CHAQUE question de son étape (engine/passage.ts). Un cours seul n'est pas
   une question, et le montrer deux fois était du gaspillage.

   UNE SEULE RÈGLE, ici, PURE (ni hôte, ni DOM, ni mode) : le moteur, la
   page d'un quiz, l'éditeur, le scanner et la coquille de l'application la
   lisent tous. Deux lectures de « qui est absorbé » qui divergent, et la
   question Q3 d'un écran devient la Q4 d'un autre — ou un clic ouvre
   l'éditeur sur la mauvaise question.

   Règle : une lecture est ABSORBÉE si son étape contient AU MOINS UNE
   question qui n'est pas une lecture, quel que soit son rôle. Sinon elle
   reste un écran autonome (quiz anciens ou écrits à la main).

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

/** Les index des lectures absorbées par leur étape. */
export function lecturesAbsorbees(items: readonly unknown[]): Set<number> {
	/* Les étapes qui ont au moins une question qui n'est pas une lecture. */
	const avecQuestion = new Set<number>();
	items.forEach(it => {
		const s = trancheDe(it);
		if (s !== null && roleDe(it) !== "read") avecQuestion.add(s);
	});
	const out = new Set<number>();
	items.forEach((it, i) => {
		const s = trancheDe(it);
		if (s !== null && roleDe(it) === "read" && avecQuestion.has(s)) out.add(i);
	});
	return out;
}

/**
 * L'index de la lecture ABSORBÉE de l'étape de `qi` (la première, dans
 * l'ordre du tableau), ou `null` : `qi` est lui-même une lecture, n'a pas
 * d'étape, ou son étape n'a pas de lecture.
 */
export function lectureDeLEtape(items: readonly unknown[], qi: number, absorbees: ReadonlySet<number> = lecturesAbsorbees(items)): number | null {
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
export function questionHote(items: readonly unknown[], qi: number, absorbees: ReadonlySet<number> = lecturesAbsorbees(items)): number {
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
export function questionsVisibles(items: readonly unknown[], absorbees: ReadonlySet<number> = lecturesAbsorbees(items)): number[] {
	const out: number[] = [];
	for (let i = 0; i < items.length; i++) if (!absorbees.has(i)) out.push(i);
	return out;
}

/** Le NUMÉRO affiché de chaque index (à partir de 1), qui saute les
    lectures absorbées ; 0 pour une lecture absorbée, qui n'en a pas. */
export function numerosAffiches(items: readonly unknown[], absorbees: ReadonlySet<number> = lecturesAbsorbees(items)): number[] {
	let n = 0;
	return items.map((_, i) => (absorbees.has(i) ? 0 : ++n));
}
