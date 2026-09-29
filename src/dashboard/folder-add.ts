import { currentHost, requireHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { HostModalHandle } from "../host/types";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import { createOptionCard, createQuizInFolder, importFileIntoFolder, importQuizIntoFolder } from "./folder-create";
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
		onOpen: (m) => renderNewQuizOptions(m.contentEl, m, ctx, folder, onDone),
	});
}

/** The three options, in the modal or right on the page of an empty folder
    (`renderEmptyFolder`). `m` is null on the page: nothing to close. */
function renderNewQuizOptions(c: HTMLElement, m: HostModalHandle | null, ctx: DashboardShellCtx, folder: string, onDone: () => void): void {
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
}

/** AN EMPTY FOLDER (2026-09-29): instead of "No quiz found" and a "New
    quiz" button, the three options straight on the page, in a zone that
    also takes a shared quiz dropped on it. */
export function renderEmptyFolder(parent: HTMLElement, ctx: DashboardShellCtx, folder: string, onDone: () => void): void {
	const zone = ajouter(parent, "div", "qbd-folder-empty");
	ajouter(zone, "p", "qbd-folder-empty-title", t("dashboard.folder.emptyTitle"));
	renderNewQuizOptions(ajouter(zone, "div", "qbd-folder-empty-options"), null, ctx, folder, onDone);
	const drop = ajouter(zone, "p", "qbd-folder-empty-drop");
	currentHost().ui.setIcon(ajouter(drop, "span", "qbd-folder-empty-drop-icon"), "upload");
	ajouter(drop, "span", undefined, t("dashboard.folder.emptyDrop"));

	/* Only a drag carrying FILES lights the zone up (a text selection
	   dragged over it does not). `depth` counts enter/leave pairs: moving
	   over a child fires a leave on the zone itself. */
	const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
	let depth = 0;
	zone.addEventListener("dragenter", (e) => {
		if (!hasFiles(e)) return;
		e.preventDefault();
		depth++;
		zone.classList.add("is-dragover");
	});
	zone.addEventListener("dragover", (e) => {
		if (!hasFiles(e) || !e.dataTransfer) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = "copy";
	});
	zone.addEventListener("dragleave", () => {
		depth = Math.max(0, depth - 1);
		if (depth === 0) zone.classList.remove("is-dragover");
	});
	zone.addEventListener("drop", (e) => {
		if (!hasFiles(e)) return;
		e.preventDefault();
		e.stopPropagation();
		depth = 0;
		zone.classList.remove("is-dragover");
		const files = [...(e.dataTransfer?.files ?? [])];
		void (async () => {
			for (const f of files) await importFileIntoFolder(folder, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }, onDone);
		})();
	});
}
