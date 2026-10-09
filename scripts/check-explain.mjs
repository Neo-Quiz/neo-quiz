/**
 * THE CONTEXT OF THE "EXPLAIN" WINDOW (`src/explain-prompt.ts`,
 * `src/explain-course.ts`), on the real code.
 *
 * What it prevents: a context without the choices or the expected answer of
 * the question (the model would explain the wrong thing), letters that are
 * not the ones on screen, a question on screen that is not marked or that
 * carries another question's answer, the other questions of the quiz missing,
 * a cloze sent without the words its blanks expect, a note that is only a
 * quiz read as course text, an uncited document ahead of a cited one, a
 * course over its budget without the model being told, and pictures over
 * their count or size.
 *
 *     npm run check:explain
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/explain-prompt.ts", ({ contexteQuiz, reponseAttendue, htmlEnTexte }) => {
	const r = makeReporter("Explain context of a quiz");
	const single = { title: "Division", prompt: "What is `7 // 2`?", options: ["3.5", "3", "4"], correctIndex: 1, explain: "Floor division." };
	const autre = { title: "Modulo", prompt: "7 % 2 ?", options: ["0", "1"], correctIndex: 1, explain: "Remainder." };
	const lecture = { title: "Reading", promptHtml: "<p>Floor <b>division</b></p><p>rounds down</p>", role: "read" };
	const out = contexteQuiz([lecture, single, autre], { quiz: "CM1", folder: "Python", courant: 1, ordre: [2, 0, 1], myAnswer: "A. 4", correct: false });
	const blocs = out.split("\n\n");
	const q2 = out.slice(out.indexOf("[Q2]"), out.indexOf("[Q3]"));
	r.check("header: quiz and folder", [out.includes("QUIZ: CM1"), out.includes("FOLDER: Python")], [true, true]);
	r.check("every question of the quiz is there, in order", [out.indexOf("[Q1]") < out.indexOf("[Q2]"), out.indexOf("[Q2]") < out.indexOf("[Q3]"), out.includes("Title: Modulo")], [true, true, true]);
	r.check("only the question on screen is marked", [q2.includes("QUESTION ON SCREEN"), out.split("QUESTION ON SCREEN").length - 1], [true, 2]);
	r.check("shuffled options: the letters are those on screen, and so is the expected answer",
		[q2.includes("A. 4\nB. 3.5\nC. 3"), q2.includes("Expected answer: C. 3")], [true, true]);
	r.check("the other questions keep their own order", out.slice(out.indexOf("[Q3]")).includes("A. 0\nB. 1"), true);
	r.check("the learner's answer and its verdict go with the marked question only",
		[q2.includes("Learner's answer: A. 4"), q2.includes("WRONG"), out.slice(out.indexOf("[Q3]")).includes("Learner's answer")], [true, true, false]);
	r.check("explanation of every question", [q2.includes("Explanation: Floor division."), out.includes("Explanation: Remainder.")], [true, true]);
	r.check("a reading card is said so, its HTML read as text, no expected answer",
		[out.slice(0, out.indexOf("[Q2]")).includes("reading card"), out.slice(0, out.indexOf("[Q2]")).includes("Floor division\nrounds down"), out.slice(0, out.indexOf("[Q2]")).includes("Expected answer")], [true, true, false]);
	r.check("right answer and no answer given",
		[contexteQuiz([single], { quiz: "", courant: 0, myAnswer: "B. 3", correct: true }).includes("RIGHT"),
			contexteQuiz([single], { quiz: "", courant: 0 }).includes("Learner's answer: (none)")], [true, true]);
	r.check("no question on screen: nothing marked", contexteQuiz([single], { quiz: "", courant: -1 }).includes("QUESTION ON SCREEN\" is"), true);
	r.check("html to text", htmlEnTexte("<p>a &amp; b</p><ul><li>x</li></ul>"), "a & b\nx");
	r.check("multiple choice: every right option",
		reponseAttendue({ options: ["a", "b", "c"], multiSelect: true, correctIndices: [0, 2] }), "A. a ; C. c");
	r.check("cloze: the words each blank expects",
		reponseAttendue({ cloze: "Use {{append|push}} then {{len}}." }), "(1) append ; (2) len");
	r.check("ordering and matching: the right order and pairs",
		[reponseAttendue({ ordering: true, possibilities: ["b", "a"], correctOrder: [1, 0] }),
			reponseAttendue({ matching: true, rows: ["x", "y"], choices: ["1", "2"], correctMap: [1, 0] })],
		["a → b", "x → 2 ; y → 1"]);
	r.check("written answer and flashcard: the expected text",
		[reponseAttendue({ prompt: "?", answer: "None" }), reponseAttendue({ prompt: "?", acceptedAnswers: ["str", "string"] })], ["None", "str"]);
	void blocs;
	r.done();
});

await withSrcModule("src/explain-course.ts", ({ sansQuiz, estCite, ordreCours, assemblerCours, imagesCitees, choisirImages, citations, IMAGES_MAX, IMAGES_MAX_BYTES }) => {
	const r = makeReporter("Explain course and pictures");
	const quiz = "---\nneo-quiz:\n  source: \"X\"\n---\n```quiz-blocks\n[{ title: \"a\" }]\n```\n";
	r.check("a note that is only a quiz leaves no course text", sansQuiz(quiz), "");
	r.check("a note with text around its quiz keeps the text only", sansQuiz("# Intro\nHello\n```quiz-blocks\n[]\n```\nBye\n"), "# Intro\nHello\n\nBye");
	const cites = ["CE_TI303_2627_sujet_5003338037, p. 2", "Cours/CM3 - Réseaux.pdf"];
	r.check("cited by full name or by name without extension, case ignored",
		[estCite("CE_TI303_2627_sujet_5003338037.pdf", cites), estCite("cm3 - réseaux.PDF", cites), estCite("TD1.md", cites)], [true, true, false]);
	r.check("cited documents first, the rest in their order",
		ordreCours([{ name: "a.md" }, { name: "CM3 - Réseaux.pdf" }, { name: "b.md" }, { name: "CE_TI303_2627_sujet_5003338037.pdf" }], cites).map(d => d.name),
		["CM3 - Réseaux.pdf", "CE_TI303_2627_sujet_5003338037.pdf", "a.md", "b.md"]);
	r.check("citations: the cite of the cards and the extra sources", citations([{ cite: "x.pdf, p. 1" }, { title: "t" }], ["y", ""]), ["x.pdf, p. 1", "y"]);
	const court = assemblerCours([{ name: "a.md", text: "AAA" }, { name: "b.md", text: "BBB" }], 1000);
	r.check("under budget: every document under its title, no warning", [court.includes("=== DOCUMENT: a.md ===\nAAA"), court.includes("BBB"), court.includes("cut at")], [true, true, false]);
	const long = assemblerCours([{ name: "a.md", text: "word ".repeat(400) }, { name: "b.md", text: "B" }, { name: "c.md", text: "C" }], 1000, ["z.pdf"]);
	r.check("over budget: cut, the model told, the names left out listed",
		[long.length <= 1000 + 300, long.includes("this document is cut here"), long.includes("Not included: z.pdf, b.md, c.md")], [true, true, true]);
	const cit = imagesCitees([{ passage: "![[CE TI303 - Dossier 1.png]]", prompt: "see ![[CE TI303 - Dossier 1.png]] and ![](img/Fig.JPG)", options: ["![[b.webp]]"] }]);
	r.check("cited pictures counted by lower-cased name", [...cit.entries()], [["ce ti303 - dossier 1.png", 2], ["fig.jpg", 1], ["b.webp", 1]]);
	const fichiers = [
		{ path: "d/z.png", name: "z.png", size: 10 }, { path: "d/a.png", name: "a.png", size: 10 },
		{ path: "d/sub/cited.png", name: "cited.png", size: 10 }, { path: "d/empty.png", name: "empty.png", size: 0 },
	];
	r.check("cited first, then path order, empty ones skipped",
		choisirImages(fichiers, new Map([["cited.png", 3]])).map(f => f.name), ["cited.png", "a.png", "z.png"]);
	const beaucoup = Array.from({ length: IMAGES_MAX + 5 }, (_, i) => ({ path: `d/${String(i).padStart(2, "0")}.png`, name: `${i}.png`, size: 1 }));
	r.check("at most IMAGES_MAX pictures", choisirImages(beaucoup, new Map()).length, IMAGES_MAX);
	const gros = [{ path: "a", name: "a.png", size: IMAGES_MAX_BYTES - 5 }, { path: "b", name: "b.png", size: 10 }, { path: "c", name: "c.png", size: 4 }];
	r.check("over the size: skipped, a smaller one after it still fits", choisirImages(gros, new Map()).map(f => f.name), ["a.png", "c.png"]);
	r.done();
});
