import { newRequestId } from "./chat-requests";
import type { ChatRecord } from "./chat-record";
import { isStale, lastPcSeen } from "../shared-state/generations";
export { latestDevice } from "../shared-state/generations";
import type { GenerationsFile } from "../shared-state/generations";
import { pendingState, validateRemote } from "../shared-state/remote-request";
import type { RemoteRequest } from "../shared-state/remote-request";
import { deviceInfo, soleOnlinePc } from "../shared-state/devices";
import type { DeviceFile } from "../shared-state/devices";
import { relativeToRoot } from "../shared-state/chat-merge";

/* The phone's sender core (pure): builds a request the PC's own validator accepts, picks the PC, and says which of our request files can go. */

export interface SendInput { chatId: string; text: string; mode: "learn" | "practice"; types?: string[]; count?: number | null; documents: Array<{ path: string }>; model?: string }

export function buildRequest(input: SendInput, ctx: { device: string; target: string; deviceName?: string; now: number; newId?: () => string }): RemoteRequest {
	const id = (ctx.newId ?? newRequestId)();
	const req: RemoteRequest = { v: 1, id, at: ctx.now, from: ctx.device, target: ctx.target, chatId: input.chatId, text: input.text, mode: input.mode, documents: input.documents.map(d => ({ path: d.path })) };
	if (ctx.deviceName) req.fromName = ctx.deviceName.slice(0, 64);
	if (input.types?.length) req.types = [...input.types];
	if (input.count) req.count = input.count;
	if (input.model) req.model = input.model;
	// The PC's own validator is the single judge: a request it would refuse is never written.
	const verdict = validateRemote(req, { device: ctx.target, fileDevice: ctx.device, fileId: id, now: ctx.now });
	if (!verdict.ok) throw new Error("request refused: " + verdict.reason);
	return verdict.request;
}

/** Where a request goes: the preferred PC (chosen by hand, else the only one online), else the chat's PC while fresh, else the last PC seen fresh, else the chat's PC (even stale), else the last PC ever seen (even stale). Null only when no PC was ever seen. */
export function pickTarget(chat: { origin: string } | null, files: ReadonlyArray<{ device: string; file: GenerationsFile }>, now: number, lastEver: string | null = null, preferred: string | null = null): string | null {
	// The PC tapped in the PC window, or the only one online (`preferred`, see `preferredPc`), wins over everything.
	if (preferred) return preferred;
	if (chat) {
		const own = files.find(f => f.device === chat.origin);
		if (own && !isStale(own.file, now)) return chat.origin;
	}
	return lastPcSeen(files, now) ?? (chat?.origin || null) ?? lastEver;
}

export function settled(own: ReadonlyArray<Pick<RemoteRequest, "id">>, chats: ReadonlyArray<ChatRecord>): string[] {
	const recorded = new Set(chats.flatMap(c => c.requests.map(q => q.id)));
	return own.filter(q => recorded.has(q.id)).map(q => q.id);
}

export interface PhoneDocument { name: string; path?: string }

/** Why a document cannot go to the PC from the phone, or null when it can: it must be a text or Markdown file inside the Neo Quiz folder. */
export function refusPourTelephone(doc: PhoneDocument, rootId: string): "ai.remote.insideFolderOnly" | "ai.remote.textOnly" | null {
	if (!doc.path || !relativeToRoot(doc.path, rootId)) return "ai.remote.insideFolderOnly";
	return /\.(md|markdown|txt)$/i.test(doc.name) ? null : "ai.remote.textOnly";
}

/** Where a request goes (see `pickTarget`). Null only when no PC was ever seen: an empty target is never written. */
export function targetOf(chat: { origin: string } | null, files: ReadonlyArray<{ device: string; file: GenerationsFile }>, now: number, lastSeen: string | null, preferred: string | null = null): string | null {
	return pickTarget(chat, files, now, lastSeen, preferred);
}

/** The PC the phone prefers: the one tapped in the PC window while it still has a device file, else the only paired PC online (matched by name), else null. */
export function preferredPc(chosen: string | null, devices: ReadonlyArray<DeviceFile>, peers: ReadonlyArray<{ name: string; connected: boolean; paused: boolean }>): string | null {
	if (chosen && deviceInfo(devices, chosen)) return deviceInfo(devices, chosen)!.device;
	return soleOnlinePc(peers, devices);
}

/** The model a request carries: the phone's choice, only while the target PC lists it (its device file); else none, and the PC uses its own default. */
export function modelFor(choice: string | null, info: DeviceFile | null): string | undefined {
	return choice && info?.claudeModels.some(m => m.id === choice) ? choice : undefined;
}

/** Whether a PC is reachable: its generations file is present and fresh. */
export function pcFresh(device: string, files: ReadonlyArray<{ device: string; file: GenerationsFile }>, now: number): boolean {
	return files.some(f => f.device === device && !isStale(f.file, now));
}

/** Whether a request sent to `device` will be picked up: a fresh generations file means it is running; otherwise an idle PC writes nothing, so a connected paired device (Syncthing) with a PC ever seen counts as reachable. The generations file is named by the journal device id, not the Syncthing id, so the connection is checked on any paired device. */
export function pcReachable(device: string | null, files: ReadonlyArray<{ device: string; file: GenerationsFile }>, now: number, peerConnected: boolean): boolean {
	if (device === null) return false;
	return pcFresh(device, files, now) || peerConnected;
}

/** The phone's own request files after a sync. `drop`: the ids to delete from disk (recorded in a chat, or expired past 24 h).
    `keep`: what the phone lists, newest first: the waiting files on disk, and the expired ones (on disk, or deleted this session).
    A remembered request is listed only while it is still expired and not recorded. */
export function ownAfterSync(disk: ReadonlyArray<RemoteRequest>, previous: ReadonlyArray<RemoteRequest>, recorded: ReadonlySet<string>, now: number): { keep: RemoteRequest[]; drop: string[] } {
	const expired = (q: RemoteRequest): boolean => pendingState(q, { recorded: new Set(), running: new Set(), now }) === "expired";
	const drop = disk.filter(q => recorded.has(q.id) || expired(q)).map(q => q.id);
	const onDisk = disk.filter(q => !recorded.has(q.id));
	const ids = new Set(disk.map(q => q.id));
	const remembered = previous.filter(q => !ids.has(q.id) && !recorded.has(q.id) && expired(q));
	return { keep: [...onDisk, ...remembered].sort((a, b) => b.at - a.at), drop };
}
