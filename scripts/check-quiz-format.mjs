/**
 * The Learn / Test FORMAT, read through the real modules `src/quiz-format.ts`
 * and `src/quiz-utils.ts`.
 *
 * What it prevents: a Practice or an Exam without explanations, a Learn
 * whose slice lacks its pre-question, reading or recalls, a `slice` that
 * points nowhere — all accepted without a word before; an Exam taken for a
 * Practice (or its " — Exam" suffix left in the title); a retired key
 * (`lesson`, `examMode`, `learnMode`, `examAutoSubmit`, `examShowTimer`)
 * still read; and an Exam duration outside [1, 300] or missing without the
 * fallback rule. A gap is REPORTED, never a failure: the check returns a
 * list, it throws nothing.
 *
 *     npm run check:quiz-format
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/quiz-format.ts", ({ modeDuBloc, verifierFormat, planDesTranches, lireBlocQuiz, nomDeNote, titreSansMode, completerConfigLearn, fusionnerConfigsFinales, estCarte, fallbackExamDuration, clampExamDuration }) => {
	const r = makeReporter("Format Learn / Test");

	/* The mode stays in the file NAME (readable in Obsidian) but not in the
	   displayed TITLE of the application, which shows it as a badge. */
	r.check("file name of a Learn, a Practice and an Exam",
		[nomDeNote("CM1", "learn"), nomDeNote("CM1", "practice"), nomDeNote("CM1", "exam")], ["CM1 — Learn", "CM1 — Practice", "CM1 — Exam"]);
	r.check("displayed title without the suffix of its mode",
		[titreSansMode("CM1 — Learn", "learn"), titreSansMode("CM1 — Practice", "practice"), titreSansMode("Réseaux — Exam", "exam")], ["CM1", "CM1", "Réseaux"]);
	r.check("a suffix that is not the real mode's stays, and so does a name that is ONLY the suffix",
		[titreSansMode("CM1 — Learn", "practice"), titreSansMode(" — Learn", "learn"), titreSansMode("Quiz libre", "practice"), titreSansMode("CM1 — Exam", "practice"), titreSansMode("CM1 — Practice", "exam")],
		["CM1 — Learn", " — Learn", "Quiz libre", "CM1 — Exam", "CM1 — Practice"]);
	const q = (o) => ({ title: "Q", prompt: "Énoncé ?", options: ["a", "b"], correctIndex: 0, explain: "Parce que.", ...o });

	r.check("bloc sans objet de mode = Practice", modeDuBloc([q()]), "practice");
	r.check("objet { mode: \"learn\" } = Learn", modeDuBloc([q(), { mode: "learn", objectives: ["x"] }]), "learn");
	r.check("{ mode: \"exam\" } = Exam, case and spaces tolerated",
		[{ mode: "exam", examDurationMinutes: 60 }, { mode: " Exam " }].map(c => modeDuBloc([q(), c])), ["exam", "exam"]);
	r.check("retired values lesson, examMode, learnMode = Practice",
		[{ mode: "lesson" }, { examMode: true }, { learnMode: true }].map(c => modeDuBloc([q(), c])),
		["practice", "practice", "practice"]);

	/* Duration of an Exam (spec 2026-09-29 §1.1-§1.2): bounded to [1, 300],
	   1 min 30 per question rounded to 5 minutes when missing. */
	r.check("fallback duration: 1 min 30 per question, rounded to 5 min",
		[1, 2, 10, 15, 20, 33].map(fallbackExamDuration), [1, 5, 15, 25, 30, 50]);
	r.check("fallback duration: bounded to [1, 300]", [fallbackExamDuration(0), fallbackExamDuration(-3), fallbackExamDuration(500)], [1, 1, 300]);
	r.check("typed duration: whole minutes within [1, 300], null when not a positive number",
		[clampExamDuration(90), clampExamDuration(301), clampExamDuration(0.4), clampExamDuration("45"), clampExamDuration(0), clampExamDuration("x"), clampExamDuration(undefined), clampExamDuration(-5)],
		[90, 300, 1, 45, null, null, null, null]);
	r.check("Exam: every question without an explanation is named, no slice required",
		verifierFormat("exam", [q({ title: "Pile", explain: "" }), q({ title: "File" }), { mode: "exam", examDurationMinutes: 30 }]),
		[{ kind: "sansExplication", questions: ["Pile"] }]);
	r.check("Exam: a flashcard without a back is reported",
		verifierFormat("exam", [q({ title: "Carte", options: undefined, correctIndex: undefined, flashcard: true })]),
		[{ kind: "carteSansReponse", questions: ["Carte"] }]);
	/* Glossaire (lot D, 2026-09-27) : un Practice terminé par la configuration
	   que la génération écrit désormais (`{ mode: "quiz", glossary }`) reste un
	   Practice, sans manque — ni devenir un Learn, ni signaler d'objectifs
	   absents (ce qui n'est exigé que du Learn). */
	const configGlossaire = { mode: "quiz", glossary: [{ term: "pile", definition: "Une structure LIFO." }] };
	r.check("objet { mode: \"quiz\", glossary } = Practice, pas Learn", modeDuBloc([q(), configGlossaire]), "practice");
	r.check("Practice terminé par sa configuration de glossaire : aucun manque",
		verifierFormat("practice", [q(), q({ title: "R" }), configGlossaire]), []);

	r.check("Practice complet : aucun manque", verifierFormat("practice", [q(), q({ title: "R" })]), []);
	r.check("Practice : les questions sans explication sont nommées",
		verifierFormat("practice", [q({ title: "Listes", explain: "" }), q({ title: "Tuples", explain: undefined, explainHtml: "<p>ok</p>" }), q({ title: "Sets", explain: "  " })]),
		[{ kind: "sansExplication", questions: ["Listes", "Sets"] }]);
	r.check("Practice : une tranche absente du Learn est signalée",
		verifierFormat("practice", [q({ title: "A", slice: 1 }), q({ title: "B", slice: 9 }), q({ title: "C" })], [1, 2, 3]),
		[{ kind: "trancheInconnue", questions: ["B"] }]);
	r.check("Practice sans Learn connu : slice non vérifié", verifierFormat("practice", [q({ slice: 9 })]), []);

	/* `runInLastHint` (task 7 of the C/C++ execution plan, 2026-09-28): a
	   manque when the field is `true` but `runInLastHintProbleme`
	   (src/code-languages.ts) rejects it — never when absent or `false`. */
	const bug = (o) => q({ prompt: "Bug ?\n\n```c\nint x\n```", hint: ["a", "b"], runInLastHint: true, ...o });
	r.check("runInLastHint valid: no manque", verifierFormat("practice", [bug()]).some(m => m.kind === "runInLastHintInvalide"), false);
	r.check("runInLastHint with one hint level", verifierFormat("practice", [bug({ hint: "a" })]).find(m => m.kind === "runInLastHintInvalide")?.questions.length, 1);
	r.check("runInLastHint on a program output question",
		verifierFormat("practice", [bug({ options: undefined, correctIndex: undefined, type: "text", terminalVariant: "c", acceptedAnswers: ["3"] })]).some(m => m.kind === "runInLastHintInvalide"), true);
	r.check("runInLastHint: false is never a manque", verifierFormat("practice", [bug({ runInLastHint: false, hint: "a" })]).some(m => m.kind === "runInLastHintInvalide"), false);

	const tranche = (s) => [
		q({ title: `pre${s}`, slice: s, role: "pre", hint: "Pense à la définition." }),
		{ title: `Lecture ${s}`, prompt: "Passage.", slice: s, role: "read" },
		{ title: `expl${s}`, prompt: "Explique.", type: "text", answer: "Modèle.", slice: s, role: "explain", hint: "Relis le paragraphe sur les listes." },
		// Un indice à deux niveaux, du plus léger au plus révélateur.
		q({ title: `rec${s}`, slice: s, role: "recall", hint: ["Pense à **range**.", "Comme `range(1, 3)` qui donne `[1, 2]`."] }),
	];
	const config = { mode: "learn", objectives: ["Définir une liste"] };
	r.check("Learn complet : aucun manque", verifierFormat("learn", [...tranche(1), ...tranche(2), config]), []);
	r.check("Learn : tranche sans lecture ni rappel, question hors tranche, objectifs absents",
		verifierFormat("learn", [q({ title: "pre1", slice: 1, role: "pre" }), q({ title: "Orpheline" }), ...tranche(2), { mode: "learn" }]),
		[
			{ kind: "sansObjectifs" },
			{ kind: "sansTranche", questions: ["Orpheline"] },
			{ kind: "trancheIncomplete", slice: 1, rolesManquants: ["read", "recall"] },
				{ kind: "preSansIndice", questions: ["pre1"] },
				{ kind: "sansIndice", questions: ["Orpheline"] },
		]);

	r.check("Learn : une pré-question sans indice est nommée, un indice vide aussi",
		verifierFormat("learn", [...tranche(1), q({ title: "Sans", slice: 1, role: "pre" }), q({ title: "Vide", slice: 1, role: "pre", hint: "  " }), config]),
		[{ kind: "preSansIndice", questions: ["Sans", "Vide"] }]);
	r.check("Practice : l'indice n'est pas exigé", verifierFormat("practice", [q({ role: "pre" })]), []);
	/* CHAQUE question d'un Learn a un indice (retours du 2026-09-26, #1 et
	   #10) : un rappel, une explication aussi. Un indice en TABLEAU de niveaux
	   compte ; un tableau sans texte, un nombre, non. La lecture et la carte
	   mémoire n'en ont pas besoin. */
	r.check("Learn : un rappel ou une explication sans indice est nommé, un indice invalide aussi",
		verifierFormat("learn", [...tranche(1),
			q({ title: "RappelSans", slice: 1, role: "recall" }),
			{ title: "ExplSans", prompt: "Explique.", type: "text", answer: "M.", slice: 1, role: "explain" },
			q({ title: "Nombre", slice: 1, role: "recall", hint: 42 }),
			q({ title: "TableauVide", slice: 1, role: "recall", hint: ["", "  ", 3] }),
			q({ title: "Niveaux", slice: 1, role: "recall", hint: ["", "Un seul niveau utile."] }),
			{ title: "CarteSans", prompt: "x", flashcard: true, answer: "y", slice: 1, role: "recall" },
			config]),
		[{ kind: "sansIndice", questions: ["RappelSans", "ExplSans", "Nombre", "TableauVide"] }]);
	r.check("Learn : une pré-question avec un indice en tableau n'est pas signalée",
		verifierFormat("learn", [...tranche(1), q({ title: "PreN", slice: 1, role: "pre", hint: ["a", "b"] }), config]), []);

	const carte = (o) => ({ title: "Carte", prompt: "Que renvoie `type([])` ?", flashcard: true, answer: "`<class 'list'>`", ...o });
	r.check("estCarte : flashcard === true seulement",
		[estCarte(carte()), estCarte({ flashcard: "true" }), estCarte({ prompt: "x" }), estCarte(null)],
		[true, false, false, false]);
	r.check("Learn : une carte complète n'ajoute aucun manque",
		verifierFormat("learn", [...tranche(1), carte({ slice: 1, role: "recall", explain: "Liste." }), config]), []);
	r.check("Learn : une carte sans verso (absent ou blanc) est nommée",
		verifierFormat("learn", [...tranche(1), carte({ title: "A", slice: 1, role: "recall", answer: undefined }), carte({ title: "B", slice: 1, role: "recall", answer: "  " }), config]),
		[{ kind: "carteSansReponse", questions: ["A", "B"] }]);
	r.check("Practice : une carte sans verso est nommée aussi (le moteur la joue quel que soit le mode)",
		verifierFormat("practice", [carte({ title: "C", answer: "", explain: "x" })]),
		[{ kind: "carteSansReponse", questions: ["C"] }]);


	const sansMode = [...tranche(1), { objectives: ["Définir l'OSINT"] }];
	r.check("Learn demandé, mode oublié : les objectifs deviennent la configuration",
		[modeDuBloc(sansMode), modeDuBloc(completerConfigLearn(sansMode)), completerConfigLearn(sansMode).length, completerConfigLearn(sansMode).at(-1).objectives[0]],
		["practice", "learn", sansMode.length, "Définir l'OSINT"]);
	r.check("Learn demandé, aucune configuration : elle est ajoutée",
		[modeDuBloc(completerConfigLearn(tranche(1))), completerConfigLearn(tranche(1)).length], ["learn", tranche(1).length + 1]);
	r.check("sans rôle de parcours, rien n'est inventé",
		completerConfigLearn([q(), q({ title: "R" })]).length, 2);
	r.check("déjà un Learn : inchangé",
		JSON.stringify(completerConfigLearn([...tranche(1), config])), JSON.stringify([...tranche(1), config]));

	/* CONFIGURATION SCINDÉE en deux objets consécutifs (lot D, revue du
	   2026-09-27) : un modèle répond parfois `{ mode: "learn", objectives }`
	   puis `{ glossary }` à la suite, ou l'inverse. Avant `fusionnerConfigsFinales`,
	   un seul des deux survivait selon l'ordre — le mode (Learn enregistré
	   Practice) ou le glossaire — et l'autre devenait une question fantôme.
	   `trierClefs` : l'ORDRE des clés du résultat suit l'ordre de fusion (donc
	   l'ordre d'ENTRÉE), non pertinent pour le comportement (chaque lecteur du
	   format lit un champ par son NOM) — sans lui, la comparaison par
	   JSON.stringify de `r.check` distinguerait deux objets identiques. */
	const trierClefs = (v) => Array.isArray(v) ? v.map(trierClefs)
		: v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, trierClefs(v[k])]))
		: v;
	const glossairePile = [{ term: "pile", definition: "Structure LIFO." }];
	const configLearn = { mode: "learn", objectives: ["Définir une pile"] };
	const configGloss = { glossary: glossairePile };
	const fusion = trierClefs({ mode: "learn", objectives: ["Définir une pile"], glossary: glossairePile });
	r.check("fusionnerConfigsFinales : mode+objectives puis glossary, ou l'inverse — un seul objet final dans les deux ordres",
		[fusionnerConfigsFinales([...tranche(1), configLearn, configGloss]), fusionnerConfigsFinales([...tranche(1), configGloss, configLearn])]
			.map(items => [items.length, trierClefs(items.at(-1))]),
		[[tranche(1).length + 1, fusion], [tranche(1).length + 1, fusion]]);
	r.check("fusionnerConfigsFinales : une seule configuration, ou aucune — inchangé",
		[fusionnerConfigsFinales([...tranche(1), configLearn]), fusionnerConfigsFinales([q(), q({ title: "R" })])],
		[[...tranche(1), configLearn], [q(), q({ title: "R" })]]);
	r.check("fusionnerConfigsFinales : un objet du MILIEU n'est jamais fusionné (ce serait toucher une vraie question)",
		fusionnerConfigsFinales([configGloss, ...tranche(1), configLearn]).length, tranche(1).length + 2);
	r.check("completerConfigLearn : le mode ET le glossaire d'une configuration scindée survivent, dans les deux ordres",
		[completerConfigLearn([...tranche(1), configLearn, configGloss]), completerConfigLearn([...tranche(1), configGloss, configLearn])]
			.map(items => [modeDuBloc(items), items.length, trierClefs(items.at(-1))]),
		[["learn", tranche(1).length + 1, fusion], ["learn", tranche(1).length + 1, fusion]]);

	r.check("plan des tranches : titre de la lecture, sinon de la première question, trié",
		planDesTranches([q({ title: "pre2", slice: 2, role: "pre" }), ...tranche(1), q({ title: "x", slice: 2, role: "recall" }), config]),
		[{ slice: 1, titre: "Lecture 1" }, { slice: 2, titre: "pre2" }]);
	r.check("plan des tranches d'une entrée invalide : vide",
		[planDesTranches([]), planDesTranches([null, 3, "x"])], [[], []]);

	r.check("lireBlocQuiz lit le premier bloc",
		lireBlocQuiz("# T\n\n```quiz-blocks\n[{ title: 'A', prompt: 'B' }]\n```\n"), [{ title: "A", prompt: "B" }]);
	r.check("lireBlocQuiz : note sans bloc ou JSON5 cassé → null",
		[lireBlocQuiz("rien"), lireBlocQuiz("```quiz-blocks\n[{ title: \n```")], [null, null]);
	r.done();
});

/* Les STYLES DE LECTURE (2026-09-26, spec des styles §2 et §6) : la seule
   lecture des champs `lecture`, `etapes`, `tableau`, `retenir`. Une valeur
   qu'elle ne comprend pas retombe sur le comportement d'avant, sans erreur. */
await withSrcModule("src/lecture-style.ts", ({ lireLecture, styleDeLecture, tableauDeLecture, retenirDeLecture, etapesDeLecture, paragraphes, estMethode, motsDeLecture }) => {
	const r = makeReporter("Styles de lecture (format)");
	r.check("style : les trois valeurs connues",
		["page", "etapes", "tableau"].map(v => styleDeLecture({ lecture: v })), ["page", "etapes", "tableau"]);
	r.check("style : absent, inconnu, mal typé → page",
		[styleDeLecture({}), styleDeLecture({ lecture: "Etapes" }), styleDeLecture({ lecture: "callout" }), styleDeLecture({ lecture: 2 }), styleDeLecture(null)],
		["page", "page", "page", "page", "page"]);
	r.check("étapes : les chaînes non vides seulement",
		etapesDeLecture({ etapes: ["a", "", "  ", 3, null, "b"] }), ["a", "b"]);
	r.check("étapes absentes ou pas une liste : vide", [etapesDeLecture({}), etapesDeLecture({ etapes: "a" })], [[], []]);
	r.check("tableau aux lignes inégales : complété de cases vides",
		tableauDeLecture({ tableau: { colonnes: ["", "Python", "C"], lignes: [["Exécution", "Interprété", "Compilé"], ["Mémoire", "Auto"], ["Typage", "Dyn", "Stat", "en trop"]] } }),
		{ colonnes: ["", "Python", "C", ""], lignes: [["Exécution", "Interprété", "Compilé", ""], ["Mémoire", "Auto", "", ""], ["Typage", "Dyn", "Stat", "en trop"]] });
	r.check("tableau : nombres écrits, autres cases vides, lignes qui ne sont pas des listes écartées",
		tableauDeLecture({ tableau: { colonnes: ["A", 2], lignes: [[1, { x: 1 }], "pas une ligne", [null]] } }),
		{ colonnes: ["A", "2"], lignes: [["1", ""], ["", ""]] });
	r.check("tableau sans ligne, mal formé ou absent : null",
		[tableauDeLecture({ tableau: { colonnes: ["a"], lignes: [] } }), tableauDeLecture({ tableau: [] }), tableauDeLecture({ tableau: "x" }), tableauDeLecture({})],
		[null, null, null, null]);
	r.check("tableau à en-tête vide : pas d'en-tête",
		tableauDeLecture({ tableau: { colonnes: ["", ""], lignes: [["a", "b"]] } }).colonnes, []);
	r.check("retenir cartes : recto ET verso exigés",
		retenirDeLecture({ retenir: { forme: "cartes", items: [{ recto: "Terme", verso: "Sens" }, { recto: "Seul" }, "texte", { recto: " ", verso: "x" }] } }),
		{ forme: "cartes", items: [{ recto: "Terme", verso: "Sens" }] });
	r.check("retenir recap : chaînes non vides",
		retenirDeLecture({ retenir: { forme: "recap", items: ["Fait", "", 3, "Autre"] } }), { forme: "recap", items: ["Fait", "Autre"] });
	r.check("retenir mal formé ignoré sans erreur : forme inconnue, items absent ou pas une liste, aucun élément valide, pas un objet",
		[{ forme: "glossaire", items: ["a"] }, { forme: "recap" }, { forme: "cartes", items: "a" }, { forme: "cartes", items: [{ recto: "a" }] }, "recap", ["a"], null]
			.map(v => retenirDeLecture({ retenir: v })),
		[null, null, null, null, null, null, null]);
	r.check("lecture ancienne (aucun champ) : page, rien d'autre",
		lireLecture({ role: "read", prompt: "Texte." }), { style: "page", etapes: [], tableau: null, retenir: null });
	r.check("paragraphes : coupés sur la ligne vide, jamais dans un bloc de code",
		paragraphes("Un.\n\nDeux\nsuite.\n\n```python\na = 1\n\nb = 2\n```\n\n\nTrois."),
		["Un.", "Deux\nsuite.", "```python\na = 1\n\nb = 2\n```", "Trois."]);
	r.check("méthode : seul le booléen `true`, sur l'élément ou dans `_extraFields`",
		[estMethode({ methode: true }), estMethode({ methode: "true" }), estMethode({ methode: 1 }), estMethode({}), estMethode({ _extraFields: { methode: true } })],
		[true, false, false, false, true]);
	r.check("longueur d'une lecture : texte, étapes, cases du tableau et points à retenir",
		motsDeLecture({ prompt: "un deux", etapes: ["trois quatre"], tableau: { colonnes: ["cinq"], lignes: [["six", "sept"]] }, retenir: { forme: "cartes", items: [{ recto: "huit", verso: "neuf dix" }] } }), 10);
	r.done();
});

/* Les NIVEAUX D'UN INDICE (2026-09-26) : `hint` est une chaîne OU un tableau
   de chaînes ; une valeur invalide est ignorée. */
await withSrcModule("src/quiz-hint.ts", ({ niveauxIndice, aIndice }) => {
	const r = makeReporter("Niveaux d'un indice");
	r.check("une chaîne : un niveau, texte d'origine gardé", niveauxIndice(" Pense à range. "), [" Pense à range. "]);
	r.check("un tableau : ses textes non vides, dans l'ordre",
		niveauxIndice(["léger", "", "  ", "révélateur"]), ["léger", "révélateur"]);
	r.check("valeurs invalides ignorées : nombre, objet, null, tableau sans texte, élément non texte",
		[niveauxIndice(42), niveauxIndice({ a: 1 }), niveauxIndice(null), niveauxIndice(["", 3]), niveauxIndice(["ok", 3, null])],
		[[], [], [], [], ["ok"]]);
	r.check("aIndice suit niveauxIndice", [aIndice("x"), aIndice(["", "y"]), aIndice("  "), aIndice([]), aIndice(undefined)], [true, true, false, false, false]);
	r.done();
});

await withSrcModule("src/dashboard/ai-sources.ts", ({ nomDeSource, debutDeDemande, trouverLearn }) => {
	const r = makeReporter("Source d'une note, et son Learn");
	r.check("la première pièce jointe, sans extension", nomDeSource([{ name: "CM1 - Introduction à Python.pdf" }, { name: "TP1.md" }], "Fais-moi un quiz", "Nouveau quiz"), "CM1 - Introduction à Python");
	/* Sans pièce jointe, la source est la DEMANDE — la même au lancement
	   (recherche du Learn) et à l'enregistrement : le titre du modèle, connu
	   seulement après, la faisait diverger. */
	r.check("sans pièce jointe : le début de la demande", nomDeSource([], "Python : les bases\navec des exemples", "Nouveau quiz"), "Python - les bases");
	r.check("ni pièce ni demande : le repli", nomDeSource([], "", "Nouveau quiz"), "Nouveau quiz");
	r.check("caractères interdits d'un nom de fichier remplacés", nomDeSource([{ name: "CM1: Python/avancé?.pdf" }], "", "x"), "CM1- Python-avancé-");
	r.check("une longue demande est coupée au dernier mot entier",
		debutDeDemande("Les suites numériques en terminale : suites arithmétiques et géométriques"),
		{ texte: "Les suites numériques en terminale : suites arithmétiques", coupee: true });

	const note = (path, mode, source, generatedAt = "2026-09-23T10:00:00Z") => ({ path, mode, generated: { source, generatedAt } });
	const notes = [
		note("Racine/XTI/CM1.md", "practice", "CM1"),
		note("Racine/XTI/Autre/Learn CM1.md", "learn", "CM1"),
		note("Racine/XTI/Parcours CM1.md", "learn", "CM1", "2026-09-22T10:00:00Z"),
		note("Racine/XTI/Parcours CM1 v2.md", "learn", "CM1", "2026-09-23T12:00:00Z"),
		note("Racine/XTI/Parcours CM2.md", "learn", "CM2"),
		{ path: "Racine/XTI/Main.md", mode: "learn" },
	];
	r.check("le Learn de la même source, dans le même dossier, le plus récent",
		trouverLearn(notes, "Racine/XTI", "CM1")?.path, "Racine/XTI/Parcours CM1 v2.md");
	r.check("aucun Learn de cette source : null", trouverLearn(notes, "Racine/XTI", "CM3"), null);
	r.check("un Learn d'un sous-dossier ne compte pas", trouverLearn(notes, "Racine/XTI/Autre", "CM2"), null);
	r.done();
});

/* The ENGINE's reading of the configuration (`extractExamOptions`), which
   decides what is played: an Exam and its clock, a Learn, or a Practice. */
await withSrcModule("src/quiz-utils.ts", ({ extractExamOptions, findQuizModeConfigIndex }) => {
	const r = makeReporter("Configuration read by the engine");
	const q = (o) => ({ title: "Q", prompt: "Énoncé ?", options: ["a", "b"], correctIndex: 0, ...o });
	const lu = (config, n = 1) => extractExamOptions([...Array.from({ length: n }, (_, i) => q({ title: `Q${i}` })), config]);

	const exam = lu({ mode: "exam", examDurationMinutes: 125 });
	r.check("mode: \"exam\" is an Exam with its duration, up to 300", [exam.quizMode, exam.examOptions?.durationMinutes, lu({ mode: "exam", examDurationMinutes: 999 }).examOptions?.durationMinutes], ["exam", 125, 300]);
	/* 14 questions → 20 min, 15 → 25: counting the configuration object as a
	   question would show. */
	r.check("an Exam without a duration gets the fallback rule, on its questions only", lu({ mode: "exam" }, 14).examOptions?.durationMinutes, 20);
	r.check("examAutoSubmit / examShowTimer are no longer read: an Exam's options are its duration",
		lu({ mode: "exam", examDurationMinutes: 10, examAutoSubmit: false, examShowTimer: false }).examOptions, { durationMinutes: 10 });
	r.check("a duration on a Learn or a Practice is ignored (no Learn → Exam switch any more)",
		[lu({ mode: "learn", examDurationMinutes: 15 }), lu({ mode: "quiz", examDurationMinutes: 15 })].map(x => [x.examOptions, "lessonExamOptions" in x]), [[null, false], [null, false]]);
	r.check("mode: \"learn\" is a Learn, mode: \"quiz\" a Practice", [lu({ mode: "learn" }).quizMode, lu({ mode: "quiz" }).quizMode], ["lesson", "quiz"]);
	/* Retired values (spec 2026-09-29 §1.1): `mode: "lesson"` is not a mode
	   any more, and the booleans do not make a configuration — no
	   compatibility, the vaults had no such note. */
	r.check("mode: \"lesson\" is not a Learn", lu({ mode: "lesson", source: "[[CM1]]" }).quizMode, "quiz");
	r.check("examMode / learnMode no longer mark a configuration",
		[findQuizModeConfigIndex([q(), { examMode: true }]), findQuizModeConfigIndex([q(), { learnMode: true }])], [-1, -1]);
	r.done();
});
