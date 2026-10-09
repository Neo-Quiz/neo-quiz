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

/* ─────────── Rewriting a reading card from the chat (2026-10-09) ─────────── */

await withSrcModule(["src/explain-edit.ts", "src/explain-prompt.ts", "src/lecture-style.ts"], ({ splitCardEdit, validateCardEdit, cardTextLength, consigneEditionCarte, CARD_EDIT_MAX_CHARS, CARD_EDIT_GROWTH }, { contexteQuiz }, { READING_MAX_CHARS }) => {
	const r = makeReporter("Explain: a reading card rewritten by the chat");
	const x = (n) => "x".repeat(n);
	const original = { id: "r1", role: "read", title: "Lists", promptHtml: "<p>" + x(700) + "</p>", etapes: ["first step", "second step"], cite: "CM1.pdf, p. 3", figure: "CM1.pdf, p. 4" };
	let sanitized = 0;
	/* A stand-in for `sanitizeQuizHtml` (linkedom cannot hold a <template>, see check-windows-host): it drops scripts and handlers and counts its calls. */
	const sanitize = (h) => { sanitized++; return h.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, ""); };
	const juge = (o, json) => validateCardEdit(o, typeof json === "string" ? json : JSON.stringify(json), sanitize);
	const motif = (o, json) => { const v = juge(o, json); return v.ok ? "ok" : v.reason; };

	r.check("the limits: 1800 characters for a reading (it was about 1200), +25 % at most for a rewrite",
		[READING_MAX_CHARS, CARD_EDIT_GROWTH, CARD_EDIT_MAX_CHARS], [1800, 1.25, 2250]);

	// ── reading the block out of the answer
	const bloc = (j) => "<card-edit>" + j + "</card-edit>";
	const a = splitCardEdit("Here it is.\n" + bloc('{"title":"T"}') + "\nHope it helps.");
	r.check("the block is cut out of the text and its JSON found", [a.shown, a.raw, a.pending], ["Here it is.\n\nHope it helps.", '{"title":"T"}', false]);
	const b = splitCardEdit("Working on it.\n<card-edit>{\"title\": \"T");
	r.check("a block still being written is hidden, not shown", [b.shown, b.raw, b.pending], ["Working on it.", null, true]);
	r.check("a fence around the JSON is removed", splitCardEdit(bloc("```json\n{\"title\":\"T\"}\n```")).raw, '{"title":"T"}');
	r.check("no block: the text as is", [splitCardEdit("Just an answer.").shown, splitCardEdit("Just an answer.").raw], ["Just an answer.", null]);
	r.check("two blocks: the last one wins", splitCardEdit(bloc('{"title":"A"}') + bloc('{"title":"B"}')).raw, '{"title":"B"}');

	// ── what is refused
	r.check("a valid rewrite with an example is proposed", motif(original, { title: "Lists, simply", promptHtml: "<p>" + x(900) + "</p>", etapes: ["a", "b", "c"] }), "ok");
	r.check("invalid JSON", [motif(original, "{title: 'T'"), motif(original, "not json"), motif(original, "[1]"), motif(original, "null"), motif(original, "\"str\"")], ["json", "json", "json", "json", "json"]);
	r.check("an empty object", motif(original, {}), "empty");
	r.check("a field that is not the text of the reading: refused",
		["cite", "figure", "id", "role", "slice", "options", "correctIndex", "explain", "answer", "methode", "tableau"].map(k => motif(original, { title: "T", [k]: "x" })),
		new Array(11).fill("field"));
	r.check("a prototype key is a forbidden field", motif(original, '{"__proto__":{"title":"x"}}'), "field");
	r.check("another question: its id or its own keys are refused", [motif(original, { id: "q2", title: "Other" }), motif(original, { prompt: "x", options: ["a"], correctIndex: 0 })], ["field", "field"]);
	r.check("the card must be a reading", motif({ ...original, role: "recall" }, { title: "T" }), "notReading");
	const sansId = { role: "read", title: "Lists", promptHtml: original.promptHtml };
	const vSansId = juge(sansId, { title: "Lists, simply", promptHtml: original.promptHtml });
	r.check("a card without an id keeps its title (its question id comes from the title's slug)",
		[vSansId.ok, "title" in (vSansId.fields ?? {}), juge(original, { title: "Lists, simply" }).fields?.title], [true, false, "Lists, simply"]);
	const vRetenir = juge(original, { retenir: { forme: "cartes", items: [{ recto: "a", verso: "b", extra: "x" }, { recto: "", verso: "" }], stray: 1 } });
	r.check("key points are written in their normalised form: no stray key, no empty card",
		vRetenir.fields?.retenir, { forme: "cartes", items: [{ recto: "a", verso: "b" }] });
	r.check("`prompt` on a card that uses `promptHtml` (and the reverse) is refused",
		[motif(original, { prompt: "text" }), motif({ id: "r2", role: "read", title: "T", prompt: x(700) }, { promptHtml: "<p>x</p>" })], ["field", "field"]);
	r.check("wrong types: a title, a text, steps, key points", [
		motif(original, { title: 3 }), motif(original, { title: "  " }), motif(original, { promptHtml: 3 }), motif(original, { promptHtml: "<script>x</script>" }),
		motif(original, { etapes: "a" }), motif(original, { etapes: [] }), motif(original, { etapes: ["a", ""] }), motif(original, { etapes: new Array(13).fill("s") }),
		motif(original, { retenir: { forme: "cartes", items: [] } }), motif(original, { retenir: "x" }),
	], new Array(10).fill("type"));
	r.check("key points of either form are accepted",
		[motif(original, { retenir: { forme: "cartes", items: [{ recto: "a", verso: "b" }] } }), motif(original, { retenir: { forme: "recap", items: ["fact", "fact two"] } })], ["ok", "ok"]);

	// ── length: the limit +25 %, and no loss of more than 30 %
	const fixe = { id: "r3", role: "read", title: "T", promptHtml: "<p>" + x(100) + "</p>" };
	const faitLe = (n) => ({ promptHtml: "<p>" + x(n) + "</p>" });
	const ajuste = (cible) => faitLe(cible - cardTextLength({ title: "T" }));
	r.check("exactly the limit +25 % passes, one more character is too long",
		[motif(fixe, ajuste(CARD_EDIT_MAX_CHARS)), motif(fixe, ajuste(CARD_EDIT_MAX_CHARS + 1))], ["ok", "tooLong"]);
	const grande = { id: "r4", role: "read", title: "T", promptHtml: "<p>" + x(1000) + "</p>" };
	const avant = cardTextLength(grande);
	const seuil = Math.ceil(avant * 0.7);
	r.check("losing exactly 30 % passes, losing more is refused",
		[motif(grande, ajuste(seuil)), motif(grande, ajuste(seuil - 1))], ["ok", "lossy"]);
	r.check("a short title alone is judged on the whole card, not on its own", motif(original, { title: "Short" }), "ok");
	r.check("steps cut to almost nothing lose too much", motif({ ...grande, promptHtml: undefined, prompt: undefined, etapes: [x(500), x(500)] }, { etapes: ["only one"] }), "lossy");

	// ── HTML goes through the gate
	sanitized = 0;
	const sale = juge(original, { promptHtml: "<p onclick=\"evil()\">" + x(700) + "</p><script>alert(1)</script>" });
	r.check("promptHtml is the sanitizer's output, never the raw model text",
		[sale.ok, sale.ok && sale.fields.promptHtml.includes("script"), sale.ok && sale.fields.promptHtml.includes("onclick"), sale.ok && sale.fields.promptHtml.includes(x(700)), sanitized > 0], [true, false, false, true, true]);

	// ── the context the model gets
	const q2 = { title: "Q", prompt: "?", options: ["a", "b"], correctIndex: 0, explain: "why" };
	const lecture = { ...original, etapes: ["Do this", "Then that"], retenir: { forme: "recap", items: ["keep me"] } };
	const ctx = contexteQuiz([lecture, q2], { quiz: "CM1", courant: 0 });
	const q1 = ctx.slice(ctx.indexOf("[Q1]"), ctx.indexOf("[Q2]"));
	r.check("a reading on screen: marked, with its text, steps, key points, source and figure",
		[q1.includes("QUESTION ON SCREEN"), q1.includes("reading card"), q1.includes("1. Do this"), q1.includes("- keep me"), q1.includes("Source: CM1.pdf, p. 3"), q1.includes("Figure shown above the card: CM1.pdf, p. 4"), q1.includes("Learner's answer")],
		[true, true, true, true, true, true, false]);
	r.check("a reading that is not on screen does not carry the source", contexteQuiz([lecture, q2], { quiz: "", courant: 1 }).includes("Source:"), false);
	const consigne = consigneEditionCarte(lecture);
	r.check("the instruction: the tag, the limit, every piece of information kept, the card's current fields, nothing written before the click",
		[consigne.includes("<card-edit>"), consigne.includes("under 1800 characters"), consigne.includes("2250"), consigne.includes("EVERY piece of information"), consigne.includes("promptHtml"), consigne.includes('"etapes":["Do this","Then that"]'), consigne.includes("nothing is written before they click"), consigne.includes("CM1.pdf")],
		[true, true, true, true, true, true, true, false]);
	r.done();
});

await withSrcModule(["src/explain-prompt.ts", "src/explain-images.ts", "src/markdown-preview.ts"], ({ consigneExplication, contexteQuiz, ligneHistorique }, { ancrerImagesCitees, imageNommee, JETON_RE }, { renderMarkdownPreview }) => {
	const r = makeReporter("Explain method, history and cited pictures");

	// ── the method
	const q = consigneExplication(false);
	r.check("the method for a question: error diagnosis, steps from zero, why right AND why each wrong option, example, ONE check question, page citation, picture syntax",
		[/WRONG answer/.test(q), /step by step, starting from zero/.test(q), /why each option the learner chose wrongly is wrong/.test(q), /example or an analogy/.test(q), /ONE short check question/.test(q), /CM2.pdf, p. 7/.test(q), /[p. N]/.test(q), /SHOW it/.test(q), q.includes("![[exact name]]"), /"tu"/.test(q)],
		[true, true, true, true, true, true, true, true, true, true]);
	const c = consigneExplication(true);
	r.check("a reading card is rephrased more simply then given an example, without the question steps",
		[/Rephrase the card more simply/.test(c), /concrete example/.test(c), /WRONG answer/.test(c), /check question/.test(c), c.includes("![[exact name]]")], [true, true, false, false, true]);

	// ── the history of the question on screen
	const single = { title: "A", prompt: "?", options: ["x", "y"], correctIndex: 0 };
	const avec = h => contexteQuiz([single], { quiz: "Q", courant: 0, myAnswer: "B. y", correct: false, history: h });
	r.check("history: one short line with attempts and misses",
		[avec({ attempts: 4, misses: 2 }).includes("Learner's history on this question: 4 attempts, 2 missed."), avec({ attempts: 1, misses: 0 }).includes("1 attempt, 0 missed.")], [true, true]);
	r.check("history: three misses ask for the basics, two do not",
		[avec({ attempts: 5, misses: 3 }).includes("from the basics"), avec({ attempts: 5, misses: 2 }).includes("from the basics")], [true, false]);
	r.check("history: absent, empty or incoherent gives no line",
		[avec(null).includes("history"), avec(undefined).includes("history"), avec({ attempts: 0, misses: 0 }).includes("history"), avec({ attempts: 2, misses: 5 }).includes("history"), ligneHistorique({ attempts: 2.5, misses: 1 })], [false, false, false, false, null]);
	r.check("history: only on the question on screen",
		contexteQuiz([single, single], { quiz: "Q", courant: 0, history: { attempts: 3, misses: 1 } }).split("history on this question").length - 1, 1);

	// ── the cited pictures
	const jointes = [
		{ name: "diagramme-cas.png", path: "Cours/Schémas/diagramme-cas.png", relatif: "Schémas/diagramme-cas.png" },
		{ name: "racine.png", path: "Cours/racine.png", relatif: "racine.png" },
	];
	const a = ancrerImagesCitees("Voir ![[Schémas/diagramme-cas.png]] et ![[racine.png]] puis ![[diagramme-cas.png]].", jointes);
	r.check("an attached picture (relative path or bare name) becomes a token, once per picture", [a.images.map(i => i.name), [...a.texte.matchAll(JETON_RE)].length], [["diagramme-cas.png", "racine.png"], 3]);
	const inconnu = ancrerImagesCitees("![[autre.png]] ![[../secret.png]] ![[Schémas/../racine.png]] ![[C:/x.png]] ![[a\b.png]]", jointes);
	r.check("an unknown name or a path with .. is shown as text and never loaded", [inconnu.images.length, inconnu.texte.includes("![["), inconnu.texte.includes("autre.png")], [0, false, true]);
	r.check("the match ignores case and the size/alias suffix", imageNommee("RACINE.png|300", jointes)?.name, "racine.png");
	const forge = ancrerImagesCitees("\uE000" + "0" + "\uE001 faux", jointes);
	r.check("a token forged by the model is stripped", [forge.images.length, [...forge.texte.matchAll(JETON_RE)].length], [0, 0]);
	const hostile = ancrerImagesCitees("![[<img src=x onerror=alert(1)>.png]] <script>alert(1)</script>", jointes);
	const html = renderMarkdownPreview(hostile.texte);
	r.check("a hostile name comes out as inert text once rendered", [html.includes("<img"), html.includes("<script"), html.includes("&lt;img")], [false, false, true]);
	r.done();
});

/* ─────────── Improving a QUESTION from the assistant chat (2026-10-09) ─────────── */

await withSrcModule(["src/question-edit.ts", "src/explain-prompt.ts"], ({ validateQuestionEdit, checkQuestionFields, questionEditFields, questionKind, consigneEditionQuestion, LIMITS }, { consigneExplication }) => {
	const r = makeReporter("Assistant: a question improved by the chat");
	let sanitized = 0;
	const sanitize = (h) => { sanitized++; return h.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, ""); };
	const juge = (o, json, ordre) => validateQuestionEdit(o, typeof json === "string" ? json : JSON.stringify(json), sanitize, ordre);
	const motif = (o, json) => { const v = juge(o, json); return v.ok ? "ok" : v.reason; };
	const x = (n) => "x".repeat(n);

	const single = { id: "q1", title: "Division", prompt: "What is `7 // 2`?", options: ["3.5", "3", "4"], correctIndex: 1, explain: "Floor division.", hint: "Rounds down." };
	const multi = { id: "q2", prompt: "Which are even?", options: ["1", "2", "4"], multiSelect: true, correctIndices: [1, 2], explain: "Divisible by two." };
	const texte = { id: "q3", type: "text", prompt: "Type of 'a'?", answer: "str", acceptedAnswers: ["string"] };
	const nombre = { id: "q4", type: "text", numeric: true, prompt: "2 + 2?", answer: "4" };
	const trous = { id: "q5", prompt: "Fill in", cloze: "Use {{append|push}} then {{len}}." };
	const classement = { id: "q6", prompt: "Order", ordering: true, possibilities: ["a", "b", "c"], correctOrder: [2, 0, 1] };
	const paires = { id: "q7", prompt: "Match", matching: true, rows: ["x", "y"], choices: ["1", "2", "3"], correctMap: [1, 0] };
	const carte = { id: "q8", flashcard: true, prompt: "front", answer: "back" };
	const html = { id: "q9", promptHtml: "<p>Old</p>", explainHtml: "<p>why</p>", options: ["a", "b"], correctIndex: 0 };
	const sansId = { title: "Division", prompt: "x?", options: ["a", "b"], correctIndex: 0 };
	const lecture = { id: "r1", role: "read", title: "R", prompt: "text" };

	// ── kinds and whitelists
	r.check("each kind of question is recognised, a reading is not a question",
		[single, multi, texte, nombre, trous, classement, paires, carte, html, lecture].map(questionKind),
		["single", "multiple", "text", "text", "cloze", "ordering", "matching", "flashcard", "single", null]);
	r.check("whitelist of a single choice: statement, explanation, hint, title, options, right answer",
		questionEditFields(single), ["title", "prompt", "explain", "hint", "options", "correctIndex"]);
	r.check("whitelist follows the form the question uses: promptHtml, explainHtml",
		questionEditFields(html), ["title", "promptHtml", "explainHtml", "hint", "options", "correctIndex"]);
	r.check("whitelists of the other kinds", [questionEditFields(multi).slice(4), questionEditFields(texte).slice(4), questionEditFields(trous).slice(4), questionEditFields(classement).slice(4), questionEditFields(paires).slice(4), questionEditFields(carte).slice(4)],
		[["options", "correctIndices"], ["answer", "acceptedAnswers"], ["cloze"], ["possibilities", "correctOrder"], ["rows", "choices", "correctMap"], ["answer"]]);

	// ── a valid proposal
	const ok = juge(single, { prompt: "What does `7 // 2` give in Python?" });
	r.check("a rephrased statement is proposed, with its before/after and no change of answer",
		[ok.ok, ok.rows, ok.answerChange], [true, [{ field: "prompt", before: "What is `7 // 2`?", after: "What does `7 // 2` give in Python?" }], null]);

	// ── forbidden fields, kind changes
	r.check("a field outside the whitelist is refused: id, slice, topic, passage, glossary, a prototype key, another kind's answer",
		[motif(single, { id: "q9" }), motif(single, { prompt: "x", slice: 2 }), motif(single, { topic: "t" }), motif(single, { passage: "p" }), motif(single, { glossary: [] }),
			motif(single, '{"__proto__":{"prompt":"x"}}'), motif(single, { correctIndices: [0] }), motif(texte, { options: ["a", "b"] })],
		["field", "kind", "field", "field", "field", "field", "field", "field"]);
	r.check("a change of kind is refused: type, multiSelect, ordering, cloze, flashcard, role",
		[motif(single, { type: "text" }), motif(single, { multiSelect: true, correctIndices: [0, 1] }), motif(single, { ordering: true }), motif(single, { cloze: "{{a}}" }), motif(single, { flashcard: true }), motif(single, { role: "read" })],
		new Array(6).fill("kind"));
	r.check("`prompt` on a question that shows `promptHtml` (and the reverse) is refused",
		[motif(html, { prompt: "x" }), motif(single, { promptHtml: "<p>x</p>" }), motif(single, { explainHtml: "<p>x</p>" })], ["field", "field", "field"]);
	r.check("a reading is not a question", [motif(lecture, { prompt: "y" }), checkQuestionFields(lecture, { prompt: "y" }, sanitize).reason], ["notQuestion", "notQuestion"]);
	r.check("invalid JSON or nothing", [motif(single, "{prompt:"), motif(single, "[1]"), motif(single, "null"), motif(single, {})], ["json", "json", "json", "empty"]);

	// ── the right answers stay inside the options
	r.check("a right answer outside the options is refused",
		[motif(single, { correctIndex: 3 }), motif(single, { correctIndex: -1 }), motif(multi, { correctIndices: [0, 5] }), motif(classement, { correctOrder: [0, 1, 5] }), motif(paires, { correctMap: [0, 9] }),
			motif(single, { options: ["a", "b"], correctIndex: 2 })],
		["bounds", "bounds", "bounds", "bounds", "bounds", "bounds"]);
	r.check("shorter options that leave the right answer out are refused", motif({ ...single, correctIndex: 2 }, { options: ["a", "b"] }), "bounds");
	r.check("at least one right answer",
		[motif(multi, { correctIndices: [] }), motif(trous, { cloze: "No blank left." }), motif({ id: "t", type: "text", prompt: "?", answer: "a" }, { answer: " " })], ["noAnswer", "noAnswer", "type"]);
	r.check("no duplicate option (spacing and case ignored), no right answer twice",
		[motif(single, { options: ["3", "3 ", "4"] }), motif(single, { options: ["Three", "three", "4"] }), motif(multi, { correctIndices: [1, 1] }), motif(classement, { possibilities: ["a", "a", "c"] }), motif(paires, { rows: ["x", "X"] })],
		["duplicate", "duplicate", "duplicate", "duplicate", "duplicate"]);
	r.check("an ordering, a matching, the options and a cloze stay complete",
		[motif(single, { options: ["only"], correctIndex: 0 }), motif(classement, { correctOrder: [0, 1] }), motif(classement, { possibilities: ["a", "b", "c", "d"] }), motif(paires, { correctMap: [0] }),
			motif(trous, { cloze: "Use {{append}} then {{len}} and {{pop}}." }), motif(single, { options: new Array(11).fill(0).map((_, i) => "o" + i) })],
		["incomplete", "incomplete", "incomplete", "incomplete", "incomplete", "incomplete"]);
	r.check("wrong value types", [motif(single, { correctIndex: "1" }), motif(single, { correctIndex: 1.5 }), motif(single, { hint: [] }), motif(single, { hint: ["a", "b", "c", "d", "e"] }), motif(single, { options: ["a", ""] }), motif(single, { title: "  " }), motif(nombre, { answer: "four" })],
		new Array(7).fill("type"));
	r.check("a numeric answer that is a number passes", motif(nombre, { answer: "5" }), "ok");

	// ── lengths
	r.check("the statement up to its limit passes, one more character is too long",
		[motif(single, { prompt: x(LIMITS.prompt) }), motif(single, { prompt: x(LIMITS.prompt + 1) }), motif(single, { options: ["a", "b", x(LIMITS.option + 1)] })], ["ok", "tooLong", "tooLong"]);
	const long = { ...single, prompt: x(5000) };
	r.check("a statement already longer may grow by 25 %", [motif(long, { prompt: x(6250) }), motif(long, { prompt: x(6251) })], ["ok", "tooLong"]);

	// ── the identity of the question
	const titreSeul = juge(sansId, { title: "Renamed", prompt: "y?" });
	r.check("a question without an id keeps its title (its id is the slug of the title)",
		[titreSeul.ok, "title" in (titreSeul.fields ?? {}), motif(sansId, { title: "Renamed" }), juge(single, { title: "Renamed" }).fields?.title], [true, false, "empty", "Renamed"]);
	r.check("an identical proposal is said so", motif(single, { prompt: single.prompt, hint: "Rounds down." }), "unchanged");
	r.check("only the fields that change are written", Object.keys(juge(single, { prompt: single.prompt, explain: "Better." }).fields), ["explain"]);

	// ── a change of the right answer is said, with the letters on screen
	r.check("a new right answer: B becomes C, in the note's order", juge(single, { correctIndex: 2 }).answerChange, { from: "B. 3", to: "C. 4" });
	r.check("… and in the order on screen when the options are shuffled", juge(single, { correctIndex: 2 }, [2, 0, 1]).answerChange, { from: "C. 3", to: "A. 4" });
	r.check("a reworded right option, or an option only moved, is not a change of answer",
		[juge(single, { options: ["3.5", "3 (floor)", "4"] }).answerChange, juge(single, { options: ["3", "3.5", "4"], correctIndex: 0 }).answerChange], [null, null]);
	r.check("every kind says when its answer changes",
		[!!juge(multi, { correctIndices: [2] }).answerChange, !!juge(texte, { answer: "string" }).answerChange, !!juge(texte, { acceptedAnswers: ["String"] }).answerChange,
			!!juge(trous, { cloze: "Use {{extend}} then {{len}}." }).answerChange, !!juge(trous, { cloze: "First {{push|append}}, then {{len}}." }).answerChange,
			!!juge(classement, { correctOrder: [0, 1, 2] }).answerChange, !!juge(paires, { correctMap: [2, 0] }).answerChange, !!juge(carte, { answer: "other" }).answerChange],
		[true, true, false, true, false, true, true, true]);
	r.check("the answer indices never show as a raw row, the options are lettered",
		juge(single, { options: ["3.5", "3", "4", "5"], correctIndex: 1 }).rows, [{ field: "options", before: "A. 3.5\nB. 3\nC. 4", after: "A. 3.5\nB. 3\nC. 4\nD. 5" }]);

	// ── HTML goes through the gate
	sanitized = 0;
	const sale = juge(html, { promptHtml: "<p onclick=\"evil()\">New</p><script>alert(1)</script>" });
	r.check("promptHtml is the sanitizer's output, shown as text in the preview",
		[sale.ok, sale.fields?.promptHtml, sale.rows?.[0].after, sanitized > 0], [true, "<p>New</p>", "New", true]);
	r.check("an HTML field that is empty once sanitized is refused", motif(html, { promptHtml: "<script>x</script>" }), "type");

	// ── the instruction
	const consigne = consigneEditionQuestion(single);
	r.check("the instruction: the tag, the whitelist, indices from 0 not the letters, a written reason, the current fields, nothing before the click",
		[consigne.includes("<card-edit>"), consigne.includes("title, prompt, explain, hint, options, correctIndex"), consigne.includes("NOT the letters on screen"), consigne.includes("never a change without a written reason"),
			consigne.includes('"correctIndex":1'), consigne.includes('"id"'), consigne.includes("nothing is written before they click"), consigne.includes("REAL error")],
		[true, true, true, true, true, false, true, true]);
	r.check("the tutor is the assistant: it may improve the question, only with a reason",
		[/ASSISTANT/.test(consigneExplication(false)), /written reason/.test(consigneExplication(false)), /ASSISTANT/.test(consigneExplication(true))], [true, true, false]);
	r.done();
});
