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
		+ `button{font:inherit;color:inherit}`
		+ FRAME_CONTROLS_CSS;
}

/** Default look of the native controls of a page (range, button, fields), in the
    app's variables. It sits in the head, so the author's own CSS, later in the
    document, still wins over it. */
const FRAME_CONTROLS_CSS = `:root{accent-color:var(--nq-accent)}`
	+ `input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:18px;margin:0;background:transparent;cursor:pointer}`
	+ `input[type=range]:focus{outline:none}`
	+ `input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:4px;background:linear-gradient(to right,var(--nq-accent) var(--nq-fill,0%),var(--nq-border) var(--nq-fill,0%))}`
	+ `input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;margin-top:-6px;border:0;border-radius:50%;background:var(--nq-accent);transition:box-shadow 120ms ease}`
	+ `input[type=range]:hover::-webkit-slider-thumb{box-shadow:0 0 0 5px var(--nq-border)}`
	+ `input[type=range]:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 5px color-mix(in srgb,var(--nq-accent) 40%,transparent)}`
	+ `input[type=range]::-moz-range-track{height:4px;border-radius:4px;background:var(--nq-border)}`
	+ `input[type=range]::-moz-range-progress{height:4px;border-radius:4px;background:var(--nq-accent)}`
	+ `input[type=range]::-moz-range-thumb{width:16px;height:16px;border:0;border-radius:50%;background:var(--nq-accent)}`
	+ `button{background:transparent;border:1px solid var(--nq-border);border-radius:8px;padding:6px 14px;color:var(--nq-fg);font-family:var(--nq-font);cursor:pointer}`
	+ `button:hover{background:color-mix(in srgb,var(--nq-fg) 8%,transparent)}`
	+ `button[aria-pressed=true]{background:var(--nq-fg);border-color:var(--nq-fg);color:var(--nq-bg)}`
	+ `input[type=text],input[type=number],select,textarea{font-family:var(--nq-font);font-size:inherit;color:var(--nq-fg);background:color-mix(in srgb,var(--nq-fg) 4%,var(--nq-bg));border:1px solid var(--nq-border);border-radius:8px;padding:6px 10px;box-sizing:border-box}`
	+ `input[type=text]:focus,input[type=number]:focus,select:focus,textarea:focus{outline:none;border-color:var(--nq-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--nq-accent) 35%,transparent)}`;

/** Keeps the filled part of each range in step with its value (the CSS track
    has no other way to know it). Runs after the author's page. */
export const FRAME_CONTROLS_SCRIPT = `(function(){function f(r){var lo=+r.min||0,hi=+r.max||100,v=+r.value;var p=hi>lo?Math.min(100,Math.max(0,(v-lo)/(hi-lo)*100)):0;r.style.setProperty("--nq-fill",p+"%")}function all(){var rs=document.querySelectorAll('input[type=range]');for(var i=0;i<rs.length;i++)f(rs[i])}document.addEventListener("input",function(e){var t=e.target;if(t&&t.type==="range")f(t)},true);all()})();`;

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
		+ `<style>${themeCss(theme)}</style></head><body>${source}<script>${FRAME_CONTROLS_SCRIPT}</script><script>${FRAME_HEIGHT_SCRIPT}</script></body></html>`;
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

/** The only path a host may answer `publishHtmlFrame` with (Android: `bridge/HtmlFrameRoute.kt`): same origin, 128-bit id. */
const FRAME_ROUTE = /^\/__frame\/[0-9a-f]{32}$/;

/** The path to load a published frame from, or null for anything else (an iframe `src` is never set to a free-form value). */
export function acceptFrameUrl(v: unknown): string | null {
	return typeof v === "string" && FRAME_ROUTE.test(v) ? v : null;
}

export function escapeAttr(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface FrameLabels { title: string; tooLarge: string }

/** The name a saved page is offered under: the given one (a card title), else the page's own `<title>`, else
    `fallback`. Only a short single line; the main process sanitises it again into a file name. */
export function frameFileName(name: string | undefined, source: string, fallback: string): string {
	const title = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(source)?.[1];
	const pick = [name, title].map(v => (v ?? "").replace(/[*_`$#]/g, "").replace(/\s+/g, " ").trim()).find(v => v.length > 0);
	return (pick ?? fallback).slice(0, 100);
}

/** The markup of one frame: the iframe and its (hidden) source, which the ⋯ menu shows and saves. With `byRoute` (the host publishes
    pages, `HostPlatform.publishHtmlFrame`) the document waits in `data-nq-doc` and `brancherCadres` points the
    iframe at its route; it is never loaded as `srcdoc` first. */
export function frameMarkup(source: unknown, theme: FrameTheme, labels: FrameLabels, byRoute = false, name = ""): string {
	const doc = buildSrcdoc(source, theme);
	if (!doc.ok) return doc.reason === "tooLarge" ? `<div class="nq-html-frame nq-html-frame--refused">${escapeAttr(labels.tooLarge)}</div>` : "";
	const code = escapeAttr(String(source));
	return `<div class="nq-html-frame" data-nq-frame="1"${name.trim() ? ` data-nq-name="${escapeAttr(name.trim().slice(0, 200))}"` : ""}>`
		+ `<iframe class="nq-html-frame-view" sandbox="${FRAME_SANDBOX}" referrerpolicy="no-referrer" allow="" title="${escapeAttr(labels.title)}" ${byRoute ? "data-nq-doc" : "srcdoc"}="${escapeAttr(doc.srcdoc)}" style="height:120px"></iframe>`
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
