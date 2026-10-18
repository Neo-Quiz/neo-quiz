/* A composer card is one big click target for its field: a press anywhere on
   it that is not a control puts the caret at the end of the text at once.
   Shared by the Generate page and the Explain window, so both react the same.
   Without it a press on the padding blurs the field (focus falls back to the
   enclosing modal or page) and a second click is needed. The textarea keeps
   its own native mousedown (caret placement, text selection). */
const CONTROLS = "button, textarea, input, a, .qbd-select, .qbd-ai-note-chip";

export function focusFieldOnCardPress(card: HTMLElement, field: HTMLTextAreaElement, onFocused?: (caret: number) => void): void {
	card.addEventListener("mousedown", (e) => {
		if (e.button !== 0 || field.disabled) return;
		if ((e.target as HTMLElement).closest(CONTROLS)) return;
		// No blur/re-focus flicker: the press never reaches the document's default focus handling.
		e.preventDefault();
		const len = field.value.length;
		field.focus();
		field.setSelectionRange(len, len);
		onFocused?.(len);
	});
}
