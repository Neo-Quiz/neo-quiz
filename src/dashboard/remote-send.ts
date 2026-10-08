import { newRequestId } from "./chat-requests";
import type { ChatRecord } from "./chat-record";
import { isStale, lastPcSeen } from "../shared-state/generations";
import type { GenerationsFile } from "../shared-state/generations";
import { validateRemote } from "../shared-state/remote-request";
import type { RemoteRequest } from "../shared-state/remote-request";
import { relativeToRoot } from "../shared-state/chat-merge";

/* The phone's sender core (pure): builds a request the PC's own validator accepts, picks the PC, and says which of our request files can go. */

export interface SendInput { chatId: string; text: string; mode: "learn" | "practice"; types?: string[]; count?: number | null; documents: Array<{ path: string }> }

export function buildRequest(input: SendInput, ctx: { device: string; target: string; deviceName?: string; now: number; newId?: () => string }): RemoteRequest {
	const id = (ctx.newId ?? newRequestId)();
	const req: RemoteRequest = { v: 1, id, at: ctx.now, from: ctx.device, target: ctx.target, chatId: input.chatId, text: input.text, mode: input.mode, documents: input.documents.map(d => ({ path: d.path })) };
	if (ctx.deviceName) req.fromName = ctx.deviceName.slice(0, 64);
	if (input.types?.length) req.types = [...input.types];
	if (input.count) req.count = input.count;
	// The PC's own validator is the single judge: a request it would refuse is never written.
	const verdict = validateRemote(req, { device: ctx.target, fileDevice: ctx.device, fileId: id, now: ctx.now });
	if (!verdict.ok) throw new Error("request refused: " + verdict.reason);
	return verdict.request;
}

export function pickTarget(chat: { origin: string } | null, files: ReadonlyArray<{ device: string; file: GenerationsFile }>, now: number): string | null {
	if (chat) {
		const own = files.find(f => f.device === chat.origin);
		if (own && !isStale(own.file, now)) return chat.origin;
	}
	return lastPcSeen(files, now);
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
