import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { t } from "../i18n";
import { startNewChat } from "./chat-session";

/* ══════════════════════════════════════════════════════════
   "NEW": a new, empty chat (reference: claude.ai, 2026-09-26; chats
   switchable since 2026-10-02)

   The page is a conversation as soon as the chat on screen has something in
   it (a request, live or recorded); it is the home page when that chat is
   empty. "New" puts an EMPTY chat on screen and leaves the previous one
   where it is: its generations go on in the background and its line in the
   sidebar shows it (`chat-sidebar.ts`). Nothing is lost by switching, so
   nothing blocks it any more (it used to wait for the queue to empty).
══════════════════════════════════════════════════════════ */

/** The "New" button at the top of the sidebar. Gives back what repaints it
    when the chat on screen changes (disabled while that chat is empty:
    already a new one). */
export function poserNouvelleDemande(parent: HTMLElement, aContenu: () => boolean): () => void {
	const b = ajouter(parent, "button", "qbd-ai-lateral-item");
	b.type = "button";
	currentHost().ui.setIcon(ajouter(b, "span", "qbd-ai-lateral-icone"), "square-pen");
	ajouter(b, "span", undefined, t("ai.side.new"));
	b.addEventListener("click", () => { if (aContenu()) startNewChat(); });
	const maj = (): void => {
		if (!b.isConnected) return;
		b.disabled = !aContenu();
	};
	maj();
	return maj;
}
