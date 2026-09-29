import type { EngineCtx } from "../types/engine-ctx";
import { t } from "../i18n";

export interface ExamHandlers {
	examTimerHtml(): string;
	startExamTimer(): void;
	startExam(): void;
	updateExamTimerDisplay(): void;
	handleExamTimeUp(): void;
	stopExamTimer(): void;
	bindExamStartButton(): void;
}

/**
 * The EXAM of a Test (spec 2026-09-29-test-practice-exam-design §3): a start
 * screen that states the duration, a visible clock, and a hand-in at zero.
 * Nothing to choose: the Learn | Exam selector of the start screen, the
 * Learn → Exam switch and the `examAutoSubmit` / `examShowTimer` options are
 * gone (§3.5) — an Exam is its own quiz, `mode: "exam"`.
 */
export function createExamHandlers(ctx: EngineCtx): ExamHandlers {
	// Local timer state.
	let examTimerId: number | null = null;
	let examStartTime = 0;

	function examTimerHtml(): string {
		if (!ctx.isExamMode) return "";
		if (!ctx.examStarted) {
			/* NO CHOICE (2026-09-24): this screen only exists because the quiz
			   has a CLOCK, and it says so before starting it — duration, number
			   of questions, a single button. */
			// examOptions is non-null in exam mode (isExamMode guard above).
			// The mm:ss format of the clock stays code; only the labels (and
			// their singular/plural agreement) go through the dictionary.
			const minutes = ctx.examOptions!.durationMinutes;
			const summaryLabel = t(minutes > 1 ? "engine.exam.duration.other" : "engine.exam.duration.one", { minutes });
			const nbQuestions = ctx.quiz.length;
			const questionCount = t(
				nbQuestions > 1 ? "engine.exam.questionCount.other" : "engine.exam.questionCount.one",
				{ count: nbQuestions }
			);
			return `<div class="quiz-exam-start-screen" data-exam-start-screen="1">
				<div class="quiz-exam-start-content">
					<div class="quiz-exam-start-icon">
						<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<line x1="10" x2="14" y1="2" y2="2"></line>
							<line x1="12" x2="15" y1="14" y2="11"></line>
							<circle cx="12" cy="14" r="8"></circle>
						</svg>
					</div>
					<div class="quiz-exam-start-title">${t("engine.exam.timedTitle")}</div>
					<div class="quiz-exam-start-duration">${summaryLabel}</div>
					<div class="quiz-exam-start-question-count">${questionCount}</div>
					<button class="quiz-exam-start-btn" type="button">${t("engine.exam.start")}</button>
				</div>
			</div>`;
		}

		const minutes = Math.floor(ctx.examTimeRemaining / 60000);
		const seconds = Math.floor((ctx.examTimeRemaining % 60000) / 1000);
		const timerDisplay = `${minutes}:${seconds.toString().padStart(2, "0")}`;

		const pct = Math.max(0, Math.min(100, (ctx.examTimeRemaining / ctx.examDurationMs) * 100));

		return `<div class="quiz-exam-timer" data-exam-timer="1">
			<div class="quiz-exam-timer-bar">
				<div class="quiz-exam-timer-progress" data-exam-progress="1" style="width: ${pct}%"> </div>
			</div>
			<div class="quiz-exam-timer-text" data-exam-text="1">${timerDisplay}</div>
		</div>`;
	}

	function startExamTimer(): void {
		if (!ctx.isExamMode || examTimerId || !ctx.examStarted || ctx.examEnded) return;

		stopExamTimer();

		examStartTime = Date.now();
		ctx.examTimeRemaining = ctx.examDurationMs;
		updateExamTimerDisplay();

		// setInterval (and not requestAnimationFrame): rAF is suspended while the
		// window is hidden or minimised → the clock would freeze and the hand-in
		// would not fire when time is up. setInterval keeps running in the
		// background (throttled to ~1 s at worst), and examTimeRemaining is always
		// recomputed from Date.now(), so handleExamTimeUp fires on time whether
		// the window is in front or not.
		const tick = () => {
			if (ctx.examEnded) return;

			const elapsed = Date.now() - examStartTime;
			ctx.examTimeRemaining = Math.max(0, ctx.examDurationMs - elapsed);

			updateExamTimerDisplay();

			if (ctx.examTimeRemaining <= 0) {
				handleExamTimeUp(); // calls stopExamTimer() → clearInterval
			}
		};

		examTimerId = window.setInterval(tick, 250);
	}

	function startExam(): void {
		if (!ctx.isExamMode || ctx.examStarted) return;

		ctx.quizState.practiceMode = "qcm";

		// Out-focus transition on the current content.
		const currentSlide = ctx.container.querySelector<HTMLElement>('.quiz-track-item[data-slide-kind="question"][data-qi="0"]');
		if (currentSlide) {
			ctx.zoom.applyOutFocusTransition(currentSlide, {
				duration: 400,
				scale: 0.95,
				blur: 10,
				onComplete: () => {
					ctx.examStarted = true;
					// Start the timer before rendering.
					startExamTimer();
					ctx.render();

					// In-focus transition on the new content.
					requestAnimationFrame(() => {
						const newSlide = ctx.container.querySelector<HTMLElement>('.quiz-track-item[data-slide-kind="question"][data-qi="0"]');
						if (newSlide) {
							ctx.zoom.applyInFocusTransition(newSlide, {
								duration: 500,
								scaleStart: 1.05,
								scaleEnd: 1,
								blurStart: 10,
								blurEnd: 0,
								opacityStart: 0,
								opacityEnd: 1
							});
						}
					});
				}
			});
		} else {
			ctx.examStarted = true;
			startExamTimer();
			ctx.render();
		}
	}

	function updateExamTimerDisplay(): void {
		const progressEl = ctx.container?.querySelector<HTMLElement>('[data-exam-progress="1"]');
		const textEl = ctx.container?.querySelector<HTMLElement>('[data-exam-text="1"]');

		if (!progressEl || !textEl) return;

		const pct = Math.max(0, Math.min(100, (ctx.examTimeRemaining / ctx.examDurationMs) * 100));
		progressEl.style.width = `${pct}%`;

		const minutes = Math.floor(ctx.examTimeRemaining / 60000);
		const seconds = Math.floor((ctx.examTimeRemaining % 60000) / 1000);
		textEl.textContent = `${minutes}:${seconds.toString().padStart(2, "0")}`;

		const timerContainer = ctx.container?.querySelector('[data-exam-timer="1"]');
		if (timerContainer) {
			timerContainer.classList.remove("quiz-exam-timer-warning", "quiz-exam-timer-danger");
			if (pct <= 20) timerContainer.classList.add("quiz-exam-timer-danger");
			else if (pct <= 50) timerContainer.classList.add("quiz-exam-timer-warning");
		}
	}

	function handleExamTimeUp(): void {
		if (ctx.examEnded) return;

		// 1. Force the timer's final state before any rendering.
		ctx.examTimeRemaining = 0;
		stopExamTimer();
		updateExamTimerDisplay();

		ctx.examEnded = true;

		// 2. Lock the quiz.
		ctx.quizState.locked = true;
		ctx.container?.classList?.add("quiz-is-locked");

		// 3. Go to the results (same action as "see the score").
		ctx.goToResults();

		ctx.host.ui.notice(t("engine.exam.timeUpLocked"), 5000);
	}

	function stopExamTimer(): void {
		if (examTimerId) {
			window.clearInterval(examTimerId);
			examTimerId = null;
		}
	}

	function bindExamStartButton(): void {
		const btn = ctx.container?.querySelector('[data-exam-start-screen="1"] .quiz-exam-start-btn');
		if (btn) btn.addEventListener("click", () => startExam());
	}

	return {
		examTimerHtml,
		startExamTimer,
		startExam,
		updateExamTimerDisplay,
		handleExamTimeUp,
		stopExamTimer,
		bindExamStartButton
	};
}
