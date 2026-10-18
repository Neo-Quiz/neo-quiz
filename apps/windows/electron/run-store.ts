/* ══════════════════════════════════════════════════════════
   THE RUN STORE: EVERY LINE OF A LIVE AI SESSION, KEPT ON THE PC (2026-10-11).

   One JSONL file per run of a live Claude Code / Codex session,
   `<userData>/runs/<runId>.jsonl` (spec 2026-10-11-live-cli-sessions-design,
   section 5). Written ONLY by the main process, append-only, as the lines
   flow; never under the synced Neo Quiz root.
   - Line 1: the header (`RunHeader`, `src/host/types.ts`).
   - Then `{"t":<ms>,"dir":"in"|"out","l":<raw JSON line>}` for every line
     sent to or received from the CLI, `{"t":<ms>,"meta":{…}}` for a note of
     the app, and a final `{"t":<ms>,"end":{"code":…,"cancelled":…}}`.
   - Read back tolerantly: a damaged line is skipped; no end line means the
     run was interrupted.
   - Capped at `RUN_CAP_BYTES` per file: past it, lines stop being written and
     ONE marker line `{"t":…,"meta":{"truncated":true}}` says so. Room for the
     marker and the end line is reserved under the cap, so the file never
     grows past it and a capped run still records how it ended.

   Every `runId` is checked against a lowercase UUID BEFORE any path is built:
   it comes from the window through IPC, and `../x` or `C:\x` would otherwise
   be a path outside the store.

   Deleting is DELETING (2026-10-11): the runs are logs the app owns and
   the user asked to delete (a deleted chat, "Delete all"), and they hold
   the content of the user's files and the tools' outputs. A moved copy in
   `<userData>/.trash/runs/` stayed there forever while the settings said
   "0 kB"; `remove` and `removeAll` unlink the files, and purge what an
   earlier version left in that trash.

   Appends to one run go through a per-run promise chain: two lines written
   at once would otherwise interleave, or reach the file out of order, and
   the byte counter would race. Node only (no Electron): the root is a
   parameter, `npm run check:run-store` tests it on a real temp folder.
══════════════════════════════════════════════════════════ */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { RunEvent, RunHeader, RunRead } from "../../../src/host/types";

export const RUN_CAP_BYTES = 100 * 1024 * 1024;

/** A lowercase UUID, nothing else: `crypto.randomUUID()` and the CLIs' ids.
    JS `$` without the `m` flag does not match before a trailing newline. */
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Kept free under the cap for the marker (~46 bytes), the end line (~70
    bytes) and the newline that repairs a torn last line. */
const RESERVE_BYTES = 256;

/** How much of the file end is read to learn, after a restart, whether the
    run was already truncated and whether its last line was torn. */
const TAIL_BYTES = 1024;

/** A tool result is looked up by an id the window sends; past this length it
    cannot be a real one. */
const MAX_TOOL_ID = 256;

/** `seq`: the line's index in its run, given by the writer (the session
    manager), monotonic, stored as `"s"` and read back as `RunEvent.seq`. A
    line the cap drops leaves a gap; the order never changes. */
export type RunRecord = { seq?: number } & (
	| { dir: "in" | "out"; l: unknown }
	| { meta: Record<string, unknown> }
	| { end: { code: number | null; cancelled: boolean } });

export interface RunStore {
	/** Creates `<root>/<runId>.jsonl` with the header if absent; idempotent. */
	open(h: RunHeader): Promise<void>;
	/** Adds one line, stamped `"t": Date.now()`. Rejects on a run never opened. */
	append(runId: string, rec: RunRecord): Promise<void>;
	/** `null` when the run does not exist or its header is unreadable. */
	read(runId: string): Promise<RunRead | null>;
	/** Full text of that tool result (Claude `tool_result`) or command output
	    (Codex `commandExecution`), from the lines RECEIVED only; `null` if none. */
	toolOutput(runId: string, toolUseId: string): Promise<string | null>;
	/** Deletes the runs (and their leftovers in the old trash); an absent
	    run is not an error. With `chatId`, a run whose header names another
	    chat is kept: a synced chat record cannot delete another chat's runs. */
	remove(runIds: readonly string[], chatId?: string): Promise<void>;
	/** Deletes EVERY run file of the store, known to a chat or not, and
	    empties the old trash of runs. `keep`: runs still held by a live
	    session of another window. */
	removeAll(keep?: ReadonlySet<string>): Promise<void>;
	/** Total bytes of the run files of the store. */
	size(): Promise<number>;
}

export interface RunStoreOptions {
	/** Test-only: a smaller cap than `RUN_CAP_BYTES`. */
	capBytes?: number;
}

/** A run file of the store, and nothing else: `<uuid>.jsonl`. */
const RUN_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;
/** A run an earlier version moved to the trash: `<uuid>.jsonl`, or
    `<uuid>-<n>.jsonl` when the name was taken (`fichiers.ts`, `cheminLibre`). */
const TRASHED_RUN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-\d{1,2})?\.jsonl$/;
/** The header line is short; past this, the file is not a run. */
const HEADER_BYTES = 64 * 1024;

function checkRunId(id: unknown): asserts id is string {
	if (typeof id !== "string" || !RUN_ID.test(id)) throw new Error("Invalid run id");
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseLine(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}

/** The header, fields picked one by one (a caller's extra key is not
    stored), in the documented order. */
function pickHeader(h: RunHeader): RunHeader {
	return {
		v: 1, tool: h.tool, model: h.model,
		...(h.effort !== undefined ? { effort: h.effort } : {}),
		mode: h.mode, runId: h.runId, cwd: h.cwd, chatId: h.chatId, start: h.start,
	};
}

function readHeader(o: unknown, runId: string): RunHeader | null {
	if (!isObject(o) || o.v !== 1 || (o.tool !== "claude" && o.tool !== "codex" && o.tool !== "agy") || o.runId !== runId) return null;
	if (typeof o.model !== "string" || typeof o.mode !== "string" || typeof o.cwd !== "string"
		|| typeof o.chatId !== "string" || typeof o.start !== "number") return null;
	if (o.effort !== undefined && typeof o.effort !== "string") return null;
	return pickHeader(o as unknown as RunHeader);
}

/** `fallback`: the seq of a line written without one (before seqs existed):
    one more than the line before, so the order is kept. */
function readEvent(o: unknown, fallback: number): RunEvent | null {
	if (!isObject(o) || typeof o.t !== "number" || !Number.isFinite(o.t)) return null;
	const seq = Number.isSafeInteger(o.s) && (o.s as number) >= 0 ? o.s as number : fallback;
	if (o.dir === "in" || o.dir === "out") return { t: o.t, seq, dir: o.dir, l: o.l };
	if (isObject(o.meta)) return { t: o.t, seq, meta: o.meta };
	if ("end" in o) return { t: o.t, seq, end: o.end };
	return null;
}

/** The `"s"` member of a stored line, when the writer gave one. */
const seqOf = (rec: RunRecord): { s?: number } => (Number.isSafeInteger(rec.seq) && (rec.seq as number) >= 0 ? { s: rec.seq } : {});

function isTruncatedMarker(o: unknown): boolean {
	return isObject(o) && o.dir === undefined && isObject(o.meta) && o.meta.truncated === true;
}

/** Claude: `{type:"user",message:{content:[{type:"tool_result",tool_use_id,content}]}}`,
    `content` a string or text blocks (joined by a newline, other blocks skipped). */
function claudeToolResult(l: unknown, id: string): string | null {
	if (!isObject(l) || l.type !== "user" || !isObject(l.message) || !Array.isArray(l.message.content)) return null;
	for (const b of l.message.content) {
		if (!isObject(b) || b.type !== "tool_result" || b.tool_use_id !== id) continue;
		if (typeof b.content === "string") return b.content;
		if (!Array.isArray(b.content)) return "";
		return b.content
			.filter((c): c is Record<string, unknown> => isObject(c) && c.type === "text" && typeof c.text === "string")
			.map(c => c.text as string)
			.join("\n");
	}
	return null;
}

/** Codex: `{method:"item/completed",params:{item:{type:"commandExecution",id,aggregatedOutput}}}`.
    `aggregatedOutput` is `null` for a command that never ran (declined). */
function codexCommandOutput(l: unknown, id: string): string | null {
	if (!isObject(l) || l.method !== "item/completed" || !isObject(l.params)) return null;
	const item = l.params.item;
	if (!isObject(item) || item.type !== "commandExecution" || item.id !== id) return null;
	return typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : null;
}

interface RunState {
	bytes: number;
	truncated: boolean;
	/** The last line on disk has no newline (a crash mid-write). */
	torn: boolean;
}

export function createRunStore(root: string, options: RunStoreOptions = {}): RunStore {
	const cap = options.capBytes ?? RUN_CAP_BYTES;
	const limit = Math.max(0, cap - RESERVE_BYTES);
	// Where an earlier version MOVED removed runs: purged, never written.
	const oldTrash = path.join(path.dirname(root), ".trash", "runs");
	const queues = new Map<string, Promise<void>>();
	const states = new Map<string, RunState>();

	/** Built only from a CHECKED id. */
	const fileOf = (runId: string) => path.join(root, runId + ".jsonl");

	/** Runs `task` after every earlier task of the same run, whatever their outcome. */
	function enqueue<T>(runId: string, task: () => Promise<T>): Promise<T> {
		const prev = queues.get(runId) ?? Promise.resolve();
		const run = prev.then(task);
		const tail = run.then(() => undefined, () => undefined);
		queues.set(runId, tail);
		void tail.then(() => { if (queues.get(runId) === tail) queues.delete(runId); });
		return run;
	}

	/** The byte counter, from `stat` on first use, and what the file end says. */
	async function stateOf(runId: string): Promise<RunState> {
		const known = states.get(runId);
		if (known) return known;
		const file = fileOf(runId);
		let size: number;
		try {
			size = (await fs.stat(file)).size;
		} catch {
			throw new Error("Run not opened");
		}
		const state: RunState = { bytes: size, truncated: false, torn: false };
		if (size > 0) {
			const h = await fs.open(file, "r");
			try {
				const len = Math.min(size, TAIL_BYTES);
				const buf = Buffer.alloc(len);
				const { bytesRead } = await h.read(buf, 0, len, size - len);
				const tail = buf.subarray(0, bytesRead).toString("utf-8");
				state.torn = !tail.endsWith("\n");
				// The first fragment may be a cut line: only whole lines count.
				const lines = tail.split("\n").slice(len < size ? 1 : 0);
				state.truncated = lines.some(l => isTruncatedMarker(parseLine(l)));
			} finally {
				await h.close();
			}
		}
		states.set(runId, state);
		return state;
	}

	async function write(runId: string, state: RunState, line: string): Promise<void> {
		const text = (state.torn ? "\n" : "") + line + "\n";
		try {
			await fs.appendFile(fileOf(runId), text, { encoding: "utf-8" });
		} catch (e) {
			// A partial write leaves the counter and the torn flag unknown: the
			// next append learns them again from the file.
			states.delete(runId);
			throw e;
		}
		state.bytes += Buffer.byteLength(text, "utf-8");
		state.torn = false;
	}

	/** The header line alone (not the whole run); `null` when unreadable. */
	async function headerOf(runId: string): Promise<RunHeader | null> {
		let h: fs.FileHandle;
		try {
			h = await fs.open(fileOf(runId), "r");
		} catch {
			return null;
		}
		try {
			const buf = Buffer.alloc(HEADER_BYTES);
			const { bytesRead } = await h.read(buf, 0, HEADER_BYTES, 0);
			const text = buf.subarray(0, bytesRead).toString("utf-8");
			const end = text.indexOf("\n");
			return readHeader(parseLine(end < 0 ? text : text.slice(0, end)), runId);
		} finally {
			await h.close();
		}
	}

	/** Deletes the runs an earlier version moved to `<userData>/.trash/runs/`
	    whose id `which` names: run files only, by their exact name. */
	async function purgeOldTrash(which: (runId: string) => boolean): Promise<void> {
		let names: string[];
		try {
			names = await fs.readdir(oldTrash);
		} catch {
			return;
		}
		for (const n of names) {
			const m = TRASHED_RUN.exec(n);
			if (m && which(m[1])) await fs.rm(path.join(oldTrash, n), { force: true });
		}
	}

	async function read(runId: string): Promise<RunRead | null> {
		checkRunId(runId);
		return await enqueue(runId, async () => {
			let text: string;
			try {
				text = await fs.readFile(fileOf(runId), "utf-8");
			} catch {
				return null;
			}
			const lines = text.split("\n");
			const header = readHeader(parseLine(lines[0] ?? ""), runId);
			if (!header) return null;
			const events: RunEvent[] = [];
			for (const line of lines.slice(1)) {
				if (!line) continue;
				const ev = readEvent(parseLine(line), events.length ? events[events.length - 1].seq + 1 : 0);
				if (ev) events.push(ev);
			}
			/* Judged on the LAST lifecycle event: a resumed session appends a
			   `{meta:{spawn}}` line to the same file, so an end line of an
			   EARLIER process says nothing of the last one. A run whose last
			   process crashed reads interrupted. */
			let lastSpawn = -1;
			events.forEach((e, i) => { if (e.meta && isObject(e.meta.spawn)) lastSpawn = i; });
			return {
				header,
				events,
				interrupted: !events.slice(lastSpawn + 1).some(e => e.end !== undefined),
				truncated: events.some(e => e.meta?.truncated === true),
			};
		});
	}

	return {
		async open(h) {
			if (!isObject(h)) throw new Error("Invalid run id");
			checkRunId(h.runId);
			const runId = h.runId;
			await enqueue(runId, async () => {
				await fs.mkdir(root, { recursive: true });
				const text = JSON.stringify(pickHeader(h)) + "\n";
				try {
					await fs.writeFile(fileOf(runId), text, { encoding: "utf-8", flag: "wx" });
				} catch (e) {
					if ((e as NodeJS.ErrnoException).code === "EEXIST") return;
					throw e;
				}
				states.set(runId, { bytes: Buffer.byteLength(text, "utf-8"), truncated: false, torn: false });
			});
		},

		async append(runId, rec) {
			checkRunId(runId);
			await enqueue(runId, async () => {
				const state = await stateOf(runId);
				const t = Date.now();
				if ("end" in rec) {
					// Written even past the cap: its room is reserved.
					const end = { code: typeof rec.end.code === "number" && Number.isFinite(rec.end.code) ? rec.end.code : null, cancelled: rec.end.cancelled === true };
					await write(runId, state, JSON.stringify({ t, ...seqOf(rec), end }));
					return;
				}
				if (state.truncated) return;
				const line = "dir" in rec ? JSON.stringify({ t, ...seqOf(rec), dir: rec.dir, l: rec.l }) : JSON.stringify({ t, ...seqOf(rec), meta: rec.meta });
				if (state.bytes + Buffer.byteLength(line, "utf-8") + 2 > limit) {
					await write(runId, state, JSON.stringify({ t, ...seqOf(rec), meta: { truncated: true } }));
					state.truncated = true;
					return;
				}
				await write(runId, state, line);
			});
		},

		read,

		async toolOutput(runId, toolUseId) {
			checkRunId(runId);
			if (typeof toolUseId !== "string" || !toolUseId || toolUseId.length > MAX_TOOL_ID) return null;
			const run = await read(runId);
			if (!run) return null;
			for (const ev of run.events) {
				// Only what the CLI SENT: a line the app wrote is never a result.
				if (ev.dir !== "out") continue;
				const found = claudeToolResult(ev.l, toolUseId) ?? codexCommandOutput(ev.l, toolUseId);
				if (found !== null) return found;
			}
			return null;
		},

		async remove(runIds, chatId) {
			if (!Array.isArray(runIds)) throw new Error("Invalid run id");
			// Every id checked before the first deletion: a bad one deletes nothing.
			for (const id of runIds) checkRunId(id);
			const deleted = new Set<string>();
			await Promise.all([...new Set(runIds)].map(runId => enqueue(runId, async () => {
				if (chatId !== undefined) {
					const header = await headerOf(runId);
					if (header && header.chatId !== chatId) return;
				}
				states.delete(runId);
				await fs.rm(fileOf(runId), { force: true });
				deleted.add(runId);
			})));
			await purgeOldTrash(id => deleted.has(id));
		},

		async removeAll(keep = new Set()) {
			let names: string[];
			try {
				names = await fs.readdir(root);
			} catch {
				names = [];
			}
			await Promise.all(names.filter(n => RUN_FILE.test(n)).map(n => n.slice(0, -".jsonl".length)).filter(id => !keep.has(id)).map(runId => enqueue(runId, async () => {
				states.delete(runId);
				await fs.rm(fileOf(runId), { force: true });
			})));
			await purgeOldTrash(id => !keep.has(id));
			// The old trash folder itself, once empty (never a non-empty one).
			await fs.rmdir(oldTrash).catch(() => undefined);
		},

		async size() {
			let entries;
			try {
				entries = await fs.readdir(root, { withFileTypes: true });
			} catch {
				return 0;
			}
			let total = 0;
			for (const e of entries) {
				if (!e.isFile()) continue;
				try {
					total += (await fs.stat(path.join(root, e.name))).size;
				} catch {
					// Removed between the listing and the stat: not counted.
				}
			}
			return total;
		},
	};
}
