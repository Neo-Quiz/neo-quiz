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

await withSrcModule(["src/dashboard/ai-client.ts", "src/quiz-format.ts"], ({ composerPrompts }, { CHAMPS_DECRITS, MOTS_INTERDITS }) => {
	const r = makeReporter("Prompts Learn / Practice");
	for (const mode of ["learn", "practice"]) {
		const { systemPrompt } = composerPrompts("Python", { mode, count: null, type: "Mixte" });
		r.check(`${mode} : chaque champ exigé est décrit`, CHAMPS_DECRITS[mode].filter(c => !systemPrompt.includes(c)), []);
		r.check(`${mode} : aucun mode ni champ retiré n'est mentionné`, MOTS_INTERDITS.filter(re => re.test(systemPrompt)).map(String), []);
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
	r.done();
});
