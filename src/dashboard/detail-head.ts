import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import { poserBouton3d, poserBouton3dNeutre } from "./cta3d";

/* ══════════════════════════════════════════════════════════
   EN-TÊTE DE LA PAGE D'UN QUIZ HORS FICHE (éditeur, aperçu, page « Générer »)

   Refonte de l'éditeur (2026-09-26) : le MÊME en-tête que la fiche
   (detail-fiche.ts, `renderHead`), mêmes classes `qbd-fiche-*` — la flèche
   retour au-dessus, le titre, le dossier en sous-titre dessous ; à droite
   « Terminé » en bouton 3D neutre et « Lancer » en bouton 3D bleu, aux
   tailles de « Modifier » et « Commencer le quiz ».

   Plus de chemin complet ni de ligne de méta (score, parties, tentatives) :
   ils vivent dans l'onglet Progression du dossier. La page « Générer », qui
   n'a pas de dossier, garde sa ligne d'usage en sous-titre.

   Module à part pour que `detail.ts` ne grossisse pas : il ne sait rien du
   brouillon ni de l'écriture — l'appelant lui passe des fonctions déjà
   enveloppées de son `flushSave`.
══════════════════════════════════════════════════════════ */

export interface EnteteAction {
	label: string;
	icon: string;
	onClick(el: HTMLElement): void;
	/** Pastille numérique après le libellé (compteur de termes du glossaire,
	    tâche 4 du lot D) — absente ou vide : pas de pastille. */
	badge?: string;
}

export interface EnteteDeps {
	title: string;
	/** Sous-titre : le dossier du quiz, ou la ligne d'usage d'une génération. Vide → masqué. */
	kicker: string;
	/** Vrai en édition : le bouton de bascule dit « Terminé », sinon « Modifier ». */
	editing: boolean;
	onBack(): void;
	onToggleEditing(): void;
	/** Actions secondaires (page « Générer » : « Insérer »), avant le bouton principal. */
	actions: EnteteAction[];
	/** Bouton principal (« Lancer », « Enregistrer »). Absent → masqué. */
	start?: EnteteAction;
	/** La ligne d'infos sous le titre (mode, nombre de questions, origine),
	    celle de la fiche. Absente (page « Générer ») → rien. */
	infos?(parent: HTMLElement): void;
}

/** Le dossier d'un quiz — le seul segment du chemin qui dise d'où il sort,
    même règle que la fiche et les cartes. Racine du vault : chaîne vide. */
export function dossierDuQuiz(path: string): string {
	return path.split("/").slice(0, -1).filter(Boolean).pop() ?? "";
}

function bouton(parent: HTMLElement, cls: string, icon: string, label: string, badge?: string): HTMLButtonElement {
	const btn = ajouter(parent, "button", cls);
	btn.type = "button";
	currentHost().ui.setIcon(ajouter(btn, "span", "qbd-btn-icon"), icon);
	ajouter(btn, "span", undefined, label);
	if (badge) ajouter(btn, "span", "qbd-qz-action-badge", badge);
	return btn;
}

/** Met à jour (ou retire) la pastille d'un bouton d'action déjà peint, sans
    repeindre tout l'en-tête — la modale « Vocabulaire » (tâche 4 du lot D)
    s'en sert à sa fermeture, une fois le compteur de termes connu. */
export function setActionBadge(btn: HTMLElement, badge?: string): void {
	let pastille = btn.querySelector<HTMLElement>(".qbd-qz-action-badge");
	if (!badge) { pastille?.remove(); return; }
	if (!pastille) pastille = ajouter(btn, "span", "qbd-qz-action-badge");
	pastille.textContent = badge;
}

export function renderEntete(page: HTMLElement, deps: EnteteDeps): HTMLElement {
	// `qbd-qz-top` et non `qbd-qz-header` : cette dernière classe habille aussi
	// l'en-tête de la page du LECTEUR (apps/windows/src/ui/quiz-page.ts), en
	// rangée. La changer en colonne ici l'aurait cassé là-bas.
	const top = ajouter(page, "div", "qbd-qz-top");

	/* Même bouton que le retour de la fiche : un seul retour dans tout le
	   dashboard, la flèche dessinée en CSS (masque). */
	const back = ajouter(top, "button", "qbd-quizzes-crumb-back qbd-fiche-back");
	back.type = "button";
	back.setAttribute("aria-label", t("dashboard.quiz.back"));
	ajouter(back, "span", "qbd-quizzes-crumb-icon");
	back.addEventListener("click", () => deps.onBack());

	const head = ajouter(top, "header", "qbd-fiche-head");
	const titres = ajouter(head, "div", "qbd-fiche-titles");
	ajouter(titres, "h2", "qbd-fiche-title", deps.title);
	if (deps.kicker) ajouter(titres, "div", "qbd-fiche-kicker", deps.kicker);
	if (deps.infos) deps.infos(ajouter(titres, "div", "qbd-qz-infos"));

	const actions = ajouter(head, "div", "qbd-fiche-actions qbd-qz-actions");

	// Modifier ↔ Terminé : la MÊME page bascule. Neutre, comme « Modifier »
	// dans la fiche : l'action principale reste « Lancer », à côté.
	const edit = bouton(actions, "qbd-qz-edit", deps.editing ? "check" : "square-pen",
		t(deps.editing ? "dashboard.quiz.editDone" : "dashboard.quiz.editor"));
	poserBouton3dNeutre(edit);
	edit.addEventListener("click", () => deps.onToggleEditing());

	for (const action of deps.actions) {
		const btn = bouton(actions, "qbd-qz-action", action.icon, action.label, action.badge);
		poserBouton3dNeutre(btn);
		btn.addEventListener("click", () => action.onClick(btn));
	}

	const start = deps.start;
	if (start) {
		const btn = bouton(actions, "qbd-qz-start", start.icon, start.label);
		poserBouton3d(btn);
		btn.addEventListener("click", () => start.onClick(btn));
	}
	return top;
}
