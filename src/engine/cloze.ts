import type { EngineCtx } from "../types/engine-ctx";
import type { ClozeQuestion } from "../types/quiz";
import { t } from "../i18n";

/* ══════════════════════════════════════════════════════════
   TEXTE À TROUS — la question la plus courante d'un contrôle écrit, et la
   seule forme classique que le format ne savait pas exprimer.

   Gabarit : le texte, avec chaque trou entre doubles accolades.
     cloze: "La capitale de la France est {{Paris}}, sa monnaie {{l'euro|euro}}."

   Doubles ACCOLADES et non doubles crochets : `[[…]]` est le lien interne
   d'Obsidian et `![[…]]` son embed — un gabarit écrit avec des crochets
   serait réécrit par le vault avant d'atteindre le moteur.

   Les variantes acceptées se séparent par « | ». La comparaison passe par la
   même normalisation que les réponses libres (accents, casse, écriture
   décimale) : un trou n'est pas plus sévère qu'une question texte.

   Toutes les cases ont la MÊME largeur, jamais celle de la réponse : une
   case dimensionnée sur son contenu donne la longueur du mot cherché.
══════════════════════════════════════════════════════════ */

/** Un trou du gabarit : ses réponses acceptées, dans l'ordre d'écriture. */
export interface ClozeBlank {
	answers: string[];
}

/** Gabarit découpé : du texte, des trous, dans l'ordre de lecture. */
export type ClozeSegment =
	| { type: "text"; value: string }
	| { type: "blank"; index: number };

export interface ParsedCloze {
	segments: ClozeSegment[];
	blanks: ClozeBlank[];
}

export interface ClozeHandlers {
	parseCloze(template: unknown): ParsedCloze;
	getBlanks(q: ClozeQuestion): ClozeBlank[];
	clozeCardHtml(q: ClozeQuestion, qi: number): string;
	bindClozeQuestion(trackItem: HTMLElement, qi: number): void;
	isBlankCorrect(q: ClozeQuestion, blankIndex: number, value: unknown): boolean;
	isClozeCorrect(q: ClozeQuestion, sel: unknown): boolean;
	getClozeAnswers(q: ClozeQuestion): string[];
}

/* La largeur des cases est UNIFORME et vit dans le CSS (.quiz-cloze-input),
   pas ici : une largeur en style inline ne se surcharge pas, et l'écran étroit
   d'un téléphone en demande une plus petite. Le moteur dit qu'il y a un trou,
   la feuille de style dit quelle place il prend. */

/* A blank's answers may hold braces, two levels deep: a model writes
   `{{\frac{1}{3}|1/3}}`. Without them (2026-09-28), that blank was not a blank
   at all and showed as raw text in the middle of its formula. */
const BLANK_RE = /\{\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}\}/g;

/* Découpe du gabarit — hors de la factory : l'APERÇU d'une question (page
   d'un quiz, éditeur) doit montrer les trous, et il n'a pas de moteur sous
   la main. Une seconde lecture maison finirait par diverger de celle-ci. */
export function parseCloze(template: unknown): ParsedCloze {
	const raw = String(template ?? "");
	const segments: ClozeSegment[] = [];
	const blanks: ClozeBlank[] = [];

	let lastIndex = 0;
	let match: RegExpExecArray | null;
	BLANK_RE.lastIndex = 0;
	while ((match = BLANK_RE.exec(raw)) !== null) {
		if (match.index > lastIndex) {
			segments.push({ type: "text", value: raw.slice(lastIndex, match.index) });
		}
		const answers = String(match[1] ?? "")
			.split("|")
			.map(a => a.trim())
			.filter(a => a.length > 0);
		// Un trou sans aucune réponse ({{}}) n'est pas un trou : il ne
		// pourrait jamais être juste. Rendu comme du texte littéral.
		if (answers.length === 0) {
			segments.push({ type: "text", value: match[0] });
		} else {
			segments.push({ type: "blank", index: blanks.length });
			blanks.push({ answers });
		}
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < raw.length) segments.push({ type: "text", value: raw.slice(lastIndex) });

	return { segments, blanks };
}

/* Jeton posé à la place d'un trou, le temps du rendu markdown.
   ZONE PRIVÉE (U+E000/U+E001) et non U+0000 : un marqueur fait de caractères
   NULS ne survit pas à un aller-retour `innerHTML` — l'analyseur HTML les
   remplace ou les jette, et l'aperçu affichait alors « CLOZE0 » en toutes
   lettres au milieu de la phrase (constaté sur une génération). Les
   caractères de zone privée traversent l'échappement HTML, le rendu markdown
   ET l'analyseur, et aucun texte de quiz réel n'en contient. */
const SLOT_OPEN = String.fromCharCode(0xE000);
const SLOT_CLOSE = String.fromCharCode(0xE001);
const SLOT_RE = new RegExp(SLOT_OPEN + "(\\d+)" + SLOT_CLOSE, "g");

/**
 * Le gabarit avec ses trous remplacés par des JETONS, prêt à passer par le
 * rendu markdown D'UN SEUL TENANT.
 *
 * Rendre chaque segment séparément — ce que faisait la première version —
 * coupe les paires markdown à la frontière d'un trou : dans
 * `` `git {{checkout}} -b` ``, chaque moitié n'a qu'un accent grave, et les
 * deux s'affichent bruts. En marquant puis en rendant le tout, la paire est
 * intacte et le trou se retrouve À L'INTÉRIEUR du `<code>`, là où il doit
 * être.
 */
export function markSlots(template: unknown): { marked: string; blanks: ClozeBlank[] } {
	const blanks: ClozeBlank[] = [];
	const marked = String(template ?? "").replace(BLANK_RE, (whole, inner: string) => {
		const answers = String(inner ?? "").split("|").map(a => a.trim()).filter(a => a.length > 0);
		// Même règle que parseCloze : `{{}}` n'est pas un trou, il ne pourrait
		// jamais être juste — il reste du texte littéral.
		if (answers.length === 0) return whole;
		blanks.push({ answers });
		return SLOT_OPEN + (blanks.length - 1) + SLOT_CLOSE;
	});
	return { marked: splitMathAroundSlots(marked), blanks };
}

const SLOT_SPLIT_RE = new RegExp(SLOT_OPEN + "(\\d+)" + SLOT_CLOSE);

/**
 * A blank INSIDE a formula (`$du = {{3}}dx$`) closes the formula before it and
 * reopens it after (`$du =$ ▢ $dx$`). Rendered whole, the formula carried the
 * blank's input into its TeX, and both halves showed as raw LaTeX
 * (2026-09-28, a generated quiz on integrals). Code spans are copied as they
 * are: a `$` in a command (`$HOME`) is not math.
 */
export function splitMathAroundSlots(marked: string): string {
	let out = "";
	let i = 0;
	while (i < marked.length) {
		const ch = marked[i];
		if (ch === "`") {
			const end = marked.indexOf("`", i + 1);
			if (end < 0) return out + marked.slice(i);
			out += marked.slice(i, end + 1);
			i = end + 1;
			continue;
		}
		if (ch === "\\" && marked[i + 1] === "$") {
			out += "\\$";
			i += 2;
			continue;
		}
		if (ch !== "$") {
			out += ch;
			i++;
			continue;
		}
		const delim = marked[i + 1] === "$" ? "$$" : "$";
		let end = i + delim.length;
		while (end < marked.length && !(marked.startsWith(delim, end) && marked[end - 1] !== "\\")) end++;
		if (end >= marked.length) return out + marked.slice(i);
		const body = marked.slice(i + delim.length, end);
		if (!SLOT_SPLIT_RE.test(body)) {
			out += marked.slice(i, end + delim.length);
		} else {
			// Captured indices sit at odd positions; each piece of formula
			// becomes its own inline formula, a blank piece stays as it is.
			out += body.split(SLOT_SPLIT_RE).map((part, k) => k % 2 === 1
				? SLOT_OPEN + part + SLOT_CLOSE
				: part.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_m, lead: string, tex: string, trail: string) =>
					tex ? `${lead}$${tex}$${trail}` : lead + trail)).join("");
		}
		i = end + delim.length;
	}
	return out;
}

/* A whole line of code between backticks — what the generator writes for a
   fill-in-the-blanks on code (one pair per line). */
const CODE_LINE_RE = /^\s*`([^`]*)`\s*$/;

/**
 * The marked template, rendered as a CODE BLOCK when every non-empty line is
 * a whole line of code between backticks; `null` otherwise.
 *
 * Through the markdown rendering, those lines became as many paragraphs
 * separated by a margin, each an inline `<code>` that collapses leading
 * spaces: the indentation vanished, and a Python loop body read at the level
 * of its `for` (2026-09-27). A `<pre>` keeps the lines tight and the
 * indentation, as in the editor. The blank tokens survive the escaping:
 * `fillSlots` then replaces them as everywhere else.
 */
export function codeClozeHtml(marked: string): string | null {
	const lines = marked.replace(/\r\n?/g, "\n").split("\n");
	while (lines.length > 0 && !lines[0].trim()) lines.shift();
	while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
	if (lines.length === 0) return null;
	const code: string[] = [];
	for (const line of lines) {
		if (!line.trim()) { code.push(""); continue; }
		const m = CODE_LINE_RE.exec(line);
		if (!m) return null;
		code.push(m[1].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
	}
	return `<pre class="quiz-cloze-code"><code>${code.join("\n")}</code></pre>`;
}

/* A blank INSIDE a fenced code block (```c … ```): the rule is that any code
   goes in a block naming its language, so that it gets that language's logo
   and colours (2026-09-29). The highlighter, though, cuts a blank's token (a
   private-use character around its number) — `return {{0}};` gave
   `<span class="token number">0</span>` between the two characters, and the
   blank was gone. Inside a fence, each token becomes a plain IDENTIFIER the
   highlighter keeps whole, and comes back after the rendering. Only inside a
   fence: in prose, `__…__` is bold. */
const FENCE_RE = /^([ \t]*)(`{3,})[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*$/gm;
const SLOT_IDENT_RE = /__NQ_SLOT_(\d+)__/g;

/** The marked template, its blank tokens inside fenced code blocks turned into
    identifiers the highlighter does not split (`restoreCodeSlots` undoes it). */
export function protectCodeSlots(marked: string): string {
	return marked.replace(FENCE_RE, bloc => bloc.replace(SLOT_RE, (_m, n: string) => `__NQ_SLOT_${n}__`));
}

/** The rendered HTML, the identifiers of `protectCodeSlots` back to tokens. */
export function restoreCodeSlots(html: string): string {
	return html.replace(SLOT_IDENT_RE, (_m, n: string) => SLOT_OPEN + n + SLOT_CLOSE);
}

/** Remplace les jetons du HTML rendu par ce que `slot` produit pour chacun. */
export function fillSlots(html: string, slot: (index: number) => string): string {
	return html.replace(SLOT_RE, (_m, n: string) => slot(Number(n)));
}

export function createClozeHandlers(ctx: EngineCtx): ClozeHandlers {

	const getBlanks = (q: ClozeQuestion): ClozeBlank[] => parseCloze(q?.cloze).blanks;

	/** Les réponses attendues, une chaîne par trou (première variante) — sert au
	    récapitulatif de correction et à l'export des résultats. */
	const getClozeAnswers = (q: ClozeQuestion): string[] =>
		getBlanks(q).map(b => b.answers[0] ?? "");

	function isBlankCorrect(q: ClozeQuestion, blankIndex: number, value: unknown): boolean {
		const blank = getBlanks(q)[blankIndex];
		if (!blank) return false;
		const opts = { caseSensitive: !!q.caseSensitive };
		const given = ctx.terminal.normalizeTextAnswer(value, opts);
		if (!given) return false;
		return blank.answers.some(a => ctx.terminal.normalizeTextAnswer(a, opts) === given);
	}

	function isClozeCorrect(q: ClozeQuestion, sel: unknown): boolean {
		const blanks = getBlanks(q);
		if (blanks.length === 0) return false;
		if (!Array.isArray(sel) || sel.length !== blanks.length) return false;
		return blanks.every((_, i) => isBlankCorrect(q, i, sel[i]));
	}

	function clozeCardHtml(q: ClozeQuestion, qi: number): string {
		const { marked, blanks } = markSlots(q.cloze);
		const sel = ctx.quizState.selections[qi];
		const values: unknown[] = Array.isArray(sel) ? sel : [];
		const locked = ctx.isRevealed(qi);
		/* A CHARACTER LIMIT (2026-09-29): nothing stopped a blank from taking
		   a whole paragraph. ONE limit for every blank of the question — the
		   longest accepted answer plus some room, 24 at least — so that it
		   never tells the length of a particular answer. */
		const maxLength = Math.max(24, ...blanks.flatMap(b => b.answers.map(a => a.length + 8)));

		// Le gabarit ENTIER passe par le rendu (markdown + images), trous
		// marqués : une paire `…` ou **…** qui enjambe un trou reste une paire.
		const rendered = codeClozeHtml(marked) ?? restoreCodeSlots(ctx.sanitize.renderTextWithEmbeds(protectCodeSlots(marked), {
			wrapClass: "quiz-cloze-embed-wrap",
			imgClass: "quiz-cloze-embed"
		}));

		const body = fillSlots(rendered, (index) => {
			const value = String(values[index] ?? "");
			// Un trou REMPLI se distingue des trous encore vides sans attendre
			// la correction (demande Ahmed 2026-07-31) : la classe porte cet
			// état, le CSS lui donne son fond et sa bordure pleine.
			let cls = "quiz-cloze-input" + (value.trim() ? " is-filled" : "");
			let expected = "";
			if (locked) {
				const ok = isBlankCorrect(q, index, value);
				cls += ok ? " correct" : " wrong";
				// La bonne réponse ne s'affiche qu'à côté d'un trou raté : la
				// rappeler partout noierait la correction.
				if (!ok) {
					const answer = blanks[index]?.answers[0] ?? "";
					expected = `<span class="quiz-cloze-expected">${ctx.sanitize.renderInlineText(answer)}</span>`;
				}
			}

			return `<span class="quiz-cloze-slot"><input class="${cls}" type="text" `
				+ `data-cloze="${index}" value="${ctx.escapeHtmlAttr(value)}" maxlength="${maxLength}" `
				+ `autocomplete="off" autocapitalize="off" spellcheck="false" `
				+ `aria-label="${ctx.escapeHtmlAttr(t("engine.cloze.blankAria", { n: index + 1 }))}"`
				+ `${locked ? " disabled" : ""}>${expected}</span>`;
		});

		// No "Fill in the N blanks" banner above (2026-09-27): the dashed
		// boxes already say that they are to be filled, and how many.
		return `<div class="quiz-cloze">${body}</div>`;
	}

	/** Toggles a blank's "filled" state, which firms up its outline
	    (cloze.css). No animation since 2026-09-29: a pop in the middle of a
	    line of code moved the text around it. */
	function markFilled(input: HTMLInputElement): void {
		input.classList.toggle("is-filled", input.value.trim().length > 0);
	}

	function bindClozeQuestion(trackItem: HTMLElement, qi: number): void {
		const q = ctx.quiz[qi] as ClozeQuestion;
		const blanks = getBlanks(q);

		// La sélection doit avoir exactement une case par trou : un gabarit
		// modifié entre deux rendus laisserait sinon un tableau désaligné.
		const sel = ctx.quizState.selections[qi];
		if (!Array.isArray(sel) || sel.length !== blanks.length) {
			ctx.quizState.selections[qi] = new Array<string>(blanks.length).fill("");
		}

		const inputs = trackItem.querySelectorAll<HTMLInputElement>(".quiz-cloze-input[data-cloze]");
		inputs.forEach(input => {
			const bi = Number(input.dataset.cloze);
			if (!Number.isFinite(bi)) return;

			input.addEventListener("input", () => {
				if (ctx.isRevealed(qi)) return;
				const current = ctx.quizState.selections[qi];
				if (!Array.isArray(current)) return;
				ctx.invalidateSavedResults?.();
				(current as unknown as string[])[bi] = input.value;
				markFilled(input);
				ctx.updateNavHighlight();
				ctx.refreshMetaSlides();
			});

			/* Entrée passe au trou suivant, et au dernier ne soumet rien : la
			   frappe d'un texte à trous est continue, une validation
			   accidentelle en plein milieu coûterait la question. */
			input.addEventListener("keydown", e => {
				if (e.key !== "Enter") return;
				e.preventDefault();
				const next = inputs[bi + 1];
				if (next) next.focus();
				else input.blur();
			});
		});
	}

	return {
		parseCloze,
		getBlanks,
		clozeCardHtml,
		bindClozeQuestion,
		isBlankCorrect,
		isClozeCorrect,
		getClozeAnswers
	};
}
