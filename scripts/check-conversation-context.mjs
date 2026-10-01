/**
 * THE CONVERSATION CONTEXT of a follow-up message (`src/dashboard/
 * conversation-context.ts`, `composerDemande`): a follow-up such as "make it
 * multiple choice" reached the model as the bare sentence (2026-10-02). It
 * must carry the earlier requests, the documents and the quizzes produced.
 *
 *     npm run check:conversation-context
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/conversation-context.ts", (C) => {
	const r = makeReporter("Conversation context");
	r.check("nothing before: no context", C.contexteConversation([]), "");
	const tours = [{
		text: "Generate quizzes from the 3 PDFs, 20 questions each",
		notes: [{ name: "CM1.pdf", content: "x" }, { name: "CM2.pdf", content: "y" }],
		quizzes: [{ title: "CM1 - Intro", questions: [{ prompt: "What is Python?" }, { prompt: "What is a list?" }] }],
	}, {
		text: "again", notes: [{ name: "CM2.pdf", content: "y2" }], quizzes: [],
	}];
	const c = C.contexteConversation(tours);
	r.check("earlier request, documents, quiz title and questions all travel",
		[c.includes("3 PDFs, 20 questions each"), c.includes("CM1.pdf, CM2.pdf"), c.includes("\"CM1 - Intro\" (2 questions)"), c.includes("- What is a list?")],
		[true, true, true, true]);
	r.check("documents inherited once by name, the latest content wins",
		C.documentsHeritiers(tours).map(n => n.name + ":" + n.content), ["CM1.pdf:x", "CM2.pdf:y2"]);
	const long = C.contexteConversation([{ text: "t", notes: [], quizzes: [{ questions: Array.from({ length: 50 }, (_, i) => ({ prompt: "q" + i })) }] }]);
	r.check("a long quiz is summarised, not dumped", [long.includes("- q11"), long.includes("- q12"), long.includes("(38 more)")], [true, false, true]);
	r.done();
});

await withSrcModule("src/dashboard/generation-demande.ts", (D) => {
	const r = makeReporter("Follow-up request prompt");
	const base = { text: "make it multiple choice", notes: [{ name: "CM1.pdf", content: "COURSE" }], images: [] };
	r.check("without context the prompt is unchanged", D.composerDemande(base).prompt.startsWith("make it multiple choice"), true);
	const p = D.composerDemande({ ...base, contexte: "CONVERSATION SO FAR: earlier" }).prompt;
	r.check("with context: it comes first, then the new request and the document",
		[p.startsWith("CONVERSATION SO FAR: earlier"), p.includes("NEW REQUEST:\nmake it multiple choice"), p.includes("COURSE")], [true, true, true]);
	r.done();
});
