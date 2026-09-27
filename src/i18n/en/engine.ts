/* Domaine « engine » — anglais, dictionnaire de RÉFÉRENCE.
   Toute clé ajoutée ici doit l'être aussi dans i18n/fr/engine.ts (le typage de
   FR_ENGINE l'impose). Clés préfixées « engine. » : un domaine ne marche jamais
   sur les clés d'un autre.

   Ne contient QUE des libellés visibles par l'élève (boutons, résultats, examen,
   aria-label, Notice). Les clés du format quiz (title, prompt, options, answer,
   « single »/« text »/« exam »…) sont des DONNÉES du .md : elles ne passent
   jamais par ici.

   Pluriels : deux clés `.one` / `.other` choisies dans le code (jamais un « s »
   concaténé — français et anglais ne s'accordent pas pareil). */
export const EN_ENGINE = {
	/* ── Erreurs du bloc ── */
	"engine.error.noQuestions": "⚠️ No questions were given to the quiz engine.",

	/* ── Texte à trous ── */
	"engine.cloze.instructions": "Fill in the {count} blanks",
	"engine.cloze.blankAria": "Blank {n}",

	/* ── Support de compréhension (document lu avant de répondre) ── */
	"engine.passage.defaultTitle": "Document",
	"engine.passage.scopeRange": "questions {first} to {last}",
	"engine.passage.scopeCount": "{count} questions",
	"engine.passage.collapse": "Hide the document",
	"engine.passage.expand": "Show the document",

	/* ── Styles de lecture d'un cours (engine/lecture-rendu.ts) ── */
	"engine.lecture.keyPoints": "Key points",
	"engine.lecture.flipHint": "Click a card, or press Enter, to flip it.",
	"engine.lecture.flipAria": "{front}: flip the card",
	"engine.lecture.flippedAria": "{front}: {back}",

	/* ── Navigation ── */
	"engine.nav.results": "Results",
	"engine.nav.prevQuestion": "Previous question",
	"engine.nav.nextQuestion": "Next question",

	/* ── Bascule de mode ──
	   Le bouton "Practice mode" (et les cles switchOn/switchOff qui lui
	   servaient d’aria-label) a disparu le 2026-08-31 (Task 5, lot mode lecon) :
	   sa mecanique est absorbee par le role "recall" en mode Lecon. FINDING 3
	   (round 1 de revue Task 5) : le code qui lisait ces deux cles
	   (engine/interactions.ts, bindModeToggleControls/applyModeToggleVisualState)
	   a ete retire avec le bouton, donc les cles aussi - retirees des DEUX
	   dictionnaires ensemble (le typage FR sur EN_ENGINE l’impose). */

	/* ── Écran de démarrage (choix du mode) ── */
	"engine.start.selectorAria": "Choose the quiz mode",
	"engine.start.examTitle": "Exam",
	"engine.start.examSub": "Timed multiple choice",
	"engine.start.learnTitle": "Learn",
	"engine.start.learnSub": "No timer, corrected after each answer",

	/* ── Mode examen ── */
	/* L'écran de départ d'un quiz CHRONOMÉTRÉ : il annonce le chrono, sans choix. */
	"engine.exam.timedTitle": "Timed quiz",
	"engine.exam.start": "Start",
	"engine.exam.startExam": "Start the exam",
	"engine.exam.startLearn": "Start learning",
	"engine.exam.noTimer": "No timer",
	"engine.exam.duration.one": "Duration: {minutes} minute",
	"engine.exam.duration.other": "Duration: {minutes} minutes",
	"engine.exam.questionCount.one": "{count} question",
	"engine.exam.questionCount.other": "{count} questions",
	"engine.exam.finish": "Finish the exam",
	"engine.exam.timeUpManual": "Time's up! Finish and submit your exam.",
	"engine.exam.timeUpLocked": "Time's up! The quiz has been locked.",

	/* ── Questions à choix ── */
	"engine.qcm.multiHint": "Select one or more answers",

	/* ── Questions « ordering » ── */
	"engine.ordering.instructions": "Put the items in the right order (drag and drop). Drop an item on a filled slot to swap the two positions automatically.",
	"engine.ordering.dropHere": "Drag an item here",
	"engine.ordering.itemsLabel": "Items to place",

	/* ── Questions « matching » ── */
	"engine.matching.instructions": "Match each item with an option (drag and drop). The same option can be used more than once.",
	"engine.matching.dropHere": "Drop an option here",
	"engine.matching.choicesLabel": "Available options",
	"engine.matching.unknownChoice": "Unknown option",

	/* ── Indice ── */
	"engine.hint.button": "Hint",
	/* Un indice à plusieurs niveaux (2026-09-26) : révéler le suivant, et
	   le libellé de chaque niveau affiché. */
	"engine.hint.next": "Next hint",
	"engine.hint.level": "Hint {n} of {total}",
	"engine.hint.title": "Hint",
	"engine.hint.close": "Close",

	/* ── Mode leçon ── */
	"engine.lesson.label": "Lesson",
	/* Le rôle d'une question de Learn, en tête de carte. Plus de « Slice N of
	   M » au-dessus (2026-09-23) : les étapes d'un Learn ne se montrent pas. */
	"engine.lesson.roleExplain": "In your own words",
	"engine.lesson.rolePre": "Before reading",
	"engine.lesson.roleRead": "Reading",
	"engine.lesson.roleRecall": "From memory",
	/* Task 7 : la pré-question ne peut pas être sautée sans tentative explicite. */
	"engine.lesson.dontKnow": "I don't know",

	/* ── Question texte / terminal ── */
	"engine.text.placeholder": "Your answer...",

	/* ── Mode entraînement (réponse libre) ── */
	"engine.textOnly.answerLabel": "Your own answer",
	"engine.textOnly.answerPlaceholder": "Write your answer in your own words...",
	"engine.textOnly.explanationLabel": "Explanation",
	"engine.textOnly.noExpectedAnswer": "No expected answer was provided.",
	"engine.textOnly.noAnswerGiven": "No answer given.",
	"engine.textOnly.writtenQuestionNumber": "Q{n}",
	"engine.textOnly.verdict.right": "I got it right",
	"engine.textOnly.verdict.wrong": "I got it wrong",

	/* ── Auto-évaluation ── */
	"engine.rating.understood": "Got it",
	"engine.rating.partial": "Partly",
	"engine.rating.review": "To review",

	/* ── Carte mémoire ── */
	"engine.flashcard.flip": "Flip",
	"engine.flashcard.flipHint": "Space",
	"engine.flashcard.back": "Answer",
	"engine.flashcard.again": "Review again",
	"engine.flashcard.knew": "I knew it",
	"engine.flashcard.missingAnswer": "No answer on the back of this card.",

	/* ── Slide de soumission ── */
	"engine.submit.back": "Back",
	"engine.submit.showScore": "See the score",
	"engine.submit.showResults": "See the results",
	"engine.submit.reviewList": "Go back to a question:",
	"engine.submit.missingList": "Unanswered questions:",
	"engine.submit.missingAnswers.one": "{count} answer is missing.",
	"engine.submit.missingAnswers.other": "{count} answers are missing.",
	"engine.submit.missingFreeAnswers.one": "{count} free-text answer is missing.",
	"engine.submit.missingFreeAnswers.other": "{count} free-text answers are missing.",
	"engine.submit.allFreeAnswered": "Every question has a free-text answer.",
	"engine.submit.missingRatings.one": "{count} self-assessment is missing.",
	"engine.submit.missingRatings.other": "{count} self-assessments are missing.",
	"engine.submit.toRateList": "Questions to assess:",
	"engine.submit.allRated": "Every question has been assessed.",

	/* ── Slide de résultats ── */
	"engine.result.title": "Results",
	"engine.result.trainingTitle": "Practice results",
	"engine.result.freeTextCorrection": "Free-text review",
	"engine.result.correctionHint": "Go back through the questions to compare your answers, read the explanations and assess yourself.",
	"engine.result.reviewAnswers": "Review my answers",
	"engine.result.ratedLabel": "Self-assessed:",
	"engine.result.correctLabel": "Correct answers:",
	"engine.result.pending.one": "Not assessed",
	"engine.result.pending.other": "Not assessed",
	"engine.result.pendingWritten.one": "{count} written answer is not self-assessed yet — it doesn't count in the score.",
	"engine.result.pendingWritten.other": "{count} written answers are not self-assessed yet — they don't count in the score.",
	"engine.result.retry": "Start over",
	"engine.result.takeExam": "Take the exam",
	"engine.result.retakeExam": "Retake the exam",

	/* ── Sauvegarde des résultats ── */
	"engine.result.save": "Save my results",
	"engine.result.saved": "Results saved",
	"engine.result.saving": "Saving...",
	"engine.result.savedIn": "Saved to {path}",
	"engine.result.savedNotice": "Results saved: {path}",
	"engine.result.saveError": "Could not save the results: {message}",
	"engine.result.unknownError": "unknown error",

	/* ── Bouton ressource (pièce jointe) ── */
	"engine.resource.missingName": "Missing file name.",
	"engine.resource.notFound": "File not found in the vault: {name}",
	"engine.resource.duplicate": "Several files are named {name}. Using the first match.",
	"engine.resource.openedDefaultApp": "Opening with the default app: {name}",
	"engine.resource.openedAndroid": "Opening with the Android system: {name}",
	"engine.resource.noDefaultApp": "File found, but no default app is available for: {name}",
	"engine.resource.openFailed": "Could not reveal or open the file: {name}",
	"engine.resource.openError": "Something went wrong while opening the file.",

	/* ── Clavier mathématique (MathLive) ── */
	"engine.math.closeKeyboard": "Close the keyboard",
	"engine.math.matrixTab": "Matrices and structures",
	"engine.math.matrix2x2Paren": "2×2 matrix (parentheses)",
	"engine.math.matrix3x3Paren": "3×3 matrix (parentheses)",
	"engine.math.matrix2x2Bracket": "2×2 matrix (brackets)",
	"engine.math.determinant2x2": "2×2 determinant",
	"engine.math.equationSystem": "System of equations",
	"engine.math.vector": "Vector",
	"engine.math.overline": "Overline (conjugate / mean)",
	"engine.math.addRow": "Add a row to the matrix",
	"engine.math.addColumn": "Add a column to the matrix",
} as const;
