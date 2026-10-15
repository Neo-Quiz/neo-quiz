/* ══════════════════════════════════════════════════════════
   FOLDER ARCHIVE — RETIRED, MERGED INTO "HIDE FROM LIST" (2026-10-15)

   Archiving a folder of "My quizzes" (per device, the `quizzesArchivedFolders`
   setting, a list of folder keys) and hiding it did nearly the same thing:
   one gesture is left, "Hide from list" (`folder-hidden.ts`), synced across
   devices and pausing the folder's reviews.

   Each device migrates ONCE (`migrateArchivedFolders`,
   `apps/windows/src/host/shared-state.ts`): every folder it had archived gets
   the synced `hidden` stamp, then the setting is no longer read. The stored
   list is LEFT IN PLACE, ignored, so a rollback to a version that reads it
   loses nothing.

   This module keeps the one pure decision of that migration, and stays free
   of any host and of the DOM (`check:dashboard-dom` lists it).
══════════════════════════════════════════════════════════ */

const MAX_KEYS = 1000;

/** The folders of the stored archive list to hide: the valid keys (non-empty
    strings, at most 200 characters, each once) that carry NO `hidden` stamp
    yet, whatever its value. A stamp means the folder was already hidden or
    shown again somewhere, maybe after it was archived here: stamping it now
    would hide again a folder the user brought back on another device. */
export function archivedFoldersToHide(stored: unknown, hasHiddenStamp: (key: string) => boolean): string[] {
	if (!Array.isArray(stored)) return [];
	const keys = new Set<string>();
	for (const k of stored.slice(0, MAX_KEYS)) {
		if (typeof k === "string" && k !== "" && k.length <= 200) keys.add(k);
	}
	return [...keys].filter(k => !hasHiddenStamp(k));
}
