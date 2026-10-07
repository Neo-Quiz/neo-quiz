/* ══════════════════════════════════════════════════════════
   VIEW ENTER: the ENTER transition of a dashboard view.
   Extracted from quizzes.ts on 2026-07-28 so that Home plays the same entry
   as "My quizzes" without copying the trap below.
══════════════════════════════════════════════════════════ */

/** The running animations of the view that can still end. An animation with
    infinite iterations is never an entry (see below). */
function finiteRunning(container: HTMLElement): CSSAnimation[] {
	return container.getAnimations({ subtree: true })
		.filter((a): a is CSSAnimation => a instanceof CSSAnimation && a.playState === "running"
			&& a.effect?.getTiming().iterations !== Infinity);
}

/** Sets (or removes) the enter class on a view's container. `entering` is
    `true` only when the view is ARRIVED ON: an internal re-render (rename,
    archive, stats reset) must never replay the animation, and `toggle(force)`
    guarantees that no stale class survives such a render.

    The class MUST drop once the entry has played: a CSSAnimation in
    `fill: both` with a `transform` keyframe stays the owner of the property
    even when finished, so transform transitions (the cards' lift on hover)
    no longer fire and the lift jumps in one frame.

    IT ONLY WAITS FOR WHAT CAN END. A folder's path scrolls in an infinite
    loop in its card footer; waiting for "no animation left running in the
    view" meant waiting forever, and the trap of the previous paragraph came
    back through another door: folder cards jumped on hover, quiz cards (in
    an open folder, no scrolling rail) slid. An infinite animation is never an
    entry. `npm run check:view-enter` holds this case, and the `fill:
    backwards` of the entry rules is the second guard: even if the class
    stayed, nothing would hold `transform`.

    ONE FLUSH PER PHASE, NOT ONE PER CARD (phone audit, 2026-10-07).
    `getAnimations({ subtree: true })` flushes style for the whole subtree.
    Called at every `animationend`, a page of 20 staggered cards ran it 20
    times WHILE the entry was still playing: 50 to 100 ms long tasks, one
    every card, measured under a 6x CPU slowdown. The first `animationend`
    takes the list of animations still to wait for; the following events only
    read their `playState`, which flushes nothing; a last
    `getAnimations` call confirms the end (it also catches an animation born
    meanwhile, such as a late-rendered card). */
export function markViewEnter(container: HTMLElement, entering: boolean, cls: string): void {
	container.classList.toggle(cls, entering);
	if (!entering) return;
	let waiting: CSSAnimation[] = [];
	const onEnd = (ev: AnimationEvent): void => {
		if (!ev.animationName.startsWith("qbd-")) return;
		if (waiting.some(a => a.playState === "running")) return;
		waiting = finiteRunning(container);
		if (waiting.length > 0) return;
		container.classList.remove(cls);
		container.removeEventListener("animationend", onEnd);
	};
	container.addEventListener("animationend", onEnd);
}
