import { currentLang, hourOptions } from "../i18n";

/* ══════════════════════════════════════════════════════════
   FORMAT DE DATE PARTAGÉ — jour, mois court, année, heure selon le réglage
   24 h / 12 h (`hourOptions`), jamais selon la langue seule (l'anglais
   écrivait « 06:35 PM », cf. `hourOptions`, src/i18n.ts).

   Extrait de `detail.ts` (`origineDe`/`formatGeneratedAt`) pour que l'onglet
   Progression (une tentative) affiche EXACTEMENT le même format que la date
   de génération d'un quiz, sans une seconde implémentation qui pourrait
   diverger.
══════════════════════════════════════════════════════════ */

/** Date et heure d'un `Date`, dans le format commun de l'application.
    Appelée AU RENDU, comme `t()`, pour suivre un changement de langue. */
export function formatDateHeure(d: Date): string {
	return d.toLocaleString(currentLang() === "fr" ? "fr-FR" : "en-US", {
		day: "numeric", month: "short", year: "numeric", minute: "2-digit", ...hourOptions(),
	});
}
