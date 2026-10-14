/**
 * INLINE CODE IN COLOUR, WHATEVER ITS LANGUAGE (2026-10-14). A `code` span
 * written between single backticks names no language: it was shown as plain
 * grey text, and `res = []` or `films[1]["titre"]` read as words. This
 * tokenizer is generic on purpose (the same grammar as the one the
 * interactive pages run, html-frame-code.ts): comments, strings, numbers,
 * keywords shared by Python, C, Java, JavaScript and SQL, a name before "("
 * as a function. Its tokens use refractor's class names, so the colours are
 * those of the app's coloured inline code (quiz-card.css,
 * `code.quiz-md-code-inline`).
 *
 * PURE: it takes the RAW text and an escaper, and only ever writes our own
 * `<span class="token …">` around escaped text.
 */

const KEYWORDS = new Set(("def return for in if elif else while import from as class try except finally with lambda yield "
	+ "True False None and or not is pass break continue raise global nonlocal assert del async await "
	+ "function const let var new this typeof instanceof null undefined true false "
	+ "int float double char void long short unsigned signed struct enum public private protected static final "
	+ "include define printf scanf malloc free sizeof switch case default do goto "
	+ "SELECT FROM WHERE INSERT INTO UPDATE DELETE JOIN ON GROUP BY ORDER AND OR NOT NULL").split(" "));

const TOKEN = /(#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)(\s*\()?/g;

export function colorerGenerique(raw: string, escape: (s: string) => string): string {
	const span = (cls: string, text: string): string => `<span class="token ${cls}">${escape(text)}</span>`;
	let out = "";
	let last = 0;
	TOKEN.lastIndex = 0;
	for (let m = TOKEN.exec(raw); m; m = TOKEN.exec(raw)) {
		out += escape(raw.slice(last, m.index));
		if (m[1]) out += span("comment", m[1]);
		else if (m[2]) out += span("string", m[2]);
		else if (m[3]) out += span("number", m[3]);
		else if (m[4]) {
			out += KEYWORDS.has(m[4]) ? span("keyword", m[4]) : m[5] ? span("function", m[4]) : escape(m[4]);
			if (m[5]) out += escape(m[5]);
		}
		last = TOKEN.lastIndex;
	}
	return out + escape(raw.slice(last));
}
