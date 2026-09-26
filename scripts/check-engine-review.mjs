/**
 * Vérifie que le moteur journalise correctement pour l'ordonnanceur (Task 8,
 * fix round 1 inclus, 2026-09-02).
 *
 * Charge les VRAIS `createStateHandlers` (engine/state.ts), `createTextOnlyHandlers`
 * (engine/text-only.ts) et `idsForRawItems`/`assignQuestionIds` (quiz-ids.ts),
 * avec un `ctx` minimal mais réel — même câblage croisé que `engine.ts`
 * (`Object.assign(ctx, { hasAnyAnswer: state.hasAnyAnswer, ... })`), et
 * `ctx.questionIds` construit par le MÊME appel que `engine.ts`
 * (`idsForRawItems(quiz)`, pas une reconstruction locale) : le round 1 de
 * revue a signalé que la première version de ce script recalculait la ligne
 * de production au lieu de la charger — corrigé ici.
 *
 * Aucun DOM n'est nécessaire pour `goToResults`/`recordReview` : `goToSlide`
 * retourne avant tout `await`/toute manipulation DOM tant que la slide cible
 * est déjà la slide courante — les tests placent donc `quizState.current` sur
 * `SLIDE_RESULTS_INDEX` dès le départ, exactement comme un second clic sur
 * « Voir le score ». Pour `text-only.ts` (auto-évaluation), un `trackItem`
 * factice (querySelector/querySelectorAll/addEventListener en mémoire) suffit
 * à exercer le VRAI gestionnaire de clic sans jsdom.
 *
 *     node scripts/check-engine-review.mjs
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(
	["src/engine/state.ts", "src/quiz-ids.ts", "src/engine/text-only.ts"],
	async ({ createStateHandlers }, { idsForRawItems }, { createTextOnlyHandlers }) => {
	/**
	 * Construit un ctx minimal, avec le câblage croisé réel des méthodes
	 * aplaties (même pattern qu'engine.ts).
	 *
	 * `originalQuizMode` et `isLessonMode` sont deux paramètres INDÉPENDANTS
	 * (fix 2) : par défaut `originalQuizMode` suit `isLessonMode` (un quiz
	 * QCM ordinaire n'a jamais été une Leçon), mais un test peut les découpler
	 * pour simuler une Leçon basculée en Examen (`originalQuizMode: "lesson"`,
	 * `isLessonMode: false`) — exactement l'état que `switchToExamMode`
	 * (engine.ts) produit sans jamais toucher `originalQuizMode`.
	 */
	function makeCtx({
		quiz,
		selections,
		isLessonMode = false,
		originalQuizMode = isLessonMode ? "lesson" : "quiz",
		roles = [],
		lessonPreSkipped = [],
		recordedInit = [],
		sourcePath = "Cours/ch1.md",
		reviewSink: sinkOverride,
		statsStore = { updateRecord() {} },
		textOnly,
	}) {
		const appels = [];
		const sink = sinkOverride === undefined
			? { keyOf: (path, id) => `${path}::${id}`, record: (entries) => appels.push(...entries) }
			: sinkOverride;

		const ctx = {
			quiz,
			// Même appel que la ligne de production (engine.ts) : le harness
			// CHARGE `idsForRawItems`, il ne la reproduit pas (fix round 1).
			questionIds: idsForRawItems(quiz),
			reviewSink: sink,
			sourcePath,
			statsSink: statsStore,
			container: { querySelectorAll: () => [], querySelector: () => null },
			isExamMode: false,
			examStarted: false,
			examEnded: false,
			textOnly,
			isTextQuestion: () => false,
			isClozeQuestion: () => false,
			isFlashcardQuestion: (q) => !!q && q.flashcard === true,
			isOrderingQuestion: () => false,
			isMatchingQuestion: () => false,
			isLessonMode: () => isLessonMode,
			originalQuizMode,
			roleOfQuestion: (i) => roles[i],
			closeHintModal: () => {},
			clampSlideIndex: (i) => i,
			// Carte mémoire (Case D) : renderLessonHtml (sanitizer.ts) lit ces deux
			// méthodes, flashcardBodyHtml (text-only.ts) lit renderInlineText —
			// identité suffisante, ce test ne vérifie pas l'assainissement.
			sanitize: {
				renderInlineText: (s) => s,
				renderTextWithEmbeds: (s) => s,
				replaceObsidianEmbedsInHtml: (s) => s,
			},
		};
		// N questions + slide "submit" + slide "results" (engine.ts buildSlideMap).
		ctx.SLIDE_RESULTS_INDEX = quiz.length + 1;
		// isQuestionSlideIndex(current) doit valoir faux : dans tous les cas
		// testés ici, `current` EST déjà SLIDE_RESULTS_INDEX (cf. commentaire
		// d'en-tête), qui n'est jamais une slide de question.
		ctx.isQuestionSlideIndex = () => false;
		ctx.quizState = {
			selections,
			textOnlyRatings: quiz.map(() => null),
			recorded: recordedInit.length ? recordedInit : quiz.map(() => false),
			lessonPreSkipped: lessonPreSkipped.length ? lessonPreSkipped : quiz.map(() => false),
			locked: false,
			isSliding: false,
			current: ctx.SLIDE_RESULTS_INDEX,
			lastQuestionIndex: 0,
			pendingResultsLock: false,
			resultsCounted: false,
		};

		const handlers = createStateHandlers(ctx);
		Object.assign(ctx, {
			hasAnyAnswer: handlers.hasAnyAnswer,
			isComplete: handlers.isComplete,
			isCorrect: handlers.isCorrect,
			computeScorePercent: handlers.computeScorePercent,
			updateNavHighlight: handlers.updateNavHighlight,
			goToSlide: handlers.goToSlide,
			recordReview: handlers.recordReview,
			goToResults: handlers.goToResults,
			// Requis par text-only.ts (bindTextOnlyQuestion → commitQuestionInteraction) :
			// fonction locale d'engine.ts (DOM), hors périmètre de ce test — seul
			// l'appel à `ctx.recordReview` qui le précède nous intéresse ici.
			commitQuestionInteraction: () => {},
			invalidateSavedResults: () => {},
			saveSession: () => {},
			clearSession: () => {},
		});
		return { ctx, appels };
	}

	/** Bouton de note factice : capture son listener pour permettre de
	    simuler un clic sans DOM (Node n'en fournit aucun). */
	function fakeRatingButton(rating) {
		const listeners = {};
		return {
			dataset: { textonlyRating: rating },
			addEventListener: (type, cb) => { listeners[type] = cb; },
			click: () => listeners.click?.({ preventDefault() {} }),
		};
	}
	function fakeTrackItem(ratingButtons) {
		return {
			querySelector: () => null, // textarea, check-btn, .quiz-flashcard : hors périmètre de ce test.
			querySelectorAll: (sel) => (sel.includes("quiz-textonly-rating-btn") ? ratingButtons : []),
			addEventListener: () => {},
		};
	}

	/* ────────────────────────────────────────────────────────────
	   Case A — recordReview() en isolation (point d'enregistrement de
	   l'auto-évaluation, engine/text-only.ts).
	   ──────────────────────────────────────────────────────────── */
	{
		const r = makeReporter("recordReview — garde puits/chemin absent");
		const quiz = [{ id: "q1", title: "T1" }];

		// `null`, pas `undefined` : un `reviewSink` omis déclenche le puits PAR
		// DÉFAUT de `makeCtx` (déstructuration avec valeur par défaut) — c'est
		// justement `null` qui simule un `_reviewStore` absent (Task 7, "le
		// store dégrade plutôt que de bloquer le greffon").
		const { ctx: sansPuits } = makeCtx({ quiz, selections: [null], reviewSink: null });
		sansPuits.recordReview(0, "correct");
		r.check("puits absent : rien n'est marqué journalisé", sansPuits.quizState.recorded[0], false);

		const { ctx: sansChemin, appels } = makeCtx({ quiz, selections: [null], sourcePath: "" });
		sansChemin.recordReview(0, "correct");
		r.check("sourcePath absent (aperçu éditeur) : aucun appel au puits", appels.length, 0);
		r.check("sourcePath absent : rien n'est marqué journalisé", sansChemin.quizState.recorded[0], false);
		r.done();
	}

	{
		const r = makeReporter("recordReview — dédoublonnage (une fois par session)");
		const quiz = [{ id: "q1", title: "T1" }];
		const { ctx, appels } = makeCtx({ quiz, selections: [null] });
		ctx.recordReview(0, "correct");
		ctx.recordReview(0, "correct");
		r.check("deux appels, un seul enregistrement journalisé", appels.length, 1);
		r.check("le drapeau recorded est posé", ctx.quizState.recorded[0], true);
		r.done();
	}

	{
		const r = makeReporter("recordReview — identifiant manquant (repli qN à l'assemblage)");
		// `questionIds[0]` forcé vide : simule une incohérence d'assemblage.
		// Sans id, rien à journaliser (`if (!id) return;`) et le drapeau `recorded`
		// reste FAUX — pas de perte silencieuse, une reprise ultérieure reste possible.
		const quiz = [{ id: "q1", title: "T1" }];
		const { ctx, appels } = makeCtx({ quiz, selections: [null] });
		ctx.questionIds[0] = "";
		ctx.recordReview(0, "correct");
		r.check("id vide : aucun appel au puits", appels.length, 0);
		r.check("id vide : recorded reste faux (reprise possible)", ctx.quizState.recorded[0], false);
		r.done();
	}

	{
		const r = makeReporter("recordReview — rôle inclus dès que le bloc est d'origine Leçon (fix 2)");
		const quiz = [{ id: "q1", title: "T1" }];

		const { ctx: horsLecon, appels: a1 } = makeCtx({ quiz, selections: [null], isLessonMode: false, roles: ["recall"] });
		horsLecon.recordReview(0, "understood");
		r.check("bloc jamais Leçon : pas de propriété 'role'", Object.prototype.hasOwnProperty.call(a1[0], "role"), false);

		const { ctx: enLecon, appels: a2 } = makeCtx({ quiz, selections: [null], isLessonMode: true, roles: ["recall"] });
		enLecon.recordReview(0, "understood");
		r.check("en Leçon (mode courant) : le rôle déclaré est copié", a2[0]?.role, "recall");

		// LE cas du fix 2 : le bloc est D'ORIGINE Leçon mais le mode COURANT a
		// basculé en Examen (switchToExamMode, engine.ts — jamais originalQuizMode).
		// `roleOfQuestion` renvoie le rôle déclaré quel que soit le mode courant
		// (engine/lesson.ts buildLessonModel.roleOf) : le gate doit donc suivre
		// `originalQuizMode`, pas `isLessonMode()`, sous peine de perdre le rôle
		// exactement dans ce cas — celui que le brief n'avait pas prévu.
		const { ctx: apresBascule, appels: a3 } = makeCtx({
			quiz, selections: [null], isLessonMode: false, originalQuizMode: "lesson", roles: ["recall"],
		});
		apresBascule.recordReview(0, "understood");
		r.check("bloc d'origine Leçon, mode courant Examen : le rôle SURVIT", a3[0]?.role, "recall");
		r.done();
	}

	{
		/* LE ruling préflight 3 (2026-09-02) : le moteur DOIT dériver la clé par
		   `ctx.questionIds`, jamais `ctx.quiz[i].id` brut. Item 0 n'a PAS d'id
		   explicite : `assignQuestionIds` lui attribue le slug de son titre —
		   calcul À LA MAIN ci-dessous, PAS copié d'une exécution :
		     "Titre à vérifier".toLowerCase() = "titre à vérifier"
		     remplacement de [^a-z0-9]+ par "-" :
		       "titre" + "-" (pour " à ") + "v" + "-" (pour "é") + "rifier"
		       = "titre-v-rifier"  (14 caractères, sous la limite de 20)
		   Si le moteur lisait `q.id` brut, cet id serait `undefined` : le garde
		   `if (!id) return;` empêcherait tout enregistrement pour cette question. */
		const r = makeReporter("recordReview — clé dérivée par idsForRawItems, jamais q.id brut");
		const quiz = [
			{ title: "Titre à vérifier" },
			{ id: "q-explicit", title: "Autre titre" },
		];
		const { ctx, appels } = makeCtx({ quiz, selections: [null, null] });
		r.check("id de repli calculé à la main", ctx.questionIds[0], "titre-v-rifier");
		ctx.recordReview(0, "correct");
		ctx.recordReview(1, "wrong");
		r.check("les DEUX questions sont journalisées (repli ET id explicite)", appels.length, 2);
		r.check("clé de la question sans id explicite : chemin::slug-du-titre",
			appels[0]?.q, "Cours/ch1.md::titre-v-rifier");
		r.check("clé de la question avec id explicite : chemin::id",
			appels[1]?.q, "Cours/ch1.md::q-explicit");
		r.done();
	}

	{
		/* Fix 1 (round 1, 2026-09-02) : `idsForRawItems` (quiz-ids.ts) est le
		   point de partage entre engine.ts et scanner.ts pour la TOLÉRANCE aux
		   éléments parasites d'un bloc JSON5 (`null`, une chaîne isolée) — le
		   scanner l'a toujours eue (`q?.id, q?.title`), engine.ts ne l'avait
		   pas (`q.id` sans `?.`, TypeError à l'assemblage du ctx, bloc entier
		   qui ne rend plus).
		   Calcul À LA MAIN, aucune exécution copiée :
		     items = [{id:"a1",title:"A"}, null, {title:"Titre B"}, "parasite"]
		     reserves = {"a1"} (seul item0 a un id EXPLICITE, une chaîne non vide)
		     idx0 : explicite="a1" ⇒ base="a1", id===base ⇒ libre ⇒ "a1"
		     idx1 : (null)?.id/(null)?.title ⇒ undefined/undefined
		            ⇒ slug(undefined)="" ⇒ base="q2" (idx+1=2) ⇒ libre ⇒ "q2"
		     idx2 : {title:"Titre B"} ⇒ slug("Titre B") :
		            "titre b".toLowerCase() puis [^a-z0-9]+→"-" : "titre"+"-"+"b"="titre-b"
		            ⇒ base="titre-b" ⇒ libre ⇒ "titre-b"
		     idx3 : "parasite"?.id ⇒ undefined (une chaîne n'a pas de propriété .id)
		            ⇒ slug(undefined)="" ⇒ base="q4" (idx+1=4) ⇒ libre ⇒ "q4"
		     résultat attendu : ["a1", "q2", "titre-b", "q4"] */
		const r = makeReporter("quiz-ids — idsForRawItems tolère un élément parasite (fix 1)");
		const items = [{ id: "a1", title: "A" }, null, { title: "Titre B" }, "parasite"];
		let leve = null;
		let ids = null;
		try { ids = idsForRawItems(items); } catch (e) { leve = e; }
		r.check("aucune levée sur un élément null/chaîne", leve, null);
		r.check("identifiants calculés à la main", ids, ["a1", "q2", "titre-b", "q4"]);

		// Round de revue suivant (2026-09-03) : un second cas passait `items`
		// à `makeCtx`, qui appelle `idsForRawItems` avec les MÊMES arguments,
		// dans le MÊME process — il passait et échouait strictement avec le
		// cas ci-dessus, donc ne prouvait rien de plus. Aucun cas de ce script
		// ne peut charger la ligne `questionIds: idsForRawItems(quiz)` DANS
		// engine.ts lui-même (`renderInteractiveQuiz` a besoin d'un DOM) ;
		// seul `check-lesson.mjs`/l'usage réel dans Obsidian couvre ce fil.
		r.done();
	}

	/* ────────────────────────────────────────────────────────────
	   Case B — la boucle par question de goToResults (engine/state.ts),
	   second point d'enregistrement : la soumission.
	   ──────────────────────────────────────────────────────────── */
	{
		const r = makeReporter("goToResults — verdict par question (mode Leçon, rôles mixtes)");
		const quiz = [
			{ id: "read1", title: "Support", role: "read" },
			{ id: "skip1", title: "Pré sautée", options: ["a", "b"], correctIndex: 0 },
			{ id: "ok1", title: "Juste", options: ["a", "b"], correctIndex: 0 },
			{ id: "bad1", title: "Fausse", options: ["a", "b"], correctIndex: 0 },
			{ id: "inc1", title: "Sans réponse", options: ["a", "b"], correctIndex: 0 },
			{ id: "done1", title: "Déjà notée", options: ["a", "b"], correctIndex: 0 },
		];
		const roles = ["read", "test", "test", "test", "test", "test"];
		const selections = [null, null, 0, 1, null, 0];
		const lessonPreSkipped = [false, true, false, false, false, false];
		// i5 ("done1") a déjà été journalisée par l'auto-évaluation d'une
		// question "recall" avant la soumission : la boucle doit la laisser
		// intacte (ni double appel, ni écrasement du drapeau).
		const recordedInit = [false, false, false, false, false, true];

		const { ctx, appels } = makeCtx({ quiz, selections, isLessonMode: true, roles, lessonPreSkipped, recordedInit });
		ctx.goToResults();

		const attendu = [
			{ q: "Cours/ch1.md::read1", grade: "seen", role: "read" },
			{ q: "Cours/ch1.md::skip1", grade: "skipped", role: "test" },
			{ q: "Cours/ch1.md::ok1", grade: "correct", role: "test" },
			{ q: "Cours/ch1.md::bad1", grade: "wrong", role: "test" },
		];
		r.check("carte 'read' → seen ; pré sautée → skipped ; juste/fausse → correct/wrong ; " +
			"sans réponse omise ; déjà notée non recomptée", appels, attendu);
		r.check("le drapeau recorded reflète exactement ce qui a été journalisé",
			ctx.quizState.recorded, [true, true, true, true, false, true]);
		r.check("la session n'est comptée qu'une fois (double clic)", ctx.quizState.resultsCounted, true);
		r.done();
	}

	{
		/* Fix 2, scénario exact demandé par le ruling : une question "pre"
		   répondue APRÈS que la Leçon a basculé en Examen (switchToExamMode,
		   engine.ts) doit toujours porter `role: "pre"` dans le journal — sinon
		   `signalOf` (scheduler/state.ts) la compterait comme un succès/échec
		   ordinaire, ce que le noyau interdit explicitement pour "pre".
		   Une carte "read" dans le MÊME lot vérifie l'autre moitié du ruling :
		   « le mode gate ne sert plus qu'à la branche read » — en Examen,
		   `isLessonMode()` vaut faux, donc "read" NE doit PLUS court-circuiter
		   vers "seen" : la carte est notée sur son verdict réel comme une
		   question normale (elle est répondue, donc "correct"/"wrong"), avec
		   son rôle "read" tout de même journalisé (utile à l'historique,
		   inoffensif ici : `signalOf`, scheduler/state.ts, ne distingue QUE
		   `role === "pre"` — pour tout autre rôle il dérive le signal du seul
		   `grade`, donc journaliser "read" à côté d'un grade "correct"/"wrong"
		   ne change rien à ce que l'ordonnanceur en tire). */
		const r = makeReporter("goToResults — le rôle survit à une bascule Leçon → Examen (fix 2)");
		const quiz = [
			{ id: "pre1", title: "Pré-question", options: ["a", "b"], correctIndex: 0 },
			{ id: "read1", title: "Support répondu en Examen", options: ["a", "b"], correctIndex: 0 },
		];
		const roles = ["pre", "read"];
		// Les deux cartes sont répondues (Examen : plus de "pre" ni "read" au
		// sens Leçon, ce sont des questions QCM normales) : pre1 correcte, read1 fausse.
		const selections = [0, 1];
		const { ctx, appels } = makeCtx({
			quiz, selections, isLessonMode: false, originalQuizMode: "lesson", roles,
		});
		ctx.goToResults();
		r.check("la 'pre' répondue en Examen garde role:'pre' et son verdict réel (pas 'seen')",
			appels.find(a => a.q.endsWith("::pre1")), { q: "Cours/ch1.md::pre1", grade: "correct", role: "pre" });
		r.check("la 'read' répondue en Examen garde role:'read' mais N'EST PLUS forcée à 'seen'",
			appels.find(a => a.q.endsWith("::read1")), { q: "Cours/ch1.md::read1", grade: "wrong", role: "read" });
		r.done();
	}

	{
		/* LECTURES ABSORBÉES (2026-09-26, src/lecture-etape.ts) : la lecture
		   d'une étape qui a d'autres questions n'a plus d'écran. En Leçon elle
		   reste journalisée `seen` (aucun signal de mémoire) et ne compte ni
		   au score ni aux questions faites ; basculée en Examen, elle n'a été
		   ni montrée ni répondue : rien n'est journalisé, et elle ne manque pas. */
		const r = makeReporter("goToResults — lecture absorbée par son étape");
		const quiz = [
			{ id: "pre1", title: "Avant", options: ["a", "b"], correctIndex: 0 },
			{ id: "read1", title: "Cours" },
			{ id: "q1", title: "Test", options: ["a", "b"], correctIndex: 0 },
		];
		const roles = ["pre", "read", "test"];
		const lecon = makeCtx({ quiz, selections: [0, null, 0], isLessonMode: true, roles });
		lecon.ctx.lecturesAbsorbees = new Set([1]);
		lecon.ctx.goToResults();
		r.check("Leçon : la lecture absorbée est journalisée seen",
			lecon.appels.find(a => a.q.endsWith("::read1")), { q: "Cours/ch1.md::read1", grade: "seen", role: "read" });
		r.check("Leçon : le score ignore la lecture absorbée", lecon.ctx.computeScorePercent(), { pct: 100, correct: 2, total: 2 });

		const examen = makeCtx({ quiz, selections: [0, null, 1], isLessonMode: false, originalQuizMode: "lesson", roles });
		examen.ctx.lecturesAbsorbees = new Set([1]);
		r.check("Examen après bascule : la lecture absorbée ne manque pas", examen.ctx.isComplete(1), true);
		examen.ctx.goToResults();
		r.check("Examen après bascule : rien n'est journalisé pour la lecture absorbée",
			examen.appels.some(a => a.q.endsWith("::read1")), false);
		r.check("Examen après bascule : le score ignore la lecture absorbée", examen.ctx.computeScorePercent(), { pct: 50, correct: 1, total: 2 });
		r.done();
	}

	{
		const r = makeReporter("goToResults — hors mode Leçon, verdict QCM ordinaire, pas de rôle");
		const quiz = [
			{ id: "q1", title: "Q1", options: ["a", "b"], correctIndex: 0 },
			{ id: "q2", title: "Q2", options: ["a", "b"], correctIndex: 0 },
		];
		const { ctx, appels } = makeCtx({ quiz, selections: [0, 1], isLessonMode: false });
		ctx.goToResults();
		r.check("QCM ordinaire : correct/wrong, sans propriété 'role'", appels, [
			{ q: "Cours/ch1.md::q1", grade: "correct" },
			{ q: "Cours/ch1.md::q2", grade: "wrong" },
		]);
		r.done();
	}

	{
		const r = makeReporter("goToResults — double clic (resultsCounted) ne rejournalise rien");
		const quiz = [{ id: "q1", title: "Q1", options: ["a", "b"], correctIndex: 0 }];
		const { ctx, appels } = makeCtx({ quiz, selections: [0], isLessonMode: false });
		ctx.goToResults();
		ctx.goToResults();
		r.check("un deuxième 'Voir le score' n'ajoute aucune ligne", appels.length, 1);
		r.done();
	}

	{
		/* Minor promu : le journal de l'ordonnanceur ne doit plus dépendre de
		   la présence d'un `statsSink` — un store sans rapport avec lui. */
		const r = makeReporter("goToResults — le journal ne dépend pas du statsStore (minor)");
		const quiz = [{ id: "q1", title: "Q1", options: ["a", "b"], correctIndex: 0 }];
		const { ctx, appels } = makeCtx({ quiz, selections: [0], isLessonMode: false, statsStore: null });
		ctx.goToResults();
		r.check("aucun statsSink : la question est quand même journalisée", appels.length, 1);
		r.check("aucun statsSink : la session est quand même comptée une fois", ctx.quizState.resultsCounted, true);
		r.done();
	}

	{
		/* Minor promu : un puits tiers qui lève ne doit jamais casser le rendu
		   — ni la boucle de goToResults, ni la navigation vers les résultats
		   qui la suit. */
		const r = makeReporter("goToResults / recordReview — un puits qui lève ne casse rien (minor)");
		const quiz = [{ id: "q1", title: "Q1", options: ["a", "b"], correctIndex: 0 }];
		const sinkQuiLeve = { keyOf: (p, id) => `${p}::${id}`, record: () => { throw new Error("puits tiers en panne"); } };

		// L'erreur est attendue (loggée par le `catch` de `recordReview`) : la
		// capturer évite de polluer la sortie du script, comme check-review-store.mjs.
		const erreurs = [];
		const originalError = console.error;
		console.error = (...args) => { erreurs.push(args); };
		try {
			const { ctx: ctxDirect } = makeCtx({ quiz, selections: [null], reviewSink: sinkQuiLeve });
			let leveDirect = null;
			try { ctxDirect.recordReview(0, "correct"); } catch (e) { leveDirect = e; }
			r.check("recordReview seul : rien ne remonte", leveDirect, null);

			const { ctx: ctxSoumission } = makeCtx({ quiz, selections: [0], reviewSink: sinkQuiLeve });
			let leveSoumission = null;
			try { ctxSoumission.goToResults(); } catch (e) { leveSoumission = e; }
			r.check("goToResults : rien ne remonte, la boucle va à son terme", leveSoumission, null);
			// resultsCounted est posé AVANT la boucle par question (state.ts) :
			// il resterait vrai même sans le try/catch, donc ne PROUVE rien ici.
			// Ce qui dépend vraiment du try/catch, c'est `recorded[i]` (déplacé
			// APRÈS l'appel au puits) : un puits qui lève ne doit pas marquer la
			// question comme journalisée, pour qu'une nouvelle tentative reste
			// possible — sinon la réponse serait perdue pour la session entière.
			r.check("goToResults : un puits qui lève laisse recorded[i] à faux (nouvelle tentative possible)",
				ctxSoumission.quizState.recorded[0], false);
			r.check("chaque échec du puits est signalé une fois (deux appels distincts)", erreurs.length, 2);
		} finally {
			console.error = originalError;
		}
		r.done();
	}

	/* ────────────────────────────────────────────────────────────
	   Case C — l'AUTRE point d'enregistrement : l'auto-évaluation
	   (engine/text-only.ts, seul chemin resté sans couverture au round 1).
	   ──────────────────────────────────────────────────────────── */
	{
		const r = makeReporter("text-only.ts — le clic sur une note appelle recordReview (fix minor : couverture)");
		const quiz = [{ id: "recall1", title: "Restitution", role: "recall" }];
		// `textOnly` doit exister sur ctx pour que `hasAnyAnswer`/`isComplete`/
		// `isCorrect` (state.ts) empruntent la branche auto-évaluation — seul
		// chemin de state.ts resté sans couverture au round 1.
		const textOnlyStub = {
			isTextOnlyFor: () => true,
			hasAnyAnswer: () => true,
			isChecked: () => true,
			isRated: () => true,
		};
		const { ctx, appels } = makeCtx({
			quiz, selections: [null], isLessonMode: true, roles: ["recall"], textOnly: textOnlyStub,
		});

		// isCorrect/isComplete empruntent bien la branche auto-évaluation :
		// preuve que `textOnly` n'est pas un mock mort dans ce test.
		r.check("isComplete emprunte la branche auto-évaluation (textOnly.isRated)", ctx.isComplete(0), true);
		ctx.quizState.textOnlyRatings[0] = "understood";
		r.check("isCorrect emprunte la branche auto-évaluation (rating 'understood')", ctx.isCorrect(0), true);

		const textOnlyHandlers = createTextOnlyHandlers(ctx);
		const bouton = fakeRatingButton("understood");
		const trackItem = fakeTrackItem([bouton]);
		textOnlyHandlers.bindTextOnlyQuestion(trackItem, 0);
		bouton.click();

		r.check("le clic pose la note dans quizState.textOnlyRatings", ctx.quizState.textOnlyRatings[0], "understood");
		r.check("le clic a bien appelé recordReview (une ligne journalisée)", appels, [
			{ q: "Cours/ch1.md::recall1", grade: "understood", role: "recall" },
		]);
		r.done();
	}

	/* ────────────────────────────────────────────────────────────
	   Case D — la CARTE MÉMOIRE emprunte l'auto-évaluation, même hors Leçon.
	   ──────────────────────────────────────────────────────────── */
	{
		const r = makeReporter("carte mémoire — retournée, notée, journalisée une fois");
		const quiz = [{ id: "carte1", title: "Carte", prompt: "Que renvoie `type([])` ?", flashcard: true, answer: "list" }];
		const { ctx, appels } = makeCtx({ quiz, selections: [null], isLessonMode: false, roles: [undefined], textOnly: null });
		ctx.quizState.textOnlyAnswers = [""];
		ctx.quizState.textOnlyChecked = [false];
		ctx.textOnly = createTextOnlyHandlers(ctx);

		r.check("une carte est auto-évaluée même hors Leçon", ctx.textOnly.isTextOnlyFor(0), true);
		r.check("non notée : incomplète", ctx.isComplete(0), false);
		const html = ctx.textOnly.questionCardBodyHtml(quiz[0], 0);
		r.check("recto : un bouton Retourner, aucune zone de saisie",
			[html.includes("quiz-flashcard-flip-btn"), html.includes("<textarea")], [true, false]);

		ctx.quizState.textOnlyChecked[0] = true;
		const verso = ctx.textOnly.questionCardBodyHtml(quiz[0], 0);
		r.check("verso : deux notes seulement, review puis understood",
			[...verso.matchAll(/data-textonly-rating="(\w+)"/g)].map(m => m[1]), ["review", "understood"]);

		const bouton = fakeRatingButton("review");
		ctx.textOnly.bindTextOnlyQuestion(fakeTrackItem([bouton]), 0);
		bouton.click();
		bouton.click();
		r.check("« À revoir » : faux, complet, UNE ligne au journal",
			[ctx.isCorrect(0), ctx.isComplete(0), appels],
			[false, true, [{ q: "Cours/ch1.md::carte1", grade: "review" }]]);

		const sansVerso = { id: "carte2", title: "Vide", prompt: "P", flashcard: true };
		r.check("carte sans verso : « Réponse manquante », jamais une exception",
			ctx.textOnly.questionCardBodyHtml(sansVerso, 0).includes("quiz-flashcard-missing"), true);
		r.done();
	}

	/* ────────────────────────────────────────────────────────────
	   Case E — un "recall" ne force la réponse libre QUE pour un type à
	   CHOIX (single/multiple). Un "recall" d'association (matching) garde sa
	   VRAIE interaction : forcer la réponse libre dessus masquerait la
	   correction réelle (paires attendues) derrière une auto-évaluation.
	   Rougit sans le correctif (isTextOnlyFor testait alors uniquement le
	   rôle, jamais le type de la question).
	   ──────────────────────────────────────────────────────────── */
	{
		const r = makeReporter("text-only.ts — un recall matching garde sa vraie interaction, un recall single reste en réponse libre");
		const single = { id: "q1", title: "Choix", role: "recall", options: ["a", "b"], correctIndex: 0 };
		const matching = { id: "q2", title: "Association", role: "recall", matching: true, rows: ["x"], choices: ["y"], correctMap: [0] };
		const quiz = [single, matching];
		const { ctx } = makeCtx({ quiz, selections: [null, null], isLessonMode: true, roles: ["recall", "recall"] });
		// makeCtx câble un stub `isMatchingQuestion` toujours faux (aucun test
		// antérieur n'en avait besoin) : ici la variante DOIT être reconnue,
		// donc on la remplace par le vrai prédicat (même forme qu'engine.ts).
		ctx.isMatchingQuestion = (q) => !!q && (q.matching === true || typeof q.matching === "object");
		ctx.textOnly = createTextOnlyHandlers(ctx);

		r.check("recall à choix (single) : réponse libre", ctx.textOnly.isTextOnlyFor(0), true);
		r.check("recall matching : vraie interaction, jamais de réponse libre", ctx.textOnly.isTextOnlyFor(1), false);
		r.done();
	}
});
