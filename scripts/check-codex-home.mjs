/**
 * THE PRIVATE CODEX HOME (`apps/windows/electron/codex-home.ts`), on real
 * temporary folders only (never the user's `~/.codex`).
 *
 * What it prevents: a live Codex session that writes its sessions, history or
 * SQLite state into the user's own `~/.codex` (a private entry turned into a
 * link to it, or the private home placed inside it), a second sign-in because
 * `auth.json` was copied instead of shared, a login refreshed by the CLI
 * (replaced by rename) that the private home never sees again, a sign-out that
 * the private home survives, a configuration link silently re-pointed to
 * another folder, a home prepared by an earlier version (where the thread
 * locks, `.tmp` and `app-server-*` were shared) that fails forever, a login
 * the app-server refreshed by rename in the home that is lost (its old
 * refresh token put back), and the reverse: a newer `codex login` in a
 * terminal overwritten by the home's older account.
 *
 *     npm run check:codex-home
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, statSync, lstatSync, realpathSync, readdirSync, readlinkSync, symlinkSync, existsSync, unlinkSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const base = mkdtempSync(join(tmpdir(), "nq-codex-home-"));
let n = 0;
/** A fresh source (`account`) and home (`private`) under the temp base. */
function fixture() {
	const dir = join(base, String(n++));
	const source = join(dir, "account");
	const home = join(dir, "private");
	mkdirSync(join(source, "skills [shared]"), { recursive: true });
	mkdirSync(join(source, "skills"), { recursive: true });
	mkdirSync(join(source, "sessions"), { recursive: true });
	writeFileSync(join(source, "skills", "skill.txt"), "shared skill");
	writeFileSync(join(source, "sessions", "old.jsonl"), "old");
	for (const d of ["thread-writer-locks", ".tmp", "app-server-control", "app-server-daemon"]) {
		mkdirSync(join(source, d));
		writeFileSync(join(source, d, "keep"), d);
	}
	for (const name of ["config.toml", "auth.json", "hooks.json", "state_5.sqlite", "logs_2.sqlite-wal", "x.db", "x.db-wal", "x.db-shm", "history.jsonl", "session_index.jsonl", ".sqlite-maintenance.lock"]) {
		writeFileSync(join(source, name), name);
	}
	return { dir, source, home };
}

const ino = (p) => statSync(p, { bigint: true }).ino;
const sameFile = (a, b) => { const x = statSync(a, { bigint: true }), y = statSync(b, { bigint: true }); return x.ino === y.ino && x.dev === y.dev; };
const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
const real = (p) => realpathSync.native(p);
const read = (p) => readFileSync(p, "utf8");
/** Sets a file's modification time `s` seconds from now. */
const age = (p, s) => { const t = new Date(Date.now() + s * 1000); utimesSync(p, t, t); };
/** What a CLI does to refresh a login: write a temporary file, rename it over. */
const replaceByRename = (p, text) => { writeFileSync(p + ".tmp", text); renameSync(p + ".tmp", p); };
/** Everything that identifies the home: names, file ids, link targets. */
function snapshot(home) {
	return readdirSync(home).sort().map(name => {
		const p = join(home, name);
		return isLink(p) ? [name, "link", readlinkSync(p)] : [name, lstatSync(p).isDirectory() ? "dir" : "file", String(ino(p))];
	});
}
async function error(f) {
	try { await f(); return null; } catch (e) { return String(e?.message ?? e); }
}

try {
	await withSrcModule("apps/windows/electron/codex-home.ts", async ({ prepareCodexHome, PRIVATE_ENTRIES, isPrivateEntry }) => {
		const r = makeReporter("Private Codex home");

		r.check("the private entries, exactly", PRIVATE_ENTRIES,
			["sessions", "archived_sessions", "session_index.jsonl", "history.jsonl", "log", "logs", "tmp", "shell_snapshots", "memories", "backups", "thread-writer-locks", ".tmp"]);
		const privates = ["sessions", "logs", "backups", "thread-writer-locks", ".tmp", "app-server-control", "app-server-daemon", "App-Server-Daemon", ".neo-quiz-auth-inode",
			"state_5.sqlite", "logs_2.sqlite-wal", "goals_1.sqlite-shm", ".sqlite-maintenance.lock", "x.db", "x.db-wal", "x.db-shm", "Sessions", "STATE.SQLITE"];
		r.check("isPrivateEntry: the list, app-server-*, .neo-quiz-*, *.sqlite*, *.db, *.db-wal, *.db-shm",
			privates.filter(x => !isPrivateEntry(x)), []);
		const shared = ["config.toml", "auth.json", "hooks.json", "skills", "secrets", "AGENTS.md", "rules", "x.dbx", "sessions2", "Sessions.bak", "sqlite",
			"app-server", "x.tmp", "tmp.d", "thread-writer-locks.bak", "neo-quiz-x"];
		r.check("isPrivateEntry: shared entries", shared.filter(isPrivateEntry), []);

		// 1. A first preparation.
		{
			const { source, home } = fixture();
			await prepareCodexHome({ source, home });
			r.check("config.toml and auth.json are hard links, not copies nor symlinks", [
				sameFile(join(home, "config.toml"), join(source, "config.toml")),
				sameFile(join(home, "auth.json"), join(source, "auth.json")),
				sameFile(join(home, "hooks.json"), join(source, "hooks.json")),
				isLink(join(home, "config.toml")), isLink(join(home, "auth.json")),
			], [true, true, true, false, false]);
			r.check("skills is a junction resolving to the source's",
				[isLink(join(home, "skills")), real(join(home, "skills")) === real(join(source, "skills")), readFileSync(join(home, "skills", "skill.txt"), "utf8")],
				[true, true, "shared skill"]);
			r.check("a folder name with spaces and brackets is shared too",
				[isLink(join(home, "skills [shared]")), real(join(home, "skills [shared]")) === real(join(source, "skills [shared]"))], [true, true]);
			r.check("sessions is a real, empty folder of the home",
				[isLink(join(home, "sessions")), lstatSync(join(home, "sessions")).isDirectory(), readdirSync(join(home, "sessions"))], [false, true, []]);
			r.check("no private entry of the source reaches the home",
				["state_5.sqlite", "logs_2.sqlite-wal", "x.db", "x.db-wal", "x.db-shm", "history.jsonl", "session_index.jsonl", ".sqlite-maintenance.lock",
					"thread-writer-locks", ".tmp", "app-server-control", "app-server-daemon"].filter(x => existsSync(join(home, x)) || isLink(join(home, x))), []);
			r.check("secrets/ is created in the source and shared by junction",
				[lstatSync(join(source, "secrets")).isDirectory(), isLink(join(source, "secrets")), isLink(join(home, "secrets")), real(join(home, "secrets")) === real(join(source, "secrets"))],
				[true, false, true, true]);
			writeFileSync(join(home, "secrets", "shared"), "encrypted");
			writeFileSync(join(home, "auth.json"), "refreshed in place");
			writeFileSync(join(home, "sessions", "private.jsonl"), "private");
			r.check("writes through the home: secrets and an in-place login refresh are shared, a session is not", [
				readFileSync(join(source, "secrets", "shared"), "utf8"), readFileSync(join(source, "auth.json"), "utf8"),
				existsSync(join(source, "sessions", "private.jsonl")), readFileSync(join(source, "sessions", "old.jsonl"), "utf8"),
			], ["encrypted", "refreshed in place", false, "old"]);

			// 2. Idempotent.
			const before = snapshot(home);
			await prepareCodexHome({ source, home });
			r.check("a second preparation changes nothing", snapshot(home), before);

			// 3. The CLI replaces auth.json by rename: the old hard link is stale.
			writeFileSync(join(source, "auth.json.tmp"), "new login");
			renameSync(join(source, "auth.json.tmp"), join(source, "auth.json"));
			r.check("after a rename-replace the home's auth.json is stale",
				[sameFile(join(home, "auth.json"), join(source, "auth.json")), readFileSync(join(home, "auth.json"), "utf8")], [false, "refreshed in place"]);
			await prepareCodexHome({ source, home });
			r.check("the next preparation relinks it",
				[sameFile(join(home, "auth.json"), join(source, "auth.json")), readFileSync(join(home, "auth.json"), "utf8")], [true, "new login"]);

			// 4. A sign-out (auth.json removed from the source) reaches the home.
			unlinkSync(join(source, "auth.json"));
			await prepareCodexHome({ source, home });
			r.check("a sign-out removes the home's auth.json", existsSync(join(home, "auth.json")), false);

			// A new entry of the source appears on the next preparation.
			mkdirSync(join(source, "rules"));
			writeFileSync(join(source, "AGENTS.md"), "agents");
			await prepareCodexHome({ source, home });
			r.check("a new shared entry appears on the next preparation",
				[isLink(join(home, "rules")), sameFile(join(home, "AGENTS.md"), join(source, "AGENTS.md"))], [true, true]);
		}

		// 5. The home is never inside the source, nor the reverse.
		{
			const { source } = fixture();
			r.check("a home inside the source throws", (await error(() => prepareCodexHome({ source, home: join(source, "private") }))) ?? "", "The private Codex home must be separate from the Codex home");
			r.check("and leaves nothing in the source", existsSync(join(source, "private", "config.toml")), false);
			const f2 = fixture();
			r.check("a source inside the home throws", (await error(() => prepareCodexHome({ source: join(f2.home, "account"), home: f2.home }))) ?? "", "The private Codex home must be separate from the Codex home");
			const f3 = fixture();
			r.check("the same folder throws", (await error(() => prepareCodexHome({ source: f3.source, home: f3.source }))) ?? "", "The private Codex home must be separate from the Codex home");
			const f4 = fixture();
			mkdirSync(f4.home, { recursive: true });
			symlinkSync(f4.source, join(f4.dir, "alias"), "junction");
			r.check("a home reached through a junction into the source throws",
				(await error(() => prepareCodexHome({ source: f4.source, home: join(f4.dir, "alias", "private") }))) ?? "", "The private Codex home must be separate from the Codex home");
		}

		// 6. A private entry of the home that is a link throws.
		{
			const { source, home } = fixture();
			mkdirSync(home, { recursive: true });
			symlinkSync(join(source, "sessions"), join(home, "sessions"), "junction");
			r.check("home/sessions pre-created as a junction to the source throws",
				(await error(() => prepareCodexHome({ source, home }))) ?? "", "Codex state must stay in the private Codex home: sessions");
			r.check("and nothing was shared before the refusal", existsSync(join(home, "config.toml")), false);
			const f2 = fixture();
			mkdirSync(join(f2.dir, "elsewhere"));
			mkdirSync(f2.home, { recursive: true });
			symlinkSync(join(f2.dir, "elsewhere"), join(f2.home, "state_5.sqlite"), "junction");
			r.check("a *.sqlite entry of the home that is a link throws",
				(await error(() => prepareCodexHome({ source: f2.source, home: f2.home }))) ?? "", "Codex state must stay in the private Codex home: state_5.sqlite");
		}

		// 7. A configuration link pointing elsewhere throws, and stays as it was.
		{
			const { dir, source, home } = fixture();
			const other = join(dir, "other-account");
			mkdirSync(other);
			mkdirSync(home, { recursive: true });
			symlinkSync(other, join(home, "skills"), "junction");
			const message = await error(() => prepareCodexHome({ source, home }));
			r.check("home/skills pre-created as a junction to another folder throws", message?.includes("Unexpected link in private Codex home") ?? false, true);
			r.check("and the link is left untouched", real(join(home, "skills")) === real(other), true);
		}

		// 8. A real folder where the source has a shared folder throws.
		{
			const { source, home } = fixture();
			mkdirSync(join(home, "skills"), { recursive: true });
			r.check("a real folder in place of a shared one throws", (await error(() => prepareCodexHome({ source, home }))) ?? "", "Unexpected entry in private Codex home: " + join(realpathSync.native(home), "skills"));
		}

		// 9. A home from an earlier version: its own junctions on the names made private.
		{
			const { source, home } = fixture();
			mkdirSync(home, { recursive: true });
			for (const d of ["thread-writer-locks", ".tmp", "app-server-control", "app-server-daemon"]) symlinkSync(join(source, d), join(home, d), "junction");
			r.check("old junctions to source/<name> are replaced by private folders", await error(() => prepareCodexHome({ source, home })), null);
			r.check("the private folders are real, empty folders of the home",
				["thread-writer-locks", ".tmp", "app-server-control", "app-server-daemon"].map(d => [isLink(join(home, d)), lstatSync(join(home, d)).isDirectory(), readdirSync(join(home, d)).length]),
				Array(4).fill([false, true, 0]));
			r.check("and the source's folders keep their content",
				["thread-writer-locks", ".tmp", "app-server-control", "app-server-daemon"].map(d => read(join(source, d, "keep"))),
				["thread-writer-locks", ".tmp", "app-server-control", "app-server-daemon"]);

			const f2 = fixture();
			mkdirSync(join(f2.dir, "elsewhere"));
			mkdirSync(f2.home, { recursive: true });
			symlinkSync(join(f2.dir, "elsewhere"), join(f2.home, "app-server-control"), "junction");
			r.check("an app-server-* link to anywhere else still throws",
				(await error(() => prepareCodexHome({ source: f2.source, home: f2.home }))) ?? "", "Codex state must stay in the private Codex home: app-server-control");
			r.check("and is left untouched", real(join(f2.home, "app-server-control")) === real(join(f2.dir, "elsewhere")), true);

			const f3 = fixture();
			mkdirSync(f3.home, { recursive: true });
			symlinkSync(join(f3.source, "app-server-daemon"), join(f3.home, "thread-writer-locks"), "junction");
			r.check("a link to ANOTHER source entry under a migrated name throws",
				(await error(() => prepareCodexHome({ source: f3.source, home: f3.home }))) ?? "", "Codex state must stay in the private Codex home: thread-writer-locks");
		}

		// 10. The login refreshed by rename in the home goes back to the source.
		{
			const { source, home } = fixture();
			await prepareCodexHome({ source, home });
			replaceByRename(join(home, "auth.json"), "refreshed by the app-server");
			age(join(home, "auth.json"), 60);
			await prepareCodexHome({ source, home });
			r.check("a newer home login, source unchanged: written back to the source", read(join(source, "auth.json")), "refreshed by the app-server");
			r.check("and the home is linked to it again", sameFile(join(home, "auth.json"), join(source, "auth.json")), true);
			r.check("the bookkeeping file is never shared nor linked", [isLink(join(home, ".neo-quiz-auth-inode")), existsSync(join(source, ".neo-quiz-auth-inode"))], [false, false]);
			const before = snapshot(home);
			await prepareCodexHome({ source, home });
			r.check("and a further preparation changes nothing", snapshot(home), before);
		}
		{
			// A new `codex login` in a terminal, then the stale home copy refreshed in place by a running session.
			const { source, home } = fixture();
			await prepareCodexHome({ source, home });
			replaceByRename(join(source, "auth.json"), "terminal login");
			writeFileSync(join(home, "auth.json"), "old account refreshed");
			age(join(home, "auth.json"), 60);
			await prepareCodexHome({ source, home });
			r.check("the source replaced since the last preparation: the terminal login wins",
				[read(join(source, "auth.json")), read(join(home, "auth.json")), sameFile(join(home, "auth.json"), join(source, "auth.json"))],
				["terminal login", "terminal login", true]);
		}
		{
			const { source, home } = fixture();
			await prepareCodexHome({ source, home });
			replaceByRename(join(home, "auth.json"), "older home copy");
			age(join(home, "auth.json"), -3600);
			await prepareCodexHome({ source, home });
			r.check("a home copy OLDER than the source: the source wins", [read(join(source, "auth.json")), read(join(home, "auth.json"))], ["auth.json", "auth.json"]);
		}
		{
			const { source, home } = fixture();
			await prepareCodexHome({ source, home });
			rmSync(join(home, ".neo-quiz-auth-inode"));
			replaceByRename(join(home, "auth.json"), "unrecorded");
			age(join(home, "auth.json"), 60);
			await prepareCodexHome({ source, home });
			r.check("no record of the linked source: the source wins", read(join(source, "auth.json")), "auth.json");
		}

		r.done();
	});
} finally {
	rmSync(base, { recursive: true, force: true });
}
