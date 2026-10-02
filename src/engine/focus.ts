import type { EngineCtx } from "../types/engine-ctx";

interface QuestionFocusDescriptor {
	/** Empty when focus was on a control without a stable selector. */
	selector: string;
	/** FALLBACK targets, in order, for when `selector` is gone from the new
	    render (the hint button after its last level). */
	fallbacks?: string[];
	scrollX: number;
	scrollY: number;
}

/** Entrée brute passée à waitForManagedTransitions : soit un Element, soit un couple {target, properties}. */
type ManagedTransitionInput = Element | { target?: Element | null; properties?: string[] } | null | undefined;

interface ManagedTransitionEntry {
	target: Element;
	properties: Set<string> | null;
}

function isManagedTransitionElement(value: ManagedTransitionInput): value is Element {
	return typeof Element !== "undefined" && value instanceof Element;
}

export interface FocusHandlers {
	getQuestionFocusDescriptor(rootEl: Element | null | undefined): QuestionFocusDescriptor | null;
	restoreQuestionFocus(rootEl: Element | null | undefined, descriptor: QuestionFocusDescriptor | null | undefined): void;
	waitForManagedTransitions(entries: ManagedTransitionInput[] | null | undefined, fallbackMs: number, epoch?: number): Promise<boolean>;
}

export function createFocusHandlers(ctx: EngineCtx): FocusHandlers {
	/* Focus restorations still waiting for their animation frame, by question
	   index. One answer can repaint a card TWICE in a row (a click repaints,
	   then Learn checks the answer and repaints again, all in one task): the
	   second repaint then finds focus on <body> (the first one detached the
	   pressed option and its restoration has not run yet), would capture
	   nothing, and the first restoration would aim at a card already replaced.
	   The keyboard (bound on the quiz container) was dead until the next Tab.
	   The intent is therefore carried from one repaint to the next, and the
	   restoration always looks the card up when it runs. */
	const pendingRestores = new Map<string, QuestionFocusDescriptor>();

	function getQuestionFocusDescriptor(rootEl: Element | null | undefined): QuestionFocusDescriptor | null {
		const active = document.activeElement;
		if (!rootEl) return null;
		const key = (rootEl as HTMLElement).dataset?.qi ?? "";
		if (!active || !rootEl.contains(active)) {
			// Focus fell to <body> because of a repaint whose restoration is
			// still pending: carry that intent over. Never when the user moved
			// focus to another element.
			if (key && (!active || active === document.body)) return pendingRestores.get(key) ?? null;
			return null;
		}

		const descriptor: { selector: string | null; fallbacks?: string[]; scrollX: number; scrollY: number } = {
			selector: null,
			scrollX: window.scrollX || window.pageXOffset || 0,
			scrollY: window.scrollY || window.pageYOffset || 0
		};

		// active est un HTMLElement dans tous les cas réels (options/boutons du
		// quiz) : .dataset est utilisé ci-dessous comme dans le JS original.
		const activeEl = active as HTMLElement;

		if (activeEl.matches?.('.quiz-option[data-orig]')) {
			descriptor.selector = `.quiz-option[data-orig="${activeEl.dataset.orig}"]`;
		}
		else if (activeEl.matches?.('[data-order-item]')) {
			descriptor.selector = `[data-order-item="${activeEl.dataset.orderItem}"]`;
		}
		else if (activeEl.matches?.('[data-order-slot]')) {
			descriptor.selector = `[data-order-slot="${activeEl.dataset.orderSlot}"]`;
		}
		else if (activeEl.matches?.('[data-match-choice]')) {
			descriptor.selector = `[data-match-choice="${activeEl.dataset.matchChoice}"]`;
		}
		else if (activeEl.matches?.('[data-match-slot]')) {
			descriptor.selector = `[data-match-slot="${activeEl.dataset.matchSlot}"]`;
		}
		else if (activeEl.matches?.('.quiz-textarea[data-text-answer]')) {
			descriptor.selector = '.quiz-textarea[data-text-answer]';
		}
		else if (activeEl.matches?.('.quiz-textonly-textarea[data-textonly-answer]')) {
			descriptor.selector = '.quiz-textonly-textarea[data-textonly-answer]';
		}
		/* « Retourner » d'une carte mémoire DISPARAÎT au verso : le rechercher
		   par son sélecteur laissait le focus tomber sur <body>, hors du quiz,
		   et les touches 1 et 2 ne répondaient plus après un clic. Le focus
		   passe à l'action suivante, « Je savais » (spec cartes mémoire §3). */
		else if (activeEl.matches?.('.quiz-flashcard-flip-btn')) {
			descriptor.selector = '.quiz-textonly-rating-btn[data-textonly-rating="understood"]';
		}
		else if (activeEl.matches?.('.quiz-textonly-check-btn')) {
			descriptor.selector = '.quiz-textonly-check-btn';
		}
		else if (activeEl.matches?.('.quiz-textonly-rating-btn[data-textonly-rating]')) {
			descriptor.selector = `.quiz-textonly-rating-btn[data-textonly-rating="${activeEl.dataset.textonlyRating}"]`;
		}
		/* INDICE À NIVEAUX (revue du lot B, 2026-09-27) : tant qu'il reste un
		   niveau, le focus RESTE sur le bouton (« Indice suivant ») — au clavier,
		   on enchaîne les niveaux sans retabuler. Après le dernier, le bouton
		   disparaît : le focus passe au niveau qui vient d'être révélé, pour
		   qu'un lecteur d'écran le lise, puis à « Je ne sais pas ». */
		else if (activeEl.matches?.('.quiz-hint-btn')) {
			descriptor.selector = '.quiz-hint-btn';
			descriptor.fallbacks = ['.quiz-hint-inline[data-hint-dernier]', '.quiz-lesson-dontknow-btn'];
		}
		else if (activeEl.matches?.('.quiz-prev-btn')) {
			descriptor.selector = '.quiz-prev-btn';
		}
		else if (activeEl.matches?.('.quiz-next-btn')) {
			descriptor.selector = '.quiz-next-btn';
		}
		else if (activeEl.matches?.('.quiz-resource-btn')) {
			descriptor.selector = '.quiz-resource-btn';
		}

		// Focus was inside the card but on a control we have no selector for
		// (or one that disappears, e.g. the self-rating buttons after a
		// verdict): keep an empty selector so restoreQuestionFocus can still
		// hand focus to the new card instead of letting it fall to <body>.
		return { selector: descriptor.selector ?? "", fallbacks: descriptor.fallbacks, scrollX: descriptor.scrollX, scrollY: descriptor.scrollY };
	}

	function restoreQuestionFocus(rootEl: Element | null | undefined, descriptor: QuestionFocusDescriptor | null | undefined): void {
		if (!rootEl || !descriptor) return;
		let root: Element = rootEl;
		const key = (rootEl as HTMLElement).dataset?.qi ?? "";
		if (key) pendingRestores.set(key, descriptor);
		requestAnimationFrame(() => {
			if (ctx.__quizDestroyed) return;
			// A later repaint took over this restoration: it will run its own.
			if (key) {
				if (pendingRestores.get(key) !== descriptor) return;
				pendingRestores.delete(key);
				// The card captured at repaint time may have been replaced since.
				root = ctx.container.querySelector<HTMLElement>(`.quiz-track-item[data-slide-kind="question"][data-qi="${key}"]`) ?? root;
			}
			let target = [descriptor.selector, ...(descriptor.fallbacks ?? [])]
				.filter(Boolean)
				.map(s => root.querySelector<HTMLElement>(s))
				.find((el): el is HTMLElement => !!el) ?? null;
			if (!target) {
				// The focused control is gone. Keep the keyboard alive (the arrow
				// keys are bound on the quiz container) by focusing the new card
				// itself, but only when focus really fell to <body>: never steal
				// it from an element the user moved to outside the quiz.
				const active = document.activeElement;
				if (active && active !== document.body) return;
				target = focusableCard(root);
				if (!target) return;
			}
			if (typeof target.focus !== "function") return;
			try { target.focus({ preventScroll: true }); } catch (_) { try { target.focus(); } catch (_) {} }
			// The selector matched but the element cannot take focus (a locked
			// option, a disabled button): focus() did nothing and the keyboard
			// would be lost on <body>. Hand it to the card instead.
			if (document.activeElement === document.body) {
				const card = focusableCard(root);
				if (card) { try { card.focus({ preventScroll: true }); } catch (_) {} }
			}
			try { window.scrollTo(descriptor.scrollX ?? 0, descriptor.scrollY ?? 0); } catch (_) {}
		});
	}

	/** The card itself as a focus target (the arrow keys are bound on the quiz
	    container, so any focus inside it keeps them alive). */
	function focusableCard(root: Element): HTMLElement | null {
		if (!root.isConnected || !(root instanceof HTMLElement)) return null;
		if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
		root.style.outline = "none";
		return root;
	}

	function waitForManagedTransitions(entries: ManagedTransitionInput[] | null | undefined, fallbackMs: number, epoch: number = ctx.currentAsyncEpoch()): Promise<boolean> {
		const normalized = (entries || [])
			.map((entry): ManagedTransitionEntry | null => {
				if (!entry) return null;
				if (isManagedTransitionElement(entry)) return { target: entry, properties: null };
				const target = entry.target || null;
				const properties = Array.isArray(entry.properties) && entry.properties.length > 0 ? new Set<string>(entry.properties) : null;
				return target ? { target, properties } : null;
			})
			.filter((entry): entry is ManagedTransitionEntry => entry !== null);
		if (normalized.length === 0) return Promise.resolve(ctx.isQuizInstanceAlive(epoch));

		let timer = 0;
		const waiter = ctx.createPendingAsyncWaiter(() => { if (timer) clearTimeout(timer); });
		const startTime = Date.now();

		const checkDone = (): void => {
			if (!ctx.isQuizInstanceAlive(epoch)) {
				waiter.resolve(false);
				return;
			}

			const pending = normalized.filter(({ target, properties }) => {
				if (!target || typeof target.getAnimations !== "function") return false;
				return target.getAnimations().some(anim => {
					// propertyName n'est pas déclaré sur Animation (seulement sur
					// TransitionEvent côté types DOM) mais est bien présent au
					// runtime pour les transitions CSS — comportement préservé tel quel.
					const propertyName = (anim as Animation & { propertyName?: string }).propertyName;
					if (properties && !(propertyName !== undefined && properties.has(propertyName))) return false;
					return anim.playState === "running";
				});
			});

			if (pending.length === 0) {
				waiter.resolve(true);
				return;
			}

			if (Date.now() - startTime > fallbackMs) {
				waiter.resolve(true);
				return;
			}

			requestAnimationFrame(checkDone);
		};

		timer = window.setTimeout(() => {
			waiter.resolve(ctx.isQuizInstanceAlive(epoch));
		}, fallbackMs);

		checkDone();
		return waiter.promise;
	}

	return {
		getQuestionFocusDescriptor,
		restoreQuestionFocus,
		waitForManagedTransitions
	};
}
