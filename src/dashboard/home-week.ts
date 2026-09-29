import { ajouter } from "../dom";
import { currentLang, t } from "../i18n";
import type { TransKey } from "../i18n";
import { currentHost } from "../host/current";
import type { DashboardShellCtx, ExamenDossier } from "../types/dashboard-ctx";
import type { ModuleGroup } from "./quiz-modules";
import { formatExamDate } from "../review/review-store";
import { isoLocal, tasksLeft, weekDays } from "./home-tasks";
import { whenLabel, type HomeFolderCard } from "./home-folders";

/* ══════════════════════════════════════════════════════════
   THE HOME PAGE'S SIDE COLUMN (2026-09-29): the week, the tasks left
   today, the next exam. A past day is marked done / missed / nothing due by
   the scheduler (`ReviewStore.dayOutcome`, a replay of the log); today and
   the days to come stay neutral — a day is judged once it is over.

   Spec: docs/superpowers/specs/2026-09-29-home-page-design.md §3.
   ══════════════════════════════════════════════════════════ */

/** An upcoming exam of any folder, with the folder it belongs to. */
export interface HomeExam { exam: ExamenDossier; group: ModuleGroup }

export interface HomeSideDeps {
	ctx: DashboardShellCtx;
	/** The folders shown (for the tasks left today). */
	folders: readonly HomeFolderCard[];
	/** Every upcoming exam, every folder, nearest first. */
	exams: readonly HomeExam[];
	todayStart: number;
	/** Weeks from the current one (0: this week, -1: the one before). */
	weekOffset: number;
	moveWeek(delta: number): void;
}

const OUTCOME_KEYS = { done: "dashboard.home.dayDone", missed: "dashboard.home.dayMissed", none: "dashboard.home.dayNone" } as const;

export function renderHomeSide(parent: HTMLElement, deps: HomeSideDeps): void {
	const { ctx, folders, exams, todayStart, weekOffset } = deps;
	const host = currentHost();
	const lang = currentLang();
	const side = ajouter(parent, "aside", "qbd-homes");

	// ── The week ──
	const days = weekDays(todayStart, weekOffset);
	const head = ajouter(side, "div", "qbd-homes-week-head");
	const arrow = (icon: string, label: TransKey, delta: number): void => {
		const b = ajouter(head, "button", "qbd-homes-arrow");
		b.type = "button";
		b.setAttribute("aria-label", t(label));
		host.ui.setIcon(b, icon);
		b.addEventListener("click", () => deps.moveWeek(delta));
	};
	arrow("chevron-left", "dashboard.home.weekPrev", -1);
	const court = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" });
	ajouter(head, "span", "qbd-homes-week-range", `${court.format(days[0])} – ${court.format(days[6])}`);
	arrow("chevron-right", "dashboard.home.weekNext", 1);

	const examDays = new Map<string, HomeExam[]>();
	for (const e of exams) examDays.set(e.exam.date, [...(examDays.get(e.exam.date) ?? []), e]);
	const letter = new Intl.DateTimeFormat(lang, { weekday: "narrow" });
	const long = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" });

	const week = ajouter(side, "div", "qbd-homes-week");
	for (const day of days) {
		const past = day < todayStart;
		// Judged only once over, and only when the store is there to replay.
		const outcome = past ? ctx.reviewStore?.dayOutcome(day) ?? "none" : "none";
		const cell = ajouter(week, "div", `qbd-homes-day qbd-homes-day--${past ? outcome : "open"}${day === todayStart ? " is-today" : ""}`);
		const onExam = examDays.get(isoLocal(day)) ?? [];
		const title = [long.format(day), past ? t(OUTCOME_KEYS[outcome]) : "",
			...onExam.map(e => `${e.exam.nom} · ${e.group.name}`)].filter(Boolean).join(" — ");
		cell.setAttribute("title", title);
		cell.setAttribute("aria-label", title);
		// No marker of its own (a dashed ring read as a checkbox): a day done
		// or missed tints its NUMBER; the title says which.
		ajouter(cell, "span", "qbd-homes-day-letter", letter.format(day));
		ajouter(cell, "span", "qbd-homes-day-num", String(new Date(day).getDate()));
		ajouter(cell, "span", `qbd-homes-day-exam${onExam.length ? "" : " is-empty"}`);
	}

	// ── Tasks left today ──
	const left = tasksLeft(folders);
	const rowLeft = ajouter(side, "div", "qbd-homes-row");
	host.ui.setIcon(ajouter(rowLeft, "span", "qbd-homes-row-icon"), "list-checks");
	ajouter(rowLeft, "span", undefined, t(left === 1 ? "dashboard.home.tasksLeftOne" : "dashboard.home.tasksLeftOther", { count: left }));

	// ── The next exam ──
	const rowExam = ajouter(side, "div", "qbd-homes-row");
	host.ui.setIcon(ajouter(rowExam, "span", "qbd-homes-row-icon"), "calendar");
	const text = ajouter(rowExam, "div", "qbd-homes-row-text");
	const next = exams[0];
	if (next) {
		const line = ajouter(text, "div");
		ajouter(line, "strong", undefined, next.exam.nom);
		ajouter(line, "span", undefined, ` · ${next.group.name}`);
		const date = formatExamDate(next.exam.date, lang);
		ajouter(text, "div", "qbd-homes-muted", t("dashboard.home.nextExamWhen", { when: whenLabel(next.exam.date, todayStart), date }));
	} else {
		// No "Add an exam" link here any more (2026-09-29): exams are set
		// from a folder's Review plan, where they belong to a course.
		ajouter(text, "div", undefined, t("dashboard.home.noExam"));
	}
}
