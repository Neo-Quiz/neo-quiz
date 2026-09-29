/* ══════════════════════════════════════════════════════════
   THE "EXPLAIN" PROMPT OF A QUIZ QUESTION (2026-09-29)

   A button on the question being played sends it to Claude Code or Codex
   ("explain this question to me"), instead of a screenshot and a typed
   prompt. The message is a TEMPLATE the learner can change in Settings,
   with placeholders filled from the question:

     {quiz}         the quiz's title
     {question}     the question's title and statement
     {options}      its choices, lettered as on screen (empty otherwise)
     {answer}       the expected answer
     {myAnswer}     what the learner answered, if anything
     {explanation}  the quiz's own explanation, if any

   PURE: no DOM, no host. `npm run check:explain` holds it.
══════════════════════════════════════════════════════════ */

import { parseCloze } from "./engine/cloze";

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

/** The question itself: its title, then its statement (or its cloze text). */
function enonce(q: Q): string {
	const titre = texte(q.title);
	const corps = texte(q.prompt) + (typeof q.cloze === "string" ? (texte(q.prompt) ? "\n" : "") + q.cloze.trim() : "");
	return [titre, corps].filter(Boolean).join("\n");
}

/** The quiz's own explanation of the question. */
function explication(q: Q): string {
	return texte(q.explain);
}

/**
 * The template with its placeholders filled. An empty value leaves its
 * placeholder empty; a line that held only an empty placeholder is dropped,
 * so "My answer: " does not stay dangling when nothing was answered.
 */
export function remplirPromptExplication(template: string, q: Q, extra: { quiz: string; myAnswer?: string; ordre?: number[] }): string {
	const valeurs: Record<string, string> = {
		quiz: extra.quiz.trim(),
		question: enonce(q),
		options: choix(q, extra.ordre),
		answer: reponseAttendue(q, extra.ordre),
		myAnswer: (extra.myAnswer ?? "").trim(),
		explanation: explication(q),
	};
	const lignes = template.split("\n");
	// A line built around placeholders that are ALL empty is dropped...
	const garde = lignes.map(ligne => {
		const cles = [...ligne.matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(k => k in valeurs);
		return cles.length === 0 || cles.some(k => valeurs[k] !== "");
	});
	// ...and so is the label line just above it ("Choices:" with no choices).
	lignes.forEach((ligne, i) => {
		if (garde[i] && i + 1 < lignes.length && !garde[i + 1] && /:\s*$/.test(ligne) && !/\{\w+\}/.test(ligne)) garde[i] = false;
	});
	return lignes
		.filter((_, i) => garde[i])
		.map(ligne => ligne.replace(/\{(\w+)\}/g, (m, k: string) => (k in valeurs ? valeurs[k] : m)))
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
