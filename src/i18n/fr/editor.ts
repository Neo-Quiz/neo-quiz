import type { EN_EDITOR } from "../en/editor";

/* Domaine « editor » — français. */
export const FR_EDITOR: Record<keyof typeof EN_EDITOR, string> = {
	/* ── Vue & ossature (editor.ts, editor/ui.ts) ── */
	"editor.answer.noneCorrect": "Aucune bonne réponse — personne ne peut réussir cette question.",
	"editor.lesson.section": "Leçon",
	"editor.lesson.help": "Affichée avant la question, en mode Leçon.",
	"editor.lesson.placeholder": "Ce que l'apprenant lit d'abord…",
	"editor.paste.imageFailed": "Impossible de coller l'image",
	"editor.codeEditInNote": "Un exercice de programmation se modifie directement dans la note.",

	/* ── Actions communes ── */
	"editor.action.add": "Ajouter",
	"editor.action.delete": "Supprimer",
	"editor.action.cancel": "Annuler",
	"editor.toggle.enable": "Activer",
	"editor.toggle.disable": "Désactiver",

	/* ── Sauvegarde (infobulles du bouton + notice) ── */

	/* ── Texte à trous ── */
	"editor.type.cloze.label": "Texte à trous",
	"editor.type.cloze.desc": "Compléter un texte",
	"editor.cloze.help": "Écrivez le texte entier et encadrez chaque trou de doubles accolades. Séparez les variantes acceptées par une barre verticale : {{Paris}}, {{l'euro|euro}}.",
	"editor.cloze.templateLabel": "Texte à trous",
	"editor.cloze.templatePlaceholder": "La capitale de la France est {{Paris}}.",
	"editor.cloze.defaultTemplate": "La capitale de la France est {{Paris}}.",
	"editor.cloze.blankCount": "{n} trous détectés",
	"editor.cloze.noBlank": "Aucun trou pour l'instant — encadrez un mot de doubles accolades, comme {{ceci}}",

	/* ── Réponse numérique ── */
	"editor.type.numeric.label": "Numérique",
	"editor.type.numeric.desc": "Une valeur, avec une marge",
	"editor.numeric.help": "La réponse est comparée comme un NOMBRE : 3.14, 3,14 et 3,140 passent toutes. Ajoutez une marge quand la valeur attendue est une mesure ou un résultat arrondi.",
	"editor.numeric.answers": "Valeur attendue",
	"editor.numeric.answerPlaceholder": "9,81",
	"editor.numeric.unit": "Unité (facultatif)",
	"editor.numeric.unitPlaceholder": "m/s²",
	"editor.numeric.tolerance": "Marge absolue",
	"editor.numeric.tolerancePercent": "Marge relative (%)",

	/* ── Support de compréhension ── */
	"editor.passage.section": "Document",
	"editor.passage.help": "Un texte à lire avant de répondre. Donnez la même clé de partage à plusieurs questions : elles afficheront toutes ce même document.",
	"editor.passage.textLabel": "Texte",
	"editor.passage.textPlaceholder": "Collez ou écrivez le texte, l'étude de cas, le scénario ou l'extrait de code…",
	"editor.passage.titleLabel": "Titre",
	"editor.passage.titlePlaceholder": "Texte : L'effet de serre",
	"editor.passage.idLabel": "Clé de partage",
	"editor.passage.idPlaceholder": "doc1",

	/* ── Mode examen ── */

	/* ── Types de question (Q_TYPES, editor/utils.ts) ── */
	"editor.type.single.label": "Choix unique",
	"editor.type.single.desc": "Une seule bonne réponse",
	"editor.type.multi.label": "Choix multiple",
	"editor.type.multi.desc": "Plusieurs bonnes réponses",
	"editor.type.ordering.label": "Classement",
	"editor.type.ordering.desc": "Ordonner les éléments",
	"editor.type.matching.label": "Association",
	"editor.type.matching.desc": "Associer lignes et choix",
	"editor.type.text.label": "Texte libre",
	"editor.type.text.desc": "Textarea classique",
	"editor.type.cmd.label": "Terminal CMD",
	"editor.type.cmd.desc": "Invite de commandes Windows",
	"editor.type.powershell.label": "PowerShell",
	"editor.type.powershell.desc": "Terminal PowerShell",
	"editor.type.bash.label": "Terminal Bash",
	"editor.type.bash.desc": "Terminal Linux/Bash",

	/* ── Formulaire : sections communes ── */
	"editor.form.promptSection": "Énoncé",
	"editor.form.promptPlaceholder": "Votre question...",
	"editor.hint.label": "Indice",
	"editor.hint.placeholder": "Un indice pour aider...",
	"editor.form.explainSection": "Explication (Markdown)",
	"editor.form.explainPlaceholder": "### Rappels\n- **Terme** — Définition",

	/* ── Toolbar entités HTML (infobulles) ── */
	"editor.entity.gt": "Supérieur (>)",
	"editor.entity.lt": "Inférieur (<)",
	"editor.entity.amp": "Esperluette (&)",
	"editor.entity.nbsp": "Espace insécable",
	"editor.entity.apos": "Apostrophe",
	"editor.entity.quot": "Guillemet",
	"editor.entity.codeBlock": "Bloc de code",

	/* ── Section Ressource ── */
	"editor.form.resourceSection": "Ressource",
	"editor.form.resourceSectionWithFile": "Ressource — {file}",
	"editor.form.resourceDefaultLabel": "Activité PT",
	"editor.form.resourceLabel": "Label",
	"editor.form.resourceLabelPlaceholder": "Activité PT",
	"editor.form.resourceFileName": "Nom du fichier à ouvrir",
	"editor.form.resourceFilePlaceholder": "fichier.pka",
	"editor.form.resourceHelp": "Le fichier doit être placé dans le coffre",

	/* ── Réponses (choix unique / multiple) ── */
	"editor.answer.correct": "Bonne réponse",
	"editor.answer.wrong": "Mauvaise réponse",
	"editor.answer.placeholder": "Saisir la réponse",
	"editor.answer.add": "Ajouter une réponse",

	/* ── Classement ── */
	"editor.ordering.possibilities": "Possibilités",
	"editor.ordering.itemPlaceholder": "Élément",
	"editor.ordering.slotLabels": "Labels des slots",
	"editor.ordering.slotPlaceholder": "Slot",
	"editor.ordering.correctOrder": "Ordre correct (index → slot)",
	"editor.ordering.slotDefault": "Étape {n}",

	/* ── Association ── */
	"editor.matching.rows": "Lignes (situations)",
	"editor.matching.rowPlaceholder": "Situation",
	"editor.matching.choices": "Choix (supports)",
	"editor.matching.choicePlaceholder": "Choix",
	"editor.matching.mapping": "Associations",
	"editor.matching.rowFallback": "Ligne {n}",

	/* ── Texte libre & terminaux ── */
	"editor.text.commandPrefix": "Préfix du prompt",
	"editor.text.placeholderLabel": "Placeholder",
	"editor.text.placeholderHint": "Texte indicatif...",
	"editor.text.acceptedAnswers": "Réponses acceptées",
	"editor.text.answerPlaceholder": "Réponse",
	"editor.text.caseSensitive": "Sensible à la casse",
	"editor.text.defaultPlaceholder": "Votre réponse...",

	/* ── Panneau Aperçu ── */
	"editor.preview.resourceFallback": "Ressource",
	"editor.preview.multiHint": "Sélectionnez une ou plusieurs réponses",
	"editor.preview.orderingHint": "Classez les éléments dans le bon ordre",
	"editor.preview.matchingHint": "Associez chaque situation à un support",

	/* ── Modale « Ajouter une question » ── */
	"editor.typeModal.title": "Ajouter une question",
	"editor.typeModal.subtitle": "Choisissez le type de question",

	/* ── Modale d'import ── */

	/* ── Sélecteurs de note (import / ouverture) ── */

	/* ── Modale de suppression ── */
	"editor.delete.title": "Supprimer « {title} » ?",
	"editor.delete.message": "Cette action est irréversible. La question sera définitivement supprimée.",

	/* ── Notices ── */
};
