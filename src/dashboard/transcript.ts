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
	/** How many tokens the model has reasoned so far, an ESTIMATE the CLI
	    sends while it keeps the reasoning itself to itself (Claude Code with
	    Opus 5.5 streams `thinking_delta`s whose text is empty, measured on
	    2026-10-08). The total so far, not a delta. */
	| { kind: "thinkingTokens"; total: number }
	| { kind: "text"; text: string }
	| { kind: "tool"; name: string }
	| { kind: "done" };

/** What a view paints: the reasoning and the answer as written so far, the
    tools called, and whether the CLI has started and finished. */
export interface Transcript {
	started: boolean;
	model?: string;
	thinking: string;
	/** Estimated tokens of reasoning so far (0 when the CLI sends none). */
	thinkingTokens: number;
	text: string;
	tools: string[];
	done: boolean;
}

/* A quiz answer runs to a few tens of thousands of characters; a runaway
   stream must not grow the window's memory without end. Past the cap, the
   START is dropped: the end is what is being written. */
const MAX_CHARS = 200_000;

export function transcriptVide(): Transcript {
	return { started: false, thinking: "", thinkingTokens: 0, text: "", tools: [], done: false };
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
		case "thinkingTokens":
			t.started = true;
			// Never backwards: two runs of an answer (a retry) restart the CLI's count.
			if (ev.total > t.thinkingTokens) t.thinkingTokens = ev.total;
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
	/* The reasoning's SIZE while its text stays private: `system` /
	   `thinking_tokens` carries the running estimate (`estimated_tokens`). */
	if (type === "system" && str(line.subtype) === "thinking_tokens") {
		const total = line.estimated_tokens;
		return typeof total === "number" && Number.isFinite(total) && total > 0 ? [{ kind: "thinkingTokens", total: Math.round(total) }] : [];
	}
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

/* ── PROGRESS OF A QUIZ BEING WRITTEN (2026-10-02) ──
   Which question the model is at, read off the streamed JSON5 itself, which is
   almost always CUT mid-object. A single scan keeps just enough state — the
   string/comment state and a stack of open objects — to tell a KEY from a value:
   a `prompt` word inside a string value ("explain": "the prompt: …") is never a
   key, so it never counts. */

export interface QuizProgress {
	/** One-pass multi-document answer only: the quiz being written (1-based), else null. */
	quiz: number | null;
	/** Questions begun so far in that quiz (the current one included). */
	question: number;
}

interface ScanFrame { object: boolean; counted: boolean; reading: boolean }

/**
 * Counts the question objects begun in `text`: those with a `prompt` key at key
 * position, quoted or not. A Learn reading card (`role: "read"`, before or
 * after its `prompt`) is not a question, and the closing configuration object
 * has no `prompt`. With `batch` (one pass over several documents, the answer is
 * an array of `{ document, title, quiz: [...] }`), each `document` key starts the
 * next quiz and resets the question count.
 */
export function quizProgress(text: string, opts: { batch?: boolean } = {}): QuizProgress {
	const n = text.length;
	let i = 0;
	// Prose before the JSON (an apostrophe in it would open a "string") is skipped.
	while (i < n && text[i] !== "[" && text[i] !== "{") i++;
	const stack: ScanFrame[] = [];
	let expectKey = false;
	let questions = 0;
	let docs = 0;
	while (i < n) {
		const c = text[i];
		if (c === "/" && text[i + 1] === "/") {
			const end = text.indexOf("\n", i);
			if (end < 0) break;
			i = end + 1;
			continue;
		}
		if (c === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			if (end < 0) break;
			i = end + 2;
			continue;
		}
		let key: string | null = null;
		if (c === '"' || c === "'" || c === "`") {
			let j = i + 1;
			while (j < n && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
			// Unterminated: the string is still being written, nothing after it exists yet.
			if (j >= n) break;
			if (expectKey && c !== "`") key = text.slice(i + 1, j);
			i = j + 1;
		} else if (expectKey && /[A-Za-z_$]/.test(c)) {
			let j = i + 1;
			while (j < n && /[\w$]/.test(text[j])) j++;
			key = text.slice(i, j);
			i = j;
		} else {
			if (c === "{") { stack.push({ object: true, counted: false, reading: false }); expectKey = true; }
			else if (c === "[") { stack.push({ object: false, counted: false, reading: false }); expectKey = false; }
			else if (c === "}" || c === "]") { stack.pop(); expectKey = false; }
			else if (c === "," && stack.length && stack[stack.length - 1].object) expectKey = true;
			i++;
			continue;
		}
		if (key === null) continue;
		expectKey = false;
		const frame = stack[stack.length - 1];
		const colon = /^\s*:/.exec(text.slice(i, i + 40));
		if (!frame || !colon) continue;
		if (key === "prompt" && !frame.counted && !frame.reading) { frame.counted = true; questions++; }
		else if (key === "role" && /^\s*:\s*(["'])read\1/.test(text.slice(i, i + 40))) {
			frame.reading = true;
			if (frame.counted) { frame.counted = false; questions--; }
		} else if (key === "document" && opts.batch) { docs++; questions = 0; }
	}
	return { quiz: opts.batch && docs > 0 ? docs : null, question: Math.max(0, questions) };
}
