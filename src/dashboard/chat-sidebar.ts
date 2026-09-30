/* ══════════════════════════════════════════════════════════
   THE CHATS IN THE SIDEBAR of the Generate page (2026-09-30)

   Like claude.ai's: every conversation, grouped by day ("Today",
   "Yesterday", "28 Sept"), newest first, in a list that scrolls on its own.
   What is older than `JOURS_RECENTS` days waits in a folded "Older" section,
   so that the list never becomes something to scroll through forever.

   The conversation ON SCREEN is saved as it goes — each answered request —
   so it is listed too (highlighted), and closing the app loses nothing of
   it. It ends when the queue empties ("New", or the last answer closed):
   the next request starts another one. The state lives at the MODULE level,
   like the queue it follows: the page is rebuilt, the conversation is not.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../dom";
import { currentHost, requireHost } from "../host/current";
import { currentLang, t } from "../i18n";
import { renderMarkdownPreview } from "../markdown-preview";
import { mathifyElement } from "../engine/mathjax";
import type { FileGenerationApp, LigneGeneration } from "./file-generation-app";
import { deleteArchivedChat, groupChatsByDay, readArchivedChats, saveChat } from "./chat-archives";
import type { ArchivedChat, ArchivedTurn } from "./chat-archives";

/** Days listed by date; anything older is in the folded section. */
const JOURS_RECENTS = 30;

interface ConversationEnCours {
	id: string;
	/** Per queue line (its id gives the order): the request and what came back. */
	tours: Map<number, { titre: string; tours: ArchivedTurn[] }>;
}

let enCours: ConversationEnCours | null = null;
let fileSuivie: FileGenerationApp | null = null;
/** The folded section, opened by a click: for the session of the window. */
let ancienOuvert = false;
/** The lists on screen, repainted when a chat is saved. */
const listes = new Set<() => void>();

/** What the sidebar calls a request: its first line, else its first attached
    document, else the quiz it made. */
function titreDe(l: LigneGeneration): string {
	const ligne = l.demande.text.split("\n").map(s => s.trim()).find(Boolean);
	return ligne || l.demande.notes[0]?.name || l.resultat?.titre || "";
}

function repeindre(): void {
	for (const peindre of [...listes]) peindre();
}

/** Saves the conversation on screen with every answered request. */
function enregistrer(file: FileGenerationApp): void {
	const lignes = file.lignes();
	if (!lignes.some(l => l.etat !== "arret")) {
		if (enCours) { enCours = null; repeindre(); }
		return;
	}
	let change = false;
	for (const l of lignes) {
		if (l.etat !== "prete" || !l.resultat) continue;
		enCours ??= { id: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7), tours: new Map() };
		if (enCours.tours.has(l.id)) continue;
		const reponse = l.resultat.texte ?? t("ai.side.quizMade", { title: l.resultat.titre });
		// A quiz of an "/exam" plan repeats the request of its plan: only what it made is kept.
		const etapeDePlan = !!l.demande.preparation?.lot && !l.demande.planifier;
		enCours.tours.set(l.id, { titre: etapeDePlan ? "" : titreDe(l), tours: etapeDePlan ? [{ role: "assistant", text: reponse }] : [{ role: "user", text: l.demande.text }, { role: "assistant", text: reponse }] });
		change = true;
	}
	if (!change || !enCours) return;
	const ordre = [...enCours.tours.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
	saveChat({ id: enCours.id, date: Date.now(), title: ordre.find(o => o.titre)?.titre, turns: ordre.flatMap(o => o.tours) });
	repeindre();
}

/** Follows the queue of the window, once: every answered request is saved
    even while the Generate page is not on screen. */
export function suivreConversations(file: FileGenerationApp): void {
	if (fileSuivie === file) return;
	fileSuivie = file;
	// `false`: this subscriber shows nothing, a ready quiz is still announced.
	file.abonner(() => enregistrer(file), () => false);
	enregistrer(file);
}

/** "Today", "Yesterday", or the date ("28 Sept", with the year when it is not this one). */
function libelleJour(kind: "today" | "yesterday" | "day", jour: number): string {
	if (kind === "today") return t("ai.side.today");
	if (kind === "yesterday") return t("ai.side.yesterday");
	const d = new Date(jour);
	const memeAnnee = d.getFullYear() === new Date().getFullYear();
	return new Intl.DateTimeFormat(currentLang(), memeAnnee ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }).format(d);
}

/** A saved chat read back, read-only. The conversation on screen is
    already open: nothing to show. */
export function ouvrirChat(chat: ArchivedChat): void {
	if (chat.id === enCours?.id) return;
	requireHost("modals").open({
		className: "qbd-archives-modal",
		title: chat.title || t("ai.side.untitled"),
		onOpen: (m) => {
			const fil = ajouter(m.contentEl, "div", "qbd-archives-fil");
			for (const tour of chat.turns) {
				if (tour.role === "user") { ajouter(fil, "div", "qbd-ai-bulle", tour.text); continue; }
				const prose = ajouter(fil, "div", "qbd-ai-preview-md markdown-preview-view qbd-ai-chat-prose");
				// The only HTML written here, every text through the sanitizer's first gate.
				prose.innerHTML = renderMarkdownPreview(tour.text);
				if (tour.text.includes("$")) void mathifyElement(prose);
			}
		},
	});
}

/** The list of chats, at the bottom of the sidebar. Repaints itself when a
    chat is saved, and lets go once it has left the document. */
export function poserListeChats(parent: HTMLElement): void {
	const host = currentHost();
	const liste = ajouter(parent, "div", "qbd-ai-chats");
	liste.setAttribute("aria-label", t("ai.side.chats"));

	const poserChat = (zone: HTMLElement, chat: ArchivedChat): void => {
		const actif = chat.id === enCours?.id;
		const item = ajouter(zone, "div", "qbd-ai-chat-item" + (actif ? " is-active" : ""));
		const ouvrir = ajouter(item, "button", "qbd-ai-chat-ouvrir", chat.title || t("ai.side.untitled"));
		ouvrir.type = "button";
		ouvrir.title = chat.title || "";
		// The conversation on screen is already open: its line only shows where it is.
		if (actif) { ouvrir.setAttribute("aria-current", "true"); return; }
		ouvrir.addEventListener("click", () => ouvrirChat(chat));
		const suppr = ajouter(item, "button", "qbd-ai-chat-suppr");
		suppr.type = "button";
		suppr.title = t("ai.side.delete");
		suppr.setAttribute("aria-label", t("ai.side.delete"));
		host.ui.setIcon(suppr, "trash-2");
		suppr.addEventListener("click", () => { deleteArchivedChat(chat.id); peindre(); });
	};

	const poserJour = (zone: HTMLElement, kind: "today" | "yesterday" | "day", jour: number, chats: ArchivedChat[]): void => {
		ajouter(zone, "div", "qbd-ai-chats-jour", libelleJour(kind, jour));
		for (const chat of chats) poserChat(zone, chat);
	};

	function peindre(): void {
		if (!liste.isConnected) { listes.delete(peindre); return; }
		const haut = liste.scrollTop;
		liste.replaceChildren();
		const jours = groupChatsByDay(readArchivedChats(), Date.now(), JOURS_RECENTS);
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
