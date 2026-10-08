import { currentHost } from "../host/current";
import { LOG_PREFIX } from "../branding";

/* ══════════════════════════════════════════════════════════
   FIGURES OF A GENERATED READING (2026-10-08)

   A reading card of a Learn may show a page of an attached PDF: a diagram,
   a schema, a table the text alone explains badly. The model never sees the
   pages (it reads their TEXT, "[p. N]" marks included), so it cannot draw
   or crop anything; it NAMES the page instead:

       "figure": "CE_TI303_sujet.pdf, p. 3"

   Before the quiz is kept, the application draws that page of that PDF into
   a PNG next to the note, and turns the field into the card's `passage`
   (`![[… - p3.png]]`), which a reading shows open above its text. A figure
   that names no attached PDF, a page out of range, or a page that cannot be
   drawn is dropped without a word: the reading stays, without its picture.

   PURE except `poserFigures` (drawing and writing injected) and
   `figuresParHote`, which injects the host's.
══════════════════════════════════════════════════════════ */

/** At most this many figures per quiz: a PNG per page is written into the
    user's folder and synced to their phone. */
export const MAX_FIGURES = 12;

/** "name.pdf, p. 12", "name.pdf p.12", "name.pdf, page 12", "name.pdf, p. 12-14"
    (the first page of a range): the document as written and its page. */
export function lireFigure(valeur: unknown): { document: string; page: number } | null {
	if (typeof valeur !== "string") return null;
	const m = /^\s*(.+?)\s*[,;:—-]?\s*(?:p\.?|pp\.?|page)\s*(\d{1,4})(?:\s*[-–]\s*\d{1,4})?\s*$/i.exec(valeur);
	if (!m) return null;
	const page = Number(m[2]);
	return page >= 1 ? { document: m[1].trim(), page } : null;
}

/** The attached PDF a figure names, by its file name, with or without the
    extension, case and accents' composition ignored. */
export function documentDeFigure<T extends { name: string }>(nom: string, documents: readonly T[]): T | null {
	const cle = (s: string): string => s.normalize("NFC").trim().toLowerCase().replace(/\.pdf$/, "");
	const voulu = cle(nom);
	return documents.find(d => /\.pdf$/i.test(d.name) && cle(d.name) === voulu) ?? null;
}

/** The PNG's file name: the PDF's name without extension and the page,
    stripped of what no file system accepts. */
export function nomImageFigure(document: string, page: number): string {
	const base = document.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "figure";
	return `${base} - p${page}.png`;
}

export interface DepsFigures<T extends { name: string }> {
	/** The attached documents (only the PDFs can give a figure). */
	documents: readonly T[];
	/** Draws page `page` of `doc` and writes it as `fileName`; resolves with
	    the name to embed (the host may have chosen another), or null. */
	dessiner(doc: T, page: number, fileName: string): Promise<string | null>;
}

/**
 * The questions with each `figure` resolved: the drawn page becomes the
 * card's `passage` (before any passage it already had) and the PDF's page its
 * `passageTitle`; the `figure` field is always removed. Never throws: a figure
 * that fails is only dropped. The same page asked twice is drawn once.
 */
export async function poserFigures<T extends { name: string }>(questions: readonly unknown[], deps: DepsFigures<T>): Promise<unknown[]> {
	const faites = new Map<string, Promise<string | null>>();
	let nombre = 0;
	const sortie: unknown[] = [];
	for (const q of questions) {
		if (!q || typeof q !== "object" || Array.isArray(q) || !("figure" in q)) { sortie.push(q); continue; }
		const { figure, ...reste } = q as Record<string, unknown>;
		const f = lireFigure(figure);
		const doc = f ? documentDeFigure(f.document, deps.documents) : null;
		if (!f || !doc) { sortie.push(reste); continue; }
		const nomImage = nomImageFigure(doc.name, f.page);
		let promesse = faites.get(nomImage);
		if (!promesse) {
			if (nombre >= MAX_FIGURES) { sortie.push(reste); continue; }
			nombre++;
			promesse = deps.dessiner(doc, f.page, nomImage).catch(() => null);
			faites.set(nomImage, promesse);
		}
		const nom = await promesse;
		if (!nom) { sortie.push(reste); continue; }
		const avant = typeof reste.passage === "string" && reste.passage.trim() ? "\n\n" + reste.passage : "";
		sortie.push({
			...reste,
			passage: `![[${nom}]]${avant}`,
			passageTitle: typeof reste.passageTitle === "string" && reste.passageTitle.trim() ? reste.passageTitle : `${doc.name}, p. ${f.page}`,
		});
	}
	return sortie;
}

/** The folder the drawn pages go to, inside the quiz's folder. */
export const DOSSIER_FIGURES = "Figures";

/** The width a page is drawn at (CSS pixels; the host multiplies by the
    screen's density, up to 2): legible on a phone, a few hundred KB. */
const LARGEUR_FIGURE = 1000;

function octetsDeDataUrl(url: string): Uint8Array | null {
	const m = /^data:image\/png;base64,(.+)$/.exec(url);
	if (!m) return null;
	const bin = atob(m[1]);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/**
 * `poserFigures` with the host's hands: the PDF read from its attachment
 * (kept bytes, the vault, or an absolute path), the page drawn by `host.pdf`,
 * the PNG written to `<folder>/Figures/`. A page already there (the same PDF
 * page drawn by an earlier generation) is reused, not drawn again. A host
 * that cannot draw drops the figures, never the quiz.
 */
export async function figuresParHote(
	questions: readonly unknown[],
	documents: ReadonlyArray<{ name: string; path?: string; source?: string; bytes?: Uint8Array }>,
	dossier: string,
): Promise<unknown[]> {
	if (!questions.some(q => !!q && typeof q === "object" && "figure" in q)) return [...questions];
	const host = currentHost();
	const pdf = host.pdf;
	const cible = (nom: string): string => (dossier ? dossier.replace(/\/+$/, "") + "/" : "") + DOSSIER_FIGURES + "/" + nom;
	return poserFigures(questions, {
		documents,
		async dessiner(doc, page, fileName) {
			if (!pdf?.renderPages) return null;
			try {
				const chemin = cible(fileName);
				if (await host.fs.exists(chemin)) return fileName;
				const octets = doc.bytes instanceof Uint8Array && doc.bytes.length ? doc.bytes
					: doc.source === "external" && doc.path ? await host.fs.externe.readBinary(doc.path)
					: doc.path ? await host.fs.readBinary(doc.path)
					: null;
				if (!octets) return null;
				const rendu = await pdf.renderPages(octets, { width: LARGEUR_FIGURE, first: page, max: 1 });
				const png = rendu.pages[0] ? octetsDeDataUrl(rendu.pages[0]) : null;
				if (!png) return null;
				await host.fs.mkdirs(chemin.slice(0, chemin.lastIndexOf("/")));
				await host.fs.writeBinary(chemin, png);
				return fileName;
			} catch (e) {
				console.warn(LOG_PREFIX, "figure not drawn:", doc.name, page, e);
				return null;
			}
		},
	});
}