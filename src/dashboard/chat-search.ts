/* ══════════════════════════════════════════════════════════
   THE SEARCH WINDOW of the Generate page (2026-09-30)

   Opened by "Search" at the top of the sidebar, like claude.ai's: a field,
   three tabs (All, Quizzes, Sessions — the saved chats), the most recent
   items while nothing is typed, the matches as soon as something is.
   Arrows up and down pick an item, Enter opens it, left and right change
   the tab while the field is empty, Escape closes. What is found is decided
   by `search-items.ts`.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../dom";
import { currentHost, requireHost } from "../host/current";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { ArchivedChat } from "./chat-archives";
import { readArchivedChats } from "./chat-archives";
import { searchItems } from "./search-items";
import type { SearchItem, SearchQuiz, SearchTab } from "./search-items";

const ONGLETS: Array<{ id: SearchTab; label: TransKey }> = [
	{ id: "all", label: "ai.search.all" },
	{ id: "quizzes", label: "ai.search.quizzes" },
	{ id: "sessions", label: "ai.search.sessions" },
];

export function ouvrirRecherche(opts: {
	quizzes(): SearchQuiz[];
	/** The icon of a quiz of the catalogue (its type). */
	iconeQuiz(path: string): string;
	ouvrirQuiz(path: string): void;
	ouvrirSession(chat: ArchivedChat): void;
}): void {
	const host = currentHost();
	let onglet: SearchTab = "all";
	let choisi = 0;
	let items: SearchItem[] = [];
	const modal = requireHost("modals").open({
		className: "qbd-search-modal",
		onOpen: (m) => {
			const champ = ajouter(m.contentEl, "input", "qbd-search-champ");
			champ.type = "search";
			champ.placeholder = t("ai.search.placeholder");
			champ.setAttribute("aria-label", t("ai.search.placeholder"));
			const onglets = ajouter(m.contentEl, "div", "qbd-search-onglets");
			onglets.setAttribute("role", "tablist");
			const liste = ajouter(m.contentEl, "div", "qbd-search-liste");
			liste.setAttribute("role", "listbox");

			const ouvrir = (item: SearchItem | undefined): void => {
				if (!item) return;
				modal.close();
				if (item.kind === "quiz") opts.ouvrirQuiz(item.path);
				else opts.ouvrirSession(item.chat);
			};
			const peindreOnglets = (): void => {
				onglets.replaceChildren();
				for (const o of ONGLETS) {
					const b = ajouter(onglets, "button", "qbd-search-onglet" + (o.id === onglet ? " is-active" : ""), t(o.label));
					b.type = "button";
					b.setAttribute("role", "tab");
					b.setAttribute("aria-selected", String(o.id === onglet));
					b.addEventListener("click", () => { onglet = o.id; choisi = 0; peindre(); champ.focus(); });
				}
			};
			const peindreListe = (): void => {
				const requete = champ.value.trim();
				items = searchItems(requete, onglet, opts.quizzes(), readArchivedChats(), requete ? 30 : 10);
				choisi = Math.min(choisi, Math.max(0, items.length - 1));
				liste.replaceChildren();
				if (items.length === 0) {
					ajouter(liste, "div", "qbd-search-vide", t(requete ? "ai.search.none" : "ai.search.empty"));
					return;
				}
				ajouter(liste, "div", "qbd-search-section", t(requete ? "ai.search.results" : "ai.search.recent"));
				items.forEach((item, i) => {
					const b = ajouter(liste, "button", "qbd-search-item" + (i === choisi ? " is-active" : ""));
					b.type = "button";
					b.setAttribute("role", "option");
					b.setAttribute("aria-selected", String(i === choisi));
					host.ui.setIcon(ajouter(b, "span", "qbd-search-icone"), item.kind === "quiz" ? opts.iconeQuiz(item.path) : "message-circle");
					ajouter(b, "span", "qbd-search-titre", item.title || t("ai.side.untitled"));
					b.addEventListener("mousemove", () => {
						if (choisi === i) return;
						choisi = i;
						liste.querySelectorAll(".qbd-search-item").forEach((el, j) => el.classList.toggle("is-active", j === i));
					});
					b.addEventListener("click", () => ouvrir(item));
				});
			};
			const peindre = (): void => { peindreOnglets(); peindreListe(); };

			champ.addEventListener("input", () => { choisi = 0; peindreListe(); });
			champ.addEventListener("keydown", (e) => {
				if (e.key === "ArrowDown" || e.key === "ArrowUp") {
					e.preventDefault();
					if (!items.length) return;
					choisi = (choisi + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
					peindreListe();
					liste.querySelector(".qbd-search-item.is-active")?.scrollIntoView({ block: "nearest" });
				} else if (e.key === "Enter" && !e.isComposing) {
					e.preventDefault();
					ouvrir(items[choisi]);
				} else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !champ.value) {
					// With something typed, the arrows move the caret: the tabs change only on an empty field.
					e.preventDefault();
					const i = ONGLETS.findIndex(o => o.id === onglet);
					onglet = ONGLETS[(i + (e.key === "ArrowRight" ? 1 : -1) + ONGLETS.length) % ONGLETS.length].id;
					choisi = 0;
					peindre();
				}
			});
			peindre();
			champ.focus();
		},
	});
}
