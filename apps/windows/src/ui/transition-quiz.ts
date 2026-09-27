/* ══════════════════════════════════════════════════════════
   LA TRANSITION DE LANCEMENT D'UN QUIZ (2026-09-27)

   Référence : StudySmarter au clic sur « Réviser N flashcards », relevée par
   `document.getAnimations()` — c'est la transition de page iOS d'Ionic.
   - la NOUVELLE page monte depuis le bas : `translateY(100%) → 0` (ici
     depuis le bas de la fenêtre — voir `distanceHorsFenetre`) ;
   - l'ANCIENNE recule derrière : un peu plus étroite (`scaleX(0.97)`),
     16 px plus haut, et s'assombrit à la toute fin (opacité 0,5 à 95 % ;
     ici un VOILE sur le panneau, jamais une opacité — voir `RECUL`) ;
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
     (événement `finish`, fenêtre masquée, minuteur de secours ci-dessous) ;
   - pendant la transition, la racine passe en grille à une seule case
     (`nq-empile`, `shell.css`) : les deux vues occupent la même place. La
     classe tombe avec les vues sortantes ;
   - aucune animation d'ENTRÉE ne garde la main sur `transform` après sa fin
     (le piège de `npm run check:view-enter`) : les entrantes sont en
     `fill: "backwards"`, leur fin retombe sur le style de base, identique à
     leur dernière image. Seules les SORTANTES tiennent leur dernière image
     (`forwards`), le temps d'être retirées.
══════════════════════════════════════════════════════════ */

import { choisirMode, uneFois, vuesARetirer } from "./transition-etat";

const DUREE_MS = 500;
const COURBE = "cubic-bezier(0.36, 0.66, 0, 1)";

/* La page qui recule derrière : le TRANSFORM relevé, sans son opacité.
   Une `opacity` animée sur la coquille en fait la racine d'arrière-plan
   (« backdrop root ») de son panneau de verre : pendant les 500 ms, le
   `backdrop-filter` du panneau ne voyait plus le fond d'écran, le panneau
   perdait son flou dès la première image et le retrouvait d'un coup à la
   dernière. Et l'opacité 0,5 d'arrivée n'était pas l'état figé de la pile
   (voile de `nq-pile-fond`, opacité 1) : un saut de plus, au début du retour
   comme à la fin de la montée. L'assombrissement est donc celui du VOILE
   (`VOILE`, ci-dessous), le même nœud que l'état figé.
   Plus de `translateY(-16px)` non plus (2026-09-27) : remontée, la page
   dépassait du quiz d'un bandeau de 16 px, logo du rail compris, pendant
   tout le quiz. Elle ne fait plus que se resserrer, et reste entière
   derrière lui ; `nq-pile-fond` (`shell.css`) fige le même `scaleX`. */
const RECUL: Keyframe[] = [
	{ transform: "scaleX(1)" },
	{ transform: "scaleX(0.97)" },
];
const RETOUR: Keyframe[] = [...RECUL].reverse();

/* Le voile du panneau (`::after` de `.qbd-content`, `shell.css`) : il monte
   avec le recul, sur la même courbe, et arrive exactement sur l'opacité que
   `nq-pile-fond` lui donne ensuite. Pas le palier tardif du relevé (95 %) :
   25 ms pour passer d'une page claire à une page voilée se lisaient comme un
   saut de plus. */
const PANNEAU = ":scope > .qbd-content";
const VOILE: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

/* Le quiz monte depuis le bas de la FENÊTRE, pas `translateY(100%)` : son
   panneau ne remplit pas la fenêtre (la barre de titre au-dessus, une marge
   égale en dessous, `shell.css`). Décalé de sa seule hauteur, son bord haut
   restait dans la marge du bas : ce bandeau apparaissait d'un coup à la
   première image de la montée, et au retour le quiz s'y immobilisait, freiné
   par la courbe, avant de disparaître net. Mesuré sur le panneau au repos,
   avant qu'aucune animation ne le déplace. */
function distanceHorsFenetre(panneau: HTMLElement): number {
	return Math.max(0, window.innerHeight - panneau.getBoundingClientRect().top);
}

/* RIEN SOUS LA VITRE DU QUIZ — la mécanique de la colonne « all day » de
   Neo Calendar : la page derrière est COUPÉE (`clip-path`) au bord haut du
   quiz, et la coupe suit ce bord pendant tout le mouvement. Le panneau du
   quiz est du verre : sans elle, il floutait la page encore peinte dessous
   (le bouton bleu « Commencer le quiz » en tache floue) au lieu du seul fond
   d'écran. Une fois le quiz en place, la page est coupée ENTIÈRE ;
   `nq-pile-fond` fige ensuite la même coupe.

   Les deux panneaux partagent la même case de grille, donc le même bord
   haut au repos, et la page ne bouge pas verticalement. Dans son repère, le
   bord haut du quiz est à `distance · (1 − p)` à la progression `p` de la
   montée : LINÉAIRE en `p`, parce que les images clés s'interpolent sur la
   même courbe et la même durée que la montée du quiz. Elles tombent donc
   juste à chaque image. La coupe reste nulle tant que le quiz est plus bas
   que la page (`croise`).

   POSÉE SUR LES ENFANTS de la coquille (le rail, le panneau), JAMAIS sur la
   coquille : ANIMÉ, un `clip-path` part au compositeur, qui le traite comme
   un masque, et un masque sur un ANCÊTRE du panneau de verre coupe son flou
   comme le faisait l'opacité (mesuré en lecture réelle, ralentie : netteté
   0,81 sur la coquille, 0,29 sur ses enfants comme au repos). Sur le panneau
   lui-même, le masque découpe son propre flou sans le lui retirer. */
function coupe(hauteurPage: number, distance: number, sens: SensTransition): Keyframe[] {
	const ouverte = "inset(0px 0px 0px 0px)";
	const fermee = `inset(0px 0px ${hauteurPage}px 0px)`;
	const croise = distance > 0 ? Math.min(1, Math.max(0, (distance - hauteurPage) / distance)) : 0;
	return sens === "entree"
		? [{ offset: 0, clipPath: ouverte }, { offset: croise, clipPath: ouverte }, { offset: 1, clipPath: fermee }]
		: [{ offset: 0, clipPath: fermee }, { offset: 1 - croise, clipPath: ouverte }, { offset: 1, clipPath: ouverte }];
}

function enfantsDe(el: HTMLElement): HTMLElement[] {
	return Array.from(el.children).filter((e): e is HTMLElement => e instanceof HTMLElement);
}

/* La « barre d'outils » de la page qui recule : chez Neo Quiz, les en-têtes
   des pages du tableau de bord (fiche d'un quiz, « Mes quiz », accueil)
   s'effacent comme les titres d'Ionic (vers 0 en 300 ms) ; le rail, qui
   joue le rôle des boutons de la barre, s'estompe vers 0,6 en 200 ms. */
const EN_TETES = ".qbd-fiche-head, .qbd-quizzes-header, .qbd-home-header";
const RAIL = ".qbd-sidebar";

/* Le minuteur de SECOURS, jamais le chemin normal : la fin normale est
   l'événement `finish` des animations, et une fenêtre masquée ne les joue
   même pas (`choisirMode`). Il ne reste que l'imprévu — un nœud retiré par
   ailleurs, une animation annulée par un tiers — qui laisserait sans lui la
   vue fantôme dans le DOM et le verrou de `main.ts` fermé pour toujours.
   Large : il ne doit JAMAIS couper une transition qui tourne encore à
   l'écran, même saccadée. */
const SECOURS_MS = DUREE_MS * 4;

export type SensTransition = "entree" | "sortie";

/** Vrai si l'utilisateur a demandé moins de mouvement : pas de transition du
    tout, le changement d'écran est immédiat. */
export function mouvementReduit(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * L'ENTRÉE PROPRE de la vue entrante est absorbée : c'est la transition qui
 * fait l'entrée. Sans ça, au retour d'un quiz, le `qbd-fade-in` de
 * `.qbd-content` (et toute entrée `.qbd-*-enter` posée par `markViewEnter`)
 * glissait et fondait DANS la page qui, elle, revenait de son recul : deux
 * mouvements imbriqués. Même chose, à l'entrée, pour le panneau du quiz.
 *
 * `finish()` et non `cancel()` ni `animation: none` : l'animation saute à sa
 * fin, son `animationend` part, et `markViewEnter` retire sa classe
 * d'entrée comme d'habitude — rien ne reste posé qui priverait la PROCHAINE
 * navigation de son entrée. Les animations INFINIES (le chemin qui défile
 * dans une carte de dossier) ne sont pas des entrées : laissées tranquilles
 * (et `finish()` jetterait sur elles).
 *
 * Côté quiz, seul le PANNEAU (`subtree: false`) : le moteur a ses propres
 * animations, dont il attend peut-être la fin — les précipiter n'est pas
 * notre affaire.
 */
function absorberEntree(entrant: HTMLElement, sens: SensTransition): void {
	for (const a of entrant.getAnimations({ subtree: sens === "sortie" })) {
		if (!(a instanceof CSSAnimation) || !a.animationName.startsWith("qbd-")) continue;
		if (a.effect?.getTiming().iterations === Infinity) continue;
		a.finish();
	}
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
 *
 * `garder` (2026-09-27, « pile de feuilles ») : des vues parmi `sortants` qui
 * ne sont PAS démontées ni retirées — la coquille du tableau de bord, gardée
 * derrière le quiz (`main.ts`, `vueGardee`). Elles reçoivent la MÊME
 * animation de recul que les vraies sortantes, mais à la fin, au lieu d'être
 * retirées, elles reçoivent la classe statique `nq-pile-fond` (`shell.css`) —
 * jamais une animation `fill: "forwards"` qui resterait posée indéfiniment
 * (le piège de `npm run check:view-enter`). `nq-empile` reste alors sur la
 * racine : les deux vues continuent de se superposer tant que la vue gardée
 * n'est pas revenue au premier plan.
 */
export function jouerTransition(root: HTMLElement, sortants: HTMLElement[], entrant: HTMLElement, sens: SensTransition, garder: HTMLElement[] = []): Promise<void> {
	/* Ni l'entrant ni une vue GARDÉE ne sont jamais retirés, même listés
	   parmi les sortants (`vuesARetirer`). */
	const aRetirer = vuesARetirer(sortants, [entrant, ...garder]);
	const retirer = (): void => {
		for (const s of aRetirer) s.remove();
		for (const g of garder) {
			g.classList.add("nq-pile-fond");
			g.setAttribute("aria-hidden", "true");
		}
		// Encore une vue gardée dessous : la grille reste, le quiz reste dessus.
		if (garder.length === 0) root.classList.remove("nq-empile");
	};
	if ((aRetirer.length === 0 && garder.length === 0) || choisirMode(mouvementReduit(), document.visibilityState === "hidden") === "immediat") {
		retirer();
		return Promise.resolve();
	}
	for (const s of [...aRetirer, ...garder]) s.inert = true;
	root.classList.add("nq-empile");
	absorberEntree(entrant, sens);

	const base: KeyframeAnimationOptions = { duration: DUREE_MS, easing: COURBE };
	const animations: Animation[] = [];
	if (sens === "entree") {
		// Mesurée AVANT toute animation : le quiz est encore à sa place de repos.
		const distance = distanceHorsFenetre(entrant);
		for (const s of [...aRetirer, ...garder]) {
			animations.push(s.animate(RECUL, { ...base, fill: "forwards" }));
			for (const enfant of enfantsDe(s)) animations.push(enfant.animate(coupe(enfant.offsetHeight, distance, "entree"), { ...base, fill: "forwards" }));
			for (const p of s.querySelectorAll<HTMLElement>(PANNEAU)) {
				animations.push(p.animate(VOILE, { ...base, pseudoElement: "::after", fill: "forwards" }));
			}
			for (const el of s.querySelectorAll<HTMLElement>(EN_TETES)) {
				animations.push(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: COURBE, fill: "forwards" }));
			}
			for (const el of s.querySelectorAll<HTMLElement>(RAIL)) {
				animations.push(el.animate([{ opacity: 1 }, { opacity: 0.6 }], { duration: 200, easing: COURBE, fill: "forwards" }));
			}
		}
		animations.push(entrant.animate([{ transform: `translateY(${distance}px)` }, { transform: "translateY(0)" }], { ...base, fill: "backwards" }));
		// Le contenu du quiz (en-tête, moteur) entre en fondu, à part du panneau.
		for (const enfant of Array.from(entrant.children)) {
			animations.push(enfant.animate(
				[{ opacity: 0, transform: "translateY(20%)" }, { opacity: 1, transform: "translateY(0)" }],
				{ duration: DUREE_MS, easing: "ease-in-out", fill: "backwards" },
			));
		}
	} else {
		const quiz = aRetirer[0];
		if (quiz) {
			const distance = distanceHorsFenetre(quiz);
			for (const enfant of enfantsDe(entrant)) animations.push(enfant.animate(coupe(enfant.offsetHeight, distance, "sortie"), { ...base, fill: "backwards" }));
		}
		for (const s of aRetirer) {
			/* Le quiz qui redescend passe DEVANT la page qui revient, montée
			   après lui. Ce `z-index` part avec le nœud (`retirer`) ; il est
			   tout de même effacé à la fin, pour qu'un nœud un jour réutilisé
			   ne le garde pas collé. */
			s.style.zIndex = "1";
			animations.push(s.animate([{ transform: "translateY(0)" }, { transform: `translateY(${distanceHorsFenetre(s)}px)` }], { ...base, fill: "forwards" }));
		}
		animations.push(entrant.animate(RETOUR, { ...base, fill: "backwards" }));
		for (const p of entrant.querySelectorAll<HTMLElement>(PANNEAU)) {
			animations.push(p.animate([...VOILE].reverse(), { ...base, pseudoElement: "::after", fill: "backwards" }));
		}
		for (const el of entrant.querySelectorAll<HTMLElement>(EN_TETES)) {
			animations.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: COURBE, fill: "backwards" }));
		}
		for (const el of entrant.querySelectorAll<HTMLElement>(RAIL)) {
			animations.push(el.animate([{ opacity: 0.6 }, { opacity: 1 }], { duration: 200, easing: COURBE, fill: "backwards" }));
		}
	}

	return new Promise<void>(resoudre => {
		let restantes = animations.length;
		const surFin = (): void => { if (--restantes <= 0) terminer(); };
		/* La fenêtre passe MASQUÉE en cours de route (réduite pendant la
		   montée) : ses animations cessent d'avancer. On pose l'état final
		   tout de suite plutôt que d'attendre des images qui ne viendront pas. */
		const surVisibilite = (): void => { if (document.visibilityState === "hidden") terminer(); };
		/* `uneFois` : trois chemins mènent ici (le dernier `finish`, la
		   fenêtre masquée, le secours), un seul retire les vues. */
		const terminer = uneFois(() => {
			clearTimeout(secours);
			document.removeEventListener("visibilitychange", surVisibilite);
			for (const a of animations) {
				a.removeEventListener("finish", surFin);
				a.removeEventListener("cancel", surFin);
				/* `cancel` et non `finish` : les sortantes partent avec leur
				   nœud, les entrantes (`backwards`) n'ont déjà plus d'effet ;
				   rien ne doit rester dans `document.getAnimations()`. */
				a.cancel();
			}
			for (const s of aRetirer) s.style.zIndex = "";
			retirer();
			resoudre();
		});
		const secours = window.setTimeout(terminer, SECOURS_MS);
		document.addEventListener("visibilitychange", surVisibilite);
		/* L'événement `finish` de CHAQUE animation (et `cancel`, si un tiers
		   en annulait une : elle ne finirait jamais). */
		for (const a of animations) {
			a.addEventListener("finish", surFin);
			a.addEventListener("cancel", surFin);
		}
	});
}
