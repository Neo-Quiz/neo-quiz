/**
 * THE RELAY (`src/dashboard/relay.ts`): the prompt shared to an AI app and the
 * answer pasted back. Prevents: a relay prompt that drifts from the PC's, a
 * pasted answer executed or polluting prototypes, a wrong or oversized paste
 * being saved, two quizzes silently merged.
 *     npm run check:relay
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/dashboard/relay.ts", "src/dashboard/ai-client.ts", "src/dashboard/ai-web.ts", "src/dashboard/generation-demande.ts"], (RL, AC, AW, GD) => {
	const r = makeReporter("Relay");
	const doc = { name: "cm1.md", content: "# Lists\nA list is ordered." };
	const input = { text: "Make a Learn on lists", mode: "learn", documents: [doc], count: 10 };
	const built = RL.buildRelayPrompt(input, "tok123abc9");

	// Parity with the PC: the same builders, byte for byte, for the same request.
	const msg = { text: input.text, notes: [{ ...doc, source: "vault" }], images: [] };
	const { source, prompt } = GD.composerDemande(msg);
	const pc = AC.composerPrompts(prompt, { count: 10, type: undefined, source, mode: "learn" });
	r.check("the relay text is the web channel's text of the PC's prompts", built.text, AW.texteWeb(pc, "tok123abc9"));
	r.check("the PC's system prompt is inside the relay text", built.text.includes(pc.systemPrompt.split("\n")[0]), true);
	r.check("the documents' content travels in the prompt", built.text.includes("A list is ordered."), true);
	r.check("the token is in the instruction", built.text.includes("tok123abc9"), true);
	r.check("a Test is chosen only when the words say so", [RL.buildRelayPrompt({ ...input, mode: undefined, text: "Make a test on lists" }).mode, RL.buildRelayPrompt({ ...input, mode: undefined, text: "teach me lists" }).mode, RL.buildRelayPrompt({ ...input, mode: undefined, text: "lists" }).mode], ["practice", "learn", "learn"]);
	r.check("a fresh token each time when none is given", RL.buildRelayPrompt(input).token !== RL.buildRelayPrompt(input).token, true);

	const q = (n) => `{ prompt: "Q${n}", options: ["a","b"], correctIndex: 0, explain: "because" }`;
	const quiz = `[ ${q(1)}, ${q(2)} ]`;
	const ok = (t, m = "practice", tok) => RL.extractQuizAnswer(t, m, tok);
	r.check("a quiz-blocks fence inside prose", ok("Here you go:\n```quiz-blocks\n" + quiz + "\n```\nEnjoy").ok, true);
	r.check("a json5 fence with the token comment", ok("```json5\n// neo-quiz tok123abc9\n" + quiz + "\n```", "practice", "tok123abc9").ok, true);
	r.check("a json fence with the token comment", ok("```json\n// neo-quiz tok123abc9\n" + quiz + "\n```", "practice", "tok123abc9").ok, true);
	r.check("a bare array with no fence", ok(quiz).ok, true);
	r.check("prose then a bare array", ok("Sure!\n" + quiz).ok, true);
	r.check("the questions are returned", ok("```quiz-blocks\n" + quiz + "\n```").questions.length, 2);
	r.check("two quiz-blocks fences are refused, nothing guessed", ok("```quiz-blocks\n" + quiz + "\n```\n```quiz-blocks\n" + quiz + "\n```").reason, "several");
	r.check("two token fences are refused", ok("```json5\n// neo-quiz tok123abc9\n" + quiz + "\n```\n```json5\n// neo-quiz tok123abc9\n" + quiz + "\n```", "practice", "tok123abc9").reason, "several");
	r.check("a quiz-blocks fence and a token fence are two candidates", ok("```quiz-blocks\n" + quiz + "\n```\n```json5\n// neo-quiz tok123abc9\n" + quiz + "\n```", "practice", "tok123abc9").reason, "several");
	r.check("nothing quiz-like", ok("I cannot help with that.").reason, "none");
	r.check("prose with brackets is not a quiz", ok("See [1] and [2].").ok, false);
	r.check("empty paste", [ok("").reason, ok("  \n").reason], ["empty", "empty"]);
	r.check("an oversized paste is refused before parsing", ok("x".repeat(RL.MAX_ANSWER_CHARS + 1)).reason, "too-large");
	r.check("exactly the bound is read", ok(" ".repeat(RL.MAX_ANSWER_CHARS - quiz.length) + quiz).ok, true);
	r.check("an answer carrying ANOTHER request's token is refused", ok("```json5\n// neo-quiz otherothe1\n" + quiz + "\n```", "practice", "tok123abc9").reason, "other-request");
	r.check("the right token is accepted", ok("```json5\n// neo-quiz tok123abc9\n" + quiz + "\n```", "practice", "tok123abc9").ok, true);
	r.check("an answer with no token at all is accepted as a bare array", ok("```json5\n" + quiz + "\n```", "practice", "tok123abc9").ok, true);
	const bad = ok("```quiz-blocks\n[ { prompt: 'a', options: [ }\n```");
	r.check("malformed JSON that looks like a quiz is invalid, with the parser's position", [bad.reason, typeof bad.detail], ["invalid", "string"]);
	r.check("an empty array has no questions", ok("```quiz-blocks\n[]\n```").reason, "no-questions");
	r.check("an array of non-objects has no questions", ok("```quiz-blocks\n[1,2,3]\n```").reason, "no-questions");
	const learn = ok("```quiz-blocks\n" + quiz + "\n```", "learn");
	r.check("a Learn answer with no objectives fails the format check, naming what is missing", [learn.reason, String(learn.detail).includes("sansObjectifs")], ["format", true]);
	const noExplain = ok("```quiz-blocks\n[ { prompt: 'Q', options: ['a','b'], correctIndex: 0 } ]\n```");
	r.check("a Test answer with no explanation fails the format check", [noExplain.reason, String(noExplain.detail).includes("sansExplication")], ["format", true]);

	// HTML: kept as data (legitimate keys), sanitised at render by the four doors; never executed here.
	const withHtml = `[ { prompt: "Q", options: ["a","b"], correctIndex: 0, explainHtml: "<img src=x onerror=alert(1)>", promptHtml: "<script>1</script>" } ]`;
	const res = ok("```quiz-blocks\n" + withHtml + "\n```");
	r.check("an answer whose only explanation is explainHtml is accepted, the key kept", [res.ok, res.questions?.[0]?.explainHtml], [true, "<img src=x onerror=alert(1)>"]);
	r.check("an inline <script> in a text field is kept as text", JSON.stringify(ok("```quiz-blocks\n[ { prompt: \"<script>1</script>\", options: [\"a\",\"b\"], correctIndex: 0, explain: \"x\" } ]\n```").questions).includes("<script>"), true);

	// Prototype pollution
	const pol = ok("```quiz-blocks\n[ { prompt: 'Q', options: ['a','b'], correctIndex: 0, explain: 'x', \"__proto__\": { \"polluted\": true }, \"constructor\": { \"prototype\": { \"polluted\": true } } } ]\n```");
	r.check("no own __proto__ key and nothing polluted", [pol.ok, Object.hasOwn(pol.questions[0], "__proto__"), Object.hasOwn(pol.questions[0], "constructor"), ({}).polluted, Object.prototype.polluted], [true, false, false, undefined, undefined]);

	// Hostile shapes
	r.check("NaN is refused", ok("```quiz-blocks\n[ { prompt: 'Q', options: ['a','b'], correctIndex: NaN, explain: 'x' } ]\n```").reason, "invalid");
	r.check("Infinity is refused", ok("```quiz-blocks\n[ { prompt: 'Q', options: ['a','b'], correctIndex: 0, explain: 'x', n: -Infinity } ]\n```").reason, "invalid");
	const dr = ok("[".repeat(50000) + "]".repeat(50000));
	r.check("deep nesting never throws and is not a quiz", [typeof dr.ok, dr.ok], ["boolean", false]);
	r.check("a nested fence inside a string does not crash", typeof ok("```quiz-blocks\n[ { prompt: 'a ``` b', options: ['a','b'], correctIndex: 0, explain: 'x' } ]\n```").ok, "boolean");
	r.check("a code expression is data, never run", ok("```quiz-blocks\n[ { prompt: (()=>1)(), options: ['a'] } ]\n```").ok, false);
	r.done();
});
