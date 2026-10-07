/* LE WORKER PYTHON (module : Pyodide 314 refuse les workers classiques,
   mesuré le 2026-09-23). `jsglobals: {}` coupe le module `js`, mais ce
   n'est PAS une frontière de sécurité : la CSP du schéma (pas
   d'`unsafe-eval`) et la partition du principal le sont. */
const PLAFOND = 20000;
/* Le prélude remplace `sys.stdin` et `input()` : l'invite PUIS la ligne
   lue sont écrites, comme dans un vrai terminal. La sortie ressemble ainsi
   mot pour mot à la « sortie attendue » d'un sujet de TP. Exécuté à part :
   il ne décale pas les numéros de ligne du code de l'élève. */
const PRELUDE = [
	"import sys, io, builtins",
	"sys.stdin = io.StringIO(__neo_stdin)",
	"def input(prompt=''):",
	"    print(prompt, end='')",
	"    line = sys.stdin.readline()",
	"    if not line:",
	"        raise EOFError('EOF when reading a line')",
	"    line = line.rstrip(chr(10))",
	"    print(line)",
	"    return line",
	"builtins.input = input",
	"del input",
].join("\n");

/* Ce worker est CONSOMMÉ par un seul essai (spec 2026-09-27, correctif I1-I3
   de la revue de sécurité) : la page le tue dès le résultat rendu, jamais de
   second `executer` ici. `pret` ne sert donc qu'à distinguer « chargement en
   cours » de « pas encore lancé » pendant la préchauffe. */
let pret = null;
/* Pyodide comes from the DOWNLOADED pack (`languages/python/`, served by the
   sandbox scheme) and is imported dynamically: a missing pack makes the
   import reject, which the `executer` handler answers as `unavailable`
   instead of crashing the worker at load time. */
/* The `js` module of Python: NOT the whole worker scope. micropip's `pyfetch`
   needs exactly these five (measured 2026-10-07: with `{}`, `pyfetch` dies on
   `NameError: name 'AbortController' is not defined` and micropip answers
   `Can't fetch metadata`). Still no boundary: `fetch` can only reach
   `neo-code:` (CSP `connect-src 'self'` + the partition's `webRequest`), and
   `Function` is refused by the CSP. */
const JSGLOBALS = {
	AbortController: globalThis.AbortController,
	AbortSignal: globalThis.AbortSignal,
	Object: globalThis.Object,
	Request: globalThis.Request,
	fetch: globalThis.fetch.bind(globalThis),
};
const charger = () => (pret ??= import("./languages/python/pyodide.mjs").then(m => m.loadPyodide({ indexURL: "./languages/python/", jsglobals: JSGLOBALS })));

/* Tronqué ICI, avant l'IPC : une exception de 100 Mo (`raise
   Exception("x" * 10**8)`) ne doit pas traverser worker → page → principal
   en entier (revue, M2). */
const borner = (s) => (s.length > PLAFOND ? s.slice(0, PLAFOND) : s);

self.onmessage = async (e) => {
	const m = e.data;
	if (m.type === "chauffer") { charger().catch(() => { pret = null; }); return; }
	if (m.type !== "executer") return;
	let py;
	try { py = await charger(); }
	catch (err) { pret = null; self.postMessage({ id: m.id, res: { status: "unavailable", stdout: "", error: borner(String(err)) } }); return; }
	/* Chargement terminé : la page démarre ICI le délai de l'essai (M7),
	   jamais avant — sinon un délai court expirerait pendant `loadPyodide`. */
	self.postMessage({ id: m.id, type: "pret" });

	let sortie = "", tropLong = false;
	const ecrire = (s) => {
		if (tropLong) return;
		sortie += s + "\n";
		if (sortie.length > PLAFOND) { sortie = sortie.slice(0, PLAFOND); tropLong = true; }
	};
	py.setStdout({ batched: ecrire });
	py.setStderr({ batched: ecrire });
	const ns = py.globals.get("dict")();
	try {
		/* Packages on demand: the main process fetches and hash-checks them
		   (`paquets-python.ts`); nothing here reaches the network. micropip
		   (pure PyPI wheels) is loaded only for code that names it, and its
		   index points at the proxy. */
		await py.loadPackagesFromImports(m.code);
		if (m.after) await py.loadPackagesFromImports(m.after);
		if (/\bmicropip\b/.test(m.code)) {
			await py.loadPackage("micropip");
			py.runPython("import micropip\nmicropip.set_index_urls([\"neo-code://app/pypi/simple/{package_name}/\"])");
		}
		ns.set("__neo_stdin", m.stdin);
		py.runPython(PRELUDE, { globals: ns });
		await py.runPythonAsync(m.code, { globals: ns, filename: "main.py" });
		if (m.after) await py.runPythonAsync(m.after, { globals: ns, filename: "checks.py" });
		self.postMessage({ id: m.id, res: { status: tropLong ? "too-long" : "ok", stdout: sortie } });
	} catch (err) {
		self.postMessage({ id: m.id, res: { status: tropLong ? "too-long" : "error", stdout: sortie, error: borner(String(err && err.message || err)) } });
	} finally {
		ns.destroy();
	}
};
