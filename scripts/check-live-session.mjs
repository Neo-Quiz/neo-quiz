/**
 * The LIVE SESSION MANAGER of the Electron main process
 * (`apps/windows/electron/live-sessions.ts`, `live-drivers.ts`,
 * `live-session-rules.ts`; spec 2026-10-11-live-cli-sessions-design,
 * sections 4.3, 4.4 and 8), driven with FAKE processes (PassThrough stdout,
 * recorded stdin), a fake clock and a fake run store. No real CLI runs.
 *
 * Defects it prevents: a window payload that reaches a CLI unchecked (extra
 * field, kind outside the union, oversized text or picture), a stdin line the
 * window could forge, a permission answered without the user (outside Full
 * access) or answered with the CLI's own suggestions, an interrupt sent
 * before the pending permissions are denied, a session never parked (an
 * orphan process for hours) or parked and never resumed, a run id used by
 * another window, a process left running when the app quits, a line read or
 * written without reaching the run store, a huge stdout line parsed whole.
 *
 *     npm run check:live-session
 */
import { PassThrough } from "node:stream";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

async function cas(r, nom, fn) {
	try { await fn(); } catch (e) { r.check(nom, "EXCEPTION: " + (e && e.stack ? e.stack : String(e)), "no exception"); }
}
async function rejectName(p) {
	try { await p; return null; } catch (e) { return e && e.name ? e.name : String(e); }
}

function fakeTimers() {
	let now = 0;
	let n = 0;
	const list = new Map();
	return {
		set(fn, ms) { const id = ++n; list.set(id, { at: now + ms, fn }); return id; },
		clear(id) { list.delete(id); },
		async advance(ms) {
			now += ms;
			for (const [id, x] of [...list].sort((a, b) => a[1].at - b[1].at)) {
				if (x.at <= now && list.has(id)) { list.delete(id); x.fn(); }
			}
			await flush();
		},
	};
}

function fakeStore() {
	const runs = new Map();
	const log = [];
	return {
		log,
		runs,
		async open(h) { if (!runs.has(h.runId)) runs.set(h.runId, { header: h, events: [] }); },
		async append(runId, rec) {
			log.push({ runId, ...rec });
			const run = runs.get(runId);
			if (!run) throw new Error("Run not opened");
			const { seq, ...rest } = rec;
			run.events.push({ t: 0, seq, ...rest });
		},
		async read(runId) {
			const run = runs.get(runId);
			return run ? { header: run.header, events: run.events, interrupted: true, truncated: false } : null;
		},
		async toolOutput() { return null; },
		async remove() {},
		async size() { return 0; },
	};
}

/** A fake CLI: stdout is a PassThrough, stdin lines are recorded and answered
    by `reply` (the handshake the real CLI does). */
function fakeChild(o, reply) {
	const stdout = new PassThrough();
	stdout.setEncoding("utf8");
	let exitCb = null;
	const c = {
		o, written: [], sent: [], killed: false, exited: false,
		onStdout(cb) { stdout.on("data", cb); },
		onExit(cb) { exitCb = cb; },
		write(line) {
			c.written.push(line);
			if (reply) reply(c, JSON.parse(line));
			return Promise.resolve();
		},
		kill() { c.killed = true; if (!reply || !reply.hang) setImmediate(() => c.exit(null)); },
		exit(code) { if (c.exited) return; c.exited = true; if (exitCb) exitCb(code); },
		send(obj) { c.sent.push(obj); stdout.write(JSON.stringify(obj) + "\n"); },
		raw(text) { stdout.write(text); },
	};
	return c;
}

const claudeReply = (opts = {}) => (c, l) => {
	if (l.type === "control_request" && l.request.subtype === "initialize" && opts.silent !== true) {
		setImmediate(() => c.send({ type: "control_response", response: { subtype: "success", request_id: l.request_id, response: {} } }));
	}
};
const codexReply = (opts = {}) => {
	let turns = 0;
	return (c, l) => {
		if (l.id === undefined || !l.method || (Array.isArray(opts.silent) && opts.silent.includes(l.method))) return;
		let result = {};
		if (l.method === "thread/start") result = { thread: { id: opts.resumeFails ? "th-fresh" : "th-new" } };
		if (l.method === "thread/resume") {
			if (opts.resumeFails) { setImmediate(() => c.send({ id: l.id, error: { code: -32600, message: "no rollout" } })); return; }
			result = { thread: { id: l.params.threadId } };
		}
		if (l.method === "turn/start") result = { turn: { id: "tu-" + (++turns) } };
		if (l.method === "turn/steer") result = { turnId: l.params.expectedTurnId };
		setImmediate(() => c.send({ id: l.id, result }));
	};
};

const ROOT = "C:/Neo Quiz";
const HOME = "C:/data/codex-home/default";
let uuidN = 0;
const deferred = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
const UUID = () => `00000000-0000-4000-8000-${String(++uuidN).padStart(12, "0")}`;

function setup(M, opts = {}) {
	const timers = fakeTimers();
	const store = opts.store ?? fakeStore();
	const events = [];
	const children = [];
	const order = [];
	const gates = {};
	const counts = { root: 0 };
	let prepared = 0;
	const deps = {
		store,
		launch(o) {
			order.push("spawn");
			const reply = o.tool === "claude" ? claudeReply(opts) : codexReply(opts);
			reply.hang = opts.hang === true;
			const c = fakeChild(o, reply);
			children.push(c);
			return c;
		},
		root: async () => { counts.root++; if (gates.root) await gates.root.p; return opts.untrusted ? null : ROOT; },
		codex: { home: HOME, prepare: async () => { if (gates.prepare) await gates.prepare.p; prepared++; order.push("prepare"); } },
		emit: (owner, e) => events.push({ owner, ...e }),
		version: "1.0.0",
		writeImages: async (runId, ims) => ims.map((_, i) => ({ path: "C:/tmp/" + runId + "/" + i + ".png" })),
		dropImages: async () => {},
		uuid: UUID,
		now: () => 1,
		timers,
		log: () => {},
	};
	const m = M.createLiveManager(deps);
	return { m, timers, store, events, children, order, gates, counts, prepared: () => prepared };
}

const START = (o = {}) => ({ tool: "claude", chatId: "chat-1", model: "claude-haiku-5-5", mode: "supervised", ...o });
const lines = (c) => c.written.map((l) => JSON.parse(l));

await withSrcModule([
	"apps/windows/electron/live-sessions.ts",
	"apps/windows/electron/live-session-rules.ts",
	"apps/windows/electron/live-claude.ts",
	"apps/windows/electron/live-codex.ts",
	"apps/windows/electron/gabarits-cli.ts",
], async (M, R, C, X, G) => {
	const r = makeReporter("Live sessions");

	await cas(r, "claude start: exact live form, cwd = root, initialize first, header opened", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		const c = t.children[0];
		const expected = C.liveClaudeArgs({ model: "claude-haiku-5-5", mode: "supervised", sessionId: runId, resume: false });
		r.check("claude start: exact live form, cwd = root, initialize first, header opened",
			[c.o.args, G.argumentsLiveClaude(c.o.args), G.argumentsAutorises("claude", c.o.args, undefined), c.o.cwd, lines(c).map((l) => l.request?.subtype), t.store.runs.get(runId).header.chatId, R.isRunId(runId)],
			[expected, true, false, ROOT, ["initialize"], "chat-1", true]);
	});

	await cas(r, "a typed message writes exactly one line, claudeUserLine", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		const c = t.children[0];
		const images = [{ mediaType: "image/png", base64: "iVBORw0KGgo=" }];
		await t.m.send(1, runId, { kind: "message", text: "Hello \"world\"\n{}", images });
		r.check("a typed message writes exactly one line, claudeUserLine",
			c.written.slice(1), [C.claudeUserLine("Hello \"world\"\n{}", images)]);
	});

	await cas(r, "invalid sends are refused and write nothing", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		const c = t.children[0];
		const before = c.written.length;
		const big = "a".repeat(200_001);
		const img = { mediaType: "image/png", base64: "AAAA" };
		const bad = [
			{ kind: "set_permission_mode", mode: "bypassPermissions" },
			{ kind: "message", text: "x", images: [], extra: 1 },
			{ kind: "message", text: "x".repeat(2 * 1024 * 1024), images: [] },
			{ kind: "message", text: big, images: [] },
			{ kind: "message", text: "x", images: [img, img, img, img, img] },
			{ kind: "message", text: "x", images: [{ mediaType: "image/svg+xml", base64: "AAAA" }] },
			{ kind: "message", text: "x", images: [{ mediaType: "image/png", base64: "AA\"}\n" }] },
			{ kind: "message", text: "x", images: [{ mediaType: "image/png", base64: "A".repeat(8 * 1024 * 1024 + 4) }] },
			{ kind: "message", text: "x", images: [{ mediaType: "image/png", base64: "AAAA", path: "C:/x" }] },
			{ kind: "permission", requestId: "r", allow: true, updatedInput: { command: "rm" } },
			{ kind: "interrupt", now: true },
			{ kind: "message", text: "", images: [] },
			"message",
			null,
		];
		const names = [];
		for (const b of bad) names.push(await rejectName(t.m.send(1, runId, b)));
		names.push(await rejectName(t.m.send(1, "../x", { kind: "interrupt" })));
		r.check("invalid sends are refused and write nothing",
			[names.every((n) => n === "refused"), c.written.length - before], [true, 0]);
	});

	await cas(r, "invalid start payloads are refused, nothing spawned", async () => {
		const t = setup(M);
		const bad = [START({ extra: 1 }), START({ model: "--dangerously" }), START({ mode: "bypass" }), START({ tool: "agy" }),
			START({ effort: "huge" }), START({ runId: "../../x" }), START({ chatId: "a\nb" })];
		const names = [];
		for (const b of bad) names.push(await rejectName(t.m.start(1, b)));
		r.check("invalid start payloads are refused, nothing spawned", [names.every((n) => n === "refused"), t.children.length], [true, 0]);
	});

	await cas(r, "untrusted root: start rejects untrusted, nothing spawned", async () => {
		const t = setup(M, { untrusted: true });
		r.check("untrusted root: start rejects untrusted, nothing spawned", [await rejectName(t.m.start(1, START())), t.children.length], ["untrusted", 0]);
	});

	await cas(r, "initialize unanswered for 8 s: start fails, child killed", async () => {
		const t = setup(M, { silent: true });
		const p = rejectName(t.m.start(1, START()));
		await flush();
		await t.timers.advance(7999);
		const early = t.children[0].killed;
		await t.timers.advance(1);
		r.check("initialize unanswered for 8 s: start fails, child killed", [early, await p, t.children[0].killed], [false, "failed", true]);
	});

	const canUse = (id, extra = {}) => ({ type: "control_request", request_id: id, request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "echo hi > p.txt" }, permission_suggestions: [{ type: "addRules", rules: [{ toolName: "Bash" }], behavior: "allow", destination: "localSettings" }], tool_use_id: "toolu_1", ...extra } });

	await cas(r, "supervised can_use_tool: one event, nothing written; allow answers with the original input only", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		const c = t.children[0];
		const before = c.written.length;
		c.send(canUse("req-1"));
		await flush();
		const perm = t.events.filter((e) => e.kind === "permission");
		const writtenAfterRequest = c.written.length - before;
		await t.m.send(1, runId, { kind: "permission", requestId: "req-1", allow: true });
		r.check("supervised can_use_tool: one event, nothing written; allow answers with the original input only",
			[perm.length, perm[0]?.tool, perm[0]?.input, writtenAfterRequest, c.written.slice(before),
				t.events.filter((e) => e.kind === "permissionGone").map((e) => e.requestId),
				await rejectName(t.m.send(1, runId, { kind: "permission", requestId: "req-1", allow: true }))],
			[1, "Bash", { command: "echo hi > p.txt" }, 0, [C.claudePermissionLine("req-1", { allow: true, updatedInput: { command: "echo hi > p.txt" } })], ["req-1"], "refused"]);
	});

	await cas(r, "full access: allow written at once, no event", async () => {
		const t = setup(M);
		await t.m.start(1, START({ mode: "full" }));
		const c = t.children[0];
		const before = c.written.length;
		c.send(canUse("req-2"));
		await flush();
		r.check("full access: allow written at once, no event",
			[c.written.slice(before), t.events.filter((e) => e.kind === "permission").length],
			[[C.claudePermissionLine("req-2", { allow: true, updatedInput: { command: "echo hi > p.txt" } })], 0]);
	});

	await cas(r, "accept edits: Claude still asks the user (only Full access allows by itself)", async () => {
		const t = setup(M);
		await t.m.start(1, START({ mode: "acceptEdits" }));
		const c = t.children[0];
		const before = c.written.length;
		c.send(canUse("req-3"));
		await flush();
		r.check("accept edits: Claude still asks the user (only Full access allows by itself)",
			[c.written.length - before, t.events.filter((e) => e.kind === "permission").length], [0, 1]);
	});

	await cas(r, "interrupt: every pending permission denied BEFORE the interrupt line", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		const c = t.children[0];
		c.send(canUse("req-a"));
		c.send(canUse("req-b"));
		await flush();
		const before = c.written.length;
		await t.m.send(1, runId, { kind: "interrupt" });
		const after = lines(c).slice(before);
		r.check("interrupt: every pending permission denied BEFORE the interrupt line",
			[after.map((l) => l.type + ":" + (l.response?.response?.behavior ?? l.request?.subtype)),
				t.events.filter((e) => e.kind === "permissionGone").map((e) => e.requestId)],
			[["control_response:deny", "control_response:deny", "control_request:interrupt"], ["req-a", "req-b"]]);
	});

	await cas(r, "control_cancel_request: permissionGone; unknown subtype: empty response", async () => {
		const t = setup(M);
		await t.m.start(1, START());
		const c = t.children[0];
		c.send(canUse("req-c"));
		await flush();
		const before = c.written.length;
		c.send({ type: "control_cancel_request", request_id: "req-c" });
		c.send({ type: "control_request", request_id: "req-d", request: { subtype: "hook_callback" } });
		await flush();
		r.check("control_cancel_request: permissionGone; unknown subtype: empty response",
			[t.events.filter((e) => e.kind === "permissionGone").map((e) => e.requestId), c.written.slice(before)],
			[["req-c"], [C.claudeEmptyControlResponse("req-d")]]);
	});

	await cas(r, "idle park after 5 min; next message respawns with --resume, message after initialize", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		const c = t.children[0];
		await t.m.send(1, runId, { kind: "message", text: "hi", images: [] });
		c.send({ type: "result", subtype: "success" });
		await flush();
		await t.timers.advance(299_000);
		const killedEarly = c.killed;
		await t.timers.advance(1_000);
		const exit = t.events.filter((e) => e.kind === "exit");
		await t.m.send(1, runId, { kind: "message", text: "again", images: [] });
		const c2 = t.children[1];
		const i = c2?.o.args.indexOf("--resume");
		r.check("idle park after 5 min; next message respawns with --resume, message after initialize",
			[killedEarly, c.killed, exit, t.events.some((e) => e.kind === "turnEnd"), i > 0 ? c2.o.args[i + 1] : null, c2?.o.args.includes("--session-id"),
				lines(c2).map((l) => l.type + ":" + (l.request?.subtype ?? l.message?.content?.[0]?.text))],
			[false, true, [{ owner: 1, kind: "exit", runId, code: null, parked: true }], true, runId, false, ["control_request:initialize", "user:again"]]);
	});

	await cas(r, "a busy session is not parked; the clock restarts at the next turn end", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		const c = t.children[0];
		await t.m.send(1, runId, { kind: "message", text: "1", images: [] });
		c.send({ type: "result", subtype: "success" });
		await flush();
		await t.timers.advance(200_000);
		await t.m.send(1, runId, { kind: "message", text: "2", images: [] });
		await t.timers.advance(200_000);
		r.check("a busy session is not parked; the clock restarts at the next turn end", c.killed, false);
	});

	await cas(r, "mode change: respawn with --resume and the new mode; no exit event", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		await t.m.send(1, runId, { kind: "message", text: "hi", images: [] });
		await t.m.start(1, START({ runId, mode: "full" }));
		const c2 = t.children[1];
		r.check("mode change: respawn with --resume and the new mode; no exit event",
			[t.children[0].killed, c2?.o.args, t.events.filter((e) => e.kind === "exit").length],
			[true, C.liveClaudeArgs({ model: "claude-haiku-5-5", mode: "full", sessionId: runId, resume: true }), 0]);
	});

	await cas(r, "same settings: start again spawns nothing and re-emits pending permissions", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		t.children[0].send(canUse("req-e"));
		await flush();
		await t.m.start(1, START({ runId }));
		r.check("same settings: start again spawns nothing and re-emits pending permissions",
			[t.children.length, t.events.filter((e) => e.kind === "permission").map((e) => e.requestId)], [1, ["req-e", "req-e"]]);
	});

	await cas(r, "a run of another window is refused (send, start, close)", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		const c = t.children[0];
		const before = c.written.length;
		r.check("a run of another window is refused (send, start, close)",
			[await rejectName(t.m.send(2, runId, { kind: "message", text: "x", images: [] })),
				await rejectName(t.m.start(2, START({ runId }))),
				await rejectName(t.m.close(2, runId)),
				await rejectName(t.m.send(1, "00000000-0000-4000-8000-999999999999", { kind: "interrupt" })),
				c.written.length - before, c.killed, t.m.holder(2, runId), t.m.holder(1, runId)],
			["refused", "refused", "refused", "refused", 0, false, "other", "own"]);
	});

	await cas(r, "killAll kills every child", async () => {
		const t = setup(M);
		await t.m.start(1, START());
		await t.m.start(1, START({ chatId: "chat-2" }));
		await t.m.start(2, START({ tool: "codex", model: "gpt-6-luna", chatId: "chat-3" }));
		await t.m.killAll();
		r.check("killAll kills every child", [t.children.length, t.children.every((c) => c.killed)], [3, true]);
	});

	await cas(r, "reload: 60 s to reattach; reattached keeps the process, else killed", async () => {
		const t = setup(M);
		const a = await t.m.start(1, START());
		await t.m.start(1, START({ chatId: "chat-2" }));
		t.children[0].send(canUse("req-f"));
		await flush();
		t.m.pageGone(1, false);
		await t.timers.advance(30_000);
		await t.m.start(1, START({ runId: a.runId }));
		await t.timers.advance(31_000);
		r.check("reload: 60 s to reattach; reattached keeps the process, else killed",
			[t.children[0].killed, t.children[1].killed, t.events.filter((e) => e.kind === "permission").length], [false, true, 2]);
	});

	await cas(r, "destroyed window: its sessions only, killed at once", async () => {
		const t = setup(M);
		await t.m.start(1, START());
		await t.m.start(2, START({ chatId: "chat-2" }));
		t.m.pageGone(1, true);
		await flush();
		r.check("destroyed window: its sessions only, killed at once", [t.children[0].killed, t.children[1].killed], [true, false]);
	});

	await cas(r, "every line in and out reaches the store, in order", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		const c = t.children[0];
		await t.m.send(1, runId, { kind: "message", text: "hi", images: [] });
		c.send({ type: "assistant", message: { content: [{ type: "text", text: "yo" }] } });
		c.send(canUse("req-g"));
		await flush();
		await t.m.send(1, runId, { kind: "permission", requestId: "req-g", allow: false });
		c.send({ type: "result", subtype: "success" });
		await flush();
		const stored = t.store.log.filter((x) => x.dir).map((x) => x.dir + ":" + JSON.stringify(x.l));
		const seen = [
			"in:" + c.written[0].trim(), "out:" + JSON.stringify(c.sent[0]),
			"in:" + c.written[1].trim(), "out:" + JSON.stringify(c.sent[1]), "out:" + JSON.stringify(c.sent[2]),
			"in:" + c.written[2].trim(), "out:" + JSON.stringify(c.sent[3]),
		];
		const metas = t.store.log.filter((x) => x.meta).map((x) => Object.keys(x.meta)[0]);
		r.check("every line in and out reaches the store, in order", [stored, metas, t.events.filter((e) => e.kind === "line").length], [seen, ["spawn"], 4]);
	});

	await cas(r, "an oversized stdout line is never parsed: a marker only", async () => {
		const t = setup(M);
		await t.m.start(1, START());
		const c = t.children[0];
		const lineEvents = t.events.filter((e) => e.kind === "line").length;
		const big = JSON.stringify({ type: "assistant", pad: "x".repeat(8 * 1024 * 1024) });
		for (let i = 0; i < big.length; i += 65536) c.raw(big.slice(i, i + 65536));
		c.raw("\n");
		c.send({ type: "result", subtype: "success" });
		await flush(40);
		const marker = t.store.log.filter((x) => x.meta && x.meta.oversizedLine);
		r.check("an oversized stdout line is never parsed: a marker only",
			[R.MAX_LINE, marker.length, marker[0]?.meta.oversizedLine === big.length, t.events.filter((e) => e.kind === "line").length - lineEvents, t.events.some((e) => e.kind === "turnEnd")],
			[8 * 1024 * 1024, 1, true, 1, true]);
	});

	await cas(r, "exit: end stored, pending permissions gone, exit event", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		const c = t.children[0];
		c.send(canUse("req-h"));
		await flush();
		c.exit(1);
		await flush();
		r.check("exit: end stored, pending permissions gone, exit event",
			[t.store.log.at(-1), t.events.filter((e) => e.kind === "permissionGone").map((e) => e.requestId), t.events.at(-1), t.m.isLive(runId)],
			[{ runId, end: { code: 1, cancelled: false }, seq: 4 }, ["req-h"], { owner: 1, kind: "exit", runId, code: 1, parked: false }, false]);
	});

	await cas(r, "restart: a stored run resumes (Claude --resume), same tool and chat only", async () => {
		const store = fakeStore();
		const t1 = setup(M, { store });
		const { runId } = await t1.m.start(1, START());
		await t1.m.send(1, runId, { kind: "message", text: "hi", images: [] });
		await t1.m.killAll();
		const t2 = setup(M, { store });
		const wrongChat = await rejectName(t2.m.start(1, START({ runId, chatId: "other" })));
		const wrongTool = await rejectName(t2.m.start(1, START({ runId, tool: "codex", model: "gpt-6-luna" })));
		await t2.m.start(1, START({ runId }));
		const c = t2.children[0];
		r.check("restart: a stored run resumes (Claude --resume), same tool and chat only",
			[wrongChat, wrongTool, c?.o.args.slice(-2), t2.children.length], ["refused", "refused", ["--resume", runId], 1]);
	});

	// ─── Codex ───
	const CSTART = (o = {}) => START({ tool: "codex", model: "gpt-6-luna", effort: "low", ...o });
	const methods = (c, from = 0) => lines(c).slice(from).map((l) => l.method ?? ("answer:" + JSON.stringify(l.result ?? l.error)));

	await cas(r, "codex start: home prepared before spawn, exact form, handshake, thread id stored", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, CSTART());
		const c = t.children[0];
		r.check("codex start: home prepared before spawn, exact form, handshake, thread id stored",
			[t.order, c.o.args, c.o.codexHome, G.argumentsLiveCodex(c.o.args, HOME), G.argumentsAutorises("codex", c.o.args, undefined), methods(c),
				lines(c)[2].params, t.store.log.filter((x) => x.meta?.threadId).map((x) => x.meta.threadId)],
			[["prepare", "spawn"], G.argsLiveCodex(HOME), HOME, true, false, ["initialize", "initialized", "thread/start"],
				X.codexThreadStartParams({ cwd: ROOT, model: "gpt-6-luna", effort: "low", mode: "supervised" }), ["th-new"]]);
	});

	await cas(r, "codex: turn/start when idle, turn/steer with expectedTurnId during a turn", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, CSTART());
		const c = t.children[0];
		await t.m.send(1, runId, { kind: "message", text: "one", images: [] });
		await t.m.send(1, runId, { kind: "message", text: "two", images: [{ mediaType: "image/png", base64: "AAAA" }] });
		c.send({ method: "turn/completed", params: { threadId: "th-new", turn: { id: "tu-1" } } });
		await flush();
		await t.m.send(1, runId, { kind: "message", text: "three", images: [] });
		const l = lines(c).slice(3);
		r.check("codex: turn/start when idle, turn/steer with expectedTurnId during a turn",
			[l.map((x) => x.method), l[1].params, l[2].params.input[0].text, t.events.filter((e) => e.kind === "turnEnd").length],
			[["turn/start", "turn/steer", "turn/start"],
				X.codexTurnSteerParams("th-new", "tu-1", "two", [{ path: "C:/tmp/" + runId + "/0.png" }]), "three", 1]);
	});

	const approval = (id, method, params = {}) => ({ method, id, params: { threadId: "th-new", turnId: "tu-1", itemId: "i", ...params } });

	await cas(r, "codex supervised: approval asked; interrupt declines it BEFORE turn/interrupt", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, CSTART());
		const c = t.children[0];
		await t.m.send(1, runId, { kind: "message", text: "go", images: [] });
		c.send(approval(0, "item/commandExecution/requestApproval", { command: "echo hi > p.txt", proposedExecpolicyAmendment: ["x"] }));
		await flush();
		const from = c.written.length;
		await t.m.send(1, runId, { kind: "interrupt" });
		r.check("codex supervised: approval asked; interrupt declines it BEFORE turn/interrupt",
			[t.events.filter((e) => e.kind === "permission").map((e) => [e.requestId, e.tool]), c.written.slice(from, from + 1), lines(c).slice(from + 1).map((x) => [x.method, x.params])],
			[[["0", "commandExecution"]], [X.codexApprovalAnswer(0, false)], [["turn/interrupt", X.codexTurnInterruptParams("th-new", "tu-1")]]]);
	});

	await cas(r, "codex permissions request: answered by codexPermissionsAnswer", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, CSTART());
		const c = t.children[0];
		c.send(approval(5, "item/permissions/requestApproval", { permissions: { network: true } }));
		await flush();
		const from = c.written.length;
		await t.m.send(1, runId, { kind: "permission", requestId: "5", allow: true });
		c.send(approval("s7", "item/permissions/requestApproval", { permissions: { network: true } }));
		await flush();
		await t.m.send(1, runId, { kind: "permission", requestId: "s:s7", allow: false });
		r.check("codex permissions request: answered by codexPermissionsAnswer",
			c.written.slice(from), [X.codexPermissionsAnswer(5, { network: true }), X.codexPermissionsAnswer("s7", null)]);
	});

	await cas(r, "codex auto-accept: Full access all; Accept edits file changes only, never a sandbox escape", async () => {
		const t = setup(M);
		await t.m.start(1, CSTART({ mode: "acceptEdits" }));
		const c = t.children[0];
		c.send({ method: "item/started", params: { item: { type: "fileChange", id: "i", changes: [{ path: ROOT + "/notes/a.md", kind: { type: "update", move_path: null }, diff: "" }] } } });
		await flush();
		const from = c.written.length;
		c.send(approval(1, "item/fileChange/requestApproval", {}));
		c.send(approval(2, "item/fileChange/requestApproval", { reason: "command failed; retry without sandbox?" }));
		c.send(approval(3, "item/commandExecution/requestApproval", { command: "ls" }));
		await flush();
		const t2 = setup(M);
		await t2.m.start(1, CSTART({ mode: "full" }));
		const c2 = t2.children[0];
		const from2 = c2.written.length;
		c2.send(approval(1, "item/commandExecution/requestApproval", { reason: "command failed; retry without sandbox?" }));
		await flush();
		r.check("codex auto-accept: Full access all; Accept edits file changes only, never a sandbox escape",
			[c.written.slice(from), t.events.filter((e) => e.kind === "permission").map((e) => e.requestId), c2.written.slice(from2), t2.events.filter((e) => e.kind === "permission").length],
			[[X.codexApprovalAnswer(1, true)], ["2", "3"], [X.codexApprovalAnswer(1, true)], 0]);
	});

	await cas(r, "codex: unknown or malformed server request gets -32601; resolved request is gone", async () => {
		const t = setup(M);
		await t.m.start(1, CSTART());
		const c = t.children[0];
		c.send(approval(4, "item/fileChange/requestApproval", {}));
		await flush();
		const from = c.written.length;
		c.send({ method: "item/tool/requestUserInput", id: 8, params: {} });
		c.send({ method: "item/fileChange/requestApproval", id: 9, params: "bad" });
		c.send({ method: "serverRequest/resolved", params: { threadId: "th-new", requestId: 4 } });
		await flush();
		r.check("codex: unknown or malformed server request gets -32601; resolved request is gone",
			[c.written.slice(from), t.events.filter((e) => e.kind === "permissionGone").map((e) => e.requestId)],
			[[X.codexMethodNotFound(8), X.codexMethodNotFound(9)], ["4"]]);
	});

	await cas(r, "codex mode change: respawn, home prepared again, thread/resume with the stored thread", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, CSTART());
		await t.m.start(1, CSTART({ runId, mode: "full" }));
		const c2 = t.children[1];
		r.check("codex mode change: respawn, home prepared again, thread/resume with the stored thread",
			[t.prepared(), t.children[0].killed, methods(c2), lines(c2)[2].params],
			[2, true, ["initialize", "initialized", "thread/resume"], X.codexThreadResumeParams("th-new", { cwd: ROOT, model: "gpt-6-luna", effort: "low", mode: "full" })]);
	});

	await cas(r, "codex restart: stored thread resumed; a failed resume falls back to thread/start", async () => {
		const store = fakeStore();
		const t1 = setup(M, { store });
		const { runId } = await t1.m.start(1, CSTART());
		await t1.m.killAll();
		const t2 = setup(M, { store, resumeFails: true });
		await t2.m.start(1, CSTART({ runId }));
		const c = t2.children[0];
		r.check("codex restart: stored thread resumed; a failed resume falls back to thread/start",
			[methods(c), lines(c)[2].params.threadId, store.log.filter((x) => x.meta?.resumeFailed).length, store.log.filter((x) => x.meta?.threadId).map((x) => x.meta.threadId)],
			[["initialize", "initialized", "thread/resume", "thread/start"], "th-new", 1, ["th-new", "th-fresh"]]);
	});


	// ─── Fix round 1 ───
	await cas(r, "seq: every stored line numbered in order; a line event carries its stored seq", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		const c = t.children[0];
		await t.m.send(1, runId, { kind: "message", text: "hi", images: [] });
		c.send({ type: "assistant", message: { content: [] } });
		c.send({ type: "result", subtype: "success" });
		await flush();
		const stored = t.store.log.map((x) => x.seq);
		const byLine = t.events.filter((e) => e.kind === "line").map((e) => {
			const hit = t.store.log.find((x) => x.seq === e.seq);
			return !!hit && hit.dir === "out" && JSON.stringify(hit.l) === JSON.stringify(e.line);
		});
		r.check("seq: every stored line numbered in order; a line event carries its stored seq",
			[stored, byLine.length, byLine.every(Boolean)], [stored.map((_, i) => i), 3, true]);
	});

	await cas(r, "seq continues after a restart (adopted run)", async () => {
		const store = fakeStore();
		const t1 = setup(M, { store });
		const { runId } = await t1.m.start(1, START());
		await t1.m.send(1, runId, { kind: "message", text: "hi", images: [] });
		await t1.m.killAll();
		const last = store.log.at(-1).seq;
		const t2 = setup(M, { store });
		await t2.m.start(1, START({ runId }));
		const next = store.log.filter((x) => x.runId === runId).map((x) => x.seq).filter((q) => q > last).slice(0, 2);
		r.check("seq continues after a restart (adopted run)", next, [last + 1, last + 2]);
	});

	await cas(r, "closed: a send queued behind a respawn is refused when close comes first; nothing launched", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		await t.timers.advance(300_000);
		t.gates.root = deferred();
		const sent = rejectName(t.m.send(1, runId, { kind: "message", text: "x", images: [] }));
		await flush();
		await t.m.close(1, runId);
		t.gates.root.open();
		r.check("closed: a send queued behind a respawn is refused when close comes first; nothing launched",
			[await sent, t.children.length, await rejectName(t.m.send(1, runId, { kind: "message", text: "y", images: [] }))], ["refused", 1, "refused"]);
	});

	await cas(r, "closed: a send queued behind another is refused before it runs (no root() asked)", async () => {
		const t = setup(M, { silent: ["turn/start"] });
		const { runId } = await t.m.start(1, START({ tool: "codex", model: "gpt-6-luna" }));
		const s1 = rejectName(t.m.send(1, runId, { kind: "message", text: "1", images: [] }));
		const s2 = rejectName(t.m.send(1, runId, { kind: "message", text: "2", images: [] }));
		await flush();
		const roots = t.counts.root;
		await t.m.close(1, runId);
		r.check("closed: a send queued behind another is refused before it runs (no root() asked)",
			[await s1, await s2, t.counts.root - roots, t.children.length], ["failed", "refused", 0, 1]);
	});

	await cas(r, "a kill fails the requests at once, even when the process is slow to die", async () => {
		const t = setup(M, { silent: ["thread/start"], hang: true });
		let settled = null;
		const p = rejectName(t.m.start(1, START({ tool: "codex", model: "gpt-6-luna" }))).then((n) => { settled = n; return n; });
		await flush();
		const k = t.m.killAll();
		await flush();
		const before = settled;
		await t.timers.advance(60_000);
		await k;
		await p;
		r.check("a kill fails the requests at once, even when the process is slow to die", [before, t.children[0].killed], ["refused", true]);
	});

	await cas(r, "killAll during a pending root() or codex prepare(): resolves, nothing launched after", async () => {
		const t = setup(M);
		const a = await t.m.start(1, START());
		const b = await t.m.start(1, START({ tool: "codex", model: "gpt-6-luna", chatId: "c" }));
		await t.timers.advance(300_000);
		t.gates.prepare = deferred();
		const s2 = rejectName(t.m.send(1, b.runId, { kind: "message", text: "x", images: [] }));
		await flush();
		t.gates.root = deferred();
		const s1 = rejectName(t.m.send(1, a.runId, { kind: "message", text: "x", images: [] }));
		await flush();
		await t.m.killAll();
		t.gates.prepare.open();
		t.gates.root.open();
		await flush();
		r.check("killAll during a pending root() or codex prepare(): resolves, nothing launched after",
			[t.children.length, await s1, await s2], [2, "refused", "refused"]);
	});

	await cas(r, "killAll kills at once, never behind a pending thread/start or initialize", async () => {
		const t = setup(M, { silent: ["thread/start"] });
		const p1 = rejectName(t.m.start(1, START({ tool: "codex", model: "gpt-6-luna" })));
		const t2 = setup(M, { silent: true });
		const p2 = rejectName(t2.m.start(1, START()));
		await flush();
		let done = false;
		const k = Promise.all([t.m.killAll(), t2.m.killAll()]).then(() => { done = true; });
		await flush();
		const snapshot = [done, t.children[0].killed, t2.children[0].killed];
		// Only now let the clocks run (a killAll queued behind the requests would end here).
		await t.timers.advance(60_000);
		await t2.timers.advance(60_000);
		await k;
		r.check("killAll kills at once, never behind a pending thread/start or initialize",
			[...snapshot, await p1, await p2], [true, true, true, "refused", "refused"]);
	});

	await cas(r, "idle park armed at spawn: started with no message, parked after 5 min", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		await t.timers.advance(299_999);
		const early = t.children[0].killed;
		await t.timers.advance(1);
		r.check("idle park armed at spawn: started with no message, parked after 5 min",
			[early, t.children[0].killed, t.events.filter((e) => e.kind === "exit").map((e) => e.parked), t.m.isLive(runId)], [false, true, [true], false]);
	});

	await cas(r, "idle park after a respawn on mode change; a reattach restarts the clock", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		await t.m.send(1, runId, { kind: "message", text: "hi", images: [] });
		t.children[0].send({ type: "result", subtype: "success" });
		await flush();
		await t.m.start(1, START({ runId, mode: "full" }));
		await t.timers.advance(240_000);
		await t.m.start(1, START({ runId, mode: "full" }));
		await t.timers.advance(240_000);
		const afterReattach = t.children[1].killed;
		await t.timers.advance(60_000);
		r.check("idle park after a respawn on mode change; a reattach restarts the clock",
			[afterReattach, t.children[1].killed, t.children.length], [false, true, 2]);
	});

	await cas(r, "two queued turns: the first result does not park the second turn", async () => {
		const t = setup(M);
		const { runId } = await t.m.start(1, START());
		const c = t.children[0];
		await t.m.send(1, runId, { kind: "message", text: "1", images: [] });
		await t.m.send(1, runId, { kind: "message", text: "2", images: [] });
		c.send({ type: "result", subtype: "success" });
		await flush();
		await t.timers.advance(600_000);
		const during = c.killed;
		c.send({ type: "result", subtype: "success" });
		await flush();
		await t.timers.advance(300_000);
		r.check("two queued turns: the first result does not park the second turn", [during, c.killed], [false, true]);
	});

	await cas(r, "live cap: a 7th session parks the least recently used idle one", async () => {
		let now = 0;
		const t = setup(M);
		const ids = [];
		for (let i = 0; i < 6; i++) ids.push((await t.m.start(1, START({ chatId: "c" + i }))).runId);
		// Session 0 is mid-turn (not idle); session 1 is the least recently used idle one.
		await t.m.send(1, ids[0], { kind: "message", text: "keep me", images: [] });
		await t.m.start(1, START({ chatId: "c6" }));
		await flush();
		void now;
		r.check("live cap: a 7th session parks the least recently used idle one",
			[t.children.length, t.children.map((c) => c.killed), t.events.filter((e) => e.kind === "exit").map((e) => [e.runId === ids[1], e.parked])],
			[7, [false, true, false, false, false, false, false], [[true, true]]]);
	});

	await cas(r, "live cap: six sessions mid-turn, a 7th is refused busy, nothing spawned", async () => {
		const t = setup(M);
		for (let i = 0; i < 6; i++) {
			const { runId } = await t.m.start(1, START({ chatId: "c" + i }));
			await t.m.send(1, runId, { kind: "message", text: "work", images: [] });
		}
		r.check("live cap: six sessions mid-turn, a 7th is refused busy, nothing spawned",
			[await rejectName(t.m.start(1, START({ chatId: "c6" }))), t.children.length, t.children.some((c) => c.killed)], ["busy", 6, false]);
	});

	const fileItem = (paths) => ({ method: "item/started", params: { item: { type: "fileChange", id: "f", changes: paths.map((p) => ({ path: p, kind: { type: "update", move_path: null }, diff: "" })) } } });
	await cas(r, "codex accept edits: auto only when every path is in the root and outside .neo-quiz", async () => {
		const verdict = async (paths, extra = {}) => {
			const t = setup(M);
			await t.m.start(1, CSTART({ mode: "acceptEdits" }));
			const c = t.children[0];
			if (paths) c.send(fileItem(paths));
			await flush();
			const from = c.written.length;
			c.send(approval(1, "item/fileChange/requestApproval", { itemId: "f", ...extra }));
			await flush();
			return c.written.length > from ? "auto" : "ask";
		};
		r.check("codex accept edits: auto only when every path is in the root and outside .neo-quiz", [
			await verdict([ROOT + "/a.md", "notes/b.md"]),
			await verdict([ROOT + "/.neo-quiz/review-log.jsonl"]),
			await verdict(["C:\\Neo Quiz\\.NEO-QUIZ.\\x"]),
			await verdict([ROOT + "/../outside.md"]),
			await verdict(["C:/Windows/x.ini"]),
			await verdict(["\\\\server\\share\\x"]),
			await verdict([ROOT + "/NEO-QU~1/x"]),
			await verdict([ROOT + "/a.md:stream"]),
			await verdict(null),
			await verdict([ROOT + "/a.md"], { grantRoot: ROOT }),
		], ["auto", "ask", "ask", "ask", "ask", "ask", "ask", "ask", "ask", "ask"]);
	});

	await cas(r, "codex interrupt while turn/start awaits its id: sent once the turn is known", async () => {
		const t = setup(M, { silent: ["turn/start"] });
		const { runId } = await t.m.start(1, CSTART());
		const c = t.children[0];
		const sending = t.m.send(1, runId, { kind: "message", text: "go", images: [] });
		await flush();
		await t.m.send(1, runId, { kind: "interrupt" });
		const before = methods(c);
		const req = lines(c).find((l) => l.method === "turn/start");
		c.send({ id: req.id, result: { turn: { id: "tu-9" } } });
		await sending;
		await flush();
		r.check("codex interrupt while turn/start awaits its id: sent once the turn is known",
			[before.at(-1), lines(c).at(-1).method, lines(c).at(-1).params], ["turn/start", "turn/interrupt", X.codexTurnInterruptParams("th-new", "tu-9")]);
	});

	await cas(r, "codex steer that times out does not start a second turn", async () => {
		const t = setup(M, { silent: ["turn/steer"] });
		const { runId } = await t.m.start(1, CSTART());
		const c = t.children[0];
		await t.m.send(1, runId, { kind: "message", text: "one", images: [] });
		const p = rejectName(t.m.send(1, runId, { kind: "message", text: "two", images: [] }));
		await flush();
		await t.timers.advance(30_000);
		r.check("codex steer that times out does not start a second turn",
			[await p, methods(c).slice(3)], ["failed", ["turn/start", "turn/steer"]]);
	});

	await cas(r, "rules: escalation, page bounds, line reader", async () => {
		const got = [];
		const read = R.createLineReader(10, (l) => got.push(l), (n) => got.push("over:" + n));
		read("abc\nde"); read("f\r\n0123456789AB"); read("CD\nok\n");
		r.check("rules: escalation, page bounds, line reader",
			[got, R.asksEscalation({ reason: "Retry WITHOUT sandbox" }), R.asksEscalation({ grantRoot: "C:/" }), R.asksEscalation({ reason: "edit" }), R.asksEscalation({ threadId: "t", turnId: "u", itemId: "i", startedAtMs: 1, reason: null, grantRoot: null }), R.asksEscalation({ itemId: "i", newField: 1 }),
				R.validatePage(undefined), R.validatePage({ offset: 0, limit: 2001 }), R.validatePage({ offset: -1, limit: 5 }), R.validatePage({ offset: 2, limit: 5, x: 1 })],
			[["abc", "def", "over:14", "ok"], true, true, true, false, true, { offset: 0, limit: 2000 }, null, null, null]);
	});

	r.done();
});
