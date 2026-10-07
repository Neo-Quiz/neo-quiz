// The language pack pins, for the Android app.
// Each pin is a COPY of `PACK_C` / `PACK_PYTHON` in
// apps/windows/electron/langages.ts and of the Kotlin copy in
// `LanguagePacks.kt` (the phone downloads, verifies and extracts the packs
// itself); `npm run check:android-code-pack` asserts all three are equal.
// The APK embeds NO pack.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";

export const PACK_C = {
	version: "22.0.0-git20542-10",
	url: "https://github.com/Neo-Quiz/neo-quiz/releases/download/language-c-22.0.0-git20542-10/language-c-22.0.0-git20542-10.zip.gz",
	sha256: "aef5e5cc2f9fa27f6cc72d5a1294c2bc7cf3de291a49eb550010f894a3409a16",
	taille: 28432790,
};

export const PACK_PYTHON = {
	version: "314.0.7",
	url: "https://github.com/Neo-Quiz/neo-quiz/releases/download/language-python-314.0.7/language-python-314.0.7.zip.gz",
	sha256: "1df5db3471a7f17c4854434eda12a0ae26cd108370c9039b38e10397628fa7b7",
	taille: 7019891,
};

const FIELDS = ["version", "url", "sha256", "taille"];

/** Reads the four literals of `export const <name> = {…}` from the TypeScript source text. */
export function readPinLiterals(source, name) {
	const start = source.indexOf(`export const ${name} = {`);
	if (start < 0) return {};
	const body = source.slice(start, source.indexOf("}", start));
	const field = (f) => new RegExp(`\\b${f}:\\s*("([^"]*)"|[0-9]+)`).exec(body);
	const str = (f) => field(f)?.[2];
	const num = (f) => { const m = field(f); return m && !m[2] ? Number(m[1]) : undefined; };
	return { version: str("version"), url: str("url"), sha256: str("sha256"), taille: num("taille") };
}

/** The pin literals of the Windows app, read from its source text. */
export function readWindowsPin(langagesTs, name = "PACK_C") {
	return readPinLiterals(langagesTs, name);
}

/** Throws unless `pin` equals `other` (the Windows or the Kotlin copy). */
export function assertPinEquals(pin, other, label = "pin") {
	for (const k of FIELDS) {
		if (pin[k] !== other[k]) throw new Error(`${label}.${k} differs (${pin[k]} vs ${other[k]})`);
	}
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
