/**
 * « On ne doit JAMAIS voir de caractères non rendus » — vérifié sur de VRAIS
 * quiz, pas sur des cas inventés.
 *
 *     node scripts/check-render-markers.mjs "C:/obsidian-vaults/Personal" "C:/obsidian-vaults/Efrei"
 *
 * Chaque champ TEXTE que l'apprenant lit (énoncé, options, items de classement,
 * lignes d'appariement, gabarit de trous, indice, explication, leçon, support)
 * passe par la vraie fonction de rendu du moteur (engine/sanitizer.ts
 * renderInlineText — importée, jamais répliquée). On retire ensuite du HTML
 * produit ce qui est LITTÉRAL par nature (contenu de <code>, formules LaTeX),
 * puis on cherche ce qui reste de markdown non traduit.
 *
 * Un champ porteur d'une variante `*Html` n'est PAS compté : le moteur affiche
 * alors le HTML pré-rendu et ignore le texte (engine/cards.ts).
 *
 * CE QUE CE SCRIPT NE VOIT PAS — et comment le voir. Il éprouve la GRAMMAIRE,
 * pas le CÂBLAGE : un champ que le moteur affiche sans appeler le rendu du
 * tout passe ici pour sain. C'est exactement ce qui était arrivé au libellé
 * d'emplacement d'un classement (`quiz-slot-label`, interpolé brut). Le seul
 * filet contre ça est de lire le DOM RENDU, dans Obsidian :
 *
 *     obsidian eval vault=<nom> code="(()=>{ \
 *       const host=leaf.view.containerEl.querySelector('.quiz-blocks-host'); \
 *       const re=new RegExp('[*][^\n]*[*]'); \
 *       return [...host.querySelectorAll('.quiz-track-item')].map(it=>{ \
 *         const c=it.cloneNode(true); \
 *         c.querySelectorAll('code,pre,mjx-container,.MathJax').forEach(n=>n.remove()); \
 *         return c.innerText; }).filter(t=>re.test(t)); })()"
 *
 * sur une note qui charge chaque type de question de markdown. Les deux
 * vérifications sont complémentaires : celle-ci sur 8546 champs réels, celle-là
 * sur tous les chemins d'affichage.
 *
 * Aucun fichier n'est modifié.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import JSON5 from "json5";
import { withSrcModule } from "./lib/load-src.mjs";

const racines = process.argv.slice(2);
if (racines.length === 0) {
	console.error("Usage : node scripts/check-render-markers.mjs <chemin-de-vault> […]");
	process.exit(2);
}

function walk(dir, out) {
	let entries;
	try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
	for (const e of entries) {
		// `_to_delete` est le bac à sable : on y écrit exprès des quiz tordus
		// (étoiles littérales, pièges de rendu) qui n'ont pas à peser sur un
		// audit censé parler des VRAIS quiz d'Ahmed.
		if (e.name.startsWith(".") || e.name === "_to_delete") continue;
		const p = join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else if (e.name.endsWith(".md")) out.push(p);
	}
	return out;
}

/* What, in the rendered HTML, is literal by CONTRACT and so has nothing to
   translate: the content of a <code> (``a ` b`` keeps its backtick) and a
   LaTeX formula (MathJax reads the source as it is, `*` included).
   `<code` WITH attributes: since the colouring (2026-09-26), inline code is
   `<code class="quiz-md-code-inline language-x">` and a block's code
   `<code class="language-x">` — matching only a bare `<code>` let every
   coloured snippet's backticks and stars count as unrendered markdown. */
function retirerLitteraux(html) {
	return html
		.replace(/<code\b[^>]*>[\s\S]*?<\/code>/g, "")
		.replace(/\$\$[\s\S]*?\$\$/g, "")
		.replace(/\$[^$\n]+\$/g, "");
}

/* Les motifs cherchés dans ce qu'il RESTE. Chacun est un markdown qu'un
   modèle produit spontanément et que l'apprenant ne doit pas lire tel quel.

   Un délimiteur SURVIVANT n'est pas forcément un rendu manqué — le plus
   souvent c'est une étoile littérale, et la laisser est le comportement
   JUSTE : `arp -d *`, `GRANT … ON glpi.*`, `3*4*5`, `C:\Users\*\AppData`
   (les 6 seules occurrences des deux vaults sont de cette nature).

   Ce qui trahit vraiment un champ passé À CÔTÉ du rendu, c'est un
   délimiteur qui aurait PU ouvrir une emphase — même règle de flanc que le
   moteur : ni lettre, ni chiffre, ni antislash devant, du non-espace
   derrière — suivi d'un autre délimiteur sur la même ligne. Le rendu, lui,
   n'en laisse jamais passer un pareil. */
function ouvrante(delim) {
	const d = delim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	/* Les DEUX flancs, comme le moteur : contenu collé au délimiteur ouvrant
	   (`(?=\S)`) ET au fermant (`\S` juste avant). Sans le flanc droit,
	   « Motifs *foo * » — que le rendu laisse intact, à raison — était signalé
	   (revue codex 2026-07-31). */
	return new RegExp("(?:^|[^\\p{L}\\p{N}\\\\" + d + "])" + d + "(?=\\S)[^\\n]*?\\S" + d, "u");
}

const MOTIFS = [
	["gras/italique", ouvrante("*")],
	["code inline", ouvrante("`")],
	["barré", ouvrante("~~")],
	["titre", /(^|<br>)\s*#{1,6}\s+\S/],
	/* L'emphase à UNDERSCORE n'est volontairement pas rendue par le moteur :
	   dans un quiz technique, `snake_case`, `TTL_{reçu}` et `file_name` sont
	   partout, et la règle de CommonMark qui les épargne demande une contrainte
	   de flanc droit que le reste de la grammaire n'a pas. Mesuré avant de
	   trancher : ZÉRO paire d'underscores dans les 8568 champs des deux vaults.
	   Le motif reste ici pour que la décision se rouvre d'elle-même le jour où
	   un quiz en contiendra vraiment. */
	["emphase soulignée", /(^|[^\p{L}\p{N}\\_])__?(?=\S)[^\n]*?\S__?(?![\p{L}\p{N}])/u],
	["lien", /\[[^\]\n]+\]\([^)\n]+\)/],
];

const fichiers = racines.flatMap(r => walk(r, []));
console.log(fichiers.length + " notes examinées dans " + racines.length + " vault(s)");

/* `QUIZ_BLOCK_RE` du plugin, jamais une copie : une regex recopiée serait plus
   stricte que l'originale et sauterait en silence des blocs que le plugin, lui,
   charge — l'audit resterait vert sans les avoir vus. */
await withSrcModule(["src/engine/sanitizer.ts", "src/quiz-utils.ts"], (sanitizer, { QUIZ_BLOCK_RE }) => {
	/* Each field through the SAME function the engine renders it with. The
	   fields below go through `renderTextWithEmbeds` in the engine (cards.ts,
	   passage.ts, hint.ts, cloze.ts), i.e. the full grammar with fenced
	   blocks (`rendreTexteQuiz`); every other field through
	   `renderInlineText`. Rendering them all inline (as before 2026-09-29)
	   flagged every fenced ```python block of a prompt as unrendered, while
	   the learner sees it rendered; rendering them all with blocks would hide
	   a fence in an ordering item, which the learner DOES see raw. Images are
	   stubbed: only the markdown left over matters here. */
	const PLEIN = new Set(["prompt", "passage", "explain", "hint", "learn", "cloze", "options"]);
	const IMAGES = { embed: () => "", image: () => "" };
	const rendre = (nom, valeur) => PLEIN.has(nom.replace(/\[\d+\]$/, ""))
		? sanitizer.rendreTexteQuiz(valeur, IMAGES, false)
		: sanitizer.renderInlineText(valeur);
	let quiz = 0, champs = 0;
	const parMotif = new Map();
	const exemples = [];

	/** Un champ texte affiché : le rendre, et signaler ce qui n'a pas été traduit. */
	const verifier = (fichier, qi, nom, valeur) => {
		if (typeof valeur !== "string" || !valeur.trim()) return;
		champs++;
		const reste = retirerLitteraux(rendre(nom, valeur));
		for (const [libelle, motif] of MOTIFS) {
			if (!motif.test(reste)) continue;
			parMotif.set(libelle, (parMotif.get(libelle) || 0) + 1);
			if (exemples.length < 40) {
				exemples.push({ fichier, qi, nom, libelle, extrait: valeur.replace(/\s+/g, " ").slice(0, 140) });
			}
		}
	};

	/** Les champs TEXTE d'une question, dans l'ordre où l'apprenant les lit.
	    `sautSi` porte le nom du champ HTML qui prendrait le dessus. */
	const CHAMPS = [
		["title", null], ["prompt", "promptHtml"], ["passage", "passageHtml"],
		["passageTitle", null], ["hint", null], ["explain", "explainHtml"],
		["learn", "learnHtml"], ["cloze", null], ["answer", null], ["placeholder", null],
		// Préfixes de terminal : eux aussi s'affichent, eux aussi ont laissé
		// passer du markdown (revue codex 2026-07-31).
		["commandPrefix", null], ["terminalPrefix", null], ["promptPrefix", null],
	];
	const LISTES = [
		["options", "optionHtml"], ["possibilities", null], ["orderingItems", null],
		["slots", null], ["slotLabels", null], ["rows", null], ["choices", null],
		["acceptedAnswers", null], ["acceptableAnswers", null], ["correctAnswers", null],
	];

	for (const f of fichiers) {
		const m = readFileSync(f, "utf8").match(QUIZ_BLOCK_RE);
		if (!m) continue;
		let parsed;
		try { parsed = JSON5.parse(m[1]); } catch { continue; }
		if (!Array.isArray(parsed)) continue;
		quiz++;

		parsed.forEach((q, qi) => {
			if (!q || typeof q !== "object" || Array.isArray(q)) return;
			for (const [nom, htmlPrioritaire] of CHAMPS) {
				if (htmlPrioritaire && (q[htmlPrioritaire] || q["_" + htmlPrioritaire])) continue;
				verifier(f, qi, nom, q[nom]);
			}
			// Libellé du bouton de ressource : imbriqué, et rendu par le moteur
			// (sanitizer.ts resourceButtonHtml).
			const rb = q.resourceButton;
			if (rb && typeof rb === "object") verifier(f, qi, "resourceButton.label", rb.label);
			for (const [nom, htmlPrioritaire] of LISTES) {
				const liste = q[nom];
				if (!Array.isArray(liste)) continue;
				const html = Array.isArray(q[htmlPrioritaire]) ? q[htmlPrioritaire] : null;
				liste.forEach((v, i) => {
					if (html && html[i]) return;
					verifier(f, qi, nom + "[" + i + "]", v);
				});
			}
		});
	}

	console.log("quiz : " + quiz + " | champs texte rendus : " + champs);
	if (parMotif.size === 0) {
		console.log("\nAucun marqueur markdown non rendu. OK");
		return;
	}
	console.log("\nMARQUEURS NON RENDUS :");
	for (const [libelle, n] of [...parMotif].sort((a, b) => b[1] - a[1])) {
		console.log("  " + String(n).padStart(4) + "  " + libelle);
	}
	console.log("\nExemples :");
	for (const e of exemples) {
		console.log("  [" + e.libelle + "] " + e.fichier.split(/[\\/]/).pop() + " q" + e.qi + "." + e.nom);
		console.log("      " + e.extrait);
	}
	// `exitCode` et non `exit()` : la pile doit se dérouler pour que
	// `withSrcModule` retire son dossier temporaire.
	process.exitCode = 1;
});
