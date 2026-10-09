/* ══════════════════════════════════════════════════════════
   THE PDF SOURCES OF A QUIZ (2026-10-09)

   A Learn's reading cards carry `cite` ("CM3 - Réseaux.pdf, p. 12-14") and a
   freshly generated card may still carry `figure`. Nothing new is persisted:
   the sources of a quiz are the documents those two fields name, in order of
   appearance. The `source` key is NOT read here: in the quiz format it names
   the document a quiz is generated FROM (`isQuizModeConfig`), a different
   thing.

   PURE: no DOM, no host. `npm run check:pdf-sources` holds it.
══════════════════════════════════════════════════════════ */

/** One citation: a PDF name and, when written, its first page. */
export interface Citation { name: string; page: number | null }

/** A document of the quiz, with the page its first citation opens on. */
export interface PdfSource { name: string; page: number }

const CITATION_RE = /^\s*(.+?\.pdf)(?![\p{L}\p{N}])\s*(?:[,;:—–-]\s*)?(?:(?:pp?|pages?)\.?\s*(\d{1,4}))?/iu;

/** The citations of one text: "A.pdf, p. 12-14", "A.pdf", or several of them
    separated by `;` or a line break. A text that names no PDF gives none. */
export function lireCitations(texte: unknown): Citation[] {
	if (typeof texte !== "string") return [];
	const sortie: Citation[] = [];
	for (const morceau of texte.split(/[;\n]/)) {
		const m = CITATION_RE.exec(morceau);
		if (!m) continue;
		const page = m[2] ? Number(m[2]) : null;
		sortie.push({ name: m[1].trim(), page: page !== null && page >= 1 ? page : null });
	}
	return sortie;
}

/** The comparison key of a document name: composed, lower case, `.pdf` ignored. */
export function cleDocument(nom: string): string {
	return nom.normalize("NFC").trim().toLowerCase().replace(/\.pdf$/, "");
}

/** The documents the questions cite (`cite`) or name (`figure`), each once, in
    order of appearance; the page is the first one written for it (1 if none). */
export function sourcesDuQuiz(questions: readonly unknown[]): PdfSource[] {
	const vus = new Map<string, PdfSource>();
	for (const q of questions) {
		if (!q || typeof q !== "object") continue;
		const r = q as { cite?: unknown; figure?: unknown };
		for (const c of [...lireCitations(r.cite), ...lireCitations(r.figure)]) {
			const cle = cleDocument(c.name);
			if (!cle || vus.has(cle)) continue;
			vus.set(cle, { name: c.name, page: c.page ?? 1 });
		}
	}
	return [...vus.values()];
}

/** The path of the PDF a name designates: first in the quiz's folder (its
    subfolders included, the shallowest then the first by path), then anywhere
    in the roots if the name is unique there. `null` when absent or ambiguous. */
export function resoudreSource(nom: string, quizPath: string, fichiers: readonly { path: string; extension: string; name: string }[]): string | null {
	const voulu = cleDocument(nom);
	const candidats = fichiers.filter(f => f.extension.toLowerCase() === "pdf" && cleDocument(f.name) === voulu);
	if (!candidats.length) return null;
	const dossier = quizPath.includes("/") ? quizPath.slice(0, quizPath.lastIndexOf("/") + 1) : "";
	const locaux = candidats.filter(f => f.path.startsWith(dossier));
	if (locaux.length) {
		return [...locaux].sort((a, b) => a.path.split("/").length - b.path.split("/").length || (a.path < b.path ? -1 : 1))[0].path;
	}
	return candidats.length === 1 ? candidats[0].path : null;
}

/** A file name cut for a chip: the HEAD may shrink with an ellipsis, the TAIL
    (the end of the stem and the whole extension) never does, so the file's type
    stays visible whatever the width. */
export function partiesNom(nom: string): { head: string; tail: string } {
	const ext = /\.[^.\\/]+$/.exec(nom)?.[0] ?? "";
	const stem = ext ? nom.slice(0, -ext.length) : nom;
	if (stem.length <= 22) return { head: stem + ext, tail: "" };
	return { head: stem.slice(0, -8), tail: stem.slice(-8) + ext };
}
