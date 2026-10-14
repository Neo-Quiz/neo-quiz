import { isCleanRelativePath } from "../dashboard/chat-record";
import type { ChatDocument, ChatExplain, ChatRecord, ChatRequest, ChatResult } from "../dashboard/chat-record";

/* ══════════════════════════════════════════════════════════
   CHATS ACROSS DEVICES, MERGED (PURE, no host)

   Each device writes ONLY `<root>/.neo-quiz/chats/<device>.json` (see
   `check:shared-state` for the same rule on exams) and every device reads
   them all. Per chat id the highest `updatedAt` gives the metadata (title,
   tombstone); the REQUESTS are the union of every copy, by request id: a chat
   started on the phone and answered by the PC lives in two files, and
   "highest wins" alone would drop one side's requests. A tombstone is never
   dropped. A device deleting a chat it does not own writes a tombstone for it
   in its own file (it cannot touch the owner's file). A device that adds a
   request to a chat it does not own writes a copy of that chat (same origin)
   holding only the requests no other file holds.
══════════════════════════════════════════════════════════ */

export const CHATS_DIR = "chats";
export const GENERATIONS_DIR = "generations";
export const REQUESTS_DIR = "requests";

function wins(a: ChatRecord, b: ChatRecord): boolean {
	if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
	if (!!a.deleted !== !!b.deleted) return !!a.deleted;
	return JSON.stringify(a) > JSON.stringify(b);
}

export function mergeChats(perDevice: ReadonlyArray<ReadonlyArray<ChatRecord>>): ChatRecord[] {
	const copies = new Map<string, ChatRecord[]>();
	for (const file of perDevice) for (const c of file) copies.set(c.id, [...(copies.get(c.id) ?? []), c]);
	const out: ChatRecord[] = [];
	for (const list of copies.values()) {
		const sorted = [...list].sort((a, b) => (wins(a, b) ? -1 : 1));
		const winner = sorted[0];
		if (winner.deleted) { const { runIds: _dropped, explain: _mark, ...dead } = winner; out.push({ ...dead, requests: [] }); continue; }
		const byId = new Map<string, ChatRequest>();
		// Winner first: its copy of a request is the one kept.
		for (const c of sorted) for (const q of c.deleted ? [] : c.requests) if (!byId.has(q.id)) byId.set(q.id, q);
		const merged: ChatRecord = { ...winner, requests: [...byId.values()].sort((a, b) => a.at - b.at) };
		// The runs live on the PC that ran them: a copy without them (the phone's) never drops them.
		const runIds = [...new Set(sorted.flatMap(c => c.runIds ?? []))];
		if (runIds.length) merged.runIds = runIds; else delete merged.runIds;
		// The Explain mark: the winner's, else a live copy's (an older device writes none; a tombstone carries none).
		const explain = winner.explain ?? sorted.find(c => !c.deleted && c.explain)?.explain;
		if (explain) merged.explain = explain; else delete merged.explain;
		out.push(merged);
	}
	return out;
}

/** What `device` may put in its OWN file: its chats; for a foreign chat, a tombstone unless another file already holds one at least as recent, or a copy with the requests no other file holds. */
export function ownToWrite(list: ReadonlyArray<ChatRecord>, device: string, others: ReadonlyArray<ReadonlyArray<ChatRecord>>): ChatRecord[] {
	const out: ChatRecord[] = [];
	for (const c of list) {
		if (c.origin === device) { out.push(c); continue; }
		if (c.deleted) {
			const held = others.some(f => f.some(o => o.id === c.id && o.deleted && o.updatedAt >= c.updatedAt));
			if (!held) out.push(c);
			continue;
		}
		// A request of a foreign chat that no other file holds: keep it in OUR file, under the chat's own origin.
		const heldIds = new Set(others.flatMap(f => f.filter(o => o.id === c.id).flatMap(o => o.requests.map(q => q.id))));
		const mine = c.requests.filter(q => !heldIds.has(q.id));
		if (mine.length) out.push({ ...c, requests: mine });
	}
	return out;
}

const INTERNAL = ".neo-quiz";

/** Whether segment `at` of a clean path is the internal folder, as Windows
    reads a name: case-insensitive, trailing dots and spaces ignored
    (".NEO-QUIZ" and ".neo-quiz." open the same folder). */
function inInternal(p: string, at = 0): boolean {
	return (p.split("/")[at] ?? "").replace(/[. ]+$/, "").toLowerCase() === INTERNAL;
}

export function relativeToRoot(path: string, rootId: string): string {
	const prefix = rootId ? rootId + "/" : "";
	if (prefix && !path.startsWith(prefix)) return "";
	const rel = path.slice(prefix.length);
	if (!isCleanRelativePath(rel) || inInternal(rel)) return "";
	return rel;
}

/** Whether a quiz card offers Open: the card names a quiz path. A quiz from a
    non-default root keeps Open; a card without a path (a written or failed
    result) does not. */
export function canOpenCard(path: string): boolean {
	return path !== "";
}

export function absoluteInRoot(rel: string, rootId: string): string {
	if (!isCleanRelativePath(rel) || inInternal(rel)) return "";
	return rootId ? rootId + "/" + rel : rel;
}

type Convert = (p: string) => string;

function convertDocument(d: ChatDocument, f: Convert): ChatDocument {
	if (d.path === undefined) return d;
	const p = f(d.path);
	return p ? { name: d.name, path: p } : { name: d.name };
}

function convertResult(x: ChatResult, f: Convert): ChatResult {
	return x.kind === "quiz" ? { ...x, path: f(x.path) } : x;
}

/** A full contract path kept as is: clean, and not into the internal folder.
    Its first segment is the root id, so the internal folder is the SECOND
    one ("<root>/.neo-quiz/x.md"); a first segment named like it is refused
    too. */
const asForeign = (p: string): string => (isCleanRelativePath(p) && !inInternal(p) && !inInternal(p, 1) ? p : "");

/** The Explain mark's quiz path. To the file: relative to the chats root, or,
    for a quiz of another open root (a declared vault), the full contract path
    marked `foreign` (relative to the chats root it would be lost, and each
    Explain on that quiz would start a new chat). From the file: a relative
    path is anchored to the root, a `foreign` one kept verbatim (only a device
    that has that root resolves it). Anything else drops the mark, never the
    chat. */
function convertExplain(e: ChatExplain, toFile: boolean, f: Convert): ChatExplain | undefined {
	if (toFile) {
		const rel = f(e.path);
		if (rel) return { path: rel, quiz: e.quiz };
		const full = asForeign(e.path);
		return full ? { path: full, quiz: e.quiz, foreign: true } : undefined;
	}
	const path = e.foreign ? asForeign(e.path) : f(e.path);
	if (!path) return undefined;
	return e.foreign ? { path, quiz: e.quiz, foreign: true } : { path, quiz: e.quiz };
}

function convertChats(chats: ReadonlyArray<ChatRecord>, toFile: boolean, f: Convert): ChatRecord[] {
	return chats.map(c => {
		const out: ChatRecord = {
			...c,
			requests: c.requests.map(q => ({ ...q, documents: q.documents.map(d => convertDocument(d, f)), results: q.results.map(x => convertResult(x, f)) })),
		};
		if (c.explain) {
			const explain = convertExplain(c.explain, toFile, f);
			if (explain) out.explain = explain; else delete out.explain;
		}
		return out;
	});
}

export const chatsToFile = (chats: ReadonlyArray<ChatRecord>, rootId: string): ChatRecord[] => convertChats(chats, true, p => relativeToRoot(p, rootId));
export const chatsFromFile = (chats: ReadonlyArray<ChatRecord>, rootId: string): ChatRecord[] => convertChats(chats, false, p => absoluteInRoot(p, rootId));
