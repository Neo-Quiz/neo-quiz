import type { EngineCtx } from "../types/engine-ctx";

/** Instantané position/hauteur retourné par cancelRunningTrackAnimation. */
export interface TrackSnapshot {
	x: number;
	height: number;
}

export interface TrackHandlers {
	getSlideTranslateX(index?: number): number;
	setTrackTransformPx(x: number): void;
	readCurrentTrackTranslateX(): number;
	primeTrackAndViewportForSlideStart(startX: number, lockedHeight: number): void;
	clearTrackTransitionFallback(): void;
	cancelRunningTrackAnimation(): TrackSnapshot;
	slideDuration(dist: number): number;
	getTrackEaseForDistance(hops: number): string;
	finishTrackSlideAnimation(token: number, targetIndex: number): void;
	animateTrackToIndex(targetIndex: number, opts?: { fromX?: number | null; fromHeight?: number | null; refreshTargetHeight?: boolean }): void;
}

import { SETTLE_EASING } from "../swipe";

export function createTrackHandlers(ctx: EngineCtx): TrackHandlers {
	// Variables locales
	let __quizTrackTransitionFallbackTimer = 0;

	const alignToDevicePixel = (value: number | null): number => {
		const dpr = window.devicePixelRatio || 1;
		return Math.round((Number(value) || 0) * dpr) / dpr;
	};

	function getSlideTranslateX(index: number = ctx.quizState.current): number {
		const { viewport, track } = ctx.viewport.getTrackElements();
		if (!viewport || !track) return 0;
		return alignToDevicePixel(-(ctx.viewport.getViewportStableWidth() * index));
	}

	function setTrackTransformPx(x: number): void {
		const { track } = ctx.viewport.getTrackElements();
		if (track) track.style.transform = `translate3d(${alignToDevicePixel(x)}px, 0, 0)`;
	}

	function readCurrentTrackTranslateX(): number {
		const { track } = ctx.viewport.getTrackElements();
		if (!track) return getSlideTranslateX(ctx.quizState.current);
		try {
			const computed = getComputedStyle(track).transform;
			if (!computed || computed === "none") return getSlideTranslateX(ctx.quizState.current);
			const matrix = new DOMMatrix(computed);
			return Number.isFinite(matrix.m41) ? alignToDevicePixel(matrix.m41) : getSlideTranslateX(ctx.quizState.current);
		} catch (_) {
			return getSlideTranslateX(ctx.quizState.current);
		}
	}

	function primeTrackAndViewportForSlideStart(startX: number, lockedHeight: number): void {
		const { track, viewport } = ctx.viewport.getTrackElements();
		if (!track || !viewport) return;
		ctx.viewport.applyTrackGeometry({ refreshWidth: true });
		const safeHeight = Math.max(1, Math.ceil(lockedHeight));
		track.style.transition = "none";
		track.style.willChange = "transform";
		setTrackTransformPx(startX);
		viewport.style.transition = "none";
		viewport.style.willChange = "height";
		viewport.style.height = `${safeHeight}px`;
		viewport.style.minHeight = `${safeHeight}px`;
		viewport.dataset.quizHeightReady = "1";
		viewport.__quizLockedHeight = safeHeight;
		void track.offsetWidth;
		void viewport.offsetHeight;
	}

	function clearTrackTransitionFallback(): void {
		if (__quizTrackTransitionFallbackTimer) {
			clearTimeout(__quizTrackTransitionFallbackTimer);
			__quizTrackTransitionFallbackTimer = 0;
		}
	}

	function cancelRunningTrackAnimation(): TrackSnapshot {
		const { track, viewport } = ctx.viewport.getTrackElements();
		clearTrackTransitionFallback();
		const currentX = readCurrentTrackTranslateX();
		const currentHeight = Math.max(
			1,
			Math.ceil(parseFloat(getComputedStyle(viewport || document.body).height) || 0),
			Math.ceil(viewport?.getBoundingClientRect?.().height || 0),
			Math.ceil(viewport?.clientHeight || 0)
		);

		if (track) {
			if (track.__quizTransitionEndHandler) {
				track.removeEventListener("transitionend", track.__quizTransitionEndHandler);
				track.__quizTransitionEndHandler = null;
			}
			try { track.getAnimations?.().forEach(anim => anim.cancel?.()); } catch (_) {}
			track.style.transition = "none";
			track.style.willChange = "";
			setTrackTransformPx(currentX);
		}
		if (viewport) {
			try { viewport.getAnimations?.().forEach(anim => anim.cancel?.()); } catch (_) {}
			viewport.style.transition = "none";
			viewport.style.willChange = "";
			viewport.style.height = `${currentHeight}px`;
			viewport.style.minHeight = "";
			viewport.dataset.quizHeightReady = "1";
			delete viewport.dataset.quizGrowDuringSlide;
		}
		ctx.quizState.isSliding = false;
		ctx.setSlidingClass(false);
		return { x: currentX, height: currentHeight };
	}

	function slideDuration(dist: number): number {
		// DEBUG: temporarily disable prefers-reduced-motion check
		// if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;
		const d = Math.max(1, Number(dist) || 1);
		return Math.min(1200, 860 + (d - 3) * 90);
	}

	function getTrackEaseForDistance(hops: number): string {
		if (hops <= 1) return "cubic-bezier(0.22, 0.88, 0.24, 1)";
		if (hops <= 3) return "cubic-bezier(0.24, 0.84, 0.22, 1)";
		return "cubic-bezier(0.26, 0.80, 0.20, 1)";
	}

	function finishTrackSlideAnimation(token: number, targetIndex: number): void {
		if (token !== ctx.quizState.slideToken) return;
		const { track, viewport } = ctx.viewport.getTrackElements();
		const shouldLockResultsNow = ctx.isResultsSlideIndex(targetIndex) && ctx.quizState.pendingResultsLock && !ctx.textOnly?.isTextOnlyMode?.();
		const grewDuringSlide = viewport?.dataset.quizGrowDuringSlide === "1";
		clearTrackTransitionFallback();
		if (track && track.__quizTransitionEndHandler) {
			track.removeEventListener("transitionend", track.__quizTransitionEndHandler);
			track.__quizTransitionEndHandler = null;
		}
		try { track?.getAnimations?.().forEach(anim => anim.cancel?.()); } catch (_) {}
		try { viewport?.getAnimations?.().forEach(anim => anim.cancel?.()); } catch (_) {}

		// __quizTargetX est un number fini dès qu'il a été posé par animateTrackToIndex
		// (et track non-null dans ce cas) : le cast reflète cet invariant vérifié par
		// Number.isFinite, iso-fonctionnel avec le JS d'origine (`track.__quizTargetX`).
		const targetXExpando = track?.__quizTargetX;
		const finalX = Number.isFinite(targetXExpando) ? (targetXExpando as number) : getSlideTranslateX(targetIndex);
		const refreshedTargetHeight = Math.max(
			1,
			Number(viewport?.__quizTargetHeight) || 0,
			ctx.viewport.getSlideStableHeight(targetIndex, { refresh: true }) || 0,
			ctx.viewport.getElementStableHeight(ctx.viewport.getTrackItem(targetIndex)) || 0
		);
		/* The exact height, never a few pixels more: the settle two frames
		   later lands on the exact height anyway, and those extra 4 px made the
		   panel scrollable for one frame at the end of EVERY move (2026-09-28)
		   — a scrollbar and the bottom bar's glass flashed each time. */
		const finalHeight = Math.max(1, Math.ceil(refreshedTargetHeight));

		if (track) {
			track.style.transition = "none";
			track.style.willChange = "";
			setTrackTransformPx(finalX);
		}
		if (viewport) {
			viewport.style.transition = "none";
			viewport.style.willChange = "";
			viewport.style.height = `${finalHeight}px`;
			viewport.style.minHeight = "";
			viewport.dataset.quizHeightReady = "1";
			delete viewport.dataset.quizGrowDuringSlide;
		}
		if (!shouldLockResultsNow) {
			ctx.quizState.isSliding = false;
			ctx.setSlidingClass(false);
		}
		if (shouldLockResultsNow) {
				ctx.quizState.locked = true;
				ctx.container?.classList?.add("quiz-is-locked");
			}
		if (!ctx.isResultsSlideIndex(targetIndex)) ctx.quizState.pendingResultsLock = false;
		ctx.updateNavHighlight();

		requestAnimationFrame(() => requestAnimationFrame(() => {
			if (token !== ctx.quizState.slideToken || ctx.__quizDestroyed) return;
			ctx.viewport.syncTrackViewportIsolation();
			ctx.settleViewportHeightToIndex(targetIndex, { animate: false, refresh: true });
			ctx.viewport.scheduleViewportHeightSync({ delay: grewDuringSlide ? 180 : 320, index: targetIndex, animate: false, refresh: true });
			ctx.viewport.primeAllSlideHeights({ retries: 2, syncCurrent: false });
			if (shouldLockResultsNow) {
				ctx.quizState.pendingResultsLock = false;
				requestAnimationFrame(() => {
					if (token !== ctx.quizState.slideToken || ctx.__quizDestroyed) return;
					ctx.quizState.isSliding = false;
					ctx.setSlidingClass(false);
					ctx.render();
				});
				return;
			}
			ctx.viewport.bindCurrentSlideMediaHeightSync();
			ctx.viewport.bindActiveSlideResizeObserver();
			ctx.viewport.resyncCommandTextareasOnSlide(targetIndex);
		}));
	}

	function animateTrackToIndex(targetIndex: number, { fromX = null, fromHeight = null, refreshTargetHeight = true }: { fromX?: number | null; fromHeight?: number | null; refreshTargetHeight?: boolean } = {}): void {
		const { track, viewport } = ctx.viewport.getTrackElements();
		if (!track || !viewport) {
			ctx.quizState.isSliding = false;
			ctx.setSlidingClass(false);
			return;
		}
		clearTrackTransitionFallback();
		ctx.viewport.destroyActiveSlideResizeObserver();
		ctx.quizState.isSliding = true;
		ctx.setSlidingClass(true);
		ctx.viewport.syncTrackViewportIsolation();
		ctx.viewport.applyTrackGeometry({ refreshWidth: true });
		const token = ctx.quizState.slideToken;
		const targetX = getSlideTranslateX(targetIndex);
		const startX = Number.isFinite(fromX) ? alignToDevicePixel(fromX) : readCurrentTrackTranslateX();
		const startHeight = Math.max(
			1,
			Number(fromHeight) || 0,
			ctx.viewport.getSlideStableHeight(ctx.quizState.prevCurrent, { refresh: true }) || 0,
			ctx.viewport.getElementStableHeight(ctx.viewport.getTrackItem(ctx.quizState.prevCurrent)) || 0,
			Math.ceil(viewport.getBoundingClientRect().height || 0),
			Math.ceil(viewport.clientHeight || 0)
		);
		const targetHeight = Math.max(
			1,
			ctx.viewport.getSlideStableHeight(targetIndex, { refresh: refreshTargetHeight }) || 0,
			ctx.viewport.getElementStableHeight(ctx.viewport.getTrackItem(targetIndex)) || 0,
			startHeight
		);
		/* Locked to the taller of the two slides that matter, the one left and
		   the one reached — never to the tallest slide of the whole quiz
		   (2026-09-28). That lock made every move, even to a short question,
		   as tall as the quiz's longest reading for the length of the slide:
		   the page became scrollable for a second, then shrank back. A taller
		   slide passing in between may be cut at the bottom while it crosses;
		   in the app every slide fills the panel, so that cut falls below the
		   visible edge. */
		const lockedHeight = Math.max(1, Math.ceil(startHeight), Math.ceil(targetHeight));
		const deltaPx = Math.abs(targetX - startX);
		const viewportWidth = Math.max(1, viewport.clientWidth || Math.ceil(viewport.getBoundingClientRect().width) || 1);
		const dist = Math.max(1, deltaPx / viewportWidth);
		const swipeMs = ctx.quizState.swipeSettleMs ?? null;
		ctx.quizState.swipeSettleMs = null;
		const dur = swipeMs ?? slideDuration(dist);
		const trackEase = swipeMs != null ? SETTLE_EASING : getTrackEaseForDistance(dist);

		track.__quizTargetX = targetX;
		track.__quizTargetIndex = targetIndex;
		viewport.__quizTargetHeight = targetHeight;
		viewport.__quizLockedHeight = lockedHeight;
		viewport.dataset.quizGrowDuringSlide = "0";

		if (dur <= 0) {
			setTrackTransformPx(targetX);
			ctx.viewport.setViewportHeight(targetHeight, { animate: false });
			viewport.style.minHeight = "";
			finishTrackSlideAnimation(token, targetIndex);
			return;
		}

		primeTrackAndViewportForSlideStart(startX, lockedHeight);
		requestAnimationFrame(() => {
			if (token !== ctx.quizState.slideToken) return;
			const { track: liveTrack, viewport: liveViewport } = ctx.viewport.getTrackElements();
			if (!liveTrack || !liveViewport) return;
			liveViewport.style.transition = "none";
			liveViewport.style.willChange = "height";
			liveViewport.style.height = `${lockedHeight}px`;
			liveViewport.style.minHeight = `${lockedHeight}px`;
			liveViewport.dataset.quizHeightReady = "1";
			liveViewport.__quizLockedHeight = lockedHeight;
			liveTrack.style.transition = `transform ${dur}ms ${trackEase}`;
			setTrackTransformPx(targetX);
		});

		const onEnd = (e: TransitionEvent) => {
			if (token !== ctx.quizState.slideToken || e.target !== track || e.propertyName !== "transform") return;
			finishTrackSlideAnimation(token, targetIndex);
		};
		track.__quizTransitionEndHandler = onEnd;
		track.addEventListener("transitionend", onEnd);
		__quizTrackTransitionFallbackTimer = window.setTimeout(() => finishTrackSlideAnimation(token, targetIndex), dur + 160);
	}

	return {
		getSlideTranslateX,
		setTrackTransformPx,
		readCurrentTrackTranslateX,
		primeTrackAndViewportForSlideStart,
		clearTrackTransitionFallback,
		cancelRunningTrackAnimation,
		slideDuration,
		getTrackEaseForDistance,
		finishTrackSlideAnimation,
		animateTrackToIndex
	};
}
