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

/** The tab a swipe lands on: ends clamp (null), `tabs` holds only the tabs the bar really offers. */
export function nextTab(current: string, direction: "next" | "prev", tabs: readonly string[]): string | null {
	const i = tabs.indexOf(current);
	if (i < 0) return null;
	return tabs[i + (direction === "next" ? 1 : -1)] ?? null;
}


/* ---- Finger-following rules (pure, held by `check:swipe`) ----
   Numbers from native Android paging: touch slop ~8 dp, a fling past ~0.4
   px/ms commits, about 40 % of the width commits, a settle takes ~180-300 ms
   scaled by the distance left (ViewPager2 caps at 600 ms, M3 shared axis X
   uses 300 ms). */
export const SWIPE_SLOP = 10;
export const SWIPE_COMMIT_VELOCITY = 0.4;
export const SWIPE_COMMIT_FRACTION = 0.4;
export const SWIPE_RESISTANCE = 0.3;
const SWIPE_MIN_FLING_DISTANCE = 16;
const SWIPE_VELOCITY_WINDOW_MS = 100;

/** Which axis a gesture belongs to once it has moved past the slop. */
export function lockAxis(dx: number, dy: number): "pending" | "h" | "v" {
	const adx = Math.abs(dx), ady = Math.abs(dy);
	if (Math.max(adx, ady) < SWIPE_SLOP) return "pending";
	return adx > ady ? "h" : "v";
}

/** The offset shown for a finger travel `dx`: 1:1 when the move is possible, resisted at an end. */
export function followOffset(dx: number, possible: boolean): number {
	return possible ? dx : dx * SWIPE_RESISTANCE;
}

/** Velocity (px/ms, signed) over the last ~100 ms of `{x, t}` samples. */
export function releaseVelocity(samples: readonly { x: number; t: number }[]): number {
	if (samples.length < 2) return 0;
	const last = samples[samples.length - 1];
	let first = last;
	for (let i = samples.length - 2; i >= 0; i--) {
		if (last.t - samples[i].t > SWIPE_VELOCITY_WINDOW_MS) break;
		first = samples[i];
	}
	const dt = last.t - first.t;
	return dt > 0 ? (last.x - first.x) / dt : 0;
}

/** Commit ("next"/"prev") or spring back ("none") on release. `canGo` = the move exists. */
export function releaseVerdict(dx: number, velocity: number, width: number, canGo: boolean): "next" | "prev" | "none" {
	if (!canGo || width <= 0) return "none";
	const dir = dx < 0 ? "next" : "prev";
	const fast = Math.abs(velocity) >= SWIPE_COMMIT_VELOCITY && Math.sign(velocity) === Math.sign(dx) && Math.abs(dx) >= SWIPE_MIN_FLING_DISTANCE;
	if (fast || Math.abs(dx) >= SWIPE_COMMIT_FRACTION * width) return dir;
	return "none";
}

/** Settle duration in ms for `remaining` px of a `width` page: 180 to 300. */
export function settleDuration(remaining: number, width: number): number {
	const f = width > 0 ? Math.min(1, Math.abs(remaining) / width) : 1;
	return Math.round(180 + 120 * f);
}

/** The Material decelerate curve for the settle. */
export const SETTLE_EASING = "cubic-bezier(0.2, 0, 0, 1)";

export function prefersReducedMotion(): boolean {
	return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** A short haptic tick on Android (the shim exposes it); silent elsewhere. */
export function hapticTick(): void {
	try { (window as unknown as { neoPlatform?: { haptique?: () => void } }).neoPlatform?.haptique?.(); } catch (_) { /* no haptic */ }
}

export interface FollowHooks {
	/** Does that move exist (false = an end: rubber band, then spring back)? */
	canGo(dir: "next" | "prev"): boolean;
	/** The page follows the finger: `offset` px, already resisted. */
	drag(offset: number, width: number): void;
	/** Finger up. `dir` null = spring back. `velocity` px/ms signed. Caller animates the rest. */
	release(dir: "next" | "prev" | null, offset: number, velocity: number, width: number): void;
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

/**
 * Binds the swipe on `root`; returns the unbinder (called by `destroyQuiz`).
 * Without `follow` the gesture is discrete (decided on release); with it the
 * page follows the finger, and `onSwipe` runs on a committed release only if
 * the caller leaves it to it (`follow.release` receives the verdict).
 */
export function bindSwipe(root: HTMLElement, onSwipe: (d: "next" | "prev") => void, blocked?: () => boolean, follow?: FollowHooks): () => void {
	type Start = { x: number; y: number; t: number; target: Element | null; id: number; lock: "pending" | "h" | "v"; samples: { x: number; t: number }[]; offset: number; ok: boolean };
	let start: Start | null = null;

	// Vertical scrolling stays native; the horizontal axis is ours.
	const previousTouchAction = root.style.touchAction;
	root.style.touchAction = "pan-y pinch-zoom";

	const refused = (s: Start): boolean =>
		isInHorizontalScroller(s.target, root) || !!s.target?.closest?.(TEXT_FIELD)
		|| !!document.querySelector(".modal-container") || !!blocked?.()
		|| s.x < SWIPE_EDGE_ZONE || s.x > window.innerWidth - SWIPE_EDGE_ZONE;

	const onDown = (e: PointerEvent) => {
		// A mouse drag selects text: only fingers and pens swipe.
		if (e.pointerType === "mouse" || !e.isPrimary) { start = null; return; }
		start = { x: e.clientX, y: e.clientY, t: e.timeStamp, target: e.target as Element | null, id: e.pointerId, lock: "pending", samples: [{ x: e.clientX, t: e.timeStamp }], offset: 0, ok: true };
		if (follow) start.ok = !refused(start);
	};
	const onMove = (e: PointerEvent) => {
		const s = start;
		if (!follow || !s || s.id !== e.pointerId || !s.ok || s.lock === "v") return;
		const dx = e.clientX - s.x, dy = e.clientY - s.y;
		if (s.lock === "pending") {
			s.lock = lockAxis(dx, dy);
			if (s.lock !== "h") return;
		}
		s.samples.push({ x: e.clientX, t: e.timeStamp });
		if (s.samples.length > 12) s.samples.shift();
		const possible = follow.canGo(dx < 0 ? "next" : "prev");
		s.offset = followOffset(dx, possible);
		follow.drag(s.offset, window.innerWidth);
	};
	const onUp = (e: PointerEvent) => {
		const s = start;
		start = null;
		if (!s || s.id !== e.pointerId) return;
		const dx = e.clientX - s.x;
		if (follow) {
			if (s.lock !== "h") return;
			const v = releaseVelocity(s.samples);
			const dir = dx < 0 ? "next" : "prev";
			const verdict = releaseVerdict(dx, v, window.innerWidth, follow.canGo(dir));
			/* The navigation is decided here, before the caller's exit animation
			   and the page change: a host that shows the destination at once (the
			   native tab bar) listens for this event on the page. */
			if (verdict !== "none") root.dispatchEvent(new CustomEvent("swipe-decided", { bubbles: true, detail: verdict }));
			follow.release(verdict === "none" ? null : verdict, s.offset, v, window.innerWidth);
			return;
		}
		const verdict = decideSwipe({
			dx,
			dy: e.clientY - s.y,
			ms: e.timeStamp - s.t,
			startX: s.x,
			viewportWidth: window.innerWidth,
			inHorizontalScroller: isInHorizontalScroller(s.target, root),
			inTextField: !!s.target?.closest?.(TEXT_FIELD),
			modalOpen: !!document.querySelector(".modal-container") || !!blocked?.(),
		});
		if (verdict !== "none") onSwipe(verdict);
	};
	const onCancel = (e: PointerEvent) => {
		const s = start;
		start = null;
		if (follow && s && s.lock === "h") follow.release(null, s.offset, 0, window.innerWidth);
		void e;
	};

	root.addEventListener("pointerdown", onDown, { passive: true });
	root.addEventListener("pointermove", onMove, { passive: true });
	root.addEventListener("pointerup", onUp, { passive: true });
	root.addEventListener("pointercancel", onCancel, { passive: true });
	return () => {
		root.removeEventListener("pointerdown", onDown);
		root.removeEventListener("pointermove", onMove);
		root.removeEventListener("pointerup", onUp);
		root.removeEventListener("pointercancel", onCancel);
		root.style.touchAction = previousTouchAction;
	};
}
