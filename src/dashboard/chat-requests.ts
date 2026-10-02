/* ══════════════════════════════════════════════════════════
   REQUESTS: from the lines of the queue to the chat record — pure

   A SEND is one request, but it can make several lines of the queue (one per
   document on Ollama, an "/exam" plan and its steps). Lines born from one
   send share a `requestId` (`file-generation-app.ts`): they are grouped back
   here, so that a chat shows ONE bubble and the record holds ONE request.
   The record is then kept up to date from the queue (`reconcileChats`),
   without ever erasing what an earlier pass recorded: a reply the user
   closed leaves the queue, not the chat.
══════════════════════════════════════════════════════════ */

import type { LigneGeneration } from "./file-generation-app";
import type { ChatDocument, ChatMode, ChatRecord, ChatRequest, ChatResult, RequestState } from "./chat-record";
import { LEGACY_CHAT_ID, deriveTitle, mergeResults } from "./chat-record";

export const isLive = (l: LigneGeneration): boolean => l.etat === "attente" || l.etat === "cours" || l.etat === "enregistrement";
export const isTerminal = (l: LigneGeneration): boolean => l.etat === "prete" || l.etat === "echouee" || l.etat === "arret";
export const chatOfLine = (l: LigneGeneration): string => l.demande.chatId ?? LEGACY_CHAT_ID;

/** The running line of a chat, if any: what the composer's Stop button of
    that chat stops. A run of another chat is never its business. */
export const runningLineOfChat = (lines: readonly LigneGeneration[], chatId: string): LigneGeneration | undefined =>
	lines.find(l => l.etat === "cours" && chatOfLine(l) === chatId);
export const requestKeyOfLine = (l: LigneGeneration): string => l.demande.requestId ?? "line-" + l.id;

export function newRequestId(): string {
	return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export interface RequestGroup {
	key: string;
	chatId: string;
	lines: LigneGeneration[];
}

/** The lines grouped by send, in order of first appearance. A group's first
    line is the one that carries the user's message (the plan line of an "/exam"). */
export function groupLines(lines: readonly LigneGeneration[]): RequestGroup[] {
	const groups = new Map<string, RequestGroup>();
	for (const l of lines) {
		const key = requestKeyOfLine(l);
		const g = groups.get(key);
		if (g) g.lines.push(l);
		else groups.set(key, { key, chatId: chatOfLine(l), lines: [l] });
	}
	return [...groups.values()];
}

/** What a finished line brought back: one card per quiz written (a one-pass
    line lists them), or the written answer. */
export function resultsOfLine(l: LigneGeneration): ChatResult[] {
	const res = l.resultat;
	if (l.etat !== "prete" || !res) return [];
	if (res.texte !== undefined) return [{ kind: "text", text: res.texte }];
	if (res.quiz && res.quiz.length > 0) return res.quiz.map(q => ({ kind: "quiz" as const, title: q.titre, path: q.chemin }));
	return res.chemin ? [{ kind: "quiz", title: res.titre, path: res.chemin }] : [];
}

function documentsOf(g: RequestGroup): ChatDocument[] {
	const byName = new Map<string, ChatDocument>();
	for (const l of g.lines) {
		for (const n of l.demande.notes) if (!byName.has(n.name)) byName.set(n.name, n.path ? { name: n.name, path: n.path } : { name: n.name });
		for (const img of l.demande.images) if (!byName.has(img.file.name)) byName.set(img.file.name, { name: img.file.name });
	}
	return [...byName.values()];
}

const STATE_RANK: Record<RequestState, number> = { done: 0, stopped: 1, failed: 2 };

function unionDocuments(old: readonly ChatDocument[], now: readonly ChatDocument[]): ChatDocument[] {
	const names = new Set(old.map(d => d.name));
	return [...old, ...now.filter(d => !names.has(d.name))];
}

/** The request a group stands for, or `null` while no line of it has ended.
    `old` is what was recorded before: its time and author stay, its results
    are kept. A request with an answer in and a sibling still working is
    "stopped" until it ends (an interrupted one stays so: "running" is never
    stored, it is read from the live queue). */
export function recordRequest(g: RequestGroup, device: string, now: number, old?: ChatRequest): ChatRequest | null {
	const terminal = g.lines.filter(isTerminal);
	if (terminal.length === 0) return null;
	const first = g.lines[0].demande;
	const failed = terminal.find(l => l.etat === "echouee");
	const interrupted = g.lines.some(isLive) || terminal.some(l => l.etat === "arret");
	let state: RequestState = failed ? "failed" : interrupted ? "stopped" : "done";
	// Lines that left the queue no longer speak: a recorded failure or
	// interruption is never softened to "done" by the lines that remain.
	if (old && STATE_RANK[old.state] > STATE_RANK[state]) state = old.state;
	const req: ChatRequest = {
		id: g.key,
		at: old?.at ?? first.sentAt ?? now,
		from: old?.from ?? device,
		// What the user sent is fixed once recorded; the remaining lines may be
		// only a part of the send.
		text: old?.text ?? first.text,
		mode: old?.mode ?? ((first.mode === "learn" ? "learn" : "practice") as ChatMode),
		documents: unionDocuments(old?.documents ?? [], documentsOf(g)),
		results: mergeResults(old?.results ?? [], terminal.flatMap(resultsOfLine)),
		state,
	};
	const error = failed?.erreur ?? old?.error;
	if (error && state === "failed") req.error = error;
	return req;
}

/** The chats brought up to date from the queue. A group with nothing ended is
    skipped; a deleted chat is never revived; a request already recorded is
    only replaced when something changed (so `updatedAt` only moves then). */
export function reconcileChats(chats: readonly ChatRecord[], groups: readonly RequestGroup[], device: string, now: number): { chats: ChatRecord[]; changed: boolean } {
	const list = [...chats];
	let changed = false;
	for (const g of groups) {
		const idx = list.findIndex(c => c.id === g.chatId);
		const prev = idx >= 0 ? list[idx] : null;
		if (prev?.deleted) continue;
		const old = prev?.requests.find(q => q.id === g.key);
		const next = recordRequest(g, device, now, old);
		if (!next) continue;
		if (old && JSON.stringify(old) === JSON.stringify(next)) continue;
		const requests = old ? prev!.requests.map(q => (q.id === g.key ? next : q)) : [...(prev?.requests ?? []), next].sort((a, b) => a.at - b.at);
		const chat: ChatRecord = prev
			? { ...prev, requests, updatedAt: now, title: prev.title ?? (deriveTitle(next) || undefined) }
			: { id: g.chatId, origin: device, createdAt: next.at, updatedAt: now, title: deriveTitle(next) || undefined, requests };
		if (idx >= 0) list[idx] = chat; else list.push(chat);
		changed = true;
	}
	return { chats: list, changed };
}

/** The finished replies that can leave the queue (freeing the documents they
    carry): those of a chat NOT on screen, whose whole request has ended with
    every line ready, and which the record already holds. A failed line stays
    (its "Try again" is live); a request with a sibling still working keeps
    all its replies, or the thread would show a hole. */
export function closableLines(lines: readonly LigneGeneration[], activeChatId: string, recorded: (chatId: string, requestKey: string) => boolean): LigneGeneration[] {
	const out: LigneGeneration[] = [];
	for (const g of groupLines(lines)) {
		if (g.chatId === activeChatId) continue;
		if (!g.lines.every(l => l.etat === "prete")) continue;
		if (!recorded(g.chatId, g.key)) continue;
		out.push(...g.lines);
	}
	return out;
}
