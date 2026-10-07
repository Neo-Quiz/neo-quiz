/* ══════════════════════════════════════════════════════════
   PAGE GHOST: keeps the page being left on screen while the next one is
   built and painted.

   A swipe between two main pages used to fade the old page out to opacity 0
   FIRST, and build the new one only when that fade ended: building a page
   takes 100 to 400 ms on a phone, during which the last painted frame was an
   invisible page, so the screen stayed empty until the new page appeared
   (phone audit, 2026-10-07: "Folders complete 400 ms later"). The ghost is a
   fixed-size copy of the outgoing panel that leaves by itself (transform and
   opacity only, on the compositor) while the real panel is rebuilt under it:
   the new page can be as slow as it likes, the screen is never empty.
══════════════════════════════════════════════════════════ */

/** Classes that start an entry animation (`.qbd-*-enter`, `qbd-qz--entering`):
    a copy must not replay them. */
const ENTER_CLASS = /^qbd-[a-z-]*(-enter|--entering)$/;

function stripEnter(el: Element): void {
	for (const c of Array.from(el.classList)) if (ENTER_CLASS.test(c)) el.classList.remove(c);
}

/**
 * Copies `panel` (with its inline drag transform and opacity) over itself, in
 * its parent, at the same place of the document (document scroll included:
 * the ghost is part of the page, not fixed to the screen). Returns the ghost and a
 * `drop` that removes it. The parent becomes the positioning box for as long
 * as the ghost lives, and is restored by `drop`.
 */
export function pageGhost(panel: HTMLElement): { ghost: HTMLElement; drop: () => void } {
	const parent = panel.parentElement as HTMLElement;
	const ghost = panel.cloneNode(true) as HTMLElement;
	stripEnter(ghost);
	ghost.querySelectorAll("[class*='-enter'], [class*='--entering']").forEach(stripEnter);
	ghost.inert = true;
	ghost.setAttribute("aria-hidden", "true");
	const before = parent.style.position;
	parent.style.position = "relative";
	/* The offsets, not `getBoundingClientRect()`: the rectangle includes the
	   drag transform, which the copy carries on its own (it would be applied
	   twice and the ghost would sit a full page to the side). */
	const s = ghost.style;
	s.position = "absolute";
	s.top = `${panel.offsetTop}px`;
	s.left = `${panel.offsetLeft}px`;
	s.width = `${panel.offsetWidth}px`;
	s.height = `${panel.offsetHeight}px`;
	s.margin = "0";
	s.boxSizing = "border-box";
	s.overflow = "hidden";
	s.pointerEvents = "none";
	parent.append(ghost);
	return { ghost, drop: () => { ghost.remove(); parent.style.position = before; } };
}
