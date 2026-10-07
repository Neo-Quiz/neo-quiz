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
	`${MOODLE}garde.ts`, `${MOODLE}jeton.ts`, `${MOODLE}service.ts`, `${MOODLE}erreurs.ts`];

await withSrcModule(mods, async (pur, noms, client, disque, api, garde, jetonMod, service, erreurs) => {
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
			code: "XTI302", yearKey: "2026-2027", cohort: "PSA01" });
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
		assert.deepEqual(v({ site: "https://moodle.myefrei.fr" }), { confirmer: "moodle.myefrei.fr" });
		assert.deepEqual(v({ site: "https://moodle.myefrei.fr", courses: [1] }, "https://moodle.myefrei.fr"), { ok: true, admettre: "moodle.myefrei.fr" });
		assert.deepEqual(v({ site: "https://autre.example.fr" }, "https://moodle.myefrei.fr"), { confirmer: "autre.example.fr" });
		assert.deepEqual(v({ courses: [1, 2] }), { ok: true, admettre: null });
		assert.deepEqual(v({ site: "" }), { ok: true, admettre: null });
		for (const bad of [null, "x", [], { site: "http://x.example.fr" }, { courses: [0] }, { courses: [1.5] }, { courses: "1" }, { courses: [1, "2"] },
			{ site: "https://moodle.myefrei.fr", token: "x" }, { courses: Array.from({ length: 501 }, (_, i) => i + 1) }]) {
			assert.ok("refus" in v(bad), JSON.stringify(bad));
		}
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
				res.end(JSON.stringify({ exception: "x", errorcode: "boom", message: `failure for ${TOKEN} here` })); return;
			}
			const due = Math.floor(Date.now() / 1000) + 3 * 3600;
			res.end(JSON.stringify({
				core_webservice_get_site_info: { userid: 42, fullname: "Ahmed Test" },
				core_enrol_get_users_courses: [
					{ id: 1, shortname: "XTI302-CYB-2627PSA01", fullname: "* XTI302-CYB-2627PSA01 - Admin système (X-BAC)" },
					{ id: 2, shortname: "LXP-4GOOD-2627PSA01", fullname: "LXP" },
				],
				core_course_get_contents: [{ name: "S1", modules: [
					{ id: 10, name: "Cours", modname: "resource", uservisible: true, contents: [
						{ type: "file", filename: "XTI302-CYB-Seance2_TP_Socle_Etudiant.pdf", filesize: 5, fileurl: `${m.root}/pluginfile/a.pdf`, timemodified: 1700000000 },
						{ type: "file", filename: "Dehors.pdf", filesize: 5, fileurl: `${other.root}/x.pdf`, timemodified: 1 },
					] },
					{ id: 23, name: "Rendu TP1", modname: "assign", uservisible: true },
				] }],
				mod_assign_get_assignments: { courses: [{ id: 1, assignments: [{ id: 900, cmid: 23, duedate: due, cutoffdate: 0 }] }] },
				mod_assign_get_submission_status: { lastattempt: { submission: { status: "new" } } },
			}[fn] ?? null));
		});
		return { m, other };
	}
	function newService({ root, base, store = {}, crypt = fakeCrypt(), now = Date.now }) {
		const opened = [], pushes = [];
		const reglages = {
			lire: async k => store[k], ecrire: async (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); }, supprimer: async k => { delete store[k]; },
		};
		const svc = service.creerMoodle({
			racine: () => base, garde: ALL, reglages: () => reglages, dossierDonnees: path.join(base, "..data-" + crypto.randomBytes(3).toString("hex")),
			chiffrement: crypt, ouvrirExterne: async u => { opened.push(u); }, envoyer: e => pushes.push(e), maintenant: () => now(), essai: T,
		});
		return { svc, opened, pushes, store };
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
		const { svc, opened, pushes, store } = newService({ root: m.root, base, store: { moodle: { site: m.root, courses: [] } } });
		try {
			assert.deepEqual(await svc.cours(), [], "not connected: no courses");
			assert.equal((await svc.synchroniser()).erreur, "not-connected");
			await svc.connecter();
			await svc.recevoirJeton(link(new URL(opened[0]).searchParams.get("passport"), TOKEN, m.root));
			const cours = await svc.cours();
			assert.deepEqual(cours.map(c => [c.id, c.code, c.folder, c.enabled, c.available]), [[1, "XTI302", "XTI302 - Admin existant", false, true], [2, null, null, false, false]]);
			assert.deepEqual(await svc.choisir([1, 2, 99, "x"].filter(n => typeof n === "number")), [1], "a course without a code or unknown cannot be chosen");
			await assert.rejects(svc.choisir("1"), /array/);
			assert.deepEqual(store.moodle.courses, [1]);
			assert.equal(store.moodle.site, m.root);
			const r = await svc.synchroniser();
			assert.deepEqual([r.nouveaux, r.mis_a_jour, r.echecs, r.ignores, r.erreur], [1, 0, 0, 1, null]);
			const dest = path.join(base, "XTI302 - Admin existant");
			assert.deepEqual(fs.readdirSync(dest), ["Séance 2 - TP Socle.pdf"]);
			assert.equal(fs.readFileSync(path.join(dest, "Séance 2 - TP Socle.pdf"), "utf8"), "12345");
			assert.equal(other.hits, 0, "the off-host file was never requested");
			// second run: the file is present (same size found), nothing new
			const r2 = await svc.synchroniser();
			assert.deepEqual([r2.nouveaux, r2.mis_a_jour, r2.echecs], [0, 0, 0]);
			assert.equal(fs.readdirSync(dest).length, 1);
			const devoirs = await svc.devoirs();
			assert.deepEqual(devoirs.map(d => [d.cmid, d.name, d.state]), [[23, "Rendu TP1", "urgent"]]);
			assert.equal(await svc.ouvrirDevoir(23), true);
			assert.equal(opened.at(-1), `${m.root}/mod/assign/view.php?id=23`);
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
	await test("service: auto sync waits an hour after the last one", async () => {
		const { m, other } = await fakeMoodle();
		const base = tmpdir();
		let clock = 1_800_000_000_000;
		const { svc, opened } = newService({ root: m.root, base, store: { moodle: { site: m.root, courses: [1] } }, now: () => clock });
		try {
			await svc.connecter();
			await svc.recevoirJeton(link(new URL(opened[0]).searchParams.get("passport"), TOKEN, m.root));
			await svc.demarrerAuto();
			const dest = path.join(base, "XTI302 - Admin système");
			assert.equal(fs.readdirSync(dest).length, 1);
			fs.rmSync(dest, { recursive: true });
			clock += 30 * 60 * 1000;
			await svc.demarrerAuto();
			assert.equal(fs.existsSync(dest), false, "30 minutes later: not synced again");
			clock += 31 * 60 * 1000;
			await svc.demarrerAuto();
			assert.equal(fs.existsSync(dest), true, "an hour later: synced again");
		} finally { stop(m.s); stop(other.s); }
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
	for (const c of ["moodleEtat", "moodleConnecter", "moodleDeconnecter", "moodleCours", "moodleChoisir", "moodleSynchroniser", "moodleDevoirs", "moodleOuvrirDevoir"]) {
		assert.ok(canaux.includes(`CANAUX.${c},`), c);
	}
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
