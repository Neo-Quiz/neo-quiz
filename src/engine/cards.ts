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
import { drawOrder, stepMembers, stepBeadState, type StepSlide } from "./step-page";

/* Lucide `arrow-left` / `arrow-right`, en SVG inline comme ceux de
   passage.ts : le moteur compose ses cartes en chaînes HTML et n'a pas de
   canal d'icône à cet endroit. */
const ICON_ARROW_LEFT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>';
/* Les icônes du bouton d'aide (Lucide « lightbulb » et « circle-help »). */
/* Lucide book-open : l'onglet d'une lecture de Learn, qui n'a pas de numéro. */
const ICON_LIVRE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>';
const ICON_BULB ='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>';
const ICON_HELP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>';
/* Lucide flag : l'onglet « Résultats » quand la navigation est une frise de
   perles (l'application, `perles.css`) ; masqué ailleurs (nav-tabs.css). */
const ICON_DRAPEAU = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>';
/* Lucide trophy: the same tab once the quiz is handed in (2026-09-30) — the
   score is there to see again, the flag of the finish line is behind. */
const ICON_TROPHEE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>';
/** How long the flag takes to become the trophy (nav-tabs.css, the same duration). */
const DUREE_ARRIVEE_MS = 900;
/* Lucide triangle-alert / circle-check: the end screen, depending on whether
   questions remain. */
const ICON_TRIANGLE_ALERTE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
const ICON_CERCLE_OK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';
const ICON_ARROW_RIGHT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';

/** THE HINT BADGE (spec 2026-09-29-test-practice-exam-design §2.3): a dot
    whose question used its hint carries the Hint button's bulb IN ADDITION to
    its verdict mark (✓, ↻, ✗): `used-hint`, the bulb drawn in `::after` at the
    top left by nav-tabs.css, the mark staying in `::before` at the top right.
    Only on a dot that HAS a verdict mark; its colour still follows the result.
    Test and Learn alike. PURE, so that check:engine-review holds it. */
export function withHintBadge(etat: string, hintUsed: boolean): string {
	if (!hintUsed || !/(^|\s)(correct|retried|wrong)(\s|$)/.test(etat)) return etat;
	return `${etat} used-hint`;
}

export interface CardHandlers {
	tabClass(i: number): string;
	/** Accessible name of the numbered tab `i`, rebuilt from its state. */
	tabLabel(i: number): string;
	navHtml(): string;
	navPosition(): number;
	/** The last tab of the row: its classes (without `active`), its content,
	    and which of its two states it is — read by `updateNavHighlight`. */
	resultTab(): { cls: string; html: string; etat: "finish" | "scored"; style: string };
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
	stepSlideHtml(step: StepSlide): string;
	/** One card of a step page (a `section`), for a repaint in place. */
	stepCardHtml(qi: number): string;
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
	/** The number of the BEAD of card `i` (a step's page number, else `numero`). */
	const beadNumero = (i: number): number => stepOrdinal(i) ?? numero(i);

	/** In a step-page Learn a bead stands for a STEP: it is named by the
	    page's number, and `i` is the page's first card. */
	function stepOrdinal(i: number): number | null {
		const page = ctx.stepSlides?.find(p => stepMembers(p)[0] === i);
		return page ? page.step : null;
	}

	/** Classes d'un onglet : son état, et `is-lecture` pour une lecture de
	    Learn sans numéro (un livre) — ici et non dans le gabarit, parce que
	    `updateNavHighlight` (state.ts) réécrit la classe à chaque déplacement. */
	function tabClass(i: number): string {
		const n = beadNumero(i);
		/* `is-repere` : une question sur cinq (Q5, Q10…), qui garde son numéro
		   quand la frise de perles de l'application passe en points
		   (`perles.css`). Sans effet sur les onglets du greffon. */
		const etat = withHintBadge(tabEtat(i), !!ctx.quizState.hintSeen?.[i]);
		return `${n === 0 ? "is-lecture " : n % 5 === 0 ? "is-repere " : ""}${etat}`.trim();
	}

	/** The accessible name of a numbered tab, from the state string `tabClass`
	    returns; any class it does not know gives the plain "Question N". */
	function tabLabel(i: number): string {
		const cls = ` ${tabClass(i)} `;
		const n = beadNumero(i);
		const has = (c: string): boolean => cls.includes(` ${c} `);
		const key: TransKey | null = has("correct") ? "engine.nav.tabCorrect"
			: has("retried") ? "engine.nav.tabRetried"
			: has("wrong") ? "engine.nav.tabWrong"
			: has("answered") ? "engine.nav.tabAnswered"
			: null;
		const base = key ? t(key, { n }) : t("engine.nav.tab", { n });
		return has("used-hint") ? t("engine.nav.tabWithHint", { label: base }) : base;
	}

	function tabEtat(i: number): string {
		const cur = ctx.quizState.current;
		// slideMap[cur].questionIndex n'existe que sur la variante « question » —
		// cast pour lire l'optionnel `?.questionIndex` sans changer le runtime.
		const entry = ctx.slideMap[cur] as { questionIndex?: number } | undefined;
		const isActive = ctx.isQuestionSlideIndex(cur) && entry?.questionIndex === i;
		const active = isActive ? "active" : "";
		const page = ctx.stepSlides?.find(p => stepMembers(p)[0] === i);
		if (page) {
			// The bead of a step: its graded questions' verdicts, as one.
			const graded = page.questions.filter(qi => ctx.learn.isGraded(qi));
			const touched = page.questions.some(qi => ctx.hasAnyAnswer(qi));
			return `${active} ${stepBeadState(graded.map(qi => ctx.learn.verdictOf(qi)), touched)}`.trim();
		}
		/* THE LEARN VERDICT comes first (engine/learn.ts, 2026-09-29): green =
		   right the first time, orange = right after a miss, red = not right
		   yet. It outlives the lock too: after the results, a retried question
		   stays orange, never "correct" by its last answer alone. */
		const verdict = ctx.learn.verdictOf(i);
		if (verdict !== "none") return `${active} ${verdict === "first" ? "correct" : verdict === "retried" ? "retried" : "wrong"}`.trim();
		// A Learn `pre` question is a guess by design: never green nor red,
		// not even once the results lock the quiz.
		if (ctx.learn.isCheckable(i) && !ctx.learn.isGraded(i)) return `${active} ${ctx.hasAnyAnswer(i) ? "answered" : ""}`.trim();
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
		if (!ctx.isRevealed(i)) return `${active} answered`.trim();
		// A checked `pre` question has no verdict: it stays "answered".
		if (!ctx.quizState.locked) return `${active} answered`.trim();
		return `${active} ${ctx.isCorrect(i) ? "correct" : "wrong"}`.trim();
	}

	/** Un onglet par DIAPOSITIVE : une lecture absorbée n'en a pas, et les
	    numéros la sautent (la question qui la suit devient Q2, pas Q3). */
	function ongletsNav(): number[] {
		if (ctx.stepSlides) return ctx.stepSlides.map(p => stepMembers(p)[0]);
		return ctx.quiz.map((_, i) => i).filter(i => !ctx.lecturesAbsorbees?.has(i));
	}

	/** Où en est-on dans la rangée d'onglets, de 0 (le premier) à 1
	    (« Résultats ») : la longueur du fil rempli quand la navigation est une
	    frise de perles (`--quiz-nav-pos`, `perles.css` de l'application). Même
	    règle d'onglet courant que `tabEtat`. */
	function navPosition(): number {
		const cur = ctx.quizState.current;
		if (ctx.isSubmitSlideIndex(cur) || ctx.isResultsSlideIndex(cur)) return 1;
		const onglets = ongletsNav();
		const entry = ctx.slideMap[cur] as { questionIndex?: number } | undefined;
		const k = ctx.isQuestionSlideIndex(cur) && entry?.questionIndex !== undefined ? onglets.indexOf(entry.questionIndex) : -1;
		return k > 0 ? k / onglets.length : 0;
	}

	/* The last tab has TWO states (2026-09-30): while the quiz is being done,
	   the flag of the finish line ("Finish"); once handed in and the score
	   seen, a trophy ("Results") in the accent colour — the corrections are
	   being read, the score is one click away. */
	function resultTab(): { cls: string; html: string; etat: "finish" | "scored"; style: string } {
		const etat = ctx.quizState.locked ? "scored" : "finish";
		/* THE CHANGE IS ANIMATED (nav-tabs.css `.is-arrivee`): the green
		   flag gives way to the gold trophy. The row is rebuilt a few frames
		   after the lock (`ctx.render()`, track.ts), which would restart or
		   cut the animation: the time already played goes on each new tab as
		   a NEGATIVE delay (`--arrivee`), so it carries on where it was. */
		if (etatVu === "finish" && etat === "scored") arriveeDebut = performance.now();
		etatVu = etat;
		const ecoule = performance.now() - arriveeDebut;
		const arrivee = etat === "scored" && arriveeDebut > 0 && ecoule < DUREE_ARRIVEE_MS;
		const style = arrivee ? `--arrivee:-${Math.round(ecoule)}ms` : "";
		return etat === "scored"
			? { cls: "quiz-tab is-result is-scored" + (arrivee ? " is-arrivee" : ""), etat, style, html: `<span class="quiz-tab-drapeau">${ICON_TROPHEE}</span><span class="quiz-tab-libelle">${t("engine.nav.results")}</span>` }
			: { cls: "quiz-tab is-result", etat, style, html: `<span class="quiz-tab-drapeau">${ICON_DRAPEAU}</span><span class="quiz-tab-libelle">${t("engine.nav.finish")}</span>` };
	}

	/** The state of the last tab last drawn, and when it became the trophy. */
	let etatVu: "finish" | "scored" | null = null;
	let arriveeDebut = 0;

	function navHtml(): string {
		const resultsActive = (ctx.isSubmitSlideIndex(ctx.quizState.current) || ctx.isResultsSlideIndex(ctx.quizState.current)) ? "active" : "";
		const onglets = ongletsNav();
		/* Une lecture de Learn restée un écran (style `page`) n'a pas de
		   numéro de question (src/lecture-etape.ts) : son onglet est un livre,
		   nommé par son titre pour un lecteur d'écran. Plus de `title` : son
		   infobulle au survol a été retirée comme les autres (2026-09-27).
		   Le « Q » et le libellé « Résultats » sont dans leur propre `span` :
		   la frise de perles de l'application n'en garde que le numéro et un
		   drapeau, les onglets du greffon les affichent tels quels. */
		const onglet = (i: number): string => {
			const n = beadNumero(i);
			if (n > 0) return `<a class="quiz-tab ${tabClass(i)}" href="#" data-nav="${i}" aria-label="${ctx.escapeHtmlAttr(tabLabel(i))}"><span class="quiz-tab-q">Q</span>${n}</a>`;
			const nom = ctx.escapeHtmlAttr(stripInlineMarkdown(ctx.quiz[i]?.title || t("engine.lesson.roleRead")));
			/* `data-titre`: the reading's title, shown ABOVE the bead on hover by
			   the application's bead row (perles.css, CSS `attr()` — plain text,
			   never HTML). A book alone did not say which reading it opens. */
			return `<a class="quiz-tab ${tabClass(i)}" href="#" data-nav="${i}" aria-label="${nom}" data-titre="${nom}">${ICON_LIVRE}</a>`;
		};
		const r = resultTab();
		const fin = `<a class="${r.cls} ${resultsActive}" href="#" data-nav-results="1" data-etat="${r.etat}"${r.style ? ` style="${r.style}"` : ""}>${r.html}</a>`;
		// `--quiz-nav-n` : le nombre de perles, « Résultats » compris.
		return `<div class="quiz-nav" style="--quiz-nav-n:${onglets.length + 1};--quiz-nav-pos:${navPosition()}">${onglets.map(onglet).join("")}${fin}</div>`;
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
		const nextLabel = t(!isLast ? "engine.nav.nextQuestion" : ctx.handIn.lastArrowLabel());
		const prevLabel = ctx.escapeHtmlAttr(t("engine.nav.prevQuestion"));
		/* In a Learn, the next arrow on an answered, unchecked question CHECKS
		   it first ("Check, then Continue"): its label says so. `data-nav-label`
		   keeps the moving label for `learn.syncControls`, which updates it as
		   an answer is typed without a re-render. */
		const nextAttr = ctx.escapeHtmlAttr(ctx.learn.canCheck(qi) ? t("engine.learn.check") : nextLabel);
		return `<div class="quiz-question-nav">
			<button class="quiz-nav-btn quiz-prev-btn" type="button" aria-label="${prevLabel}"${isFirst ? " disabled" : ""}>${ICON_ARROW_LEFT}</button>
			<button class="quiz-nav-btn quiz-next-btn" type="button" aria-label="${nextAttr}" data-nav-label="${ctx.escapeHtmlAttr(nextLabel)}">${ICON_ARROW_RIGHT}</button>
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
			if (!ctx.isRevealed(qi)) return selected ? "selected" : "";
			const correct = Array.isArray(q.correctIndices) && q.correctIndices.includes(oi);
			if (selected && correct) return "correct";
			if (selected && !correct) return "wrong";
			if (!selected && correct) return "missed";
			return "";
		}
		const selected = sel === oi;
		if (!ctx.isRevealed(qi)) return selected ? "selected" : "";
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
			   check-windows-host garde cette liste. */
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
		const revealed = ctx.isRevealed(qi);

		const slots = items.map((_, si) => {
			const oi = Array.isArray(sel) ? sel[si] : null;
			const filled = oi !== null;
			let cls = "quiz-slot";
			if (filled) cls += " filled";
			if (!revealed && pick !== null) cls += " can-place";
			if (revealed && filled) cls += oi === correctOrder[si] ? " correct" : " wrong";

			return `<div class="${cls}" data-order-slot="${si}" role="button" tabindex="0" ${(!revealed && filled) ? `draggable="true" data-slot-item="${oi}"` : ""}>
				<div class="quiz-slot-label">${ctx.sanitize.renderInlineText(slotLabels[si] ?? String(si + 1))}</div>
				<div class="quiz-slot-value">${filled ? ctx.sanitize.renderInlineText(items[oi]) : t("engine.ordering.dropHere")}</div>
			</div>`;
		}).join("");

		const possibilities = shuffled.map(oi => {
			const used = ctx.orderingSelectionIncludes(qi, oi);
			const picked = !used && pick === oi && !revealed;
			let cls = "quiz-possibility";
			if (used) cls += " used";
			if (picked) cls += " selected-pick";

			return `<div class="${cls}" data-order-item="${oi}" role="button" tabindex="0" ${(!used && !revealed) ? `draggable="true"` : ""}>
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
		const revealed = ctx.isRevealed(qi);

		const slots = shuffledRows.map(rowIndex => {
			const chosen = Array.isArray(sel) ? sel[rowIndex] : null;
			const filled = chosen !== null;
			let cls = "quiz-slot";
			if (filled) cls += " filled";
			if (!revealed && pick !== null) cls += " can-place";
			if (revealed && filled && Array.isArray(correctMap) && correctMap.length === rows.length) {
				cls += chosen === correctMap[rowIndex] ? " correct" : " wrong";
			}

			return `<div class="${cls}" data-match-slot="${rowIndex}" role="button" tabindex="0" ${(!revealed && filled) ? `draggable="true" data-slot-choice="${chosen}"` : ""}>
				<div class="quiz-slot-label">${ctx.sanitize.renderInlineText(rows[rowIndex])}</div>
				<div class="quiz-slot-value">${filled ? ctx.sanitize.renderInlineText(choices[chosen] ?? t("engine.matching.unknownChoice")) : t("engine.matching.dropHere")}</div>
			</div>`;
		}).join("");

		const possibilities = shuffledChoices.map(ci => {
			const picked = !revealed && pick === ci;
			let cls = "quiz-possibility";
			if (picked) cls += " selected-pick";

			return `<div class="${cls}" data-match-choice="${ci}" role="button" tabindex="0" ${!revealed ? `draggable="true"` : ""}>
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
		return ctx.quiz.map((_, i) => i).filter(i => !ctx.isReadingCard(i));
	}

	/* THE END SCREEN, before the score (redesigned 2026-09-27: it dated from
	   the first versions). One layout for its three variants — answers,
	   self-assessments, written exam answers: an icon, a title saying what is
	   left, a progress bar, then the questions concerned as numbered BEADS
	   (the application's navigation row) and the two actions. What is missing
	   is amber, not red: a question left empty is not a mistake. */
	function submitSlideHtml(): string {
		const reviewable = reviewableIndices();
		let missing = ctx.getMissingIndices();
		let titre: string;
		let progres: TransKey = "engine.submit.progress";
		let finir: TransKey = "engine.submit.showScore";
		let liste: TransKey = "engine.submit.missingList";
		let complet: TransKey = "engine.submit.allAnswered";
		if (ctx.textOnly?.isTextOnlyMode?.() && ctx.textOnly.isExamAnswerPhase?.()) {
			// Same "read" guard as reviewableIndices: hasAnyAnswer of a "read"
			// card is always false (it never writes into textOnlyAnswers), so
			// without the explicit exclusion it would fall back to "missing"
			// here although there is nothing to answer.
			missing = reviewable.filter(i => !ctx.textOnly.hasAnyAnswer(i));
			titre = plural(missing.length, "engine.submit.missingFreeAnswers.one", "engine.submit.missingFreeAnswers.other");
			finir = "engine.exam.finish";
			complet = "engine.submit.allFreeAnswered";
		} else if (ctx.textOnly?.isTextOnlyMode?.()) {
			titre = plural(missing.length, "engine.submit.missingRatings.one", "engine.submit.missingRatings.other");
			progres = "engine.submit.progressRated";
			finir = "engine.submit.showResults";
			liste = "engine.submit.toRateList";
			complet = "engine.submit.allRated";
		} else {
			titre = plural(missing.length, "engine.submit.missingAnswers.one", "engine.submit.missingAnswers.other");
		}

		const manque = missing.length > 0;
		const total = reviewable.length;
		const faits = Math.max(0, total - missing.length);
		const pct = total > 0 ? Math.round((faits / total) * 100) : 100;
		const perles = (manque ? missing : reviewable).map(i =>
			`<button class="quiz-submit-perle" type="button" data-jump="${i}" aria-label="${ctx.escapeHtmlAttr(t("engine.submit.goTo", { n: numero(i) }))}">${numero(i)}</button>`
		).join("");

		return `<div class="quiz-track-item" data-slide-kind="submit"><div class="quiz-submit-wrap">`
			+ `<div class="quiz-submit-card ${manque ? "is-incomplete" : "is-complete"}">`
			+ `<div class="quiz-submit-icon">${manque ? ICON_TRIANGLE_ALERTE : ICON_CERCLE_OK}</div>`
			+ `<div class="quiz-submit-title">${manque ? titre : t(complet)}</div>`
			+ `<div class="quiz-submit-sub">${t(manque ? "engine.submit.missingSub" : "engine.submit.completeSub")}</div>`
			+ `<div class="quiz-submit-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${faits}">`
			+ `<div class="quiz-submit-bar"><span style="width:${pct}%"></span></div>`
			+ `<div class="quiz-submit-count">${t(progres, { done: faits, total })}</div></div>`
			+ `<div class="quiz-submit-label">${t(manque ? liste : "engine.submit.reviewList")}</div>`
			+ `<div class="quiz-submit-perles">${perles}</div>`
			+ `<div class="quiz-actions"><button class="quiz-submit-back quiz-back-btn" type="button">${ICON_ARROW_LEFT}<span>${t("engine.submit.back")}</span></button>`
			+ `<button class="quiz-action-btn success quiz-show-score-btn" type="button">${t(finir)}</button></div>`
			+ `</div></div></div>`;
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
		// A Learn keeps its score and its three numbers (engine/learn.ts): its
		// written answers were judged on their cards, first attempt first.
		if (ctx.textOnly?.isTextOnlyForAll?.() && !ctx.learn.isActive()) {
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
		// Le score n'inclut pas les réponses écrites pas encore auto-évaluées
		// (computeScorePercent les exclut déjà de correct/total) : le dire
		// clairement plutôt que de les compter fausses.
		const pendingNote = pendingWritten > 0
			? `<p class="quiz-textonly-correction-hint">${t(pendingWritten > 1 ? "engine.result.pendingWritten.other" : "engine.result.pendingWritten.one", { count: pendingWritten })}</p>`
			: "";
		const writtenReview = ctx.textOnly.writtenReviewSectionHtml();
		/* A LEARN says how the questions went (2026-09-29): right the first
		   time, right after a retry, still to review — the same three colours
		   as the beads. */
		let learnSummary = "";
		if (ctx.learn.isActive()) {
			const sum = ctx.learn.summary();
			const stat = (cls: string, n: number, key: TransKey) => `<div class="quiz-learn-summary-stat ${cls}"><strong>${n}</strong><span>${t(key)}</span></div>`;
			learnSummary = `<div class="quiz-learn-summary">${stat("first", sum.first, "engine.learn.summaryFirst")}${stat("retried", sum.retried, "engine.learn.summaryRetried")}${stat("missed", sum.missed, "engine.learn.summaryMissed")}</div>`;
		}
		/* A TEST says how many right answers used a hint: "12/15, 2 with a
		   hint" (spec 2026-09-29 §2.2). Counted, never taken off the score. */
		const withHint = ctx.handIn.isTest() ? ctx.countRightWithHint() : 0;
		const withHintNote = withHint > 0 ? `<span class="quiz-result-with-hint">, ${t("engine.result.withHint", { count: withHint })}</span>` : "";
		// The score ("12/20", "60 %") stays code: only the label is translated.
		return `<div class="quiz-track-item" data-slide-kind="results"><section class="quiz-result"><h2 class="quiz-result-title" style="font-weight:900;">${t("engine.result.title")}</h2><p style="font-size:48px;font-weight:900;margin:18px 0 6px;">${pct}%</p><p>${t("engine.result.correctLabel")} <strong>${correct}/${total}</strong>${withHintNote}</p>${learnSummary}${pendingNote}${writtenReview}<div class="quiz-actions">${saveResultsButtonHtml()}<button class="quiz-action-btn success quiz-retry-btn" type="button">${t("engine.result.retry")}</button></div></section></div>`;
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
			// Termes du glossaire AVANT mathifyElement — même ordre qu'en
			// repeint de carte (engine.ts), pour la même raison : la passe
			// remplace des nœuds texte, mathifyElement en capture d'autres de
			// façon synchrone avant d'attendre MathJax (engine/termes.ts).
			ctx.termes.poserTermes(newNode);
			// LaTeX des slides submit/results (récap des réponses).
			mathifyElement(newNode);
			// Bouton « Exécuter » des blocs Python (recap du mode texte
			// libre, par exemple) : sans cet appel le bouton restait visible
			// mais inerte (revue du 2026-09-26, A-IMPORTANT 2).
			ctx.codeRun.bindCodeRunButtons(newNode);
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
		const card = cardParts(qi, false);
		return `<div class="quiz-track-item${card.roleClass}${card.revealedClass}" data-slide-kind="question" data-qi="${qi}">${card.section}</div>`;
	}

	/** One slide per STEP (engine/step-page.ts): the step's readings, then its
	    questions, stacked in one page, then the way on. Each card is a
	    `section` of its own (`data-card-qi`), refreshed alone by
	    `refreshQuestionSlide`; the slide keeps the first card's index in
	    `data-qi`, which every slide-level lookup of the engine reads. */
	function stepSlideHtml(step: StepSlide): string {
		const members = stepMembers(step);
		const st = ctx.quizState;
		const order = drawOrder(members, qi => !!st.learnRetrying?.[qi] && !st.learnChecked?.[qi]);
		const cards = order.map(qi => cardParts(qi, true).section).join("");
		return `<div class="quiz-track-item quiz-step-page" data-slide-kind="question" data-qi="${members[0]}" data-step="${step.step}">${cards}${stepFooterHtml(members[members.length - 1])}</div>`;
	}

	/** The foot of a step page: back, and ONE wide "Next step" button that is
	    the next arrow itself (`quiz-next-btn`: the keys, the swipe and the
	    application's bar all click it). On the last step it leads where the
	    last arrow of a quiz leads. */
	function stepFooterHtml(lastQi: number): string {
		const slide = ctx.getSlideIndexForQuestion(lastQi);
		const isLast = ctx.questionSuivante(lastQi) === null;
		const label = t(isLast ? ctx.handIn.lastArrowLabel() : "engine.learn.nextStep");
		return `<div class="quiz-question-nav quiz-step-nav">
			<button class="quiz-nav-btn quiz-prev-btn" type="button" aria-label="${ctx.escapeHtmlAttr(t("engine.nav.prevQuestion"))}"${slide <= 0 ? " disabled" : ""}>${ICON_ARROW_LEFT}</button>
			<button class="quiz-nav-btn quiz-next-btn quiz-step-next-btn" type="button" aria-label="${ctx.escapeHtmlAttr(label)}" title="${ctx.escapeHtmlAttr(label)}">${ICON_ARROW_RIGHT}</button>
		</div>`;
	}

	function cardParts(qi: number, inStep: boolean): { roleClass: string; revealedClass: string; section: string } {
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
		const isRead = ctx.isReadingCard(qi);
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
			/* A single choice names its options A, B, C… in the order SHOWN
			   (shuffled or not), the letters of the quiz's fiche (2026-09-29);
			   `quiz-options.css` writes the letter in the option's circle. A
			   multiple choice keeps its squares: they say "several answers". */
			const optionsHtml = smap.map((oi, pos) => {
				const contentHtml = optionContentHtml(qcm, oi);
				// aria-pressed reflète l'état sélectionné pour les lecteurs d'écran (recalculé
				// à chaque refreshQuestionSlide). role=button + aria-pressed plutôt que radio/
				// checkbox pour ne pas capturer les flèches (réservées à la navigation).
				const isSelected = isMulti ? (sel instanceof Set && sel.has(oi)) : (sel === oi);
				const lettre = isMulti ? "" : ` data-letter="${String.fromCharCode(65 + pos)}"`;
				return `<div class="quiz-option ${isMulti ? "multi" : ""} ${optionClass(qi, oi)}" role="button" tabindex="0" aria-pressed="${isSelected}" data-orig="${oi}"${lettre}>${contentHtml}</div>`;
			}).join("");
			const hasImg = /<img[\s>]/i.test(optionsHtml);
			body = mi + `<div class="quiz-options-wrap${hasImg ? " quiz-options-image-grid" : ""}">${optionsHtml}</div>`;
		}

		/* UN SEUL BOUTON D'AIDE, qui monte d'un cran (2026-09-26) : « Indice »
		   tant que l'indice n'a pas été révélé ; révélé, l'indice reste AFFICHÉ
		   sous la question (il se relit sans rouvrir de fenêtre) et le bouton
		   devient « Je ne sais pas » là où il existe, disparaît ailleurs.
		   Chercher, se faire aider, puis seulement abandonner. Un indice à
		   plusieurs niveaux garde « Indice suivant » jusqu'au dernier
		   (engine/hint.ts indiceCarte). Une réponse libre a son indice aussi
		   (retour #1 : CHAQUE question d'un Learn en a un) ; seule la carte
		   mémoire n'en a pas, puisqu'elle se retourne pour se lire. */
		// A test set up without hints (an Exam) shows none at all (engine/hand-in.ts showsHints).
		const indice = !isRead && !ctx.isFlashcardQuestion(q) && ctx.handIn.showsHints() ? ctx.hint.indiceCarte(qi, ICON_BULB) : { bouton: "", revele: "" };
		/* No Hint button once the card shows its correction (a handed-in Test,
		   a checked Learn card): the explanation is there, and a hint read
		   AFTER the verdict would add the bulb to its mark (withHintBadge)
		   although it did not help. Levels already seen stay displayed. */
		const hintBtn = ctx.isRevealed(qi) ? "" : indice.bouton;
		const indiceHtml = indice.revele;
		// Task 7 (Learn): "I don't know" on a pre-question — an EMPTY but
		// EXPLICIT attempt. Moving on without answering now gives the same
		// verdict (engine/state.ts marquerPreNonTentees). Guarded by
		// !isRevealed like hintBtn: a card already corrected has nothing left
		// to "let pass". Round 1 of review (Finding 4): hidden as soon as
		// lessonPreSkipped[qi] is true — on the LAST question (no next
		// navigation), the click otherwise had no visible effect; its
		// disappearance IS the expected visible effect, on top of the re-render
		// that triggers it (interactions.ts markLessonPreSkipped).
		const dontKnowBtn = (!hintBtn && !isRead && !isTextOnly && ctx.isLessonMode() && ctx.roleOfQuestion(qi) === "pre" && !ctx.isRevealed(qi) && !ctx.quizState.lessonPreSkipped[qi])
			? `<button class="quiz-help-btn quiz-lesson-dontknow-btn" type="button">${ICON_HELP}<span>${t("engine.lesson.dontKnow")}</span></button>`
			: "";
		// Mode leçon (ex "learn") : la leçon s'affiche AVANT que la question soit
		// verrouillée, jamais après (revoir la leçon une fois corrigé n'a pas de
		// sens). Classes CSS `quiz-learn-*` conservées telles quelles. Une carte
		// "read" n'a rien à corriger : ce bloc n'a pas de sens dessus non plus.
		const lessonContent = (!isRead && !isTextOnly && ctx.quizMode === "lesson" && !ctx.isRevealed(qi))
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
		/* `quiz-learn-revealed`: this card shows its correction (engine/learn.ts) —
		   read by the option styles and by the glossary and ▶ rules, which
		   used to read the quiz's global lock alone. */
		const revealedClass = ctx.isRevealed(qi) ? " quiz-learn-revealed" : "";

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

		const section = `<section class="quiz-card${inStep ? `${roleClass}${revealedClass} quiz-step-card` : ""}"${sectionIdAttr}${inStep ? ` data-card-qi="${qi}"` : ""}${lecture ? ` data-lecture="${lecture.style}"` : ""}>
				${passageSection}
				${courteHtml}
				${ctx.learn.retryNoteHtml(qi)}
				${lecture ? "" : `<h2>${ctx.sanitize.renderInlineText(q.title)}</h2>`}
				${ctx.isFlashcardQuestion(q) ? "" : `<div class="quiz-question">${lecture ? lecture.html : promptHtml}</div>`}
				${body}
				${learnSection}
				${ctx.sanitize.resourceButtonHtml(q) /* after the content, never above it (2026-09-27): at the top of a reading page it came before the text */}
				${indiceHtml}
				${hintBtn}
				${dontKnowBtn}
				${ctx.learn.checkButtonHtml(qi)}
				${!isRead && !isTextOnly && ctx.isRevealed(qi) ? explanationHtml(qi) : ""}
				${inStep ? "" : questionNavHtml(qi)}
			</section>`;
		return { roleClass, revealedClass, section };
	}

	return {
		tabClass,
		tabLabel,
		navHtml,
		navPosition,
		resultTab,
		optionClass,
		optionContentHtml,
		explanationHtml,
		renderQuizPromptHtml,
		orderingCardHtml,
		matchingCardHtml,
		submitSlideHtml,
		resultsSlideHtml,
		refreshMetaSlides,
		questionCardHtml,
		stepSlideHtml,
		stepCardHtml: (qi: number) => cardParts(qi, true).section
	};
}
