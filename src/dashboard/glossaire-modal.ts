import { ajouter } from "../dom";
import { currentHost, requireHost } from "../host/current";
import { t } from "../i18n";
import { creerChampDirect, libererChamps } from "../editor/champ-direct";
import type { ChampDirect } from "../editor/champ-direct";
import { lireGlossaire } from "../glossaire";
import type { EntreeGlossaire } from "../glossaire";
import type { EnteteAction } from "./detail-head";
import { setActionBadge } from "./detail-head";
import type { QuizDraft } from "./detail-io";

/* ══════════════════════════════════════════════════════════
   MODALE « VOCABULAIRE » (page d'un quiz, mode édition — tâche 4 du lot D)

   Un éditeur de set façon Quizlet : une ligne par entrée du glossaire
   (Terme | Définition côte à côte, « Autres formes » discrète en dessous,
   corbeille), « Ajouter un terme » en bas. Chaque champ est un
   `creerChampDirect` D'UNE LIGNE (editor/champ-direct.ts), comme les autres
   textes courts de l'éditeur — la définition y garde son markdown inline
   (gras, code, `$…$`), c'est ce que la bulle du moteur rend ensuite
   (`engine/termes-bulle.ts`).

   AUCUNE validation ni filtrage ici : une ligne vide (terme non encore
   écrit) reste dans `draft.examOptions.glossary` jusqu'à la sauvegarde, qui
   l'ignore à l'export (`editor/export.ts` `glossaryEntries`, tâche 3). Le
   compteur affiché (bouton de l'en-tête, `glossaryHeaderAction`) repasse
   par `lireGlossaire` pour ne compter que les entrées EXPLOITABLES.

   La modale est PORTALÉE au `<body>` par l'hôte (`HostModals.open`), hors de
   `.qbd-root` : les champs `.qb-direct` n'y héritent PAS du style scopé
   `.qbd-root .qb-direct` de `dashboard-editor.css`, d'où la feuille dédiée
   (`.qbd-gloss-modal .qb-direct`, même fichier).
══════════════════════════════════════════════════════════ */

/** Ensures `draft.examOptions` and its `glossary` array WITHOUT ever giving
    the quiz a mode — a quiz without a configuration object that gains a
    glossary stays a Practice (the export then writes `mode: 'quiz'`) — and
    returns the reference to MUTATE, the same throughout the editing session
    (the modal, like the export, reads it in place). */
function garantirGlossaire(draft: QuizDraft): EntreeGlossaire[] {
	draft.examOptions ??= {};
	draft.examOptions.glossary ??= [];
	return draft.examOptions.glossary;
}

/** Le nombre de termes EXPLOITABLES (terme et définition non vides) d'un
    brouillon — celui qu'affiche la pastille du bouton d'en-tête. Une ligne
    tout juste ajoutée, encore vide, ne compte pas. */
function compterTermes(draft: QuizDraft): number {
	return lireGlossaire(draft.examOptions?.glossary ?? []).length;
}

/** Le texte de la pastille du bouton « Vocabulaire », ou `undefined` sans
    brouillon chargé ni terme exploitable. Exportée pour que `detail.ts`
    rafraîchisse la pastille une fois le brouillon chargé (voir
    `glossaryHeaderAction` ci-dessous : posée AVANT ce chargement, elle ne
    peut pas encore compter les termes). */
export function texteBadgeGlossaire(draft: QuizDraft | null): string | undefined {
	if (!draft) return undefined;
	const compte = compterTermes(draft);
	return compte > 0 ? t(compte === 1 ? "editor.glossary.countOne" : "editor.glossary.countOther", { count: compte }) : undefined;
}

/**
 * L'action « Vocabulaire » de l'en-tête, en édition seulement (l'appelant ne
 * la pousse dans `EnteteDeps.actions` que si `editing` vaut vrai) : icône
 * `book-a`, pastille du nombre de termes s'il y en a. Le clic ouvre la
 * modale ; sa fermeture met à jour la pastille SANS repeindre tout l'en-tête
 * (`setActionBadge`).
 *
 * `getDraft` est un GETTER, pas le brouillon lui-même : l'action se pose dès
 * que `editing` est vrai (menu « Modifier », création d'un quiz), AVANT que
 * `spec.load()` n'ait résolu — `draft` vaut alors encore `null` un instant.
 * Lu à CHAQUE clic, jamais figé, pour refléter le brouillon du moment même
 * si la page a fini de charger entre-temps. `key: "glossary"` permet à
 * `detail.ts` de retrouver le bouton déjà peint pour rafraîchir sa pastille
 * (`texteBadgeGlossaire`) sans repeindre tout l'en-tête.
 */
export function glossaryHeaderAction(getDraft: () => QuizDraft | null, scheduleSave: () => void): EnteteAction {
	return {
		label: t("editor.glossary.button"),
		icon: "book-a",
		badge: texteBadgeGlossaire(getDraft()),
		key: "glossary",
		onClick: (el) => {
			// Cliqué avant la fin du chargement (cas rare) : rien à glosser.
			const draft = getDraft();
			if (!draft) return;
			openGlossaireModal({
				glossary: garantirGlossaire(draft),
				onChange: scheduleSave,
				onClose: (n) => setActionBadge(el, n > 0 ? t(n === 1 ? "editor.glossary.countOne" : "editor.glossary.countOther", { count: n }) : undefined),
			});
		},
	};
}

export interface GlossaireModalDeps {
	/** Le tableau à modifier EN PLACE — `draft.examOptions.glossary`, déjà
	    garanti non nul par l'appelant. Chaque geste (frappe, ajout, retrait)
	    le mute directement, jamais une copie. */
	glossary: EntreeGlossaire[];
	/** Une entrée a changé : planifie la sauvegarde différée existante. */
	onChange(): void;
	/** Appelée à la fermeture avec le nombre de termes EXPLOITABLES. */
	onClose(count: number): void;
}

/** Une ligne d'une virgule à l'autre : `aliases` va-et-vient d'un tableau à
    une chaîne affichée, jamais l'inverse — la source de vérité reste
    `entree.aliases`. */
function texteAlias(entree: EntreeGlossaire): string {
	return (entree.aliases ?? []).join(", ");
}

/** Ouvre la modale « Vocabulaire ». `deps.glossary` est mutée en place par
    chaque geste ; rien ici ne filtre ni ne valide — voir l'en-tête du
    module. */
export function openGlossaireModal(deps: GlossaireModalDeps): void {
	requireHost("modals").open({
		className: "qbd-gloss-modal",
		title: t("editor.glossary.title"),
		onOpen: (m) => {
			const c = m.contentEl;
			const liste = ajouter(c, "div", "qbd-gloss-list");

			/** Repeint la liste ; `focaliser` : l'index de la ligne fraîchement
			    ajoutée, pour y mettre le focus (champ Terme). */
			function peindre(focaliser?: number): void {
				// Les champs de la liste PRÉCÉDENTE d'abord : sans ça, chaque
				// repeint (ajout, retrait) laisse des vues CodeMirror détachées
				// avec leurs écouteurs sur le document.
				libererChamps(liste);
				liste.replaceChildren();

				if (deps.glossary.length === 0) {
					const vide = ajouter(liste, "div", "qbd-gloss-empty");
					currentHost().ui.setIcon(ajouter(vide, "div", "qbd-gloss-empty-icon"), "book-a");
					ajouter(vide, "p", "qbd-gloss-empty-text", t("editor.glossary.empty"));
					return;
				}

				// UNE BOUCLE `for`, jamais `.forEach` : TypeScript ne suit
				// l'affectation de `champAFocaliser` qu'à travers un flux
				// SYNCHRONE de la même fonction — dans une fermeture passée à
				// `.forEach`, il la perd et retombe sur `null` après coup, en
				// ferait échouer `?.focus()` (« type never »).
				let champAFocaliser: ChampDirect | null = null;
				for (let i = 0; i < deps.glossary.length; i++) {
					const champTerme = ligneEntree(liste, deps.glossary[i], i);
					if (i === focaliser) champAFocaliser = champTerme;
				}
				champAFocaliser?.focus();
			}

			/** Une ligne : Terme | Définition côte à côte + corbeille, « Autres
			    formes » discrète en dessous. Rend le `ChampDirect` du Terme, pour
			    que `peindre` puisse y remettre le focus après un ajout. */
			function ligneEntree(parent: HTMLElement, entree: EntreeGlossaire, index: number): ChampDirect {
				const ligne = ajouter(parent, "div", "qbd-gloss-row");
				const champsLigne = ajouter(ligne, "div", "qbd-gloss-fields");

				const termeWrap = ajouter(champsLigne, "div", "qbd-gloss-term qb-direct qb-direct--ligne");
				const champTerme = creerChampDirect(termeWrap, {
					valeur: entree.term,
					multiligne: false,
					placeholder: t("editor.glossary.term"),
					etiquette: t("editor.glossary.term"),
					onChange: (v) => { entree.term = v; deps.onChange(); },
				});

				const defWrap = ajouter(champsLigne, "div", "qbd-gloss-def qb-direct qb-direct--ligne");
				creerChampDirect(defWrap, {
					valeur: entree.definition,
					multiligne: false,
					placeholder: t("editor.glossary.definition"),
					etiquette: t("editor.glossary.definition"),
					onChange: (v) => { entree.definition = v; deps.onChange(); },
				});

				const supprimer = ajouter(champsLigne, "button", "qbd-gloss-del");
				supprimer.type = "button";
				supprimer.setAttribute("aria-label", t("editor.glossary.remove"));
				currentHost().ui.setIcon(supprimer, "trash-2");
				supprimer.addEventListener("click", () => {
					deps.glossary.splice(index, 1);
					deps.onChange();
					peindre();
				});

				const aliasWrap = ajouter(ligne, "div", "qbd-gloss-aliases qb-direct qb-direct--ligne");
				creerChampDirect(aliasWrap, {
					valeur: texteAlias(entree),
					multiligne: false,
					placeholder: t("editor.glossary.aliases"),
					etiquette: t("editor.glossary.aliases"),
					onChange: (v) => {
						const aliases = v.split(",").map(a => a.trim()).filter(a => a !== "");
						if (aliases.length > 0) entree.aliases = aliases; else delete entree.aliases;
						deps.onChange();
					},
				});

				return champTerme;
			}

			peindre();

			const pied = ajouter(c, "div", "qbd-gloss-footer");
			const ajouterBtn = ajouter(pied, "button", "qbd-btn--create");
			ajouterBtn.type = "button";
			currentHost().ui.setIcon(ajouter(ajouterBtn, "span", "qbd-btn-icon"), "plus");
			ajouter(ajouterBtn, "span", undefined, t("editor.glossary.add"));
			ajouterBtn.addEventListener("click", () => {
				deps.glossary.push({ term: "", definition: "" });
				deps.onChange();
				peindre(deps.glossary.length - 1);
			});

			const fermerBtn = ajouter(pied, "button", "qb-btn", t("editor.glossary.close"));
			fermerBtn.type = "button";
			fermerBtn.addEventListener("click", () => m.close());
		},
		/* Appelée APRÈS la disparition (contrat `HostModals`) : le panneau est
		   déjà détaché, donc chaque champ encore « vivant » l'est d'une frappe
		   passée — `libererChamps()` les détruit tous d'un coup, comme la page
		   le fait pour les siens à chaque repeint. */
		onClose: () => {
			libererChamps();
			deps.onClose(lireGlossaire(deps.glossary).length);
		},
	});
}
