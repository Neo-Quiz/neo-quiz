import type { EngineCtx } from "../types/engine-ctx";
import type {
	QuizQuestion,
	TextQuestion,
	QcmQuestion,
	MultiSelectQuestion,
	TextOnlyRating,
	FlashcardQuestion,
} from "../types/quiz";
import { renderLessonHtml } from "./sanitizer";
import { countAnswerLines } from "./terminal";
import { t, type TransKey } from "../i18n";
import { isNumericQuestion } from "./numeric";
import { usesMathField } from "./math-input";
import { isTapType } from "./step-page";

/* Icône Lucide `check` inline, même tracé que celle du cours (lecture-rendu.ts
   ICON_BOOK/`quiz-lecture-coche`) : le moteur n'a pas d'autre canal d'icône
   pour du HTML construit en chaîne (voir engine/passage.ts, même remarque). */
const ICON_CHECK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
/* Icône Lucide `x` — bouton « J'avais faux » de l'écran des résultats (verdictIconButtonsHtml). */
const ICON_X = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

export interface TextOnlyResults {
	understood: number;
	partial: number;
	review: number;
	pending: number;
	total: number;
	rated: number;
}

export interface RatingMeta {
	label: string;
	className: string;
}

export interface TextOnlyHandlers {
	RATINGS: Record<TextOnlyRating, RatingMeta>;
	isTextOnlyMode(): boolean;
	isTextOnlyFor(qi: number): boolean;
	isTextOnlyForAny(): boolean;
	isTextOnlyForAll(): boolean;
	isExamAnswerPhase(): boolean;
	isExamReviewPhase(): boolean;
	normalizeRating(value: TextOnlyRating | null | undefined): TextOnlyRating | null;
	getRatingMeta(value: TextOnlyRating | null | undefined): RatingMeta | null;
	hasAnyAnswer(qi: number): boolean;
	isChecked(qi: number): boolean;
	isRated(qi: number): boolean;
	computeResults(): TextOnlyResults;
	getCorrectOptionIndices(q: QuizQuestion): number[];
	expectedAnswerHtml(q: QuizQuestion): string;
	learningHtml(q: QuizQuestion, opts?: { plain?: boolean }): string;
	writtenReviewSectionHtml(): string;
	questionCardBodyHtml(q: QuizQuestion, qi: number): string;
	bindTextOnlyQuestion(trackItem: HTMLElement, qi: number): void;
	bindWrittenReviewControls(rootEl: Element | null): void;
}

export function createTextOnlyHandlers(ctx: EngineCtx): TextOnlyHandlers {
	/* `label` en GETTER, pas en chaîne figée : RATINGS est construit une fois par
	   instance de quiz (createTextOnlyHandlers), un libellé évalué ici resterait
	   dans la langue en vigueur à l'assemblage. Le getter fait de `label` un
	   accessor : la traduction est lue au moment où le HTML est construit.
	   `className` reste une constante — c'est un identifiant CSS, jamais traduit. */
	const RATINGS: Record<TextOnlyRating, RatingMeta> = {
		understood: { get label() { return t("engine.rating.understood"); }, className: "understood" },
		partial: { get label() { return t("engine.rating.partial"); }, className: "partial" },
		review: { get label() { return t("engine.rating.review"); }, className: "review" }
	};

	/* Décision GLOBALE, historique : tout le quiz en réponse libre + auto-
	   évaluation. Ne dépend plus d'AUCUN contrôle depuis le 2026-09-17 : le
	   bouton de l'UI est parti le 2026-08-31, et le démarrage « Practice » d'un
	   examen (exam.ts, ex-startTrainingMode) est retiré à son tour — « Apprendre »
	   garde les types de question. `practiceMode === "text"` ne vient plus que
	   du rôle `recall` d'une leçon. Les décisions qui portent sur le quiz
	   ENTIER et qui n'ont AUCUNE alternative par question (écran de
	   soumission, navigation flèche/onglet Résultats, phases d'examen)
	   restent branchées ici.
	   CORRECTIF round 1 de revue Task 5 (Findings 1 et 2) : l'écran de
	   RÉSULTATS (grille auto-évaluée vs pourcentage QCM) et l'exclusion du
	   score des STATISTIQUES du tableau de bord ne doivent PLUS lire cette
	   fonction seule — un mélange de rôles en Leçon (certaines questions
	   "recall", d'autres "test") n'est ni "tout QCM" ni "tout texte" au sens
	   de ce flag global. Ces deux décisions ont leur propre fonction dérivée,
	   isTextOnlyForAny / isTextOnlyForAll, ci-dessous. */
	function isTextOnlyMode(): boolean {
		return ctx.quizState?.practiceMode === "text";
	}

	/* Décision PAR QUESTION : absorbe la mécanique de l'ancien bouton « Practice
	   mode » dans le rôle "recall" du mode Leçon (Task 5, 2026-08-31) — une
	   question de restitution s'affiche toujours en réponse libre + auto-
	   évaluation, sans réglage utilisateur, alors que ses voisines "pre"/"test"
	   du même quiz restent en QCM. Le chemin historique (`practiceMode ===
	   "text"`) reste une clause OU : un bloc hors Leçon qui active encore ce
	   mode par sa configuration (démarrage « Entraînement ») continue de tout
	   afficher en réponse libre, question par question.
	   CORRECTIF (2026-09-26) : un "recall" ne force la réponse libre que pour
	   les types à CHOIX (single/multiple) — voir la question, ce serait donner
	   la réponse. Pour tout autre type (matching, ordering, cloze, numérique,
	   text, terminal…), la vraie interaction force déjà le rappel : forcer en
	   plus la réponse libre ne fait que masquer une correction réelle derrière
	   une auto-évaluation. */
	/* …EXCEPT when the choices ARE the question (2026-09-29): "Among these
	   statements, which ones are true?" turned into a free answer showed a
	   prompt pointing at statements that were no longer there — a question
	   nobody could answer (a generated CM1 Learn). A multiple-choice recall
	   (judging several statements is the recall itself) and a prompt that
	   refers to its options keep their choices. */
	const REFERS_TO_OPTIONS = /\b(parmi|lesquel|laquelle|lequel|ci-dessous|suivantes?\b|which (?:of|one)|among|the following)/i;
	function choicesAreTheQuestion(q: QuizQuestion): boolean {
		const r = q as { multiSelect?: unknown; prompt?: unknown; title?: unknown };
		if (r.multiSelect === true) return true;
		return REFERS_TO_OPTIONS.test(`${String(r.prompt ?? "")} ${String(r.title ?? "")}`);
	}

	function isRecallForcedTextOnly(q: QuizQuestion): boolean {
		return !choicesAreTheQuestion(q)
			&& !ctx.isOrderingQuestion(q)
			&& !ctx.isMatchingQuestion(q)
			&& !ctx.isClozeQuestion(q)
			&& !ctx.isTextQuestion(q)
			&& !ctx.isFlashcardQuestion(q);
	}

	/* An `explain` question ("in your own words", 2026-09-29) is a few
	   sentences: it can never match its model answer word for word, and was
	   marked wrong every time by the text comparison. In a Learn it is
	   SELF-RATED like a written recall: the model answer is shown, the
	   learner says whether theirs was right. A numeric, equation or terminal
	   answer keeps its real correction. */
	function isExplainWritten(qi: number, q: QuizQuestion): boolean {
		return ctx.isLessonMode()
			&& ctx.roleOfQuestion(qi) === "explain"
			&& ctx.isTextQuestion(q)
			&& !ctx.isClozeQuestion(q)
			&& !isNumericQuestion(q)
			&& !usesMathField(q)
			&& !ctx.terminal?.getTerminalTextVariant?.(q);
	}

	function isTextOnlyFor(qi: number): boolean {
		const q = ctx.quiz[qi];
		// Une carte mémoire EST une auto-évaluation, quel que soit le mode :
		// retournée (textOnlyChecked), puis notée (textOnlyRatings).
		if (ctx.isFlashcardQuestion(q)) return true;
		// In a step page nothing is typed: every card that is not answered by a
		// tap is a REVEAL card, self-rated like a flashcard (engine/step-page.ts).
		if (ctx.stepSlides && !ctx.isReadingCard(qi) && !isTapType(q)) return true;
		if (isTextOnlyMode()) return true;
		if (isExplainWritten(qi, q)) return true;
		return ctx.isLessonMode() && ctx.roleOfQuestion(qi) === "recall" && isRecallForcedTextOnly(q);
	}

	/* Décision GLOBALE DÉRIVÉE : au moins une question du quiz est actuellement
	   jugée par auto-évaluation — mode texte historique (toutes le sont), OU
	   au moins un rôle "recall" en mode Leçon. FINDING 1 (round 1 de revue
	   Task 5) : sert à exclure le SCORE des statistiques du tableau de bord
	   (goToResults, engine/state.ts) — mélanger une auto-évaluation à un
	   score QCM réel les rendrait incomparables (voir son commentaire), et
	   ça reste vrai dès qu'UNE SEULE question du mix est auto-évaluée, pas
	   seulement quand elles le sont toutes. Avant ce correctif, isTextOnlyMode()
	   seule valait faux en Leçon (practiceMode reste "qcm"), et laissait donc
	   goToResults écrire un bestScore qui mélangeait score réel et
	   auto-évaluations. */
	function isTextOnlyForAny(): boolean {
		return ctx.quiz.some((_, i) => isTextOnlyFor(i));
	}

	/* Décision GLOBALE DÉRIVÉE, symétrique : TOUTES les questions du quiz sont
	   jugées par auto-évaluation — mode texte historique, OU une Leçon (ou une
	   tranche qui constitue tout le bloc) entièrement composée de rôle
	   "recall". FINDING 2 (round 1 de revue Task 5) : sert à choisir la FORME
	   de l'écran de résultats (resultsSlideHtml, engine/cards.ts) — la grille
	   compris/partiel/à revoir n'a de sens que si AUCUNE question de la
	   session n'a de vraie correction ; un mélange test+recall garde l'écran
	   à pourcentage QCM (une forme dédiée à ce cas mixte reste hors du
	   périmètre de cette tâche). Garde ctx.quiz.length > 0 : un tableau vide
	   rendrait Array.every vrai par défaut, ce qui afficherait à tort la
	   grille sur un quiz sans questions. */
	function isTextOnlyForAll(): boolean {
		return ctx.quiz.length > 0 && ctx.quiz.every((_, i) => isTextOnlyFor(i));
	}

	function isExamAnswerPhase(): boolean {
		return isTextOnlyMode() && !!ctx.isExamMode && !!ctx.examStarted && !ctx.examEnded;
	}

	function isExamReviewPhase(): boolean {
		return isTextOnlyMode() && !!ctx.isExamMode && !!ctx.examEnded;
	}

	function normalizeRating(value: TextOnlyRating | null | undefined): TextOnlyRating | null {
		// Iso-fonctionnel avec `hasOwnProperty.call(RATINGS, value) ? value : null` :
		// pour value null/undefined, hasOwnProperty renvoie false → null. Le garde
		// `value != null` reproduit ce résultat exact tout en narrowing value en
		// clé valide (PropertyKey) pour hasOwnProperty.
		return value != null && Object.prototype.hasOwnProperty.call(RATINGS, value) ? value : null;
	}

	function getRatingMeta(value: TextOnlyRating | null | undefined): RatingMeta | null {
		const normalized = normalizeRating(value);
		return normalized ? RATINGS[normalized] : null;
	}

	function hasAnyAnswer(qi: number): boolean {
		const answer = ctx.quizState.textOnlyAnswers?.[qi];
		return typeof answer === "string" && answer.trim().length > 0;
	}

	function isChecked(qi: number): boolean {
		return !!ctx.quizState.textOnlyChecked?.[qi] || isExamReviewPhase();
	}

	function isRated(qi: number): boolean {
		return !!normalizeRating(ctx.quizState.textOnlyRatings?.[qi]);
	}

	function computeResults(): TextOnlyResults {
		/* FIX round 1 de revue task 6b (2026-09-01) : cette fonction itere sur
		   TOUT `ctx.quiz.length`, donc une carte "read" (jamais notee — elle
		   n'a rien a evaluer) y apparaissait en "pending", comme si l'eleve
		   avait une auto-evaluation en attente. La portee reelle de ce chemin
		   est reduite (isTextOnlyForAll — le seul appelant de ce resultat via
		   results-save.ts — devient deja faux des qu'une carte "read" existe,
		   puisqu'isTextOnlyFor ne route jamais "read" vers l'auto-evaluation),
		   mais rien n'empeche `computeResults` d'etre appelee directement avec
		   des cartes "read" dans le lot (mode texte historique force sur un
		   quiz Lecon, `practiceMode === "text"`, hors du controle de
		   `isTextOnlyForAll`) : on l'exclut donc explicitement plutot que de
		   compter sur l'appelant pour ne jamais l'atteindre. */
		const counts = { understood: 0, partial: 0, review: 0, pending: 0 };
		let total = 0;
		for (let i = 0; i < ctx.quiz.length; i++) {
			if (ctx.isReadingCard(i)) continue;
			total++;
			const rating = normalizeRating(ctx.quizState.textOnlyRatings?.[i]);
			if (rating) counts[rating]++;
			else counts.pending++;
		}
		return { ...counts, total, rated: total - counts.pending };
	}

	function getCorrectOptionIndices(q: QuizQuestion): number[] {
		if (!q) return [];
		// Lecture uniforme des champs QCM (options/correctIndices/correctIndex) —
		// pour les variantes non-QCM ces champs sont absents ⇒ retour [].
		const qc = q as QcmQuestion | MultiSelectQuestion;
		if (qc.multiSelect && Array.isArray(qc.correctIndices)) {
			return qc.correctIndices
				.map(Number)
				.filter(i => Number.isInteger(i) && i >= 0 && i < (qc.options || []).length);
		}
		const correctIndex = Number((qc as QcmQuestion).correctIndex);
		if (Number.isInteger(correctIndex) && correctIndex >= 0 && correctIndex < (qc.options || []).length) {
			return [correctIndex];
		}
		return [];
	}

	/* Ligne « coche verte + texte » d'une bonne réponse — porte `renderInlineText`
	   (ou `optionContentHtml`, qui l'appelle déjà pour une option QCM) en amont :
	   ce n'est qu'un habillage autour d'un fragment déjà assaini. */
	function correctLine(html: string): string {
		return `<div class="quiz-textonly-correct-line"><span class="quiz-textonly-correct-icon" aria-hidden="true">${ICON_CHECK}</span><span class="quiz-textonly-correct-text">${html}</span></div>`;
	}

	function expectedAnswerHtml(q: QuizQuestion): string {
		const indices = getCorrectOptionIndices(q);
		if (indices.length > 0) {
			// Invariant : indices non vides ⇒ question QCM.
			const items = indices
				.map(oi => correctLine(ctx.cards.optionContentHtml(q as QcmQuestion | MultiSelectQuestion, oi)))
				.join("");
			return `<div class="quiz-textonly-correct">${items}</div>`;
		}

		// getTextAcceptedAnswers est tolérant (champs texte optionnels) : pour une
		// variante non-texte il renvoie [] — cast documenté.
		const accepted = ctx.terminal?.getTextAcceptedAnswers?.(q as TextQuestion) || [];
		if (accepted.length > 0) {
			return `<div class="quiz-textonly-correct">${correctLine(ctx.sanitize.renderInlineText(accepted[0]))}</div>`;
		}

		if (ctx.isOrderingQuestion(q)) {
			const items = ctx.getOrderingItems(q);
			const order = ctx.getOrderingCorrectOrder(q);
			const answer = order.map(i => items[i]).filter(v => v !== undefined).join(" -> ");
			if (answer) return `<div class="quiz-textonly-correct">${correctLine(ctx.sanitize.renderInlineText(answer))}</div>`;
		}

		if (ctx.isMatchingQuestion(q)) {
			const rows = ctx.getMatchRows(q);
			const choices = ctx.getMatchChoices(q);
			const map = ctx.getMatchCorrectMap(q);
			if (Array.isArray(map) && map.length === rows.length) {
				const rowsHtml = rows.map((row, i) => {
					const choice = choices[map[i]] ?? "";
					return correctLine(`<strong>${ctx.sanitize.renderInlineText(row)}</strong><span class="quiz-textonly-correct-sep">→</span><span>${ctx.sanitize.renderInlineText(choice)}</span>`);
				}).join("");
				return `<div class="quiz-textonly-correct">${rowsHtml}</div>`;
			}
		}

		return `<div class="quiz-textonly-correct-empty">${t("engine.textOnly.noExpectedAnswer")}</div>`;
	}

	/* `opts.plain` (écran de correction réponse-libre, 2026-09-26) : ni titre
	   ni cadre, juste le contenu — par opposition au verso d'une carte mémoire
	   (flashcardBodyHtml), qui garde le cadre/label d'origine. Même contenu,
	   deux habillages, pour ne pas toucher la carte mémoire hors du périmètre
	   de cette tâche. */
	function learningHtml(q: QuizQuestion, opts?: { plain?: boolean }): string {
		const plain = !!opts?.plain;
		const chunks: string[] = [];
		const lessonContent = renderLessonHtml(q, ctx.sanitize);
		if (lessonContent) {
			chunks.push(plain
				? `<div class="quiz-textonly-explain-plain">${lessonContent}</div>`
				: `<div class="quiz-textonly-explain-block"><div class="quiz-textonly-label">${t("engine.lesson.label")}</div><div class="quiz-textonly-explain-content">${lessonContent}</div></div>`);
		}

		const explainHtml = q.explainHtml || q._explainHtml;
		if (explainHtml || q.explain) {
			const content = explainHtml
				? ctx.sanitize.replaceObsidianEmbedsInHtml(explainHtml)
				: ctx.sanitize.renderTextWithEmbeds(q.explain || "");
			chunks.push(plain
				? `<div class="quiz-textonly-explain-plain">${content}</div>`
				: `<div class="quiz-textonly-explain-block"><div class="quiz-textonly-label">${t("engine.textOnly.explanationLabel")}</div><div class="quiz-textonly-explain-content">${content}</div></div>`);
		}

		return chunks.join("");
	}

	/* DEUX boutons, icône seule (précision Ahmed du 2026-09-26bis) : l'auto-
	   évaluation d'une réponse écrite ne se fait plus sur la carte de la
	   question (plus de bouton Vérifier) mais sur l'écran des RÉSULTATS,
	   question par question (voir writtenReviewCardHtml plus bas). Binaire —
	   « J'avais juste » / « J'avais faux » — jamais de « En partie » : ce
	   troisième état reste RÉSERVÉ aux trois boutons de la carte mémoire
	   (flashcardBodyHtml, note()), seule survivance de RATINGS.partial. */
	function verdictIconButtonsHtml(qi: number, disabled = false): string {
		const current = normalizeRating(ctx.quizState.textOnlyRatings?.[qi]);
		const btn = (value: "understood" | "review", cls: string, icon: string, labelKey: TransKey) => {
			const selected = current === value;
			const label = t(labelKey);
			return `<button class="quiz-textonly-verdict-icon-btn ${cls}${selected ? " selected" : ""}" type="button" data-textonly-rating="${value}" aria-pressed="${selected}" aria-label="${ctx.escapeHtmlAttr(label)}"${disabled ? " disabled" : ""}>${icon}</button>`;
		};
		return `<div class="quiz-textonly-verdict-icon-row">
			${btn("understood", "right", ICON_CHECK, "engine.textOnly.verdict.right")}
			${btn("review", "wrong", ICON_X, "engine.textOnly.verdict.wrong")}
		</div>`;
	}

	/* Une carte par question à réponse écrite, sur l'écran des RÉSULTATS
	   uniquement (2026-09-26bis) : réponse donnée, bonne réponse, explication,
	   puis le verdict. Remplace l'ancien écran de correction affiché sur la
	   carte de la question elle-même (Check → revealed), retiré avec le
	   bouton Vérifier. */
	function writtenAnswerHtml(qi: number): string {
		const value = typeof ctx.quizState.textOnlyAnswers?.[qi] === "string" ? ctx.quizState.textOnlyAnswers[qi] : "";
		return value.trim()
			? `<div class="quiz-textonly-written-answer">${ctx.sanitize.renderInlineText(value)}</div>`
			: `<div class="quiz-textonly-written-answer quiz-textonly-written-answer-empty">${t("engine.textOnly.noAnswerGiven")}</div>`;
	}

	function writtenReviewCardHtml(qi: number): string {
		const q = ctx.quiz[qi];
		const numero = ctx.numeroAffiche?.(qi) ?? qi + 1;
		return `<div class="quiz-textonly-written-card" data-textonly-written="${qi}">
			<div class="quiz-textonly-written-head"><span class="quiz-textonly-written-num">${t("engine.textOnly.writtenQuestionNumber", { n: numero })}</span>${ctx.cards.renderQuizPromptHtml(q)}</div>
			<div class="quiz-textonly-label">${t("engine.textOnly.answerLabel")}</div>
			${writtenAnswerHtml(qi)}
			${expectedAnswerHtml(q)}
			${learningHtml(q, { plain: true })}
			${verdictIconButtonsHtml(qi)}
		</div>`;
	}

	/* Toutes les questions à réponse écrite (recall à choix, ou mode texte
	   historique) hors carte mémoire — celle-ci garde son propre écran de
	   retournement, jamais listée ici. Appelée depuis resultsSlideHtml
	   (cards.ts), quel que soit son habillage (pourcentage QCM ou grille
	   compris/partiel/à revoir). */
	function writtenReviewSectionHtml(): string {
		// A written answer already judged on its Learn card (engine/learn.ts)
		// keeps that verdict: it is not asked again here.
		const indices = ctx.quiz
			.map((_, i) => i)
			.filter(i => isTextOnlyFor(i) && !ctx.isFlashcardQuestion(ctx.quiz[i]) && (ctx.learn?.verdictOf?.(i) ?? "none") === "none");
		if (indices.length === 0) return "";
		return `<div class="quiz-textonly-written-review">${indices.map(writtenReviewCardHtml).join("")}</div>`;
	}

	/* Câblage des boutons de verdict de writtenReviewSectionHtml — sur l'écran
	   des RÉSULTATS, donc plusieurs `qi` dans une seule racine (contrairement à
	   bindTextOnlyQuestion, lié à la carte d'UNE question). */
	function bindWrittenReviewControls(rootEl: Element | null): void {
		if (!rootEl) return;
		rootEl.querySelectorAll<HTMLElement>(".quiz-textonly-written-card[data-textonly-written]").forEach(card => {
			const qi = Number(card.dataset.textonlyWritten);
			if (!Number.isInteger(qi)) return;
			card.querySelectorAll<HTMLButtonElement>(".quiz-textonly-verdict-icon-btn[data-textonly-rating]").forEach(btn => {
				btn.addEventListener("click", e => {
					e.preventDefault();
					const rating = normalizeRating(btn.dataset.textonlyRating as TextOnlyRating | undefined);
					if (!rating) return;
					ctx.quizState.textOnlyRatings[qi] = rating;
					ctx.invalidateSavedResults?.();
					ctx.recordReview(qi, rating);
					ctx.cards.refreshMetaSlides({ force: true });
				});
			});
		});
	}

	/* FLASHCARD (flashcard spec §3, redesigned 2026-09-27). A real card,
	   centred, that turns over in 3D: the question on the front, the answer
	   on the back. The whole front IS the "flip" button (`quiz-flashcard-flip-btn`,
	   also `quiz-textonly-check-btn`: the same handler as "Check" sets
	   textOnlyChecked[qi]). The prompt is rendered HERE, on the front, and
	   no longer above the card by cards.ts — it keeps its `.quiz-question`
	   class, which the glossary pass never underlines (engine/termes.ts);
	   the back keeps `.quiz-flashcard-back`, the after-answer zone where it
	   does. The back is only in the DOM once the card is turned: before
	   that, nothing of the answer can leak (screen reader, glossary).
	   The flip plays once, right after the click (`justFlipped`): the card
	   is re-rendered by the click, so the new card starts face up and turns.
	   The two ratings are "press me" buttons like the answer options, both
	   neutral until one is chosen. */
	function flashcardBodyHtml(q: FlashcardQuestion, qi: number): string {
		const front = `<span class="quiz-fc-face is-front">
				<span class="quiz-fc-label">${t("engine.flashcard.front")}</span>
				<div class="quiz-question quiz-fc-text">${ctx.cards.renderQuizPromptHtml(q)}</div>
				<span class="quiz-fc-tip">${t("engine.flashcard.flipTip")} <kbd class="quiz-flashcard-kbd">${t("engine.flashcard.flipHint")}</kbd></span>
			</span>`;
		if (!isChecked(qi)) {
			return `<div class="quiz-flashcard quiz-fc" data-flashcard="1">
				<button class="quiz-fc-card quiz-textonly-check-btn quiz-flashcard-flip-btn" type="button" aria-keyshortcuts="Space" aria-label="${ctx.escapeHtmlAttr(t("engine.flashcard.flip"))}">
					<span class="quiz-fc-inner">${front}</span>
				</button>
			</div>`;
		}
		const verso = typeof q.answer === "string" && q.answer.trim()
			? ctx.sanitize.renderInlineText(q.answer)
			: `<span class="quiz-flashcard-missing">${t("engine.flashcard.missingAnswer")}</span>`;
		const animate = justFlipped === qi;
		if (animate) justFlipped = null;
		/* Turned, the card stays clickable: a click (or Space) turns it back to
		   read the question again, and again to the answer — a pure view
		   toggle (`is-front`), the rating is untouched and nothing re-renders.
		   A focusable <div role="button"> and not a <button>: the button's
		   press effect (`:active`) would replace its rotation. */
		return `<div class="quiz-flashcard quiz-fc is-flipped${animate ? " is-flipping" : ""}" data-flashcard="1">
			<div class="quiz-fc-card quiz-flashcard-flip-btn" role="button" tabindex="0" aria-pressed="false" aria-label="${ctx.escapeHtmlAttr(t("engine.flashcard.showQuestion"))}">
				<span class="quiz-fc-inner">
					${front}
					<span class="quiz-fc-face is-back quiz-flashcard-back" aria-live="polite">
						<span class="quiz-fc-label">${t("engine.flashcard.back")}</span>
						<span class="quiz-flashcard-answer quiz-fc-text">${verso}</span>
					</span>
				</span>
			</div>
			${learningHtml(q)}
			${selfRatingHtml(qi)}
		</div>`;
	}

	/* The two self-verdict buttons of a flashcard — and of a reveal card, which
	   is a flashcard whose front is a question. In a Learn the rating IS the
	   check: given once per attempt, so the buttons lock once it is. */
	function selfRatingHtml(qi: number): string {
		const current = normalizeRating(ctx.quizState.textOnlyRatings?.[qi]);
		const rated = ctx.learn.isGraded(qi) && ctx.isRevealed(qi) && !ctx.quizState.locked;
		const note = (value: TextOnlyRating, key: TransKey, touche: string) => {
			const on = current === value;
			return `<button class="quiz-fc-rate quiz-textonly-rating-btn ${RATINGS[value].className}${on ? " selected" : ""}" type="button" data-textonly-rating="${value}" aria-pressed="${on}" aria-keyshortcuts="${touche}"${rated ? " disabled" : ""}><kbd class="quiz-flashcard-kbd">${touche}</kbd><span>${t(key)}</span></button>`;
		};
		return `<div class="quiz-flashcard-rating quiz-fc-ratings">
				${note("review", "engine.flashcard.again", "1")}
				${note("understood", "engine.flashcard.knew", "2")}
			</div>`;
	}

	/* A REVEAL CARD (step page, any type answered by neither a tap nor a
	   flashcard): the prompt is on the card (cards.ts); here the "Show the
	   answer" button, then the answer, the explanation and the self-verdict.
	   A code exercise shows its starter read-only first and keeps its
	   solution behind the button. It is the text-only "check" button: the
	   same click handler turns it over (`textOnlyChecked`). */
	function revealCardHtml(q: QuizQuestion, qi: number): string {
		const code = ctx.isCodeQuestion(q) ? q : null;
		const fenced = (src: string): string => ctx.sanitize.renderTextWithEmbeds("```" + String(code?.language ?? "") + "\n" + src + "\n```");
		const starter = code?.starter?.trim() ? `<div class="quiz-reveal-code">${fenced(code.starter)}</div>` : "";
		if (!isChecked(qi)) {
			return `<div class="quiz-reveal">${starter}<button class="quiz-action-btn quiz-reveal-btn quiz-textonly-check-btn" type="button">${t("engine.learn.showAnswer")}</button></div>`;
		}
		const answer = code
			? (code.solution?.trim() ? `<div class="quiz-textonly-correct"><div class="quiz-reveal-code">${fenced(code.solution)}</div></div>` : "")
			: expectedAnswerHtml(q);
		return `<div class="quiz-reveal is-open">${starter}${answer}${learningHtml(q, { plain: true })}${selfRatingHtml(qi)}</div>`;
	}

	/* The flashcard turned by the LAST click, whose re-render must play the
	   flip — see flashcardBodyHtml. */
	let justFlipped: number | null = null;

	/* Plus de bouton Vérifier ni de correction affichée sur la carte
	   elle-même (2026-09-26bis) : on écrit sa réponse, elle est conservée
	   (persistAnswer/commitAnswer, plus bas), et on passe à la suivante —
	   l'auto-évaluation attend l'écran des résultats (writtenReviewCardHtml).
	   Le champ reste donc TOUJOURS éditable ici, jamais en lecture seule. */
	/* Hauteur DE DÉPART du champ « avec tes mots » (précision du 27/09, règle
	   générale de tout champ de réponse écrite) : le nombre de lignes de la
	   réponse attendue — la bonne option d'un QCM forcé en rappel, ou la
	   réponse acceptée d'une question texte — entre 1 et 6, jamais un champ
	   de 10 lignes pour une réponse d'une ligne. Aucune référence connue
	   (classement, appariement…) : 1 ligne, elle grandit avec la saisie. */
	function expectedWrittenRows(q: QuizQuestion, qi: number): number {
		// An explanation in your own words starts at four lines (terminal.ts, same rule).
		if (ctx.isLessonMode() && ctx.roleOfQuestion(qi) === "explain") return Math.max(4, expectedWrittenRowsOf(q));
		return expectedWrittenRowsOf(q);
	}

	function expectedWrittenRowsOf(q: QuizQuestion): number {
		const indices = getCorrectOptionIndices(q);
		if (indices.length > 0) {
			const qc = q as QcmQuestion | MultiSelectQuestion;
			const texte = indices.map(oi => String((qc.options || [])[oi] ?? "")).join("\n");
			return countAnswerLines(texte, 6);
		}
		const accepted = ctx.terminal?.getTextAcceptedAnswers?.(q as TextQuestion) || [];
		return countAnswerLines(accepted[0] ?? "", 6);
	}

	/* A written answer CHECKED in a Learn (engine/learn.ts, 2026-09-29): the
	   same correction as the results screen gives — the model answer and the
	   explanation — then the learner's own verdict, on the card. Once given,
	   the verdict holds for this attempt (a retry asks again). */
	function learnCorrectionHtml(q: QuizQuestion, qi: number): string {
		const pending = ctx.learn.isPendingSelfRating(qi);
		return `<div class="quiz-textonly-learn-correction">
			${expectedAnswerHtml(q)}
			${learningHtml(q, { plain: true })}
			<div class="quiz-textonly-learn-rate">
				<span class="quiz-textonly-learn-rate-title">${t("engine.learn.rateTitle")}</span>
				${verdictIconButtonsHtml(qi, !pending)}
			</div>
		</div>`;
	}

	function questionCardBodyHtml(q: QuizQuestion, qi: number): string {
		if (ctx.isFlashcardQuestion(q)) return flashcardBodyHtml(q, qi);
		if (ctx.stepSlides) return revealCardHtml(q, qi);
		const value = typeof ctx.quizState.textOnlyAnswers?.[qi] === "string" ? ctx.quizState.textOnlyAnswers[qi] : "";
		const checkedInLearn = ctx.learn.isCheckable(qi) && ctx.isRevealed(qi) && !ctx.quizState.locked;
		const textareaName = ctx.escapeHtmlAttr(q?.id || `q${qi + 1}`);

		return `<div class="quiz-textonly">
			<div class="quiz-textonly-answer">
				<!-- No visible label above the field (2026-09-29): its placeholder
				     already says what to write. Screen readers keep the name. -->
				<textarea
					id="quizTextOnly_${ctx.QUIZ_INSTANCE_ID}_${qi}"
					class="quiz-textarea quiz-textonly-textarea"
					aria-label="${ctx.escapeHtmlAttr(t("engine.textOnly.answerLabel"))}"
					data-textonly-answer="1"
					name="${textareaName}"
					placeholder="${ctx.escapeHtmlAttr(t("engine.textOnly.answerPlaceholder"))}"
					spellcheck="false"
					autocapitalize="off"
					autocomplete="off"
					autocorrect="off"
					rows="${expectedWrittenRows(q, qi)}"
					${checkedInLearn ? `readonly aria-readonly="true"` : ""}
				>${ctx.escapeHtmlText(value)}</textarea>
			</div>
			${checkedInLearn ? learnCorrectionHtml(q, qi) : ""}
		</div>`;
	}

	function syncTextAreaHeight(textarea: HTMLTextAreaElement): void {
		if (ctx.terminal?.syncTextAreaHeight) {
			ctx.terminal.syncTextAreaHeight(textarea);
			return;
		}
		// Même règle que engine/terminal.ts : pas de plancher fixe, la hauteur de
		// départ vient de l'attribut `rows` (expectedWrittenRows ci-dessus).
		textarea.style.height = "auto";
		textarea.style.height = `${textarea.scrollHeight}px`;
	}

	function bindTextOnlyQuestion(trackItem: HTMLElement, qi: number): void {
		const textarea = trackItem.querySelector<HTMLTextAreaElement>(".quiz-textonly-textarea[data-textonly-answer]");
		if (textarea) {
			const syncLayout = () => {
				syncTextAreaHeight(textarea);
				const slideIdx = ctx.getSlideIndexForQuestion(qi);
				if (slideIdx >= 0) ctx.viewport.__quizSlideHeightCache?.delete(slideIdx);
				if (slideIdx === ctx.quizState.current) {
					ctx.viewport.scheduleViewportHeightSync({ index: slideIdx, animate: false, refresh: true });
				}
			};

			const persistAnswer = () => {
				if (isChecked(qi)) return;
				ctx.invalidateSavedResults?.();
				ctx.quizState.textOnlyAnswers[qi] = String(textarea.value ?? "");
			};

			const commitAnswer = () => {
				if (isChecked(qi)) return;
				// Persister l'état même pendant un slide (sinon la frappe de fin est perdue) ;
				// le re-render (nav + meta) n'est fait qu'hors slide pour ne pas casser l'animation.
				persistAnswer();
				if (ctx.quizState.isSliding) return;
				ctx.updateNavHighlight();
				ctx.cards.refreshMetaSlides();
				syncLayout();
			};

			textarea.addEventListener("input", commitAnswer);
			textarea.addEventListener("paste", () => requestAnimationFrame(commitAnswer));
			textarea.addEventListener("focus", syncLayout);
			textarea.addEventListener("blur", () => { persistAnswer(); syncLayout(); });
			syncLayout();
		}

		const turned = trackItem.querySelector<HTMLElement>(".quiz-fc.is-flipped .quiz-fc-card");
		if (turned) {
			const fc = turned.closest<HTMLElement>(".quiz-fc");
			turned.addEventListener("click", e => {
				e.preventDefault();
				if (!fc) return;
				fc.classList.remove("is-flipping");
				const front = fc.classList.toggle("is-front");
				turned.setAttribute("aria-pressed", String(front));
				turned.setAttribute("aria-label", t(front ? "engine.flashcard.showAnswer" : "engine.flashcard.showQuestion"));
			});
		}

		const checkBtn = trackItem.querySelector<HTMLButtonElement>(".quiz-textonly-check-btn");
		if (checkBtn) {
			checkBtn.addEventListener("click", e => {
				e.preventDefault();
				if (ctx.quizState.isSliding) return;
				const liveTextarea = trackItem.querySelector<HTMLTextAreaElement>(".quiz-textonly-textarea[data-textonly-answer]");
				ctx.invalidateSavedResults?.();
				ctx.quizState.textOnlyAnswers[qi] = String(liveTextarea?.value ?? ctx.quizState.textOnlyAnswers[qi] ?? "");
				ctx.quizState.textOnlyChecked[qi] = true;
				if (ctx.isFlashcardQuestion(ctx.quiz[qi])) justFlipped = qi;
				ctx.commitQuestionInteraction(qi, { syncHeight: true });
			});
		}

		trackItem.querySelectorAll<HTMLElement>(".quiz-textonly-rating-btn[data-textonly-rating]").forEach(btn => {
			btn.addEventListener("click", e => {
				e.preventDefault();
				if (ctx.quizState.isSliding) return;
				const rating = normalizeRating(btn.dataset.textonlyRating as TextOnlyRating | undefined);
				if (!rating) return;
				if ((btn as HTMLButtonElement).disabled) return;
				ctx.quizState.textOnlyRatings[qi] = rating;
				// In a Learn the verdict exists NOW: here, and not on the results
				// screen, a recall becomes a memory signal. In a Test,
				// `recordReview` holds it until the hand-in (engine/state.ts).
				// NON-optional call: `recordReview` is REQUIRED on EngineCtx
				// (types/engine-ctx.ts) — a `?.` here would hide a missing wiring
				// instead of failing loudly (fix round 1, 2026-09-02).
				ctx.recordReview(qi, rating);
				// In a Learn the rating is the flashcard's check (engine/learn.ts).
				ctx.learn.selfVerdict(qi, rating);
				ctx.commitQuestionInteraction(qi, { syncHeight: true });
				ctx.stepScrollNext?.(qi);
			});
		});

		// A written answer checked in a Learn: the learner's own verdict, on the card.
		trackItem.querySelectorAll<HTMLButtonElement>(".quiz-textonly-learn-rate .quiz-textonly-verdict-icon-btn[data-textonly-rating]").forEach(btn => {
			btn.addEventListener("click", e => {
				e.preventDefault();
				if (ctx.quizState.isSliding || btn.disabled) return;
				const rating = normalizeRating(btn.dataset.textonlyRating as TextOnlyRating | undefined);
				if (!rating) return;
				ctx.quizState.textOnlyRatings[qi] = rating;
				ctx.recordReview(qi, rating);
				ctx.learn.selfVerdict(qi, rating);
				ctx.commitQuestionInteraction(qi, { syncHeight: true });
				ctx.stepScrollNext?.(qi);
			});
		});
	}

	/* Clavier d'une carte mémoire, sur le CONTENEUR du quiz, en phase de
	   CAPTURE (revue finale). Deux versions ont échoué avant :
	   - sur `trackItem`, il ne voyait jamais une frappe dont le focus est
	     ailleurs dans le quiz — l'onglet de navigation `.quiz-tab`, notamment ;
	   - sur `document`, TOUS les quiz de la page réagissaient à la même touche
	     (deux blocs dans une note, un onglet Obsidian en arrière-plan), Espace
	     sur un bouton hors du quiz retournait la carte, et le `keydown` de
	     `.quiz-tab` (interactions.ts) arrêtait de toute façon Espace avant
	     qu'il remonte — seuls 1 et 2 passaient.
	   La capture sur le conteneur passe AVANT l'écouteur de l'onglet, et ne
	   voit que les frappes dont le focus est DANS ce quiz : c'est la règle des
	   flèches (`interactions.ts`, « Bindé sur le container »). Un bouton de la
	   carte qui a le focus garde son comportement natif (Espace et Entrée
	   l'activent eux-mêmes). Ignore les champs de saisie, MathLive compris, et
	   les modificateurs. Espace ou Entrée retourne (spec §3), 1 note « À
	   revoir », 2 « Je savais » ; après le retournement, le focus passe sur
	   « Je savais » (restauration de `focus.ts`). */
	function currentFlashcardQuestionIndex(): number | null {
		// A step page holds several cards: no key stands for one of them.
		if (ctx.stepSlides) return null;
		const si = ctx.quizState.current;
		if (!ctx.isQuestionSlideIndex(si)) return null;
		const qi = (ctx.slideMap[si] as { questionIndex: number }).questionIndex;
		return ctx.isFlashcardQuestion(ctx.quiz[qi]) ? qi : null;
	}

	function bindFlashcardKeys(): void {
		// Repli test (check-engine-review.mjs, ctx factice sans DOM).
		if (!ctx.container || typeof ctx.container.addEventListener !== "function") return;
		const onKeydown = (e: KeyboardEvent) => {
			if (ctx.isDestroyed() || !ctx.container.isConnected) return;
			const qi = currentFlashcardQuestionIndex();
			if (qi === null) return;
			const cible = e.target as HTMLElement | null;
			if (cible?.closest?.("input, textarea, select, [contenteditable], math-field")) return;
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			const trackItem = ctx.container.querySelector<HTMLElement>(`[data-qi="${qi}"]`);
			if (!trackItem) return;
			// Un bouton DE LA CARTE qui a le focus s'active tout seul.
			if ((e.key === " " || e.key === "Enter") && cible?.closest?.("button") && trackItem.contains(cible)) return;
			const retourner = e.key === " " || e.key === "Enter";
			const vise = retourner ? ".quiz-flashcard-flip-btn"
				: e.key === "1" ? '.quiz-textonly-rating-btn[data-textonly-rating="review"]'
				: e.key === "2" ? '.quiz-textonly-rating-btn[data-textonly-rating="understood"]'
				: null;
			if (!vise) return;
			const bouton = trackItem.querySelector<HTMLButtonElement>(vise);
			if (!bouton) return;
			e.preventDefault();
			e.stopPropagation();
			/* Le focus suit comme après un clic : la restauration de `focus.ts`
			   le passe de « Retourner » à « Je savais » au repeint du verso. */
			if (retourner) bouton.focus({ preventScroll: true });
			bouton.click();
		};
		ctx.container.addEventListener("keydown", onKeydown, true);
		ctx.__quizGlobalCleanups.push(() => ctx.container.removeEventListener("keydown", onKeydown, true));
	}
	bindFlashcardKeys();

	return {
		RATINGS,
		isTextOnlyMode,
		isTextOnlyFor,
		isTextOnlyForAny,
		isTextOnlyForAll,
		isExamAnswerPhase,
		isExamReviewPhase,
		normalizeRating,
		getRatingMeta,
		hasAnyAnswer,
		isChecked,
		isRated,
		computeResults,
		getCorrectOptionIndices,
		expectedAnswerHtml,
		learningHtml,
		writtenReviewSectionHtml,
		questionCardBodyHtml,
		bindTextOnlyQuestion,
		bindWrittenReviewControls
	};
}
