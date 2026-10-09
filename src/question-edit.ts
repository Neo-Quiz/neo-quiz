/* ══════════════════════════════════════════════════════════
   LIVE EDIT OF A QUESTION FROM THE ASSISTANT CHAT (2026-10-09)

   The sister of `explain-edit.ts` (which rewrites a READING card): the same
   `<card-edit>{ ...JSON... }</card-edit>` block, here holding the changed
   fields of a QUESTION (rephrase the statement, fix an ambiguous or wrong
   option, fix the right answer, improve the explanation or the hint). This
   module decides whether the app may even PROPOSE it, and describes the
   change for the before/after preview. Nothing is written here (the write is
   `detail-io.ts` `saveQuestionEdit`, after a click, which runs
   `checkQuestionFields` again on the note's own copy of the question).

   Guards, all before the proposal is shown:
   - strictly valid JSON, an object, at least one field;
   - a WHITELIST per kind of question (`questionEditFields`): the statement
     and the explanation in the form the question already uses (`prompt` or
     `promptHtml`, `explain` or `explainHtml`), `hint`, `title`, and the
     answer fields of its kind only. Never `id`, `role`, `type`, `slice`, nor
     any key that would change the kind of the question (`kind`);
   - coherence: right answers inside the options, at least one right answer,
     no duplicate option, an ordering or a matching that stays complete, a
     cloze that keeps its number of blanks, a numeric answer that is a number;
   - reasonable lengths (`LIMITS`, or 25 % above what the question already
     holds when it is longer);
   - every HTML field goes through the sanitizer handed in (the app passes
     `sanitizeQuizHtml`, the first of the four gates of engine/sanitizer.ts).

   The identifier of the question never moves: `id` is refused, and a
   question WITHOUT an explicit id keeps its title, since its id is the slug
   of that title (`quiz-ids.ts`).

   PURE: no DOM, no host. `npm run check:explain` holds it.
══════════════════════════════════════════════════════════ */

import { htmlEnTexte, reponseAttendue } from "./explain-prompt";
import { parseCloze } from "./engine/cloze";
import { isNumericQuestion, parseNumericValue } from "./engine/numeric";
import type { TextQuestion } from "./types/quiz";

type Q = Record<string, unknown>;

export type QuestionKind = "single" | "multiple" | "text" | "cloze" | "code" | "flashcard" | "ordering" | "matching" | "other";

export type QuestionEditRefusal =
	| "notQuestion" | "json" | "empty" | "unchanged" | "field" | "kind" | "type"
	| "tooLong" | "bounds" | "noAnswer" | "duplicate" | "incomplete";

/** One line of the before/after preview: a field and its text on each side. */
export interface QuestionEditRow { field: string; before: string; after: string }

/** The right answer, before and after, in words (letters as on screen). */
export interface AnswerChange { from: string; to: string }

export type QuestionEditResult =
	/** `reordered`: options (or items, rows, choices) moved or changed in
	    number; the learner's stored answer to it no longer means anything. */
	| { ok: true; fields: Q; rows: QuestionEditRow[]; answerChange: AnswerChange | null; reordered: boolean }
	| { ok: false; reason: QuestionEditRefusal };

/** Keys that decide WHAT a question is: proposing one is changing its kind. */
const KIND_KEYS = ["type", "multiSelect", "ordering", "matching", "cloze", "flashcard", "language", "role", "slice", "mode", "text", "numeric"];

/** The most a field may hold, in characters (HTML read as text). A question
    that already holds more may grow by 25 %. */
export const LIMITS = { title: 200, prompt: 4000, explain: 4000, hint: 800, option: 600, answer: 500, cloze: 4000 } as const;
const GROWTH = 1.25;
/** Room added to the answer budget of the chat for a `<card-edit>` block on a question. */
export const QUESTION_EDIT_ROOM = 3000;
const MAX_OPTIONS = 10;
const MAX_HINTS = 4;
const MAX_ANSWERS = 20;
const MAX_ITEMS = 12;
const MAX_CHOICES = 15;

const isArr = Array.isArray;
const str = (v: unknown): v is string => typeof v === "string";
const filled = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const int = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
/** Two texts that would read as the same option. */
const norm = (s: unknown): string => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

/** The kind of a question, in the order the engine discriminates them
    (engine.ts `isTextQuestion`, `isClozeQuestion`... then `multiSelect`).
    `null` for a reading card, which `explain-edit.ts` handles. */
export function questionKind(q: Q): QuestionKind | null {
	if (q.role === "read") return null;
	if (q.type === "text" || q.text === true) return "text";
	if (filled(q.cloze)) return "cloze";
	if (filled(q.language)) return "code";
	if (q.flashcard === true) return "flashcard";
	/* Only the flat forms the editor writes have editable answers; the nested
	   `ordering: {...}` / `matching: {...}` of hand-written quizzes are left to
	   the editor, and only their texts may change here. */
	if (q.ordering === true || (q.ordering && typeof q.ordering === "object")) return q.ordering === true && isArr(q.possibilities) && isArr(q.correctOrder) ? "ordering" : "other";
	if (q.matching === true || (q.matching && typeof q.matching === "object")) return q.matching === true && isArr(q.rows) && isArr(q.choices) && isArr(q.correctMap) ? "matching" : "other";
	if (isArr(q.options)) return q.multiSelect === true ? "multiple" : "single";
	return "other";
}

/** `base` or `baseHtml`, whichever the question shows (the HTML wins in the engine). */
const htmlOr = (q: Q, base: string): string => (str(q[base + "Html"]) ? base + "Html" : base);
/** The key of the right answers of a multiple choice (an old note may say `correctIndexes`). */
const indicesKey = (q: Q): string => (isArr(q.correctIndexes) && !isArr(q.correctIndices) ? "correctIndexes" : "correctIndices");

/** The fields the chat may change on this question, nothing else. */
export function questionEditFields(q: Q): string[] {
	const kind = questionKind(q);
	if (kind === null) return [];
	const common = ["title", htmlOr(q, "prompt"), htmlOr(q, "explain"), "hint"];
	const optionHtml = isArr(q.optionHtml) ? ["optionHtml"] : [];
	switch (kind) {
		case "single": return [...common, "options", ...optionHtml, "correctIndex"];
		case "multiple": return [...common, "options", ...optionHtml, indicesKey(q)];
		case "text": return [...common, "answer", "acceptedAnswers", ...["correctText", "acceptableAnswers", "correctAnswers"].filter(k => q[k] !== undefined)];
		case "flashcard": return [...common, "answer"];
		case "cloze": return [...common, "cloze"];
		case "ordering": return [...common, "possibilities", "correctOrder", ...(isArr(q.slots) ? ["slots"] : [])];
		case "matching": return [...common, "rows", "choices", "correctMap"];
		default: return common;
	}
}

/** Length of a field as the learner reads it. */
function lengthOf(key: string, v: unknown): number {
	if (str(v)) return (key.endsWith("Html") ? htmlEnTexte(v) : v.trim()).length;
	if (isArr(v)) return v.reduce<number>((n, x) => Math.max(n, lengthOf(key, x)), 0);
	return 0;
}

function limitOf(key: string): number {
	const base = key.replace(/Html$/, "");
	if (base === "title") return LIMITS.title;
	if (base === "prompt") return LIMITS.prompt;
	if (base === "explain") return LIMITS.explain;
	if (base === "hint") return LIMITS.hint;
	if (base === "cloze") return LIMITS.cloze;
	if (["answer", "correctText", "acceptedAnswers", "acceptableAnswers", "correctAnswers"].includes(base)) return LIMITS.answer;
	return LIMITS.option;
}

const distinct = (xs: unknown[]): boolean => new Set(xs.map(norm)).size === xs.length;
const isPermutation = (v: unknown, n: number): boolean =>
	isArr(v) && v.length === n && v.every(x => int(x) && x >= 0 && x < n) && new Set(v).size === n;

/**
 * Checks `given` (field → value) against the question `original`, without
 * parsing: the whitelist, the shape of each value, the coherence of the
 * question once merged. Returns the fields to write (HTML sanitized, a title
 * that may not move dropped) or why not. Also the write's own last check.
 */
export function checkQuestionFields(original: Q, given: Q, sanitizeHtml: (html: string) => string): { ok: true; fields: Q } | { ok: false; reason: QuestionEditRefusal } {
	const no = (reason: QuestionEditRefusal) => ({ ok: false as const, reason });
	if (!original || typeof original !== "object") return no("notQuestion");
	const kind = questionKind(original);
	if (kind === null) return no("notQuestion");
	const keys = Object.keys(given);
	if (keys.length === 0) return no("empty");
	const allowed = questionEditFields(original);
	for (const k of keys) {
		if (allowed.includes(k)) continue;
		return no(KIND_KEYS.includes(k) ? "kind" : "field");
	}

	const fields: Q = {};
	for (const k of keys) {
		const v = given[k];
		const base = k.replace(/Html$/, "");
		if (k === "title") {
			if (!filled(v)) return no("type");
			/* A question without an explicit `id` takes its id from its title's
			   slug (`quiz-ids.ts`): renaming it would change its review key and
			   shift its suffixed namesakes. Such a question keeps its title. */
			if (filled(original.id)) fields.title = v.trim();
			continue;
		}
		if (base === "prompt" || base === "explain") {
			if (!str(v)) return no("type");
			const clean = k.endsWith("Html") ? sanitizeHtml(v) : v;
			if (!(k.endsWith("Html") ? htmlEnTexte(clean) : clean.trim())) return no("type");
			fields[k] = clean;
			continue;
		}
		if (k === "hint") {
			if (filled(v)) { fields.hint = v; continue; }
			if (!isArr(v) || v.length === 0 || v.length > MAX_HINTS || !v.every(filled)) return no("type");
			fields.hint = [...v];
			continue;
		}
		if (["options", "possibilities", "rows", "choices", "slots", "acceptedAnswers", "acceptableAnswers", "correctAnswers", "optionHtml"].includes(k)) {
			if (!isArr(v) || v.length === 0 || !v.every(filled)) return no("type");
			fields[k] = k === "optionHtml" ? v.map(h => sanitizeHtml(h as string)) : [...v];
			continue;
		}
		if (k === "correctIndex") {
			if (!int(v)) return no("type");
			fields[k] = v;
			continue;
		}
		if (k === "correctIndices" || k === "correctIndexes" || k === "correctOrder" || k === "correctMap") {
			if (!isArr(v) || !v.every(int)) return no("type");
			fields[k] = [...v];
			continue;
		}
		if (k === "answer" || k === "correctText" || k === "cloze") {
			if (!filled(v)) return no("type");
			fields[k] = v;
			continue;
		}
		return no("field");
	}

	/* Lengths: each field under its limit, or under 25 % above what the
	   question already holds there. */
	for (const [k, v] of Object.entries(fields)) {
		const cap = Math.max(limitOf(k), Math.ceil(lengthOf(k, original[k]) * GROWTH));
		if (lengthOf(k, v) > cap) return no("tooLong");
	}

	/* Coherence of the question once merged. */
	const m: Q = { ...original, ...fields };
	if (kind === "single" || kind === "multiple") {
		const options = m.options as unknown[];
		if (!isArr(options) || options.length < 2 || options.length > MAX_OPTIONS) return no("incomplete");
		if (!distinct(options)) return no("duplicate");
		if (isArr(original.optionHtml)) {
			/* The engine shows `optionHtml[i]` BEFORE `options[i]` (engine/cards.ts
			   `optionContentHtml`): new options, or a new right answer, without
			   their HTML would show the old texts against the new key. So a change
			   of either carries a whole `optionHtml`, as long as the options, and
			   an option that only moved keeps its own HTML. */
			const html = m.optionHtml;
			if (("options" in given || "correctIndex" in given || indicesKey(original) in given) && !("optionHtml" in given)) return no("incomplete");
			if (!isArr(html) || html.length !== options.length) return no("incomplete");
			const oldOptions = (original.options as unknown[]).map(norm);
			const oldHtml = original.optionHtml as unknown[];
			for (let i = 0; i < options.length; i++) {
				const j = oldOptions.indexOf(norm(options[i]));
				if (j >= 0 && norm(htmlEnTexte(html[i])) !== norm(htmlEnTexte(oldHtml[j]))) return no("incomplete");
			}
		}
		if (kind === "single") {
			if (!int(m.correctIndex)) return no("noAnswer");
			if (m.correctIndex < 0 || m.correctIndex >= options.length) return no("bounds");
		} else {
			const ids = m[indicesKey(original)];
			if (!isArr(ids) || ids.length === 0) return no("noAnswer");
			if (!ids.every(i => int(i) && i >= 0 && i < options.length)) return no("bounds");
			if (new Set(ids).size !== ids.length) return no("duplicate");
		}
	}
	if (kind === "text" || kind === "flashcard") {
		const accepted = acceptedOf(m);
		if (accepted.length === 0) return no("noAnswer");
		if (accepted.length > MAX_ANSWERS) return no("tooLong");
		if (kind === "text" && isNumericQuestion(m as unknown as TextQuestion) && !accepted.every(a => parseNumericValue(a) !== null)) return no("type");
	}
	if (kind === "cloze") {
		const blanks = parseCloze(m.cloze).blanks.length;
		if (blanks === 0) return no("noAnswer");
		/* Same number of blanks: a learner's answers are kept blank by blank. */
		if (blanks !== parseCloze(original.cloze).blanks.length) return no("incomplete");
	}
	if (kind === "ordering") {
		const items = m.possibilities as unknown[];
		if (items.length < 2 || items.length > MAX_ITEMS) return no("incomplete");
		if (!distinct(items)) return no("duplicate");
		if (!isPermutation(m.correctOrder, items.length)) return no(isArr(m.correctOrder) && (m.correctOrder as unknown[]).some(i => !int(i) || (i as number) < 0 || (i as number) >= items.length) ? "bounds" : "incomplete");
		if (isArr(original.slots) && (m.slots as unknown[]).length !== items.length) return no("incomplete");
	}
	if (kind === "matching") {
		const rows = m.rows as unknown[];
		const choices = m.choices as unknown[];
		if (rows.length < 2 || rows.length > MAX_ITEMS || choices.length < 2 || choices.length > MAX_CHOICES) return no("incomplete");
		if (!distinct(rows) || !distinct(choices)) return no("duplicate");
		const map = m.correctMap as unknown[];
		if (map.length !== rows.length) return no("incomplete");
		if (!map.every(i => int(i) && i >= 0 && i < choices.length)) return no("bounds");
	}

	const changed = Object.keys(fields).filter(k => JSON.stringify(fields[k]) !== JSON.stringify(original[k]));
	if (changed.length === 0) return no(Object.keys(fields).length === 0 ? "empty" : "unchanged");
	const out: Q = {};
	for (const k of changed) out[k] = fields[k];
	return { ok: true, fields: out };
}

/** Every accepted answer of a written answer or a flashcard (the five fields
    `engine/terminal.ts` `getTextAcceptedAnswers` reads). */
function acceptedOf(q: Q): string[] {
	const out: unknown[] = [];
	for (const k of ["acceptedAnswers", "acceptableAnswers", "correctAnswers"]) if (isArr(q[k])) out.push(...(q[k] as unknown[]));
	if (str(q.correctText)) out.push(q.correctText);
	if (str(q.answer)) out.push(q.answer);
	return out.filter(filled);
}

/** Sorted, normalised, for a comparison that ignores order and spacing. */
const bag = (xs: unknown[]): string => JSON.stringify(xs.map(norm).sort());

/** Does the RIGHT answer change? A reworded option keeps it, and so does an
    option only moved; only a different right answer counts. */
function answerChanged(kind: QuestionKind, a: Q, b: Q): boolean {
	const opts = (q: Q): unknown[] => (isArr(q.options) ? q.options as unknown[] : []);
	if (kind === "single") {
		return a.correctIndex !== b.correctIndex && norm(opts(a)[a.correctIndex as number]) !== norm(opts(b)[b.correctIndex as number]);
	}
	if (kind === "multiple") {
		const k = indicesKey(a);
		const ia = (a[k] as number[]) ?? [];
		const ib = (b[k] as number[]) ?? [];
		return JSON.stringify([...ia].sort()) !== JSON.stringify([...ib].sort())
			&& bag(ia.map(i => opts(a)[i])) !== bag(ib.map(i => opts(b)[i]));
	}
	if (kind === "text" || kind === "flashcard") return bag(acceptedOf(a)) !== bag(acceptedOf(b));
	if (kind === "cloze") {
		const blanks = (q: Q): string => JSON.stringify(parseCloze(q.cloze).blanks.map(x => x.answers.map(norm).sort()));
		return blanks(a) !== blanks(b);
	}
	if (kind === "ordering") {
		const seq = (q: Q): string => JSON.stringify((q.correctOrder as number[]).map(i => norm((q.possibilities as unknown[])[i])));
		return JSON.stringify(a.correctOrder) !== JSON.stringify(b.correctOrder) && seq(a) !== seq(b);
	}
	if (kind === "matching") {
		const pairs = (q: Q): string => bag((q.correctMap as number[]).map((c, r) => norm((q.rows as unknown[])[r]) + "→" + norm((q.choices as unknown[])[c])));
		return JSON.stringify(a.correctMap) !== JSON.stringify(b.correctMap) && pairs(a) !== pairs(b);
	}
	return false;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NL = "\n";

/** A field as the preview shows it: plain text, options lettered. */
function shown(key: string, v: unknown, ordre?: number[]): string {
	const plain = (x: unknown): string => (str(x) ? (key.endsWith("Html") ? htmlEnTexte(x) : x.trim()) : x === undefined || x === null ? "" : String(x));
	if (!isArr(v)) return plain(v);
	if (key === "options" || key === "optionHtml") {
		const order = ordre && ordre.length === v.length ? ordre : v.map((_, i) => i);
		return order.map((o, pos) => `${LETTERS[pos] ?? pos + 1}. ${plain(v[o])}`).join(NL);
	}
	return v.map(x => `- ${plain(x)}`).join(NL);
}

/** The order the player shows the options in, if it still fits `q`. */
function orderFor(q: Q, ordre?: number[]): number[] | undefined {
	const n = isArr(q.options) ? (q.options as unknown[]).length : -1;
	return ordre && ordre.length === n && [...ordre].sort((x, y) => x - y).every((v, i) => v === i) ? ordre : undefined;
}

/** Answer fields: the change of right answer says them, not a raw row of indices. */
const ANSWER_INDEX_KEYS = ["correctIndex", "correctIndices", "correctIndexes", "correctOrder", "correctMap"];

/**
 * Judges the raw JSON the model proposed for `original` (the question as
 * parsed from the note). `ordre` is the order the player shows its options in
 * (position → index), for the letters of the preview; the note's order when
 * absent or no longer fitting.
 */
export function validateQuestionEdit(original: Q, raw: string, sanitizeHtml: (html: string) => string, ordre?: number[]): QuestionEditResult {
	if (!original || questionKind(original) === null) return { ok: false, reason: "notQuestion" };
	let parsed: unknown;
	try { parsed = JSON.parse(raw); } catch { return { ok: false, reason: "json" }; }
	if (!parsed || typeof parsed !== "object" || isArr(parsed)) return { ok: false, reason: "json" };
	const verdict = checkQuestionFields(original, parsed as Q, sanitizeHtml);
	if (!verdict.ok) return verdict;
	const kind = questionKind(original) as QuestionKind;
	const after: Q = { ...original, ...verdict.fields };
	/* The same letters on both sides: the screen's order while the options
	   keep their number, the note's otherwise. */
	const o = orderFor(original, ordre) && orderFor(after, ordre) ? ordre : undefined;
	const rows: QuestionEditRow[] = Object.keys(verdict.fields)
		.filter(k => !ANSWER_INDEX_KEYS.includes(k))
		.map(k => ({ field: k, before: shown(k, original[k], o), after: shown(k, after[k], o) }));
	const answerChange = answerChanged(kind, original, after)
		? { from: reponseAttendue(original, o), to: reponseAttendue(after, o) }
		: null;
	return { ok: true, fields: verdict.fields, rows, answerChange, reordered: itemsMoved(original, verdict.fields) };
}

/** The lists whose INDICES a learner's answer is stored by (session.ts:
    options by their original index, items, rows, choices). */
const INDEXED_LISTS = ["options", "optionHtml", "possibilities", "rows", "choices"];

/** Does a list an answer points into change its order or its length? Then
    the stored answer points at other texts: it must be dropped, not judged.
    A reworded item in place does not count. */
export function itemsMoved(original: Q, fields: Q): boolean {
	return INDEXED_LISTS.some(k => {
		if (!isArr(fields[k]) || !isArr(original[k])) return false;
		const a = (original[k] as unknown[]).map(x => norm(k.endsWith("Html") ? htmlEnTexte(x) : x));
		const b = (fields[k] as unknown[]).map(x => norm(k.endsWith("Html") ? htmlEnTexte(x) : x));
		return a.length !== b.length || b.some((x, i) => x !== a[i] && a.includes(x));
	});
}

/**
 * The instruction that lets the model IMPROVE the question on screen, with the
 * question's current editable fields. The model explains as usual; only when
 * the learner asks for a change, or when it finds a real error, does it say so
 * with its reason and add one `<card-edit>` block, which the app turns into a
 * before/after proposal with an "Apply" button (judged by `validateQuestionEdit`).
 */
export function consigneEditionQuestion(q: Q): string {
	const allowed = questionEditFields(q);
	const current: Q = {};
	for (const k of allowed) if (q[k] !== undefined) current[k] = q[k];
	const kind = questionKind(q);
	const rules: string[] = [];
	if (kind === "single") rules.push("\"correctIndex\" is the index (from 0) of the ONE right option in \"options\".");
	if (kind === "multiple") rules.push(`"${indicesKey(q)}" lists the indices (from 0) of every right option in "options", at least one.`);
	if (kind === "single" || kind === "multiple") rules.push("Options are distinct, 2 to 10. When you change \"options\", send the whole list, and send the right answer again if an option moved.");
	if ((kind === "single" || kind === "multiple") && isArr(q.optionHtml)) rules.push("This question shows \"optionHtml\" (one HTML per option): whenever you change \"options\" or the right answer, also send the whole \"optionHtml\", same length and same order as \"options\".");
	if (kind === "text") rules.push("\"answer\" is the expected answer; \"acceptedAnswers\" may list other accepted forms.");
	if (kind === "cloze") rules.push("\"cloze\" is the whole text with each blank as {{answer|variant}}; keep the same number of blanks.");
	if (kind === "ordering") rules.push("\"correctOrder\" lists every index of \"possibilities\" once, in the right order.");
	if (kind === "matching") rules.push("\"correctMap\" gives, for each row, the index of its choice; one entry per row.");
	return [
		"IMPROVING THE QUESTION ON SCREEN: you are the learner's assistant on this quiz. You explain, and you MAY also propose an improved version of THIS question, only when the learner asks for it (rephrase the statement, fix an option, fix the right answer, improve the explanation or the hint) or when you find a REAL error in it (a wrong expected answer, an ambiguous or wrong option, a misleading statement).",
		"Then SAY so in your answer, with the reason written out (never a change without a written reason), and put the changed fields ONCE in a block:",
		"<card-edit>{ ...JSON... }</card-edit>",
		`The JSON holds ONLY the fields you change, among: ${allowed.join(", ")}; each with the same shape as in the current question below. Indices count from 0 in the order of the JSON below, NOT the letters on screen (the options may be shuffled there). Never the id, the type, the role, another question, nor a change of the kind of question.`,
		...rules,
		"Keep every piece of information, the same language and the same writing conventions (Markdown, LaTeX between $, fenced code). A field under its own limit: the statement and the explanation under 4000 characters, an option under 600.",
		"The learner sees a before/after preview with an Apply button: nothing is written before they click. Do not write the block when they only ask a question and nothing is wrong.",
		"Current fields of the question (JSON): " + JSON.stringify(current),
	].join("\n") + "\n";
}
