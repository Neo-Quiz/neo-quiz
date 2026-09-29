/* ══════════════════════════════════════════════════════════
   THE LEARN RETRY LOOP IN THE ENGINE (2026-09-29, spec
   docs/superpowers/specs/2026-09-28-learn-retry-design.md).

   The pure rules live in engine/learn-loop.ts; this module applies them to
   the quiz: which cards take part, what "revealed" means card by card, the
   Check button, the next arrow that checks first, the retry that clears
   the answer and reshuffles, and the Learn verdict a bead or a score reads.

   ONE predicate, `isRevealed(qi)`, replaces the quiz's global lock on
   every per-card decision (correction classes, explanation, read-only
   fields, the glossary and ▶ rules): the lock after the results, OR a
   Learn card whose current attempt has been checked. The track item of a
   revealed card carries `quiz-learn-revealed` for the CSS and the DOM-side rules.
   ══════════════════════════════════════════════════════════ */
import type { EngineCtx } from "../types/engine-ctx";
import type { LearnVerdict, TextOnlyRating } from "../types/quiz";
import {
	applyCheck,
	applyNeutralCheck,
	beginRetry,
	emptyLearnState,
	learnSummary,
	nextLearnMove,
	resumeNormalOrder,
	revealForSelfRating,
	type LearnSummary,
} from "./learn-loop";
import { t } from "../i18n";

/* Lucide `rotate-ccw`: the line of a card being retried. */
const ICON_RETRY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';

/** What the next arrow did on a Learn card. */
export type LearnAdvance =
	| { kind: "checked" }
	| { kind: "retry" }
	| { kind: "go"; qi: number | null };

export interface LearnHandlers {
	/** A `mode: "learn"` quiz, played as a Learn. */
	isActive(): boolean;
	/** The card can be checked: a Learn question, not a reading nor a code exercise. */
	isCheckable(qi: number): boolean;
	/** The card takes part in the retry loop (checkable, and not a `pre` question). */
	isGraded(qi: number): boolean;
	isRevealed(qi: number): boolean;
	/** Checkable now: answered, not revealed yet (a flashcard checks by its rating). */
	canCheck(qi: number): boolean;
	/** A written answer revealed and waiting for the learner's own verdict. */
	isPendingSelfRating(qi: number): boolean;
	verdictOf(qi: number): LearnVerdict;
	checkQuestion(qi: number): boolean;
	/** The learner's own verdict on a self-rated card (flashcard, written answer). */
	selfVerdict(qi: number, rating: TextOnlyRating): void;
	/** The next arrow (button, bar, →) on question `qi`. */
	advance(qi: number): LearnAdvance;
	checkButtonHtml(qi: number): string;
	retryNoteHtml(qi: number): string;
	/** Keeps the Check buttons and the next arrows' labels in step with
	    answers typed without a card re-render (text fields). */
	syncControls(): void;
	summary(): LearnSummary;
	/** A fresh loop state, for the engine's assembly and `resetQuiz`. */
	emptyState(): ReturnType<typeof emptyLearnState>;
}

export function createLearnHandlers(ctx: EngineCtx): LearnHandlers {
	const s = () => ctx.quizState;

	function isActive(): boolean {
		return ctx.quizMode === "lesson";
	}

	function isReading(qi: number): boolean {
		return !!ctx.lecturesAbsorbees?.has(qi) || (ctx.isLessonMode() && ctx.roleOfQuestion(qi) === "read");
	}

	function isCheckable(qi: number): boolean {
		const q = ctx.quiz[qi];
		return isActive() && !!q && !isReading(qi) && !ctx.isCodeQuestion(q);
	}

	function isGraded(qi: number): boolean {
		return isCheckable(qi) && ctx.roleOfQuestion(qi) !== "pre";
	}

	function isRevealed(qi: number): boolean {
		return !!s().locked || (isCheckable(qi) && !!s().learnChecked?.[qi]);
	}

	function isPendingSelfRating(qi: number): boolean {
		return isCheckable(qi) && !!s().learnPending?.[qi];
	}

	function answered(qi: number): boolean {
		if (ctx.textOnly.isTextOnlyFor(qi)) return ctx.textOnly.hasAnyAnswer(qi);
		return ctx.isComplete(qi);
	}

	function canCheck(qi: number): boolean {
		if (!isCheckable(qi) || isRevealed(qi) || s().locked) return false;
		if (ctx.isFlashcardQuestion(ctx.quiz[qi])) return false;
		return answered(qi);
	}

	function verdictOf(qi: number): LearnVerdict {
		return isGraded(qi) ? s().learnVerdicts?.[qi] ?? "none" : "none";
	}

	function refresh(qi: number): void {
		ctx.commitQuestionInteraction(qi, { syncHeight: true });
	}

	function checkQuestion(qi: number): boolean {
		if (!canCheck(qi)) return false;
		const st = s();
		if (!isGraded(qi)) {
			// A `pre` question: the answer is shown, the attempt was the point.
			applyNeutralCheck(st, qi);
			ctx.recordReview(qi, ctx.isCorrect(qi) ? "correct" : "wrong");
		} else if (ctx.textOnly.isTextOnlyFor(qi)) {
			// A written answer: its model answer is shown, the learner rates it.
			st.textOnlyChecked[qi] = true;
			revealForSelfRating(st, qi);
		} else {
			const correct = ctx.isCorrect(qi);
			const outcome = applyCheck(st, qi, correct);
			// The review log keeps the FIRST attempt only (`recorded` guards the rest).
			if (outcome?.firstCheck) ctx.recordReview(qi, correct ? "correct" : "wrong");
		}
		refresh(qi);
		return true;
	}

	function selfVerdict(qi: number, rating: TextOnlyRating): void {
		if (!isGraded(qi) || s().locked) return;
		applyCheck(s(), qi, rating === "understood");
	}

	/** The retried card opens again, its answer cleared and its options
	    reshuffled: re-asking the same layout would test the memory of the
	    position, not of the answer. */
	function startRetry(qi: number, resume: number | "end"): void {
		const st = s();
		beginRetry(st, qi, resume);
		st.selections[qi] = ctx.initSelections()[qi];
		st.shuffleMap[qi] = ctx.buildShuffleMap()[qi];
		st.textOnlyAnswers[qi] = "";
		st.textOnlyChecked[qi] = false;
		st.textOnlyRatings[qi] = null;
		st.orderingPick[qi] = null;
		st.matchPick[qi] = null;
		ctx.commitQuestionInteraction(qi, { syncHeight: false });
		ctx.goToQuestion(qi);
	}

	function advance(qi: number): LearnAdvance {
		if (!isActive() || s().locked) return { kind: "go", qi: ctx.questionSuivante(qi) };
		if (canCheck(qi)) {
			checkQuestion(qi);
			return { kind: "checked" };
		}
		const move = nextLearnMove(s(), qi, q => ctx.sliceOfQuestion(q), q => ctx.questionSuivante(q));
		if (move.kind === "retry") {
			startRetry(move.qi, move.resume);
			return { kind: "retry" };
		}
		resumeNormalOrder(s());
		return { kind: "go", qi: move.qi };
	}

	function checkButtonHtml(qi: number): string {
		if (!isCheckable(qi) || isRevealed(qi) || ctx.isFlashcardQuestion(ctx.quiz[qi])) return "";
		return `<button class="quiz-action-btn success quiz-learn-check-btn" type="button" data-learn-check="${qi}"${canCheck(qi) ? "" : " disabled"}>${t("engine.learn.check")}</button>`;
	}

	function retryNoteHtml(qi: number): string {
		if (!isGraded(qi) || !s().learnRetrying?.[qi]) return "";
		return `<div class="quiz-learn-retry-note">${ICON_RETRY}<span>${t("engine.learn.retryNote")}</span></div>`;
	}

	function syncControls(): void {
		if (!isActive() || !ctx.container?.querySelectorAll) return;
		ctx.container.querySelectorAll<HTMLButtonElement>(".quiz-learn-check-btn[data-learn-check]").forEach(btn => {
			btn.disabled = !canCheck(Number(btn.dataset.learnCheck));
		});
		ctx.container.querySelectorAll<HTMLElement>('.quiz-track-item[data-slide-kind="question"]').forEach(item => {
			const qi = Number(item.dataset.qi);
			const next = item.querySelector<HTMLButtonElement>(".quiz-next-btn");
			if (!next || !Number.isInteger(qi)) return;
			const label = canCheck(qi) ? t("engine.learn.check") : next.dataset.navLabel;
			if (label && next.getAttribute("aria-label") !== label) next.setAttribute("aria-label", label);
		});
	}

	function summary(): LearnSummary {
		const graded = ctx.quiz.map((_, i) => i).filter(isGraded);
		return learnSummary(s(), graded);
	}

	return {
		isActive,
		isCheckable,
		isGraded,
		isRevealed,
		canCheck,
		isPendingSelfRating,
		verdictOf,
		checkQuestion,
		selfVerdict,
		advance,
		checkButtonHtml,
		retryNoteHtml,
		syncControls,
		summary,
		emptyState: () => emptyLearnState(ctx.quiz.length),
	};
}
