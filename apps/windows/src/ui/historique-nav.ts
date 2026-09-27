/* ══════════════════════════════════════════════════════════
   HISTORIQUE DE NAVIGATION — noyau PUR (ni DOM, ni hôte).

   Les boutons « précédent » et « suivant » d'une souris (boutons 3 et 4)
   parcourent les pages du tableau de bord comme un navigateur : deux piles,
   arrière et avant. Portage de l'historique de l'ancienne vue Obsidian
   (spec 2026-07-20-mouse-nav-history), rendu générique : l'appelant dit ce
   qu'est un état et quand deux états sont le même.

   - `enregistrer(courant)` : on QUITTE `courant` pour une autre page. Il va
     sur la pile arrière, et la pile avant est vidée (comme un navigateur :
     une nouvelle navigation efface le futur).
   - `reculer(courant)` / `avancer(courant)` : rendent l'état où aller, ou
     `null` si la pile est vide ; `courant` passe sur l'autre pile.
   - Deux enregistrements consécutifs du même état n'en font qu'un.
   - La pile arrière est bornée (`max`) ; reculer puis avancer ne fait que
     déplacer un état d'une pile à l'autre, le total reste borné.
══════════════════════════════════════════════════════════ */

export interface Historique<T> {
	enregistrer(courant: T): void;
	reculer(courant: T): T | null;
	avancer(courant: T): T | null;
	peutReculer(): boolean;
	peutAvancer(): boolean;
}

export function creerHistorique<T>(memeEtat: (a: T, b: T) => boolean, max = 50): Historique<T> {
	const arriere: T[] = [];
	const avant: T[] = [];
	return {
		enregistrer(courant) {
			const sommet = arriere[arriere.length - 1];
			if (sommet !== undefined && memeEtat(sommet, courant)) return;
			arriere.push(courant);
			if (arriere.length > max) arriere.shift();
			avant.length = 0;
		},
		reculer(courant) {
			const cible = arriere.pop();
			if (cible === undefined) return null;
			avant.push(courant);
			return cible;
		},
		avancer(courant) {
			const cible = avant.pop();
			if (cible === undefined) return null;
			arriere.push(courant);
			return cible;
		},
		peutReculer: () => arriere.length > 0,
		peutAvancer: () => avant.length > 0,
	};
}
