/* ══════════════════════════════════════════════════════════
   LIVE EDIT OF A READING CARD FROM THE "EXPLAIN" CHAT (2026-10-09)

   The model answers as usual and, when the learner asks for it ("rewrite it
   more simply"), puts the NEW version of the card in a tagged block:
   `<card-edit>{ ...JSON of the text fields... }</card-edit>`. This module
   reads that block and decides whether the app may even PROPOSE it. Nothing
   is written here (the write is `detail-io.ts` `saveCardEdit`, after a click).

   Guards, all before the proposal is shown:
   - strictly valid JSON, an object;
   - only the text fields of a reading card (`CARD_EDIT_FIELDS`): never an
     `id`, an option, a `cite`, a `figure`, nor any other question's key;
   - `prompt` or `promptHtml`, whichever the card already uses, never both;
   - every HTML field goes through the sanitizer handed in (the app passes
     `sanitizeQuizHtml`, the first of the four gates of engine/sanitizer.ts);
   - the whole card stays under `READING_MAX_CHARS` + 25 %;
   - the card does not lose more than 30 % of its length.

   PURE: no DOM, no host. `npm run check:explain` holds it.
══════════════════════════════════════════════════════════ */

import { htmlEnTexte } from "./explain-prompt";
import { READING_MAX_CHARS, retenirDeLecture } from "./lecture-style";

export const CARD_EDIT_FIELDS = ["title", "prompt", "promptHtml", "etapes", "retenir"] as const;

/** A proposal may grow the card by this much beyond the reading limit. */
export const CARD_EDIT_GROWTH = 1.25;
/** A proposal may not shorten the card by more than this. */
export const CARD_EDIT_MAX_LOSS = 0.3;
/** At most this many steps. */
const MAX_STEPS = 12;

export type CardFields = Record<string, unknown>;

export type CardEditRefusal = "notReading" | "json" | "empty" | "field" | "type" | "tooLong" | "lossy";

export type CardEditResult =
	| { ok: true; fields: CardFields; before: number; after: number }
	| { ok: false; reason: CardEditRefusal };

const BLOCK = /<card-edit>([\s\S]*?)<\/card-edit>/g;

/** The answer without its `<card-edit>` blocks (an unfinished one, still being
    written, included), and the raw text of the LAST complete block. */
export function splitCardEdit(text: string): { shown: string; raw: string | null; pending: boolean } {
	let raw: string | null = null;
	let shown = text.replace(BLOCK, (_m, inner: string) => { raw = inner; return ""; });
	const open = shown.indexOf("<card-edit>");
	const pending = open >= 0;
	if (pending) shown = shown.slice(0, open);
	// A fence the model wrapped around the JSON.
	if (raw !== null) raw = (raw as string).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
	return { shown: shown.trim(), raw, pending };
}

/** The editable fields of a card, nothing else. */
export function cardFieldsOf(card: Record<string, unknown>): CardFields {
	const out: CardFields = {};
	for (const k of CARD_EDIT_FIELDS) if (card[k] !== undefined) out[k] = card[k];
	return out;
}

/** The text of a reading card, in characters: title, text (HTML as text),
    steps and key points. The measure of both limits. */
export function cardTextLength(card: Record<string, unknown>): number {
	const s = (v: unknown): number => (typeof v === "string" ? v.trim().length : 0);
	const html = typeof card.promptHtml === "string" ? htmlEnTexte(card.promptHtml).length : 0;
	let n = s(card.title) + s(card.prompt) + html;
	if (Array.isArray(card.etapes)) for (const e of card.etapes) n += s(e);
	const r = retenirDeLecture(card);
	if (r?.forme === "cartes") for (const c of r.items) n += c.recto.length + c.verso.length;
	else if (r?.forme === "recap") for (const i of r.items) n += i.length;
	return n;
}

/** The longest a card may become through the chat. */
export const CARD_EDIT_MAX_CHARS = Math.round(READING_MAX_CHARS * CARD_EDIT_GROWTH);

/**
 * Judges the raw JSON the model proposed for `original` (the card as parsed
 * from the note). `sanitizeHtml` is the gate every HTML field passes through.
 */
export function validateCardEdit(original: Record<string, unknown>, raw: string, sanitizeHtml: (html: string) => string): CardEditResult {
	const no = (reason: CardEditRefusal): CardEditResult => ({ ok: false, reason });
	if (original.role !== "read") return no("notReading");
	let parsed: unknown;
	try { parsed = JSON.parse(raw); } catch { return no("json"); }
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return no("json");
	const given = parsed as Record<string, unknown>;
	const keys = Object.keys(given);
	if (keys.length === 0) return no("empty");
	if ((keys as string[]).some(k => !(CARD_EDIT_FIELDS as readonly string[]).includes(k))) return no("field");

	const usesHtml = typeof original.promptHtml === "string";
	if (("prompt" in given && usesHtml) || ("promptHtml" in given && !usesHtml)) return no("field");

	const fields: CardFields = {};
	if ("title" in given) {
		if (typeof given.title !== "string" || !given.title.trim()) return no("type");
		fields.title = given.title.trim();
	}
	if ("prompt" in given) {
		if (typeof given.prompt !== "string" || !given.prompt.trim()) return no("type");
		fields.prompt = given.prompt;
	}
	if ("promptHtml" in given) {
		if (typeof given.promptHtml !== "string") return no("type");
		const clean = sanitizeHtml(given.promptHtml);
		if (!htmlEnTexte(clean)) return no("type");
		fields.promptHtml = clean;
	}
	if ("etapes" in given) {
		const e = given.etapes;
		if (!Array.isArray(e) || e.length === 0 || e.length > MAX_STEPS || !e.every(x => typeof x === "string" && x.trim())) return no("type");
		fields.etapes = e;
	}
	if ("retenir" in given) {
		if (!retenirDeLecture({ retenir: given.retenir })) return no("type");
		fields.retenir = given.retenir;
	}

	const before = cardTextLength(original);
	const after = cardTextLength({ ...cardFieldsOf(original), ...fields });
	if (after > CARD_EDIT_MAX_CHARS) return no("tooLong");
	if (after < before * (1 - CARD_EDIT_MAX_LOSS)) return no("lossy");
	return { ok: true, fields, before, after };
}

/**
 * The instruction that lets the model REWRITE the reading card on screen,
 * with the card's current text fields. The model answers as usual; only when
 * the learner asks for a new version does it add one `<card-edit>` block,
 * which the app turns into an "Apply" proposal (`explain-edit.ts` judges it).
 */
export function consigneEditionCarte(card: Record<string, unknown>): string {
	const usesHtml = typeof card.promptHtml === "string";
	const texte = usesHtml ? "promptHtml (HTML, same tags as now)" : "prompt (Markdown)";
	return [
		"EDITING THE READING CARD ON SCREEN: if, and only if, the learner asks you to change this card (simplify it, rewrite it, add an example...), answer as usual, briefly, AND put the complete NEW version of the card ONCE in a block:",
		"<card-edit>{ ...JSON... }</card-edit>",
		`The JSON holds ONLY these text fields, each as in the current card below: ${CARD_EDIT_FIELDS.filter(f => f !== (usesHtml ? "prompt" : "promptHtml")).join(", ")} (the text goes in ${texte}). Leave out a field you do not change. No other key, never the id, the source, the figure or another question.`,
		"Keep EVERY piece of information of the current card (you may add some, never remove one), the same language, and the same writing conventions (Markdown, LaTeX between $, fenced code).",
		`The whole card must stay under ${READING_MAX_CHARS} characters (title, text, steps and key points together; ${CARD_EDIT_MAX_CHARS} at the very most) and must not become much shorter.`,
		"The learner sees a preview with an Apply button: nothing is written before they click. Do not write the block when they only ask a question.",
		"Current text fields of the card (JSON): " + JSON.stringify(cardFieldsOf(card)),
	].join("\n") + "\n";
}
