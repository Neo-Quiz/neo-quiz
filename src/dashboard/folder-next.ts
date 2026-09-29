import { ajouter } from "../dom";
import { t } from "../i18n";
import { currentHost } from "../host/current";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { quizModeIcon, quizModeLabel } from "./quiz-card";
import { computeQuizState } from "./quiz-mastery";
import { poserBouton3d } from "./cta3d";
import { duesDuDossier, questions } from "./folder-progress-details";

/* ══════════════════════════════════════════════════════════
   A folder's NEXT STEP (2026-09-25, without an arrow since 2026-09-26): one
   button, one action: Resume the started quiz left most recently, else
   Review (when the scheduler has questions due for this folder), else the
   next Learn not mastered yet, else the next Practice, else the next Exam
   (2026-09-29). Nothing left to do: no button.
══════════════════════════════════════════════════════════ */

/** One choice of the button: what it shows and what it starts. */
interface Choix { icone: string; mode: string; titre: string; lancer: () => void }

/** `ordre`: the quizzes in card order, a course's modes Learn, Practice,
    Exam. The button first offers to RESUME a started quiz (2026-09-26),
    then today's REVIEW when the scheduler has some for this folder
    (2026-09-25, after StudySmarter's "Review N flashcards"), then the next
    Learn, then the next Practice, then the next Exam. */
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
			lancer: () => ctx.openQuiz(q),
		});
	}

	const dues = duesDuDossier(ctx, ordre);
	if (dues.total > 0 && dues.lignes.length > 0) {
		const note = dues.lignes[0].quiz;
		choix.push({
			icone: "rotate-ccw", mode: t("dashboard.quizzes.progressDueAction"), titre: questions(dues.total),
			lancer: () => ctx.openQuiz(note),
		});
	}
	for (const mode of ["learn", "practice", "exam"] as const) {
		const q = aFaire.find(x => x.mode === mode);
		if (!q) continue;
		choix.push({
			icone: quizModeIcon(mode), mode: quizModeLabel(mode), titre: q.title,
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
	currentHost().ui.setIcon(ajouter(main, "span", "qbd-next-step-icon"), "play");
	ajouter(main, "span", "qbd-next-step-mode", premier.mode);
	ajouter(main, "span", "qbd-next-step-title", premier.titre);
	main.addEventListener("click", premier.lancer);

	poserBouton3d(split);
}
