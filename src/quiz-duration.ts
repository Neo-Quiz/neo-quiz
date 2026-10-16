/* The estimated time to do a quiz. Pure: no DOM, no host, no clock. An
   ESTIMATE shown as plain text ("≈ 35 min"), so the learner knows roughly how
   long a Learn takes before starting it.

   Formula (owner-approved 2026-10-15):
   - a reading card (`role: "read"`): its words (title, text, steps, table,
     key points) at 150 words per minute, plus 1 min when it carries an
     interactive page (`html`), plus 30 s when it carries a figure (`passage`);
   - a flashcard: 15 s; any other item (choice, ordering, matching, text): 45 s;
   - the total is rounded to the nearest 5 min, 5 min at least. */
import { estCarte } from "./quiz-format";
import { etapesDeLecture, retenirDeLecture, tableauDeLecture } from "./lecture-style";

export const READING_WORDS_PER_MINUTE = 150;
export const QUESTION_SECONDS = 45;
export const FLASHCARD_SECONDS = 15;
export const INTERACTIVE_PAGE_SECONDS = 60;
export const FIGURE_SECONDS = 30;
export const MIN_MINUTES = 5;
export const ROUND_TO_MINUTES = 5;

/** Words of a Markdown text: code fences count as words, markers alone
    (`-`, `##`, `|`, `>`, `---`) do not. */
function words(text: unknown): number {
	if (typeof text !== "string") return 0;
	return text.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}

function nonEmpty(v: unknown): boolean {
	return typeof v === "string" && v.trim() !== "";
}

/** A raw field, also looked up in `_extraFields` (the parser's bag of keys it does not model). */
function field(item: Record<string, unknown>, key: string): unknown {
	if (item[key] !== undefined) return item[key];
	const extra = item._extraFields;
	return extra && typeof extra === "object" ? (extra as Record<string, unknown>)[key] : undefined;
}

/** The seconds one raw item of the quiz array takes. */
export function itemSeconds(item: unknown): number {
	if (!item || typeof item !== "object" || Array.isArray(item)) return 0;
	const q = item as Record<string, unknown>;
	if (q.role !== "read") return estCarte(q) ? FLASHCARD_SECONDS : QUESTION_SECONDS;
	let n = words(q.title) + words(field(q, "prompt")) + words(etapesDeLecture(q).join(" "));
	const tab = tableauDeLecture(q);
	if (tab) n += words([...tab.colonnes, ...tab.lignes.flat()].join(" "));
	const r = retenirDeLecture(q);
	if (r?.forme === "cartes") n += words(r.items.map(c => `${c.recto} ${c.verso}`).join(" "));
	else if (r?.forme === "recap") n += words(r.items.join(" "));
	let s = (n / READING_WORDS_PER_MINUTE) * 60;
	if (nonEmpty(field(q, "html"))) s += INTERACTIVE_PAGE_SECONDS;
	if (nonEmpty(q.passage)) s += FIGURE_SECONDS;
	return s;
}

/** Estimated minutes for the raw items of a quiz block (configuration objects
    already removed): nearest 5 min, at least 5. */
export function estimateQuizMinutes(items: readonly unknown[]): number {
	const seconds = items.reduce<number>((sum, it) => sum + itemSeconds(it), 0);
	return Math.max(MIN_MINUTES, Math.round(seconds / 60 / ROUND_TO_MINUTES) * ROUND_TO_MINUTES);
}
