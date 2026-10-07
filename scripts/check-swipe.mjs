/**
 * The SWIPE decision (`src/swipe.ts`): a horizontal swipe changes page
 * like the arrows, and a vertical scroll that drifts sideways never does.
 *     npm run check:swipe
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/swipe.ts", ({ decideSwipe, nextTab }) => {
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
	r.done();
});
