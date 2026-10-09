import { findQuizModeConfigIndex, parseQuizSource } from "../quiz-utils";
import { apply, canon, insertAfterEntry, members, topArray } from "./exam-keep";
import type { Edit } from "./exam-keep";

/* ══════════════════════════════════════════════════════════
   REWRITING ONE READING CARD IN A QUIZ BLOCK — PURE text edit.

   Same method as "Keep exam mode" (`exam-keep.ts`, whose scanner it reuses):
   the editor's save (`saveQuizDraft`) re-exports the whole block and drops
   its comments and layout, which is too much for a card the learner only
   asked the chat to rewrite. Here only the VALUE of each given key of that one
   card is replaced (a key the card lacks is added after its last entry);
   every other byte of the block stays where it was.

   Guards: the card at `qi` must still be the one the caller saw (`expected`)
   and a reading; the edited source is PARSED again and must equal the old
   items with only that card changed. Any doubt gives `null`, nothing written.
══════════════════════════════════════════════════════════ */

/** A string literal in the quote style of the note. */
function literal(value: string, quote: string): string {
	const json = JSON.stringify(value);
	if (quote !== "'") return json;
	return "'" + json.slice(1, -1).replace(/\\"/g, "\"").replace(/'/g, "\\'") + "'";
}

function serialize(value: unknown, quote: string): string {
	return typeof value === "string" ? literal(value, quote) : JSON.stringify(value);
}

/**
 * `source` (the text between the fences) with the keys of `fields` set on the
 * reading card number `qi` (its index among the QUESTIONS, the configuration
 * object not counted, as the player indexes them). `expected` is that card as
 * the caller read it. Returns `null` when the edit cannot be made safely.
 */
export function applyCardEdit(source: string, qi: number, expected: Record<string, unknown>, fields: Record<string, unknown>): string | null {
	try {
		const eol = source.includes("\r\n") ? "\r\n" : "\n";
		const old = parseQuizSource(source, { logErrors: false }) as unknown as Record<string, unknown>[];
		const config = findQuizModeConfigIndex(old);
		const at = qi + (config >= 0 && config <= qi ? 1 : 0);
		const card = old[at];
		if (!card || card.role !== "read" || canon(card) !== canon(expected)) return null;
		const keys = Object.keys(fields);
		if (keys.length === 0) return null;

		const arr = topArray(source);
		if (arr.items.length !== old.length) return null;
		const item = arr.items[at];
		const obj = members(source, item.start, true);
		const titleAt = obj.items.findIndex(e => e.key === "title");
		const quoteOfTitle = titleAt >= 0 && source[obj.items[titleAt].valueStart as number] === "'" ? "'" : "\"";

		const edits: Edit[] = [];
		const added: string[] = [];
		for (const key of keys) {
			const i = obj.items.findIndex(e => e.key === key);
			if (i >= 0) {
				const ent = obj.items[i];
				const q = source[ent.valueStart as number] === "'" ? "'" : "\"";
				edits.push({ start: ent.valueStart as number, end: ent.end, text: serialize(fields[key], q) });
			} else {
				added.push(`${key}: ${serialize(fields[key], quoteOfTitle)}`);
			}
		}
		if (added.length > 0) edits.push(insertAfterEntry(source, obj.items, obj.items.length - 1, added, eol));

		const next = apply(source, edits);
		const now = parseQuizSource(next, { logErrors: false }) as unknown as unknown[];
		const want = old.map((x, i) => (i === at ? { ...x, ...fields } : x));
		if (canon(now) !== canon(want)) return null;
		return next;
	} catch {
		return null;
	}
}
