/* ══════════════════════════════════════════════════════════
   THE PYTHON SERVICE of the main process: what `canaux.ts` calls.

   It joins the installation (`installation.ts`) and the runner
   (`execution.ts`) and holds the two rules that belong to neither:
   - ONE run at a time (a queue): a second block waits for the first.
   - A run never starts while an install it might need is in progress: it
     awaits every in-flight install first, then reads the installed set, so
     a block run right after "Downloading torch…" sees torch.
   No Electron import: `scripts/check-python-service.mjs` style checks and
   the PC wiring proof load this module directly.
══════════════════════════════════════════════════════════ */

import type { CodeRun } from "../../../../src/host/types";
import { PAQUETS } from "./catalogue";
import { executerPython, verifierImports } from "./execution";
import type { EtatPython, InstallationPython } from "./installation";
import { estErreurPython } from "./installation";

/** A run's deadline, end to end (spawn included): 60 s, a ruling of the plan. */
export const DELAI_PYTHON_MAX_MS = 60_000;

export type CodeInstallationPython = "reseau" | "empreinte" | "echec";

export type ResultatInstallation = { ok: true } | { ok: false; code: CodeInstallationPython };

export interface ServicePython {
	etat(): Promise<EtatPython>;
	/** Every name must be a key of `PAQUETS`, else refused (`echec`) before anything moves. */
	installer(paquets: unknown, progression: (recus: number, total: number) => void): Promise<ResultatInstallation>;
	desinstaller(paquet: unknown): Promise<{ ok: true } | { ok: false; requisPar: string[] } | { ok: false; code: "occupe" | "io" | "inconnu" }>;
	/** Removes every library then the interpreter ("Delete" in Settings). */
	supprimerTout(): Promise<{ ok: true } | { ok: false; code: "occupe" | "io" }>;
	run(job: { code: string; timeoutMs: number; signal?: AbortSignal }): Promise<CodeRun>;
}

/** Resolves with `"timeout"` / `"abort"` when the deadline or the signal wins. */
function course<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | "timeout" | "abort"> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) { resolve("abort"); return; }
		const fin = (): void => { clearTimeout(minuteur); signal?.removeEventListener("abort", surAbandon); };
		const surAbandon = (): void => { fin(); resolve("abort"); };
		const minuteur = setTimeout(() => { fin(); resolve("timeout"); }, Math.max(0, ms));
		signal?.addEventListener("abort", surAbandon, { once: true });
		p.then((v) => { fin(); resolve(v); }, (e) => { fin(); reject(e); });
	});
}

export function creerServicePython(installation: InstallationPython, dossierTemp: string): ServicePython {
	/** In-flight installs by target set: an identical request SHARES the
	    promise (every caller's progress callback is fed), so two blocks or
	    windows never mix two progress streams on the one channel. */
	const enCours = new Map<string, { travail: Promise<unknown>; ecouteurs: Set<(recus: number, total: number) => void> }>();
	let file: Promise<unknown> = Promise.resolve();

	const nomsValides = (v: unknown): v is string[] =>
		Array.isArray(v) && v.length <= 64 && v.every((n) => typeof n === "string" && Object.hasOwn(PAQUETS, n));

	return {
		etat: () => installation.etat(),

		async installer(paquets, progression) {
			if (!nomsValides(paquets)) return { ok: false, code: "echec" };
			const cibles = [...new Set(paquets)].sort();
			const cle = cibles.join(",");
			let entree = enCours.get(cle);
			if (entree) entree.ecouteurs.add(progression);
			else {
				const ecouteurs = new Set([progression]);
				const travail = installation.installer(cibles, (r, t) => { for (const f of ecouteurs) f(r, t); });
				entree = { travail, ecouteurs };
				enCours.set(cle, entree);
				const fin = (): void => { enCours.delete(cle); };
				travail.then(fin, fin);
			}
			try {
				await entree.travail;
				return { ok: true };
			} catch (err) {
				if (estErreurPython(err) && err.code === "reseau") return { ok: false, code: "reseau" };
				if (estErreurPython(err) && err.code === "empreinte") return { ok: false, code: "empreinte" };
				return { ok: false, code: "echec" };
			}
		},

		supprimerTout() {
			return installation.supprimerTout();
		},

		async desinstaller(paquet) {
			if (typeof paquet !== "string" || !Object.hasOwn(PAQUETS, paquet)) return { ok: false, code: "inconnu" };
			try {
				return await installation.desinstaller(paquet);
			} catch (err) {
				return { ok: false, code: estErreurPython(err) && err.code === "occupe" ? "occupe" : "io" };
			}
		},

		/* The run's own deadline starts when the request ARRIVES and covers the
		   queue, the wait for installs and the run itself; the signal (window
		   closed) frees a queued run at once and kills a running one. */
		run(job) {
			const debut = Date.now();
			const budget = Math.min(DELAI_PYTHON_MAX_MS, Math.max(100, job.timeoutMs));
			const restant = (): number => budget - (Date.now() - debut);
			const { signal } = job;
			let annule = false;
			const travail = async (): Promise<CodeRun> => {
				for (;;) {
					// Wait for the installs under way (their failure is theirs to report).
					while (enCours.size > 0) {
						const r = await course(Promise.allSettled([...enCours.values()].map((x) => x.travail)), restant(), signal);
						if (r === "timeout") return { status: "timeout", stdout: "" };
						if (r === "abort") return { status: "unavailable", stdout: "" };
					}
					const etat = await installation.etat();
					// An install may have started while the state was read: look again.
					if (enCours.size > 0) continue;
					const installes = new Set(etat.paquets.map((p) => p.nom));
					const verdict = verifierImports(job.code, installes);
					if (verdict) return verdict;
					if (!etat.interprete) return { status: "not-installed", stdout: "", missing: [] };
					return executerPython(
						{ code: job.code, timeoutMs: Math.max(100, restant()), signal },
						{ executable: installation.chemins().executable, installes, dossierTemp },
					);
				}
			};
			const suite = file.then(() => (annule || signal?.aborted ? ({ status: "unavailable", stdout: "" } as CodeRun) : travail()));
			file = suite.then(() => undefined, () => undefined);
			return course(suite, restant() + 1000, signal).then((r): CodeRun => {
				if (r === "abort") { annule = true; return { status: "unavailable", stdout: "" }; }
				if (r === "timeout") { annule = true; return { status: "timeout", stdout: "" }; }
				return r;
			}, (): CodeRun => ({ status: "unavailable", stdout: "" }));
		},
	};
}
