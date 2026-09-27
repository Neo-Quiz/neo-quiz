/* LE WORKER PYTHON (module : Pyodide 314 refuse les workers classiques,
   mesuré le 2026-09-23). `jsglobals: {}` coupe le module `js`, mais ce
   n'est PAS une frontière de sécurité : la CSP du schéma (pas
   d'`unsafe-eval`) et la partition du principal le sont. */
import { loadPyodide } from "./pyodide/pyodide.mjs";

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

let pret = null;
const charger = () => (pret ??= loadPyodide({ indexURL: "./pyodide/", jsglobals: {} }));

self.onmessage = async (e) => {
	const m = e.data;
	if (m.type === "chauffer") { charger().catch(() => { pret = null; }); return; }
	if (m.type !== "executer") return;
	let py;
	try { py = await charger(); }
	catch (err) { pret = null; self.postMessage({ id: m.id, res: { status: "unavailable", stdout: "", error: String(err) } }); return; }

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
		ns.set("__neo_stdin", m.stdin);
		py.runPython(PRELUDE, { globals: ns });
		await py.runPythonAsync(m.code, { globals: ns, filename: "main.py" });
		if (m.after) await py.runPythonAsync(m.after, { globals: ns, filename: "checks.py" });
		self.postMessage({ id: m.id, res: { status: tropLong ? "too-long" : "ok", stdout: sortie } });
	} catch (err) {
		self.postMessage({ id: m.id, res: { status: tropLong ? "too-long" : "error", stdout: sortie, error: String(err && err.message || err) } });
	} finally {
		ns.destroy();
	}
};
