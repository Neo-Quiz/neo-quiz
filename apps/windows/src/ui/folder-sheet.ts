/* ══════════════════════════════════════════════════════════
   THE FOLDER SHEET (2026-09-29)

   Reference: StudySmarter, clicking a study set in its Library, recorded
   over the DevTools protocol with `document.getAnimations()`. It is the
   same Ionic iOS page transition as the quiz launch (`transition-quiz.ts`),
   in a different version:
   - the new page rises from the bottom, `translateY(100%) → 0`, 500 ms,
     `cubic-bezier(0.36, 0.66, 0, 1)` — but only the PAGE: the rail stays;
   - it settles 16 px BELOW the top of the page it covers, which stays
     behind it, narrowed (`scaleX(0.97)`): a stack of two sheets whose back
     one shows as a strip above the front one, for as long as the study set
     is open;
   - no content that slides on its own: the title fades in while rising
     10 px (200 ms, linear), the rest of the page fades in (250 ms);
   - the background tint moves to the set's colour (400 ms, same curve) —
     here the folder's glow, which `quizzes.ts` already sets through
     `ctx.ambiance`;
   - back: the front page slides down while fading out, the back one widens
     again. Same curve, keyframes reversed rather than `direction:
     "reverse"`, which would reverse the curve as well.
   Not kept: the back page's opacity (0.5 at the end, back to 1 by 30 % of
   the return). An opacity on a glass panel's ancestor made it lose its blur
   during the quiz launch, and the darkening was dropped there on
   2026-09-27 ("it spoils the transition"); the two transitions keep the
   same rule.

   THE BACK SHEET is not the grid's real panel: the panel (`.qbd-content`)
   is the page's scroll container and `quizzes.ts`'s render target, it
   stays in front and receives the folder. The back sheet is a copy of the
   panel's MATERIAL, absolutely positioned over the same column:
     wrap (clips, slides)  >  scaler (narrows)  >  glass panel (counter-slides)
   - on OPEN, the grid's live nodes move into the back panel (listeners,
     scroll position and all), so what recoils is exactly what was on
     screen;
   - at REST, only the strip is left: the wrap is cut to 16 px and holds no
     animation (a `fill: forwards` would stay set for good — the trap of
     `npm run check:view-enter`); the strip is the empty top of a glass
     panel, so a folder shown WITHOUT the rise (history, back from a quiz's
     page, startup) gets the same stack with an empty back panel;
   - on CLOSE, the grid is painted afresh into the back panel before it
     comes forward, then once more into the real panel at the end, where
     the back sheet is removed: the two paintings are identical, so the
     swap does not show.

   NOTHING UNDER THE GLASS, as for the quiz launch: the front panel is
   glass and would blur the grid painted beneath it. The wrap clips its
   children at its own box and slides so that its bottom follows the front
   panel's top edge, while the panel inside slides the other way so that it
   does not move — all in `transform`, all on the compositor, on the same
   frames as the rising panel (see `slidingWindow`). The narrowing lives on
   the SCALER, not on the wrap: the quiz launch animates the `transform` of
   every child of the shell, the wrap included, and would otherwise wipe
   the stack's `scaleX` for its 500 ms.
══════════════════════════════════════════════════════════ */

import { mouvementReduit } from "./transition-quiz";
import { uneFois } from "./transition-etat";

/* Measured on StudySmarter, identical to the quiz launch's values. */
const DURATION_MS = 500;
const EASING = "cubic-bezier(0.36, 0.66, 0, 1)";
/* How far below the back sheet's top the front one settles. */
const OFFSET_PX = 16;
const NARROWED = 0.97;
/* A fallback timer only, never the normal path (the `finish` events are):
   see `SECOURS_MS` in `transition-quiz.ts`. */
const FALLBACK_MS = DURATION_MS * 4;

/* The title of an open folder, which fades in while rising. */
const TITLE = ".qbd-quizzes-header";
/* The panel's first child in a folder, which holds the title. */
const HERO = ".qbd-quizzes-folder-hero";

export interface FolderSheet {
	/** Plays the rise of a folder over the grid. `paint` repaints the panel
	    with the folder (the grid's nodes have already left it). */
	open(paint: () => void): void;
	/** Plays the return to the grid. `paint(target)` paints the GRID into
	    `target`: first the back sheet, then the real panel at the end.
	    Without a stack, paints the panel directly. */
	close(paint: (target: HTMLElement) => void): void;
	/** Puts the page in the state its view calls for, without animation:
	    a folder is stacked on a back sheet, anything else is not. Ignored
	    while a transition runs — the transition sets its own end state. */
	sync(inFolder: boolean): void;
	/** Removes the stack at once (the shell is unmounted). */
	drop(): void;
}

interface Stack {
	wrap: HTMLElement;
	scaler: HTMLElement;
	back: HTMLElement;
}

/* The sliding window, as in `transition-quiz.ts` (`fenetreGlissante`),
   with the front sheet settling OFFSET_PX lower. At progress `p` of the
   rise, the front panel's top edge sits `OFFSET_PX + d · (1 − p)` below the
   back sheet's top (`d`: the panel's travel), so the wrap, of height `H`,
   slides by `T = min(0, OFFSET_PX + d · (1 − p) − H)`: zero while the front
   panel is below the back one, then linear in `p` — keyframes interpolate
   linearly on the same eased progress as the panel, so they fall exactly on
   its frames. */
function slidingWindow(height: number, distance: number, rising: boolean): { wrap: Keyframe[]; back: Keyframe[] } {
	const end = OFFSET_PX - height;
	const points: Array<[number, number]> = distance > height - OFFSET_PX
		? [[0, 0], [1 - (height - OFFSET_PX) / distance, 0], [1, end]]
		: [[0, OFFSET_PX + distance - height], [1, end]];
	const ordered = rising ? points : points.map(([o, t]): [number, number] => [1 - o, t]).reverse();
	return {
		wrap: ordered.map(([o, t]) => ({ offset: o, transform: `translateY(${t}px)` })),
		back: ordered.map(([o, t]) => ({ offset: o, transform: `translateY(${-t}px)` })),
	};
}

/* The panel's travel: from the bottom of the WINDOW, not `translateY(100%)`
   — the panel does not fill the window (see `distanceHorsFenetre`,
   `transition-quiz.ts`). Measured at rest. */
function travel(panel: HTMLElement): number {
	return Math.max(0, window.innerHeight - panel.getBoundingClientRect().top);
}

/**
 * The page's own entry is absorbed, as for the quiz launch
 * (`absorberEntree`): `finish()`, so that `markViewEnter` still gets its
 * `animationend` and drops its class. Infinite animations (the path that
 * scrolls in a folder card's footer) are not entries: left alone.
 */
function absorbEntry(el: HTMLElement): void {
	for (const a of el.getAnimations({ subtree: true })) {
		if (!(a instanceof CSSAnimation) || !a.animationName.startsWith("qbd-")) continue;
		if (a.effect?.getTiming().iterations === Infinity) continue;
		a.finish();
	}
}

function children(el: HTMLElement): HTMLElement[] {
	return Array.from(el.children).filter((e): e is HTMLElement => e instanceof HTMLElement);
}

export function createFolderSheet(layout: HTMLElement, panel: HTMLElement): FolderSheet {
	let stack: Stack | null = null;
	/* The end of the running transition, if any: called early when another
	   request arrives, so that it starts from a settled page. */
	let settle: (() => void) | null = null;

	function build(): Stack {
		const wrap = document.createElement("div");
		wrap.className = "nq-sheet-back";
		wrap.inert = true;
		wrap.setAttribute("aria-hidden", "true");
		const scaler = document.createElement("div");
		scaler.className = "nq-sheet-back-scaler";
		const back = document.createElement("div");
		back.className = "qbd-content nq-sheet-back-panel";
		scaler.append(back);
		wrap.append(scaler);
		/* The wrap covers the panel's column: the rail's width is fixed, so
		   the panel's left edge holds when the window is resized. Measured
		   once the shell is the positioning box (`nq-sheet-stack`). */
		layout.classList.add("nq-sheet-stack");
		wrap.style.left = `${panel.offsetLeft}px`;
		panel.before(wrap);
		return { wrap, scaler, back };
	}

	/* True while `open`/`close` call their `paint`: the page's render calls
	   `sync`, which must not undo the stack being played. */
	let painting = false;
	function paintWith(fn: () => void): void {
		painting = true;
		try { fn(); } finally { painting = false; }
	}

	function atRest(s: Stack): void {
		s.wrap.classList.add("nq-sheet-back--rest");
		panel.classList.add("nq-sheet-front");
	}

	function remove(): void {
		if (!stack) return;
		stack.wrap.remove();
		stack = null;
		layout.classList.remove("nq-sheet-stack");
		panel.classList.remove("nq-sheet-front");
	}

	function immediate(): boolean {
		return mouvementReduit() || document.visibilityState === "hidden";
	}

	/** Waits for every animation, the hidden window or the fallback timer —
	    whichever comes first — then runs `end` once. */
	function whenDone(animations: Animation[], end: () => void): void {
		const finishAll = uneFois(() => {
			clearTimeout(fallback);
			document.removeEventListener("visibilitychange", onVisibility);
			for (const a of animations) {
				a.removeEventListener("finish", onFinish);
				a.removeEventListener("cancel", onFinish);
				/* `cancel`: nothing is left in `document.getAnimations()`,
				   the end state is set statically by `end`. */
				a.cancel();
			}
			settle = null;
			end();
		});
		let left = animations.length;
		const onFinish = (): void => { if (--left <= 0) finishAll(); };
		const onVisibility = (): void => { if (document.visibilityState === "hidden") finishAll(); };
		const fallback = window.setTimeout(finishAll, FALLBACK_MS);
		document.addEventListener("visibilitychange", onVisibility);
		for (const a of animations) {
			a.addEventListener("finish", onFinish);
			a.addEventListener("cancel", onFinish);
		}
		settle = finishAll;
		if (animations.length === 0) finishAll();
	}

	return {
		open(paint) {
			settle?.();
			if (immediate()) {
				panel.replaceChildren();
				paint();
				return;
			}
			/* Measured BEFORE anything moves: the grid's height and scroll. */
			const height = panel.offsetHeight;
			const scroll = panel.scrollTop;
			remove();
			const s = build();
			stack = s;
			s.back.append(...panel.childNodes);
			s.back.scrollTop = scroll;
			panel.classList.add("nq-sheet-front");
			panel.scrollTop = 0;
			paintWith(paint);
			absorbEntry(panel);

			const base: KeyframeAnimationOptions = { duration: DURATION_MS, easing: EASING };
			const distance = travel(panel);
			const win = slidingWindow(height, distance, true);
			const animations: Animation[] = [
				s.wrap.animate(win.wrap, { ...base, fill: "forwards" }),
				s.back.animate(win.back, { ...base, fill: "forwards" }),
				s.scaler.animate([{ transform: "scaleX(1)" }, { transform: `scaleX(${NARROWED})` }], { ...base, fill: "forwards" }),
				panel.animate([{ transform: `translateY(${distance}px)` }, { transform: "translateY(0)" }], { ...base, fill: "backwards" }),
			];
			/* The title fades in while rising, the rest of the page fades in. */
			const title = panel.querySelector<HTMLElement>(TITLE);
			if (title) {
				animations.push(title.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 200, easing: "linear", fill: "backwards" }));
			}
			for (const child of children(panel)) {
				if (child.matches(HERO)) continue;
				animations.push(child.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: "ease-in-out", fill: "backwards" }));
			}
			whenDone(animations, () => {
				if (stack !== s) return;
				/* The grid's nodes have done their part: the strip only shows
				   the empty top of the glass. Emptied, they no longer hold
				   listeners or observers behind the folder. */
				s.back.replaceChildren();
				atRest(s);
			});
		},

		close(paint) {
			settle?.();
			const s = stack;
			if (!s || immediate()) {
				remove();
				panel.replaceChildren();
				paint(panel);
				return;
			}
			/* The back sheet comes forward with the grid painted afresh, at
			   the scroll position it will have in the real panel (the top). */
			s.wrap.classList.remove("nq-sheet-back--rest");
			s.back.replaceChildren();
			paintWith(() => paint(s.back));
			absorbEntry(s.back);
			const height = s.wrap.offsetHeight;
			const distance = travel(panel);
			const win = slidingWindow(height, distance, false);
			const base: KeyframeAnimationOptions = { duration: DURATION_MS, easing: EASING };
			const animations: Animation[] = [
				s.wrap.animate(win.wrap, { ...base, fill: "both" }),
				s.back.animate(win.back, { ...base, fill: "both" }),
				s.scaler.animate([{ transform: `scaleX(${NARROWED})` }, { transform: "scaleX(1)" }], { ...base, fill: "both" }),
				/* In front of the back sheet (DOM order already), sliding down
				   while fading out. */
				panel.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${distance}px)`, opacity: 0 }], { ...base, fill: "forwards" }),
			];
			whenDone(animations, () => {
				if (stack !== s) return;
				remove();
				panel.replaceChildren();
				panel.scrollTop = 0;
				paint(panel);
			});
		},

		sync(inFolder) {
			if (settle || painting) return;
			if (!inFolder) { remove(); return; }
			if (stack) return;
			stack = build();
			atRest(stack);
		},

		drop() {
			settle?.();
			remove();
		},
	};
}
