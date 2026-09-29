import type { EngineCtx } from "../types/engine-ctx";
import { t, type TransKey } from "../i18n";

/**
 * HANDING IN A TEST (spec 2026-09-29-test-practice-exam-design §2.1, §3.3).
 *
 * A Test — Practice or Exam, any quiz that is not a Learn — shows no
 * correction until it is handed in. The last question's next arrow says
 * "Hand in the test"; with every question answered it goes straight to the
 * correction, otherwise a confirmation names what is left ("3 questions
 * unanswered — Hand in anyway?"). The submit slide stays in `slideMap` (the
 * results index depends on it) but a Test never lands on it: this
 * confirmation takes its role. A Learn keeps its own flow.
 *
 * The confirmation is portaled to `<body>`, like the hint modal: a re-render
 * of the quiz rewrites the container's HTML and would drop it. `closeConfirm`
 * is what the Exam's clock calls when time is up while it is open.
 *
 * The three decisions that tell a Test from a Learn at the end of the quiz
 * live HERE, not in the DOM code that applies them (cards.ts,
 * interactions.ts), so that `check:engine-review` holds them: where "past
 * the last question" goes, the last arrow's label, and whether hints show.
 */
export interface HandInHandlers {
	/** A Test (Practice or Exam): anything but a Learn. */
	isTest(): boolean;
	/** Hand the test in: straight to the correction when complete, else ask. */
	handIn(): void;
	/** Past the last question — the → key, the Results tab and the last
	    card's next arrow: ONE rule, three copies would diverge. */
	pastLastQuestion(): void;
	/** The label of the last question's next arrow. */
	lastArrowLabel(): TransKey;
	/** Hints show everywhere but in an Exam (spec 2026-09-29 §3.2): no help
	    while answering, the hints stay in the file. */
	showsHints(): boolean;
	isConfirmOpen(): boolean;
	/** Closes the confirmation if it is open; true when it was. */
	closeConfirm(): boolean;
}

export function createHandInHandlers(ctx: EngineCtx): HandInHandlers {
	let overlay: HTMLElement | null = null;
	let onKey: ((e: KeyboardEvent) => void) | null = null;
	let returnFocus: HTMLElement | null = null;

	function isTest(): boolean {
		return ctx.quizMode !== "lesson";
	}

	function showsHints(): boolean {
		return !ctx.isExamMode;
	}

	/* The whole-quiz text-only branches come first: skipping the submit
	   screen only makes sense when the WHOLE quiz is in free answer (the
	   historical path, `practiceMode === "text"`) — a Learn slice mixing
	   "test" and "recall" keeps its submit step, which checks the missing
	   questions of the whole quiz. */
	function pastLastQuestion(): void {
		if (ctx.textOnly?.isExamAnswerPhase?.()) ctx.goToSubmit();
		else if (ctx.textOnly?.isTextOnlyMode?.()) ctx.goToResults();
		else if (ctx.quizState.locked) ctx.goToSlide(ctx.SLIDE_RESULTS_INDEX, { forceRender: false });
		// A Test never lands on the submit slide: it is handed in.
		else if (isTest()) handIn();
		else ctx.goToSubmit();
	}

	function lastArrowLabel(): TransKey {
		if (ctx.textOnly?.isExamAnswerPhase?.()) return "engine.exam.finish";
		return isTest() && !ctx.quizState.locked ? "engine.handIn.button" : "engine.nav.results";
	}

	function isConfirmOpen(): boolean {
		return overlay !== null;
	}

	function closeConfirm(): boolean {
		if (!overlay) return false;
		overlay.remove();
		overlay = null;
		if (onKey) document.removeEventListener("keydown", onKey, true);
		onKey = null;
		if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
		returnFocus = null;
		return true;
	}

	function confirmHandIn(): void {
		closeConfirm();
		ctx.goToResults();
	}

	function openConfirm(missing: number[]): void {
		closeConfirm();
		const active = document.activeElement as HTMLElement | null;
		returnFocus = active && typeof active.focus === "function" ? active : null;
		const numero = (i: number): number => ctx.numeroAffiche?.(i) ?? i + 1;
		const titleId = `${ctx.HINT_TITLE_ID}_handin`;
		const title = t(missing.length > 1 ? "engine.handIn.unanswered.other" : "engine.handIn.unanswered.one", { count: missing.length });
		const perles = missing.map(i =>
			`<button class="quiz-submit-perle" type="button" data-jump="${i}" aria-label="${ctx.escapeHtmlAttr(t("engine.submit.goTo", { n: numero(i) }))}">${numero(i)}</button>`
		).join("");
		const el = document.createElement("div");
		el.className = "quiz-handin-overlay";
		el.innerHTML = `<div class="quiz-handin-modal" role="alertdialog" aria-modal="true" aria-labelledby="${titleId}">`
			+ `<div class="quiz-handin-title" id="${titleId}">${ctx.escapeHtmlText(title)}</div>`
			+ `<div class="quiz-handin-sub">${ctx.escapeHtmlText(t("engine.handIn.confirmSub"))}</div>`
			+ `<div class="quiz-submit-perles">${perles}</div>`
			+ `<div class="quiz-actions">`
			+ `<button class="quiz-action-btn quiz-handin-cancel" type="button">${ctx.escapeHtmlText(t("engine.handIn.keepAnswering"))}</button>`
			+ `<button class="quiz-action-btn success quiz-handin-confirm" type="button">${ctx.escapeHtmlText(t("engine.handIn.confirm"))}</button>`
			+ `</div></div>`;
		el.addEventListener("click", e => { if (e.target === el) closeConfirm(); });
		el.querySelector(".quiz-handin-cancel")?.addEventListener("click", () => closeConfirm());
		el.querySelector(".quiz-handin-confirm")?.addEventListener("click", () => confirmHandIn());
		el.querySelectorAll<HTMLElement>("[data-jump]").forEach(btn => btn.addEventListener("click", () => {
			closeConfirm();
			ctx.goToQuestion(Number(btn.dataset.jump));
		}));
		/* Capture phase: the quiz's own → / ← keys (interactions.ts) must not
		   move the track behind an open dialog. Escape closes it; Tab stays
		   inside it. */
		onKey = (e: KeyboardEvent) => {
			if (!overlay) return;
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				closeConfirm();
				return;
			}
			if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
				e.stopPropagation();
				return;
			}
			if (e.key !== "Tab") return;
			const focusable = overlay.querySelectorAll<HTMLElement>("button");
			if (focusable.length === 0) return;
			const first = focusable[0], last = focusable[focusable.length - 1];
			/* Focus OUTSIDE the dialog (a click on its text sends it to
			   <body>): Tab brings it back instead of reaching the quiz behind. */
			if (!overlay.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
			else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
			else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
		};
		document.addEventListener("keydown", onKey, true);
		document.body.appendChild(el);
		overlay = el;
		/* Focus on the SAFE choice: handing in locks the quiz and writes the
		   verdicts, and the Enter that opened this dialog (or its key repeat)
		   must not be the one that confirms it. */
		el.querySelector<HTMLElement>(".quiz-handin-cancel")?.focus({ preventScroll: true });
	}

	function handIn(): void {
		if (ctx.quizState.locked) {
			ctx.goToSlide(ctx.SLIDE_RESULTS_INDEX, { forceRender: false });
			return;
		}
		const missing = ctx.getMissingIndices();
		if (missing.length === 0) ctx.goToResults();
		else openConfirm(missing);
	}

	ctx.__quizGlobalCleanups.push(() => { closeConfirm(); });

	return { isTest, handIn, pastLastQuestion, lastArrowLabel, showsHints, isConfirmOpen, closeConfirm };
}
