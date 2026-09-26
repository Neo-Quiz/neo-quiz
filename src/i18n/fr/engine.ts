import type { EN_ENGINE } from "../en/engine";

/* Domaine « engine » — français. Reprend mot pour mot les libellés historiques
   du moteur (aucune reformulation : le rendu français doit être identique à
   celui d'avant l'i18n). */
export const FR_ENGINE: Record<keyof typeof EN_ENGINE, string> = {
	/* ── Erreurs du bloc ── */
	"engine.error.noQuestions": "⚠️ Aucune question fournie au moteur de quiz.",

	/* ── Texte à trous ── */
	"engine.cloze.instructions": "Complétez les {count} trous",
	"engine.cloze.blankAria": "Trou {n}",

	/* ── Support de compréhension (document lu avant de répondre) ── */
	"engine.passage.defaultTitle": "Document",
	"engine.passage.scopeRange": "questions {first} à {last}",
	"engine.passage.scopeCount": "{count} questions",
	"engine.passage.collapse": "Masquer le document",
	"engine.passage.expand": "Afficher le document",

	"engine.lecture.readingTimeOne": "Environ {count} minute de lecture",
	"engine.lecture.readingTime": "Environ {count} minutes de lecture",
	"engine.lecture.keyPoints": "À retenir",
	"engine.lecture.flipHint": "Cliquez sur une carte, ou appuyez sur Entrée, pour la retourner.",
	"engine.lecture.flipAria": "{front} : retourner la carte",
	"engine.lecture.flippedAria": "{front} : {back}",

	/* ── Navigation ── */
	"engine.nav.results": "Résultats",
	"engine.nav.prevQuestion": "Question précédente",
	"engine.nav.nextQuestion": "Question suivante",

	/* ── Bascule de mode ── (retiree, voir en/engine.ts pour le contexte) */

	/* ── Écran de démarrage (choix du mode) ── */
	"engine.start.selectorAria": "Choisir le mode du quiz",
	"engine.start.examTitle": "Examen",
	"engine.start.examSub": "QCM chronométré",
	"engine.start.learnTitle": "Apprendre",
	"engine.start.learnSub": "Sans chrono, correction après chaque réponse",

	/* ── Mode examen ── */
	"engine.exam.timedTitle": "Quiz chronométré",
	"engine.exam.start": "Commencer",
	"engine.exam.startExam": "Commencer l'examen",
	"engine.exam.startLearn": "Commencer à apprendre",
	"engine.exam.noTimer": "Sans chrono",
	"engine.exam.duration.one": "Durée : {minutes} minute",
	"engine.exam.duration.other": "Durée : {minutes} minutes",
	"engine.exam.questionCount.one": "{count} question",
	"engine.exam.questionCount.other": "{count} questions",
	"engine.exam.finish": "Terminer l'examen",
	"engine.exam.timeUpManual": "Temps écoulé ! Terminez et validez votre examen.",
	"engine.exam.timeUpLocked": "Temps écoulé ! Le quiz a été verrouillé.",

	/* ── Questions à choix ── */
	"engine.qcm.multiHint": "Sélectionnez une ou plusieurs réponses",

	/* ── Questions « ordering » ── */
	"engine.ordering.instructions": "Classez les éléments dans le bon ordre (glisser-déposer). Déposez un élément sur un emplacement déjà rempli pour échanger automatiquement les positions.",
	"engine.ordering.dropHere": "Glissez un élément ici",
	"engine.ordering.itemsLabel": "Éléments à placer",

	/* ── Questions « matching » ── */
	"engine.matching.instructions": "Associez chaque situation à un support (glisser-déposer). Un même support peut être utilisé plusieurs fois.",
	"engine.matching.dropHere": "Déposez un support ici",
	"engine.matching.choicesLabel": "Supports disponibles",
	"engine.matching.unknownChoice": "Support inconnu",

	/* ── Indice ── */
	"engine.hint.button": "Indice",
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

	/* ── Question texte / terminal ── */
	"engine.text.placeholder": "Votre réponse...",

	/* ── Mode entraînement (réponse libre) ── */
	"engine.textOnly.answerLabel": "Votre réponse libre",
	"engine.textOnly.answerPlaceholder": "Écrivez votre réponse avec vos mots...",
	"engine.textOnly.check": "Vérifier",
	"engine.textOnly.explanationLabel": "Explication",
	"engine.textOnly.noExpectedAnswer": "Réponse attendue non renseignée.",
	"engine.textOnly.verdict.yes": "Oui",
	"engine.textOnly.verdict.partial": "En partie",
	"engine.textOnly.verdict.review": "À revoir",

	/* ── Auto-évaluation ── */
	"engine.rating.understood": "Compris",
	"engine.rating.partial": "Partiel",
	"engine.rating.review": "À revoir",

	/* ── Carte mémoire ── */
	"engine.flashcard.flip": "Retourner",
	"engine.flashcard.flipHint": "Espace",
	"engine.flashcard.back": "Réponse",
	"engine.flashcard.again": "À revoir",
	"engine.flashcard.knew": "Je savais",
	"engine.flashcard.missingAnswer": "Pas de réponse au verso de cette carte.",

	/* ── Slide de soumission ── */
	"engine.submit.back": "Retour",
	"engine.submit.showScore": "Voir le score",
	"engine.submit.showResults": "Voir les résultats",
	"engine.submit.reviewList": "Revenir sur une question :",
	"engine.submit.missingList": "Questions sans réponse :",
	"engine.submit.missingAnswers.one": "Il manque {count} réponse.",
	"engine.submit.missingAnswers.other": "Il manque {count} réponses.",
	"engine.submit.missingFreeAnswers.one": "Il manque {count} réponse libre.",
	"engine.submit.missingFreeAnswers.other": "Il manque {count} réponses libres.",
	"engine.submit.allFreeAnswered": "Toutes les questions ont une réponse libre.",
	"engine.submit.missingRatings.one": "Il manque {count} auto-évaluation.",
	"engine.submit.missingRatings.other": "Il manque {count} auto-évaluations.",
	"engine.submit.toRateList": "Questions à auto-évaluer :",
	"engine.submit.allRated": "Toutes les questions sont auto-évaluées.",

	/* ── Slide de résultats ── */
	"engine.result.title": "Résultats",
	"engine.result.trainingTitle": "Résultats entraînement",
	"engine.result.freeTextCorrection": "Correction réponse libre",
	"engine.result.correctionHint": "Revenez sur les questions pour comparer vos réponses, lire les explications et vous auto-évaluer.",
	"engine.result.reviewAnswers": "Corriger mes réponses",
	"engine.result.ratedLabel": "Auto-évaluées :",
	"engine.result.correctLabel": "Bonnes réponses :",
	"engine.result.pending.one": "Non évaluée",
	"engine.result.pending.other": "Non évaluées",
	"engine.result.retry": "Recommencer",
	"engine.result.takeExam": "Passer l'examen",
	"engine.result.retakeExam": "Repasser l'examen",

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
