import { t } from "../i18n";
import { ajouter } from "../dom";
import { _setIcon } from "../editor/utils";
import type { DraftQuestion } from "../editor/utils";
import {
	basculerBonne,
	ajouterOption,
	retirerOption,
	placerOrdre,
	associer,
	ajouterVariante,
	retirerVariante,
} from "../editor/gestes";

/* ══════════════════════════════════════════════════════════
   LES GESTES DE RÉPONSE dans le rendu corrigé (chantier 2026-09-26, tâche 4)

   `edition-rendu.ts` (tâche 3) rend chaque question corrigée et laisse ses
   TEXTES s'éditer au clic (`data-edit`). Ce module-ci décore la MÊME carte
   pour que les RÉPONSES — bonne réponse, options, classement, appariement,
   variantes de réponse acceptée — se changent par des gestes (clic, boutons
   Lucide) qui appellent les fonctions pures de `editor/gestes.ts`. Appelé
   à chaque repeint (`poser(carte, q)`), jamais monté seul.

   Aucun geste ne mute directement l'affichage : chacun passe par
   `deps.appliquer(fn, cibleApresRepeint?)`, qui valide d'abord un champ de
   texte ouvert (Review Focus 3 du brief), applique `fn`, puis sauvegarde et
   repeint si `fn` a renvoyé `true` — exactement le protocole que
   `edition-rendu.ts` suit déjà pour un texte validé.
══════════════════════════════════════════════════════════ */

/** Ce qu'un `[data-edit]` désigne dans le brouillon — même forme que la
    `Cible` interne d'`edition-rendu.ts` (typage structurel, pas d'export). */
interface Cible { champ: string; index: number }

export interface DepsGestesReponse {
	/**
	 * Applique un geste : ferme d'abord un champ de texte ouvert (sa valeur
	 * est écrite si elle a changé), exécute `fn`, et si elle renvoie `true`,
	 * sauvegarde (`onChange`) puis repeint. `ouvrirApres` : la cible à rouvrir
	 * dans la carte repeinte (la nouvelle option, la nouvelle variante).
	 */
	appliquer(fn: () => boolean, ouvrirApres?: Cible): void;
}

export interface GestesReponse {
	/** Décore la carte tout juste peinte par `renderQuizPreviewCard`. */
	poser(carte: HTMLElement, q: DraftQuestion): void;
}

/** Un bouton NU (aucun style de bouton natif) : chaque geste pose sa propre
    taille et sa propre position en CSS (dashboard-editor.css). */
function bouton(cls: string, etiquette: string): HTMLButtonElement {
	const b = document.createElement("button");
	b.type = "button";
	b.className = "qb-er-geste " + cls;
	b.setAttribute("aria-label", etiquette);
	return b;
}

/* ── QCM (single/multi) : pastille bonne réponse, corbeille, « + » ── */
function decorerOptions(carte: HTMLElement, q: DraftQuestion, deps: DepsGestesReponse): void {
	const isMulti = q.correctIndices !== undefined;
	const total = (q.options || []).length;
	carte.querySelectorAll<HTMLElement>('.quiz-option[data-edit="option"]').forEach((opt, oi) => {
		const bon = isMulti ? (q.correctIndices || []).includes(oi) : q.correctIndex === oi;
		const marquer = bouton("qb-er-bonne", t("editor.render.markCorrect"));
		marquer.setAttribute("aria-pressed", String(bon));
		marquer.addEventListener("click", e => {
			e.stopPropagation();
			e.preventDefault();
			deps.appliquer(() => basculerBonne(q, oi));
		});
		opt.insertBefore(marquer, opt.firstChild);

		// Corbeille : seulement si le retrait serait accepté — calculé sur une
		// COPIE des champs que `retirerOption` lit et mute, jamais sur `q`.
		const copie: DraftQuestion = {
			...q,
			options: [...(q.options || [])],
			correctIndices: q.correctIndices ? [...q.correctIndices] : undefined,
		};
		if (retirerOption(copie, oi)) {
			const del = bouton("qb-er-retirer", t("editor.render.removeOption"));
			_setIcon(del, "trash-2");
			del.addEventListener("click", e => {
				e.stopPropagation();
				e.preventDefault();
				deps.appliquer(() => retirerOption(q, oi));
			});
			opt.appendChild(del);
		}

		// « + » fin, sous l'option : ajoute une option après celle-ci, puis
		// ouvre directement son champ.
		const add = bouton("qb-er-ajouter-option", t("editor.render.addOption"));
		_setIcon(add, "plus");
		add.addEventListener("click", e => {
			e.stopPropagation();
			e.preventDefault();
			const at = oi >= total - 1 ? total : oi + 1;
			deps.appliquer(() => ajouterOption(q, oi), { champ: "option", index: at });
		});
		opt.appendChild(add);
	});
}

/** Options propres au CLASSEMENT (pas à l'appariement, le brief ne le demande
    que là) : ↑/← et ↓/→ échangent l'emplacement focalisé avec le précédent ou
    le suivant, sans passer par une sélection à deux clics. */
interface OptionsFleches {
	/** Focalise l'emplacement `i` après le prochain repeint. */
	focuserApres(i: number): void;
}

/* ── Classement / appariement : sélection par clic (emplacement, puis
   élément de la réserve ou un autre emplacement) ── */
function poserSelectionEmplacements(
	carte: HTMLElement,
	correctArr: number[],
	geste: (emplacement: number, element: number) => boolean,
	deps: DepsGestesReponse,
	fleches?: OptionsFleches,
): void {
	const slots = Array.from(carte.querySelectorAll<HTMLElement>(".quiz-slot"));
	const valeurs = slots
		.map(s => s.querySelector<HTMLElement>(".quiz-slot-value"))
		.filter((v): v is HTMLElement => !!v);
	const pool = Array.from(carte.querySelectorAll<HTMLElement>(".quiz-pool-item"));

	let selection: number | null = null;

	function razSelection(): void {
		selection = null;
		valeurs.forEach(v => {
			v.classList.remove("qb-er-selectionne");
			v.removeAttribute("aria-selected");
		});
	}
	function choisir(element: number): void {
		if (selection === null) return;
		const emplacement = selection;
		razSelection();
		deps.appliquer(() => geste(emplacement, element));
	}

	valeurs.forEach((v, si) => {
		v.classList.add("qb-er-geste");
		v.tabIndex = 0;
		v.setAttribute("role", "button");
		v.setAttribute("aria-label", t("editor.render.pickSlot"));
		v.addEventListener("click", e => {
			e.stopPropagation();
			if (selection === si) { razSelection(); return; }
			if (selection === null) {
				selection = si;
				v.classList.add("qb-er-selectionne");
				v.setAttribute("aria-selected", "true");
				return;
			}
			choisir(correctArr[si]);
		});
		v.addEventListener("keydown", e => {
			if (e.key === "Enter" || e.key === " ") { e.preventDefault(); v.click(); return; }
			if (!fleches) return;
			const monte = e.key === "ArrowUp" || e.key === "ArrowLeft";
			const descend = e.key === "ArrowDown" || e.key === "ArrowRight";
			if (!monte && !descend) return;
			// Aux bords : la flèche ne fait rien (pas d'`onChange`, la page ne
			// défile pas non plus — `preventDefault` avant de sortir).
			e.preventDefault();
			const cible = si + (monte ? -1 : 1);
			if (cible < 0 || cible >= valeurs.length) return;
			// L'élément du voisin est déjà en place (édition en mode « corrigé » :
			// chaque emplacement est toujours rempli) : `geste` l'échange avec
			// celui de l'emplacement focalisé, dans le même sens que `placerOrdre`.
			const elementVoisin = correctArr[cible];
			fleches.focuserApres(cible);
			deps.appliquer(() => geste(si, elementVoisin));
		});
	});

	pool.forEach((item, pi) => {
		item.setAttribute("aria-label", t("editor.render.pickChoice"));
		// Capture : devance le clic délégué d'edition-rendu.ts (ouverture du
		// texte) tant qu'un emplacement est sélectionné — sinon, laisse passer
		// pour que le texte reste éditable normalement (tâche 3, inchangée).
		item.addEventListener("click", e => {
			if (selection === null) return;
			e.stopPropagation();
			e.preventDefault();
			choisir(pi);
		}, true);
	});

	// Échap annule la sélection en cours, sans repeindre.
	carte.addEventListener("keydown", e => {
		if (e.key === "Escape" && selection !== null) razSelection();
	});
}

function decorerOrdering(carte: HTMLElement, q: DraftQuestion, deps: DepsGestesReponse, fleches: OptionsFleches): void {
	poserSelectionEmplacements(carte, q.correctOrder || [], (emplacement, element) => placerOrdre(q, emplacement, element), deps, fleches);
}

function decorerMatching(carte: HTMLElement, q: DraftQuestion, deps: DepsGestesReponse): void {
	poserSelectionEmplacements(carte, q.correctMap || [], (ligne, choix) => associer(q, ligne, choix), deps);
}

/* ── Réponses acceptées (text / numeric / terminal) : + Variante, corbeille
   par variante. Jamais sur la principale (index 0) : elle a besoin d'au
   moins une variante de repli, exactement la règle de `retirerVariante`. ── */
function decorerVariantes(carte: HTMLElement, q: DraftQuestion, deps: DepsGestesReponse): void {
	if (!q.acceptedAnswers) return;
	const primaire = carte.querySelector<HTMLElement>('[data-edit="accepted"][data-index="0"]');
	if (!primaire) return;

	const ancre = primaire.closest<HTMLElement>(".qcm-options") || primaire;
	let liste = ancre.nextElementSibling as HTMLElement | null;
	if (!(liste && liste.classList.contains("quiz-textonly-expected-list"))) liste = null;

	liste?.querySelectorAll<HTMLElement>('[data-edit="accepted"]').forEach(item => {
		const i = Number(item.getAttribute("data-index") ?? "0");
		const del = bouton("qb-er-retirer", t("editor.action.delete"));
		_setIcon(del, "trash-2");
		del.addEventListener("click", e => {
			e.stopPropagation();
			e.preventDefault();
			deps.appliquer(() => retirerVariante(q, i));
		});
		item.appendChild(del);
	});

	const add = bouton("qb-er-ajouter-variante", t("editor.render.addVariant"));
	_setIcon(add, "plus");
	ajouter(add, "span", "qb-er-ajouter-variante-label", t("editor.render.addVariant"));
	add.addEventListener("click", e => {
		e.stopPropagation();
		e.preventDefault();
		const at = (q.acceptedAnswers || []).length;
		deps.appliquer(() => ajouterVariante(q), { champ: "accepted", index: at });
	});
	(liste || ancre).insertAdjacentElement("afterend", add);
}

/** Construit le décorateur de gestes d'une instance d'édition dans le rendu.
    Un seul par `monterEditionRendu` (appelé à chaque repeint). */
export function creerGestesReponse(deps: DepsGestesReponse): GestesReponse {
	// L'emplacement à refocaliser une fois le PROCHAIN repeint terminé — posé
	// par une flèche, lu ici juste après avoir redécoré la carte (le repeint
	// déclenché par `deps.appliquer` est synchrone : `poser` tourne à nouveau
	// avant que `deps.appliquer` ne rende la main).
	let focusOrdreApres: number | null = null;

	function poser(carte: HTMLElement, q: DraftQuestion): void {
		if (q._type === "single" || q._type === "multi") decorerOptions(carte, q, deps);
		if (q._type === "ordering") {
			decorerOrdering(carte, q, deps, { focuserApres: i => { focusOrdreApres = i; } });
		}
		if (q._type === "matching") decorerMatching(carte, q, deps);
		decorerVariantes(carte, q, deps);

		if (q._type === "ordering" && focusOrdreApres !== null) {
			const i = focusOrdreApres;
			focusOrdreApres = null;
			carte.querySelectorAll<HTMLElement>(".quiz-slot")[i]
				?.querySelector<HTMLElement>(".quiz-slot-value")
				?.focus();
		}
	}
	return { poser };
}
