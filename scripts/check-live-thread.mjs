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
