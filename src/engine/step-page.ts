/**
 * A Learn with steps plays as ONE page per step (spec
 * docs/superpowers/specs/2026-10-07-learn-scroll-design.md, §1-2): the step's
 * reading cards, then its questions stacked, then "Next step". This module is
 * the PURE part (no DOM, no engine context; `npm run check:engine-review`):
 * which cards make which page, which question types are answered by a tap,
 * and what colour the step's bead takes.
 */
import type { LearnVerdict, QuizQuestion } from "../types/quiz";
import type { LessonModel } from "./lesson";

/** One page: the indexes of its reading cards and of its questions, both in
    the quiz's order. `step` is the page's 1-based number (what the bead shows). */
export interface StepSlide {
	step: number;
	reads: number[];
	questions: number[];
}

/**
 * The pages of a quiz. A Learn with valid steps: one page per step, in step
 * order, plus a trailing page for the questions WITHOUT a valid `slice`
 * (never dropped: a question nobody can reach is worse than a long last
 * page). A quiz that is not such a Learn keeps one page per question.
 */
export function buildStepSlides(questions: readonly QuizQuestion[], lesson: LessonModel): StepSlide[] {
	if (!lesson.isLesson) {
		return questions.map((_, qi) => ({ step: qi + 1, reads: [], questions: [qi] }));
	}
	const split = (indexes: number[], step: number): StepSlide => ({
		step,
		reads: indexes.filter(qi => lesson.roleOf(qi) === "read"),
		questions: indexes.filter(qi => lesson.roleOf(qi) !== "read"),
	});
	const pages = lesson.slices.map(s => split(s.questionIndexes, s.index));
	const loose = questions.map((_, qi) => qi).filter(qi => lesson.sliceOf(qi) === null);
	if (loose.length > 0) pages.push(split(loose, lesson.slices.length + 1));
	return pages;
}

/** The cards of a page in the order they are shown: readings first. */
export function stepMembers(step: StepSlide): number[] {
	return [...step.reads, ...step.questions];
}

/**
 * The order the cards of a page are drawn in: a question whose retry is
 * open (reopened, not yet checked) sits at the BOTTOM, where a retry is
 * appended live, so that a page drawn again after a resume looks the same.
 * Readings and the other cards keep their order.
 */
export function drawOrder(members: readonly number[], retryOpen: (qi: number) => boolean): number[] {
	return [...members.filter(qi => !retryOpen(qi)), ...members.filter(retryOpen)];
}

/** The page that holds question `qi`, or `null`. */
export function stepHolding(slides: readonly StepSlide[], qi: number): StepSlide | null {
	return slides.find(s => s.reads.includes(qi) || s.questions.includes(qi)) ?? null;
}

/**
 * Answered by a tap, never by typing: a card to flip, or a question with
 * options (single or multiple choice). Everything else — text, cloze,
 * numeric, ordering, matching, code, a recall shown without options — is a
 * reveal card in a step page.
 */
export function isTapType(q: QuizQuestion): boolean {
	const r = q as unknown as Record<string, unknown> | null | undefined;
	if (!r) return false;
	if (r.flashcard === true) return true;
	if (r.type === "text" || r.text === true) return false;
	if (typeof r.cloze === "string" && r.cloze.trim().length > 0) return false;
	if (typeof r.language === "string" && r.language.trim().length > 0) return false;
	if (r.ordering === true || typeof r.ordering === "object" || r.matching === true || typeof r.matching === "object") return false;
	return Array.isArray(r.options) && r.options.length > 0;
}

/**
 * The state class of a step's bead, from the verdicts of its graded
 * questions: all right first time = `correct`; misses still standing = `wrong`
 * only when they are more than a third of the step, else `partial` (amber: one
 * miss among five turned the whole step red, 2026-10-09); right but only after
 * a retry = `retried`; anything unfinished = `answered` (something done) or
 * nothing (not started).
 */
export function stepBeadState(verdicts: readonly LearnVerdict[], touched: boolean): string {
	if (verdicts.length === 0) return touched ? "answered" : "";
	const missed = verdicts.filter(v => v === "missed").length;
	if (missed > 0) return missed * 3 > verdicts.length ? "wrong" : "partial";
	if (verdicts.includes("none")) return touched || verdicts.some(v => v !== "none") ? "answered" : "";
	return verdicts.every(v => v === "first") ? "correct" : "retried";
}

/**
 * After a verdict on card `qi` of a step page: the next card still to do comes
 * into view, smoothly and by the least move (`nearest`), aiming at its prompt
 * rather than the whole card so that the explanation just shown stays on
 * screen. Nothing moves when no card is left to do.
 */
export function scrollNextOpenIntoView(root: ParentNode, members: readonly number[], qi: number, isOpen: (qi: number) => boolean): void {
	for (const next of members.slice(members.indexOf(qi) + 1)) {
		if (!isOpen(next)) continue;
		const card = root.querySelector<HTMLElement>(`.quiz-step-page .quiz-card[data-card-qi="${next}"]`);
		(card?.querySelector<HTMLElement>(".quiz-question, h2") ?? card)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		return;
	}
}

/** What a card of a step page is, for its header label: a tap on options, a
    flashcard to flip, or any other type shown as a card to reveal. */
export type StepCardKind = "choice" | "flashcard" | "reveal";

export function stepCardKind(q: QuizQuestion): StepCardKind {
	if ((q as unknown as { flashcard?: unknown } | null)?.flashcard === true) return "flashcard";
	return isTapType(q) ? "choice" : "reveal";
}

/** The numbers of a Learn's summary: "x/N learned" counts the questions
    right first time AND the ones right after a retry; the accuracy counts
    only the first (a retried miss was still a miss), over the questions
    answered so far. */
export function learnFigures(sum: { first: number; retried: number; missed: number }, gradedTotal: number): { learned: number; total: number; accuracy: number } {
	const answered = sum.first + sum.retried + sum.missed;
	return {
		learned: sum.first + sum.retried,
		total: Math.max(gradedTotal, answered),
		accuracy: answered === 0 ? 0 : Math.round((sum.first / answered) * 100),
	};
}

/** Milliseconds as `m:ss` (`h:mm:ss` from an hour). */
export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
	const ss = String(s).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
