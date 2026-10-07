import { ajouter } from "../dom";
import { requireHost } from "../host/current";
import { t } from "../i18n";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleGroup } from "./quiz-modules";
import type { HostModalHandle } from "../host/types";
import { createOptionCard } from "./folder-create";
import { quizModeLabel } from "./quiz-card";
import { EMPTY_SELECTION, canShare, inPageOrder, isSelected, selectAll, toggle } from "./selection";
import type { Selection } from "./selection";

/* ══════════════════════════════════════════════════════════
   "SHARE" ON A FOLDER (2026-10-07): the folder's ⋯ menu no longer shares
   everything at once. A small window asks what to share, "The whole folder"
   (with its name and look) or "Choose quizzes…", a checklist of every quiz of
   the folder with "Check all" and a Share button that stays off until
   something is ticked. The ticked quizzes leave in ONE archive, the same one
   a Ctrl+click selection on the folder page makes. The ticking rules are
   `selection.ts`'s, shared with that page.
══════════════════════════════════════════════════════════ */

export type ShareTarget = { group: ModuleGroup } | { quizzes: QuizIndexEntry[]; name: string };

export function openShareChooser(group: ModuleGroup, share: (target: ShareTarget) => void): void {
	// Nothing to choose from: the share itself says so ("file not found").
	if (group.quizzes.length === 0) { share({ group }); return; }
	requireHost("modals").open({
		className: "qbd-create-modal",
		title: t("share.choose.title"),
		onOpen: (m) => {
			createOptionCard(m, m.contentEl, "folder", "#4573ff", t("share.choose.whole"),
				t("share.choose.wholeDesc", { count: group.quizzes.length }), () => share({ group }));
			createOptionCard(m, m.contentEl, "list-checks", "#4573ff", t("share.choose.pick"),
				t("share.choose.pickDesc"), () => openQuizPicker(group, share));
		},
	});
}

function openQuizPicker(group: ModuleGroup, share: (target: ShareTarget) => void): void {
	const quizzes = group.quizzes;
	const order = quizzes.map(q => q.path);
	let sel: Selection = EMPTY_SELECTION;
	requireHost("modals").open({
		className: "qbd-create-modal qbd-share-pick-modal",
		title: t("share.choose.listTitle"),
		onOpen: (m: HostModalHandle) => {
			const c = m.contentEl;
			const head = ajouter(c, "div", "qbd-share-pick-head");
			const count = ajouter(head, "span", "qbd-share-pick-count");
			count.setAttribute("aria-live", "polite");
			const all = ajouter(head, "button", "qbd-share-pick-all", t("share.choose.checkAll"));
			all.type = "button";
			const list = ajouter(c, "div", "qbd-share-pick-list");
			list.setAttribute("role", "group");
			list.setAttribute("aria-label", t("share.choose.listTitle"));
			const boxes = new Map<string, HTMLInputElement>();
			for (const q of quizzes) {
				const row = ajouter(list, "label", "qbd-share-pick-row");
				const box = ajouter(row, "input", "qbd-share-pick-box");
				box.type = "checkbox";
				boxes.set(q.path, box);
				ajouter(row, "span", "qbd-share-pick-title", q.title);
				ajouter(row, "span", "qbd-share-pick-mode", quizModeLabel(q.mode));
				box.addEventListener("change", () => { sel = toggle(sel, q.path); paint(); });
			}
			ajouter(c, "p", "qbd-share-pick-note", t("share.choose.wholeNote"));
			const buttons = ajouter(c, "div", "qb-confirm-buttons");
			const cancel = ajouter(buttons, "button", "qb-btn", t("share.select.cancel"));
			cancel.type = "button";
			cancel.addEventListener("click", () => m.close());
			const go = ajouter(buttons, "button", "qb-btn qb-btn-accent", t("share.select.share"));
			go.type = "button";
			go.addEventListener("click", () => {
				if (!canShare(sel)) return;
				const wanted = new Set(inPageOrder(sel, order));
				const chosen = quizzes.filter(q => wanted.has(q.path));
				m.close();
				share({ quizzes: chosen, name: group.name });
			});
			all.addEventListener("click", () => {
				sel = sel.ids.length === order.length ? EMPTY_SELECTION : selectAll(order);
				paint();
			});
			function paint(): void {
				for (const [path, box] of boxes) box.checked = isSelected(sel, path);
				const n = sel.ids.length;
				count.textContent = t(n === 1 ? "share.select.countOne" : "share.select.countOther", { count: n });
				all.textContent = t(n === order.length ? "share.choose.uncheckAll" : "share.choose.checkAll");
				go.disabled = !canShare(sel);
			}
			paint();
		},
	});
}
