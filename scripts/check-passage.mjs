/**
 * Vérification du SUPPORT affiché au-dessus d'une question (engine/passage.ts)
 * et de la règle des LECTURES ABSORBÉES (src/lecture-etape.ts).
 *
 * Décision d'Ahmed du 2026-09-26 (soir), la plus récente :
 * - une lecture en style `page` (ou sans style : tous les quiz d'avant) est
 *   un ÉCRAN à part, sans numéro de question ; son cours n'apparaît pas
 *   au-dessus d'une pré-question, et reste en RAPPEL replié, sans invite,
 *   au-dessus des questions suivantes ;
 * - une lecture `etapes` ou `tableau` est ABSORBÉE : pas d'écran, son cours
 *   est replié avec « Tentez de répondre sans lire » au-dessus d'une
 *   pré-question (ouvert une fois répondue), déplié d'office au-dessus des
 *   autres ;
 * - « Je ne sais pas », posé aussi SANS clic quand on franchit une
 *   pré-question, n'est pas une réponse : il n'ouvre rien (bug corrigé).
 *
 *     npm run check:passage
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/lecture-etape.ts"], (le) => {
	const r = makeReporter("Lectures absorbées (règle pure)");
	const quiz = [
		{ title: "Avant", slice: 1, role: "pre" },                                   // 0
		{ title: "Les tubes", prompt: "Cours 1", slice: 1, role: "read", lecture: "etapes" }, // 1 absorbée
		{ title: "À toi", slice: 1, role: "explain" },                               // 2
		{ title: "Lecture 2", prompt: "Cours 2", slice: 2, role: "read", lecture: "tableau" }, // 3 absorbée
		{ title: "Test", slice: 2 },                                                 // 4 (rôle absent : test)
		{ title: "Lecture seule", prompt: "Cours 3", slice: 3, role: "read", lecture: "etapes" }, // 5 AUTONOME (étape seule)
		{ title: "Sans étape", role: "read" },                                       // 6 écran (pas d'étape)
		{ title: "Étape texte", slice: "4", role: "read", lecture: "etapes" },       // 7 écran (étape invalide)
		{ title: "Q", slice: 4, role: "recall" },                                    // 8
		null,                                                                         // 9 élément parasite
		{ title: "Avant la lecture 5", slice: 5, role: "recall" },                   // 10
		{ title: "Lecture après", prompt: "Cours 5", slice: 5, role: "read", lecture: "tableau" }, // 11 absorbée, en fin d'étape
		{ title: "Avant 6", slice: 6, role: "pre" },                                 // 12
		{ title: "Page 6", prompt: "Cours 6", slice: 6, role: "read", lecture: "page" }, // 13 PAGE : écran
		{ title: "Après 6", slice: 6, role: "recall" },                              // 14
		{ title: "Ancien 7", prompt: "Cours 7", slice: 7, role: "read" },            // 15 SANS style : page, écran
		{ title: "Après 7", slice: 7, role: "test" },                                // 16
		{ title: "Inconnu 8", prompt: "Cours 8", slice: 8, role: "read", lecture: "callout" }, // 17 style inconnu : page
		{ title: "Après 8", slice: 8, role: "explain" },                             // 18
	];
	const abs = le.lecturesAbsorbees(quiz, true);
	r.check("absorbées : `etapes` et `tableau` d'une étape qui a une autre question", [...abs].sort((a, b) => a - b), [1, 3, 11]);
	r.check("jamais absorbées : `page`, sans style, style inconnu", [13, 15, 17].map(i => abs.has(i)), [false, false, false]);
	r.check("autonomes : étape seule, sans étape, étape invalide", [5, 6, 7].map(i => abs.has(i)), [false, false, false]);
	r.check("numéros : AUCUNE lecture n'en a en Learn (absorbée ou écran), les questions se suivent",
		le.numerosAffiches(quiz, true), [1, 0, 2, 0, 3, 0, 0, 0, 4, 5, 6, 0, 7, 0, 8, 0, 9, 0, 10]);
	r.check("nombre de questions : les lectures ne comptent pas", le.nombreDeQuestions(quiz, true), 10);
	r.check("nombre de lectures : TOUTES, absorbées ou écran (styles etapes/tableau/page/inconnu, sans style)", le.nombreDeLectures(quiz, true), 9);
	r.check("nombre de lectures : 0 hors Learn (une lecture y est déjà une question)", le.nombreDeLectures(quiz, false), 0);
	r.check("questions visibles : les écrans de lecture restent, les absorbées non",
		le.questionsVisibles(quiz, true), [0, 2, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18]);
	r.check("cours de l'étape absorbé, pour TOUS les rôles (lectureDeLEtape)", [0, 2, 4, 10].map(i => le.lectureDeLEtape(quiz, true, i)), [1, 1, 3, 11]);
	r.check("lectureDeLEtape : une page n'est pas absorbée", [12, 14, 16, 18].map(i => le.lectureDeLEtape(quiz, true, i)), [null, null, null, null]);
	r.check("coursDeLEtape : la page, le sans-style et l'inconnu sont des cours NON absorbés",
		[12, 14, 16, 18].map(i => le.coursDeLEtape(quiz, true, i)),
		[{ index: 13, absorbee: false }, { index: 13, absorbee: false }, { index: 15, absorbee: false }, { index: 17, absorbee: false }]);
	r.check("coursDeLEtape : un cours absorbé le dit", le.coursDeLEtape(quiz, true, 0), { index: 1, absorbee: true });
	r.check("pas de cours : lecture, étape sans lecture, hors Learn",
		[le.coursDeLEtape(quiz, true, 1), le.coursDeLEtape(quiz, true, 8), le.coursDeLEtape(quiz, false, 0)], [null, null, null]);
	r.check("question hôte : l'absorbée renvoie à la question qui la suit dans l'étape", le.questionHote(quiz, true, 1), 2);
	r.check("question hôte : absorbée en fin d'étape → première question de l'étape", le.questionHote(quiz, true, 11), 10);
	r.check("question hôte : une page est son propre écran", [13, 15].map(i => le.questionHote(quiz, true, i)), [13, 15]);
	/* Revue du 2026-09-26 : la page d'un quiz (dashboard/detail.ts numeroDe)
	   retombait sur l'index + 1 pour une lecture (`||` sur un 0 légitime) et
	   lui fabriquait un « Question N ». */
	r.check("numéro affiché d'une lecture : 0, jamais l'index + 1 ; d'une question : son numéro",
		[le.numeroAffiche(quiz, true, 13), le.numeroAffiche(quiz, true, 1), le.numeroAffiche(quiz, true, 14), le.numeroAffiche(quiz, false, 13)], [0, 0, 8, 14]);
	r.check("reprise : une question garde son numéro, une absorbée donne celui de sa question hôte",
		[le.numeroDeReprise(quiz, true, 4), le.numeroDeReprise(quiz, true, 1)], [3, 2]);
	r.check("reprise sur un écran de lecture : le numéro de la question qui suit (jamais l'index + 1)",
		[le.numeroDeReprise(quiz, true, 13), le.numeroDeReprise(quiz, true, 17)], [8, 10]);
	r.check("reprise sur une lecture finale : le numéro de la question d'avant",
		le.numeroDeReprise([{ slice: 1, role: "test" }, { slice: 2, role: "read" }], true, 1), 1);
	r.check("tranche valide : entier ≥ 1 seulement", [1, 3, 0, -1, 1.5, "2", null].map(le.trancheValide), [1, 3, null, null, null, null, null]);
	/* Le BROUILLON de l'éditeur range le style dans `_extraFields`
	   (editor/convert.ts) : la fiche et l'éditeur doivent le voir aussi. */
	const brouillon = [{ slice: 1, role: "pre" }, { slice: 1, role: "read", _extraFields: { lecture: "tableau" } }, { slice: 2, role: "test" }, { slice: 2, role: "read", _extraFields: {} }];
	r.check("brouillon de l'éditeur : le style lu dans `_extraFields`", [...le.lecturesAbsorbees(brouillon, true)], [1]);
	const orpheline = [{ slice: 1, role: "read", prompt: "x", lecture: "etapes" }];
	r.check("étape vidée : la lecture redevient autonome", le.lecturesAbsorbees(orpheline, true).size, 0);

	const deux = [
		{ slice: 1, role: "read", prompt: "A", lecture: "etapes" },
		{ slice: 1, role: "read", prompt: "B", lecture: "etapes" },
		{ slice: 1, role: "test" },
	];
	r.check("deux lectures dans une étape : la première absorbée, la seconde reste un écran sans numéro",
		[[...le.lecturesAbsorbees(deux, true)], le.numerosAffiches(deux, true)], [[0], [0, 0, 1]]);

	/* HORS LEARN, RIEN N'EST ABSORBÉ et tout est numéroté. */
	r.check("Practice : rien d'absorbé", le.lecturesAbsorbees(quiz, false).size, 0);
	r.check("Practice : numéros continus, lectures comprises", le.numerosAffiches(quiz, false), quiz.map((_, i) => i + 1));
	r.check("Practice : toutes les questions visibles", le.questionsVisibles(quiz, false), quiz.map((_, i) => i));
	r.check("Practice : pas de cours d'étape", [0, 2, 4, 10].map(i => le.lectureDeLEtape(quiz, false, i)), [null, null, null, null]);
	r.done();
});

await withSrcModule(["src/engine/passage.ts", "src/lecture-etape.ts"], ({ passageVisibility, createPassageHandlers, createPassageCollapseState }, { lecturesAbsorbees }) => {
	const r = makeReporter("Support d'une question");

	const ROLES = ["pre", "explain", "recall", "test"];
	const vis = (role, answered, cours) => passageVisibility({ role, answered, isLesson: true, cours });
	r.check("cours absorbé, non répondu : replié avec invite sur `pre`, déplié ailleurs",
		ROLES.map(ro => vis(ro, false, "absorbe")), ["folded", "collapsible", "collapsible", "collapsible"]);
	r.check("cours absorbé, répondu : ouvert sur `pre`, déplié ailleurs",
		ROLES.map(ro => vis(ro, true, "absorbe")), ["open", "collapsible", "collapsible", "collapsible"]);
	r.check("cours `page` : invisible sur `pre`, rappel replié ailleurs, répondu ou non",
		[...ROLES.map(ro => vis(ro, false, "page")), ...ROLES.map(ro => vis(ro, true, "page"))],
		["hidden", "reminder", "reminder", "reminder", "hidden", "reminder", "reminder", "reminder"]);
	r.check("support propre (`passage`) en Learn : comme un cours absorbé",
		ROLES.map(ro => vis(ro, false, undefined)), ["folded", "collapsible", "collapsible", "collapsible"]);
	r.check("Learn : une lecture affichée comme écran est ouverte", vis("read", false, undefined), "open");
	r.check("hors Learn : repliable", passageVisibility({ role: "pre", answered: false, isLesson: false, cours: "page" }), "collapsible");

	const quiz = [
		{ title: "Avant", prompt: "?", slice: 1, role: "pre" },                                  // 0
		{ title: "Les tubes", prompt: "Un tube relie deux commandes.", slice: 1, role: "read", lecture: "etapes" }, // 1
		{ title: "À toi", prompt: "Explique un tube.", slice: 1, role: "explain" },              // 2
		{ title: "Avant 2", prompt: "?", slice: 2, role: "pre" },                                // 3
		{ title: "Lecture 2", prompt: "Les redirections.", slice: 2, role: "read" },             // 4 page (sans style)
		{ title: "Rappel", prompt: "?", slice: 2, role: "recall" },                              // 5
		{ title: "Avant 3", prompt: "?", slice: 3, role: "pre" },                                // 6
		{ title: "Tableau 3", prompt: "Comparaison.", slice: 3, role: "read", lecture: "tableau" }, // 7
		{ title: "Sans lecture", prompt: "Explique.", slice: 4, role: "explain" },               // 8
	];
	const ctx = (lesson, extra = {}) => ({
		quiz,
		lecturesAbsorbees: lecturesAbsorbees(quiz, lesson),
		isLessonMode: () => lesson,
		roleOfQuestion: (i) => quiz[i].role ?? "test",
		sliceOfQuestion: (i) => quiz[i].slice ?? null,
		textOnly: { isChecked: () => false },
		quizState: { locked: false, lessonPreSkipped: [] },
		isComplete: () => false,
		...extra,
	});
	const h = createPassageHandlers(ctx(true));
	const lu = (qi) => { const p = h.resolvePassage(qi); return p ? [p.title, p.cours] : null; };
	r.check("chaque question reçoit le cours de son étape, avec son origine",
		[lu(0), lu(2), lu(3), lu(5), lu(6)],
		[["Les tubes", "absorbe"], ["Les tubes", "absorbe"], ["Lecture 2", "page"], ["Lecture 2", "page"], ["Tableau 3", "absorbe"]]);
	r.check("étape sans lecture : rien", lu(8), null);
	r.check("clé de repli PROPRE à chaque question", [h.resolvePassage(0).key, h.resolvePassage(2).key], ["lecture-1-q0", "lecture-1-q2"]);
	r.check("hors Learn : rien", createPassageHandlers(ctx(false)).resolvePassage(2), null);
	r.check("régime par question : pre absorbé, explain absorbé, pre page, recall page",
		[0, 2, 3, 5].map(i => h.passageVisibilityFor(i)), ["folded", "collapsible", "hidden", "reminder"]);
	r.check("un cours `page` au-dessus d'une pré-question n'est pas rendu du tout", h.passageHtml(3), "");

	const repondu = createPassageHandlers(ctx(true, { isComplete: (i) => i === 0 }));
	r.check("la pré-question répondue voit son cours ouvert, la suivante non répondue replié",
		[repondu.passageVisibilityFor(0), repondu.passageVisibilityFor(6)], ["open", "folded"]);

	/* LE BUG DU 2026-09-26 : franchir une pré-question sans répondre (bouton
	   suivant, onglet Qn, reprise) la marque « Je ne sais pas » en silence
	   (engine/state.ts `marquerPreNonTentees`). Ce drapeau comptait comme une
	   réponse, et le cours s'affichait DÉPLIÉ sur une question jamais
	   répondue. Il reste replié. */
	const franchie = createPassageHandlers(ctx(true, { quizState: { locked: false, lessonPreSkipped: [true, false, false, false, false, false, true] } }));
	r.check("pré-question franchie ou « Je ne sais pas » : le cours reste REPLIÉ",
		[franchie.passageVisibilityFor(0), franchie.passageVisibilityFor(6)], ["folded", "folded"]);
	r.check("quiz verrouillé : ouvert", createPassageHandlers(ctx(true, { quizState: { locked: true, lessonPreSkipped: [] } })).passageVisibilityFor(0), "open");

	/* Ouvrir le cours sur UNE question ne l'ouvre pas sur la suivante : les
	   clés sont propres à chaque question. */
	const etat = createPassageCollapseState();
	const k0 = h.resolvePassage(0).key, k6 = h.resolvePassage(6).key;
	etat.seedCollapsedOnce(k0); etat.seedCollapsedOnce(k6);
	etat.toggle(k0);
	r.check("déplier le cours sur une pré-question laisse la suivante repliée", [etat.isCollapsed(k0), etat.isCollapsed(k6)], [false, true]);
	etat.seedCollapsedOnce(k0);
	r.check("un re-rendu ne replie pas un cours déplié à la main", etat.isCollapsed(k0), false);
	etat.reset();
	etat.seedCollapsedOnce(k0);
	r.check("une nouvelle session repart repliée", etat.isCollapsed(k0), true);
	r.done();
});

/* Le CORPS STYLÉ d'une lecture (engine/lecture-rendu.ts), par les portes
   RÉELLES du sanitizer : rien de l'auteur ne passe sans porte, chaque style
   produit sa structure. */
await withSrcModule(["src/engine/lecture-rendu.ts", "src/engine/sanitizer.ts"], ({ corpsLectureHtml }, san) => {
	const r = makeReporter("Corps d'une lecture");
	const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	const portes = {
		bloc: (s) => san.rendreTexteQuiz(s, { embed: () => "", image: () => "" }),
		inline: san.renderInlineText,
		attribut: (s) => esc(san.stripInlineMarkdown(s)),
	};
	const rendre = (item, titre) => corpsLectureHtml(item, item.prompt ?? "", portes.bloc(item.prompt ?? ""), titre, portes);
	const page = rendre({ prompt: "Un **dict**.\n\nSuite." }, "Les `dict`");
	r.check("page : style, titre en tête (rendu inline), temps de lecture",
		[page.style, page.html.includes('<h3 class="quiz-lecture-titre">Les <code'), page.html.includes("quiz-lecture-meta")], ["page", true, true]);
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
	r.done();
});
