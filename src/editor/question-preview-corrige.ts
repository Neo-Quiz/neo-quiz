import { t } from "../i18n";
import { ajouter } from "../dom";
import { md2html } from "./utils";
import type { DraftQuestion } from "./utils";
import { currentHost } from "../host/current";
import { createSanitizer, renderInlineText } from "../engine/sanitizer";
import type { EngineCtx } from "../types/engine-ctx";
import { markSlots, fillSlots } from "../engine/cloze";
import { inlineInto, resolveImagesInHtml } from "./question-preview";
import type { QuizPreviewOptions } from "./question-preview";

/* ══════════════════════════════════════════════════════════
   AIDES DU RENDU CORRIGÉ — extraites de question-preview.ts pour rester sous
   la limite de ~350 lignes du module. Rien d'ici ne dépend du DOM déjà posé
   par l'appelant : chaque fonction rend un fragment de HTML ou une petite
   donnée pure (ensemble d'indices corrects…), que question-preview.ts pose
   dans la carte au bon endroit.
══════════════════════════════════════════════════════════ */

/** Un `SanitizerHandlers` complet (renderTextWithEmbeds,
    replaceObsidianEmbedsInHtml), construit avec le sous-ensemble d'EngineCtx
    dont ces deux fonctions ont RÉELLEMENT besoin (host, sourcePath) —
    l'aperçu de l'éditeur n'a jamais de EngineCtx complet (pas de quiz en
    cours, pas d'état de jeu), et n'en a pas besoin pour de la résolution
    d'embeds. Cast documenté : createSanitizer ne lit que `ctx.host` et
    `ctx.sourcePath` pour ces deux chemins. */
export function corrigeSanitizer(sourcePath?: string) {
	return createSanitizer({ host: currentHost(), sourcePath: sourcePath || "" } as unknown as EngineCtx);
}

/** Les indices d'options correctes, uniformes single/multi. */
export function correctOptionIndices(q: DraftQuestion, isMulti: boolean): Set<number> {
	if (isMulti) return new Set(q.correctIndices || []);
	return typeof q.correctIndex === "number" ? new Set([q.correctIndex]) : new Set<number>();
}

/**
 * La réponse acceptée à afficher (première variante), et les autres variantes
 * en liste discrète — mêmes classes que le moteur utilise déjà pour montrer
 * une réponse « attendue » en mode auto-évaluation (engine/text-only.ts
 * expectedAnswerHtml) : `.quiz-textonly-expected-list` /
 * `.quiz-textonly-expected-item`. Aucune classe n'est inventée ici.
 */
export function acceptedAnswersCorrige(q: DraftQuestion): { primary: string; variantsHtml: string } {
	const list = q.acceptedAnswers || [];
	const primary = list[0] || "";
	/* L'INDEX RÉEL de chaque variante, et les variantes VIDES gardées : un
	   filtre décalait `data-index` (éditer « c » dans ["a", "", "c"] visait
	   la case 1) et rendait invisible la variante que « + Variante » vient
	   d'ajouter — son champ ne pouvait pas s'ouvrir (revue finale,
	   2026-09-27). Une variante vide se montre en emplacement à remplir. */
	const variants = list.map((v, i) => ({ v: typeof v === "string" ? v : "", i })).slice(1);
	const variantsHtml = variants.length
		? `<div class="quiz-textonly-expected-list">${variants.map(({ v, i }) =>
			`<div class="quiz-textonly-expected-item${v.trim() ? "" : " qb-er-variante-vide"}" data-edit="accepted" data-index="${i}">${renderInlineText(v)}</div>`
		).join("")}</div>`
		: "";
	return { primary, variantsHtml };
}

/** L'explication, dans l'état CORRIGÉ : mêmes classes que le moteur
    (`.quiz-explain good` — cf. engine/cards.ts explanationHtml, toujours
    "good" ici puisque l'aperçu montre la réponse juste, jamais une tentative
    ratée). Un champ `_explainHtml` n'est pas éditable dans le rendu (comme
    `_promptHtml` : il passe par « Plus », tâche 5) — pas de `data-edit` sur
    ce chemin. Chaîne vide si la question n'a aucune explication. */
export function explainCorrigeHtml(q: DraftQuestion, sourcePath?: string): string {
	const html = q._explainHtml;
	const text = q.explain;
	if (!html && !(text && text.trim())) return "";
	const sanitize = corrigeSanitizer(sourcePath);
	const content = html
		? sanitize.replaceObsidianEmbedsInHtml(html)
		: sanitize.renderTextWithEmbeds(text || "");
	const editAttr = html ? "" : ` data-edit="explain"`;
	return `<div class="quiz-explain good"${editAttr}>${content}</div>`;
}

/** Échappe une valeur pour un attribut HTML — la même règle que
    `escapeHtmlAttr` du moteur, dupliquée ici en une ligne : cette fonction
    n'a pas besoin du reste du sanitizer (pas de résolution d'embed, pas de
    liste blanche), seulement d'un attribut sûr pour un `value=""`. */
function escAttr(v: string): string {
	return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Classement, dans les DEUX états : emplacements vides à l'état initial,
    remplis par l'élément CORRECT en corrigé (`filled correct`, mêmes classes
    que le moteur verrouillé — engine/cards.ts orderingCardHtml). Chaque
    élément de la réserve montre `used` une fois placé dans un emplacement,
    en corrigé seulement. */
export function renderOrderingBlock(card: HTMLElement, q: DraftQuestion, opts: QuizPreviewOptions): void {
	ajouter(card, "div", "quiz-multi-indicator", t("editor.preview.orderingHint"));
	const orderingWrap = ajouter(card, "div", "quiz-ordering");
	const slotsWrap = ajouter(orderingWrap, "div", "quiz-ordering-slots");
	const correctOrder = q.correctOrder || [];
	(q.slots || []).forEach((slotLabel, si) => {
		const oi = opts.corrige ? correctOrder[si] : undefined;
		const filled = oi !== undefined;
		const slot = ajouter(slotsWrap, "div", "quiz-slot" + (filled ? " filled correct" : ""));
		const labelEl = ajouter(slot, "div", "quiz-slot-label");
		inlineInto(labelEl, slotLabel, opts.sourcePath);
		if (opts.corrige) {
			labelEl.setAttribute("data-edit", "slot");
			labelEl.setAttribute("data-index", String(si));
		}
		const valueEl = ajouter(slot, "div", "quiz-slot-value");
		if (filled) inlineInto(valueEl, (q.possibilities || [])[oi] || "...", opts.sourcePath);
		else valueEl.textContent = "…";
	});
	// Pool dans l'ordre STOCKÉ (celui montré à l'élève), pas l'ordre correct.
	// `used` (moteur) sur l'élément déjà placé dans un emplacement : ce texte
	// reste éditable ici, où il vit réellement (`possibilities[oi]`) — pas
	// une seconde fois dans l'emplacement, qui ne fait que le refléter.
	const used = opts.corrige ? new Set(correctOrder) : new Set<number>();
	const pool = ajouter(orderingWrap, "div", "quiz-ordering-pool");
	(q.possibilities || []).forEach((p, pi) => {
		const item = ajouter(pool, "span", "quiz-pool-item" + (used.has(pi) ? " used" : ""));
		inlineInto(item, p, opts.sourcePath);
		if (opts.corrige) {
			item.setAttribute("data-edit", "possibility");
			item.setAttribute("data-index", String(pi));
		}
	});
}

/** Appariement : même schéma que le classement, avec `correctMap`. */
export function renderMatchingBlock(card: HTMLElement, q: DraftQuestion, opts: QuizPreviewOptions): void {
	ajouter(card, "div", "quiz-multi-indicator", t("editor.preview.matchingHint"));
	const matchWrap = ajouter(card, "div", "quiz-ordering");
	const slotsWrap = ajouter(matchWrap, "div", "quiz-ordering-slots");
	const correctMap = q.correctMap || [];
	(q.rows || []).forEach((row, ri) => {
		const ci = opts.corrige ? correctMap[ri] : undefined;
		const filled = ci !== undefined;
		const slot = ajouter(slotsWrap, "div", "quiz-slot" + (filled ? " filled correct" : ""));
		const labelEl = ajouter(slot, "div", "quiz-slot-label");
		inlineInto(labelEl, row || t("editor.matching.rowFallback", { n: ri }), opts.sourcePath);
		if (opts.corrige) {
			labelEl.setAttribute("data-edit", "row");
			labelEl.setAttribute("data-index", String(ri));
		}
		const valueEl = ajouter(slot, "div", "quiz-slot-value");
		if (filled) inlineInto(valueEl, (q.choices || [])[ci] || "...", opts.sourcePath);
		else valueEl.textContent = "…";
	});
	const used = opts.corrige ? new Set(correctMap) : new Set<number>();
	const pool = ajouter(matchWrap, "div", "quiz-ordering-pool");
	(q.choices || []).forEach((c, ci) => {
		const item = ajouter(pool, "span", "quiz-pool-item" + (used.has(ci) ? " used" : ""));
		inlineInto(item, c, opts.sourcePath);
		if (opts.corrige) {
			item.setAttribute("data-edit", "choice");
			item.setAttribute("data-index", String(ci));
		}
	});
}

/** Texte à trous : gabarit ENTIER passé par `md2html` d'un seul tenant (une
    paire markdown qui enjambe un trou reste une paire — même raison que le
    moteur, engine/cloze.ts). En corrigé, chaque trou affiche sa réponse
    (première variante), classes `is-filled correct`. Un SEUL champ éditable
    pour tout le gabarit (`q.cloze`, source avec ses `{{…}}`) : les trous
    individuels ne sont pas des champs à part. */
export function renderClozeBlock(card: HTMLElement, q: DraftQuestion, opts: QuizPreviewOptions): void {
	const { marked, blanks } = markSlots(q.cloze);
	ajouter(card, "div", "quiz-multi-indicator", t("engine.cloze.instructions", { count: blanks.length }));
	const body = ajouter(card, "div", "quiz-cloze");
	if (opts.corrige) body.setAttribute("data-edit", "cloze");
	body.innerHTML = fillSlots(
		resolveImagesInHtml(md2html(marked).replace(/^<p>|<\/p>$/g, ""), opts.sourcePath),
		(index) => {
			const label = t("engine.cloze.blankAria", { n: index + 1 }).replace(/"/g, "&quot;");
			if (opts.corrige) {
				const answer = blanks[index]?.answers[0] ?? "";
				return `<span class="quiz-cloze-slot"><input class="quiz-cloze-input is-filled correct" type="text" readonly `
					+ `value="${escAttr(answer)}" aria-label="${label}"></span>`;
			}
			return `<span class="quiz-cloze-slot"><input class="quiz-cloze-input" type="text" readonly `
				+ `aria-label="${label}"></span>`;
		},
	);
}
