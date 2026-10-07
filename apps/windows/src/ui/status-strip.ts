/* ══════════════════════════════════════════════════════════
   THE STATUS BAR STRIP SHOWS ONLY ONCE THE PAGE HAS SCROLLED (Android app)

   The page's panel runs up under the status bar (mobile.css), and a fixed
   strip covers the clock so that scrolled content never reads under it. Drawn
   at all times, that strip laid the panel's translucent tint over the panel
   itself: a darker band under the clock on a page at rest (2026-10-08,
   rgb 30,36,56 over 40,55,85). At rest nothing sits under the clock, so the
   strip has nothing to hide: like an Android top app bar that lifts on
   scroll, it fades in only when the page is scrolled (`nq-scrolled` on
   <html>, read by mobile.css), and out again at the top.

   Passive scroll listener, at most one class change per frame, and only when
   the state flips: a scroll never writes to the DOM otherwise.
══════════════════════════════════════════════════════════ */

const CLASS = "nq-scrolled";

export function installStatusStrip(): void {
	const root = document.documentElement;
	let scheduled = false;
	const update = (): void => {
		scheduled = false;
		const scrolled = window.scrollY > 0;
		if (root.classList.contains(CLASS) !== scrolled) root.classList.toggle(CLASS, scrolled);
	};
	window.addEventListener("scroll", () => {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(update);
	}, { passive: true });
	update();
}
