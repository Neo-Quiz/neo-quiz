/* Harnais de `check:python-sandbox` : le VRAI module `python.ts`, dans un
   vrai Electron. Chaque cas rend une ligne `CAS <nom> <json>`. */
import { app, protocol } from "electron";
import { PRIVILEGES_PYTHON, creerBacASable } from "../../../apps/windows/electron/python";

protocol.registerSchemesAsPrivileged([PRIVILEGES_PYTHON]);
const racine = process.env.NEO_PYTHON_RACINE!;
const preload = process.env.NEO_PYTHON_PRELOAD!;

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

void app.whenReady().then(async () => {
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
	await cas("boucle", { code: "while True:\n    pass", timeoutMs: 2000 });
	await cas("apres-boucle", { code: "print('encore')", timeoutMs: 60000 });
	await cas("flot", { code: "while True:\n    print('x' * 100)", timeoutMs: 3000 });
	bac.fermer();
	app.quit();
});
