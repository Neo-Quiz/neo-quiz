/**
 * EXAMS AND ATTEMPTS PER DEVICE IN THE SYNCED FOLDER.
 * Part 1: the pure merge (`src/shared-state/merge.ts`). Part 2: the Windows
 * host (`apps/windows/src/host/shared-state.ts`) on an in-memory fs: files
 * per root and device, the one-time migration, conflict copies, moves.
 *     npm run check:shared-state
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const ex = (id, date, modifiedAt, extra = {}) => ({ id, nom: id, date, modifiedAt, ...extra });
const plain = (id, date) => ({ id, nom: id, date });

await withSrcModule(["src/shared-state/merge.ts", "src/dashboard/stats-store.ts"], ({ mergeExams, foldAttempts, mergeModules, diffModules, rebaseModules, resoudreCleExamens }, ss) => {
	const r = makeReporter("Shared state - merge");

	r.check("newer edit beats older edit across devices",
		mergeExams([{ "A/m": [ex("e1", "2026-01-01", 10)] }, { "A/m": [ex("e1", "2026-02-02", 20)] }]),
		{ "A/m": [plain("e1", "2026-02-02")] });
	r.check("the order of the devices does not matter",
		mergeExams([{ "A/m": [ex("e1", "2026-02-02", 20)] }, { "A/m": [ex("e1", "2026-01-01", 10)] }]),
		{ "A/m": [plain("e1", "2026-02-02")] });
	r.check("a newer tombstone removes the exam (and the empty module key)",
		mergeExams([{ "A/m": [ex("e1", "2026-01-01", 10)] }, { "A/m": [ex("e1", "2026-01-01", 30, { deleted: true })] }]),
		{});
	r.check("an older tombstone loses to a newer edit",
		mergeExams([{ "A/m": [ex("e1", "2026-01-01", 5, { deleted: true })] }, { "A/m": [ex("e1", "2026-03-03", 10)] }]),
		{ "A/m": [plain("e1", "2026-03-03")] });
	r.check("two devices adding different exams: both, sorted by date",
		mergeExams([{ "A/m": [ex("b", "2026-05-01", 1)] }, { "A/m": [ex("a", "2026-04-01", 2)], "B/n": [ex("c", "2026-06-01", 3)] }]),
		{ "A/m": [plain("a", "2026-04-01"), plain("b", "2026-05-01")], "B/n": [plain("c", "2026-06-01")] });
	r.check("extra fields (weight, sessions) survive, modifiedAt does not",
		mergeExams([{ "A/m": [ex("e", "2026-01-02", 1, { coefficient: 3, seances: ["2026-01-01", "2026-01-02"] })] }]),
		{ "A/m": [{ id: "e", nom: "e", date: "2026-01-02", coefficient: 3, seances: ["2026-01-01", "2026-01-02"] }] });
	r.check("a tie on modifiedAt: the tombstone wins, whatever the order",
		[mergeExams([{ "A/m": [ex("e", "2026-01-01", 5)] }, { "A/m": [ex("e", "2026-01-01", 5, { deleted: true })] }]),
			mergeExams([{ "A/m": [ex("e", "2026-01-01", 5, { deleted: true })] }, { "A/m": [ex("e", "2026-01-01", 5)] }])],
		[{}, {}]);

	const add = (path, date, pct, at, extra = {}) => ({ t: "add", path, attempt: { date, pct }, at, ...extra });
	const del = (path, date, at) => ({ t: "del", path, date, at });
	r.check("add on A, delete on B later: gone",
		foldAttempts([add("A/q.md", 100, 50, 1000), del("A/q.md", 100, 2000)]), {});
	r.check("delete BEFORE add (clock skew): the attempt stays",
		foldAttempts([del("A/q.md", 100, 500), add("A/q.md", 100, 50, 1000)]),
		{ "A/q.md": [{ date: 100, pct: 50 }] });
	r.check("events are sorted by `at`, not by input order",
		foldAttempts([add("A/q.md", 100, 50, 1000), del("A/q.md", 100, 2000), add("A/q.md", 100, 50, 3000)]),
		{ "A/q.md": [{ date: 100, pct: 50 }] });
	r.check("an attempt is identified by (path, date): same date elsewhere is another attempt",
		foldAttempts([add("A/q.md", 100, 50, 1), add("A/r.md", 100, 60, 2), del("A/q.md", 100, 3)]),
		{ "A/r.md": [{ date: 100, pct: 60 }] });
	r.check("the same add twice (migration retried) is one attempt",
		foldAttempts([add("A/q.md", 100, 50, 1), add("A/q.md", 100, 50, 2)]),
		{ "A/q.md": [{ date: 100, pct: 50 }] });
	r.check("attempts come most recent first",
		foldAttempts([add("A/q.md", 100, 1, 1), add("A/q.md", 300, 2, 2), add("A/q.md", 200, 3, 3)])["A/q.md"].map(x => x.date),
		[300, 200, 100]);

	// Best score derived from the folded list drops when the best attempt is deleted.
	const evts = [add("A/q.md", 100, 40, 1), add("A/q.md", 200, 90, 2), add("A/q.md", 300, 60, 3)];
	const best = (e) => ss.recalculer({ bestScore: 0, questionsDone: 5, totalQuestions: 10, lastPlayed: 0, attempts: 0 }, foldAttempts(e)["A/q.md"]).bestScore;
	r.check("best score drops when the best attempt is deleted on another device",
		[best(evts), best([...evts, del("A/q.md", 200, 4)])], [90, 60]);

	const f = (v, at) => (v === undefined ? { at } : { v, at });
	r.check("modules: per field, the newest wins, whatever the order",
		[mergeModules([{ K: { name: f("a", 1), color: f("r", 9) } }, { K: { name: f("b", 5) } }]),
			mergeModules([{ K: { name: f("b", 5) } }, { K: { name: f("a", 1), color: f("r", 9) } }])],
		[{ K: { name: "b", color: "r" } }, { K: { name: "b", color: "r" } }]);
	r.check("modules: a newer tombstone clears the field, an older one loses",
		[mergeModules([{ K: { color: f("r", 1) } }, { K: { color: f(undefined, 2) } }]), mergeModules([{ K: { color: f("r", 3) } }, { K: { color: f(undefined, 2) } }])],
		[{}, { K: { color: "r" } }]);
	r.check("modules: ue null is a value, not a tombstone", mergeModules([{ K: { ue: f(null, 1) } }]), { K: { ue: null } });
	r.check("modules: a tie is deterministic",
		[mergeModules([{ K: { name: f("x", 4) } }, { K: { name: f("y", 4) } }]).K.name, mergeModules([{ K: { name: f("y", 4) } }, { K: { name: f("x", 4) } }]).K.name].every((v, _, a) => v === a[0]), true);
	r.check("modules: rebase keeps an unsaved local edit on top of the merged view",
		rebaseModules({ K: { name: "a", color: "r" } }, { K: { name: "mine", color: "r" } }, { K: { name: "a", color: "p", icon: "i" } }),
		{ K: { name: "mine", color: "p", icon: "i" } });
	r.check("modules: rebase with no local edit is the merged view",
		rebaseModules({ K: { name: "a" } }, { K: { name: "a" } }, { K: { name: "z" } }), { K: { name: "z" } });
	r.check("modules: diff lists changed fields and clears", diffModules({ K: { name: "a", color: "r" } }, { K: { name: "b" }, L: { ue: null } }),
		[{ key: "K", field: "name", v: "b" }, { key: "K", field: "color" }, { key: "L", field: "ue", v: null }]);

	// A folder's exams under its OLD key (the folder changed root). Exam ids and dates only.
	const ex2 = (id, date) => ({ id, date });
	const byId = (r) => r.examens.map(e => e.id);
	const exact = resoudreCleExamens({ "Neo Quiz/XTI301": [ex2("n", "2026-03-01")], "Efrei/XTI301": [ex2("o", "2026-02-01")] },
		"Neo Quiz/XTI301", ["Neo Quiz/XTI301"]);
	r.check("exam key: the exact key wins, an old key with exams is not read",
		[byId(exact), exact.anciennes], [["n"], []]);
	const moved = resoudreCleExamens({ "Efrei/XTI301": [ex2("b", "2026-06-06"), ex2("a", "2026-12-01")] },
		"Neo Quiz/XTI301", ["Neo Quiz/XTI301"]);
	r.check("exam key: the old key of a folder that changed root is found by name, sorted by date",
		[byId(moved), moved.anciennes, moved.cle], [["b", "a"], ["Efrei/XTI301"], "Neo Quiz/XTI301"]);
	const ambigu = resoudreCleExamens({ "Efrei/XTI301": [ex2("a", "2026-12-01")] },
		"Neo Quiz/XTI301", ["Neo Quiz/XTI301", "Perso/XTI301"]);
	r.check("exam key: two folders named XTI301 under two roots: the old key is attached to neither",
		[byId(ambigu), ambigu.anciennes], [[], []]);
	const autreNom = resoudreCleExamens({ "Efrei/Maths": [ex2("m", "2026-12-01")] },
		"Neo Quiz/XTI301", ["Neo Quiz/XTI301"]);
	r.check("exam key: an old key with another folder name is not claimed",
		[byId(autreNom), autreNom.anciennes], [[], []]);
	const sansRacine = resoudreCleExamens({ "Efrei/XTI301": [ex2("a", "2026-12-01")] }, "XTI301", ["XTI301"]);
	r.check("exam key: a key without a root part matches nothing",
		[byId(sansRacine), sansRacine.anciennes], [[], []]);
	const fusion = resoudreCleExamens({ "Efrei/XTI301": [ex2("b", "2026-06-06"), ex2("a", "2026-12-01")],
		"Ancien/XTI301": [ex2("b", "2026-06-06"), ex2("c", "2026-09-09")], "Efrei/Autre": [ex2("z", "2026-01-01")] },
		"Neo Quiz/XTI301", ["Neo Quiz/XTI301", "Efrei/Autre"]);
	r.check("exam key: two unambiguous old keys merged, an id kept once, sorted by date",
		[byId(fusion), fusion.anciennes], [["b", "c", "a"], ["Ancien/XTI301", "Efrei/XTI301"]]);
	const vide = resoudreCleExamens({ "Efrei/XTI301": [] }, "Neo Quiz/XTI301", ["Neo Quiz/XTI301"]);
	r.check("exam key: an empty old list is not a candidate", [byId(vide), vide.anciennes], [[], []]);

	r.done();
});

/* ══════════════════════════════════════════════════════════
   PART 2 - the Windows host on an in-memory fs
══════════════════════════════════════════════════════════ */

/** In-memory fs with the contract's semantics: `rename` rejects over an
    existing target, `list` gives the files directly under a directory, and
    every write is counted. */
function memFs(files = new Map()) {
	const writes = [];
	return {
		files, writes,
		exists: async (p) => files.has(p),
		read: async (p) => { if (!files.has(p)) throw new Error("ENOENT " + p); return files.get(p); },
		write: async (p, d) => { writes.push(p); files.set(p, d); },
		append: async (p, d) => { writes.push(p); files.set(p, (files.get(p) ?? "") + d); },
		list: async (dir) => [...files.keys()].filter(k => k.startsWith(dir + "/") && !k.slice(dir.length + 1).includes("/")),
		remove: async (p) => { files.delete(p); },
		rename: async (a, b) => { if (files.has(b)) throw new Error("EEXIST " + b); files.set(b, files.get(a)); files.delete(a); },
		mkdirs: async () => {},
	};
}
const json = (fs, p) => JSON.parse(fs.files.get(p));
const lines = (fs, p) => (fs.files.get(p) ?? "").split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
const quiet = async (f) => { const w = console.warn; console.warn = () => {}; try { return await f(); } finally { console.warn = w; } };

await withSrcModule(["apps/windows/src/host/shared-state.ts", "apps/windows/src/host/folder.ts", "src/dashboard/stats-store.ts"], async (sh, fo, ss) => {
	const r = makeReporter("Shared state - host");
	const ROOTS = ["Efrei", "Perso"];
	const make = (fs, device = "dev", roots = ROOTS) => {
		let t = 1_000_000;
		return sh.createSharedState({ fs, roots: () => roots, deviceId: device, now: () => (t += 10) });
	};
	const exam = (id, date, extra = {}) => ({ id, nom: id, date, ...extra });
	const rec = (dates) => ({ bestScore: 0, questionsDone: 4, totalQuestions: 9, lastPlayed: Math.max(...dates), attempts: dates.length,
		tentatives: dates.map((d, i) => ({ date: d, pct: 10 * (i + 1) })) });
	const settingsIo = (init) => {
		const m = new Map(Object.entries(init));
		const io = { m, writes: 0, lire: async (k) => structuredClone(m.get(k)), ecrire: async (k, v) => { io.writes++; m.set(k, structuredClone(v)); } };
		return io;
	};
	const legacy = () => ({
		examens: { "Efrei/XTI301": [exam("a", "2026-12-01"), exam("b", "2026-06-01", { coefficient: 2 })], "Perso/Maths": [exam("c", "2027-01-01")] },
		quizStats: { "Efrei/XTI301/cm.md": rec([100, 200]), "Perso/Maths/q.md": rec([300]) },
	});

	// 1. The migration places each entry in its own root.
	{
		const fs = memFs(); const io = settingsIo(legacy());
		const st = make(fs); await st.load();
		await sh.migrateLegacy(st, io);
		r.check("migration: the Efrei exams file holds only Efrei, with modifiedAt",
			Object.entries(json(fs, "Efrei/.neo-quiz/exams/dev.json")).map(([k, l]) => [k, l.map(e => [e.id, typeof e.modifiedAt])]),
			[["Efrei/XTI301", [["b", "number"], ["a", "number"]]]]);
		r.check("migration: the Perso exams file holds Perso", Object.keys(json(fs, "Perso/.neo-quiz/exams/dev.json")), ["Perso/Maths"]);
		r.check("migration: one add event per stored attempt, in the root of the quiz",
			[lines(fs, "Efrei/.neo-quiz/attempts/dev.jsonl").map(e => [e.t, e.path, e.attempt.date]), lines(fs, "Perso/.neo-quiz/attempts/dev.jsonl").map(e => e.path)],
			[[["add", "Efrei/XTI301/cm.md", 200], ["add", "Efrei/XTI301/cm.md", 100]], ["Perso/Maths/q.md"]]);
		r.check("migration: flag set, the old settings stay readable",
			[io.m.get("sharedStateMigrated"), io.m.get("examens")["Efrei/XTI301"].length, Object.keys(io.m.get("quizStats")).length], [true, 2, 2]);

		const wrote = fs.writes.length;
		const again = make(fs); await again.load();
		await sh.migrateLegacy(again, io);
		r.check("migration twice: nothing written the second time", [fs.writes.length, io.writes], [wrote, 1]);

		const s = again.stats()["Efrei/XTI301/cm.md"];
		r.check("restart: stats rebuilt from the events", [s.attempts, s.bestScore, s.questionsDone, s.totalQuestions, s.lastPlayed], [2, 20, 4, 9, 200]);
		r.check("restart: exams merged and sorted by date", [Object.keys(again.exams()).sort(), again.exams()["Efrei/XTI301"].map(e => e.id)], [["Efrei/XTI301", "Perso/Maths"], ["b", "a"]]);
		r.check("restart: the weight survives", again.exams()["Efrei/XTI301"][0].coefficient, 2);
	}

	// 2. A root that is not open: the flag waits, a retry brings nothing back.
	{
		const fs = memFs(); const io = settingsIo(legacy());
		const st = make(fs, "dev", ["Efrei"]); await st.load();
		await quiet(() => sh.migrateLegacy(st, io));
		r.check("an entry outside the open roots: flag NOT set, the open root migrated",
			[io.m.get("sharedStateMigrated"), Object.keys(json(fs, "Efrei/.neo-quiz/exams/dev.json")), fs.files.has("Perso/.neo-quiz/exams/dev.json")], [undefined, ["Efrei/XTI301"], false]);
		await st.deleteExam("Efrei/XTI301", "a");
		await st.deleteAttempt("Efrei/XTI301/cm.md", 100);
		const retry = make(fs); await retry.load();
		await sh.migrateLegacy(retry, io);
		r.check("the retry brings nothing back that was deleted in between",
			[retry.exams()["Efrei/XTI301"].map(e => e.id), retry.stats()["Efrei/XTI301/cm.md"].tentatives.map(t => t.date), io.m.get("sharedStateMigrated")],
			[["b"], [200], true]);
		r.check("and the second root got its data", Object.keys(retry.exams()).sort(), ["Efrei/XTI301", "Perso/Maths"]);
	}

	// 3. Exams across devices, conflict copies, tombstones.
	{
		const fs = memFs();
		const B = (id, date, modifiedAt) => ({ id, nom: id, date, modifiedAt });
		fs.files.set("Efrei/.neo-quiz/exams/other.json", JSON.stringify({ "Efrei/M": [B("e1", "2026-05-05", 5_000_000), B("e2", "2026-06-06", 1)] }));
		fs.files.set("Efrei/.neo-quiz/exams/other.sync-conflict-20261001-120000-ABC.json", JSON.stringify({ "Efrei/M": [B("ghost", "2026-07-07", 9e9)] }));
		fs.files.set("Efrei/.neo-quiz/exams/liar.json", JSON.stringify({ "Perso/X": [B("smuggled", "2026-08-08", 9e9)], "Efrei/N": [B("ok", "2026-09-09", 1)] }));
		const st = make(fs); await st.load();
		r.check("other device read; conflict copy ignored; key of another root ignored",
			st.exams(), { "Efrei/M": [exam("e1", "2026-05-05"), exam("e2", "2026-06-06")], "Efrei/N": [exam("ok", "2026-09-09")] });
		await st.saveExam("Efrei/M", exam("e1", "2026-10-10"));
		r.check("a local edit beats the other device's entry even when its clock runs ahead",
			st.exams()["Efrei/M"].find(e => e.id === "e1").date, "2026-10-10");
		r.check("this device writes only its own file: the other one is untouched",
			[Object.keys(json(fs, "Efrei/.neo-quiz/exams/dev.json")), json(fs, "Efrei/.neo-quiz/exams/other.json")["Efrei/M"].length], [["Efrei/M"], 2]);
		await st.deleteExam("Efrei/M", "e2");
		const restart = make(fs); await restart.load();
		r.check("an exam of ANOTHER device deleted here stays deleted after a restart (tombstone)",
			restart.exams()["Efrei/M"].map(e => e.id), ["e1"]);
		r.check("no temp file left behind", [...fs.files.keys()].filter(k => k.endsWith(".tmp")), []);
		const n = fs.writes.length; await st.deleteExam("Efrei/M", "nope");
		r.check("deleting an unknown exam writes nothing", fs.writes.length - n, 0);
	}

	// 4. The swap is interruptible without losing the table.
	{
		const fs = memFs();
		fs.files.set("Efrei/.neo-quiz/exams/dev.json.tmp", JSON.stringify({ "Efrei/M": [{ id: "t", nom: "t", date: "2026-01-01", modifiedAt: 1 }] }));
		const st = make(fs); await st.load();
		r.check("interrupted swap: the complete temp file stands in", st.exams(), { "Efrei/M": [exam("t", "2026-01-01")] });
		const fs2 = memFs();
		fs2.files.set("Efrei/.neo-quiz/exams/dev.json", "{ torn");
		const st2 = make(fs2);
		await quiet(() => st2.load());
		await st2.saveExam("Efrei/M", exam("n", "2026-02-02"));
		r.check("an unreadable own file is kept aside before the first write replaces it",
			[...fs2.files.entries()].filter(([k]) => k.includes(".corrupt-")).map(([, v]) => v), ["{ torn"]);
	}

	// 5. Attempts: the store diff, routing, a torn line, conflict copies.
	{
		const fs = memFs();
		const add = (path, date, pct, at, extra = {}) => JSON.stringify({ t: "add", path, attempt: { date, pct }, at, ...extra }) + "\n";
		fs.files.set("Efrei/.neo-quiz/attempts/other.jsonl", add("Efrei/q.md", 50, 70, 5, { qd: 3, tq: 3 }));
		fs.files.set("Efrei/.neo-quiz/attempts/other.sync-conflict-20261001-120000-ABC.jsonl", add("Efrei/q.md", 51, 99, 6));
		fs.files.set("Efrei/.neo-quiz/attempts/liar.jsonl", add("Perso/z.md", 52, 99, 6));
		fs.files.set("Efrei/.neo-quiz/attempts/dev.jsonl", add("Efrei/q.md", 60, 20, 7) + '{"t":"add","pa');
		const st = make(fs); await st.load();
		const store = ss.createStatsStore({ getStats: () => st.stats(), saveStats: async () => {} });
		store.load();
		r.check("both devices' attempts; the conflict copy, the foreign path and the torn line ignored",
			[store.getRecord("Efrei/q.md").tentatives.map(t => t.date), store.getRecord("Perso/z.md")], [[60, 50], null]);
		store.updateRecord("Efrei/q.md", { bestScore: 90, questionsDone: 3, totalQuestions: 3 });
		store.updateRecord("Perso/p.md", { bestScore: 10, questionsDone: 1, totalQuestions: 2 });
		await st.syncStats(store.getAll());
		r.check("the torn line did not swallow the next event", lines(fs, "Efrei/.neo-quiz/attempts/dev.jsonl").map(e => e.t + e.attempt.date).length, 2);
		r.check("each attempt routed to its root's file; the other device's file untouched",
			[lines(fs, "Perso/.neo-quiz/attempts/dev.jsonl").map(e => e.path), lines(fs, "Efrei/.neo-quiz/attempts/other.jsonl").length], [["Perso/p.md"], 1]);
		const w = fs.writes.length;
		await st.syncStats(store.getAll());
		r.check("saving the same table again writes nothing", fs.writes.length, w);
		const best = store.getRecord("Efrei/q.md").tentatives.find(t => t.pct === 90);
		store.supprimerTentative("Efrei/q.md", best.date);
		await st.syncStats(store.getAll());
		const dev2 = make(fs, "dev2"); await dev2.load();
		r.check("deleting the best attempt: another device sees the best score drop",
			[dev2.stats()["Efrei/q.md"].bestScore, dev2.stats()["Efrei/q.md"].attempts], [70, 2]);
		store.restaurerTentative("Efrei/q.md", best);
		await st.syncStats(store.getAll());
		const dev3 = make(fs, "dev3"); await dev3.load();
		r.check("undo: the attempt is back everywhere", [dev3.stats()["Efrei/q.md"].bestScore, dev3.stats()["Efrei/q.md"].attempts], [90, 3]);
		store.renamed("Efrei/q.md", "Perso/q.md");
		await st.syncStats(store.getAll());
		const dev4 = make(fs, "dev4"); await dev4.load();
		r.check("a quiz moved between roots: its attempts follow",
			[dev4.stats()["Efrei/q.md"], Object.keys(dev4.stats()).sort(), dev4.stats()["Perso/q.md"].attempts], [undefined, ["Perso/p.md", "Perso/q.md"], 3]);
		r.check("progress survives the round trip", [dev4.stats()["Perso/q.md"].questionsDone, dev4.stats()["Perso/q.md"].totalQuestions], [3, 3]);
	}

	// 6. A failing write is retried at the next save, never forgotten.
	{
		const fs = memFs(); const st = make(fs); await st.load();
		let down = true; const real = fs.append;
		fs.append = async (...a) => { if (down) throw new Error("disk"); return real(...a); };
		const store = ss.createStatsStore({ getStats: () => ({}), saveStats: async () => {} }); store.load();
		store.updateRecord("Efrei/q.md", { bestScore: 40, questionsDone: 1, totalQuestions: 1 });
		let threw = false;
		await quiet(async () => { try { await st.syncStats(store.getAll()); } catch { threw = true; } });
		down = false;
		await st.syncStats(store.getAll());
		r.check("append failure rejects, the next save writes the attempt once",
			[threw, lines(fs, "Efrei/.neo-quiz/attempts/dev.jsonl").length, st.stats()["Efrei/q.md"].attempts], [true, 1, 1]);
	}

	// 7. Moving a folder between roots carries its exams, as this device's entries.
	{
		const fs = memFs(); const st = make(fs); await st.load();
		await st.saveExam("Efrei/Reseaux", exam("f", "2026-12-01"));
		await st.saveExam("Efrei/TD", exam("td", "2026-11-01"));
		await st.moveExams([["Efrei/Reseaux", "Perso/Reseaux", false], ["Efrei/TD", "Perso/TD", true]]);
		r.check("cross-root move: the exam is under the new key; the COPIED one stays under the old key too",
			Object.entries(st.exams()).sort(), Object.entries({ "Efrei/TD": [exam("td", "2026-11-01")], "Perso/Reseaux": [exam("f", "2026-12-01")], "Perso/TD": [exam("td", "2026-11-01")] }));
		const restart = make(fs); await restart.load();
		r.check("and it survives a restart: new root file holds it, the old root file a tombstone",
			[restart.exams()["Perso/Reseaux"].length, "Efrei/Reseaux" in restart.exams(), json(fs, "Efrei/.neo-quiz/exams/dev.json")["Efrei/Reseaux"][0].deleted], [1, false, true]);
		const n = fs.writes.length;
		await st.moveExams([["Perso/Reseaux", "Perso/Reseaux", false], ["Efrei/none", "Perso/none", false]]);
		r.check("a move of nothing writes nothing", fs.writes.length - n, 0);
		// The target already holds the id: the one there wins, nothing is duplicated.
		await st.saveExam("Perso/Dest", exam("f", "2030-01-01"));
		await st.moveExams([["Perso/Reseaux", "Perso/Dest", false]]);
		r.check("same id already at the target: it wins", st.exams()["Perso/Dest"], [exam("f", "2030-01-01")]);
	}

	// 8. The `host/folder.ts` wiring: optimistic cache, then the merged view.
	{
		const fs = memFs(); const st = make(fs); await st.load();
		sh.installSharedState(st);
		await fo.enregistrerExamen("Efrei/M", exam("x", "2026-03-03"));
		r.check("enregistrerExamen goes through the shared files", [fo.examens()["Efrei/M"].length, Object.keys(json(fs, "Efrei/.neo-quiz/exams/dev.json"))], [1, ["Efrei/M"]]);
		await fo.renommerExamens([["Efrei/M", "Perso/M", false]]);
		r.check("renommerExamens carries across roots", [Object.keys(fo.examens()), json(fs, "Perso/.neo-quiz/exams/dev.json")["Perso/M"].length], [["Perso/M"], 1]);
		await fo.retirerExamen("Perso/M", "x");
		r.check("retirerExamen leaves a tombstone, the cache is empty", [fo.examens(), json(fs, "Perso/.neo-quiz/exams/dev.json")["Perso/M"][0].deleted], [{}, true]);
	}

	// 9. A root that cannot be read is never overwritten.
	{
		const fs = memFs();
		fs.files.set("Efrei/.neo-quiz/attempts/dev.jsonl", "x\n");
		const real = fs.read;
		fs.read = async (p) => { if (p.endsWith("attempts/dev.jsonl")) throw new Error("locked"); return real(p); };
		const st = make(fs); await quiet(() => st.load());
		let refused = false;
		await st.recordAttempt("Efrei/q.md", { date: 1, pct: 1 }).catch(() => { refused = true; });
		r.check("own attempts file unreadable: the append is refused", [refused, fs.files.get("Efrei/.neo-quiz/attempts/dev.jsonl")], [true, "x\n"]);
	}
	// 10. An own exams file that cannot be READ is never replaced; a failed load is retried.
	{
		const fs = memFs();
		const own = JSON.stringify({ "Efrei/M": [{ id: "k", nom: "k", date: "2026-01-01", modifiedAt: 1 }] });
		fs.files.set("Efrei/.neo-quiz/exams/dev.json", own);
		const real = fs.read; let locked = true;
		fs.read = async (p) => { if (locked && p.endsWith("exams/dev.json")) throw new Error("locked"); return real(p); };
		const st = make(fs); await quiet(() => st.load());
		let refused = 0;
		await st.saveExam("Efrei/M", exam("n", "2026-02-02")).catch(() => { refused++; });
		await st.deleteExam("Efrei/M", "k").catch(() => { refused++; });
		r.check("own exams file unreadable: saves refused, the file is untouched", [refused, fs.files.get("Efrei/.neo-quiz/exams/dev.json"), fs.writes.length], [2, own, 0]);
		locked = false;
		await st.saveExam("Efrei/M", exam("n", "2026-02-02"));
		r.check("the failed load was not cached: the next call retries, and the save keeps the old exam",
			json(fs, "Efrei/.neo-quiz/exams/dev.json")["Efrei/M"].map(e => e.id).sort(), ["k", "n"]);
	}
	// 11. refresh(): another device's files that synced in AFTER the load.
	{
		const fs = memFs();
		const add = (path, date, pct, at) => JSON.stringify({ t: "add", path, attempt: { date, pct }, at }) + "\n";
		const st = make(fs, "dev", ["Efrei"]); await st.load();
		await st.recordAttempt("Efrei/q.md", { date: 10, pct: 50 });
		await st.saveExam("Efrei/M", exam("mine", "2026-01-01"));
		r.check("before: only our own data", [st.exams()["Efrei/M"].map(e => e.id), st.stats()["Efrei/q.md"].tentatives.map(t => t.date)], [["mine"], [10]]);
		// Syncthing delivers another device's files (and a new attempt of the same quiz).
		fs.files.set("Efrei/.neo-quiz/exams/other.json", JSON.stringify({ "Efrei/M": [{ id: "theirs", nom: "theirs", date: "2026-02-02", modifiedAt: 5_000_000 }] }));
		fs.files.set("Efrei/.neo-quiz/attempts/other.jsonl", add("Efrei/q.md", 20, 80, 5));
		r.check("without refresh the state does not move", [st.exams()["Efrei/M"].length, st.stats()["Efrei/q.md"].tentatives.length], [1, 1]);
		let adopted = 0;
		await st.refresh(() => { adopted++; return true; });
		r.check("refresh: the other device's exam and attempt appear, ours stay",
			[st.exams()["Efrei/M"].map(e => e.id).sort(), st.stats()["Efrei/q.md"].tentatives.map(t => t.date)], [["mine", "theirs"], [20, 10]]);
		r.check("refresh calls the stats hook once, after the reload", adopted, 1);
		// The stats store took the folded table: a save of it writes NOTHING (nothing was added or deleted).
		const n = fs.writes.length;
		await st.syncStats(st.stats());
		r.check("after adopting, saving the stats table writes nothing", fs.writes.length - n, 0);
		r.check("our own files were not rewritten by the refresh",
			[json(fs, "Efrei/.neo-quiz/exams/dev.json")["Efrei/M"].map(e => e.id), lines(fs, "Efrei/.neo-quiz/attempts/dev.jsonl").length], [["mine"], 1]);
		// A stats store with a save still pending refuses the hook: its table lacks the new attempt,
		// and the diff base must NOT move, or saving would delete the other device's attempt.
		fs.files.set("Efrei/.neo-quiz/attempts/third.jsonl", add("Efrei/q.md", 30, 90, 6));
		await st.refresh(() => false);
		const stale = st.stats(); delete stale["Efrei/q.md"].tentatives; 
		const before = lines(fs, "Efrei/.neo-quiz/attempts/dev.jsonl").length;
		const table = { "Efrei/q.md": { bestScore: 80, questionsDone: 0, totalQuestions: 0, lastPlayed: 20, attempts: 2, tentatives: [{ date: 20, pct: 80 }, { date: 10, pct: 50 }] } };
		await st.syncStats(table);
		r.check("a refused hook leaves the diff base: no delete event for the attempt the store never saw",
			lines(fs, "Efrei/.neo-quiz/attempts/dev.jsonl").slice(before).filter(e => e.t === "del"), []);
		// Our own unreadable file never blocks a refresh, and nothing of ours is re-read.
		fs.files.set("Efrei/.neo-quiz/exams/late.json", JSON.stringify({ "Efrei/M": [{ id: "late", nom: "late", date: "2026-03-03", modifiedAt: 6_000_000 }] }));
		const real = fs.read;
		fs.read = async (p) => { if (p.endsWith("attempts/dev.jsonl") || p.endsWith("exams/dev.json")) throw new Error("locked"); return real(p); };
		await st.refresh(() => true);
		fs.read = real;
		r.check("refresh never re-reads our own files (an unreadable one does not block it)", st.exams()["Efrei/M"].map(e => e.id).sort(), ["late", "mine", "theirs"]);
	}

	// 12. Folder settings: per-field stamps, the migration, conflict copies, corrupt files.
	{
		const stamp = (v, at) => (v === undefined ? { at } : { v, at });
		const mod = (dev, tbl) => ({ [`Efrei/.neo-quiz/modules/${dev}.json`]: JSON.stringify(tbl) });
		const mk = (files, dev) => { const fs = memFs(new Map(Object.entries(files))); return [fs, make(fs, dev, ["Efrei"])]; };
		const mdir = "Efrei/.neo-quiz/modules";

		// Two devices change DIFFERENT fields of one folder: both survive.
		{
			const [fs, st] = mk({
				...mod("phone", { XTI: { color: stamp("#f00", 500) } }),
				...mod("pc", { XTI: { name: stamp("Python", 400), color: stamp("#00f", 100) } }),
			}, "pc");
			await st.load();
			r.check("modules: colour from the phone, name from the PC, both kept", st.modules(), { XTI: { name: "Python", color: "#f00" } });
			await st.syncModules({ XTI: { name: "Python 2", color: "#f00", icon: "book" } });
			r.check("modules: only the changed fields are stamped, in our file",
				Object.keys(json(fs, `${mdir}/pc.json`).XTI).sort(), ["color", "icon", "name"]);
			r.check("modules: the unchanged field keeps its old stamp (not rewritten as ours)", json(fs, `${mdir}/pc.json`).XTI.color.at, 100);
			r.check("modules: another device's file is never rewritten", json(fs, `${mdir}/phone.json`), { XTI: { color: stamp("#f00", 500) } });
			r.check("modules: a later write always outranks the stamp it replaces", json(fs, `${mdir}/pc.json`).XTI.name.at > 400, true);
		}
		// Clearing a field is a tombstone that beats an older value elsewhere; `ue: null` is a value.
		{
			const [fs, st] = mk({
				...mod("phone", { A: { color: stamp("#f00", 10), ue: stamp("UE1", 10) } }),
			}, "pc");
			await st.load();
			await st.syncModules({ A: { ue: null } });
			const s2 = make(fs, "phone2", ["Efrei"]); await s2.load();
			r.check("modules: cleared colour stays cleared, ue null is kept as a value", s2.modules(), { A: { ue: null } });
			await st.syncModules({});
			const s3 = make(fs, "phone3", ["Efrei"]); await s3.load();
			r.check("modules: a key cleared field by field disappears", s3.modules(), {});
		}
		// A tie is resolved the same way whatever the order.
		{
			const a = mod("a", { K: { name: stamp("x", 7) } }), b = mod("b", { K: { name: stamp("y", 7) } });
			const [, s1] = mk({ ...a, ...b }, "c"); await s1.load();
			const [, s2] = mk({ ...b, ...a }, "c"); await s2.load();
			r.check("modules: a tie on `at` gives one answer on every device", s1.modules(), s2.modules());
		}
		// Conflict copies and corrupt files are ignored, never fatal.
		{
			const [fs, st] = mk({
				...mod("phone", { K: { name: stamp("ok", 5) } }),
				[`${mdir}/phone.sync-conflict-20261001-000000-ABC.json`]: JSON.stringify({ K: { name: stamp("conflict", 99) } }),
				[`${mdir}/junk.json`]: "{not json",
				[`${mdir}/odd.json`]: JSON.stringify({ K: { name: { v: 5, at: "x" }, color: { v: "#fff", at: 3 } }, "": { name: stamp("e", 1) } }),
			}, "pc");
			await quiet(() => st.load());
			r.check("modules: conflict copy merged read-only, corrupt file ignored, malformed fields dropped", st.modules(), { K: { name: "conflict", color: "#fff" } });
			await st.syncModules({ K: { name: "mine", color: "#fff" } });
			r.check("modules: a conflict copy is never written", [...fs.files.keys()].filter(k => k.includes("sync-conflict")).length === 1
				&& JSON.parse(fs.files.get(`${mdir}/phone.sync-conflict-20261001-000000-ABC.json`)).K.name.v === "conflict", true);
		}
		// A crash between the removal of the old file and the rename leaves only the .tmp: recovered.
		{
			const [fs, st] = mk({ [`${mdir}/pc.json.tmp`]: JSON.stringify({ K: { name: stamp("kept", 5) } }) }, "pc");
			await st.load();
			r.check("modules: an orphan .tmp stands in for the missing own file", st.modules(), { K: { name: "kept" } });
			await st.syncModules({ K: { name: "kept", icon: "star" } });
			r.check("modules: the next write keeps the recovered stamps", json(fs, `${mdir}/pc.json`).K.name.v, "kept");
		}
		// Hostile or oversized input from another device.
		{
			const far = 1e15;
			const [, st] = mk({
				...mod("x", {
					A: { name: stamp("far", far), color: stamp("red", 5), icon: stamp("Bad Icon!", 5) },
					B: { name: stamp("n".repeat(201), 5), ue: stamp("ok", 5), color: stamp("#12ab", 5), icon: stamp("book-open", 5) },
				}),
			}, "pc");
			await st.load();
			r.check("modules: far-future stamps, bad colour/icon shapes and long strings are dropped",
				st.modules(), { B: { ue: "ok", color: "#12ab", icon: "book-open" } });
			const many = Object.fromEntries(Array.from({ length: 1500 }, (_, i) => [`k${i}`, { name: stamp("n", 5) }]));
			const [, big] = mk(mod("y", many), "pc"); await big.load();
			r.check("modules: at most 1000 keys are read from a file", Object.keys(big.modules()).length, 1000);
		}
		// Own file unreadable: the root still loads, the feature refuses to write, nothing replaced.
		{
			const [fs, st] = mk(mod("pc", { K: { name: stamp("mine", 5) } }), "pc");
			const real = fs.read; fs.read = async p => { if (p.endsWith("modules/pc.json")) throw new Error("locked"); return real(p); };
			await quiet(() => st.load());
			let refused = false;
			await quiet(async () => { try { await st.syncModules({ K: { name: "new" } }); } catch { refused = true; } });
			fs.read = real;
			r.check("modules: an unreadable own file does not fail the load, the write is refused", refused, true);
			r.check("modules: an unreadable own file is never replaced", json(fs, `${mdir}/pc.json`), { K: { name: stamp("mine", 5) } });
		}
		// Migration: placed once, never over what exists, idempotent, the setting stays.
		{
			const io = settingsIo({ quizzesModuleOverrides: { XTI: { name: "Python", color: "#0f0", ue: null, path: "Efrei/XTI", bogus: 1 }, B: { icon: "x" } } });
			const [fs, st] = mk(mod("phone", { XTI: { color: stamp("#f00", 50) } }), "pc");
			await st.load();
			await sh.migrateLegacyModules(st, io);
			r.check("modules migration: legacy fills the gaps, an existing stamp wins",
				st.modules(), { B: { icon: "x" }, XTI: { name: "Python", ue: null, color: "#f00", path: "Efrei/XTI" } });
			r.check("modules migration: flag set, the legacy setting is untouched",
				[io.m.get("sharedModulesMigrated"), Object.keys(io.m.get("quizzesModuleOverrides"))], [true, ["XTI", "B"]]);
			const n = fs.writes.length;
			await sh.migrateLegacyModules(st, io);
			const again = make(fs, "pc", ["Efrei"]); await again.load();
			await again.migrateModules({ XTI: { name: "Python" } });
			r.check("modules migration twice: nothing more written", fs.writes.length, n);
			// An edit made after the migration beats the migrated value.
			await again.syncModules({ XTI: { name: "Renamed", color: "#f00", ue: null, path: "Efrei/XTI" }, B: { icon: "x" } });
			r.check("modules: an edit after the migration wins", again.modules().XTI.name, "Renamed");
		}
		// A folder move rewrites `path` only: the colour and the rest follow it.
		{
			const [fs, st] = mk(mod("pc", { XTI: { path: stamp("Efrei/Old/XTI", 1), color: stamp("#abc", 1) } }), "pc");
			await st.load();
			const view = st.modules(); view.XTI.path = "Efrei/New/XTI";
			await st.syncModules(view);
			const other = make(fs, "phone", ["Efrei"]); await other.load();
			r.check("modules: a moved folder keeps its colour and gets its new path", other.modules(), { XTI: { color: "#abc", path: "Efrei/New/XTI" } });
		}
		// refresh() brings another device's change.
		{
			const [fs, st] = mk(mod("pc", { K: { name: stamp("a", 5) } }), "pc");
			await st.load();
			fs.files.set(`${mdir}/phone.json`, JSON.stringify({ K: { name: stamp("b", 9), icon: stamp("star", 9) } }));
			await st.refresh(() => true);
			r.check("modules: refresh adopts the other device's newer stamps", st.modules(), { K: { name: "b", icon: "star" } });
		}
		// Discrimination: a whole-module "last writer wins" would drop the phone's colour here.
		{
			const [, st] = mk({ ...mod("phone", { Z: { color: stamp("#f00", 500) } }), ...mod("pc", { Z: { name: stamp("N", 600) } }) }, "pc");
			await st.load();
			r.check("modules: per-field merge (a whole-module rule would drop the colour)", st.modules(), { Z: { name: "N", color: "#f00" } });
		}
	}

	r.done();
});

/* QUIZZES IN PROGRESS PER DEVICE (`apps/windows/src/host/shared-sessions.ts`,
   2026-10-09): a Learn begun on the phone resumes on the laptop. */
await withSrcModule("apps/windows/src/host/shared-sessions.ts", async (ses) => {
	const r = makeReporter("Shared state - quizzes in progress");
	const fsOf = (files = new Map()) => {
		const m = memFs(files);
		return { ...m, size: async (p) => (files.has(p) ? files.get(p).length : null), readBounded: async (p) => m.read(p) };
	};
	const snap = (ecrite, courante = "q1") => ({ v: 1, courante, questions: { q1: { melange: "0 1" } }, ecrite });
	const make = (fs, device, t0 = 1_000_000) => { let t = t0; return ses.createSharedSessions({ fs, roots: () => ["Efrei"], deviceId: device, now: () => (t += 10) }); };
	const P = "Efrei/XTI303/cours.md";

	// The phone plays, writes its file; the laptop, loading, resumes where the phone stopped.
	const files = new Map();
	const phone = make(fsOf(files), "phone");
	await phone.load();
	phone.poser(P, snap(1_000_100, "q7"));
	await phone.ecrire();
	r.check("the phone's snapshot is in ITS file of the synced folder", JSON.parse(files.get("Efrei/.neo-quiz/sessions/phone.json"))[P].courante, "q7");
	const laptop = make(fsOf(files), "laptop");
	await laptop.load();
	r.check("the laptop resumes at the phone's question", laptop.toutes()[P]?.courante, "q7");

	// The laptop plays on: its snapshot is the latest, written in its own file only.
	laptop.poser(P, snap(900_000, "q9"));
	await laptop.ecrire();
	await phone.refresh();
	r.check("a snapshot played later wins even from a slower clock", [laptop.toutes()[P].courante, phone.toutes()[P].courante], ["q9", "q9"]);
	r.check("each device wrote only its own file", [...files.keys()].filter(k => k.includes("/sessions/")).sort(), ["Efrei/.neo-quiz/sessions/laptop.json", "Efrei/.neo-quiz/sessions/phone.json"]);

	// The phone finishes the quiz: a tombstone; the laptop's older snapshot does not bring it back.
	phone.effacer(P);
	await phone.ecrire();
	await laptop.refresh();
	r.check("a finished quiz stays finished on the other device", [phone.toutes()[P], laptop.toutes()[P]], [undefined, undefined]);

	// Two writes at once (the 400 ms timer and the flush at closing): the latest snapshot ends in the file.
	{
		const f4 = new Map();
		const slow = fsOf(f4);
		const rename = slow.rename;
		slow.rename = async (a, b) => { await new Promise(res => setTimeout(res, 5)); return rename(a, b); };
		const s4 = make(slow, "pc");
		await s4.load();
		s4.poser(P, snap(1_000_100, "q2"));
		const premier = s4.ecrire();
		s4.poser(P, snap(1_000_200, "q3"));
		const second = s4.ecrire();
		await Promise.all([premier, second]);
		r.check("two writes at once: no failure, and the file holds the latest snapshot", JSON.parse(f4.get("Efrei/.neo-quiz/sessions/pc.json"))[P].courante, "q3");
	}	// The legacy settings are copied once, never over a synced entry.
	const fs2 = fsOf();
	const s2 = make(fs2, "old");
	await s2.load();
	r.check("legacy snapshots are migrated where no device has one",
		[s2.migrer({ [P]: snap(5), "Efrei/a.md": snap(6), "Autre/b.md": snap(7), "Efrei/bad.md": { v: 2 } }), Object.keys(s2.toutes()).sort()],
		[2, ["Efrei/XTI303/cours.md", "Efrei/a.md"]]);
	r.check("… and not over an entry this device already holds", s2.migrer({ [P]: snap(1) }), 0);
	// Two devices migrate the same quiz: the newer progress wins, whichever migrated first.
	{
		const f5 = new Map();
		const pc = make(fsOf(f5), "pc"); await pc.load(); pc.migrer({ [P]: snap(500, "vieux") }); await pc.ecrire();
		const tel = make(fsOf(f5), "tel"); await tel.load();
		r.check("the second device still migrates its own progress", tel.migrer({ [P]: snap(900, "recent") }), 1);
		await tel.ecrire(); await pc.refresh();
		r.check("… and the newer progress wins on both", [tel.toutes()[P].courante, pc.toutes()[P].courante], ["recent", "recent"]);
	}

	// A hostile or broken file from another device.
	const t = ses.lireTableSessions({ "Autre/x.md": snap(1), "Efrei/ok.md": snap(1), "Efrei/futur.md": snap(9e15), "Efrei/v2.md": { v: 2, questions: {}, ecrite: 1 }, "Efrei/t.md": { tombe: true, ecrite: 3 }, "Efrei/nan.md": { v: 1, questions: {}, ecrite: NaN } }, "Efrei", 1000);
	r.check("another root's key, a future stamp, an unknown version or a NaN stamp are dropped", Object.keys(t).sort(), ["Efrei/ok.md", "Efrei/t.md"]);
	r.check("a tie between a snapshot and a tombstone: the tombstone wins",
		ses.fusionnerSessions([{ [P]: snap(50) }, { [P]: { tombe: true, ecrite: 50 } }]), {});

	// A move carries the winning snapshot to the new key.
	const fs3 = fsOf(new Map(files));
	const s3 = make(fs3, "laptop", 5_000_000);
	await s3.load();
	s3.poser(P, snap(5_000_100, "q4"));
	s3.renommer("Efrei/XTI303", "Efrei/XTI303 bis");
	r.check("a folder move: the snapshot follows the quiz, the old key is gone",
		[s3.toutes()["Efrei/XTI303 bis/cours.md"]?.courante, s3.toutes()[P]], ["q4", undefined]);
	r.done();
});

/* THE MERGE OF A QUIZ'S SNAPSHOTS ACROSS DEVICES (`src/shared-state/session-merge.ts`,
   2026-10-09). Defect prevented: "the latest snapshot wins whole" let a phone that
   reopened an old snapshot overwrite a 54-question Learn with 6 questions (the
   card went from 100 % to 11 %). */
await withSrcModule(["src/shared-state/session-merge.ts", "apps/windows/src/host/shared-sessions.ts"], async (sm, ses) => {
	const r = makeReporter("Shared state - snapshot merge");
	const ok = { verifieeLearn: true, verdict: "first" };
	// Anonymised copy of the real case: the laptop held 54 questions (stopped on d10-lecture) at
	// 11:55; a phone that reopened an old snapshot wrote 6 (on d2-lecture) at 14:58.
	const ids = Array.from({ length: 54 }, (_, i) => `q${i + 1}`);
	const laptop = { v: 1, courante: "d10-lecture", ecrite: 1_100, questions: Object.fromEntries(ids.map(id => [id, { ...ok }])) };
	const phone = { v: 1, courante: "d2-lecture", ecrite: 1_400, questions: Object.fromEntries(ids.slice(0, 6).map(id => [id, { ...ok }])) };
	const verifiees = (s) => Object.values(s.questions).filter(q => q.verifieeLearn).length;
	const m = sm.fusionnerPhotos([phone, laptop]);
	r.check("real case: 54 against 6 gives 54 questions, not 6", verifiees(m), 54);
	r.check("real case: reopening does not go back (the 54-question snapshot's question)", m.courante, "d10-lecture");
	r.check("real case: the order of the entries does not matter", sm.fusionnerPhotos([laptop, phone]), m);

	// Two devices did different questions: the union.
	const a = { v: 1, courante: "q2", ecrite: 10, questions: { q1: { ...ok }, q2: { ...ok } } };
	const b = { v: 1, courante: "q4", ecrite: 20, questions: { q3: { ...ok }, q4: { ...ok } } };
	r.check("different questions on two devices: the union", Object.keys(sm.fusionnerPhotos([a, b]).questions).sort(), ["q1", "q2", "q3", "q4"]);

	// The same question: checked beats unchecked even when older; then the latest.
	const verif = { v: 1, courante: null, ecrite: 10, questions: { q1: { ...ok } } };
	const brouillon = { v: 1, courante: null, ecrite: 20, questions: { q1: { selection: 2 } } };
	r.check("the same question: checked beats a later unchecked entry", sm.fusionnerPhotos([verif, brouillon]).questions.q1, { ...ok });
	const t1 = { v: 1, courante: null, ecrite: 10, questions: { q1: { selection: 1 } } };
	const t2 = { v: 1, courante: null, ecrite: 20, questions: { q1: { selection: 2 } } };
	r.check("the same question, equally advanced: the latest", sm.fusionnerPhotos([t1, t2]).questions.q1.selection, 2);
	const rate = { v: 1, courante: null, ecrite: 10, questions: { q1: { verifieeLearn: true, verdict: "missed" } } };
	const repris = { v: 1, courante: null, ecrite: 5, questions: { q1: { ...ok, verdict: "retried" } } };
	r.check("a missed question settled elsewhere counts as settled", sm.fusionnerPhotos([rate, repris]).questions.q1.verdict, "retried");

	// courante: the latest snapshot's when not behind; else the most advanced one's, or the first unchecked.
	r.check("courante: the latest snapshot's when it is not behind", sm.fusionnerPhotos([a, b]).courante, "q4");
	const cheminant = { v: 1, courante: "q1", ecrite: 30, questions: { q1: { ...ok } } };
	const avance = { v: 1, courante: "q9", ecrite: 10, questions: { q1: { ...ok }, q2: { ...ok }, q3: { ...ok } } };
	r.check("courante behind: the most advanced snapshot's question", sm.fusionnerPhotos([cheminant, avance]).courante, "q9");
	const avanceCoche = { ...avance, courante: "q3" };
	r.check("courante behind and already checked: the first unchecked, with the order", sm.fusionnerPhotos([cheminant, avanceCoche], ["q1", "q2", "q3", "q4", "q5"]).courante, "q4");

	// Restart: a snapshot of a newer attempt (depuis) leaves the older ones out, even later-written ones.
	const vieille = { v: 1, courante: "q50", ecrite: 100, depuis: 10, questions: { q1: { ...ok }, q50: { ...ok } } };
	const reprise = { v: 1, courante: "q1", ecrite: 300, depuis: 200, questions: { q1: { selection: 0 } } };
	r.check("a restart: the old attempt does not come back", Object.keys(sm.fusionnerPhotos([vieille, reprise]).questions), ["q1"]);
	const vieilleTardive = { ...vieille, ecrite: 400 };
	r.check("a restart: an old attempt written later (a device that has not synced) is still left out", sm.fusionnerPhotos([vieilleTardive, reprise]).questions.q1, { selection: 0 });
	r.check("a restart: same attempt on two devices merges", Object.keys(sm.fusionnerPhotos([{ ...reprise, questions: { q2: { selection: 1 } } }, reprise]).questions).sort(), ["q1", "q2"]);

	// The retry queue: every device's entries, minus the questions settled since.
	const fa = { v: 1, courante: null, ecrite: 10, file: [{ id: "q1", depuis: 1 }, { id: "q2", depuis: 2 }], questions: { q1: { verifieeLearn: true, verdict: "missed" }, q2: { verifieeLearn: true, verdict: "missed" } } };
	const fb = { v: 1, courante: null, ecrite: 20, file: [{ id: "q3", depuis: 1 }], questions: { q2: { ...ok, verdict: "retried" }, q3: { verifieeLearn: true, verdict: "missed" } } };
	r.check("the retry queue: both devices' entries, minus a question settled elsewhere", sm.fusionnerPhotos([fa, fb]).file.map(e => e.id).sort(), ["q1", "q3"]);

	// A judgement WITHDRAWN (the right answer changed, `rejugee`): it outranks every entry
	// stamped earlier or not at all, however advanced, and equal stamps compare progress.
	const juste = { v: 1, courante: null, ecrite: 10, questions: { q1: { ...ok, selection: 1 } } };
	const rejuge = { v: 1, courante: null, ecrite: 20, questions: { q1: { selection: 1, verdict: "missed", ratees: 1, rejugee: 15 } } };
	r.check("a withdrawn judgement beats another device's older 'right'", sm.fusionnerPhotos([juste, rejuge]).questions.q1, rejuge.questions.q1);
	r.check("... even when that one was written later (a device not yet synced)", sm.fusionnerPhotos([{ ...juste, ecrite: 30 }, rejuge]).questions.q1.rejugee, 15);
	const recoche = { v: 1, courante: null, ecrite: 40, questions: { q1: { ...ok, selection: 2, rejugee: 15 } } };
	r.check("after the withdrawal, a new check with the same stamp wins by progress", sm.fusionnerPhotos([rejuge, recoche, juste]).questions.q1.selection, 2);
	r.check("a later withdrawal beats an earlier one", sm.fusionnerPhotos([recoche, { ...rejuge, ecrite: 50, questions: { q1: { ...rejuge.questions.q1, rejugee: 45 } } }]).questions.q1.rejugee, 45);
	// The engine never writes `rejugee`: what a device plays carries the stamps it sees.
	const vue = { v: 1, courante: null, ecrite: 20, questions: { q1: { selection: 1, rejugee: 15 }, q2: { rejugee: 12 } } };
	const joue = { v: 1, courante: "q1", ecrite: 60, questions: { q1: { ...ok, selection: 0 } } };
	r.check("the stamps the device sees are carried onto what it plays, absent questions included",
		sm.porterRejugees(joue, vue).questions, { q1: { ...ok, selection: 0, rejugee: 15 }, q2: { rejugee: 12 } });
	r.check("nothing to carry: the same snapshot", [sm.porterRejugees(joue, null) === joue, sm.porterRejugees(joue, juste) === joue], [true, true]);

	// Tombstones.
	r.check("a tombstone newer than every snapshot leaves the quiz reset", sm.fusionnerPhotos([laptop, phone, { tombe: true, ecrite: 2_000 }]), null);
	r.check("a snapshot after the tombstone counts alone", Object.keys(sm.fusionnerPhotos([laptop, { tombe: true, ecrite: 1_200 }, phone]).questions).length, 6);
	r.check("a tie between a snapshot and a tombstone: reset", sm.fusionnerPhotos([phone, { tombe: true, ecrite: 1_400 }]), null);

	// Snapshots written before `depuis` existed merge as an attempt begun at an unknown date.
	r.check("no `depuis`: legacy snapshots merge", [Object.keys(sm.fusionnerPhotos([a, b]).questions).length, "depuis" in sm.fusionnerPhotos([a, b])], [4, false]);
	r.check("a legacy snapshot older than the attempt's start is left out", Object.keys(sm.fusionnerPhotos([a, { ...b, depuis: 15 }]).questions).sort(), ["q3", "q4"]);
	r.check("a legacy snapshot after the attempt's start merges", Object.keys(sm.fusionnerPhotos([a, { ...b, depuis: 5 }]).questions).length, 4);

	// A damaged snapshot is dropped alone; a bad `depuis` is dropped from its snapshot only.
	const t = ses.lireTableSessions({ "R/ok.md": laptop, "R/abime.md": { v: 1, questions: "x", ecrite: 1 }, "R/dep.md": { ...a, depuis: 99 } }, "R", 1e6);
	r.check("a damaged snapshot is ignored alone", Object.keys(t).sort(), ["R/dep.md", "R/ok.md"]);
	r.check("a `depuis` after the write stamp is dropped, the snapshot kept", [t["R/dep.md"].depuis, Object.keys(t["R/dep.md"].questions).length], [undefined, 2]);
	r.check("a damaged entry among questions is skipped", Object.keys(sm.fusionnerPhotos([{ ...a, questions: { q1: "mauvais", q2: { ...ok } } }]).questions), ["q2"]);

	// Hosts: the real files across devices, and what a device writes.
	const files = new Map();
	const fsOf = () => {
		const mf = memFs(files);
		return { ...mf, size: async (p) => (files.has(p) ? files.get(p).length : null), readBounded: async (p) => mf.read(p) };
	};
	const P = "R/quiz.md";
	files.set("R/.neo-quiz/sessions/laptop.json", JSON.stringify({ [P]: laptop }));
	files.set("R/.neo-quiz/sessions/phone.json", JSON.stringify({ [P]: phone }));
	const mkDev = (id, t0) => { let t = t0; return ses.createSharedSessions({ fs: fsOf(), roots: () => ["R"], deviceId: id, now: () => (t += 1) }); };
	const tel = mkDev("phone", 1_500);
	await tel.load();
	r.check("the host view of the real files: 54 questions", verifiees(tel.toutes()[P]), 54);
	// The phone plays one more question from its OLD view (6 questions): what it publishes is the merge.
	tel.poser(P, { v: 1, courante: "q7", ecrite: 1, questions: { ...phone.questions, q7: { ...ok } } });
	await tel.ecrire();
	r.check("a device writes the MERGED snapshot in its own file (not its local view)", verifiees(JSON.parse(files.get("R/.neo-quiz/sessions/phone.json"))[P]), 54);
	r.check("... the laptop's file is untouched", JSON.parse(files.get("R/.neo-quiz/sessions/laptop.json"))[P], laptop);
	// A restart on the phone: the laptop's older progress does not come back, even after the phone plays on.
	tel.effacer(P);
	r.check("a restart on one device: the quiz is reset for all of them", tel.toutes()[P], undefined);
	tel.poser(P, { v: 1, courante: "q1", ecrite: 1, questions: { q1: { selection: 0 } } });
	await tel.ecrire();
	const portable = mkDev("laptop", 1_600);
	await portable.load();
	r.check("after the restart and a new answer, the other device sees only the new attempt", Object.keys(portable.toutes()[P].questions), ["q1"]);
	r.check("... which carries its start (`depuis`)", typeof portable.toutes()[P].depuis, "number");
	portable.poser(P, { v: 1, courante: "q2", ecrite: 1, questions: { q1: { selection: 0 }, q2: { ...ok } } });
	await portable.ecrire();
	await tel.refresh();
	r.check("both devices then agree on the new attempt", [Object.keys(tel.toutes()[P].questions).sort(), Object.keys(portable.toutes()[P].questions).sort()], [["q1", "q2"], ["q1", "q2"]]);
	// A withdrawn judgement survives the device's next ordinary write (the engine never writes
	// `rejugee`) and the other device's older "right" entry.
	const J = "R/rejuge.md";
	files.set("R/.neo-quiz/sessions/tel3.json", JSON.stringify({ [J]: { v: 1, courante: "q1", ecrite: 100, questions: { q1: { ...ok, selection: 1 } } } }));
	const pc3 = mkDev("pc3", 200);
	await pc3.load();
	pc3.poser(J, { v: 1, courante: "q1", ecrite: 1, questions: { q1: { selection: 1, verdict: "missed", ratees: 1, rejugee: 150 } } });
	pc3.poser(J, { v: 1, courante: "q2", ecrite: 1, questions: { q1: { selection: 1, verdict: "missed", ratees: 1 }, q2: { selection: 0 } } });
	await pc3.ecrire();
	const pc3b = mkDev("pc3", 400);
	await pc3b.load();
	r.check("a withdrawn judgement survives the next write and the other device's older 'right'",
		[pc3b.toutes()[J].questions.q1.verdict, pc3b.toutes()[J].questions.q1.rejugee, JSON.parse(files.get("R/.neo-quiz/sessions/pc3.json"))[J].questions.q1.rejugee], ["missed", 150, 150]);
	// Two devices start a never-played quiz at once, neither seeing the other (Syncthing not through,
	// the phone's clock ahead): no restart happened, so neither may drop the other's answers.
	const N = "R/neuf.md";
	const pc = mkDev("pc2", 5_000), tel2 = mkDev("tel2", 9_000);
	await pc.load(); await tel2.load();
	const dix = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`n${i}`, { ...ok }]));
	pc.poser(N, { v: 1, courante: "n9", ecrite: 5_000, questions: dix });
	await pc.ecrire();
	tel2.poser(N, { v: 1, courante: "m0", ecrite: 9_000, questions: { m0: { ...ok } } });
	await tel2.ecrire();
	const tiers = mkDev("tiers", 20_000);
	await tiers.load();
	r.check("two devices starting the same new quiz at once: their answers merge, none is dropped", verifiees(tiers.toutes()[N]), 11);
	r.done();
});
