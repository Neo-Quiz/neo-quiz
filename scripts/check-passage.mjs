/**
 * Vérification des LECTURES d'un Learn (src/lecture-etape.ts), du SUPPORT
 * affiché au-dessus d'une question (engine/passage.ts) et du CORPS d'une
 * lecture (engine/lecture-rendu.ts).
 *
 * Règle finale d'Ahmed du 2026-09-26 :
 * - toute lecture a son propre ÉCRAN, sans numéro de question, hors du
 *   score et du nombre de questions ; son onglet est un livre ;
 * - SEULE exception : une lecture `etapes` sans « À retenir », COURTE
 *   (`SEUIL_LECTURE_COURTE` mots, `PLAFOND_ETAPES_COURTES` étapes) ou
 *   marquée MÉTHODE (`methode: true`), se lit ouverte, en version légère,
 *   au-dessus de la première question de son étape qui n'est ni une lecture
 *   ni une « Avant la lecture » ; `page`, `tableau` et toute lecture avec
 *   « À retenir » gardent leur écran, même courts ;
 * - aucune lecture ne s'affiche plus en support replié au-dessus des
 *   questions : le support `passage`/`passageId` d'une question reste.
 *
 *     npm run check:passage
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/lecture-etape.ts"], (le) => {
	const r = makeReporter("Lectures d'un Learn (règle pure)");
	const mots = (n) => Array.from({ length: n }, (_, i) => `mot${i}`).join(" ");
	const quiz = [
		{ title: "Avant", slice: 1, role: "pre" },                                                       // 0
		{ title: "Méthode courte", prompt: "Pour dériver :", slice: 1, role: "read", lecture: "etapes", etapes: ["Repérer la forme.", "Appliquer la règle."] }, // 1 étapes COURTES : sans écran
		{ title: "À toi", slice: 1, role: "explain" },                                                   // 2 hôte de 1
		{ title: "Rappel", slice: 1, role: "recall" },                                                   // 3
		{ title: "Avant 2", slice: 2, role: "pre" },                                                     // 4
		{ title: "Étapes longues", prompt: "x", slice: 2, role: "read", lecture: "etapes", etapes: ["a", "b", "c", "d", "e"] }, // 5 étapes LONGUES : écran
		{ title: "Test 2", slice: 2 },                                                                    // 6 (rôle absent : test)
		{ title: "Méthode longue", prompt: mots(80), slice: 3, role: "read", lecture: "etapes", etapes: ["a", "b", "c", "d", "e", "f"], methode: true }, // 7 MÉTHODE : sans écran
		{ title: "Avant 3", slice: 3, role: "pre" },                                                     // 8 (placée après : jamais hôte)
		{ title: "Calcul", slice: 3, role: "test" },                                                     // 9 hôte de 7
		{ title: "Page courte", prompt: "Un texte bref.", slice: 4, role: "read", lecture: "page" },     // 10 page COURTE : écran
		{ title: "Q4", slice: 4, role: "recall" },                                                       // 11
		{ title: "Tableau court", prompt: "", slice: 5, role: "read", lecture: "tableau", tableau: { colonnes: ["", "A"], lignes: [["x", "y"]] } }, // 12 tableau COURT : écran
		{ title: "Q5", slice: 5, role: "recall" },                                                       // 13
		{ title: "Étapes courtes + retenir", prompt: "x", slice: 6, role: "read", lecture: "etapes", etapes: ["a"], retenir: { forme: "recap", items: ["b"] } }, // 14 écran
		{ title: "Q6", slice: 6, role: "recall" },                                                       // 15
		{ title: "Sans hôte", prompt: "x", slice: 7, role: "read", lecture: "etapes", etapes: ["a"] },   // 16 aucune hôte : écran
		{ title: "Avant 7", slice: 7, role: "pre" },                                                     // 17
		{ title: "Sans étape", prompt: "x", role: "read", lecture: "etapes", etapes: ["a"] },             // 18 pas d'étape : écran
	];
	r.check("sans écran : étapes courtes (1) et méthode longue (7), avec leur hôte",
		[...le.lecturesCourtes(quiz, true)].sort((a, b) => a[0] - b[0]), [[1, 2], [7, 9]]);
	r.check("écran : étapes longues, page courte, tableau court, étapes + retenir, sans hôte, sans étape",
		[5, 10, 12, 14, 16, 18].map(i => le.lecturesCourtes(quiz, true).has(i)), [false, false, false, false, false, false]);
	r.check("estLectureCourte : un cas par style",
		[1, 5, 7, 10, 12, 14].map(i => le.estLectureCourte(quiz[i])), [true, false, true, false, false, false]);
	r.check("seuils : 60 mots et 4 étapes",
		[le.SEUIL_LECTURE_COURTE, le.PLAFOND_ETAPES_COURTES], [60, 4]);
	const etapesMots = (n, k) => ({ role: "read", lecture: "etapes", prompt: mots(n), etapes: Array(k).fill("a") });
	r.check("bornes : 56 + 4 mots et 4 étapes = courte ; un mot ou une étape de plus = écran",
		[le.estLectureCourte(etapesMots(56, 4)), le.estLectureCourte(etapesMots(57, 4)), le.estLectureCourte(etapesMots(1, 5))], [true, false, false]);
	r.check("étapes déduites des paragraphes : comptées pour le plafond",
		[le.estLectureCourte({ role: "read", lecture: "etapes", prompt: "Un.\n\nDeux." }), le.estLectureCourte({ role: "read", lecture: "etapes", prompt: "1.\n\n2.\n\n3.\n\n4.\n\n5." })], [true, false]);
	r.check("méthode : seul `methode: true` compte ; jamais sur une page",
		[le.estLectureCourte({ role: "read", lecture: "etapes", prompt: mots(90), methode: "true" }), le.estLectureCourte({ role: "read", lecture: "page", prompt: "x", methode: true })], [false, false]);
	r.check("brouillon de l'éditeur : style et méthode lus dans `_extraFields`",
		le.estLectureCourte({ role: "read", prompt: mots(90), _extraFields: { lecture: "etapes", etapes: ["a"], methode: true } }), true);

	/* Revue du 2026-09-26 : deux lectures courtes pour la même hôte — la
	   seconde n'avait ni écran ni place au-dessus. Elle garde son écran. */
	const deux = [
		{ slice: 1, role: "read", lecture: "etapes", prompt: "A", etapes: ["a"] },
		{ slice: 1, role: "read", lecture: "etapes", prompt: "B", etapes: ["b"] },
		{ slice: 1, role: "test" },
	];
	r.check("deux lectures courtes, une hôte : la première au-dessus, la seconde garde son écran",
		[[...le.lecturesCourtes(deux, true)], le.questionsVisibles(deux, true), le.nombreDeLectures(deux, true)], [[[0, 2]], [1, 2], 1]);
	r.check("lecture courte de l'hôte, rien pour les autres",
		[0, 2, 3, 6, 9, 11].map(i => le.lectureCourteDe(quiz, true, i)), [null, 1, null, null, 7, null]);
	r.check("numéros : AUCUNE lecture n'en a en Learn, les questions se suivent",
		le.numerosAffiches(quiz, true), [1, 0, 2, 3, 4, 0, 5, 0, 6, 7, 0, 8, 0, 9, 0, 10, 0, 11, 0]);
	r.check("nombre de questions : les lectures ne comptent pas", le.nombreDeQuestions(quiz, true), 11);
	r.check("« N lectures » : seulement celles qui ont un écran", le.nombreDeLectures(quiz, true), 6);
	r.check("écrans : tout sauf les lectures sans écran",
		le.questionsVisibles(quiz, true), quiz.map((_, i) => i).filter(i => i !== 1 && i !== 7));
	r.check("question hôte : une lecture sans écran renvoie à son hôte, le reste à lui-même",
		[1, 7, 5, 10, 2].map(i => le.questionHote(quiz, true, i)), [2, 9, 5, 10, 2]);

	/* Revue du 2026-09-26 : `||` sur un 0 légitime fabriquait un numéro. */
	r.check("numéro affiché d'une lecture : 0, jamais l'index + 1 ; d'une question : son numéro",
		[le.numeroAffiche(quiz, true, 5), le.numeroAffiche(quiz, true, 1), le.numeroAffiche(quiz, true, 6), le.numeroAffiche(quiz, false, 5)], [0, 0, 5, 6]);
	r.check("reprise : une question garde son numéro ; une lecture sans écran, celui de son hôte",
		[le.numeroDeReprise(quiz, true, 6), le.numeroDeReprise(quiz, true, 1)], [5, 2]);
	r.check("reprise sur un écran de lecture : le numéro de la question qui suit (jamais l'index + 1)",
		[le.numeroDeReprise(quiz, true, 5), le.numeroDeReprise(quiz, true, 10)], [5, 8]);
	r.check("reprise sur une lecture finale : le numéro de la question d'avant",
		le.numeroDeReprise([{ slice: 1, role: "test" }, { slice: 2, role: "read" }], true, 1), 1);
	r.check("tranche valide : entier ≥ 1 seulement", [1, 3, 0, -1, 1.5, "2", null].map(le.trancheValide), [1, 3, null, null, null, null, null]);

	/* HORS LEARN : rien sans écran, tout est numéroté. */
	r.check("Practice : aucune lecture sans écran", le.lecturesCourtes(quiz, false).size, 0);
	r.check("Practice : numéros continus, lectures comprises", le.numerosAffiches(quiz, false), quiz.map((_, i) => i + 1));
	r.check("Practice : « N lectures » vaut 0", le.nombreDeLectures(quiz, false), 0);
	r.done();
});

await withSrcModule(["src/engine/passage.ts"], ({ passageVisibility, createPassageHandlers, createPassageCollapseState }) => {
	const r = makeReporter("Support d'une question");

	r.check("Learn : une carte de lecture jouée comme écran, ouverte ; toute autre, repliable",
		["read", "pre", "explain", "recall", "test"].map(role => passageVisibility({ role, isLesson: true })),
		["open", "collapsible", "collapsible", "collapsible", "collapsible"]);
	r.check("hors Learn : repliable", passageVisibility({ role: "read", isLesson: false }), "collapsible");

	/* PLUS AUCUNE lecture au-dessus d'une question (2026-09-26) : sans
	   `passage` propre, rien, quel que soit le style de la lecture de l'étape. */
	const quiz = [
		{ title: "Avant", prompt: "?", slice: 1, role: "pre" },
		{ title: "Page", prompt: "Un tube relie deux commandes.", slice: 1, role: "read" },
		{ title: "À toi", prompt: "Explique.", slice: 1, role: "explain" },
		{ title: "Étapes", prompt: "Faire.", slice: 2, role: "read", lecture: "etapes", etapes: ["a"] },
		{ title: "Tableau", prompt: "Comparer.", slice: 2, role: "read", lecture: "tableau", tableau: { colonnes: ["", "A"], lignes: [["x", "y"]] } },
		{ title: "Test", prompt: "?", slice: 2, role: "test" },
		{ title: "Doc", prompt: "?", passage: "Le document.", passageTitle: "Document" },
	];
	const ctx = {
		quiz,
		isLessonMode: () => true,
		roleOfQuestion: (i) => quiz[i].role ?? "test",
	};
	const h = createPassageHandlers(ctx);
	r.check("aucune lecture n'est résolue en support, quel que soit son style", [0, 2, 5].map(i => h.resolvePassage(i)), [null, null, null]);
	r.check("le support `passage` d'une question reste", h.resolvePassage(6)?.title, "Document");

	const etat = createPassageCollapseState();
	etat.toggle("q6");
	r.check("repli manuel mémorisé par clé", [etat.isCollapsed("q6"), etat.isCollapsed("q2")], [true, false]);
	etat.reset();
	r.check("une nouvelle session repart dépliée", etat.isCollapsed("q6"), false);
	r.done();
});

await withSrcModule(["src/engine/lecture-rendu.ts", "src/engine/sanitizer.ts"], ({ corpsLectureHtml, corpsLectureCourteHtml }, san) => {
	const r = makeReporter("Corps d'une lecture");
	const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	const portes = {
		bloc: (s) => san.rendreTexteQuiz(s, { embed: () => "", image: () => "" }),
		inline: san.renderInlineText,
		attribut: (s) => esc(san.stripInlineMarkdown(s)),
	};
	const rendre = (item, titre) => corpsLectureHtml(item, item.prompt ?? "", portes.bloc(item.prompt ?? ""), titre, portes);
	const page = rendre({ prompt: "Un **dict**.\n\nSuite." }, "Les `dict`");
	// Plus de temps de lecture (retour #8 du 2026-09-26) : une étape n'est pas un article.
	r.check("page : style, titre en tête (rendu inline), sans temps de lecture",
		[page.style, page.html.includes('<h3 class="quiz-lecture-titre">Les <code'), page.html.includes("quiz-lecture-meta")], ["page", true, false]);
	r.check("page : aucun saut de ligne ajouté entre nos balises (le support est en break-spaces)", /<\/div>\n<div/.test(page.html), false);
	const etapes = rendre({ lecture: "etapes", prompt: "Intro.", etapes: ["Un `a`", "Deux"] });
	r.check("étapes écrites : introduction puis une ligne numérotée par étape",
		[etapes.html.includes("quiz-lecture-intro"), (etapes.html.match(/quiz-lecture-etape"/g) || []).length, etapes.html.includes("<code")], [true, 2, true]);
	const deduites = rendre({ lecture: "etapes", prompt: "Un.\n\nDeux.\n\nTrois." });
	r.check("étapes absentes : les paragraphes du texte, sans introduction",
		[(deduites.html.match(/quiz-lecture-etape"/g) || []).length, deduites.html.includes("quiz-lecture-intro")], [3, false]);
	const tab = rendre({ lecture: "tableau", prompt: "", tableau: { colonnes: ["", "Py", "C"], lignes: [["a", "b"]] } });
	r.check("tableau : en-têtes colorés par colonne, ligne complétée",
		[tab.html.includes('quiz-lecture-col-1">Py'), tab.html.includes('quiz-lecture-col-2">C'), (tab.html.match(/<td>/g) || []).length], [true, true, 3]);
	r.check("tableau annoncé mais absent : le texte, en page sans méta", rendre({ lecture: "tableau", prompt: "Texte" }).html.includes("quiz-lecture-texte"), true);
	const xss = '<img src=x onerror=alert(1)>';
	const piege = rendre({ lecture: "tableau", prompt: "", tableau: { colonnes: [xss], lignes: [[xss]] }, retenir: { forme: "cartes", items: [{ recto: xss, verso: `"${xss}` }] } }, xss);
	r.check("aucun HTML de l'auteur ne passe : titre, cases, cartes, attributs", piege.html.includes("<img"), false);
	const cartes = rendre({ prompt: "x", retenir: { forme: "cartes", items: [{ recto: "Terme", verso: "Sens" }] } });
	r.check("cartes : de vrais boutons, état et libellé pour le clavier",
		[cartes.html.includes('<button type="button" class="quiz-lecture-carte" aria-pressed="false"'), cartes.html.includes("data-aria-ouvert=")], [true, true]);
	const recap = rendre({ prompt: "x", retenir: { forme: "recap", items: ["**Fait**"] } });
	r.check("récapitulatif : une ligne cochée, markdown rendu", [recap.html.includes("quiz-lecture-recap"), recap.html.includes("<strong>Fait</strong>")], [true, true]);
	r.check("« À retenir » mal formé : rien", rendre({ prompt: "x", retenir: { forme: "x", items: ["a"] } }).html.includes("retenir"), false);
	const courte = corpsLectureCourteHtml({ lecture: "etapes", prompt: "Pour dériver :", etapes: ["Un `a`", "Deux"] }, "Pour dériver :", portes.bloc("Pour dériver :"), portes);
	r.check("version légère : étapes numérotées, sans titre ni temps de lecture, classe légère",
		[courte.html.includes("quiz-lecture--courte"), (courte.html.match(/quiz-lecture-etape"/g) || []).length, courte.html.includes("quiz-lecture-titre"), courte.html.includes("quiz-lecture-meta")],
		[true, 2, false, false]);
	r.done();
});
