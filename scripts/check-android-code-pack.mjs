/**
 * The Android build's copy of the C/C++ pack pin (apps/android/web/pins.mjs):
 *  - it equals `PACK_C` of apps/windows/electron/langages.ts, literal for literal;
 *  - a pack whose size or hash differs is refused before anything is extracted;
 *  - an archive entry named `../x`, `C:x`, `/x`, `a\..\x` (and the other forms
 *    `nomEntreeAdmis` refuses) is refused and nothing is written, even when
 *    the other entries are fine.
 *
 *     npm run check:android-code-pack
 *
 * Exit code only (`process.exitCode`).
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PACK_C, assertPinEquals, entryNameAllowed, readWindowsPin, verifyPack, writeEntries } from "../apps/android/web/pins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
function check(label, ok) {
	if (!ok) { failures++; console.error(`FAIL ${label}`); } else console.log(`ok   ${label}`);
}
function throws(fn) { try { fn(); return false; } catch { return true; } }

const windows = readWindowsPin(readFileSync(join(root, "apps/windows/electron/langages.ts"), "utf8"));
check("Windows pin is readable", Boolean(windows.version && windows.url && windows.sha256 && windows.taille));
check("pin equals the Windows PACK_C", !throws(() => assertPinEquals(PACK_C, windows)));
for (const k of ["version", "url", "sha256", "taille"]) {
	check(`a different ${k} fails the build`, throws(() => assertPinEquals({ ...PACK_C, [k]: k === "taille" ? 1 : "x" }, windows)));
}

for (const bad of ["../x", "a/../x", "C:x", "C:/x", "c:\\x", "/x", "a\\..\\x", "\\\\server\\share\\x", "a//b", "./x", "", "a\0b"]) {
	check(`refuses entry name ${JSON.stringify(bad)}`, entryNameAllowed(bad) === null);
}
for (const good of ["clang/bundle.js", "manifest.json", "wasi-shim/index.js"]) {
	check(`admits entry name ${good}`, entryNameAllowed(good) === good);
}

// The sandbox constants are the PC's, literal for literal.
const sandboxTs = readFileSync(join(root, "apps/windows/electron/code-sandbox.ts"), "utf8");
const protocolKt = readFileSync(join(root, "apps/android/app/src/main/java/com/ahmedmili/neoquiz/code/CodeProtocol.kt"), "utf8");
const pcCsp = /const CSP = "([^"]*)"/.exec(sandboxTs)?.[1];
check("CSP equals the PC's", Boolean(pcCsp) && protocolKt.includes(`const val CSP = "${pcCsp}"`));
const pcNum = (name) => { const m = new RegExp(`const ${name} = ([0-9 *]+);`).exec(sandboxTs)?.[1]; return m ? Function(`return ${m}`)() : undefined; };
for (const [pc, kt] of [["SECOURS_MS", "FALLBACK_MS"], ["CHARGEMENT_MS", "LOADING_MS"], ["INACTIVITE_MS", "IDLE_MS"], ["PLAFOND_FILE", "QUEUE_LIMIT"]]) {
	const v = pcNum(pc);
	const k = new RegExp(`const val ${kt} = ([0-9 *L]+)`).exec(protocolKt)?.[1]?.replace(/L/g, "");
	check(`${kt} equals the PC's ${pc}`, v !== undefined && k !== undefined && Function(`return ${k}`)() === v);
}

const small = Buffer.from("hello");
check("a pack of another size is refused", throws(() => verifyPack(small, { ...PACK_C, taille: 6 })));
check("a pack of the right size but another hash is refused", throws(() => verifyPack(small, { ...PACK_C, taille: 5 })));

const dest = mkdtempSync(join(tmpdir(), "neo-pack-"));
try {
	for (const bad of ["../x", "C:x", "/x", "a\\..\\x"]) {
		check(`writeEntries(${JSON.stringify(bad)}) throws`, throws(() => writeEntries(join(dest, "pack"), [{ name: "ok.txt", data: Buffer.from("a") }, { name: bad, data: Buffer.from("b") }])));
	}
	check("nothing outside the pack directory was written", !existsSync(join(dest, "x")) && readdirSync(dest).every((n) => n === "pack"));
	writeEntries(join(dest, "good"), [{ name: "a/b.txt", data: Buffer.from("ok") }]);
	check("a safe entry is written", readFileSync(join(dest, "good", "a", "b.txt"), "utf8") === "ok");
} finally {
	rmSync(dest, { recursive: true, force: true });
}

if (failures) process.exitCode = 1;
