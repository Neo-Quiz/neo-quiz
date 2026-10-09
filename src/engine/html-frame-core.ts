/* ══════════════════════════════════════════════════════════
   INTERACTIVE HTML IN A SANDBOXED FRAME (pure core, 2026-10-09)

   A Learn reading (`html` field of a `read` card) and an "Explain" answer
   (a fenced ```html block) may carry a COMPLETE HTML page: an SVG diagram, a
   symbol table, a sequence diagram, a clickable mini quiz, a simulator... It
   is shown in an iframe the learner can interact with, like a claude.ai
   artifact.

   A SHARED quiz can carry that page, so it is treated as hostile code. This
   is a SIXTH way HTML reaches the screen, next to the four gates of
   `sanitizer.ts` and the MathLive exception: it is never sanitized, it is
   ISOLATED instead:
     - `sandbox="allow-scripts"` ONLY: no `allow-same-origin` (the page gets
       an opaque origin: no `parent.document`, no `localStorage`, no cookies,
       no `window.neo`, and no Android bridge, which is injected by origin),
       no top navigation, popups, forms, modals or downloads;
     - a CSP injected FIRST in the document: nothing loads from outside, no
       network, no nested frame, no form submission;
     - `srcdoc`, so no URL is ever fetched for the frame.
   The only thing the page can say to the app is `{type:"nq-height", h}`.

   PURE (no DOM, no host): `npm run check:html-frame` holds it.
══════════════════════════════════════════════════════════ */

/** The ONLY sandbox tokens of the frame. Never `allow-same-origin`. */
export const FRAME_SANDBOX = "allow-scripts";

/** Injected as the first element of the document. */
export const FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

/** A document above this many bytes (UTF-8) is refused. */
export const FRAME_MAX_BYTES = 200 * 1024;

/** Height bounds, in CSS pixels, of what the frame may ask for. */
export const FRAME_MIN_HEIGHT = 40;
export const FRAME_MAX_HEIGHT = 4000;

/** The message type the frame posts to report its content height. */
export const FRAME_HEIGHT_TYPE = "nq-height";

/** Theme variables handed to the page (names are the page's own). */
export interface FrameTheme {
	bg: string;
	fg: string;
	muted: string;
	accent: string;
	border: string;
	font: string;
	dark: boolean;
}

export const FRAME_DEFAULT_THEME: FrameTheme = {
	bg: "#1e1e2e", fg: "#e6e6f0", muted: "#9a9ab0", accent: "#8b7cf6", border: "#3a3a52",
	font: "system-ui, -apple-system, 'Segoe UI', sans-serif", dark: true,
};

/** A theme value goes into a <style> block: only a conservative set of
    characters is kept, so a value can never close the block or the rule. */
function valeurCss(v: string, repli: string): string {
	const nette = String(v ?? "").trim();
	return nette && /^[\w\s#%.,()'"\-/]+$/.test(nette) && nette.length <= 200 ? nette : repli;
}

function themeCss(th: FrameTheme): string {
	const d = FRAME_DEFAULT_THEME;
	const bg = valeurCss(th.bg, d.bg), fg = valeurCss(th.fg, d.fg), muted = valeurCss(th.muted, d.muted);
	const accent = valeurCss(th.accent, d.accent), border = valeurCss(th.border, d.border), font = valeurCss(th.font, d.font);
	return `:root{--nq-bg:${bg};--nq-fg:${fg};--nq-muted:${muted};--nq-accent:${accent};--nq-border:${border};--nq-font:${font};color-scheme:${th.dark ? "dark" : "light"}}`
		+ `html,body{margin:0;padding:0;overflow:hidden;background:transparent;color:var(--nq-fg);font-family:var(--nq-font);font-size:15px;line-height:1.5}`
		+ `body{padding:4px}*{box-sizing:border-box}svg{max-width:100%;height:auto}img,video,canvas{max-width:100%}`
		+ `button{font:inherit;color:inherit}`;
}

/** Posts the content height to the parent. Appended AFTER the author's page,
    so it sees the final DOM; ResizeObserver covers later changes. Reads
    nothing from the parent. */
export const FRAME_HEIGHT_SCRIPT = `(function(){var last=0;function h(){var e=document.documentElement,b=document.body;return Math.ceil(Math.max(e.getBoundingClientRect().height,b?b.scrollHeight:0))}function post(){var v=h();if(v!==last){last=v;parent.postMessage({type:"${FRAME_HEIGHT_TYPE}",h:v},"*")}}post();if(typeof ResizeObserver==="function"){var ro=new ResizeObserver(post);ro.observe(document.documentElement);if(document.body)ro.observe(document.body)}window.addEventListener("load",post);setTimeout(post,300)})();`;

export function frameBytes(source: string): number {
	let n = 0;
	for (let i = 0; i < source.length; i++) {
		const c = source.charCodeAt(i);
		if (c < 0x80) n += 1;
		else if (c < 0x800) n += 2;
		else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
		else n += 3;
	}
	return n;
}

export type FrameDoc =
	| { ok: true; srcdoc: string }
	| { ok: false; reason: "empty" | "tooLarge" };

/** The `srcdoc` of a frame: our head (CSP first, theme), the author's page,
    then our height script. */
export function buildSrcdoc(source: unknown, theme: FrameTheme = FRAME_DEFAULT_THEME): FrameDoc {
	if (typeof source !== "string" || !source.trim()) return { ok: false, reason: "empty" };
	if (frameBytes(source) > FRAME_MAX_BYTES) return { ok: false, reason: "tooLarge" };
	const srcdoc = `<!doctype html><html><head><meta charset="utf-8">`
		+ `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`
		+ `<base target="_self"><meta name="viewport" content="width=device-width, initial-scale=1">`
		+ `<style>${themeCss(theme)}</style></head><body>${source}<script>${FRAME_HEIGHT_SCRIPT}</script></body></html>`;
	return { ok: true, srcdoc };
}

/** The height a message asks for, or null. `fromFrame`: the caller has
    checked `event.source === iframe.contentWindow` — nothing else is read. */
export function acceptHeight(data: unknown, fromFrame: boolean): number | null {
	if (!fromFrame || !data || typeof data !== "object" || Array.isArray(data)) return null;
	const m = data as { type?: unknown; h?: unknown };
	if (m.type !== FRAME_HEIGHT_TYPE || typeof m.h !== "number" || !Number.isFinite(m.h)) return null;
	return Math.min(FRAME_MAX_HEIGHT, Math.max(FRAME_MIN_HEIGHT, Math.round(m.h)));
}

export function escapeAttr(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface FrameLabels { title: string; showCode: string; hideCode: string; tooLarge: string }

/** The markup of one frame: its toolbar, the iframe and the (hidden) source. */
export function frameMarkup(source: unknown, theme: FrameTheme, labels: FrameLabels): string {
	const doc = buildSrcdoc(source, theme);
	if (!doc.ok) return doc.reason === "tooLarge" ? `<div class="nq-html-frame nq-html-frame--refused">${escapeAttr(labels.tooLarge)}</div>` : "";
	const code = escapeAttr(String(source));
	return `<div class="nq-html-frame" data-nq-frame="1">`
		+ `<iframe class="nq-html-frame-view" sandbox="${FRAME_SANDBOX}" referrerpolicy="no-referrer" allow="" title="${escapeAttr(labels.title)}" srcdoc="${escapeAttr(doc.srcdoc)}" style="height:120px"></iframe>`
		+ `<button type="button" class="nq-html-frame-code" aria-expanded="false" data-show="${escapeAttr(labels.showCode)}" data-hide="${escapeAttr(labels.hideCode)}">${escapeAttr(labels.showCode)}</button>`
		+ `<pre class="nq-html-frame-source" hidden><code>${code}</code></pre></div>`;
}

/** The piece of a streamed answer: prose, a complete ```html block, or one
    still being written (shown as a placeholder, never as a half page). */
export type Segment = { kind: "text" | "html" | "pending"; value: string };

export function splitHtmlBlocks(text: string): Segment[] {
	const out: Segment[] = [];
	const re = /^[ \t]*```html[ \t]*\r?\n/gim;
	let pos = 0;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		const debut = m.index;
		const corps = m.index + m[0].length;
		const fin = /^[ \t]*```[ \t]*$/m.exec(text.slice(corps));
		if (debut > pos) out.push({ kind: "text", value: text.slice(pos, debut) });
		if (!fin) { out.push({ kind: "pending", value: text.slice(corps) }); return out; }
		out.push({ kind: "html", value: text.slice(corps, corps + fin.index) });
		pos = corps + fin.index + fin[0].length;
		re.lastIndex = pos;
	}
	if (pos < text.length) out.push({ kind: "text", value: text.slice(pos) });
	return out;
}

/** The `html` of a reading card: on a raw block item or on an editor draft
    (`_extraFields`). */
export function htmlDeLecture(item: unknown): string | null {
	if (!item || typeof item !== "object") return null;
	const r = item as { html?: unknown; _extraFields?: unknown };
	const extra = r._extraFields && typeof r._extraFields === "object" ? (r._extraFields as { html?: unknown }).html : undefined;
	const v = typeof r.html === "string" ? r.html : extra;
	return typeof v === "string" && v.trim() ? v : null;
}
