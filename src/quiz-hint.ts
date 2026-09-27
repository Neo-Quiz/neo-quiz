/**
 * LES NIVEAUX D'UN INDICE — module PUR : ni hôte, ni DOM.
 *
 * `hint` est une clé du FORMAT (jamais traduite). Elle accepte deux formes :
 * - une chaîne, la forme historique : un seul niveau ;
 * - un tableau de chaînes, du niveau le plus léger au plus révélateur
 *   (retours du 2026-09-26 : une question difficile, comme « Conversion et
 *   typage dynamique », restait bloquante avec un seul indice).
 *
 * Une valeur invalide (nombre, objet, tableau sans texte) est IGNORÉE : la
 * question n'a pas d'indice, plutôt que d'afficher « [object Object] ». Dans
 * un tableau, seuls les éléments texte non vides comptent.
 *
 * Lu par le moteur (engine/hint.ts), la conversion vers l'éditeur
 * (editor/convert.ts) et le contrôle à l'arrivée (quiz-format.ts) : une
 * seule règle, trois lecteurs.
 */

const texteNonVide = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Les niveaux d'un indice, dans l'ordre, textes d'origine préservés. */
export function niveauxIndice(brut: unknown): string[] {
	if (texteNonVide(brut)) return [brut];
	if (Array.isArray(brut)) return brut.filter(texteNonVide);
	return [];
}

/** La question a-t-elle au moins un niveau d'indice ? */
export function aIndice(brut: unknown): boolean {
	return niveauxIndice(brut).length > 0;
}
