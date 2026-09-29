/**
 * The pure core of a Test's launch settings, read through the real module
 * `src/test-setup.ts` (spec 2026-09-29-test-setup-modal-design.md §1).
 *
 * What it prevents: Exam mode that survives a change of Hints or Time limit
 * (it must be on exactly when hints are off AND a time limit is set); turning
 * Exam mode on without a timer; a duration outside [1, 300] or not a number
 * reaching the engine; a remembered value from the settings that is malformed
 * being trusted instead of falling back to the file's default.
 *
 *     npm run check:test-setup
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/test-setup.ts", ({ isExamSetup, defaultTestSetup, withExamMode, withHints, withTimeLimit, readTestSetup, keepExamChange }) => {
	const r = makeReporter("Test setup (pure core)");

	/* Defaults: a plain Test, or an Exam when the file says so. */
	r.check("default, not an exam: hints on, no time limit",
		defaultTestSetup(false, 45, 20), { hints: true, timeLimitMinutes: null });
	r.check("default exam with the file's duration (45)",
		defaultTestSetup(true, 45, 20), { hints: false, timeLimitMinutes: 45 });
	r.check("default exam without a duration, 20 questions: fallback rule = 30",
		defaultTestSetup(true, null, 20), { hints: false, timeLimitMinutes: 30 });
	r.check("default exam: the file's duration is clamped to [1, 300], an unusable one gets the fallback",
		[defaultTestSetup(true, 999, 20), defaultTestSetup(true, 0, 20)].map(s => s.timeLimitMinutes), [300, 30]);

	/* The Exam-mode rule. */
	const plain = { hints: true, timeLimitMinutes: null };
	r.check("isExamSetup: only hints off AND a time limit",
		[isExamSetup({ hints: false, timeLimitMinutes: 30 }), isExamSetup({ hints: true, timeLimitMinutes: 30 }),
			isExamSetup({ hints: false, timeLimitMinutes: null }), isExamSetup(plain)], [true, false, false, false]);
	const on = withExamMode(plain, true, 20);
	r.check("Exam mode on: hints off + timer set (fallback for 20 questions = 30)", on, { hints: false, timeLimitMinutes: 30 });
	r.check("Exam mode on is an exam", isExamSetup(on), true);
	r.check("Exam mode on keeps a duration already chosen",
		withExamMode({ hints: true, timeLimitMinutes: 90 }, true, 20), { hints: false, timeLimitMinutes: 90 });
	r.check("Exam mode off: hints on, no time limit", withExamMode(on, false, 20), { hints: true, timeLimitMinutes: null });
	r.check("Hints back on after Exam mode: no longer an exam, the timer stays",
		[isExamSetup(withHints(on, true)), withHints(on, true).timeLimitMinutes], [false, 30]);
	r.check("Time limit removed after Exam mode: no longer an exam, hints stay off",
		[isExamSetup(withTimeLimit(on, null, 20)), withTimeLimit(on, null, 20)], [false, { hints: false, timeLimitMinutes: null }]);
	r.check("Exam mode on again after either change: hints off + time on (the timer kept, else fallback)",
		[withExamMode(withHints(on, true), true, 20), withExamMode(withTimeLimit(on, null, 20), true, 20)],
		[{ hints: false, timeLimitMinutes: 30 }, { hints: false, timeLimitMinutes: 30 }]);
	r.check("withHints and withTimeLimit change one field only",
		[withHints({ hints: false, timeLimitMinutes: 45 }, true), withTimeLimit({ hints: false, timeLimitMinutes: 45 }, 60, 20)],
		[{ hints: true, timeLimitMinutes: 45 }, { hints: false, timeLimitMinutes: 60 }]);
	r.check("the input is never mutated",
		(() => { const s = { hints: true, timeLimitMinutes: null }; withExamMode(s, true, 20); withHints(s, false); withTimeLimit(s, 10, 20); return s; })(),
		{ hints: true, timeLimitMinutes: null });

	/* The duration: a whole number of minutes within [1, 300], or the fallback. */
	r.check("time limit: 0 -> 1, 301 -> 300, 45.4 -> 45, 1 and 300 stay",
		[0, 301, 45.4, 1, 300, -7].map(m => withTimeLimit(plain, m, 20).timeLimitMinutes), [1, 300, 45, 1, 300, 1]);
	r.check("time limit: NaN, Infinity or a non-number -> fallback rule on the question count (20 -> 30, 10 -> 15)",
		[withTimeLimit(plain, NaN, 20), withTimeLimit(plain, Infinity, 20), withTimeLimit(plain, "45", 20), withTimeLimit(plain, undefined, 10)].map(s => s.timeLimitMinutes),
		[30, 30, 30, 15]);

	/* A remembered value: anything malformed is null. Decision: a positive
	   duration out of range is CLAMPED; zero, negative, NaN, non-number or a
	   missing key is corrupt and rejected (the caller uses the file default). */
	r.check("remembered: a valid value round-trips, timed or not",
		[readTestSetup({ hints: false, timeLimitMinutes: 45 }), readTestSetup({ hints: true, timeLimitMinutes: null })],
		[{ hints: false, timeLimitMinutes: 45 }, { hints: true, timeLimitMinutes: null }]);
	r.check("remembered: JSON round trip of every reachable state",
		[plain, on, withHints(on, true), withTimeLimit(plain, 60, 20)].map(s => readTestSetup(JSON.parse(JSON.stringify(s)))),
		[plain, on, withHints(on, true), withTimeLimit(plain, 60, 20)]);
	r.check("remembered: not an object -> null",
		[null, undefined, "x", 3, true, [], [true, null]].map(readTestSetup), [null, null, null, null, null, null, null]);
	r.check("remembered: hints not a boolean -> null",
		[{ hints: "yes", timeLimitMinutes: null }, { timeLimitMinutes: null }, { hints: 1, timeLimitMinutes: null }, { hints: null, timeLimitMinutes: 30 }].map(readTestSetup),
		[null, null, null, null]);
	r.check("remembered: time limit missing, a string or a non-number -> null",
		[{ hints: true }, { hints: true, timeLimitMinutes: "45" }, { hints: true, timeLimitMinutes: {} }, { hints: true, timeLimitMinutes: true }].map(readTestSetup),
		[null, null, null, null]);
	r.check("remembered: zero, negative, NaN, Infinity -> null (corrupt, not guessed)",
		[{ hints: true, timeLimitMinutes: -3 }, { hints: true, timeLimitMinutes: 0 }, { hints: true, timeLimitMinutes: NaN }, { hints: true, timeLimitMinutes: Infinity }].map(readTestSetup),
		[null, null, null, null]);
	r.check("remembered: a positive duration out of range is clamped; a fraction is rounded",
		[{ hints: false, timeLimitMinutes: 999 }, { hints: false, timeLimitMinutes: 0.4 }, { hints: false, timeLimitMinutes: 44.6 }].map(readTestSetup),
		[{ hints: false, timeLimitMinutes: 300 }, { hints: false, timeLimitMinutes: 1 }, { hints: false, timeLimitMinutes: 45 }]);
	r.check("remembered: extra keys are dropped", readTestSetup({ hints: true, timeLimitMinutes: null, mode: "exam", x: 1 }), plain);

	/* "Keep exam mode": when the note is written (undefined = never, null =
	   remove, { minutes } = write). */
	const timed = { hints: false, timeLimitMinutes: 45 };
	r.check("keep: a test played without Exam mode never touches the note, kept or not, box checked or not",
		[keepExamChange(true, 45, plain, true), keepExamChange(true, 45, plain, false), keepExamChange(false, null, plain, true),
			keepExamChange(true, 45, { hints: true, timeLimitMinutes: 45 }, false), keepExamChange(true, 45, { hints: false, timeLimitMinutes: null }, false)],
		[undefined, undefined, undefined, undefined, undefined]);
	r.check("keep: Exam mode with the box checked writes a note that is not kept yet, with the duration played",
		keepExamChange(false, null, timed, true), { minutes: 45 });
	r.check("keep: a kept note played with another duration is rewritten with it",
		keepExamChange(true, 30, timed, true), { minutes: 45 });
	r.check("keep: a kept note played as it is stays untouched",
		keepExamChange(true, 45, timed, true), undefined);
	r.check("keep: unchecking the box on a kept note takes Exam mode out; on a note that is not kept, nothing",
		[keepExamChange(true, 45, timed, false), keepExamChange(false, null, timed, false)], [null, undefined]);
	r.done();
});
