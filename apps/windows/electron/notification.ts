/* The rules of `notification.afficher`: pure, so the check loads the real code. */
export const MAX_TITLE = 80;
export const MAX_BODY = 200;
export const MAX_PER_HOUR = 30;
export const MIN_GAP_MS = 2_000;
/* C0 and C1 controls become spaces. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/* Bidi controls and zero-width characters are removed: they spoof a title. */
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;

/* The raw input is cut BEFORE any regex, so a huge string costs a bounded amount of work. */
const clean = (s: string, max: number): string =>
	Array.from(s.slice(0, max * 4).replace(INVISIBLE, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("");

/** Strings only, controls removed, cut to the bounds; null when either is not text or the title is blank. */
export function cleanNotification(title: unknown, body: unknown): { title: string; body: string } | null {
	if (typeof title !== "string" || typeof body !== "string") return null;
	const t = clean(title, MAX_TITLE);
	return t ? { title: t, body: clean(body, MAX_BODY) } : null;
}

/** The gate is consulted FIRST: over the rate limit, no string work at all. */
export function prepareNotification(gate: { allow(): boolean }, title: unknown, body: unknown): { title: string; body: string } | null {
	if (!gate.allow()) return null;
	return cleanNotification(title, body);
}

/** Spacing and hourly bound; `allow()` records the call when it returns true. */
export function createNotificationGate(now: () => number = Date.now): { allow(): boolean } {
	const sent: number[] = [];
	return {
		allow() {
			const t = now();
			while (sent.length && t - sent[0] >= 3_600_000) sent.shift();
			if (sent.length >= MAX_PER_HOUR || (sent.length && t - sent[sent.length - 1] < MIN_GAP_MS)) return false;
			sent.push(t);
			return true;
		},
	};
}
