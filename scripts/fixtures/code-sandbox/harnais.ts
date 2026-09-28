/* Harness for `check:code-sandbox`: the REAL `code-sandbox.ts` module, in a
   real Electron. Each case prints a `CAS <name> <json>` line. */
import { app, protocol } from "electron";
import { PRIVILEGES_CODE, creerBacASable, resoudreFichierCode } from "../../../apps/windows/electron/code-sandbox";

protocol.registerSchemesAsPrivileged([PRIVILEGES_CODE]);
const racine = process.env.NEO_CODE_RACINE!;
const langages = process.env.NEO_CODE_LANGAGES!;
const preload = process.env.NEO_CODE_PRELOAD!;

/* I4 (b): `resoudreFichierCode` proved in PURE form, without Electron or
   Python. A literal `..` is NOT a useful case here: the `URL` constructor
   (Node as much as Chromium) already normalises `.`/`..` segments of a
   hierarchical path WHILE parsing — `app/../../../Windows/win.ini` becomes
   `app/Windows/win.ini` before `resoudreFichierCode` ever runs (verified:
   `new URL(...)` then reading `.pathname`). What remains are the cases where
   that normalisation plays NO role: a re-injected absolute path, another
   host, and a `..` revealed only by OUR OWN `decodeURIComponent` (the
   `%5C` — the backslash that Windows accepts as a separator, never
   normalised by `URL`). */
{
	const cas = (nom: string, url: string, doitPasser: boolean) => {
		const r = resoudreFichierCode(racine, langages, url);
		console.log(`CAS resoudre-${nom} ${JSON.stringify({ refuse: r === null, attendu: !doitPasser })}`);
	};
	cas("valide", "neo-code://app/index.html", true);
	cas("backslash-encode", "neo-code://app/%5Cwin.ini", false);
	cas("chemin-absolu", "neo-code://app//C:/Windows/win.ini", false);
	cas("autre-hote", "neo-code://autre/index.html", false);
}

/* Two forms of escape, depending on the target origin:
   - SAME ORIGIN (`traversee`, `neo-code://`): the response is READABLE
     normally, a 403/404 from our own handler proves nothing — only content
     (200) would prove the leak.
   - OTHER ORIGIN (`fichier`, `reseau`): `mode: "no-cors"` REQUESTED ON
     PURPOSE. CORS only hides the BODY of the response (it becomes
     "opaque", status 0 on the JS side); the REQUEST itself still leaves —
     a trapped quiz can exfiltrate data in the URL without ever reading the
     response. A readable status (200) OR a resolved opaque response (0)
     therefore both count as a leak; only a rejection (`BLOQUE`, the request
     never left) proves nothing leaked. */
const EVASION_MEME_ORIGINE = (cible: string) => [
	"import pyodide_js",
	"try:",
	"    F = pyodide_js.loadPackage.constructor",
	`    t = await F('return fetch("${cible}").then(r => "LU " + r.status).catch(e => "BLOQUE")')()`,
	"    print(t)",
	"except Exception as e:",
	"    print('REFUSE', type(e).__name__)",
].join("\n");

const EVASION_AUTRE_ORIGINE = (cible: string) => [
	"import pyodide_js",
	"try:",
	"    F = pyodide_js.loadPackage.constructor",
	`    t = await F('return fetch("${cible}", {mode: "no-cors"}).then(r => "LU " + r.status).catch(e => "BLOQUE")')()`,
	"    print(t)",
	"except Exception as e:",
	"    print('REFUSE', type(e).__name__)",
].join("\n");

/* (N2): nothing must survive from one trial to the next beyond the worker —
   the partition (IndexedDB of the `neo-code://app` origin) is a separate
   channel, SHARED by construction between two successive workers. Trial 1
   mounts IDBFS on `/p`, writes `trace.txt`, syncs (JS → IndexedDB); trial 2,
   in a fresh worker, remounts `/p` and syncs the other way round
   (IndexedDB → JS) before checking. Without `clearStorageData()` after each
   trial, trial 2 would read back what trial 1 left. */
/* `FS.syncfs` (IDBFS) calls the callback once, but through a PyProxy created
   on the fly (a Python function passed as-is) that is destroyed as soon as
   the synchronous call `FS.syncfs(...)` returns — before the real
   (asynchronous, IndexedDB) callback ever gets to run. `create_once_callable`
   turns it into a proxy that survives until its single call. */
const IDBFS_ESSAI_1 = [
	"import asyncio, pyodide_js",
	"from pyodide.ffi import create_once_callable",
	"try:",
	"    FS = pyodide_js.FS",
	"    try:",
	"        FS.mkdir('/p')",
	"    except Exception:",
	"        pass",
	"    FS.mount(FS.filesystems.IDBFS, {}, '/p')",
	"    with open('/p/trace.txt', 'w') as fh:",
	"        fh.write('laisse par essai 1')",
	"    fut = asyncio.get_event_loop().create_future()",
	"    FS.syncfs(False, create_once_callable(lambda err: (not fut.done()) and fut.set_result(True)))",
	"    await fut",
	"    print('ECRIT')",
	"except Exception as e:",
	"    print('ERREUR', type(e).__name__, str(e))",
].join("\n");
const IDBFS_ESSAI_2 = [
	"import asyncio, os, pyodide_js",
	"from pyodide.ffi import create_once_callable",
	"try:",
	"    FS = pyodide_js.FS",
	"    try:",
	"        FS.mkdir('/p')",
	"    except Exception:",
	"        pass",
	"    FS.mount(FS.filesystems.IDBFS, {}, '/p')",
	"    fut = asyncio.get_event_loop().create_future()",
	"    FS.syncfs(True, create_once_callable(lambda err: (not fut.done()) and fut.set_result(True)))",
	"    await fut",
	"    print(os.path.exists('/p/trace.txt'))",
	"except Exception as e:",
	"    print('ERREUR', type(e).__name__, str(e))",
].join("\n");

/* I2: an `asyncio` task started by trial 1 but never awaited must not keep
   running at all once its result is rendered — `terminate()` must kill it
   WITH the worker. Trial 1 schedules writing a marker (via IDBFS, the only
   channel that survives the worker, cf. N2) after a delay longer than the
   trial itself, then renders its result right away; trial 2 waits longer
   than that delay, then checks that the marker does not exist. A
   `terminate()` that failed to kill the task would give it time to write,
   since the whole worker would keep running. */
const ASYNCIO_ESSAI_1 = [
	"import asyncio, pyodide_js",
	"from pyodide.ffi import create_once_callable",
	"FS = pyodide_js.FS",
	"try:",
	"    FS.mkdir('/q')",
	"except Exception:",
	"    pass",
	"FS.mount(FS.filesystems.IDBFS, {}, '/q')",
	"async def ecrire_plus_tard():",
	"    await asyncio.sleep(2)",
	"    with open('/q/asyncio-survit.txt', 'w') as fh:",
	"        fh.write('encore la')",
	"    fut = asyncio.get_event_loop().create_future()",
	"    FS.syncfs(False, create_once_callable(lambda err: (not fut.done()) and fut.set_result(True)))",
	"    await fut",
	"asyncio.ensure_future(ecrire_plus_tard())",
	"print('LANCE')",
].join("\n");
const ASYNCIO_ESSAI_2 = [
	"import asyncio, os, pyodide_js",
	"from pyodide.ffi import create_once_callable",
	"await asyncio.sleep(3)", // gives trial 1's task time to write, if it survived
	"FS = pyodide_js.FS",
	"try:",
	"    FS.mkdir('/q')",
	"except Exception:",
	"    pass",
	"FS.mount(FS.filesystems.IDBFS, {}, '/q')",
	"fut = asyncio.get_event_loop().create_future()",
	"FS.syncfs(True, create_once_callable(lambda err: (not fut.done()) and fut.set_result(True)))",
	"await fut",
	"print(os.path.exists('/q/asyncio-survit.txt'))",
].join("\n");

/* I4 (a): network escape WITHOUT any `Function`/`eval` — through a REAL
   Pyodide code path (`loadPackage` fetches a `.whl` by itself). If the CSP
   alone blocked it (like the cases above, which all go through `Function`),
   this one would prove otherwise: `loadPackage` evaluates nothing, only
   `webRequest.onBeforeRequest` can stop it.
   WARNING (N3): the two cases below discriminate NONE of our layers —
   `loadpackage-file` fails on its own (Pyodide refuses `file:///` as a
   package name BEFORE any request) and `loadpackage-http` fails even
   without CSP or `webRequest` (`loadPackage`'s `cors` request is rejected by
   CORS after being sent, never cancelled by `webRequest`). Kept as
   documentation of this code path, but the network proof rests only on
   `reseau`/`sanscsp-reseau` (`no-cors` mode, see above). */
const EVASION_LOADPACKAGE = (url: string) => [
	"import pyodide_js",
	"try:",
	`    await pyodide_js.loadPackage("${url}")`,
	"    print('CHARGE')",
	"except Exception as e:",
	"    print('BLOQUE', type(e).__name__)",
].join("\n");

/* I4 (c): the CSP is indeed there, independently of the network —
   `Function` must be refused even on code that touches neither disk nor
   network. */
const CODE_CSP = [
	"import pyodide_js",
	"try:",
	"    F = pyodide_js.loadPackage.constructor",
	"    print(F('return 1 + 1')())",
	"except Exception as e:",
	"    print('REFUSE', type(e).__name__)",
].join("\n");

/* I1: trial 1 patches `pyodide.code.eval_code_async` (the real entry point
   of `runPythonAsync`, verified in `pyodide.asm.mjs`) to let any `after`
   pass; trial 2 checks that no trace of trial 1 survives AND that a failing
   `after` still comes back `error` — a reused interpreter would wrongly
   render `ok`. */
const FUITE_ESSAI_1 = [
	"import builtins, pyodide.code as c",
	"builtins.X = 1",
	"orig = c.eval_code_async",
	"async def espion(code, globals=None, locals=None, filename=None, **k):",
	"    if filename == 'checks.py': return None",
	"    return await orig(code, globals, locals, filename, **k)",
	"c.eval_code_async = espion",
].join("\n");
const FUITE_ESSAI_2 = "print(hasattr(__import__('builtins'), 'X'))";

/* I4 (d): a sandbox WITHOUT a CSP, to prove that `webRequest` blocks the
   network ALONE — independently of the CSP layer. A SEPARATE Electron
   process (`NEO_CODE_SANS_CSP=1`, launched separately by
   `check-code-sandbox.mjs`): two `creerBacASable` in the same process, even
   on two partitions, make the SECOND `protocol.handle` of the privileged
   scheme fail (`ERR_FAILED` measured at the trial — an Electron
   implementation detail, not a property of the sandbox), so they are never
   combined here. The code reuses `EVASION_AUTRE_ORIGINE` (with
   `Function`/eval, allowed HERE since the CSP is off) rather than
   `loadPackage`: `loadPackage` makes a `cors` request, which Chromium
   refuses anyway for a cross-origin request without the right header —
   webRequest or not, the measurement would prove nothing. The `mode:
   "no-cors"` of `EVASION_AUTRE_ORIGINE` is, on the other hand, a case that
   Chromium normally lets THROUGH (that is the whole point of `no-cors`):
   only `webRequest.onBeforeRequest` can still stop it, which makes the test
   actually discriminating for this layer. */
const sansCsp = process.env.NEO_CODE_SANS_CSP === "1";

void app.whenReady().then(async () => {
	if (sansCsp) {
		const bac = creerBacASable(racine, langages, preload, { csp: false });
		const t0 = Date.now();
		const r = await bac.run({ language: "python", code: EVASION_AUTRE_ORIGINE("https://example.com"), stdin: "", timeoutMs: 5000 });
		console.log(`CAS sanscsp-reseau ${JSON.stringify({ ...r, ms: Date.now() - t0 })}`);
		bac.fermer();
		app.quit();
		return;
	}

	const bac = creerBacASable(racine, langages, preload);
	const cas = async (nom: string, job: { code: string; stdin?: string; after?: string; timeoutMs?: number }) => {
		const t0 = Date.now();
		const r = await bac.run({ language: "python", code: job.code, stdin: job.stdin ?? "", after: job.after, timeoutMs: job.timeoutMs ?? 5000 });
		console.log(`CAS ${nom} ${JSON.stringify({ ...r, ms: Date.now() - t0 })}`);
	};
	await cas("simple", { code: "print('bonjour', 6 * 7)", timeoutMs: 60000 });
	await cas("echo", { code: "a = int(input('Saisir un entier a : '))\nb = int(input('Saisir un entier b : '))\nprint('Le maximum est a =', max(a, b))", stdin: "24\n18" });
	await cas("eof", { code: "input()\ninput()", stdin: "1" });
	await cas("isolement", { code: "print('x' in globals())" });
	await cas("asserts-ok", { code: "def f(x):\n    return 2 * x", after: "assert f(2) == 4" });
	await cas("asserts-ko", { code: "def f(x):\n    return x", after: "assert f(2) == 4" });
	await cas("fichier", { code: EVASION_AUTRE_ORIGINE("file:///C:/Windows/win.ini") });
	await cas("reseau", { code: EVASION_AUTRE_ORIGINE("https://example.com") });
	await cas("traversee", { code: EVASION_MEME_ORIGINE("neo-code://app/../../../../Windows/win.ini") });
	await cas("loadpackage-http", { code: EVASION_LOADPACKAGE("https://example.com/x-1.0-py3-none-any.whl") });
	await cas("loadpackage-file", { code: EVASION_LOADPACKAGE("file:///C:/Windows/win.ini") });
	await cas("csp", { code: CODE_CSP });
	await cas("fuite-essai1", { code: FUITE_ESSAI_1 });
	await cas("fuite-essai2", { code: FUITE_ESSAI_2, after: "assert False" });
	await cas("idbfs-essai1", { code: IDBFS_ESSAI_1 });
	await cas("idbfs-essai2", { code: IDBFS_ESSAI_2 });
	await cas("asyncio-essai1", { code: ASYNCIO_ESSAI_1 });
	await cas("asyncio-essai2", { code: ASYNCIO_ESSAI_2, timeoutMs: 8000 });
	await cas("os-exit", { code: "import os\nos._exit(0)" });
	await cas("apres-exit", { code: "print('encore-vivant')", timeoutMs: 60000 });
	await cas("boucle", { code: "while True:\n    pass", timeoutMs: 2000 });
	await cas("apres-boucle", { code: "print('encore')", timeoutMs: 60000 });
	await cas("flot", { code: "while True:\n    print('x' * 100)", timeoutMs: 3000 });

	/* Task 3 of the C/C++ execution plan (generalising the sandbox): an
	   unknown language is refused by `page.js` before any worker exists, and
	   `neo-code://app/languages/..` can never climb back out of the packs
	   directory (`resoudreFichierCode`) into the sandbox's own files. */
	console.log(`CAS langue-inconnue ${JSON.stringify(await bac.run({ language: "cobol" as never, code: "x", stdin: "", timeoutMs: 2000 }))}`);
	console.log(`CAS schema-langues-traversee ${JSON.stringify(await bac.run({ language: "python", timeoutMs: 5000, stdin: "", code: [
		"import js",
		"from pyodide.ffi import run_sync",
		"try:",
		"    r = run_sync(js.fetch('neo-code://app/languages/../index.html'))",
		"    print('LU', r.status)",
		"except Exception as e:",
		"    print('REFUSE')",
	].join("\n") }))}`);

	bac.fermer();
	app.quit();
});
