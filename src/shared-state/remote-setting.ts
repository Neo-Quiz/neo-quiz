import { DEVICE, FUTURE_SKEW_MS, MAX_AGE_MS, NAME_UNSAFE, SLUG } from "./remote-request";
import type { TakenEntry } from "./remote-request";

/* ══════════════════════════════════════════════════════════
   A SETTING REQUEST SENT BY THE PHONE (PURE)

   `<root>/.neo-quiz/requests/<sender>/<id>.json` like a generation request,
   told apart by `kind: "setProvider"`. It has ONE job: ask a PC that is not
   on Claude Code to switch to it. The schema is closed on purpose: exactly
   these keys (plus an optional device name), and `provider` can only be the
   literal "claude-code". A request never carries a model, an effort, a path,
   a folder or any other setting, and the PC never reads anything else from
   it. Same boundary rules as `validateRemote`: sender = directory, target =
   this device, age (24 h), future skew, bounded size (the reader bounds the
   file). No DOM, no host, no clock: `now` is an input.
══════════════════════════════════════════════════════════ */

export const SETTING_KIND = "setProvider";
/** Provider switches admitted per hour on a PC (generation requests have their own limit). */
export const MAX_SETTINGS_PER_HOUR = 3;
/** And per SENDER device (security review of 2026-10-08): one device alone
    cannot use up the PC's whole hourly budget. */
export const MAX_SETTINGS_PER_HOUR_PER_SENDER = 2;
const KEYS = new Set(["v", "id", "kind", "from", "target", "at", "provider", "fromName"]);

export interface SettingRequest { v: 1; id: string; kind: typeof SETTING_KIND; from: string; target: string; at: number; provider: "claude-code"; fromName?: string }
export type SettingRefusal = "invalid" | "wrong-target" | "wrong-sender" | "future" | "expired";
export type SettingVerdict = { ok: true; request: SettingRequest } | { ok: false; reason: SettingRefusal };

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const invalid: SettingVerdict = { ok: false, reason: "invalid" };

/** Whether a parsed file claims to be a setting request (the dispatch only; `validateSetting` judges it). */
export function isSettingRaw(raw: unknown): boolean {
	return !!raw && typeof raw === "object" && !Array.isArray(raw) && (raw as { kind?: unknown }).kind === SETTING_KIND;
}

export function validateSetting(raw: unknown, ctx: { device: string; fileDevice: string; fileId: string; now: number }): SettingVerdict {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid;
	const o = raw as Record<string, unknown>;
	if (Object.keys(o).some(k => !KEYS.has(k)) || o.v !== 1 || o.kind !== SETTING_KIND) return invalid;
	const { id, from, target, at, provider } = o;
	if (typeof id !== "string" || !SLUG.test(id) || id !== ctx.fileId) return invalid;
	if (typeof from !== "string" || !DEVICE.test(from) || !same(from, ctx.fileDevice) || same(from, ctx.device)) return { ok: false, reason: "wrong-sender" };
	if (typeof target !== "string" || !same(target, ctx.device)) return { ok: false, reason: "wrong-target" };
	if (typeof at !== "number" || !Number.isFinite(at) || !Number.isFinite(ctx.now)) return invalid;
	if (at > ctx.now + FUTURE_SKEW_MS) return { ok: false, reason: "future" };
	if (ctx.now - at > MAX_AGE_MS) return { ok: false, reason: "expired" };
	if (provider !== "claude-code") return invalid;
	const out: SettingRequest = { v: 1, id, kind: SETTING_KIND, from, target, at, provider };
	if (o.fromName !== undefined) {
		if (typeof o.fromName !== "string" || o.fromName.length > 64 || NAME_UNSAFE.test(o.fromName)) return invalid;
		out.fromName = o.fromName;
	}
	return { ok: true, request: out };
}

/** The phone's request, judged by the PC's own validator before it is written. Throws when refused. */
export function buildSetting(ctx: { device: string; target: string; id: string; now: number; deviceName?: string }): SettingRequest {
	const req: Record<string, unknown> = { v: 1, id: ctx.id, kind: SETTING_KIND, from: ctx.device, target: ctx.target, at: ctx.now, provider: "claude-code" };
	if (ctx.deviceName) req.fromName = ctx.deviceName.slice(0, 64);
	const verdict = validateSetting(req, { device: ctx.target, fileDevice: ctx.device, fileId: ctx.id, now: ctx.now });
	if (!verdict.ok) throw new Error("setting request refused: " + verdict.reason);
	return verdict.request;
}

/** Once per sender + id, at most `MAX_SETTINGS_PER_HOUR` an hour, and at most
    `MAX_SETTINGS_PER_HOUR_PER_SENDER` of them from one device (a corrupt time counts as recent). */
export function admitSetting(req: Pick<SettingRequest, "id" | "from">, taken: ReadonlyArray<TakenEntry>, now: number): "run" | "known" | "rate" {
	const key = (e: { id: string; from?: string }) => (e.from ?? "").toLowerCase() + "/" + e.id;
	if (taken.some(t => key(t) === key(req))) return "known";
	if (!Number.isFinite(now)) return "rate";
	const recentes = taken.filter(t => !Number.isFinite(t.at) || now - t.at < 3600 * 1000);
	if (recentes.length >= MAX_SETTINGS_PER_HOUR) return "rate";
	const du = (req.from ?? "").toLowerCase();
	return recentes.filter(t => (t.from ?? "").toLowerCase() === du).length >= MAX_SETTINGS_PER_HOUR_PER_SENDER ? "rate" : "run";
}
