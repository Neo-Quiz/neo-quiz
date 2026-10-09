import { currentHost } from "../host/current";
import { t } from "../i18n";

/* ══════════════════════════════════════════════════════════
   AN IMAGE OF A QUIZ, LARGER (2026-10-08, redone 2026-10-09)

   A diagram drawn from a course page (dashboard/figures.ts) is a whole schema
   shrunk to a card: its labels cannot be read. A tap (or a click) on any
   picture of a quiz card opens a VIEWER over the whole window. Its LOOK is the
   owner's own Obsidian plugin (`image-lightbox`, vault Personal), kept on
   purpose: a translucent, blurred backdrop that leaves the page guessable
   behind it; the picture in a rounded frame with a deep shadow; a round close
   button glued to the picture's top-right corner; under the picture its name,
   "n / N" and arrows to the other pictures of the same card. On top of it,
   what that plugin did not do:
   - the picture grows out of its thumbnail, and shrinks back into it;
   - the wheel (or a touchpad pinch) zooms around the cursor, two fingers
     pinch, a double click or double tap zooms in at that point or back;
   - once zoomed, the mouse or a finger drags it, and a fling glides on;
   - a small row under the name: −, the zoom level (fit ⇄ zoomed), +, real
     size; keys + − 0 1, ← → between pictures, Escape closes;
   - a click on the backdrop closes; on a touch screen, not zoomed, a swipe
     down closes and a swipe sideways goes to the next picture.
   Pictures inside an answer option are left alone: there a tap chooses.

   CURSORS: only Windows' own. `pointer` (the system hand) on a picture that
   opens and on the buttons, `default` (the arrow) on the backdrop and on a
   fitted picture, `move` (the system four-way arrow) on a zoomed picture.
   `zoom-in` and `grab` are images Chromium draws itself.

   The arithmetic is PURE (`zoomAutour`, `ajuster`, `echelleAjustee`),
   checked by `npm run check:image-zoom`; the rest wires it to the DOM.
══════════════════════════════════════════════════════════ */

/** The view: the picture's scale relative to its NATURAL size, and the
    position (px) of its top-left corner in the viewer. */
export interface Vue { s: number; x: number; y: number }

/** Never zoomed in further than this many times the picture's own pixels. */
export const ZOOM_MAX = 8;
const FACTEUR_BOUTON = 1.6;
/** Room kept under a fitted picture for its name, counter and buttons. */
const RESERVE_BAS = 112;
/** A rendered picture this small is an icon, not a picture to look at. */
const TAILLE_ICONE_MAX = 48;

/** The scale that fits a `nw` x `nh` picture in a `vw` x `vh` area (86 % of
    its width, all its height), never enlarged past twice its own pixels. */
export function echelleAjustee(nw: number, nh: number, vw: number, vh: number): number {
	if (!(nw > 0 && nh > 0 && vw > 0 && vh > 0)) return 1;
	return Math.min(2, Math.max(0.01, Math.min((0.86 * vw) / nw, vh / nh)));
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

function estImageAOuvrir(img: Element | null): img is HTMLImageElement {
	if (!(img instanceof HTMLImageElement) || (!img.currentSrc && !img.src)) return false;
	if (!img.closest(".quiz-card") || img.closest(SANS_ZOOM)) return false;
	const r = img.getBoundingClientRect();
	return !(r.width && r.height && Math.max(r.width, r.height) <= TAILLE_ICONE_MAX);
}

/**
 * Opens the pictures of a quiz larger on a tap. One listener on the quiz's
 * root, for every card drawn now or later. Returns its removal.
 */
export function installImageZoom(racine: HTMLElement): () => void {
	const surClic = (e: MouseEvent): void => {
		const img = (e.target as Element | null)?.closest?.("img") ?? null;
		if (!racine.contains(img) || !estImageAOuvrir(img)) return;
		e.preventDefault();
		e.stopPropagation();
		const carte = img.closest(".quiz-card");
		const toutes = carte ? [...carte.querySelectorAll("img")].filter(estImageAOuvrir) : [img];
		ouvrirImage(toutes.length ? toutes : [img], Math.max(0, toutes.indexOf(img)));
	};
	racine.addEventListener("click", surClic);
	return () => racine.removeEventListener("click", surClic);
}

const reduit = (): boolean => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** The name shown under a picture: its caption, the title of its document,
    its alt text, else its file name. */
function nomDe(img: HTMLImageElement): string {
	const legende = img.closest("figure")?.querySelector(".quiz-lecture-legende")?.textContent?.trim();
	if (legende) return legende;
	const titre = img.closest(".quiz-passage")?.querySelector(".quiz-passage-title")?.textContent?.trim();
	if (titre) return titre;
	if (img.alt.trim()) return img.alt.trim();
	try {
		const chemin = new URL(img.currentSrc || img.src, location.href).pathname;
		return decodeURIComponent(chemin.slice(chemin.lastIndexOf("/") + 1));
	} catch { return ""; }
}

/** The viewer, over the whole window, on picture `index` of `images`. */
export function ouvrirImage(images: HTMLImageElement[], index: number): void {
	const host = currentHost();
	const rendreFocus = document.activeElement as HTMLElement | null;
	let courant = index;
	let source = images[courant];

	const voile = document.createElement("div");
	voile.className = "qbd-visionneuse";
	voile.setAttribute("role", "dialog");
	voile.setAttribute("aria-modal", "true");
	voile.tabIndex = -1;
	const img = document.createElement("img");
	img.className = "qbd-visionneuse-image";
	img.draggable = false;

	const bouton = (classe: string, icone: string, cle: Parameters<typeof t>[0], geste: () => void): HTMLButtonElement => {
		const b = document.createElement("button");
		b.type = "button";
		b.className = classe;
		b.setAttribute("aria-label", t(cle));
		b.title = t(cle);
		host.ui.setIcon(b, icone);
		b.addEventListener("click", ev => { ev.stopPropagation(); geste(); });
		return b;
	};
	const fermeture = bouton("qbd-visionneuse-fermer", "x", "engine.hint.close", () => fermer());

	const bas = document.createElement("div");
	bas.className = "qbd-visionneuse-bas";
	const navigation = document.createElement("div");
	navigation.className = "qbd-visionneuse-navigation";
	const precedent = bouton("qbd-visionneuse-fleche", "chevron-left", "engine.image.previous", () => aller(-1));
	const suivant = bouton("qbd-visionneuse-fleche", "chevron-right", "engine.image.next", () => aller(1));
	const nom = document.createElement("div");
	nom.className = "qbd-visionneuse-nom";
	navigation.append(precedent, nom, suivant);
	const compteur = document.createElement("div");
	compteur.className = "qbd-visionneuse-compteur";
	const outils = document.createElement("div");
	outils.className = "qbd-visionneuse-outils";
	const niveau = document.createElement("button");
	niveau.type = "button";
	niveau.className = "qbd-visionneuse-niveau";
	niveau.title = t("engine.image.fit");
	niveau.addEventListener("click", ev => { ev.stopPropagation(); basculer(vw() / 2, vh() / 2); });
	outils.append(
		bouton("qbd-visionneuse-outil", "zoom-out", "engine.image.zoomOut", () => zoomPar(1 / FACTEUR_BOUTON)),
		niveau,
		bouton("qbd-visionneuse-outil", "zoom-in", "engine.image.zoomIn", () => zoomPar(FACTEUR_BOUTON)),
		bouton("qbd-visionneuse-outil", "scan", "engine.image.actualSize", () => poser(zoomAutour(vue, 1, vw() / 2, vh() / 2, fit()), true)),
	);
	bas.append(navigation, compteur, outils);
	voile.append(img, fermeture, bas);
	document.body.append(voile);

	const nw = (): number => img.naturalWidth || source.naturalWidth || 1;
	const nh = (): number => img.naturalHeight || source.naturalHeight || 1;
	const vw = (): number => voile.clientWidth;
	const vh = (): number => voile.clientHeight;
	const fit = (): number => echelleAjustee(nw(), nh(), vw(), vh() - RESERVE_BAS);
	/** A picture that fits above its bar is centred in that room; a larger one uses the whole window. */
	const cadrer = (v: Vue): Vue => {
		const haut = nh() * v.s <= vh() - RESERVE_BAS ? vh() - RESERVE_BAS : vh();
		return ajuster(v, nw(), nh(), vw(), haut);
	};
	const vueAjustee = (): Vue => cadrer({ s: fit(), x: 0, y: 0 });
	const zoome = (): boolean => vue.s > fit() * 1.001;

	let vue: Vue = { s: 1, x: 0, y: 0 };
	/** Places the picture, then the close button on its corner and the bar under it. */
	const poser = (v: Vue, transition = false): void => {
		vue = cadrer(v);
		const anime = transition && !reduit();
		voile.classList.toggle("is-anime", anime);
		img.style.transform = `translate(${vue.x}px, ${vue.y}px) scale(${vue.s})`;
		voile.classList.toggle("is-zoome", zoome());
		niveau.textContent = `${Math.round(vue.s * 100)} %`;
		const w = nw() * vue.s, h = nh() * vue.s;
		const insetHaut = parseFloat(getComputedStyle(voile).getPropertyValue("--nq-inset-haut")) || 0;
		fermeture.style.left = `${Math.min(vw() - 36, Math.max(8, vue.x + w - 15))}px`;
		fermeture.style.top = `${Math.max(8 + insetHaut, vue.y - 13)}px`;
		bas.style.top = `${Math.min(vh() - bas.offsetHeight - 12, vue.y + h + 14)}px`;
	};
	/** The picture placed exactly over its thumbnail (open, close). */
	const vueVignette = (): Vue | null => {
		if (!source.isConnected) return null;
		const r = source.getBoundingClientRect();
		const v = voile.getBoundingClientRect();
		return r.width ? { s: r.width / nw(), x: r.left - v.left, y: r.top - v.top } : null;
	};
	const sansCadrer = (v: Vue): void => {
		img.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`;
	};

	const zoomPar = (k: number): void => poser(zoomAutour(vue, vue.s * k, vw() / 2, vh() / 2, fit()), true);
	/** Fit ⇄ zoomed in at a point (double click, double tap, the level). */
	function basculer(px: number, py: number): void {
		poser(zoome() ? vueAjustee() : zoomAutour(vue, Math.max(1, fit() * 2.5), px, py, fit()), true);
	}

	/** Shows picture `courant`: its name, the counter, the arrows. */
	function charger(depuisVignette: boolean): void {
		source = images[courant];
		img.src = source.currentSrc || source.src;
		img.alt = source.alt;
		voile.setAttribute("aria-label", nomDe(source) || t("engine.image.viewer"));
		nom.textContent = nomDe(source);
		const plusieurs = images.length > 1;
		precedent.hidden = suivant.hidden = !plusieurs;
		compteur.textContent = plusieurs ? `${courant + 1} / ${images.length}` : "";
		const montrer = (): void => {
			const depart = depuisVignette ? vueVignette() : null;
			if (depart) { sansCadrer(depart); void img.offsetWidth; poser(vueAjustee(), true); }
			else {
				poser(vueAjustee());
				img.classList.remove("is-entree");
				void img.offsetWidth;
				img.classList.add("is-entree");
			}
		};
		if (img.complete && img.naturalWidth) montrer(); else img.addEventListener("load", montrer, { once: true });
	}
	function aller(pas: number): void {
		if (images.length < 2) return;
		arreterInertie();
		courant = (courant + pas + images.length) % images.length;
		charger(false);
	}

	requestAnimationFrame(() => voile.classList.add("is-ouvert"));
	charger(true);

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
		const arrivee = reduit() ? null : vueVignette();
		if (!arrivee) { window.setTimeout(fin, reduit() ? 0 : 180); return; }
		voile.classList.add("is-anime");
		sansCadrer(arrivee);
		window.setTimeout(fin, 270);
	}

	function surTouche(e: KeyboardEvent): void {
		const k = e.key;
		if (k === "Escape") fermer();
		else if (k === "ArrowLeft") aller(-1);
		else if (k === "ArrowRight") aller(1);
		else if (k === "+" || k === "=") zoomPar(FACTEUR_BOUTON);
		else if (k === "-") zoomPar(1 / FACTEUR_BOUTON);
		else if (k === "0") poser(vueAjustee(), true);
		else if (k === "1") poser(zoomAutour(vue, 1, vw() / 2, vh() / 2, fit()), true);
		else return;
		e.preventDefault();
		e.stopPropagation();
	}
	document.addEventListener("keydown", surTouche, true);
	const surRedim = (): void => poser(zoome() ? vue : vueAjustee());
	window.addEventListener("resize", surRedim);
	voile.focus();

	/* The wheel zooms around the cursor; a touchpad pinch is a wheel with ctrlKey. */
	voile.addEventListener("wheel", e => {
		e.preventDefault();
		arreterInertie();
		const r = voile.getBoundingClientRect();
		poser(zoomAutour(vue, vue.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top, fit()));
	}, { passive: false });

	/* Pointers: pinch, drag with inertia, double tap, swipes. */
	const pointeurs = new Map<number, { x: number; y: number }>();
	let geste: { x0: number; y0: number; bouge: boolean; surImage: boolean; tactile: boolean } | null = null;
	let dernierTap: { t: number; x: number; y: number } | null = null;
	let vitesse = { x: 0, y: 0, t: 0 };
	let glisse = { x: 0, y: 0 };
	let inertie = 0;
	function arreterInertie(): void { if (inertie) { cancelAnimationFrame(inertie); inertie = 0; } }
	const local = (cx: number, cy: number): [number, number] => {
		const r = voile.getBoundingClientRect();
		return [cx - r.left, cy - r.top];
	};
	voile.addEventListener("pointerdown", e => {
		if ((e.target as Element).closest("button")) return;
		arreterInertie();
		voile.setPointerCapture(e.pointerId);
		pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
		geste = pointeurs.size === 1 ? { x0: e.clientX, y0: e.clientY, bouge: false, surImage: e.target === img, tactile: e.pointerType === "touch" } : null;
		vitesse = { x: 0, y: 0, t: e.timeStamp };
		glisse = { x: 0, y: 0 };
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
		if (zoome()) {
			poser({ s: vue.s, x: vue.x + dx, y: vue.y + dy });
		} else if (geste?.tactile && geste.bouge) {
			// Not zoomed, on a touch screen: the picture follows a swipe (down closes, sideways changes).
			glisse = { x: e.clientX - geste.x0, y: Math.max(0, e.clientY - geste.y0) };
			const base = vueAjustee();
			const lateral = Math.abs(glisse.x) > glisse.y;
			sansCadrer({ s: base.s, x: base.x + (lateral ? glisse.x : 0), y: base.y + (lateral ? 0 : glisse.y) });
			if (!lateral) voile.style.setProperty("--voile-opacite", String(Math.max(0.3, 1 - glisse.y / 400)));
		}
	});
	const fin = (e: PointerEvent): void => {
		if (!pointeurs.delete(e.pointerId) || pointeurs.size > 0) return;
		voile.classList.remove("is-saisie");
		const g = geste;
		geste = null;
		if (glisse.x || glisse.y) {
			voile.style.removeProperty("--voile-opacite");
			const lateral = Math.abs(glisse.x) > glisse.y;
			if (!lateral && glisse.y > 110) { fermer(); return; }
			if (lateral && Math.abs(glisse.x) > 80 && images.length > 1) { aller(glisse.x < 0 ? 1 : -1); return; }
			poser(vueAjustee(), true);
			return;
		}
		if (!g || e.type === "pointercancel") return;
		if (g.bouge) {
			// A drag flung: the picture glides on and slows down.
			if (zoome() && Math.hypot(vitesse.x, vitesse.y) > 0.25 && !reduit()) {
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
		// A click on the backdrop closes at once; on the picture, two taps zoom.
		if (!g.surImage) { fermer(); return; }
		const [px, py] = local(e.clientX, e.clientY);
		if (dernierTap && e.timeStamp - dernierTap.t < 320 && Math.hypot(e.clientX - dernierTap.x, e.clientY - dernierTap.y) < 30) {
			dernierTap = null;
			basculer(px, py);
			return;
		}
		dernierTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
	};
	voile.addEventListener("pointerup", fin);
	voile.addEventListener("pointercancel", fin);
}
