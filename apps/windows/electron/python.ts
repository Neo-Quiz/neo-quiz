/* ══════════════════════════════════════════════════════════
   LE BAC À SABLE PYTHON (spec 2026-09-23-exercice-python-design.md §3)

   POURQUOI PAS DANS LA FENÊTRE DE L'APP : mesuré le 2026-09-23, depuis
   Python, `pyodide_js.loadPackage.constructor` donne `Function`. Dans la
   fenêtre de l'app (origine `file://`), ce JavaScript a lu
   `C:\Windows\win.ini` et joint `https://example.com`. Un quiz PARTAGÉ
   porte du code (`solution`, `starter`, `asserts`) que l'app exécute.

   DEUX COUCHES, chacune mesurée :
   1. la CSP de chaque réponse du schéma, sans `unsafe-eval` : `Function`
      est refusé dans le worker ;
   2. une fenêtre CACHÉE dans sa propre partition en mémoire, servie par
      `neo-python://`, où `file:` rend 403 (et Chromium refuse de toute
      façon `file://` à une autre origine) et où `webRequest` annule tout
      ce qui n'est pas `neo-python:`.
══════════════════════════════════════════════════════════ */

import { BrowserWindow, ipcMain, net, session } from "electron";
import type { CustomScheme } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PythonJob, PythonRun } from "../../../src/host/types";
import { CANAUX_BAC } from "./python-canaux";

export const SCHEMA_PYTHON = "neo-python";
const PARTITION = "neo-python"; // sans `persist:` : en mémoire, rien sur disque
const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'";
const SECOURS_MS = 3000;
const INACTIVITE_MS = 10 * 60 * 1000;
/* File d'attente BORNÉE (M3) : le rendu est de confiance, mais un travail
   sans limite pourrait s'accumuler indéfiniment. */
const PLAFOND_FILE = 8;

/* Enregistré par `main.ts` dans son UNIQUE appel à
   `registerSchemesAsPrivileged` (Electron n'en retient qu'un). */
export const PRIVILEGES_PYTHON: CustomScheme = {
	scheme: SCHEMA_PYTHON,
	privileges: { standard: true, secure: true, supportFetchAPI: true },
};

/** Le fichier du bac à sable que désigne cette URL, ou `null` s'il sort de
    `racine` (`..`, chemin absolu, autre hôte que `app`). */
export function resoudreFichierPython(racine: string, url: string): string | null {
	let u: URL;
	try { u = new URL(url); } catch { return null; }
	if (u.protocol !== `${SCHEMA_PYTHON}:` || u.hostname !== "app") return null;
	const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
	if (!rel) return null;
	const base = path.resolve(racine);
	const abs = path.resolve(base, rel);
	return abs.startsWith(base + path.sep) ? abs : null;
}

export interface BacASable {
	run(job: PythonJob): Promise<PythonRun>;
	warm(): void;
	fermer(): void;
}

/* `options.csp` n'existe que pour le harnais de `check:python-sandbox`
   (revue I4, cas `NEO_PYTHON_SANS_CSP`, un PROCESSUS Electron à part) :
   désactiver la CSP prouve que `webRequest.onBeforeRequest` bloque SEUL le
   réseau, sans dépendre du refus de `Function` par la CSP. Tout appelant réel
   (python.ts n'a qu'un seul appelant, `main.ts`) omet `options` et garde
   donc les deux couches. */
export function creerBacASable(racine: string, preload: string, options?: { csp?: boolean }): BacASable {
	const cspActive = options?.csp !== false;
	let fenetre: BrowserWindow | null = null;
	let pret: Promise<BrowserWindow> | null = null;
	let sessionPrete = false;
	let prochainId = 1;
	let file: Promise<unknown> = Promise.resolve();
	let enFile = 0;
	/* Le travail en cours pendant un RECHARGEMENT de secours (M3) : la page
	   perd son worker en vol, et lui envoyer le travail suivant avant la fin
	   du rechargement le perdrait (il attendrait `timeoutMs + SECOURS_MS`
	   pour rien). */
	let pretApresRecharge: Promise<void> | null = null;
	let minuterieInactivite: ReturnType<typeof setTimeout> | null = null;
	const attentes = new Map<number, (r: PythonRun) => void>();

	function preparerSession(): Electron.Session {
		const ses = session.fromPartition(PARTITION);
		if (sessionPrete) return ses;
		sessionPrete = true;
		ses.protocol.handle(SCHEMA_PYTHON, async (req) => {
			const abs = resoudreFichierPython(racine, req.url);
			if (!abs) return new Response(null, { status: 403 });
			try {
				const r = await net.fetch(pathToFileURL(abs).href);
				const h = new Headers(r.headers);
				if (cspActive) h.set("Content-Security-Policy", CSP);
				return new Response(r.body, { status: r.status, headers: h });
			} catch {
				return new Response(null, { status: 404 });
			}
		});
		ses.protocol.handle("file", () => new Response(null, { status: 403 }));
		ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !d.url.startsWith(`${SCHEMA_PYTHON}:`) }));
		ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
		ses.setPermissionCheckHandler(() => false);
		return ses;
	}

	ipcMain.on(CANAUX_BAC.resultat, (e, id: unknown, res: unknown) => {
		/* Seule la fenêtre du bac à sable rend des résultats. */
		if (!fenetre || e.sender !== fenetre.webContents) return;
		const r = attentes.get(Number(id));
		if (!r) return;
		attentes.delete(Number(id));
		r(normaliserResultat(res));
	});

	function ouvrir(): Promise<BrowserWindow> {
		if (pret) return pret;
		const ses = preparerSession();
		const f = new BrowserWindow({
			show: false,
			webPreferences: { session: ses, preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
		});
		f.webContents.on("will-navigate", ev => ev.preventDefault());
		f.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		f.on("closed", () => {
			fenetre = null; pret = null;
			for (const [, r] of attentes) r({ status: "unavailable", stdout: "" });
			attentes.clear();
		});
		fenetre = f;
		pret = f.loadURL(`${SCHEMA_PYTHON}://app/index.html`).then(() => f, (e) => { pret = null; f.destroy(); throw e; });
		return pret;
	}

	function rearmerInactivite(): void {
		if (minuterieInactivite) clearTimeout(minuterieInactivite);
		minuterieInactivite = setTimeout(() => fermer(), INACTIVITE_MS);
	}

	function executer(job: PythonJob): Promise<PythonRun> {
		return ouvrir().then(async f => {
			/* Un rechargement de secours est en cours : attendre qu'il finisse
			   avant d'envoyer ce travail, sinon il part dans le vide (M3). */
			if (pretApresRecharge) { await pretApresRecharge; pretApresRecharge = null; }
			return new Promise<PythonRun>((resolve) => {
				const id = prochainId++;
				const secours = setTimeout(() => {
					/* La page n'a pas répondu : on la recharge (le worker meurt avec). */
					if (!attentes.delete(id)) return;
					pretApresRecharge = new Promise<void>((r) => f.webContents.once("did-finish-load", () => r()));
					f.webContents.reload();
					resolve({ status: "timeout", stdout: "" });
				}, job.timeoutMs + SECOURS_MS);
				attentes.set(id, (r) => { clearTimeout(secours); resolve(r); });
				f.webContents.send(CANAUX_BAC.travail, { ...job, id });
			});
		}, (): PythonRun => ({ status: "unavailable", stdout: "" }));
	}

	function fermer(): void {
		if (minuterieInactivite) { clearTimeout(minuterieInactivite); minuterieInactivite = null; }
		fenetre?.destroy();
	}

	return {
		run(job) {
			if (enFile >= PLAFOND_FILE) {
				return Promise.resolve({ status: "unavailable", stdout: "", error: "file d'attente pleine" });
			}
			rearmerInactivite();
			enFile++;
			const suite = file.then(() => executer(job)).finally(() => { enFile--; });
			file = suite.catch(() => undefined);
			return suite;
		},
		warm() {
			rearmerInactivite();
			void ouvrir().then(f => f.webContents.send(CANAUX_BAC.chauffe), () => undefined);
		},
		fermer,
	};
}

/* Ce qui revient de la page est traité comme une donnée NON fiable : on ne
   garde que les champs du contrat, typés. */
function normaliserResultat(res: unknown): PythonRun {
	const o = (res ?? {}) as Record<string, unknown>;
	const statuts = ["ok", "error", "timeout", "too-long", "unavailable"] as const;
	const status = statuts.includes(o.status as typeof statuts[number]) ? o.status as PythonRun["status"] : "error";
	const stdout = typeof o.stdout === "string" ? o.stdout.slice(0, 20000) : "";
	return typeof o.error === "string" ? { status, stdout, error: o.error.slice(0, 20000) } : { status, stdout };
}
