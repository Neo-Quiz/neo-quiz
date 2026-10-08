/**
 * SHARING, END TO END (2026-10-07) - the chain nobody tested: export a real
 * folder with the REAL exporter (`construire`), import the result into an
 * empty folder with the REAL importer (`importArchiveAsFolder`,
 * `importFileIntoFolder`), compare byte for byte. Then the archives other
 * tools make (golden) must import, and the hostile ones must be refused
 * WITHOUT writing anything.
 *
 * What it prevents: an export the import cannot read back (a name the
 * exporter writes and the importer refuses, an image that does not travel),
 * an import that silently drops what it cannot read, a hostile archive that
 * writes outside its folder, and any of that changing from one version to the
 * next. The golden archives live in `scripts/fixtures/share/` (made by
 * `generate.mjs`); their SHA-256 are pinned below, and the list can only GROW
 * (never edit or remove a fixture: add a new one, and pin it here).
 *
 * Since 2026-10-07 the import is a PLAN (`planImport`, pure) applied in a
 * STAGING folder (`applyPlan`): the check also drives the plan on every
 * archive, the existing-folder rules (identical quiz not duplicated, different
 * one renamed "Name (2)", nothing overwritten), the manifest (format 1, a
 * future format, a tampered file), and a failure injected at the k-th write,
 * which must leave nothing behind.
 *
 * The filesystem is a REAL temporary folder (NTFS on Windows: case-insensitive,
 * so a collision is real), laid out as `base/vault` (the "vault"), `base/canary`
 * and `base/outside`; a hostile import is judged on a snapshot of the WHOLE
 * `base`, so a write one level up is caught too.
 *
 *     npm run check:share-roundtrip
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";
import { buildFixtures, expectedJson, fakePng, fence, noteA, noteC, sha256 } from "./fixtures/share/generate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "share");

/* THE RATCHET. SHA-256 of every fixture, written by hand from
   `generate.mjs`. A missing file, a changed hash or an unlisted archive fails
   the check; a deliberate new fixture is added to the generator AND to this
   table, an old one is never touched. */
const PINNED_GOLDEN = {
	// <pinned-golden>
	"app-export-folder.zip": "79456850e03946b459cfceacd90534777a7a52d2a307942290d28ce40f186c4f",
	"v0-store-notes-only.zip": "cdaff5ef6fe71990ff19a351fab789e704e205b9c75742c64d5d3dd0dbdd24c6",
	"windows-explorer.zip": "4be7d08bddd627ce2e6bc68285535e17f1c3ddc0339dde78af480b903f534ddd",
	"macos-finder.zip": "2937b03e2c5f71d2aab0e17be7d32b806572b807eaa8952c59630780a0537f03",
	"7zip-deflate.zip": "0796a3ea087fdad3c98f124240fc6239e4c7cab2a63742a8de00aaa1ba31b6ac",
	"root-folder-subfolders.zip": "fe853e869716907a819d85e1f12e74aba9d83089daa95c7d2b3fdbc3f1a5f579",
	"nfd-accents.zip": "b226158c14b22d67746ed0fdc09a870ef08bd980dd84748e3745bee22c4c8b9d",
	"legacy-cp437.zip": "ceac3bdef405809e5e0ec823f0cf5510915bdddd82cc68186a2fbd89b71dee0f",
	"unicode-path-extra.zip": "ca78bdd8ff93ab45fffac62261013b9f9ae5c7c5d359cf1f5aef2d85c66cbc89",
	"zip64.zip": "71599ef28406fc822da1d66cfa861fd5dfb03275390343752da1da88f2d88697",
	"v1-quiz-whole-note.zip": "fbefa521714bb46dc9cdbb034b1e320bfdbe0134b1577147db8b2c6cdb265e33",
	"v1-folder.zip": "6095c4cae017528fa4929e37dbb5d74575214b5239d6d8e4bf0f93095cab2c0f",
	"v1-selection.zip": "018dde86c3e29615988b3f013f1854593084e8078b33b237670f6974cca57a4e",
	"v1-future-format.zip": "2fefeb88e86fe7b1508880e48d2846cb26f8dd36f02426b5dd21227178c07b47",
	"v1-tampered-file.zip": "5728b1e094cacce562851675c451c66526ff1d31b8e802410f1c9dad76427e35",
	"v0-bom-subfolders-case.zip": "fdf43f96331ca763745d170c0775079b7cbbead116114f45596963d69804233f",
	// </pinned-golden>
};
const PINNED_HOSTILE = {
	// <pinned-hostile>
	"slip-dotdot.zip": "f036a500dcb7eaa9f87dd8a74ce2022023bae7b97bdf1b28d4f404d9b779a7e9",
	"slip-dotdot-backslash.zip": "1dbbe3aa006c01aabda00a3175590f7984c14ecf18915ff411f270b508991f35",
	"slip-nested.zip": "e4767f7e2190551260af39f4b61ae013233055f0bc50a2bf6aa80e1137799709",
	"absolute-unix.zip": "ea80eea6bcf47fda27bf22c71684fb540bdf5c470c4bbdf6f32c1eaf36b7b38c",
	"absolute-backslash.zip": "dfc92b96d05db56219413ac8be31af326af2a0036d69332904b45bde209c7bf4",
	"drive-letter.zip": "bcc07fc3ff5ac99f9623976298bd6c00c001f1c9cb7a09d04a27b21c2a2ee9f8",
	"drive-relative.zip": "eb1dd463bd842c7c1b7ab42cc19ad474ace1ed2d20bf95313b1cb19d650b0930",
	"unc-share.zip": "1ebe138da100b45c10f31436d047ed6d6c9f01fb1b637dc131b5fd55e97f8eff",
	"symlink-only.zip": "5f013e4f6961a3b99d86f46bd121a555b4bc79ee8c7652ab55520bbef4fe3615",
	"bomb-ratio.zip": "9dc48482b0b4d38150648041f10a8feebf2f935793cf57baea9bd80ce44a2e07",
	"bomb-declared-size.zip": "5420ce0ef1e72614a1fcc4d6bb58b01d63123eb3d1bce0d87bb73c59298e1d9a",
	"crc-wrong.zip": "a02e2f184095fa0e2ed046eac896bb8e4aaaaa85786e43115fcd668994f2fb47",
	"encrypted.zip": "f23b94a448187645c112ce8ba0b77ae889a2a2a592073c27af7c54923cb19e72",
	"name-mismatch.zip": "6833200fd9d6d380e321378302d7be3420328865ee5801a15a6cbe424c96e104",
	"reserved-names.zip": "f3c4f0a3cf2de3f20fa29ebb6494b1e4a044f1d0714c34fbb003071b7c05955d",
	"svg-with-script.zip": "1fb38d8c5a8bd710accbf3f2af36040e87c9ba6df46b43a1a864e0d91023f281",
	"executables.zip": "70faab340e980d055951d1d3b04608b6dc0e298f8c7a0d2ba5aad58a84fbb8cb",
	"overlapping-entries.zip": "3e9b1e37d2027925c2a1039c2aec1dde41dc6f2fcd498df339d70278628723fc",
	"too-many-entries.zip": "8775d7ef015bd84fb1db7944db713094644206f656c994d6a69e2cba00b12abe",
	"multi-disk.zip": "fb82ee2cb825ad5cc5e4b30d6f56999252df64f24ca36d4ed092546bb3981ae8",
	"truncated.zip": "9e5926fb89c6675961f239865dd73c4259cd97eac2a944bb1f596c98cca4e01c",
	"not-a-zip.zip": "a54ddeeec56591d48ffcc848c47a23d4bb9d0e3fc10734e914d98def5dcfc27d",
	"empty-file.zip": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
	// </pinned-hostile>
};
const MIN_GOLDEN = 16;
const MIN_HOSTILE = 23;

const sha = (b) => createHash("sha256").update(b).digest("hex");

/** A real temporary tree and a host over it. */
function makeWorld() {
	const base = mkdtempSync(join(tmpdir(), "share-roundtrip-"));
	const root = join(base, "vault");
	mkdirSync(root);
	mkdirSync(join(base, "outside"));
	writeFileSync(join(base, "canary.txt"), "canary");
	const notices = [];
	const world = { failAt: null, writes: 0, renameFailAt: null, renames: 0 };
	const abs = (p) => resolve(root, p); // NOT guarded: a path that climbs really climbs
	const host = {
		fs: {
			exists: async (p) => existsSync(abs(p)),
			read: async (p) => readFileSync(abs(p), "utf8"),
			readBinary: async (p) => new Uint8Array(readFileSync(abs(p))),
			write: async (p, c) => { writeFileSync(abs(p), c, "utf8"); },
			writeBinary: async (p, b) => {
				// Failure injection: the k-th binary write throws (a full disk, a lock...).
				if (++world.writes === world.failAt) throw new Error("injected failure");
				writeFileSync(abs(p), b);
			},
			mkdirs: async (p) => { mkdirSync(abs(p), { recursive: true }); },
			listDir: async (p) => (existsSync(abs(p)) ? readdirSync(abs(p), { withFileTypes: true }).map(e => ({ name: e.name, path: `${p}/${e.name}`, isFolder: e.isDirectory() })) : []),
			remove: async (p) => { rmSync(abs(p), { force: true }); },
			// A rename never overwrites (the host rejects an existing destination).
			rename: async (a, b) => {
				if (world.renameFailAt !== null && ++world.renames === world.renameFailAt) throw new Error("injected rename failure");
				if (world.renameFailAt === null) world.renames++;
				if (existsSync(abs(b))) throw new Error("exists: " + b);
				renameSync(abs(a), abs(b));
			},
			// The host's recoverable trash: <root>/.trash/<path>.
			trash: async (p) => { const t = abs(`.trash/${p}`); mkdirSync(dirname(t), { recursive: true }); renameSync(abs(p), t); },
		},
		links: {
			resolve: (target, from) => {
				const dir = posix.dirname(from);
				for (const c of [posix.join(dir, target), target]) {
					if (existsSync(abs(c)) && statSync(abs(c)).isFile()) return { name: posix.basename(c), path: c };
				}
				const want = posix.basename(target);
				const walk = (rel) => {
					for (const e of readdirSync(abs(rel || "."), { withFileTypes: true })) {
						const p = rel ? `${rel}/${e.name}` : e.name;
						if (e.isDirectory()) { const f = walk(p); if (f) return f; } else if (e.name === want) return { name: e.name, path: p };
					}
					return null;
				};
				return walk("");
			},
		},
		ui: { notice: (m) => { notices.push(m); } },
		paths: { defaultRoot: () => ({ id: "r" }), contractPath: (_id, p) => p },
		platform: { isMobile: false },
	};
	const ctx = { settings: { quizzesModuleOverrides: {} }, saveSettings: async () => {} };
	return { base, root, notices, host, ctx, abs, world, close: () => rmSync(base, { recursive: true, force: true }) };
}

/** Every file and folder under `dir`, with content hashes, sorted. */
function snapshot(dir) {
	const out = [];
	const walk = (d, rel) => {
		for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const p = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) { out.push(`${p}/`); walk(join(d, e.name), p); } else out.push(`${p} ${sha(readFileSync(join(d, e.name)))}`);
		}
	};
	walk(dir, "");
	return out;
}
/** Files directly in `dir` (name -> sha). */
const srt = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const listFiles = (dir) => {
	const out = {};
	const walk = (d, rel) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) walk(join(d, e.name), p); else out[p.normalize("NFC")] = sha(readFileSync(join(d, e.name)));
		}
	};
	walk(dir, "");
	return srt(out);
};

await withSrcModule(
	["apps/windows/src/ui/partage.ts", "src/dashboard/folder-create.ts", "src/dashboard/zip.ts", "src/host/current.ts", "src/dashboard/share-plan.ts", "src/dashboard/share-import.ts", "src/dashboard/share-manifest.ts"],
	async (partage, importer, zip, hostMod, planner, shareImport, manifest) => {
		const r = makeReporter("Sharing end to end - round trip, golden and hostile archives");
		const withWorld = async (fn) => {
			const w = makeWorld();
			hostMod.installHost(w.host);
			try { return await fn(w); } finally { hostMod.uninstallHost(); w.close(); }
		};
		const read = (kind, file) => new Uint8Array(readFileSync(join(FIX, kind, file)));

		/* ── 0. the length of the ABSOLUTE target on Windows ── */
		{
			const planOf = (path) => ({ writes: [{ path, kind: "note", bytes: new Uint8Array(0), sha256: "0" }] });
			// The CONTRACT path is short ("Cours/Sub"); the root's disk path is what makes it long.
			const folder = "Cours/x";
			const absolute = "C:/Users/Ahmed/" + "d".repeat(120) + "/x";
			const tooLong = (windows, path) => { try { shareImport.checkPaths(folder, planOf(path), windows ? absolute : null); return null; } catch (e) { return e instanceof shareImport.ImportPathTooLongError ? e.fileName : "other"; } };
			const fits = "a".repeat(60) + ".md";
			const over = "b".repeat(110) + ".md";
			r.check("Windows: a relative path under 240 whose ABSOLUTE path passes 260 is refused, naming the file; elsewhere it is accepted",
				[tooLong(true, fits), tooLong(true, over), tooLong(false, over)], [null, over, null]);
		}

		/* ── 1. THE RATCHET ── */
		const gFiles = readdirSync(join(FIX, "golden")).sort();
		const hFiles = readdirSync(join(FIX, "hostile")).sort();
		r.check("every golden archive is pinned, and no pinned one is missing", [gFiles, Object.keys(PINNED_GOLDEN).sort()], [gFiles, gFiles]);
		r.check("every hostile archive is pinned, and no pinned one is missing", [hFiles, Object.keys(PINNED_HOSTILE).sort()], [hFiles, hFiles]);
		r.check("golden archives: contents unchanged since they were pinned", gFiles.filter(f => sha(read("golden", f)) !== PINNED_GOLDEN[f]), []);
		r.check("hostile archives: contents unchanged since they were pinned", hFiles.filter(f => sha(read("hostile", f)) !== PINNED_HOSTILE[f]), []);
		r.check("the lists only grow (a floor, raised when a fixture is added)", [gFiles.length >= MIN_GOLDEN, hFiles.length >= MIN_HOSTILE], [true, true]);

		const expected = JSON.parse(readFileSync(join(FIX, "expected.json"), "utf8"));
		const regen = await buildFixtures();
		const sameZlib = expected.zlib === process.versions.zlib;
		r.check("the generator still builds the same archive set", [Object.keys(regen.golden).sort(), Object.keys(regen.hostile).sort()], [gFiles, hFiles]);
		r.check(sameZlib ? "the generator reproduces every archive BYTE FOR BYTE" : "(zlib differs from the one that made the fixtures: byte comparison skipped, the checks below still read the committed bytes)",
			sameZlib ? [...Object.entries(regen.golden)].filter(([f, v]) => sha(v.bytes) !== PINNED_GOLDEN[f]).concat([...Object.entries(regen.hostile)].filter(([f, v]) => sha(v.bytes) !== PINNED_HOSTILE[f])).map(([f]) => f) : [],
			[]);
		r.check("expected.json is the generator's own output (sha of the expectations too)", JSON.stringify(expected.golden) === JSON.stringify(expectedJson(regen).golden) || !sameZlib, true);

		/* ── 2. GOLDEN ARCHIVES: each one imports, with the expected content ── */
		for (const file of gFiles) {
			const want = expected.golden[file];
			const bytes = read("golden", file);
			const recu = await shareImport.receiveArchive(bytes);
			const plan = planner.planImport({ files: recu.files, skipped: recu.skipped, junk: recu.junk, quizOnly: false, existing: new Map(), fallbackName: file.replace(/\.zip$/, "") });
			const ignored = plan.discarded.filter(d => !recu.skipped.some(k => k.name === d.name && k.reason === d.reason)).map(d => d.reason);
			r.check(`golden ${file}: read as expected (skipped, junk, left out, notices, folder look)`, [recu.skipped.map(x => x.reason), plan.junk, ignored, plan.notices, plan.settings ? srt(plan.settings) : null], [want.skipped, want.junk, want.ignored, want.notices ?? [], want.settings ? srt(want.settings) : null]);
			r.check(`golden ${file}: the plan holds exactly the expected files (paths, bytes) and folder name`, [srt(Object.fromEntries(plan.writes.map(w => [w.path, sha(w.bytes)]))), plan.folderName], [srt(want.files), want.folder]);
			await withWorld(async (w) => {
				await importer.importArchiveAsFolder(w.ctx, {}, [], { name: file, bytes }, () => {});
				const folder = join(w.root, want.folder);
				r.check(`golden ${file}: no staging folder is left next to the imported one`, readdirSync(w.root).filter(n => n.startsWith(".import-")), []);
				r.check(`golden ${file}: imported as a new folder, every file byte for byte (names NFC)`, existsSync(folder) ? listFiles(folder) : "no folder", srt(want.files));
				r.check(`golden ${file}: the user was told what was left out, and only that`, w.notices.some(n => /not imported/.test(n)), want.ignored.length > 0 || want.skipped.length > 0);
			});
			await withWorld(async (w) => {
				mkdirSync(w.abs("Existing"));
				writeFileSync(w.abs("Existing/mine.md"), "mine");
				await importer.importFileIntoFolder("Existing", { name: file, bytes }, () => {});
				const got = listFiles(w.abs("Existing"));
				delete got["mine.md"];
				r.check(`golden ${file}: also imports INTO an existing folder, without touching what is there`, [got, readFileSync(w.abs("Existing/mine.md"), "utf8")], [srt(want.files), "mine"]);
			});
		}

		/* ── 3. HOSTILE ARCHIVES: refused, NOTHING written (whole tree compared) ── */
		for (const file of hFiles) {
			const want = expected.hostile[file];
			const bytes = read("hostile", file);
			let outcome;
			try {
				const res = await shareImport.receiveArchive(bytes);
				const plan = planner.planImport({ files: res.files, skipped: res.skipped, junk: res.junk, quizOnly: false, existing: new Map(), fallbackName: "x" });
				outcome = { read: "ok", notes: plan.writes.length, skipped: res.skipped.map(x => x.reason), ignored: plan.discarded.filter(d => !res.skipped.some(k => k.name === d.name && k.reason === d.reason)).map(d => d.reason) };
			} catch (e) { outcome = { read: "error", code: e instanceof zip.ZipReadError ? e.code : String(e) }; }
			const exp = want.read === "error" ? { read: "error", code: want.code } : { read: "ok", notes: 0, skipped: want.skipped, ignored: want.ignored };
			r.check(`hostile ${file} (${want.why}): refused for the right reason`, outcome, exp);
			for (const via of ["folder", "into-folder"]) {
				await withWorld(async (w) => {
					mkdirSync(w.abs("Existing"));
					writeFileSync(w.abs("Existing/mine.md"), "mine");
					const before = snapshot(w.base);
					if (via === "folder") await importer.importArchiveAsFolder(w.ctx, {}, [], { name: file, bytes }, () => {});
					else await importer.importFileIntoFolder("Existing", { name: file, bytes }, () => {});
					r.check(`hostile ${file} via ${via}: nothing written anywhere (vault, canary, outside)`, snapshot(w.base), before);
					r.check(`hostile ${file} via ${via}: the user got a message`, w.notices.length > 0, true);
				});
			}
		}

		/* ── 4. A path too long for Windows: refused BEFORE any write, naming the file ── */
		await withWorld(async (w) => {
			const deep = Array.from({ length: 8 }, (_, i) => `niveau-${i}-${"x".repeat(24)}`).join("/");
			mkdirSync(w.abs(deep), { recursive: true });
			const before = snapshot(w.base);
			await importer.importFileIntoFolder(deep, { name: "g.zip", bytes: read("golden", "windows-explorer.zip") }, () => {});
			r.check("a target path over 240 characters: nothing written, the message names a file", [snapshot(w.base), w.notices.length === 1 && /too long/.test(w.notices[0])], [before, true]);
		});

		await withWorld(async (w) => {
			const deep = Array.from({ length: 8 }, (_, i) => `niveau-${i}-${"x".repeat(24)}`).join("/");
			mkdirSync(w.abs(deep), { recursive: true });
			w.host.paths.contractPath = () => deep;
			const before = snapshot(w.base);
			await importer.importArchiveAsFolder(w.ctx, {}, [], { name: "g.zip", bytes: read("golden", "windows-explorer.zip") }, () => {});
			r.check("a NEW folder under a deep parent: path over 240 characters refused before the folder is even created", [snapshot(w.base), w.notices.length === 1 && /too long/.test(w.notices[0])], [before, true]);
		});

		await withWorld(async (w) => {
			await importer.importArchiveAsFolder(w.ctx, {}, [], { name: "__proto__.zip", bytes: read("golden", "windows-explorer.zip") }, () => {});
			const o = w.ctx.settings.quizzesModuleOverrides;
			r.check("a folder named __proto__ is imported as \"Import\", stored as an own setting, with no prototype touched",
				[Object.keys(o), o.Import?.path, Object.getPrototypeOf({}) === Object.prototype, Object.prototype.hasOwnProperty.call(Object.prototype, "path")], [["Import"], "Import", true, false]);
		});

		/* ── 5. ROUND TRIP: a realistic folder, exported then imported ── */
		const noteRoot = "# Intro 🎓 à l'écosystème\n\n![[schéma.png|200]]\n\n" + fence("CM1");
		const noteTd = "# TD évalué\r\n\r\n![[schéma.png]]\r\n\r\n" + fence("TD");
		const noteSem = "# Semaine 2\n\n" + fence("CM1 bis");
		const noteEmoji = "# CM2 🎓\n\n![](img/photo%201.jpg)\n\n" + fence("CM2");
		const noteNfd = "# Café\n\n" + fence("Café");
		const noteImg = "# Avec image\n\n```quiz-blocks\n[{ title: 'Image', prompt: 'Que montre ![[schéma.png|300]] ?', options: ['Un schéma', 'Rien'], correctIndex: 0 }]\n```\n";
		const SCHEMA = fakePng(11, 4000);
		const PHOTO = fakePng(12, 7000);
		const seed = (w) => {
			const put = (p, c) => { mkdirSync(dirname(w.abs(p)), { recursive: true }); writeFileSync(w.abs(p), c); };
			put("Cours C/CM1 - Intro.md", noteRoot);
			put("Cours C/TD é.md", noteTd);
			put("Cours C/Semaine 2/CM1 - Intro.md", noteSem);
			put("Cours C/Semaine 2/CM2 🎓.md", noteEmoji);
			put("Cours C/Café NFD.md", noteNfd);
			put("Cours C/schéma.png", SCHEMA);
			put("Cours C/Semaine 2/img/photo 1.jpg", PHOTO);
			put("Cours C/Avec image.md", noteImg);
			put("Cours C/not shared.png", fakePng(13));
			put("Cours C/cours.pdf", "%PDF-1.4");
		};
		const quizEntry = (path, title) => ({ path, title, basename: title });
		const QUIZZES = [
			quizEntry("Cours C/CM1 - Intro.md", "CM1 - Intro"),
			quizEntry("Cours C/TD é.md", "TD é"),
			quizEntry("Cours C/Semaine 2/CM1 - Intro.md", "CM1 - Intro"),
			quizEntry("Cours C/Semaine 2/CM2 🎓.md", "CM2 🎓"),
			quizEntry("Cours C/Café NFD.md", "Café NFD"),
		];
		const SOURCES = { "CM1 - Intro.md": noteRoot, "TD é.md": noteTd, "Semaine 2/CM1 - Intro.md": noteSem, "Semaine 2/CM2 🎓.md": noteEmoji, "Café NFD.md": noteNfd };
		const wantFolder = { ...Object.fromEntries(Object.entries(SOURCES).map(([n, c]) => [n, sha(Buffer.from(c, "utf8"))])), "schéma.png": sha(SCHEMA), "Semaine 2/img/photo 1.jpg": sha(PHOTO) };

		await withWorld(async (w) => {
			seed(w);
			const shared = await partage.construire({ group: { name: "Cours C", quizzes: QUIZZES } });
			r.check("export of a whole folder: a .zip named after the folder, nothing left out", [shared?.nom, shared?.imagesLaissees], ["Cours C.zip", 0]);
			const names = (await zip.readZip(shared.octets)).files.map(f => f.name);
			r.check("the exported archive: the manifest FIRST, then NFC paths relative to the folder (sub-folders kept), notes then images", names, ["neo-quiz.json", "CM1 - Intro.md", "TD é.md", "Semaine 2/CM1 - Intro.md", "Semaine 2/CM2 🎓.md", "Café NFD.md", "schéma.png", "Semaine 2/img/photo 1.jpg"]);
			const w2 = makeWorld();
			hostMod.installHost(w2.host);
			try {
				await importer.importArchiveAsFolder(w2.ctx, {}, [], { name: shared.nom, bytes: shared.octets }, () => {});
				r.check("ROUND TRIP, whole folder: every note and image comes back byte for byte (CRLF, emoji, accents, NFD name)", listFiles(join(w2.root, "Cours C")), srt(wantFolder));
				r.check("the round trip said nothing was left out", w2.notices.filter(n => /not imported|left out/.test(n)), []);
			} finally { hostMod.uninstallHost(); w2.close(); hostMod.installHost(w.host); }
		});

		await withWorld(async (w) => {
			seed(w);
			const three = [QUIZZES[0], QUIZZES[3], QUIZZES[4]];
			const shared = await partage.construire({ group: { name: "Sélection", quizzes: three } });
			const w2 = makeWorld();
			hostMod.installHost(w2.host);
			try {
				await importer.importArchiveAsFolder(w2.ctx, {}, [], { name: shared.nom, bytes: shared.octets }, () => {});
				r.check("ROUND TRIP, a selection of three: only those notes and the images THEY cite", listFiles(join(w2.root, "Sélection")), srt({
					"CM1 - Intro.md": wantFolder["CM1 - Intro.md"], "Semaine 2/CM2 🎓.md": wantFolder["Semaine 2/CM2 🎓.md"], "Café NFD.md": wantFolder["Café NFD.md"],
					"schéma.png": wantFolder["schéma.png"], "Semaine 2/img/photo 1.jpg": wantFolder["Semaine 2/img/photo 1.jpg"],
				}));
			} finally { hostMod.uninstallHost(); w2.close(); hostMod.installHost(w.host); }
		});

		await withWorld(async (w) => {
			seed(w);
			// One quiz, no image: a .md that is the WHOLE NOTE, byte for byte, read back identically.
			const one = await partage.construire({ quiz: QUIZZES[4] });
			const whole = Buffer.from(noteNfd, "utf8");
			r.check("one quiz without images: a .md that is the whole note, as it is on disk", [one.nom, Buffer.from(one.octets).equals(whole)], ["Café NFD.md", true]);
			mkdirSync(w.abs("Reçus"));
			await importer.importFileIntoFolder("Reçus", { name: one.nom, bytes: one.octets }, () => {});
			r.check("ROUND TRIP, one quiz: imported under its name, the whole note byte for byte", listFiles(w.abs("Reçus")), { "Café NFD.md": sha(whole) });
			// One quiz that embeds an image: a .zip with them.
			const withImg = await partage.construire({ quiz: quizEntry("Cours C/Avec image.md", "Avec image") });
			r.check("one quiz whose note embeds an image: a .zip", withImg.nom, "Avec image.zip");
			mkdirSync(w.abs("Reçus 2"));
			await importer.importFileIntoFolder("Reçus 2", { name: withImg.nom, bytes: withImg.octets }, () => {});
			r.check("ROUND TRIP, one quiz with an image: the whole note and the image byte for byte", listFiles(w.abs("Reçus 2")), srt({ "Avec image.md": sha(Buffer.from(noteImg, "utf8")), "schéma.png": sha(SCHEMA) }));
		});

		/* A selection (the folder page's Ctrl+click) is `{ quizzes, name }`: the
		   whole notes, the images cited anywhere in them, kind "quizzes". */
		await withWorld(async (w) => {
			seed(w);
			const two = [QUIZZES[1], QUIZZES[4]];
			const shared = await partage.construire({ quizzes: two, name: "Cours C" });
			const read2 = await zip.readZip(shared.octets);
			const m = JSON.parse(new TextDecoder().decode(read2.files[0].bytes));
			r.check("a selection of two: one archive named after the folder, kind quizzes, the two whole notes", [shared.nom, m.kind, m.name, read2.files.slice(1).filter(f => f.name.endsWith(".md")).map(f => f.name)], ["Cours C.zip", "quizzes", "Cours C", ["TD é.md", "Café NFD.md"]]);
			r.check("a selection of two: the notes are the files themselves, byte for byte", read2.files.filter(f => f.name.endsWith(".md")).map(f => sha(f.bytes)), [sha(Buffer.from(noteTd, "utf8")), sha(Buffer.from(noteNfd, "utf8"))]);
			const solo = await partage.construire({ quizzes: [QUIZZES[4]], name: "Cours C" });
			r.check("a selection of ONE quiz is the same share as that quiz alone", [solo.nom, Buffer.from(solo.octets).equals(Buffer.from(noteNfd, "utf8"))], ["Café NFD.md", true]);
		});

		/* The exporter never ships a name the importer refuses (the drift this
		   check exists for): reserved names and case collisions. */
		await withWorld(async (w) => {
			const put = (p, c) => { mkdirSync(dirname(w.abs(p)), { recursive: true }); writeFileSync(w.abs(p), c); };
			put("D/CON.md", "# a\n\n" + fence("a"));
			put("D/nul.txt.md", "# b\n\n" + fence("b"));
			put("D/Sub/q.md", "# c\n\n" + fence("c"));
			put("D/q.MD", "# d\n\n" + fence("d"));
			put("D/aux.png", fakePng(5));
			put("D/e.md", "![[aux.png]]\n" + fence("e"));
			const shared = await partage.construire({ group: { name: "CON", quizzes: ["D/CON.md", "D/nul.txt.md", "D/Sub/q.md", "D/q.MD", "D/e.md"].map(p => quizEntry(p, "t")) } });
			r.check("a folder named CON, notes named CON and nul.txt, two q.md: an archive name the importer accepts", shared.nom, "CON_.zip");
			const w2 = makeWorld();
			hostMod.installHost(w2.host);
			try {
				await importer.importArchiveAsFolder(w2.ctx, {}, [], { name: shared.nom, bytes: shared.octets }, () => {});
				const got = Object.keys(listFiles(join(w2.root, "CON_"))).sort();
				r.check("round trip of hostile-looking names: renamed, none lost, the unusable image reported by the exporter", [got, shared.imagesLaissees], [["CON_.md", "Sub/q.md", "e.md", "nul_.txt.md", "q.md"], 1]);
			} finally { hostMod.uninstallHost(); w2.close(); hostMod.installHost(w.host); }
		});

		/* ── 5b. THE EXPORTED MANIFEST (format 1) ── */
		await withWorld(async (w) => {
			seed(w);
			const look = { name: "Cours C", color: "#4f8cff", icon: "book", ue: "UE 1" };
			const shared = await partage.construire({ group: { folder: "Cours C", ...look, quizzes: QUIZZES } });
			const read2 = await zip.readZip(shared.octets);
			const m = JSON.parse(new TextDecoder().decode(read2.files[0].bytes));
			r.check("manifest: format, version, kind, name and the folder's look", [m.format, m.version, m.kind, m.name, srt(m.folder)], ["neo-quiz-share", 1, "folder", "Cours C", srt(look)]);
			r.check("manifest: a creation date and an app version are recorded", [/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(m.created), typeof m.app], [true, "string"]);
			r.check("manifest: every file listed with its real size and SHA-256 (and nothing else)",
				m.files.map(f => [f.path, f.size, f.sha256]), read2.files.slice(1).map(f => [f.name, f.bytes.length, sha(f.bytes)]));
			r.check("manifest: images are marked as images, notes as notes", [m.files.filter(f => f.kind === "image").length, m.files.filter(f => f.kind === "note").length], [2, 5]);

			// The look of the folder travels, and applies to a NEW folder only.
			const w2 = makeWorld();
			hostMod.installHost(w2.host);
			try {
				w2.ctx.settings.quizzesModuleOverrides = { "Cours C": { color: "#111111" } };
				await importer.importArchiveAsFolder(w2.ctx, {}, [], { name: shared.nom, bytes: shared.octets }, () => {});
				r.check("a NEW folder takes the archive's look (a setting already stored under that name is kept)", w2.ctx.settings.quizzesModuleOverrides["Cours C"], { color: "#111111", icon: "book", ue: "UE 1", name: "Cours C", path: "Cours C" });
				await importer.importArchiveAsFolder(w2.ctx, {}, [], { name: shared.nom, bytes: shared.octets }, () => {});
				r.check("a second import makes 'Cours C (2)' with the look, the first folder's settings untouched",
					[w2.ctx.settings.quizzesModuleOverrides["Cours C (2)"], w2.ctx.settings.quizzesModuleOverrides["Cours C"].color], [{ color: "#4f8cff", icon: "book", ue: "UE 1", name: "Cours C (2)", path: "Cours C (2)" }, "#111111"]);
			} finally { hostMod.uninstallHost(); w2.close(); hostMod.installHost(w.host); }
		});

		/* A quiz alone also takes the images cited in the BODY of its note. */
		await withWorld(async (w) => {
			const put = (p, c) => { mkdirSync(dirname(w.abs(p)), { recursive: true }); writeFileSync(w.abs(p), c); };
			put("Q/corps.md", "# Titre\n\n![[corps.png]]\n\n![](img/Dessin.PNG)\n\n" + fence("Corps"));
			put("Q/corps.png", fakePng(21));
			put("Q/img/Dessin.PNG", fakePng(22));
			const one = await partage.construire({ quiz: quizEntry("Q/corps.md", "Corps") });
			const got = (await zip.readZip(one.octets)).files.map(f => f.name);
			r.check("one quiz: images cited in the BODY of the note travel too (paths relative to the note, extension as written)", [one.nom, got], ["Corps.zip", ["neo-quiz.json", "Corps.md", "corps.png", "img/Dessin.PNG"]]);
			const m = JSON.parse(new TextDecoder().decode((await zip.readZip(one.octets)).files[0].bytes));
			r.check("a quiz archive is of kind 'quizzes'", m.kind, "quizzes");
		});

		/* ── 5c. IMPORT INTO AN EXISTING FOLDER ── */
		const V1 = read("golden", "v1-folder.zip");
		const NOTE_C_DIFFERENT = "# autre\n" + fence("Mon propre quiz");
		await withWorld(async (w) => {
			const put = (p, c) => { mkdirSync(dirname(w.abs(p)), { recursive: true }); writeFileSync(w.abs(p), c); };
			put("Mes quiz/CM1 - Intro.md", noteA);            // identical to the archive's: not duplicated
			put("Mes quiz/Semaine 2/q1.md", NOTE_C_DIFFERENT); // same name, different content: the new one is renamed
			put("Mes quiz/schéma.png", fakePng(99));          // same image name, different bytes: mine stays
			put("Mes quiz/perso.md", "perso");
			const before = listFiles(w.abs("Mes quiz"));
			await importer.importFileIntoFolder("Mes quiz", { name: "v1-folder.zip", bytes: V1 }, () => {});
			const after = listFiles(w.abs("Mes quiz"));
			r.check("into an existing folder: nothing of mine is overwritten (same bytes at every old path)", Object.entries(before).filter(([p, h]) => after[p] !== h), []);
			r.check("into an existing folder: only the genuinely new files appear (a different homonym becomes 'q1 (2)', the identical quiz is not duplicated, my image keeps its name)",
				Object.keys(after).filter(p => !(p in before)).sort(), ["Semaine 2/img/figure.PNG", "Semaine 2/q1 (2).md"]);
			r.check("the renamed quiz holds the archive's bytes", after["Semaine 2/q1 (2).md"], sha(Buffer.from(noteC, "utf8")));
			const said = w.notices.join(" | ");
			r.check("the summary says what was added, ignored (identical) and renamed, and what was left out",
				[/1 quiz and 1 image added/.test(said), /1 already in the folder/.test(said), /renamed/.test(said) && /q1 \(2\)\.md/.test(said), /schéma\.png \(a different image/.test(said)], [true, true, true, true]);
			r.check("no staging folder remains, and the host's trash holds no file", [readdirSync(w.root).filter(n => n.startsWith(".import-")), snapshot(w.base).filter(x => x.includes(".trash/") && !x.endsWith("/"))], [[], []]);

			// The same archive again: nothing to add, nothing written, and it says so.
			w.notices.length = 0;
			await importer.importFileIntoFolder("Mes quiz", { name: "v1-folder.zip", bytes: V1 }, () => {});
			r.check("importing the same archive twice writes nothing", listFiles(w.abs("Mes quiz")), after);
			r.check("... and the user is told that everything is already there or kept", w.notices.some(n => /already in the folder|not imported/.test(n)), true);
		});

		/* A quiz (.md) into a folder: identical = skipped, different = renamed. */
		await withWorld(async (w) => {
			mkdirSync(w.abs("D"));
			const md = (t) => new TextEncoder().encode(t);
			await importer.importFileIntoFolder("D", { name: "Quiz.md", bytes: md(noteC) }, () => {});
			await importer.importFileIntoFolder("D", { name: "Quiz.md", bytes: md(noteC) }, () => {});
			r.check("a .md imported twice is not duplicated", Object.keys(listFiles(w.abs("D"))), ["Quiz.md"]);
			await importer.importFileIntoFolder("D", { name: "Quiz.md", bytes: md(noteC + "\n<!-- v2 -->\n") }, () => {});
			await importer.importFileIntoFolder("D", { name: "Quiz.md", bytes: md(noteC + "\n<!-- v2 -->\n") }, () => {});
			r.check("a different quiz with the same name becomes 'Quiz (2)', and re-importing that version finds it (no 'Quiz (3)')", Object.keys(listFiles(w.abs("D"))).sort(), ["Quiz (2).md", "Quiz.md"]);
			await importer.importFileIntoFolder("D", { name: "Notes.md", bytes: md("no quiz here") }, () => {});
			r.check("a .md without a quiz block is refused with a message and written nowhere", [Object.keys(listFiles(w.abs("D"))).length, w.notices.at(-1)], [2, "No quiz found in this file"]);
			await importer.importFileIntoFolder("D", { name: "QUIZ.MD", bytes: md(noteA) }, () => {});
			r.check("on a case-insensitive disk 'QUIZ.MD' and the existing 'Quiz.md' are the SAME name: the newcomer takes the next free one", Object.keys(listFiles(w.abs("D"))).sort(), ["QUIZ (3).md", "Quiz (2).md", "Quiz.md"]);
		});

		/* ── 5d. THE PLAN, PURE: collisions, case, sub-folders ── */
		{
			const enc2 = new TextEncoder();
			const pf = async (name, text) => { const bytes = typeof text === "string" ? enc2.encode(text) : text; return { name, bytes, sha256: await manifest.sha256Hex(bytes) }; };
			const input = async (files, existing = new Map(), extra = {}) => ({ files, skipped: [], junk: 0, quizOnly: false, existing, fallbackName: "Imp", ...extra });
			const a = await pf("A.md", noteA); const c = await pf("a.md", noteC); const a2 = await pf("sub/A.md", noteA);
			const plan1 = planner.planImport(await input([a, c, a2]));
			r.check("plan: two notes whose names differ only by case are two names; the same note in a sub-folder is another path",
				[plan1.writes.map(x => x.path), plan1.renamed], [["A.md", "a (2).md", "sub/A.md"], [{ from: "a.md", to: "a (2).md" }]]);
			const plan2 = planner.planImport(await input([a, await pf("A.md", noteA)]));
			r.check("plan: the same note twice in one archive is written once", [plan2.writes.length, plan2.duplicates], [1, ["A.md"]]);
			const existing = new Map([[planner.foldPath("A.md"), a.sha256], [planner.foldPath("img"), planner.DIRECTORY]]);
			existing.set(planner.foldPath("img.md"), planner.DIRECTORY);
			const plan3 = planner.planImport(await input([a, await pf("img.md", noteC)], existing));
			r.check("plan: a name taken by a folder is never written over", [plan3.writes.map(x => x.path), plan3.duplicates], [["img (2).md"], ["A.md"]]);
			const imgA = await pf("Photo.PNG", fakePng(1)); const imgB = await pf("photo.png", fakePng(2));
			const plan4 = planner.planImport(await input([imgA, imgB]));
			r.check("plan: an image keeps its extension as written; a different image with the same name (any case) is NOT imported",
				[plan4.writes.map(x => x.path), plan4.discarded], [["Photo.PNG"], [{ name: "photo.png", reason: "duplicate-image" }]]);
			const plan5 = planner.planImport(await input([await pf("W/N1.md", noteA), await pf("W/N2.md", noteC), await pf("W/img/x.png", fakePng(3))]));
			r.check("plan: a single wrapping root folder is removed, the sub-folders below it are kept", plan5.writes.map(x => x.path), ["N1.md", "N2.md", "img/x.png"]);
			const plan6 = planner.planImport(await input([await pf("N1.md", noteA), await pf("D/N2.md", noteC)]));
			r.check("plan: no wrapper to remove when a note sits at the root", plan6.writes.map(x => x.path), ["N1.md", "D/N2.md"]);
			const plan7 = planner.planImport(await input([await pf("CON/x.md", noteA), await pf("ok/..x/y.md", noteA), await pf("fine/z.md", noteA)]));
			r.check("plan: a device-named folder in a path is refused as a bad name, never written", plan7.discarded.map(d => d.reason), ["bad-name"]);
			const bom = enc2.encode("\ufeff# bom\r\n" + fence("b"));
			const plan8 = planner.planImport(await input([await pf("b.md", bom)]));
			r.check("plan: a note's bytes (BOM, CRLF) are carried untouched", Buffer.from(plan8.writes[0].bytes).equals(Buffer.from(bom)), true);
		}

		/* ── 5e. A FAILURE AT THE k-TH WRITE LEAVES NOTHING ── */
		const visible = (arr) => arr.filter(x => !x.startsWith("vault/.trash/") && x !== "vault/.trash/");
		for (const [label, run, seedFn] of [
			["new folder", (w) => importer.importArchiveAsFolder(w.ctx, {}, [], { name: "Cours C.zip", bytes: V1 }, () => {}), () => {}],
			["existing folder", (w) => importer.importFileIntoFolder("Mes quiz", { name: "v1-folder.zip", bytes: V1 }, () => {}), (w) => { mkdirSync(w.abs("Mes quiz")); writeFileSync(w.abs("Mes quiz/perso.md"), "perso"); }],
		]) {
			const probe = makeWorld();
			hostMod.installHost(probe.host);
			let total = 0;
			try { seedFn(probe); await run(probe); total = probe.world.writes; } finally { hostMod.uninstallHost(); probe.close(); }
			const results = [];
			for (let k = 1; k <= total; k++) {
				await withWorld(async (w) => {
					seedFn(w);
					const before = visible(snapshot(w.base));
					w.world.failAt = k;
					await run(w);
					const after = visible(snapshot(w.base));
					const trashFiles = snapshot(w.base).filter(x => x.startsWith("vault/.trash/") && !x.endsWith("/"));
					if (JSON.stringify(after) !== JSON.stringify(before) || trashFiles.length || !w.notices.some(n => /import failed/.test(n))) results.push(k);
				});
			}
			r.check(`failure injected at each of the ${total} writes (${label}): the tree is exactly as before, nothing in the trash but empty folders, and the user is told`, [total > 3, results], [true, []]);
		}
		for (const [label, run, seedFn] of [
			["new folder", (w) => importer.importArchiveAsFolder(w.ctx, {}, [], { name: "Cours C.zip", bytes: V1 }, () => {}), () => {}],
			["existing folder", (w) => importer.importFileIntoFolder("Mes quiz", { name: "v1-folder.zip", bytes: V1 }, () => {}), (w) => { mkdirSync(w.abs("Mes quiz")); writeFileSync(w.abs("Mes quiz/perso.md"), "perso"); }],
		]) {
			const results = [];
			for (const k of [1, 2, 3]) {
				await withWorld(async (w) => {
					seedFn(w);
					const before = visible(snapshot(w.base));
					w.world.renameFailAt = k;
					await run(w);
					if (w.world.renames < k) return; // fewer renames than k (the new-folder case has one)
					const after = visible(snapshot(w.base));
					if (JSON.stringify(after) !== JSON.stringify(before)) results.push(k);
				});
			}
			r.check(`failure injected at the k-th rename (${label}): files already moved are taken out again`, results, []);
		}

		/* ── 6. FUZZ (fixed seed): flipped bytes never crash, never write ── */
		let s = 0x2545f491;
		const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
		let untyped = 0;
		const wrote = [];
		for (const file of ["app-export-folder.zip", "windows-explorer.zip", "macos-finder.zip", "zip64.zip"]) {
			const orig = read("golden", file);
			for (let i = 0; i < 60; i++) {
				const b = orig.slice();
				for (let k = 0; k < 1 + Math.floor(rnd() * 4); k++) b[Math.floor(rnd() * b.length)] ^= 1 << Math.floor(rnd() * 8);
				try { await zip.readZip(b); } catch (e) { if (!(e instanceof zip.ZipReadError)) untyped++; }
			}
			await withWorld(async (w) => {
				const before = snapshot(w.base);
				for (let i = 0; i < 15; i++) {
					const b = orig.slice();
					b[Math.floor(rnd() * b.length)] ^= 1 << Math.floor(rnd() * 8);
					await importer.importFileIntoFolder("Existing-not-there", { name: "f.zip", bytes: b }, () => {}).catch(() => {});
				}
				const after = snapshot(w.base).filter(x => !before.includes(x));
				// The only residue allowed: an EMPTY set-aside staging folder in the host's trash.
				if (after.some(x => !x.startsWith("vault/Existing-not-there") && !(x.startsWith("vault/.trash/") && x.endsWith("/")) && x !== "vault/.trash/")) wrote.push(file);
			});
		}
		r.check("fuzz: flipped bytes only ever raise the typed error", untyped, 0);
		r.check("fuzz: flipped bytes never write outside the target folder", wrote, []);
		r.done();
	},
);

/* A folder another Android app hands over ("Open with", "Share to") is imported
   with the SHELL's own settings (2026-10-08). A throwaway `{ settings: {} }`
   there dropped the folder's name, colour, icon and unit from the manifest, and
   never declared the folder, although the same archive imported from the
   "Import" button kept them. */
{
	const r = makeReporter("Received file (Android): the shell's settings");
	const src = readFileSync(join(HERE, "..", "apps", "windows", "src", "ui", "fichier-recu.ts"), "utf8");
	r.check("the import writes through the shell's settings, not a throwaway object",
		[/reglagesDeLaCoquille\(\)/.test(src), /settings:\s*\{\s*\}/.test(src), /saveSettings:\s*async\s*\(\)\s*=>\s*\{\s*\}/.test(src)],
		[true, false, false]);
	r.done();
}
