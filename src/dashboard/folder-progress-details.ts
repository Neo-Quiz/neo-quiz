import { ajouter } from "../dom";
import { currentLang, t } from "../i18n";
import { currentHost } from "../host/current";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import type { ModuleGroup, ModuleMap } from "./quiz-modules";
import type { CarteCours } from "./course-pairs";
import { computeQuizState } from "./quiz-mastery";
import { quizModeLabel } from "./quiz-card";
import { openModuleEditModal } from "./module-edit";
import { parseExamDate } from "../review/review-store";

/* ══════════════════════════════════════════════════════════
   LES TROIS TUILES DU BAS de l'onglet « Progression » (2026-09-25),
   reprises du « Planning de révisions » de StudySmarter sans ce qui en
   sortirait de Learn / Practice (examen blanc, épreuve orale, XP) :

   - « À réviser aujourd'hui » : ce que l'ordonnanceur a mis au programme du
     jour POUR CE DOSSIER, par note, et un bouton qui ouvre la plus chargée.
     Une séance mêlant plusieurs notes n'existe pas encore : même geste que
     la section du même nom sur l'accueil (`home.ts`).
   - « Examen » : la date déjà réglable dans « Modifier » du dossier, qui
     resserre les révisions à son approche. Montrée ici, et modifiable d'ici.
   - « Cours » : l'avancement de chaque cours, mode par mode — le détail que
     les pastilles des cartes ne portent plus.
══════════════════════════════════════════════════════════ */

/** Les clés de question `chemin::id` d'une liste, rangées par note du dossier. */
function parNote(cles: readonly string[], chemins: ReadonlySet<string>): Map<string, number> {
	const out = new Map<string, number>();
	for (const cle of cles) {
		const sep = cle.lastIndexOf("::");
		if (sep <= 0) continue;
		const chemin = cle.slice(0, sep);
		if (chemins.has(chemin)) out.set(chemin, (out.get(chemin) ?? 0) + 1);
	}
	return out;
}

/** Ce que l'ordonnanceur met au programme du jour POUR CE DOSSIER : le
    total, et les notes (la plus chargée d'abord, ordre TOTAL donc stable). */
export function duesDuDossier(ctx: DashboardShellCtx, inModule: QuizIndexEntry[]): { total: number; reportees: number; lignes: { quiz: QuizIndexEntry; n: number }[] } {
	const plan = ctx.reviewStore?.plan(Date.now());
	const chemins = new Set(inModule.map(q => q.path));
	const dues = parNote(plan?.today ?? [], chemins);
	const lignes = [...dues.entries()]
		.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
		.map(([chemin, n]) => ({ quiz: ctx.scanner?.getQuiz(chemin), n }))
		.filter((l): l is { quiz: QuizIndexEntry; n: number } => !!l.quiz);
	return {
		total: lignes.reduce((a, l) => a + l.n, 0),
		reportees: [...parNote(plan?.deferred ?? [], chemins).values()].reduce((a, b) => a + b, 0),
		lignes,
	};
}

export const questions = (n: number): string =>
	t(n === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: n });

export function renderRevisionDuJour(parent: HTMLElement, ctx: DashboardShellCtx, inModule: QuizIndexEntry[]): void {
	const tuile = ajouter(parent, "div", "qbd-folder-progress-tile qbd-folder-progress-tile--due");
	ajouter(tuile, "div", "qbd-folder-progress-label", t("dashboard.review.title"));
	const { total, reportees, lignes } = duesDuDossier(ctx, inModule);

	const tete = ajouter(tuile, "div", "qbd-folder-due-head");
	const chiffre = ajouter(tete, "div", "qbd-folder-due-count");
	ajouter(chiffre, "b", undefined, String(total));
	ajouter(chiffre, "span", undefined, t(total === 1 ? "dashboard.quizzes.progressDueOne" : "dashboard.quizzes.progressDueOther"));

	if (total === 0) {
		ajouter(tuile, "div", "qbd-folder-progress-sub", t("dashboard.quizzes.progressDueNone"));
		return;
	}
	if (lignes.length === 0) return;

	const reviser = ajouter(tete, "button", "qbd-folder-due-action");
	reviser.type = "button";
	currentHost().ui.setIcon(ajouter(reviser, "span", "qbd-btn-icon"), "play");
	ajouter(reviser, "span", undefined, t("dashboard.quizzes.progressDueAction"));
	reviser.title = lignes[0].quiz.title;
	reviser.addEventListener("click", () => ctx.openQuiz(lignes[0].quiz));

	const liste = ajouter(tuile, "div", "qbd-folder-due-list");
	for (const { quiz, n } of lignes.slice(0, 5)) {
		const ligne = ajouter(liste, "button", "qbd-folder-due-row");
		ligne.type = "button";
		ajouter(ligne, "span", "qbd-folder-due-title", quiz.title);
		ajouter(ligne, "span", "qbd-folder-due-n", questions(n));
		ligne.addEventListener("click", () => ctx.openQuiz(quiz));
	}
	/* Le report est une INFORMATION, pas un reproche : le budget du jour a
	   tenu (même phrase que l'accueil). */
	if (reportees > 0) {
		ajouter(tuile, "div", "qbd-folder-progress-sub",
			t(reportees === 1 ? "dashboard.review.deferredOne" : "dashboard.review.deferredOther", { count: reportees }));
	}
}

export function renderExamen(parent: HTMLElement, ctx: DashboardShellCtx, group: ModuleGroup, map: ModuleMap, rerender: () => void): void {
	/* Le réglage n'existe que si l'hôte sait le lire ET l'écrire, et que le
	   dossier a des quiz (même garde que le champ de « Modifier »). */
	if (!ctx.examDate || !ctx.setExamDate || group.quizzes.length === 0) return;
	const tuile = ajouter(parent, "div", "qbd-folder-progress-tile qbd-folder-progress-tile--exam");
	ajouter(tuile, "div", "qbd-folder-progress-label", t("dashboard.module.examDate"));
	const ms = parseExamDate(ctx.examDate(group));
	if (ms === null) {
		ajouter(tuile, "div", "qbd-folder-exam-date qbd-folder-exam-date--none", t("dashboard.quizzes.progressExamNone"));
		ajouter(tuile, "div", "qbd-folder-progress-sub", t("dashboard.quizzes.progressExamHint"));
	} else {
		ajouter(tuile, "div", "qbd-folder-exam-date",
			new Intl.DateTimeFormat(currentLang(), { dateStyle: "long" }).format(new Date(ms)));
		const aujourdhui = new Date();
		aujourdhui.setHours(0, 0, 0, 0);
		const jours = Math.round((ms - aujourdhui.getTime()) / 86_400_000);
		ajouter(tuile, "div", "qbd-folder-progress-sub",
			jours < 0 ? t("dashboard.quizzes.progressExamPast")
				: jours === 0 ? t("dashboard.quizzes.progressExamToday")
				: jours === 1 ? t("dashboard.quizzes.progressExamTomorrow")
				: t("dashboard.quizzes.progressExamIn", { count: jours }));
	}
	const bouton = ajouter(tuile, "button", "qbd-folder-section-action qbd-folder-exam-action");
	bouton.type = "button";
	currentHost().ui.setIcon(ajouter(bouton, "span", "qbd-folder-section-action-icon"), ms === null ? "calendar-plus" : "calendar");
	ajouter(bouton, "span", undefined, t(ms === null ? "dashboard.quizzes.progressExamAdd" : "dashboard.quizzes.progressExamEdit"));
	bouton.addEventListener("click", () => openModuleEditModal(ctx, group, map, rerender));
}

export function renderListeCours(parent: HTMLElement, ctx: DashboardShellCtx, cartes: CarteCours[], stats: Record<string, QuizStatRecord>): void {
	if (cartes.length === 0) return;
	const tuile = ajouter(parent, "div", "qbd-folder-progress-tile qbd-folder-progress-tile--courses");
	ajouter(tuile, "div", "qbd-folder-progress-label", t("dashboard.quizzes.progressCourses"));
	const liste = ajouter(tuile, "div", "qbd-folder-courses");
	for (const { quiz, frere } of cartes) {
		const ligne = ajouter(liste, "div", "qbd-folder-course");
		const titre = ajouter(ligne, "button", "qbd-folder-course-title", quiz.title);
		titre.type = "button";
		titre.addEventListener("click", () => ctx.navigate("detail", { quiz }));
		const modes = ajouter(ligne, "div", "qbd-folder-course-modes");
		for (const q of frere ? [quiz, frere] : [quiz]) {
			const { state, pct } = computeQuizState(q, stats[q.path]);
			const valeur = state === "mastered" ? 100 : pct;
			const mode = ajouter(modes, "div", "qbd-folder-course-mode");
			ajouter(mode, "span", "qbd-folder-course-mode-label", quizModeLabel(q.mode));
			const barre = ajouter(mode, "span", `qbd-folder-course-bar qbd-folder-course-bar--${state === "mastered" ? "done" : valeur > 0 ? "progress" : "fresh"}`);
			ajouter(barre, "i").style.width = `${valeur}%`;
			ajouter(mode, "span", "qbd-folder-course-pct", `${valeur}%`);
		}
	}
}
