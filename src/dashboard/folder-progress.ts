import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { renderProgressRing } from "./quiz-card";
import { computeQuizState } from "./quiz-mastery";
import { placerIndicateur } from "./seg-indic";
import type { OngletDossier, VuesDossier } from "./quizzes-render";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { ModuleGroup, ModuleMap } from "./quiz-modules";
import type { CarteCours } from "./course-pairs";
import { renderListeCours } from "./folder-progress-details";

/** Ce que les tuiles du bas demandent en plus des chiffres. */
export interface DetailsProgression {
	ctx: DashboardShellCtx;
	/** Le dossier, pour la date d'examen et son modal « Modifier ». */
	group: ModuleGroup;
	map: ModuleMap;
	rerender: () => void;
	/** Les cartes de la grille : un cours, ses deux modes. */
	cartes: CarteCours[];
}

/* ══════════════════════════════════════════════════════════
   ONGLET « PROGRESSION » d'un dossier (2026-09-25).

   Le panneau « Progrès » vivait dans une colonne à droite de la grille :
   il répétait, sur la page où l'on travaille, ce que chaque carte disait
   déjà. Il a son onglet, comme la page d'un cours chez StudySmarter, et y
   devient des TUILES de chiffres : une grande pour l'avancement du dossier,
   trois petites pour les quiz maîtrisés, en cours, à commencer ; puis
   les scores de chaque cours, mode par mode (`folder-progress-details.ts`) —
   le jour à réviser et les examens vivent dans le Planning.
   `inModule` = TOUS les quiz du dossier. « À revoir » (fini sous le seuil)
   compte comme « en cours » : pas encore acquis.
══════════════════════════════════════════════════════════ */

/** La moyenne d'avancement du dossier (anneau de Progression ET de Planning) :
    « maîtrisé » compte pour 100, sinon le pourcentage de progression — mêmes
    deux tuiles à s'accorder, jamais deux formules qui divergent. */
export function moyenneDossier(inModule: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): number {
	if (inModule.length === 0) return 0;
	let somme = 0;
	for (const quiz of inModule) {
		const { state, pct } = computeQuizState(quiz, stats[quiz.path]);
		somme += state === "mastered" ? 100 : pct;
	}
	return Math.round(somme / inModule.length);
}

export function renderFolderProgress(parent: HTMLElement, inModule: QuizIndexEntry[], stats: Record<string, QuizStatRecord>, details: DetailsProgression): HTMLElement {
	const total = inModule.length;
	let masteredN = 0, enCoursN = 0, freshN = 0;
	for (const quiz of inModule) {
		const { state } = computeQuizState(quiz, stats[quiz.path]);
		if (state === "mastered") masteredN++;
		else if (state === "fresh") freshN++;
		else enCoursN++;
	}
	const moyenne = moyenneDossier(inModule, stats);

	const vue = ajouter(parent, "div", "qbd-folder-progress");

	const grande = ajouter(vue, "div", "qbd-folder-progress-tile qbd-folder-progress-tile--wide");
	renderProgressRing(grande, moyenne, masteredN === total && total > 0 ? "done" : moyenne > 0 ? "progress" : "fresh", 96, 7);
	const texte = ajouter(grande, "div", "qbd-folder-progress-text");
	ajouter(texte, "div", "qbd-folder-progress-label", t("dashboard.quizzes.progressOverall"));
	ajouter(texte, "div", "qbd-folder-progress-sub", t("dashboard.quizzes.progressMasteredOf", { mastered: masteredN, total }));

	const tuile = (tone: string, n: number, libelle: string): void => {
		const el = ajouter(vue, "div", `qbd-folder-progress-tile qbd-folder-progress-tile--${tone}`);
		ajouter(el, "b", undefined, String(n));
		ajouter(el, "span", undefined, libelle);
	};
	tuile("done", masteredN, t(masteredN > 1 ? "dashboard.quizzes.progressMasteredOther" : "dashboard.quizzes.progressMasteredOne"));
	tuile("progress", enCoursN, t("dashboard.quizzes.progressInProgress"));
	tuile("fresh", freshN, t("dashboard.quizzes.progressToStart"));

	renderListeCours(vue, details.ctx, details.cartes, stats);
	return vue;
}

/* Le sélecteur Contenu | Progression, sur la ligne du titre du dossier, avec
   l'indicateur qui glisse d'un onglet à l'autre (celui de « Générer »). */
export function renderOngletsDossier(parent: HTMLElement, actif: OngletDossier, choisir: (onglet: OngletDossier) => void): void {
	const barre = ajouter(parent, "div", "qbd-folder-view-tabs");
	barre.setAttribute("role", "tablist");
	const indic = ajouter(barre, "div", "qbd-folder-view-tabs-indic");
	const boutons = new Map<OngletDossier, HTMLButtonElement>();
	const cles: Record<OngletDossier, TransKey> = {
		contenu: "dashboard.quizzes.tabContent",
		progression: "dashboard.quizzes.tabProgress",
		planning: "dashboard.quizzes.tabPlanning",
	};
	for (const onglet of ["contenu", "progression", "planning"] as const) {
		const b = ajouter(barre, "button", "qbd-folder-view-tab", t(cles[onglet]));
		b.type = "button";
		b.setAttribute("role", "tab");
		b.setAttribute("aria-selected", String(onglet === actif));
		b.addEventListener("click", () => {
			if (b.getAttribute("aria-selected") === "true") return;
			boutons.forEach((x, o) => x.setAttribute("aria-selected", String(o === onglet)));
			placerIndicateur(indic, b, true);
			choisir(onglet);
		});
		boutons.set(onglet, b);
	}
	requestAnimationFrame(() => placerIndicateur(indic, boutons.get(actif)!, false));
}

/** Montre la vue de l'onglet choisi, qui entre en fondu. `progression` et
    `planning` sont absentes dans le sas (`null`) : un onglet sans vue retombe
    sur « Contenu ». */
export function basculerVueDossier(vues: VuesDossier, onglet: OngletDossier): void {
	if (!vues.progression && !vues.planning) return;
	const disponibles: Record<OngletDossier, HTMLElement | null> = vues;
	const montree = disponibles[onglet] ?? vues.contenu;
	vues.contenu.hidden = montree !== vues.contenu;
	if (vues.progression) vues.progression.hidden = montree !== vues.progression;
	if (vues.planning) vues.planning.hidden = montree !== vues.planning;
	if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		montree.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "ease-out" });
	}
}
