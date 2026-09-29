import { ajouter } from "../dom";
import { requireHost } from "../host/current";
import { t } from "../i18n";
import { fallbackExamDuration } from "../quiz-utils";
import { isExamSetup, withExamMode, withHints, withTimeLimit, type TestSetup } from "../test-setup";

/* ══════════════════════════════════════════════════════════
   THE "SET UP YOUR TEST" MODAL (spec 2026-09-29-test-setup-modal-design.md §1).

   Opened through the host's modals (`HostModals`, so it wears the look of the
   app's other modals), asked when a Test starts and on "Try again".

   The state is a `TestSetup` and nothing else: the Exam mode switch is
   DERIVED (`isExamSetup`), never stored, so it cannot disagree with Hints
   and Time limit. The rules (turning Exam mode on, the bounds of the
   duration) are those of `src/test-setup.ts`; this file only draws them.

   Two things the pure core does not remember, because it is stateless:
   - the LAST DURATION: turning Time limit off and on again, or Exam mode off
     and on, brings back the duration that was there, not the fallback rule;
   - the "Keep exam mode" box, whose value survives Exam mode being switched
     off (it is disabled then, and shown unchecked, but comes back).

   Keyboard: Tab follows the page order; Space toggles the focused switch or
   box (they are real controls: `role="switch"` buttons and an `<input>`);
   ENTER STARTS from anywhere (except on the close cross); Escape cancels,
   and so does a click on the backdrop or the cross (the host handles those).
   The Start button takes the focus, so that a player who wants the same
   settings as last time presses Enter once.
══════════════════════════════════════════════════════════ */

export interface TestSetupModalOptions {
	/** The quiz's title, shown small above the heading. */
	title: string;
	questionCount: number;
	/** What the modal opens on: the settings last used for this quiz, else the file's. */
	defaults: TestSetup;
	/** The note says `mode: "exam"`: "Keep exam mode" opens checked. */
	examByDefault: boolean;
	/** The host can write the note: without it the box is not shown. */
	canKeep: boolean;
}

export interface TestSetupChoice {
	setup: TestSetup;
	/** The state of the "Keep exam mode" box. Only meaningful for a setup that
	    is an exam (`keepExamChange`): a test played without Exam mode never
	    touches the note. */
	keep: boolean;
}

/** The duration shortcuts, in minutes. */
export const DURATION_SHORTCUTS = [30, 60, 90, 120] as const;

let counter = 0;

/**
 * Opens the modal. Resolves with the player's choice, or `null` when the
 * modal is closed without starting (Escape, cross, backdrop, or `signal`
 * aborted — the host uses that when the page is left while the modal is up).
 */
export function openTestSetupModal(opts: TestSetupModalOptions, signal?: AbortSignal): Promise<TestSetupChoice | null> {
	if (signal?.aborted) return Promise.resolve(null);
	return new Promise<TestSetupChoice | null>((resolve) => {
		const n = opts.questionCount;
		let setup: TestSetup = { ...opts.defaults };
		let keep = opts.examByDefault;
		let lastMinutes = setup.timeLimitMinutes ?? fallbackExamDuration(n);
		let answered = false;
		let handle: { close(): void } | null = null;

		const answer = (choice: TestSetupChoice | null): void => {
			if (answered) return;
			answered = true;
			signal?.removeEventListener("abort", onAbort);
			resolve(choice);
			handle?.close();
		};
		const onAbort = (): void => answer(null);
		signal?.addEventListener("abort", onAbort);

		handle = requireHost("modals").open({
			className: "qbd-setup-modal",
			onOpen: (m) => {
				const id = `nq-setup-${++counter}`;
				m.panelEl.setAttribute("aria-labelledby", `${id}-title`);
				const c = m.contentEl;

				const head = ajouter(c, "div", "qbd-setup-head");
				ajouter(head, "p", "qbd-setup-quiz", opts.title);
				ajouter(head, "h2", "qbd-setup-title", t("engine.testSetup.title")).id = `${id}-title`;
				ajouter(head, "p", "qbd-setup-count", t(n === 1 ? "engine.exam.questionCount.one" : "engine.exam.questionCount.other", { count: n }));

				const rows = ajouter(c, "div", "qbd-setup-rows");

				/** A row: the label (and a muted line under it) on the left, the control on the right. */
				const row = (key: string, label: string, help?: string): { row: HTMLElement; side: HTMLElement } => {
					const r = ajouter(rows, "div", "qbd-setup-row");
					const text = ajouter(r, "div", "qbd-setup-text");
					ajouter(text, "span", "qbd-setup-label", label).id = `${id}-${key}`;
					if (help) ajouter(text, "span", "qbd-setup-help", help);
					return { row: r, side: ajouter(r, "div", "qbd-setup-side") };
				};
				/** A switch: a real button with `role="switch"`; a click on its row toggles it too. */
				const makeSwitch = (parent: HTMLElement, rowEl: HTMLElement, key: string, onToggle: (on: boolean) => void): HTMLButtonElement => {
					const sw = ajouter(parent, "button", "qbd-setup-switch");
					sw.type = "button";
					sw.setAttribute("role", "switch");
					sw.setAttribute("aria-labelledby", `${id}-${key}`);
					ajouter(sw, "span", "qbd-setup-switch-thumb");
					sw.addEventListener("click", () => onToggle(sw.getAttribute("aria-checked") !== "true"));
					rowEl.addEventListener("click", (e) => { if (!sw.contains(e.target as Node)) sw.click(); });
					return sw;
				};

				// ── Exam mode, and under it Keep exam mode ──
				const exam = row("exam", t("engine.testSetup.examMode"), t("engine.testSetup.examModeHelp"));
				const examSwitch = makeSwitch(exam.side, exam.row, "exam", (on) => {
					// Turning Exam mode on brings back the last duration, not the fallback rule.
					setup = withExamMode({ ...setup, timeLimitMinutes: setup.timeLimitMinutes ?? lastMinutes }, on, n);
					sync();
				});

				let keepBox: HTMLInputElement | null = null;
				if (opts.canKeep) {
					const keepRow = ajouter(rows, "label", "qbd-setup-keep");
					keepBox = ajouter(keepRow, "input", "qbd-setup-check");
					keepBox.type = "checkbox";
					ajouter(keepRow, "span", undefined, t("engine.testSetup.keepExam"));
					keepBox.addEventListener("change", () => { keep = (keepBox as HTMLInputElement).checked; });
				}

				// ── Hints ──
				const hints = row("hints", t("engine.testSetup.hints"));
				const hintsSwitch = makeSwitch(hints.side, hints.row, "hints", (on) => {
					setup = withHints(setup, on);
					sync();
				});

				// ── Time limit, and its total duration ──
				const limit = row("limit", t("engine.testSetup.timeLimit"));
				const limitSwitch = makeSwitch(limit.side, limit.row, "limit", (on) => {
					setup = withTimeLimit(setup, on ? lastMinutes : null, n);
					if (setup.timeLimitMinutes !== null) lastMinutes = setup.timeLimitMinutes;
					sync();
				});

				const durationRow = ajouter(rows, "div", "qbd-setup-row qbd-setup-duration");
				ajouter(ajouter(durationRow, "div", "qbd-setup-text"), "span", "qbd-setup-label", t("engine.testSetup.duration")).id = `${id}-duration`;
				const durationSide = ajouter(durationRow, "div", "qbd-setup-side");
				const segments = ajouter(durationSide, "div", "qbd-setup-segments");
				segments.setAttribute("role", "group");
				segments.setAttribute("aria-labelledby", `${id}-duration`);
				const segmentButtons = DURATION_SHORTCUTS.map((minutes) => {
					const b = ajouter(segments, "button", "qbd-setup-segment", t("engine.testSetup.shortcut", { minutes }));
					b.type = "button";
					b.addEventListener("click", () => {
						setup = withTimeLimit(setup, minutes, n);
						lastMinutes = minutes;
						sync();
					});
					return { minutes, b };
				});
				const field = ajouter(durationSide, "input", "qbd-setup-field");
				field.type = "number";
				field.min = "1";
				field.max = "300";
				field.step = "1";
				field.inputMode = "numeric";
				field.setAttribute("aria-labelledby", `${id}-duration`);
				ajouter(durationSide, "span", "qbd-setup-unit", t("engine.testSetup.minutesUnit"));

				/** The typed text as it stands: a whole number within [1, 300] is
				    taken at once (the shortcuts follow); anything else waits for
				    `commit`, and never reaches the setup. */
				field.addEventListener("input", () => {
					const v = field.value.trim() === "" ? NaN : Number(field.value);
					const valid = Number.isInteger(v) && v >= 1 && v <= 300;
					field.setAttribute("aria-invalid", valid || field.value.trim() === "" ? "false" : "true");
					if (!valid) return;
					setup = withTimeLimit(setup, v, n);
					lastMinutes = v;
					syncSegments();
				});
				/** Leaving the field, or starting: an empty or unusable text goes back
				    to the current duration, a number out of range is brought within it. */
				const commit = (): void => {
					if (setup.timeLimitMinutes === null) return;
					const raw = field.value.trim();
					if (raw !== "" && Number.isFinite(Number(raw))) {
						setup = withTimeLimit(setup, Number(raw), n);
						lastMinutes = setup.timeLimitMinutes as number;
					}
					field.setAttribute("aria-invalid", "false");
					sync();
				};
				field.addEventListener("change", commit);

				function syncSegments(): void {
					for (const { minutes, b } of segmentButtons) b.setAttribute("aria-pressed", String(setup.timeLimitMinutes === minutes));
				}
				/** Paints the state on the controls, in place: the focus never moves. */
				function sync(): void {
					const isExam = isExamSetup(setup);
					examSwitch.setAttribute("aria-checked", String(isExam));
					hintsSwitch.setAttribute("aria-checked", String(setup.hints));
					limitSwitch.setAttribute("aria-checked", String(setup.timeLimitMinutes !== null));
					if (keepBox) {
						keepBox.disabled = !isExam;
						keepBox.checked = isExam && keep;
					}
					durationRow.hidden = setup.timeLimitMinutes === null;
					if (setup.timeLimitMinutes !== null && document.activeElement !== field) field.value = String(setup.timeLimitMinutes);
					syncSegments();
				}
				sync();

				// ── Footer: a thin separator, the primary button at the right ──
				const foot = ajouter(c, "div", "qbd-setup-foot");
				const start = ajouter(foot, "button", "qbd-setup-start", t("engine.testSetup.start"));
				start.type = "button";
				const begin = (): void => {
					commit();
					answer({ setup: { ...setup }, keep });
				};
				start.addEventListener("click", begin);

				// Enter starts from anywhere, except on the host's close cross.
				m.panelEl.addEventListener("keydown", (e: KeyboardEvent) => {
					if (e.key !== "Enter" || e.isComposing || (e.target as HTMLElement).closest(".modal-close-button")) return;
					e.preventDefault();
					begin();
				});

				start.focus();
			},
			// Escape, the cross and the backdrop close the host's modal: that is a cancel.
			onClose: () => answer(null),
		});
		// The modal was closed while `open` was still running (it cannot be, but a
		// host is free to close in `onOpen`): nothing to do, `answer` has resolved.
		if (answered) handle.close();
	});
}
