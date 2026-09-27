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
}

/**
 * Enveloppe de `ctx` : reconstruit le modèle à CHAQUE appel plutôt que de le
 * figer une fois pour toutes à l'assemblage.
 *
 * Nécessaire car `ctx.quizMode` EST mutable en cours de vie du bloc, malgré
 * la simplification du brief de cette tâche : `switchToExamMode` (engine.ts)
 * bascule Leçon → Examen (`ctx.quizMode = "exam"`), et `resetQuiz` peut
 * revenir à `"lesson"` (engine/state.ts). Un modèle construit UNE fois au
 * montage figerait `isLesson` à la valeur de l'instant de l'assemblage et
 * deviendrait faux dès le premier changement de mode — exactement l'écueil
 * SNAPSHOT que la règle « accessor, jamais flag » du projet interdit.
 * `ctx.quiz`, lui, ne change jamais après l'assemblage (aucune mutation des
 * champs `slice`/`role` ni du tableau trouvée dans engine.ts/engine/*.ts) :
 * seul `ctx.quizMode` bouge, d'où ce choix de tout recalculer à chaque appel
 * plutôt que d'introduire un cache invalidé à la main. Le coût est
 * négligeable : un seul passage sur `ctx.quiz`, borné à la taille du quiz.
 */
export function createLessonHandlers(ctx: EngineCtx): LessonHandlers {
	const model = (): LessonModel => buildLessonModel(ctx.quiz, ctx.quizMode);

	return {
		isLessonMode: () => model().isLesson,
		lessonSlices: () => model().slices,
		sliceOfQuestion: qi => model().sliceOf(qi),
		roleOfQuestion: qi => model().roleOf(qi)
	};
}
