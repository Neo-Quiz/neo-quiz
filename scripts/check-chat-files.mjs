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
	const writes = [], reads = [];
	return {
		files, writes, reads,
		readBounded: async (p, max) => { reads.push(p); if (!files.has(p)) throw new Error("ENOENT " + p); const d = files.get(p); if (Buffer.byteLength(d) > max) throw new Error("file too large"); return d; },
		size: async (p) => files.has(p) ? Buffer.byteLength(files.get(p)) : null,
		exists: async (p) => files.has(p),
		read: async (p) => { reads.push(p); if (!files.has(p)) throw new Error("ENOENT " + p); return files.get(p); },
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
	// 6b. Size cap: the file we write is always one we can read back
	{
		const fs = memFs(); const cf = make(fs); await cf.load();
		const big = Array.from({ length: 200 }, (_, i) => chat("c" + i, i + 1, "me", [rq("r" + i, { results: [{ kind: "text", text: "x".repeat(20000) }] })]));
		await cf.saveOwn([...big, { ...chat("dead", 1, "me", []), deleted: true }]);
		const raw = fs.files.get(`${D}/me.json`);
		const ids = JSON.parse(raw).chats.map(c => c.id);
		r.check("an oversized list is cut under 1.8M characters", raw.length <= 1_800_000, true);
		r.check("the newest chat and the tombstone are kept, the oldest dropped", [ids.includes("c199"), ids.includes("dead"), ids.includes("c0")], [true, true, false]);
		const cf2 = make(fs); await cf2.load();
		r.check("the cut file is read back (not locked, not wiped)", cf2.own().length > 0, true);
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
	// 11. Generations files
	{
		const GD = "Root/.neo-quiz/generations";
		const gen = (at, device) => JSON.stringify({ v: 1, at, running: [{ requestId: "r", chatId: "c", from: device, text: "t", mode: "learn", startedAt: 1, provider: "p", model: "m", progress: { question: 2 } }] });
		const fs = memFs(new Map([[`${GD}/pc.json`, gen(5, "pc")], [`${GD}/bad.json`, "{ torn"], [`${GD}/huge.json`, gen(5, "x") + " ".repeat(100_001)], [`${GD}/me.json`, gen(7, "me")]]));
		const cf = make(fs); await cf.load();
		const seen = await quiet(() => cf.readGenerations());
		r.check("other devices' valid generations files are read, ours, torn and oversized ones skipped", seen.map(s => s.device), ["pc"]);
		await cf.writeGenerations({ v: 1, at: 9, running: [] });
		r.check("our generations file is written through a temp file", [JSON.parse(fs.files.get(`${GD}/me.json`)).at, fs.writes.includes(`${GD}/me.json.tmp`), fs.writes.includes(`${GD}/me.json`)], [9, true, false]);
		await cf.clearGenerations();
		r.check("clearing removes only our file", [fs.files.has(`${GD}/me.json`), fs.files.has(`${GD}/pc.json`)], [false, true]);
		const empty = make(memFs());
		r.check("no generations folder: nothing, no throw", await empty.readGenerations(), []);
		await empty.clearGenerations();
	}
	// 12. Requests
	{
		const ME = "22222222-2222-4222-8222-222222222222", PC = "11111111-1111-4111-8111-111111111111";
		const RD = "Root/.neo-quiz/requests";
		const req = (id, over = {}) => ({ v: 1, id, at: 1, from: ME, target: PC, chatId: "chat-1234", text: "t", mode: "learn", documents: [], ...over });
		const fs = memFs(new Map([
			[`${RD}/${PC}/foreign-1.json`, JSON.stringify(req("foreign-1", { from: PC, target: ME }))],
			[`${RD}/${PC}/bad.json`, "{ torn"],
			[`${RD}/${PC}/big-0001.json`, JSON.stringify("x".repeat(100_001))],
			[`${RD}/${PC}/a.sync-conflict-20261008-1-AB.json`, JSON.stringify(req("dup"))],
			[`${RD}/${PC}/note.txt`, "x"],
			[`${RD}/${PC}/Bad_Name.json`, JSON.stringify(req("Bad_Name"))],
			[`${RD}/not-a-device/odd-0001.json`, JSON.stringify(req("odd-0001"))],
			[`${RD}/${ME}/own-0001.json`, JSON.stringify(req("own-0001"))],
			[`${RD}/${ME}/torn-0001.json`, "{ torn"],
		]));
		const cf = make(fs, ME); await cf.load();
		const incoming = await quiet(() => cf.readIncoming());
		r.check("only other devices' valid-JSON, bounded, non-conflict, slug-named files come in", incoming.map(i => [i.fileDevice, i.fileId]), [[PC, "foreign-1"]]);
		r.check("our own directory is not incoming", incoming.some(i => i.fileDevice === ME), false);
		await cf.writeRequest(req("new-0002"));
		r.check("a request is written under our own directory through a temp file", [fs.files.has(`${RD}/${ME}/new-0002.json`), fs.writes.includes(`${RD}/${ME}/new-0002.json.tmp`), fs.writes.includes(`${RD}/${ME}/new-0002.json`)], [true, true, false]);
		r.check("own valid requests are listed, torn ones not", (await quiet(() => cf.listOwnRequests())).map(q => q.id).sort(), ["new-0002", "own-0001"]);
		const setReq = (id, over = {}) => ({ v: 1, id, kind: "setProvider", from: ME, target: PC, at: Date.now(), provider: "claude-code", ...over });
		await cf.writeRequest(setReq("set-0001"));
		fs.files.set(`${RD}/${ME}/set-bad1.json`, JSON.stringify(setReq("set-bad1", { provider: "ollama" })));
		r.check("a setting request is written like a request and listed apart (a bad one is not)", [fs.files.has(`${RD}/${ME}/set-0001.json`), (await quiet(() => cf.listOwnSettings())).map(q => q.id), (await quiet(() => cf.listOwnRequests())).some(q => q.id === "set-0001")], [true, ["set-0001"], false]);
		const inc2 = await quiet(() => cf.readIncoming());
		await cf.deleteOwnRequest("set-0001"); fs.files.delete(`${RD}/${ME}/set-bad1.json`);
		r.check("our own setting files are never read as incoming", inc2.some(i => i.fileDevice === ME), false);
		await cf.deleteOwnRequest("own-0001");
		r.check("only our request is deleted", [fs.files.has(`${RD}/${ME}/own-0001.json`), fs.files.has(`${RD}/${PC}/foreign-1.json`)], [false, true]);
		let refused = false;
		try { await cf.deleteOwnRequest("../chats/me"); } catch { refused = true; }
		r.check("an id that is not a slug never reaches a path", refused, true);
		refused = false;
		try { await cf.writeRequest(req("big-0003", { text: "y".repeat(100_000) })); } catch { refused = true; }
		r.check("an oversized request (valid id) is refused before writing", [refused, fs.files.has(`${RD}/${ME}/big-0003.json`)], [true, false]);
		refused = false;
		try { await cf.writeRequest(req("../x")); } catch { refused = true; }
		r.check("a request whose id is not a slug is refused", refused, true);
		refused = false;
		try { await cf.writeRequest(req("fake-0004", { from: PC })); } catch { refused = true; }
		r.check("a request claiming another sender is not written under our directory", refused, true);
		// Size first: a huge synced file is never read at all
		const hugeFs = memFs(new Map([
			[`${RD}/${PC}/huge-0001.json`, "x".repeat(4 * 100_000 + 1)],
			[`${RD}/${PC}/ok-00001.json`, JSON.stringify(req("ok-00001", { from: PC, target: ME }))],
			["Root/.neo-quiz/generations/pc.json", "x".repeat(4 * 100_000 + 1)],
			[`${D}/pc.json`, "x".repeat(4 * C.MAX_FILE_CHARS + 1)],
		]));
		const hcf = make(hugeFs, ME); await quiet(() => hcf.load());
		const hin = await quiet(() => hcf.readIncoming()); await quiet(() => hcf.readGenerations());
		r.check("a request, generations or chat file past its byte cap is never read", [hugeFs.reads.filter(p => p.includes("huge") || p.endsWith("generations/pc.json") || p === `${D}/pc.json`), hin.map(i => i.fileId)], [[], ["ok-00001"]]);
		// Flood: bounded senders and files per scan
		const flood = new Map();
		for (let i = 0; i < 1000; i++) flood.set(`${RD}/${PC}/f${String(i).padStart(5, "0")}.json`, JSON.stringify(req("f" + i, { from: PC, target: ME })));
		for (let d = 0; d < 20; d++) flood.set(`${RD}/aaaaaaaa-aaaa-4aaa-8aaa-${String(d).padStart(12, "0")}/x-00001.json`, JSON.stringify(req("x-00001", { target: ME })));
		const floodFs = memFs(flood);
		const fin = await quiet(() => make(floodFs, ME).readIncoming());
		r.check("1000 request files and 20 sender folders: at most 8 senders x 20 files are read", [floodFs.reads.length <= 8 * 20, fin.length <= 160], [true, true]);
		r.check("the first names are the ones examined, no more than 20 per sender", [fin.filter(i => i.fileDevice === PC).length, fin.find(i => i.fileDevice === PC)?.fileId], [20, "f00000"]);
		// A file that grows after its size check: the bounded read itself refuses it
		const liar = memFs(new Map([[`${RD}/${PC}/grow-0001.json`, "x".repeat(4 * 100_000 + 1)]]));
		liar.size = async () => 10; let unbounded = false; const rawRead = liar.read; liar.read = async (p) => { unbounded = true; return rawRead(p); };
		r.check("a file that outgrew its size check is refused by the bounded read, never read unbounded", [await quiet(() => make(liar, ME).readIncoming()), unbounded], [[], false]);
		const none = make(memFs(), ME);
		r.check("no requests folder: nothing, no throw", [await none.readIncoming(), await none.listOwnRequests()], [[], []]);
	}
	{ // Device files: read bounded and strictly, never our own, never a conflict copy; ours written through a temp file
		const DD = "Root/.neo-quiz/devices";
		const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ME2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
		const dev = (id, over = {}) => JSON.stringify({ v: 1, device: id, name: "Aero", kind: "laptop", claudeModels: [{ id: "opus", label: "Opus" }], updatedAt: 1, ...over });
		const fs2 = memFs(new Map([
			[DD + "/" + A + ".json", dev(A)],
			[DD + "/" + B + ".json", "{ torn"],
			[DD + "/" + ME2 + ".json", dev(ME2)],
			[DD + "/" + A + ".sync-conflict-20260101-000000-ABCDEFG.json", dev(A, { name: "Copy" })],
			[DD + "/huge.json", "x".repeat(200_000)],
			[DD + "/dddddddd-dddd-4ddd-8ddd-dddddddddddd.json", dev(A)],
		]));
		const seen = await quiet(() => make(fs2, ME2).readDevices());
		r.check("other devices' valid device files are read; ours, torn, conflict copies, foreign names and mismatches are skipped", seen.map(d => d.device), [A]);
		const big = memFs(new Map([[DD + "/" + A + ".json", "x".repeat(4 * 20_000 + 1)]]));
		r.check("an oversized device file is never read", [await quiet(() => make(big, ME2).readDevices()), big.reads.length], [[], 0]);
		const w = memFs(); const mine = make(w, ME2);
		await mine.writeDevice({ v: 1, device: ME2, name: "Aero", kind: "desktop", claudeModels: [], updatedAt: 3 });
		r.check("our device file is written through a temp file, never in place", [JSON.parse(w.files.get(DD + "/" + ME2 + ".json")).kind, w.writes.includes(DD + "/" + ME2 + ".json.tmp"), w.writes.includes(DD + "/" + ME2 + ".json")], ["desktop", true, false]);
		r.check("no devices folder: nothing, no throw", await make(memFs(), ME2).readDevices(), []);
	}
	r.done();
});
