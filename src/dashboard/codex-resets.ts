/* ══════════════════════════════════════════════════════════
   CODEX BANKED RESETS: the pure core (no DOM, no host, no clock).

   Codex plans can bank free "resets" that zero the 5-hour and weekly windows.
   The main process asks `codex app-server` (JSON-RPC on stdio) for them
   (`apps/windows/electron/codex-resets.ts`); this module only PARSES what the
   server answers and judges what the window may send. The title and the
   description of a credit come from the server: they are TEXT, painted with
   `textContent`, never HTML.
══════════════════════════════════════════════════════════ */

export interface ResetCredit {
	id: string;
	status: "available" | "redeeming" | "redeemed" | "unknown";
	/** Epoch ms, null when the server gives none. */
	expiresAt: number | null;
	title: string | null;
	description: string | null;
}

export interface ResetsRead {
	availableCount: number;
	/** The detail of each credit; empty when the server gives only a count. */
	credits: ResetCredit[];
}

/** What `account/rateLimitResetCredit/consume` answers, exactly these four. */
export type ResetOutcome = "reset" | "nothingToReset" | "noCredit" | "alreadyRedeemed";

/** What the window may ask: the action and a credit id, nothing else. */
export type ResetsRequest = { action: "read" } | { action: "consume"; creditId: string };

export type ResetsError = "not-installed" | "not-signed-in" | "unavailable" | "timeout" | "refused" | "unknown-credit";

export type ResetsResult =
	| { ok: true; action: "read"; resets: ResetsRead }
	| { ok: true; action: "consume"; outcome: ResetOutcome }
	| { ok: false; error: ResetsError };

/** A credit id as the window may send it: short, no space, no quote. */
const CREDIT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const isCreditId = (v: unknown): v is string => typeof v === "string" && CREDIT_ID.test(v);

/** Judges a request coming from the window; null when it is not exactly one
    of the two allowed shapes (any extra key refuses it). */
export function readResetsRequest(raw: unknown): ResetsRequest | null {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
	const o = raw as Record<string, unknown>;
	const keys = Object.keys(o);
	if (o.action === "read") return keys.length === 1 ? { action: "read" } : null;
	if (o.action === "consume") return keys.length === 2 && isCreditId(o.creditId) ? { action: "consume", creditId: o.creditId } : null;
	return null;
}

const rec = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null);

/** Seconds or milliseconds since the epoch, or an ISO string. */
export function parseStamp(v: unknown): number | null {
	if (typeof v === "string" && v.trim() !== "") {
		const n = Number(v);
		if (Number.isFinite(n)) return parseStamp(n);
		const d = Date.parse(v);
		return Number.isNaN(d) ? null : d;
	}
	if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
	return v > 1e10 ? v : v * 1000;
}

/** The credits of an `account/rateLimits/read` result; null when the result
    has none of the banked-reset fields at all (an older Codex). */
export function parseResetCredits(result: unknown): ResetsRead | null {
	const r = rec(result);
	const raw = rec(r?.rateLimitResetCredits ?? r?.rate_limit_reset_credits);
	if (!raw) return null;
	const count = raw.availableCount ?? raw.available_count;
	if (typeof count !== "number" || !Number.isFinite(count)) return null;
	const credits: ResetCredit[] = [];
	if (Array.isArray(raw.credits)) {
		for (const item of raw.credits.slice(0, 50)) {
			const c = rec(item);
			if (!c || !isCreditId(c.id)) continue;
			const s = c.status;
			credits.push({
				id: c.id,
				status: s === "available" || s === "redeeming" || s === "redeemed" ? s : "unknown",
				expiresAt: parseStamp(c.expiresAt ?? c.expires_at),
				title: text(c.title, 120),
				description: text(c.description, 400),
			});
		}
	}
	return { availableCount: Math.max(0, Math.min(999, Math.floor(count))), credits };
}

/** The outcome of a consume result; null for anything else. */
export function parseConsumeOutcome(result: unknown): ResetOutcome | null {
	const o = rec(result)?.outcome;
	return o === "reset" || o === "nothingToReset" || o === "noCredit" || o === "alreadyRedeemed" ? o : null;
}

/** The credits the popover lists: those still available. */
export const spendable = (r: ResetsRead): ResetCredit[] => r.credits.filter(c => c.status === "available");
