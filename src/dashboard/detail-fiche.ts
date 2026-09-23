import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import { mathifyElement } from "../engine/mathjax";
import { Q_TYPES } from "../editor/utils";
import type { DraftQuestion } from "../editor/utils";
import type { QuestionRole } from "../types/quiz";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { questionText } from "./detail-io";
import { quizModeLabel, renderQuizTypeIcon } from "./quiz-card";
import { setBrandLogo } from "./ai-providers";

/* ══════════════════════════════════════════════════════════
   FICHE D'UN QUIZ — ce que la page montre à l'ouverture

   Une fiche fixe à gauche (dossier, titre, objectif, nombre de questions,
   origine, progression, Commencer, Éditeur) et toutes les questions à
   droite, lisibles d'un coup. Retenue le 2026-09-23 parmi quatre interfaces
   essayées dans l'app, sur le modèle de Wayground (ex-Quizizz). Avant elle,
   la page s'ouvrait sur la question 1 rendue comme si l'on pouvait y
   répondre : un nouveau venu ne savait pas quoi faire (« je fais quoi
   mtn ? »).

   AUCUNE RÉPONSE ici : on relit le quiz pour savoir ce qui attend, pas pour
   en apprendre la solution. Seules les options d'un QCM sont montrées, sans
   la bonne ; les autres types n'affichent que leur énoncé.

   PAS DE COUVERTURE. Un bandeau en dégradé portait l'icône du type : les
   quiz générés sont presque tous « Mixte », il était donc le même sur
   chaque quiz, seul bloc opaque d'une interface en verre, et repoussait
   Commencer de 140 px (retiré le 2026-09-23). Le type vit dans l'icône de
   l'étiquette « N questions », nommé au survol comme sur les cartes. Les
   étiquettes tiennent sur UNE ligne, toujours (demande d'Ahmed).

   La flèche retour et l'éditeur vivent DANS la fiche : l'en-tête de la page
   est masqué sur cet écran (classe `qbd-qz--fiche`).
══════════════════════════════════════════════════════════ */

/** D'où vient le quiz, déjà mis en forme par la page (même rendu que sa
    ligne d'infos). */
export interface FicheOrigine {
	/** Nom lisible de la source : le modèle d'un CLI, le nom d'un site. */
	source: string;
	/** Date et heure de la génération, dans la langue de l'application. */
	date: string;
	/** Logo de l'entrée du fournisseur (`setBrandLogo`). */
	logo: string;
	/** Infobulle : l'effort du CLI quand il est connu. */
	tooltip: string;
}

export interface FicheDeps {
	quiz: QuizIndexEntry;
	questions: DraftQuestion[];
	stat: QuizStatRecord;
	/** Absente pour une note écrite à la main ou un quiz partagé. */
	origine: FicheOrigine | null;
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

	// Le DOSSIER du quiz, au-dessus du titre — le seul segment du chemin qui
	// dise d'où il sort (même règle que les cartes). Racine du vault : rien.
	const dossier = deps.quiz.path.split("/").slice(0, -1).filter(Boolean).pop();
	if (dossier) ajouter(side, "div", "qbd-fiche-kicker", dossier);
	ajouter(side, "h2", "qbd-fiche-title", deps.quiz.title);

	const chips = ajouter(side, "div", "qbd-fiche-chips");
	ajouter(chips, "span", "qbd-fiche-chip is-accent", quizModeLabel(deps.quiz.mode));
	const count = ajouter(chips, "span", "qbd-fiche-chip");
	renderQuizTypeIcon(count, deps.quiz.quizType);
	ajouter(count, "span", undefined, t(deps.quiz.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: deps.quiz.questions }));

	if (deps.origine) {
		const o = deps.origine;
		const line = ajouter(side, "div", "qbd-fiche-origin");
		line.title = o.tooltip;
		const logo = ajouter(line, "span", "qbd-provider-logo qbd-fiche-origin-logo qbd-provider-logo--" + o.logo);
		setBrandLogo(logo, o.logo);
		ajouter(line, "span", undefined, t("dashboard.fiche.generated", { model: o.source, date: o.date }));
	}

	/* La progression, seulement quand elle dit quelque chose : une barre vide
	   sous un quiz jamais commencé n'apprend rien, le bouton suffit. */
	const total = deps.stat.totalQuestions || deps.quiz.questions;
	const done = Math.min(deps.stat.questionsDone, total);
	if (done > 0 || deps.stat.attempts > 0) {
		const progress = ajouter(side, "div", "qbd-fiche-progress");
		const bar = ajouter(progress, "div", "qbd-fiche-bar");
		ajouter(bar, "div", "qbd-fiche-fill").style.width = `${total > 0 ? Math.round(done / total * 100) : 0}%`;
		const legend = ajouter(progress, "div", "qbd-fiche-legend");
		ajouter(legend, "span", undefined, t("dashboard.quiz.welcomeProgress", { done, total }));
		if (deps.stat.attempts > 0) {
			const best = ajouter(legend, "span", "qbd-fiche-best", t("dashboard.detail.metaBest", { score: deps.stat.bestScore }));
			if (deps.stat.bestScore >= 80) best.classList.add("is-good");
			else if (deps.stat.bestScore >= 60) best.classList.add("is-fair");
		}
	}

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

/* Le RÔLE d'une question de Learn, quand il en change la nature : une
   lecture étiquetée « Choix unique » mentait sur ce qu'elle est. `test`
   (la vérification de fin de partie) est une question ordinaire : son type
   suffit. */
const ROLE_KEYS: Partial<Record<QuestionRole, TransKey>> = {
	pre: "engine.lesson.rolePre",
	read: "engine.lesson.roleRead",
	explain: "dashboard.fiche.roleExplain",
	recall: "engine.lesson.roleRecall",
};

function etiquette(q: DraftQuestion): string {
	const type = Q_TYPES.find(d => d.key === q._type)?.label ?? q._type;
	const roleKey = q.role ? ROLE_KEYS[q.role] : undefined;
	if (!roleKey) return type;
	// Une lecture n'attend pas de réponse, une explication est toujours libre :
	// leur type n'apprendrait rien.
	if (q.role === "read" || q.role === "explain") return t(roleKey);
	return `${t(roleKey)} · ${type}`;
}

function renderQuestions(root: HTMLElement, deps: FicheDeps): void {
	const items = ajouter(root, "div", "qbd-fiche-list");
	/* Un Learn avance partie par partie : un titre à chaque nouvelle. Pas un
	   Practice : sa \`slice\` nomme la partie du Learn qui enseigne la question,
	   et ses questions MÉLANGENT les parties exprès — les titres s'y
	   répétaient (« Partie 4 », « Partie 3 », « Partie 4 »). */
	const parParties = deps.quiz.mode === "learn";
	let partie: number | undefined;
	deps.questions.forEach((q, i) => {
		if (parParties && typeof q.slice === "number" && q.slice !== partie) {
			partie = q.slice;
			ajouter(items, "div", "qbd-fiche-part", t("dashboard.fiche.part", { n: q.slice }));
		}
		const card = ajouter(items, "button", "qbd-fiche-q");
		card.type = "button";
		ajouter(card, "span", "qbd-fiche-q-top", `${i + 1} · ${etiquette(q)}`);
		texte(card, "p", "qbd-fiche-q-text", questionText(q) || t("dashboard.quiz.promptEmpty"));
		/* Les options d'un QCM, SANS la bonne, marquées A, B, C… : des ronds
		   de bouton radio donnaient envie de cocher, et rien ne se coche ici. */
		if ((q._type === "single" || q._type === "multi") && q.role !== "read" && q.options?.length) {
			const opts = ajouter(card, "span", "qbd-fiche-opts");
			q.options.forEach((o, j) => {
				const line = ajouter(opts, "span", "qbd-fiche-opt");
				ajouter(line, "span", "qbd-fiche-opt-letter", String.fromCharCode(65 + j));
				texte(line, "span", "qbd-fiche-opt-text", o);
			});
		}
		card.addEventListener("click", () => deps.onOpenQuestion(i));
	});
}
