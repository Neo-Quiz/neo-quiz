/**
 * THE PHONE'S MODEL PICKER (`openModelPicker`, src/dashboard/ui-select.ts),
 * on a linkedom DOM. What it prevents: the panel shut at once on the FIRST
 * tap on the pill (2026-10-11, on the phone). The tap blurs the prompt
 * field, the soft keyboard folds, the WebView grows (`resize`) and the
 * page's scrollers shift (`scroll`) right after the panel opened; a picker
 * that closes on those events never stays up. Also held: the rail is drawn
 * even for a single provider, the search field filters the models, the
 * current model carries the check, the panel sits above the pill (by its
 * bottom edge, right-aligned, clamped to the window), and a tap outside,
 * Escape, a pick or a second tap on the pill close it.
 *
 *     npm run check:model-picker
 */
import { parseHTML } from "linkedom";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const { window, document } = parseHTML("<html><body></body></html>");
globalThis.window = window;
globalThis.document = document;
globalThis.HTMLElement = window.HTMLElement;
window.innerWidth = 400;
window.innerHeight = 800;
// Reduced motion: the panel leaves the DOM at once instead of after its 150 ms fade.
window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
const cadres = [];
window.requestAnimationFrame = (f) => { cadres.push(f); return cadres.length; };
window.cancelAnimationFrame = () => {};
const viderCadres = () => { while (cadres.length) cadres.shift()(0); };

await withSrcModule(["src/dashboard/ui-select.ts", "src/host/current.ts"], async (S, H) => {
	const r = makeReporter("Model picker (phone)");
	H.installHost({ ui: { setIcon(el, name) { el.dataset.icon = name; } } });

	// The pill, its box mocked: 300 px from the left edge to 380, its top at 700.
	let boite = { left: 300, right: 380, top: 700, bottom: 732, width: 80, height: 32 };
	const pill = document.createElement("button");
	pill.getBoundingClientRect = () => boite;
	document.body.append(pill);

	const choix = [];
	const ouvrir = () => S.openModelPicker(pill, {
		providers: [{ id: "claude-code", name: "Claude Code", logo: "claude", models: [
			{ id: "opus", label: "Claude Opus 5.5" },
			{ id: "sonnet", label: "Claude Sonnet 5.5" },
			{ id: "haiku", label: "Claude Haiku 5.5" },
		] }],
		selectedProvider: "claude-code",
		selectedModel: "sonnet",
		renderLogo: (el, logo) => { el.dataset.logo = logo; },
		onPick: (p, m) => choix.push([p, m]),
	});
	const panneau = () => document.querySelector(".qbd-model-picker");
	const libelles = () => [...document.querySelectorAll(".qbd-model-picker-row-label")].map(e => e.textContent);

	ouvrir();
	r.check("the panel opens", !!panneau(), true);
	r.check("the rail is drawn for a single provider", document.querySelectorAll(".qbd-model-picker-rail .qbd-model-picker-brand").length, 1);
	r.check("the rail button shows the provider's logo", document.querySelector(".qbd-model-picker-logo")?.dataset.logo, "claude");
	r.check("the search field sits in the right column, above the list",
		[...document.querySelector(".qbd-model-picker-main").children].map(e => e.className),
		["qbd-model-picker-search", "qbd-model-picker-list"]);
	r.check("the search field is a search input with its placeholder",
		[document.querySelector(".qbd-model-picker-search-input")?.type, document.querySelector(".qbd-model-picker-search-input")?.placeholder],
		["search", "Search models"]);
	r.check("the search icon", document.querySelector(".qbd-model-picker-search-icon")?.dataset.icon, "search");
	r.check("every model is listed", libelles(), ["Claude Opus 5.5", "Claude Sonnet 5.5", "Claude Haiku 5.5"]);
	r.check("only the current model carries the check",
		[...document.querySelectorAll(".qbd-model-picker-row")].map(e => e.getAttribute("aria-checked")), ["false", "true", "false"]);

	// Placement: right edge on the pill's right edge, bottom 8 px above the pill's top.
	const p = panneau();
	r.check("above the pill, anchored by its bottom edge", [p.style.top, p.style.bottom], ["auto", "108px"]);
	r.check("right-aligned on the pill", p.style.left, (380 - 310) + "px");
	r.check("never taller than the room above the pill", p.style.maxHeight, "684px");

	// THE FIRST-TAP BUG: the keyboard folds right after the panel opened.
	window.dispatchEvent(new window.Event("scroll"));
	viderCadres();
	r.check("a page scroll does not close the panel", !!panneau(), true);
	boite = { left: 300, right: 380, top: 400, bottom: 432, width: 80, height: 32 };
	window.innerHeight = 500;
	window.dispatchEvent(new window.Event("resize"));
	viderCadres();
	r.check("a resize (the soft keyboard) does not close the panel", !!panneau(), true);
	r.check("a resize moves the panel with the pill", [panneau()?.style.bottom, panneau()?.style.maxHeight], ["108px", "384px"]);
	window.innerHeight = 800;
	boite = { left: 300, right: 380, top: 700, bottom: 732, width: 80, height: 32 };
	// Clamped to the window: a pill on the left edge never pushes the panel past it.
	boite = { left: 0, right: 40, top: 700, bottom: 732, width: 40, height: 32 };
	window.dispatchEvent(new window.Event("resize"));
	viderCadres();
	r.check("clamped to the left edge of the window", panneau()?.style.left, "8px");
	boite = { left: 300, right: 380, top: 700, bottom: 732, width: 80, height: 32 };

	// The search filters the list, ignoring case.
	const champ = document.querySelector(".qbd-model-picker-search-input");
	champ.value = "SONNET";
	champ.dispatchEvent(new window.Event("input"));
	r.check("the search filters the models", libelles(), ["Claude Sonnet 5.5"]);
	champ.value = "";
	champ.dispatchEvent(new window.Event("input"));
	r.check("an empty search lists every model again", libelles().length, 3);

	// Mousedown inside the panel or on the pill does not close.
	champ.dispatchEvent(new window.Event("mousedown", { bubbles: true }));
	r.check("a press inside the panel keeps it open", !!panneau(), true);

	// A pick closes and reports provider and model.
	document.querySelectorAll(".qbd-model-picker-row")[0].dispatchEvent(new window.Event("click"));
	r.check("a pick reports provider and model", choix, [["claude-code", "opus"]]);
	r.check("a pick closes the panel", !!panneau(), false);

	// A press outside closes.
	ouvrir();
	document.body.dispatchEvent(new window.Event("mousedown", { bubbles: true }));
	r.check("a press outside closes", !!panneau(), false);

	// Escape closes.
	ouvrir();
	document.dispatchEvent(Object.assign(new window.Event("keydown", { bubbles: true }), { key: "Escape" }));
	r.check("Escape closes", !!panneau(), false);

	// A second tap on the pill closes instead of reopening.
	ouvrir();
	ouvrir();
	r.check("a second tap on the pill closes it", !!panneau(), false);

	// No listener left behind: after closing, a scroll and a resize do nothing (and do not throw).
	window.dispatchEvent(new window.Event("resize"));
	viderCadres();
	r.check("nothing reopens after a close", !!panneau(), false);

	r.done();
});
