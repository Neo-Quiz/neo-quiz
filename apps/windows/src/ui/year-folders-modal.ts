/* "Organise by school year" (Settings › Moodle, Sync section; spec
   2026-10-15-year-folders-design §2). A modal that lists what will move, then
   moves on "Organise". The plan and the run are shared code
   (`src/dashboard/year-folders*.ts`); this file only draws. Settings is a
   modal: flat buttons only. */

import { currentHost, requireHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";
import type { DashboardShellCtx } from "../../../../src/types/dashboard-ctx";
import type { YearPlan } from "../../../../src/dashboard/year-folders";
import { runYearFolders } from "../../../../src/dashboard/year-folders-run";

export function openYearFoldersModal(ctx: DashboardShellCtx, rootId: string, plan: YearPlan, onDone: () => void): void {
	let ran = false;
	requireHost("modals").open({
		className: "qbd-medit-modal nq-annees-modal",
		title: t("settings.moodle.organiseTitle"),
		onOpen: (m) => {
			const c = m.contentEl;
			ajouter(c, "p", "nq-annees-intro", t("settings.moodle.organiseIntro", { n: plan.moves.length }));
			const liste = ajouter(c, "div", "nq-annees-liste");
			for (const annee of [...new Set(plan.moves.map(x => x.yearFolder))]) {
				const bloc = ajouter(liste, "div", "nq-annees-bloc");
				const tete = ajouter(bloc, "div", "nq-annees-annee");
				currentHost().ui.setIcon(ajouter(tete, "span", "nq-annees-icone"), "folder");
				ajouter(tete, "span", "nq-annees-nom", annee);
				if (plan.create.includes(annee)) ajouter(tete, "span", "nq-annees-neuf", t("settings.moodle.organiseNew"));
				const ul = ajouter(bloc, "ul", "nq-annees-cours");
				for (const mv of plan.moves.filter(x => x.yearFolder === annee)) ajouter(ul, "li", undefined, mv.folder);
			}
			for (const p of plan.collisions) ajouter(c, "p", "nq-annees-erreur", t("settings.moodle.organiseCollision", { path: p }));
			const statut = ajouter(c, "p", "nq-annees-statut");
			statut.setAttribute("aria-live", "polite");
			statut.hidden = true;
			const row = ajouter(c, "div", "qb-confirm-buttons");
			const annuler = ajouter(row, "button", "qb-btn", t("editor.action.cancel"));
			annuler.type = "button";
			annuler.addEventListener("click", () => m.close());
			const ranger = ajouter(row, "button", "qb-btn", t("settings.moodle.organiseCta"));
			ranger.type = "button";
			// Pre-flight: a target that already exists keeps the button disabled; nothing moves.
			ranger.disabled = plan.collisions.length > 0 || plan.moves.length === 0;
			ranger.addEventListener("click", () => {
				if (ran) return;
				ran = true;
				ranger.disabled = true;
				annuler.disabled = true;
				statut.hidden = false;
				void runYearFolders(ctx, rootId, plan, (done, total) => {
					statut.textContent = t("settings.moodle.organiseRunning", { done, total });
				}).then(r => {
					const lignes = [r.failed
						? t("settings.moodle.organiseFailed", { folder: r.failed, n: r.moved.length })
						: t("settings.moodle.organiseDone", { n: r.moved.length })];
					if (r.dashboard === "failed") lignes.push(t("settings.moodle.organiseDashboardFailed"));
					statut.textContent = lignes.join(" ");
					statut.classList.toggle("nq-annees-erreur", r.failed !== null || r.dashboard === "failed");
				}).catch(e => {
					console.error("[quiz-blocks] organise by school year failed:", e);
					statut.textContent = t("dashboard.quizzes.moveFolderError");
					statut.classList.add("nq-annees-erreur");
				}).finally(() => {
					row.replaceChildren();
					const fermer = ajouter(row, "button", "qb-btn", t("settings.moodle.organiseClose"));
					fermer.type = "button";
					fermer.addEventListener("click", () => m.close());
				});
			});
		},
		onClose: () => { if (ran) onDone(); },
	});
}
