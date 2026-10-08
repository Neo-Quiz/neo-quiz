/* THE PLAYED QUIZ'S TWO BARS (2026-09-28) — `quiz-bars.css`.

   The panel does not scroll: the top of the quiz and the bar of arrows stay
   still, and only the current question scrolls between them. This module
   does the three things CSS cannot:

   - the BOTTOM BAR of arrows, a child of the panel under the questions.
     On a phone (body.is-mobile) there is no bar: the swipe and the beads reach
     every step, and the room goes to the question.
     Its two buttons MIRROR the current slide's own arrows — disabled state,
     label, icon — and FORWARD their clicks to them: which slide comes next,
     what the last arrow does (results, finishing an exam) stays the
     engine's decision, in one place (engine/interactions.ts);
   - the slides' height, `--qz-slide-h`: the room between the beads and
     the bar, so that the bar rests at the bottom of the panel and a long
     question scrolls inside its slide;
   - the WHEEL anywhere in the panel (its margins, the beads, the bar)
     scrolls the current question: in a wide window, the question's column
     is only the middle of the panel.

   The first two are refreshed when the engine re-renders or changes slide
   (a MutationObserver on its host) and when the panel or the host is
   resized. */

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
			panel?.removeEventListener("wheel", onWheel);
			panel = found;
			/* The mini composer above the bar shows and hides itself: the slides' room follows. */
			mutations.observe(panel, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
			resize.observe(panel);
			panel.addEventListener("wheel", onWheel, { passive: true });
		}
		if (!panel) return;

		/* On a phone (`body.is-mobile`) there is no bar at all: a question swipes
		   and the beads reach every step, so the room of the bar goes to the slides.
		   Removed, not hidden: the room below is measured from what is in the panel. */
		const showBar = !document.body.classList.contains("is-mobile");
		if (showBar && !bar.isConnected) {
			panel.append(bar);
			// The bar hiding (soft keyboard open, mobile.css) gives its room to the slides.
			resize.observe(bar);
		} else if (!showBar && bar.isConnected) {
			resize.unobserve(bar);
			bar.remove();
		}
		if (showBar) {
			const slide = currentSlide(host);
			const ownPrev = slide?.querySelector<HTMLButtonElement>(".quiz-prev-btn");
			const ownNext = slide?.querySelector<HTMLButtonElement>(".quiz-next-btn");
			bar.classList.toggle("is-empty", !ownPrev && !ownNext);
			mirror(prev, ownPrev);
			mirror(next, ownNext);
		}

		/* A beads row that scrolls sideways (phone, mobile.css) keeps the current
		   bead centred. Set on the row itself: `scrollIntoView` would also move
		   every scrollable ancestor. */
		const nav = panel.querySelector<HTMLElement>(":scope .quiz-nav");
		const current = nav?.querySelector<HTMLElement>(".quiz-tab.active");
		if (nav && current && nav.scrollWidth > nav.clientWidth + 1) {
			const left = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
			if (Math.abs(nav.scrollLeft - left) > 2) nav.scrollTo({ left, behavior: "smooth" });
		}

		const viewport = host.querySelector<HTMLElement>(".quiz-track-viewport");
		if (!viewport) return;
		/* From the top of the questions to the bottom of the panel's content
		   box, minus what follows the viewport in the host and the bar (whose
		   -16 px margin cancels the panel's gap). Divided by the panel's
		   scale: the launch transition animates its transform
		   (ui/transition-quiz.ts), and a measure taken mid-way would stay. */
		const panelRect = panel.getBoundingClientRect();
		const scale = panel.offsetHeight > 0 ? panelRect.height / panel.offsetHeight : 1;
		if (!(scale > 0)) return;
		const viewportRect = viewport.getBoundingClientRect();
		const contentBottom = panelRect.top + (panel.clientTop + panel.clientHeight
			- parseFloat(getComputedStyle(panel).paddingBottom || "0")) * scale;
		const trailing = host.getBoundingClientRect().bottom - viewportRect.bottom;
		const room = (contentBottom - viewportRect.top - trailing) / scale - (bar.isConnected ? bar.offsetHeight : 0)
			- (panel.querySelector<HTMLElement>(":scope > .qz-above-bar:not([hidden])")?.offsetHeight ?? 0);
		const value = `${Math.max(0, Math.floor(room))}px`;
		/* Skipping an unchanged value keeps the loop (height → host resized →
		   refresh) visibly finite. */
		if (panel.style.getPropertyValue("--qz-slide-h") !== value) {
			panel.style.setProperty("--qz-slide-h", value);
		}
	};
	/* A wheel outside the current slide scrolls it anyway. Inside it, the
	   browser already does, and nested scrollers (a long code block, a
	   terminal) keep theirs. Ctrl + wheel is the zoom (ui/barre-titre.ts),
	   Shift + wheel and a mostly sideways gesture scroll sideways. */
	function onWheel(event: WheelEvent): void {
		if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
		const slide = currentSlide(host);
		if (!slide || (event.target instanceof Node && slide.contains(event.target))) return;
		const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
			: event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? slide.clientHeight : 1;
		slide.scrollBy({ top: event.deltaY * unit });
	}

	const schedule = (): void => {
		if (!frame) frame = requestAnimationFrame(refresh);
	};

	const resize = new ResizeObserver(schedule);
	resize.observe(host);
	/* The phone width (`is-mobile`, main.ts) toggles the bar: the class is the signal. */
	const bodyClass = new MutationObserver(schedule);
	bodyClass.observe(document.body, { attributes: true, attributeFilter: ["class"] });
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
		bodyClass.disconnect();
		bar.remove();
		panel?.removeEventListener("wheel", onWheel);
		panel?.style.removeProperty("--qz-slide-h");
		panel = null;
	};
}
