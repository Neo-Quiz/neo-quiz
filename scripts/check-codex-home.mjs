/**
 * THE PRIVATE CODEX HOME (`apps/windows/electron/codex-home.ts`), on real
 * temporary folders only (never the user's `~/.codex`).
 *
 * What it prevents: a live Codex session that writes its sessions, history or
 * SQLite state into the user's own `~/.codex` (a private entry turned into a
 * link to it, or the private home placed inside it), a second sign-in because
 * `auth.json` was copied instead of shared, a login refreshed by the CLI
 * (replaced by rename) that the private home never sees again, a sign-out that
 * the private home survives, and a configuration link silently re-pointed to
 * another folder.
 *
 *     npm run check:codex-home
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, statSync, lstatSync, realpathSync, readdirSync, readlinkSync, symlinkSync, existsSync, unlinkSync } from "node:fs";
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
	for (const name of ["config.toml", "auth.json", "hooks.json", "state_5.sqlite", "logs_2.sqlite-wal", "x.db", "x.db-wal", "x.db-shm", "history.jsonl", "session_index.jsonl", ".sqlite-maintenance.lock"]) {
		writeFileSync(join(source, name), name);
	}
	return { dir, source, home };
}

const ino = (p) => statSync(p, { bigint: true }).ino;
const sameFile = (a, b) => { const x = statSync(a, { bigint: true }), y = statSync(b, { bigint: true }); return x.ino === y.ino && x.dev === y.dev; };
const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
const real = (p) => realpathSync.native(p);
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
			["sessions", "archived_sessions", "session_index.jsonl", "history.jsonl", "log", "logs", "tmp", "shell_snapshots", "memories", "backups"]);
		r.check("isPrivateEntry: the list, *.sqlite*, *.db, *.db-wal, *.db-shm", [
			"sessions", "logs", "backups", "state_5.sqlite", "logs_2.sqlite-wal", "goals_1.sqlite-shm", ".sqlite-maintenance.lock", "x.db", "x.db-wal", "x.db-shm", "Sessions", "STATE.SQLITE",
		].map(isPrivateEntry), Array(12).fill(true));
		r.check("isPrivateEntry: shared entries", [
			"config.toml", "auth.json", "hooks.json", "skills", "secrets", "AGENTS.md", "rules", "x.dbx", "sessions2", "Sessions.bak", "sqlite",
		].map(isPrivateEntry), Array(11).fill(false));

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
				["state_5.sqlite", "logs_2.sqlite-wal", "x.db", "x.db-wal", "x.db-shm", "history.jsonl", "session_index.jsonl", ".sqlite-maintenance.lock"].filter(x => existsSync(join(home, x)) || isLink(join(home, x))), []);
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
			r.check("a home inside the source throws", (await error(() => prepareCodexHome({ source, home: join(source, "private") }))) !== null, true);
			r.check("and leaves nothing in the source", existsSync(join(source, "private", "config.toml")), false);
			const f2 = fixture();
			r.check("a source inside the home throws", (await error(() => prepareCodexHome({ source: join(f2.home, "account"), home: f2.home }))) !== null, true);
			const f3 = fixture();
			r.check("the same folder throws", (await error(() => prepareCodexHome({ source: f3.source, home: f3.source }))) !== null, true);
			const f4 = fixture();
			mkdirSync(f4.home, { recursive: true });
			symlinkSync(f4.source, join(f4.dir, "alias"), "junction");
			r.check("a home reached through a junction into the source throws",
				(await error(() => prepareCodexHome({ source: f4.source, home: join(f4.dir, "alias", "private") }))) !== null, true);
		}

		// 6. A private entry of the home that is a link throws.
		{
			const { source, home } = fixture();
			mkdirSync(home, { recursive: true });
			symlinkSync(join(source, "sessions"), join(home, "sessions"), "junction");
			r.check("home/sessions pre-created as a junction to the source throws",
				(await error(() => prepareCodexHome({ source, home }))) !== null, true);
			r.check("and nothing was shared before the refusal", existsSync(join(home, "config.toml")), false);
			const f2 = fixture();
			mkdirSync(join(f2.dir, "elsewhere"));
			mkdirSync(f2.home, { recursive: true });
			symlinkSync(join(f2.dir, "elsewhere"), join(f2.home, "state_5.sqlite"), "junction");
			r.check("a *.sqlite entry of the home that is a link throws",
				(await error(() => prepareCodexHome({ source: f2.source, home: f2.home }))) !== null, true);
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
			r.check("a real folder in place of a shared one throws", (await error(() => prepareCodexHome({ source, home }))) !== null, true);
		}

		r.done();
	});
} finally {
	rmSync(base, { recursive: true, force: true });
}
