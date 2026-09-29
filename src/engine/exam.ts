import type { EngineCtx } from "../types/engine-ctx";
import { t } from "../i18n";

/** The clock's text: `m:ss`, and `h:mm:ss` from an hour on — an Exam lasts
    up to 300 minutes, and "125:00" does not read as a time (spec 2026-09-29
    §3.2). Whole seconds rounded UP, like any countdown: the full duration
    shows for its first second, and "0:00" only when the time is really up —
    the moment of the hand-in. Never negative. PURE. */
export function formatExamClock(ms: number): string {
	const total = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const ss = s.toString().padStart(2, "0");
	return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export interface ExamHandlers {
	examTimerHtml(): string;
	paintExamTimerIcon(): void;
	startExamTimer(): void;
	startExam(): void;
	updateExamTimerDisplay(): void;
	handleExamTimeUp(): void;
	stopExamTimer(): void;
	bindExamStartButton(): void;
	/** Milliseconds left on the clock RIGHT NOW (never a stale tick): what a
	    snapshot stores so a paused test resumes from the time it had left. */
	remainingMs(): number;
}

/**
 * The CLOCK of a Test (specs 2026-09-29-test-practice-exam-design §3 and
 * 2026-09-29-test-setup-modal-design §3): a visible countdown and a hand-in
 * at zero. `ctx.isExamMode` means "this test has a clock". Played with a setup
 * (the app), the time limit was chosen in the launch modal and the clock
 * starts as soon as the test renders; played without one (the Obsidian
 * plugin), a start screen states the duration first (`mode: "exam"`). The
 * countdown starts from `ctx.examTimeRemaining`: the whole duration at a
 * fresh start, the time left when a paused test is resumed. Nothing to
 * choose here: the Learn | Exam selector, the Learn → Exam switch and the
 * `examAutoSubmit` / `examShowTimer` options are gone (§3.5).
 */
export function createExamHandlers(ctx: EngineCtx): ExamHandlers {
	// Local timer state.
	let examTimerId: number | null = null;
	/* The instant the clock reaches zero. The remaining time is always
	   recomputed from it, never accumulated tick by tick. */
	let examDeadline = 0;

	function examTimerHtml(): string {
		if (!ctx.isExamMode) return "";
		if (!ctx.examStarted) {
			/* NO CHOICE (2026-09-24): this screen only exists because the quiz
			   has a CLOCK, and it says so before starting it — duration, number
			   of questions, a single button. */
			// examOptions is non-null in exam mode (isExamMode guard above).
			// The clock's format stays code (formatExamClock); only the labels
			// (and their singular/plural agreement) go through the dictionary.
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

		const timerDisplay = formatExamClock(ctx.examTimeRemaining);

		const pct = Math.max(0, Math.min(100, (ctx.examTimeRemaining / ctx.examDurationMs) * 100));

		/* `--quiz-exam-pct`: the share of time left, for a host that draws the
		   clock as a ring (the app, quiz-bars.css) rather than a track. */
		return `<div class="quiz-exam-timer" data-exam-timer="1" style="--quiz-exam-pct: ${pct}">
			<div class="quiz-exam-timer-bar">
				<div class="quiz-exam-timer-progress" data-exam-progress="1" style="width: ${pct}%"> </div>
			</div>
			<div class="quiz-exam-timer-pill">
				<span class="quiz-exam-timer-icon" data-exam-icon="1"></span>
				<span class="quiz-exam-timer-text" data-exam-text="1">${timerDisplay}</span>
			</div>
		</div>`;
	}

	/** Draws the pill's icon through the host (the markup above is a string, so
	    the icon can only be set once it is in the DOM). Called right after each
	    render that includes the clock. */
	function paintExamTimerIcon(): void {
		const el = ctx.container?.querySelector<HTMLElement>('[data-exam-icon="1"]');
		if (el && !el.firstChild) ctx.host.ui.setIcon(el, "timer");
	}

	function startExamTimer(): void {
		if (!ctx.isExamMode || examTimerId || !ctx.examStarted || ctx.examEnded) return;

		stopExamTimer();

		// Counts down from what is left: the whole duration at a fresh start
		// (set by the launch and by "Try again"), less when a test is resumed.
		examDeadline = Date.now() + ctx.examTimeRemaining;
		updateExamTimerDisplay();

		// setInterval (and not requestAnimationFrame): rAF is suspended while the
		// window is hidden or minimised → the clock would freeze and the hand-in
		// would not fire when time is up. setInterval keeps running in the
		// background (throttled to ~1 s at worst), and examTimeRemaining is always
		// recomputed from Date.now(), so handleExamTimeUp fires on time whether
		// the window is in front or not.
		const tick = () => {
			/* A destroyed engine (the note or the page closed) never hands in:
			   an abandoned Exam leaves no attempt and no verdict (§3.4). */
			if (ctx.examEnded || ctx.isDestroyed()) return;

			ctx.examTimeRemaining = Math.max(0, examDeadline - Date.now());

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
					if (ctx.isDestroyed()) return;
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

		textEl.textContent = formatExamClock(ctx.examTimeRemaining);

		const timerContainer = ctx.container?.querySelector<HTMLElement>('[data-exam-timer="1"]');
		if (timerContainer) {
			timerContainer.style.setProperty("--quiz-exam-pct", String(pct));
			timerContainer.classList.remove("quiz-exam-timer-warning", "quiz-exam-timer-danger", "quiz-exam-timer-critical");
			if (pct <= 20) timerContainer.classList.add("quiz-exam-timer-danger");
			else if (pct <= 50) timerContainer.classList.add("quiz-exam-timer-warning");
			// Last minute: the pill pulses gently (only while time is still running).
			if (ctx.examTimeRemaining > 0 && ctx.examTimeRemaining <= 60_000) timerContainer.classList.add("quiz-exam-timer-critical");
		}
	}

	function handleExamTimeUp(): void {
		if (ctx.examEnded) return;

		// 1. Force the timer's final state before any rendering.
		ctx.examTimeRemaining = 0;
		stopExamTimer();
		updateExamTimerDisplay();

		ctx.examEnded = true;

		/* The "Hand in anyway?" confirmation may be open: time decides for
		   the user — it closes and the test is handed in with the answers
		   given so far (spec 2026-09-29 §3.3). */
		ctx.handIn?.closeConfirm();

		// 2. Lock the quiz.
		ctx.quizState.locked = true;
		ctx.container?.classList?.add("quiz-is-locked");

		// 3. Go to the results (same action as "see the score").
		ctx.goToResults();

		ctx.host.ui.notice(t("engine.exam.timeUp"), 5000);
	}

	function stopExamTimer(): void {
		if (examTimerId) {
			// Keep what was left: a snapshot taken after the stop (the engine is
			// being destroyed) must not read a value one tick stale.
			ctx.examTimeRemaining = Math.max(0, examDeadline - Date.now());
			window.clearInterval(examTimerId);
			examTimerId = null;
		}
	}

	function remainingMs(): number {
		return examTimerId ? Math.max(0, examDeadline - Date.now()) : ctx.examTimeRemaining;
	}

	function bindExamStartButton(): void {
		const btn = ctx.container?.querySelector('[data-exam-start-screen="1"] .quiz-exam-start-btn');
		if (btn) btn.addEventListener("click", () => startExam());
	}

	return {
		examTimerHtml,
		paintExamTimerIcon,
		startExamTimer,
		startExam,
		updateExamTimerDisplay,
		handleExamTimeUp,
		stopExamTimer,
		bindExamStartButton,
		remainingMs
	};
}
