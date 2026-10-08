/* ══════════════════════════════════════════════════════════
   THE LIST of chats in the sidebar — pure

   Every chat of the record, plus the chats that exist only in the queue (a
   request sent in a chat that has not answered yet), newest activity first.
   A chat with a request waiting or running is flagged `running`: that is the
   indicator the sidebar shows, and the reason why switching chats is safe.
══════════════════════════════════════════════════════════ */

import type { LigneGeneration } from "./file-generation-app";
import type { ChatRecord } from "./chat-record";
import { chatTitle, firstLineOf } from "./chat-record";
import { chatOfLine, isLive } from "./chat-requests";
import { isDead, isStale } from "../shared-state/generations";
import type { GenerationsFile, RunningEntry } from "../shared-state/generations";

export interface ChatListItem {
	id: string;
	title: string;
	/** The latest activity: the day it is listed under. */
	date: number;
	running: boolean;
	/** The device that started the chat ("" for a chat that exists only in the queue). */
	origin: string;
	/** Started on another device than `device` (never true for a chat only in the queue). */
	foreign: boolean;
}

export function chatListItems(chats: readonly ChatRecord[], lines: readonly LigneGeneration[], now: number, device: string = "", remote: ReadonlyArray<{ device: string; file: GenerationsFile }> = []): ChatListItem[] {
	const items = new Map<string, ChatListItem>();
	// A chat with a request running on another device: that device's file, while it is fresh.
	const runningElsewhere = new Map<string, RunningEntry>();
	const pausedElsewhere = new Map<string, RunningEntry>();
	for (const { file } of remote) {
		if (isStale(file, now)) {
			// A stale file: its new chats stay listed (paused) until the file is a day old.
			if (!isDead(file, now)) for (const e of file.running) if (!pausedElsewhere.has(e.chatId)) pausedElsewhere.set(e.chatId, e);
			continue;
		}
		for (const e of file.running) if (!runningElsewhere.has(e.chatId)) runningElsewhere.set(e.chatId, e);
	}
	for (const c of chats) {
		if (!c.deleted) items.set(c.id, { id: c.id, title: chatTitle(c), date: c.updatedAt, running: false, origin: c.origin, foreign: !!device && c.origin !== device });
	}
	const tombstones = new Set(chats.filter(c => c.deleted).map(c => c.id));
	for (const l of lines) {
		if (l.etat === "arret") continue;
		const id = chatOfLine(l);
		if (tombstones.has(id)) continue;
		let item = items.get(id);
		if (!item) {
			const d = l.demande;
			item = { id, title: firstLineOf(d.text) || d.notes[0]?.name || "", date: d.sentAt ?? now, running: false, origin: "", foreign: false };
			items.set(id, item);
		}
		if (isLive(l)) item.running = true;
		item.date = Math.max(item.date, l.demande.sentAt ?? 0);
	}
	for (const [id, entry] of runningElsewhere) {
		const item = items.get(id);
		if (item) { item.running = true; continue; }
		// Known only from the other device's generation: listed until its chat record lands.
		if (tombstones.has(id)) continue;
		items.set(id, { id, title: entry.text, date: entry.startedAt, running: true, origin: entry.from, foreign: !!device && entry.from !== device });
	}
	for (const [id, entry] of pausedElsewhere) {
		if (items.has(id) || tombstones.has(id)) continue;
		items.set(id, { id, title: entry.text, date: entry.startedAt, running: false, origin: entry.from, foreign: !!device && entry.from !== device });
	}
	return [...items.values()].sort((a, b) => b.date - a.date);
}

/** A day of the sidebar: "Today", "Yesterday", or a date. `old` days are past
    `recentDays` and go in the folded section. */
export interface ChatDay {
	kind: "today" | "yesterday" | "day";
	/** Local midnight of the day, in epoch milliseconds. */
	day: number;
	old: boolean;
	chats: ChatListItem[];
}

/** Local midnight of the day holding `ms` (the calendar day, DST included). */
function midnight(ms: number): number {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The chats (newest first) grouped by LOCAL day, newest day first. */
export function groupItemsByDay(items: readonly ChatListItem[], now: number, recentDays = 30): ChatDay[] {
	const today = midnight(now);
	const n = new Date(today);
	const yesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1).getTime();
	const limit = new Date(n.getFullYear(), n.getMonth(), n.getDate() - recentDays).getTime();
	const days: ChatDay[] = [];
	for (const chat of [...items].sort((a, b) => b.date - a.date)) {
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
