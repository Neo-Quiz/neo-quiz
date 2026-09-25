import type { EngineCtx } from "../types/engine-ctx";
import type { OrderingQuestion, MatchingQuestion } from "../types/quiz";
import { t } from "../i18n";

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
	bindStartModeControls(rootEl?: HTMLElement | null): void;
	bindQuestionTrackItem(trackItem: HTMLElement | null): void;
	/** Task 7 (mode Lesson) : extrait du binding DOM (round 1 de revue, Finding 5)
	 * pour rester testable sans document (scripts/check-lesson.mjs). */
	markLessonPreSkipped(qi: number): void;
	bindSubmitSlideControls(rootEl: Element | null): void;
	bindResultsSlideControls(rootEl: Element | null): void;
	bindExamStartButton(): void;
	bindStaticControls(): void;
	bindZoomFixHandlers(): void;
	destroyZoomFixHandlers(): void;
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
		if (qi < ctx.quiz.length - 1) ctx.goToQuestion(qi + 1);
	}

	function bindBinaryQuestion(trackItem: HTMLElement, qi: number, isMulti: boolean): void {
		trackItem.querySelectorAll<HTMLElement>(".quiz-option").forEach(el => {
			const oi = Number(el.dataset.orig);
			const trySelect = () => {
				if (ctx.quizState.isSliding || ctx.quizState.locked) return;
				if (isMulti) {
					const s = ctx.quizState.selections[qi];
					if (!(s instanceof Set)) return;
					if (s.has(oi)) s.delete(oi);
					else s.add(oi);
				} else ctx.quizState.selections[qi] = oi;
				commitQuestionInteraction(qi, { syncHeight: true });
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
				if (ctx.quizState.isSliding || ctx.quizState.locked || ctx.orderingSelectionIncludes(qi, oi)) return;
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
				if (ctx.quizState.isSliding || ctx.quizState.locked || ctx.orderingSelectionIncludes(qi, oi)) return void e.preventDefault();
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
				if (ctx.quizState.isSliding || ctx.quizState.locked) return;
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
				if (ctx.quizState.isSliding || ctx.quizState.locked) return void e.preventDefault();
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
				if (ctx.quizState.isSliding || ctx.quizState.locked) return;
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
				if (ctx.quizState.locked || ctx.quizState.isSliding) return;
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
				if (ctx.quizState.isSliding || ctx.quizState.locked) return;
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
				if (ctx.quizState.isSliding || ctx.quizState.locked) return void e.preventDefault();
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
				if (ctx.quizState.isSliding || ctx.quizState.locked) return;
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
				if (ctx.quizState.isSliding || ctx.quizState.locked) return void e.preventDefault();
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
				if (ctx.quizState.isSliding || ctx.quizState.locked) return;
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
				if (ctx.quizState.locked || ctx.quizState.isSliding) return;
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

		const qi = Number(trackItem.dataset.qi);
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

		const hintBtn = trackItem.querySelector(".quiz-hint-btn");
		if (hintBtn) {
			hintBtn.addEventListener("click", e => {
				e.preventDefault();
				e.stopPropagation();
				if (ctx.quizState.isSliding) return;
				/* L'indice se RÉVÈLE sur place (plus de fenêtre) : l'état le
				   retient, le re-rendu l'affiche sous la question et fait
				   monter le bouton d'aide d'un cran (cards.ts). */
				ctx.quizState.hintSeen[qi] = true;
				ctx.commitQuestionInteraction(qi, { syncHeight: true });
			});
		}

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
		if (prevBtn) prevBtn.addEventListener("click", () => ctx.goToQuestion(qi - 1));

		const nextBtn = trackItem.querySelector(".quiz-next-btn");
		if (nextBtn) nextBtn.addEventListener("click", () => {
			if (qi < ctx.quiz.length - 1) ctx.goToQuestion(qi + 1);
			else goPastLastQuestion();
		});
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
		const saveBtn = rootEl.querySelector<HTMLButtonElement>(".quiz-save-results-btn");
		if (saveBtn) saveBtn.addEventListener("click", async e => {
			e.preventDefault();
			if (saveBtn.dataset.saving === "1") return;
			saveBtn.dataset.saving = "1";
			saveBtn.disabled = true;
			const previousText = saveBtn.textContent;
			saveBtn.textContent = t("engine.result.saving");

			try {
				const saved = await ctx.resultsSaver.saveCurrentResults();
				ctx.quizState.savedResultsPath = saved.path;
				ctx.host.ui.notice(t("engine.result.savedNotice", { path: saved.path }), 5000);
				ctx.cards.refreshMetaSlides({ force: true });
			} catch (error) {
				console.error("Quiz results save error:", error);
				saveBtn.disabled = false;
				saveBtn.textContent = previousText || t("engine.result.save");
				delete saveBtn.dataset.saving;
				ctx.host.ui.notice(t("engine.result.saveError", {
					message: (error as { message?: string })?.message || t("engine.result.unknownError")
				}));
			}
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
		const examBtn = rootEl.querySelector(".quiz-exam-btn");
		if (examBtn) examBtn.addEventListener("click", e => {
			e.preventDefault();
			ctx.switchToExamMode();
		});
	}

	function bindExamStartButton(): void {
		const startBtn = ctx.container.querySelector('.quiz-exam-start-btn');
		if (startBtn) {
			startBtn.addEventListener('click', () => {
				if (ctx.quizState?.startMode === "learn") ctx.exam.startLearnMode();
				else ctx.exam.startExam();
			});
		}
	}

	/* Le bouton "Practice mode" est retire de l’interface (Task 5, 2026-08-31),
	   sa mecanique absorbee par le role "recall" en mode Lecon. FINDING 3
	   (round 1 de revue Task 5) : bindModeToggleControls et
	   applyModeToggleVisualState, qui geraient le clic sur CE bouton, sont
	   retires avec lui plutot que laisses en place - verifie par grep
	   qu’aucun code ne produit plus jamais l’attribut data-quiz-mode qu’ils
	   ecoutaient. Ce n’etait PAS un chemin partage avec bindStartModeControls
	   ci-dessous (deux fonctions a selecteurs distincts, [data-quiz-mode]
	   contre [data-quiz-start-mode]), contrairement a ce qu’affirmait a tort
	   le commentaire d’une revue precedente. */
	/* Le choix Apprendre / Examen de l'écran de démarrage. Il ne passe PLUS
	   par `setPracticeMode` (2026-09-17) : « Practice » est retiré, et
	   `practiceMode` ne sert plus qu'au rôle `recall` d'une leçon. On note le
	   choix et on repeint l'écran — le libellé du bouton et le résumé
	   (« Sans chrono » ou la durée) en dépendent. */
	function bindStartModeControls(rootEl: HTMLElement | null = ctx.container): void {
		rootEl?.querySelectorAll?.<HTMLElement>("[data-quiz-start-mode]")?.forEach(btn => {
			btn.addEventListener("click", e => {
				e.preventDefault();
				const next = btn.dataset.quizStartMode === "learn" ? "learn" : "exam";
				if (next === ctx.quizState.startMode) return;
				ctx.quizState.startMode = next;
				ctx.render();
			});
		});
	}

	function bindStaticControls(): void {
		bindSubmitSlideControls(ctx.container.querySelector('.quiz-track-item[data-slide-kind="submit"]'));
		bindResultsSlideControls(ctx.container.querySelector('.quiz-track-item[data-slide-kind="results"]'));

		// ── Flèches clavier : navigation entre questions ──
		const onArrowKey = (e: KeyboardEvent) => {
			if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
			if (ctx.__quizDestroyed) return;
			const tag = document.activeElement?.tagName;
			if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
			if ((document.activeElement as HTMLElement | null)?.isContentEditable) return;
			if (ctx.quizState.isSliding) return;

			const cur = ctx.quizState.current;
			let navigated = false;
			if (e.key === "ArrowRight") {
				if (ctx.isQuestionSlideIndex(cur)) {
					const qi = (ctx.slideMap[cur] as { questionIndex: number }).questionIndex;
					if (qi < ctx.quiz.length - 1) {
						ctx.goToSlide(cur + 1, { forceRender: false });
						navigated = true;
					} else {
						goPastLastQuestion();
						navigated = true;
					}
				}
				else if (ctx.isSubmitSlideIndex(cur)) { ctx.goToResults(); navigated = true; }
			} else {
				if (ctx.isResultsSlideIndex(cur)) { ctx.goToQuestion(ctx.quizState.lastQuestionIndex); navigated = true; }
				else if (ctx.isSubmitSlideIndex(cur)) { ctx.goToQuestion(ctx.quizState.lastQuestionIndex); navigated = true; }
				else if (cur > 0) {
					ctx.goToSlide(cur - 1, { forceRender: false });
					navigated = true;
				}
			}
			if (navigated) e.preventDefault();
		};
		// Bindé sur le container (pas document) : le keydown ne remonte au handler que
		// si le focus est DANS ce quiz. Sinon plusieurs blocs quiz d'une même note
		// naviguaient tous ensemble à chaque flèche (handler document partagé), et un
		// quiz captait les flèches globalement même hors focus.
		ctx.container.addEventListener("keydown", onArrowKey);
		ctx.__quizGlobalCleanups.push(() => ctx.container.removeEventListener("keydown", onArrowKey));

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

	/* Au-delà de la dernière question : UNE règle pour la touche →, l'onglet
	   « Résultats » et le bouton suivant de la dernière carte — trois copies
	   divergeraient à la première retouche.
	   isTextOnlyMode() GLOBAL à dessein : sauter l'écran de soumission n'a de
	   sens que si TOUT le quiz est en réponse libre (chemin historique) — une
	   tranche de Leçon mélangeant "test" et "recall" doit garder l'étape de
	   soumission, qui vérifie les questions manquantes du quiz entier. */
	function goPastLastQuestion(): void {
		if (ctx.textOnly?.isExamAnswerPhase?.()) ctx.goToSubmit();
		else if (ctx.textOnly?.isTextOnlyMode?.()) ctx.goToResults();
		else if (ctx.quizState.locked) ctx.goToSlide(ctx.SLIDE_RESULTS_INDEX, { forceRender: false });
		else ctx.goToSubmit();
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
		bindStartModeControls,
		bindQuestionTrackItem,
		markLessonPreSkipped,
		bindSubmitSlideControls,
		bindResultsSlideControls,
		bindExamStartButton,
		bindStaticControls,
		bindZoomFixHandlers,
		destroyZoomFixHandlers
	};
}
