/**
 * Non-régression du rendu markdown des champs texte du moteur.
 *
 * Le projet n'a pas de framework de test, et n'en veut pas. Cette logique-ci
 * fait exception : elle décide, sur du texte écrit par un modèle ou à la main,
 * ce qui devient du gras et ce qui reste une multiplication. Elle s'est déjà
 * trompée sur `3*4*5`, sur un chemin Windows, sur un prix en dollars et sur
 * une multiplication en lettres grecques — des cas qu'aucune relecture
 * n'attrape à l'œil.
 *
 * La VRAIE fonction est chargée (scripts/lib/load-src.mjs) plutôt que
 * recopiée : une réplique finirait par diverger de l'originale.
 *
 *     npm run check:md
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const BS = "\\";      // un antislash littéral
const DOL = "\\$";    // un dollar échappé en markdown

/** [nom, entrée, sortie attendue] */
const CAS = [
	["gras", "Le **DNS** traduit un nom", "Le <strong>DNS</strong> traduit un nom"],
	["italique", "(*Time To Live*) est un compteur", "(<em>Time To Live</em>) est un compteur"],
	["code", "le domaine nu `efrei.fr` pointe", "le domaine nu <code>efrei.fr</code> pointe"],
	["gras + italique", "**MX** (*Mail eXchanger*)", "<strong>MX</strong> (<em>Mail eXchanger</em>)"],
	["gras italique (triple)", "un ***point capital*** ici", "un <strong><em>point capital</em></strong> ici"],
	["barré", "le port ~~25~~ 587", "le port <del>25</del> 587"],

	// Ce qui ne doit PAS être interprété.
	["formule LaTeX intacte", "on compte : $128 - TTL_{reçu}$.", "on compte : $128 - TTL_{reçu}$."],
	["étoile dans une formule", "aire $a*b*c$ finale", "aire $a*b*c$ finale"],
	["multiplication espacée", "calcule 3 * 4 * 5 ici", "calcule 3 * 4 * 5 ici"],
	["multiplication collée", "calcule 3*4*5 ici", "calcule 3*4*5 ici"],
	["chemin Windows à jokers",
		"ouvre C:" + BS + "Users" + BS + "*" + BS + "AppData" + BS + "*" + BS + "Cache",
		"ouvre C:" + BS + "Users" + BS + "*" + BS + "AppData" + BS + "*" + BS + "Cache"],
	["dollars échappés (prix)",
		"Prix " + DOL + "5 et **promo** à " + DOL + "10",
		"Prix " + DOL + "5 et <strong>promo</strong> à " + DOL + "10"],
	["gras à l'intérieur d'un code", "tape `a**b**c` pour voir", "tape <code>a**b**c</code> pour voir"],
	["étoile isolée", "note * importante", "note * importante"],

	// Échappement HTML : rien de ce que l'utilisateur écrit ne devient une balise.
	["chevrons échappés", "si a < b alors <script>", "si a &lt; b alors &lt;script&gt;"],
	["apostrophe", "d'où mon contournement", "d&#39;où mon contournement"],
	["préfixe PowerShell", "tape PS> echo $env:PATH ici", "tape PS&gt; echo $env:PATH ici"],

	// Formes limites.
	["code à double accent grave", "tape ``a ` b`` ici", "tape <code>a ` b</code> ici"],
	/* Retour #4 du 2026-09-26 soir : un bloc de code collé sur une seule ligne
	   (dans un élément de classement ou d'option, où grammaire-blocs.ts ne
	   voit qu'un paragraphe) reste reconnu, et rendu en code EN LIGNE — plus
	   la clôture brute affichée telle quelle. Langage inconnu : pas de span
	   coloré, mais toujours du code. */
	["bloc de code sur une seule ligne, langage reconnu",
		"élément ```python def somme(n): return n``` ici",
		"élément <code class=\"quiz-md-code-inline language-python\">"
		+ "<span class=\"token keyword\">def</span> "
		+ "<span class=\"token function\">somme</span>"
		+ "<span class=\"token punctuation\">(</span>n<span class=\"token punctuation\">)</span>"
		+ "<span class=\"token punctuation\">:</span> "
		+ "<span class=\"token keyword\">return</span> n</code> ici"],
	["bloc de code sur une seule ligne, langage inconnu : code nu, sans span",
		"```mystere x < y``` ici",
		"<code class=\"quiz-md-code-inline language-mystere\">x &lt; y</code> ici"],
	["bloc de code sur une seule ligne, sans langage",
		"```(n + 1) * 2``` ici",
		"<code class=\"quiz-md-code-inline\">(n + 1) * 2</code> ici"],
	/* Mineur #5 de la revue du lot A2 : le nom de langage n'entre dans
	   l'attribut `class` qu'après l'échappement HTML (premier passage
	   d'`inlineMarkdown`) — un guillemet ou un chevron y arrive déjà en
	   entité, jamais littéral, et ne peut donc jamais refermer l'attribut ni
	   ouvrir une balise. Figé ici plutôt que de reposer sur la seule revue
	   manuelle ponctuelle qui l'a déjà vérifié. */
	["bloc de code : un guillemet et un chevron dans le nom de langage n'échappent jamais l'attribut",
		"```python\" onclick=\"alert(1) x < y``` ici",
		"<code class=\"quiz-md-code-inline\">python&quot; onclick=&quot;alert(1) x &lt; y</code> ici"],
	["deux gras dans la phrase", "**A** puis **B**", "<strong>A</strong> puis <strong>B</strong>"],
	["gras en début de chaîne", "**Attention** ici", "<strong>Attention</strong> ici"],
	["italique après parenthèse", "(*ainsi*)", "(<em>ainsi</em>)"],
	["gras multi-mots avec ponctuation",
		"**séparer les services d'un même domaine** (le A)",
		"<strong>séparer les services d&#39;un même domaine</strong> (le A)"],
	["flèche unicode", "*nom → adresse IPv4*", "<em>nom → adresse IPv4</em>"],
	["chaîne vide", "", ""],

	// Constats de la revue codex du 2026-07-31.
	["multiplication en lettres grecques", "on calcule α*β*γ ici", "on calcule α*β*γ ici"],
	["multiplication en ideogrammes", "produit 甲*乙*丙 final", "produit 甲*乙*丙 final"],
	["multiplication en arabe", "resultat س*ص*ع voila", "resultat س*ص*ع voila"],
	["quatre etoiles ne sont pas de l emphase", "voir ****ceci**** ici", "voir ****ceci**** ici"],
	["emphase imbriquee", "**fort *italique* ici**", "<strong>fort <em>italique</em> ici</strong>"],

	/* Revue du 2026-09-26 (I2) : le code prime sur la formule. Dans l'autre
	   ordre, une formule enjambait deux codes, et le jeton de mise à l'abri
	   s'affichait (« 0PATH ») — 35 champs réels de cours shell. */
	["deux codes à dollar", "`$HOME` et `$PATH`", "<code>$HOME</code> et <code>$PATH</code>"],
	["formule entière dans un code", "tape `a $x$ b` ici", "tape <code>a $x$ b</code> ici"],
	["accolades shell dans un code", "`echo {$DEBUT..$FIN}`", "<code>echo {$DEBUT..$FIN}</code>"],
	["U+0000 du texte : aucun jeton forgé",
		String.fromCharCode(0) + "0" + String.fromCharCode(0) + " et `a`",
		String.fromCharCode(0xfffd) + "0" + String.fromCharCode(0xfffd) + " et <code>a</code>"],
];

/* Texte NU : mêmes règles de flanc, sortie sans balises. Là où le HTML
   n'existe pas — attribut `placeholder`, `aria-label`, vignette de liste —
   un marqueur apparié doit TOMBER, jamais s'afficher. Ce qui n'est pas de
   l'emphase (multiplication, chemin, formule) reste intact : c'est la même
   grammaire, et ces cas-là ont déjà coûté quatre corrections au rendu. */
const CAS_NUS = [
	["gras retiré", "Réponds en **majuscules**", "Réponds en majuscules"],
	["code retiré", "tape `ls -l` ici", "tape ls -l ici"],
	["triple retiré", "un ***point*** ici", "un point ici"],
	["barré retiré", "le port ~~25~~ 587", "le port 25 587"],
	["multiplication intacte", "calcule 3*4*5 ici", "calcule 3*4*5 ici"],
	["étoile isolée intacte", "arp -d * vide le cache", "arp -d * vide le cache"],
	["chemin Windows intact",
		"C:" + BS + "Users" + BS + "*" + BS + "AppData",
		"C:" + BS + "Users" + BS + "*" + BS + "AppData"],
	["formule LaTeX intacte", "vaut $a*b*c$ au total", "vaut $a*b*c$ au total"],
	// Un attribut est réencodé par escapeHtmlAttr au point d'appel : rendre ici
	// « &#39; » laisserait l'entité VISIBLE dans le placeholder.
	["apostrophe rendue au caractère", "d'où l'erreur", "d'où l'erreur"],
	["chevrons rendus au caractère", "si a < b alors", "si a < b alors"],
	["esperluette non doublée", "Tom & Jerry", "Tom & Jerry"],
	["chaîne vide", "", ""],
	// Une balise inline ÉCRITE à la main : le rendu en fait du gras, le texte
	// nu doit en faire du texte — et non montrer ses chevrons.
	["balise littérale retirée", "<strong>x</strong> y", "x y"],
	["saut de ligne devient une espace", "a<br>b", "a b"],
	["balise NON autorisée reste visible", "<img src=x> y", "<img src=x> y"],
	// Un placeholder de zone de texte peut être multiligne et indenté exprès :
	// l'aplatir ici lui ferait perdre sa forme. Les appelants qui veulent UNE
	// ligne (la vignette de la liste) la demandent eux-mêmes.
	["indentation d'un placeholder préservée",
		"Exemple :\n    SELECT **x**\n    FROM t",
		"Exemple :\n    SELECT x\n    FROM t"],
];

await withSrcModule("src/engine/sanitizer.ts", ({ renderInlineText, stripInlineMarkdown }) => {
	const r = makeReporter("Markdown");
	for (const [nom, entree, attendu] of CAS) r.check(nom, renderInlineText(entree), attendu);
	r.done();

	const rn = makeReporter("Texte nu");
	for (const [nom, entree, attendu] of CAS_NUS) rn.check(nom, stripInlineMarkdown(entree), attendu);
	rn.done();
});

/* Le DÉCOUPAGE en positions du champ à aperçu en direct
   (engine/grammaire-inline.ts, lu par editor/champ-direct.ts). Il doit voir
   EXACTEMENT ce que le rendu voit : un `*` que le champ montrerait en
   italique et que le quiz laisserait tel quel, et l'éditeur mentirait.
   Deux contrôles : des cas écrits (les positions), puis, sur TOUT le corpus
   du rendu ci-dessus, le même nombre de chaque balise des deux côtés. */
await withSrcModule(["src/engine/sanitizer.ts", "src/engine/grammaire-inline.ts"], ({ renderInlineText }, { decouperInline }) => {
	const r = makeReporter("Découpage du champ direct");
	const vu = (texte) => decouperInline(texte)
		.map(s => `${s.genre}:${texte.slice(s.debut, s.fin)}`).join(" | ");

	r.check("code inline", vu("Quand on lance `python3 main.py` ici"), "code:`python3 main.py`");
	r.check("gras et italique", vu("**A** et *b*"), "gras:**A** | italique:*b*");
	r.check("triple", vu("un ***point*** ici"), "grasItalique:***point***");
	r.check("formule", vu("soit $x^2$ ici"), "formule:$x^2$");
	r.check("formule bloc", vu("$$\\int f$$"), "formule:$$\\int f$$");
	r.check("formule dans un code : avalée", vu("tape `a $x$ b` ici"), "code:`a $x$ b`");
	r.check("deux codes à dollar : deux codes, aucune formule", vu("`$HOME` et `$PATH`"), "code:`$HOME` | code:`$PATH`");
	r.check("formule sur deux lignes : comme au rendu", vu("$a" + "\n" + "b$ **c**"), "formule:$a" + "\n" + "b$ | gras:**c**");
	r.check("gras dans un code : rien", vu("tape `a**b**c` ici"), "code:`a**b**c`");
	r.check("multiplication collée : rien", vu("3*4*5"), "");
	r.check("étoile dans une formule : rien d'autre", vu("aire $a*b*c$"), "formule:$a*b*c$");
	r.check("dollars échappés : pas de formule", vu("Prix \\$5 et **promo** \\$10"), "gras:**promo**");
	r.check("emphase imbriquée", vu("**fort *it* ici**"), "gras:**fort *it* ici** | italique:*it*");
	r.check("double accent grave", vu("tape ``a ` b`` ici"), "code:``a ` b``");
	r.check("un <code> écrit à la main est littéral", vu("<code>*a*</code>"), "");
	r.check("les ![[…]] coupent le texte", vu("*a ![[x.png]] b*"), "");
	r.check("positions après un embed", vu("![[x.png]] `c`"), "code:`c`");
	r.check("quatre étoiles : rien", vu("voir ****ceci**** ici"), "");

	// `<code\b` et non `<code>` : un bloc de code sur une seule ligne (retour
	// #4 du 2026-09-26 soir) rend `<code class="quiz-md-code-inline…">`, avec
	// des attributs — toujours un SEUL `<code>` par segment "code", juste
	// habillé, comme `<strong>`/`<em>`/`<del>` ne le sont jamais.
	const compter = (html, balise) => (html.match(new RegExp("<" + balise + "\\b", "g")) || []).length;
	const genres = (texte, ...g) => decouperInline(texte).filter(s => g.includes(s.genre)).length;
	let divergences = 0;
	for (const [nom, entree] of CAS) {
		const html = renderInlineText(entree);
		const ok = compter(html, "strong") === genres(entree, "gras", "grasItalique")
			&& compter(html, "em") === genres(entree, "italique", "grasItalique")
			&& compter(html, "code") === genres(entree, "code")
			&& compter(html, "del") === genres(entree, "barre");
		if (!ok) { divergences++; console.log("  divergence rendu / champ :", nom); }
	}
	r.check("même nombre de balises que le rendu, sur tout le corpus", divergences, 0);
	r.check("le texte d'un lien est découpé, son URL jamais",
		vu("voir [**doc**](https://a.b/*x*) ici"), "gras:**doc**");
	r.check("une image coupe le texte", vu("*a ![b](c.png) d*"), "");
	r.done();
});

/* LE MARKDOWN DE BLOC (engine/grammaire-blocs.ts) et les images et liens,
   par la VRAIE fonction du moteur (`rendreTexteQuiz`, et
   `renderTextWithEmbeds` d'un vrai `createSanitizer`). Du markdown partout,
   comme dans Discord et Obsidian (2026-09-26) — et toujours l'échappement
   AVANT le markdown : un quiz peut venir de quelqu'un d'autre. */
await withSrcModule(
	["src/engine/sanitizer.ts", "src/engine/grammaire-blocs.ts", "src/engine/code-highlight.ts", "src/code-catalogue.ts"],
	({ rendreTexteQuiz, renderInlineText, createSanitizer }, { decouperBlocs, aDesBlocs }, { reinitialiserBudgetRendu }, { codeLanguageOf, codeLanguageBadgeSrc }) => {
	const r = makeReporter("Blocs, images et liens");
	/* The language badge a recognized block carries in the displayed render
	   (code-catalogue.ts, 2026-09-28), first child of its `<pre>`. Its exact
	   form is `check:code-catalogue`'s business; here it is only the markup
	   the expected strings include. */
	const BADGE = (tag) => {
		const e = codeLanguageOf(tag);
		return `<img class="quiz-code-lang" src="${codeLanguageBadgeSrc(e)}" alt="${e.name}" title="${e.name}" width="16" height="16" draggable="false">`;
	};
	/* The ONLY `<img>` allowed inside a `<pre>`: our own badge, at its very
	   start, with a `data:` source that holds no `"`, `<`, `>` or `&`. Any
	   other image (an injected `<img onerror=…>`) must still come out
	   escaped. */
	const BADGE_EN_TETE = /^<img class="quiz-code-lang" src="data:image\/svg\+xml,[^"<>&]*" alt="[^"<>&]*" title="[^"<>&]*" width="16" height="16" draggable="false">/;
	const IMG = { embed: s => `[embed:${s}]`, image: (a, s) => `[image:${a}|${s}]` };
	/* `rendreTexteQuiz` partage désormais un budget de coloration de MODULE
	   (code-highlight.ts), remis à zéro par ses appelants réels une fois par
	   carte (revue du 2026-09-26, tour 3) — jamais ici. Ce script appelle
	   `rendreTexteQuiz` directement, en dehors de tout appelant : chaque cas
	   qui dépend d'un budget frais le remet lui-même à zéro AVANT de rendre,
	   pour ne pas dépendre de l'ordre des cas précédents. */
	// `executable: true` : ce script éprouve le rendu AFFICHÉ à l'apprenant
	// (celui de `renderTextWithEmbeds`), qui seul enveloppe un bloc Python
	// d'un bouton « Exécuter » (revue du 2026-09-26, A-IMPORTANT 1).
	const rendre = (t) => rendreTexteQuiz(t, IMG, true);
	const NL = "\n";
	const P = (x) => `<p class="quiz-md-p">${x}</p>`;

	r.check("paragraphes", rendre("un" + NL + NL + "deux"), P("un") + P("deux"));
	r.check("liste à puces", rendre("Choisis :" + NL + "- `a`" + NL + "- **b**"),
		P("Choisis :") + `<ul class="quiz-md-liste"><li><code>a</code></li><li><strong>b</strong></li></ul>`);
	r.check("liste numérotée qui commence à 3", rendre("x" + NL + "3. a" + NL + "4. b"),
		P("x") + `<ol class="quiz-md-liste" start="3"><li>a</li><li>b</li></ol>`);
	r.check("sous-liste par l'indentation", rendre("- a" + NL + "  - b" + NL + "- c"),
		`<ul class="quiz-md-liste"><li>a<ul class="quiz-md-liste"><li>b</li></ul></li><li>c</li></ul>`);
	reinitialiserBudgetRendu();
	/* A Python block is wrapped (`.quiz-code-block-executable`) to house the
	   « Run » button (engine/code-run.ts, outside the DOM here: hidden by
	   default, unmasked only when the host provides `HostCode`). Another
	   language stays rendered identically (see below). */
	r.check("bloc de code : coloré et échappé (python reconnu)",
		rendre("```python" + NL + "print(\"<script>\")" + NL + "**x** $y$" + NL + "```"),
		`<div class="quiz-code-block quiz-code-block-executable" data-lang="python"><div class="quiz-code-toolbar">`
		+ `<button type="button" class="quiz-code-run-btn" data-quiz-code-run hidden>`
		+ `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>`
		+ `</button></div>`
		+ `<pre class="quiz-md-code">${BADGE("python")}<code class="language-python">`
		+ `<span class="token keyword">print</span><span class="token punctuation">(</span>`
		+ `<span class="token string">&quot;&lt;script&gt;&quot;</span><span class="token punctuation">)</span>`
		+ NL + `<span class="token operator">**</span>x<span class="token operator">**</span> $y$</code></pre>`
		+ `<div class="quiz-code-output" hidden aria-label="Output"></div></div>`);
	// Every language of the pure table (src/code-languages.ts langageDeBloc),
	// not Python alone: task 5 of the C/C++ execution plan.
	r.check("c block is runnable",
		/class="quiz-code-block quiz-code-block-executable" data-lang="c"/.test(rendre("```c" + NL + "int x;" + NL + "```")), true);
	r.check("c++ alias is runnable",
		/data-lang="cpp"/.test(rendre("```c++" + NL + "int x;" + NL + "```")), true);
	r.check("python keeps its wrapper, with its language",
		/data-lang="python"/.test(rendre("```python" + NL + "x=1" + NL + "```")), true);
	r.check("java stays a bare block (outside the runnable table)",
		rendre("```java" + NL + "class A{}" + NL + "```").includes("quiz-code-block"), false);
	r.check("bloc de code jamais refermé : jusqu'à la fin", rendre("a" + NL + "```" + NL + "x"),
		P("a") + `<pre class="quiz-md-code"><code>x</code></pre>`);
	r.check("langage inconnu : texte échappé, aucun span",
		rendre("```mystere" + NL + "<script>a</script>" + NL + "```"),
		`<pre class="quiz-md-code"><code class="language-mystere">&lt;script&gt;a&lt;/script&gt;</code></pre>`);
	r.check("aucun langage : texte échappé, aucun span",
		rendre("```" + NL + "<script>a</script>" + NL + "```"),
		`<pre class="quiz-md-code"><code>&lt;script&gt;a&lt;/script&gt;</code></pre>`);
	r.check("langage en MAJUSCULES : reconnu quand même",
		rendre("```PYTHON" + NL + "import os" + NL + "```").includes('<span class="token keyword">import</span>'), true);
	r.check("alias `py` : reconnu comme python",
		rendre("```py" + NL + "import os" + NL + "```").includes('<span class="token keyword">import</span>'), true);
	const LANGUES_INJECTION = ["python", "c", "cpp", "bash", "javascript", "sql", "markup", "mystere"];
	// The table's languages (src/code-languages.ts langageDeBloc: python, c,
	// cpp — task 5 of the C/C++ execution plan), the only ones a runnable
	// wrapper wraps. Any language outside it must keep ZERO tags outside
	// `<pre>`: the guarantee below is exactly as strict for a language the
	// table does not name.
	const LANGUES_EXECUTABLES = new Set(["python", "c", "cpp"]);
	r.check("injection dans un bloc de code coloré : jamais de balise brute, dans plusieurs langages",
		LANGUES_INJECTION.map(langue => {
			const html = rendre("```" + langue + NL + "<img src=x onerror=alert(1)>" + NL + "</code></pre><script>" + NL + "```");
			// Only our own tags (pre/code/span) may appear inside `pre…/pre`:
			// the rest of the block's content must be escaped, token by token.
			// `div`/`button`/`svg`/`polygon` (the « Run » button) are allowed
			// ONLY for the table's executable languages, and only OUTSIDE the
			// `<pre>` (review of 2026-09-26, minor 2) — allowing them for every
			// language would have let through a future injection of these same
			// tags in a language with no wrapper.
			const dansPre = html.replace(/^.*?<pre[^>]*>/s, "").replace(/<\/pre>.*$/s, "").replace(BADGE_EN_TETE, "");
			const horsPre = html.replace(/<pre[^>]*>.*?<\/pre>/s, "");
			const balisesPre = [...dansPre.matchAll(/<\/?([a-z]+)[^>]*>/gi)].every(m => ["code", "span"].includes(m[1].toLowerCase()));
			const balisesHorsPre = LANGUES_EXECUTABLES.has(langue)
				? [...horsPre.matchAll(/<\/?([a-z]+)[^>]*>/gi)].every(m => ["div", "button", "svg", "polygon"].includes(m[1].toLowerCase()))
				: [...horsPre.matchAll(/<\/?([a-z]+)[^>]*>/gi)].length === 0;
			return balisesPre && balisesHorsPre;
		}), LANGUES_INJECTION.map(() => true));
	r.check("alias `c++` : reconnu comme cpp",
		rendre("```c++" + NL + "int x = 1;" + NL + "```").includes('<span class="token keyword">int</span>'), true);
	/* Revue du 2026-09-26 (M1) : une langue comme `constructor` ou `__proto__`
	   ne doit jamais lire la propriété héritée du même nom sur
	   `Object.prototype` (ici la fonction `Object`, ou l'objet prototype
	   lui-même) — juste retomber sur `null`, texte échappé nu. */
	r.check("langage `constructor` : jamais la propriété héritée, texte échappé",
		rendre("```constructor" + NL + "<i>x</i>" + NL + "```"),
		`<pre class="quiz-md-code"><code class="language-constructor">&lt;i&gt;x&lt;/i&gt;</code></pre>`);
	r.check("langage `__proto__` : idem",
		rendre("```__proto__" + NL + "<i>x</i>" + NL + "```"),
		`<pre class="quiz-md-code"><code class="language-__proto__">&lt;i&gt;x&lt;/i&gt;</code></pre>`);
	/* Plafond PAR BLOC (re-revue du 2026-09-26, tour 3) : au-delà d'environ
	   1000 caractères, le reste d'un bloc s'affiche échappé sans couleurs.
	   1600 nombres séparés d'une espace (3199 caractères) : loin sous le
	   plafond pour une partie, loin au-delà pour l'autre — si TOUS étaient
	   colorés, la troncature ne servirait à rien. */
	{
		reinitialiserBudgetRendu();
		const NOMBRES = 1600;
		const gros = Array.from({ length: NOMBRES }, () => "1").join(" ");
		const html = rendre("```python" + NL + gros + NL + "```");
		const colores = (html.match(/<span class="token number">1<\/span>/g) || []).length;
		r.check("plafond par bloc : coloration tronquée avant la fin d'un bloc trop long",
			colores > 0 && colores < NOMBRES, true);
	}
	/* Budget CUMULÉ par RENDU (tour 3, remplace le budget par texte du
	   tour 2 — insuffisant : un seul champ à 7 blocs de 3000 prenait 2,1 s).
	   Le budget est un compteur de MODULE (code-highlight.ts), partagé par
	   tous les appels à `rendreTexteQuiz`, jamais remis à zéro tout seul —
	   `reinitialiserBudgetRendu()` simule ici le début du rendu d'UNE carte
	   (ce que font pour de vrai `engine/cards.ts questionCardHtml` et
	   `editor/question-preview.ts texteQuizHtml`). Huit blocs de 3199
	   caractères (chacun plafonné à 1000 caractères coloré au plus)
	   dépassent le budget de 5000 avant la fin du texte — le dernier bloc
	   doit sortir entièrement NU, alors que le premier reste coloré. */
	{
		reinitialiserBudgetRendu();
		const unBloc = () => "```python" + NL + Array.from({ length: 1600 }, () => "1").join(" ") + NL + "```";
		const huitBlocs = Array.from({ length: 8 }, unBloc).join(NL + NL);
		const html = rendre(huitBlocs);
		const comptes = html.split('<pre class="quiz-md-code">').slice(1)
			.map(segment => (segment.match(/<span class="token number">1<\/span>/g) || []).length);
		r.check("budget cumulé : le premier bloc d'un rendu reste coloré", comptes[0] > 0, true);
		r.check("budget cumulé : le dernier bloc d'un rendu trop riche en code perd sa coloration", comptes[7], 0);
	}
	// Remis à zéro pour ne pas laisser un budget épuisé fuiter vers les cas
	// suivants de ce même bloc de test (tableaux, listes…), tous insensibles
	// à la coloration mais par hygiène.
	reinitialiserBudgetRendu();
	r.check("tableau : en-tête, alignements, `|` dans un code",
		rendre("| A | B |" + NL + "|:-:|--:|" + NL + "| `a|b` | <script> |"),
		`<table class="quiz-md-table"><thead><tr><th style="text-align: center">A</th><th style="text-align: right">B</th></tr></thead>`
		+ `<tbody><tr><td style="text-align: center"><code>a|b</code></td><td style="text-align: right">&lt;script&gt;</td></tr></tbody></table>`);
	r.check("tableau : un `|` dans une formule ne coupe pas la cellule (I3)",
		rendre("| a | b |" + NL + "|---|---|" + NL + "| $|x|$ | 2 |"),
		`<table class="quiz-md-table"><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>$|x|$</td><td>2</td></tr></tbody></table>`);
	r.check("tableau : `\\|` est une barre littérale (GFM)",
		rendre("| a \\| b | c |" + NL + "|---|---|" + NL + "| 1 | <i>2</i> \\| 3 |"),
		`<table class="quiz-md-table"><thead><tr><th>a | b</th><th>c</th></tr></thead><tbody><tr><td>1</td><td><i>2</i> | 3</td></tr></tbody></table>`);
	r.check("tableau : une rangée plus longue que l'en-tête ne perd rien",
		rendre("| a | b |" + NL + "|---|---|" + NL + "| 1 | 2 | <script> |" + NL + "| x |"),
		`<table class="quiz-md-table"><thead><tr><th>a</th><th>b</th><th></th></tr></thead><tbody>`
		+ `<tr><td>1</td><td>2</td><td>&lt;script&gt;</td></tr><tr><td>x</td><td></td><td></td></tr></tbody></table>`);
	r.check("tableau : deux prix restent deux cellules",
		rendre("| a | b |" + NL + "|---|---|" + NL + "| 5$ | 10$ |"),
		`<table class="quiz-md-table"><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>5$</td><td>10$</td></tr></tbody></table>`);
	r.check("un `$$` dans un code n'empêche pas les blocs (M4)",
		rendre("Le prompt `$$` de bash" + NL + "- a" + NL + "- b" + NL + NL + "fin"),
		P("Le prompt <code>$$</code> de bash") + `<ul class="quiz-md-liste"><li>a</li><li>b</li></ul>` + P("fin"));
	r.check("titre et citation", rendre("## T" + NL + "> **a**" + NL + "> b"),
		`<h2 class="quiz-md-titre">T</h2><blockquote class="quiz-md-citation"><strong>a</strong><br>b</blockquote>`);
	r.check("une balise dans une liste reste du texte", rendre("- <img src=x onerror=alert(1)>" + NL + "- b"),
		`<ul class="quiz-md-liste"><li>&lt;img src=x onerror=alert(1)&gt;</li><li>b</li></ul>`);
	r.check("formule $$ sur plusieurs lignes : un seul paragraphe", rendre("$$" + NL + "a" + NL + NL + "- b" + NL + "$$" + NL + NL + "c"),
		P("$$<br>a<br><br>- b<br>$$") + P("c"));

	// Images et liens.
	r.check("lien web", rendre("voir [la **doc**](https://ex.com/a?b=1&c=2)"),
		`voir <a class="quiz-md-lien" href="https://ex.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">la <strong>doc</strong></a>`);
	r.check("lien javascript: reste du texte", rendre("[x](javascript:alert(1))"), "[x](javascript:alert(1))");
	r.check("guillemet d'une URL échappé dans l'attribut", rendre("[x](https://a.b/\"onmouseover=alert;'x')"),
		`<a class="quiz-md-lien" href="https://a.b/&quot;onmouseover=alert;&#39;x&#39;" target="_blank" rel="noopener noreferrer">x</a>`);
	r.check("image et embed passent par l'hôte", rendre("![schéma](img/a.png) et ![[b.png]]"), "[image:schéma|img/a.png] et [embed:b.png]");
	r.check("image dans un code : du code", rendre("tape `![a](b)`"), "tape <code>![a](b)</code>");

	// La règle de compatibilité : un seul paragraphe = le rendu d'avant.
	const avant = (t) => renderInlineText(t.replace(/\n/g, "<br>"));
	r.check("une ligne « - x » reste du texte", rendre("- x"), "- x");
	r.check("une ligne « > x » reste du texte", rendre("> écrase"), "&gt; écrase");
	r.check("plusieurs lignes d'un paragraphe : <br> comme avant", rendre("a" + NL + "**b**" + NL), avant("a" + NL + "**b**" + NL));
	/* Au hasard : des textes d'un seul paragraphe, sans lien ni image (le seul
	   ajout inline), faits des caractères qui ont coûté des bugs. Le rendu doit
	   être celui d'avant, octet pour octet. */
	const alphabet = ["a", "b", " ", "*", "**", "`", "$", "~~", NL, "<b>", "</b>", "<", "&", "\\", "-", "1.", "é", "|", "#", ">"];
	let graine = 7;
	const hasard = () => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; };
	let essais = 0, ecarts = 0, fuites = 0;
	for (let k = 0; k < 20000; k++) {
		let t = "";
		const n = 1 + Math.floor(hasard() * 14);
		for (let j = 0; j < n; j++) t += alphabet[Math.floor(hasard() * alphabet.length)];
		// Aucun jeton interne ne s'affiche jamais, quel que soit le texte.
		if (rendre(t).includes(String.fromCharCode(0))) fuites++;
		if (aDesBlocs(decouperBlocs(t)) || /\]\(/.test(t)) continue;
		essais++;
		if (rendre(t) !== avant(t)) { ecarts++; if (ecarts < 4) console.log("  écart :", JSON.stringify(t)); }
	}
	r.check(`un paragraphe : identique à avant (${essais} textes au hasard)`, ecarts, 0);
	r.check("assez de textes au hasard pour que l'identité dise quelque chose", essais > 5000, true);
	r.check("aucun jeton de mise à l'abri dans le rendu (20 000 textes)", fuites, 0);

	// Le vrai `renderTextWithEmbeds` : une image du vault résolue, une URL web
	// telle quelle, une image introuvable lisible en code.
	const fichier = { path: "img/a.png", name: "a.png" };
	const ctx = { sourcePath: "note.md", host: { links: {
		resolve: (p) => (p === "img/a.png" ? fichier : null),
		resourceUrl: (f) => (f === fichier ? "app://img/a.png" : null),
	} } };
	const s = createSanitizer(ctx);
	r.check("image du vault résolue", s.renderTextWithEmbeds("![vue](img/a.png)"),
		`<div class="quiz-question-embed-wrap"><img class="quiz-question-embed" src="app://img/a.png" alt="vue" loading="eager"></div>`);
	r.check("image web", s.renderTextWithEmbeds("![x](https://ex.com/i.png)"),
		`<div class="quiz-question-embed-wrap"><img class="quiz-question-embed" src="https://ex.com/i.png" alt="x" loading="eager"></div>`);
	r.check("image introuvable : sa source en code", s.renderTextWithEmbeds("![x](manque.png)"), "<code>![x](manque.png)</code>");
	r.check("paragraphes par le vrai moteur", s.renderTextWithEmbeds("a" + NL + NL + "b"), P("a") + P("b"));
	r.done();
});

/* Texte à trous : une paire markdown qui ENJAMBE un trou doit rester une
   paire. Rendre chaque segment séparément laissait « `git ` » et « ` -b` »
   avec un accent grave chacun, tous deux affichés bruts. */
await withSrcModule("src/engine/cloze.ts", ({ markSlots, fillSlots, codeClozeHtml }) => {
	const r = makeReporter("Trous");

	const rendu = (gabarit) => {
		const { marked, blanks } = markSlots(gabarit);
		// Le vrai rendu passe par le sanitizer ; ici on vérifie seulement que
		// le marquage laisse le gabarit d'un seul tenant et que les jetons se
		// remplacent tous.
		return { marked, n: blanks.length, rempli: fillSlots(marked, (i) => "[" + i + "]") };
	};

	r.check("un trou", rendu("La capitale est {{Paris}}.").rempli, "La capitale est [0].");
	r.check("deux trous", rendu("{{a}} puis {{b}}").rempli, "[0] puis [1]");
	r.check("trou vide non compté", rendu("rien {{}} ici").n, 0);
	r.check("trou vide laissé littéral", rendu("rien {{}} ici").rempli, "rien {{}} ici");
	r.check("variantes comptées une fois", rendu("{{l'euro|euro}}").n, 1);
	r.check("code enjambant un trou — gabarit d'un seul tenant",
		rendu("tape `git {{checkout}} -b` ici").marked.includes("`git "), true);
	r.check("code enjambant un trou — un seul segment",
		rendu("tape `git {{checkout}} -b` ici").rempli, "tape `git [0] -b` ici");
	r.check("gras enjambant un trou",
		rendu("**avant {{x}} apres**").rempli, "**avant [0] apres**");

	/* Le jeton doit survivre a un aller-retour `innerHTML` : l apercu passe par
	   le DOM (resolveImagesInHtml), et un marqueur fait de caracteres NULS y
	   etait remplace — « CLOZE0 » s affichait alors en toutes lettres. */
	const { marked } = markSlots("ping {{8.8.8.8}} -t");
	r.check("jeton hors du plan de base (zone privee)",
		[...marked].some(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xE001), true);
	r.check("jeton sans caractere NUL",
		marked.includes(String.fromCharCode(0)), false);
	r.check("jeton sans lettres lisibles",
		/CLOZE/.test(marked), false);

	/* A blank in CODE, one pair of backticks per line: a single block, the
	   indentation kept. Rendered as markdown, the lines became spaced-out
	   paragraphs, a loop body at the level of its `for`. */
	const code = (template) => {
		const html = codeClozeHtml(markSlots(template).marked);
		return html === null ? null : fillSlots(html, (i) => "[" + i + "]");
	};
	r.check("code: one block, indentation kept",
		code("`for i in x:`\n`    L.{{append}}(i)`"),
		"<pre class=\"quiz-cloze-code\"><code>for i in x:\n    L.[0](i)</code></pre>");
	r.check("code: escaped", code("`a < {{b}} & c`"),
		"<pre class=\"quiz-cloze-code\"><code>a &lt; [0] &amp; c</code></pre>");
	r.check("code: inner empty line kept", code("`a`\n\n`{{b}}`"),
		"<pre class=\"quiz-cloze-code\"><code>a\n\n[0]</code></pre>");
	r.check("sentence with code: not a block", code("tape `git {{checkout}} -b` ici"), null);

	/* A blank INSIDE a formula (2026-09-28): the formula is closed before the
	   blank and reopened after, never carried into the TeX. */
	r.check("blank inside a formula", rendu("donne $du = {{3}}dx$, ok").rempli, "donne $du =$ [0]$dx$, ok");
	r.check("blank at the end of a formula", rendu("$u = {{7}}$").rempli, "$u =$ [0]");
	r.check("two blanks in one formula", rendu("$a {{1}} b {{2}} c$").rempli, "$a$ [0] $b$ [1] $c$");
	r.check("formula without a blank untouched", rendu("$x^2$ et {{y}}").rempli, "$x^2$ et [0]");
	r.check("dollar in code untouched", rendu("`echo $HOME {{x}} $PATH`").rempli, "`echo $HOME [0] $PATH`");
	r.check("escaped dollar untouched", rendu("5 \\$ et {{x}} \\$").rempli, "5 \\$ et [0] \\$");
	/* A blank's answers may hold LaTeX braces. */
	r.check("braces in a blank's answer", rendu("$dx = {{\\frac{1}{3}|1/3}}du$").n, 1);
	r.check("braces in a blank's answer: rendered", rendu("$dx = {{\\frac{1}{3}|1/3}}du$").rempli, "$dx =$ [0]$du$");
	r.check("two levels of braces", rendu("{{\\frac{\\sqrt{2}}{2}}}").n, 1);
	r.check("a line of text among the code: not a block", code("`a`\nfin {{b}}"), null);

	r.done();
});

/* Les STYLES DE LECTURE (2026-09-26) : étapes, cases de tableau, cartes et
   récapitulatif passent par la MÊME grammaire que le reste du quiz — le
   rendu RÉEL (engine/lecture-rendu.ts) avec les portes RÉELLES. Un champ
   affiché sans porte montrerait ses astérisques. */
await withSrcModule(["src/engine/lecture-rendu.ts", "src/engine/sanitizer.ts"], ({ corpsLectureHtml }, san) => {
	const r = makeReporter("Markdown des styles de lecture");
	const portes = {
		bloc: (s) => san.rendreTexteQuiz(s, { embed: () => "", image: () => "" }),
		inline: san.renderInlineText,
		attribut: (s) => san.stripInlineMarkdown(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"),
	};
	const html = (item) => corpsLectureHtml(item, item.prompt ?? "", portes.bloc(item.prompt ?? ""), "", portes).html;
	const md = "**gras** et `code`";
	const attendu = san.renderInlineText(md);
	r.check("étape : markdown rendu", html({ lecture: "etapes", prompt: "", etapes: [md] }).includes(attendu), true);
	r.check("case de tableau et en-tête : markdown rendu",
		(html({ lecture: "tableau", prompt: "", tableau: { colonnes: [md], lignes: [[md]] } }).split(attendu).length - 1), 2);
	r.check("carte recto et verso : markdown rendu",
		(html({ prompt: "", retenir: { forme: "cartes", items: [{ recto: md, verso: md }] } }).split(attendu).length - 1), 2);
	r.check("libellé de carte (attribut) : marqueurs retirés, pas d'astérisque",
		/aria-label="[^"]*\*\*/.test(html({ prompt: "", retenir: { forme: "cartes", items: [{ recto: md, verso: md }] } })), false);
	r.check("récapitulatif : markdown rendu", html({ prompt: "", retenir: { forme: "recap", items: [md] } }).includes(attendu), true);
	r.check("aucun marqueur brut ne reste", /\*\*gras\*\*|`code`/.test(html({ lecture: "tableau", prompt: md, tableau: { colonnes: [md], lignes: [[md]] }, retenir: { forme: "recap", items: [md] } })), false);
	r.done();
});
