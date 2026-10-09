/* ══════════════════════════════════════════════════════════
   THE CONTEXT OF THE "EXPLAIN" WINDOW (2026-10-09)

   The learner types freely; behind the scenes, EVERY message carries the
   whole quiz: its title, its folder and ALL its questions (statement,
   choices lettered as the player shows them for the question on screen,
   expected answer, explanation), the question on screen marked, with the
   learner's own answer and whether it is right. Before this, a prompt
   template filled with the single question was shown as a tile.

   PURE: no DOM, no host. `npm run check:explain` holds it.
══════════════════════════════════════════════════════════ */

import { SIMULATOR_GUIDE } from "./interactive-page-guide";
import { parseCloze } from "./engine/cloze";
import { retenirDeLecture } from "./lecture-style";

type Q = Record<string, unknown>;

const LETTRES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function texte(v: unknown): string {
	if (typeof v === "string") return v.trim();
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	return "";
}

function liste(v: unknown): string[] {
	return Array.isArray(v) ? v.map(texte) : [];
}

/** The display order of the options: position on screen → index in the
    question (the player may shuffle them). Absent or not a permutation of
    the options: the question's own order. */
function ordreDe(options: string[], ordre?: number[]): number[] {
	const ok = Array.isArray(ordre) && ordre.length === options.length
		&& [...ordre].sort((a, b) => a - b).every((v, i) => v === i);
	return ok && ordre ? ordre : options.map((_, i) => i);
}

/** The choices of a question, lettered as the player shows them. */
function choix(q: Q, ordre?: number[]): string {
	const options = liste(q.options);
	if (options.length) return ordreDe(options, ordre).map((o, pos) => `${LETTRES[pos] ?? pos + 1}. ${options[o]}`).join("\n");
	if (q.ordering === true) return liste(q.possibilities).map(p => `- ${p}`).join("\n");
	if (q.matching === true) {
		const rows = liste(q.rows);
		const choices = liste(q.choices);
		return rows.map(r => `- ${r}`).join("\n") + (choices.length ? "\n→ " + choices.join(" · ") : "");
	}
	return "";
}

/** The expected answer, in words a model can explain. */
export function reponseAttendue(q: Q, ordre?: number[]): string {
	const options = liste(q.options);
	if (options.length) {
		const o = ordreDe(options, ordre);
		const lettre = (i: number): string => LETTRES[o.indexOf(i)] ?? String(i + 1);
		if (q.multiSelect === true && Array.isArray(q.correctIndices)) {
			return (q.correctIndices as unknown[]).map(Number).filter(i => options[i] !== undefined)
				.sort((a, b) => o.indexOf(a) - o.indexOf(b))
				.map(i => `${lettre(i)}. ${options[i]}`).join(" ; ");
		}
		const i = Number(q.correctIndex);
		if (Number.isInteger(i) && options[i] !== undefined) return `${lettre(i)}. ${options[i]}`;
	}
	if (q.ordering === true && Array.isArray(q.correctOrder)) {
		const p = liste(q.possibilities);
		return (q.correctOrder as unknown[]).map(Number).map(i => p[i]).filter(Boolean).join(" → ");
	}
	if (q.matching === true && Array.isArray(q.correctMap)) {
		const rows = liste(q.rows);
		const choices = liste(q.choices);
		return (q.correctMap as unknown[]).map(Number).map((c, r) => `${rows[r]} → ${choices[c]}`).join(" ; ");
	}
	if (typeof q.cloze === "string") {
		return parseCloze(q.cloze).blanks.map((b, i) => `(${i + 1}) ${b.answers[0] ?? ""}`).join(" ; ");
	}
	const direct = texte(q.answer) || texte(q.correctText);
	if (direct) return direct;
	const acceptees = liste(q.acceptedAnswers).filter(Boolean);
	return acceptees[0] ?? "";
}

/** A pre-rendered HTML field as plain text (tags dropped, block ends kept as
    line breaks): what a reading card or an HTML-only statement says. */
export function htmlEnTexte(html: unknown): string {
	if (typeof html !== "string") return "";
	return html
		.replace(/<\/(p|li|div|h[1-6]|tr)>|<br\s*\/?>/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** What the review journal says about one question (read only). */
export interface HistoireQuestion { attempts: number; misses: number }

/** Misses from which the explanation must go back to the basics. */
export const RATES_FONDAMENTAL = 3;

/** The one-line history of the learner on the question on screen; `null` (no
    line) when the journal has nothing readable about it. */
export function ligneHistorique(h: HistoireQuestion | null | undefined): string | null {
	if (!h || !Number.isInteger(h.attempts) || !Number.isInteger(h.misses) || h.attempts < 1 || h.misses < 0 || h.misses > h.attempts) return null;
	const base = `Learner's history on this question: ${h.attempts} attempt${h.attempts === 1 ? "" : "s"}, ${h.misses} missed.`;
	return h.misses >= RATES_FONDAMENTAL ? base + " Missed repeatedly: rebuild the underlying concept from the basics, do not just restate the answer." : base;
}

/**
 * How the tutor must explain, appended to the context of every message. Kept
 * here (pure) so that `check:explain` holds each step. A reading card is
 * rephrased; a question gets the full method.
 */
export function consigneExplication(lecture: boolean): string {
	const commun = [
		"Reply in the learner's language (in French, address them as \"tu\"). Write short headed sections, lists and **bold** for the key words, never a wall of text.",
		"Ground the explanation in the course: quote or point to at least one passage of it, naming the document and the page given by the [p. N] mark that precedes it, like \"CM2.pdf, p. 7\".",
		"When a drawn or interactive page explains better than words (a diagram, a sequence diagram, a symbol table, a process, a small simulator or a clickable mini-quiz), you MAY write it as ONE complete, self-contained HTML page in a fenced block that starts with a line of exactly three backticks followed by html, and ends with a line of three backticks. The app shows it in an interactive frame under your text. No external resource and no network (everything inline, inline SVG for drawings), fluid width, no fixed height, dark-friendly (use the CSS variables --nq-bg, --nq-fg, --nq-muted, --nq-accent, --nq-border and font-family: var(--nq-font), transparent background), at most 60 KB. Never for plain text, and still explain in words around it.",
		SIMULATOR_GUIDE,
		"When a picture listed in the context shows what you explain (the figure the question is about, a diagram), SHOW it: write its exact name as ![[exact name]] on its own line, right where you start talking about it, then refer to what is on it. Only the pictures listed exist, never invent a name.",
	];
	if (lecture) {
		return "HOW TO EXPLAIN (this is a reading card):\n" + [
			"1. Rephrase the card more simply, in plain words, defining each term the first time.",
			"2. Then give one concrete example.",
			...commun,
		].join("\n");
	}
	return "HOW TO EXPLAIN (this is a question):\n" + [
		"1. First spot the likely reasoning error behind the learner's WRONG answer, in one or two sentences (skip if they were right).",
		"2. Explain the notion step by step, starting from zero.",
		"3. Say why the right answer is right AND why each option the learner chose wrongly is wrong.",
		"4. Give one concrete example or an analogy.",
		"5. End with ONE short check question the learner can answer in their head, without giving its answer.",
		...commun,
	].join("\n");
}

/** One question of the quiz, as a block of the context. */
function bloc(q: Q, n: number, courant: boolean, extra: { ordre?: number[]; myAnswer?: string; correct?: boolean | null; history?: HistoireQuestion | null }): string {
	const lecture = q.role === "read";
	const lignes: string[] = [`[Q${n}]${courant ? " <<< QUESTION ON SCREEN >>>" : ""}${lecture ? " (reading card, not a question)" : ""}`];
	const titre = texte(q.title);
	const corps = texte(q.prompt) || htmlEnTexte(q.promptHtml);
	if (titre) lignes.push(`Title: ${titre}`);
	const cloze = typeof q.cloze === "string" ? q.cloze.trim() : "";
	if (corps || cloze) lignes.push(`Statement: ${[corps, cloze].filter(Boolean).join("\n")}`);
	const passage = texte(q.passageTitle);
	if (passage) lignes.push(`Document shown: ${passage}`);
	const choices = choix(q, courant ? extra.ordre : undefined);
	if (choices) lignes.push(`Choices:\n${choices}`);
	if (lecture) {
		const etapes = liste(q.etapes).filter(Boolean);
		if (etapes.length) lignes.push("Steps:\n" + etapes.map((e, i) => `${i + 1}. ${e}`).join("\n"));
		const retenir = retenirDeLecture(q);
		if (retenir?.forme === "cartes") lignes.push("Key points:\n" + retenir.items.map(c => `- ${c.recto}: ${c.verso}`).join("\n"));
		else if (retenir?.forme === "recap") lignes.push("Key points:\n" + retenir.items.map(i => `- ${i}`).join("\n"));
		if (courant) {
			const cite = texte(q.cite);
			if (cite) lignes.push(`Source: ${cite}`);
			const figure = texte(q.figure);
			if (figure) lignes.push(`Figure shown above the card: ${figure}`);
		}
	}
	if (!lecture) {
		const bonne = reponseAttendue(q, courant ? extra.ordre : undefined);
		if (bonne) lignes.push(`Expected answer: ${bonne}`);
		const why = texte(q.explain) || htmlEnTexte(q.explainHtml);
		if (why) lignes.push(`Explanation: ${why}`);
	}
	if (courant && !lecture) {
		const mine = (extra.myAnswer ?? "").trim();
		lignes.push(`Learner's answer: ${mine || "(none)"}`);
		if (extra.correct === true) lignes.push("The learner's answer is RIGHT.");
		else if (extra.correct === false) lignes.push("The learner's answer is WRONG.");
		const histoire = ligneHistorique(extra.history);
		if (histoire) lignes.push(histoire);
	}
	return lignes.join("\n");
}

/**
 * The quiz as the model gets it: header, then EVERY question in order, the one
 * on screen (`courant`, an index in `questions`) marked with the learner's
 * answer. An out-of-range `courant` marks nothing.
 */
export function contexteQuiz(questions: Q[], extra: { quiz: string; folder?: string; courant: number; ordre?: number[]; myAnswer?: string; correct?: boolean | null; history?: HistoireQuestion | null }): string {
	const tete = [`QUIZ: ${extra.quiz.trim()}`];
	if (extra.folder?.trim()) tete.push(`FOLDER: ${extra.folder.trim()}`);
	tete.push("The question marked \"QUESTION ON SCREEN\" is the one the learner is looking at; the others are the rest of the same quiz.");
	return tete.join("\n") + "\n\n" + questions.map((q, i) => bloc(q, i + 1, i === extra.courant, extra)).join("\n\n") + "\n";
}
