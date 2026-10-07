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

await withSrcModule(["src/shared-state/merge.ts", "src/dashboard/stats-store.ts"], ({ mergeExams, foldAttempts, mergeModules, diffModules }, ss) => {
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
	r.check("modules: diff lists changed fields and clears", diffModules({ K: { name: "a", color: "r" } }, { K: { name: "b" }, L: { ue: null } }),
		[{ key: "K", field: "name", v: "b" }, { key: "K", field: "color" }, { key: "L", field: "ue", v: null }]);

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
			const [, st] = mk({
				...mod("phone", { K: { name: stamp("ok", 5) } }),
				[`${mdir}/phone.sync-conflict-20261001-000000-ABC.json`]: JSON.stringify({ K: { name: stamp("conflict", 99) } }),
				[`${mdir}/junk.json`]: "{not json",
				[`${mdir}/odd.json`]: JSON.stringify({ K: { name: { v: 5, at: "x" }, color: { v: "#fff", at: 3 } }, "": { name: stamp("e", 1) } }),
			}, "pc");
			await quiet(() => st.load());
			r.check("modules: conflict copy and corrupt file ignored, malformed fields dropped", st.modules(), { K: { name: "ok", color: "#fff" } });
		}
		// Own file unreadable: refuse (the root stays read-only), nothing replaced.
		{
			const [fs, st] = mk(mod("pc", { K: { name: stamp("mine", 5) } }), "pc");
			const real = fs.read; fs.read = async p => { if (p.endsWith("modules/pc.json")) throw new Error("locked"); return real(p); };
			await quiet(() => st.load());
			await quiet(async () => { try { await st.syncModules({ K: { name: "new" } }); } catch { /* refused */ } });
			fs.read = real;
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
