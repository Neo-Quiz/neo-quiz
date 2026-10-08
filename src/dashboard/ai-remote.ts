/* ══════════════════════════════════════════════════════════
   THE PHONE'S COMPOSER SENDS TO THE PC (the host side of Tasks 9-13)

   A device that cannot generate (the phone) does not run the request: it
   writes one request file under `requests/<this device>/` in the synced
   folder, and the PC that owns the chat takes it (`remote-runner.ts`). The
   pure rules live in `remote-send.ts` (`buildRequest`, `targetOf`,
   `ownAfterSync`) and `remote-request.ts` (the validator that judges every file
   before it is written). This module is the glue: the request files of the
   host, the documents the phone may send, and the re-reading of its own
   requests (a recorded one is deleted here, a waiting one stays).
══════════════════════════════════════════════════════════ */

import { LOG_PREFIX } from "../branding";
import { currentHost } from "../host/current";
import { chatDevice, notifyChatsChanged } from "./chat-session";
import { getChats } from "./chat-store";
import { chosenPc, getDevices, getOwnRequests, getPairedPeers, getRemoteGenerations, lastPcEver, remoteModel, setOwnRequests } from "./remote-generations";
import { deviceInfo, soleOnlinePc } from "../shared-state/devices";
import { buildRequest, modelFor, ownAfterSync, preferredPc, targetOf } from "./remote-send";
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

/** Re-reads the phone's own requests: deletes the recorded and the expired ones from disk, lists the rest (expired ones stay listed for the session), and repaints only when the list changed. Phone only. */
export async function refreshOwnRequests(): Promise<void> {
	if (!files || !currentHost().platform.isMobile) return;
	try {
		const disk = await files.listOwnRequests();
		const recorded = new Set(getChats().flatMap(c => c.requests.map(q => q.id)));
		const { keep, drop } = ownAfterSync(disk, getOwnRequests(), recorded, Date.now());
		for (const id of drop) await files.deleteOwnRequest(id).catch(() => {});
		const before = JSON.stringify(getOwnRequests());
		setOwnRequests(keep);
		if (JSON.stringify(keep) !== before) notifyChatsChanged();
	} catch (e) {
		console.warn(LOG_PREFIX, "own requests not read:", e);
	}
}

/** Writes a request for the PC of the chat (or the last one seen), then shows it as waiting. False, and nothing written, when no PC was ever seen: the typed text stays with the caller. Throws when the validator refuses it or the file cannot be written. */
export async function enviquerVersPc(input: { chatId: string; text: string; mode: "learn" | "practice"; documents: Array<{ path: string }> }): Promise<boolean> {
	if (!files) throw new Error("request files not ready");
	const now = Date.now();
	const chat = getChats().find(c => c.id === input.chatId) ?? null;
	const target = targetOf(chat, getRemoteGenerations(), now, lastPcEver(), preferredPc(chosenPc(), getDevices()), soleOnlinePc(getPairedPeers(), getDevices()));
	if (!target) return false;
	const model = modelFor(remoteModel(), deviceInfo(getDevices(), target));
	const req = buildRequest(model ? { ...input, model } : input, { device: chatDevice(), target, now });
	await files.writeRequest(req);
	setOwnRequests(await files.listOwnRequests());
	notifyChatsChanged();
	return true;
}
