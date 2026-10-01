// The C/C++ pack pin and its extraction, for the Android build.
// The pin is a COPY of `PACK_C` in apps/windows/electron/langages.ts; the
// build asserts the two are equal (a mismatch fails the build), and the pack
// is verified against it before a single byte is extracted. Entry names are
// distrusted with the same rules as `nomEntreeAdmis` in langages.ts.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

export const PACK_C = {
	version: "22.0.0-git20542-10",
	url: "https://github.com/Neo-Quiz/neo-quiz/releases/download/language-c-22.0.0-git20542-10/language-c-22.0.0-git20542-10.zip.gz",
	sha256: "aef5e5cc2f9fa27f6cc72d5a1294c2bc7cf3de291a49eb550010f894a3409a16",
	taille: 28432790,
};

/** The pin literals of the Windows app, read from its source text. */
export function readWindowsPin(langagesTs) {
	const field = (name) => new RegExp(`\\b${name}:\\s*("([^"]*)"|[0-9]+)`).exec(langagesTs);
	const str = (name) => field(name)?.[2];
	const num = (name) => { const m = field(name); return m && !m[2] ? Number(m[1]) : undefined; };
	return { version: str("version"), url: str("url"), sha256: str("sha256"), taille: num("taille") };
}

/** Throws unless `pin` equals the Windows one. */
export function assertPinEquals(pin, windows) {
	for (const k of ["version", "url", "sha256", "taille"]) {
		if (pin[k] !== windows[k]) throw new Error(`PACK_C.${k} differs from apps/windows/electron/langages.ts (${pin[k]} vs ${windows[k]})`);
	}
}

/** Same rules as `nomEntreeAdmis` (langages.ts): the name when safe, else null. */
export function entryNameAllowed(nom) {
	if (typeof nom !== "string" || !nom || nom.includes("\0") || nom.includes("\\")) return null;
	if (nom.startsWith("/")) return null;
	if (/^[a-zA-Z]:/.test(nom)) return null;
	if (nom.split("/").some((s) => s === "" || s === "." || s === "..")) return null;
	return nom;
}

/** Hash and size must equal the pin, else throws (nothing is extracted). */
export function verifyPack(bytes, pin = PACK_C) {
	if (bytes.length !== pin.taille) throw new Error(`language pack size ${bytes.length} differs from its pin ${pin.taille}`);
	const sha = createHash("sha256").update(bytes).digest("hex");
	if (sha !== pin.sha256) throw new Error("SHA-256 of the language pack does not match its pin");
}

/** "Store" ZIP entries, like `parseZip` (src/dashboard/zip.ts), but as raw
    bytes. The pack's files are latin1 text wrapped in UTF-8 by `buildZip`:
    decode as UTF-8 then write as latin1, exactly what the installer does. */
export function parsePackZip(bytes) {
	const out = [];
	let off = 0;
	while (off + 30 <= bytes.length && bytes.readUInt32LE(off) === 0x04034b50) {
		const method = bytes.readUInt16LE(off + 8);
		const size = bytes.readUInt32LE(off + 18);
		const nameLen = bytes.readUInt16LE(off + 26);
		const extraLen = bytes.readUInt16LE(off + 28);
		const name = bytes.subarray(off + 30, off + 30 + nameLen).toString("utf8");
		const start = off + 30 + nameLen + extraLen;
		if (!name.endsWith("/")) {
			if (method !== 0) throw new Error(`unsupported ZIP method ${method} for ${name}`);
			out.push({ name, data: Buffer.from(bytes.subarray(start, start + size).toString("utf8"), "latin1") });
		}
		off = start + size;
	}
	return out;
}

/** Writes the entries under `dest`, each name checked first and the resolved path re-checked. */
export function writeEntries(dest, entries) {
	const destAbs = resolve(dest);
	for (const e of entries) {
		const nom = entryNameAllowed(e.name);
		if (!nom) throw new Error("unsafe entry name in the language pack: " + JSON.stringify(e.name));
		const target = resolve(dest, ...nom.split("/"));
		if (!target.startsWith(destAbs + sep)) throw new Error("entry escapes the pack directory: " + e.name);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, e.data);
	}
}

/** The verified gz pack: from `dir` if present, else fetched from its release URL. */
export async function loadPack(dir, pin = PACK_C) {
	const file = join(dir, `language-c-${pin.version}.zip.gz`);
	let bytes;
	if (existsSync(file)) bytes = readFileSync(file);
	else {
		console.log(`[android:web] downloading ${pin.url}`);
		const r = await fetch(pin.url);
		if (!r.ok) throw new Error(`language pack download failed: HTTP ${r.status}`);
		bytes = Buffer.from(await r.arrayBuffer());
		verifyPack(bytes, pin);
		mkdirSync(dir, { recursive: true });
		writeFileSync(file, bytes);
	}
	verifyPack(bytes, pin);
	return bytes;
}

/** Verifies and extracts the pack into `dest`. */
export async function extractPack(dir, dest, pin = PACK_C) {
	const entries = parsePackZip(gunzipSync(await loadPack(dir, pin)));
	writeEntries(dest, entries);
	return entries.length;
}
