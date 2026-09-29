import { ajouter } from "../dom";
import { poserBouton3d } from "../dashboard/cta3d";
import { currentHost, requireHost } from "../host/current";
import { t } from "../i18n";
import { fallbackExamDuration } from "../quiz-utils";
import { isExamSetup, stepTimeLimit, withExamMode, withHints, withTimeLimit, type TestSetup } from "../test-setup";

/* ══════════════════════════════════════════════════════════
   THE "SET UP YOUR TEST" MODAL (spec 2026-09-29-test-setup-modal-design.md §1).

   Opened through the host's modals (`HostModals`, so it wears the look of the
   app's other modals), asked when a Test starts and on "Try again".

   The state is a `TestSetup` and nothing else: the Exam mode switch is
   DERIVED (`isExamSetup`), never stored, so it cannot disagree with Hints
   and Time limit. The rules (turning Exam mode on, the bounds of the
   duration) are those of `src/test-setup.ts`; this file only draws them.

   What the pure core does not remember, because it is stateless: the LAST
   DURATION. Turning Time limit off and on again, or Exam mode off and on,
   brings back the duration that was there, not the fallback rule.

   EXAM MODE LOCKS WHAT IT SETS (2026-09-29). Hints and Time limit are ONE
   row each, always in the same place below the Exam card. Switched on, Exam
   mode shows them at the values it forces (Hints off, Time limit on) with
   their switches locked (`aria-disabled`, dimmed, out of the tab order, no
   click) and a "Set by exam mode" line under its own row; switched off, they
   are editable again. Nothing moves: only the state of the controls changes.

   TIME LIMIT IS A STEPPER, on its own row, between the label and the switch
   and only while the limit is on: `[-] 30 min [+]`. The buttons step by 5
   minutes (`stepTimeLimit`, the pure rule), ArrowUp / ArrowDown too; the
   value is a text field to type a number into, taken on Enter or on leaving
   it (an empty or unusable text goes back to the current value, a number out
   of range is brought within [1, 300]) and dropped on Escape. The stepper
   stays editable while Exam mode locks the switch: the duration is the one
   thing Exam mode leaves to the player.

   "Keep exam mode" is not here: it writes the note, and a modal that opens
   when a test starts must not. It lives in the quiz's "⋯" menus
   (`dashboard/exam-keep-menu.ts`).

   Keyboard: Tab follows the page order; Space toggles the focused switch
   (real controls: `role="switch"` buttons); ENTER STARTS from anywhere
   (except on the close cross); Escape cancels, and so does a click on the
   backdrop or the cross (the host handles those).
   The Start button takes the focus, so that a player who wants the same
   settings as last time presses Enter once.
══════════════════════════════════════════════════════════ */

export interface TestSetupModalOptions {
	/** The quiz's title, shown small above the heading. */
	title: string;
	questionCount: number;
	/** What the modal opens on: the settings last used for this quiz, else the file's. */
	defaults: TestSetup;
}

let counter = 0;

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(parent: Element, tag: string, attrs: Record<string, string>): SVGElement {
	const node = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
	parent.appendChild(node);
	return node;
}

/** The header's illustration: two stacked, slightly rotated sheets, the front
    one carrying three lines of text. Pure decoration (`aria-hidden`), drawn
    inline so that no asset ships; the colours come from the CSS classes, in the
    app's blue. */
function drawSheets(parent: HTMLElement): void {
	const svg = svgEl(parent, "svg", { viewBox: "0 0 64 64", width: "64", height: "64", class: "qbd-setup-art", "aria-hidden": "true", focusable: "false" });
	svgEl(svg, "rect", { x: "22", y: "6", width: "34", height: "44", rx: "7", transform: "rotate(10 39 28)", class: "qbd-setup-art-back" });
	const front = svgEl(svg, "g", { transform: "rotate(-8 27 36)" });
	svgEl(front, "rect", { x: "10", y: "14", width: "34", height: "44", rx: "7", class: "qbd-setup-art-front" });
	svgEl(front, "rect", { x: "17", y: "25", width: "20", height: "4", rx: "2", class: "qbd-setup-art-line" });
	svgEl(front, "rect", { x: "17", y: "35", width: "20", height: "3", rx: "1.5", class: "qbd-setup-art-line is-soft" });
	svgEl(front, "rect", { x: "17", y: "43", width: "13", height: "3", rx: "1.5", class: "qbd-setup-art-line is-soft" });
}

/**
 * Opens the modal. Resolves with the settings chosen, or `null` when the
 * modal is closed without starting (Escape, cross, backdrop, or `signal`
 * aborted — the host uses that when the page is left while the modal is up).
 */
export function openTestSetupModal(opts: TestSetupModalOptions, signal?: AbortSignal): Promise<TestSetup | null> {
	if (signal?.aborted) return Promise.resolve(null);
	return new Promise<TestSetup | null>((resolve) => {
		const n = opts.questionCount;
		let setup: TestSetup = { ...opts.defaults };
		let lastMinutes = setup.timeLimitMinutes ?? fallbackExamDuration(n);
		let answered = false;
		let handle: { close(): void } | null = null;

		const answer = (choice: TestSetup | null): void => {
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

				const ui = currentHost().ui;
				/** A Lucide icon in a tinted rounded square. */
				const iconBox = (parent: HTMLElement, name: string): void => {
					ui.setIcon(ajouter(parent, "span", "qbd-setup-ico"), name);
				};

				const head = ajouter(c, "div", "qbd-setup-head");
				const headText = ajouter(head, "div", "qbd-setup-headtext");
				ajouter(headText, "p", "qbd-setup-quiz", opts.title);
				ajouter(headText, "h2", "qbd-setup-title", t("engine.testSetup.title")).id = `${id}-title`;
				const count = ajouter(headText, "p", "qbd-setup-count");
				ui.setIcon(ajouter(count, "span", "qbd-setup-count-ico"), "list-checks");
				ajouter(count, "span", undefined, t(n === 1 ? "engine.exam.questionCount.one" : "engine.exam.questionCount.other", { count: n }));
				drawSheets(head);

				/** A row: an icon, the label (and a muted line under it), the control on the right. */
				const row = (parent: HTMLElement, icon: string, key: string, label: string, help?: string): { row: HTMLElement; text: HTMLElement; side: HTMLElement } => {
					const r = ajouter(parent, "div", "qbd-setup-row");
					iconBox(r, icon);
					const text = ajouter(r, "div", "qbd-setup-text");
					ajouter(text, "span", "qbd-setup-label", label).id = `${id}-${key}`;
					if (help) ajouter(text, "span", "qbd-setup-help", help);
					return { row: r, text, side: ajouter(r, "div", "qbd-setup-side") };
				};
				/** A switch: a real button with `role="switch"`; a click on its row toggles it too.
				    Returns it with `lock(on)`: shown but not operable (`aria-disabled`, out of
				    the tab order, no click, the row dimmed by `.is-locked`). */
				const makeSwitch = (parent: HTMLElement, rowEl: HTMLElement, key: string, onToggle: (on: boolean) => void): { sw: HTMLButtonElement; lock(on: boolean): void } => {
					const sw = ajouter(parent, "button", "qbd-setup-switch");
					sw.type = "button";
					sw.setAttribute("role", "switch");
					sw.setAttribute("aria-labelledby", `${id}-${key}`);
					ajouter(sw, "span", "qbd-setup-switch-thumb");
					const locked = (): boolean => sw.getAttribute("aria-disabled") === "true";
					sw.addEventListener("click", () => { if (!locked()) onToggle(sw.getAttribute("aria-checked") !== "true"); });
					rowEl.addEventListener("click", (e) => { if (!sw.contains(e.target as Node)) sw.click(); });
					return {
						sw,
						lock: (on) => {
							sw.setAttribute("aria-disabled", String(on));
							sw.tabIndex = on ? -1 : 0;
							rowEl.classList.toggle("is-locked", on);
						},
					};
				};

				// ── Exam mode, and under it the note that says what it sets: one tinted card ──
				const examCard = ajouter(c, "div", "qbd-setup-exam");
				const exam = row(examCard, "graduation-cap", "exam", t("engine.testSetup.examMode"), t("engine.testSetup.examModeHelp"));
				const examSwitch = makeSwitch(exam.side, exam.row, "exam", (on) => {
					// Turning Exam mode on brings back the last duration, not the fallback rule.
					setup = withExamMode({ ...setup, timeLimitMinutes: setup.timeLimitMinutes ?? lastMinutes }, on, n);
					sync();
				});
				const lockNote = ajouter(examCard, "p", "qbd-setup-locknote");
				ui.setIcon(ajouter(lockNote, "span", "qbd-setup-locknote-ico"), "lock");
				ajouter(lockNote, "span", undefined, t("engine.testSetup.examLocked"));

				ajouter(c, "div", "qbd-setup-sep");
				const rows = ajouter(c, "div", "qbd-setup-rows");

				// ── Hints ──
				const hints = row(rows, "lightbulb", "hints", t("engine.testSetup.hints"));
				const hintsSwitch = makeSwitch(hints.side, hints.row, "hints", (on) => {
					setup = withHints(setup, on);
					sync();
				});

				// ── Time limit: the stepper, then the switch ──
				const limit = row(rows, "timer", "limit", t("engine.testSetup.timeLimit"));
				const limitHelp = ajouter(limit.text, "span", "qbd-setup-help", t("engine.testSetup.totalHelp"));
				const stepper = ajouter(limit.side, "div", "qbd-setup-stepper");
				stepper.setAttribute("role", "group");
				stepper.setAttribute("aria-labelledby", `${id}-limit`);
				// The row toggles the switch on a click: a click on the stepper is not one.
				stepper.addEventListener("click", (e) => e.stopPropagation());
				const stepButton = (icon: string, label: string, direction: 1 | -1): HTMLButtonElement => {
					const b = ajouter(stepper, "button", "qbd-setup-step");
					b.type = "button";
					b.setAttribute("aria-label", label);
					ui.setIcon(ajouter(b, "span", "qbd-setup-step-ico"), icon);
					// `aria-disabled`, not `disabled`: a button that gets the focus and then
					// disables itself at a bound would drop the keyboard user onto <body>.
					b.addEventListener("click", () => { if (b.getAttribute("aria-disabled") !== "true") step(direction); });
					return b;
				};
				const lessButton = stepButton("minus", t("engine.testSetup.less"), -1);
				const valueBox = ajouter(stepper, "label", "qbd-setup-value");
				const field = ajouter(valueBox, "input", "qbd-setup-field");
				field.type = "text";
				field.inputMode = "numeric";
				field.autocomplete = "off";
				field.maxLength = 3;
				field.setAttribute("aria-labelledby", `${id}-limit`);
				ajouter(valueBox, "span", "qbd-setup-unit", t("engine.testSetup.minutesUnit"));
				const moreButton = stepButton("plus", t("engine.testSetup.more"), 1);
				const limitSwitch = makeSwitch(limit.side, limit.row, "limit", (on) => {
					setup = withTimeLimit(setup, on ? lastMinutes : null, n);
					if (setup.timeLimitMinutes !== null) lastMinutes = setup.timeLimitMinutes;
					sync();
				});

				/** Takes a duration: brings it within [1, 300], remembers it, repaints
				    (the field too, even when it has the focus). */
				const setMinutes = (minutes: number): void => {
					setup = withTimeLimit(setup, minutes, n);
					lastMinutes = setup.timeLimitMinutes as number;
					sync();
					field.value = String(lastMinutes);
					field.removeAttribute("aria-invalid");
				};
				/** One press of `-` or `+`, from what is typed if it is usable. */
				function step(direction: 1 | -1): void {
					if (setup.timeLimitMinutes === null) return;
					const typed = field.value.trim() === "" ? NaN : Number(field.value);
					setMinutes(stepTimeLimit(Number.isFinite(typed) ? typed : setup.timeLimitMinutes, direction, n));
				}
				/** Leaving the field, Enter, or starting: an empty or unusable text goes
				    back to the current duration, a number out of range is brought within it. */
				const commit = (): void => {
					if (setup.timeLimitMinutes === null) return;
					const raw = field.value.trim();
					setMinutes(raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : setup.timeLimitMinutes);
				};
				// Digits only, and a flag on what will not be taken as it stands.
				field.addEventListener("input", () => {
					field.value = field.value.replace(/\D/g, "");
					const v = Number(field.value);
					field.setAttribute("aria-invalid", String(field.value !== "" && (v < 1 || v > 300)));
				});
				field.addEventListener("focus", () => field.select());
				field.addEventListener("blur", commit);
				field.addEventListener("keydown", (e) => {
					if (e.isComposing) return;
					if (e.key === "Enter") {
						// Validates the number and starts nothing: the modal's Enter is for the Start button.
						e.preventDefault();
						e.stopPropagation();
						commit();
						field.select();
					} else if (e.key === "Escape" && setup.timeLimitMinutes !== null && field.value !== String(setup.timeLimitMinutes)) {
						// A text being typed is reverted; Escape closes the modal only once there is nothing to revert.
						e.preventDefault();
						e.stopPropagation();
						field.value = String(setup.timeLimitMinutes);
						field.removeAttribute("aria-invalid");
						field.select();
					} else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
						e.preventDefault();
						step(e.key === "ArrowUp" ? 1 : -1);
						field.select();
					}
				});

				/** Paints `setup` on the controls, in place: the focus never moves. */
				function sync(): void {
					const isExam = isExamSetup(setup);
					const limited = setup.timeLimitMinutes !== null;
					examSwitch.sw.setAttribute("aria-checked", String(isExam));
					lockNote.hidden = !isExam;
					hintsSwitch.sw.setAttribute("aria-checked", String(setup.hints));
					limitSwitch.sw.setAttribute("aria-checked", String(limited));
					hintsSwitch.lock(isExam);
					limitSwitch.lock(isExam);
					stepper.hidden = !limited;
					limitHelp.hidden = !limited;
					if (limited) {
						const minutes = setup.timeLimitMinutes as number;
						if (document.activeElement !== field) field.value = String(minutes);
						lessButton.setAttribute("aria-disabled", String(minutes <= 1));
						moreButton.setAttribute("aria-disabled", String(minutes >= 300));
					}
				}
				sync();

				// ── Footer: the app's 3D primary button, at the right ──
				const foot = ajouter(c, "div", "qbd-setup-foot");
				const start = ajouter(foot, "button", "qbd-setup-start");
				start.type = "button";
				ui.setIcon(ajouter(start, "span", "qbd-btn-icon"), "play");
				ajouter(start, "span", undefined, t("engine.testSetup.start"));
				poserBouton3d(start);
				const begin = (): void => {
					commit();
					answer({ ...setup });
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
