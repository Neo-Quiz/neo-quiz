/* ══════════════════════════════════════════════════════════
   THIS COMPUTER'S NAME AND KIND, for the device file other devices read.

   `name`: the OS host name (a pure read, nothing launched), cleaned and cut
   at 64 characters. `kind`: "laptop" when Windows lists a battery
   (`Win32_Battery`), else "desktop". Reading it needs the only launch of
   this module: ONE constant PowerShell script, no input interpolated, run
   once per process, a bounded timeout, and its output is reduced to the two
   words "laptop" / "desktop" (anything else, a failure included, is
   "laptop": the same default the phone uses for an unknown PC). The page
   gets the answer through one typed call with no argument
   (`appareil.infos`); `npm run check:partage` proves the parsing and the
   caching on an injected executor.
══════════════════════════════════════════════════════════ */

import { execFile } from "node:child_process";
import * as os from "node:os";
import { POWERSHELL_PARTAGE } from "./partage";

/** The constant script. Prints `laptop` or `desktop`. */
export const SCRIPT_TYPE = `$ErrorActionPreference = 'Stop'
if (@(Get-CimInstance -ClassName Win32_Battery).Count -gt 0) { 'laptop' } else { 'desktop' }
`;
export const DELAI_TYPE_MS = 8000;

export type TypeAppareil = "laptop" | "desktop";
export interface InfosAppareil { name: string; kind: TypeAppareil }

/** Exactly the two words, else the default. */
export function lireType(sortie: unknown): TypeAppareil {
	return typeof sortie === "string" && sortie.trim() === "desktop" ? "desktop" : "laptop";
}

/** A host name as a one-line label: controls removed, 64 characters at most. */
export function nomPropre(brut: unknown): string {
	if (typeof brut !== "string") return "";
	return brut.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "").trim().slice(0, 64);
}

/** Answers once and remembers (the probe runs at most once per process). Never rejects. */
export function creerInfosAppareil(deps: { executer(): Promise<string | null>; nom(): string }): () => Promise<InfosAppareil> {
	let promesse: Promise<InfosAppareil> | null = null;
	return () => {
		promesse ??= (async () => {
			let sortie: string | null = null;
			try { sortie = await deps.executer(); } catch { sortie = null; }
			let nom = "";
			try { nom = nomPropre(deps.nom()); } catch { nom = ""; }
			return { name: nom, kind: lireType(sortie) };
		})();
		return promesse;
	};
}

/** The real executor: PowerShell on Windows, nothing elsewhere. */
export function executerType(): Promise<string | null> {
	if (process.platform !== "win32") return Promise.resolve(null);
	return new Promise(resolve => {
		try {
			const encode = Buffer.from(SCRIPT_TYPE, "utf16le").toString("base64");
			execFile(POWERSHELL_PARTAGE(), ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encode],
				{ windowsHide: true, timeout: DELAI_TYPE_MS, maxBuffer: 1024 },
				(err, stdout) => resolve(err ? null : String(stdout)));
		} catch {
			resolve(null);
		}
	});
}

export const infosAppareil = creerInfosAppareil({ executer: executerType, nom: () => os.hostname() });
