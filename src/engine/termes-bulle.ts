import type { EngineCtx } from "../types/engine-ctx";
import { mathifyElement } from "./mathjax";

/* ══════════════════════════════════════════════════════════
   BULLE DE DÉFINITION — survol/focus/tap d'un `.qb-terme` (engine/termes.ts)

   UNE bulle par instance de quiz, portalée au `<body>` en `position: fixed` :
   la piste du quiz est transformée et coupée (`overflow` clip pour la
   transition de slide), une bulle qui resterait DANS la carte serait rognée
   ou embarquée dans le glissement. Réutilisée pour chaque terme ouvert —
   jamais recréée.

   Événements DÉLÉGUÉS sur `document` (spec §4) : le contenu d'une carte est
   dans `ctx.container`, mais la modale d'indice (`engine/hint.ts`) est
   posée directement sous `document.body` — un seul point d'écoute doit
   couvrir les deux. `appartientAInstance` borne cette délégation à CETTE
   instance (`ctx.container` ou SON overlay d'indice, identifié par
   `ctx.HINT_OVERLAY_ID`) : plusieurs quiz sur la même page (greffon
   Obsidian) n'interfèrent jamais l'un avec l'autre, chacun garde ses propres
   écouteurs `document`, retirés par `destroy()` (poussé sur
   `ctx.__quizGlobalCleanups`, engine/termes.ts).
══════════════════════════════════════════════════════════ */

/** Délai avant ouverture au survol (spec §1 : « délai ~250 ms »). */
const DELAI_OUVERTURE_MS = 250;
/** Grâce avant fermeture au survol : le temps de traverser vers la bulle. */
const DELAI_GRACE_MS = 150;
/** Marge entre la bulle et le bord de la fenêtre (spec §4). */
const MARGE_FENETRE_PX = 8;

export interface BulleGlossaireHandlers {
	/** Ferme la bulle ouverte, s'il y en a une. Appelé au changement de
	    question : la piste GLISSE sans rien détacher, l'ancre reste connectée
	    et la veille ne la verrait pas partir. */
	fermer(): void;
	/** Retire tous les écouteurs globaux et l'élément de la bulle. */
	destroy(): void;
}

export function creerBulleGlossaire(ctx: EngineCtx): BulleGlossaireHandlers {
	// Éléments de la bulle — créés paresseusement, à la première ouverture.
	let bulle: HTMLElement | null = null;
	let termeEl: HTMLElement | null = null;
	let definitionEl: HTMLElement | null = null;
	// Le `.qb-terme` actuellement décrit par la bulle ouverte, ou `null`.
	let ancreOuverte: HTMLElement | null = null;
	// Ce qui a OUVERT la bulle actuelle (défaut #1, revue du 2026-09-27) : un
	// clic sur un terme dont la bulle est déjà ouverte par survol ou focus la
	// GARDE ouverte — seul un clic sur une bulle ouverte PAR UN CLIC la referme.
	let causeOuverture: "survol" | "clavier" | "clic" | null = null;
	// Le terme dont le PROCHAIN `focusin` ne doit PAS ouvrir la bulle (défaut
	// #1 et #6) : posé sur `pointerdown` (le focus qu'il donne précède le
	// `click`, qui décide seul), et avant un refocus PROGRAMMATIQUE après
	// Échap (`surEchap`, plus bas) — sans quoi ce refocus rouvrirait aussitôt
	// une bulle qu'on vient de fermer. Consommé (remis à `null`) au premier
	// `focusin` qui le voit, qu'il corresponde ou non.
	let ignorerProchainFocusDe: HTMLElement | null = null;
	let minuteurOuverture = 0;
	let minuteurFermeture = 0;
	let veilleRaf = 0;

	/** `cible` appartient-elle à CETTE instance de quiz — sa carte, ou sa
	    modale d'indice (les deux seuls hôtes possibles d'un `.qb-terme`) ? */
	function appartientAInstance(cible: Element): boolean {
		if (ctx.container.contains(cible)) return true;
		const overlay = document.getElementById(ctx.HINT_OVERLAY_ID);
		return !!overlay && overlay.contains(cible);
	}

	function elementTerme(cible: EventTarget | null): HTMLElement | null {
		if (!(cible instanceof Element)) return null;
		const el = cible.closest<HTMLElement>(".qb-terme");
		return el && appartientAInstance(el) ? el : null;
	}

	function assurerBulle(): { bulle: HTMLElement; terme: HTMLElement; definition: HTMLElement } {
		if (bulle && termeEl && definitionEl) return { bulle, terme: termeEl, definition: definitionEl };
		const el = document.createElement("div");
		el.className = "qb-terme-bulle";
		el.setAttribute("role", "tooltip");
		el.id = `qb-terme-bulle-${ctx.QUIZ_INSTANCE_ID}`;
		el.hidden = true;
		el.setAttribute("aria-hidden", "true");
		const terme = el.appendChild(document.createElement("strong"));
		terme.className = "qb-terme-bulle-terme";
		const definition = el.appendChild(document.createElement("div"));
		definition.className = "qb-terme-bulle-def";
		// La grâce de fermeture s'annule si le pointeur ENTRE dans la bulle —
		// sans quoi survoler la définition pour la lire la ferme aussitôt.
		el.addEventListener("pointerenter", annulerFermeture);
		el.addEventListener("pointerleave", planifierFermeture);
		document.body.appendChild(el);
		bulle = el;
		termeEl = terme;
		definitionEl = definition;
		return { bulle: el, terme, definition };
	}

	/** Place la bulle au-dessus de `cible`, en dessous s'il manque la place,
	    bornée à la fenêtre. `position: fixed` (relatif au viewport) : la
	    bulle n'a pas à suivre le défilement d'un ancêtre. */
	function positionner(el: HTMLElement, cible: HTMLElement): void {
		const rectCible = cible.getBoundingClientRect();
		const rectBulle = el.getBoundingClientRect();

		let haut = rectCible.top - rectBulle.height - MARGE_FENETRE_PX;
		const enDessous = haut < MARGE_FENETRE_PX;
		if (enDessous) haut = rectCible.bottom + MARGE_FENETRE_PX;
		haut = Math.min(Math.max(haut, MARGE_FENETRE_PX), window.innerHeight - rectBulle.height - MARGE_FENETRE_PX);

		let gauche = rectCible.left + rectCible.width / 2 - rectBulle.width / 2;
		gauche = Math.min(Math.max(gauche, MARGE_FENETRE_PX), window.innerWidth - rectBulle.width - MARGE_FENETRE_PX);

		el.style.top = `${Math.round(haut)}px`;
		el.style.left = `${Math.round(gauche)}px`;
		el.classList.toggle("qb-terme-bulle--bas", enDessous);
	}

	/** La bulle meurt avec son ancre : si `.qb-terme` sort du DOM (repeint
	    d'une carte, navigation) pendant qu'elle est ouverte, on la referme au
	    lieu de la laisser flotter sur une cible qui n'existe plus. */
	function surveillerAncre(): void {
		if (veilleRaf) cancelAnimationFrame(veilleRaf);
		const boucle = (): void => {
			if (!ancreOuverte || !bulle || bulle.hidden) { veilleRaf = 0; return; }
			if (!ancreOuverte.isConnected) { fermer(); return; }
			veilleRaf = requestAnimationFrame(boucle);
		};
		veilleRaf = requestAnimationFrame(boucle);
	}

	function ouvrir(cible: HTMLElement, cause: "survol" | "clavier" | "clic"): void {
		const i = Number(cible.dataset.terme);
		const entree = ctx.glossaire[i];
		if (!entree) return;
		annulerFermeture();

		const { bulle: el, terme, definition } = assurerBulle();
		ancreOuverte = cible;
		causeOuverture = cause;
		terme.textContent = entree.term;
		// Porte n°1 du sanitizer (déjà échappée) : la définition est une
		// donnée du quiz, potentiellement partagée/hostile.
		definition.innerHTML = ctx.sanitize.renderInlineText(entree.definition);
		// La formule d'une définition grandit la bulle une fois rendue (MathJax
		// est asynchrone) : la repositionner ALORS, mais seulement si elle est
		// toujours ouverte sur la MÊME ancre (défaut #8, revue du 2026-09-27) —
		// sinon on déplacerait la bulle d'un AUTRE terme, ouvert entre-temps.
		void mathifyElement(definition).then(() => {
			if (bulle && !bulle.hidden && ancreOuverte === cible) positionner(bulle, cible);
		});

		el.hidden = false;
		el.setAttribute("aria-hidden", "false");
		positionner(el, cible);
		// Forcer un reflow avant la classe d'ouverture, pour que la transition
		// d'opacité parte bien de l'état fermé (même patron que dom.ts ancreRemontee).
		void el.offsetWidth;
		el.classList.add("is-open");

		cible.setAttribute("aria-describedby", el.id);
		surveillerAncre();
	}

	function fermer(): void {
		if (veilleRaf) { cancelAnimationFrame(veilleRaf); veilleRaf = 0; }
		causeOuverture = null;
		if (!bulle || bulle.hidden) { ancreOuverte = null; return; }
		bulle.classList.remove("is-open");
		bulle.setAttribute("aria-hidden", "true");
		bulle.hidden = true;
		ancreOuverte?.removeAttribute("aria-describedby");
		ancreOuverte = null;
	}

	function annulerOuverture(): void {
		if (minuteurOuverture) { clearTimeout(minuteurOuverture); minuteurOuverture = 0; }
	}
	function annulerFermeture(): void {
		if (minuteurFermeture) { clearTimeout(minuteurFermeture); minuteurFermeture = 0; }
	}
	function planifierOuverture(cible: HTMLElement): void {
		annulerFermeture();
		annulerOuverture();
		minuteurOuverture = window.setTimeout(() => { minuteurOuverture = 0; ouvrir(cible, "survol"); }, DELAI_OUVERTURE_MS);
	}
	function planifierFermeture(): void {
		annulerFermeture();
		minuteurFermeture = window.setTimeout(() => { minuteurFermeture = 0; fermer(); }, DELAI_GRACE_MS);
	}

	// ── Écouteurs délégués, un seul jeu pour toute l'instance ──
	/* Posé en CAPTURE, avant tout : le `pointerdown` d'un clic/tap donne le
	   FOCUS (tabindex=0) avant même le `click` qui suit — sans ce drapeau,
	   `surFocusIn` ouvrirait déjà la bulle, et `surClic` la verrait ouverte et
	   la refermerait aussitôt (défaut #1, revue du 2026-09-27). Posé pour
	   n'importe quelle cible (y compris `null`, hors d'un terme) : ça purge
	   aussi un drapeau resté en place après un pointerdown qui n'a pas mené à
	   un focus (glissé hors de l'ancre avant relâche). */
	function surPointerDown(e: PointerEvent): void {
		ignorerProchainFocusDe = elementTerme(e.target);
	}
	function surPointerOver(e: PointerEvent): void {
		if (e.pointerType !== "mouse") return; // tactile : voir surClic
		const cible = elementTerme(e.target);
		if (!cible) return;
		if (cible === ancreOuverte) {
			// Revenir sur l'ancre (depuis la bulle, ou un aller-retour de souris)
			// ne doit pas laisser filer une fermeture déjà planifiée (défaut #7).
			annulerFermeture();
			return;
		}
		planifierOuverture(cible);
	}
	function surPointerOut(e: PointerEvent): void {
		if (e.pointerType !== "mouse") return;
		const cible = elementTerme(e.target);
		if (!cible) return;
		annulerOuverture();
		planifierFermeture();
	}
	function surFocusIn(e: FocusEvent): void {
		const cible = elementTerme(e.target);
		if (!cible) return;
		if (ignorerProchainFocusDe === cible) {
			// Focus provoqué par un pointeur (défaut #1) ou par le refocus
			// PROGRAMMATIQUE d'Échap (défaut #6) — jamais une vraie navigation
			// clavier : ne PAS ouvrir, `click` ou l'état déjà fermé décident.
			ignorerProchainFocusDe = null;
			return;
		}
		annulerOuverture();
		annulerFermeture();
		ouvrir(cible, "clavier");
	}
	function surFocusOut(e: FocusEvent): void {
		const cible = elementTerme(e.target);
		if (!cible) return;
		planifierFermeture();
	}
	function surClic(e: MouseEvent): void {
		const cible = elementTerme(e.target);
		if (!cible) {
			// Clic ailleurs (spec §1) : ferme, sauf si le clic est dans la bulle
			// elle-même (lien, sélection de texte de la définition).
			if (bulle && !bulle.hidden && !(e.target instanceof Node && bulle.contains(e.target))) fermer();
			return;
		}
		e.preventDefault();
		annulerOuverture();
		annulerFermeture();
		if (bulle && !bulle.hidden && ancreOuverte === cible) {
			// Un clic sur un terme dont la bulle est déjà ouverte PAR LE SURVOL
			// ou LE FOCUS la GARDE ouverte ; seul un clic sur une bulle ouverte
			// PAR UN CLIC la referme (défaut #1, revue : mémorise la cause
			// d'ouverture). Un clic explicite en devient désormais le « propriétaire » :
			// un second clic la refermera bien, comme sur un simple bouton.
			if (causeOuverture === "clic") { fermer(); return; }
			causeOuverture = "clic";
			return;
		}
		ouvrir(cible, "clic");
	}
	/* En CAPTURE et arrêté : Échap ferme d'abord la bulle, et elle seule — la
	   modale d'indice qui la contient (son propre `keydown` sur `document`)
	   reste ouverte ; un second Échap la fermera. Un niveau par touche. */
	function surEchap(e: KeyboardEvent): void {
		if (e.key !== "Escape" || !bulle || bulle.hidden) return;
		e.stopPropagation();
		const aRefocuser = ancreOuverte;
		fermer();
		// Le refocus ci-dessous peut donner à `aRefocuser` un focus qu'il
		// n'avait pas (bulle ouverte par SURVOL) : sans ce drapeau, le
		// `focusin` qu'il déclenche rouvrirait aussitôt la bulle qu'on vient de
		// fermer (défaut #6, revue).
		ignorerProchainFocusDe = aRefocuser;
		try { aRefocuser?.focus(); } catch (_) { /* meilleur effort */ }
	}
	/** Le défilement (page, ou un support replié qui défile) — REPOSITIONNE la
	    bulle tant que son ancre reste visible dans la fenêtre (un Tab vers un
	    terme hors vue fait défiler le navigateur : fermer la couperait avant
	    même qu'elle soit lue, défaut #3) ; ferme SEULEMENT si l'ancre en sort
	    (ou quitte le DOM). Même logique pour un redimensionnement. */
	function surDefilement(): void {
		if (!bulle || bulle.hidden || !ancreOuverte) return;
		if (!ancreOuverte.isConnected) { fermer(); return; }
		const r = ancreOuverte.getBoundingClientRect();
		const visible = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
		if (!visible) { fermer(); return; }
		positionner(bulle, ancreOuverte);
	}

	document.addEventListener("pointerdown", surPointerDown, true);
	document.addEventListener("pointerover", surPointerOver);
	document.addEventListener("pointerout", surPointerOut);
	document.addEventListener("focusin", surFocusIn);
	document.addEventListener("focusout", surFocusOut);
	document.addEventListener("click", surClic);
	document.addEventListener("keydown", surEchap, true);
	window.addEventListener("scroll", surDefilement, { capture: true, passive: true });
	window.addEventListener("resize", surDefilement, { passive: true });

	function destroy(): void {
		// D'abord fermer : l'ancre ouverte perd son `aria-describedby`, qui
		// désignerait sinon une bulle retirée.
		fermer();
		annulerOuverture();
		annulerFermeture();
		ignorerProchainFocusDe = null;
		if (veilleRaf) { cancelAnimationFrame(veilleRaf); veilleRaf = 0; }
		document.removeEventListener("pointerdown", surPointerDown, true);
		document.removeEventListener("pointerover", surPointerOver);
		document.removeEventListener("pointerout", surPointerOut);
		document.removeEventListener("focusin", surFocusIn);
		document.removeEventListener("focusout", surFocusOut);
		document.removeEventListener("click", surClic);
		document.removeEventListener("keydown", surEchap, true);
		window.removeEventListener("scroll", surDefilement, { capture: true });
		window.removeEventListener("resize", surDefilement);
		bulle?.remove();
		bulle = null;
		termeEl = null;
		definitionEl = null;
		ancreOuverte = null;
	}

	return {
		fermer(): void { annulerOuverture(); annulerFermeture(); fermer(); },
		destroy,
	};
}
