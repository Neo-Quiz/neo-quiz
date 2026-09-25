import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { QuizIndexEntry, QuizTypeTag } from "./scanner";
import type { ModeQuiz } from "../quiz-format";
import type { QuizStatRecord } from "./stats-store";
import { computeQuizState } from "./quiz-mastery";

/* Tag de type de quiz (calculé au scan) → clé de traduction, résolue au rendu.
   Table explicite plutôt qu'une clé construite par concaténation : `t()` n'accepte
   qu'une TransKey littérale, donc un tag orphelin est une erreur de compilation. */
const QUIZ_TYPE_KEYS: Record<QuizTypeTag, TransKey> = {
	mixed: "dashboard.quizType.mixed",
	single: "dashboard.quizType.single",
	multiple: "dashboard.quizType.multiple",
	text: "dashboard.quizType.text",
	ordering: "dashboard.quizType.ordering",
	matching: "dashboard.quizType.matching"
};

/* Icône Lucide du type, sur la carte (le libellé passe au survol). */
const QUIZ_TYPE_ICONS: Record<QuizTypeTag, string> = {
	mixed: "shapes",
	single: "circle-dot",
	multiple: "list-checks",
	text: "text-cursor-input",
	ordering: "list-ordered",
	matching: "cable"
};

/** L'icône du type avec sa bulle au survol (la carte, et la fiche du quiz) :
    l'icône grossit, la bulle donne le type. Pas de `title`, dont l'infobulle
    native doublerait la bulle, en retard et hors thème. */
export function renderQuizTypeIcon(parent: HTMLElement, tag: QuizTypeTag): HTMLElement {
	const wrap = ajouter(parent, "span", "qbd-quiz-card-type");
	const icon = ajouter(wrap, "span", "qbd-quiz-card-type-icon");
	currentHost().ui.setIcon(icon, QUIZ_TYPE_ICONS[tag]);
	ajouter(wrap, "span", "qbd-quiz-card-type-tip", quizTypeLabel(tag));
	return wrap;
}

/** Libellé traduit du type d'un quiz (partagé par la carte et la vue Détail). */
export function quizTypeLabel(tag: QuizTypeTag): string {
	return t(QUIZ_TYPE_KEYS[tag]);
}

/** Libellé de l'objectif d'un quiz (partagé par la carte et la vue Détail). */
export function quizModeLabel(mode: ModeQuiz): string {
	return t(mode === "learn" ? "dashboard.quizMode.learn" : "dashboard.quizMode.practice");
}

/* ══════════════════════════════════════════════════════════
   QUIZ CARD — composant carte partagé (home + quizzes)
   État lisible (pastille couleur + icône), accent coloré par état,
   progression affichée seulement en cours.
   `onOpen(quiz)` est appelé au clic sur la carte (navigation laissée
   à l'appelant). En haut à droite : chevron `chevron-right` ornemental
   par défaut (comportement historique) ; SI `opts.onPlay` est fourni,
   un bouton lecture rond le remplace et lance le quiz directement au
   clic (stoppe la propagation — ne doit PAS aussi déclencher `onOpen`).
   Opt-in par appelant (périmètre Ahmed 2026-07-17 : seul « Mes quiz »
   passe `onPlay` ; l'accueil garde le chevron pour l'instant) — même
   patron que `showPath` juste en dessous. */

export function renderQuizCard(
	container: HTMLElement,
	quiz: QuizIndexEntry,
	stats: QuizStatRecord | null | undefined,
	onOpen?: (quiz: QuizIndexEntry) => void,
	/* showPath (défaut true) : sous-titre dossier parent affiché sur TOUTE
	   carte, y compris quand l'appelant affiche déjà le dossier au-dessus
	   (arbre de « Mes quiz ») — répétition assumée, comme StudySmarter
	   (référence Ahmed, 2026-07-17). Option conservée pour un appelant futur
	   qui voudrait la masquer, mais aucun ne le fait plus aujourd'hui.
	   onPlay : callback de lancement direct, construite par l'appelant à
	   partir de SON `ctx.app` (renderQuizCard n'a pas accès à `app` — même
	   patron que `onOpen`, pas de nouveau paramètre positionnel). */
	/* onMenu (opt-in, même patron que onPlay) : la carte ne compose plus le
	   menu et ne l'ouvre plus — elle signale un clic sur « ⋯ » et rend son
	   ancre. L'ouverture appartient à l'hôte (ctx.openCardMenu) : c'est ce
	   qui évite à ce fichier d'importer `ui-select.ts`, donc Obsidian, donc
	   de rendre TOUTE la carte (et tout ce qui la consomme — home.ts,
	   quizzes-render.ts) inutilisable dans la fenêtre de l'application —
	   l'import était inconditionnel là où le menu, lui, était déjà optionnel
	   (tour de correction 1, tâche 6). Non fourni = pas de bouton ⋯. */
	/* accent : couleur du DOSSIER PARENT. `entryIndex` pilote la cascade
	   d'entrée (la vue qui l'anime pose `.qbd-quizzes-enter`). */
	opts?: {
		showPath?: boolean;
		onPlay?: (quiz: QuizIndexEntry) => void;
		onMenu?: (quiz: QuizIndexEntry, anchor: HTMLElement) => void;
		accent?: string;
		entryIndex?: number;
		/** Le quiz de l'AUTRE mode du même cours (`regrouperParCours`) : la
		    carte devient celle du cours, avec une pastille par mode. */
		frere?: QuizIndexEntry;
		statsFrere?: QuizStatRecord | null;
	}
): HTMLDivElement {
	/* Anatomie UNIQUE depuis le contrat visuel du 2026-07-28 : l'accueil et
	   « Mes quiz » rendent la même carte (handoff 7a). `--folder` reste le nom
	   du hook CSS — historique, il désignait la variante du dossier ouvert
	   quand l'accueil en avait une autre ; renommer toucherait ~40 règles pour
	   zéro pixel de différence. */
	const card = ajouter(container, "div", "qbd-quiz-card qbd-quiz-card--folder");
	card.dataset.path = quiz.path;
	if (opts?.accent) { card.style.setProperty("--accent", opts.accent); card.classList.add("qbd-quiz-card--tinted"); }
	card.style.setProperty("--qbd-card-delay", `${100 + (opts?.entryIndex ?? 0) * 45}ms`);

	// ── État du quiz (calcul partagé quiz-mastery.ts) ──
	// `state` reste un identifiant (suffixe de classe CSS) ; seul `stateLabel`
	// est traduit — et il l'est ici, à chaque rendu de carte.
	/* Un cours réuni résume ses deux modes : maîtrisé si les deux le sont, à
	   revoir si l'un l'est, en cours dès que l'un a commencé (pourcentage
	   moyen), neuf sinon. */
	const frere = opts?.frere;
	const infoQuiz = computeQuizState(quiz, stats);
	const infoFrere = frere ? computeQuizState(frere, opts?.statsFrere) : null;
	const { state, pct } = !infoFrere ? infoQuiz
		: infoQuiz.state === "mastered" && infoFrere.state === "mastered" ? { state: "mastered" as const, pct: 100 }
		: infoQuiz.state === "review" || infoFrere.state === "review" ? { state: "review" as const, pct: 100 }
		: infoQuiz.state === "fresh" && infoFrere.state === "fresh" ? { state: "fresh" as const, pct: 0 }
		: { state: "progress" as const, pct: Math.round((infoQuiz.pct + infoFrere.pct) / 2) };
	const best = stats ? stats.bestScore : 0;
	let stateLabel: string, stateIcon: string;
	switch (state) {
		case "mastered": stateLabel = t("dashboard.card.mastered"); stateIcon = "circle-check"; break;
		case "review": stateLabel = t("dashboard.card.review"); stateIcon = "rotate-ccw"; break;
		case "progress": stateLabel = t("dashboard.card.progress", { pct }); stateIcon = "rotate-cw"; break;
		default: stateLabel = t("dashboard.card.fresh"); stateIcon = "circle-play";
	}

	const body = ajouter(card, "div", "qbd-quiz-card-body");

	// En-tête : pastille d'état, et le menu ⋯ à droite (il y était le ▶).
	const head = ajouter(body, "div", "qbd-quiz-card-head");
	const pill = ajouter(head, "div", `qbd-quiz-card-status qbd-quiz-card-status--${state}`);
	const sIcon = ajouter(pill, "span", "qbd-quiz-card-status-icon");
	currentHost().ui.setIcon(sIcon, stateIcon);
	ajouter(pill, "span", undefined, stateLabel);
	// stopPropagation : ouvrir le menu ne doit PAS aussi ouvrir la fiche.
	if (opts?.onMenu) {
		const onMenu = opts.onMenu;
		const moreBtn = ajouter(head, "button", "qbd-card-more");
		moreBtn.type = "button";
		moreBtn.title = t("dashboard.card.more");
		currentHost().ui.setIcon(moreBtn, "ellipsis");
		moreBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			onMenu(quiz, moreBtn);
		});
	}

	// Titre
	ajouter(body, "p", "qbd-quiz-card-title", quiz.title);

	// Chemin — omis (pas masqué en CSS) quand l'appelant l'affiche déjà : dans
	// la grille d'un dossier, le dossier EST le titre de la page (2026-09-24).
	// N'affiche que le DOSSIER PARENT (dernier segment), jamais le chemin
	// complet ni l'extension (Ahmed, 2026-07-17). Racine du vault → aucun
	// dossier parent, donc aucune ligne.
	if (opts?.showPath !== false) {
		const segs = quiz.path.split("/").slice(0, -1).filter(Boolean);
		const parentFolder = segs.length > 0 ? segs[segs.length - 1] : null;
		if (parentFolder) {
			const pathEl = ajouter(body, "p", "qbd-quiz-card-path");
			ajouter(pathEl, "span", undefined, parentFolder);
		}
	}

	/* L'ACTION (2026-09-25) : UN bouton plein, la PROCHAINE étape — le Learn
	   tant qu'il n'est pas fini, le Practice ensuite — et, dans un cours, un
	   lien discret vers l'autre mode. Remplace les deux boutons numérotés
	   « 1 Learn / 2 Practice » de la veille : deux boutons de même poids se
	   lisaient comme un choix, pas comme une suite. Relevé sur Quizlet, Khan
	   Academy, Brilliant et StudySmarter (rapport « Modes d'étude sur une
	   carte 2026 ») : aucun ne met deux modes côte à côte sur une carte de
	   liste, tous poussent l'étape suivante. Le reste de la carte ouvre la
	   fiche ; une carte d'un seul mode a le même bouton, sans lien. */
	const lancer = (q: QuizIndexEntry) => {
		if (opts?.onPlay) opts.onPlay(q);
		else if (typeof onOpen === "function") onOpen(q);
	};
	const estFini = (s: string) => s === "mastered" || s === "review";
	const learnQ = frere ? (quiz.mode === "learn" ? quiz : frere) : null;
	const learnFini = !!learnQ && estFini((learnQ === quiz ? infoQuiz : infoFrere!).state);
	const principal = !frere ? quiz : learnFini ? (learnQ === quiz ? frere : quiz) : learnQ!;
	const secondaire = frere ? (principal === quiz ? frere : quiz) : null;
	const infoPrincipal = principal === quiz ? infoQuiz : infoFrere!;

	const actions = ajouter(body, "div", "qbd-quiz-card-actions");
	const fini = estFini(infoPrincipal.state);
	const btn = ajouter(actions, "button", "qbd-quiz-card-action" + (fini ? " is-done" : ""));
	btn.type = "button";
	const haut = ajouter(btn, "span", "qbd-quiz-card-action-top");
	currentHost().ui.setIcon(ajouter(haut, "span", "qbd-quiz-card-action-icon"), fini ? "circle-check" : principal.mode === "learn" ? "book-open" : "dumbbell");
	ajouter(haut, "span", "qbd-quiz-card-action-label", t(principal.mode === "learn" ? "dashboard.card.actionLearn" : "dashboard.card.actionPractice"));
	/* Sous le verbe : la progression en cours, sinon le nombre de questions
	   (la pastille d'état dit déjà « maîtrisé » ou « à revoir »). */
	const nombre = t(principal.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: principal.questions });
	ajouter(btn, "span", "qbd-quiz-card-action-sub",
		infoPrincipal.state === "progress" ? t("dashboard.card.progress", { pct: infoPrincipal.pct }) : nombre);
	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		lancer(principal);
	});

	if (secondaire) {
		const lien = ajouter(actions, "button", "qbd-quiz-card-action-alt",
			t(secondaire.mode === "learn" ? "dashboard.card.orLearn" : "dashboard.card.orPractice"));
		lien.type = "button";
		lien.addEventListener("click", (e) => {
			e.stopPropagation();
			lancer(secondaire);
		});
	}

	// Ouverture (navigation laissée à l'appelant)
	card.addEventListener("click", () => {
		if (typeof onOpen === "function") onOpen(quiz);
	});

	return card;
}
