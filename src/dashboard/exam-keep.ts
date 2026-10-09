import { findQuizModeConfigIndex, normalizeQuizMode, parseQuizSource } from "../quiz-utils";

/* ══════════════════════════════════════════════════════════
   "KEEP EXAM MODE" — PURE text edit of a quiz block's source.

   Spec docs/superpowers/specs/2026-09-29-test-setup-modal-design.md §2:
   checking the box writes `mode: "exam"` and `examDurationMinutes` into the
   quiz's configuration object; unchecking removes them. This runs when a test
   is STARTED, on a note the user did not ask to edit, so it must touch as
   little as possible: unlike the editor's save (`saveQuizDraft`, which
   re-exports the whole block and so drops its comments and formatting), it
   edits the SOURCE TEXT of the two keys only. Every other byte of the block
   stays where it was.

   Two guards keep that promise honest:
   - the text is scanned with a small JSON5 scanner that knows strings and
     comments (a `,` or a `}` inside either never ends a value);
   - the edited source is PARSED again and compared with what the change is
     supposed to produce (`expectedItems`): the old items with only the
     configuration object changed, and the configuration object still
     recognised as one (a config left without a mode marker would turn into a
     phantom question). Any doubt gives `null` and the note is not written.
══════════════════════════════════════════════════════════ */

/** `null` = no longer kept as an Exam; otherwise the duration to keep. */
export type KeepExam = { minutes: number } | null;

/** One member of a list (an array element or an object entry) in the text. */
export interface Item {
	/** First character of the member (for an entry, its key). */
	start: number;
	/** One past its last character (for an entry, its value). */
	end: number;
	/** Index of the comma that follows it, or -1. */
	comma: number;
	/** Entries only: the key and where its value begins. */
	key?: string;
	valueStart?: number;
}

export interface Edit { start: number; end: number; text: string }

const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r";

/** Skips whitespace and comments. */
function skipTrivia(s: string, i: number): number {
	for (;;) {
		while (i < s.length && isSpace(s[i])) i++;
		if (s[i] === "/" && s[i + 1] === "/") {
			while (i < s.length && s[i] !== "\n") i++;
		} else if (s[i] === "/" && s[i + 1] === "*") {
			const e = s.indexOf("*/", i + 2);
			if (e < 0) throw new Error("unterminated comment");
			i = e + 2;
		} else {
			return i;
		}
	}
}

function skipString(s: string, i: number): number {
	const quote = s[i];
	i++;
	while (i < s.length) {
		if (s[i] === "\\") i += 2;
		else if (s[i] === quote) return i + 1;
		else i++;
	}
	throw new Error("unterminated string");
}

/** The end of the value that starts at `i`. */
function skipValue(s: string, i: number): number {
	const c = s[i];
	if (c === "'" || c === '"') return skipString(s, i);
	if (c === "{" || c === "[") {
		let depth = 0;
		while (i < s.length) {
			const d = s[i];
			if (d === "'" || d === '"') { i = skipString(s, i); continue; }
			if (d === "/" && (s[i + 1] === "/" || s[i + 1] === "*")) { i = skipTrivia(s, i); continue; }
			if (d === "{" || d === "[") depth++;
			else if (d === "}" || d === "]") { depth--; if (depth === 0) return i + 1; }
			i++;
		}
		throw new Error("unterminated value");
	}
	// A number, `true`, `null`, an identifier: up to a separator.
	while (i < s.length && !isSpace(s[i]) && s[i] !== "," && s[i] !== "}" && s[i] !== "]"
		&& !(s[i] === "/" && (s[i + 1] === "/" || s[i + 1] === "*"))) i++;
	return i;
}

/** The members of the array or object opened at `open`, and the index of its
    closing bracket. `entries`: an object, whose members have keys. */
export function members(s: string, open: number, entries: boolean): { items: Item[]; close: number } {
	const closer = entries ? "}" : "]";
	const items: Item[] = [];
	let i = open + 1;
	for (;;) {
		i = skipTrivia(s, i);
		if (i >= s.length) throw new Error("unterminated list");
		if (s[i] === closer) return { items, close: i };
		const start = i;
		let key: string | undefined;
		let valueStart = start;
		if (entries) {
			let k = i;
			if (s[k] === "'" || s[k] === '"') { k = skipString(s, k); key = s.slice(i + 1, k - 1); }
			else { while (k < s.length && /[A-Za-z0-9_$]/.test(s[k])) k++; key = s.slice(i, k); }
			if (key === "") throw new Error("entry without key");
			k = skipTrivia(s, k);
			if (s[k] !== ":") throw new Error("entry without colon");
			valueStart = skipTrivia(s, k + 1);
			i = valueStart;
		}
		const end = skipValue(s, i);
		const j = skipTrivia(s, end);
		const comma = s[j] === "," ? j : -1;
		if (comma < 0 && s[j] !== closer) throw new Error("missing separator");
		items.push({ start, end, comma, key, valueStart });
		i = comma >= 0 ? comma + 1 : j;
	}
}

/** The top-level array of a block's source. */
export function topArray(s: string): { open: number; close: number; items: Item[] } {
	const open = skipTrivia(s, 0);
	if (s[open] !== "[") throw new Error("not an array");
	const { items, close } = members(s, open, false);
	if (skipTrivia(s, close + 1) !== s.length) throw new Error("text after the array");
	return { open, close, items };
}

/** The start of the line that ends just before `at` (`at` is a line start). */
function previousLineStart(s: string, at: number): number {
	let p = at - 1; // the "\n" that ends the previous line
	if (p > 0 && s[p - 1] === "\r") p--;
	while (p > 0 && s[p - 1] !== "\n") p--;
	return p;
}

/** The range to delete to remove member `k`, the line it sits alone on
    included, and its comma. The last member has no comma of its own: the
    previous member's comma goes with it, so no `,` is left dangling.
    `element`: an array element, the configuration object; its `//` comment
    lines directly above go with it (`// Exam`, as the exporter writes), and
    so does the blank line before it when it was the last element. */
function removalRange(s: string, items: Item[], k: number, element: boolean): [number, number] {
	const it = items[k];
	if (it.comma < 0 && k > 0) return [items[k - 1].comma, it.end];
	const b = it.comma >= 0 ? it.comma + 1 : it.end;
	let ls = it.start;
	while (ls > 0 && (s[ls - 1] === " " || s[ls - 1] === "\t")) ls--;
	let te = b;
	while (te < s.length && (s[te] === " " || s[te] === "\t")) te++;
	const alone = (ls === 0 || s[ls - 1] === "\n") && (te >= s.length || s[te] === "\n" || s[te] === "\r");
	if (alone) {
		if (s[te] === "\r") te++;
		if (s[te] === "\n") te++;
		if (element) {
			while (ls > 0 && /^[ \t]*\/\//.test(s.slice(previousLineStart(s, ls), ls))) ls = previousLineStart(s, ls);
			if (k === items.length - 1 && ls > 0 && /^\s*$/.test(s.slice(previousLineStart(s, ls), ls))) ls = previousLineStart(s, ls);
		}
		return [ls, te];
	}
	return [it.start, te];
}

/** The whitespace before a member on its own line, or `null` when something
    else precedes it on that line (an inline list). */
function lineIndent(s: string, at: number): string | null {
	let ls = at;
	while (ls > 0 && s[ls - 1] !== "\n") ls--;
	const before = s.slice(ls, at);
	return /^[ \t]*$/.test(before) ? before : null;
}

/** Where to insert after `it`'s comma: the end of its line when only a
    `//` comment follows (the comment stays with the member it belongs to),
    else right after the comma. */
function afterCommaPosition(s: string, it: Item): number {
	const p = it.comma + 1;
	let e = p;
	while (e < s.length && s[e] !== "\n" && s[e] !== "\r") e++;
	return /^\s*(\/\/.*)?$/.test(s.slice(p, e)) ? e : p;
}

export const quoteOf = (s: string, at: number): string => (s[at] === '"' ? '"' : "'");

/** Inserts the entries `texts` ("key: value") right after entry `k`. */
export function insertAfterEntry(s: string, items: Item[], k: number, texts: string[], eol: string): Edit {
	const it = items[k];
	const indent = lineIndent(s, it.start);
	if (it.comma >= 0) {
		const at = indent !== null ? afterCommaPosition(s, it) : it.comma + 1;
		const text = texts.map(x => (indent !== null ? eol + indent : " ") + x + ",").join("");
		return { start: at, end: at, text };
	}
	const text = "," + texts.map((x, n) => (indent !== null ? eol + indent : " ") + x + (n < texts.length - 1 ? "," : "")).join("");
	return { start: it.end, end: it.end, text };
}

/** Inserts the entries `texts` before the first entry of the object opened
    at `open` (it has at least one entry). */
function insertFirstEntries(s: string, open: number, items: Item[], texts: string[], eol: string): Edit {
	const first = items[0];
	const multiline = s.slice(open + 1, first.start).includes("\n");
	const indent = multiline ? (lineIndent(s, first.start) ?? "") : "";
	const text = texts.map(x => (multiline ? eol + indent : " ") + x + ",").join("");
	return { start: open + 1, end: open + 1, text };
}

/** The new configuration object, appended to the array after its last
    element, in the exporter's layout when the array is laid out on lines. */
function appendConfig(s: string, items: Item[], minutes: number, eol: string): Edit {
	const last = items[items.length - 1];
	const indent = lineIndent(s, last.start);
	const inner = (indent ?? "") + "\t";
	const element = indent !== null
		? `// Exam${eol}${indent}{${eol}${inner}mode: 'exam',${eol}${inner}examDurationMinutes: ${minutes},${eol}${indent}}`
		: `{ mode: 'exam', examDurationMinutes: ${minutes} }`;
	const lead = indent !== null ? eol + eol + indent : " ";
	if (last.comma >= 0) {
		const at = indent !== null ? afterCommaPosition(s, last) : last.comma + 1;
		return { start: at, end: at, text: lead + element + "," };
	}
	return { start: last.end, end: last.end, text: "," + lead + element };
}

export function apply(s: string, edits: Edit[]): string {
	/* Two deletions can overlap (the last entry takes the previous entry's comma
	   with it, and that entry may itself be deleted): they merge into one, or
	   the second cut would eat a character the first already removed. */
	const merged: Edit[] = [];
	for (const e of [...edits].sort((a, b) => a.start - b.start || a.end - b.end)) {
		const prev = merged[merged.length - 1];
		if (prev && prev.text === "" && e.text === "" && e.start < prev.end) prev.end = Math.max(prev.end, e.end);
		else merged.push({ ...e });
	}
	let out = s;
	for (const e of merged.reverse()) {
		out = out.slice(0, e.start) + e.text + out.slice(e.end);
	}
	return out;
}

/** A parsed value with its object keys sorted, for comparing two parses. */
export function canon(v: unknown): string {
	return JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x)
		? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
		: x));
}

/** What the configuration object becomes: `undefined` = it goes away. */
function nextConfig(config: Record<string, unknown> | null, keep: KeepExam): Record<string, unknown> | null | undefined {
	if (keep) return { ...(config ?? {}), mode: "exam", examDurationMinutes: keep.minutes };
	if (!config) return config;
	const { mode: _mode, examDurationMinutes: _minutes, ...rest } = config;
	if (Object.keys(rest).length === 0) return undefined;
	// Still recognised without its mode (a glossary, a source)? Then both keys
	// go. Otherwise the object would read as a question: it keeps an explicit
	// Practice, as the editor's mode change does.
	return findQuizModeConfigIndex([rest]) === 0 ? rest : { ...rest, mode: "quiz" };
}

/**
 * `source` (the text between the fences of a `quiz-blocks` block) with
 * "Keep exam mode" applied: `mode: 'exam'` and `examDurationMinutes` written
 * (`keep`) or taken out (`null`) — nothing else changes. Returns `source`
 * itself when it already says so, and `null` when the change cannot be made
 * safely: not a readable array, a Learn (its configuration is not a Test's),
 * an empty block, or an edit that does not re-read as expected.
 */
export function applyKeepExam(source: string, keep: KeepExam): string | null {
	try {
		const eol = source.includes("\r\n") ? "\r\n" : "\n";
		const old = parseQuizSource(source, { logErrors: false }) as unknown as Record<string, unknown>[];
		if (old.length === 0) return null;
		const at = findQuizModeConfigIndex(old);
		const config = at >= 0 ? old[at] : null;
		if (config && normalizeQuizMode(config.mode) === "lesson") return null;

		const target = nextConfig(config, keep);
		if (target === config || (config && target && canon(target) === canon(config))) return source;

		const arr = topArray(source);
		if (arr.items.length !== old.length) return null;
		const edits: Edit[] = [];
		let expected: unknown[];

		if (!config) {
			edits.push(appendConfig(source, arr.items, (keep as { minutes: number }).minutes, eol));
			expected = [...old, target];
		} else if (target === undefined) {
			const [a, b] = removalRange(source, arr.items, at, true);
			edits.push({ start: a, end: b, text: "" });
			expected = old.filter((_, i) => i !== at);
		} else {
			const tgt = target as Record<string, unknown>;
			const item = arr.items[at];
			const obj = members(source, item.start, true);
			const byKey = (k: string): number => obj.items.findIndex(e => e.key === k);
			const iMode = byKey("mode");
			const iDuration = byKey("examDurationMinutes");
			const wantMode = typeof tgt.mode === "string" ? tgt.mode : null;
			const wantMinutes = typeof tgt.examDurationMinutes === "number" ? tgt.examDurationMinutes : null;

			const setValue = (i: number, text: string): void => {
				edits.push({ start: obj.items[i].valueStart as number, end: obj.items[i].end, text });
			};
			const modeText = (): string => {
				const q = iMode >= 0 ? quoteOf(source, obj.items[iMode].valueStart as number) : "'";
				return q + (wantMode as string) + q;
			};
			const drop = (i: number): void => {
				const [a, b] = removalRange(source, obj.items, i, false);
				edits.push({ start: a, end: b, text: "" });
			};

			const missing: string[] = [];
			if (wantMode !== null) {
				if (iMode >= 0) setValue(iMode, modeText());
				else missing.push(`mode: ${modeText()}`);
			} else if (iMode >= 0) drop(iMode);
			if (wantMinutes !== null) {
				if (iDuration >= 0) setValue(iDuration, String(wantMinutes));
				else missing.push(`examDurationMinutes: ${wantMinutes}`);
			} else if (iDuration >= 0) drop(iDuration);

			if (missing.length > 0) {
				// The duration goes right after an existing `mode`; anything else
				// (no mode yet) goes first in the object.
				if (iMode >= 0 && missing.length === 1) edits.push(insertAfterEntry(source, obj.items, iMode, missing, eol));
				else edits.push(insertFirstEntries(source, item.start, obj.items, missing, eol));
			}
			expected = old.map((x, i) => (i === at ? target : x));
		}

		const next = apply(source, edits);
		const now = parseQuizSource(next, { logErrors: false }) as unknown as unknown[];
		const idx = findQuizModeConfigIndex(now);
		const wantIdx = target === undefined ? -1 : (config ? at : now.length - 1);
		if (canon(now) !== canon(expected) || idx !== wantIdx) return null;
		return next;
	} catch {
		return null;
	}
}
