/* ══════════════════════════════════════════════════════════
   THE COURSE BEHIND THE "EXPLAIN" WINDOW (2026-10-09)

   The model is given what a tutor launched in the quiz's folder would see:
   the text of the folder's notes and PDFs (the documents the quiz cites
   first), within a budget, and the folder's pictures (the ones the quiz
   cites first, the most cited first), within a count and a size.

   PURE: no DOM, no host (the reading is done by `ui/explain-cours.ts`).
   `npm run check:explain` holds it.
══════════════════════════════════════════════════════════ */

import { QUIZ_BLOCK_RE } from "./quiz-utils";

/** The most characters of course text sent with a message. */
export const COURSE_MAX_CHARS = 100_000;
/** The most pictures, and bytes of pictures, sent with a message. */
export const IMAGES_MAX = 20;
export const IMAGES_MAX_BYTES = 15 * 1024 * 1024;

export const IMAGE_MEDIA: Record<string, string> = {
	png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
};

export interface CourseDoc { name: string; text: string }

/** Every string of a value, however deep. */
function chaines(v: unknown, out: string[] = []): string[] {
	if (typeof v === "string") out.push(v);
	else if (Array.isArray(v)) v.forEach(x => chaines(x, out));
	else if (v && typeof v === "object") Object.values(v).forEach(x => chaines(x, out));
	return out;
}

/** The last segment of a path, `/` or `\`. */
export function nomDe(chemin: string): string {
	return chemin.split(/[\\/]/).pop() ?? chemin;
}

/** A note without its frontmatter and without its quiz blocks: what is left
    is the course text. A note that holds only a quiz leaves nothing. */
export function sansQuiz(note: string): string {
	const sansBloc = note.replace(new RegExp(QUIZ_BLOCK_RE.source, "g"), "");
	return sansBloc.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "").trim();
}

/** The texts where a quiz names its documents: the `cite` of its cards and
    the `source` of its frontmatter or configuration. */
export function citations(questions: Record<string, unknown>[], extra: string[] = []): string[] {
	const cites = questions.map(q => (typeof q.cite === "string" ? q.cite : "")).filter(Boolean);
	return [...cites, ...extra.filter(Boolean)];
}

/** Does one of the citations name this file (its full name or its name
    without extension), whatever the case? */
export function estCite(nom: string, cites: string[]): boolean {
	const plein = nom.toLowerCase();
	const sans = plein.replace(/\.[^.]+$/, "");
	return cites.some(c => {
		const x = c.toLowerCase();
		return x.includes(plein) || (sans.length >= 3 && x.includes(sans));
	});
}

/** The documents, the ones the quiz cites first; the order is otherwise kept. */
export function ordreCours<T extends { name: string }>(docs: T[], cites: string[]): T[] {
	return [...docs.map((d, i) => ({ d, i, c: estCite(d.name, cites) }))]
		.sort((a, b) => Number(b.c) - Number(a.c) || a.i - b.i)
		.map(x => x.d);
}

/**
 * The course text: every document under a title, in order, up to `max`
 * characters. The first document that does not fit is cut where it stands and
 * the rest is left out; the model is told so, with the names left out.
 */
export function assemblerCours(docs: CourseDoc[], max = COURSE_MAX_CHARS, horsBudget: string[] = []): string {
	const parts: string[] = [];
	let used = 0;
	const omis = [...horsBudget];
	for (let i = 0; i < docs.length; i++) {
		const d = docs[i];
		const entete = `=== DOCUMENT: ${d.name} ===\n`;
		const place = max - used - entete.length;
		if (place <= 200) { omis.push(...docs.slice(i).map(x => x.name)); break; }
		if (d.text.length <= place) {
			parts.push(entete + d.text);
			used += entete.length + d.text.length + 2;
			continue;
		}
		parts.push(entete + d.text.slice(0, place).replace(/\s+\S*$/, "") + "\n[… this document is cut here]");
		omis.push(...docs.slice(i + 1).map(x => x.name));
		break;
	}
	if (omis.length) parts.push(`[The course continues but was cut at ${max} characters. Not included: ${omis.join(", ")}]`);
	return parts.join("\n\n");
}

/** How many times each picture is named in the quiz (`![[x.png]]`, a
    `figure`, an image of a card...), by lower-cased file name. */
export function imagesCitees(questions: Record<string, unknown>[]): Map<string, number> {
	const n = new Map<string, number>();
	const re = /([^\\/\[\]|()"'<>:*?\r\n]+\.(?:png|jpe?g|gif|webp))/gi;
	for (const s of chaines(questions)) {
		for (const m of s.matchAll(re)) {
			const nom = nomDe(m[1].trim()).toLowerCase();
			n.set(nom, (n.get(nom) ?? 0) + 1);
		}
	}
	return n;
}

export interface ImageFile { path: string; name: string; size: number }

/**
 * Which pictures go: the cited ones first (the most cited first), then the
 * others in path order; at most `IMAGES_MAX` of them, `IMAGES_MAX_BYTES` in
 * all. A picture that does not fit is skipped, a smaller one after it may.
 */
export function choisirImages(files: ImageFile[], citees: Map<string, number>): ImageFile[] {
	const triees = files.map((f, i) => ({ f, i, n: citees.get(f.name.toLowerCase()) ?? 0 }))
		.sort((a, b) => b.n - a.n || a.f.path.localeCompare(b.f.path) || a.i - b.i)
		.map(x => x.f);
	const out: ImageFile[] = [];
	let total = 0;
	for (const f of triees) {
		if (out.length >= IMAGES_MAX) break;
		if (f.size <= 0 || total + f.size > IMAGES_MAX_BYTES) continue;
		out.push(f);
		total += f.size;
	}
	return out;
}
