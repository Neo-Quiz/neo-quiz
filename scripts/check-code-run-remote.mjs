/**
 * PYTHON FROM THE PHONE, RUN ON THE PC (`src/shared-state/code-run-request.ts`,
 * `src/code-blocks.ts`, `src/dashboard/code-run-remote.ts`,
 * `apps/windows/src/host/code-run-files.ts`), on an in-memory fs with the
 * contract's semantics. Prevents: a synced file making the PC run code that is
 * not, byte for byte, a Python block of a note of the synced root (a hash of
 * another note's block, a path that escapes, a forged or foreign sender, an
 * old request run late, the same request run twice, a flood); the phone
 * reading a result another device wrote, or waiting forever; the hash of the
 * phone (from the RENDERED block) and the PC's (`blocsPython`) disagreeing.
 *     npm run check:code-run-remote
 */
import { parseHTML } from "linkedom";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const { document } = parseHTML("<html><body></body></html>");
globalThis.document = document;

function memFs(files = new Map()) {
	const reads = [];
	return {
		files, reads,
		readBounded: async (p, max) => { reads.push(p); if (!files.has(p)) throw new Error("ENOENT " + p); const d = files.get(p); if (Buffer.byteLength(d) > max) throw new Error("file too large"); return d; },
		size: async (p) => files.has(p) ? Buffer.byteLength(files.get(p)) : null,
		exists: async (p) => files.has(p),
		read: async (p) => { reads.push(p); if (!files.has(p)) throw new Error("ENOENT " + p); return files.get(p); },
		write: async (p, d) => { files.set(p, d); },
		append: async (p, d) => { files.set(p, (files.get(p) ?? "") + d); },
		list: async (dir) => [...files.keys()].filter(k => k.startsWith(dir + "/") && !k.slice(dir.length + 1).includes("/")),
		listDir: async (dir) => {
			const names = new Map();
			for (const k of files.keys()) if (k.startsWith(dir + "/")) { const rest = k.slice(dir.length + 1); names.set(rest.split("/")[0], rest.includes("/")); }
			if (!names.size) throw new Error("ENOENT " + dir);
			return [...names].map(([name, isFolder]) => ({ name, isFolder }));
		},
		remove: async (p) => { if (!files.has(p)) throw new Error("ENOENT " + p); files.delete(p); },
		rename: async (a, b) => { if (files.has(b)) throw new Error("EEXIST " + b); files.set(b, files.get(a)); files.delete(a); },
		mkdirs: async () => {},
	};
}
const quiet = async (f) => { const w = console.warn; console.warn = () => {}; try { return await f(); } finally { console.warn = w; } };
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(res => setTimeout(res, 0)); };

const F = "```";
const PC = "11111111-1111-4111-8111-111111111111", PH = "22222222-2222-4222-8222-222222222222", PH2 = "33333333-3333-4333-8333-333333333333";
const NOW = 1_800_000_000_000;
const ROOT = "Root";
const BASE = `${ROOT}/.neo-quiz/code-runs`;

// A note with an escaped quote (JSON string), a fence in `etapes` holding a blank line, a JSON5 `\'`, a C block and a fence outside the quiz block.
const CODE_QUOTE = `print("it's")\nprint('say "hi"')`;
const CODE_STEPS = `for i in range(3):\n\n    print(i)`;
const CODE_SINGLE = `print('single')`;
const ITEM_QUOTE = { prompt: `Run this:\n\n${F}python\n${CODE_QUOTE}\n${F}\n\nWhat prints?`, type: "single", options: ["a", "b"], correctIndex: 0 };
const ITEM_STEPS = { role: "read", lecture: "etapes", prompt: "Intro", etapes: ["First idea", `${F}python\n${CODE_STEPS}\n${F}`] };
const NOTE_A = [
	"# Notes", "", `${F}python`, `print("outside")`, F, "",
	`${F}quiz-blocks`, "[",
	`  ${JSON.stringify(ITEM_QUOTE)},`,
	`  ${JSON.stringify(ITEM_STEPS)},`,
	String.raw`  { prompt: '${F}python\nprint(\'single\')\n${F}', type: "text", answer: "x" },`,
	`  ${JSON.stringify({ prompt: `C\n\n${F}c\nint main(){}\n${F}`, type: "text", answer: "y" })},`,
	"]", F, "",
].join("\n");
const CODE_B = `print("note B")`;
const NOTE_B = [`${F}quiz-blocks`, "[", `  ${JSON.stringify({ prompt: `B\n\n${F}python\n${CODE_B}\n${F}`, type: "text", answer: "z" })}`, "]", F].join("\n");

await withSrcModule(
	["src/shared-state/code-run-request.ts", "src/code-blocks.ts", "src/dashboard/code-run-remote.ts", "apps/windows/src/host/code-run-files.ts", "src/engine/sanitizer.ts", "src/engine/lecture-rendu.ts", "src/engine/code-run.ts", "src/quiz-utils.ts"],
	async (Q, B, R, Files, San, Lec, Run, QU) => {
		const r = makeReporter("Python from the phone, run on the PC");

		/* ── 1. The validator ── */
		const SHA = "a".repeat(64);
		const good = (over = {}) => ({ v: 1, id: "lq3k2-abc123", at: NOW - 1000, from: PH, target: PC, path: "Cours/A.md", sha256: SHA, accepted: true, ...over });
		const ctx = (over = {}) => ({ device: PC, fileDevice: PH, fileId: "lq3k2-abc123", now: NOW, ...over });
		const v = (raw, c = ctx()) => Q.validerDemandeCode(raw, c);
		r.check("a good request is accepted, copied field by field", v(good()), { ok: true, demande: good() });
		for (const [n, raw] of [["null", null], ["array", []], ["v2", good({ v: 2 })], ["unknown key", good({ code: "print(1)" })], ["__proto__ key", JSON.parse(JSON.stringify(good()).replace("{", '{"__proto__":{"x":1},'))],
			["forged prototype", Object.assign(Object.create({ evil: 1 }), good())], ["id is not the file name", good({ id: "other-1234" })], ["id not a slug", good({ id: "../x" })],
			["sha256 not hex", good({ sha256: "g".repeat(64) })], ["sha256 uppercase", good({ sha256: "A".repeat(64) })], ["sha256 short", good({ sha256: "a".repeat(63) })],
			["accepted false", good({ accepted: false })], ["accepted missing", (() => { const g = good(); delete g.accepted; return g; })()], ["accepted string", good({ accepted: "true" })],
			["path not a string", good({ path: ["A.md"] })], ["time not a number", good({ at: "now" })], ["time NaN", good({ at: NaN })]]) {
			r.check("schema: " + n, v(raw).ok === false && v(raw).raison, "schema");
		}
		r.check("expediteur: the folder is not `from` (impersonation)", v(good(), ctx({ fileDevice: PH2 })).raison, "expediteur");
		r.check("expediteur: `from` is this PC (its own folder never runs)", v(good({ from: PC }), ctx({ fileDevice: PC })).raison, "expediteur");
		r.check("expediteur: `from` is not a device id", v(good({ from: "bob" }), ctx({ fileDevice: "bob" })).raison, "expediteur");
		r.check("destinataire: addressed to another PC", v(good({ target: PH2 })).raison, "destinataire");
		r.check("age: 119 s old is accepted", v(good({ at: NOW - 119_000 })).ok, true);
		r.check("age: 121 s old is dropped, never run late", v(good({ at: NOW - 121_000 })).raison, "age");
		r.check("futur: 29 s ahead is tolerated", v(good({ at: NOW + 29_000 })).ok, true);
		r.check("futur: 31 s ahead is refused", v(good({ at: NOW + 31_000 })).raison, "futur");
		for (const bad of ["../x.md", "a/../../x.md", "/etc/x.md", "C:/x.md", "c:x.md", "a\\b.md", "\\\\srv\\share\\x.md", "a/b.md::$DATA", "a/b.md ", "a/b.md.", ".neo-quiz/x.md", ".NEO-QUIZ/journal/x.md", "x.txt", "x.markdown", "x.py", "con.md", "Cours/aux.md", "PROGRA~1/x.md", "", ".md", "a//b.md", "a/./b.md", "x?.md", "Cours/e\u0301.md", "a\u202e.md", "a".repeat(600) + ".md"]) {
			r.check("chemin refused: " + JSON.stringify(bad.slice(0, 30)), v(good({ path: bad })).raison, "chemin");
		}
		r.check("a nested relative note path is accepted", v(good({ path: "B2 2026-2027/Python/CM 1.md" })).ok, true);
		// Admission
		const tk = (id, from, at) => ({ id, from, at });
		r.check("admission: a new request runs", Q.admettre({ id: "new-1234", from: PH }, { taken: [], busy: false }, NOW), "run");
		r.check("admission: a taken id is known (any case of the sender)", Q.admettre({ id: "new-1234", from: PH }, { taken: [tk("new-1234", PH.toUpperCase(), NOW)], busy: false }, NOW), "known");
		r.check("admission: the same id from another sender is not the same request", Q.admettre({ id: "new-1234", from: PH2 }, { taken: [tk("new-1234", PH, NOW)], busy: false }, NOW), "run");
		const twenty = Array.from({ length: 20 }, (_, i) => tk("r-" + i + "-xxx", PH, NOW - 60_000));
		r.check("admission: the 21st run of an hour is refused", Q.admettre({ id: "new-1234", from: PH }, { taken: twenty, busy: false }, NOW), "rate");
		r.check("admission: the limit is per sender", Q.admettre({ id: "new-1234", from: PH2 }, { taken: twenty, busy: false }, NOW), "run");
		r.check("admission: runs older than an hour do not count", Q.admettre({ id: "new-1234", from: PH }, { taken: twenty.map(e => ({ ...e, at: NOW - 2 * 3600e3 })), busy: false }, NOW), "run");
		r.check("admission: a corrupt time counts as recent", Q.admettre({ id: "new-1234", from: PH }, { taken: twenty.map(e => ({ ...e, at: NaN })), busy: false }, NOW), "rate");
		r.check("taken list: garbage dropped, 200 kept at most", [Q.lireTaken([null, 1, { id: "a" }, tk("ok-12345", PH, 1)]).length, Q.lireTaken(Array.from({ length: 250 }, (_, i) => tk("x-" + i + "-xx", PH, i))).length], [1, 200]);
		// Results
		const res = (over = {}) => ({ v: 1, id: "lq3k2-abc123", at: NOW, status: "ok", stdout: "1\n", ...over });
		r.check("result: a good one is read", Q.lireResultat(res(), "lq3k2-abc123"), res());
		for (const [n, raw] of [["another id", res({ id: "other-1234" })], ["unknown key", res({ html: "<b>" })], ["unknown status", res({ status: "exploded" })], ["stdout too long", res({ stdout: "x".repeat(Q.MAX_OUTPUT + 1) })], ["error not a string", res({ error: 3 })], ["bad module name", res({ status: "unsupported", unsupported: ["a b"] })]]) {
			r.check("result refused: " + n, Q.lireResultat(raw, "lq3k2-abc123"), null);
		}
		r.check("result written: outputs capped at 256 KiB each", [Q.construireResultat("id-12345", { status: "error", stdout: "x".repeat(300_000), error: "e".repeat(300_000) }, NOW)].map(x => [x.stdout.length, x.error.length]), [[262144, 262144]]);

		/* ── 2. blocsPython reads EXACTLY what the engine runs ── */
		const blocks = B.blocsPython(NOTE_A);
		r.check("blocsPython: the quiz's Python blocks, each once (quote, steps, \\')", [...blocks].sort(), [CODE_QUOTE, CODE_STEPS, CODE_SINGLE].sort());
		r.check("blocsPython: a fence outside the quiz block is not one", blocks.includes(`print("outside")`), false);
		r.check("blocsPython: a C block is not one", blocks.some(b => b.includes("int main")), false);
		r.check("blocsPython: CRLF read as the HTML parser reads it", B.blocsPython([`${F}quiz-blocks`, "[", `  ${JSON.stringify({ prompt: `B\n\n${F}python\na = 1\r\nb = 2\n${F}` })}`, "]", F].join("\n")), ["a = 1\nb = 2"]);
		r.check("blocsPython: an unreadable quiz block gives nothing, never throws", B.blocsPython(`${F}quiz-blocks\n[ { prompt: \n${F}`), []);
		{
			// The engine's own rendering: the prompt through `rendreTexteQuiz`, the steps through the reading's renderer.
			const imgs = { embed: () => "", image: () => "" };
			const items = QU.parseQuizSource(NOTE_A.match(QU.QUIZ_BLOCK_RE)[1]);
			const bloc = (s) => San.rendreTexteQuiz(s, imgs, true);
			const portes = { bloc, inline: s => San.renderInlineText(s), attribut: s => San.escapeHtmlAttr(s) };
			const html = [bloc(items[0].prompt), Lec.corpsLectureHtml(items[1], items[1].prompt, bloc(items[1].prompt), undefined, portes).html, bloc(items[2].prompt), bloc(items[3].prompt)].join("");
			const div = document.createElement("div");
			div.innerHTML = html;
			const shown = [...div.querySelectorAll('.quiz-code-block-executable[data-lang="python"] code')].map(c => c.textContent);
			r.check("rendered by the engine: the three Python blocks shown", shown.length, 3);
			const hashes = async (list) => (await Promise.all(list.map(s => B.sha256Hex(s)))).sort();
			r.check("rendered by the engine: the phone's hashes are exactly blocsPython's", await hashes(shown), await hashes(blocks));
		}

		/* ── 3. The PC ── */
		const sha = (s) => B.sha256Hex(s);
		function pcWorld(notes = { "Cours/A.md": NOTE_A, "Cours/B.md": NOTE_B }, fs = memFs()) {
			const w = { fs, now: NOW, runs: [], installs: [], noteReads: [], taken: [], runImpl: async () => ({ status: "ok", stdout: "out\n" }) };
			w.files = Files.createCodeRunFiles({ fs, rootId: ROOT, deviceId: PC });
			w.phone = (dev = PH) => Files.createCodeRunFiles({ fs, rootId: ROOT, deviceId: dev });
			w.state = R.newPcState();
			w.deps = () => ({
				device: PC, now: () => w.now, files: w.files, state: w.state,
				readNote: async (rel) => { w.noteReads.push(rel); return notes[rel] ?? null; },
				run: async (job) => { w.runs.push(job); return w.runImpl(job); },
				install: async (missing) => { w.installs.push(missing); return "ok"; },
				takenLog: { read: async () => [...w.taken], write: async (list) => { w.taken = [...list]; } },
			});
			w.pass = () => quiet(() => R.traiterDemandes(w.deps()));
			w.result = (id) => { const s = fs.files.get(`${BASE}/results/${PC}/${id}.json`); return s ? JSON.parse(s) : null; };
			w.send = async (over = {}, dev = PH) => { const q = { v: 1, id: "lq3k2-abc123", at: w.now - 1000, from: dev, target: PC, path: "Cours/A.md", sha256: await sha(CODE_QUOTE), accepted: true, ...over }; await w.phone(dev).writeRequest(q); return q; };
			return w;
		}
		{
			const w = pcWorld();
			await w.send();
			await w.pass();
			r.check("PC: the matching block runs, its exact code, 60 s, no stdin", w.runs.map(j => [j.language, j.code, j.timeoutMs, j.stdin]), [["python", CODE_QUOTE, 60000, ""]]);
			r.check("PC: the result is in its own folder", [w.result("lq3k2-abc123")?.status, w.result("lq3k2-abc123")?.stdout], ["ok", "out\n"]);
			await w.pass();
			r.check("PC: the same id on the next pass is not run again", w.runs.length, 1);
			w.state = R.newPcState();
			await w.pass();
			r.check("PC: nor after a restart (taken list in the settings)", [w.runs.length, w.taken.map(t => t.id)], [1, ["lq3k2-abc123"]]);
		}
		{
			const w = pcWorld();
			await w.send({ sha256: await sha(CODE_B) });
			await w.pass();
			r.check("PC: the hash of a block of ANOTHER note -> nothing runs", w.runs.length, 0);
			r.check("PC: ... and the phone is told the quiz changed", [w.result("lq3k2-abc123")?.status, w.result("lq3k2-abc123")?.error], ["unavailable", "changed"]);
			await w.send({ id: "lq3k2-abc124", sha256: await sha(CODE_QUOTE + " ") });
			await w.pass();
			r.check("PC: a hash one character off -> nothing runs", [w.runs.length, w.result("lq3k2-abc124")?.error], [0, "changed"]);
			await w.send({ id: "lq3k2-abc125", path: "Cours/Gone.md" });
			await w.pass();
			r.check("PC: a note that is gone -> changed, nothing runs", [w.runs.length, w.result("lq3k2-abc125")?.error], [0, "changed"]);
		}
		{
			const w = pcWorld();
			// Written by hand: the phone's own writer would never produce these.
			const hostile = async (id, over) => { w.fs.files.set(`${BASE}/requests/${PH}/${id}.json`, JSON.stringify({ v: 1, id, at: w.now - 1000, from: PH, target: PC, path: "Cours/A.md", sha256: await sha(CODE_QUOTE), accepted: true, ...over })); };
			await hostile("esc-0001", { path: "../A.md" });
			await hostile("esc-0002", { path: ".neo-quiz/A.md" });
			await hostile("esc-0003", { path: "C:/Cours/A.md" });
			await hostile("esc-0004", { path: "\\\\srv\\A.md" });
			await w.pass();
			r.check("PC: a path that escapes -> refused, no note read, nothing run, no result", [w.noteReads, w.runs.length, [...w.fs.files.keys()].filter(k => k.includes("/results/")).length], [[], 0, 0]);
			const reads = w.fs.reads.length;
			await w.pass();
			r.check("PC: a refused request is not read again", w.fs.reads.length, reads);
		}
		{
			const w = pcWorld();
			// The PC's own folder: never a sender (the real files never list it, the validator refuses it).
			w.fs.files.set(`${BASE}/requests/${PC}/self-0001.json`, JSON.stringify({ v: 1, id: "self-0001", at: w.now, from: PC, target: PC, path: "Cours/A.md", sha256: await sha(CODE_QUOTE), accepted: true }));
			// A phone folder claiming to be another device.
			w.fs.files.set(`${BASE}/requests/${PH}/fake-0001.json`, JSON.stringify({ v: 1, id: "fake-0001", at: w.now, from: PH2, target: PC, path: "Cours/A.md", sha256: await sha(CODE_QUOTE), accepted: true }));
			await w.send({ id: "other-0001", target: PH2 });
			await w.send({ id: "old-00001", at: w.now - 121_000 });
			await w.pass();
			r.check("PC: own folder, impersonation, another target, a stale request -> nothing runs", w.runs.length, 0);
			r.check("PC: a request in the PC's own folder is never even read", w.fs.reads.some(p => p.includes(`/requests/${PC}/`)), false);
		}
		{
			const w = pcWorld();
			for (let i = 0; i < 21; i++) await w.send({ id: `r${String(i).padStart(2, "0")}-flood` });
			await w.send({ id: "zz-other-1" }, PH2);
			// A pass reads 20 files per sender at most: the 21st comes on the next one.
			await w.pass();
			await w.pass();
			r.check("PC: 20 runs per sender per hour; another sender still runs", [w.runs.length, w.result("r20-flood")?.status, w.result("zz-other-1")?.status], [21, "unavailable", "ok"]);
		}
		{
			const w = pcWorld();
			let n = 0;
			w.runImpl = async () => (++n === 1 ? { status: "not-installed", stdout: "", missing: ["torch"] } : { status: "ok", stdout: "tensor\n" });
			await w.send();
			await w.pass();
			r.check("PC: missing pinned libraries installed once, then one more run", [w.installs, w.runs.length, w.result("lq3k2-abc123")?.stdout], [[["torch"]], 2, "tensor\n"]);
		}
		{
			const w = pcWorld();
			let release;
			let calls = 0;
			w.runImpl = () => (++calls === 1 ? new Promise(res => { release = res; }) : Promise.resolve({ status: "ok", stdout: "" }));
			await w.send();
			const first = R.traiterDemandes(w.deps());
			await tick();
			await w.send({ id: "lq3k2-abc999" });
			await w.pass();
			r.check("PC: one run at a time (a pass during a run returns at once)", w.runs.length, 1);
			release({ status: "ok", stdout: "" });
			await first;
			await w.pass();
			r.check("PC: the next pass takes the waiting request", w.runs.length, 2);
		}
		{
			const w = pcWorld();
			w.fs.files.set(`${BASE}/results/${PC}/old-00001.json`, JSON.stringify({ v: 1, id: "old-00001", at: NOW - 11 * 60_000, status: "ok", stdout: "" }));
			w.fs.files.set(`${BASE}/results/${PC}/new-00001.json`, JSON.stringify({ v: 1, id: "new-00001", at: NOW - 60_000, status: "ok", stdout: "" }));
			w.fs.files.set(`${BASE}/results/${PH}/old-00002.json`, JSON.stringify({ v: 1, id: "old-00002", at: NOW - 60 * 60_000, status: "ok", stdout: "" }));
			// Temp files left by an interrupted write: judged by the same age.
			w.fs.files.set(`${BASE}/results/${PC}/old-00003.json.tmp`, JSON.stringify({ v: 1, id: "old-00003", at: NOW - 11 * 60_000, status: "ok", stdout: "" }));
			w.fs.files.set(`${BASE}/results/${PC}/torn-0001.json.tmp`, "{ torn");
			w.fs.files.set(`${BASE}/results/${PC}/new-00002.json.tmp`, JSON.stringify({ v: 1, id: "new-00002", at: NOW - 60_000, status: "ok", stdout: "" }));
			await w.pass();
			r.check("PC: its results (and temp files) older than 10 min go, fresh ones and other devices' stay", [...w.fs.files.keys()].filter(k => k.includes("/results/")).sort(), [`${BASE}/results/${PC}/new-00001.json`, `${BASE}/results/${PC}/new-00002.json.tmp`, `${BASE}/results/${PH}/old-00002.json`]);
		}
		{
			// 50 junk files sorted first (torn, oversized, not an object) must not hide a real request behind the 20-file window.
			const w = pcWorld();
			for (let i = 0; i < 50; i++) {
				const body = i % 3 === 0 ? "{ torn" : i % 3 === 1 ? "x".repeat(20_000) : "[1,2,3]";
				w.fs.files.set(`${BASE}/requests/${PH}/0-junk-${String(i).padStart(2, "0")}.json`, body);
			}
			await w.send();
			for (let i = 0; i < 4; i++) await w.pass();
			r.check("PC: 50 junk files then a valid request -> the valid one runs", [w.runs.length, w.result("lq3k2-abc123")?.status], [1, "ok"]);
			const reads = w.fs.reads.length;
			await w.pass();
			r.check("PC: junk is not read again on the next pass", w.fs.reads.length, reads);
			w.now += 31_000;
			for (let i = 0; i < 4; i++) await w.pass();
			r.check("PC: unreadable files are read again after a while, and the run is never repeated", [w.fs.reads.length > reads, w.runs.length], [true, 1]);
		}
		{
			// The refused memory is bounded: the oldest entries go first.
			const w = pcWorld();
			for (let i = 0; i < R.MAX_REFUSED; i++) w.state.refused.set("seed/" + i, Infinity);
			w.fs.files.set(`${BASE}/requests/${PH}/bad-00001.json`, JSON.stringify({ v: 1 }));
			await w.pass();
			r.check("PC: refused memory capped, oldest forgotten, newest kept", [w.state.refused.size, w.state.refused.has("seed/0"), w.state.refused.has(PH.toLowerCase() + "/bad-00001")], [R.MAX_REFUSED, false, true]);
		}
		{
			// Many senders fill the 200-entry taken list: a sender's own runs still count against its hourly limit.
			const w = pcWorld();
			const ownReq = (dev) => [...w.fs.files.keys()].filter(k => k.includes(`/requests/${dev}/`));
			for (let i = 0; i < 20; i++) await w.send({ id: `ph-${String(i).padStart(2, "0")}-run` });
			await w.pass();
			for (const k of ownReq(PH)) w.fs.files.delete(k);
			for (let s = 0; s < 10; s++) {
				const dev = `44444444-4444-4444-8444-4444444444${String(s).padStart(2, "0")}`;
				for (let i = 0; i < 20; i++) await w.send({ id: `s${s}-${String(i).padStart(2, "0")}-run` }, dev);
				await w.pass();
				for (const k of ownReq(dev)) w.fs.files.delete(k);
			}
			r.check("PC: 220 runs from 11 senders, the taken list holds 200", [w.runs.length, w.taken.length, w.taken.some(t => t.from === PH)], [220, 200, false]);
			await w.send({ id: "ph-20-run" });
			await w.pass();
			r.check("PC: ... and the 21st run of the first sender in the hour is still refused", [w.runs.length, w.result("ph-20-run")?.status], [220, "unavailable"]);
			r.check("admission: counted on the runs of the hour when given", Q.admettre({ id: "new-1234", from: PH }, { taken: [], busy: false, runs: twenty }, NOW), "rate");
		}
		{
			// `missing` from a run is bounded before any install is asked.
			for (const [n, missing] of [["21 names", Array.from({ length: 21 }, (_, i) => "pkg" + i)], ["a path", ["../evil"]], ["a space", ["a b"]], ["not a string", [3]]]) {
				const w = pcWorld();
				w.runImpl = async () => ({ status: "not-installed", stdout: "", missing });
				await w.send();
				await w.pass();
				r.check("PC: install never asked for missing = " + n, [w.installs.length, w.result("lq3k2-abc123")?.status], [0, "unavailable"]);
			}
			const w = pcWorld();
			let k = 0;
			w.runImpl = async () => (++k === 1 ? { status: "not-installed", stdout: "", missing: ["scikit-learn", "typing_extensions"] } : { status: "ok", stdout: "" });
			await w.send();
			await w.pass();
			r.check("PC: real package names pass", w.installs, [["scikit-learn", "typing_extensions"]]);
		}

		/* ── 4. The phone ── */
		const peer = { id: "SYNC-ID", name: "PC", connected: true, paused: false, seenAt: null };
		r.check("phone: no paired device -> no PC", R.choosePc({ files: [], now: NOW, lastEver: PC, chosen: PC, devices: [], peers: [], peerConnected: false }), { target: null, reachable: false });
		r.check("phone: a PC seen and a peer connected -> that PC, reachable", R.choosePc({ files: [], now: NOW, lastEver: PC, chosen: null, devices: [], peers: [peer], peerConnected: true }), { target: PC, reachable: true });
		function phone(w, over = {}) {
			let ids = 0;
			const t0 = w.now;
			const deps = {
				device: PH, rootId: ROOT, now: () => w.now, newId: () => "ph" + (++ids) + "-run1",
				sleep: async (ms) => { w.now += ms; if (deps.onSleep) await deps.onSleep(); },
				files: w.phone(PH), pc: () => ({ target: PC, reachable: true }), ...over,
			};
			deps.elapsed = () => w.now - t0;
			return deps;
		}
		const job = (over = {}) => ({ language: "python", code: CODE_QUOTE, stdin: "", timeoutMs: 60000, sourcePath: `${ROOT}/Cours/A.md`, ...over });
		const ownRequests = (w) => [...w.fs.files.keys()].filter(k => k.includes(`/requests/${PH}/`));
		{
			const w = pcWorld();
			r.check("phone: no PC -> no-pc at once, nothing written", [await R.executerSurPc(job(), phone(w, { pc: () => ({ target: null, reachable: false }) })), w.fs.files.size], [{ status: "unavailable", stdout: "", error: "no-pc" }, 0]);
			r.check("phone: a PC not reachable -> no-pc at once", (await R.executerSurPc(job(), phone(w, { pc: () => ({ target: PC, reachable: false }) }))).error, "no-pc");
			r.check("phone: a note outside the synced root -> nothing written", [(await R.executerSurPc(job({ sourcePath: "Other/A.md" }), phone(w))).status, w.fs.files.size], ["unavailable", 0]);
		}
		{
			const w = pcWorld();
			const d = phone(w);
			const out = await quiet(() => R.executerSurPc(job(), d));
			r.check("phone: nobody answers -> pc-silent after 90 s", [out, d.elapsed()], [{ status: "unavailable", stdout: "", error: "pc-silent" }, 90_000]);
			r.check("phone: the request is deleted when it gives up", ownRequests(w), []);
		}
		{
			const w = pcWorld();
			const d = phone(w);
			// A result for the same id, written in ANOTHER device's folder.
			d.onSleep = async () => { w.fs.files.set(`${BASE}/results/${PH2}/ph1-run1.json`, JSON.stringify({ v: 1, id: "ph1-run1", at: w.now, status: "ok", stdout: "forged" })); };
			r.check("phone: a result from a device other than the target is ignored", (await quiet(() => R.executerSurPc(job(), d))).error, "pc-silent");
		}
		{
			const w = pcWorld();
			const d = phone(w);
			let polls = 0;
			d.onSleep = async () => { if (++polls === 3) await w.pass(); };
			const out = await R.executerSurPc(job(), d);
			r.check("round trip: the phone's request runs on the PC, the result comes back", [out, w.runs.map(j => j.code)], [{ status: "ok", stdout: "out\n" }, [CODE_QUOTE]]);
			r.check("round trip: the phone deletes its request once it has the result", ownRequests(w), []);
		}
		{
			const w = pcWorld();
			w.deps = ((orig) => () => ({ ...orig(), install: undefined }))(w.deps);
			w.runImpl = async () => ({ status: "not-installed", stdout: "", missing: ["torch"] });
			const d = phone(w);
			d.onSleep = async () => { await w.pass(); };
			r.check("round trip: the phone never asks to install (not-installed -> unavailable)", (await R.executerSurPc(job(), d)).status, "unavailable");
		}
		{
			const w = pcWorld();
			const d = phone(w);
			d.onSleep = async () => { await w.pass(); };
			r.check("round trip: a block of the note that changed since -> quiz changed", await R.executerSurPc(job({ code: CODE_QUOTE + "\n# edited" }), d), { status: "unavailable", stdout: "", error: "changed" });
		}

		/* ── 5. The engine says it in words ── */
		{
			function block() {
				const container = document.createElement("div");
				container.innerHTML = `<div class="quiz-code-block quiz-code-block-executable" data-lang="python"><div class="quiz-code-toolbar"><button type="button" class="quiz-code-run-btn" data-quiz-code-run hidden></button></div><pre class="quiz-md-code"><code>print(1)</code></pre><div class="quiz-code-output" hidden></div></div>`;
				return container;
			}
			const texts = [];
			for (const error of ["no-pc", "pc-silent", "changed"]) {
				const container = block();
				let release;
				const jobs = [];
				const host = { platform: { isMobile: true }, code: { languages: () => ["python"], run: (j) => { jobs.push(j); return new Promise(res => { release = res; }); }, warm: () => {}, avertissement: { masque: async () => true, masquer: async () => {} } } };
				Run.createCodeRunHandlers({ container, host, sourcePath: `${ROOT}/Cours/A.md` }).bindCodeRunButtons();
				container.querySelector(".quiz-code-run-btn").dispatchEvent(new document.defaultView.Event("click"));
				await tick();
				const waiting = container.querySelector(".quiz-code-output").textContent;
				release({ status: "unavailable", stdout: "", error });
				await tick();
				texts.push([waiting, container.querySelector(".quiz-code-output").textContent, jobs[0].sourcePath]);
			}
			r.check("engine on the phone: waiting, then each reason in words, the note path sent", texts, [
				["Running on your PC…", "Python runs on your PC: pair one in Sync.", `${ROOT}/Cours/A.md`],
				["Running on your PC…", "Your PC did not answer: is it on, with Neo Quiz open?", `${ROOT}/Cours/A.md`],
				["Running on your PC…", "The quiz changed: open it again.", `${ROOT}/Cours/A.md`],
			]);
		}
		r.done();
	},
);
