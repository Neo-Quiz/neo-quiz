/* ══════════════════════════════════════════════════════════
   SETTINGS › AI › AI WORK HISTORY (2026-10-11, spec
   2026-10-11-live-cli-sessions-design, section 5).

   Everything Claude Code and Codex did in the live sessions of the Generate
   page is kept on this PC with no time limit (the run store of the main
   process, `<userData>/runs/`). Here: its total size, and "Delete all",
   confirmed in the app's own modal (never a native dialog). The page only
   names the runs it knows (the ids its chats keep): the main process deletes
   them, never a path from here. The chats stay; their run ids are dropped,
   so their next message starts a new session.
══════════════════════════════════════════════════════════ */

import { currentHost } from "../../../../src/host/current";
import { currentLang, t } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";
import { openConfirmModal } from "../../../../src/editor/modals";
import { getChats, setChats } from "../../../../src/dashboard/chat-store";
import { notifyChatsChanged } from "../../../../src/dashboard/chat-session";
import { removeRuns } from "../../../../src/dashboard/live-generation";

/** Bytes in the user's language ("1.2 MB", "1,2 Mo"). */
function taille(octets: number): string {
	const [unit, value] = octets >= 1_000_000_000 ? ["gigabyte", octets / 1_000_000_000] as const
		: octets >= 1_000_000 ? ["megabyte", octets / 1_000_000] as const
		: ["kilobyte", octets / 1_000] as const;
	return new Intl.NumberFormat(currentLang(), { style: "unit", unit, maximumFractionDigits: 1 }).format(value);
}

/** Mounts the row in `card`; `row` is the settings page's own row maker. */
export function mountAiHistorySettings(card: HTMLElement, row: (parent: HTMLElement, name: string, help?: string) => HTMLElement): void {
	const live = currentHost().live;
	if (!live) return;
	const controle = row(card, t("app.settings.aiHistorySize"));
	const valeur = ajouter(controle, "span", "nq-set-ligne-aide nq-set-valeur", "…");
	const supprimer = ajouter(controle, "button", "nq-reglages-changer", t("app.settings.aiHistoryDelete"));
	supprimer.type = "button";
	const lire = async (): Promise<void> => {
		let n = 0;
		try { n = await live.storeSize(); } catch { n = 0; }
		valeur.textContent = taille(n);
		supprimer.disabled = n === 0;
	};
	supprimer.addEventListener("click", () => {
		openConfirmModal(
			t("app.settings.aiHistoryDeleteTitle"),
			t("app.settings.aiHistoryDeleteMessage"),
			t("app.settings.aiHistoryDeleteConfirm"),
			t("app.settings.aiHistoryCancel"),
			(ok) => {
				if (!ok) return;
				supprimer.disabled = true;
				void (async () => {
					const chats = getChats();
					try {
						await removeRuns([...new Set(chats.flatMap(c => c.runIds ?? []))]);
						setChats(getChats().map(c => { const { runIds: _gone, ...rest } = c; return rest; }));
						notifyChatsChanged();
					} catch (e) {
						console.warn("[neo-quiz] AI work history not deleted:", e);
						currentHost().ui.notice(t("app.settings.aiHistoryFailed"));
					}
					await lire();
				})();
			},
		);
	});
	void lire();
}
