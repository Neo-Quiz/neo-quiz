/* ══════════════════════════════════════════════════════════
   THE CHATS of the Generate page (2026-09-30)

   Every conversation of the Generate page is saved as it goes (each
   answered request), so that the sidebar lists them all, like claude.ai's,
   grouped by day, the oldest folded away. Kept in the window's own
   storage, never in the vault nor in the settings: it is a convenience,
   not data the app must find again, and it can be empty or refused
   (private window) without a word.
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
/** The oldest chats leave first. A chat is a few kilobytes: a hundred stays
    far below what the window's storage holds. */
export const MAX_ARCHIVED_CHATS = 100;

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

/** Writes the list; a full storage drops the oldest half until it fits. */
function write(list: ArchivedChat[], storage: Pick<Storage, "setItem"> | null): void {
	let kept = list.slice(0, MAX_ARCHIVED_CHATS);
	while (kept.length > 0) {
		try {
			storage?.setItem(KEY, JSON.stringify(kept));
			return;
		} catch {
			// Storage full or refused: fewer chats, or none when it refuses outright.
			if (kept.length === 1) return;
			kept = kept.slice(0, Math.ceil(kept.length / 2));
		}
	}
}

/** Saves a chat, replacing the one with the same id (a conversation saved
    again as it goes on). A chat with no answer at all is not worth keeping. */
export function saveChat(chat: ArchivedChat, storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): boolean {
	const turns = chat.turns.filter(t => t.text.trim());
	if (!turns.some(t => t.role === "assistant")) return false;
	write([{ ...chat, turns }, ...readArchivedChats(storage).filter(c => c.id !== chat.id)], storage);
	return true;
}

export function deleteArchivedChat(id: string, storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): void {
	write(readArchivedChats(storage).filter(c => c.id !== id), storage);
}

/** A day of the sidebar: "Today", "Yesterday", or a date. `old` groups are
    past `recentDays` and go in the folded section. */
export interface ChatDay {
	kind: "today" | "yesterday" | "day";
	/** Local midnight of the day, in epoch milliseconds. */
	day: number;
	old: boolean;
	chats: ArchivedChat[];
}

/** Local midnight of the day holding `ms` (the calendar day, DST included). */
function midnight(ms: number): number {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The chats (newest first) grouped by LOCAL day, newest day first. */
export function groupChatsByDay(chats: ArchivedChat[], now: number, recentDays = 30): ChatDay[] {
	const today = midnight(now);
	const n = new Date(today);
	const yesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1).getTime();
	const limit = new Date(n.getFullYear(), n.getMonth(), n.getDate() - recentDays).getTime();
	const days: ChatDay[] = [];
	for (const chat of [...chats].sort((a, b) => b.date - a.date)) {
		const day = midnight(chat.date);
		let group = days[days.length - 1];
		if (!group || group.day !== day) {
			group = { kind: day >= today ? "today" : day === yesterday ? "yesterday" : "day", day, old: day < limit, chats: [] };
			days.push(group);
		}
		group.chats.push(chat);
	}
	return days;
}

function safeStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}
