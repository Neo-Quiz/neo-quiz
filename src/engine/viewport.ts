import type { EngineCtx } from "../types/engine-ctx";

/**
 * Éléments DOM de la piste. `track.children` sont toujours les slides
 * `.quiz-track-item` (des div = HTMLElement) : là où le code lit `.style`/
 * `.dataset`/expandos, `Array.from(track.children)` est casté en `HTMLElement[]`
 * (cast honnête sur l'invariant réel, jamais `any`).
 */
export interface TrackElements {
	viewport: HTMLElement | null;
	track: HTMLElement | null;
}

export interface ViewportHandlers {
	getTrackElements(): TrackElements;
	getTrackItem(index?: number): HTMLElement | null;
	getTrackItems(): HTMLElement[];
	getViewportStableWidth(opts?: { refresh?: boolean }): number;
	applyTrackGeometry(opts?: { refreshWidth?: boolean }): number;
	getElementStableHeight(el: HTMLElement | null): number;
	getSlideStableHeight(index: number | undefined, opts?: { refresh?: boolean }): number;
	primeAllHeightsSync(opts?: { syncCurrent?: boolean }): void;
	primeAllSlideHeights(opts?: { retries?: number; syncCurrent?: boolean }): Promise<void>;
	scheduleViewportHeightSync(opts?: { delay?: number; index?: number; animate?: boolean; refresh?: boolean }): void;
	setViewportHeight(value: number, opts?: { animate?: boolean }): void;
	syncViewportHeight(opts?: { index?: number; animate?: boolean; refresh?: boolean }): boolean;
	observeTrackItemInAllSlidesResizeObserver(item: Element | null): void;
	unobserveTrackItemInAllSlidesResizeObserver(item: Element | null): void;
	bindAllSlidesResizeObserver(): void;
	destroyAllSlidesResizeObserver(): void;
	bindActiveSlideResizeObserver(): void;
	destroyActiveSlideResizeObserver(): void;
	bindCurrentSlideMediaHeightSync(): void;
	resyncCommandTextareasOnSlide(index: number): void;
	syncTrackViewportIsolation(): void;
	destroyViewportResizeObserver(): void;
	bindViewportResizeObserver(): void;
	getMaxRenderedSlideHeight(opts?: { refresh?: boolean; padding?: number }): number;
	__quizSlideHeightCache: Map<number, number>;
	__quizWarmSlidePromises: Map<number, Promise<unknown>>;
}

export function createViewportHandlers(ctx: EngineCtx): ViewportHandlers {
	// Variables locales
	let __quizHeightRaf = 0;
	let __quizHeightResyncTimer = 0;
	let __quizMediaSyncToken = 0;
	let __quizPrimeHeightsRaf = 0;
	let __quizActiveSlideResizeObserver: ResizeObserver | null = null;
	let __quizAllSlidesResizeObserver: ResizeObserver | null = null;
	let __quizViewportSettleTimer = 0;
	let __quizBackgroundWarmStarted = false;
	let __quizViewportResizeObserver: ResizeObserver | null = null;
	let __quizViewportResizeRaf = 0;
	let __quizViewportResizeSettleTimer = 0;
	let __quizBackgroundWarmIdleHandle = 0;
	let __quizBackgroundWarmIdleType = "";
	let __quizTrackViewportWidth = 0;
	let __quizTrackAppliedWidth = 0;
	let __quizTrackAppliedSlideCount = 0;
	let __quizEnsureVisibleRaf = 0;
	let __quizTrackFixBound = false;

	const __quizSlideHeightCache = new Map<number, number>();
	const __quizWarmSlidePromises = new Map<number, Promise<unknown>>();

	function getTrackElements(): TrackElements {
		return {
			viewport: ctx.container.querySelector<HTMLElement>(".quiz-track-viewport"),
			track: ctx.container.querySelector<HTMLElement>(".quiz-track")
		};
	}

	function getTrackItem(index: number = ctx.quizState.current): HTMLElement | null {
		const { track } = getTrackElements();
		// track.children[index] est une slide .quiz-track-item (HTMLElement).
		return track ? (track.children[index] as HTMLElement) || null : null;
	}

	function getTrackItems(): HTMLElement[] {
		const { track } = getTrackElements();
		return track ? (Array.from(track.children || []) as HTMLElement[]) : [];
	}

	function getViewportStableWidth({ refresh = false }: { refresh?: boolean } = {}): number {
		if (!refresh && __quizTrackViewportWidth > 0) return __quizTrackViewportWidth;
		const { viewport } = getTrackElements();
		const width = Math.max(1, Math.ceil(viewport?.clientWidth || viewport?.getBoundingClientRect?.().width || 0));
		__quizTrackViewportWidth = width;
		return width;
	}

	function applyTrackGeometry({ refreshWidth = false }: { refreshWidth?: boolean } = {}): number {
		const { track } = getTrackElements();
		const width = getViewportStableWidth({ refresh: refreshWidth });
		if (!track || !width) return width;
		const items = Array.from(track.children || []) as HTMLElement[];
		const childCount = items.length;
		let needsWrite = refreshWidth || __quizTrackAppliedWidth !== width || __quizTrackAppliedSlideCount !== childCount || track.style.width !== `${width * childCount}px`;
		if (!needsWrite) needsWrite = items.some(item => Number(item.__quizAppliedWidth || 0) !== width);
		if (!needsWrite) return width;
		track.style.width = `${width * childCount}px`;
		items.forEach(item => {
			item.style.flex = `0 0 ${width}px`;
			item.style.width = `${width}px`;
			item.style.minWidth = `${width}px`;
			item.style.maxWidth = `${width}px`;
			item.style.boxSizing = "border-box";
			item.__quizAppliedWidth = width;
		});
		__quizTrackAppliedWidth = width;
		__quizTrackAppliedSlideCount = childCount;
		return width;
	}

	function getElementStableHeight(el: HTMLElement | null): number {
		if (!el) return 0;
		const rootRect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
		/* A slide that scrolls on its own is as tall as its BOX, never its
		   content: the app's played quiz sizes each slide to the room between
		   its two bars and lets the question scroll inside
		   (apps/windows/src/assets/quiz-bars.css). Measured by its content,
		   the viewport would grow back to the whole question and push the
		   bar of arrows out of the panel. The plugin's slides never scroll. */
		const overflowY = getComputedStyle(el).overflowY;
		if (overflowY === "auto" || overflowY === "scroll") {
			return Math.max(1, Math.ceil(Math.max(rootRect ? rootRect.height : 0, el.offsetHeight || 0)));
		}
		const rootTop = rootRect ? rootRect.top : 0;
		let maxBottom = 0;
		const ownHeight = Math.max(
			Math.ceil(rootRect ? rootRect.height : 0),
			Math.ceil(el.scrollHeight || 0),
			Math.ceil(el.offsetHeight || 0),
			Math.ceil(el.clientHeight || 0),
			0
		);
		const nodes: Element[] = [el, ...Array.from(el.querySelectorAll("*"))];
		for (const node of nodes) {
			if (!(node instanceof HTMLElement)) continue;
			const cs = getComputedStyle(node);
			if (cs.display === "none" || cs.position === "fixed") continue;
			const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
			if (!rect) continue;
			const marginBottom = parseFloat(cs.marginBottom) || 0;
			const bottom = (rect.bottom - rootTop) + marginBottom;
			if (bottom > maxBottom) maxBottom = bottom;
		}
		return Math.max(1, Math.ceil(Math.max(ownHeight, maxBottom)));
	}

	function getSlideStableHeight(index: number | undefined, { refresh = false }: { refresh?: boolean } = {}): number {
		if (!refresh) {
			// index est fourni (number) par tous les appelants réels ; la
			// destructuration optionnelle `{ index }` de scheduleViewportHeightSync/
			// syncViewportHeight autorise `undefined` au type. Le cast préserve le
			// chemin runtime d'origine (get/set(undefined) — jamais atteint en pratique).
			const cached = __quizSlideHeightCache.get(index as number);
			if (cached) return cached;
		}
		const item = getTrackItem(index);
		if (!item) return 0;
		const height = getElementStableHeight(item);
		if (height > 0) __quizSlideHeightCache.set(index as number, height);
		return height;
	}

	function primeAllHeightsSync({ syncCurrent = true }: { syncCurrent?: boolean } = {}): void {
		const { track } = getTrackElements();
		if (!track) return;
		const children = Array.from(track.children || []) as HTMLElement[];
		const currentItem = getTrackItem(ctx.quizState.current);
		for (const child of children) {
			child.style.visibility = "visible";
			child.style.opacity = "1";
		}
		children.forEach((slide, idx) => {
			const h = getElementStableHeight(slide);
			if (h > 0) __quizSlideHeightCache.set(idx, h);
		});
		if (syncCurrent && currentItem) {
			const h = getSlideStableHeight(ctx.quizState.current, { refresh: true });
			if (h > 0) {
				const { viewport } = getTrackElements();
				if (viewport) {
					viewport.style.transition = "none";
					viewport.style.height = `${h}px`;
					viewport.style.minHeight = `${h}px`;
					viewport.dataset.quizHeightReady = "1";
				}
			}
		}
	}

	async function primeAllSlideHeights({ retries = 2, syncCurrent = true }: { retries?: number; syncCurrent?: boolean } = {}): Promise<void> {
		primeAllHeightsSync({ syncCurrent });
		for (let i = 0; i < retries; i++) {
			await ctx.nextFrame();
			primeAllHeightsSync({ syncCurrent });
		}
	}

	function scheduleViewportHeightSync({ delay = 0, index, animate = false, refresh = false }: { delay?: number; index?: number; animate?: boolean; refresh?: boolean } = {}): void {
		if (__quizHeightRaf) { cancelAnimationFrame(__quizHeightRaf); __quizHeightRaf = 0; }
		if (__quizHeightResyncTimer) { clearTimeout(__quizHeightResyncTimer); __quizHeightResyncTimer = 0; }

		const action = () => {
			if (ctx.__quizDestroyed) return;
			const targetHeight = getSlideStableHeight(index, { refresh });
			if (!targetHeight) return;
			const { viewport } = getTrackElements();
			if (!viewport) return;
			viewport.style.transition = animate ? "height 240ms cubic-bezier(0.22, 1, 0.36, 1)" : "none";
			viewport.style.height = `${targetHeight}px`;
			viewport.style.minHeight = `${targetHeight}px`;
			viewport.dataset.quizHeightReady = "1";
		};

		if (delay <= 0) {
			__quizHeightRaf = requestAnimationFrame(action);
		} else {
			__quizHeightResyncTimer = window.setTimeout(() => {
				__quizHeightResyncTimer = 0;
				__quizHeightRaf = requestAnimationFrame(action);
			}, delay);
		}
	}

	function setViewportHeight(value: number, { animate = false }: { animate?: boolean } = {}): void {
		const { viewport } = getTrackElements();
		if (!viewport) return;
		const h = Math.max(1, Math.ceil(value));
		viewport.style.setProperty('transition', animate ? 'height 240ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none', 'important');
		viewport.style.setProperty('height', `${h}px`, 'important');
		viewport.style.setProperty('min-height', `${h}px`, 'important');
		viewport.dataset.quizHeightReady = "1";
	}

	function syncViewportHeight({ index, animate = false, refresh = false }: { index?: number; animate?: boolean; refresh?: boolean } = {}): boolean {
		const targetHeight = getSlideStableHeight(index, { refresh });
		if (!targetHeight) return false;
		setViewportHeight(targetHeight, { animate });
		return true;
	}

	function getMaxRenderedSlideHeight({ refresh = false, padding = 0 }: { refresh?: boolean; padding?: number } = {}): number {
		const items = getTrackItems();
		if (!items.length) return 0;
		let maxHeight = 0;
		items.forEach((item, idx) => {
			const h = getSlideStableHeight(idx, { refresh });
			if (h > maxHeight) maxHeight = h;
		});
		return maxHeight + padding;
	}

	function observeTrackItemInAllSlidesResizeObserver(item: Element | null): void {
		if (!__quizAllSlidesResizeObserver || !item) return;
		try { __quizAllSlidesResizeObserver.observe(item); } catch (_) {}
	}

	function unobserveTrackItemInAllSlidesResizeObserver(item: Element | null): void {
		if (!__quizAllSlidesResizeObserver || !item) return;
		try { __quizAllSlidesResizeObserver.unobserve(item); } catch (_) {}
	}

	function bindAllSlidesResizeObserver(): void {
		destroyAllSlidesResizeObserver();
		if (typeof ResizeObserver === "undefined") return;
		const { track } = getTrackElements();
		if (!track) return;

		__quizAllSlidesResizeObserver = new ResizeObserver(entries => {
			const children = Array.from(track.children || []);
			for (const entry of entries) {
				const index = children.indexOf(entry.target);
				if (index === -1) continue;
				__quizSlideHeightCache.delete(index);
			}
		});

		const children = Array.from(track.children || []);
		children.forEach(child => {
			try { __quizAllSlidesResizeObserver!.observe(child); } catch (_) {}
		});
	}

	function destroyAllSlidesResizeObserver(): void {
		if (!__quizAllSlidesResizeObserver) return;
		try { __quizAllSlidesResizeObserver.disconnect(); } catch (_) {}
		__quizAllSlidesResizeObserver = null;
	}

	function bindActiveSlideResizeObserver(): void {
		destroyActiveSlideResizeObserver();
		if (typeof ResizeObserver === "undefined") return;
		const item = getTrackItem(ctx.quizState.current);
		if (!item) return;
		__quizActiveSlideResizeObserver = new ResizeObserver(() => {
			__quizSlideHeightCache.delete(ctx.quizState.current);
			scheduleViewportHeightSync({ index: ctx.quizState.current, animate: false, refresh: true });
		});
		try { __quizActiveSlideResizeObserver.observe(item); } catch (_) {}
	}

	function destroyActiveSlideResizeObserver(): void {
		if (!__quizActiveSlideResizeObserver) return;
		try { __quizActiveSlideResizeObserver.disconnect(); } catch (_) {}
		__quizActiveSlideResizeObserver = null;
	}

	function bindCurrentSlideMediaHeightSync(): void {
		const index = ctx.quizState.current;
		const item = getTrackItem(index);
		if (!item) return;
		const token = ++__quizMediaSyncToken;
		const generation = ctx.getSlideGeneration(index);
		item.querySelectorAll<HTMLImageElement>("img").forEach(img => {
			if (img.dataset.quizHeightBound === "1") return;
			img.dataset.quizHeightBound = "1";
			const resync = () => {
				if (token !== __quizMediaSyncToken || !ctx.isSlideGenerationCurrent(index, generation)) return;
				__quizSlideHeightCache.delete(index);
				scheduleViewportHeightSync({ index, animate: false, refresh: true });
			};
			img.addEventListener("load", resync, { once: true });
			img.addEventListener("error", resync, { once: true });
			if (img.complete) {
				if (typeof img.decode === "function") img.decode().then(resync).catch(resync);
				else resync();
			}
		});
	}

	function resyncCommandTextareasOnSlide(index: number): void {
		const item = getTrackItem(index);
		if (!item) return;
		item.querySelectorAll<HTMLElement>('.quiz-textarea-command').forEach(ta => {
			try { ta.dispatchEvent(new Event('scroll')); } catch (_) {}
		});
	}

	function syncTrackViewportIsolation(): void {
		const { viewport, track } = getTrackElements();
		if (!viewport || !track) return;

		applyTrackGeometry({ refreshWidth: false });

		if (viewport.dataset.quizIsoInit !== "1") {
			viewport.dataset.quizIsoInit = "1";
			viewport.style.position = "relative";
			viewport.style.overflow = "hidden";
			viewport.style.overflowX = "hidden";
			viewport.style.overflowY = "hidden";
			viewport.style.clipPath = "none";
			viewport.style.setProperty("-webkit-clip-path", "none");
			viewport.style.isolation = "isolate";
			viewport.style.contain = "layout style";
		}

		track.style.backfaceVisibility = "hidden";
		track.style.transformStyle = "preserve-3d";

		const items = (track.children ? Array.from(track.children) : []) as HTMLElement[];
		const { from, to } = ctx.getSlidingWindow();

		items.forEach((item, index) => {
			if (item.dataset.quizTrackItemInit !== "1") {
				item.dataset.quizTrackItemInit = "1";
				item.style.boxSizing = "border-box";
				item.style.overflow = "visible";
				item.style.contain = "layout style";
				item.style.transform = "none";
			}

			const transitionLocked = item.dataset.quizTransitionLock === "1";

			let mode = "idle-hidden";

			if (ctx.quizState.isSliding) {
				if (index >= from && index <= to) {
					if (index === ctx.quizState.prevCurrent) mode = "sliding-from";
					else if (index === ctx.quizState.current) mode = "sliding-to";
					else mode = "sliding-middle";
				}
			} else {
				mode = index === ctx.quizState.current ? "idle-active" : "idle-hidden";
			}

			item.dataset.quizIsoMode = mode;

			if (mode === "idle-hidden") {
				item.style.visibility = "hidden";
				if (!transitionLocked) item.style.opacity = "0";
				item.style.pointerEvents = "none";
				item.style.zIndex = "0";
				item.setAttribute("aria-hidden", "true");
				return;
			}

			if (mode === "idle-active") {
				item.style.visibility = "visible";
				if (!transitionLocked) item.style.opacity = "1";
				item.style.pointerEvents = "auto";
				item.style.zIndex = "2";
				item.setAttribute("aria-hidden", "false");
				return;
			}

			item.style.visibility = "visible";
			if (!transitionLocked) item.style.opacity = "1";
			item.style.pointerEvents = index === ctx.quizState.current ? "auto" : "none";
			item.style.zIndex = (index === ctx.quizState.prevCurrent || index === ctx.quizState.current) ? "1" : "0";
			item.setAttribute("aria-hidden", index === ctx.quizState.current ? "false" : "true");
		});
	}

	function destroyViewportResizeObserver(): void {
		if (__quizViewportResizeObserver) {
			try { __quizViewportResizeObserver.disconnect(); } catch (_) {}
			__quizViewportResizeObserver = null;
		}
		if (__quizViewportResizeRaf) {
			cancelAnimationFrame(__quizViewportResizeRaf);
			__quizViewportResizeRaf = 0;
		}
		if (__quizViewportResizeSettleTimer) {
			clearTimeout(__quizViewportResizeSettleTimer);
			__quizViewportResizeSettleTimer = 0;
		}
	}

	function bindViewportResizeObserver(): void {
		destroyViewportResizeObserver();
		if (typeof ResizeObserver === "undefined") return;
		const { viewport } = getTrackElements();
		if (!viewport) return;
		let lastWidth = Math.round(viewport.getBoundingClientRect().width || viewport.clientWidth || 0);

		const realignViewportAndTrack = ({ settle = false }: { settle?: boolean } = {}) => {
			const { track, viewport: vp } = getTrackElements();
			if (!track || !vp) return;
			applyTrackGeometry({ refreshWidth: true });
			if (ctx.quizState.isSliding) {
				const snapshot = ctx.track.cancelRunningTrackAnimation();
				ctx.track.animateTrackToIndex(ctx.quizState.current, { fromX: snapshot.x, fromHeight: snapshot.height, refreshTargetHeight: true });
				return;
			}
			track.style.transition = "none";
			track.style.willChange = "";
			track.style.backfaceVisibility = "hidden";
			track.style.transformStyle = "preserve-3d";
			ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(ctx.quizState.current));
			__quizSlideHeightCache.delete(ctx.quizState.current);
			syncViewportHeight({ index: ctx.quizState.current, animate: false, refresh: true });
			primeAllSlideHeights({ retries: settle ? 4 : 2, syncCurrent: true });
			bindCurrentSlideMediaHeightSync();
			bindActiveSlideResizeObserver();
			resyncCommandTextareasOnSlide(ctx.quizState.current);
			ctx.updateNavHighlight();
		};

		__quizViewportResizeObserver = new ResizeObserver(entries => {
			const entry = entries[0];
			if (!entry) return;
			const rect = entry.contentRect || viewport.getBoundingClientRect();
			const width = Math.round(rect.width || viewport.clientWidth || 0);
			if (width === lastWidth) return;
			lastWidth = width;
			if (__quizViewportResizeRaf) {
				cancelAnimationFrame(__quizViewportResizeRaf);
				__quizViewportResizeRaf = 0;
			}
			if (__quizViewportResizeSettleTimer) {
				clearTimeout(__quizViewportResizeSettleTimer);
				__quizViewportResizeSettleTimer = 0;
			}
			__quizViewportResizeRaf = requestAnimationFrame(() => {
				__quizViewportResizeRaf = 0;
				realignViewportAndTrack({ settle: false });
			});
			__quizViewportResizeSettleTimer = window.setTimeout(() => {
				__quizViewportResizeSettleTimer = 0;
				realignViewportAndTrack({ settle: true });
			}, 340);
		});
		try { __quizViewportResizeObserver.observe(viewport); } catch (_) {}
	}

	return {
		getTrackElements,
		getTrackItem,
		getTrackItems,
		getViewportStableWidth,
		applyTrackGeometry,
		getElementStableHeight,
		getSlideStableHeight,
		primeAllHeightsSync,
		primeAllSlideHeights,
		scheduleViewportHeightSync,
		setViewportHeight,
		syncViewportHeight,
		observeTrackItemInAllSlidesResizeObserver,
		unobserveTrackItemInAllSlidesResizeObserver,
		bindAllSlidesResizeObserver,
		destroyAllSlidesResizeObserver,
		bindActiveSlideResizeObserver,
		destroyActiveSlideResizeObserver,
		bindCurrentSlideMediaHeightSync,
		resyncCommandTextareasOnSlide,
		syncTrackViewportIsolation,
		destroyViewportResizeObserver,
		bindViewportResizeObserver,
		getMaxRenderedSlideHeight,
		__quizSlideHeightCache,
		__quizWarmSlidePromises
	};
}
