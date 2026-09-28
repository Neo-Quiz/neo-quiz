/**
 * THE APPLICATION MENU — the pure tree (`apps/windows/src/ui/menu-app-arbre.ts`).
 * What it prevents: an entry without an id (a click would not know what to
 * do), two equal ids, a scale outside the main process's bounds, a check
 * mark on another step than the current zoom, and a Ctrl + wheel notch that
 * would change nothing (`palierZoomVoisin`).
 *     npm run check:menu-app
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/src/ui/menu-app-arbre.ts", ({ buildMenu, PALIERS_ZOOM, palierZoomVoisin }) => {
	const r = makeReporter("Application menu — tree");
	const menu = buildMenu({ version: "2.5.2", zoom: 1 });
	r.check("three top-level submenus", menu.map(e => e.id), ["app", "edit", "view"]);
	const ids = [];
	const visit = (entries) => { for (const e of entries) { ids.push(e.id); if (e.kind === "submenu") visit(e.items); } };
	visit(menu);
	r.check("no empty id", ids.every(id => typeof id === "string" && id.length > 0), true);
	r.check("no duplicate id", new Set(ids).size, ids.length);
	r.check("the version is the first row of the Neo Quiz submenu",
		menu[0].items[0], { kind: "version", id: "version", label: "2.5.2" });
	r.check("the scale steps have the main process's bounds (0.25..1.5)",
		[Math.min(...PALIERS_ZOOM), Math.max(...PALIERS_ZOOM)], [0.25, 1.5]);
	r.check("the scale steps are sorted, each one larger than the last",
		PALIERS_ZOOM.every((p, i) => i === 0 || p > PALIERS_ZOOM[i - 1]), true);
	const scale = menu[2].items.find(e => e.id === "scale");
	r.check("the check mark is on the current step, and on it alone",
		scale.items.filter(e => e.checked).map(e => e.value), [1]);
	r.check("a zoom between two steps checks nothing",
		buildMenu({ version: "x", zoom: 1.05 })[2].items.find(e => e.id === "scale").items.filter(e => e.checked).length, 0);

	/* ─── THE NEIGHBOUR STEP (Ctrl + wheel) ───
	   What it prevents: a wheel notch that changes nothing because the
	   factor Chromium returns is not exactly the number written, and a notch
	   at the end of the list that would leave the main process's bounds. */
	r.check("one notch up from 100 %", palierZoomVoisin(1, 1), 1.1);
	r.check("one notch down from 100 %", palierZoomVoisin(1, -1), 0.9);
	r.check("at the maximum, up no longer moves", palierZoomVoisin(1.5, 1), 1.5);
	r.check("at the minimum, down no longer moves", palierZoomVoisin(0.25, -1), 0.25);
	r.check("from a value between two steps, up takes the next one", palierZoomVoisin(1.05, 1), 1.1);
	r.check("from a value between two steps, down takes the previous one", palierZoomVoisin(1.05, -1), 1);
	/* `getZoomFactor` returns 1.0999999999999999 for the 1.1 step: a strict
	   comparison would return 1.1 itself, hence a dead notch. */
	r.check("a step's float is not its own neighbour", palierZoomVoisin(1.0999999999999999, 1), 1.25);
	r.check("out of bounds above, back into the list", palierZoomVoisin(2, 1), 1.5);
	r.check("out of bounds below, back into the list", palierZoomVoisin(0.2, -1), 0.25);
	r.check("a value that is not a number counts as 100 %", palierZoomVoisin(Number.NaN, 1), 1.1);
	r.done();
});
