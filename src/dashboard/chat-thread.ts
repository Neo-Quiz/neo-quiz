/* ══════════════════════════════════════════════════════════
   THE THREAD of a chat — pure

   What the Generate page shows for the chat on screen: its REQUESTS in order
   of sending. A request still in the queue is shown from its live lines (the
   working line, the transcript, Try again…); every other request is shown
   from the record (bubble, documents, cards, written answers) — which is also
   how a chat of an earlier session comes back. A request in both is shown
   once, from the live lines. The same items feed the context of a follow-up.
══════════════════════════════════════════════════════════ */

import type { LigneGeneration } from "./file-generation-app";
import type { TourPrecedent } from "./conversation-context";
import type { ChatRecord, ChatRequest } from "./chat-record";
import { groupLines } from "./chat-requests";
import { isStale } from "../shared-state/generations";
import type { GenerationsFile, RunningEntry } from "../shared-state/generations";
import { pendingState } from "../shared-state/remote-request";
import type { RemoteRequest } from "../shared-state/remote-request";

export type ThreadItem =
	| { kind: "live"; key: string; at: number; lines: LigneGeneration[] }
	| { kind: "record"; key: string; at: number; request: ChatRequest }
	/** A request running on ANOTHER device, read from its generations file. `stale`: that file is too old to mean a running PC. */
	| { kind: "remote"; key: string; at: number; entry: RunningEntry; device: string; stale: boolean }
	/** A request the phone sent and no PC has taken yet (its own file). `expired`: past the 24 h age limit. */
	| { kind: "pending"; key: string; at: number; target: string; request: { text: string; documents: Array<{ path: string }> }; state: "waiting" | "expired" };

/** A line sent before send times were kept goes after everything recorded. */
const UNKNOWN_TIME = Number.MAX_SAFE_INTEGER;

export function threadItems(chat: ChatRecord | null, lines: readonly LigneGeneration[], chatId: string, remote: ReadonlyArray<{ device: string; file: GenerationsFile }> = [], now: number = Date.now(), pending: ReadonlyArray<RemoteRequest> = []): ThreadItem[] {
	// A group whose lines were all stopped is not shown live: its record entry ("stopped") is.
	const groups = groupLines(lines).filter(g => g.chatId === chatId && g.lines.some(l => l.etat !== "arret"));
	const liveKeys = new Set(groups.map(g => g.key));
	const items: ThreadItem[] = groups.map(g => ({ kind: "live", key: g.key, at: g.lines[0].demande.sentAt ?? UNKNOWN_TIME, lines: g.lines }));
	const recorded = new Set<string>();
	if (chat && !chat.deleted) {
		for (const q of chat.requests) {
			recorded.add(q.id);
			if (!liveKeys.has(q.id)) items.push({ kind: "record", key: q.id, at: q.at, request: q });
		}
	}
	// Another device's request: shown only while neither this window nor the record has it.
	const runningElsewhere = new Set<string>();
	if (!chat?.deleted) {
		for (const { device, file } of remote) {
			const stale = isStale(file, now);
			for (const entry of file.running) {
				runningElsewhere.add(entry.requestId);
				if (entry.chatId !== chatId || liveKeys.has(entry.requestId) || recorded.has(entry.requestId)) continue;
				items.push({ kind: "remote", key: entry.requestId, at: entry.startedAt, entry, device, stale });
			}
		}
	}
	// The phone's own requests of this chat that no PC has taken yet. A recorded or running one is shown from there.
	if (!chat?.deleted) {
		for (const req of pending) {
			if (req.chatId !== chatId || liveKeys.has(req.id) || recorded.has(req.id) || runningElsewhere.has(req.id)) continue;
			const state = pendingState(req, { recorded: new Set(), running: new Set(), now });
			if (state !== "waiting" && state !== "expired") continue;
			items.push({ kind: "pending", key: req.id, at: req.at, target: req.target, request: { text: req.text, documents: req.documents.map(d => ({ path: d.path })) }, state });
		}
	}
	return items.sort((a, b) => a.at - b.at);
}

/** How many earlier requests a follow-up carries: chats persist across
    sessions, so the context must not grow with them. */
export const MAX_CONTEXT_REQUESTS = 12;

/** The earlier requests of a chat as the context of a follow-up. A live
    request carries what the queue still has (documents' text, the questions
    of the quizzes); a recorded one only what the record keeps (document
    names, quiz titles and files, written answers). */
export function toursOfThread(items: readonly ThreadItem[]): TourPrecedent[] {
	// A request running elsewhere has no content here yet: it is not context.
	const own = items.filter((i): i is Exclude<ThreadItem, { kind: "remote" | "pending" }> => i.kind !== "remote" && i.kind !== "pending");
	return own.slice(-MAX_CONTEXT_REQUESTS).map((item): TourPrecedent => {
		if (item.kind === "record") {
			const q = item.request;
			return {
				text: q.text,
				notes: q.documents.map(d => ({ name: d.name, content: "" })),
				quizzes: q.results.flatMap(x => (x.kind === "quiz" ? [{ title: x.title, questions: [], path: x.path }] : [])),
				answers: q.results.flatMap(x => (x.kind === "text" ? [x.text] : [])),
			};
		}
		// A planning line is no quiz of its own: its steps are the quizzes.
		const lines = item.lines.filter(l => l.etat !== "arret");
		const notes = new Map<string, { name: string; content: string }>();
		for (const l of lines) for (const n of l.demande.notes) notes.set(n.name, { name: n.name, content: n.content });
		const quizzes = lines.filter(l => !l.demande.planifier).flatMap(l => {
			const p = l.demande.produit;
			if (!p) return [];
			return p.lot ? p.lot.map(q => ({ title: q.titre, questions: q.questions })) : [{ title: p.titre, questions: p.questions }];
		});
		const answers = lines.flatMap(l => (l.etat === "prete" && l.resultat?.texte ? [l.resultat.texte] : []));
		return { text: lines[0]?.demande.text ?? "", notes: [...notes.values()], quizzes, answers };
	});
}
