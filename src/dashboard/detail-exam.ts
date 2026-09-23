import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import { createSelect } from "./ui-select";
import { quizModeLabel } from "./quiz-card";
import type { ModeQuiz } from "../quiz-format";
import type { EditorExamOptions } from "../types/editor-ctx";

/* ══════════════════════════════════════════════════════════
   MODE DU QUIZ — bloc réglages de la page « quiz »

   Deux modes, et seulement deux : Learn et Practice (spec
   2026-09-23-learn-practice-design.md §1.1). Le sélecteur proposait encore
   Quiz / Lesson / Exam et un chrono de bloc, que le format a retirés
   (Ahmed, 2026-09-23 : « met à jour ça »).

   Un Learn s'écrit `mode: 'learn'` : en interne c'est encore "lesson",
   que `exportAll` réémet sous le nom du format. Un Practice n'a PAS d'objet
   de mode. Un bloc hérité (`exam`, `examMode`) se lit comme un Practice et
   reste tel quel tant qu'on ne touche pas au sélecteur : il est jouable.

   Visible en mode ÉDITION seulement : en consultation, le mode se lit dans
   l'en-tête de la page.
══════════════════════════════════════════════════════════ */

export interface ExamPanelOptions {
	/** Options du bloc — `null` quand la note n'en porte aucune. */
	get(): EditorExamOptions | null;
	/** Remplace les options (null = plus d'objet de mode dans le bloc). */
	set(value: EditorExamOptions | null): void;
	/** Persiste (débounce côté appelant). */
	onChange(): void;
	/** Re-rend le bloc : l'aide dépend du mode choisi. */
	onStructureChange(): void;
}

export function renderExamPanel(parent: HTMLElement, opts: ExamPanelOptions): void {
	const mode: ModeQuiz = opts.get()?.mode === "lesson" ? "learn" : "practice";

	const box = ajouter(parent, "div", "qbd-qz-exam");
	const head = ajouter(box, "div", "qbd-qz-exam-head");
	currentHost().ui.setIcon(ajouter(head, "span", "qbd-qz-exam-icon"), "graduation-cap");
	ajouter(head, "span", "qbd-qz-exam-title", t("dashboard.quiz.modeTitle"));

	createSelect(box, {
		value: mode,
		options: [
			{ value: "learn", label: quizModeLabel("learn") },
			{ value: "practice", label: quizModeLabel("practice") },
		],
		onChange: (value) => {
			if (value === mode) return;
			const actuel = opts.get();
			if (value === "learn") {
				// Aucun chrono : `enabled` faux, l'export n'écrit que le mode
				// et les clés personnalisées.
				opts.set({ durationMinutes: 10, autoSubmit: true, showTimer: true, ...actuel, mode: "lesson", enabled: false });
			} else {
				/* Practice = pas d'objet de mode. Les clés personnalisées de
				   l'auteur survivent pourtant : les jeter avec l'objet perdait
				   son travail, d'où un objet réduit à elles. */
				opts.set(actuel?._extra ? { ...actuel, mode: undefined, enabled: false } : null);
			}
			opts.onChange();
			opts.onStructureChange();
		},
	});

	ajouter(box, "div", "qbd-qz-exam-help",
		t(mode === "learn" ? "dashboard.quiz.modeLearnHelp" : "dashboard.quiz.modePracticeHelp"));
}
