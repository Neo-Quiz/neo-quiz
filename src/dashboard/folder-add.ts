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

/** The options, in the modal or right on the page of an empty folder
    (`renderEmptyFolder`). `m` is null on the page: nothing to close. The
    empty page passes `withImport = false`: its import is a drop zone of its
    own, below the two rows. */
function renderNewQuizOptions(c: HTMLElement, m: HostModalHandle | null, ctx: DashboardShellCtx, folder: string, onDone: () => void, withImport = true): void {
	/* Hidden when the host does not serve "ai": the same guard as the
	   folder creation modal. From a folder, Generate arrives with this
	   folder as destination and its documents and notes attached. */
	/* The same order and colours as "Create a folder" (2026-10-05): by hand
	   in blue, with the AI in green, import in violet. */
	createOptionCard(m, c, "pencil-line", "#4573ff", t("dashboard.quizzes.createQuizEmptyTitle"), t("dashboard.folder.newQuizEmptyDesc"),
		() => void createQuizInFolder(ctx, folder));
	if (ctx.canOpen("ai")) {
		createOptionCard(m, c, "sparkles", "#3ddc84", t("dashboard.folder.addGenerate"), t("dashboard.folder.newQuizAiDesc"), () => {
			void lireContenuDossier(folder, (path) => !!ctx.scanner.getQuiz(path)).then(contenu => {
				ctx.navigate("ai", { aiPreset: { destination: folder, attach: cheminsAJoindre(contenu) } });
			});
		});
	}
	if (!withImport) return;
	createOptionCard(m, c, "download", "#a78bfa", t("dashboard.quizzes.createQuizImportTitle"), t("dashboard.folder.newQuizImportDesc"),
		() => void importQuizIntoFolder(ctx, folder, onDone));
}

/** AN EMPTY FOLDER (2026-09-29): instead of "No quiz found" and a "New
    quiz" button, the two ways to CREATE a quiz straight on the page (same
    rows as the modal, no frame), then a drop zone for a shared one: the
    import is the only thing that takes dropped files, and a click on it
    opens the file picker. */
export function renderEmptyFolder(parent: HTMLElement, ctx: DashboardShellCtx, folder: string, onDone: () => void): void {
	const page = ajouter(parent, "div", "qbd-empty-folder");
	ajouter(page, "p", "qbd-empty-folder-title", t("dashboard.folder.emptyTitle"));
	renderNewQuizOptions(ajouter(page, "div", "qbd-empty-folder-options"), null, ctx, folder, onDone, false);

	/* A real button: click, Enter and Space open the same picker as the
	   import row of the modal (`importQuizIntoFolder`). */
	const zone = ajouter(page, "button", "qbd-drop-zone");
	zone.type = "button";
	currentHost().ui.setIcon(ajouter(zone, "span", "qbd-drop-zone-icon"), "download");
	ajouter(zone, "span", "qbd-drop-zone-title", t("dashboard.folder.emptyDropTitle"));
	ajouter(zone, "span", "qbd-drop-zone-hint", t("dashboard.folder.emptyDropHint"));
	zone.addEventListener("click", () => void importQuizIntoFolder(ctx, folder, onDone));

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
