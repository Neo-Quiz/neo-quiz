import { currentHost } from "../host/current";
import { t } from "../i18n";
import { QUIZ_BLOCK_RE } from "../quiz-utils";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { CategorieQuiz } from "./categorie-quiz";
import { libelleCategorie } from "./categorie-affichage";
import { saveQuizSubject } from "./detail-io";
import type { QuizIndexEntry } from "./scanner";
import { openSubjectPicker } from "./subject-picker";
import type { ActionMenuItem } from "./ui-select";

/* ══════════════════════════════════════════════════════════
   "SUBJECT" IN A QUIZ'S "⋯" MENUS (2026-10-18). Changes the quiz's own
   subject (`neo-quiz: subject:` of its note), or returns it to Automatic.
   The write is `saveQuizSubject`: one line of the frontmatter, compare-and-
   swap against the subject the catalogue showed. The card's menu and the
   quiz page's menu are the same items (`buildQuizCardMenu`).
══════════════════════════════════════════════════════════ */

/** Writes the subject on the note, then has the scanner read it again. `false`
    when nothing was written (the note or its block is gone, or changed since
    the catalogue read it). */
async function setQuizSubject(ctx: DashboardShellCtx, quiz: QuizIndexEntry, subject: CategorieQuiz | null): Promise<boolean> {
	const host = currentHost();
	try {
		const match = (await host.fs.read(quiz.path)).match(QUIZ_BLOCK_RE);
		if (!match) return false;
		if (!await saveQuizSubject(quiz.path, match[1], quiz.subject, subject)) return false;
	} catch {
		return false;
	}
	const file = host.fs.getFile(quiz.path);
	if (file) await ctx.scanner.scanFile(file);
	return true;
}

/** The menu item; it opens the picker beside `anchorEl`. `rerender` repaints
    the page or grid that opened the menu. */
export function subjectMenuItem(ctx: DashboardShellCtx, quiz: QuizIndexEntry, anchorEl: HTMLElement, rerender: () => void): ActionMenuItem {
	const fresh = ctx.scanner.getQuiz(quiz.path) ?? quiz;
	return {
		icon: "tag",
		label: t("dashboard.quizzes.subjectLabel"),
		hint: fresh.subject ? libelleCategorie(fresh.subject) : t("dashboard.quizzes.subjectAuto"),
		onClick: () => {
			openSubjectPicker(anchorEl, fresh.subject, (picked) => {
				void setQuizSubject(ctx, fresh, picked).then(ok => {
					if (ok) rerender();
					else currentHost().ui.notice(t("dashboard.quizzes.subjectSaveFailed"));
				});
			});
		},
	};
}
