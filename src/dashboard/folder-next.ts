import { ajouter } from "../dom";
import { t } from "../i18n";
import { currentHost } from "../host/current";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { quizModeLabel } from "./quiz-card";
import { computeQuizState } from "./quiz-mastery";
import { openActionMenu } from "./ui-select";
import { poserBouton3d } from "./cta3d";
import { duesDuDossier, questions } from "./folder-progress-details";

/* ══════════════════════════════════════════════════════════
   L'ÉTAPE SUIVANTE d'un dossier (2026-09-25) : un bouton scindé au-dessus
   de la grille. La partie principale lance, dans cet ordre, la révision du
   jour (si l'ordonnanceur en a pour ce dossier), sinon le prochain Learn
   pas encore maîtrisé, sinon le prochain Practice ; la flèche propose les
   autres. Plus rien à faire : pas de bouton.
══════════════════════════════════════════════════════════ */

const ICONES = { learn: "book-open", practice: "dumbbell" } as const;

/** Un choix du bouton : ce qu'il affiche et ce qu'il lance. */
interface Choix { icone: string; mode: string; titre: string; aide: string; lancer: () => void }

/** `ordre` : les quiz dans l'ordre des cartes, le Learn avant le Practice
    d'un même cours. Le bouton propose d'abord la RÉVISION du jour quand
    l'ordonnanceur en a pour ce dossier (2026-09-25, d'après le « Réviser N
    flashcards » de StudySmarter), puis le prochain Learn, puis le prochain
    Practice ; la flèche offre les autres. */
export function renderNextStep(parent: HTMLElement, ctx: DashboardShellCtx, ordre: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): void {
	const aFaire = ordre.filter(q => computeQuizState(q, stats[q.path]).state !== "mastered");
	const choix: Choix[] = [];
	const dues = duesDuDossier(ctx, ordre);
	if (dues.total > 0 && dues.lignes.length > 0) {
		const note = dues.lignes[0].quiz;
		choix.push({
			icone: "rotate-ccw", mode: t("dashboard.quizzes.progressDueAction"), titre: questions(dues.total),
			aide: t("dashboard.quizzes.nextStepReviewHelp"), lancer: () => ctx.openQuiz(note),
		});
	}
	for (const mode of ["learn", "practice"] as const) {
		const q = aFaire.find(x => x.mode === mode);
		if (!q) continue;
		choix.push({
			icone: ICONES[mode], mode: quizModeLabel(mode), titre: q.title,
			aide: t(mode === "learn" ? "dashboard.quiz.modeLearnHelp" : "dashboard.quiz.modePracticeHelp"),
			lancer: () => ctx.openQuiz(q),
		});
	}
	const premier = choix[0];
	if (!premier) return;

	/* Le bouton 3D de « Commencer le quiz » (cta3d.ts), SCINDÉ : une seule
	   face surélevée porte les deux boutons — cliquer l'un ou l'autre
	   l'enfonce (`:active` remonte au conteneur), et le reflet balaie le
	   tout (2026-09-26). */
	const split = ajouter(parent, "div", "qbd-next-step");
	const main = ajouter(split, "button", "qbd-next-step-main");
	main.type = "button";
	main.title = premier.aide;
	currentHost().ui.setIcon(ajouter(main, "span", "qbd-next-step-icon"), "play");
	ajouter(main, "span", "qbd-next-step-mode", premier.mode);
	ajouter(main, "span", "qbd-next-step-title", premier.titre);
	main.addEventListener("click", premier.lancer);

	// La flèche n'a de sens que s'il reste un AUTRE choix que celui du bouton.
	if (choix.length >= 2) ajouterFleche(split, choix);
	poserBouton3d(split);
}

function ajouterFleche(split: HTMLElement, choix: Choix[]): void {
	const caret = ajouter(split, "button", "qbd-next-step-caret");
	caret.type = "button";
	caret.setAttribute("aria-label", t("dashboard.quizzes.nextStepMore"));
	caret.setAttribute("aria-haspopup", "menu");
	currentHost().ui.setIcon(caret, "chevron-down");
	caret.addEventListener("click", () => {
		openActionMenu(caret, choix.map(c => ({ icon: c.icone, label: `${c.mode} · ${c.titre}`, sub: c.aide, onClick: c.lancer })));
	});
}
