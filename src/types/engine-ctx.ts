/**
 * Interface du `ctx` (god-object) du MOTEUR de rendu du quiz (src/engine.js,
 * fonction renderInteractiveQuiz). C'est la plus grande interface du projet :
 * un contexte partagé, assemblé en plusieurs passes, injecté dans les 18
 * factories `engine/*` et consommé par elles (référence croisée).
 *
 * DÉRIVATION (zones de engine.js) :
 *   - :93-125   littéral `ctx` initial + getters/setters d'examen + utilitaires
 *               (shuffleArray, clamp, prédicats isOrdering/isMatching/isText).
 *   - :128-144  instanciation des 18 factories (createSanitizer, …).
 *   - :149-222  1er Object.assign : greffe des 18 sous-modules (ctx.sanitize,
 *               ctx.cards, …) + aplatit ~55 méthodes directement sur ctx.
 *               (plages `engine.js:XXX` de ce bloc : héritées de l'ancien
 *               fichier JS pré-conversion, déjà décalées avant task 3 —
 *               non corrigées ici, hors périmètre de cette tâche.)
 *   - :275-330  ctx.quizState (état runtime), ctx.slideMap, constantes SLIDE_*,
 *               initialiseurs et prédicats de slide.
 *   - :397-429  2e Object.assign : flags primitifs __quiz* (SNAPSHOT par valeur)
 *               + accessors de closure exposés (isDestroyed, currentAsyncEpoch…).
 *   - :464-826  fonctions locales du moteur greffées sur ctx après leur
 *               définition (settleViewportHeightToIndex, destroyQuiz, render…).
 *
 * SNAPSHOT vs ACCESSOR (spec §7) — distinction CRITIQUE :
 *   Les flags primitifs `__quiz*` (ex. __quizDestroyed, __quizAsyncEpoch) sont
 *   COPIÉS PAR VALEUR sur ctx au 2e Object.assign : ce sont des propriétés
 *   figées (le nombre/booléen de l'instant de l'assemblage), PAS l'état vivant.
 *   L'état VIVANT se lit via les accessors de closure (isDestroyed(),
 *   currentAsyncEpoch(), getSlideGeneration()…). Les DEUX sont modélisés :
 *   les flags comme propriétés de leur type, les accessors comme méthodes.
 *   Les getters/setters d'examen (closure, :108-115) sont vus comme de simples
 *   propriétés par les consommateurs — leur nature accessor est transparente.
 *
 * SOUS-MODULES : les 18 slots (sanitize, cards, track, viewport, state…) pointent
 * chacun vers le VRAI handler-type de leur module, importé depuis engine/*.ts
 * (conversion terminée). Les méthodes aplaties issues d'un sous-module sont
 * typées par indexed-access sur ce type réel
 * (ex. `escapeHtmlText: SanitizerHandlers["escapeHtmlText"]`). Les méthodes
 * locales du moteur (render, destroyQuiz…) sont typées fidèlement depuis engine.ts.
 */

import type { Host } from "../host/types";
import type {
	QuizQuestion,
	QuizState,
	QuizResult,
	SlideMapEntry,
	ExamOptions,
	TextOnlyRating,
	QuestionSelection,
	QuestionShuffleEntry,
	OrderingQuestion,
	MatchingQuestion,
	TextQuestion,
	ClozeQuestion,
	FlashcardQuestion,
	QuestionRole,
	StatsRecord,
} from "./quiz";
import type { ReviewGrade } from "../scheduler";
import type { SanitizerHandlers } from "../engine/sanitizer";
import type { QuestionHandlers } from "../engine/questions";
import type { ResourceHandlers } from "../engine/resources";
import type { FocusHandlers } from "../engine/focus";
import type { HintHandlers } from "../engine/hint";
import type { LifecycleHandlers, PendingAsyncWaiter } from "../engine/lifecycle";
import type { ViewportHandlers } from "../engine/viewport";
import type { TrackHandlers } from "../engine/track";
import type { WarmingHandlers } from "../engine/warming";
import type { ZoomHandlers } from "../engine/zoom";
import type { CardHandlers } from "../engine/cards";
import type { ExamHandlers } from "../engine/exam";
import type { TextOnlyHandlers } from "../engine/text-only";
import type { TerminalHandlers } from "../engine/terminal";
import type { InteractionHandlers } from "../engine/interactions";
import type { StateHandlers } from "../engine/state";
import type { ResultsSaverHandlers } from "../engine/results-save";
import type { PassageHandlers } from "../engine/passage";
import type { ClozeHandlers } from "../engine/cloze";
import type { LessonHandlers } from "../engine/lesson";

/**
 * Mode du quiz (engine.js ctx.quizMode / originalQuizMode). Miroir du type
 * `QuizMode` de src/quiz-utils.ts (extractExamOptions) qui n'est PAS exporté —
 * dupliqué ici plutôt que modifier quiz-utils.ts (iso-fonctionnalité Task 9).
 * `"training"` n'est PAS produit par le parsing (quiz-utils) mais assigné au
 * runtime par engine/exam.ts startLearnMode (`ctx.quizMode = "training"`) —
 * ajouté ici en Task 10c pour coller à la réalité de la mutation.
 * "learn" a été renommé "lesson" (task 0 du lot mode leçon, 2026-08-31) :
 * quiz-utils.ts continue de LIRE l'ancien nom, mais ne le renvoie plus jamais.
 */
export type QuizMode = "lesson" | "exam" | "quiz" | "training";

/* ════════════════════════════════════════════════════════
   Les 18 sous-modules ont tous leur VRAI handler-type (Task 10 terminée) :
   importés depuis engine/*.ts, plus aucun placeholder `unknown`-based.
   ════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════
   EngineCtx — le ctx du moteur (assemblé dans engine.js)
   ════════════════════════════════════════════════════════ */

export interface EngineCtx {
	/* ── Données & DOM (littéral initial, engine.js:93-99) ── */
	/**
	 * L'HÔTE. Tout ce que le moteur demandait à Obsidian passe par là :
	 * fichiers, liens, toasts, icônes, mathématiques, ouverture externe.
	 * Assigné à l'assemblage depuis `currentHost()` — une seule installation,
	 * une seule source (src/host/current.ts).
	 */
	host: Host;
	container: HTMLElement;
	sourcePath: string;
	quiz: QuizQuestion[];
	/**
	 * Identité des questions pour l'ordonnanceur. La MÊME règle qu'à l'écriture
	 * (editor/export.ts) et qu'à la lecture par le scanner (dashboard/scanner.ts) :
	 * trois règles séparées divergeraient, et une question changerait de clé
	 * selon qui la regarde. Calculée une fois à l'assemblage du `ctx`
	 * (engine.ts, via `idsForRawItems` de `quiz-ids.ts`) — jamais `ctx.quiz[i].id`
	 * brut, qui n'a ni slug de repli ni dédoublonnage.
	 */
	questionIds: string[];
	/**
	 * Puits du journal de révision. Le moteur ne connaît que cette FORME,
	 * jamais l'implémentation — exactement comme `StatsStoreLike`. C'est ce
	 * qui permettra au moteur de servir tel quel dans les applications PC et
	 * Android, où le journal ne sera pas un fichier du vault.
	 */
	reviewSink?: {
		record(entries: Array<{ q: string; grade: ReviewGrade; role?: QuestionRole }>): void;
		keyOf(path: string, id: string): string;
	};
	/**
	 * Puits des statistiques du tableau de bord. Même principe que
	 * `reviewSink` : le moteur ne connaît que la FORME. Il lisait
	 * `plugin._statsStore`, ce qui le liait au greffon pour une seule
	 * fonction ; l'app n'a pas de `Plugin`.
	 */
	statsSink?: { updateRecord(path: string, update: StatsRecord): unknown };
	/**
	 * Jamais assigné dans le littéral `ctx` ni ailleurs dans engine.js (mort/
	 * vestigial) ; accédé optionnellement par sanitizer.js:172 (`ctx.lucideIcons
	 * ?.paperclip`) avec fallback "⬇" — toujours `undefined` au runtime actuel.
	 */
	lucideIcons?: { paperclip?: string };

	/* ── Mode & examen (littéral initial, engine.js:100-107 ; muté par switchToExamMode :808-813) ── */
	quizMode: QuizMode;
	isExamMode: boolean;
	trainingSession: boolean;
	examOptions: ExamOptions | null;
	examDurationMs: number;
	lessonExamOptions: ExamOptions | null;
	originalQuizMode: QuizMode;
	originalLessonExamOptions: ExamOptions | null;

	/* ── État d'examen : getters/setters de closure (engine.js:108-115),
	     vus comme de simples propriétés par les consommateurs. ── */
	examTimeRemaining: number;
	examStarted: boolean;
	examEnded: boolean;
	examStartTime: number;

	/* ── Identifiants d'instance (engine.js:116-118) ── */
	QUIZ_INSTANCE_ID: string;
	HINT_OVERLAY_ID: string;
	HINT_TITLE_ID: string;

	/** File de nettoyages globaux ; chaque entrée est appelée à la destruction (engine.js:73,119,625-628). */
	__quizGlobalCleanups: Array<() => void>;

	/* ── Utilitaires purs (littéral initial, engine.js:120-124) ── */
	shuffleArray<T>(arr: T[]): T[];
	clamp(n: number, min: number, max: number): number;
	/** Prédicat de variante (engine.js:85), typé en garde de type sur l'union QuizQuestion. */
	isOrderingQuestion(q: QuizQuestion): q is OrderingQuestion;
	/** Prédicat de variante (engine.js:86). */
	isMatchingQuestion(q: QuizQuestion): q is MatchingQuestion;
	/** Prédicat de variante (engine.js:87 ; tolère aussi le legacy `q.text === true`). */
	isTextQuestion(q: QuizQuestion): q is TextQuestion;
	/** Prédicat de variante — présence d'un gabarit `cloze` non vide (engine.ts). */
	isClozeQuestion(q: QuizQuestion): q is ClozeQuestion;
	/** Prédicat de variante — `flashcard: true` (engine.ts). */
	isFlashcardQuestion(q: QuizQuestion): q is FlashcardQuestion;

	/* ── État runtime & carte des slides (engine.js:295-299) ── */
	quizState: QuizState;
	slideMap: SlideMapEntry[];
	SLIDE_SUBMIT_INDEX: number;
	SLIDE_RESULTS_INDEX: number;
	TOTAL_SLIDES: number;

	/* ── Initialiseurs d'état (engine.js:300-306), typés depuis quiz.ts ── */
	initSelections(): QuestionSelection[];
	initTextOnlyAnswers(): string[];
	initTextOnlyChecked(): boolean[];
	initTextOnlyRatings(): Array<TextOnlyRating | null>;
	buildShuffleMap(): QuestionShuffleEntry[];
	initOrderingPicks(): Array<number | null>;
	initMatchPicks(): Array<number | null>;

	/* ── Prédicats & helpers de slide (engine.js:322-330) ── */
	isQuestionSlideIndex(i: number): boolean;
	isSubmitSlideIndex(i: number): boolean;
	isResultsSlideIndex(i: number): boolean;
	clampSlideIndex(i: number): number;
	getSlidingWindow(): { from: number; to: number };
	getSlideIndexForQuestion(qi: number): number;
	invalidateSavedResults(): void;

	/* ════════════════════════════════════════════════
	   Sous-modules (1er Object.assign, engine.ts:149-168)
	   Slots vers les vrais handler-types importés depuis engine/*.ts.
	   ════════════════════════════════════════════════ */
	sanitize: SanitizerHandlers;
	resources: ResourceHandlers;
	exam: ExamHandlers;
	textOnly: TextOnlyHandlers;
	cards: CardHandlers;
	viewport: ViewportHandlers;
	track: TrackHandlers;
	zoom: ZoomHandlers;
	interactions: InteractionHandlers;
	terminal: TerminalHandlers;
	focus: FocusHandlers;
	lifecycle: LifecycleHandlers;
	warming: WarmingHandlers;
	state: StateHandlers;
	hint: HintHandlers;
	questions: QuestionHandlers;
	resultsSaver: ResultsSaverHandlers;
	passage: PassageHandlers;
	cloze: ClozeHandlers;
	lesson: LessonHandlers;

	/* ════════════════════════════════════════════════
	   Méthodes APLATIES issues des sous-modules (1er Object.assign, :156-219).
	   Typées par indexed-access sur le vrai handler-type de leur module.
	   Aucune n'est typée en dur ici : leur signature vit dans leur module
	   source (engine/*.ts), pas dans engine.ts.
	   ════════════════════════════════════════════════ */

	// depuis state (engine.js:156, 200-219) — StateHandlers réel (Task 10c) :
	// toutes ces méthodes aplaties reprennent l'indexed-access sur le vrai type
	// (les 9 signatures honnêtes posées par 10b sont confirmées par state.ts).
	clearNavTabPressState: StateHandlers["clearNavTabPressState"];
	hasAnyAnswer: StateHandlers["hasAnyAnswer"];
	isComplete: StateHandlers["isComplete"];
	getMissingIndices: StateHandlers["getMissingIndices"];
	isCorrect: StateHandlers["isCorrect"];
	computeScorePercent: StateHandlers["computeScorePercent"];
	getSubmitSlideSignature: StateHandlers["getSubmitSlideSignature"];
	getResultsSlideSignature: StateHandlers["getResultsSlideSignature"];
	goToQuestion: StateHandlers["goToQuestion"];
	goToSubmit: StateHandlers["goToSubmit"];
	goToResults: StateHandlers["goToResults"];
	resetQuiz: StateHandlers["resetQuiz"];
	setPracticeMode: StateHandlers["setPracticeMode"];
	goToSlide: StateHandlers["goToSlide"];
	redirectSlide: StateHandlers["redirectSlide"];
	updateNavHighlight: StateHandlers["updateNavHighlight"];
	setSlidingClass: StateHandlers["setSlidingClass"];
	playNavTabPressAndNavigate: StateHandlers["playNavTabPressAndNavigate"];
	clearAllNavTabPressStates: StateHandlers["clearAllNavTabPressStates"];
	setNavTabPressState: StateHandlers["setNavTabPressState"];
	buildNavTabClass: StateHandlers["buildNavTabClass"];
	recordReview: StateHandlers["recordReview"];

	// depuis cards (engine.js:157)
	refreshMetaSlides: CardHandlers["refreshMetaSlides"];

	// depuis sanitize (engine.js:170-171)
	escapeHtmlText: SanitizerHandlers["escapeHtmlText"];
	escapeHtmlAttr: SanitizerHandlers["escapeHtmlAttr"];

	// depuis lifecycle (engine.js:172-180) — LifecycleHandlers réel (Task 10b) :
	// toutes ces méthodes aplaties reprennent l'indexed-access sur le vrai type.
	// createPendingAsyncWaiter retourne un PendingAsyncWaiter complet ({ settled,
	// cleanup, promise, resolve }) — surélargit la signature honnête posée en 10a
	// (qui n'exposait que resolve/promise, sous-ensemble consommé par focus.ts/zoom.ts).
	createPendingAsyncWaiter: LifecycleHandlers["createPendingAsyncWaiter"];
	resolveAllPendingAsync: LifecycleHandlers["resolveAllPendingAsync"];
	sleep: LifecycleHandlers["sleep"];
	nextFrame: LifecycleHandlers["nextFrame"];
	waitFrames: LifecycleHandlers["waitFrames"];
	requestQuizIdle: LifecycleHandlers["requestQuizIdle"];
	restartAsyncLifecycle: LifecycleHandlers["restartAsyncLifecycle"];
	bumpSlideGeneration: LifecycleHandlers["bumpSlideGeneration"];
	bumpAllSlideGenerations: LifecycleHandlers["bumpAllSlideGenerations"];

	// depuis warming (engine.js:181-186)
	warmSlideForAccurateHeight: WarmingHandlers["warmSlideForAccurateHeight"];
	warmSlidesAroundIndex: WarmingHandlers["warmSlidesAroundIndex"];
	startFullBackgroundWarm: WarmingHandlers["startFullBackgroundWarm"];
	bindTrackItemImages: WarmingHandlers["bindTrackItemImages"];
	bindAllTrackImages: WarmingHandlers["bindAllTrackImages"];
	bindCurrentSlideMediaHeightSync: WarmingHandlers["bindCurrentSlideMediaHeightSync"];

	// depuis viewport (engine.js:187)
	getMaxRenderedSlideHeight: ViewportHandlers["getMaxRenderedSlideHeight"];

	// depuis hint (engine.js:188-189)
	openHintModal: HintHandlers["openHintModal"];
	closeHintModal: HintHandlers["closeHintModal"];

	// depuis questions (engine.js:190-199)
	getOrderingItems: QuestionHandlers["getOrderingItems"];
	getOrderingCorrectOrder: QuestionHandlers["getOrderingCorrectOrder"];
	getOrderingSlotLabels: QuestionHandlers["getOrderingSlotLabels"];
	getMatchRows: QuestionHandlers["getMatchRows"];
	getMatchChoices: QuestionHandlers["getMatchChoices"];
	getMatchCorrectMap: QuestionHandlers["getMatchCorrectMap"];
	orderingSelectionIncludes: QuestionHandlers["orderingSelectionIncludes"];
	removeOrderingItemFromSlot: QuestionHandlers["removeOrderingItemFromSlot"];
	placeOrderingItemInSlot: QuestionHandlers["placeOrderingItemInSlot"];
	matchingSelectionIncludes: QuestionHandlers["matchingSelectionIncludes"];

	// depuis exam (engine.js:825-826)
	stopExamTimer: ExamHandlers["stopExamTimer"];
	updateExamTimerDisplay: ExamHandlers["updateExamTimerDisplay"];

	// depuis lesson (1er Object.assign, engine.ts) — accessors, pas des
	// flags : recalculent le modèle à chaque appel (engine/lesson.ts), car
	// ctx.quizMode est mutable (switchToExamMode, resetQuiz).
	isLessonMode: LessonHandlers["isLessonMode"];
	lessonSlices: LessonHandlers["lessonSlices"];
	sliceOfQuestion: LessonHandlers["sliceOfQuestion"];
	roleOfQuestion: LessonHandlers["roleOfQuestion"];

	/* ════════════════════════════════════════════════
	   ACCESSORS de closure (2e Object.assign, engine.js:424-428) — état VIVANT.
	   À NE PAS confondre avec les flags snapshot ci-dessous.
	   ════════════════════════════════════════════════ */
	/** Époque asynchrone courante — valeur vivante (engine.js:375,424). */
	currentAsyncEpoch(): number;
	/** L'instance est-elle encore vivante pour cette époque (engine.js:376,425). */
	isQuizInstanceAlive(epoch?: number): boolean;
	/** L'instance N'est PAS détruite — état vivant, contraire du snapshot __quizDestroyed (engine.js:426). */
	isDestroyed(): boolean;
	/** Génération courante d'une slide (engine.js:377,427). */
	getSlideGeneration(index: number): number;
	/** La génération fournie est-elle la génération courante de la slide (engine.js:378,428). */
	isSlideGenerationCurrent(index: number, generation: number): boolean;

	/* ════════════════════════════════════════════════
	   Flags primitifs __quiz* — SNAPSHOT par valeur (2e Object.assign, :398-421).
	   Copie figée à l'assemblage : pour l'état vivant, utiliser les accessors
	   ci-dessus, jamais ces champs.
	   ════════════════════════════════════════════════ */
	/** Set des attentes async en cours (engine.js:367,398 ; lifecycle.ts createPendingAsyncWaiter). */
	__quizPendingAsyncWaiters: Set<PendingAsyncWaiter>;
	/** Cache hauteur de slide par index — même référence que ctx.viewport (engine.js:370,399 ; viewport.js:24). */
	__quizSlideHeightCache: Map<number, number>;
	/** Promesses de préchauffage de slide par index (engine.js:371,400 ; viewport.js:25). */
	__quizWarmSlidePromises: Map<number, Promise<unknown>>;
	/** Génération courante par slide (engine.js:366,401). */
	__quizSlideGeneration: number[];
	__quizDestroyed: boolean;
	__quizAsyncEpoch: number;
	__quizBackgroundWarmIdleHandle: number;
	__quizBackgroundWarmIdleType: string;
	__quizBackgroundWarmStarted: boolean;
	__quizBootstrapRaf1: number;
	__quizBootstrapRaf2: number;
	__quizMediaSyncToken: number;
	__quizEnsureVisibleRaf: number;
	__quizTrackTransitionFallbackTimer: number;
	__quizHeightRaf: number;
	__quizHeightResyncTimer: number;
	__quizPrimeHeightsRaf: number;
	__quizActiveSlideResizeObserver: ResizeObserver | null;
	__quizAllSlidesResizeObserver: ResizeObserver | null;
	__quizViewportResizeObserver: ResizeObserver | null;
	__quizViewportResizeRaf: number;
	__quizViewportResizeSettleTimer: number;
	__quizViewportSettleTimer: number;
	__quizTrackFixBound: boolean;

	/* ════════════════════════════════════════════════
	   Fonctions LOCALES du moteur greffées sur ctx — typées fidèlement depuis
	   engine.js (leur implémentation vit dans engine.js, converti en Task 10).
	   ════════════════════════════════════════════════ */
	/** engine.js:422-423,606,823 — annule le handle idle de préchauffage de fond. */
	clearBackgroundWarmIdleHandle(): void;
	/** engine.js:380-385,824 — annule le rAF d'ensureTrackVisible. */
	cancelEnsureTrackVisibleRaf(): void;
	/** engine.js:437-464 — cale la hauteur du viewport sur la slide `index`. */
	settleViewportHeightToIndex(index: number, opts?: { animate?: boolean; refresh?: boolean }): void;
	/** engine.js:466-492 — planifie une resynchro de hauteur du viewport. */
	scheduleViewportHeightSync(opts?: { delay?: number; index?: number; animate?: boolean; refresh?: boolean }): void;
	/** engine.js:494-511 — amorce les hauteurs de toutes les slides (avec retries). */
	primeAllSlideHeights(opts?: { retries?: number; syncCurrent?: boolean }): void;
	/** engine.js:513-527 — applique position + hauteur de piste instantanément ; renvoie true si OK. */
	applyTrackPositionAndHeightInstant(): boolean;
	/** engine.js:529-558 — force la piste visible après layout (retries + garde d'époque). */
	ensureTrackVisibleAfterLayout(retries?: number, epoch?: number): void;
	/** engine.js:560-586 — corrige le layout de piste au 1er chargement (fonts.ready). */
	bindTrackFirstLoadFix(): void;
	/** engine.js:591-645 — détruit l'instance (nettoyages, observers, timers, cleanups globaux). */
	destroyQuiz(): void;
	/** engine.js:647-697 — reconstruit la slide d'une question ; renvoie le nouvel élément ou null. */
	refreshQuestionSlide(qi: number, opts?: { syncHeight?: boolean }): Element | null;
	/** engine.js:699-706 — valide une interaction de question (invalide résultats + refresh). */
	commitQuestionInteraction(qi: number, opts?: { syncHeight?: boolean }): void;
	/** engine.js:714-800 — rendu principal (reconstruit tout le HTML des slides). */
	render(): void;
	/** engine.js:803-819 — bascule mode Leçon → Examen (lesson only). */
	switchToExamMode(): void;
}
