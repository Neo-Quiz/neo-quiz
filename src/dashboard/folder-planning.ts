import { ajouter } from "../dom";
import { currentLang, t } from "../i18n";
import { currentHost, requireHost } from "../host/current";
import type { DashboardShellCtx, ExamenDossier } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import type { ModuleGroup } from "./quiz-modules";
import { renderProgressRing } from "./quiz-card";
import { computeQuizState } from "./quiz-mastery";
import { renderCollapsibleSection } from "./collapsible";
import { renderNextStep } from "./folder-next";
import { duesDuDossier } from "./folder-progress-details";
import { moyenneDossier } from "./folder-progress";
import type { DetailsProgression } from "./folder-progress";
import { formatExamDate, parseExamDate } from "../review/review-store";
import { openDatePicker } from "./date-picker";
import { cheminsAJoindre, lireContenuDossier } from "./folder-contents";

/* ══════════════════════════════════════════════════════════
   A folder's "Review plan" tab (task 4, 2026-09-26): the upcoming exams
   (several per folder, added, edited and deleted right here), then the
   folder's ring, the next step and the three modes on the right, taken from
   "Progress" and from the drill's old next step. The "Related tasks" section
   was removed on 2026-09-29 (it only repeated the review action).

   "No task without an upcoming exam": the scheduler (host side) only gives a
   folder due questions when it has an exam `>= today`. This view only
   EXPLAINS that rule, it never recomputes it.
══════════════════════════════════════════════════════════ */

/** The LOCAL `YYYY-MM-DD` of today, never UTC: same rule as its twin on the
    app side (`apps/windows/src/host/folder.ts`, `aujourdhuiIso`), duplicated
    here because `src/` cannot import `apps/`. */
function aujourdhuiIsoLocal(now: number): string {
	const d = new Date(now);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The folder's exams dated `>= today` (string comparison of `YYYY-MM-DD`,
    same rule as `examenProchain` on the app side), sorted by date. */
function examensAVenir(ctx: DashboardShellCtx, group: ModuleGroup): ExamenDossier[] {
	const tous = ctx.examens?.(group) ?? [];
	const aujourdhui = aujourdhuiIsoLocal(Date.now());
	return tous.filter(e => e.date >= aujourdhui).sort((a, b) => a.date.localeCompare(b.date));
}

/** Days left before an exam already known to be UPCOMING (`ms >=` today's
    local midnight): never a "past" case, the three existing "My quizzes" keys
    are enough. */
function joursRestants(ms: number): string {
	const aujourdhui = new Date();
	aujourdhui.setHours(0, 0, 0, 0);
	const jours = Math.round((ms - aujourdhui.getTime()) / 86_400_000);
	return jours === 0 ? t("dashboard.quizzes.progressExamToday")
		: jours === 1 ? t("dashboard.quizzes.progressExamTomorrow")
		: t("dashboard.quizzes.progressExamIn", { count: jours });
}

/** A typed coefficient: "" is none (`undefined`), "2,5" and "2.5" are 2.5, and
    anything else (not a number, zero, above 100) is invalid (`null`). */
function lireCoefficient(brut: string): number | undefined | null {
	const texte = brut.trim();
	if (!texte) return undefined;
	if (!/^\d*[.,]?\d*$/.test(texte)) return null;
	const n = Number(texte.replace(",", "."));
	return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

/** An exam's modal, to add (`examen: null`) or edit one. Name (required), Date
    (the app's own picker, no earlier than today) and Coefficient (optional);
    Save stays disabled until the name is not blank, the date is picked and the
    coefficient, if typed, is valid. A new exam's `id` is
    `Date.now().toString(36)` (same pattern as the dashboard's other ids made
    on the fly). */
function ouvrirModalExamen(ctx: DashboardShellCtx, group: ModuleGroup, examen: ExamenDossier | null, rerender: () => void): void {
	let nom = examen?.nom ?? "";
	let date = examen?.date ?? "";
	let coefficient = examen?.coefficient === undefined ? "" : String(examen.coefficient).replace(".", ",");

	requireHost("modals").open({
		className: "qbd-medit-modal",
		title: t(examen ? "dashboard.planning.examEdit" : "dashboard.planning.examAdd"),
		onOpen: (m) => {
			const c = m.contentEl;
			ajouter(c, "p", "qbd-medit-label", t("dashboard.planning.examName"));
			const nomInput = ajouter(c, "input", "qbd-medit-input");
			nomInput.type = "text";
			nomInput.value = nom;

			ajouter(c, "p", "qbd-medit-label", t("dashboard.planning.examDate"));
			const dateBtn = ajouter(c, "button", "qbd-medit-select qbd-planning-date-field");
			dateBtn.type = "button";
			dateBtn.setAttribute("aria-haspopup", "dialog");
			dateBtn.setAttribute("aria-expanded", "false");
			const dateText = ajouter(dateBtn, "span", "qbd-planning-date-text");
			currentHost().ui.setIcon(ajouter(dateBtn, "span", "qbd-planning-date-icon"), "calendar");
			const majDate = (): void => {
				dateText.textContent = date ? formatExamDate(date, currentLang()) : t("dashboard.planning.datePick");
				dateText.classList.toggle("is-empty", !date);
			};
			majDate();

			ajouter(c, "p", "qbd-medit-label", t("dashboard.planning.examCoefficient"));
			const coefInput = ajouter(c, "input", "qbd-medit-input");
			coefInput.type = "text";
			coefInput.inputMode = "decimal";
			coefInput.placeholder = t("dashboard.planning.examCoefficientPlaceholder");
			coefInput.value = coefficient;

			const save = ajouter(c, "button", "qbd-medit-save", t("dashboard.planning.examSave"));
			save.type = "button";
			// An exam is planned in the future: a past date cannot be saved (the
			// picker disables those days, this also covers an old saved value).
			const majEtat = (): void => {
				const coefValide = lireCoefficient(coefficient) !== null;
				coefInput.setAttribute("aria-invalid", String(!coefValide));
				save.disabled = !nom.trim() || !date || date < aujourdhuiIsoLocal(Date.now()) || !coefValide;
			};
			majEtat();
			nomInput.addEventListener("input", () => { nom = nomInput.value; majEtat(); });
			coefInput.addEventListener("input", () => { coefficient = coefInput.value; majEtat(); });
			dateBtn.addEventListener("click", () => {
				openDatePicker(dateBtn, date, { min: aujourdhuiIsoLocal(Date.now()) }, (iso) => {
					date = iso;
					majDate();
					majEtat();
				});
			});
			save.addEventListener("click", () => {
				const coef = lireCoefficient(coefficient);
				if (save.disabled || coef === null) return;
				ctx.enregistrerExamen?.(group, {
					id: examen?.id ?? Date.now().toString(36),
					nom: nom.trim(),
					date,
					...(coef === undefined ? {} : { coefficient: coef }),
				});
				m.close();
				rerender();
			});
		},
	});
}

export function renderFolderPlanning(
	parent: HTMLElement,
	inModule: QuizIndexEntry[],
	ordre: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>,
	details: DetailsProgression & {
		/** Le CHEMIN du dossier ouvert (même valeur que « Ajouter du contenu » —
		    `quizzes-render.ts`), pour le composer que la tâche 5 rend ici même. */
		folder: string;
	}
): HTMLElement {
	const { ctx, group, rerender } = details;
	const vue = ajouter(parent, "div", "qbd-planning");
	const gauche = ajouter(vue, "div", "qbd-planning-col qbd-planning-col--left");
	const droite = ajouter(vue, "div", "qbd-planning-col qbd-planning-col--right");

	// Repli persisté : mêmes réglages que « Mes quiz »/l'accueil, deux clés
	// distinctes pour ne jamais confondre le repli d'une section avec celui
	// d'un dossier ou d'une autre page (ruling task 4).
	const collapse = {
		isExpanded: (key: string) => new Set(ctx.settings.quizzesExpandedFolders || []).has(key),
		toggleExpanded: (key: string) => {
			const set = new Set(ctx.settings.quizzesExpandedFolders || []);
			if (set.has(key)) set.delete(key); else set.add(key);
			ctx.settings.quizzesExpandedFolders = [...set];
			ctx.saveSettings().catch(() => {});
		},
	};

	const aVenir = examensAVenir(ctx, group);

	// ── "Upcoming exams" ──
	const examensCorps = renderCollapsibleSection(collapse, gauche, "planning:exams", t("dashboard.planning.exams"), aVenir.length, {
		// « + » à droite de l'en-tête, jamais dans le bouton d'en-tête lui-même
		// (un bouton dans un bouton est invalide — même geste que « See all »
		// de l'accueil).
		rowClass: "qbd-planning-exams-head-row",
		headRow: (row) => {
			const plus = ajouter(row, "button", "qbd-planning-exam-add");
			plus.type = "button";
			plus.setAttribute("aria-label", t("dashboard.planning.examAdd"));
			currentHost().ui.setIcon(plus, "plus");
			plus.addEventListener("click", (e) => {
				e.stopPropagation();
				ouvrirModalExamen(ctx, group, null, rerender);
			});
		},
	});
	if (aVenir.length === 0) {
		const vide = ajouter(examensCorps, "div", "qbd-planning-exams-empty");
		currentHost().ui.setIcon(ajouter(vide, "div", "qbd-planning-exams-empty-icon"), "calendar-days");
		ajouter(vide, "p", "qbd-planning-exams-empty-title", t("dashboard.planning.examsEmptyTitle"));
		ajouter(vide, "p", "qbd-planning-exams-empty-hint", t("dashboard.planning.examsEmptyHint"));
		const ajouterBtn = ajouter(vide, "button", "qbd-folder-section-action");
		ajouterBtn.type = "button";
		currentHost().ui.setIcon(ajouter(ajouterBtn, "span", "qbd-folder-section-action-icon"), "plus");
		ajouter(ajouterBtn, "span", undefined, t("dashboard.planning.examAdd"));
		ajouterBtn.addEventListener("click", () => ouvrirModalExamen(ctx, group, null, rerender));
	} else {
		const liste = ajouter(examensCorps, "div", "qbd-planning-exam-list");
		for (const examen of aVenir) {
			const ligne = ajouter(liste, "div", "qbd-planning-exam-row");
			const texte = ajouter(ligne, "div", "qbd-planning-exam-text");
			ajouter(texte, "span", "qbd-planning-exam-name", examen.nom);
			const ms = parseExamDate(examen.date);
			const infos = ajouter(texte, "div", "qbd-planning-exam-infos");
			ajouter(infos, "span", "qbd-planning-exam-date", formatExamDate(examen.date, currentLang()));
			if (examen.coefficient !== undefined) {
				ajouter(infos, "span", "qbd-planning-exam-coef",
					t("dashboard.planning.examCoef", { n: new Intl.NumberFormat(currentLang()).format(examen.coefficient) }));
			}
			if (ms !== null) ajouter(infos, "span", "qbd-planning-exam-days", joursRestants(ms));
			// Edit and Delete are shown directly as two ghost icon buttons
			// (no "..." menu: two actions do not need one).
			const actions = ajouter(ligne, "div", "qbd-planning-exam-actions");
			const action = (icone: string, cle: "dashboard.planning.examEdit" | "dashboard.planning.examDelete", extra: string, onClick: () => void): void => {
				const bouton = ajouter(actions, "button", `qbd-planning-exam-action${extra}`);
				bouton.type = "button";
				bouton.setAttribute("aria-label", t(cle));
				bouton.title = t(cle);
				currentHost().ui.setIcon(bouton, icone);
				bouton.addEventListener("click", onClick);
			};
			action("pencil", "dashboard.planning.examEdit", "", () => ouvrirModalExamen(ctx, group, examen, rerender));
			action("trash-2", "dashboard.planning.examDelete", " qbd-planning-exam-action--danger",
				() => { ctx.retirerExamen?.(group, examen.id); rerender(); });
		}
	}

	// ── Composer : demander un quiz sur ce dossier (tâche 5) ──
	if (ctx.canOpen("ai")) {
		const emplacement = ajouter(gauche, "div", "qbd-planning-composer");
		renderComposerDossier(emplacement, ctx, details.folder);
	}

	// ── Colonne droite : anneau, étape suivante, modes ──
	const dues = duesDuDossier(ctx, inModule);
	const moyenne = moyenneDossier(inModule, stats);
	const masteredN = inModule.filter(q => computeQuizState(q, stats[q.path]).state === "mastered").length;
	const anneauTuile = ajouter(droite, "div", "qbd-planning-ring-tile");
	renderProgressRing(anneauTuile, moyenne, masteredN === inModule.length && inModule.length > 0 ? "done" : moyenne > 0 ? "progress" : "fresh", 88, 7);
	ajouter(anneauTuile, "div", "qbd-folder-progress-sub", t("dashboard.quizzes.progressMasteredOf", { mastered: masteredN, total: inModule.length }));

	renderNextStep(droite, ctx, ordre, stats);

	const modes = ajouter(droite, "div", "qbd-planning-modes");
	const modeAFaire = (mode: "learn" | "practice"): QuizIndexEntry | undefined =>
		ordre.find(q => q.mode === mode && computeQuizState(q, stats[q.path]).state !== "mastered");
	const modeLigne = (icone: string, titre: string, aide: string, cible: QuizIndexEntry | undefined): void => {
		const ligne = ajouter(modes, "button", "qbd-planning-mode-row");
		ligne.type = "button";
		currentHost().ui.setIcon(ajouter(ligne, "span", "qbd-planning-mode-icon"), icone);
		const corps = ajouter(ligne, "div", "qbd-planning-mode-text");
		ajouter(corps, "span", "qbd-planning-mode-title", titre);
		ajouter(corps, "span", "qbd-planning-mode-help", aide);
		if (!cible) {
			ligne.disabled = true;
			ligne.setAttribute("aria-disabled", "true");
		} else {
			ligne.addEventListener("click", () => ctx.openQuiz(cible));
		}
	};
	modeLigne("book-open", t("dashboard.planning.modeLearn"), t("dashboard.quiz.modeLearnHelp"), modeAFaire("learn"));
	modeLigne("dumbbell", t("dashboard.planning.modePractice"), t("dashboard.quiz.modePracticeHelp"), modeAFaire("practice"));
	modeLigne("rotate-ccw", t("dashboard.quizzes.progressDueAction"), t("dashboard.quizzes.nextStepReviewHelp"), dues.lignes[0]?.quiz);

	return vue;
}

/** Le composer du Planning (tâche 5) : demande tapée dans le dossier ouvert →
    page « Générer » avec ce dossier en destination, ses documents déjà
    joints (même geste que « Ajouter du contenu » → « Créer avec l'IA »,
    `folder-add.ts:45-46`) et la génération lancée dès les pièces jointes. */
function renderComposerDossier(parent: HTMLElement, ctx: DashboardShellCtx, folder: string): void {
	const boite = ajouter(parent, "div", "qbd-ai-composer qbd-ai-composer--dossier");
	const champ = ajouter(boite, "textarea", "qbd-ai-composer-input") as HTMLTextAreaElement;
	champ.placeholder = t("dashboard.planning.composerPlaceholder");
	champ.setAttribute("aria-label", t("dashboard.planning.composerPlaceholder"));
	champ.rows = 1;

	const pied = ajouter(boite, "div", "qbd-ai-composer-bottom");
	const envoyer = ajouter(pied, "button", "qbd-ai-composer-send") as HTMLButtonElement;
	envoyer.type = "button";
	envoyer.setAttribute("aria-label", t("dashboard.planning.composerSend"));
	currentHost().ui.setIcon(ajouter(envoyer, "span", "qbd-ai-composer-send-icon"), "arrow-up");
	envoyer.disabled = true;

	// Grandit avec le texte jusqu'à 5 lignes (même geste que le composer de
	// « Générer », `ai.ts` — hauteur ligne 1,55 × 5, cf. CSS `--dossier`).
	const autoGrandir = (): void => {
		champ.style.height = "auto";
		champ.style.height = Math.min(champ.scrollHeight, Math.round(1.55 * 5 * 13.5)) + "px";
	};
	const majEtat = (): void => {
		envoyer.disabled = !champ.value.trim();
		autoGrandir();
	};
	champ.addEventListener("input", majEtat);
	champ.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			envoyerDemande();
		}
	});

	// Fix round 1 (2026-09-26) : `envoyer.disabled` seul ne protège pas contre
	// deux Entrée pressées avant que la lecture asynchrone du dossier ne
	// reparte ailleurs (la page « Générer ») — un drapeau local, posé AVANT
	// cette lecture, vérifié en premier.
	let envoiEnCours = false;
	const envoyerDemande = (): void => {
		if (envoiEnCours) return;
		const texte = champ.value.trim();
		if (!texte) return;
		envoiEnCours = true;
		envoyer.disabled = true;
		void lireContenuDossier(folder, (path) => !!ctx.scanner.getQuiz(path)).then(contenu => {
			// Pendant la lecture, on a pu quitter le dossier : ne pas arracher
			// l'utilisateur à la vue où il est allé entre-temps.
			if (!champ.isConnected) return;
			ctx.navigate("ai", { aiPreset: { destination: folder, attach: cheminsAJoindre(contenu), prompt: texte, lancer: true } });
		});
	};
	envoyer.addEventListener("click", envoyerDemande);
}
