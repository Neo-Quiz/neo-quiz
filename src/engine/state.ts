import type { EngineCtx } from "../types/engine-ctx";
import type { PracticeMode, QuizResult, StatsRecord } from "../types/quiz";
import type { ReviewGrade } from "../scheduler";
import { t } from "../i18n";

/** Sous-ensemble du store de stats (dashboard/stats-store) réellement lu ici. */
type StatsStoreLike = { updateRecord(path: string, update: StatsRecord): unknown };

export interface StateHandlers {
	hasAnyAnswer(i: number): boolean;
	isComplete(i: number): boolean;
	getMissingIndices(): number[];
	isCorrect(i: number): boolean;
	computeScorePercent(): QuizResult;
	getSubmitSlideSignature(): string;
	getResultsSlideSignature(): string;
	setPracticeMode(mode: PracticeMode): void;
	clearNavTabPressState(tab: HTMLElement | null): void;
	setNavTabPressState(tab: HTMLElement | null, on: boolean): void;
	clearAllNavTabPressStates(): void;
	buildNavTabClass(baseClass: string, tab: HTMLElement | null | undefined): string;
	playNavTabPressAndNavigate(tab: HTMLElement | null, navigateFn: () => void, opts?: { fromKeyboard?: boolean }): Promise<void>;
	setSlidingClass(on: boolean): void;
	goToSlide(index: number, opts?: { forceRender?: boolean }): Promise<void>;
	redirectSlide(next: number, opts?: { forceRender?: boolean }): Promise<void>;
	updateNavHighlight(): void;
	goToQuestion(index: number): void;
	goToSubmit(): void;
	goToResults(): void;
	resetQuiz(opts?: { preserveSliding?: boolean; resetToOriginalMode?: boolean }): void;
	recordReview(i: number, grade: ReviewGrade): void;
}

export function createStateHandlers(ctx: EngineCtx): StateHandlers {
	// Constantes
	const NAV_TAB_PRESS_MS = 130;
	const NAV_TAB_FALLBACK_CLEAR_MS = 320;

	function hasAnyAnswer(i: number): boolean {
		// isTextOnlyFor(i), pas isTextOnlyMode() : une question "recall" de Leçon
		// stocke sa réponse dans textOnlyAnswers/textOnlyRatings, jamais dans
		// `selections` — sans cette bascule PAR QUESTION, une tranche mélangeant
		// "test" et "recall" verrait ses questions de restitution comptées
		// "sans réponse" quel que soit ce que l'utilisateur a écrit et évalué.
		if (ctx.textOnly?.isTextOnlyFor?.(i)) {
			return ctx.textOnly.hasAnyAnswer(i) || ctx.textOnly.isChecked(i) || ctx.textOnly.isRated(i);
		}

		const q = ctx.quiz[i], sel = ctx.quizState.selections[i];

		if (ctx.isTextQuestion(q)) {
			return typeof sel === "string" && sel.trim().length > 0;
		}

		// Texte à trous : un seul trou rempli suffit à dire que l'élève a
		// commencé (à distinguer d'`isComplete`, qui les exige tous).
		if (ctx.isClozeQuestion(q)) {
			return Array.isArray(sel) && sel.some(v => String(v ?? "").trim().length > 0);
		}

		if (ctx.isOrderingQuestion(q) || ctx.isMatchingQuestion(q)) {
			return Array.isArray(sel) && sel.some(v => v !== null);
		}

		if (ctx.isCodeQuestion(q)) return typeof sel === "string" && sel.trim().length > 0;
		if (ctx.isFlashcardQuestion(q)) return false;
		if (q.multiSelect) return sel instanceof Set && sel.size > 0;
		return sel !== null;
	}

	/** Une carte SANS RÉPONSE : une lecture en Leçon (task 6b), ou une
	    lecture ABSORBÉE par son étape (2026-09-26), qui n'a même plus de
	    diapositive — quel que soit le mode courant, une bascule Leçon →
	    Examen comprise : elle n'y redevient pas une question inatteignable. */
	function sansReponse(i: number): boolean {
		return !!ctx.lecturesAbsorbees?.has(i) || (ctx.isLessonMode() && ctx.roleOfQuestion(i) === "read");
	}

	function isComplete(i: number): boolean {
		// Une carte "read" (task 6b) n'a rien à répondre : elle est toujours
		// considérée complète, pour ne jamais apparaître dans getMissingIndices
		// (donc ne bloquer ni la navigation, ni l'écran de soumission).
		if (sansReponse(i)) return true;

		// Même bascule PAR QUESTION que hasAnyAnswer ci-dessus. CORRECTIF
		// (2026-09-27, retour #14) : une réponse écrite (recall à choix, hors
		// carte mémoire) n'a plus de bouton Vérifier — l'auto-évaluation
		// attend l'écran des résultats (text-only.ts writtenReviewCardHtml).
		// L'exiger ICI (isRated) faisait apparaître Q8/Q16 comme « sans
		// réponse » dans l'écran de soumission alors qu'elles étaient
		// écrites : une réponse non vide suffit à les compter répondues,
		// exactement comme une TextQuestion ordinaire. Seule la carte mémoire
		// garde l'exigence de note (isRated) : elle se juge tout de suite en
		// se retournant, pas plus tard.
		if (ctx.textOnly?.isTextOnlyFor?.(i)) {
			return ctx.isFlashcardQuestion(ctx.quiz[i]) ? ctx.textOnly.isRated(i) : ctx.textOnly.hasAnyAnswer(i);
		}

		const q = ctx.quiz[i], sel = ctx.quizState.selections[i];

		if (ctx.isTextQuestion(q)) {
			return typeof sel === "string" && sel.trim().length > 0;
		}

		if (ctx.isClozeQuestion(q)) {
			return Array.isArray(sel) && sel.length > 0 && sel.every(v => String(v ?? "").trim().length > 0);
		}

		if (ctx.isOrderingQuestion(q) || ctx.isMatchingQuestion(q)) {
			return Array.isArray(sel) && sel.length > 0 && sel.every(v => v !== null);
		}

		if (ctx.isCodeQuestion(q)) return typeof sel === "string" && sel.trim().length > 0;
		if (ctx.isFlashcardQuestion(q)) return false;
		if (q.multiSelect) return sel instanceof Set && sel.size > 0;
		return sel !== null;
	}

	function getMissingIndices(): number[] {
		const missing: number[] = [];
		for (let i = 0; i < ctx.quiz.length; i++) if (!isComplete(i)) missing.push(i);
		return missing;
	}

	function isCorrect(i: number): boolean {
		// Même bascule PAR QUESTION : le score d'une tranche mixte doit compter
		// une "recall" auto-évaluée "compris" comme juste, indépendamment du
		// mode global (qui reste "qcm" en Leçon, cf. Task 5).
		if (ctx.textOnly?.isTextOnlyFor?.(i)) {
			return ctx.quizState.textOnlyRatings?.[i] === "understood";
		}

		const q = ctx.quiz[i], sel = ctx.quizState.selections[i];

		if (ctx.isTextQuestion(q)) {
			return ctx.terminal.isTextAnswerCorrect(q, sel);
		}

		// Tout ou rien : un texte à trous n'est juste que si TOUS ses trous
		// le sont — un barème partiel serait une autre décision, à prendre
		// explicitement plutôt qu'à hériter par défaut.
		if (ctx.isClozeQuestion(q)) {
			return ctx.cloze.isClozeCorrect(q, sel);
		}

		if (ctx.isOrderingQuestion(q)) {
			const co = ctx.getOrderingCorrectOrder(q);
			if (!Array.isArray(sel) || sel.length !== co.length) return false;
			return co.every((v, k) => sel[k] === v);
		}

		if (ctx.isMatchingQuestion(q)) {
			const rows = ctx.getMatchRows(q), cm = ctx.getMatchCorrectMap(q);
			if (!Array.isArray(sel) || sel.length !== rows.length || !Array.isArray(cm) || cm.length !== rows.length) return false;
			return cm.every((v, k) => sel[k] === v);
		}

		if (ctx.isCodeQuestion(q)) {
			return false; // Correction gérée par engine/code.ts
		}

		if (ctx.isFlashcardQuestion(q)) return false;
		if (q.multiSelect) {
			if (!(sel instanceof Set) || !Array.isArray(q.correctIndices) || sel.size !== q.correctIndices.length) return false;
			return q.correctIndices.every(ci => sel.has(ci));
		}

		return sel !== null && sel === q.correctIndex;
	}

	function computeScorePercent(): QuizResult {
		// Une carte "read" (task 6b) n'est ni juste ni fausse : elle sort du
		// dénominateur ET du numérateur, sinon elle abaisserait mécaniquement
		// le pourcentage final d'un quiz Leçon (une carte jamais "correcte").
		let correct = 0, total = 0, pendingWritten = 0;
		for (let i = 0; i < ctx.quiz.length; i++) {
			if (sansReponse(i)) continue;
			// CORRECTIF (2026-09-27, retour #17) : une réponse écrite pas encore
			// auto-évaluée (écran des résultats) n'est ni juste ni fausse — la
			// compter fausse pénaliserait un score qui n'a simplement pas encore
			// de verdict. Seul le non-flashcard est concerné : une carte
			// mémoire est toujours déjà notée à ce stade (on se juge en la
			// retournant), donc jamais "pending" ici.
			if (ctx.textOnly?.isTextOnlyFor?.(i) && !ctx.isFlashcardQuestion(ctx.quiz[i]) && !ctx.textOnly.isRated(i)) {
				pendingWritten++;
				continue;
			}
			total++;
			if (isCorrect(i)) correct++;
		}
		/* FIX round 1 de revue task 6b (2026-09-01), FINDING 4 : un quiz VRAIMENT
		   vide (`ctx.quiz.length === 0`, aucune carte du tout) valait `NaN` AVANT
		   cette tâche (0/0 * 100) — ce chemin n'a rien à voir avec "read" et ne
		   doit STRICTEMENT rien changer ("hors mode leçon, rien ne change").
		   Le `pct: 100` n'est un choix assumé que pour une tranche qui existe
		   mais est ENTIÈREMENT "read" (`ctx.quiz.length > 0`, `total === 0`) :
		   distinction nécessaire pour ne pas faire déborder le cas générique
		   sur un quiz ordinaire vide, qui n'a jamais eu de rôle "read". Un quiz
		   ENTIÈREMENT fait de réponses écrites pas encore évaluées (total === 0
		   ET pendingWritten > 0) tombe dans la même branche `pct: 100` — un
		   choix assumé, documenté ici : `pendingWritten` reste le signal que
		   l'écran de résultats doit afficher pour ne jamais laisser croire à un
		   sans-faute (voir cards.ts resultsSlideHtml, engine.result.pendingWritten). */
		const pct = total > 0 ? Math.round((correct / total) * 100) : (ctx.quiz.length > 0 ? 100 : Math.round((correct / total) * 100));
		return { pct, correct, total, pendingWritten };
	}

	const getSubmitSlideSignature = (): string => JSON.stringify({
		mode: ctx.quizState.practiceMode,
		examAnswerPhase: !!ctx.textOnly?.isExamAnswerPhase?.(),
		missingAnswers: ctx.textOnly?.isExamAnswerPhase?.()
			? ctx.quiz.map((_, i) => i).filter(i => !ctx.textOnly.hasAnyAnswer(i))
			: null,
		missing: getMissingIndices(),
		lastQuestionIndex: ctx.quizState.lastQuestionIndex
	});
	const getResultsSlideSignature = (): string => {
		if (ctx.textOnly?.isTextOnlyMode?.()) {
			return JSON.stringify({
				mode: ctx.quizState.practiceMode,
				results: ctx.textOnly.computeResults(),
				savedResultsPath: ctx.quizState.savedResultsPath || null
			});
		}
		const { pct, correct, total } = computeScorePercent();
		return JSON.stringify({ mode: ctx.quizState.practiceMode, locked: ctx.quizState.locked, pct, correct, total, savedResultsPath: ctx.quizState.savedResultsPath || null });
	};

	function clearNavTabPressState(tab: HTMLElement | null): void {
		if (!tab) return;
		if (tab.__quizPressClearTimer) {
			clearTimeout(tab.__quizPressClearTimer);
			tab.__quizPressClearTimer = 0;
		}
		delete tab.dataset.quizPressing;
		tab.classList.remove("is-pressing");
	}

	function setNavTabPressState(tab: HTMLElement | null, on: boolean): void {
		if (!tab) return;
		if (on) {
			if (tab.__quizPressClearTimer) {
				clearTimeout(tab.__quizPressClearTimer);
				tab.__quizPressClearTimer = 0;
			}
			tab.dataset.quizPressing = "1";
			tab.classList.add("is-pressing");
			tab.__quizPressClearTimer = window.setTimeout(() => clearNavTabPressState(tab), NAV_TAB_FALLBACK_CLEAR_MS);
			return;
		}
		clearNavTabPressState(tab);
	}

	const clearAllNavTabPressStates = (): void => {
		ctx.container.querySelectorAll<HTMLElement>(".quiz-tab").forEach(tab => clearNavTabPressState(tab));
	};
	const buildNavTabClass = (baseClass: string, tab: HTMLElement | null | undefined): string => `${baseClass}${tab?.dataset?.quizPressing === "1" ? " is-pressing" : ""}`.trim();

	async function playNavTabPressAndNavigate(tab: HTMLElement | null, navigateFn: () => void, { fromKeyboard = false }: { fromKeyboard?: boolean } = {}): Promise<void> {
		if (!tab || typeof navigateFn !== "function") return;

		if (fromKeyboard || tab.dataset.quizPressing !== "1") {
			clearAllNavTabPressStates();
			setNavTabPressState(tab, true);
		}

		navigateFn();

		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				clearNavTabPressState(tab);
			});
		});
	}

	/**
	 * Task 7, mode Lesson : la tentative sur une pré-question ("pre") est le
	 * mécanisme qui produit l'effet (Richland 2009) — pas la simple lecture de
	 * la question. `firstUnattemptedPreBetween` repère, sur la navigation VERS
	 * L'AVANT, une pré-question qui n'a reçu ni réponse (`hasAnyAnswer`) ni un
	 * clic sur « Je ne sais pas » (`lessonPreSkipped`) ; elle BLOQUAIT la
	 * navigation, elle la marque aujourd'hui « Je ne sais pas » (voir
	 * `marquerPreNonTentees`). Le retour en arrière n'est jamais concerné.
	 *
	 * Posé ici plutôt que dans chaque bouton/flèche/onglet : `goToSlide` et
	 * `redirectSlide` sont le SEUL point de passage commun à tous les chemins
	 * de navigation du moteur (bouton suivant, flèches clavier, onglets de
	 * question, `goToQuestion`/`goToSubmit`/`goToResults`, et l'avance
	 * automatique après une réponse texte dans engine/terminal.ts) — un garde
	 * dupliqué à chaque appelant aurait laissé passer le premier chemin oublié.
	 */
	/**
	 * Round 1 de revue (Finding 3) : une garde qui n'examine que la slide
	 * COURANTE se contourne par un saut direct (onglet de question, data-jump
	 * du récapitulatif) par-dessus une "pre" restée plus loin — depuis la
	 * question 1, cliquer l'onglet Q5 sautait une "pre" en Q3 sans jamais
	 * l'afficher. Choix retenu : la garde SCANNE toute la plage franchie
	 * (de la question courante à la question cible, exclusive) plutôt que de
	 * limiter la navigation par onglets à la première "pre" — ce choix couvre
	 * TOUS les appelants (onglets, flèches, soumission, résultats) depuis ce
	 * seul point, sans exiger un traitement séparé du clic sur un onglet.
	 */
	function firstUnattemptedPreBetween(targetIndex: number): number | null {
		if (!ctx.isLessonMode()) return null;
		// Round 1 de revue (Finding 2) : un quiz VERROUILLÉ est en consultation,
		// il n'y a plus rien à forcer — et le bouton « Je ne sais pas » disparaît
		// déjà dans cet état (cards.ts). Sans cette sortie, une revue après
		// soumission ne laissait plus que la marche arrière sur une "pre" restée
		// sans tentative.
		if (ctx.quizState.locked) return null;
		if (targetIndex <= ctx.quizState.current) return null;
		if (!ctx.isQuestionSlideIndex(ctx.quizState.current)) return null;
		const fromQi = (ctx.slideMap[ctx.quizState.current] as { questionIndex: number }).questionIndex;
		// Borne exclusive : la question du slide cible si c'est une question
		// (elle a le droit d'être une "pre" qu'on arrive tout juste à tenter),
		// sinon la fin du quiz (soumission/résultats doivent avoir franchi
		// TOUTES les questions, "pre" comprises).
		const toQiExclusive = ctx.isQuestionSlideIndex(targetIndex)
			? (ctx.slideMap[targetIndex] as { questionIndex: number }).questionIndex
			: ctx.quiz.length;
		for (let qi = fromQi; qi < toQiExclusive; qi++) {
			if (ctx.roleOfQuestion(qi) === "pre" && !ctx.hasAnyAnswer(qi) && !ctx.quizState.lessonPreSkipped[qi]) return qi;
		}
		return null;
	}

	/**
	 * PLUS DE BLOCAGE (2026-09-25, demande d'Ahmed : « ça met je ne sais pas
	 * automatiquement, c'est plus simple et moins de friction »). Une "pre"
	 * franchie sans réponse reçoit le même verdict qu'un clic sur « Je ne sais
	 * pas » (`lessonPreSkipped`, journalisée `skipped`) au lieu d'arrêter la
	 * navigation sur une Notice. La tentative reste proposée — la question est
	 * affichée, le bouton aussi — mais n'est plus imposée. Même point de
	 * passage unique qu'avant : tous les chemins de navigation y passent.
	 */
	function marquerPreNonTentees(targetIndex: number): void {
		for (let qi = firstUnattemptedPreBetween(targetIndex); qi !== null; qi = firstUnattemptedPreBetween(targetIndex)) {
			ctx.quizState.lessonPreSkipped[qi] = true;
			ctx.commitQuestionInteraction(qi, { syncHeight: false });
		}
	}

	async function goToSlide(index: number, { forceRender = false }: { forceRender?: boolean } = {}): Promise<void> {
		ctx.closeHintModal();
		const next = ctx.clampSlideIndex(index);
		marquerPreNonTentees(next);
		if (next === ctx.quizState.current && !ctx.quizState.isSliding) return;
		if (ctx.quizState.isSliding) return ctx.redirectSlide(next, { forceRender });
		++ctx.quizState.slideToken;
		const token = ctx.quizState.slideToken;
		ctx.quizState.prevCurrent = ctx.quizState.current;
		ctx.quizState.current = next;
		ctx.saveSession();
		// isQuestionSlideIndex garantit la variante « question » de slideMap[next].
		if (ctx.isQuestionSlideIndex(next)) ctx.quizState.lastQuestionIndex = (ctx.slideMap[next] as { questionIndex: number }).questionIndex;
		updateNavHighlight();
		ctx.quizState.isSliding = true;
		ctx.setSlidingClass(true);
		if (forceRender) ctx.render();
		await Promise.allSettled([
			ctx.warmSlideForAccurateHeight(ctx.quizState.prevCurrent),
			ctx.warmSlideForAccurateHeight(ctx.quizState.current)
		]);
		if (token !== ctx.quizState.slideToken) return;
		ctx.track.animateTrackToIndex(ctx.quizState.current, {
			fromX: ctx.track.getSlideTranslateX(ctx.quizState.prevCurrent),
			fromHeight: Math.max(
				ctx.viewport.getSlideStableHeight(ctx.quizState.prevCurrent, { refresh: true }) || 0,
				Math.ceil(ctx.viewport.getTrackElements().viewport?.getBoundingClientRect?.().height || 0),
				Math.ceil(ctx.viewport.getTrackElements().viewport?.clientHeight || 0)
			),
			refreshTargetHeight: true
		});
	}

	async function redirectSlide(next: number, { forceRender = false }: { forceRender?: boolean } = {}): Promise<void> {
		const targetIndex = ctx.clampSlideIndex(next);
		marquerPreNonTentees(targetIndex);
		if (targetIndex === ctx.quizState.current) return;
		const snapshot = ctx.track.cancelRunningTrackAnimation();
		++ctx.quizState.slideToken;
		const token = ctx.quizState.slideToken;
		ctx.quizState.prevCurrent = ctx.quizState.current;
		ctx.quizState.current = targetIndex;
		ctx.saveSession();
		if (ctx.isQuestionSlideIndex(targetIndex)) ctx.quizState.lastQuestionIndex = (ctx.slideMap[targetIndex] as { questionIndex: number }).questionIndex;
		updateNavHighlight();
		ctx.quizState.isSliding = true;
		ctx.setSlidingClass(true);
		if (forceRender) ctx.render();
		await ctx.warmSlideForAccurateHeight(ctx.quizState.current).catch(() => {});
		if (token !== ctx.quizState.slideToken) return;
		ctx.track.animateTrackToIndex(ctx.quizState.current, { fromX: snapshot.x, fromHeight: snapshot.height, refreshTargetHeight: true });
	}

	function setSlidingClass(on: boolean): void {
		ctx.container?.classList?.toggle("quiz-is-sliding", !!on);
	}

	function updateNavHighlight(): void {
		ctx.container.querySelectorAll<HTMLElement>("[data-nav]").forEach(tab => {
			const i = Number(tab.dataset.nav);
			tab.className = buildNavTabClass(`quiz-tab ${ctx.cards.tabClass(i)}`.trim(), tab);
		});
		const resultsTab = ctx.container.querySelector<HTMLElement>("[data-nav-results]");
		if (resultsTab) {
			const active = (ctx.isSubmitSlideIndex(ctx.quizState.current) || ctx.isResultsSlideIndex(ctx.quizState.current)) ? "active" : "";
			resultsTab.className = buildNavTabClass(`quiz-tab is-result ${active}`.trim(), resultsTab);
		}
	}

	function setPracticeMode(mode: PracticeMode): void {
		const nextMode: PracticeMode = mode === "text" ? "text" : "qcm";
		if (ctx.quizState.practiceMode === nextMode) return;

		ctx.closeHintModal();
		ctx.quizState.practiceMode = nextMode;
		ctx.quizState.pendingResultsLock = false;
		// Recommencer, c'est une NOUVELLE session : elle a le droit d'être
		// comptée à son tour.
		ctx.quizState.resultsCounted = false;
		ctx.quizState.savedResultsPath = null;
		if (nextMode === "text") ctx.stopExamTimer?.();

		if (ctx.isSubmitSlideIndex(ctx.quizState.current) || ctx.isResultsSlideIndex(ctx.quizState.current)) {
			const fallbackQi = Math.max(0, Math.min(ctx.quizState.lastQuestionIndex || 0, ctx.quiz.length - 1));
			const slideIdx = ctx.getSlideIndexForQuestion(fallbackQi);
			ctx.quizState.current = slideIdx >= 0 ? slideIdx : 0;
			ctx.quizState.prevCurrent = ctx.quizState.current;
		}

		ctx.quizState.slideToken++;
		ctx.quizState.isSliding = false;
		ctx.container?.classList?.toggle("quiz-is-locked", ctx.quizState.locked && nextMode !== "text");
		ctx.render();
	}

	const goToQuestion = (index: number): void => {
		ctx.quizState.pendingResultsLock = false;
		const slideIdx = ctx.getSlideIndexForQuestion(index);
		if (slideIdx >= 0) goToSlide(slideIdx, { forceRender: false });
	};

	function goToSubmit(): void {
		// Round 1 de revue (Finding 1) : le marquage doit intervenir AVANT tout
		// effet de bord, pas seulement au `goToSlide` final - sinon
		// `lastQuestionIndex`/`pendingResultsLock` étaient déjà mutés alors que
		// la navigation elle-même était refusée.
		marquerPreNonTentees(ctx.SLIDE_SUBMIT_INDEX);
		/* PAS d'effacement de la session ici : l'écran de soumission n'est pas
		   la fin du quiz (« Il manque N réponses », avec « Retour ») ; y passer
		   par l'onglet Résultats puis fermer l'application perdait la reprise.
		   Elle ne s'efface qu'au score (`goToResults`). */
		if (ctx.isQuestionSlideIndex(ctx.quizState.current)) ctx.quizState.lastQuestionIndex = (ctx.slideMap[ctx.quizState.current] as { questionIndex: number }).questionIndex;
		ctx.quizState.pendingResultsLock = false;
		goToSlide(ctx.SLIDE_SUBMIT_INDEX, { forceRender: false });
	}

	/**
	 * Journalise UNE question pour l'ordonnanceur, une seule fois par
	 * session. `sourcePath` absent (aperçu de l'éditeur, quiz en mémoire non
	 * encore enregistré) : rien à journaliser, la question n'a pas de clé
	 * stable.
	 *
	 * Le rôle est celui DÉCLARÉ par la question, dès que le bloc est
	 * D'ORIGINE Leçon (`ctx.originalQuizMode`, jamais réassigné après
	 * l'assemblage) — PAS le mode courant (`ctx.isLessonMode()`). Fix round 1
	 * (2026-09-02) : `switchToExamMode` bascule une Leçon en Examen
	 * (`ctx.quizMode = "exam"`) sans jamais toucher `originalQuizMode` ; une
	 * question `role: "pre"` répondue APRÈS cette bascule perdait son rôle
	 * (`isLessonMode()` valait alors faux), et `signalOf` (scheduler/state.ts)
	 * comptait cette réponse comme un succès ou un échec — ce qu'il interdit
	 * explicitement pour une "pre" (Richland/Kornell/Kao : la tentative est
	 * le mécanisme, pas la justesse). `roleOfQuestion` lit le champ déclaré
	 * de la question, indépendamment du mode courant (engine/lesson.ts
	 * `buildLessonModel.roleOf`) : seul le GATE qui décide de le lire dépend
	 * ici du mode D'ORIGINE, jamais du mode courant.
	 *
	 * Élargissement délibéré (round de revue suivant, 2026-09-03) : le gate
	 * teste `originalQuizMode === "lesson"`, PAS `isLessonMode()` — un bloc
	 * `mode: 'lesson'` SANS tranche valide (`buildLessonModel.isLesson` faux,
	 * engine/lesson.ts) obtient donc désormais un rôle dans le journal alors
	 * qu'avant il n'en recevait aucun. C'est correct : `originalQuizMode ===
	 * "lesson"` signifie que l'auteur a écrit une Leçon, et une question qui
	 * y déclare `role: "pre"` reste une pré-question qui ne doit produire
	 * aucun signal de mémoire, tranches valides ou pas. Les autres questions
	 * reçoivent le rôle par défaut `"test"` (engine/lesson.ts `roleOf`), que
	 * `signalOf` traite normalement — rien ne change pour elles.
	 */
	function recordReview(i: number, grade: ReviewGrade): void {
		if (!ctx.reviewSink || !ctx.sourcePath) return;
		if (ctx.quizState.recorded[i]) return;
		const id = ctx.questionIds[i];
		if (!id) return;
		const role = ctx.originalQuizMode === "lesson" ? ctx.roleOfQuestion(i) : undefined;
		try {
			// Le puits est une FORME destinée à d'autres hôtes (types/engine-ctx.ts) :
			// un tiers qui lève ne doit jamais casser le rendu — ni cette boucle,
			// ni (dans goToResults) la navigation vers la slide résultats qui la suit.
			ctx.reviewSink.record([{ q: ctx.reviewSink.keyOf(ctx.sourcePath, id), grade, ...(role ? { role } : {}) }]);
			// Marqué APRÈS l'appel, jamais avant : un puits qui lève ne doit pas
			// consommer la question pour la session — même précédent que le cas
			// id vide juste au-dessus, qui laisse aussi le drapeau à faux pour
			// permettre une nouvelle tentative.
			ctx.quizState.recorded[i] = true;
		} catch (e) {
			console.error("[quiz-blocks] puits de révision : enregistrement refusé", e);
		}
	}

	function goToResults(): void {
		/* Round 1 de revue (Finding 1 — CRITIQUE) : `goToResults` écrivait ses
		   effets de bord (resultsCounted, statsStore.updateRecord, examEnded,
		   pendingResultsLock) AVANT le `goToSlide` final, que la garde peut
		   refuser — un clic sur l'onglet Résultats depuis une "pre" non tentée
		   enregistrait alors une tentative ET un score au tableau de bord SANS
		   naviguer, et le comptage légitime ultérieur était perdu
		   (`resultsCounted` déjà vrai). Le marquage des "pre" franchies se fait donc ICI, avant
		   toute mutation — `isBlockedBySkippedPreQuestion` lit `ctx.quizState.locked`
		   (Finding 2) : un examen qui vient de se verrouiller lui-même
		   (`handleExamTimeUp`, engine/exam.ts) n'a donc plus rien de bloqué à ce
		   stade et atteint bien ses résultats. */
		marquerPreNonTentees(ctx.SLIDE_RESULTS_INDEX);
		ctx.clearSession();
		if (ctx.isQuestionSlideIndex(ctx.quizState.current)) ctx.quizState.lastQuestionIndex = (ctx.slideMap[ctx.quizState.current] as { questionIndex: number }).questionIndex;
		ctx.quizState.pendingResultsLock = !ctx.textOnly?.isTextOnlyMode?.();

		if (ctx.isExamMode && ctx.examStarted && !ctx.examEnded) {
			ctx.examEnded = true;
			ctx.stopExamTimer();
			ctx.updateExamTimerDisplay();
		}

		/* Stats du dashboard. Le mode TEXTE compte lui aussi : travailler tous
		   les jours en mode leçon ne mettait a jour ni progression, ni derniere
		   activite, ni nombre de tentatives — le dashboard restait muet sur
		   l'essentiel du travail (revue codex 2026-07-31).
		   Son score, lui, n'est pas enregistre : en mode texte, la correction
		   est une AUTO-EVALUATION, et la ranger a cote des scores d'un QCM les
		   rendrait incomparables. `updateRecord` prend le maximum, donc un 0 ne
		   peut pas abaisser un score existant.
		   FINDING 1 (round 1 de revue Task 5, 2026-08-31) : `isTextOnlyMode()`
		   seule valait FAUX en mode Lecon (practiceMode y reste "qcm"), y compris
		   quand une ou plusieurs questions "recall" du mix sont jugees par
		   auto-evaluation — `isCorrect(i)` (plus haut dans ce fichier) y compte
		   deja ces auto-evaluations comme des reponses justes. Sans correction,
		   une session de Lecon aurait ecrit un `bestScore` reel qui melangeait
		   scoring QCM et auto-evaluation, exactement ce que le paragraphe
		   ci-dessus interdit. `isTextOnlyForAny()` (engine/text-only.ts) est
		   VRAIE des qu'UNE SEULE question du quiz est actuellement auto-evaluee,
		   pas seulement quand elles le sont toutes.
		   `resultsCounted` : `goToResults` n'etait pas protege contre un double
		   clic, et « Voir le score » comptait alors deux tentatives pour une
		   seule session. */
		/* Un seul garde `resultsCounted` pour les DEUX effets de bord (stats du
		   tableau de bord, journal de l'ordonnanceur) — conforme au brief
		   (« à l'intérieur de la même garde resultsCounted »), mais les deux
		   blocs sont sinon INDÉPENDANTS (fix round 1, 2026-09-02) : le journal
		   ne dépend plus de la présence d'un `_statsStore`, un store sans
		   rapport avec lui. `_statsStore` reste requis pour le SIEN, comme
		   avant ; `recordReview` a ses propres gardes (`reviewSink`,
		   `sourcePath`, id) et no-op proprement quand l'un manque. */
		if (!ctx.quizState.resultsCounted) {
			ctx.quizState.resultsCounted = true;

			const statsStore = ctx.statsSink;
			if (statsStore && ctx.sourcePath) {
				const modeTexte = !!ctx.textOnly?.isTextOnlyForAny?.();
				const { pct, total, pendingWritten } = computeScorePercent();
				/* FIX round 1 de revue task 6b (2026-09-01) : `questionsDone` comptait
				   TOUTES les cartes (0..ctx.quiz.length), alors que `total` ci-dessus
				   EXCLUT deja les cartes "read" (elles n'ont pas de reponse) —
				   une tranche read+test produisait "2/1", une progression au-dessus
				   de 100% au tableau de bord. Les deux compteurs doivent porter sur
				   le MEME ensemble : on saute une carte "read" ici aussi, exactement
				   comme `computeScorePercent` le fait pour `total`.
				   CORRECTIF (2026-09-27, revue lot A1, I1) : « répondue »
				   (isComplete, retour #14) et « jugée » sont deux notions
				   distinctes depuis que le bouton Vérifier a disparu — une réponse
				   écrite (recall à choix, hors carte mémoire) est complète dès
				   qu'elle contient du texte, mais reste SANS verdict tant que
				   l'utilisateur n'a pas cliqué juste/faux sur les résultats. La
				   compter ici gonflait `questionsDone` jusqu'à égaler
				   `totalQuestions` (barre de progression à 100 %) pour un quiz
				   entièrement écrit et jamais auto-évalué. On l'exclut donc du
				   même geste que `pendingWritten` de `computeScorePercent`, et
				   `totalQuestions` suit : `total` exclut déjà ces questions-là,
				   `pendingWritten` les rajoute au dénominateur (sans jamais les
				   compter faites) pour qu'elles restent visibles dans la
				   progression plutôt que de disparaître du compte — seul un quiz
				   SANS aucune question notable (uniquement des cartes "read")
				   retombe sur `ctx.quiz.length`, exactement comme avant. */
				let questionsDone = 0;
				for (let i = 0; i < ctx.quiz.length; i++) {
					if (sansReponse(i)) continue;
					if (ctx.textOnly?.isTextOnlyFor?.(i) && !ctx.isFlashcardQuestion(ctx.quiz[i]) && !ctx.textOnly.isRated(i)) continue;
					if (isComplete(i)) questionsDone++;
				}
				statsStore.updateRecord(ctx.sourcePath, {
					bestScore: modeTexte ? 0 : pct,
					questionsDone,
					totalQuestions: (total + pendingWritten) || ctx.quiz.length,
					texteLibre: modeTexte
				});
			}

			/* L'ordonnanceur, lui, compte PAR QUESTION. Une carte "read" n'est
			   ni juste ni fausse (`seen`), une pré-question abandonnée non plus
			   (`skipped`) : ces deux-là sont journalisées pour que l'historique
			   soit complet, mais elles ne produisent aucun signal de mémoire
			   (scheduler/state.ts signalOf).
			   Le RÔLE journalisé est celui déclaré par la question dès que le
			   bloc est D'ORIGINE Leçon (`originalQuizMode`), même après une
			   bascule Leçon → Examen — voir le commentaire de `recordReview`.
			   Le mode COURANT (`isLessonMode()`), lui, ne sert plus qu'à décider
			   si "read" doit court-circuiter le verdict : une carte "read"
			   redevient une question normale une fois basculée en Examen
			   (`isComplete` la traite alors comme les autres), donc grade
			   "seen" ne doit s'appliquer QUE tant que le mode Leçon est
			   réellement actif — sinon une carte "read" activement répondue en
			   Examen recevrait "seen" au lieu de son verdict réel. */
			for (let i = 0; i < ctx.quiz.length; i++) {
				if (ctx.quizState.recorded[i]) continue;
				const role = ctx.originalQuizMode === "lesson" ? ctx.roleOfQuestion(i) : undefined;
				/* Une lecture SANS ÉCRAN (lecture courte, lue au-dessus de sa
				   question hôte, src/lecture-etape.ts) reste une lecture pour le
				   journal : `seen` en Leçon, sans signal de mémoire. Après une
				   bascule Leçon → Examen, elle n'a été ni montrée ni répondue :
				   rien n'est écrit. Condition bien ATTEIGNABLE : l'ensemble est
				   figé sur le mode D'ORIGINE (engine.ts), `isLessonMode()` lit le
				   mode COURANT — `check:engine-review` éprouve ce cas. */
				if (ctx.lecturesAbsorbees?.has(i) && !ctx.isLessonMode()) continue;
				/* CORRECTIF (2026-09-27, revue lot A1, C1) : une réponse écrite
				   (recall à choix, hors carte mémoire) est « répondue » dès
				   qu'elle contient du texte (isComplete, retour #14) mais pas
				   encore « jugée » — son verdict juste/faux n'existe qu'après un
				   clic sur l'écran des résultats (text-only.ts
				   bindWrittenReviewControls). Sans cette distinction,
				   `isCorrect(i)` valait systématiquement faux ici (pas encore
				   notée) et journalisait "wrong" AVANT le clic ; `recordReview`
				   posait alors `recorded[i] = true`, et le vrai verdict de
				   l'utilisateur, journalisé ensuite par le clic, était rejeté par
				   la garde anti-doublon — deux entrées contradictoires n'auraient
				   jamais dû compter, mais c'est la FAUSSE qui gagnait la course.
				   On saute ces questions-là ICI (rien n'est écrit, `recorded[i]`
				   reste faux) : bindWrittenReviewControls reste le SEUL point qui
				   les journalise, avec le vrai verdict, quel que soit le moment où
				   l'utilisateur clique. Si l'utilisateur quitte les résultats sans
				   évaluer, rien n'est donc écrit pour cette question cette
				   session-ci — cohérent avec `!isComplete` juste en dessous, qui
				   ne journalise pas non plus une question jamais atteinte. */
				if (ctx.textOnly?.isTextOnlyFor?.(i) && !ctx.isFlashcardQuestion(ctx.quiz[i]) && !ctx.textOnly.isRated(i)) continue;
				let grade: ReviewGrade;
				if (ctx.isLessonMode() && role === "read") grade = "seen";
				else if (ctx.quizState.lessonPreSkipped[i]) grade = "skipped";
				else if (!isComplete(i)) continue; // sans réponse : rien ne s'est passé
				else grade = isCorrect(i) ? "correct" : "wrong";
				recordReview(i, grade);
			}
		}

		updateNavHighlight();
		goToSlide(ctx.SLIDE_RESULTS_INDEX, { forceRender: false });
	}

	function resetQuiz({ preserveSliding = false, resetToOriginalMode = false }: { preserveSliding?: boolean; resetToOriginalMode?: boolean } = {}): void {
		ctx.closeHintModal();
		ctx.track.clearTrackTransitionFallback();
		ctx.viewport.destroyActiveSlideResizeObserver();
		ctx.viewport.destroyAllSlidesResizeObserver();
		ctx.viewport.destroyViewportResizeObserver();
		ctx.clearBackgroundWarmIdleHandle();
		ctx.cancelEnsureTrackVisibleRaf();

		ctx.__quizBackgroundWarmStarted = false;

		ctx.quizState.selections = ctx.initSelections();
		ctx.quizState.textOnlyAnswers = ctx.initTextOnlyAnswers();
		ctx.quizState.textOnlyChecked = ctx.initTextOnlyChecked();
		ctx.quizState.textOnlyRatings = ctx.initTextOnlyRatings();
		ctx.quizState.current = 0;
		ctx.quizState.prevCurrent = 0;
		ctx.quizState.lastQuestionIndex = 0;
		ctx.quizState.locked = false;
		ctx.container?.classList?.remove("quiz-is-locked");
		ctx.quizState.pendingResultsLock = false;
		ctx.quizState.savedResultsPath = null;
		ctx.quizState.shuffleMap = ctx.buildShuffleMap();
		ctx.quizState.orderingPick = ctx.initOrderingPicks();
		ctx.quizState.matchPick = ctx.initMatchPicks();
		// Recommencer, c'est une NOUVELLE tentative : une pré-question déjà
		// passée en « Je ne sais pas » redevient bloquante (Task 7).
		ctx.quizState.lessonPreSkipped = ctx.quiz.map(() => false);
		ctx.quizState.hintSeen = ctx.quiz.map(() => false);
		// Recommencer, c'est une NOUVELLE session pour l'ordonnanceur aussi :
		// sans cette remise à zéro, une question déjà journalisée à la tentative
		// précédente ne serait plus jamais recomptée (Task 8).
		ctx.quizState.recorded = ctx.quiz.map(() => false);
		ctx.quizState.slideToken++;

		if (!preserveSliding) ctx.quizState.isSliding = false;
		ctx.setSlidingClass(false);

		ctx.__quizSlideHeightCache?.clear();
		ctx.__quizWarmSlidePromises?.clear();
		// Repli/repli-par-défaut du support de compréhension (Task 4, mode Leçon) :
		// à côté des autres .clear() de session, pour qu'un futur ajout d'état de
		// session pense à en faire autant — round 1 de revue, sans ça un
		// « recommencer » retrouvait un support déjà semé de la session précédente.
		ctx.passage.resetPassageState();

		ctx.examStarted = false;
		ctx.examEnded = false;
		ctx.examStartTime = 0;
		ctx.stopExamTimer();

		// Réinitialiser au mode d'origine si demandé
		if (resetToOriginalMode && ctx.originalQuizMode === "lesson") {
			ctx.trainingSession = false;
			ctx.quizMode = "lesson";
			ctx.isExamMode = false;
			ctx.examOptions = null;
			ctx.examDurationMs = 0;
			ctx.lessonExamOptions = ctx.originalLessonExamOptions;
			ctx.examTimeRemaining = 0;
		} else {
			ctx.examTimeRemaining = ctx.isExamMode ? ctx.examDurationMs : 0;
		}

		ctx.render();
		ctx.clearSession();
	}

	return {
		hasAnyAnswer,
		isComplete,
		getMissingIndices,
		isCorrect,
		computeScorePercent,
		getSubmitSlideSignature,
		getResultsSlideSignature,
		setPracticeMode,
		clearNavTabPressState,
		setNavTabPressState,
		clearAllNavTabPressStates,
		buildNavTabClass,
		playNavTabPressAndNavigate,
		setSlidingClass,
		goToSlide,
		redirectSlide,
		updateNavHighlight,
		goToQuestion,
		goToSubmit,
		goToResults,
		resetQuiz,
		recordReview
	};
}
