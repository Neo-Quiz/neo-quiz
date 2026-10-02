/**
 * THE LIVE TRANSCRIPT OF A GENERATION (`src/dashboard/transcript.ts`), on the
 * real code.
 *
 * What it prevents: a Claude Code or Codex line cut in two by the pipe lost
 * or read twice; a partial text chunk dropped, so the answer shown differs
 * from the one written; a non-JSON line (a warning) breaking the stream; a
 * runaway stream growing without end; and the final `result` of a
 * `stream-json` output not found, which would fail every Claude generation.
 *
 *     npm run check:transcript
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/transcript.ts", ({ createTranscriptDecoder, transcriptVide, appliquer, claudeResultDuFlux, quizProgress }) => {
	const r = makeReporter("Transcript of a generation");
	const line = (o) => JSON.stringify(o) + "\n";
	const fold = (events) => events.reduce((t, e) => appliquer(t, e), transcriptVide());

	// Claude Code, stream-json with partial messages (shape measured on the CLI, 2026-09-29).
	const claude = [
		line({ type: "system", subtype: "init", model: "claude-opus-5-5" }),
		line({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "thinking" } } }),
		line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Let me plan " } } }),
		line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "the slices." } } }),
		line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "signature_delta", signature: "xyz" } } }),
		"a warning that is not JSON\n",
		line({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Read" } } }),
		line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "[\n\t{ id: " } } }),
		line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "'q1' }\n]" } } }),
		line({ type: "assistant", message: {} }),
		line({ type: "result", subtype: "success", is_error: false, result: "[\n\t{ id: 'q1' }\n]", usage: { input_tokens: 3 } }),
	].join("");

	const whole = fold(createTranscriptDecoder("claude")(claude));
	r.check("claude: model, reasoning, tool, answer and end, in order",
		[whole.started, whole.model, whole.thinking, whole.tools, whole.text, whole.done],
		[true, "claude-opus-5-5", "Let me plan the slices.", ["Read"], "[\n\t{ id: 'q1' }\n]", true]);

	// The same stream, cut every 7 characters, then byte by byte: same transcript.
	for (const size of [7, 1]) {
		const dec = createTranscriptDecoder("claude");
		const events = [];
		for (let i = 0; i < claude.length; i += size) events.push(...dec(claude.slice(i, i + size)));
		const t = fold(events);
		r.check(`claude: a stream cut every ${size} characters gives the same transcript`, [t.thinking, t.text, t.tools, t.done], [whole.thinking, whole.text, whole.tools, true]);
	}

	r.check("claude: the final result is found, even with lines after it",
		claudeResultDuFlux(claude + "\n\n")?.result, "[\n\t{ id: 'q1' }\n]");
	r.check("claude: no result line, no result (the CLI stopped before answering)",
		claudeResultDuFlux(line({ type: "system", subtype: "init" }) + "garbage"), null);

	// Codex, exec --json.
	const codex = [
		line({ type: "thread.started", thread_id: "t1" }),
		line({ type: "item.completed", item: { type: "reasoning", text: "Reading the course." } }),
		line({ type: "item.started", item: { type: "command_execution", command: "ls" } }),
		line({ type: "item.completed", item: { type: "command_execution", command: "ls" } }),
		line({ type: "item.completed", item: { type: "agent_message", text: "[ { id: 'q1' } ]" } }),
		line({ type: "turn.completed", usage: { input_tokens: 5 } }),
	].join("");
	const c = fold(createTranscriptDecoder("codex")(codex));
	r.check("codex: reasoning, command, answer and end",
		[c.started, c.thinking.trim(), c.tools, c.text, c.done],
		[true, "Reading the course.", ["ls"], "[ { id: 'q1' } ]", true]);

	// A runaway stream keeps its END, bounded.
	const t = transcriptVide();
	for (let i = 0; i < 30; i++) appliquer(t, { kind: "text", text: "x".repeat(10_000) + i });
	r.check("a runaway stream is bounded and keeps its end", [t.text.length <= 200_000, t.text.endsWith("29")], [true, true]);

	// PROGRESS: which question the model is at, read off partial JSON5.
	const qp = (text, batch = false) => quizProgress(text, { batch });
	r.check("progress: nothing written yet", qp(""), { quiz: null, question: 0 });
	r.check("progress: prose with an apostrophe before the array is skipped", qp("Here's the quiz:\n[\n{ prompt: 'a' }").question, 1);
	r.check("progress: unquoted keys, cut mid-object",
		qp("[\n{ type: 'single', prompt: 'A?', options: ['x', 'y'], correctIndex: 0 },\n{ type: 'single', prompt: 'B?', opt").question, 2);
	r.check("progress: quoted keys, double and single quotes",
		qp(`[{"prompt": "A", "options": ["x"]}, {'prompt': 'B'}, {"prompt"`).question, 2);
	r.check("progress: a prompt key cut before its colon is not counted yet", qp("[{ prompt: 'A' }, { prompt").question, 1);
	r.check("progress: a cut string value does not break the count", qp("[{ prompt: 'A' }, { prompt: 'B is it").question, 2);
	r.check("progress: the word prompt inside a string value does not count",
		qp(`[{ prompt: 'A', explain: 'the prompt: is shown', "hint": "prompt: x" }, { prompt: 'B' }]`).question, 2);
	r.check("progress: a string 'prompt' in an array is a value, not a key", qp("[{ prompt: 'A', tags: ['x', 'prompt', 'y'] }]").question, 1);
	r.check("progress: a reading after its prompt is not a question",
		qp("[{ prompt: 'A' }, { prompt: 'Read this', role: 'read' }, { prompt: 'B' }]").question, 2);
	r.check("progress: a reading before its prompt is not a question",
		qp(`[{ role: "read", prompt: 'Read this' }, { prompt: 'B' }, { prompt: 'C' }`).question, 2);
	r.check("progress: a reading cut right after its prompt counts until its role arrives",
		[qp("[{ prompt: 'A' }, { prompt: 'R'").question, qp("[{ prompt: 'A' }, { prompt: 'R', role: 'read'").question], [2, 1]);
	r.check("progress: the final configuration object adds nothing",
		qp("[{ prompt: 'A' }, { prompt: 'B' }, { mode: 'exam', glossary: [{ term: 'x', definition: 'prompt' }] }]").question, 2);
	r.check("progress: comments with quotes are skipped", qp("[ // it's here\n{ prompt: 'A' }, /* don't */ { prompt: 'B' }").question, 2);
	const lot = "[{ document: 'a.md', title: 'A', quiz: [{ prompt: '1' }, { prompt: '2' }] }, { document: 'b.md', title: 'B', quiz: [{ prompt: '1' }] }, { document: 'c.md', title: 'C', quiz: [{ prompt: '1' }, { prompt: '2' }, { prompt: '3'";
	r.check("progress: a lot of 3 documents, third quiz at question 3", qp(lot, true), { quiz: 3, question: 3 });
	r.check("progress: a lot cut inside the first document", qp("[{ document: 'a.md', title: 'A', quiz: [{ prompt: '1' }, { prompt: '2'", true), { quiz: 1, question: 2 });
	r.check("progress: a `document` key is ignored outside a lot", qp("[{ document: 'x', prompt: 'A' }, { prompt: 'B' }]"), { quiz: null, question: 2 });

	r.done();
});
