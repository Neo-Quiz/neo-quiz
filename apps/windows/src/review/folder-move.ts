import type { HostPaths } from "../../../../src/host/types";
import type { ModuleOverride } from "../../../../src/dashboard/quiz-modules";
import type { DashboardPageSettings } from "../../../../src/types/dashboard-ctx";
import { cleModule } from "./catalogue";

/* ══════════════════════════════════════════════════════════
   WHAT FOLLOWS A MOVE (2026-10-01). A folder (or a quiz) moved from `from` to
   `to` kept its review log and its stats, but not what the app keeps in its
   own settings: exams, saved sessions, remembered test setups and the folder
   paths of the page settings stayed under the OLD keys, so a moved course
   lost them without a word. This module is PURE (no bridge, no DOM): every
   store is injected, so `check:move-quiz` runs the real code on memory.

   Keys decided one by one (see the task report):
   - path-keyed, renamed by prefix: `quizSessions`, `testSetups`;
   - module-keyed (`<rootId>/<folder>`): `examens`;
   - path VALUES: `quizzesModuleOverrides[*].path`, `quizzesModuleMapNote`;
   - keyed by a folder NAME (`quizzesArchivedFolders`, `quizzesExpandedFolders`,
     the override keys): a folder lands under its last segment, so the name
     does not change and nothing is renamed.
══════════════════════════════════════════════════════════ */

/** `path` is `from` itself or lies under it. */
export function sousPrefixe(path: string, from: string): boolean {
	return path === from || path.startsWith(from + "/");
}

/** Renames, IN PLACE, every key of `table` that is `from` or lies under it
    (`Efrei/Reseaux2` is NOT under `Efrei/Reseaux`). True when something moved. */
export function renommerCles(table: Record<string, unknown>, from: string, to: string): boolean {
	let bouge = false;
	for (const cle of Object.keys(table)) {
		if (!sousPrefixe(cle, from)) continue;
		const valeur = table[cle];
		delete table[cle];
		table[to + cle.slice(from.length)] = valeur;
		bouge = true;
	}
	return bouge;
}

export interface MovedPrefixDeps {
	paths: () => HostPaths;
	/** The contract paths of every quiz the catalogue knows. */
	quizPaths: () => string[];
	/** Moves the exam lists from each old module key to its new one. */
	renameExams: (pairs: ReadonlyArray<readonly [string, string]>) => Promise<void>;
	sessions?: { renommer(from: string, to: string): void; vider(): Promise<void> };
	testSetups: () => Promise<{ renamed(from: string, to: string): void }>;
	/** The live page-settings object (the one `ctx.settings` is) and its writer. */
	pageSettings: () => DashboardPageSettings;
	savePageSettings: () => Promise<void>;
}

export function createMovedPrefix(deps: MovedPrefixDeps): (from: string, to: string) => Promise<void> {
	return async (from, to) => {
		if (from === to) return;
		const paths = deps.paths();

		/* EXAMS: keyed by module (`<rootId>/<parent folder>`), so the folder's own
		   key changes root, and so does that of each sub-folder holding a quiz. */
		const paires = new Map<string, string>();
		const ajouter = (ancien: string, nouveau: string): void => {
			const a = cleModule(ancien, paths);
			const b = cleModule(nouveau, paths);
			if (a !== b) paires.set(a, b);
		};
		ajouter(from + "/_", to + "/_");
		for (const p of deps.quizPaths()) {
			if (p.startsWith(from + "/")) ajouter(p, to + p.slice(from.length));
		}
		await deps.renameExams([...paires]);

		deps.sessions?.renommer(from, to);
		await deps.sessions?.vider();
		(await deps.testSetups()).renamed(from, to);

		const reglages = deps.pageSettings();
		let change = false;
		for (const ov of Object.values(reglages.quizzesModuleOverrides ?? {}) as ModuleOverride[]) {
			if (ov?.path && sousPrefixe(ov.path, from)) { ov.path = to + ov.path.slice(from.length); change = true; }
		}
		const note = reglages.quizzesModuleMapNote;
		if (note && sousPrefixe(note, from)) { reglages.quizzesModuleMapNote = to + note.slice(from.length); change = true; }
		if (change) await deps.savePageSettings();
	};
}
