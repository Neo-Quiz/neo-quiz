/**
 * The PDF sources of a quiz (`src/pdf-sources.ts`): which documents a quiz
 * cites, in which order, and which file each name designates.
 *     npm run check:pdf-sources
 */
import { readFileSync } from "node:fs";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/pdf-sources.ts", (m) => {
	const { lireCitations, sourcesDuQuiz, resoudreSource, partiesNom, cleDocument } = m;
	const r = makeReporter("PDF sources of a quiz");

	// Reading one citation.
	r.check("name and page range", lireCitations("CM3 - Réseaux.pdf, p. 12-14"), [{ name: "CM3 - Réseaux.pdf", page: 12 }]);
	r.check("a hyphen inside the name is not a separator", lireCitations("CM3 - Réseaux.pdf p.7")[0], { name: "CM3 - Réseaux.pdf", page: 7 });
	r.check("a name alone has no page", lireCitations("cours.pdf"), [{ name: "cours.pdf", page: null }]);
	r.check("'page' written out", lireCitations("cours.pdf, page 3")[0].page, 3);
	r.check("two documents in one text", lireCitations("a.pdf, p. 2; b.pdf, p. 9").map(c => [c.name, c.page]), [["a.pdf", 2], ["b.pdf", 9]]);
	r.check("a text that names no PDF gives nothing", lireCitations("Chapitre 3, p. 4"), []);
	r.check("a non-string gives nothing", lireCitations(42), []);
	r.check("an extension inside a longer word is not a PDF", lireCitations("x.pdfs, p. 1"), []);

	// The union over a quiz.
	const qs = [
		{ cite: "B.pdf, p. 4" },
		{ title: "no cite" },
		{ cite: "a.pdf, p. 2", figure: "B.pdf, p. 9" },
		{ cite: "b.PDF, p. 1" },
		{ source: "ignored.pdf" },
		null,
	];
	r.check("union in order of appearance, once each", sourcesDuQuiz(qs), [{ name: "B.pdf", page: 4 }, { name: "a.pdf", page: 2 }]);
	r.check("`source` is never read", sourcesDuQuiz([{ source: "x.pdf" }]), []);
	r.check("`figure` alone counts", sourcesDuQuiz([{ figure: "f.pdf, p. 5" }]), [{ name: "f.pdf", page: 5 }]);
	r.check("no page written opens on page 1", sourcesDuQuiz([{ cite: "z.pdf" }]), [{ name: "z.pdf", page: 1 }]);
	r.check("names compare through case and composition", cleDocument("É.pdf") === cleDocument("É.PDF"), true);

	// Resolving a name.
	const f = (path) => ({ path, name: path.split("/").pop(), extension: path.split(".").pop() });
	const files = [f("Cours/a.pdf"), f("Cours/sub/deep/a.pdf"), f("Autre/b.pdf"), f("Autre/c.pdf"), f("Autre2/c.pdf"), f("Cours/notes.md")];
	r.check("the quiz's own folder first", resoudreSource("a.pdf", "Cours/q.md", files), "Cours/a.pdf");
	r.check("then its subfolders, the shallowest", resoudreSource("a.pdf", "Cours/q.md", [f("Cours/sub/deep/a.pdf"), f("Cours/sub/a.pdf")]), "Cours/sub/a.pdf");
	r.check("else the root, if the name is unique", resoudreSource("b", "Cours/q.md", files), "Autre/b.pdf");
	r.check("an ambiguous name elsewhere is not guessed", resoudreSource("c.pdf", "Cours/q.md", files), null);
	r.check("a missing name gives null", resoudreSource("nope.pdf", "Cours/q.md", files), null);
	r.check("a note is never a PDF", resoudreSource("notes.md", "Cours/q.md", files), null);
	r.check("a sibling folder's prefix does not count as the folder", resoudreSource("a.pdf", "Cours/q.md", [f("Cours2/a.pdf"), f("Autre/a.pdf")]), null);
	r.check("a quiz at the root sees the whole root", resoudreSource("a.pdf", "q.md", [f("Z/a.pdf")]), "Z/a.pdf");

	// The chip's name.
	r.check("a short name stays whole", partiesNom("cours.pdf"), { head: "cours.pdf", tail: "" });
	const long = partiesNom("CM3 - Conception et architecture logicielle chapitre 2.pdf");
	r.check("a long name keeps its end and its extension in the tail", long.tail, "apitre 2.pdf");
	r.check("... and nothing is lost", long.head + long.tail, "CM3 - Conception et architecture logicielle chapitre 2.pdf");

	// The engine must not compile a document's code: a PDF can come from a shared quiz.
	for (const f of ["pdf.mjs", "pdf.worker.mjs"]) {
		const code = readFileSync(new URL(`../apps/windows/node_modules/pdfjs-dist/build/${f}`, import.meta.url), "utf8");
		r.check(`${f} has no dynamic code compilation`, /new Function\(|[^.\w]eval\(|isEvalSupported/.test(code), false);
		r.check(`${f} has no document scripting`, /enableScripting\s*[:=]\s*true/.test(code), false);
	}
	r.done();
});
