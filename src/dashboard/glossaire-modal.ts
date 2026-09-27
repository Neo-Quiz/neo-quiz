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
import type { EditorExamOptions } from "../types/editor-ctx";

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

/** Les défauts du moteur (`quiz-utils.ts buildExamOpts`), jamais des valeurs
    « raisonnables » choisies ici : un quiz sans objet de configuration qui
    gagne un glossaire ne doit PAS gagner un examen activé pour autant. */
const OPTIONS_EXAMEN_NEUTRES: Pick<EditorExamOptions, "enabled" | "durationMinutes" | "autoSubmit" | "showTimer"> = {
	enabled: false,
	durationMinutes: 10,
	autoSubmit: true,
	showTimer: true,
};

/** Garantit `draft.examOptions` et son tableau `glossary`, SANS jamais
    activer l'examen, et rend la référence à MUTER — la même tout au long de
    la session d'édition (la modale, comme l'export, la lit en place). */
function garantirGlossaire(draft: QuizDraft): EntreeGlossaire[] {
	draft.examOptions ??= { ...OPTIONS_EXAMEN_NEUTRES };
	draft.examOptions.glossary ??= [];
	return draft.examOptions.glossary;
}

/** Le nombre de termes EXPLOITABLES (terme et définition non vides) d'un
    brouillon — celui qu'affiche la pastille du bouton d'en-tête. Une ligne
    tout juste ajoutée, encore vide, ne compte pas. */
function compterTermes(draft: QuizDraft): number {
	return lireGlossaire(draft.examOptions?.glossary ?? []).length;
}

/**
 * L'action « Vocabulaire » de l'en-tête, en édition seulement (l'appelant ne
 * la pousse dans `EnteteDeps.actions` que si `editing` vaut vrai) : icône
 * `book-a`, pastille du nombre de termes s'il y en a. Le clic ouvre la
 * modale ; sa fermeture met à jour la pastille SANS repeindre tout l'en-tête
 * (`setActionBadge`).
 */
export function glossaryHeaderAction(draft: QuizDraft, scheduleSave: () => void): EnteteAction {
	const compte = compterTermes(draft);
	return {
		label: t("editor.glossary.button"),
		icon: "book-a",
		badge: compte > 0 ? t(compte === 1 ? "editor.glossary.countOne" : "editor.glossary.countOther", { count: compte }) : undefined,
		onClick: (el) => {
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
