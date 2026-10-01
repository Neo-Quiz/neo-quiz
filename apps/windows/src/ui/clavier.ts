/* ══════════════════════════════════════════════════════════
   THE SOFT KEYBOARD, AS A CLASS (Android app)

   With `adjustResize` the WebView shrinks above the open keyboard, and a
   played quiz's fixed bar of arrows kept its ~80 px of that small room while
   a text answer was being typed. This module sets `html.nq-keyboard` while a
   text field has focus AND the window is much shorter than it has been
   (focus alone is not enough: Back closes the keyboard and leaves the field
   focused, which would hide the arrows for good). mobile.css hides the bar
   under that class; it comes back with the keyboard.
══════════════════════════════════════════════════════════ */

const EDITABLE = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="range"]), textarea, [contenteditable="true"], math-field';
/** A shrink of the window beyond this many CSS px is a keyboard, not a bar. */
const MIN_SHRINK = 150;

export function installKeyboardState(): void {
	const root = document.documentElement;
	let width = window.innerWidth;
	let tallest = window.innerHeight;

	const update = (): void => {
		// A rotation changes the reference height.
		if (window.innerWidth !== width) { width = window.innerWidth; tallest = window.innerHeight; }
		if (window.innerHeight > tallest) tallest = window.innerHeight;
		const active = document.activeElement;
		const typing = active instanceof Element && active.matches(EDITABLE);
		root.classList.toggle("nq-keyboard", typing && tallest - window.innerHeight > MIN_SHRINK);
	};

	window.addEventListener("resize", update);
	// After the event: `activeElement` is only the new field once focusin returns.
	document.addEventListener("focusin", () => window.setTimeout(update, 0));
	document.addEventListener("focusout", () => window.setTimeout(update, 0));
}
