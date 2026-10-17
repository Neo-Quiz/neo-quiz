/* ══════════════════════════════════════════════════════════
   WHERE A GENERATED QUIZ GOES (2026-10-17) — pure

   There is no "Generated" folder any more, and no folder picker in the
   composer: each quiz goes to a real course folder. The page decides it in
   this order (ai.ts, `clarifier`):
   1. a folder the context already fixes (the chat's folder, an exam's course
      folder, "Create with AI" from a folder);
   2. the attached documents: the DEEPEST known folder that holds all of them
      (`folderOfAttachments`);
   3. the clarify call: an existing folder it names, or the answer to its
      "which folder" question (an existing name, or a new one);
   4. a folder named after the detected subject ("Python"), or a generic
      "Quizzes" for a request with no subject.
   A NEW folder sits next to the course folders: in the current school-year
   folder of the default root ("B2 2026-2027", `yearFolderForNewFolder`), else
   at the root itself. An existing folder of the same name (case and Unicode
   form ignored) is reused, never doubled as "X (2)".

   No host, no DOM, no clock (`now` is an input). The I/O lives in
   `folder-choice-io.ts`. `npm run check:folder-suggest` holds this module.
══════════════════════════════════════════════════════════ */

import { baseNameVerdict } from "./share-names";
import { YEAR_FOLDER_RE, currentSchoolYearStart } from "./year-folders";

/** A folder the app knows: its contract path and its displayed name. */
export interface KnownFolder { path: string; name: string }

/** The form two folder names are compared in: NFC, trimmed, lower case. */
export function foldFolderName(name: string): string {
	return String(name ?? "").normalize("NFC").trim().toLowerCase();
}

/** Do two folder names designate the same folder on a case-insensitive file system? */
export function sameFolderName(a: string, b: string): boolean {
	return foldFolderName(a) === foldFolderName(b);
}

/** A folder name the app may create, as ONE path segment, or null when nothing
    usable is left. The share name rules (`share-names.ts`: NFC, forbidden and
    invisible characters, reserved Windows names, length), plus: no separator
    of either kind and never a `..` (a name proposed by a model or typed by the
    learner is untrusted text). */
export function safeFolderName(raw: string): string | null {
	const flat = String(raw ?? "").replace(/[\\/]+/g, " ").replace(/\.{2,}/g, ".").replace(/\s+/g, " ");
	const v = baseNameVerdict(flat);
	if (!v.ok) return null;
	return /[\\/]/.test(v.name) || v.name.includes("..") ? null : v.name;
}

const lastSegment = (path: string): string => path.split("/").filter(Boolean).pop() ?? "";

/** The known folder called `name` (its displayed name or its own segment),
    case and Unicode form ignored, or null. Several of that name: the first
    one under `preferParent` when given, else the first in the list. */
export function findFolderByName(name: string, folders: readonly KnownFolder[], preferParent?: string): KnownFolder | null {
	if (!foldFolderName(name)) return null;
	const matches = folders.filter(f => !!f.path && (sameFolderName(f.name, name) || sameFolderName(lastSegment(f.path), name)));
	if (!matches.length) return null;
	return (preferParent ? matches.find(f => f.path.startsWith(preferParent + "/")) : undefined) ?? matches[0];
}

/** The DEEPEST known folder holding every attached document, or null. Only the
    documents with a path count (a file dropped from nowhere has no place);
    none with a path, or documents spread over several folders: null, and the
    clarify call decides. */
export function folderOfAttachments(paths: readonly (string | undefined)[], folders: readonly KnownFolder[]): KnownFolder | null {
	const placed = paths.filter((p): p is string => typeof p === "string" && p.length > 0);
	if (!placed.length) return null;
	const holding = folders.filter(f => !!f.path && placed.every(p => p.startsWith(f.path + "/")));
	return [...holding].sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}

const DATED_YEAR_RE = /^B(\d+)\s+\(?(\d{4})-\d{4}(?!\d)/;

/** The year folder of the root a NEW quiz folder goes in: among the root's
    first-level folders (`rootFolders`), the one dated with the current school
    year ("B2 2026-2027" in October 2026); else the highest level (the
    learner's latest year), the latest year then the name breaking ties; null
    when the root has no year folder (the new folder then sits at the root). */
export function yearFolderForNewFolder(rootFolders: readonly string[], now: Date): string | null {
	const years = rootFolders.filter(n => YEAR_FOLDER_RE.test(n)).sort((a, b) => a.localeCompare(b));
	if (!years.length) return null;
	const start = currentSchoolYearStart(now);
	const info = years.map(name => {
		const dated = DATED_YEAR_RE.exec(name);
		return { name, level: Number(/^B(\d+)/.exec(name)?.[1] ?? 0), start: dated ? Number(dated[2]) : null };
	});
	const current = info.find(y => y.start === start);
	if (current) return current.name;
	return [...info].sort((a, b) => b.level - a.level || (b.start ?? 0) - (a.start ?? 0) || a.name.localeCompare(b.name))[0].name;
}

/** The local path (inside the root) of a new folder `name`. */
export function newFolderLocalPath(name: string, yearFolder: string | null): string {
	return yearFolder ? `${yearFolder}/${name}` : name;
}

/** The name of the fallback folder: the subject's displayed label ("Python"),
    or `generic` ("Quizzes") for a request with no subject or a label that
    cannot be a folder name. */
export function fallbackFolderName(subject: string, label: string, generic: string): string {
	if (subject === "general") return safeFolderName(generic) ?? "Quizzes";
	return safeFolderName(label) ?? safeFolderName(generic) ?? "Quizzes";
}

/** The known folders, deduplicated by path, most relevant first as given, at
    most `max` NAMES for the clarify prompt (one name per distinct folder name). */
export function folderNamesForPrompt(folders: readonly KnownFolder[], max = 60): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const f of folders) {
		const name = (f.name || lastSegment(f.path)).trim();
		const key = foldFolderName(name);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(name);
		if (out.length >= max) break;
	}
	return out;
}
