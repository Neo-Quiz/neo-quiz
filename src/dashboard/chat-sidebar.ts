/* ══════════════════════════════════════════════════════════
   THE CHATS IN THE SIDEBAR of the Generate page (2026-09-30; switchable
   chats 2026-10-02)

   Like claude.ai's: every conversation, grouped by day ("Today",
   "Yesterday", "28 Sept"), newest first, in a list that scrolls on its own;
   what is older than `JOURS_RECENTS` days waits in a folded "Older" section.
   A CLICK puts the chat on screen (no modal): its bubbles, documents, quiz
   cards and answers come back from the record, and it can be continued. The
   chat on screen is highlighted; a chat with a request waiting or running
   shows a turning mark, and switching away never stops it.

   The record follows the queue (`reconcileChats`): every answered request is
   saved even while the Generate page is not on screen, so closing the app
   loses nothing of what was answered. The state lives at the MODULE level,
   like the queue it follows: the page is rebuilt, the chats are not.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { currentLang, t } from "../i18n";
import type { FileGenerationApp } from "./file-generation-app";
import { chatListItems, groupItemsByDay } from "./chat-list";
import type { ChatListItem } from "./chat-list";
import { closableLines, groupLines, reconcileChats } from "./chat-requests";
import { activeChatId, chatDevice, notifyChatsChanged, onChatsChanged, setActiveChat, startNewChat } from "./chat-session";
import { getChats, importLegacyOnce, removeChat, setChats } from "./chat-store";

/** Days listed by date; anything older is in the folded section. */
const JOURS_RECENTS = 30;

let fileSuivie: FileGenerationApp | null = null;
/** The folded section, opened by a click: for the session of the window. */
let ancienOuvert = false;
/** The lists on screen, repainted when the chats or the queue change. */
const listes = new Set<() => void>();

function repeindre(): void {
	for (const peindre of [...listes]) peindre();
}

/** Brings the record up to date from the queue, lets the finished replies of
    other chats leave the queue, and tells whoever shows chats. */
function synchroniser(file: FileGenerationApp): void {
	const { chats, changed } = reconcileChats(getChats(), groupLines(file.lignes()), chatDevice(), Date.now());
	if (changed) { setChats(chats); notifyChatsChanged(); return; }
	const recorded = (chatId: string, key: string): boolean => !!getChats().find(c => c.id === chatId)?.requests.some(q => q.id === key);
	const partantes = closableLines(file.lignes(), activeChatId(), recorded);
	for (const l of partantes) file.fermer(l.id);
	repeindre();
}

/** Follows the queue of the window, once: the record is kept up to date even
    while the Generate page is not on screen. Also imports the old text-only
    archive, once. */
export function suivreConversations(file: FileGenerationApp): void {
	if (fileSuivie === file) return;
	fileSuivie = file;
	importLegacyOnce(chatDevice());
	// `false`: this subscriber shows nothing, a ready quiz is still announced.
	file.abonner(() => synchroniser(file), () => false);
	// A chat switch lets the replies of the chat just left go, and repaints.
	onChatsChanged(() => synchroniser(file));
	synchroniser(file);
}

/** "Today", "Yesterday", or the date ("28 Sept", with the year when it is not this one). */
function libelleJour(kind: "today" | "yesterday" | "day", jour: number): string {
	if (kind === "today") return t("ai.side.today");
	if (kind === "yesterday") return t("ai.side.yesterday");
	const d = new Date(jour);
	const memeAnnee = d.getFullYear() === new Date().getFullYear();
	return new Intl.DateTimeFormat(currentLang(), memeAnnee ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }).format(d);
}

/** The list of chats, at the bottom of the sidebar. Repaints itself when a
    chat or the queue changes, and lets go once it has left the document. */
export function poserListeChats(parent: HTMLElement): void {
	const host = currentHost();
	const liste = ajouter(parent, "div", "qbd-ai-chats");
	liste.setAttribute("aria-label", t("ai.side.chats"));

	const poserChat = (zone: HTMLElement, chat: ChatListItem): void => {
		const actif = chat.id === activeChatId();
		const item = ajouter(zone, "div", "qbd-ai-chat-item" + (actif ? " is-active" : "") + (chat.running ? " is-running" : ""));
		const ouvrir = ajouter(item, "button", "qbd-ai-chat-ouvrir", chat.title || t("ai.side.untitled"));
		ouvrir.type = "button";
		ouvrir.title = chat.title || "";
		if (actif) ouvrir.setAttribute("aria-current", "true");
		ouvrir.addEventListener("click", () => setActiveChat(chat.id));
		if (chat.running) {
			// A request is waiting or running in this chat: it goes on whatever is on screen.
			const marque = ajouter(item, "span", "qbd-ai-chat-actif");
			marque.title = t("ai.side.running");
			marque.setAttribute("role", "img");
			marque.setAttribute("aria-label", t("ai.side.running"));
			host.ui.setIcon(marque, "loader");
			return;
		}
		const suppr = ajouter(item, "button", "qbd-ai-chat-suppr");
		suppr.type = "button";
		suppr.title = t("ai.side.delete");
		suppr.setAttribute("aria-label", t("ai.side.delete"));
		host.ui.setIcon(suppr, "trash-2");
		suppr.addEventListener("click", () => {
			removeChat(chat.id, Date.now());
			// The chat on screen was deleted: an empty one takes its place.
			if (actif) startNewChat(); else notifyChatsChanged();
		});
	};

	const poserJour = (zone: HTMLElement, kind: "today" | "yesterday" | "day", jour: number, chats: ChatListItem[]): void => {
		ajouter(zone, "div", "qbd-ai-chats-jour", libelleJour(kind, jour));
		for (const chat of chats) poserChat(zone, chat);
	};

	function peindre(): void {
		if (!liste.isConnected) { listes.delete(peindre); return; }
		const haut = liste.scrollTop;
		liste.replaceChildren();
		const maintenant = Date.now();
		const jours = groupItemsByDay(chatListItems(getChats(), fileSuivie?.lignes() ?? [], maintenant), maintenant, JOURS_RECENTS);
		for (const j of jours.filter(j => !j.old)) poserJour(liste, j.kind, j.day, j.chats);
		const anciens = jours.filter(j => j.old);
		if (anciens.length) {
			const bascule = ajouter(liste, "button", "qbd-ai-chats-ancien");
			bascule.type = "button";
			bascule.setAttribute("aria-expanded", String(ancienOuvert));
			ajouter(bascule, "span", undefined, t("ai.side.older"));
			host.ui.setIcon(ajouter(bascule, "span", "qbd-ai-chats-chevron"), ancienOuvert ? "chevron-down" : "chevron-right");
			bascule.addEventListener("click", () => { ancienOuvert = !ancienOuvert; peindre(); });
			if (ancienOuvert) for (const j of anciens) poserJour(liste, j.kind, j.day, j.chats);
		}
		liste.scrollTop = haut;
	}
	listes.add(peindre);
	peindre();
}
