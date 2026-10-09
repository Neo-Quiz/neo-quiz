/* ══════════════════════════════════════════════════════════
   EXPORTING AN INTERACTIVE PAGE (pure rules, 2026-10-09)

   The ⋯ menu of an interactive page (`src/engine/html-frame.ts`) offers
   "Copy as image" and "Download as HTML". The page itself is hostile code
   (a SHARED quiz can carry it), and the window that asks may be compromised:
   so the main process takes from it only

     - for the image: a RECTANGLE in CSS pixels, nothing else. The main process
       converts it with ITS zoom factor, refuses anything that is not four
       finite non-negative numbers inside the window, and captures that part of
       the sender's own page (`capturePage`) into the clipboard. At most one
       capture per second: a loop cannot keep the clipboard churning;
     - for the HTML: a NAME and the BYTES of the page source. The name becomes
       a file name with `.html` FORCED, the bytes are bounded by the page cap
       of the frame (a page over it never renders), and the place comes from
       the NATIVE "Save as" dialog: the user's choice there is what grants the
       write, outside the open folders, like any "Save as".

   PURE (no Electron): `npm run check:partage` holds every rule here.
══════════════════════════════════════════════════════════ */

import { FRAME_MAX_BYTES } from "../../../src/engine/html-frame-core";
import { isReservedName } from "../../../src/dashboard/share-names";

/** The largest page source the save channel accepts: the frame's own cap. */
export const FRAME_HTML_MAX_BYTES = FRAME_MAX_BYTES;

/** Minimum delay between two captures, in ms. */
export const CAPTURE_MIN_INTERVAL_MS = 1000;

/** A capture rectangle in device-independent pixels (what `capturePage` takes). */
export interface CaptureRect { x: number; y: number; width: number; height: number }

/** Rounding slack, in DIP, between the renderer's CSS rectangle and the window. */
const SLACK = 2;

/**
 * The rectangle to capture, or null when refused. `raw` comes from the window
 * in CSS pixels; `zoom` is the page zoom factor read by the main process;
 * `content` is the window's content size in DIP. Refused: anything but a plain
 * object of four finite numbers, a negative origin, an empty or oversized
 * area, a zoom outside [0.25, 5], or a rectangle that leaves the window.
 */
export function captureRect(raw: unknown, zoom: unknown, content: { width: number; height: number }): CaptureRect | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	if (typeof zoom !== "number" || !Number.isFinite(zoom) || zoom < 0.25 || zoom > 5) return null;
	const r = raw as Record<string, unknown>;
	const keys = Object.keys(r);
	if (keys.length !== 4 || !["x", "y", "width", "height"].every(k => keys.includes(k))) return null;
	const nums = [r.x, r.y, r.width, r.height];
	if (!nums.every(v => typeof v === "number" && Number.isFinite(v))) return null;
	const [x, y, w, h] = (nums as number[]).map(v => v * zoom);
	if (x < 0 || y < 0 || w < 1 || h < 1) return null;
	if (!(content.width > 0 && content.height > 0)) return null;
	if (x + w > content.width + SLACK || y + h > content.height + SLACK) return null;
	const left = Math.floor(x), top = Math.floor(y);
	const width = Math.min(Math.ceil(x + w), Math.floor(content.width)) - left;
	const height = Math.min(Math.ceil(y + h), Math.floor(content.height)) - top;
	return width >= 1 && height >= 1 ? { x: left, y: top, width, height } : null;
}

/** The file name of a saved page: the name sanitised (never a path, no
    character Windows forbids, no device name), cut to 100 characters, and
    `.html` FORCED, whatever extension the window wrote. Null when nothing
    usable is left. */
export function htmlFileName(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	let stem = raw.normalize("NFC")
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
		.replace(/\.html?$/i, "")
		.replace(/^[\s.]+|[\s.]+$/g, "")
		.trim();
	if (stem.length > 100) stem = stem.slice(0, 100).replace(/[\s.]+$/g, "");
	if (!stem || isReservedName(stem)) return null;
	return stem + ".html";
}

/** Where and how the page is written, from the path the "Save as" dialog
    returned. A path already ending in `.html` is the file the user picked (the
    dialog itself asked before replacing it): plain write. Any other path gets
    `.html` appended, which names a file the dialog NEVER showed: it is created
    exclusively (`wx`), so an existing file there is refused, never replaced. */
export function htmlSaveTarget(chosen: string): { path: string; flag: "w" | "wx" } {
	const base = chosen.slice(Math.max(chosen.lastIndexOf("/"), chosen.lastIndexOf("\\")) + 1);
	return /.\.html$/i.test(base) ? { path: chosen, flag: "w" } : { path: `${chosen}.html`, flag: "wx" };
}

/** The page bytes, or null when not bytes, empty, or over the cap. */
export function htmlBytes(raw: unknown): Uint8Array | null {
	if (!(raw instanceof Uint8Array)) return null;
	return raw.length > 0 && raw.length <= FRAME_HTML_MAX_BYTES ? raw : null;
}

/** A gate that opens at most once per `intervalMs`. */
export function createRateGate(intervalMs: number, now: () => number = Date.now): () => boolean {
	let last: number | null = null;
	return () => {
		const t = now();
		if (last !== null && t - last < intervalMs) return false;
		last = t;
		return true;
	};
}
