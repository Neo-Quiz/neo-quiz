import { t } from "../i18n";
import { ajouter } from "../dom";
import { currentHost, requireHost } from "../host/current";
import { EXAM_DURATION_MAX, EXAM_DURATION_MIN } from "../quiz-utils";
import type { EnteteAction } from "./detail-head";
import type { QuizDraft } from "./detail-io";
import { openActionMenu, type ActionMenuItem } from "./ui-select";
import { modeOfOptions } from "./quiz-mode-change";

/* ══════════════════════════════════════════════════════════
   THE "MODE" ACTION OF THE EDITOR'S HEADER (spec 2026-09-29 §5.1), next to
   Vocabulary, in editing only: Practice ⇄ Exam, and an Exam's duration.
   A Learn shows its mode, not editable. The change itself — rewriting the
   configuration, saving, renaming the note — belongs to the page
   (detail.ts `changeQuizMode`); this module only asks.
══════════════════════════════════════════════════════════ */

/** The shortcuts of the Duration dialog, in minutes. */
const RACCOURCIS = [30, 60, 90, 120];

/** The label of the action's badge: the mode, and an Exam's duration. */
export function texteBadgeMode(draft: QuizDraft | null): string | undefined {
	if (!draft) return undefined;
	const mode = modeOfOptions(draft.examOptions);
	if (mode === "learn") return t("editor.mode.learn");
	if (mode === "practice") return t("editor.mode.practice");
	return t("editor.mode.examWithDuration", { minutes: draft.examOptions?.durationMinutes ?? "?" });
}

export function modeHeaderAction(
	getDraft: () => QuizDraft | null,
	onChangeMode: (to: "practice" | "exam") => void,
	onChangeDuration: (minutes: number) => void,
): EnteteAction {
	const draft = getDraft();
	return {
		label: t("editor.mode.button"),
		/* One icon whatever the mode: the action is posed before the draft is
		   loaded, and the header is not repainted when it arrives — only the
		   badge is (detail.ts). */
		icon: "layers",
		badge: texteBadgeMode(draft),
		key: "mode",
		onClick: (el) => {
			const d = getDraft();
			if (!d) return;
			openActionMenu(el, modeItems(d, onChangeMode, onChangeDuration));
		},
	};
}

/** The menu of the action: Practice ⇄ Exam, and an Exam's duration. A Learn
    shows its mode, locked. */
function modeItems(
	d: QuizDraft,
	onChangeMode: (to: "practice" | "exam") => void,
	onChangeDuration: (minutes: number) => void,
): ActionMenuItem[] {
	const actuel = modeOfOptions(d.examOptions);
	const items: ActionMenuItem[] = actuel === "learn"
		? [{ icon: "book-open", label: t("editor.mode.learnLocked"), disabled: true }]
		: [
			{ icon: "dumbbell", label: t("editor.mode.practice"), disabled: actuel === "practice", onClick: () => onChangeMode("practice") },
			{ icon: "timer", label: t("editor.mode.exam"), disabled: actuel === "exam", onClick: () => onChangeMode("exam") },
		];
	if (actuel === "exam") {
		items.push({
			icon: "clock",
			label: t("editor.mode.duration", { minutes: d.examOptions?.durationMinutes ?? "?" }),
			sepBefore: true,
			onClick: () => openDurationModal(d.examOptions?.durationMinutes, onChangeDuration),
		});
	}
	return items;
}

/** The same action as a line of the page's "⋮" menu, in editing, its
    choices in a submenu (2026-09-29, see `glossaryMenuItem`). None on a
    Learn: its only line would be a greyed-out "cannot change". */
export function modeMenuItem(
	getDraft: () => QuizDraft | null,
	onChangeMode: (to: "practice" | "exam") => void,
	onChangeDuration: (minutes: number) => void,
): ActionMenuItem | null {
	const d = getDraft();
	if (!d || modeOfOptions(d.examOptions) === "learn") return null;
	return { icon: "layers", label: t("editor.mode.button"), hint: texteBadgeMode(d), submenu: modeItems(d, onChangeMode, onChangeDuration) };
}

/** The Duration dialog: minutes within [1, 300], four shortcuts. */
function openDurationModal(courante: number | undefined, onSave: (minutes: number) => void): void {
	requireHost("modals").open({
		className: "qbd-medit-modal",
		// t() at render time (on opening), never in a top-level constant.
		title: t("editor.mode.durationTitle"),
		onOpen: (m) => {
			const c = m.contentEl;
			ajouter(c, "p", "qbd-medit-label", t("editor.mode.durationHint", { min: EXAM_DURATION_MIN, max: EXAM_DURATION_MAX }));
			const input = ajouter(c, "input", "qbd-medit-input");
			input.type = "number";
			input.min = String(EXAM_DURATION_MIN);
			input.max = String(EXAM_DURATION_MAX);
			input.step = "1";
			input.value = courante ? String(courante) : "";
			window.setTimeout(() => { input.focus(); input.select(); }, 0);
			const raccourcis = ajouter(c, "div", "qbd-mode-duration-shortcuts");
			for (const minutes of RACCOURCIS) {
				const b = ajouter(raccourcis, "button", "qbd-mode-duration-shortcut", t("editor.mode.minutes", { minutes }));
				b.type = "button";
				b.addEventListener("click", () => { input.value = String(minutes); input.focus(); });
			}
			const apply = (): void => {
				// Refused outside the bounds, never silently cut: typing 500 and
				// getting 300 would be a surprise.
				const brut = Number(input.value.trim());
				const minutes = input.value.trim() !== "" && Number.isInteger(brut) && brut >= EXAM_DURATION_MIN && brut <= EXAM_DURATION_MAX ? brut : null;
				if (minutes === null) {
					currentHost().ui.notice(t("editor.mode.durationInvalid", { min: EXAM_DURATION_MIN, max: EXAM_DURATION_MAX }));
					return;
				}
				m.close();
				onSave(minutes);
			};
			const save = ajouter(c, "button", "qbd-medit-save", t("editor.mode.durationSave"));
			save.type = "button";
			save.addEventListener("click", apply);
			input.addEventListener("keydown", (e) => { if (e.key === "Enter") apply(); });
		},
	});
}
