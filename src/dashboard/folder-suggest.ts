/* ══════════════════════════════════════════════════════════
   WHICH FOLDER A GENERATED QUIZ GOES TO — ordering and suggestions — pure

   The destination picker of Generate lists folders most recently touched
   first (the latest change of any file inside), and while the user types a
   request, the folders that match its words are suggested (never chosen on
   their own). Matching is accent and case insensitive: a word of the folder
   name first, then a word of a file title inside it; whole words and word
   starts before a mere substring.
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

/** The folders, most recently changed first; ties by name then path. */
export function rankFolders(folders: readonly FolderRef[], files: readonly FileRef[]): RankedFolder[] {
	const r = recency(folders, files);
	return folders
		.map(f => ({ ...f, recent: r.get(f.path) ?? 0 }))
		.sort((a, b) => b.recent - a.recent || fold(a.name).localeCompare(fold(b.name)) || a.path.localeCompare(b.path));
}

/* Words that say nothing about a subject (FR + EN), and the words of a request
   that ask for a quiz itself. */
const STOP = new Set([
	"les", "des", "une", "dans", "pour", "avec", "sur", "que", "qui", "est", "pas", "mes", "mon", "ton", "ses", "aux", "par", "plus", "tout", "tous", "comme", "faire", "fais",
	"the", "and", "for", "with", "about", "from", "that", "this", "make", "give", "some", "all", "your", "you", "are", "was",
	"quiz", "qcm", "test", "tests", "cours", "question", "questions", "apprendre", "learn", "teach", "explique", "explain", "exam", "examen", "controle", "practice",
]);

/** The words of a request worth matching: 3 letters or more, not a stop word. */
export function requestWords(text: string): string[] {
	const out: string[] = [];
	for (const w of fold(text).split(/[^a-z0-9+#]+/)) if (w.length >= 3 && !STOP.has(w) && !out.includes(w)) out.push(w);
	return out;
}

/** 3: a whole word or a word start of the name; 2: elsewhere in the name;
    1: a whole word or word start of a title; 0.5: elsewhere in a title. */
function scoreFolder(words: readonly string[], name: string, titles: readonly string[]): number {
	const n = fold(name);
	const nameWords = n.split(/[^a-z0-9+#]+/).filter(Boolean);
	let best = 0;
	for (const w of words) {
		if (nameWords.some(x => x === w || x.startsWith(w))) best = Math.max(best, 3);
		else if (n.includes(w)) best = Math.max(best, 2);
		else for (const title of titles) {
			const tt = fold(title);
			if (tt.split(/[^a-z0-9+#]+/).some(x => x === w || x.startsWith(w))) best = Math.max(best, 1);
			else if (tt.includes(w)) best = Math.max(best, 0.5);
		}
	}
	return best;
}

/** Up to `limit` folders whose name, then whose file titles, match the words of
    the request: best match first, then most recently changed. `except` (the
    folder already chosen) is never suggested. Nothing matching gives `[]`. */
export function suggestFolders(text: string, folders: readonly FolderRef[], files: readonly FileRef[], opts: { limit?: number; except?: string } = {}): RankedFolder[] {
	const words = requestWords(text);
	if (!words.length) return [];
	const scored: { f: RankedFolder; score: number }[] = [];
	for (const f of rankFolders(folders, files)) {
		if (f.path === opts.except) continue;
		const titles = files.filter(x => x.path.startsWith(f.path + "/")).map(x => x.title);
		const score = scoreFolder(words, f.name, titles);
		if (score > 0) scored.push({ f, score });
	}
	// `rankFolders` already ordered by recency: a stable sort keeps it among equal scores.
	return scored.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 3).map(x => x.f);
}
