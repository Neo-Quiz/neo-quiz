/* ══════════════════════════════════════════════════════════
   THE PLAN OF AN "/exam" PREPARATION, IN THE SIDEBAR (2026-09-30)

   The model reads every document, then plans the quizzes (`planifier`,
   file-generation-app.ts). The plan shows in the sidebar of the Generate
   page, one line per quiz: waiting, being made (animated, so the current
   one stands out), done (a click opens it) or failed. It follows the queue
   by itself and lets go once it has left the document.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { t } from "../i18n";
import type { FileGenerationApp, LigneGeneration } from "./file-generation-app";

/** The plan of the latest preparation of the queue: its planning line and its quizzes. */
function dernierPlan(lignes: readonly LigneGeneration[]): { plan: LigneGeneration; etapes: LigneGeneration[] } | null {
	const plan = [...lignes].reverse().find(l => l.demande.planifier && l.etat !== "arret");
	const lot = plan?.demande.preparation?.lot;
	if (!plan || !lot) return null;
	return { plan, etapes: lignes.filter(l => l.demande.preparation?.lot === lot && !l.demande.planifier && l.etat !== "arret") };
}

export function poserPlan(parent: HTMLElement, file: FileGenerationApp, ouvrir: (chemin: string) => void): void {
	const host = currentHost();
	const zone = ajouter(parent, "div", "qbd-ai-plan");
	let desabonner: (() => void) | null = null;

	const peindre = (): void => {
		if (!zone.isConnected && desabonner) { desabonner(); desabonner = null; return; }
		zone.replaceChildren();
		const courant = dernierPlan(file.lignes());
		zone.hidden = !courant;
		if (!courant) return;
		const titre = ajouter(zone, "div", "qbd-ai-plan-titre");
		ajouter(titre, "span", undefined, t("ai.exam.planTitle"));
		const examen = courant.plan.demande.preparation?.examen?.nom;
		if (examen) ajouter(titre, "span", "qbd-ai-plan-examen", examen);
		// Still reading and planning: one animated line says so.
		if (courant.plan.etat === "attente" || courant.plan.etat === "cours") {
			const l = ajouter(zone, "div", "qbd-ai-plan-etape is-current");
			host.ui.setIcon(ajouter(l, "span", "qbd-ai-plan-icone"), "loader");
			ajouter(l, "span", "qbd-ai-plan-nom", t("ai.exam.planning"));
			return;
		}
		for (const e of courant.etapes) {
			const enCours = e.etat === "cours" || e.etat === "enregistrement";
			const fini = e.etat === "prete" && !!e.resultat?.chemin;
			const b = ajouter(zone, fini ? "button" : "div", "qbd-ai-plan-etape" + (enCours ? " is-current" : "") + (fini ? " is-done" : "") + (e.etat === "echouee" ? " is-failed" : ""));
			if (b instanceof HTMLButtonElement) {
				b.type = "button";
				b.addEventListener("click", () => { if (e.resultat?.chemin) ouvrir(e.resultat.chemin); });
			}
			const icone = enCours ? "loader" : fini ? "circle-check" : e.etat === "echouee" ? "circle-alert" : "circle";
			host.ui.setIcon(ajouter(b, "span", "qbd-ai-plan-icone"), icone);
			const nom = ajouter(b, "span", "qbd-ai-plan-nom", e.demande.preparation?.titre ?? "");
			nom.title = e.demande.preparation?.focus || "";
		}
	};
	desabonner = file.abonner(peindre, () => false);
	peindre();
}
