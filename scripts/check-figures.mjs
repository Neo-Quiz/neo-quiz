/**
 * THE FIGURES OF A GENERATED READING (`src/dashboard/figures.ts`), on the real
 * code.
 *
 * What it prevents: a figure the model names ("CM2.pdf, p. 7") not read, or
 * matched to the wrong document; a figure left in the note as an unknown
 * `figure` key; a failed drawing failing the whole quiz; the same page drawn
 * twice; an existing passage lost; and a model that asks for fifty figures
 * writing fifty PNGs into the user's synced folder.
 *
 *     npm run check:figures
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/figures.ts", async ({ lireFigure, documentDeFigure, nomImageFigure, poserFigures, MAX_FIGURES }) => {
	const r = makeReporter("Figures of a generated reading");

	r.check("the forms a model writes are read",
		["CM2.pdf, p. 7", "CM2.pdf p.7", "CM2.pdf, page 7", "CM2.pdf, p. 12-14", "CM2.pdf — p. 3", "Cours, UML.pdf, pp. 2"].map(lireFigure),
		[{ document: "CM2.pdf", page: 7 }, { document: "CM2.pdf", page: 7 }, { document: "CM2.pdf", page: 7 }, { document: "CM2.pdf", page: 12 }, { document: "CM2.pdf", page: 3 }, { document: "Cours, UML.pdf", page: 2 }]);
	r.check("no page, page 0, not a string: no figure",
		[lireFigure("CM2.pdf"), lireFigure("CM2.pdf, p. 0"), lireFigure(7), lireFigure(null)], [null, null, null, null]);

	const docs = [{ name: "CM2 - UML.pdf" }, { name: "Notes.md" }, { name: "Café.pdf" }];
	r.check("the PDF is found by name, with or without .pdf, any case, NFC or NFD",
		[documentDeFigure("CM2 - UML.pdf", docs)?.name, documentDeFigure("cm2 - uml", docs)?.name, documentDeFigure("Café.pdf", docs)?.name],
		["CM2 - UML.pdf", "CM2 - UML.pdf", "Café.pdf"]);
	r.check("a document that is not a PDF, or not attached, gives no figure",
		[documentDeFigure("Notes.md", docs), documentDeFigure("Autre.pdf", docs)], [null, null]);
	r.check("the image name: the PDF without extension and the page, no forbidden character",
		[nomImageFigure("CM2 - UML.pdf", 7), nomImageFigure("a/b:c*?.pdf", 1), nomImageFigure(".pdf", 2)],
		["CM2 - UML - p7.png", "a b c - p1.png", "figure - p2.png"]);

	const dessins = [];
	const deps = (echoue = () => false) => ({
		documents: docs,
		async dessiner(doc, page, nom) {
			dessins.push(nom);
			if (echoue(page)) throw new Error("cannot draw");
			return nom;
		},
	});
	const lecture = (o) => ({ role: "read", prompt: "Lis.", ...o });
	const sortie = await poserFigures([
		lecture({ figure: "CM2 - UML.pdf, p. 7" }),
		lecture({ figure: "cm2 - uml, p. 7", passage: "Le texte d'avant.", passageTitle: "Mon titre" }),
		lecture({ figure: "Notes.md, p. 1" }),
		{ role: "test", prompt: "Q ?" },
		{ mode: "learn" },
	], deps());
	r.check("a figure becomes the card's passage, its page the passage's title, the key gone",
		sortie[0], { role: "read", prompt: "Lis.", passage: "![[CM2 - UML - p7.png]]", passageTitle: "CM2 - UML.pdf, p. 7" });
	r.check("an existing passage and title are kept, after the picture",
		[sortie[1].passage, sortie[1].passageTitle], ["![[CM2 - UML - p7.png]]\n\nLe texte d'avant.", "Mon titre"]);
	r.check("the same page asked twice is drawn once", dessins, ["CM2 - UML - p7.png"]);
	r.check("a figure of a non-PDF is dropped, the card kept", sortie[2], { role: "read", prompt: "Lis." });
	r.check("cards without a figure are untouched", [sortie[3], sortie[4]], [{ role: "test", prompt: "Q ?" }, { mode: "learn" }]);

	dessins.length = 0;
	const rate = await poserFigures([lecture({ figure: "CM2 - UML.pdf, p. 3" }), lecture({ figure: "CM2 - UML.pdf, p. 4" })], deps(p => p === 3));
	r.check("a page that cannot be drawn drops its figure only, never throws", [rate[0], rate[1].passage], [{ role: "read", prompt: "Lis." }, "![[CM2 - UML - p4.png]]"]);

	dessins.length = 0;
	const beaucoup = await poserFigures(Array.from({ length: MAX_FIGURES + 5 }, (_, i) => lecture({ figure: `CM2 - UML.pdf, p. ${i + 1}` })), deps());
	r.check("at most MAX_FIGURES pages are drawn; the others lose their figure",
		[dessins.length, beaucoup.filter(q => q.passage).length, beaucoup.some(q => "figure" in q)], [MAX_FIGURES, MAX_FIGURES, false]);
	r.done();
});
