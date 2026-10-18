/**
 * AN HTML COURSE PAGE ATTACHED AS TEXT (`src/dashboard/html-text.ts`, 2026-10-19),
 * on a linkedom DOM. What it prevents: a page's script, handler, frame or
 * style reaching the prompt or running; a hostile or huge page (megabytes,
 * thousands of nested elements) freezing the window or overflowing the stack;
 * and a course page losing the structure that carries its meaning (headings,
 * lists, code blocks, table rows, picture alt text).
 *
 *     npm run check:html-text
 */
import { parseHTML } from "linkedom";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const { window, document } = parseHTML("<html><body></body></html>");
globalThis.window = window;
globalThis.document = document;

await withSrcModule("src/dashboard/html-text.ts", (H) => {
	const r = makeReporter("HTML attached as text");
	const page = `<!doctype html><html><head><title>Cours 1 : Régression</title><style>h1{color:red}</style><script>window.PWNED=1</script></head><body>
		<h1>Régression linéaire</h1><p>On ajuste <code>y = a*x + b</code> par moindres carrés.</p>
		<h2>Étapes</h2><ol><li>Centrer</li><li>Résoudre</li></ol><ul><li>Vite</li><li>Simple<ul><li>Imbriqué</li></ul></li></ul>
		<pre><code>def fit(x, y):
    return sum(x) / len(y)
</code></pre>
		<table><tr><th>n</th><th>erreur</th></tr><tr><td>10</td><td>0,3</td></tr></table>
		<img src="x.png" alt="Droite de régression"><img src="y.png">
		<blockquote>Citation</blockquote><a href="javascript:alert(1)">le lien</a></body></html>`;
	const t = H.htmlToText(page);
	r.check("headings (the page already has its h1: the title adds nothing), inline code, lists, code block, table rows, alt text and link text are kept", [
		t.startsWith("# Régression linéaire"), !t.includes("Cours 1 : Régression"), t.includes("## Étapes"), t.includes("`y = a*x + b`"),
		t.includes("1. Centrer"), t.includes("2. Résoudre"), t.includes("- Vite"), t.includes("  - Imbriqué"),
		t.includes("```\ndef fit(x, y):\n    return sum(x) / len(y)\n```"), t.includes("| n | erreur |"), t.includes("| 10 | 0,3 |"),
		t.includes("[Image: Droite de régression]"), !t.includes("[Image: ]"), t.includes("> Citation"), t.includes("le lien"), !t.includes("javascript:"),
	], Array(16).fill(true));
	r.check("nothing ran and no markup is left: no script, style, tag or attribute in the text",
		[globalThis.window.PWNED, /color:red|PWNED|<[a-z/!]/i.test(t)], [undefined, false]);

	const hostile = `<div onclick="x()"><img src=x onerror="window.PWNED=2"><iframe src="https://evil.example/"></iframe><object data="x"></object><embed src="x"><svg onload="window.PWNED=3"><text>svgtext</text></svg><form action="/x"><input value="secret"><button>go</button></form><noscript>ns</noscript><script>window.PWNED=4</script>visible</div>`;
	const h = H.htmlToText(hostile);
	r.check("a hostile page: handlers, frames, objects, svg, forms and scripts give nothing and never run", [h, globalThis.window.PWNED], ["visible", undefined]);
	r.check("a page with no h1 starts with its title", H.htmlToText("<html><head><title>Cours 2 &amp; TD</title></head><body><p>Texte</p></body></html>"), "# Cours 2 & TD\n\nTexte");
	r.check("control characters of the page never reach the prompt", H.htmlToText("<p>a\u0000b\u0007c</p>"), "abc");
	r.check("an empty, null or tag-only page gives an empty text", [H.htmlToText(""), H.htmlToText(null), H.htmlToText("<div><span></span></div>")], ["", "", ""]);

	const enorme = "<p>" + "mot ".repeat(1_500_000) + "</p>";
	const e = H.htmlToText(enorme);
	r.check("a huge page: input cut at MAX_HTML_INPUT, output at MAX_HTML_OUTPUT", [e.length <= H.MAX_HTML_OUTPUT, e.length > 1000], [true, true]);
	const profond = "<div>".repeat(1500) + "tout au fond" + "</div>".repeat(1500);
	const abysse = "<div>".repeat(6000) + "au fond du fond<script>window.PWNED=5</script>" + "</div>".repeat(6000);
	let pf = null, erreur = null;
	try { pf = H.htmlToText(profond); } catch (x) { erreur = String(x.message); }
	let ab = null, erreur2 = null;
	try { ab = H.htmlToText(abysse); } catch (x) { erreur2 = String(x.message); }
	r.check("a page nested deep does not overflow the stack; one the parser cannot take is read as plain text, script content removed",
		[erreur, pf?.includes("tout au fond"), erreur2, ab?.includes("au fond du fond"), ab?.includes("PWNED"), globalThis.window.PWNED], [null, true, null, true, false, undefined]);

	r.check("which files are HTML: by extension or type, nothing else", [
		H.isHtmlFile("cours1.html"), H.isHtmlFile("COURS.HTM"), H.isHtmlFile("x.xhtml"), H.isHtmlFile("data", "text/html; charset=utf-8"),
		H.isHtmlFile("notes.md"), H.isHtmlFile("a.html.exe"), H.isHtmlFile("a.txt", "text/plain"), H.isHtmlFile("htmlx"),
	], [true, true, true, true, false, false, false, false]);
	r.done();
});
