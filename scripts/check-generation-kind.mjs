/**
 * WHICH KIND A GENERATE REQUEST WANTS, AND WHAT IT ASKS FIRST
 * (`src/dashboard/generation-kind.ts`, spec 2026-10-07-generate-auto-kind,
 * amended by the owner the same day), on the real code.
 *
 * What it prevents: a model-deduced kind being lost; a filename or pasted path
 * overriding the request's meaning; a broken or oversized answer of the clarify call (0 or 4+ questions,
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

	const READY = { ready: true };
	const o = (label, description = "") => ({ label, description });
	const q = (header, question, labels, multiple = false, def = 0) => ({ header, question, multiple, options: labels.map(l => o(l, "d " + l)), default: def });
	const qs = [q("Niveau", "Quel niveau ?", ["Débutant", "Avancé"]), q("Parties", "Quelles parties ?", ["A", "B", "C"], true)];
	const kindQuestion = { header: "Type", question: "Quel format voulez-vous ?", multiple: false, options: [
		{ ...o("Learn"), kind: "learn" }, { ...o("Test"), kind: "practice" }, { ...o("Both"), kind: "both" },
	], default: 0, purpose: "kind" };
	r.check("clarify: ready", K.parseClarifyAnswer("{\"ready\":true}"), READY);
	r.check("clarify: a kind alone is accepted", K.parseClarifyAnswer('{"kind":"practice"}'), { ready: true, kind: "practice" });
	r.check("clarify: valid kind and type question are retained", K.parseClarifyAnswer(JSON.stringify({ kind: "learn", questions: [kindQuestion] })), { questions: [kindQuestion], kind: "learn" });
	r.check("clarify: malformed kind is ignored while valid questions survive", K.parseClarifyAnswer(JSON.stringify({ kind: "Test", questions: qs })), { questions: qs });
	r.check("clarify: a valid kind survives malformed questions", K.parseClarifyAnswer('{"kind":"practice","questions":"broken"}'), { ready: true, kind: "practice" });
	r.check("clarify: 1 to 3 questions are kept with header, label and description; `multiple` defaults to false",
		[K.parseClarifyAnswer(JSON.stringify({ questions: qs })), K.parseClarifyAnswer(JSON.stringify({ questions: [{ question: "?", options: [{ label: "a" }, { label: "b", description: "x" }] }] }))],
		[{ questions: qs }, { questions: [{ header: "", question: "?", multiple: false, options: [o("a"), o("b", "x")], default: 0 }] }]);
	const withDefault = (d) => K.parseClarifyAnswer(JSON.stringify({ questions: [{ question: "?", options: [o("a"), o("b"), o("c")], default: d }] })).questions[0].default;
	r.check("clarify: the model's default option is kept", [withDefault(0), withDefault(2)], [0, 2]);
	r.check("clarify: a default out of range, negative, fractional or not a number is the first option", [withDefault(3), withDefault(-1), withDefault(1.5), withDefault("2"), withDefault(null)], [0, 0, 0, 0, 0]);
	r.check("clarify: a missing default is the first option", K.parseClarifyAnswer(JSON.stringify({ questions: [{ question: "?", options: [o("a"), o("b")] }] })).questions[0].default, 0);
	r.check("clarify: a header over 12 characters is cut to 12", K.parseClarifyAnswer(JSON.stringify({ questions: [{ header: "Un en-tete beaucoup trop long", question: "?", options: [o("a"), o("b")] }] })).questions[0].header, "Un en-tete b");
	r.check("clarify: text before and after the JSON, and a code fence", [
		K.parseClarifyAnswer("Sure! {\"ready\":true} Done."),
		K.parseClarifyAnswer("```json\n" + JSON.stringify({ questions: qs }) + "\n```"),
	], [READY, { questions: qs }]);
	r.check("clarify: a brace inside a label does not cut the object", K.parseClarifyAnswer(JSON.stringify({ questions: [q("h", "Which {one}?", ["A }", "B"])] })).questions?.length, 1);
	const opts = n => Array.from({ length: n }, (_, i) => o("o" + i));
	const many = n => Array.from({ length: n }, () => q("h", "?", ["a", "b"]));
	r.check("clarify: 1, 2, and 3 questions kept, 0 or 4 treated as ready", [1, 2, 3].map(n => K.parseClarifyAnswer(JSON.stringify({ questions: many(n) })).questions?.length).concat([K.parseClarifyAnswer(JSON.stringify({ questions: many(0) })), K.parseClarifyAnswer(JSON.stringify({ questions: many(4) }))]), [1, 2, 3, READY, READY]);
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
		["unrelated object", "{\"other\":\"learn\"}"],
		["empty", ""],
	]) r.check("clarify: " + nom + " is treated as ready", K.parseClarifyAnswer(brut), READY);
	r.check("clarify: malformed type metadata is ignored", K.parseClarifyAnswer(JSON.stringify({ questions: [{ ...kindQuestion, purpose: "mode", options: kindQuestion.options.map(x => ({ ...x, kind: "Test" })) }] })).questions, [{ ...kindQuestion, purpose: undefined, options: kindQuestion.options.map(({ kind, ...x }) => x) }]);
	r.check("clarify: a multi-select type question is not trusted", K.parseClarifyAnswer(JSON.stringify({ questions: [{ ...kindQuestion, multiple: true }] })).questions[0].purpose, undefined);
	const kindFromAnswers = typeof K.kindFromClarifications === "function" ? K.kindFromClarifications : () => null;
	r.check("answers: a type choice overrides the safe default, while a skipped choice uses its Learn default", [
		kindFromAnswers(undefined, [kindQuestion], [["Test"]]),
		kindFromAnswers(undefined, [kindQuestion], [[]]),
	], ["practice", "learn"]);
	r.check("answers: a custom type answer falls back safely", kindFromAnswers(undefined, [kindQuestion], [["Something else"]]), "learn");

	r.check("answers: one line per answered question, under the label",
		K.formatClarifications("Précisions :", qs, [["Débutant"], ["A", "mes notes"]]), "Précisions :\n- Quel niveau ?\n    Débutant\n- Quelles parties ?\n    A, mes notes");
	r.check("answers: a skipped question stands for its default option",
		K.formatClarifications("Précisions :", [q("N", "Niveau ?", ["Avancé", "Débutant total"], false, 1), qs[1]], [[], ["B"]]), "Précisions :\n- Niveau ?\n    Débutant total\n- Quelles parties ?\n    B");
	r.check("answers: everything skipped gives the defaults", K.formatClarifications("P :", qs, [[], []]), "P :\n- Quel niveau ?\n    Débutant\n- Quelles parties ?\n    A");

	const p = K.clarifyPrompt("Python", ["cm1.pdf", "cm2.md"]);
	r.check("clarify prompt: the request and the document names", [p.user.includes("Python"), p.user.includes("- cm1.pdf"), p.user.includes("- cm2.md")], [true, true, true]);
	r.check("clarify prompt: JSON shape, header/label/description, limits, and language",
		['"questions"', '"header"', '"description"', '"default"', 'most beginner option', '1 to 3 questions', '2 to 4 options', '12 characters', 'NEVER ask what the attached documents already answer', 'language of the request'].filter(w => !p.system.includes(w)), []);
	r.check("clarify prompt: always asks the question count with Auto first and as the default",
		['Always ask one question about the NUMBER OF QUESTIONS', 'the option labeled exactly "Auto" first', 'set the default to index 0', 'decide freely', 'NO numeric bound', '15, 25, and 40'].map(w => p.system.includes(w)), [true, true, true, true, true, true]);
	r.check("clarify prompt: asks quiz count for multiple documents with the same Auto default",
		['If two or more attached documents', 'HOW MANY QUIZZES', 'one combined quiz over everything', 'one quiz per document'].map(w => p.system.includes(w)), [true, true, true, true]);
	r.check("clarify prompt: allows one optional question and never exceeds three",
		['at most ONE optional clarifying question', 'ask about kind when it is ambiguous', 'Never exceed 3 questions total'].map(w => p.system.includes(w)), [true, true, true]);
	r.check("clarify prompt: infers kind from meaning and ignores keywords inside paths and filenames",
		["Deduce the quiz kind from the meaning", "pasted path", "filename", "does NOT express the learner's intent"].map(w => p.system.includes(w)), [true, true, true, true]);
	r.check("clarify prompt: asks Learn/Test/Both only for genuinely ambiguous intent and links options to canonical kinds",
		['ONLY when the intended kind is genuinely ambiguous', '"purpose":"kind"', '"kind":"learn"', '"kind":"practice"', '"kind":"both"'].map(w => p.system.includes(w)), [true, true, true, true, true]);
	r.check("clarify prompt: does not offer ready when the count must always be asked", p.system.includes('{"ready":true}'), false);
	r.check("clarify prompt: no key of the quiz format, no exam", [/mode: ?"exam"|examDurationMinutes|examAutoSubmit|examShowTimer|learnMode/.test(p.system + p.user)], [false]);
	r.check("clarify prompt: when the request reveals no language, the app's language is the fallback (French or English)",
		[K.clarifyPrompt("Python", [], "fr").system.includes("write them in French, the language of the app"), K.clarifyPrompt("Python", [], "en").system.includes("write them in English, the language of the app"), K.clarifyPrompt("Python", []).system.includes("write them in English")], [true, true, true]);
	r.check("clarify prompt: the request's own language still comes first", K.clarifyPrompt("x", [], "fr").system.includes("in the language of the request; when the request does not reveal a language"), true);
	r.check("clarify prompt: names only, no content line without documents", K.clarifyPrompt("x", []).user.includes("ATTACHED"), false);
	r.done();
});
