/* ══════════════════════════════════════════════════════════
   WHAT THE SEARCH OF THE GENERATE PAGE FINDS (2026-09-30) — pure

   The quizzes of the catalogue and the saved chats ("Sessions"), filtered by
   a query where every word must appear, accents and case ignored. With no
   query, the most recent first. The window that shows them is
   `chat-search.ts`.
══════════════════════════════════════════════════════════ */

import type { ArchivedChat } from "./chat-archives";

export type SearchTab = "all" | "quizzes" | "sessions";

export interface SearchQuiz {
	path: string;
	title: string;
	mtime: number;
}

export type SearchItem =
	| { kind: "quiz"; path: string; title: string; date: number }
	| { kind: "session"; chat: ArchivedChat; title: string; date: number };

/** Lowercase, without accents: "Élément" and "element" are the same word. */
export function normaliser(s: string): string {
	return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The items of a tab for a query, newest first, at most `max`. */
export function searchItems(query: string, tab: SearchTab, quizzes: SearchQuiz[], chats: ArchivedChat[], max = 30): SearchItem[] {
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
			const titre = c.title || c.turns.find(t => t.role === "user")?.text.split("\n")[0] || "";
			if (mots.length && !trouve(titre + "\n" + c.turns.map(t => t.text).join("\n"))) continue;
			items.push({ kind: "session", chat: c, title: titre, date: c.date });
		}
	}
	return items.sort((a, b) => b.date - a.date).slice(0, max);
}
