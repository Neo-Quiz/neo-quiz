/**
 * THE ZIP READER of the main process (apps/windows/electron/python/
 * zip-lecture.ts), task 1 of docs/superpowers/plans/2026-10-22-native-python-run.md.
 * It unpacks the CPython embeddable zip and PyPI wheels, both deflated zips
 * that came over the network: once their hash matches a pin they are
 * trusted bytes, but the reader is written as if they were hostile, so a
 * wrong pin, or a pin computed on a bad file, still cannot write outside its
 * folder or fill the disk.
 *
 * WHAT THESE CASES PREVENT, which no typecheck sees:
 * - an entry named `../x`, `C:x`, `/x`, `a\..\x`, `a/b:c` (an NTFS stream),
 *   `con.py`, `a./x` (Windows drops the dot) becoming a path;
 * - a deflate stream longer (or shorter) than the size the central
 *   directory declares being accepted: the declared size is what the
 *   bounds were judged on;
 * - a bomb: too many entries, an inflated/stored ratio over the bound, a
 *   total over the bound, entries whose data overlap (one stream counted
 *   many times);
 * - two entries the case-insensitive Windows filesystem sees as one file
 *   (`a/B.py`, `a/b.py`), or a file that is also a folder (`a`, `a/b`);
 * - a truncated archive, a wrong CRC, an unknown method, an encrypted entry,
 *   zip64, a local header that names another file, read as if valid;
 * - `ecrireSous` writing ANY file of a list that holds one hostile name.
 *
 *     npm run check:python-zip
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";
import { forgeZip } from "./lib/zip-forge.mjs";

const r = makeReporter("Python zip reader");
const tmp = mkdtempSync(join(tmpdir(), "neo-python-zip-"));

const BORNES = { maxEntrees: 1000, maxOctets: 8 * 1024 * 1024, maxRatio: 100 };

/** Deterministic, barely compressible bytes (a linear congruential stream). */
function pseudoRandom(n, seed = 7) {
	const out = new Uint8Array(n);
	let x = seed;
	for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; out[i] = x >>> 24; }
	return out;
}
const sha = (b) => createHash("sha256").update(b).digest("hex");

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

try {
	await withSrcModule("apps/windows/electron/python/zip-lecture.ts", async ({ lireZip, ecrireSous, ErreurZip }) => {
		/** The `code` of the ErreurZip thrown, or a description of what happened instead. */
		const codeDe = (octets, bornes = BORNES) => {
			try {
				const entrees = lireZip(octets, bornes);
				return "no error (" + entrees.length + " entries)";
			} catch (e) {
				if (!(e instanceof ErreurZip)) return "not an ErreurZip: " + String(e);
				return e.code;
			}
		};

		/* ── 1. What a real archive holds reads back byte for byte ── */
		const binaire = pseudoRandom(200_000);
		const texte = Buffer.from("import os\nprint('héllo')\n".repeat(50), "utf8");
		const valide = forgeZip([
			{ name: "pkg/", bytes: "", method: 0 },
			{ name: "pkg/__init__.py", bytes: texte, method: 8 },
			{ name: "pkg/_core.pyd", bytes: binaire, method: 8 },
			{ name: "pkg/stored.bin", bytes: binaire.subarray(0, 5000), method: 0 },
			{ name: "pkg/empty.txt", bytes: "", method: 8 },
			{ name: "pkg/empty-stored.txt", bytes: "", method: 0 },
		]);
		const lues = lireZip(valide, BORNES);
		r.check("directory entries are not returned", lues.map((e) => e.nom), ["pkg/__init__.py", "pkg/_core.pyd", "pkg/stored.bin", "pkg/empty.txt", "pkg/empty-stored.txt"]);
		r.check("a deflated text entry reads back byte for byte", sha(lues[0].octets), sha(texte));
		r.check("a deflated binary entry reads back byte for byte", sha(lues[1].octets), sha(binaire));
		r.check("a stored entry reads back byte for byte", sha(lues[2].octets), sha(binaire.subarray(0, 5000)));
		r.check("an empty deflated entry is empty", lues[3].octets.length, 0);
		r.check("an empty stored entry is empty", lues[4].octets.length, 0);
		r.check("entries are Uint8Array", lues.every((e) => e.octets instanceof Uint8Array), true);
		r.check("an archive with a comment still reads", codeDe(forgeZip([{ name: "a.py", bytes: "x" }], { comment: "made by test" })), "no error (1 entries)");
		r.check("a data-descriptor flag (sizes in the central directory) reads", codeDe(forgeZip([{ name: "a.py", bytes: "x", flags: 0x8 }])), "no error (1 entries)");
		r.check("a UTF-8 name (flag 11) reads", lireZip(forgeZip([{ name: "pkg/é.py", bytes: "x", flags: 0x800 }]), BORNES)[0].nom, "pkg/é.py");

		/* ── 2. Names ── */
		for (const nom of ["../x", "C:x", "/x", "a\\..\\x", "a/../x", "a//b", "./x", "a/b:c", "a/b::$DATA", "con.py", "pkg/NUL.txt", "pkg/aux", "a./x", "a /x", "pkg/x.", "a/\u0001b", "a/b\0c", "a/b?c", "a/b*c", "a/b|c", "a/b<c", "a/b>c", "a/b\"c"]) {
			r.check("entry name " + JSON.stringify(nom) + " refused", codeDe(forgeZip([{ name: "ok.py", bytes: "x" }, { name: nom, bytes: "y" }])), "nom");
		}
		r.check("a directory entry ../ refused too", codeDe(forgeZip([{ name: "../", bytes: "", method: 0 }])), "nom");
		r.check("a non-UTF-8 name without flag 11 refused", codeDe(forgeZip([{ nameBytes: Buffer.from([0x61, 0x82, 0x2e, 0x70, 0x79]), bytes: "x" }])), "nom");
		r.check("invalid UTF-8 under flag 11 refused", codeDe(forgeZip([{ nameBytes: Buffer.from([0x61, 0xff, 0x2e, 0x70, 0x79]), bytes: "x", flags: 0x800 }])), "nom");

		/* ── 3. Sizes that lie ── */
		const cinqK = pseudoRandom(5000, 3);
		r.check("a central size SMALLER than the inflated stream: abime", codeDe(forgeZip([{ name: "a.bin", bytes: cinqK, size: cinqK.length - 1 }])), "abime");
		r.check("a central size LARGER than the inflated stream: abime", codeDe(forgeZip([{ name: "a.bin", bytes: cinqK, size: cinqK.length + 1 }])), "abime");
		r.check("a stored entry whose sizes differ: abime", codeDe(forgeZip([{ name: "a.bin", bytes: cinqK, method: 0, size: cinqK.length + 1 }])), "abime");
		r.check("a deflate stream that is not deflate: abime", codeDe(forgeZip([{ name: "a.bin", bytes: cinqK, compressed: pseudoRandom(400, 9) }])), "abime");
		r.check("a directory entry with content: abime", codeDe(forgeZip([{ name: "d/", bytes: "x", method: 0 }])), "abime");

		/* ── 4. Bombs ── */
		const dixMille = forgeZip(Array.from({ length: 10_000 }, (_, i) => ({ name: "f" + i + ".py", bytes: "", method: 0 })));
		r.check("10 000 entries over maxEntrees 1000: bombe", codeDe(dixMille), "bombe");
		r.check("the same 10 000 entries under maxEntrees 10 000 read", codeDe(dixMille, { ...BORNES, maxEntrees: 10_000 }), "no error (10000 entries)");
		const zeros = new Uint8Array(1024 * 1024);
		r.check("1 MiB of zeros (ratio ~1000) over maxRatio 100: bombe", codeDe(forgeZip([{ name: "z.bin", bytes: zeros }])), "bombe");
		r.check("the same entry under maxRatio 2000 reads", codeDe(forgeZip([{ name: "z.bin", bytes: zeros }]), { ...BORNES, maxRatio: 2000 }), "no error (1 entries)");
		r.check("a total over maxOctets: bombe", codeDe(forgeZip([{ name: "a.bin", bytes: binaire }, { name: "b.bin", bytes: binaire }]), { ...BORNES, maxOctets: 300_000 }), "bombe");
		r.check("one entry over maxOctets: bombe", codeDe(forgeZip([{ name: "a.bin", bytes: binaire, method: 0 }]), { ...BORNES, maxOctets: 100_000 }), "bombe");
		r.check("two central records on one local header: abime (it names only one of them)", codeDe(forgeZip([{ name: "a.bin", bytes: cinqK }, { name: "b.bin", bytes: cinqK, localOffsetOf: 0 }])), "abime");
		{
			/* A QUOTED overlap: `a.bin`'s stored data IS `b.bin`'s local header
			   and data, so each local header names its own entry and only the
			   ranges reveal that one stream is counted twice. */
			const interieur = forgeZip([{ name: "b.bin", bytes: cinqK, method: 0 }]);
			const lhB = Buffer.from(interieur.subarray(0, 30 + "b.bin".length + cinqK.length));
			const z = Buffer.from(forgeZip([{ name: "a.bin", bytes: lhB, method: 0 }, { name: "b.bin", bytes: cinqK, method: 0, noLocal: true }]));
			const nomCentral = z.lastIndexOf(Buffer.from("b.bin"));
			z.writeUInt32LE(30 + "a.bin".length, nomCentral - 46 + 42);
			r.check("entries whose data overlap (quoted local header): bombe", codeDe(new Uint8Array(z)), "bombe");
		}

		/* ── 5. Duplicates ── */
		r.check("two entries, same name: doublon", codeDe(forgeZip([{ name: "a/b.py", bytes: "x" }, { name: "a/b.py", bytes: "y" }])), "doublon");
		r.check("two entries, same name but for case: doublon", codeDe(forgeZip([{ name: "a/B.py", bytes: "x" }, { name: "a/b.py", bytes: "y" }])), "doublon");
		r.check("a file that is also a folder: doublon", codeDe(forgeZip([{ name: "a", bytes: "x" }, { name: "A/b.py", bytes: "y" }])), "doublon");
		r.check("a folder then a file of its name: doublon", codeDe(forgeZip([{ name: "a/b.py", bytes: "y" }, { name: "a", bytes: "x" }])), "doublon");
		r.check("a directory entry and its files are no duplicate", codeDe(forgeZip([{ name: "a/", bytes: "", method: 0 }, { name: "a/b.py", bytes: "y" }])), "no error (1 entries)");

		/* ── 6. Damaged archives ── */
		r.check("an archive cut 10 bytes short: abime", codeDe(valide.subarray(0, valide.length - 10)), "abime");
		const coupes = new Set();
		for (let n = 0; n < valide.length; n += 997) coupes.add(codeDe(valide.subarray(0, n)));
		r.check("an archive cut anywhere: always abime, never another error", [...coupes], ["abime"]);
		r.check("an empty input: abime", codeDe(new Uint8Array(0)), "abime");
		r.check("bytes that are no zip: abime", codeDe(pseudoRandom(3000, 5)), "abime");
		r.check("a wrong CRC: abime", codeDe(forgeZip([{ name: "a.py", bytes: "print(1)", crc: 12345 }])), "abime");
		r.check("a wrong CRC on a stored entry: abime", codeDe(forgeZip([{ name: "a.py", bytes: "print(1)", method: 0, crc: 12345 }])), "abime");
		r.check("an unknown method (bzip2): abime", codeDe(forgeZip([{ name: "a.py", bytes: "x", method: 12, compressed: Buffer.from("x") }])), "abime");
		r.check("an encrypted entry: abime", codeDe(forgeZip([{ name: "a.py", bytes: "x", flags: 0x1 }])), "abime");
		r.check("a zip64 entry: abime", codeDe(forgeZip([{ name: "a.py", bytes: "x", zip64: true }])), "abime");
		r.check("a zip64 end record: abime", codeDe(forgeZip([{ name: "a.py", bytes: "x" }], { zip64End: true })), "abime");
		r.check("a multi-disk archive: abime", codeDe(forgeZip([{ name: "a.py", bytes: "x" }], { diskNumber: 1 })), "abime");
		r.check("a local header naming another file: abime", codeDe(forgeZip([{ name: "a.py", bytes: "x", localNameBytes: Buffer.from("b.py") }])), "abime");
		r.check("a central record without its local header: abime", codeDe(forgeZip([{ name: "a.py", bytes: "x", noLocal: true }])), "abime");
		const garbage = Buffer.concat([Buffer.from(valide.subarray(0, valide.length - 22)), Buffer.from("junk"), Buffer.from(valide.subarray(valide.length - 22))]);
		r.check("bytes between the central directory and its end record: abime", codeDe(new Uint8Array(garbage)), "abime");
		/* The same junk, but counted in the declared directory size: the
		   records end before the bytes the directory claims. */
		garbage.writeUInt32LE(garbage.readUInt32LE(garbage.length - 22 + 12) + 4, garbage.length - 22 + 12);
		r.check("junk counted inside the declared central directory: abime", codeDe(new Uint8Array(garbage)), "abime");

		/* ── 7. ecrireSous ── */
		const base = join(tmp, "ecrire");
		const dest = join(base, "dest");
		mkdirSync(dest, { recursive: true });
		mkdirSync(join(base, "outside"), { recursive: true });
		writeFileSync(join(base, "outside", "canary.txt"), "canary");
		await ecrireSous(dest, lues);
		r.check("ecrireSous writes every entry, byte for byte", snapshot(dest), [
			"pkg/",
			"pkg/__init__.py " + sha(texte),
			"pkg/_core.pyd " + sha(binaire),
			"pkg/empty-stored.txt " + sha(new Uint8Array(0)),
			"pkg/empty.txt " + sha(new Uint8Array(0)),
			"pkg/stored.bin " + sha(binaire.subarray(0, 5000)),
		]);
		const codeEcrire = (entrees) => ecrireSous(join(base, "dest2"), entrees).then(() => "no error", (e) => (e instanceof ErreurZip ? e.code : "not an ErreurZip: " + String(e)));
		const bon = { nom: "pkg/ok.py", octets: Buffer.from("x") };
		for (const nom of ["../outside/evil.txt", "..\\outside\\evil.txt", "C:evil", "/evil", "a/C:evil", "a/con.txt", "a./b"]) {
			const avant = snapshot(base);
			const code = await codeEcrire([bon, { nom, octets: Buffer.from("evil") }]);
			r.check("ecrireSous with " + JSON.stringify(nom) + " after a good entry: refused (nom)", code, "nom");
			r.check("ecrireSous with " + JSON.stringify(nom) + ": nothing written anywhere", snapshot(base), avant);
		}
		{
			const avant = snapshot(base);
			r.check("ecrireSous with two names Windows sees as one: doublon", await codeEcrire([bon, { nom: "PKG/OK.py", octets: Buffer.from("y") }]), "doublon");
			r.check("ecrireSous with a duplicate: nothing written anywhere", snapshot(base), avant);
		}
	});
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

r.done();
