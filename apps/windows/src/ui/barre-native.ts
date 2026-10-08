/* ══════════════════════════════════════════════════════════
   THE NATIVE BOTTOM BAR (Android phone, T13e)

   The Android 12 stretch overscroll is drawn over the WHOLE WebView, so a bar
   fixed inside the page stretched along with the content. Neo Calendar's bar
   does not move: it is outside the scrolling view. Here the page keeps being
   the source of truth for the bar (the four buttons of the rail, their labels,
   which one is active, whether the bar shows at all, its colours) and publishes
   it to Kotlin (`neoPlatform.barre`, drawn by `NavBarView.kt`), which draws it
   under the WebView; a tap comes back as the index of the button, and this
   module clicks it. The page's own bar is hidden (`mobile.css`, `.nq-bar-native`).

   ICONS are drawn by Kotlin (Material Symbols Rounded vector drawables,
   outlined / filled); the page only sends each tab's id and the colours.

   COLOURS: `texte` is the page's normal text colour (inactive icon and label),
   `accent` the app's interactive accent (active icon), `accentTexte` its accent
   text colour (active label). They are resolved by the browser from the theme
   variables, so `color-mix()` and the like come out as plain rgb().
   `muted` and `active` are the rail's own colours, kept for older Kotlin builds.
══════════════════════════════════════════════════════════ */

interface PontBarre {
	barre(etat: unknown): void;
	surBarreClic(rappel: (index: number) => void): void;
}

import { nextTab } from "../../../../src/swipe";
import { PHONE_LAYOUT_QUERY } from "../../../../src/phone-layout";

const ACTIVE = "qbd-nav-item--active";
const PLACEHOLDER = "qbd-nav-item--placeholder";
const MODAL_CLOSE = ".modal-container .modal-close-button";
const SETTINGS_MODAL = ".modal-container .nq-reglages-modal";

/** The Settings button is the only rail button without a `data-nav` key. */
function estReglages(btn: HTMLElement): boolean {
	return !btn.dataset.nav;
}

function boutons(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>(".qbd-sidebar .qbd-nav-item"));
}

/** The key of a rail button: its `data-nav`, or `settings` for the footer button. */
function cle(btn: HTMLElement): string {
	return btn.dataset.nav ?? "settings";
}

/** The text colour of a rail button in the given state, from an offscreen clone's computed style. */
function couleur(btn: HTMLElement | undefined, active: boolean): string {
	if (!btn) return "";
	const clone = btn.cloneNode(false) as HTMLElement;
	clone.style.setProperty("position", "absolute", "important");
	clone.style.setProperty("visibility", "hidden", "important");
	btn.parentElement?.append(clone);
	try {
		clone.classList.toggle(ACTIVE, active);
		return getComputedStyle(clone).color;
	} finally {
		clone.remove();
	}
}

/** The one probe that resolves theme variables. It is created once and never
    removed: a probe appended to and removed from <body> on every publish was a
    childList mutation that the body observer below turned into the next publish,
    every frame, forever (60 to 90 ms a frame on a still page, 2026-10-07).
    Changing its inline `color` is an attribute mutation no observer watches. */
let sondeCouleur: HTMLSpanElement | null = null;

/** A theme variable as the browser computes it (a plain `rgb()` / `rgba()` string). */
function resoudre(variable: string): string {
	if (!sondeCouleur || !sondeCouleur.isConnected) {
		sondeCouleur = document.createElement("span");
		sondeCouleur.setAttribute("aria-hidden", "true");
		sondeCouleur.style.setProperty("position", "absolute");
		sondeCouleur.style.setProperty("visibility", "hidden");
		sondeCouleur.style.setProperty("pointer-events", "none");
		document.body.append(sondeCouleur);
	}
	sondeCouleur.style.setProperty("color", `var(${variable})`);
	return getComputedStyle(sondeCouleur).color;
}

export function installBarreNative(pont: PontBarre): void {
	let envoye = "";
	let dernier = "";
	let encours = false;
	let replanifie = false;

	/* `actifForce`: the tab the user just chose, published before the page
	   changes (see the click and swipe listeners below). Without it the active
	   tab is read from the page. */
	const publier = async (actifForce?: string): Promise<void> => {
		if (encours) { replanifie = true; return; }
		encours = true;
		try {
			const barre = document.querySelector<HTMLElement>(".qbd-sidebar");
			const visible = document.body.classList.contains("is-mobile") && !!barre && !document.querySelector("#neo-quiz-root > .qbd-qz");
			if (!visible || !barre) {
				dernier = "";
				if (envoye !== "cache") { envoye = "cache"; pont.barre({ visible: false }); }
				return;
			}
			const cs = getComputedStyle(barre);
			/* While the Settings modal is shown, Settings is the active tab (the
			   rail still marks the page under it: it becomes active again by
			   itself when the modal closes). */
			const reglagesOuverts = !!document.querySelector(SETTINGS_MODAL);
			const estActif = (b: HTMLElement): boolean => {
				if (actifForce !== undefined) return cle(b) === actifForce;
				return reglagesOuverts ? estReglages(b) : b.classList.contains(ACTIVE);
			};
			const texte = resoudre("--text-normal");
			const accent = resoudre("--interactive-accent");
			const accentTexte = resoudre("--text-accent");
			// Cheap check first: the icons are only redrawn when the bar itself changed.
			const rapide = JSON.stringify([
				boutons().map(b => [b.querySelector(".qbd-nav-label")?.textContent, estActif(b), b.classList.contains("qbd-nav-item--placeholder")]),
				texte, accent, accentTexte, cs.backgroundColor,
			]);
			if (rapide === dernier) return;
			const items = [];
			// The rail's own computed colours, read from an offscreen clone in each
			// state (the page's CSS decides them). Kept for older Kotlin builds.
			const muted = couleur(boutons()[0], false);
			const active = couleur(boutons()[0], true);
			for (const btn of boutons()) {
				const on = estActif(btn);
				const label = btn.querySelector(".qbd-nav-label")?.textContent ?? "";
				items.push({ id: btn.dataset.nav ?? "settings", label, active: on, placeholder: btn.classList.contains("qbd-nav-item--placeholder") });
			}
			const etat = { visible: true, bg: cs.backgroundColor, line: cs.borderTopColor, muted, active, texte, accent, accentTexte, items };
			dernier = rapide;
			envoye = "visible";
			pont.barre(etat);
		} catch (e) {
			console.warn("[neo-quiz] native bar not published", e);
		} finally {
			encours = false;
			if (replanifie) { replanifie = false; planifier(); }
		}
	};

	let rafId = 0;
	const planifier = (): void => {
		if (rafId) return;
		rafId = requestAnimationFrame(() => { rafId = 0; void publier(); });
	};

	/* The tab the user chooses is published BEFORE the page changes: a click
	   (on the rail, or a tap on the bar, which clicks the rail button) and a
	   swipe the shell has decided. Otherwise the pill follows the page by a
	   frame or more, after the new view is built. The page's own state is
	   published again after the change, so a refused move takes effect. */
	document.addEventListener("click", (e) => {
		const btn = (e.target as Element | null)?.closest?.<HTMLElement>(".qbd-sidebar .qbd-nav-item");
		if (!btn || btn.classList.contains(PLACEHOLDER)) return;
		void publier(cle(btn));
	}, true);
	document.addEventListener("swipe-decided", (e) => {
		const dir = (e as CustomEvent<"next" | "prev">).detail;
		// The same tab order as the shell's swipe (placeholders are skipped).
		const onglets = boutons().filter(b => !b.classList.contains(PLACEHOLDER));
		const courant = onglets.find(b => b.classList.contains(ACTIVE));
		const cible = courant ? nextTab(cle(courant), dir, onglets.map(cle)) : null;
		if (cible) void publier(cible);
	});

	pont.surBarreClic((index) => {
		const btn = boutons()[index];
		if (!btn) return;
		/* A placeholder tab is inert: the bar shows the tap (the ripple) and
		   goes nowhere. */
		if (btn.classList.contains(PLACEHOLDER)) return;
		/* A modal (the Settings page) covers the page but not the bar: a tap on
		   a tab closes it first, then goes to the tab (the click on a page that
		   is still under a modal went nowhere). */
		const fermer = document.querySelector<HTMLElement>(MODAL_CLOSE);
		if (fermer) {
			if (estReglages(btn) && document.querySelector(SETTINGS_MODAL)) return; // already on Settings
			fermer.click();
			if (!btn.classList.contains(ACTIVE)) window.setTimeout(() => btn.click(), 350);
			return;
		}
		btn.click();
	});

	// From here the page's own bar stays hidden (mobile.css).
	document.documentElement.classList.add("nq-bar-native");
	const racine = document.getElementById("neo-quiz-root") ?? document.body;
	new MutationObserver(planifier).observe(racine, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
	new MutationObserver(planifier).observe(document.body, { attributes: true, attributeFilter: ["class"], childList: true });
	window.matchMedia(PHONE_LAYOUT_QUERY).addEventListener("change", planifier);
	planifier();
}
