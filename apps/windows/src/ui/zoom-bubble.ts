/* ══════════════════════════════════════════════════════════
   THE ZOOM BUBBLE — a browser's zoom indicator

   Every zoom change (Ctrl + wheel, Display > Interface scale, its own
   buttons) shows the new percentage at the top of the window, with − / +
   and Reset, then goes away on its own, without any effect. Without it, a
   zoom changed by a stray Ctrl + wheel went unnoticed: text just looked
   "off" (2026-09-28).

   The bubble never changes the zoom itself: its buttons go through `step`
   and `reset`, which the title bar wires to the same path as the wheel and
   the menu — one place that talks to the main process.
══════════════════════════════════════════════════════════ */
import { ajouter } from "../../../../src/dom";
import { t } from "../../../../src/i18n";
import { poserIcone } from "../host/ui";
import { PALIERS_ZOOM } from "./menu-app-arbre";

/** How long the bubble stays after the last change, pointer outside it. */
const HIDE_DELAY_MS = 2500;

export interface ZoomBubble {
	/** Shows the bubble with factor `f` (just REQUESTED from the main
	    process, not yet applied) and restarts its hide timer. */
	show(f: number): void;
	/** The zoom the page already has, at startup (the persisted setting,
	    applied by the main process on `did-finish-load`). */
	setApplied(f: number): void;
	destroy(): void;
}

export function createZoomBubble(deps: {
	step(direction: 1 | -1): void;
	reset(): void;
}): ZoomBubble {
	const bubble = document.createElement("div");
	bubble.className = "nq-zoom-bubble";
	bubble.dataset.visible = "false";

	const value = ajouter(bubble, "span", "nq-zoom-bubble-value");
	// Read out on each change: the bubble IS the feedback of a keyboard-less
	// gesture, and a screen reader would otherwise say nothing.
	value.setAttribute("aria-live", "polite");

	function iconButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "nq-zoom-bubble-step";
		button.setAttribute("aria-label", label);
		poserIcone(button, icon);
		button.addEventListener("click", onClick);
		bubble.appendChild(button);
		return button;
	}
	const zoomOut = iconButton("minus", t("app.zoom.out"), () => deps.step(-1));
	const zoomIn = iconButton("plus", t("app.zoom.in"), () => deps.step(1));

	const resetButton = document.createElement("button");
	resetButton.type = "button";
	resetButton.className = "nq-zoom-bubble-reset";
	resetButton.textContent = t("app.zoom.reset");
	resetButton.addEventListener("click", () => deps.reset());
	bubble.appendChild(resetButton);

	document.body.appendChild(bubble);

	let timer: number | undefined;
	let hovered = false;
	function scheduleHide(): void {
		window.clearTimeout(timer);
		// Never hide under the pointer or with KEYBOARD focus inside: the user
		// is on their way to a button, and a bubble that vanishes then eats the
		// click. `:focus-visible`, not `activeElement`: a mouse click leaves the
		// focus on the button, and the bubble would then never go away.
		if (hovered || bubble.querySelector(":focus-visible")) return;
		timer = window.setTimeout(() => { bubble.dataset.visible = "false"; }, HIDE_DELAY_MS);
	}
	bubble.addEventListener("mouseenter", () => { hovered = true; window.clearTimeout(timer); });
	bubble.addEventListener("mouseleave", () => { hovered = false; scheduleHide(); });
	bubble.addEventListener("focusout", () => { window.setTimeout(scheduleHide, 0); });

	/* THE ONLY MOTION OF THE BUBBLE: while it is on screen, a new percentage
	   cross-fades with the old one — nothing slides (asked on 2026-09-28).
	   Showing and hiding have no effect at all: the first value of an
	   appearance is simply set. */
	const FADE_MS = 150;
	function valueSpan(text: string): HTMLSpanElement {
		const span = document.createElement("span");
		span.textContent = text;
		value.appendChild(span);
		return span;
	}
	function setValue(text: string, fade: boolean): void {
		// A fade still running is cut short: only the value on its way in
		// stays, and it fades out in turn.
		const current = value.lastElementChild as HTMLElement | null;
		for (const child of Array.from(value.children)) if (child !== current) child.remove();
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (!current || !fade || reduced) {
			value.replaceChildren();
			valueSpan(text);
			return;
		}
		current.getAnimations().forEach(a => a.cancel());
		const incoming = valueSpan(text);
		const timing = { duration: FADE_MS, easing: "ease" };
		current.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, fill: "forwards" })
			.finished.then(() => current.remove(), () => { /* cancelled */ });
		incoming.animate([{ opacity: 0 }, { opacity: 1 }], timing);
	}
	let shownPercent: number | null = null;

	/* THE BUBBLE MUST NOT MOVE WHILE THE PAGE ZOOMS. It lives INSIDE the
	   zoomed page, so CSS `zoom` cancels the page factor on it alone, like a
	   browser's own bubble, which sits outside the page; `--nq-zoom-factor`
	   keeps it just below the title bar, whose height does follow the zoom.

	   The trap: the page zoom changes one IPC round trip AFTER it is asked
	   for. Compensating for the requested factor right away made the bubble
	   jump for a few frames, then settle (2026-09-28). So the compensation
	   follows the zoom the page ACTUALLY has, read on `resize` — which
	   Chromium fires in the very frame the new zoom is laid out, before it is
	   painted — from `devicePixelRatio`: it is the screen scale times the
	   page zoom, so dividing by the screen scale gives the zoom.

	   The screen scale is learnt, not guessed: whenever no zoom is pending, a
	   change of `devicePixelRatio` can only be the window moving to another
	   screen, and it becomes the new scale. */
	let appliedZoom = 1;
	let pending = false;
	let screenScale = window.devicePixelRatio;
	function nearestStep(z: number): number {
		return PALIERS_ZOOM.reduce((best, p) => Math.abs(p - z) < Math.abs(best - z) ? p : best, PALIERS_ZOOM[0]);
	}
	function compensate(): void {
		bubble.style.setProperty("zoom", String(1 / appliedZoom));
		bubble.style.setProperty("--nq-zoom-factor", String(appliedZoom));
	}
	function onResize(): void {
		const dpr = window.devicePixelRatio;
		if (pending) {
			appliedZoom = nearestStep(dpr / screenScale);
			// The requested step is reached once its own fraction is: several
			// wheel notches in a row go through the steps in between.
			if (shownPercent !== null && Math.round(appliedZoom * 100) === shownPercent) pending = false;
		} else {
			screenScale = dpr / appliedZoom;
		}
		compensate();
	}
	window.addEventListener("resize", onResize);

	return {
		show(f) {
			const percent = Math.round(f * 100);
			const onScreen = bubble.dataset.visible === "true" && shownPercent !== null;
			if (!onScreen || percent !== shownPercent) setValue(`${percent} %`, onScreen);
			shownPercent = percent;
			// The ends of the step list: a button that can do nothing says so
			// rather than silently ignoring the click.
			zoomOut.disabled = percent <= Math.round(PALIERS_ZOOM[0] * 100);
			zoomIn.disabled = percent >= Math.round(PALIERS_ZOOM[PALIERS_ZOOM.length - 1] * 100);
			resetButton.disabled = percent === 100;
			pending = Math.abs(f - appliedZoom) > 0.001;
			compensate();
			bubble.dataset.visible = "true";
			scheduleHide();
		},
		setApplied(f) {
			appliedZoom = f;
			screenScale = window.devicePixelRatio / f;
			compensate();
		},
		destroy() {
			window.removeEventListener("resize", onResize);
			window.clearTimeout(timer);
			bubble.remove();
		},
	};
}
