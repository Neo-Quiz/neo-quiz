/**
 * Selecting quiz cards on the folder page (`src/dashboard/selection.ts`): the
 * pure rules behind Ctrl+click, Shift+click ranges, Escape, the phone's long
 * press, and the selection surviving a page that changes under it.
 *     npm run check:selection
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/selection.ts", (m) => {
	const { EMPTY_SELECTION: E, toggle, extendTo, selectAll, clear, prune, inPageOrder, canShare, hasSelection, isSelected, clickAction, keyAction, pressVerdict, LONG_PRESS_MS, LONG_PRESS_SLOP } = m;
	const r = makeReporter("Selecting quiz cards");
	const order = ["a", "b", "c", "d", "e"];
	const none = { ctrl: false, meta: false, shift: false };

	// Ctrl+click: add, then remove.
	let s = toggle(E, "b");
	r.check("Ctrl+click adds a card", s.ids, ["b"]);
	r.check("... and makes it the anchor", s.anchor, "b");
	s = toggle(s, "d");
	r.check("a second Ctrl+click adds another, in click order", s.ids, ["b", "d"]);
	s = toggle(s, "d");
	r.check("Ctrl+click on a selected card removes it", s.ids, ["b"]);
	r.check("removing the anchor moves it to the last one picked", s.anchor, "b");
	r.check("removing the last card leaves the empty selection", [toggle(s, "b").ids, toggle(s, "b").anchor], [[], null]);
	r.check("the input is never mutated", [E.ids.length, E.anchor], [0, null]);

	// Shift+click: range from the anchor, either direction, keeps the anchor.
	s = toggle(E, "b");
	r.check("Shift+click from b to d selects b, c, d", extendTo(s, "d", order).ids, ["b", "c", "d"]);
	r.check("Shift+click upwards selects the same span", extendTo(toggle(E, "d"), "b", order).ids.sort(), ["b", "c", "d"]);
	r.check("the anchor stays at b after the range", extendTo(s, "d", order).anchor, "b");
	const wider = extendTo(extendTo(s, "d", order), "e", order);
	r.check("a second Shift+click re-draws from the same anchor and keeps what was picked", wider.ids, ["b", "c", "d", "e"]);
	r.check("Shift+click keeps cards picked earlier with Ctrl", extendTo(toggle(toggle(E, "a"), "d"), "e", order).ids.sort(), ["a", "d", "e"]);
	r.check("Shift+click with nothing selected selects just that card", extendTo(E, "c", order).ids, ["c"]);
	r.check("Shift+click on a card that is not on the page changes nothing", extendTo(s, "zzz", order), s);
	r.check("an anchor that left the page falls back to the clicked card", extendTo({ ids: ["gone"], anchor: "gone" }, "c", order).ids, ["gone", "c"]);

	// Select all, clear, escape.
	r.check("Select all takes every card, in page order", selectAll(order).ids, order);
	r.check("Select all on an empty page selects nothing", selectAll([]).ids, []);
	r.check("Clear empties the selection", [clear().ids, hasSelection(clear())], [[], false]);

	// The page changes under the selection.
	const kept = prune({ ids: ["b", "x", "d"], anchor: "x" }, order);
	r.check("a quiz that vanished from the folder leaves the selection", kept.ids, ["b", "d"]);
	r.check("... and the anchor moves to what is left", kept.anchor, "d");
	r.check("pruning when everything vanished gives the empty selection", prune({ ids: ["x"], anchor: "x" }, order), E);
	const same = toggle(E, "c");
	r.check("pruning an intact selection returns the very same object", prune(same, order) === same, true);
	r.check("the shared quizzes follow PAGE order, not click order", inPageOrder({ ids: ["d", "a", "c"], anchor: "c" }, order), ["a", "c", "d"]);
	r.check("a quiz renamed (new id) is no longer selected", isSelected(prune(toggle(E, "b"), ["a", "b2"]), "b"), false);

	// Share button.
	r.check("Share is dead with nothing selected", canShare(E), false);
	r.check("Share is live with one card selected", canShare(toggle(E, "a")), true);
	r.check("Share is dead again after the last card is deselected", canShare(toggle(toggle(E, "a"), "a")), false);

	// Clicks.
	r.check("a plain click opens the quiz", clickAction(none, false), "open");
	r.check("a plain click STILL opens it when cards are selected on a computer", clickAction(none, false), "open");
	r.check("Ctrl+click toggles", clickAction({ ...none, ctrl: true }, false), "toggle");
	r.check("Cmd+click toggles", clickAction({ ...none, meta: true }, false), "toggle");
	r.check("Shift+click extends the range", clickAction({ ...none, shift: true }, false), "range");
	r.check("Shift beats Ctrl", clickAction({ ctrl: true, meta: false, shift: true }, false), "range");
	r.check("a tap toggles in the phone's selection mode", clickAction(none, true), "toggle");

	// Keyboard.
	const sel = true;
	r.check("Escape clears while something is selected", keyAction("Escape", none, sel, false), "clear");
	r.check("Escape does nothing with an empty selection", keyAction("Escape", none, false, false), null);
	r.check("Ctrl+A selects all while selecting", keyAction("a", { ...none, ctrl: true }, sel, false), "all");
	r.check("Ctrl+A keeps its meaning with an empty selection", keyAction("a", { ...none, ctrl: true }, false, false), null);
	r.check("Cmd+A selects all while selecting", keyAction("A", { ...none, meta: true }, sel, false), "all");
	r.check("Space on a focused card toggles it while selecting", keyAction(" ", none, sel, true), "toggle");
	r.check("Space elsewhere is left alone", keyAction(" ", none, sel, false), null);
	r.check("Space on a card with an empty selection still opens it", keyAction(" ", none, false, true), null);

	// The long press.
	r.check("the long press lasts 450 ms", LONG_PRESS_MS, 450);
	r.check("the finger may drift 10 px", LONG_PRESS_SLOP, 10);
	r.check("held still before 450 ms: wait", pressVerdict(0, 0, 449), "wait");
	r.check("held still for 450 ms: fire", pressVerdict(0, 0, 450), "fire");
	r.check("a 6-8 px tremor still fires", pressVerdict(6, 8, 500), "fire");
	r.check("11 px of movement cancels (a scroll)", pressVerdict(0, 11, 100), "cancel");
	r.check("a diagonal past 10 px cancels", pressVerdict(8, 8, 100), "cancel");
	r.check("moving too far cancels even after the delay", pressVerdict(30, 0, 600), "cancel");
	r.done();
});
