/* THE PLAYED QUIZ'S TWO BARS (2026-09-28) — `quiz-bars.css`.

   The CSS keeps the top of the quiz (header, beads) in place while a question
   scrolls. This module does the two things CSS cannot:

   - the BOTTOM BAR of arrows. It belongs to the panel, not to the slide
     track (where a glass can neither blur nor span the panel, see the CSS).
     Its two buttons MIRROR the current slide's own arrows — disabled state,
     label, icon — and FORWARD their clicks to them: which slide comes next,
     what the last arrow does (results, finishing an exam) stays the
     engine's decision, in one place (engine/interactions.ts);
   - the slides' minimum height, `--qz-slide-min`: the panel's height minus
     what stands above the questions and the bar, so that the bar rests at
     the bottom of the panel even after a short question.

   Both are refreshed when the engine re-renders or changes slide (a
   MutationObserver on its host) and when the panel or the host is resized. */

/** The current slide: the engine marks it, and only it, `aria-hidden="false"`
 *  (engine/viewport.ts), during a slide transition as well. */
function currentSlide(host: HTMLElement): HTMLElement | null {
	return host.querySelector<HTMLElement>('.quiz-track > .quiz-track-item[aria-hidden="false"]');
}

/** Adds the bar of arrows to the quiz panel around `host`; returns how to remove it. */
export function attachQuizBars(host: HTMLElement): () => void {
	let panel: HTMLElement | null = null;
	let frame = 0;

	const bar = document.createElement("div");
	bar.className = "quiz-question-nav qz-bottom-bar is-empty";
	const prev = document.createElement("button");
	const next = document.createElement("button");
	for (const [button, kind] of [[prev, "prev"], [next, "next"]] as const) {
		button.type = "button";
		/* Never the engine's `quiz-prev-btn` / `quiz-next-btn`: engine/focus.ts
		   reads those classes on the focused element to restore focus after a
		   re-render, and would look for this button inside the slide. */
		button.className = "quiz-nav-btn";
		button.dataset.qzArrow = kind;
		button.addEventListener("click", () => {
			const own = currentSlide(host)?.querySelector<HTMLButtonElement>(`.quiz-${kind}-btn`);
			if (own && !own.disabled) own.click();
		});
		bar.append(button);
	}

	/* The bar copies the current slide's arrows. Copying the icon's markup
	   keeps ONE source for it (engine/cards.ts); it is the engine's own
	   constant SVG, never quiz content. */
	const mirror = (button: HTMLButtonElement, own: HTMLButtonElement | null | undefined): void => {
		if (!own) return;
		if (button.innerHTML !== own.innerHTML) button.innerHTML = own.innerHTML;
		const label = own.getAttribute("aria-label") ?? "";
		if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
		button.disabled = own.disabled;
	};

	const refresh = (): void => {
		frame = 0;
		const found = host.closest<HTMLElement>(".qbd-qz");
		if (found && found !== panel) {
			panel = found;
			panel.append(bar);
			resize.observe(panel);
		}
		if (!panel) return;

		const slide = currentSlide(host);
		const ownPrev = slide?.querySelector<HTMLButtonElement>(".quiz-prev-btn");
		const ownNext = slide?.querySelector<HTMLButtonElement>(".quiz-next-btn");
		bar.classList.toggle("is-empty", !ownPrev && !ownNext);
		mirror(prev, ownPrev);
		mirror(next, ownNext);

		const viewport = host.querySelector<HTMLElement>(".quiz-track-viewport");
		if (!viewport) return;
		/* Where the questions start in the panel's content, at rest: the
		   viewport is not sticky, so its offset plus the scroll is the same
		   wherever the panel is scrolled. The bar reaches the panel's edge,
		   through its bottom padding (quiz-bars.css), so the padding is not
		   subtracted: the bar's height is. */
		const top = viewport.getBoundingClientRect().top - panel.getBoundingClientRect().top
			- panel.clientTop + panel.scrollTop;
		const value = `${Math.max(0, Math.floor(panel.clientHeight - top - bar.offsetHeight))}px`;
		/* Skipping an unchanged value keeps the loop (min-height → host
		   resized → refresh) visibly finite. */
		if (panel.style.getPropertyValue("--qz-slide-min") !== value) {
			panel.style.setProperty("--qz-slide-min", value);
		}
	};
	const schedule = (): void => {
		if (!frame) frame = requestAnimationFrame(refresh);
	};

	const resize = new ResizeObserver(schedule);
	resize.observe(host);
	const mutations = new MutationObserver(schedule);
	mutations.observe(host, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: ["aria-hidden", "disabled", "aria-label"],
	});
	schedule();

	return () => {
		if (frame) cancelAnimationFrame(frame);
		resize.disconnect();
		mutations.disconnect();
		bar.remove();
		panel?.style.removeProperty("--qz-slide-min");
		panel = null;
	};
}
