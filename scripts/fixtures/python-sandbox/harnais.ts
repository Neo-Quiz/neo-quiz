/* Harnais de `check:python-sandbox` : le VRAI module `python.ts`, dans un
   vrai Electron. Chaque cas rend une ligne `CAS <nom> <json>`. */
import { app, protocol } from "electron";
import { PRIVILEGES_PYTHON, creerBacASable, resoudreFichierPython } from "../../../apps/windows/electron/python";

protocol.registerSchemesAsPrivileged([PRIVILEGES_PYTHON]);
const racine = process.env.NEO_PYTHON_RACINE!;
const preload = process.env.NEO_PYTHON_PRELOAD!;

/* I4 (b) : `resoudreFichierPython` éprouvé en PUR, sans Electron ni Python.
   `..` littéral n'est PAS un cas utile ici : le constructeur `URL` (Node
   comme Chromium) normalise déjà les segments `.`/`..` d'un chemin
   hiérarchique PENDANT le parsing — `app/../../../Windows/win.ini` devient
   `app/Windows/win.ini` avant même que `resoudreFichierPython` s'exécute
   (vérifié : `new URL(...)` puis lecture de `.pathname`). Les cas qui
   restent sont ceux où cette normalisation ne joue AUCUN rôle : un chemin
   absolu réinjecté, un autre hôte, et un `..` révélé seulement par NOTRE
   propre `decodeURIComponent` (le `%5C` — la barre oblique inverse que
   Windows accepte comme séparateur, jamais normalisée par `URL`). */
{
	const cas = (nom: string, url: string, doitPasser: boolean) => {
		const r = resoudreFichierPython(racine, url);
		console.log(`CAS resoudre-${nom} ${JSON.stringify({ refuse: r === null, attendu: !doitPasser })}`);
	};
	cas("valide", "neo-python://app/index.html", true);
	cas("backslash-encode", "neo-python://app/%5Cwin.ini", false);
	cas("chemin-absolu", "neo-python://app//C:/Windows/win.ini", false);
	cas("autre-hote", "neo-python://autre/index.html", false);
}

/* Deux formes d'évasion, selon l'origine visée :
   - MÊME ORIGINE (`traversee`, `neo-python://`) : la réponse est LISIBLE
     normalement, un 403/404 de notre propre gestionnaire ne prouve rien —
     seul un contenu (200) prouverait la fuite.
   - AUTRE ORIGINE (`fichier`, `reseau`) : `mode: "no-cors"` DEMANDÉ EXPRÈS.
     CORS ne cache que le CORPS de la réponse (elle devient « opaque »,
     statut 0 côté JS) ; la REQUÊTE, elle, part quand même — un quiz piégé
     peut exfiltrer des données dans l'URL sans jamais lire la réponse. Un
     statut lisible (200) OU une réponse opaque résolue (0) valent donc tous
     deux une fuite ; seul un rejet (`BLOQUE`, la requête n'est jamais
     partie) prouve que rien n'a fui. */
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

/* I4 (a) : évasion réseau SANS `Function`/`eval` du tout — par un chemin
   RÉEL de Pyodide (`loadPackage` va chercher un `.whl` par lui-même). Si la
   CSP seule bloquait (comme les cas ci-dessus, qui passent tous par
   `Function`), celui-ci prouverait le contraire : `loadPackage` n'évalue
   rien, seul `webRequest.onBeforeRequest` peut l'arrêter. */
const EVASION_LOADPACKAGE = (url: string) => [
	"import pyodide_js",
	"try:",
	`    await pyodide_js.loadPackage("${url}")`,
	"    print('CHARGE')",
	"except Exception as e:",
	"    print('BLOQUE', type(e).__name__)",
].join("\n");

/* I4 (c) : la CSP est bien là, indépendamment du réseau — `Function` doit
   être refusé même sur du code qui ne touche ni disque ni réseau. */
const CODE_CSP = [
	"import pyodide_js",
	"try:",
	"    F = pyodide_js.loadPackage.constructor",
	"    print(F('return 1 + 1')())",
	"except Exception as e:",
	"    print('REFUSE', type(e).__name__)",
].join("\n");

/* I1 : essai 1 patche `pyodide.code.eval_code_async` (le point d'entrée réel
   de `runPythonAsync`, vérifié dans `pyodide.asm.mjs`) pour faire passer
   n'importe quel `after` ; essai 2 vérifie qu'aucune trace de l'essai 1 ne
   survit ET qu'un `after` qui échoue reste bien `error` — un interpréteur
   réutilisé rendrait `ok` à tort. */
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

/* I4 (d) : un bac SANS CSP, pour prouver que `webRequest` bloque SEUL le
   réseau — indépendamment de la couche CSP. Un PROCESSUS Electron à part
   (`NEO_PYTHON_SANS_CSP=1`, lancé séparément par `check-python-sandbox.mjs`) :
   deux `creerBacASable` dans le même processus, même sur deux partitions,
   font échouer le SECOND `protocol.handle` du schéma privilégié
   (`ERR_FAILED` mesuré à l'essai — un détail d'implémentation d'Electron,
   pas une propriété du bac à sable), donc pas question de les cumuler ici.
   Le CODE réutilise `EVASION_AUTRE_ORIGINE` (avec `Function`/eval, permis ICI
   puisque la CSP est coupée) plutôt que `loadPackage` : `loadPackage` fait
   une requête `cors`, que Chromium refuse de toute façon pour un cross-origin
   sans en-tête adéquat — webRequest ou pas, la mesure ne prouverait rien. Le
   `mode: "no-cors"` de `EVASION_AUTRE_ORIGINE` est, lui, un cas que Chromium
   laisse normalement PARTIR (c'est tout l'intérêt de `no-cors`) : seul
   `webRequest.onBeforeRequest` peut encore l'arrêter, ce qui rend le test
   réellement discriminant pour cette couche. */
const sansCsp = process.env.NEO_PYTHON_SANS_CSP === "1";

void app.whenReady().then(async () => {
	if (sansCsp) {
		const bac = creerBacASable(racine, preload, { csp: false });
		const t0 = Date.now();
		const r = await bac.run({ code: EVASION_AUTRE_ORIGINE("https://example.com"), stdin: "", timeoutMs: 5000 });
		console.log(`CAS sanscsp-reseau ${JSON.stringify({ ...r, ms: Date.now() - t0 })}`);
		bac.fermer();
		app.quit();
		return;
	}

	const bac = creerBacASable(racine, preload);
	const cas = async (nom: string, job: { code: string; stdin?: string; after?: string; timeoutMs?: number }) => {
		const t0 = Date.now();
		const r = await bac.run({ code: job.code, stdin: job.stdin ?? "", after: job.after, timeoutMs: job.timeoutMs ?? 5000 });
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
	await cas("traversee", { code: EVASION_MEME_ORIGINE("neo-python://app/../../../../Windows/win.ini") });
	await cas("loadpackage-http", { code: EVASION_LOADPACKAGE("https://example.com/x-1.0-py3-none-any.whl") });
	await cas("loadpackage-file", { code: EVASION_LOADPACKAGE("file:///C:/Windows/win.ini") });
	await cas("csp", { code: CODE_CSP });
	await cas("fuite-essai1", { code: FUITE_ESSAI_1 });
	await cas("fuite-essai2", { code: FUITE_ESSAI_2, after: "assert False" });
	await cas("os-exit", { code: "import os\nos._exit(0)" });
	await cas("apres-exit", { code: "print('encore-vivant')", timeoutMs: 60000 });
	await cas("boucle", { code: "while True:\n    pass", timeoutMs: 2000 });
	await cas("apres-boucle", { code: "print('encore')", timeoutMs: 60000 });
	await cas("flot", { code: "while True:\n    print('x' * 100)", timeoutMs: 3000 });
	bac.fermer();
	app.quit();
});
