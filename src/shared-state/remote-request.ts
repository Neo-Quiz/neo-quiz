import { isCleanRelativePath } from "./chat-merge";
import { MODEL_ID } from "./devices";

/* ══════════════════════════════════════════════════════════
   A REQUEST SENT BY A DEVICE THAT CANNOT GENERATE (PURE)

   `<root>/.neo-quiz/requests/<sender>/<id>.json`, written by the phone, read by
   the target PC only. THE SECURITY BOUNDARY (spec, "The PC side of a remote
   request"): a synced file makes the PC launch a CLI, so everything is
   checked here before anything runs: strict schema with unknown fields
   REJECTED (a request cannot name a provider, a CLI path or a setting; its
   one choice is an optional Claude `model` id, bounded here, and the runner
   accepts it only if it is in the PC's own current list), sizes, relative document paths limited to text documents outside
   the internal folder, sender = directory, target = this device, age. The
   request text is data for the prompt; nothing here ever reaches an argument.
   No DOM, no host, no clock: `now` is always an input.
══════════════════════════════════════════════════════════ */

export const MAX_TEXT = 20_000;
export const MAX_DOCUMENTS = 10;
export const MAX_AGE_MS = 24 * 3600 * 1000;
export const MAX_PER_HOUR = 6;
export const FUTURE_SKEW_MS = 5 * 60 * 1000;
export const MAX_REQUEST_CHARS = 100_000;

export interface RemoteRequest {
	v: 1; id: string; at: number; from: string; fromName?: string; target: string; chatId: string;
	text: string; mode: "learn" | "practice"; types?: string[]; count?: number; documents: Array<{ path: string }>;
	/** A Claude Code model id, only ever compared with the PC's own current list. */
	model?: string;
}
export type Refusal = "invalid" | "wrong-target" | "wrong-sender" | "future" | "expired";
export type Verdict = { ok: true; request: RemoteRequest } | { ok: false; reason: Refusal };

/** Shape of a request id and of a chat id; the file name of a request. Shared, never duplicated. */
export const SLUG = /^[a-z0-9][a-z0-9-]{3,63}$/;
/** Shape of a device id (the directory a request is found under). */
export const DEVICE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = new Set(["v", "id", "at", "from", "fromName", "target", "chatId", "text", "mode", "types", "count", "documents", "model"]);
const DOCUMENT_EXTENSION = /\.(md|markdown|txt)$/i;
/** Drive letters and streams (`:`), wildcards, controls (C0, DEL, C1), invisible and bidi characters
    (zero width, line/paragraph separators, directional overrides and isolates, BOM, soft hyphen),
    look-alike dots (dot leaders, ideographic full stop) and the whole fullwidth block (`．．／`). */
const FORBIDDEN_IN_PATH = /[:<>"|?*\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2024-\u2026\u2028-\u202e\u2060-\u206f\u3002\ufeff\uff00-\uffef\ufff0-\uffff]/;
/** Names Windows reads as a device, with or without an extension (`con.md` opens the console). */
const DEVICE_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])$/i;
/** A short 8.3 name (`PROGRA~1`) designates another file than the one written. */
const SHORT_NAME = /~[0-9]/;
const NAME_UNSAFE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff0-\uffff]/;
/** Text keeps tab, newline and carriage return; every other control character is refused. */
const TEXT_UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Device ids compare case-insensitively: a Windows folder `ABC` and `abc` is one folder. */
const sameDevice = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const invalid: Verdict = { ok: false, reason: "invalid" };

function documentOk(d: unknown): d is { path: string } {
	if (!isObj(d) || Object.keys(d).length !== 1 || typeof d.path !== "string") return false;
	const p = d.path;
	if (!isCleanRelativePath(p) || FORBIDDEN_IN_PATH.test(p) || !DOCUMENT_EXTENSION.test(p)) return false;
	if (p.normalize("NFC") !== p) return false;
	const segments = p.split("/");
	// A segment ending in a dot or a space is read by Windows as another name (`x.md.` opens `x.md`).
	if (segments.some(s => /[. ]$/.test(s) || DEVICE_NAME.test(s.split(".")[0].replace(/ +$/, "")) || SHORT_NAME.test(s))) return false;
	// An extension with no name before it (`.md`) is a hidden file, not a document.
	if (segments[segments.length - 1].replace(DOCUMENT_EXTENSION, "") === "") return false;
	return segments[0].toLowerCase() !== ".neo-quiz";
}

/** A dense array of at most `max` items, each passing `ok` (holes and huge arrays refused). */
function denseArray<T>(x: unknown, max: number, ok: (i: unknown) => i is T): x is T[] {
	if (!Array.isArray(x) || x.length > max) return false;
	for (let i = 0; i < x.length; i++) if (!(i in x) || !ok(x[i])) return false;
	return true;
}

export function validateRemote(raw: unknown, ctx: { device: string; fileDevice: string; fileId: string; now: number }): Verdict {
	if (!isObj(raw) || Object.keys(raw).some(k => !KEYS.has(k)) || raw.v !== 1) return invalid;
	const { id, at, from, target, chatId, text, mode, documents } = raw;
	if (typeof id !== "string" || !SLUG.test(id) || id !== ctx.fileId) return invalid;
	if (typeof from !== "string" || !DEVICE.test(from) || sameDevice(from, ctx.fileDevice) === false || sameDevice(from, ctx.device)) return { ok: false, reason: "wrong-sender" };
	if (typeof target !== "string" || !sameDevice(target, ctx.device)) return { ok: false, reason: "wrong-target" };
	if (typeof at !== "number" || !Number.isFinite(at) || !Number.isFinite(ctx.now)) return invalid;
	if (at > ctx.now + FUTURE_SKEW_MS) return { ok: false, reason: "future" };
	if (ctx.now - at > MAX_AGE_MS) return { ok: false, reason: "expired" };
	if (typeof chatId !== "string" || !SLUG.test(chatId)) return invalid;
	if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT || TEXT_UNSAFE.test(text)) return invalid;
	if (mode !== "learn" && mode !== "practice") return invalid;
	if (!denseArray(documents, MAX_DOCUMENTS, documentOk)) return invalid;
	const out: RemoteRequest = { v: 1, id, at, from, target, chatId, text, mode, documents: documents.map(d => ({ path: d.path })) };
	if (raw.fromName !== undefined) {
		if (typeof raw.fromName !== "string" || raw.fromName.length > 64 || NAME_UNSAFE.test(raw.fromName)) return invalid;
		out.fromName = raw.fromName;
	}
	if (raw.types !== undefined) {
		if (!denseArray(raw.types, 8, (s): s is string => typeof s === "string" && s.length <= 40 && !NAME_UNSAFE.test(s))) return invalid;
		out.types = [...raw.types];
	}
	if (raw.count !== undefined) {
		if (typeof raw.count !== "number" || !Number.isInteger(raw.count) || raw.count < 1 || raw.count > 100) return invalid;
		out.count = raw.count;
	}
	if (raw.model !== undefined) {
		// Same shape the CLI template accepts (no leading dash, no space or quote): charset [A-Za-z0-9._:-], 64 at most.
		if (typeof raw.model !== "string" || !MODEL_ID.test(raw.model)) return invalid;
		out.model = raw.model;
	}
	return { ok: true, request: out };
}

export interface TakenEntry { id: string; from?: string; at: number }

export function admit(req: Pick<RemoteRequest, "id" | "from">, st: { taken: ReadonlyArray<TakenEntry>; busy: boolean }, now: number): "run" | "known" | "busy" | "rate" {
	// Keyed on sender + id: two senders drawing the same id never collide.
	const key = (e: { id: string; from?: string }) => (e.from ?? "").toLowerCase() + "/" + e.id;
	if (st.taken.some(t => key(t) === key(req))) return "known";
	if (st.busy) return "busy";
	if (!Number.isFinite(now)) return "rate";
	// A taken entry with a corrupt time counts as recent: never a way around the limit.
	if (st.taken.filter(t => !Number.isFinite(t.at) || now - t.at < 3600 * 1000).length >= MAX_PER_HOUR) return "rate";
	return "run";
}

export type PendingState = "done" | "running" | "waiting" | "expired";

export function pendingState(req: Pick<RemoteRequest, "id" | "at">, ctx: { recorded: ReadonlySet<string>; running: ReadonlySet<string>; now: number }): PendingState {
	if (ctx.recorded.has(req.id)) return "done";
	if (ctx.running.has(req.id)) return "running";
	if (!Number.isFinite(req.at)) return "expired";
	return Number.isFinite(ctx.now) && ctx.now - req.at > MAX_AGE_MS ? "expired" : "waiting";
}
