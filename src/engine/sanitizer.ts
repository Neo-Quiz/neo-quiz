import type { HostFile } from "../host/types";
import type { EngineCtx } from "../types/engine-ctx";
import type { QuestionBase } from "../types/quiz";
import { pickLessonFields } from "../quiz-utils";
import {
	MD_MARK, EMPHASES, motifFormule, motifCodeDouble, motifCodeSimple,
	motifEtoilesMultiples, motifFlanc, decouperMorceaux,
} from "./grammaire-inline";
import type { GenreEmphase } from "./grammaire-inline";
import { rendreBlocs } from "./grammaire-blocs";
import { colorerCode } from "./code-highlight";

/** Spec `![[lien|100x50|alt]]` décomposée (buildEmbedImgHtml, resolveEmbedFile). */
interface ParsedEmbedSpec {
	linkPath: string;
	width: number | null;
	height: number | null;
	alt: string;
}

interface EmbedClassOptions {
	wrapClass?: string;
	imgClass?: string;
}

export interface SanitizerHandlers {
	escapeHtmlAttr(value: unknown): string;
	escapeHtmlText(value: unknown): string;
	unescapeHtmlText(value: unknown): string;
	isSafeQuizUrl(value: unknown, opts?: { image?: boolean }): boolean;
	unwrapQuizHtmlElement(node: ChildNode | null | undefined): void;
	sanitizeQuizHtml(html: unknown): string;
	renderInlineQuizHtml(raw: unknown): string;
	resourceButtonHtml(q: QuestionBase | null | undefined): string;
	resolveEmbedFile(linkPath: unknown): HostFile | null;
	parseObsidianEmbedSpec(spec: unknown): ParsedEmbedSpec;
	buildEmbedImgHtml(embedSpec: unknown, opts?: EmbedClassOptions): string;
	restoreAllowedInlineTags(html: unknown): string;
	renderInlineText(raw: unknown): string;
	stripInlineMarkdown(raw: unknown): string;
	renderTextWithEmbeds(raw: unknown, opts?: EmbedClassOptions): string;
	renderHintWithCodeAndEmbeds(raw: unknown): string;
	renderRawHtmlWithEmbeds(raw: unknown, opts?: EmbedClassOptions): string;
	replaceObsidianEmbedsInHtml(html: unknown, opts?: EmbedClassOptions): string;
}

/* Les MOTIFS (formule, code, flanc des emphases) et la balise de mise à
   l'abri `MD_MARK` vivent dans `grammaire-inline.ts`, partagés avec le champ
   à aperçu en direct de l'éditeur : une seule grammaire pour le rendu et pour
   l'édition. */

/** Balises HTML de chaque emphase de la grammaire partagée. */
const BALISES_EMPHASE: Record<GenreEmphase, [string, string]> = {
	grasItalique: ["<strong><em>", "</em></strong>"],
	gras: ["<strong>", "</strong>"],
	italique: ["<em>", "</em>"],
	barre: ["<del>", "</del>"],
};

function escapeHtmlText(value: unknown): string {
	return String(value ?? "")
		.replace(/\&/g, "\&amp;")
		.replace(/\</g, "\&lt;")
		.replace(/\>/g, "\&gt;")
		.replace(/"/g, "\&quot;")
		.replace(/'/g, "\&#39;");
}

function restoreAllowedInlineTags(html: unknown): string {
	return String(html ?? "")
		.replace(/\&lt;br\s*\/?\&gt;/gi, "<br>")
		.replace(/\&lt;(\/?)code\&gt;/gi, "<$1code>")
		.replace(/\&lt;(\/?)(strong|b|em|i|u|mark|kbd|samp|small|sub|sup)\&gt;/gi, "<$1$2>");
}

/* ── Markdown INLINE des champs texte ────────────────────────────────
   Un quiz écrit à la main — ou généré par un modèle — contient du
   markdown : `**gras**`, `*italique*`, `` `code` ``. Sans cette passe,
   les étoiles et les accents graves s'affichaient TELS QUELS dans les
   énoncés, les options, l'explication et surtout la leçon du mode leçon
   (constat Ahmed 2026-07-31). Le champ n'a pas d'équivalent HTML
   (`lesson`, `cloze`… passent en texte brut) : c'est ici, au rendu, que
   ça se joue — pas à l'export, qui doit garder la source lisible.

   Entrée : du texte DÉJÀ échappé (escapeHtmlText) où les quelques
   balises inline autorisées ont été restaurées. On n'introduit donc
   jamais de HTML venu de l'utilisateur : uniquement les balises que
   cette fonction écrit elle-même.

   Ce qui est mis à l'abri AVANT toute substitution, dans cet ordre :
   - les <code> déjà présents et le code inline — leur contenu est
     littéral par nature, formule comprise (`` `$HOME` ``) ;
   - puis les formules LaTeX ($…$, $$…$$) — MathJax lit la source telle
     quelle, et un `*` ou un `_` y appartient à la formule.
   Le code AVANT la formule, comme dans Obsidian : dans l'autre ordre,
   `` `$HOME` et `$PATH` `` voyait une formule « $HOME` et `$ » enjamber
   deux codes, et le jeton de mise à l'abri s'affichait (« 0PATH », revue du
   2026-09-26, 35 champs réels touchés). */

/** Ce qui remplace un U+0000 venu du texte : sans ça, un auteur pourrait
    forger un jeton de mise à l'abri (`MD_MARK` + index + `MD_MARK`). */
const HORS_JETON = String.fromCharCode(0xfffd);

function inlineMarkdown(escaped: string): string {
	const stash: string[] = [];
	const keep = (html: string): string => MD_MARK + (stash.push(html) - 1) + MD_MARK;

	let out = escaped.split(MD_MARK).join(HORS_JETON)
		.replace(/<code>[\s\S]*?<\/code>/g, m => keep(m))
		// Double accent grave AVANT le simple : c'est la forme markdown
		// d'un code qui CONTIENT un accent grave (``a ` b``).
		.replace(motifCodeDouble(), (_m, code: string) => keep(`<code>${code}</code>`))
		.replace(motifCodeSimple(), (_m, code: string) => keep(`<code>${code}</code>`))
		// `\$` ÉCHAPPÉ n'ouvre pas une formule : « Prix \$5 … \$10 » n'est
		// pas du LaTeX, et le prendre pour tel figeait tout le segment (le
		// gras au milieu restait littéral). Une formule n'enjambe jamais un
		// code déjà mis à l'abri (`motifFormule` refuse le jeton).
		.replace(motifFormule(), (_m, before: string, math: string) => before + keep(math));

	// Une suite de QUATRE étoiles ou plus n'est pas de l'emphase, et la
	// laisser passer faisait produire des balises croisées. Mise à l'abri
	// telle quelle, comme le ferait un lecteur markdown.
	out = out.replace(motifEtoilesMultiples(), m => keep(m));
	// Triple AVANT double avant simple (ordre de `EMPHASES`).
	for (const { genre, delim } of EMPHASES) {
		const [o, f] = BALISES_EMPHASE[genre];
		out = out.replace(motifFlanc(delim), (_m, avant: string, contenu: string) => avant + o + contenu + f);
	}

	/* Restauration RÉPÉTÉE : une entrée du stash peut en contenir une autre.
	   Chaque entrée ne cite que des entrées plus anciennes, donc la boucle
	   s'arrête ; la borne n'est qu'un filet. Aucun jeton ne sort jamais : un
	   reste improbable est retiré plutôt qu'affiché. */
	const jeton = new RegExp(MD_MARK + "(\\d+)" + MD_MARK, "g");
	for (let tour = 0; tour <= stash.length; tour++) {
		const suivant = out.replace(jeton, (_m, i: string) => stash[Number(i)] ?? "");
		if (suivant === out) break;
		out = suivant;
	}
	return out.split(MD_MARK).join("");
}

/** Texte d'affichage : échappé, puis markdown inline. Le pendant de
    `escapeHtmlText` pour tout ce que l'apprenant LIT (libellés de
    classement, d'appariement, titres, réponses attendues) — mais jamais
    pour ce qu'il ÉCRIT (valeur d'un textarea) ni pour un attribut.

    EXPORTÉ pour `scripts/check-markdown.mjs` : c'est la seule logique du
    plugin assez tordue pour mériter un jeu de cas, et le script doit
    éprouver CETTE fonction — une réplique dans le script finirait par
    diverger de l'originale et validerait le vide. */
export function renderInlineText(raw: unknown): string {
	return inlineMarkdown(restoreAllowedInlineTags(escapeHtmlText(raw)));
}

/** Le même texte, mais RAMENÉ AU TEXTE NU : les marqueurs appariés tombent au
    lieu de devenir des balises. Pour les endroits où le HTML n'existe pas —
    l'attribut `placeholder` d'un champ, un `aria-label`, la vignette d'une
    liste. Sans ça, un placeholder « Réponds en **majuscules** » affichait ses
    étoiles : du markdown non rendu, exactement ce qu'on chasse ailleurs.

    Mêmes règles de flanc que `renderInlineText` — c'est volontairement la
    même grammaire, sur le même texte, avec une sortie différente.

    ⚠ La sortie est du TEXTE, pas du HTML : les entités y sont décodées, donc
    un `<img …>` que l'utilisateur a écrit littéralement en ressort tel quel.
    Elle ne doit JAMAIS être interpolée dans du HTML sans être ré-échappée —
    `escapeHtmlAttr`, `setAttribute` ou `textContent`, comme le font ses
    appelants. Pour du HTML, c'est `renderInlineText` qu'il faut. */
export function stripInlineMarkdown(raw: unknown): string {
	/* `restoreAllowedInlineTags` AUSSI ici, comme au rendu : sans lui, un
	   `<strong>x</strong>` écrit à la main restait échappé pendant le retrait
	   des balises, puis ressortait visible au décodage des entités — le
	   placeholder affichait ses chevrons là où le rendu, lui, affiche « x »
	   en gras (revue codex 2026-07-31). */
	const html = inlineMarkdown(restoreAllowedInlineTags(escapeHtmlText(raw)));
	/* Les espaces ne sont PAS normalisés : un placeholder de zone de texte peut
	   être multiligne et indenté exprès (« Exemple :\n    SELECT * … »), et
	   l'aplatir lui ferait perdre sa forme. Les appelants qui veulent UNE ligne
	   — la vignette de la liste — la demandent eux-mêmes. */
	return html
		// Un `<br>` sépare deux mots : le remplacer par RIEN les collerait.
		.replace(/<br\s*\/?>/gi, " ")
		// Toute balise restante vient de nous (produite ci-dessus ou restaurée
		// depuis la liste blanche) : ce qui venait de l'utilisateur est encore
		// échappé à ce stade, et ne sera décodé qu'après.
		.replace(/<[^>]*>/g, "")
		.replace(/\&lt;/g, "<").replace(/\&gt;/g, ">")
		.replace(/\&quot;/g, "\"").replace(/\&#39;/g, "'")
		// `&amp;` en DERNIER : le faire avant ressusciterait « &amp;lt; » en « < ».
		.replace(/\&amp;/g, "&");
}

/* ── Le texte d'un quiz en markdown COMPLET ─────────────────────────
   Énoncés, lectures, explications, leçons, indices, options : tout texte
   d'un quiz s'écrit en markdown, comme dans Discord et Obsidian (demande du
   2026-09-26) — plus jamais en HTML. Au-dessus de l'inline, les blocs
   (paragraphes, listes, code, tableaux : engine/grammaire-blocs.ts), et
   les images et liens (`decouperMorceaux`, grammaire-inline.ts).

   Toujours la première porte : chaque morceau de texte est ÉCHAPPÉ avant
   toute passe markdown ; les seules balises produites sont les nôtres ; une
   URL n'entre dans un attribut qu'échappée, et un lien qu'en `http(s)` ou
   `mailto:`. PUR, exporté : l'aperçu de l'éditeur et le convertisseur HTML →
   markdown (editor/html-vers-markdown.ts) passent par la même fonction que
   le moteur. */

/** Ce qu'un hôte fait d'une image : les `![[…]]` d'un vault et les
    `![alt](src)` du markdown. Le moteur les résout dans le vault
    (`createSanitizer`), l'aperçu les laisse à `resolveImagesInHtml`. */
export interface RenduImages {
	embed(spec: string): string;
	image(alt: string, src: string): string;
}

/** Un morceau de texte SANS bloc : les sauts de ligne en `<br>`, puis
    l'inline — exactement le rendu d'avant les blocs. */
function rendreMorceaux(texte: string, images: RenduImages): string {
	const inline = (s: string): string =>
		inlineMarkdown(restoreAllowedInlineTags(escapeHtmlText(s).replace(/\n/g, "<br>")));
	return decouperMorceaux(texte).map(m => {
		switch (m.genre) {
			case "texte": return inline(texte.slice(m.debut, m.fin));
			case "embed": return images.embed(m.spec);
			case "image": return images.image(m.alt, m.src);
			case "lien":
				return `<a class="quiz-md-lien" href="${escapeHtmlAttr(m.url)}" target="_blank" rel="noopener noreferrer">${inline(texte.slice(m.texteDebut, m.texteFin))}</a>`;
		}
	}).join("");
}

/**
 * Le HTML d'un texte de quiz en markdown. Un texte d'un seul paragraphe est
 * rendu comme avant, octet pour octet (grammaire-blocs.ts, règle de
 * compatibilité) ; les autres, bloc par bloc.
 */
export function rendreTexteQuiz(raw: unknown, images: RenduImages): string {
	const texte = String(raw ?? "");
	return rendreBlocs(texte, {
		inline: m => rendreMorceaux(m, images), echapper: escapeHtmlText,
		colorerCode: (code, langue) => colorerCode(code, langue, escapeHtmlText),
	}) ?? rendreMorceaux(texte, images);
}

/* ── Liste blanche du HTML PRÉ-RENDU ──────────────────────────────────
   Ce bloc ne dépend d'aucun contexte : il vit au niveau du MODULE pour que
   l'aperçu de l'éditeur (editor/question-preview.ts) puisse l'appeler lui
   aussi. Il n'y a qu'une liste blanche dans ce plugin, et deux surfaces qui
   affichent le même `explainHtml` ne peuvent pas en avoir chacune la sienne. */

const QUIZ_HTML_ALLOWED_TAGS = new Set([
	"a", "b", "blockquote", "br", "center", "code", "details", "div", "em", "font",
	"h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "kbd", "li", "mark",
	"ol", "p", "pre", "samp", "small", "span", "strong", "sub", "summary", "sup",
	"table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul"
]);

const QUIZ_HTML_DROP_TAGS = new Set([
	"script", "style", "iframe", "object", "embed", "link", "meta"
]);

const QUIZ_HTML_GLOBAL_ATTRS = new Set([
	"class", "title", "role", "aria-label", "aria-hidden", "tabindex"
]);

/* `style` n'est pas jeté en bloc : il est RÉDUIT. Retirer l'attribut entier
   aurait décoloré 594 fragments des quiz d'Ahmed — mesuré sur ses deux
   vaults, où `color:` est d'ailleurs la SEULE propriété employée, sur
   `<span>` et `<p>`. Les autres entrées de cette liste sont ses voisines
   évidentes, admises d'avance pour ne pas rouvrir le sujet à la première
   mise en forme un peu riche.
   Ce qui reste dehors est ce qui sert à ATTAQUER : `url(…)` (requête
   sortante, donc traçage), `expression(…)` et `-moz-binding` (du code),
   `position`/`z-index` (recouvrir l'interface d'Obsidian). */
const QUIZ_STYLE_ALLOWED_PROPS = new Set([
	"color", "background-color", "font-weight", "font-style",
	"text-align", "text-decoration"
]);
/* Une valeur ne peut être qu'un mot, un nombre, un `#hex` ou une fonction
   de couleur. Ni guillemet, ni antislash, ni parenthèse ouvrante autre que
   celles-là — un `url(` ne peut donc pas se former. */
const QUIZ_STYLE_SAFE_VALUE = /^(?:rgba?\(|hsla?\(|[\w %.,#-]|\))+$/i;

/** `style` réduit à ses déclarations sûres ; chaîne vide s'il n'en reste
    aucune — l'attribut est alors retiré. */
function sanitizeStyleAttr(value: unknown): string {
	return String(value ?? "")
		.split(";")
		.map(decl => {
			const sep = decl.indexOf(":");
			if (sep < 0) return "";
			const prop = decl.slice(0, sep).trim().toLowerCase();
			const val = decl.slice(sep + 1).trim();
			if (!QUIZ_STYLE_ALLOWED_PROPS.has(prop)) return "";
			if (!val || !QUIZ_STYLE_SAFE_VALUE.test(val)) return "";
			return prop + ": " + val;
		})
		.filter(Boolean)
		.join("; ");
}

const QUIZ_HTML_TAG_ATTRS: Record<string, Set<string>> = {
	a: new Set(["href", "target", "rel"]),
	img: new Set(["src", "alt", "width", "height"]),
	td: new Set(["colspan", "rowspan"]),
	th: new Set(["colspan", "rowspan"]),
	font: new Set(["color"]),
	// Le numéro de départ d'une liste (`3. …`) rendue depuis le markdown.
	ol: new Set(["start"])
};

function escapeHtmlAttr(value: unknown): string {
	return String(value ?? "")
		.replace(/\&/g, "\&amp;")
		.replace(/"/g, "\&quot;")
		.replace(/'/g, "\&#39;")
		.replace(/\</g, "\&lt;")
		.replace(/\>/g, "\&gt;");
}

function unescapeHtmlText(value: unknown): string {
	return String(value ?? "")
		.replace(/\&lt;/g, "<")
		.replace(/\&gt;/g, ">")
		.replace(/\&quot;/g, '"')
		.replace(/\&#39;/g, "'")
		.replace(/\&amp;/g, "&");
}

function isSafeQuizUrl(value: unknown, { image = false }: { image?: boolean } = {}): boolean {
	const raw = String(value ?? "").trim();
	if (!raw) return false;

	if (
		raw.startsWith("#") ||
		raw.startsWith("/") ||
		raw.startsWith("./") ||
		raw.startsWith("../")
	) {
		return true;
	}

	if (/^(https?:|mailto:|tel:|obsidian:|app:|file:|blob:)/i.test(raw)) {
		return true;
	}

	if (image && /^data:image\//i.test(raw)) {
		return true;
	}

	return false;
}

function unwrapQuizHtmlElement(node: ChildNode | null | undefined): void {
	const parent = node?.parentNode ?? null;
	if (!parent || !node) return;

	let first: ChildNode | null;
	while ((first = node.firstChild)) {
		parent.insertBefore(first, node);
	}
	parent.removeChild(node);
}

/**
 * Contenu "Leçon" d'une question, déjà rendu pour l'affichage — ou chaîne
 * vide si la question n'en porte pas. L'ORDRE de repli (nom canonique
 * prioritaire, alias hérité `learn*` ensuite) vient de `pickLessonFields`
 * (quiz-utils.ts) — SEULE définition de cet ordre, partagée avec
 * `editor/convert.ts` et `editor/export.ts` (round 1 de revue, 2026-08-31 :
 * les trois le réécrivaient chacun, dans des ordres différents). Cette
 * fonction-ci n'ajoute que ce que le moteur a en plus des deux autres :
 * choisir, une fois la valeur connue, LEQUEL des deux rendus l'affiche.
 *
 * EXPORTÉE et appelée par engine/cards.ts et engine/text-only.ts, qui
 * faisaient chacun le même choix en double. Prend le sous-ensemble de
 * `SanitizerHandlers` dont elle a besoin — pas tout `ctx` — pour rester
 * appelable sans le reste du moteur.
 */
export function renderLessonHtml(
	q: QuestionBase,
	sanitize: Pick<SanitizerHandlers, "replaceObsidianEmbedsInHtml" | "renderTextWithEmbeds">
): string {
	const { text, html } = pickLessonFields(q);
	if (html) return sanitize.replaceObsidianEmbedsInHtml(html);
	if (text) return sanitize.renderTextWithEmbeds(text);
	return "";
}

export function sanitizeQuizHtml(html: unknown): string {
	const tpl = document.createElement("template");
	tpl.innerHTML = String(html ?? "");

	const walk = (node: ChildNode | null | undefined): void => {
		if (!node) return;

		if (node.nodeType === Node.COMMENT_NODE) {
			node.remove();
			return;
		}

		if (node.nodeType !== Node.ELEMENT_NODE) return;

		// Narrowing sûr : nodeType === ELEMENT_NODE garantit un Element (TS ne
		// corrèle pas nodeType et le type ChildNode automatiquement).
		const el = node as Element;

		const tag = el.tagName.toLowerCase();

		if (QUIZ_HTML_DROP_TAGS.has(tag)) {
			el.remove();
			return;
		}

		if (!QUIZ_HTML_ALLOWED_TAGS.has(tag)) {
			unwrapQuizHtmlElement(el);
			return;
		}

		const allowedAttrs = QUIZ_HTML_TAG_ATTRS[tag] || new Set<string>();

		Array.from(el.attributes).forEach(attr => {
			const name = attr.name.toLowerCase();
			const value = attr.value;

			if (name.startsWith("on")) {
				el.removeAttribute(attr.name);
				return;
			}

			if (name === "style") {
				const reduit = sanitizeStyleAttr(value);
				if (reduit) el.setAttribute("style", reduit);
				else el.removeAttribute(attr.name);
				return;
			}

			if (!QUIZ_HTML_GLOBAL_ATTRS.has(name) && !allowedAttrs.has(name)) {
				el.removeAttribute(attr.name);
				return;
			}

			if (
				(name === "href" || name === "src") &&
				!isSafeQuizUrl(value, { image: name === "src" && tag === "img" })
			) {
				el.removeAttribute(attr.name);
				return;
			}

			if (
				(name === "width" || name === "height" || name === "colspan" || name === "rowspan" || name === "start") &&
				!/^\d{1,4}$/.test(String(value).trim())
			) {
				el.removeAttribute(attr.name);
				return;
			}

			if (name === "target" && !/^_(self|blank)$/.test(String(value).trim())) {
				el.removeAttribute(attr.name);
				return;
			}
		});

		if (tag === "a" && el.getAttribute("target") === "_blank") {
			el.setAttribute("rel", "noopener noreferrer");
		}

		Array.from(el.childNodes).forEach(walk);
	};

	Array.from(tpl.content.childNodes).forEach(walk);
	return tpl.innerHTML;
}


export function createSanitizer(ctx: EngineCtx): SanitizerHandlers {
	function renderInlineQuizHtml(raw: unknown): string {
		return restoreAllowedInlineTags(
			escapeHtmlText(String(raw ?? "")).replace(/\n/g, "<br>")
		);
	}

	function resourceButtonHtml(q: QuestionBase | null | undefined): string {
		const rb = q?.resourceButton;
		if (!rb || !rb.label || !rb.fileName) return "";
		return `<button class="quiz-resource-btn" type="button" data-resource-file="${escapeHtmlAttr(rb.fileName)}"><span class="quiz-resource-btn-icon" aria-hidden="true">${ctx.lucideIcons?.paperclip || "⬇" }</span><span class="quiz-resource-btn-label">${renderInlineText(rb.label)}</span></button>`;
	}

	/**
	 * Résolution d'un `![[lien]]`. L'ordre (index des liens d'abord, chemin nu
	 * ensuite) et ses `try/catch` vivent désormais dans l'hôte : c'est
	 * précisément ce qui diffère entre Obsidian, qui tient un index de liens,
	 * et un dossier nu, qui doit chercher par nom.
	 */
	function resolveEmbedFile(linkPath: unknown): HostFile | null {
		const raw = String(linkPath ?? "").trim();
		if (!raw) return null;
		return ctx.host.links.resolve(raw, ctx.sourcePath || "");
	}

	function parseObsidianEmbedSpec(spec: unknown): ParsedEmbedSpec {
		const s = String(spec ?? "").trim();
		const parts = s.split("|");
		const linkPath = (parts[0] || "").trim();
		let width: number | null = null, height: number | null = null, alt = "";
		if (parts.length >= 2) {
			const p = (parts[1] || "").trim();
			if (/^\d+$/.test(p)) width = Number(p);
			else if (/^\d+x\d+$/i.test(p)) {
				const [w, h] = p.toLowerCase().split("x").map(n => Number(n));
				if (Number.isFinite(w)) width = w;
				if (Number.isFinite(h)) height = h;
			} else alt = p;
		}
		return { linkPath, width, height, alt };
	}

	function buildEmbedImgHtml(embedSpec: unknown, { wrapClass = "quiz-question-embed-wrap", imgClass = "quiz-question-embed" }: EmbedClassOptions = {}): string {
		const parsed = parseObsidianEmbedSpec(embedSpec);
		const file = resolveEmbedFile(parsed.linkPath);
		/* La garde porte sur l'URL, pas sur le fichier : `resourceUrl` rend
		   `null` quand rien ne sort, et c'est pour ça qu'il ne rend JAMAIS "".
		   Un `src=""` fait recharger la page courante comme image ; tester
		   seulement `file` produirait `src="null"` au lieu du `<code>` lisible
		   qui dit à l'élève quel lien est mort. */
		const src = file ? ctx.host.links.resourceUrl(file) : null;
		if (src && file) {
			const widthAttr = parsed.width ? ` width="${parsed.width}"` : "";
			const heightAttr = parsed.height ? ` height="${parsed.height}"` : "";
			const altAttr = escapeHtmlAttr(parsed.alt || file.name || "Image");
			return `<div class="${wrapClass}"><img class="${imgClass}" src="${src}" alt="${altAttr}" loading="eager"${widthAttr}${heightAttr}></div>`;
		}
		return `<code>${escapeHtmlText(`![[${embedSpec}]]`)}</code>`;
	}

	/** Une image `![alt](src)` du markdown. Une URL web (ou une image
	    `data:`) est affichée telle quelle — la liste blanche des champs
	    `*Html` l'accepte déjà, rien de neuf n'est ouvert ; tout autre `src`
	    est un chemin du vault, résolu comme un `![[…]]`. Introuvable : la
	    source reste lisible en code, comme un embed mort. */
	function imageMarkdownHtml(alt: string, src: string, { wrapClass, imgClass }: Required<EmbedClassOptions>): string {
		if (/^(https?:\/\/|data:image\/)/i.test(src) && isSafeQuizUrl(src, { image: true })) {
			return `<div class="${wrapClass}"><img class="${imgClass}" src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(alt)}" loading="eager"></div>`;
		}
		let chemin = src;
		try { chemin = decodeURI(src); } catch { /* `%` isolé : le chemin tel qu'écrit */ }
		const file = resolveEmbedFile(chemin);
		const url = file ? ctx.host.links.resourceUrl(file) : null;
		if (url && file) {
			return `<div class="${wrapClass}"><img class="${imgClass}" src="${url}" alt="${escapeHtmlAttr(alt || file.name || "Image")}" loading="eager"></div>`;
		}
		return `<code>${escapeHtmlText(`![${alt}](${src})`)}</code>`;
	}

	function renderTextWithEmbeds(raw: unknown, { wrapClass = "quiz-question-embed-wrap", imgClass = "quiz-question-embed" }: EmbedClassOptions = {}): string {
		/* Le markdown complet (blocs, images, liens) : `rendreTexteQuiz`. Les
		   images seules dépendent de l'hôte, qui les résout dans le vault. */
		return rendreTexteQuiz(raw, {
			embed: spec => buildEmbedImgHtml(spec, { wrapClass, imgClass }),
			image: (alt, src) => imageMarkdownHtml(alt, src, { wrapClass, imgClass }),
		});
	}

	function renderHintWithCodeAndEmbeds(raw: unknown): string {
		return renderTextWithEmbeds(raw, {
			wrapClass: "quiz-hint-embed-wrap",
			imgClass: "quiz-hint-embed"
		});
	}

	function renderRawHtmlWithEmbeds(raw: unknown, { wrapClass = "quiz-question-embed-wrap", imgClass = "quiz-question-embed" }: EmbedClassOptions = {}): string {
		return renderTextWithEmbeds(raw, { wrapClass, imgClass });
	}

	/**
	 * Le chemin d'affichage des champs `*Html` (énoncé, explication, leçon,
	 * support). C'est LE point de passage de tout HTML pré-rendu vers le DOM —
	 * d'où le passage par `sanitizeQuizHtml` ici, et non chez chacun des six
	 * appelants qui l'oubliaient tous (engine/cards.ts, passage.ts,
	 * text-only.ts).
	 *
	 * Ce HTML n'est pas forcément celui d'Ahmed : un quiz PARTAGÉ arrive avec
	 * les `explainHtml` de son auteur, et il est inséré par `innerHTML`, hors
	 * de portée du filtre d'Obsidian (le bloc est traité par ce plugin, pas par
	 * le rendu markdown). Sans cette passe, un `<img src=x onerror=…>` glissé
	 * dans une explication s'exécutait avec les droits d'Obsidian.
	 *
	 * L'ordre compte : on assainit AVANT de remplacer les `![[…]]`, pour que
	 * les `<img>` que cette fonction fabrique elle-même — les seuls en qui on
	 * ait confiance — ne repassent pas devant le filtre.
	 *
	 * Et le remplacement ne touche QUE les nœuds de texte. Une substitution de
	 * chaîne sur tout le HTML atteignait aussi les attributs : un
	 * `title="![[pic.png]]"` devenait `title="<div class="…"><img …>"`, dont le
	 * guillemet interne refermait l'attribut — du vrai balisage fabriqué APRÈS
	 * la dernière passe d'assainissement (revue codex 2026-07-31).
	 */
	function replaceObsidianEmbedsInHtml(html: unknown, { wrapClass = "quiz-explain-embed-wrap", imgClass = "quiz-explain-embed" }: EmbedClassOptions = {}): string {
		// NE PAS faire unescapeHtmlText ici car cela casserait l'affichage
		// des entités HTML comme &gt; qui doivent rester comme &gt; pour être
		// affichées comme > par le navigateur, pas interprétées comme des balises
		const tpl = document.createElement("template");
		tpl.innerHTML = sanitizeQuizHtml(html);
		/* `normalize()` avant de parcourir : l'assainissement retire les
		   commentaires et déballe les balises inconnues, ce qui laisse des nœuds
		   de texte ADJACENTS. Un `![[a<!-- x -->.png]]` se retrouvait coupé en
		   « ![[a » et « .png]] », et aucun des deux ne contenait l'embed —
		   l'ancienne substitution de chaîne, elle, le voyait. */
		tpl.content.normalize();

		const EMBED_RE = /!\[\[([^\]]+)\]\]/g;
		/* Collecté AVANT toute mutation : remplacer un nœud pendant que le
		   marcheur avance le ferait sauter le suivant. */
		const textes: Text[] = [];
		const marcheur = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
		for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
			if (EMBED_RE.test(n.nodeValue ?? "")) textes.push(n as Text);
			EMBED_RE.lastIndex = 0;
		}

		for (const noeud of textes) {
			const texte = noeud.nodeValue ?? "";
			/* Le nœud porte du texte DÉCODÉ : ses `<` et ses `&` doivent être
			   réécrits avant de repasser par un analyseur, sinon « a < b »
			   redeviendrait du balisage. Seul le HTML de l'image, que l'on
			   fabrique nous-mêmes, entre brut. */
			let html = "";
			let fin = 0;
			EMBED_RE.lastIndex = 0;
			for (let m = EMBED_RE.exec(texte); m; m = EMBED_RE.exec(texte)) {
				html += escapeHtmlText(texte.slice(fin, m.index));
				html += buildEmbedImgHtml(m[1], { wrapClass, imgClass });
				fin = m.index + m[0].length;
			}
			html += escapeHtmlText(texte.slice(fin));

			/* Remplacement par un FRAGMENT construit à part : réécrire le HTML du
			   parent détruirait ses autres enfants (et leurs écouteurs). */
			const frag = document.createElement("template");
			frag.innerHTML = html;
			noeud.replaceWith(frag.content);
		}
		return tpl.innerHTML;
	}

	return {
		escapeHtmlAttr,
		escapeHtmlText,
		unescapeHtmlText,
		isSafeQuizUrl,
		unwrapQuizHtmlElement,
		sanitizeQuizHtml,
		renderInlineQuizHtml,
		resourceButtonHtml,
		resolveEmbedFile,
		parseObsidianEmbedSpec,
		buildEmbedImgHtml,
		restoreAllowedInlineTags,
		renderInlineText,
		stripInlineMarkdown,
		renderTextWithEmbeds,
		renderHintWithCodeAndEmbeds,
		renderRawHtmlWithEmbeds,
		replaceObsidianEmbedsInHtml
	};
}
