/* ══════════════════════════════════════════════════════════
   THE WINDOWS HOST — CODE EXECUTION, A PASS-THROUGH TO THE MAIN PROCESS

   `HostCode` (src/host/types.ts) on the RENDERER side. This module runs
   nothing itself: the code goes to the main process's sandbox
   (electron/code-sandbox.ts), a hidden window with no disk or network
   access (spec 2026-09-23-exercice-python-design.md §3). A bridge call that
   rejects (window closed mid-call) becomes `unavailable`, never an
   exception on the card. All languages are offered before their pack is
   installed: ▶ then downloads it through `installer` — `"python"` for
   Python, one pack, `"c"`, for both C and C++.
══════════════════════════════════════════════════════════ */

import type { HostCode, CodeRun } from "../../../../src/host/types";
import type { CodeLanguage } from "../../../../src/code-languages";
import type { Pont } from "../../electron/pont";

/** Settings key: the switch ids turned OFF (`"python"`, `"c"`; `cpp` follows `c`). */
export const CLE_LANGAGES_DESACTIVES = "languagesDisabled";

/* Cache of the disabled switch ids: `languages()` is synchronous and read at
   render, so the setting is loaded once at host creation and updated on write. */
let desactives: readonly string[] = [];
let pontCourant: (() => Pont) | null = null;

const interrupteur = (langue: CodeLanguage): string => (langue === "cpp" ? "c" : langue);

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

export function createWindowsCode(pont: () => Pont): HostCode {
	pontCourant = pont;
	desactives = [];
	void Promise.resolve().then(() => pont().reglages.lire(CLE_LANGAGES_DESACTIVES)).then(v => {
		if (Array.isArray(v)) desactives = v.filter((x): x is string => typeof x === "string");
	}).catch(() => undefined);
	return {
		languages: () => (["python", "c", "cpp"] as const).filter(langageActif),
		run: job => langageActif(job.language)
			? pont().code.run(job).catch((): CodeRun => ({ status: "unavailable", stdout: "" }))
			: Promise.resolve<CodeRun>({ status: "unavailable", stdout: "" }),
		warm: language => { if (!langageActif(language)) return; void pont().code.warm(language).catch(() => undefined); },
		installer: async (language, onProgress) => {
				const pack = language === "python" ? "python" : "c";
			try {
				const res = await pont().langages.installer(pack, (received, total) => onProgress(Math.floor((received * 100) / Math.max(1, total))));
				if (res.ok) return "ok";
				return res.code === "empreinte" ? "refused" : "offline";
			} catch {
				return "offline";
			}
		},
	};
}
