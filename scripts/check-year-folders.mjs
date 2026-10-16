/**
 * Course folders by school year (spec 2026-10-15-year-folders-design, §2):
 * the PURE plan of "Organise by school year" and the rewrite of the links of
 * Dashboard.md (`src/dashboard/year-folders.ts`), then the RUN
 * (`src/dashboard/year-folders-run.ts`) on an in-memory host: one move at a
 * time, the first failure stops it, Dashboard.md written once and only for
 * the folders that moved.
 *
 * Every case was checked for discriminance: break the rule, see red, restore.
 *
 *     npm run check:year-folders
 *
 * Exit code only (`process.exitCode`, never `process.exit()`).
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/dashboard/year-folders.ts", "src/dashboard/year-folders-run.ts", "src/host/current.ts"], async (yf, run, hote) => {
	const r = makeReporter("Year folders");
	const OCT = new Date(2026, 9, 16);

	/* ── 1. Levels: ceil(first digit / 2), course codes only ── */
	r.check("1. levels 1 to 5, with and without a -CYB style suffix",
		["XTI101 - Algo", "XTI205 - Web", "XTI302-CYB - Admin", "XCS413 - Fondamentaux", "XMUT501 - Master", "XTI3021 - Autre"].map(yf.courseLevel),
		[1, 1, 2, 2, 3, 2]);
	r.check("1. not a course: year folders, plain folders, lower case, a code without a level, too short",
		["B2 2026-2027", "Fichiers", "Generated", "xti302 - admin", "XTI001 - Zero", "LXP-4GOOD", "X101", "XTI30"].map(yf.courseLevel),
		[null, null, null, null, null, null, null, null]);
	r.check("1. the school year runs September to August",
		[new Date(2026, 7, 31), new Date(2026, 8, 1), new Date(2027, 0, 15)].map(yf.currentSchoolYearStart), [2025, 2026, 2026]);

	const dir = (name) => ({ name, isFolder: true });
	const file = (name) => ({ name, isFolder: false });

	/* ── 2. The owner's root, no year folder yet ── */
	{
		const entries = [file("Dashboard.md"), dir("Fichiers"), dir("Generated"), dir(".neo-quiz"), dir(".stfolder"),
			dir("XTI303 - Conception"), dir("XTI101 - Algo"), dir("XMUT203 - Communication"), dir("XCS413 - Fondamentaux"),
			dir("Notes perso"), dir("XTI001 - Zero"), dir("xti304 - minuscule"), file("XTI102 - not a folder.md")];
		const p = yf.planYearFolders({ entries, yearChildren: {}, keep: ["Generated"], now: OCT });
		r.check("2. course folders move, sorted; the highest level is this school year, the lower ones count back",
			p.moves, [
				{ folder: "XCS413 - Fondamentaux", yearFolder: "B2 2026-2027" },
				{ folder: "XMUT203 - Communication", yearFolder: "B1 2025-2026" },
				{ folder: "XTI101 - Algo", yearFolder: "B1 2025-2026" },
				{ folder: "XTI303 - Conception", yearFolder: "B2 2026-2027" },
			]);
		r.check("2. both year folders are created, nothing collides", [p.create, p.collisions], [["B2 2026-2027", "B1 2025-2026"], []]);
	}

	/* ── 3. An existing year folder is reused; the others derive from a DATED one ── */
	{
		const p = yf.planYearFolders({
			entries: [dir("B2 (2026-2027)"), dir("XTI302 - Admin"), dir("XTI101 - Algo")],
			yearChildren: { "B2 (2026-2027)": ["XTI301 - Python"] }, now: OCT,
		});
		r.check("3a. B2 (…) reused (not created); B1 falls back on the count from today",
			[p.moves.map(m => m.yearFolder), p.create], [["B1 2025-2026", "B2 (2026-2027)"], ["B1 2025-2026"]]);
		const q = yf.planYearFolders({
			entries: [dir("B2 2030-2031"), dir("XTI101 - Algo"), dir("XTI501 - Master"), dir("XTI401 - Reseaux")],
			yearChildren: { "B2 2030-2031": [] }, now: OCT,
		});
		r.check("3b. derived from B2 2030-2031: B1 2029-2030, B3 2031-2032, B2 reused",
			[q.moves.map(m => m.yearFolder), q.create], [["B1 2029-2030", "B2 2030-2031", "B3 2031-2032"], ["B1 2029-2030", "B3 2031-2032"]]);
		const two = yf.planYearFolders({
			entries: [dir("B2 2026-2027"), dir("B2 old"), dir("XTI301 - Python")], yearChildren: {}, now: OCT,
		});
		r.check("3c. two B2 folders: the first by name", two.moves[0].yearFolder, "B2 2026-2027");
	}

	r.check("3d. the generated-quizzes folder never moves, even with a course-like name",
		yf.planYearFolders({ entries: [dir("XTI999 - Generated"), dir("XTI101 - Algo")], yearChildren: {}, keep: ["xti999 - generated"], now: OCT }).moves.map(m => m.folder),
		["XTI101 - Algo"]);

	/* ── 4. Pre-flight: a target that exists (any case) is named, as a collision ── */
	{
		const p = yf.planYearFolders({
			entries: [dir("B2 2026-2027"), dir("XTI302 - Admin"), dir("XTI303 - Conception")],
			yearChildren: { "B2 2026-2027": ["xti302 - admin", "XTI309 - Projet"] }, now: OCT,
		});
		r.check("4. the existing target is named, the other is not", p.collisions, ["B2 2026-2027/XTI302 - Admin"]);
	}

	/* ── 5. The Dashboard.md rewrite ── */
	const moves = [
		{ folder: "XTI302 - Administration système avancées & Scripting", yearFolder: "B2 2026-2027" },
		{ folder: "XTI306 - Introduction à l'ingénierie IA", yearFolder: "B2 2026-2027" },
		{ folder: "XTI406 - Outils sécurité & Gestion d'incidents (SOC, SIEM)", yearFolder: "B2 2026-2027" },
		{ folder: "XTI101 - Algo", yearFolder: "B1 2025-2026" },
		{ folder: "XTI301 - Écosystème Python", yearFolder: "B2 2026-2027" },
	];
	const nfd = encodeURIComponent("XTI301 - Écosystème Python".normalize("NFD"));
	const avant = [
		"---", "title: Dashboard", "---", "",
		"> [!quick] Links",
		"> - [MOODLE](neo-quiz://moodle)",
		"> - [GRAPH](obsidian://advanced-uri?vault=Neo%20Quiz&commandid=graph%3Aopen)",
		"> - [XTI302](XTI302%20-%20Administration%20syst%C3%A8me%20avanc%C3%A9es%20&%20Scripting/XTI302%20-%20Administration%20syst%C3%A8me%20avanc%C3%A9es%20&%20Scripting.md)",
		"> - [XTI306](XTI306%20-%20Introduction%20%C3%A0%20l'ing%C3%A9nierie%20IA/XTI306.md) and [XTI101](XTI101%20-%20Algo/n.md)",
		"> - [SOC](XTI406%20-%20Outils%20s%C3%A9curit%C3%A9%20&%20Gestion%20d'incidents%20(SOC,%20SIEM)/XTI406.md)",
		"> - [NFD](" + nfd + "/n.md)",
		"> - [Fichiers](Fichiers/plan.pdf) [Same prefix](XTI1011%20-%20Autre/x.md) [Folder only](XTI101%20-%20Algo)",
		"> - [Angle](<XTI101 - Algo/n.md>) [Web](https://example.com/XTI101%20-%20Algo/x)",
		"![img](XTI101%20-%20Algo/img.png)",
		"Plain text: XTI101%20-%20Algo/x, [not a link] (XTI101%20-%20Algo/x)",
		"",
	].join("\r\n");
	const attendu = avant
		.replace("](XTI302%20", "](B2%202026-2027/XTI302%20")
		.replace("](XTI306%20", "](B2%202026-2027/XTI306%20")
		.replace("](XTI101%20-%20Algo/n.md)", "](B1%202025-2026/XTI101%20-%20Algo/n.md)")
		.replace("](XTI406%20", "](B2%202026-2027/XTI406%20")
		.replace("](" + nfd, "](B2%202026-2027/" + nfd)
		.replace("](<XTI101", "](<B1 2025-2026/XTI101")
		.replace("](XTI101%20-%20Algo/img.png)", "](B1%202025-2026/XTI101%20-%20Algo/img.png)");
	const apres = yf.rewriteDashboardLinks(avant, moves);
	r.check("5. only the moved targets change: & ' accents (NFC and NFD) %20, parentheses, <…>, images", apres, attendu);
	r.check("5. CRLF kept, nothing else changed in length", [apres.split("\r\n").length, apres.includes("\n") && !/[^\r]\n/.test(apres)], [avant.split("\r\n").length, true]);
	r.check("5. idempotent: a second run changes nothing", yf.rewriteDashboardLinks(apres, moves), apres);
	r.check("5. nothing moved: the same text", yf.rewriteDashboardLinks(avant, []), avant);
	r.check("5. a malformed %-escape is left alone, never thrown", yf.rewriteDashboardLinks("[x](XTI101%2-Algo/a.md)", moves), "[x](XTI101%2-Algo/a.md)");

	/* ── 6. The run, on an in-memory host ── */
	{
		/** A case-insensitive in-memory disk of FOLDERS and files, like Windows. */
		const disk = (folders, files) => {
			const dirs = new Set(folders);
			const content = new Map(Object.entries(files));
			const has = (p) => dirs.has(p) || content.has(p) || [...dirs].some(d => d.toLowerCase() === p.toLowerCase());
			const calls = [];
			return {
				dirs, content, calls,
				fs: {
					listDir: async (d) => [...new Set([...dirs, ...content.keys()].filter(p => p.startsWith(d + "/") && !p.slice(d.length + 1).includes("/")))]
						.map(p => ({ name: p.slice(d.length + 1), path: p, isFolder: dirs.has(p) })),
					mkdirs: async (p) => { calls.push(["mkdirs", p]); dirs.add(p); },
					exists: async (p) => has(p),
					read: async (p) => { if (!content.has(p)) throw new Error("ENOENT"); return content.get(p); },
					process: async (p, f) => { calls.push(["process", p]); content.set(p, f(content.get(p))); },
					write: async () => { throw new Error("write is never used"); },
					rename: async (a, b) => {
						calls.push(["rename", a, b]);
						if (has(b)) throw new Error(`${b} existe déjà`);
						for (const d of [...dirs]) if (d === a || d.startsWith(a + "/")) { dirs.delete(d); dirs.add(b + d.slice(a.length)); }
						for (const [k, v] of [...content]) if (k.startsWith(a + "/")) { content.delete(k); content.set(b + k.slice(a.length), v); }
					},
				},
			};
		};
		const roots = [{ id: "NQ", name: "Neo Quiz" }];
		const paths = {
			roots: () => roots, defaultRoot: () => roots[0],
			rootOf: (p) => roots.find(x => p === x.id || p.startsWith(x.id + "/")) ?? null,
			localPath: (p) => p.split("/").slice(1).join("/"),
			contractPath: (id, l) => (l ? id + "/" + l : id),
		};
		const dash = "[A](XTI101%20-%20Algo/a.md)\r\n[B](XTI302%20-%20Admin/b.md)\r\n[C](XTI401%20-%20Reseaux/c.md)\r\n";
		const go = async (d, { failOn } = {}) => {
			const moved = [], renamed = [], prefixes = [], notices = [];
			const rename = d.fs.rename;
			if (failOn) d.fs.rename = async (a, b) => { if (a.endsWith(failOn)) { d.calls.push(["refused", a]); throw new Error("EPERM"); } return rename(a, b); };
			hote.installHost({ fs: d.fs, paths, ui: { notice: (m) => { notices.push(m); } } });
			const ctx = {
				statsStore: { renamed: (a, b) => { renamed.push([a, b]); } },
				reviewStore: { moved: async (a, b) => { moved.push([a, b]); } },
				movedPrefix: async (a, b) => { prefixes.push([a, b]); },
				scanner: { getQuizzes: () => [{ path: "NQ/XTI101 - Algo/a.md" }] },
				generatedFolder: () => "NQ/Generated",
			};
			const original = console.error;
			console.error = () => {};
			try {
				const plan = await run.readYearPlan(ctx, "NQ", OCT);
				const res = await run.runYearFolders(ctx, "NQ", plan);
				return { plan, res, moved, renamed, prefixes, notices };
			} finally { console.error = original; hote.uninstallHost(); }
		};
		const base = () => disk(["NQ", "NQ/Generated", "NQ/Fichiers", "NQ/XTI101 - Algo", "NQ/XTI302 - Admin", "NQ/XTI401 - Reseaux"],
			{ "NQ/Dashboard.md": dash, "NQ/XTI101 - Algo/a.md": "q" });

		const a = base();
		const ra = await go(a);
		r.check("6a. year folders created first, then one rename per course, in order",
			a.calls.filter(c => c[0] !== "process").map(c => c.join(" ")), [
				"mkdirs NQ/B1 2025-2026", "mkdirs NQ/B2 2026-2027",
				"rename NQ/XTI101 - Algo NQ/B1 2025-2026/XTI101 - Algo",
				"rename NQ/XTI302 - Admin NQ/B2 2026-2027/XTI302 - Admin",
				"rename NQ/XTI401 - Reseaux NQ/B2 2026-2027/XTI401 - Reseaux",
			]);
		r.check("6a. history, stats and host keys follow each folder (the app's safe move)",
			[ra.moved.length, ra.renamed[0], ra.prefixes[2]],
			[3, ["NQ/XTI101 - Algo", "NQ/B1 2025-2026/XTI101 - Algo"], ["NQ/XTI401 - Reseaux", "NQ/B2 2026-2027/XTI401 - Reseaux"]]);
		r.check("6a. Generated and Fichiers stay; the quiz is under its year folder",
			[a.dirs.has("NQ/Generated"), a.dirs.has("NQ/Fichiers"), a.content.has("NQ/B1 2025-2026/XTI101 - Algo/a.md")], [true, true, true]);
		r.check("6a. Dashboard.md rewritten once",
			[ra.res, a.calls.filter(c => c[0] === "process").length, a.content.get("NQ/Dashboard.md")],
			[{ moved: ra.plan.moves, failed: null, dashboard: "rewritten" }, 1,
				"[A](B1%202025-2026/XTI101%20-%20Algo/a.md)\r\n[B](B2%202026-2027/XTI302%20-%20Admin/b.md)\r\n[C](B2%202026-2027/XTI401%20-%20Reseaux/c.md)\r\n"]);

		const b = base();
		const rb = await go(b, { failOn: "XTI302 - Admin" });
		r.check("6b. a failure stops the run: named, what moved stays moved, the next one never tried",
			[rb.res.failed, rb.res.moved.map(m => m.folder), b.dirs.has("NQ/XTI401 - Reseaux"), b.calls.filter(c => c[0] !== "mkdirs").map(c => c[0] + " " + c[1])],
			["XTI302 - Admin", ["XTI101 - Algo"], true, ["rename NQ/XTI101 - Algo", "refused NQ/XTI302 - Admin", "process NQ/Dashboard.md"]]);
		r.check("6b. Dashboard.md: only the moved folder's link changes",
			b.content.get("NQ/Dashboard.md"), dash.replace("](XTI101", "](B1%202025-2026/XTI101"));

		const c = base();
		c.dirs.add("NQ/B2 2026-2027"); c.dirs.add("NQ/B2 2026-2027/XTI302 - Admin");
		const rc = await go(c);
		r.check("6c. a collision: nothing created, nothing moved, nothing written",
			[rc.plan.collisions, rc.res.failed, c.calls], [["B2 2026-2027/XTI302 - Admin"], "B2 2026-2027/XTI302 - Admin", []]);

		const d = base();
		d.content.delete("NQ/Dashboard.md");
		const rd = await go(d);
		const e = base();
		e.content.set("NQ/Dashboard.md", "[Other](Fichiers/plan.pdf)" + "\r\n");
		const re = await go(e);
		r.check("6e. no link to a moved folder: Dashboard.md is not written at all",
			[re.res.dashboard, e.calls.some(c => c[0] === "process")], ["unchanged", false]);

		r.check("6d. no Dashboard.md: the moves happen, nothing is written", [rd.res.dashboard, rd.res.moved.length, d.content.has("NQ/Dashboard.md")], ["absent", 3, false]);
	}

	r.done();
});
