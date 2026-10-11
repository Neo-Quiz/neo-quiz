/**
 * The RUN STORE of the Electron main process (`apps/windows/electron/run-store.ts`,
 * spec 2026-10-11-live-cli-sessions-design, section 5): one JSONL file per
 * live Claude Code / Codex run, kept forever on the PC.
 *
 * Runs on a REAL temp folder (`fs.mkdtemp`), removed in a `finally`. Defects
 * it prevents: a run id that becomes a path (`../x` writes outside the store),
 * two concurrent appends whose lines interleave (the file becomes unreadable
 * from that point), a run that grows past its cap, a damaged line that makes
 * the whole run unreadable, a tool output that cannot be found again.
 *
 *     npm run check:run-store
 */
import { mkdtemp, rm, readFile, readdir, writeFile, appendFile, stat, mkdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/** An unexpected exception becomes a NAMED failure instead of killing the script. */
async function cas(r, nom, fn) {
	try {
		await fn();
	} catch (e) {
		r.check(nom, "EXCEPTION: " + (e && e.message ? e.message : String(e)), "no exception");
	}
}

async function rejects(fn) {
	try {
		await fn();
		return null;
	} catch (e) {
		return e && e.message ? e.message : String(e);
	}
}

/** Every entry under `dir`, recursively, as relative paths. */
async function tree(dir, prefix = "") {
	let out = [];
	let entries;
	try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
	for (const e of entries) {
		const rel = prefix + e.name;
		out.push(rel);
		if (e.isDirectory()) out = out.concat(await tree(join(dir, e.name), rel + "/"));
	}
	return out.sort();
}

const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const header = (runId, tool = "claude") => ({ v: 1, tool, model: "m", effort: "low", mode: "supervised", runId, cwd: "C:/x", chatId: "c1", start: 1 });

await withSrcModule("apps/windows/electron/run-store.ts", async ({ createRunStore, RUN_CAP_BYTES }) => {
	const r = makeReporter("Run store");
	const dir = await mkdtemp(join(tmpdir(), "nq-runs-"));
	try {
		r.check("the cap is 100 MB", RUN_CAP_BYTES, 100 * 1024 * 1024);

		await cas(r, "open + 3 appends + end reads back in order", async () => {
			const root = join(dir, "a", "runs");
			const store = createRunStore(root);
			await store.open(header(ID(1)));
			await store.open(header(ID(1))); // idempotent: no second header
			await store.append(ID(1), { dir: "in", l: { n: 1 } });
			await store.append(ID(1), { dir: "out", l: { n: 2 } });
			await store.append(ID(1), { meta: { k: "v" } });
			await store.append(ID(1), { end: { code: 0, cancelled: false } });
			const text = await readFile(join(root, ID(1) + ".jsonl"), "utf-8");
			const got = await store.read(ID(1));
			r.check("open + 3 appends + end reads back in order", [
				text.split("\n").filter(Boolean).length,
				got.header,
				got.events.map((e) => e.dir ?? (e.meta ? "meta" : "end")),
				got.events.every((e) => typeof e.t === "number" && e.t > 0),
				got.events[0].l, got.events[2].meta, got.events[3].end,
				got.interrupted, got.truncated,
			], [5, header(ID(1)), ["in", "out", "meta", "end"], true, { n: 1 }, { k: "v" }, { code: 0, cancelled: false }, false, false]);
		});

		await cas(r, "no end line reads as interrupted; unknown run reads as null", async () => {
			const store = createRunStore(join(dir, "b"));
			await store.open(header(ID(2)));
			await store.append(ID(2), { dir: "out", l: "x" });
			const got = await store.read(ID(2));
			r.check("no end line reads as interrupted; unknown run reads as null",
				[got.interrupted, got.events.length, await store.read(ID(99))], [true, 1, null]);
		});

		await cas(r, "a damaged line is skipped, the others are read", async () => {
			const root = join(dir, "c");
			const store = createRunStore(root);
			await store.open(header(ID(3)));
			await store.append(ID(3), { dir: "out", l: 1 });
			await appendFile(join(root, ID(3) + ".jsonl"), '{"t":1,\n');
			await appendFile(join(root, ID(3) + ".jsonl"), '[1,2]\n{"t":"x","dir":"out"}\n');
			await store.append(ID(3), { dir: "out", l: 2 });
			await store.append(ID(3), { end: { code: null, cancelled: true } });
			const got = await store.read(ID(3));
			r.check("a damaged line is skipped, the others are read",
				[got.events.map((e) => e.l ?? e.end), got.interrupted], [[1, 2, { code: null, cancelled: true }], false]);
		});

		await cas(r, "a line torn by a crash does not swallow the next append", async () => {
			const root = join(dir, "c2");
			await createRunStore(root).open(header(ID(4)));
			await appendFile(join(root, ID(4) + ".jsonl"), '{"t":1,"dir":"out","l":"torn');
			// A NEW store: the process restarted after the crash.
			const store = createRunStore(root);
			await store.append(ID(4), { dir: "out", l: "after" });
			const got = await store.read(ID(4));
			r.check("a line torn by a crash does not swallow the next append", got.events.map((e) => e.l), ["after"]);
		});

		await cas(r, "past the cap: one marker line, never over, later appends are no-ops", async () => {
			const cap = 2048;
			const root = join(dir, "d");
			const store = createRunStore(root, { capBytes: cap });
			await store.open(header(ID(5)));
			for (let i = 0; i < 40; i++) await store.append(ID(5), { dir: "out", l: "x".repeat(100) + i });
			const file = join(root, ID(5) + ".jsonl");
			const sizeAtCap = (await stat(file)).size;
			const lines = (await readFile(file, "utf-8")).split("\n").filter(Boolean);
			const markers = lines.filter((l) => l.includes('"truncated":true'));
			await store.append(ID(5), { dir: "out", l: "late" });
			await store.append(ID(5), { meta: { late: true } });
			const sizeAfter = (await stat(file)).size;
			// A restarted store must not write a second marker.
			const store2 = createRunStore(root, { capBytes: cap });
			await store2.append(ID(5), { dir: "out", l: "y".repeat(1500) });
			const sizeAfterRestart = (await stat(file)).size;
			const got = await store2.read(ID(5));
			r.check("past the cap: one marker line, never over, later appends are no-ops", [
				sizeAtCap <= cap, markers.length, /^\{"t":\d+,"meta":\{"truncated":true\}\}$/.test(markers[0] ?? ""),
				lines[lines.length - 1] === markers[0], sizeAfter === sizeAtCap, sizeAfterRestart === sizeAtCap,
				got.truncated, got.interrupted,
			], [true, 1, true, true, true, true, true, true]);
		});

		await cas(r, "the end line is still written after the cap", async () => {
			const root = join(dir, "d2");
			const store = createRunStore(root, { capBytes: 2048 });
			await store.open(header(ID(6)));
			// Filled with small lines up to the cap, then ended: marker AND end
			// line fit under the cap, their room is reserved.
			for (let i = 0; i < 40; i++) await store.append(ID(6), { dir: "out", l: "z".repeat(100) + i });
			await store.append(ID(6), { end: { code: 1, cancelled: false } });
			const size = (await stat(join(root, ID(6) + ".jsonl"))).size;
			const got = await store.read(ID(6));
			r.check("the end line is still written after the cap",
				[got.truncated, got.interrupted, got.events.at(-1).end, size <= 2048], [true, false, { code: 1, cancelled: false }, true]);
		});

		await cas(r, "50 concurrent appends: 50 whole lines, in call order", async () => {
			const root = join(dir, "e");
			const store = createRunStore(root);
			await store.open(header(ID(7)));
			const big = "w".repeat(20000);
			await Promise.all(Array.from({ length: 50 }, (_, i) => store.append(ID(7), { dir: "out", l: { i, big } })));
			const lines = (await readFile(join(root, ID(7) + ".jsonl"), "utf-8")).split("\n").filter(Boolean).slice(1);
			let valid = 0;
			const order = [];
			for (const l of lines) {
				try { const o = JSON.parse(l); valid++; order.push(o.l.i); } catch { /* interleaved */ }
			}
			r.check("50 concurrent appends: 50 whole lines, in call order",
				[lines.length, valid, order.join(",")], [50, 50, Array.from({ length: 50 }, (_, i) => i).join(",")]);
		});

		await cas(r, "a bad run id throws before any path is built, and creates nothing", async () => {
			const parent = await mkdtemp(join(tmpdir(), "nq-runs-bad-"));
			try {
				const store = createRunStore(join(parent, "runs"));
				const bad = ["../x", "C:\\x", "a/b", "", "0".repeat(37), ID(8).toUpperCase() + "/..", ID(8) + "\n", 5, null];
				const msgs = [];
				for (const id of bad) {
					msgs.push(await rejects(() => store.open({ ...header(ID(8)), runId: id })));
					msgs.push(await rejects(() => store.append(id, { dir: "in", l: 1 })));
					msgs.push(await rejects(() => store.read(id)));
					msgs.push(await rejects(() => store.toolOutput(id, "t1")));
					msgs.push(await rejects(() => store.remove([ID(8), id])));
				}
				r.check("a bad run id throws before any path is built, and creates nothing",
					[msgs.every((m) => m === "Invalid run id"), await tree(parent)], [true, []]);
			} finally {
				await rm(parent, { recursive: true, force: true });
			}
		});

		await cas(r, "toolOutput finds a Claude tool_result and a Codex command output", async () => {
			const store = createRunStore(join(dir, "f"));
			await store.open(header(ID(9)));
			await store.append(ID(9), { dir: "out", l: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "A" }, { type: "image", source: {} }, { type: "text", text: "B" }] }] } } });
			await store.append(ID(9), { dir: "out", l: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "plain", is_error: true }] } } });
			// Real lines of the fixtures: a declined Claude tool, a failed Codex command.
			const claude = (await readFile("scripts/fixtures/live/claude-session.jsonl", "utf-8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
			const codex = (await readFile("scripts/fixtures/live/codex-session.jsonl", "utf-8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
			for (const rec of [...claude, ...codex]) await store.append(ID(9), { dir: rec.dir, l: rec.l });
			// A line SENT to the CLI that looks like a result is never one.
			await store.append(ID(9), { dir: "in", l: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t3", content: "forged" }] } } });
			r.check("toolOutput finds a Claude tool_result and a Codex command output", [
				await store.toolOutput(ID(9), "t1"),
				await store.toolOutput(ID(9), "t2"),
				await store.toolOutput(ID(9), "toolu_01BXPw8Aq3hgjyEa6y6jNgBx"),
				await store.toolOutput(ID(9), "<EXEC_2>"),
				await store.toolOutput(ID(9), "<EXEC_1>"),
				await store.toolOutput(ID(9), "t3"),
				await store.toolOutput(ID(9), "nope"),
				await store.toolOutput(ID(99), "t1"),
			], ["A\nB", "plain", "User declined tool execution.", "Failed to create unified exec process: helper_unknown_error: setup refresh had errors", null, null, null, null]);
		});

		await cas(r, "remove moves the runs to the trash and size goes down", async () => {
			const root = join(dir, "g", "runs");
			const binDir = join(dir, "g-bin");
			await mkdir(binDir, { recursive: true });
			const calls = [];
			const trash = async (abs, racine) => { calls.push([abs, racine]); await rename(abs, join(binDir, abs.split(/[\\/]/).pop())); };
			const store = createRunStore(root, { trash });
			r.check("size of a store that does not exist yet is 0", await store.size(), 0);
			for (const n of [10, 11, 12]) {
				await store.open(header(ID(n)));
				await store.append(ID(n), { dir: "out", l: "q".repeat(500) });
			}
			const before = await store.size();
			const s10 = (await stat(join(root, ID(10) + ".jsonl"))).size;
			await store.remove([ID(10), ID(11), ID(13)]); // 13 never existed: not an error
			const after = await store.size();
			r.check("remove moves the runs to the trash and size goes down", [
				before > 3 * 500, after < before, before - after >= 2 * s10 - 10,
				(await readdir(root)).sort(), (await readdir(binDir)).sort(), calls.length, calls.every(([, rc]) => rc === join(dir, "g")),
				await store.read(ID(10)),
			], [true, true, true, [ID(12) + ".jsonl"], [ID(10) + ".jsonl", ID(11) + ".jsonl"], 2, true, null]);
		});

		await cas(r, "the default trash is the main-process primitive, outside the store", async () => {
			const root = join(dir, "h", "runs");
			const store = createRunStore(root);
			await store.open(header(ID(14)));
			await store.remove([ID(14)]);
			r.check("the default trash is the main-process primitive, outside the store",
				[await tree(join(dir, "h")), await store.size()],
				[[".trash", ".trash/runs", ".trash/runs/" + ID(14) + ".jsonl", "runs"], 0]);
		});

		await cas(r, "a damaged header reads as null", async () => {
			const root = join(dir, "i");
			await mkdir(root, { recursive: true });
			await writeFile(join(root, ID(15) + ".jsonl"), '{"v":1,"tool":\n{"t":1,"dir":"out","l":1}\n');
			r.check("a damaged header reads as null", await createRunStore(root).read(ID(15)), null);
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
	r.done();
});
