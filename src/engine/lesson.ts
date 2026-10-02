/**
 * Modèle des TRANCHES d'apprentissage (mode "lesson"), dérivé des champs
 * `slice`/`role` portés par chaque question (src/types/quiz.ts). Task 3 du
 * lot mode leçon (2026-08-31) : ce module se contente d'assembler et
 * d'exposer le modèle — rien ne s'affiche encore, les tâches suivantes s'en
 * serviront pour construire la boucle en 5 temps (pre/recall/test par tranche).
 *
 * `buildLessonModel` est PURE et exportée au niveau du module : elle ne
 * dépend d'aucun `ctx`, ce qui la rend vérifiable sans DOM ni Obsidian par
 * `scripts/check-lesson.mjs`, sur le code réel. `createLessonHandlers`
 * n'est qu'une enveloppe fine qui l'appelle depuis le ctx du moteur — même
 * pattern que les 17 autres factories `engine/*.ts` (voir engine.ts).
 */
import type { EngineCtx } from "../types/engine-ctx";
import type { QuizQuestion, QuestionRole } from "../types/quiz";
import { QUESTION_ROLES } from "../types/quiz";
import { trancheValide } from "../lecture-etape";

/** Une tranche : sa position 1-based dans `lessonSlices()` et les index de ses questions, dans l'ordre du tableau source. */
export interface LessonSlice {
	index: number;
	questionIndexes: number[];
}

export interface LessonModel {
	isLesson: boolean;
	slices: LessonSlice[];
	sliceOf(qi: number): number | null;
	roleOf(qi: number): QuestionRole;
}

/** Entier ≥ 1, et rien d'autre : « 2 » (chaîne) ou 0 ne font pas une
    tranche. La même règle que celle des lectures absorbées
    (src/lecture-etape.ts) : deux lectures d'une étape ne doivent pas
    diverger. */
const normalizeSlice = trancheValide;

/**
 * Construit le modèle de tranches à partir des QUESTIONS seules (pas de
 * `ctx`) : `quizMode` est pris en paramètre plutôt que lu sur un contexte
 * car c'est la seule donnée externe dont dépend le résultat.
 *
 * Un bloc où aucune question ne porte `slice` valide n'active pas la boucle
 * (comportement historique du mode "lesson" : section « Leçon » + bouton
 * d'examen) même si `quizMode === "lesson"` — d'où `slices.length > 0` dans
 * `isLesson`, en plus du mode.
 */
export function buildLessonModel(questions: readonly QuizQuestion[], quizMode: string): LessonModel {
	const numbers = new Map<number, number[]>();
	questions.forEach((q, qi) => {
		const s = normalizeSlice((q as { slice?: unknown }).slice);
		if (s === null) return;
		const bucket = numbers.get(s);
		if (bucket) bucket.push(qi); else numbers.set(s, [qi]);
	});

	const slices: LessonSlice[] = [...numbers.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([, questionIndexes], i) => ({ index: i + 1, questionIndexes }));

	const isLesson = quizMode === "lesson" && slices.length > 0;

	const positionOf = new Map<number, number>();
	slices.forEach(s => s.questionIndexes.forEach(qi => positionOf.set(qi, s.index)));

	return {
		isLesson,
		slices,
		sliceOf: qi => (isLesson ? positionOf.get(qi) ?? null : null),
		roleOf: qi => {
			const r = (questions[qi] as { role?: unknown } | undefined)?.role;
			return typeof r === "string" && (QUESTION_ROLES as readonly string[]).includes(r) ? r as QuestionRole : "test";
		}
	};
}

export interface LessonHandlers {
	isLessonMode(): boolean;
	lessonSlices(): ReadonlyArray<LessonSlice>;
	sliceOfQuestion(qi: number): number | null;
	roleOfQuestion(qi: number): QuestionRole;
	/** THE predicate "this card is a reading, not a question": a card with
	    `role: "read"` in ANY quiz (a Test too: it has nothing to answer, so
	    counting it made 100 % impossible), or a reading absorbed by its
	    step (never in a Learn block without a valid slice, played as an
	    ordinary quiz). Everything that counts, lists, scores or logs questions asks
	    this and nothing else, so they cannot disagree. */
	isReadingCard(qi: number): boolean;
}

/**
 * Wrapper around `ctx`: rebuilds the model on EACH call rather than freezing
 * it once and for all at assembly.
 *
 * It was needed while `ctx.quizMode` could change during the block's life
 * (the Learn → Exam switch and `resetQuiz` going back to `"lesson"`, both
 * removed on 2026-09-29). It stays an accessor, as the project's "accessor,
 * never a flag" rule asks: a snapshot would silently go wrong the day
 * something mutates the mode again. `ctx.quiz` never changes after assembly
 * (no mutation of the `slice`/`role` fields nor of the array in
 * engine.ts/engine/*.ts). The cost is negligible: one pass over `ctx.quiz`,
 * bounded by the quiz's size.
 */
export function createLessonHandlers(ctx: EngineCtx): LessonHandlers {
	const model = (): LessonModel => buildLessonModel(ctx.quiz, ctx.quizMode);

	return {
		isLessonMode: () => model().isLesson,
		lessonSlices: () => model().slices,
		sliceOfQuestion: qi => model().sliceOf(qi),
		roleOfQuestion: qi => model().roleOf(qi),
		isReadingCard: qi => {
			if (ctx.lecturesAbsorbees?.has(qi)) return true;
			const m = model();
			// A Learn block WITHOUT a valid slice is played as an ordinary
			// quiz: its "read" cards stay ordinary questions there (decision
			// of the Learn work, pinned by check:engine-review).
			if (ctx.quizMode === "lesson" && !m.isLesson) return false;
			return m.roleOf(qi) === "read";
		}
	};
}
