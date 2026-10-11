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
     (`run-store.ts`) first, in order; a spawn adds a `{meta:{spawn}}` line,
     an exit an `{end}` line;
   - after a turn, five idle minutes PARK the session (its tree killed); the
     next message respawns it with resume. A model, effort or mode change
     respawns it with resume too;
   - a reloaded window has 60 s to come back (`start` with its run id) before
     its sessions are stopped; a destroyed window takes them at once; the app
     quitting kills them all (`killAll`).
   Permissions stay pending with no timeout (MonoCode); an interrupt first
   denies every pending one, then stops the turn.

   No Electron: the spawner, the store, the clock and the trust check are
   given (`LiveDeps`), so `npm run check:live-session` drives every path
   with fake processes.
══════════════════════════════════════════════════════════ */

import type { ModeAgent } from "../../../src/host/claude-outils";
import type { LiveErrorCode, LiveEvent, LiveInput } from "../../../src/host/types";
import { argsLiveCodex, argumentsLiveClaude, argumentsLiveCodex } from "./gabarits-cli";
import { liveClaudeArgs } from "./live-claude";
import type { ClaudeImage } from "./live-claude";
import { claudeDriver, codexDriver } from "./live-drivers";
import type { Driver, DriverIo, Pending, Timers } from "./live-drivers";
import { createLineReader, isRunId, isSafeId, MAX_LINE, settingsKey, validateLiveInput, validateLiveStart } from "./live-session-rules";
import type { LiveStart } from "./live-session-rules";
import type { RunStore } from "./run-store";

export const IDLE_PARK_MS = 300_000;
export const DETACH_MS = 60_000;
const KILL_WAIT_MS = 5_000;

export class LiveError extends Error {
	constructor(code: LiveErrorCode, message: string) {
		super(message);
		this.name = code;
	}
}

/** A spawned process, as the manager sees it (`process.ts`, `lancerVivant`). */
export interface LiveChild {
	onStdout(cb: (chunk: string) => void): void;
	onExit(cb: (code: number | null) => void): void;
	write(line: string): Promise<void>;
	/** Kills the whole tree; `onExit` follows. */
	kill(): void;
}

export interface LiveDeps {
	store: RunStore;
	/** Throws a `LiveError` (`not-installed`, `failed`). `codexHome` is set
	    for Codex: the spawner puts it in `CODEX_HOME` and `CODEX_SQLITE_HOME`. */
	launch(o: { tool: "claude" | "codex"; args: string[]; cwd: string; codexHome?: string }): LiveChild;
	/** The Neo Quiz root, resolved, inside the perimeter and trusted; `null` otherwise. */
	root(): Promise<string | null>;
	/** The private Codex home, and its preparation before EVERY spawn. */
	codex: { home: string; prepare(): Promise<void> };
	emit(owner: number, e: LiveEvent): void;
	version: string;
	/** Codex takes pictures by path: written for the run, dropped at its exit. */
	writeImages(runId: string, images: readonly ClaudeImage[]): Promise<{ path: string }[]>;
	dropImages(runId: string): Promise<void>;
	uuid(): string;
	now(): number;
	timers: Timers;
	log(...a: unknown[]): void;
}

interface Proc {
	child: LiveChild;
	driver: Driver;
	alive: boolean;
	reason: "park" | "respawn" | "close" | "failed" | null;
	exited: Promise<void>;
}

interface Session {
	runId: string;
	tool: "claude" | "codex";
	chatId: string;
	owner: number;
	settings: { model: string; effort?: string; mode: ModeAgent };
	proc: Proc | null;
	pending: Map<string, Pending>;
	busy: boolean;
	/** Claude: a user line was written once, so the next spawn resumes. */
	messageSent: boolean;
	threadId: string | null;
	idle: unknown;
	detach: unknown;
	chain: Promise<unknown>;
}

/** The three verbs take the window's RAW payloads and validate them here
    (`live-session-rules.ts`): an invalid one is refused before anything is
    written or spawned. */
export interface LiveManager {
	start(owner: number, raw: unknown): Promise<{ runId: string }>;
	send(owner: number, runId: unknown, raw: unknown): Promise<void>;
	close(owner: number, runId: unknown): Promise<void>;
	/** Who holds a run in memory: this window, another one, or nobody. */
	holder(owner: number, runId: string): "own" | "other" | "none";
	isLive(runId: string): boolean;
	pageGone(owner: number, definitive: boolean): void;
	killAll(): Promise<void>;
}

const refused = (m: string) => new LiveError("refused", m);

export function createLiveManager(deps: LiveDeps): LiveManager {
	const sessions = new Map<string, Session>();
	const dying = new Set<Promise<void>>();
	const t = deps.timers;
	const emit = (s: Session, e: LiveEvent): void => { try { deps.emit(s.owner, e); } catch { /* a dead window never stops a run */ } };
	const store = (runId: string, rec: Parameters<RunStore["append"]>[1]): void => {
		void deps.store.append(runId, rec).catch(e => deps.log("run store append failed:", e instanceof Error ? e.message : e));
	};
	const stop = (h: unknown): void => { if (h !== null && h !== undefined) t.clear(h); };

	/** Runs `task` after every earlier task of the session. */
	function enqueue<T>(s: Session, task: () => Promise<T>): Promise<T> {
		const run = s.chain.then(task, task);
		s.chain = run.catch(() => undefined);
		return run;
	}

	function own(owner: number, runId: unknown): Session {
		const s = isRunId(runId) ? sessions.get(runId) : undefined;
		if (!s || s.owner !== owner) throw refused("unknown run");
		return s;
	}

	async function kill(s: Session, proc: Proc, reason: NonNullable<Proc["reason"]>): Promise<void> {
		proc.reason ??= reason;
		proc.child.kill();
		let h: unknown = null;
		await Promise.race([proc.exited, new Promise<void>(r => { h = t.set(r, KILL_WAIT_MS); })]);
		stop(h);
		if (s.proc === proc) s.proc = null;
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
		store(s.runId, { end: { code, cancelled: proc.reason !== null } });
		if (proc.reason !== "respawn") emit(s, { kind: "exit", runId: s.runId, code, parked: proc.reason === "park" });
		if (s.tool === "codex") void deps.dropImages(s.runId).catch(() => undefined);
		done();
	}

	function turnEnded(s: Session): void {
		s.busy = false;
		stop(s.idle);
		s.idle = t.set(() => {
			s.idle = null;
			void enqueue(s, async () => { if (s.proc && !s.busy) await kill(s, s.proc, "park"); });
		}, IDLE_PARK_MS);
	}

	async function spawnProc(s: Session): Promise<void> {
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
				args = argsLiveCodex(deps.codex.home);
				if (!argumentsLiveCodex(args, deps.codex.home)) throw new Error("form");
			}
		} catch (e) {
			if (e instanceof LiveError) throw e;
			throw refused("Launch refused: " + (e instanceof Error ? e.message : String(e)));
		}
		const child = deps.launch({ tool: s.tool, args, cwd, ...(s.tool === "codex" ? { codexHome: deps.codex.home } : {}) });
		store(s.runId, { meta: { spawn: { model: s.settings.model, effort: s.settings.effort ?? null, mode: s.settings.mode, resume } } });
		let done: () => void = () => {};
		const proc: Proc = { child, driver: null as unknown as Driver, alive: true, reason: null, exited: new Promise<void>(r => { done = r; }) };
		const io: DriverIo = {
			write(line) {
				if (!proc.alive) return Promise.reject(new Error("The CLI exited"));
				return writeTo(s, proc, line);
			},
			permission(p) {
				s.pending.set(p.requestId, p);
				emit(s, { kind: "permission", runId: s.runId, requestId: p.requestId, tool: p.tool, input: p.input });
			},
			gone(id) {
				if (s.pending.delete(id)) emit(s, { kind: "permissionGone", runId: s.runId, requestId: id });
			},
			turnStarted() { s.busy = true; stop(s.idle); s.idle = null; },
			turnEnded() {
				turnEnded(s);
				emit(s, { kind: "turnEnd", runId: s.runId });
			},
			meta(m) {
				if (typeof m.threadId === "string") s.threadId = m.threadId;
				store(s.runId, { meta: m });
			},
			log: deps.log,
			timers: t,
		};
		proc.driver = s.tool === "claude"
			? claudeDriver({ mode: s.settings.mode }, io)
			: codexDriver({ cwd, ...s.settings, version: deps.version, threadId: s.threadId, images: im => deps.writeImages(s.runId, im) }, io);
		const read = createLineReader(MAX_LINE, line => {
			let v: unknown;
			try { v = JSON.parse(line); } catch { store(s.runId, { meta: { nonJson: line.slice(0, 2000) } }); return; }
			store(s.runId, { dir: "out", l: v });
			emit(s, { kind: "line", runId: s.runId, line: v });
			proc.driver.onLine(v);
		}, length => store(s.runId, { meta: { oversizedLine: length } }));
		child.onStdout(read);
		child.onExit(code => onExit(s, proc, code, done));
		s.proc = proc;
		try {
			await proc.driver.init();
		} catch (e) {
			deps.log("live session start failed:", e instanceof Error ? e.message : e);
			await kill(s, proc, "failed");
			throw new LiveError("failed", e instanceof Error ? e.message : String(e));
		}
	}

	/** Denies every pending permission, in order, before anything else. */
	async function denyAll(s: Session): Promise<void> {
		const proc = s.proc;
		for (const [id, p] of [...s.pending]) {
			s.pending.delete(id);
			emit(s, { kind: "permissionGone", runId: s.runId, requestId: id });
			if (proc) await writeTo(s, proc, p.answer(false));
		}
	}
	function writeTo(s: Session, proc: Proc, line: string): Promise<void> {
		if (!proc.alive) return Promise.resolve();
		store(s.runId, { dir: "in", l: JSON.parse(line) });
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
		}
		sessions.set(o.runId, s);
		return s;
	}

	function newSession(owner: number, runId: string, o: LiveStart): Session {
		return {
			runId, tool: o.tool, chatId: o.chatId, owner, proc: null, pending: new Map(), busy: false,
			settings: { model: o.model, mode: o.mode, ...(o.effort !== undefined ? { effort: o.effort } : {}) },
			messageSent: false, threadId: null, idle: null, detach: null, chain: Promise.resolve(),
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
			try {
				return await enqueue(s, async () => {
					const settings = { model: o.model, mode: o.mode, ...(o.effort !== undefined ? { effort: o.effort } : {}) };
					if (s.proc && settingsKey(s.settings) !== settingsKey(settings)) await kill(s, s.proc, "respawn");
					s.settings = settings;
					if (!s.proc) await spawnProc(s);
					else for (const p of s.pending.values()) emit(s, { kind: "permission", runId: s.runId, requestId: p.requestId, tool: p.tool, input: p.input });
					return { runId: s.runId };
				});
			} catch (e) {
				if (fresh) sessions.delete(s.runId);
				throw e;
			}
		},

		async send(owner, runId, raw) {
			const input: LiveInput | null = validateLiveInput(raw);
			if (!input) throw refused("invalid input");
			const s = own(owner, runId);
			stop(s.detach); s.detach = null;
			if (input.kind === "message") {
				await enqueue(s, async () => {
					if (!s.proc) await spawnProc(s);
					const proc = s.proc as Proc | null;
					if (!proc) throw new LiveError("failed", "The CLI exited");
					s.messageSent = true;
					try {
						await proc.driver.message(input.text, input.images);
					} catch (e) {
						// A message that never reached a turn: the session idles again.
						if (s.busy) turnEnded(s);
						throw new LiveError("failed", e instanceof Error ? e.message : String(e));
					}
				});
				return;
			}
			if (input.kind === "permission") {
				const p = s.pending.get(input.requestId);
				const proc = s.proc;
				if (!p || !proc) throw refused("unknown request");
				s.pending.delete(input.requestId);
				emit(s, { kind: "permissionGone", runId: s.runId, requestId: input.requestId });
				await writeTo(s, proc, p.answer(input.allow));
				return;
			}
			const proc = s.proc;
			if (!proc) return;
			await denyAll(s);
			await proc.driver.interrupt();
		},

		async close(owner, runId) {
			const s = own(owner, runId);
			stop(s.detach); s.detach = null;
			stop(s.idle); s.idle = null;
			await enqueue(s, async () => { if (s.proc) await kill(s, s.proc, "close"); });
			sessions.delete(s.runId);
		},

		holder(owner, runId) {
			const s = sessions.get(runId);
			return !s ? "none" : s.owner === owner ? "own" : "other";
		},
		isLive: runId => !!sessions.get(runId)?.proc,

		pageGone(owner, definitive) {
			for (const s of [...sessions.values()]) {
				if (s.owner !== owner) continue;
				const close = (): void => {
					stop(s.idle); s.idle = null;
					s.detach = null;
					sessions.delete(s.runId);
					// Tracked: `killAll` (the app quitting) waits for it too.
					const k = enqueue(s, async () => { if (s.proc) await kill(s, s.proc, "close"); });
					dying.add(k);
					void k.finally(() => dying.delete(k));
				};
				if (definitive) { stop(s.detach); close(); continue; }
				if (s.detach === null) s.detach = t.set(close, DETACH_MS);
			}
		},

		async killAll() {
			const all = [...sessions.values()];
			sessions.clear();
			await Promise.all([...dying, ...all.map(async s => {
				stop(s.idle); stop(s.detach);
				s.idle = null; s.detach = null;
				if (s.proc) await kill(s, s.proc, "close");
			})]);
		},
	};
}
