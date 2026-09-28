/**
 * The language catalogue of code blocks (src/code-catalogue.ts): which tags
 * a block recognizes, the badge it draws, and the grammar that colours it.
 *
 * - every tag (id and alias) is lower case, trimmed, and names ONE entry:
 *   a duplicate would silently give the tag to whichever entry came first;
 * - a key inherited from `Object.prototype` never reads as a language;
 * - every entry has exactly one of a logo (that exists) or a Lucide icon,
 *   and every embedded logo is used;
 * - every logo is an inert SVG: no script, no event attribute, no external
 *   reference, no nested document or image;
 * - every tag is coloured (its grammar is really registered by
 *   engine/code-highlight.ts, through the catalogue);
 * - the displayed render carries the badge, first child of the `<pre>`;
 *   the canonical render, an unknown tag and a bare block carry none; a
 *   runnable block keeps its toolbar and `data-lang` untouched.
 *
 *     npm run check:code-catalogue
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(
	["src/code-catalogue.ts", "src/code-logos.ts", "src/engine/code-highlight.ts", "src/engine/sanitizer.ts"],
	(cat, { CODE_LOGOS }, { colorerCode, reinitialiserBudgetRendu }, { rendreTexteQuiz }) => {
	const r = makeReporter("Code catalogue");
	const { CODE_CATALOGUE, codeLanguageOf, codeLanguageBadgeSrc } = cat;

	const tags = CODE_CATALOGUE.flatMap(e => [e.id, ...e.aliases]);
	const seen = new Map();
	const duplicates = [];
	for (const e of CODE_CATALOGUE) {
		for (const tag of [e.id, ...e.aliases]) {
			if (seen.has(tag)) duplicates.push(`${tag} (${seen.get(tag)}, ${e.id})`);
			else seen.set(tag, e.id);
		}
	}
	r.check("every tag names one entry", duplicates, []);
	r.check("every tag is lower case and trimmed", tags.filter(t => t !== t.trim().toLowerCase() || !t), []);
	r.check("every tag fits the fence pattern ([\\w+#.-])", tags.filter(t => !/^[\w+#.-]+$/.test(t)), []);
	r.check("every tag resolves to its entry", tags.filter(t => codeLanguageOf(t)?.id !== seen.get(t)), []);
	r.check("case and spaces do not matter", ["JS", " Py ", "C++", "YML"].map(t => codeLanguageOf(t)?.id), ["javascript", "python", "cpp", "yaml"]);
	r.check("an unknown, empty or absent tag is null", ["mystere", "", "   ", undefined, null].map(t => codeLanguageOf(t)), [null, null, null, null, null]);
	r.check("keys inherited from Object.prototype never read as a language",
		["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "__defineGetter__"].map(t => codeLanguageOf(t)),
		[null, null, null, null, null, null]);

	r.check("every entry has a name", CODE_CATALOGUE.filter(e => !e.name || e.name !== e.name.trim()).map(e => e.id), []);
	r.check("every entry has exactly one of a logo and an icon",
		CODE_CATALOGUE.filter(e => (e.logo === undefined) === (e.icon === undefined)).map(e => e.id), []);
	r.check("every logo named exists",
		CODE_CATALOGUE.filter(e => e.logo !== undefined && !Object.prototype.hasOwnProperty.call(CODE_LOGOS, e.logo)).map(e => e.id), []);
	r.check("every icon is one of the three Lucide icons",
		CODE_CATALOGUE.filter(e => e.icon !== undefined && !["terminal", "database", "file-code"].includes(e.icon)).map(e => e.id), []);
	const used = new Set(CODE_CATALOGUE.map(e => e.logo).filter(Boolean));
	r.check("every embedded logo is used", Object.keys(CODE_LOGOS).filter(k => !used.has(k)), []);

	const INERT = /<script|\son[a-z]+\s*=|(?:xlink:)?href\s*=\s*"(?!#)|<foreignObject|<image|<iframe|<use[^>]+href="(?!#)|url\((?!#)/i;
	r.check("every logo is an inert SVG",
		Object.entries(CODE_LOGOS).filter(([, svg]) => !/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg) || !svg.endsWith("</svg>") || INERT.test(svg)).map(([k]) => k), []);
	// Discriminance of the test above: a hostile logo must be caught.
	r.check("the inert test catches a hostile SVG",
		['<svg xmlns="http://www.w3.org/2000/svg" onload="x()">', '<svg><script>x()</script>', '<svg><image href="https://x/y.png"/>', '<svg><use xlink:href="https://x#a"/>', '<svg><path fill="url(https://x)"/>'].map(s => INERT.test(s)),
		[true, true, true, true, true]);

	const srcs = CODE_CATALOGUE.map(e => codeLanguageBadgeSrc(e));
	r.check("every badge is a data: SVG with no quote, angle bracket nor ampersand",
		CODE_CATALOGUE.filter((e, i) => !srcs[i].startsWith("data:image/svg+xml,") || /["<>&]/.test(srcs[i])).map(e => e.id), []);
	r.check("a badge decodes back to its SVG",
		decodeURIComponent(codeLanguageBadgeSrc(codeLanguageOf("rust")).slice("data:image/svg+xml,".length)), CODE_LOGOS.rust);
	r.check("an icon badge is a Lucide SVG",
		decodeURIComponent(codeLanguageBadgeSrc(codeLanguageOf("sql")).slice("data:image/svg+xml,".length)).includes('<ellipse cx="12" cy="5" rx="9" ry="3"/>'), true);

	r.check("every tag is coloured by a registered grammar",
		tags.filter(t => colorerCode("x = 1", t, s => s, 1000) === null), []);

	const NL = "\n";
	const shown = (s) => { reinitialiserBudgetRendu(); return rendreTexteQuiz(s, { embed: () => "", image: () => "" }, true); };
	const canonical = (s) => { reinitialiserBudgetRendu(); return rendreTexteQuiz(s, { embed: () => "", image: () => "" }, false); };
	const badgeOf = (tag) => {
		const e = codeLanguageOf(tag);
		return `<img class="quiz-code-lang" src="${codeLanguageBadgeSrc(e)}" alt="${e.name}" title="${e.name}" width="16" height="16" draggable="false">`;
	};
	r.check("displayed: the badge is the first child of the <pre>",
		shown("```yml" + NL + "a: 1" + NL + "```").startsWith(`<pre class="quiz-md-code">${badgeOf("yaml")}<code class="language-yml">`), true);
	r.check("displayed: the name is the hover title and the alt text",
		/alt="C#" title="C#"/.test(shown("```cs" + NL + "int x;" + NL + "```")), true);
	r.check("canonical render: no badge", canonical("```js" + NL + "x" + NL + "```").includes("quiz-code-lang"), false);
	r.check("unknown tag: no badge", shown("```mystere" + NL + "x" + NL + "```"), `<pre class="quiz-md-code"><code class="language-mystere">x</code></pre>`);
	r.check("no tag: no badge", shown("```" + NL + "x" + NL + "```"), `<pre class="quiz-md-code"><code>x</code></pre>`);
	r.check("inherited key as a tag: no badge", shown("```constructor" + NL + "x" + NL + "```").includes("quiz-code-lang"), false);
	const py = shown("```py" + NL + "x=1" + NL + "```");
	r.check("runnable block: wrapper, data-lang and toolbar untouched, badge inside the <pre>",
		py.startsWith('<div class="quiz-code-block quiz-code-block-executable" data-lang="python"><div class="quiz-code-toolbar"><button type="button" class="quiz-code-run-btn" data-quiz-code-run hidden>')
		&& py.includes(`</div><pre class="quiz-md-code">${badgeOf("python")}<code class="language-py">`), true);
	r.done();
});
