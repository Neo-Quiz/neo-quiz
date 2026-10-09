/* ══════════════════════════════════════════════════════════
   READING THE COURSE FOR THE "EXPLAIN" WINDOW (2026-10-09)

   What a tutor launched in the quiz's folder would see: the text of its
   notes and PDFs (what the quiz cites first, `explain-course.ts` decides the
   order and the budget) and its pictures, subfolders included. Read through
   the host's contract only, once per quiz page (the caller keeps the promise).
══════════════════════════════════════════════════════════ */

import { currentHost } from "../../../../src/host/current";
import type { HostFile } from "../../../../src/host/types";
import type { ImagePayload } from "../../../../src/dashboard/ai-client";
import { LOG_PREFIX } from "../../../../src/branding";
import { lireFrontmatterNeoQuiz } from "../../../../src/quiz-frontmatter";
import { QUIZ_BLOCK_RE, parseQuizSource } from "../../../../src/quiz-utils";
import {
	COURSE_MAX_CHARS, IMAGE_MEDIA, assemblerCours, choisirImages, citations, imagesCitees,
	nomDe, ordreCours, sansQuiz,
} from "../../../../src/explain-course";
import type { CourseDoc, ImageFile } from "../../../../src/explain-course";

/** Over this a PDF is not even opened: its text would fill the budget alone. */
const PDF_MAX_OCTETS = 60 * 1024 * 1024;

export interface Cours {
	/** The course text, within the budget. */
	texte: string;
	images: ImagePayload[];
	/** The file names of `images`, for a provider that cannot see them. */
	nomsImages: string[];
	/** A document or a picture failed to read: the caller does not keep this result. */
	incomplet: boolean;
}

function enBase64(octets: Uint8Array): string {
	let s = "";
	for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode(...octets.subarray(i, i + 0x8000));
	return btoa(s);
}

/** The `source` of the quiz configuration object, if the note has one. */
function sourceConfig(note: string): string {
	try {
		const bloc = note.match(QUIZ_BLOCK_RE);
		if (!bloc) return "";
		const item = parseQuizSource(bloc[1]).find(q => typeof (q as { source?: unknown }).source === "string" && !(q as { prompt?: unknown }).prompt);
		return ((item as { source?: string } | undefined)?.source) ?? "";
	} catch { return ""; }
}

export async function lireCours(quizPath: string, note: string, questions: Record<string, unknown>[]): Promise<Cours> {
	const host = currentHost();
	const dossier = quizPath.includes("/") ? quizPath.slice(0, quizPath.lastIndexOf("/")) : "";
	const prefixe = dossier ? dossier + "/" : "";
	const fichiers: HostFile[] = host.fs.listFiles().filter(f => f.path !== quizPath && f.path.startsWith(prefixe));
	const cites = citations(questions, [lireFrontmatterNeoQuiz(note)?.source ?? "", sourceConfig(note)]);

	// ── The text: the notes and PDFs of the folder itself ──
	const candidats = fichiers.filter(f => !f.path.slice(prefixe.length).includes("/") && ["md", "markdown", "txt", "pdf"].includes(f.extension.toLowerCase()));
	let incomplet = false;
	const lus: CourseDoc[] = [];
	const horsBudget: string[] = [];
	let total = 0;
	for (const f of ordreCours(candidats, cites)) {
		if (total >= COURSE_MAX_CHARS) { horsBudget.push(f.name); continue; }
		try {
			let texte = "";
			if (f.extension.toLowerCase() === "pdf") {
				if (!host.pdf) { incomplet = true; continue; }
				if (((await host.fs.size(f.path)) ?? 0) > PDF_MAX_OCTETS) { horsBudget.push(f.name); continue; }
				texte = (await host.pdf.extractText(await host.fs.readBinary(f.path))).trim();
			} else {
				texte = sansQuiz(await host.fs.read(f.path));
			}
			if (!texte) continue;
			lus.push({ name: f.name, text: texte });
			total += texte.length;
		} catch (e) {
			incomplet = true;
			console.warn(`${LOG_PREFIX} Explain: ${f.path} unreadable:`, e);
		}
	}

	// ── The pictures: the folder and its subfolders, plus the cited ones found elsewhere ──
	const citees = imagesCitees(questions);
	const images = fichiers.filter(f => f.extension.toLowerCase() in IMAGE_MEDIA);
	const connus = new Set(images.map(f => f.path));
	for (const nom of citees.keys()) {
		if (images.some(f => f.name.toLowerCase() === nom)) continue;
		const f = host.links.resolve(nom, quizPath);
		if (f && !connus.has(f.path)) { images.push(f); connus.add(f.path); }
	}
	const dimensionnes: ImageFile[] = [];
	for (const f of images) {
		const size = await host.fs.size(f.path).catch(() => null);
		if (size) dimensionnes.push({ path: f.path, name: f.name, size });
	}
	const choisies = choisirImages(dimensionnes, citees);
	const payloads: ImagePayload[] = [];
	const noms: string[] = [];
	for (const f of choisies) {
		try {
			const ext = nomDe(f.name).split(".").pop()!.toLowerCase();
			payloads.push({ base64: enBase64(await host.fs.readBinary(f.path)), mediaType: IMAGE_MEDIA[ext] });
			noms.push(f.name);
		} catch (e) {
			incomplet = true;
			console.warn(`${LOG_PREFIX} Explain: ${f.path} unreadable:`, e);
		}
	}
	return { texte: assemblerCours(lus, COURSE_MAX_CHARS, horsBudget), images: payloads, nomsImages: noms, incomplet };
}
