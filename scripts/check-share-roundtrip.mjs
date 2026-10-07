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
 * The filesystem is a REAL temporary folder (NTFS on Windows: case-insensitive,
 * so a collision is real), laid out as `base/vault` (the "vault"), `base/canary`
 * and `base/outside`; a hostile import is judged on a snapshot of the WHOLE
 * `base`, so a write one level up is caught too.
 *
 *     npm run check:share-roundtrip
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";
import { buildFixtures, expectedJson, fakePng, fence, sha256 } from "./fixtures/share/generate.mjs";

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
const MIN_GOLDEN = 10;
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
	const abs = (p) => resolve(root, p); // NOT guarded: a path that climbs really climbs
	const host = {
		fs: {
			exists: async (p) => existsSync(abs(p)),
			read: async (p) => readFileSync(abs(p), "utf8"),
			readBinary: async (p) => new Uint8Array(readFileSync(abs(p))),
			write: async (p, c) => { writeFileSync(abs(p), c, "utf8"); },
			writeBinary: async (p, b) => { writeFileSync(abs(p), b); },
			mkdirs: async (p) => { mkdirSync(abs(p), { recursive: true }); },
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
	return { base, root, notices, host, ctx, abs, close: () => rmSync(base, { recursive: true, force: true }) };
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
const listFiles = (dir) => srt(Object.fromEntries(readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => [e.name.normalize("NFC"), sha(readFileSync(join(dir, e.name)))])));

await withSrcModule(
	["apps/windows/src/ui/partage.ts", "src/dashboard/folder-create.ts", "src/dashboard/zip.ts", "src/host/current.ts"],
	async (partage, importer, zip, hostMod) => {
		const r = makeReporter("Sharing end to end - round trip, golden and hostile archives");
		const withWorld = async (fn) => {
			const w = makeWorld();
			hostMod.installHost(w.host);
			try { return await fn(w); } finally { hostMod.uninstallHost(); w.close(); }
		};
		const read = (kind, file) => new Uint8Array(readFileSync(join(FIX, kind, file)));

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
			const read1 = await zip.readZip(bytes);
			const cls = zip.classerArchive(read1.files);
			r.check(`golden ${file}: read with nothing skipped, junk and ignored as expected`, [read1.skipped.map(x => x.reason), read1.junk + cls.junk, cls.ignored.map(x => x.reason)], [want.skipped, want.junk, want.ignored]);
			await withWorld(async (w) => {
				await importer.importArchiveAsFolder(w.ctx, {}, [], { name: file, bytes }, () => {});
				const folder = join(w.root, want.folder);
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
				const res = await zip.readZip(bytes);
				const cls = zip.classerArchive(res.files);
				outcome = { read: "ok", notes: cls.notes.length, skipped: res.skipped.map(x => x.reason), ignored: cls.ignored.map(x => x.reason) };
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
		const SOURCES = { "CM1 - Intro.md": noteRoot, "TD é.md": noteTd, "CM1 - Intro (2).md": noteSem, "CM2 🎓.md": noteEmoji, "Café NFD.md": noteNfd };
		const wantFolder = { ...Object.fromEntries(Object.entries(SOURCES).map(([n, c]) => [n, sha(Buffer.from(c, "utf8"))])), "schéma.png": sha(SCHEMA), "photo 1.jpg": sha(PHOTO) };

		await withWorld(async (w) => {
			seed(w);
			const shared = await partage.construire({ group: { name: "Cours C", quizzes: QUIZZES } });
			r.check("export of a whole folder: a .zip named after the folder, nothing left out", [shared?.nom, shared?.imagesLaissees], ["Cours C.zip", 0]);
			const names = (await zip.readZip(shared.octets)).files.map(f => f.name);
			r.check("the exported archive holds NFC names, unique case-insensitively, notes then images", names, ["CM1 - Intro.md", "TD é.md", "CM1 - Intro (2).md", "CM2 🎓.md", "Café NFD.md", "schéma.png", "photo 1.jpg"]);
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
					"CM1 - Intro.md": wantFolder["CM1 - Intro.md"], "CM2 🎓.md": wantFolder["CM2 🎓.md"], "Café NFD.md": wantFolder["Café NFD.md"],
					"schéma.png": wantFolder["schéma.png"], "photo 1.jpg": wantFolder["photo 1.jpg"],
				}));
			} finally { hostMod.uninstallHost(); w2.close(); hostMod.installHost(w.host); }
		});

		await withWorld(async (w) => {
			seed(w);
			// One quiz, no image: a .md holding only the block (LF), read back identically.
			const one = await partage.construire({ quiz: QUIZZES[4] });
			const block = noteNfd.match(/```quiz-blocks[\s\S]*?```/)[0] + "\n";
			r.check("one quiz without images: a .md of its block", [one.nom, Buffer.from(one.octets).toString("utf8")], ["Café NFD.md", block]);
			mkdirSync(w.abs("Reçus"));
			await importer.importFileIntoFolder("Reçus", { name: one.nom, bytes: one.octets }, () => {});
			r.check("ROUND TRIP, one quiz: imported under its name, block byte for byte", listFiles(w.abs("Reçus")), { "Café NFD.md": sha(Buffer.from(block, "utf8")) });
			// One quiz that embeds an image: a .zip with it.
			const withImg = await partage.construire({ quiz: quizEntry("Cours C/Avec image.md", "Avec image") });
			r.check("one quiz whose block embeds an image: a .zip", withImg.nom, "Avec image.zip");
			mkdirSync(w.abs("Reçus 2"));
			await importer.importFileIntoFolder("Reçus 2", { name: withImg.nom, bytes: withImg.octets }, () => {});
			const blockImg = noteImg.match(/```quiz-blocks[\s\S]*?```/)[0] + "\n";
			r.check("ROUND TRIP, one quiz with an image: block and image byte for byte", listFiles(w.abs("Reçus 2")), srt({ "Avec image.md": sha(Buffer.from(blockImg, "utf8")), "schéma.png": sha(SCHEMA) }));
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
				r.check("round trip of hostile-looking names: renamed, none lost, the unusable image reported by the exporter", [got, shared.imagesLaissees], [["CON_.md", "e.md", "nul_.txt.md", "q (2).md", "q.md"], 1]);
			} finally { hostMod.uninstallHost(); w2.close(); hostMod.installHost(w.host); }
		});

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
				if (after.some(x => !x.startsWith("vault/Existing-not-there"))) wrote.push(file);
			});
		}
		r.check("fuzz: flipped bytes only ever raise the typed error", untyped, 0);
		r.check("fuzz: flipped bytes never write outside the target folder", wrote, []);
		r.done();
	},
);
