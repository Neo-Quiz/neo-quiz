/* ══════════════════════════════════════════════════════════
   WHAT THE SEARCH OF THE GENERATE PAGE FINDS (2026-09-30) — pure

   The quizzes of the catalogue and the saved chats ("Sessions"), filtered by
   a query where every word must appear, accents and case ignored. With no
   query, the most recent first. The window that shows them is
   `chat-search.ts`.
══════════════════════════════════════════════════════════ */

import type { ChatRecord } from "./chat-record";
import { chatTitle } from "./chat-record";

/** A chat as the search sees it: its title and everything said in it. */
export interface SearchChat { id: string; title: string; date: number; text: string }

export function chatsForSearch(chats: readonly ChatRecord[]): SearchChat[] {
	return chats.filter(c => !c.deleted).map(c => ({
		id: c.id, title: chatTitle(c), date: c.updatedAt,
		text: c.requests.map(q => [q.text, ...q.documents.map(d => d.name), ...q.results.map(x => (x.kind === "text" ? x.text : x.title))].join("\n")).join("\n"),
	}));
}

export type SearchTab = "all" | "quizzes" | "sessions";

export interface SearchQuiz {
	path: string;
	title: string;
	mtime: number;
}

export type SearchItem =
	| { kind: "quiz"; path: string; title: string; date: number }
	| { kind: "session"; id: string; title: string; date: number };

/** Lowercase, without accents: "Élément" and "element" are the same word. */
export function normaliser(s: string): string {
	return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The items of a tab for a query, newest first, at most `max`. */
export function searchItems(query: string, tab: SearchTab, quizzes: SearchQuiz[], chats: SearchChat[], max = 30): SearchItem[] {
	const mots = normaliser(query).split(/\s+/).filter(Boolean);
	const trouve = (texte: string): boolean => {
		const n = normaliser(texte);
		return mots.every(m => n.includes(m));
	};
	const items: SearchItem[] = [];
	if (tab !== "sessions") {
		for (const q of quizzes) {
			if (mots.length && !trouve(q.title + "\n" + q.path)) continue;
			items.push({ kind: "quiz", path: q.path, title: q.title, date: q.mtime });
		}
	}
	if (tab !== "quizzes") {
		for (const c of chats) {
			if (mots.length && !trouve(c.title + "\n" + c.text)) continue;
			items.push({ kind: "session", id: c.id, title: c.title, date: c.date });
		}
	}
	return items.sort((a, b) => b.date - a.date).slice(0, max);
}
