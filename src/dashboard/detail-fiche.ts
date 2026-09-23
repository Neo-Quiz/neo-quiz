import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import { mathifyElement } from "../engine/mathjax";
import { Q_TYPES } from "../editor/utils";
import type { DraftQuestion } from "../editor/utils";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { questionText } from "./detail-io";
import { quizModeLabel, quizTypeLabel, quizTypeIcon } from "./quiz-card";

/* ══════════════════════════════════════════════════════════
   FICHE D'UN QUIZ — ce que la page montre à l'ouverture

   Une fiche fixe à gauche (couverture, titre, étiquettes, progression,
   Commencer, Éditeur) et toutes les questions à droite, lisibles d'un coup.
   Retenue le 2026-09-23 parmi quatre interfaces essayées dans l'app
   (couverture, choix d'activité, carte « Prêt ? », celle-ci), sur le modèle
   de Wayground (ex-Quizizz). Avant elle, la page s'ouvrait sur la question
   1 rendue comme si l'on pouvait y répondre : un nouveau venu ne savait pas
   quoi faire (« je fais quoi mtn ? »).

   AUCUNE RÉPONSE ici : on relit le quiz pour savoir ce qui attend, pas pour
   en apprendre la solution. Seules les options d'un QCM sont montrées, sans
   la bonne ; les autres types n'affichent que leur énoncé.

   La flèche retour et l'éditeur vivent DANS la fiche : l'en-tête de la page
   est masqué sur cet écran (classe `qbd-qz--fiche`).
══════════════════════════════════════════════════════════ */

export interface FicheDeps {
	quiz: QuizIndexEntry;
	questions: DraftQuestion[];
	stat: QuizStatRecord;
	/** Lance le quiz (le bouton de l'hôte, avec l'écriture en attente). */
	onStart(el: HTMLElement): void;
	/** Passe la page en édition. */
	onEdit(): void;
	/** Quitte la page. */
	onBack(): void;
	/** Ouvre l'aperçu d'une question — l'aperçu habituel de la page. */
	onOpenQuestion(index: number): void;
}

function icone(parent: HTMLElement, name: string, cls = "qbd-fiche-i"): HTMLElement {
	const el = ajouter(parent, "span", cls);
	currentHost().ui.setIcon(el, name);
	return el;
}

/** Texte d'une question, avec son LaTeX rendu. */
function texte(parent: HTMLElement, tag: "p" | "span", cls: string, value: string): HTMLElement {
	const el = ajouter(parent, tag, cls, value);
	if (value.includes("$")) void mathifyElement(el);
	return el;
}

export function renderFiche(parent: HTMLElement, deps: FicheDeps): void {
	const root = ajouter(parent, "div", "qbd-fiche");
	renderSide(root, deps);
	renderQuestions(root, deps);
}

function renderSide(root: HTMLElement, deps: FicheDeps): void {
	const side = ajouter(root, "aside", "qbd-fiche-side");

	// Même bouton que le retour de l'en-tête : un seul retour dans tout le dashboard.
	const back = ajouter(side, "button", "qbd-quizzes-crumb-back qbd-fiche-back");
	back.type = "button";
	back.setAttribute("aria-label", t("dashboard.quiz.back"));
	icone(back, "arrow-left", "qbd-quizzes-crumb-icon");
	back.addEventListener("click", () => deps.onBack());

	const cover = ajouter(side, "div", "qbd-fiche-cover");
	icone(cover, quizTypeIcon(deps.quiz.quizType));
	ajouter(side, "h2", "qbd-fiche-title", deps.quiz.title);

	const chips = ajouter(side, "div", "qbd-fiche-chips");
	ajouter(chips, "span", "qbd-fiche-chip is-accent", quizModeLabel(deps.quiz.mode));
	ajouter(chips, "span", "qbd-fiche-chip", t(deps.quiz.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: deps.quiz.questions }));
	ajouter(chips, "span", "qbd-fiche-chip", quizTypeLabel(deps.quiz.quizType));
	if (deps.quiz.generated) ajouter(chips, "span", "qbd-fiche-chip", deps.quiz.generated.model);

	const total = deps.stat.totalQuestions || deps.quiz.questions;
	const done = Math.min(deps.stat.questionsDone, total);
	const progress = ajouter(side, "div", "qbd-fiche-progress");
	const bar = ajouter(progress, "div", "qbd-fiche-bar");
	ajouter(bar, "div", "qbd-fiche-fill").style.width = `${total > 0 ? Math.round(done / total * 100) : 0}%`;
	ajouter(progress, "span", "qbd-fiche-small", t("dashboard.quiz.welcomeProgress", { done, total }));

	const start = ajouter(side, "button", "qbd-btn--create qbd-fiche-start");
	start.type = "button";
	icone(start, "play", "qbd-btn-icon");
	ajouter(start, "span", undefined, t("dashboard.quiz.welcomeStart"));
	start.addEventListener("click", () => deps.onStart(start));

	const edit = ajouter(side, "button", "qbd-btn qbd-btn--ghost qbd-qz-edit-btn qbd-fiche-edit");
	edit.type = "button";
	icone(edit, "square-pen", "qbd-btn-icon");
	ajouter(edit, "span", undefined, t("dashboard.quiz.editor"));
	edit.addEventListener("click", () => deps.onEdit());
}

function renderQuestions(root: HTMLElement, deps: FicheDeps): void {
	const main = ajouter(root, "div", "qbd-fiche-list");
	ajouter(main, "div", "qbd-fiche-small", t(deps.questions.length === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: deps.questions.length }));
	const items = ajouter(main, "div", "qbd-fiche-items");
	deps.questions.forEach((q, i) => {
		const card = ajouter(items, "button", "qbd-fiche-q");
		card.type = "button";
		const type = Q_TYPES.find(d => d.key === q._type)?.label ?? q._type;
		ajouter(card, "span", "qbd-fiche-q-top", `${i + 1} · ${type}`);
		texte(card, "p", "qbd-fiche-q-text", questionText(q) || t("dashboard.quiz.promptEmpty"));
		// Les options d'un QCM, SANS la bonne : les voir dit à quoi s'attendre.
		if ((q._type === "single" || q._type === "multi") && q.options?.length) {
			const opts = ajouter(card, "span", "qbd-fiche-opts");
			for (const o of q.options) {
				const line = ajouter(opts, "span", "qbd-fiche-opt");
				icone(line, q._type === "multi" ? "square" : "circle");
				texte(line, "span", "", o);
			}
		}
		card.addEventListener("click", () => deps.onOpenQuestion(i));
	});
}
