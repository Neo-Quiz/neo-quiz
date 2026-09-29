import { parseQuizSource, extractExamOptions, renderParagraph } from "./quiz-utils";
import { createTerminalHandlers } from "./engine/terminal";
import { createFocusHandlers } from "./engine/focus";
import { createLifecycleHandlers } from "./engine/lifecycle";
import { createWarmingHandlers } from "./engine/warming";
import { createSanitizer } from "./engine/sanitizer";
import { reinitialiserBudgetRendu } from "./engine/code-highlight";
import { createResourceHandlers } from "./engine/resources";
import { createCodeRunHandlers } from "./engine/code-run";
import { createExamHandlers } from "./engine/exam";
import { createCardRenderers } from "./engine/cards";
import { createViewportHandlers } from "./engine/viewport";
import { createTrackHandlers } from "./engine/track";
import { createZoomHandlers } from "./engine/zoom";
import { createInteractionHandlers } from "./engine/interactions";
import { createStateHandlers } from "./engine/state";
import { createHintHandlers } from "./engine/hint";
import { createQuestionHandlers } from "./engine/questions";
import { createTextOnlyHandlers } from "./engine/text-only";
import { createResultsSaver } from "./engine/results-save";
import { createPassageHandlers } from "./engine/passage";
import { createClozeHandlers } from "./engine/cloze";
import { buildLessonModel, createLessonHandlers } from "./engine/lesson";
import { createLearnHandlers } from "./engine/learn";
import { installCodeLangBubble } from "./engine/code-lang-bubble";
import { emptyLearnState } from "./engine/learn-loop";
import { createTermesHandlers } from "./engine/termes";
import { lecturesCourtes, numerosAffiches } from "./lecture-etape";
import { mathifyElement } from "./engine/mathjax";
import { idsForRawItems } from "./quiz-ids";
import { photographier, restaurer, type SessionSink } from "./engine/session";
import { t } from "./i18n";

import { currentHost } from "./host/current";
import type { EngineCtx } from "./types/engine-ctx";
import type {
	QuizQuestion,
	QuizState,
	SlideMapEntry,
	QuestionSelection,
	QuestionShuffleEntry,
	OrderingQuestion,
	MatchingQuestion,
	TextQuestion,
	ClozeQuestion,
	CodeQuestion,
	FlashcardQuestion,
} from "./types/quiz";

/**
 * Contexte d'appel du moteur, construit par l'hôte (le processeur de bloc du
 * greffon, ou la page de quiz de l'app). Ce n'est PAS le
 * MarkdownPostProcessorContext d'Obsidian. Nommé `context` (jamais `ctx`)
 * pour ne pas se confondre avec le god-object assemblé plus bas.
 *
 * Il ne porte plus `plugin` ni `Notice` : l'hôte est LU (currentHost),
 * pas TRANSMIS. Un hôte passé en paramètre laisserait deux hôtes coexister le
 * jour où un appelant oublierait de le passer. Depuis la tâche 5, `app` n'est
 * plus transmis non plus : fichiers, liens et ressources passent par l'hôte.
 */
interface RenderQuizContext {
	container: HTMLElement;
	quiz: QuizQuestion[];
	sourcePath: string;
	/** Absent = jouer ce quiz ne compte simplement pas de statistiques.
	    Ce n'est pas une erreur : la page « Générer » n'en a pas. */
	statsSink?: EngineCtx["statsSink"];
	/** Absent = les réponses ne sont pas journalisées. Même raison. */
	reviewSink?: EngineCtx["reviewSink"];
	/** Absent = pas de reprise : le quiz s'ouvre toujours de zéro. */
	sessionSink?: SessionSink;
}

async function renderInteractiveQuiz(context: RenderQuizContext): Promise<void> {

	const {
		container,
		quiz: rawQuiz,
		sourcePath,
		statsSink,
		reviewSink,
		sessionSink
	} = context;

	container.replaceChildren();

	if (!Array.isArray(rawQuiz) || rawQuiz.length === 0) {
		renderParagraph(container, t("engine.error.noQuestions"));
		return;
	}

	const { questions: quiz, quizMode, examOptions, glossary } = extractExamOptions(rawQuiz);

	if (!Array.isArray(quiz) || quiz.length === 0) {
		renderParagraph(container, t("engine.error.noQuestions"));
		return;
	}

	// Compat : d'anciens quiz générés par l'IA portent la clé `correctIndexes`
	// (au lieu de `correctIndices` lu partout ailleurs). Normaliser à l'ingestion
	// répare le scoring (state.js) et le rendu verrouillé (cards.js) sans réécrire la note.
	// `correctIndexes` est un champ legacy hors du type QuizQuestion : lecture/écriture
	// via un cast local documenté (aucun `any`, logique inchangée).
	for (const q of quiz) {
		const legacy = q as { correctIndices?: number[]; correctIndexes?: number[] };
		if (q && legacy.correctIndices == null && Array.isArray(legacy.correctIndexes)) {
			legacy.correctIndices = legacy.correctIndexes;
		}
	}

	const isExamMode = examOptions !== null;
	// examOptions!.durationMinutes : isExamMode ⇔ (examOptions !== null), donc le
	// non-null assertion est sûr dans la branche vraie (jamais atteinte sinon).
	const examDurationMs = isExamMode ? examOptions!.durationMinutes * 60 * 1000 : 0;
	let examStartTime = 0;
	let examTimerId = null;
	let examTimeRemaining = examDurationMs;
	let examEnded = false;
	let examStarted = false;

	const QUIZ_INSTANCE_ID = (
		typeof crypto !== "undefined" && crypto.randomUUID
			? crypto.randomUUID()
			: Math.random().toString(36).slice(2) + Date.now().toString(36)
	).slice(0, 8);

	const HINT_OVERLAY_ID = `quizHintOverlay_${QUIZ_INSTANCE_ID}`;
	const HINT_TITLE_ID = `quizHintTitle_${QUIZ_INSTANCE_ID}`;
	const __quizGlobalCleanups: Array<() => void> = [];

	const shuffleArray = <T,>(arr: T[]): T[] => {
		const a = [...arr];
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a;
	};

	const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));
	const isOrderingQuestion = (q: QuizQuestion): q is OrderingQuestion =>
		!!(q && ((q as { ordering?: unknown }).ordering === true || typeof (q as { ordering?: unknown }).ordering === "object"));
	const isMatchingQuestion = (q: QuizQuestion): q is MatchingQuestion =>
		!!(q && ((q as { matching?: unknown }).matching === true || typeof (q as { matching?: unknown }).matching === "object"));
	const isTextQuestion = (q: QuizQuestion): q is TextQuestion =>
		!!(q && ((q as { type?: unknown }).type === "text" || (q as { text?: unknown }).text === true));
	// Le gabarit EST le discriminant : une question qui porte un `cloze` non
	// vide est un texte à trous, quels que soient ses autres champs.
	const isClozeQuestion = (q: QuizQuestion): q is ClozeQuestion =>
		!!(q && typeof (q as { cloze?: unknown }).cloze === "string" && (q as { cloze: string }).cloze.trim().length > 0);
	// La PRÉSENCE de `language` non vide discrimine un exercice de code.
	const isCodeQuestion = (q: QuizQuestion): q is CodeQuestion =>
		!!(q && typeof (q as { language?: unknown }).language === "string" && (q as { language: string }).language.trim().length > 0);
	const isFlashcardQuestion = (q: QuizQuestion): q is FlashcardQuestion =>
		!!(q && (q as { flashcard?: unknown }).flashcard === true);

	// Create the shared context (ctx) for dependency injection.
	// Cast unique documenté (as EngineCtx) : à ce point les 17 slots de
	// sous-modules (sanitize, cards, …), l'état runtime (quizState) et les
	// fonctions locales du moteur ne sont pas encore greffés — ils le seront via
	// les Object.assign / affectations 1-à-1 ci-dessous. Le cast scelle la forme
	// finale attendue sans `any` intermédiaire (même pattern que editor.ts).
	const ctx = {
		host: currentHost(),
		container,
		sourcePath,
		quiz,
		/* Identité des questions pour l'ordonnanceur. La MÊME règle qu'à
		   l'écriture (editor/export.ts) et qu'à la lecture par le scanner :
		   trois règles séparées divergeraient, et une question changerait de
		   clé selon qui la regarde. `quiz-ids.ts` est un module pur — aucune
		   dépendance ajoutée au moteur. `idsForRawItems`, pas un `.map` retapé
		   ici : un élément parasite du tableau JSON5 (`null`, une chaîne) doit
		   recevoir un repli `qN` comme au scan, jamais lever (fix round 1,
		   2026-09-02 — `q.id` sans `?.` plantait tout le rendu du bloc). */
		questionIds: idsForRawItems(quiz),
		// Glossaire du quiz (engine/termes.ts l'indexe, engine/termes-bulle.ts
		// y relit term/definition) — voir types/engine-ctx.ts.
		glossaire: glossary,
		/* `reviewSink` était un accessor parce qu'il lisait `plugin._reviewStore`,
		   assigné après le chargement du greffon. Il arrive maintenant par le
		   contexte d'appel, donc déjà résolu : un accessor n'aurait plus rien à
		   différer. Les flags `__quiz*` restent copiés par VALEUR et l'état vivant
		   reste lu par accessors de closure — cette distinction-là ne bouge pas. */
		reviewSink,
		statsSink,
		sessionSink,
		quizMode,
		isExamMode,
		examOptions,
		examDurationMs,
		get examTimeRemaining() { return examTimeRemaining; },
		set examTimeRemaining(v: number) { examTimeRemaining = v; },
		get examStarted() { return examStarted; },
		set examStarted(v: boolean) { examStarted = v; },
		get examEnded() { return examEnded; },
		set examEnded(v: boolean) { examEnded = v; },
		get examStartTime() { return examStartTime; },
		set examStartTime(v: number) { examStartTime = v; },
		QUIZ_INSTANCE_ID,
		HINT_OVERLAY_ID,
		HINT_TITLE_ID,
		__quizGlobalCleanups,
		shuffleArray,
		clamp,
		isOrderingQuestion,
		isMatchingQuestion,
		isTextQuestion,
		isClozeQuestion,
		isCodeQuestion,
		isFlashcardQuestion
	} as EngineCtx;

	// Instancier tous les modules avec ctx injecté
	const sanitizer = createSanitizer(ctx);
	const resources = createResourceHandlers(ctx);
	const codeRun = createCodeRunHandlers(ctx);
	const exam = createExamHandlers(ctx);
	const textOnly = createTextOnlyHandlers(ctx);
	const cards = createCardRenderers(ctx);
	const viewport = createViewportHandlers(ctx);
	const track = createTrackHandlers(ctx);
	const zoom = createZoomHandlers(ctx);
	const interactions = createInteractionHandlers(ctx);
	const terminal = createTerminalHandlers(ctx);
	const focus = createFocusHandlers(ctx);
	const lifecycle = createLifecycleHandlers(ctx);
	const warming = createWarmingHandlers(ctx);
	const state = createStateHandlers(ctx);
	const hint = createHintHandlers(ctx);
	const questions = createQuestionHandlers(ctx);
	const resultsSaver = createResultsSaver(ctx);
	const passage = createPassageHandlers(ctx);
	const cloze = createClozeHandlers(ctx);
	const lesson = createLessonHandlers(ctx);
	// Lu APRÈS `lesson` : aucune dépendance entre les deux, ordre alphabétique
	// de queue comme les autres modules sans référence croisée à l'assemblage.
	const termes = createTermesHandlers(ctx);
	// The Learn retry loop (engine/learn.ts): reads the state lazily, like the others.
	const learn = createLearnHandlers(ctx);

	// Fonctions utilitaires seront définies après les constantes SLIDE_* pour éviter TDZ

	// Attacher les modules à ctx pour référence croisée
	Object.assign(ctx, {
		sanitize: sanitizer,
		resources,
		codeRun,
		exam,
		textOnly,
		cards,
		viewport,
		clearNavTabPressState: state.clearNavTabPressState,
		refreshMetaSlides: cards.refreshMetaSlides,
		track,
		zoom,
		interactions,
		terminal,
		focus,
		lifecycle,
		warming,
		state,
		hint,
		questions,
		resultsSaver,
		passage,
		cloze,
		lesson,
		termes,
		learn,
		isRevealed: learn.isRevealed,
		// depuis lesson : accessors (pas des flags __quiz*), voir engine/lesson.ts.
		isLessonMode: lesson.isLessonMode,
		lessonSlices: lesson.lessonSlices,
		sliceOfQuestion: lesson.sliceOfQuestion,
		roleOfQuestion: lesson.roleOfQuestion,
		// Fonctions exposées directement
		escapeHtmlText: sanitizer.escapeHtmlText,
		escapeHtmlAttr: sanitizer.escapeHtmlAttr,
		createPendingAsyncWaiter: lifecycle.createPendingAsyncWaiter,
		resolveAllPendingAsync: lifecycle.resolveAllPendingAsync,
		sleep: lifecycle.sleep,
		nextFrame: lifecycle.nextFrame,
		waitFrames: lifecycle.waitFrames,
		requestQuizIdle: lifecycle.requestQuizIdle,
		restartAsyncLifecycle: lifecycle.restartAsyncLifecycle,
		bumpSlideGeneration: lifecycle.bumpSlideGeneration,
		bumpAllSlideGenerations: lifecycle.bumpAllSlideGenerations,
		warmSlideForAccurateHeight: warming.warmSlideForAccurateHeight,
		warmSlidesAroundIndex: warming.warmSlidesAroundIndex,
		startFullBackgroundWarm: warming.startFullBackgroundWarm,
		bindTrackItemImages: warming.bindTrackItemImages,
		bindAllTrackImages: warming.bindAllTrackImages,
		bindCurrentSlideMediaHeightSync: warming.bindCurrentSlideMediaHeightSync,
		getMaxRenderedSlideHeight: viewport.getMaxRenderedSlideHeight,
		openHintModal: hint.openHintModal,
		closeHintModal: hint.closeHintModal,
		getOrderingItems: questions.getOrderingItems,
		getOrderingCorrectOrder: questions.getOrderingCorrectOrder,
		getOrderingSlotLabels: questions.getOrderingSlotLabels,
		getMatchRows: questions.getMatchRows,
		getMatchChoices: questions.getMatchChoices,
		getMatchCorrectMap: questions.getMatchCorrectMap,
		orderingSelectionIncludes: questions.orderingSelectionIncludes,
		removeOrderingItemFromSlot: questions.removeOrderingItemFromSlot,
		placeOrderingItemInSlot: questions.placeOrderingItemInSlot,
		matchingSelectionIncludes: questions.matchingSelectionIncludes,
		hasAnyAnswer: state.hasAnyAnswer,
		isComplete: state.isComplete,
		getMissingIndices: state.getMissingIndices,
		isCorrect: state.isCorrect,
		computeScorePercent: state.computeScorePercent,
		getSubmitSlideSignature: state.getSubmitSlideSignature,
		getResultsSlideSignature: state.getResultsSlideSignature,
		goToQuestion: state.goToQuestion,
		goToSubmit: state.goToSubmit,
		goToResults: state.goToResults,
		resetQuiz: state.resetQuiz,
		setPracticeMode: state.setPracticeMode,
		goToSlide: state.goToSlide,
		redirectSlide: state.redirectSlide,
		updateNavHighlight: state.updateNavHighlight,
		setSlidingClass: state.setSlidingClass,
		playNavTabPressAndNavigate: state.playNavTabPressAndNavigate,
		clearAllNavTabPressStates: state.clearAllNavTabPressStates,
		setNavTabPressState: state.setNavTabPressState,
		buildNavTabClass: state.buildNavTabClass,
		recordReview: state.recordReview,
		// Fonction render principale (sera assignée après sa définition pour éviter TDZ)
		render: null
	});


	function buildShuffleMap(): QuestionShuffleEntry[] {
		return quiz.map(q => {
			if (isTextQuestion(q)) return null;
			// Un texte à trous se lit dans l'ordre où il est écrit : rien à mélanger.
			if (isClozeQuestion(q)) return null;
			// Un exercice de code n'a pas d'options à mélanger.
			if (isCodeQuestion(q)) return null;
			// Une carte se retourne : rien à mélanger.
			if (isFlashcardQuestion(q)) return null;

			if (isOrderingQuestion(q)) {
				return shuffleArray([...Array(questions.getOrderingItems(q).length).keys()]);
			}

			if (isMatchingQuestion(q)) {
				return {
					rows: shuffleArray([...Array(questions.getMatchRows(q).length).keys()]),
					choices: shuffleArray([...Array(questions.getMatchChoices(q).length).keys()])
				};
			}

			return shuffleArray([...Array((q.options || []).length).keys()]);
		});
	}

	function initSelections(): QuestionSelection[] {
		return quiz.map(q => {
			if (isTextQuestion(q)) return "";
			// Une case de saisie par trou, vides — jamais `null` : le rendu lit
			// ces valeurs à chaque frappe et un trou absent ferait un `undefined`
			// dans la valeur de l'input.
			if (isClozeQuestion(q)) return new Array<string>(cloze.getBlanks(q).length).fill("");
			if (isCodeQuestion(q)) return "";
			if (isOrderingQuestion(q)) return new Array<number | null>(questions.getOrderingItems(q).length).fill(null);
			if (isMatchingQuestion(q)) return new Array<number | null>(questions.getMatchRows(q).length).fill(null);
			if (isFlashcardQuestion(q)) return null;
			if (q.multiSelect) return new Set<number>();
			return null;
		});
	}
	const initTextOnlyAnswers = () => quiz.map(() => "");
	const initTextOnlyChecked = () => quiz.map(() => false);
	const initTextOnlyRatings = () => quiz.map(() => null);
	const initOrderingPicks = () => quiz.map(() => null);
	const initMatchPicks = () => quiz.map(() => null);

	/* NUMBERS (src/lecture-etape.ts): in a Learn, each reading has its screen
	   but no question number (0; its tab is a book, engine/cards.ts
	   `navHtml`). FIXED at assembly, like `slideMap` — the mode of a quiz no
	   longer changes while it is played. */
	const estLecon = buildLessonModel(quiz, quizMode).isLesson;
	const numeros = numerosAffiches(quiz, estLecon);
	ctx.numeroAffiche = (qi: number): number => numeros[qi] ?? qi + 1;
	/* SHORT READINGS (same rule) have no screen: they are read above their
	   host question (engine/cards.ts). Fixed at assembly too, since the slide
	   map is built once: a short reading never gets a slide of its own. */
	const courtes = lecturesCourtes(quiz, estLecon);
	ctx.lecturesAbsorbees = new Set(courtes.keys());
	ctx.lectureCourteDe = (qi: number): number | null => {
		for (const [lecture, hote] of courtes) if (hote === qi) return lecture;
		return null;
	};

	// ── Slide Map : index dynamique basé sur le mode ──
	function buildSlideMap(): SlideMapEntry[] {
		const map: SlideMapEntry[] = [];
		for (let i = 0; i < quiz.length; i++) {
			if (courtes.has(i)) continue;
			map.push({ type: "question", questionIndex: i });
		}
		map.push({ type: "submit" });
		map.push({ type: "results" });
		return map;
	}

	let slideMap = buildSlideMap();
	const SLIDE_SUBMIT_INDEX = slideMap.length - 2;
	const SLIDE_RESULTS_INDEX = slideMap.length - 1;
	const TOTAL_SLIDES = slideMap.length;

	const quizState: QuizState = {
		practiceMode: "qcm",
		selections: initSelections(),
		textOnlyAnswers: initTextOnlyAnswers(),
		textOnlyChecked: initTextOnlyChecked(),
		textOnlyRatings: initTextOnlyRatings(),
		current: 0,
		prevCurrent: 0,
		lastQuestionIndex: 0,
		locked: false,
		pendingResultsLock: false,
		resultsCounted: false,
		savedResultsPath: null,
		shuffleMap: buildShuffleMap(),
		orderingPick: initOrderingPicks(),
		matchPick: initMatchPicks(),
		// Task 7, mode Lesson : cf. QuizState.lessonPreSkipped (src/types/quiz.ts).
		lessonPreSkipped: quiz.map(() => false),
		hintSeen: quiz.map(() => false),
		// Task 8 : cf. QuizState.recorded (src/types/quiz.ts). Vide à l'assemblage,
		// comme resultsCounted, avant que resetQuiz() ne l'aligne sur ctx.quiz.
		recorded: [],
		// The Learn retry loop (engine/learn-loop.ts): nothing checked yet.
		...emptyLearnState(quiz.length),
		isSliding: false,
		slideToken: 0
	};

	// Ajouter quizState, les constantes et les fonctions utilitaires au contexte AVANT de créer les modules qui en dépendent
	ctx.quizState = quizState;
	ctx.slideMap = slideMap;
	ctx.SLIDE_SUBMIT_INDEX = SLIDE_SUBMIT_INDEX;
	ctx.SLIDE_RESULTS_INDEX = SLIDE_RESULTS_INDEX;
	ctx.TOTAL_SLIDES = TOTAL_SLIDES;
	ctx.initSelections = initSelections;
	ctx.initTextOnlyAnswers = initTextOnlyAnswers;
	ctx.initTextOnlyChecked = initTextOnlyChecked;
	ctx.initTextOnlyRatings = initTextOnlyRatings;
	ctx.buildShuffleMap = buildShuffleMap;
	ctx.initOrderingPicks = initOrderingPicks;
	ctx.initMatchPicks = initMatchPicks;

	// Définir les fonctions utilitaires APRÈS les constantes SLIDE_* pour éviter TDZ
	const isQuestionSlideIndex = (i: number): boolean => slideMap[i]?.type === "question";
	const isSubmitSlideIndex = (i: number): boolean => slideMap[i]?.type === "submit";
	const isResultsSlideIndex = (i: number): boolean => slideMap[i]?.type === "results";
	const clampSlideIndex = (i: number): number => Math.max(0, Math.min(TOTAL_SLIDES - 1, i));
	const getSlidingWindow = (): { from: number; to: number } => ({ from: Math.max(0, Math.min(quizState.prevCurrent, quizState.current)), to: Math.min(TOTAL_SLIDES - 1, Math.max(quizState.prevCurrent, quizState.current)) });
	/* Une lecture courte n'a pas de diapositive : elle renvoie à sa question
	   hôte, qui la montre. Une reprise ou un onglet qui la visait tombe sur
	   une vraie diapositive plutôt que sur rien. */
	const getSlideIndexForQuestion = (qi: number): number => {
		const cible = courtes.get(qi) ?? qi;
		for (let si = 0; si < slideMap.length; si++) {
			const entry = slideMap[si];
			if (entry.type === "question" && entry.questionIndex === cible) return si;
		}
		return -1;
	};
	/** La question de la diapositive qui suit celle de `qi` ; `null` après la dernière. */
	const questionSuivante = (qi: number): number | null => {
		const si = getSlideIndexForQuestion(qi);
		const suivante = si >= 0 ? slideMap[si + 1] : undefined;
		return suivante?.type === "question" ? suivante.questionIndex : null;
	};

	// Exposer les fonctions utilitaires dans ctx
	ctx.isQuestionSlideIndex = isQuestionSlideIndex;
	ctx.isSubmitSlideIndex = isSubmitSlideIndex;
	ctx.isResultsSlideIndex = isResultsSlideIndex;
	ctx.clampSlideIndex = clampSlideIndex;
	ctx.getSlidingWindow = getSlidingWindow;
	ctx.getSlideIndexForQuestion = getSlideIndexForQuestion;
	ctx.questionSuivante = questionSuivante;
	/* La photo de session : prise après chaque réponse (`invalidateSavedResults`
	   est appelé par TOUTE interaction), à chaque changement de question
	   (state.ts) et à la destruction du moteur (un texte tapé sans quitter la
	   question). Jamais en examen ; jamais hors d'une question. Un bloc
	   d'EXAMEN d'origine (`isExamMode` à l'assemblage) n'est jamais
	   photographié, même joué en « Apprendre » : il rouvre sur son écran de
	   départ, qui effacerait la session — le « Reprendre » du dossier
	   aurait promis une reprise que le moteur détruit. */
	ctx.saveSession = () => {
		if (!sessionSink || isExamMode || ctx.isExamMode || quizState.locked) return;
		const entree = slideMap[quizState.current];
		if (!entree || entree.type !== "question") return;
		const photo = photographier(quizState, ctx.questionIds, entree.questionIndex, Date.now());
		// Un quiz ouvert puis feuilleté sans jamais répondre n'a rien à
		// reprendre : ne pas lui offrir « Reprendre » (règle du chantier).
		if (Object.keys(photo.questions).length === 0) sessionSink.effacer();
		else sessionSink.enregistrer(photo);
	};
	ctx.clearSession = () => { sessionSink?.effacer(); };

	ctx.invalidateSavedResults = () => {
		quizState.savedResultsPath = null;
		ctx.saveSession();
	};

	if (typeof container.__quizDestroy === "function") {
		try { container.__quizDestroy(); } catch (_) {}
	}

	let __quizTrackFixBound = false;
	let __quizHeightRaf = 0;
	let __quizHeightResyncTimer = 0;
	let __quizMediaSyncToken = 0;
	let __quizPrimeHeightsRaf = 0;
	let __quizTrackTransitionFallbackTimer = 0;
	let __quizActiveSlideResizeObserver: ResizeObserver | null = null;
	let __quizAllSlidesResizeObserver: ResizeObserver | null = null;
	let __quizViewportSettleTimer = 0;
	let __quizBackgroundWarmStarted = false;
	let __quizViewportResizeObserver: ResizeObserver | null = null;
	let __quizViewportResizeRaf = 0;
	let __quizViewportResizeSettleTimer = 0;
	let __quizDestroyed = false;
	let __quizAsyncEpoch = 0;
	let __quizBackgroundWarmIdleHandle = 0;
	let __quizBackgroundWarmIdleType = "";
	let __quizBootstrapRaf1 = 0;
	let __quizBootstrapRaf2 = 0;
	let __quizHintCloseTimer = 0;
	let __quizHintOpenRaf1 = 0;
	let __quizHintOpenRaf2 = 0;
	let __quizHintFocusTimer = 0;
	let __quizEnsureVisibleRaf = 0;
	let __quizTrackViewportWidth = 0;
	let __quizTrackAppliedWidth = 0;
	let __quizTrackAppliedSlideCount = 0;
	let __quizSubmitSlideSignature = "";
	let __quizResultsSlideSignature = "";

	const __quizSlideGeneration = Array.from({ length: TOTAL_SLIDES }, () => 0);
	const __quizPendingAsyncWaiters = new Set();

	// Utiliser les caches du module viewport pour éviter la duplication
	const __quizSlideHeightCache = ctx.viewport.__quizSlideHeightCache;
	const __quizWarmSlidePromises = ctx.viewport.__quizWarmSlidePromises;



	const currentAsyncEpoch = (): number => __quizAsyncEpoch;
	const isQuizInstanceAlive = (epoch: number = __quizAsyncEpoch): boolean => !__quizDestroyed && epoch === __quizAsyncEpoch;
	const getSlideGeneration = (index: number): number => Number.isFinite(__quizSlideGeneration[index]) ? __quizSlideGeneration[index] : 0;
	const isSlideGenerationCurrent = (index: number, generation: number): boolean => getSlideGeneration(index) === generation;

	function cancelEnsureTrackVisibleRaf(): void {
		if (__quizEnsureVisibleRaf) {
			cancelAnimationFrame(__quizEnsureVisibleRaf);
			__quizEnsureVisibleRaf = 0;
		}
	}

	function clearBackgroundWarmIdleHandle(): void {
		if (!__quizBackgroundWarmIdleHandle) return;
		if (__quizBackgroundWarmIdleType === "idle" && "cancelIdleCallback" in window) {
			try { window.cancelIdleCallback(__quizBackgroundWarmIdleHandle); } catch (_) {}
		} else clearTimeout(__quizBackgroundWarmIdleHandle);
		__quizBackgroundWarmIdleHandle = 0;
		__quizBackgroundWarmIdleType = "";
	}

	// Exposer les variables et fonctions internes aux modules via ctx
	Object.assign(ctx, {
		__quizPendingAsyncWaiters,
		__quizSlideHeightCache,
		__quizWarmSlidePromises,
		__quizSlideGeneration,
		__quizDestroyed,
		__quizAsyncEpoch,
		__quizBackgroundWarmIdleHandle,
		__quizBackgroundWarmIdleType,
		__quizBackgroundWarmStarted,
		__quizBootstrapRaf1,
		__quizBootstrapRaf2,
		__quizMediaSyncToken,
		__quizEnsureVisibleRaf,
		__quizTrackTransitionFallbackTimer,
		__quizHeightRaf,
		__quizHeightResyncTimer,
		__quizPrimeHeightsRaf,
		__quizActiveSlideResizeObserver,
		__quizAllSlidesResizeObserver,
		__quizViewportResizeObserver,
		__quizViewportResizeRaf,
		__quizViewportResizeSettleTimer,
		__quizViewportSettleTimer,
		__quizTrackFixBound,
		clearBackgroundWarmIdleHandle,
		cancelEnsureTrackVisibleRaf,
		currentAsyncEpoch,
		isQuizInstanceAlive,
		// Vrai une fois le quiz DÉTRUIT. Était inversé (`!__quizDestroyed`)
		// et sans appelant jusqu'à l'écouteur clavier des cartes (2026-09-25).
		isDestroyed: () => __quizDestroyed,
		getSlideGeneration,
		isSlideGenerationCurrent
	});


	const alignToDevicePixel = (value: number | null): number => {
		const dpr = window.devicePixelRatio || 1;
		return Math.round((Number(value) || 0) * dpr) / dpr;
	};

	function settleViewportHeightToIndex(index: number, { animate = true, refresh = true }: { animate?: boolean; refresh?: boolean } = {}): void {
		const { viewport: vpElement } = viewport.getTrackElements();
		if (!vpElement) return;
		const targetHeight = Math.max(1, viewport.getSlideStableHeight(index, { refresh }) || 0);
		if (!targetHeight) return;
		const currentHeight = Math.max(
			1,
			Math.ceil(parseFloat(vpElement.style.height || "0") || 0),
			Math.ceil(vpElement.getBoundingClientRect().height || 0),
			Math.ceil(vpElement.clientHeight || 0)
		);
		if (Math.abs(currentHeight - targetHeight) <= 1) {
			vpElement.style.transition = "none";
			vpElement.style.height = `${targetHeight}px`;
			vpElement.dataset.quizHeightReady = "1";
			return;
		}
		vpElement.style.transition = animate ? "height 240ms cubic-bezier(0.16, 1, 0.3, 1)" : "none";
		vpElement.style.height = `${targetHeight}px`;
		vpElement.dataset.quizHeightReady = "1";
		if (animate) {
			__quizViewportSettleTimer = window.setTimeout(() => {
				const { viewport: vp } = viewport.getTrackElements();
				if (vp) vp.style.transition = "none";
			}, 280);
		}
	}
	ctx.settleViewportHeightToIndex = settleViewportHeightToIndex;

	function scheduleViewportHeightSync({ delay = 0, index = quizState.current, animate = false, refresh = false }: { delay?: number; index?: number; animate?: boolean; refresh?: boolean } = {}): void {
		if (__quizHeightRaf) {
			cancelAnimationFrame(__quizHeightRaf);
			__quizHeightRaf = 0;
		}
		if (__quizHeightResyncTimer) {
			clearTimeout(__quizHeightResyncTimer);
			__quizHeightResyncTimer = 0;
		}
		const run = () => {
			__quizHeightRaf = requestAnimationFrame(() => {
				__quizHeightRaf = 0;
				viewport.syncViewportHeight({ index, animate, refresh });
				if (index === quizState.current) {
					ctx.warming.bindCurrentSlideMediaHeightSync();
					ctx.viewport.bindActiveSlideResizeObserver();
				}
			});
		};
		if (delay > 0) {
			__quizHeightResyncTimer = window.setTimeout(() => {
				__quizHeightResyncTimer = 0;
				run();
			}, delay);
		} else run();
	}
	ctx.scheduleViewportHeightSync = scheduleViewportHeightSync;

	function primeAllSlideHeights({ retries = 8, syncCurrent = true }: { retries?: number; syncCurrent?: boolean } = {}): void {
		const items = viewport.getTrackItems();
		if (items.length === 0) return;
		let zeroCount = 0;
		items.forEach((item, index) => {
			const h = viewport.getElementStableHeight(item);
			if (h > 0) __quizSlideHeightCache.set(index, h);
			else zeroCount++;
		});
		if (syncCurrent) viewport.syncViewportHeight({ index: quizState.current, animate: false, refresh: true });
		if (zeroCount > 0 && retries > 0) {
			__quizPrimeHeightsRaf = requestAnimationFrame(() => {
				__quizPrimeHeightsRaf = 0;
				primeAllSlideHeights({ retries: retries - 1, syncCurrent });
			});
		}
	}
	ctx.primeAllSlideHeights = primeAllSlideHeights;

	function applyTrackPositionAndHeightInstant(): boolean {
		const { track } = viewport.getTrackElements();
		if (!track) return false;
		ctx.viewport.syncTrackViewportIsolation();
		viewport.applyTrackGeometry({ refreshWidth: true });
		track.style.transition = "none";
		track.style.willChange = "";
		ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(quizState.current));
		const ok = viewport.syncViewportHeight({ index: quizState.current, animate: false, refresh: true });
		ctx.warming.bindCurrentSlideMediaHeightSync();
		ctx.viewport.bindActiveSlideResizeObserver();
		ctx.viewport.syncTrackViewportIsolation();
		return ok;
	}
	ctx.applyTrackPositionAndHeightInstant = applyTrackPositionAndHeightInstant;

	function ensureTrackVisibleAfterLayout(retries: number = 24, epoch: number = currentAsyncEpoch()): void {
		cancelEnsureTrackVisibleRaf();
		if (!isQuizInstanceAlive(epoch)) return;
		const { track } = viewport.getTrackElements();
		if (!track) return;
		ctx.viewport.syncTrackViewportIsolation();
		viewport.applyTrackGeometry({ refreshWidth: true });
		track.style.transition = "none";
		track.style.willChange = "";
		ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(quizState.current));
		const h = viewport.getSlideStableHeight(quizState.current, { refresh: true });
		if (h > 0) {
			viewport.setViewportHeight(h, { animate: false });
			ctx.warming.bindCurrentSlideMediaHeightSync();
			ctx.viewport.bindActiveSlideResizeObserver();
			ctx.viewport.syncTrackViewportIsolation();
			return;
		}
		if (retries <= 0) {
			ctx.viewport.scheduleViewportHeightSync({ index: quizState.current, animate: false, refresh: true });
			return;
		}
		__quizEnsureVisibleRaf = requestAnimationFrame(() => {
			__quizEnsureVisibleRaf = 0;
			ensureTrackVisibleAfterLayout(retries - 1, epoch);
		});
	}

	// Expose ensureTrackVisibleAfterLayout to ctx for use in bootstrap callbacks
	ctx.ensureTrackVisibleAfterLayout = ensureTrackVisibleAfterLayout;

	function bindTrackFirstLoadFix(): void {
		if (__quizTrackFixBound) return;
		__quizTrackFixBound = true;
		const resyncLayout = () => requestAnimationFrame(() => {
			if (__quizDestroyed) return;
			const { track } = viewport.getTrackElements();
			if (track) {
				track.style.transition = "none";
				track.style.willChange = "";
				track.style.backfaceVisibility = "hidden";
				track.style.transformStyle = "preserve-3d";
				ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(quizState.current));
			}
			__quizSlideHeightCache.delete(quizState.current);
			primeAllSlideHeights({ retries: 3, syncCurrent: true });
			ctx.viewport.scheduleViewportHeightSync({ index: quizState.current, animate: false, refresh: true });
		});
		if (document.fonts?.ready) {
			const epoch = currentAsyncEpoch();
			document.fonts.ready.then(() => {
				if (!isQuizInstanceAlive(epoch)) return;
				resyncLayout();
				primeAllSlideHeights({ retries: 3, syncCurrent: true });
			}).catch(() => {});
		}
	}
	ctx.bindTrackFirstLoadFix = bindTrackFirstLoadFix;

	// Navigation functions (goToSlide, redirectSlide, goToQuestion, goToSubmit, goToResults, resetQuiz)
	// sont fournies par le module state via ctx.state.*

	function destroyQuiz(): void {
		try { ctx.saveSession(); } catch (_) {}
		__quizDestroyed = true;
		__quizAsyncEpoch++;

		container.querySelectorAll<HTMLElement>('.quiz-track-item[data-slide-kind="question"]').forEach(item => {
			if (typeof item.__quizTextQuestionCleanup === "function") {
				try { item.__quizTextQuestionCleanup(); } catch (_) {}
			}
		});

		ctx.hint.closeHintModal();
		ctx.track.clearTrackTransitionFallback();
		ctx.viewport.destroyActiveSlideResizeObserver();
		ctx.viewport.destroyAllSlidesResizeObserver();
		ctx.viewport.destroyViewportResizeObserver();
		clearBackgroundWarmIdleHandle();
		cancelEnsureTrackVisibleRaf();
		ctx.lifecycle.resolveAllPendingAsync(false);

		if (__quizHeightRaf) { cancelAnimationFrame(__quizHeightRaf); __quizHeightRaf = 0; }
		if (__quizHeightResyncTimer) { clearTimeout(__quizHeightResyncTimer); __quizHeightResyncTimer = 0; }
		if (__quizHintCloseTimer) { clearTimeout(__quizHintCloseTimer); __quizHintCloseTimer = 0; }
		if (__quizHintOpenRaf1) { cancelAnimationFrame(__quizHintOpenRaf1); __quizHintOpenRaf1 = 0; }
		if (__quizHintOpenRaf2) { cancelAnimationFrame(__quizHintOpenRaf2); __quizHintOpenRaf2 = 0; }
		if (__quizHintFocusTimer) { clearTimeout(__quizHintFocusTimer); __quizHintFocusTimer = 0; }
		if (__quizBootstrapRaf1) { cancelAnimationFrame(__quizBootstrapRaf1); __quizBootstrapRaf1 = 0; }
		if (__quizBootstrapRaf2) { cancelAnimationFrame(__quizBootstrapRaf2); __quizBootstrapRaf2 = 0; }
		exam.stopExamTimer();

		const hintOverlay = document.getElementById(HINT_OVERLAY_ID);
		if (hintOverlay) {
			try { hintOverlay.remove(); } catch (_) {}
		}

		for (const fn of __quizGlobalCleanups) {
			try { fn(); } catch (_) {}
		}
		__quizGlobalCleanups.length = 0;

		ctx.viewport.__quizSlideHeightCache?.clear();
		ctx.viewport.__quizWarmSlidePromises?.clear();
		__quizBackgroundWarmStarted = false;
		__quizTrackFixBound = false;
		__quizTrackViewportWidth = 0;
		__quizTrackAppliedWidth = 0;
		__quizTrackAppliedSlideCount = 0;
		__quizSubmitSlideSignature = "";
		__quizResultsSlideSignature = "";

		if (container.__quizDestroy === destroyQuiz) delete container.__quizDestroy;
		ctx.interactions.destroyZoomFixHandlers();
	}

	container.__quizDestroy = destroyQuiz;
	ctx.destroyQuiz = destroyQuiz;

	function refreshQuestionSlide(qi: number, { syncHeight = true }: { syncHeight?: boolean } = {}): Element | null {
		const oldItem = container.querySelector<HTMLElement>(`.quiz-track-item[data-slide-kind="question"][data-qi="${qi}"]`);
		if (!oldItem) return null;

		if (typeof oldItem.__quizTextQuestionCleanup === "function") {
			try { oldItem.__quizTextQuestionCleanup(); } catch (_) {}
		}

		const focusDescriptor = ctx.focus.getQuestionFocusDescriptor(oldItem);
		const slideIdx = getSlideIndexForQuestion(qi);
		ctx.viewport.unobserveTrackItemInAllSlidesResizeObserver(oldItem);
		if (slideIdx >= 0) ctx.lifecycle.bumpSlideGeneration(slideIdx);

		// Budget de coloration remis à zéro : ce re-rendu d'UNE carte est son
		// propre « rendu complet », indépendant de celui qui a construit le
		// track initial (revue du 2026-09-26, tour 4).
		reinitialiserBudgetRendu();
		const tmp = document.createElement("div");
			tmp.innerHTML = ctx.cards.questionCardHtml(qi).trim();
		// firstElementChild : la carte de question rendue est toujours un <div>
		// (HTMLElement) au runtime — cast honnête sur cet invariant.
		const newItem = tmp.firstElementChild as HTMLElement | null;
		if (!newItem) return null;

		oldItem.replaceWith(newItem);
		// Termes du glossaire AVANT mathifyElement : la passe remplace des
		// nœuds texte (span.qb-terme), et mathifyElement capture les siens de
		// façon synchrone avant d'attendre MathJax — inverser l'ordre
		// détacherait une formule dont le texte contient aussi un terme
		// (engine/termes.ts, tête de fichier).
		ctx.termes.poserTermes(newItem);
		// LaTeX $...$ / $$...$$ : rendu MathJax natif Obsidian (fire-and-forget
		// — les ResizeObservers recalent la hauteur quand la formule arrive).
		mathifyElement(newItem);
		ctx.viewport.applyTrackGeometry({ refreshWidth: false });
		ctx.resources.bindQuizResourceButtons(newItem);
		ctx.codeRun.bindCodeRunButtons(newItem);
		ctx.warming.bindTrackItemImages(newItem, qi);
		ctx.interactions.bindQuestionTrackItem(newItem);
		ctx.viewport.observeTrackItemInAllSlidesResizeObserver(newItem);
		ctx.state.updateNavHighlight();
		ctx.viewport.syncTrackViewportIsolation();

		const { track } = viewport.getTrackElements();
		if (track) {
			track.style.transition = "none";
			ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(quizState.current));
		}

		ctx.focus.restoreQuestionFocus(newItem, focusDescriptor);

		if (syncHeight && slideIdx === quizState.current) {
			requestAnimationFrame(() => {
				if (__quizDestroyed) return;
				__quizSlideHeightCache.delete(slideIdx);
				ctx.warming.bindCurrentSlideMediaHeightSync();
				ctx.viewport.bindActiveSlideResizeObserver();
				ctx.viewport.scheduleViewportHeightSync({ index: slideIdx, animate: false, refresh: true });
			});
		}

		return newItem;
	}
	ctx.refreshQuestionSlide = refreshQuestionSlide;

	function commitQuestionInteraction(qi: number, { syncHeight = true }: { syncHeight?: boolean } = {}): void {
		ctx.invalidateSavedResults?.();
		const slideIdx = getSlideIndexForQuestion(qi);
		if (slideIdx >= 0) __quizSlideHeightCache.delete(slideIdx);
		refreshQuestionSlide(qi, { syncHeight });
		// `refreshMetaSlides` n'a jamais été une variable en scope ici (seule
		// `cards.refreshMetaSlides` existe, aliasée sur ctx plus haut) : l'appel
		// nu `refreshMetaSlides()` du JS était un ReferenceError latent. Résolu à
		// l'intention démontrée (cf. le jumeau engine/interactions.ts qui appelle
		// `ctx.refreshMetaSlides()`). Voir rapport 10d.
		cards.refreshMetaSlides();
	}
	ctx.commitQuestionInteraction = commitQuestionInteraction;

	let __quizZoomFixBound = false;
	let __quizZoomFixRaf = 0;
	let __quizZoomFixSettleTimer = 0;
	let __quizZoomLastDpr = window.devicePixelRatio || 1;
	let __quizZoomFixHandler = null;

	function render(): void {
	    ctx.lifecycle.restartAsyncLifecycle();
	    cancelEnsureTrackVisibleRaf();
	    container.classList.toggle("quiz-mode-text-only", quizState.practiceMode === "text");
	    container.classList.toggle("quiz-mode-qcm", quizState.practiceMode !== "text");
	    container.classList.toggle("quiz-is-locked", quizState.locked && quizState.practiceMode !== "text");

	    container.querySelectorAll<HTMLElement>('.quiz-track-item[data-slide-kind="question"]').forEach(item => {
	        if (typeof item.__quizTextQuestionCleanup === "function") {
	            try { item.__quizTextQuestionCleanup(); } catch (_) {}
	        }
	    });

	    ctx.lifecycle.bumpAllSlideGenerations();
	    ctx.viewport.destroyActiveSlideResizeObserver();
	    ctx.viewport.destroyAllSlidesResizeObserver();
	    ctx.viewport.destroyViewportResizeObserver();
	    ctx.track.clearTrackTransitionFallback();

	    if (ctx.isExamMode && !ctx.examStarted) {
	        // An Exam's start screen: its duration, a single Start button.
	        container.innerHTML = ctx.exam.examTimerHtml();
	        ctx.exam.bindExamStartButton();
	        return;
	    }

	    const examChromeHtml = ctx.exam.examTimerHtml();

	    // Budget de coloration des blocs de code (code-highlight.ts) remis à
	    // zéro UNE fois pour TOUT ce rendu — pas par carte, sans quoi un quiz
	    // de 50 questions rechargeait 50 budgets pleins (re-revue du
	    // 2026-09-26, tour 4 : 8,4 s mesurés pour 50 cartes contre ~150 ms
	    // attendus). Toutes les cartes du track partagent ce budget.
	    reinitialiserBudgetRendu();
	    // Construire le HTML des slides à partir du slideMap
	    const slidesHtml = slideMap.map(entry => {
	        if (entry.type === "question") return ctx.cards.questionCardHtml(entry.questionIndex);
	        if (entry.type === "submit") return ctx.cards.submitSlideHtml();
	        if (entry.type === "results") return ctx.cards.resultsSlideHtml();
	        return "";
	    }).join("");

	    // Le bouton « Practice mode » global a disparu (2026-08-31) : sa mécanique
	    // (réponse libre + auto-évaluation) est ABSORBÉE par le rôle "recall" en
	    // mode Leçon, décidé question par question (ctx.textOnly.isTextOnlyFor).
	    container.innerHTML = `${examChromeHtml}${ctx.cards.navHtml()}<div class="quiz-track-viewport" data-quiz-height-ready="0"><div class="quiz-track">${slidesHtml}</div></div>`;
	    // Termes du glossaire AVANT mathifyElement — même ordre, même raison
	    // qu'en repeint d'une carte (voir refreshQuestionSlide plus haut).
	    ctx.termes.poserTermes(container);
	    // LaTeX $...$ / $$...$$ de toutes les slides (prompts, options,
	    // explications, résultats) : rendu MathJax natif Obsidian.
	    mathifyElement(container);
	    __quizSubmitSlideSignature = ctx.state.getSubmitSlideSignature();
	    __quizResultsSlideSignature = ctx.state.getResultsSlideSignature();

	    const { viewport: vp, track } = viewport.getTrackElements();
	    bindTrackFirstLoadFix();
	    ctx.viewport.bindViewportResizeObserver();
	    ctx.interactions.bindZoomFixHandlers();

	    if (!track || !vp) return;

	    track.style.transition = "none";
	    track.style.willChange = "";
	    track.style.backfaceVisibility = "hidden";
	    track.style.transformStyle = "preserve-3d";

	    viewport.applyTrackGeometry({ refreshWidth: true });
	    ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(quizState.current));

	    vp.style.willChange = "";
	    vp.style.transform = "";
	    vp.style.opacity = "";

	    if (!applyTrackPositionAndHeightInstant()) {
	        ensureTrackVisibleAfterLayout(24, currentAsyncEpoch());
	    }

	    ctx.viewport.bindAllSlidesResizeObserver();
	    ctx.warming.bindAllTrackImages();
	    ctx.resources.bindQuizResourceButtons(container);
	    ctx.codeRun.bindCodeRunButtons(container);
	    container.querySelectorAll<HTMLElement>('.quiz-track-item[data-slide-kind="question"]').forEach(ctx.interactions.bindQuestionTrackItem);
	    ctx.interactions.bindStaticControls();

	    primeAllSlideHeights({ retries: 6, syncCurrent: true });
	    ctx.warming.warmSlidesAroundIndex(quizState.current, 3);
	    ctx.warming.startFullBackgroundWarm();
	    ctx.state.updateNavHighlight();
	    ctx.state.setSlidingClass(quizState.isSliding);

	    if (ctx.isExamMode) {
	        ctx.exam.startExamTimer();
	    }
	}

	// Assign render function to ctx AFTER it's defined to avoid TDZ
	ctx.render = render;

	// The language name above a code block's logo, on hover (engine/code-lang-bubble.ts).
	__quizGlobalCleanups.push(installCodeLangBubble(container));

	// Assign remaining local functions to ctx
	// Navigation functions use ctx.state.*
	ctx.clearBackgroundWarmIdleHandle = clearBackgroundWarmIdleHandle;
	ctx.cancelEnsureTrackVisibleRaf = cancelEnsureTrackVisibleRaf;
	ctx.stopExamTimer = exam.stopExamTimer;
	ctx.updateExamTimerDisplay = exam.updateExamTimerDisplay;

	/* REPRISE (2026-09-26) : la photo de la session précédente, restaurée
	   AVANT le premier rendu — le quiz s'ouvre directement sur la question
	   où l'on s'était arrêté, réponses comprises. Jamais pour un examen
	   (décision : un examen se fait d'une traite), dont la session est
	   effacée. Photo illisible → `null` → ouverture de zéro. */
	if (sessionSink && ctx.isExamMode) sessionSink.effacer();
	else if (sessionSink?.initiale) {
		const reprise = restaurer(sessionSink.initiale, ctx.questionIds, { selections: quizState.selections, shuffleMap: quizState.shuffleMap });
		if (reprise) {
			const { courante, ...champs } = reprise;
			Object.assign(quizState, champs);
			// `getSlideIndexForQuestion`, pas une recherche directe : une photo
			// prise quand la lecture était encore un écran peut désigner une
			// lecture ABSORBÉE depuis — on rouvre sur la question qui la montre.
			const slide = getSlideIndexForQuestion(courante);
			if (slide >= 0) {
				quizState.current = slide;
				quizState.prevCurrent = slide;
				quizState.lastQuestionIndex = (slideMap[slide] as { questionIndex: number }).questionIndex;
			}
		}
	}

	render();

	const __quizBootstrapEpoch = currentAsyncEpoch();
	__quizBootstrapRaf1 = requestAnimationFrame(() => {
		__quizBootstrapRaf1 = 0;
		if (!isQuizInstanceAlive(__quizBootstrapEpoch)) return;

		__quizBootstrapRaf2 = requestAnimationFrame(async () => {
			__quizBootstrapRaf2 = 0;
			if (!isQuizInstanceAlive(__quizBootstrapEpoch)) return;

			ctx.viewport.primeAllSlideHeights({ retries: 6, syncCurrent: true });
			ctx.ensureTrackVisibleAfterLayout(24, __quizBootstrapEpoch);
			await ctx.warming.warmSlideForAccurateHeight(quizState.current).catch(() => {});
			if (!isQuizInstanceAlive(__quizBootstrapEpoch)) return;

			ctx.warming.warmSlidesAroundIndex(quizState.current, 3);
			ctx.warming.startFullBackgroundWarm();
		});
	});

}

export { renderInteractiveQuiz, parseQuizSource, extractExamOptions, renderParagraph };
