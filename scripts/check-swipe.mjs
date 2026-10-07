/**
 * The SWIPE decision (`src/swipe.ts`): a horizontal swipe changes page
 * like the arrows, and a vertical scroll that drifts sideways never does.
 *     npm run check:swipe
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/swipe.ts", ({ decideSwipe, nextTab, lockAxis, followOffset, releaseVelocity, releaseVerdict, settleDuration }) => {
	const r = makeReporter("Swipe between pages");
	const base = { dx: -80, dy: 10, ms: 200, startX: 200, viewportWidth: 400,
		inHorizontalScroller: false, inTextField: false, modalOpen: false };
	const d = (over) => decideSwipe({ ...base, ...over });

	r.check("left swipe goes to the next page", d({}), "next");
	r.check("right swipe goes to the previous page", d({ dx: 80 }), "prev");
	r.check("too short (50 px) does nothing", d({ dx: -50 }), "none");
	r.check("not twice as wide as tall does nothing", d({ dy: 50 }), "none");
	r.check("too slow (700 ms) does nothing", d({ ms: 700 }), "none");
	r.check("starting in the left edge zone does nothing", d({ startX: 10 }), "none");
	r.check("starting in the right edge zone does nothing", d({ startX: 390 }), "none");
	r.check("inside a horizontal scroller does nothing", d({ inHorizontalScroller: true }), "none");
	r.check("in a text field does nothing", d({ inTextField: true }), "none");
	r.check("with a modal open does nothing", d({ modalOpen: true }), "none");
	r.check("a vertical scroll drifting sideways does nothing", d({ dx: -50, dy: 300 }), "none");
	const tabs = ["home", "quizzes", "settings"];
	r.check("next tab from home is folders", nextTab("home", "next", tabs), "quizzes");
	r.check("previous tab from folders is home", nextTab("quizzes", "prev", tabs), "home");
	r.check("previous before the first tab clamps", nextTab("home", "prev", tabs), null);
	r.check("next past the last tab clamps", nextTab("settings", "next", tabs), null);
	r.check("a hidden tab is skipped", nextTab("quizzes", "next", tabs), "settings");
	r.check("an unknown current tab goes nowhere", nextTab("detail", "next", tabs), null);
	// Finger following.
	r.check("under the slop stays pending", lockAxis(6, 3), "pending");
	r.check("horizontal past the slop locks h", lockAxis(-14, 4), "h");
	r.check("vertical past the slop locks v", lockAxis(4, 14), "v");
	r.check("a diagonal favouring y locks v", lockAxis(11, 12), "v");
	r.check("possible move follows 1:1", followOffset(-80, true), -80);
	r.check("an end resists at 0.3", followOffset(-100, false), -30);
	r.check("velocity over the last 100 ms", releaseVelocity([{ x: 0, t: 0 }, { x: 50, t: 200 }, { x: 80, t: 250 }, { x: 120, t: 300 }]), 0.7);
	r.check("a lone sample has no velocity", releaseVelocity([{ x: 0, t: 0 }]), 0);
	r.check("fast fling commits a short drag", releaseVerdict(-40, -0.6, 400, true), "next");
	r.check("slow short drag springs back", releaseVerdict(-60, -0.1, 400, true), "none");
	r.check("slow drag past 40 % commits", releaseVerdict(170, 0.05, 400, true), "prev");
	r.check("fast fling against the drag does not commit", releaseVerdict(-40, 0.6, 400, true), "none");
	r.check("a twitch (5 px) never commits by velocity", releaseVerdict(-5, -2, 400, true), "none");
	r.check("an end never commits", releaseVerdict(-300, -2, 400, false), "none");
	r.check("settle is 300 ms from far", settleDuration(400, 400), 300);
	r.check("settle is shorter when close", settleDuration(40, 400), 192);
	r.done();
});
