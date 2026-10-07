/**
 * The Android app embeds NO language pack: it downloads them itself. This
 * check ties the pin copies together:
 *  - `PACK_C` and `PACK_PYTHON` of apps/android/web/pins.mjs equal those of
 *    apps/windows/electron/langages.ts, literal for literal;
 *  - the Kotlin copy (`LanguagePacks.kt`) equals them too;
 *  - the sandbox constants of CodeProtocol.kt are the PC's;
 *  - the APK build copies no pack (the JVM tests, `LanguagePacksTest`, hold the
 *    hash, size and entry-name refusals).
 *
 *     npm run check:android-code-pack
 *
 * Exit code only (`process.exitCode`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PACK_C, PACK_PYTHON, assertPinEquals, readWindowsPin } from "../apps/android/web/pins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
function check(label, ok) {
	if (!ok) { failures++; console.error(`FAIL ${label}`); } else console.log(`ok   ${label}`);
}
function throws(fn) { try { fn(); return false; } catch { return true; } }

const langagesTs = readFileSync(join(root, "apps/windows/electron/langages.ts"), "utf8");
for (const [name, pin] of [["PACK_C", PACK_C], ["PACK_PYTHON", PACK_PYTHON]]) {
	const windows = readWindowsPin(langagesTs, name);
	check(`Windows ${name} is readable`, Boolean(windows.version && windows.url && windows.sha256 && windows.taille));
	check(`pins.mjs ${name} equals the Windows one`, !throws(() => assertPinEquals(pin, windows)));
	for (const k of ["version", "url", "sha256", "taille"]) {
		check(`a different ${name}.${k} is detected`, throws(() => assertPinEquals({ ...pin, [k]: k === "taille" ? 1 : "x" }, windows)));
	}
}

// The Kotlin copy (LanguagePacks.kt) equals the Windows pins too.
const kotlin = readFileSync(join(root, "apps/android/app/src/main/java/com/ahmedmili/neoquiz/code/LanguagePacks.kt"), "utf8");
function readKotlinPin(source, name) {
	const start = source.indexOf(`"${name}" to Pin(`);
	if (start < 0) return {};
	const body = source.slice(start, source.indexOf("),", start));
	const str = (f) => new RegExp(`\\b${f} = "([^"]*)"`).exec(body)?.[1];
	const num = (f) => { const m = new RegExp(`\\b${f} = ([0-9]+)`).exec(body); return m ? Number(m[1]) : undefined; };
	return { version: str("version"), url: str("url"), sha256: str("sha256"), taille: num("size") };
}
for (const [name, key] of [["PACK_C", "c"], ["PACK_PYTHON", "python"]]) {
	const kt = readKotlinPin(kotlin, key);
	const windows = readWindowsPin(langagesTs, name);
	check(`Kotlin pin "${key}" is readable`, Boolean(kt.version && kt.url && kt.sha256 && kt.taille));
	check(`Kotlin pin "${key}" equals the Windows ${name}`, !throws(() => assertPinEquals(kt, windows)));
	check(`a different Kotlin "${key}" pin is detected`, throws(() => assertPinEquals({ ...kt, sha256: "x" }, windows)));
}
check("the Kotlin hosts are the three Windows hosts", ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"].every((h) => kotlin.includes(`"${h}"`) && readFileSync(join(root, "apps/windows/electron/reseau.ts"), "utf8").includes(`"${h}"`)));

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

const build = readFileSync(join(root, "apps/android/web/build.mjs"), "utf8");
check("the APK build embeds no pack", !/extractPack|FICHIERS_PYODIDE|copierPyodide|languages", "(c|python)"/.test(build));

if (failures) process.exitCode = 1;
