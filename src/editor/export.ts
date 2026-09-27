import { escHtml, esc5, md2html, isRichHtml } from "./utils";
import type { DraftQuestion } from "./utils";
import type { EditorExamOptions } from "../types/editor-ctx";
import { pickLessonFields } from "../quiz-utils";
import { assignQuestionIds } from "../quiz-ids";
import { QUESTION_ROLES } from "../types/quiz";
import type { EntreeGlossaire } from "../glossaire";

/**
 * Une valeur quelconque, écrite en JSON5.
 *
 * `JSON.stringify` ne convient pas : il rend `NaN` et `Infinity` — deux
 * littéraux que JSON5 accepte, et qu'un bloc écrit à la main peut contenir —
 * sous la forme `null`. La valeur serait alors silencieusement changée à la
 * première sauvegarde.
 *
 * Les CYCLES sont coupés par un ensemble de visités, pas par une profondeur
 * maximale : un plafond arbitraire tronquait aussi les objets légitimement
 * profonds, ce qui est exactement la perte de données qu'on cherche à éviter.
 */
function json5Value(v: unknown, vus: Set<object> = new Set()): string {
	if (v === null || v === undefined) return "null";
	if (typeof v === "string") return `'${esc5(v)}'`;
	// `-0` AVANT le cas général : `String(-0)` rend « 0 » et perdrait le signe,
	// alors que JSON5 sait l'écrire. Le zéro négatif est rare, mais c'est une
	// valeur que l'auteur a écrite — on ne la change pas dans son dos.
	if (Object.is(v, -0)) return "-0";
	// NaN / Infinity / -Infinity sont des littéraux JSON5 valides.
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	if (typeof v !== "object") return "null";   // fonction, symbole

	// Cycle : la valeur se contient elle-même. Impossible depuis un bloc lu par
	// `parseQuizSource`, mais la pile exploserait si ça arrivait.
	if (vus.has(v)) return "null";
	vus.add(v);
	try {
		// `toJSON` d'abord : c'est ainsi qu'une Date rend sa chaîne ISO, comme
		// le faisait `JSON.stringify`.
		const brut = v as { toJSON?: () => unknown };
		if (typeof brut.toJSON === "function") return json5Value(brut.toJSON(), vus);

		if (Array.isArray(v)) {
			// `map` SAUTE les trous d'un tableau creux et produirait `[1, , 3]`,
			// que JSON5 refuse. Chaque position est écrite, vide ou non.
			const items: string[] = [];
			for (let i = 0; i < v.length; i++) items.push(json5Value(v[i], vus));
			return "[" + items.join(", ") + "]";
		}

		const paires = Object.entries(v as Record<string, unknown>)
			.map(([k, x]) => `${json5Key(k)}: ${json5Value(x, vus)}`);
		return "{" + paires.join(", ") + "}";
	} finally {
		vus.delete(v);
	}
}

/**
 * Nom de propriété en JSON5. Un identifiant reste NU — c'est la forme du
 * reste du bloc, et tout citer rendrait les notes illisibles. Tout le reste
 * est cité : un champ personnalisé nommé `'a-b'` sortait en `a-b:`, que JSON5
 * refuse — et le bloc entier devenait alors non relisible, donc non
 * sauvegardable, en silence (revue codex 2026-07-31).
 */
function json5Key(k: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : `'${esc5(k)}'`;
}

/**
 * Le texte porte-t-il une balise inline ATTRIBUÉE dont la fermante est présente
 * — `Use <strong data-x="1">bold</strong>` ?
 *
 * Le rendu du texte ne restaure que les balises inline NUES
 * (engine/sanitizer.ts restoreAllowedInlineTags) : l'ouvrante resterait donc
 * échappée et la fermante deviendrait réelle, soit un fragment coupé en deux à
 * l'écran. `md2html` échappe les deux et affiche le littéral tel qu'il est
 * écrit ; c'est donc lui qu'il faut, pour ce cas-là seulement.
 *
 * La FERMANTE est exigée : sans elle, « 3 <x et y> 4 » — de la prose — partait
 * inutilement vers `md2html`, avec le risque de corruption que tout le reste
 * de cette fonction cherche justement à éviter. Mesuré : zéro champ des deux
 * vaults contient une balise attribuée, ce garde-fou ne protège donc que
 * l'avenir — raison de plus pour qu'il ne se déclenche pas à tort.
 */
function contientBaliseAttribuee(texte: string): boolean {
	for (const m of texte.matchAll(/<([a-z][a-z0-9]*)\s[^>]*>/gi)) {
		if (new RegExp("</" + m[1] + "\\s*>", "i").test(texte)) return true;
	}
	return false;
}

function exportQuestion(q: DraftQuestion, idx: number, id: string): string {
	/* L'identifiant RETENU devient celui de la question. Sans ça, un slug
	   dérivé du titre était écrit dans la note mais oublié en mémoire : la
	   retouche suivante du titre le recalculait, et l'ancre HTML comme les
	   résultats déjà sauvegardés pointaient dans le vide (revue codex
	   2026-07-31). */
	q._sourceId = id;
	const e = esc5;
	const L: string[] = [];
	L.push("\t{");
	L.push(`\t\tid: '${e(id)}',`);
	L.push(`\t\ttitle: '${e(q.title || `Question ${idx + 1}`)}',`);
	/* `json5Value` et non deux champs en dur : le bouton de ressource est un
	   objet libre dans la note, et le reconstruire à partir de `label` et
	   `fileName` seuls effaçait tout le reste — les autres champs personnalisés
	   d'une question sont préservés, celui-ci ne faisait pas exception par
	   choix (revue codex 2026-07-31). */
	if (q.resourceButton) L.push(`\t\tresourceButton: ${json5Value(q.resourceButton)},`);
	// Priorité au prompt modifié par l'utilisateur, _promptHtml est fallback
	if (q._useHtmlPrompt && q._promptHtml) {
		// Si l'utilisateur édite en mode HTML, utiliser directement _promptHtml
		L.push(`\t\tpromptHtml: '${e(q._promptHtml)}',`);
		/* …et GARDER le `prompt` texte s'il existait aussi. Le moteur affiche
		   `promptHtml` en priorité (engine/cards.ts renderQuizPromptHtml), mais
		   le texte reste la version lisible de la note, et le taire l'effaçait
		   (revue codex 2026-07-31 — même défaut que pour l'explication).
		   `_promptSource` distingue un `prompt` ÉCRIT dans la note du texte que
		   la lecture a dérivé du HTML : réémettre ce dernier ajouterait un champ
		   que personne n'a écrit. */
		if (q.prompt && q._promptSource) L.push(`\t\tprompt: '${e(q.prompt)}',`);
	} else if (q.prompt) {
		/* DU MARKDOWN PARTOUT (2026-09-26) : le markdown de BLOC (paragraphes,
		   listes, code, tableaux) reste lui aussi du texte — le moteur le rend
		   (engine/grammaire-blocs.ts). Il partait avant vers `md2html`, qui ne
		   connaît ni la règle de flanc du rendu (« 3*4*5 » écrit
		   `3<em>4</em>5` DANS LA NOTE, revue codex 2026-07-31) ni les tableaux.
		   Seule exception : une balise ATTRIBUÉE, que le rendu du texte
		   couperait en deux (voir `contientBaliseAttribuee`). */
		if (contientBaliseAttribuee(q.prompt)) {
			L.push(`\t\tpromptHtml: '${e(md2html(q.prompt))}',`);
		} else {
			L.push(`\t\tprompt: '${e(q.prompt)}',`);
		}
	} else if (q._promptHtml) {
		L.push(`\t\tpromptHtml: '${e(q._promptHtml)}',`);
	}
	const t = q._type;
	/* Une carte de LECTURE sans option remplie n'a rien à écrire en options
	   ni en réponse : `options: ['', '']` et `correctIndex: 0` n'y sont que
	   du bruit, et la page du quiz les affichait en « … ». Une note déjà
	   écrite ainsi se nettoie à sa prochaine sauvegarde. */
	const lectureSansOptions = q.role === "read" && !(q.options || []).some(o => String(o ?? "").trim() !== "");
	if (t === "single" && !lectureSansOptions) {
		L.push(`\t\toptions: [\n${(q.options || []).map(o => `\t\t\t'${e(o)}',`).join("\n")}\n\t\t],`);
		L.push(`\t\tcorrectIndex: ${q.correctIndex ?? 0},`);
	}
	if (t === "multi") {
		L.push(`\t\toptions: [\n${(q.options || []).map(o => `\t\t\t'${e(o)}',`).join("\n")}\n\t\t],`);
		L.push("\t\tmultiSelect: true,");
		L.push(`\t\tcorrectIndices: [${(q.correctIndices || []).join(", ")}],`);
	}
	if (t === "ordering") {
		L.push("\t\tordering: true,");
		L.push(`\t\tslots: [${(q.slots || []).map(s => `'${e(s)}'`).join(", ")}],`);
		L.push(`\t\tpossibilities: [\n${(q.possibilities || []).map(p => `\t\t\t'${e(p)}',`).join("\n")}\n\t\t],`);
		L.push(`\t\tcorrectOrder: [${(q.correctOrder || []).join(", ")}],`);
	}
	if (t === "matching") {
		L.push("\t\tmatching: true,");
		L.push(`\t\trows: [\n${(q.rows || []).map(r => `\t\t\t'${e(r)}',`).join("\n")}\n\t\t],`);
		L.push(`\t\tchoices: [\n${(q.choices || []).map(c => `\t\t\t'${e(c)}',`).join("\n")}\n\t\t],`);
		L.push(`\t\tcorrectMap: [${(q.correctMap || []).join(", ")}],`);
	}
	if (t === "cloze") {
		// Le gabarit porte à lui seul l'énoncé ET les réponses : rien d'autre
		// à écrire, et `type` reste absent (le moteur discrimine sur `cloze`).
		L.push(`\t\tcloze: '${e(q.cloze || "")}',`);
		if (q.caseSensitive) L.push("\t\tcaseSensitive: true,");
	}
	if (t === "flashcard") {
		// Le recto est `prompt` (écrit plus haut), le verso `answer` ; `type`
		// reste absent : le moteur discrimine sur `flashcard`.
		L.push("\t\tflashcard: true,");
		L.push(`\t\tanswer: '${e(q.answer || "")}',`);
	}
	if (["numeric", "text", "cmd", "powershell", "bash"].includes(t)) {
		L.push("\t\ttype: 'text',");
		/* La variante telle qu'elle était écrite, si on l'a lue quelque part :
		   le moteur accepte une douzaine d'alias (`command`, `shell`, `zsh`…)
		   que l'éditeur ramène à trois types. Réémettre la forme canonique
		   réécrirait la note sans qu'on l'ait demandé — et les trois formes
		   exactes d'avant en effaçaient purement 22 (revue 2026-07-31). */
		if (q._variantNested) {
			/* Rien : la forme imbriquée (`text.variant`) est réémise telle quelle
			   par `_extraFields`, et une seconde déclaration ferait cohabiter
			   deux variantes pour la même question. */
		} else if (q._variantKey && q._variantValue) {
			L.push(`\t\t${json5Key(q._variantKey)}: '${e(q._variantValue)}',`);
		} else if (t === "cmd") L.push("\t\tterminalVariant: 'cmd',");
		else if (t === "powershell") L.push("\t\ttextVariant: 'powershell',");
		else if (t === "bash") L.push("\t\ttextVariant: 'bash',");
		// L'invite vaut pour TOUTES les variantes de terminal, bash compris
		// (engine/terminal.ts getTerminalPromptPrefix).
		if (q.commandPrefix && (t === "cmd" || t === "powershell" || t === "bash")) {
			L.push(`\t\tcommandPrefix: '${e(q.commandPrefix)}',`);
		}
		if (q.placeholder) L.push(`\t\tplaceholder: '${e(q.placeholder)}',`);
		if (q.caseSensitive) L.push("\t\tcaseSensitive: true,");
		if (t === "numeric") {
			L.push("\t\tnumeric: true,");
			if (q.unit && q.unit.trim()) L.push(`\t\tunit: '${e(q.unit)}',`);
			// Marges mutuellement exclusives (cf. formulaire) : au plus une des
			// deux est définie, jamais les deux.
			if (typeof q.tolerance === "number") L.push(`\t\ttolerance: ${q.tolerance},`);
			if (typeof q.tolerancePercent === "number") L.push(`\t\ttolerancePercent: ${q.tolerancePercent},`);
		}
		/* `filter(Boolean)` jetait la réponse « 0 » — celle d'une question
		   numérique dont le résultat est zéro, et le moteur l'accepte
		   (getTextAcceptedAnswers convertit tout en chaîne). Seules les lignes
		   VIDES du formulaire sont écartées. */
		const reponses = (q.acceptedAnswers || [])
			.filter(a => a != null && String(a) !== "")
			.map(a => `\t\t\t'${e(String(a))}',`);
		L.push(`\t\tacceptedAnswers: [\n${reponses.join("\n")}\n\t\t],`);
	}
	/* Virgule SYSTÉMATIQUE, y compris sur le dernier champ écrit : JSON5
	   autorise la virgule traînante, et la conditionner à « y a-t-il un champ
	   après ? » n'a jamais tenu. `hint` et `explainHtml` se croyaient derniers
	   et s'écrivaient sans virgule — mais `_extraFields` en écrit d'autres
	   ensuite (passage, mathInput, numeric…). Une question portant une
	   explication ET un de ces champs produisait un bloc JSON5 INVALIDE, que le
	   moteur refusait de parser (« invalid character 'p' »). */
	/* Un indice d'UN niveau s'écrit en chaîne, comme toujours ; plusieurs
	   niveaux, en tableau du plus léger au plus révélateur (src/quiz-hint.ts).
	   Un niveau vidé dans l'éditeur n'est pas écrit. */
	const niveauxIndice = [q.hint, ...(q._hintMore ?? [])].filter(h => typeof h === "string" && h.trim() !== "");
	if (niveauxIndice.length === 1) {
		L.push(`\t\thint: '${e(niveauxIndice[0])}',`);
	} else if (niveauxIndice.length > 1) {
		L.push(`\t\thint: [\n${niveauxIndice.map(h => `\t\t\t'${e(h)}',`).join("\n")}\n\t\t],`);
	}
	// Priorité à explain modifié par l'utilisateur
	/* Quand les DEUX existent, le moteur affiche `explainHtml` (cards.ts
	   explanationHtml) : l'export doit donc l'écrire, et `explain` en plus. Le
	   taire faisait perdre le HTML riche d'une note qui portait les deux
	   champs — l'export avait la priorité INVERSE du rendu (revue codex
	   2026-07-31). */
	if (q.explain && q._explainHtml && isRichHtml(q._explainHtml)) {
		L.push(`\t\texplainHtml: '${e(q._explainHtml)}',`);
		L.push(`\t\texplain: '${e(q.explain)}',`);
	} else if (q.explain) {
		// Même règle que l'énoncé : le markdown, inline ou de bloc, reste du
		// TEXTE, que le moteur rend (engine/cards.ts explanationHtml).
		L.push(`\t\texplain: '${e(q.explain)}',`);
	} else if (q._explainHtml) {
		L.push(`\t\texplainHtml: '${e(q._explainHtml)}',`);
	}

	/* Leçon (mode "lesson", renommé depuis "learn" — task 0 du lot mode leçon,
	   2026-08-31) : `pickLessonFields` (quiz-utils.ts) porte l'ORDRE de repli,
	   partagé avec engine/sanitizer.ts et editor/convert.ts (round 1 de revue,
	   2026-08-31 : les trois le réécrivaient chacun, dans un ordre différent,
	   et celui-ci en particulier omettait `q.lessonHtml`). `convertParsedToInternal`
	   a normalement déjà ramené la question aux deux noms canoniques
	   (`lesson`/`_lessonHtml`) ; les noms hérités ne sont relus ici QUE pour un
	   appelant qui construirait une question sans passer par lui (jeux de cas).
	   Dans tous les cas, seul le nom canonique est RÉÉCRIT — jamais
	   `learn`/`learnHtml`/`_learnHtml`.
	   PAS de `isRichHtml` ici, CONTRAIREMENT à explain/explainHtml juste
	   au-dessus : `convertParsedToInternal` ne fabrique plus de `lesson`
	   dérivé d'un HTML non riche (cf. son commentaire), donc `lessonText` ici
	   n'est JAMAIS qu'un texte génuinement écrit à part — les deux ne
	   coexistent que s'ils l'ont VRAIMENT été. Round 1 de revue, FINDING 2 :
	   une version précédente écrivait les deux sans condition (le texte
	   dérivé de convert.ts s'ajoutait au HTML), et une note qui ne portait
	   qu'un `learnHtml` ressortait avec un `lesson:` EN PLUS — un champ
	   AJOUTÉ que l'audit ne voit pas (il cherche les champs perdus, pas les
	   champs ajoutés). */
	const { text: lessonText, html: lessonHtml } = pickLessonFields(q);
	if (lessonText && lessonHtml) {
		L.push(`\t\tlessonHtml: '${e(lessonHtml)}',`);
		L.push(`\t\tlesson: '${e(lessonText)}',`);
	} else if (lessonText) {
		L.push(`\t\tlesson: '${e(lessonText)}',`);
	} else if (lessonHtml) {
		L.push(`\t\tlessonHtml: '${e(lessonHtml)}',`);
	}

	/* Boucle d'apprentissage (mode "lesson", task 2 du lot mode leçon,
	   2026-08-31) : `slice` (numéro de tranche, à partir de 1) et `role`
	   ("pre"/"read"/"recall"/"test", cf. types/quiz.ts QuestionBase) ne sont
	   écrits QUE sous leur forme VALIDE. Contrairement à `_extraFields` — qui
	   recopie un champ personnalisé tel quel, quelle que soit sa forme —
	   ces deux-là pilotent le comportement du moteur (buildLessonModel,
	   task 3 du lot) : un `slice` non entier ou un `role` inconnu doit
	   disparaître plutôt que casser la boucle en silence. `convertParsedToInternal`
	   ne mémorise déjà que la forme de base (nombre / chaîne) ; la validation
	   fine a lieu ICI, seul endroit qui écrit le bloc.
	   `read` (task 6b) : quatrième valeur acceptée, jumelle de la liste de
	   convert.ts et de `QUESTION_ROLES` (types/quiz.ts) — sans elle, un
	   `role: 'read'` lu depuis la note disparaîtrait dès la sauvegarde suivante.
	   La liste n'est plus recopiée en dur ici : `QUESTION_ROLES` est la source
	   unique du vocabulaire, lue des deux côtés (lecture et écriture). */
	if (typeof q.slice === "number" && Number.isInteger(q.slice) && q.slice >= 1) {
		L.push(`\t\tslice: ${q.slice},`);
	}
	if (typeof q.role === "string" && (QUESTION_ROLES as readonly string[]).includes(q.role)) {
		L.push(`\t\trole: '${e(q.role)}',`);
	}

	if (q._extraFields && Object.keys(q._extraFields).length > 0) {
		// Track keys already exported to avoid duplicates
		const exportedKeys = new Set([
			'id', 'title', 'prompt', 'promptHtml', 'options', 'correctIndex',
			'multiSelect', 'correctIndices', 'ordering', 'slots', 'possibilities',
			'correctOrder', 'matching', 'rows', 'choices', 'correctMap', 'type',
			'terminalVariant', 'textVariant', 'commandPrefix', 'placeholder',
			'caseSensitive', 'acceptedAnswers', 'hint', 'explainHtml',
			'resourceButton', 'cloze', 'numeric', 'tolerance', 'tolerancePercent', 'unit',
			// Leçon (mode "lesson") : déjà écrits ci-dessus, les noms canoniques
			// ET les alias hérités ne doivent pas être réécrits une seconde fois
			// via `_extraFields`.
			'lesson', 'lessonHtml', 'learn', 'learnHtml', '_learnHtml',
			// Boucle d'apprentissage (task 2) : déjà traités ci-dessus (validés
			// ou tus) — ne jamais les laisser repasser tels quels par la voie
			// générique, qui ne connaît aucune validation.
			'slice', 'role'
		]);
		for (const [key, val] of Object.entries(q._extraFields)) {
			if (exportedKeys.has(key)) continue; // Skip already exported keys
			/* UNE seule branche, `json5Value`, pour toutes les formes. Les
			   branches d'origine ne savaient écrire que des scalaires et des
			   tableaux de scalaires : un objet imbriqué sortait en
			   `[object Object]` (JSON5 invalide, donc écriture refusée en
			   silence) et un `null` disparaissait purement. Ces clés viennent
			   d'un bloc écrit à la main : on les rend telles qu'on les a lues,
			   quelle que soit leur forme — nom de clé compris. */
			L.push(`\t\t${json5Key(key)}: ${json5Value(val)},`);
		}
	}

	L.push("\t}");
	return L.join("\n");
}

/**
 * Le glossaire, prêt à être écrit : entrées incomplètes (terme ou définition
 * vide après `trim`) ignorées, `aliases` filtré aux formes non vides et omis
 * s'il n'en reste aucune — même tolérance que `lireGlossaire`
 * (src/glossaire.ts), réappliquée ICI plutôt que supposée acquise : la modale
 * « Vocabulaire » (tâche 4 du lot) modifie `examOptions.glossary` en mémoire,
 * sans repasser par cette validation avant chaque sauvegarde différée.
 */
function glossaryEntries(glossary: EntreeGlossaire[] | undefined): EntreeGlossaire[] {
	if (!glossary) return [];
	const sortie: EntreeGlossaire[] = [];
	for (const brut of glossary) {
		const term = (brut.term ?? "").trim();
		const definition = (brut.definition ?? "").trim();
		if (!term || !definition) continue;
		const entree: EntreeGlossaire = { term, definition };
		const aliases = (brut.aliases ?? []).map(a => a.trim()).filter(a => a !== "");
		if (aliases.length > 0) entree.aliases = aliases;
		sortie.push(entree);
	}
	return sortie;
}

/**
 * La ligne `glossary: [...],` de l'objet de configuration, ou une chaîne vide
 * quand il n'y a rien à écrire — c'est cette chaîne vide qui garantit qu'un
 * quiz SANS glossaire ressort octet pour octet comme avant ce champ.
 * `json5Value` (même fonction que le reste du fichier) échappe chaque chaîne
 * via `esc5` : une apostrophe, une barre oblique inverse ou un `$\frac{a}{b}$`
 * dans une définition se relisent à l'identique.
 */
function glossaryLine(glossary: EntreeGlossaire[] | undefined, reste: unknown[] = []): string {
	// Les entrées lues, puis celles que la lecture avait écartées, BRUTES
	// (`_glossaryRest`) : jamais perdues par une sauvegarde qui n'y touche pas.
	const entrees: unknown[] = [...glossaryEntries(glossary), ...reste];
	if (entrees.length === 0) return "";
	// Une entrée par ligne : la note reste lisible (et un diff aussi) avec
	// quinze définitions, là où une seule ligne en faisait un mur.
	return `\t\tglossary: [\n${entrees.map(e => `\t\t\t${json5Value(e)},\n`).join("")}\t\t],\n`;
}

function exportAll(questions: DraftQuestion[], examOptions: EditorExamOptions | null = null): string {
	/* La règle d'identité (id explicite prioritaire, repli sur un slug du
	   titre puis `qN`, suffixe anti-collision qui respecte aussi les
	   réservations à venir) vit désormais dans src/quiz-ids.ts, PARTAGÉE avec
	   le scanner de l'ordonnanceur : lecture et écriture doivent s'accorder
	   sur la même clé, sinon une question change d'identité à sa première
	   sauvegarde depuis l'éditeur (task 5, 2026-09-02). */
	const ids = assignQuestionIds(questions.map(q => ({ id: q._sourceId, title: q.title })));
	const parts = questions.map((q, i) => exportQuestion(q, i, ids[i]));

	/* L'objet de mode est réémis SOUS SA FORME D'ORIGINE. Un quiz importé en
	   mode leçon ressortait en mode examen (ou perdait son mode), parce que
	   l'export ne savait écrire que `examMode: true`. `examOptions.mode` est
	   déjà NORMALISÉ (readModeConfig) : il vaut toujours le nom interne
	   canonique "lesson", jamais l'alias hérité "learn" — mais depuis le
	   format Learn (2026-09-23) l'export RÉÉCRIT ce mode sous le nom du
	   format, `mode: 'learn'` (voir plus bas). */
	const mode = examOptions?.mode;
	const timing = examOptions
		? `\t\texamDurationMinutes: ${examOptions.durationMinutes},\n\t\texamAutoSubmit: ${examOptions.autoSubmit},\n\t\texamShowTimer: ${examOptions.showTimer},\n`
		: "";
	/* Les clés que le plugin ne comprend pas sont RENDUES, comme sur une
	   question : un bloc écrit à la main perdait sinon ses annotations
	   personnelles à la première sauvegarde. */
	const extra = Object.entries(examOptions?._extra || {})
		.map(([k, v]) => `\t\t${json5Key(k)}: ${json5Value(v)},\n`).join("");
	// Glossaire (lot D, 2026-09-27) : chaîne vide sans entrée exploitable — voir
	// `glossaryLine`. Ajouté APRÈS `extra` dans chaque branche, comme dans
	// l'exemple de la spec (`{ mode: 'learn', objectives: [...], glossary: [...] }`).
	const glossaire = glossaryLine(examOptions?.glossary, examOptions?._glossaryRest);
	if (mode === "lesson") {
		/* Learn (2026-09-23) : le nom interne canonique reste "lesson" tant que
		   le moteur de leçon joue ces blocs (plan 2 le remplace), mais la note
		   porte le nom du format, `mode: 'learn'` — que `normalizeQuizMode`
		   relit en "lesson". */
		parts.push(`\t// Learn\n\t{\n\t\tmode: 'learn',\n${examOptions?.enabled ? timing : ""}${extra}${glossaire}\t}`);
	} else if (examOptions && examOptions.enabled) {
		parts.push(`\t// Options mode examen\n\t{\n\t\texamMode: true,\n${timing}${extra}${glossaire}\t}`);
	} else if (mode === "quiz") {
		/* Le mode `quiz` est le comportement par défaut, mais s'il est ÉCRIT
		   dans la note c'est un choix : le taire faisait disparaître l'objet de
		   configuration entier — et ses clés personnalisées avec. */
		parts.push(`\t// Mode quiz\n\t{\n\t\tmode: 'quiz',\n${extra}${glossaire}\t}`);
	} else if (glossaire) {
		/* Glossaire à écrire mais AUCUN mode reconnu par les trois branches
		   ci-dessus (`readModeConfig` en attribue pourtant toujours un dès qu'un
		   objet de configuration existe — cette branche ne se déclenche donc que
		   pour un `EditorExamOptions` construit à la main, ex. la modale
		   « Vocabulaire » sur un Practice qui n'avait PAS d'objet de
		   configuration). `mode: 'quiz'` est écrit explicitement : une version
		   PLUS ANCIENNE du greffon reconnaît `mode`, pas `glossary` seul (spec §2)
		   — sans lui, l'objet redeviendrait une question fantôme pour elle. */
		parts.push(`\t// Mode quiz\n\t{\n\t\tmode: 'quiz',\n${extra}${glossaire}\t}`);
	} else if (extra) {
		// Un objet de mode sans mode reconnaissable, mais porteur de contenu.
		parts.push(`\t{\n${extra}\t}`);
	}
	return "[\n" + parts.join(",\n\n") + "\n]";
}
function exportAllWithFence(questions: DraftQuestion[], examOptions: EditorExamOptions | null = null): string {
	return "```quiz-blocks\n" + exportAll(questions, examOptions) + "\n```";
}

/* `exportQuestion` n'est plus exportée : sa signature a changé (le 3e
   paramètre est désormais obligatoire, et l'affectation `q._sourceId = id`
   n'est plus conditionnée à la présence d'un contexte) et grep sur tout le
   repo ne lui trouve aucun appelant hors de ce fichier — revue 2026-09-03. */
export { exportAll, exportAllWithFence };
