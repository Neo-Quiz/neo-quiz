import { currentHost, requireHost } from "../host/current";
import { ajouter } from "../dom";
import { t, currentLang } from "../i18n";
import type { TransKey } from "../i18n";
import type { QuizIndexEntry, QuizTypeTag } from "./scanner";
import type { ModeQuiz } from "../quiz-format";
import type { QuizStatRecord } from "./stats-store";
import { computeQuizState } from "./quiz-mastery";
import { parMode } from "./course-pairs";
import { createOptionCard } from "./folder-create";

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

/** The label of a quiz's mode (shared by the card, the page and the app's
    player): Learn / Test / Exam, translated. A Practice reads "Test"
    (2026-09-29, after spec §1.4 which said "Practice"): the product has two
    types of quiz, Learn and Test, and a Test file with `mode: "exam"` (see
    "Keep exam mode") reads "Exam". */
export function quizModeLabel(mode: ModeQuiz): string {
	return t(mode === "learn" ? "dashboard.quizMode.learn" : mode === "exam" ? "dashboard.quizMode.exam" : "dashboard.quizMode.test");
}

/** The one-sentence goal of a mode (hover bubbles of the Generate page's
    selector and of a course sheet's). */
export function quizModeTip(mode: ModeQuiz): string {
	return t(mode === "learn" ? "ai.mode.learnTip" : mode === "exam" ? "dashboard.quizMode.examTip" : "ai.mode.practiceTip");
}

/** The Lucide icon of a mode: a book to learn, a written sheet for a
    test, a timer for an exam. */
export function quizModeIcon(mode: ModeQuiz): string {
	return mode === "learn" ? "book-open" : mode === "exam" ? "timer" : "file-text";
}


/** When a quiz (or the earliest of a course's quizzes) was created: the
    generation date of the app's `neo-quiz:` frontmatter when the note has one,
    else the file's creation time, else its modification time (a host that
    does not report `ctime`). 0 when nothing is known. */
export function quizCreationTime(quizzes: readonly QuizIndexEntry[]): number {
	const times = quizzes.map(q => {
		const generated = q.generated ? Date.parse(q.generated.generatedAt) : NaN;
		return Number.isFinite(generated) ? generated : (q.ctime || q.mtime || 0);
	}).filter(n => n > 0);
	return times.length > 0 ? Math.min(...times) : 0;
}

/** Short localized date: "Oct 8" / "8 oct.", with the year only when it is
    not the current one. */
export function formatCardDate(ms: number, now: Date = new Date()): string {
	const d = new Date(ms);
	return d.toLocaleDateString(currentLang(), {
		day: "numeric", month: "short",
		...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
	});
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
		/** L'anneau d'avancement (défaut true). Faux dans un dossier : son
		    onglet « Progression » donne déjà chaque cours mode par mode
		    (2026-09-26) ; l'accueil, qui n'a pas cet onglet, le garde. */
		showRing?: boolean;
		/** Creation date, right-aligned on the count line (folder pages). */
		showDate?: boolean;
		onPlay?: (quiz: QuizIndexEntry) => void;
		onMenu?: (quiz: QuizIndexEntry, anchor: HTMLElement) => void;
		accent?: string;
		entryIndex?: number;
		/** The quizzes of the OTHER modes of the same course
		    (`regrouperParCours`): the card becomes the course's, with one pill
		    per mode; `statsFreres` in the same order. */
		freres?: QuizIndexEntry[];
		statsFreres?: Array<QuizStatRecord | null | undefined>;
		/** The live session of a quiz (`DashboardShellCtx.sessionOf`): a quiz
		    under way counts in the ring before its stats are written. */
		sessionOf?: (path: string) => { answered: number; total: number } | null;
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
	/* A course brought together sums up its modes: mastered when all are, to
	   review when one is, in progress as soon as one has started (average
	   percentage), fresh otherwise. */
	const freres = opts?.freres ?? [];
	const session = (p: string) => opts?.sessionOf?.(p) ?? null;
	const infos = [computeQuizState(quiz, stats, session(quiz.path)), ...freres.map((f, i) => computeQuizState(f, opts?.statsFreres?.[i], session(f.path)))];
	const { state, pct } = infos.length === 1 ? infos[0]
		: infos.every(x => x.state === "mastered") ? { state: "mastered" as const, pct: 100 }
		: infos.some(x => x.state === "review") ? { state: "review" as const, pct: 100 }
		: infos.every(x => x.state === "fresh") ? { state: "fresh" as const, pct: 0 }
		: { state: "progress" as const, pct: Math.round(infos.reduce((n, x) => n + x.pct, 0) / infos.length) };
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
	const totalQuestions = quiz.questions + freres.reduce((n, f) => n + f.questions, 0);
	const totalReadings = quiz.readings + freres.reduce((n, f) => n + f.readings, 0);
	const compte = ajouter(texte, "p", "qbd-quiz-card-count");
	ajouter(compte, "span", undefined,
		t(totalQuestions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: totalQuestions }));
	/* Le nombre de LECTURES, jamais à 0 : même « · » que la ligne d'origine de
	   la fiche (`.qbd-fiche-meta .qbd-fiche-origin-date::before`), posé ici par
	   la même classe partagée (`qbd-count-sep`) plutôt que réécrit. */
	if (totalReadings > 0) {
		ajouter(compte, "span", "qbd-count-sep");
		ajouter(compte, "span", undefined,
			t(totalReadings === 1 ? "dashboard.common.readingsOne" : "dashboard.common.readingsOther", { count: totalReadings }));
	}

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
	if (opts?.showRing !== false) renderProgressRing(haut, pct, state === "mastered" ? "done" : pct > 0 ? "progress" : "fresh");

	/* PLAY (2026-09-29): starts the course straight from its card — its only
	   mode at once, or a choice of mode when the card gathers several. A
	   ghost icon of the "⋯" family, never a framed button: no tile in a
	   tile. */
	if (opts?.onPlay) {
		const onPlay = opts.onPlay;
		const play = ajouter(haut, "button", "qbd-quiz-card-play");
		play.type = "button";
		play.setAttribute("aria-label", t("dashboard.card.play"));
		play.title = t("dashboard.card.play");
		currentHost().ui.setIcon(play, "play");
		play.addEventListener("click", (e) => {
			e.stopPropagation();
			const modes = [quiz, ...freres].sort(parMode);
			if (modes.length === 1) onPlay(modes[0]);
			else openModePicker(modes, onPlay);
		});
	}

	/* LES MODES : une pastille par mode, même couleur pour tous, jamais de
	   coche. Plus de pourcentage (2026-09-25) : l'anneau reste le seul chiffre
	   de la carte, et le détail par mode vit dans l'onglet « Progression » du
	   dossier. Un clic lance le mode ; au survol, le nombre de questions du
	   mode. Le « ⋯ » ferme la ligne, en bas à droite. */
	const bas = ajouter(body, "div", "qbd-quiz-card-modes");
	const modes = [quiz, ...freres].sort(parMode);
	for (const q of modes) {
		const wrap = ajouter(bas, "span", `qbd-quiz-card-type qbd-quiz-card-mode qbd-quiz-card-mode--${q.mode}`);
		const btn = ajouter(wrap, "button", "qbd-quiz-card-mode-btn");
		btn.type = "button";
		currentHost().ui.setIcon(ajouter(btn, "span", "qbd-quiz-card-mode-icon"), quizModeIcon(q.mode));
		ajouter(btn, "span", undefined, quizModeLabel(q.mode));
		ajouter(wrap, "span", "qbd-quiz-card-type-tip",
			t(q.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: q.questions }));
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			if (opts?.onPlay) opts.onPlay(q);
			else if (typeof onOpen === "function") onOpen(q);
		});
	}
	/* Creation date (folder pages): right of the type pills, left of the "⋯",
	   small and faint (2026-10-09). The count line keeps only the counts. */
	if (opts?.showDate) {
		const created = quizCreationTime([quiz, ...freres]);
		if (created > 0) ajouter(bas, "span", "qbd-quiz-card-date", formatCardDate(created));
	}
	// stopPropagation: opening the menu must NOT also open the quiz.
	if (opts?.onMenu) {
		const onMenu = opts.onMenu;
		const moreBtn = ajouter(bas, "button", "qbd-card-more");
		moreBtn.type = "button";
		moreBtn.setAttribute("aria-label", t("dashboard.card.more"));
		currentHost().ui.setIcon(moreBtn, "ellipsis");
		moreBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			onMenu(quiz, moreBtn);
		});
		openMenuOnRightClick(card, () => onMenu(quiz, moreBtn));
	}

	// Ouverture (navigation laissée à l'appelant)
	card.addEventListener("click", () => {
		if (typeof onOpen === "function") onOpen(quiz);
	});
	// Keyboard: same as a click, only when the card itself has focus (its
	// inner buttons keep their own keys).
	card.tabIndex = 0;
	card.setAttribute("role", "button");
	card.setAttribute("aria-label", quiz.title);
	card.addEventListener("keydown", (e) => {
		if (e.target !== card || (e.key !== "Enter" && e.key !== " ")) return;
		e.preventDefault();
		if (typeof onOpen === "function") onOpen(quiz);
	});

	return card;
}

/**
 * A right click on a card opens EXACTLY its "⋯" menu, anchored on the "⋯"
 * button: no system menu, no selection, nothing else (2026-10-09). A touch
 * long press stays the selection gesture (`selection-view.ts`): the
 * `contextmenu` it fires only loses the system menu. The Menu key and
 * Shift+F10 (no pointer) open the card's menu too. Shared with the folder
 * cards (`module-card.ts`).
 */
export function openMenuOnRightClick(card: HTMLElement, open: () => void): void {
	let touch = false;
	card.addEventListener("pointerdown", (e) => { touch = e.pointerType === "touch"; });
	card.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		if (touch) return;
		e.stopPropagation();
		open();
	});
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

/** One colour per mode in the mode picker, like the options of the
    creation modals (`createOptionCard`). */
const MODE_ACCENT: Record<ModeQuiz, string> = { learn: "#a78bfa", practice: "#4573ff", exam: "#f5a524" };

/** "Which mode?" when a course card gathers several modes: the rows of the
    creation modals, one per mode, with its number of questions. */
function openModePicker(modes: QuizIndexEntry[], onPlay: (quiz: QuizIndexEntry) => void): void {
	requireHost("modals").open({
		className: "qbd-create-modal",
		title: t("dashboard.card.pickMode"),
		onOpen: (m) => {
			for (const q of modes) {
				createOptionCard(m, m.contentEl, quizModeIcon(q.mode), MODE_ACCENT[q.mode], quizModeLabel(q.mode),
					t(q.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: q.questions }),
					() => onPlay(q));
			}
		},
	});
}
