import type { EngineCtx } from "../types/engine-ctx";
import type { QuizQuestion, TextQuestion } from "../types/quiz";
import { isMathQuestion, usesMathField, matchesMathAnswer, createMathField } from "./math-input";
import { isNumericQuestion, matchesNumericAnswer, isPurelyNumeric, parseNumericValue, latexEnNombre } from "./numeric";
import type { NumericQuestion } from "./numeric";
import { t } from "../i18n";

export interface TerminalVisualTokens {
	leading: string;
	command: string;
	rest: string;
}

export interface TerminalHandlers {
	normalizeTerminalVariantName(value: unknown): string | null;
	getTerminalTextVariant(q: QuizQuestion): string | null;
	isTerminalTextQuestion(q: QuizQuestion): boolean;
	isCommandTextQuestion(q: QuizQuestion): boolean;
	getTerminalPromptPrefix(q: TextQuestion): string;
	renderTerminalPromptPrefixHtml(q: TextQuestion): string;
	getTextMaxLength(q: TextQuestion): number | null;
	sliceToMaxChars(value: unknown, maxLength: number | null): string;
	sanitizeTextAnswerValue(q: TextQuestion, value: unknown): string;
	getTextAcceptedAnswers(q: TextQuestion): string[];
	normalizeTextAnswer(value: unknown, opts?: { caseSensitive?: boolean }): string;
	isTextAnswerCorrect(q: TextQuestion, value: unknown): boolean;
	syncTextAreaHeight(textarea: HTMLTextAreaElement | null): void;
	splitTerminalVisualTokens(value: unknown, variant: string | null): TerminalVisualTokens;
	textQuestionCardHtml(q: TextQuestion, qi: number): string;
	bindTextQuestion(trackItem: HTMLElement, qi: number): void;
}

/**
 * Nom de variante de terminal, ramené à sa forme canonique.
 *
 * Vit au niveau du MODULE, et EXPORTÉ, parce que l'éditeur en a besoin autant
 * que le moteur : `editor/convert.ts` ne reconnaissait que `terminalVariant:
 * 'cmd'`, `textVariant: 'powershell'` et `textVariant: 'bash'` — trois formes
 * exactes. Les 22 questions Cisco d'Ahmed écrivent `textVariant: 'command'`,
 * que le moteur affiche bien en terminal `cmd` mais que l'éditeur prenait pour
 * du texte ordinaire : la première sauvegarde effaçait la variante ET son
 * invite (`Town-Hall#`, `Router>`…). Une seule table d'alias, deux lecteurs.
 */
export function normalizeTerminalVariantName(value: unknown): string | null {
	const raw = String(value ?? "").trim().toLowerCase();
	if (!raw) return null;

	if ([
		"command",
		"cmd",
		"windows-cmd",
		"windows cmd",
		"invite-de-commandes",
		"invite de commandes"
	].includes(raw)) return "cmd";

	if ([
		"powershell",
		"ps",
		"pwsh",
		"windows-powershell",
		"windows powershell",
		"power-shell",
		"power shell"
	].includes(raw)) return "powershell";

	if ([
		"bash",
		"shell",
		"sh",
		"zsh",
		"terminal",
		"linux"
	].includes(raw)) {
		return (raw === "terminal" || raw === "linux") ? "bash" : raw;
	}

	return raw.replace(/\s+/g, "-");
}


export function createTerminalHandlers(ctx: EngineCtx): TerminalHandlers {
	// Variable locale au module (conservée à l'identique du JS ; jamais relue).
	let __quizTextQuestionCleanup: (() => void) | null = null;

	// ═══════════════════════════════════════════════════════
	// FONCTIONS PURES (sans dépendances externes)
	// ═══════════════════════════════════════════════════════

	function getTerminalTextVariant(q: QuizQuestion): string | null {
		if (!ctx.isTextQuestion(q)) return null;

		const candidates = [
			q?.terminalVariant,
			q?.textVariant,
			q?.text?.variant,
			q?.terminal?.variant
		];

		for (const candidate of candidates) {
			const normalized = normalizeTerminalVariantName(candidate);
			if (normalized) return normalized;
		}

		if (q?.command === true) return "cmd";

		return null;
	}

	const isTerminalTextQuestion = (q: QuizQuestion): boolean => !!getTerminalTextVariant(q);

	const isCommandTextQuestion = (q: QuizQuestion): boolean => isTerminalTextQuestion(q);

	function getTerminalPromptPrefix(q: TextQuestion): string {
		const explicitPrefix = [
			q?.commandPrefix,
			q?.terminalPrefix,
			q?.promptPrefix,
			q?.terminal?.prefix
		].find(value => typeof value === "string" && value.length > 0);

		if (explicitPrefix) return explicitPrefix;

		const variant = getTerminalTextVariant(q);

		switch (variant) {
			case "cmd":
				return "C:\\>";

			case "powershell":
				return "PS>";

			case "bash":
				return "user@hostname:~$ ";

			case "zsh":
				return "user@hostname %";

			case "sh":
				return "$";
		}
		return "C:\\>";
	}

	function renderTerminalPromptPrefixHtml(q: TextQuestion): string {
		const promptPrefix = String(getTerminalPromptPrefix(q) ?? "");
		const variant = getTerminalTextVariant(q);

		if (variant === "bash") {
			const match = promptPrefix.match(/^([^:]+)(:)([^$]*)(\$ ?)$/);

			if (match) {
				const [, userHost, colon, pathPart, dollarPart] = match;

				/* `renderInlineText` sur CHAQUE segment, pas `escapeHtmlText` :
				   la forme colorée affichait ses `**` là où la forme simple les
				   rend depuis cette nuit. Segment par segment, donc une paire
				   qui enjamberait deux segments reste littérale — c'est le prix
				   de la coloration, et il est visible plutôt que silencieux. */
				const r = ctx.sanitize.renderInlineText;
				return '<span class="quiz-command-prefix quiz-command-prefix-bash">' +
					`<span class="quiz-bash-prefix-userhost">${r(userHost)}</span>` +
					`<span class="quiz-bash-prefix-colon">${r(colon)}</span>` +
					`<span class="quiz-bash-prefix-path">${r(pathPart)}</span>` +
					`<span class="quiz-bash-prefix-dollar">${r(dollarPart)}</span>` +
				'</span>';
			}
		}

		/* `renderInlineText` et non `escapeHtmlText` : c'est un `<span>`, donc le
		   markdown y a un sens. Un préfixe `**PS**>` s'affichait avec ses
		   étoiles. La forme `user@host:~$` ci-dessus garde son échappement nu —
		   elle est découpée en segments colorés, et le markdown n'a rien à y
		   faire. */
		return `<span class="quiz-command-prefix">${ctx.sanitize.renderInlineText(promptPrefix)}</span>`;
	}

	function getTextMaxLength(q: TextQuestion): number | null {
		const candidates = [
			q?.maxLength,
			q?.textMaxLength,
			q?.text?.maxLength,
			q?.commandMaxLength,
			q?.terminalMaxLength,
			q?.terminal?.maxLength
		];

		for (const value of candidates) {
			const n = Number(value);
			if (Number.isFinite(n) && n > 0) return Math.floor(n);
		}

		return null;
	}

	function sliceToMaxChars(value: unknown, maxLength: number | null): string {
		if (!Number.isFinite(maxLength) || (maxLength ?? 0) <= 0) return String(value ?? "");
		return Array.from(String(value ?? "")).slice(0, maxLength ?? 0).join("");
	}

	function sanitizeTextAnswerValue(q: TextQuestion, value: unknown): string {
		let out = String(value ?? "");

		if (isTerminalTextQuestion(q)) {
			out = out.replace(/[\r\n]+/g, "");
		}

		const maxLength = getTextMaxLength(q);
		if (Number.isFinite(maxLength) && (maxLength ?? 0) > 0) {
			out = sliceToMaxChars(out, maxLength);
		}

		return out;
	}

	function getTextAcceptedAnswers(q: TextQuestion): string[] {
		const values: unknown[] = [];

		if (Array.isArray(q?.acceptedAnswers)) values.push(...q.acceptedAnswers);
		if (Array.isArray(q?.acceptableAnswers)) values.push(...q.acceptableAnswers);
		if (Array.isArray(q?.correctAnswers)) values.push(...q.correctAnswers);
		if (typeof q?.correctText === "string") values.push(q.correctText);
		if (typeof q?.answer === "string") values.push(q.answer);

		return values
			.filter(v => v !== null && v !== undefined)
			.map(v => String(v));
	}

	function normalizeTextAnswer(value: unknown, { caseSensitive = false }: { caseSensitive?: boolean } = {}): string {
		let out = String(value ?? "")
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/\s+/g, " ")
			.trim();

		/* Une réponse entièrement numérique est ramenée à sa valeur : « 3,14 »
		   et « 3.14 » sont la MÊME écriture à la virgule décimale près, et un
		   élève francophone tape la virgule. Ne s'applique QU'AUX chaînes
		   purement numériques — un texte contenant une virgule n'est pas
		   touché. Aucune tolérance n'est introduite ici : ce n'est pas le mode
		   numérique, juste la fin d'un faux négatif de locale. */
		if (isPurelyNumeric(out)) {
			const parsed = parseNumericValue(out);
			if (parsed) return String(parsed.value);
		}

		if (!caseSensitive) out = out.toLowerCase();
		return out;
	}

	function isTextAnswerCorrect(q: TextQuestion, value: unknown): boolean {
		// Question math (éditeur d'équations) : comparaison de LaTeX
		// normalisé en FORME (math-input) — la normalisation texte
		// ci-dessous (strip accents, espaces→' ') casserait le LaTeX.
		if (isMathQuestion(q)) return matchesMathAnswer(value, q);

		const accepted = getTextAcceptedAnswers(q);
		if (!accepted.length) return false;

		// Question numérique DÉCLARÉE : la réponse est un nombre, comparé en
		// valeur à la marge près, l'unité acceptée en suffixe.
		// Saisie faite dans l'éditeur d'équations : du LaTeX, ramené à un nombre.
		if (isNumericQuestion(q)) return matchesNumericAnswer(q as NumericQuestion, accepted, usesMathField(q) ? latexEnNombre(value) : value);

		return accepted.some(expected =>
			normalizeTextAnswer(expected, { caseSensitive: !!q.caseSensitive }) ===
			normalizeTextAnswer(value, { caseSensitive: !!q.caseSensitive })
		);
	}

	function syncTextAreaHeight(textarea: HTMLTextAreaElement | null): void {
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${Math.max(220, textarea.scrollHeight)}px`;
	}

	function splitTerminalVisualTokens(value: unknown, variant: string | null): TerminalVisualTokens {
		const raw = String(value ?? "");

		if (variant !== "powershell") {
			return {
				leading: "",
				command: raw,
				rest: ""
			};
		}

		const match = raw.match(/^([ \t]*)(\S+)?([\s\S]*)$/);

		return {
			leading: match?.[1] ?? "",
			command: match?.[2] ?? "",
			rest: match?.[3] ?? ""
		};
	}

	// ═══════════════════════════════════════════════════════
	// FONCTIONS AVEC DÉPENDANCES (utilisent ctx)
	// ═══════════════════════════════════════════════════════

	function textQuestionCardHtml(q: TextQuestion, qi: number): string {
		const sel = ctx.quizState.selections[qi];
		const value = typeof sel === "string" ? sel : "";
		const terminalVariant = getTerminalTextVariant(q);
		const isTerminal = !!terminalVariant;
		const isPowerShell = terminalVariant === "powershell";
		const maxLength = getTextMaxLength(q);

		const statusClass = ctx.quizState.locked
			? (ctx.isCorrect(qi) ? "correct" : "wrong")
			: (value.trim() ? "filled" : "");

		const readOnlyAttr = ctx.quizState.locked ? `readonly aria-readonly="true"` : "";
		const maxLengthAttr = Number.isFinite(maxLength) ? `maxlength="${maxLength}"` : "";

		// `q.placeholder` vient du .md de l'utilisateur (donnée du quiz) : il prime
		// toujours. Seul le placeholder PAR DÉFAUT est traduit.
		//
		// `stripInlineMarkdown` et non `renderInlineText` : un attribut ne rend
		// aucune balise. « Réponds en **majuscules** » y montrait ses étoiles —
		// ici les marqueurs appariés TOMBENT, faute de pouvoir devenir du gras.
		const placeholder = ctx.escapeHtmlAttr(ctx.sanitize.stripInlineMarkdown(
			isTerminal ? (q?.placeholder || "") : (q?.placeholder || t("engine.text.placeholder"))
		));
		const textareaName = ctx.escapeHtmlAttr(q?.id || `q${qi + 1}`);

		if (isTerminal) {
			const promptPrefixHtml = renderTerminalPromptPrefixHtml(q);
			const variantClass = `quiz-terminal-variant-${ctx.escapeHtmlAttr(terminalVariant)}`;
			const variantAttr = ctx.escapeHtmlAttr(terminalVariant);

			const renderLayerHtml = isPowerShell
				? `<span class="quiz-command-render" aria-hidden="true"><span class="quiz-command-render-leading"></span><span class="quiz-command-render-command"></span><span class="quiz-command-render-rest"></span></span>`
				: "";

			return `
				<div class="qcm-options quiz-text-wrap quiz-text-wrap-command">
					<div class="quiz-command-shell ${variantClass} ${statusClass}" data-terminal-variant="${variantAttr}">
						${promptPrefixHtml}
						<div class="quiz-command-input-wrap">
							${renderLayerHtml}
							<span class="quiz-command-measure" aria-hidden="true"></span>
							<textarea
								class="quiz-textarea quiz-textarea-command"
								data-text-answer="1"
								data-command-answer="1"
								data-terminal-answer="1"
								data-terminal-variant="${variantAttr}"
								name="${textareaName}"
								placeholder="${placeholder}"
								spellcheck="false"
								autocapitalize="off"
								autocomplete="off"
								autocorrect="off"
								rows="1"
								wrap="off"
								${maxLengthAttr}
								${readOnlyAttr}
							>${ctx.escapeHtmlText(value)}</textarea>
							<span class="quiz-command-selection" aria-hidden="true"></span>
							<span class="quiz-command-inline-char" aria-hidden="true"></span>
							<span class="quiz-command-caret" aria-hidden="true"></span>
						</div>
					</div>
				</div>`;
		}

		// Question math, ou numérique posée en LaTeX : HOST vide — le
		// <math-field> (custom element à configurer) est créé au bind,
		// jamais via innerHTML.
		if (usesMathField(q)) {
			return `
				<div class="qcm-options quiz-text-wrap quiz-math-wrap ${statusClass}" data-math-input="1"></div>`;
		}

		return `
			<div class="qcm-options quiz-text-wrap">
				<textarea
					class="quiz-textarea ${statusClass}"
					data-text-answer="1"
					name="${textareaName}"
					placeholder="${placeholder}"
					spellcheck="${q?.spellcheck === true ? "true" : "false"}"
					autocapitalize="off"
					autocomplete="off"
					autocorrect="off"
					${maxLengthAttr}
					${readOnlyAttr}
				>${ctx.escapeHtmlText(value)}</textarea>
			</div>`;
	}

	/* Question math : monte le <math-field> + panneau dans le host émis
	   par textQuestionCardHtml. Même cycle de vie que la textarea :
	   selections[qi] à chaque saisie, statut live, cleanup au refresh. */
	function bindMathQuestion(trackItem: HTMLElement, qi: number, host: HTMLElement): void {
		// Invariant : bindMathQuestion n'est atteint que pour une question math (TextQuestion).
		const q = ctx.quiz[qi] as TextQuestion;

		const applyStatus = (latex: string) => {
			host.classList.remove("filled", "correct", "wrong");
			if (ctx.quizState.locked) {
				host.classList.add(isTextAnswerCorrect(q, latex) ? "correct" : "wrong");
			} else if (String(latex || "").trim()) {
				host.classList.add("filled");
			}
		};

		const selValue = ctx.quizState.selections[qi];
		const field = createMathField(host, {
			value: typeof selValue === "string" ? selValue : "",
			// Gabarit guidé optionnel de l'IA (« x = ▯ ») — seulement si
			// l'élève n'a encore rien saisi.
			template: q?.answerTemplate || "",
			readOnly: !!ctx.quizState.locked,
			// Même raison qu'au champ texte : MathLive affiche ce placeholder
			// comme du texte nu, pas comme du HTML.
			placeholder: ctx.sanitize.stripInlineMarkdown(q?.placeholder || ""),
			onInput: (latex) => {
				if (ctx.quizState.locked) return;
				ctx.invalidateSavedResults?.();
				ctx.quizState.selections[qi] = latex;
				applyStatus(latex);
				if (!ctx.quizState.isSliding) {
					ctx.updateNavHighlight();
					ctx.cards.refreshMetaSlides();
				}
			},
			onEnter: () => {
				if (ctx.quizState.isSliding || ctx.quizState.locked) return;
				if (qi < ctx.quiz.length - 1) ctx.goToQuestion(qi + 1);
			},
		});
		applyStatus(field.getValue());

		trackItem.__quizTextQuestionCleanup = () => {
			field.destroy();
			trackItem.__quizTextQuestionCleanup = null;
		};
	}

	function bindTextQuestion(trackItem: HTMLElement, qi: number): void {
		if (!trackItem) return;

		if (typeof trackItem.__quizTextQuestionCleanup === "function") {
			try { trackItem.__quizTextQuestionCleanup(); } catch (_) { /* cleanup best-effort */ }
			trackItem.__quizTextQuestionCleanup = null;
		}

		const mathHost = trackItem.querySelector<HTMLElement>("[data-math-input]");
		if (mathHost) {
			bindMathQuestion(trackItem, qi, mathHost);
			return;
		}

		const textarea = trackItem.querySelector<HTMLTextAreaElement>(".quiz-textarea[data-text-answer]");
		if (!textarea) return;

		// Invariant : bindTextQuestion n'est atteint que pour une question texte.
		const q = ctx.quiz[qi] as TextQuestion;
		const terminalVariant = getTerminalTextVariant(q);
		const isCommand = isCommandTextQuestion(q);
		const isPowerShell = terminalVariant === "powershell";

		const shell = trackItem.querySelector<HTMLElement>(".quiz-command-shell");
		const inputWrap = trackItem.querySelector<HTMLElement>(".quiz-command-input-wrap");
		const measure = trackItem.querySelector<HTMLElement>(".quiz-command-measure");
		const inlineChar = trackItem.querySelector<HTMLElement>(".quiz-command-inline-char");
		const selectionOverlay = trackItem.querySelector<HTMLElement>(".quiz-command-selection");

		const renderLayer = trackItem.querySelector<HTMLElement>(".quiz-command-render");
		const renderLeading = trackItem.querySelector<HTMLElement>(".quiz-command-render-leading");
		const renderCommand = trackItem.querySelector<HTMLElement>(".quiz-command-render-command");
		const renderRest = trackItem.querySelector<HTMLElement>(".quiz-command-render-rest");

		const measureWidth = (text: string): number => {
			if (!isCommand || !measure) return 0;
			measure.textContent = text || "";
			return measure.getBoundingClientRect().width || 0;
		};

		const normalizeTextareaValue = ({ preserveSelection = true }: { preserveSelection?: boolean } = {}): string => {
			const rawValue = textarea.value ?? "";
			const rawStart = typeof textarea.selectionStart === "number" ? textarea.selectionStart : rawValue.length;
			const rawEnd = typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : rawStart;

			const sanitized = sanitizeTextAnswerValue(q, rawValue);

			if (sanitized !== rawValue) {
				textarea.value = sanitized;

				if (preserveSelection) {
					const maxPos = sanitized.length;
					const nextStart = Math.max(0, Math.min(rawStart, maxPos));
					const nextEnd = Math.max(0, Math.min(rawEnd, maxPos));

					try {
						textarea.setSelectionRange(nextStart, nextEnd);
					} catch (_) { /* setSelectionRange peut jeter sur textarea détaché */ }
				}
			}

			return textarea.value ?? "";
		};

		const getLiveTextStatus = (): string => {
			const currentValue = String(textarea.value ?? "");

			if (ctx.quizState.locked) {
				return isTextAnswerCorrect(q, currentValue) ? "correct" : "wrong";
			}

			return currentValue.trim().length > 0 ? "filled" : "";
		};

		const applyLiveTextStatusClasses = (): void => {
			const status = getLiveTextStatus();

			[textarea, shell].filter((el): el is HTMLElement => !!el).forEach(el => {
				el.classList.remove("filled", "correct", "wrong");
				if (status) el.classList.add(status);
			});
		};

		const updateTerminalRenderLayer = (): void => {
			if (!isPowerShell || !shell || !renderLayer) return;

			const value = String(textarea.value ?? "");
			const parts = splitTerminalVisualTokens(value, terminalVariant);

			if (renderLeading) renderLeading.textContent = parts.leading || "";
			if (renderCommand) renderCommand.textContent = parts.command || "";
			if (renderRest) renderRest.textContent = parts.rest || "";

			renderLayer.style.transform = `translate3d(${-Math.max(0, textarea.scrollLeft || 0)}px, 0, 0)`;

			const hasCommandToken = !!(parts.command && parts.command.length > 0);

			shell.setAttribute("data-ps-render", hasCommandToken ? "1" : "0");
			shell.setAttribute("data-render-ready", hasCommandToken ? "1" : "0");

			renderLayer.style.opacity = hasCommandToken ? "1" : "0";
			renderLayer.style.visibility = hasCommandToken ? "visible" : "hidden";
		};

		const ensureCommandVisualRangeVisible = (): void => {
			if (!isCommand || !textarea || !measure) return;

			const value = textarea.value ?? "";
			const rawStart = typeof textarea.selectionStart === "number" ? textarea.selectionStart : value.length;
			const rawEnd = typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : rawStart;

			const start = Math.max(0, Math.min(rawStart, value.length));
			const end = Math.max(0, Math.min(rawEnd, value.length));

			const rangeStart = Math.min(start, end);
			const rangeEnd = Math.max(start, end);

			const startPx = measureWidth(value.slice(0, rangeStart));
			const endPx = measureWidth(value.slice(0, rangeEnd));

			const visibleWidth = Math.max(0, textarea.clientWidth || 0);
			const leftVisible = textarea.scrollLeft || 0;
			const rightVisible = leftVisible + visibleWidth;

			const fontSize = parseFloat(getComputedStyle(textarea).fontSize) || 16;
			const rightSafety = Math.max(12, fontSize);
			const leftSafety = 2;

			if (rangeEnd > rangeStart) {
				if (endPx + rightSafety > rightVisible) {
					textarea.scrollLeft = Math.max(0, endPx - visibleWidth + rightSafety);
				}
				else if (startPx - leftSafety < leftVisible) {
					textarea.scrollLeft = Math.max(0, startPx - leftSafety);
				}
				return;
			}

			if (startPx + rightSafety > rightVisible) {
				textarea.scrollLeft = Math.max(0, startPx - visibleWidth + rightSafety);
			}
			else if (startPx - leftSafety < leftVisible) {
				textarea.scrollLeft = Math.max(0, startPx - leftSafety);
			}
		};

		const updateCommandVisuals = (): void => {
			if (!isCommand || !shell || !inputWrap || !measure) return;

			const value = textarea.value ?? "";
			const rawStart = typeof textarea.selectionStart === "number" ? textarea.selectionStart : value.length;
			const rawEnd = typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : rawStart;

			const start = Math.max(0, Math.min(rawStart, value.length));
			const end = Math.max(0, Math.min(rawEnd, value.length));
			const rangeStart = Math.min(start, end);
			const rangeEnd = Math.max(start, end);
			const isSelectionRange = rangeEnd > rangeStart;

			const beforeRange = value.slice(0, rangeStart);
			const selectedText = value.slice(rangeStart, rangeEnd);
			const scrollLeft = textarea.scrollLeft || 0;
			const visibleWidth = Math.max(0, textarea.clientWidth || inputWrap.clientWidth || 0);

			const computedShell = getComputedStyle(shell);
			const computedTextarea = getComputedStyle(textarea);
			const fontSize = parseFloat(computedTextarea.fontSize) || 16;
			const fallbackCharWidth = Math.max(8, fontSize * 0.62);

			const caretWidthEndRaw = parseFloat(computedShell.getPropertyValue("--cmd-caret-width-end"));
			const caretWidthInlineRaw = parseFloat(computedShell.getPropertyValue("--cmd-caret-width-inline"));

			const caretWidthEnd = Number.isFinite(caretWidthEndRaw) && caretWidthEndRaw > 0
				? caretWidthEndRaw
				: fallbackCharWidth;

			const caretWidthInline = Number.isFinite(caretWidthInlineRaw) && caretWidthInlineRaw > 0
				? caretWidthInlineRaw
				: fallbackCharWidth;

			const beforeRangeWidth = measureWidth(beforeRange);
			const selectedWidth = isSelectionRange ? Math.max(1, measureWidth(selectedText)) : 0;

			const isFocused = document.activeElement === textarea && !ctx.quizState.locked;
			const isCollapsed = rangeStart === rangeEnd;
			const hasInlineChar = rangeStart < value.length;

			let visualWidth = caretWidthEnd;
			if (isSelectionRange) visualWidth = selectedWidth;
			else if (hasInlineChar) visualWidth = caretWidthInline;

			const rawVisualX = beforeRangeWidth - scrollLeft;
			const maxX = Math.max(0, visibleWidth - Math.max(1, visualWidth));
			const visualX = Math.max(0, Math.min(rawVisualX, maxX));

			inputWrap.style.setProperty("--cmd-caret-x", `${visualX}px`);
			inputWrap.style.setProperty("--cmd-inline-char-x", `${visualX}px`);
			inputWrap.style.setProperty("--cmd-selection-x", `${visualX}px`);

			shell.classList.remove("is-focused", "is-caret-end", "is-caret-inline", "is-selection-range");

			if (selectionOverlay) {
				selectionOverlay.textContent = isSelectionRange ? selectedText : "";
			}

			if (inlineChar) {
				inlineChar.textContent = (!isSelectionRange && rangeStart < value.length)
					? value.charAt(rangeStart)
					: "";
			}

			updateTerminalRenderLayer();

			if (!isFocused) return;

			shell.classList.add("is-focused");

			if (!isCollapsed) {
				shell.classList.add("is-selection-range");
				return;
			}

			if (hasInlineChar) shell.classList.add("is-caret-inline");
			else shell.classList.add("is-caret-end");
		};

		let commandSelectionSyncRaf = 0;
		let commandSelectionTracking = false;

		const sync = (): void => {
			normalizeTextareaValue({ preserveSelection: true });
			applyLiveTextStatusClasses();

			if (isCommand) {
				const style = getComputedStyle(textarea);
				const fontSize = parseFloat(style.fontSize) || 16;
				const lineHeight = parseFloat(style.lineHeight) || fontSize;
				const pxHeight = Math.max(1, Math.ceil(lineHeight));

				textarea.style.height = `${pxHeight}px`;
				textarea.style.minHeight = `${pxHeight}px`;
				textarea.style.maxHeight = `${pxHeight}px`;

				ensureCommandVisualRangeVisible();
				updateCommandVisuals();
			}
			else {
				syncTextAreaHeight(textarea);
			}

			ctx.viewport.__quizSlideHeightCache?.delete(qi);
			if (qi === ctx.quizState.current) {
				ctx.viewport.scheduleViewportHeightSync({ index: qi, animate: false, refresh: true });
			}
		};

		const queueSync = (): void => {
			if (commandSelectionSyncRaf) return;
			commandSelectionSyncRaf = requestAnimationFrame(() => {
				commandSelectionSyncRaf = 0;
				if (ctx.__quizDestroyed) return;
				sync();
			});
		};

		const onDocumentSelectionMove = (): void => {
			if (!commandSelectionTracking) return;
			queueSync();
		};

		const stopCommandSelectionTracking = (): void => {
			if (!commandSelectionTracking) return;

			commandSelectionTracking = false;

			document.removeEventListener("pointermove", onDocumentSelectionMove, true);
			document.removeEventListener("mousemove", onDocumentSelectionMove, true);
			document.removeEventListener("selectionchange", onDocumentSelectionMove, true);
			document.removeEventListener("pointerup", stopCommandSelectionTracking, true);
			document.removeEventListener("mouseup", stopCommandSelectionTracking, true);
			window.removeEventListener("blur", stopCommandSelectionTracking, true);

			queueSync();
		};

		const startCommandSelectionTracking = (e: MouseEvent): void => {
			if (!isCommand || ctx.quizState.locked) return;
			if (e && typeof e.button === "number" && e.button !== 0) return;
			if (commandSelectionTracking) return;

			commandSelectionTracking = true;

			document.addEventListener("pointermove", onDocumentSelectionMove, true);
			document.addEventListener("mousemove", onDocumentSelectionMove, true);
			document.addEventListener("selectionchange", onDocumentSelectionMove, true);
			document.addEventListener("pointerup", stopCommandSelectionTracking, true);
			document.addEventListener("mouseup", stopCommandSelectionTracking, true);
			window.addEventListener("blur", stopCommandSelectionTracking, true);

			queueSync();
		};

		const cleanupTextQuestionBinding = (): void => {
			stopCommandSelectionTracking();

			if (commandSelectionSyncRaf) {
				cancelAnimationFrame(commandSelectionSyncRaf);
				commandSelectionSyncRaf = 0;
			}
		};

		trackItem.__quizTextQuestionCleanup = cleanupTextQuestionBinding;

		// persistSelection écrit l'état SANS re-render : sûr à appeler pendant une
		// animation de slide. commitValue ajoute le re-render (nav + meta slides),
		// qu'on garde bloqué pendant le slide pour ne pas casser l'animation.
		const persistSelection = (): string => {
			const finalValue = normalizeTextareaValue({ preserveSelection: true });
			ctx.invalidateSavedResults?.();
			ctx.quizState.selections[qi] = finalValue;
			return finalValue;
		};

		const commitValue = (): void => {
			persistSelection();
			applyLiveTextStatusClasses();
			ctx.updateNavHighlight();
			ctx.cards.refreshMetaSlides();
			sync();
		};

		textarea.addEventListener("input", () => {
			queueSync();

			if (ctx.quizState.locked) return;
			// Pendant un slide : persister la saisie sans re-render, sinon les derniers
			// caractères tapés ne sont jamais enregistrés dans selections[qi] (scoring périmé).
			if (ctx.quizState.isSliding) { persistSelection(); return; }
			commitValue();
		});

		textarea.addEventListener("paste", () => {
			requestAnimationFrame(() => {
				queueSync();

				if (ctx.quizState.locked) return;
				if (ctx.quizState.isSliding) { persistSelection(); return; }
				commitValue();
			});
		});

		textarea.addEventListener("focus", () => queueSync());
		textarea.addEventListener("blur", () => {
			stopCommandSelectionTracking();
			// Filet de sécurité : persister la valeur courante à la perte de focus
			// (couvre une saisie terminée juste avant une navigation/slide).
			if (!ctx.quizState.locked) persistSelection();
			queueSync();
		});
		textarea.addEventListener("click", () => queueSync());
		textarea.addEventListener("mouseup", () => queueSync());
		textarea.addEventListener("keyup", () => queueSync());
		textarea.addEventListener("select", () => queueSync());
		textarea.addEventListener("scroll", () => queueSync());

		textarea.addEventListener("pointerdown", startCommandSelectionTracking);
		textarea.addEventListener("mousedown", startCommandSelectionTracking);

		textarea.addEventListener("keydown", e => {
			if (isCommand && e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();

				if (ctx.quizState.isSliding || ctx.quizState.locked) return;

				commitValue();

				if (qi < ctx.quiz.length - 1) {
					ctx.goToQuestion(qi + 1);
				}
				return;
			}

			if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && qi < ctx.quiz.length - 1) {
				e.preventDefault();
				ctx.goToQuestion(qi + 1);
			}

			queueSync();
		});

		sync();
	}

	return {
		normalizeTerminalVariantName,
		getTerminalTextVariant,
		isTerminalTextQuestion,
		isCommandTextQuestion,
		getTerminalPromptPrefix,
		renderTerminalPromptPrefixHtml,
		getTextMaxLength,
		sliceToMaxChars,
		sanitizeTextAnswerValue,
		getTextAcceptedAnswers,
		normalizeTextAnswer,
		isTextAnswerCorrect,
		syncTextAreaHeight,
		splitTerminalVisualTokens,
		textQuestionCardHtml,
		bindTextQuestion
	};
}
