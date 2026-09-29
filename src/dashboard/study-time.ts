import { startOfDay } from "./home-tasks";

/* ══════════════════════════════════════════════════════════
   STUDY TIME — the home page's stats band (2026-09-29, after the
   StudySmarter statistics: Total, Per day, Record).

   Nothing records how long a session lasts, so the time is ESTIMATED from
   the review log, whose every answer carries its timestamp: an answer
   counts the time since the previous one, when that gap is a pause of at
   most SESSION_GAP_MS; the first answer of a session (after a longer gap)
   counts a flat LONE_ANSWER_MS. A coffee break in the middle of a quiz is
   therefore never counted, and an answer is never worth zero.
══════════════════════════════════════════════════════════ */

/** The longest gap between two answers still counted as studying. */
export const SESSION_GAP_MS = 5 * 60_000;
/** What the first answer of a session is worth. */
export const LONE_ANSWER_MS = 30_000;

export interface StudyStats {
	totalMs: number;
	/** Total divided by the calendar days from the first answer to today. */
	perDayMs: number;
	/** The best single day. */
	recordMs: number;
}

/** `null` when nothing was ever answered: the band then stays hidden. */
export function studyStats(times: readonly number[], now: number): StudyStats | null {
	if (times.length === 0) return null;
	const sorted = [...times].sort((a, b) => a - b);
	const byDay = new Map<number, number>();
	let totalMs = 0;
	for (let i = 0; i < sorted.length; i++) {
		const gap = i > 0 ? sorted[i] - sorted[i - 1] : Infinity;
		const ms = gap <= SESSION_GAP_MS ? gap : LONE_ANSWER_MS;
		const day = startOfDay(sorted[i]);
		byDay.set(day, (byDay.get(day) ?? 0) + ms);
		totalMs += ms;
	}
	// Days counted on the CALENDAR (rounded): a daylight saving change makes
	// one day 23 or 25 hours long, never a fraction of a day more.
	const days = Math.max(1, Math.round((startOfDay(now) - startOfDay(sorted[0])) / 86_400_000) + 1);
	return { totalMs, perDayMs: totalMs / days, recordMs: Math.max(...byDay.values()) };
}

/** StudySmarter's compact form: "2.5h" from an hour up (one decimal, the
    UI's locale: "2,5h" in French), "45min" below — where "0.8h" would read
    worse than the minutes. */
export function formatStudyTime(ms: number, lang: string): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 60) return `${minutes}min`;
	return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(ms / 3_600_000)}h`;
}
