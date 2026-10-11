/* ══════════════════════════════════════════════════════════
   THE TYPES OF THE LIVE SESSION MANAGER (2026-10-11).

   What `live-sessions.ts` is given (`LiveDeps`, `LiveChild`), what it keeps
   per chat (`Session`, `Proc`) and what it offers (`LiveManager`), split out
   to keep the manager readable. No Node, no Electron.
══════════════════════════════════════════════════════════ */

import type { ModeAgent } from "../../../src/host/claude-outils";
import type { LiveErrorCode, LiveEvent } from "../../../src/host/types";
import type { ClaudeImage } from "./live-claude";
import type { Driver, Pending, Timers } from "./live-drivers";
import type { RunStore } from "./run-store";

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

export interface Proc {
	child: LiveChild;
	driver: Driver;
	alive: boolean;
	reason: "park" | "respawn" | "close" | "failed" | null;
	exited: Promise<void>;
}

export interface Session {
	runId: string;
	tool: "claude" | "codex";
	chatId: string;
	owner: number;
	settings: { model: string; effort?: string; mode: ModeAgent };
	proc: Proc | null;
	/** A spawn is in flight: it holds one of the `MAX_LIVE` places. */
	spawning: boolean;
	/** Set synchronously by close / quit / destroy: nothing runs for it any more. */
	closed: boolean;
	/** The process being killed (park), awaited before the next spawn. */
	exiting: Promise<void> | null;
	pending: Map<string, Pending>;
	/** Turns started and not ended: the session is idle at 0. */
	turns: number;
	/** Claude: a user line was written once, so the next spawn resumes. */
	messageSent: boolean;
	threadId: string | null;
	/** The `seq` of the next stored line. */
	seq: number;
	lastUsed: number;
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

