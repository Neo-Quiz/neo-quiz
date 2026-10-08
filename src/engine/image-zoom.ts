import { currentHost } from "../host/current";
import { t } from "../i18n";

/* ══════════════════════════════════════════════════════════
   AN IMAGE OF A QUIZ, LARGER (2026-10-08)

   A diagram drawn from a course page (dashboard/figures.ts) is a whole
   schema shrunk to the width of a phone: its labels cannot be read. A tap
   (or a click) on any picture of a quiz card opens it in a modal, as large
   as the window allows, where it zooms and pans:
   - two fingers pinch, one finger drags once zoomed;
   - the mouse wheel zooms at the cursor, a drag pans;
   - a double tap (or double click) zooms in at that point, or back out;
   - "+", "−" and "fit" buttons do the same without gestures.
   Pictures inside an answer option are left alone: there a tap chooses.

   The arithmetic is PURE (`zoomAutour`, `borner`), checked by
   `npm run check:image-zoom`; the rest only wires it to the DOM.
══════════════════════════════════════════════════════════ */

/** The view of the image: scale, then translation (px), from the top-left
    corner of the image as laid out unzoomed (fitted in the modal). */
export interface Vue { s: number; x: number; y: number }

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;
/** What a double tap or the "+" button zooms to / by. */
export const ZOOM_DOUBLE = 2.5;
const PAS_BOUTON = 1.5;

/** The view zoomed to `s` (kept within [ZOOM_MIN, ZOOM_MAX]) with the point
    (`fx`, `fy`) — in the unzoomed image's coordinates — staying under the
    finger or the cursor. */
export function zoomAutour(v: Vue, s: number, fx: number, fy: number): Vue {
	const borne = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(s) ? s : v.s));
	const k = borne / v.s;
	return { s: borne, x: fx - (fx - v.x) * k, y: fy - (fy - v.y) * k };
}

/** The view kept sane for an image of `w` x `h` (unzoomed): the zoomed
    picture always covers the place of the unzoomed one, so that it can never
    be dragged out of sight (at scale 1, it does not move at all). */
export function borner(v: Vue, w: number, h: number): Vue {
	const s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.s));
	const clamp = (val: number, min: number): number => Math.min(0, Math.max(min, val));
	return { s, x: clamp(v.x, w * (1 - s)), y: clamp(v.y, h * (1 - s)) };
}

/** Pictures a tap must NOT open: a choice is made by tapping them. */
const SANS_ZOOM = ".quiz-option, .quiz-ordering, .quiz-order, .quiz-matching, .quiz-match, button, a";

/**
 * Opens the pictures of a quiz larger on a tap. One listener on the quiz's
 * root, for every card drawn now or later. Returns its removal.
 */
export function installImageZoom(racine: HTMLElement): () => void {
	const surClic = (e: MouseEvent): void => {
		const cible = e.target as Element | null;
		const img = cible?.closest?.("img") as HTMLImageElement | null;
		if (!img || !racine.contains(img) || !img.closest(".quiz-card") || img.closest(SANS_ZOOM)) return;
		if (!img.currentSrc && !img.src) return;
		e.preventDefault();
		e.stopPropagation();
		ouvrirImage(img.currentSrc || img.src, img.alt);
	};
	racine.addEventListener("click", surClic);
	return () => racine.removeEventListener("click", surClic);
}

/** The modal itself. A host without modals (none today) opens nothing. */
export function ouvrirImage(src: string, alt: string): void {
	const modals = currentHost().modals;
	if (!modals) return;
	modals.open({
		className: "qbd-image-modal",
		onOpen(handle) {
			const scene = document.createElement("div");
			scene.className = "qbd-image-scene";
			const img = document.createElement("img");
			img.className = "qbd-image-zoom";
			img.src = src;
			img.alt = alt;
			img.draggable = false;
			scene.appendChild(img);
			const barre = document.createElement("div");
			barre.className = "qbd-image-barre";
			handle.contentEl.append(scene, barre);

			let vue: Vue = { s: 1, x: 0, y: 0 };
			const appliquer = (v: Vue): void => {
				vue = borner(v, img.offsetWidth, img.offsetHeight);
				img.style.transform = `translate(${vue.x}px, ${vue.y}px) scale(${vue.s})`;
				scene.classList.toggle("is-zoomed", vue.s > 1.001);
			};
			/** A point of the window in the unzoomed image's coordinates. */
			const local = (cx: number, cy: number): [number, number] => {
				const r = scene.getBoundingClientRect();
				return [cx - r.left - img.offsetLeft, cy - r.top - img.offsetTop];
			};
			const centre = (): [number, number] => [img.offsetWidth / 2, img.offsetHeight / 2];

			const bouton = (icone: string, cle: "engine.image.zoomOut" | "engine.image.zoomIn" | "engine.image.fit", geste: () => void): void => {
				const b = document.createElement("button");
				b.type = "button";
				b.className = "qbd-image-bouton";
				b.setAttribute("aria-label", t(cle));
				b.title = t(cle);
				currentHost().ui.setIcon(b, icone);
				b.addEventListener("click", geste);
				barre.appendChild(b);
			};
			bouton("zoom-out", "engine.image.zoomOut", () => appliquer(zoomAutour(vue, vue.s / PAS_BOUTON, ...centre())));
			bouton("zoom-in", "engine.image.zoomIn", () => appliquer(zoomAutour(vue, vue.s * PAS_BOUTON, ...centre())));
			bouton("maximize", "engine.image.fit", () => appliquer({ s: 1, x: 0, y: 0 }));

			// The mouse wheel: zoom at the cursor.
			scene.addEventListener("wheel", e => {
				e.preventDefault();
				appliquer(zoomAutour(vue, vue.s * Math.exp(-e.deltaY * 0.0015), ...local(e.clientX, e.clientY)));
			}, { passive: false });

			// Fingers and mouse: pinch, drag, double tap.
			const pointeurs = new Map<number, { x: number; y: number }>();
			let tap: { t: number; x: number; y: number; bouge: boolean } | null = null;
			let dernierTap: { t: number; x: number; y: number } | null = null;
			scene.addEventListener("pointerdown", e => {
				scene.setPointerCapture(e.pointerId);
				pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
				tap = pointeurs.size === 1 ? { t: e.timeStamp, x: e.clientX, y: e.clientY, bouge: false } : null;
			});
			scene.addEventListener("pointermove", e => {
				const avant = pointeurs.get(e.pointerId);
				if (!avant) return;
				const ancien = [...pointeurs.values()];
				pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
				if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap.bouge = true;
				if (pointeurs.size === 2) {
					const neuf = [...pointeurs.values()];
					const d0 = Math.hypot(ancien[0].x - ancien[1].x, ancien[0].y - ancien[1].y);
					const d1 = Math.hypot(neuf[0].x - neuf[1].x, neuf[0].y - neuf[1].y);
					const m0 = local((ancien[0].x + ancien[1].x) / 2, (ancien[0].y + ancien[1].y) / 2);
					const m1 = local((neuf[0].x + neuf[1].x) / 2, (neuf[0].y + neuf[1].y) / 2);
					if (d0 > 0) {
						const z = zoomAutour(vue, vue.s * (d1 / d0), m0[0], m0[1]);
						appliquer({ s: z.s, x: z.x + m1[0] - m0[0], y: z.y + m1[1] - m0[1] });
					}
				} else if (pointeurs.size === 1 && vue.s > 1) {
					appliquer({ s: vue.s, x: vue.x + e.clientX - avant.x, y: vue.y + e.clientY - avant.y });
				}
			});
			const fin = (e: PointerEvent): void => {
				pointeurs.delete(e.pointerId);
				if (!tap || tap.bouge || pointeurs.size > 0 || e.type === "pointercancel" || e.timeStamp - tap.t > 300) { if (pointeurs.size === 0) tap = null; return; }
				const ici = { t: e.timeStamp, x: e.clientX, y: e.clientY };
				tap = null;
				if (dernierTap && ici.t - dernierTap.t < 320 && Math.hypot(ici.x - dernierTap.x, ici.y - dernierTap.y) < 30) {
					dernierTap = null;
					appliquer(vue.s > 1.001 ? { s: 1, x: 0, y: 0 } : zoomAutour(vue, ZOOM_DOUBLE, ...local(ici.x, ici.y)));
				} else dernierTap = ici;
			};
			scene.addEventListener("pointerup", fin);
			scene.addEventListener("pointercancel", fin);
		},
	});
}
