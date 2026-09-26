/* ══════════════════════════════════════════════════════════
   PAS D'EXAMEN, PAS DE RÉVISION (2026-09-26)

   Une question n'est « due » que si le module de sa note a un examen À
   VENIR. Pure : le store de révision de l'app (`store.ts`) l'applique à
   `plan().today` et `plan().deferred`, UNE porte pour l'accueil, le bouton
   de l'étape suivante et le Planning. Le journal, lui, continue d'être
   écrit : ajouter un examen fait réapparaître ce que l'historique rend dû.
══════════════════════════════════════════════════════════ */

export function garderSiExamen(cles: readonly string[], moduleAExamen: (cheminNote: string) => boolean): string[] {
	return cles.filter(cle => {
		const sep = cle.lastIndexOf("::");
		return sep > 0 && moduleAExamen(cle.slice(0, sep));
	});
}
