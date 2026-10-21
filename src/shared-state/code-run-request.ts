import { DEVICE, SLUG, isSafeDocumentPath } from "./remote-request";
import type { CodeRun } from "../host/types";

/* ══════════════════════════════════════════════════════════
   A PYTHON RUN ASKED BY THE PHONE (PURE)

   `<root>/.neo-quiz/code-runs/requests/<sender>/<id>.json`, written by the
   phone, read by the target PC only; the PC answers in its own
   `results/<pc>/<id>.json`. THE SECURITY BOUNDARY: a synced file makes the PC
   run native code. The request never carries code: it names a note (a
   relative `.md` path in the synced root) and the SHA-256 of one of its
   Python blocks; the PC reads the note itself and runs only a block whose
   hash matches, byte for byte. Everything else is checked here first:
   strict schema (unknown key refused, `__proto__` included), sender =
   directory and never this device, target = this device, a short age (the
   phone stops waiting after 90 s: a request older than that is dropped,
   never run late), the path rules shared with remote generation
   (`isSafeDocumentPath`). `accepted` is the phone's answer to the run
   warning (spec §9: a device the owner paired is trusted for that answer).
   No DOM, no host, no clock: `now` is always an input.
══════════════════════════════════════════════════════════ */

/** Folder of the code runs under `.neo-quiz/`, then `requests/` and `results/`. */
export const CODE_RUNS_DIR = "code-runs";
export const MAX_AGE_MS = 120_000;
export const FUTURE_SKEW_MS = 30_000;
/** stdout and error of a result, in characters each. */
export const MAX_OUTPUT = 256 * 1024;
/** At most this many runs per sending device per hour. */
export const MAX_PER_HOUR = 20;
/** The PC's local list of taken requests (settings `codeRunsTaken`). */
export const MAX_TAKEN = 200;
/** The PC deletes its own results older than this. */
export const RESULT_TTL_MS = 10 * 60_000;
/** A request file is a few hundred characters; past this it is not read. */
export const MAX_REQUEST_CHARS = 4_000;
/** A result file past this is not read (two capped outputs, JSON-escaped, fit with margin when written). */
export const MAX_RESULT_CHARS = 1_200_000;

export interface CodeRunRequest { v: 1; id: string; at: number; from: string; target: string; path: string; sha256: string; accepted: true }
export interface CodeRunResult { v: 1; id: string; at: number; status: CodeRun["status"]; stdout: string; error?: string; unsupported?: string[] }

export type CodeRunRefusal = "schema" | "expediteur" | "destinataire" | "age" | "futur" | "chemin";
export type CodeRunVerdict = { ok: true; demande: CodeRunRequest } | { ok: false; raison: CodeRunRefusal };

const KEYS = new Set(["v", "id", "at", "from", "target", "path", "sha256", "accepted"]);
const SHA256 = /^[0-9a-f]{64}$/;
const NOTE = /\.md$/i;
const STATUSES: ReadonlySet<string> = new Set<CodeRun["status"]>(["ok", "error", "compile-error", "timeout", "too-long", "unavailable", "not-installed", "unsupported"]);
/** A module name the PC reports as unsupported (Python identifiers and dots). */
const MODULE_NAME = /^[A-Za-z_][A-Za-z0-9_.]{0,99}$/;

const sameDevice = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
/** A plain object: an array, a class instance or an object with a forged prototype is not one. */
function isPlain(x: unknown): x is Record<string, unknown> {
	if (!x || typeof x !== "object" || Array.isArray(x)) return false;
	const proto = Object.getPrototypeOf(x);
	return proto === Object.prototype || proto === null;
}
const schema: CodeRunVerdict = { ok: false, raison: "schema" };

export function validerDemandeCode(raw: unknown, ctx: { device: string; fileDevice: string; fileId: string; now: number }): CodeRunVerdict {
	if (!isPlain(raw) || Object.keys(raw).some(k => !KEYS.has(k)) || raw.v !== 1) return schema;
	const { id, at, from, target, path, sha256, accepted } = raw;
	if (typeof id !== "string" || !SLUG.test(id) || id !== ctx.fileId) return schema;
	if (typeof at !== "number" || !Number.isFinite(at) || !Number.isFinite(ctx.now)) return schema;
	if (typeof path !== "string" || typeof sha256 !== "string" || !SHA256.test(sha256) || accepted !== true) return schema;
	if (typeof from !== "string" || !DEVICE.test(from) || !sameDevice(from, ctx.fileDevice) || sameDevice(from, ctx.device)) return { ok: false, raison: "expediteur" };
	if (typeof target !== "string" || !sameDevice(target, ctx.device)) return { ok: false, raison: "destinataire" };
	if (at > ctx.now + FUTURE_SKEW_MS) return { ok: false, raison: "futur" };
	if (ctx.now - at > MAX_AGE_MS) return { ok: false, raison: "age" };
	if (!isSafeDocumentPath(path, NOTE)) return { ok: false, raison: "chemin" };
	return { ok: true, demande: { v: 1, id, at, from, target, path, sha256, accepted: true } };
}

export interface TakenRun { id: string; from: string; at: number }

/** Whether the PC runs this request now. Keyed on sender + id (two senders drawing the same id never collide); the limit is per sender. */
export function admettre(req: Pick<CodeRunRequest, "id" | "from">, st: { taken: ReadonlyArray<TakenRun>; busy: boolean }, now: number): "run" | "known" | "busy" | "rate" {
	const key = (e: { id: string; from: string }): string => e.from.toLowerCase() + "/" + e.id;
	if (st.taken.some(t => key(t) === key(req))) return "known";
	if (st.busy) return "busy";
	if (!Number.isFinite(now)) return "rate";
	// A taken entry with a corrupt time counts as recent: never a way around the limit.
	const recent = st.taken.filter(t => sameDevice(t.from, req.from) && (!Number.isFinite(t.at) || now - t.at < 3600_000));
	return recent.length >= MAX_PER_HOUR ? "rate" : "run";
}

/** The taken list as stored in the settings: only well-formed entries, the last `MAX_TAKEN`. */
export function lireTaken(raw: unknown): TakenRun[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((e): e is TakenRun => isPlain(e) && typeof e.id === "string" && typeof e.from === "string" && typeof e.at === "number").slice(-MAX_TAKEN);
}

const cut = (s: string): string => (s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) : s);

/** The result file the PC writes for `id`, outputs capped. */
export function construireResultat(id: string, run: CodeRun, now: number): CodeRunResult {
	const out: CodeRunResult = { v: 1, id, at: now, status: STATUSES.has(run.status) ? run.status : "unavailable", stdout: cut(String(run.stdout ?? "")) };
	if (typeof run.error === "string") out.error = cut(run.error);
	if (out.status === "unsupported" && Array.isArray(run.unsupported)) out.unsupported = run.unsupported.filter(n => typeof n === "string" && MODULE_NAME.test(n)).slice(0, 50);
	return out;
}

/** A result file read by the phone: strict, for this `id` only; null when it is not one. */
export function lireResultat(raw: unknown, id: string): CodeRunResult | null {
	if (!isPlain(raw) || raw.v !== 1 || raw.id !== id) return null;
	if (Object.keys(raw).some(k => !["v", "id", "at", "status", "stdout", "error", "unsupported"].includes(k))) return null;
	const { at, status, stdout, error, unsupported } = raw;
	if (typeof at !== "number" || !Number.isFinite(at)) return null;
	if (typeof status !== "string" || !STATUSES.has(status)) return null;
	if (typeof stdout !== "string" || stdout.length > MAX_OUTPUT) return null;
	const out: CodeRunResult = { v: 1, id, at, status: status as CodeRun["status"], stdout };
	if (error !== undefined) {
		if (typeof error !== "string" || error.length > MAX_OUTPUT) return null;
		out.error = error;
	}
	if (unsupported !== undefined) {
		if (!Array.isArray(unsupported) || unsupported.length > 50 || !unsupported.every(n => typeof n === "string" && MODULE_NAME.test(n))) return null;
		out.unsupported = [...unsupported] as string[];
	}
	return out;
}
