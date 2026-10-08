/**
 * THE ZOOM OF A QUIZ PICTURE (`src/engine/image-zoom.ts`), its arithmetic on
 * the real code.
 *
 * What it prevents: a pinch or a wheel that zooms around the corner of the
 * picture instead of under the fingers; a zoom that runs past its bounds; a
 * picture dragged out of sight, or that moves at all when it is not zoomed.
 * The gestures themselves are checked on the phone.
 *
 *     npm run check:image-zoom
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/engine/image-zoom.ts", ({ zoomAutour, borner, ZOOM_MIN, ZOOM_MAX }) => {
	const r = makeReporter("Zoom of a quiz picture");
	const v0 = { s: 1, x: 0, y: 0 };

	const z = zoomAutour(v0, 2, 100, 50);
	r.check("the point under the fingers stays under them", [z.s, 100 * z.s + z.x, 50 * z.s + z.y], [2, 100, 50]);
	const z2 = zoomAutour(z, 4, 30, 20);
	const avant = [(30 - z.x) / z.s, (20 - z.y) / z.s];
	r.check("… from an already zoomed view too", [(30 - z2.x) / z2.s, (20 - z2.y) / z2.s], avant);
	r.check("the scale stays within its bounds, and a NaN changes nothing",
		[zoomAutour(v0, 50, 0, 0).s, zoomAutour(v0, 0.1, 0, 0).s, zoomAutour({ s: 2, x: -10, y: -10 }, NaN, 5, 5).s], [ZOOM_MAX, ZOOM_MIN, 2]);
	r.check("at scale 1 the picture does not move", borner({ s: 1, x: 40, y: -30 }, 400, 300), { s: 1, x: 0, y: 0 });
	r.check("zoomed, it is never dragged out of sight", [borner({ s: 2, x: 50, y: 10 }, 400, 300), borner({ s: 2, x: -900, y: -900 }, 400, 300)],
		[{ s: 2, x: 0, y: 0 }, { s: 2, x: -400, y: -300 }]);
	r.check("inside its range, a drag is kept as it is", borner({ s: 3, x: -120, y: -80 }, 400, 300), { s: 3, x: -120, y: -80 });
	r.done();
});
