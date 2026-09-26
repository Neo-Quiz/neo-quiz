/**
 * La conversion HTML → markdown des quiz existants (editor/html-vers-markdown.ts).
 *
 * Un quiz s'écrit en markdown, comme dans Discord et Obsidian (2026-09-26) :
 * un champ `promptHtml`, `explainHtml` ou `lessonHtml` est converti à
 * l'ouverture dans l'éditeur — quand c'est SANS PERTE. Ce contrôle éprouve
 * les deux moitiés de la règle : ce qui se convertit (chaque balise, les
 * imbrications, les entités, les artefacts de l'ancien `md2html`) et ce qui
 * doit rester en HTML (cellules fusionnées, style, balise inconnue, texte que
 * le markdown lirait autrement). Puis le câblage : `convertParsedToInternal`
 * retire le champ `*Html` du brouillon, et l'export écrit le markdown.
 *
 * La VRAIE fonction est chargée (scripts/lib/load-src.mjs), jamais une réplique.
 *
 *     npm run check:html-markdown
 */
import JSON5 from "json5";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const NL = "\n";

/** [nom, HTML, markdown attendu — `null` : le HTML est gardé] */
const CAS = [
	// Chaque balise.
	["paragraphes", "<p>un</p><p>deux</p>", "un" + NL + NL + "deux"],
	["saut de ligne", "a<br>b", "a" + NL + "b"],
	["strong et b", "<strong>A</strong> et <b>B</b>", "**A** et **B**"],
	["em et i", "<em>A</em> et <i>B</i>", "*A* et *B*"],
	["barré", "le port <del>25</del> 587", "le port ~~25~~ 587"],
	["code inline", "tape <code>ls -l</code>", "tape `ls -l`"],
	["code qui contient un accent grave", "<code>a ` b</code>", "``a ` b``"],
	["bloc de code avec sa langue",
		"<pre><code class=\"language-python\">if a &lt; b:" + NL + "    print(1)" + NL + "</code></pre>",
		"```python" + NL + "if a < b:" + NL + "    print(1)" + NL + "```"],
	["bloc de code de md2html (<br>, <p> autour)",
		"On exécute :</p><p><pre><code>x = [&#39;a&#39;]<br>y = x[1:3]</code></pre></p><p>Que vaut <code>y</code> ?",
		"On exécute :" + NL + NL + "```" + NL + "x = ['a']" + NL + "y = x[1:3]" + NL + "```" + NL + NL + "Que vaut `y` ?"],
	["liste à puces (et les <br> de md2html entre les éléments)", "<ul><li>un</li><br><li><code>deux</code></li></ul>", "- un" + NL + "- `deux`"],
	["liste numérotée qui commence à 3", "<ol start=\"3\"><li>a</li><li>b</li></ol>", "3. a" + NL + "4. b"],
	["sous-liste", "<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>", "- a" + NL + "  - b" + NL + "- c"],
	["élément de liste dans un <p>", "<ul><li><p>a</p></li><li><p>b</p></li></ul>", "- a" + NL + "- b"],
	// Une ligne SEULE reste du texte au rendu (règle de compatibilité) : une
	// liste d'un élément ne s'écrit pas en markdown sans changer d'aspect.
	["liste d'un seul élément : HTML gardé", "<ul><li>a</li></ul>", null],
	["lien", "voir <a href=\"https://ex.com/a?b=1&amp;c=2\" target=\"_blank\">la doc</a>", "voir [la doc](https://ex.com/a?b=1&c=2)"],
	["image web", "<img src=\"https://ex.com/i.png\" alt=\"schéma\">", "![schéma](https://ex.com/i.png)"],
	["image du vault (md2html)", "<img src=\"a.png\" class=\"qb-md-img\" />", "![[a.png]]"],
	["titre", "<h2>Titre</h2><p>corps</p>", "## Titre" + NL + NL + "corps"],
	["citation", "<blockquote>Une <strong>idée</strong><br>deux</blockquote>", "> Une **idée**" + NL + "> deux"],
	["tableau simple → GFM",
		"<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td><code>x</code></td><td>2</td></tr></tbody></table>",
		"| A | B |" + NL + "| --- | --- |" + NL + "| `x` | 2 |"],
	["tableau sans thead, première ligne en th", "<table><tr><th>A</th></tr><tr><td>1</td></tr></table>", "| A |" + NL + "| --- |" + NL + "| 1 |"],

	// Imbrications.
	["italique dans du gras", "<strong>gras <em>et italique</em> ici</strong>", "**gras *et italique* ici**"],
	["gras dans un lien", "<a href=\"https://a.b\"><strong>doc</strong></a>", "[**doc**](https://a.b)"],
	["espace au bord d'une emphase, sortie dehors", "a<strong> b </strong>c", "a **b** c"],

	// Entités.
	["entités de base", "a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;", "a & b < c > d \"e\" 'f'"],
	["entités nommées et numériques", "&eacute;t&eacute; &#233; &#x2192; &hellip; &nbsp;fin", "été é → …  fin"],

	// L'échappement : ce que le markdown lirait autrement fait garder le HTML.
	["des étoiles dans le texte : HTML gardé", "<p>*mot*</p>", null],
	["un accent grave dans le texte : HTML gardé", "<p>tape `ls`</p>", null],
	["une ligne qui commence par « - » : HTML gardé", "<p>Liste :<br>- a</p>", null],
	["une balise écrite en texte (&lt;b&gt;) : HTML gardé", "<p>la balise &lt;b&gt;x&lt;/b&gt;</p>", null],
	["gras collé à un mot : HTML gardé", "a<strong>b</strong>c", null],
	["une multiplication, elle, se convertit", "<p>3*4*5 et a</p><p>b</p>", "3*4*5 et a" + NL + NL + "b"],
	["une ligne seule qui commence par « &gt; » se convertit", "&gt; écrase, &gt;&gt; ajoute", "> écrase, >> ajoute"],

	// Ce que le markdown ne sait pas dire : le HTML est gardé, tel quel.
	["cellules fusionnées", "<table><tr><th colspan=\"2\">A</th></tr><tr><td>1</td><td>2</td></tr></table>", null],
	["tableau sans en-tête", "<table><tr><td>1</td></tr></table>", null],
	["couleur", "<span style=\"color: red\">x</span>", null],
	["image dimensionnée", "<img src=\"https://ex.com/i.png\" width=\"100\">", null],
	["balise inconnue", "<u>souligné</u>", null],
	["commentaire", "a<!-- note -->b", null],
	["entité inconnue", "a &zwnj; b", null],
	["balises croisées (md2html)", "<code>x <strong> 2</code> y</strong>", null],
	["lien javascript:", "<a href=\"javascript:alert(1)\">x</a>", null],
	["attribut sur un paragraphe", "<p class=\"note\">x</p>", null],
];

/** [nom, texte d'un champ TEXTE, markdown attendu — `null` : rien à faire] */
const CAS_TEXTE = [
	["énoncé généré en HTML de bloc", "<p>Le <strong>DNS</strong></p><p>suite</p>", "Le **DNS**" + NL + NL + "suite"],
	["balises inline : les sauts de ligne restent", "Use <code>ls</code>" + NL + "next **x**", "Use `ls`" + NL + "next **x**"],
	["markdown déjà là, puis une liste", "a <b>x</b>" + NL + NL + "- un" + NL + "- deux", "a **x**" + NL + NL + "- un" + NL + "- deux"],
	["pas de balise : rien", "rien **ici**", null],
	["une balise dans un code : rien", "tape `<b>` ici", null],
	["de la prose à chevrons : rien", "Ici 3 <x et y> 4", null],
	["balise attribuée : rien (le chemin HTML de l'export)", "Use <strong data-x=\"1\">bold</strong> ici", null],
];

await withSrcModule("src/editor/html-vers-markdown.ts", ({ htmlVersMarkdown, texteBaliseVersMarkdown }) => {
	const r = makeReporter("HTML → markdown");
	for (const [nom, html, attendu] of CAS) r.check(nom, htmlVersMarkdown(html), attendu);
	r.done();
	const t = makeReporter("Champ texte à balises");
	for (const [nom, texte, attendu] of CAS_TEXTE) t.check(nom, texteBaliseVersMarkdown(texte), attendu);
	t.done();
});

/* LE CÂBLAGE : la lecture d'un bloc (editor/convert.ts) convertit et retire
   le champ `*Html` ; l'écriture (editor/export.ts) enregistre le markdown ;
   un HTML inconvertible, lui, ressort à l'identique. */
await withSrcModule(["src/editor/convert.ts", "src/editor/export.ts"], (convert, exp) => {
	const r = makeReporter("Lecture et écriture d'un bloc");
	const lire = (brut) => convert.convertParsedToInternal(brut);
	const tour = (brut) => JSON5.parse(exp.exportAll([lire(brut)], null))[0];
	const base = { id: "x", title: "T", options: ["a", "b"], correctIndex: 0 };

	const q = lire({ ...base, promptHtml: "<p>Le <strong>DNS</strong></p><ul><li>un</li></ul>" });
	r.check("énoncé : markdown dans le brouillon, plus de HTML",
		[q.prompt, q._promptHtml, q._useHtmlPrompt], ["Le **DNS**" + NL + NL + "- un", undefined, false]);
	const e = tour({ ...base, prompt: "P", explainHtml: "<p>a <code>b</code></p><p>c</p>" });
	r.check("explication : écrite en markdown", [e.explain, e.explainHtml], ["a `b`" + NL + NL + "c", undefined]);
	const l = tour({ ...base, prompt: "P", lessonHtml: "<ol><li>un</li><li>deux</li></ol>" });
	r.check("leçon : écrite en markdown", [l.lesson, l.lessonHtml], ["1. un" + NL + "2. deux", undefined]);
	const p = tour({ ...base, prompt: "<p>Lecture <em>clé</em></p><pre><code>x = 1</code></pre>" });
	r.check("prompt texte à balises : écrit en markdown", [p.prompt, p.promptHtml], ["Lecture *clé*" + NL + NL + "```" + NL + "x = 1" + NL + "```", undefined]);
	const o = tour({ ...base, prompt: "P", options: ["<code>a</code>", "b"], hint: "<strong>pense</strong>" });
	r.check("options et indice à balises : en markdown", [o.options, o.hint], [["`a`", "b"], "**pense**"]);

	const garde = tour({ ...base, prompt: "P", explainHtml: "<span style=\"color: red\">rouge</span>" });
	r.check("HTML inconvertible : ressort à l'identique", garde.explainHtml, "<span style=\"color: red\">rouge</span>");
	const deux = tour({ ...base, prompt: "texte de l'auteur", promptHtml: "<p>autre</p>" });
	r.check("un texte écrit à côté du HTML : rien n'est écrasé",
		[deux.prompt, deux.promptHtml], ["texte de l'auteur", "<p>autre</p>"]);
	const liste = tour({ ...base, prompt: "Choisis :" + NL + "- un" + NL + "- deux" });
	r.check("le markdown de bloc reste du markdown à l'écriture", [liste.prompt, liste.promptHtml], ["Choisis :" + NL + "- un" + NL + "- deux", undefined]);
	r.done();
});
