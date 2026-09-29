/**
 * THE "EXPLAIN" PROMPT OF A QUESTION (`src/explain-prompt.ts`), on the real code.
 *
 * What it prevents: a question sent to Claude Code or Codex without its
 * choices or its expected answer (the model would explain the wrong thing),
 * a placeholder left raw in the message ("{myAnswer}"), a dangling
 * "My answer:" line when nothing was answered, and a cloze sent without the
 * words its blanks expect.
 *
 *     npm run check:explain
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/explain-prompt.ts", ({ remplirPromptExplication, reponseAttendue }) => {
	const r = makeReporter("Explain prompt of a question");
	const tpl = "Quiz: {quiz}\nQuestion: {question}\n{options}\nAnswer: {answer}\nMine: {myAnswer}\nWhy: {explanation}\n{unknown}";

	const single = { title: "Division", prompt: "What is `7 // 2`?", options: ["3.5", "3", "4"], correctIndex: 1, explain: "Floor division." };
	const out = remplirPromptExplication(tpl, single, { quiz: "CM1", myAnswer: "A. 3.5" });
	r.check("single choice: title, statement, lettered choices, answer, mine, explanation",
		out, "Quiz: CM1\nQuestion: Division\nWhat is `7 // 2`?\nA. 3.5\nB. 3\nC. 4\nAnswer: B. 3\nMine: A. 3.5\nWhy: Floor division.\n{unknown}");
	r.check("nothing answered: the \"Mine\" line is dropped, not left dangling",
		remplirPromptExplication(tpl, single, { quiz: "CM1" }).includes("Mine:"), false);
	r.check("shuffled options: the letters are those on screen",
		[remplirPromptExplication("{options}|{answer}", single, { quiz: "", ordre: [2, 0, 1] }),
			remplirPromptExplication("{options}|{answer}", single, { quiz: "", ordre: [0, 0, 1] })],
		["A. 4\nB. 3.5\nC. 3|C. 3", "A. 3.5\nB. 3\nC. 4|B. 3"]);
	r.check("no choices: the label line above them goes too",
		remplirPromptExplication("Q: {question}\n\nChoices:\n{options}\n\nAnswer: {answer}", { prompt: "Say hi", answer: "hi" }, { quiz: "" }),
		"Q: Say hi\n\nAnswer: hi");
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
	r.done();
});
