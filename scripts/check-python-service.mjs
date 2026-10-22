/**
 * The Python service of the main process (apps/windows/electron/python/
 * service.ts), the code path `canaux.ts` calls for a Python block:
 * a run waits for the installs under way, runs one at a time, the package
 * names are checked against the pinned catalogue, installer errors are
 * reduced to three codes, and a stdlib block really runs (on the developer's
 * CPython 3.12 standing in for the managed interpreter; skipped without it).
 *
 *     npm run check:python-service
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const r = makeReporter("Python service");
const temp = mkdtempSync(join(tmpdir(), "neo-python-service-"));

function pythonDuDeveloppeur() {
	if (process.platform !== "win32") return null;
	if (process.env.NQ_PYTHON_EXE) return process.env.NQ_PYTHON_EXE;
	try {
		return execFileSync("py", ["-3.12", "-c", "import sys;print(sys.executable)"], { encoding: "utf8", windowsHide: true, timeout: 20000 }).trim() || null;
	} catch { return null; }
}

try {
	await withSrcModule(["apps/windows/electron/python/service.ts", "apps/windows/electron/python/installation.ts", "apps/windows/electron/python/execution.ts"], async ({ creerServicePython }, { erreurPython }, { attendreNettoyages }) => {
		const exe = pythonDuDeveloppeur() ?? join(temp, "absent.exe");
		/** A fake installation: `installer` is held open by `liberer()`. */
		function fausse({ interprete = true, paquets = [], echec = null } = {}) {
			const etat = { interprete, version: "3.12", paquets: paquets.map((nom) => ({ nom, version: "1", octets: 1, requisPar: [] })), octetsTotal: 0 };
			const appels = [];
			let liberer = () => {};
			return {
				appels, etat,
				liberer: () => liberer(),
				installation: {
					etat: async () => etat,
					installer: (cibles) => new Promise((res, rej) => {
						appels.push(cibles);
						liberer = () => {
							if (echec) { rej(echec); return; }
							etat.interprete = true;
							for (const c of cibles) if (!etat.paquets.some((p) => p.nom === c)) etat.paquets.push({ nom: c, version: "1", octets: 1, requisPar: [] });
							res();
						};
					}),
					desinstaller: async () => ({ ok: true }),
					desinstallerRacine: async (nom) => { appels.push(["racine", nom]); return { ok: true }; },
					chemins: () => ({ executable: exe, dossier: temp }),
				},
			};
		}
		const bruit = (code, message) => erreurPython(code, message);

		{
			const f = fausse();
			const s = creerServicePython(f.installation, temp);
			r.check("unknown package refused", (await s.installer(["not-a-package"], () => {})).code, "echec");
			r.check("prototype key refused", (await s.installer(["__proto__"], () => {})).code, "echec");
			r.check("non-array refused", (await s.installer("torch", () => {})).code, "echec");
			r.check("no download started by a refusal", f.appels.length, 0);
			r.check("uninstall of an unknown name refused", (await s.desinstaller("nope")).code, "inconnu");
			/* B2: Settings uninstalls ROOTS; a dependency alone is not a name it may send. */
			r.check("B2: uninstall of a dependency (not a root) refused", [(await s.desinstaller("filelock")).code, f.appels.length], ["inconnu", 0]);
			r.check("B2: uninstall of a root goes to desinstallerRacine", [await s.desinstaller("pandas"), f.appels], [{ ok: true }, [["racine", "pandas"]]]);
			f.appels.length = 0;
			r.check("A3: bytes to install: an unknown name is Infinity", await s.octetsAInstaller(["nope"]), Infinity);
		}
		for (const [code, attendu] of [["reseau", "reseau"], ["empreinte", "empreinte"], ["io", "echec"], ["absent", "echec"], ["occupe", "echec"]]) {
			const f = fausse({ echec: bruit(code, "x") });
			const s = creerServicePython(f.installation, temp);
			const p = s.installer(["numpy"], () => {});
			f.liberer();
			r.check("installer error " + code + " -> " + attendu, (await p).code, attendu);
		}
		{
			// interpreter missing -> not-installed with missing []
			const s = creerServicePython(fausse({ interprete: false }).installation, temp);
			r.check("interpreter missing: not-installed, missing []", JSON.stringify(await s.run({ code: "print(1)\n", timeoutMs: 1000 })), JSON.stringify({ status: "not-installed", stdout: "", missing: [] }));
			// unsupported import is reported even before the interpreter exists
			r.check("unsupported reported without an interpreter", (await s.run({ code: "import pygame\n", timeoutMs: 1000 })).status, "unsupported");
			r.check("missing library named", JSON.stringify((await s.run({ code: "import torch\n", timeoutMs: 1000 })).missing), '["torch"]');
		}
		{
			// a run waits for the in-flight install of what it needs
			const f = fausse({ paquets: [] });
			const s = creerServicePython(f.installation, temp);
			const inst = s.installer(["numpy"], () => {});
			let fini = false;
			const run = s.run({ code: "import numpy\nprint(1)\n", timeoutMs: 1000 }).then((x) => { fini = true; return x; });
			await new Promise((res) => setTimeout(res, 100));
			r.check("run held while the install is in progress", fini, false);
			f.liberer();
			await inst;
			const res = await run;
			r.check("run then sees the installed library (no not-installed)", res.status === "not-installed", false);
		}
		{
			// a stalled install: the run answers timeout within ITS deadline
			const f = fausse();
			const s = creerServicePython(f.installation, temp);
			void s.installer(["numpy"], () => {}); // never released
			const t0 = Date.now();
			const res = await s.run({ code: "print(1)\n", timeoutMs: 300 });
			r.check("stalled install: run times out in its deadline", [res.status, Date.now() - t0 < 3000], ["timeout", true]);
			// abort while queued behind the stalled install: unavailable at once
			const ac = new AbortController();
			const t1 = Date.now();
			const p = s.run({ code: "print(1)\n", timeoutMs: 60000, signal: ac.signal });
			setTimeout(() => ac.abort(), 100);
			const res2 = await p;
			r.check("abort while queued: unavailable at once", [res2.status, Date.now() - t1 < 3000], ["unavailable", true]);
			void s.installer(["numpy"], () => {});
			r.check("identical install shared (one download)", f.appels.length, 1);
			r.check("A3: an install in flight is visible to the remote gate", s.installationEnCours(), true);
		}
		{
			const s = creerServicePython(fausse({ interprete: false }).installation, temp);
			r.check("A3: bytes to install count the interpreter and the closure (numpy alone, then pandas' too)",
				[await s.octetsAInstaller(["numpy"]) > 1_000_000, (await s.octetsAInstaller(["pandas"])) > (await s.octetsAInstaller(["numpy"]))], [true, true]);
			r.check("A3: no install in flight", s.installationEnCours(), false);
		}
		if (!pythonDuDeveloppeur()) {
			console.log("SKIPPED 5 real-run case(s): no CPython 3.12");
		} else {
			const s = creerServicePython(fausse().installation, temp);
			const un = await s.run({ code: "print('stdlib ok', sum(range(5)))\n", timeoutMs: 20000 });
			r.check("stdlib block runs through the service", [un.status, un.stdout], ["ok", "stdlib ok 10\n"]);
			// one at a time, in order
			const ordre = [];
			const lent = s.run({ code: "import time\ntime.sleep(0.6)\nprint('a')\n", timeoutMs: 20000 }).then((x) => { ordre.push("a"); return x; });
			const court = s.run({ code: "print('b')\n", timeoutMs: 20000 }).then((x) => { ordre.push("b"); return x; });
			await Promise.all([lent, court]);
			r.check("runs are serial, in order", ordre, ["a", "b"]);
			const t = await s.run({ code: "while True: pass\n", timeoutMs: 100 });
			r.check("timeout clamped to >= 100 ms still ends in timeout", t.status, "timeout");
			r.check("the queue survives a timeout", (await s.run({ code: "print('c')\n", timeoutMs: 20000 })).stdout, "c\n");
			/* Stop: the engine's button aborts the run's signal (canaux.ts, neo:code/annuler). */
			const arret = new AbortController();
			const t0 = Date.now();
			setTimeout(() => arret.abort(), 400);
			const stoppe = await s.run({ code: "while True: pass\n", timeoutMs: 20000, signal: arret.signal });
			r.check("Stop: a running run aborted answers unavailable at once", [stoppe.status, Date.now() - t0 < 5000], ["unavailable", true]);
			/* The service answers at once; the kill and the cleanup of the run folder
			   finish behind it (the folder is the killed interpreter's working directory). */
			for (let i = 0; i < 20 && readdirSync(temp).length > 0; i++) { await new Promise((res) => setTimeout(res, 250)); await attendreNettoyages(); }
			r.check("Stop: the stopped run leaves no run folder behind", readdirSync(temp), []);
		}
	});
} finally {
	rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
r.done();
