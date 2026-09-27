import { makeDefault, defaultSlots, isRichHtml } from "./utils";
import type { DraftQuestion, QuestionTypeKey } from "./utils";
import { _htmlToText } from "./modals";
import type { ParsedQuizItem } from "./modals";
import type { EditorExamOptions } from "../types/editor-ctx";
import { normalizeQuizMode, pickLessonFields } from "../quiz-utils";
import { normalizeTerminalVariantName, defaultTerminalPromptPrefix } from "../engine/terminal";
import { QUESTION_ROLES, type QuestionRole } from "../types/quiz";
import { htmlVersMarkdown, texteBaliseVersMarkdown } from "./html-vers-markdown";
import { niveauxIndice } from "../quiz-hint";

/* ══════════════════════════════════════════════════════════
   CONVERT — item JSON5 brut → DraftQuestion (forme d'édition)

   Extrait de editor.ts (où il n'était qu'une méthode greffée sur la vue,
   donc inaccessible hors de l'éditeur) pour que la page « quiz » du
   dashboard lise EXACTEMENT le même format : deux lectures divergentes
   d'un même bloc quiz-blocks finiraient par écrire des .md incompatibles.
   Corps repris à l'identique.
══════════════════════════════════════════════════════════ */

/* L'objet de CONFIGURATION du bloc se repère par son INDEX, jamais par un test
   sur l'élément seul : le critère dépend de sa POSITION dans le tableau
   (quiz-utils.ts `findQuizModeConfigIndex`). Le prédicat par élément a vécu ici
   sous le nom `isModeConfig` ; il a été retiré pour qu'un appelant ne puisse
   plus le prendre pour la règle complète. */

/** Options du bloc lues depuis l'objet de mode. */
export function readModeConfig(q: ParsedQuizItem): EditorExamOptions {
	/* Même normalisation que le moteur (quiz-utils.ts) : un bloc écrit à la main
	   dit volontiers `mode: 'Learn'`, et la reconnaissance l'accepte — la
	   lecture ne peut pas, elle, le renvoyer au mode quiz. `normalizeQuizMode`
	   ramène l'alias hérité "learn" à son nom canonique "lesson" (renommé task 0
	   du lot mode leçon, 2026-08-31) ; `q.learnMode` est le raccourci hérité
	   équivalent. */
	const mode: "quiz" | "lesson" | "exam" = normalizeQuizMode(q.mode)
		?? (q.examMode === true ? "exam"
			: q.learnMode === true ? "lesson"
				: "quiz");
	return {
		mode,
		// Le chrono n'est « activé » que pour un vrai mode examen ; un mode
		// leçon peut en porter un (« Passer l'examen »), auquel cas il annonce
		// une durée.
		enabled: mode === "exam" || (mode === "lesson" && q.examDurationMinutes != null),
		/* Les défauts sont ceux du MOTEUR (quiz-utils.ts buildExamOpts), pas
		   des valeurs « raisonnables » choisies ici : la lecture réécrit le
		   bloc, et un défaut divergent transformait silencieusement
		   `{ examMode: true }` en `examAutoSubmit: false` — le comportement de
		   l'examen changeait sans que personne n'y touche. Bornes comprises :
		   une durée de 999 s'afficherait telle quelle mais durerait 180. */
		durationMinutes: Math.max(1, Math.min(180, Number(q.examDurationMinutes) || 10)),
		autoSubmit: q.examAutoSubmit !== false,
		showTimer: q.examShowTimer !== false,
		_extra: extraModeFields(q),
	};
}

/** Les clés de l'objet de mode que le plugin ne connaît pas. Même principe que
    `_extraFields` sur une question : ce qu'on ne comprend pas, on le rend. */
function extraModeFields(q: ParsedQuizItem): Record<string, unknown> | undefined {
	const connues = new Set(["mode", "examMode", "learnMode",
		"examDurationMinutes", "examAutoSubmit", "examShowTimer"]);
	// `Object.create(null)`, comme `_extraFields` : un objet ordinaire absorbe
	// une clé nommée `__proto__` au lieu de la stocker.
	const extra: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const cle of Object.keys(q)) {
		if (!connues.has(cle)) extra[cle] = (q as Record<string, unknown>)[cle];
	}
	return Object.keys(extra).length ? extra : undefined;
}

/** La variante de terminal telle qu'elle est ÉCRITE dans le bloc : sa clé et sa
    valeur, dans l'ordre où le moteur les consulte (engine/terminal.ts
    getTerminalTextVariant). */
function variantSource(q: ParsedQuizItem): { cle: string | null; valeur: unknown; imbriquee?: boolean } {
	if (q.terminalVariant != null) return { cle: "terminalVariant", valeur: q.terminalVariant };
	if (q.textVariant != null) return { cle: "textVariant", valeur: q.textVariant };
	/* Formes IMBRIQUÉES, que le moteur consulte aussi. Sans elles, un
	   `text: { variant: 'bash' }` n'était pas vu comme un terminal et la
	   question perdait son invite à la sauvegarde. La clé est `null` : ces
	   formes ne sont pas réémises telles quelles (l'export n'écrit que les deux
	   clés plates), mais le TYPE est correct, donc l'invite est conservée. */
	const sousObjet = (v: unknown): unknown =>
		v && typeof v === "object" && !Array.isArray(v)
			? (v as { variant?: unknown }).variant : undefined;
	const imbriquee = sousObjet(q.text) ?? sousObjet(q.terminal);
	if (imbriquee != null) return { cle: null, valeur: imbriquee, imbriquee: true };
	return { cle: null, valeur: null };
}

export function convertParsedToInternal(q: ParsedQuizItem): DraftQuestion {
	let type: QuestionTypeKey = "single";
	if (q.ordering) type = "ordering";
	else if (q.matching) type = "matching";
	// Le gabarit discrimine avant tout le reste (même règle que le moteur,
	// engine.ts isClozeQuestion) : une question qui porte un `cloze` non vide
	// est un texte à trous, quels que soient ses autres champs.
	/* `!= null` et non « non vide » : un gabarit VIDE reste une question à
	   trous, en attente d'être écrite. Exiger du contenu la reclassait en
	   choix unique, et la sauvegarde suivante remplaçait `cloze` par des
	   options fantômes (revue codex 2026-07-31). Le MOTEUR, lui, a raison
	   d'exiger du contenu : il ne peut rien afficher d'un gabarit vide. */
	/* Carte mémoire : `flashcard: true` discrimine, AVANT le repli sur le choix
	   unique — sans cette ligne, la sauvegarde suivante réécrivait la carte en
	   QCM à options vides (même piège que pour `cloze`). */
	else if (q.flashcard === true) type = "flashcard";
	else if (typeof q.cloze === "string") type = "cloze";
	/* MÊME critère que le moteur (engine/numeric.ts isNumericQuestion) : une
	   marge ou une unité suffisent à déclarer une réponse numérique. Une
	   détection plus étroite ici classerait la question en « texte », et
	   l'export perdrait `unit`/`tolerance` — ces clés ne transitent plus par
	   _extraFields depuis qu'elles ont leur propre branche. */
	else if (q.numeric === true
		|| typeof q.tolerance === "number"
		|| typeof q.tolerancePercent === "number"
		|| (typeof q.unit === "string" && q.unit.trim().length > 0)) type = "numeric";
	else if (q.multiSelect) type = "multi";
	/* `text: true` est le marqueur HISTORIQUE d'une question texte, et le
	   moteur le reconnaît toujours (engine.ts isTextQuestion). Ne pas le
	   reconnaître ici classait la question en QCM et supprimait sa réponse
	   à la première sauvegarde (revue codex 2026-07-31). */
	else if (q.type === "text" || q.text === true) {
		/* MÊME table d'alias que le moteur (engine/terminal.ts) : trois formes
		   exactes ne suffisaient pas. Les 22 questions Cisco d'Ahmed écrivent
		   `textVariant: 'command'`, que le moteur affiche en terminal `cmd` et
		   que l'éditeur prenait pour du texte ordinaire — la sauvegarde
		   suivante effaçait la variante ET son invite. */
		const variante = normalizeTerminalVariantName(variantSource(q).valeur);
		if (variante === "cmd") type = "cmd";
		else if (variante === "powershell") type = "powershell";
		// `sh`, `zsh`, `shell`… : l'éditeur n'a que trois types de terminal, et
		// bash est celui qui leur ressemble. La forme d'ORIGINE est mémorisée
		// plus bas et réémise telle quelle, donc rien ne se perd.
		else if (variante) type = "bash";
		else type = "text";
	}

	const question = makeDefault(type);
	question._id = q.id || Math.random().toString(36).slice(2, 10);
	if (typeof q.id === "string" && q.id.trim()) question._sourceId = q.id;
	question.title = q.title || "";
	// « Question N » non localisé : motif du titre auto écrit dans le .md.
	question._userModifiedTitle = !/^Question \d+$/.test(question.title);
	/* `hint` : une chaîne ou un tableau de niveaux (src/quiz-hint.ts). Le
	   premier niveau reste dans `hint`, les suivants dans `_hintMore` ; une
	   valeur invalide est ignorée. */
	const niveaux = niveauxIndice(q.hint).map(h => texteBaliseVersMarkdown(h) ?? h);
	question.hint = niveaux[0] ?? "";
	if (niveaux.length > 1) question._hintMore = niveaux.slice(1);

	/* DU MARKDOWN PARTOUT (2026-09-26) : un texte stocké en HTML est converti
	   en markdown à l'ouverture, quand la conversion est PROUVÉE sans perte
	   (editor/html-vers-markdown.ts) — le champ `*Html` quitte alors le
	   brouillon, et l'écriture suivante enregistre le markdown. Sinon (tableau
	   fusionné, couleur, balise inconnue…), le HTML reste tel quel.
	   Seulement quand le HTML est SEUL : un texte écrit à côté est une donnée
	   de l'auteur, et la conversion l'écraserait (zéro cas dans les vaults). */
	const promptMd = q.promptHtml && !q.prompt ? htmlVersMarkdown(q.promptHtml) : null;
	if (promptMd !== null) {
		question.prompt = promptMd;
		question._promptSource = true;
	} else if (q.prompt) {
		// Un énoncé TEXTE généré avec des balises (`<p>`, `<strong>`…).
		question.prompt = texteBaliseVersMarkdown(q.prompt) ?? q.prompt;
		question._promptSource = true;
	} else if (q.promptHtml) {
		question.prompt = _htmlToText(q.promptHtml);
	}
	if (q.promptHtml && promptMd === null) {
		question._promptHtml = q.promptHtml;
		// Si promptHtml existe, activer par défaut l'édition HTML
		question._useHtmlPrompt = true;
	}

	const explainMd = q.explainHtml && !q.explain ? htmlVersMarkdown(q.explainHtml) : null;
	if (explainMd !== null) question.explain = explainMd;
	else if (q.explain) question.explain = texteBaliseVersMarkdown(q.explain) ?? q.explain;
	else if (q.explainHtml && !isRichHtml(q.explainHtml)) {
		/* Uniquement si le HTML est une simple enveloppe (`<p>`, `<br>`) : le
		   remplir depuis un HTML RICHE faisait reprendre à l'export la version
		   APLATIE — corriger une faute de frappe dans le TITRE suffisait à
		   perdre un `<blockquote>` et ses emphases, sans que l'explication ait
		   été touchée (revue codex 2026-07-31). Laissé vide, c'est
		   `_explainHtml` qui fait foi des deux côtés, comme `_useHtmlPrompt`
		   le fait déjà pour l'énoncé. */
		question.explain = _htmlToText(q.explainHtml);
	}
	if (q.explainHtml && explainMd === null) {
		question._explainHtml = q.explainHtml;
	}

	/* Leçon (mode "lesson", renommé depuis "learn") : `pickLessonFields`
	   (quiz-utils.ts) porte l'ORDRE de repli — nom canonique prioritaire,
	   alias hérité ensuite — partagé avec engine/sanitizer.ts et
	   editor/export.ts (round 1 de revue, 2026-08-31 : chacun le réécrivait
	   avant, dans un ordre différent).
	   PAS de dérivation HTML→texte ici, CONTRAIREMENT à l'explication
	   ci-dessus : `question.lesson` ne porte que ce qui a été GENUINEMENT
	   écrit comme texte (`lesson`/`learn`), jamais une conversion de
	   `lessonHtml`/`learnHtml`. Une première version dérivait aussi un
	   `question.lesson` depuis un HTML non riche — mais export.ts ne peut
	   alors plus distinguer un texte VOULU d'un texte FABRIQUÉ pour
	   l'affichage, et une note qui ne portait qu'un `learnHtml` non riche
	   ressortait avec un `lesson:` en PLUS de `lessonHtml:` (round 1 de
	   revue, FINDING 2). L'affichage non-HTML d'une leçon sans texte propre
	   dérive son texte à la VOLÉE côté UI (dashboard/detail-question.ts),
	   sans jamais l'écrire ici. */
	/* Exception à la règle ci-dessus, et la seule : la conversion markdown
	   SANS PERTE d'un HTML seul (2026-09-26). Le `lesson` qui en sort n'est
	   pas un texte fabriqué pour l'affichage mais la même leçon, réécrite ; et
	   `_lessonHtml` n'est alors pas posé, donc l'écriture n'émet que `lesson`. */
	const { text: lessonText, html: lessonHtmlBrut } = pickLessonFields(q);
	const lessonMd = lessonHtmlBrut && !lessonText ? htmlVersMarkdown(lessonHtmlBrut) : null;
	if (lessonMd !== null) question.lesson = lessonMd;
	else {
		if (lessonText) question.lesson = texteBaliseVersMarkdown(lessonText) ?? lessonText;
		if (lessonHtmlBrut) question._lessonHtml = lessonHtmlBrut;
	}

	if (q.resourceButton) {
		question.resourceButton = { ...q.resourceButton };
	}

	/* Boucle d'apprentissage (mode "lesson", task 2 du lot mode leçon,
	   2026-08-31) : `slice`/`role` round-trippent comme un champ typé
	   ORDINAIRE (cf. `tolerance` plus haut), pas via `_extraFields` — sinon
	   une valeur hors contrat y survivrait recopiée telle quelle, alors que
	   l'écriture (editor/export.ts) doit au contraire la TAIRE.
	   `slice` n'a que la FORME de base vérifiée ici (un nombre) : sa borne
	   (entier ≥ 1) est une règle métier, validée à l'unique endroit qui
	   écrit le bloc (editor/export.ts) — la dupliquer ici serait une
	   deuxième source de vérité à resynchroniser.
	   `role`, en revanche, doit être validé DÈS LA LECTURE (fix round 1 de
	   revue, 2026-08-31) : `DraftQuestion.role` est typé `QuestionRole`
	   ("pre"/"read"/"recall"/"test"), et un cast `as DraftQuestion["role"]` sur un
	   `string` quelconque ("bogus" compris) mentait sur ce type — aucune
	   fuite aujourd'hui puisque l'export re-valide avant d'écrire, mais un
	   futur consommateur en mémoire (modèle de tranches, UI) ferait confiance
	   à ce type sans reconstruire la vérification. Une appartenance aux
	   quatre valeurs suffit, sans dupliquer la règle d'écriture.
	   `read` (task 6b) : ajouté ici EN MÊME TEMPS qu'à `QUESTION_ROLES`
	   (types/quiz.ts) et à la liste jumelle d'export.ts — un rôle absent
	   d'un des deux endroits est accepté à la lecture puis silencieusement
	   effacé à la première sauvegarde (piège déjà coûté 23 champs ailleurs).
	   La liste n'est plus recopiée en dur ici : `QUESTION_ROLES` est la
	   source unique du vocabulaire, lue des deux côtés (lecture et écriture). */
	if (typeof q.slice === "number") question.slice = q.slice;
	if (typeof q.role === "string" && (QUESTION_ROLES as readonly string[]).includes(q.role)) question.role = q.role as QuestionRole;

	if (type === "single" || type === "multi") {
		/* Une carte de LECTURE (`role: 'read'`) n'a ni options ni réponse : elle
		   ne reçoit pas les deux options vides d'une question neuve de
		   l'éditeur — l'écriture les recopiait, et chaque Learn généré en
		   portait sur toutes ses cartes de lecture (2026-09-23). */
		const lectureSansOptions = question.role === "read" && !Array.isArray(q.options);
		// Une option générée avec des balises s'édite en markdown, elle aussi.
		question.options = q.options
			? q.options.map(o => typeof o === "string" ? texteBaliseVersMarkdown(o) ?? o : o)
			: (lectureSansOptions ? [] : ["", ""]);
		if (type === "single") {
			question.correctIndex = q.correctIndex ?? 0;
		} else {
			question.correctIndices = q.correctIndices || [];
		}
	}

	/* Les formes IMBRIQUÉES sont lues en repli, comme le moteur le fait
	   (engine/questions.ts) : un bloc écrit à la main dit volontiers
	   `ordering: { items, correctOrder, slotLabels }`, et l'ignorer remplaçait
	   ses données par les valeurs par défaut à la première sauvegarde — deux
	   éléments vides et un ordre inventé (revue codex 2026-07-31). */
	const sousChamp = (conteneur: unknown, cle: string): unknown =>
		conteneur && typeof conteneur === "object" && !Array.isArray(conteneur)
			? (conteneur as Record<string, unknown>)[cle] : undefined;
	/** Première liste PRÉSENTE parmi les candidats — vide comprise. Un
	    `slots: []` explicite dit « pas de libellé », et lui substituer les
	    libellés par défaut inventait un contenu que l'auteur avait retiré ; le
	    moteur, lui, numérote alors les emplacements. */
	const listeTexte = (...cands: unknown[]): string[] | null => {
		for (const c of cands) if (Array.isArray(c)) return c.map(v => String(v ?? ""));
		return null;
	};
	/** Idem pour une liste de nombres. */
	const listeNombre = (...cands: unknown[]): number[] | null => {
		for (const c of cands) if (Array.isArray(c)) return c.map(v => Number(v));
		return null;
	};

	if (type === "ordering") {
		question.slots = listeTexte(q.slots, q.slotLabels, sousChamp(q.ordering, "slotLabels")) || defaultSlots();
		question.possibilities = listeTexte(q.possibilities, q.orderingItems,
			sousChamp(q.ordering, "items"), q.options) || ["", ""];
		question.correctOrder = listeNombre(q.correctOrder, sousChamp(q.ordering, "correctOrder")) || [0, 1];
	}

	if (type === "matching") {
		question.rows = listeTexte(q.rows, sousChamp(q.matching, "rows")) || ["", ""];
		question.choices = listeTexte(q.choices, sousChamp(q.matching, "choices")) || ["", ""];
		question.correctMap = listeNombre(q.correctMap, sousChamp(q.matching, "correctMap")) || [0, 0];
	}

	if (type === "cloze") {
		question.cloze = String(q.cloze ?? "");
		question.caseSensitive = q.caseSensitive || false;
	}

	if (type === "flashcard") {
		question.answer = String(q.answer ?? "");
	}

	if (["numeric", "text", "cmd", "powershell", "bash"].includes(type)) {
		/* UNION, pas alternative : le moteur agrège les cinq champs
		   (engine/terminal.ts getTextAcceptedAnswers). Les traiter comme
		   exclusifs faisait cesser d'accepter « yes » sur une question qui
		   portait `acceptedAnswers: ['oui']` ET `acceptableAnswers: ['yes']`. */
		/* DÉDOUBLONNÉE : les trois champs disent souvent la même chose, et
		   l'export les écrirait alors deux fois — le bloc grossit à chaque
		   sauvegarde sans que le quiz change. */
		let accepted = [...new Set([
			...(Array.isArray(q.acceptedAnswers) ? q.acceptedAnswers : []),
			...(Array.isArray(q.acceptableAnswers) ? q.acceptableAnswers : []),
			...(Array.isArray(q.correctAnswers) ? q.correctAnswers : []),
		].map(v => String(v ?? "")))];
		if (accepted.length === 0) accepted = [""];
		// `answer`/`correctText` : formats émis par la génération IA et
		// UNIONNÉS aux acceptedAnswers par le moteur (terminal.js:166-170)
		// — les fusionner pareil ici, sinon le round-trip éditeur→export
		// PERD une réponse valide (answer est dans knownKeys, donc plus
		// réémis via _extraFields). String/number seulement (le moteur
		// ignore les autres types) ; `!= null` : answer 0 est légitime.
		for (const extra of [q.correctText, q.answer]) {
			if (extra == null) continue;
			if (typeof extra !== "string" && typeof extra !== "number") continue;
			const v = String(extra);
			if (accepted.length === 1 && accepted[0] === "") {
				accepted = [v];
			} else if (!accepted.includes(v)) {
				accepted.push(v);
			}
		}
		question.acceptedAnswers = accepted;
		question.caseSensitive = q.caseSensitive || false;
		question.placeholder = q.placeholder || "";
		/* La forme NORMALISÉE de la variante (`cmd`, `bash`, `python`…) — même
		   fonction que le moteur (engine/terminal.ts normalizeTerminalVariantName),
		   mémorisée pour l'aperçu ET le formulaire : le bucket `type` de
		   l'éditeur, lui, ne distingue que trois variantes (`cmd`/`powershell`/
		   `bash`), et range toute autre variante réelle (`python`, `sh`, `zsh`…)
		   dans `bash` faute de type dédié — sans ce champ, l'aperçu d'une
		   question `python` ne pourrait plus savoir qu'elle n'est PAS une vraie
		   invite bash (retour de revue du lot A2). */
		if (type === "cmd" || type === "powershell" || type === "bash") {
			const varianteReelle = normalizeTerminalVariantName(variantSource(q).valeur);
			question._terminalVariant = varianteReelle;
			/* L'invite vaut pour TOUTES les variantes de terminal, bash compris
			   (engine/terminal.ts getTerminalPromptPrefix) — la restreindre à
			   cmd/powershell faisait disparaître « Town-Hall# » et consorts.
			   MÊME défaut que le moteur (defaultTerminalPromptPrefix), jamais une
			   copie : sans elle, une question bash chargée dans l'éditeur
			   enregistrait encore l'ancienne invite complète à la sauvegarde. */
			question.commandPrefix = q.commandPrefix || defaultTerminalPromptPrefix(varianteReelle);
		}
		/* La forme EXACTE de la variante, avec la clé qui la portait : c'est
		   elle qu'on réémettra, pas sa forme canonique. Réécrire
		   `textVariant: 'command'` en `terminalVariant: 'cmd'` changerait la
		   note sans que personne ne l'ait demandé. */
		const src = variantSource(q);
		if (src.cle) { question._variantKey = src.cle; question._variantValue = String(src.valeur); }
		else if (src.imbriquee) question._variantNested = true;
		if (type === "numeric") {
			question.unit = typeof q.unit === "string" ? q.unit : "";
			if (typeof q.tolerance === "number") question.tolerance = q.tolerance;
			if (typeof q.tolerancePercent === "number") question.tolerancePercent = q.tolerancePercent;
		}
	}

	/* Les quatre champs d'EXAMEN ne sont PAS dans cette liste : sur une
	   question, ce sont des clés inconnues comme les autres, et les déclarer
	   connues les faisait disparaître — l'export ne les écrit que pour l'objet
	   de configuration, jamais pour une question (revue codex 2026-07-31).
	   L'objet de configuration, lui, ne passe pas par ici : il est repéré par
	   son index et lu par `readModeConfig`. */
	const knownKeys = new Set(['id','title','prompt','promptHtml','options','correctIndex','multiSelect','correctIndices','ordering','slots','possibilities','correctOrder','matching','rows','choices','correctMap','type','terminalVariant','textVariant','commandPrefix','placeholder','caseSensitive','acceptedAnswers','acceptableAnswers','correctAnswers','correctText','answer','hint','explain','explainHtml','resourceButton','cloze','flashcard','numeric','tolerance','tolerancePercent','unit',
		// Leçon (mode "lesson") : nom canonique + alias hérités de "learn" — les
		// deux sont lus explicitement ci-dessus, donc ni l'un ni l'autre ne doit
		// retomber dans `_extraFields` (double écriture à l'export sinon).
		'lesson','lessonHtml','_lessonHtml','learn','learnHtml','_learnHtml',
		// Boucle d'apprentissage (task 2 du lot mode leçon) : lus explicitement
		// ci-dessus (`question.slice`/`.role`) — une valeur hors contrat doit
		// être TUE à l'écriture, pas réapparaître recopiée telle quelle via
		// `_extraFields` sous prétexte que sa forme de base n'a pas été retenue.
		'slice','role']);
	/* Les STYLES DE LECTURE (`lecture`, `etapes`, `tableau`, `retenir`,
	   2026-09-26) ne sont PAS dans cette liste, exprès : ils voyagent par
	   `_extraFields`, relus et réécrits tels quels (export.ts), valeurs
	   inconnues comprises — seul leur rendu les normalise
	   (src/lecture-style.ts). L'éditeur les modifie là
	   (dashboard/detail-lecture-style.ts). `check:export` le vérifie. */
	/* `Object.create(null)` : un objet ordinaire ABSORBE une clé nommée
	   `__proto__` au lieu de la stocker, et le champ personnalisé
	   disparaissait sans un mot. */
	const extraFields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Object.keys(q)) {
		if (!knownKeys.has(key)) extraFields[key] = q[key];
	}
	/* LIMITE ASSUMÉE. Une forme imbriquée `ordering: { items, correctOrder,
	   slotLabels }` est lue champ par champ puis réécrite sous la forme PLATE
	   (`ordering: true` + `slots` + `possibilities` + `correctOrder`) : ses
	   données survivent, mais un sous-champ que le plugin ne lit pas
	   (`ordering.revealMode`…) est perdu. Le réémettre demanderait de maintenir
	   une SECONDE forme d'export, et zéro quiz des deux vaults est concerné
	   (audit-vaults). On préfère une seule forme d'écriture, connue et
	   éprouvée, à un second chemin pour un cas que personne n'a. */
	question._extraFields = extraFields;

	return question;
}
