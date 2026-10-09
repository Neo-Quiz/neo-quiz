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

await withSrcModule("src/dashboard/transcript.ts", ({ createTranscriptDecoder, transcriptVide, appliquer, claudeResultDuFlux, quizProgress, tempsRestant, MAX_STEPS, resumeEntree }) => {
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
		[whole.started, whole.model, whole.thinking, whole.tools.map(s => s.name), whole.text, whole.done],
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
		line({ type: "item.started", item: { id: "item_1", type: "command_execution", command: "ls" } }),
		line({ type: "item.completed", item: { id: "item_1", type: "command_execution", command: "ls", exit_code: 0, aggregated_output: "a.md\nb.md\n" } }),
		line({ type: "item.completed", item: { type: "agent_message", text: "[ { id: 'q1' } ]" } }),
		line({ type: "turn.completed", usage: { input_tokens: 5 } }),
	].join("");
	const c = fold(createTranscriptDecoder("codex")(codex));
	r.check("codex: reasoning, command, answer and end",
		[c.started, c.thinking.trim(), c.tools.map(s => [s.name, s.input, s.status, s.count]), c.text, c.done],
		[true, "Reading the course.", [["Shell", "ls", "ok", 2]], "[ { id: 'q1' } ]", true]);

	/* THE AI'S WORK (2026-10-09): tool calls and their results, as Claude Code
	   2.1.296 streams them with read-only tools in a trusted folder (shapes
	   measured: `content_block_start` names the tool, the whole `assistant`
	   message carries its input, the `user` message its `tool_result`, and
	   `tool_result_meta` the permission decision). */
	const cwd = "C:\\Users\\x\\Cours";
	const outils = [
		line({ type: "system", subtype: "init", model: "claude-haiku-5-5", cwd }),
		line({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", id: "t1", name: "Glob", input: {} } } }),
		line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Glob", input: { pattern: "**/*.md" } }] } }),
		line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ch1.md\nch2.md\nannexe/ch3.md" }] }, tool_result_meta: [{ id: "t1", permission_decision: { decision: "accept" } }] }),
		line({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", id: "t2", name: "Read", input: {} } } }),
		line({ type: "assistant", message: { content: [{ type: "text", text: "I read it." }, { type: "tool_use", id: "t2", name: "Read", input: { file_path: "C:/Users/x/Cours/ch1.md" } }] } }),
		line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "1\tLa pile\n2\test LIFO\n3\t" }] } }),
		line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t3", name: "Grep", input: { pattern: "LIFO", path: "C:\\Users\\x\\Cours\\annexe" } }] } }),
		line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t3", content: "Found 2 files\nch1.md\nannexe/ch3.md" }] } }),
		line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t4", name: "Read", input: { file_path: "C:\\Users\\x\\.ssh\\id_rsa" } }] } }),
		line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t4", is_error: true, content: "C:\\Users\\x\\.ssh\\id_rsa is outside C:\\Users\\x\\Cours; --restricted confines the file tools to the working directory." }] }, tool_result_meta: [{ id: "t4", non_execution_kind: "permission-rule", permission_decision: { decision: "reject" } }] }),
		line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t5", name: "Write", input: { file_path: "C:/Users/x/Cours/hello.txt", content: "hi" } }] } }),
		line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t5", is_error: true, content: "<tool_use_error>Error: No such tool available: Write. Write is disabled for this session, in subagents as well as here.</tool_use_error>" }] } }),
		line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t6", name: "Read", input: { file_path: "C:/Users/x/Cours/absent.md" } }] } }),
		line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t6", is_error: true, content: "File does not exist." }] } }),
		line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t7", name: "Read", input: { file_path: "C:/Users/x/Cours/fig.png" } }] } }),
		line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t7", content: [{ type: "image", source: { type: "base64", data: "iVBOR" } }] }] } }),
		line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t8", name: "Read", input: { file_path: "C:/Users/x/Cours/ch2.md" } }] } }),
		line({ type: "result", subtype: "success", is_error: false, result: "[]", permission_denials: [{ tool_name: "Read", tool_use_id: "t8" }] }),
	].join("");
	const vu = (tr) => tr.tools.map(s => [s.name, s.input, s.status, s.count ?? null, s.unit ?? null]);
	const attendu = [
		["Glob", "**/*.md", "ok", 3, "files"],
		["Read", "ch1.md", "ok", 2, "lines"],
		["Grep", "LIFO, in annexe", "ok", 2, "files"],
		["Read", "C:/Users/x/.ssh/id_rsa", "refused", null, null],
		["Write", "hello.txt", "refused", null, null],
		["Read", "absent.md", "error", null, null],
		["Read", "fig.png", "ok", null, "image"],
		["Read", "ch2.md", "refused", null, null],
	];
	const travail = fold(createTranscriptDecoder("claude")(outils));
	r.check("tools: each call is ONE step (start, then input), paths relative to the CLI's folder, results summed up", vu(travail), attendu);
	r.check("tools: the text of a whole assistant message is not taken twice (the partial chunks carry it)", travail.text, "");
	r.check("tools: a refusal keeps the CLI's first line, an image or a tool the session lacks is told apart",
		[travail.tools[3].detail?.includes("--restricted confines"), travail.tools[4].detail?.startsWith("Error: No such tool available: Write"), travail.tools[5].detail], [true, true, "File does not exist."]);
	for (const size of [5, 1]) {
		const dec = createTranscriptDecoder("claude");
		const evs = [];
		for (let i = 0; i < outils.length; i += size) evs.push(...dec(outils.slice(i, i + size)));
		r.check(`tools: a stream cut every ${size} characters gives the same steps`, vu(fold(evs)), attendu);
	}
	// A refusal is never turned back into a plain error or a success by a later event.
	const ref = fold([{ kind: "tool", name: "Read", id: "a" }, { kind: "toolResult", id: "a", status: "refused", detail: "denied" }, { kind: "toolResult", id: "a", status: "ok", count: 3, unit: "lines" }]);
	r.check("tools: refused stays refused", ref.tools[0].status, "refused");
	// A result for a call never seen changes nothing.
	r.check("tools: a result for an unknown call is ignored", fold([{ kind: "toolResult", id: "zz", status: "ok", count: 1 }]).tools.length, 0);
	// BOUNDED: a stream of endless tool calls keeps MAX_STEPS steps and counts the rest; inputs are cut.
	const flot = transcriptVide();
	for (let i = 0; i < MAX_STEPS + 50; i++) appliquer(flot, { kind: "tool", name: "Read", id: "id" + i, input: "x".repeat(5000) });
	r.check("tools: at most MAX_STEPS steps kept, the rest counted, each input bounded",
		[flot.tools.length, flot.toolsHidden, flot.tools.every(s => s.input.length <= 240)], [MAX_STEPS, 50, true]);
	r.check("tools: a tool_result with a broken shape (no id, content an object) breaks nothing",
		fold(createTranscriptDecoder("claude")(line({ type: "user", message: { content: [{ type: "tool_result", content: { x: 1 } }, "str", null] } }) + line({ type: "user", message: "nope" }))).tools.length, 0);
	r.check("tools: the summary of an input never shows more than the key field (Read: the path, no content)",
		[resumeEntree("Read", { file_path: "C:/a/b.md", offset: 3 }, "C:/a"), resumeEntree("Write", { file_path: "/x/y", content: "SECRET" }, ""), resumeEntree("Bash", { command: "rm  -rf\n/" }, "")], ["b.md", "/x/y", "rm -rf /"]);

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

	/* PRIVATE reasoning (Claude Code + Opus 5.5, measured 2026-10-08): empty
	   `thinking_delta`s and a running `system`/`thinking_tokens` estimate. The
	   size is kept, never decreasing; an empty delta adds no text; a bad
	   estimate is ignored. */
	const prive = [
		line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "", estimated_tokens: 50 } } }),
		line({ type: "system", subtype: "thinking_tokens", estimated_tokens: 50, estimated_tokens_delta: 50 }),
		line({ type: "system", subtype: "thinking_tokens", estimated_tokens: 4250, estimated_tokens_delta: 4200 }),
		line({ type: "system", subtype: "thinking_tokens", estimated_tokens: "9999" }),
		line({ type: "system", subtype: "thinking_tokens", estimated_tokens: -3 }),
		line({ type: "system", subtype: "thinking_tokens", estimated_tokens: 100 }),
	].join("");
	const p = fold(createTranscriptDecoder("claude")(prive));
	r.check("claude: private reasoning keeps its size, no text, never backwards", [p.thinking, p.thinkingTokens, p.started], ["", 4250, true]);
	r.check("a fresh transcript has no reasoning size", transcriptVide().thinkingTokens, 0);
	// What the model read: fresh input + cache, from message_start's usage.
	const lu = fold(createTranscriptDecoder("claude")(line({ type: "stream_event", event: { type: "message_start", message: { usage: { input_tokens: 2, cache_creation_input_tokens: 180000, cache_read_input_tokens: 2141 } } } })));
	r.check("claude: the input read is fresh input plus cache", lu.inputTokens, 182143);
	r.check("claude: a message_start without usage adds nothing", fold(createTranscriptDecoder("claude")(line({ type: "stream_event", event: { type: "message_start", message: {} } }))).inputTokens, 0);
	// The first character of the answer starts the writing clock, once.
	const w = transcriptVide();
	appliquer(w, { kind: "text", text: "" }, 5);
	appliquer(w, { kind: "text", text: "[" }, 10);
	appliquer(w, { kind: "text", text: "{" }, 99);
	r.check("writingSince: the first non-empty text, never moved", w.writingSince, 10);
	// The time left: from the finished questions' pace, only once two are done.
	r.check("time left: none before two finished questions, nor without a total, nor past it",
		[tempsRestant(2, 10, 0, 60_000), tempsRestant(5, undefined, 0, 60_000), tempsRestant(12, 10, 0, 60_000), tempsRestant(5, 10, undefined, 60_000)], [null, null, null, null]);
	r.check("time left: 4 done in 2 min, 6 to go = 3 min", tempsRestant(5, 10, 0, 120_000), 180_000);
	r.done();
});
