/* ══════════════════════════════════════════════════════════
   THE LEARN RETRY LOOP, PURE (2026-09-29, spec
   docs/superpowers/specs/2026-09-28-learn-retry-design.md).

   In a Learn quiz each question is checked on its own card. A question
   missed on its first check is QUEUED and comes back at the END, once the
   last question is passed. Until 2026-10-08 it came back two checks later
   or when its step was left: the learner was sent back mid-quiz, between
   two swipes, with no idea why, which broke their focus. Right on a retry, it is
   "retried" (orange); wrong again, it goes back in the queue, three retries
   at most, after which it stays "missed" (red) and leaves the queue: the
   spaced scheduler brings it back in a later session, where the evidence
   puts the gain. The learner is never stuck.

   No DOM, no engine context: the engine owns the arrays (quizState) and
   passes the two facts this module cannot know — the step of a question
   and the question that follows it in the normal order.
   `npm run check:learn-loop`.
   ══════════════════════════════════════════════════════════ */

import type { LearnResume, LearnVerdict, QuizState } from "../types/quiz";

export const LEARN_VERDICTS: readonly LearnVerdict[] = ["none", "first", "retried", "missed"];

/** The part of the quiz state this module reads and writes (types/quiz.ts). */
export type LearnLoopState = Pick<QuizState,
	"learnVerdicts" | "learnMisses" | "learnRetrying" | "learnChecked" | "learnPending" | "learnQueue" | "learnResume" | "learnRetryQi">;

/** Retries per question and session: the third miss of a retry gives up. */
export const MAX_RETRIES = 3;

export function emptyLearnState(n: number): LearnLoopState {
	return {
		learnVerdicts: new Array<LearnVerdict>(n).fill("none"),
		learnMisses: new Array<number>(n).fill(0),
		learnRetrying: new Array<boolean>(n).fill(false),
		learnChecked: new Array<boolean>(n).fill(false),
		learnPending: new Array<boolean>(n).fill(false),
		learnQueue: [],
		learnResume: null,
		learnRetryQi: null,
	};
}

/** What a check did: the verdict, and whether the question left the loop
    without being right (`gaveUp`, three retries missed). */
export interface LearnCheckOutcome {
	verdict: LearnVerdict;
	/** This check was the question's FIRST: the only one the review log keeps. */
	firstCheck: boolean;
	queued: boolean;
	gaveUp: boolean;
}

/**
 * Records the check of a graded question. Returns `null` when the current
 * attempt was already checked (a double click, a second press of the
 * arrow): a verdict is given once per attempt.
 */
export function applyCheck(s: LearnLoopState, qi: number, correct: boolean): LearnCheckOutcome | null {
	if (s.learnChecked[qi] && !s.learnRetrying[qi] && !s.learnPending[qi]) return null;
	const firstCheck = s.learnVerdicts[qi] === "none";
	s.learnRetrying[qi] = false;
	s.learnPending[qi] = false;
	s.learnChecked[qi] = true;
	s.learnQueue = s.learnQueue.filter(e => e.qi !== qi);
	for (const e of s.learnQueue) e.since++;
	if (correct) {
		s.learnVerdicts[qi] = s.learnMisses[qi] > 0 ? "retried" : "first";
		return { verdict: s.learnVerdicts[qi], firstCheck, queued: false, gaveUp: false };
	}
	s.learnMisses[qi]++;
	s.learnVerdicts[qi] = "missed";
	// Misses 1..3 are followed by retries 1..3; the fourth miss gives up.
	const queued = s.learnMisses[qi] <= MAX_RETRIES;
	if (queued) s.learnQueue.push({ qi, since: 0 });
	return { verdict: "missed", firstCheck, queued, gaveUp: !queued };
}

/** A check that gives no verdict (a `pre` question: its answer is shown,
    the attempt is the point, never right or wrong). */
export function applyNeutralCheck(s: LearnLoopState, qi: number): void {
	s.learnChecked[qi] = true;
}

/** A written answer is checked: its card shows the model answer, and the
    verdict waits for the learner's own rating (`applyCheck` then accepts
    it once). */
export function revealForSelfRating(s: LearnLoopState, qi: number): void {
	s.learnChecked[qi] = true;
	s.learnPending[qi] = true;
}

export type LearnMove =
	| { kind: "retry"; qi: number; resume: Exclude<LearnResume, null> }
	| { kind: "go"; qi: number | null };

/**
 * Where "next" leads from question `current`. The normal target is the
 * resume point when the learner is away on a retry, else the question after
 * `current` (`null` past the last). Queued questions come back only past the
 * last question, in the order they were missed; never in the middle of the
 * quiz. One missed on the last card comes back too, as the last thing left.
 */
export function nextLearnMove(
	s: LearnLoopState,
	current: number,
	next: (qi: number) => number | null,
): LearnMove {
	/* A retry left WITHOUT being checked (the learner jumped away by a bead
	   or the previous arrow) goes back in the queue: it is not lost, and it
	   is not red forever for want of a second chance. */
	s.learnRetrying.forEach((retrying, qi) => {
		if (retrying && qi !== current && !s.learnChecked[qi] && !s.learnQueue.some(e => e.qi === qi)) {
			s.learnQueue.push({ qi, since: 0 });
		}
	});
	// The resume point only holds on the retried card itself.
	const away = s.learnResume !== null && s.learnRetryQi === current;
	if (!away) s.learnResume = null;
	const target = away ? (s.learnResume === "end" ? null : s.learnResume as number) : next(current);
	const pick = target === null ? s.learnQueue.find(e => e.qi !== current) ?? s.learnQueue[0] : undefined;
	if (pick) return { kind: "retry", qi: pick.qi, resume: "end" };
	return { kind: "go", qi: target };
}

/** The learner arrives on a queued question: it leaves the queue and opens
    again (the engine clears its answer and reshuffles its options). */
export function beginRetry(s: LearnLoopState, qi: number, resume: Exclude<LearnResume, null>): void {
	s.learnQueue = s.learnQueue.filter(e => e.qi !== qi);
	s.learnRetrying[qi] = true;
	s.learnChecked[qi] = false;
	s.learnPending[qi] = false;
	s.learnResume = resume;
	s.learnRetryQi = qi;
}

/** The learner is back in the normal order. */
export function resumeNormalOrder(s: LearnLoopState): void {
	s.learnResume = null;
	s.learnRetryQi = null;
}

export interface LearnSummary {
	first: number;
	retried: number;
	missed: number;
}

/** The three numbers of the results screen, over the graded questions. */
export function learnSummary(s: LearnLoopState, graded: readonly number[]): LearnSummary {
	const out: LearnSummary = { first: 0, retried: 0, missed: 0 };
	for (const qi of graded) {
		const v = s.learnVerdicts[qi];
		if (v === "first") out.first++;
		else if (v === "retried") out.retried++;
		else if (v === "missed") out.missed++;
	}
	return out;
}
