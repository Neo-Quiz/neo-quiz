/**
 * THE LIVE CLAUDE SESSION PROTOCOL (`apps/windows/electron/live-claude.ts`)
 * and its argument form (`gabarits-cli.ts`, `argumentsLiveClaude`), on the
 * real code.
 *
 * What it prevents: a live session that would not load the user's settings
 * as a terminal does (2026-10-17, "exactly as if launched in Warp"; a
 * `.claude/` planted by another device never arrives, `syncthing-regles.ts`),
 * an extra option slipped
 * into the launch (`--mcp-config`, `--add-dir`), an effort or a session id that
 * would become an option of its own, a stdin line split in two by a newline
 * in the user's text, and a hostile control line (prototype keys, wrong
 * types) taken for a permission request, and a drift from the lines a real
 * Claude Code session exchanged (`scripts/fixtures/live/claude-session.jsonl`).
 *
 * And THE LIVE CODEX SESSION PROTOCOL (`apps/windows/electron/live-codex.ts`,
 * `codex app-server`, JSON-RPC 2.0): a request line split by a newline, a
 * supervised mode that would not ask (or would let Codex's own reviewer
 * answer for the user), a server message with prototype keys or a foreign
 * `jsonrpc` taken for an approval, an approval answer of the wrong shape (a
 * permissions request takes `permissions`, not `decision`), and a drift from
 * the lines a real Codex session exchanged
 * (`scripts/fixtures/live/codex-session.jsonl`). Its launch form
 * (`argsLiveCodex`) is checked too: only the private home varies, quoted; no
 * "untrusted" override since 2026-10-17 (as in a terminal); the user's own
 * home (a bare `app-server`) or an extra override is refused.
 *
 *     npm run check:live-protocol
 */
import { readFileSync } from "node:fs";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["apps/windows/electron/live-claude.ts", "apps/windows/electron/gabarits-cli.ts"], (live, gabarits) => {
	const { liveClaudeArgs, claudeUserLine, claudeControlLine, claudePermissionLine, claudeEmptyControlResponse, parseClaudeControl } = live;
	const { argumentsLiveClaude } = gabarits;
	const r = makeReporter("Live Claude session protocol");
	const U = "0f8fad5b-d9cb-469f-a165-70867728950e";
	const throws = (f) => { try { f(); return false; } catch { return true; } };

	// The launch arguments.
	const full = liveClaudeArgs({ model: "claude-opus-5-5", mode: "full", sessionId: U, resume: false });
	r.check("args: full access, new session, exact form", full, [
		"-p", "--output-format", "stream-json", "--verbose", "--input-format", "stream-json",
		"--permission-prompt-tool", "stdio", "--include-partial-messages", "--replay-user-messages",
		"--settings", "{\"cleanupPeriodDays\":3650}",
		"--model", "claude-opus-5-5",
		"--permission-mode", "bypassPermissions", "--allow-dangerously-skip-permissions",
		"--session-id", U,
	]);
	r.check("args: as in a terminal, no setting source is narrowed and nothing is denied by the app",
		[full.includes("--setting-sources"), full.includes("--disallowedTools"), full.includes("--strict-mcp-config")], [false, false, false]);

	const modeTail = (mode) => {
		const a = liveClaudeArgs({ model: "claude-opus-5-5", mode, sessionId: U, resume: false });
		return a.slice(a.indexOf("--permission-mode"), a.indexOf("--session-id"));
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
	r.check("form: setting sources narrowed by the window refused (the PC loads them all, as a terminal)",
		argumentsLiveClaude([...full.slice(0, 10), "--setting-sources", "user", ...full.slice(10)]), false);
	r.check("form: an extra --mcp-config refused", argumentsLiveClaude([...full, "--mcp-config", "x"]), false);
	r.check("form: an extra --mcp-config in the middle refused",
		argumentsLiveClaude([...full.slice(0, 4), "--mcp-config", "x", ...full.slice(4)]), false);
	r.check("form: an extra --add-dir refused", argumentsLiveClaude([...full, "--add-dir", "C:\\"]), false);
	r.check("form: without --replay-user-messages refused (the busy state is read from its echoes)",
		argumentsLiveClaude(full.filter(a => a !== "--replay-user-messages")), false);
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

await withSrcModule(["apps/windows/electron/live-codex.ts", "apps/windows/electron/gabarits-cli.ts"], (live, gabarits) => {
	const { argsLiveCodex, argumentsLiveCodex, argumentsAutorises, argumentsAppServer } = gabarits;
	const {
		codexRequest, codexNotification, codexInitializeParams, codexModeParams, codexThreadStartParams,
		codexThreadResumeParams, codexTurnStartParams, codexTurnSteerParams, codexTurnInterruptParams,
		codexApprovalAnswer, codexPermissionsAnswer, codexMethodNotFound, parseCodexMessage,
	} = live;
	const r = makeReporter("Live Codex session protocol");
	const throws = (f) => { try { f(); return false; } catch { return true; } };
	const oneLine = (s) => typeof s === "string" && s.endsWith("\n") && s.indexOf("\n") === s.length - 1;
	// Key order is not part of JSON: lines read from the fixture are compared sorted.
	const canon = (v) => Array.isArray(v) ? v.map(canon)
		: v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;

	// The launch form: the private Codex home (`codex-home.ts`) is also the SQLite
	// home. No "untrusted" root override since 2026-10-17: Codex treats the root
	// as the user's config says, as in a terminal; another device's `.codex/`
	// never arrives by sync (`syncthing-regles.ts`).
	const H = "C:\\Users\\a b\\AppData\\Roaming\\Neo Quiz\\codex-home\\default";
	const R = "C:\\Neo Quiz";
	const UNTRUSTED = "projects={\"c:\\\\neo quiz\"={trust_level=\"untrusted\"}}";
	r.check("launch: exact form, the home only", argsLiveCodex(H, R), ["app-server", "-c", "sqlite_home=\"C:\\\\Users\\\\a b\\\\AppData\\\\Roaming\\\\Neo Quiz\\\\codex-home\\\\default\""]);
	r.check("launch: the value is a TOML string that reads back as the home", JSON.parse(argsLiveCodex(H, R)[2].slice("sqlite_home=".length)), H);
	const odd = "C:\\x\"\n -c y=1";
	r.check("launch: a quote or a newline in the home stays inside the string",
		[JSON.parse(argsLiveCodex(odd, R)[2].slice("sqlite_home=".length)), argsLiveCodex(odd, R).length, argsLiveCodex(odd, R)[2].includes("\n")], [odd, 3, false]);
	r.check("launch: an empty or relative home throws",
		[throws(() => argsLiveCodex("", R)), throws(() => argsLiveCodex("codex-home", R)), throws(() => argsLiveCodex(null, R))], [true, true, true]);
	r.check("launch: an empty, relative or missing root throws",
		[throws(() => argsLiveCodex(H, "")), throws(() => argsLiveCodex(H, "Neo Quiz")), throws(() => argsLiveCodex(H))], [true, true, true]);
	r.check("form: the built form is accepted for its own home and root", argumentsLiveCodex(argsLiveCodex(H, R), H, R), true);
	r.check("form: another home refused", argumentsLiveCodex(argsLiveCodex(H, R), H + "2", R), false);
	r.check("form: the bare app-server (the user's own home) refused", argumentsLiveCodex(["app-server"], H, R), false);
	r.check("form: a root trust override added by the window refused", [
		argumentsLiveCodex([...argsLiveCodex(H, R), "-c", UNTRUSTED], H, R),
		argumentsLiveCodex([...argsLiveCodex(H, R), "-c", UNTRUSTED.replace("untrusted", "trusted")], H, R),
	], [false, false]);
	r.check("form: an extra option refused", [
		argumentsLiveCodex([...argsLiveCodex(H, R), "-c", "sandbox_mode=\"danger-full-access\""], H, R),
		argumentsLiveCodex(["app-server", "--dangerously-bypass-approvals-and-sandbox", ...argsLiveCodex(H, R).slice(1)], H, R),
		argumentsLiveCodex(argsLiveCodex(H, R).slice(0, 2), H, R),
	], [false, false, false]);
	r.check("form: unquoted or reordered value refused",
		[argumentsLiveCodex(["app-server", "-c", "sqlite_home=" + H, "-c", UNTRUSTED], H, R), argumentsLiveCodex(["-c", argsLiveCodex(H, R)[2], "app-server", "-c", UNTRUSTED], H, R)], [false, false]);
	r.check("form: non-arrays, non-strings, a bad home or root", [
		argumentsLiveCodex("app-server", H, R), argumentsLiveCodex(null, H, R), argumentsLiveCodex(["app-server", "-c", 7], H, R),
		argumentsLiveCodex(argsLiveCodex(H, R), "", R), argumentsLiveCodex(argsLiveCodex(H, R), H, ""),
	], [false, false, false, false, false]);
	r.check("form: never accepted from the window, nor taken for the resets probe",
		[argumentsAutorises("codex", argsLiveCodex(H, R), "0".repeat(32)), argumentsAppServer("codex", argsLiveCodex(H, R))], [false, false]);

	// The lines the app writes.
	const init = codexRequest(1, "initialize", codexInitializeParams("1.2.3"));
	r.check("request: initialize, exact object", JSON.parse(init),
		{ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "neo-quiz", version: "1.2.3" }, capabilities: { experimentalApi: true } } });
	r.check("request: one line ending with a newline", oneLine(init), true);
	const tricky = codexRequest(7, "turn/start", codexTurnStartParams("t", "a\nb \"c\"\r\n\u2028d", []));
	r.check("request: newlines and quotes in the text stay on one line",
		[oneLine(tricky), JSON.parse(tricky).params.input[0].text], [true, "a\nb \"c\"\r\n\u2028d"]);
	for (const m of ["thread/start", "thread/resume", "turn/start", "turn/steer", "turn/interrupt"]) {
		r.check(`request: ${m}`, JSON.parse(codexRequest(3, m, { a: 1 })), { jsonrpc: "2.0", id: 3, method: m, params: { a: 1 } });
	}
	r.check("request: a method outside the list throws", throws(() => codexRequest(1, "account/rateLimitResetCredit/consume", {})), true);
	r.check("request: an id that is not a safe integer throws",
		[throws(() => codexRequest(-1, "initialize", {})), throws(() => codexRequest(1.5, "initialize", {})), throws(() => codexRequest("1", "initialize", {}))],
		[true, true, true]);
	const initialized = codexNotification("initialized");
	r.check("notification: initialized", [JSON.parse(initialized), oneLine(initialized)], [{ jsonrpc: "2.0", method: "initialized" }, true]);

	r.check("modes: the table", ["supervised", "acceptEdits", "auto", "full"].map(codexModeParams), [
		{ approvalPolicy: "untrusted", sandbox: "read-only", autoAcceptFileChanges: false, acceptAll: false },
		{ approvalPolicy: "on-request", sandbox: "workspace-write", autoAcceptFileChanges: true, acceptAll: false },
		{ approvalPolicy: "on-request", sandbox: "workspace-write", autoAcceptFileChanges: false, acceptAll: false },
		{ approvalPolicy: "on-request", sandbox: "danger-full-access", autoAcceptFileChanges: true, acceptAll: true },
	]);
	r.check("modes: an unknown mode throws", [throws(() => codexModeParams("yolo")), throws(() => codexModeParams("__proto__"))], [true, true]);

	r.check("thread/start: supervised, with effort", codexThreadStartParams({ cwd: "C:\\w", model: "gpt-6-luna", effort: "low", mode: "supervised" }),
		{ cwd: "C:\\w", model: "gpt-6-luna", approvalPolicy: "untrusted", sandbox: "read-only", approvalsReviewer: "user", config: { model_reasoning_effort: "low" } });
	r.check("thread/start: full access, no effort", codexThreadStartParams({ cwd: "C:\\w", model: "gpt-5.5", mode: "full" }),
		{ cwd: "C:\\w", model: "gpt-5.5", approvalPolicy: "on-request", sandbox: "danger-full-access", approvalsReviewer: "user" });
	r.check("thread/start: the reviewer of each mode (the user's config may say auto_review)",
		["supervised", "acceptEdits", "auto", "full"].map(mode => codexThreadStartParams({ cwd: "C:\\w", model: "m", mode }).approvalsReviewer),
		["user", "user", "auto_review", "user"]);
	r.check("thread/start: an empty cwd, a model or an effort of the wrong shape throw", [
		throws(() => codexThreadStartParams({ cwd: "", model: "m", mode: "full" })),
		throws(() => codexThreadStartParams({ cwd: "C:\\w", model: "-x", mode: "full" })),
		throws(() => codexThreadStartParams({ cwd: "C:\\w", model: "m", effort: "low high", mode: "full" })),
		throws(() => codexThreadStartParams({ cwd: "C:\\w", model: "m", mode: "nope" })),
	], [true, true, true, true]);
	r.check("thread/resume: the thread id, then the start params",
		codexThreadResumeParams("th1", { cwd: "C:\\w", model: "m", mode: "auto" }),
		{ threadId: "th1", cwd: "C:\\w", model: "m", approvalPolicy: "on-request", sandbox: "workspace-write", approvalsReviewer: "auto_review" });

	r.check("turn/start: text then pictures", codexTurnStartParams("th1", "see", [{ path: "C:\\a.png" }, { path: "C:\\b.jpg" }]),
		{ threadId: "th1", input: [{ type: "text", text: "see" }, { type: "localImage", path: "C:\\a.png" }, { type: "localImage", path: "C:\\b.jpg" }] });
	r.check("turn/steer: expectedTurnId", codexTurnSteerParams("th1", "tu1", "more", []),
		{ threadId: "th1", expectedTurnId: "tu1", input: [{ type: "text", text: "more" }] });
	r.check("turn/interrupt", codexTurnInterruptParams("th1", "tu1"), { threadId: "th1", turnId: "tu1" });

	r.check("answer: accept", [JSON.parse(codexApprovalAnswer(0, true)), oneLine(codexApprovalAnswer(0, true))],
		[{ jsonrpc: "2.0", id: 0, result: { decision: "accept" } }, true]);
	r.check("answer: decline, string id", JSON.parse(codexApprovalAnswer("r9", false)), { jsonrpc: "2.0", id: "r9", result: { decision: "decline" } });
	r.check("answer: permissions denied grants nothing", JSON.parse(codexPermissionsAnswer(4, null)), { jsonrpc: "2.0", id: 4, result: { permissions: {} } });
	r.check("answer: permissions granted for the turn", JSON.parse(codexPermissionsAnswer(4, { network: { enabled: true } })),
		{ jsonrpc: "2.0", id: 4, result: { scope: "turn", permissions: { network: { enabled: true } } } });
	r.check("answer: method not found", JSON.parse(codexMethodNotFound(5)), { jsonrpc: "2.0", id: 5, error: { code: -32601, message: "Method not found" } });
	r.check("answer: an id that is neither a safe integer nor a short string throws",
		[throws(() => codexApprovalAnswer({}, true)), throws(() => codexMethodNotFound("")), throws(() => codexPermissionsAnswer(1.5, null))], [true, true, true]);

	// The lines read from stdout.
	r.check("parse: a response", parseCodexMessage({ id: 2, result: { thread: { id: "th" } } }), { kind: "response", id: 2, result: { thread: { id: "th" } } });
	r.check("parse: a response with jsonrpc 2.0", parseCodexMessage({ jsonrpc: "2.0", id: 2, result: null }), { kind: "response", id: 2, result: null });
	r.check("parse: an error response", parseCodexMessage({ id: 3, error: { code: -32600, message: "bad" } }),
		{ kind: "response", id: 3, error: { code: -32600, message: "bad" } });
	r.check("parse: an error without a numeric code", parseCodexMessage({ id: 3, error: { code: "x", message: "bad" } }), null);
	r.check("parse: a response with neither result nor error", parseCodexMessage({ id: 3 }), null);
	r.check("parse: a response to a string id (the app sends numbers only)", parseCodexMessage({ id: "3", result: {} }), null);
	r.check("parse: a notification", parseCodexMessage({ method: "turn/completed", params: { threadId: "t" }, emittedAtMs: 1 }),
		{ kind: "notification", method: "turn/completed", params: { threadId: "t" } });
	r.check("parse: a notification without params", parseCodexMessage({ method: "x/y" }), { kind: "notification", method: "x/y", params: {} });
	r.check("parse: a notification whose params are not an object", parseCodexMessage({ method: "x/y", params: [1] }), null);
	for (const m of ["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval"]) {
		r.check(`parse: approval ${m}`, parseCodexMessage({ method: m, id: 0, params: { itemId: "i" } }), { kind: "approval", id: 0, method: m, params: { itemId: "i" } });
	}
	r.check("parse: an approval with a string id", parseCodexMessage({ method: "item/fileChange/requestApproval", id: "a1", params: {} })?.id, "a1");
	r.check("parse: an approval without params", parseCodexMessage({ method: "item/fileChange/requestApproval", id: 0 }), null);
	r.check("parse: an unknown server request", parseCodexMessage({ method: "item/tool/requestUserInput", id: 8, params: {} }),
		{ kind: "serverRequest", id: 8, method: "item/tool/requestUserInput" });
	r.check("parse: non-objects and arrays", [null, undefined, "x", 3, true, [], [{ id: 1, result: {} }]].map(parseCodexMessage),
		[null, null, null, null, null, null, null]);
	r.check("parse: jsonrpc other than 2.0", [
		parseCodexMessage({ jsonrpc: "1.0", id: 1, result: {} }),
		parseCodexMessage({ jsonrpc: 2, method: "item/fileChange/requestApproval", id: 0, params: {} }),
		parseCodexMessage({ jsonrpc: null, method: "turn/completed", params: {} }),
	], [null, null, null]);
	r.check("parse: an object whose prototype is not Object's",
		parseCodexMessage(Object.assign(Object.create({ evil: true }), { method: "turn/completed", params: {} })), null);
	r.check("parse: a __proto__ key at the top",
		parseCodexMessage(JSON.parse("{\"__proto__\":{\"x\":1},\"method\":\"item/commandExecution/requestApproval\",\"id\":0,\"params\":{}}")), null);
	r.check("parse: a __proto__ key in the params",
		parseCodexMessage(JSON.parse("{\"method\":\"item/commandExecution/requestApproval\",\"id\":0,\"params\":{\"__proto__\":{\"command\":\"x\"}}}")), null);
	r.check("parse: a __proto__ key in an error",
		parseCodexMessage(JSON.parse("{\"id\":1,\"error\":{\"__proto__\":{},\"code\":1,\"message\":\"m\"}}")), null);
	r.check("parse: a method that is not a string, or too long", [
		parseCodexMessage({ method: 5, params: {} }), parseCodexMessage({ method: "a".repeat(201), params: {} }),
	], [null, null]);
	r.check("parse: an id that is neither a safe integer nor a string",
		[parseCodexMessage({ method: "item/fileChange/requestApproval", id: 1.5, params: {} }), parseCodexMessage({ method: "item/fileChange/requestApproval", id: {}, params: {} })],
		[null, null]);

	// The lines of a real session (codex-cli 0.162.1, see the top of live-codex.ts):
	// a first process (start, two turns, a declined approval), `restart`, then a
	// second process that resumes the thread and accepts one.
	const real = readFileSync(new URL("./fixtures/live/codex-session.jsonl", import.meta.url), "utf8").trim().split("\n").map(l => JSON.parse(l));
	const cut = real.findIndex(e => e.dir === "restart");
	const runs = [real.slice(0, cut), real.slice(cut + 1)];
	const opts = { cwd: "<CWD>", model: "gpt-6-luna", effort: "low", mode: "supervised" };
	const startParams = codexThreadStartParams(opts);
	// The first probe predates the explicit reviewer; the resume line below shows Codex takes it.
	delete startParams.approvalsReviewer;
	const approvalOf = (run) => run.find(e => e.dir === "out" && parseCodexMessage(e.l)?.kind === "approval")?.l;
	r.check("real: the first process's lines are exactly the ones the builders make",
		canon(runs[0].filter(e => e.dir === "in").map(e => e.l)), canon([
			JSON.parse(codexRequest(1, "initialize", codexInitializeParams("1.20.83"))),
			JSON.parse(codexNotification("initialized")),
			JSON.parse(codexRequest(2, "thread/start", startParams)),
			JSON.parse(codexRequest(3, "turn/start", codexTurnStartParams("<THREAD_ID>", "Run: echo hi", []))),
			JSON.parse(codexRequest(4, "turn/start", codexTurnStartParams("<THREAD_ID>", "Run the shell command: echo hi > probe.txt (in the current folder). Do nothing else.", []))),
			JSON.parse(codexApprovalAnswer(approvalOf(runs[0])?.id, false)),
		]));
	r.check("real: the second process's lines are exactly the ones the builders make",
		canon(runs[1].filter(e => e.dir === "in").map(e => e.l)), canon([
			JSON.parse(codexRequest(1, "initialize", codexInitializeParams("1.20.83"))),
			JSON.parse(codexNotification("initialized")),
			JSON.parse(codexRequest(2, "thread/resume", codexThreadResumeParams("<THREAD_ID>", opts))),
			JSON.parse(codexRequest(3, "turn/start", codexTurnStartParams("<THREAD_ID>", "Run the shell command: Write-Output hi; Set-Content -Path probe.txt -Value hi. Do nothing else.", []))),
			JSON.parse(codexApprovalAnswer(approvalOf(runs[1])?.id, true)),
		]));
	const outs = real.filter(e => e.dir === "out").map(e => parseCodexMessage(e.l));
	r.check("real: every line Codex wrote is read", outs.filter(m => m === null).length, 0);
	r.check("real: Codex omits jsonrpc on its own lines", real.filter(e => e.dir === "out" && "jsonrpc" in e.l).length, 0);
	r.check("real: the only server requests are the two command approvals",
		outs.filter(m => m.kind !== "response" && m.kind !== "notification").map(m => [m.kind, m.method]),
		[["approval", "item/commandExecution/requestApproval"], ["approval", "item/commandExecution/requestApproval"]]);
	r.check("real: the responses answer the app's ids", outs.filter(m => m.kind === "response").map(m => m.id), [1, 2, 3, 4, 1, 2, 3]);
	r.check("real: thread/start answers with the thread id", outs.find(m => m.kind === "response" && m.id === 2)?.result?.thread?.id, "<THREAD_ID>");
	r.check("real: each process ends with turn/completed",
		runs.map(run => { const l = run.filter(e => e.dir === "out").at(-1)?.l; return [l?.method, l?.params?.turn?.status]; }),
		[["turn/completed", "completed"], ["turn/completed", "completed"]]);
	const done = runs[1].map(e => e.l).find(l => l.method === "item/completed" && l.params?.item?.type === "commandExecution")?.params?.item;
	r.check("real: a finished command carries its output in item.aggregatedOutput",
		[typeof done?.aggregatedOutput, done?.status, done?.exitCode], ["string", "failed", -1]);

	r.done();
});
