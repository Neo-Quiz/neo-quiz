/* ══════════════════════════════════════════════════════════
   STRETCH AT THE END OF A PLAYED QUESTION (Android app)

   Android 12's stretch overscroll is only drawn for the WebView's own
   (document) scroller, never for an inner `overflow: auto` box. A played quiz
   cannot hand its scrolling to the document: its beads sit at the top and
   its bar of arrows at the bottom, and each question scrolls between them
   (quiz-bars.css). So the effect is reproduced here for that one box: past
   the top or the bottom of the current question, the finger pulls it
   away from the edge (a vertical stretch from that edge, damped as the pull
   grows), and on release it settles back with a spring-like ease.

   Nothing is scrolled or cancelled by this module: it only reads touch
   events (passive) and writes a transform. It never runs under
   `prefers-reduced-motion`.
══════════════════════════════════════════════════════════ */

const SLIDE = "#neo-quiz-root > .qbd-qz .quiz-track-item";
/** The most a question is stretched, as a fraction of its height. */
const MAX_STRETCH = 0.18;
/** The pull (in screen heights) at which half of the maximum is reached. */
const HALF_PULL = 0.35;
const SETTLE = "transform 380ms cubic-bezier(0.25, 1, 0.5, 1)";

export function installOverscrollStretch(): void {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	let slide: HTMLElement | null = null;
	let edge: "top" | "bottom" | null = null;
	let anchor = 0;
	let last = 0;

	const release = (): void => {
		const el = slide;
		slide = null;
		edge = null;
		if (!el || !el.style.transform) return;
		el.style.transition = SETTLE;
		el.style.transform = "";
		el.addEventListener("transitionend", () => { el.style.transition = ""; el.style.transformOrigin = ""; }, { once: true });
	};

	document.addEventListener("touchstart", (e) => {
		release();
		if (e.touches.length !== 1) return;
		const found = (e.target as Element | null)?.closest<HTMLElement>(SLIDE) ?? null;
		if (!found) return;
		slide = found;
		last = e.touches[0].clientY;
		slide.style.transition = "none";
	}, { passive: true });

	document.addEventListener("touchmove", (e) => {
		if (!slide || e.touches.length !== 1) return;
		const y = e.touches[0].clientY;
		const dy = y - last;
		last = y;
		if (edge === null) {
			const atTop = slide.scrollTop <= 0;
			const atBottom = slide.scrollTop + slide.clientHeight >= slide.scrollHeight - 1;
			if (atTop && dy > 0) edge = "top";
			else if (atBottom && dy < 0) edge = "bottom";
			else return;
			anchor = y - dy;
			slide.style.transformOrigin = edge === "top" ? "50% 0" : "50% 100%";
		}
		const pull = edge === "top" ? y - anchor : anchor - y;
		if (pull <= 0) {
			slide.style.transform = "";
			edge = null;
			return;
		}
		const ratio = pull / (pull + HALF_PULL * window.innerHeight);
		slide.style.transform = `scaleY(${1 + MAX_STRETCH * ratio})`;
	}, { passive: true });

	document.addEventListener("touchend", release, { passive: true });
	document.addEventListener("touchcancel", release, { passive: true });
}
