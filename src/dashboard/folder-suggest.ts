/* ══════════════════════════════════════════════════════════
   THE LEARNER'S FOLDERS, MOST RECENTLY TOUCHED FIRST — pure

   The order in which the AI page hands the learner's folders to the clarify
   call, which files each generated quiz (`folder-choice.ts`): the latest
   change of any file inside first. The composer's folder picker and its
   "Put it in X?" suggestions were removed on 2026-10-17: the AI chooses.
══════════════════════════════════════════════════════════ */

export interface FolderRef { path: string; name: string }
export interface FileRef { path: string; mtime: number; title: string }
export interface RankedFolder extends FolderRef { recent: number }

/** Lower case, accents and combining marks removed. */
export function fold(text: string): string {
	return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[‘’ʼ]/g, "'").toLowerCase();
}

/** The latest change of any file under each folder (0 when it holds none). */
export function recency(folders: readonly FolderRef[], files: readonly FileRef[]): Map<string, number> {
	const out = new Map<string, number>(folders.map(f => [f.path, 0]));
	for (const f of files) {
		for (const d of folders) {
			if (f.path.startsWith(d.path + "/") && f.mtime > (out.get(d.path) ?? 0)) out.set(d.path, f.mtime);
		}
	}
	return out;
}

/** The folders, most recently changed first; ties by name then path. `dates`:
    the folders' own modification dates (a PDF added changes the folder, not a
    note), the later of the two counting. */
export function rankFolders(folders: readonly FolderRef[], files: readonly FileRef[], dates?: ReadonlyMap<string, number>): RankedFolder[] {
	const r = recency(folders, files);
	return folders
		.map(f => ({ ...f, recent: Math.max(r.get(f.path) ?? 0, dates?.get(f.path) ?? 0) }))
		.sort((a, b) => b.recent - a.recent || fold(a.name).localeCompare(fold(b.name)) || a.path.localeCompare(b.path));
}
