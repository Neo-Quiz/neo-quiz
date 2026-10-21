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
	run(job: { code: string; timeoutMs: number }): Promise<CodeRun>;
}

export function creerServicePython(installation: InstallationPython, dossierTemp: string): ServicePython {
	const enCours = new Set<Promise<unknown>>();
	let file: Promise<unknown> = Promise.resolve();

	const nomsValides = (v: unknown): v is string[] =>
		Array.isArray(v) && v.length <= 64 && v.every((n) => typeof n === "string" && Object.hasOwn(PAQUETS, n));

	return {
		etat: () => installation.etat(),

		async installer(paquets, progression) {
			if (!nomsValides(paquets)) return { ok: false, code: "echec" };
			const cibles = [...new Set(paquets)];
			const travail = installation.installer(cibles, progression);
			enCours.add(travail);
			const fin = (): void => { enCours.delete(travail); };
			travail.then(fin, fin);
			try {
				await travail;
				return { ok: true };
			} catch (err) {
				if (estErreurPython(err) && err.code === "reseau") return { ok: false, code: "reseau" };
				if (estErreurPython(err) && err.code === "empreinte") return { ok: false, code: "empreinte" };
				return { ok: false, code: "echec" };
			}
		},

		async desinstaller(paquet) {
			if (typeof paquet !== "string" || !Object.hasOwn(PAQUETS, paquet)) return { ok: false, code: "inconnu" };
			try {
				return await installation.desinstaller(paquet);
			} catch (err) {
				return { ok: false, code: estErreurPython(err) && err.code === "occupe" ? "occupe" : "io" };
			}
		},

		run(job) {
			const suite = file.then(async (): Promise<CodeRun> => {
				// Wait for the installs under way (their failure is theirs to report).
				await Promise.allSettled([...enCours]);
				const etat = await installation.etat();
				const installes = new Set(etat.paquets.map((p) => p.nom));
				const verdict = verifierImports(job.code, installes);
				if (verdict) return verdict;
				if (!etat.interprete) return { status: "not-installed", stdout: "", missing: [] };
				return executerPython(
					{ code: job.code, timeoutMs: Math.min(DELAI_PYTHON_MAX_MS, Math.max(100, job.timeoutMs)) },
					{ executable: installation.chemins().executable, installes, dossierTemp },
				);
			});
			file = suite.then(() => undefined, () => undefined);
			return suite.catch((): CodeRun => ({ status: "unavailable", stdout: "" }));
		},
	};
}
