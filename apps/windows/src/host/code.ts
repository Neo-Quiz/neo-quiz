/* ══════════════════════════════════════════════════════════
   THE WINDOWS HOST — CODE EXECUTION, A PASS-THROUGH TO THE MAIN PROCESS

   `HostCode` (src/host/types.ts) on the RENDERER side. This module runs
   nothing itself: the code goes to the main process's sandbox
   (electron/code-sandbox.ts), a hidden window with no disk or network
   access (spec 2026-09-23-exercice-python-design.md §3). A bridge call that
   rejects (window closed mid-call) becomes `unavailable`, never an
   exception on the card. All languages are offered before their pack is
   installed: ▶ then downloads it through `installer` — `"python"` for
   Python, one pack, `"c"`, for both C and C++. On the phone, Python never
   reaches the bridge: it goes to the owner's PC (`brancherExecutionSurPc`).
══════════════════════════════════════════════════════════ */

import type { HostCode, CodeJob, CodeRun } from "../../../../src/host/types";
import { estMobile } from "./platform";
import type { CodeLanguage } from "../../../../src/code-languages";
import type { Pont } from "../../electron/pont";

/** Settings key: the switch ids turned OFF (`"python"`, `"c"`; `cpp` follows `c`). */
export const CLE_LANGAGES_DESACTIVES = "languagesDisabled";

/* Cache of the disabled switch ids: `languages()` is synchronous and read at
   render, so the setting is loaded once at host creation and updated on write. */
let desactives: readonly string[] = [];
let pontCourant: (() => Pont) | null = null;

const interrupteur = (langue: CodeLanguage): string => (langue === "cpp" ? "c" : langue);

/** Settings key, ON THE PHONE ONLY: warning keys (note path + code hash) the
    user dismissed. The PC never reads it: its warning is a native dialog of
    the main process, remembered in a file the window cannot reach
    (electron/python/garde.ts, final review I1). */
export const CLE_AVERTISSEMENT_PYTHON = "pythonWarningDismissed";
const MAX_AVERTISSEMENTS = 500;

export function langageActif(langue: CodeLanguage): boolean {
	return !desactives.includes(interrupteur(langue));
}

export async function reglerLangageActif(langue: CodeLanguage, actif: boolean): Promise<void> {
	const id = interrupteur(langue);
	const suivant = actif ? desactives.filter(x => x !== id) : desactives.includes(id) ? desactives : [...desactives, id];
	if (!pontCourant) throw new Error("code host not created");
	await pontCourant().reglages.ecrire(CLE_LANGAGES_DESACTIVES, suivant);
	desactives = suivant;
}

/* The phone's Python runner, set once the synced folder is there (main.ts). */
let surPc: ((job: CodeJob, signal: AbortSignal) => Promise<CodeRun>) | null = null;
/** The phone's runs in progress, by job id: Stop stops waiting for the PC. */
const arretsTelephone = new Map<string, AbortController>();

/** Phone: where Python runs go (`executerSurPc` bound to this device's files). */
export function brancherExecutionSurPc(run: (job: CodeJob, signal: AbortSignal) => Promise<CodeRun>): void {
	surPc = run;
}

function surLeTelephone(job: CodeJob): Promise<CodeRun> {
	if (!surPc) return Promise.resolve<CodeRun>({ status: "unavailable", stdout: "", error: "no-pc" });
	const arret = new AbortController();
	if (job.id) arretsTelephone.set(job.id, arret);
	return surPc(job, arret.signal).finally(() => { if (job.id) arretsTelephone.delete(job.id); });
}

export function createWindowsCode(pont: () => Pont): HostCode {
	pontCourant = pont;
	desactives = [];
	void Promise.resolve().then(() => pont().reglages.lire(CLE_LANGAGES_DESACTIVES)).then(v => {
		if (Array.isArray(v)) desactives = v.filter((x): x is string => typeof x === "string");
	}).catch(() => undefined);
	return {
		languages: () => (["python", "c", "cpp"] as const).filter(langageActif),
		run: job => {
			if (!langageActif(job.language)) return Promise.resolve<CodeRun>({ status: "unavailable", stdout: "" });
			/* The phone never runs Python: the run goes to the owner's PC
			   (dashboard/code-run-remote.ts). C and C++ stay in the local sandbox. */
			if (job.language === "python" && estMobile()) return surLeTelephone(job);
			return pont().code.run(job).catch((): CodeRun => ({ status: "unavailable", stdout: "" }));
		},
		/* The phone only: on the PC the main process asks (see CLE_AVERTISSEMENT_PYTHON). */
		avertissement: estMobile() ? {
			masque: async cle => {
				const v = await pont().reglages.lire(CLE_AVERTISSEMENT_PYTHON);
				return Array.isArray(v) && v.includes(cle);
			},
			masquer: async cle => {
				const v = await pont().reglages.lire(CLE_AVERTISSEMENT_PYTHON);
				const liste = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== cle) : [];
				liste.push(cle);
				await pont().reglages.ecrire(CLE_AVERTISSEMENT_PYTHON, liste.slice(-MAX_AVERTISSEMENTS));
			},
		} : undefined,
		cancel: id => {
			const arret = arretsTelephone.get(id);
			if (arret) { arret.abort(); return; }
			if (!estMobile()) void pont().code.annuler(id).catch(() => undefined);
		},
		warm: language => { if (!langageActif(language) || (language === "python" && estMobile())) return; void pont().code.warm(language).catch(() => undefined); },
		/* Python: `paquets` names the root libraries to download (`[]` = the
		   interpreter alone). Mapping of the installer's codes: reseau -> "offline",
		   empreinte -> "refused", anything else (disk, bad name) -> "failed".
		   C/C++: the one compiler pack, as before. */
		installer: async (language, onProgress, paquets) => {
			const pourcent = (recus: number, total: number): void => onProgress(Math.floor((recus * 100) / Math.max(1, total)));
			if (language === "python") {
				try {
					const res = await pont().python.installer(paquets ?? [], pourcent);
					if (res.ok) return "ok";
					return res.code === "reseau" ? "offline" : res.code === "empreinte" ? "refused" : "failed";
				} catch {
					return "failed";
				}
			}
			const pack = "c";
			try {
				const res = await pont().langages.installer(pack, pourcent);
				if (res.ok) return "ok";
				return res.code === "empreinte" ? "refused" : "offline";
			} catch {
				return "offline";
			}
		},
	};
}
