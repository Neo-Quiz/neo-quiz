/* ══════════════════════════════════════════════════════════
   ONE LIVE PROCESS, SPOKEN TO IN ITS PROTOCOL (2026-10-11).

   A driver speaks to ONE running Claude Code (stream-json) or Codex
   (`app-server`, JSON-RPC) process for the session manager
   (`live-sessions.ts`): the handshake after spawn, a user message, an
   interrupt, and what each stdout line means (a permission request, the
   end of a turn, the answer to one of the app's requests). Every stdin line
   comes from the builders of `live-claude.ts` / `live-codex.ts`, from typed
   values; the window never reaches this module.

   Permissions: Full access answers allow at once; Codex Accept edits
   accepts a file change that stays in the sandbox. Everything else is
   handed to the manager (`io.permission`), which asks the window and keeps
   it pending. The answer is behavior allow/deny ONLY: a Claude
   `permission_suggestions` or a Codex `proposedExecpolicyAmendment` is never
   applied (the app writes no settings or policy file).

   No Node, no Electron: the manager gives it its I/O and its timers.
══════════════════════════════════════════════════════════ */

import type { ModeAgent } from "../../../src/host/claude-outils";
import { claudeControlLine, claudeEmptyControlResponse, claudePermissionLine, claudeUserLine, parseClaudeControl } from "./live-claude";
import type { ClaudeImage } from "./live-claude";
import {
	codexApprovalAnswer, codexInitializeParams, codexMethodNotFound, codexNotification, codexPermissionsAnswer, codexRequest,
	codexThreadResumeParams, codexThreadStartParams, codexTurnInterruptParams, codexTurnStartParams, codexTurnSteerParams, parseCodexMessage,
} from "./live-codex";
import type { CodexMethod } from "./live-codex";
import { changePaths, claudeAutoAllow, codexAutoAccept, codexRequestKey, isSafeId, malformedRequestId } from "./live-session-rules";

type Rec = Record<string, unknown>;

export const INIT_TIMEOUT_MS = 8_000;
/** `thread/start` waits for the user's MCP servers: measured around 1 s. */
export const THREAD_TIMEOUT_MS = 60_000;
export const TURN_TIMEOUT_MS = 30_000;
export const DENY_MESSAGE = "User declined tool execution.";

export interface Timers {
	set(fn: () => void, ms: number): unknown;
	clear(t: unknown): void;
}

/** A permission request waiting for the user. `answer` builds the one
    stdin line of the answer; nothing else may be written for it. */
export interface Pending {
	requestId: string;
	tool: string;
	input: Rec;
	answer(allow: boolean): string;
}

export interface DriverIo {
	/** Stores the line (`in`) then writes it to the process. */
	write(line: string): Promise<void>;
	/** A request the user must answer. */
	permission(p: Pending): void;
	/** A request resolved or cancelled by the CLI itself. */
	gone(requestId: string): void;
	turnStarted(): void;
	turnEnded(): void;
	meta(m: Rec): void;
	log(...a: unknown[]): void;
	timers: Timers;
}

export interface Driver {
	init(): Promise<void>;
	message(text: string, images: readonly ClaudeImage[]): Promise<void>;
	/** Stops the turn; pending permissions were denied by the manager first. */
	interrupt(): Promise<void>;
	onLine(v: unknown): void;
	/** The process exited: every request waiting for an answer fails. */
	failAll(e: Error): void;
	/** Codex: the thread of the session, once known. */
	threadId(): string | null;
}

type Waiter = { ok: (v: unknown) => void; ko: (e: Error) => void };

/** A request that got no answer in time (as opposed to an error answer). */
class Timeout extends Error {}

/** Answers to the app's own requests, by id, each with its own deadline. */
function waiters(timers: Timers) {
	const map = new Map<string, Waiter>();
	return {
		wait(id: string, ms: number, what: string): Promise<unknown> {
			return new Promise((ok, ko) => {
				const t = timers.set(() => { map.delete(id); ko(new Timeout(what + " timed out")); }, ms);
				map.set(id, { ok: v => { timers.clear(t); ok(v); }, ko: e => { timers.clear(t); ko(e); } });
			});
		},
		settle(id: string, err: Error | null, v?: unknown): void {
			const w = map.get(id);
			if (!w) return;
			map.delete(id);
			if (err) w.ko(err); else w.ok(v);
		},
		failAll(e: Error): void {
			for (const w of map.values()) w.ko(e);
			map.clear();
		},
	};
}

/** A user line the CLI echoes when it TAKES it (`--replay-user-messages`):
    `{"type":"user",…,"isReplay":true}`. A tool result is a `user` line too,
    without the flag. */
const isReplay = (v: unknown): boolean => !!v && typeof v === "object" && (v as Rec).type === "user" && (v as Rec).isReplay === true;

/* BUSY UNTIL EVERY MESSAGE IS ANSWERED (2026-10-11). A message written while
   Claude works is queued by the CLI, and one `result` may close it or not.
   Measured on Claude Code 2.1.296 with `--replay-user-messages`: each user
   line is echoed (`isReplay`) when the CLI takes it, at the start of the turn
   that answers it; a message taken in the middle of a turn is echoed before
   that turn's `result` (one result for both), one taken after it is echoed
   after it and gets its own turn and `result`; after an interrupt, a message
   still queued is taken and answered anyway. So the session is busy while a
   message was written and not echoed yet, or echoed and not answered yet;
   `turnEnded` is said ONCE, when both are over. A `result` with a message
   still queued belongs to the turn that goes on: the page never ends its
   request on it, and the next request never takes the result meant for the
   message before it. A Stop interrupts every turn a queued message starts
   until the session is idle. A CLI that never echoes (an older version):
   each `result` answers one message, as counted before. */
export function claudeDriver(o: { mode: ModeAgent }, io: DriverIo): Driver {
	const w = waiters(io.timers);
	let next = 1;
	/** Messages written and not echoed back yet. */
	let queued = 0;
	/** A message was taken and its `result` has not come. */
	let answering = false;
	/** The CLI echoes the messages it takes (seen at least once). */
	let echoes = false;
	/** A Stop was asked: every turn until idle is interrupted. */
	let stopping = false;
	const sendInterrupt = (): Promise<void> => io.write(claudeControlLine("nq_" + next++, "interrupt"));
	return {
		async init() {
			const id = "nq_" + next++;
			const answer = w.wait(id, INIT_TIMEOUT_MS, "initialize");
			await io.write(claudeControlLine(id, "initialize"));
			await answer;
		},
		async message(text, images) {
			queued++;
			io.turnStarted();
			try {
				await io.write(claudeUserLine(text, images));
			} catch (e) {
				queued--;
				throw e;
			}
		},
		async interrupt() {
			if (queued > 0 || answering) stopping = true;
			await sendInterrupt();
		},
		onLine(v) {
			const c = parseClaudeControl(v);
			if (!c) {
				if (isReplay(v)) {
					echoes = true;
					queued = Math.max(0, queued - 1);
					answering = true;
					if (stopping) void sendInterrupt().catch(() => undefined);
					return;
				}
				if (v && typeof v === "object" && (v as Rec).type === "result") {
					const busy = queued > 0 || answering;
					answering = false;
					if (!echoes) queued = Math.max(0, queued - 1);
					// A result while idle (an interrupt of nothing) ends no turn.
					if (busy && queued === 0) {
						stopping = false;
						io.turnEnded();
					}
				}
				return;
			}
			if (c.kind === "controlResponse") { w.settle(c.requestId, c.ok ? null : new Error("control request refused")); return; }
			if (c.kind === "cancel") { io.gone(c.requestId); return; }
			if (c.kind === "otherRequest") { void io.write(claudeEmptyControlResponse(c.requestId)).catch(() => undefined); return; }
			const input = c.input;
			const answer = (allow: boolean): string => allow
				? claudePermissionLine(c.requestId, { allow: true, updatedInput: input })
				: claudePermissionLine(c.requestId, { allow: false, message: DENY_MESSAGE });
			if (claudeAutoAllow(o.mode)) { void io.write(answer(true)).catch(() => undefined); return; }
			io.permission({ requestId: c.requestId, tool: c.toolName, input, answer });
		},
		failAll: e => w.failAll(e),
		threadId: () => null,
	};
}

export interface CodexDriverOptions {
	cwd: string;
	model: string;
	effort?: string;
	mode: ModeAgent;
	version: string;
	/** The stored thread of the session: resumed, else a new one. */
	threadId: string | null;
	/** Writes the pictures of a message to files Codex can read. */
	images(images: readonly ClaudeImage[]): Promise<{ path: string }[]>;
}

const SHORT: Record<string, string> = {
	"item/commandExecution/requestApproval": "commandExecution",
	"item/fileChange/requestApproval": "fileChange",
	"item/permissions/requestApproval": "permissions",
};

function plain(v: unknown): Rec | null {
	return v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype ? v as Rec : null;
}

export function codexDriver(o: CodexDriverOptions, io: DriverIo): Driver {
	const w = waiters(io.timers);
	let next = 1;
	let thread: string | null = null;
	let turn: string | null = null;
	/** An interrupt asked while `turn/start` awaited its turn id: sent once known. */
	let interruptWanted = false;
	/** The paths of each file change item, by item id, for Accept edits. */
	const changes = new Map<string, string[]>();
	const sendInterrupt = async (): Promise<void> => {
		interruptWanted = false;
		if (!thread || !turn) return;
		await io.write(codexRequest(next++, "turn/interrupt", codexTurnInterruptParams(thread, turn)));
	};
	const setTurn = (id: string | null): void => {
		if (!id) return;
		turn = id;
		if (interruptWanted) void sendInterrupt().catch(() => undefined);
	};
	const settings = { cwd: o.cwd, model: o.model, mode: o.mode, ...(o.effort ? { effort: o.effort } : {}) };

	async function request(method: CodexMethod, params: Rec, ms: number): Promise<unknown> {
		const id = next++;
		const answer = w.wait(String(id), ms, method);
		await io.write(codexRequest(id, method, params));
		return await answer;
	}

	const threadOf = (r: unknown): string | null => {
		const t = plain(plain(r)?.thread);
		return t && isSafeId(t.id) ? t.id : null;
	};
	const turnOf = (r: unknown): string | null => {
		const t = plain(plain(r)?.turn);
		return t && isSafeId(t.id) ? t.id : null;
	};

	let starting = false;

	async function startTurn(text: string, paths: { path: string }[]): Promise<void> {
		io.turnStarted();
		starting = true;
		try {
			setTurn(turnOf(await request("turn/start", codexTurnStartParams(thread as string, text, paths), TURN_TIMEOUT_MS)));
		} finally {
			starting = false;
		}
	}

	return {
		async init() {
			await request("initialize", codexInitializeParams(o.version), INIT_TIMEOUT_MS);
			await io.write(codexNotification("initialized"));
			if (o.threadId) {
				try {
					thread = threadOf(await request("thread/resume", codexThreadResumeParams(o.threadId, settings), THREAD_TIMEOUT_MS));
				} catch (e) {
					// A thread Codex no longer has: a new one, said in the log and the store.
					io.log("Codex thread/resume failed, starting a new thread:", e instanceof Error ? e.message : e);
					io.meta({ resumeFailed: true });
				}
			}
			if (!thread) thread = threadOf(await request("thread/start", codexThreadStartParams(settings), THREAD_TIMEOUT_MS));
			if (!thread) throw new Error("Codex gave no thread id");
			if (thread !== o.threadId) io.meta({ threadId: thread });
		},
		async message(text, images) {
			const paths = images.length ? await o.images(images) : [];
			if (turn) {
				try {
					await request("turn/steer", codexTurnSteerParams(thread as string, turn, text, paths), TURN_TIMEOUT_MS);
					return;
				} catch (e) {
					// No answer in time: the turn may still run, a new one would race it.
					if (e instanceof Timeout) throw e;
					// Refused (the turn ended meanwhile): the message starts the next one.
					io.log("Codex turn/steer refused, starting a turn:", e instanceof Error ? e.message : e);
				}
			}
			await startTurn(text, paths);
		},
		async interrupt() {
			if (turn) { await sendInterrupt(); return; }
			if (starting) interruptWanted = true;
		},
		onLine(v) {
			const m = parseCodexMessage(v);
			if (!m) {
				const id = malformedRequestId(v);
				if (id !== null) void io.write(codexMethodNotFound(id)).catch(() => undefined);
				return;
			}
			if (m.kind === "response") {
				w.settle(String(m.id), m.error ? new Error(m.error.message || "error " + m.error.code) : null, m.result);
				return;
			}
			if (m.kind === "serverRequest") { void io.write(codexMethodNotFound(m.id)).catch(() => undefined); return; }
			if (m.kind === "approval") {
				const id = m.id;
				const params = m.params;
				const isPermissions = m.method === "item/permissions/requestApproval";
				const answer = (allow: boolean): string => isPermissions
					? codexPermissionsAnswer(id, allow ? plain(params.permissions) ?? {} : null)
					: codexApprovalAnswer(id, allow);
				const itemId = isSafeId(params.itemId) ? params.itemId : null;
				if (codexAutoAccept(o.mode, m.method, params, o.cwd, itemId ? changes.get(itemId) : undefined)) { void io.write(answer(true)).catch(() => undefined); return; }
				io.permission({ requestId: codexRequestKey(id), tool: SHORT[m.method], input: params, answer });
				return;
			}
			const p = m.params;
			if (m.method === "serverRequest/resolved") {
				const id = p.requestId;
				if ((typeof id === "number" && Number.isSafeInteger(id)) || isSafeId(id)) io.gone(codexRequestKey(id as number | string));
				return;
			}
			if (m.method === "item/started" || m.method === "item/fileChange/patchUpdated") {
				const item = m.method === "item/started" ? plain(p.item) : p;
				const id = item ? (m.method === "item/started" ? item.id : item.itemId) : null;
				if (item && isSafeId(id) && (m.method !== "item/started" || item.type === "fileChange")) {
					const paths = changePaths(item.changes);
					// Unreadable changes: forgotten, so the approval is asked.
					if (paths) changes.set(id, paths); else changes.delete(id);
				}
				return;
			}
			if (m.method === "turn/started") { setTurn(turnOf(p)); return; }
			if (m.method === "turn/completed" || m.method === "turn/aborted") {
				turn = null;
				interruptWanted = false;
				changes.clear();
				io.turnEnded();
			}
		},
		failAll: e => w.failAll(e),
		threadId: () => thread,
	};
}
