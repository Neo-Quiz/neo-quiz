/**
 * THE APPLICATION MENU — the pure tree (`apps/windows/src/ui/menu-app-arbre.ts`).
 * What it prevents: an entry without an id (a click would not know what to
 * do), two equal ids, a scale outside the main process's bounds, and a
 * Ctrl + wheel notch that would change nothing (`palierZoomVoisin`).
 *     npm run check:menu-app
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["apps/windows/src/ui/menu-app-arbre.ts", "apps/windows/electron/pont.ts"], ({ buildMenu, PALIERS_ZOOM, palierZoomVoisin }, { ZOOM_MIN, ZOOM_MAX, borneZoom }) => {
	const r = makeReporter("Application menu — tree");
	const menu = buildMenu({ version: "2.5.2" });
	r.check("the about row, a rule, then the Display submenu (no Edit)", menu.map(e => e.id), ["about", "about-sep", "view"]);
	const ids = [];
	const visit = (entries) => { for (const e of entries) { ids.push(e.id); if (e.kind === "submenu") visit(e.items); } };
	visit(menu);
	r.check("no empty id", ids.every(id => typeof id === "string" && id.length > 0), true);
	r.check("no duplicate id", new Set(ids).size, ids.length);
	r.check("the version is on the menu's first row, and no Settings line is left",
		[menu[0].kind, menu[0].version, ids.includes("settings")], ["about", "2.5.2", false]);
	r.check("the scale steps have the main process's bounds (0.75..1.5)",
		[Math.min(...PALIERS_ZOOM), Math.max(...PALIERS_ZOOM)], [0.75, 1.5]);
	r.check("the first and last steps ARE the main process's bounds (electron/pont.ts)",
		[PALIERS_ZOOM[0], PALIERS_ZOOM[PALIERS_ZOOM.length - 1]], [ZOOM_MIN, ZOOM_MAX]);
	/* A zoom saved before the minimum was raised (25 %, 50 %) is clamped,
	   never ignored: ignored, the page opened at 100 % while the bubble and
	   the check mark believed the saved value. */
	r.check("a saved zoom below the minimum comes back at the minimum", [borneZoom(0.25), borneZoom(0.5)], [0.75, 0.75]);
	r.check("above the maximum, the maximum; not a number, 100 %", [borneZoom(3), borneZoom("x"), borneZoom(Number.NaN)], [1.5, 1, 1]);
	r.check("the scale steps are sorted, each one larger than the last",
		PALIERS_ZOOM.every((p, i) => i === 0 || p > PALIERS_ZOOM[i - 1]), true);
	r.check("the Display submenu no longer carries an interface scale",
		menu[2].items.map(e => e.id), ["change-wallpaper", "view-sep", "reload", "fullscreen", "devtools"]);

	/* ─── THE NEIGHBOUR STEP (Ctrl + wheel) ───
	   What it prevents: a wheel notch that changes nothing because the
	   factor Chromium returns is not exactly the number written, and a notch
	   at the end of the list that would leave the main process's bounds. */
	r.check("one notch up from 100 %", palierZoomVoisin(1, 1), 1.1);
	r.check("one notch down from 100 %", palierZoomVoisin(1, -1), 0.9);
	r.check("at the maximum, up no longer moves", palierZoomVoisin(1.5, 1), 1.5);
	r.check("at the minimum, down no longer moves", palierZoomVoisin(0.75, -1), 0.75);
	r.check("from a value between two steps, up takes the next one", palierZoomVoisin(1.05, 1), 1.1);
	r.check("from a value between two steps, down takes the previous one", palierZoomVoisin(1.05, -1), 1);
	/* `getZoomFactor` returns 1.0999999999999999 for the 1.1 step: a strict
	   comparison would return 1.1 itself, hence a dead notch. */
	r.check("a step's float is not its own neighbour", palierZoomVoisin(1.0999999999999999, 1), 1.25);
	r.check("out of bounds above, back into the list", palierZoomVoisin(2, 1), 1.5);
	r.check("out of bounds below, back into the list", palierZoomVoisin(0.2, -1), 0.75);
	r.check("a value that is not a number counts as 100 %", palierZoomVoisin(Number.NaN, 1), 1.1);
	r.done();
});
