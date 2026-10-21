/**
 * THE PINNED PYTHON CATALOGUE (apps/windows/electron/python/catalogue*.ts)
 * and the import scanner (src/python-imports.ts).
 *
 * WHAT THESE CASES PREVENT: a dependency missing from the pinned set (the
 * install would then fetch something unpinned or fail), a download URL
 * outside the two trusted hosts or not https, a torch closure that drags the
 * CUDA wheels, and a scanner that reads imports out of comments or strings.
 * Reads only committed data: no network, no Python.
 *
 *     npm run check:python-catalogue
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const r = makeReporter("Python catalogue");

await withSrcModule(
	["apps/windows/electron/python/catalogue.ts", "src/python-imports.ts"],
	(cat, imp) => {
		const { INTERPRETE, PAQUETS, IMPORTS, STDLIB, fermeture, classerImports } = cat;
		const cles = Object.keys(PAQUETS);

		r.check("interpreter version", INTERPRETE.version, "3.12.10");
		r.check("interpreter host", new URL(INTERPRETE.url).protocol + new URL(INTERPRETE.url).hostname, "https:www.python.org");
		r.check("interpreter sha256", /^[0-9a-f]{64}$/.test(INTERPRETE.sha256), true);
		r.check("interpreter size", INTERPRETE.taille > 0, true);

		const mauvais = { dep: [], hote: [], sha: [], taille: [] };
		for (const [nom, p] of Object.entries(PAQUETS)) {
			for (const d of p.dependances) if (!(d in PAQUETS)) mauvais.dep.push(nom + " -> " + d);
			const u = new URL(p.url);
			if (u.protocol !== "https:" || u.hostname !== "files.pythonhosted.org") mauvais.hote.push(nom);
			if (!/^[0-9a-f]{64}$/.test(p.sha256)) mauvais.sha.push(nom);
			if (!(p.taille > 0)) mauvais.taille.push(nom);
		}
		r.check("every dependency is a key", mauvais.dep, []);
		r.check("every wheel host is files.pythonhosted.org over https", mauvais.hote, []);
		r.check("every sha256 is 64 hex", mauvais.sha, []);
		r.check("every size > 0", mauvais.taille, []);

		const torch = fermeture("torch");
		for (const n of ["sympy", "networkx", "jinja2", "filelock", "fsspec", "typing-extensions"])
			r.check("torch closure has " + n, torch.includes(n), true);
		r.check("torch closure has no nvidia/triton", torch.filter((n) => /^nvidia-|^triton/.test(n)), []);
		r.check("closure ends with the package", torch[torch.length - 1], "torch");
		const pos = new Map(torch.map((n, i) => [n, i]));
		r.check("closure lists deps first", torch.filter((n) => PAQUETS[n].dependances.some((d) => pos.get(d) > pos.get(n))), []);

		r.check("every IMPORTS value is a key", Object.values(IMPORTS).filter((v) => !(v in PAQUETS)), []);
		r.check("IMPORTS sklearn", IMPORTS.sklearn, "scikit-learn");
		r.check("STDLIB has os", STDLIB.has("os"), true);
		r.check("keys are normalised", cles.filter((k) => k !== k.toLowerCase() || /[_.]/.test(k)), []);

		r.check(
			"importsDuCode",
			imp.importsDuCode("import torch\nfrom torch import nn\nimport numpy as np, os\n# import pandas\nx = 'import scipy'\nfrom . import y"),
			["torch", "numpy", "os"],
		);
		r.check("importsDuCode indented", imp.importsDuCode("if x:\n    import a.b\n    from c.d import e"), ["a", "c"]);
		r.check(
			"classerImports",
			classerImports(["os", "torch", "numpyy"]),
			{ stdlib: ["os"], connus: ["torch"], inconnus: ["numpyy"] },
		);
	},
);

r.done();
