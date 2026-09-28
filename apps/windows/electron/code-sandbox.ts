/* ══════════════════════════════════════════════════════════
   THE CODE SANDBOX (spec 2026-09-23-exercice-python-design.md §3;
   generalised from Python-only to any language, 2026-09-28, task 3 of
   docs/superpowers/sdd/2026-09-28-c-cpp-execution)

   WHY NOT IN THE APP WINDOW: measured 2026-09-23, from Python,
   `pyodide_js.loadPackage.constructor` gives back `Function`. In the app
   window (origin `file://`), that JavaScript read `C:\Windows\win.ini` and
   reached `https://example.com`. A SHARED quiz carries code (`solution`,
   `starter`, `asserts`) that the app runs.

   TWO LAYERS, each measured:
   1. the CSP of every response of the scheme, without `unsafe-eval`:
      `Function` is refused inside the worker;
   2. a HIDDEN window in its own in-memory partition, served by
      `neo-code://`, where `file:` answers 403 (and Chromium refuses
      `file://` to another origin anyway) and where `webRequest` cancels
      everything that is not `neo-code:`.

   ONE WORKER FILE PER LANGUAGE (`worker-<language>.mjs`, picked by
   `page.js`): this file itself stays language-agnostic — it only opens the
   hidden window, resolves the URLs it serves, and relays jobs to the page.
   `c`/`cpp` run through the Clang/WASM worker (task 8) once the pack is
   installed under `neo-code://app/languages/c/` (task 9 downloads it); until
   then `run` below answers `not-installed` without ever reaching the page. */

import { BrowserWindow, ipcMain, net, session } from "electron";
import type { CustomScheme } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CANAUX_BAC } from "./code-canaux";
import type { CodeJob, CodeRun } from "../../../src/host/types";
import type { CodeLanguage } from "../../../src/code-languages";

export const SCHEMA_CODE = "neo-code";
const PARTITION = "neo-code"; // no `persist:`: in memory, nothing on disk
const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'";
const SECOURS_MS = 3000;
/* The main process's LOADING budget (N1 bis): must cover the worst case of
   `page.js`'s `DELAI_CHARGEMENT_MS` (30 s) before the main process's own
   fallback reloads the window in its place — otherwise the two overlap and
   the main process reloads a page that would have finished loading on its
   own. Once the "ready" signal is received, the fallback is REARMED to
   `job.timeoutMs + SECOURS_MS` (see `armerSecours`). */
const CHARGEMENT_MS = 35000;
const INACTIVITE_MS = 10 * 60 * 1000;
/* BOUNDED queue (M3): the renderer is trusted, but an unbounded backlog of
   jobs could still pile up without limit. */
const PLAFOND_FILE = 8;

/* `CodeLanguage`, `CodeJob` and `CodeRun` moved to `src/host/types.ts` at
   task 4: the render side (`HostCode`) and the main process share the exact
   same shapes, validated at the IPC boundary (`canaux.ts`). `run` below
   answers `not-installed` for `c`/`cpp` until the pack's `manifest.json`
   exists under `langages` (task 9 downloads it; the check harness fakes it,
   task 8). */

/* Registered by `main.ts` in its ONE call to `registerSchemesAsPrivileged`
   (Electron only keeps the last one). */
export const PRIVILEGES_CODE: CustomScheme = {
	scheme: SCHEMA_CODE,
	privileges: { standard: true, secure: true, supportFetchAPI: true },
};

/** The sandbox file this URL designates: under `racine` (the sandbox
    itself), or under `langages` for `/languages/...` (the installed packs,
    task 9); `null` if it leaves them (`..`, absolute path, another host). */
export function resoudreFichierCode(racine: string, langages: string, url: string): string | null {
	let u: URL;
	try { u = new URL(url); } catch { return null; }
	if (u.protocol !== `${SCHEMA_CODE}:` || u.hostname !== "app") return null;
	const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
	if (!rel) return null;
	const [premier, ...reste] = rel.split("/");
	const base = path.resolve(premier === "languages" ? langages : racine);
	const cible = premier === "languages" ? reste.join("/") : rel;
	if (!cible) return null;
	const abs = path.resolve(base, cible);
	return abs.startsWith(base + path.sep) ? abs : null;
}

export interface BacASable {
	run(job: CodeJob): Promise<CodeRun>;
	warm(language: CodeLanguage): void;
	fermer(): void;
}

/* `options.csp` only exists for the `check:code-sandbox` harness (security
   review I4, case `NEO_CODE_SANS_CSP`, a SEPARATE Electron process): turning
   the CSP off proves that `webRequest.onBeforeRequest` blocks the network
   ALONE, without relying on the CSP's refusal of `Function`. Every real
   caller (`code-sandbox.ts` has a single caller, `main.ts`) omits `options`
   and keeps both layers. */
export function creerBacASable(racine: string, langages: string, preload: string, options?: { csp?: boolean }): BacASable {
	const cspActive = options?.csp !== false;
	let fenetre: BrowserWindow | null = null;
	let pret: Promise<BrowserWindow> | null = null;
	let sessionPrete = false;
	let prochainId = 1;
	let file: Promise<unknown> = Promise.resolve();
	let enFile = 0;
	/* The job in flight during a fallback RELOAD (M3): the page loses its
	   worker mid-flight, and sending it the next job before the reload
	   finishes would lose it (it would wait `timeoutMs + SECOURS_MS` for
	   nothing). */
	let pretApresRecharge: Promise<void> | null = null;
	/* (N1): resolves `pretApresRecharge` even if neither `did-finish-load`
	   nor `did-fail-load` ever fires (window destroyed mid-reload) — without
	   this, a later job, even on a fresh window reopened by `ouvrir()`, would
	   stay stuck on this promise forever. */
	let resoudrePretApresRecharge: (() => void) | null = null;
	let minuterieInactivite: ReturnType<typeof setTimeout> | null = null;
	const attentes = new Map<number, (r: CodeRun) => void>();
	/* (N1 bis): rearms this job's fallback at the trial's budget as soon as
	   the page signals that Pyodide (or, later, another language's
	   toolchain) has finished loading. */
	const armerAuChargement = new Map<number, () => void>();

	function preparerSession(): Electron.Session {
		const ses = session.fromPartition(PARTITION);
		if (sessionPrete) return ses;
		sessionPrete = true;
		ses.protocol.handle(SCHEMA_CODE, async (req) => {
			const abs = resoudreFichierCode(racine, langages, req.url);
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
		ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !d.url.startsWith(`${SCHEMA_CODE}:`) }));
		ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
		ses.setPermissionCheckHandler(() => false);
		return ses;
	}

	ipcMain.on(CANAUX_BAC.resultat, (e, id: unknown, res: unknown) => {
		/* Only the sandbox window renders results. */
		if (!fenetre || e.sender !== fenetre.webContents) return;
		const r = attentes.get(Number(id));
		if (!r) return;
		attentes.delete(Number(id));
		armerAuChargement.delete(Number(id));
		r(normaliserResultat(res));
	});

	ipcMain.on(CANAUX_BAC.pret, (e, id: unknown) => {
		if (!fenetre || e.sender !== fenetre.webContents) return;
		armerAuChargement.get(Number(id))?.();
	});

	/* (N2): no state must survive from one trial to the next — a fresh
	   worker per trial (I1-I3) is not enough: IndexedDB of the
	   `neo-code://app` origin (mounted by a quiz that uses
	   `pyodide_js.FS.filesystems.IDBFS`) lives in the partition, not in the
	   worker, and a later trial would otherwise read it back. */
	function nettoyerPartition(): void {
		void session.fromPartition(PARTITION).clearStorageData().catch(() => undefined);
	}

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
			armerAuChargement.clear();
			/* (N1): the window disappears during a fallback reload — unblock
			   anyone waiting on `pretApresRecharge` right away, otherwise the
			   next window reopened by `ouvrir()` would wait for nothing. */
			resoudrePretApresRecharge?.();
			resoudrePretApresRecharge = null;
			pretApresRecharge = null;
		});
		fenetre = f;
		pret = f.loadURL(`${SCHEMA_CODE}://app/index.html`).then(() => f, (e) => { pret = null; f.destroy(); throw e; });
		return pret;
	}

	function rearmerInactivite(): void {
		if (minuterieInactivite) clearTimeout(minuterieInactivite);
		minuterieInactivite = setTimeout(() => fermer(), INACTIVITE_MS);
	}

	/* (N1): triggers the fallback reload and sets a new `pretApresRecharge`,
	   bounded in every case (`did-finish-load`, `did-fail-load`, or failing
	   that a hard delay) so that no later job can ever stay stuck on it
	   forever. Re-warms after a successful load: the rebuilt page no longer
	   has any pre-warmed worker. `langue` re-warms the worker for the
	   language whose job triggered this reload, since the page tracks one
	   pre-warmed worker per language. */
	/* Is this language's engine on disk? Python is built in; `c` and `cpp`
	   share ONE pack (`languages/c/`, task 9). The ONE predicate `run`,
	   `warm` and the re-warm after a reload all read (task 10): a worker
	   warmed while the pack was still absent keeps its failed `import()` of
	   the pack cached in its module map for good, and the first run after
	   the download would then answer `not-installed` again — measured in
	   the app on 2026-09-28, the run right after the install failed and
	   only the one after it worked. */
	function moteurPresent(langue: CodeLanguage): boolean {
		return (langue !== "c" && langue !== "cpp") || existsSync(path.join(langages, "c", "manifest.json"));
	}

	function declencherRechargement(f: BrowserWindow, langue: CodeLanguage): void {
		pretApresRecharge = new Promise<void>((resolve) => {
			resoudrePretApresRecharge = resolve;
			const fini = (charge: boolean) => {
				clearTimeout(delai);
				f.webContents.removeListener("did-finish-load", surFini);
				f.webContents.removeListener("did-fail-load", surEchec);
				resoudrePretApresRecharge = null;
				if (charge && moteurPresent(langue)) f.webContents.send(CANAUX_BAC.chauffe, langue);
				resolve();
			};
			const surFini = () => fini(true);
			const surEchec = () => fini(false);
			f.webContents.once("did-finish-load", surFini);
			f.webContents.once("did-fail-load", surEchec);
			/* Hard safety net: neither one arrives (unidentified case). */
			const delai = setTimeout(() => fini(false), SECOURS_MS * 2);
		});
		f.webContents.reload();
	}

	function executer(job: CodeJob): Promise<CodeRun> {
		return ouvrir().then(async f => {
			/* A fallback reload is under way: wait for it to finish before
			   sending this job, otherwise it goes nowhere (M3). Bounded by
			   `declencherRechargement`: this wait can never last forever (N1). */
			if (pretApresRecharge) { await pretApresRecharge; pretApresRecharge = null; }
			return new Promise<CodeRun>((resolve) => {
				const id = prochainId++;
				let secours: ReturnType<typeof setTimeout>;
				const armerSecours = (ms: number) => {
					clearTimeout(secours);
					secours = setTimeout(() => {
						/* The page never answered: reload it (the worker dies with it). */
						if (!attentes.delete(id)) return;
						armerAuChargement.delete(id);
						declencherRechargement(f, job.language);
						resolve({ status: "timeout", stdout: "" });
					}, ms);
				};
				attentes.set(id, (r) => { clearTimeout(secours); resolve(r); });
				/* (N1 bis): a wide fallback during the LOADING of the language
				   runtime, rearmed to the trial's budget
				   (`timeoutMs + SECOURS_MS`) only once `page.js` relays the
				   "ready" signal — never before, otherwise a slow machine times
				   out mid-load for nothing. */
				armerAuChargement.set(id, () => armerSecours(job.timeoutMs + SECOURS_MS));
				armerSecours(CHARGEMENT_MS + SECOURS_MS);
				f.webContents.send(CANAUX_BAC.travail, { ...job, id });
			});
		}, (): CodeRun => ({ status: "unavailable", stdout: "" }));
	}

	function fermer(): void {
		if (minuterieInactivite) { clearTimeout(minuterieInactivite); minuterieInactivite = null; }
		fenetre?.destroy();
	}

	return {
		run(job) {
			/* `c` and `cpp` share ONE pack (`languages/c/`, task 9): a single
			   shared LLVM `Application` compiles either, there is no smaller
			   C-only subset (measured, spec §6). Refused before ever reaching
			   the page while the pack is absent — `worker-clang.mjs` would
			   otherwise fail its own dynamic `import()` of files that are not
			   there yet and report the same status, one round-trip later. Any
			   OTHER unknown language still falls through to the page, which
			   answers `unavailable` for a name it does not recognise at all. */
			if (!moteurPresent(job.language)) {
				return Promise.resolve({ status: "not-installed", stdout: "" });
			}
			if (enFile >= PLAFOND_FILE) {
				return Promise.resolve({ status: "unavailable", stdout: "", error: "queue full" });
			}
			rearmerInactivite();
			enFile++;
			const suite = file
				.then(() => executer(job))
				.then((r) => { nettoyerPartition(); return r; })
				.finally(() => { enFile--; });
			file = suite.catch(() => undefined);
			return suite;
		},
		warm(language) {
			// Never warm an engine that is not there yet (see `moteurPresent`).
			if (!moteurPresent(language)) return;
			rearmerInactivite();
			void ouvrir().then(f => f.webContents.send(CANAUX_BAC.chauffe, language), () => undefined);
		},
		fermer,
	};
}

/* What comes back from the page is treated as UNTRUSTED data: only the
   contract's fields are kept, typed. */
function normaliserResultat(res: unknown): CodeRun {
	const o = (res ?? {}) as Record<string, unknown>;
	const statuts = ["ok", "error", "compile-error", "timeout", "too-long", "unavailable", "not-installed"] as const;
	const status = statuts.includes(o.status as typeof statuts[number]) ? o.status as CodeRun["status"] : "error";
	const stdout = typeof o.stdout === "string" ? o.stdout.slice(0, 20000) : "";
	return typeof o.error === "string" ? { status, stdout, error: o.error.slice(0, 20000) } : { status, stdout };
}
