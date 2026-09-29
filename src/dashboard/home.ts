import { PRODUCT_NAME } from "../branding";
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
import { markViewEnter } from "./view-enter";
import { createOptionCard, importSharedFolder } from "./folder-create";
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
	/** `entering` = we ARRIVE on the page (the entry transition plays). The
	    host knows it: it is the one comparing the painted view with the
	    requested one (dashboard.ts). A re-render triggered by the vault
	    scanner or by a card's ⋯ menu passes `false` — otherwise the page
	    would flicker at every note save. */
	render(container: HTMLElement, entering?: boolean): void;
}

export function createHomeHandlers(ctx: DashboardShellCtx): HomeHandlers {

	/* Last container painted: a card's ⋯ menu (archiving, stats reset) must
	   be able to repaint the home without going through navigation again. */
	let containerRef: HTMLElement | null = null;
	/* `entering` of the last render: when the module table arrives (async
	   read) and triggers a repaint, it must REPLAY the entry if the
	   interrupted render was one — otherwise the cascade stops dead just
	   after it began (same trap as quizzes.ts). */
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
		markViewEnter(container, entering, "qbd-home-enter");
		container.replaceChildren();

		// Entry cascade: ONE counter for the whole page (the folder cards) —
		// the same formula as "My quizzes".
		let entryIndex = 0;
		const entryDelay = (): string => `${100 + entryIndex++ * 45}ms`;

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

		/* The page is ONE wrapper: `.qbd-content > *` centres it, and it holds
		   the glow, which must stay behind every card (`isolation`, dashboard-
		   home.css). */
		const page = ajouter(container, "div", "qbd-home-page");
		ajouter(page, "div", "qbd-home-glow").setAttribute("aria-hidden", "true");

		// ── Header ──
		const header = ajouter(page, "div", "qbd-home-header");
		const headerLeft = ajouter(header, "div", "qbd-home-header-left");
		ajouter(headerLeft, "h2", "qbd-home-title", PRODUCT_NAME);
		ajouter(headerLeft, "p", "qbd-home-subtitle", t("dashboard.home.subtitle"));

		// Light pill IDENTICAL to "+ New folder" of "My quizzes": one grammar
		// of primary action in the dashboard (contract 2026-07-28). HIDDEN (not
		// greyed out) when the host cannot serve "ai": an ACTION button dead on
		// click is worse than none, unlike the rail (fixed, remembered shape)
		// that canOpen merely greys out.
		if (ctx.canOpen("ai")) {
			const genBtn = ajouter(header, "button", "qbd-btn--create");
			const genIcon = ajouter(genBtn, "span", "qbd-btn-icon");
			currentHost().ui.setIcon(genIcon, "sparkles");
			ajouter(genBtn, "span", undefined, t("dashboard.home.generate"));
			genBtn.addEventListener("click", () => ctx.navigate("ai"));
		}

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
		if (folders.length === 0) {
			const done = ajouter(page, "div", "qbd-home-done");
			currentHost().ui.setIcon(ajouter(done, "span", "qbd-home-done-icon"), "circle-check");
			ajouter(done, "p", "qbd-home-done-title", t("dashboard.home.allDone"));
			ajouter(done, "p", "qbd-home-done-hint", t("dashboard.home.allDoneHint"));
			return;
		}
		// Every upcoming exam of every folder — a folder with nothing to do
		// today can still have its exam this week.
		const exams: HomeExam[] = groups
			.flatMap(group => upcomingExams(ctx.examens?.(group) ?? [], todayIso).map(exam => ({ exam, group })))
			.sort((a, b) => a.exam.date.localeCompare(b.exam.date));

		const layout = ajouter(page, "div", "qbd-home-layout");
		const column = ajouter(layout, "div", "qbd-home-folders");
		for (const folder of folders) renderHomeFolder(column, ctx, folder, stats, todayStart, entryDelay());
		renderHomeSide(layout, {
			ctx, folders, exams, todayStart, weekOffset,
			moveWeek: (delta) => { weekOffset += delta; rerender(); },
		});
	}

	/* "Resume" hero — tinted with the accent of the quiz's FOLDER, like its
	   card (design review 2026-07-28): the vertical edge, halo, label, bar and
	   button derive from it. That settles the competition of accents: the
	   light pill stays the page action ("Generate a quiz"), the hero speaks
	   its module's colour instead of the interface blue. */
	function renderResumeHero(container: HTMLElement, quiz: QuizIndexEntry, stats: QuizStatRecord | null | undefined, accent: string): void {
		const total = quiz.questions || (stats && stats.totalQuestions) || 0;
		const done = stats ? stats.questionsDone : 0;
		const pct = total > 0 ? Math.round(done / total * 100) : 0;

		const hero = ajouter(container, "div", "qbd-resume-hero");
		hero.style.setProperty("--accent", accent);
		const open = () => ctx.navigate("detail", { quiz });
		hero.addEventListener("click", open);

		// Halo behind the content: its own box, fully contained (an ellipse
		// spilling out would be cut sharp by a scrolling ancestor).
		ajouter(hero, "div", "qbd-resume-halo");

		const info = ajouter(hero, "div", "qbd-resume-info");

		const label = ajouter(info, "div", "qbd-resume-label");
		const labelIcon = ajouter(label, "span", "qbd-resume-label-icon");
		currentHost().ui.setIcon(labelIcon, "history");
		ajouter(label, "span", undefined, t("dashboard.home.resumeLabel"));

		ajouter(info, "p", "qbd-resume-title", quiz.title);

		// Parent folder, same source as the cards' line: the hero says where
		// the quiz comes from, otherwise its accent colour refers to nothing
		// on screen.
		const segs = quiz.path.split("/").slice(0, -1).filter(Boolean);
		if (segs.length > 0) {
			ajouter(info, "p", "qbd-resume-path", segs[segs.length - 1]);
		}

		const progress = ajouter(info, "div", "qbd-resume-progress");
		const bar = ajouter(progress, "div", "qbd-resume-bar");
		const fill = ajouter(bar, "div", "qbd-resume-bar-fill");
		fill.style.width = `${pct}%`;
		// Agreement follows the TOTAL ("0/1 question", "3/10 questions"): the
		// counter is then inserted as is in the progress line.
		const questions = t(total === 1 ? "dashboard.common.questionsOfOne" : "dashboard.common.questionsOfOther", { done, total });
		ajouter(progress, "span", "qbd-resume-progress-text", t("dashboard.home.resumeProgress", { questions, pct }));

		const btn = ajouter(hero, "button", "qbd-btn qbd-resume-btn");
		const btnIcon = ajouter(btn, "span", "qbd-btn-icon");
		currentHost().ui.setIcon(btnIcon, "play");
		ajouter(btn, "span", undefined, t("dashboard.home.resumeBtn"));
		btn.addEventListener("click", (e) => { e.stopPropagation(); open(); });
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
