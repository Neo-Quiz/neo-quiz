import { currentHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import type { Scanner } from "../../../../src/dashboard/scanner";
import type { DashboardShellCtx } from "../../../../src/types/dashboard-ctx";
import { importArchiveAsFolder, importFileIntoFolder } from "../../../../src/dashboard/folder-create";
import { MODULE_MAP_VIDE } from "../../../../src/dashboard/module-map-note";
import { defaultParent } from "../../../../src/dashboard/module-edit";
import { IMPORT_LIMITS, nomNoteImportee } from "../../../../src/dashboard/zip";
import { pont } from "../host/pont";

/* ══════════════════════════════════════════════════════════
   A FILE ANOTHER APP HANDED TO NEO QUIZ (Android: "Open with", "Share to").
   Kotlin has already copied it to the cache, checked its name and bounded
   its size; it reaches the page exactly like a file picked by hand, and runs
   the SAME import as the picker (plan, staging, atomic move, same messages):
     - a .zip becomes a new folder (`importArchiveAsFolder`);
     - a lone .md becomes a quiz in a folder named after the note
       (`importFileIntoFolder`, which never overwrites).
   Nothing here is trusted: the importer validates the content.
══════════════════════════════════════════════════════════ */

/** The two `ctx` members `importArchiveAsFolder` touches. The folder's colour and icon from the
    archive's manifest are applied to the shell's own settings object, which this module does not
    hold: they are skipped here (the folder and its quizzes are all there). */
function contexteMinimal(): DashboardShellCtx {
	return { settings: {}, saveSettings: async () => {} } as unknown as DashboardShellCtx;
}

/** Reads the waiting file, if any, and imports it. Never throws: every outcome is a notice. */
export async function lireFichierRecu(scanner: Scanner): Promise<void> {
	const recu = await pont().android?.fichierRecu().catch(() => null);
	if (!recu) return;
	const notice = (cle: "share.import.tooLarge" | "share.import.unreadable"): void => currentHost().ui.notice(t(cle));
	if ("erreur" in recu) {
		notice(recu.erreur === "trop-grand" ? "share.import.tooLarge" : "share.import.unreadable");
		return;
	}
	const { nom, octets } = recu;
	if (octets.length > IMPORT_LIMITS.archive) { notice("share.import.tooLarge"); return; }
	try {
		if (/\.zip$/i.test(nom)) {
			await importArchiveAsFolder(contexteMinimal(), MODULE_MAP_VIDE, scanner.getQuizzes(), { name: nom, bytes: octets }, () => {});
		} else if (/\.md$/i.test(nom)) {
			const dossier = `${defaultParent()}/${nomNoteImportee(nom) ?? "Quiz"}`.replace(/^\//, "");
			await importFileIntoFolder(dossier, { name: nom, bytes: octets }, () => {});
		} else {
			notice("share.import.unreadable");
		}
	} catch (e) {
		console.warn("[neo-quiz] importing a received file failed:", e);
		currentHost().ui.notice(t("share.import.failed"));
	}
}
