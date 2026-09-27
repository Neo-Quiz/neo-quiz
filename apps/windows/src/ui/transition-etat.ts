/* ══════════════════════════════════════════════════════════
   LE NOYAU PUR DES CHANGEMENTS D'ÉCRAN (2026-09-27)

   Lancer un quiz ou en revenir joue une transition de 500 ms
   (`transition-quiz.ts`). Ce module décide, SANS DOM ni minuteur, ce que
   devient une demande qui arrive pendant ce temps. Éprouvé par
   `npm run check:transition`.

   Les règles :
   - au repos, toute demande part tout de suite (`lancer`) ;
   - une demande du MÊME sens que la transition en cours est un double clic :
     IGNORÉE (« Commencer le quiz » cliqué deux fois ne lance pas deux
     moteurs ; la flèche retour cliquée deux fois ne remonte pas deux
     coquilles) ;
   - une demande du sens CONTRAIRE est MISE EN FILE (`enfiler`), et part dès
     la fin de la transition : un retour cliqué pendant que le quiz monte
     finit par arriver, au lieu d'être avalé en silence. Une seule place :
     une seconde demande du même sens que celle déjà en file est, elle aussi,
     un double clic, ignoré ;
   - `finir` rend la transition au repos et la demande en file, que
     l'appelant resoumet (elle repasse par `demander`, donc par les mêmes
     règles).

   La transition INVERSE part à la fin de l'entrée et non en inversant
   l'animation en cours (`animation.reverse()`) : la coquille, sous le quiz,
   est déjà DÉMONTÉE (écouteurs, abonnement au scanner) ; la faire revenir
   exige de toute façon d'en monter une neuve. Inverser l'animation aurait
   ramené à l'écran une page morte.
══════════════════════════════════════════════════════════ */

export type SensEcran = "ouvrir" | "retour";

export interface DemandeEcran<T> {
	sens: SensEcran;
	donnee: T;
}

export interface EtatTransition<T> {
	/** Le sens de la transition en cours, ou `null` au repos. */
	enCours: SensEcran | null;
	/** La demande à rejouer à la fin de la transition en cours. */
	enFile: DemandeEcran<T> | null;
}

export type ActionDemande = "lancer" | "enfiler" | "ignorer";

export function etatInitial<T>(): EtatTransition<T> {
	return { enCours: null, enFile: null };
}

export function demander<T>(etat: EtatTransition<T>, demande: DemandeEcran<T>): { etat: EtatTransition<T>; action: ActionDemande } {
	if (etat.enCours === null) return { etat: { enCours: demande.sens, enFile: null }, action: "lancer" };
	if (etat.enCours === demande.sens || etat.enFile?.sens === demande.sens) return { etat, action: "ignorer" };
	return { etat: { enCours: etat.enCours, enFile: demande }, action: "enfiler" };
}

export function finir<T>(etat: EtatTransition<T>): { etat: EtatTransition<T>; suivante: DemandeEcran<T> | null } {
	return { etat: etatInitial<T>(), suivante: etat.enFile };
}

/**
 * Animer, ou poser directement l'état final ? Immédiat quand l'utilisateur
 * a demandé moins de mouvement, et quand la fenêtre est MASQUÉE : une
 * fenêtre cachée ne peint pas d'images, ses animations n'avanceraient pas,
 * et la fin ne doit jamais dépendre d'une image affichée.
 */
export function choisirMode(mouvementReduit: boolean, fenetreMasquee: boolean): "anime" | "immediat" {
	return mouvementReduit || fenetreMasquee ? "immediat" : "anime";
}

/**
 * Les vues à retirer à la fin d'une transition : les sortantes, SAUF une
 * vue encore utile (l'écran qu'on vient de monter), et chacune UNE fois
 * même si elle était listée deux fois.
 *
 * Sert aussi à la « pile de feuilles » (2026-09-27, `main.ts`, `vueGardee`) :
 * la coquille du tableau de bord GARDÉE derrière un quiz est une « utile »
 * de plus, jamais retirée ni démontée — `utiles` accepte n'importe quel
 * nombre de vues protégées, l'entrant et les gardées comprises.
 */
export function vuesARetirer<V>(sortants: readonly V[], utiles: readonly V[]): V[] {
	return [...new Set(sortants)].filter(v => !utiles.includes(v));
}

/**
 * Une fin qui ne s'exécute qu'UNE fois, quel que soit le chemin qui y
 * arrive le premier (événement `finish`, fenêtre masquée en cours de route,
 * minuteur de secours) : les vues sortantes ne sont jamais retirées deux
 * fois, et le verrou n'est jamais rouvert deux fois.
 */
export function uneFois(fn: () => void): () => void {
	let fait = false;
	return () => {
		if (fait) return;
		fait = true;
		fn();
	};
}
