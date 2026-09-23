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

export async function chargerFormatHeure(): Promise<HourCycle> {
	return lireFormatHeure(await pont().reglages.lire(CLE_REGLAGES_HEURE));
}

export async function reglerFormatHeure(format: HourCycle): Promise<void> {
	await pont().reglages.ecrire(CLE_REGLAGES_HEURE, format);
}
