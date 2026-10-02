/* ══════════════════════════════════════════════════════════
   THE CHAT ON SCREEN (spec 2026-10-02, phase 1)

   Its id lives in `sessionStorage`: it survives a reload of the window
   (Ctrl+R, a setting that reloads) and not a restart of the application,
   the same scope as the generation queue it follows
   (`generation-queue-store.ts`). A restart opens an empty chat; the chats
   themselves are in `chat-store.ts`. Everything that shows chats (sidebar,
   thread, page mode) repaints on `onChatsChanged`.
══════════════════════════════════════════════════════════ */

import { LOG_PREFIX } from "../branding";
import { currentHost } from "../host/current";

const KEY = "neo-quiz.active-chat";
/** An id ends up in a storage key and in the DOM: only this shape is trusted. */
const VALID = /^[a-z0-9][a-z0-9-]{3,63}$/;

type Store = Pick<Storage, "getItem" | "setItem">;

function sessionStore(): Storage | null {
	try {
		return typeof sessionStorage === "undefined" ? null : sessionStorage;
	} catch {
		return null;
	}
}

let active: string | null = null;
const listeners = new Set<() => void>();

export function newChatId(): string {
	return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function remember(id: string, storage: Store | null): void {
	try { storage?.setItem(KEY, id); } catch { /* no storage: the chat lasts the page */ }
}

/** The chat on screen. Always one: an empty chat is created when none is
    remembered (or the remembered id is not a valid one). */
export function activeChatId(storage: Store | null = sessionStore()): string {
	if (active) return active;
	let id: string | null = null;
	try { id = storage?.getItem(KEY) ?? null; } catch { /* idem */ }
	if (!id || !VALID.test(id)) { id = newChatId(); remember(id, storage); }
	active = id;
	return id;
}

/** Puts a chat on screen. Same chat or invalid id: nothing happens. */
export function setActiveChat(id: string, storage: Store | null = sessionStore()): void {
	if (!VALID.test(id) || id === activeChatId(storage)) return;
	active = id;
	remember(id, storage);
	notifyChatsChanged();
}

/** "New": an empty chat on screen; the previous one stays listed. */
export function startNewChat(storage: Store | null = sessionStore()): string {
	const id = newChatId();
	active = id;
	remember(id, storage);
	notifyChatsChanged();
	return id;
}

export function onChatsChanged(cb: () => void): () => void {
	listeners.add(cb);
	return () => { listeners.delete(cb); };
}

export function notifyChatsChanged(): void {
	for (const cb of [...listeners]) {
		try { cb(); } catch (e) { console.warn(LOG_PREFIX, "chat listener failed:", e); }
	}
}

/** This device's id (`HostRoot.deviceId`, the one that names its review
    journal file): the `origin` of a chat and the `from` of a request.
    "local" only when no host or root is installed. */
export function chatDevice(): string {
	try { return currentHost().paths.defaultRoot().deviceId || "local"; } catch { return "local"; }
}
