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
import { t, type TransKey } from "../i18n";

/* Icône Lucide `check` inline, même tracé que celle du cours (lecture-rendu.ts
   ICON_BOOK/`quiz-lecture-coche`) : le moteur n'a pas d'autre canal d'icône
   pour du HTML construit en chaîne (voir engine/passage.ts, même remarque). */
const ICON_CHECK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

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
	ratingButtonsHtml(qi: number): string;
	questionCardBodyHtml(q: QuizQuestion, qi: number): string;
	bindTextOnlyQuestion(trackItem: HTMLElement, qi: number): void;
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
	   afficher en réponse libre, question par question. */
	function isTextOnlyFor(qi: number): boolean {
		// Une carte mémoire EST une auto-évaluation, quel que soit le mode :
		// retournée (textOnlyChecked), puis notée (textOnlyRatings).
		if (ctx.isFlashcardQuestion(ctx.quiz[qi])) return true;
		return isTextOnlyMode() || (ctx.isLessonMode() && ctx.roleOfQuestion(qi) === "recall");
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
			if (ctx.lecturesAbsorbees?.has(i) || (ctx.isLessonMode() && ctx.roleOfQuestion(i) === "read")) continue;
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

	/* Trois boutons plats, sans cadre ni libellé de tête (précision Ahmed du
	   2026-09-26) : `quiz-textonly-rating-btn` reste pour le câblage
	   (bindTextOnlyQuestion cible ce sélecteur), `quiz-textonly-verdict-btn`
	   porte le style propre à cet écran — la carte mémoire garde son style
	   `quiz-action-btn` d'origine, inchangé. */
	function ratingButtonsHtml(qi: number): string {
		const current = normalizeRating(ctx.quizState.textOnlyRatings?.[qi]);
		const btn = (value: TextOnlyRating, key: TransKey) => {
			const selected = current === value;
			return `<button class="quiz-textonly-rating-btn quiz-textonly-verdict-btn ${RATINGS[value].className}${selected ? " selected" : ""}" type="button" data-textonly-rating="${value}" aria-pressed="${selected}">${t(key)}</button>`;
		};
		return `<div class="quiz-textonly-verdict-row">
			${btn("understood", "engine.textOnly.verdict.yes")}
			${btn("partial", "engine.textOnly.verdict.partial")}
			${btn("review", "engine.textOnly.verdict.review")}
		</div>`;
	}

	/* CARTE MÉMOIRE (spec cartes §3). Le recto est l'énoncé, déjà rendu par
	   cards.ts au-dessus de ce corps ; ici : « Retourner », puis le verso.
	   Le bouton Retourner porte AUSSI `quiz-textonly-check-btn` : le même
	   gestionnaire que « Vérifier » pose textOnlyChecked[qi]. Les deux notes
	   portent `quiz-textonly-rating-btn` : le même gestionnaire journalise. */
	function flashcardBodyHtml(q: FlashcardQuestion, qi: number): string {
		if (!isChecked(qi)) {
			return `<div class="quiz-flashcard" data-flashcard="1">
				<div class="quiz-actions quiz-flashcard-actions">
					<button class="quiz-action-btn success quiz-textonly-check-btn quiz-flashcard-flip-btn" type="button" aria-keyshortcuts="Space">${t("engine.flashcard.flip")}</button>
					<span class="quiz-flashcard-kbd">${t("engine.flashcard.flipHint")}</span>
				</div>
			</div>`;
		}
		const current = normalizeRating(ctx.quizState.textOnlyRatings?.[qi]);
		const verso = typeof q.answer === "string" && q.answer.trim()
			? ctx.sanitize.renderInlineText(q.answer)
			: `<span class="quiz-flashcard-missing">${t("engine.flashcard.missingAnswer")}</span>`;
		const note = (value: TextOnlyRating, key: TransKey, touche: string) => {
			const on = current === value;
			return `<button class="quiz-action-btn quiz-textonly-rating-btn ${RATINGS[value].className}${on ? " selected" : ""}" type="button" data-textonly-rating="${value}" aria-pressed="${on}" aria-keyshortcuts="${touche}">${t(key)} <span class="quiz-flashcard-kbd">${touche}</span></button>`;
		};
		return `<div class="quiz-flashcard is-flipped" data-flashcard="1">
			<div class="quiz-flashcard-back" aria-live="polite">
				<div class="quiz-textonly-label">${t("engine.flashcard.back")}</div>
				<div class="quiz-flashcard-answer">${verso}</div>
				${learningHtml(q)}
				<div class="quiz-flashcard-rating">
					${note("review", "engine.flashcard.again", "1")}
					${note("understood", "engine.flashcard.knew", "2")}
				</div>
			</div>
		</div>`;
	}

	function questionCardBodyHtml(q: QuizQuestion, qi: number): string {
		if (ctx.isFlashcardQuestion(q)) return flashcardBodyHtml(q, qi);
		const checked = isChecked(qi);
		const examAnswerPhase = isExamAnswerPhase();
		const revealed = checked && !examAnswerPhase;
		const value = typeof ctx.quizState.textOnlyAnswers?.[qi] === "string" ? ctx.quizState.textOnlyAnswers[qi] : "";
		const textareaName = ctx.escapeHtmlAttr(q?.id || `q${qi + 1}`);
		const readOnlyAttr = revealed ? `readonly aria-readonly="true"` : "";

		// Écran de correction simplifié (2026-09-26) : bonne réponse seule, puis
		// son explication en texte simple, puis le verdict — plus de cadres à
		// titres empilés (own answer / self-assessment / options / explanation).
		const reviewHtml = revealed ? `<div class="quiz-textonly-review">
			${expectedAnswerHtml(q)}
			${learningHtml(q, { plain: true })}
			${ratingButtonsHtml(qi)}
		</div>` : "";

		// Révélé : le titre du champ disparaît (la réponse reste lisible telle
		// quelle) — repris en `aria-label` pour ne pas perdre l'accessibilité.
		const answerLabelHtml = revealed
			? ""
			: `<label class="quiz-textonly-label" for="quizTextOnly_${ctx.QUIZ_INSTANCE_ID}_${qi}">${t("engine.textOnly.answerLabel")}</label>`;
		const ariaLabelAttr = revealed ? ` aria-label="${ctx.escapeHtmlAttr(t("engine.textOnly.answerLabel"))}"` : "";

		return `<div class="quiz-textonly">
			<div class="quiz-textonly-answer">
				${answerLabelHtml}
				<textarea
					id="quizTextOnly_${ctx.QUIZ_INSTANCE_ID}_${qi}"
					class="quiz-textarea quiz-textonly-textarea"
					data-textonly-answer="1"
					name="${textareaName}"
					placeholder="${ctx.escapeHtmlAttr(t("engine.textOnly.answerPlaceholder"))}"
					spellcheck="false"
					autocapitalize="off"
					autocomplete="off"
					autocorrect="off"
					${readOnlyAttr}${ariaLabelAttr}
				>${ctx.escapeHtmlText(value)}</textarea>
				${(!revealed && !examAnswerPhase) ? `<div class="quiz-actions quiz-textonly-check-actions"><button class="quiz-action-btn success quiz-textonly-check-btn" type="button">${t("engine.textOnly.check")}</button></div>` : ""}
			</div>
			${reviewHtml}
		</div>`;
	}

	function syncTextAreaHeight(textarea: HTMLTextAreaElement): void {
		if (ctx.terminal?.syncTextAreaHeight) {
			ctx.terminal.syncTextAreaHeight(textarea);
			return;
		}
		textarea.style.height = "auto";
		textarea.style.height = `${Math.max(220, textarea.scrollHeight)}px`;
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
			textarea.addEventListener("keydown", e => {
				if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
					e.preventDefault();
					const checkBtn = trackItem.querySelector<HTMLButtonElement>(".quiz-textonly-check-btn");
					if (checkBtn) checkBtn.click();
				}
			});
			syncLayout();
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
				ctx.commitQuestionInteraction(qi, { syncHeight: true });
			});
		}

		trackItem.querySelectorAll<HTMLElement>(".quiz-textonly-rating-btn[data-textonly-rating]").forEach(btn => {
			btn.addEventListener("click", e => {
				e.preventDefault();
				if (ctx.quizState.isSliding) return;
				const rating = normalizeRating(btn.dataset.textonlyRating as TextOnlyRating | undefined);
				if (!rating) return;
				ctx.quizState.textOnlyRatings[qi] = rating;
				// Le verdict existe MAINTENANT : c'est ici, et pas à l'écran de
				// résultats, qu'une restitution devient un signal de mémoire.
				// Appel NON optionnel : `recordReview` est REQUIS sur EngineCtx
				// (types/engine-ctx.ts) — un `?.` ici masquerait un câblage manquant
				// au lieu d'échouer bruyamment (fix round 1, 2026-09-02).
				ctx.recordReview(qi, rating);
				ctx.commitQuestionInteraction(qi, { syncHeight: true });
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
		ratingButtonsHtml,
		questionCardBodyHtml,
		bindTextOnlyQuestion
	};
}
