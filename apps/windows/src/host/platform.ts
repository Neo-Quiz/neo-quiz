/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — LA PLATEFORME

   `HostPlatform` (`src/host/types.ts`) pour l'application. Extrait de
   `./index.ts` à la tâche 2 de la génération IA, et pour la raison que ce
   fichier-là donne déjà à `roots.ts` : `index.ts` importe MathLive, qu'esbuild
   ne charge pas hors de la fenêtre, donc rien de ce qu'il contient n'est
   éprouvable par `npm run check:windows-host`. Or `isDesktopApp` est LA
   valeur que la génération IA lit pour décider si la page « Générer » a un
   sens ; un `false` glissé là par mégarde la rendrait morte dans l'app, sans
   qu'aucun contrôle ne le dise.
══════════════════════════════════════════════════════════ */

import type { HostPlatform } from "../../../../src/host/types";
import type { Pont } from "../../electron/pont";

/** The bridge, when this module runs in a window (`globalThis`: the check loads it outside any). */
function pont(): Pick<Pont, "frameImage" | "frameHtml"> | undefined {
	return (globalThis as { window?: { neo?: Pick<Pont, "frameImage" | "frameHtml"> } }).window?.neo;
}

/** Ce que Chromium dit du système. `globalThis.navigator` et non `navigator`
    nu : ce module est chargé par le contrôle hors de toute fenêtre, et rend
    alors la chaîne vide — donc « ni Mac ni Windows », l'état le plus neutre. */
function plateformeChromium(): string {
	const nav = globalThis.navigator as (Navigator & { userAgentData?: { platform?: string } }) | undefined;
	return nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || "";
}

/** True when the renderer runs in the Android app's WebView: its document-start
    shim sets `window.neoPlatform = { mobile: true }` (`apps/android/web/shim.ts`).
    Read through `globalThis` because this module is loaded outside any window
    by `check:windows-host`. Absent on Windows, so the answer there stays false. */
export function estMobile(): boolean {
	return Boolean((globalThis as { neoPlatform?: { mobile?: boolean } }).neoPlatform?.mobile);
}

export function createWindowsPlatform(): HostPlatform {
	return {
		isMobile: estMobile(),
		/* La fenêtre tourne sous Windows aujourd'hui, mais le paquet se
		   construit aussi pour Linux (`pack:linux`) : la question est posée à
		   Chromium plutôt que répondue en dur. `userAgentData.platform` quand
		   il existe (Chromium moderne), `userAgent` sinon — et « macOS » n'est
		   PAS déduit de « pas Windows » : les deux sont lus séparément, sans
		   quoi un Linux passerait pour un Mac. */
		get isMacOS(): boolean {
			return /mac/i.test(plateformeChromium());
		},
		get isWindows(): boolean {
			return /win/i.test(plateformeChromium());
		},
		/* L'application EST un bureau : un CLI local se lance, un réseau est
		   atteignable (par le principal). C'est la question que la génération
		   IA pose, et la seule ; elle ne demande jamais « Electron ou
		   Obsidian ? ». */
		isDesktopApp: true,
		/* La langue de l'INTERFACE DE L'HÔTE. Ici l'hôte est la fenêtre
		   elle-même : `navigator.language` rend la langue du système, que
		   Chromium reprend de Windows. Accesseur et non valeur figée, par
		   symétrie avec l'hôte Obsidian ; c'est `src/i18n.ts` qui décide ce
		   qu'il en fait, pas l'hôte. `globalThis.navigator` et non `navigator`
		   nu : ce module est chargé par le contrôle hors de toute fenêtre. */
		get uiLanguage(): string {
			return globalThis.navigator?.language || "en";
		},
		/* Android only: the WebView's CSP is inherited by `srcdoc`, so the page of an interactive frame is
		   served by the app under its own CSP (`bridge/HtmlFrameRoute.kt`). Absent on Windows. */
		get publishHtmlFrame(): HostPlatform["publishHtmlFrame"] {
			const android = estMobile() ? (globalThis as { window?: { neo?: { android?: { publierCadre(doc: string): Promise<string | null> } } } }).window?.neo?.android : undefined;
			return android ? (doc: string) => android.publierCadre(doc) : undefined;
		},
		/* The ⋯ menu of an interactive page (`src/engine/html-frame.ts`): only what the bridge offers. */
		get copyFrameImage(): HostPlatform["copyFrameImage"] {
			const img = pont()?.frameImage;
			return img ? rect => img.copy(rect) : undefined;
		},
		get saveFrameHtml(): HostPlatform["saveFrameHtml"] {
			const html = pont()?.frameHtml;
			return html ? (name, doc) => html.save(name, new TextEncoder().encode(doc)) : undefined;
		},
	};
}
