/* ══════════════════════════════════════════════════════════
   CODE BLOCK SIZE ON A PHONE — the DOM side of src/code-fit.ts.

   A code block (`pre.quiz-md-code`: a lecture, a question, an explanation,
   a program's output) shrinks on a phone until its longest line fits its
   width, never below 11 px and never above its normal size. Below 11 px it
   keeps scrolling sideways, as before.

   A two-finger pinch on a block sets ONE size for every block, between 11
   and 22 px. That choice is remembered on the device (a view preference,
   read and written through try/catch) and switches the automatic fit off.
   There is no button and no setting.

   The measure is taken once per block, and again only when its width
   changes (a debounced ResizeObserver). Nothing runs in a loop and nothing
   is animated.

   Phone only: installed from main.ts next to the overscroll stretch.
══════════════════════════════════════════════════════════ */

import {
	CODE_SIZE_MIN,
	fitCodeSize,
	parseStoredCodeSize,
	pinchCodeSize,
} from "../../../../src/code-fit";

const BLOCK = "pre.quiz-md-code";
const STORAGE_KEY = "neo-quiz.code-size";
/** The pause after a width change before the blocks are measured again. */
const DEBOUNCE_MS = 120;

function readChoice(): number | null {
	try {
		return parseStoredCodeSize(localStorage.getItem(STORAGE_KEY));
	} catch {
		// A private window or blocked storage: the choice lasts this session only.
		return null;
	}
}

function writeChoice(size: number): void {
	try {
		localStorage.setItem(STORAGE_KEY, String(size));
	} catch {
		/* Not remembered: the next launch falls back to the automatic fit. */
	}
}

/** The text element whose font size is set (a block always has one). */
function textOf(pre: HTMLElement): HTMLElement {
	return pre.querySelector<HTMLElement>("code") ?? pre;
}

/** The width of the longest line, read from the text's own line boxes. */
function longestLine(text: HTMLElement): number {
	const range = document.createRange();
	range.selectNodeContents(text);
	return range.getBoundingClientRect().width;
}

/** The size the user chose, or null while the automatic fit applies. */
let choice: number | null = readChoice();
const lastWidth = new WeakMap<HTMLElement, number>();
const attached = new Set<HTMLElement>();
const dirty = new Set<HTMLElement>();
let timer = 0;

/** Sets the block's text to its size: the chosen one, else the one that fits its width. */
function apply(pre: HTMLElement): void {
	if (!pre.isConnected) return;
	const text = textOf(pre);
	lastWidth.set(pre, pre.clientWidth);
	if (choice !== null) {
		text.style.fontSize = `${choice}px`;
		return;
	}
	// Back to the stylesheet's normal size, to measure the line at that size.
	text.style.fontSize = "";
	const style = getComputedStyle(pre);
	const reference = parseFloat(getComputedStyle(text).fontSize);
	const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
	const size = fitCodeSize({
		available: pre.clientWidth - padding,
		measured: longestLine(text),
		reference,
		min: CODE_SIZE_MIN,
		max: reference,
	});
	text.style.fontSize = size === reference ? "" : `${size}px`;
}

function applyAll(): void {
	for (const pre of attached) apply(pre);
}

/** Blocks whose width changed are measured again, once, after the pause. */
function flush(): void {
	timer = 0;
	for (const pre of dirty) {
		dirty.delete(pre);
		if (!pre.isConnected) attached.delete(pre);
		else if (pre.clientWidth !== lastWidth.get(pre)) apply(pre);
	}
}

const resize = new ResizeObserver((entries) => {
	for (const entry of entries) {
		const pre = entry.target as HTMLElement;
		if (!pre.isConnected) {
			resize.unobserve(pre);
			attached.delete(pre);
			continue;
		}
		dirty.add(pre);
	}
	if (dirty.size && !timer) timer = window.setTimeout(flush, DEBOUNCE_MS);
});

function attach(pre: HTMLElement): void {
	if (attached.has(pre)) return;
	attached.add(pre);
	apply(pre);
	resize.observe(pre);
}

function scan(node: Node): void {
	if (!(node instanceof HTMLElement)) return;
	if (node.matches(BLOCK)) attach(node);
	for (const pre of node.querySelectorAll<HTMLElement>(BLOCK)) attach(pre);
}

/* ── The pinch ─────────────────────────────────────────────── */

interface Touch { pre: HTMLElement; x: number; y: number }
const touches = new Map<number, Touch>();
let pinch: { pre: HTMLElement; distance: number; start: number } | null = null;

function spread(): number {
	const [a, b] = [...touches.values()];
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function startPinch(): void {
	const [a, b] = [...touches.values()];
	if (!a || !b || a.pre !== b.pre) return;
	const distance = spread();
	if (!(distance > 0)) return;
	pinch = { pre: a.pre, distance, start: parseFloat(getComputedStyle(textOf(a.pre)).fontSize) };
}

/* Only finger touches count: a mouse wheel or a pen never changes a size. */
document.addEventListener("pointerdown", (event) => {
	if (event.pointerType !== "touch") return;
	const pre = (event.target as Element | null)?.closest<HTMLElement>(BLOCK);
	if (!pre) return;
	touches.set(event.pointerId, { pre, x: event.clientX, y: event.clientY });
	if (touches.size === 2) startPinch();
}, true);

document.addEventListener("pointermove", (event) => {
	const touch = touches.get(event.pointerId);
	if (!touch) return;
	touch.x = event.clientX;
	touch.y = event.clientY;
	if (!pinch || touches.size !== 2) return;
	const size = pinchCodeSize(pinch.start, spread() / pinch.distance);
	if (choice === size) return;
	choice = size;
	applyAll();
}, true);

function endTouch(event: PointerEvent): void {
	if (!touches.delete(event.pointerId)) return;
	if (!pinch) return;
	// The pinch ends with its first finger: the size chosen so far is kept.
	pinch = null;
	if (choice !== null) writeChoice(choice);
}

document.addEventListener("pointerup", endTouch, true);
document.addEventListener("pointercancel", endTouch, true);

/** Installs the phone code-block size: the initial blocks, then every block rendered later. */
export function installCodeFit(): void {
	scan(document.body);
	new MutationObserver((records) => {
		for (const record of records) for (const node of record.addedNodes) scan(node);
	}).observe(document.body, { childList: true, subtree: true });
}

