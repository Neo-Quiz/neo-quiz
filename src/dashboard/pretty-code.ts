/**
 * DISPLAY-ONLY re-indentation of compact HTML, JavaScript and CSS, for the
 * AI work view (`work-view.ts`). The model keeps writing compact code, which
 * costs it nothing; the window only shows it spread over lines.
 *
 * Pure: no DOM, no host, no Node. Invariant for every function here: the
 * output's NON-WHITESPACE characters, in order, are exactly the input's. Only
 * whitespace moves. Anything that throws, or an input over MAX_CHARS, returns
 * the input unchanged, so a bad page is shown as it was written.
 */

const TAB = "\t";
const MAX_CHARS = 200_000;

/** Elements that start on their own line; the rest (span, a, b, button…) stay inline. */
const BLOCK = new Set([
	"html", "head", "body", "div", "section", "main", "header", "footer", "nav", "ul", "ol", "li",
	"table", "thead", "tbody", "tr", "td", "th", "p", "h1", "h2", "h3", "h4", "h5", "h6", "form",
	"svg", "g", "defs", "script", "style", "meta", "link", "title",
]);

/** Void elements: a tag with no closing tag, never opens a level. */
const VOID = new Set(["meta", "link", "base", "col", "embed", "source", "track", "param", "area", "wbr"]);

/** Raw-text elements: their body is code, formatted by its own printer. */
const RAW_TEXT = new Set(["script", "style"]);

/** Index just past the `>` closing the tag that opens at `start`, or -1. A `>`
    inside a quoted attribute value does not close it. */
function tagEnd(src: string, start: number): number {
	let quote = "";
	for (let j = start + 1; j < src.length; j++) {
		const ch = src[j];
		if (quote) {
			if (ch === quote) quote = "";
		} else if (ch === '"' || ch === "'") {
			quote = ch;
		} else if (ch === ">") {
			return j + 1;
		}
	}
	return -1;
}

/** Whether a `<` at `i` starts a tag, a closing tag, a comment or a declaration. */
function startsMarkup(src: string, i: number): boolean {
	return src[i] === "<" && /[A-Za-z/!?]/.test(src[i + 1] ?? "");
}

/** Lines of the page, built token by token. Inline content waits in `cur` until
    the next block boundary; whitespace inside it is collapsed to one space. */
export function prettyHtml(src: string): string {
	if (src.length > MAX_CHARS) return src;
	try {
		return htmlPretty(src);
	} catch {
		return src;
	}
}

function htmlPretty(src: string): string {
	const lines: string[] = [];
	const n = src.length;
	let cur = "";
	let depth = 0;
	const put = (level: number, text: string) => {
		const one = text.replace(/\s+/g, " ").trim();
		if (one) lines.push(TAB.repeat(level) + one);
	};
	const flush = () => {
		put(depth, cur);
		cur = "";
	};
	const openBlock = (raw: string) => {
		flush();
		put(depth, raw);
		depth++;
	};
	const closeBlock = (raw: string) => {
		flush();
		depth = Math.max(0, depth - 1);
		put(depth, raw);
	};
	const ownLine = (raw: string) => {
		flush();
		put(depth, raw);
	};

	let i = 0;
	while (i < n) {
		if (src.startsWith("<!--", i)) {
			const e = src.indexOf("-->", i + 4);
			const end = e < 0 ? n : e + 3;
			ownLine(src.slice(i, end));
			i = end;
			continue;
		}
		if (startsMarkup(src, i)) {
			const end = tagEnd(src, i);
			if (end < 0) {
				// An unterminated tag is text: nothing is dropped, nothing is reordered.
				cur += src.slice(i);
				break;
			}
			const raw = src.slice(i, end);
			i = end;
			const m = /^<\/?([A-Za-z][\w:-]*)/.exec(raw);
			if (!m) {
				// A declaration such as <!DOCTYPE html> or <?xml ?>.
				ownLine(raw);
				continue;
			}
			const name = m[1].toLowerCase();
			if (raw[1] === "/") {
				if (BLOCK.has(name)) closeBlock(raw);
				else cur += raw;
				continue;
			}
			if (!BLOCK.has(name)) {
				cur += raw;
				continue;
			}
			if (/\/\s*>$/.test(raw) || VOID.has(name)) {
				ownLine(raw);
				continue;
			}
			openBlock(raw);
			if (RAW_TEXT.has(name)) {
				// The body runs to the matching closing tag and is never parsed as HTML.
				// A case-insensitive search on `src` itself: lowercasing a copy can shift indices.
				const closing = new RegExp("</" + name, "gi");
				closing.lastIndex = i;
				const bodyEnd = closing.exec(src)?.index ?? n;
				emitCode(src.slice(i, bodyEnd), name === "script" ? prettyJs : prettyCss, depth, lines);
				i = bodyEnd;
			}
			continue;
		}
		// Text: up to the next real tag or comment.
		let j = i + 1;
		while (j < n && !startsMarkup(src, j) && !src.startsWith("<!--", j)) j++;
		cur += src.slice(i, j);
		i = j;
	}
	flush();
	return lines.join("\n");
}

/** The formatted body of a script or style, one level below its tag. */
function emitCode(body: string, format: (s: string) => string, level: number, lines: string[]): void {
	if (body.trim() === "") return;
	for (const line of format(body).split("\n")) {
		if (line.trim() !== "") lines.push(TAB.repeat(level) + line);
	}
}

/** Re-indents JavaScript by its braces. Strings, template literals and comments
    are copied untouched; a line break goes after `{`, `;` (outside parentheses)
    and `}`, and before `}`. */
export function prettyJs(src: string): string {
	if (src.length > MAX_CHARS) return src;
	try {
		return braceFormat(src, true);
	} catch {
		return src;
	}
}

/** Re-indents CSS by its braces and semicolons. Strings and comments are untouched. */
export function prettyCss(src: string): string {
	if (src.length > MAX_CHARS) return src;
	try {
		return braceFormat(src, false);
	} catch {
		return src;
	}
}

/** After a `}` that continues the statement (`} else`, `})`, `};`), no break. */
const CONTINUES_AFTER_CLOSE = /\s*(?:else\b|catch\b|finally\b|while\b|[),;.])/y;

function braceFormat(src: string, js: boolean): string {
	const n = src.length;
	let out = "";
	let depth = 0;
	let parens = 0;
	let i = 0;
	// A line break at the current depth; trailing blanks and older breaks go.
	const nl = () => {
		out = out.replace(/\s+$/, "") + "\n" + TAB.repeat(depth);
	};
	const skip = (j: number) => {
		while (j < n && /\s/.test(src[j])) j++;
		return j;
	};
	while (i < n) {
		const c = src[i];
		if (c === '"' || c === "'" || (js && c === "`")) {
			let j = i + 1;
			while (j < n && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
			const end = Math.min(j + 1, n);
			out += src.slice(i, end);
			i = end;
			continue;
		}
		if (js && c === "/" && src[i + 1] === "/") {
			const e = src.indexOf("\n", i);
			const end = e < 0 ? n : e;
			out += src.slice(i, end);
			i = end;
			continue;
		}
		if (c === "/" && src[i + 1] === "*") {
			const e = src.indexOf("*/", i + 2);
			const end = e < 0 ? n : e + 2;
			out += src.slice(i, end);
			i = end;
			continue;
		}
		if (/\s/.test(c)) {
			let j = i;
			while (j < n && /\s/.test(src[j])) j++;
			if (src.slice(i, j).includes("\n")) nl();
			else if (out !== "" && !/\s$/.test(out)) out += " ";
			i = j;
			continue;
		}
		if (c === "(") parens++;
		else if (c === ")") parens = Math.max(0, parens - 1);
		if (c === "{") {
			const next = skip(i + 1);
			if (src[next] === "}") {
				out += "{}";
				i = next + 1;
				continue;
			}
			out += "{";
			depth++;
			nl();
			i = skip(i + 1);
			continue;
		}
		if (c === "}") {
			depth = Math.max(0, depth - 1);
			nl();
			out += "}";
			i++;
			CONTINUES_AFTER_CLOSE.lastIndex = i;
			if (!CONTINUES_AFTER_CLOSE.test(src)) {
				nl();
				i = skip(i);
			}
			continue;
		}
		if (c === ";" && parens === 0) {
			out += ";";
			nl();
			i = skip(i + 1);
			continue;
		}
		out += c;
		i++;
	}
	return out.replace(/^\s+|\s+$/g, "");
}
