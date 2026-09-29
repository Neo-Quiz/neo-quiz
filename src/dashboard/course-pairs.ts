import type { QuizIndexEntry } from "./scanner";
import type { ModeQuiz } from "../quiz-format";

/* ══════════════════════════════════════════════════════════
   ONE COURSE, ITS MODES — a PURE module (no host, no DOM).

   A course has one file per mode: "CM1 — Learn", "CM1 — Practice",
   "CM1 — Exam". The format does not change (one file per mode stays the
   definitive rule, 2026-09-24); it is the DISPLAY that brings them together:
   six cards for three lectures gave the impression of a mountain of work.

   Quizzes form a course when they are in the SAME folder, carry the SAME
   title (the mode suffix is already stripped by the scanner) and have
   DIFFERENT modes — at most one quiz per mode, so two or three of them
   (spec 2026-09-29-test-practice-exam-design §5.2). Two namesakes of the
   same mode, or more than three, are not brought together: we do not guess
   which goes with which. A multi-document Exam ("<module> — Exam") carries
   the module's name, not a course's, and stays a card of its own.
══════════════════════════════════════════════════════════ */

/** A card of the grid: a quiz, and the other modes of its course when they
    were brought together. `quiz` is the first by mode — Learn, then
    Practice, then Exam — and `freres` the others, in the same order. */
export interface CarteCours {
	quiz: QuizIndexEntry;
	freres: QuizIndexEntry[];
}

const ORDRE_MODES: Readonly<Record<ModeQuiz, number>> = { learn: 0, practice: 1, exam: 2 };

/** Learn, then Practice, then Exam: the order of a course everywhere. */
export function parMode(a: QuizIndexEntry, b: QuizIndexEntry): number {
	return ORDRE_MODES[a.mode] - ORDRE_MODES[b.mode];
}

function cle(q: QuizIndexEntry): string {
	const dossier = q.path.split("/").slice(0, -1).join("/");
	return dossier + "\u0000" + q.title.trim().toLocaleLowerCase();
}

/** The quizzes of the OTHER modes of the same course, by mode; empty when
    the quiz is not part of a course. */
export function quizFreres(quiz: QuizIndexEntry, tous: readonly QuizIndexEntry[]): QuizIndexEntry[] {
	const k = cle(quiz);
	const memes = tous.filter(q => cle(q) === k);
	if (memes.length < 2 || memes.length > 3) return [];
	if (new Set(memes.map(q => q.mode)).size !== memes.length) return [];
	return memes.filter(q => q.path !== quiz.path).sort(parMode);
}

/** Every quiz of a card, by mode. */
export function quizDeLaCarte(carte: CarteCours): QuizIndexEntry[] {
	return [carte.quiz, ...carte.freres];
}

/** The cards of a grid, in the order received: a course takes the place of
    its first quiz, its modes by order. `actif` false: one card per quiz, as
    before. */
export function regrouperParCours(quizzes: readonly QuizIndexEntry[], actif: boolean): CarteCours[] {
	if (!actif) return quizzes.map(quiz => ({ quiz, freres: [] }));
	const vus = new Set<string>();
	const cartes: CarteCours[] = [];
	for (const q of quizzes) {
		if (vus.has(q.path)) continue;
		const freres = quizFreres(q, quizzes);
		if (freres.length === 0) { cartes.push({ quiz: q, freres: [] }); continue; }
		const tous = [q, ...freres].sort(parMode);
		for (const x of tous) vus.add(x.path);
		cartes.push({ quiz: tous[0], freres: tous.slice(1) });
	}
	return cartes;
}
