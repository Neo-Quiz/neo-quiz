/* ══════════════════════════════════════════════════════════
   THE PHONE'S COMPOSER SENDS TO THE PC (the host side of Tasks 9-13)

   A device that cannot generate (the phone) does not run the request: it
   writes one request file under `requests/<this device>/` in the synced
   folder, and the PC that owns the chat takes it (`remote-runner.ts`). The
   pure rules live in `remote-send.ts` (`buildRequest`, `pickTarget`,
   `settled`) and `remote-request.ts` (the validator that judges every file
   before it is written). This module is the glue: the request files of the
   host, the documents the phone may send, and the re-reading of its own
   requests (a recorded one is deleted here, a waiting one stays).
══════════════════════════════════════════════════════════ */

import { LOG_PREFIX } from "../branding";
import { currentHost } from "../host/current";
import { chatDevice, notifyChatsChanged } from "./chat-session";
import { getChats } from "./chat-store";
import { getOwnRequests, getRemoteGenerations, setOwnRequests } from "./remote-generations";
import { buildRequest, pickTarget, settled } from "./remote-send";
import type { RemoteRequest } from "../shared-state/remote-request";

/** The request files of the host (`ChatFiles` of `host/chat-files.ts`, the parts the phone uses). */
export interface RequestFiles {
	writeRequest(req: RemoteRequest): Promise<void>;
	listOwnRequests(): Promise<RemoteRequest[]>;
	deleteOwnRequest(id: string): Promise<void>;
}

let files: RequestFiles | null = null;

/** Set once the synced folder is there (`chat-sync.ts`). */
export function setRequestFiles(f: RequestFiles): void {
	files = f;
}

/** How often the phone re-reads its own requests while it is open. */
export const OWN_REQUESTS_EVERY_MS = 15_000;

/** Re-reads the phone's own requests, deletes those the record already holds, and repaints only when the list changed. Phone only. */
export async function refreshOwnRequests(): Promise<void> {
	if (!files || !currentHost().platform.isMobile) return;
	try {
		const own = await files.listOwnRequests();
		const done = new Set(settled(own, getChats()));
		for (const id of done) await files.deleteOwnRequest(id).catch(() => {});
		const kept = own.filter(q => !done.has(q.id));
		const before = JSON.stringify(getOwnRequests());
		setOwnRequests(kept);
		if (JSON.stringify(kept) !== before) notifyChatsChanged();
	} catch (e) {
		console.warn(LOG_PREFIX, "own requests not read:", e);
	}
}

/** Writes a request for the PC that owns the chat (or the last one seen, or none), then shows it as waiting. Throws when the validator refuses it or the file cannot be written. */
export async function enviquerVersPc(input: { chatId: string; text: string; mode: "learn" | "practice"; documents: Array<{ path: string }> }): Promise<void> {
	if (!files) throw new Error("request files not ready");
	const now = Date.now();
	const chat = getChats().find(c => c.id === input.chatId) ?? null;
	// No PC seen fresh: the request still waits (target ""), no PC matches it, and it expires after 24 h.
	const target = pickTarget(chat, getRemoteGenerations(), now) ?? "";
	const req = buildRequest(input, { device: chatDevice(), target, now });
	await files.writeRequest(req);
	setOwnRequests(await files.listOwnRequests());
	notifyChatsChanged();
}
