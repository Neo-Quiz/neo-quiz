import type { LogLine } from "../scheduler";
import { LOG_PREFIX } from "../branding";
import { createLogFile } from "./log-file";
import type { LogFile, LogFileFs } from "./log-file";
import { deviceLogName, isConflictCopy } from "./paths";

/* ══════════════════════════════════════════════════════════
   ONE REVIEW LOG PER DEVICE

   Several devices sync the same folder with Syncthing. Two devices appending
   to one `review-log.jsonl` make Syncthing park one version as a
   `.sync-conflict-*` copy, and half the history disappears from view. So each
   device appends ONLY to its own `<dir>/<deviceId>.jsonl` (a file no other
   device ever writes, hence nothing to conflict on) and every device READS
   all of them, plus the legacy single log, which is read-only from now on.

   Merge: a stable sort on `at`. Every `LogLine` kind carries `at` (the parser
   rejects a line without it), but a line without a usable `at` would go first,
   in file order. The sort matters because a rename written on one device must
   catch the answers written earlier on another (`applyRenames` sorts by `at`
   as well; sorting here keeps `lines()` meaningful on its own).

   Deliberately NOT done: no deduplication across files (a legacy line and the
   same line in a device file stay two lines; `createLogFile` still dedups
   inside ONE file) and the legacy lines are never copied into a device file.
   Conflict copies of a device file (`A.sync-conflict-*.jsonl`) are ignored,
   neither read nor deleted.

   The directory is listed at EVERY `load()`: a device file that syncs in
   later is picked up by calling `load()` again (the app does, when Syncthing
   reports that another device's changes landed). A second `load()` re-reads
   each file (`createLogFile.load` merges what it reads with what it holds, so
   our own lines still waiting to be written survive) and never opens a file
   twice: the set of known paths outlives a call.
══════════════════════════════════════════════════════════ */

export interface JournalSetDeps {
	fs: LogFileFs;
	/** The legacy single log (read only). */
	legacyPath: string;
	/** The directory holding one `<deviceId>.jsonl` per device. */
	dir: string;
	deviceId: string;
}

export function createJournalSet(deps: JournalSetDeps): LogFile {
	const ownPath = `${deps.dir}/${deviceLogName(deps.deviceId)}`;
	const own = createLogFile({ fs: deps.fs, path: ownPath });
	const legacy = createLogFile({ fs: deps.fs, path: deps.legacyPath });
	const others: LogFile[] = [];
	/** Paths already opened, across `load()` calls. */
	const known = new Set<string>([ownPath]);
	let listed = false;
	let destroyed = false;
	let cache: LogLine[] | null = null;

	const all = (): LogFile[] => [legacy, ...others, own];

	async function load(): Promise<void> {
		let names: string[] = [];
		try { names = await deps.fs.list(deps.dir); } catch { /* missing directory = no device file yet */ }
		for (const full of names) {
			const name = full.slice(full.lastIndexOf("/") + 1);
			if (!name.endsWith(".jsonl") || isConflictCopy(name)) continue;
			const path = `${deps.dir}/${name}`;
			if (known.has(path)) continue;
			known.add(path);
			others.push(createLogFile({ fs: deps.fs, path }));
		}
		listed = true;
		/* One unreadable file must not hide the others: `createLogFile.load`
		   already swallows its own errors, the catch is for anything else. */
		await Promise.all(all().map(async f => {
			try { await f.load(); } catch (e) { console.warn(`${LOG_PREFIX} review journal unreadable`, e); }
		}));
		cache = null;
	}

	function lines(): LogLine[] {
		if (cache) return cache;
		const withAt: Array<{ l: LogLine; i: number }> = [];
		const withoutAt: LogLine[] = [];
		let i = 0;
		for (const f of all()) {
			for (const l of f.lines()) {
				if (typeof l.at === "number" && Number.isFinite(l.at)) withAt.push({ l, i: i++ });
				else withoutAt.push(l);
			}
		}
		withAt.sort((a, b) => a.l.at - b.l.at || a.i - b.i);
		return (cache = [...withoutAt, ...withAt.map(x => x.l)]);
	}

	return {
		load,
		lines,
		loaded: () => listed && all().every(f => f.loaded()),
		append(lot) {
			if (!lot.length) return;
			cache = null;
			own.append(lot);
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			for (const f of all()) f.destroy();
		},
	};
}
