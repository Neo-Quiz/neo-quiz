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
	/** The size of what the model was given to read (the request and its
	    documents), in tokens, from the first message's usage. */
	| { kind: "input"; tokens: number }
	| { kind: "text"; text: string }
	/** A tool call: begun (`content_block_start`, name only), then its
	    input known (the whole `assistant` message). Same `id`: one step. */
	| { kind: "tool"; name: string; id?: string; input?: string }
	/** What a tool call gave back (`tool_result`), summed up: never the
	    content itself, only its size, or the first line of an error. */
	| { kind: "toolResult"; id: string; status: Exclude<ToolStatus, "running">; count?: number; unit?: ToolUnit; detail?: string }
	| { kind: "done" };

/** Where a tool call stands. `refused`: the CLI denied it (permission rule,
    outside the folder, a tool it does not have); `error`: it ran and failed. */
export type ToolStatus = "running" | "ok" | "error" | "refused";
/** What the size of a result counts. */
export type ToolUnit = "lines" | "files" | "image";

/** One step of the AI's work, as a terminal shows it: `Read(cours/ch1.md)`
    then `└ 120 lines`. */
export interface ToolStep {
	id: string;
	name: string;
	/** The key input, short: the path read, the pattern searched. */
	input: string;
	status: ToolStatus;
	count?: number;
	unit?: ToolUnit;
	/** The first line of an error or a refusal. */
	detail?: string;
}

/** What a view paints: the reasoning and the answer as written so far, the
    tools called, and whether the CLI has started and finished. */
export interface Transcript {
	started: boolean;
	model?: string;
	thinking: string;
	/** Estimated tokens of reasoning so far (0 when the CLI sends none). */
	thinkingTokens: number;
	/** Tokens the model was given to read (0 until the CLI says). */
	inputTokens: number;
	/** When the first character of the answer arrived (`Date.now()`), to
	    estimate the time left from the questions already written. */
	writingSince?: number;
	text: string;
	/** Every tool call, in order (at most `MAX_STEPS`). */
	tools: ToolStep[];
	/** Tool calls past `MAX_STEPS`, counted but not kept. */
	toolsHidden: number;
	done: boolean;
}

/* A quiz answer runs to a few tens of thousands of characters; a runaway
   stream must not grow the window's memory without end. Past the cap, the
   START is dropped: the end is what is being written. */
const MAX_CHARS = 200_000;
/** The steps kept, and the length of what each says (the stream is not trusted). */
export const MAX_STEPS = 300;
const MAX_INPUT = 240;
const MAX_DETAIL = 200;

export function transcriptVide(): Transcript {
	return { started: false, thinking: "", thinkingTokens: 0, inputTokens: 0, text: "", tools: [], toolsHidden: 0, done: false };
}

function couper(s: string, max: number): string {
	return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function borner(s: string): string {
	return s.length > MAX_CHARS ? s.slice(s.length - MAX_CHARS) : s;
}

/** Folds one event into the transcript (in place, and returned). `now`: the
    time of the event, for `writingSince`. */
export function appliquer(t: Transcript, ev: TranscriptEvent, now: number = Date.now()): Transcript {
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
		case "input":
			t.started = true;
			if (ev.tokens > t.inputTokens) t.inputTokens = ev.tokens;
			break;
		case "text":
			t.started = true;
			if (t.writingSince === undefined && ev.text) t.writingSince = now;
			t.text = borner(t.text + ev.text);
			break;
		case "tool": {
			t.started = true;
			const deja = ev.id ? t.tools.find(s => s.id === ev.id) : undefined;
			if (deja) {
				if (ev.name) deja.name = couper(ev.name, 80);
				if (ev.input) deja.input = couper(ev.input, MAX_INPUT);
			} else if (t.tools.length < MAX_STEPS) {
				t.tools.push({ id: ev.id ?? "", name: couper(ev.name, 80), input: couper(ev.input ?? "", MAX_INPUT), status: "running" });
			} else {
				t.toolsHidden++;
			}
			break;
		}
		case "toolResult": {
			const s = t.tools.find(x => x.id === ev.id);
			if (!s) break;
			// A refusal is never turned back into a plain error by a later event.
			if (s.status === "refused" && ev.status !== "refused") break;
			s.status = ev.status;
			if (ev.count !== undefined) s.count = ev.count;
			if (ev.unit !== undefined) s.unit = ev.unit;
			if (ev.detail !== undefined) s.detail = couper(ev.detail, MAX_DETAIL);
			break;
		}
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

/** What the decoder of one run remembers between lines: the CLI's working
    folder (to show paths relative to it) and the name of each tool call
    (to say what its result counts). Bounded: the stream is not trusted. */
interface EtatDecodeur {
	cwd: string;
	noms: Map<string, string>;
}

const sansSeparateurs = (p: string): string => p.replace(/\\/g, "/");

/** `chemin` relative to the CLI's folder when it lies inside it, else as is. */
function relatif(chemin: string, cwd: string): string {
	const p = sansSeparateurs(chemin);
	const base = sansSeparateurs(cwd).replace(/\/+$/, "");
	if (base && p.toLowerCase().startsWith(base.toLowerCase() + "/")) return p.slice(base.length + 1);
	if (base && p.toLowerCase() === base.toLowerCase()) return ".";
	return p;
}

/** The key input of a tool call, short: what a terminal shows in `Read(…)`. */
export function resumeEntree(name: string, input: unknown, cwd = ""): string {
	const e = rec(input);
	if (!e) return "";
	const s = (k: string): string | null => str(e[k]);
	const chemin = (k: string): string | null => { const v = s(k); return v ? relatif(v, cwd) : null; };
	let out: string;
	switch (name) {
		case "Read": case "Write": case "Edit": case "MultiEdit": case "NotebookEdit":
			out = chemin("file_path") ?? chemin("notebook_path") ?? "";
			break;
		case "Glob": case "Grep": {
			const motif = s("pattern") ?? "";
			const ou = chemin("path");
			const filtre = s("glob");
			out = [motif, filtre ? "glob: " + filtre : "", ou && ou !== "." ? "in " + ou : ""].filter(Boolean).join(", ");
			break;
		}
		case "Bash": case "PowerShell":
			out = s("command") ?? "";
			break;
		case "WebFetch":
			out = s("url") ?? "";
			break;
		case "WebSearch":
			out = s("query") ?? "";
			break;
		default: {
			const premier = Object.values(e).find(v => typeof v === "string");
			out = typeof premier === "string" ? premier : "";
		}
	}
	return couper(out.replace(/\s+/g, " ").trim(), MAX_INPUT);
}

/** The text of a `tool_result`'s content (a string, or text blocks), and
    whether it holds a picture. */
function contenuResultat(content: unknown): { texte: string; image: boolean } {
	if (typeof content === "string") return { texte: content, image: false };
	if (!Array.isArray(content)) return { texte: "", image: false };
	let texte = "";
	let image = false;
	for (const c of content) {
		const r = rec(c);
		if (!r) continue;
		if (str(r.type) === "image") image = true;
		const t = str(r.text);
		if (t && texte.length < 1_000_000) texte += (texte ? "\n" : "") + t;
	}
	return { texte, image };
}

/** A refusal the CLI words in the result itself (measured on Claude Code
    2.1.296): a permission denied, a path outside the working folders, a
    tool the session does not have. */
const REFUS = /permission to use .* (has been )?denied|denied because|is outside .*(working|confines)|--restricted confines|no such tool available|is disabled for this session|not allowed/i;

/** The summary of one `tool_result`. `refuseParMeta`: the CLI's own
    permission decision said "reject". */
export function resumeResultat(name: string, content: unknown, isError: boolean, refuseParMeta = false): { status: Exclude<ToolStatus, "running">; count?: number; unit?: ToolUnit; detail?: string } {
	const { texte, image } = contenuResultat(content);
	const premiereLigne = texte.replace(/<\/?tool_use_error>/g, "").trim().split("\n")[0] ?? "";
	// Only the head of the text: a refusal is worded at the start, and a regex with `.*` on a megabyte of output is slow.
	if (refuseParMeta || (isError && REFUS.test(texte.slice(0, 4000)))) return { status: "refused", detail: couper(premiereLigne, MAX_DETAIL) };
	if (isError) return { status: "error", detail: couper(premiereLigne, MAX_DETAIL) };
	if (image) return { status: "ok", unit: "image" };
	const lignes = texte.replace(/\s+$/, "").split("\n").filter(l => l.trim() !== "");
	if (name === "Glob" || name === "Grep") {
		const trouve = /^Found (\d+) files?/i.exec(lignes[0] ?? "");
		if (trouve) return { status: "ok", count: Number(trouve[1]), unit: "files" };
		if (/^No (files|matches) found/i.test(lignes[0] ?? "")) return { status: "ok", count: 0, unit: name === "Glob" ? "files" : "lines" };
		return { status: "ok", count: lignes.length, unit: name === "Glob" ? "files" : "lines" };
	}
	/* Read numbers its lines ("3\t"), the empty line after a final newline
	   included: a 2-line file came back as 3 numbered lines (measured). */
	if (name === "Read") while (lignes.length && /^\s*\d+([\t→]\s*)?$/.test(lignes[lignes.length - 1])) lignes.pop();
	return { status: "ok", count: lignes.length, unit: "lines" };
}

function retenirNom(etat: EtatDecodeur, id: string, nom: string): void {
	if (etat.noms.size >= 2000) return;
	etat.noms.set(id, nom);
}

function claudeEvents(line: Rec, etat: EtatDecodeur): TranscriptEvent[] {
	const type = str(line.type);
	if (type === "system" && str(line.subtype) === "init") {
		etat.cwd = str(line.cwd) ?? "";
		return [{ kind: "start", model: str(line.model) ?? undefined }];
	}
	if (type === "result") {
		/* The final list of what the CLI denied: a refusal it did not word
		   in the result (or a result line lost) still shows as refused. */
		const refus: TranscriptEvent[] = [];
		if (Array.isArray(line.permission_denials)) {
			for (const d of line.permission_denials.slice(0, MAX_STEPS)) {
				const id = str(rec(d)?.tool_use_id);
				if (id) refus.push({ kind: "toolResult", id, status: "refused" });
			}
		}
		return [...refus, { kind: "done" }];
	}
	/* The WHOLE message of each block (`--verbose`): a tool call's input is
	   complete only here. Its text is NOT taken: the partial chunks below
	   already carried it, and taking it twice would double the answer. */
	if (type === "assistant") {
		const contenu = rec(line.message)?.content;
		if (!Array.isArray(contenu)) return [];
		const out: TranscriptEvent[] = [];
		for (const c of contenu.slice(0, 50)) {
			const b = rec(c);
			if (!b || (str(b.type) !== "tool_use" && str(b.type) !== "server_tool_use")) continue;
			const id = str(b.id) ?? "";
			const name = str(b.name) ?? "tool";
			if (id) retenirNom(etat, id, name);
			out.push({ kind: "tool", name, id: id || undefined, input: resumeEntree(name, b.input, etat.cwd) });
		}
		return out;
	}
	if (type === "user") {
		const contenu = rec(line.message)?.content;
		if (!Array.isArray(contenu)) return [];
		const rejetes = new Set<string>();
		if (Array.isArray(line.tool_result_meta)) {
			for (const m of line.tool_result_meta.slice(0, 50)) {
				const r = rec(m);
				const id = str(r?.id);
				if (id && str(rec(r?.permission_decision)?.decision) === "reject") rejetes.add(id);
			}
		}
		const out: TranscriptEvent[] = [];
		for (const c of contenu.slice(0, 50)) {
			const b = rec(c);
			if (!b || str(b.type) !== "tool_result") continue;
			const id = str(b.tool_use_id);
			if (!id) continue;
			out.push({ kind: "toolResult", id, ...resumeResultat(etat.noms.get(id) ?? "", b.content, b.is_error === true, rejetes.has(id)) });
		}
		return out;
	}
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
	if (eventType === "message_start") {
		// What the model read: fresh input, plus what the prompt cache served or stored.
		const usage = rec(rec(event.message)?.usage);
		if (!usage) return [];
		const n = (k: string): number => { const v = usage[k]; return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0; };
		const tokens = n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
		return tokens > 0 ? [{ kind: "input", tokens: Math.round(tokens) }] : [];
	}
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
			const id = str(block?.id) ?? "";
			const name = str(block?.name) ?? blockType;
			if (id) retenirNom(etat, id, name);
			return [{ kind: "tool", name, id: id || undefined }];
		}
	}
	return [];
}

function codexEvents(line: Rec): TranscriptEvent[] {
	const type = str(line.type);
	if (type === "thread.started") return [{ kind: "start" }];
	if (type === "turn.completed" || type === "turn.failed") return [{ kind: "done" }];
	if (type !== "item.completed" && type !== "item.started") return [];
	const item = rec(line.item);
	if (!item) return [];
	const itemType = str(item.type);
	if (itemType === "command_execution") {
		/* A command Codex ran in its read-only sandbox: one step, begun at
		   `item.started`, closed at `item.completed` with its exit code. */
		const id = str(item.id) ?? "";
		const tool: TranscriptEvent = { kind: "tool", name: "Shell", id: id || undefined, input: couper((str(item.command) ?? "").replace(/\s+/g, " ").trim(), MAX_INPUT) };
		// Without an id, the start and the end cannot be told apart: one step, at the end.
		if (!id) return type === "item.completed" ? [tool] : [];
		if (type === "item.started") return [tool];
		const code = item.exit_code;
		const sortie = str(item.aggregated_output) ?? "";
		const lignes = sortie.replace(/\s+$/, "").split("\n").filter(l => l.trim() !== "").length;
		const fin: TranscriptEvent = typeof code === "number" && code !== 0
			? { kind: "toolResult", id, status: "error", detail: couper(sortie.trim().split("\n")[0] ?? "", MAX_DETAIL) }
			: { kind: "toolResult", id, status: "ok", count: lignes, unit: "lines" };
		return [tool, fin];
	}
	if (type !== "item.completed") return [];
	const text = str(item.text);
	if (itemType === "reasoning" && text) return [{ kind: "thinking", text: text + "\n\n" }];
	if (itemType === "agent_message" && text) return [{ kind: "text", text }];
	return [];
}

/**
 * A decoder for one CLI run: give it the standard output as it arrives, in
 * chunks cut anywhere, and it returns the events of every line completed
 * so far. The unfinished tail waits for the next chunk.
 */
export function createTranscriptDecoder(tool: TranscriptTool): (chunk: string) => TranscriptEvent[] {
	let tail = "";
	const etat: EtatDecodeur = { cwd: "", noms: new Map() };
	const map = tool === "claude" ? (l: Rec) => claudeEvents(l, etat) : codexEvents;
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

/**
 * The time left to write a quiz of `total` questions, in ms, from the pace of
 * the questions already FINISHED (the one being written, `question`, is not):
 * `null` until two are done, or without a known total. Never negative.
 */
export function tempsRestant(question: number, total: number | null | undefined, writingSince: number | undefined, now: number): number | null {
	if (writingSince === undefined || !total || question < 3 || question > total) return null;
	const faites = question - 1;
	const parQuestion = Math.max(0, now - writingSince) / faites;
	return Math.round(parQuestion * (total - faites));
}