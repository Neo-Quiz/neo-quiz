/* ══════════════════════════════════════════════════════════
   LE BLOC QUI GLISSE d'un sélecteur segmenté (relevé sur claude.ai le
   2026-09-23) : un seul indicateur posé sous les options, déplacé en FLIP
   au changement — 200 ms, cubic-bezier(.32, .72, 0, 1), depuis l'ancienne
   position, avec un scaleX qui rattrape l'ancienne largeur.

   Partagé par le sélecteur Learn | Practice de la page « Générer » et par
   celui de la fiche d'un cours : deux copies finiraient par glisser
   différemment. L'indicateur est positionné en absolu dans le sélecteur
   (`position: relative`), et les options sont au-dessus de lui.
══════════════════════════════════════════════════════════ */

/** Durée du glissement, en ms — exportée pour qui doit attendre sa fin. */
export const DUREE_GLISSEMENT = 200;

/** Place `indic` sous `cible` ; `anime` fait glisser depuis la position
    précédente (aucune animation au premier placement, ni sous
    `prefers-reduced-motion`). */
export function placerIndicateur(indic: HTMLElement, cible: HTMLElement, anime: boolean): void {
	const ancienX = indic.dataset.x === undefined ? null : parseFloat(indic.dataset.x);
	const ancienneL = parseFloat(indic.dataset.w || "0");
	const x = cible.offsetLeft, w = cible.offsetWidth;
	indic.dataset.x = String(x);
	indic.dataset.w = String(w);
	indic.style.width = `${w}px`;
	indic.style.transform = `translateX(${x}px)`;
	const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	if (anime && !reduit && ancienX !== null && ancienneL > 0) {
		indic.animate(
			{ transform: [`translateX(${ancienX}px) scaleX(${ancienneL / w})`, `translateX(${x}px) scaleX(1)`] },
			{ duration: DUREE_GLISSEMENT, easing: "cubic-bezier(.32, .72, 0, 1)" },
		);
	}
}
