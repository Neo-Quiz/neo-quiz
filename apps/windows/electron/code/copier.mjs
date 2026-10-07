/* Copies the sandbox (page, workers) to `dest`. Pyodide is NOT part of the
   app any more: it ships in the downloadable `python` language pack
   (`languages/python/`, see `scripts/build-language-pack.mjs`). Shared by
   `construire.mjs` and `check-code-sandbox.mjs`: a second list would
   eventually drift. */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ici = dirname(fileURLToPath(import.meta.url));
/* The ONLY Pyodide files the sandbox needs (no `.map`, no demo consoles):
   the content of the `python` pack, also copied by the Android build and the
   sandbox check. */
export const FICHIERS_PYODIDE = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

/** Copies the npm `pyodide` runtime files to `dest` (a pack's `python/` folder). */
export async function copierPyodide(dest) {
	const require = createRequire(join(ici, "..", "..", "package.json"));
	const source = dirname(require.resolve("pyodide/package.json"));
	await mkdir(dest, { recursive: true });
	await Promise.all(FICHIERS_PYODIDE.map(f => copyFile(join(source, f), join(dest, f))));
}

export async function copierBacASable(dest) {
	await mkdir(dest, { recursive: true });
	await Promise.all(["index.html", "page.js", "worker-python.mjs", "worker-clang.mjs"].map(f => copyFile(join(ici, f), join(dest, f))));
}
