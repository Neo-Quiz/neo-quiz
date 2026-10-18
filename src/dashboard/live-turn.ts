/**
 * ONE TURN of a live Claude Code / Codex session, as the Generate page reads
 * it (pure, no DOM, no host).
 *
 * What it prevents: a live generation that never ends, or ends with the
 * wrong text, because the page read the end of a turn differently from the
 * one-shot call it replaces. The one-shot call read the `result` line of
 * Claude Code (`claudeResultDuFlux`) and the last agent message of Codex
 * (`extractCodexText`); a live turn reads the same things from its lines.
 *
 * Also: the summary line of the AI's work ("Explored the project · Ran 6
 * tools") is computed from the full thread with the transcript's own rules,
 * so a live run and a one-shot run are summed up alike.
 */
import type { Thread } from "./live-thread";
import { claudeResultChained, foldClaudeChain, newClaudeChain, resumeEntree, transcriptVide } from "./transcript";
import type { ClaudeChain } from "./transcript";
import type { ToolStep, Transcript } from "./transcript";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** What a turn brought back so far. `ended`: its last line arrived (Claude
    `result`, Codex `turn/completed` or `turn/aborted`). */
export interface TurnOutcome {
	ended: boolean;
	/** The Claude `result` line, whole (usage, cost, `is_error`). */
	claudeResult: Rec | null;
	/** The last completed Codex agent message. */
	codexText: string;
	/** A Codex error said in the turn (`error` notification, failed turn). */
	codexError: string | null;
	/** The messages of a Claude answer cut by the output limit (`foldClaudeChain`). */
	chain: ClaudeChain;
}

export function emptyOutcome(): TurnOutcome {
	return { ended: false, claudeResult: null, codexText: "", codexError: null, chain: newClaudeChain() };
}

/** Folds one CLI line (received) into the outcome of its turn. */
export function collectLine(o: TurnOutcome, line: unknown): TurnOutcome {
	if (!isRec(line)) return o;
	/* A message written during the turn and taken AFTER its `result`
	   (`--replay-user-messages` echoes it then): the turn goes on, and its
	   end is the next `result`, never this one. */
	if (isEcho(line)) {
		o.ended = false;
		return o;
	}
	if (line.type === "result") {
		o.claudeResult = claudeResultChained(o.chain, line);
		o.ended = true;
		return o;
	}
	foldClaudeChain(o.chain, line);
	const params = isRec(line.params) ? line.params : {};
	switch (line.method) {
		case "item/completed": {
			const item = isRec(params.item) ? params.item : {};
			const text = str(item.text);
			if (item.type === "agentMessage" && text) o.codexText = text;
			break;
		}
		case "error": {
			const e = isRec(params.error) ? params.error : {};
			if (params.willRetry !== true && str(e.message)) o.codexError = str(e.message) as string;
			break;
		}
		case "turn/completed":
		case "turn/aborted": {
			const turn = isRec(params.turn) ? params.turn : {};
			const e = isRec(turn.error) ? turn.error : {};
			if (turn.status === "failed") o.codexError = str(e.message) ?? o.codexError ?? "failed";
			o.ended = true;
			break;
		}
	}
	return o;
}

/** A user message Claude Code echoes when it takes it (`isReplay`); a tool
    result is a `user` line too, without the flag. */
export function isEcho(l: unknown): boolean {
	return isRec(l) && l.type === "user" && l.isReplay === true;
}

/** The line the app wrote to open a turn (the prompt): Claude `user`, Codex
    `turn/start`. Never shown in the thread: the request's bubble is above. */
export function isPromptLine(l: unknown): boolean {
	return isRec(l) && (l.type === "user" || l.method === "turn/start");
}

/** The summary of a thread in the transcript's shape: its reasoning, its
    text and every tool call (status only; the full view has the rest). */
export function transcriptOfThread(t: Thread): Transcript {
	const tr = transcriptVide();
	for (const i of t.items) {
		if (i.kind === "thinking") tr.thinking += i.text;
		else if (i.kind === "text") tr.text += (tr.text && !tr.text.endsWith("\n") ? "\n" : "") + i.text;
		else if (i.kind === "tool") {
			const step: ToolStep = { id: i.id, name: i.name, input: summaryInput(i.name, i.input), status: i.status };
			tr.tools.push(step);
		}
	}
	tr.started = t.items.length > 0 || t.running;
	tr.done = !t.running;
	// What the safeguards did, read from the thread (the flag, the cut answer).
	if (t.effectiveModel) tr.effectiveModel = t.effectiveModel;
	if (t.refusals) tr.refusals = t.refusals;
	if (t.refusalCategory) tr.refusalCategory = t.refusalCategory;
	if (t.refusalExplanation) tr.refusalExplanation = t.refusalExplanation;
	return tr;
}

/** The key input of a tool call, short, as the transcript names it: the
    path of a Read or an Edit, the files of a Codex change, a command's line. */
function summaryInput(name: string, input: string): string {
	let short = "";
	if (input.startsWith("{")) {
		try { short = resumeEntree(name, JSON.parse(input)); } catch { short = ""; }
	}
	if (!short) short = name === "fileChange" ? input.split("\n").filter(Boolean).join(", ") : input.split("\n").find(x => x.trim() !== "") ?? "";
	return short.length > 240 ? short.slice(0, 239) + "…" : short;
}
