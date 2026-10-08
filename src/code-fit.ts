/**
 * The font size of a code block on a phone: a PURE calculation, no DOM.
 *
 * A code block that is wider than its card on a phone either scrolls sideways
 * (a long line cut at the edge) or is shrunk until its longest line fits. The
 * app does the second by default, down to CODE_SIZE_MIN; below that a block
 * keeps scrolling. A two-finger pinch on a block sets ONE size for every block
 * (CODE_SIZE_MIN to CODE_SIZE_MAX), remembered on the device, and switches the
 * automatic fit off. The DOM side is apps/windows/src/ui/code-fit.ts.
 *
 * Only the width of the longest line is measured, at the reference size, and
 * a monospace line scales linearly with its font size: the size that fits is
 * `reference * available / measured`, rounded DOWN to a half pixel so the line
 * really fits, then clamped to [min, max].
 *
 * `npm run check:code-fit` tests these functions on their real code.
 */

/** The smallest size the automatic fit goes to; below it a block scrolls sideways. */
export const CODE_SIZE_MIN = 11;
/** The largest size a pinch reaches. The automatic fit never goes above the normal size. */
export const CODE_SIZE_MAX = 22;

const STEP = 0.5;

export interface CodeFitInput {
	/** Width the longest line may take, in px. */
	available: number;
	/** Width of the longest line at `reference`, in px. */
	measured: number;
	/** The normal size of the block, in px: the largest the automatic fit gives. */
	reference: number;
	min?: number;
	max?: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function roundDown(value: number): number {
	return Math.floor(value / STEP) * STEP;
}

/**
 * The automatic size of one block. A line that already fits keeps the normal
 * size (never above it); a line that does not fit gets the size at which it
 * just fits, but never below `min`, where the block starts to scroll sideways.
 */
export function fitCodeSize({ available, measured, reference, min = CODE_SIZE_MIN, max = reference }: CodeFitInput): number {
	const top = Math.min(max, reference);
	if (!(available > 0) || !(measured > 0)) return clamp(reference, min, top);
	if (measured <= available) return clamp(reference, min, top);
	return clamp(roundDown(reference * available / measured), min, top);
}

/**
 * The size of a pinch: the size the block had when the fingers touched,
 * multiplied by how far they moved apart (`ratio` = distance now / distance
 * at the start), kept inside [CODE_SIZE_MIN, CODE_SIZE_MAX].
 */
export function pinchCodeSize(startSize: number, ratio: number): number {
	if (!(startSize > 0) || !(ratio > 0) || !Number.isFinite(ratio)) return clamp(startSize, CODE_SIZE_MIN, CODE_SIZE_MAX);
	return clamp(roundDown(startSize * ratio), CODE_SIZE_MIN, CODE_SIZE_MAX);
}

/**
 * The remembered size, read back from its stored text. Anything that is not a
 * number inside [CODE_SIZE_MIN, CODE_SIZE_MAX] is no choice at all (null), so
 * a damaged value falls back to the automatic fit instead of a guessed size.
 */
export function parseStoredCodeSize(raw: string | null): number | null {
	if (raw === null || raw.trim() === "") return null;
	const value = Number(raw);
	if (!Number.isFinite(value) || value < CODE_SIZE_MIN || value > CODE_SIZE_MAX) return null;
	return roundDown(value);
}
