import { t } from "../i18n";
import {
	FRAME_DEFAULT_THEME, acceptHeight, frameMarkup,
} from "./html-frame-core";
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

/** The markup of a frame for `source` (empty string for no page). */
export function htmlFrameMarkup(source: unknown): string {
	return frameMarkup(source, readFrameTheme(), {
		title: t("engine.htmlFrame.title"),
		showCode: t("engine.htmlFrame.showCode"),
		hideCode: t("engine.htmlFrame.hideCode"),
		tooLarge: t("engine.htmlFrame.tooLarge"),
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

/** Wires the frames of a subtree: the height listener (once for the window)
    and the "view the code" toggles. Idempotent. */
export function brancherCadres(racine: ParentNode): void {
	surveillerSilence(racine);
	const boutons = racine.querySelectorAll<HTMLButtonElement>(".nq-html-frame-code");
	if (!boutons.length) return;
	poserEcouteur();
	boutons.forEach(btn => {
		if (btn.dataset.branchee === "1") return;
		btn.dataset.branchee = "1";
		btn.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			const src = btn.parentElement?.querySelector<HTMLElement>(".nq-html-frame-source");
			if (!src) return;
			const ouvert = src.hidden;
			src.hidden = !ouvert;
			btn.setAttribute("aria-expanded", ouvert ? "true" : "false");
			btn.textContent = (ouvert ? btn.dataset.hide : btn.dataset.show) || "";
		});
	});
}
