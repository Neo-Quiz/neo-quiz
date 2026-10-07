/* ══════════════════════════════════════════════════════════
   STRETCH AT THE ENDS OF A SCROLLING AREA (Android app)

   Android 12's stretch overscroll is only drawn for the WebView's own
   (document) scroller, never for an inner `overflow: auto` box. Several
   areas of the app are such boxes: a played quiz (its question scrolls
   between the beads and the bar of arrows, quiz-bars.css), a modal window,
   a row of tabs or a code block that scrolls sideways, a settings panel.
   So the effect is reproduced here, for whichever box the finger is on:
   past the start or the end of its content, the finger pulls it away from
   that edge (a stretch from that edge, damped as the pull grows), and on
   release it settles back with a spring-like ease.

   The axis is locked on the first movement (`lockAxis`, the same rule as
   the page swipe in src/swipe.ts). A horizontal gesture is only stretched
   by a box that scrolls sideways: the page swipe refuses exactly those
   gestures (`isInHorizontalScroller`), so the two never compete. The
   document itself is never stretched here (the WebView does it), nor a
   `position: fixed` bar, nor a field being edited, nor a box that already
   has a transform running (an animation, or the settle of a previous pull).

   Nothing is scrolled or cancelled by this module: it only reads touch
   events (passive) and writes a transform. It never runs under
   `prefers-reduced-motion`.
══════════════════════════════════════════════════════════ */

import { lockAxis } from "../../../../src/swipe";

/** The most a box is stretched, as a fraction of its size on the pulled axis. */
export const MAX_STRETCH = 0.18;
/** The pull (in screen sizes along the axis) at which half of the maximum is reached. */
export const HALF_PULL = 0.35;
const SETTLE = "transform 380ms cubic-bezier(0.25, 1, 0.5, 1)";
const TEXT_FIELD = "input, textarea, [contenteditable], math-field";

/** The stretch for a pull of `pullPx` on a viewport `viewportPx` long on that axis: 0 at rest, MAX_STRETCH / 2 at HALF_PULL × viewport, never past MAX_STRETCH. */
export function stretchAmount(pullPx: number, viewportPx: number): number {
	if (!(pullPx > 0) || !(viewportPx > 0)) return 0;
	const ratio = pullPx / (pullPx + HALF_PULL * viewportPx);
	return MAX_STRETCH * ratio;
}

/** Does a box with this computed overflow scroll along an axis holding `content` px in a `size` px box? */
export function scrollableOn(overflow: string, size: number, content: number): boolean {
	return (overflow === "auto" || overflow === "scroll" || overflow === "overlay") && content > size;
}

/** May this box be stretched at all? Not a fixed bar, and not a box whose transform is already running. */
export function mayStretch(position: string, transform: string): boolean {
	return position !== "fixed" && transform === "none";
}

/** Is the scroll already at the edge a pull of `delta` (> 0 toward the start, < 0 toward the end) tries to leave? */
export function atPullEdge(pos: number, size: number, content: number, delta: number): boolean {
	if (delta > 0) return pos <= 0;
	if (delta < 0) return pos + size >= content - 1;
	return false;
}

type Axis = "x" | "y";
type Edge = "start" | "end";
interface Gesture {
	target: Element;
	x0: number;
	y0: number;
	axis: Axis | "pending" | "none";
	el: HTMLElement | null;
	edge: Edge | null;
	anchor: number;
	last: number;
}

/** The nearest box above `from` that scrolls along `axis`; null if there is none, or if that box may not be stretched. */
function scrollerFor(from: Element, axis: Axis): HTMLElement | null {
	for (let el: Element | null = from; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
		if (!(el instanceof HTMLElement)) continue;
		const style = getComputedStyle(el);
		const scrolls = axis === "y"
			? scrollableOn(style.overflowY, el.clientHeight, el.scrollHeight)
			: scrollableOn(style.overflowX, el.clientWidth, el.scrollWidth);
		if (scrolls) return mayStretch(style.position, style.transform) ? el : null;
	}
	return null;
}

export function installOverscrollStretch(): void {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	let gesture: Gesture | null = null;

	const release = (): void => {
		const el = gesture?.el ?? null;
		gesture = null;
		if (!el) return;
		if (!el.style.transform) { el.style.transition = ""; el.style.transformOrigin = ""; return; }
		el.style.transition = SETTLE;
		el.style.transform = "";
		el.addEventListener("transitionend", () => { el.style.transition = ""; el.style.transformOrigin = ""; }, { once: true });
	};

	document.addEventListener("touchstart", (e) => {
		release();
		if (e.touches.length !== 1) return;
		const target = e.target;
		if (!(target instanceof Element) || target.closest(TEXT_FIELD)) return;
		const t = e.touches[0];
		gesture = { target, x0: t.clientX, y0: t.clientY, axis: "pending", el: null, edge: null, anchor: 0, last: 0 };
	}, { passive: true });

	document.addEventListener("touchmove", (e) => {
		const g = gesture;
		if (!g || e.touches.length !== 1) return;
		const t = e.touches[0];
		if (g.axis === "pending") {
			const verdict = lockAxis(t.clientX - g.x0, t.clientY - g.y0);
			if (verdict === "pending") return;
			const axis: Axis = verdict === "h" ? "x" : "y";
			g.el = scrollerFor(g.target, axis);
			g.axis = g.el ? axis : "none";
			g.last = axis === "y" ? t.clientY : t.clientX;
		}
		if (g.axis === "none" || !g.el) return;
		const el = g.el;
		const axis = g.axis;
		const c = axis === "y" ? t.clientY : t.clientX;
		const delta = c - g.last;
		g.last = c;
		if (g.edge === null) {
			const pos = axis === "y" ? el.scrollTop : el.scrollLeft;
			const size = axis === "y" ? el.clientHeight : el.clientWidth;
			const content = axis === "y" ? el.scrollHeight : el.scrollWidth;
			if (!atPullEdge(pos, size, content, delta)) return;
			g.edge = delta > 0 ? "start" : "end";
			g.anchor = c - delta;
			el.style.transition = "none";
			el.style.transformOrigin = axis === "y"
				? (g.edge === "start" ? "50% 0" : "50% 100%")
				: (g.edge === "start" ? "0 50%" : "100% 50%");
		}
		const pull = g.edge === "start" ? c - g.anchor : g.anchor - c;
		if (pull <= 0) {
			el.style.transform = "";
			el.style.transition = "";
			el.style.transformOrigin = "";
			g.edge = null;
			return;
		}
		const viewport = axis === "y" ? window.innerHeight : window.innerWidth;
		const scale = 1 + stretchAmount(pull, viewport);
		el.style.transform = axis === "y" ? `scaleY(${scale})` : `scaleX(${scale})`;
	}, { passive: true });

	document.addEventListener("touchend", release, { passive: true });
	document.addEventListener("touchcancel", release, { passive: true });
}
