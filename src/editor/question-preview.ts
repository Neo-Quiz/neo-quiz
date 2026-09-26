import { t } from "../i18n";
import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { md2html, _setIcon } from "./utils";
import type { DraftQuestion } from "./utils";
import { mathifyElement } from "../engine/mathjax";
import { sanitizeQuizHtml, rendreTexteQuiz } from "../engine/sanitizer";
import type { RenduImages } from "../engine/sanitizer";
/* IMPORT STATIQUE, plus un `require` paresseux : `require` n'existe pas dans
   le rendu de l'application (Vite, modules ES), et l'ancien appel faisait
   échouer la page de TOUT quiz portant une question `text` avec « require is
   not defined » (vu par Ahmed le 2026-09-13 sur un quiz généré). Le greffon
   (bundle CommonJS) ne s'en apercevait pas. Aucun cycle : `math-input`
   n'importe rien de l'éditeur. */
import { usesMathField, createMathField } from "../engine/math-input";
import {
	correctOptionIndices,
	acceptedAnswersCorrige,
	explainCorrigeHtml,
	renderOrderingBlock,
	renderMatchingBlock,
	renderClozeBlock,
} from "./question-preview-corrige";

/* ══════════════════════════════════════════════════════════
   QUESTION PREVIEW — la question telle que l'apprenant la verra

   Reproduit le DOM du moteur (engine/cards.ts questionCardHtml) :
   `section.quiz-card > h2 + .quiz-question + .quiz-options-wrap`, avec
   les MÊMES classes — donc le même CSS, la même pastille d'option, la
   même typo. C'est la seule façon d'être fidèle au quiz : réécrire un
   rendu « qui ressemble » diverge dès la première retouche du moteur.

   ÉTAT INITIAL par défaut (`opts.corrige` absent ou faux) : aucune option
   verte, aucun slot pré-rempli, aucune explication, aucune réponse de
   terminal — c'est la règle historique, INCHANGÉE pour tout appelant qui ne
   demande pas `corrige`. Les acceptedAnswers / correctOrder / correctMap
   restent la solution.

   Avec `opts.corrige: true` (édition dans le rendu, chantier 2026-09-26) :
   la carte s'affiche comme APRÈS correction — mêmes classes d'état que le
   moteur (`correct`, `.quiz-explain good`…) — et chaque élément que l'auteur
   peut modifier porte `data-edit="<champ>"` (+ `data-index`), lu par
   `dashboard/edition-rendu.ts` (tâche 3).

   Partagé par l'aperçu de l'éditeur (editor/preview.ts) et par la page
   d'un quiz du dashboard (dashboard/detail-question.ts).
══════════════════════════════════════════════════════════ */

export interface QuizPreviewOptions {
	/** Titre de repli quand la question n'en porte pas (« Question 3 »). */
	fallbackTitle: string;
	/** Bouton indice : rendu seulement si un handler est fourni. */
	onHint?: (hint: string) => void;
	/**
	 * Chemin de la NOTE qui porte le quiz, pour résoudre ses `![[…]]` comme le
	 * moteur le fait (`ctx.sourcePath`). Sans lui, la résolution de l'hôte juge
	 * sans contexte : deux pièces jointes homonymes dans des dossiers
	 * différents donnent la mauvaise, et un lien relatif (`../images/x.png`)
	 * ne se résout pas du tout — l'aperçu montrait alors une AUTRE image que
	 * le quiz, ou aucune (revue codex 2026-07-31). Absent pour un quiz encore
	 * en mémoire, qui n'a pas de note.
	 */
	sourcePath?: string;
	/** Rend la question dans son état CORRIGÉ (bonne réponse visible,
	    explication…), avec les attributs `data-edit` que l'édition dans le
	    rendu (tâche 3) accroche. Sans lui : état INITIAL, inchangé. */
	corrige?: boolean;
}

/**
 * Résout les images `![[...]]` du vault dans un HTML déjà rendu, puis passe le
 * tout par la liste blanche du moteur.
 *
 * `<template>` et non `<div>` : son document propriétaire est INERTE, donc un
 * `<img src=x onerror=…>` glissé dans le `passageHtml` d'un quiz partagé n'y
 * charge rien et n'exécute rien. Un `<div>` détaché, lui, déclenche quand
 * même le gestionnaire (standard HTML) — l'aperçu de l'éditeur exécutait donc
 * le HTML d'un quiz avant même que l'auteur ne l'ait relu.
 *
 * L'assainissement vient APRÈS la résolution, pas avant : à ce stade les `src`
 * sont des `app://…` que la liste blanche accepte, alors qu'un nom de fichier
 * nu (`schema.png`, ce que `md2html` écrit) en serait retiré — et l'aperçu
 * n'aurait plus d'images du tout.
 */
export function resolveImagesInHtml(html: string, sourcePath = ""): string {
	if (!html) return html;
	const tpl = document.createElement("template");
	tpl.innerHTML = html;
	tpl.content.querySelectorAll<HTMLImageElement>("img.qb-md-img").forEach(img => {
		const spec = img.getAttribute("src");
		if (!spec) return;
		// `![[fichier|300|légende]]` : seule la première part est un chemin.
		const lien = spec.split("|")[0].trim();
		if (!lien) return;

		/* `links.resourceUrl` fait les DEUX temps d'un coup, et par la même
		   voie que le moteur (`engine/sanitizer.ts`) : il résout le lien comme
		   la note l'entend, puis en fait une URL affichable. Rendre `null` est
		   un cas PRÉVU (le contrat l'exige) : on laisse alors le `src` d'origine
		   intact plutôt que d'écrire une chaîne vide, qui ferait recharger la
		   page courante comme image. */
		const url = currentHost().links.resourceUrl(lien, sourcePath);
		if (url) img.setAttribute("src", url);
	});
	return sanitizeQuizHtml(tpl.innerHTML);
}

const attrApercu = (v: string): string =>
	v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Les images d'un texte, laissées à `resolveImagesInHtml` : un chemin du
    vault devient un `img.qb-md-img` qu'il résout, une URL web reste telle
    quelle — puis tout passe par la liste blanche. */
const IMAGES_APERCU: RenduImages = {
	embed: spec => `<img src="${attrApercu(spec)}" class="qb-md-img" />`,
	image: (alt, src) => /^(https?:\/\/|data:image\/)/i.test(src)
		? `<img src="${attrApercu(src)}" alt="${attrApercu(alt)}">`
		: `<img src="${attrApercu(src)}" alt="${attrApercu(alt)}" class="qb-md-img" />`,
};

/** Un texte de quiz (énoncé, option, support) rendu par la MÊME fonction
    que le moteur (`rendreTexteQuiz`) : paragraphes, listes, blocs de code,
    tableaux, images et liens s'y affichent comme dans le quiz. `md2html`,
    une seconde grammaire, montrait autre chose que ce que l'apprenant
    verrait. */
export function texteQuizHtml(raw: string, sourcePath?: string): string {
	return resolveImagesInHtml(rendreTexteQuiz(raw, IMAGES_APERCU), sourcePath);
}

/** Écrit un libellé COURT en rendant son markdown inline (gras, code…) —
    le moteur le fait désormais partout, l'aperçu ne doit pas afficher les
    accents graves d'une adresse IP là où le quiz montre du code. Le `<p>`
    que md2html ajoute autour d'un texte d'une ligne est retiré : ces
    libellés vivent dans une cellule, pas dans un paragraphe. */
export function inlineInto(el: HTMLElement, raw: string, sourcePath?: string): void {
	el.innerHTML = resolveImagesInHtml(md2html(raw).replace(/^<p>|<\/p>$/g, ""), sourcePath);
}

/** Le SUPPORT de compréhension, au-dessus de la question — mêmes classes que
    le moteur (engine/passage.ts). Sans lui, une question de compréhension
    s'affichait dans l'aperçu sans le texte sur lequel elle porte : l'auteur ne
    pouvait pas la relire. Toujours déplié ici (l'aperçu n'a pas d'état) et
    sans le compte « questions 2 à 4 », qui demanderait de connaître tout le
    quiz alors que la carte ne voit qu'une question. */
function renderPassage(card: HTMLElement, q: DraftQuestion, sourcePath?: string): void {
	const extras = q._extraFields || {};
	const text = typeof extras.passage === "string" ? extras.passage : "";
	const html = typeof extras.passageHtml === "string" ? extras.passageHtml : "";
	if (!text && !html) return;

	const title = typeof extras.passageTitle === "string" && extras.passageTitle.trim()
		? extras.passageTitle
		: t("editor.passage.section");

	const wrap = ajouter(card, "div", "quiz-passage");
	const head = ajouter(wrap, "div", "quiz-passage-head");
	const icon = ajouter(head, "span", "quiz-passage-icon");
	icon.setAttribute("aria-hidden", "true");
	_setIcon(icon, "book-open-text");
	// `inlineInto` et non un texte posé tel quel — le titre d'un document cite
	// volontiers une commande entre accents graves, et le moteur, lui, la rend.
	inlineInto(ajouter(head, "span", "quiz-passage-title"), title, sourcePath);
	const body = ajouter(wrap, "div", "quiz-passage-body");
	const content = ajouter(body, "div", "quiz-passage-content");
	content.innerHTML = html ? resolveImagesInHtml(html, sourcePath) : texteQuizHtml(text, sourcePath);
}

/** Construit la carte de question dans `host` et la renvoie. */
export function renderQuizPreviewCard(host: HTMLElement, q: DraftQuestion, opts: QuizPreviewOptions): HTMLElement {
	const { fallbackTitle } = opts;
	const type = q._type;
	const wrap = ajouter(host, "div", "quiz-blocks-host");
	const card = ajouter(wrap, "section", "quiz-card");

	renderPassage(card, q, opts.sourcePath);

	// Le TITRE aussi rend son markdown : le moteur le fait (engine/cards.ts),
	// et un titre de question technique cite volontiers une commande entre
	// accents graves — ils s'affichaient bruts dans l'aperçu.
	const titleEl = ajouter(card, "h2");
	inlineInto(titleEl, q.title || fallbackTitle, opts.sourcePath);
	if (opts.corrige) titleEl.setAttribute("data-edit", "title");

	if (q.resourceButton) {
		const rbtn = ajouter(card, "button", "quiz-resource-btn");
		const icon = ajouter(rbtn, "span", "quiz-resource-btn-icon");
		_setIcon(icon, "paperclip");
		// Même raison : le moteur rend ce libellé (sanitizer.ts resourceButtonHtml).
		inlineInto(ajouter(rbtn, "span", "quiz-resource-btn-label"),
			q.resourceButton.label || t("editor.preview.resourceFallback"), opts.sourcePath);
	}

	if (q._promptHtml || q.prompt) {
		const promptEl = ajouter(card, "div", "quiz-question");
		promptEl.innerHTML = q._promptHtml
			? resolveImagesInHtml(q._promptHtml.replace(/!\[\[([^\]]+)\]\]/g, '<img src="$1" class="qb-md-img" />'), opts.sourcePath)
			: texteQuizHtml(q.prompt, opts.sourcePath);
		// `_promptHtml` s'édite en HTML dans « Plus » (tâche 5), pas ici.
		if (opts.corrige && !q._promptHtml) promptEl.setAttribute("data-edit", "prompt");
	}

	if (type === "single" || type === "multi") {
		const isMulti = type === "multi";
		if (isMulti) ajouter(card, "div", "quiz-multi-indicator", t("editor.preview.multiHint"));
		// .quiz-options-wrap : le conteneur du moteur (colonne flex) — sans lui
		// les options perdent leur rythme vertical.
		const list = ajouter(card, "div", "quiz-options-wrap");
		// Classe `correct` du moteur (engine/cards.ts optionClass) : en corrigé,
		// la ou les bonnes réponses la portent, comme une sélection juste — les
		// autres n'ont AUCUNE classe d'état (jamais `wrong`/`missed` : l'auteur
		// n'a rien « raté », il relit la solution).
		const correct = opts.corrige ? correctOptionIndices(q, isMulti) : new Set<number>();
		(q.options || []).forEach((o, oi) => {
			const cls = `quiz-option ${isMulti ? "multi" : ""} ${correct.has(oi) ? "correct" : ""}`.trim();
			const opt = ajouter(list, "div", cls);
			opt.setAttribute("role", "button");
			opt.setAttribute("tabindex", "0");
			opt.innerHTML = texteQuizHtml(o || "...", opts.sourcePath);
			if (opts.corrige) {
				opt.setAttribute("data-edit", "option");
				opt.setAttribute("data-index", String(oi));
			}
		});
	}

	if (type === "ordering") renderOrderingBlock(card, q, opts);

	if (type === "matching") renderMatchingBlock(card, q, opts);

	if (type === "cloze") renderClozeBlock(card, q, opts);

	if (type === "flashcard") {
		/* Aperçu : le recto est l'énoncé déjà rendu ; le verso en sourdine
		   dessous, pour que l'auteur relise sa réponse sans jouer la carte —
		   TOUJOURS visible, corrigé ou non (« flashcard : recto et verso
		   visibles » ne change donc rien ici, c'était déjà le cas). */
		const back = ajouter(card, "div", "quiz-flashcard-back");
		ajouter(back, "div", "quiz-textonly-label", t("engine.flashcard.back"));
		if (q.answer && q.answer.trim()) {
			const ansEl = ajouter(back, "div", "quiz-flashcard-answer");
			inlineInto(ansEl, q.answer, opts.sourcePath);
			if (opts.corrige) ansEl.setAttribute("data-edit", "answer");
		} else {
			const missing = ajouter(back, "div", "quiz-flashcard-missing", t("engine.flashcard.missingAnswer"));
			if (opts.corrige) missing.setAttribute("data-edit", "answer");
		}
	}

	if (type === "numeric") {
		/* Un champ nu, comme le moteur — et RIEN d'autre. L'unité n'est pas un
		   décor : c'est un suffixe ACCEPTÉ à la correction (engine/numeric.ts),
		   au même titre que la marge de tolérance et les réponses. L'afficher
		   ici montrerait à l'auteur un élément que l'apprenant ne voit pas, et
		   soufflerait la forme attendue de la réponse. */
		const wrap = ajouter(card, "div", "qcm-options quiz-text-wrap");
		const ta = ajouter(wrap, "textarea", "quiz-textarea" + (opts.corrige ? " correct" : ""));
		ta.readOnly = true;
		ta.setAttribute("aria-readonly", "true");
		ta.rows = 1;
		ta.placeholder = q.placeholder || "";
		if (opts.corrige) {
			const { primary, variantsHtml } = acceptedAnswersCorrige(q);
			ta.value = primary;
			ta.setAttribute("data-edit", "accepted");
			ta.setAttribute("data-index", "0");
			if (variantsHtml) wrap.insertAdjacentHTML("afterend", variantsHtml);
		} else {
			ta.value = "";
		}
	}

	if (type === "text") {
		if (usesMathField(q)) {
			// Question math : le même éditeur d'équations que le quiz, en
			// lecture seule, gabarit affiché s'il existe (ou la réponse
			// acceptée, en corrigé — même priorité que createMathField : la
			// valeur l'emporte sur le gabarit).
			const mathWrap = ajouter(card, "div", "qcm-options quiz-text-wrap quiz-math-wrap" + (opts.corrige ? " correct" : ""));
			const accepted = opts.corrige ? acceptedAnswersCorrige(q) : null;
			createMathField(mathWrap, {
				readOnly: true,
				value: accepted?.primary || "",
				// `_extraFields` est un sac non typé : on ne garde le gabarit que
				// s'il est une chaîne, le type réel de `template`.
				template: [q._extraFields?.answerTemplate, q.answerTemplate].find((v): v is string => typeof v === "string") ?? "",
			});
			if (opts.corrige) {
				mathWrap.setAttribute("data-edit", "accepted");
				mathWrap.setAttribute("data-index", "0");
				if (accepted?.variantsHtml) mathWrap.insertAdjacentHTML("afterend", accepted.variantsHtml);
			}
		} else {
			const textWrap = ajouter(card, "div", "qcm-options quiz-text-wrap");
			const ta = ajouter(textWrap, "textarea", "quiz-textarea" + (opts.corrige ? " correct" : ""));
			ta.readOnly = true;
			ta.setAttribute("aria-readonly", "true");
			ta.placeholder = q.placeholder || t("editor.text.defaultPlaceholder");
			if (opts.corrige) {
				const { primary, variantsHtml } = acceptedAnswersCorrige(q);
				ta.value = primary;
				ta.setAttribute("data-edit", "accepted");
				ta.setAttribute("data-index", "0");
				if (variantsHtml) textWrap.insertAdjacentHTML("afterend", variantsHtml);
			} else {
				ta.value = "";
			}
		}
	}

	if (type === "cmd" || type === "powershell" || type === "bash") {
		const shellWrap = ajouter(card, "div", "qcm-options quiz-text-wrap quiz-text-wrap-command");
		const shell = ajouter(shellWrap, "div", "quiz-command-shell quiz-terminal-variant-" + type + (opts.corrige ? " correct" : ""));
		if (type === "bash") {
			const prefixSpan = ajouter(shell, "span", "quiz-command-prefix quiz-command-prefix-bash");
			prefixSpan.innerHTML = '<span class="quiz-bash-prefix-userhost">user@hostname</span><span class="quiz-bash-prefix-colon">:</span><span class="quiz-bash-prefix-path">~</span><span class="quiz-bash-prefix-dollar">$ </span>';
		} else {
			ajouter(shell, "span", "quiz-command-prefix", q.commandPrefix || (type === "cmd" ? "C:\\>" : "PS>"));
		}
		const inputWrap = ajouter(shell, "div", "quiz-command-input-wrap");
		const cmdTa = ajouter(inputWrap, "textarea", "quiz-textarea quiz-textarea-command");
		cmdTa.readOnly = true;
		cmdTa.rows = 1;
		cmdTa.wrap = "off";
		if (opts.corrige) {
			const { primary, variantsHtml } = acceptedAnswersCorrige(q);
			cmdTa.value = primary;
			cmdTa.setAttribute("data-edit", "accepted");
			cmdTa.setAttribute("data-index", "0");
			if (variantsHtml) shellWrap.insertAdjacentHTML("afterend", variantsHtml);
		}
	}

	if (opts.onHint && q.hint && q.hint.trim()) {
		const hint = q.hint;
		const hintBtn = ajouter(card, "button", "quiz-hint-btn", t("editor.hint.label"));
		hintBtn.type = "button";
		hintBtn.addEventListener("click", () => opts.onHint?.(hint));
	}

	// L'explication ne s'affiche qu'en corrigé : elle contient la réponse (le
	// quiz réel ne la montre qu'après validation, et l'aperçu initial ne
	// distingue toujours pas la bonne réponse — demande d'Ahmed inchangée).
	if (opts.corrige) {
		const explainHtml = explainCorrigeHtml(q, opts.sourcePath);
		if (explainHtml) card.insertAdjacentHTML("beforeend", explainHtml);
	}

	// LaTeX $...$ / $$...$$ : même rendu MathJax natif que le moteur.
	void mathifyElement(card);
	return card;
}
