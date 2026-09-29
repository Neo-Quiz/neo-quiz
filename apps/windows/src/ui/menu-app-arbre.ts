/* ══════════════════════════════════════════════════════════
   L'ARBRE DU MENU D'APPLICATION — pur

   Relu à chaque ouverture, pour que `t()` suive la langue et que la coche
   d'échelle suive le zoom courant. Aucun DOM, aucun pont : `check:menu-app`
   l'éprouve tel quel. Le PRODUIT n'est jamais traduit (`PRODUCT_NAME`).
══════════════════════════════════════════════════════════ */
import { t } from "../../../../src/i18n";

export type EntreeMenu =
	/* ONE row at the top of the menu (2026-09-29): the version, "Check for
	   updates" and a GitHub mark. It replaces the "Neo Quiz" submenu, whose
	   three lines said the same thing in three rows, and whose "Settings…"
	   is gone (Ctrl+, and the rail's Settings button remain). */
	| { kind: "about"; id: string; version: string; checkLabel: string; repoLabel: string }
	| { kind: "action"; id: string; label: string; shortcut?: string; disabled?: boolean }
	| { kind: "check"; id: string; label: string; value: number; checked: boolean }
	| { kind: "separator"; id: string }
	| { kind: "submenu"; id: string; label: string; items: EntreeMenu[] };

/** A browser's zoom steps, from 75 % to 150 %. Every step was looked at on
    screen, on a small window and full screen (2026-09-29): 25, 33, 50 and
    67 % were removed, the page there was a narrow column of unreadable text.
    The first and last are the main process's bounds (`ZOOM_MIN`/`ZOOM_MAX`,
    electron/pont.ts). */
export const PALIERS_ZOOM = [0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.33, 1.4, 1.5];

/** The NEIGHBOUR step of a value, up (`1`) or down (`-1`): what Ctrl +
    wheel and the zoom bubble ask for (`ui/barre-titre.ts`), and the only way
    to ask for it without repeating the list elsewhere.

    It works at the check mark's TOLERANCE (a thousandth): the factor returned
    by `webContents.getZoomFactor` is not always the number written
    (1.0999999 for 1.1), and a strict comparison would return the same step
    twice, hence a wheel notch with no effect.

    A value OUTSIDE the bounds comes back into the list: from 2, a notch up
    finds no larger step and returns the last one (1.5). It is the same bound
    the main process applies on its side (`canaux.ts`), not a second rule. */
export function palierZoomVoisin(courant: number, sens: 1 | -1): number {
	const base = Number.isFinite(courant) ? courant : 1;
	if (sens === 1) return PALIERS_ZOOM.find(p => p > base + 0.001) ?? PALIERS_ZOOM[PALIERS_ZOOM.length - 1];
	return [...PALIERS_ZOOM].reverse().find(p => p < base - 0.001) ?? PALIERS_ZOOM[0];
}

export function buildMenu(ctx: { version: string; zoom: number }): EntreeMenu[] {
	return [
		/* The repository link came to this menu on 2026-09-17, when the
		   Settings' "About" section was removed: it belongs with the version.
		   Its key is the one it had there — unchanged, like its URL
		   (`manifest.json`, `helpUrl`); it is now the GitHub mark's name. */
		{ kind: "about", id: "about", version: ctx.version, checkLabel: t("app.menu.checkUpdates"), repoLabel: t("settings.about.repo") },
		{ kind: "separator", id: "about-sep" },
		/* No Edit submenu since 2026-09-29: its six commands only repeated
		   Ctrl+Z, Ctrl+Y (or Ctrl+Shift+Z), Ctrl+X, Ctrl+C, Ctrl+V and Ctrl+A,
		   which Chromium handles by itself in every field (Blink's
		   editing_behavior.cc); nobody reached them by the menu. */
		{ kind: "submenu", id: "view", label: t("app.menu.view"), items: [
			{ kind: "submenu", id: "scale", label: t("app.menu.scale"), items: PALIERS_ZOOM.map(p => ({
				kind: "check" as const, id: `scale-${Math.round(p * 100)}`, label: `${Math.round(p * 100)} %`, value: p,
				checked: Math.abs(p - ctx.zoom) < 0.001,
			})) },
			{ kind: "action", id: "next-wallpaper", label: t("app.menu.nextWallpaper"), shortcut: "Ctrl+Shift+B" },
			{ kind: "separator", id: "view-sep" },
			{ kind: "action", id: "reload", label: t("app.menu.reload"), shortcut: "Ctrl+R" },
			{ kind: "action", id: "fullscreen", label: t("app.menu.fullscreen"), shortcut: "F11" },
			{ kind: "action", id: "devtools", label: t("app.menu.devtools"), shortcut: "Ctrl+Alt+I" },
		] },
	];
}
