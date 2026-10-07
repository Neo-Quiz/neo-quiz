/**
 * WHICH KIND A GENERATE REQUEST WANTS, AND WHAT IT ASKS FIRST
 * (`src/dashboard/generation-kind.ts`, spec 2026-10-07-generate-auto-kind,
 * amended by the owner the same day), on the real code.
 *
 * What it prevents: a request that does not say it wants to practise being
 * made a Test (the default is a LEARN); a plain "practise" wording, or "both",
 * missed; a broken or oversized answer of the clarify call (0 or 3+ questions,
 * fewer than 2 or more than 4 options, text around the JSON) blocking a
 * generation instead of meaning "ready"; the answers lost from the request;
 * and a clarify prompt that carries document CONTENT (only names may go).
 * The chat record's questions are covered by `check:chat-record`.
 *
 *     npm run check:generation-kind
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/generation-kind.ts", (K) => {
	const r = makeReporter("Generation kind");

	const table = [
		// Default: a Learn, whatever the words.
		["Je veux apprendre les pointeurs en C", "learn"],
		["Explique-moi les listes en Python", "learn"],
		["Python", "learn"],
		["Le CM4", "learn"],
		["Teach me recursion", "learn"],
		["", "learn"],
		// Only explicit practice wording switches to a Test.
		["Un QCM sur le chapitre 3", "practice"],
		["Entraîne-moi pour l'examen de réseaux", "practice"],
		["Je veux m'entraîner sur les tris", "practice"],
		["Je veux m'entrainer sur les tris", "practice"],
		["S'entraîner sur SQL", "practice"],
		["Teste-moi sur les jointures", "practice"],
		["Contrôle de maths, 20 questions", "practice"],
		["Révise-moi les jointures", "practice"],
		["Quiz me on the French revolution", "practice"],
		["A mock exam on Java", "practice"],
		["practice questions on DNS", "practice"],
		["EXAMEN BLANC", "practice"],
		["Un QCM sur mon cours de réseaux", "practice"],
		// Both, only when it says so.
		["Les deux sur les pointeurs", "both"],
		["Both a lesson and a test on DNS", "both"],
		["Learn puis Test sur Python", "both"],
		["Learn then test on Python", "both"],
		["Apprendre puis me tester sur C", "both"],
		// A keyword inside a longer word is not a match.
		["Les contestations de Rome", "learn"],
		["Un examinateur sévère", "learn"],
	];
	for (const [text, attendu] of table) r.check(`kind: "${text}"`, K.decideByKeywords(text), attendu);
	r.check("kind: accents do not matter (\"controle\" = \"contrôle\")", [K.decideByKeywords("controle de physique"), K.decideByKeywords("contrôle de physique")], ["practice", "practice"]);
	r.check("kind: a combining accent (NFD) does not matter", K.decideByKeywords("Révise les tris"), "practice");

	const READY = { ready: true };
	const o = (label, description = "") => ({ label, description });
	const q = (header, question, labels, multiple = false) => ({ header, question, multiple, options: labels.map(l => o(l, "d " + l)) });
	const qs = [q("Niveau", "Quel niveau ?", ["Débutant", "Avancé"]), q("Parties", "Quelles parties ?", ["A", "B", "C"], true)];
	r.check("clarify: ready", K.parseClarifyAnswer("{\"ready\":true}"), READY);
	r.check("clarify: 1 or 2 questions are kept with header, label and description; `multiple` defaults to false",
		[K.parseClarifyAnswer(JSON.stringify({ questions: qs })), K.parseClarifyAnswer(JSON.stringify({ questions: [{ question: "?", options: [{ label: "a" }, { label: "b", description: "x" }] }] }))],
		[{ questions: qs }, { questions: [{ header: "", question: "?", multiple: false, options: [o("a"), o("b", "x")] }] }]);
	r.check("clarify: a header over 12 characters is cut to 12", K.parseClarifyAnswer(JSON.stringify({ questions: [{ header: "Un en-tete beaucoup trop long", question: "?", options: [o("a"), o("b")] }] })).questions[0].header, "Un en-tete b");
	r.check("clarify: text before and after the JSON, and a code fence", [
		K.parseClarifyAnswer("Sure! {\"ready\":true} Done."),
		K.parseClarifyAnswer("```json\n" + JSON.stringify({ questions: qs }) + "\n```"),
	], [READY, { questions: qs }]);
	r.check("clarify: a brace inside a label does not cut the object", K.parseClarifyAnswer(JSON.stringify({ questions: [q("h", "Which {one}?", ["A }", "B"])] })).questions?.length, 1);
	const opts = n => Array.from({ length: n }, (_, i) => o("o" + i));
	const many = n => Array.from({ length: n }, () => q("h", "?", ["a", "b"]));
	r.check("clarify: 1 and 2 questions kept, 0 or 3 treated as ready", [1, 2].map(n => K.parseClarifyAnswer(JSON.stringify({ questions: many(n) })).questions?.length).concat([K.parseClarifyAnswer(JSON.stringify({ questions: many(0) })), K.parseClarifyAnswer(JSON.stringify({ questions: many(3) }))]), [1, 2, READY, READY]);
	for (const n of [0, 1, 5, 6]) r.check(`clarify: ${n} option(s) is treated as ready`, K.parseClarifyAnswer(JSON.stringify({ questions: [{ question: "?", options: opts(n) }] })), READY);
	r.check("clarify: 2 and 4 options are kept", [2, 4].map(n => K.parseClarifyAnswer(JSON.stringify({ questions: [{ question: "?", options: opts(n) }] })).questions?.[0].options.length), [2, 4]);
	for (const [nom, brut] of [
		["empty question", JSON.stringify({ questions: [{ question: " ", options: [o("a"), o("b")] }] })],
		["empty label", JSON.stringify({ questions: [{ question: "?", options: [o("a"), o(" ")] }] })],
		["options as bare strings", JSON.stringify({ questions: [{ question: "?", options: ["a", "b"] }] })],
		["one bad question spoils the lot", JSON.stringify({ questions: [q("h", "ok", ["a", "b"]), { question: "?", options: [o("a")] }] })],
		["questions not a list", "{\"questions\":\"x\"}"],
		["malformed JSON", "{\"questions\":["],
		["no JSON at all", "ready"],
		["unrelated object", "{\"kind\":\"learn\"}"],
		["empty", ""],
	]) r.check("clarify: " + nom + " is treated as ready", K.parseClarifyAnswer(brut), READY);

	r.check("answers: one line per answered question, under the label",
		K.formatClarifications("Précisions :", qs, [["Débutant"], ["A", "mes notes"]]), "Précisions :\n- Quel niveau ? Débutant\n- Quelles parties ? A, mes notes");
	r.check("answers: nothing answered gives nothing", K.formatClarifications("Précisions :", qs, [[], []]), "");

	const p = K.clarifyPrompt("Python", ["cm1.pdf", "cm2.md"]);
	r.check("clarify prompt: the request and the document names", [p.user.includes("Python"), p.user.includes("- cm1.pdf"), p.user.includes("- cm2.md")], [true, true, true]);
	r.check("clarify prompt: ready, header/label/description shape, few questions, limits, vague-only, language",
		["{\"ready\":true}", "\"questions\"", "\"header\"", "\"description\"", "at most 2", "prefer none", "2 to 4 options", "12 characters", "ONLY when the request is vague", "Ask NOTHING when the request is already precise", "NEVER ask what the attached documents already answer", "language of the request"].filter(w => !p.system.includes(w)), []);
	r.check("clarify prompt: no key of the quiz format, no exam", [/mode: ?"exam"|examDurationMinutes|examAutoSubmit|examShowTimer|learnMode/.test(p.system + p.user)], [false]);
	r.check("clarify prompt: names only, no content line without documents", K.clarifyPrompt("x", []).user.includes("ATTACHED"), false);
	r.done();
});
