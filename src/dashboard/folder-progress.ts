import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { renderProgressRing } from "./quiz-card";
import { computeQuizState } from "./quiz-mastery";
import { placerIndicateur } from "./seg-indic";
import type { OngletDossier, VuesDossier } from "./quizzes-render";

/* ══════════════════════════════════════════════════════════
   ONGLET « PROGRESSION » d'un dossier (2026-09-25).

   Le panneau « Progrès » vivait dans une colonne à droite de la grille :
   il répétait, sur la page où l'on travaille, ce que chaque carte disait
   déjà. Il a son onglet, comme la page d'un cours chez StudySmarter, et y
   devient des TUILES de chiffres : une grande pour l'avancement du dossier,
   trois petites pour les quiz maîtrisés, en cours, à commencer.
   `inModule` = TOUS les quiz du dossier. « À revoir » (fini sous le seuil)
   compte comme « en cours » : pas encore acquis.
══════════════════════════════════════════════════════════ */

export function renderFolderProgress(parent: HTMLElement, inModule: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): HTMLElement {
	const total = inModule.length;
	let masteredN = 0, enCoursN = 0, freshN = 0, somme = 0;
	for (const quiz of inModule) {
		const { state, pct } = computeQuizState(quiz, stats[quiz.path]);
		somme += state === "mastered" ? 100 : pct;
		if (state === "mastered") masteredN++;
		else if (state === "fresh") freshN++;
		else enCoursN++;
	}
	const moyenne = total > 0 ? Math.round(somme / total) : 0;

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
	return vue;
}

/* Le sélecteur Contenu | Progression, sur la ligne du titre du dossier, avec
   l'indicateur qui glisse d'un onglet à l'autre (celui de « Générer »). */
export function renderOngletsDossier(parent: HTMLElement, actif: OngletDossier, choisir: (onglet: OngletDossier) => void): void {
	const barre = ajouter(parent, "div", "qbd-folder-view-tabs");
	barre.setAttribute("role", "tablist");
	const indic = ajouter(barre, "div", "qbd-folder-view-tabs-indic");
	const boutons = new Map<OngletDossier, HTMLButtonElement>();
	const cles: Record<OngletDossier, TransKey> = { contenu: "dashboard.quizzes.tabContent", progression: "dashboard.quizzes.tabProgress" };
	for (const onglet of ["contenu", "progression"] as const) {
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

/** Montre la vue de l'onglet choisi, qui entre en fondu. */
export function basculerVueDossier(vues: VuesDossier, onglet: OngletDossier): void {
	if (!vues.progression) return;
	const montree = onglet === "progression" ? vues.progression : vues.contenu;
	vues.contenu.hidden = montree !== vues.contenu;
	vues.progression.hidden = montree !== vues.progression;
	if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		montree.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "ease-out" });
	}
}
