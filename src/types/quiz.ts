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
	/** Texte de l'indice, affiche le bouton "Indice" si non vide (engine/cards.js questionCardHtml). */
	hint?: string;
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
	/** Compte à rebours en SECONDES, posé par l'IA sur les seuls automatismes.
	    À l'échéance : réponse + explication, et la question revient comme une
	    erreur (plan 2). */
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
	| FlashcardQuestion
	| OrderingQuestion
	| MatchingQuestion;

/** Mode d'entraînement courant (engine/state.js setPracticeMode). */
export type PracticeMode = "qcm" | "text";

/** Auto-évaluation en mode entraînement texte libre (engine/text-only.js RATINGS). */
export type TextOnlyRating = "understood" | "partial" | "review";

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
	/**
	 * Le choix de l'écran de démarrage d'un bloc `mode: "exam"` : APPRENDRE
	 * (sans chrono ni verrou, correction et explication après chaque réponse)
	 * ou se TESTER (l'examen). Décision d'Ahmed, 2026-09-17 : « Practice »
	 * (les réponses en texte libre) est RETIRÉ — un quiz a deux façons de se
	 * jouer, et cette valeur ne touche PAS `practiceMode`, qui ne sert plus
	 * qu'au rôle `recall` d'une leçon.
	 */
	startMode: "learn" | "exam";
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
	savedResultsPath: string | null;
	shuffleMap: QuestionShuffleEntry[];
	/** Élément en cours de sélection pour glisser-déposer, question de classement (engine/interactions.js). */
	orderingPick: Array<number | null>;
	/** Élément en cours de sélection pour glisser-déposer, question d'association (engine/interactions.js). */
	matchPick: Array<number | null>;
	isSliding: boolean;
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
	 * Questions DÉJÀ journalisées pour l'ordonnanceur pendant cette session.
	 *
	 * Une auto-évaluation journalise immédiatement (le verdict existe) ;
	 * la soumission journalise tout le reste. Sans ce drapeau, une question
	 * notée à la main serait comptée deux fois, et sa seconde entrée
	 * ferait croître son intervalle à quelques secondes d'intervalle.
	 * Remis à zéro par `resetQuiz`, comme `resultsCounted`.
	 */
	recorded: boolean[];
}

/**
 * Entrée de la carte des slides (engine.js buildSlideMap) : une slide par
 * question, puis une slide "submit" et une slide "results". Discriminée par
 * `type`, seul `questionIndex` est propre à la variante "question"
 * (engine.js isQuestionSlideIndex/isSubmitSlideIndex/isResultsSlideIndex
 * narrowent sur `slideMap[i]?.type`).
 */
export type SlideMapEntry =
	| { type: "question"; questionIndex: number }
	| { type: "submit" }
	| { type: "results" };

/**
 * Options d'examen actives (ctx.examOptions), construites par
 * quiz-utils.js extractExamOptions/buildExamOpts et lues dans engine/exam.js
 * (examTimerHtml, handleExamTimeUp).
 */
export interface ExamOptions {
	/** Durée en minutes, bornée [1, 180] au parsing (quiz-utils.js buildExamOpts). */
	durationMinutes: number;
	/** Soumission automatique à l'échéance du chrono (par défaut true — engine/exam.js handleExamTimeUp). */
	autoSubmit: boolean;
	/** Afficher le chrono à l'écran (engine/exam.js examTimerHtml). */
	showTimer: boolean;
}

/**
 * Score courant du quiz (engine/state.js computeScorePercent — forme exacte
 * du littéral retourné, `{ pct, correct, total }`).
 */
export interface QuizResult {
	pct: number;
	correct: number;
	total: number;
}

/**
 * Enregistrement de stats persisté par quiz (engine/state.js goToResults,
 * appel à statsStore.updateRecord avec exactement ces trois champs).
 */
export interface StatsRecord {
	bestScore: number;
	questionsDone: number;
	totalQuestions: number;
}

/**
 * Question brute telle que lue du JSON5 (parseQuizSource) ou d'un marqueur
 * mode-examen. Forme volontairement permissive (index signature) : l'import
 * lit des champs hétérogènes et préserve les clés inconnues (_extraFields).
 */
export interface ParsedQuizItem {
	[key: string]: unknown;
	examMode?: boolean;
	/** Raccourci hérité de `mode: "learn"` (renommé "lesson", quiz-utils.ts) —
	    lu en repli, jamais écrit : aucun raccourci équivalent pour "lesson". */
	learnMode?: boolean;
	/** Mode du bloc : « quiz » | « lesson » | « exam » (ou l'alias hérité
	    « learn », lu en repli). Marqueur de l'objet de configuration. */
	mode?: string;
	examDurationMinutes?: number;
	examAutoSubmit?: boolean;
	examShowTimer?: boolean;
	ordering?: unknown;
	matching?: unknown;
	multiSelect?: boolean;
	type?: string;
	terminalVariant?: string;
	textVariant?: string;
	id?: string;
	title?: string;
	hint?: string;
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
