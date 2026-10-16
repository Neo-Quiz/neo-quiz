/* ══════════════════════════════════════════════════════════
   COURSE FOLDERS BY SCHOOL YEAR (spec 2026-10-15-year-folders-design).

   PURE: no host, no DOM, no clock (`now` is an input), and NO IMPORT. The
   main process reads it too (Moodle's `dossierDuCours`, which must find and
   create a course folder in its year folder by the very same rule), so this
   module must stay loadable from Node and from the window alike.

   - A COURSE folder starts with a course code, `^[A-Z]{2,5}(\d)\d{2}` (the
     reading of Moodle's `dossierDuCours`); its level is ceil(firstDigit / 2):
     1-2 -> B1, 3-4 -> B2, 5 -> B3.
   - A YEAR folder is a first-level folder whose name matches `^B\d+\s`
     ("B2 2026-2027", "B2 (2026-2027)").
   - The year folder of a level: an existing `B<level> ...` folder (first by
     name), else `B<level> <school year>`. The school year is derived from an
     existing dated year folder `B<m> YYYY-YYYY` as YYYY + (level - m), else
     the school year containing today (September to August).
══════════════════════════════════════════════════════════ */

/** A first-level folder that holds one school year. */
export const YEAR_FOLDER_RE = /^B\d+\s/;
const COURSE_CODE_RE = /^[A-Z]{2,5}(\d)\d{2}/;
const DATED_YEAR_RE = /^B(\d+)\s+(\d{4})-\d{4}(?!\d)/;

const byName = (a: string, b: string): number => a.localeCompare(b);

/** The level (1 for B1) of a course folder or code, or null when the name does
    not start with a course code (or its first digit is 0). */
export function courseLevel(name: string): number | null {
	const m = COURSE_CODE_RE.exec(name);
	if (!m) return null;
	const digit = Number(m[1]);
	return digit >= 1 ? Math.ceil(digit / 2) : null;
}

/** The first calendar year of the school year containing `now` (September to August). */
export function currentSchoolYearStart(now: Date): number {
	return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}

/** "B2 2026-2027". */
export function yearFolderName(level: number, start: number): string {
	return `B${level} ${start}-${start + 1}`;
}

/** The school year of `level` derived from the first dated year folder of
    `rootFolders` (by name), or null when there is none. */
function derivedStart(level: number, rootFolders: readonly string[]): number | null {
	for (const name of [...rootFolders].sort(byName)) {
		const m = DATED_YEAR_RE.exec(name);
		if (m) return Number(m[2]) + (level - Number(m[1]));
	}
	return null;
}

/** The year folder a course of `level` belongs in. `rootFolders`: the names of
    the root's first-level FOLDERS. `fallbackStart`: the school year used when
    no dated year folder exists. */
export function yearFolderFor(level: number, rootFolders: readonly string[], fallbackStart: number): { name: string; exists: boolean } {
	const own = new RegExp(`^B${level}\\s`);
	const existing = rootFolders.filter(n => own.test(n)).sort(byName)[0];
	if (existing !== undefined) return { name: existing, exists: true };
	return { name: yearFolderName(level, derivedStart(level, rootFolders) ?? fallbackStart), exists: false };
}

/** Where Moodle creates a NEW course folder: the name of its year folder, or
    null (no level: created at the root, as before). */
export function newCourseYearFolder(code: string, rootFolders: readonly string[], now: Date): string | null {
	const level = courseLevel(code);
	return level === null ? null : yearFolderFor(level, rootFolders, currentSchoolYearStart(now)).name;
}

/* ── The plan of "Organise by school year" ── */

export interface RootEntry { name: string; isFolder: boolean }

export interface YearPlanInput {
	/** The first-level entries of the root. */
	entries: readonly RootEntry[];
	/** The names inside each EXISTING year folder (for the pre-flight). */
	yearChildren: Readonly<Record<string, readonly string[]>>;
	/** First-level folder names that never move (the "Generated" folder). */
	keep?: readonly string[];
	now: Date;
}

export interface YearMove { folder: string; yearFolder: string }

export interface YearPlan {
	/** Sorted by folder name; run one at a time, in this order. */
	moves: YearMove[];
	/** Year folders to create before the moves. */
	create: string[];
	/** `<year folder>/<course folder>` targets that already exist: nothing may move. */
	collisions: string[];
}

const fold = (s: string): string => s.normalize("NFC").toLowerCase();

/** Which course folders move into which year folder. When no dated year folder
    exists, the HIGHEST level of the plan is the current school year and the
    others are counted back from it (B1 2025-2026 next to B2 2026-2027): the
    student is in their highest year now. */
export function planYearFolders(input: YearPlanInput): YearPlan {
	const keep = new Set((input.keep ?? []).map(fold));
	const folders = input.entries.filter(e => e.isFolder && !e.name.startsWith(".")).map(e => e.name);
	const courses: { folder: string; level: number }[] = [];
	for (const folder of [...folders].sort(byName)) {
		if (keep.has(fold(folder)) || YEAR_FOLDER_RE.test(folder)) continue;
		const level = courseLevel(folder);
		if (level !== null) courses.push({ folder, level });
	}
	const top = Math.max(0, ...courses.map(c => c.level));
	const today = currentSchoolYearStart(input.now);
	const moves: YearMove[] = [];
	const create: string[] = [];
	const collisions: string[] = [];
	for (const { folder, level } of courses) {
		const target = yearFolderFor(level, folders, today - (top - level));
		if (!target.exists && !create.includes(target.name)) create.push(target.name);
		const inside = target.exists ? (input.yearChildren[target.name] ?? []) : [];
		if (inside.some(n => fold(n) === fold(folder))) collisions.push(`${target.name}/${folder}`);
		moves.push({ folder, yearFolder: target.name });
	}
	return { moves, create, collisions };
}

/* ── The links of Dashboard.md ── */

/** `seg` (a raw link segment, URL-encoded or not) names `folder`. */
function sameSegment(seg: string, folder: string): boolean {
	const want = folder.normalize("NFC");
	if (seg.normalize("NFC") === want) return true;
	try { return decodeURIComponent(seg).normalize("NFC") === want; } catch { return false; }
}

/** Rewrites the markdown link targets that start with a MOVED folder's name
    (URL-encoded or not) followed by "/": they get the year folder in front,
    URL-encoded (`B2%202026-2027/`), or raw inside `<...>`. Only an insertion
    at the start of those targets: every other byte (other links, CRLF, text)
    is kept, and a second run changes nothing. */
export function rewriteDashboardLinks(text: string, moves: readonly YearMove[]): string {
	if (moves.length === 0) return text;
	let out = "";
	let from = 0;
	let i = text.indexOf("](");
	while (i !== -1) {
		const angle = text[i + 2] === "<";
		const start = i + 2 + (angle ? 1 : 0);
		/* The first segment of the target: up to the first "/", never past the
		   end of the target (whitespace, an unbalanced ")", or ">" for <...>).
		   A folder name may hold balanced parentheses ("(SOC, SIEM)"). */
		let j = start;
		let depth = 0;
		let slash = false;
		for (; j < text.length; j++) {
			const ch = text[j];
			if (ch === "/") { slash = true; break; }
			if (ch === "\n" || ch === "\r") break;
			if (angle) { if (ch === ">") break; continue; }
			if (/\s/.test(ch)) break;
			if (ch === "(") depth++;
			else if (ch === ")") { if (depth === 0) break; depth--; }
		}
		if (slash) {
			const seg = text.slice(start, j);
			const move = moves.find(m => sameSegment(seg, m.folder));
			if (move) {
				out += text.slice(from, start) + (angle ? move.yearFolder : encodeURIComponent(move.yearFolder)) + "/";
				from = start;
			}
		}
		i = text.indexOf("](", i + 2);
	}
	return out + text.slice(from);
}
