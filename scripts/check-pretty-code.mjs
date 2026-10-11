/**
 * The display-only re-indenter of compact HTML, JS and CSS
 * (`src/dashboard/pretty-code.ts`), used by the AI work view.
 *
 * What it prevents: a formatter that drops or reorders a character (the model's
 * code shown wrong), a `;` or `{` inside a string breaking the page, a `for(;;)`
 * split across lines, and a page too big to format freezing the window instead
 * of showing the input as written.
 *
 *     npm run check:pretty-code
 */
import { readFileSync } from "node:fs";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const nonWhite = (s) => s.replace(/\s+/g, "");

await withSrcModule("src/dashboard/pretty-code.ts", ({ prettyHtml, prettyJs, prettyCss }) => {
	const r = makeReporter("Pretty code (display only)");

	// --- The invariant, on the real page and on tricky strings ---------------
	const page = readFileSync(new URL("./fixtures/live/page-compact.html", import.meta.url), "utf8");
	const samples = {
		fixture: page,
		stringsWithSymbols: `var s = "a;{b}"; if (x) { y('c;}'); }`,
		forLoop: `for(i=0;i<n;i++){ total+=i; }`,
		lineComment: `// a comment with ; and {\nfoo();bar();`,
		templateLiteral: "const t = `a ${b} ; { c }`; run();",
		attrWithGt: `<div title="x>y"><span>z</span></div>`,
	};
	for (const [name, input] of Object.entries(samples)) {
		const out = prettyHtml(input);
		r.check(`HTML invariant holds: ${name}`, nonWhite(out) === nonWhite(input), true);
	}
	r.check("JS invariant holds on a string with ; and {", nonWhite(prettyJs(samples.stringsWithSymbols)) === nonWhite(samples.stringsWithSymbols), true);
	r.check("CSS invariant holds on a data URI with ;", nonWhite(prettyCss(`a{background:url(data:x;base64,AA)}`)) === nonWhite(`a{background:url(data:x;base64,AA)}`), true);

	// --- Shape: what the eye sees ---------------------------------------------
	const formatted = prettyHtml(page);
	r.check("fixture: more than 60 lines once indented", formatted.split("\n").length > 60, true);
	const lines = formatted.split("\n");
	const scriptAt = lines.findIndex((l) => l.trim().startsWith("<script"));
	const body = lines.slice(scriptAt + 1).find((l) => l.trim() !== "");
	const tabs = (l) => /^\t*/.exec(l)[0].length;
	r.check("fixture: the <script> body is indented one level deeper than its tag",
		scriptAt >= 0 && body !== undefined && tabs(body) > tabs(lines[scriptAt]), true);
	r.check("for(;;) stays on one line", prettyJs(samples.forLoop).includes("for(i=0;i<n;i++)"), true);
	r.check("a ; inside a string does not break the string", prettyJs(samples.stringsWithSymbols).includes(`"a;{b}"`), true);
	r.check("an attribute value holding > stays whole", prettyHtml(samples.attrWithGt).includes(`title="x>y"`), true);
	r.check("a line comment keeps its text on one line", prettyJs(samples.lineComment).split("\n")[0], "// a comment with ; and {");

	// --- Limits: over 200 000 characters, the input comes back unchanged -----
	const big = "<div>".repeat(40_001);
	r.check("HTML over 200 000 characters returns the input", prettyHtml(big), big);
	const bigJs = "a();".repeat(50_001);
	r.check("JS over 200 000 characters returns the input", prettyJs(bigJs), bigJs);
	r.check("CSS over 200 000 characters returns the input", prettyCss("a{b:c}".repeat(40_001)), "a{b:c}".repeat(40_001));

	r.done();
});
