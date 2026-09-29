import type { EngineCtx } from "../types/engine-ctx";

/**
 * Entrée brute passée à waitForManagedTransitions : soit un Element, soit un
 * couple {target, properties}. Identique au type d'engine/focus.ts — zoom.ts
 * possède sa PROPRE copie locale de waitForManagedTransitions (doublon
 * pré-existant, implémentation par listeners `transitionend` plutôt que polling
 * `getAnimations`) : converti tel quel, NON fusionné (iso-fonctionnalité).
 */
type ManagedTransitionInput = Element | { target?: Element | null; properties?: string[] } | null | undefined;

interface NormalizedTransition {
	target: Element;
	properties: Set<string> | null;
}

interface TrackedTransition {
	target: Element;
	properties: Set<string> | null;
	seen: Set<string>;
	listener: ((e: Event) => void) | null;
	done: boolean;
}

function isManagedTransitionElement(value: ManagedTransitionInput): value is Element {
	return typeof Element !== "undefined" && value instanceof Element;
}

interface OutFocusOptions {
	duration?: number;
	easing?: string;
	scale?: number;
	blur?: number;
	onComplete?: (() => void) | null;
}

interface InFocusOptions {
	duration?: number;
	easing?: string;
	scaleStart?: number;
	scaleEnd?: number;
	blurStart?: number;
	blurEnd?: number;
	opacityStart?: number;
	opacityEnd?: number;
	onComplete?: (() => void) | null;
}

export interface ZoomHandlers {
	waitForManagedTransitions(entries: ManagedTransitionInput[] | null | undefined, fallbackMs: number, epoch?: number): Promise<boolean>;
	restartQuizWithZoomBlurTransition(): Promise<void>;
	applyOutFocusTransition(element: HTMLElement | null, options?: OutFocusOptions): Promise<void>;
	applyInFocusTransition(element: HTMLElement | null, options?: InFocusOptions): Promise<void>;
}

export function createZoomHandlers(ctx: EngineCtx): ZoomHandlers {
	// Variables locales
	let __quizZoomTransitionRaf = 0;

	function waitForManagedTransitions(entries: ManagedTransitionInput[] | null | undefined, fallbackMs: number, epoch: number = ctx.currentAsyncEpoch()): Promise<boolean> {
		const normalized = (entries || [])
			.map((entry): NormalizedTransition | null => {
				if (!entry) return null;
				if (isManagedTransitionElement(entry)) return { target: entry, properties: null };
				const target = entry.target || null;
				const properties = Array.isArray(entry.properties) && entry.properties.length > 0 ? new Set<string>(entry.properties) : null;
				return target ? { target, properties } : null;
			})
			.filter((entry): entry is NormalizedTransition => entry !== null);
		if (normalized.length === 0) return Promise.resolve(ctx.isQuizInstanceAlive(epoch));

		let timer = 0;
		let remaining = normalized.length;
		const tracked: TrackedTransition[] = normalized.map(item => ({ target: item.target, properties: item.properties, seen: new Set<string>(), listener: null, done: false }));
		const waiter = ctx.createPendingAsyncWaiter(() => {
			for (const item of tracked) {
				if (!item.target || !item.listener) continue;
				try { item.target.removeEventListener("transitionend", item.listener); } catch (_) {}
			}
			if (timer) clearTimeout(timer);
		});

		const finishOne = (item: TrackedTransition): void => {
			if (item.done) return;
			item.done = true;
			if (item.target && item.listener) {
				try { item.target.removeEventListener("transitionend", item.listener); } catch (_) {}
			}
			item.listener = null;
			remaining -= 1;
			if (remaining <= 0) waiter.resolve(ctx.isQuizInstanceAlive(epoch));
		};

		for (const item of tracked) {
			// target générique (Element) → listener typé Event ; propertyName lu via
			// cast TransitionEvent (l'événement transitionend l'expose au runtime).
			item.listener = (e: Event) => {
				const te = e as TransitionEvent;
				if (te.target !== item.target) return;
				if (!item.properties) return finishOne(item);
				if (!item.properties.has(te.propertyName)) return;
				item.seen.add(te.propertyName);
				if (item.seen.size >= item.properties.size) finishOne(item);
			};
			try { item.target.addEventListener("transitionend", item.listener); } catch (_) { finishOne(item); }
		}

		if (remaining <= 0) return waiter.promise;
		timer = window.setTimeout(() => waiter.resolve(ctx.isQuizInstanceAlive(epoch)), Math.max(0, Number(fallbackMs) || 0));
		return waiter.promise;
	}

	async function applyOutFocusTransition(element: HTMLElement | null, options: OutFocusOptions = {}): Promise<void> {
		const {
			duration = 500,
			easing = "ease-out",
			scale = 0.95,
			blur = 10,
			onComplete = null
		} = options;

		return new Promise<void>(resolve => {
			if (!element) {
				resolve();
				return;
			}

			Object.assign(element.style, {
				willChange: "transform, opacity, filter",
				transition: `transform ${duration}ms ${easing}, opacity ${duration}ms ${easing}, filter ${duration}ms ${easing}`,
				transform: `scale(${scale})`,
				opacity: "0",
				filter: `blur(${blur}px)`
			});

			const onTransitionEnd = () => {
				element.removeEventListener("transitionend", onTransitionEnd);
				if (onComplete) onComplete();
				resolve();
			};

			element.addEventListener("transitionend", onTransitionEnd);
		});
	}

	async function applyInFocusTransition(element: HTMLElement | null, options: InFocusOptions = {}): Promise<void> {
		const {
			duration = 600,
			easing = "cubic-bezier(0.16, 1, 0.3, 1)",
			scaleStart = 1.05,
			scaleEnd = 1,
			blurStart = 10,
			blurEnd = 0,
			opacityStart = 0,
			opacityEnd = 1,
			onComplete = null
		} = options;

		return new Promise<void>(resolve => {
			if (!element) {
				resolve();
				return;
			}

			Object.assign(element.style, {
				willChange: "transform, opacity, filter",
				animation: `quiz-focus-in-animation ${duration}ms ${easing} forwards`
			});

			// styleSheet peut être null (aucune feuille + .sheet non prête) : le
			// try/catch d'origine avale l'exception, le cast/`!` préserve ce chemin.
			const styleSheet = document.styleSheets[0] || document.head.appendChild(document.createElement("style")).sheet;
			try {
				styleSheet!.insertRule(`
					@keyframes quiz-focus-in-animation {
						0% {
							transform: scale(${scaleStart});
							opacity: ${opacityStart};
							filter: blur(${blurStart}px);
						}
						100% {
							transform: scale(${scaleEnd});
							opacity: ${opacityEnd};
							filter: blur(${blurEnd}px);
						}
					}
				`, styleSheet!.cssRules.length);
			} catch (e) {
				// Keyframes might already exist, ignore
			}

			const onAnimationEnd = () => {
				element.removeEventListener("animationend", onAnimationEnd);
				element.style.animation = "";
				if (onComplete) onComplete();
				resolve();
			};

			element.addEventListener("animationend", onAnimationEnd);
		});
	}

	async function restartQuizWithZoomBlurTransition(): Promise<void> {
		// Forcer le reset de isSliding si on est sur la page de résultats
		// car la transition précédente peut ne pas avoir terminée correctement
		if (ctx.quizState.isSliding && ctx.isResultsSlideIndex(ctx.quizState.current)) {
			ctx.quizState.isSliding = false;
			ctx.setSlidingClass(false);
		}
		if (ctx.quizState.isSliding) return;

		let epoch = ctx.currentAsyncEpoch();

		ctx.closeHintModal();
		ctx.track.clearTrackTransitionFallback();
		ctx.viewport.destroyActiveSlideResizeObserver();
		ctx.viewport.destroyAllSlidesResizeObserver();
		ctx.viewport.destroyViewportResizeObserver();
		ctx.clearBackgroundWarmIdleHandle();
		ctx.cancelEnsureTrackVisibleRaf();

		ctx.quizState.isSliding = true;
		ctx.setSlidingClass(true);
		ctx.quizState.slideToken++;

		const OUT_VIEW_DUR = 560;
		const OUT_OVERLAY_DUR = 260;
		const OUT_OVERLAY_DELAY = 160;

		const IN_VIEW_DUR = 560;
		const IN_CARD_DUR = 560;
		const IN_OVERLAY_DUR = 300;

		const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
		const EASE_IN = "cubic-bezier(0.16, 1, 0.3, 1)";
		const OUT_TOTAL = Math.max(OUT_VIEW_DUR, OUT_OVERLAY_DELAY + OUT_OVERLAY_DUR);

		const body = document.body;
		const root = document.documentElement;
		const isLight =
			body?.classList.contains("theme-light") ||
			root?.classList.contains("theme-light");

		const viewport = ctx.container.querySelector<HTMLElement>(".quiz-track-viewport");
		const resultsSlide = ctx.container.querySelector<HTMLElement>('.quiz-track-item[data-slide-kind="results"]');
		const resultsCard = ctx.container.querySelector<HTMLElement>('.quiz-track-item[data-slide-kind="results"] .quiz-result');

		const prevContainerOverflow = ctx.container.style.overflow;
		const prevContainerPointerEvents = ctx.container.style.pointerEvents;
		const prevViewportOverflow = viewport ? viewport.style.overflow : "";

		ctx.container.style.overflow = "hidden";
		ctx.container.style.pointerEvents = "none";
		if (viewport) viewport.style.overflow = "hidden";

		const overlay = document.createElement("div");
		overlay.className = "quiz-restart-zoom-overlay";
		Object.assign(overlay.style, {
			position: "fixed",
			inset: "0",
			zIndex: "999999",
			pointerEvents: "none",
			opacity: "0",
			willChange: "opacity, backdrop-filter, -webkit-backdrop-filter",
			backdropFilter: "blur(0px)",
			webkitBackdropFilter: "blur(0px)",
			background: isLight ? "rgba(255,255,255,0.08)" : "rgba(2,6,23,0.10)"
		});
		body.appendChild(overlay);

		if (resultsSlide) {
			Object.assign(resultsSlide.style, {
				willChange: "transform, opacity, filter",
				transformOrigin: "center center",
				transition: "none",
				transform: "scale(1)",
				opacity: "1",
				filter: "blur(0px)"
			});
		}

		if (resultsCard) {
			Object.assign(resultsCard.style, {
				willChange: "transform, opacity, filter",
				transformOrigin: "center center",
				transition: "none",
				transform: "scale(1)",
				opacity: "1",
				filter: "blur(0px)"
			});
		}

		const cleanup = () => {
			try { overlay.remove(); } catch (_) {}

			const cleanupSelectors = [
				".quiz-track-viewport",
				'.quiz-track-item[data-slide-kind="results"]',
				'.quiz-track-item[data-slide-kind="results"] .quiz-result',
				'.quiz-track-item[data-slide-kind="question"][data-qi="0"]',
				'.quiz-track-item[data-slide-kind="question"][data-qi="0"] .quiz-card',
				'.quiz-track-item[data-slide-kind="question"][data-qi="0"] .quiz-actions'
			];

			cleanupSelectors.forEach(sel => {
				const el = ctx.container.querySelector<HTMLElement>(sel);
				if (!el) return;
				el.style.transition = "";
				el.style.transform = "";
				el.style.opacity = "";
				el.style.filter = "";
				el.style.willChange = "";
				el.style.transformOrigin = "";
			});

			const q1SlideCleanup = ctx.container.querySelector<HTMLElement>('.quiz-track-item[data-slide-kind="question"][data-qi="0"]');
			if (q1SlideCleanup) {
				delete q1SlideCleanup.dataset.quizTransitionLock;
			}

			const vp = ctx.container.querySelector<HTMLElement>(".quiz-track-viewport");
			if (vp) vp.style.overflow = prevViewportOverflow || "";

			ctx.container.style.overflow = prevContainerOverflow || "";
			ctx.container.style.pointerEvents = prevContainerPointerEvents || "";

			ctx.quizState.isSliding = false;
			ctx.setSlidingClass(false);

			ctx.viewport.syncTrackViewportIsolation();
			ctx.viewport.scheduleViewportHeightSync({ index: ctx.quizState.current, animate: false, refresh: true });
		};

		const outReady = await ctx.waitFrames(1, epoch);
		if (!outReady || !ctx.isQuizInstanceAlive(epoch)) {
			cleanup();
			return;
		}
		if (resultsSlide) {
			Object.assign(resultsSlide.style, {
				transition: `transform ${OUT_VIEW_DUR}ms ${EASE_OUT}, opacity ${OUT_VIEW_DUR}ms ${EASE_OUT}, filter ${OUT_VIEW_DUR}ms ${EASE_OUT}`,
				transform: "scale(0.965)",
				opacity: "0",
				filter: "blur(10px)"
			});
		}

		if (resultsCard) {
			Object.assign(resultsCard.style, {
				transition: `transform ${OUT_VIEW_DUR}ms ${EASE_OUT}, opacity ${OUT_VIEW_DUR}ms ${EASE_OUT}, filter ${OUT_VIEW_DUR}ms ${EASE_OUT}`,
				transform: "scale(0.94) translateY(8px)",
				opacity: "0",
				filter: "blur(8px)"
			});
		}

		Object.assign(overlay.style, {
			transition: `opacity ${OUT_OVERLAY_DUR}ms ${EASE_OUT} ${OUT_OVERLAY_DELAY}ms, backdrop-filter ${OUT_OVERLAY_DUR}ms ${EASE_OUT} ${OUT_OVERLAY_DELAY}ms, -webkit-backdrop-filter ${OUT_OVERLAY_DUR}ms ${EASE_OUT} ${OUT_OVERLAY_DELAY}ms`,
			opacity: "1",
			backdropFilter: "blur(12px)",
			webkitBackdropFilter: "blur(12px)"
		});

		const outTransitions = [
			resultsSlide ? { target: resultsSlide, properties: ["transform", "opacity", "filter"] } : null,
			resultsCard ? { target: resultsCard, properties: ["transform", "opacity", "filter"] } : null,
			{ target: overlay, properties: ["opacity"] }
		].filter(Boolean);

		const outOk = await waitForManagedTransitions(outTransitions, OUT_TOTAL + 120, epoch);
		if (!outOk || !ctx.isQuizInstanceAlive(epoch)) {
			cleanup();
			return;
		}
		ctx.resetQuiz({ preserveSliding: false });

		/* IMPORTANT :
		   render() a relancé restartAsyncLifecycle(),
		   donc l'ancien epoch n'est plus valide.
		   On repart sur le NOUVEL epoch. */
		epoch = ctx.currentAsyncEpoch();

		ctx.quizState.isSliding = false;
		ctx.setSlidingClass(false);

		if (ctx.__quizBootstrapRaf1) {
			cancelAnimationFrame(ctx.__quizBootstrapRaf1);
			ctx.__quizBootstrapRaf1 = 0;
		}
		if (ctx.__quizBootstrapRaf2) {
			cancelAnimationFrame(ctx.__quizBootstrapRaf2);
			ctx.__quizBootstrapRaf2 = 0;
		}
		ctx.cancelEnsureTrackVisibleRaf();

		const q1Slide = ctx.container.querySelector<HTMLElement>('.quiz-track-item[data-slide-kind="question"][data-qi="0"]');
		const q1Card = ctx.container.querySelector<HTMLElement>('.quiz-track-item[data-slide-kind="question"][data-qi="0"] .quiz-card');
		const q1Actions = ctx.container.querySelector<HTMLElement>('.quiz-track-item[data-slide-kind="question"][data-qi="0"] .quiz-actions');

		if (!q1Slide || !ctx.isQuizInstanceAlive(epoch)) {
			cleanup();
			return;
		}

		q1Slide.dataset.quizTransitionLock = "1";

		ctx.applyTrackPositionAndHeightInstant();
		ctx.viewport.primeAllSlideHeights({ retries: 4, syncCurrent: true });
		ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(0));
		ctx.settleViewportHeightToIndex(0, { animate: false, refresh: true });
		ctx.viewport.syncTrackViewportIsolation();

		void q1Slide.offsetWidth;
		if (q1Card) void q1Card.offsetWidth;
		if (q1Actions) void q1Actions.offsetWidth;

		Object.assign(q1Slide.style, {
			willChange: "transform, opacity, filter",
			transformOrigin: "center center",
			transition: "none",
			transform: "scale(0.965)",
			opacity: "0",
			filter: "blur(10px)"
		});

		if (q1Card) {
			Object.assign(q1Card.style, {
				willChange: "transform, opacity, filter",
				transformOrigin: "center center",
				transition: "none",
				transform: "scale(0.94) translateY(8px)",
				opacity: "0",
				filter: "blur(8px)"
			});
		}

		if (q1Actions) {
			Object.assign(q1Actions.style, {
				willChange: "transform, opacity, filter",
				transformOrigin: "center center",
				transition: "none",
				transform: "scale(0.94) translateY(8px)",
				opacity: "0",
				filter: "blur(8px)"
			});
		}

		void q1Slide.offsetWidth;
		if (q1Card) void q1Card.offsetWidth;
		if (q1Actions) void q1Actions.offsetWidth;

		const inReady = await ctx.waitFrames(2, epoch);
		if (!inReady || !ctx.isQuizInstanceAlive(epoch)) {
			cleanup();
			return;
		}

		Object.assign(overlay.style, {
			transition: `opacity ${IN_OVERLAY_DUR}ms ${EASE_IN}, backdrop-filter ${IN_OVERLAY_DUR}ms ${EASE_IN}, -webkit-backdrop-filter ${IN_OVERLAY_DUR}ms ${EASE_IN}`,
			opacity: "0",
			backdropFilter: "blur(0px)",
			webkitBackdropFilter: "blur(0px)"
		});

		Object.assign(q1Slide.style, {
			transition: `transform ${IN_VIEW_DUR}ms ${EASE_IN}, opacity ${IN_VIEW_DUR}ms ${EASE_IN}, filter ${IN_VIEW_DUR}ms ${EASE_IN}`,
			transform: "scale(1)",
			opacity: "1",
			filter: "blur(0px)"
		});

		if (q1Card) {
			Object.assign(q1Card.style, {
				transition: `transform ${IN_CARD_DUR}ms ${EASE_IN}, opacity ${IN_CARD_DUR}ms ${EASE_IN}, filter ${IN_CARD_DUR}ms ${EASE_IN}`,
				transform: "scale(1) translateY(0)",
				opacity: "1",
				filter: "blur(0px)"
			});
		}

		if (q1Actions) {
			Object.assign(q1Actions.style, {
				transition: `transform ${IN_CARD_DUR}ms ${EASE_IN}, opacity ${IN_CARD_DUR}ms ${EASE_IN}, filter ${IN_CARD_DUR}ms ${EASE_IN}`,
				transform: "scale(1) translateY(0)",
				opacity: "1",
				filter: "blur(0px)"
			});
		}

		const inTransitions = [
			{ target: overlay, properties: ["opacity"] },
			{ target: q1Slide, properties: ["transform", "opacity", "filter"] },
			q1Card ? { target: q1Card, properties: ["transform", "opacity", "filter"] } : null,
			q1Actions ? { target: q1Actions, properties: ["transform", "opacity", "filter"] } : null
		].filter(Boolean);

		await waitForManagedTransitions(
			inTransitions,
			Math.max(IN_VIEW_DUR, IN_CARD_DUR, IN_OVERLAY_DUR) + 140,
			epoch
		);

		cleanup();
	}

	return {
		waitForManagedTransitions,
		restartQuizWithZoomBlurTransition,
		applyOutFocusTransition,
		applyInFocusTransition
	};
}
