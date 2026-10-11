/**
 * THE LIVE CLAUDE SESSION PROTOCOL (`apps/windows/electron/live-claude.ts`)
 * and its argument form (`gabarits-cli.ts`, `argumentsLiveClaude`), on the
 * real code.
 *
 * What it prevents: a live session launched with the project's settings
 * (`--setting-sources user,project`: a `.claude/settings.json` planted in the
 * synced Neo Quiz root would run its hooks on the PC), an extra option slipped
 * into the launch (`--mcp-config`, `--add-dir`), an effort or a session id that
 * would become an option of its own, a stdin line split in two by a newline
 * in the user's text, and a hostile control line (prototype keys, wrong
 * types) taken for a permission request, and a drift from the lines a real
 * Claude Code session exchanged (`scripts/fixtures/live/claude-session.jsonl`).
 *
 *     npm run check:live-protocol
 */
import { readFileSync } from "node:fs";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["apps/windows/electron/live-claude.ts", "apps/windows/electron/gabarits-cli.ts"], (live, gabarits) => {
	const { liveClaudeArgs, claudeUserLine, claudeControlLine, claudePermissionLine, claudeEmptyControlResponse, parseClaudeControl, NEO_QUIZ_PROTEGE } = live;
	const { argumentsLiveClaude } = gabarits;
	const r = makeReporter("Live Claude session protocol");
	const U = "0f8fad5b-d9cb-469f-a165-70867728950e";
	const throws = (f) => { try { f(); return false; } catch { return true; } };

	// The launch arguments.
	const full = liveClaudeArgs({ model: "claude-opus-5-5", mode: "full", sessionId: U, resume: false });
	r.check("args: full access, new session, exact form", full, [
		"-p", "--output-format", "stream-json", "--verbose", "--input-format", "stream-json",
		"--permission-prompt-tool", "stdio", "--include-partial-messages",
		"--setting-sources", "user", "--settings", "{\"cleanupPeriodDays\":3650}",
		"--model", "claude-opus-5-5",
		"--permission-mode", "bypassPermissions", "--allow-dangerously-skip-permissions",
		"--disallowedTools", NEO_QUIZ_PROTEGE,
		"--session-id", U,
	]);
	r.check("args: the protected folder is the app's own .neo-quiz/",
		NEO_QUIZ_PROTEGE, "Read(./.neo-quiz/**),Grep(./.neo-quiz/**),Glob(./.neo-quiz/**),Write(./.neo-quiz/**),Edit(./.neo-quiz/**),MultiEdit(./.neo-quiz/**)");

	const modeTail = (mode) => {
		const a = liveClaudeArgs({ model: "claude-opus-5-5", mode, sessionId: U, resume: false });
		return a.slice(a.indexOf("--permission-mode"), a.indexOf("--disallowedTools"));
	};
	r.check("args: supervised asks for every tool", modeTail("supervised"), ["--permission-mode", "default"]);
	r.check("args: accept edits", modeTail("acceptEdits"), ["--permission-mode", "acceptEdits"]);
	r.check("args: auto", modeTail("auto"), ["--permission-mode", "auto"]);
	r.check("args: full access", modeTail("full"), ["--permission-mode", "bypassPermissions", "--allow-dangerously-skip-permissions"]);

	const resumed = liveClaudeArgs({ model: "claude-opus-5-5", mode: "full", sessionId: U, resume: true });
	r.check("args: a resume ends with --resume <id> and has no --session-id",
		[resumed.slice(-2), resumed.includes("--session-id"), resumed.length], [["--resume", U], false, full.length]);

	const withEffort = liveClaudeArgs({ model: "claude-opus-5-5", effort: "high", mode: "full", sessionId: U, resume: false });
	const m = withEffort.indexOf("--model");
	r.check("args: the effort comes right after the model", withEffort.slice(m, m + 4), ["--model", "claude-opus-5-5", "--effort", "high"]);
	r.check("args: an effort that would carry an option throws",
		throws(() => liveClaudeArgs({ model: "claude-opus-5-5", effort: "evil --x", mode: "full", sessionId: U, resume: false })), true);
	r.check("args: a model that would be an option throws",
		throws(() => liveClaudeArgs({ model: "--mcp-config", mode: "full", sessionId: U, resume: false })), true);
	for (const id of ["", "not-a-uuid", U.toUpperCase(), U + "\n", "--resume", "0f8fad5b-d9cb-469f-a165-70867728950"]) {
		r.check(`args: session id ${JSON.stringify(id)} throws`,
			throws(() => liveClaudeArgs({ model: "claude-opus-5-5", mode: "full", sessionId: id, resume: false })), true);
	}

	// The form the main process accepts.
	const forms = [];
	for (const mode of ["supervised", "acceptEdits", "auto", "full"]) for (const resume of [false, true]) for (const effort of [undefined, "low", "max"]) {
		forms.push(liveClaudeArgs({ model: "claude-haiku-5-5", effort, mode, sessionId: U, resume }));
	}
	r.check("form: every built form is accepted", forms.every(f => argumentsLiveClaude(f)), true);
	r.check("form: project settings refused",
		argumentsLiveClaude(full.map(a => a === "user" ? "user,project" : a)), false);
	r.check("form: an extra --mcp-config refused", argumentsLiveClaude([...full, "--mcp-config", "x"]), false);
	r.check("form: an extra --mcp-config in the middle refused",
		argumentsLiveClaude([...full.slice(0, 4), "--mcp-config", "x", ...full.slice(4)]), false);
	r.check("form: an extra --add-dir refused", argumentsLiveClaude([...full, "--add-dir", "C:\\"]), false);
	let moved = 0;
	for (let i = 0; i + 1 < full.length; i++) {
		if (full[i] === full[i + 1]) continue;
		const a = [...full];
		[a[i], a[i + 1]] = [a[i + 1], a[i]];
		if (!argumentsLiveClaude(a)) moved++;
		else console.error("       accepted with elements " + i + " and " + (i + 1) + " swapped");
	}
	r.check("form: any two adjacent elements swapped refused", moved, full.length - 1);
	r.check("form: one element dropped refused", argumentsLiveClaude(full.slice(0, -1)), false);
	r.check("form: not an array, or not only strings, refused",
		[argumentsLiveClaude("-p"), argumentsLiveClaude(null), argumentsLiveClaude([...full.slice(0, -1), 7])], [false, false, false]);

	// The stdin lines.
	const hi = claudeUserLine("hi", []);
	r.check("user line: exact shape", JSON.parse(hi),
		{ type: "user", session_id: "", parent_tool_use_id: null, message: { role: "user", content: [{ type: "text", text: "hi" }] } });
	r.check("user line: ends with one newline", [hi.endsWith("\n"), hi.indexOf("\n") === hi.length - 1], [true, true]);
	const tricky = claudeUserLine("a\nb \"c\"\r\n\u2028d", []);
	r.check("user line: newlines and quotes stay on one line",
		[tricky.split("\n").length, JSON.parse(tricky).message.content[0].text], [2, "a\nb \"c\"\r\n\u2028d"]);
	r.check("user line: a picture follows the text",
		JSON.parse(claudeUserLine("see", [{ mediaType: "image/png", base64: "AAAA" }])).message.content,
		[{ type: "text", text: "see" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }]);
	r.check("control line: initialize", JSON.parse(claudeControlLine("nq_1", "initialize")),
		{ type: "control_request", request_id: "nq_1", request: { subtype: "initialize" } });
	r.check("control line: interrupt", JSON.parse(claudeControlLine("nq_2", "interrupt")),
		{ type: "control_request", request_id: "nq_2", request: { subtype: "interrupt" } });
	r.check("permission line: deny", JSON.parse(claudePermissionLine("r1", { allow: false, message: "User declined tool execution." })),
		{ type: "control_response", response: { subtype: "success", request_id: "r1", response: { behavior: "deny", message: "User declined tool execution." } } });
	r.check("permission line: allow carries the input", JSON.parse(claudePermissionLine("r2", { allow: true, updatedInput: { command: "ls" } })),
		{ type: "control_response", response: { subtype: "success", request_id: "r2", response: { behavior: "allow", updatedInput: { command: "ls" } } } });
	r.check("empty control response", JSON.parse(claudeEmptyControlResponse("r3")),
		{ type: "control_response", response: { subtype: "success", request_id: "r3", response: {} } });

	// The control lines read from stdout.
	const canUse = { type: "control_request", request_id: "a", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" }, tool_use_id: "t1" } };
	r.check("parse: can_use_tool", parseClaudeControl(canUse),
		{ kind: "canUseTool", requestId: "a", toolName: "Bash", input: { command: "ls" }, toolUseId: "t1" });
	r.check("parse: can_use_tool from a parsed JSON line", parseClaudeControl(JSON.parse(JSON.stringify(canUse))),
		{ kind: "canUseTool", requestId: "a", toolName: "Bash", input: { command: "ls" }, toolUseId: "t1" });
	r.check("parse: can_use_tool without a tool use id",
		parseClaudeControl({ ...canUse, request: { subtype: "can_use_tool", tool_name: "Bash", input: {} } })?.toolUseId, null);
	r.check("parse: cancel", parseClaudeControl({ type: "control_cancel_request", request_id: "a" }), { kind: "cancel", requestId: "a" });
	r.check("parse: another request", parseClaudeControl({ type: "control_request", request_id: "b", request: { subtype: "hook_callback" } }),
		{ kind: "otherRequest", requestId: "b", subtype: "hook_callback" });
	r.check("parse: a control response", parseClaudeControl({ type: "control_response", response: { subtype: "success", request_id: "nq_1", response: {} } }),
		{ kind: "controlResponse", requestId: "nq_1", ok: true });
	r.check("parse: an error control response", parseClaudeControl({ type: "control_response", response: { subtype: "error", request_id: "nq_1", error: "x" } }),
		{ kind: "controlResponse", requestId: "nq_1", ok: false });
	r.check("parse: a user line is not a control line",
		parseClaudeControl({ type: "user", message: { role: "user", content: [] } }), null);
	r.check("parse: an assistant line is not a control line", parseClaudeControl({ type: "assistant", message: {} }), null);
	r.check("parse: non-objects", [null, undefined, "x", 3, [], [canUse]].map(parseClaudeControl), [null, null, null, null, null, null]);
	r.check("parse: an object whose prototype is not Object's",
		parseClaudeControl(Object.assign(Object.create({ evil: true }), canUse)), null);
	r.check("parse: a __proto__ key at the top",
		parseClaudeControl(JSON.parse("{\"__proto__\":{\"x\":1},\"type\":\"control_request\",\"request_id\":\"a\",\"request\":{\"subtype\":\"can_use_tool\",\"tool_name\":\"Bash\",\"input\":{}}}")), null);
	r.check("parse: a __proto__ key in the request",
		parseClaudeControl(JSON.parse("{\"type\":\"control_request\",\"request_id\":\"a\",\"request\":{\"__proto__\":{},\"subtype\":\"can_use_tool\",\"tool_name\":\"Bash\",\"input\":{}}}")), null);
	r.check("parse: a __proto__ key in the tool input",
		parseClaudeControl(JSON.parse("{\"type\":\"control_request\",\"request_id\":\"a\",\"request\":{\"subtype\":\"can_use_tool\",\"tool_name\":\"Bash\",\"input\":{\"__proto__\":{\"command\":\"ls\"}}}}")), null);
	r.check("parse: a request id that is not a string",
		parseClaudeControl({ ...canUse, request_id: 7 }), null);
	r.check("parse: an input that is not an object",
		parseClaudeControl({ ...canUse, request: { subtype: "can_use_tool", tool_name: "Bash", input: "ls" } }), null);
	r.check("parse: a tool name that is not a string",
		parseClaudeControl({ ...canUse, request: { subtype: "can_use_tool", tool_name: ["Bash"], input: {} } }), null);
	r.check("parse: a request id longer than 200 characters",
		parseClaudeControl({ ...canUse, request_id: "a".repeat(201) }), null);

	// The lines of a real session (Claude Code 2.1.296, see the top of live-claude.ts).
	const real = readFileSync(new URL("./fixtures/live/claude-session.jsonl", import.meta.url), "utf8").trim().split("\n").map(l => JSON.parse(l));
	const written = real.filter(e => e.dir === "in").map(e => e.l);
	const canUseReal = real.find(e => e.dir === "out" && e.l.type === "control_request")?.l;
	r.check("real: the app's lines are exactly the ones the builders make", written, [
		JSON.parse(claudeControlLine("nq_1", "initialize")),
		JSON.parse(claudeUserLine("Run the shell command: echo hi > probe.txt (use the Bash tool). Do nothing else.", [])),
		JSON.parse(claudePermissionLine(canUseReal?.request_id, { allow: false, message: "User declined tool execution." })),
	]);
	r.check("real: the CLI's permission request is read", parseClaudeControl(canUseReal), {
		kind: "canUseTool", requestId: canUseReal?.request_id, toolName: "Bash",
		input: { command: "echo hi > probe.txt", description: "Write \"hi\" to probe.txt in the working directory" },
		toolUseId: canUseReal?.request?.tool_use_id,
	});
	r.check("real: of the CLI's lines, only the initialize answer and the request are control lines",
		real.filter(e => e.dir === "out").map(e => parseClaudeControl(e.l)?.kind).filter(Boolean), ["controlResponse", "canUseTool"]);
	r.check("real: the turn ends with a result", real.at(-1)?.l?.type, "result");

	r.done();
});
