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
	/* A model that still sends the old kind question: it is read as a plain question, never as a kind choice. */
	const oldKindQuestion = { header: "Type", question: "Quel format voulez-vous ?", multiple: false, options: [
		{ ...o("Learn"), kind: "learn" }, { ...o("Test"), kind: "practice" }, { ...o("Both"), kind: "both" },
	], default: 0, purpose: "kind" };
	const plainKindQuestion = { ...oldKindQuestion, options: oldKindQuestion.options.map(({ kind, ...x }) => x) };
	delete plainKindQuestion.purpose;
	r.check("clarify: ready", K.parseClarifyAnswer("{\"ready\":true}"), READY);
	r.check("clarify: a kind alone is accepted", K.parseClarifyAnswer('{"kind":"practice"}'), { ready: true, kind: "practice" });
	r.check("clarify: the kind question is never produced: an old one loses its purpose and option kinds", K.parseClarifyAnswer(JSON.stringify({ kind: "learn", questions: [oldKindQuestion] })), { questions: [plainKindQuestion], kind: "learn" });
	r.check("clarify: no kind question helper remains", typeof K.kindFromClarifications, "undefined");
	/* The conversational reply (2026-10-17). */
	r.check("reply: parsed and trimmed, with text around the JSON", K.parseClarifyAnswer('Sure {"reply":"  Salut ! Voici tes dossiers.  "} ok'), { reply: "Salut ! Voici tes dossiers." });
	r.check("reply: bounded to MAX_REPLY", K.parseClarifyAnswer(JSON.stringify({ reply: "x".repeat(1e6) })).reply.length, K.MAX_REPLY);
	r.check("reply: a reply wins over questions and keeps no kind", K.parseClarifyAnswer(JSON.stringify({ kind: "practice", reply: "Hi", questions: qs })), { reply: "Hi" });
	r.check("reply: empty, blank or non-string replies fall back to the rest", [
		K.parseClarifyAnswer('{"reply":""}'), K.parseClarifyAnswer('{"reply":"  "}'), K.parseClarifyAnswer('{"reply":42}'), K.parseClarifyAnswer('{"reply":{"a":1},"kind":"practice"}'),
	], [READY, READY, READY, { ready: true, kind: "practice" }]);
	r.check("reply: HTML stays a plain string for the caller to render as text", K.parseClarifyAnswer('{"reply":"<img src=x onerror=alert(1)>"}'), { reply: "<img src=x onerror=alert(1)>" });
	r.check("reply: a truncated or hostile object never throws", [K.parseClarifyAnswer('{"reply":"abc'), K.parseClarifyAnswer('{"reply":null}'), K.parseClarifyAnswer('{"__proto__":{"reply":"x"}}')], [READY, READY, READY]);
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
	/* The answers appended for the model are cut from the request shown (2026-10-14). */
	const block = K.formatClarifications("Précisions :", [{ question: "Combien de quiz ?", options: [{ label: "1" }], default: 0 }], [["1"]]);
	r.check("shown request: the answers block is cut, the text kept, a lookalike line kept",
		[K.sansPrecisions("Fais un quiz\n\n" + block), K.sansPrecisions("Fais un quiz"), K.sansPrecisions("Fais un quiz\n\nPrécisions :\n- a\nautre ligne"), K.sansPrecisions("Do it\n\n" + K.formatClarifications("Details:", [{ question: "How many?", options: [{ label: "2" }], default: 0 }], [[]]))],
		["Fais un quiz", "Fais un quiz", "Fais un quiz\n\nPrécisions :\n- a\nautre ligne", "Do it"]);
	r.check("clarify prompt: asks how many quizzes for several documents, as a number with Auto first",
		['If two or more attached documents', 'HOW MANY QUIZZES', '"purpose":"quizzes"', '{"quizzes":"auto"}', '{"quizzes":2}', 'split by theme', 'never describe them as one quiz per document'].map(w => p.system.includes(w)), [true, true, true, true, true, true, true]);
	/* The composer's "one quiz" toggle is gone (2026-10-14): the AI asks how
	   many quizzes, a number, and the app reads the answer. */
	const quizzesQ = { purpose: "quizzes", header: "Quiz", question: "How many quizzes?", multiple: false, default: 0, options: [{ label: "Auto", description: "", quizzes: "auto" }, { label: "1", description: "", quizzes: 1 }, { label: "2", description: "", quizzes: 2 }] };
	const parsedQ = K.parseClarifyAnswer(JSON.stringify({ questions: [quizzesQ] }));
	r.check("parse: a valid quizzes question keeps its purpose and option values", [parsedQ.questions?.[0]?.purpose, parsedQ.questions?.[0]?.options.map(o => o.quizzes)], ["quizzes", ["auto", 1, 2]]);
	r.check("parse: a quizzes value out of range (0, 11, 1.5, \"each\") loses the purpose",
		[0, 11, 1.5, "each"].map(v => K.parseClarifyAnswer(JSON.stringify({ questions: [{ ...quizzesQ, options: [quizzesQ.options[0], { label: "x", description: "", quizzes: v }] }] })).questions?.[0]?.purpose), [undefined, undefined, undefined, undefined]);
	r.check("quiz count: picked, Auto, skipped = default, typed number, typed text, absent",
		[K.quizCountFromClarifications([quizzesQ], [["2"]]), K.quizCountFromClarifications([quizzesQ], [["Auto"]]), K.quizCountFromClarifications([quizzesQ], [[]]), K.quizCountFromClarifications([quizzesQ], [["4 quiz"]]), K.quizCountFromClarifications([quizzesQ], [["beaucoup"]]), K.quizCountFromClarifications([], [])],
		[2, "auto", "auto", 4, null, null]);
	r.check("clarify prompt: allows one optional question and never exceeds three",
		['at most ONE optional clarifying question', 'Never exceed 3 questions total'].map(w => p.system.includes(w)), [true, true]);
	r.check("clarify prompt: infers kind from meaning and ignores keywords inside paths and filenames",
		["deduce the quiz kind from the meaning", "pasted path", "filename", "does NOT express the learner's intent"].map(w => p.system.includes(w)), [true, true, true, true]);
	r.check("clarify prompt: never asks about the kind, Learn by default, canonical kinds still named",
		['NEVER ask the learner about it', 'Never ask a question about the kind', 'Learn by default', '"learn"', '"practice"', '"both"'].map(w => p.system.includes(w)), [true, true, true, true, true, true]);
	r.check("clarify prompt: no trace of the kind question", ['"purpose":"kind"', 'Learn/Test/Both question', 'ask about kind when'].map(w => p.system.includes(w)), [false, false, false]);
	r.check("clarify prompt: conversational reply for non-requests, folders offered",
		['"reply"', 'greeting', 'small talk', 'NOT such a request', "learner's folders"].map(w => p.system.includes(w)), [true, true, true, true, true]);
	const pf = K.clarifyPrompt("slt", [], "fr", { names: ["XTI302", "Maths", " "] });
	r.check("clarify prompt: folder names are listed (names only, blanks dropped), absent without folders", [pf.user.includes("- XTI302"), pf.user.includes("- Maths"), pf.user.split("\n- ").length - 1, p.user.includes("FOLDERS")], [true, true, 2, false]);
	r.check("clarify prompt: does not offer ready when the count must always be asked", p.system.includes('{"ready":true}'), false);
	r.check("clarify prompt: no key of the quiz format, no exam", [/mode: ?"exam"|examDurationMinutes|examAutoSubmit|examShowTimer|learnMode/.test(p.system + p.user)], [false]);
	r.check("clarify prompt: when the request reveals no language, the app's language is the fallback (French or English)",
		[K.clarifyPrompt("Python", [], "fr").system.includes("write them in French, the language of the app"), K.clarifyPrompt("Python", [], "en").system.includes("write them in English, the language of the app"), K.clarifyPrompt("Python", []).system.includes("write them in English")], [true, true, true]);
	r.check("clarify prompt: the request's own language still comes first", K.clarifyPrompt("x", [], "fr").system.includes("in the language of the request; when the request does not reveal a language"), true);
	r.check("clarify prompt: names only, no content line without documents", K.clarifyPrompt("x", []).user.includes("ATTACHED"), false);

	/* ── THE FOLDER (2026-10-17): no "Generated" folder, the AI files each quiz ── */
	r.check("folder: a top-level folder name is read, trimmed and capped, beside the kind",
		[K.parseClarifyAnswer('{"kind":"learn","folder":"  XTI301 - Python "}'), K.parseClarifyAnswer(JSON.stringify({ folder: "x".repeat(150) })).folder.length],
		[{ ready: true, kind: "learn", folder: "XTI301 - Python" }, 100]);
	r.check("folder: a folder that is not a non-empty string is ignored",
		[K.parseClarifyAnswer('{"folder":42}'), K.parseClarifyAnswer('{"folder":"  "}')], [READY, READY]);
	const folderQ = { header: "Dossier", question: "Où ranger ce quiz ?", multiple: false, options: [o("Python", "nouveau"), o("XTI301 - Python", "existant")], default: 0, purpose: "folder" };
	const parsedFolder = K.parseClarifyAnswer(JSON.stringify({ kind: "learn", questions: [folderQ] }));
	r.check("folder: a single-choice \"which folder\" question keeps its purpose", parsedFolder.questions[0].purpose, "folder");
	r.check("folder: a multiple-choice one, or a second one, is an ordinary question",
		[K.parseClarifyAnswer(JSON.stringify({ questions: [{ ...folderQ, multiple: true }] })).questions[0].purpose,
			K.parseClarifyAnswer(JSON.stringify({ questions: [folderQ, folderQ] })).questions.map(x => x.purpose ?? null)],
		[undefined, ["folder", null]]);
	r.check("folder: the chosen option, a typed name, or the default when skipped",
		[K.folderFromClarifications([folderQ], [["XTI301 - Python"]]), K.folderFromClarifications([folderQ], [["  Réseaux  "]]), K.folderFromClarifications([folderQ], [[]])],
		["XTI301 - Python", "Réseaux", "Python"]);
	r.check("folder: no folder question, no folder", K.folderFromClarifications(qs, [["Débutant"], ["A"]]), null);
	const libre = K.clarifyPrompt("Quiz sur les listes", ["cm1.pdf"], "fr", { names: ["XTI301 - Python", "XTI303 - Archi"] });
	r.check("folder prompt: the learner's folders are listed, with the rule to name one or ask one \"folder\" question",
		[libre.user.includes("THE LEARNER'S FOLDERS (names only):\n- XTI301 - Python\n- XTI303 - Archi"), libre.system.includes("\"purpose\":\"folder\""), libre.system.includes("EXACT name as listed")],
		[true, true, true]);
	r.check("folder prompt: no folder yet says so", K.clarifyPrompt("x", [], "en", { names: [] }).user.includes("(none yet)"), true);
	const decide = K.clarifyPrompt("Quiz", ["cm1.pdf"], "en", { names: ["A"], decided: "XTI301 - Python" });
	r.check("folder prompt: a decided folder is named and never asked about; the names stay for a reply",
		[decide.system.includes("already decided (\"XTI301 - Python\")"), decide.system.includes("do NOT ask about the folder"), decide.system.includes("\"purpose\":\"folder\""), decide.system.includes("\"folder\":\"<optional"), decide.user.includes("- A")],
		[true, true, false, false, true]);
	const pc = K.clarifyPrompt("x", [], "en", { names: ["XTI302"], choose: false });
	r.check("folder prompt: a request sent to the PC chooses no folder, its names stay for a reply",
		[pc.system.includes("LEARNER'S FOLDERS"), pc.system.includes("\"purpose\":\"folder\""), pc.user.includes("- XTI302"), pc.user.includes("(none yet)")], [false, false, true, false]);
	r.check("folder prompt: without folder information, no folder rule at all",
		[K.clarifyPrompt("x", []).system.includes("LEARNER'S FOLDERS"), K.clarifyPrompt("x", []).user.includes("LEARNER'S FOLDERS")], [false, false]);
	r.done();
});
