/* ══════════════════════════════════════════════════════════
   THE RELAY FLOW (phone): share the prompt and the documents to an AI app,
   then paste the answer back, save it like a generated quiz and record the
   request in THIS device's chat. Nothing is saved or recorded on a refusal.
══════════════════════════════════════════════════════════ */

import { absoluteInRoot } from "../shared-state/chat-merge";
import type { ChatRecord, ChatRequest } from "./chat-record";
import { brouillonDe } from "./generation-demande";
import type { enregistrerQuiz } from "./generation-demande";
import { buildRelayPrompt, extractQuizAnswer } from "./relay";
import type { RelayRefusal } from "./relay";
import { appendRequest, newRequestId } from "./chat-requests";
import type { AiSettings } from "../types/dashboard-ctx";
import type { Scanner } from "./scanner";

export interface RelayDeps {
	device: string; rootId: string; now(): number;
	share(text: string, files: Array<{ nom: string; octets: Uint8Array }>): Promise<boolean>;
	readClipboard(): Promise<string | null>;
	readDocument(rel: string): Promise<{ name: string; content: string; bytes: Uint8Array } | null>;
	save: typeof enregistrerQuiz;
	scanner: Scanner;
	/** Folder choice only: the relay has no provider. */
	reglages(): AiSettings;
	chats: { get(): ChatRecord[]; set(list: ChatRecord[]): void };
}
export interface RelayRequest { chatId: string; text: string; mode?: "learn" | "practice"; types?: string[]; count?: number | null; documents: Array<{ path: string }>; destination: string }
export interface RelaySession { token: string; mode: "learn" | "practice"; requestId: string; request: RelayRequest; /** Set once the quiz is saved: a session is consumed once. */ saved?: boolean }
export type PasteOutcome = { ok: true; title: string; path: string } | { ok: false; reason: RelayRefusal | "clipboard-empty" | "save-failed" | "already-saved"; detail?: string };

const MAX_DOCUMENT_BYTES = 1_000_000;

/** One document of the root for the relay: its text (for the prompt) and its
    bytes (to share), bounded, read through the host. null when missing, too
    big, outside the root or not UTF-8 text. */
export async function readRelayDocument(fs: { size(path: string): Promise<number | null>; readBinary(path: string): Promise<Uint8Array> }, rootId: string, rel: string): Promise<{ name: string; content: string; bytes: Uint8Array } | null> {
	const path = absoluteInRoot(rel, rootId);
	if (!path) return null;
	try {
		const size = await fs.size(path);
		if (size === null || size > MAX_DOCUMENT_BYTES) return null;
		const bytes = await fs.readBinary(path);
		if (bytes.length > MAX_DOCUMENT_BYTES) return null;
		const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return { name: rel.slice(rel.lastIndexOf("/") + 1), content, bytes };
	} catch { return null; }
}

/** Builds the prompt, shares it with the documents. null when the sheet could not open or a document is unreadable. */
export async function startRelay(deps: RelayDeps, req: RelayRequest): Promise<RelaySession | null> {
	const docs: Array<{ name: string; content: string; bytes: Uint8Array }> = [];
	for (const d of req.documents) {
		const doc = await deps.readDocument(d.path);
		if (!doc) return null;
		docs.push(doc);
	}
	const built = buildRelayPrompt({ text: req.text, mode: req.mode, types: req.types, count: req.count, documents: docs.map(d => ({ name: d.name, content: d.content })) });
	const opened = await deps.share(built.text, docs.map(d => ({ nom: d.name, octets: d.bytes })));
	return opened ? { token: built.token, mode: built.mode, requestId: newRequestId(), request: req } : null;
}

/** Reads the clipboard (explicit tap), extracts, saves like a generated quiz, records the request in OUR chat file. Saves nothing on any refusal. */
export async function pasteAnswer(deps: RelayDeps, s: RelaySession): Promise<PasteOutcome> {
	if (s.saved) return { ok: false, reason: "already-saved" };
	const pasted = await deps.readClipboard();
	if (pasted === null || !pasted.trim()) return { ok: false, reason: "clipboard-empty" };
	const found = extractQuizAnswer(pasted, s.mode, s.token);
	if (!found.ok) return { ok: false, reason: found.reason, detail: found.detail };
	const saved = await deps.save({
		draft: brouillonDe(found.questions), questions: found.questions, modeDemande: s.mode, titreModele: found.title,
		demande: { text: s.request.text, notes: s.request.documents.map(d => ({ name: nameOf(d.path) })) },
		destination: s.request.destination, reglages: deps.reglages(), usage: null, scanner: deps.scanner,
	});
	if (!saved) return { ok: false, reason: "save-failed" };
	s.saved = true;
	record(deps, s, saved);
	return { ok: true, title: saved.title, path: saved.path };
}

const nameOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

/** The request goes into the store as it is: the chat keeps its origin; the file layer writes only what this device owns (`ownToWrite`). */
function record(deps: RelayDeps, s: RelaySession, saved: { title: string; path: string }): void {
	const now = deps.now();
	const request: ChatRequest = {
		id: s.requestId, at: now, from: deps.device, text: s.request.text, mode: s.mode,
		documents: s.request.documents.map(d => {
			const path = absoluteInRoot(d.path, deps.rootId);
			return path ? { name: nameOf(d.path), path } : { name: nameOf(d.path) };
		}),
		results: [{ kind: "quiz", title: saved.title, path: saved.path }], state: "done",
	};
	deps.chats.set(appendRequest(deps.chats.get(), s.request.chatId, request, deps.device, now));
}
