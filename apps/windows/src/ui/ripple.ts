/** Delegated mobile feedback. No overlay, timer, layout writes or DOM observer. */
const TARGETS = [
	"button", "a[href]", "summary", "input:not([type='hidden'])", "textarea", "select", "math-field",
	"[role='button']", "[role='tab']", "[role='menuitem']", "[role='option']", "[role='switch']", "[role='checkbox']", "[contenteditable='true']",
	"label:has(input)", ".qbd-nav-item", ".qbd-quiz-card", ".qbd-module-card", ".qbd-qz-card",
	".qbd-fiche-card.is-editable", ".quiz-option", ".quiz-fc-card", ".quiz-tab", ".quiz-possibility", ".quiz-slot.filled", ".qb-toggle-wrap", ".qbd-medit-select", ".qb-terme",
	".qbd-quizzes-node-head", ".qbd-setup-row:has([role='switch'])",
	".qbd-model-picker-row", ".qbd-select-option", "[data-nq-press]",
].join(", ");
const DISABLED = ":disabled, [disabled], [aria-disabled='true'], [inert], .is-disabled, .qbd-nav-item--placeholder, .qbd-select-option--disabled, .qbd-model-option--disabled";
const DEPTH = ".quiz-action-btn.success, .quiz-option, .quiz-tab, button.quiz-fc-card, .quiz-fc-rate, .quiz-possibility, .quiz-slot.filled, .qbd-btn--create, .qbd-quiz-card--folder, .qbd-cta3d, .qbd-quiz-card-play, .quiz-help-btn, .qz-explain-btn:not(.qz-explain-btn-icone), .quiz-question-nav .quiz-nav-btn";
const FLAT = "input, textarea, select, math-field, label, [contenteditable='true'], [role='switch'], [role='checkbox'], [role='menuitem'], [role='option'], .qbd-model-picker-row, .qbd-select-option, .qbd-ai-model-pill, .qz-explain-btn-icone, summary, [role='tab'], [aria-expanded], .qbd-nav-item, .qbd-quizzes-node-head, .qbd-setup-row, .nq-set-ligne-lien, .nq-set-onglet, .nq-choix-option, .nq-menu-ligne, .qbd-create-option, .qbd-ai-composer-add, .qbd-ai-composer-send, .qbd-card-more, .qbd-sel-btn, .qbd-quiz-card-mode-btn, .qbd-medit-select, .qb-toggle-wrap, .quiz-fc-card, .qb-terme";
const SLOP_PX = 10;

/** Keep icon actions and rows still; an accessible name alone says nothing about geometry. */
export function pressFamily(target: HTMLElement, reducedMotion: boolean): "layer" | "depth" | "scale" {
	if (reducedMotion || target.closest(".modal, .quiz-hint-modal, .quiz-handin-modal, [role='dialog']")) return "layer";
	if (target.matches(DEPTH)) return "depth";
	if (target.matches(FLAT) || (target.matches("button, [role='button']") && !target.textContent?.trim())) return "layer";
	return "scale";
}

export function installRipple(): void {
	let active: { target: HTMLElement; pointerId: number; x: number; y: number } | null = null;
	const pointers = new Set<number>();
	const clear = (): void => {
		if (active) delete active.target.dataset.nqPressed;
		active = null;
	};
	const reset = (): void => { clear(); pointers.clear(); };
	const mobile = (): boolean => document.body.classList.contains("is-mobile");

	document.addEventListener("pointerdown", (event) => {
		if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
		pointers.add(event.pointerId);
		clear();
		if (!mobile() || pointers.size !== 1 || !event.isPrimary || !(event.target instanceof Element)) return;
		// Find the closest candidate BEFORE checking disabled state: a disabled child
		// must never transfer its feedback to an enabled parent card.
		const target = event.target.closest<HTMLElement>(TARGETS);
		if (!target || target.closest(DISABLED) || target.matches(".quiz-is-locked .quiz-option, .quiz-learn-revealed .quiz-option, .quiz-possibility.used, .quiz-slot.correct, .quiz-slot.wrong, .quiz-is-locked .quiz-possibility, .quiz-is-locked .quiz-slot, .quiz-learn-revealed .quiz-possibility, .quiz-learn-revealed .quiz-slot")) return;
		target.dataset.nqPressFamily = pressFamily(target, window.matchMedia("(prefers-reduced-motion: reduce)").matches);
		target.dataset.nqPressed = "true";
		active = { target, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
	}, { passive: true, capture: true });

	document.addEventListener("pointermove", (event) => {
		if (active && !active.target.isConnected) clear();
		if (active && event.pointerId === active.pointerId && Math.hypot(event.clientX - active.x, event.clientY - active.y) > SLOP_PX) clear();
	}, { passive: true, capture: true });
	const release = (event: PointerEvent): void => {
		pointers.delete(event.pointerId);
		if (active?.pointerId === event.pointerId) clear();
	};
	document.addEventListener("pointerup", release, { passive: true, capture: true });
	document.addEventListener("pointercancel", release, { passive: true, capture: true });
	for (const type of ["scroll", "contextmenu", "dragstart", "lostpointercapture"]) {
		document.addEventListener(type, clear, { passive: true, capture: true });
	}
	window.addEventListener("blur", reset);
	window.addEventListener("pagehide", reset);
	window.addEventListener("popstate", reset);
	window.addEventListener("hashchange", reset);
	document.addEventListener("visibilitychange", () => { if (document.hidden) reset(); });
}
