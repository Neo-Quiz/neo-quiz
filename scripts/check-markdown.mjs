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

	const compter = (html, balise) => (html.match(new RegExp("<" + balise + ">", "g")) || []).length;
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
await withSrcModule(["src/engine/sanitizer.ts", "src/engine/grammaire-blocs.ts"], ({ rendreTexteQuiz, renderInlineText, createSanitizer }, { decouperBlocs, aDesBlocs }) => {
	const r = makeReporter("Blocs, images et liens");
	const IMG = { embed: s => `[embed:${s}]`, image: (a, s) => `[image:${a}|${s}]` };
	const rendre = (t) => rendreTexteQuiz(t, IMG);
	const NL = "\n";
	const P = (x) => `<p class="quiz-md-p">${x}</p>`;

	r.check("paragraphes", rendre("un" + NL + NL + "deux"), P("un") + P("deux"));
	r.check("liste à puces", rendre("Choisis :" + NL + "- `a`" + NL + "- **b**"),
		P("Choisis :") + `<ul class="quiz-md-liste"><li><code>a</code></li><li><strong>b</strong></li></ul>`);
	r.check("liste numérotée qui commence à 3", rendre("x" + NL + "3. a" + NL + "4. b"),
		P("x") + `<ol class="quiz-md-liste" start="3"><li>a</li><li>b</li></ol>`);
	r.check("sous-liste par l'indentation", rendre("- a" + NL + "  - b" + NL + "- c"),
		`<ul class="quiz-md-liste"><li>a<ul class="quiz-md-liste"><li>b</li></ul></li><li>c</li></ul>`);
	r.check("bloc de code : littéral et échappé",
		rendre("```python" + NL + "print(\"<script>\")" + NL + "**x** $y$" + NL + "```"),
		`<pre class="quiz-md-code"><code class="language-python">print(&quot;&lt;script&gt;&quot;)${NL}**x** $y$</code></pre>`);
	r.check("bloc de code jamais refermé : jusqu'à la fin", rendre("a" + NL + "```" + NL + "x"),
		P("a") + `<pre class="quiz-md-code"><code>x</code></pre>`);
	r.check("tableau : en-tête, alignements, `|` dans un code",
		rendre("| A | B |" + NL + "|:-:|--:|" + NL + "| `a|b` | <script> |"),
		`<table class="quiz-md-table"><thead><tr><th style="text-align: center">A</th><th style="text-align: right">B</th></tr></thead>`
		+ `<tbody><tr><td style="text-align: center"><code>a|b</code></td><td style="text-align: right">&lt;script&gt;</td></tr></tbody></table>`);
	r.check("tableau : un `|` dans une formule ne coupe pas la cellule (I3)",
		rendre("| a | b |" + NL + "|---|---|" + NL + "| $|x|$ | 2 |"),
		`<table class="quiz-md-table"><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>$|x|$</td><td>2</td></tr></tbody></table>`);
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
await withSrcModule("src/engine/cloze.ts", ({ markSlots, fillSlots }) => {
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

	r.done();
});
