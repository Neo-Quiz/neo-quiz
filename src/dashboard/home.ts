import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { isFolderArchived } from "./folder-archive";
import { moduleForQuiz, applyModuleOverrides, buildModuleGroups, estLeSas } from "./quiz-modules";
import type { ModuleMap } from "./quiz-modules";
import { moduleAccent } from "./module-color";
import { moduleIcon } from "./module-icons";
import { quizModeIcon, quizModeLabel } from "./quiz-card";
import { poserBouton3d } from "./cta3d";
import { lireModuleMap } from "./module-map-note";
import { createOptionCard, importSharedFolder } from "./folder-create";
import { openNewFolderModal } from "./module-edit";
import { isoLocal, resumableQuizzes, startOfDay, upcomingExams } from "./home-tasks";
import { collectHomeFolders, renderHomeFolder } from "./home-folders";
import { renderHomeSide, type HomeExam } from "./home-week";

/* ══════════════════════════════════════════════════════════
   HOME VIEW — what to work on today (redesigned 2026-09-29, after the
   StudySmarter home): one card per folder with an open task
   (home-folders.ts), the week and quick actions beside them, then the Resume
   card below the folders when a quiz is in progress.
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
		const inProgress = resumableQuizzes(quizzes, path => !!ctx.sessionOf?.(path));

		/* The page is ONE wrapper: `.qbd-content > *` centres it. No blue
		   glow behind the top of the page any more (2026-09-29): cut by the
		   tile's edge, it read as a smear rather than light. */
		const page = ajouter(container, "div", "qbd-home-page");
		/* No header (2026-09-29): no title and no "Generate a quiz" — the
		   folder cards and the side column say what to do by themselves. */

		// ── Resume: the latest quiz in progress (a returning user's primary action) ──
		const resumeQuiz = inProgress
			.slice()
			.sort((a, b) => {
				const la = (stats[a.path] && stats[a.path].lastPlayed) || 0;
				const lb = (stats[b.path] && stats[b.path].lastPlayed) || 0;
				return lb - la;
			})[0];
		// ── The folders and the week ──
		const now = Date.now();
		const todayStart = startOfDay(now);
		const todayIso = isoLocal(now);
		// The generated-quizzes folder is a holding area, not a course: never a
		// folder card on the home page (its quizzes can still be resumed).
		const groups = buildModuleGroups(quizzes, stats, map).filter(g => !estLeSas(g, ctx.generatedFolder?.()));
		const folders = collectHomeFolders(ctx, groups, stats, todayIso, resumeQuiz?.path);
		// Every upcoming exam of every folder — a folder with nothing to do
		// today can still have its exam this week.
		const exams: HomeExam[] = groups
			.flatMap(group => upcomingExams(ctx.examens?.(group) ?? [], todayIso).map(exam => ({ exam, group })))
			.sort((a, b) => a.exam.date.localeCompare(b.exam.date));

		const layout = ajouter(page, "div", "qbd-home-layout");
		const column = ajouter(layout, "div", "qbd-home-folders");
		if (folders.length === 0) {
			const done = ajouter(column, "div", "qbd-home-done");
			currentHost().ui.setIcon(ajouter(done, "span", "qbd-home-done-icon"), "circle-check");
			ajouter(done, "p", "qbd-home-done-title", t("dashboard.home.allDone"));
			ajouter(done, "p", "qbd-home-done-hint", t("dashboard.home.allDoneHint"));
		} else {
			for (const folder of folders) renderHomeFolder(column, ctx, folder, stats, todayStart);
		}
		if (resumeQuiz) renderResumeHero(column, resumeQuiz, stats[resumeQuiz.path], map);

		const side = ajouter(layout, "div", "qbd-home-side");
		renderHomeSide(side, {
			ctx, folders, exams, todayStart, weekOffset,
			moveWeek: (delta) => { weekOffset += delta; rerender(); },
		});
		renderQuickActions(side, map, allQuizzes);
	}

	/* "Resume" card (redrawn 2026-09-29, button restyled the same day): a
	   content tile like the folder cards. Its action is the app's 3D button
	   (cta3d.ts, the one of "Start the quiz" and of a folder's Resume),
	   sized to its content and centred on the right. The tile is a DIV, not a
	   button: a button inside a button is invalid HTML and would fire twice.
	   The whole tile stays clickable with the mouse; for the keyboard and
	   assistive tech the 3D button is the one control, and it stops the
	   click there so the tile's handler never runs a second time.
	   The muted line reads folder (its own icon and accent, as on its folder
	   card), then the quiz's type (icon + text, not a framed pill: no tile in
	   a tile), then the progress. No ring or percentage (removed 2026-09-29):
	   the card's only job is to reopen the quiz where it was left. */
	function renderResumeHero(container: HTMLElement, quiz: QuizIndexEntry, stats: QuizStatRecord | null | undefined, map: ModuleMap): void {
		const host = currentHost();
		const total = quiz.questions || (stats && stats.totalQuestions) || 0;
		const done = stats ? stats.questionsDone : 0;
		const info = moduleForQuiz(quiz.path, map);
		// The generated-quizzes folder has its own icon and accent (quizzes.ts).
		const generated = !!info.path && info.path === ctx.generatedFolder?.();

		const hero = ajouter(container, "div", "qbd-resume-hero");
		hero.style.setProperty("--accent", moduleAccent(info, { generated }));
		hero.addEventListener("click", () => ctx.openQuiz(quiz));

		const text = ajouter(hero, "span", "qbd-resume-info");
		const label = ajouter(text, "span", "qbd-resume-label");
		host.ui.setIcon(ajouter(label, "span", "qbd-resume-label-icon"), "history");
		ajouter(label, "span", undefined, t("dashboard.home.resumeLabel"));
		ajouter(text, "span", "qbd-resume-title", quiz.title);

		// Folder · type · progress. A quiz outside any folder has no folder part.
		const meta = ajouter(text, "span", "qbd-resume-meta");
		const folderName = info.name || info.folder;
		if (folderName) {
			const folder = ajouter(meta, "span", "qbd-resume-meta-folder");
			host.ui.setIcon(ajouter(folder, "span", "qbd-resume-meta-icon"), moduleIcon(info, { generated }));
			ajouter(folder, "span", "qbd-resume-meta-text", folderName);
			ajouter(meta, "span", "qbd-resume-meta-sep", "·");
		}
		const type = ajouter(meta, "span", "qbd-resume-meta-type");
		host.ui.setIcon(ajouter(type, "span", "qbd-resume-meta-icon"), quizModeIcon(quiz.mode));
		ajouter(type, "span", undefined, quizModeLabel(quiz.mode));
		ajouter(meta, "span", "qbd-resume-meta-sep", "·");
		// Agreement follows the TOTAL ("0/1 question", "3/10 questions").
		ajouter(meta, "span", "qbd-resume-meta-progress", t(total === 1 ? "dashboard.common.questionsOfOne" : "dashboard.common.questionsOfOther", { done, total }));

		// The 3D button: the same icon + label markup as the folder's Resume.
		const cta = ajouter(hero, "button", "qbd-resume-cta");
		cta.type = "button";
		cta.setAttribute("aria-label", t("dashboard.home.resumeAria", { title: quiz.title }));
		host.ui.setIcon(ajouter(cta, "span", "qbd-btn-icon"), "play");
		ajouter(cta, "span", undefined, t("dashboard.home.resumeBtn"));
		poserBouton3d(cta);
		cta.addEventListener("click", (e) => { e.stopPropagation(); ctx.openQuiz(quiz); });
	}

	/** The two creation shortcuts below the calendar, using the exact option
	    rows of the folder creation modal. */
	function renderQuickActions(container: HTMLElement, map: ModuleMap, quizzes: QuizIndexEntry[]): void {
		const card = ajouter(container, "section", "qbd-home-quick");
		ajouter(card, "h2", "qbd-home-quick-title", t("dashboard.home.quickActions"));
		const options = ajouter(card, "div", "qbd-home-quick-options");
		createOptionCard(null, options, "folder-plus", "#4573ff", t("dashboard.quizzes.newFolderTitle"), t("dashboard.quizzes.createEmptyDesc"),
			() => openNewFolderModal(ctx, map, quizzes, rerender));
		createOptionCard(null, options, "download", "#a78bfa", t("dashboard.quizzes.createImportTitle"), t("dashboard.quizzes.createImportDesc"),
			() => void importSharedFolder(ctx, map, quizzes, rerender));
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

		/* The cards of the "Create a folder" modal, rendered in place
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

	return { render };
}
