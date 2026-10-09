/* ══════════════════════════════════════════════════════════
   A USAGE LIMIT HIT BY A CLI: detection and reset time (pure, the clock is
   an input).

   When Claude Code or Codex refuses a generation because the plan's window is
   used up, retrying at once is useless and a pile of failed lines is noise:
   the queue pauses the line until the window resets (`file-generation.ts`,
   state `pause`). The patterns follow MonoCode's `usageLimitFromError`
   (Claude and Codex wordings), plus what the two CLIs print to say WHEN:
   - Claude Code: "Claude AI usage limit reached|1760000000" (epoch seconds);
   - Codex: "You've hit your usage limit ... try again at Oct 12th, 2026 2:00 PM"
     or "try again in 4 days 2 hours 3 minutes";
   - either: "resets 3am", "resets at 3:16 AM".
   A message that gives no time yields `resetAt: null`: the caller then reads
   the usage line, or leaves the resume to the user. Nothing is guessed.
══════════════════════════════════════════════════════════ */

export interface UsageLimitHit {
	/** Epoch ms when the window resets, null when the message does not say. */
	resetAt: number | null;
}

/** MonoCode's patterns, in their FULL forms only: a bare "usage limit" or
    "limit reached" also matches "token limit reached" or a sentence about
    limits, and would pause a line that only failed. */
const LIMIT = /(?:usage|spending|monthly|weekly|daily|5-hour|five-hour|session) limit (?:reached|exceeded|hit)|hit your (?:usage )?limit|(?:quota|credits?) (?:exceeded|exhausted|depleted)|insufficient[_ ](?:quota|credits)|credit balance is too low/i;

/** No plan window lasts longer than a week: a reset further than this is a
    misread (or a hostile message), never a time to wait for. */
export const RESET_MAX_MS = 8 * 86400000;

/** The error messages a CLI's STDOUT carries as structured events, and
    nothing else: stdout is mostly the MODEL's output, which may talk about
    limits without any limit being hit. Codex `exec --json`: `error` and
    `turn.failed` events; Claude Code `stream-json`: a `result` event with
    `is_error`. */
export function cliErrorText(stdout: string): string {
	const out: string[] = [];
	for (const line of String(stdout || "").split("\n")) {
		const s = line.trim();
		if (!s.startsWith("{")) continue;
		let evt: unknown;
		try { evt = JSON.parse(s); } catch { continue; }
		if (typeof evt !== "object" || evt === null) continue;
		const e = evt as { type?: unknown; message?: unknown; error?: { message?: unknown }; is_error?: unknown; result?: unknown };
		if (e.type === "error" && typeof e.message === "string") out.push(e.message);
		else if (e.type === "turn.failed" && typeof e.error?.message === "string") out.push(e.error.message);
		else if (e.type === "result" && e.is_error === true && typeof e.result === "string") out.push(e.result);
	}
	return out.join("\n");
}

const MOIS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** "in 4 days 2 hours 3 minutes", "in 52 minutes": the delay in ms, or null. */
function parseDelai(texte: string): number | null {
	const m = /\bin\s+((?:\d+\s*(?:d|days?|h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)\b[\s,]*(?:and\s+)?)+)/i.exec(texte);
	if (!m) return null;
	let ms = 0;
	for (const part of m[1].matchAll(/(\d+)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)\b/gi)) {
		const n = Number(part[1]);
		const u = part[2].toLowerCase();
		ms += n * (u.startsWith("d") ? 86400000 : u.startsWith("h") ? 3600000 : u.startsWith("m") ? 60000 : 1000);
	}
	return ms > 0 ? ms : null;
}

/** "11:00 PM", "3am", "3:16 AM", "23:00" read as hours and minutes. */
function parseHeure(texte: string): { h: number; min: number; fin: number } | null {
	const ampm = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(texte);
	if (ampm) {
		let h = Number(ampm[1]) % 12;
		if (ampm[3].toLowerCase() === "pm") h += 12;
		return { h, min: Number(ampm[2] ?? 0), fin: ampm.index + ampm[0].length };
	}
	const h24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(texte);
	return h24 ? { h: Number(h24[1]), min: Number(h24[2]), fin: h24.index + h24[0].length } : null;
}

/** "Oct 12th, 2026 2:00 PM", "Oct 12 at 2pm", "resets 3am": a local time. */
function parseHeureLocale(texte: string, now: number): number | null {
	const apres = /(?:try again at|resets?(?:\s+at)?|available at|until)\s+([^|\n]{1,60})/i.exec(texte);
	if (!apres) return null;
	const reste = apres[1];
	const heure = parseHeure(reste);
	if (!heure) return null;
	const date = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i.exec(reste);
	const ref = new Date(now);
	let cible: Date;
	if (date) {
		const annee = date[3] ? Number(date[3]) : ref.getFullYear();
		cible = new Date(annee, MOIS[date[1].toLowerCase()], Number(date[2]), heure.h, heure.min, 0, 0);
		if (!date[3] && cible.getTime() <= now) cible = new Date(annee + 1, MOIS[date[1].toLowerCase()], Number(date[2]), heure.h, heure.min, 0, 0);
	} else {
		cible = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), heure.h, heure.min, 0, 0);
		if (cible.getTime() <= now) cible = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + 1, heure.h, heure.min, 0, 0);
	}
	const t = cible.getTime();
	return Number.isNaN(t) ? null : t;
}

/** Null when `texte` is not a usage limit; otherwise the reset time if the
    message states it. Only a finite time in the FUTURE, at most
    `RESET_MAX_MS` away, counts. `texte` must be the CLI's error text
    (stderr, the error message, `cliErrorText`), never its raw stdout. */
export function detectUsageLimit(texte: string, now: number): UsageLimitHit | null {
	if (typeof texte !== "string" || !LIMIT.test(texte)) return null;
	const epoch = /\|\s*(\d{10})\b/.exec(texte);
	let resetAt: number | null = null;
	if (epoch) resetAt = Number(epoch[1]) * 1000;
	if (resetAt === null) {
		const delai = parseDelai(texte);
		if (delai !== null) resetAt = now + delai;
	}
	if (resetAt === null) resetAt = parseHeureLocale(texte, now);
	return { resetAt: resetAt !== null && Number.isFinite(resetAt) && resetAt > now && resetAt <= now + RESET_MAX_MS ? resetAt : null };
}

/** The reset to wait for, read from the usage line: the window that is full.
    When several are full, the LAST to reset gates the tool; when none is
    full, null (nothing says which window refused). */
export function resetFromRows(rows: readonly { usedPercent: number; resetsAt: number | null }[], now: number): number | null {
	const pleines = rows.filter(r => r.usedPercent >= 99.5 && r.resetsAt !== null && r.resetsAt > now);
	return pleines.length ? Math.max(...pleines.map(r => r.resetsAt as number)) : null;
}

/** "23:00" when the resume is today, "Oct 12, 14:00" otherwise (the viewer's locale and time zone). */
export function formatResume(at: number, now: number, lang: string): string {
	const d = new Date(at);
	const heure = d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
	if (d.toDateString() === new Date(now).toDateString()) return heure;
	return d.toLocaleDateString(lang, { day: "numeric", month: "short" }) + ", " + heure;
}

/** Thrown by the AI client when a CLI refuses on a usage limit. `tool` names
    the CLI; `resetAt` is epoch ms or null. */
export class UsageLimitError extends Error {
	constructor(readonly tool: "claude" | "codex", readonly resetAt: number | null, message: string) {
		super(message);
		this.name = "UsageLimitError";
	}
}
