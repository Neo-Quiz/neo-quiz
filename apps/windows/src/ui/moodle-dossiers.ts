/* ══════════════════════════════════════════════════════════
   MOODLE AND THE FOLDERS PAGE (2026-10-17)

   - A FAVOURITE Moodle module is a folder of the Folders page: when the
     Moodle window learns the course list (and each time a star is set), the
     folder of each favourite is declared there (an override with its path,
     like "New folder"), and created on disk when Moodle has not made it yet.
     Unstarring never removes a folder: it holds the student's work.
   - The timetable says when a module's LAST session ended (`planningVolumes`):
     the Folders page moves those folders to an "Ended" section at the bottom
     (`moduleEnded` of the dashboard context). The ends are kept here, read
     once at start and refreshed by the Moodle window.
══════════════════════════════════════════════════════════ */

import type { CoursMoodle } from "../../electron/pont";
import { pont } from "../host/pont";
import { currentHost } from "../../../../src/host/current";
import type { DashboardShellCtx } from "../../../../src/types/dashboard-ctx";
import { ensureFolder } from "../../../../src/dashboard/folder-create";
import { saveSettingsReporting } from "../../../../src/dashboard/save-settings";
import { suggestIcons } from "../../../../src/dashboard/icon-suggest";

/** End of the last session per module code (epoch ms), from the timetable. */
const fins = new Map<string, number>();

/** The course code a folder name starts with ("XTI306 - ..." gives XTI306), or null. */
export function codeDuDossier(nom: string): string | null {
	const m = /^([A-Z]{2,5}\d{3})(?!\d)/.exec(nom.split("/").pop() ?? "");
	return m ? m[1] : null;
}

/** When the module of this folder ended (epoch ms), or null: no code, no timetable, or not over yet. */
export function finDuDossier(dossier: string, maintenant = Date.now()): number | null {
	const code = codeDuDossier(dossier);
	const fin = code ? fins.get(code) : undefined;
	return fin !== undefined && fin < maintenant ? fin : null;
}

/** Takes the ends of a timetable answer (the Moodle window passes its own). */
export function noterFins(volumes: Record<string, { fin: number }>): void {
	for (const [code, v] of Object.entries(volumes)) if (Number.isFinite(v.fin)) fins.set(code, v.fin);
}

/** Reads the ends for the codes of the declared folders (start of the app). No timetable: nothing. */
export async function chargerFins(ctx: DashboardShellCtx): Promise<boolean> {
	const api = pont().moodle;
	if (!api) return false;
	const codes = [...new Set(Object.keys(ctx.settings.quizzesModuleOverrides || {}).map(codeDuDossier).filter((c): c is string => !!c))];
	if (!codes.length) return false;
	const v = await api.planningVolumes(codes).catch(() => ({}));
	noterFins(v);
	return Object.keys(v).length > 0;
}

/** Declares the folder of every favourite that the Folders page does not show
    yet (creating it on disk if needed). Returns whether anything changed. */
export async function declarerFavoris(ctx: DashboardShellCtx, cours: readonly CoursMoodle[]): Promise<boolean> {
	const host = currentHost();
	const racine = host.paths.defaultRoot().id;
	const overrides = Object.assign(Object.create(null), ctx.settings.quizzesModuleOverrides || {}) as NonNullable<DashboardShellCtx["settings"]["quizzesModuleOverrides"]>;
	let change = false;
	for (const co of cours) {
		if (!co.favori || !co.code || !co.folder) continue;
		const cle = co.folder.split("/").pop() as string;
		if (overrides[cle]?.path) continue;
		const chemin = `${racine}/${co.folder}`;
		if (!co.folderExists) {
			try { await ensureFolder(chemin); } catch { continue; }
		}
		const avant = overrides[cle] || {};
		const icone = avant.icon || suggestIcons(cle, null, 1)[0];
		overrides[cle] = { ...avant, ...(icone ? { icon: icone } : {}), name: avant.name || cle, path: chemin };
		change = true;
	}
	if (!change) return false;
	ctx.settings.quizzesModuleOverrides = overrides;
	saveSettingsReporting(() => ctx.saveSettings());
	return true;
}
