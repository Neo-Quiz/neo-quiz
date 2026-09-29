import { requireHost } from "../host/current";
import { t } from "../i18n";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import { createOptionCard, createQuizInFolder, importQuizIntoFolder } from "./folder-create";
import { cheminsAJoindre, lireContenuDossier } from "./folder-contents";

/* ══════════════════════════════════════════════════════════
   "NEW QUIZ" in a folder (redrawn 2026-09-29).

   The same rows as "Create a folder" (folder-create.ts `createOptionCard`):
   generate one with the AI, start from an empty quiz, import a shared one.
   The drop zone, the link and "Create a note" that the "Add content" modal
   (2026-09-25) gathered here are gone: files, links and notes are added
   from the folder's own sections (folder-sections.ts), and a button named
   "New quiz" only creates quizzes.
══════════════════════════════════════════════════════════ */

export function openNewQuizModal(ctx: DashboardShellCtx, folder: string, onDone: () => void): void {
	requireHost("modals").open({
		className: "qbd-create-modal",
		title: t("dashboard.quizzes.newQuiz"),
		onOpen: (m) => {
			const c = m.contentEl;
			/* Hidden when the host does not serve "ai": the same guard as the
			   folder creation modal. From a folder, Generate arrives with this
			   folder as destination and its documents and notes attached. */
			if (ctx.canOpen("ai")) {
				createOptionCard(m, c, "sparkles", "#a78bfa", t("dashboard.folder.addGenerate"), t("dashboard.folder.newQuizAiDesc"), () => {
					void lireContenuDossier(folder, (path) => !!ctx.scanner.getQuiz(path)).then(contenu => {
						ctx.navigate("ai", { aiPreset: { destination: folder, attach: cheminsAJoindre(contenu) } });
					});
				});
			}
			createOptionCard(m, c, "file-plus", "#4573ff", t("dashboard.quizzes.createQuizEmptyTitle"), t("dashboard.folder.newQuizEmptyDesc"),
				() => void createQuizInFolder(ctx, folder));
			createOptionCard(m, c, "download", "#f5a524", t("dashboard.quizzes.createQuizImportTitle"), t("dashboard.folder.newQuizImportDesc"),
				() => void importQuizIntoFolder(ctx, folder, onDone));
		},
	});
}
