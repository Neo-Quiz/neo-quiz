import { currentHost, requireHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { HostModalHandle } from "../host/types";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import { createQuizInFolder, importQuizIntoFolder } from "./folder-create";
import { cheminsAJoindre, lireContenuDossier } from "./folder-contents";
import { ajouterDesFichiers, brancherDepot, choisirFichiers, creerUneNote, ouvrirModalLien } from "./folder-sections";

/* ══════════════════════════════════════════════════════════
   « AJOUTER DU CONTENU » à un dossier (2026-09-25, d'après StudySmarter).

   Remplace le modal « Nouveau quiz » et son bouton d'en-tête : une seule
   porte pour tout ce qui entre dans un dossier. En haut, les SOURCES (une
   zone de dépose, l'upload de fichiers, un lien) ; sous « ou », ce qu'on
   CRÉE (un quiz par l'IA, un quiz vierge, un quiz partagé, une note).
══════════════════════════════════════════════════════════ */

export function openAddContentModal(ctx: DashboardShellCtx, folder: string, onDone: () => void): void {
	const deps = { ctx, folder, rerender: onDone };
	requireHost("modals").open({
		className: "qbd-create-modal qbd-add-modal",
		title: t("dashboard.folder.addContent"),
		onOpen: (m) => {
			const c = m.contentEl;

			const zone = ajouter(c, "div", "qbd-add-drop");
			ajouter(zone, "div", "qbd-add-drop-title", t("dashboard.folder.addDropTitle"));
			ajouter(zone, "div", "qbd-add-drop-hint", t("dashboard.folder.addDropHint"));
			const boutons = ajouter(zone, "div", "qbd-add-drop-actions");
			bouton(boutons, "upload", t("dashboard.folder.addFiles"), () => { m.close(); void ajouterDesFichiers(deps, choisirFichiers()); });
			bouton(boutons, "link", t("dashboard.folder.addLink"), () => { m.close(); ouvrirModalLien(deps); });
			zone.dataset.dropHint = t("dashboard.folder.dropHint");
			brancherDepot(zone, (fichiers) => { m.close(); void ajouterDesFichiers(deps, Promise.resolve(fichiers)); });

			ajouter(c, "div", "qbd-add-or", t("dashboard.folder.addOr"));

			const tuiles = ajouter(c, "div", "qbd-add-tiles");
			/* Masquée quand l'hôte ne sert pas « ai » : même garde que le
			   modal de création d'un dossier (folder-create.ts). Depuis un
			   dossier, « Générer » arrive avec ce dossier en destination et
			   ses documents et notes déjà joints. */
			if (ctx.canOpen("ai")) {
				tuile(m, tuiles, "sparkles", "#a78bfa", t("dashboard.folder.addGenerate"), () => {
					void lireContenuDossier(folder, (path) => !!ctx.scanner.getQuiz(path)).then(contenu => {
						ctx.navigate("ai", { aiPreset: { destination: folder, attach: cheminsAJoindre(contenu) } });
					});
				});
			}
			tuile(m, tuiles, "file-plus", "#4573ff", t("dashboard.quizzes.createQuizEmptyTitle"), () => void createQuizInFolder(ctx, folder));
			tuile(m, tuiles, "download", "#f5a524", t("dashboard.quizzes.createQuizImportTitle"), () => void importQuizIntoFolder(ctx, folder, onDone));
			tuile(m, tuiles, "pen-line", "#3ddc84", t("dashboard.folder.createNote"), () => void creerUneNote(deps));
		},
	});
}

function bouton(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
	const b = ajouter(parent, "button", "qbd-folder-section-action");
	b.type = "button";
	currentHost().ui.setIcon(ajouter(b, "span", "qbd-folder-section-action-icon"), icon);
	ajouter(b, "span", undefined, label);
	b.addEventListener("click", onClick);
}

function tuile(m: HostModalHandle, parent: HTMLElement, icon: string, accent: string, titre: string, onPick: () => void): void {
	const b = ajouter(parent, "button", "qbd-add-tile");
	b.type = "button";
	b.style.setProperty("--accent", accent);
	currentHost().ui.setIcon(ajouter(b, "span", "qbd-create-option-icon"), icon);
	ajouter(b, "span", "qbd-add-tile-title", titre);
	b.addEventListener("click", () => { m.close(); onPick(); });
}
