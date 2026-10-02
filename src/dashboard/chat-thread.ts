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

export type ThreadItem =
	| { kind: "live"; key: string; at: number; lines: LigneGeneration[] }
	| { kind: "record"; key: string; at: number; request: ChatRequest };

/** A line sent before send times were kept goes after everything recorded. */
const UNKNOWN_TIME = Number.MAX_SAFE_INTEGER;

export function threadItems(chat: ChatRecord | null, lines: readonly LigneGeneration[], chatId: string): ThreadItem[] {
	// A group whose lines were all stopped is not shown live: its record entry ("stopped") is.
	const groups = groupLines(lines).filter(g => g.chatId === chatId && g.lines.some(l => l.etat !== "arret"));
	const liveKeys = new Set(groups.map(g => g.key));
	const items: ThreadItem[] = groups.map(g => ({ kind: "live", key: g.key, at: g.lines[0].demande.sentAt ?? UNKNOWN_TIME, lines: g.lines }));
	if (chat && !chat.deleted) {
		for (const q of chat.requests) if (!liveKeys.has(q.id)) items.push({ kind: "record", key: q.id, at: q.at, request: q });
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
	return items.slice(-MAX_CONTEXT_REQUESTS).map((item): TourPrecedent => {
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
