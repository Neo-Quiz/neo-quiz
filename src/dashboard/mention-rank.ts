/* Ranking and listing of the « @ » picker entries. PURE: no DOM, no host, no
   clock. The picker (`mention-picker.ts`) gathers the entries; this module
   decides which ones show and in what order, so that a check can run it on
   the real code (`scripts/check-mention-rank.mjs`).

   Rules, in order:
   - `@` alone: the direct children of the current folder (the root when there
     is none), files before folders; courses before quiz notes; most recently
     modified first.
   - `@word…`: every typed word must occur in the path (accents and case
     ignored). Rank by how the FIRST word matches the NAME: starts the name >
     opens a word of the name > occurs in the name > path only. Ties: the
     current folder (and its sub-folders) first, then the most recent file.
   - Noise: dotted folders (`.neo-quiz`, `.trash`), `Figures/` (images cut out
     by the app) and `Generated/` are listed only when a typed word names them. */

export interface MentionCandidate {
	name: string;
	/** Relative path (vault, or external root prefixed by its name). */
	path: string;
	isFolder: boolean;
	/** Modification time in ms. Absent for folders and external roots. */
	mtime?: number;
}

/** NFD, combining marks removed, lower case: the form every comparison uses. */
export function foldText(text: string): string {
	return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function wordsOf(text: string): string[] {
	return foldText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/* Folders the app keeps for itself. Listed only when a typed word names them. */
const APP_FOLDERS = new Set(["figures", "generated"]);

/* A quiz note as the app writes it: « <base> — Learn|Practice|Exam.md », with
   an optional « (2) » when a name is taken (quiz-format.ts). */
const QUIZ_NAME = /\s—\s(Learn|Practice|Exam)( \(\d+\))?\.md$/i;

export function isQuizNote(entry: MentionCandidate): boolean {
	return !entry.isFolder && QUIZ_NAME.test(entry.name);
}

/* True when one segment of the path is noise that no typed word names. */
export function isNoise(entry: MentionCandidate, words: readonly string[]): boolean {
	return entry.path.split("/").some(segment => {
		const folded = foldText(segment);
		if (!folded.startsWith(".") && !APP_FOLDERS.has(folded)) return false;
		const bare = folded.replace(/^\./, "");
		return !words.some(w => bare.startsWith(w));
	});
}

function listingOrder(a: MentionCandidate, b: MentionCandidate): number {
	if (a.isFolder !== b.isFolder) return a.isFolder ? 1 : -1;
	const quizA = isQuizNote(a) ? 1 : 0;
	const quizB = isQuizNote(b) ? 1 : 0;
	if (quizA !== quizB) return quizA - quizB;
	const dateA = a.mtime ?? 0;
	const dateB = b.mtime ?? 0;
	if (dateA !== dateB) return dateB - dateA;
	return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/* The contents of one folder, listed: noise removed, the listing order applied.
   `query` is the typed text, so that a folder it names is not hidden. */
export function orderListing<T extends MentionCandidate>(entries: readonly T[], query: string): T[] {
	const words = wordsOf(query);
	return entries.filter(e => !isNoise(e, words)).sort(listingOrder);
}

function parentOf(path: string): string {
	const cut = path.lastIndexOf("/");
	return cut < 0 ? "" : path.slice(0, cut);
}

/* 0 = the name starts with the word; 1 = a word of the name starts with it;
   2 = it occurs inside the name; 3 = it occurs in the path only. */
function matchTier(entry: MentionCandidate, first: string): number {
	const bare = foldText(entry.isFolder ? entry.name : entry.name.replace(/\.[^.]*$/, ""));
	if (bare.startsWith(first)) return 0;
	if (wordsOf(bare).some(w => w.startsWith(first))) return 1;
	if (bare.includes(first)) return 2;
	return 3;
}

function inFolder(path: string, folder: string): boolean {
	return folder !== "" && (path === folder || path.startsWith(folder + "/"));
}

/* The entries to show for `query`, best first. `entries` is the candidate set
   (the folder's children for `@` alone, or every match of the vault and the
   external roots otherwise). `currentFolder` is the composer's destination
   ("" = the root). */
export function rankMentions<T extends MentionCandidate>(
	entries: readonly T[], query: string, currentFolder: string
): T[] {
	const folder = currentFolder.replace(/\/+$/, "");
	const words = wordsOf(query);
	if (!words.length) {
		return orderListing(entries.filter(e => parentOf(e.path) === folder), "");
	}
	/* At an equal match, COURSES before quiz notes (the owner typed "@CM" and
	   got two quiz notes, one of them a broken one-question quiz, above every
	   lecture PDF, 2026-10-11), then the NATURAL order of the names: CM1, CM2,
	   CM3… reads better than the order of the last edits. */
	const scored: { entry: T; tier: number; here: number; kind: number; date: number }[] = [];
	for (const entry of entries) {
		const path = foldText(entry.path);
		if (!words.every(w => path.includes(w))) continue;
		if (isNoise(entry, words)) continue;
		scored.push({
			entry,
			tier: matchTier(entry, words[0]),
			here: inFolder(entry.path, folder) ? 0 : 1,
			kind: entry.isFolder ? 2 : isQuizNote(entry) ? 1 : 0,
			date: entry.mtime ?? 0,
		});
	}
	scored.sort((a, b) =>
		a.tier - b.tier || a.here - b.here || a.kind - b.kind
		|| a.entry.name.localeCompare(b.entry.name, undefined, { sensitivity: "base", numeric: true })
		|| b.date - a.date);
	return scored.map(x => x.entry);
}
