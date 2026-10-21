/**
 * RUNNING ONE PYTHON BLOCK in the main process
 * (apps/windows/electron/python/execution.ts), task 4 of
 * docs/superpowers/plans/2026-10-22-native-python-run.md.
 *
 * WHAT THESE CASES PREVENT, which no typecheck sees:
 * - Python started for a block whose imports cannot be met (an unknown
 *   module, or a known one whose closure is not installed);
 * - a block that loops forever, or that started a child of its own
 *   (`subprocess.Popen`), leaving a `python.exe` behind after its timeout;
 * - a block that prints forever filling the main process's memory;
 * - the app's own environment (tokens, proxies, `PYTHON*`) reaching the code;
 * - a run folder left in the temp directory;
 * - a block waiting forever on an open stdin.
 *
 * DISCRIMINANCE: the timeout kill, the output cap and the environment
 * reduction are replayed on MUTANTS of the real source (kill removed, `/T`
 * removed, cap removed, the app's environment spread in) and must then fail.
 *
 * THE REAL CASES run the developer's CPython 3.12 (`py -3.12`, or the path in
 * `NQ_PYTHON_EXE`), Windows only (the tree kill is `taskkill`). Without it
 * they are SKIPPED and counted, never silently green: when
 * `NQ_PYTHON_RUN_EXPECT_SKIPPED` is set (CI), the skip count must equal it.
 *
 *     npm run check:python-run
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const r = makeReporter("Python run");
const ENTREE = "apps/windows/electron/python/execution.ts";
const temp = mkdtempSync(join(tmpdir(), "neo-python-run-check-"));
/* A secret in the check's own environment: the code must never see it. */
process.env.NQ_SECRET_TOKEN = "leak";

/** Variables that libuv adds to EVERY Windows child environment (its
    `required_vars` in `process.c`), whatever the parent passes. */
const INJECTEES_WINDOWS = ["HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "SYSTEMDRIVE", "USERDOMAIN", "USERNAME", "USERPROFILE", "WINDIR"];
const PERMISES = ["MPLBACKEND", "MPLCONFIGDIR", "PATH", "PYTHONIOENCODING", "SYSTEMROOT", "TEMP", "TMP"];

/** The developer's CPython 3.12, or null. */
function pythonDuDeveloppeur() {
	if (process.platform !== "win32") return null;
	if (process.env.NQ_PYTHON_EXE) return process.env.NQ_PYTHON_EXE;
	try {
		const sortie = execFileSync("py", ["-3.12", "-c", "import sys;print(sys.executable)"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
		return sortie.trim() || null;
	} catch { return null; }
}

/** Is a process with this pid still running? */
function vivant(pid) {
	const sortie = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"], { encoding: "utf8", windowsHide: true });
	return sortie.includes(`"${pid}"`);
}
function tuer(pid) {
	try { execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch { /* gone */ }
}
/** Lets a kill land: tasklist may still list a process for a moment. */
async function vivantApres(pid, ms = 3000) {
	const fin = Date.now() + ms;
	while (Date.now() < fin) {
		if (!vivant(pid)) return false;
		await new Promise(res => setTimeout(res, 150));
	}
	return vivant(pid);
}

/** A mutant of the real module: `from` replaced by `to`. */
async function mutant(from, to) {
	const src = readFileSync(ENTREE, "utf8");
	if (!src.includes(from)) throw new Error("mutation does not apply: " + from);
	const dir = mkdtempSync(join(tmpdir(), "neo-python-run-mutant-"));
	const res = await build({
		stdin: { contents: src.replace(from, to), resolveDir: dirname(resolve(ENTREE)), loader: "ts", sourcefile: ENTREE },
		bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
		banner: { js: "import { createRequire as __cr } from 'node:module'; var require = __cr(import.meta.url);" },
	});
	const out = join(dir, "mutant.mjs");
	writeFileSync(out, res.outputFiles[0].text);
	return { mod: await import(pathToFileURL(out).href), dir };
}

const vide = () => readdirSync(temp).length === 0;
/** 400 lines of 1000 characters, then a normal exit. */
const BORNE = 'for _ in range(400): print("a" * 1000)\n';

await withSrcModule([ENTREE, "apps/windows/electron/python/catalogue.ts"], async (ex, cat) => {
	const { executerPython, verifierImports, PLAFOND_SORTIE } = ex;
	const absent = join(temp, "no-such-python.exe");
	const tout = new Set(Object.keys(cat.PAQUETS));

	/* ── Imports, judged before anything starts (pure, every platform) ── */
	r.check("the cap is 256 KiB", PLAFOND_SORTIE, 262144);
	r.check("unknown import: unsupported, Python never started",
		await executerPython({ code: "import numpyy\n", timeoutMs: 1000 }, { executable: absent, installes: tout, dossierTemp: temp }),
		{ status: "unsupported", stdout: "", unsupported: ["numpyy"] });
	r.check("several unknown imports, sorted once",
		verifierImports("import zzz, aaa\nfrom zzz import x\n", tout), { status: "unsupported", stdout: "", unsupported: ["aaa", "zzz"] });
	r.check("known, not installed: not-installed with the root package",
		await executerPython({ code: "import torch\n", timeoutMs: 1000 }, { executable: absent, installes: new Set(), dossierTemp: temp }),
		{ status: "not-installed", stdout: "", missing: ["torch"] });
	const torchSeul = new Set(["torch"]);
	r.check("a root without its closure is not installed",
		verifierImports("import torch\n", torchSeul)?.missing, cat.fermeture("torch").length > 1 ? ["torch"] : undefined);
	r.check("whole closure installed: may run", verifierImports("import torch\nimport math\n", new Set(cat.fermeture("torch"))), null);
	r.check("stdlib only: may run", verifierImports("import os, sys, json\n", new Set()), null);
	r.check("an unknown import wins over a missing one",
		verifierImports("import torch\nimport numpyy\n", new Set())?.status, "unsupported");
	r.check("a missing interpreter: unavailable, folder removed",
		(await executerPython({ code: "print(1)\n", timeoutMs: 1000 }, { executable: absent, installes: tout, dossierTemp: temp })).status, "unavailable");
	r.check("nothing left in the temp folder (pure cases)", vide(), true);

	/* ── The real interpreter ── */
	const exe = pythonDuDeveloppeur();
	const REELS = 18;
	let sautes = 0;
	if (!exe) {
		sautes = REELS;
		console.log(`SKIPPED ${sautes} real-run case(s): no CPython 3.12 (${process.platform === "win32" ? "py -3.12 not found" : "not Windows"})`);
	} else {
		const ctx = (extra = {}) => ({ executable: exe, installes: new Set(), dossierTemp: temp, ...extra });
		const run = (code, timeoutMs = 20000, extra = {}) => executerPython({ code, timeoutMs }, ctx(extra));

		r.check("print: ok, LF line ends", await run('print("ok")\n'), { status: "ok", stdout: "ok\n" });

		const err = await run('raise ValueError("x")\n');
		r.check("raise: error carrying the traceback", [err.status, /ValueError: x/.test(err.error ?? "")], ["error", true]);

		const stdin = await run("input()\n");
		r.check("stdin is closed: EOFError, no wait", [stdin.status, /EOFError/.test(stdin.error ?? "")], ["error", true]);

		let pid = 0;
		const boucle = await run("while True: pass\n", 1500, { surDemarrage: p => { pid = p; } });
		r.check("endless loop: timeout", boucle.status, "timeout");
		r.check("endless loop: no python.exe left", pid > 0 && !(await vivantApres(pid)), true);

		let pid2 = 0;
		const petit = await run('import subprocess, sys\np = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])\nprint(p.pid, flush=True)\nwhile True: pass\n', 3000, { surDemarrage: p => { pid2 = p; } });
		const petitPid = Number.parseInt(petit.stdout, 10);
		r.check("grandchild: timeout, its pid printed", [petit.status, petitPid > 0], ["timeout", true]);
		r.check("grandchild: killed with the tree", petitPid > 0 && !(await vivantApres(petitPid)) && !(await vivantApres(pid2)), true);
		if (petitPid > 0) tuer(petitPid);

		let pid3 = 0;
		const bavard = await run('while True: print("a" * 1000)\n', 20000, { surDemarrage: p => { pid3 = p; } });
		r.check("endless print: too-long with exactly the first 256 KiB", [bavard.status, bavard.stdout.length, /^a+\n/.test(bavard.stdout)], ["too-long", 262144, true]);
		r.check("endless print: no python.exe left", pid3 > 0 && !(await vivantApres(pid3)), true);
		const borne = await run(BORNE);
		r.check("400 KB then exit: too-long, first 256 KiB", [borne.status, borne.stdout.length], ["too-long", 262144]);

		const envRun = await run("import os\nprint(','.join(sorted(k.upper() for k in os.environ)))\n");
		const cles = envRun.stdout.trim().split(",");
		r.check("environment: only the allowed keys (and libuv's)", cles, [...PERMISES, ...INJECTEES_WINDOWS].sort());

		const lieux = await run("import os, tempfile\nprint(os.getcwd())\nprint(os.environ['TEMP'] == os.getcwd() == os.environ['MPLCONFIGDIR'])\nprint(os.environ['PATH'])\n");
		const [cwd, memes, path] = lieux.stdout.trim().split("\n");
		r.check("cwd, TEMP and MPLCONFIGDIR: one fresh run folder; PATH: the interpreter's folder",
			[cwd.startsWith(join(temp, "neo-python-run-")), memes, path], [true, "True", dirname(exe)]);

		const ctrl = new AbortController();
		let pid4 = 0;
		setTimeout(() => ctrl.abort(), 500);
		const abandon = await executerPython({ code: "while True: pass\n", timeoutMs: 20000, signal: ctrl.signal }, ctx({ surDemarrage: p => { pid4 = p; } }));
		r.check("abort: unavailable, no python.exe left", [abandon.status, pid4 > 0 && !(await vivantApres(pid4))], ["unavailable", true]);

		r.check("nothing left in the temp folder (real runs)", vide(), true);

		/* ── Discriminance: each mutant must break its case ── */
		{
			const { mod, dir } = await mutant("\t\t\ttuerArbre(enfant);\n", "\n");
			let p = 0;
			const res = await mod.executerPython({ code: "while True: pass\n", timeoutMs: 1000 }, ctx({ surDemarrage: x => { p = x; } }));
			r.check("mutant without the kill leaves python.exe running", [res.status, p > 0 && vivant(p)], ["timeout", true]);
			if (p > 0) tuer(p);
			rmSync(dir, { recursive: true, force: true });
		}
		{
			const { mod, dir } = await mutant('"/T", "/F"', '"/F"');
			const res = await mod.executerPython({ code: 'import subprocess, sys\np = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])\nprint(p.pid, flush=True)\nwhile True: pass\n', timeoutMs: 3000 }, ctx());
			const gp = Number.parseInt(res.stdout, 10);
			r.check("mutant without /T leaves the grandchild running", gp > 0 && vivant(gp), true);
			if (gp > 0) tuer(gp);
			rmSync(dir, { recursive: true, force: true });
		}
		{
			const { mod, dir } = await mutant("if (morceau.length > restant) {", "if (false) {");
			/* A BOUNDED overflow: without the cap, an endless print fills the
			   pipe so fast that libuv on Windows starves the timeout timer
			   (measured: fired after 7.5 s and 1.5 GB). */
			const res = await mod.executerPython({ code: BORNE, timeoutMs: 20000 }, ctx());
			r.check("mutant without the cap returns all 400 KB", [res.status, res.stdout.length], ["ok", 400400]);
			rmSync(dir, { recursive: true, force: true });
		}
		{
			const { mod, dir } = await mutant("const env: NodeJS.ProcessEnv = {", "const env: NodeJS.ProcessEnv = { ...process.env,");
			const res = await mod.executerPython({ code: "import os\nprint(os.environ.get('NQ_SECRET_TOKEN'))\n", timeoutMs: 20000 }, ctx());
			r.check("mutant with the app's environment leaks the secret", res.stdout, "leak\n");
			rmSync(dir, { recursive: true, force: true });
		}
	}

	const attendu = process.env.NQ_PYTHON_RUN_EXPECT_SKIPPED;
	if (attendu !== undefined) r.check("skip count as CI expects", sautes, Number(attendu));
});

rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
r.done();
