/**
 * THE FULL AI WORK THREAD of a live session: what the window shows of a
 * Claude Code or Codex run, rebuilt from the CLI's own lines (pure, no DOM,
 * no host, no Node).
 *
 * What it prevents: a tool output kept whole in memory and in the DOM (a
 * 10 000-line listing keeps its line count and its first 8 lines only, and
 * the page fetches the rest on demand); a Bash command cut short, so the user
 * cannot see what ran; an Edit shown without its diff; a permission still
 * "pending" after it was answered; one odd line ending the whole thread; an
 * interrupted or truncated stored run that looks complete.
 *
 * The thread is built two ways that must agree: `applyLive` folds the events
 * of a running session, `threadFromRun` replays the stored raw lines of a
 * finished or interrupted run. Both call the same line reader.
 *
 * Model text, tool input and tool output are plain strings: the view renders
 * them with `textContent` only.
 */
import type { LiveEvent } from "../host/types";

/** Lines of a tool output kept in the model; the page fetches the rest. */
export const PREVIEW_LINES = 8;

export type ToolStatus = "running" | "ok" | "error" | "refused";
export type PermissionState = "pending" | "allowed" | "denied" | "gone";
/** One line of a reduced structured patch: `num` is the new-file line number
    for context and additions, the old-file one for a removal. */
export interface DiffLine { kind: "ctx" | "add" | "del"; text: string; num: number }
/** `lines` is present when the CLI carried a structured patch with real line
    numbers (at most DIFF_LINE_CAP lines); otherwise only the two arrays. */
export interface ToolDiff { added: string[]; removed: string[]; lines?: DiffLine[] }
export const DIFF_LINE_CAP = 2000;

/** `notice.text` is a stable KEY, not a sentence: "interrupted", "truncated"
    or "resumed". The view maps each to its translated string with `t()`. */
export type ThreadItem =
	| { kind: "user"; text: string }
	| { kind: "thinking"; text: string; tokens?: number; started?: number; ended?: number }
	| { kind: "text"; text: string }
	| { kind: "tool"; id: string; name: string; input: string; preview: string; lines: number; status: ToolStatus; diff: ToolDiff | null }
	| { kind: "permission"; requestId: string; tool: string; input: string; state: PermissionState }
	| { kind: "notice"; text: string };

export interface Thread { items: ThreadItem[]; running: boolean }

/** The shape `threadFromRun` reads: a `RunRead` from the store satisfies it. */
export interface RunInput {
	events: readonly { dir?: "in" | "out"; l?: unknown; meta?: unknown; end?: unknown; t?: unknown }[];
	interrupted: boolean;
	truncated: boolean;
}

type Rec = Record<string, unknown>;

export function emptyThread(): Thread {
	return { items: [], running: false };
}

/** Replays a stored run. Its turn is over, so `running` is false: a live
    session is followed with `applyLive` instead. An interrupted run leaves no
    permission pending and no tool running: nothing will answer them. */
export function threadFromRun(run: RunInput): Thread {
	const t = emptyThread();
	let spawns = 0;
	for (const e of run.events) {
		try {
			if (e.meta !== undefined) {
				// Only a second spawn is news: the first is the start of the run.
				if (isRec(e.meta) && isRec(e.meta.spawn) && ++spawns > 1) pushNotice(t, "resumed");
				continue;
			}
			if (e.dir === "in" || e.dir === "out") applyLine(t, e.dir, e.l, false, typeof e.t === "number" ? e.t : undefined);
		} catch {
			// One line the reader cannot take is skipped; the rest of the run is kept.
		}
	}
	if (run.truncated) pushNotice(t, "truncated");
	if (run.interrupted) {
		for (const i of t.items) {
			if (i.kind === "permission" && i.state === "pending") i.state = "gone";
			if (i.kind === "tool" && i.status === "running") i.status = "error";
		}
		pushNotice(t, "interrupted");
	}
	return t;
}

/** Folds one event of a live session into `t` (in place) and returns it. */
export function applyLive(t: Thread, e: LiveEvent): Thread {
	try {
		switch (e.kind) {
			case "line":
				// The approval requests also come as permission events: skipped here.
				applyLine(t, "out", e.line, true);
				break;
			case "permission":
				t.items.push({ kind: "permission", requestId: e.requestId, tool: e.tool, input: formatInput(e.tool, e.input), state: "pending" });
				break;
			case "permissionGone":
				for (const i of t.items) if (i.kind === "permission" && i.requestId === e.requestId && i.state === "pending") i.state = "gone";
				break;
			case "turnEnd":
			case "exit":
				t.running = false;
				break;
		}
	} catch {
		// A malformed event is skipped.
	}
	return t;
}

/** The window sent a message: it is the user's line, and a turn starts. */
export function addUserMessage(t: Thread, text: string): Thread {
	t.items.push({ kind: "user", text });
	t.running = true;
	return t;
}

/** The window answered a permission it was shown. Unknown ids change nothing. */
export function answerPermission(t: Thread, requestId: string, allowed: boolean): Thread {
	for (const i of t.items) if (i.kind === "permission" && i.requestId === requestId && i.state === "pending") i.state = allowed ? "allowed" : "denied";
	return t;
}

// --- Reading the CLI lines ----------------------------------------------------

/** `in` lines are the ones the app wrote: a user message, an answer. */
function applyLine(t: Thread, dir: "in" | "out", l: unknown, live: boolean, at?: number): void {
	if (!isRec(l)) return;
	if (dir === "in") return applyIn(t, l);
	if (typeof l.method === "string") return applyCodex(t, l, live);
	if (typeof l.type === "string") return applyClaude(t, l, live, at);
}

function applyIn(t: Thread, l: Rec): void {
	if (l.type === "user") {
		const text = contentText(isRec(l.message) ? l.message.content : undefined);
		if (text) t.items.push({ kind: "user", text });
		return;
	}
	if (l.type === "control_response") {
		const inner = isRec(l.response) && isRec(l.response.response) ? l.response.response : {};
		const id = str(isRec(l.response) ? l.response.request_id : undefined);
		if (id !== undefined) answerPermission(t, id, inner.behavior === "allow");
		return;
	}
	if (l.method === "turn/start") {
		const params = isRec(l.params) ? l.params : {};
		const text = arr(params.input).filter(isRec).filter((b) => b.type === "text").map((b) => str(b.text) ?? "").join("\n");
		if (text) t.items.push({ kind: "user", text });
		return;
	}
	// A JSON-RPC answer to a Codex approval: `{ id, result: { decision } }`.
	if ((typeof l.id === "number" || typeof l.id === "string") && "result" in l) {
		const decision = isRec(l.result) ? l.result.decision : undefined;
		answerPermission(t, codexKey(l.id), typeof decision === "string" ? decision.startsWith("accept") : isRec(decision));
	}
}

function applyClaude(t: Thread, l: Rec, live: boolean, at?: number): void {
	switch (l.type) {
		case "stream_event":
			streamEvent(t, l.event);
			return stampThinking(t, at);
		case "assistant":
			assistantMessage(t, l.message);
			return stampThinking(t, at);
		case "system":
			return thinkingTokens(t, l);
		case "user":
			return toolResults(t, l);
		case "control_request": {
			const rq = isRec(l.request) ? l.request : {};
			const id = str(l.request_id);
			if (live || rq.subtype !== "can_use_tool" || id === undefined) return;
			pushPermission(t, id, str(rq.tool_name) ?? "", rq.input);
			return;
		}
	}
}

/** The reasoning's size while its text stays private (`system` /
    `thinking_tokens`): kept on the last thinking item, never a new one. */
function thinkingTokens(t: Thread, l: Rec): void {
	const total = l.estimated_tokens;
	if (str(l.subtype) !== "thinking_tokens" || typeof total !== "number" || !Number.isFinite(total) || total <= 0) return;
	for (let i = t.items.length - 1; i >= 0; i--) {
		const item = t.items[i];
		if (item.kind === "thinking") {
			item.tokens = Math.round(total);
			return;
		}
	}
}

/** Stamps the last item with the event time while it is a thinking row: the
    first stamp is its start, the last one its end (the view shows the duration). */
function stampThinking(t: Thread, at: number | undefined): void {
	const last = lastItem(t);
	if (at === undefined || !last || last.kind !== "thinking") return;
	if (last.started === undefined) last.started = at;
	last.ended = at;
}

/** Partial deltas: a block opens a new item, its deltas fill it. */
function streamEvent(t: Thread, ev: unknown): void {
	if (!isRec(ev)) return;
	if (ev.type === "content_block_start" && isRec(ev.content_block)) {
		const block = ev.content_block;
		if (block.type === "text") t.items.push({ kind: "text", text: "" });
		else if (block.type === "thinking") t.items.push({ kind: "thinking", text: "" });
		else if (block.type === "tool_use") upsertTool(t, str(block.id) ?? "", str(block.name) ?? "", "");
		return;
	}
	if (ev.type === "content_block_delta" && isRec(ev.delta)) {
		const d = ev.delta;
		if (d.type === "text_delta") appendText(t, "text", str(d.text) ?? "");
		else if (d.type === "thinking_delta") appendText(t, "thinking", str(d.thinking) ?? "");
	}
}

/** The complete message: its blocks replace the streamed text of the same
    kind, or are added when nothing was streamed. A tool call sets its full input. */
function assistantMessage(t: Thread, msg: unknown): void {
	if (!isRec(msg)) return;
	for (const b of arr(msg.content).filter(isRec)) {
		if (b.type === "text" || b.type === "thinking") {
			const kind = b.type === "text" ? "text" : "thinking";
			const s = str(kind === "text" ? b.text : b.thinking) ?? "";
			if (s !== "") replaceOrPush(t, kind, s);
		} else if (b.type === "tool_use") {
			const id = str(b.id);
			if (id === undefined) continue;
			const name = str(b.name) ?? "";
			const tool = upsertTool(t, id, name, formatInput(name, b.input));
			tool.diff = editDiff(name, b.input);
		}
	}
}

function toolResults(t: Thread, l: Rec): void {
	const message = isRec(l.message) ? l.message : {};
	const patch = arr(isRec(l.tool_use_result) ? l.tool_use_result.structuredPatch : undefined);
	const declinedByPolicy = arr(l.tool_result_meta).some((m) => isRec(m) && isRec(m.permission_decision) && m.permission_decision.decision === "reject");
	for (const b of arr(message.content).filter(isRec)) {
		if (b.type !== "tool_result") continue;
		const tool = toolById(t, str(b.tool_use_id));
		if (!tool) continue;
		const text = contentText(b.content);
		tool.preview = preview(text);
		tool.lines = lineCount(text);
		tool.status = b.is_error === true ? (declinedByPolicy || /declined|rejected/i.test(text) ? "refused" : "error") : "ok";
		// The CLI's own patch replaces the input-derived diff: it has the real line numbers.
		if (patch.length > 0 && (tool.name === "Edit" || tool.name === "Write" || tool.name === "MultiEdit")) tool.diff = diffFromPatch(patch);
	}
}

function applyCodex(t: Thread, l: Rec, live: boolean): void {
	const params = isRec(l.params) ? l.params : {};
	switch (l.method) {
		case "item/started":
		case "item/completed":
			return codexItem(t, l.method === "item/completed", params.item);
		case "item/agentMessage/delta":
			return appendText(t, "text", str(params.delta) ?? "");
		case "item/commandExecution/requestApproval":
		case "item/fileChange/requestApproval":
		case "item/permissions/requestApproval": {
			if (live || (typeof l.id !== "number" && typeof l.id !== "string")) return;
			pushPermission(t, codexKey(l.id), APPROVAL_TOOL[String(l.method)] ?? "", params);
			return;
		}
	}
}

function codexItem(t: Thread, completed: boolean, item: unknown): void {
	if (!isRec(item)) return;
	const id = str(item.id) ?? "";
	switch (item.type) {
		case "agentMessage": {
			if (!completed) {
				t.items.push({ kind: "text", text: "" });
				return;
			}
			const s = str(item.text) ?? "";
			const last = lastItem(t);
			if (last?.kind === "text") {
				if (s !== "") last.text = s;
				else if (last.text === "") t.items.pop();
			} else if (s !== "") {
				t.items.push({ kind: "text", text: s });
			}
			return;
		}
		case "commandExecution": {
			// The raw command the user would type, not the shell wrapper around it.
			const first = arr(item.commandActions).find(isRec);
			const tool = upsertTool(t, id, "commandExecution", str(first?.command) ?? str(item.command) ?? "");
			if (!completed) return;
			const text = str(item.aggregatedOutput) ?? "";
			tool.preview = preview(text);
			tool.lines = lineCount(text);
			tool.status = codexStatus(item);
			return;
		}
		case "fileChange": {
			const changes = arr(item.changes).filter(isRec);
			const tool = upsertTool(t, id, "fileChange", changes.map((c) => str(c.path) ?? "").join("\n"));
			if (!completed) return;
			tool.diff = changes.reduce<ToolDiff>((d, c) => {
				const u = unifiedDiff(str(c.diff) ?? "");
				return { added: [...d.added, ...u.added], removed: [...d.removed, ...u.removed] };
			}, { added: [], removed: [] });
			tool.status = codexStatus(item);
			return;
		}
	}
}

// --- Helpers --------------------------------------------------------------------

/** A copy of `codexRequestKey` (`apps/windows/electron/live-session-rules.ts`):
    a numeric id and a string id must never collide. The two copies must match. */
const codexKey = (id: number | string): string => (typeof id === "number" ? String(id) : "s:" + id);

const APPROVAL_TOOL: Record<string, string> = {
	"item/commandExecution/requestApproval": "commandExecution",
	"item/fileChange/requestApproval": "fileChange",
	"item/permissions/requestApproval": "permissions",
};

function pushPermission(t: Thread, requestId: string, tool: string, input: unknown): void {
	t.items.push({ kind: "permission", requestId, tool, input: formatInput(tool, input), state: "pending" });
}

function pushNotice(t: Thread, text: string): void {
	t.items.push({ kind: "notice", text });
}

function upsertTool(t: Thread, id: string, name: string, input: string): Extract<ThreadItem, { kind: "tool" }> {
	const found = toolById(t, id);
	if (found) {
		if (input !== "") found.input = input;
		return found;
	}
	const tool: Extract<ThreadItem, { kind: "tool" }> = { kind: "tool", id, name, input, preview: "", lines: 0, status: "running", diff: null };
	t.items.push(tool);
	return tool;
}

function toolById(t: Thread, id: string | undefined): Extract<ThreadItem, { kind: "tool" }> | undefined {
	if (id === undefined) return undefined;
	for (const i of t.items) if (i.kind === "tool" && i.id === id) return i;
	return undefined;
}

function lastItem(t: Thread): ThreadItem | undefined {
	return t.items[t.items.length - 1];
}

function appendText(t: Thread, kind: "text" | "thinking", s: string): void {
	const last = lastItem(t);
	if (last && last.kind === kind) last.text += s;
	else t.items.push(kind === "text" ? { kind: "text", text: s } : { kind: "thinking", text: s });
}

function replaceOrPush(t: Thread, kind: "text" | "thinking", s: string): void {
	const last = lastItem(t);
	if (last && last.kind === kind) last.text = s;
	else t.items.push(kind === "text" ? { kind: "text", text: s } : { kind: "thinking", text: s });
}

/** A Bash or PowerShell call shows its raw command; anything else its JSON input. */
function formatInput(tool: string, input: unknown): string {
	if ((tool === "Bash" || tool === "PowerShell") && isRec(input) && typeof input.command === "string") return input.command;
	return JSON.stringify(input ?? {}, null, 2);
}

/** Reduces the CLI's `structuredPatch` hunks: `lines` keep the file's line
    numbers. Over DIFF_LINE_CAP lines, `lines` is left out and the view falls
    back to the two arrays. */
function diffFromPatch(hunks: unknown[]): ToolDiff {
	const d: ToolDiff = { added: [], removed: [] };
	const lines: DiffLine[] = [];
	for (const h of hunks.filter(isRec)) {
		let oldNo = typeof h.oldStart === "number" ? h.oldStart : 1;
		let newNo = typeof h.newStart === "number" ? h.newStart : 1;
		for (const raw of arr(h.lines)) {
			const line = str(raw) ?? "";
			const text = line.slice(1);
			if (line.startsWith("+")) {
				d.added.push(text);
				lines.push({ kind: "add", text, num: newNo++ });
			} else if (line.startsWith("-")) {
				d.removed.push(text);
				lines.push({ kind: "del", text, num: oldNo++ });
			} else {
				lines.push({ kind: "ctx", text: line.startsWith(" ") ? text : line, num: newNo });
				oldNo++;
				newNo++;
			}
		}
	}
	if (lines.length <= DIFF_LINE_CAP) d.lines = lines;
	return d;
}

function editDiff(name: string, input: unknown): ToolDiff | null {
	if (!isRec(input)) return null;
	if (name === "Edit") return { added: linesOf(input.new_string), removed: linesOf(input.old_string) };
	if (name === "Write") return { added: linesOf(input.content), removed: [] };
	if (name === "MultiEdit") {
		const d: ToolDiff = { added: [], removed: [] };
		for (const e of arr(input.edits).filter(isRec)) {
			d.added.push(...linesOf(e.new_string));
			d.removed.push(...linesOf(e.old_string));
		}
		return d;
	}
	return null;
}

/** A unified diff: `+` and `-` lines, the `+++` / `---` file headers aside. */
function unifiedDiff(text: string): ToolDiff {
	const d: ToolDiff = { added: [], removed: [] };
	for (const line of text.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) d.added.push(line.slice(1));
		else if (line.startsWith("-") && !line.startsWith("---")) d.removed.push(line.slice(1));
	}
	return d;
}

function codexStatus(item: Rec): ToolStatus {
	if (item.status === "declined") return "refused";
	if (item.status === "failed" || (typeof item.exitCode === "number" && item.exitCode !== 0)) return "error";
	if (item.status === "inProgress") return "running";
	return "ok";
}

/** The text of a message content: a plain string, or its text blocks. */
function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	return arr(content).filter(isRec).filter((b) => b.type === "text").map((b) => str(b.text) ?? "").join("\n");
}

function preview(text: string): string {
	return text.split("\n").slice(0, PREVIEW_LINES).join("\n");
}

function lineCount(text: string): number {
	return text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
}

function linesOf(s: unknown): string[] {
	return typeof s === "string" && s !== "" ? s.split("\n") : [];
}

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
