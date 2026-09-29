/**
 * THE HOME PAGE'S TASKS (`src/dashboard/home-tasks.ts`, pure). What it
 * prevents: a folder whose review, Learns and Tests come in the wrong order,
 * a mastered quiz still listed as a task, a folder with nothing to do shown
 * anyway, folders sorted by anything but the nearest exam then the latest
 * work, a week drawn from a Sunday or broken by a daylight saving change.
 *     npm run check:home
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/home-tasks.ts", (H) => {
	const r = makeReporter("Home — tasks and folders");
	const quiz = (path, mode, questions = 10) => ({ path, mode, questions, title: path });
	const L1 = quiz("L1.md", "learn"), P1 = quiz("P1.md", "practice"), L2 = quiz("L2.md", "learn"), P2 = quiz("P2.md", "practice");
	const ordre = [L1, P1, L2, P2];
	const sans = { total: 0, lignes: [] };
	const kinds = (tasks) => tasks.map(x => `${x.kind}:${x.quiz.path}`);

	r.check("the review first, then the Learns, then the Tests, in card order",
		kinds(H.folderTasks(ordre, { total: 7, lignes: [{ quiz: P2, n: 5 }, { quiz: L1, n: 2 }] }, {})),
		["review:P2.md", "learn:L1.md", "learn:L2.md", "test:P1.md", "test:P2.md"]);
	r.check("the review counts every question due, opens the note with the most",
		H.folderTasks(ordre, { total: 7, lignes: [{ quiz: P2, n: 5 }, { quiz: L1, n: 2 }] }, {})[0].count, 7);
	r.check("no review task without dues", kinds(H.folderTasks([L1], sans, {})), ["learn:L1.md"]);
	const maitrise = { "L1.md": { questionsDone: 10, totalQuestions: 10, bestScore: 90, attempts: 1, lastPlayed: 1 } };
	r.check("a mastered quiz is not a task", kinds(H.folderTasks(ordre, sans, maitrise)), ["learn:L2.md", "test:P1.md", "test:P2.md"]);
	const enCours = { "L1.md": { questionsDone: 4, totalQuestions: 10, bestScore: 0, attempts: 0, lastPlayed: 1 } };
	r.check("a quiz in progress stays a task", kinds(H.folderTasks([L1], sans, enCours)), ["learn:L1.md"]);
	r.check("the Resume card's quiz is left out", kinds(H.folderTasks([L1, P1], sans, enCours, "L1.md")), ["test:P1.md"]);

	const f = (name, tasks, nextExam, lastPlayed = 0) => ({ group: name, name, tasks: Array.from({ length: tasks }, () => ({})), nextExam: nextExam ? { nom: "", date: nextExam } : null, lastPlayed });
	const names = (list) => H.homeFolders(list).map(x => x.name);
	r.check("a folder without an open task is hidden", names([f("A", 0, "2026-10-01"), f("B", 1, null)]), ["B"]);
	r.check("the nearest exam first", names([f("A", 1, "2026-10-12"), f("B", 1, "2026-10-04")]), ["B", "A"]);
	r.check("folders with an exam before those without", names([f("A", 1, null, 99), f("B", 1, "2026-12-01")]), ["B", "A"]);
	r.check("without an exam: the latest worked first", names([f("A", 1, null, 5), f("B", 1, null, 9)]), ["B", "A"]);
	r.check("then by name: a total order", names([f("B", 1, null), f("A", 1, null)]), ["A", "B"]);
	r.check("same exam date: by name", names([f("B", 1, "2026-10-04"), f("A", 1, "2026-10-04")]), ["A", "B"]);
	r.check("tasks left: every folder together", H.tasksLeft([f("A", 3, null), f("B", 2, null)]), 5);

	r.check("upcoming exams: past ones dropped, nearest first",
		H.upcomingExams([{ nom: "x", date: "2026-09-28" }, { nom: "y", date: "2026-10-09" }, { nom: "z", date: "2026-09-29" }], "2026-09-29").map(e => e.nom),
		["z", "y"]);
	r.check("success: mean best score of the quizzes played only",
		H.successOf([L1, P1, L2], { "L1.md": { bestScore: 80, attempts: 2 }, "P1.md": { bestScore: 40, attempts: 1 } }), 60);
	r.check("success: 0 when nothing was played", H.successOf([L1], {}), 0);

	// The week: Monday to Sunday, local midnights, whatever the day given.
	const mercredi = new Date(2026, 8, 30, 15, 0).getTime();
	const semaine = H.weekDays(mercredi);
	r.check("seven days, Monday first", [semaine.length, new Date(semaine[0]).getDay(), new Date(semaine[0]).getDate()], [7, 1, 28]);
	r.check("Sunday belongs to the week that started on Monday",
		new Date(H.weekDays(new Date(2026, 9, 4, 22, 0).getTime())[0]).getDate(), 28);
	r.check("each day is a local midnight",
		semaine.every(d => { const x = new Date(d); return x.getHours() === 0 && x.getMinutes() === 0; }), true);
	r.check("the week before", new Date(H.weekDays(mercredi, -1)[0]).getDate(), 21);
	// Across the change to winter time (last Sunday of October in Europe),
	// every day still starts at midnight — adding 24 h would drift.
	r.check("a daylight saving change does not shift the days",
		H.weekDays(new Date(2026, 9, 28, 12).getTime()).every(d => new Date(d).getHours() === 0), true);
	r.check("days until an exam", H.daysUntil("2026-10-04", H.startOfDay(mercredi)), 4);
	r.check("isoLocal is local, never UTC", H.isoLocal(new Date(2026, 8, 30, 23, 30).getTime()), "2026-09-30");

	r.done();
});
