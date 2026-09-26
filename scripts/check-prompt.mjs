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
	r.check("Practice : aucun style de lecture",
		['"lecture"', '"retenir"', '"etapes"'].filter(p => composerPrompts("x", { mode: "practice" }).systemPrompt.includes(p)), []);
	r.done();
});
