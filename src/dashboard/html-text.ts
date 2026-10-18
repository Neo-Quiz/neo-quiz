/* ══════════════════════════════════════════════════════════
   AN HTML COURSE PAGE AS PLAIN TEXT (2026-10-19), to attach it to a request.

   Course sites are HTML. The composer takes the page as Markdown-ish text:
   headings, lists, code blocks, table rows and the alt text of pictures kept,
   everything that runs or loads dropped.

   SAFE BY CONSTRUCTION, never by cleaning afterwards: the page is parsed in a
   `<template>`, whose content belongs to an INERT document: no script runs,
   no picture or frame loads, no `onerror` fires (a `<div>` kept out of the
   tree would load an `<img src=x onerror=...>`). The result is read with
   `textContent` only: it is TEXT, never put back as HTML.

   Bounded like the other formats: the input is cut at `MAX_HTML_INPUT`, the
   output at `MAX_HTML_OUTPUT`, and a page nested deeper than `MAX_DEPTH`
   has its deepest part flattened to its text (a hostile page cannot overflow
   the stack). Needs a `document` (the page's own, or one a check provides).
══════════════════════════════════════════════════════════ */

export const MAX_HTML_INPUT = 2_000_000;
export const MAX_HTML_OUTPUT = 400_000;
const MAX_DEPTH = 64;

/** Elements that run, load or carry no text of the page. */
const DROPPED = new Set(["script", "style", "noscript", "iframe", "frame", "frameset", "object", "embed", "applet", "svg", "math", "canvas", "audio", "video", "source", "track", "link", "meta", "base", "template", "form", "input", "button", "select", "textarea", "head", "title"]);
const BLOCKS = new Set(["p", "div", "section", "article", "main", "header", "footer", "nav", "aside", "figure", "figcaption", "details", "summary", "address", "dl", "dt", "dd", "hr", "fieldset", "center", "body", "html"]);

/** Is this file an HTML page, by its name or its type? */
export function isHtmlFile(name: string, type = ""): boolean {
	return /\.(html?|xhtml)$/i.test(name) || /^(text\/html|application\/xhtml\+xml)\b/i.test(type);
}

export function htmlToText(html: string): string {
	const entree = String(html ?? "");
	const borne = entree.length > MAX_HTML_INPUT ? entree.slice(0, MAX_HTML_INPUT) : entree;
	const template = document.createElement("template");
	try {
		template.innerHTML = borne;
	} catch {
		/* A parser that cannot take a page nested that deep (Chromium itself
		   stops at 512 levels, a lighter DOM may overflow its stack): the page
		   is read as TEXT, its tags and the content of scripts and styles
		   removed. Never rendered. */
		const plat = borne.replace(/<(script|style|noscript|template)[^>]*>[^]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
		return plat.length > MAX_HTML_OUTPUT ? plat.slice(0, MAX_HTML_OUTPUT) : plat;
	}
	// The <title> is read from the parsed page, else from its source text.
	const titreBrut = template.content.querySelector("title")?.textContent ?? /<title[^>]*>([^<]{0,300})</i.exec(borne)?.[1] ?? "";
	const titre = titreBrut.replace(/\s+/g, " ").trim();
	const out: string[] = [];
	let taille = 0;
	const poser = (s: string): void => {
		if (taille >= MAX_HTML_OUTPUT) return;
		out.push(s);
		taille += s.length;
	};
	const listes: Array<{ ordonnee: boolean; n: number }> = [];

	function marche(noeud: Node, profondeur: number): void {
		if (taille >= MAX_HTML_OUTPUT) return;
		if (noeud.nodeType === 3) {
			const texte = (noeud.textContent ?? "").replace(/\s+/g, " ");
			if (texte.trim() || texte === " ") poser(texte);
			return;
		}
		if (noeud.nodeType !== 1) return;
		const el = noeud as Element;
		const nom = el.localName.toLowerCase();
		if (DROPPED.has(nom)) return;
		if (profondeur > MAX_DEPTH) { poser((el.textContent ?? "").replace(/\s+/g, " ")); return; }
		const enfants = (): void => { for (const c of Array.from(el.childNodes)) marche(c, profondeur + 1); };
		if (/^h[1-6]$/.test(nom)) { poser("\n\n" + "#".repeat(Number(nom[1])) + " "); enfants(); poser("\n\n"); return; }
		if (nom === "pre") {
			// Code is kept exactly, as a fenced block.
			const code = (el.textContent ?? "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
			poser("\n\n```\n" + code + "\n```\n\n");
			return;
		}
		if (nom === "code" || nom === "kbd" || nom === "samp" || nom === "tt") { poser("`" + (el.textContent ?? "").replace(/`/g, "'").replace(/\s+/g, " ") + "`"); return; }
		if (nom === "br") { poser("\n"); return; }
		if (nom === "img") { const alt = (el.getAttribute("alt") ?? "").replace(/\s+/g, " ").trim(); if (alt) poser("[Image: " + alt + "]"); return; }
		if (nom === "ul" || nom === "ol") { listes.push({ ordonnee: nom === "ol", n: 0 }); poser("\n"); enfants(); listes.pop(); poser("\n"); return; }
		if (nom === "li") {
			const l = listes[listes.length - 1];
			if (l) l.n++;
			poser("\n" + "  ".repeat(Math.max(0, listes.length - 1)) + (l?.ordonnee ? l.n + ". " : "- "));
			enfants();
			return;
		}
		if (nom === "tr") { poser("\n| "); for (const c of Array.from(el.childNodes)) { marche(c, profondeur + 1); } poser("\n"); return; }
		if (nom === "td" || nom === "th") { enfants(); poser(" | "); return; }
		if (nom === "table" || nom === "thead" || nom === "tbody" || nom === "tfoot") { poser("\n"); enfants(); poser("\n"); return; }
		if (nom === "blockquote") { poser("\n\n> "); enfants(); poser("\n\n"); return; }
		if (BLOCKS.has(nom)) { poser("\n\n"); enfants(); poser("\n\n"); return; }
		enfants();
	}

	for (const c of Array.from(template.content.childNodes)) marche(c, 0);
	const corps = out.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
	// A control character from the page never reaches the prompt.
	const net = corps.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
	const avecTitre = titre && !net.startsWith("# ") ? "# " + titre + "\n\n" + net : net;
	return avecTitre.length > MAX_HTML_OUTPUT ? avecTitre.slice(0, MAX_HTML_OUTPUT) : avecTitre;
}
