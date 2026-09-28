/**
 * The PURE rules of code execution (src/code-languages.ts): which block
 * languages run, which question is a program-output question, when
 * `runInLastHint` is valid, and when ▶ shows on a block.
 *
 *     npm run check:code-languages
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/code-languages.ts", (m) => {
	const r = makeReporter("Code languages");
	r.check("aliases", ["python", "Py", "c", "C++", "cpp", "cc", "cxx", "h", "hpp", "bash", "java", ""].map(m.langageDeBloc),
		["python", "python", "c", "cpp", "cpp", "cpp", "cpp", "c", "cpp", null, null, null]);

	const txt = (o) => ({ type: "text", prompt: "Q", ...o });
	r.check("program output: python variant", m.isProgramOutputQuestion(txt({ terminalVariant: "python" })), true);
	r.check("program output: c++ variant", m.isProgramOutputQuestion(txt({ terminalVariant: "cpp" })), true);
	r.check("a shell is a command, not a program output", m.isProgramOutputQuestion(txt({ terminalVariant: "bash" })), false);
	r.check("command: true is cmd", m.isProgramOutputQuestion(txt({ command: true })), false);
	r.check("plain text question", m.isProgramOutputQuestion(txt({})), false);
	r.check("not a text question", m.isProgramOutputQuestion({ prompt: "Q", options: ["a"], terminalVariant: "python" }), false);
	r.check("legacy text marker with python variant", m.isProgramOutputQuestion({ text: true, prompt: "Q", terminalVariant: "python" }), true);

	r.check("blocks of a statement", m.blocsExecutablesDe("Voici :\n\n```c\nint x;\n```\n\n```bash\nls\n```\n\n```python\nx=1\n```"), ["c", "python"]);
	r.check("no fenced block", m.blocsExecutablesDe("`x = 1` inline only"), []);

	const hard = (o) => ({ prompt: "Trouve le bug.\n\n```cpp\nint main(){}\n```", options: ["a", "b"], correctIndex: 0, hint: ["un", "deux"], runInLastHint: true, ...o });
	r.check("valid", m.runInLastHintProbleme(hard({})), null);
	r.check("valid in python too", m.runInLastHintProbleme(hard({ prompt: "Bug ?\n\n```python\nx=1\n```" })), null);
	r.check("no runnable block", m.runInLastHintProbleme(hard({ prompt: "Bug ?\n\n```java\nclass A{}\n```" })), "noRunnableBlock");
	r.check("one hint level", m.runInLastHintProbleme(hard({ hint: "un seul" })), "notEnoughHintLevels");
	r.check("program output question", m.runInLastHintProbleme({ ...hard({}), options: undefined, correctIndex: undefined, type: "text", terminalVariant: "cpp", acceptedAnswers: ["3"] }), "programOutput");

	const v = (o) => m.executionVisible({ inStatement: false, reading: false, corrected: false, runInLastHint: false, allHintLevelsSeen: false, ...o });
	r.check("explanation or hint: visible", v({}), true);
	r.check("statement before correction: hidden", v({ inStatement: true }), false);
	r.check("statement after correction: visible", v({ inStatement: true, corrected: true }), true);
	r.check("reading: visible", v({ inStatement: true, reading: true }), true);
	r.check("runInLastHint, last level not seen: hidden", v({ inStatement: true, runInLastHint: true }), false);
	r.check("runInLastHint, all levels seen: visible", v({ inStatement: true, runInLastHint: true, allHintLevelsSeen: true }), true);
	r.check("all levels seen WITHOUT runInLastHint: hidden", v({ inStatement: true, allHintLevelsSeen: true }), false);
	r.done();
});
