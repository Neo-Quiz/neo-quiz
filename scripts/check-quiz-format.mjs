/**
 * Le FORMAT Learn / Practice, lu par le module réel `src/quiz-format.ts`.
 *
 * Ce qu'il empêche : un Practice sans explication, un Learn dont une
 * tranche n'a pas sa pré-question, sa lecture ou ses rappels, un `slice` qui
 * ne pointe nulle part — tous acceptés sans un mot jusqu'ici ; et un ancien
 * bloc `mode: "exam"` pris pour un Learn. Un manque est SIGNALÉ, jamais un
 * échec : la vérification rend une liste, elle ne lève rien.
 *
 *     npm run check:quiz-format
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/quiz-format.ts", ({ modeDuBloc, verifierFormat, planDesTranches, lireBlocQuiz, nomDeNote, titreSansMode, completerConfigLearn }) => {
	const r = makeReporter("Format Learn / Practice");

	/* Le mode reste dans le NOM du fichier (lisible dans Obsidian) mais pas
	   dans le TITRE affiché par l'application, qui le montre en badge. */
	r.check("nom de fichier Learn et Practice", [nomDeNote("CM1", "learn"), nomDeNote("CM1", "practice")], ["CM1 — Learn", "CM1 — Practice"]);
	r.check("titre affiché sans le suffixe de son mode",
		[titreSansMode("CM1 — Learn", "learn"), titreSansMode("CM1 — Practice", "practice")], ["CM1", "CM1"]);
	r.check("un suffixe qui n'est pas celui du mode réel reste, un nom qui n'est QUE le suffixe aussi",
		[titreSansMode("CM1 — Learn", "practice"), titreSansMode(" — Learn", "learn"), titreSansMode("Quiz libre", "practice")],
		["CM1 — Learn", " — Learn", "Quiz libre"]);
	const q = (o) => ({ title: "Q", prompt: "Énoncé ?", options: ["a", "b"], correctIndex: 0, explain: "Parce que.", ...o });

	r.check("bloc sans objet de mode = Practice", modeDuBloc([q()]), "practice");
	r.check("objet { mode: \"learn\" } = Learn", modeDuBloc([q(), { mode: "learn", objectives: ["x"] }]), "learn");
	r.check("modes hérités exam, lesson, examMode, learnMode = Practice",
		[{ mode: "exam" }, { mode: "lesson" }, { examMode: true }, { learnMode: true }].map(c => modeDuBloc([q(), c])),
		["practice", "practice", "practice", "practice"]);

	r.check("Practice complet : aucun manque", verifierFormat("practice", [q(), q({ title: "R" })]), []);
	r.check("Practice : les questions sans explication sont nommées",
		verifierFormat("practice", [q({ title: "Listes", explain: "" }), q({ title: "Tuples", explain: undefined, explainHtml: "<p>ok</p>" }), q({ title: "Sets", explain: "  " })]),
		[{ kind: "sansExplication", questions: ["Listes", "Sets"] }]);
	r.check("Practice : une tranche absente du Learn est signalée",
		verifierFormat("practice", [q({ title: "A", slice: 1 }), q({ title: "B", slice: 9 }), q({ title: "C" })], [1, 2, 3]),
		[{ kind: "trancheInconnue", questions: ["B"] }]);
	r.check("Practice sans Learn connu : slice non vérifié", verifierFormat("practice", [q({ slice: 9 })]), []);

	const tranche = (s) => [
		q({ title: `pre${s}`, slice: s, role: "pre", hint: "Pense à la définition." }),
		{ title: `Lecture ${s}`, prompt: "Passage.", slice: s, role: "read" },
		{ title: `expl${s}`, prompt: "Explique.", type: "text", answer: "Modèle.", slice: s, role: "explain" },
		q({ title: `rec${s}`, slice: s, role: "recall" }),
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
		]);

	r.check("Learn : une pré-question sans indice est nommée, un indice vide aussi",
		verifierFormat("learn", [...tranche(1), q({ title: "Sans", slice: 1, role: "pre" }), q({ title: "Vide", slice: 1, role: "pre", hint: "  " }), config]),
		[{ kind: "preSansIndice", questions: ["Sans", "Vide"] }]);
	r.check("Practice : l'indice n'est pas exigé", verifierFormat("practice", [q({ role: "pre" })]), []);


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
