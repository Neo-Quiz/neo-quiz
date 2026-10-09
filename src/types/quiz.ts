/**
 * Types de données métier du moteur de quiz (quiz-blocks).
 *
 * Dérivés de la forme RÉELLE des données lues/écrites par le moteur JS
 * (aucun de ces types n'est encore consommé par du code — fichier isolé,
 * base pour les lots suivants de la conversion TypeScript). Sources :
 *   - src/quiz-utils.js       parseQuizSource (JSON5) + extractExamOptions
 *   - src/engine/sanitizer.js rendu HTML des questions (révèle *Html, resourceButton)
 *   - src/engine/questions.js helpers de forme ordering/matching (fallback chains)
 *   - src/engine/state.js     discrimination des variantes, isCorrect/isComplete
 *   - src/engine/text-only.js mode entraînement texte libre (textOnly*, RATINGS)
 *   - src/engine/exam.js      options d'examen (ctx.examOptions)
 *   - src/engine.js           prédicats isOrderingQuestion/isMatchingQuestion/
 *                             isTextQuestion, littéral quizState complet, buildShuffleMap
 *
 * Note de conception : src/engine/sanitizer.js ne normalise PAS les champs de
 * données des questions (c'est un module d'échappement/rendu HTML pur). La
 * seule normalisation de données observée est ponctuelle dans engine.js
 * (compat `correctIndexes` → `correctIndices`, engine.js:48-55). Les champs
 * ci-dessous sont donc dérivés directement des accès `q.xxx` dans le moteur,
 * pas d'une étape de sanitization centralisée.
 */

import type { StepSlide } from "../engine/step-page";

/** Bouton de ressource optionnel affiché sur une question (sanitizer.js resourceButtonHtml, engine/cards.js). */
export interface ResourceButton {
	label: string;
	fileName: string;
}

/** Rôles de la boucle d'apprentissage. Valeurs PERSISTÉES : jamais traduites. */
export type QuestionRole = "pre" | "read" | "explain" | "recall" | "test";

/**
 * Liste canonique des rôles, dans l'ordre de la boucle en 5 temps. Source
 * unique du vocabulaire : `src/editor/convert.ts` (lecture) et
 * `src/editor/export.ts` (écriture) valident encore `role` par une
 * comparaison en dur (`q.role === "pre" || ...`) — les raccorder à cette
 * constante est délibérément différé à la revue finale du lot mode leçon
 * (task 3, 2026-08-31), pour ne pas élargir la tâche qui l'introduit
 * (`src/engine/lesson.ts`, seul consommateur actuel).
 *
 * `read` (task 6b, 2026-08-31) : le temps 2 de la boucle, ajouté après coup
 * pour combler un trou de conception — aucune étape ne montrait jamais le
 * support avant que "recall" en exige la restitution de mémoire. Une carte
 * `read` n'a pas de réponse : voir `passageVisibility` (engine/passage.ts)
 * et les branches dédiées d'`engine/state.ts`.
 *
 * `explain` (Learn, 2026-09-23) : « à toi d'expliquer », réponse libre puis
 * réponse modèle — à ne pas confondre avec le CHAMP `explain`, l'explication
 * d'une correction. convert.ts et export.ts lisent désormais cette
 * constante : une valeur ajoutée ici est acceptée des deux côtés.
 */
export const QUESTION_ROLES: readonly QuestionRole[] = ["pre", "read", "explain", "recall", "test"];

/**
 * Champs communs à toutes les variantes de question. La plupart sont
 * optionnels : le moteur les lit avec `||`/`??`/`?.` et tolère leur absence
 * (engine/cards.js explanationHtml, renderQuizPromptHtml, questionCardHtml).
 */
export interface QuestionBase {
	/** Identifiant stable optionnel ; sert d'ancre de section si non vide (engine/cards.js questionCardHtml). */
	id?: string;
	title?: string;
	/** Énoncé texte brut, rendu via sanitize.renderTextWithEmbeds (engine/cards.js renderQuizPromptHtml). */
	prompt?: string;
	/** Énoncé HTML pré-rendu, prioritaire sur `prompt` (engine/cards.js: q.promptHtml || q._promptHtml). */
	promptHtml?: string;
	/** Variante interne équivalente à promptHtml (fallback lu au même endroit). */
	_promptHtml?: string;
	/** L'indice : une chaîne (un niveau) ou un tableau de chaînes, du plus
	    léger au plus révélateur. Lu par `niveauxIndice` (src/quiz-hint.ts),
	    qui ignore une valeur invalide. */
	hint?: string | string[];
	/** Lets the ▶ button of a runnable block in this question's STATEMENT
	    (a fenced ```python/```c/```cpp in `prompt`) show once every hint
	    level has been revealed, instead of waiting for correction — for a
	    hard "find the bug" question whose own program is not the answer.
	    Ignored when `runInLastHintProbleme` (src/code-languages.ts) rejects
	    it: no runnable block, fewer than two hint levels, or a question
	    asking what the program prints (task 6, 2026-09-28). */
	runInLastHint?: boolean;
	/** Explication texte brut affichée après verrouillage (engine/cards.js explanationHtml). */
	explain?: string;
	/** Explication HTML pré-rendue, prioritaire sur `explain`. */
	explainHtml?: string;
	_explainHtml?: string;
	/** Contenu "Leçon" affiché en mode leçon (engine/cards.ts learnSection, engine/text-only.ts learningHtml). */
	lesson?: string;
	lessonHtml?: string;
	_lessonHtml?: string;
	/** Alias hérités du mode "learn", renommé "lesson" (task 0 du lot mode
	    leçon, 2026-08-31) : LUS en repli indéfiniment (engine/sanitizer.ts
	    renderLessonHtml) — un quiz partagé écrit avant le renommage doit
	    continuer de s'afficher — mais plus jamais ÉCRITS (editor/export.ts). */
	learn?: string;
	learnHtml?: string;
	_learnHtml?: string;
	resourceButton?: ResourceButton | null;
	/**
	 * SUPPORT DE COMPRÉHENSION — document à lire avant de répondre (texte,
	 * énoncé de cas, extrait de code, image `![[…]]`). Affiché en tête de carte,
	 * repliable, AVANT le titre de la question (engine/passage.ts).
	 *
	 * Partage : plusieurs questions portant le même `passageId` affichent le
	 * MÊME support — une seule d'entre elles a besoin de porter le texte, les
	 * autres n'écrivent que `passageId`. C'est le pattern d'un vrai sujet
	 * d'examen (un texte, N questions de compréhension dessus).
	 */
	passage?: string;
	/** Support HTML pré-rendu, prioritaire sur `passage` (même relation que promptHtml/prompt). */
	passageHtml?: string;
	_passageHtml?: string;
	/** Clé de partage du support entre questions ; absente ⇒ support privé à cette question. */
	passageId?: string;
	/** Titre affiché dans l'en-tête du support (défaut : libellé « Document » traduit). */
	passageTitle?: string;
	/**
	 * BOUCLE D'APPRENTISSAGE (mode "lesson") — numéro de tranche, à partir de 1.
	 * Absent ⇒ question de quiz ordinaire. Un bloc où AUCUNE question ne porte
	 * `slice` n'active pas la boucle : le mode lesson garde son comportement
	 * historique (section « Leçon » + bouton d'examen).
	 */
	slice?: number;
	/**
	 * Place de la question dans la boucle en 5 temps :
	 *   "pre"    — posée AVANT la lecture, support masqué, la tentative est le mécanisme ;
	 *   "recall" — restitution de mémoire, support masqué puis rouvert à la correction ;
	 *   "test"   — question ciblée d'après lecture, support rouvrable à la demande.
	 * Absent ⇒ traitée comme "test".
	 */
	role?: QuestionRole;
	/** Famille de notions CONFUSABLES (Learn et Practice) : les questions qui
	    la partagent s'entremêlent en révision (`ScheduledItem.topic`). */
	topic?: string;
	/** DROPPED (2026-09-28): a per-question countdown in seconds, once written
	    by the generator on automatisms. The engine never implemented it and it
	    was judged useless. Kept in the type because notes written before still
	    carry it: it is read, preserved on save (`_extraFields`), and ignored. */
	timeLimit?: number;
}

/** Question à choix unique (engine.js: multiSelect absent/false ⇒ q.correctIndex). */
export interface QcmQuestion extends QuestionBase {
	options: string[];
	/** HTML pré-rendu par option, prioritaire sur options[oi] (engine/cards.js optionContentHtml). */
	optionHtml?: string[];
	correctIndex: number;
	multiSelect?: false;
}

/** Question à choix multiples (engine.js: q.multiSelect === true ⇒ q.correctIndices). */
export interface MultiSelectQuestion extends QuestionBase {
	options: string[];
	optionHtml?: string[];
	correctIndices: number[];
	multiSelect: true;
}

/**
 * Question texte libre, y compris ses sous-formes terminal/commande (cmd,
 * powershell, bash…) et math (éditeur d'équations MathLive) : ce sont des
 * TextQuestion avec des champs optionnels supplémentaires, pas des variantes
 * séparées — engine/editor/export.js exporte toujours `type: 'text'` pour
 * ces sous-formes (cmd/powershell/bash/text).
 */
export interface TextQuestion extends QuestionBase {
	type: "text";
	placeholder?: string;
	caseSensitive?: boolean;
	/** Réponses acceptées — engine/terminal.js getTextAcceptedAnswers agrège ces 5 champs. */
	acceptedAnswers?: string[];
	acceptableAnswers?: string[];
	correctAnswers?: string[];
	correctText?: string;
	answer?: string;
	/** Question "math" : réponse saisie dans un éditeur d'équations MathLive (engine/math-input.js isMathQuestion). */
	mathInput?: boolean;
	/**
	 * RÉPONSE NUMÉRIQUE (engine/numeric.ts) — la réponse est un nombre, comparé
	 * en VALEUR et non en texte. Déclaré par l'auteur, jamais déduit : « 007 »
	 * est une chaîne, pas l'entier 7.
	 */
	numeric?: boolean;
	/** Marge absolue acceptée autour de la valeur attendue. */
	tolerance?: number;
	/** Marge relative acceptée, en pourcentage de la valeur attendue. */
	tolerancePercent?: number;
	/** Unité attendue (« m/s ») — acceptée en suffixe de la saisie, jamais exigée. */
	unit?: string;
	/** Gabarit guidé optionnel de l'éditeur math, ex. "x = ▯" (engine/terminal.js bindMathQuestion). */
	answerTemplate?: string;
	/** Variante terminal (engine/terminal.js getTerminalTextVariant, normalizeTerminalVariantName). */
	terminalVariant?: string;
	textVariant?: string;
	/**
	 * Formes IMBRIQUÉES alternatives lues en fallback par engine/terminal.ts
	 * (getTerminalTextVariant `q.text?.variant`/`q.terminal?.variant`,
	 * getTerminalPromptPrefix `q.terminal?.prefix`, getTextMaxLength
	 * `q.text?.maxLength`/`q.terminal?.maxLength`). Finding Task 3.
	 */
	text?: { variant?: string; maxLength?: number };
	terminal?: { variant?: string; prefix?: string; maxLength?: number };
	/** Marqueur legacy : force la variante "cmd" (engine/terminal.js getTerminalTextVariant). */
	command?: boolean;
	commandPrefix?: string;
	terminalPrefix?: string;
	promptPrefix?: string;
	maxLength?: number;
	textMaxLength?: number;
	commandMaxLength?: number;
	terminalMaxLength?: number;
	spellcheck?: boolean;
}

/**
 * TEXTE À TROUS (engine/cloze.ts). Le gabarit vit dans `cloze` : le texte
 * complet, chaque trou entre doubles accolades, variantes séparées par « | ».
 *   cloze: "La capitale est {{Paris}}, la monnaie {{l'euro|euro}}."
 * `prompt` reste la consigne ; c'est la PRÉSENCE de `cloze` qui discrimine la
 * variante (engine.ts isClozeQuestion).
 */
export interface ClozeQuestion extends QuestionBase {
	cloze: string;
	/** Comparaison sensible à la casse (défaut : non, comme les réponses libres). */
	caseSensitive?: boolean;
	/** The most characters each blank takes, one number per blank in reading
	    order, chosen by the generator (2026-09-29). Missing, invalid or
	    shorter than the blank's longest accepted answer: the engine's rule
	    applies instead (engine/cloze.ts, `blankMaxLength`). */
	blankMaxLengths?: number[];
}

/**
 * EXERCICE DE CODE EXÉCUTÉ (engine/code.ts, noyau src/code-exercise/). C'est
 * la PRÉSENCE de `language` qui discrimine la variante, comme `cloze`.
 * La sortie attendue n'est JAMAIS écrite : elle est calculée en exécutant
 * `solution` (spec 2026-09-23-exercice-python-design.md §1.2).
 */
export interface CodeQuestion extends QuestionBase {
	/** Seul "python" s'exécute ; une autre valeur s'affiche sans exécution. */
	language: string;
	/** Programme de référence. */
	solution?: string;
	/** Code placé dans l'éditeur au départ (écrire, compléter, corriger). */
	starter?: string;
	/** Entrée standard de chaque essai ; le premier est l'exemple montré. */
	inputs?: string[];
	/** Python exécuté APRÈS le code de l'élève ; passe s'il ne lève rien. */
	asserts?: string;
	/** Indices gradués ; `hint` (QuestionBase) sert de repli. */
	hints?: string[];
}

/**
 * CARTE MÉMOIRE (engine/text-only.ts, branche carte). Le recto est `prompt`,
 * le verso `answer` (champ déjà connu du format, réutilisé plutôt qu'un
 * `back` de plus). C'est la PRÉSENCE de `flashcard: true` qui discrimine la
 * variante, comme `cloze` ; `type` reste absent. On la retourne, puis on se
 * note « À revoir » / « Je savais » : la note passe par l'auto-évaluation.
 */
export interface FlashcardQuestion extends QuestionBase {
	flashcard: true;
	answer?: string;
}

/** Forme imbriquée alternative de `ordering`, lue en fallback (engine/questions.js: q?.ordering?.items/correctOrder/slotLabels). */
export interface OrderingConfig {
	items?: string[];
	correctOrder?: number[];
	slotLabels?: string[];
}

/**
 * Question de classement (glisser-déposer). L'éditeur/export n'écrit que la
 * forme plate `ordering: true` + `slots`/`possibilities`/`correctOrder`
 * (editor/export.js:34-39) ; la forme imbriquée `ordering: { items, ... }`
 * est un fallback supporté par le moteur (engine/questions.js) pour des
 * quiz écrits à la main.
 */
export interface OrderingQuestion extends QuestionBase {
	ordering: true | OrderingConfig;
	/** Éléments à ordonner (forme plate). */
	possibilities?: string[];
	orderingItems?: string[];
	/** Fallback historique : `options` peut aussi servir de source d'items (engine/questions.js getOrderingItems). */
	options?: string[];
	/** Ordre correct, indices dans `possibilities` (forme plate). */
	correctOrder?: number[];
	/** Libellés des emplacements (forme plate). */
	slots?: string[];
	slotLabels?: string[];
}

/** Forme imbriquée alternative de `matching`, lue en fallback (engine/questions.js: q?.matching?.rows/choices/correctMap). */
export interface MatchingConfig {
	rows?: string[];
	choices?: string[];
	correctMap?: number[];
}

/**
 * Question d'association (glisser-déposer). Même relation forme plate vs
 * imbriquée qu'OrderingQuestion (editor/export.js:40-45 n'écrit que la forme
 * plate `matching: true` + `rows`/`choices`/`correctMap`).
 */
export interface MatchingQuestion extends QuestionBase {
	matching: true | MatchingConfig;
	rows?: string[];
	choices?: string[];
	correctMap?: number[];
}

/**
 * Union discriminée des variantes de question. Le moteur ne discrimine pas
 * par un tag commun mais par présence de champs / prédicats dédiés
 * (engine.js:85-87) :
 *   - isOrderingQuestion(q) = q.ordering === true || typeof q.ordering === "object"
 *   - isMatchingQuestion(q) = q.matching === true || typeof q.matching === "object"
 *   - isTextQuestion(q)     = q.type === "text" (seule forme réellement produite)
 *   - sinon : QCM, discriminé par `multiSelect` (true ⇒ MultiSelectQuestion).
 */
export type QuizQuestion =
	| QcmQuestion
	| MultiSelectQuestion
	| TextQuestion
	| ClozeQuestion
	| CodeQuestion
	| FlashcardQuestion
	| OrderingQuestion
	| MatchingQuestion;

/** Mode d'entraînement courant (engine/state.js setPracticeMode). */
export type PracticeMode = "qcm" | "text";

/** Auto-évaluation en mode entraînement texte libre (engine/text-only.js RATINGS). */
export type TextOnlyRating = "understood" | "partial" | "review";

/** How a Learn question stands in the retry loop (engine/learn-loop.ts):
    never checked, right the first time, right after a miss, or not right
    yet (or given up after three retries). */
export type LearnVerdict = "none" | "first" | "retried" | "missed";

/** A missed Learn question waiting for its retry, and how many OTHER
    questions have been checked since it was missed. */
export interface LearnQueueEntry {
	qi: number;
	since: number;
}

/** Where the normal order resumes once the pending retries are done: a
    question index, `"end"` (past the last question), or `null` when the
    learner is not away on a retry. */
export type LearnResume = number | "end" | null;

/**
 * Sélection courante pour une question, selon sa variante
 * (engine.js initSelections) :
 *   - TextQuestion            → string (réponse libre saisie, "" au départ)
 *   - ClozeQuestion           → string[] (une saisie par trou, "" au départ)
 *   - OrderingQuestion/
 *     MatchingQuestion        → Array<number | null> (slot → index original, ou vide)
 *   - MultiSelectQuestion     → Set<number> (indices sélectionnés)
 *   - QcmQuestion             → number | null (index sélectionné, ou aucune réponse)
 *
 * Deux variantes tableau cohabitent (string[] et Array<number | null>) : elles
 * ne sont jamais confondues au runtime parce que la lecture est toujours gardée
 * par le PRÉDICAT DE QUESTION (isClozeQuestion, isOrderingQuestion…), jamais par
 * la forme de la sélection.
 */
export type QuestionSelection =
	| string
	| string[]
	| Array<number | null>
	| Set<number>
	| number
	| null;

/**
 * Ordre d'affichage mélangé pour une question (engine.js buildShuffleMap) :
 *   - TextQuestion                          → null (rien à mélanger)
 *   - QcmQuestion/MultiSelectQuestion/
 *     OrderingQuestion                      → number[] (indices mélangés)
 *   - MatchingQuestion                      → { rows: number[]; choices: number[] }
 */
export type QuestionShuffleEntry =
	| number[]
	| { rows: number[]; choices: number[] }
	| null;

/**
 * État runtime complet d'une instance de quiz (engine.js: littéral `quizState`,
 * lignes 275-292, plus mutations dans engine/state.js resetQuiz et
 * engine/interactions.js pour orderingPick/matchPick).
 */
export interface QuizState {
	practiceMode: PracticeMode;
	selections: QuestionSelection[];
	/** Réponses libres saisies en mode entraînement texte (engine/text-only.js hasAnyAnswer). */
	textOnlyAnswers: string[];
	/** Question validée ("Vérifier" cliqué) en mode entraînement texte (engine/text-only.js isChecked). */
	textOnlyChecked: boolean[];
	/** Auto-évaluation par question en mode entraînement texte (engine/text-only.js isRated/computeResults). */
	textOnlyRatings: Array<TextOnlyRating | null>;
	current: number;
	prevCurrent: number;
	lastQuestionIndex: number;
	locked: boolean;
	pendingResultsLock: boolean;
	/** La session a DÉJÀ été comptée dans les statistiques. Sans ce drapeau,
	    un double clic sur « Voir le score » comptait deux tentatives pour une
	    seule session (engine/state.ts goToResults). Remis à faux par
	    `resetQuiz`, qui recommence bien une session. */
	resultsCounted: boolean;
	/** The automatic save of this attempt's results (src/results-files.ts). */
	resultsSave: ResultsSaveState;
	shuffleMap: QuestionShuffleEntry[];
	/** Élément en cours de sélection pour glisser-déposer, question de classement (engine/interactions.js). */
	orderingPick: Array<number | null>;
	/** Élément en cours de sélection pour glisser-déposer, question d'association (engine/interactions.js). */
	matchPick: Array<number | null>;
	isSliding: boolean;
	/** Set by a committed finger swipe: the next slide animation takes this many ms, on the decelerate curve (consumed once). */
	swipeSettleMs?: number | null;
	slideToken: number;
	/**
	 * Task 7, mode Lesson : une question `role: "pre"` marquée « Je ne sais pas »
	 * (engine/interactions.ts). Distinct de `selections`/`textOnlyAnswers` — la
	 * tentative y est explicitement VIDE, ce que ces tableaux ne peuvent pas
	 * représenter sans y écrire une valeur sentinelle qui s'afficherait comme
	 * une vraie réponse. Ne compte QUE pour débloquer la navigation vers
	 * l'avant (state.ts) ; une carte ainsi marquée reste "sans réponse" pour
	 * `hasAnyAnswer`/`isComplete`, les statistiques et l'écran de soumission —
	 * c'est la seule concession du brief, elle ne doit pas se propager ailleurs.
	 */
	lessonPreSkipped: boolean[];
	/**
	 * L'indice de la question a été RÉVÉLÉ (2026-09-26) : il reste affiché
	 * sous la question, et le bouton d'aide passe au cran suivant
	 * (« Je ne sais pas » sur une pré-question, rien sinon). Un seul bouton
	 * d'aide à la fois, sans rien perdre : l'indice se relit sur place.
	 */
	hintSeen: boolean[];
	/**
	 * Questions ALREADY logged for the scheduler during this session.
	 *
	 * In a Learn a self-assessment logs at once (the verdict exists); the
	 * results log everything else. In a Test everything is logged at
	 * hand-in (engine/state.ts recordReview). Without this flag, a question
	 * rated by hand would be counted twice, and its second entry would grow
	 * its interval a few seconds apart. Reset by `resetQuiz`, like
	 * `resultsCounted`.
	 */
	recorded: boolean[];
	/* THE LEARN RETRY LOOP (engine/learn-loop.ts, 2026-09-29): each question
	   of a Learn is checked on its card, a missed one comes back later. Reset
	   by `resetQuiz`, kept in the session snapshot. */
	learnVerdicts: LearnVerdict[];
	/** Misses per question in this session, the first one included. */
	learnMisses: number[];
	/** The question is being retried: its answer was cleared, it is open. */
	learnRetrying: boolean[];
	/** The CURRENT attempt has been checked: its card shows the correction. */
	learnChecked: boolean[];
	/** Checked and showing its model answer, waiting for the learner's own
	    verdict (a written answer). */
	learnPending: boolean[];
	learnQueue: LearnQueueEntry[];
	learnResume: LearnResume;
	/** The retried question the resume point belongs to: leaving another
	    way (a bead, the previous arrow) drops the resume point. */
	learnRetryQi: number | null;
}

/**
 * Entrée de la carte des slides (engine.js buildSlideMap) : une slide par
 * question, puis une slide "submit" et une slide "results". Discriminée par
 * `type`, seul `questionIndex` est propre à la variante "question"
 * (engine.js isQuestionSlideIndex/isSubmitSlideIndex/isResultsSlideIndex
 * narrowent sur `slideMap[i]?.type`).
 */
export type SlideMapEntry =
	// `step`: a step-page Learn's slide (engine/step-page.ts), whose
	// `questionIndex` is the FIRST card of the page.
	| { type: "question"; questionIndex: number; step?: StepSlide }
	| { type: "submit" }
	| { type: "results" };

/**
 * Options of an active Exam (ctx.examOptions), built by quiz-utils.ts
 * extractExamOptions and read by engine/exam.ts (examTimerHtml,
 * startExamTimer). An Exam is a visible clock and a hand-in at zero: the
 * `autoSubmit` / `showTimer` options left on 2026-09-29.
 */
export interface ExamOptions {
	/** Duration in minutes, within [1, 300] (quiz-utils.ts clampExamDuration). */
	durationMinutes: number;
}

/**
 * Score courant du quiz (engine/state.js computeScorePercent — forme exacte
 * du littéral retourné, `{ pct, correct, total }`).
 */
export interface QuizResult {
	pct: number;
	correct: number;
	total: number;
	/** Réponses écrites (recall à choix, hors carte mémoire) pas encore
	    auto-évaluées à l'écran des résultats — ni comptées justes ni fausses,
	    donc exclues de `correct`/`total` (engine/state.ts computeScorePercent). */
	pendingWritten: number;
}

/**
 * Enregistrement de stats persisté par quiz (engine/state.js goToResults,
 * appel à statsStore.updateRecord avec exactement ces trois champs).
 */
export interface StatsRecord {
	bestScore: number;
	questionsDone: number;
	totalQuestions: number;
	/** Quiz à réponses libres seulement : pas de pourcentage (tentative `pct: null`). */
	texteLibre?: boolean;
	/** A Test's right answers that used a hint (spec 2026-09-29 §2.2), kept
	    on its attempt; absent when there are none. */
	withHint?: number;
	/** The attempt was played in Exam mode (hints off AND a time limit, spec
	    2026-09-29-test-setup-modal-design.md §3); absent otherwise and for a
	    host that asks for no setup. */
	exam?: boolean;
	/** The results file saved for this attempt (src/results-files.ts). */
	results?: string;
}

/** Where the automatic save of a finished quiz's results stands. */
export interface ResultsSaveState {
	/** Grows at each hand-in and each "Start over". */
	attempt: number;
	status: "none" | "pending" | "saving" | "saved" | "failed" | "deleting" | "deleted";
	/** The results file of this attempt, decided at hand-in. */
	path: string | null;
	/** The date of the history attempt recorded at the same hand-in. */
	attemptDate: number | null;
	/** The reason of the last failure. */
	error: string | null;
}

/**
 * A raw question as read from the JSON5 (parseQuizSource), or the block's
 * configuration object. Deliberately permissive shape (index signature): the
 * import reads heterogeneous fields and keeps unknown keys (_extraFields).
 */
export interface ParsedQuizItem {
	[key: string]: unknown;
	/** The block's mode: "learn" | "exam" | "quiz" (quiz-utils.ts
	    normalizeQuizMode). Marker of the configuration object. The retired
	    `examMode`, `learnMode`, `examAutoSubmit` and `examShowTimer` keys are
	    no longer read (2026-09-29). */
	mode?: string;
	/** An Exam's duration in minutes, within [1, 300]. */
	examDurationMinutes?: number;
	/** The block's glossary, on the CONFIGURATION object only (batch D,
	    2026-09-27) — raw, read by `lireGlossaire` (src/glossaire.ts), which
	    filters out invalid entries; its mere presence (even an empty array)
	    is enough to tell a configuration without `mode` apart
	    (quiz-utils.ts isQuizModeConfig). */
	glossary?: unknown;
	ordering?: unknown;
	matching?: unknown;
	multiSelect?: boolean;
	type?: string;
	terminalVariant?: string;
	textVariant?: string;
	id?: string;
	title?: string;
	hint?: string | string[];
	/** See `QuestionBase.runInLastHint` (src/types/quiz.ts) — same field, raw
	    JSON5 shape. */
	runInLastHint?: boolean;
	prompt?: string;
	promptHtml?: string;
	explain?: string;
	explainHtml?: string;
	/** Contenu "Leçon" (mode "lesson", renommé depuis "learn") — nom canonique. */
	lesson?: string;
	lessonHtml?: string;
	_lessonHtml?: string;
	/** Alias hérités de "learn" : lus en repli par editor/convert.ts, jamais
	    réécrits (editor/export.ts). */
	learn?: string;
	learnHtml?: string;
	_learnHtml?: string;
	resourceButton?: ResourceButton;
	options?: string[];
	correctIndex?: number;
	correctIndices?: number[];
	slots?: string[];
	possibilities?: string[];
	correctOrder?: number[];
	rows?: string[];
	choices?: string[];
	correctMap?: number[];
	/** Gabarit du texte à trous (engine/cloze.ts). */
	cloze?: string;
	/** Carte mémoire (engine/…) : `true` discrimine, le verso vit dans `answer`. */
	flashcard?: boolean;
	/** Réponse numérique et ses marges (engine/numeric.ts). */
	numeric?: boolean;
	tolerance?: number;
	tolerancePercent?: number;
	unit?: string;
	/** Boucle d'apprentissage (mode "lesson", task 1 du lot mode leçon,
	    2026-08-31) — cf. types/quiz.ts QuestionBase.slice/.role. Type large
	    (`string`, pas `QuestionRole`) : c'est la forme BRUTE lue dans la note,
	    pas encore validée — cette étape a lieu à l'écriture (editor/export.ts). */
	slice?: number;
	role?: string;
	acceptedAnswers?: string[];
	acceptableAnswers?: string[];
	correctText?: unknown;
	answer?: unknown;
	caseSensitive?: boolean;
	placeholder?: string;
	commandPrefix?: string;
}
