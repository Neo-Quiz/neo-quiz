/* ══════════════════════════════════════════════════════════
   THE PRIVATE CODEX HOME OF LIVE SESSIONS (2026-10-11).

   A live Codex session (`codex app-server`) runs with its own `CODEX_HOME`,
   `<userData>/codex-home/<account>/`, so its sessions, history and SQLite
   state stay out of the user's `~/.codex` (spec 2026-10-11-live-cli-sessions-
   design, section 6). Everything else is SHARED with the user's Codex home,
   as a terminal would see it: the login (`auth.json`, `secrets/`), the
   configuration (`config.toml`, `hooks.json`, `AGENTS.md`), skills, rules,
   plugins. No second sign-in.

   Port of MonoCode's `codex_mono_store.rs` (`prepare_files`, `link_entry`):
   - a directory of the source is shared by a JUNCTION (no Administrator
     rights nor Developer Mode needed), a file by a HARD LINK. `auth.json` is
     never copied: a copy would be a second login that drifts from the first.
   - `secrets/` is created in the source if absent, then shared as a
     directory: Codex replaces its encrypted files atomically, and a shared
     directory keeps those replacements visible from both homes.
   - a hard link only follows writes made IN PLACE. When the CLI replaces a
     file by rename (write a temporary file, then rename it over), the home
     keeps the old one. Hence: `prepareCodexHome` runs before EVERY spawn of
     the app-server; it replaces a stale hard link by a fresh one (the
     source wins), and removes the home's `auth.json` when the source has
     none (a sign-out from the CLI must sign the app out too).
   Guards: the home is never inside the source nor the reverse (canonical
   paths, so a junction cannot hide it); a private entry of the home that is
   a link fails the preparation BEFORE anything is shared (Codex would write
   its state into the user's home through it); a shared entry that is a link
   to anywhere else, or a real folder in place of a shared one, fails too.

   Measured on codex-cli 0.162.1 (2026-10-11), with the user's `~/.codex`:
   the login is shared (no sign-in), sessions and SQLite files land in the
   private home only, the user's enabled MCP servers start. The user's hooks
   do NOT run: Codex trusts a hook by its ABSOLUTE path
   (`[hooks.state.'<codex home>\hooks.json:…']` in `config.toml`), and the
   same `hooks.json` seen through the private home is another path, so it
   is skipped as untrusted.

   The caller spawns `codex` with the env `CODEX_HOME=<home>`,
   `CODEX_SQLITE_HOME=<home>` and the args of `argsLiveCodex(home)`
   (`gabarits-cli.ts`). Never delete the home with a tool that follows
   junctions: they point into the user's `~/.codex`.

   `npm run check:codex-home` tests it on temporary folders.
══════════════════════════════════════════════════════════ */

import * as fs from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import * as path from "node:path";

/** Codex state that stays in the private home (MonoCode's `STATE_NAMES`). */
export const PRIVATE_ENTRIES: readonly string[] = [
	"sessions",
	"archived_sessions",
	"session_index.jsonl",
	"history.jsonl",
	"log",
	"logs",
	"tmp",
	"shell_snapshots",
	"memories",
	"backups",
];

/** True for an entry of a Codex home that is never shared: one of
    `PRIVATE_ENTRIES`, or a SQLite database and its companions (`*.sqlite*`,
    `*.db`, `*.db-wal`, `*.db-shm`). Case-insensitive: Windows names are. */
export function isPrivateEntry(name: string): boolean {
	const n = name.toLowerCase();
	return PRIVATE_ENTRIES.includes(n) || n.includes(".sqlite") || n.endsWith(".db") || n.endsWith(".db-wal") || n.endsWith(".db-shm");
}

const WINDOWS = process.platform === "win32";

/** A path as compared: absolute, and lower-case on Windows. */
function key(p: string): string {
	const r = path.resolve(p);
	return WINDOWS ? r.toLowerCase() : r;
}

/** True when `child` is `parent` or lies under it. */
function within(child: string, parent: string): boolean {
	const c = key(child), p = key(parent);
	return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

async function lstatOrNull(p: string): Promise<BigIntStats | null> {
	try {
		return await fs.lstat(p, { bigint: true });
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw e;
	}
}

/** The canonical form of a path that may not exist yet: its deepest existing
    ancestor resolved (links followed), then the rest. */
async function canonicalFuture(p: string): Promise<string> {
	let head = path.resolve(p);
	const rest: string[] = [];
	for (;;) {
		try {
			return path.join(await fs.realpath(head), ...rest);
		} catch (e) {
			const parent = path.dirname(head);
			if ((e as NodeJS.ErrnoException).code !== "ENOENT" || parent === head) throw e;
			rest.unshift(path.basename(head));
			head = parent;
		}
	}
}

function assertSeparate(source: string, home: string): void {
	if (within(home, source) || within(source, home)) {
		throw new Error("The private Codex home must be separate from the Codex home");
	}
}

/** True when the link at `target` resolves to where `source` resolves. */
async function resolvesTo(target: string, source: string): Promise<boolean> {
	try {
		return key(await fs.realpath(target)) === key(await fs.realpath(source));
	} catch {
		return false;
	}
}

/** Shares one entry of the source into the home (MonoCode's `link_entry`). */
async function linkEntry(source: string, target: string): Promise<void> {
	let s: BigIntStats;
	try {
		s = await fs.stat(source, { bigint: true });
	} catch (e) {
		// A dangling link in the source: nothing to share.
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
		throw e;
	}
	const t = await lstatOrNull(target);
	if (t?.isSymbolicLink()) {
		if (await resolvesTo(target, source)) return;
		throw new Error("Unexpected link in private Codex home: " + target);
	}
	if (s.isDirectory()) {
		if (t) throw new Error("Unexpected entry in private Codex home: " + target);
		await fs.symlink(source, target, "junction");
		return;
	}
	if (!s.isFile()) return;
	if (t) {
		if (!t.isFile()) throw new Error("Unexpected entry in private Codex home: " + target);
		if (t.ino === s.ino && t.dev === s.dev) return;
		/* A stale hard link (the CLI replaced the source file by rename), or a
		   file Codex wrote in the home: the source wins, as in MonoCode. */
		await fs.unlink(target);
	}
	await fs.link(source, target);
}

async function prepare(sourceIn: string, homeIn: string): Promise<void> {
	// Checked before anything is created, so a refused home leaves no folder in the source.
	assertSeparate(await canonicalFuture(sourceIn), await canonicalFuture(homeIn));
	await fs.mkdir(sourceIn, { recursive: true });
	await fs.mkdir(homeIn, { recursive: true });
	if (!WINDOWS) await fs.chmod(homeIn, 0o700);
	const source = await fs.realpath(sourceIn);
	const home = await fs.realpath(homeIn);
	assertSeparate(source, home);

	// No private entry of the home may lead elsewhere, checked before any link is made.
	const names = new Set([...PRIVATE_ENTRIES, ...(await fs.readdir(home)).filter(isPrivateEntry)]);
	for (const name of names) {
		if ((await lstatOrNull(path.join(home, name)))?.isSymbolicLink()) {
			throw new Error("Codex state must stay in the private Codex home: " + name);
		}
	}

	await fs.mkdir(path.join(source, "secrets"), { recursive: true });
	for (const name of await fs.readdir(source)) {
		if (isPrivateEntry(name)) continue;
		await linkEntry(path.join(source, name), path.join(home, name));
	}
	// A sign-out from the CLI deletes the source's auth.json; the hard link would keep the login alive.
	const auth = await lstatOrNull(path.join(home, "auth.json"));
	if (auth?.isFile() && !(await lstatOrNull(path.join(source, "auth.json")))) {
		await fs.unlink(path.join(home, "auth.json"));
	}
	await fs.mkdir(path.join(home, "sessions"), { recursive: true });
}

/** One preparation at a time per home: two sessions spawned together would
    otherwise race on the same links. */
const pending = new Map<string, Promise<void>>();

/** Prepares (or refreshes) the private Codex home `home` from the user's
    Codex home `source`. Idempotent; call it before every spawn. Throws when a
    guard fails (see the top of this file). */
export function prepareCodexHome(o: { source: string; home: string }): Promise<void> {
	const k = key(o.home);
	const run = (pending.get(k) ?? Promise.resolve()).catch(() => undefined).then(() => prepare(o.source, o.home));
	pending.set(k, run);
	void run.finally(() => { if (pending.get(k) === run) pending.delete(k); }).catch(() => undefined);
	return run;
}
