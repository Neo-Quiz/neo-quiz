/* ══════════════════════════════════════════════════════════
   THE RULES OF A LIVE AI SESSION, PURE (2026-10-11).

   What the window may send to a live Claude Code / Codex session, judged
   field by field before anything reaches a process (spec 2026-10-11-live-
   cli-sessions-design, sections 4.4 and 8), and the few decisions the
   session manager (`live-sessions.ts`) takes on what the CLI sends: which
   approvals the app answers by itself, which ids it may reuse, how a stdout
   stream is cut into bounded lines.

   The window is presumed compromised (`pont.ts`): a payload with an extra
   field, a kind outside the union, a text or a picture past its bound is
   REFUSED whole, never trimmed. The window never sends a raw stdin line, a
   path or an argument: the main process builds every line (`live-claude.ts`,
   `live-codex.ts`).

   PURE (no Node, no Electron): `npm run check:live-session` tests it.
══════════════════════════════════════════════════════════ */

import { MODES_AGENT } from "../../../src/host/claude-outils";
import type { ModeAgent } from "../../../src/host/claude-outils";
import type { LiveInput } from "../../../src/host/types";

export const MAX_TEXT = 200_000;
export const MAX_IMAGES = 4;
/** Characters of base64 per picture (about 6 MB of image). */
export const MAX_IMAGE_BASE64 = 8 * 1024 * 1024;
/** A stdout line past this length is never parsed: stored as a marker only. */
export const MAX_LINE = 8 * 1024 * 1024;
export const MEDIA_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MODEL = /^[a-z0-9][a-z0-9.\-]{0,63}$/;
const EFFORT_CLAUDE = /^(low|medium|high|xhigh|max)$/;
const EFFORT_CODEX = /^[a-z][a-z\-]{0,31}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

type Rec = Record<string, unknown>;

/** A plain object as the structured clone of IPC makes it, with EXACTLY the
    keys `required` plus some of `optional`, and no other. */
function exact(v: unknown, required: readonly string[], optional: readonly string[] = []): Rec | null {
	if (!v || typeof v !== "object" || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) return null;
	const keys = Object.keys(v);
	if (Object.getOwnPropertySymbols(v).length) return null;
	for (const k of keys) if (!required.includes(k) && !optional.includes(k)) return null;
	for (const k of required) if (!Object.prototype.hasOwnProperty.call(v, k)) return null;
	return v as Rec;
}

export const isRunId = (v: unknown): v is string => typeof v === "string" && RUN_ID.test(v);

/** A thread, turn, chat or request id: a short string without control
    characters (it goes back into a JSON line, and into a log). */
export const isSafeId = (v: unknown): v is string =>
	typeof v === "string" && v.length > 0 && v.length <= 200 && !CONTROL.test(v);

/** A typed input of the window, or `null` when it is not exactly one. */
export function validateLiveInput(v: unknown): LiveInput | null {
	const kind = v && typeof v === "object" ? (v as Rec).kind : undefined;
	if (kind === "interrupt") return exact(v, ["kind"]) ? { kind } : null;
	if (kind === "permission") {
		const o = exact(v, ["kind", "requestId", "allow"]);
		if (!o || !isSafeId(o.requestId) || typeof o.allow !== "boolean") return null;
		return { kind, requestId: o.requestId, allow: o.allow };
	}
	if (kind !== "message") return null;
	const o = exact(v, ["kind", "text", "images"]);
	if (!o || typeof o.text !== "string" || o.text.length > MAX_TEXT || !Array.isArray(o.images) || o.images.length > MAX_IMAGES) return null;
	const images: { mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; base64: string }[] = [];
	for (const im of o.images as unknown[]) {
		const i = exact(im, ["mediaType", "base64"]);
		if (!i || typeof i.mediaType !== "string" || !MEDIA_TYPES.includes(i.mediaType)) return null;
		if (typeof i.base64 !== "string" || i.base64.length === 0 || i.base64.length > MAX_IMAGE_BASE64 || !BASE64.test(i.base64)) return null;
		images.push({ mediaType: i.mediaType as (typeof images)[number]["mediaType"], base64: i.base64 });
	}
	if (o.text.length === 0 && images.length === 0) return null;
	return { kind, text: o.text, images };
}

export type LiveStart = { tool: "claude" | "codex"; chatId: string; model: string; effort?: string; mode: ModeAgent; runId?: string };

/** The options of `live.start`, or `null` when they are not exactly those. */
export function validateLiveStart(v: unknown): LiveStart | null {
	const o = exact(v, ["tool", "chatId", "model", "mode"], ["effort", "runId"]);
	if (!o || (o.tool !== "claude" && o.tool !== "codex")) return null;
	if (!isSafeId(o.chatId) || typeof o.model !== "string" || !MODEL.test(o.model)) return null;
	if (!MODES_AGENT.includes(o.mode as ModeAgent)) return null;
	if (o.effort !== undefined && (typeof o.effort !== "string" || !(o.tool === "claude" ? EFFORT_CLAUDE : EFFORT_CODEX).test(o.effort))) return null;
	if (o.runId !== undefined && !isRunId(o.runId)) return null;
	return {
		tool: o.tool, chatId: o.chatId, model: o.model, mode: o.mode as ModeAgent,
		...(o.effort !== undefined ? { effort: o.effort as string } : {}),
		...(o.runId !== undefined ? { runId: o.runId as string } : {}),
	};
}

/** A page of a stored run: `offset` from 0, `limit` 1..2000. */
export function validatePage(v: unknown): { offset: number; limit: number } | null {
	if (v === undefined) return { offset: 0, limit: MAX_PAGE };
	const o = exact(v, ["offset", "limit"]);
	if (!o || !Number.isSafeInteger(o.offset) || !Number.isSafeInteger(o.limit)) return null;
	const offset = o.offset as number;
	const limit = o.limit as number;
	return offset >= 0 && limit >= 1 && limit <= MAX_PAGE ? { offset, limit } : null;
}
export const MAX_PAGE = 2000;
/** A page also stops past this many characters of JSON (at least one event). */
export const MAX_PAGE_CHARS = 8 * 1024 * 1024;

/** The key the settings of a process depend on: a change respawns it. */
export const settingsKey = (o: { model: string; effort?: string; mode: ModeAgent }): string =>
	o.model + "|" + (o.effort ?? "") + "|" + o.mode;

/** Claude: the app allows a tool by itself in Full access only. Accept
    edits and Auto are the CLI's own permission modes: what the CLI still
    asks is asked to the user. */
export const claudeAutoAllow = (mode: ModeAgent): boolean => mode === "full";

/** Could this approval ask for MORE than a plain sandboxed edit? Codex
    0.162.1 (`app-server generate-ts`, `FileChangeRequestApprovalParams`) has
    ONE structured field for that, `grantRoot` (writes under a root for the
    session); MonoCode has no detection at all (it auto-accepts every file
    change in Accept edits). The "command failed; retry without sandbox?"
    request measured in task 4 is told apart only by its free-text `reason`,
    so ANY reason (or any field this list does not know to be harmless)
    counts as unsure, and unsure is never auto-accepted. */
export function asksEscalation(params: Rec): boolean {
	if (params.grantRoot !== undefined && params.grantRoot !== null) return true;
	if (params.additionalPermissions !== undefined && params.additionalPermissions !== null) return true;
	if (params.reason !== undefined && params.reason !== null && params.reason !== "") return true;
	const known = ["threadId", "turnId", "itemId", "startedAtMs", "reason", "grantRoot"];
	return Object.keys(params).some(k => !known.includes(k));
}

/** A path, lexically, with `/` separators, `.` and `..` resolved; `null`
    when `..` climbs above its start. Relative paths are taken from `base`. */
function normalize(p: string, base: string): string | null {
	const abs = /^(?:[A-Za-z]:[\\/]|[\\/])/.test(p) ? p : base.replace(/[\\/]+$/, "") + "/" + p;
	const out: string[] = [];
	const parts = abs.replace(/\\/g, "/").split("/");
	const head = (parts.shift() as string).toLowerCase();
	for (const raw of parts) {
		// Windows drops trailing dots and spaces: `.neo-quiz.` IS `.neo-quiz`.
		const part = raw === "." || raw === ".." ? raw : raw.replace(/[. ]+$/, "");
		if (part === "" || part === ".") continue;
		if (part === "..") { if (!out.length) return null; out.pop(); continue; }
		out.push(part.toLowerCase());
	}
	return head + "/" + out.join("/");
}

/** Is `p` inside `root`, and NOT under its `.neo-quiz/` (the app's journal
    and shared state)? Lexical and case-insensitive (Windows paths). Refused
    as unsure: a UNC or device path, a drive-relative `C:x`, a stream `x:y`,
    an 8.3 short name (`NEO-QU~1` could be `.neo-quiz`). A junction inside
    the root is not followed (Codex's own sandbox bounds the write). */
export function pathInRoot(root: string, p: unknown): boolean {
	if (typeof p !== "string" || !p || p.length > 4096 || CONTROL.test(p)) return false;
	if (/^[\\/]{2}/.test(p) || /^[A-Za-z]:(?![\\/])/.test(p) || p.slice(2).includes(":") || /~\d/.test(p)) return false;
	const r = normalize(root, root);
	const n = normalize(p, root);
	if (!r || !n) return false;
	const rl = r.replace(/\/+$/, "");
	if (!n.startsWith(rl + "/")) return false;
	const rest = n.slice(rl.length + 1);
	return rest !== ".neo-quiz" && !rest.startsWith(".neo-quiz/");
}

/** Codex: does the app accept this approval by itself? Full access accepts
    everything. Accept edits accepts a file change only when nothing in it
    asks for more (`asksEscalation`: task 4, an edit that failed in the
    sandbox comes back as such a request, and accepting it would write
    unsandboxed) AND every changed path (`paths`, from the change's
    `item/started` / `item/fileChange/patchUpdated`) is in the trusted root,
    outside `.neo-quiz/`. Unknown paths: asked. */
export function codexAutoAccept(mode: ModeAgent, method: string, params: Rec, root: string, paths: readonly string[] | undefined): boolean {
	if (mode === "full") return true;
	if (mode !== "acceptEdits" || method !== "item/fileChange/requestApproval" || asksEscalation(params)) return false;
	return !!paths && paths.length > 0 && paths.every(p => pathInRoot(root, p));
}

/** The paths a Codex file change touches (`FileUpdateChange[]`: `path`, and
    the destination of a move), or `null` when the list is not readable. */
export function changePaths(changes: unknown): string[] | null {
	if (!Array.isArray(changes)) return null;
	const out: string[] = [];
	for (const c of changes) {
		if (!c || typeof c !== "object" || typeof (c as Rec).path !== "string") return null;
		out.push((c as Rec).path as string);
		const kind = (c as Rec).kind;
		if (kind && typeof kind === "object" && typeof (kind as Rec).move_path === "string") out.push((kind as Rec).move_path as string);
	}
	return out;
}

/** At most this many sessions have a process at once. */
export const MAX_LIVE = 6;

/** The id of a server request the parser refused: answered "method not
    found", so Codex never waits on it. `null` when there is no usable id. */
export function malformedRequestId(raw: unknown): number | string | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const o = raw as Rec;
	if (!Object.prototype.hasOwnProperty.call(o, "method") || !Object.prototype.hasOwnProperty.call(o, "id")) return null;
	const id = o.id;
	if (typeof id === "number" && Number.isSafeInteger(id) && id >= 0) return id;
	return isSafeId(id) ? id : null;
}

/** The key of a pending Codex approval, as the window sees it. A number and
    a string id never collide. */
export const codexRequestKey = (id: number | string): string => (typeof id === "number" ? String(id) : "s:" + id);

/** Cuts a text stream into lines, each one bounded BEFORE it is kept whole:
    a line past `max` characters is dropped as it arrives and reported by its
    length only, so a CLI that never writes a newline cannot grow memory. */
export function createLineReader(max: number, onLine: (line: string) => void, onOversized: (length: number) => void): (chunk: string) => void {
	let parts: string[] = [];
	let size = 0;
	let dropping = false;
	return chunk => {
		let rest = chunk;
		for (;;) {
			const i = rest.indexOf("\n");
			const piece = i < 0 ? rest : rest.slice(0, i);
			if (dropping || size + piece.length > max) {
				dropping = true;
				size += piece.length;
				parts = [];
			} else {
				parts.push(piece);
				size += piece.length;
			}
			if (i < 0) return;
			if (dropping) onOversized(size);
			else {
				const line = parts.join("").replace(/\r$/, "");
				if (line.trim()) onLine(line);
			}
			parts = [];
			size = 0;
			dropping = false;
			rest = rest.slice(i + 1);
		}
	};
}
