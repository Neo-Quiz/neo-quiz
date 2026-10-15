import type { DashboardShellCtx } from "../types/dashboard-ctx";
import { applyModuleOverrides, moduleForQuiz } from "./quiz-modules";
import type { ModuleMap, ModuleOverride } from "./quiz-modules";

/* ══════════════════════════════════════════════════════════
   HIDDEN FOLDERS (2026-10-15)

   "Hide from list" in a folder card's ⋯ menu: the folder leaves the lists
   (My quizzes, Home, the subject filter) and comes back under the collapsed
   "Hidden" section at the bottom of My quizzes. Its quizzes, files and
   history are untouched.

   The flag is a FIELD of the folder settings (`ModuleOverride.hidden`,
   `"1"`), so it syncs across devices like the colour or the icon
   (`src/shared-state/merge.ts`): showing the folder again clears the field,
   which is a tombstone there, never a second value.

   Reviews are PAUSED while hidden: the review catalogue drops the questions
   of a hidden folder (`apps/windows/src/review/store.ts`), nothing is ever
   written to the journal. Showing the folder again gives back exactly the
   plan the journal derives, overdue questions included.

   A quiz belongs to a folder by `moduleForQuiz`, the rule the list itself
   groups with: what the page shows as hidden is what the catalogue pauses.
══════════════════════════════════════════════════════════ */

export const HIDDEN_VALUE = "1";

/** The keys of the hidden folders. */
export function hiddenFolders(overrides: Record<string, ModuleOverride> | undefined): string[] {
	return Object.entries(overrides || {}).filter(([, ov]) => ov?.hidden === HIDDEN_VALUE).map(([key]) => key);
}

export function isFolderHidden(ctx: DashboardShellCtx, folder: string): boolean {
	return ctx.settings.quizzesModuleOverrides?.[folder]?.hidden === HIDDEN_VALUE;
}

/** Sets or clears the flag on the folder's settings, in memory, then saves.
    Clearing removes the field (a settings entry left empty goes too). */
export function setFolderHidden(ctx: DashboardShellCtx, folder: string, on: boolean): Promise<void> {
	const overrides: Record<string, ModuleOverride> = { ...(ctx.settings.quizzesModuleOverrides || {}) };
	const { hidden: _old, ...rest } = overrides[folder] || {};
	if (on) overrides[folder] = { ...rest, hidden: HIDDEN_VALUE };
	else if (Object.keys(rest).length) overrides[folder] = rest;
	else delete overrides[folder];
	ctx.settings.quizzesModuleOverrides = overrides;
	return ctx.saveSettings();
}

/** A test "does the quiz at this path lie in a hidden folder?", built once
    for a whole list. `map`: the module table from the mapping note (empty
    when there is none); the overrides are applied on top, as every page
    does. Pure. */
export function hiddenQuizTest(overrides: Record<string, ModuleOverride> | undefined, map?: ModuleMap): (quizPath: string) => boolean {
	const hidden = new Set(hiddenFolders(overrides));
	if (!hidden.size) return () => false;
	const effective = applyModuleOverrides(map ?? { byFolder: new Map(), ueOrder: [] }, overrides || {});
	return (quizPath) => hidden.has(moduleForQuiz(quizPath, effective).folder);
}
