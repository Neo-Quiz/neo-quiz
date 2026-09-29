import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { isFolderArchived } from "./folder-archive";
import { moduleForQuiz, applyModuleOverrides, buildModuleGroups } from "./quiz-modules";
import type { ModuleMap } from "./quiz-modules";
import { moduleAccent } from "./module-color";
import { lireModuleMap } from "./module-map-note";
import { createOptionCard, importSharedFolder, openCreateFolderModal } from "./folder-create";
import { openNewFolderModal } from "./module-edit";
import { isoLocal, startOfDay, upcomingExams } from "./home-tasks";
import { collectHomeFolders, renderHomeFolder } from "./home-folders";
import { renderHomeSide, type HomeExam } from "./home-week";

/* ══════════════════════════════════════════════════════════
   HOME VIEW — what to work on today (redesigned 2026-09-29, after the
   StudySmarter home): the Resume card, then one card per folder with an open
   task (home-folders.ts) and the week with the next exam (home-week.ts).
   The global counters and the grid of quiz cards are gone: they did not say
   what to do. Spec: docs/superpowers/specs/2026-09-29-home-page-design.md.
══════════════════════════════════════════════════════════ */

export interface HomeHandlers {
	/** `entering` = we ARRIVE on the page (the week strip goes back to the
	    current week). The host knows it: it is the one comparing the painted
	    view with the requested one (dashboard.ts). A re-render triggered by
	    the vault scanner or by a card's ⋯ menu passes `false`.
	    No entry transition since 2026-09-29: StudySmarter plays none when
	    its Home is opened from the rail (measured: zero animations). */
	render(container: HTMLElement, entering?: boolean): void;
}

export function createHomeHandlers(ctx: DashboardShellCtx): HomeHandlers {

	/* Last container painted: a card's ⋯ menu (archiving, stats reset) must
	   be able to repaint the home without going through navigation again. */
	let containerRef: HTMLElement | null = null;
	/* `entering` of the last render: when the module table arrives (async
	   read) and triggers a repaint, that repaint is still the arrival. */
	let lastEntering = true;
	/* Week shown in the side column, from the current one. Kept across the
	   re-renders the page causes itself; back to this week on arrival. */
	let weekOffset = 0;

	/* Module table read from the mapping note, as "My quizzes" does. Without
	   it, a quiz filed in a SUB-folder of its module got the sub-folder's
	   accent (and archive folder) here and the module's there: two colours
	   for the same quiz depending on the page. */
	let moduleMap: ModuleMap | null = null;
	let moduleMapLoaded = false;

	async function loadModuleMap(): Promise<void> {
		moduleMapLoaded = true;
		// ALWAYS yield before going on: without it, the "note missing" branch
		// crosses no real await and would re-render FROM the render() in
		// progress, which would then paint a second copy on top (trap
		// documented at length in quizzes.ts).
		await Promise.resolve();
		// Not `|| ""`: an empty string would lose the fallback to the
		// "Dashboard" note (DEFAULT_SETTINGS, plugin.ts) the old block applied —
		// a different behaviour when the setting is empty or not yet migrated.
		// `"Dashboard"` restores exactly the old fallback (a plan bug, fixed).
		moduleMap = await lireModuleMap(ctx.settings.quizzesModuleMapNote || "Dashboard");
		if (containerRef) render(containerRef, lastEntering);
	}

	/** Re-render triggered by the page itself (⋯ menu, week arrows): never an entry. */
	function rerender(): void {
		if (containerRef) render(containerRef, false);
	}

	function render(container: HTMLElement, entering = true): void {
		containerRef = container;
		lastEntering = entering;
		if (entering) weekOffset = 0;
		container.replaceChildren();

		// The quizzes of ARCHIVED FOLDERS (⋯ menu of a folder card in "My
		// quizzes") no longer exist for the home: no task, no folder. They
		// only come back under the "Archived" section of "My quizzes". Same
		// effective table as "My quizzes": the note (loaded in the background
		// on the first render) overlaid by the "Edit folder" modal's
		// overrides, re-read at every render.
		if (!moduleMapLoaded) { void loadModuleMap(); }
		const map: ModuleMap = applyModuleOverrides(
			moduleMap ?? { byFolder: new Map(), ueOrder: [] },
			ctx.settings.quizzesModuleOverrides || {}
		);
		const allQuizzes: QuizIndexEntry[] = ctx.scanner ? ctx.scanner.getQuizzes() : [];
		const quizzes = allQuizzes.filter(q => !isFolderArchived(ctx, moduleForQuiz(q.path, map).folder));
		const stats: Record<string, QuizStatRecord> = ctx.statsStore ? ctx.statsStore.getAll() : {};

		// ── First use: no quiz → guided onboarding ──
		if (allQuizzes.length === 0) {
			renderOnboarding(container, map, allQuizzes);
			return;
		}

		// The quizzes in progress: the Resume card offers the latest one.
		const inProgress = quizzes.filter(q => {
			const s = stats[q.path];
			return s && s.questionsDone > 0 && s.questionsDone < q.questions;
		});

		/* The page is ONE wrapper: `.qbd-content > *` centres it. No blue
		   glow behind the top of the page any more (2026-09-29): cut by the
		   tile's edge, it read as a smear rather than light. */
		const page = ajouter(container, "div", "qbd-home-page");

		/* No header (2026-09-29): no title, no "Generate a quiz" — the page
		   says what to do by itself, and "Create a new folder" closes it
		   (below the folders). */

		// ── Resume: the latest quiz in progress (a returning user's primary action) ──
		const resumeQuiz = inProgress
			.slice()
			.sort((a, b) => {
				const la = (stats[a.path] && stats[a.path].lastPlayed) || 0;
				const lb = (stats[b.path] && stats[b.path].lastPlayed) || 0;
				return lb - la;
			})[0];
		if (resumeQuiz) {
			renderResumeHero(page, resumeQuiz, stats[resumeQuiz.path], accentOf(resumeQuiz, map));
		}

		// ── The folders and the week ──
		const now = Date.now();
		const todayStart = startOfDay(now);
		const todayIso = isoLocal(now);
		const groups = buildModuleGroups(quizzes, stats, map);
		const folders = collectHomeFolders(ctx, groups, stats, todayIso, resumeQuiz?.path);
		/* "Create a new folder", under the folders (after StudySmarter's "Add
		   a new set"): a quiet outlined pill, the page's only creation action. */
		const newFolder = (parent: HTMLElement): void => {
			const b = ajouter(parent, "button", "qbd-home-newfolder");
			b.type = "button";
			currentHost().ui.setIcon(ajouter(b, "span", "qbd-home-newfolder-icon"), "folder-plus");
			ajouter(b, "span", undefined, t("dashboard.home.newFolder"));
			b.addEventListener("click", () => openCreateFolderModal(ctx, map, allQuizzes, rerender));
		};
		if (folders.length === 0) {
			const done = ajouter(page, "div", "qbd-home-done");
			currentHost().ui.setIcon(ajouter(done, "span", "qbd-home-done-icon"), "circle-check");
			ajouter(done, "p", "qbd-home-done-title", t("dashboard.home.allDone"));
			ajouter(done, "p", "qbd-home-done-hint", t("dashboard.home.allDoneHint"));
			newFolder(done);
			return;
		}
		// Every upcoming exam of every folder — a folder with nothing to do
		// today can still have its exam this week.
		const exams: HomeExam[] = groups
			.flatMap(group => upcomingExams(ctx.examens?.(group) ?? [], todayIso).map(exam => ({ exam, group })))
			.sort((a, b) => a.exam.date.localeCompare(b.exam.date));

		const layout = ajouter(page, "div", "qbd-home-layout");
		const column = ajouter(layout, "div", "qbd-home-folders");
		for (const folder of folders) renderHomeFolder(column, ctx, folder, stats, todayStart);
		newFolder(column);
		renderHomeSide(layout, {
			ctx, folders, exams, todayStart, weekOffset,
			moveWeek: (delta) => { weekOffset += delta; rerender(); },
		});
	}

	/* "Resume" card (redrawn 2026-09-29): the whole card is the button — no
	   framed button inside it (no tile in a tile). The title and where it
	   comes from, and on the right an accent TEXT action; the accent is the
	   quiz FOLDER's, like its card. No progress ring or percentage (removed
	   2026-09-29): the card's only job is to reopen the quiz on the question
	   where it was left, like the folder's next step. */
	function renderResumeHero(container: HTMLElement, quiz: QuizIndexEntry, stats: QuizStatRecord | null | undefined, accent: string): void {
		const total = quiz.questions || (stats && stats.totalQuestions) || 0;
		const done = stats ? stats.questionsDone : 0;

		const hero = ajouter(container, "button", "qbd-resume-hero");
		hero.type = "button";
		hero.style.setProperty("--accent", accent);
		hero.addEventListener("click", () => ctx.openQuiz(quiz));

		const info = ajouter(hero, "span", "qbd-resume-info");
		const label = ajouter(info, "span", "qbd-resume-label");
		currentHost().ui.setIcon(ajouter(label, "span", "qbd-resume-label-icon"), "history");
		ajouter(label, "span", undefined, t("dashboard.home.resumeLabel"));
		ajouter(info, "span", "qbd-resume-title", quiz.title);
		// Agreement follows the TOTAL ("0/1 question", "3/10 questions").
		const questions = t(total === 1 ? "dashboard.common.questionsOfOne" : "dashboard.common.questionsOfOther", { done, total });
		// Parent folder: says where the quiz comes from, and gives the accent
		// colour something on screen to refer to.
		const folder = quiz.path.split("/").slice(0, -1).filter(Boolean).pop();
		ajouter(info, "span", "qbd-resume-meta", folder ? t("dashboard.home.resumeMeta", { folder, questions }) : questions);

		const cta = ajouter(hero, "span", "qbd-resume-cta");
		ajouter(cta, "span", undefined, t("dashboard.home.resumeBtn"));
		currentHost().ui.setIcon(ajouter(cta, "span", "qbd-resume-cta-chev"), "chevron-right");
	}

	function renderOnboarding(container: HTMLElement, map: ModuleMap, allQuizzes: QuizIndexEntry[]): void {
		const wrap = ajouter(container, "div", "qbd-onboarding");

		const icon = ajouter(wrap, "div", "qbd-onboarding-icon");
		currentHost().ui.setIcon(icon, "graduation-cap");

		ajouter(wrap, "h2", "qbd-onboarding-title", t("dashboard.onboarding.title"));
		ajouter(wrap, "p", "qbd-onboarding-lead", t("dashboard.onboarding.lead"));

		// Obvious primary action — the SAME light pill as the populated home
		// and "+ New folder": one grammar of primary action. HIDDEN (not greyed
		// out) when the host cannot serve "ai": here it is the worst case (empty
		// folder, the ONLY primary action on screen).
		if (ctx.canOpen("ai")) {
			const primary = ajouter(wrap, "button", "qbd-btn--create qbd-onboarding-cta");
			const pIcon = ajouter(primary, "span", "qbd-btn-icon");
			currentHost().ui.setIcon(pIcon, "sparkles");
			ajouter(primary, "span", undefined, t("dashboard.onboarding.generate"));
			primary.addEventListener("click", () => ctx.navigate("ai"));
		}

		// Separator
		const divider = ajouter(wrap, "div", "qbd-onboarding-divider");
		ajouter(divider, "span", undefined, t("dashboard.onboarding.or"));

		/* The three cards of the "Create a folder" modal, rendered in place
		   (spec "usable by anyone", § 1): nobody writes a quiz by hand in a code
		   block, and "Generate" above IS the AI card. Same component, same CSS:
		   no extra look to maintain. */
		const cartes = ajouter(wrap, "div", "qbd-onboarding-cards");
		createOptionCard(null, cartes, "folder-plus", "#4573ff", t("dashboard.quizzes.createEmptyTitle"), t("dashboard.quizzes.createEmptyDesc"),
			() => openNewFolderModal(ctx, map, allQuizzes, rerender));
		if (ctx.openExistingFolder) {
			createOptionCard(null, cartes, "folder-open", "#f5a524", t("dashboard.quizzes.createOpenTitle"), t("dashboard.quizzes.createOpenDesc"),
				() => ctx.openExistingFolder!(rerender));
		}
		createOptionCard(null, cartes, "download", "#a78bfa", t("dashboard.quizzes.createImportTitle"), t("dashboard.quizzes.createImportDesc"),
			() => void importSharedFolder(ctx, map, allQuizzes, rerender));
	}

	/** Accent of a quiz's FOLDER — same source as "My quizzes". */
	function accentOf(quiz: QuizIndexEntry, map: ModuleMap): string {
		const folder = moduleForQuiz(quiz.path, map).folder;
		return moduleAccent(map.byFolder.get(folder) ?? { folder });
	}

	return { render };
}
