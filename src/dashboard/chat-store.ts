/* ══════════════════════════════════════════════════════════
   WHERE THE CHATS ARE KEPT, phase 1 (spec 2026-10-02)

   The window's own storage, in the record shape of the synced folder
   (`chat-record.ts`): phase 2 moves the file, not the model. Kept in
   `localStorage`, never in the vault nor in the settings: it can be empty
   or refused (private window) without a word. The session also holds the
   list IN MEMORY: a refused or full storage never makes the chat on screen
   disappear, and the page never re-parses the file on every repaint.
   (One window writes it: another window of the app would not see the
   changes before its next start.)
══════════════════════════════════════════════════════════ */

import { LOG_PREFIX } from "../branding";
import { readArchivedChats } from "./chat-archives";
import { mergeChats, ownToWrite } from "../shared-state/chat-merge";
import type { ChatRecord } from "./chat-record";
import { boundChats, chatsFromArchive, readChats } from "./chat-record";

const KEY = "neo-quiz.chats";
/** Set once the legacy archive has been imported. */
const FLAG = "neo-quiz.chats-imported";

type Store = Pick<Storage, "getItem" | "setItem">;

function safeStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

let cache: { storage: Store | null; list: ChatRecord[] } | null = null;

function parse(storage: Store | null): ChatRecord[] {
	try {
		const raw = storage?.getItem(KEY);
		return raw ? readChats(JSON.parse(raw)) : [];
	} catch {
		return [];
	}
}

/** Every chat, tombstones included, from memory after the first read. */
export function getChats(storage: Store | null = safeStorage()): ChatRecord[] {
	if (!cache || cache.storage !== storage) cache = { storage, list: parse(storage) };
	return [...cache.list];
}

/** Writes the list; a full storage drops the OLDEST live chat, one at a time,
    until it fits (tombstones are never dropped: they stop a deleted chat from
    coming back). Returns false when nothing fits or storage is refused. */
function write(list: readonly ChatRecord[], storage: Store | null): boolean {
	let kept = boundChats(list);
	while (true) {
		try {
			storage?.setItem(KEY, JSON.stringify({ v: 1, chats: kept }));
			return !!storage;
		} catch {
			const live = kept.filter(c => !c.deleted);
			if (live.length === 0) return false;
			const oldest = live.reduce((a, b) => (b.updatedAt < a.updatedAt ? b : a));
			kept = kept.filter(c => c !== oldest);
		}
	}
}

/** Replaces the whole list. The memory copy is updated FIRST: a refused
    write only means the chats are not kept after the session. */
export function setChats(list: readonly ChatRecord[], storage: Store | null = safeStorage()): boolean {
	cache = { storage, list: boundChats(list) };
	if (backend) {
		// Synced mode: the own file is the store; the old window key stays frozen for a rollback.
		scheduleSave(cache.list);
		return true;
	}
	const ok = write(list, storage);
	if (!ok) console.warn(LOG_PREFIX, "chats not saved (storage full or refused)");
	return ok;
}

/** Deleting is a tombstone: the chat stays in the file, empty and flagged, so
    that no other copy (phase 2) can bring it back. */
export function removeChat(id: string, now: number, storage: Store | null = safeStorage()): void {
	const list = getChats(storage).map(c => (c.id === id ? { id: c.id, origin: c.origin, createdAt: c.createdAt, updatedAt: now, deleted: true as const, requests: [] } : c));
	setChats(list, storage);
}

/** Imports the text-only archive of before (`neo-quiz.archived-chats`) as
    records, ONCE. The old key is left in place (a rollback still finds it); a
    chat already known (even deleted) is never imported again; a write that
    failed leaves the flag unset, so the next start tries again. */
export function importLegacyOnce(origin: string, storage: Store | null = safeStorage()): number {
	try {
		if (!storage || storage.getItem(FLAG)) return 0;
		const known = new Set(getChats(storage).map(c => c.id));
		const archived = chatsFromArchive(readArchivedChats(storage), origin);
		const fresh = archived.filter(c => !known.has(c.id));
		// Write whenever there is anything to keep, even when every chat is already in
		// memory: after a refused first write the memory copy is NOT on disk, and the
		// flag must only be set once the chats really are.
		if (archived.length && !setChats([...getChats(storage), ...fresh], storage)) return 0;
		storage.setItem(FLAG, "1");
		return fresh.length;
	} catch {
		return 0;
	}
}

/* ── Phase 2: the synced files (`.neo-quiz/chats/<device>.json`) ── */

export interface ChatBackend {
	device: string;
	own(): ChatRecord[];
	others(): ChatRecord[][];
	saveOwn(chats: ReadonlyArray<ChatRecord>): Promise<void>;
}

const SYNCED_FLAG = "neo-quiz.chats-synced";
const SAVE_DELAY_MS = 400;

let backend: ChatBackend | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> = Promise.resolve();
/** Writes queued or running. */
let inFlight = 0;
/** The last write failed: memory holds an edit the file does not. */
let saveFailed = false;

const viewOf = (b: ChatBackend): ChatRecord[] => mergeChats([b.own(), ...b.others()]);

function scheduleSave(list: readonly ChatRecord[]): void {
	const b = backend;
	if (!b) return;
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => { saveTimer = null; void writeNow(b, list); }, SAVE_DELAY_MS);
}

function writeNow(b: ChatBackend, list: readonly ChatRecord[]): Promise<void> {
	inFlight++;
	saving = saving
		.then(() => b.saveOwn(ownToWrite(list, b.device, b.others())))
		.then(() => { saveFailed = false; })
		.catch(e => { saveFailed = true; console.warn(LOG_PREFIX, "chats not saved to the synced folder:", e); })
		.finally(() => { inFlight--; });
	return saving;
}

/** Switches the store to the synced files. Imports the window-storage chats
    ONCE (flag set only after the file write succeeded; the old key is kept for
    a rollback). A failed write propagates after the merged view is in place. */
export async function attachChatBackend(b: ChatBackend, storage: Store | null = safeStorage()): Promise<void> {
	backend = b;
	saveFailed = false;
	try {
		if (storage && !storage.getItem(SYNCED_FLAG)) {
			const local = parse(storage).filter(c => c.origin === b.device || c.deleted);
			if (local.length) await b.saveOwn(ownToWrite(mergeChats([local, b.own()]), b.device, b.others()));
			storage.setItem(SYNCED_FLAG, "1");
		}
	} finally {
		cache = { storage, list: viewOf(b) };
	}
}

/** Re-merges after the backend re-read the other devices' files; true when the
    view changed. Skipped while a save is pending or failed: it would revert the
    latest edit. */
export function reloadFromBackend(): boolean {
	if (!backend || saveTimer || inFlight > 0 || saveFailed) return false;
	const next = viewOf(backend);
	const same = JSON.stringify(next) === JSON.stringify(cache?.list ?? []);
	if (!same) cache = { storage: cache?.storage ?? null, list: next };
	return !same;
}

/** Resolves when the last debounced own-file write is done. */
export async function flushChats(): Promise<void> {
	if (saveTimer && backend) { clearTimeout(saveTimer); saveTimer = null; await writeNow(backend, cache?.list ?? []); return; }
	await saving;
}

export function detachChatBackend(): void {
	backend = null;
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = null;
	saveFailed = false;
}
