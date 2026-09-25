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
	matching: "dashboard.quizType.matching",
	flashcard: "dashboard.quizType.flashcard"
};

/* Icône Lucide du type, sur la carte (le libellé passe au survol). */
const QUIZ_TYPE_ICONS: Record<QuizTypeTag, string> = {
	mixed: "shapes",
	single: "circle-dot",
	multiple: "list-checks",
	text: "text-cursor-input",
	ordering: "list-ordered",
	matching: "cable",
	flashcard: "layers"
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
	// `state` choisit la couleur de l'anneau, `pct` ce qu'il affiche.
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
	const body = ajouter(card, "div", "qbd-quiz-card-body");

	/* ANATOMIE DU 2026-09-25 (maquette « anneau de progression », variante 2) :
	   en haut, le titre et le total de questions à gauche, l'ANNEAU à droite ;
	   en bas, une pastille par mode et le « ⋯ ». Plus de pastille d'état
	   (« En cours · 65 % ») : l'anneau le dit, en pourcentage, toujours
	   affiché. Plus de bouton-tuile dans la carte : une tuile dans une tuile
	   se lit comme une parenthèse dans une parenthèse. */
	const haut = ajouter(body, "div", "qbd-quiz-card-top");
	const texte = ajouter(haut, "div", "qbd-quiz-card-text");
	ajouter(texte, "p", "qbd-quiz-card-title", quiz.title);
	const totalQuestions = quiz.questions + (frere ? frere.questions : 0);
	ajouter(texte, "p", "qbd-quiz-card-count",
		t(totalQuestions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: totalQuestions }));

	// Chemin — omis (pas masqué en CSS) quand l'appelant l'affiche déjà : dans
	// la grille d'un dossier, le dossier EST le titre de la page (2026-09-24).
	// N'affiche que le DOSSIER PARENT (dernier segment), jamais le chemin
	// complet ni l'extension (Ahmed, 2026-07-17). Racine du vault → aucun
	// dossier parent, donc aucune ligne.
	if (opts?.showPath !== false) {
		const segs = quiz.path.split("/").slice(0, -1).filter(Boolean);
		const parentFolder = segs.length > 0 ? segs[segs.length - 1] : null;
		if (parentFolder) {
			const pathEl = ajouter(texte, "p", "qbd-quiz-card-path");
			ajouter(pathEl, "span", undefined, parentFolder);
		}
	}

	/* La couleur dit l'ÉTAT, pas le dossier : bleu en cours, vert maîtrisé,
	   rien tant que rien n'est commencé. « À revoir » reste bleu : fini, mais
	   pas acquis. */
	renderProgressRing(haut, pct, state === "mastered" ? "done" : pct > 0 ? "progress" : "fresh");

	/* LES MODES : une pastille par mode, même couleur pour tous, pourcentage
	   TOUJOURS affiché (0 % comme 100 %), jamais de coche. Un clic lance le
	   mode ; au survol, le nombre de questions du mode. Le « ⋯ » ferme la
	   ligne, en bas à droite. */
	const bas = ajouter(body, "div", "qbd-quiz-card-modes");
	const modes = frere ? [quiz, frere].sort((x, y) => (x.mode === "learn" ? 0 : 1) - (y.mode === "learn" ? 0 : 1)) : [quiz];
	for (const q of modes) {
		const info = q === quiz ? infoQuiz : infoFrere!;
		const wrap = ajouter(bas, "span", "qbd-quiz-card-type qbd-quiz-card-mode");
		const btn = ajouter(wrap, "button", "qbd-quiz-card-mode-btn");
		btn.type = "button";
		currentHost().ui.setIcon(ajouter(btn, "span", "qbd-quiz-card-mode-icon"), q.mode === "learn" ? "book-open" : "dumbbell");
		ajouter(btn, "span", undefined, quizModeLabel(q.mode));
		ajouter(btn, "span", "qbd-quiz-card-mode-pct", `${info.pct}%`);
		ajouter(wrap, "span", "qbd-quiz-card-type-tip",
			t(q.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: q.questions }));
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			if (opts?.onPlay) opts.onPlay(q);
			else if (typeof onOpen === "function") onOpen(q);
		});
	}
	// stopPropagation : ouvrir le menu ne doit PAS aussi ouvrir la fiche.
	if (opts?.onMenu) {
		const onMenu = opts.onMenu;
		const moreBtn = ajouter(bas, "button", "qbd-card-more");
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

const SVG_NS = "http://www.w3.org/2000/svg";

/** L'anneau de progression d'une carte : un tour de piste, un arc de la
    couleur de l'état, et le pourcentage au centre, TOUJOURS affiché (0 % est
    une information). SVG plutôt qu'un dégradé conique : trait net, bouts
    arrondis. Partagé avec le panneau « Progrès » (quizzes-render.ts). */
export function renderProgressRing(parent: HTMLElement, pct: number, tone: "fresh" | "progress" | "done", size = 60, stroke = 5): HTMLElement {
	const ring = ajouter(parent, "div", `qbd-ring qbd-ring--${tone}`);
	ring.style.width = ring.style.height = `${size}px`;
	ring.setAttribute("role", "img");
	ring.setAttribute("aria-label", `${pct}%`);
	const r = (size - stroke) / 2, c = 2 * Math.PI * r, mid = size / 2;
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("qbd-ring-svg");
	const cercle = (cls: string): SVGCircleElement => {
		const el = document.createElementNS(SVG_NS, "circle");
		el.setAttribute("class", cls);
		el.setAttribute("cx", String(mid));
		el.setAttribute("cy", String(mid));
		el.setAttribute("r", String(r));
		el.setAttribute("fill", "none");
		el.setAttribute("stroke-width", String(stroke));
		svg.appendChild(el);
		return el;
	};
	cercle("qbd-ring-track");
	const borne = Math.max(0, Math.min(100, pct));
	if (borne > 0) {
		const arc = cercle("qbd-ring-arc");
		arc.setAttribute("stroke-linecap", "round");
		arc.setAttribute("stroke-dasharray", `${(borne / 100) * c} ${c}`);
	}
	ring.appendChild(svg);
	const centre = ajouter(ring, "span", "qbd-ring-pct", String(Math.round(pct)));
	ajouter(centre, "span", "qbd-ring-sign", "%");
	return ring;
}
