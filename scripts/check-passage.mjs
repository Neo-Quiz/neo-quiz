/**
 * Vérification du SUPPORT affiché au-dessus d'une question (engine/passage.ts)
 * et de la règle des LECTURES ABSORBÉES (src/lecture-etape.ts).
 *
 * Dans un Learn (décision du 2026-09-26), la carte de lecture d'une étape
 * n'est plus un écran dès que l'étape a une autre question : son cours
 * s'affiche REPLIÉ au-dessus de chaque question de l'étape, quel que soit le
 * rôle, avec « Tentez de répondre sans lire », et se déplie une fois la
 * question répondue. Plus aucun rôle ne cache le cours. Une étape sans autre
 * question garde sa lecture en écran autonome.
 *
 *     npm run check:passage
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/lecture-etape.ts"], (le) => {
	const r = makeReporter("Lectures absorbées (règle pure)");
	const quiz = [
		{ title: "Avant", slice: 1, role: "pre" },            // 0
		{ title: "Les tubes", prompt: "Cours 1", slice: 1, role: "read" }, // 1 absorbée
		{ title: "À toi", slice: 1, role: "explain" },        // 2
		{ title: "Lecture 2", prompt: "Cours 2", slice: 2, role: "read" }, // 3 absorbée (étape avec un test)
		{ title: "Test", slice: 2 },                          // 4 (rôle absent : test)
		{ title: "Lecture seule", prompt: "Cours 3", slice: 3, role: "read" }, // 5 AUTONOME
		{ title: "Sans étape", role: "read" },                // 6 autonome (pas d'étape)
		{ title: "Étape texte", slice: "4", role: "read" },    // 7 autonome (étape invalide)
		{ title: "Q", slice: 4, role: "recall" },             // 8
		null,                                                  // 9 élément parasite
		{ title: "Lecture après", prompt: "Cours 5", slice: 5, role: "read" }, // 10 absorbée, en fin d'étape
	];
	quiz.splice(10, 0, { title: "Avant la lecture 5", slice: 5, role: "recall" }); // 10 ; la lecture passe en 11
	const abs = le.lecturesAbsorbees(quiz, true);
	r.check("absorbées : étape avec une autre question, quel que soit son rôle", [...abs].sort((a, b) => a - b), [1, 3, 11]);
	r.check("autonomes : étape seule, sans étape, étape invalide", [5, 6, 7].map(i => abs.has(i)), [false, false, false]);
	r.check("numéros affichés : les absorbées sautées (0), la suivante devient Q2",
		le.numerosAffiches(quiz, true), [1, 0, 2, 0, 3, 4, 5, 6, 7, 8, 9, 0]);
	r.check("questions visibles", le.questionsVisibles(quiz, true), [0, 2, 4, 5, 6, 7, 8, 9, 10]);
	r.check("cours de l'étape pour TOUS les rôles", [0, 2, 4, 10].map(i => le.lectureDeLEtape(quiz, true, i)), [1, 1, 3, 11]);
	r.check("pas de cours : lecture, autonome, sans étape, étape sans lecture",
		[1, 5, 6, 8].map(i => le.lectureDeLEtape(quiz, true, i)), [null, null, null, null]);
	r.check("question hôte : l'absorbée renvoie à la question qui la suit dans l'étape", le.questionHote(quiz, true, 1), 2);
	r.check("question hôte : lecture en fin d'étape → première question de l'étape", le.questionHote(quiz, true, 11), 10);
	r.check("question hôte : toute autre question est sa propre hôte", [0, 5, 9].map(i => le.questionHote(quiz, true, i)), [0, 5, 9]);
	r.check("tranche valide : entier ≥ 1 seulement", [1, 3, 0, -1, 1.5, "2", null].map(le.trancheValide), [1, 3, null, null, null, null, null]);
	// Supprimer la seule question d'une étape rend la lecture AUTONOME.
	const orpheline = [{ slice: 1, role: "read", prompt: "x" }];
	r.check("étape vidée : la lecture redevient autonome", le.lecturesAbsorbees(orpheline, true).size, 0);

	/* Deux lectures dans la même étape : seule la PREMIÈRE est absorbée (le
	   cours au-dessus des questions n'en montre qu'une) ; la seconde reste un
	   écran, plutôt que de disparaître. */
	const deux = [
		{ slice: 1, role: "read", prompt: "A" },
		{ slice: 1, role: "read", prompt: "B" },
		{ slice: 1, role: "test" },
	];
	r.check("deux lectures dans une étape : la première absorbée, la seconde reste un écran",
		[[...le.lecturesAbsorbees(deux, true)], le.numerosAffiches(deux, true)], [[0], [0, 1, 2]]);

	/* HORS LEARN, RIEN N'EST ABSORBÉ (revue du 2026-09-26) : le moteur joue
	   chaque lecture d'un Practice comme un écran, et la fiche, le scanner et
	   la reprise doivent compter comme lui. */
	r.check("Practice avec étapes et lectures : rien d'absorbé", le.lecturesAbsorbees(quiz, false).size, 0);
	r.check("Practice : numéros continus, lectures comprises",
		le.numerosAffiches(quiz, false), quiz.map((_, i) => i + 1));
	r.check("Practice : toutes les questions visibles", le.questionsVisibles(quiz, false), quiz.map((_, i) => i));
	r.check("Practice : pas de cours d'étape au-dessus des questions",
		[0, 2, 4, 10].map(i => le.lectureDeLEtape(quiz, false, i)), [null, null, null, null]);
	r.check("Practice : une lecture est sa propre question hôte", [1, 3, 11].map(i => le.questionHote(quiz, false, i)), [1, 3, 11]);
	r.done();
});

await withSrcModule(["src/engine/passage.ts", "src/lecture-etape.ts"], ({ passageVisibility, createPassageHandlers }, { lecturesAbsorbees }) => {
	const r = makeReporter("Support d'une question");

	const vis = (role, answered = false) => passageVisibility({ role, answered, isLesson: true });
	r.check("Learn : replié tant que non répondu, pour TOUS les rôles",
		["pre", "explain", "recall", "test"].map(ro => vis(ro)), ["folded", "folded", "folded", "folded"]);
	r.check("Learn : ouvert une fois répondu",
		["pre", "explain", "recall", "test"].map(ro => vis(ro, true)), ["open", "open", "open", "open"]);
	r.check("Learn : une lecture autonome est ouverte", vis("read"), "open");
	r.check("hors Learn : repliable", passageVisibility({ role: "explain", answered: false, isLesson: false }), "collapsible");

	const quiz = [
		{ title: "Avant", prompt: "?", slice: 1, role: "pre" },
		{ title: "Les tubes", prompt: "Un tube relie la sortie d'une commande à l'entrée de la suivante.", slice: 1, role: "read" },
		{ title: "À toi", prompt: "Explique un tube.", slice: 1, role: "explain" },
		{ title: "Lecture 2", prompt: "Les redirections.", slice: 2, role: "read" },
		{ title: "À toi 2", prompt: "Explique.", slice: 2, role: "explain" },
		{ title: "Rappel", prompt: "?", slice: 2, role: "recall" },
		{ title: "Sans lecture", prompt: "Explique.", slice: 3, role: "explain" },
	];
	const ctx = (lesson) => ({
		quiz,
		lecturesAbsorbees: lecturesAbsorbees(quiz, lesson),
		isLessonMode: () => lesson,
		roleOfQuestion: (i) => quiz[i].role ?? "test",
		sliceOfQuestion: (i) => quiz[i].slice ?? null,
		textOnly: { isChecked: () => false },
		quizState: { locked: false, lessonPreSkipped: [] },
		isComplete: () => false,
	});
	const h = createPassageHandlers(ctx(true));
	const lu = (qi) => { const p = h.resolvePassage(qi); return p ? [p.title, p.text] : null; };
	const cours1 = ["Les tubes", "Un tube relie la sortie d'une commande à l'entrée de la suivante."];
	const cours2 = ["Lecture 2", "Les redirections."];
	r.check("chaque question de l'étape reçoit le cours, quel que soit son rôle", [lu(0), lu(2), lu(4), lu(5)],
		[cours1, cours1, cours2, cours2]);
	r.check("étape sans lecture : rien", lu(6), null);
	r.check("clé de repli PROPRE à chaque question", [h.resolvePassage(0).key, h.resolvePassage(2).key], ["lecture-1-q0", "lecture-1-q2"]);
	r.check("hors Learn : rien", createPassageHandlers(ctx(false)).resolvePassage(2), null);

	const repondu = { ...ctx(true), isComplete: (i) => i === 0 };
	const h2 = createPassageHandlers(repondu);
	r.check("la question répondue voit son cours ouvert, la suivante replié",
		[h2.passageVisibilityFor(0), h2.passageVisibilityFor(2)], ["open", "folded"]);
	r.check("« Je ne sais pas » ouvre le cours",
		createPassageHandlers({ ...ctx(true), quizState: { locked: false, lessonPreSkipped: [true] } }).passageVisibilityFor(0), "open");
	r.done();
});
