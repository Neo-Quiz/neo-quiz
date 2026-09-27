/* ══════════════════════════════════════════════════════════
   LA CATÉGORIE, CÔTÉ PAGE « GÉNÉRER » (retour #7, 2026-09-26)

   Le nom traduit et l'icône Lucide de chaque catégorie (categorie-quiz.ts),
   et l'AVIS posé près du bouton des options du composer : « Python
   détecté », en texte avec l'icône, sans pastille. Rien n'est affiché pour
   `general`.
══════════════════════════════════════════════════════════ */

import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import { CATEGORIES } from "./categorie-quiz";
import type { CategorieQuiz } from "./categorie-quiz";

const ICONES: Readonly<Record<CategorieQuiz, string>> = {
	general: "book-open",
	python: "code",
	c: "cpu",
	bash: "terminal",
	sql: "database",
	web: "globe",
	maths: "sigma",
	reseau: "network",
};

/* Les clés écrites en entier (jamais composées) : une recherche de la clé
   la retrouve, et une clé absente est une erreur de compilation. */
const NOMS: Readonly<Record<CategorieQuiz, TransKey>> = {
	general: "ai.categorie.general",
	python: "ai.categorie.python",
	c: "ai.categorie.c",
	bash: "ai.categorie.bash",
	sql: "ai.categorie.sql",
	web: "ai.categorie.web",
	maths: "ai.categorie.maths",
	reseau: "ai.categorie.reseau",
};

/** Le nom affiché d'une catégorie, lu AU RENDU (langue courante). */
export function libelleCategorie(c: CategorieQuiz): string {
	return t(NOMS[c]);
}

export function iconeCategorie(c: CategorieQuiz): string {
	return ICONES[c];
}

/** « Python détecté » ; l'accord pluriel pour « Maths détectées ». */
export function libelleDetecte(c: CategorieQuiz): string {
	return t(c === "maths" ? "ai.categorie.detectedPlural" : "ai.categorie.detected", { name: libelleCategorie(c) });
}

/** Les choix du menu des options : toutes les catégories, `general` compris. */
export function choixCategories(): { value: CategorieQuiz; label: string; icon: string }[] {
	return CATEGORIES.map(c => ({ value: c, label: libelleCategorie(c), icon: iconeCategorie(c) }));
}

/**
 * Peint l'avis dans `el` : icône et texte, ou rien. `detectee` : la
 * catégorie vient de la détection (« Python détecté ») ; sinon elle a été
 * choisie dans les options (« Python »).
 */
export function peindreAvisCategorie(el: HTMLElement, c: CategorieQuiz, detectee: boolean): void {
	/* Repeint à chaque frappe : rien ne change tant que la catégorie reste
	   la même, sans quoi l'apparition se rejouerait à chaque lettre. */
	const cle = `${c}|${detectee}`;
	if (el.dataset.cle === cle) return;
	el.dataset.cle = cle;
	el.replaceChildren();
	const visible = c !== "general";
	el.hidden = !visible;
	if (!visible) return;
	currentHost().ui.setIcon(ajouter(el, "span", "qbd-ai-categorie-icone"), iconeCategorie(c));
	ajouter(el, "span", "qbd-ai-categorie-texte", detectee ? libelleDetecte(c) : libelleCategorie(c));
}
