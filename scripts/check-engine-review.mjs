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
	["src/engine/state.ts", "src/quiz-ids.ts", "src/engine/text-only.ts", "src/engine/learn.ts", "src/engine/learn-loop.ts"],
	async ({ createStateHandlers }, { idsForRawItems }, { createTextOnlyHandlers }, { createLearnHandlers }, { emptyLearnState }) => {
	/**
	 * Construit un ctx minimal, avec le câblage croisé réel des méthodes
	 * aplaties (même pattern qu'engine.ts).
	 *
	 * `quizMode` and `isLessonMode` are two INDEPENDENT parameters: by
	 * default `quizMode` follows `isLessonMode`, but a test can split them
	 * to play a Learn block WITHOUT a valid slice (`quizMode: "lesson"`,
	 * `isLessonMode: false`, engine/lesson.ts buildLessonModel) — the one
	 * state where the block's mode and `isLessonMode()` still differ since
	 * the Learn → Exam switch left (2026-09-29).
	 */
	function makeCtx({
		quiz,
		selections,
		isLessonMode = false,
		roles = [],
		lessonPreSkipped = [],
		recordedInit = [],
		sourcePath = "Cours/ch1.md",
		reviewSink: sinkOverride,
		statsStore = { updateRecord() {} },
		textOnly,
		quizMode,
		/* A Test's verdicts are written at hand-in only (`goToResults` sets
		   `resultsCounted` first): a direct `recordReview` on a Test must
		   say it is past the hand-in. */
		handedIn = false,
		hintSeen = [],
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
			// Exercice de code (engine/state.ts isCorrect) et bulle de
			// définition (goToSlide) : hors sujet ici, des stubs suffisent.
			isCodeQuestion: () => false,
			termes: { poserTermes: () => {}, fermerBulle: () => {} },
			isLessonMode: () => isLessonMode,
			// The Learn retry loop (engine/learn.ts) reads the CURRENT mode.
			quizMode: quizMode ?? (isLessonMode ? "lesson" : "quiz"),
			sliceOfQuestion: () => null,
			questionSuivante: (qi) => (qi + 1 < quiz.length ? qi + 1 : null),
			goToQuestion: () => {},
			initSelections: () => quiz.map(() => null),
			buildShuffleMap: () => quiz.map(() => null),
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
			resultsCounted: handedIn,
			hintSeen: hintSeen.length ? hintSeen : quiz.map(() => false),
			shuffleMap: quiz.map(() => null),
			orderingPick: quiz.map(() => null),
			matchPick: quiz.map(() => null),
			...emptyLearnState(quiz.length),
		};
		// The REAL Learn handlers, lazy like in engine.ts.
		ctx.learn = createLearnHandlers(ctx);
		ctx.isRevealed = ctx.learn.isRevealed;

		const handlers = createStateHandlers(ctx);
		Object.assign(ctx, {
			hasAnyAnswer: handlers.hasAnyAnswer,
			isComplete: handlers.isComplete,
			isCorrect: handlers.isCorrect,
			computeScorePercent: handlers.computeScorePercent,
			countRightWithHint: handlers.countRightWithHint,
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
		const { ctx: sansPuits } = makeCtx({ quiz, selections: [null], reviewSink: null, handedIn: true });
		sansPuits.recordReview(0, "correct");
		r.check("puits absent : rien n'est marqué journalisé", sansPuits.quizState.recorded[0], false);

		const { ctx: sansChemin, appels } = makeCtx({ quiz, selections: [null], sourcePath: "", handedIn: true });
		sansChemin.recordReview(0, "correct");
		r.check("sourcePath absent (aperçu éditeur) : aucun appel au puits", appels.length, 0);
		r.check("sourcePath absent : rien n'est marqué journalisé", sansChemin.quizState.recorded[0], false);
		r.done();
	}

	{
		const r = makeReporter("recordReview — dédoublonnage (une fois par session)");
		const quiz = [{ id: "q1", title: "T1" }];
		const { ctx, appels } = makeCtx({ quiz, selections: [null], handedIn: true });
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
		const r = makeReporter("recordReview — role included as soon as the block is a Learn");
		const quiz = [{ id: "q1", title: "T1" }];

		const { ctx: horsLecon, appels: a1 } = makeCtx({ quiz, selections: [null], isLessonMode: false, roles: ["recall"], handedIn: true });
		horsLecon.recordReview(0, "understood");
		r.check("bloc jamais Leçon : pas de propriété 'role'", Object.prototype.hasOwnProperty.call(a1[0], "role"), false);

		const { ctx: enLecon, appels: a2 } = makeCtx({ quiz, selections: [null], isLessonMode: true, roles: ["recall"] });
		enLecon.recordReview(0, "understood");
		r.check("en Leçon (mode courant) : le rôle déclaré est copié", a2[0]?.role, "recall");

		// A Learn block without a valid slice: `isLessonMode()` is false but
		// the author wrote a Learn. `roleOfQuestion` returns the declared role
		// whatever the mode (engine/lesson.ts buildLessonModel.roleOf): the gate
		// follows the BLOCK's mode (`quizMode`), not `isLessonMode()`.
		const { ctx: sansTranche, appels: a3 } = makeCtx({
			quiz, selections: [null], isLessonMode: false, quizMode: "lesson", roles: ["recall"],
		});
		sansTranche.recordReview(0, "understood");
		r.check("Learn block without a valid slice: the role SURVIVES", a3[0]?.role, "recall");
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
		const { ctx, appels } = makeCtx({ quiz, selections: [null, null], handedIn: true });
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
		/* A Learn block WITHOUT a valid slice is played as an ordinary quiz
		   (`isLessonMode()` false), but a "pre" question must still carry
		   `role: "pre"` in the log — otherwise `signalOf` (scheduler/state.ts)
		   would count it as an ordinary success/failure, which the core
		   explicitly forbids for "pre". A "read" card in the SAME batch checks
		   the other half: with `isLessonMode()` false, "read" must NOT
		   short-circuit to "seen": the card gets its real verdict like an
		   ordinary question (it was answered, so "correct"/"wrong"), with its
		   "read" role still logged (harmless: `signalOf` only singles out
		   `role === "pre"`; for any other role the signal comes from `grade`
		   alone). */
		const r = makeReporter("goToResults — the role survives in a Learn block without a valid slice");
		const quiz = [
			{ id: "pre1", title: "Pré-question", options: ["a", "b"], correctIndex: 0 },
			{ id: "read1", title: "Answered reading", options: ["a", "b"], correctIndex: 0 },
		];
		const roles = ["pre", "read"];
		// Both cards are answered (no active Learn: ordinary multiple-choice
		// questions): pre1 right, read1 wrong.
		const selections = [0, 1];
		const { ctx, appels } = makeCtx({
			quiz, selections, isLessonMode: false, quizMode: "lesson", roles,
		});
		ctx.goToResults();
		r.check("the answered 'pre' keeps role:'pre' and its real verdict (not 'seen')",
			appels.find(a => a.q.endsWith("::pre1")), { q: "Cours/ch1.md::pre1", grade: "correct", role: "pre" });
		r.check("the answered 'read' keeps role:'read' but is NOT forced to 'seen'",
			appels.find(a => a.q.endsWith("::read1")), { q: "Cours/ch1.md::read1", grade: "wrong", role: "read" });
		r.done();
	}

	{
		/* LECTURES ABSORBÉES (2026-09-26, src/lecture-etape.ts) : la lecture
		   d'une étape qui a d'autres questions n'a plus d'écran. En Leçon elle
		   reste journalisée `seen` (aucun signal de mémoire) et ne compte ni
		   au score ni aux questions faites. */
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
		r.check("Leçon : le score ignore la lecture absorbée", lecon.ctx.computeScorePercent(), { pct: 100, correct: 2, total: 2, pendingWritten: 0 });

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
			const { ctx: ctxDirect } = makeCtx({ quiz, selections: [null], reviewSink: sinkQuiLeve, handedIn: true });
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
		// Since the 2026-09-27 redesign the prompt is rendered ON the card's
		// front by the flashcard itself (cards.ts no longer draws it above).
		ctx.cards = { ...(ctx.cards ?? {}), renderQuizPromptHtml: q => String(q.prompt ?? "") };
		ctx.escapeHtmlAttr ??= v => String(v);

		r.check("une carte est auto-évaluée même hors Leçon", ctx.textOnly.isTextOnlyFor(0), true);
		r.check("non notée : incomplète", ctx.isComplete(0), false);
		const html = ctx.textOnly.questionCardBodyHtml(quiz[0], 0);
		r.check("recto : un bouton Retourner, aucune zone de saisie",
			[html.includes("quiz-flashcard-flip-btn"), html.includes("<textarea")], [true, false]);
		r.check("front: the prompt is on the card, the answer is not in the DOM yet",
			[html.includes("Que renvoie"), html.includes("quiz-flashcard-back"), html.includes(">list<")], [true, false, false]);

		ctx.quizState.textOnlyChecked[0] = true;
		const verso = ctx.textOnly.questionCardBodyHtml(quiz[0], 0);
		r.check("verso : deux notes seulement, review puis understood",
			[...verso.matchAll(/data-textonly-rating="(\w+)"/g)].map(m => m[1]), ["review", "understood"]);

		const bouton = fakeRatingButton("review");
		ctx.textOnly.bindTextOnlyQuestion(fakeTrackItem([bouton]), 0);
		bouton.click();
		bouton.click();
		/* Outside a Learn the card is part of a TEST: its rating waits for the
		   hand-in (spec 2026-09-29 §2.4), then is written as rated, once. */
		r.check("« À revoir » : faux, complet, rien au journal avant de rendre",
			[ctx.isCorrect(0), ctx.isComplete(0), appels], [false, true, []]);
		ctx.goToResults();
		r.check("… puis UNE ligne au journal, avec sa note, au moment de rendre",
			appels, [{ q: "Cours/ch1.md::carte1", grade: "review" }]);

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

	/* ────────────────────────────────────────────────────────────
	   Case F — retour #14 (2026-09-27) : « 2 answers are missing » affiché
	   pour des questions à réponse écrite pourtant remplies. Plus de bouton
	   Vérifier : une réponse écrite non vide doit compter comme répondue
	   (isComplete), sans attendre une note qui n'arrive plus qu'à l'écran des
	   résultats. Rougit sans le correctif (isComplete exigeait isRated pour
	   TOUTE question textOnly, carte mémoire ou non).
	   ──────────────────────────────────────────────────────────── */
	{
		const r = makeReporter("retour #14 — une réponse écrite non notée compte comme répondue (isComplete)");
		const quiz = [{ id: "q1", title: "Restitution", role: "recall", options: ["a", "b"], correctIndex: 0 }];
		const { ctx } = makeCtx({ quiz, selections: [null], isLessonMode: true, roles: ["recall"] });
		ctx.quizState.textOnlyAnswers = ["une réponse écrite"];
		ctx.quizState.textOnlyChecked = [false];
		ctx.textOnly = createTextOnlyHandlers(ctx);

		r.check("une réponse écrite non vide, jamais notée : complète quand même", ctx.isComplete(0), true);
		r.done();
	}

	/* ────────────────────────────────────────────────────────────
	   Case G — retour #17 (2026-09-27) : le score exclut une réponse écrite
	   pas encore auto-évaluée (ni juste ni fausse) plutôt que de la compter
	   fausse, et la compte dès qu'elle est notée à l'écran des résultats.
	   ──────────────────────────────────────────────────────────── */
	{
		const r = makeReporter("retour #17 — le score exclut une réponse écrite pas encore évaluée, puis la compte une fois notée");
		const quiz = [
			{ id: "q1", title: "QCM", options: ["a", "b"], correctIndex: 0 },
			{ id: "q2", title: "Restitution", role: "recall", options: ["a", "b"], correctIndex: 0 },
		];
		const { ctx } = makeCtx({ quiz, selections: [0, null], isLessonMode: true, roles: [undefined, "recall"] });
		ctx.quizState.textOnlyAnswers = ["", "une réponse écrite"];
		ctx.quizState.textOnlyChecked = [false, false];
		ctx.textOnly = createTextOnlyHandlers(ctx);

		r.check("pas encore évaluée : exclue du score (total = 1, pas 2), signalée en pendingWritten",
			ctx.computeScorePercent(), { pct: 100, correct: 1, total: 1, pendingWritten: 1 });

		ctx.quizState.textOnlyRatings[1] = "understood";
		r.check("évaluée « juste » : entre dans le score",
			ctx.computeScorePercent(), { pct: 100, correct: 2, total: 2, pendingWritten: 0 });

		ctx.quizState.textOnlyRatings[1] = "review";
		r.check("évaluée « faux » : entre dans le score, mais fausse",
			ctx.computeScorePercent(), { pct: 50, correct: 1, total: 2, pendingWritten: 0 });
		r.done();
	}

	/* ────────────────────────────────────────────────────────────
	   Case H — revue lot A1, C1 (2026-09-27) : goToResults journalisait
	   "wrong" pour une réponse écrite pas encore jugée, AVANT le clic de
	   l'utilisateur sur juste/faux — et `recorded[i]` posé par cette écriture
	   prématurée faisait ensuite REJETER le vrai verdict (recordReview refuse
	   tout déjà-journalisé). Rougit sans le correctif (la boucle de
	   goToResults journalisait "wrong" ici).
	   ──────────────────────────────────────────────────────────── */
	{
		const r = makeReporter("goToResults — retour C1 : une réponse écrite pas encore jugée n'est pas journalisée à sa place du vrai verdict");
		const quiz = [{ id: "q1", title: "Restitution", role: "recall", options: ["a", "b"], correctIndex: 0 }];
		const { ctx, appels } = makeCtx({ quiz, selections: [null], isLessonMode: true, roles: ["recall"] });
		ctx.quizState.textOnlyAnswers = ["une réponse écrite"];
		ctx.quizState.textOnlyChecked = [false];
		ctx.textOnly = createTextOnlyHandlers(ctx);

		ctx.goToResults();
		r.check("l'arrivée sur les résultats n'écrit rien pour elle (pas encore jugée)", appels, []);
		r.check("recorded reste faux : le futur clic pourra journaliser le vrai verdict", ctx.quizState.recorded[0], false);

		// Simule le clic « J'avais juste » (text-only.ts bindWrittenReviewControls).
		ctx.quizState.textOnlyRatings[0] = "understood";
		ctx.recordReview(0, "understood");
		r.check("le clic journalise le VRAI verdict, une seule fois",
			appels, [{ q: "Cours/ch1.md::q1", grade: "understood", role: "recall" }]);
		r.done();
	}

	/* ────────────────────────────────────────────────────────────
	   Case I — revue lot A1, I1 (2026-09-27) : la progression du tableau de
	   bord comptait une réponse écrite pas encore jugée comme faite
	   (`questionsDone`), et pouvait retomber sur `ctx.quiz.length` pour
	   `totalQuestions` — un quiz entièrement écrit et jamais auto-évalué
	   affichait 100 % de progression. Rougit sans le correctif.
	   ──────────────────────────────────────────────────────────── */
	{
		const r = makeReporter("goToResults — retour I1 : la progression exclut une réponse écrite pas encore jugée");
		const quiz = [
			{ id: "read1", title: "Support", role: "read" },
			{ id: "q1", title: "Restitution", role: "recall", options: ["a", "b"], correctIndex: 0 },
		];
		const updates = [];
		const statsStore = { updateRecord(_path, rec) { updates.push(rec); } };
		const { ctx } = makeCtx({ quiz, selections: [null, null], isLessonMode: true, roles: ["read", "recall"], statsStore });
		ctx.quizState.textOnlyAnswers = ["", "une réponse écrite"];
		ctx.quizState.textOnlyChecked = [false, false];
		ctx.textOnly = createTextOnlyHandlers(ctx);

		ctx.goToResults();
		r.check("progression : 0 question faite sur 1 (la lecture ne compte pas, l'écrite non jugée non plus)",
			[updates[0].questionsDone, updates[0].totalQuestions], [0, 1]);

		ctx.quizState.textOnlyRatings[1] = "understood";
		ctx.quizState.resultsCounted = false; // simule un nouveau passage par les résultats
		ctx.goToResults();
		r.check("une fois jugée : 1 question faite sur 1",
			[updates[1].questionsDone, updates[1].totalQuestions], [1, 1]);
		r.done();
	}

	/* ────────────────────────────────────────────────────────────
	   Case L — THE LEARN RETRY LOOP (engine/learn.ts, 2026-09-29): the
	   journal keeps the FIRST attempt only, the score counts right-first-time
	   answers only.
	   ──────────────────────────────────────────────────────────── */
	{
		const r = makeReporter("Learn — check, retry, first attempt journalled once");
		const quiz = [
			{ id: "a", title: "A", prompt: "A ?", options: ["x", "y"], correctIndex: 0 },
			{ id: "b", title: "B", prompt: "B ?", options: ["x", "y"], correctIndex: 1 },
			{ id: "c", title: "C", prompt: "C ?", options: ["x", "y"], correctIndex: 0 },
		];
		const { ctx, appels } = makeCtx({ quiz, selections: [0, 0, 1], isLessonMode: true, roles: ["test", "test", "test"], textOnly: null });
		ctx.textOnly = createTextOnlyHandlers(ctx);
		ctx.quizState.textOnlyAnswers = ["", "", ""];
		ctx.quizState.textOnlyChecked = [false, false, false];

		r.check("an answered Learn question can be checked", ctx.learn.canCheck(0), true);
		ctx.learn.checkQuestion(0);
		r.check("right the first time: green, revealed, journalled at the check",
			[ctx.learn.verdictOf(0), ctx.isRevealed(0), appels.length], ["first", true, 1]);
		r.check("a revealed question cannot be checked again", ctx.learn.canCheck(0), false);

		ctx.learn.checkQuestion(1);
		r.check("a miss: red, queued, journalled wrong",
			[ctx.learn.verdictOf(1), ctx.quizState.learnQueue, appels[1]?.grade], ["missed", [{ qi: 1, since: 0 }], "wrong"]);

		// Q2 answered wrong too, then its retry comes back later.
		ctx.learn.checkQuestion(2);
		// From the last question, past the end: the queued ones come back.
		const move = ctx.learn.advance(2);
		r.check("past the last question, a missed one comes back", [move.kind, ctx.quizState.learnRetrying[1]], ["retry", true]);
		r.check("its answer is cleared for the retry", ctx.quizState.selections[1], null);
		ctx.quizState.selections[1] = 1;
		ctx.learn.checkQuestion(1);
		r.check("right on its retry: orange, and NOT journalled again",
			[ctx.learn.verdictOf(1), appels.length], ["retried", 3]);
		r.check("the score counts right-first-time answers only (1 of 3)",
			[ctx.computeScorePercent().correct, ctx.computeScorePercent().total], [1, 3]);

		ctx.goToResults();
		r.check("the results journal nothing more for checked questions", appels.length, 3);
		r.done();
	}

	{
		const r = makeReporter("Learn — outside a Learn, nothing changes");
		const quiz = [{ id: "a", title: "A", prompt: "A ?", options: ["x", "y"], correctIndex: 0 }];
		const { ctx } = makeCtx({ quiz, selections: [0], isLessonMode: false, roles: [undefined], textOnly: null });
		ctx.textOnly = createTextOnlyHandlers(ctx);
		ctx.quizState.textOnlyAnswers = [""];
		ctx.quizState.textOnlyChecked = [false];
		r.check("no check outside a Learn", [ctx.learn.isActive(), ctx.learn.canCheck(0), ctx.isRevealed(0)], [false, false, false]);
		r.check("the next arrow goes straight on", ctx.learn.advance(0), { kind: "go", qi: null });
		r.done();
	}
	{
		/* VERDICTS OF A TEST, at hand-in (spec 2026-09-29 §2.4): right without a
		   hint → correct; right WITH a hint → wrong; wrong → wrong; unanswered
		   → wrong. The score does not change (the hint is only counted); the
		   attempt keeps its "right with a hint" count. */
		const r = makeReporter("Test — verdicts at hand-in");
		const q = (id) => ({ id, title: id, options: ["a", "b"], correctIndex: 0 });

		/* A written answer (self-assessed) of a Test: left BLANK it is failed
		   at hand-in; written but not rated yet, it waits for its rating on
		   the results screen. */
		const ecrit = (texte) => {
			const x = makeCtx({ quiz: [{ id: "ecrit", title: "E" }], selections: [null],
				textOnly: { isTextOnlyFor: () => true, isRated: () => false, hasAnyAnswer: () => texte, isTextOnlyForAny: () => true } });
			x.ctx.goToResults();
			return x.appels.map(a => a.grade);
		};
		r.check("a written answer left blank is failed at hand-in; written, it waits for its rating",
			[ecrit(false), ecrit(true)], [["wrong"], []]);
		const quiz = [q("seul"), q("aide"), q("faux"), q("vide"), q("faux-aide")];
		const records = [];
		const statsStore = { updateRecord: (path, rec) => records.push(rec) };
		const { ctx, appels } = makeCtx({ quiz, selections: [0, 0, 1, null, 1], hintSeen: [false, true, false, false, true], statsStore });
		ctx.recordReview(0, "correct");
		r.check("nothing is written before the hand-in", appels.length, 0);
		ctx.goToResults();
		r.check("one verdict per question: right alone, right with a hint, wrong, unanswered",
			appels.map(a => [a.q.split("::")[1], a.grade]),
			[["seul", "correct"], ["aide", "wrong"], ["faux", "wrong"], ["vide", "wrong"], ["faux-aide", "wrong"]]);
		r.check("the score still counts the right answer found with a hint",
			[ctx.computeScorePercent().correct, ctx.computeScorePercent().total, ctx.countRightWithHint()], [2, 5, 1]);
		r.check("the attempt keeps its \"right with a hint\" count", records.map(x => x.withHint), [1]);

		/* "Try again" (resetQuiz) starts a NEW attempt: before 2026-09-29 it
		   left \`resultsCounted\` true, so the next score counted no attempt and
		   logged no verdict. */
		const reset = createStateHandlers(ctx).resetQuiz;
		Object.assign(ctx, {
			track: { clearTrackTransitionFallback() {} },
			viewport: { destroyActiveSlideResizeObserver() {}, destroyAllSlidesResizeObserver() {}, destroyViewportResizeObserver() {} },
			clearBackgroundWarmIdleHandle() {}, cancelEnsureTrackVisibleRaf() {}, setSlidingClass() {},
			initTextOnlyAnswers: () => quiz.map(() => ""), initTextOnlyChecked: () => quiz.map(() => false),
			initTextOnlyRatings: () => quiz.map(() => null), initOrderingPicks: () => quiz.map(() => null), initMatchPicks: () => quiz.map(() => null),
			passage: { resetPassageState() {} }, stopExamTimer() {}, render() {},
		});
		reset();
		// Played through again, on the results slide as in the other cases (no track to slide).
		ctx.quizState.current = ctx.SLIDE_RESULTS_INDEX;
		ctx.quizState.selections = [0, 0, 0, 0, 0];
		ctx.goToResults();
		r.check("after \"Try again\", the next hand-in is a new attempt with its verdicts",
			[records.length, appels.length], [2, 10]);

		/* THE SETUP OF THE NEW ATTEMPT (spec 2026-09-29-test-setup-modal-design.md
		   §3): "Try again" applies the setup chosen in the modal, and a test played
		   with a setup has no start screen — its clock runs from the render. A
		   legacy Exam (no setup) goes back to its start screen. */
		const chosen = { hints: true, timeLimitMinutes: 20 };
		Object.assign(ctx, {
			testSetup: { hints: false, timeLimitMinutes: 30 }, isExamMode: true, examDurationMs: 1_800_000,
			examStarted: true, examEnded: true, examTimeRemaining: 0,
			applyPendingSetup() { ctx.testSetup = chosen; ctx.examDurationMs = 1_200_000; },
		});
		reset();
		r.check("Try again with a setup: the chosen setup applies, the clock is whole again and already running (no start screen)",
			[ctx.testSetup, ctx.examDurationMs, ctx.examTimeRemaining, ctx.examStarted, ctx.examEnded], [chosen, 1_200_000, 1_200_000, true, false]);
		Object.assign(ctx, { testSetup: { hints: true, timeLimitMinutes: null }, isExamMode: false, examDurationMs: 0, examStarted: true, applyPendingSetup() {} });
		reset();
		r.check("Try again with an untimed setup: no clock, nothing started", [ctx.examTimeRemaining, ctx.examStarted], [0, false]);
		Object.assign(ctx, { testSetup: null, isExamMode: true, examDurationMs: 900_000, examStarted: true });
		delete ctx.applyPendingSetup;
		reset();
		r.check("Try again on a legacy Exam (no setup): back to its start screen with the whole clock",
			[ctx.examStarted, ctx.examTimeRemaining], [false, 900_000]);
		r.done();
	}

	{
		/* The attempt records whether Exam mode was on: hints off AND a time
		   limit (isExamSetup), nothing at all for a host that asks for no setup. */
		const r = makeReporter("Test — the attempt records whether Exam mode was on");
		const jouer = (testSetup) => {
			const records = [];
			const { ctx } = makeCtx({ quiz: [{ id: "a", title: "A", options: ["x", "y"], correctIndex: 0 }], selections: [0],
				statsStore: { updateRecord: (path, rec) => records.push(rec) } });
			if (testSetup !== undefined) ctx.testSetup = testSetup;
			ctx.goToResults();
			return "exam" in records[0] ? records[0].exam : "absent";
		};
		r.check("hints off + a time limit: an Exam attempt", jouer({ hints: false, timeLimitMinutes: 30 }), true);
		r.check("timed with hints, untimed without hints, plain: not an Exam attempt",
			[jouer({ hints: true, timeLimitMinutes: 30 }), jouer({ hints: false, timeLimitMinutes: null }), jouer({ hints: true, timeLimitMinutes: null })], [false, false, false]);
		r.check("a host without a setup records nothing about it", jouer(undefined), "absent");
		r.done();
	}

	{
		const r = makeReporter("Test — a self-assessed answer with a hint, and a Learn unchanged");
		const quiz = [{ id: "ecrit", title: "E" }];
		const { ctx, appels } = makeCtx({ quiz, selections: [null], hintSeen: [true], handedIn: true });
		ctx.recordReview(0, "understood");
		r.check("\"understood\" with a hint is \"review\" in a Test", appels[0]?.grade, "review");
		const learn = makeCtx({ quiz, selections: [null], isLessonMode: true, hintSeen: [true] });
		learn.ctx.recordReview(0, "correct");
		r.check("a Learn writes as it goes, and a hint does not change its verdict", learn.appels[0]?.grade, "correct");
		const learnVide = makeCtx({ quiz: [{ id: "v", title: "V", options: ["a", "b"], correctIndex: 0 }], selections: [null], isLessonMode: true, roles: ["test"] });
		learnVide.ctx.goToResults();
		r.check("a Learn writes nothing for an unanswered question", learnVide.appels.length, 0);
		const records = [];
		const learnAide = makeCtx({ quiz: [{ id: "a", title: "A", options: ["a", "b"], correctIndex: 0 }], selections: [0], isLessonMode: true, roles: ["test"], hintSeen: [true],
			statsStore: { updateRecord: (path, rec) => records.push(rec) } });
		learnAide.ctx.goToResults();
		r.check("a Learn's attempt carries no hint count", [records.length, records[0]?.withHint], [1, undefined]);
		r.done();
	}
});

/* HANDING IN A TEST (engine/hand-in.ts, spec 2026-09-29 §2.1, §3.2, §3.3):
   a Test never lands on the submit slide. Complete → straight to the
   correction; questions left unanswered → a confirmation, and nothing is
   handed in until it is accepted; already handed in → the results. A Learn
   is not a Test and keeps its submit step. An Exam shows no hints. */
await withSrcModule("src/engine/hand-in.ts", ({ createHandInHandlers }) => {
	const r = makeReporter("Hand in a Test");
	/* The smallest DOM the confirmation needs: an element that records what
	   was put in <body>, and the document's key listeners WITH their capture
	   flag — a listener removed with another flag than it was added with
	   stays in a real DOM. */
	const corps = [];
	const cles = [];
	const element = () => {
		const el = {
			className: "", innerHTML: "",
			addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], contains: () => false,
			remove() { const i = corps.indexOf(el); if (i >= 0) corps.splice(i, 1); },
		};
		return el;
	};
	globalThis.document = {
		activeElement: null,
		createElement: element,
		body: { appendChild: (el) => corps.push(el) },
		addEventListener: (k, f, capture) => cles.push({ k, f, capture: !!capture }),
		removeEventListener: (k, f, capture) => {
			const i = cles.findIndex(c => c.k === k && c.f === f && c.capture === !!capture);
			if (i >= 0) cles.splice(i, 1);
		},
	};
	const makeCtx = ({ quizMode = "quiz", missing = [], locked = false, isExamMode = false, hintsOff = isExamMode, textOnly = null } = {}) => {
		const appels = [];
		const ctx = {
			quizMode, isExamMode, hintsOff, textOnly,
			quizState: { locked },
			SLIDE_RESULTS_INDEX: 9,
			HINT_TITLE_ID: "t",
			__quizGlobalCleanups: [],
			getMissingIndices: () => missing,
			goToResults: () => appels.push("results"),
			goToSubmit: () => appels.push("submit"),
			goToSlide: (i) => appels.push("slide " + i),
			goToQuestion: (i) => appels.push("question " + i),
			escapeHtmlText: (s) => s, escapeHtmlAttr: (s) => s,
		};
		ctx.handIn = createHandInHandlers(ctx);
		return { ctx, appels };
	};

	r.check("a Practice and an Exam are Tests, a Learn is not",
		["quiz", "exam", "lesson"].map(quizMode => makeCtx({ quizMode }).ctx.handIn.isTest()), [true, true, false]);

	/* Past the last question: the → key, the Results tab and the last arrow. */
	const passe = (o) => { const x = makeCtx(o); x.ctx.handIn.pastLastQuestion(); x.ctx.handIn.closeConfirm(); return x.appels; };
	r.check("past the last question: a complete Test is handed in, never the submit slide",
		[passe({}), passe({ quizMode: "exam" })], [["results"], ["results"]]);
	r.check("past the last question: a Learn keeps its submit step", passe({ quizMode: "lesson", missing: [0] }), ["submit"]);
	r.check("past the last question: already handed in, the results slide", passe({ locked: true }), ["slide 9"]);
	r.check("the last arrow says \"Hand in the test\" in a Test not handed in, \"Results\" otherwise",
		[makeCtx().ctx.handIn.lastArrowLabel(), makeCtx({ quizMode: "exam" }).ctx.handIn.lastArrowLabel(),
			makeCtx({ locked: true }).ctx.handIn.lastArrowLabel(), makeCtx({ quizMode: "lesson" }).ctx.handIn.lastArrowLabel()],
		["engine.handIn.button", "engine.handIn.button", "engine.nav.results", "engine.nav.results"]);
	r.check("hints show in a plain test and a Learn, never in a legacy Exam (hints off with its clock)",
		[makeCtx().ctx.handIn.showsHints(), makeCtx({ quizMode: "lesson" }).ctx.handIn.showsHints(), makeCtx({ quizMode: "exam", isExamMode: true }).ctx.handIn.showsHints()],
		[true, true, false]);
	/* With a setup the hints follow the HINTS setting, not the clock: a timed
	   test that kept its hints shows them, an untimed one set up without hints
	   does not. */
	r.check("a setup with hints off hides the Hint button, timed or not; hints on shows it, timed or not",
		[makeCtx({ isExamMode: false, hintsOff: true }).ctx.handIn.showsHints(), makeCtx({ isExamMode: true, hintsOff: true }).ctx.handIn.showsHints(),
			makeCtx({ isExamMode: true, hintsOff: false }).ctx.handIn.showsHints(), makeCtx({ isExamMode: false, hintsOff: false }).ctx.handIn.showsHints()],
		[false, false, true, true]);

	const complet = makeCtx();
	complet.ctx.handIn.handIn();
	r.check("every question answered: straight to the correction, no confirmation",
		[complet.appels, complet.ctx.handIn.isConfirmOpen(), corps.length], [["results"], false, 0]);

	const incomplet = makeCtx({ missing: [1, 4] });
	incomplet.ctx.handIn.handIn();
	r.check("questions unanswered: a confirmation, nothing handed in yet",
		[incomplet.appels, incomplet.ctx.handIn.isConfirmOpen(), corps.length, cles.length], [[], true, 1, 1]);
	r.check("the confirmation names what is left", /2 questions unanswered/.test(corps[0]?.innerHTML ?? ""), true);
	r.check("closing it hands nothing in and leaves nothing behind",
		[incomplet.ctx.handIn.closeConfirm(), incomplet.appels, corps.length, cles.length, incomplet.ctx.handIn.closeConfirm()], [true, [], 0, 0, false]);

	const rendu = makeCtx({ locked: true, missing: [0] });
	rendu.ctx.handIn.handIn();
	r.check("already handed in: the results, no confirmation", [rendu.appels, rendu.ctx.handIn.isConfirmOpen()], [["slide 9"], false]);

	const detruit = makeCtx({ missing: [0] });
	detruit.ctx.handIn.handIn();
	detruit.ctx.__quizGlobalCleanups.forEach(f => f());
	r.check("destroying the quiz removes an open confirmation", [corps.length, cles.length], [0, 0]);
	delete globalThis.document;
	r.done();
});

/* THE HINT BADGE (spec 2026-09-29 §2.3): a dot whose question used its hint
   shows the bulb INSTEAD of its verdict mark — only when it has one (right,
   retried, wrong), in a Test and in a Learn; the verdict class stays, so the
   colour still follows the result. */
await withSrcModule("src/engine/cards.ts", ({ withHintBadge, createCardRenderers }) => {
	const r = makeReporter("Hint badge on the dots");
	/* Through the REAL tabClass (what updateNavHighlight writes on the dots):
	   a handed-in Test, Q1 right with its hint, Q2 wrong without. */
	const ctx = {
		quiz: [{}, {}], slideMap: [], numeroAffiche: (i) => i + 1,
		quizState: { current: 9, locked: true, hintSeen: [true, false] },
		isQuestionSlideIndex: () => false,
		learn: { verdictOf: () => "none", isCheckable: () => false, isGraded: () => true },
		textOnly: { isTextOnlyFor: () => false },
		hasAnyAnswer: () => true, isRevealed: () => true, isCorrect: (i) => i === 0,
	};
	const cards = createCardRenderers(ctx);
	r.check("tabClass: the bulb on the dot answered with a hint, the plain mark on the other",
		[cards.tabClass(0), cards.tabClass(1)], ["correct used-hint", "wrong"]);
	// Before the hand-in a Test's dots only say "answered": no verdict, no bulb.
	ctx.quizState.locked = false;
	ctx.isRevealed = () => false;
	r.check("tabClass before the hand-in: answered, no bulb", [cards.tabClass(0), cards.tabClass(1)], ["answered", "answered"]);
	r.check("a verdict dot whose hint was used gets the bulb, its verdict kept",
		["correct", "active retried", "wrong"].map(e => withHintBadge(e, true)),
		["correct used-hint", "active retried used-hint", "wrong used-hint"]);
	r.check("no hint used: the verdict mark stays", withHintBadge("correct", false), "correct");
	r.check("no verdict yet (answered, current, self-rated): no badge",
		["answered", "active", "", "understood", "partial"].map(e => withHintBadge(e, true)),
		["answered", "active", "", "understood", "partial"]);
	r.done();
});

/* THE EXAM'S CLOCK AND ITS END (spec 2026-09-29 §3.2, §3.3): m:ss, then
   h:mm:ss from an hour on; at zero the test is handed in with the answers
   given so far, an open "Hand in anyway?" confirmation closes, and a notice
   says time is up. */
await withSrcModule("src/engine/exam.ts", ({ formatExamClock, createExamHandlers }) => {
	const r = makeReporter("Exam — clock and time up");
	r.check("m:ss under an hour, rounded up: 0:00 only at zero",
		[formatExamClock(0), formatExamClock(1), formatExamClock(59_001), formatExamClock(61_000), formatExamClock(59 * 60_000 + 59_000)], ["0:00", "0:01", "1:00", "1:01", "59:59"]);
	r.check("h:mm:ss from an hour on (up to 300 minutes)",
		[formatExamClock(3_600_000), formatExamClock(3_599_000), formatExamClock(125 * 60_000), formatExamClock(300 * 60_000)], ["1:00:00", "59:59", "2:05:00", "5:00:00"]);
	r.check("never negative nor NaN", [formatExamClock(-5), formatExamClock(NaN)], ["0:00", "0:00"]);

	const appels = [];
	let confirmationOuverte = true;
	const ctx = {
		isExamMode: true, examStarted: true, examEnded: false, examTimeRemaining: 1200, examDurationMs: 60_000,
		quizState: { locked: false },
		isDestroyed: () => false,
		container: { querySelector: () => null, classList: { add() {} } },
		handIn: { closeConfirm: () => { const was = confirmationOuverte; confirmationOuverte = false; appels.push("close"); return was; } },
		goToResults: () => appels.push("results"),
		host: { ui: { notice: (m) => appels.push("notice") } },
	};
	createExamHandlers(ctx).handleExamTimeUp();
	r.check("at zero: the confirmation closes, then the test is handed in, then the notice",
		[appels, confirmationOuverte, ctx.quizState.locked, ctx.examEnded], [["close", "results", "notice"], false, true, true]);
	// Already handed in (by hand, or by an earlier tick): time up does nothing.
	appels.length = 0;
	createExamHandlers(ctx).handleExamTimeUp();
	r.check("already handed in: time up does nothing more", appels, []);
	r.done();
});

/* LAUNCHING A TEST WITH A SETUP (engine/test-launch.ts, spec
   2026-09-29-test-setup-modal-design.md §3). The rules `renderInteractiveQuiz`
   follows, held here because the engine itself needs a DOM: whether the host
   is asked, what it proposes, that a cancelled modal starts nothing, that a
   resumed snapshot skips the modal, and how the chosen setup lands on the
   engine's context. */
await withSrcModule("src/engine/test-launch.ts", async ({ usesTestSetup, askTestSetup, planLaunch, applyTestSetup }) => {
	const r = makeReporter("Launch — a Test's setup");
	const appels = [];
	const hote = (reponse) => ({ choose: async (defaults, count, examByDefault) => { appels.push({ defaults, count, examByDefault }); return reponse; } });
	const fichier = { examByDefault: false, durationMinutes: null, questionCount: 20 };

	r.check("only a Test with a host that offers a setup goes through it (not a Learn, not the plugin)",
		[usesTestSetup(hote(null), true), usesTestSetup(hote(null), false), usesTestSetup(undefined, true)], [true, false, false]);

	const choisi = { hints: false, timeLimitMinutes: 15 };
	const jouer = await planLaunch(hote(choisi), fichier, null);
	r.check("a plain file: the host is asked once, proposing hints on and no time limit, with the question count",
		[appels.length, appels[0].defaults, appels[0].count, appels[0].examByDefault], [1, { hints: true, timeLimitMinutes: null }, 20, false]);
	r.check("what the host answers is what is played, from the whole duration", jouer, { kind: "play", setup: choisi, msLeft: null, resumed: false });

	appels.length = 0;
	await planLaunch(hote(choisi), { examByDefault: true, durationMinutes: 45, questionCount: 20 }, null);
	r.check("a file with mode exam: proposes hints off and ITS duration, and says it is an exam file",
		[appels[0].defaults, appels[0].examByDefault], [{ hints: false, timeLimitMinutes: 45 }, true]);
	appels.length = 0;
	await planLaunch(hote(choisi), { examByDefault: true, durationMinutes: null, questionCount: 20 }, null);
	r.check("... without a duration, the fallback rule (1 min 30 per question, rounded to 5)", appels[0].defaults.timeLimitMinutes, 30);

	appels.length = 0;
	const annule = await planLaunch(hote(null), fichier, null);
	r.check("choose answering null starts nothing: cancelled, no setup to play, asked once", [annule, appels.length], [{ kind: "cancelled" }, 1]);

	appels.length = 0;
	const reprise = await planLaunch(hote(choisi), fichier, { setup: { hints: true, timeLimitMinutes: 30 }, msLeft: 600_000 });
	r.check("a resumed snapshot brings back its setup and time left and SKIPS the modal",
		[reprise, appels.length], [{ kind: "play", setup: { hints: true, timeLimitMinutes: 30 }, msLeft: 600_000, resumed: true }, 0]);

	/* "Try again" asks again, proposing what was just played (not the file's default). */
	appels.length = 0;
	await askTestSetup(hote(choisi), { examByDefault: true, durationMinutes: 45, questionCount: 20 }, { hints: true, timeLimitMinutes: null });
	r.check("Try again proposes the setup just played", appels[0].defaults, { hints: true, timeLimitMinutes: null });
	const proposition = { hints: true, timeLimitMinutes: null };
	await askTestSetup({ choose: async (d) => { d.hints = false; return null; } }, fichier, proposition);
	r.check("the modal cannot change the played setup by mutating its proposal", proposition, { hints: true, timeLimitMinutes: null });

	/* Landing on the engine's context. */
	const cible = () => ({ isExamMode: false, hintsOff: false, examDurationMs: 0, examTimeRemaining: 0, examStarted: false, examEnded: true, testSetup: null });
	const chrono = cible();
	applyTestSetup(chrono, { hints: false, timeLimitMinutes: 30 }, null);
	r.check("a time limit is the engine's Exam clock, whole, already started (no start screen), hints off",
		[chrono.isExamMode, chrono.examDurationMs, chrono.examTimeRemaining, chrono.examStarted, chrono.examEnded, chrono.hintsOff, chrono.testSetup],
		[true, 1_800_000, 1_800_000, true, false, true, { hints: false, timeLimitMinutes: 30 }]);
	const reprend = cible();
	applyTestSetup(reprend, { hints: true, timeLimitMinutes: 30 }, 90_000);
	r.check("a resumed test restarts from the time LEFT, keeping its hints",
		[reprend.examTimeRemaining, reprend.examDurationMs, reprend.hintsOff], [90_000, 1_800_000, false]);
	const trop = cible();
	applyTestSetup(trop, { hints: true, timeLimitMinutes: 1 }, 999_999);
	r.check("a time left above the duration is bounded by it", trop.examTimeRemaining, 60_000);
	const libre = cible();
	applyTestSetup(libre, { hints: false, timeLimitMinutes: null }, null);
	r.check("no time limit: no clock, nothing started, hints still follow the setting",
		[libre.isExamMode, libre.examDurationMs, libre.examStarted, libre.hintsOff], [false, 0, false, true]);
	r.done();
});

/* THE CLOCK OF A TIMED TEST (engine/exam.ts): no start screen once started,
   the countdown starts from the time LEFT (a paused test resumes, never from
   the full duration), `remainingMs` reads it live for the snapshot, and at
   zero the test is handed in. A fake interval and a fake `Date.now` drive it. */
await withSrcModule("src/engine/exam.ts", ({ createExamHandlers }) => {
	const r = makeReporter("Timed test — clock resumes from the time left");
	let maintenant = 1_000_000;
	const vraiDateNow = Date.now;
	let tick = null;
	globalThis.window = { setInterval: (f) => { tick = f; return 7; }, clearInterval: () => { tick = null; } };
	Date.now = () => maintenant;
	try {
		const appels = [];
		const ctx = {
			isExamMode: true, examStarted: true, examEnded: false, examTimeRemaining: 90_000, examDurationMs: 300_000,
			quizState: { locked: false },
			isDestroyed: () => false,
			container: { querySelector: () => null, classList: { add() {} } },
			handIn: { closeConfirm: () => false },
			goToResults: () => appels.push("results"),
			host: { ui: { notice: () => appels.push("notice") } },
		};
		const exam = createExamHandlers(ctx);
		const html = exam.examTimerHtml();
		r.check("started with a setup: the clock shows, never the start screen",
			[html.includes('data-exam-timer="1"'), html.includes("data-exam-start-screen"), html.includes("1:30")], [true, false, true]);

		exam.startExamTimer();
		r.check("the clock starts from the time left, not from the full duration", [ctx.examTimeRemaining, exam.remainingMs()], [90_000, 90_000]);
		maintenant += 30_000;
		tick();
		r.check("30 s later: 60 s left", ctx.examTimeRemaining, 60_000);
		maintenant += 15_000;
		r.check("remainingMs reads the clock live, between two ticks", exam.remainingMs(), 45_000);
		exam.stopExamTimer();
		maintenant += 60_000;
		r.check("stopped (the engine is destroyed): the time left is kept, the clock is paused while away",
			[ctx.examTimeRemaining, exam.remainingMs()], [45_000, 45_000]);

		exam.startExamTimer();
		r.check("resumed later: continues from those 45 s, not from zero nor the full duration", ctx.examTimeRemaining, 45_000);
		maintenant += 45_001;
		tick();
		r.check("at zero: handed in with the answers so far, clock stopped",
			[appels, ctx.examEnded, ctx.quizState.locked, ctx.examTimeRemaining, tick], [["results", "notice"], true, true, 0, null]);
	} finally {
		Date.now = vraiDateNow;
		delete globalThis.window;
	}
	r.done();
});
