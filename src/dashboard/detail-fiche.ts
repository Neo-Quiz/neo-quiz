import { currentHost } from "../host/current";
import { placerIndicateur, DUREE_GLISSEMENT } from "./seg-indic";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import { mathifyElement } from "../engine/mathjax";
import { Q_TYPES } from "../editor/utils";
import type { DraftQuestion } from "../editor/utils";
import type { QuestionRole } from "../types/quiz";
import type { ModeQuiz } from "../quiz-format";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { questionText } from "./detail-io";
import { quizModeLabel, renderQuizTypeIcon } from "./quiz-card";
import { setBrandLogo } from "./ai-providers";
import { attachHoverTip } from "./hover-tip";

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

   UN CLIC SUR UNE QUESTION N'OUVRE RIEN. Il ouvrait l'aperçu, l'ancienne
   page à deux colonnes, où l'on croyait pouvoir répondre ; il fait
   maintenant briller « Commencer le quiz », seul endroit où l'on répond
   (Ahmed, 2026-09-23). Le même reflet passe à l'arrivée sur la fiche, puis
   périodiquement.
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
	/** Infobulle : l'identifiant exact du modèle, et l'effort du CLI quand il est connu. */
	tooltip: string;
}

/* L'ENTRÉE de la liste des questions après un changement de mode (2026-09-25) :
   « axe partagé » horizontal, dans le sens du sélecteur — vers Practice (à
   droite), l'ancienne liste part à gauche et la nouvelle arrive de la droite ;
   vers Learn, l'inverse. La page est entièrement redessinée entre les deux :
   le sens est donc posé ici au clic et consommé par le rendu suivant, une
   seule fois. */
let entreeListe: "droite" | "gauche" | null = null;
const DECALAGE_LISTE = 28;

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
	/** L'autre mode du même cours : la pastille du mode devient un sélecteur
	    Learn | Practice, dont l'autre segment ouvre ce quiz. */
	autreMode?: { mode: ModeQuiz; open(): void };
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
	const attirer = renderSide(root, deps);
	renderQuestions(root, attirer, deps);
}

function reduit(): boolean {
	return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Rend la fiche, et la fonction qui attire l'œil sur « Commencer le quiz ». */
function renderSide(root: HTMLElement, deps: FicheDeps): () => void {
	const side = ajouter(root, "aside", "qbd-fiche-side");

	// Même bouton que le retour de l'en-tête : un seul retour dans tout le dashboard.
	const back = ajouter(side, "button", "qbd-quizzes-crumb-back qbd-fiche-back");
	back.type = "button";
	back.setAttribute("aria-label", t("dashboard.quiz.back"));
	// Flèche dessinée en CSS (masque), comme tout bouton retour du dashboard.
	ajouter(back, "span", "qbd-quizzes-crumb-icon");
	back.addEventListener("click", () => deps.onBack());

	// Le DOSSIER du quiz, au-dessus du titre — le seul segment du chemin qui
	// dise d'où il sort (même règle que les cartes). Racine du vault : rien.
	const dossier = deps.quiz.path.split("/").slice(0, -1).filter(Boolean).pop();
	if (dossier) ajouter(side, "div", "qbd-fiche-kicker", dossier);
	ajouter(side, "h2", "qbd-fiche-title", deps.quiz.title);

	const chips = ajouter(side, "div", "qbd-fiche-chips");
	/* Le MODE, avec son icône, et au survol son explication : la bulle du
	   sélecteur Learn | Practice de la page « Générer », mêmes textes. Les
	   icônes ont été choisies parmi cinq chacune, rendues comme ici (Ahmed,
	   2026-09-23) : le livre ouvert pour Learn, l'haltère pour Practice. */
	/* UN COURS AUX DEUX MODES (2026-09-24) : un sélecteur Learn | Practice à la
	   place de la pastille ; le segment de l'autre mode ouvre sa fiche. */
	const pastilleMode = (parent: HTMLElement, m: ModeQuiz, cls: string, tag: "span" | "button"): HTMLElement => {
		const el = ajouter(parent, tag, cls);
		icone(el, m === "learn" ? "book-open" : "dumbbell", "qbd-fiche-mode-icon");
		ajouter(el, "span", undefined, quizModeLabel(m));
		attachHoverTip(el, (tip) => {
			tip.classList.add("qbd-hover-tip--card");
			ajouter(tip, "div", "qbd-hover-tip-title", m === "learn" ? t("ai.mode.learn") : t("ai.mode.practice"));
			ajouter(tip, "div", "qbd-hover-tip-body", m === "learn" ? t("ai.mode.learnTip") : t("ai.mode.practiceTip"));
		});
		return el;
	};
	const autre = deps.autreMode;
	if (autre && autre.mode !== deps.quiz.mode) {
		const choix = ajouter(chips, "div", "qbd-fiche-modes");
		choix.setAttribute("role", "group");
		/* Le bloc qui glisse, comme dans la page « Générer » (2026-09-25) : au
		   clic, il glisse vers l'autre mode, PUIS sa fiche s'ouvre — ouvrir
		   tout de suite repeindrait la page avant qu'on ait vu le mouvement. */
		const indic = ajouter(choix, "div", "qbd-fiche-mode-indic");
		const segs = (["learn", "practice"] as const).map(m => {
			const actif = m === deps.quiz.mode;
			const seg = pastilleMode(choix, m, "qbd-fiche-mode-seg" + (actif ? " is-active" : ""), "button");
			(seg as HTMLButtonElement).type = "button";
			seg.setAttribute("aria-pressed", actif ? "true" : "false");
			return { actif, seg };
		});
		const courant = segs.find(s => s.actif)!.seg;
		requestAnimationFrame(() => placerIndicateur(indic, courant, false));
		for (const { actif, seg } of segs) {
			if (actif) continue;
			let parti = false;
			seg.addEventListener("click", () => {
				if (parti) return;
				parti = true;
				courant.classList.remove("is-active");
				seg.classList.add("is-active");
				placerIndicateur(indic, seg, true);
				const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
				if (!reduit) {
					const versPractice = autre.mode === "practice";
					entreeListe = versPractice ? "droite" : "gauche";
					// L'ancienne liste s'efface en glissant, pendant le bloc du sélecteur.
					choix.closest(".qbd-fiche")?.querySelector(".qbd-fiche-list")?.animate(
						[{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: `translateX(${versPractice ? -DECALAGE_LISTE : DECALAGE_LISTE}px)` }],
						{ duration: DUREE_GLISSEMENT, easing: "cubic-bezier(.32, .72, 0, 1)", fill: "forwards" },
					);
				}
				window.setTimeout(() => autre.open(), reduit ? 0 : DUREE_GLISSEMENT);
			});
		}
	} else {
		pastilleMode(chips, deps.quiz.mode, "qbd-fiche-chip is-accent qbd-fiche-mode", "span");
	}
	const count = ajouter(chips, "span", "qbd-fiche-chip");
	renderQuizTypeIcon(count, deps.quiz.quizType);
	ajouter(count, "span", undefined, t(deps.quiz.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: deps.quiz.questions }));

	/* D'où vient le quiz : le logo et le modèle, puis la date SOUS le modèle,
	   alignée sur son nom — ni « Généré par », que le logo dit déjà (l'infobulle
	   le dit en toutes lettres), ni séparateur entre les deux (Ahmed,
	   2026-09-23). Chacune tient sur sa ligne. */
	if (deps.origine) {
		const o = deps.origine;
		const bloc = ajouter(side, "div", "qbd-fiche-origin");
		bloc.title = o.tooltip;
		const logo = ajouter(bloc, "span", "qbd-provider-logo qbd-fiche-origin-logo qbd-provider-logo--" + o.logo);
		setBrandLogo(logo, o.logo);
		ajouter(bloc, "span", "qbd-fiche-origin-model", o.source);
		ajouter(bloc, "span", "qbd-fiche-origin-date", o.date);
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
	/* Le REFLET qui défile : une animation CSS infinie, qui passe dès
	   l'arrivée puis à chaque cycle (dashboard-fiche.css). Un élément à part,
	   pas un ::after, pour que `attirer` puisse relancer son cycle. */
	const reflet = ajouter(start, "span", "qbd-fiche-start-shine");
	reflet.setAttribute("aria-hidden", "true");
	start.addEventListener("click", () => deps.onStart(start));

	const edit = ajouter(side, "button", "qbd-btn qbd-btn--ghost qbd-qz-edit-btn qbd-fiche-edit");
	edit.type = "button";
	icone(edit, "square-pen", "qbd-btn-icon");
	ajouter(edit, "span", undefined, t("dashboard.quiz.editor"));
	edit.addEventListener("click", () => deps.onEdit());

	/* Relance le reflet sur-le-champ (remis au début de son cycle). Le bouton
	   ne grossit plus au clic (Ahmed, 2026-09-23) : le reflet seul. Rien sans
	   animations. */
	return () => {
		if (reduit()) return;
		for (const a of reflet.getAnimations()) a.currentTime = 0;
	};
}

/* Le RÔLE d'une question de Learn, quand il en change la nature : une
   lecture étiquetée « Choix unique » mentait sur ce qu'elle est. `test`
   (la vérification de fin de partie) est une question ordinaire : son type
   suffit. */
const ROLE_KEYS: Partial<Record<QuestionRole, TransKey>> = {
	pre: "engine.lesson.rolePre",
	read: "engine.lesson.roleRead",
	explain: "engine.lesson.roleExplain",
	recall: "engine.lesson.roleRecall",
};

/* Au-delà, une option ne tient plus dans une bulle à côté des autres : la
   liste passe en colonne. Compté sur le texte BRUT, LaTeX compris. */
const OPTION_COURTE = 32;

/** L'en-tête d'une carte : l'icône et le nom du type, puis le rôle d'un Learn. */
function renderTop(card: HTMLElement, q: DraftQuestion): void {
	const top = ajouter(card, "div", "qbd-fiche-q-top");
	const roleKey = q.role ? ROLE_KEYS[q.role] : undefined;
	// Une lecture n'attend pas de réponse, une explication est toujours libre :
	// leur type n'apprendrait rien.
	if (q.role === "read") icone(top, "book-open", "qbd-fiche-q-icon");
	if (q.role !== "read" && q.role !== "explain") {
		const def = Q_TYPES.find(d => d.key === q._type);
		if (def) icone(top, def.lucide, "qbd-fiche-q-icon");
		ajouter(top, "span", undefined, def?.label ?? q._type);
	}
	if (roleKey) ajouter(top, "span", "qbd-fiche-q-role", t(roleKey));
}

/* B · PARCOURS (retenu le 2026-09-23) : un rail vertical à gauche de la
   liste, le numéro de chaque question en pastille SUR le rail. Le bleu ne
   marque que les repères, jamais le texte à lire. La liste défile dans SON
   cadre : la fiche de gauche ne bouge pas.

   PAS DE PARTIES. Un Learn en enchaîne plusieurs (pré-questions, lecture,
   explication, rappel), mais rien ne les montre, ni ici ni au lecteur : des
   titres « Partie 1 » à « Partie 7 » sur 54 questions effrayaient (Ahmed,
   2026-09-23). Un cours trop long se coupe désormais en plusieurs quiz. */
function renderQuestions(root: HTMLElement, attirer: () => void, deps: FicheDeps): void {
	const main = ajouter(root, "div", "qbd-fiche-main");
	const scroller = ajouter(main, "div", "qbd-fiche-scroll");
	const items = ajouter(scroller, "div", "qbd-fiche-list");
	if (entreeListe) {
		const depuis = entreeListe === "droite" ? DECALAGE_LISTE : -DECALAGE_LISTE;
		entreeListe = null;
		items.animate(
			[{ opacity: 0, transform: `translateX(${depuis}px)` }, { opacity: 1, transform: "translateX(0)" }],
			{ duration: 260, easing: "cubic-bezier(.32, .72, 0, 1)" },
		);
	}
	deps.questions.forEach((q, i) => {
		const item = ajouter(items, "div", "qbd-fiche-item");
		ajouter(item, "span", "qbd-fiche-node", String(i + 1));
		// Pas un bouton : cliquer ici n'ouvre rien, on répond en jouant le quiz.
		const card = ajouter(item, "div", "qbd-fiche-q");
		renderTop(card, q);
		texte(card, "p", "qbd-fiche-q-text", questionText(q) || t("dashboard.quiz.promptEmpty"));
		/* Les options d'un QCM, SANS la bonne, marquées A, B, C… : des ronds
		   de bouton radio donnaient envie de cocher, et rien ne se coche ici.
		   Toutes courtes : des bulles côte à côte ; sinon une colonne. */
		if ((q._type === "single" || q._type === "multi") && q.role !== "read" && q.options?.length) {
			const courtes = q.options.every(o => o.length <= OPTION_COURTE);
			const opts = ajouter(card, "div", courtes ? "qbd-fiche-opts is-pills" : "qbd-fiche-opts");
			q.options.forEach((o, j) => {
				const line = ajouter(opts, "span", "qbd-fiche-opt");
				ajouter(line, "span", "qbd-fiche-opt-letter", String.fromCharCode(65 + j));
				texte(line, "span", "qbd-fiche-opt-text", o);
			});
		}
		card.addEventListener("click", attirer);
	});
}
