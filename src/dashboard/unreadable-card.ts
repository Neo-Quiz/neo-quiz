import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { t } from "../i18n";
import type { UnreadableQuiz } from "./scanner";

/** A card for a note whose quiz block cannot be read. It is not a quiz: no
    ring, no stats, no menu. It names the file, says what is wrong and offers
    to open the file in the system editor so the block can be fixed. */
export function renderUnreadableCards(parent: HTMLElement, broken: readonly UnreadableQuiz[]): void {
	if (broken.length === 0) return;
	const host = currentHost();
	const wrap = ajouter(parent, "div", "qbd-unreadable-list");
	for (const item of broken) {
		const card = ajouter(wrap, "div", "qbd-unreadable-card");
		host.ui.setIcon(ajouter(card, "div", "qbd-unreadable-icon"), "alert-triangle");
		const text = ajouter(card, "div", "qbd-unreadable-text");
		ajouter(text, "div", "qbd-unreadable-name", item.basename);
		ajouter(text, "div", "qbd-unreadable-message", t("dashboard.quizzes.unreadableMessage"));
		const open = ajouter(card, "button", "qb-btn qbd-unreadable-open", t("dashboard.quizzes.unreadableOpen"));
		open.addEventListener("click", () => {
			const file = host.fs.getFile(item.path);
			if (!file) { host.ui.notice(t("dashboard.detail.fileNotFound")); return; }
			void host.shell.openExternal(file).then(ok => {
				if (!ok) host.ui.notice(t("dashboard.quizzes.unreadableOpenFailed"));
			});
		});
	}
}
