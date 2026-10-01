// The C/C++ pack pin and its extraction, for the Android build.
// The pin is a COPY of `PACK_C` in apps/windows/electron/langages.ts; the
// build asserts the two are equal (a mismatch fails the build), and the pack
// is verified against it before a single byte is extracted. Entry names are
// distrusted with the same rules as `nomEntreeAdmis` in langages.ts.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";

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

/* ───────────── the embedded Syncthing binary (Task 10) ─────────────
   Official Syncthing 2.1.5 built for Android by the Syncthing-Fork project
   (`researchxxl/syncthing-android`, v2.1.5.0), which ships it as
   `lib/<abi>/libsyncthingnative.so` inside its APK. The release page
   publishes the SHA-256 of every APK (the `digest` of each release asset);
   both the APK and the extracted library are pinned, and nothing is written
   under `jniLibs` before BOTH match. The x86_64 build exists only so DEBUG
   builds run on the emulator (it goes under `src/debug/`); release builds
   ship arm64-v8a alone. */
const SYNCTHING_RELEASE = "https://github.com/researchxxl/syncthing-android/releases/download/v2.1.5.0/";
export const SYNCTHING = {
	"arm64-v8a": {
		apk: "com.github.catfriend1.syncthingfork_release_v2.1.5.0_arm64-v8a.apk",
		apkSha256: "221c05d1b6db9788e7112a6293a230ef0e7bc676d8523a96db5ff176be94582c",
		apkSize: 32412694,
		entry: "lib/arm64-v8a/libsyncthingnative.so",
		soSha256: "2adf4ec6af1db49980b8b13f955a08c787b148ce1ce36e82e8304bfcf273d80b",
		soSize: 27508216,
		dest: "src/main/jniLibs/arm64-v8a",
	},
	x86_64: {
		apk: "com.github.catfriend1.syncthingfork_release_v2.1.5.0_x86_64.apk",
		apkSha256: "f6ef6226d6ff237d09859c00ec83792b4a6af927083f5599ecdbc6124d4fea22",
		apkSize: 33182736,
		entry: "lib/x86_64/libsyncthingnative.so",
		soSha256: "35ef6db3984febc62bd51ff4678bf432c259c7a55e841929f7fb40772ac59ea8",
		soSize: 29364344,
		dest: "src/debug/jniLibs/x86_64",
	},
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The bytes of ONE entry of a ZIP (the APK), found through its central directory, inflated. */
export function readZipEntry(zip, name) {
	let eocd = -1;
	for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
		if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
	}
	if (eocd < 0) throw new Error("not a ZIP: no end-of-central-directory record");
	const count = zip.readUInt16LE(eocd + 10);
	let off = zip.readUInt32LE(eocd + 16);
	for (let n = 0; n < count; n++) {
		if (zip.readUInt32LE(off) !== 0x02014b50) throw new Error("corrupt ZIP central directory");
		const method = zip.readUInt16LE(off + 10);
		const csize = zip.readUInt32LE(off + 20);
		const nameLen = zip.readUInt16LE(off + 28);
		const extraLen = zip.readUInt16LE(off + 30);
		const commentLen = zip.readUInt16LE(off + 32);
		const local = zip.readUInt32LE(off + 42);
		if (zip.subarray(off + 46, off + 46 + nameLen).toString("utf8") === name) {
			const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
			const data = zip.subarray(start, start + csize);
			if (method === 0) return Buffer.from(data);
			if (method === 8) return inflateRawSync(data);
			throw new Error(`unsupported ZIP method ${method} for ${name}`);
		}
		off += 46 + nameLen + extraLen + commentLen;
	}
	throw new Error(`${name} not found in the APK`);
}

/** Verifies the APK, extracts its library, verifies that too; throws on any mismatch (nothing is written then). */
export function extractSyncthing(apkBytes, pin) {
	if (apkBytes.length !== pin.apkSize) throw new Error(`${pin.apk}: size ${apkBytes.length} differs from its pin ${pin.apkSize}`);
	if (sha256(apkBytes) !== pin.apkSha256) throw new Error(`${pin.apk}: SHA-256 does not match its pin`);
	const so = readZipEntry(apkBytes, pin.entry);
	if (so.length !== pin.soSize) throw new Error(`${pin.entry}: size ${so.length} differs from its pin ${pin.soSize}`);
	if (sha256(so) !== pin.soSha256) throw new Error(`${pin.entry}: SHA-256 does not match its pin`);
	return so;
}

/** Puts every pinned library under `appDir`/<dest>, downloading the APKs into `cacheDir` when absent. */
export async function installSyncthing(cacheDir, appDir) {
	for (const [abi, pin] of Object.entries(SYNCTHING)) {
		const target = join(appDir, pin.dest, "libsyncthingnative.so");
		if (existsSync(target) && statSync(target).size === pin.soSize && sha256(readFileSync(target)) === pin.soSha256) continue;
		const cached = join(cacheDir, pin.apk);
		let apk;
		if (existsSync(cached)) apk = readFileSync(cached);
		else {
			console.log(`[android:web] downloading ${SYNCTHING_RELEASE}${pin.apk}`);
			const r = await fetch(SYNCTHING_RELEASE + pin.apk);
			if (!r.ok) throw new Error(`${pin.apk} download failed: HTTP ${r.status}`);
			apk = Buffer.from(await r.arrayBuffer());
		}
		const so = extractSyncthing(apk, pin);
		mkdirSync(cacheDir, { recursive: true });
		if (!existsSync(cached)) writeFileSync(cached, apk);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, so);
		console.log(`[android:web] syncthing ${abi} ready (${so.length} bytes)`);
	}
}
