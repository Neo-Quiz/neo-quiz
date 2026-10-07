/* ══════════════════════════════════════════════════════════
   SELECTING QUIZ CARDS (2026-10-07) - a PURE module (no host, no DOM).

   The folder page lets you pick several cards and share them in one archive
   (Ctrl+click or Cmd+click, Shift+click for a range, a long press on a
   phone). Every decision lives here so a check can drive it without a
   screen; `selection-view.ts` only turns events into these calls and paints
   the result.

   An item is identified by an id (the path of the card's first quiz), and
   `order` is the ids of the cards as the page shows them. A selection is
   immutable: every function returns a new one.
══════════════════════════════════════════════════════════ */

export interface Selection {
	/** Selected ids, in the order they were picked. */
	readonly ids: readonly string[];
	/** The item a Shift+click range starts from: the last one picked. */
	readonly anchor: string | null;
}

export const EMPTY_SELECTION: Selection = { ids: [], anchor: null };

export const isSelected = (sel: Selection, id: string): boolean => sel.ids.includes(id);

/** Anything selected at all? Also what turns the action bar on. */
export const hasSelection = (sel: Selection): boolean => sel.ids.length > 0;

/** Ctrl+click: adds the item, or removes it when it is already there. */
export function toggle(sel: Selection, id: string): Selection {
	if (isSelected(sel, id)) {
		const ids = sel.ids.filter(x => x !== id);
		return { ids, anchor: sel.anchor === id ? (ids.length > 0 ? ids[ids.length - 1] : null) : sel.anchor };
	}
	return { ids: [...sel.ids, id], anchor: id };
}

/** Shift+click: adds every item between the anchor and `id` (both ends
    included, whichever comes first on the page). No anchor, or an anchor no
    longer on the page: just that item. The anchor stays where it was, so a
    second Shift+click re-draws the range from the same start. */
export function extendTo(sel: Selection, id: string, order: readonly string[]): Selection {
	const to = order.indexOf(id);
	if (to < 0) return sel;
	const from = sel.anchor === null ? -1 : order.indexOf(sel.anchor);
	if (from < 0) return isSelected(sel, id) ? sel : { ids: [...sel.ids, id], anchor: id };
	const [lo, hi] = from <= to ? [from, to] : [to, from];
	const ids = [...sel.ids];
	for (const x of order.slice(lo, hi + 1)) if (!ids.includes(x)) ids.push(x);
	return { ids, anchor: sel.anchor };
}

export function selectAll(order: readonly string[]): Selection {
	return order.length === 0 ? EMPTY_SELECTION : { ids: [...order], anchor: order[order.length - 1] };
}

/** Escape, "Cancel", a click in empty space. */
export function clear(): Selection {
	return EMPTY_SELECTION;
}

/** Keeps only what is still on the page: a quiz can be deleted, moved or
    renamed while it is selected (a sync, another window). The anchor goes
    with the item it pointed at. Returns the SAME object when nothing changed. */
export function prune(sel: Selection, order: readonly string[]): Selection {
	const here = new Set(order);
	const ids = sel.ids.filter(x => here.has(x));
	const anchor = sel.anchor !== null && here.has(sel.anchor) ? sel.anchor : (ids.length > 0 ? ids[ids.length - 1] : null);
	if (ids.length === sel.ids.length && anchor === sel.anchor) return sel;
	return ids.length === 0 ? EMPTY_SELECTION : { ids, anchor };
}

/** The selected ids in PAGE order (what is shared, whatever the click order). */
export function inPageOrder(sel: Selection, order: readonly string[]): string[] {
	return order.filter(x => isSelected(sel, x));
}

/** The "Share" button is only live with something to share. */
export const canShare = (sel: Selection): boolean => sel.ids.length > 0;

export type ClickAction = "open" | "toggle" | "range";

export interface Modifiers { ctrl: boolean; meta: boolean; shift: boolean }

/** What a click on a card does. Shift wins over Ctrl (a range). A plain click
    keeps opening the quiz, EXCEPT in a phone's selection mode (`touchSelecting`:
    touch, and at least one card selected), where a tap toggles the card. */
export function clickAction(mods: Modifiers, touchSelecting: boolean): ClickAction {
	if (mods.shift) return "range";
	if (mods.ctrl || mods.meta) return "toggle";
	return touchSelecting ? "toggle" : "open";
}

export type KeyAction = "clear" | "all" | "toggle" | null;

/** Keyboard, only while something is selected (Space and Ctrl+A keep their
    usual meaning otherwise). `onCard`: the focus is on a card itself. */
export function keyAction(key: string, mods: Modifiers, selecting: boolean, onCard: boolean): KeyAction {
	if (!selecting) return null;
	if (key === "Escape") return "clear";
	if ((mods.ctrl || mods.meta) && key.toLowerCase() === "a") return "all";
	if (key === " " && onCard) return "toggle";
	return null;
}

/* ── The long press of a phone ── */

/** A touch held this long without moving starts the selection mode. */
export const LONG_PRESS_MS = 450;
/** Moving the finger further than this (px) is a scroll or a swipe, not a press. */
export const LONG_PRESS_SLOP = 10;

export type PressVerdict = "wait" | "cancel" | "fire";

/** Where a held touch stands: moved too far (scroll, swipe) -> cancel; held
    long enough without that -> fire; else keep waiting. */
export function pressVerdict(dx: number, dy: number, elapsedMs: number): PressVerdict {
	if (Math.hypot(dx, dy) > LONG_PRESS_SLOP) return "cancel";
	return elapsedMs >= LONG_PRESS_MS ? "fire" : "wait";
}
