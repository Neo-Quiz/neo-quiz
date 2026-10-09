import type { EngineCtx, QuizMode } from "../types/engine-ctx";
import type {
	QuizQuestion,
	QcmQuestion,
	MultiSelectQuestion,
	TextQuestion,
	ClozeQuestion,
	OrderingQuestion,
	MatchingQuestion,
} from "../types/quiz";
import { t } from "../i18n";
import { LOG_PREFIX } from "../branding";
import { reservePath } from "../unique-path";
import { RESULTS_MIRROR, canStartResultsSave, handedInResults, resetResultsSave, trashResultsFile } from "../results-files";

export interface OptionEntry {
	index: number;
	text: string;
}

export interface QuestionResult {
	index: number;
	id: string | null;
	title: string;
	kind: string;
	promptText: string;
	answer: unknown;
	/** Nommé `learnText` jusqu'au schéma 1 (renommé "lesson", task 0 du lot
	    mode leçon, 2026-08-31 round 1 de revue) — cf. `schemaVersion` sur
	    `ResultsPayload`, dont le commentaire liste les changements par version. */
	lessonText: string;
	explanationText: string;
}

export interface ResultsPayload {
	schemaVersion: number;
	plugin: string;
	savedAt: string;
	sourcePath: string | null;
	quizMode: QuizMode;
	practiceMode: string;
	quizTitle: string;
	/** The date of the history attempt recorded at the same hand-in (schema 3). */
	attemptDate: number | null;
	exam: {
		enabled: boolean;
		started: boolean;
		ended: boolean;
		durationMinutes: number | null;
		elapsedSeconds: number | null;
		remainingSeconds: number | null;
	};
	summary: Record<string, unknown>;
	questions: QuestionResult[];
}

export interface ResultsSaverHandlers {
	RESULTS_DIR: string;
	buildPayload(): ResultsPayload;
	/** The file of the attempt being handed in; `null` without a note. */
	planPath(): string | null;
	handIn(path: string | null, attemptDate: number | null): void;
	reset(): void;
	autoSave(opts?: { retry?: boolean }): Promise<void>;
	refreshSaved(): void;
	deleteSaved(): Promise<void>;
}

export function createResultsSaver(ctx: EngineCtx): ResultsSaverHandlers {
	/* Le dossier vient de l'HÔTE, et il dépend de la NOTE : l'application peut
	   avoir plusieurs dossiers ouverts, et les résultats d'un quiz doivent
	   rester dans le sien. Sous Obsidian la valeur est constante. */
	const RESULTS_DIR = ctx.host.paths.resultsDirFor(ctx.sourcePath);

	function normalizeSpace(value: unknown): string {
		return String(value ?? "").replace(/\s+/g, " ").trim();
	}

	/* Le HTML d'un quiz n'est pas forcément le nôtre : un quiz PARTAGÉ arrive
	   avec les `explainHtml` de son auteur. `div.innerHTML = …` construisait un
	   arbre VIVANT dans le document courant — un `<img src=x onerror=…>` s'y
	   charge et déclenche son gestionnaire, même hors de l'arbre affiché
	   (standard HTML). `<template>` a un « document propriétaire inerte » :
	   les ressources n'y sont pas chargées, les scripts pas exécutés. On n'y
	   lit que du texte, ce qui est tout ce qu'on voulait. */
	function htmlToText(html: unknown): string {
		if (!html) return "";
		if (typeof document !== "undefined" && document.createElement) {
			const tpl = document.createElement("template");
			tpl.innerHTML = String(html);
			return normalizeSpace(tpl.content.textContent || "");
		}
		return normalizeSpace(String(html).replace(/<[^>]*>/g, " "));
	}

	function markdownLikeToText(value: unknown): string {
		return normalizeSpace(String(value ?? "")
			.replace(/!\[\[([^\]]+)\]\]/g, "$1")
			.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m: string, page: string, label: string) => label || page)
			.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
			.replace(/[`*_>#-]+/g, " "));
	}

	function firstText(...values: unknown[]): string {
		for (const value of values) {
			if (value === null || value === undefined) continue;
			const text = typeof value === "string" && /<[^>]+>/.test(value)
				? htmlToText(value)
				: markdownLikeToText(value);
			if (text) return text;
		}
		return "";
	}

	function slugify(value: unknown): string {
		const slug = String(value ?? "quiz")
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80);
		return slug || "quiz";
	}

	function pad(n: number): string {
		return String(n).padStart(2, "0");
	}

	function formatLocalTimestamp(date: Date = new Date()): string {
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
	}

	function sourceBaseName(): string {
		const sourcePath = String(ctx.sourcePath || "quiz");
		const fileName = sourcePath.split(/[\\/]/).pop() || sourcePath;
		return fileName.replace(/\.[^.]+$/, "") || "quiz";
	}

	function getQuestionKind(q: QuizQuestion): string {
		if (ctx.isFlashcardQuestion(q)) return "flashcard";
		if (ctx.isClozeQuestion(q)) return "cloze";
		if (ctx.isTextQuestion(q)) return "text";
		if (ctx.isOrderingQuestion(q)) return "ordering";
		if (ctx.isMatchingQuestion(q)) return "matching";
		if ((q as { multiSelect?: boolean }).multiSelect) return "multiple-choice";
		return "single-choice";
	}

	function getQuestionPromptText(q: QuizQuestion): string {
		return firstText(q?.prompt, q?.promptHtml, q?._promptHtml);
	}

	/* Nom canonique prioritaire, alias hérité `learn*` en repli (mode "learn"
	   renommé "lesson", task 0 du lot mode leçon, 2026-08-31) : sans le repli,
	   un quiz partagé écrit avant le renommage sauvegardait une leçon vide. */
	function getLessonText(q: QuizQuestion): string {
		return firstText(q?.lesson, q?.lessonHtml, q?._lessonHtml, q?.learn, q?.learnHtml, q?._learnHtml);
	}

	function getExplanationText(q: QuizQuestion): string {
		return firstText(q?.explain, q?.explainHtml, q?._explainHtml);
	}

	function optionEntry(q: QcmQuestion | MultiSelectQuestion, index: number): OptionEntry {
		const options = Array.isArray(q?.options) ? q.options : [];
		const optionHtml = Array.isArray(q?.optionHtml) ? q.optionHtml[index] : null;
		const text = firstText(options[index], optionHtml);
		return {
			index,
			text: text || `Option ${index + 1}`
		};
	}

	function optionEntries(q: QcmQuestion | MultiSelectQuestion, indices: number[]): OptionEntry[] {
		return indices
			.filter(index => Number.isInteger(index) && index >= 0)
			.map(index => optionEntry(q, index));
	}

	function getCorrectOptionIndices(q: QcmQuestion | MultiSelectQuestion): number[] {
		if (ctx.textOnly?.getCorrectOptionIndices) return ctx.textOnly.getCorrectOptionIndices(q);
		if (q?.multiSelect && Array.isArray(q.correctIndices)) return q.correctIndices.map(Number).filter(Number.isInteger);
		const index = Number((q as QcmQuestion).correctIndex);
		return Number.isInteger(index) ? [index] : [];
	}

	function buildTextQuestionResult(q: TextQuestion, qi: number) {
		const sel = ctx.quizState.selections?.[qi];
		const userAnswer = typeof sel === "string" ? sel : "";
		const acceptedAnswers = ctx.terminal?.getTextAcceptedAnswers?.(q) || [];
		return {
			userAnswer,
			acceptedAnswers,
			isCorrect: !!ctx.isCorrect?.(qi)
		};
	}

	/* Texte à trous : la correction est trou par trou — un « faux » global ne
	   dit pas lequel a manqué, ce que l'élève relit d'abord. */
	function buildClozeResult(q: ClozeQuestion, qi: number) {
		const selRaw = ctx.quizState.selections?.[qi];
		const selected = Array.isArray(selRaw) ? selRaw : [];
		const blanks = ctx.cloze.getBlanks(q);
		return {
			blanks: blanks.map((blank, index) => ({
				index,
				userAnswer: String(selected[index] ?? ""),
				acceptedAnswers: blank.answers,
				isCorrect: ctx.cloze.isBlankCorrect(q, index, selected[index])
			})),
			isCorrect: !!ctx.isCorrect?.(qi)
		};
	}

	function buildOrderingResult(q: OrderingQuestion, qi: number) {
		const items = ctx.getOrderingItems(q);
		// Variante garantie par l'appelant (buildQcmAnswer) ⇒ sélection à
		// emplacements : des indices, jamais les chaînes du texte à trous.
		const selRaw = ctx.quizState.selections?.[qi];
		const selected: Array<number | null> = Array.isArray(selRaw) ? (selRaw as Array<number | null>) : [];
		const correctOrder = ctx.getOrderingCorrectOrder(q);
		return {
			userOrder: selected.map(index => ({
				index,
				// index est un entier valide dans cette branche (garde Number.isInteger).
				text: index !== null && Number.isInteger(index) && index >= 0 ? String(items[index] ?? "") : null
			})),
			correctOrder: correctOrder.map(index => ({
				index,
				text: Number.isInteger(index) && index >= 0 ? String(items[index] ?? "") : null
			})),
			isCorrect: !!ctx.isCorrect?.(qi)
		};
	}

	function buildMatchingResult(q: MatchingQuestion, qi: number) {
		const rows = ctx.getMatchRows(q);
		const choices = ctx.getMatchChoices(q);
		// Idem buildOrderingResult : indices d'emplacements.
		const selRaw = ctx.quizState.selections?.[qi];
		const selected: Array<number | null> = Array.isArray(selRaw) ? (selRaw as Array<number | null>) : [];
		const correctMap = ctx.getMatchCorrectMap(q);
		return {
			userMatches: rows.map((row, i) => {
				const choiceIndex = selected[i];
				return {
					row,
					choiceIndex,
					choice: choiceIndex !== null && choiceIndex !== undefined && Number.isInteger(choiceIndex) && choiceIndex >= 0 ? String(choices[choiceIndex] ?? "") : null
				};
			}),
			correctMatches: rows.map((row, i) => {
				const choiceIndex: number | null = Array.isArray(correctMap) ? correctMap[i] : null;
				return {
					row,
					choiceIndex,
					choice: choiceIndex !== null && Number.isInteger(choiceIndex) && choiceIndex >= 0 ? String(choices[choiceIndex] ?? "") : null
				};
			}),
			isCorrect: !!ctx.isCorrect?.(qi)
		};
	}

	function buildChoiceResult(q: QcmQuestion | MultiSelectQuestion, qi: number) {
		const selected = ctx.quizState.selections?.[qi];
		const correctIndices = getCorrectOptionIndices(q);
		if (q?.multiSelect) {
			const selectedIndices = selected instanceof Set ? Array.from(selected) : [];
			return {
				selectedAnswers: optionEntries(q, selectedIndices),
				correctAnswers: optionEntries(q, correctIndices),
				isCorrect: !!ctx.isCorrect?.(qi)
			};
		}

		const selectedIndex = typeof selected === "number" && Number.isInteger(selected) ? selected : null;
		return {
			selectedAnswer: selectedIndex === null ? null : optionEntry(q, selectedIndex),
			correctAnswer: correctIndices.length ? optionEntry(q, correctIndices[0]) : null,
			isCorrect: !!ctx.isCorrect?.(qi)
		};
	}

	function buildQcmAnswer(q: QuizQuestion, qi: number) {
		if (ctx.isClozeQuestion(q)) return buildClozeResult(q, qi);
		if (ctx.isTextQuestion(q)) return buildTextQuestionResult(q, qi);
		if (ctx.isCodeQuestion(q)) return null; // Résultat géré par engine/code.ts
		if (ctx.isOrderingQuestion(q)) return buildOrderingResult(q, qi);
		if (ctx.isMatchingQuestion(q)) return buildMatchingResult(q, qi);
		if (ctx.isFlashcardQuestion(q)) return null;
		return buildChoiceResult(q, qi);
	}

	function buildTextOnlyAnswer(q: QuizQuestion, qi: number) {
		const rating = ctx.textOnly?.normalizeRating?.(ctx.quizState.textOnlyRatings?.[qi]) || null;
		const ratingMeta = ctx.textOnly?.getRatingMeta?.(rating);
		return {
			freeTextAnswer: String(ctx.quizState.textOnlyAnswers?.[qi] ?? ""),
			checked: !!ctx.textOnly?.isChecked?.(qi),
			selfEvaluation: rating ? {
				value: rating,
				label: ratingMeta?.label || rating
			} : null,
			expectedAnswers: buildExpectedAnswers(q)
		};
	}

	function buildExpectedAnswers(q: QuizQuestion): unknown {
		if (ctx.isClozeQuestion(q)) {
			// Une entrée par TROU, dans l'ordre du gabarit : une correction de
			// texte à trous se lit trou par trou, pas comme une réponse unique.
			return ctx.cloze.getClozeAnswers(q).map((text, index) => ({ index, text }));
		}

		if (ctx.isTextQuestion(q)) {
			const acceptedAnswers = ctx.terminal?.getTextAcceptedAnswers?.(q) || [];
			return acceptedAnswers.map((text, index) => ({ index, text: String(text) }));
		}

		if (ctx.isOrderingQuestion(q)) {
			const items = ctx.getOrderingItems(q);
			return ctx.getOrderingCorrectOrder(q).map((index, orderIndex) => ({
				orderIndex,
				index,
				text: String(items[index] ?? "")
			}));
		}

		if (ctx.isMatchingQuestion(q)) {
			const rows = ctx.getMatchRows(q);
			const choices = ctx.getMatchChoices(q);
			const correctMap = ctx.getMatchCorrectMap(q);
			return rows.map((row, index) => {
				const choiceIndex: number | null = Array.isArray(correctMap) ? correctMap[index] : null;
				return {
					row,
					choiceIndex,
					text: choiceIndex !== null && Number.isInteger(choiceIndex) && choiceIndex >= 0 ? String(choices[choiceIndex] ?? "") : null
				};
			});
		}

		if (ctx.isCodeQuestion(q)) {
			return null; // Réponse attendue gérée par engine/code.ts
		}

		if (ctx.isFlashcardQuestion(q)) return null;

		return optionEntries(q, getCorrectOptionIndices(q));
	}

	function buildQuestionResult(q: QuizQuestion, qi: number, mode: string): QuestionResult {
		return {
			index: qi + 1,
			id: q?.id || null,
			title: q?.title || `Question ${qi + 1}`,
			kind: getQuestionKind(q),
			promptText: getQuestionPromptText(q),
			// Per question: a written answer (a Learn recall or explanation) keeps
			// its own text even inside a quiz that is otherwise corrected.
			answer: mode === "training" || ctx.textOnly?.isTextOnlyFor?.(qi) ? buildTextOnlyAnswer(q, qi) : buildQcmAnswer(q, qi),
			lessonText: getLessonText(q),
			explanationText: getExplanationText(q)
		};
	}

	function buildSummary(mode: string): Record<string, unknown> {
		if (mode === "training") {
			return {
				mode,
				...ctx.textOnly.computeResults()
			};
		}

		const score = ctx.computeScorePercent();
		/* FIX round 1 de revue task 6b (2026-09-01) : `answered` comptait TOUTES
		   les cartes via `hasAnyAnswer` — une carte "read" (jamais "repondue",
		   elle n'a rien a repondre) y valait toujours faux, alors que `total`
		   du MEME payload (`score.total`, computeScorePercent) l'exclut deja.
		   Le fichier de resultats se contredisait donc lui-meme (un artefact de
		   donnees versionne, lu par de l'outillage externe) : on saute une carte
		   "read" ici aussi, pour rester sur le MEME ensemble que `total`. */
		let answered = 0;
		for (let i = 0; i < ctx.quiz.length; i++) {
			if (ctx.isReadingCard(i)) continue;
			if (ctx.hasAnyAnswer(i)) answered++;
		}
		return {
			mode,
			...score,
			answered
		};
	}

	/* The payload is a DATA ARTEFACT (JSON versioned by schemaVersion,
	   written to RESULTS_DIR), not UI: its keys, its `kind` values ("text",
	   "ordering"...) and its fallback labels ("Option 3", "Question 2") do
	   NOT go through the dictionary — translating them would make two exports
	   of the same session unreadable to tooling. Only `selfEvaluation.label`
	   follows the UI language: it is the readable twin of
	   `selfEvaluation.value`, which stays the stable key ("understood" /
	   "partial" / "review").

	   Schema history:
	   - 3 (2026-10-09, automatic save): `attemptDate`, the date of the
	     dashboard history attempt recorded at the same hand-in; one file per
	     attempt, rewritten (never duplicated) when an answer is judged after
	     the hand-in.
	   - 2 (2026-08-31, review round 1 of task 0): `questions[].learnText` →
	     `lessonText` (mode "learn" renamed "lesson"); `quizMode` is never
	     "learn" any more, only "lesson". Three results files the user had
	     already written stay at schema 1 — the app never reads them back, only
	     external tooling needs this number to tell the two shapes apart.
	   - 1: initial shape. */
	function buildPayload(): ResultsPayload {
		const mode = ctx.textOnly?.isTextOnlyMode?.() ? "training" : "qcm";
		const now = new Date();
		const elapsedMs = ctx.examStartTime ? Math.max(0, Date.now() - ctx.examStartTime) : null;

		return {
			schemaVersion: 3,
			plugin: "quiz-blocks",
			savedAt: now.toISOString(),
			sourcePath: ctx.sourcePath || null,
			quizMode: ctx.quizMode,
			practiceMode: mode,
			quizTitle: sourceBaseName(),
			attemptDate: ctx.quizState.resultsSave?.attemptDate ?? null,
			exam: {
				enabled: !!ctx.isExamMode,
				started: !!ctx.examStarted,
				ended: !!ctx.examEnded,
				durationMinutes: ctx.isExamMode ? Math.round(ctx.examDurationMs / 60_000) : null,
				elapsedSeconds: elapsedMs === null ? null : Math.round(elapsedMs / 1000),
				remainingSeconds: Number.isFinite(ctx.examTimeRemaining) ? Math.round(ctx.examTimeRemaining / 1000) : null
			},
			summary: buildSummary(mode),
			questions: ctx.quiz.map((q, i) => buildQuestionResult(q, i, mode))
		};
	}

	/**
	 * The results file of the attempt being handed in, decided SYNCHRONOUSLY:
	 * the history attempt recorded at the same hand-in carries it
	 * (`Tentative.results`), so it must be known before the first `await`.
	 *
	 * The suffix is RANDOM and the name is reserved in memory: two saves of
	 * the same quiz in the same second (two windows, or two devices writing to
	 * the synced folder) never pick the same name. A counter made them
	 * converge on the same `-2`, and the second overwrote the first (review
	 * 2026-07-31).
	 */
	function planPath(): string | null {
		if (!ctx.sourcePath) return null;
		const mode = ctx.textOnly?.isTextOnlyMode?.() ? "training" : "qcm";
		const base = `${RESULTS_DIR}/${formatLocalTimestamp(new Date())}_${slugify(sourceBaseName())}_${mode}`;
		for (let n = 0; n < 20; n++) {
			const path = `${base}-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}.json`;
			if (reservePath(path)) return path;
		}
		return null;
	}

	/** Called by `goToResults` once per hand-in: a new attempt, its file. */
	function handIn(path: string | null, attemptDate: number | null): void {
		ctx.quizState.resultsSave = handedInResults(ctx.quizState.resultsSave, path, attemptDate);
	}

	/** Called by "Start over" (and a change of practice mode). */
	function reset(): void {
		ctx.quizState.resultsSave = resetResultsSave(ctx.quizState.resultsSave);
	}

	function errorText(error: unknown): string {
		return (error as { message?: string })?.message || t("engine.result.unknownError");
	}

	/* The button is updated IN PLACE, never by re-rendering the results
	   slide: the save ends while that slide may still be sliding in. */
	function rerender(): void {
		try { ctx.cards?.syncResultsFileButton?.(); } catch (_) { /* no results slide (tests) */ }
	}

	/* The payload is built right before each write, never across an `await`
	   that a "Start over" could cross: `current()` stops the loop as soon as
	   the attempt is no longer the one being saved. `dirty`: an answer judged
	   on the results screen after the save (a written answer's verdict)
	   rewrites the SAME file, never a second one. */
	let dirty = false;
	const current = (attempt: number): boolean => ctx.quizState.resultsSave?.attempt === attempt;

	async function writeAttempt(attempt: number, path: string): Promise<void> {
		await ctx.host.fs.mkdirs(RESULTS_DIR);
		do {
			dirty = false;
			if (!current(attempt)) return;
			const payload = buildPayload();
			await ctx.host.fs.write(path, `${JSON.stringify(payload, null, 2)}
`);
			try {
				await ctx.host.fs.write(`${RESULTS_DIR}/${RESULTS_MIRROR}`, `${JSON.stringify({ ...payload, savedResultPath: path }, null, 2)}
`);
			} catch (_) { /* the mirror is best-effort */ }
		} while (dirty && current(attempt) && ctx.quizState.resultsSave.status === "saving");
	}

	/**
	 * Saves this attempt's results, ONCE: a second call for the same attempt
	 * (re-render of the results, the Results tab clicked again) does nothing.
	 * `retry`: the "Retry" button after a failure. No notice on success; a
	 * failure shows its reason (permissions, full disk) and offers "Retry".
	 */
	async function autoSave({ retry = false }: { retry?: boolean } = {}): Promise<void> {
		const state = ctx.quizState.resultsSave;
		if (!canStartResultsSave(state, retry) || !state.path) return;
		const { attempt, path } = state;
		ctx.quizState.resultsSave = { ...state, status: "saving", error: null };
		rerender();
		try {
			await writeAttempt(attempt, path);
			if (!current(attempt)) return;
			ctx.quizState.resultsSave = { ...ctx.quizState.resultsSave, status: "saved", error: null };
		} catch (error) {
			console.warn(LOG_PREFIX, "results file not written", path, error);
			if (!current(attempt)) return;
			ctx.quizState.resultsSave = { ...ctx.quizState.resultsSave, status: "failed", error: errorText(error) };
			ctx.host.ui.notice(t("engine.result.saveError", { message: errorText(error) }));
		}
		rerender();
	}

	/** The answers changed after the hand-in: the saved file follows. */
	function refreshSaved(): void {
		const state = ctx.quizState.resultsSave;
		if (!state?.path || !ctx.quizState.resultsCounted) return;
		if (state.status === "saving") { dirty = true; return; }
		if (state.status !== "saved") return;
		const { attempt, path } = state;
		ctx.quizState.resultsSave = { ...state, status: "saving" };
		writeAttempt(attempt, path).then(
			() => { if (current(attempt)) ctx.quizState.resultsSave = { ...ctx.quizState.resultsSave, status: "saved" }; },
			(error) => {
				console.warn(LOG_PREFIX, "results file not rewritten", path, error);
				if (current(attempt)) ctx.quizState.resultsSave = { ...ctx.quizState.resultsSave, status: "saved" };
			});
	}

	/**
	 * "Delete these results": the file goes to the HOST'S TRASH (never a
	 * permanent delete), and the history attempt recorded at the same
	 * hand-in leaves the history — both are this one attempt. Only a path
	 * this saver decided, inside its results folder (`trashResultsFile`).
	 */
	async function deleteSaved(): Promise<void> {
		const state = ctx.quizState.resultsSave;
		if (!state?.path || (state.status !== "saved" && state.status !== "failed")) return;
		const { attempt, path, attemptDate } = state;
		ctx.quizState.resultsSave = { ...state, status: "deleting" };
		rerender();
		try {
			await trashResultsFile(ctx.host.fs, RESULTS_DIR, path);
			if (attemptDate !== null && ctx.sourcePath) ctx.statsSink?.supprimerTentative?.(ctx.sourcePath, attemptDate);
			if (current(attempt)) ctx.quizState.resultsSave = { ...ctx.quizState.resultsSave, status: "deleted", error: null };
		} catch (error) {
			console.warn(LOG_PREFIX, "results file not deleted", path, error);
			if (current(attempt)) ctx.quizState.resultsSave = { ...ctx.quizState.resultsSave, status: state.status };
			ctx.host.ui.notice(t("engine.result.deleteError", { message: errorText(error) }));
		}
		rerender();
	}

	return {
		RESULTS_DIR,
		buildPayload,
		planPath,
		handIn,
		reset,
		autoSave,
		refreshSaved,
		deleteSaved
	};
}
