/**
 * THE ZOOM OF A QUIZ PICTURE (`src/engine/image-zoom.ts`), its arithmetic on
 * the real code.
 *
 * What it prevents: a pinch or a wheel that zooms around the corner of the
 * picture instead of under the fingers; a zoom past its bounds or below the
 * fitted size; a picture dragged out of sight, or off-centre when it is
 * smaller than the window; a small picture blown up past twice its pixels.
 * The gestures themselves are checked on screen.
 *
 *     npm run check:image-zoom
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/engine/image-zoom.ts", ({ zoomAutour, ajuster, echelleAjustee, ZOOM_MAX }) => {
	const r = makeReporter("Zoom of a quiz picture");

	r.check("fit: the picture fills the window minus a margin, the limiting side wins",
		[echelleAjustee(1000, 500, 1048, 2000), echelleAjustee(1000, 1000, 2000, 548)], [1, 0.5]);
	r.check("fit: a small picture is enlarged at most twice, a bad size gives 1",
		[echelleAjustee(100, 100, 2000, 2000), echelleAjustee(0, 100, 800, 600)], [2, 1]);

	const v0 = { s: 1, x: 0, y: 0 };
	const z = zoomAutour(v0, 2, 100, 50, 0.5);
	r.check("the point under the fingers stays under them", [z.s, (100 - z.x) / z.s, (50 - z.y) / z.s], [2, 100, 50]);
	r.check("the scale stays between the fit and ZOOM_MAX, and a NaN changes nothing",
		[zoomAutour(v0, 99, 0, 0, 0.5).s, zoomAutour(v0, 0.1, 0, 0, 0.5).s, zoomAutour({ s: 2, x: 0, y: 0 }, NaN, 5, 5, 0.5).s], [ZOOM_MAX, 0.5, 2]);

	r.check("smaller than the window on an axis: centred on it, whatever the drag",
		ajuster({ s: 1, x: 300, y: -40 }, 400, 200, 1000, 800), { s: 1, x: 300, y: 300 });
	r.check("larger than the window: its edges never come inside it",
		[ajuster({ s: 2, x: 50, y: 10 }, 1000, 1000, 800, 600), ajuster({ s: 2, x: -5000, y: -5000 }, 1000, 1000, 800, 600)],
		[{ s: 2, x: 0, y: 0 }, { s: 2, x: -1200, y: -1400 }]);
	r.check("inside its range, a drag is kept as it is", ajuster({ s: 2, x: -300, y: -200 }, 1000, 1000, 800, 600), { s: 2, x: -300, y: -200 });
	r.done();
});
