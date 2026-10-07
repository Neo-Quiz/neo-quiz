/* ══════════════════════════════════════════════════════════
   THE CHAT RECORD of the Generate page (spec 2026-10-02, phase 1) — pure

   One chat = a list of REQUESTS, each with the documents it carried (by
   name), what came back (a card per quiz, the written answers) and how it
   ended. This is the shape the synced folder will hold in phase 2
   (`chats/<device>.json`); in phase 1 it lives in the window's storage
   (`chat-store.ts`). No transcripts: the model's thinking and raw writing
   are too heavy to keep.

   "Running" is NOT a stored state: it is read from the live queue. A
   request whose generation was cut short (the app closed while a sibling
   line was still working) is kept as "stopped".
══════════════════════════════════════════════════════════ */

import type { ArchivedChat } from "./chat-archives";
import type { KindChoice, KindOption } from "./generation-kind";

export type ChatMode = "learn" | "practice";
export interface ChatDocument { name: string; path?: string }
export type ChatResult = { kind: "quiz"; title: string; path: string } | { kind: "text"; text: string };
export type RequestState = "done" | "failed" | "stopped";

/** The question Generate asked under a request that did not say Learn or
    Test (spec 2026-10-07-generate-auto-kind): its options, and the one the
    user clicked (`chosen`, absent while nothing generates). */
export interface ChatAsk { question: string; options: KindOption[]; chosen?: KindChoice }

export interface ChatRequest {
	id: string;
	/** Epoch ms of the send. */
	at: number;
	/** The device that SENT it (always this device in phase 1). */
	from: string;
	text: string;
	mode: ChatMode;
	documents: ChatDocument[];
	results: ChatResult[];
	state: RequestState;
	error?: string;
	/** Set when the kind was asked: kept with the request, shown under it. */
	ask?: ChatAsk;
}

export interface ChatRecord {
	id: string;
	/** The device that started the chat. */
	origin: string;
	createdAt: number;
	updatedAt: number;
	title?: string;
	/** Tombstone: hides the chat, never dropped (a deleted chat must not come back). */
	deleted?: true;
	requests: ChatRequest[];
}

/** The chat that holds queue lines saved before chats existed. */
export const LEGACY_CHAT_ID = "queue-before-chats";
export const MAX_CHATS = 200;
/** A written answer is bounded: a chat is a few kilobytes, never a transcript. */
export const MAX_RESULT_TEXT = 20_000;

const isStr = (x: unknown): x is string => typeof x === "string";
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

function readResult(x: unknown): ChatResult | null {
	if (!isObj(x)) return null;
	if (x.kind === "quiz" && isStr(x.title) && isStr(x.path)) return { kind: "quiz", title: x.title, path: x.path };
	if (x.kind === "text" && isStr(x.text)) return { kind: "text", text: x.text.slice(0, MAX_RESULT_TEXT) };
	return null;
}

function readDocument(x: unknown): ChatDocument | null {
	if (!isObj(x) || !isStr(x.name)) return null;
	return isStr(x.path) ? { name: x.name, path: x.path } : { name: x.name };
}

function readAsk(x: unknown): ChatAsk | null {
	if (!isObj(x) || !isStr(x.question) || !Array.isArray(x.options)) return null;
	const isKind = (k: unknown): k is KindChoice => k === "learn" || k === "practice" || k === "both";
	const options: KindOption[] = [];
	for (const o of x.options) {
		if (isObj(o) && isStr(o.label) && isKind(o.kind)) options.push({ label: o.label, kind: o.kind });
	}
	if (options.length < 2 || options.length > 4) return null;
	const ask: ChatAsk = { question: x.question, options };
	if (isKind(x.chosen)) ask.chosen = x.chosen;
	return ask;
}

function readRequest(x: unknown): ChatRequest | null {
	if (!isObj(x) || !isStr(x.id) || !isNum(x.at) || !isStr(x.from) || !isStr(x.text)) return null;
	if (x.mode !== "learn" && x.mode !== "practice") return null;
	if (x.state !== "done" && x.state !== "failed" && x.state !== "stopped") return null;
	if (!Array.isArray(x.documents) || !Array.isArray(x.results)) return null;
	const req: ChatRequest = {
		id: x.id, at: x.at, from: x.from, text: x.text, mode: x.mode, state: x.state,
		documents: x.documents.map(readDocument).filter((d): d is ChatDocument => !!d),
		results: x.results.map(readResult).filter((d): d is ChatResult => !!d),
	};
	if (isStr(x.error)) req.error = x.error;
	const ask = readAsk(x.ask);
	if (ask) req.ask = ask;
	return req;
}

function readChat(x: unknown): ChatRecord | null {
	if (!isObj(x) || !isStr(x.id) || !isStr(x.origin) || !isNum(x.createdAt) || !isNum(x.updatedAt) || !Array.isArray(x.requests)) return null;
	const chat: ChatRecord = {
		id: x.id, origin: x.origin, createdAt: x.createdAt, updatedAt: x.updatedAt,
		requests: x.requests.map(readRequest).filter((q): q is ChatRequest => !!q),
	};
	if (isStr(x.title)) chat.title = x.title;
	if (x.deleted === true) chat.deleted = true;
	return chat;
}

/** The chats of a stored file (`{ v: 1, chats: [...] }`). Anything unreadable
    gives an empty list; a bad chat, request, result or document is dropped
    on its own, never the whole file. */
export function readChats(raw: unknown): ChatRecord[] {
	if (!isObj(raw) || raw.v !== 1 || !Array.isArray(raw.chats)) return [];
	return raw.chats.map(readChat).filter((c): c is ChatRecord => !!c);
}

const keyOf = (r: ChatResult): string => (r.kind === "quiz" ? "q:" + r.path : "t:" + r.text);

/** What a request holds after more of it came back: the old results stay (a
    closed reply must never erase an answer), the new ones are added once. */
export function mergeResults(old: readonly ChatResult[], incoming: readonly ChatResult[]): ChatResult[] {
	const seen = new Set(old.map(keyOf));
	const out = [...old];
	for (const r of incoming) {
		if (seen.has(keyOf(r))) continue;
		seen.add(keyOf(r));
		out.push(r);
	}
	return out;
}

/** The text-only archive of before (`neo-quiz.archived-chats`) as records: one
    request per user turn, every answer that follows as a text result. Imported
    once, so that old chats stay readable (`chat-store.ts`). */
export function chatsFromArchive(archived: readonly ArchivedChat[], origin: string): ChatRecord[] {
	return archived.map(a => {
		const requests: ChatRequest[] = [];
		let current: ChatRequest | null = null;
		const open = (text: string): ChatRequest => {
			const q: ChatRequest = { id: `${a.id}-${requests.length}`, at: a.date, from: origin, text, mode: "practice", documents: [], results: [], state: "done" };
			requests.push(q);
			return q;
		};
		for (const turn of a.turns) {
			if (turn.role === "user") { current = open(turn.text); continue; }
			current ??= open("");
			current.results.push({ kind: "text", text: turn.text.slice(0, MAX_RESULT_TEXT) });
		}
		const chat: ChatRecord = { id: a.id, origin, createdAt: a.date, updatedAt: a.date, requests };
		if (a.title) chat.title = a.title;
		return chat;
	});
}

/** The newest `MAX_CHATS` live chats, plus EVERY tombstone (tiny, and a
    dropped one would let the chat come back). */
export function boundChats(chats: readonly ChatRecord[]): ChatRecord[] {
	const live = chats.filter(c => !c.deleted).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS);
	return [...live, ...chats.filter(c => c.deleted)];
}

/** The first non-blank line of a text, trimmed and capped. */
export function firstLineOf(text: string): string {
	return (text.split("\n").map(s => s.trim()).find(Boolean) ?? "").slice(0, 120);
}

/** What the sidebar calls a request: its first line, else its first document, else the quiz it made. */
export function deriveTitle(r: Pick<ChatRequest, "text" | "documents" | "results">): string {
	const quiz = r.results.find((x): x is Extract<ChatResult, { kind: "quiz" }> => x.kind === "quiz");
	return firstLineOf(r.text) || r.documents[0]?.name || quiz?.title || "";
}

export function chatTitle(c: Pick<ChatRecord, "title" | "requests">): string {
	return c.title || (c.requests[0] ? deriveTitle(c.requests[0]) : "");
}
