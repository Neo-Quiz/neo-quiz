import { ajouter } from "../dom";
import { t } from "../i18n";
import { currentHost } from "../host/current";
import type { DashboardShellCtx, ExamenDossier } from "../types/dashboard-ctx";
import type { QuizStatRecord } from "./stats-store";
import type { ModuleGroup } from "./quiz-modules";
import { quizModeIcon, quizModeLabel } from "./quiz-card";
import { duesDuDossier, questions } from "./folder-progress-details";
import { moyenneDossier } from "./folder-progress";
import { quizDeLaCarte, regrouperParCours } from "./course-pairs";
import {
	folderTasks, homeFolders, lastPlayedOf, successOf, upcomingExams, daysUntil,
	type HomeFolder, type HomeTask, type HomeTaskKind,
} from "./home-tasks";

/* ══════════════════════════════════════════════════════════
   THE HOME PAGE'S FOLDER CARDS (2026-09-29): one card per folder with an
   open task, the nearest exam first. Each card lists what the folder asks
   of the user today — the review, then the Learns, then the Tests — the
   first one as the lead, with an accent TEXT action, never a framed button
   (no tile in a tile). The pure part lives in home-tasks.ts.

   Spec: docs/superpowers/specs/2026-09-29-home-page-design.md §2.
   ══════════════════════════════════════════════════════════ */

/** A folder shown on the home, with its exam as the host stores it. */
export type HomeFolderCard = HomeFolder<ModuleGroup> & { nextExam: ExamenDossier | null };

/** Rows shown per card; beyond, "See the N tasks" opens the Review plan. */
const MAX_ROWS = 3;

const ICONS: Record<HomeTaskKind, string> = { review: "rotate-ccw", learn: "book-open", test: "dumbbell" };

/** The folders the home shows, in order (home-tasks.ts `homeFolders`). */
export function collectHomeFolders(
	ctx: DashboardShellCtx,
	groups: readonly ModuleGroup[],
	stats: Record<string, QuizStatRecord>,
	todayIso: string,
	resumePath: string | undefined,
): HomeFolderCard[] {
	const groupModes = ctx.settings.quizzesGroupModes !== false;
	return homeFolders(groups.map(group => {
		// Card order, the Learn before the Test of a course — the order of
		// the folder's own page (quizzes-render.ts `ordre`).
		const ordre = regrouperParCours(group.quizzes, groupModes).flatMap(quizDeLaCarte);
		return {
			group,
			name: group.name,
			tasks: folderTasks(ordre, duesDuDossier(ctx, group.quizzes), stats, resumePath),
			nextExam: upcomingExams(ctx.examens?.(group) ?? [], todayIso)[0] ?? null,
			lastPlayed: lastPlayedOf(group.quizzes, stats),
		};
	}));
}

/** "in 5 days", "tomorrow", "today": the keys of the folder's Review plan. */
export function whenLabel(dateIso: string, todayStart: number): string {
	const days = daysUntil(dateIso, todayStart);
	return days <= 0 ? t("dashboard.quizzes.progressExamToday")
		: days === 1 ? t("dashboard.quizzes.progressExamTomorrow")
		: t("dashboard.quizzes.progressExamIn", { count: days });
}

function taskLabel(task: HomeTask): string {
	return task.kind === "review"
		? t("dashboard.home.taskReview", { questions: questions(task.count ?? 0) })
		: t("dashboard.home.taskQuiz", { mode: quizModeLabel(task.quiz.mode), title: task.quiz.title });
}

/** Opens a folder's page on a tab; without the host's hook, "My quizzes". */
function openFolder(ctx: DashboardShellCtx, group: ModuleGroup, tab: "contenu" | "planning"): void {
	if (ctx.openFolderTab) ctx.openFolderTab(group.folder, tab);
	else ctx.navigate("quizzes");
}

export function renderHomeFolder(
	parent: HTMLElement,
	ctx: DashboardShellCtx,
	folder: HomeFolderCard,
	stats: Record<string, QuizStatRecord>,
	todayStart: number,
): void {
	const { group, tasks } = folder;
	const host = currentHost();
	const card = ajouter(parent, "section", "qbd-homef");

	const head = ajouter(card, "div", "qbd-homef-head");
	const name = ajouter(head, "button", "qbd-homef-name");
	name.type = "button";
	ajouter(name, "span", undefined, folder.name);
	host.ui.setIcon(ajouter(name, "span", "qbd-homef-name-chev"), "chevron-right");
	name.addEventListener("click", () => openFolder(ctx, group, "contenu"));
	if (folder.nextExam) {
		const exam = ajouter(head, "span", "qbd-homef-exam");
		host.ui.setIcon(ajouter(exam, "span", "qbd-homef-exam-icon"), "calendar");
		ajouter(exam, "span", undefined, t("dashboard.home.folderExam", {
			exam: folder.nextExam.nom || t("dashboard.planning.examUnnamed"),
			when: whenLabel(folder.nextExam.date, todayStart),
		}));
	}

	const bar = ajouter(card, "div", "qbd-homef-bar");
	ajouter(bar, "div", "qbd-homef-bar-fill").style.width = `${moyenneDossier(group.quizzes, stats)}%`;

	const meta = ajouter(card, "div", "qbd-homef-meta");
	ajouter(meta, "span", undefined, t(tasks.length === 1 ? "dashboard.home.openTasksOne" : "dashboard.home.openTasksOther", { count: tasks.length }));
	ajouter(meta, "span", undefined, t("dashboard.home.success", { pct: successOf(group.quizzes, stats) }));

	const list = ajouter(card, "div", "qbd-homef-tasks");
	tasks.slice(0, MAX_ROWS).forEach((task, index) => renderTask(list, ctx, task, index === 0));

	if (tasks.length > MAX_ROWS) {
		const more = ajouter(card, "button", "qbd-homef-more");
		more.type = "button";
		ajouter(more, "span", undefined, t("dashboard.home.seeTasks", { count: tasks.length }));
		host.ui.setIcon(ajouter(more, "span", "qbd-homef-more-chev"), "chevron-right");
		more.addEventListener("click", () => openFolder(ctx, group, "planning"));
	}
}

function renderTask(list: HTMLElement, ctx: DashboardShellCtx, task: HomeTask, lead: boolean): void {
	const host = currentHost();
	const row = ajouter(list, "button", `qbd-homef-task${lead ? " is-lead" : ""}`);
	row.type = "button";
	// A Test task shows its own mode's icon: the dumbbell, or the timer of an Exam.
	host.ui.setIcon(ajouter(row, "span", `qbd-homef-task-icon qbd-homef-task-icon--${task.kind}`), task.kind === "test" ? quizModeIcon(task.quiz.mode) : ICONS[task.kind]);
	ajouter(row, "span", "qbd-homef-task-label", taskLabel(task));
	if (lead) {
		const cta = ajouter(row, "span", "qbd-homef-task-cta");
		ajouter(cta, "span", undefined, t(task.kind === "review" ? "dashboard.home.ctaReview" : "dashboard.home.ctaStart"));
		host.ui.setIcon(ajouter(cta, "span", "qbd-homef-task-cta-chev"), "chevron-right");
	} else {
		host.ui.setIcon(ajouter(row, "span", "qbd-homef-task-chev"), "chevron-right");
	}
	// Same gesture as the folder's next step: the quiz opens and plays.
	row.addEventListener("click", () => ctx.openQuiz(task.quiz));
}
