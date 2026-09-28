/* ══════════════════════════════════════════════════════════
   L'ARBRE DU MENU D'APPLICATION — pur

   Relu à chaque ouverture, pour que `t()` suive la langue et que la coche
   d'échelle suive le zoom courant. Aucun DOM, aucun pont : `check:menu-app`
   l'éprouve tel quel. Le PRODUIT n'est jamais traduit (`PRODUCT_NAME`).
══════════════════════════════════════════════════════════ */
import { t } from "../../../../src/i18n";
import { PRODUCT_NAME } from "../../../../src/branding";

export type EntreeMenu =
	| { kind: "version"; id: string; label: string }
	| { kind: "action"; id: string; label: string; shortcut?: string; disabled?: boolean }
	| { kind: "check"; id: string; label: string; value: number; checked: boolean }
	| { kind: "separator"; id: string }
	| { kind: "submenu"; id: string; label: string; items: EntreeMenu[] };

/** A browser's zoom steps from 25 %, capped at 150 % (both asked on
    2026-09-28). The bounds of the main process (`canaux.ts`, `main.ts`) are
    the first and last. */
export const PALIERS_ZOOM = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.33, 1.4, 1.5];

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
		{ kind: "submenu", id: "app", label: PRODUCT_NAME, items: [
			{ kind: "version", id: "version", label: ctx.version },
			{ kind: "action", id: "check-updates", label: t("app.menu.checkUpdates") },
			/* Le lien vers le dépôt, arrivé ici le 2026-09-17 avec la
			   suppression de la section « À propos » des Réglages : il
			   appartient au même bloc que la version, qui est déjà dans ce
			   menu. La clé est celle qu'il portait là-bas — inchangée, comme
			   son URL (`manifest.json`, `helpUrl`). */
			{ kind: "action", id: "repo", label: t("settings.about.repo") },
			{ kind: "action", id: "settings", label: t("app.menu.settings"), shortcut: "Ctrl+," },
		] },
		{ kind: "submenu", id: "edit", label: t("app.menu.edit"), items: [
			{ kind: "action", id: "undo", label: t("app.menu.undo"), shortcut: "Ctrl+Z" },
			{ kind: "action", id: "redo", label: t("app.menu.redo"), shortcut: "Ctrl+Y" },
			{ kind: "separator", id: "edit-sep" },
			{ kind: "action", id: "cut", label: t("app.menu.cut"), shortcut: "Ctrl+X" },
			{ kind: "action", id: "copy", label: t("app.menu.copy"), shortcut: "Ctrl+C" },
			{ kind: "action", id: "paste", label: t("app.menu.paste"), shortcut: "Ctrl+V" },
			{ kind: "action", id: "select-all", label: t("app.menu.selectAll"), shortcut: "Ctrl+A" },
		] },
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
