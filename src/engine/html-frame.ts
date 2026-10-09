import { t } from "../i18n";
import { currentHost } from "../host/current";
import { openActionMenu } from "../dashboard/ui-select";
import type { ActionMenuItem } from "../dashboard/ui-select";
import {
	FRAME_DEFAULT_THEME, FRAME_MAX_BYTES, acceptFrameUrl, acceptHeight, escapeAttr, frameFileName, frameMarkup,
} from "./html-frame-core";
import { colorerCode } from "./code-highlight";
import type { FrameTheme } from "./html-frame-core";

/* The DOM side of the sandboxed HTML frame (see html-frame-core.ts for the
   isolation rules). One listener for the whole window: it accepts a height
   only from a message whose `source` IS the content window of a frame we
   built, and reads nothing but the bounded `h` number. */

/** The theme variables of the app, read when a frame is built. */
export function readFrameTheme(): FrameTheme {
	if (typeof document === "undefined") return FRAME_DEFAULT_THEME;
	const cs = getComputedStyle(document.body || document.documentElement);
	const v = (name: string, repli: string): string => cs.getPropertyValue(name).trim() || repli;
	const d = FRAME_DEFAULT_THEME;
	const bg = v("--background-primary", d.bg);
	const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(bg);
	const dark = m ? (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) < 140 : d.dark;
	return {
		bg,
		fg: v("--text-normal", d.fg),
		muted: v("--text-muted", d.muted),
		accent: v("--interactive-accent", d.accent),
		border: v("--background-modifier-border", d.border),
		font: v("--font-text", d.font),
		dark,
	};
}

/** The markup of a frame for `source` (empty string for no page). `name`: what a
    saved copy is called (the card title), else the page's own `<title>`. */
export function htmlFrameMarkup(source: unknown, name = ""): string {
	return frameMarkup(source, readFrameTheme(), {
		title: t("engine.htmlFrame.title"),
		tooLarge: t("engine.htmlFrame.tooLarge"),
	}, typeof publisher() === "function", name);
}

/** The host's page publisher (Android), or undefined (desktop: `srcdoc`). */
function publisher(): ((doc: string) => Promise<string | null>) | undefined {
	try {
		const platform = currentHost().platform;
		return platform.publishHtmlFrame?.bind(platform);
	} catch {
		return undefined;
	}
}

/** Points the iframes that wait for a published page at their route. A refusal or a failure falls back to
    `srcdoc` (static content, as before: the host's CSP blocks its scripts, but the page still shows). */
function publierCadres(racine: ParentNode): void {
	const publish = publisher();
	racine.querySelectorAll<HTMLIFrameElement>("iframe.nq-html-frame-view[data-nq-doc]").forEach(f => {
		const doc = f.getAttribute("data-nq-doc") ?? "";
		f.removeAttribute("data-nq-doc");
		const repli = (): void => { if (f.isConnected) f.srcdoc = doc; };
		if (!publish) { repli(); return; }
		publish(doc).then(chemin => {
			const ok = acceptFrameUrl(chemin);
			if (!f.isConnected) return;
			if (ok) f.src = ok; else repli();
		}, repli);
	});
}

/** A frame that never reports its height (a host whose own CSP is inherited
    by `srcdoc` documents and blocks their inline script: the Android app)
    still shows its static content, at a fixed height, instead of 120 px. */
const SILENCE_MS = 2500;
const HAUTEUR_STATIQUE = 360;

function surveillerSilence(racine: ParentNode): void {
	racine.querySelectorAll<HTMLIFrameElement>("iframe.nq-html-frame-view").forEach(f => {
		if (f.dataset.nqWatched === "1") return;
		f.dataset.nqWatched = "1";
		window.setTimeout(() => {
			if (f.isConnected && f.dataset.nqHeard !== "1") { f.style.height = HAUTEUR_STATIQUE + "px"; f.classList.add("is-static"); }
		}, SILENCE_MS);
	});
}

let ecouteurPose = false;

function poserEcouteur(): void {
	if (ecouteurPose || typeof window === "undefined") return;
	ecouteurPose = true;
	window.addEventListener("message", (e: MessageEvent) => {
		for (const f of document.querySelectorAll<HTMLIFrameElement>("iframe.nq-html-frame-view")) {
			if (f.contentWindow && f.contentWindow === e.source) {
				const h = acceptHeight(e.data, true);
				if (h !== null) { f.style.height = h + "px"; f.dataset.nqHeard = "1"; }
				return;
			}
		}
	});
}

/** Two frames repaint before a capture: the ⋯ button and its menu are gone from the picture. */
const deuxImages = (): Promise<void> => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res())));

/** "Copy as image": the frame AS SHOWN, interactive state included. Only its
    rectangle in the viewport crosses to the host, which captures it. */
async function copierImage(cadre: HTMLElement, copy: NonNullable<HostPlatformLike["copyFrameImage"]>): Promise<void> {
	const vue = cadre.querySelector<HTMLIFrameElement>("iframe.nq-html-frame-view");
	if (!vue) return;
	const ui = currentHost().ui;
	cadre.classList.add("is-capturing");
	try {
		vue.scrollIntoView({ block: "nearest", inline: "nearest" });
		await deuxImages();
		const r = vue.getBoundingClientRect();
		const x = Math.max(0, r.left), y = Math.max(0, r.top);
		const width = Math.min(window.innerWidth, r.right) - x, height = Math.min(window.innerHeight, r.bottom) - y;
		const ok = width >= 1 && height >= 1 && await copy({ x, y, width, height });
		ui.notice(t(ok ? "engine.htmlFrame.copied" : "engine.htmlFrame.copyFailed"));
	} catch {
		ui.notice(t("engine.htmlFrame.copyFailed"));
	} finally {
		cadre.classList.remove("is-capturing");
	}
}

/** "Download as HTML": the page SOURCE as the note holds it (the hidden code
    view keeps it verbatim), never the rendered document. */
async function enregistrerHtml(cadre: HTMLElement, save: NonNullable<HostPlatformLike["saveFrameHtml"]>): Promise<void> {
	const source = cadre.querySelector(".nq-html-frame-source code")?.textContent ?? "";
	if (!source.trim()) return;
	try {
		await save(frameFileName(cadre.dataset.nqName, source, t("engine.htmlFrame.fileName")), source);
	} catch {
		currentHost().ui.notice(t("engine.htmlFrame.saveFailed"));
	}
}

type HostPlatformLike = ReturnType<typeof currentHost>["platform"];

/** "View the code": the page source in the app's centred modal, coloured
    like every code block of a quiz (`code-highlight.ts`, Tokyo Night of
    `.quiz-md-code`), scrolling inside, with a Copy button. */
function voirCode(cadre: HTMLElement): void {
	const host = currentHost();
	const source = cadre.querySelector(".nq-html-frame-source code")?.textContent ?? "";
	if (!host.modals || !source) return;
	host.modals.open({
		className: "nq-html-code-modal",
		title: t("engine.htmlFrame.codeTitle"),
		titleIcon: el => host.ui.setIcon(el, "code"),
		onOpen: h => {
			const bloc = document.createElement("div");
			bloc.className = "nq-html-code";
			const copier = document.createElement("button");
			copier.type = "button";
			copier.className = "nq-html-code-copy";
			host.ui.setIcon(copier, "copy");
			copier.append(document.createTextNode(t("engine.htmlFrame.copyCode")));
			copier.addEventListener("click", () => {
				void Promise.resolve(host.shell.copyText?.(source) ?? false).catch(() => false)
					.then(ok => host.ui.notice(t(ok ? "engine.htmlFrame.codeCopied" : "engine.htmlFrame.codeCopyFailed")));
			});
			const pre = document.createElement("pre");
			pre.className = "quiz-md-code nq-html-code-pre";
			const code = document.createElement("code");
			code.className = "language-html";
			/* The coloured HTML is built from ESCAPED text by `colorerCode` (spans of
			   token classes only); without a grammar, the text goes in as text. */
			const colore = colorerCode(source, "html", escapeAttr, Infinity, FRAME_MAX_BYTES);
			if (colore) code.innerHTML = colore.html; else code.textContent = source;
			pre.append(code);
			bloc.append(copier, pre);
			h.contentEl.append(bloc);
		},
	});
}


/** Puts the menu UNDER the ⋯ button, its right edge on the button's, whole and
    inside the window (above the button when there is no room below). */
function placerMenu(btn: HTMLElement): void {
	const menu = [...document.querySelectorAll<HTMLElement>("body > .qbd-action-menu.nq-frame-menu")].pop();
	if (!menu) return;
	const b = btn.getBoundingClientRect();
	const m = menu.getBoundingClientRect();
	const vw = window.innerWidth, vh = window.innerHeight;
	const left = Math.min(Math.max(8, b.right - m.width), vw - 8 - m.width);
	const below = b.bottom + 4;
	const top = below + m.height <= vh - 8 ? below : Math.max(8, b.top - 4 - m.height);
	menu.style.left = Math.max(8, left) + "px";
	menu.style.top = top + "px";
}

/** The ⋯ button of each frame (just above its top right corner, shown on hover, always on touch):
    the actions the host offers, then the code. */
function poserMenus(racine: ParentNode): void {
	let platform: HostPlatformLike;
	try { platform = currentHost().platform; } catch { return; }
	const copy = platform.copyFrameImage?.bind(platform);
	const save = platform.saveFrameHtml?.bind(platform);
	racine.querySelectorAll<HTMLElement>(".nq-html-frame[data-nq-frame]").forEach(cadre => {
		if (cadre.querySelector(":scope > .nq-html-frame-more")) return;
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "nq-html-frame-more";
		btn.setAttribute("aria-label", t("engine.htmlFrame.more"));
		btn.setAttribute("aria-haspopup", "menu");
		currentHost().ui.setIcon(btn, "ellipsis");
		cadre.insertBefore(btn, cadre.firstChild);
		btn.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			const items: ActionMenuItem[] = [];
			if (copy) items.push({ icon: "copy", label: t("engine.htmlFrame.copyImage"), onClick: () => { void copierImage(cadre, copy); } });
			if (save) items.push({ icon: "download", label: t("engine.htmlFrame.downloadHtml"), onClick: () => { void enregistrerHtml(cadre, save); } });
			if (currentHost().modals) items.push({ icon: "code", label: t("engine.htmlFrame.showCode"), onClick: () => voirCode(cadre) });
			if (!items.length) return;
			openActionMenu(btn, items, { className: "qbd-menu-claude nq-frame-menu" });
			placerMenu(btn);
		});
	});
}

/** Wires the frames of a subtree: the height listener (once for the window)
    and the ⋯ menu. Idempotent. */
export function brancherCadres(racine: ParentNode): void {
	publierCadres(racine);
	surveillerSilence(racine);
	if (!racine.querySelector(".nq-html-frame[data-nq-frame]")) return;
	poserEcouteur();
	poserMenus(racine);
}
