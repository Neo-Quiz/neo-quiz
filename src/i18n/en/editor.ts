/* Domaine « editor » — anglais, dictionnaire de RÉFÉRENCE.
   Toute clé ajoutée ici doit l'être aussi dans i18n/fr/editor.ts (le typage de
   FR_EDITOR l'impose). Clés préfixées « editor. » : un domaine ne marche jamais
   sur les clés d'un autre. */
export const EN_EDITOR = {
	/* ── Vue & ossature (editor.ts, editor/ui.ts) ── */
	"editor.answer.noneCorrect": "No correct answer — nobody can get this question right.",
	"editor.lesson.section": "Lesson",
	"editor.lesson.help": "Shown before the question in Lesson mode.",
	"editor.lesson.placeholder": "What the learner should read first…",
	"editor.paste.imageFailed": "Could not paste the image",
	"editor.codeEditInNote": "Programming exercises are edited directly in the note.",

	/* ── Actions communes ── */
	"editor.action.add": "Add",
	"editor.action.delete": "Delete",
	"editor.action.cancel": "Cancel",
	"editor.toggle.enable": "Enable",
	"editor.toggle.disable": "Disable",

	/* ── Sauvegarde (infobulles du bouton + notice) ── */

	/* ── Texte à trous ── */
	"editor.type.cloze.label": "Fill in the blanks",
	"editor.type.cloze.desc": "Complete a text",
	"editor.type.flashcard.label": "Flashcard",
	"editor.type.flashcard.desc": "Flip it, then rate yourself",
	"editor.flashcard.section": "Back of the card",
	"editor.flashcard.help": "The question above is the front. Write the expected answer here: one sentence, one formula or one line of code.",
	"editor.flashcard.back": "Answer",
	"editor.flashcard.backPlaceholder": "<class 'list'>",
	"editor.cloze.help": "Write the whole text and wrap each blank in double braces. Separate accepted variants with a pipe: {{Paris}}, {{the euro|euro}}.",
	"editor.cloze.templateLabel": "Text with blanks",
	"editor.cloze.templatePlaceholder": "The capital of France is {{Paris}}.",
	"editor.cloze.defaultTemplate": "The capital of France is {{Paris}}.",
	"editor.cloze.blankCount": "{n} blanks detected",
	"editor.cloze.noBlank": "No blank yet — wrap a word in double braces, like {{this}}",

	/* ── Réponse numérique ── */
	"editor.type.numeric.label": "Numeric",
	"editor.type.numeric.desc": "A value, with a tolerance",
	"editor.numeric.help": "The answer is compared as a NUMBER: 3.14, 3,14 and 3.140 all pass. Add a margin when the expected value is a measurement or a rounded result.",
	"editor.numeric.answers": "Expected value",
	"editor.numeric.answerPlaceholder": "9.81",
	"editor.numeric.unit": "Unit (optional)",
	"editor.numeric.unitPlaceholder": "m/s²",
	"editor.numeric.tolerance": "Absolute margin",
	"editor.numeric.tolerancePercent": "Relative margin (%)",

	/* ── Support de compréhension ── */
	"editor.passage.section": "Document",
	"editor.passage.help": "A text to read before answering. Give the same sharing key to several questions and they all show this one document.",
	"editor.passage.textLabel": "Text",
	"editor.passage.textPlaceholder": "Paste or write the passage, case study, scenario or code sample…",
	"editor.passage.titleLabel": "Title",
	"editor.passage.titlePlaceholder": "Text: The greenhouse effect",
	"editor.passage.idLabel": "Sharing key",
	"editor.passage.idPlaceholder": "doc1",

	/* ── Mode examen ── */

	/* ── Types de question (Q_TYPES, editor/utils.ts) ── */
	"editor.type.single.label": "Single choice",
	"editor.type.single.desc": "One correct answer",
	"editor.type.multi.label": "Multiple choice",
	"editor.type.multi.desc": "Several correct answers",
	"editor.type.ordering.label": "Ordering",
	"editor.type.ordering.desc": "Put the items in order",
	"editor.type.matching.label": "Matching",
	"editor.type.matching.desc": "Match rows with choices",
	"editor.type.text.label": "Free text",
	"editor.type.text.desc": "Plain text area",
	"editor.type.cmd.label": "CMD terminal",
	"editor.type.cmd.desc": "Windows command prompt",
	"editor.type.powershell.label": "PowerShell",
	"editor.type.powershell.desc": "PowerShell terminal",
	"editor.type.bash.label": "Bash terminal",
	"editor.type.bash.desc": "Linux/Bash terminal",

	/* ── Formulaire : sections communes ── */
	"editor.form.promptSection": "Prompt",
	"editor.form.promptPlaceholder": "Your question...",
	"editor.hint.label": "Hint",
	"editor.hint.placeholder": "A hint to help...",
	/* Un indice à plusieurs niveaux (2026-09-26). */
	"editor.hint.levelsHelp": "A hard question can have several levels, from the lightest clue to the most revealing one.",
	"editor.hint.level": "Level {n}",
	"editor.hint.placeholderNext": "A more revealing hint...",
	"editor.hint.addLevel": "Add a level",
	"editor.hint.removeLevel": "Remove this level",
	/* Running the question's program as its last hint (runInLastHint, 2026-09-28). */
	"editor.hint.runInLastHint": "Running the code is the last hint",
	"editor.hint.runInLastHint.noRunnableBlock": "Needs a Python, C or C++ block in the question.",
	"editor.hint.runInLastHint.notEnoughHintLevels": "Needs at least two hint levels.",
	"editor.hint.runInLastHint.programOutput": "Not on a question asking what a program prints.",
	"editor.form.explainSection": "Explanation",
	"editor.form.explainPlaceholder": "### Key points\n- **Term** — Definition",

	/* ── Barre de mise en forme (infobulles) ── */
	"editor.format.bold": "Bold",
	"editor.format.italic": "Italic",
	"editor.format.code": "Code",
	"editor.format.formula": "Formula ($…$)",

	/* ── Menu « Caractère spécial » : entités HTML ── */
	"editor.entity.codeBlock": "Code block",

	/* ── Section Ressource ── */
	"editor.form.resourceSection": "Resource",
	"editor.form.resourceSectionWithFile": "Resource — {file}",
	"editor.form.resourceDefaultLabel": "PT activity",
	"editor.form.resourceLabel": "Label",
	"editor.form.resourceLabelPlaceholder": "PT activity",
	"editor.form.resourceFileName": "Name of the file to open",
	"editor.form.resourceFilePlaceholder": "file.pka",
	"editor.form.resourceHelp": "The file must be stored in your vault",

	/* ── Réponses (choix unique / multiple) ── */
	"editor.answer.correct": "Correct answer",
	"editor.answer.placeholder": "Enter the answer",
	"editor.answer.add": "Add an answer",

	/* ── Classement ── */
	"editor.ordering.possibilities": "Items",
	"editor.ordering.itemPlaceholder": "Item",
	"editor.ordering.slotLabels": "Slot labels",
	"editor.ordering.slotPlaceholder": "Slot",
	"editor.ordering.correctOrder": "Correct order (index → slot)",
	"editor.ordering.slotDefault": "Step {n}",

	/* ── Association ── */
	"editor.matching.rows": "Rows (situations)",
	"editor.matching.rowPlaceholder": "Situation",
	"editor.matching.choices": "Choices (media)",
	"editor.matching.choicePlaceholder": "Choice",
	"editor.matching.mapping": "Matches",
	"editor.matching.rowFallback": "Row {n}",

	/* ── Texte libre & terminaux ── */
	"editor.text.commandPrefix": "Prompt prefix",
	"editor.text.placeholderLabel": "Placeholder",
	"editor.text.placeholderHint": "Hint text...",
	"editor.text.acceptedAnswers": "Accepted answers",
	"editor.text.answerPlaceholder": "Answer",
	"editor.text.caseSensitive": "Case-sensitive",
	"editor.text.defaultPlaceholder": "Your answer...",

	/* ── Panneau Aperçu ── */
	"editor.preview.resourceFallback": "Resource",
	"editor.preview.multiHint": "Select one or more answers",
	"editor.preview.orderingHint": "Put the items in the right order",
	"editor.preview.matchingHint": "Match each situation with a medium",

	/* ── Édition dans le rendu corrigé (dashboard/edition-rendu.ts) ── */
	"editor.render.clickToEdit": "Click to edit",
	"editor.render.htmlInMore": "Edited as HTML in More",
	"editor.render.untitled": "Untitled question",
	"editor.render.addPrompt": "Add the question text",
	"editor.render.addExplain": "Add an explanation",

	/* ── Page d'édition : barre du type et panneau « Plus » (detail-edition.ts) ── */
	"editor.render.type": "Type",
	"editor.render.role": "Role",
	"editor.render.roleTest": "Check",
	"editor.render.more": "More",
	"editor.render.promptHtml": "Question text (HTML)",
	"editor.render.explainHtml": "Explanation (HTML)",
	"editor.render.typeChangeTitle": "Change the question type?",
	"editor.render.typeChangeMessage": "Its answers don't carry over to this type: they will be replaced by empty ones.",
	"editor.render.typeChangeConfirm": "Change type",

	/* ── Style de lecture d'un cours (detail-lecture-style.ts) ── */
	"editor.lecture.section": "Reading style",
	"editor.lecture.style": "Style",
	"editor.lecture.stylePage": "Page",
	"editor.lecture.styleEtapes": "Steps",
	"editor.lecture.styleTableau": "Table",
	"editor.lecture.help": "Every reading has its own screen, except short steps and methods, shown above the first question after the \"before the reading\" ones.",
	"editor.lecture.methode": "Method to apply in the next question",
	"editor.lecture.methodeHelp": "The steps are shown above that question even when they are long.",
	"editor.lecture.etapes": "Steps",
	"editor.lecture.etapePlaceholder": "One idea or one step",
	"editor.lecture.colonnes": "Column headers",
	"editor.lecture.colonnesPlaceholder": "Leave the first one empty, e.g. | Python | C",
	"editor.lecture.lignes": "Rows",
	"editor.lecture.lignePlaceholder": "Cells separated by |",
	"editor.lecture.retenir": "Key points",
	"editor.lecture.retenirAucun": "None",
	"editor.lecture.retenirCartes": "Flip cards",
	"editor.lecture.retenirRecap": "Checked recap",
	"editor.lecture.recto": "Front",
	"editor.lecture.verso": "Back",
	"editor.lecture.pointPlaceholder": "A point to keep",
	"editor.lecture.ajouter": "Add",
	"editor.lecture.retirer": "Remove",

	/* ── Gestes de réponse dans le rendu corrigé (edition-rendu-gestes.ts) ── */
	"editor.render.markCorrect": "Mark as correct answer",
	"editor.render.addOption": "Add an option",
	"editor.render.removeOption": "Remove this option",
	"editor.render.pickSlot": "Select this slot",
	"editor.render.pickChoice": "Select this item",
	"editor.render.addVariant": "Add a variant",

	/* ── Modale « Ajouter une question » ── */
	"editor.typeModal.title": "Add a question",
	"editor.typeModal.subtitle": "Choose the question type",

	/* ── Modale « Vocabulaire » (dashboard/glossaire-modal.ts, lot D) ── */
	"editor.glossary.button": "Vocabulary",
	"editor.glossary.title": "Quiz vocabulary",
	"editor.glossary.term": "Term",
	"editor.glossary.definition": "Definition",
	"editor.glossary.aliases": "Other forms, comma-separated",
	"editor.glossary.add": "Add a term",
	"editor.glossary.remove": "Remove this term",
	"editor.glossary.close": "Close",
	"editor.glossary.empty": "No terms yet. Add the ones a reading, an explanation or a hint should link to their definition.",
	"editor.glossary.countOne": "{count} term",
	"editor.glossary.countOther": "{count} terms",

	/* ── Modale d'import ── */

	/* ── Sélecteurs de note (import / ouverture) ── */

	/* ── Modale de suppression ── */
	"editor.delete.title": "Delete \"{title}\"?",
	"editor.delete.message": "This cannot be undone. The question will be permanently deleted.",

	/* ── Notices ── */
} as const;
