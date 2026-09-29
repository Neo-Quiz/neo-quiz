import type { EN_ENGINE } from "../en/engine";

/* Domaine « engine » — français. Reprend mot pour mot les libellés historiques
   du moteur (aucune reformulation : le rendu français doit être identique à
   celui d'avant l'i18n). */
export const FR_ENGINE: Record<keyof typeof EN_ENGINE, string> = {
	/* ── Erreurs du bloc ── */
	"engine.error.noQuestions": "⚠️ Aucune question fournie au moteur de quiz.",

	/* ── Texte à trous ── */
	"engine.cloze.blankAria": "Trou {n}",

	/* ── Support de compréhension (document lu avant de répondre) ── */
	"engine.passage.defaultTitle": "Document",
	"engine.passage.scopeRange": "questions {first} à {last}",
	"engine.passage.scopeCount": "{count} questions",
	"engine.passage.collapse": "Masquer le document",
	"engine.passage.expand": "Afficher le document",

	"engine.lecture.keyPoints": "À retenir",
	"engine.lecture.flipHint": "Cliquez sur une carte, ou appuyez sur Entrée, pour la retourner.",
	"engine.lecture.flipAria": "{front} : retourner la carte",
	"engine.lecture.flippedAria": "{front} : {back}",

	/* ── Navigation ── */
	"engine.nav.results": "Résultats",
	"engine.nav.prevQuestion": "Question précédente",
	"engine.nav.nextQuestion": "Question suivante",

	/* ── Exam ── */
	"engine.exam.timedTitle": "Quiz chronométré",
	"engine.exam.start": "Commencer",
	"engine.exam.duration.one": "Durée : {minutes} minute",
	"engine.exam.duration.other": "Durée : {minutes} minutes",
	"engine.exam.questionCount.one": "{count} question",
	"engine.exam.questionCount.other": "{count} questions",
	"engine.exam.finish": "Terminer l'examen",

	/* ── Rendre un Test (engine/hand-in.ts) ── */
	"engine.handIn.button": "Rendre le test",
	"engine.handIn.unanswered.one": "{count} question sans réponse",
	"engine.handIn.unanswered.other": "{count} questions sans réponse",
	"engine.handIn.confirmSub": "Rendre quand même ? Une question sans réponse compte comme fausse.",
	"engine.handIn.confirm": "Rendre",
	"engine.handIn.keepAnswering": "Continuer à répondre",
	"engine.exam.timeUpLocked": "Temps écoulé ! Le quiz a été verrouillé.",

	/* ── Questions à choix ── */
	"engine.qcm.multiHint": "Sélectionnez une ou plusieurs réponses",

	/* ── Questions « ordering » ── */
	"engine.ordering.instructions": "Glissez chaque élément à sa place, ou cliquez sur un élément puis sur un emplacement. Déposé sur un emplacement rempli, il échange les deux.",
	"engine.ordering.dropHere": "Glissez un élément ici",
	"engine.ordering.itemsLabel": "Éléments à placer",

	/* ── Questions « matching » ── */
	"engine.matching.instructions": "Glissez une réponse sur chaque élément, ou cliquez sur une réponse puis sur un élément. Une réponse peut servir plusieurs fois.",
	"engine.matching.dropHere": "Déposez un support ici",
	"engine.matching.choicesLabel": "Réponses disponibles",
	"engine.matching.unknownChoice": "Support inconnu",

	/* ── Indice ── */
	"engine.hint.button": "Indice",
	"engine.hint.next": "Indice suivant",
	"engine.hint.level": "Indice {n} sur {total}",
	"engine.hint.title": "Indice",
	"engine.hint.close": "Fermer",

	/* ── Mode leçon ── */
	"engine.lesson.label": "Leçon",
	/* Le rôle d'une question de Learn, en tête de carte. Plus de « Tranche N
	   sur M » au-dessus (2026-09-23) : les étapes d'un Learn ne se montrent pas. */
	"engine.lesson.roleExplain": "Avec vos mots",
	"engine.lesson.rolePre": "Avant la lecture",
	"engine.lesson.roleRead": "Lecture",
	"engine.lesson.roleRecall": "De mémoire",
	"engine.lesson.dontKnow": "Je ne sais pas",
	"engine.learn.check": "Vérifier",
	"engine.learn.retryNote": "Cette question vous avait échappé : réessayez.",
	"engine.learn.summaryFirst": "Juste du premier coup",
	"engine.learn.summaryRetried": "Juste après une reprise",
	"engine.learn.summaryMissed": "À revoir",
	"engine.learn.rateTitle": "Votre réponse était-elle juste ?",

	/* ── Question texte / terminal ── */
	"engine.text.placeholder": "Votre réponse...",
	"engine.terminal.programOutputLabel": "Sortie du programme…",
	"engine.terminal.window.cmd": "Invite de commandes",
	"engine.terminal.window.powershell": "Windows PowerShell",
	"engine.terminal.window.bash": "bash",

	/* ── Mode entraînement (réponse libre) ── */
	"engine.textOnly.answerLabel": "Votre réponse libre",
	"engine.textOnly.answerPlaceholder": "Écrivez votre réponse avec vos mots...",
	"engine.textOnly.explanationLabel": "Explication",
	"engine.textOnly.noExpectedAnswer": "Réponse attendue non renseignée.",
	"engine.textOnly.noAnswerGiven": "Aucune réponse donnée.",
	"engine.textOnly.writtenQuestionNumber": "Q{n}",
	"engine.textOnly.verdict.right": "J'avais juste",
	"engine.textOnly.verdict.wrong": "J'avais faux",

	/* ── Auto-évaluation ── */
	"engine.rating.understood": "Compris",
	"engine.rating.partial": "Partiel",
	"engine.rating.review": "À revoir",

	/* ── Carte mémoire ── */
	"engine.flashcard.flip": "Retourner",
	"engine.flashcard.flipHint": "Espace",
	"engine.flashcard.front": "Question",
	"engine.flashcard.flipTip": "Cliquez sur la carte ou appuyez sur",
	"engine.flashcard.showQuestion": "Retourner la carte pour voir la question",
	"engine.flashcard.showAnswer": "Retourner la carte pour voir la réponse",
	"engine.flashcard.back": "Réponse",
	"engine.flashcard.again": "À revoir",
	"engine.flashcard.knew": "Je savais",
	"engine.flashcard.missingAnswer": "Pas de réponse au verso de cette carte.",

	/* ── Slide de soumission ── */
	"engine.submit.back": "Retour",
	"engine.submit.showScore": "Voir le score",
	"engine.submit.showResults": "Voir les résultats",
	"engine.submit.reviewList": "Revenir sur une question",
	"engine.submit.missingList": "Sans réponse",
	"engine.submit.missingAnswers.one": "{count} question sans réponse",
	"engine.submit.missingAnswers.other": "{count} questions sans réponse",
	"engine.submit.missingFreeAnswers.one": "{count} question sans réponse libre",
	"engine.submit.missingFreeAnswers.other": "{count} questions sans réponse libre",
	"engine.submit.allFreeAnswered": "Toutes les questions ont une réponse",
	"engine.submit.missingRatings.one": "{count} question à auto-évaluer",
	"engine.submit.missingRatings.other": "{count} questions à auto-évaluer",
	"engine.submit.toRateList": "À auto-évaluer",
	"engine.submit.allRated": "Toutes les questions sont auto-évaluées",
	"engine.submit.allAnswered": "Toutes les questions ont une réponse",
	"engine.submit.missingSub": "Vous pouvez encore y revenir avant de terminer.",
	"engine.submit.completeSub": "Vous pouvez revoir une question avant de terminer.",
	"engine.submit.progress": "{done} / {total} répondues",
	"engine.submit.progressRated": "{done} / {total} auto-évaluées",
	"engine.submit.goTo": "Aller à la question {n}",

	/* ── Slide de résultats ── */
	"engine.result.title": "Résultats",
	"engine.result.trainingTitle": "Résultats entraînement",
	"engine.result.freeTextCorrection": "Correction réponse libre",
	"engine.result.correctionHint": "Revenez sur les questions pour comparer vos réponses, lire les explications et vous auto-évaluer.",
	"engine.result.reviewAnswers": "Corriger mes réponses",
	"engine.result.ratedLabel": "Auto-évaluées :",
	"engine.result.correctLabel": "Bonnes réponses :",
	"engine.result.withHint": "dont {count} avec indice",
	"engine.result.pending.one": "Non évaluée",
	"engine.result.pending.other": "Non évaluées",
	"engine.result.pendingWritten.one": "{count} réponse écrite n'est pas encore auto-évaluée — elle ne compte pas dans le score.",
	"engine.result.pendingWritten.other": "{count} réponses écrites ne sont pas encore auto-évaluées — elles ne comptent pas dans le score.",
	"engine.result.retry": "Recommencer",

	/* ── Sauvegarde des résultats ── */
	"engine.result.save": "Sauvegarder mes résultats",
	"engine.result.saved": "Résultats sauvegardés",
	"engine.result.saving": "Sauvegarde...",
	"engine.result.savedIn": "Sauvegardé dans {path}",
	"engine.result.savedNotice": "Résultats sauvegardés : {path}",
	"engine.result.saveError": "Erreur sauvegarde résultats : {message}",
	"engine.result.unknownError": "erreur inconnue",

	/* ── Bouton ressource (pièce jointe) ── */
	"engine.resource.missingName": "Nom de fichier manquant.",
	"engine.resource.notFound": "Fichier introuvable dans le vault : {name}",
	"engine.resource.duplicate": "Plusieurs fichiers portent ce nom ({name}). Premier résultat utilisé.",
	"engine.resource.openedDefaultApp": "Ouverture avec l'application par défaut : {name}",
	"engine.resource.openedAndroid": "Ouverture via le système Android : {name}",
	"engine.resource.noDefaultApp": "Fichier localisé, mais aucune application par défaut trouvée pour : {name}",
	"engine.resource.openFailed": "Impossible de révéler ou d'ouvrir le fichier : {name}",
	"engine.resource.openError": "Erreur pendant l'ouverture du fichier.",

	/* ── Bouton Exécuter d'un bloc de code Python ── */
	"engine.code.run": "Exécuter",
	"engine.code.running": "Exécution…",
	"engine.code.output": "Sortie",
	"engine.code.empty": "(aucune sortie)",
	"engine.code.timeout": "Le code a mis trop de temps à s'exécuter.",
	"engine.code.tooLong": "La sortie est trop longue et a été tronquée.",
	"engine.code.unavailable": "Bac à sable de code indisponible.",
	"engine.code.notInstalled": "Ce langage n'est pas encore installé.",
	"engine.code.installing": "Téléchargement du compilateur C/C++… {percent} %",
	"engine.code.installOffline": "Le compilateur C/C++ n'a pas pu être téléchargé (pas de connexion).",
	"engine.code.installRefused": "Le compilateur téléchargé n'a pas passé la vérification d'intégrité : il n'a pas été installé.",

	/* ── Clavier mathématique (MathLive) ── */
	"engine.math.closeKeyboard": "Fermer le clavier",
	"engine.math.matrixTab": "Matrices et structures",
	"engine.math.matrix2x2Paren": "Matrice 2×2 (parenthèses)",
	"engine.math.matrix3x3Paren": "Matrice 3×3 (parenthèses)",
	"engine.math.matrix2x2Bracket": "Matrice 2×2 (crochets)",
	"engine.math.determinant2x2": "Déterminant 2×2",
	"engine.math.equationSystem": "Système d'équations",
	"engine.math.vector": "Vecteur",
	"engine.math.overline": "Barre (conjugué / moyenne)",
	"engine.math.addRow": "Ajouter une ligne à la matrice",
	"engine.math.addColumn": "Ajouter une colonne à la matrice",
};
