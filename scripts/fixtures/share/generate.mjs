/**
 * THE SHARE FIXTURES GENERATOR (2026-10-07).
 *
 * Builds, deterministically, every archive of `golden/` and `hostile/` plus
 * `expected.json`, so no archive in the repository is a mystery binary: the
 * generator is committed, the archives it makes are committed, and
 * `npm run check:share-roundtrip` pins their SHA-256.
 *
 *   node scripts/fixtures/share/generate.mjs        (writes the files)
 *
 * GOLDEN archives are ones the import must read: what the app itself exports,
 * and what other tools (Windows "Compressed folder", macOS Finder, 7-Zip, a
 * legacy DOS-era tool, a zip64 writer) make. They are IMITATIONS of those
 * tools' documented layouts, written by `scripts/lib/zip-forge.mjs`, not
 * files captured from the real tools. HOSTILE archives are ones the import
 * must refuse (or read as empty) without writing anything.
 *
 * The list of golden archives only ever GROWS: never edit or remove one, add
 * a new file (the check pins each hash). deflate output depends on the zlib
 * build, so `expected.json` records the zlib version that made the bytes.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withSrcModule } from "../../lib/load-src.mjs";
import { forgeZip, unicodePathExtra } from "../../lib/zip-forge.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const enc = new TextEncoder();
export const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** A quiz note: a heading and one valid `quiz-blocks` fence. */
export const fence = (title) => "```quiz-blocks\n[{ title: '" + title + "', prompt: 'Quelle est la capitale de la France ?', options: ['Paris', 'Lyon'], correctIndex: 0 }]\n```\n";
export const noteA = "# Introduction \u00e0 l'\u00e9cosyst\u00e8me\n\n" + fence("CM1 \u00c9cosyst\u00e8me");
export const noteB = "# TD \u00e9valu\u00e9\r\n\r\nVoir ![[sch\u00e9ma.png]]\r\n\r\n" + fence("TD");
export const noteC = "# Chapitre 2\n\n" + fence("Chapitre 2");

/** Deterministic pseudo-image: a PNG signature and seeded noise. */
export function fakePng(seed, length = 600) {
	const out = new Uint8Array(length);
	out.set([137, 80, 78, 71, 13, 10, 26, 10]);
	let x = seed >>> 0;
	for (let i = 8; i < length; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; out[i] = x >>> 24; }
	return out;
}
const IMG = fakePng(1);
const IMG2 = fakePng(2, 900);

const nfd = (s) => s.normalize("NFD");

export async function buildFixtures() {
	const golden = {};
	const hostile = {};
	const g = (file, bytes, expect) => { golden[file] = { bytes, expect }; };
	const h = (file, bytes, why, outcome) => { hostile[file] = { bytes, why, outcome }; };
	const files = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sha256(typeof v === "string" ? enc.encode(v) : v)]));

	// 1. What the app itself exports today: the REAL packer and the REAL writer.
	let appExport;
	await withSrcModule("src/dashboard/share-pack.ts", ({ packShare }) => {
		appExport = packShare(
			[{ name: "CM1 - Intro.md", content: noteA }, { name: "TD \u00e9.md", content: noteB }],
			[{ name: "sch\u00e9ma.png", bytes: IMG }],
			new Date(2026, 9, 7, 12, 0, 0),
		).bytes;
	});
	g("app-export-folder.zip", appExport, { folder: "app-export-folder", files: files({ "CM1 - Intro.md": noteA, "TD \u00e9.md": noteB, "sch\u00e9ma.png": IMG }), junk: 0, skipped: [], ignored: [] });

	// 2. The oldest layout: our store-only writer without a date (before 2026-10-02).
	let v0;
	await withSrcModule("src/dashboard/zip.ts", ({ buildZip }) => { v0 = buildZip([{ name: "Quiz A.md", content: noteC }]); });
	g("v0-store-notes-only.zip", v0, { folder: "v0-store-notes-only", files: files({ "Quiz A.md": noteC }), junk: 0, skipped: [], ignored: [] });

	// 3. Windows Explorer "Compressed (zipped) folder": a root folder, deflate, UTF-8 flag.
	g("windows-explorer.zip", forgeZip([
		{ name: "Cours C/", bytes: "", method: 0 },
		{ name: "Cours C/CM1 - Intro.md", bytes: noteA, flags: 0x800 },
		{ name: "Cours C/TD \u00e9.md", bytes: noteB, flags: 0x800 },
		{ name: "Cours C/sch\u00e9ma.png", bytes: IMG, flags: 0x800 },
	]), { folder: "windows-explorer", files: files({ "CM1 - Intro.md": noteA, "TD \u00e9.md": noteB, "sch\u00e9ma.png": IMG }), junk: 0, skipped: [], ignored: [] });

	// 4. macOS Finder: NFD names, __MACOSX and ._ litter, .DS_Store, unix attributes.
	const unixFile = { madeBy: (3 << 8) | 21, attrs: (0o100644 << 16) >>> 0, flags: 0x800 };
	g("macos-finder.zip", forgeZip([
		{ name: "Cours C/", bytes: "", method: 0, madeBy: (3 << 8) | 21, attrs: ((0o040755 << 16) | 0x10) >>> 0 },
		{ name: nfd("Cours C/Caf\u00e9.md"), bytes: noteA, ...unixFile },
		{ name: nfd("Cours C/sch\u00e9ma.png"), bytes: IMG, ...unixFile },
		{ name: nfd("__MACOSX/Cours C/._Caf\u00e9.md"), bytes: new Uint8Array([0, 5, 22, 7, 0, 2, 0, 0]), ...unixFile },
		{ name: "Cours C/.DS_Store", bytes: new Uint8Array([0, 0, 0, 1, 66, 117, 100, 49]), ...unixFile },
	]), { folder: "macos-finder", files: files({ "Caf\u00e9.md": noteA, "sch\u00e9ma.png": IMG }), junk: 2, skipped: [], ignored: [] });

	// 5. 7-Zip: no directory entries, deflate, UTF-8 flag, FAT host byte.
	g("7zip-deflate.zip", forgeZip([
		{ name: "CM1 - Intro.md", bytes: noteA, flags: 0x800, madeBy: 63 },
		{ name: "TD \u00e9.md", bytes: noteB, flags: 0x800, madeBy: 63 },
		{ name: "img/sch\u00e9ma.png", bytes: IMG, flags: 0x800, madeBy: 63 },
	]), { folder: "7zip-deflate", files: files({ "CM1 - Intro.md": noteA, "TD \u00e9.md": noteB, "sch\u00e9ma.png": IMG }), junk: 0, skipped: [], ignored: [] });

	// 6. A root folder with sub-folders; two notes share a file name.
	g("root-folder-subfolders.zip", forgeZip([
		{ name: "Mon cours/Semaine 1/q1.md", bytes: noteA, flags: 0x800 },
		{ name: "Mon cours/Semaine 2/q1.md", bytes: noteC, flags: 0x800 },
		{ name: "Mon cours/Semaine 2/figure.PNG", bytes: IMG2, flags: 0x800 },
		{ name: "Mon cours/Semaine 2/notes.pdf", bytes: "%PDF-1.4", flags: 0x800 },
	]), { folder: "root-folder-subfolders", files: files({ "q1.md": noteA, "q1 (2).md": noteC, "figure.png": IMG2 }), junk: 0, skipped: [], ignored: ["unsupported-type"] });

	// 7. NFD accents everywhere; the note cites the NFC name of the image.
	g("nfd-accents.zip", forgeZip([
		{ name: nfd("\u00e9l\u00e9phant.md"), bytes: "![[\u00e9l\u00e9phant.png]]\n" + fence("\u00c9l\u00e9phant"), flags: 0x800 },
		{ name: nfd("\u00e9l\u00e9phant.png"), bytes: IMG, flags: 0x800 },
	]), { folder: "nfd-accents", files: files({ "\u00e9l\u00e9phant.md": "![[\u00e9l\u00e9phant.png]]\n" + fence("\u00c9l\u00e9phant"), "\u00e9l\u00e9phant.png": IMG }), junk: 0, skipped: [], ignored: [] });

	// 8. A DOS-era tool: code page 437 names, no UTF-8 flag (0x82 = e acute).
	g("legacy-cp437.zip", forgeZip([
		{ nameBytes: Buffer.from([0x43, 0x61, 0x66, 0x82, 0x2e, 0x6d, 0x64]), bytes: noteA },
		{ nameBytes: Buffer.from([0x54, 0x44, 0x20, 0x8a, 0x2e, 0x6d, 0x64]), bytes: noteC },
	]), { folder: "legacy-cp437", files: files({ "Caf\u00e9.md": noteA, "TD \u00e8.md": noteC }), junk: 0, skipped: [], ignored: [] });

	// 9. The Info-ZIP Unicode Path field wins over a legacy stored name.
	const raw = Buffer.from([0x43, 0x82, 0x2e, 0x6d, 0x64]);
	const up = unicodePathExtra(raw, "C\u0153ur.md");
	g("unicode-path-extra.zip", forgeZip([{ nameBytes: raw, extra: up, localExtra: up, bytes: noteA }]), { folder: "unicode-path-extra", files: files({ "C\u0153ur.md": noteA }), junk: 0, skipped: [], ignored: [] });

	// 10. zip64 structures (end record, locator, extra fields).
	g("zip64.zip", forgeZip([
		{ name: "Big one.md", bytes: noteA, zip64: true, flags: 0x800 },
		{ name: "Other.md", bytes: noteC, flags: 0x800 },
	], { zip64End: true }), { folder: "zip64", files: files({ "Big one.md": noteA, "Other.md": noteC }), junk: 0, skipped: [], ignored: [] });

	// ── HOSTILE ──
	const good = { name: "ok.md", bytes: noteA };
	const slip = (file, name, why) => h(file, forgeZip([good, { name, bytes: noteC }]), why, { read: "error", code: "unsafe-path" });
	slip("slip-dotdot.zip", "../evil.md", "parent directory");
	slip("slip-dotdot-backslash.zip", "..\\..\\evil.md", "parent directory, Windows separators");
	slip("slip-nested.zip", "a/b/../../../evil.md", "a nested climb");
	slip("absolute-unix.zip", "/etc/evil.md", "absolute path");
	slip("absolute-backslash.zip", "\\evil.md", "absolute path, Windows separator");
	slip("drive-letter.zip", "C:/Users/evil.md", "drive letter path");
	slip("drive-relative.zip", "C:evil.md", "drive-relative path");
	slip("unc-share.zip", "\\\\server\\share\\evil.md", "UNC share");
	const empty = (file, entries, why, skipped, ignored = []) => h(file, forgeZip(entries), why, { read: "ok", notes: 0, skipped, ignored });
	empty("symlink-only.zip", [{ name: "link.md", bytes: "/etc/passwd", madeBy: (3 << 8) | 20, attrs: (0o120777 << 16) >>> 0 }], "a symbolic link entry", ["symlink"]);
	empty("bomb-ratio.zip", [{ name: "z.md", bytes: new Uint8Array(8 * 1024 * 1024) }], "8 MB of zeros in a few KB", ["ratio"]);
	empty("bomb-declared-size.zip", [{ name: "big.md", bytes: "x", size: 20 * 1024 * 1024 }], "declares 20 MB for one entry", ["too-big"]);
	empty("crc-wrong.zip", [{ name: "c.md", bytes: noteA, crc: 12345 }], "wrong checksum", ["bad-crc"]);
	empty("encrypted.zip", [{ name: "e.md", bytes: noteA, flags: 1 }], "encrypted entry", ["encrypted"]);
	empty("name-mismatch.zip", [{ name: "a.md", localNameBytes: Buffer.from("b.md"), bytes: noteA }], "local and central names differ", ["name-mismatch"]);
	empty("reserved-names.zip", [{ name: "con.md", bytes: noteA }, { name: "nul.txt.md", bytes: noteA }, { name: "COM1.md", bytes: noteA }, { name: "aux.png", bytes: IMG }], "Windows device names", [], ["bad-name", "bad-name", "bad-name", "bad-name"]);
	empty("svg-with-script.zip", [{ name: "x.svg", bytes: "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>" }], "an SVG carrying script", [], ["unsupported-type"]);
	empty("executables.zip", [{ name: "setup.exe", bytes: "MZ" }, { name: "x.md.exe", bytes: "MZ" }, { name: "run.bat", bytes: "echo hi" }, { name: "x.lnk", bytes: "L" }], "programs and shortcuts", [], ["unsupported-type", "unsupported-type", "unsupported-type", "unsupported-type"]);
	h("overlapping-entries.zip", forgeZip([good, { name: "b.md", bytes: noteA, noLocal: true, localOffsetOf: 0 }]), "two entries share the same bytes", { read: "error", code: "overlap" });
	h("too-many-entries.zip", forgeZip(Array.from({ length: 2001 }, (_, i) => ({ name: `n${i}.md`, bytes: "", method: 0 }))), "2001 entries", { read: "error", code: "too-many" });
	h("multi-disk.zip", forgeZip([good], { diskNumber: 1 }), "split archive", { read: "error", code: "multi-disk" });
	h("truncated.zip", golden["app-export-folder.zip"].bytes.slice(0, golden["app-export-folder.zip"].bytes.length - 40), "cut short", { read: "error", code: "invalid" });
	h("not-a-zip.zip", enc.encode("this is plain text pretending to be an archive, long enough to pass the size check"), "plain text", { read: "error", code: "invalid" });
	h("empty-file.zip", new Uint8Array(0), "zero bytes", { read: "error", code: "invalid" });

	return { golden, hostile };
}

export function expectedJson({ golden, hostile }) {
	return {
		note: "Generated by generate.mjs. Archives are never edited, only added.",
		zlib: process.versions.zlib,
		golden: Object.fromEntries(Object.entries(golden).map(([f, v]) => [f, { sha256: sha256(v.bytes), ...v.expect }])),
		hostile: Object.fromEntries(Object.entries(hostile).map(([f, v]) => [f, { sha256: sha256(v.bytes), why: v.why, ...v.outcome }])),
	};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const all = await buildFixtures();
	for (const [kind, set] of [["golden", all.golden], ["hostile", all.hostile]]) {
		mkdirSync(join(HERE, kind), { recursive: true });
		for (const [file, v] of Object.entries(set)) writeFileSync(join(HERE, kind, file), v.bytes);
	}
	writeFileSync(join(HERE, "expected.json"), JSON.stringify(expectedJson(all), null, "\t") + "\n");
	console.log(`wrote ${Object.keys(all.golden).length} golden and ${Object.keys(all.hostile).length} hostile archives`);
}
