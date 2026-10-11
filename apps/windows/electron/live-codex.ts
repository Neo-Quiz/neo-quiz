/* ══════════════════════════════════════════════════════════
   A LIVE CODEX SESSION: THE JSON-RPC LINES OF `codex app-server` (2026-10-11).

   Codex runs as a long-lived `codex app-server` (the launch form is
   `argsLiveCodex` of `gabarits-cli.ts`, in the private Codex home of
   `codex-home.ts`), speaking JSON-RPC 2.0, one
   JSON per line, on stdio: `initialize` then the `initialized` notification,
   `thread/start` or `thread/resume`, `turn/start`, `turn/steer` for a message
   during a turn, `turn/interrupt`. Every approval the model needs comes to
   the app as a SERVER request, answered by the app. Shapes copied from
   MonoCode's Codex provider (`codexProtocol.ts`), then measured.

   The main process builds EVERY stdin line here, from typed values: the
   window never sends a raw line, a method or a path (spec
   2026-10-11-live-cli-sessions-design, sections 4.2 and 8).

   PURE (no Node, no Electron): `npm run check:live-protocol` tests it.

   Measured on codex-cli 0.162.1 (2026-10-11), supervised mode, model
   `gpt-6-luna`, effort `low`, in a throwaway folder, with the user's own
   Codex home; the lines, private data replaced, are in
   `scripts/fixtures/live/codex-session.jsonl` (two processes, the second
   resumes the first's thread). Field names checked against
   `codex app-server generate-ts` of the same version.
   - Codex's own lines carry NO `jsonrpc` member: responses are
     {"id":1,"result":…}, notifications {"method":…,"params":…,
     "emittedAtMs":…}, server requests {"method":…,"id":0,"params":…}. A
     `jsonrpc` other than "2.0" is refused; an absent one is the norm.
   - `initialize` without `clientInfo.title` is accepted; the result is
     {userAgent, codexHome, platformFamily, platformOs}.
   - `thread/start` has no effort field: the effort goes through the config
     overrides, `config.model_reasoning_effort`, and the result echoes it
     (`thread.reasoningEffort`). The result is {thread:{id, path, …}, model,
     …}; the thread id is `result.thread.id`. A `thread/started` notification
     follows. `thread/resume` takes the same params plus `threadId`.
   - A text input without `text_elements` is accepted (Codex adds `[]`).
   - `approvalsReviewer` is sent explicitly: the user's config can say
     `approvals_reviewer = "auto_review"`, which would let a Codex sub-agent
     answer in the user's place in Supervised. MonoCode's table: `user`,
     except Auto (`auto_review`).
   - `echo hi` alone was not asked: in read-only the model declined to run
     it. `echo hi > probe.txt` was:
     out {"method":"item/commandExecution/requestApproval","id":0,"params":{
         "kind":"command","threadId","turnId","itemId","startedAtMs",
         "environmentId","command","cwd","commandActions",
         "proposedExecpolicyAmendment","availableDecisions"}}
     in  {"jsonrpc":"2.0","id":0,"result":{"decision":"decline"}}
     out serverRequest/resolved {threadId, requestId}, item/completed with
         `status:"declined"`, the model's answer, turn/completed.
     The server's request ids are small integers restarting at 0 per process.
   - A command's output is `params.item.aggregatedOutput` (string or null) of
     `item/completed`, with `exitCode` and `status`. An ACCEPTED command
     failed on the measuring PC before running ("Failed to create unified
     exec process: helper_unknown_error: setup refresh had errors": the
     user's `[windows] sandbox = "elevated"` setup), and the failure text was
     its aggregatedOutput.
   - `item/permissions/requestApproval` is answered with {permissions, scope}
     and NOT {decision} (generated types; MonoCode answers it so). Not seen
     in the measured turns.
   - The user's hooks (`hooks.json`) and MCP servers of the Codex home run
     in the session (`hook/started`, `mcpServer/startupStatus/updated`).
══════════════════════════════════════════════════════════ */

import type { ModeAgent } from "../../../src/host/claude-outils";

export type CodexMethod = "initialize" | "thread/start" | "thread/resume" | "turn/start" | "turn/steer" | "turn/interrupt";
const METHODS: readonly CodexMethod[] = ["initialize", "thread/start", "thread/resume", "turn/start", "turn/steer", "turn/interrupt"];

export type CodexApprovalMethod = "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" | "item/permissions/requestApproval";
const APPROVALS: readonly string[] = ["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval"];

/** A model name: never starts with a dash, same shape as the Claude one. */
const MODEL = /^[a-z0-9][a-z0-9.\-]{0,63}$/;
/** A reasoning effort: a short lowercase word (Codex's list changes with its versions). */
const EFFORT = /^[a-z][a-z\-]{0,31}$/;

type Rec = Record<string, unknown>;
type Id = number | string;

/** One stdin line. `JSON.stringify` escapes every newline of the values, so
    a line is always exactly one line. */
const line = (v: unknown): string => JSON.stringify(v) + "\n";

const isNumId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
/** A plain object, as `JSON.parse` makes it. An own `__proto__` key is
    refused: params are shown and given back, and a later `Object.assign` of
    them would change a prototype. */
function rec(v: unknown): Rec | null {
	if (!v || typeof v !== "object" || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) return null;
	return Object.prototype.hasOwnProperty.call(v, "__proto__") ? null : v as Rec;
}
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : null);
/** A JSON-RPC id the server gave: a safe integer or a short string. */
const anId = (v: unknown): Id | null => (isNumId(v) ? v : str(v));

function needId(v: unknown): Id {
	const id = anId(v);
	if (id === null) throw new Error("Invalid id");
	return id;
}

/** A request from the app: one of the six methods, a numeric id. */
export function codexRequest(id: number, method: CodexMethod, params: Record<string, unknown>): string {
	if (!isNumId(id)) throw new Error("Invalid id");
	if (!METHODS.includes(method)) throw new Error("Invalid method");
	return line({ jsonrpc: "2.0", id, method, params });
}

export function codexNotification(method: "initialized"): string {
	if (method !== "initialized") throw new Error("Invalid notification");
	return line({ jsonrpc: "2.0", method });
}

/** `experimentalApi` as MonoCode: turn options such as the effort need it. */
export function codexInitializeParams(version: string): Record<string, unknown> {
	return { clientInfo: { name: "neo-quiz", version }, capabilities: { experimentalApi: true } };
}

export type CodexModeParams = { approvalPolicy: string; sandbox: string; autoAcceptFileChanges: boolean; acceptAll: boolean };

/** MonoCode's mode table (`codexProtocol.ts`, `baseCodexConfig`). The two
    booleans are for the session: which approvals the app answers itself. */
const MODES: Record<ModeAgent, CodexModeParams & { approvalsReviewer: "user" | "auto_review" }> = {
	supervised: { approvalPolicy: "untrusted", sandbox: "read-only", autoAcceptFileChanges: false, acceptAll: false, approvalsReviewer: "user" },
	acceptEdits: { approvalPolicy: "on-request", sandbox: "workspace-write", autoAcceptFileChanges: true, acceptAll: false, approvalsReviewer: "user" },
	auto: { approvalPolicy: "on-request", sandbox: "workspace-write", autoAcceptFileChanges: false, acceptAll: false, approvalsReviewer: "auto_review" },
	// "never" would reject an escalation before the app could allow it.
	full: { approvalPolicy: "on-request", sandbox: "danger-full-access", autoAcceptFileChanges: true, acceptAll: true, approvalsReviewer: "user" },
};

function modeOf(mode: ModeAgent): (typeof MODES)[ModeAgent] {
	if (!Object.prototype.hasOwnProperty.call(MODES, mode)) throw new Error("Invalid mode");
	return MODES[mode];
}

export function codexModeParams(mode: ModeAgent): CodexModeParams {
	const m = modeOf(mode);
	return { approvalPolicy: m.approvalPolicy, sandbox: m.sandbox, autoAcceptFileChanges: m.autoAcceptFileChanges, acceptAll: m.acceptAll };
}

export type CodexThreadOptions = { cwd: string; model: string; effort?: string; mode: ModeAgent };

/** The params of `thread/start`. Throws on an empty cwd, or a model or
    effort that does not have its shape. */
export function codexThreadStartParams(o: CodexThreadOptions): Record<string, unknown> {
	const m = modeOf(o.mode);
	if (typeof o.cwd !== "string" || o.cwd.length === 0) throw new Error("Invalid cwd");
	if (!MODEL.test(o.model)) throw new Error("Invalid model");
	if (o.effort !== undefined && !EFFORT.test(o.effort)) throw new Error("Invalid effort");
	return {
		cwd: o.cwd, model: o.model, approvalPolicy: m.approvalPolicy, sandbox: m.sandbox, approvalsReviewer: m.approvalsReviewer,
		...(o.effort ? { config: { model_reasoning_effort: o.effort } } : {}),
	};
}

/** The params of `thread/resume`: the thread, then the same settings. */
export function codexThreadResumeParams(threadId: string, o: CodexThreadOptions): Record<string, unknown> {
	return { threadId, ...codexThreadStartParams(o) };
}

/** The input of a turn: the text, then the attached pictures, by path. */
function input(text: string, images: readonly { path: string }[]): Rec[] {
	return [{ type: "text", text }, ...images.map(im => ({ type: "localImage", path: im.path }))];
}

export function codexTurnStartParams(threadId: string, text: string, images: readonly { path: string }[]): Record<string, unknown> {
	return { threadId, input: input(text, images) };
}

/** A message during a turn: Codex refuses it when the turn has changed. */
export function codexTurnSteerParams(threadId: string, expectedTurnId: string, text: string, images: readonly { path: string }[]): Record<string, unknown> {
	return { threadId, expectedTurnId, input: input(text, images) };
}

export function codexTurnInterruptParams(threadId: string, turnId: string): Record<string, unknown> {
	return { threadId, turnId };
}

/** The answer to a command or file change approval. */
export function codexApprovalAnswer(id: number | string, accept: boolean): string {
	return line({ jsonrpc: "2.0", id: needId(id), result: { decision: accept ? "accept" : "decline" } });
}

/** The answer to `item/permissions/requestApproval`: `null` grants nothing,
    otherwise the granted profile, for the current turn only. */
export function codexPermissionsAnswer(id: number | string, granted: Record<string, unknown> | null): string {
	return line({ jsonrpc: "2.0", id: needId(id), result: granted ? { scope: "turn", permissions: granted } : { permissions: {} } });
}

/** The answer to a server request the app does not handle, so Codex never waits on it. */
export function codexMethodNotFound(id: number | string): string {
	return line({ jsonrpc: "2.0", id: needId(id), error: { code: -32601, message: "Method not found" } });
}

export type CodexMessage =
	| { kind: "response"; id: number; result?: unknown; error?: { code: number; message: string } }
	| { kind: "notification"; method: string; params: Record<string, unknown> }
	| { kind: "approval"; id: number | string; method: CodexApprovalMethod; params: Record<string, unknown> }
	| { kind: "serverRequest"; id: number | string; method: string };

const has = (o: Rec, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Reads a parsed stdout line, or `null` when it is malformed: not a plain
    object, a `jsonrpc` other than "2.0" (Codex omits it), a prototype key,
    a field of the wrong type. */
export function parseCodexMessage(v: unknown): CodexMessage | null {
	const o = rec(v);
	if (!o) return null;
	if (has(o, "jsonrpc") && o.jsonrpc !== "2.0") return null;
	if (has(o, "method")) {
		const method = str(o.method);
		if (!method) return null;
		const params = has(o, "params") ? rec(o.params) : {};
		if (!params) return null;
		if (!has(o, "id")) return { kind: "notification", method, params };
		const id = anId(o.id);
		if (id === null) return null;
		if (APPROVALS.includes(method)) return has(o, "params") ? { kind: "approval", id, method: method as CodexApprovalMethod, params } : null;
		return { kind: "serverRequest", id, method };
	}
	// A response: the app sends numeric ids only.
	if (!isNumId(o.id)) return null;
	if (has(o, "error")) {
		const e = rec(o.error);
		if (!e || typeof e.code !== "number" || !Number.isFinite(e.code)) return null;
		return { kind: "response", id: o.id, error: { code: e.code, message: typeof e.message === "string" ? e.message.slice(0, 2000) : "" } };
	}
	return has(o, "result") ? { kind: "response", id: o.id, result: o.result } : null;
}
