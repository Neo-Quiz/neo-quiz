/**
 * Swipe between pages: a horizontal swipe on a played quiz does what the next
 * and previous arrows do. The decision is a pure function (`decideSwipe`,
 * held by `check:swipe`); `bindSwipe` only measures a gesture and asks it.
 */

export interface SwipeSample {
	/** Horizontal travel in px; negative = finger moved left. */
	dx: number;
	dy: number;
	ms: number;
	startX: number;
	viewportWidth: number;
	/** The gesture started inside something that scrolls sideways (a code block). */
	inHorizontalScroller: boolean;
	/** ...inside an input, textarea, contenteditable or MathLive field. */
	inTextField: boolean;
	modalOpen: boolean;
}

export const SWIPE_MIN_DISTANCE = 60;
export const SWIPE_MAX_MS = 600;
/** Gestures starting this close to a screen edge belong to the system (back gesture). */
export const SWIPE_EDGE_ZONE = 24;

export function decideSwipe(s: SwipeSample): "next" | "prev" | "none" {
	if (s.inHorizontalScroller || s.inTextField || s.modalOpen) return "none";
	if (s.startX < SWIPE_EDGE_ZONE || s.startX > s.viewportWidth - SWIPE_EDGE_ZONE) return "none";
	if (s.ms > SWIPE_MAX_MS) return "none";
	const adx = Math.abs(s.dx);
	if (adx < SWIPE_MIN_DISTANCE || adx <= 2 * Math.abs(s.dy)) return "none";
	return s.dx < 0 ? "next" : "prev";
}

const TEXT_FIELD = "input, textarea, [contenteditable], math-field";

function isInHorizontalScroller(target: Element | null, root: HTMLElement): boolean {
	for (let el = target; el && el !== root.parentElement; el = el.parentElement) {
		if (el.scrollWidth <= el.clientWidth) continue;
		const overflowX = getComputedStyle(el).overflowX;
		if (overflowX === "auto" || overflowX === "scroll") return true;
	}
	return false;
}

/** Binds the swipe on `root`; returns the unbinder (called by `destroyQuiz`). */
export function bindSwipe(root: HTMLElement, onSwipe: (d: "next" | "prev") => void): () => void {
	let start: { x: number; y: number; t: number; target: Element | null; id: number } | null = null;

	// Vertical scrolling stays native; the horizontal axis is ours.
	const previousTouchAction = root.style.touchAction;
	root.style.touchAction = "pan-y pinch-zoom";

	const onDown = (e: PointerEvent) => {
		// A mouse drag selects text: only fingers and pens swipe.
		if (e.pointerType === "mouse" || !e.isPrimary) { start = null; return; }
		start = { x: e.clientX, y: e.clientY, t: e.timeStamp, target: e.target as Element | null, id: e.pointerId };
	};
	const onUp = (e: PointerEvent) => {
		const s = start;
		start = null;
		if (!s || s.id !== e.pointerId) return;
		const verdict = decideSwipe({
			dx: e.clientX - s.x,
			dy: e.clientY - s.y,
			ms: e.timeStamp - s.t,
			startX: s.x,
			viewportWidth: window.innerWidth,
			inHorizontalScroller: isInHorizontalScroller(s.target, root),
			inTextField: !!s.target?.closest?.(TEXT_FIELD),
			modalOpen: !!document.querySelector(".modal-container"),
		});
		if (verdict !== "none") onSwipe(verdict);
	};
	const onCancel = () => { start = null; };

	root.addEventListener("pointerdown", onDown, { passive: true });
	root.addEventListener("pointerup", onUp, { passive: true });
	root.addEventListener("pointercancel", onCancel, { passive: true });
	return () => {
		root.removeEventListener("pointerdown", onDown);
		root.removeEventListener("pointerup", onUp);
		root.removeEventListener("pointercancel", onCancel);
		root.style.touchAction = previousTouchAction;
	};
}
