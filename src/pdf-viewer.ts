import { currentHost } from "./host/current";
import type { HostPdfView } from "./host/types";
import { ajouter } from "./dom";
import { t } from "./i18n";
import { LOG_PREFIX } from "./branding";

/* ══════════════════════════════════════════════════════════
   THE PDF VIEWER (2026-10-09)

   A modal that reads a PDF of the folders natively, on the PC and in the
   Android WebView (the renderer is shared): the pages scroll vertically, are
   drawn LAZILY when they come near the screen (IntersectionObserver) and
   released when they leave it, sharp on a dense screen (`devicePixelRatio`),
   with "page n / N", zoom (buttons, Ctrl+wheel, two-finger pinch) and a
   selectable text layer.

   The bytes come from `HostFs.readBinary` (the host's scope), never from a
   URL. The engine (`HostPdf.open`) runs no script of the document and draws
   no link, so nothing external can open on its own.

   No `pdfjs-dist` here: the module only talks to the host's `HostPdfView`,
   and the engine itself is imported on demand by the host, at the first
   opening. The start-up pays nothing.
══════════════════════════════════════════════════════════ */

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;
/** Pixels of a canvas beyond which the density is lowered (memory). */
export const MAX_CANVAS_PIXELS = 16_000_000;
/** Gap between pages and around them, CSS pixels. */
const GAP = 12;

/** `value` kept within [ZOOM_MIN, ZOOM_MAX]. */
export function bornerZoom(value: number): number {
	return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** The density a page is drawn at: the screen's, lowered so that the canvas
    never exceeds `MAX_CANVAS_PIXELS`. */
export function densite(dpr: number, largeurCss: number, hauteurCss: number): number {
	const pixels = largeurCss * hauteurCss * dpr * dpr;
	return pixels > MAX_CANVAS_PIXELS ? Math.max(1, dpr * Math.sqrt(MAX_CANVAS_PIXELS / pixels)) : dpr;
}

interface Slot {
	n: number;
	el: HTMLElement;
	canvas: HTMLCanvasElement;
	text: HTMLElement;
	w: number;
	h: number;
	/** The scale the canvas was last drawn at, or null when it holds nothing. */
	drawn: number | null;
	job: { done: Promise<void>; cancel(): void; scale: number } | null;
}

/**
 * Opens `path` in the viewer, on `page` (1 by default). Never throws: a
 * missing file, an unreadable or unsupported document is told in the modal.
 */
export function ouvrirPdf(path: string, page = 1): void {
	const host = currentHost();
	const nom = path.split("/").pop() ?? path;
	if (!host.modals || !host.pdf?.open) {
		host.ui.notice(t("pdf.viewer.unsupported"));
		return;
	}
	let vue: HostPdfView | null = null;
	let ferme = false;
	let demonter: (() => void) | null = null;
	host.modals.open({
		className: "qbd-pdf-modal",
		title: nom,
		titleIcon: (el) => host.ui.setIcon(el, "file-text"),
		onOpen: (h) => {
			const corps = ajouter(h.contentEl, "div", "qbd-pdf-body");
			ajouter(corps, "div", "qbd-pdf-message", t("pdf.viewer.loading"));
			void (async () => {
				try {
					const octets = await host.fs.readBinary(path);
					if (ferme) return;
					const ouverte = await host.pdf!.open!(octets);
					if (ferme) { void ouverte.destroy(); return; }
					vue = ouverte;
					corps.replaceChildren();
					demonter = await monter(corps, ouverte, page);
				} catch (e) {
					console.warn(LOG_PREFIX, "PDF viewer:", path, e);
					if (ferme) return;
					corps.replaceChildren();
					ajouter(corps, "div", "qbd-pdf-message", t("pdf.viewer.error"));
				}
			})();
		},
		onClose: () => {
			ferme = true;
			demonter?.();
			demonter = null;
			void vue?.destroy();
			vue = null;
		},
	});
}

async function monter(corps: HTMLElement, vue: HostPdfView, pageDepart: number): Promise<() => void> {
	const host = currentHost();
	const total = vue.numPages;

	// ── The bar: page n / N, zoom out, zoom in ──
	const barre = ajouter(corps, "div", "qbd-pdf-bar");
	const indicateur = ajouter(barre, "span", "qbd-pdf-page-indicator");
	indicateur.setAttribute("aria-live", "polite");
	const bouton = (icone: string, libelle: string): HTMLButtonElement => {
		const b = ajouter(barre, "button", "qbd-pdf-zoom-btn");
		b.type = "button";
		b.setAttribute("aria-label", libelle);
		b.title = libelle;
		host.ui.setIcon(b, icone);
		return b;
	};
	const moins = bouton("minus", t("pdf.viewer.zoomOut"));
	const plus = bouton("plus", t("pdf.viewer.zoomIn"));

	const defileur = ajouter(corps, "div", "qbd-pdf-scroll");
	const pages = ajouter(defileur, "div", "qbd-pdf-pages");

	const tailles = await Promise.all(Array.from({ length: total }, (_, i) => vue.pageSize(i + 1)));
	const fiche: Slot[] = tailles.map((tl, i) => {
		const el = ajouter(pages, "div", "qbd-pdf-page");
		const canvas = ajouter(el, "canvas", "qbd-pdf-canvas");
		const text = ajouter(el, "div", "qbd-pdf-text textLayer");
		return { n: i + 1, el, canvas, text, w: tl.width, h: tl.height, drawn: null, job: null };
	});

	// ── The scale: fit to the width, times the user's zoom ──
	let zoom = 1;
	const ajustement = (): number => {
		const dispo = Math.max(120, defileur.clientWidth - 2 * GAP);
		return dispo / Math.max(...fiche.slice(0, 20).map(s => s.w));
	};
	let ajust = ajustement();
	const echelle = (): number => ajust * zoom;

	const poser = (): void => {
		const s = echelle();
		for (const p of fiche) {
			p.el.style.width = `${p.w * s}px`;
			p.el.style.height = `${p.h * s}px`;
			p.text.style.setProperty("--total-scale-factor", String(s));
			p.text.style.setProperty("--scale-factor", String(s));
		}
	};
	poser();

	// ── Lazy drawing ──
	const proches = new Set<Slot>();
	const dessiner = (p: Slot): void => {
		const s = echelle();
		if (p.drawn === s || p.job?.scale === s) return;
		p.job?.cancel();
		const d = densite(window.devicePixelRatio || 1, p.w * s, p.h * s);
		const tache = vue.render(p.n, { canvas: p.canvas, textLayer: p.text, scale: s, dpr: d });
		const job = { ...tache, scale: s };
		p.job = job;
		tache.done.then(() => {
			if (p.job !== job) return;
			p.job = null;
			p.drawn = s;
			// The user zoomed again while this page was being drawn.
			if (proches.has(p) && echelle() !== s) dessiner(p);
		}).catch(e => {
			if (p.job === job) p.job = null;
			console.warn(LOG_PREFIX, "PDF page", p.n, e);
		});
	};
	const liberer = (p: Slot): void => {
		p.job?.cancel();
		p.job = null;
		p.drawn = null;
		p.canvas.width = 0;
		p.canvas.height = 0;
		p.text.replaceChildren();
	};
	const parPage = new Map<Element, Slot>(fiche.map(p => [p.el, p]));
	const observateur = new IntersectionObserver((entrees) => {
		for (const e of entrees) {
			const p = parPage.get(e.target);
			if (!p) continue;
			if (e.isIntersecting) { proches.add(p); dessiner(p); }
			else { proches.delete(p); liberer(p); }
		}
	}, { root: defileur, rootMargin: "100% 0px" });
	for (const p of fiche) observateur.observe(p.el);

	// ── The current page ──
	let courante = 0;
	let trame = 0;
	const majPage = (): void => {
		trame = 0;
		const milieu = defileur.scrollTop + defileur.clientHeight / 2;
		let n = 1;
		for (const p of fiche) { if (p.el.offsetTop <= milieu) n = p.n; else break; }
		if (n !== courante) {
			courante = n;
			indicateur.textContent = t("pdf.viewer.page", { page: n, total });
		}
	};
	const surDefilement = (): void => { if (!trame) trame = requestAnimationFrame(majPage); };
	defileur.addEventListener("scroll", surDefilement, { passive: true });

	// ── Zoom, anchored on a point of the viewport ──
	let nouveauDessin = 0;
	const zoomer = (cible: number, ax: number, ay: number): void => {
		const avant = echelle();
		zoom = bornerZoom(cible);
		const rapport = echelle() / avant;
		if (rapport === 1) return;
		const cx = defileur.scrollLeft + ax;
		const cy = defileur.scrollTop + ay;
		poser();
		defileur.scrollLeft = cx * rapport - ax;
		defileur.scrollTop = cy * rapport - ay;
		majPage();
		// The canvases keep their old pixels, stretched by CSS, until the sharp ones replace them.
		clearTimeout(nouveauDessin);
		nouveauDessin = window.setTimeout(() => { for (const p of proches) dessiner(p); }, 120);
	};
	const centre = (): [number, number] => [defileur.clientWidth / 2, defileur.clientHeight / 2];
	moins.addEventListener("click", () => zoomer(zoom / ZOOM_STEP, ...centre()));
	plus.addEventListener("click", () => zoomer(zoom * ZOOM_STEP, ...centre()));
	const surMolette = (e: WheelEvent): void => {
		if (!e.ctrlKey) return;
		// The window's own zoom must not take the gesture.
		e.preventDefault();
		e.stopPropagation();
		const r = defileur.getBoundingClientRect();
		zoomer(zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
	};
	defileur.addEventListener("wheel", surMolette, { passive: false });

	// Two-finger pinch (touch screens).
	let pince: { dist: number; zoom: number } | null = null;
	const distance = (a: Touch, b: Touch): number => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
	const surToucheDebut = (e: TouchEvent): void => {
		if (e.touches.length === 2) pince = { dist: distance(e.touches[0], e.touches[1]), zoom };
	};
	const surToucheMouvement = (e: TouchEvent): void => {
		if (!pince || e.touches.length !== 2) return;
		e.preventDefault();
		const r = defileur.getBoundingClientRect();
		const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
		const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
		zoomer(pince.zoom * distance(e.touches[0], e.touches[1]) / pince.dist, mx, my);
	};
	const surToucheFin = (e: TouchEvent): void => { if (e.touches.length < 2) pince = null; };
	defileur.addEventListener("touchstart", surToucheDebut, { passive: true });
	defileur.addEventListener("touchmove", surToucheMouvement, { passive: false });
	defileur.addEventListener("touchend", surToucheFin, { passive: true });
	defileur.addEventListener("touchcancel", surToucheFin, { passive: true });

	// A resized panel (window, phone rotation) re-fits the pages to the width.
	const redim = new ResizeObserver(() => {
		if (!defileur.clientWidth) return;
		const a = ajustement();
		if (Math.abs(a - ajust) < 0.001) return;
		const ratio = defileur.scrollTop / Math.max(1, defileur.scrollHeight);
		ajust = a;
		poser();
		defileur.scrollTop = ratio * defileur.scrollHeight;
		for (const p of proches) dessiner(p);
	});
	redim.observe(defileur);

	// ── Open on the requested page ──
	const depart = fiche[Math.min(total, Math.max(1, Math.floor(pageDepart) || 1)) - 1];
	defileur.scrollTop = Math.max(0, depart.el.offsetTop - GAP);
	majPage();

	return () => {
		clearTimeout(nouveauDessin);
		if (trame) cancelAnimationFrame(trame);
		observateur.disconnect();
		redim.disconnect();
		for (const p of fiche) { p.job?.cancel(); p.job = null; }
	};
}
