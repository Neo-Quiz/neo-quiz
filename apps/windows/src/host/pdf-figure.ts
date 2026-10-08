/* ══════════════════════════════════════════════════════════
   WHERE THE FIGURE IS ON A PDF PAGE — the PURE part (2026-10-08)

   A generated reading can show a page of a course PDF (src/dashboard/
   figures.ts). The whole page is a sheet of A4: the diagram the reading is
   about fills a third of it, under a title and above the questions, and the
   card became a tall picture to scroll past. This module finds the diagram:

   1. every vector path and image the page DRAWS, placed on the page through
      the transformation matrix in force (pdf.js's operator list gives each
      path's box in the coordinates of the moment, `save`/`restore`/
      `transform` move them);
   2. minus what is not a drawing: clipping paths (`endPath`), a shape that
      covers most of the page (a background), a long hairline (a rule under
      a title);
   3. grouped: boxes that touch or nearly touch belong to one drawing; the
      LARGEST group is the figure (a small group of check boxes in a corner
      is not);
   4. widened to the text that labels it: every text item that overlaps the
      group, or lies just around it ("1..*", a lane's name above a sequence).

   No figure (a page of text, a drawing too small to matter): `null`, and the
   caller keeps the whole page. Coordinates are the PDF's own (points, y up).
   `npm run check:pdf` runs it on real PDFs through the real engine.
══════════════════════════════════════════════════════════ */

/** [x0, y0, x1, y1], x0 <= x1 and y0 <= y1, in PDF points. */
export type Boite = [number, number, number, number];

type Matrice = [number, number, number, number, number, number];

/** The operator codes this module reads (pdf.js's `OPS`). */
export interface CodesOps {
	save: number; restore: number; transform: number; constructPath: number; endPath: number;
	paintImageXObject: number; paintInlineImageXObject: number; paintImageMaskXObject: number;
}

export interface ListeOps { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }

/** A text item as `getTextContent` gives it: its matrix and size, on the page. */
export interface TexteSurPage { transform?: number[]; width?: number; height?: number; str?: string }

/** A drawing must cover at least this share of the page to be a figure. */
const AIRE_MIN = 0.02;
/** A shape covering more than this share of the page is a background. */
const AIRE_FOND = 0.6;
/** Boxes this close (points) belong to the same drawing. */
const ECART_GROUPE = 18;
/** Text this close to the drawing (points) labels it, if it is SHORT (a
    label, not the question written under the figure). */
const LIBELLE_MAX = 30;
/** Text this close to the drawing (points) labels it. */
const ECART_LIBELLE = 12;
/** The margin kept around the figure (points). */
const MARGE = 6;

function multiplier(m: Matrice, n: Matrice): Matrice {
	return [
		m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
		m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
		m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
	];
}

function placer(m: Matrice, x0: number, y0: number, x1: number, y1: number): Boite {
	const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
	const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const aire = (b: Boite): number => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const fusion = (a: Boite, b: Boite): Boite => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const proches = (a: Boite, b: Boite, ecart: number): boolean =>
	a[0] - ecart <= b[2] && b[0] - ecart <= a[2] && a[1] - ecart <= b[3] && b[1] - ecart <= a[3];
const fini = (b: Boite): boolean => b.every(Number.isFinite);

function estMatrice(v: unknown): v is Matrice {
	return Array.isArray(v) && v.length === 6 && v.every(x => typeof x === "number" && Number.isFinite(x));
}

/** Every box the page draws, on the page. */
export function boitesDessinees(ops: ListeOps, codes: CodesOps): Boite[] {
	const boites: Boite[] = [];
	const pile: Matrice[] = [];
	let ctm: Matrice = [1, 0, 0, 1, 0, 0];
	for (let i = 0; i < ops.fnArray.length; i++) {
		const fn = ops.fnArray[i];
		const args = ops.argsArray[i] as unknown[] | null | undefined;
		if (fn === codes.save) pile.push(ctm);
		else if (fn === codes.restore) ctm = pile.pop() ?? ctm;
		else if (fn === codes.transform) {
			const m = Array.isArray(args) ? args.slice(0, 6) : null;
			if (estMatrice(m)) ctm = multiplier(ctm, m);
		} else if (fn === codes.constructPath) {
			// [operation, [path], minMax]: a clip (`endPath`) draws nothing.
			if (!Array.isArray(args) || args[0] === codes.endPath) continue;
			const mm = args[2] as ArrayLike<number> | null | undefined;
			if (!mm || mm.length < 4) continue;
			const b = placer(ctm, mm[0], mm[1], mm[2], mm[3]);
			if (fini(b)) boites.push(b);
		} else if (fn === codes.paintImageXObject || fn === codes.paintInlineImageXObject || fn === codes.paintImageMaskXObject) {
			// An image fills the unit square of the matrix in force.
			const b = placer(ctm, 0, 0, 1, 1);
			if (fini(b)) boites.push(b);
		}
	}
	return boites;
}

function boiteDeTexte(t: TexteSurPage): Boite | null {
	const m = t.transform;
	if (!m || m.length < 6 || !t.str || !t.str.trim()) return null;
	const x = m[4], y = m[5];
	const w = Math.abs(t.width ?? 0);
	const h = Math.abs(t.height ?? 0) || Math.hypot(m[2], m[3]);
	const b: Boite = [x, y - h * 0.25, x + w, y + h];
	return fini(b) ? b : null;
}

/**
 * The box of the page's figure, with its labels and a margin, clamped to the
 * page; `null` when the page has none worth cutting out (keep the page).
 */
export function zoneDeFigure(ops: ListeOps, codes: CodesOps, textes: readonly TexteSurPage[], page: Boite): Boite | null {
	const aPage = aire(page);
	if (aPage <= 0) return null;
	const largeurPage = page[2] - page[0];
	const dessins = boitesDessinees(ops, codes).filter(b => {
		const w = b[2] - b[0], h = b[3] - b[1];
		if (aire(b) > AIRE_FOND * aPage) return false;
		/* A rule: a hairline across nearly the whole page (under a title). A
		   long ARROW of a diagram is a hairline too: half the page was the
		   bound once, and a sequence diagram lost its last lifeline. */
		if (Math.min(w, h) < 2 && Math.max(w, h) > 0.8 * largeurPage) return false;
		return true;
	});
	if (dessins.length === 0) return null;
	// Groups of boxes that touch (single linkage, by merging until stable).
	let groupes: Boite[] = dessins.map(b => [...b] as Boite);
	for (let change = true; change;) {
		change = false;
		for (let i = 0; i < groupes.length && !change; i++) {
			for (let j = i + 1; j < groupes.length; j++) {
				if (proches(groupes[i], groupes[j], ECART_GROUPE)) {
					groupes[i] = fusion(groupes[i], groupes[j]);
					groupes.splice(j, 1);
					change = true;
					break;
				}
			}
		}
	}
	let zone = groupes.reduce((a, b) => (aire(b) > aire(a) ? b : a));
	if (aire(zone) < AIRE_MIN * aPage) return null;
	/* Two views side by side (components on the left, sequence on the
	   right, split by a rule): every group of real size in the SAME band of
	   the page joins the largest one. */
	const largest = zone;
	for (const g of groupes) {
		if (g === largest || aire(g) < 0.15 * aire(largest)) continue;
		const recouvre = Math.min(g[3], largest[3]) - Math.max(g[1], largest[1]);
		if (recouvre > 0.5 * Math.min(g[3] - g[1], largest[3] - largest[1])) zone = fusion(zone, g);
	}
	/* Its labels: the text overlapping the DRAWING or just around it, judged
	   against the drawing itself and never the box grown by a label, or the
	   paragraph above would join line by line. */
	const dessin = zone;
	/* The length of the LINE a text item sits on (items within 2 points of
	   the same baseline): the number "1" of a question is one character, but
	   its line is the question, never a label. */
	const lignes = textes.filter(t => t.transform && t.str && t.str.trim());
	const longueurLigne = (t: TexteSurPage): number => lignes
		.filter(u => Math.abs((u.transform as number[])[5] - (t.transform as number[])[5]) < 2)
		.reduce((n, u) => n + (u.str ?? "").trim().length, 0);
	for (const t of textes) {
		const b = boiteDeTexte(t);
		if (!b) continue;
		// Inside the drawing: its centre is (a line merely touching it is not).
		const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
		const dedans = cx > dessin[0] && cx < dessin[2] && cy > dessin[1] && cy < dessin[3];
		if (dedans || (proches(dessin, b, ECART_LIBELLE) && longueurLigne(t) <= LIBELLE_MAX)) zone = fusion(zone, b);
	}
	zone = [zone[0] - MARGE, zone[1] - MARGE, zone[2] + MARGE, zone[3] + MARGE];
	const borne: Boite = [Math.max(page[0], zone[0]), Math.max(page[1], zone[1]), Math.min(page[2], zone[2]), Math.min(page[3], zone[3])];
	// Nearly the whole page anyway: no gain in cutting.
	return aire(borne) > 0.85 * aPage ? null : borne;
}
