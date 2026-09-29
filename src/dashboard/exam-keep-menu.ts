import { currentHost } from "../host/current";
import { t } from "../i18n";
import { findQuizModeConfigIndex, parseQuizSource, QUIZ_BLOCK_RE } from "../quiz-utils";
import { examMinutesToKeep } from "../test-setup";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import { saveKeepExam } from "./detail-io";
import type { KeepExam } from "./exam-keep";
import type { QuizIndexEntry } from "./scanner";
import type { ActionMenuItem } from "./ui-select";

/* ══════════════════════════════════════════════════════════
   "KEEP EXAM MODE" IN A QUIZ'S "⋯" MENUS (spec 2026-09-29-test-setup-modal-design.md
   §2, moved out of the "Set up your test" modal on 2026-09-29).

   A checkable item, for a Test only (a Learn has no exam mode to keep). It is
   checked when the note's configuration says `mode: "exam"`, which is what
   the scanner reads (`QuizIndexEntry.mode`). Toggling it writes the note
   through `saveKeepExam` (`detail-io.ts`): the reviewed path, with its
   compare-and-swap on the block, that leaves every other byte of the note
   where it was. The card's menu and the quiz page's "⋮" menu are the SAME
   items (`buildQuizCardMenu`), so both get this one.
══════════════════════════════════════════════════════════ */

/** The duration written when Exam mode is switched on: what this quiz was
    last played with, else the note's own `examDurationMinutes`, else the
    fallback rule for its question count. */
async function minutesToWrite(ctx: DashboardShellCtx, quiz: QuizIndexEntry, source: string): Promise<number> {
	const items = parseQuizSource(source, { logErrors: false }) as unknown as Array<Record<string, unknown>>;
	const at = findQuizModeConfigIndex(items);
	const fileMinutes = at >= 0 && typeof items[at].examDurationMinutes === "number" ? items[at].examDurationMinutes as number : null;
	return examMinutesToKeep(await ctx.rememberedTestMinutes?.(quiz.path) ?? null, fileMinutes, quiz.questions);
}

/** Writes (`keep`) or removes Exam mode on the quiz's note, then has the
    scanner read the note again. `false` when nothing was written: the note or
    its block is gone or unreadable, or the block changed since it was read. */
async function setKeepExam(ctx: DashboardShellCtx, quiz: QuizIndexEntry, keep: boolean): Promise<boolean> {
	const host = currentHost();
	try {
		const match = (await host.fs.read(quiz.path)).match(QUIZ_BLOCK_RE);
		if (!match) return false;
		const change: KeepExam = keep ? { minutes: await minutesToWrite(ctx, quiz, match[1]) } : null;
		if (!await saveKeepExam(quiz.path, match[1], change)) return false;
	} catch {
		return false;
	}
	// The watcher would pick the write up too, but later than the repaint.
	const file = host.fs.getFile(quiz.path);
	if (file) await ctx.scanner.scanFile(file);
	return true;
}

/** The menu item, or `null` for a Learn. `rerender` repaints the page or grid
    that opened the menu, once the note has been written and scanned. */
export function keepExamMenuItem(ctx: DashboardShellCtx, quiz: QuizIndexEntry, rerender: () => void): ActionMenuItem | null {
	// The catalogue's entry, not the one the card was drawn from: it is the
	// one that knows about a toggle made since.
	const fresh = ctx.scanner.getQuiz(quiz.path) ?? quiz;
	if (fresh.mode === "learn") return null;
	const kept = fresh.mode === "exam";
	return {
		icon: "graduation-cap",
		label: t("engine.testSetup.keepExam"),
		checked: kept,
		onClick: () => {
			void setKeepExam(ctx, fresh, !kept).then(ok => {
				if (ok) rerender();
				else currentHost().ui.notice(t("dashboard.quizzes.keepExamFailed"));
			});
		},
	};
}
