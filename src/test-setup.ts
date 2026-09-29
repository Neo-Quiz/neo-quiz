/**
 * The pure core of a Test's launch settings ("Set up your test" modal,
 * spec 2026-09-29-test-setup-modal-design.md §1-§2).
 *
 * A Test is ONE file; how it is played is chosen when it is launched: with or
 * without hints, with or without a time limit. An Exam is not a kind of file
 * any more, it is a Test played with hints OFF and a time limit ON. So the
 * "Exam mode" switch stores nothing of its own: `isExamSetup` derives it from
 * the two settings, which makes an inconsistent state (Exam mode on with hints
 * on) impossible to represent.
 *
 * Rules the functions below keep:
 * - turning Exam mode on sets hints off and the time limit on (keeping the
 *   duration already chosen, otherwise the fallback rule);
 * - changing Hints or Time limit afterwards is just a change of those two
 *   settings, and Exam mode turns off by itself when they stop matching;
 * - the duration is a TOTAL in minutes for the whole test, always within
 *   [1, 300] (`clampExamDuration`), and its default is the existing fallback
 *   rule (`fallbackExamDuration`: 1 min 30 per question, rounded to 5). Both
 *   are reused, never re-written, so the modal, the engine, generation and the
 *   editor cannot disagree on the same quiz.
 *
 * No DOM, no host, no `t()`: the modal (Task 3) and the engine (Task 2) call
 * this, it calls nothing of theirs.
 */
import { clampExamDuration, EXAM_DURATION_MIN, fallbackExamDuration } from "./quiz-utils";

export interface TestSetup {
	hints: boolean;
	/** Total duration in minutes within [1, 300]; `null` = no time limit. */
	timeLimitMinutes: number | null;
}

/** Exam mode is on exactly when hints are off AND there is a time limit. */
export function isExamSetup(s: TestSetup): boolean {
	return !s.hints && s.timeLimitMinutes !== null;
}

/** What a quiz never launched opens on: an Exam (hints off, timed) when its
    file says `mode: "exam"`, with the file's duration if it has a valid one,
    else the fallback rule; otherwise a plain Test (hints on, no limit). */
export function defaultTestSetup(examByDefault: boolean, fileDurationMinutes: number | null, questionCount: number): TestSetup {
	if (!examByDefault) return { hints: true, timeLimitMinutes: null };
	return { hints: false, timeLimitMinutes: clampExamDuration(fileDurationMinutes) ?? fallbackExamDuration(questionCount) };
}

/** The Exam mode switch. On: hints off, time limit on (the current duration is
    kept, else the fallback rule). Off: back to a plain Test. */
export function withExamMode(s: TestSetup, on: boolean, questionCount: number): TestSetup {
	if (!on) return { hints: true, timeLimitMinutes: null };
	return { hints: false, timeLimitMinutes: s.timeLimitMinutes ?? fallbackExamDuration(questionCount) };
}

export function withHints(s: TestSetup, hints: boolean): TestSetup {
	return { ...s, hints };
}

/** The Time limit switch and its duration. `null` removes the limit. A number
    is brought within [1, 300] (0 and negatives become 1, above 300 becomes
    300); anything that is not a finite number (NaN, a string a free-value
    field could hand over) gets the fallback rule, so an unusable value never
    reaches the engine. */
export function withTimeLimit(s: TestSetup, minutes: number | null, questionCount: number): TestSetup {
	if (minutes === null) return { ...s, timeLimitMinutes: null };
	const usable = typeof minutes === "number" && Number.isFinite(minutes);
	const clamped = usable ? clampExamDuration(Math.max(minutes, EXAM_DURATION_MIN)) : null;
	return { ...s, timeLimitMinutes: clamped ?? fallbackExamDuration(questionCount) };
}

/** A setting remembered by the app (per quiz), read back from raw settings.
    Anything malformed gives `null`, and the caller then falls back to the
    file's default: a corrupt remembered value must never crash the launch nor
    reach the engine. Decision on doubtful values: `hints` must be a boolean;
    `timeLimitMinutes` must be `null` or a number, so `undefined`, a string or
    a missing key are rejected. A positive number out of range is clamped to
    [1, 300] (a hand-edited 999 still means "a long test"); zero, a negative
    or NaN is rejected as corrupt rather than guessed. Extra keys are dropped. */
export function readTestSetup(raw: unknown): TestSetup | null {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
	const { hints, timeLimitMinutes } = raw as Record<string, unknown>;
	if (typeof hints !== "boolean") return null;
	if (timeLimitMinutes === null) return { hints, timeLimitMinutes: null };
	if (typeof timeLimitMinutes !== "number") return null;
	const minutes = clampExamDuration(timeLimitMinutes);
	return minutes === null ? null : { hints, timeLimitMinutes: minutes };
}

/**
 * What "Keep exam mode" asks of the note when a test starts (spec §2), given
 * what the note says now (`fileKept`: it has `mode: "exam"`; `fileMinutes`: its
 * duration). `undefined` = leave the note alone; `null` = take Exam mode out of
 * it; `{ minutes }` = write `mode: "exam"` with that duration.
 *
 * A test played WITHOUT Exam mode never touches the note, whatever the box
 * says: a one-off practice of an Exam note must not un-keep it (the box is
 * disabled while Exam mode is off, so it can only ever mean "keep" or "stop
 * keeping" for an Exam that is being started).
 *
 * No longer called since the box left the modal (2026-09-29: "Keep exam mode"
 * lives in the quiz menus, `dashboard/exam-keep-menu.ts`); kept, with its
 * checks, as the reviewed rule for a launch that would write the note again.
 */
export function keepExamChange(fileKept: boolean, fileMinutes: number | null, setup: TestSetup, keep: boolean): { minutes: number } | null | undefined {
	if (!isExamSetup(setup)) return undefined;
	if (!keep) return fileKept ? null : undefined;
	const minutes = setup.timeLimitMinutes as number;
	return fileKept && fileMinutes === minutes ? undefined : { minutes };
}

/**
 * The duration "Keep exam mode" writes into a note when it is switched on from
 * a quiz's menu: the duration this quiz was last played with (the app's
 * remembered setup), else the note's own valid `examDurationMinutes`, else the
 * fallback rule for its question count.
 */
export function examMinutesToKeep(rememberedMinutes: number | null, fileMinutes: number | null, questionCount: number): number {
	return clampExamDuration(rememberedMinutes) ?? clampExamDuration(fileMinutes) ?? fallbackExamDuration(questionCount);
}
