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
     backend, a `PATH` that names the interpreter's folder only, and the
     five variables naming the user's folders (`USERPROFILE`, `HOMEDRIVE`,
     `HOMEPATH`, `LOCALAPPDATA`, `APPDATA`: `~` resolves as in a terminal).
     No other variable of the app's own environment (tokens, proxies,
     `PYTHON*`) is passed on.
   - NO SHELL, no console window, stdin closed (`ignore`).
   - `timeoutMs` (the caller passes up to 60 s) → the WHOLE TREE is killed
     (`taskkill /pid N /T /F`: a `subprocess.Popen` grandchild dies too) and
     the run answers `timeout`.
   - 256 KiB of stdout + stderr together → the tree is killed and the run
     answers `too-long` with the first 256 KiB.
   - AFTER EVERY RUN, whatever its outcome, what the interpreter left
     running is swept (`balayer`): a block may `Popen` a long child and
     return normally. One limit is written at the sweep: a double fork.
     The sweep and the run folder's removal run AFTER the result is
     returned, in the background (`attendreNettoyages` waits for them).

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
		if (!crEnAttente && !morceau.includes(0x0d)) return morceau;
		const octets: number[] = [];
		if (crEnAttente) {
			crEnAttente = false;
			if (morceau[0] !== 0x0a) octets.push(0x0d);
		}
		for (let i = 0; i < morceau.length; i++) {
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

/** `octets` without a UTF-8 sequence cut short at its end (the cap may
    fall inside a character; decoding it would show a U+FFFD). */
export function sansSequenceCoupee(octets: Buffer): Buffer {
	const n = octets.length;
	for (let recul = 1; recul <= Math.min(3, n); recul++) {
		const o = octets[n - recul];
		if ((o & 0xc0) === 0x80) continue; /* continuation byte: look further back */
		const longueur = o >= 0xf0 ? 4 : o >= 0xe0 ? 3 : o >= 0xc0 ? 2 : 1;
		return longueur > recul ? octets.subarray(0, n - recul) : octets;
	}
	return octets;
}

const taskkill = () => join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");

/** Kills `enfant` and every process it started, while it is alive (`/T`
    walks the tree from a LIVE root). Resolves once the kill was tried. */
function tuerArbre(enfant: ChildProcess): Promise<void> {
	const pid = enfant.pid;
	if (pid === undefined) return Promise.resolve();
	if (process.platform === "win32") {
		return new Promise((resolve) => {
			execFile(taskkill(), ["/pid", String(pid), "/T", "/F"], { windowsHide: true, timeout: 10000 }, () => {
				/* Whatever taskkill answered (it may not have reached the
				   process), the direct kill still covers the interpreter. */
				try { enfant.kill("SIGKILL"); } catch { /* already gone */ }
				resolve();
			});
		});
	}
	/* Elsewhere the interpreter leads its own process group (`detached`). */
	try { process.kill(-pid, "SIGKILL"); } catch { try { enfant.kill("SIGKILL"); } catch { /* already gone */ } }
	return Promise.resolve();
}

/* THE SWEEP, after the interpreter exited, on EVERY outcome: a block that
   `Popen`s a long child and returns would otherwise leave it running (and
   holding the run folder as its working directory). `taskkill /T` cannot
   help any more: it walks the tree from a live root. Windows does not
   re-parent an orphan, though: its `ParentProcessId` still names our dead
   interpreter. The script lists the processes once, takes those whose
   parent is our pid AND that were created between our spawn and its exit
   (a pid reused by an unrelated process after our exit would only have
   later children), then their descendants (each created after its
   parent), and stops them all. Its values come from the environment,
   never from its text: the script is constant.
   LIMIT (no Job Object without native code): a grandchild whose parent
   ALREADY exited before the sweep (a double fork) has a parent pid that no
   live process carries, and escapes the chain. */
const SCRIPT_BALAYAGE = [
	"$ErrorActionPreference = 'SilentlyContinue'",
	"$racine = [uint32]$env:NQ_RACINE; $debut = [int64]$env:NQ_DEBUT; $fin = [int64]$env:NQ_FIN",
	"$tous = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate)",
	"$vus = @{}; $file = New-Object System.Collections.Queue",
	"foreach ($p in $tous) { $c = $p.CreationDate.ToFileTimeUtc(); if ($p.ParentProcessId -eq $racine -and $c -ge $debut -and $c -le $fin) { $vus[$p.ProcessId] = $c; $file.Enqueue($p) } }",
	"while ($file.Count -gt 0) { $q = $file.Dequeue(); foreach ($p in $tous) { if ($p.ParentProcessId -eq $q.ProcessId -and -not $vus.ContainsKey($p.ProcessId)) { $c = $p.CreationDate.ToFileTimeUtc(); if ($c -ge $vus[$q.ProcessId]) { $vus[$p.ProcessId] = $c; $file.Enqueue($p) } } } }",
	"foreach ($id in @($vus.Keys)) { Stop-Process -Id $id -Force }",
].join("\n");

/** Milliseconds since 1970 as a Windows FILETIME (100 ns since 1601). */
const enFiletime = (ms: number) => String((BigInt(Math.floor(ms)) + 11644473600000n) * 10000n);

/** Stops what the dead interpreter `pid` left running (see the sweep). */
function balayer(pid: number, debutMs: number, finMs: number): Promise<void> {
	if (process.platform !== "win32") {
		/* The process group outlives its leader while a member lives. */
		try { process.kill(-pid, "SIGKILL"); } catch { /* none left */ }
		return Promise.resolve();
	}
	const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
	return new Promise((resolve) => {
		execFile(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT_BALAYAGE], {
			windowsHide: true,
			timeout: 10000,
			/* Clock granularity: a second of slack before the spawn. */
			env: { ...process.env, NQ_RACINE: String(pid), NQ_DEBUT: enFiletime(debutMs - 1000), NQ_FIN: enFiletime(finMs) },
		}, () => resolve());
	});
}

/* THE CLEANUP runs AFTER the result (the sweep is a PowerShell start, about
   450 ms, and a run's result must not wait for it): the sweep, then the
   removal of the run folder (an orphan would hold it as its working
   directory), in the background, errors swallowed. The timeout, cap and
   abort paths still kill the tree at once. */
const nettoyages = new Set<Promise<void>>();
function suivre(nettoyage: Promise<void>): void {
	const suivi = nettoyage.catch(() => undefined).finally(() => { nettoyages.delete(suivi); });
	nettoyages.add(suivi);
}
/** Resolves once every cleanup started so far (and any they start) is done:
    the check's seam, to assert that no child and no run folder is left. */
export async function attendreNettoyages(): Promise<void> {
	while (nettoyages.size > 0) await Promise.all([...nettoyages]);
}

export async function executerPython(job: JobPython, contexte: ContextePython): Promise<CodeRun> {
	const refus = verifierImports(job.code, contexte.installes);
	if (refus) return refus;
	if (job.signal?.aborted) return { status: "unavailable", stdout: "" };

	const dossier = await mkdtemp(join(contexte.dossierTemp, "neo-python-run-"));
	let balayage: Promise<void> = Promise.resolve();
	try {
		await writeFile(join(dossier, "main.py"), job.code, "utf8");
		/* An abort during the two awaits above fired no listener yet. */
		if (job.signal?.aborted) return { status: "unavailable", stdout: "" };
		const issue = await lancer(job, contexte, dossier);
		balayage = issue.balayage;
		return issue.resultat;
	} finally {
		suivre(balayage.catch(() => undefined).then(() => rm(dossier, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
	}
}

/** The result, and the sweep that follows it (see the cleanup). */
interface IssuePython { resultat: CodeRun; balayage: Promise<void> }

/** The five variables that name the user's folders, copied from the real
    environment when set (never invented). */
const VARIABLES_PROFIL = ["USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "APPDATA"] as const;
function profilUtilisateur(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const k of VARIABLES_PROFIL) {
		const v = process.env[k];
		if (typeof v === "string" && v !== "") out[k] = v;
	}
	return out;
}

function lancer(job: JobPython, contexte: ContextePython, dossier: string): Promise<IssuePython> {
	return new Promise<IssuePython>((resolve) => {
		const env: NodeJS.ProcessEnv = {
			SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
			TEMP: dossier,
			TMP: dossier,
			PYTHONIOENCODING: "utf-8",
			MPLBACKEND: "Agg",
			MPLCONFIGDIR: dossier,
			PATH: dirname(contexte.executable),
			/* The user's folders (final review M5): `~`, `Path.home()` and the
			   caches of the libraries resolve to the real profile, as in a
			   terminal. The code already has the user's file access; these only
			   say where things are. */
			...profilUtilisateur(),
		};
		const debut = Date.now();
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
			resolve({ resultat: { status: "unavailable", stdout: "", error: e instanceof Error ? e.message : String(e) }, balayage: Promise.resolve() });
			return;
		}

		const sortie: Buffer[] = [];
		const erreur: Buffer[] = [];
		let restant = PLAFOND_SORTIE;
		let fin: "timeout" | "too-long" | "aborted" | null = null;
		let sorti = false;
		let code: number | null = null;
		let termine = false;
		let balayage: Promise<void> | null = null;
		let minuterieFermeture: ReturnType<typeof setTimeout> | undefined;
		let minuterieArret: ReturnType<typeof setTimeout> | undefined;

		const balayerUneFois = () => {
			if (!balayage && enfant.pid !== undefined) balayage = balayer(enfant.pid, debut, Date.now());
			return balayage ?? Promise.resolve();
		};
		const arreter = (raison: "timeout" | "too-long" | "aborted") => {
			/* Once the interpreter exited, its outcome is known: a late timer
			   must not rewrite a clean run. */
			if (fin || termine || sorti) return;
			fin = raison;
			void tuerArbre(enfant);
			/* A kill that never lands: one more try, then the run ends. */
			minuterieArret = setTimeout(() => { void tuerArbre(enfant).then(() => terminer()); }, ATTENTE_ARRET_MS);
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
		/* An abort between the caller's check and the listener above. */
		if (job.signal?.aborted) arreter("aborted");

		const terminer = (echecLancement?: Error) => {
			if (termine) return;
			termine = true;
			clearTimeout(minuterie);
			clearTimeout(minuterieFermeture);
			clearTimeout(minuterieArret);
			job.signal?.removeEventListener("abort", surAbandon);
			enfant.stdout?.destroy();
			enfant.stderr?.destroy();
			const texte = (morceaux: Buffer[]) => sansSequenceCoupee(Buffer.concat(morceaux)).toString("utf8");
			const stdout = texte(sortie);
			const stderr = texte(erreur);
			let resultat: CodeRun;
			if (echecLancement) resultat = { status: "unavailable", stdout: "", error: echecLancement.message };
			else if (fin === "aborted") resultat = { status: "unavailable", stdout: "" };
			else if (fin) resultat = { status: fin, stdout };
			else if (code === 0) resultat = { status: "ok", stdout };
			else resultat = { status: "error", stdout, error: stderr };
			/* Whatever the outcome, nothing the block started outlives it;
			   the caller does not wait for that to answer. */
			resolve({ resultat, balayage: echecLancement ? Promise.resolve() : balayerUneFois() });
		};

		enfant.on("error", (e) => terminer(e));
		enfant.on("exit", (c) => {
			sorti = true;
			code = c;
			/* Sweep at once: an orphan holding the pipes is what would keep
			   `close` from coming. */
			void balayerUneFois();
			/* The streams close once every holder of the pipe is gone; one
			   kept open outside the tree must not hold the run forever. */
			minuterieFermeture = setTimeout(() => terminer(), ATTENTE_FERMETURE_MS);
		});
		enfant.on("close", () => terminer());
		if (enfant.pid !== undefined) contexte.surDemarrage?.(enfant.pid);
	});
}
