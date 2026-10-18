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
import type { ClarifyOption, ClarifyQuestion } from "./generation-kind";
import { MAX_CLARIFY_QUESTIONS, MAX_HEADER, defaultIndex, isQuizzesChoice } from "./generation-kind";
import { NAME_UNSAFE } from "../shared-state/remote-request";
import { estCategorie } from "./categorie-quiz";
import type { CategorieQuiz } from "./categorie-quiz";

export type ChatMode = "learn" | "practice";
export type ClarifyAction = "generate" | "web" | "relay" | "remote";
export interface ChatDocument { name: string; path?: string }
export type ChatResult = { kind: "quiz"; title: string; path: string } | { kind: "text"; text: string };
export type RequestState = "done" | "failed" | "stopped";
/** Where a request's AI work sits in a live run (2026-10-11): its turn's
    lines, from `fromSeq` to `toSeq`, in the run store of the PC that ran
    it. Read back to show the work of a chat reopened after a restart, or
    of a request whose line left the queue. */
export interface ChatRun { runId: string; fromSeq: number; toSeq: number }

/** The clarifying questions Generate asked under a vague request (spec
    2026-10-07-generate-auto-kind): the questions, and the answers once all are
    given (one list of chosen labels per question, typed text included; an empty list is a skipped question).
    Absent `answers`: nothing generates yet. */
export interface ChatClarify { questions: ClarifyQuestion[]; answers?: string[][]; /** The kind to generate once answered (`both` included: `mode` cannot say it). */ genre?: "learn" | "practice" | "both"; action?: ClarifyAction; /** The subject the AI picked (a `CATEGORIES` id), kept for the generation that follows the answers. */ subject?: CategorieQuiz }

export interface ChatRequest {
	id: string;
	/** Epoch ms of the send. */
	at: number;
	/** The device that SENT it (always this device in phase 1). */
	from: string;
	/** The name the sending device gave itself, kept when no device file names it (a phone). */
	fromName?: string;
	/** The PC that RAN the request, when it is not the sender (a phone request). Absent: the sender ran it. */
	on?: string;
	text: string;
	mode: ChatMode;
	documents: ChatDocument[];
	results: ChatResult[];
	state: RequestState;
	error?: string;
	/** Set when clarifying questions were asked: kept with the request, shown under it. */
	clarify?: ChatClarify;
	/** The provider, model and effort the request was sent with (frozen at the send). Plain labels,
	    compared against the app's own lists when the chat is reopened; never executed or used as a path. */
	provider?: string;
	model?: string;
	effort?: string;
	/** The folder the request worked in (frozen at the send, 2026-10-11): the
	    chat's working folder, as a Claude Code session has one. Read from a
	    synced file, so bounded (`readFolder`); the main process still judges
	    any folder before an agent runs there. */
	folder?: string;
	/** The live turns of the request, oldest first (an "/exam" plan has
	    several). Read from a synced file: a run id and two `seq` only,
	    validated (`readRuns`); the main process reads them, never a path. */
	runs?: ChatRun[];
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
	/** The live Claude Code / Codex runs of this chat (2026-10-11), oldest
	    first: ids in the run store of the PC that ran them (`HostLive`), never
	    a path. Read from a synced file: lowercase UUIDs only, each once, at
	    most `MAX_RUN_IDS`. Absent on a chat stored before live sessions. */
	runIds?: string[];
	/** The quiz this chat explains (an Explain chat). */
	explain?: ChatExplain;
	/** A chat the app fills on its own (see `ChatMark`). */
	mark?: ChatMark;
}

/** A chat the app fills on its own: "moodle-auto" holds the automatic Learns of new Moodle lectures (spec 2026-10-15-moodle-auto-learn). */
export type ChatMark = "moodle-auto";
export function readMark(x: unknown): ChatMark | undefined { return x === "moodle-auto" ? x : undefined; }

/** The chat that holds queue lines saved before chats existed. */
export const LEGACY_CHAT_ID = "queue-before-chats";
export const MAX_CHATS = 200;
/** A written answer is bounded: a chat is a few kilobytes, never a transcript. */
export const MAX_RESULT_TEXT = 20_000;

/** The most run ids a chat keeps (the newest). */
export const MAX_RUN_IDS = 500;
/** A run id as the main process creates it (`crypto.randomUUID()`). */
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isRunId = (x: unknown): x is string => typeof x === "string" && RUN_ID.test(x);

/** Valid ids, each once, the newest `MAX_RUN_IDS`; `undefined` when none. */
export function readRunIds(x: unknown): string[] | undefined {
	if (!Array.isArray(x)) return undefined;
	const out = [...new Set(x.filter(isRunId))].slice(-MAX_RUN_IDS);
	return out.length ? out : undefined;
}

/** The most live turns a request keeps. */
export const MAX_REQUEST_RUNS = 20;

function readRun(x: unknown): ChatRun | null {
	if (!isObj(x) || !isRunId(x.runId)) return null;
	const { fromSeq, toSeq } = x;
	if (!Number.isSafeInteger(fromSeq) || !Number.isSafeInteger(toSeq) || (fromSeq as number) < 0 || (toSeq as number) < (fromSeq as number)) return null;
	return { runId: x.runId, fromSeq: fromSeq as number, toSeq: toSeq as number };
}

/** Valid turns, each once (same run and start), the newest
    `MAX_REQUEST_RUNS`; `undefined` when none. */
export function readRuns(x: unknown): ChatRun[] | undefined {
	if (!Array.isArray(x)) return undefined;
	const seen = new Set<string>();
	const out: ChatRun[] = [];
	for (const r of x.map(readRun)) {
		if (!r || seen.has(r.runId + ":" + r.fromSeq)) continue;
		seen.add(r.runId + ":" + r.fromSeq);
		out.push(r);
	}
	return out.length ? out.slice(-MAX_REQUEST_RUNS) : undefined;
}

/** The chats once every run was deleted ("Delete all"): no run ids, no
    request pointing into a run. Nothing else changes. */
export function withoutRuns(chats: readonly ChatRecord[]): ChatRecord[] {
	return chats.map(c => {
		const { runIds: _ids, ...rest } = c;
		return { ...rest, requests: c.requests.map(q => { const { runs: _runs, ...r } = q; return r; }) };
	});
}

/** Bound of a stored provider / model / effort label. */
export const MAX_LABEL = 100;

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

function readClarify(x: unknown): ChatClarify | null {
	if (!isObj(x) || !Array.isArray(x.questions) || x.questions.length < 1 || x.questions.length > MAX_CLARIFY_QUESTIONS) return null;
	const questions: ClarifyQuestion[] = [];
	for (const q of x.questions) {
		if (!isObj(q) || !isStr(q.question) || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) return null;
		const options: ClarifyOption[] = [];
		for (const o of q.options) {
			if (!isObj(o) || !isStr(o.label)) return null;
			options.push({ label: o.label, description: isStr(o.description) ? o.description : "", ...(isQuizzesChoice(o.quizzes) ? { quizzes: o.quizzes } : {}) });
		}
		/* Both marks are kept: the answer is read back from this record, and a
		   lost "quizzes" mark turned "Auto" into one quiz per document while the
		   model had been told to split by theme (2026-10-14). A lost "folder"
		   mark (2026-10-17) would file the quiz by its subject instead of in the
		   folder the learner picked. */
		const purpose = q.multiple === true ? undefined
			: q.purpose === "quizzes" && options.every(option => option.quizzes !== undefined) ? "quizzes" as const
			: q.purpose === "folder" ? "folder" as const
			: undefined;
		questions.push({ header: isStr(q.header) ? q.header.slice(0, MAX_HEADER) : "", question: q.question, multiple: q.multiple === true, options, default: defaultIndex(q.default, options.length), ...(purpose ? { purpose } : {}) });
	}
	const clarify: ChatClarify = { questions };
	if (x.genre === "learn" || x.genre === "practice" || x.genre === "both") clarify.genre = x.genre;
	if (estCategorie(x.subject) && x.subject !== "general") clarify.subject = x.subject;
	if (x.action === "generate" || x.action === "web" || x.action === "relay" || x.action === "remote") clarify.action = x.action;
	// One list per question; an EMPTY list is a skipped question.
	if (Array.isArray(x.answers) && x.answers.length === questions.length && x.answers.every(a => Array.isArray(a) && a.every(isStr))) clarify.answers = (x.answers as string[][]).map(a => [...a]);
	return clarify;
}

/** A stored working folder: a path of at most 400 characters, without
    control characters and without a ".." segment; anything else is dropped. */
export function readFolder(x: unknown): string | undefined {
	if (!isStr(x) || x.length < 1 || x.length > 400 || /[\u0000-\u001f\u007f]/.test(x)) return undefined;
	if (x.split(/[\\/]/).includes("..")) return undefined;
	return x;
}

/** A stored path: segments separated by "/", none empty, "." or "..", no
    drive letter, no backslash, no control character, not absolute. The one
    path rule of the synced chat files (Explain marks, result and document
    paths, remote requests). */
export function isCleanRelativePath(p: string): boolean {
	if (!p || p.length > 500 || p.includes("\\") || /[\u0000-\u001f\u007f]/.test(p) || p.startsWith("/") || /^[A-Za-z]:/.test(p)) return false;
	return p.split("/").every(s => s !== "" && s !== "." && s !== "..");
}

/** The quiz an Explain chat is about (2026-10-14, one chat per quiz): the
    quiz note (a contract path) and its title shown in the chat list. Read
    from a synced file: hostile. `foreign`: the quiz lives in another root
    than the chats file's, so the stored path is the full contract path, kept
    verbatim (only a device that has that root resolves it). */
export interface ChatExplain { path: string; quiz: string; foreign?: true }

/** A stored Explain mark: a clean path (`isCleanRelativePath`) ending in
    `.md` and a bounded label; anything else drops the mark (the chat stays a
    plain chat). `foreign` is kept only when it is exactly `true`. Only the
    known fields are copied. */
export function readExplain(x: unknown): ChatExplain | undefined {
	if (!isObj(x) || !isStr(x.path) || !isStr(x.quiz)) return undefined;
	const p = x.path;
	if (!isCleanRelativePath(p) || !p.toLowerCase().endsWith(".md")) return undefined;
	const quiz = readLabel(x.quiz);
	if (!quiz) return undefined;
	return x.foreign === true ? { path: p, quiz, foreign: true } : { path: p, quiz };
}

/** A stored label: a non-empty string without control characters, at most `MAX_LABEL` long; anything else is dropped. */
export function readLabel(x: unknown): string | undefined {
	if (!isStr(x) || x.length < 1 || x.length > MAX_LABEL || /[\u0000-\u001f\u007f]/.test(x)) return undefined;
	return x;
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
	if (isStr(x.fromName) && x.fromName.length > 0 && x.fromName.length <= 64 && !NAME_UNSAFE.test(x.fromName)) req.fromName = x.fromName;
	if (isStr(x.on) && x.on.length > 0 && x.on.length <= 64) req.on = x.on;
	const clarify = readClarify(x.clarify);
	if (clarify) req.clarify = clarify;
	const provider = readLabel(x.provider), model = readLabel(x.model), effort = readLabel(x.effort);
	if (provider) req.provider = provider;
	if (model) req.model = model;
	if (effort) req.effort = effort;
	const folder = readFolder(x.folder);
	if (folder) req.folder = folder;
	const runs = readRuns(x.runs);
	if (runs) req.runs = runs;
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
	const runIds = readRunIds(x.runIds);
	if (runIds) chat.runIds = runIds;
	const explain = readExplain(x.explain);
	if (explain) chat.explain = explain;
	const mark = readMark(x.mark);
	if (mark) chat.mark = mark;
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

/** The runs of a chat; none for an unknown or deleted chat. */
export function runIdsOf(chats: readonly ChatRecord[], chatId: string): string[] {
	const c = chats.find(x => x.id === chatId);
	return c && !c.deleted ? [...(c.runIds ?? [])] : [];
}

/** A run started for a chat: kept with it (bounded, each id once). An
    unknown chat is created empty (its first request is recorded when it
    ends); a deleted chat is never revived; a bad id changes nothing. */
export function addRunId(chats: readonly ChatRecord[], chatId: string, runId: string, device: string, now: number): ChatRecord[] {
	if (!isRunId(runId)) return [...chats];
	const idx = chats.findIndex(c => c.id === chatId);
	if (idx < 0) return [...chats, { id: chatId, origin: device, createdAt: now, updatedAt: now, requests: [], runIds: [runId] }];
	const c = chats[idx];
	if (c.deleted || c.runIds?.includes(runId)) return [...chats];
	const list = [...chats];
	list[idx] = { ...c, updatedAt: now, runIds: [...(c.runIds ?? []), runId].slice(-MAX_RUN_IDS) };
	return list;
}
