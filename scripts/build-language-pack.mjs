/**
 * BUILDS THE C/C++ LANGUAGE PACK: `@yowasp/clang`'s `gen/*` (bundle.js plus
 * the four LLVM core wasm modules and the resource tarball — one shared
 * `Application` compiles either C or C++, no smaller C-only subset,
 * measured in scripts/measure-clang.mjs), `@bjorn3/browser_wasi_shim`'s
 * `dist/*.js` (its actual runtime; `.tsbuildinfo` and `typings/` are build
 * artefacts, never fetched at runtime), a licence notice, and a
 * `manifest.json` naming the pack's version. Written as a gzipped STORED
 * zip (`buildZip`, src/dashboard/zip.ts) to `dist-pack/language-c-<version>
 * .zip.gz`, printed with its SHA-256 and size — copy both into `PACK_C`
 * (apps/windows/electron/langages.ts) BY HAND: the app refuses any pack
 * whose hash differs, so a builder that auto-wrote the constant would be
 * exactly the blind trust the pin exists to remove.
 *
 * `buildZip`'s entries are TEXT (UTF-8 on the wire): every file here,
 * binary or not, is carried as a "latin1" string — each byte becomes one
 * code point, and `Buffer.from(content, "latin1")` on the reading end
 * (`langages.ts`, `scripts/check-electron-langages.mjs`) reads it back
 * byte-for-byte. UTF-8 re-encodes that string to more bytes on the wire
 * (every byte >= 0x80 doubles), but the whole archive is gzipped
 * afterwards, and this is exactly the container `src/dashboard/zip.ts`
 * already commits to — the reuse the plan asks for, not a byte-optimal one.
 *
 *     node scripts/build-language-pack.mjs [c|python]   (default: c)
 *
 * The `python` pack carries the Pyodide runtime files (`FICHIERS_PYODIDE`,
 * apps/windows/electron/code/copier.mjs), the MPL-2.0 licence
 * (scripts/licenses/pyodide-LICENSE: the npm package ships none) and a
 * `manifest.json`; it is written to `dist-pack/language-python-<version>
 * .zip.gz` and printed as `PACK_PYTHON`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { FICHIERS_PYODIDE } from "../apps/windows/electron/code/copier.mjs";
import { withSrcModule } from "./lib/load-src.mjs";

const CLANG_DIR = "apps/windows/node_modules/@yowasp/clang";
const SHIM_DIR = "apps/windows/node_modules/@bjorn3/browser_wasi_shim";
const OUT_DIR = "dist-pack";

const PACK = process.argv[2] ?? "c";
if (PACK !== "c" && PACK !== "python") {
	console.error(`unknown pack "${PACK}" (expected "c" or "python")`);
	process.exitCode = 1;
	throw new Error("unknown pack");
}
const PYODIDE_DIR = "apps/windows/node_modules/pyodide";
const RELEASE_BASE = "https://github.com/Neo-Quiz/neo-quiz/releases/download";

const clangPkg = PACK === "c" ? JSON.parse(readFileSync(join(CLANG_DIR, "package.json"), "utf8")) : null;
const shimPkg = PACK === "c" ? JSON.parse(readFileSync(join(SHIM_DIR, "package.json"), "utf8")) : null;
const pyodidePkg = PACK === "python" ? JSON.parse(readFileSync(join(PYODIDE_DIR, "package.json"), "utf8")) : null;

// The pack's own version: @yowasp/clang is the compiler this pack exists
// for, and Task 1 pinned its exact version — that pin IS the pack's
// identity (also the release tag: `language-c-<version>`).
const VERSION = PACK === "c" ? clangPkg.version : pyodidePkg.version;

// Neither package ships a LICENSE file inside the npm package itself
// (verified: `find … -iname "licen*"` finds none under @yowasp/clang).
// Their declared licences are recorded here rather than invented as a
// copied file that does not exist upstream.
const NOTICE = PACK !== "c" ? "" : [
	"Neo Quiz C/C++ language pack -- third-party components:",
	"",
	`@yowasp/clang ${clangPkg.version} -- package.json declares "ISC"; its`,
	"README states Apache-2.0 (it repackages LLVM/Clang, itself Apache-2.0",
	"WITH LLVM-exception) -- both noted here, since neither file ships its",
	"own LICENSE inside the npm package.",
	"",
	`@bjorn3/browser_wasi_shim ${shimPkg.version} -- "MIT OR Apache-2.0", both`,
	"texts included next to this file (browser_wasi_shim-LICENSE-MIT,",
	"browser_wasi_shim-LICENSE-APACHE).",
].join("\n");

/** Every byte as one code point: the round trip `buildZip`/`parseZip`
    (both UTF-8 TextEncoder/TextDecoder under the hood) preserves exactly,
    whatever the file's real encoding — see the header. */
function readAsLatin1(path) {
	return readFileSync(path).toString("latin1");
}

const entries = [];
if (PACK === "c") {
	for (const f of readdirSync(join(CLANG_DIR, "gen"))) {
		entries.push({ name: `clang/${f}`, content: readAsLatin1(join(CLANG_DIR, "gen", f)) });
	}
	for (const f of readdirSync(join(SHIM_DIR, "dist"))) {
		// No `.tsbuildinfo`: a build artefact, never fetched by `wasi-shim/index.js`.
		if (!f.endsWith(".js")) continue;
		entries.push({ name: `wasi-shim/${f}`, content: readAsLatin1(join(SHIM_DIR, "dist", f)) });
	}
	entries.push({ name: "LICENSES/NOTICE.txt", content: NOTICE });
	entries.push({ name: "LICENSES/browser_wasi_shim-LICENSE-MIT", content: readAsLatin1(join(SHIM_DIR, "LICENSE-MIT")) });
	entries.push({ name: "LICENSES/browser_wasi_shim-LICENSE-APACHE", content: readAsLatin1(join(SHIM_DIR, "LICENSE-APACHE")) });
} else {
	for (const f of FICHIERS_PYODIDE) {
		entries.push({ name: f, content: readAsLatin1(join(PYODIDE_DIR, f)) });
	}
	entries.push({ name: "LICENSES/pyodide-LICENSE", content: readAsLatin1("scripts/licenses/pyodide-LICENSE") });
}
entries.push({ name: "manifest.json", content: JSON.stringify({ version: VERSION }) });

await withSrcModule("src/dashboard/zip.ts", ({ buildZip }) => {
	const zip = buildZip(entries);
	const gz = gzipSync(zip, { level: 9 });
	mkdirSync(OUT_DIR, { recursive: true });
	const outPath = join(OUT_DIR, `language-${PACK}-${VERSION}.zip.gz`);
	writeFileSync(outPath, gz);
	const sha256 = createHash("sha256").update(gz).digest("hex");
	console.log(`pack: ${outPath}`);
	console.log(`entries: ${entries.length}`);
	console.log(`sha256 ${sha256} size ${gz.length}`);
	if (PACK === "c") {
		console.log(`PACK_C = { version: "${VERSION}", sha256: "${sha256}", taille: ${gz.length} }`);
	} else {
		const url = `${RELEASE_BASE}/language-python-${VERSION}/language-python-${VERSION}.zip.gz`;
		console.log(`PACK_PYTHON = { version: "${VERSION}", url: "${url}", sha256: "${sha256}", taille: ${gz.length} }`);
	}
});
