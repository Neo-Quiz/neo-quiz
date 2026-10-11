/* ══════════════════════════════════════════════════════════
   THE LIVE AI SESSIONS OF THE MAIN PROCESS (2026-10-11).

   One long-lived Claude Code or Codex process per chat (spec 2026-10-11-
   live-cli-sessions-design, sections 4.3 and 4.4), run in the Neo Quiz
   root once the user trusted it. This module owns their lifecycle:
   - a run id is created HERE (`crypto.randomUUID()`), and only the window
     (`WebContents`) that started a run may use it again; an unknown id is
     only accepted when the store holds that run for the same tool and chat
     (resume after a restart of the app), and no other window has it;
   - every line written to or read from the process goes to the run store
     (`run-store.ts`) first, in order, with its `seq` (the line's index in
     the run); a `line` event carries the same `seq`, so a page that read
     the store drops what it already has. A spawn adds `{meta:{spawn}}`, an
     exit an `{end}` line;
   - five idle minutes PARK a session (its tree killed): armed after every
     spawn and every turn end, cleared while the session is busy (a flag
     the driver sets on a message and clears once every message written
     is answered, `live-drivers.ts`); the next message
     respawns it with resume. A model, effort or mode change respawns it
     with resume too. At most `MAX_LIVE` sessions have a process: a new one
     parks the least recently used idle one, or is refused `busy`;
   - a session is CLOSED synchronously (close, quit, window destroyed, or a
     reload not back within 60 s): nothing is sent to it any more, a spawn
     in flight kills what it started, and its process is killed at once,
     never behind its queue.
   Permissions stay pending with no timeout (MonoCode); an interrupt first
   denies every pending one, then stops the turn.

   No Electron: the spawner, the store, the clock and the trust check are
   given (`LiveDeps`), so `npm run check:live-session` drives every path
   with fake processes.
══════════════════════════════════════════════════════════ */

import type { LiveEvent, LiveInput } from "../../../src/host/types";
import { argsLiveCodex, argumentsLiveClaude, argumentsLiveCodex } from "./gabarits-cli";
import { liveClaudeArgs } from "./live-claude";
import { claudeDriver, codexDriver } from "./live-drivers";
import type { Driver, DriverIo } from "./live-drivers";
import { createLineReader, isRunId, isSafeId, MAX_LINE, MAX_LIVE, settingsKey, validateLiveInput, validateLiveStart } from "./live-session-rules";
import type { LiveStart } from "./live-session-rules";
import type { RunRecord } from "./run-store";
import { LiveError } from "./live-session-types";
import type { LiveDeps, LiveManager, Proc, Session } from "./live-session-types";

export { LiveError } from "./live-session-types";
export type { LiveChild, LiveDeps, LiveManager } from "./live-session-types";

export const IDLE_PARK_MS = 300_000;
export const DETACH_MS = 60_000;
const KILL_WAIT_MS = 5_000;

const refused = (m: string) => new LiveError("refused", m);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createLiveManager(deps: LiveDeps): LiveManager {
	const sessions = new Map<string, Session>();
	const dying = new Set<Promise<void>>();
	const t = deps.timers;
	const emit = (s: Session, e: LiveEvent): void => { try { deps.emit(s.owner, e); } catch { /* a dead window never stops a run */ } };
	/** Stores one line of the run with the next `seq`, which it returns. */
	const store = (s: Session, rec: RunRecord): number => {
		const seq = s.seq++;
		void deps.store.append(s.runId, { ...rec, seq } as RunRecord).catch(e => deps.log("run store append failed:", message(e)));
		return seq;
	};
	const stop = (h: unknown): void => { if (h !== null && h !== undefined) t.clear(h); };

	/** Runs `task` after every earlier task of the session, unless it is closed by then. */
	function enqueue<T>(s: Session, task: () => Promise<T>): Promise<T> {
		const guarded = (): Promise<T> => (s.closed ? Promise.reject(refused("closed")) : task());
		const run = s.chain.then(guarded, guarded);
		s.chain = run.catch(() => undefined);
		return run;
	}

	function own(owner: number, runId: unknown): Session {
		const s = isRunId(runId) ? sessions.get(runId) : undefined;
		if (!s || s.owner !== owner || s.closed) throw refused("unknown run");
		return s;
	}

	/** Kills `proc` NOW (synchronously); every request it awaited fails at
	    once, so no queue waits on it. The wait for its exit is tracked:
	    `killAll` (the app quitting) waits for every kill in flight. */
	function kill(s: Session, proc: Proc, reason: NonNullable<Proc["reason"]>): Promise<void> {
		proc.reason ??= reason;
		if (s.proc === proc) s.proc = null;
		proc.child.kill();
		proc.driver.failAll(new Error("The CLI was stopped"));
		let h: unknown = null;
		const k = Promise.race([proc.exited, new Promise<void>(r => { h = t.set(r, KILL_WAIT_MS); })]).then(() => stop(h));
		dying.add(k);
		void k.finally(() => dying.delete(k));
		return k;
	}

	/** Closes a session NOW: out of the map, timers off, process killed. */
	function terminate(s: Session): Promise<void> {
		s.closed = true;
		if (sessions.get(s.runId) === s) sessions.delete(s.runId);
		stop(s.idle); stop(s.detach);
		s.idle = null; s.detach = null;
		return s.proc ? kill(s, s.proc, "close") : s.exiting ?? Promise.resolve();
	}

	function park(s: Session): void {
		if (!s.proc) return;
		const k = kill(s, s.proc, "park");
		s.exiting = k;
		void k.finally(() => { if (s.exiting === k) s.exiting = null; });
	}

	function armIdle(s: Session): void {
		stop(s.idle);
		s.idle = s.busy || s.closed ? null : t.set(() => {
			s.idle = null;
			if (!s.busy && !s.closed) park(s);
		}, IDLE_PARK_MS);
	}

	function onExit(s: Session, proc: Proc, code: number | null, done: () => void): void {
		if (!proc.alive) return;
		proc.alive = false;
		proc.driver.failAll(new Error("The CLI exited"));
		if (s.proc === proc) s.proc = null;
		stop(s.idle); s.idle = null;
		s.busy = false;
		for (const id of s.pending.keys()) emit(s, { kind: "permissionGone", runId: s.runId, requestId: id });
		s.pending.clear();
		store(s, { end: { code, cancelled: proc.reason !== null } });
		if (proc.reason !== "respawn") emit(s, { kind: "exit", runId: s.runId, code, parked: proc.reason === "park" });
		if (s.tool === "codex") void deps.dropImages(s.runId).catch(() => undefined);
		done();
	}

	/** Takes one of the `MAX_LIVE` places, parking the least recently used
	    idle session if they are all taken; `busy` if none is idle. */
	function reserve(s: Session): void {
		const live = [...sessions.values()].filter(o => o !== s && !o.closed && (o.proc || o.spawning));
		if (live.length >= MAX_LIVE) {
			const idle = live.filter(o => o.proc && !o.spawning && !o.busy && o.pending.size === 0).sort((a, b) => a.lastUsed - b.lastUsed)[0];
			if (!idle) throw new LiveError("busy", "Too many AI sessions are working");
			park(idle);
		}
		s.spawning = true;
	}

	async function spawnProc(s: Session): Promise<void> {
		reserve(s);
		try {
			await launchProc(s);
		} finally {
			s.spawning = false;
		}
		armIdle(s);
	}

	const checkOpen = (s: Session): void => { if (s.closed) throw refused("closed"); };

	async function launchProc(s: Session): Promise<void> {
		if (s.exiting) await s.exiting;
		const cwd = await deps.root();
		if (!cwd) throw new LiveError("untrusted", "The Neo Quiz folder is not trusted");
		const resume = s.tool === "claude" ? s.messageSent : s.threadId !== null;
		let args: string[];
		try {
			if (s.tool === "claude") {
				args = liveClaudeArgs({ ...s.settings, sessionId: s.runId, resume });
				if (!argumentsLiveClaude(args)) throw new Error("form");
			} else {
				await deps.codex.prepare();
				args = argsLiveCodex(deps.codex.home, cwd);
				if (!argumentsLiveCodex(args, deps.codex.home, cwd)) throw new Error("form");
			}
		} catch (e) {
			throw refused("Launch refused: " + message(e));
		}
		// Closed while awaiting `root()` or `prepare()`: nothing is launched.
		checkOpen(s);
		const child = deps.launch({ tool: s.tool, args, cwd, ...(s.tool === "codex" ? { codexHome: deps.codex.home } : {}) });
		store(s, { meta: { spawn: { model: s.settings.model, effort: s.settings.effort ?? null, mode: s.settings.mode, resume } } });
		let done: () => void = () => {};
		const proc: Proc = { child, driver: null as unknown as Driver, alive: true, reason: null, exited: new Promise<void>(r => { done = r; }) };
		const io: DriverIo = {
			write: line => (proc.alive ? writeTo(s, proc, line) : Promise.reject(new Error("The CLI exited"))),
			permission(p) {
				s.pending.set(p.requestId, p);
				emit(s, { kind: "permission", runId: s.runId, requestId: p.requestId, tool: p.tool, input: p.input });
			},
			gone(id) {
				if (s.pending.delete(id)) emit(s, { kind: "permissionGone", runId: s.runId, requestId: id });
			},
			turnStarted() { s.busy = true; stop(s.idle); s.idle = null; },
			turnEnded() {
				s.busy = false;
				armIdle(s);
				emit(s, { kind: "turnEnd", runId: s.runId });
			},
			meta(m) {
				if (typeof m.threadId === "string") s.threadId = m.threadId;
				store(s, { meta: m });
			},
			log: deps.log,
			timers: t,
		};
		proc.driver = s.tool === "claude"
			? claudeDriver({ mode: s.settings.mode }, io)
			: codexDriver({ cwd, ...s.settings, version: deps.version, threadId: s.threadId, images: im => deps.writeImages(s.runId, im) }, io);
		child.onStdout(createLineReader(MAX_LINE, line => {
			let v: unknown;
			try { v = JSON.parse(line); } catch { store(s, { meta: { nonJson: line.slice(0, 2000) } }); return; }
			const seq = store(s, { dir: "out", l: v });
			emit(s, { kind: "line", runId: s.runId, seq, line: v });
			proc.driver.onLine(v);
		}, length => store(s, { meta: { oversizedLine: length } })));
		child.onExit(code => onExit(s, proc, code, done));
		s.proc = proc;
		try {
			await proc.driver.init();
			checkOpen(s);
		} catch (e) {
			// Killed already (close, quit): never wait for a slow exit here.
			if (proc.alive && proc.reason === null) void kill(s, proc, "failed");
			if (s.closed) throw refused("closed");
			deps.log("live session start failed:", message(e));
			throw new LiveError("failed", message(e));
		}
	}

	/** Denies every pending permission, in order, before anything else. */
	async function denyAll(s: Session, proc: Proc): Promise<void> {
		for (const [id, p] of [...s.pending]) {
			s.pending.delete(id);
			emit(s, { kind: "permissionGone", runId: s.runId, requestId: id });
			await writeTo(s, proc, p.answer(false));
		}
	}
	function writeTo(s: Session, proc: Proc, line: string): Promise<void> {
		if (!proc.alive) return Promise.resolve();
		store(s, { dir: "in", l: JSON.parse(line) });
		return proc.child.write(line);
	}

	async function adopt(owner: number, o: LiveStart & { runId: string }): Promise<Session> {
		const run = await deps.store.read(o.runId);
		if (!run || run.header.tool !== o.tool || run.header.chatId !== o.chatId) throw refused("unknown run");
		const again = sessions.get(o.runId);
		if (again) {
			if (again.owner !== owner) throw refused("run held by another window");
			return again;
		}
		const s = newSession(owner, o.runId, o);
		for (const ev of run.events) {
			const l = ev.l as Record<string, unknown> | undefined;
			if (ev.dir === "in" && l && l.type === "user") s.messageSent = true;
			if (ev.meta && isSafeId(ev.meta.threadId)) s.threadId = ev.meta.threadId;
			s.seq = Math.max(s.seq, ev.seq + 1);
		}
		sessions.set(o.runId, s);
		return s;
	}

	function newSession(owner: number, runId: string, o: LiveStart): Session {
		return {
			runId, tool: o.tool, chatId: o.chatId, owner, proc: null, spawning: false, closed: false, exiting: null,
			pending: new Map(), busy: false, settings: { model: o.model, mode: o.mode, ...(o.effort !== undefined ? { effort: o.effort } : {}) },
			messageSent: false, threadId: null, seq: 0, lastUsed: deps.now(), idle: null, detach: null, chain: Promise.resolve(),
		};
	}

	return {
		async start(owner, raw) {
			const o = validateLiveStart(raw);
			if (!o) throw refused("invalid start");
			let s: Session;
			let fresh = false;
			if (o.runId !== undefined) {
				const known = sessions.get(o.runId);
				if (known && (known.owner !== owner || known.tool !== o.tool || known.chatId !== o.chatId)) throw refused("unknown run");
				s = known ?? await adopt(owner, { ...o, runId: o.runId });
			} else {
				const cwd = await deps.root();
				if (!cwd) throw new LiveError("untrusted", "The Neo Quiz folder is not trusted");
				const runId = deps.uuid();
				s = newSession(owner, runId, o);
				sessions.set(runId, s);
				fresh = true;
				await deps.store.open({ v: 1, tool: o.tool, model: o.model, ...(o.effort !== undefined ? { effort: o.effort } : {}), mode: o.mode, runId, cwd, chatId: o.chatId, start: deps.now() });
			}
			stop(s.detach); s.detach = null;
			s.lastUsed = deps.now();
			try {
				return await enqueue(s, async () => {
					const settings = { model: o.model, mode: o.mode, ...(o.effort !== undefined ? { effort: o.effort } : {}) };
					if (s.proc && settingsKey(s.settings) !== settingsKey(settings)) await kill(s, s.proc, "respawn");
					s.settings = settings;
					if (!s.proc) await spawnProc(s);
					else {
						armIdle(s);
						for (const p of s.pending.values()) emit(s, { kind: "permission", runId: s.runId, requestId: p.requestId, tool: p.tool, input: p.input });
					}
					return { runId: s.runId };
				});
			} catch (e) {
				if (fresh && sessions.get(s.runId) === s) sessions.delete(s.runId);
				throw e;
			}
		},

		async send(owner, runId, raw) {
			const input: LiveInput | null = validateLiveInput(raw);
			if (!input) throw refused("invalid input");
			const s = own(owner, runId);
			stop(s.detach); s.detach = null;
			s.lastUsed = deps.now();
			if (input.kind === "message") {
				await enqueue(s, async () => {
					if (!s.proc) await spawnProc(s);
					const proc = s.proc as Proc | null;
					if (!proc) throw new LiveError("failed", "The CLI exited");
					s.messageSent = true;
					const before = s.busy;
					try {
						await proc.driver.message(input.text, input.images);
					} catch (e) {
						// A message that never reached a turn: the session idles again.
						if (!before && s.busy) { s.busy = false; armIdle(s); }
						throw new LiveError("failed", message(e));
					}
				});
				return;
			}
			const proc = s.proc;
			if (input.kind === "permission") {
				const p = s.pending.get(input.requestId);
				if (!p || !proc) throw refused("unknown request");
				s.pending.delete(input.requestId);
				emit(s, { kind: "permissionGone", runId: s.runId, requestId: input.requestId });
				await writeTo(s, proc, p.answer(input.allow));
				return;
			}
			if (!proc) return;
			await denyAll(s, proc);
			await proc.driver.interrupt();
		},

		async close(owner, runId) {
			await terminate(own(owner, runId));
		},

		holder(owner, runId) {
			const s = sessions.get(runId);
			return !s ? "none" : s.owner === owner ? "own" : "other";
		},
		isLive: runId => !!sessions.get(runId)?.proc,

		pageGone(owner, definitive) {
			for (const s of [...sessions.values()]) {
				if (s.owner !== owner) continue;
				if (definitive) void terminate(s);
				else if (s.detach === null) s.detach = t.set(() => { s.detach = null; void terminate(s); }, DETACH_MS);
			}
		},

		async killAll() {
			for (const s of [...sessions.values()]) void terminate(s);
			await Promise.all([...dying]);
		},
	};
}
