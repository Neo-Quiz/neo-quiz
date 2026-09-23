import { normaliserTexte } from "./sortie";

/* L'ÉCHELLE D'UN EXERCICE (spec §5.2, rapport de recherche) :
   - l'indice k s'ouvre au k-ième échec, jamais à la demande en rafale
     (Aleven 2004 : 33 % des actions faisaient défiler les indices) ;
   - la solution arrive au bout de (indices + 1) échecs, au plus tôt au 2e
     (Beck & Gong 2013 : tourner dans le vide n'apprend plus rien) ;
   - revérifier un code inchangé ne compte pas (Baniassad 2021 : le
     correcteur martelé à la place de la réflexion). */
export interface EtatCode {
	code: string;
	echecs: number;
	dernierVerifie: string | null;
	solutionVue: boolean;
	reussi: boolean;
	passe: boolean;
}

export function etatInitial(starter: string): EtatCode {
	return { code: starter, echecs: 0, dernierVerifie: null, solutionVue: false, reussi: false, passe: false };
}

/** `compte` : la vérification a-t-elle changé l'état ? */
export function apresVerification(etat: EtatCode, codeVerifie: string, reussi: boolean): { etat: EtatCode; compte: boolean } {
	if (etat.reussi || etat.passe) return { etat, compte: false };
	const norme = normaliserTexte(codeVerifie);
	if (reussi) return { etat: { ...etat, code: codeVerifie, reussi: true, dernierVerifie: norme }, compte: true };
	if (etat.dernierVerifie === norme) return { etat, compte: false };
	return { etat: { ...etat, code: codeVerifie, echecs: etat.echecs + 1, dernierVerifie: norme }, compte: true };
}

export function indicesVisibles(etat: EtatCode, nbIndices: number): number {
	return Math.min(etat.echecs, nbIndices);
}

export function solutionDebloquee(etat: EtatCode, nbIndices: number): boolean {
	return etat.echecs >= Math.max(2, nbIndices + 1);
}

export function passerDisponible(etat: EtatCode): boolean {
	return etat.echecs >= 1;
}

/* Valeurs PERSISTÉES du journal (`ReviewGrade`). La solution vue l'emporte :
   le verdict est tombé au moment de la révélation, un succès ensuite ne le
   rachète pas (spec §9, décision 2). */
export function verdictCode(etat: EtatCode): "correct" | "wrong" | "skipped" | null {
	if (etat.solutionVue) return "wrong";
	if (etat.passe) return "skipped";
	if (etat.reussi) return "correct";
	return null;
}
