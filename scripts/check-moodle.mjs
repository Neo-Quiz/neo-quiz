/**
 * Moodle sync (main process): the owner's Obsidian plugin tests, ported, plus
 * the security cases of docs/superpowers/specs/2026-10-07-moodle-sync-design.md.
 *
 * The REAL code is loaded (`apps/windows/electron/moodle/*.ts`), against local
 * http servers (the client has a tests-only `allowHttpForTests` switch; this
 * script also checks that no file of the app sets it).
 *
 * Discriminance: the off-host redirect check and the passport check are each
 * replayed on a MUTANT of the real source (the guard cut out) and must then
 * FAIL: a case that stays green whatever the code does proves nothing.
 *
 *     npm run check:moodle
 *
 * Exit code only (`process.exitCode`, never `process.exit()`).
 */
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { withSrcModule } from "./lib/load-src.mjs";

const failures = [];
let total = 0;
async function test(name, fn) {
	total++;
	if (process.env.MOODLE_TRACE) console.log("...", name);
	try {
		await fn();
	} catch (e) {
		failures.push(name);
		console.error("FAIL  " + name + "\n      " + (e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n      ") : e));
	}
}

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "moodle-check-"));
const ALL = { contient: async () => true };
const MOODLE = "apps/windows/electron/moodle/";

/* ─────────── local servers ─────────── */
function server(handler) {
	return new Promise(resolve => {
		const s = http.createServer(handler);
		s.listen(0, "127.0.0.1", () => resolve({ s, root: `http://127.0.0.1:${s.address().port}` }));
	});
}
const stop = s => { s.closeAllConnections(); s.close(); };
const readBody = req => new Promise(resolve => {
	const chunks = [];
	req.on("data", d => chunks.push(d));
	req.on("end", () => resolve(Buffer.concat(chunks).toString()));
});

/** A mutant of a real module: `from` replaced by `to` in its source, bundled
    in memory (relative imports resolve), loaded from a temp file. */
async function mutant(entry, from, to) {
	const src = fs.readFileSync(entry, "utf8");
	assert.ok(src.includes(from), "mutation does not apply: " + from);
	const dir = tmpdir();
	const out = path.join(dir, "mutant.mjs");
	const res = await build({
		stdin: { contents: src.replace(from, to), resolveDir: path.dirname(path.resolve(entry)), loader: "ts", sourcefile: entry },
		bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
		banner: { js: "import { createRequire as __cr } from 'node:module'; var require = __cr(import.meta.url);" },
	});
	fs.writeFileSync(out, res.outputFiles[0].text);
	return { mod: await import(pathToFileURL(out).href), dir };
}

const mods = [`${MOODLE}pur.ts`, `${MOODLE}noms.ts`, `${MOODLE}client.ts`, `${MOODLE}disque.ts`, `${MOODLE}api.ts`,
	`${MOODLE}garde.ts`, `${MOODLE}jeton.ts`, `${MOODLE}service.ts`, `${MOODLE}erreurs.ts`, `${MOODLE}cours.ts`, `${MOODLE}compat.ts`, `${MOODLE}ecoles.ts`, `${MOODLE}adresse.ts`, "apps/windows/electron/reseau.ts"];

await withSrcModule(mods, async (pur, noms, client, disque, api, garde, jetonMod, service, erreurs, k, compat, ecolesMod, adresse, reseau) => {
	const { TokenError, MoodleError } = erreurs;
	const { createClient, siteInfo } = client;
	const T = { allowHttpForTests: true };
	const mk = (root, o = {}) => createClient("tok", root, { ...T, ...o });

	// Synthetic get_contents: one of each case met on a real Moodle.
	const SECTIONS = [
		{ name: "Généralités", modules: [
			{ id: 10, name: "Présentation", modname: "resource", uservisible: true, contents: [
				{ type: "file", filename: "Intro.pdf", filesize: 5, fileurl: "https://m/webservice/pluginfile.php/1/mod_resource/content/1/Intro.pdf?forcedownload=1", timemodified: 100 },
			] },
			{ id: 11, name: "Annonces", modname: "forum", uservisible: true },
			{ id: 12, name: "Consigne", modname: "label", uservisible: true },
		] },
		{ name: "Séance 1", modules: [
			{ id: 20, name: "Supports", modname: "folder", uservisible: true, contents: [
				{ type: "file", filename: "TP1.pdf", filepath: "/", filesize: 7, fileurl: "https://m/f/TP1.pdf", timemodified: 200 },
				{ type: "file", filename: "Intro.pdf", filepath: "/old/", filesize: 4, fileurl: "https://m/f/old/Intro.pdf", timemodified: 50 },
			] },
			{ id: 21, name: "Cours", modname: "page", uservisible: true, contents: [
				{ type: "file", filename: "index.html", fileurl: "https://m/p/index.html", timemodified: 1 },
				{ type: "file", filename: "schema.png", filesize: 3, fileurl: "https://m/p/schema.png", timemodified: 1 },
			] },
			{ id: 22, name: "Doc officielle", modname: "url", uservisible: true, contents: [{ type: "url", fileurl: "https://docs.python.org/" }] },
			{ id: 23, name: "Rendu TP1", modname: "assign", uservisible: true },
			{ id: 24, name: "Caché", modname: "resource", uservisible: false, contents: [{ type: "file", filename: "x.pdf", fileurl: "https://m/x.pdf" }] },
		] },
	];
	const ASSIGNS = [{ id: 900, cmid: 23, duedate: 5000, cutoffdate: 9000,
		introattachments: [{ filename: "Sujet TP1.pdf", filesize: 9, fileurl: "https://m/a/Sujet.pdf", timemodified: 300 }] }];
	const SUBMITTED = { lastattempt: { submission: { status: "submitted", timemodified: 400, plugins: [
		{ type: "file", fileareas: [{ area: "submission_files", files: [{ filename: "Compte-rendu TP1.pdf", filesize: 11, fileurl: "https://m/s/cr.pdf", timemodified: 400 }] }] },
	] } } };
	const DEPOSITS = new Map([[23, pur.parseSubmission(SUBMITTED)]]);

	/* ─────────── the plugin's tests, ported ─────────── */
	await test("sanitize: NFC, forbidden characters, spaces squeezed", () => {
		assert.equal(noms.sanitize("Révision.pdf"), "Révision.pdf");
		assert.equal(noms.sanitize("a:b/c?.pdf"), "a-b-c-.pdf");
		assert.equal(noms.sanitize("Admin  avancée   Scripting.pdf"), "Admin avancée Scripting.pdf");
		assert.equal(noms.sanitize("Re\u0301vision.pdf"), "Révision.pdf");
	});
	await test("decodeEntities: &amp; decoded last", () => {
		assert.equal(noms.decodeEntities("A &amp; B &quot;c&quot; &#039;d&#39; &lt;e&gt; &amp;lt;"), "A & B \"c\" 'd' <e> &lt;");
	});
	await test("parseCourse: code, year, cohort, cleaned name", () => {
		assert.deepEqual(pur.parseCourse({ id: "23101", shortname: "XTI302-CYB-2627PSA01",
			fullname: "* XTI302-CYB-2627PSA01 - Administration système avancées &amp; Scripting (X-BAC-CS-2, X-BAC-ICS-2)" }), {
			id: 23101, name: "XTI302-CYB-2627PSA01 - Administration système avancées & Scripting",
			code: "XTI302", yearKey: "2026-2027", cohort: "PSA01", enddate: 0 });
		assert.equal(pur.parseCourse({ id: 1, shortname: "x", fullname: "x", enddate: 1700000000 }).enddate, 1700000000);
		assert.equal(pur.parseCourse({ id: 1, shortname: "x", fullname: "x", enddate: -5 }).enddate, 0);
		assert.equal(pur.parseCourse({ id: 1, shortname: "XCS-413-2627PSA01", fullname: "x" }).code, "XCS413");
		assert.equal(pur.parseCourse({ id: 2, shortname: "XMUT301-2627PSA01", fullname: "x" }).code, "XMUT301");
		assert.equal(pur.parseCourse({ id: 3, shortname: "LXP-4GOOD-2627PSA01", fullname: "x" }).code, null);
		assert.equal(pur.parseCourse({ id: 4, shortname: "XTI305-CYB-2627BSA01", fullname: "x" }).cohort, "BSA01");
	});
	await test("course folder: starts with the code, else created from the code and name", () => {
		const root = tmpdir();
		fs.mkdirSync(path.join(root, "XTI302 - Admin"));
		fs.mkdirSync(path.join(root, "XTI3021 - Autre"));
		fs.writeFileSync(path.join(root, "XCS413 - fichier"), "x");
		const a = disque.dossierDuCours(root, "XTI302", "XTI302-CYB - Admin");
		assert.deepEqual([a.name, a.exists], ["XTI302 - Admin", true]);
		const b = disque.dossierDuCours(root, "XCS413", "XCS413-CYB-2627PSA01 - Fondamentaux: réseaux/IA");
		assert.deepEqual([b.name, b.exists], ["XCS413 - Fondamentaux- réseaux-IA", false]);
		assert.equal(path.dirname(b.dir), root);
		assert.equal(disque.dossierDuCours(path.join(root, "absent"), "XTI302", "x - Y").exists, false);
	});
	await test("flattenContents: files, folders, pages, links, assignments, deposit state", () => {
		const tree = pur.flattenContents(SECTIONS, ASSIGNS, DEPOSITS);
		assert.deepEqual(tree.map(s => s.name), ["Généralités", "Séance 1"]);
		assert.deepEqual(tree[0].activities.map(a => a.type), ["resource", "forum"]);
		const s1 = Object.fromEntries(tree[1].activities.map(a => [a.id, a]));
		assert.deepEqual(s1[20].files.map(f => f.name), ["Intro.pdf", "TP1.pdf"]);
		assert.deepEqual(s1[21].files.map(f => f.name), ["schema.png"]);
		assert.deepEqual(s1[22].external, ["https://docs.python.org/"]);
		assert.deepEqual(s1[23].files.map(f => f.name), ["Sujet TP1.pdf"]);
		assert.deepEqual(s1[23].deposit, { due: 5000, cutoff: 9000, status: "submitted", submittedAt: 400, files: [{ name: "Compte-rendu TP1.pdf", size: 11 }] });
		assert.equal(s1[20].deposit, undefined);
		assert.equal(s1[24], undefined);
		assert.deepEqual(tree[0].activities[0].files[0], {
			url: "https://m/webservice/pluginfile.php/1/mod_resource/content/1/Intro.pdf?forcedownload=1",
			name: "Intro.pdf", size: 5, timemodified: 100, status: "missing" });
	});
	await test("dedupe: one file per name (case ignored), the most recent wins", () => {
		const tree = pur.dedupe(pur.flattenContents(SECTIONS, ASSIGNS, DEPOSITS));
		const intro = pur.allFiles({ sections: tree }).filter(f => f.name.toLowerCase() === "intro.pdf");
		assert.equal(intro.length, 1);
		assert.equal(intro[0].timemodified, 100);
		const cased = pur.dedupe([{ name: "s", activities: [{ files: [{ name: "Cours.pdf", timemodified: 1 }, { name: "cours.pdf", timemodified: 2 }] }] }]);
		assert.deepEqual(cased[0].activities[0].files.map(f => f.name), ["cours.pdf"]);
	});
	await test("localStatus: absent, present, replaced on Moodle, newer local copy", () => {
		const dir = tmpdir();
		const f = (name, tm) => ({ name, timemodified: tm });
		assert.equal(disque.localStatus(f("a.pdf", 1000), dir), "missing");
		assert.equal(disque.localStatus(f("a.pdf", 1000), null), "missing");
		fs.writeFileSync(path.join(dir, "a.pdf"), "x");
		fs.utimesSync(path.join(dir, "a.pdf"), 1000, 1000);
		assert.equal(disque.localStatus(f("a.pdf", 1000), dir), "present");
		assert.equal(disque.localStatus(f("a.pdf", 1001), dir), "present");
		assert.equal(disque.localStatus(f("a.pdf", 1010), dir), "outdated");
		assert.equal(disque.localStatus(f("a.pdf", 500), dir), "present");
	});
	await test("applyStatus: a renamed copy (same size, same extension, depth 3) counts as present", () => {
		const dir = tmpdir();
		fs.mkdirSync(path.join(dir, "Ignite"));
		fs.writeFileSync(path.join(dir, "Ignite", "Solution du challenge.pdf"), Buffer.alloc(4096));
		fs.writeFileSync(path.join(dir, "petit.txt"), "abc");
		fs.mkdirSync(path.join(dir, ".venv"));
		fs.writeFileSync(path.join(dir, ".venv", "x.pdf"), Buffer.alloc(5000));
		fs.mkdirSync(path.join(dir, "a", "b", "c", "d"), { recursive: true });
		fs.writeFileSync(path.join(dir, "a", "b", "c", "d", "trop-profond.pdf"), Buffer.alloc(6000));
		const file = (name, size) => ({ name, size, timemodified: 1, status: "missing" });
		const scan = { sections: [{ activities: [{ files: [
			file("Challenge Ignite-solution.pdf", 4096), file("Autre.docx", 4096), file("mini.txt", 3), file("cache.pdf", 5000), file("profond.pdf", 6000),
		] }] }] };
		disque.applyStatus(scan, dir);
		assert.deepEqual(pur.allFiles(scan).map(x => [x.name, x.status, x.localName || null]), [
			["Challenge Ignite-solution.pdf", "present", path.join("Ignite", "Solution du challenge.pdf")],
			["Autre.docx", "missing", null], ["mini.txt", "missing", null], ["cache.pdf", "missing", null], ["profond.pdf", "missing", null],
		]);
	});
	await test("pendingDeposits: to hand in, urgent, late, new, ignored", () => {
		const H = 3600, now = 100 * H * 1000;
		const act = (id, o) => ({ id, name: `D${id}`, type: "assign", files: [], external: [], deposit: { due: 0, cutoff: 0, status: "new", submittedAt: 0, files: [], ...o } });
		const scan = { sections: [{ activities: [
			act(1, { due: 105 * H }), act(2, { due: 200 * H }), act(3, { due: 90 * H }), act(8, { due: 80 * H }),
			act(4, { due: 90 * H, cutoff: 95 * H }), act(5, { due: 150 * H, status: "submitted" }), act(6, { due: 300 * H }),
			{ id: 7, name: "Cours", type: "resource", files: [], external: [] },
		] }] };
		const list = pur.pendingDeposits(scan, { now, seen: new Set([2, 3]), ignored: new Set([6]) });
		assert.deepEqual(list.map(d => [d.id, d.state, d.fresh]), [[8, "late", true], [3, "late", false], [1, "urgent", true], [2, "todo", false]]);
	});
	await test("parseSubmission: status, date, files, extension, group submission", () => {
		assert.deepEqual(pur.parseSubmission(SUBMITTED), { status: "submitted", submittedAt: 400, extension: 0, files: [{ name: "Compte-rendu TP1.pdf", size: 11 }] });
		assert.deepEqual(pur.parseSubmission({ lastattempt: { submission: { status: "new", timemodified: 0 }, extensionduedate: 7000 } }), { status: "new", submittedAt: 0, extension: 7000, files: [] });
		assert.equal(pur.parseSubmission({ lastattempt: { teamsubmission: { status: "submitted", timemodified: 5 } } }).status, "submitted");
		assert.equal(pur.parseSubmission({}).status, "new");
	});
	await test("depositState: submitted, todo, urgent under 8 h, late, closed, no date", () => {
		const H = 3600;
		const dep = o => ({ due: 100 * H, cutoff: 0, status: "new", submittedAt: 0, files: [], ...o });
		const at = sec => sec * 1000;
		assert.equal(pur.depositState(dep({ status: "submitted" }), at(200 * H)).state, "submitted");
		assert.equal(pur.depositState(dep({}), at(91 * H)).state, "todo");
		const urgent = pur.depositState(dep({}), at(92 * H));
		assert.equal(urgent.state, "urgent");
		assert.equal(urgent.remaining, 8 * H * 1000);
		assert.equal(pur.depositState(dep({}), at(101 * H)).state, "late");
		assert.equal(pur.depositState(dep({ cutoff: 110 * H }), at(105 * H)).state, "late");
		assert.equal(pur.depositState(dep({ cutoff: 110 * H }), at(111 * H)).state, "closed");
		assert.equal(pur.depositState(dep({ due: 0 }), at(1)).state, "open");
		assert.equal(pur.depositState(dep({ status: "draft" }), at(95 * H)).state, "urgent");
		const ext = pur.depositState(dep({ extension: 200 * H }), at(150 * H));
		assert.deepEqual([ext.state, ext.due], ["todo", 200 * H]);
	});
	await test("formatRemaining: minutes, hours, days", () => {
		const M = 60 * 1000;
		assert.equal(pur.formatRemaining(42 * M), "42 min");
		assert.equal(pur.formatRemaining(5 * 60 * M + 7 * M), "5 h 07");
		assert.equal(pur.formatRemaining(3 * 24 * 60 * M + 4 * 60 * M), "3 d 4 h");
		assert.equal(pur.formatRemaining(30 * 1000), "less than a minute");
	});
	await test("applyStatus, pending, summarize: failures count as missing", () => {
		const dir = tmpdir();
		fs.writeFileSync(path.join(dir, "ici.pdf"), "x");
		const scan = { sections: [{ name: "s", activities: [{ files: [
			{ name: "ici.pdf", timemodified: 1, status: "missing" }, { name: "absent.pdf", timemodified: 1, status: "present" },
			{ name: "raté.pdf", timemodified: 1, status: "failed" }, { name: "encours.pdf", timemodified: 1, status: "busy" },
		] }] }] };
		disque.applyStatus(scan, dir);
		assert.deepEqual(pur.allFiles(scan).map(x => x.status), ["present", "missing", "failed", "busy"]);
		assert.deepEqual(pur.pending(scan).map(x => x.name), ["absent.pdf", "raté.pdf"]);
		assert.deepEqual(pur.summarize(scan), { missing: 2, outdated: 0 });
	});
	await test("uniqueJobs: one download per path (case ignored), the most recent", () => {
		const jobs = [
			{ dir: "D", file: { name: "Plan.pdf", timemodified: 1 }, tag: "PSA" },
			{ dir: "D", file: { name: "plan.pdf", timemodified: 5 }, tag: "BSA" },
			{ dir: "E", file: { name: "Plan.pdf", timemodified: 1 }, tag: "autre" },
			{ dir: "F", target: "Joli.pdf", file: { name: "a.pdf", timemodified: 1 }, tag: "t1" },
			{ dir: "F", target: "joli.pdf", file: { name: "b.pdf", timemodified: 2 }, tag: "t2" },
		];
		assert.deepEqual(pur.uniqueJobs(jobs).map(j => j.tag), ["BSA", "autre", "t2"]);
	});
	await test("limiter: never more than N tasks at once", async () => {
		const limit = pur.limiter(3);
		let active = 0, peak = 0;
		const task = () => limit(async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return 1; });
		assert.equal((await Promise.all(Array.from({ length: 10 }, task))).length, 10);
		assert.equal(peak, 3);
	});
	await test("names: cleanName, prettyName, pickTitle, safe segments", () => {
		assert.deepEqual(noms.cleanName("XTI302-CYB-Seance2_TP_Socle_Etudiant.pdf"), { seance: 2, stem: "TP Socle" });
		assert.equal(noms.prettyName("XTI302-CYB-Seance2_TP_Socle_Etudiant.pdf"), "Séance 2 - TP Socle.pdf");
		assert.equal(noms.prettyName("TP4.pdf", "Partie 1 - NumPy"), "TP4 - Partie 1 - NumPy.pdf");
		assert.equal(noms.pickTitle(["Écrire ses premiers scripts shell"], { name: "XTI302 - Admin" }), "Écrire ses premiers scripts shell");
		assert.equal(noms.pickTitle(["Intro"], {}), null);
		assert.equal(noms.safeSegment(".."), "_");
		assert.equal(noms.safeSegment("a/../b"), "a-..-b");
		assert.equal(noms.safeSegment("CON.txt"), "_CON.txt");
		assert.equal(noms.safeSegment("nom. "), "nom");
		assert.equal(noms.prettyName("../../evil.pdf").includes("/"), false);
	});

	/* ─────────── network ─────────── */
	await test("call and siteInfo: the token and function in the POST BODY, JSON back", async () => {
		const { s, root } = await server(async (req, res) => {
			const raw = await readBody(req);
			const p = new URLSearchParams(raw);
			const out = p.get("wsfunction") === "core_webservice_get_site_info" ? { userid: 42, fullname: "Ahmed", sitename: "x" }
				: { path: req.url, token: p.get("wstoken"), fn: p.get("wsfunction"), fmt: p.get("moodlewsrestformat"), x: p.get("courseids[0]") };
			res.end(JSON.stringify(out));
		});
		const c = mk(root);
		try {
			assert.deepEqual(await c.call("mod_x", { "courseids[0]": 7 }), { path: "/webservice/rest/server.php", token: "tok", fn: "mod_x", fmt: "json", x: "7" });
			assert.deepEqual(await siteInfo(c), { userid: 42, fullname: "Ahmed" });
		} finally { c.close(); stop(s); }
	});
	await test("call: invalid or expired token -> TokenError, other -> MoodleError", async () => {
		const replies = [
			{ exception: "moodle_exception", errorcode: "invalidtoken", message: "Invalid token" },
			{ exception: "webservice_access_exception", errorcode: "accessexception", message: "Invalid token - token expired" },
			{ exception: "require_login_exception", errorcode: "requireloginerror", message: "Course hidden" },
		];
		const { s, root } = await server((req, res) => res.end(JSON.stringify(replies.shift())));
		const c = mk(root);
		try {
			await assert.rejects(c.call("f"), e => e instanceof TokenError && e.code === "invalidtoken");
			await assert.rejects(c.call("f"), e => e instanceof TokenError && e.code === "accessexception");
			await assert.rejects(c.call("f"), e => !(e instanceof TokenError) && e instanceof MoodleError && e.code === "requireloginerror");
		} finally { c.close(); stop(s); }
	});
	await test("listCourses: the courses, with and without a code", async () => {
		const raw = [
			{ id: 1, shortname: "XTI302-CYB-2627PSA01", fullname: "* XTI302-CYB-2627PSA01 - Admin (X-BAC-CS-2)" },
			{ id: 2, shortname: "LXP-4GOOD-2627PSA01", fullname: "LXP" },
		];
		const seen = [];
		const { s, root } = await server(async (req, res) => {
			const p = new URLSearchParams(await readBody(req));
			seen.push([p.get("wsfunction"), p.get("userid")]);
			res.end(JSON.stringify(raw));
		});
		const c = mk(root);
		try {
			const list = await api.listCourses(c, 42);
			assert.deepEqual(list.map(co => [co.id, co.code]), [[1, "XTI302"], [2, null]]);
			assert.deepEqual(seen, [["core_enrol_get_users_courses", "42"]]);
		} finally { c.close(); stop(s); }
	});
	await test("scanCourse: contents + assignments + deposit states, statuses computed", async () => {
		const dir = tmpdir();
		fs.writeFileSync(path.join(dir, "TP1.pdf"), "x");
		fs.utimesSync(path.join(dir, "TP1.pdf"), 1000, 1000);
		const { s, root } = await server(async (req, res) => {
			const fn = new URLSearchParams(await readBody(req)).get("wsfunction");
			res.end(JSON.stringify(fn === "core_course_get_contents" ? SECTIONS
				: fn === "mod_assign_get_assignments" ? { courses: [{ id: 5, assignments: ASSIGNS }] }
				: fn === "mod_assign_get_submission_status" ? SUBMITTED : { exception: "x", errorcode: "unexpected", message: fn }));
		});
		const c = mk(root);
		try {
			const scan = await api.scanCourse(c, 5, dir);
			const byName = Object.fromEntries(pur.allFiles(scan).map(f => [f.name, f.status]));
			assert.equal(byName["TP1.pdf"], "present");
			assert.equal(byName["Sujet TP1.pdf"], "missing");
			assert.equal(byName["Compte-rendu TP1.pdf"], undefined);
			assert.equal(scan.sections[1].activities.find(a => a.id === 23).deposit.status, "submitted");
			assert.deepEqual(scan.external, ["https://docs.python.org/"]);
		} finally { c.close(); stop(s); }
	});
	await test("downloadFiles: writes, follows a redirect, checks the size, Moodle's date, existing file intact on failure", async () => {
		const dir = tmpdir();
		fs.writeFileSync(path.join(dir, "garde.pdf"), "ancien");
		const { s, root } = await server((req, res) => {
			const u = new URL(req.url, "http://x");
			if (u.searchParams.get("token") !== "tok") { res.statusCode = 403; res.end(); return; }
			if (u.pathname === "/ok.pdf") { res.setHeader("Content-Type", "application/pdf"); res.end("12345"); return; }
			if (u.pathname === "/redir.pdf") { res.statusCode = 302; res.setHeader("Location", "/ok.pdf?token=tok"); res.end(); return; }
			if (u.pathname === "/court.pdf") { res.setHeader("Content-Type", "application/pdf"); res.end("12"); return; }
			if (u.pathname === "/long.pdf") { res.setHeader("Content-Type", "application/pdf"); res.end("1234567890"); return; }
			res.setHeader("Content-Type", "application/json");
			res.end('{"error":"x","errorcode":"invalidtoken"}');
		});
		const c = mk(root);
		const f = (name, p, size) => ({ name, url: `${root}${p}?forcedownload=1`, size, timemodified: 1700000000, status: "missing" });
		const done = [];
		try {
			const r = await disque.downloadFiles(c, [
				{ file: f("ok.pdf", "/ok.pdf", 5), dir }, { file: f("redir.pdf", "/redir.pdf", 5), dir },
				{ file: f("garde.pdf", "/court.pdf", 5), dir }, { file: f("refus.pdf", "/json", null), dir },
				{ file: f("trop.pdf", "/long.pdf", 5), dir },
			], ALL, (job, err) => done.push([job.file.name, err ? err.code : "ok"]));
			assert.deepEqual(r.map(x => x.ok), [true, true, false, false, false]);
			assert.equal(fs.readFileSync(path.join(dir, "ok.pdf"), "utf8"), "12345");
			assert.equal(Math.round(fs.statSync(path.join(dir, "ok.pdf")).mtimeMs / 1000), 1700000000);
			assert.equal(fs.readFileSync(path.join(dir, "redir.pdf"), "utf8"), "12345");
			assert.equal(fs.readFileSync(path.join(dir, "garde.pdf"), "utf8"), "ancien");
			assert.equal(fs.existsSync(path.join(dir, "refus.pdf")), false);
			assert.equal(fs.existsSync(path.join(dir, "trop.pdf")), false);
			assert.deepEqual(fs.readdirSync(dir).filter(n => n.endsWith(".tmp")), []);
			assert.deepEqual(done.find(d => d[0] === "garde.pdf"), ["garde.pdf", "incomplete"]);
			assert.deepEqual(done.find(d => d[0] === "refus.pdf"), ["refus.pdf", "refused"]);
			assert.deepEqual(done.find(d => d[0] === "trop.pdf"), ["trop.pdf", "incomplete"]);
		} finally { c.close(); stop(s); }
	});
	await test("friendly: a locked file -> explicit message, Moodle errors unchanged", () => {
		for (const code of ["EBUSY", "EPERM", "EACCES"]) {
			const e = disque.friendly(Object.assign(new Error("x"), { code }));
			assert.equal(e.code, "locked");
			assert.match(e.message, /open in another application/);
		}
		assert.equal(disque.friendly(new MoodleError("timeout", "t")).code, "timeout");
	});
	await test("call: a silent Moodle -> MoodleError timeout", async () => {
		const { s, root } = await server(() => { /* never answers */ });
		const c = mk(root, { apiTimeout: 100 });
		try { await assert.rejects(c.call("f"), e => e instanceof MoodleError && e.code === "timeout"); } finally { c.close(); stop(s); }
	});
	await test("downloadFiles: an interrupted stream -> timeout, temp file removed, existing intact", async () => {
		const dir = tmpdir();
		fs.writeFileSync(path.join(dir, "lent.pdf"), "ancien");
		const { s, root } = await server((req, res) => { res.setHeader("Content-Type", "application/pdf"); res.write("12"); });
		const c = mk(root, { idleTimeout: 100 });
		try {
			const [r] = await disque.downloadFiles(c, [{ file: { name: "lent.pdf", url: `${root}/lent.pdf`, size: 5, timemodified: 1 }, dir }], ALL);
			assert.equal(r.ok, false);
			assert.match(r.error, /no data for 60 s/);
			assert.equal(fs.readFileSync(path.join(dir, "lent.pdf"), "utf8"), "ancien");
			assert.deepEqual(fs.readdirSync(dir).filter(n => n.endsWith(".tmp")), []);
		} finally { c.close(); stop(s); }
	});

	/* ─────────── the spec's extra cases ─────────── */
	const ROOT_SITE = "https://moodle.example.fr";
	const link = (passport, token = "a".repeat(32), root = ROOT_SITE) =>
		Buffer.from(`${crypto.createHash("md5").update(root + passport).digest("hex")}:::${token}`).toString("base64");

	await test("verifyLaunchToken: only the answer to OUR passport and site is accepted", () => {
		const token = "a".repeat(32);
		assert.equal(pur.verifyLaunchToken(link("p123"), "p123", ROOT_SITE), token);
		const withPrivate = Buffer.from(`${crypto.createHash("md5").update(ROOT_SITE + "p123").digest("hex")}:::${token}:::prive`).toString("base64");
		assert.equal(pur.verifyLaunchToken(withPrivate, "p123", ROOT_SITE), token);
		assert.throws(() => pur.verifyLaunchToken(link("p123"), "autre", ROOT_SITE), { code: "badlaunch" });
		assert.throws(() => pur.verifyLaunchToken(link("p123"), "p123", "https://autre.example.fr"), { code: "badlaunch" });
		assert.throws(() => pur.verifyLaunchToken("bm9uc2Vucw==", "p123", ROOT_SITE), { code: "badlaunch" });
		assert.throws(() => pur.verifyLaunchToken(link("p123", "pas-un-jeton"), "p123", ROOT_SITE), { code: "badlaunch" });
		assert.equal(pur.launchUrl(ROOT_SITE, "p1", "neo-quiz"), `${ROOT_SITE}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=p1&urlscheme=neo-quiz`);
		assert.equal(pur.jetonDansArguments(["x", "neo-quiz://token=QUJD"]), "QUJD");
		assert.equal(pur.jetonDansArguments(["neo-quiz://pair?device=X"]), null);
		// the automatic-run rule (metered connection)
		assert.deepEqual([pur.decisionAuto(true, false), pur.decisionAuto(true, true), pur.decisionAuto(false, false), pur.decisionAuto(false, true)], ["run", "metered", "off", "off"]);
	});
	await test("DISCRIMINANCE: with the passport comparison cut out, a wrong passport IS accepted", async () => {
		const { mod, dir } = await mutant(`${MOODLE}pur.ts`, "parts[0] !== expected", "false");
		try {
			assert.equal(mod.verifyLaunchToken(link("p123"), "autre", ROOT_SITE), "a".repeat(32));
		} finally { fs.rmSync(dir, { recursive: true, force: true }); }
	});

	await test("a file URL on another host is skipped, a redirect off-host is never followed", async () => {
		const B = await server((req, res) => { B.hits++; res.setHeader("Content-Type", "application/pdf"); res.end("12345"); });
		B.hits = 0;
		const A = await server((req, res) => {
			if (req.url.startsWith("/redir")) { res.statusCode = 302; res.setHeader("Location", `${B.root}/x.pdf?token=tok`); res.end(); return; }
			res.end("12345");
		});
		const dir = tmpdir();
		const c = mk(A.root);
		const file = (name, url) => ({ name, url, size: 5, timemodified: 1, status: "missing" });
		try {
			assert.equal(c.memeSite(`${B.root}/x.pdf`), false);
			assert.equal(c.memeSite(`${A.root}/x.pdf`), true);
			assert.equal(c.memeSite(`http://user:pw@${A.root.slice(7)}/x.pdf`), false);
			const r = await disque.downloadFiles(c, [
				{ file: file("autre.pdf", `${B.root}/x.pdf`), dir },
				{ file: file("redir.pdf", `${A.root}/redir.pdf`), dir },
			], ALL);
			assert.deepEqual(r.map(x => [x.ok, !!x.skipped]), [[false, true], [false, false]]);
			assert.equal(r[1].error.includes("not on the Moodle site"), true);
			assert.equal(B.hits, 0, "the other host must never be contacted");
			assert.deepEqual(fs.readdirSync(dir), []);
			// the API client talks to its own origin only too
			await assert.rejects(c.fetchToFile(`${B.root}/x.pdf`, path.join(dir, "t.tmp"), 5), { code: "offhost" });
		} finally { c.close(); stop(A.s); stop(B.s); }
	});
	await test("DISCRIMINANCE: with the host check cut out of each hop, the off-host redirect IS followed", async () => {
		const { mod, dir: md } = await mutant(`${MOODLE}client.ts`, "if (!memeSite(url)) { reject(refuseHote()); return; }", "");
		const B = await server((req, res) => { B.hits++; res.setHeader("Content-Type", "application/pdf"); res.end("12345"); });
		B.hits = 0;
		const A = await server((req, res) => { res.statusCode = 302; res.setHeader("Location", `${B.root}/x.pdf?token=tok`); res.end(); });
		const dir = tmpdir();
		const c = mod.createClient("tok", A.root, T);
		try {
			await c.fetchToFile(`${A.root}/redir.pdf`, path.join(dir, "t.tmp"), 5).catch(() => {});
			assert.ok(B.hits > 0, "the mutant must reach the other host (else this case proves nothing)");
		} finally { c.close(); stop(A.s); stop(B.s); fs.rmSync(md, { recursive: true, force: true }); }
	});
	await test("paths cannot escape: `..`, separators, reserved names, a folder outside the perimeter", async () => {
		const { s, root } = await server((req, res) => { res.setHeader("Content-Type", "application/pdf"); res.end("12345"); });
		const base = tmpdir();
		const dir = path.join(base, "module");
		fs.mkdirSync(dir);
		const c = mk(root);
		const file = name => ({ name, url: `${root}/a.pdf`, size: 5, timemodified: 1, status: "missing" });
		try {
			const bad = ["../evil.pdf", "..\\evil.pdf", "sub/evil.pdf", "..", "."];
			const r = await disque.downloadFiles(c, bad.map(n => ({ file: file(n), dir })), ALL);
			assert.deepEqual(r.map(x => x.ok), bad.map(() => false));
			assert.equal(r.every(x => /leaves its folder/.test(x.error)), true, JSON.stringify(r.map(x => x.error)));
			assert.deepEqual(fs.readdirSync(base), ["module"]);
			assert.deepEqual(fs.readdirSync(dir), []);
			// a hostile name from the API is flattened to ONE segment before it gets that far
			const flat = pur.flattenContents([{ name: "s", modules: [{ id: 1, name: "m", modname: "resource", contents: [
				{ type: "file", filename: "../../x.pdf", fileurl: "https://m/1" }, { type: "file", filename: "..", fileurl: "https://m/2" }] }] }]);
			assert.deepEqual(pur.allFiles({ sections: flat }).map(f => f.name).sort(), ["-..-x.pdf", "_"].sort());
			// outside the perimeter: refused, nothing written
			const garde1 = { contient: async p => path.resolve(p).startsWith(path.resolve(base, "module")) };
			const outside = path.join(base, "dehors");
			const r2 = await disque.downloadFiles(c, [{ file: file("ok.pdf"), dir }, { file: file("ok.pdf"), dir: outside }], garde1);
			assert.deepEqual(r2.map(x => x.ok), [true, false]);
			assert.match(r2[1].error, /outside the folders/);
			assert.equal(fs.existsSync(outside), false);
		} finally { c.close(); stop(s); }
	});
	await test("never deletes: a newer local copy is kept, nothing missing upstream is removed", async () => {
		const dir = tmpdir();
		fs.writeFileSync(path.join(dir, "gardé.pdf"), "annoté");
		fs.writeFileSync(path.join(dir, "retiré-de-moodle.pdf"), "x");
		const job = { file: { name: "gardé.pdf", timemodified: 1, size: 5, url: "http://x/y" }, dir };
		assert.equal(disque.dejaPresent(job), true);
		assert.equal(disque.dejaPresent({ ...job, file: { ...job.file, timemodified: 4102444800 } }), false);
		assert.deepEqual(fs.readdirSync(dir).sort(), ["gardé.pdf", "retiré-de-moodle.pdf"]);
		const src = await readFile(`${MOODLE}disque.ts`, "utf8") + await readFile(`${MOODLE}service.ts`, "utf8");
		assert.equal(/\b(unlink|rmSync|rm\(|rmdir|trash)\b/.test(src.replace(/fs\.rmSync\(tmp, \{ force: true \}\)/g, "")), false, "the only removal allowed is the temp file");
	});

	/* ─────────── the guard of the `moodle` setting ─────────── */
	await test("origineSite and validerReglagesMoodle: https origin only, a NEW host is confirmed", () => {
		for (const ok of ["https://moodle.myefrei.fr", "https://moodle.myefrei.fr/"]) assert.equal(garde.origineSite(ok), "https://moodle.myefrei.fr");
		for (const bad of ["http://moodle.myefrei.fr", "https://moodle.myefrei.fr/path", "https://moodle.myefrei.fr:8443", "https://u:p@moodle.myefrei.fr",
			"https://moodle.myefrei.fr/?a=1", "https://moodle.myefrei.fr/#x", "https://127.0.0.1", "https://localhost", "https://moodle", "file:///C:/x",
			"javascript:alert(1)", " https://moodle.myefrei.fr", "https://nas.local", "https://192.168.1.2", "", 5, null]) {
			assert.equal(garde.origineSite(bad), null, String(bad));
		}
		const v = (val, cur = null) => garde.validerReglagesMoodle(val, cur);
		assert.deepEqual(v({ site: "https://moodle.myefrei.fr" }), { ok: true, admettre: "moodle.myefrei.fr" }, "the built-in site needs no dialog");
		assert.deepEqual(v({ site: "https://moodle.autre.example.fr" }), { confirmer: "moodle.autre.example.fr" });
		assert.deepEqual(v({ site: "https://moodle.myefrei.fr", courses: [1] }, "https://moodle.myefrei.fr"), { ok: true, admettre: "moodle.myefrei.fr" });
		assert.deepEqual(v({ site: "https://autre.example.fr" }, "https://moodle.myefrei.fr"), { confirmer: "autre.example.fr" });
		assert.deepEqual(v({ courses: [1, 2] }), { ok: true, admettre: null });
		assert.deepEqual(v({ site: "" }), { ok: true, admettre: null });
		for (const bad of [null, "x", [], { site: "http://x.example.fr" }, { courses: [0] }, { courses: [1.5] }, { courses: "1" }, { courses: [1, "2"] },
			{ site: "https://moodle.myefrei.fr", token: "x" }, { courses: Array.from({ length: 501 }, (_, i) => i + 1) }]) {
			assert.ok("refus" in v(bad), JSON.stringify(bad));
		}
	});


	/* ─────────── fix round 1 ─────────── */
	await test("untrusted server values: a bad filesize is unknown, a date is clamped to tomorrow", () => {
		const now = Math.floor(Date.now() / 1000);
		const f = (extra) => pur.flattenContents([{ name: "s", modules: [{ id: 1, name: "m", modname: "resource", contents: [
			{ type: "file", filename: "a.pdf", fileurl: "https://m/1", ...extra }] }] }])[0].activities[0].files[0];
		for (const bad of ["x", -5, 1.5, NaN, null, 2 ** 60, {}]) assert.equal(f({ filesize: bad }).size, null, String(bad));
		assert.equal(f({ filesize: 123 }).size, 123);
		assert.equal(f({ timemodified: 4e12 }).timemodified <= now + 86400, true);
		for (const bad of ["x", -1, NaN, Infinity, null]) assert.equal(f({ timemodified: bad }).timemodified, 0, String(bad));
		assert.equal(f({ timemodified: 1700000000 }).timemodified, 1700000000);
	});
	await test("size cap: a stream beyond the announced size or the hard cap is cut; DISCRIMINANCE: without the cap it completes", async () => {
		const { s, root } = await server((req, res) => { res.setHeader("Content-Type", "application/pdf"); res.end("x".repeat(5000)); });
		const dir = tmpdir();
		const c = mk(root, { maxFileBytes: 1000 });
		const mine = (name, size) => ({ file: { name, url: `${root}/a.pdf`, size, timemodified: 1, status: "missing" }, dir });
		try {
			const [a, b] = await disque.downloadFiles(c, [mine("inconnue.pdf", null), mine("mentie.pdf", 5000)], ALL);
			assert.deepEqual([a.ok, b.ok], [false, false], "unknown size and a size above the cap are both cut");
			assert.deepEqual(fs.readdirSync(dir), []);
			const { mod, dir: md } = await mutant(`${MOODLE}client.ts`, "Math.min(expected ?? maxFile, maxFile)", "(expected ?? Infinity)");
			const c2 = mod.createClient("tok", root, { ...T, maxFileBytes: 1000 });
			try {
				const [m2] = await disque.downloadFiles(c2, [mine("mentie.pdf", 5000)], ALL);
				assert.equal(m2.ok, true, "the mutant must download it (else this case proves nothing)");
			} finally { c2.close(); fs.rmSync(md, { recursive: true, force: true }); }
		} finally { c.close(); stop(s); }
	});
	await test("a NEW file never replaces an existing one; DISCRIMINANCE: without the rule a future date overwrites", async () => {
		const dir = tmpdir();
		fs.writeFileSync(path.join(dir, "Note.md"), "ma note");
		fs.utimesSync(path.join(dir, "Note.md"), 1000, 1000);
		const job = { file: { name: "a.pdf", timemodified: 4000000000, status: "missing" }, target: "Note.md", dir };
		assert.equal(disque.dejaPresent(job), true);
		assert.equal(disque.dejaPresent({ ...job, file: { ...job.file, status: "outdated" }, target: "Note.md" }), false, "an outdated file is replaced, as the spec says");
		assert.equal(disque.dejaPresent({ ...job, target: "Autre.md" }), false);
		const { mod, dir: md } = await mutant(`${MOODLE}disque.ts`, 'job.file.status === "missing" && fs.existsSync', 'false && fs.existsSync');
		try { assert.equal(mod.dejaPresent(job), false, "the mutant overwrites"); } finally { fs.rmSync(md, { recursive: true, force: true }); }
	});
	await test("an executable file type is refused, whatever the server names it", async () => {
		const { s, root } = await server((req, res) => { res.setHeader("Content-Type", "application/octet-stream"); res.end("12345"); });
		const dir = tmpdir();
		const c = mk(root);
		try {
			const names = ["run.bat", "x.lnk", "y.HTA", "z.js", "w.ps1"];
			const r = await disque.downloadFiles(c, names.map(n => ({ file: { name: n, url: `${root}/a`, size: 5, timemodified: 1, status: "missing" }, dir })), ALL);
			assert.deepEqual(r.map(x => x.ok), names.map(() => false));
			assert.equal(r.every(x => /executable/.test(x.error)), true);
			assert.deepEqual(fs.readdirSync(dir), []);
		} finally { c.close(); stop(s); }
	});
	await test("an overall deadline ends a download and an API call that drip bytes forever", async () => {
		const drip = (res) => { res.setHeader("Content-Type", "application/pdf"); res.write("1"); const t = setInterval(() => res.write("1"), 20); res.on("close", () => clearInterval(t)); };
		const { s, root } = await server((req, res) => drip(res));
		const dir = tmpdir();
		const c = mk(root, { idleTimeout: 5000, apiTimeout: 5000, fileDeadline: 300, apiDeadline: 300 });
		try {
			const t0 = Date.now();
			const [r] = await disque.downloadFiles(c, [{ file: { name: "d.pdf", url: `${root}/d.pdf`, size: null, timemodified: 1, status: "missing" }, dir }], ALL);
			assert.equal(r.ok, false);
			assert.match(r.error, /too long/);
			await assert.rejects(c.call("f"), e => e.code === "timeout" && /too long/.test(e.message));
			assert.ok(Date.now() - t0 < 3000);
			assert.deepEqual(fs.readdirSync(dir), []);
		} finally { c.close(); stop(s); }
	});
	await test("the temp file is created exclusively: a directory or link in its place is refused, a stale regular temp is replaced", async () => {
		const { s, root } = await server((req, res) => { res.setHeader("Content-Type", "application/pdf"); res.end("12345"); });
		const dir = tmpdir();
		const c = mk(root);
		const job = n => ({ file: { name: n, url: `${root}/a.pdf`, size: 5, timemodified: 1, status: "missing" }, dir });
		try {
			fs.mkdirSync(path.join(dir, ".dir.pdf.moodle.tmp"));
			fs.writeFileSync(path.join(dir, ".stale.pdf.moodle.tmp"), "old");
			const outside = path.join(tmpdir(), "victim.txt");
			fs.writeFileSync(outside, "intact");
			let linked = true;
			try { fs.symlinkSync(outside, path.join(dir, ".link.pdf.moodle.tmp")); } catch { linked = false; }
			const names = ["dir.pdf", "stale.pdf"].concat(linked ? ["link.pdf"] : []);
			const r = await disque.downloadFiles(c, names.map(job), ALL);
			assert.deepEqual(r.map(x => x.ok), [false, true].concat(linked ? [false] : []));
			assert.equal(fs.readFileSync(outside, "utf8"), "intact", "nothing was written through the link");
			assert.equal(fs.readFileSync(path.join(dir, "stale.pdf"), "utf8"), "12345");
			// the stream itself refuses an existing file (wx), even if the pre-check were skipped
			fs.writeFileSync(path.join(dir, "taken.tmp"), "x");
			await assert.rejects(c.fetchToFile(`${root}/a.pdf`, path.join(dir, "taken.tmp"), 5), e => e.code === "EEXIST");
		} finally { c.close(); stop(s); }
	});
	/* ─────────── token storage ─────────── */
	const fakeCrypt = (available = true) => ({
		disponible: () => available,
		chiffrer: clair => Buffer.from(Buffer.from(clair, "utf8").map(b => b ^ 0x5a)),
		dechiffrer: buf => Buffer.from(Buffer.from(buf).map(b => b ^ 0x5a)).toString("utf8"),
	});
	await test("token store: encrypted on disk, round-trips, refused (never plain) when encryption is unavailable", async () => {
		const dir = tmpdir();
		const file = path.join(dir, "moodle-token.bin");
		const TOKEN = "b".repeat(32);
		const j = { token: TOKEN, userid: 7, fullname: "Ahmed", at: 1, site: ROOT_SITE };
		const store = jetonMod.creerMagasinJeton(file, fakeCrypt());
		assert.equal(await store.lire(), null);
		await store.ecrire(j);
		assert.equal(fs.readFileSync(file).includes(TOKEN), false, "the token must not be readable on disk");
		assert.deepEqual(await store.lire(), j);
		const off = jetonMod.creerMagasinJeton(path.join(dir, "autre.bin"), fakeCrypt(false));
		await assert.rejects(off.ecrire(j), { code: "nostorage" });
		assert.equal(fs.existsSync(path.join(dir, "autre.bin")), false);
		assert.equal(await jetonMod.creerMagasinJeton(file, fakeCrypt(false)).lire(), null);
		fs.writeFileSync(file, "garbage");
		assert.equal(await store.lire(), null);
		await store.effacer();
		assert.equal(fs.existsSync(file), false);
	});

	/* ─────────── the service, end to end against a fake Moodle ─────────── */
	const TOKEN = "c".repeat(32);
	async function fakeMoodle(opts = {}) {
		const other = await server((req, res) => { other.hits++; res.end("12345"); });
		other.hits = 0;
		const m = await server(async (req, res) => {
			const u = new URL(req.url, "http://x");
			if (req.method === "GET" && u.pathname === "/pluginfile/a.pdf") {
				if (u.searchParams.get("token") !== TOKEN) { res.statusCode = 403; res.end(); return; }
				res.setHeader("Content-Type", "application/pdf"); res.end("12345"); return;
			}
			const p = new URLSearchParams(await readBody(req));
			if (opts.expired || p.get("wstoken") !== TOKEN) {
				res.end(JSON.stringify({ exception: "moodle_exception", errorcode: "invalidtoken", message: `Invalid token ${p.get("wstoken")}` }));
				return;
			}
			const fn = p.get("wsfunction");
			if (opts.fail && fn === "core_enrol_get_users_courses") {
				res.end(JSON.stringify({ exception: "x", errorcode: "boom", message: opts.long ? "y".repeat(500) : `failure for ${TOKEN} here` })); return;
			}
			const due = Math.floor(Date.now() / 1000) + 3 * 3600;
			const nowSec = Math.floor(Date.now() / 1000);
			if (opts.badCourse && fn === "core_course_get_contents" && p.get("courseid") === String(opts.badCourse)) {
				res.end(JSON.stringify({ exception: "moodle_exception", errorcode: "nopermissions", message: "No access" })); return;
			}
			m.calls.push(fn);
			const known = [
				{ id: 5, shortname: "XTI500-CYB-2627PSA01", fullname: "XTI500 extra", enddate: 0 },
				{ id: 6, shortname: "LXP-4GOOD-2627PSA01", fullname: "Sans code", enddate: 0 },
			];
			const idsAsked = (p.get("value") || "").split(",").map(Number);
			const course5Files = { id: 50, name: "Docs", modname: "resource", uservisible: true, contents: [
				{ type: "file", filename: "Notes.pdf", filesize: 5, fileurl: `${m.root}/pluginfile/a.pdf`, timemodified: 1700000000 },
				{ type: "file", filename: "tool.bat", filesize: 5, fileurl: `${m.root}/pluginfile/a.pdf`, timemodified: 1700000000 },
			] };
			res.end(JSON.stringify({
				core_webservice_get_site_info: { userid: 42, fullname: "Ahmed Test" },
				core_enrol_get_users_courses: [
					{ id: 1, shortname: "XTI302-CYB-2627PSA01", fullname: "* XTI302-CYB-2627PSA01 - Admin système (X-BAC)" },
					{ id: 2, shortname: "LXP-4GOOD-2627PSA01", fullname: "LXP" },
					{ id: 3, shortname: "XTI999-CYB-2627PSA01", fullname: "XTI999 vieux", enddate: nowSec - 40 * 86400 },
					{ id: 4, shortname: "XCS-413-2627PSA01", fullname: "XCS413 récent", enddate: nowSec - 20 * 86400 },
				],
				core_course_search_courses: { total: 2, courses: known },
				core_course_get_courses_by_field: { courses: known.filter(c => idsAsked.includes(c.id)) },
				core_course_get_contents: p.get("courseid") === "5" ? [{ name: "S1", modules: [course5Files] }] : p.get("courseid") !== "1" ? [] : [{ name: "S1", modules: [
					{ id: 10, name: "Cours", modname: "resource", uservisible: true, contents: [
						{ type: "file", filename: "XTI302-CYB-Seance2_TP_Socle_Etudiant.pdf", filesize: 5, fileurl: `${m.root}/pluginfile/a.pdf`, timemodified: 1700000000 },
						{ type: "file", filename: "Dehors.pdf", filesize: 5, fileurl: `${other.root}/x.pdf`, timemodified: 1 },
					] },
					{ id: 23, name: "Rendu TP1", modname: "assign", uservisible: true },
				] }],
				mod_assign_get_assignments: { courses: [{ id: 1, assignments: p.get("courseids[0]") === "1" ? [{ id: 900, cmid: 23, duedate: due, cutoffdate: 0 }] : [] }] },
				mod_assign_get_submission_status: { lastattempt: { submission: { status: "new" } } },
			}[fn] ?? null));
		});
		m.calls = [];
		return { m, other };
	}
	function newService({ root, base, store = {}, crypt = fakeCrypt(), now = Date.now, garde = ALL, planifier, autoParDefaut = false, impl = service, limites = false, budget, limitee }) {
		const opened = [], pushes = [], chemins = [];
		// The tests that exercise the automatic download say `auto: true`; every other case runs with it off.
		if (!autoParDefaut && store.moodle && store.moodle.auto === undefined) store.moodle.auto = false;
		const reglages = {
			lire: async k => store[k], ecrire: async (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); }, supprimer: async k => { delete store[k]; },
		};
		const svc = impl.creerMoodle({
			racine: () => base, garde, planifier, ouvrirChemin: async p => { chemins.push(p); return true; }, reglages: () => reglages, dossierDonnees: path.join(base, "..data-" + crypto.randomBytes(3).toString("hex")),
			chiffrement: crypt, ouvrirExterne: async u => { opened.push(u); }, envoyer: e => pushes.push(e), maintenant: () => now(), essai: T, essaiSansLimite: !limites, budget, limitee,
		});
		return { svc, opened, pushes, store, chemins };
	}
	const everything = []; // every value handed to the window, across the service cases

	await test("service: login routing (nothing pending, wrong passport, expiry, the right link), then connected", async () => {
		const { m, other } = await fakeMoodle();
		const base = tmpdir();
		let clock = Date.now();
		const { svc, opened, pushes, store } = newService({ root: m.root, base, store: { moodle: { site: m.root, courses: [] } }, now: () => clock });
		try {
			assert.equal(await svc.recevoirJeton(link("x", TOKEN, m.root)), false, "no login pending: not routed");
			await svc.connecter();
			const url = new URL(opened[0]);
			assert.equal(url.origin + url.pathname, `${m.root}/admin/tool/mobile/launch.php`);
			assert.equal(url.searchParams.get("urlscheme"), "neo-quiz");
			const passport = url.searchParams.get("passport");
			assert.match(passport, /^[0-9a-f]{32}$/);
			assert.equal((await svc.etat()).loginPending, true);
			// a forged answer (wrong passport): consumed as ours, but refused, nothing stored
			assert.equal(await svc.recevoirJeton(link("not-the-passport", TOKEN, m.root)), true);
			assert.equal((await svc.etat()).connected, false);
			// the right answer, once
			assert.equal(await svc.recevoirJeton(link(passport, TOKEN, m.root)), true);
			let e = await svc.etat();
			assert.deepEqual([e.state, e.connected, e.fullname, e.loginPending], ["connected", true, "Ahmed Test", false]);
			assert.equal(await svc.recevoirJeton(link(passport, TOKEN, m.root)), false, "one passport, one use");
			// 10 minutes: a pending login expires
			await svc.connecter();
			const p2 = new URL(opened[1]).searchParams.get("passport");
			clock += 11 * 60 * 1000;
			assert.equal(await svc.recevoirJeton(link(p2, TOKEN, m.root)), false);
			assert.ok(pushes.length > 0);
			everything.push(e, pushes, store);
		} finally { stop(m.s); stop(other.s); }
	});
	await test("service: no secure storage -> the login is refused with an error state, nothing stored", async () => {
		const { m, other } = await fakeMoodle();
		const base = tmpdir();
		const { svc, opened } = newService({ root: m.root, base, store: { moodle: { site: m.root, courses: [] } }, crypt: fakeCrypt(false) });
		try {
			await assert.rejects(svc.connecter(), { code: "nostorage" });
			assert.equal(opened.length, 0, "the browser is not even opened");
			const e = await svc.etat();
			assert.deepEqual([e.state, e.connected, e.error], ["error", false, "secure-storage-unavailable"]);
		} finally { stop(m.s); stop(other.s); }
	});
	await test("service: sync downloads under the default root (folder by code, pretty name), skips the off-host file, lists assignments", async () => {
		const { m, other } = await fakeMoodle();
		const base = tmpdir();
		fs.mkdirSync(path.join(base, "XTI302 - Admin existant"));
		let clock = Date.now();
		const { svc, opened, pushes, store } = newService({ root: m.root, base, store: { moodle: { site: m.root, courses: [] } }, now: () => clock });
		try {
			assert.deepEqual(await svc.cours(), [], "not connected: no courses");
			assert.equal((await svc.synchroniser()).erreur, "not-connected");
			clock += 11000;
			await svc.connecter();
			await svc.recevoirJeton(link(new URL(opened[0]).searchParams.get("passport"), TOKEN, m.root));
			const cours = await svc.cours();
			assert.deepEqual(cours.map(c => [c.id, c.code, c.folderExists, c.favori, c.exclu, c.enCours, c.extra]),
				[[4, "XCS413", false, false, false, true, false], [1, "XTI302", true, false, false, true, false]]);
			assert.equal(cours[1].folder, "XTI302 - Admin existant");
			assert.equal(store.moodle.site, m.root);
			const r = await svc.synchroniser();
			assert.deepEqual([r.nouveaux, r.mis_a_jour, r.echecs, r.ignores, r.erreur], [1, 0, 0, 1, null]);
			const dest = path.join(base, "XTI302 - Admin existant");
			assert.deepEqual(fs.readdirSync(dest), ["Séance 2 - TP Socle.pdf"]);
			assert.equal(fs.readFileSync(path.join(dest, "Séance 2 - TP Socle.pdf"), "utf8"), "12345");
			assert.equal(other.hits, 0, "the off-host file was never requested");
			// second run: the file is present (same size found), nothing new
			assert.equal(await svc.synchroniser(), await svc.synchroniser(), "a finished sync is not re-triggered within 10 s");
			clock += 11000;
			const r2 = await svc.synchroniser();
			assert.deepEqual([r2.nouveaux, r2.mis_a_jour, r2.echecs], [0, 0, 0]);
			assert.equal(fs.readdirSync(dest).length, 1);
			const devoirs = await svc.devoirs();
			assert.deepEqual(devoirs.map(d => [d.cmid, d.name, d.state]), [[23, "Rendu TP1", "urgent"]]);
			assert.equal(await svc.ouvrirDevoir(23), true);
			assert.equal(opened.at(-1), `${m.root}/mod/assign/view.php?id=23`);
			assert.equal(await svc.ouvrirDevoir(23), false, "opened again within 2 s: refused");
			clock += 3000;
			for (const bad of ["23", -1, 1.5, NaN, null, {}]) assert.equal(await svc.ouvrirDevoir(bad), false);
			const e = await svc.etat();
			assert.equal(typeof e.lastSync, "number");
			everything.push(cours, r, r2, devoirs, e, pushes);
		} finally { stop(m.s); stop(other.s); }
	});
	await test("service: a new course folder is created under the default root when none starts with the code", async () => {
		const { m, other } = await fakeMoodle();
		const base = tmpdir();
		const { svc, opened } = newService({ root: m.root, base, store: { moodle: { site: m.root, courses: [1] } } });
		try {
			await svc.connecter();
			await svc.recevoirJeton(link(new URL(opened[0]).searchParams.get("passport"), TOKEN, m.root));
			const r = await svc.synchroniser();
			assert.equal(r.nouveaux, 1);
			assert.deepEqual(fs.readdirSync(base).filter(n => !n.startsWith("..data")), ["XTI302 - Admin système"]);
		} finally { stop(m.s); stop(other.s); }
	});
	await test("service: an expired token -> state expired (no silent re-login), then a new login works", async () => {
		const opts = {};
		const { m, other } = await fakeMoodle(opts);
		const base = tmpdir();
		const { svc, opened } = newService({ root: m.root, base, store: { moodle: { site: m.root, courses: [1] } } });
		try {
			await svc.connecter();
			await svc.recevoirJeton(link(new URL(opened[0]).searchParams.get("passport"), TOKEN, m.root));
			opts.expired = true;
			assert.equal((await svc.synchroniser()).erreur, "expired");
			const e = await svc.etat();
			assert.deepEqual([e.state, e.connected], ["expired", false]);
			assert.deepEqual(await svc.cours(), [], "no call is made with a dead token");
			assert.equal(opened.length, 1, "no silent re-login: the browser is not reopened");
			opts.expired = false;
			await svc.connecter();
			await svc.recevoirJeton(link(new URL(opened[1]).searchParams.get("passport"), TOKEN, m.root));
			assert.equal((await svc.etat()).state, "connected");
			// a token of another site is never used
			const other2 = newService({ root: m.root, base, store: { moodle: { site: "http://127.0.0.1:1", courses: [1] } } });
			assert.equal((await other2.svc.etat()).state, "off");
		} finally { stop(m.s); stop(other.s); }
	});
	await test("service: errors and everything handed to the window never contain the token or a tokenised URL", async () => {
		const { m, other } = await fakeMoodle({ fail: true });
		const base = tmpdir();
		const { svc, opened, pushes } = newService({ root: m.root, base, store: { moodle: { site: m.root, courses: [1] } } });
		try {
			await svc.connecter();
			await svc.recevoirJeton(link(new URL(opened[0]).searchParams.get("passport"), TOKEN, m.root));
			const err = await svc.cours().then(() => null, e => e.message);
			assert.ok(err && err.includes("failure"), "the failure is reported: " + err);
			assert.equal(err.includes(TOKEN), false, "the token is masked in the error text");
			const r = await svc.synchroniser();
			everything.push(err, r, await svc.etat(), pushes);
			const all = JSON.stringify(everything);
			assert.equal(all.includes(TOKEN), false, "the token reached a value for the window");
			assert.equal(/token=|wstoken|privatetoken/i.test(all), false, "a tokenised URL reached a value for the window");
			assert.ok(all.length > 200);
		} finally { stop(m.s); stop(other.s); }
	});
	await test("DISCRIMINANCE: without the automatic-run rule (`auto` off, metered connection) the sign-in downloads anyway; without the origin check another host's course URL is accepted", async () => {
		const mu = await mutant(`${MOODLE}service.ts`, 'if (regle !== "run") return;', "");
		const { m, other } = await fakeMoodle();
		const base = tmpdir();
		const t = newService({ root: m.root, base, store: { moodle: { site: m.root, auto: false } }, impl: mu.mod });
		try {
			await t.svc.connecter();
			await t.svc.recevoirJeton(link(new URL(t.opened[0]).searchParams.get("passport"), TOKEN, m.root));
			for (let i = 0; i < 100 && !m.calls.some(f => /contents/.test(f)); i++) await new Promise(r => setTimeout(r, 20));
			assert.ok(m.calls.some(f => /contents/.test(f)), "the mutant must download (else the auto-off case proves nothing)");
		} finally { stop(m.s); stop(other.s); fs.rmSync(mu.dir, { recursive: true, force: true }); }
		const mc = await mutant(`${MOODLE}cours.ts`, "if (u.origin !== s.origin || u.username || u.password) return null;", "if (u.username || u.password) return null;");
		try { assert.equal(mc.mod.idDepuisUrl("https://evil.example/course/view.php?id=5", "https://moodle.myefrei.fr"), 5); } finally { fs.rmSync(mc.dir, { recursive: true, force: true }); }
		const me = await mutant(`${MOODLE}cours.ts`, 'rel !== "" && rel !== ".." && !rel.startsWith(".." + path.sep) &&', 'rel !== "" &&');
		try { assert.equal(me.mod.estDans("/a/b", "/a/b/../c"), true, "the mutant lets a parent step through"); assert.equal(k.estDans("/a/b", "/a/b/../c"), false); } finally { fs.rmSync(me.dir, { recursive: true, force: true }); }
	});
	await test("service: connecter is refused while a login is pending; the window cannot spam the browser or syncs", async () => {
		const { m, other } = await fakeMoodle({ long: true, fail: true });
		const base = tmpdir();
		let clock = Date.now();
		const { svc, opened } = newService({ root: m.root, base, store: { moodle: { site: m.root, courses: [1] } }, now: () => clock });
		try {
			await svc.connecter();
			await assert.rejects(svc.connecter(), { code: "pending" });
			assert.equal(opened.length, 1, "no second browser tab, the first passport is kept");
			await svc.recevoirJeton(link(new URL(opened[0]).searchParams.get("passport"), TOKEN, m.root));
			// a server error text is truncated before it reaches the window
			const err = await svc.cours().then(() => "", e => e.message);
			assert.ok(err.length > 0 && err.length <= 200, String(err.length));
		} finally { stop(m.s); stop(other.s); }
	});

	/* ─────────── courses, files, hand-in, auto download (revision of 2026-10-07) ─────────── */
	async function connecte(opts = {}, svcOpts = {}) {
		const { m, other } = await fakeMoodle(opts.moodle);
		const base = tmpdir();
		const t = newService({ root: m.root, base, ...svcOpts, store: { moodle: { site: m.root, ...(svcOpts.reglages || {}) } } });
		await t.svc.connecter();
		await t.svc.recevoirJeton(link(new URL(t.opened[0]).searchParams.get("passport"), TOKEN, m.root));
		return { m, other, base, ...t };
	}
	const fin = ({ m, other }) => { stop(m.s); stop(other.s); };

	await test("default course set: enrolled with a code and in progress (end date none or < 30 days ago) + added + favourites - excluded; favourites first", async () => {
		const c = await connecte({}, { reglages: { extra: [5], favoris: [3, 5], exclus: [4] } });
		try {
			const l = await c.svc.cours();
			assert.deepEqual(l.map(x => [x.id, x.favori, x.exclu, x.enCours, x.extra]), [
				[5, true, false, true, true],
				[3, true, false, false, false],
				[4, false, true, true, false],
				[1, false, false, true, false],
			]);
			assert.equal(l.some(x => x.id === 2), false, "a course without a code is not followed");
			// without any setting: the old one (id 3, 40 days) is out, the 20-day one is in
			const d = await connecte({});
			try { assert.deepEqual((await d.svc.cours()).map(x => x.id), [4, 1]); } finally { fin(d); }
			// the followed set (what downloads and what lists assignments) leaves the excluded out
			const dest = path.join(c.base, "XTI500 - extra");
			await c.svc.synchroniser();
			assert.ok(fs.readdirSync(c.base).some(n => n.startsWith("XTI500")), "an added course downloads");
			assert.equal(fs.readdirSync(c.base).some(n => n.startsWith("XCS413")), false, "an excluded course never does");
			assert.equal(dest.length > 0, true);
		} finally { fin(c); }
	});
	await test("cours.ts rules, pure: in progress boundary, URL parsing, hand-in folder, containment", async () => {
		{
			const NOW = 1_800_000_000_000;
			assert.equal(k.enCours({ enddate: 0 }, NOW), true);
			assert.equal(k.enCours({ enddate: NOW / 1000 - 29 * 86400 }, NOW), true);
			assert.equal(k.enCours({ enddate: NOW / 1000 - 31 * 86400 }, NOW), false);
			assert.equal(k.enCours({ enddate: NOW / 1000 + 86400 }, NOW), true);
			const S = "https://moodle.myefrei.fr";
			assert.equal(k.idDepuisUrl(`${S}/course/view.php?id=123`, S), 123);
			assert.equal(k.idDepuisUrl(`${S}/course/view.php?id=7&section=2`, S), 7);
			for (const bad of ["https://evil.example/course/view.php?id=1", "http://moodle.myefrei.fr/course/view.php?id=1", "https://moodle.myefrei.fr.evil.example/course/view.php?id=1",
				"https://u:p@moodle.myefrei.fr/course/view.php?id=1", "https://moodle.myefrei.fr:8443/course/view.php?id=1", `${S}/course/view.php`, `${S}/course/view.php?id=0`,
				`${S}/course/view.php?id=-1`, `${S}/course/view.php?id=abc`, `${S}/course/view.php?id=1e3`, `${S}/course/view.php?id=012`, `${S}/course/view.php?id=12345678901`,
				`${S}/course/other.php?id=1`, `${S}/x/course/view.php?id=1`, ` ${S}/course/view.php?id=1`, "javascript:alert(1)", "", 5, null,
				`${S}/${"a".repeat(600)}`]) {
				assert.equal(k.idDepuisUrl(bad, S), null, String(bad).slice(0, 60));
			}
			const dir = tmpdir();
			assert.equal(k.dossierDepot(path.join(dir, "absent")), null);
			assert.equal(k.dossierDepot(dir), dir, "no `Rendus` folder: the module folder");
			fs.mkdirSync(path.join(dir, "Cours"));
			fs.mkdirSync(path.join(dir, "rendus TP"));
			assert.equal(k.dossierDepot(dir), path.join(dir, "rendus TP"), "the `Rendus...` sub-folder, case ignored");
			fs.writeFileSync(path.join(dir, "Rendus.txt"), "a file is not a folder");
			assert.equal(k.dossierDepot(dir), path.join(dir, "rendus TP"));
			const R = path.join(dir, "root");
			assert.equal(k.estDans(R, path.join(R, "a", "b.pdf")), true);
			assert.equal(k.estDans(R, R), false, "the folder itself is not inside itself");
			assert.equal(k.estDans(R, path.join(R, "..", "x")), false);
			assert.equal(k.estDans(R, path.join(R, "..x", "y")), true, "a name starting with two dots is not a parent step");
			assert.equal(k.estDans(R, path.join(R, "a", "..", "..", "x")), false);
			assert.equal(k.estDans(R, path.resolve(R + "-evil", "x")), false, "a sibling sharing the prefix is outside");
		}
	});
	await test("settings: non-integers, oversize lists, a non-boolean auto and unknown fields are refused; the school's site needs no dialog", () => {
		const v = o => garde.validerReglagesMoodle(o, null);
		assert.deepEqual(v({ auto: false, favoris: [1], exclus: [2], extra: [3], devoirsIgnores: [4], devoirsVus: [5] }), { ok: true, admettre: null });
		for (const k of ["favoris", "exclus", "extra", "devoirsIgnores", "devoirsVus", "courses"]) {
			for (const bad of [[1.5], ["1"], [0], [-3], [NaN], [Infinity], [2 ** 60], "1", { 0: 1 }, null, [1, null], Array.from({ length: 501 }, (_, i) => i + 1)]) {
				assert.ok("refus" in v({ [k]: bad }), k + " " + JSON.stringify(bad)?.slice(0, 40));
			}
			assert.ok(!("refus" in v({ [k]: Array.from({ length: 500 }, (_, i) => i + 1) })), k + " 500 is allowed");
		}
		for (const bad of ["true", 1, null, [], {}]) assert.ok("refus" in v({ auto: bad }), String(bad));
		assert.ok("refus" in v({ favoris: [1], other: 1 }));
		assert.deepEqual(v({ site: "https://moodle.myefrei.fr", favoris: [1] }), { ok: true, admettre: "moodle.myefrei.fr" });
		assert.deepEqual(garde.SITE_DEFAUT, "https://moodle.myefrei.fr");
	});
	await test("service: favourites, exclusion, added courses persist in the setting; bad ids and a full list are refused", async () => {
		const c = await connecte();
		try {
			assert.deepEqual(await c.svc.favori(1, true), [1]);
			assert.deepEqual(await c.svc.favori(1, true), [1], "no duplicate");
			assert.deepEqual(await c.svc.exclure(4, true), [4]);
			assert.deepEqual(await c.svc.exclure(4, false), []);
			assert.deepEqual(await c.svc.ajouter(5), [5]);
			assert.deepEqual(await c.svc.retirer(5), []);
			assert.deepEqual(c.store.moodle.favoris, [1]);
			assert.equal(c.store.moodle.site, c.m.root, "the other keys are kept");
			assert.equal(c.store.moodle.auto, false);
			for (const bad of ["1", 0, -1, 1.5, NaN, null, {}, 2 ** 60]) {
				await assert.rejects(c.svc.favori(bad, true), { code: "badid" });
				await assert.rejects(c.svc.ajouter(bad), { code: "badid" });
			}
			await assert.rejects(c.svc.favori(1, "yes"), { code: "badarg" });
			await assert.rejects(c.svc.ajouter(6), { code: "nocode" }, "a course without a code cannot be added");
			await assert.rejects(c.svc.ajouter(77), { code: "nocourse" });
			c.store.moodle.exclus = Array.from({ length: 500 }, (_, i) => i + 1000);
			await assert.rejects(c.svc.exclure(1, true), { code: "toomany" });
			assert.equal(c.store.moodle.exclus.length, 500);
			// two quick changes never lose one
			await Promise.all([c.svc.favori(10, true), c.svc.favori(11, true), c.svc.favori(12, true)]);
			assert.deepEqual([...c.store.moodle.favoris].sort((a, b) => a - b), [1, 10, 11, 12]);
		} finally { fin(c); }
	});
	await test("service: search (<= 100 chars, courses with a code) and add by URL (the configured site only)", async () => {
		const c = await connecte();
		try {
			const r = await c.svc.chercher("  cyber ");
			assert.deepEqual(r, [{ id: 5, name: "XTI500 extra", code: "XTI500", dansListe: false }]);
			assert.deepEqual(await c.svc.chercher("   "), []);
			await assert.rejects(c.svc.chercher("x".repeat(101)), { code: "badarg" });
			await assert.rejects(c.svc.chercher(5), { code: "badarg" });
			const calls = c.m.calls.length;
			for (const bad of [`https://evil.example/course/view.php?id=5`, `${c.m.root}/course/view.php?id=0`, `${c.m.root}/course/view.php?id=abc`, `${c.m.root}/other?id=5`, 5, null, ""]) {
				await assert.rejects(c.svc.ajouterParUrl(bad), { code: "badurl" }, String(bad));
			}
			assert.equal(c.m.calls.length, calls, "a refused address never reaches Moodle");
			const added = await c.svc.ajouterParUrl(`${c.m.root}/course/view.php?id=5`);
			assert.deepEqual([added.id, added.code, added.extra, added.exclu], [5, "XTI500", true, false]);
			assert.deepEqual(c.store.moodle.extra, [5]);
			assert.equal((await c.svc.chercher("cyber"))[0].dansListe, true);
			await assert.rejects(c.svc.ajouterParUrl(`${c.m.root}/course/view.php?id=77`), { code: "nocourse" });
		} finally { fin(c); }
	});
	await test("service: files with their status, download a file / a whole course, summary in the state; never a URL", async () => {
		const c = await connecte({}, { reglages: { extra: [5] } });
		try {
			let f = await c.svc.fichiers(5);
			assert.deepEqual(f.map(x => [x.name, x.section, x.status]), [["Notes.pdf", "S1", "missing"], ["tool.bat", "S1", "missing"]]);
			assert.ok(f.every(x => x.relPath.startsWith("XTI500 - XTI500 extra/") || x.relPath.startsWith("XTI500")), JSON.stringify(f));
			assert.equal(/https?:|token/i.test(JSON.stringify(f)), false);
			// the course as its page shows it: same files grouped by activity, same bounds, never a URL
			const mod = await c.svc.module(5);
			assert.deepEqual(mod.sections.flatMap(x => x.activites.flatMap(y => y.fichiers.map(z => z.name))), f.map(x => x.name));
			assert.equal(typeof mod.externes, "number");
			assert.equal(/https?:|token/i.test(JSON.stringify(mod)), false);
			await assert.rejects(c.svc.module(0), { code: "badid" });
			assert.deepEqual(await c.svc.module(99).catch(() => "rejected"), "rejected", "an unknown course gives nothing");
			const r = await c.svc.telechargerFichier(5, "Notes.pdf");
			assert.deepEqual([r.nouveaux, r.erreur], [1, null]);
			f = await c.svc.fichiers(5);
			assert.equal(f.find(x => x.name === "Notes.pdf").status, "present");
			assert.equal(fs.existsSync(path.join(c.base, ...f.find(x => x.name === "Notes.pdf").relPath.split("/"))), true, "relPath is where the file is");
			assert.equal(f.find(x => x.name === "tool.bat").status, "missing");
			const r2 = await c.svc.telechargerCours(5);
			assert.deepEqual([r2.nouveaux, r2.ignores], [0, 1], "the executable type is skipped, never fetched");
			assert.equal(fs.existsSync(path.join(c.base, f.find(x => x.name === "tool.bat").relPath.replace(/\//g, path.sep))), false);
			await assert.rejects(c.svc.telechargerFichier(5, ""), { code: "badarg" });
			assert.equal((await c.svc.telechargerCours(99)).erreur, "failed", "an unknown course downloads nothing");
			// a full run records its summary in the state
			await c.svc.synchroniser();
			const e = await c.svc.etat();
			assert.equal(e.auto, false);
			assert.equal(e.lastCheck, e.lastSync);
			assert.deepEqual(e.lastSummary, { nouveaux: 1, misAJour: 0, echecs: 0, parCours: { XTI302: 1 } });
			const s = JSON.stringify([e, f, r, r2]);
			assert.equal(s.includes(TOKEN) || /token=|wstoken/i.test(s), false);
		} finally { fin(c); }
	});
	await test("service: ouvrirFichier / ouvrirDossier stay inside the module folder and the perimeter, and never open an executable type", async () => {
		const deny = { contient: async p => !p.includes("DENIED") };
		const c = await connecte({}, { reglages: { extra: [5] }, garde: deny });
		try {
			await c.svc.telechargerFichier(5, "Notes.pdf");
			const dir = path.join(c.base, fs.readdirSync(c.base).find(n => n.startsWith("XTI500")));
			assert.equal(await c.svc.ouvrirFichier(5, "Notes.pdf"), true);
			assert.equal(c.chemins.at(-1), path.join(dir, "Notes.pdf"));
			assert.equal(await c.svc.ouvrirDossier(5), true);
			assert.equal(c.chemins.at(-1), dir);
			const n = c.chemins.length;
			// not downloaded: nothing to open
			assert.equal(await c.svc.ouvrirFichier(5, "tool.bat"), false);
			// an executable that IS on disk under a Moodle name: refused
			fs.writeFileSync(path.join(dir, "tool.bat"), "12345");
			fs.utimesSync(path.join(dir, "tool.bat"), 1700000000, 1700000000);
			assert.equal(await c.svc.ouvrirFichier(5, "tool.bat"), false, "an executable extension is never opened");
			// traversal in the name: not a file of the course
			for (const bad of ["../x.pdf", "..\\..\\x.pdf", "Notes.pdf/../../x", "C:\\Windows\\notepad.exe", "/etc/passwd", "Notes.PDF", 5, null, "x".repeat(300)]) {
				assert.equal(await c.svc.ouvrirFichier(5, bad), false, String(bad).slice(0, 30));
			}
			assert.equal(c.chemins.length, n, "nothing else was opened");
			// a link in place of the file: refused (when the system lets us make one)
			const out = path.join(tmpdir(), "outside.pdf");
			fs.writeFileSync(out, "12345");
			fs.rmSync(path.join(dir, "Notes.pdf"));
			let linked = true;
			try { fs.symlinkSync(out, path.join(dir, "Notes.pdf")); } catch { linked = false; }
			if (linked) {
				fs.utimesSync(out, 1700000000, 1700000000);
				assert.equal(await c.svc.ouvrirFichier(5, "Notes.pdf"), false, "a link is not followed");
			}
			await assert.rejects(c.svc.ouvrirDossier(99), { code: "unknown-course" });
			await assert.rejects(c.svc.ouvrirDossier("5"), { code: "badid" });
			assert.equal(await c.svc.ouvrirDossier(1), false, "the module folder does not exist yet: nothing opens");
		} finally { fin(c); }
		// a perimeter that refuses the folder: nothing opens
		const d = await connecte({}, { reglages: { extra: [5] }, garde: { contient: async p => !p.includes("XTI500") } });
		try {
			assert.equal(await d.svc.ouvrirDossier(5), false);
			assert.equal(d.chemins.length, 0);
		} finally { fin(d); }
	});
	await test("service: assignments are marked new until seen, can be hidden, and hand-in opens the page AND the `Rendus` folder (else the module folder)", async () => {
		const base0 = tmpdir();
		const { m, other } = await fakeMoodle();
		let clock = Date.now();
		fs.mkdirSync(path.join(base0, "XTI302 - Module", "Rendus TP"), { recursive: true });
		const t = newService({ root: m.root, base: base0, store: { moodle: { site: m.root } }, now: () => clock });
		try {
			await t.svc.connecter();
			await t.svc.recevoirJeton(link(new URL(t.opened[0]).searchParams.get("passport"), TOKEN, m.root));
			let d = await t.svc.devoirs();
			assert.deepEqual(d.map(x => [x.cmid, x.courseId, x.nouveau]), [[23, 1, true]]);
			await t.svc.devoirVu(23);
			assert.deepEqual(t.store.moodle.devoirsVus, [23]);
			assert.equal((await t.svc.devoirs())[0].nouveau, false);
			assert.deepEqual(await t.svc.ignorerDevoir(23, true), [23]);
			assert.deepEqual(await t.svc.devoirs(), [], "an ignored assignment is hidden");
			assert.deepEqual(await t.svc.ignorerDevoir(23, false), []);
			assert.equal((await t.svc.devoirs()).length, 1);
			await assert.rejects(t.svc.devoirVu("23"), { code: "badid" });
			await assert.rejects(t.svc.ignorerDevoir(23, 1), { code: "badarg" });
			// hand-in: the page, then the `Rendus` sub-folder
			clock += 5000;
			assert.equal(await t.svc.deposer(23), true);
			assert.equal(t.opened.at(-1), `${m.root}/mod/assign/view.php?id=23`);
			assert.deepEqual(t.chemins, [path.join(base0, "XTI302 - Module", "Rendus TP")]);
			// the rate limit of the page also holds the folder back
			assert.equal(await t.svc.deposer(23), false);
			assert.equal(t.chemins.length, 1);
			// no `Rendus` folder: the module folder
			clock += 5000;
			fs.rmSync(path.join(base0, "XTI302 - Module", "Rendus TP"), { recursive: true });
			assert.equal(await t.svc.deposer(23), true);
			assert.equal(t.chemins.at(-1), path.join(base0, "XTI302 - Module"));
			// a bad id opens nothing
			clock += 5000;
			for (const bad of ["23", -1, 0, 1.5, null]) assert.equal(await t.svc.deposer(bad), false);
			assert.equal(t.chemins.length, 2);
		} finally { stop(m.s); stop(other.s); }
	});
	await test("auto download: after sign-in, at start and every hour (fake clock); never when `auto` is false", async () => {
		const wait = async (cond) => { for (let i = 0; i < 150 && !cond(); i++) await new Promise(r => setTimeout(r, 20)); };
		// auto ON: sign-in alone downloads
		{
			let clock = 1_800_000_000_000;
			const timers = [];
			const planifier = (fn, ms) => { const h = { fn, ms, off: false }; timers.push(h); return () => { h.off = true; }; };
			const { m, other } = await fakeMoodle();
			const base = tmpdir();
			const t = newService({ root: m.root, base, store: { moodle: { site: m.root, auto: true } }, now: () => clock, planifier });
			try {
				await t.svc.connecter();
				await t.svc.recevoirJeton(link(new URL(t.opened[0]).searchParams.get("passport"), TOKEN, m.root));
				const dest = path.join(base, "XTI302 - Admin système");
				await wait(() => fs.existsSync(dest) && fs.readdirSync(dest).length === 1);
				assert.equal(fs.readdirSync(dest).length, 1, "downloaded right after sign-in");
				// at start: arms the hourly timer ONCE and checks
				fs.rmSync(dest, { recursive: true });
				clock += 11000;
				await t.svc.demarrerAuto();
				await t.svc.demarrerAuto();
				assert.equal(timers.length, 1, "one hourly timer");
				assert.equal(timers[0].ms, 3600 * 1000);
				// The start check may still be writing when demarrerAuto returns (seen on the Linux CI runner).
				await wait(() => fs.existsSync(dest) && fs.readdirSync(dest).length === 1);
				assert.equal(fs.existsSync(dest) && fs.readdirSync(dest).length, 1, "downloaded at start");
				// every hour
				fs.rmSync(dest, { recursive: true });
				clock += 3600 * 1000;
				timers[0].fn();
				await wait(() => fs.existsSync(dest));
				assert.equal(fs.existsSync(dest), true, "downloaded at the hourly tick");
				// `auto` switched off: the next tick does nothing
				fs.rmSync(dest, { recursive: true });
				t.store.moodle.auto = false;
				const calls = m.calls.length;
				clock += 3600 * 1000;
				timers[0].fn();
				await new Promise(r => setTimeout(r, 300));
				assert.equal(fs.existsSync(dest), false, "auto off: no download");
				assert.equal(m.calls.length, calls, "auto off: Moodle is not even asked");
				assert.equal((await t.svc.etat()).auto, false);
			} finally { stop(m.s); stop(other.s); }
		}
		// auto OFF from the start: neither sign-in nor start downloads
		{
			const timers = [];
			const { m, other } = await fakeMoodle();
			const base = tmpdir();
			const t = newService({ root: m.root, base, store: { moodle: { site: m.root, auto: false } }, planifier: (fn, ms) => { timers.push(fn); return () => {}; } });
			try {
				await t.svc.connecter();
				await t.svc.recevoirJeton(link(new URL(t.opened[0]).searchParams.get("passport"), TOKEN, m.root));
				await t.svc.demarrerAuto();
				timers.forEach(fn => fn());
				await new Promise(r => setTimeout(r, 300));
				assert.deepEqual(fs.readdirSync(base).filter(n => !n.startsWith("..data")), []);
				assert.equal(m.calls.some(f => /contents/.test(f)), false);
				// an explicit request still works
				assert.equal((await t.svc.synchroniser()).nouveaux, 1);
				// auto defaults to ON when the key does not say
				const d = newService({ root: m.root, base: tmpdir(), store: { moodle: { site: m.root } }, autoParDefaut: true });
				assert.equal((await d.svc.etat()).auto, true);
			} finally { stop(m.s); stop(other.s); }
		}
	});


	/* ─────────── schools: compatibility and the bundled list ─────────── */
	{
		const cfg = (o = {}) => [{ error: false, data: { sitename: "Univ", enablewebservices: 1, enablemobilewebservice: 1, typeoflogin: 2, launchurl: "https://x/admin/tool/mobile/launch.php", ...o } }];
		await test("metered connection: automatic runs (sign-in, start, hourly) are skipped and recorded; manual ones work; unmetered resumes", async () => {
		const wait = async (cond) => { for (let i = 0; i < 150 && !cond(); i++) await new Promise(r => setTimeout(r, 20)); };
		let clock = 1_800_000_000_000;
		let metered = true;
		const timers = [];
		const planifier = (fn, ms) => { timers.push(fn); return () => {}; };
		const { m, other } = await fakeMoodle();
		const base = tmpdir();
		const t = newService({ root: m.root, base, store: { moodle: { site: m.root, auto: true } }, now: () => clock, planifier, limitee: async () => metered });
		try {
			await t.svc.connecter();
			await t.svc.recevoirJeton(link(new URL(t.opened[0]).searchParams.get("passport"), TOKEN, m.root));
			await t.svc.demarrerAuto();
			timers.forEach(fn => fn());
			await new Promise(r => setTimeout(r, 300));
			const dest = path.join(base, "XTI302 - Admin système");
			assert.equal(fs.existsSync(dest), false, "metered: nothing downloaded automatically");
			assert.equal(m.calls.some(f => /contents/.test(f)), false, "metered: Moodle is not asked for contents");
			assert.equal((await t.svc.etat()).pausedMetered, true, "the pause is recorded in the state");
			assert.equal(t.pushes.at(-1).pausedMetered, true, "and pushed to the window");
			// a manual request still works after the click
			clock += 11000;
			assert.equal((await t.svc.synchroniser()).nouveaux, 1, "manual sync works while metered");
			// the link is free again: the next tick resumes and clears the record
			fs.rmSync(dest, { recursive: true });
			metered = false;
			clock += 3600 * 1000;
			timers.forEach(fn => fn());
			await wait(() => fs.existsSync(dest));
			assert.equal(fs.existsSync(dest), true, "unmetered: the automatic download resumes");
			assert.equal((await t.svc.etat()).pausedMetered, false);
			// a failing probe means "not metered"
			const f = newService({ root: m.root, base: tmpdir(), store: { moodle: { site: m.root, auto: true } }, limitee: async () => { throw new Error("probe"); } });
			assert.equal((await f.svc.etat()).pausedMetered, false);
		} finally { stop(m.s); stop(other.s); }
	});
	await test("compat decision from public-config samples, each reason", async () => {
			assert.deepEqual(compat.decider(cfg()), { compatible: true, sitename: "Univ" });
			assert.equal(compat.decider(cfg({ typeoflogin: 3 })).compatible, true);
			assert.equal(compat.decider(cfg({ enablemobilewebservice: 0 })).reason, "mobile-disabled");
			assert.equal(compat.decider(cfg({ enablewebservices: 0 })).reason, "mobile-disabled");
			assert.equal(compat.decider(cfg({ typeoflogin: 1 })).reason, "login-unsupported");
			for (const bad of [null, {}, [], [{ error: true, exception: "x" }], [{ error: false, data: { foo: 1 } }], "x"]) assert.equal(compat.decider(bad).reason, "not-moodle");
			assert.equal(compat.decider(cfg({ sitename: "<b>AB</b>" })).sitename, "bAB/b");
		});
		const T2 = { allowHttpForTests: true };
		await test("verifierSite: one POST, no cookie, verdicts over the wire; 404 not-moodle; closed port unreachable", async () => {
			let seen = null;
			const { s, root } = await server(async (req, res) => {
				seen = { method: req.method, url: req.url, cookie: req.headers.cookie, body: await readBody(req) };
				if (req.url.startsWith("/m404")) { res.statusCode = 404; return res.end("no"); }
				res.setHeader("Set-Cookie", "a=b");
				res.end(JSON.stringify(cfg()));
			});
			try {
				const v = await compat.verifierSite(root, T2);
				assert.deepEqual(v, { compatible: true, sitename: "Univ" });
				assert.equal(seen.method, "POST");
				assert.ok(seen.url.includes("tool_mobile_get_public_config") && seen.body.includes("tool_mobile_get_public_config"));
				assert.equal(seen.cookie, undefined);
				assert.equal(compat.siteVerifie(root), true);
			} finally { stop(s); }
			const dead = await server((q, r) => r.end()); const deadRoot = dead.root; stop(dead.s);
			assert.equal((await compat.verifierSite(deadRoot, T2)).reason, "unreachable");
			assert.equal(compat.siteVerifie(deadRoot), false);
			// plain http is refused outright without the tests-only switch
			assert.equal((await compat.verifierSite(root)).reason, "unreachable");
		});
		await test("verifierSite: an off-origin redirect is refused and never followed", async () => {
			let hits = 0;
			const other = await server((q, r) => { hits++; r.end(JSON.stringify(cfg())); });
			const { s, root } = await server((q, r) => { r.statusCode = 307; r.setHeader("Location", other.root + "/x"); r.end(); });
			try {
				const v = await compat.verifierSite(root, T2);
				assert.equal(v.compatible, false);
				assert.equal(v.reason, "unreachable");
				assert.equal(hits, 0);
			} finally { stop(s); stop(other.s); }
		});
		await test("verifierSite: a same-origin redirect is followed (at most 2 hops)", async () => {
			const { s, root } = await server((q, r) => {
				if (q.url.startsWith("/lib/")) { r.statusCode = 307; r.setHeader("Location", "/a"); return r.end(); }
				if (q.url === "/a") { r.statusCode = 307; r.setHeader("Location", "/b"); return r.end(); }
				if (q.url === "/b") { r.statusCode = 307; r.setHeader("Location", "/c"); return r.end(); }
				r.end(JSON.stringify(cfg()));
			});
			try { assert.equal((await compat.verifierSite(root, T2)).compatible, false, "3 hops is too many"); } finally { stop(s); }
		});
		await test("verifierSite: the 64 KB cap stops an endless answer", async () => {
			const { s, root } = await server((q, r) => { r.write("["); const t = setInterval(() => r.write("x".repeat(8192)), 1); r.on("close", () => clearInterval(t)); });
			try {
				const v = await compat.verifierSite(root, { ...T2, timeoutMs: 5000 });
				assert.equal(v.compatible, false);
				assert.equal(v.reason, "not-moodle");
			} finally { stop(s); }
		});
		await test("verifierSite: a silent server times out", async () => {
			const { s, root } = await server(() => {});
			try { assert.equal((await compat.verifierSite(root, { ...T2, timeoutMs: 300 })).reason, "unreachable"); } finally { stop(s); }
		});
		await test("the bundled list: https origins only, no duplicates, Efrei first, allowed by the guard without a question", async () => {
			const L = ecolesMod.ECOLES;
			assert.ok(L.length >= 30, "at least 30 schools");
			assert.equal(L[0].url, "https://moodle.myefrei.fr");
			const urls = new Set();
			for (const e of L) {
				assert.deepEqual(Object.keys(e).sort(), ["city", "name", "url"]);
				assert.equal(garde.origineSite(e.url), e.url, e.url);
				assert.equal(urls.has(e.url), false, "duplicate " + e.url);
				urls.add(e.url);
				const v = garde.validerReglagesMoodle({ site: e.url }, null);
				assert.equal(v.ok, true, e.url);
			}
			assert.equal(new Set(L.map(e => e.name)).size, L.length, "names unique");
			assert.ok("confirmer" in garde.validerReglagesMoodle({ site: "https://moodle.autre-ecole.fr" }, null), "a custom site still asks");
		});
		await test("the bridge: verifierSite is rate-limited and a custom site needs a prior compatible verdict", async () => {
			const canaux = await readFile("apps/windows/electron/canaux.ts", "utf8");
			assert.ok(canaux.includes("CANAUX.moodleVerifierSite") && canaux.includes("CANAUX.moodleEcoles"));
			assert.ok(canaux.includes("Date.now() - derniereVerif < 1000"));
			assert.ok(canaux.indexOf("siteVerifie(demande)") > 0 && canaux.indexOf("siteVerifie(demande)") < canaux.indexOf("dialogueMoodle = true"), "verified before the native dialog");
		});
	}

	/* ─────────── review hardening: SSRF, throttle, allow-list, budget, Mark-of-the-Web ─────────── */
	const PRIVEES = ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
		"::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "2002:7f00:1::", "ff02::1"];
	const PUBLIQUES = ["203.0.113.5", "8.8.8.8", "172.32.0.1", "100.63.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"];
	const lookupCas = (mod, resolveur, hote, opts = {}) => new Promise(r => mod.creerLookup(resolveur)(hote, opts, (err, a, f) => r({ err, a, f })));
	const verdictLookup = async mod => {
		const pub = async () => [{ address: "203.0.113.5", family: 4 }];
		const ok1 = await lookupCas(mod, pub, "moodle.example.org");
		assert.deepEqual([ok1.err, ok1.a, ok1.f], [null, "203.0.113.5", 4], "a public host resolves");
		assert.deepEqual((await lookupCas(mod, pub, "moodle.example.org", { all: true })).a, [{ address: "203.0.113.5", family: 4 }]);
		for (const ip of ["127.0.0.1", "10.0.0.8", "169.254.169.254", "::1", "fd00::1"]) {
			const r = await lookupCas(mod, async () => [{ address: ip, family: ip.includes(":") ? 6 : 4 }], "x.example.org");
			assert.equal(r.err && r.err.code, "EPRIVATE", ip);
		}
		const mixte = await lookupCas(mod, async () => [{ address: "203.0.113.5", family: 4 }, { address: "10.0.0.1", family: 4 }], "x.example.org", { all: true });
		assert.equal(mixte.err && mixte.err.code, "EPRIVATE", "one private answer among public ones refuses the host");
		for (const h of ["localhost.", "a.localhost", "b.internal", "c.lan"]) {
			const r = await lookupCas(mod, pub, h);
			assert.equal(r.err && r.err.code, "EPRIVATE", h);
		}
	};
	await test("SSRF: private, loopback, link-local, CGNAT, ULA and mapped addresses are private; public ones are not", () => {
		for (const ip of PRIVEES) assert.equal(adresse.adresseEstPrivee(ip), true, ip);
		for (const ip of PUBLIQUES) assert.equal(adresse.adresseEstPrivee(ip), false, ip);
		assert.equal(adresse.adresseEstPrivee("not-an-ip"), true);
	});
	await test("SSRF: origineSite refuses a trailing dot and localhost/.localhost/.internal/.lan/.local names; public hosts stay", () => {
		for (const bad of ["https://localhost./", "https://moodle.example.org./", "https://a.localhost", "https://b.internal", "https://c.lan", "https://d.local", "https://localhost"]) {
			assert.equal(garde.origineSite(bad), null, bad);
		}
		for (const ok of ["https://moodle.example.org", "https://moodle.univ-lyon2.fr", "https://moodle.lan.example.org"]) assert.equal(garde.origineSite(ok), ok, ok);
	});
	await test("SSRF: the connection-time lookup refuses private answers (rebinding included) and lets public ones through", async () => {
		await verdictLookup(adresse);
	});
	await test("SSRF discriminance: with the private-address refusal cut out, the same checks FAIL", async () => {
		const { mod } = await mutant(`${MOODLE}adresse.ts`, "liste.some(r => adresseEstPrivee(r.address))", "false");
		await assert.rejects(verdictLookup(mod));
		const m2 = await mutant(`${MOODLE}garde.ts`, "|| nomHoteInterdit(h)) return null;", ") return null;");
		assert.equal(m2.mod.origineSite("https://moodle.example.org."), "https://moodle.example.org.", "the mutant lets a trailing dot through");
	});
	await test("SSRF: verifierSite and the client resolve first and never connect to a private address", async () => {
		let asked = 0;
		const priv = async () => { asked++; return [{ address: "127.0.0.1", family: 4 }]; };
		const v = await compat.verifierSite("https://moodle.example.org", { resolveur: priv, timeoutMs: 3000 });
		assert.deepEqual([v.compatible, v.reason], [false, "unreachable"]);
		assert.ok(asked >= 1, "the host was resolved through the guarded lookup");
		assert.equal((await compat.verifierSite("https://localhost.")).reason, "unreachable");
		assert.equal((await compat.verifierSite("https://a.internal")).reason, "unreachable");
		const c = createClient("tok", "https://moodle.example.org", { resolveur: priv });
		try { await assert.rejects(c.call("core_webservice_get_site_info"), { code: "EPRIVATE" }); } finally { c.close(); }
	});
	await test("throttle: cours is cached (one Moodle round) and a same call within 1 s returns the first answer; a write forgets it", async () => {
		const c = await connecte({}, { limites: true });
		try {
			const n = () => c.m.calls.filter(x => x === "core_enrol_get_users_courses").length;
			const a = await c.svc.cours();
			const b = await c.svc.cours();
			assert.equal(n(), 1);
			assert.deepEqual(a, b);
			await new Promise(r => setTimeout(r, 1100));
			await c.svc.cours();
			assert.equal(n(), 1, "past the floor, still inside the 30 s catalogue cache");
			await c.svc.favori(4, true);
			await new Promise(r => setTimeout(r, 1100));
			const d = await c.svc.cours();
			assert.equal(n(), 2, "a setting write drops the cache");
			assert.equal(d.find(x => x.id === 4).favori, true);
		} finally { fin(c); }
	});
	await test("throttle: different calls of one verb are spaced by the 1 s floor; fichiers and telechargerCours answer a repeat from memory", async () => {
		const c = await connecte({}, { limites: true, reglages: { extra: [5] } });
		try {
			const t0 = Date.now();
			await Promise.all([c.svc.chercher("a"), c.svc.chercher("b")]);
			assert.ok(Date.now() - t0 >= 900, "the second search waited its turn");
			const contents = () => c.m.calls.filter(x => x === "core_course_get_contents").length;
			const f1 = await c.svc.fichiers(5);
			const n = contents();
			const f2 = await c.svc.fichiers(5);
			assert.equal(contents(), n, "a repeat within the floor is not asked again");
			assert.deepEqual(f1, f2);
			const r1 = await c.svc.telechargerCours(5);
			const r2 = await c.svc.telechargerCours(5);
			assert.equal(r1, r2, "a repeated download request within the floor returns the first answer");
			assert.equal(r1.nouveaux, 1);
		} finally { fin(c); }
	});
	await test("allow-list: leaving a bundled school drops its host; the built-in site and unrelated hosts are never touched", () => {
		const A = "https://moodle.ensea.fr", B = "https://moodle.epita.fr";
		assert.equal(garde.hoteEcoleARetirer(A, B), "moodle.ensea.fr");
		assert.equal(garde.hoteEcoleARetirer(A, null), "moodle.ensea.fr");
		assert.equal(garde.hoteEcoleARetirer(A, A), null);
		assert.equal(garde.hoteEcoleARetirer(garde.SITE_DEFAUT, B), null, "the built-in site stays");
		assert.equal(garde.hoteEcoleARetirer("https://moodle.custom.example", B), null, "a typed site is not a bundled school");
		assert.equal(garde.hoteEcoleARetirer(null, B), null);
		reseau.autoriserHote("moodle.ensea.fr");
		assert.equal(reseau.hoteAutorise(A), true);
		reseau.retirerHote("moodle.ensea.fr");
		assert.equal(reseau.hoteAutorise(A), false);
		reseau.retirerHote("moodle.myefrei.fr");
		assert.equal(reseau.hoteAutorise(garde.SITE_DEFAUT), true, "a host allowed by code is never removed");
	});
	await test("allow-list: choosing a school allows only the active one (bridge wiring)", async () => {
		const canaux = await readFile("apps/windows/electron/canaux.ts", "utf8");
		assert.ok(canaux.includes("retirerEcole(siteActuel, demande)") && canaux.includes("hoteEcoleARetirer(siteActuel, nouvelOrigine)"));
	});
	await test("budget: a run keeps at most N files / B bytes; unknown sizes count as the per-file cap", () => {
		const j = n => ({ file: { size: n } });
		let r = pur.withinBudget([j(10), j(10), j(10)], 100, 2, 1000);
		assert.deepEqual([r.kept.length, r.left], [2, 1]);
		r = pur.withinBudget([j(600), j(600), j(300)], 100, 500, 1000);
		assert.deepEqual([r.kept.length, r.left], [2, 1], "the third (300) fits after the first; the second does not");
		r = pur.withinBudget([j(null), j(null)], 600, 500, 1000);
		assert.deepEqual([r.kept.length, r.left], [1, 1]);
		assert.deepEqual([pur.RUN_MAX_FILES, pur.RUN_MAX_BYTES], [500, 2 * 1024 ** 3]);
	});
	await test("budget: an automatic run stops at the cap and counts the rest as left for the next run", async () => {
		const c = await connecte({}, { reglages: { extra: [5] }, budget: { fichiers: 1, octets: 1e9 } });
		try {
			const r = await c.svc.synchroniser();
			assert.equal(r.nouveaux, 1, "only one of the two files this run");
			assert.ok(r.ignores >= 2, "the one over budget (and the off-host one) are left");
		} finally { fin(c); }
	});
	await test("budget: a course that fails is skipped and the run goes on", async () => {
		const c = await connecte({ moodle: { badCourse: 1 } }, { reglages: { extra: [5] } });
		try {
			const r = await c.svc.synchroniser();
			assert.equal(r.erreur, null, "the run is not aborted");
			assert.equal(r.nouveaux, 1, "the healthy course is still fetched");
			assert.equal(r.echecs, 1, "the failing course is counted");
		} finally { fin(c); }
	});
	await test("budget: only the last 50 added courses are followed", async () => {
		const filler = Array.from({ length: 50 }, (_, i) => 1000 + i);
		let c = await connecte({}, { reglages: { extra: [5, ...filler] } });
		try { assert.equal((await c.svc.cours()).some(x => x.id === 5), false, "the 51st oldest is not followed"); } finally { fin(c); }
		c = await connecte({}, { reglages: { extra: [...filler.slice(1), 5] } });
		try { assert.equal((await c.svc.cours()).some(x => x.id === 5), true); } finally { fin(c); }
	});
	await test("Mark-of-the-Web: the stream holds ZoneId=3 and the site origin only, on Windows; nothing elsewhere; a failure never throws", async () => {
		assert.equal(disque.contenuZone("https://moodle.x.fr/a/b?token=SECRET#h"), "[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://moodle.x.fr\r\n");
		const dir = tmpdir();
		const f = path.join(dir, "a.pdf");
		fs.writeFileSync(f, "x");
		assert.equal(disque.marquerWeb(f, "https://moodle.x.fr", "linux"), false);
		assert.equal(disque.marquerWeb(path.join(dir, "absent", "b.pdf"), "https://moodle.x.fr", "win32"), false, "a write failure is swallowed");
		if (process.platform === "win32") {
			const c = await connecte({}, { reglages: { extra: [5] } });
			try {
				await c.svc.telechargerFichier(5, "Notes.pdf");
				const f2 = await c.svc.fichiers(5);
				const rel = f2.find(x => x.name === "Notes.pdf").relPath.split("/");
				const z = fs.readFileSync(path.join(c.base, ...rel) + ":Zone.Identifier", "utf8");
				assert.equal(z, `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=${c.m.root}\r\n`);
				assert.equal(z.includes(TOKEN), false, "no token in the stream");
				assert.equal(fs.readFileSync(path.join(c.base, ...rel), "utf8"), "12345", "the file itself is intact");
			} finally { fin(c); }
		}
	});
	await test("ouvrirFichier: re-checked right before the hand-off (same inode), residual risk documented", async () => {
		const c = await connecte({}, { reglages: { extra: [5] } });
		try {
			await c.svc.telechargerFichier(5, "Notes.pdf");
			assert.equal(await c.svc.ouvrirFichier(5, "Notes.pdf"), true);
			const svc = await readFile(`${MOODLE}service.ts`, "utf8");
			assert.ok(svc.includes("apres.ino !== avant.ino") && svc.includes("RESIDUAL RISK"));
		} finally { fin(c); }
	});

});

/* ─────────── the app never turns the tests-only switch on; the renderer never imports the module ─────────── */
await test("the app's own files never set allowHttpForTests or `essai`", async () => {
	for (const f of ["main.ts", "canaux.ts", "preload.ts", "pont.ts"]) {
		const src = await readFile(`apps/windows/electron/${f}`, "utf8");
		assert.equal(/allowHttpForTests|essai\s*:/.test(src), false, f);
	}
	const svc = await readFile(`${MOODLE}service.ts`, "utf8");
	assert.equal((svc.match(/allowHttpForTests/g) || []).length, 1, "service.ts only reads the switch to parse the site");
	const cli = await readFile(`${MOODLE}client.ts`, "utf8");
	assert.equal(/rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED/.test(cli), false, "TLS verification is never switched off");
});
await test("the bridge wiring: token files only in the main process, handlers present, setting guarded before write", async () => {
	const canaux = await readFile("apps/windows/electron/canaux.ts", "utf8");
	for (const c of ["moodleEtat", "moodleConnecter", "moodleDeconnecter", "moodleCours", "moodleChercher", "moodleAjouterParUrl", "moodleFavori", "moodleExclure", "moodleAjouter", "moodleRetirer", "moodleFichiers", "moodleTelechargerCours", "moodleTelechargerFichier", "moodleOuvrirDossier", "moodleOuvrirFichier", "moodleDeposer", "moodleDevoirVu", "moodleIgnorerDevoir", "moodleSynchroniser", "moodleDevoirs", "moodleOuvrirDevoir"]) {
		assert.ok(canaux.includes(`CANAUX.${c},`), c);
	}
	assert.ok(canaux.includes("dialogueMoodle ||") && canaux.includes("dialogueMoodleFin"), "one native Moodle dialog at a time, with a pause");
	assert.ok(canaux.indexOf("garderReglagesMoodle(valeur)") < canaux.indexOf("await reglagesOuErreur().ecrire(String(cle), valeur)"));
	const preload = await readFile("apps/windows/electron/preload.ts", "utf8");
	assert.equal(/token/i.test(preload.slice(preload.indexOf("moodle:"), preload.indexOf("miseAJour:"))), false);
});

if (failures.length) {
	console.error(`\ncheck:moodle: ${failures.length}/${total} cases failed`);
	process.exitCode = 1;
} else {
	console.log(`check:moodle: ${total} cases OK`);
}
