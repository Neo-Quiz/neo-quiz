/* ══════════════════════════════════════════════════════════
   THE ARCHIVED CHATS of the Generate page (2026-09-30)

   "New" on the Generate page closes the conversation on screen; a chat that
   said something is kept here first, so that "Archived chats" can show it
   again, read-only. Kept in the window's own storage, never in the vault
   nor in the settings: it is a convenience, not data the app must find
   again, and it can be empty or refused (private window) without a word.
══════════════════════════════════════════════════════════ */

export interface ArchivedTurn {
	role: "user" | "assistant";
	text: string;
}

export interface ArchivedChat {
	id: string;
	/** Epoch milliseconds of the archiving. */
	date: number;
	turns: ArchivedTurn[];
}

const KEY = "neo-quiz.archived-chats";
/** The oldest chats leave first: a chat is a few kilobytes, thirty is plenty. */
export const MAX_ARCHIVED_CHATS = 30;

function valid(x: unknown): x is ArchivedChat {
	if (!x || typeof x !== "object") return false;
	const c = x as Partial<ArchivedChat>;
	return typeof c.id === "string" && typeof c.date === "number" && Array.isArray(c.turns)
		&& c.turns.every(t => !!t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string");
}

/** The archived chats, newest first. Anything unreadable gives an empty list. */
export function readArchivedChats(storage: Pick<Storage, "getItem"> | null = safeStorage()): ArchivedChat[] {
	try {
		const raw = storage?.getItem(KEY);
		const list: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(list) ? list.filter(valid).sort((a, b) => b.date - a.date) : [];
	} catch {
		return [];
	}
}

function write(list: ArchivedChat[], storage: Pick<Storage, "setItem"> | null): void {
	try {
		storage?.setItem(KEY, JSON.stringify(list.slice(0, MAX_ARCHIVED_CHATS)));
	} catch {
		// Storage full or refused: the archive is a convenience, the chat is simply not kept.
	}
}

/** Archives a chat; a chat with no answer at all (nothing said) is not worth keeping. */
export function archiveChat(turns: ArchivedTurn[], now = Date.now(), storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): boolean {
	const kept = turns.filter(t => t.text.trim());
	if (!kept.some(t => t.role === "assistant")) return false;
	write([{ id: String(now) + "-" + Math.random().toString(36).slice(2, 7), date: now, turns: kept }, ...readArchivedChats(storage)], storage);
	return true;
}

export function deleteArchivedChat(id: string, storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): void {
	write(readArchivedChats(storage).filter(c => c.id !== id), storage);
}

function safeStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}
