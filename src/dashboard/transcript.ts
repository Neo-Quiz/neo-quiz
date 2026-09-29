/* ══════════════════════════════════════════════════════════
   THE LIVE TRANSCRIPT OF A GENERATION (2026-09-29)

   What the CLI does while it writes a quiz, shown as it happens, as in
   MonoCode (github.com/hardbeat920/monocode, MIT): its reasoning, the
   answer being written, the tools it calls. This module is PURE — no host,
   no DOM: it turns the CLI's standard output, chunk by chunk, into events,
   and folds the events into the transcript a view paints.

   Two formats, one per CLI that can stream:
   - Claude Code, `--output-format stream-json --verbose
     --include-partial-messages`: one JSON object per line; the partial
     message chunks (`stream_event` / `content_block_delta`) carry the text
     (`text_delta`) and the reasoning (`thinking_delta`) as they are
     written; `content_block_start` names a tool; the last line is the
     `result`. The mapping follows MonoCode's `claudeProtocol.ts`
     (`streamDeltaFromEvent`, `toolStartFromEvent`).
   - Codex, `exec --json`: one event per line; an `item.completed` carries a
     whole `reasoning` or `agent_message`, a `command_execution` names what
     ran; `turn.completed` ends the turn.
   A line that is not JSON, or an event neither CLI documents, is ignored:
   the transcript is a window on the work, never a reason to fail it.
══════════════════════════════════════════════════════════ */

export type TranscriptTool = "claude" | "codex";

export type TranscriptEvent =
	| { kind: "start"; model?: string }
	| { kind: "thinking"; text: string }
	| { kind: "text"; text: string }
	| { kind: "tool"; name: string }
	| { kind: "done" };

/** What a view paints: the reasoning and the answer as written so far, the
    tools called, and whether the CLI has started and finished. */
export interface Transcript {
	started: boolean;
	model?: string;
	thinking: string;
	text: string;
	tools: string[];
	done: boolean;
}

/* A quiz answer runs to a few tens of thousands of characters; a runaway
   stream must not grow the window's memory without end. Past the cap, the
   START is dropped: the end is what is being written. */
const MAX_CHARS = 200_000;

export function transcriptVide(): Transcript {
	return { started: false, thinking: "", text: "", tools: [], done: false };
}

function borner(s: string): string {
	return s.length > MAX_CHARS ? s.slice(s.length - MAX_CHARS) : s;
}

/** Folds one event into the transcript (in place, and returned). */
export function appliquer(t: Transcript, ev: TranscriptEvent): Transcript {
	switch (ev.kind) {
		case "start":
			t.started = true;
			if (ev.model) t.model = ev.model;
			break;
		case "thinking":
			t.started = true;
			t.thinking = borner(t.thinking + ev.text);
			break;
		case "text":
			t.started = true;
			t.text = borner(t.text + ev.text);
			break;
		case "tool":
			t.started = true;
			t.tools.push(ev.name);
			break;
		case "done":
			t.done = true;
			break;
	}
	return t;
}

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | null {
	return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
}

function str(v: unknown): string | null {
	return typeof v === "string" ? v : null;
}

function claudeEvents(line: Rec): TranscriptEvent[] {
	const type = str(line.type);
	if (type === "system" && str(line.subtype) === "init") return [{ kind: "start", model: str(line.model) ?? undefined }];
	if (type === "result") return [{ kind: "done" }];
	if (type !== "stream_event") return [];
	const event = rec(line.event);
	if (!event) return [];
	const eventType = str(event.type);
	if (eventType === "content_block_delta") {
		const delta = rec(event.delta);
		const deltaType = delta ? str(delta.type) : null;
		if (deltaType === "text_delta") {
			const text = str(delta?.text);
			return text ? [{ kind: "text", text }] : [];
		}
		if (deltaType === "thinking_delta") {
			const text = str(delta?.thinking);
			return text ? [{ kind: "thinking", text }] : [];
		}
		return [];
	}
	if (eventType === "content_block_start") {
		const block = rec(event.content_block);
		const blockType = block ? str(block.type) : null;
		if (blockType === "tool_use" || blockType === "server_tool_use" || blockType === "mcp_tool_use") {
			return [{ kind: "tool", name: str(block?.name) ?? blockType }];
		}
	}
	return [];
}

function codexEvents(line: Rec): TranscriptEvent[] {
	const type = str(line.type);
	if (type === "thread.started") return [{ kind: "start" }];
	if (type === "turn.completed" || type === "turn.failed") return [{ kind: "done" }];
	if (type !== "item.completed") return [];
	const item = rec(line.item);
	if (!item) return [];
	const itemType = str(item.type);
	const text = str(item.text);
	if (itemType === "reasoning" && text) return [{ kind: "thinking", text: text + "\n\n" }];
	if (itemType === "agent_message" && text) return [{ kind: "text", text }];
	if (itemType === "command_execution") return [{ kind: "tool", name: str(item.command) ?? "command" }];
	return [];
}

/**
 * A decoder for one CLI run: give it the standard output as it arrives, in
 * chunks cut anywhere, and it returns the events of every line completed
 * so far. The unfinished tail waits for the next chunk.
 */
export function createTranscriptDecoder(tool: TranscriptTool): (chunk: string) => TranscriptEvent[] {
	let tail = "";
	const map = tool === "claude" ? claudeEvents : codexEvents;
	return (chunk: string): TranscriptEvent[] => {
		tail += chunk;
		const lines = tail.split("\n");
		tail = lines.pop() ?? "";
		const out: TranscriptEvent[] = [];
		for (const raw of lines) {
			const line = raw.trim();
			if (!line.startsWith("{")) continue;
			let parsed: unknown;
			try { parsed = JSON.parse(line); } catch { continue; }
			const r = rec(parsed);
			if (r) out.push(...map(r));
		}
		return out;
	};
}

/**
 * The final `result` object of a Claude Code `stream-json` output: the same
 * fields as `--output-format json` gave in one object (`result`, `is_error`,
 * `usage`, `total_cost_usd`, `session_id`). `null` when the stream has none —
 * the CLI stopped before answering.
 */
export function claudeResultDuFlux(stdout: string): Rec | null {
	const lines = String(stdout || "").split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i].trim();
		if (!line.startsWith("{")) continue;
		try {
			const r = rec(JSON.parse(line));
			if (r && str(r.type) === "result") return r;
		} catch { /* not JSON: skipped */ }
	}
	return null;
}
