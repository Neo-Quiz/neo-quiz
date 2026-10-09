import { currentHost } from "../host/current";
import { t } from "../i18n";

/* ══════════════════════════════════════════════════════════
   AN IMAGE OF A QUIZ, LARGER (2026-10-08, redone 2026-10-09)

   A diagram drawn from a course page (dashboard/figures.ts) is a whole schema
   shrunk to a card: its labels cannot be read. A tap (or a click) on any
   picture of a quiz card opens a VIEWER over the whole window, as Windows
   Photos does: the picture grows out of its thumbnail onto a dark backdrop,
   fitted to the window, and then
   - the wheel (or a touchpad pinch) zooms around the cursor;
   - two fingers pinch, one finger or the mouse drags once zoomed, and a
     drag flung lets the picture glide on (inertia);
   - a double click or double tap zooms in at that point, or back to fit;
   - a floating bar shows the zoom level and has −, +, fit, real size and
     close; the keys +, −, 0 (fit), 1 (real size) and Escape do the same;
   - a click on the backdrop, Escape, or (touch, not zoomed) a swipe down
     closes it, the picture shrinking back into its thumbnail.
   Pictures inside an answer option are left alone: there a tap chooses.

   CURSORS: only Windows' own (2026-10-09). `pointer` (the system hand) on a
   picture that opens, `move` (the system four-way arrow) on a zoomed one
   while it can be dragged. `zoom-in` and `grab` are images Chromium draws
   itself and look foreign on Windows.

   The arithmetic is PURE (`zoomAutour`, `ajuster`, `echelleAjustee`),
   checked by `npm run check:image-zoom`; the rest wires it to the DOM.
══════════════════════════════════════════════════════════ */

/** The view: the picture's scale relative to its NATURAL size, and the
    position (px) of its top-left corner in the viewer. */
export interface Vue { s: number; x: number; y: number }

/** Never zoomed in further than this many times the picture's own pixels. */
export const ZOOM_MAX = 8;
/** A double tap or "+" zooms this many times the fitted scale, at least to real size. */
const FACTEUR_BOUTON = 1.6;
const MARGE = 24;

/** The scale that fits a `nw` x `nh` picture in a `vw` x `vh` viewer, with a
    margin, never enlarged past twice its own pixels (a small picture stays
    sharp). */
export function echelleAjustee(nw: number, nh: number, vw: number, vh: number): number {
	if (!(nw > 0 && nh > 0 && vw > 0 && vh > 0)) return 1;
	return Math.min(2, Math.max(0.01, Math.min((vw - 2 * MARGE) / nw, (vh - 2 * MARGE) / nh)));
}

/** The view zoomed to `s` (bounded by `min` and `ZOOM_MAX`) with the point
    (`px`, `py`) of the viewer staying under the finger or the cursor. */
export function zoomAutour(v: Vue, s: number, px: number, py: number, min: number): Vue {
	const borne = Math.min(ZOOM_MAX, Math.max(min, Number.isFinite(s) ? s : v.s));
	const k = borne / v.s;
	return { s: borne, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
}

/** The view kept sane in a `vw` x `vh` viewer: along an axis where the
    picture is smaller than the viewer it is centred; where it is larger, its
    edges never come inside the viewer (no empty band while dragging). */
export function ajuster(v: Vue, nw: number, nh: number, vw: number, vh: number): Vue {
	const w = nw * v.s, h = nh * v.s;
	const axe = (pos: number, taille: number, vue: number): number =>
		taille <= vue ? (vue - taille) / 2 : Math.min(0, Math.max(vue - taille, pos));
	return { s: v.s, x: axe(v.x, w, vw), y: axe(v.y, h, vh) };
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
		ouvrirImage(img);
	};
	racine.addEventListener("click", surClic);
	return () => racine.removeEventListener("click", surClic);
}

const reduit = (): boolean => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** The viewer, over the whole window. */
export function ouvrirImage(source: HTMLImageElement): void {
	const host = currentHost();
	const rendreFocus = document.activeElement as HTMLElement | null;
	const voile = document.createElement("div");
	voile.className = "qbd-visionneuse";
	voile.setAttribute("role", "dialog");
	voile.setAttribute("aria-modal", "true");
	voile.setAttribute("aria-label", source.alt || t("engine.image.viewer"));
	voile.tabIndex = -1;
	const img = document.createElement("img");
	img.className = "qbd-visionneuse-image";
	img.src = source.currentSrc || source.src;
	img.alt = source.alt;
	img.draggable = false;
	const barre = document.createElement("div");
	barre.className = "qbd-visionneuse-barre";
	voile.append(img, barre);
	document.body.append(voile);

	const nw = (): number => img.naturalWidth || source.naturalWidth || 1;
	const nh = (): number => img.naturalHeight || source.naturalHeight || 1;
	const vw = (): number => voile.clientWidth;
	const vh = (): number => voile.clientHeight;
	const fit = (): number => echelleAjustee(nw(), nh(), vw(), vh());
	const vueAjustee = (): Vue => ajuster({ s: fit(), x: 0, y: 0 }, nw(), nh(), vw(), vh());

	let vue: Vue = vueAjustee();
	const niveau = document.createElement("button");
	const poser = (v: Vue, transition = false): void => {
		vue = ajuster(v, nw(), nh(), vw(), vh());
		img.classList.toggle("is-anime", transition && !reduit());
		img.style.transform = `translate(${vue.x}px, ${vue.y}px) scale(${vue.s})`;
		const zoome = vue.s > fit() * 1.001;
		voile.classList.toggle("is-zoome", zoome);
		niveau.textContent = `${Math.round(vue.s * 100)} %`;
	};
	/** The picture placed exactly over its thumbnail (open and close). */
	const vueVignette = (): Vue => {
		const r = source.getBoundingClientRect();
		const v = voile.getBoundingClientRect();
		return { s: r.width / nw(), x: r.left - v.left, y: r.top - v.top };
	};

	/* The floating bar. Icons from the host (Lucide), names for screen readers. */
	const bouton = (icone: string, cle: "engine.image.zoomOut" | "engine.image.zoomIn" | "engine.image.fit" | "engine.image.actualSize" | "engine.hint.close", geste: () => void): HTMLButtonElement => {
		const b = document.createElement("button");
		b.type = "button";
		b.className = "qbd-visionneuse-bouton";
		b.setAttribute("aria-label", t(cle));
		b.title = t(cle);
		host.ui.setIcon(b, icone);
		b.addEventListener("click", ev => { ev.stopPropagation(); geste(); });
		return b;
	};
	const centre = (): [number, number] => [vw() / 2, vh() / 2];
	const zoomPar = (k: number): void => poser(zoomAutour(vue, vue.s * k, ...centre(), fit()), true);
	niveau.type = "button";
	niveau.className = "qbd-visionneuse-niveau";
	niveau.title = t("engine.image.actualSize");
	niveau.addEventListener("click", ev => { ev.stopPropagation(); basculer(...centre()); });
	barre.append(
		bouton("zoom-out", "engine.image.zoomOut", () => zoomPar(1 / FACTEUR_BOUTON)),
		niveau,
		bouton("zoom-in", "engine.image.zoomIn", () => zoomPar(FACTEUR_BOUTON)),
		bouton("maximize", "engine.image.fit", () => poser(vueAjustee(), true)),
		bouton("scan", "engine.image.actualSize", () => poser(zoomAutour(vue, 1, ...centre(), fit()), true)),
		bouton("x", "engine.hint.close", () => fermer()),
	);

	/** Fit ⇄ zoomed in at a point (double click, double tap, the level). */
	function basculer(px: number, py: number): void {
		const cible = vue.s > fit() * 1.001 ? null : Math.max(1, fit() * 2.5);
		poser(cible === null ? vueAjustee() : zoomAutour(vue, cible, px, py, fit()), true);
	}

	/* Open: from the thumbnail to the fitted view. */
	const ouvrir = (): void => {
		poser(vueVignette());
		void img.offsetWidth;
		voile.classList.add("is-ouvert");
		poser(vueAjustee(), true);
	};
	if (img.complete && img.naturalWidth) ouvrir(); else img.addEventListener("load", ouvrir, { once: true });

	let ferme = false;
	function fermer(): void {
		if (ferme) return;
		ferme = true;
		arreterInertie();
		document.removeEventListener("keydown", surTouche, true);
		window.removeEventListener("resize", surRedim);
		voile.classList.remove("is-ouvert");
		voile.classList.add("is-fermeture");
		const fin = (): void => { voile.remove(); rendreFocus?.focus?.(); };
		if (reduit() || !source.isConnected) { fin(); return; }
		poser(vueVignette(), true);
		img.addEventListener("transitionend", fin, { once: true });
		window.setTimeout(fin, 320);
	}

	function surTouche(e: KeyboardEvent): void {
		if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fermer(); }
		else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomPar(FACTEUR_BOUTON); }
		else if (e.key === "-") { e.preventDefault(); zoomPar(1 / FACTEUR_BOUTON); }
		else if (e.key === "0") { e.preventDefault(); poser(vueAjustee(), true); }
		else if (e.key === "1") { e.preventDefault(); poser(zoomAutour(vue, 1, ...centre(), fit()), true); }
	}
	document.addEventListener("keydown", surTouche, true);
	const surRedim = (): void => poser(vue.s < fit() ? vueAjustee() : vue);
	window.addEventListener("resize", surRedim);
	voile.focus();

	/* The wheel: zoom around the cursor; a touchpad pinch arrives as a wheel with ctrlKey. */
	voile.addEventListener("wheel", e => {
		e.preventDefault();
		arreterInertie();
		const r = voile.getBoundingClientRect();
		const pas = e.ctrlKey ? 0.01 : 0.0015;
		poser(zoomAutour(vue, vue.s * Math.exp(-e.deltaY * pas), e.clientX - r.left, e.clientY - r.top, fit()));
	}, { passive: false });

	/* Pointers: pinch, drag with inertia, double tap, swipe down to close. */
	const pointeurs = new Map<number, { x: number; y: number }>();
	let geste: { x0: number; y0: number; t0: number; bouge: boolean; surImage: boolean } | null = null;
	let dernierTap: { t: number; x: number; y: number } | null = null;
	let vitesse = { x: 0, y: 0, t: 0 };
	let descente = 0;
	let inertie = 0;
	function arreterInertie(): void { if (inertie) { cancelAnimationFrame(inertie); inertie = 0; } }
	const local = (cx: number, cy: number): [number, number] => {
		const r = voile.getBoundingClientRect();
		return [cx - r.left, cy - r.top];
	};
	voile.addEventListener("pointerdown", e => {
		if ((e.target as Element).closest(".qbd-visionneuse-barre")) return;
		arreterInertie();
		voile.setPointerCapture(e.pointerId);
		pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
		geste = pointeurs.size === 1 ? { x0: e.clientX, y0: e.clientY, t0: e.timeStamp, bouge: false, surImage: e.target === img } : null;
		vitesse = { x: 0, y: 0, t: e.timeStamp };
		descente = 0;
		voile.classList.add("is-saisie");
	});
	voile.addEventListener("pointermove", e => {
		const avant = pointeurs.get(e.pointerId);
		if (!avant) return;
		const ancien = [...pointeurs.values()];
		pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (geste && Math.hypot(e.clientX - geste.x0, e.clientY - geste.y0) > 6) geste.bouge = true;
		if (pointeurs.size === 2) {
			const neuf = [...pointeurs.values()];
			const d0 = Math.hypot(ancien[0].x - ancien[1].x, ancien[0].y - ancien[1].y);
			const d1 = Math.hypot(neuf[0].x - neuf[1].x, neuf[0].y - neuf[1].y);
			const [m0x, m0y] = local((ancien[0].x + ancien[1].x) / 2, (ancien[0].y + ancien[1].y) / 2);
			const [m1x, m1y] = local((neuf[0].x + neuf[1].x) / 2, (neuf[0].y + neuf[1].y) / 2);
			if (d0 > 0) {
				const z = zoomAutour(vue, vue.s * (d1 / d0), m0x, m0y, fit());
				poser({ s: z.s, x: z.x + m1x - m0x, y: z.y + m1y - m0y });
			}
			return;
		}
		const dx = e.clientX - avant.x, dy = e.clientY - avant.y;
		const dt = Math.max(1, e.timeStamp - vitesse.t);
		vitesse = { x: 0.8 * (dx / dt) + 0.2 * vitesse.x, y: 0.8 * (dy / dt) + 0.2 * vitesse.y, t: e.timeStamp };
		if (vue.s > fit() * 1.001) {
			poser({ s: vue.s, x: vue.x + dx, y: vue.y + dy });
		} else if (e.pointerType === "touch" && geste?.bouge) {
			// Not zoomed, on a touch screen: a swipe down takes the picture with it.
			descente = Math.max(0, e.clientY - (geste?.y0 ?? e.clientY));
			const base = vueAjustee();
			img.style.transform = `translate(${base.x}px, ${base.y + descente}px) scale(${base.s})`;
			voile.style.setProperty("--voile-opacite", String(Math.max(0.3, 1 - descente / 400)));
		}
	});
	const fin = (e: PointerEvent): void => {
		if (!pointeurs.delete(e.pointerId)) return;
		if (pointeurs.size > 0) return;
		voile.classList.remove("is-saisie");
		const g = geste;
		geste = null;
		if (descente > 0) {
			voile.style.removeProperty("--voile-opacite");
			if (descente > 110) { fermer(); return; }
			poser(vueAjustee(), true);
			descente = 0;
			return;
		}
		if (!g || e.type === "pointercancel") return;
		if (g.bouge) {
			// A drag flung: the picture glides on and slows down.
			if (vue.s > fit() * 1.001 && Math.hypot(vitesse.x, vitesse.y) > 0.25 && !reduit()) {
				let vx = vitesse.x * 16, vy = vitesse.y * 16;
				const pas = (): void => {
					vx *= 0.92; vy *= 0.92;
					poser({ s: vue.s, x: vue.x + vx, y: vue.y + vy });
					inertie = Math.hypot(vx, vy) > 0.5 ? requestAnimationFrame(pas) : 0;
				};
				inertie = requestAnimationFrame(pas);
			}
			return;
		}
		// A tap: double → zoom; single on the backdrop → close.
		const [px, py] = local(e.clientX, e.clientY);
		if (dernierTap && e.timeStamp - dernierTap.t < 320 && Math.hypot(e.clientX - dernierTap.x, e.clientY - dernierTap.y) < 30) {
			dernierTap = null;
			basculer(px, py);
			return;
		}
		dernierTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
		if (!g.surImage) {
			const t0 = dernierTap.t;
			window.setTimeout(() => { if (dernierTap && dernierTap.t === t0) fermer(); }, 330);
		}
	};
	voile.addEventListener("pointerup", fin);
	voile.addEventListener("pointercancel", fin);
}
