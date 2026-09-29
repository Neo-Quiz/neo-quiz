import { applyRenames } from "./log";
import { planToday } from "./plan";
import type { LogLine, ScheduledItem } from "./types";
import type { SchedulerParams } from "./params";

/**
 * HOW A PAST DAY WENT (home page week, 2026-09-29).
 *
 * The plan of a day is not stored anywhere: like every state of this core,
 * it is DERIVED. Replaying the log up to the start of the day gives what
 * was due that day (`planToday`, budget included); the answers given
 * between the start and the end of the day tell whether it was done.
 *
 * - `none`: nothing was due;
 * - `done`: every question due was answered that day;
 * - `missed`: some were not.
 *
 * Renames are applied to the WHOLE log first: a note renamed after the day
 * must still find the answers given under its old name, and the catalogue
 * (`items`) is today's, under today's names.
 *
 * Known limit, accepted (spec 2026-09-29-home-page-design.md §3.2): the
 * catalogue and the exam horizons are today's, not the day's — an exam
 * added later can change the outcome of a past day.
 */
export type DayOutcome = "none" | "done" | "missed";

export interface DayOutcomeInput {
	/** Local start of the day (ms): only the host knows the time zone. */
	dayStart: number;
	/** Local start of the NEXT day (ms), exclusive. Not `dayStart + 24 h`:
	    a daylight saving change makes a day 23 or 25 hours long. */
	dayEnd: number;
	items: ScheduledItem[];
	events: LogLine[];
	horizons: Record<string, number | null>;
	params: SchedulerParams;
}

export function dayOutcome(input: DayOutcomeInput): DayOutcome {
	const { dayStart, dayEnd, items, horizons, params } = input;
	const answers = applyRenames(input.events);
	const plan = planToday({
		now: dayStart, dayStart, items, horizons, params,
		events: answers.filter(e => e.at < dayStart),
	});
	if (plan.today.length === 0) return "none";
	const answered = new Set(answers.filter(e => e.at >= dayStart && e.at < dayEnd).map(e => e.q));
	return plan.today.every(q => answered.has(q)) ? "done" : "missed";
}
