/* Copies the sandbox (page, worker) and the ONLY Pyodide files it needs
   (no `.map`, no demo consoles) to `dest`. Shared by `construire.mjs` and
   `check-code-sandbox.mjs`: a second list would eventually drift. */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ici = dirname(fileURLToPath(import.meta.url));
export const FICHIERS_PYODIDE = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

export async function copierBacASable(dest) {
	const require = createRequire(join(ici, "..", "..", "package.json"));
	const source = dirname(require.resolve("pyodide/package.json"));
	await mkdir(join(dest, "pyodide"), { recursive: true });
	await Promise.all([
		...["index.html", "page.js", "worker-python.mjs", "worker-clang.mjs"].map(f => copyFile(join(ici, f), join(dest, f))),
		...FICHIERS_PYODIDE.map(f => copyFile(join(source, f), join(dest, "pyodide", f))),
	]);
}
