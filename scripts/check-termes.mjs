/**
 * LE GLOSSAIRE D'UN QUIZ (`src/glossaire.ts`), noyau pur.
 * Ce qu'il empêche : un terme apparié dans un mot plus long qui le contient,
 * apparié malgré un accent différent, apparié dans une formule LaTeX, une
 * entrée retrouvée deux fois dans la même zone, deux entrées qui se
 * chevauchent sans que la plus spécifique l'emporte. Vérifie aussi la
 * reconnaissance d'un objet de configuration qui ne porte qu'un glossaire
 * (`src/quiz-utils.ts`).
 *     npm run check:termes
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(
	["src/glossaire.ts", "src/quiz-utils.ts"],
	({ lireGlossaire, indexerGlossaire, trouverTermes }, { findQuizModeConfigIndex, extractExamOptions }) => {
		const r = makeReporter("Glossaire d'un quiz — format et appariement des termes");

		// --- lireGlossaire : entrées invalides ignorées ---
		{
			const brut = [
				{ term: "pile", definition: "Structure LIFO." },
				{ term: "   ", definition: "Sans terme." },
				{ term: "vide", definition: "   " },
				{ term: 42, definition: "Terme non textuel." },
				{ definition: "Sans terme du tout." },
				"parasite",
				null,
				{ term: "pile d'appel", definition: "Empilement des appels.", aliases: ["call stack", "  ", 7] },
			];
			const lu = lireGlossaire(brut);
			r.check("entrées invalides ignorées, valides gardées dans l'ordre", lu.map(e => e.term), ["pile", "pile d'appel"]);
			r.check("aliases filtrés aux chaînes non vides, triés à l'identique", lu[1].aliases, ["call stack"]);
			r.check("aliases absent quand aucun n'est valide", "aliases" in lu[0], false);
		}
		r.check("glossaire non tableau → []", lireGlossaire("pas un tableau"), []);
		r.check("glossaire absent (undefined) → []", lireGlossaire(undefined), []);

		// --- indexerGlossaire + trouverTermes ---
		const entrees = lireGlossaire([
			{ term: "pile", definition: "Structure où le dernier ajouté sort en premier." },
			{ term: "pile d'appel", definition: "Empilement des appels de fonction." },
			{ term: "index", definition: "Position dans une séquence.", aliases: ["indice"] },
		]);
		const index = indexerGlossaire(entrees);

		r.check("casse insensible", trouverTermes("Une PILE est une structure.", index, new Set()).map(o => o.entree), [0]);
		r.check("accents exacts : « pilé » n'apparie pas « pile »", trouverTermes("Un pilé au chocolat.", index, new Set()), []);
		r.check("mot entier : « empiler » n'apparie pas « pile »", trouverTermes("On peut empiler des objets.", index, new Set()), []);
		r.check("pluriel « piles »", trouverTermes("Les piles.", index, new Set()).map(o => o.entree), [0]);
		r.check("pluriel « indexes »", trouverTermes("Les indexes.", index, new Set()).map(o => o.entree), [2]);
		r.check("le plus long l'emporte : « pile d'appel » gagne sur « pile »",
			trouverTermes("La pile d'appel grandit.", index, new Set()).map(o => o.entree), [1]);
		r.check("une seule occurrence par entrée dans un même texte",
			trouverTermes("La pile grandit, la pile déborde.", index, new Set()).length, 1);
		r.check("jamais apparié dans une formule", trouverTermes("La formule $pile$ n'est pas un terme.", index, new Set()), []);

		{
			const dejaVus = new Set();
			const t1 = trouverTermes("La pile est vide.", index, dejaVus);
			const t2 = trouverTermes("La pile déborde encore.", index, dejaVus);
			r.check("dejaVus partagé entre deux appels : la 2e occurrence n'est pas reprise", [t1.length, t2.length], [1, 0]);
		}

		// --- reconnaissance de la configuration (quiz-utils.ts) ---
		const question = { prompt: "2 + 2 ?", options: ["3", "4"], correctIndex: 1 };
		r.check("un objet sans énoncé porteur d'un glossaire est la configuration",
			findQuizModeConfigIndex([question, { glossary: [{ term: "a", definition: "b" }] }]), 1);
		r.check("un glossaire VIDE sur un objet sans énoncé est encore reconnu",
			findQuizModeConfigIndex([question, { glossary: [] }]), 1);
		r.check("une question qui porte un glossaire reste une question",
			findQuizModeConfigIndex([{ prompt: "x", glossary: [] }]), -1);

		// --- extractExamOptions rend le glossaire lu ---
		{
			const out = extractExamOptions([question, { mode: "quiz", glossary: [{ term: "pile", definition: "def" }] }]);
			r.check("extractExamOptions rend le glossaire lu", out.glossary, [{ term: "pile", definition: "def" }]);
		}
		r.check("sans configuration, glossaire vide", extractExamOptions([question]).glossary, []);
		r.check("tableau vide, glossaire vide", extractExamOptions([]).glossary, []);

		r.done();
	},
);
