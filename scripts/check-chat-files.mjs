/**
 * THE CHAT FILES (`apps/windows/src/host/chat-files.ts`) on an in-memory fs
 * with the contract's semantics (rename rejects over an existing target).
 * Prevents: a torn, oversized or foreign file wiping memory or our own file;
 * our own file being written in place (a crash mid-write); another device's
 * file being written; paths leaving the root.
 *     npm run check:chat-files
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

function memFs(files = new Map()) {
	const writes = [];
	return {
		files, writes,
		exists: async (p) => files.has(p),
		read: async (p) => { if (!files.has(p)) throw new Error("ENOENT " + p); return files.get(p); },
		write: async (p, d) => { writes.push(p); files.set(p, d); },
		append: async (p, d) => { writes.push(p); files.set(p, (files.get(p) ?? "") + d); },
		list: async (dir) => [...files.keys()].filter(k => k.startsWith(dir + "/") && !k.slice(dir.length + 1).includes("/")),
		listDir: async (dir) => {
			const names = new Map();
			for (const k of files.keys()) if (k.startsWith(dir + "/")) { const rest = k.slice(dir.length + 1); names.set(rest.split("/")[0], rest.includes("/")); }
			return [...names].map(([name, isFolder]) => ({ name, isFolder }));
		},
		remove: async (p) => { files.delete(p); },
		rename: async (a, b) => { if (files.has(b)) throw new Error("EEXIST " + b); files.set(b, files.get(a)); files.delete(a); },
		mkdirs: async () => {},
	};
}
const quiet = async (f) => { const w = console.warn; console.warn = () => {}; try { return await f(); } finally { console.warn = w; } };

await withSrcModule("apps/windows/src/host/chat-files.ts", async (C) => {
	const r = makeReporter("Chat files");
	const D = "Root/.neo-quiz/chats";
	const rq = (id, over = {}) => ({ id, at: 1, from: "pc", text: "t", mode: "learn", documents: [], results: [], state: "done", ...over });
	const chat = (id, updatedAt, origin, requests = [rq("r")]) => ({ id, origin, createdAt: 1, updatedAt, requests });
	const file = (chats) => JSON.stringify({ v: 1, chats });
	const make = (fs, device = "me") => C.createChatFiles({ fs, rootId: "Root", deviceId: device, now: () => 1000 });

	// 1. Reading
	{
		const fs = memFs(new Map([
			[`${D}/me.json`, file([chat("mine", 5, "me")])],
			[`${D}/pc.json`, file([chat("theirs", 6, "pc", [rq("r", { results: [{ kind: "quiz", title: "T", path: "A/q.md" }] })])])],
		]));
		const cf = make(fs); await cf.load();
		r.check("own and other chats are read apart", [cf.own().map(c => c.id), cf.others().map(l => l.map(c => c.id))], [["mine"], [["theirs"]]]);
		r.check("stored paths come back as contract paths", cf.others()[0][0].requests[0].results[0].path, "Root/A/q.md");
	}
	// 1b. A hostile stored path never leaves the root
	{
		const fs = memFs(new Map([[`${D}/pc.json`, file([chat("h", 1, "pc", [rq("r", { results: [{ kind: "quiz", title: "T", path: "../../x.md" }, { kind: "quiz", title: "U", path: "C:/x.md" }] })])])]]));
		const cf = make(fs); await cf.load();
		r.check("hostile stored paths are blanked on read", cf.others()[0][0].requests[0].results.map(x => x.path), ["", ""]);
	}
	// 2. Bad files are ignored
	{
		const big = JSON.stringify({ v: 1, chats: [chat("x", 1, "pc", [rq("r", { text: "y".repeat(C.MAX_FILE_CHARS) })])] });
		const fs = memFs(new Map([
			[`${D}/a.json`, "{ torn"], [`${D}/b.json`, big], [`${D}/c.json`, JSON.stringify({ v: 2, chats: [chat("c", 1, "pc")] })],
			[`${D}/d.json`, ""], [`${D}/e.json`, file([chat("ok", 1, "pc")])], [`${D}/notes.txt`, "x"],
		]));
		const cf = make(fs); await quiet(() => cf.load());
		r.check("torn, oversized, wrong-version, empty and non-json files are skipped, the good one is read",
			cf.others().flat().map(c => c.id), ["ok"]);
	}
	// 3. Conflict copies are merged read-only, never written
	{
		const fs = memFs(new Map([[`${D}/pc.sync-conflict-20261008-101500-ABCDEFG.json`, file([chat("cc", 1, "pc")])]]));
		const cf = make(fs); await cf.load();
		r.check("a conflict copy is read like any other file", cf.others().flat().map(c => c.id), ["cc"]);
	}
	// 4. A .tmp stands in for a missing .json
	{
		const fs = memFs(new Map([[`${D}/pc.json.tmp`, file([chat("t", 1, "pc")])]]));
		const cf = make(fs); await cf.load();
		r.check("an interrupted swap (only .json.tmp left) is read", cf.others().flat().map(c => c.id), ["t"]);
	}
	// 5. Writing
	{
		const fs = memFs(); const cf = make(fs); await cf.load();
		await cf.saveOwn([chat("m", 5, "me", [rq("r", { results: [{ kind: "quiz", title: "T", path: "Root/A/q.md" }, { kind: "quiz", title: "O", path: "Elsewhere/o.md" }] })])]);
		const written = JSON.parse(fs.files.get(`${D}/me.json`));
		r.check("file has version 1 and relative paths, outside paths blanked", [written.v, written.chats[0].requests[0].results.map(x => x.path)], [1, ["A/q.md", ""]]);
		r.check("written through a temp file, never in place", [fs.writes.includes(`${D}/me.json.tmp`), fs.writes.includes(`${D}/me.json`), fs.files.has(`${D}/me.json.tmp`)], [true, false, false]);
		r.check("only our own file is ever written", fs.writes.every(p => p.includes("/me.json")), true);
		await cf.saveOwn([chat("m", 6, "me")]);
		r.check("a second save replaces the file (rename over an existing target works)", JSON.parse(fs.files.get(`${D}/me.json`)).chats[0].updatedAt, 6);
	}
	// 6. Bound
	{
		const fs = memFs(); const cf = make(fs); await cf.load();
		const many = Array.from({ length: 230 }, (_, i) => chat("c" + i, i, "me"));
		await cf.saveOwn([...many, { ...chat("dead", 1, "me", []), deleted: true }]);
		const saved = JSON.parse(fs.files.get(`${D}/me.json`)).chats;
		r.check("200 newest live chats kept, the tombstone is never dropped", [saved.filter(c => !c.deleted).length, saved.some(c => c.id === "dead")], [200, true]);
	}
	// 7. Our own unreadable file is never replaced by a partial list
	{
		const fs = memFs(new Map([[`${D}/me.json`, "{ torn"]]));
		const cf = make(fs); await quiet(() => cf.load());
		let rejected = false;
		try { await cf.saveOwn([chat("n", 1, "me")]); } catch { rejected = true; }
		r.check("unreadable own file: the save refuses and the bytes are kept aside", [rejected, fs.files.get(`${D}/me.json`), [...fs.files.keys()].some(k => k.includes(".corrupt-"))], [true, "{ torn", true]);
	}
	// 8. refresh reads others only
	{
		const fs = memFs(new Map([[`${D}/me.json`, file([chat("a", 1, "me")])]]));
		const cf = make(fs); await cf.load();
		fs.files.set(`${D}/me.json`, file([chat("tampered", 1, "me")]));
		fs.files.set(`${D}/pc.json`, file([chat("late", 2, "pc")]));
		await cf.refresh();
		r.check("refresh picks up the other device and keeps our memory", [cf.own().map(c => c.id), cf.others().flat().map(c => c.id)], [["a"], ["late"]]);
	}
	// 9. Unreadable folder
	{
		const fs = memFs(); fs.list = async () => { throw new Error("EIO"); };
		const cf = make(fs); await quiet(() => cf.load());
		r.check("a folder that cannot be listed gives empty lists, no throw", [cf.own(), cf.others()], [[], []]);
	}
	// 9b. A failed listing never unlocks a save over an existing own file
	{
		const fs = memFs(new Map([[`${D}/me.json`, file([chat("good", 1, "me")])]]));
		fs.list = async () => { throw new Error("EIO"); };
		const cf = make(fs); await quiet(() => cf.load());
		r.check("a failed listing still reads an existing own file", cf.own().map(c => c.id), ["good"]);
		const fs2 = memFs(new Map([[`${D}/me.json`, "{ torn"]]));
		fs2.list = async () => { throw new Error("EIO"); };
		const cf2 = make(fs2); await quiet(() => cf2.load());
		let rej2 = false;
		try { await cf2.saveOwn([chat("n", 1, "me")]); } catch { rej2 = true; }
		r.check("failed listing and unreadable own file: save refuses, bytes kept", [rej2, fs2.files.get(`${D}/me.json`)], [true, "{ torn"]);
		const fs3 = memFs(); fs3.list = async () => { throw new Error("EIO"); };
		const cf3 = make(fs3); await quiet(() => cf3.load());
		await cf3.saveOwn([chat("n", 1, "me")]);
		r.check("failed listing with no own file: first save is allowed", fs3.files.has(`${D}/me.json`), true);
	}
	// 10. A failed save rejects its own caller only
	{
		const fs = memFs(); const cf = make(fs); await cf.load();
		const realRename = fs.rename; let fail = true;
		fs.rename = async (a, b) => { if (fail) { fail = false; throw new Error("EIO"); } return realRename(a, b); };
		let rejected = false;
		const first = cf.saveOwn([chat("a", 1, "me")]).catch(() => { rejected = true; });
		const second = cf.saveOwn([chat("b", 2, "me")]);
		await first; await second;
		r.check("a failed save does not poison the next one", [rejected, JSON.parse(fs.files.get(`${D}/me.json`)).chats[0].id], [true, "b"]);
	}
	r.done();
});
