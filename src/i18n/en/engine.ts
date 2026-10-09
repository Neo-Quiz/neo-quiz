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
	"engine.cloze.blankAria": "Blank {n}",

	/* ── Support de compréhension (document lu avant de répondre) ── */
	"engine.passage.defaultTitle": "Document",
	"engine.passage.scopeRange": "questions {first} to {last}",
	"engine.passage.scopeCount": "{count} questions",
	"engine.passage.collapse": "Hide the document",
	"engine.image.zoomIn": "Zoom in",
	"engine.image.zoomOut": "Zoom out",
	"engine.image.fit": "Fit to the window",
	"engine.image.actualSize": "Real size",
	"engine.image.viewer": "Picture",
	"engine.passage.expand": "Show the document",

	/* ── Styles de lecture d'un cours (engine/lecture-rendu.ts) ── */
	"engine.lecture.keyPoints": "Key points",
	"engine.lecture.source": "Source: {source}",
	"engine.lecture.flipHint": "Click a card, or press Enter, to flip it.",
	"engine.lecture.flipAria": "{front}: flip the card",
	"engine.lecture.flippedAria": "{front}: {back}",

	/* ── Navigation ── */
	"engine.nav.results": "Results",
	"engine.nav.finish": "Finish",
	"engine.nav.prevQuestion": "Previous question",
	"engine.nav.nextQuestion": "Next question",
	"engine.nav.tab": "Question {n}",
	"engine.nav.tabCorrect": "Question {n}, right",
	"engine.nav.tabRetried": "Question {n}, right after a retry",
	"engine.nav.tabWrong": "Question {n}, wrong",
	"engine.nav.tabUnanswered": "Question {n}, unanswered",
	"engine.nav.tabAnswered": "Question {n}, answered",
	"engine.nav.tabWithHint": "{label}, with hint",

	/* ── Exam ── */
	/* The start screen of a TIMED quiz: it announces the clock, nothing to
	   choose (the Learn | Exam choice left on 2026-09-24, its keys on
	   2026-09-29). */
	"engine.exam.timedTitle": "Exam",
	"engine.exam.start": "Start",
	"engine.exam.duration.one": "Duration: {minutes} minute",
	"engine.exam.duration.other": "Duration: {minutes} minutes",
	"engine.exam.questionCount.one": "{count} question",
	"engine.exam.questionCount.other": "{count} questions",
	"engine.exam.finish": "Finish the exam",

	/* ── "Set up your test" (engine/test-setup-modal.ts). Learn and Test are
	   TYPES of quiz; "Exam mode" is how a Test is taken. ── */
	"engine.testSetup.title": "Set up your test",
	"engine.testSetup.examMode": "Exam mode",
	"engine.testSetup.examModeHelp": "No hints, and a time limit.",
	"engine.testSetup.keepExam": "Keep exam mode",
	"engine.testSetup.hints": "Hints",
	"engine.testSetup.timeLimit": "Time limit",
	"engine.testSetup.less": "Less time",
	"engine.testSetup.more": "More time",
	"engine.testSetup.minutesUnit": "min",
	"engine.testSetup.start": "Start the test",
	"engine.testSetup.examLocked": "Set by exam mode",

	/* ── Handing in a Test (engine/hand-in.ts) ── */
	"engine.handIn.button": "Hand in the test",
	"engine.handIn.unanswered.one": "{count} question unanswered",
	"engine.handIn.unanswered.other": "{count} questions unanswered",
	"engine.handIn.confirmSub": "Hand in anyway? An unanswered question counts as wrong.",
	"engine.handIn.confirm": "Hand in",
	"engine.handIn.keepAnswering": "Keep answering",
	"engine.exam.timeUp": "Time is up: the exam has been handed in.",

	/* ── Questions à choix ── */
	"engine.qcm.multiHint": "Select one or more answers",

	/* ── Questions « ordering » ── */
	"engine.ordering.instructions": "Drag each item into its place, or click an item then a slot. Dropping on a filled slot swaps the two.",
	"engine.ordering.dropHere": "Drag an item here",
	"engine.ordering.itemsLabel": "Items to place",

	/* ── Questions « matching » ── */
	"engine.matching.instructions": "Drag an option onto each item, or click an option then an item. An option can be used more than once.",
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
	/* The Learn retry loop (engine/learn.ts, 2026-09-29): each question is
	   checked on its card, a missed one comes back later. */
	"engine.learn.check": "Check",
	"engine.learn.nextStep": "Next step",
	"engine.learn.showAnswer": "Show the answer",
	"engine.learn.retryNote": "You missed this one earlier: try again.",
	"engine.learn.summaryFirst": "Right the first time",
	"engine.learn.summaryRetried": "Right after a retry",
	"engine.learn.summaryMissed": "To review",
	"engine.learn.rateTitle": "Was your answer right?",
	"engine.learn.feedbackRight": "Well done",
	"engine.learn.summaryTitle": "Your summary",
	"engine.learn.summaryAccuracy": "Accuracy",
	"engine.learn.summaryTime": "Time",
	"engine.learn.summaryLearned": "{learned}/{total} learned",
	"engine.learn.done": "Done",
	"engine.step.questionTitle": "Question {n}:",
	"engine.step.questionBare": "Question {n}",
	"engine.step.answerLabel": "Answer",

	/* ── Question texte / terminal ── */
	"engine.text.placeholder": "Your answer...",
	/* Variante terminal qui n'est PAS une vraie invite de commande (retour #2,
	   2026-09-26 soir) : le champ devient un bloc de code éditable, avec ce
	   libellé au-dessus au lieu d'une invite « C:\> ». */
	"engine.terminal.programOutputLabel": "Program output…",
	"engine.terminal.window.cmd": "Command Prompt",
	"engine.terminal.window.powershell": "Windows PowerShell",
	"engine.terminal.window.bash": "bash",

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
	"engine.flashcard.front": "Question",
	"engine.flashcard.flipTip": "Click the card or press",
	"engine.flashcard.showQuestion": "Turn the card over to see the question",
	"engine.flashcard.showAnswer": "Turn the card over to see the answer",
	"engine.flashcard.back": "Answer",
	"engine.flashcard.again": "Review again",
	"engine.flashcard.knew": "I knew it",
	"engine.flashcard.missingAnswer": "No answer on the back of this card.",

	/* ── Slide de soumission ── */
	"engine.submit.back": "Back",
	"engine.submit.showScore": "See the score",
	"engine.submit.showResults": "See the results",
	"engine.submit.reviewList": "Go back to a question",
	"engine.submit.missingList": "Unanswered",
	"engine.submit.missingAnswers.one": "{count} question left unanswered",
	"engine.submit.missingAnswers.other": "{count} questions left unanswered",
	"engine.submit.missingFreeAnswers.one": "{count} question left without an answer",
	"engine.submit.missingFreeAnswers.other": "{count} questions left without an answer",
	"engine.submit.allFreeAnswered": "Every question has an answer",
	"engine.submit.missingRatings.one": "{count} question left to assess",
	"engine.submit.missingRatings.other": "{count} questions left to assess",
	"engine.submit.toRateList": "To assess",
	"engine.submit.allRated": "Every question has been assessed",
	"engine.submit.allAnswered": "Every question has an answer",
	"engine.submit.missingSub": "You can still go back to them before finishing.",
	"engine.submit.completeSub": "You can go over a question again before finishing.",
	"engine.submit.progress": "{done} / {total} answered",
	"engine.submit.progressRated": "{done} / {total} assessed",
	"engine.submit.goTo": "Go to question {n}",

	/* ── Slide de résultats ── */
	"engine.result.title": "Results",
	"engine.result.trainingTitle": "Practice results",
	"engine.result.freeTextCorrection": "Free-text review",
	"engine.result.correctionHint": "Go back through the questions to compare your answers, read the explanations and assess yourself.",
	"engine.result.reviewAnswers": "Review my answers",
	"engine.result.ratedLabel": "Self-assessed:",
	"engine.result.correctLabel": "Correct answers:",
	"engine.result.withHint": "{count} with a hint",
	"engine.result.pending.one": "Not assessed",
	"engine.result.pending.other": "Not assessed",
	"engine.result.pendingWritten.one": "{count} written answer is not self-assessed yet — it doesn't count in the score.",
	"engine.result.pendingWritten.other": "{count} written answers are not self-assessed yet — they don't count in the score.",
	"engine.result.retry": "Start over",

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

	/* ── Run button on a Python code block ── */
	"engine.code.run": "Run",
	"engine.code.answerPlaceholder": "Write your code here...",
	"engine.code.running": "Running…",
	"engine.code.output": "Output",
	"engine.code.empty": "(no output)",
	"engine.code.timeout": "The code took too long to run.",
	"engine.code.tooLong": "The output is too long and was cut off.",
	"engine.code.unavailable": "Code sandbox unavailable.",
	"engine.code.notInstalled": "This language is not installed yet.",
	"engine.code.needsMore": "This program needs more than the sandbox.",
	"engine.code.runOnline": "Run online",
	"engine.code.installing": "Downloading the C/C++ compiler… {percent} %",
	"engine.code.installOffline": "The C/C++ compiler could not be downloaded (no connection).",
	"engine.code.installRefused": "The downloaded compiler failed its integrity check and was not installed.",

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
