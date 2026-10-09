/* ══════════════════════════════════════════════════════════
   READ CADENCE of the plan-usage endpoint (pure: the clock is an input).

   ONE rule for every reader of a provider (automatic, popover open, manual
   refresh, the Generate and Explain blocks alike):
   - at least MIN_GAP_MS between two successful reads;
   - after a 429, no read at all until the server's `Retry-After`, or, when it
     gives none, an exponential back-off: 60 s, 2, 4, 8 min, capped at 15 min;
   - a success resets the back-off.
══════════════════════════════════════════════════════════ */

export const MIN_GAP_MS = 30000;
export const BACKOFF_BASE_MS = 60000;
export const BACKOFF_MAX_MS = 15 * 60000;

export interface Cadence {
	/** Time of the last successful read, null before any. */
	lastOkAt: number | null;
	/** Consecutive 429s since the last success. */
	limitedCount: number;
	/** No read before this instant (back-off), 0 when none. */
	blockedUntil: number;
}

export type CadenceVerdict =
	| { ok: true }
	| { ok: false; reason: "gap" | "backoff"; waitMs: number };

export const newCadence = (): Cadence => ({ lastOkAt: null, limitedCount: 0, blockedUntil: 0 });

export function cadenceVerdict(c: Cadence, now: number): CadenceVerdict {
	if (c.blockedUntil > now) return { ok: false, reason: "backoff", waitMs: c.blockedUntil - now };
	if (c.lastOkAt != null && now - c.lastOkAt < MIN_GAP_MS) return { ok: false, reason: "gap", waitMs: MIN_GAP_MS - (now - c.lastOkAt) };
	return { ok: true };
}

export function cadenceSuccess(c: Cadence, now: number): void {
	c.lastOkAt = now;
	c.limitedCount = 0;
	c.blockedUntil = 0;
}

/** A 429 answer. `retryAfterSec` is the header when the host passed one. */
export function cadenceRateLimited(c: Cadence, now: number, retryAfterSec: number | null): void {
	c.limitedCount += 1;
	const header = retryAfterSec != null && Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : null;
	const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (c.limitedCount - 1));
	c.blockedUntil = now + Math.min(BACKOFF_MAX_MS, header ?? backoff);
}
