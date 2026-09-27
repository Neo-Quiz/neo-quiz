/* Copie le bac à sable (page, worker) et les SEULS fichiers de Pyodide
   nécessaires (ni `.map`, ni consoles de démonstration) vers `dest`.
   Partagé par `construire.mjs` et `check-python-sandbox.mjs` : une seconde
   liste finirait par diverger. */
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
		...["index.html", "page.js", "worker.mjs"].map(f => copyFile(join(ici, f), join(dest, f))),
		...FICHIERS_PYODIDE.map(f => copyFile(join(source, f), join(dest, "pyodide", f))),
	]);
}
