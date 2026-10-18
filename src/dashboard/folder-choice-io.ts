/* ══════════════════════════════════════════════════════════
   WHERE A GENERATED QUIZ GOES — the disk side (2026-10-17)

   The thin I/O around `folder-choice.ts`: it reads the default root's first
   level to find the current school-year folder, reuses a folder that already
   has the name, and creates the new one with `fs.mkdirs`. The rules
   themselves (name sanitising, parent choice, matching) are pure, there.
══════════════════════════════════════════════════════════ */

import { currentHost } from "../host/current";
import { LOG_PREFIX } from "../branding";
import { t } from "../i18n";
import { libelleCategorie } from "./categorie-affichage";
import type { CategorieQuiz } from "./categorie-quiz";
import { MODULE_ICONS } from "./module-icons";
import { fallbackFolderName, iconForNewFolder, findFolderByName, newFolderLocalPath, safeFolderName, sameFolderName, yearFolderForNewFolder, type KnownFolder } from "./folder-choice";

/** The folders that hold a quiz, from the catalogue's paths (what the queue
    knows when the page's folder list is not at hand). */
export function foldersOfQuizzes(quizzes: readonly { path: string }[]): KnownFolder[] {
	const seen = new Map<string, KnownFolder>();
	for (const q of quizzes) {
		const cut = q.path.lastIndexOf("/");
		if (cut <= 0) continue;
		const path = q.path.slice(0, cut);
		if (!seen.has(path)) seen.set(path, { path, name: path.split("/").pop() ?? path });
	}
	return [...seen.values()];
}

/** Declares the icon of a folder the request just created (the caller stores
    it exactly as the learner's own choice is stored). */
export type DeclareFolderIcon = (path: string, icon: string) => Promise<void>;

/** The folder called `raw`: a known folder of that name, else one already on
    disk in the school-year folder (or at the root), else a NEW folder created
    there. Its contract path, or null when the name is unusable (empty, a
    reserved Windows name...). A refused `mkdirs` rejects. `icon`: the AI's
    icon for a NEW folder, handed to `declareIcon` only when this call created
    the folder (a folder already known or on disk keeps its own icon). */
export async function folderNamed(raw: string, known: readonly KnownFolder[], now: Date = new Date(), icon?: string, declareIcon?: DeclareFolderIcon): Promise<string | null> {
	const name = safeFolderName(raw);
	if (!name) return null;
	const host = currentHost();
	const root = host.paths.defaultRoot();
	const subfolders = async (dir: string): Promise<string[]> => {
		try { return (await host.fs.listDir(dir)).filter(e => e.isFolder).map(e => e.name); } catch { return []; }
	};
	const year = yearFolderForNewFolder(await subfolders(root.id), now);
	const parent = host.paths.contractPath(root.id, year ?? "");
	const existing = findFolderByName(name, known, parent);
	if (existing) {
		// A declared folder may be missing on disk: `mkdirs` is a no-op when it is there.
		await host.fs.mkdirs(existing.path);
		return existing.path;
	}
	const onDisk = (await subfolders(parent)).find(n => sameFolderName(n, name));
	const path = host.paths.contractPath(root.id, newFolderLocalPath(onDisk ?? name, year));
	await host.fs.mkdirs(path);
	const chosen = iconForNewFolder(!onDisk, icon, MODULE_ICONS);
	if (chosen && declareIcon) {
		// The icon is a nicety: a failure never blocks the generation.
		try { await declareIcon(path, chosen); } catch (e) { console.warn(LOG_PREFIX, "folder icon not stored:", path, e); }
	}
	return path;
}

/** The fallback folder of a request nothing else placed (the clarify call
    failed or was skipped, a request from the phone): one named after the
    detected subject ("Python"), or "Quizzes" for no subject; reused when it
    exists. The default root itself when even that cannot be created. */
export async function fallbackFolder(subject: CategorieQuiz, known: readonly KnownFolder[]): Promise<string> {
	const generic = t("ai.folder.generic");
	const name = fallbackFolderName(subject, subject === "general" ? generic : libelleCategorie(subject), generic);
	try {
		const path = await folderNamed(name, known);
		if (path) return path;
	} catch (e) {
		console.warn(LOG_PREFIX, "fallback quiz folder not created:", name, e);
	}
	const host = currentHost();
	return host.paths.contractPath(host.paths.defaultRoot().id, "");
}
