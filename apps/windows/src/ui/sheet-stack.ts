/* ══════════════════════════════════════════════════════════
   THE SHEET STACK (2026-09-29)

   Reference: StudySmarter, clicking a study set in its Library, recorded
   over the DevTools protocol with `document.getAnimations()`. It is the
   same Ionic iOS page transition as the quiz launch (`transition-quiz.ts`),
   in a different version:
   - the new page rises from the bottom, `translateY(100%) → 0`, 500 ms,
     `cubic-bezier(0.36, 0.66, 0, 1)` — but only the PAGE: the rail stays;
   - it settles 16 px BELOW the top of the page it covers, which stays
     behind it, narrowed (`scaleX(0.97)`): a stack of sheets whose back one
     shows as a strip above the front one, for as long as the page is open;
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

   SEVERAL LEVELS: the grid, a folder over it, a quiz's page over the
   folder. Each page opened from the one in front pushes a sheet; each back
   arrow pops one. The sheet at level `l` sits `l × 16 px` below the top,
   narrowed by 3 % per level above it, so the strips read as a pile.

   A BACK SHEET is not a real page: the panel (`.qbd-content`) is the
   pages' scroll container and render target, it stays in front and
   receives the new page. A back sheet is a copy of the panel's MATERIAL,
   absolutely positioned over the same column:
     wrap (clips, slides)  >  scaler (narrows)  >  glass panel (counter-slides)
   - on OPEN, the page's live nodes move into the new back panel
     (listeners, scroll position and all), so what recoils is exactly what
     was on screen;
   - at REST, only the strip is left: the wrap is cut to 16 px and holds no
     animation (a `fill: forwards` would stay set for good — the trap of
     `npm run check:view-enter`); the strip is the empty top of a glass
     panel, so a page shown WITHOUT the rise (history, startup) gets the
     same stack with empty back panels (`sync`);
   - on CLOSE, the previous page is painted afresh into the top back panel
     before it comes forward, then once more into the real panel at the
     end, where that sheet is removed: the two paintings are identical, so
     the swap does not show.

   NOTHING UNDER THE GLASS, as for the quiz launch: the front panel is
   glass and would blur the page painted beneath it. The wrap clips its
   children at its own box and slides so that its bottom follows the front
   panel's top edge, while the panel inside slides the other way so that it
   does not move — all in `transform`, all on the compositor, on the same
   frames as the rising panel (see `slidingWindow`). The narrowing lives on
   the SCALER, not on the wrap: the quiz launch animates the `transform` of
   every child of the shell, the wraps included, and would otherwise wipe
   the stack's `scaleX` for its 500 ms.
══════════════════════════════════════════════════════════ */

import { mouvementReduit, transitionCourte } from "./transition-quiz";
import { uneFois } from "./transition-etat";

/* Measured on StudySmarter, identical to the quiz launch's values. */
const DURATION_MS = 500;
const EASING = "cubic-bezier(0.36, 0.66, 0, 1)";
/* How far below a back sheet's top the sheet in front of it settles. */
const STEP_PX = 16;
/* How much narrower a sheet gets per sheet in front of it. */
const STEP_SCALE = 0.03;
/* A fallback timer only, never the normal path (the `finish` events are):
   see `SECOURS_MS` in `transition-quiz.ts`. */
const FALLBACK_MS = DURATION_MS * 4;

/* The title of the page that rises, which fades in while rising: a
   folder's, or a quiz page's. */
const TITLE = ".qbd-quizzes-header, .qbd-fiche-head";
/* A folder's first child, which holds the title: not faded as a whole. */
const HERO = ".qbd-quizzes-folder-hero";

export interface SheetStack {
	/** Plays the rise of a page over the current one, which becomes a back
	    sheet. `paint` repaints the panel with the new page (the old page's
	    nodes have already left it). */
	open(paint: () => void): void;
	/** Plays the return to the page behind. `paint(target)` paints that
	    page into `target`: first the top back sheet, then the real panel at
	    the end. Without a back sheet, paints the panel directly. */
	close(paint: (target: HTMLElement) => void): void;
	/** Puts the stack at `depth` back sheets without animation — the depth
	    the page being painted calls for. Ignored while a transition runs:
	    the transition sets its own end state. */
	sync(depth: number): void;
	/** The number of back sheets. */
	depth(): number;
	/** Removes the stack at once (the shell is unmounted). */
	drop(): void;
}

interface Sheet {
	wrap: HTMLElement;
	scaler: HTMLElement;
	back: HTMLElement;
	level: number;
}

/* The sliding window, as in `transition-quiz.ts` (`fenetreGlissante`),
   with the front sheet settling STEP_PX lower. At progress `p` of the
   rise, the front panel's top edge sits `STEP_PX + d · (1 − p)` below the
   back sheet's top (`d`: the panel's travel), so the wrap, of height `H`,
   slides by `T = min(0, STEP_PX + d · (1 − p) − H)`: zero while the front
   panel is below the back one, then linear in `p` — keyframes interpolate
   linearly on the same eased progress as the panel, so they fall exactly on
   its frames. */
function slidingWindow(height: number, distance: number, rising: boolean): { wrap: Keyframe[]; back: Keyframe[] } {
	const end = STEP_PX - height;
	const points: Array<[number, number]> = distance > height - STEP_PX
		? [[0, 0], [1 - (height - STEP_PX) / distance, 0], [1, end]]
		: [[0, STEP_PX + distance - height], [1, end]];
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

/* The narrowing of the sheet at `level` under a stack `depth` deep. */
function scaleFor(level: number, depth: number): number {
	return 1 - STEP_SCALE * (depth - level);
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

/* The page is painted twice on the way back (the back sheet, then the real
   panel): the second painting restarts its INFINITE animations from zero —
   the shine sweeping a folder's Resume button jumped back at the last
   frame. Their progress is carried over, matched by name in tree order;
   two paintings of the same page have the same list. */
function loops(el: HTMLElement): CSSAnimation[] {
	return el.getAnimations({ subtree: true }).filter((a): a is CSSAnimation =>
		a instanceof CSSAnimation && a.effect?.getTiming().iterations === Infinity);
}

/* Read BEFORE the old painting leaves the DOM: a CSS animation whose
   element is removed is cancelled, and its time lost. */
function loopTimes(el: HTMLElement): Array<{ name: string; time: CSSNumberish | null }> {
	return loops(el).map(a => ({ name: a.animationName, time: a.currentTime }));
}

function carryLoops(from: Array<{ name: string; time: CSSNumberish | null }>, to: HTMLElement): void {
	const next = loops(to);
	if (next.length !== from.length) return;
	next.forEach((a, i) => {
		const old = from[i];
		if (old && old.name === a.animationName && old.time !== null) a.currentTime = old.time;
	});
}

function children(el: HTMLElement): HTMLElement[] {
	return Array.from(el.children).filter((e): e is HTMLElement => e instanceof HTMLElement);
}

export function createSheetStack(layout: HTMLElement, panel: HTMLElement): SheetStack {
	const sheets: Sheet[] = [];
	/* The end of the running transition, if any: called early when another
	   request arrives, so that it starts from a settled page. */
	let settle: (() => void) | null = null;
	/* True while `open`/`close` call their `paint`: the page's render calls
	   `sync`, which must not undo the stack being played. */
	let painting = false;

	function paintWith(fn: () => void): void {
		painting = true;
		try { fn(); } finally { painting = false; }
	}

	function build(level: number): Sheet {
		const wrap = document.createElement("div");
		wrap.className = "nq-sheet-back";
		wrap.inert = true;
		wrap.setAttribute("aria-hidden", "true");
		wrap.style.top = `${level * STEP_PX}px`;
		const scaler = document.createElement("div");
		scaler.className = "nq-sheet-back-scaler";
		const back = document.createElement("div");
		back.className = "qbd-content nq-sheet-back-panel";
		scaler.append(back);
		wrap.append(scaler);
		/* The wrap covers the panel's column: the rail's width is fixed, so
		   the panel's left edge holds when the window is resized. Measured
		   once the shell is the positioning box (`nq-sheet-stack`). Right
		   before the panel: the deeper sheets come first and paint beneath. */
		layout.classList.add("nq-sheet-stack");
		wrap.style.left = `${panel.offsetLeft}px`;
		panel.before(wrap);
		const sheet = { wrap, scaler, back, level };
		sheets.push(sheet);
		return sheet;
	}

	/* The static state of a stack `depth` deep: every sheet cut to its
	   strip and narrowed, the panel lowered under them. */
	function atRest(depth: number): void {
		for (const s of sheets) {
			s.wrap.classList.add("nq-sheet-back--rest");
			s.scaler.style.setProperty("--nq-sheet-scale", String(scaleFor(s.level, depth)));
		}
		panel.style.setProperty("--nq-sheet-depth", String(depth));
		panel.classList.toggle("nq-sheet-front", depth > 0);
		if (depth === 0) layout.classList.remove("nq-sheet-stack");
	}

	function removeAll(): void {
		for (const s of sheets) s.wrap.remove();
		sheets.length = 0;
		atRest(0);
	}

	function immediate(): boolean {
		return mouvementReduit() || transitionCourte() || document.visibilityState === "hidden";
	}

	/** Waits for every animation, the hidden window or the fallback timer —
	    whichever comes first — then runs `end` once. */
	function whenDone(animations: Animation[], end: () => void): void {
		/* Nothing is hit-tested while the pages move: the pointer stays still
		   under sliding pages and would light whatever passes below it (see
		   `nq-en-transition`, shell.css). Dropped on every outcome. */
		layout.classList.add("nq-en-transition");
		const finishAll = uneFois(() => {
			layout.classList.remove("nq-en-transition");
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
		/* The fallback counts WALL-CLOCK time, the animations their own: slowed
		   down or paused (the DevTools Animations panel, 2026-09-29), a
		   transition still under way was cut at 2 s and jumped to its end. So
		   it only settles when nothing is moving any more — every animation
		   done or dropped, the case its `finish` events were lost — and waits
		   again otherwise. */
		const stillMoving = (): boolean => animations.some(a => a.playState === "running" || a.playState === "paused");
		const onFallback = (): void => {
			if (stillMoving()) fallback = window.setTimeout(onFallback, FALLBACK_MS);
			else finishAll();
		};
		let fallback = window.setTimeout(onFallback, FALLBACK_MS);
		document.addEventListener("visibilitychange", onVisibility);
		for (const a of animations) {
			a.addEventListener("finish", onFinish);
			a.addEventListener("cancel", onFinish);
		}
		settle = finishAll;
		if (animations.length === 0) finishAll();
	}

	/* The deeper sheets narrow (open) or widen (close) by one step. */
	function reshape(animations: Animation[], from: number, to: number, base: KeyframeAnimationOptions): void {
		for (const s of sheets) {
			if (s.level >= Math.min(from, to)) continue;
			animations.push(s.scaler.animate(
				[{ transform: `scaleX(${scaleFor(s.level, from)})` }, { transform: `scaleX(${scaleFor(s.level, to)})` }],
				{ ...base, fill: "forwards" },
			));
		}
	}

	return {
		open(paint) {
			settle?.();
			if (immediate()) {
				panel.replaceChildren();
				paint();
				return;
			}
			const depth = sheets.length;
			/* Measured BEFORE anything moves: the page's height and scroll. */
			const height = panel.offsetHeight;
			const scroll = panel.scrollTop;
			const s = build(depth);
			s.back.append(...panel.childNodes);
			s.back.scrollTop = scroll;
			panel.style.setProperty("--nq-sheet-depth", String(depth + 1));
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
				s.scaler.animate([{ transform: "scaleX(1)" }, { transform: `scaleX(${scaleFor(depth, depth + 1)})` }], { ...base, fill: "forwards" }),
				panel.animate([{ transform: `translateY(${distance}px)` }, { transform: "translateY(0)" }], { ...base, fill: "backwards" }),
			];
			reshape(animations, depth, depth + 1, base);
			/* The title fades in while rising, the rest of the page fades in. */
			const title = panel.querySelector<HTMLElement>(TITLE);
			if (title) {
				animations.push(title.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 200, easing: "linear", fill: "backwards" }));
			}
			/* A folder's hero holds its title AND its back arrow: the arrow
			   fades in with the rest of the page, instead of standing there at
			   full opacity from the first frame while everything around it
			   fades in. */
			const hero = panel.querySelector<HTMLElement>(`:scope > ${HERO}`);
			const heroParts = hero ? children(hero.firstElementChild instanceof HTMLElement ? hero.firstElementChild : hero).filter(c => !c.matches(TITLE)) : [];
			for (const child of [...children(panel).filter(c => c !== hero), ...heroParts]) {
				animations.push(child.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: "ease-in-out", fill: "backwards" }));
			}
			whenDone(animations, () => {
				if (!sheets.includes(s)) return;
				/* The old page's nodes have done their part: the strip only
				   shows the empty top of the glass. Emptied, they no longer
				   hold listeners or observers behind the new page. */
				s.back.replaceChildren();
				atRest(sheets.length);
			});
		},

		close(paint) {
			settle?.();
			const s = sheets[sheets.length - 1];
			if (!s || immediate()) {
				/* The page painted next sets the stack it calls for (`sync`). */
				panel.replaceChildren();
				paint(panel);
				return;
			}
			const depth = sheets.length;
			/* The back sheet comes forward with the previous page painted
			   afresh, at the scroll position it will have in the real panel
			   (the top). */
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
				s.scaler.animate([{ transform: `scaleX(${scaleFor(s.level, depth)})` }, { transform: "scaleX(1)" }], { ...base, fill: "both" }),
				/* In front of the back sheets (DOM order already), sliding down.
				   Its CONTENT fades out, not the panel: an opacity on the glass
				   fades its blur with it, and halfway down the sharp wallpaper
				   showed through a half-frosted sheet — a double image, plain to
				   see as soon as the motion is slowed. The glass slides out whole,
				   as the quiz does when it closes (`transition-quiz.ts`). */
				panel.animate([{ transform: "translateY(0)" }, { transform: `translateY(${distance}px)` }], { ...base, fill: "forwards" }),
				...children(panel).map(child => child.animate([{ opacity: 1 }, { opacity: 0 }], { ...base, fill: "forwards" })),
			];
			reshape(animations, depth, depth - 1, base);
			whenDone(animations, () => {
				if (!sheets.includes(s)) return;
				const running = loopTimes(s.back);
				s.wrap.remove();
				sheets.splice(sheets.indexOf(s), 1);
				atRest(sheets.length);
				panel.replaceChildren();
				panel.scrollTop = 0;
				paint(panel);
				carryLoops(running, panel);
			});
		},

		sync(depth) {
			if (settle || painting || sheets.length === depth) return;
			removeAll();
			for (let level = 0; level < depth; level++) build(level);
			atRest(depth);
		},

		depth() {
			return sheets.length;
		},

		drop() {
			settle?.();
			removeAll();
		},
	};
}
