import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import { LOG_PREFIX } from "../branding";
import type { ResourceButton, QuestionRole } from "../types/quiz";

export type QuestionTypeKey = "single" | "multi" | "ordering" | "matching" | "cloze" | "numeric" | "text" | "cmd" | "powershell" | "bash" | "code";

interface QuizTypeDef {
	key: QuestionTypeKey;
	label: string;
	lucide: string;
	desc: string;
}

/* Q_TYPES est évalué au CHARGEMENT du module : des libellés en dur y seraient
   figés dans la langue du démarrage et changer de langue n'aurait plus d'effet.
   `label`/`desc` sont donc des GETTERS — t() n'est appelé qu'à la lecture, donc
   au rendu (renderEditor, renderSidebar, renderPreview, TypePickerModal), et
   tous les appelants restent inchangés (`ti.label`). Ne jamais copier une entrée
   par spread/Object.assign : cela figerait le getter en valeur. */
const Q_TYPES: QuizTypeDef[] = [
	{ key: "single", lucide: "circle-dot", get label() { return t("editor.type.single.label"); }, get desc() { return t("editor.type.single.desc"); } },
	{ key: "multi", lucide: "check-square", get label() { return t("editor.type.multi.label"); }, get desc() { return t("editor.type.multi.desc"); } },
	{ key: "ordering", lucide: "arrow-up-down", get label() { return t("editor.type.ordering.label"); }, get desc() { return t("editor.type.ordering.desc"); } },
	{ key: "matching", lucide: "link", get label() { return t("editor.type.matching.label"); }, get desc() { return t("editor.type.matching.desc"); } },
	{ key: "cloze", lucide: "text-cursor-input", get label() { return t("editor.type.cloze.label"); }, get desc() { return t("editor.type.cloze.desc"); } },
	{ key: "numeric", lucide: "calculator", get label() { return t("editor.type.numeric.label"); }, get desc() { return t("editor.type.numeric.desc"); } },
	{ key: "text", lucide: "type", get label() { return t("editor.type.text.label"); }, get desc() { return t("editor.type.text.desc"); } },
	{ key: "cmd", lucide: "terminal", get label() { return t("editor.type.cmd.label"); }, get desc() { return t("editor.type.cmd.desc"); } },
	{ key: "powershell", lucide: "terminal-square", get label() { return t("editor.type.powershell.label"); }, get desc() { return t("editor.type.powershell.desc"); } },
	{ key: "bash", lucide: "terminal", get label() { return t("editor.type.bash.label"); }, get desc() { return t("editor.type.bash.desc"); } },
];

interface ReactBridge {
	React: unknown;
	ReactDOM: unknown;
}

function loadReact(): ReactBridge {
	if (typeof window.React !== 'undefined' && typeof window.ReactDOM !== 'undefined') {
		return { React: window.React, ReactDOM: window.ReactDOM };
	}
	return { React: null, ReactDOM: null };
}

/* Le `catch` est plus ANCIEN que l'hôte : il couvrait un `setIcon` d'Obsidian
   qui rate, et une icône manquante n'a jamais valu de casser un formulaire.
   Mais `currentHost()` JETTE quand aucun hôte n'est installé — un défaut de
   câblage, pas une icône absente —, et il se lisait alors comme un simple
   `<span>` vide. D'où l'avertissement : le repli reste, le signal ne se perd
   plus. */
function _setIcon(el: HTMLElement, name: string): void {
	try {
		currentHost().ui.setIcon(el, name);
	} catch (e) {
		console.warn(`${LOG_PREFIX} icône « ${name} » non posée`, e);
	}
}
function _iconSpan(parent: HTMLElement, name: string, cls?: string): HTMLSpanElement { const s = ajouter(parent, "span", cls || "qb-icon"); _setIcon(s, name); return s; }

/** Question en cours d'édition côté éditeur — champs internes (_type/_id) en plus des champs de données. */
export interface DraftQuestion {
	_type: QuestionTypeKey;
	_id: string;
	title: string;
	prompt: string;
	hint: string;
	explain: string;
	resourceButton: ResourceButton | null;
	_useHtmlPrompt: boolean;
	options?: string[];
	correctIndex?: number;
	correctIndices?: number[];
	slots?: string[];
	possibilities?: string[];
	correctOrder?: number[];
	rows?: string[];
	choices?: string[];
	correctMap?: number[];
	placeholder?: string;
	acceptedAnswers?: string[];
	caseSensitive?: boolean;
	commandPrefix?: string;
	/** Énoncé/explication en HTML pré-rendu (édition mode HTML + fallback import). */
	_promptHtml?: string;
	_explainHtml?: string;
	/** Contenu "Leçon" (mode "lesson", renommé depuis "learn") — miroir texte/HTML de `explain`/`_explainHtml`. */
	lesson?: string;
	_lessonHtml?: string;
	/** Alias hérités de "learn", lus en repli à l'import (editor/convert.ts) et
	    à l'export direct (editor/export.ts) — jamais réécrits. */
	learn?: string;
	learnHtml?: string;
	_learnHtml?: string;
	/** Le `prompt` venait de la NOTE, pas d'un HTML aplati par la lecture.
	    Ce qui décide s'il faut le réémettre à côté de `promptHtml` : un texte
	    dérivé n'a pas à apparaître dans une note qui ne l'avait pas. */
	_promptSource?: boolean;
	/** Titre modifié manuellement (bloque la renumérotation auto "Question N"). */
	_userModifiedTitle?: boolean;
	/** `id` tel qu'il était ÉCRIT dans la note, quand il y en avait un. Le
	    conserver est nécessaire : cet identifiant devient l'ancre HTML de la
	    question (engine/cards.ts) et il est consigné dans les résultats
	    sauvegardés. Le recalculer depuis le titre — ce que faisait l'export —
	    cassait les ancres et découplait les résultats déjà enregistrés dès la
	    première retouche. Absent quand la note n'en portait pas : on n'écrit
	    pas un identifiant que personne n'a choisi. */
	_sourceId?: string;
	/**
	 * Variante de terminal telle qu'elle était ÉCRITE dans le bloc : la clé
	 * (`terminalVariant` ou `textVariant`) et sa valeur exacte. Réémises
	 * telles quelles, parce que l'éditeur n'a que trois types de terminal là
	 * où le moteur accepte une douzaine d'alias : réécrire
	 * `textVariant: 'command'` en `terminalVariant: 'cmd'` changerait la note
	 * sans que personne ne l'ait demandé — et ne pas les mémoriser du tout
	 * effaçait la variante et son invite (22 questions Cisco réelles).
	 */
	_variantKey?: string;
	_variantValue?: string;
	/** La variante venait d'une forme IMBRIQUÉE (`text.variant`,
	    `terminal.variant`). L'export n'écrit alors AUCUNE clé de variante : la
	    forme imbriquée est déjà réémise telle quelle par `_extraFields`, et en
	    ajouter une seconde ferait cohabiter deux déclarations pour la même
	    chose. */
	_variantNested?: boolean;
	/** Clés inconnues préservées au round-trip import→export (editor/modals.js convertToInternalFormat). */
	_extraFields?: Record<string, unknown>;
	/** Gabarit guidé de l'éditeur math (miroir de TextQuestion.answerTemplate). */
	answerTemplate?: string;
	/** Gabarit du texte à trous — trous entre doubles accolades (engine/cloze.ts). */
	cloze?: string;
	/** Réponse numérique : marge absolue, marge relative, unité (engine/numeric.ts). */
	tolerance?: number;
	tolerancePercent?: number;
	unit?: string;
	/**
	 * Boucle d'apprentissage (mode "lesson", task 1 puis 2 du lot mode leçon,
	 * 2026-08-31) : numéro de tranche et rôle de la question — miroir de
	 * `QuestionBase.slice`/`.role` (types/quiz.ts). Round-trippent comme un
	 * champ typé ordinaire (`tolerance`…), pas via `_extraFields` : une
	 * valeur hors contrat doit être TUE à l'écriture (editor/export.ts), pas
	 * recopiée telle quelle comme le serait un champ personnalisé.
	 */
	slice?: number;
	role?: QuestionRole;
}

/* Libellés de slots par défaut (« Étape 1 »…) : contenu de DÉPART écrit ensuite
   dans le .md, mais du texte libre — le moteur ne le parse jamais. makeDefault
   étant appelé à la création d'une question (jamais au chargement du module),
   t() rend bien la langue courante. */
function defaultSlots(): string[] {
	return [t("editor.ordering.slotDefault", { n: 1 }), t("editor.ordering.slotDefault", { n: 2 })];
}

function makeDefault(type: QuestionTypeKey): DraftQuestion {
	const b: DraftQuestion = { _type: type, _id: Math.random().toString(36).slice(2, 10), title: "", prompt: "", hint: "", explain: "", resourceButton: null, _useHtmlPrompt: false };
	switch (type) {
		case "single": return { ...b, options: ["", ""], correctIndex: 0 };
		case "multi": return { ...b, options: ["", ""], correctIndices: [] };
		case "ordering": return { ...b, slots: defaultSlots(), possibilities: ["", ""], correctOrder: [0, 1] };
		case "matching": return { ...b, rows: ["", ""], choices: ["", ""], correctMap: [0, 0] };
		// Gabarit d'exemple : un texte à trous vide n'apprend pas sa syntaxe, et
		// les doubles accolades ne s'inventent pas.
		case "cloze": return { ...b, cloze: t("editor.cloze.defaultTemplate"), caseSensitive: false };
		case "numeric": return { ...b, placeholder: "", acceptedAnswers: [""], caseSensitive: false, unit: "" };
		case "text": return { ...b, placeholder: t("editor.text.defaultPlaceholder"), acceptedAnswers: [""], caseSensitive: false };
		case "cmd": return { ...b, placeholder: "", acceptedAnswers: [""], caseSensitive: false, commandPrefix: "C:\\>" };
		case "powershell": return { ...b, placeholder: "", acceptedAnswers: [""], caseSensitive: false, commandPrefix: "PS>" };
		case "bash": return { ...b, placeholder: "", acceptedAnswers: [""], caseSensitive: false };
		default: return b;
	}
}

function md2html(src?: string | null): string {
	if (!src) return "";
	let text = String(src);

	// Étape 0: Convertir les anciennes balises <br> en \n pour compatibilité
	text = text.replace(/<br\s*\/?>/gi, '\n');

	// Étape 1: Extraire les blocs de code AVANT toute échappement HTML
	// Utiliser un placeholder qui ne contient PAS de < ou > pour éviter l'échappement
	const codeBlocks: string[] = [];
	text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match: string, _lang: string, code: string) => {
		const idx = codeBlocks.length;
		const placeholder = `__CODEBLOCK_${idx}__`;
		// Stocker le code et échapper son contenu pour HTML immédiatement
		codeBlocks.push(escHtml(code.trim()).replace(/\n/g, "<br>"));
		return placeholder;
	});

	// Étape 2: Échapper les caractères HTML du reste du texte
	text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

	// Étape 3: Convertir le markdown en HTML
	text = text
		.replace(/^### (.+)$/gm, "<h3>$1</h3>")
		.replace(/^## (.+)$/gm, "<h2>$1</h2>")
		.replace(/^# (.+)$/gm, "<h1>$1</h1>")
		.replace(/`([^`\n]+)`/g, "<code>$1</code>")
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/\*(.+?)\*/g, "<em>$1</em>")
		.replace(/^- (.+)$/gm, "<li>$1</li>")
		.replace(/(<li>.*<\/li>\n?)+/g, m => "<ul>" + m + "</ul>")
		.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
		.replace(/(<blockquote>.*<\/blockquote>\n?)+/g, m => m.replace(/<\/blockquote>\n?<blockquote>/g, "\n"))
		.replace(/!\[\[([^\]]+)\]\]/g, "<img src=\"$1\" class=\"qb-md-img\" />")
		.replace(/\n{2,}/g, "</p><p>")
		.replace(/\n/g, "<br>");

	// Étape 4: Réinsérer les blocs de code (placeholder n'a pas été échappé car pas de < >)
	codeBlocks.forEach((escapedCode, i) => {
		const placeholder = `__CODEBLOCK_${i}__`;
		text = text.replace(placeholder, `<pre><code>${escapedCode}</code></pre>`);
	});

	return text;
}

function escHtml(s?: unknown): string { return String(s ?? "").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

function esc5(s?: unknown): string {
	return String(s ?? "")
		.replace(/\\/g, "\\\\")    // Échapper les antislashs d'abord
		.replace(/'/g, "\\'")          // Échapper les apostrophes (car on utilise ' pour délimiter)
		.replace(/\r/g, "\\r")        // Échapper les retours chariot
		.replace(/\n/g, "\\n");        // Échapper les sauts de ligne
	// Note: Les chevrons < > ne sont PAS échappés avec \ car ce n'est pas
	// valide en JSON5. Ils sont déjà échappés en HTML entities (&lt; &gt;)
	// par md2html() avant d'appeler esc5().
}

export { Q_TYPES, loadReact, _setIcon, _iconSpan, makeDefault, defaultSlots, md2html, escHtml, esc5 };

/** Un champ importé peut porter du HTML que le texte brut ne sait pas
    exprimer — un tableau, mais aussi un simple `<strong>`. Le repérer décide
    lequel des deux champs éditer : sans quoi corriger une faute de frappe
    aplatissait la mise en forme.

    Les enveloppes NEUTRES ne comptent pas : `<p>…</p>` et `<br>` sont ce que
    md2html produit pour du texte ordinaire, et basculer en édition HTML pour
    ça imposerait des balises à qui écrit une phrase. */
export function isRichHtml(html: string | undefined): boolean {
	if (!html) return false;
	// Un commentaire HTML est du contenu que le texte brut perdrait.
	if (html.includes("<!--")) return true;
	/* Seule une balise `<p>` NUE est neutre — c'est ce que md2html produit
	   pour du texte ordinaire. Un `<p role="note">` porte de l'information que
	   le sanitizer conserve et affiche ; le traiter comme une enveloppe
	   effaçait ses attributs à la première frappe. Un `<p class="">` vide est
	   alors classé riche : l'erreur va dans le bon sens (on édite le HTML, on
	   ne perd rien). */
	const stripped = html.replace(/<\/?p>|<br\s*\/?>/gi, "");
	if (/<[a-z][a-z0-9]*\b[^>]*>/i.test(stripped)) return true;
	/* Une balise ÉCHAPPÉE et NUE (`&lt;strong&gt;`) compte aussi. Aplatie par
	   `_htmlToText`, elle redevient un vrai `<strong>` — que le rendu du texte
	   restaure ensuite en gras : un exemple de code affiché à l'apprenant se
	   transformait en mise en forme (revue codex 2026-07-31). Traitée comme
	   riche, elle reste dans `_explainHtml`, où elle est rendue littéralement.

	   NUE, exactement comme la règle de restauration : « a &lt;b et c&gt; d »
	   est de la prose, que le rendu ne transforme pas — la déclarer riche
	   ferait basculer l'édition en mode HTML pour une simple phrase. */
	return /&lt;\/?[a-z][a-z0-9]*&gt;/i.test(html);
}
