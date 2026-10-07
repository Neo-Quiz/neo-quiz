/**
 * WHICH KIND A GENERATE REQUEST WANTS (`src/dashboard/generation-kind.ts`,
 * spec 2026-10-07-generate-auto-kind), on the real code.
 *
 * What it prevents: a request that plainly says Learn or Test going to an AI
 * call (or to the wrong kind); one that says both, or neither, being guessed
 * instead of asked; a model answer with text around its JSON, or a malformed
 * one, starting a generation with a kind nobody chose; a question with one or
 * five options, or an unknown kind, reaching the card; and a decide prompt
 * that carries document CONTENT (only the names may go). The chat record's
 * question (`ask`) is covered by `check:chat-record`.
 *
 *     npm run check:generation-kind
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/generation-kind.ts", (K) => {
	const r = makeReporter("Generation kind");

	const table = [
		["Je veux apprendre les pointeurs en C", "learn"],
		["Explique-moi les listes en Python", "learn"],
		["Je ne connais pas du tout SQL", "learn"],
		["Découvrir les graphes", "learn"],
		["Teach me recursion", "learn"],
		["I don't know anything about TCP", "learn"],
		["Learn the OSI model", "learn"],
		["Un QCM sur le chapitre 3", "practice"],
		["Entraîne-moi pour l'examen de réseaux", "practice"],
		["Contrôle de maths, 20 questions", "practice"],
		["Révise-moi les jointures", "practice"],
		["Quiz me on the French revolution", "practice"],
		["A mock exam on Java", "practice"],
		["practice questions on DNS", "practice"],
		["EXAMEN BLANC", "practice"],
		["entrainement sur les tris", "practice"],
		// Both families present: ask the AI.
		["Un QCM sur mon cours de réseaux", null],
		["Explain recursion then test me", null],
		// None: ask the AI.
		["Les pointeurs en C", null],
		["", null],
		// A keyword inside a longer word is not a match.
		["Les contestations de Rome", null],
		["Un examinateur sévère", null],
	];
	for (const [text, attendu] of table) r.check(`keywords: "${text}"`, K.decideByKeywords(text), attendu);
	r.check("keywords: accents do not matter (\"controle\" = \"contrôle\")", [K.decideByKeywords("controle de physique"), K.decideByKeywords("contrôle de physique")], ["practice", "practice"]);
	r.check("keywords: a combining accent (NFD) does not matter", K.decideByKeywords("Révise les tris"), "practice");

	const ask = { ask: "Tu veux apprendre ou t'entraîner ?", options: [{ label: "Apprendre", kind: "learn" }, { label: "M'entraîner", kind: "practice" }] };
	r.check("answer: a bare kind", ["learn", "practice", "both"].map(k => K.parseKindAnswer(`{"kind":"${k}"}`)), [{ kind: "learn" }, { kind: "practice" }, { kind: "both" }]);
	r.check("answer: a question with 2 options", K.parseKindAnswer(JSON.stringify(ask)), ask);
	r.check("answer: text before and after the JSON, and a code fence", [
		K.parseKindAnswer("Sure! {\"kind\":\"learn\"} Hope it helps."),
		K.parseKindAnswer("```json\n" + JSON.stringify(ask) + "\n```"),
	], [{ kind: "learn" }, ask]);
	r.check("answer: a brace inside a label does not cut the object", K.parseKindAnswer(JSON.stringify({ ask: "Which {one}?", options: [{ label: "A }", kind: "learn" }, { label: "B", kind: "both" }] }))?.options.length, 2);
	r.check("answer: 4 options are kept", K.parseKindAnswer(JSON.stringify({ ask: "?", options: ["a", "b", "c", "d"].map((label, i) => ({ label, kind: ["learn", "practice", "both", "learn"][i] })) }))?.options.length, 4);
	const opts = n => Array.from({ length: n }, (_, i) => ({ label: "o" + i, kind: "learn" }));
	for (const n of [0, 1, 5, 6]) r.check(`answer: ${n} option(s) is refused`, K.parseKindAnswer(JSON.stringify({ ask: "?", options: opts(n) })), null);
	const refused = [
		["unknown kind", "{\"kind\":\"exam\"}"],
		["kind not a string", "{\"kind\":3}"],
		["unknown kind in an option", JSON.stringify({ ask: "?", options: [{ label: "a", kind: "learn" }, { label: "b", kind: "exam" }] })],
		["empty label", JSON.stringify({ ask: "?", options: [{ label: " ", kind: "learn" }, { label: "b", kind: "both" }] })],
		["empty question", JSON.stringify({ ask: "  ", options: opts(2) })],
		["options not a list", "{\"ask\":\"?\",\"options\":\"x\"}"],
		["malformed JSON", "{\"kind\":\"learn\""],
		["no JSON at all", "learn"],
		["empty", ""],
	];
	for (const [nom, brut] of refused) r.check("answer refused: " + nom, K.parseKindAnswer(brut), null);

	const dict = { "ai.kind.question": "Q?", "ai.kind.learn": "L", "ai.kind.practice": "T", "ai.kind.both": "B" };
	const def = K.defaultKindQuestion(k => dict[k]);
	r.check("default question: learn, practice, both", def, { ask: "Q?", options: [{ label: "L", kind: "learn" }, { label: "T", kind: "practice" }, { label: "B", kind: "both" }] });
	r.check("the default question is itself a valid answer", K.parseKindAnswer(JSON.stringify(def)), def);

	const p = K.kindDecisionPrompt("Les pointeurs", ["cm1.pdf", "cm2.md"]);
	r.check("decide prompt: the request and the document names", [p.user.includes("Les pointeurs"), p.user.includes("- cm1.pdf"), p.user.includes("- cm2.md")], [true, true, true]);
	r.check("decide prompt: asks for the three kinds and a question, in the request's language",
		["\"kind\":\"learn\"", "\"kind\":\"practice\"", "\"kind\":\"both\"", "\"ask\"", "2 to 4 options", "language of the request"].filter(w => !p.system.includes(w)), []);
	r.check("decide prompt: no key of the quiz format, no exam", [/mode: ?"exam"|examDurationMinutes|examAutoSubmit|examShowTimer|learnMode/.test(p.system + p.user)], [false]);
	r.check("decide prompt: nothing but names for documents (no content line)", K.kindDecisionPrompt("x", []).user.includes("ATTACHED"), false);
	r.done();
});
