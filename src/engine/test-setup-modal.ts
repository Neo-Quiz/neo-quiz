import { ajouter } from "../dom";
import { poserBouton3d } from "../dashboard/cta3d";
import { currentHost, requireHost } from "../host/current";
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

   What the pure core does not remember, because it is stateless: the LAST
   DURATION. Turning Time limit off and on again, or Exam mode off and on,
   brings back the duration that was there, not the fallback rule.

   EXAM MODE GROUPS ITS SETTINGS (2026-09-29). Switched on, the tinted Exam
   card grows to CONTAIN Hints and Time limit (and the total duration), shown
   locked (Hints off, Time limit on, switches `aria-disabled`, dimmed, out of
   the tab order): they are what Exam mode IS, so they cannot be changed one
   by one any more. The total duration stays editable there. Switched off,
   the card shrinks back and the same rows are editable below it. Two copies
   of those rows exist, one in the card and one below it, and each slides
   open or shut (`.qbd-setup-slide`, grid rows 0fr <-> 1fr, no height
   measured) while the other does the opposite, so the panel keeps its
   height and nothing jumps. The closed copy is `visibility: hidden`: out of
   the tab order and of the accessibility tree. Both copies paint the same
   `setup`; neither owns any state.

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

/** The duration shortcuts, in minutes. */
export const DURATION_SHORTCUTS = [30, 60, 90, 120] as const;

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
				const row = (parent: HTMLElement, icon: string, key: string, label: string, help?: string): { row: HTMLElement; side: HTMLElement } => {
					const r = ajouter(parent, "div", "qbd-setup-row");
					iconBox(r, icon);
					const text = ajouter(r, "div", "qbd-setup-text");
					ajouter(text, "span", "qbd-setup-label", label).id = `${id}-${key}`;
					if (help) ajouter(text, "span", "qbd-setup-help", help);
					return { row: r, side: ajouter(r, "div", "qbd-setup-side") };
				};
				/** A switch: a real button with `role="switch"`; a click on its row toggles it too.
				    `locked`: shown but not operable (`aria-disabled`, out of the tab order, no click). */
				const makeSwitch = (parent: HTMLElement, rowEl: HTMLElement, key: string, locked: boolean, onToggle: (on: boolean) => void): HTMLButtonElement => {
					const sw = ajouter(parent, "button", "qbd-setup-switch");
					sw.type = "button";
					sw.setAttribute("role", "switch");
					sw.setAttribute("aria-labelledby", `${id}-${key}`);
					ajouter(sw, "span", "qbd-setup-switch-thumb");
					if (locked) {
						sw.setAttribute("aria-disabled", "true");
						sw.tabIndex = -1;
						rowEl.classList.add("is-locked");
						return sw;
					}
					sw.addEventListener("click", () => onToggle(sw.getAttribute("aria-checked") !== "true"));
					rowEl.addEventListener("click", (e) => { if (!sw.contains(e.target as Node)) sw.click(); });
					return sw;
				};
				/** A block that slides open and shut (grid rows 0fr <-> 1fr, see the CSS). */
				const slide = (parent: HTMLElement, name: string): { slide: HTMLElement; body: HTMLElement } => {
					const s = ajouter(parent, "div", `qbd-setup-slide qbd-setup-${name}`);
					return { slide: s, body: ajouter(ajouter(s, "div", "qbd-setup-slide-clip"), "div", `qbd-setup-${name}-body`) };
				};

				/** Hints, Time limit and its total duration, drawn once in the Exam card
				    (`locked`) and once below it. Both paint the same `setup`. */
				interface SettingsRows {
					/** Paints `setup` on the controls, in place: the focus never moves. */
					paint(): void;
					/** Leaving the field, or starting: an empty or unusable text goes back
					    to the current duration, a number out of range is brought within it. */
					commit(): void;
				}
				const buildRows = (parent: HTMLElement, locked: boolean): SettingsRows => {
					const k = locked ? "-in" : "";

					// ── Hints ──
					const hints = row(parent, "lightbulb", `hints${k}`, t("engine.testSetup.hints"));
					const hintsSwitch = makeSwitch(hints.side, hints.row, `hints${k}`, locked, (on) => {
						setup = withHints(setup, on);
						sync();
					});

					// ── Time limit, and its total duration ──
					const limit = row(parent, "timer", `limit${k}`, t("engine.testSetup.timeLimit"));
					const limitSwitch = makeSwitch(limit.side, limit.row, `limit${k}`, locked, (on) => {
						setup = withTimeLimit(setup, on ? lastMinutes : null, n);
						if (setup.timeLimitMinutes !== null) lastMinutes = setup.timeLimitMinutes;
						sync();
					});

					// The sub-row slides open under Time limit, and stays editable when locked.
					const duration = slide(parent, "duration");
					ajouter(duration.body, "span", "qbd-setup-label", t("engine.testSetup.duration")).id = `${id}-duration${k}`;
					const controls = ajouter(duration.body, "div", "qbd-setup-controls");
					const segments = ajouter(controls, "div", "qbd-setup-segments");
					segments.setAttribute("role", "group");
					segments.setAttribute("aria-labelledby", `${id}-duration${k}`);
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
					const fieldBox = ajouter(controls, "div", "qbd-setup-fieldbox");
					const field = ajouter(fieldBox, "input", "qbd-setup-field");
					field.type = "number";
					field.min = "1";
					field.max = "300";
					field.step = "1";
					field.inputMode = "numeric";
					field.setAttribute("aria-labelledby", `${id}-duration${k}`);
					ajouter(fieldBox, "span", "qbd-setup-unit", t("engine.testSetup.minutesUnit"));

					const paintSegments = (): void => {
						for (const { minutes, b } of segmentButtons) b.setAttribute("aria-pressed", String(setup.timeLimitMinutes === minutes));
					};
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
						paintSegments();
					});
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

					return {
						paint: () => {
							hintsSwitch.setAttribute("aria-checked", String(setup.hints));
							limitSwitch.setAttribute("aria-checked", String(setup.timeLimitMinutes !== null));
							duration.slide.classList.toggle("is-open", setup.timeLimitMinutes !== null);
							if (setup.timeLimitMinutes !== null && document.activeElement !== field) field.value = String(setup.timeLimitMinutes);
							paintSegments();
						},
						commit,
					};
				};

				// ── Exam mode: one tinted card. Switched on, it slides open around
				//    the locked Hints and Time limit; switched off it shrinks back ──
				const examCard = ajouter(c, "div", "qbd-setup-exam");
				const exam = row(examCard, "graduation-cap", "exam", t("engine.testSetup.examMode"), t("engine.testSetup.examModeHelp"));
				const examSwitch = makeSwitch(exam.side, exam.row, "exam", false, (on) => {
					// Turning Exam mode on brings back the last duration, not the fallback rule.
					setup = withExamMode({ ...setup, timeLimitMinutes: setup.timeLimitMinutes ?? lastMinutes }, on, n);
					sync();
				});
				const insideSlide = slide(examCard, "inside");
				const lockNote = ajouter(insideSlide.body, "p", "qbd-setup-locknote");
				ui.setIcon(ajouter(lockNote, "span", "qbd-setup-locknote-ico"), "lock");
				ajouter(lockNote, "span", undefined, t("engine.testSetup.examLocked"));
				const inside = buildRows(insideSlide.body, true);

				// ── The same settings, below the card, while Exam mode is off ──
				const outsideSlide = slide(c, "outside");
				ajouter(outsideSlide.body, "div", "qbd-setup-sep");
				const outside = buildRows(ajouter(outsideSlide.body, "div", "qbd-setup-rows"), false);

				/** The copy of the rows that is on show. */
				const shown = (): SettingsRows => (isExamSetup(setup) ? inside : outside);
				function sync(): void {
					const isExam = isExamSetup(setup);
					examSwitch.setAttribute("aria-checked", String(isExam));
					insideSlide.slide.classList.toggle("is-open", isExam);
					outsideSlide.slide.classList.toggle("is-open", !isExam);
					inside.paint();
					outside.paint();
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
					shown().commit();
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
