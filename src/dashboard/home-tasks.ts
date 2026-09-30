import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { computeQuizState } from "./quiz-mastery";

/* ══════════════════════════════════════════════════════════
   THE HOME PAGE'S TASKS, PURE (2026-09-29).

   What each folder asks of the user today, which folders the home shows and
   in which order, and the week the side column draws. No DOM, no host, no
   clock: `now` and "today" are inputs. `npm run check:home`.

   Spec: docs/superpowers/specs/2026-09-29-home-page-design.md §2 and §3.
   ══════════════════════════════════════════════════════════ */

export type HomeTaskKind = "review" | "learn" | "test";

export interface HomeTask {
	kind: HomeTaskKind;
	/** The quiz the task opens. For a review: the note with the most dues,
	    as the folder's next step does (folder-next.ts). */
	quiz: QuizIndexEntry;
	/** Questions to review (a review task only). */
	count?: number;
}

/** What the scheduler has due today for a folder (`duesDuDossier`). */
export interface FolderDues {
	total: number;
	lignes: { quiz: QuizIndexEntry; n: number }[];
}

/** The tasks of a folder, in order: the review first, then every Learn not
    yet mastered, then every Test, each in card order (`ordre`, the Learn
    before the Test of a course). `resumePath`: the quiz of the Resume card,
    which already offers it — the only quiz in progress left out. */
export function folderTasks(
	ordre: readonly QuizIndexEntry[],
	dues: FolderDues,
	stats: Record<string, QuizStatRecord>,
	resumePath?: string,
): HomeTask[] {
	const tasks: HomeTask[] = [];
	if (dues.total > 0 && dues.lignes.length > 0) {
		tasks.push({ kind: "review", quiz: dues.lignes[0].quiz, count: dues.total });
	}
	const todo = ordre.filter(q => q.path !== resumePath && computeQuizState(q, stats[q.path]).state !== "mastered");
	for (const q of todo) if (q.mode === "learn") tasks.push({ kind: "learn", quiz: q });
	for (const q of todo) if (q.mode !== "learn") tasks.push({ kind: "test", quiz: q });
	return tasks;
}

/** A folder as the home sees it. */
export interface HomeFolder<G = unknown> {
	group: G;
	name: string;
	tasks: HomeTask[];
	/** The folder's nearest upcoming exam, or null. */
	nextExam: ExamLike | null;
	/** Latest `lastPlayed` of the folder's quizzes (0: never played). */
	lastPlayed: number;
}

/** The folders shown: only those with an open task, the nearest exam first;
    folders without an exam after, most recently worked first, then by name.
    A total order, hence stable from one render to the next. */
export function homeFolders<F extends HomeFolder>(folders: readonly F[]): F[] {
	return folders
		.filter(f => f.tasks.length > 0)
		.sort((a, b) => {
			if (a.nextExam && b.nextExam) return a.nextExam.date.localeCompare(b.nextExam.date) || a.name.localeCompare(b.name);
			if (a.nextExam) return -1;
			if (b.nextExam) return 1;
			return b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name);
		});
}

/** Tasks left today, every shown folder together. */
export function tasksLeft(folders: readonly HomeFolder[]): number {
	return folders.reduce((n, f) => n + f.tasks.length, 0);
}

/** Latest `lastPlayed` of a set of quizzes. */
export function lastPlayedOf(quizzes: readonly QuizIndexEntry[], stats: Record<string, QuizStatRecord>): number {
	return quizzes.reduce((max, q) => Math.max(max, stats[q.path]?.lastPlayed ?? 0), 0);
}

/** An exam of a folder (`ExamenDossier`), reduced to what the home reads. */
export interface ExamLike { nom: string; date: string; seances?: readonly string[] }

/** The upcoming exams (`date >= today`, both `YYYY-MM-DD` LOCAL strings, the
    same rule as the folder's Review plan), nearest first. A continuous
    assessment (`seances`) is not a day to prepare for: it is left out. */
export function upcomingExams<E extends ExamLike>(exams: readonly E[], todayIso: string): E[] {
	return exams.filter(e => !e.seances && e.date >= todayIso).sort((a, b) => a.date.localeCompare(b.date));
}

/** `YYYY-MM-DD` of a LOCAL date — never UTC: `toISOString` would move an
    evening to the next day east of Greenwich. */
export function isoLocal(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local midnight of the day holding `ms`. */
export function startOfDay(ms: number): number {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The seven local midnights, Monday to Sunday, of the week holding `ms`,
    shifted by `weekOffset` weeks. Built day by day from the calendar, never
    by adding 24 h: a daylight saving change makes a day 23 or 25 hours. */
export function weekDays(ms: number, weekOffset = 0): number[] {
	const d = new Date(ms);
	const fromMonday = (d.getDay() + 6) % 7;
	const monday = d.getDate() - fromMonday + weekOffset * 7;
	return Array.from({ length: 7 }, (_, i) => new Date(d.getFullYear(), d.getMonth(), monday + i).getTime());
}

/** Whole days from today's midnight to an exam date (`YYYY-MM-DD`). */
export function daysUntil(dateIso: string, todayStart: number): number {
	const [y, m, d] = dateIso.split("-").map(Number);
	return Math.round((new Date(y, m - 1, d).getTime() - todayStart) / 86_400_000);
}

/** "X % success" of a folder: the mean best score of the quizzes played at
    least once (a quiz never played says nothing about success), 0 when none
    was. The bar next to it shows PROGRESS (`moyenneDossier`), not this. */
export function successOf(quizzes: readonly QuizIndexEntry[], stats: Record<string, QuizStatRecord>): number {
	const played = quizzes.map(q => stats[q.path]).filter((s): s is QuizStatRecord => !!s && s.attempts > 0);
	return played.length ? Math.round(played.reduce((n, s) => n + s.bestScore, 0) / played.length) : 0;
}
