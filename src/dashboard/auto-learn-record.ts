/* THE AUTOMATIC LEARN LOG (spec 2026-10-15-moodle-auto-learn)

   Why a log: the generation queue is session-scoped (dropped on a restart),
   and a full Moodle sync may hand the same file twice (hourly sync, then
   "Sync now", a page reload, the same batch taken twice). A lecture must
   never get two automatic Learns, and one that was waiting at a restart must
   be queued again exactly once.

   Why "failed" is final: there is no retry loop. A line the user stopped or
   closed is marked failed and never comes back; while its line lives it keeps
   its own "Try again" button.

   Pure: no storage, no clock (`now` is an input). The stored value is
   hostile (the file is read back from disk), so `readLog` re-validates it. */

import type { ChatRecord } from "./chat-record";
import { isCleanRelativePath } from "./chat-record";

export type AutoEntryState = "queued" | "done" | "failed";
export interface AutoEntry { key: string; relPath: string; size: number; state: AutoEntryState; at: number; quiz?: string }
export interface AutoLearnLog { v: 1; entries: AutoEntry[]; starts: number[]; chatId?: string }

export const MAX_AUTO_ENTRIES = 500;
export const MAX_STARTS = 100;
export const AUTO_CHAT_PREFIX = "moodle-";

const CHAT_ID = /^[a-z0-9][a-z0-9-]{3,63}$/; // `chat-session.ts` VALID

export function emptyLog(): AutoLearnLog { return { v: 1, entries: [], starts: [] }; }

/** Identity of a lecture: its path (case and Unicode form aside) and its size, so a new version is a new lecture. */
export function autoKey(relPath: string, size: number): string { return relPath.normalize("NFC").toLowerCase() + "|" + size; }

/** Drops the oldest finished entries first; a queued one only goes when nothing else is left. */
function bound(entries: AutoEntry[]): AutoEntry[] {
	const out = [...entries];
	while (out.length > MAX_AUTO_ENTRIES) {
		const i = out.findIndex(e => e.state !== "queued");
		out.splice(i >= 0 ? i : 0, 1);
	}
	return out;
}

/** The files not yet in the log (within the batch and across calls), now recorded as queued. */
export function admit(log: AutoLearnLog, files: readonly { relPath: string; size: number }[], now: number): { log: AutoLearnLog; admitted: AutoEntry[] } {
	const seen = new Set(log.entries.map(e => e.key));
	const admitted: AutoEntry[] = [];
	for (const f of files) {
		const key = autoKey(f.relPath, f.size);
		if (seen.has(key)) continue;
		seen.add(key);
		admitted.push({ key, relPath: f.relPath, size: f.size, state: "queued", at: now });
	}
	return { log: admitted.length ? { ...log, entries: bound([...log.entries, ...admitted]) } : log, admitted };
}

export function markState(log: AutoLearnLog, key: string, state: AutoEntryState, now: number, quiz?: string): AutoLearnLog {
	return { ...log, entries: log.entries.map(e => (e.key === key ? { ...e, state, at: now, ...(quiz ? { quiz } : {}) } : e)) };
}

export function recordStart(log: AutoLearnLog, now: number): AutoLearnLog { return { ...log, starts: [...log.starts, now].slice(-MAX_STARTS) }; }
export function startsSince(log: AutoLearnLog, since: number): number { return log.starts.filter(t => t >= since).length; }

/** Lectures still "queued" in the log but absent from the live queue (a restart dropped them). */
export function toRequeue(log: AutoLearnLog, inQueue: ReadonlySet<string>): AutoEntry[] { return log.entries.filter(e => e.state === "queued" && !inQueue.has(e.key)); }

/** The id of the chat holding the automatic Learns: kept while that chat lives, renewed once it is deleted. */
export function autoChatId(log: AutoLearnLog, chats: readonly ChatRecord[], fresh: () => string): { log: AutoLearnLog; chatId: string } {
	const id = log.chatId;
	if (id && !chats.some(c => c.id === id && c.deleted)) return { log, chatId: id };
	const chatId = AUTO_CHAT_PREFIX + fresh();
	return { log: { ...log, chatId }, chatId };
}

export function readLog(raw: unknown): AutoLearnLog {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyLog();
	const o = raw as Record<string, unknown>;
	if (o.v !== 1 || !Array.isArray(o.entries)) return emptyLog();
	const entries: AutoEntry[] = [];
	for (const x of o.entries.slice(-2 * MAX_AUTO_ENTRIES)) {
		if (!x || typeof x !== "object") continue;
		const e = x as Record<string, unknown>;
		if (typeof e.relPath !== "string" || !isCleanRelativePath(e.relPath) || typeof e.size !== "number" || !Number.isSafeInteger(e.size) || e.size < 0) continue;
		if (e.key !== autoKey(e.relPath, e.size) || (e.state !== "queued" && e.state !== "done" && e.state !== "failed") || typeof e.at !== "number" || !Number.isFinite(e.at)) continue;
		const quiz = typeof e.quiz === "string" && isCleanRelativePath(e.quiz) ? e.quiz : undefined;
		entries.push({ key: e.key, relPath: e.relPath, size: e.size, state: e.state, at: e.at, ...(quiz ? { quiz } : {}) });
	}
	const starts = Array.isArray(o.starts) ? o.starts.filter((t): t is number => typeof t === "number" && Number.isFinite(t)).slice(-MAX_STARTS) : [];
	const log: AutoLearnLog = { v: 1, entries: bound(entries), starts };
	if (typeof o.chatId === "string" && CHAT_ID.test(o.chatId)) log.chatId = o.chatId;
	return log;
}
