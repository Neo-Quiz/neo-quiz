/* ══════════════════════════════════════════════════════════
   LE FORMAT DE L'HEURE — le réglage `timeFormat`

   24 h par défaut, 12 h (AM/PM) sur demande, quelle que soit la langue de
   l'interface (Ahmed, 2026-09-23 : « 06:35 PM » ne lui correspondait pas).
   Même patron que `langue.ts` : `lireFormatHeure` est PURE (aucun `pont()`,
   aucun DOM) — c'est elle que `scripts/check-format-heure.mjs` éprouve sur
   une valeur BRUTE lue du disque ; les deux autres passent par `pont()`, lu
   à l'APPEL. La mise en forme elle-même vit dans le code partagé
   (`hourOptions`, src/i18n.ts).
══════════════════════════════════════════════════════════ */

import { pont } from "../host/pont";
import { CLE_REGLAGES_HEURE } from "../../electron/pont";
import type { HourCycle } from "../../../../src/i18n";

/** Relit le réglage depuis une valeur brute : seul « 12h » vaut 12 h, tout le
    reste (absent, ancien, trafiqué) vaut 24 h — jamais une erreur au démarrage. */
export function lireFormatHeure(brut: unknown): HourCycle {
	return brut === "12h" ? "12h" : "24h";
}

/** The phone's own 12/24-hour system setting; 24 h when it cannot be read. */
async function formatHeureTelephone(): Promise<HourCycle> {
	try {
		return (await pont().android!.format24h()) ? "24h" : "12h";
	} catch {
		return "24h";
	}
}

/** Android: the clock follows the phone, the stored `timeFormat` is ignored (not deleted). */
export async function chargerFormatHeure(): Promise<HourCycle> {
	if (pont().android) return formatHeureTelephone();
	return lireFormatHeure(await pont().reglages.lire(CLE_REGLAGES_HEURE));
}

export async function reglerFormatHeure(format: HourCycle): Promise<void> {
	await pont().reglages.ecrire(CLE_REGLAGES_HEURE, format);
}

/** Android: when the app returns to the foreground with a different system clock, calls `onChange`. */
export function suivreFormatHeureTelephone(current: () => HourCycle, onChange: () => void): void {
	if (!pont().android) return;
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState !== "visible") return;
		void formatHeureTelephone().then(f => { if (f !== current()) onChange(); });
	});
}
