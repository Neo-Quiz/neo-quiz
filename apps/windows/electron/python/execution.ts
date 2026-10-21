/* ══════════════════════════════════════════════════════════
   RUNNING ONE PYTHON BLOCK in the managed interpreter (task 4 of
   docs/superpowers/plans/2026-10-22-native-python-run.md)

   The code comes from a quiz, and a quiz may be SHARED, hence hostile. The
   owner accepted full file and network access behind a warning (task 6);
   what this module guarantees is that a run is BOUNDED and leaves nothing
   behind:

   - BEFORE STARTING anything, the imports are read (`importsDuCode`): a
     name no pinned package provides answers `unsupported`; a known one
     whose whole closure is not installed answers `not-installed` with the
     ROOT packages to install. Python is never started for either.
   - ONE fresh folder per run (`mkdtemp` under `dossierTemp`) holds
     `main.py` and is the working directory, `TEMP`, `TMP` and
     `MPLCONFIGDIR` (matplotlib would otherwise write its cache in the
     user's home). It is removed afterwards, on every outcome.
   - THE ENVIRONMENT is built from nothing: `SystemRoot` (Windows sockets and
     crypto need it), the run folder, UTF-8 output, matplotlib's `Agg`
     backend, and a `PATH` that names the interpreter's folder only. No
     variable of the app's own environment (tokens, proxies, `PYTHON*`) is
     passed on.
   - NO SHELL, no console window, stdin closed (`ignore`).
   - `timeoutMs` (the caller passes up to 60 s) → the WHOLE TREE is killed
     (`taskkill /pid N /T /F`: a `subprocess.Popen` grandchild dies too) and
     the run answers `timeout`.
   - 256 KiB of stdout + stderr together → the tree is killed and the run
     answers `too-long` with the first 256 KiB.

   It does not import `../process.ts` (the CLI launcher, heavy imports): a
   spawn and a tree kill are all it needs.
   ══════════════════════════════════════════════════════════ */

import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CodeRun } from "../../../../src/host/types";
import { importsDuCode } from "../../../../src/python-imports";
import { IMPORTS, classerImports, fermeture } from "./catalogue";

/** stdout + stderr, together, beyond which the run stops (`too-long`). */
export const PLAFOND_SORTIE = 256 * 1024;

/** How long the streams may stay open after the process exited (a handle
    kept by a process outside the tree), and how long a kill may take,
    before the run gives up waiting: a run always ends. */
const ATTENTE_FERMETURE_MS = 2000;
const ATTENTE_ARRET_MS = 5000;

export interface JobPython {
	code: string;
	timeoutMs: number;
	/** Aborting kills the tree; the run then answers `unavailable` (it did
	    not complete, and nothing it printed is a result). */
	signal?: AbortSignal;
}

export interface ContextePython {
	/** The managed `python.exe` (`InstallationPython.chemins().executable`). */
	executable: string;
	/** Names of the installed packages (closure members included). */
	installes: ReadonlySet<string>;
	/** Where the per-run folder is created. */
	dossierTemp: string;
	/** Told the pid of the started interpreter: the check's seam, to prove
	    that no process of the tree survives a kill. */
	surDemarrage?: (pid: number) => void;
}

/** What the imports of `code` require, or `null` when it may run. */
export function verifierImports(code: string, installes: ReadonlySet<string>): CodeRun | null {
	const { connus, inconnus } = classerImports(importsDuCode(code));
	if (inconnus.length > 0) return { status: "unsupported", stdout: "", unsupported: [...new Set(inconnus)].sort() };
	const manquants = new Set<string>();
	for (const nom of connus) {
		const racine = IMPORTS[nom];
		if (!fermeture(racine).every(p => installes.has(p))) manquants.add(racine);
	}
	return manquants.size > 0 ? { status: "not-installed", stdout: "", missing: [...manquants].sort() } : null;
}

/** A stream filter that turns CRLF into LF. Python's text streams write
    `\r\n` on Windows; the sandbox it replaces wrote `\n`, and the cap
    counts what is shown. A `\r` that ends a chunk is held until the next
    one says whether a `\n` follows; a lone `\r` (a progress line) stays.
    A `\r` still held when the stream closes is dropped: it can only be the
    last byte, invisible in a text output. */
function sansCr(): (morceau: Buffer) => Buffer {
	let crEnAttente = false;
	return (morceau) => {
		const octets: number[] = [];
		let i = 0;
		if (crEnAttente) {
			crEnAttente = false;
			if (morceau[0] !== 0x0a) octets.push(0x0d);
		}
		for (; i < morceau.length; i++) {
			const o = morceau[i];
			if (o === 0x0d) {
				if (i === morceau.length - 1) { crEnAttente = true; continue; }
				if (morceau[i + 1] === 0x0a) continue;
			}
			octets.push(o);
		}
		return Buffer.from(octets);
	};
}

/** Kills `enfant` and every process it started. */
function tuerArbre(enfant: ChildProcess): void {
	const pid = enfant.pid;
	if (pid === undefined) return;
	if (process.platform === "win32") {
		const taskkill = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
		execFile(taskkill, ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {
			/* taskkill failed (the process already exited, or it could not be
			   reached): the direct kill below still covers the interpreter. */
			try { enfant.kill("SIGKILL"); } catch { /* already gone */ }
		});
		return;
	}
	/* Elsewhere the interpreter leads its own process group (`detached`). */
	try { process.kill(-pid, "SIGKILL"); } catch { try { enfant.kill("SIGKILL"); } catch { /* already gone */ } }
}

export async function executerPython(job: JobPython, contexte: ContextePython): Promise<CodeRun> {
	const refus = verifierImports(job.code, contexte.installes);
	if (refus) return refus;
	if (job.signal?.aborted) return { status: "unavailable", stdout: "" };

	const dossier = await mkdtemp(join(contexte.dossierTemp, "neo-python-run-"));
	try {
		await writeFile(join(dossier, "main.py"), job.code, "utf8");
		return await lancer(job, contexte, dossier);
	} finally {
		await rm(dossier, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
	}
}

function lancer(job: JobPython, contexte: ContextePython, dossier: string): Promise<CodeRun> {
	return new Promise<CodeRun>((resolve) => {
		const env: NodeJS.ProcessEnv = {
			SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
			TEMP: dossier,
			TMP: dossier,
			PYTHONIOENCODING: "utf-8",
			MPLBACKEND: "Agg",
			MPLCONFIGDIR: dossier,
			PATH: dirname(contexte.executable),
		};
		let enfant: ChildProcess;
		try {
			enfant = spawn(contexte.executable, ["-X", "utf8", "-B", "main.py"], {
				cwd: dossier,
				env,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
				shell: false,
				detached: process.platform !== "win32",
			});
		} catch (e) {
			resolve({ status: "unavailable", stdout: "", error: e instanceof Error ? e.message : String(e) });
			return;
		}

		const sortie: Buffer[] = [];
		const erreur: Buffer[] = [];
		let restant = PLAFOND_SORTIE;
		let fin: "timeout" | "too-long" | "aborted" | null = null;
		let code: number | null = null;
		let termine = false;
		let minuterieFermeture: ReturnType<typeof setTimeout> | undefined;
		let minuterieArret: ReturnType<typeof setTimeout> | undefined;

		const arreter = (raison: "timeout" | "too-long" | "aborted") => {
			if (fin || termine) return;
			fin = raison;
			tuerArbre(enfant);
			/* A kill that never lands still ends the run. */
			minuterieArret = setTimeout(() => terminer(), ATTENTE_ARRET_MS);
		};
		const recevoir = (cible: Buffer[]) => {
			const crlf = sansCr();
			return (brut: Buffer) => {
				if (fin) return;
				const morceau = crlf(brut);
				if (morceau.length > restant) {
					cible.push(morceau.subarray(0, restant));
					restant = 0;
					arreter("too-long");
					return;
				}
				cible.push(morceau);
				restant -= morceau.length;
			};
		};
		enfant.stdout?.on("data", recevoir(sortie));
		enfant.stderr?.on("data", recevoir(erreur));

		const minuterie = setTimeout(() => arreter("timeout"), job.timeoutMs);
		const surAbandon = () => arreter("aborted");
		job.signal?.addEventListener("abort", surAbandon, { once: true });

		const terminer = (echecLancement?: Error) => {
			if (termine) return;
			termine = true;
			clearTimeout(minuterie);
			clearTimeout(minuterieFermeture);
			clearTimeout(minuterieArret);
			job.signal?.removeEventListener("abort", surAbandon);
			enfant.stdout?.destroy();
			enfant.stderr?.destroy();
			const stdout = Buffer.concat(sortie).toString("utf8");
			const stderr = Buffer.concat(erreur).toString("utf8");
			if (echecLancement) resolve({ status: "unavailable", stdout: "", error: echecLancement.message });
			else if (fin === "aborted") resolve({ status: "unavailable", stdout: "" });
			else if (fin) resolve({ status: fin, stdout });
			else if (code === 0) resolve({ status: "ok", stdout });
			else resolve({ status: "error", stdout, error: stderr });
		};

		enfant.on("error", (e) => terminer(e));
		enfant.on("exit", (c) => {
			code = c;
			/* The streams close once every holder of the pipe is gone; one
			   kept open outside the tree must not hold the run forever. */
			minuterieFermeture = setTimeout(() => terminer(), ATTENTE_FERMETURE_MS);
		});
		enfant.on("close", () => terminer());
		if (enfant.pid !== undefined) contexte.surDemarrage?.(enfant.pid);
	});
}
