/**
 * THE FULL AI WORK THREAD of a live session (`src/dashboard/live-thread.ts`),
 * on the real code and on the recorded CLI lines.
 *
 * What it prevents: a tool output kept whole (a 10 000-line `cat` would sit in
 * memory and in the DOM); a Bash command cut short so the user cannot see what
 * ran; an Edit shown without its diff; a permission left "pending" after it
 * was answered; a reducer that dies on one odd line and drops the whole
 * thread; an interrupted or truncated run that looks complete.
 *
 *     npm run check:live-thread
 */
import { readFileSync } from "node:fs";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const fixture = (nom) =>
	readFileSync(new URL("./fixtures/live/" + nom, import.meta.url), "utf8")
		.split("\n")
		.filter((l) => l.trim() !== "")
		.map((l) => JSON.parse(l));

await withSrcModule("src/dashboard/live-thread.ts", ({ PREVIEW_LINES, emptyThread, applyLive, threadFromRun, addUserMessage, answerPermission }) => {
	const r = makeReporter("Full AI work thread");
	const out = (l) => ({ dir: "out", l });
	const inn = (l) => ({ dir: "in", l });
	const run = (events, extra = {}) => ({ events, interrupted: false, truncated: false, ...extra });
	const kinds = (t) => t.items.map((i) => i.kind);
	const noThinking = (t) => t.items.filter((i) => i.kind !== "thinking");
	const toolOf = (t, id) => t.items.find((i) => i.kind === "tool" && i.id === id);

	// --- Claude Code, the recorded session (declined Bash command) -----------
	const claudeEvents = fixture("claude-session.jsonl");
	const claude = threadFromRun(run(claudeEvents));
	r.check("claude fixture: user, Bash tool, its permission, then the answer, in order",
		noThinking(claude).map((i) => i.kind), ["user", "tool", "permission", "text"]);
	r.check("claude fixture: the user line is the one written by the app",
		claude.items[0], { kind: "user", text: "Run the shell command: echo hi > probe.txt (use the Bash tool). Do nothing else." });
	const bash = claude.items.find((i) => i.kind === "tool");
	r.check("claude fixture: Bash keeps its full command and a declined call is refused",
		[bash.name, bash.input, bash.status], ["Bash", "echo hi > probe.txt", "refused"]);
	r.check("claude fixture: the permission asked is answered by the deny line",
		claude.items.find((i) => i.kind === "permission"),
		{ kind: "permission", requestId: "56fe0c6d-3b5d-439a-91d0-f148d5de31b7", tool: "Bash", input: "echo hi > probe.txt", state: "denied" });
	r.check("claude fixture: the final answer is the complete text, not a partial delta",
		claude.items.at(-1), { kind: "text", text: "The command `echo hi > probe.txt` was declined, so probe.txt was not created. I did not run it again." });
	r.check("claude fixture: the replay is not running (the page tracks live state)", claude.running, false);

	// --- Codex, the recorded session (declined command, then a rejected one) --
	const codex = threadFromRun(run(fixture("codex-session.jsonl")));
	r.check("codex fixture: two turns, each with its user line, text, command and approval, in order",
		kinds(codex), ["user", "text", "user", "tool", "permission", "text", "user", "tool", "permission", "text"]);
	const cmd = codex.items.find((i) => i.kind === "tool");
	r.check("codex fixture: the command keeps the raw command and a declined one is refused",
		[cmd.name, cmd.input, cmd.status], ["commandExecution", "echo hi > probe.txt", "refused"]);
	r.check("codex fixture: an approval answered with decline is denied, one with accept is allowed",
		codex.items.filter((i) => i.kind === "permission").map((i) => i.state), ["denied", "allowed"]);
	r.check("codex fixture: a streamed answer is replaced by its completed text",
		codex.items[1], { kind: "text", text: "I can’t run `echo hi` here because the workspace is read-only and command execution requires approval." });

	// --- Tool outputs are never kept whole -----------------------------------
	const big = Array.from({ length: 10000 }, (_, i) => "row " + i).join("\n");
	const cmdLong = "Get-ChildItem -Recurse " + "x".repeat(300);
	const bigThread = threadFromRun(run([
		out({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: cmdLong } }] } }),
		out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: big, is_error: false }] } }),
	]));
	const big1 = toolOf(bigThread, "tu1");
	r.check("a 10 000-line output counts its lines and keeps the first 8 as preview",
		[big1.lines, big1.preview.split("\n").length, big1.preview.startsWith("row 0\nrow 1\n"), big1.status],
		[10000, PREVIEW_LINES, true, "ok"]);
	r.check("PREVIEW_LINES is 8", PREVIEW_LINES, 8);
	r.check("a Bash command is kept beyond 240 characters", big1.input, cmdLong);
	r.check("an array-form tool result counts its text blocks",
		threadFromRun(run([
			out({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu2", name: "Read", input: { file_path: "a.md" } }] } }),
			out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu2", content: [{ type: "text", text: "one\ntwo" }] }] } }),
		])).items[0],
		{ kind: "tool", id: "tu2", name: "Read", input: JSON.stringify({ file_path: "a.md" }, null, 2), preview: "one\ntwo", lines: 2, status: "ok", diff: null });

	// --- Diffs ---------------------------------------------------------------
	const diffOf = (name, input) => toolOf(threadFromRun(run([out({ type: "assistant", message: { content: [{ type: "tool_use", id: "d", name, input }] } })])), "d").diff;
	r.check("Edit gives its removed and added lines",
		diffOf("Edit", { file_path: "a.md", old_string: "one\ntwo", new_string: "three" }), { added: ["three"], removed: ["one", "two"] });
	r.check("MultiEdit gives every edit, in order",
		diffOf("MultiEdit", { file_path: "a.md", edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }] }),
		{ added: ["b", "d"], removed: ["a", "c"] });
	r.check("Write gives its content as added lines",
		diffOf("Write", { file_path: "a.md", content: "x\ny" }), { added: ["x", "y"], removed: [] });
	r.check("a tool that is not an edit has no diff", diffOf("Read", { file_path: "a.md" }), null);
	const codexDiff = threadFromRun(run([inn({ jsonrpc: "2.0", method: "initialized" }),
		out({ method: "item/completed", params: { item: { type: "fileChange", id: "f1", status: "completed", changes: [{ path: "a.md", kind: { type: "update" }, diff: "@@ -1 +1 @@\n-old\n+new\n" }] } } })]));
	r.check("a Codex fileChange gives the diff of its changes",
		toolOf(codexDiff, "f1")?.diff, { added: ["new"], removed: ["old"] });

	// --- Streams: thinking and text concatenate, a complete block replaces them --
	const streamed = threadFromRun(run([
		out({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "thinking" } } }),
		out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Let me " } } }),
		out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "plan." } } }),
		out({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "text" } } }),
		out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } } }),
		out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } } }),
		out({ type: "assistant", message: { content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Hello" }] } }),
	]));
	r.check("thinking deltas concatenate, and an empty complete thinking block keeps them",
		streamed.items[0], { kind: "thinking", text: "Let me plan." });
	r.check("text deltas concatenate into one text item", streamed.items[1], { kind: "text", text: "Hello" });

	// --- Permissions ---------------------------------------------------------
	const perm = threadFromRun(run([
		out({ type: "control_request", request_id: "p1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } }),
		inn({ type: "control_response", response: { subtype: "success", request_id: "p1", response: { behavior: "allow" } } }),
		out({ type: "control_request", request_id: "p2", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "pwd" } } }),
	]));
	r.check("a permission pending then answered with allow is allowed",
		perm.items.filter((i) => i.kind === "permission").map((i) => [i.requestId, i.state]),
		[["p1", "allowed"], ["p2", "pending"]]);
	const interrupted = threadFromRun(run([out({ type: "control_request", request_id: "p3", request: { subtype: "can_use_tool", tool_name: "Bash", input: {} } })], { interrupted: true }));
	r.check("a permission never answered in an interrupted run is gone, not pending",
		interrupted.items.find((i) => i.kind === "permission").state, "gone");

	// --- Notices -------------------------------------------------------------
	const notices = threadFromRun(run([
		out({ type: "system", subtype: "init" }),
		{ t: 1, meta: { spawn: { model: "m", effort: null, mode: "auto", resume: false } } },
		{ t: 2, meta: { spawn: { model: "m", effort: null, mode: "auto", resume: true } } },
		{ t: 3, meta: { threadId: "th" } },
	], { truncated: true, interrupted: true }));
	r.check("a second spawn is a resumed notice, the first is not, a threadId meta is silent",
		notices.items.filter((i) => i.kind === "notice").map((i) => i.text), ["resumed", "truncated", "interrupted"]);
	r.check("an interrupted run ends with its notice", notices.items.at(-1), { kind: "notice", text: "interrupted" });

	// --- Robustness ----------------------------------------------------------
	const hostile = new Proxy({}, { get() { throw new Error("boom"); } });
	const withGarbage = [...claudeEvents.slice(0, 40), { dir: "out", l: hostile }, { dir: "out", l: "not an object" }, { dir: "out", l: { type: "assistant", message: { content: 42 } } }, ...claudeEvents.slice(40)];
	r.check("a garbage line in the middle is skipped and the rest is kept",
		threadFromRun(run(withGarbage)).items, claude.items);

	// --- Live events ---------------------------------------------------------
	const live = emptyThread();
	r.check("an empty thread is empty and not running", [live.items, live.running], [[], false]);
	addUserMessage(live, "hello");
	r.check("sending a message adds the user item and starts the turn", [live.items, live.running], [[{ kind: "user", text: "hello" }], true]);
	applyLive(live, { kind: "line", runId: "r", line: { type: "stream_event", event: { type: "content_block_start", content_block: { type: "text" } } } });
	applyLive(live, { kind: "line", runId: "r", line: { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } } } });
	applyLive(live, { kind: "permission", runId: "r", requestId: "q1", tool: "Bash", input: { command: "ls" } });
	r.check("a live permission is pending, then gone when the CLI withdraws it",
		(applyLive(live, { kind: "permissionGone", runId: "r", requestId: "q1" }), live.items.at(-1)),
		{ kind: "permission", requestId: "q1", tool: "Bash", input: "ls", state: "gone" });
	r.check("a live text delta lands in the text item", live.items[1], { kind: "text", text: "Hi" });
	applyLive(live, { kind: "turnEnd", runId: "r" });
	r.check("a turn end stops the thread", live.running, false);
	const answered = emptyThread();
	applyLive(answered, { kind: "permission", runId: "r", requestId: "q2", tool: "Bash", input: {} });
	answerPermission(answered, "q2", true);
	r.check("a permission answered in the window is allowed", answered.items[0].state, "allowed");
	r.check("an unknown request answered changes nothing", (answerPermission(answered, "nope", false), answered.items[0].state), "allowed");
	applyLive(answered, { kind: "exit", runId: "r", code: 0, parked: true });
	r.check("an exit stops the thread", answered.running, false);
	r.check("applyLive returns the same thread it was given", applyLive(answered, { kind: "turnEnd", runId: "r" }) === answered, true);

	r.done();
});

/* ONE TURN of a live generation (2026-10-11, `live-turn.ts`,
   `live-turn-store.ts`): the end of a turn and its text read as the one-shot
   call read them (Claude `result`, Codex last agent message), the thread of
   one turn cut out of its run with its prompt left out, and the summary line
   computed from the full thread. */
await withSrcModule(["src/dashboard/live-turn.ts", "src/dashboard/live-turn-store.ts"], (T, S) => {
	const r = makeReporter("Live turn");
	const o = T.emptyOutcome();
	T.collectLine(o, { type: "assistant", message: { content: [{ type: "text", text: "x" }] } });
	r.check("a Claude turn is not over before its result", o.ended, false);
	const result = { type: "result", is_error: false, result: "[1]", usage: { input_tokens: 3 } };
	T.collectLine(o, result);
	r.check("a Claude result ends the turn and is kept whole", [o.ended, o.claudeResult], [true, result]);
	/* A message cut by the output limit (2026-10-18): the turn text is the whole chain, not the last message alone. */
	const k = T.emptyOutcome();
	const assistant = text => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
	[assistant("[ { a: 'very lo"), { type: "stream_event", event: { type: "message_delta", delta: { stop_reason: "max_tokens" } } }, assistant("ng' } ]"), { type: "result", result: "ng' } ]" }].forEach(l => T.collectLine(k, l));
	r.check("a cut Claude message: the turn result holds the head and the continuation", k.claudeResult?.result, "[ { a: 'very long' } ]");
	const c = T.emptyOutcome();
	T.collectLine(c, { method: "item/completed", params: { item: { type: "agentMessage", text: "first" } } });
	T.collectLine(c, { method: "item/completed", params: { item: { type: "agentMessage", text: "[quiz]" } } });
	T.collectLine(c, { method: "item/completed", params: { item: { type: "commandExecution", text: "ignored" } } });
	T.collectLine(c, { method: "error", params: { error: { message: "retrying" }, willRetry: true } });
	r.check("Codex: the last agent message is the answer, a retried error is not an error", [c.codexText, c.codexError, c.ended], ["[quiz]", null, false]);
	T.collectLine(c, { method: "turn/completed", params: { turn: { id: "t", status: "failed", error: { message: "usage limit reached" } } } });
	r.check("Codex: a failed turn ends with its message", [c.ended, c.codexError], [true, "usage limit reached"]);
	r.check("hostile lines change nothing", JSON.stringify(T.collectLine(T.emptyOutcome(), null)) + JSON.stringify(T.collectLine(T.emptyOutcome(), [1])), JSON.stringify(T.emptyOutcome()).repeat(2));
	r.check("the prompt line of a turn is told apart", [T.isPromptLine({ type: "user" }), T.isPromptLine({ method: "turn/start" }), T.isPromptLine({ type: "control_response" })], [true, true, false]);

	const ev = (seq, dir, l) => ({ t: seq, seq, dir, l });
	const user = (text) => ({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
	const events = [
		ev(0, "in", user("old prompt")), ev(1, "out", { type: "result", result: "old" }),
		ev(2, "in", user("THE PROMPT")),
		ev(3, "out", { type: "assistant", message: { content: [{ type: "tool_use", id: "tu", name: "Read", input: { file_path: "C:/Neo Quiz/cours/ch1.md" } }] } }),
		ev(4, "in", user("also add a question")),
		ev(5, "out", { type: "result", result: "[new]" }),
		ev(6, "in", user("next turn")),
	];
	const { thread, outcome } = S.turnFromStore({ events, truncated: false }, { runId: "r", fromSeq: 2, toSeq: 5 }, false);
	r.check("store: only the turn's own lines, its prompt left out, a message written meanwhile kept",
		thread.items.map(i => i.kind + ":" + (i.text ?? i.name)), ["tool:Read", "user:also add a question"]);
	r.check("store: the turn's own result", [outcome.ended, outcome.claudeResult.result], [true, "[new]"]);
	/* A message written during the turn and answered by its OWN result
	   (`--replay-user-messages` echoes it after the first result): the turn
	   is not over at the first result, and its end is the second. */
	const echo = (text) => ({ type: "user", message: { role: "user", content: [{ type: "text", text }] }, isReplay: true });
	const mid = T.emptyOutcome();
	T.collectLine(mid, echo("THE PROMPT"));
	T.collectLine(mid, { type: "result", result: "[first]" });
	T.collectLine(mid, echo("also add a question"));
	r.check("live: a message taken after the result reopens the turn", [mid.ended, mid.claudeResult.result], [false, "[first]"]);
	T.collectLine(mid, { type: "result", result: "[second]" });
	r.check("live: the turn ends on the result of that message", [mid.ended, mid.claudeResult.result], [true, "[second]"]);
	const queued = [
		ev(10, "in", user("THE PROMPT")), ev(11, "out", echo("THE PROMPT")),
		ev(12, "in", user("also add a question")),
		ev(13, "out", { type: "result", result: "[first]" }),
	];
	r.check("store: a message written and not taken yet keeps the turn running after a result",
		S.turnFromStore({ events: queued, truncated: false }, { runId: "r", fromSeq: 10, toSeq: null }, false).outcome.ended, false);
	const answered = [...queued, ev(14, "out", echo("also add a question")), ev(15, "out", { type: "result", result: "[second]" })];
	const back = S.turnFromStore({ events: answered, truncated: false }, { runId: "r", fromSeq: 10, toSeq: null }, false);
	r.check("store: once taken and answered, the turn ended with the second result, the echoes never shown",
		[back.outcome.ended, back.outcome.claudeResult.result, back.thread.items.map(i => i.kind + ":" + (i.text ?? ""))], [true, "[second]", ["user:also add a question"]]);
	r.check("store: a CLI that never echoes ends on its result", S.turnFromStore({ events: [queued[0], queued[2], queued[3]], truncated: false }, { runId: "r", fromSeq: 10, toSeq: null }, false).outcome.ended, true);
	const open = S.turnFromStore({ events, truncated: false }, { runId: "r", fromSeq: 6, toSeq: null }, true);
	r.check("store: a turn cut by a crash says so", [open.outcome.ended, open.thread.items.at(-1)], [false, { kind: "notice", text: "interrupted" }]);

	const tr = T.transcriptOfThread({ running: true, items: [
		{ kind: "thinking", text: "hmm" }, { kind: "text", text: "a" }, { kind: "text", text: "b" },
		{ kind: "tool", id: "1", name: "Read", input: JSON.stringify({ file_path: "cours/ch1.md" }, null, 2), preview: "", lines: 3, status: "ok", diff: null },
		{ kind: "tool", id: "2", name: "Bash", input: "ls -la\nsecond line", preview: "", lines: 0, status: "running", diff: null },
		{ kind: "tool", id: "3", name: "fileChange", input: "a.md\nb.md", preview: "", lines: 0, status: "refused", diff: null },
	] });
	r.check("summary: reasoning, text and every tool with its key input", [tr.thinking, tr.text, tr.tools.map(s => [s.name, s.input, s.status]), tr.started, tr.done],
		["hmm", "a\nb", [["Read", "cours/ch1.md", "ok"], ["Bash", "ls -la", "running"], ["fileChange", "a.md, b.md", "refused"]], true, false]);
	r.done();
});

/* STOP WAITS FOR THE END OF THE TURN (2026-10-11, `live-generation.ts`):
   Stop interrupts a live turn, but the turn's promise rejects (`aborted`),
   which frees the chat for the queue, only once the session says the turn
   ended (`turnEnd`, `exit`). Settled at once, the next request of the chat
   was sent into the dying turn: the interrupted turn's `result` ended the
   NEW request, and each later request took the result of the one before. A
   turn that never ends has its session closed after `STOP_GRACE_MS`. Driven
   with a fake `HostLive` and a fake clock for that one timer. */
await withSrcModule(["src/dashboard/live-generation.ts", "src/host/current.ts"], async (G, H) => {
	const r = makeReporter("Live Stop and the next request");
	const RUN = "00000000-0000-4000-8000-0000000000aa";
	const sent = [];
	const closed = [];
	let emit = () => {};
	let seq = 0;
	H.installHost({
		live: {
			start: async () => ({ runId: RUN }),
			send: async (runId, input) => { sent.push(input.kind === "message" ? "message:" + input.text : input.kind); },
			close: async (runId) => { closed.push(runId); },
			onEvent: (cb) => { emit = cb; return () => {}; },
			readRun: async () => null,
			toolOutput: async () => null,
			removeRuns: async () => {},
			storeSize: async () => 0,
		},
		paths: { defaultRoot: () => ({ id: "R", name: "Neo Quiz", deviceId: "pc" }), contractPath: (root, local) => root + "/" + local },
	});
	// The grace timer is the only `setTimeout` of a turn: caught, fired by hand.
	const realSetTimeout = globalThis.setTimeout;
	let grace = null;
	globalThis.setTimeout = (fn, ms, ...a) => (ms === G.STOP_GRACE_MS ? (grace = fn, 0) : realSetTimeout(fn, ms, ...a));
	const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((ok) => setImmediate(ok)); };
	const result = (text) => emit({ kind: "line", runId: RUN, seq: ++seq, line: { type: "result", subtype: "success", is_error: false, result: text } });
	const turnEnd = () => emit({ kind: "turnEnd", runId: RUN });
	const turn = (key, text) => {
		let stop = null;
		const settled = { value: "pending" };
		const p = G.runLiveTurn({ tool: "claude", chatId: "chat-1", model: "claude-haiku-5-5", mode: "full", text, images: [], key, abortable: (s) => { stop = s; } });
		p.then((o) => { settled.value = "result:" + o.claudeResult?.result; }, (e) => { settled.value = "error:" + e.name; });
		return { p, settled, stop: () => stop?.() };
	};
	try {
		const a = turn("k-a", "A");
		// As the queue does (`solder` then `pomper`): the chat's next request starts as soon as A's promise settles.
		let b = null;
		a.p.catch(() => { b = turn("k-b", "B"); });
		await flush();
		a.stop();
		await flush();
		r.check("Stop sends the interrupt, and the turn still holds the chat until it ends", [sent, a.settled.value, G.liveTurnRunning("k-a")], [["message:A", "interrupt"], "pending", false]);
		result("interrupted A");
		await flush();
		r.check("the interrupted turn's result does not end it before the session says so", a.settled.value, "pending");
		turnEnd();
		await flush();
		r.check("at turnEnd the stopped turn rejects as aborted (the queue frees the chat now)", a.settled.value, "error:aborted");
		r.check("the next request starts only now", [!!b, sent.at(-1)], [true, "message:B"]);
		result("quiz B");
		turnEnd();
		await flush();
		r.check("the next request gets its OWN result, not the stopped turn's", b?.settled.value, "result:quiz B");
		const c = turn("k-c", "C");
		await flush();
		c.stop();
		await flush();
		const before = [c.settled.value, closed.length, typeof grace];
		grace?.();
		await flush();
		r.check("a stopped turn that never ends: its session is closed after the grace, then it rejects as aborted",
			[...before, closed, c.settled.value], ["pending", 0, "function", [RUN], "error:aborted"]);
	} finally {
		globalThis.setTimeout = realSetTimeout;
		H.uninstallHost();
	}
	r.done();
});

/* THE AI WORK OF A RECORDED REQUEST (2026-10-11, `recordedTurn`): a chat
   reopened after a restart shows what the AI did, read back from the run
   store page by page (2000 events a page), cut to the request's own turn,
   its prompt left out; a deleted run gives nothing. Before this, the store
   was write-only for the user: no code read it back for a saved chat. */
await withSrcModule(["src/dashboard/live-generation.ts", "src/host/current.ts"], async (G, H) => {
	const r = makeReporter("Recorded AI work, read back");
	const RUN = "00000000-0000-4000-8000-0000000000bb";
	const user = (text) => ({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
	const events = [];
	for (let i = 0; i < 2500; i++) events.push({ t: i, seq: i, dir: "out", l: { type: "system", subtype: "status" } });
	events.push({ t: 1, seq: 2500, dir: "in", l: user("THE PROMPT") });
	events.push({ t: 1, seq: 2501, dir: "out", l: { type: "assistant", message: { content: [{ type: "tool_use", id: "tu", name: "Read", input: { file_path: "cours/ch1.md" } }] } } });
	events.push({ t: 1, seq: 2502, dir: "out", l: { type: "result", result: "[quiz]" } });
	events.push({ t: 1, seq: 2503, dir: "in", l: user("next request") });
	const pages = [];
	H.installHost({
		live: {
			readRun: async (runId, page) => {
				pages.push(page);
				if (runId !== RUN) return null;
				return { header: { runId }, events: events.slice(page.offset, page.offset + page.limit), interrupted: false, truncated: false, offset: page.offset, total: events.length, live: false };
			},
			toolOutput: async () => null,
		},
	});
	try {
		const thread = await G.recordedTurn({ runId: RUN, fromSeq: 2500, toSeq: 2502 });
		r.check("the request's own turn, read across store pages, its prompt left out",
			[thread?.items.map((i) => i.kind + ":" + (i.name ?? i.text)), pages.length, thread?.running], [["tool:Read"], 2, false]);
		r.check("a run deleted meanwhile gives nothing", await G.recordedTurn({ runId: "00000000-0000-4000-8000-0000000000cc", fromSeq: 0, toSeq: 3 }), null);
	} finally {
		H.uninstallHost();
	}
	H.installHost({});
	try {
		r.check("a host without a run store (the phone) gives nothing", await G.recordedTurn({ runId: RUN, fromSeq: 0, toSeq: 3 }), null);
	} finally {
		H.uninstallHost();
	}
	r.done();
});

/* THE DURATION OF A RECORDED TURN (2026-10-12, `recordedTurnMs`): a turn's
   bounds are the `seq` of its first and last line, and a dropped line leaves
   a gap in `seq`. A run page is addressed by INDEX, so reading the bounds as
   indexes returned the wrong events after a gap, and the label said "worked"
   with no time. Driven with a forged in-memory store shaped like the page the
   main process returns (`pageOf`): no run file is read. */
await withSrcModule(["src/dashboard/live-generation.ts", "src/host/current.ts"], async (G, H) => {
	const r = makeReporter("Recorded turn duration (seq and index)");
	const RUN = "00000000-0000-4000-8000-0000000000bb";
	const GONE = "00000000-0000-4000-8000-0000000000cc";
	let reads = 0;
	const forge = (events) => ({
		start: async () => ({ runId: RUN }),
		send: async () => {},
		close: async () => {},
		onEvent: () => () => {},
		readRun: async (runId, p = { offset: 0, limit: 2000 }) => {
			reads++;
			if (runId !== RUN) return null;
			return { header: {}, events: events.slice(p.offset, p.offset + p.limit), offset: p.offset, total: events.length, live: false, interrupted: false, truncated: false };
		},
		toolOutput: async () => null,
		removeRuns: async () => {},
		removeAllRuns: async () => {},
		storeSize: async () => 0,
	});
	// A run with two dropped lines: seq 3, 7 and 8 are missing, so index and seq differ after them.
	const trou = [0, 1, 2, 4, 5, 6, 9, 10].map(seq => ({ t: 1000 + seq * 100, seq, dir: "out", l: {} }));
	// A long run with a dropped line every five lines (seq = index + floor(index / 5)).
	const long = Array.from({ length: 200 }, (_, i) => ({ t: 10 * (i + Math.floor(i / 5)), seq: i + Math.floor(i / 5), dir: "out", l: {} }));
	const sansTrou = Array.from({ length: 40 }, (_, i) => ({ t: 10 * i, seq: i, dir: "out", l: {} }));
	const ms = (events, run) => { H.installHost({ live: forge(events), paths: {} }); reads = 0; return G.recordedTurnMs(run).then(v => [v, reads]); };
	try {
		const [avecTrou, lectures] = await ms(trou, { runId: RUN, fromSeq: 4, toSeq: 10 });
		r.check("a turn after a dropped line keeps its duration (seq 4 to seq 10 = 600 ms)", avecTrou, 600);
		r.check("the duration after a gap costs a few one-event reads, not the run", lectures <= 10, true);
		r.check("a turn with no gap: its duration from the index", await ms(sansTrou, { runId: RUN, fromSeq: 3, toSeq: 30 }).then(x => x[0]), 270);
		const debut = long[57].seq, fin = long[143].seq;
		r.check("a long run with gaps: a turn in its middle, read by seq", await ms(long, { runId: RUN, fromSeq: debut, toSeq: fin }).then(x => x[0]), (fin - debut) * 10);
		const [, bornes] = await ms(long, { runId: RUN, fromSeq: debut, toSeq: fin });
		r.check("a long run: bisection reads stay logarithmic (at most 22 for 200 events)", bornes <= 22, true);
		r.check("a turn whose first seq is not in the run gives no time", await ms(trou, { runId: RUN, fromSeq: 3, toSeq: 10 }).then(x => x[0]), null);
		r.check("a turn whose last seq is not in the run gives no time", await ms(trou, { runId: RUN, fromSeq: 4, toSeq: 8 }).then(x => x[0]), null);
		r.check("a run that is gone from the store gives no time", await ms(trou, { runId: GONE, fromSeq: 4, toSeq: 10 }).then(x => x[0]), null);
	} finally {
		H.uninstallHost();
	}
	r.done();
});

/* THE TEXT OF A TURN THAT STARTS A NEW RUN (2026-10-14, `freshText`): a chat
   turn on a session that already holds the conversation sends only the short
   follow-up (`text`); a turn on a run that does not hold it yet (no run, the
   stored run deleted and a new one begun, or a new run whose first send
   failed) sends the whole text, or the model would answer a follow-up with
   no conversation behind it. Driven with a fake `HostLive` that records what
   `send` receives. */
await withSrcModule(["src/dashboard/live-generation.ts", "src/host/current.ts"], async (G, H) => {
	const r = makeReporter("Live turn text: follow-up or whole text");
	const R1 = "00000000-0000-4000-8000-0000000000d1";
	const R2 = "00000000-0000-4000-8000-0000000000d2";
	const R3 = "00000000-0000-4000-8000-0000000000d3";
	const sent = [];
	const deleted = new Set();
	const fresh = [R1, R2, R3];
	let failNextSend = false;
	let emit = () => {};
	let seq = 0;
	H.installHost({
		live: {
			start: async (o) => {
				if (o.runId !== undefined) {
					if (deleted.has(o.runId)) throw Object.assign(new Error("run gone"), { name: "refused" });
					return { runId: o.runId };
				}
				return { runId: fresh.shift() };
			},
			send: async (runId, input) => {
				if (input.kind !== "message") return;
				if (failNextSend) { failNextSend = false; throw Object.assign(new Error("send failed"), { name: "failed" }); }
				sent.push(runId.slice(-2) + ":" + input.text);
			},
			close: async () => {},
			onEvent: (cb) => { emit = cb; return () => {}; },
			readRun: async () => null,
			toolOutput: async () => null,
			removeRuns: async () => {},
			storeSize: async () => 0,
		},
		paths: { defaultRoot: () => ({ id: "R", name: "Neo Quiz", deviceId: "pc" }), contractPath: (root, local) => root + "/" + local },
	});
	const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((ok) => setImmediate(ok)); };
	const turn = async (key, runOf, spec, chatId = "chat-f") => {
		const p = G.runLiveTurn({ tool: "claude", chatId, model: "claude-haiku-5-5", mode: "full", images: [], key, abortable: () => {}, ...spec });
		await flush();
		const runId = runOf();
		emit({ kind: "line", runId, seq: ++seq, line: { type: "result", subtype: "success", is_error: false, result: "ok" } });
		emit({ kind: "turnEnd", runId });
		await p;
	};
	try {
		await turn("k-f1", () => R1, { text: "SHORT", freshText: "FULL" });
		r.check("a chat with no run: the turn starts a run and sends the whole text", sent.at(-1), "d1:FULL");
		await turn("k-f2", () => R1, { text: "SHORT", freshText: "FULL" });
		r.check("the next turn of the same chat (its run bound): the follow-up only", sent.at(-1), "d1:SHORT");
		deleted.add(R1);
		await turn("k-f3", () => R2, { text: "SHORT", freshText: "FULL" });
		r.check("the chat's run was deleted: a new run, which gets the whole text", sent.at(-1), "d2:FULL");
		await turn("k-f4", () => R2, { text: "ONLY" });
		r.check("no `freshText` (a generation): `text` is sent, as before", sent.at(-1), "d2:ONLY");
		failNextSend = true;
		const failed = await G.runLiveTurn({ tool: "claude", chatId: "chat-g", model: "claude-haiku-5-5", mode: "full", images: [], key: "k-g1", abortable: () => {}, text: "SHORT", freshText: "FULL" })
			.then(() => "resolved", (e) => "error:" + e.name);
		r.check("a new run whose first send rejects: the turn fails, nothing reached the run", [failed, sent.length], ["error:failed", 4]);
		await turn("k-g2", () => R3, { text: "SHORT", freshText: "FULL" }, "chat-g");
		r.check("the retry on that run (bound, never reached) still sends the whole text", sent.at(-1), "d3:FULL");
		await turn("k-g3", () => R3, { text: "SHORT", freshText: "FULL" }, "chat-g");
		r.check("after one successful send, the next turn sends the follow-up only", sent.at(-1), "d3:SHORT");
	} finally {
		H.uninstallHost();
	}
	r.done();
});
