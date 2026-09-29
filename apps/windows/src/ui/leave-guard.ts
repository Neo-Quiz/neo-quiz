/* ══════════════════════════════════════════════════════════
   THE LEAVING GUARD OF AN EXAM — a PURE core (no DOM, no host).

   Spec docs/superpowers/specs/2026-09-29-test-practice-exam-design.md §3.4:
   leaving a quiz screen while an Exam is started and not handed in asks
   first — "Leave the exam? It will not be saved." — because an abandoned
   Exam leaves no attempt and no review verdict. Every way out of the quiz
   screen (its × button, the mouse's back button) goes through `request`.

   - Nothing to protect (`mustAsk()` false): `leave` runs at once.
   - Otherwise the question is asked, and NOTHING moves until it is
     answered: "Continue the exam" stays, "Leave" leaves. The clock keeps
     running meanwhile (it is the engine's, untouched here).
   - A second request while the question is open is ignored: one question,
     one answer, one departure.

   What would end the quiz screen from OUTSIDE it — a reload (Ctrl+R, the
   View menu, a setting that reloads) — goes through `requestLeave`, which
   asks the guard of the quiz screen on display, if any. The only state of
   this module is that one reference.

   The window's closing is not covered (a native dialog, out of scope), nor
   the Obsidian plugin (a note's closing cannot be intercepted).
══════════════════════════════════════════════════════════ */

export interface LeaveGuard {
	/** Leave now, or after the user agreed; never twice for one question. */
	request(leave: () => void): void;
	/** A question is waiting for its answer. */
	isAsking(): boolean;
}

export function createLeaveGuard(opts: {
	/** An Exam is started and not handed in. Read at each request. */
	mustAsk: () => boolean;
	/** Asks the user; `answer(true)` = leave. Called once per question. */
	ask: (answer: (leave: boolean) => void) => void;
}): LeaveGuard {
	let asking = false;
	return {
		request(leave) {
			if (asking) return;
			if (!opts.mustAsk()) {
				leave();
				return;
			}
			asking = true;
			let answered = false;
			opts.ask((ok) => {
				if (answered) return;
				answered = true;
				asking = false;
				if (ok) leave();
			});
		},
		isAsking: () => asking,
	};
}

let active: LeaveGuard | null = null;

/** The guard of the quiz screen on display; `null` when it goes away. */
export function setActiveLeaveGuard(guard: LeaveGuard | null): void {
	active = guard;
}

/** Clears the active guard only if it is still `guard` (a newer screen may
    have replaced it). */
export function clearActiveLeaveGuard(guard: LeaveGuard): void {
	if (active === guard) active = null;
}

/** Something outside the quiz screen is about to end it (a reload): ask its
    guard, or go at once when no quiz screen is on display. */
export function requestLeave(go: () => void): void {
	if (active) active.request(go);
	else go();
}
