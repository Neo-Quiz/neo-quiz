import { ajouter } from "../dom";
import { t } from "../i18n";
import { currentHost } from "../host/current";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { quizModeLabel } from "./quiz-card";
import { computeQuizState } from "./quiz-mastery";
import { poserBouton3d } from "./cta3d";
import { duesDuDossier, questions } from "./folder-progress-details";

/* ══════════════════════════════════════════════════════════
   L'ÉTAPE SUIVANTE d'un dossier (2026-09-25, sans flèche depuis 2026-09-26) :
   un seul bouton, une seule action : Reprendre le quiz entamé le plus
   récemment quitté, sinon Réviser (si l'ordonnanceur a des questions dues
   pour ce dossier), sinon le prochain Learn pas encore maîtrisé, sinon le
   prochain Practice. Plus rien à faire : pas de bouton.
══════════════════════════════════════════════════════════ */

const ICONES = { learn: "book-open", practice: "dumbbell" } as const;

/** Un choix du bouton : ce qu'il affiche et ce qu'il lance. */
interface Choix { icone: string; mode: string; titre: string; aide: string; lancer: () => void }

/** `ordre` : les quiz dans l'ordre des cartes, le Learn avant le Practice
    d'un même cours. Le bouton propose d'abord de REPRENDRE un quiz entamé
    (2026-09-26), puis la RÉVISION du jour quand l'ordonnanceur en a pour ce
    dossier (2026-09-25, d'après le « Réviser N flashcards » de StudySmarter),
    puis le prochain Learn, puis le prochain Practice. */
export function renderNextStep(parent: HTMLElement, ctx: DashboardShellCtx, ordre: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): void {
	const aFaire = ordre.filter(q => computeQuizState(q, stats[q.path]).state !== "mastered");
	const choix: Choix[] = [];

	/* REPRENDRE d'abord (2026-09-26) : un quiz de ce dossier entamé et pas
	   fini — le plus récemment quitté — se reprend là où on s'était arrêté. */
	const entames = ordre
		.map(q => ({ q, s: ctx.sessionOf?.(q.path) ?? null }))
		.filter((x): x is { q: QuizIndexEntry; s: { question: number; total: number; ecrite: number } } => x.s !== null)
		.sort((a, b) => b.s.ecrite - a.s.ecrite);
	if (entames[0]) {
		const { q, s } = entames[0];
		choix.push({
			icone: "play", mode: t("dashboard.quizzes.nextStepResume"),
			titre: `${q.title} · Q${s.question}/${s.total}`,
			aide: t("dashboard.quizzes.nextStepResumeHelp"), lancer: () => ctx.openQuiz(q),
		});
	}

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

	poserBouton3d(split);
}
