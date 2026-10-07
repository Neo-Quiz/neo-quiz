/**
 * The STRETCH at the ends of a scrolling box (`apps/windows/src/ui/overscroll-stretch.ts`):
 * the pure rules the touch handler applies. The DOM part is not held here.
 *     npm run check:overscroll
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/src/ui/overscroll-stretch.ts", ({ stretchAmount, scrollableOn, atPullEdge, mayStretch, MAX_STRETCH, HALF_PULL }) => {
	const r = makeReporter("Overscroll stretch");
	// The constants the owner tuned: a change must be a deliberate one.
	r.check("maximum stretch is 18 %", MAX_STRETCH, 0.18);
	r.check("half the maximum at 35 % of the viewport", HALF_PULL, 0.35);
	// The stretch curve.
	r.check("no pull, no stretch", stretchAmount(0, 1000), 0);
	r.check("a pull the wrong way does not stretch", stretchAmount(-80, 1000), 0);
	r.check("no viewport, no stretch", stretchAmount(100, 0), 0);
	r.check("half the maximum at HALF_PULL × viewport", Math.abs(stretchAmount(350, 1000) - 0.09) < 1e-12, true);
	r.check("the curve depends on the pull relative to the viewport", Math.abs(stretchAmount(200, 2000) - stretchAmount(100, 1000)) < 1e-12, true);
	r.check("never past the maximum, even for a huge pull", stretchAmount(1e6, 1000) < 0.18, true);
	r.check("close to the maximum for a huge pull", stretchAmount(1e6, 1000) > 0.17, true);
	let monotone = true;
	for (let p = 1; p < 5000; p += 7) if (!(stretchAmount(p + 7, 800) > stretchAmount(p, 800))) monotone = false;
	r.check("the stretch grows with the pull", monotone, true);
	// Which boxes can stretch on an axis.
	r.check("an auto box with more content scrolls", scrollableOn("auto", 100, 300), true);
	r.check("a scroll box with more content scrolls", scrollableOn("scroll", 100, 300), true);
	r.check("a visible box never scrolls", scrollableOn("visible", 100, 300), false);
	r.check("a hidden box never scrolls", scrollableOn("hidden", 100, 300), false);
	r.check("an auto box that fits does not scroll", scrollableOn("auto", 100, 100), false);
	// Which boxes may be stretched at all.
	r.check("a fixed bar is never stretched", mayStretch("fixed", "none"), false);
	r.check("a box with a transform running is left alone", mayStretch("static", "matrix(1, 0, 0, 1, 0, 4)"), false);
	r.check("an ordinary box may be stretched", mayStretch("relative", "none"), true);
	r.check("an absolute box may be stretched", mayStretch("absolute", "none"), true);
	// Whether the scroll is at the edge the finger pulls toward.
	r.check("at the top, pulling down", atPullEdge(0, 100, 300, 5), true);
	r.check("at the top, pulling up is not an edge", atPullEdge(0, 100, 300, -5), false);
	r.check("at the bottom, pulling up", atPullEdge(200, 100, 300, -5), true);
	r.check("at the bottom, pulling down is not an edge", atPullEdge(200, 100, 300, 5), false);
	r.check("one px short of the bottom still counts", atPullEdge(199, 100, 300, -5), true);
	r.check("in the middle, no edge", atPullEdge(100, 100, 300, 5), false);
	r.check("in the middle, no edge upward", atPullEdge(100, 100, 300, -5), false);
	r.check("no movement, no edge", atPullEdge(0, 100, 300, 0), false);
	r.done();
});
