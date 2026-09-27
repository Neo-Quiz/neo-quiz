/* ══════════════════════════════════════════════════════════
   LA TRANSITION DE LANCEMENT D'UN QUIZ (2026-09-27)

   Référence : StudySmarter au clic sur « Réviser N flashcards », relevée par
   `document.getAnimations()` — c'est la transition de page iOS d'Ionic.
   - la NOUVELLE page monte depuis le bas : `translateY(100%) → 0` ;
   - l'ANCIENNE recule derrière : un peu plus étroite (`scaleX(0.97)`),
     16 px plus haut, et s'assombrit à la toute fin (opacité 0,5 à 95 %) ;
   - la barre d'outils de l'ancienne page s'efface (300 ms vers 0, 200 ms
     vers 0,6) ;
   - le contenu de la nouvelle entre en fondu, `translateY(20%) → 0`.
   500 ms, `cubic-bezier(0.36, 0.66, 0, 1)` pour les deux pages. Au retour,
   la même chose à l'envers, avec la MÊME courbe (des images clés inversées,
   pas `direction: "reverse"`, qui inverserait aussi la courbe : le
   mouvement démarrerait lentement et finirait vite).

   LE MÉCANISME : LES DEUX VUES SUPERPOSÉES DANS LA RACINE, animées par la
   Web Animations API. La View Transitions API a été écartée : elle peint
   chaque vue nommée ISOLÉE, sans ce qu'il y a derrière — le panneau de verre
   (`backdrop-filter`) aurait perdu son flou pendant 500 ms, puis l'aurait
   retrouvé d'un coup à la fin. Elle GÈLE aussi le rendu pendant la lecture
   asynchrone de la note. Superposées, les deux vues restent de vrais nœuds :
   le verre reste du verre, et le moteur du quiz mesure ses slides dans le
   vrai panneau, à sa vraie taille.

   Ce que la superposition coûte, et comment c'est tenu :
   - l'ancienne vue reste 500 ms dans le DOM. Elle est DÉJÀ démontée
     (`demonterCourant`, écouteurs et abonnements retirés) et `inert` : ni
     clic ni focus. Elle est retirée à la fin, sur TOUTES les issues
     (animation finie, annulée, ou garde de temps ci-dessous) ;
   - pendant la transition, la racine passe en grille à une seule case
     (`nq-empile`, `shell.css`) : les deux vues occupent la même place. La
     classe tombe avec les vues sortantes ;
   - aucune animation d'ENTRÉE ne garde la main sur `transform` après sa fin
     (le piège de `npm run check:view-enter`) : les entrantes sont en
     `fill: "backwards"`, leur fin retombe sur le style de base, identique à
     leur dernière image. Seules les SORTANTES tiennent leur dernière image
     (`forwards`), le temps d'être retirées.
══════════════════════════════════════════════════════════ */

const DUREE_MS = 500;
const COURBE = "cubic-bezier(0.36, 0.66, 0, 1)";

/* La page qui recule derrière. Les images clés relevées telles quelles. */
const RECUL: Keyframe[] = [
	{ offset: 0, opacity: 1, transform: "translateY(0) scaleX(1)" },
	{ offset: 0.95, opacity: 1 },
	{ offset: 1, opacity: 0.5, transform: "translateY(-16px) scaleX(0.97)" },
];
/* Le même recul, rejoué à l'envers au retour : 95 % devient 5 %. */
const RETOUR: Keyframe[] = [
	{ offset: 0, opacity: 0.5, transform: "translateY(-16px) scaleX(0.97)" },
	{ offset: 0.05, opacity: 1 },
	{ offset: 1, opacity: 1, transform: "translateY(0) scaleX(1)" },
];

/* La « barre d'outils » de la page qui recule : chez Neo Quiz, les en-têtes
   des pages du tableau de bord (fiche d'un quiz, « Mes quiz », accueil)
   s'effacent comme les titres d'Ionic (vers 0 en 300 ms) ; le rail, qui
   joue le rôle des boutons de la barre, s'estompe vers 0,6 en 200 ms. */
const EN_TETES = ".qbd-fiche-head, .qbd-quizzes-header, .qbd-home-header";
const RAIL = ".qbd-sidebar";

/* Au-delà, la transition est FORCÉE à sa fin : une animation qui ne se
   terminerait jamais (fenêtre masquée au mauvais moment, nœud retiré par
   ailleurs) laisserait la vue fantôme dans le DOM et le verrou de `main.ts`
   fermé pour toujours. */
const GARDE_MS = DUREE_MS + 500;

export type SensTransition = "entree" | "sortie";

/** Vrai si l'utilisateur a demandé moins de mouvement : pas de transition du
    tout, le changement d'écran est immédiat. */
export function mouvementReduit(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Joue la transition entre les vues `sortants` (encore affichées, déjà
 * démontées) et la vue `entrant` (déjà montée dans `root`), puis RETIRE les
 * sortants du DOM. La promesse se résout une fois le DOM propre : c'est elle
 * que `main.ts` attend pour rouvrir son verrou.
 *
 * `entree` : l'entrant est l'écran d'un quiz, il monte par-dessus la page
 * qui recule. `sortie` : le sortant est l'écran du quiz, il redescend et
 * découvre la page qui revient.
 */
export function jouerTransition(root: HTMLElement, sortants: HTMLElement[], entrant: HTMLElement, sens: SensTransition): Promise<void> {
	const retirer = (): void => {
		for (const s of sortants) s.remove();
		root.classList.remove("nq-empile");
	};
	if (sortants.length === 0 || mouvementReduit()) {
		retirer();
		return Promise.resolve();
	}
	for (const s of sortants) s.inert = true;
	root.classList.add("nq-empile");

	const base: KeyframeAnimationOptions = { duration: DUREE_MS, easing: COURBE };
	const animations: Animation[] = [];
	if (sens === "entree") {
		for (const s of sortants) {
			animations.push(s.animate(RECUL, { ...base, fill: "forwards" }));
			for (const el of s.querySelectorAll<HTMLElement>(EN_TETES)) {
				animations.push(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: COURBE, fill: "forwards" }));
			}
			for (const el of s.querySelectorAll<HTMLElement>(RAIL)) {
				animations.push(el.animate([{ opacity: 1 }, { opacity: 0.6 }], { duration: 200, easing: COURBE, fill: "forwards" }));
			}
		}
		animations.push(entrant.animate([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], { ...base, fill: "backwards" }));
		// Le contenu du quiz (en-tête, moteur) entre en fondu, à part du panneau.
		for (const enfant of Array.from(entrant.children)) {
			animations.push(enfant.animate(
				[{ opacity: 0, transform: "translateY(20%)" }, { opacity: 1, transform: "translateY(0)" }],
				{ duration: DUREE_MS, easing: "ease-in-out", fill: "backwards" },
			));
		}
	} else {
		for (const s of sortants) {
			// Le quiz qui redescend passe DEVANT la page qui revient, montée après lui.
			s.style.zIndex = "1";
			animations.push(s.animate([{ transform: "translateY(0)" }, { transform: "translateY(100%)" }], { ...base, fill: "forwards" }));
		}
		animations.push(entrant.animate(RETOUR, { ...base, fill: "backwards" }));
		for (const el of entrant.querySelectorAll<HTMLElement>(EN_TETES)) {
			animations.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: COURBE, fill: "backwards" }));
		}
		for (const el of entrant.querySelectorAll<HTMLElement>(RAIL)) {
			animations.push(el.animate([{ opacity: 0.6 }, { opacity: 1 }], { duration: 200, easing: COURBE, fill: "backwards" }));
		}
	}

	return new Promise<void>(resoudre => {
		let fini = false;
		const terminer = (): void => {
			if (fini) return;
			fini = true;
			clearTimeout(garde);
			/* `cancel` et non `finish` : les sortantes partent avec leur nœud,
			   et les entrantes (`backwards`) n'ont déjà plus d'effet ; rien
			   ne doit rester dans `document.getAnimations()`. */
			for (const a of animations) a.cancel();
			retirer();
			resoudre();
		};
		const garde = window.setTimeout(terminer, GARDE_MS);
		/* `finished` REJETTE sur une annulation : l'`allSettled` couvre les
		   deux issues, et `terminer` est idempotent. */
		void Promise.allSettled(animations.map(a => a.finished)).then(terminer);
	});
}
