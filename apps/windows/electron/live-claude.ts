/* ══════════════════════════════════════════════════════════
   A LIVE CLAUDE CODE SESSION: ITS LAUNCH AND ITS STDIN LINES (2026-10-11).

   Claude Code runs as a long-lived process: stream-json in and out, and every
   permission the model asks for comes to the app as a `control_request`
   (`--permission-prompt-tool stdio`), answered by a `control_response` the
   app writes. Shapes copied from MonoCode's Claude provider, then measured.

   The main process builds EVERY stdin line here, from typed values: the
   window never sends a raw line, a path or an argument (spec
   2026-10-11-live-cli-sessions-design, sections 4.1 and 8).

   The launch loads every settings source, as a terminal opened in the Neo
   Quiz root would (2026-10-17, the owner's decision: "exactly as if launched
   in Warp"); the synced root never carries `.claude/` from another device
   (`syncthing-regles.ts`). `gabarits-cli.ts` (`argumentsLiveClaude`) accepts
   exactly these forms and nothing else.

   PURE (no Node, no Electron): `npm run check:live-protocol` tests it.

   Measured on Claude Code 2.1.296 (2026-10-11), supervised form, model
   `claude-haiku-5-5`, in a throwaway folder; the lines, private data
   replaced, are in `scripts/fixtures/live/claude-session.jsonl`:
   - `--permission-mode default` is accepted; the init line says
     `"permissionMode":"default"`. A `--session-id` is echoed as the
     `session_id` of every line.
   - in  {"type":"control_request","request_id":"nq_1","request":{"subtype":"initialize"}}
     out {"type":"control_response","response":{"subtype":"success",
         "request_id":"nq_1","response":{commands, agents, models, account,
         claude_code_version, current_permission_mode, …}}}
     The user's SessionStart hooks run BEFORE this answer
     (`system`/`hook_started`, `hook_response`): `--setting-sources user`
     loads them, as a terminal would.
   - in  the user line below; out `system`/`init`, `system`/`status`,
     `system`/`thinking_tokens`, `stream_event` (message_start,
     content_block_start/delta/stop with `thinking_delta`, `signature_delta`,
     `input_json_delta`, `text_delta`), `assistant`, `rate_limit_event`.
   - out {"type":"control_request","request_id":"<uuid>","request":{
         "subtype":"can_use_tool","tool_name":"Bash","display_name":"Bash",
         "input":{"command":…,"description":…},"description":…,
         "permission_suggestions":[…],"blocked_path":…,"tool_use_id":"toolu_…"}}
     The request id is the CLI's own UUID, not one of ours.
   - in  {"type":"control_response","response":{"subtype":"success",
         "request_id":"<uuid>","response":{"behavior":"deny",
         "message":"User declined tool execution."}}}
     out {"type":"user","message":{"content":[{"type":"tool_result",
         "content":"User declined tool execution.","is_error":true,…}]}}
     then the model's answer and {"type":"result","subtype":"success",…}.
   - A read-only command (`echo hi`) is NOT asked: the CLI approves it
     itself (`permission_decision` `source:"config"`, `reason_type:
     "subcommandResults"`); `echo hi > probe.txt` is. Allow rules of the
     user's settings apply the same way.
   - No `control_cancel_request` was seen; its shape is MonoCode's.
   - `--replay-user-messages` (2.1.296, measured 2026-10-11): each user line
     comes back as {"type":"user",…,"isReplay":true} when the CLI TAKES it.
     A message written mid-turn was taken inside that turn once (echoed
     before its single `result`) and after it another time (echoed after
     the first `result`, then its own turn and `result`); after an
     interrupt (`result` `error_during_execution`, `still_queued: []`), a
     message still queued was taken and answered. The drivers read the
     session's busy state from these echoes (`live-drivers.ts`).
══════════════════════════════════════════════════════════ */

import type { ModeAgent } from "../../../src/host/claude-outils";

/** A session id: a lowercase UUID, as `crypto.randomUUID()` gives. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A model name: never starts with a dash (it would be an option). */
const MODEL = /^[a-z0-9][a-z0-9.\-]{0,63}$/;
/** A level of `claude --effort`, exactly the ones its help lists. */
const EFFORT = /^(low|medium|high|xhigh|max)$/;
/** Inline settings: sessions are kept ten years, so a thread can always be
    resumed (the CLI's default deletes them after 30 days). */
export const LIVE_SETTINGS = "{\"cleanupPeriodDays\":3650}";

const PERMISSION_MODE: Record<ModeAgent, readonly string[]> = {
	supervised: ["--permission-mode", "default"],
	acceptEdits: ["--permission-mode", "acceptEdits"],
	auto: ["--permission-mode", "auto"],
	full: ["--permission-mode", "bypassPermissions", "--allow-dangerously-skip-permissions"],
};

/** The launch arguments of a live session. Throws on a model, effort or
    session id that does not have its exact shape. */
export function liveClaudeArgs(o: { model: string; effort?: string; mode: ModeAgent; sessionId: string; resume: boolean }): string[] {
	if (!MODEL.test(o.model)) throw new Error("Invalid model");
	if (o.effort !== undefined && !EFFORT.test(o.effort)) throw new Error("Invalid effort");
	if (!UUID.test(o.sessionId)) throw new Error("Invalid session id");
	if (!Object.prototype.hasOwnProperty.call(PERMISSION_MODE, o.mode)) throw new Error("Invalid mode");
	return [
		"-p", "--output-format", "stream-json", "--verbose", "--input-format", "stream-json",
		"--permission-prompt-tool", "stdio", "--include-partial-messages", "--replay-user-messages",
		"--settings", LIVE_SETTINGS,
		"--model", o.model, ...(o.effort ? ["--effort", o.effort] : []),
		...PERMISSION_MODE[o.mode],
		...(o.resume ? ["--resume", o.sessionId] : ["--session-id", o.sessionId]),
	];
}

/** One stdin line. `JSON.stringify` escapes every newline of the values, so
    a line is always exactly one line. */
const line = (v: unknown): string => JSON.stringify(v) + "\n";

export type ClaudeImage = { mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; base64: string };

/** A user turn: the text, then the attached pictures. */
export function claudeUserLine(text: string, images: readonly ClaudeImage[]): string {
	const content: unknown[] = [{ type: "text", text }];
	for (const im of images) content.push({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.base64 } });
	return line({ type: "user", session_id: "", parent_tool_use_id: null, message: { role: "user", content } });
}

/** A request from the app to the CLI. */
export function claudeControlLine(requestId: string, subtype: "initialize" | "interrupt"): string {
	return line({ type: "control_request", request_id: requestId, request: { subtype } });
}

/** The answer to a `can_use_tool` request. */
export function claudePermissionLine(requestId: string, d: { allow: true; updatedInput: Record<string, unknown> } | { allow: false; message: string }): string {
	const response = d.allow ? { behavior: "allow", updatedInput: d.updatedInput } : { behavior: "deny", message: d.message };
	return line({ type: "control_response", response: { subtype: "success", request_id: requestId, response } });
}

/** The answer to a request the app does not handle: an empty success, so the
    CLI never waits on it. */
export function claudeEmptyControlResponse(requestId: string): string {
	return line({ type: "control_response", response: { subtype: "success", request_id: requestId, response: {} } });
}

type Rec = Record<string, unknown>;

export type ClaudeControl =
	| { kind: "canUseTool"; requestId: string; toolName: string; input: Rec; toolUseId: string | null }
	| { kind: "cancel"; requestId: string }
	| { kind: "otherRequest"; requestId: string; subtype: string }
	| { kind: "controlResponse"; requestId: string; ok: boolean };

/** A plain object, as `JSON.parse` makes it. An own `__proto__` key is
    refused: the tool input is given back to the CLI and shown, and a later
    `Object.assign` of it would change a prototype. */
function rec(v: unknown): Rec | null {
	if (!v || typeof v !== "object" || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) return null;
	return Object.prototype.hasOwnProperty.call(v, "__proto__") ? null : v as Rec;
}
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : null);

/** Reads a parsed stdout line as a control message, or `null` when it is not
    one (a user, assistant, stream or result line) or is malformed. */
export function parseClaudeControl(v: unknown): ClaudeControl | null {
	const o = rec(v);
	if (!o) return null;
	if (o.type === "control_cancel_request") {
		const id = str(o.request_id);
		return id ? { kind: "cancel", requestId: id } : null;
	}
	if (o.type === "control_response") {
		const r = rec(o.response);
		const id = r ? str(r.request_id) : null;
		return r && id ? { kind: "controlResponse", requestId: id, ok: r.subtype === "success" } : null;
	}
	if (o.type !== "control_request") return null;
	const id = str(o.request_id);
	const req = rec(o.request);
	if (!id || !req) return null;
	const subtype = str(req.subtype);
	if (!subtype) return null;
	if (subtype === "can_use_tool") {
		const toolName = str(req.tool_name);
		const input = rec(req.input);
		if (!toolName || !input) return null;
		return { kind: "canUseTool", requestId: id, toolName, input, toolUseId: str(req.tool_use_id) };
	}
	return { kind: "otherRequest", requestId: id, subtype };
}
