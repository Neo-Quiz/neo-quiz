import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { t } from "../i18n";
import { hapticTick } from "../swipe";
import type { QuizIndexEntry } from "./scanner";
import {
	EMPTY_SELECTION, canShare, clear, clickAction, extendTo, hasSelection, inPageOrder, isSelected,
	keyAction, LONG_PRESS_MS, pressVerdict, prune, selectAll, toggle,
} from "./selection";
import type { Selection } from "./selection";

/* ══════════════════════════════════════════════════════════
   THE SELECTION OF A FOLDER PAGE, ON SCREEN (2026-10-07). The rules are in
   `selection.ts` (pure, `check:selection`); this module turns events into
   those calls and paints the result:

   - Ctrl+click / Cmd+click toggles a card, Shift+click extends a range, a
     plain click still opens the quiz;
   - on a phone a long press (450 ms, finger within 10 px) enters selection
     mode, then a tap toggles a card; the click that ends the long press is
     swallowed, so the quiz does not open under the finger;
   - Escape, Cancel, or a click on empty space empties the selection; Android's
     Back key does the same first (`retour-android.ts` clicks the Cancel
     button of a visible bar);
   - while something is selected an action bar shows the count and "Share",
     "Select all", "Cancel".

   The selection outlives a re-render of the page (a sync, a stats refresh):
   it is kept per folder and pruned against the cards still shown.
══════════════════════════════════════════════════════════ */

export interface SelectionCard {
	/** The path of the card's first quiz. */
	id: string;
	el: HTMLElement;
	/** Every quiz the card stands for (a course gathers its modes). */
	quizzes: QuizIndexEntry[];
}

export interface SelectionViewDeps {
	/** The folder: a selection is only kept for the folder it was made in. */
	scope: string;
	/** Where the action bar goes (the folder page). */
	host: HTMLElement;
	onShare: (quizzes: QuizIndexEntry[]) => void;
}

export interface SelectionView {
	add(card: SelectionCard): void;
	/** All the cards are added: prune the remembered selection and paint. */
	ready(): void;
	destroy(): void;
}

let active: SelectionView | null = null;
let remembered: { scope: string; sel: Selection } | null = null;

/** Forgets the selection (leaving the folder page). */
export function resetSelection(): void {
	active?.destroy();
	active = null;
	remembered = null;
}

/** What is not "empty space": a click on one of these never empties the selection. */
const INTERACTIVE = "button, a, input, textarea, select, label, [role=button], .qbd-quiz-card, .qbd-sel-bar, .modal-container, .qbd-select-menu";

export function createSelectionView(deps: SelectionViewDeps): SelectionView {
	active?.destroy();
	const cards: SelectionCard[] = [];
	const cleanups: (() => void)[] = [];
	let sel: Selection = remembered && remembered.scope === deps.scope ? remembered.sel : EMPTY_SELECTION;
	let swallowClick = false;
	let destroyed = false;

	const order = (): string[] => cards.map(c => c.id);

	// ── The action bar ──
	const bar = ajouter(deps.host, "div", "qbd-sel-bar");
	bar.setAttribute("role", "toolbar");
	bar.setAttribute("aria-label", t("share.select.bar"));
	bar.title = t("share.choose.wholeNote");
	bar.hidden = true;
	const count = ajouter(bar, "span", "qbd-sel-count");
	count.setAttribute("aria-live", "polite");
	const actions = ajouter(bar, "div", "qbd-sel-actions");
	const button = (cls: string, icon: string, label: string, onClick: () => void): HTMLButtonElement => {
		const b = ajouter(actions, "button", `qbd-sel-btn ${cls}`);
		b.type = "button";
		currentHost().ui.setIcon(ajouter(b, "span", "qbd-sel-btn-icon"), icon);
		ajouter(b, "span", "qbd-sel-btn-label", label);
		b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
		return b;
	};
	const shareBtn = button("qbd-sel-share", "share-2", t("share.select.share"), () => {
		if (!canShare(sel)) return;
		const wanted = new Set(inPageOrder(sel, order()));
		const quizzes = cards.filter(c => wanted.has(c.id)).flatMap(c => c.quizzes);
		sel = clear();
		commit();
		deps.onShare(quizzes);
	});
	button("qbd-sel-all", "list-checks", t("share.select.all"), () => { sel = selectAll(order()); commit(); });
	button("qbd-sel-clear", "x", t("share.select.cancel"), () => { sel = clear(); commit(); });

	const quizCount = (): number => cards.filter(c => isSelected(sel, c.id)).reduce((n, c) => n + c.quizzes.length, 0);

	function paint(): void {
		const selecting = hasSelection(sel);
		for (const c of cards) {
			const on = isSelected(sel, c.id);
			c.el.classList.toggle("is-selected", on);
			c.el.classList.toggle("is-selecting", selecting);
			// A card is a button: while selecting it is a toggle button.
			if (selecting) c.el.setAttribute("aria-pressed", String(on));
			else c.el.removeAttribute("aria-pressed");
		}
		bar.hidden = !selecting;
		const n = quizCount();
		count.textContent = t(n === 1 ? "share.select.countOne" : "share.select.countOther", { count: n });
		shareBtn.disabled = !canShare(sel);
	}

	function commit(): void {
		remembered = hasSelection(sel) ? { scope: deps.scope, sel } : null;
		paint();
	}

	/** The page this view paints is gone (navigation re-built it): let go. */
	const alive = (): boolean => {
		if (destroyed) return false;
		if (!deps.host.isConnected) { view.destroy(); return false; }
		return true;
	};

	// ── Keyboard and empty space, on the whole document ──
	const onKey = (e: KeyboardEvent): void => {
		if (!alive() || document.querySelector(".modal-container:not(.qbd-closing), .qbd-select-menu")) return;
		const act = keyAction(e.key, { ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey }, hasSelection(sel), false);
		if (act === "clear") { sel = clear(); commit(); }
		else if (act === "all") {
			// Typing in a field keeps its own Ctrl+A.
			const tag = (e.target as HTMLElement | null)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) return;
			e.preventDefault();
			sel = selectAll(order());
			commit();
		}
	};
	const onDocClick = (e: MouseEvent): void => {
		if (!alive() || !hasSelection(sel)) return;
		const target = e.target as Element | null;
		if (!target || target.closest(INTERACTIVE)) return;
		sel = clear();
		commit();
	};
	document.addEventListener("keydown", onKey);
	document.addEventListener("click", onDocClick);
	cleanups.push(() => document.removeEventListener("keydown", onKey), () => document.removeEventListener("click", onDocClick));

	function bind(card: SelectionCard): void {
		const el = card.el;
		let lastTouch = false;
		let press: { x: number; y: number; dx: number; dy: number; at: number; timer: number } | null = null;
		const stopPress = (): void => { if (press) { window.clearTimeout(press.timer); press = null; } };

		// Click: Ctrl/Cmd/Shift (or a tap in selection mode) selects instead of opening. Captured on the
		// card so the play button, the mode pills and "..." inside it do not run.
		el.addEventListener("click", (e) => {
			if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); return; }
			const touchSelecting = hasSelection(sel) && (e as PointerEvent).pointerType === "touch";
			const action = clickAction({ ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey }, touchSelecting);
			if (action === "open") return;
			e.preventDefault();
			e.stopPropagation();
			sel = action === "range" ? extendTo(sel, card.id, order()) : toggle(sel, card.id);
			commit();
		}, true);
		// Shift+click must not also select the text between two cards.
		el.addEventListener("mousedown", (e) => { if (e.shiftKey) e.preventDefault(); });
		el.addEventListener("keydown", (e) => {
			const act = keyAction(e.key, { ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey }, hasSelection(sel), e.target === el);
			if (act !== "toggle") return;
			e.preventDefault();
			e.stopPropagation();
			sel = toggle(sel, card.id);
			commit();
		}, true);

		// Long press (touch only).
		el.addEventListener("pointerdown", (e) => {
			lastTouch = e.pointerType === "touch";
			if (!lastTouch || !e.isPrimary) return;
			stopPress();
			const p = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, at: performance.now(), timer: 0 };
			p.timer = window.setTimeout(() => {
				if (press !== p) return;
				press = null;
				if (pressVerdict(p.dx, p.dy, performance.now() - p.at) !== "fire") return;
				hapticTick();
				if (!isSelected(sel, card.id)) sel = toggle(sel, card.id);
				commit();
				// The finger lifts into a click: it must not open the quiz.
				swallowClick = true;
			}, LONG_PRESS_MS);
			press = p;
		});
		el.addEventListener("pointermove", (e) => {
			if (!press) return;
			press.dx = e.clientX - press.x;
			press.dy = e.clientY - press.y;
			if (pressVerdict(press.dx, press.dy, 0) === "cancel") stopPress();
		});
		for (const type of ["pointerup", "pointercancel", "pointerleave"]) el.addEventListener(type, () => {
			stopPress();
			// No click follows a long press that ended in a scroll; do not leave the flag armed.
			if (swallowClick) window.setTimeout(() => { swallowClick = false; }, 700);
		});
		// The system menu a long press would open (copy, select text...) has no place on a card.
		el.addEventListener("contextmenu", (e) => { if (lastTouch) e.preventDefault(); });
	}

	const view: SelectionView = {
		add(card) {
			cards.push(card);
			bind(card);
		},
		ready() {
			sel = prune(sel, order());
			commit();
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			for (const c of cleanups) c();
			bar.remove();
			if (active === view) active = null;
		},
	};
	active = view;
	return view;
}
