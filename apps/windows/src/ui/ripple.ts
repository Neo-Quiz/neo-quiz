/* ══════════════════════════════════════════════════════════
   TOUCH RIPPLE (Android app, touch-first devices only)

   A Material-like press feedback without touching the tapped element's DOM
   or styles: one clip box per press, appended to <body>, fixed over the
   target's rectangle with the target's corner radius, holding a circle that
   grows from the touch point (transform + opacity only, compositor-driven).
   Nothing is inserted inside the target, so `:last-child`, flex gaps and
   card layouts stay as they were.

   Like Android's own ripple, it waits ~80 ms before showing: a touch that
   becomes a scroll fires `pointercancel` (or moves past the slop) first and
   shows nothing, so scrolling a list never flashes the cards under the finger.
══════════════════════════════════════════════════════════ */

const TARGETS = [
	"button:not(:disabled)",
	"[role='button']:not([aria-disabled='true'])",
	"a[href]",
	"summary",
	".qbd-nav-item:not(.qbd-nav-item--placeholder)",
	".qbd-quiz-card",
	".qbd-module-card",
	".qbd-qz-card",
	".qbd-fiche-card.is-editable",
	".quiz-option",
].join(", ");

const SHOW_DELAY_MS = 80;
const SLOP_PX = 10;
const GROW_MS = 320;
const FADE_MS = 260;
const COLOR = "rgb(255 255 255 / 0.14)";

export function installRipple(): void {
	if (!window.matchMedia("(pointer: coarse)").matches) return;
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

	let timer = 0;
	let active: { clip: HTMLElement; dot: HTMLElement; grown: Promise<unknown> } | null = null;
	let pending: { x: number; y: number; target: HTMLElement } | null = null;

	const drop = (fade: boolean): void => {
		window.clearTimeout(timer);
		pending = null;
		const shown = active;
		active = null;
		if (!shown) return;
		if (!fade) { shown.clip.remove(); return; }
		const out = shown.clip.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: "linear", fill: "forwards" });
		// Let the growth finish first so a quick tap still reads as a ripple.
		void Promise.all([shown.grown, out.finished]).then(() => shown.clip.remove(), () => shown.clip.remove());
	};

	const show = (): void => {
		const p = pending;
		pending = null;
		if (!p || !p.target.isConnected) return;
		const r = p.target.getBoundingClientRect();
		if (r.width < 8 || r.height < 8) return;
		const radius = getComputedStyle(p.target).borderRadius;
		const clip = document.createElement("div");
		clip.setAttribute("aria-hidden", "true");
		Object.assign(clip.style, {
			position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
			borderRadius: radius, overflow: "hidden", pointerEvents: "none", zIndex: "2147483000", contain: "strict",
		});
		const reach = Math.hypot(Math.max(p.x - r.left, r.right - p.x), Math.max(p.y - r.top, r.bottom - p.y));
		const dot = document.createElement("div");
		Object.assign(dot.style, {
			position: "absolute", left: `${p.x - r.left - reach}px`, top: `${p.y - r.top - reach}px`,
			width: `${reach * 2}px`, height: `${reach * 2}px`, borderRadius: "50%", background: COLOR, willChange: "transform",
		});
		clip.append(dot);
		document.body.append(clip);
		const grown = dot.animate([{ transform: "scale(0.15)" }, { transform: "scale(1)" }], { duration: GROW_MS, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "forwards" }).finished;
		active = { clip, dot, grown };
	};

	document.addEventListener("pointerdown", (e) => {
		drop(false);
		if (e.pointerType !== "touch" || !(e.target instanceof Element)) return;
		const target = e.target.closest<HTMLElement>(TARGETS);
		if (!target) return;
		pending = { x: e.clientX, y: e.clientY, target };
		timer = window.setTimeout(show, SHOW_DELAY_MS);
	}, { passive: true, capture: true });

	document.addEventListener("pointermove", (e) => {
		if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > SLOP_PX) drop(false);
	}, { passive: true, capture: true });

	const release = (): void => {
		// A tap shorter than the delay still gets its ripple, shown at once.
		if (pending) { window.clearTimeout(timer); show(); }
		drop(true);
	};
	document.addEventListener("pointerup", release, { passive: true, capture: true });
	document.addEventListener("pointercancel", () => drop(false), { passive: true, capture: true });
}
