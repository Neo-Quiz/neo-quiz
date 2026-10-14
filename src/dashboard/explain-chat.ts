/**
 * THE PURE CORE OF AN EXPLAIN CHAT (2026-10-14, spec
 * 2026-10-14-explain-live-ai-page-design, revised: one chat per quiz):
 * which saved chat a quiz reopens, what its thread shows (the record, then
 * the queue lines not yet recorded), and what a turn sends. No DOM, no host.
 */
import type { ChatExplain, ChatRecord, ChatRun } from "./chat-record";
import type { LigneGeneration } from "./file-generation-app";

/** The newest non-deleted Explain chat of the quiz at `path`. */
export function chatForQuiz(chats: readonly ChatRecord[], path: string): ChatRecord | null {
	let best: ChatRecord | null = null;
	for (const c of chats) {
		if (c.deleted || !c.explain || c.explain.path !== path) continue;
		if (!best || c.updatedAt > best.updatedAt) best = c;
	}
	return best;
}

/** The Explain mark of chat `chatId`: its record's, else that of one of its
    queue lines. A chat is recorded at its first answer: until then only its
    lines say it is an Explain chat, and the AI page would otherwise take a
    message typed in it for a quiz generation. A deleted chat has none. */
export function explainMarkOf(record: ChatRecord | null, lines: readonly LigneGeneration[], chatId: string): ChatExplain | null {
	if (record?.deleted) return null;
	if (record?.explain) return record.explain;
	for (const l of lines) {
		const mark = l.demande.chatId === chatId ? l.demande.explication?.mark : undefined;
		if (mark) return mark;
	}
	return null;
}

/** The id of the Explain chat of the quiz at `path`: the newest of its
    marked records (`chatForQuiz`) and of the chats that exist only in the
    queue (first answer still running), never a deleted one. Without the
    queue, reopening the quiz during the first answer started a second chat. */
export function explainChatIdForQuiz(chats: readonly ChatRecord[], lines: readonly LigneGeneration[], path: string): string | null {
	const rec = chatForQuiz(chats, path);
	let best: { id: string; at: number } | null = rec ? { id: rec.id, at: rec.updatedAt } : null;
	const known = new Set(chats.map(c => c.id));
	for (const l of lines) {
		const d = l.demande;
		if (!d.chatId || d.explication?.mark.path !== path || known.has(d.chatId)) continue;
		const at = d.sentAt ?? 0;
		if (!best || at > best.at) best = { id: d.chatId, at };
	}
	return best?.id ?? null;
}

export interface ExplainMessage {
	/** Request id + role: stable across repaints. */
	key: string;
	role: "user" | "assistant";
	text: string;
	documents: string[];
	/** The queue line of a turn still in the queue (its live work, its Stop). */
	lineId?: number;
	running?: boolean;
	error?: string;
	stopped?: boolean;
	/** Paused on a usage limit: not finished, it resumes (by itself at
	    `resumeAt`, null when the reset time is unknown, or on a click). */
	paused?: boolean;
	resumeAt?: number | null;
	at: number;
	model?: string;
	durationMs?: number;
	/** A recorded answer that ran as a live turn: where its AI work sits in its run. */
	runs?: ChatRun[];
}

/** The thread of chat `chatId`: its recorded turns, then each queue line of
    THIS chat whose request the record does not hold yet. */
export function explainMessages(record: ChatRecord | null, lines: readonly LigneGeneration[], chatId: string): ExplainMessage[] {
	const out: ExplainMessage[] = [];
	const recorded = new Set<string>();
	for (const q of record && !record.deleted ? record.requests : []) {
		recorded.add(q.id);
		out.push({ key: q.id + ":u", role: "user", text: q.text, documents: q.documents.map(d => d.name), at: q.at });
		const answer = q.results.map(r => (r.kind === "text" ? r.text : "")).filter(Boolean).join("\n\n");
		out.push({ key: q.id + ":a", role: "assistant", text: answer, documents: [], at: q.at, error: q.state === "failed" ? (q.error ?? "") : undefined, stopped: q.state === "stopped", model: q.model, ...(q.runs?.length ? { runs: q.runs } : {}) });
	}
	for (const l of lines) {
		const d = l.demande;
		if (d.chatId !== chatId || !d.explication) continue;
		const id = d.requestId ?? String(l.id);
		if (recorded.has(id)) continue;
		const running = l.etat === "cours" || l.etat === "attente" || l.etat === "enregistrement";
		out.push({ key: id + ":u", role: "user", text: d.texteAffiche ?? d.text, documents: d.notes.map(n => n.name), at: d.sentAt ?? 0 });
		out.push({
			key: id + ":a", role: "assistant", text: l.resultat?.texte ?? "", documents: [], lineId: l.id, running, at: d.sentAt ?? 0,
			error: l.etat === "echouee" ? (l.erreur ?? "") : undefined, stopped: l.etat === "arret", durationMs: l.resultat?.dureeMs,
			...(l.etat === "pause" ? { paused: true, resumeAt: l.pause?.reprise ?? null } : {}),
		});
	}
	return out;
}

/** What one turn sends: `full` when the live session is new (the quiz, the
    course, the message), `followUp` when it already holds the conversation
    (the message). BOTH end with the learner's position on the quiz, when
    there is one: it is what "this" means in the message. */
export function explainTurnTexts(o: { context: string; course: string; message: string; position: string }): { full: string; followUp: string } {
	const fin = o.position ? "\n\n---\n\n" + o.position : "";
	const full = [o.context ? "CONTEXT (quiz and course material):\n" + o.context : "", o.course ? "=== COURSE ===\n" + o.course : "", "LEARNER'S NEW MESSAGE:\n" + o.message].filter(Boolean).join("\n\n---\n\n") + fin;
	return { full, followUp: o.message + fin };
}
