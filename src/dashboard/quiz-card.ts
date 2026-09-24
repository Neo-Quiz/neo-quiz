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

	// En-tête : pastille d'état + bouton lecture
	const head = ajouter(body, "div", "qbd-quiz-card-head");
	const pill = ajouter(head, "div", `qbd-quiz-card-status qbd-quiz-card-status--${state}`);
	const sIcon = ajouter(pill, "span", "qbd-quiz-card-status-icon");
	currentHost().ui.setIcon(sIcon, stateIcon);
	ajouter(pill, "span", undefined, stateLabel);
	if (opts?.onPlay) {
		const onPlay = opts.onPlay;
		// Bouton lecture rond — lance le quiz directement, sans passer par la
		// fiche. Pas d'aria-label (Obsidian en ferait une infobulle native
		// flottante, cf. ai.ts) : un `title` traduit suffit, le bouton n'a pas
		// de texte visible pour porter un nom accessible implicite.
		const playBtn = ajouter(head, "button", "qbd-quiz-card-play");
		playBtn.type = "button";
		playBtn.title = t("dashboard.detail.play");
		currentHost().ui.setIcon(playBtn, "circle-play");
		playBtn.addEventListener("click", (e) => {
			// Empêche le clic de remonter à la carte : sinon on lancerait le
			// quiz ET on ouvrirait la fiche (deux actions pour un seul clic).
			e.stopPropagation();
			// Un cours : le Learn d'abord, le Practice une fois le Learn terminé.
			const learnFini = infoQuiz.state === "mastered" || infoQuiz.state === "review";
			onPlay(frere && learnFini ? frere : quiz);
		});
	}

	// Titre
	ajouter(body, "p", "qbd-quiz-card-title", quiz.title);

	// Chemin — omis (pas masqué en CSS) quand l'appelant l'affiche déjà.
	// N'affiche que le DOSSIER PARENT (dernier segment), jamais le chemin
	// complet ni l'extension : le nom de fichier est déjà le titre juste
	// au-dessus, et le préfixe de dossiers commun à toutes les cartes
	// n'apprend rien — seul le dernier dossier identifie « d'où ça sort »
	// (défaut relevé par Ahmed à l'écran, 2026-07-17 : 3 lignes de
	// monospace, préfixe répété sur chaque carte). Racine du vault → aucun
	// dossier parent, donc aucune ligne (pas de texte vide, pas de placeholder).
	if (opts?.showPath !== false) {
		const segs = quiz.path.split("/").slice(0, -1).filter(Boolean);
		const parentFolder = segs.length > 0 ? segs[segs.length - 1] : null;
		if (parentFolder) {
			const pathEl = ajouter(body, "p", "qbd-quiz-card-path");
			ajouter(pathEl, "span", undefined, parentFolder);
		}
	}

	// Aucune barre de progression : la pastille d'état porte déjà le
	// pourcentage (« In progress · 20% »), et la carte du handoff n'en a pas.

	/* Meta : icône du type + nombre de questions, puis l'objectif en badge.
	   Le type n'est plus un badge : deux badges collés se ressemblaient, et la
	   page du quiz l'affiche déjà en toutes lettres (Ahmed, 2026-09-23). Son
	   libellé est une bulle qui paraît au survol (`renderQuizTypeIcon`). */
	const meta = ajouter(body, "div", "qbd-quiz-card-meta");
	if (frere) {
		/* UN COURS : une pastille par mode, avec son nombre de questions ; un
		   clic ouvre la fiche de CE mode (2026-09-24). Le nombre total n'est
		   plus répété à gauche : les deux pastilles le disent déjà. */
		/* Sans l'icône de type : les deux pastilles et le ⋯ doivent tenir sur
		   UNE ligne, et le type se lit sur la fiche. */
		meta.classList.add("qbd-quiz-card-meta--cours");
		for (const q of [quiz, frere]) {
			const pastille = ajouter(meta, "button", "qbd-quiz-card-badge qbd-quiz-card-mode qbd-quiz-card-mode--bouton");
			pastille.type = "button";
			pastille.title = t(q.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: q.questions });
			currentHost().ui.setIcon(ajouter(pastille, "span", "qbd-quiz-card-mode-icon"), q.mode === "learn" ? "book-open" : "dumbbell");
			ajouter(pastille, "span", undefined, `${quizModeLabel(q.mode)} · ${q.questions}`);
			pastille.addEventListener("click", (e) => {
				e.stopPropagation();
				if (typeof onOpen === "function") onOpen(q);
			});
		}
	} else {
		const count = ajouter(meta, "span", "qbd-quiz-card-meta-item");
		renderQuizTypeIcon(count, quiz.quizType);
		ajouter(
			count, "span", undefined,
			t(quiz.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: quiz.questions })
		);
		/* L'OBJECTIF (Learn / Practice) en badge : le titre ne le porte plus
		   (Ahmed, 2026-09-23). Avec son icône, la même que sur la fiche : le
		   livre ouvert pour Learn, l'haltère pour Practice (2026-09-24). */
		const modeBadge = ajouter(meta, "span", "qbd-quiz-card-badge qbd-quiz-card-mode");
		currentHost().ui.setIcon(ajouter(modeBadge, "span", "qbd-quiz-card-mode-icon"), quiz.mode === "learn" ? "book-open" : "dumbbell");
		ajouter(modeBadge, "span", undefined, quizModeLabel(quiz.mode));
	}

	// Bouton ⋯ en bout de ligne meta (position StudySmarter : coin bas droit).
	// stopPropagation : ouvrir le menu ne doit PAS aussi ouvrir la fiche.
	if (opts?.onMenu) {
		const onMenu = opts.onMenu;
		const moreBtn = ajouter(meta, "button", "qbd-card-more");
		moreBtn.type = "button";
		moreBtn.title = t("dashboard.card.more");
		currentHost().ui.setIcon(moreBtn, "ellipsis");
		moreBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			onMenu(quiz, moreBtn);
		});
	}

	// Ouverture (navigation laissée à l'appelant)
	card.addEventListener("click", () => {
		if (typeof onOpen === "function") onOpen(quiz);
	});

	return card;
}
