import { ajouter } from "../dom";
import { t } from "../i18n";
import { currentHost } from "../host/current";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import { tentativesDe, type QuizStatRecord, type Tentative } from "./stats-store";
import { quizDeLaCarte, type CarteCours } from "./course-pairs";
import { computeQuizState } from "./quiz-mastery";
import { quizModeLabel } from "./quiz-card";
import { formatDateHeure } from "./format-date";
import { isDeletableResultsPath, trashResultsFile } from "../results-files";
import { LOG_PREFIX } from "../branding";

/* ══════════════════════════════════════════════════════════
   LES TUILES DU BAS de l'onglet « Progression » (2026-09-25) :

   - `duesDuDossier` : ce que l'ordonnanceur a mis au programme du jour POUR
     CE DOSSIER, par note. Sa tuile « À réviser aujourd'hui » est partie
     (plus aucun appelant) : l'étape suivante (`folder-next.ts`) et l'onglet
     « Planning » (`folder-planning.ts`) lisent ce décompte eux-mêmes.
   - « Cours » : l'avancement de chaque cours, mode par mode — le détail que
     les pastilles des cartes ne portent plus.

   L'EXAMEN (plusieurs par dossier, ajout/modif/suppression) a quitté cet
   onglet à la tâche 4 (2026-09-26) : il vit désormais dans l'onglet
   « Planning » (`folder-planning.ts`), qui l'affiche ET l'édite —
   `renderExamen`, ici, est parti avec lui (plus aucun appelant).
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

/** Une tentative supprimée mais pas encore confirmée : montrée en place
    (« Tentative supprimée » + Annuler) jusqu'au prochain rendu de la page —
    survit donc au redessin de la LIGNE (chevron compris), pas à celui de la
    page entière. Clé : `chemin::date`. */
type EnAttenteAnnulation = Map<string, Tentative>;

export function renderListeCours(parent: HTMLElement, ctx: DashboardShellCtx, cartes: CarteCours[], stats: Record<string, QuizStatRecord>): void {
	if (cartes.length === 0) return;
	const tuile = ajouter(parent, "div", "qbd-folder-progress-tile qbd-folder-progress-tile--courses");
	ajouter(tuile, "div", "qbd-folder-progress-label", t("dashboard.quizzes.progressCourses"));
	const liste = ajouter(tuile, "div", "qbd-folder-courses");
	// État qui vit HORS du DOM recréé : les modes dépliés et les suppressions
	// en attente d'annulation survivent au redessin d'une ligne de cours.
	const ouvertes = new Set<string>();
	const enAttente: EnAttenteAnnulation = new Map();
	for (const carte of cartes) renderLigneCours(liste, ctx, carte, stats, ouvertes, enAttente);
}

/** Une ligne « cours » (titre + un ou deux modes) — redessinable seule après
    la suppression ou l'annulation d'une tentative, sans reconstruire toute
    la page (le chevron déplié et les suppressions en attente survivent,
    portés par `ouvertes`/`enAttente`, pas par ce DOM). */
function renderLigneCours(parent: HTMLElement, ctx: DashboardShellCtx, carte: CarteCours, stats: Record<string, QuizStatRecord>, ouvertes: Set<string>, enAttente: EnAttenteAnnulation): HTMLElement {
	const { quiz } = carte;
	const ligne = ajouter(parent, "div", "qbd-folder-course");
	const titre = ajouter(ligne, "button", "qbd-folder-course-title", quiz.title);
	titre.type = "button";
	titre.addEventListener("click", () => ctx.navigate("detail", { quiz }));
	const modes = ajouter(ligne, "div", "qbd-folder-course-modes");
	const redessiner = (): void => {
		const fraiche = renderLigneCours(parent, ctx, carte, ctx.statsStore.getAll(), ouvertes, enAttente);
		ligne.replaceWith(fraiche);
	};
	for (const q of quizDeLaCarte(carte)) {
		renderModeCours(modes, ctx, q, stats[q.path], ouvertes, enAttente, redessiner);
	}
	return ligne;
}

/** Un mode d'un cours : barre + pourcentage, et si des tentatives existent
    (réelles ou en attente d'annulation), la pastille « Meilleur » et le
    chevron qui déplie leur liste. */
function renderModeCours(parent: HTMLElement, ctx: DashboardShellCtx, q: QuizIndexEntry, rec: QuizStatRecord | undefined, ouvertes: Set<string>, enAttente: EnAttenteAnnulation, redessiner: () => void): void {
	const { state, pct } = computeQuizState(q, rec);
	const valeur = state === "mastered" ? 100 : pct;
	const bloc = ajouter(parent, "div", "qbd-folder-course-mode-bloc");
	const ligne = ajouter(bloc, "div", "qbd-folder-course-mode");
	ajouter(ligne, "span", "qbd-folder-course-mode-label", quizModeLabel(q.mode));
	const barre = ajouter(ligne, "span", `qbd-folder-course-bar qbd-folder-course-bar--${state === "mastered" ? "done" : valeur > 0 ? "progress" : "fresh"}`);
	ajouter(barre, "i").style.width = `${valeur}%`;
	ajouter(ligne, "span", "qbd-folder-course-pct", `${valeur}%`);

	const reelles = tentativesDe(rec);
	const attentes = [...enAttente.entries()].filter(([cle]) => cle.startsWith(q.path + "::")).map(([, tt]) => tt);
	if (reelles.length === 0 && attentes.length === 0) return;

	const toutesLibres = reelles.length > 0 && reelles.every(tt => tt.pct === null);
	const meilleure = reelles.length === 0 || toutesLibres ? null : Math.max(...reelles.map(tt => tt.pct ?? 0));
	const extra = ajouter(ligne, "span", "qbd-folder-course-mode-extra");
	if (reelles.length > 0) {
		ajouter(extra, "span", "qbd-folder-course-mode-best",
			meilleure === null ? t("dashboard.quizzes.attemptFree") : t("dashboard.quizzes.bestScore", { score: meilleure }));
	}
	const bouton = ajouter(extra, "button", "qbd-folder-course-mode-toggle");
	bouton.type = "button";
	bouton.setAttribute("aria-label", t("dashboard.quizzes.attemptsToggle"));
	currentHost().ui.setIcon(ajouter(bouton, "span", "qbd-folder-course-mode-chevron"), "chevron-right");

	const cle = q.path;
	const ouverte = ouvertes.has(cle);
	bouton.setAttribute("aria-expanded", String(ouverte));
	bloc.classList.toggle("is-open", ouverte);

	const corps = ajouter(bloc, "div", "qbd-folder-attempts");
	corps.hidden = !ouverte;
	const tentatives = [...reelles.map(tt => ({ tentative: tt, enAttente: false })), ...attentes.map(tt => ({ tentative: tt, enAttente: true }))]
		.sort((a, b) => b.tentative.date - a.tentative.date);
	for (const { tentative, enAttente: attente } of tentatives) {
		renderLigneTentative(corps, ctx, q, tentative, attente, enAttente, redessiner);
	}

	bouton.addEventListener("click", () => {
		const maintenant = !ouvertes.has(cle);
		if (maintenant) ouvertes.add(cle);
		else ouvertes.delete(cle);
		bouton.setAttribute("aria-expanded", String(maintenant));
		bloc.classList.toggle("is-open", maintenant);
		corps.hidden = !maintenant;
	});
}

/** One attempt: date and time, percentage, "Exam" when it was played in Exam
    mode, "before history" for an old score, and the delete button — or, while
    a deletion waits to be confirmed, "Attempt deleted" + Undo. */
function renderLigneTentative(parent: HTMLElement, ctx: DashboardShellCtx, q: QuizIndexEntry, tentative: Tentative, enAttente: boolean, registre: EnAttenteAnnulation, redessiner: () => void): void {
	const cle = `${q.path}::${tentative.date}`;
	const row = ajouter(parent, "div", "qbd-folder-attempt-row");
	if (enAttente) {
		row.classList.add("qbd-folder-attempt-row--deleted");
		ajouter(row, "span", "qbd-folder-attempt-deleted-label", t("dashboard.quizzes.attemptDeleted"));
		const annuler = ajouter(row, "button", "qbd-folder-attempt-undo", t("dashboard.quizzes.attemptUndo"));
		annuler.type = "button";
		annuler.addEventListener("click", () => {
			registre.delete(cle);
			// Its results file already went to the trash: the attempt comes
			// back without the link (the file is recovered from the trash).
			const { results: _gone, ...sansFichier } = tentative;
			ctx.statsStore.restaurerTentative(q.path, sansFichier);
			redessiner();
		});
		return;
	}
	ajouter(row, "span", "qbd-folder-attempt-date", formatDateHeure(new Date(tentative.date)));
	const infos = ajouter(row, "span", "qbd-folder-attempt-info");
	ajouter(infos, "span", "qbd-folder-attempt-pct", tentative.pct === null ? t("dashboard.quizzes.attemptFree") : t("dashboard.quizzes.attemptPct", { pct: tentative.pct }));
	if (tentative.exam) ajouter(infos, "span", "qbd-folder-attempt-exam", t("dashboard.quizzes.attemptExam"));
	if (tentative.withHint) ajouter(infos, "span", "qbd-folder-attempt-hint", t("dashboard.quizzes.attemptWithHint", { count: tentative.withHint }));
	if (tentative.ancienne) ajouter(infos, "span", "qbd-folder-attempt-old", t("dashboard.quizzes.attemptOld"));
	const supprimer = ajouter(row, "button", "qbd-folder-attempt-delete");
	supprimer.type = "button";
	supprimer.setAttribute("aria-label", t("dashboard.quizzes.attemptDelete"));
	currentHost().ui.setIcon(ajouter(supprimer, "span"), "trash-2");
	supprimer.addEventListener("click", () => {
		const retiree = ctx.statsStore.supprimerTentative(q.path, tentative.date);
		if (!retiree) return;
		registre.set(cle, retiree);
		redessiner();
		trashAttemptResults(q.path, retiree);
	});
}

/** Deleting an attempt also moves its saved results file (2026-10-09) to the
    host's trash. `results` comes from a synced file: only a `.json` directly
    in THIS quiz's results folder is touched (`isDeletableResultsPath`). */
function trashAttemptResults(quizPath: string, tentative: Tentative): void {
	const host = currentHost();
	const dir = host.paths.resultsDirFor(quizPath);
	if (!isDeletableResultsPath(tentative.results, dir)) return;
	trashResultsFile(host.fs, dir, tentative.results).catch((e: unknown) => {
		console.warn(LOG_PREFIX, "results file of a deleted attempt not trashed", tentative.results, e);
		host.ui.notice(t("engine.result.deleteError", { message: (e as { message?: string })?.message || t("engine.result.unknownError") }));
	});
}
