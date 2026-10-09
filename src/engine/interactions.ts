import type { EngineCtx } from "../types/engine-ctx";
import type { OrderingQuestion, MatchingQuestion } from "../types/quiz";
import { t } from "../i18n";
import { stepMembers } from "./step-page";
import { bindSwipe, hapticTick, prefersReducedMotion, settleDuration, SETTLE_EASING } from "../swipe";
import { openConfirmModal } from "../editor/modals";

/** Charge utile du drag-and-drop (ordering/matching), sérialisée en JSON dans le dataTransfer. */
interface DragPayload {
	mode?: string;
	oi?: unknown;
	ci?: unknown;
	sourceSlot?: unknown;
}

export interface InteractionHandlers {
	bindBinaryQuestion(trackItem: HTMLElement, qi: number, isMulti: boolean): void;
	bindOrderingQuestion(trackItem: HTMLElement, qi: number, q: OrderingQuestion): void;
	bindMatchingQuestion(trackItem: HTMLElement, qi: number, q: MatchingQuestion): void;
	bindQuestionTrackItem(trackItem: HTMLElement | null): void;
	/** Task 7 (mode Lesson) : extrait du binding DOM (round 1 de revue, Finding 5)
	 * pour rester testable sans document (scripts/check-lesson.mjs). */
	markLessonPreSkipped(qi: number): void;
	bindSubmitSlideControls(rootEl: Element | null): void;
	bindResultsSlideControls(rootEl: Element | null): void;
	bindStaticControls(): void;
	bindZoomFixHandlers(): void;
	destroyZoomFixHandlers(): void;
	/** The next arrow of question `qi` (button, bar, → key, Enter in a field). */
	advanceFrom(qi: number): void;
}

export function createInteractionHandlers(ctx: EngineCtx): InteractionHandlers {
	// Variables locales
	let __quizZoomFixBound = false;
	let __quizZoomFixRaf = 0;
	let __quizZoomFixSettleTimer = 0;
	let __quizZoomLastDpr = window.devicePixelRatio || 1;
	let __quizZoomFixHandler: (() => void) | null = null;

	function commitQuestionInteraction(qi: number, { syncHeight = true }: { syncHeight?: boolean } = {}): void {
		ctx.invalidateSavedResults?.();
		const slideIdx = ctx.getSlideIndexForQuestion(qi);
		if (slideIdx >= 0) ctx.__quizSlideHeightCache?.delete(slideIdx);
		ctx.refreshQuestionSlide(qi, { syncHeight });
		ctx.refreshMetaSlides();
	}

	/**
	 * Task 7 (mode Lesson) : « Je ne sais pas » verrouille la pré-question avec
	 * une tentative VIDE mais EXPLICITE (lessonPreSkipped), comme une validation
	 * ordinaire verrouillerait une réponse — re-rendu via commitQuestionInteraction
	 * (le bouton disparaît, cards.ts) puis avance. Round 1 de revue (Finding 4) :
	 * le re-rendu a lieu MÊME sur la dernière question, où il n'y a nulle part où
	 * avancer — la disparition du bouton reste le seul effet visible attendu.
	 * Extraite de bindQuestionTrackItem (Finding 5) : aucune dépendance au DOM,
	 * donc testable directement par scripts/check-lesson.mjs.
	 */
	function markLessonPreSkipped(qi: number): void {
		// invalidateSavedResults est deja appele par commitQuestionInteraction -
		// pas de doublon ici, meme convention que bindBinaryQuestion/trySelect.
		ctx.quizState.lessonPreSkipped[qi] = true;
		commitQuestionInteraction(qi, { syncHeight: true });
		// La diapositive SUIVANTE, pas l'index suivant : une lecture absorbée
		// entre les deux n'a pas d'écran.
		// Like the next arrow: a missed question of the step may come back
		// first (engine/learn.ts). Nothing past the last question.
		if (ctx.questionSuivante(qi) !== null) advanceFrom(qi);
	}

	/* The press SPRING of an option (2026-09-27). A click re-renders the whole
	   card (refreshQuestionSlide): the pressed option is REPLACED by a new
	   element already at rest, so it used to jump back up in one frame. The
	   new element of the clicked option replays the release instead
	   (`is-released`, quiz-options.css); an option that gains the choice
	   fades into its blue (`is-now-selected`), one that loses it fades out
	   (`is-deselected`). Each class is removed at the end of ITS animation,
	   so a later re-render never inherits it. */
	const RELEASE_ANIMATIONS: Record<string, string> = {
		"is-released": "quiz-option-release",
		"is-now-selected": "quiz-option-select",
		"is-deselected": "quiz-option-deselect",
	};

	function playOptionRelease(qi: number, pressed: number, gained: number[], lost: number[]): void {
		const item = ctx.container.querySelector<HTMLElement>(`.quiz-step-page .quiz-card[data-card-qi="${qi}"]`)
			?? ctx.container.querySelector<HTMLElement>(`.quiz-track-item[data-slide-kind="question"][data-qi="${qi}"]`);
		if (!item) return;
		const mark = (oi: number, cls: string): void => {
			const el = item.querySelector<HTMLElement>(`.quiz-option[data-orig="${oi}"]`);
			if (!el) return;
			el.classList.add(cls);
			const end = (e: AnimationEvent): void => {
				if (e.animationName !== RELEASE_ANIMATIONS[cls]) return;
				el.classList.remove(cls);
				el.removeEventListener("animationend", end);
			};
			el.addEventListener("animationend", end);
		};
		mark(pressed, "is-released");
		for (const oi of gained) mark(oi, "is-now-selected");
		for (const oi of lost) mark(oi, "is-deselected");
	}

	function bindBinaryQuestion(trackItem: HTMLElement, qi: number, isMulti: boolean): void {
		trackItem.querySelectorAll<HTMLElement>(".quiz-option").forEach(el => {
			const oi = Number(el.dataset.orig);
			const trySelect = () => {
				if (ctx.quizState.isSliding || ctx.isRevealed(qi)) return;
				const gained: number[] = [];
				const lost: number[] = [];
				if (isMulti) {
					const s = ctx.quizState.selections[qi];
					if (!(s instanceof Set)) return;
					if (s.has(oi)) { s.delete(oi); lost.push(oi); }
					else { s.add(oi); gained.push(oi); }
				} else {
					const previous = ctx.quizState.selections[qi];
					if (previous !== oi) {
						gained.push(oi);
						if (typeof previous === "number") lost.push(previous);
					}
					ctx.quizState.selections[qi] = oi;
				}
				commitQuestionInteraction(qi, { syncHeight: true });
				playOptionRelease(qi, oi, gained, lost);
				/* Learn, single choice: the click IS the answer, so it is
				   checked on the spot, without the Check button. Multiple
				   choice keeps the button (the answer is several clicks). */
				if (ctx.learn.checksOnClick(qi) && ctx.learn.canCheck(qi)) ctx.learn.checkQuestion(qi);
			};
			el.addEventListener("click", trySelect);
			el.addEventListener("keydown", e => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					trySelect();
				}
			});
		});
	}

	/* Sélection d'une question à EMPLACEMENTS (classement, association) : des
	   indices, jamais des chaînes. Depuis le texte à trous, `QuestionSelection`
	   admet aussi `string[]` et `Array.isArray` ne suffit plus à distinguer les
	   deux — mais bindOrderingQuestion/bindMatchingQuestion ne sont appelées que
	   sous garde de variante. Le helper nomme cet invariant une fois. */
	function slotSelection(qi: number): Array<number | null> | null {
		const sel = ctx.quizState.selections[qi];
		return Array.isArray(sel) ? (sel as Array<number | null>) : null;
	}

	function bindOrderingQuestion(trackItem: HTMLElement, qi: number, q: OrderingQuestion): void {
		const qItems = ctx.getOrderingItems(q);
		const selInit = slotSelection(qi);
		if (!selInit || selInit.length !== qItems.length) {
			ctx.quizState.selections[qi] = new Array<number | null>(qItems.length).fill(null);
		}

		trackItem.querySelectorAll<HTMLElement>("[data-order-item]").forEach(el => {
			const oi = Number(el.dataset.orderItem);
			const pickItem = () => {
				if (ctx.quizState.isSliding || ctx.isRevealed(qi) || ctx.orderingSelectionIncludes(qi, oi)) return;
				ctx.quizState.orderingPick[qi] = ctx.quizState.orderingPick[qi] === oi ? null : oi;
				commitQuestionInteraction(qi, { syncHeight: true });
			};
			el.addEventListener("click", pickItem);
			el.addEventListener("keydown", e => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					pickItem();
				}
			});
			el.addEventListener("dragstart", e => {
				if (ctx.quizState.isSliding || ctx.isRevealed(qi) || ctx.orderingSelectionIncludes(qi, oi)) return void e.preventDefault();
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = "move";
					e.dataTransfer.setData("text/plain", JSON.stringify({ mode: "order", oi, sourceSlot: -1 }));
				}
				el.classList.add("dragging");
				trackItem.querySelectorAll("[data-order-slot]").forEach(s => s.classList.add("drag-ready"));
			});
			el.addEventListener("dragend", () => {
				el.classList.remove("dragging");
				trackItem.querySelectorAll("[data-order-slot]").forEach(s => s.classList.remove("dragover", "drag-ready", "swap-target"));
			});
		});

		trackItem.querySelectorAll<HTMLElement>("[data-order-slot]").forEach(el => {
			const si = Number(el.dataset.orderSlot);
			const actOnSlot = () => {
				if (ctx.quizState.isSliding || ctx.isRevealed(qi)) return;
				const sel = ctx.quizState.selections[qi];
				const picked = ctx.quizState.orderingPick[qi];
				if (!Array.isArray(sel)) return;
				if (picked !== null) {
					ctx.placeOrderingItemInSlot(qi, si, picked);
					ctx.quizState.orderingPick[qi] = null;
					return commitQuestionInteraction(qi, { syncHeight: true });
				}
				if (sel[si] !== null) {
					ctx.removeOrderingItemFromSlot(qi, si);
					commitQuestionInteraction(qi, { syncHeight: true });
				}
			};
			el.addEventListener("click", actOnSlot);
			el.addEventListener("keydown", e => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					actOnSlot();
				}
			});
			el.addEventListener("dragstart", e => {
				if (ctx.quizState.isSliding || ctx.isRevealed(qi)) return void e.preventDefault();
				const sel = slotSelection(qi);
				if (!sel) return void e.preventDefault();
				const oi = sel[si];
				if (oi === null || oi === undefined) return void e.preventDefault();
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = "move";
					e.dataTransfer.setData("text/plain", JSON.stringify({ mode: "order", oi, sourceSlot: si }));
				}
				el.classList.add("dragging");
				trackItem.querySelectorAll("[data-order-slot]").forEach(s => s.classList.add("drag-ready"));
			});
			el.addEventListener("dragend", () => {
				el.classList.remove("dragging");
				trackItem.querySelectorAll("[data-order-slot]").forEach(s => s.classList.remove("dragover", "drag-ready", "swap-target"));
			});
			el.addEventListener("dragover", e => {
				if (ctx.quizState.isSliding || ctx.isRevealed(qi)) return;
				e.preventDefault();
				const sel = slotSelection(qi);
				el.classList.add("dragover");
				if (sel && sel[si] !== null) el.classList.add("swap-target");
				else el.classList.remove("swap-target");
			});
			el.addEventListener("dragleave", () => el.classList.remove("dragover", "swap-target"));
			el.addEventListener("drop", e => {
				e.preventDefault();
				el.classList.remove("dragover", "swap-target");
				if (ctx.isRevealed(qi) || ctx.quizState.isSliding) return;
				const sel = slotSelection(qi);
				if (!sel) return;
				const raw = e.dataTransfer ? e.dataTransfer.getData("text/plain") : "";
				if (!raw) return;
				let payload: DragPayload | null = null;
				try { payload = JSON.parse(raw); } catch (_) { /* payload invalide : ignorer */ }
				if (!payload || payload.mode !== "order") return;
				const oi = Number(payload.oi);
				let sourceSlot = Number(payload.sourceSlot);
				if (!Number.isFinite(oi)) return;
				if (!Number.isFinite(sourceSlot)) sourceSlot = -1;
				const targetSlot = si;
				const targetValue = sel[targetSlot];
				if (sourceSlot < 0 || sourceSlot >= sel.length || sel[sourceSlot] !== oi) sourceSlot = sel.indexOf(oi);
				if (sourceSlot !== -1) {
					if (sourceSlot === targetSlot) return;
					sel[sourceSlot] = targetValue;
					sel[targetSlot] = oi;
					ctx.quizState.orderingPick[qi] = null;
					return commitQuestionInteraction(qi, { syncHeight: true });
				}
				sel[targetSlot] = oi;
				ctx.quizState.orderingPick[qi] = null;
				commitQuestionInteraction(qi, { syncHeight: true });
			});
		});
	}

	function bindMatchingQuestion(trackItem: HTMLElement, qi: number, q: MatchingQuestion): void {
		const rows = ctx.getMatchRows(q);
		const selInit = slotSelection(qi);
		if (!selInit || selInit.length !== rows.length) {
			ctx.quizState.selections[qi] = new Array<number | null>(rows.length).fill(null);
		}

		trackItem.querySelectorAll<HTMLElement>("[data-match-choice]").forEach(el => {
			const ci = Number(el.dataset.matchChoice);
			const pickChoice = () => {
				if (ctx.quizState.isSliding || ctx.isRevealed(qi)) return;
				ctx.quizState.matchPick[qi] = ctx.quizState.matchPick[qi] === ci ? null : ci;
				commitQuestionInteraction(qi, { syncHeight: true });
			};
			el.addEventListener("click", pickChoice);
			el.addEventListener("keydown", e => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					pickChoice();
				}
			});
			el.addEventListener("dragstart", e => {
				if (ctx.quizState.isSliding || ctx.isRevealed(qi)) return void e.preventDefault();
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = "copyMove";
					e.dataTransfer.setData("text/plain", JSON.stringify({ mode: "match", ci, sourceSlot: -1 }));
				}
				el.classList.add("dragging");
				trackItem.querySelectorAll("[data-match-slot]").forEach(s => s.classList.add("drag-ready"));
			});
			el.addEventListener("dragend", () => {
				el.classList.remove("dragging");
				trackItem.querySelectorAll("[data-match-slot]").forEach(s => s.classList.remove("dragover", "drag-ready", "swap-target"));
			});
		});

		trackItem.querySelectorAll<HTMLElement>("[data-match-slot]").forEach(el => {
			const si = Number(el.dataset.matchSlot);
			const actOnSlot = () => {
				if (ctx.quizState.isSliding || ctx.isRevealed(qi)) return;
				const picked = ctx.quizState.matchPick[qi];
				const sel = slotSelection(qi);
				if (!sel) return;
				if (picked !== null) {
					sel[si] = picked;
					ctx.quizState.matchPick[qi] = null;
					return commitQuestionInteraction(qi, { syncHeight: true });
				}
				if (sel[si] !== null) {
					sel[si] = null;
					commitQuestionInteraction(qi, { syncHeight: true });
				}
			};
			el.addEventListener("click", actOnSlot);
			el.addEventListener("keydown", e => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					actOnSlot();
				}
			});
			el.addEventListener("dragstart", e => {
				if (ctx.quizState.isSliding || ctx.isRevealed(qi)) return void e.preventDefault();
				const sel = slotSelection(qi);
				if (!sel) return void e.preventDefault();
				const ci = sel[si];
				if (ci === null || ci === undefined) return void e.preventDefault();
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = "move";
					e.dataTransfer.setData("text/plain", JSON.stringify({ mode: "match", ci, sourceSlot: si }));
				}
				el.classList.add("dragging");
				trackItem.querySelectorAll("[data-match-slot]").forEach(s => s.classList.add("drag-ready"));
			});
			el.addEventListener("dragend", () => {
				el.classList.remove("dragging");
				trackItem.querySelectorAll("[data-match-slot]").forEach(s => s.classList.remove("dragover", "drag-ready", "swap-target"));
			});
			el.addEventListener("dragover", e => {
				if (ctx.quizState.isSliding || ctx.isRevealed(qi)) return;
				e.preventDefault();
				const sel = slotSelection(qi);
				el.classList.add("dragover");
				if (sel && sel[si] !== null) el.classList.add("swap-target");
				else el.classList.remove("swap-target");
			});
			el.addEventListener("dragleave", () => el.classList.remove("dragover", "swap-target"));
			el.addEventListener("drop", e => {
				e.preventDefault();
				el.classList.remove("dragover", "swap-target");
				if (ctx.isRevealed(qi) || ctx.quizState.isSliding) return;
				const sel = slotSelection(qi);
				if (!sel) return;
				const raw = e.dataTransfer ? e.dataTransfer.getData("text/plain") : "";
				if (!raw) return;
				let payload: DragPayload | null = null;
				try { payload = JSON.parse(raw); } catch (_) { /* payload invalide : ignorer */ }
				if (!payload || payload.mode !== "match") return;
				const ci = Number(payload.ci);
				if (!Number.isFinite(ci)) return;
				let sourceSlot = Number(payload.sourceSlot);
				if (!Number.isFinite(sourceSlot)) sourceSlot = -1;
				const targetSlot = si;
				const targetValue = sel[targetSlot];
				if (sourceSlot >= 0 && sourceSlot < sel.length && sel[sourceSlot] === ci) {
					if (sourceSlot === targetSlot) return;
					sel[sourceSlot] = targetValue;
					sel[targetSlot] = ci;
					ctx.quizState.matchPick[qi] = null;
					return commitQuestionInteraction(qi, { syncHeight: true });
				}
				sel[targetSlot] = ci;
				ctx.quizState.matchPick[qi] = null;
				commitQuestionInteraction(qi, { syncHeight: true });
			});
		});
	}

	function bindQuestionTrackItem(trackItem: HTMLElement | null): void {
		if (!trackItem) return;

		/* A step page: each of its cards binds as a card of its own, and the
		   foot's two arrows are the page's previous and next. */
		if (trackItem.classList.contains("quiz-step-page")) {
			const first = Number(trackItem.dataset.qi);
			trackItem.querySelectorAll<HTMLElement>(".quiz-card[data-card-qi]").forEach(card => bindQuestionTrackItem(card));
			trackItem.querySelector(".quiz-step-nav .quiz-prev-btn")?.addEventListener("click", () => {
				const precedente = ctx.slideMap[ctx.getSlideIndexForQuestion(first) - 1];
				if (precedente?.type === "question") ctx.goToQuestion(precedente.questionIndex);
			});
			trackItem.querySelector(".quiz-step-nav .quiz-next-btn")?.addEventListener("click", () => advanceFrom(first));
			return;
		}

		// A card of a step page carries its own index (`data-card-qi`).
		const qi = Number(trackItem.dataset.cardQi ?? trackItem.dataset.qi);
		if (!Number.isFinite(qi) || qi < 0 || qi >= ctx.quiz.length) return;

		const q = ctx.quiz[qi];
		const isTxt = ctx.isTextQuestion(q);
		const isCloze = ctx.isClozeQuestion(q);
		const isOrd = ctx.isOrderingQuestion(q);
		const isMatch = ctx.isMatchingQuestion(q);
		const isMulti = !!(q as { multiSelect?: boolean }).multiSelect;

		// Décision PAR QUESTION (isTextOnlyFor) : le binder attaché à CETTE
		// carte suit son propre rôle, pas un mode global — une tranche de Leçon
		// mélange "test" (binders QCM/texte habituels) et "recall" (auto-évaluation).
		//
		// Carte de rôle "read" (Task 6c) : PAS de branche dédiée ici — revue
		// (fix round 1) : `isTextOnlyFor(qi)` est déjà faux pour "read" (seuls
		// "recall"/practiceMode="text" y répondent vrai), donc le binder QCM/
		// texte/ordering/matching ci-dessous s'exécute, mais cards.ts ne rend
		// plus aucun élément `.quiz-option`/`.quiz-textarea`/`[data-order-*]`/
		// `[data-match-*]` sur cette carte : chaque `querySelectorAll` retombe
		// sur une NodeList vide et chaque `addEventListener` en boucle sur zéro
		// élément. Une garde ici n'aurait annulé que des no-op déjà inertes —
		// gain nul pour une exception au routage général. Un cas concret où
		// elle changerait quelque chose : aucun trouvé.
		if (ctx.textOnly?.isTextOnlyFor?.(qi)) {
			ctx.textOnly.bindTextOnlyQuestion(trackItem, qi);
		} else {
			// isTxt/isOrd/isMatch garantissent la variante ⇒ casts documentés.
			if (isCloze) ctx.cloze.bindClozeQuestion(trackItem, qi);
			if (isTxt && !isCloze) ctx.terminal.bindTextQuestion(trackItem, qi);
			if (!isTxt && !isCloze && !isOrd && !isMatch) bindBinaryQuestion(trackItem, qi, isMulti);
			if (isOrd) bindOrderingQuestion(trackItem, qi, q as OrderingQuestion);
			if (isMatch) bindMatchingQuestion(trackItem, qi, q as MatchingQuestion);
		}

		ctx.passage.bindPassage(trackItem, qi);

		// L'indice se révèle sur place, un niveau par clic (engine/hint.ts).
		ctx.hint.brancherIndice(trackItem, qi);

		// Task 7 (mode Lesson) : « Je ne sais pas » — le seul moyen de passer
		// une carte "pre" sans y répondre : son bouton suivant bute sur la garde
		// de goToSlide (state.ts) tant qu'il n'y a ni réponse ni ce clic.
		// Logique déportée dans markLessonPreSkipped (testable sans DOM).
		const dontKnowBtn = trackItem.querySelector(".quiz-lesson-dontknow-btn");
		if (dontKnowBtn) {
			dontKnowBtn.addEventListener("click", e => {
				e.preventDefault();
				// Ignoré EN SILENCE pendant une transition de slide : geste voulu,
				// même garde qu'ailleurs sur ce fichier (bindBinaryQuestion, etc.) —
				// un clic pendant l'animation retomberait sur une carte qui a déjà
				// commencé à quitter l'écran, aucune Notice n'est nécessaire pour un
				// double-clic accidentel sans conséquence.
				if (ctx.quizState.isSliding) return;
				markLessonPreSkipped(qi);
			});
		}

		const prevBtn = trackItem.querySelector(".quiz-prev-btn");
		// Précédente / suivante par DIAPOSITIVE : `qi ± 1` visait une lecture
		// absorbée, qui n'en a pas (et renvoie à la question qui la montre —
		// parfois celle-ci même).
		if (prevBtn) prevBtn.addEventListener("click", () => {
			const precedente = ctx.slideMap[ctx.getSlideIndexForQuestion(qi) - 1];
			if (precedente?.type === "question") ctx.goToQuestion(precedente.questionIndex);
		});

		const nextBtn = trackItem.querySelector(".quiz-next-btn");
		if (nextBtn) nextBtn.addEventListener("click", () => advanceFrom(qi));

		// Learn: the card's own Check button (engine/learn.ts).
		const checkBtn = trackItem.querySelector<HTMLButtonElement>(".quiz-learn-check-btn");
		if (checkBtn) checkBtn.addEventListener("click", e => {
			e.preventDefault();
			if (ctx.quizState.isSliding) return;
			ctx.learn.checkQuestion(qi);
		});
	}

	/* THE NEXT ARROW of a question — the card's button, the application's bar
	   (which clicks it) and the → key. In a Learn it checks an answered
	   question first, then brings a missed one back when it is due
	   (engine/learn.ts); everywhere else it goes to the next slide. */
	function advanceFrom(qi: number): void {
		/* A step page has ONE next (the arrow, the swipe, the bar, the button
		   at its foot): it speaks for the page's LAST card, so that no answered
		   but unchecked card in the middle of the page takes the press. */
		const page = ctx.stepOf?.(qi);
		if (page) qi = stepMembers(page)[stepMembers(page).length - 1];
		const move = ctx.learn.advance(qi);
		if (move.kind !== "go") return;
		if (move.qi !== null) ctx.goToQuestion(move.qi);
		else goPastLastQuestion();
	}

	function bindSubmitSlideControls(rootEl: Element | null): void {
		if (!rootEl) return;
		rootEl.querySelectorAll<HTMLElement>("[data-jump]").forEach(btn => btn.addEventListener("click", () => ctx.goToQuestion(Number(btn.dataset.jump))));
		const backBtn = rootEl.querySelector(".quiz-back-btn");
		if (backBtn) backBtn.addEventListener("click", () => ctx.goToQuestion(ctx.quizState.lastQuestionIndex));
		const showScoreBtn = rootEl.querySelector<HTMLElement>(".quiz-show-score-btn");
		if (showScoreBtn) showScoreBtn.addEventListener("click", e => {
			e.preventDefault();
			// Remove focus to avoid aria-hidden warning
			if (document.activeElement === showScoreBtn) showScoreBtn.blur();
			ctx.goToResults();
		});
	}

	function bindResultsSlideControls(rootEl: Element | null): void {
		if (!rootEl) return;
		// Le verdict juste/faux de chaque réponse écrite (2026-09-26bis, retour
		// #17) : rendu par writtenReviewSectionHtml (cards.ts resultsSlideHtml),
		// câblé ici comme les autres contrôles de cette diapositive.
		ctx.textOnly?.bindWrittenReviewControls?.(rootEl);
		/* The results are saved automatically at the hand-in (state.ts
		   goToResults). Its button is redrawn in place as the save goes
		   (cards.ts syncResultsFileButton), hence ONE delegated listener on
		   the slide rather than one on a button that gets replaced. */
		rootEl.addEventListener("click", e => {
			const btn = (e.target as Element | null)?.closest?.<HTMLButtonElement>(".quiz-results-file-btn");
			if (!btn || btn.disabled) return;
			e.preventDefault();
			if (btn.dataset.resultsAction === "retry") void ctx.resultsSaver.autoSave({ retry: true });
			else if (btn.dataset.resultsAction === "delete") {
				openConfirmModal(
					t("engine.result.deleteConfirmTitle"),
					t("engine.result.deleteConfirmMessage"),
					t("engine.result.deleteConfirmAction"),
					t("engine.result.deleteConfirmCancel"),
					(confirmed) => { if (confirmed) void ctx.resultsSaver.deleteSaved(); });
			}
		});

		// "Done" on a Learn's summary: the host closes the quiz (no confirmation:
		// a Learn's state is in the session snapshot).
		rootEl.querySelector(".quiz-learn-done-btn")?.addEventListener("click", e => {
			e.preventDefault();
			ctx.container.dispatchEvent(new CustomEvent("quiz-done", { bubbles: true }));
		});

		const retryBtn = rootEl.querySelector(".quiz-retry-btn");
		if (retryBtn) retryBtn.addEventListener("click", e => {
			e.preventDefault();
			ctx.zoom.restartQuizWithZoomBlurTransition();
		});
		const reviewBtn = rootEl.querySelector(".quiz-review-answers-btn");
		if (reviewBtn) reviewBtn.addEventListener("click", e => {
			e.preventDefault();
			ctx.goToQuestion(0);
		});
	}

	function bindStaticControls(): void {
		bindSubmitSlideControls(ctx.container.querySelector('.quiz-track-item[data-slide-kind="submit"]'));
		bindResultsSlideControls(ctx.container.querySelector('.quiz-track-item[data-slide-kind="results"]'));

		// ── Flèches clavier : navigation entre questions ──
		/* The → / ← move, shared by the keys and the swipe. `bySwipe` ignores a
		   forward move on a Test's last question (a swipe never hands in). */
		const navigate = (forward: boolean, bySwipe = false): boolean => {
			const cur = ctx.quizState.current;
			if (forward) {
				if (ctx.isQuestionSlideIndex(cur)) {
					if (bySwipe && ctx.handIn.isTest() && ctx.slideMap[cur + 1]?.type !== "question") return false;
					advanceFrom((ctx.slideMap[cur] as { questionIndex: number }).questionIndex);
					return true;
				}
				if (ctx.isSubmitSlideIndex(cur)) { ctx.goToResults(); return true; }
				return false;
			}
			if (ctx.isResultsSlideIndex(cur)) { ctx.goToQuestion(ctx.quizState.lastQuestionIndex); return true; }
			if (ctx.isSubmitSlideIndex(cur)) { ctx.goToQuestion(ctx.quizState.lastQuestionIndex); return true; }
			if (cur > 0) { ctx.goToSlide(cur - 1, { forceRender: false }); return true; }
			return false;
		};

		const onArrowKey = (e: KeyboardEvent) => {
			if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
			if (ctx.__quizDestroyed) return;
			if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
			/* Focus on the page itself (a quiz just opened, nothing clicked yet) still
			   plays: only a keystroke aimed at something OUTSIDE this quiz (a dialog
			   over it, another screen) is not ours. */
			const cible = e.target;
			if (cible instanceof Node && cible !== document.body && cible !== document.documentElement && !ctx.container.contains(cible)) return;
			if (!ctx.container.isConnected || ctx.container.closest("[inert]")) return;
			const tag = document.activeElement?.tagName;
			if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
			if ((document.activeElement as HTMLElement | null)?.isContentEditable) return;
			if (ctx.quizState.isSliding) return;
			if (navigate(e.key === "ArrowRight")) e.preventDefault();
		};
		/* A swipe on the played quiz is the same move as the arrows, and the
		   track FOLLOWS THE FINGER (translate3d only, no layout). */
		const canMove = (forward: boolean): boolean => {
			const cur = ctx.quizState.current;
			if (forward) {
				if (ctx.isQuestionSlideIndex(cur)) return !(ctx.handIn.isTest() && ctx.slideMap[cur + 1]?.type !== "question");
				return ctx.isSubmitSlideIndex(cur);
			}
			return ctx.isResultsSlideIndex(cur) || ctx.isSubmitSlideIndex(cur) || cur > 0;
		};
		const trackEl = () => ctx.viewport.getTrackElements().track;
		let resting = "";
		let dragging = false;
		const settleBack = (fromOffset: number, width: number) => {
			const track = trackEl();
			if (!track) return;
			const home = ctx.track.getSlideTranslateX(ctx.quizState.current);
			const ms = prefersReducedMotion() ? 0 : settleDuration(fromOffset, width);
			track.style.transition = ms ? `transform ${ms}ms ${SETTLE_EASING}` : "none";
			ctx.track.setTrackTransformPx(home);
			window.setTimeout(() => { if (!dragging) track.style.transition = resting; }, ms + 30);
		};
		ctx.__quizGlobalCleanups.push(bindSwipe(ctx.container, d => {
			if (ctx.__quizDestroyed || ctx.quizState.isSliding) return;
			navigate(d === "next", true);
		}, undefined, {
			canGo: dir => !ctx.__quizDestroyed && !ctx.quizState.isSliding && canMove(dir === "next"),
			drag: offset => {
				const track = trackEl();
				if (!track || ctx.__quizDestroyed || ctx.quizState.isSliding) return;
				if (!dragging) { dragging = true; resting = track.style.transition; track.style.transition = "none"; }
				ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(ctx.quizState.current) + offset);
			},
			release: (dir, offset, _v, width) => {
				if (!dragging) return;
				dragging = false;
				const track = trackEl();
				if (!track) return;
				if (!dir) { dragging = true; settleBack(offset, width); dragging = false; return; }
				const remaining = width - Math.abs(offset);
				ctx.quizState.swipeSettleMs = prefersReducedMotion() ? 0 : settleDuration(remaining, width);
				track.style.transition = resting;
				const before = ctx.quizState.current;
				const moved = navigate(dir === "next", true);
				ctx.quizState.swipeSettleMs = null;
				if (moved && (ctx.quizState.current !== before || ctx.quizState.isSliding)) hapticTick();
				else { dragging = true; settleBack(offset, width); dragging = false; }
			},
		}));
		/* On `document`, guarded in `onArrowKey` (the note-hosted days, where several
		   quizzes shared a page and one global handler moved them all, are gone):
		   with the focus on the page, before any click, a container listener never
		   heard the arrows, and the screen behind took them instead. */
		document.addEventListener("keydown", onArrowKey);
		ctx.__quizGlobalCleanups.push(() => document.removeEventListener("keydown", onArrowKey));

		const bindNavTab = (tab: HTMLElement | null, navigateFn: () => void) => {
			if (!tab) return;
			tab.addEventListener("pointerdown", e => {
				if (e.button !== 0) return;
				ctx.clearAllNavTabPressStates();
				ctx.setNavTabPressState(tab, true);
			});
			tab.addEventListener("pointercancel", () => ctx.clearNavTabPressState(tab));
			tab.addEventListener("click", async e => {
				e.preventDefault();
				e.stopPropagation();
				await ctx.playNavTabPressAndNavigate(tab, navigateFn);
			});
			tab.addEventListener("keydown", async e => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					e.stopPropagation();
					await ctx.playNavTabPressAndNavigate(tab, navigateFn, { fromKeyboard: true });
				}
			});
		};
		ctx.container.querySelectorAll<HTMLElement>("[data-nav]").forEach(a => bindNavTab(a, () => ctx.goToQuestion(Number(a.dataset.nav))));
		const resultsTab = ctx.container.querySelector<HTMLElement>("[data-nav-results]");
		if (resultsTab) bindNavTab(resultsTab, goPastLastQuestion);
	}

	/* Past the last question: ONE rule for the → key, the Results tab and the
	   last card's next arrow, kept in engine/hand-in.ts (pastLastQuestion). */
	function goPastLastQuestion(): void {
		ctx.handIn.pastLastQuestion();
	}

	function destroyZoomFixHandlers(): void {
		if (!__quizZoomFixBound) return;
		__quizZoomFixBound = false;

		if (__quizZoomFixRaf) {
			cancelAnimationFrame(__quizZoomFixRaf);
			__quizZoomFixRaf = 0;
		}
		if (__quizZoomFixSettleTimer) {
			clearTimeout(__quizZoomFixSettleTimer);
			__quizZoomFixSettleTimer = 0;
		}
		if (__quizZoomFixHandler) {
			window.removeEventListener("resize", __quizZoomFixHandler);
			if (window.visualViewport) {
				window.visualViewport.removeEventListener("resize", __quizZoomFixHandler);
			}
			__quizZoomFixHandler = null;
		}
	}

	function bindZoomFixHandlers(): void {
		if (__quizZoomFixBound) return;
		__quizZoomFixBound = true;

		__quizZoomLastDpr = window.devicePixelRatio || 1;

		const requestResync = (settle = false) => {
			if (ctx.__quizDestroyed) return;

			if (__quizZoomFixRaf) return;
			__quizZoomFixRaf = requestAnimationFrame(() => {
				__quizZoomFixRaf = 0;
				if (ctx.__quizDestroyed) return;

				// Invalider les caches liés au layout/zoom.
				// `__quizTrackViewportWidth` n'est PAS exposé sur ViewportHandlers (variable
				// de closure de viewport.ts) : cette écriture sur l'objet handlers est un
				// no-op pré-existant du JS — conservée à l'identique. Le vrai rafraîchissement
				// vient de applyTrackGeometry({ refreshWidth: true }) juste après.
				(ctx.viewport as { __quizTrackViewportWidth?: number }).__quizTrackViewportWidth = 0;
				ctx.viewport.__quizSlideHeightCache?.delete(ctx.quizState.current);

				// Recalage géométrie + position
				ctx.viewport.applyTrackGeometry({ refreshWidth: true });
				ctx.viewport.syncTrackViewportIsolation();

				// Si on est en slide, on repart proprement depuis l'état courant
				if (ctx.quizState.isSliding) {
					const snap = ctx.track.cancelRunningTrackAnimation();
					ctx.track.animateTrackToIndex(ctx.quizState.current, {
						fromX: snap.x,
						fromHeight: snap.height,
						refreshTargetHeight: true
					});
				} else {
					const { track } = ctx.viewport.getTrackElements();
					if (track) {
						track.style.transition = "none";
						track.style.willChange = "";
						ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(ctx.quizState.current));
					}
					ctx.viewport.primeAllSlideHeights({ retries: settle ? 4 : 2, syncCurrent: true });
					ctx.viewport.scheduleViewportHeightSync({ index: ctx.quizState.current, animate: false, refresh: true });
				}

				// Re-sync spécifique des textareas terminal (caret/overlay/scrollLeft)
				ctx.viewport.resyncCommandTextareasOnSlide(ctx.quizState.current);

				ctx.updateNavHighlight();
			});
		};

		const onZoomOrResize = () => {
			const dpr = window.devicePixelRatio || 1;
			const dprChanged = Math.abs(dpr - __quizZoomLastDpr) > 0.001;
			if (dprChanged) __quizZoomLastDpr = dpr;

			requestResync(false);

			// "settle" : après stabilisation des layouts/fonts
			if (__quizZoomFixSettleTimer) clearTimeout(__quizZoomFixSettleTimer);
			__quizZoomFixSettleTimer = window.setTimeout(() => {
				__quizZoomFixSettleTimer = 0;
				requestResync(true);
			}, 260);
		};

		__quizZoomFixHandler = onZoomOrResize;

		window.addEventListener("resize", onZoomOrResize, { passive: true });
		if (window.visualViewport) {
			window.visualViewport.addEventListener("resize", onZoomOrResize, { passive: true });
		}
	}

	return {
		bindBinaryQuestion,
		bindOrderingQuestion,
		bindMatchingQuestion,
		bindQuestionTrackItem,
		markLessonPreSkipped,
		bindSubmitSlideControls,
		bindResultsSlideControls,
		bindStaticControls,
		bindZoomFixHandlers,
		destroyZoomFixHandlers,
		advanceFrom
	};
}
