/**
 * LE GLOSSAIRE D'UN QUIZ (`src/glossaire.ts`), noyau pur.
 * Ce qu'il empêche : un terme apparié dans un mot plus long qui le contient,
 * apparié malgré un accent différent, apparié dans une formule LaTeX, une
 * entrée retrouvée deux fois dans la même zone, deux entrées qui se
 * chevauchent sans que la plus spécifique l'emporte. Vérifie aussi la
 * reconnaissance d'un objet de configuration qui ne porte qu'un glossaire
 * (`src/quiz-utils.ts`).
 *
 * PARTIE DEUX (plus bas) : la passe DOM (`poserTermesDans`,
 * `src/engine/termes.ts`), sur `linkedom` — ce que le noyau pur ne peut pas
 * prouver : qu'un énoncé/une option n'est jamais entré (liste blanche de
 * zones), qu'un lien/du code/une formule non encore rendue sont épargnés à
 * l'intérieur d'une zone, qu'un second appel ne change plus rien
 * (idempotence), et qu'une définition hostile ne crée aucun élément vivant.
 *     npm run check:termes
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(
	["src/glossaire.ts", "src/quiz-utils.ts"],
	({ lireGlossaire, indexerGlossaire, trouverTermes }, { findQuizModeConfigIndex, extractExamOptions }) => {
		const r = makeReporter("Glossaire d'un quiz — format et appariement des termes");

		// --- lireGlossaire : entrées invalides ignorées ---
		{
			const brut = [
				{ term: "pile", definition: "Structure LIFO." },
				{ term: "   ", definition: "Sans terme." },
				{ term: "vide", definition: "   " },
				{ term: 42, definition: "Terme non textuel." },
				{ definition: "Sans terme du tout." },
				"parasite",
				null,
				{ term: "pile d'appel", definition: "Empilement des appels.", aliases: ["call stack", "  ", 7] },
			];
			const lu = lireGlossaire(brut);
			r.check("entrées invalides ignorées, valides gardées dans l'ordre", lu.map(e => e.term), ["pile", "pile d'appel"]);
			r.check("aliases filtrés aux chaînes non vides, triés à l'identique", lu[1].aliases, ["call stack"]);
			r.check("aliases absent quand aucun n'est valide", "aliases" in lu[0], false);
		}
		r.check("glossaire non tableau → []", lireGlossaire("pas un tableau"), []);
		r.check("glossaire absent (undefined) → []", lireGlossaire(undefined), []);

		// --- indexerGlossaire + trouverTermes ---
		const entrees = lireGlossaire([
			{ term: "pile", definition: "Structure où le dernier ajouté sort en premier." },
			{ term: "pile d'appel", definition: "Empilement des appels de fonction." },
			{ term: "index", definition: "Position dans une séquence.", aliases: ["indice"] },
		]);
		const index = indexerGlossaire(entrees);

		r.check("casse insensible", trouverTermes("Une PILE est une structure.", index, new Set()).map(o => o.entree), [0]);
		r.check("accents exacts : « pilé » n'apparie pas « pile »", trouverTermes("Un pilé au chocolat.", index, new Set()), []);
		r.check("mot entier : « empiler » n'apparie pas « pile »", trouverTermes("On peut empiler des objets.", index, new Set()), []);
		r.check("pluriel « piles »", trouverTermes("Les piles.", index, new Set()).map(o => o.entree), [0]);
		r.check("pluriel « indexes »", trouverTermes("Les indexes.", index, new Set()).map(o => o.entree), [2]);
		r.check("le plus long l'emporte : « pile d'appel » gagne sur « pile »",
			trouverTermes("La pile d'appel grandit.", index, new Set()).map(o => o.entree), [1]);
		r.check("une seule occurrence par entrée dans un même texte",
			trouverTermes("La pile grandit, la pile déborde.", index, new Set()).length, 1);
		r.check("jamais apparié dans une formule", trouverTermes("La formule $pile$ n'est pas un terme.", index, new Set()), []);

		{
			const dejaVus = new Set();
			const t1 = trouverTermes("La pile est vide.", index, dejaVus);
			const t2 = trouverTermes("La pile déborde encore.", index, dejaVus);
			r.check("dejaVus partagé entre deux appels : la 2e occurrence n'est pas reprise", [t1.length, t2.length], [1, 0]);
		}

		// --- revue du 2026-09-27 : apostrophes et termes courts ---
		r.check("apostrophe typographique dans le texte, droite dans le glossaire",
			trouverTermes("La pile d’appel grandit.", index, new Set()).map(o => o.entree), [1]);
		{
			const typo = indexerGlossaire(lireGlossaire([{ term: "loi d’Ohm", definition: "U = RI." }]));
			r.check("apostrophe typographique dans le glossaire, droite dans le texte",
				trouverTermes("La loi d'Ohm relie U et I.", typo, new Set()).length, 1);
		}
		{
			const court = indexerGlossaire(lireGlossaire([{ term: "s", definition: "La seconde." }, { term: "ms", definition: "Milliseconde." }]));
			r.check("un terme d'une lettre n'apparie pas « ses » (pas de pluriel sous trois caractères)",
				trouverTermes("On regarde ses résultats.", court, new Set()), []);
			r.check("… ni un terme de deux lettres « mss »", trouverTermes("Les mss anciens.", court, new Set()), []);
			r.check("… mais le symbole seul est apparié", trouverTermes("En 3 s exactement.", court, new Set()).map(o => o.entree), [0]);
		}

		// --- reconnaissance de la configuration (quiz-utils.ts) ---
		const question = { prompt: "2 + 2 ?", options: ["3", "4"], correctIndex: 1 };
		r.check("un objet sans énoncé porteur d'un glossaire est la configuration",
			findQuizModeConfigIndex([question, { glossary: [{ term: "a", definition: "b" }] }]), 1);
		r.check("un glossaire VIDE sur un objet sans énoncé est encore reconnu",
			findQuizModeConfigIndex([question, { glossary: [] }]), 1);
		r.check("une question qui porte un glossaire reste une question",
			findQuizModeConfigIndex([{ prompt: "x", glossary: [] }]), -1);
		r.check("une question SANS énoncé mais à marqueurs (options) qui porte un glossaire reste une question",
			findQuizModeConfigIndex([{ options: ["a", "b"], correctIndex: 0, glossary: [{ term: "a", definition: "b" }] }]), -1);

		// --- extractExamOptions rend le glossaire lu ---
		{
			const out = extractExamOptions([question, { mode: "quiz", glossary: [{ term: "pile", definition: "def" }] }]);
			r.check("extractExamOptions rend le glossaire lu", out.glossary, [{ term: "pile", definition: "def" }]);
		}
		r.check("sans configuration, glossaire vide", extractExamOptions([question]).glossary, []);
		r.check("tableau vide, glossaire vide", extractExamOptions([]).glossary, []);

		r.done();
	},
);

/* ══════════════════════════════════════════════════════════
   PARTIE DEUX — la passe DOM, sur `linkedom` (hors navigateur).

   `linkedom` implémente `whatToShow` d'un `TreeWalker` mais IGNORE en
   silence son callback `acceptNode` : `poserTermesDans` (src/engine/
   termes.ts) ne s'appuie donc pas dessus pour exclure `<code>`/`<a>`/
   `.qb-terme`, mais sur un `closest()` posé APRÈS coup — cette différence
   est documentée en tête de `noeudsTexteDeLaZone`. Un filtre qui aurait
   dépendu du callback laisserait passer TOUS les nœuds texte ici, y compris
   ceux d'un `<code>` : ce script serait vert sur un moteur qui ne l'est pas.
   ═════════════════════════════════════════════════════════ */

/** Même patron que `scripts/check-code-highlight.mjs` `installerDom()`. */
async function installerDom() {
	const { parseHTML, NodeFilter } = await import("linkedom");
	const { document, window, Node } = parseHTML("<html><body></body></html>");
	globalThis.document = document;
	globalThis.Node = Node;
	globalThis.NodeFilter = NodeFilter;
	globalThis.window = globalThis.window || window;
}

async function verifierPasseDom() {
	await installerDom();
	await withSrcModule(
		["src/glossaire.ts", "src/engine/termes.ts", "src/engine/sanitizer.ts"],
		({ lireGlossaire, indexerGlossaire }, { poserTermesDans }, { renderInlineText }) => {
			const r = makeReporter("Glossaire d'un quiz — passe DOM (poserTermesDans)");

			const index = indexerGlossaire(lireGlossaire([{ term: "pile", definition: "Structure LIFO." }]));

			// --- fragment réaliste : énoncé, option, explication (spec Task 2) ---
			// DEUX « pile » hors code/lien/formule dans l'explication, dans le
			// MÊME nœud texte que la formule $pile$ (le cas le plus dur pour
			// l'exclusion — trouverTermes doit la voir sans couper le match qui
			// la suit) : la première est enveloppée, la SECONDE reste en texte
			// (une seule occurrence par entrée) — c'est elle qui distingue une
			// idempotence correcte (§ »second appel« plus bas) d'une qui ne
			// ressème pas `dejaVus` depuis le DOM déjà posé.
			const racine = document.createElement("div");
			racine.innerHTML =
				'<div class="quiz-question">Qu’est-ce qu’une pile ?</div>' +
				'<div class="quiz-option">Une pile</div>' +
				'<div class="quiz-explain">Une <code>pile</code> et <a href="x">pile</a> et $pile$ et enfin pile, la vraie, et pile encore.</div>';
			document.body.appendChild(racine);

			poserTermesDans(racine, index);

			const question = racine.querySelector(".quiz-question");
			const option = racine.querySelector(".quiz-option");
			const explain = racine.querySelector(".quiz-explain");
			const termesExplain = explain.querySelectorAll(".qb-terme");

			r.check("l'énoncé n'est jamais entré (hors liste blanche de zones)", question.querySelectorAll(".qb-terme").length, 0);
			r.check("une option n'est jamais entrée (hors liste blanche de zones)", option.querySelectorAll(".qb-terme").length, 0);
			r.check("l'explication : une seule occurrence enveloppée (une par entrée, malgré 2 candidates)", termesExplain.length, 1);
			r.check("le texte enveloppé est exactement le terme trouvé", termesExplain[0]?.textContent, "pile");
			r.check("l'occurrence dans <code> n'est pas enveloppée", explain.querySelector("code .qb-terme"), null);
			r.check("l'occurrence dans <a> n'est pas enveloppée", explain.querySelector("a .qb-terme"), null);
			r.check("la formule $pile$ n'est pas coupée", explain.textContent.includes("$pile$"), true);
			// L'attribut, pas la propriété IDL `tabIndex` : `linkedom` pose bien
			// l'attribut mais ne reflète pas son getter (toujours -1) — la seule
			// chose qui compte pour un vrai navigateur est l'attribut écrit.
			r.check("le span porte tabindex=0 et data-terme (index d'entrée)",
				[termesExplain[0]?.getAttribute("tabindex"), termesExplain[0]?.dataset.terme], ["0", "0"]);

			const avant = racine.innerHTML;
			poserTermesDans(racine, index);
			r.check("un second appel laisse le DOM identique (idempotent)", racine.innerHTML, avant);

			// --- l'écran d'une lecture : une zone, titre exclu, carte exclue ---
			{
				const lect = document.createElement("div");
				lect.innerHTML = '<div class="quiz-question"><div class="quiz-lecture quiz-lecture--etapes">' +
					'<h3 class="quiz-lecture-titre">La pile</h3>' +
					'<ol class="quiz-lecture-etapes"><li><div class="quiz-lecture-etape-texte">On empile sur la pile.</div></li>' +
					'<li><div class="quiz-lecture-etape-texte">La pile se vide.</div></li></ol>' +
					'<button class="quiz-lecture-carte">pile</button></div></div>';
				poserTermesDans(lect, index);
				const termes = lect.querySelectorAll(".qb-terme");
				r.check("lecture : un seul soulignement pour toute la lecture, dans la première étape",
					[termes.length, termes[0]?.closest("li") === lect.querySelector("li")], [1, true]);
				r.check("lecture : jamais dans son titre ni dans une carte à retourner",
					[lect.querySelector("h3 .qb-terme"), lect.querySelector("button .qb-terme")], [null, null]);
			}
			{
				// Une zone DANS une autre : la zone extérieure seule compte.
				const imb = document.createElement("div");
				imb.innerHTML = '<div class="quiz-passage-content">Une pile. <div class="quiz-lecture">Encore une pile.</div></div>';
				poserTermesDans(imb, index);
				r.check("zones imbriquées : un seul soulignement", imb.querySelectorAll(".qb-terme").length, 1);
			}

			// --- une zone SANS glossaire (index vide) : sortie immédiate ---
			const videIndex = indexerGlossaire([]);
			const racineVide = document.createElement("div");
			racineVide.innerHTML = '<div class="quiz-explain">Une pile.</div>';
			poserTermesDans(racineVide, videIndex);
			r.check("sans glossaire, rien n'est enveloppé", racineVide.querySelectorAll(".qb-terme").length, 0);

			// --- une définition hostile (bulle, engine/termes-bulle.ts) passe par
			// LA MÊME porte n°1 que tout texte d'un quiz : renderInlineText échappe
			// avant de rendre le markdown, donc n'exécute ni ne construit jamais de
			// balise venue de la donnée. ---
			const boite = document.createElement("div");
			boite.innerHTML = renderInlineText('<img src=x onerror="window.__quizTermeHostile = true">');
			r.check("une définition <img onerror> ne crée AUCUN élément dans la zone", boite.querySelectorAll("*").length, 0);
			// Échappé (« &lt;img … »), jamais une vraie balise (« <img ») : c'est
			// l'échappement, pas l'absence du mot « onerror », qui protège —
			// « onerror= » reste légitimement dans le texte AFFICHÉ tel quel.
			r.check("… le chevron ouvrant est échappé (aucune vraie balise <img)", boite.innerHTML.includes("<img"), false);
			r.check("… et retrouve « &lt;img » en clair (texte, pas balise)", boite.innerHTML.includes("&lt;img"), true);

			r.done();
		},
	);
}

await verifierPasseDom();
