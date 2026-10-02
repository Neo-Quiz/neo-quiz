/* ══════════════════════════════════════════════════════════
   THE CHATS of the Generate page (2026-09-30)

   The OLD text-only archive of the chats, kept in the window's own
   storage. Since 2026-10-02 this file only READS it, for the one-time import
   into the chat record (`chat-store.ts`, `importLegacyOnce`); chats are
   written in `chat-store.ts`.
══════════════════════════════════════════════════════════ */

export interface ArchivedTurn {
	role: "user" | "assistant";
	text: string;
}

export interface ArchivedChat {
	id: string;
	/** Epoch milliseconds of the last save: the day it is listed under. */
	date: number;
	/** What the sidebar shows: the start of the first request. */
	title?: string;
	turns: ArchivedTurn[];
}

const KEY = "neo-quiz.archived-chats";

function valid(x: unknown): x is ArchivedChat {
	if (!x || typeof x !== "object") return false;
	const c = x as Partial<ArchivedChat>;
	return typeof c.id === "string" && typeof c.date === "number" && Array.isArray(c.turns)
		&& (c.title === undefined || typeof c.title === "string")
		&& c.turns.every(t => !!t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string");
}

/** The chats, newest first. Anything unreadable gives an empty list. */
export function readArchivedChats(storage: Pick<Storage, "getItem"> | null = safeStorage()): ArchivedChat[] {
	try {
		const raw = storage?.getItem(KEY);
		const list: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(list) ? list.filter(valid).sort((a, b) => b.date - a.date) : [];
	} catch {
		return [];
	}
}

function safeStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}
