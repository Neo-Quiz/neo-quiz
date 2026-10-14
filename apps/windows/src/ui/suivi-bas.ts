/**
 * FOLLOWING THE BOTTOM OF A THREAD while an answer is written (2026-10-14),
 * decided by the user's GESTURES, never by the geometry at repaint time.
 *
 * The Explain window used to ask "within 80 px of the bottom?" at each
 * chunk and, if so, set `scrollTop` to the bottom. A wheel notch on Windows
 * scrolls smoothly over several frames: the next chunk landed while the
 * view was still within 80 px, and pulled it back down. Scrolling up felt
 * blocked, as if something held the thread.
 *
 * Here any gesture that moves away from the bottom (wheel up, a finger on
 * the thread, the scrollbar dragged, a key that scrolls up) stops the
 * following AT ONCE; it resumes only when the user comes back to the very
 * bottom themselves, or when `reprendre` is called (a new message sent).
 */

/** How close to the bottom counts as "back at the bottom" (rounding of fractional pixels). */
const BAS_PX = 4;

export interface SuiviBas {
	/** Brings the thread to the bottom if it still follows it. */
	coller(): void;
	/** Follows the bottom again (a message was just sent). */
	reprendre(): void;
}

export function suivreLeBas(fil: HTMLElement): SuiviBas {
	let suit = true;
	/** A finger on the thread, or the mouse holding the scrollbar. */
	let tenu = false;
	const distance = (): number => fil.scrollHeight - fil.scrollTop - fil.clientHeight;

	fil.addEventListener("wheel", e => { if (e.deltaY < 0) suit = false; }, { passive: true });
	fil.addEventListener("touchstart", () => { tenu = true; }, { passive: true });
	fil.addEventListener("touchend", () => { tenu = false; }, { passive: true });
	fil.addEventListener("touchcancel", () => { tenu = false; }, { passive: true });
	// A press on the thread itself, not on a child: its scrollbar.
	fil.addEventListener("pointerdown", e => {
		if (e.pointerType === "touch" || e.target !== fil) return;
		tenu = true;
		window.addEventListener("pointerup", () => { tenu = false; }, { once: true });
	});
	fil.addEventListener("keydown", e => {
		if (e.key === "PageUp" || e.key === "ArrowUp" || e.key === "Home") suit = false;
	});
	fil.addEventListener("scroll", () => {
		if (distance() < BAS_PX) suit = true;
		else if (tenu) suit = false;
	}, { passive: true });

	return {
		coller() { if (suit) fil.scrollTop = fil.scrollHeight; },
		reprendre() { suit = true; },
	};
}
