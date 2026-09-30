/**
 * The prompt of each generated type (Learn, Test) describes EVERYTHING the
 * arrival check requires.
 *
 * Test of 2026-09-23: the prompt did not list `explain`, and no explanation
 * was produced — the correction never said why. Both lists live in
 * `src/quiz-format.ts` (CHAMPS_DECRITS, MOTS_INTERDITS): the prompt and the
 * check read the same ones. Since the "Set up your test" change, no prompt
 * asks for an Exam: `mode: "exam"` is forbidden in both.
 *
 *     npm run check:prompt
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/dashboard/ai-client.ts", "src/quiz-format.ts"], ({ composerPrompts }, { CHAMPS_DECRITS, MOTS_INTERDITS, PASSAGES_REQUIS }) => {
	const r = makeReporter("Prompts Learn / Test");
	for (const mode of ["learn", "practice"]) {
		const { systemPrompt } = composerPrompts("Python", { mode, count: null, type: "Mixte" });
		r.check(`${mode} : chaque champ exigé est décrit`, CHAMPS_DECRITS[mode].filter(c => !systemPrompt.includes(c)), []);
		r.check(`${mode} : aucun mode ni champ retiré n'est mentionné`, MOTS_INTERDITS[mode].filter(re => re.test(systemPrompt)).map(String), []);
		/* Du markdown partout (2026-09-26) : la consigne est là, et aucun champ
		   `*Html` n'est nommé (MOTS_INTERDITS ci-dessus). */
		r.check(`${mode} : la consigne markdown est donnée`, PASSAGES_REQUIS.filter(p => !systemPrompt.includes(p)), []);
		r.check(`${mode} : la règle LANGUAGE est gardée`, systemPrompt.includes("THE SAME LANGUAGE AS THE USER REQUEST"), true);
	}
	const auto = composerPrompts("x", { mode: "practice", count: null, type: "Compréhension" }).systemPrompt;
	r.check("Auto + Compréhension : aucun nombre inventé", [/exactly (null|undefined|NaN)/.test(auto), auto.includes("as many questions as the source has EXAMINABLE POINTS")], [false, true]);
	r.check("nombre fixé : exactement N", composerPrompts("x", { mode: "practice", count: 12 }).systemPrompt.includes("exactly 12 questions"), true);
	/* NI PLUS NI MOINS (2026-09-30) : une question par point examinable, jamais
	   un plafond ni un gabarit fixe par tranche — 537 questions pour 3 CM le
	   même jour, 1 amorce + 1 « explique » + 3 rappels par notion, quelle
	   qu'elle soit. */
	const learnAuto = composerPrompts("x", { mode: "learn", count: null }).systemPrompt;
	r.check("Learn en Auto : autant de questions que de points examinables, ni plus ni moins", [
		learnAuto.includes("as many questions as the source has EXAMINABLE POINTS"),
		/at most 20 questions|two to four questions|exactly one question with "role": "explain"/.test(learnAuto),
	], [true, false]);
	r.check("le code d'une phrase va entre backticks, dans les deux modes (sinon __init__ s'affiche en gras)",
		["learn", "practice"].map(m => composerPrompts("x", { mode: m }).systemPrompt.includes("goes between backticks in EVERY text field")), [true, true]);
	r.check("Learn : chaque pré-question a un indice", composerPrompts("x", { mode: "learn", count: null }).systemPrompt.includes("EVERY pre question also has \"hint\""), true);
	r.check("mode absent = Practice", composerPrompts("x", {}).systemPrompt.includes("MODE: PRACTICE"), true);
	const plan = [{ slice: 1, titre: "Types" }, { slice: 2, titre: "Listes" }];
	r.check("Practice : le plan des tranches part dans la demande",
		composerPrompts("x", { mode: "practice", planTranches: plan }).userPrompt.includes("1. Types\n2. Listes"), true);
	r.check("Learn : le plan des tranches est ignoré",
		composerPrompts("x", { mode: "learn", planTranches: plan }).userPrompt.includes("Listes"), false);
	r.check("la carte mémoire est décrite en Learn, jamais en Practice",
		["learn", "practice"].map(m => composerPrompts("x", { mode: m }).systemPrompt.includes('"flashcard": true')), [true, false]);
	r.check("Learn : une carte seulement pour une réponse courte",
		composerPrompts("x", { mode: "learn" }).systemPrompt.includes("ONLY when the answer fits in one sentence, one formula or one line of code"), true);
	r.check("Learn : le texte complet du flashcard du brief",
		composerPrompts("x", { mode: "learn" }).systemPrompt.includes("A recall can also be a FLASHCARD: set \"flashcard\": true, put the question in \"prompt\" (front) and the expected answer in \"answer\" (back), add \"explain\"; no \"options\", no \"type\". Use a flashcard ONLY when the answer fits in one sentence, one formula or one line of code (a definition, a syntax, the output of a short expression), never for a question that needs reasoning or several lines, and for at most half of the recalls of a slice."), true);
	/* Styles de lecture (2026-09-26) : le modèle CHOISIT selon le contenu, et
	   jamais en Practice, qui n'a pas de lecture. */
	const learnP = composerPrompts("x", { mode: "learn" }).systemPrompt;
	r.check("Learn : le style se choisit selon le contenu, varie, et jamais `page` par défaut",
		["CHOOSE for each read card, from its content", "VARY the style between slices", "NEVER take \"page\" by default",
			'"lecture": "etapes" for ONE IDEA PER LINE', '"lecture": "tableau" to COMPARE two or three things on several criteria',
			'"lecture": "page" ONLY for a CONTINUOUS text'].filter(p => !learnP.includes(p)), []);
	r.check("Learn : un exemple court pour chaque style",
		['{ "lecture": "etapes", "prompt"', '"colonnes": ["", "Python", "C"]', '{ "lecture": "page", "prompt"'].filter(p => !learnP.includes(p)), []);
	r.check("Learn : lecture courte et méthode (`methode: true`) au-dessus de la question",
		['set "methode": true on the read card', "a METHOD to apply in the question that follows", "at most about 60 words and 4 steps"].filter(p => !learnP.includes(p)), []);
	r.check("Learn : « À retenir », cartes pour des termes, récapitulatif pour des faits",
		['"forme": "cartes"', "for TERMS to memorize", '"forme": "recap"', "for FACTS to keep"].filter(p => !learnP.includes(p)), []);
	/* Retours du 2026-09-26 (lot B) : indices, mots clés, idiomes, cartes,
	   classement. Chaque consigne est présente mot pour mot. */
	for (const mode of ["learn", "practice"]) {
		const p = composerPrompts("x", { mode }).systemPrompt;
		r.check(`${mode} : indices à niveaux, mots clés en gras, exemple concret, renvoi au cours`,
			["an array of 2 or 3 strings from the lightest clue to the most revealing one", "Put the KEY WORDS of every hint in **bold**",
				"Every hint gives a CONCRETE, DETAILED example", "like `range(1, 3)`, which gives `[1, 2]`", "reread the paragraph on"].filter(s => !p.includes(s)), []);
		r.check(`${mode} : deux ou trois mots clés en gras dans l'explication`, p.includes("put the two or three KEY WORDS in **bold** — no more"), true);
		r.check(`${mode} : un élément de classement est une ligne en code inline, jamais un bloc`,
			p.includes("Each item of \"possibilities\" is ONE single line: a line of code is written as inline `code` between single backticks, NEVER as a fenced ``` block"), true);
		/* Le rendu montre l'indice AVANT toute tentative (engine/cards.ts,
		   engine/hint.ts) : aucun mode ne doit dire le contraire au modèle. */
		r.check(`${mode} : l'indice s'ouvre avant toute tentative, aucune consigne contraire`,
			[p.includes("The learner can open it BEFORE any attempt"), /after a (first )?wrong attempt/i.test(p)], [true, false]);
	}
	r.check("Learn : CHAQUE question a un indice, pas seulement les pré-questions",
		learnP.includes("EVERY question of the path has \"hint\" — pre, explain and recall alike"), true);
	r.check("Learn : un idiome d'une lecture est expliqué en entier (forme compacte, résultat, équivalent)",
		learnP.includes("Every idiom or compact line of a reading is explained IN FULL") && learnP.includes("the compact form, its result, then the developed equivalent"), true);
	r.check("Learn : une étape qui introduit des termes a au moins une carte mémoire",
		learnP.includes("A slice that introduces TERMS, DEFINITIONS or FACTS to memorize has AT LEAST ONE flashcard among its recalls."), true);
	r.check("Practice : les consignes propres au Learn restent absentes",
		["EVERY question of the path has \"hint\"", "AT LEAST ONE flashcard"].filter(s => composerPrompts("x", { mode: "practice" }).systemPrompt.includes(s)), []);
	/* Glossaire (lot D, 2026-09-27) : la consigne GLOSSARY est commune aux trois
	   modes, et chacun porte l'objet de configuration qui la déclenche. */
	for (const mode of ["learn", "practice"]) {
		const p = composerPrompts("x", { mode }).systemPrompt;
		r.check(`${mode} : la consigne du glossaire est donnée`,
			['"glossary"', "GLOSSARY:", "5 to 15 KEY TERMS", "Write \"term\" EXACTLY as it appears in the readings and explanations"].filter(s => !p.includes(s)), []);
		/* Un terme de code (lot D, revue) : "term" en texte simple, jamais entre
		   backticks — un mot-clé ou une fonction du langage garde son nom nu
		   ("yield"), reconnu tel quel dans le code en ligne. */
		r.check(`${mode} : « term » ne s'écrit jamais entre backticks, même pour un mot-clé`,
			['Write "term" in PLAIN TEXT, NEVER between backticks', 'the bare name is the term (e.g. "yield", not `yield`)'].filter(s => !p.includes(s)), []);
	}
	r.check("Practice : l'objet de configuration porte mode: \"quiz\"",
		composerPrompts("x", { mode: "practice" }).systemPrompt.includes('{ mode: "quiz", "glossary"'), true);
	r.check("Practice : plus de « No configuration object »",
		composerPrompts("x", { mode: "practice" }).systemPrompt.includes("No configuration object"), false);

	/* ── Spec 2026-09-29 (test setup) §4: the Test prompt has optional hints and
	   never asks for an Exam; how a Test is taken is chosen when it starts ── */
	const practiceP = composerPrompts("x", { mode: "practice" }).systemPrompt;
	r.check("Test: a hint is optional, added when a question deserves it, no longer expected on every question",
		[practiceP.includes('"hint": optional — add one when a question deserves it'), practiceP.includes('EVERY question has "hint"')], [true, false]);
	r.check("Test: the rest is unchanged (explain required, slice plan, hint levels, runInLastHint)",
		['EVERY question has "explain"', '"slice": when a SLICE PLAN', "HINTS:", "runInLastHint: true ONLY"].filter(p => !practiceP.includes(p)), []);
	r.check("no Exam prompt any more: neither type has an Exam MODE block, and no request produces one",
		[["learn", "practice"].map(m => composerPrompts("x", { mode: m }).systemPrompt.includes("MODE: EXAM")),
			composerPrompts("x", { mode: "exam" }).systemPrompt.includes("MODE: EXAM"),
			composerPrompts("x", { mode: "exam" }).systemPrompt.includes("MODE: PRACTICE")], [[false, false], false, true]);
	r.check("no prompt writes mode: \"exam\" or examDurationMinutes, whatever the options",
		["learn", "practice"].map(m => [{}, { count: 12 }, { examDurationMinutes: 90 }].map(o => /mode:\s*"exam"|examDurationMinutes/.test(composerPrompts("x", { mode: m, ...o }).systemPrompt))),
		[[false, false, false], [false, false, false]]);
	r.check("a duration passed anyway (the retired option) is ignored: it never reaches the prompt",
		["learn", "practice"].map(m => composerPrompts("x", { mode: m, examDurationMinutes: 90 }).systemPrompt.includes("90 minutes")), [false, false]);
	r.check("the format's lists know two generated types only, Learn and Test",
		[Object.keys(CHAMPS_DECRITS), Object.keys(MOTS_INTERDITS)], [["learn", "practice"], ["learn", "practice"]]);
	r.check("forbidden words: mode: \"exam\" and its duration are forbidden in Learn and Test, hints are not forbidden in Test",
		[MOTS_INTERDITS.learn.some(re => re.test('mode: "exam"')), MOTS_INTERDITS.practice.some(re => re.test('mode: "exam"')),
			MOTS_INTERDITS.learn.some(re => re.test("examDurationMinutes")), MOTS_INTERDITS.practice.some(re => re.test("examDurationMinutes")),
			MOTS_INTERDITS.practice.some(re => re.test('"hint"'))], [true, true, true, true, false]);
	r.check("every type forbids the retired keys learnMode, examAutoSubmit, examShowTimer",
		["learn", "practice"].map(m => ["learnMode", "examAutoSubmit", "examShowTimer"].filter(k => !MOTS_INTERDITS[m].some(re => re.test(k)))), [[], []]);
	r.done();
});

/* LA CATÉGORIE (retour #7) : chaque complément part dans le prompt système
   des deux modes, une seule fois, et `general` n'ajoute rien. */
await withSrcModule(["src/dashboard/ai-client.ts", "src/dashboard/categorie-prompt.ts", "src/dashboard/categorie-quiz.ts", "src/quiz-format.ts"], ({ composerPrompts }, { complementCategorie }, { CATEGORIES }, { MOTS_INTERDITS: MOTS_INTERDITS_PAR_MODE }) => {
	const r = makeReporter("Prompts par catégorie");
	const sans = composerPrompts("x", { mode: "learn" }).systemPrompt;
	r.check("general : prompt identique à l'absence de catégorie", composerPrompts("x", { mode: "learn", categorie: "general" }).systemPrompt, sans);
	for (const cat of CATEGORIES.filter(c => c !== "general")) {
		const complement = complementCategorie(cat);
		r.check(`${cat} : un complément non vide`, complement.length > 40, true);
		for (const mode of ["learn", "practice"]) {
			const p = composerPrompts("x", { mode, categorie: cat }).systemPrompt;
			r.check(`${cat} / ${mode} : le complément est ajouté, une fois`, p.split(complement).length - 1, 1);
			r.check(`${cat} / ${mode} : le reste du prompt est gardé`, p.includes("THE SAME LANGUAGE AS THE USER REQUEST") && p.includes("EXPLANATIONS:"), true);
			r.check(`${cat} / ${mode} : the complement introduces no forbidden word of the mode`, MOTS_INTERDITS_PAR_MODE[mode].filter(re => re.test(p)).map(String), []);
		}
		r.check(`${cat} : aucun autre complément`, CATEGORIES.filter(c => c !== "general" && c !== cat && composerPrompts("x", { categorie: cat }).systemPrompt.includes(complementCategorie(c))), []);
	}
	const py = complementCategorie("python");
	r.check("python : blocs ```python, sortie de print, idiome compact puis boucle, exemples exécutables",
		["```python", "`print`", "the compact form, its result, then its equivalent with a plain loop", "RUNNABLE"].filter(s => !py.includes(s)), []);
	r.done();
});

await withSrcModule(["src/dashboard/ai-client.ts"], ({ composerPrompts }) => {
	const r = makeReporter("Prompts Learn / Practice (styles)");
	const learnP = composerPrompts("x", { mode: "learn" }).systemPrompt;
	r.check("Learn : le style reste choisi selon le contenu", learnP.includes("CHOOSE for each read card, from its content"), true);
	r.check("Practice : aucun style de lecture",
		['"lecture"', '"retenir"', '"etapes"'].filter(p => composerPrompts("x", { mode: "practice" }).systemPrompt.includes(p)), []);
	r.done();
});

/* LA RÉPONSE STRUCTURÉE D'OLLAMA (lot D, revue du 2026-09-27) : le schéma
   `format` décrit `mode`, `objectives` et `glossary` au NIVEAU RACINE de
   l'objet, à côté de `questions` — jamais dans le schéma d'une question, qui
   exige "title" et "prompt". `assemblerQuestionsOllama` réassemble le
   tableau final ; noyau PUR, éprouvé isolément ici plutôt que via un vrai
   appel HTTP. */
await withSrcModule("src/dashboard/ai-client.ts", ({ assemblerQuestionsOllama, parseOllamaResponse }) => {
	const r = makeReporter("Lecture de la réponse Ollama — glossaire et mode racine");
	const q1 = { title: "Q1", prompt: "Une pile ?", options: ["a", "b"], correctIndex: 0 };
	r.check("mode + objectives + glossary racine : ajoutés en un seul objet de configuration final",
		assemblerQuestionsOllama({ questions: [q1], mode: "learn", objectives: ["Définir une pile"], glossary: [{ term: "pile", definition: "LIFO." }] }),
		[q1, { mode: "learn", objectives: ["Définir une pile"], glossary: [{ term: "pile", definition: "LIFO." }] }]);
	r.check("glossary racine seul (Practice) : { glossary } en fin de tableau",
		assemblerQuestionsOllama({ questions: [q1], glossary: [{ term: "pile", definition: "LIFO." }] }),
		[q1, { glossary: [{ term: "pile", definition: "LIFO." }] }]);
	r.check("aucun champ racine renseigné : le tableau de questions, inchangé",
		assemblerQuestionsOllama({ questions: [q1] }), [q1]);
	r.check("champs racine vides (mode blanc, tableaux vides) : rien n'est ajouté",
		assemblerQuestionsOllama({ questions: [q1], mode: "  ", objectives: [], glossary: [] }), [q1]);
	const dejaConfig = { mode: "quiz", glossary: [{ term: "pile", definition: "LIFO." }] };
	r.check("une configuration déjà glissée dans questions (schéma ignoré par le modèle) : pas de doublon",
		assemblerQuestionsOllama({ questions: [q1, dejaConfig], mode: "quiz", glossary: [{ term: "autre", definition: "x" }] }),
		[q1, dejaConfig]);
	r.check("a root examDurationMinutes (a retired field) is not carried over into the configuration",
		assemblerQuestionsOllama({ questions: [q1], mode: "quiz", examDurationMinutes: 45 }), [q1, { mode: "quiz" }]);
	r.check("a root examDurationMinutes alone adds no configuration object",
		assemblerQuestionsOllama({ questions: [q1], examDurationMinutes: 45 }), [q1]);
	r.check("bout en bout : parseOllamaResponse lit {questions, mode, glossary} et rend le tableau fusionné",
		parseOllamaResponse(JSON.stringify({ title: "T", questions: [q1], mode: "learn", objectives: ["Définir"], glossary: [{ term: "pile", definition: "LIFO." }] })).questions,
		[q1, { mode: "learn", objectives: ["Définir"], glossary: [{ term: "pile", definition: "LIFO." }] }]);
	r.done();
});
