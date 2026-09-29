import { defaultTestSetup, type TestSetup } from "../test-setup";

/* ══════════════════════════════════════════════════════════
   LAUNCHING A TEST (spec 2026-09-29-test-setup-modal-design.md §3).

   A Test is played with the settings its host asks the player for ("Set up
   your test": hints on/off, time limit). The rules live HERE, apart from
   `engine.ts`, so that `check:engine-review` can hold them without a DOM:
   whether a launch asks at all, what it proposes, what a cancelled modal
   means, what a resumed snapshot brings back, and how a chosen setup lands on
   the engine's context.

   The host is optional. Without it (the Obsidian plugin) a Test keeps
   today's behaviour, driven by the file's `mode: "exam"`.
══════════════════════════════════════════════════════════ */

/** What the host offers the engine: the modal, asked at launch and on "Try again". */
export interface TestSetupHost {
	/** Asks the player for the setup. `null` = cancelled: start nothing. */
	choose(defaults: TestSetup, questionCount: number, examByDefault: boolean): Promise<TestSetup | null>;
}

/** What the engine knows of the file when it launches. */
export interface TestFile {
	/** The file's configuration says `mode: "exam"`. */
	examByDefault: boolean;
	/** Its `examDurationMinutes`, when it has one. */
	durationMinutes: number | null;
	questionCount: number;
}

/** What a snapshot brings back (`session.ts`, `restaurer`). */
export interface ResumedTest {
	setup: TestSetup;
	/** Milliseconds left on the clock when it was paused; `null` without a time limit. */
	msLeft: number | null;
}

export type LaunchPlan =
	/** Play with this setup; `resumed` = it came from a snapshot, no modal was shown. */
	| { kind: "play"; setup: TestSetup; msLeft: number | null; resumed: boolean }
	/** The modal was cancelled: render nothing, the host closes the page. */
	| { kind: "cancelled" };

/** Does this launch go through the host's setup at all? A Learn never does
    (it has no hints to switch off nor a clock), nor a host that offers none. */
export function usesTestSetup(host: TestSetupHost | undefined, isTest: boolean): host is TestSetupHost {
	return !!host && isTest;
}

/** Asks the host, proposing `last` (a "Try again" keeps the settings just
    played) or, at the first launch, what the file says. */
export function askTestSetup(host: TestSetupHost, file: TestFile, last: TestSetup | null): Promise<TestSetup | null> {
	const defaults = last ?? defaultTestSetup(file.examByDefault, file.durationMinutes, file.questionCount);
	return host.choose({ ...defaults }, file.questionCount, file.examByDefault);
}

/** The launch of a Test that USES the setup: a snapshot restores its own
    setup and time left and SKIPS the modal; otherwise the host is asked. */
export async function planLaunch(host: TestSetupHost, file: TestFile, resumed: ResumedTest | null): Promise<LaunchPlan> {
	if (resumed) return { kind: "play", setup: resumed.setup, msLeft: resumed.msLeft, resumed: true };
	const setup = await askTestSetup(host, file, null);
	if (setup === null) return { kind: "cancelled" };
	return { kind: "play", setup, msLeft: null, resumed: false };
}

/** The slice of the engine context a setup lands on. */
export interface SetupTarget {
	isExamMode: boolean;
	hintsOff: boolean;
	examDurationMs: number;
	examTimeRemaining: number;
	examStarted: boolean;
	examEnded: boolean;
	testSetup: TestSetup | null;
}

/** Puts a setup on the context. A time limit IS the engine's Exam clock
    (`isExamMode`), started as soon as the test renders: there is no start
    screen, the modal was the start. `msLeft` is what a paused test has left
    (clamped to the duration); a fresh start gets the whole duration. Hints
    off is its own flag: a timed test may keep its hints. */
export function applyTestSetup(target: SetupTarget, setup: TestSetup, msLeft: number | null): void {
	const timed = setup.timeLimitMinutes !== null;
	const fullMs = timed ? setup.timeLimitMinutes! * 60_000 : 0;
	target.testSetup = { ...setup };
	target.isExamMode = timed;
	target.hintsOff = !setup.hints;
	target.examDurationMs = fullMs;
	target.examTimeRemaining = timed && msLeft !== null && Number.isFinite(msLeft) && msLeft >= 0 ? Math.min(msLeft, fullMs) : fullMs;
	target.examStarted = timed;
	target.examEnded = false;
}
