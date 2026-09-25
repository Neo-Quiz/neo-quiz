import { ajouter } from "../dom";
import { t } from "../i18n";
import { currentHost } from "../host/current";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { quizModeLabel } from "./quiz-card";
import { computeQuizState } from "./quiz-mastery";
import { openActionMenu } from "./ui-select";

/* ══════════════════════════════════════════════════════════
   L'ÉTAPE SUIVANTE d'un dossier (2026-09-25) : un bouton scindé au-dessus
   de la grille. La partie principale lance le premier quiz pas encore
   maîtrisé, dans l'ordre des cours, le Learn d'un cours avant son
   Practice ; la flèche propose le prochain Learn et le prochain Practice.
   Plus rien à faire (tout maîtrisé) : pas de bouton.
══════════════════════════════════════════════════════════ */

const ICONES = { learn: "book-open", practice: "dumbbell" } as const;

/** `ordre` : les quiz dans l'ordre des cartes, le Learn avant le Practice
    d'un même cours. */
export function renderNextStep(parent: HTMLElement, ctx: DashboardShellCtx, ordre: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): void {
	const aFaire = ordre.filter(q => computeQuizState(q, stats[q.path]).state !== "mastered");
	const suivant = aFaire[0];
	if (!suivant) return;
	const learn = aFaire.find(q => q.mode === "learn");
	const practice = aFaire.find(q => q.mode === "practice");

	const split = ajouter(parent, "div", "qbd-next-step");
	const main = ajouter(split, "button", "qbd-next-step-main");
	main.type = "button";
	main.title = t(suivant.mode === "learn" ? "dashboard.quiz.modeLearnHelp" : "dashboard.quiz.modePracticeHelp");
	currentHost().ui.setIcon(ajouter(main, "span", "qbd-next-step-icon"), "play");
	ajouter(main, "span", "qbd-next-step-mode", quizModeLabel(suivant.mode));
	ajouter(main, "span", "qbd-next-step-title", suivant.title);
	main.addEventListener("click", () => ctx.openQuiz(suivant));

	// La flèche n'a de sens que s'il reste un AUTRE mode que celui du bouton.
	if (!learn || !practice) return;
	const caret = ajouter(split, "button", "qbd-next-step-caret");
	caret.type = "button";
	caret.setAttribute("aria-label", t("dashboard.quizzes.nextStepMore"));
	caret.setAttribute("aria-haspopup", "menu");
	currentHost().ui.setIcon(caret, "chevron-down");
	caret.addEventListener("click", () => {
		openActionMenu(caret, [learn, practice].map(q => ({
			icon: ICONES[q.mode],
			label: `${quizModeLabel(q.mode)} · ${q.title}`,
			sub: t(q.mode === "learn" ? "dashboard.quiz.modeLearnHelp" : "dashboard.quiz.modePracticeHelp"),
			onClick: () => ctx.openQuiz(q),
		})));
	});
}
