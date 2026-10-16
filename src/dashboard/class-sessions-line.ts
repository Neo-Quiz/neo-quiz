import { t } from "../i18n";
import type { ClassSessions } from "../class-sessions";

/* The class sessions of a folder as ONE line of muted text under its title on
   the folder page (2026-10-16): "6 sessions of 5 h · 1 per week · 30 h". Only
   the parts that are known: no total without a count AND a length (and none
   for a single session, it would repeat the length); the rhythm alone reads
   "1 session of 2 h 30 per week". Nothing at all when the three are absent. */

/** "5 h", "2 h 30", "1 h 05", "45 min". */
export function sessionDuration(minutes: number): string {
	if (minutes < 60) return t("dashboard.common.sessionMinutes", { m: minutes });
	const h = Math.floor(minutes / 60), m = minutes % 60;
	return m === 0 ? t("dashboard.common.sessionHours", { h }) : t("dashboard.common.sessionHoursMinutes", { h, m: String(m).padStart(2, "0") });
}

export function classSessionsLine(s: ClassSessions): string {
	const { count, minutes, perWeek } = s;
	const length = minutes !== undefined ? sessionDuration(minutes) : undefined;
	const parts: string[] = [];
	if (count !== undefined) {
		parts.push(length !== undefined
			? t(count === 1 ? "dashboard.quizzes.sessionsCountLengthOne" : "dashboard.quizzes.sessionsCountLengthOther", { count, length })
			: t(count === 1 ? "dashboard.quizzes.sessionsCountOne" : "dashboard.quizzes.sessionsCountOther", { count }));
		if (perWeek !== undefined) parts.push(t("dashboard.quizzes.sessionsPerWeekShort", { count: perWeek }));
		if (minutes !== undefined && count > 1) parts.push(sessionDuration(count * minutes));
	} else if (perWeek !== undefined) {
		parts.push(length !== undefined
			? t(perWeek === 1 ? "dashboard.quizzes.sessionsPerWeekLengthOne" : "dashboard.quizzes.sessionsPerWeekLengthOther", { count: perWeek, length })
			: t(perWeek === 1 ? "dashboard.quizzes.sessionsPerWeekOne" : "dashboard.quizzes.sessionsPerWeekOther", { count: perWeek }));
	} else if (length !== undefined) {
		parts.push(t("dashboard.quizzes.sessionsLengthOnly", { length }));
	}
	// A no-break space before the dot: a wrapped line never starts with "·".
	return parts.join("\u00a0· ");
}
