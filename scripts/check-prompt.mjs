/**
 * Le prompt de chaque mode décrit TOUT ce que le contrôle à l'arrivée exige.
 *
 * Test du 2026-09-23 : le prompt ne listait pas `explain`, et aucune
 * explication n'était produite — la correction ne disait jamais pourquoi.
 * Les deux listes vivent dans `src/quiz-format.ts` (CHAMPS_DECRITS,
 * MOTS_INTERDITS) : le prompt et la vérification lisent la même.
 *
 *     npm run check:prompt
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/dashboard/ai-client.ts", "src/quiz-format.ts"], ({ composerPrompts }, { CHAMPS_DECRITS, MOTS_INTERDITS, PASSAGES_REQUIS }) => {
	const r = makeReporter("Prompts Learn / Practice");
	for (const mode of ["learn", "practice"]) {
		const { systemPrompt } = composerPrompts("Python", { mode, count: null, type: "Mixte" });
		r.check(`${mode} : chaque champ exigé est décrit`, CHAMPS_DECRITS[mode].filter(c => !systemPrompt.includes(c)), []);
		r.check(`${mode} : aucun mode ni champ retiré n'est mentionné`, MOTS_INTERDITS.filter(re => re.test(systemPrompt)).map(String), []);
		/* Du markdown partout (2026-09-26) : la consigne est là, et aucun champ
		   `*Html` n'est nommé (MOTS_INTERDITS ci-dessus). */
		r.check(`${mode} : la consigne markdown est donnée`, PASSAGES_REQUIS.filter(p => !systemPrompt.includes(p)), []);
		r.check(`${mode} : la règle LANGUAGE est gardée`, systemPrompt.includes("THE SAME LANGUAGE AS THE USER REQUEST"), true);
	}
	const auto = composerPrompts("x", { mode: "practice", count: null, type: "Compréhension" }).systemPrompt;
	r.check("Auto + Compréhension : aucun nombre inventé", [/exactly (null|undefined|NaN)/.test(auto), auto.includes("between 10 and 20")], [false, true]);
	r.check("nombre fixé : exactement N", composerPrompts("x", { mode: "practice", count: 12 }).systemPrompt.includes("exactly 12 questions"), true);
	r.check("Learn en Auto : 20 questions au plus, sauf nécessité", composerPrompts("x", { mode: "learn", count: null }).systemPrompt.includes("at most 20 questions in total"), true);
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
	/* Glossaire (lot D, 2026-09-27) : la consigne GLOSSARY est commune aux deux
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
	r.done();
});

/* LA CATÉGORIE (retour #7) : chaque complément part dans le prompt système
   des deux modes, une seule fois, et `general` n'ajoute rien. */
await withSrcModule(["src/dashboard/ai-client.ts", "src/dashboard/categorie-prompt.ts", "src/dashboard/categorie-quiz.ts"], ({ composerPrompts }, { complementCategorie }, { CATEGORIES }) => {
	const r = makeReporter("Prompts par catégorie");
	const sans = composerPrompts("x", { mode: "learn" }).systemPrompt;
	r.check("general : prompt identique à l'absence de catégorie", composerPrompts("x", { mode: "learn", categorie: "general" }).systemPrompt, sans);
	for (const cat of CATEGORIES.filter(c => c !== "general")) {
		const complement = complementCategorie(cat);
		r.check(`${cat} : un complément non vide`, complement.length > 40, true);
		for (const mode of ["learn", "practice"]) {
			const p = composerPrompts("x", { mode, categorie: cat }).systemPrompt;
			r.check(`${cat} / ${mode} : le complément est ajouté, une fois`, p.split(complement).length - 1, 1);
			r.check(`${cat} / ${mode} : le reste du prompt est gardé`, p.includes("THE SAME LANGUAGE AS THE USER REQUEST") && p.includes("HINTS:"), true);
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
	r.check("bout en bout : parseOllamaResponse lit {questions, mode, glossary} et rend le tableau fusionné",
		parseOllamaResponse(JSON.stringify({ title: "T", questions: [q1], mode: "learn", objectives: ["Définir"], glossary: [{ term: "pile", definition: "LIFO." }] })).questions,
		[q1, { mode: "learn", objectives: ["Définir"], glossary: [{ term: "pile", definition: "LIFO." }] }]);
	r.done();
});
