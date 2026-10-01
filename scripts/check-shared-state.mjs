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

await withSrcModule(["src/shared-state/merge.ts", "src/dashboard/stats-store.ts"], ({ mergeExams, foldAttempts }, ss) => {
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
	r.done();
});
