/* ══════════════════════════════════════════════════════════
   THE LANGUAGE NAME above a code block's logo (2026-09-29).

   Hovering (or focusing) the logo of a recognized code block
   (`.quiz-code-lang`, engine/grammaire-blocs.ts) shows the language's name in
   a small dark bubble JUST ABOVE the logo. Not the native `title` tooltip,
   which looked out of place; and not a CSS pseudo-element either: the logo
   sits 14 px under the top of its `<pre>`, which scrolls sideways and so
   clips anything that rises above it. The bubble lives on `<body>`, placed
   from the logo's rectangle, and is removed with the quiz.

   One delegated listener per quiz container, like the flashcard keys
   (engine/text-only.ts): the blocks are rebuilt on every card re-render.
   ══════════════════════════════════════════════════════════ */

const SHOW_DELAY_MS = 250;
const GAP_PX = 6;

/** Installs the bubble on `container`; returns its cleanup. */
export function installCodeLangBubble(container: HTMLElement): () => void {
	if (typeof container?.addEventListener !== "function") return () => {};
	let bubble: HTMLDivElement | null = null;
	let anchor: HTMLElement | null = null;
	let timer = 0;

	function hide(): void {
		window.clearTimeout(timer);
		anchor = null;
		bubble?.remove();
		bubble = null;
	}

	function show(target: HTMLElement): void {
		const name = target.dataset.langName;
		if (!name || !target.isConnected) return;
		bubble?.remove();
		bubble = document.createElement("div");
		bubble.className = "quiz-code-lang-bubble";
		bubble.setAttribute("role", "tooltip");
		bubble.textContent = name;
		document.body.appendChild(bubble);
		const r = target.getBoundingClientRect();
		const b = bubble.getBoundingClientRect();
		const left = Math.max(4, Math.min(r.left + r.width / 2 - b.width / 2, window.innerWidth - b.width - 4));
		bubble.style.left = `${left}px`;
		bubble.style.top = `${Math.max(4, r.top - b.height - GAP_PX)}px`;
		// Next frame, so that the fade-in plays from the hidden state.
		const shown = bubble;
		requestAnimationFrame(() => shown.classList.add("is-visible"));
	}

	function onOver(e: Event): void {
		const target = (e.target as Element | null)?.closest?.<HTMLElement>(".quiz-code-lang");
		if (!target || target === anchor) return;
		hide();
		anchor = target;
		timer = window.setTimeout(() => { if (anchor === target) show(target); }, SHOW_DELAY_MS);
	}

	function onOut(e: Event): void {
		if (!anchor) return;
		const to = (e as PointerEvent).relatedTarget as Node | null;
		if (to && anchor.contains(to)) return;
		hide();
	}

	container.addEventListener("pointerover", onOver);
	container.addEventListener("pointerout", onOut);
	// A scroll moves the logo under the bubble: it goes away rather than float.
	window.addEventListener("scroll", hide, true);
	return () => {
		hide();
		container.removeEventListener("pointerover", onOver);
		container.removeEventListener("pointerout", onOut);
		window.removeEventListener("scroll", hide, true);
	};
}
