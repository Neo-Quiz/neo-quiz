import type { EngineCtx } from "../types/engine-ctx";
import type {
	QuizQuestion,
	QcmQuestion,
	MultiSelectQuestion,
	OrderingQuestion,
	MatchingQuestion,
	TextQuestion,
	ClozeQuestion,
} from "../types/quiz";
import { mathifyElement } from "./mathjax";
import { renderLessonHtml, stripInlineMarkdown } from "./sanitizer";
import { corpsLecture, corpsLectureCourte } from "./passage";
import { t, type TransKey } from "../i18n";

/* Lucide `arrow-left` / `arrow-right`, en SVG inline comme ceux de
   passage.ts : le moteur compose ses cartes en chaînes HTML et n'a pas de
   canal d'icône à cet endroit. */
const ICON_ARROW_LEFT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>';
/* Les icônes du bouton d'aide (Lucide « lightbulb » et « circle-help »). */
/* Lucide book-open : l'onglet d'une lecture de Learn, qui n'a pas de numéro. */
const ICON_LIVRE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>';
const ICON_BULB ='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>';
const ICON_HELP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>';
const ICON_ARROW_RIGHT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';

export interface CardHandlers {
	tabClass(i: number): string;
	navHtml(): string;
	startModeSelectorHtml(): string;
	optionClass(qi: number, oi: number): string;
	optionContentHtml(q: QcmQuestion | MultiSelectQuestion, oi: number): string;
	explanationHtml(qi: number): string;
	renderQuizPromptHtml(q: QuizQuestion): string;
	orderingCardHtml(q: OrderingQuestion, qi: number): string;
	matchingCardHtml(q: MatchingQuestion, qi: number): string;
	submitSlideHtml(): string;
	resultsSlideHtml(): string;
	refreshMetaSlides(opts?: { force?: boolean }): void;
	questionCardHtml(qi: number): string;
}

export function createCardRenderers(ctx: EngineCtx): CardHandlers {
	// Variables locales
	let __quizSubmitSlideSignature = "";
	let __quizResultsSlideSignature = "";

	/* Compteurs : deux clés (« une réponse » / « deux réponses ») choisies ici,
	   jamais un « s » concaténé — l'anglais et le français ne s'accordent pas de
	   la même façon. Le seuil `> 1` reproduit exactement l'accord français
	   d'origine (`n > 1 ? "s" : ""`) ; ces branches ne sont jamais atteintes
	   avec n = 0, où anglais et français divergeraient. */
	const plural = (count: number, one: TransKey, other: TransKey): string =>
		t(count > 1 ? other : one, { count });

	/** Le numéro AFFICHÉ (Q1…Qn), qui saute les lectures absorbées. */
	const numero = (i: number): number => ctx.numeroAffiche?.(i) ?? i + 1;

	/** Classes d'un onglet : son état, et `is-lecture` pour une lecture de
	    Learn sans numéro (un livre) — ici et non dans le gabarit, parce que
	    `updateNavHighlight` (state.ts) réécrit la classe à chaque déplacement. */
	function tabClass(i: number): string {
		return `${numero(i) === 0 ? "is-lecture " : ""}${tabEtat(i)}`.trim();
	}

	function tabEtat(i: number): string {
		const cur = ctx.quizState.current;
		// slideMap[cur].questionIndex n'existe que sur la variante « question » —
		// cast pour lire l'optionnel `?.questionIndex` sans changer le runtime.
		const entry = ctx.slideMap[cur] as { questionIndex?: number } | undefined;
		const isActive = ctx.isQuestionSlideIndex(cur) && entry?.questionIndex === i;
		const active = isActive ? "active" : "";
		// Décision PAR QUESTION (isTextOnlyFor) : en mode Leçon, seul l'onglet
		// d'une question de rôle "recall" doit refléter l'auto-évaluation ; les
		// autres onglets du même quiz restent QCM même si un `qi` voisin est recall.
		if (ctx.textOnly?.isTextOnlyFor?.(i)) {
			const rating = ctx.textOnly.getRatingMeta(ctx.quizState.textOnlyRatings?.[i]);
			if (rating) return `${active} ${rating.className}`.trim();
			if (ctx.textOnly.isChecked(i)) return `${active} checked`.trim();
			if (ctx.textOnly.hasAnyAnswer(i)) return `${active} answered`.trim();
			return active;
		}
		if (!ctx.hasAnyAnswer(i)) return active;
		if (!ctx.quizState.locked) return `${active} answered`.trim();
		return `${active} ${ctx.isCorrect(i) ? "correct" : "wrong"}`.trim();
	}

	function navHtml(): string {
		const resultsActive = (ctx.isSubmitSlideIndex(ctx.quizState.current) || ctx.isResultsSlideIndex(ctx.quizState.current)) ? "active" : "";
		// Un onglet par DIAPOSITIVE : une lecture absorbée n'en a pas, et les
		// numéros la sautent (la question qui la suit devient Q2, pas Q3).
		const onglets = ctx.quiz.map((_, i) => i).filter(i => !ctx.lecturesAbsorbees?.has(i));
		/* Une lecture de Learn restée un écran (style `page`) n'a pas de
		   numéro de question (src/lecture-etape.ts) : son onglet est un livre,
		   nommé par son titre au survol et pour un lecteur d'écran. */
		const onglet = (i: number): string => {
			const n = numero(i);
			if (n > 0) return `<a class="quiz-tab ${tabClass(i)}" href="#" data-nav="${i}">Q${n}</a>`;
			const nom = ctx.escapeHtmlAttr(stripInlineMarkdown(ctx.quiz[i]?.title || t("engine.lesson.roleRead")));
			return `<a class="quiz-tab ${tabClass(i)}" href="#" data-nav="${i}" aria-label="${nom}" title="${nom}">${ICON_LIVRE}</a>`;
		};
		return `<div class="quiz-nav">${onglets.map(onglet).join("")}<a class="quiz-tab is-result ${resultsActive}" href="#" data-nav-results="1">${t("engine.nav.results")}</a></div>`;
	}

	/* Précédente / suivante sous chaque question (2026-09-23) : des ICÔNES
	   seules, le libellé passe en infobulle et en `aria-label` — les onglets
	   Q1…Qn disent déjà où l'on est. Sur la dernière question, la flèche droite
	   mène où mène la touche → (`goPastLastQuestion`, interactions.ts) ; son
	   libellé le dit. Les classes `quiz-prev-btn`/`quiz-next-btn` sont lues par
	   focus.ts pour rendre le focus après un re-rendu. */
	function questionNavHtml(qi: number): string {
		// Première et dernière DIAPOSITIVE de question, pas premier et dernier
		// index : une lecture absorbée en tête ou en fin de tableau n'en a pas.
		const slide = ctx.getSlideIndexForQuestion(qi);
		const isFirst = slide <= 0;
		const isLast = ctx.questionSuivante(qi) === null;
		const nextLabel = t(!isLast
			? "engine.nav.nextQuestion"
			: ctx.textOnly.isExamAnswerPhase() ? "engine.exam.finish" : "engine.nav.results");
		const prevLabel = ctx.escapeHtmlAttr(t("engine.nav.prevQuestion"));
		const nextAttr = ctx.escapeHtmlAttr(nextLabel);
		return `<div class="quiz-question-nav">
			<button class="quiz-nav-btn quiz-prev-btn" type="button" aria-label="${prevLabel}" title="${prevLabel}"${isFirst ? " disabled" : ""}>${ICON_ARROW_LEFT}</button>
			<button class="quiz-nav-btn quiz-next-btn" type="button" aria-label="${nextAttr}" title="${nextAttr}">${ICON_ARROW_RIGHT}</button>
		</div>`;
	}

	/* DEUX modes, et deux seulement (Ahmed, 2026-09-17) : APPRENDRE et se
	   TESTER. « Practice » — les réponses en texte libre — est retiré : la
	   spec du mode Leçon (§6, 2026-08-31) l'avait déjà condamné, et un an plus
	   tard il était toujours là. Apprendre en premier : c'est ce qu'on fait
	   avant de se tester. Le choix vit dans `quizState.startMode`, pas dans
	   `practiceMode` — celui-ci ne sert plus qu'au rôle `recall` d'une leçon. */
	function startModeSelectorHtml(): string {
		const learn = ctx.quizState.startMode === "learn";
		return `<div class="quiz-start-mode-selector" role="group" aria-label="${ctx.escapeHtmlAttr(t("engine.start.selectorAria"))}">
			<button class="quiz-start-mode-option${learn ? " is-active" : ""}" type="button" data-quiz-start-mode="learn" aria-pressed="${learn ? "true" : "false"}">
				<span class="quiz-start-mode-title">${t("engine.start.learnTitle")}</span>
				<span class="quiz-start-mode-sub">${t("engine.start.learnSub")}</span>
			</button>
			<button class="quiz-start-mode-option${!learn ? " is-active" : ""}" type="button" data-quiz-start-mode="exam" aria-pressed="${!learn ? "true" : "false"}">
				<span class="quiz-start-mode-title">${t("engine.start.examTitle")}</span>
				<span class="quiz-start-mode-sub">${t("engine.start.examSub")}</span>
			</button>
		</div>`;
	}

	function optionClass(qi: number, oi: number): string {
		// optionClass n'est appelée que pour des questions QCM/choix multiple
		// (branche else de questionCardHtml) : cast honnête vers l'invariant réel,
		// puis TS narrow QcmQuestion/MultiSelectQuestion via `q.multiSelect`.
		const q = ctx.quiz[qi] as QcmQuestion | MultiSelectQuestion;
		const sel = ctx.quizState.selections[qi];
		if (q.multiSelect) {
			const selected = sel instanceof Set && sel.has(oi);
			if (!ctx.quizState.locked) return selected ? "selected" : "";
			const correct = Array.isArray(q.correctIndices) && q.correctIndices.includes(oi);
			if (selected && correct) return "correct";
			if (selected && !correct) return "wrong";
			if (!selected && correct) return "missed";
			return "";
		}
		const selected = sel === oi;
		if (!ctx.quizState.locked) return selected ? "selected" : "";
		const correct = oi === q.correctIndex;
		if (selected && correct) return "correct";
		if (selected && !correct) return "wrong";
		if (!selected && correct) return "missed";
		return "";
	}

	function explanationHtml(qi: number): string {
		const q = ctx.quiz[qi];
		if (!q) return "";
		const explainHtml = q.explainHtml || q._explainHtml;
		if (explainHtml) {
			return `<div class="quiz-explain ${ctx.isCorrect(qi) ? "good" : "bad"}">${ctx.sanitize.replaceObsidianEmbedsInHtml(explainHtml)}</div>`;
		}
		if (q.explain) {
			return `<div class="quiz-explain ${ctx.isCorrect(qi) ? "good" : "bad"}">${ctx.sanitize.renderTextWithEmbeds(q.explain)}</div>`;
		}
		return "";
	}

	function renderQuizPromptHtml(q: QuizQuestion): string {
		const promptHtml = q.promptHtml || q._promptHtml;
		if (promptHtml) {
			return ctx.sanitize.replaceObsidianEmbedsInHtml(promptHtml);
		}
		if (q.prompt) {
			/* Un texte à trous dont l'énoncé RÉPÈTE le gabarit (un modèle a mis
			   la phrase et ses `{{…}}` dans `prompt` en plus de `cloze`, vu le
			   2026-09-19) : le texte s'affichait deux fois, brut au-dessus des
			   trous. Les paragraphes qui portent un trou sont retirés de
			   l'énoncé ; il ne reste que la consigne. */
			const prompt = (q as { cloze?: unknown }).cloze !== undefined && q.prompt.includes("{{")
				? q.prompt.split(/\n{2,}/).filter(p => !p.includes("{{")).join("\n\n").trim()
				: q.prompt;
			return prompt ? ctx.sanitize.renderTextWithEmbeds(prompt) : "";
		}
		return "";
	}

	function optionContentHtml(q: QcmQuestion | MultiSelectQuestion, oi: number): string {
		let optionContentHtml = "";
		if (q.optionHtml?.[oi]) {
			/* Seul champ `*Html` qui ne passe pas par `replaceObsidianEmbedsInHtml`
			   (il a sa propre résolution de `src`) : il lui faut donc son propre
			   passage au filtre. Une option d'un quiz PARTAGÉ arrive avec le HTML
			   de son auteur, et finit dans le DOM par `innerHTML`.

			   L'ordre : RÉSOUDRE d'abord, assainir ensuite. Une image d'option est
			   écrite avec un chemin nu (`schema.png`), que la liste blanche retire
			   — assainir en premier effaçait donc les images des vieux quiz avant
			   même qu'on puisse les résoudre.

			   Et la résolution passe par le DOM, non par une substitution de
			   chaîne : `/src="…"/g` atteignait aussi le TEXTE d'une option, et
			   `<code>src="schema.png"</code>` — qui parle de code, pas d'image —
			   se faisait réécrire en chemin `app://` (revue codex 2026-07-31).
			   Le `<template>` reste inerte : rien ne se charge pendant qu'on le
			   manipule. */
			const tpl = document.createElement("template");
			tpl.innerHTML = String(q.optionHtml[oi]);
			/* Préfixes DÉJÀ résolus : `app:` sous Obsidian, `asset:` et
			   `http://asset.localhost` sous Tauri. Sans `asset:`, l'app
			   réécrirait une URL déjà bonne au second passage — un défaut qui
			   n'apparaîtrait qu'à l'exécution, dans l'app seulement. Un cas de
			   check-obsidian-host garde cette liste. */
			tpl.content.querySelectorAll("img[src]").forEach(img => {
				const src = img.getAttribute("src") || "";
				if (/^(https?:|data:|app:|asset:|tauri:)/i.test(src)) return;
				/* `ctx.sourcePath` : la note CITANTE. Sans elle, un nom nu
				   (« schema.png ») se résout au hasard des homonymes du vault —
				   et, dans l'application, potentiellement dans un AUTRE dossier
				   que celui de la note. */
				const resolved = ctx.host.links.resourceUrl(src, ctx.sourcePath);
				// Chemin non résoluble : laissé tel quel, la liste blanche tranchera.
				if (resolved) img.setAttribute("src", resolved);
			});
			optionContentHtml = ctx.sanitize.sanitizeQuizHtml(tpl.innerHTML);
		} else {
			optionContentHtml = ctx.sanitize.renderRawHtmlWithEmbeds(q.options[oi], { wrapClass: "quiz-option-embed-wrap", imgClass: "quiz-option-embed" });
		}
		return optionContentHtml;
	}

	function orderingCardHtml(q: OrderingQuestion, qi: number): string {
		const items = ctx.getOrderingItems(q);
		// Question de classement ⇒ sélection à emplacements (indices). Le cast
		// nomme cet invariant : `Array.isArray` ne sépare plus `number[]` de
		// `string[]` depuis l'arrivée du texte à trous.
		const sel = ctx.quizState.selections[qi] as Array<number | null> | undefined;
		const slotLabels = ctx.getOrderingSlotLabels(q);
		const correctOrder = ctx.getOrderingCorrectOrder(q);
		// QCM/ordering → number[] (buildShuffleMap) ; cast erasé, runtime `|| []` intact.
		const shuffled = (ctx.quizState.shuffleMap[qi] as number[]) || [];
		const pick = ctx.quizState.orderingPick[qi];

		const slots = items.map((_, si) => {
			const oi = Array.isArray(sel) ? sel[si] : null;
			const filled = oi !== null;
			let cls = "quiz-slot";
			if (filled) cls += " filled";
			if (!ctx.quizState.locked && pick !== null) cls += " can-place";
			if (ctx.quizState.locked && filled) cls += oi === correctOrder[si] ? " correct" : " wrong";

			return `<div class="${cls}" data-order-slot="${si}" role="button" tabindex="0" ${(!ctx.quizState.locked && filled) ? `draggable="true" data-slot-item="${oi}"` : ""}>
				<div class="quiz-slot-label">${ctx.sanitize.renderInlineText(slotLabels[si] ?? String(si + 1))}</div>
				<div class="quiz-slot-value">${filled ? ctx.sanitize.renderInlineText(items[oi]) : t("engine.ordering.dropHere")}</div>
			</div>`;
		}).join("");

		const possibilities = shuffled.map(oi => {
			const used = ctx.orderingSelectionIncludes(qi, oi);
			const picked = !used && pick === oi && !ctx.quizState.locked;
			let cls = "quiz-possibility";
			if (used) cls += " used";
			if (picked) cls += " selected-pick";

			return `<div class="${cls}" data-order-item="${oi}" role="button" tabindex="0" ${(!used && !ctx.quizState.locked) ? `draggable="true"` : ""}>
				${ctx.sanitize.renderInlineText(items[oi])}
			</div>`;
		}).join("");

		return `<div class="quiz-multi-indicator">${t("engine.ordering.instructions")}</div>
		<div class="quiz-ordering">
			<div class="quiz-ordering-slots">${slots}</div>
			<div class="quiz-ordering-label">${t("engine.ordering.itemsLabel")}</div>
			<div class="quiz-ordering-possibilities">${possibilities}</div>
		</div>`;
	}

	function matchingCardHtml(q: MatchingQuestion, qi: number): string {
		const rows = ctx.getMatchRows(q);
		const choices = ctx.getMatchChoices(q);
		const correctMap = ctx.getMatchCorrectMap(q);
		// Idem orderingCardHtml : question d'association ⇒ indices.
		const sel = ctx.quizState.selections[qi] as Array<number | null> | undefined;
		// Matching → { rows, choices } (buildShuffleMap) ; cast erasé, runtime `|| {}` intact.
		const shuffleData = (ctx.quizState.shuffleMap[qi] || {}) as { rows?: number[]; choices?: number[] };
		const shuffledRows = Array.isArray(shuffleData.rows) ? shuffleData.rows : [...Array(rows.length).keys()];
		const shuffledChoices = Array.isArray(shuffleData.choices) ? shuffleData.choices : [...Array(choices.length).keys()];
		const pick = ctx.quizState.matchPick[qi];

		const slots = shuffledRows.map(rowIndex => {
			const chosen = Array.isArray(sel) ? sel[rowIndex] : null;
			const filled = chosen !== null;
			let cls = "quiz-slot";
			if (filled) cls += " filled";
			if (!ctx.quizState.locked && pick !== null) cls += " can-place";
			if (ctx.quizState.locked && filled && Array.isArray(correctMap) && correctMap.length === rows.length) {
				cls += chosen === correctMap[rowIndex] ? " correct" : " wrong";
			}

			return `<div class="${cls}" data-match-slot="${rowIndex}" role="button" tabindex="0" ${(!ctx.quizState.locked && filled) ? `draggable="true" data-slot-choice="${chosen}"` : ""}>
				<div class="quiz-slot-label">${ctx.sanitize.renderInlineText(rows[rowIndex])}</div>
				<div class="quiz-slot-value">${filled ? ctx.sanitize.renderInlineText(choices[chosen] ?? t("engine.matching.unknownChoice")) : t("engine.matching.dropHere")}</div>
			</div>`;
		}).join("");

		const possibilities = shuffledChoices.map(ci => {
			const picked = !ctx.quizState.locked && pick === ci;
			let cls = "quiz-possibility";
			if (picked) cls += " selected-pick";

			return `<div class="${cls}" data-match-choice="${ci}" role="button" tabindex="0" ${!ctx.quizState.locked ? `draggable="true"` : ""}>
				${ctx.sanitize.renderInlineText(choices[ci])}
			</div>`;
		}).join("");

		return `<div class="quiz-multi-indicator">${t("engine.matching.instructions")}</div>
		<div class="quiz-ordering">
			<div class="quiz-ordering-slots">${slots}</div>
			<div class="quiz-ordering-label">${t("engine.matching.choicesLabel")}</div>
			<div class="quiz-ordering-possibilities">${possibilities}</div>
		</div>`;
	}

	/* FIX round 1 (revue, Task 6c) : `getMissingIndices()` exclut déjà "read"
	   (state.ts), mais son complément — la liste affichée quand RIEN ne
	   manque — était calculé en dur ici via `ctx.quiz.map((_, i) => i)`, sans
	   passer par le même filtre. Un quiz Leçon entièrement traité voyait donc
	   sa carte "read" revenir en pastille "Q3" sur l'écran de soumission,
	   comme s'il restait quelque chose à y traiter — exactement ce que Task
	   6b avait déjà réglé côté score/complétude mais pas ici. Une seule
	   fonction pour les trois écrans (QCM, auto-évaluation, réponse libre en
	   examen) : il n'y a qu'UNE notion de "question à revoir" sur cette carte. */
	function reviewableIndices(): number[] {
		return ctx.quiz.map((_, i) => i).filter(i => !ctx.lecturesAbsorbees?.has(i) && !(ctx.isLessonMode() && ctx.roleOfQuestion(i) === "read"));
	}

	function submitSlideHtml(): string {
		const missing = ctx.getMissingIndices();
		const mc = missing.length;
		if (ctx.textOnly?.isTextOnlyMode?.()) {
			if (ctx.textOnly.isExamAnswerPhase?.()) {
				// Même garde "read" que reviewableIndices : hasAnyAnswer d'une
				// carte "read" est toujours faux (elle n'écrit jamais dans
				// textOnlyAnswers), donc sans l'exclusion explicite elle
				// retomberait en "manquante" ici alors qu'il n'y a rien à répondre.
				const missingAnswers = reviewableIndices()
					.filter(i => !ctx.textOnly.hasAnyAnswer(i));
				const mac = missingAnswers.length;
				const intro = mac > 0
					? `<div class="quiz-warn">${plural(mac, "engine.submit.missingFreeAnswers.one", "engine.submit.missingFreeAnswers.other")}</div><div class="quiz-submit-sub">${t("engine.submit.missingList")}</div>`
					: `<div class="quiz-submit-sub">${t("engine.submit.allFreeAnswered")}</div>`;
				return `<div class="quiz-track-item" data-slide-kind="submit"><div class="quiz-submit-wrap"><div class="quiz-submit-card">${intro}<div class="quiz-chip-row">${(mac > 0 ? missingAnswers : reviewableIndices()).map(i => `<button class="quiz-chip ${mac > 0 ? "missing" : ""}" type="button" data-jump="${i}">Q${numero(i)}</button>`).join("")}</div><div class="quiz-actions"><button class="quiz-action-btn quiz-back-btn" type="button">${t("engine.submit.back")}</button><button class="quiz-action-btn success quiz-show-score-btn" type="button">${t("engine.exam.finish")}</button></div></div></div></div>`;
			}

			const intro = mc > 0
				? `<div class="quiz-warn">${plural(mc, "engine.submit.missingRatings.one", "engine.submit.missingRatings.other")}</div><div class="quiz-submit-sub">${t("engine.submit.toRateList")}</div>`
				: `<div class="quiz-submit-sub">${t("engine.submit.allRated")}</div>`;
			return `<div class="quiz-track-item" data-slide-kind="submit"><div class="quiz-submit-wrap"><div class="quiz-submit-card">${intro}<div class="quiz-chip-row">${(mc > 0 ? missing : reviewableIndices()).map(i => `<button class="quiz-chip ${mc > 0 ? "missing" : ""}" type="button" data-jump="${i}">Q${numero(i)}</button>`).join("")}</div><div class="quiz-actions"><button class="quiz-action-btn quiz-back-btn" type="button">${t("engine.submit.back")}</button><button class="quiz-action-btn success quiz-show-score-btn" type="button">${t("engine.submit.showResults")}</button></div></div></div></div>`;
		}
		return `<div class="quiz-track-item" data-slide-kind="submit"><div class="quiz-submit-wrap"><div class="quiz-submit-card">${mc > 0 ? `<div class="quiz-warn">${plural(mc, "engine.submit.missingAnswers.one", "engine.submit.missingAnswers.other")}</div><div class="quiz-submit-sub">${t("engine.submit.missingList")}</div>` : `<div class="quiz-submit-sub">${t("engine.submit.reviewList")}</div>`}<div class="quiz-chip-row">${(mc > 0 ? missing : reviewableIndices()).map(i => `<button class="quiz-chip ${mc > 0 ? "missing" : ""}" type="button" data-jump="${i}">Q${numero(i)}</button>`).join("")}</div><div class="quiz-actions"><button class="quiz-action-btn quiz-back-btn" type="button">${t("engine.submit.back")}</button><button class="quiz-action-btn success quiz-show-score-btn" type="button">${t("engine.submit.showScore")}</button></div></div></div></div>`;
	}

	function saveResultsButtonHtml(): string {
		const savedPath = ctx.quizState.savedResultsPath;
		const saved = !!savedPath;
		// Garde sur `savedPath` (et non sur `saved`, sa copie booléenne) : même
		// condition au runtime, mais TS narrow ici string|null → string, ce
		// qu'exige le typage des variables de t().
		const titleAttr = savedPath ? ` title="${ctx.escapeHtmlAttr(t("engine.result.savedIn", { path: savedPath }))}"` : "";
		return `<button class="quiz-action-btn quiz-save-results-btn${saved ? " is-saved" : ""}" type="button" data-save-results="1"${saved ? " disabled" : ""}${titleAttr}>${t(saved ? "engine.result.saved" : "engine.result.save")}</button>`;
	}

	function resultsSlideHtml(): string {
		// isTextOnlyForAll (pas isTextOnlyMode) : FINDING 2, round 1 de revue Task
		// 5 — une Lecon entierement composee de questions "recall" doit voir la
		// grille compris/partiel/a revoir, pas un pourcentage QCM qui ne reflete
		// rien de ce qu'elle vient de faire. isTextOnlyMode() seule restait
		// fausse en Lecon (practiceMode y reste "qcm"), meme quand AUCUNE
		// question de la session n'a de vraie correction.
		if (ctx.textOnly?.isTextOnlyForAll?.()) {
			const results = ctx.textOnly.computeResults();
			const isExamCorrection = ctx.isExamMode && ctx.examEnded;
			const title = t(isExamCorrection ? "engine.result.freeTextCorrection" : "engine.result.trainingTitle");
			const correctionHint = isExamCorrection && results.pending > 0
				? `<p class="quiz-textonly-correction-hint">${t("engine.result.correctionHint")}</p>`
				: "";
			const correctionBtn = isExamCorrection && results.pending > 0
				? `<button class="quiz-action-btn quiz-review-answers-btn" type="button">${t("engine.result.reviewAnswers")}</button>`
				: "";
			// Le compteur « rated/total » reste du code (mise en forme <strong>) :
			// seule l'étiquette est traduite.
			// Une carte par réponse écrite (2026-09-26bis) : réponse donnée, bonne
			// réponse, explication, verdict juste/faux — jamais un champ seul,
			// coloré, sans rien (retour #11). Rendue ICI, sur les résultats,
			// même quand cette tranche affiche déjà la grille compris/partiel/
			// à revoir (legacy `practiceMode: "text"`).
			const writtenReview = ctx.textOnly.writtenReviewSectionHtml();
			return `<div class="quiz-track-item" data-slide-kind="results"><section class="quiz-result quiz-textonly-result"><h2 class="quiz-result-title" style="font-weight:900;">${title}</h2><p>${t("engine.result.ratedLabel")} <strong>${results.rated}/${results.total}</strong></p>${correctionHint}<div class="quiz-textonly-result-grid"><div class="quiz-textonly-result-stat understood"><strong>${results.understood}</strong><span>${t("engine.rating.understood")}</span></div><div class="quiz-textonly-result-stat partial"><strong>${results.partial}</strong><span>${t("engine.rating.partial")}</span></div><div class="quiz-textonly-result-stat review"><strong>${results.review}</strong><span>${t("engine.rating.review")}</span></div>${results.pending > 0 ? `<div class="quiz-textonly-result-stat pending"><strong>${results.pending}</strong><span>${t(results.pending > 1 ? "engine.result.pending.other" : "engine.result.pending.one")}</span></div>` : ""}</div>${writtenReview}<div class="quiz-actions">${correctionBtn}${saveResultsButtonHtml()}<button class="quiz-action-btn success quiz-retry-btn" type="button">${t("engine.result.retry")}</button></div></section></div>`;
		}
		const { pct, correct, total, pendingWritten } = ctx.computeScorePercent();
		// Mode leçon : bouton "Passer l'examen"
		const lessonExamBtn = (ctx.quizMode === "lesson" && ctx.lessonExamOptions)
			? `<button class="quiz-action-btn quiz-exam-btn" type="button">${t("engine.result.takeExam")}</button>`
			: "";
		// Mode examen issu du mode leçon : bouton "Repasser l'examen"
		const retakeExamBtn = (ctx.quizMode === "exam" && ctx.originalQuizMode === "lesson" && ctx.originalLessonExamOptions)
			? `<button class="quiz-action-btn quiz-exam-btn" type="button">${t("engine.result.retakeExam")}</button>`
			: "";
		// Le score n'inclut pas les réponses écrites pas encore auto-évaluées
		// (computeScorePercent les exclut déjà de correct/total) : le dire
		// clairement plutôt que de les compter fausses.
		const pendingNote = pendingWritten > 0
			? `<p class="quiz-textonly-correction-hint">${t(pendingWritten > 1 ? "engine.result.pendingWritten.other" : "engine.result.pendingWritten.one", { count: pendingWritten })}</p>`
			: "";
		const writtenReview = ctx.textOnly.writtenReviewSectionHtml();
		// Le score (« 12/20 », « 60 % ») reste du code : seule l'étiquette est traduite.
		return `<div class="quiz-track-item" data-slide-kind="results"><section class="quiz-result"><h2 class="quiz-result-title" style="font-weight:900;">${t("engine.result.title")}</h2><p style="font-size:48px;font-weight:900;margin:18px 0 6px;">${pct}%</p><p>${t("engine.result.correctLabel")} <strong>${correct}/${total}</strong></p>${pendingNote}${writtenReview}<div class="quiz-actions">${saveResultsButtonHtml()}<button class="quiz-action-btn success quiz-retry-btn" type="button">${t("engine.result.retry")}</button>${lessonExamBtn}${retakeExamBtn}</div></section></div>`;
	}


	function refreshMetaSlides({ force = false }: { force?: boolean } = {}): void {
		const nextSubmitSignature = ctx.getSubmitSlideSignature();
		const nextResultsSignature = ctx.getResultsSlideSignature();
		const shouldRefreshSubmit = force || nextSubmitSignature !== __quizSubmitSlideSignature;
		const shouldRefreshResults = force || nextResultsSignature !== __quizResultsSlideSignature;
		if (!shouldRefreshSubmit && !shouldRefreshResults) return;

		const refreshMetaSlide = ({ selector, index, html, binder }: { selector: string; index: number; html: () => string; binder: (node: Element) => void }) => {
			const oldNode = ctx.container.querySelector(selector);
			if (!oldNode) return;
			ctx.viewport.unobserveTrackItemInAllSlidesResizeObserver(oldNode);
			ctx.bumpSlideGeneration(index);
			const tmp = document.createElement("div");
			tmp.innerHTML = html().trim();
			// La slide meta est toujours un div racine (HTMLElement) : cast pour mathifyElement.
			const newNode = tmp.firstElementChild as HTMLElement | null;
			if (!newNode) return;
			oldNode.replaceWith(newNode);
			// LaTeX des slides submit/results (récap des réponses).
			mathifyElement(newNode);
			ctx.viewport.observeTrackItemInAllSlidesResizeObserver(newNode);
			binder(newNode);
		};

		if (shouldRefreshSubmit) {
			refreshMetaSlide({
				selector: '.quiz-track-item[data-slide-kind="submit"]',
				index: ctx.SLIDE_SUBMIT_INDEX,
				html: submitSlideHtml,
				binder: ctx.interactions.bindSubmitSlideControls
			});
			__quizSubmitSlideSignature = nextSubmitSignature;
		}
		if (shouldRefreshResults) {
			refreshMetaSlide({
				selector: '.quiz-track-item[data-slide-kind="results"]',
				index: ctx.SLIDE_RESULTS_INDEX,
				html: resultsSlideHtml,
				binder: ctx.interactions.bindResultsSlideControls
			});
			__quizResultsSlideSignature = nextResultsSignature;
		}

		ctx.viewport.applyTrackGeometry({ refreshWidth: false });
		ctx.viewport.syncTrackViewportIsolation();
		const { track } = ctx.viewport.getTrackElements();
		if (track && (ctx.quizState.current === ctx.SLIDE_SUBMIT_INDEX || ctx.quizState.current === ctx.SLIDE_RESULTS_INDEX)) {
			track.style.transition = "none";
			ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(ctx.quizState.current));
			ctx.viewport.__quizSlideHeightCache?.delete(ctx.quizState.current);
			ctx.viewport.scheduleViewportHeightSync({ index: ctx.quizState.current, animate: false, refresh: true });
		}
	}

	/* PLUS DE PASTILLE DE RÔLE en tête de carte (2026-09-26 : « retire toutes
	   les pastilles, ça ne sert à rien ») : « Avant la lecture », « Lecture »,
	   « Avec vos mots », « De mémoire » ne s'affichent plus pendant le quiz. Le
	   rôle reste une classe de la carte (`quiz-role-*`) pour la mise en page. */

	function questionCardHtml(qi: number): string {
		// Le budget de coloration des blocs de code (code-highlight.ts) n'est
		// PLUS remis à zéro ici (retiré au tour 4) : cette fonction est appelée
		// une fois PAR CARTE dans une boucle (engine.ts, `slideMap.map`), et un
		// reset ici redonnait un budget plein à CHAQUE carte — un quiz de
		// 50 questions coloriait donc jusqu'à 50 fois le budget voulu (8,4 s
		// mesurés). Le reset vit maintenant au niveau du RENDU COMPLET
		// (engine.ts, avant `slideMap.map` et dans `refreshQuestionSlide`).
		const q = ctx.quiz[qi];
		// Rôle "read" (Task 6c) : étape de LECTURE du support, sans rien à
		// répondre. `isLessonMode()` garde cette branche fermée sur les quiz
		// ordinaires (roleOfQuestion lit `q.role` sans condition de mode, donc
		// resterait exploitable même hors Leçon si un champ `role` traînait).
		const isRead = ctx.isLessonMode() && ctx.roleOfQuestion(qi) === "read";
		// Décision PAR QUESTION : une tranche de Leçon mélange des rôles ("test"
		// en QCM à côté de "recall" en réponse libre) — jamais un bascule globale.
		const isTextOnly = !isRead && ctx.textOnly?.isTextOnlyFor?.(qi);
		const isTxt = ctx.isTextQuestion(q);
		const isCloze = ctx.isClozeQuestion(q);
		const isOrd = ctx.isOrderingQuestion(q);
		const isMatch = ctx.isMatchingQuestion(q);
		// q.multiSelect n'existe que sur QCM/choix multiple : lecture uniforme via
		// cast (undefined→false pour les autres variantes, jamais lu hors branche QCM).
		const isMulti = !!(q as { multiSelect?: boolean }).multiSelect;

		let body = "";

		// Carte "read" (Task 6c) : `body` reste `""` — aucun contrôle, ni
		// options, ni champ, ni bouton de validation — le support
		// (passageSection, plus bas) porte tout le contenu à lire. La cascade
		// QCM/texte/ordering/matching/cloze ci-dessous est entièrement sautée
		// (pas de branche `if (isRead) {}` vide : `!isRead` en tête suffit).
		if (!isRead && isTextOnly) {
			body = ctx.textOnly.questionCardBodyHtml(q, qi);
		}
		// Casts guidés par les prédicats isTxt/isOrd/isMatch (évalués en amont,
		// iso-fonctionnels) : la branche garantit la variante, le cast la nomme.
		else if (!isRead && isCloze) {
			body = ctx.cloze.clozeCardHtml(q as ClozeQuestion, qi);
		}
		else if (!isRead && isTxt) {
			body = ctx.terminal.textQuestionCardHtml(q as TextQuestion, qi);
		}
		else if (!isRead && isOrd) {
			body = orderingCardHtml(q as OrderingQuestion, qi);
		}
		else if (!isRead && isMatch) {
			body = matchingCardHtml(q as MatchingQuestion, qi);
		}
		else if (!isRead) {
			const qcm = q as QcmQuestion | MultiSelectQuestion;
			const smap = (ctx.quizState.shuffleMap[qi] as number[]) || [];
			const mi = isMulti ? `<div class="quiz-multi-indicator">${t("engine.qcm.multiHint")}</div>` : "";
			const sel = ctx.quizState.selections[qi];
			const optionsHtml = smap.map((oi) => {
				const contentHtml = optionContentHtml(qcm, oi);
				// aria-pressed reflète l'état sélectionné pour les lecteurs d'écran (recalculé
				// à chaque refreshQuestionSlide). role=button + aria-pressed plutôt que radio/
				// checkbox pour ne pas capturer les flèches (réservées à la navigation).
				const isSelected = isMulti ? (sel instanceof Set && sel.has(oi)) : (sel === oi);
				return `<div class="quiz-option ${isMulti ? "multi" : ""} ${optionClass(qi, oi)}" role="button" tabindex="0" aria-pressed="${isSelected}" data-orig="${oi}">${contentHtml}</div>`;
			}).join("");
			const hasImg = /<img[\s>]/i.test(optionsHtml);
			body = mi + `<div class="quiz-options-wrap${hasImg ? " quiz-options-image-grid" : ""}">${optionsHtml}</div>`;
		}

		/* UN SEUL BOUTON D'AIDE, qui monte d'un cran (2026-09-26) : « Indice »
		   tant que l'indice n'a pas été révélé ; révélé, l'indice reste AFFICHÉ
		   sous la question (il se relit sans rouvrir de fenêtre) et le bouton
		   devient « Je ne sais pas » là où il existe, disparaît ailleurs.
		   Chercher, se faire aider, puis seulement abandonner. */
		const aIndice = !isRead && !isTextOnly && !!(q.hint && String(q.hint).trim());
		const indiceVu = aIndice && !!ctx.quizState.hintSeen?.[qi];
		const hintBtn = aIndice && !indiceVu ? `<button class="quiz-help-btn quiz-hint-btn" type="button">${ICON_BULB}<span>${t("engine.hint.button")}</span></button>` : "";
		const indiceHtml = indiceVu
			? `<div class="quiz-hint-inline"><div class="quiz-hint-inline-label">${ICON_BULB}<span>${t("engine.hint.button")}</span></div><div class="quiz-hint-inline-body">${ctx.sanitize.renderHintWithCodeAndEmbeds(q.hint)}</div></div>`
			: "";
		// Task 7 (mode Lesson) : « Je ne sais pas » sur une pré-question — une
		// tentative VIDE mais EXPLICITE. Passer à la suite sans répondre donne
		// désormais le même verdict (engine/state.ts marquerPreNonTentees). Gardée par !ctx.quizState.locked comme hintBtn/
		// lessonContent : un quiz déjà soumis n'a plus rien à "laisser passer".
		// Round 1 de revue (Finding 4) : masqué dès que lessonPreSkipped[qi] est
		// déjà vrai — sur la DERNIÈRE question (aucune navigation suivante
		// possible), le clic ne produisait sinon aucun effet visible ; sa
		// disparition EST l'effet visible attendu, en plus du re-rendu qui la
		// déclenche (interactions.ts markLessonPreSkipped).
		const dontKnowBtn = (!hintBtn && !isRead && !isTextOnly && ctx.isLessonMode() && ctx.roleOfQuestion(qi) === "pre" && !ctx.quizState.locked && !ctx.quizState.lessonPreSkipped[qi])
			? `<button class="quiz-help-btn quiz-lesson-dontknow-btn" type="button">${ICON_HELP}<span>${t("engine.lesson.dontKnow")}</span></button>`
			: "";
		// Mode leçon (ex "learn") : la leçon s'affiche AVANT que la question soit
		// verrouillée, jamais après (revoir la leçon une fois corrigé n'a pas de
		// sens). Classes CSS `quiz-learn-*` conservées telles quelles. Une carte
		// "read" n'a rien à corriger : ce bloc n'a pas de sens dessus non plus.
		const lessonContent = (!isRead && !isTextOnly && ctx.quizMode === "lesson" && !ctx.quizState.locked)
			? renderLessonHtml(q, ctx.sanitize)
			: "";
		const learnSection = lessonContent
			? `<div class="quiz-learn-section"><div class="quiz-learn-label">${t("engine.lesson.label")}</div><div class="quiz-learn-content">${lessonContent}</div></div>`
			: "";
		// La barre précédente/suivante est posée sous TOUTE carte : la carte
		// "read" n'a rien à valider et n'a qu'elle pour passer à la suite.
		const sectionIdAttr = (typeof q?.id === "string" && q.id.trim().length > 0)
			? ` id="${ctx.escapeHtmlAttr(q.id)}"`
			: "";

		// Le support de compréhension précède le titre : on lit le document AVANT
		// de savoir ce qu'on nous en demande, comme sur un sujet d'examen papier.
		// En Learn, c'est aussi là que s'affiche le cours de l'étape, replié
		// tant que la question n'est pas répondue (2026-09-26) — décision
		// tranchée par `passageVisibility` (engine/passage.ts), jamais
		// recalculée ici.
		const passageSection = ctx.passage.passageHtml(qi);

		/* Classe de RÔLE sur la carte : le CSS doit pouvoir distinguer une carte
		   de LECTURE des autres. Sur une carte "read", le support de cours EST
		   le contenu — il ne peut donc pas défiler dans une boîte, sous peine
		   de couper la lecture en deux (règle posée par Ahmed le 2026-09-02 :
		   « ici on ne doit jamais avoir à scroller, ça déconcentre »). Ailleurs
		   le support n'est qu'une référence à côté d'une question, et son
		   plafond de hauteur garde tout son sens. */
		const roleClass = ctx.isLessonMode() ? ` quiz-role-${ctx.roleOfQuestion(qi)}` : "";

		/* Une LECTURE a son propre écran (2026-09-26), dans son style
		   (`corpsLecture`, engine/passage.ts). Son titre est écrit DANS la
		   page (serif, maquette B) : le `<h2>` de la carte n'est alors pas posé. */
		const promptHtml = renderQuizPromptHtml(q);
		const lecture = isRead ? corpsLecture(ctx, q, String(q.prompt ?? ""), promptHtml, String(q.title ?? "")) : null;

		/* Une lecture COURTE n'a pas d'écran : elle se lit ouverte, en version
		   légère, sans cadre, au-dessus de sa question hôte, et nulle part
		   ailleurs (src/lecture-etape.ts `lecturesCourtes`). */
		const iCourte = ctx.lectureCourteDe?.(qi) ?? null;
		let courteHtml = "";
		if (iCourte !== null) {
			const l = ctx.quiz[iCourte];
			const lHtml = l.promptHtml || l._promptHtml;
			const texte = lHtml ? ctx.sanitize.replaceObsidianEmbedsInHtml(lHtml) : ctx.sanitize.renderTextWithEmbeds(String(l.prompt ?? ""));
			courteHtml = corpsLectureCourte(ctx, l, String(l.prompt ?? ""), texte).html;
		}

		return `<div class="quiz-track-item${roleClass}" data-slide-kind="question" data-qi="${qi}">
			<section class="quiz-card"${sectionIdAttr}${lecture ? ` data-lecture="${lecture.style}"` : ""}>
				${passageSection}
				${courteHtml}
				${lecture ? "" : `<h2>${ctx.sanitize.renderInlineText(q.title)}</h2>`}
				${ctx.sanitize.resourceButtonHtml(q)}
				<div class="quiz-question">${lecture ? lecture.html : promptHtml}</div>
				${body}
				${learnSection}
				${indiceHtml}
				${hintBtn}
				${dontKnowBtn}
				${!isRead && !isTextOnly && ctx.quizState.locked ? explanationHtml(qi) : ""}
				${questionNavHtml(qi)}
			</section>
		</div>`;
	}

	return {
		tabClass,
		navHtml,
		startModeSelectorHtml,
		optionClass,
		optionContentHtml,
		explanationHtml,
		renderQuizPromptHtml,
		orderingCardHtml,
		matchingCardHtml,
		submitSlideHtml,
		resultsSlideHtml,
		refreshMetaSlides,
		questionCardHtml
	};
}
