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
import { openActionMenu } from "./ui-select";
import { parseExamDate } from "../review/review-store";
import { cheminsAJoindre, lireContenuDossier } from "./folder-contents";

/* ══════════════════════════════════════════════════════════
   ONGLET « PLANNING DE RÉVISIONS » d'un dossier (tâche 4, 2026-09-26) :
   les tâches du jour (ce que l'ordonnanceur doit à CE dossier), les examens
   à venir (plusieurs par dossier, ajoutés/modifiés/supprimés ici même), puis
   l'anneau du dossier, l'étape suivante et les trois modes — colonne droite,
   reprise de « Progression » et de l'ancienne étape suivante du drill.

   « Aucune tâche sans examen à venir » : l'ordonnanceur (côté hôte) ne rend
   des questions dues pour ce dossier que s'il a un examen `>= aujourd'hui` —
   cette vue ne fait qu'EXPLIQUER cette règle, jamais la recalculer.
══════════════════════════════════════════════════════════ */

/** `AAAA-MM-JJ` LOCAL du jour — jamais UTC, même règle que son homonyme côté
    application (`apps/windows/src/host/folder.ts`, `aujourdhuiIso`), dupliquée
    ici : `src/` ne peut pas importer `apps/`. */
function aujourdhuiIsoLocal(now: number): string {
	const d = new Date(now);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Les examens du dossier dont la date est `>= aujourd'hui` (comparaison de
    chaînes `AAAA-MM-JJ`, même règle que `examenProchain` côté application),
    triés par date. */
function examensAVenir(ctx: DashboardShellCtx, group: ModuleGroup): ExamenDossier[] {
	const tous = ctx.examens?.(group) ?? [];
	const aujourdhui = aujourdhuiIsoLocal(Date.now());
	return tous.filter(e => e.date >= aujourdhui).sort((a, b) => a.date.localeCompare(b.date));
}

/** Jours restants avant un examen déjà connu comme À VENIR (`ms >=` minuit
    local d'aujourd'hui) : jamais de cas « passé », les trois clés existantes
    de « Mes quiz » suffisent. */
function joursRestants(ms: number): string {
	const aujourdhui = new Date();
	aujourdhui.setHours(0, 0, 0, 0);
	const jours = Math.round((ms - aujourdhui.getTime()) / 86_400_000);
	return jours === 0 ? t("dashboard.quizzes.progressExamToday")
		: jours === 1 ? t("dashboard.quizzes.progressExamTomorrow")
		: t("dashboard.quizzes.progressExamIn", { count: jours });
}

/** Le modal d'un examen — ajout (`examen: null`) ou modification. Champs Nom
    (facultatif) et Date (natif) ; Enregistrer désactivé tant que la date est
    vide ; `id` d'un nouvel examen = `Date.now().toString(36)` (même patron
    que les autres identifiants générés à la volée du dashboard). */
function ouvrirModalExamen(ctx: DashboardShellCtx, group: ModuleGroup, examen: ExamenDossier | null, rerender: () => void): void {
	let nom = examen?.nom ?? "";
	let date = examen?.date ?? "";

	requireHost("modals").open({
		className: "qbd-medit-modal",
		title: t(examen ? "dashboard.planning.examEdit" : "dashboard.planning.examAdd"),
		onOpen: (m) => {
			const c = m.contentEl;
			ajouter(c, "p", "qbd-medit-label", t("dashboard.planning.examName"));
			const nomInput = ajouter(c, "input", "qbd-medit-input");
			nomInput.type = "text";
			nomInput.value = nom;
			nomInput.addEventListener("input", () => { nom = nomInput.value; });

			ajouter(c, "p", "qbd-medit-label", t("dashboard.planning.examDate"));
			const dateInput = ajouter(c, "input", "qbd-medit-input");
			dateInput.type = "date";
			// Un examen se planifie dans l'avenir : le calendrier natif grise
			// les jours passés, et une date passée tapée au clavier (que `min`
			// n'empêche pas de saisir) laisse Enregistrer désactivé.
			dateInput.min = aujourdhuiIsoLocal(Date.now());
			dateInput.value = date;

			const save = ajouter(c, "button", "qbd-medit-save", t("dashboard.planning.examSave"));
			save.type = "button";
			const majEtat = (): void => { save.disabled = !dateInput.value || dateInput.validity.rangeUnderflow; };
			majEtat();
			dateInput.addEventListener("input", () => { date = dateInput.value; majEtat(); });
			save.addEventListener("click", () => {
				if (!dateInput.value || dateInput.validity.rangeUnderflow) return;
				// Un nom fait uniquement d'espaces vaut une absence — jamais
				// persisté tel quel (fix round 1, 2026-09-26).
				ctx.enregistrerExamen?.(group, { id: examen?.id ?? Date.now().toString(36), nom: nom.trim(), date: dateInput.value });
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

	// ── « Tâches associées » ──
	const aVenir = examensAVenir(ctx, group);
	const dues = duesDuDossier(ctx, inModule);
	// Le compteur de l'en-tête est le nombre de LIGNES de tâche affichées (une
	// seule ligne existe pour l'instant), jamais le nombre de questions
	// qu'elle porte — fix round 1 (2026-09-26) : « 2 » quand une seule ligne
	// disait « Réviser 2 questions » n'avait pas de sens pour un compteur de
	// tâches.
	const tacheLignes = aVenir.length > 0 && dues.total > 0 && dues.lignes.length > 0 ? 1 : 0;
	const tacheCorps = renderCollapsibleSection(collapse, gauche, "planning:tasks", t("dashboard.planning.tasks"), tacheLignes);
	if (aVenir.length === 0) {
		ajouter(tacheCorps, "p", "qbd-planning-empty-line", t("dashboard.planning.tasksNeedExam"));
	} else if (dues.total > 0 && dues.lignes.length > 0) {
		const ligne = ajouter(tacheCorps, "button", "qbd-planning-task-row");
		ligne.type = "button";
		currentHost().ui.setIcon(ajouter(ligne, "span", "qbd-planning-task-icon"), "rotate-ccw");
		ajouter(ligne, "span", "qbd-planning-task-label",
			t(dues.total === 1 ? "dashboard.planning.taskReviewOne" : "dashboard.planning.taskReview",
				{ count: dues.total, folder: group.name || group.folder }));
		ligne.addEventListener("click", () => ctx.openQuiz(dues.lignes[0].quiz));
	} else {
		ajouter(tacheCorps, "p", "qbd-planning-empty-line", t("dashboard.planning.tasksNone"));
	}

	// ── « Examens à venir » ──
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
			ajouter(texte, "span", "qbd-planning-exam-name", examen.nom.trim() || t("dashboard.planning.examUnnamed"));
			const ms = parseExamDate(examen.date);
			const infos = ajouter(texte, "div", "qbd-planning-exam-infos");
			ajouter(infos, "span", "qbd-planning-exam-date",
				ms === null ? examen.date : new Intl.DateTimeFormat(currentLang(), { dateStyle: "long" }).format(new Date(ms)));
			if (ms !== null) ajouter(infos, "span", "qbd-planning-exam-days", joursRestants(ms));
			const plus = ajouter(ligne, "button", "qbd-folder-more-btn");
			plus.type = "button";
			plus.setAttribute("aria-label", t("dashboard.card.more"));
			currentHost().ui.setIcon(plus, "ellipsis-vertical");
			plus.addEventListener("click", () => openActionMenu(plus, [
				{ icon: "pencil", label: t("dashboard.planning.examEdit"), onClick: () => ouvrirModalExamen(ctx, group, examen, rerender) },
				{
					icon: "trash-2", label: t("dashboard.planning.examDelete"), danger: true,
					onClick: () => { ctx.retirerExamen?.(group, examen.id); rerender(); },
				},
			]));
		}
	}

	// ── Composer : demander un quiz sur ce dossier (tâche 5) ──
	if (ctx.canOpen("ai")) {
		const emplacement = ajouter(gauche, "div", "qbd-planning-composer");
		renderComposerDossier(emplacement, ctx, details.folder);
	}

	// ── Colonne droite : anneau, étape suivante, modes ──
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
