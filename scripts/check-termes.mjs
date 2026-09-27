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

		// --- défaut #5 (revue du 2026-09-27) : backticks autour d'un terme de code ---
		{
			const lu = lireGlossaire([{ term: "`yield`", definition: "Suspend une génératrice.", aliases: ["`return`", "normal"] }]);
			r.check("un term entouré de backticks perd ses backticks", lu[0].term, "yield");
			r.check("un alias entouré de backticks aussi, les autres intacts", lu[0].aliases, ["return", "normal"]);
		}

		// --- défaut #12 : les clés INCONNUES d'une entrée valide sont gardées ---
		{
			const lu = lireGlossaire([{ term: "pile", definition: "LIFO", example: "un annuaire téléphonique", category: "structures" }]);
			r.check("les clés inconnues survivent dans `_extra`", lu[0]._extra, { example: "un annuaire téléphonique", category: "structures" });
			const sansExtra = lireGlossaire([{ term: "pile", definition: "LIFO" }]);
			r.check("aucune clé inconnue : `_extra` absent", "_extra" in sansExtra[0], false);
		}

		// --- défaut #10 (revue du 2026-09-27) : pluriels irréguliers, espaces, courtes formes, marques combinantes ---
		{
			const aux = indexerGlossaire(lireGlossaire([{ term: "signal", definition: "Une information transmise." }]));
			r.check("pluriel en « aux » (signal → signaux)", trouverTermes("Les signaux sont nombreux.", aux, new Set()).map(o => o.entree), [0]);
			r.check("le pluriel régulier reste toléré à côté", trouverTermes("Deux signals reçus.", aux, new Set()).map(o => o.entree), [0]);
			// DISCRIMINANCE : sans l'alternative « aux », rien ne serait trouvé —
			// « signaux » ne partage AUCUN suffixe régulier avec « signal ».
			r.check("« signal » seul (sans pluriel) n'apparie pas « signaux » ailleurs dans le mot",
				trouverTermes("Rien à voir ici.", aux, new Set()), []);
		}
		{
			const ies = indexerGlossaire(lireGlossaire([{ term: "query", definition: "Une requête." }]));
			r.check("pluriel anglais en « ies » (query → queries, consonne + y)",
				trouverTermes("Ces queries sont lentes.", ies, new Set()).map(o => o.entree), [0]);
			// « day » (voyelle + y) reste RÉGULIER : pas de « daies ».
			const day = indexerGlossaire(lireGlossaire([{ term: "day", definition: "Un jour (anglais)." }]));
			r.check("voyelle + y : pluriel régulier seulement (day → days, jamais « daies »)",
				trouverTermes("Two days later.", day, new Set()).map(o => o.entree), [0]);
			r.check("… et « daies » n'est pas apparié par « day »", trouverTermes("Des daies bizarres.", day, new Set()), []);
		}
		{
			// Espace ~ toute suite d'espaces, espace insécable ou saut de ligne.
			const multi = indexerGlossaire(lireGlossaire([{ term: "pile d'appel", definition: "Empilement des appels." }]));
			const NBSP = String.fromCharCode(0xa0);
			const LF = String.fromCharCode(10);
			r.check("espace insécable entre les mots d'un terme",
				trouverTermes(`La pile${NBSP}d'appel grandit.`, multi, new Set()).length, 1);
			r.check("saut de ligne entre les mots d'un terme",
				trouverTermes(`La pile${LF}d'appel grandit.`, multi, new Set()).length, 1);
			r.check("plusieurs espaces d'affilée",
				trouverTermes("La pile   d'appel grandit.", multi, new Set()).length, 1);
		}
		{
			// Forme de 1-2 caractères jamais appariée suivie d'une apostrophe + lettre.
			const c = indexerGlossaire(lireGlossaire([{ term: "C", definition: "Le langage C." }]));
			r.check("« C » n'apparie pas le début de « C'est » (élision)",
				trouverTermes("C'est un exemple.", c, new Set()), []);
			r.check("… mais « C » seul, sans apostrophe, reste apparié",
				trouverTermes("Le langage C est ancien.", c, new Set()).map(o => o.entree), [0]);
			const n = indexerGlossaire(lireGlossaire([{ term: "N", definition: "Une force, en newtons." }]));
			r.check("« N » n'apparie pas le début de « n'est »",
				trouverTermes("Ce n'est pas une force.", n, new Set()), []);
		}
		{
			// Marques combinantes (texte NFD) : un terme ordinaire ne mord pas sur
			// le début d'un mot accentué décomposé.
			const cafe = indexerGlossaire(lireGlossaire([{ term: "cafe", definition: "Sans accent, un faux ami." }]));
			const NFD_CAFE = "caf" + "e" + String.fromCharCode(0x0301); // « café » décomposé (e + accent combinant)
			r.check("un terme « cafe » n'apparie pas le début d'un « café » NFD (accent combinant exclu de la frontière)",
				trouverTermes("Un " + NFD_CAFE + " chaud.", cafe, new Set()), []);
			r.check("… mais apparie bien un « cafe » NFC ordinaire",
				trouverTermes("Un cafe chaud.", cafe, new Set()).map(o => o.entree), [0]);
		}

		// --- défaut #11 : le préfiltre ne doit JAMAIS produire de faux négatif ---
		{
			// Le cas le PLUS discriminant pour la MARGE de troncature (pas
			// seulement l'existence de l'alternative « aux ») : un mot COURT en
			// « al » (3 caractères, sous la limite de 4 de `LONGUEUR_INDICE`) —
			// sans marge, l'indice serait « mal », absent de « maux ». Une marge
			// FIXE trop courte (ex. 1 au lieu de 2) échouerait pareillement.
			const court = indexerGlossaire(lireGlossaire([{ term: "mal", definition: "Une douleur." }]));
			r.check("préfiltre : « maux » (mot COURT en -al, la marge doit dépasser la limite de l'indice)",
				trouverTermes("Des maux de tête.", court, new Set()).map(o => o.entree), [0]);

			// Cas les plus piégeux : pluriel irrégulier (marge de troncature) et
			// apostrophe/espace juste après le début de la forme.
			const pieges = indexerGlossaire(lireGlossaire([
				{ term: "cheval", definition: "Un équidé." }, // cheval -> chevaux
				{ term: "party", definition: "Une fête (anglais)." }, // party -> parties
				{ term: "s", definition: "La seconde." }, // 1 caractère
				{ term: "pile d'appel", definition: "Empilement des appels." },
			]));
			r.check("préfiltre : « chevaux » toujours trouvé (troncature de l'indice)",
				trouverTermes("Des chevaux au galop.", pieges, new Set()).map(o => o.entree).includes(0), true);
			r.check("préfiltre : « parties » toujours trouvé",
				trouverTermes("Trois parties jouées.", pieges, new Set()).map(o => o.entree).includes(1), true);
			r.check("préfiltre : symbole d'un caractère toujours trouvé",
				trouverTermes("En 2 s.", pieges, new Set()).map(o => o.entree).includes(2), true);
			r.check("préfiltre : terme à espace insécable toujours trouvé",
				trouverTermes(`La pile${String.fromCharCode(0xa0)}d'appel.`, pieges, new Set()).map(o => o.entree).includes(3), true);
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
			// `<code>empiler pile</code>` (pas une forme EXACTE : le défaut #5
			// n'enveloppe qu'un `<code>` dont le texte trim est EXACTEMENT une
			// forme — voir la partie dédiée plus bas) reste donc un `<code>`
			// ordinaire, jamais touché, ici comme avant ce défaut.
			const racine = document.createElement("div");
			racine.innerHTML =
				'<div class="quiz-question">Qu’est-ce qu’une pile ?</div>' +
				'<div class="quiz-option">Une pile</div>' +
				'<div class="quiz-explain">Une <code>empiler pile</code> et <a href="x">pile</a> et $pile$ et enfin pile, la vraie, et pile encore.</div>';
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

			// --- défaut #5 : un <code> INLINE dont le texte est EXACTEMENT une
			// forme est enveloppé ENTIER dans span.qb-terme, le <code> intact
			// dedans — la génération met chaque identifiant entre backticks,
			// donc dans un <code>, jamais soulignable sans cette passe dédiée. ---
			{
				const idx = indexerGlossaire(lireGlossaire([
					{ term: "yield", definition: "Suspend une génératrice." },
					{ term: "async", definition: "Une fonction asynchrone.", aliases: ["asynchrone"] },
				]));
				const zone = document.createElement("div");
				zone.className = "quiz-explain";
				zone.innerHTML = 'Le mot-clé <code>yield</code> suspend la fonction. ' +
					'<pre><code>yield</code></pre>' + // bloc : jamais touché
					'<a href="x"><code>yield</code></a>'; // lien : jamais touché
				document.body.appendChild(zone);
				poserTermesDans(zone, idx);

				const termeCode = zone.querySelector(".qb-terme > code");
				r.check("le <code> inline exact est enveloppé, code intact dedans",
					[termeCode?.textContent, termeCode?.parentElement?.className, termeCode?.parentElement?.dataset.terme],
					["yield", "qb-terme", "0"]);
				r.check("une seule occurrence : le <code> du <pre> n'est PAS enveloppé (bloc, pas inline)",
					zone.querySelector("pre code")?.parentElement?.className !== "qb-terme", true);
				r.check("le <code> dans un lien n'est pas enveloppé",
					zone.querySelector("a code")?.parentElement?.className !== "qb-terme", true);

				const avantCode = zone.innerHTML;
				poserTermesDans(zone, idx);
				r.check("idempotent : un second appel ne ré-enveloppe pas le <code>", zone.innerHTML, avantCode);

				// Une entrée trouvée EN TEXTE avant son <code> (même zone) : le
				// <code> ne double pas l'occurrence (une par entrée et par zone).
				const zone2 = document.createElement("div");
				zone2.className = "quiz-explain";
				zone2.innerHTML = 'Une fonction async fait ceci. Exemple : <code>async</code>.';
				document.body.appendChild(zone2);
				poserTermesDans(zone2, idx);
				r.check("une entrée déjà vue en texte n'est pas reprise dans un <code> plus loin",
					zone2.querySelectorAll(".qb-terme").length, 1);
				r.check("… c'est bien l'occurrence TEXTE qui a été retenue, pas le <code>",
					zone2.querySelector(".qb-terme")?.tagName?.toLowerCase(), "span");

				// `lireGlossaire` retire les backticks : « `yield` » désigne le
				// même terme que « yield ».
				const backticks = lireGlossaire([{ term: "`yield`", definition: "x" }]);
				r.check("lireGlossaire retire les backticks entourant un term", backticks[0].term, "yield");
			}

			// --- défaut #9 : exclusions BORNÉES à la zone, textes d'interface ---
			{
				// Un lien/titre/pre qui EMBARQUE tout le quiz (dans la note) ne
				// doit jamais faire sauter une zone — seuls les ancêtres INTERNES
				// à la zone comptent (`closest` non borné remonterait au-delà).
				const dehors = document.createElement("a");
				dehors.href = "x";
				const zoneBornee = document.createElement("div");
				zoneBornee.className = "quiz-explain";
				zoneBornee.textContent = "Une pile bien réelle.";
				dehors.appendChild(zoneBornee);
				document.body.appendChild(dehors);
				poserTermesDans(zoneBornee, index);
				r.check("un <a> ANCÊTRE de la zone (hors d'elle) ne l'exclut pas",
					zoneBornee.querySelectorAll(".qb-terme").length, 1);

				// Textes d'interface : jamais soulignés, même dans une zone valide.
				const zoneInterface = document.createElement("div");
				zoneInterface.className = "quiz-learn-content";
				zoneInterface.innerHTML =
					'<div class="quiz-lecture-indice">Cliquer pour retourner la pile</div>' +
					'<div class="quiz-lecture-retenir-titre">À retenir : la pile</div>' +
					'<div class="quiz-textonly-label">Verso : la pile</div>' +
					'<div>Une vraie pile, pour de bon.</div>';
				document.body.appendChild(zoneInterface);
				poserTermesDans(zoneInterface, index);
				const termesInterface = zoneInterface.querySelectorAll(".qb-terme");
				r.check("un seul soulignement, dans le contenu réel — jamais dans un texte d'interface",
					[termesInterface.length, termesInterface[0]?.closest(".quiz-lecture-indice, .quiz-lecture-retenir-titre, .quiz-textonly-label")],
					[1, null]);
			}

			// --- défaut #4 : fuite pédagogique — une carte PAS ENCORE corrigée ne
			// souligne, dans ses zones à risque, aucun terme qui apparaît dans son
			// PROPRE contenu protégé (énoncé, options…) ; une fois corrigée, si. ---
			{
				const idxPile = indexerGlossaire(lireGlossaire([{ term: "pile", definition: "Structure LIFO." }]));
				const carteHtml = (corrigee) => `<div class="quiz-track-item${corrigee ? " quiz-is-locked" : ""}" data-slide-kind="question" data-qi="0">
					<h2>Une question</h2>
					<div class="quiz-question">Qu'est-ce qu'une pile ?</div>
					<div class="quiz-option">Une pile</div>
					<div class="quiz-hint-inline-body">Pense à une pile d'assiettes.</div>
					${corrigee ? '<div class="quiz-explain">La pile est LIFO.</div>' : ""}
				</div>`;

				const nonCorrigee = document.createElement("div");
				nonCorrigee.innerHTML = carteHtml(false);
				document.body.appendChild(nonCorrigee);
				poserTermesDans(nonCorrigee, idxPile);
				r.check("carte PAS corrigée : « pile » (dans l'énoncé) n'est PAS soulignée dans l'indice",
					nonCorrigee.querySelector(".quiz-hint-inline-body")?.querySelectorAll(".qb-terme").length, 0);

				const corrigee = document.createElement("div");
				corrigee.innerHTML = carteHtml(true);
				document.body.appendChild(corrigee);
				poserTermesDans(corrigee, idxPile);
				r.check("MÊME carte, corrigée (verrou global) : « pile » EST soulignée dans l'indice",
					corrigee.querySelector(".quiz-hint-inline-body")?.querySelectorAll(".qb-terme").length, 1);
				r.check("… et l'explication (post-réponse) l'est aussi, normalement",
					corrigee.querySelector(".quiz-explain")?.querySelectorAll(".qb-terme").length, 1);

				// Carte mémoire retournée (verso) : corrigée AVANT tout verrou global.
				const flashOuverte = document.createElement("div");
				flashOuverte.innerHTML = `<div class="quiz-track-item" data-slide-kind="question" data-qi="0">
					<div class="quiz-question">Empile puis dépile.</div>
					<div class="quiz-hint-inline-body">Indice sur la pile.</div>
					<div class="quiz-flashcard-back">Réponse : la pile.</div>
				</div>`;
				document.body.appendChild(flashOuverte);
				poserTermesDans(flashOuverte, idxPile);
				r.check("carte mémoire RETOURNÉE (sans verrou global) : déjà corrigée, l'indice souligne",
					flashOuverte.querySelector(".quiz-hint-inline-body")?.querySelectorAll(".qb-terme").length, 1);

				// L'écran d'une lecture PLEINE (pas courte) loge son contenu DANS
				// `.quiz-question` (engine/cards.ts) : ce n'est PAS un énoncé qui
				// attend une réponse, donc pas du contenu à protéger — une zone à
				// risque de la MÊME carte (ici un indice) doit rester libre de
				// souligner « pile », même sans verrou. DISCRIMINANT contre une
				// implémentation qui protégerait `.quiz-question` sans regarder
				// s'il loge une lecture : l'indice resterait alors à 0.
				const lecturePleine = document.createElement("div");
				lecturePleine.innerHTML = `<div class="quiz-track-item" data-slide-kind="question" data-qi="0">
					<div class="quiz-question"><div class="quiz-lecture quiz-lecture--page"><div class="quiz-lecture-texte">La pile est une structure.</div></div></div>
					<div class="quiz-hint-inline-body">Un indice qui parle de pile.</div>
				</div>`;
				document.body.appendChild(lecturePleine);
				poserTermesDans(lecturePleine, idxPile);
				r.check("écran de lecture PLEIN (pas « courte ») : jamais compté comme énoncé protégé",
					lecturePleine.querySelector(".quiz-hint-inline-body")?.querySelectorAll(".qb-terme").length, 1);
			}

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

/* ══════════════════════════════════════════════════════════
   PARTIE TROIS — la BULLE de définition (`engine/termes-bulle.ts`), sur
   `linkedom` avec un `ctx` MINIMAL (pas le moteur complet) : une simulation
   qui reproduit la séquence RÉELLE du navigateur pour un clic/tap sur un
   élément focusable (`mousedown` → `focus`/`focusin` → `click`) a montré le
   défaut #1 de la revue du 2026-09-27 avant son correctif (scratchpad de la
   session, `sim-bulle.mjs`) — ce module la reprend et l'étend aux défauts
   #3, #6 et #7, dans le MÊME esprit : ce que `linkedom` peut prouver sans
   navigateur réel (délégation d'événements, classes, attributs), pas la
   PEINTURE (transitions CSS, position réelle à l'écran — voir le rapport).
   ═════════════════════════════════════════════════════════ */
async function verifierBulle() {
	const { parseHTML, NodeFilter } = await import("linkedom");
	const { document, window, Node, Element, Event } = parseHTML("<html><body></body></html>");
	globalThis.document = document;
	globalThis.window = window;
	globalThis.Node = Node;
	globalThis.NodeFilter = NodeFilter;
	globalThis.Element = Element;
	globalThis.Event = Event;
	globalThis.requestAnimationFrame = () => 1;
	globalThis.cancelAnimationFrame = () => {};
	window.setTimeout = setTimeout;
	window.clearTimeout = clearTimeout;
	window.innerWidth = 1000;
	window.innerHeight = 800;
	// Ancre VISIBLE par défaut (rectangle dans la fenêtre) ; les cas de
	// défilement (défaut #3) le changent ponctuellement.
	let rectAncre = { top: 400, bottom: 420, left: 100, right: 150, width: 50, height: 20 };
	Element.prototype.getBoundingClientRect = function () {
		return this.classList?.contains("qb-terme") || this.classList?.contains("qb-terme-bulle")
			? { ...rectAncre }
			: { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
	};

	await withSrcModule(["src/engine/termes-bulle.ts"], async ({ creerBulleGlossaire }) => {
		const r = makeReporter("Bulle de définition — ouverture/fermeture, défilement (revue du 2026-09-27)");

		/** Une instance de bulle sur un terme frais, isolée des autres cas. */
		function nouvelleInstance() {
			const container = document.createElement("div");
			container.innerHTML = '<div class="quiz-explain">Une <span class="qb-terme" tabindex="0" data-terme="0">pile</span>.</div>';
			document.body.appendChild(container);
			const ctx = {
				container, HINT_OVERLAY_ID: "hint-overlay-test", QUIZ_INSTANCE_ID: "1",
				glossaire: [{ term: "pile", definition: "LIFO" }],
				sanitize: { renderInlineText: (s) => s },
			};
			const b = creerBulleGlossaire(ctx);
			const span = container.querySelector(".qb-terme");
			return { b, span };
		}
		const ouverte = () => {
			const el = document.querySelector(".qb-terme-bulle");
			return !!el && !el.hidden;
		};
		/** Séquence NAVIGATEUR d'un clic/tap sur un élément focusable :
		    `pointerdown` donne le focus AVANT `click` (sim-bulle.mjs). */
		const envoyer = (cible, type, extra = {}) => {
			const e = new Event(type, { bubbles: true, cancelable: true });
			Object.assign(e, extra);
			cible.dispatchEvent(e);
		};
		const attendre = (ms) => new Promise(res => setTimeout(res, ms));

		// --- défaut #1 (BLOQUANT) : la séquence exacte demandée par la revue ---
		{
			const { b, span } = nouvelleInstance();
			envoyer(span, "pointerdown");
			envoyer(span, "focusin");
			r.check("focusin provoqué par un pointerdown : n'ouvre PAS (seul le click décide)", ouverte(), false);
			envoyer(span, "click");
			r.check("pointerdown + focusin + click : la bulle S'OUVRE", ouverte(), true);
			envoyer(span, "click");
			r.check("second clic sur une bulle ouverte PAR UN CLIC : elle se FERME", ouverte(), false);
			// Ré-ouvrir pour éprouver Échap.
			envoyer(span, "pointerdown"); envoyer(span, "focusin"); envoyer(span, "click");
			r.check("préalable Échap : ouverte", ouverte(), true);
			envoyer(document, "keydown", { key: "Escape" });
			r.check("Échap : la bulle se FERME", ouverte(), false);
			b.destroy();
			r.check("destroy : l'élément de la bulle est RETIRÉ du DOM", document.querySelector(".qb-terme-bulle"), null);
		}

		// --- défaut #1 (suite) : un clic sur une bulle ouverte par SURVOL ou
		// FOCUS la GARDE ouverte — seul un clic sur une bulle ouverte PAR UN
		// CLIC la referme. ---
		{
			const { b, span } = nouvelleInstance();
			envoyer(span, "focusin"); // focus CLAVIER, pas de pointerdown avant : ouvre.
			r.check("focus clavier seul (sans pointerdown) : ouvre normalement", ouverte(), true);
			envoyer(span, "click");
			r.check("clic sur une bulle ouverte par le FOCUS : reste ouverte", ouverte(), true);
			envoyer(span, "click");
			r.check("second clic (devenu « propriétaire ») : se ferme", ouverte(), false);
			b.destroy();
		}

		// --- défaut #6 : Échap sur une bulle ouverte au SURVOL (pas de vrai
		// focus DOM sur l'ancre) doit la fermer, sans que le refocus programmatique
		// ne la rouvre aussitôt. ---
		{
			const { b, span } = nouvelleInstance();
			envoyer(span, "pointerover", { pointerType: "mouse" });
			await attendre(300); // DELAI_OUVERTURE_MS (250) + marge
			r.check("préalable : ouverte au survol (sans focus DOM réel)", ouverte(), true);
			envoyer(document, "keydown", { key: "Escape" });
			r.check("Échap sur une bulle ouverte au survol : se FERME (pas rouverte par le refocus)", ouverte(), false);
			b.destroy();
		}

		// --- défaut #7 : revenir sur l'ancre (pointerover) annule une
		// fermeture déjà PLANIFIÉE (grâce de survol). ---
		{
			const { b, span } = nouvelleInstance();
			envoyer(span, "pointerover", { pointerType: "mouse" });
			await attendre(300);
			r.check("préalable : ouverte au survol", ouverte(), true);
			envoyer(span, "pointerout", { pointerType: "mouse" }); // planifie une fermeture (grâce ~150 ms)
			envoyer(span, "pointerover", { pointerType: "mouse" }); // revient DESSUS avant l'échéance
			await attendre(250); // largement après la grâce si elle n'avait pas été annulée
			r.check("retour sur l'ancre pendant la grâce : la fermeture planifiée est ANNULÉE, reste ouverte", ouverte(), true);
			b.destroy();
		}

		// --- défaut #3 : le défilement REPOSITIONNE tant que l'ancre reste
		// visible, et ne ferme que si elle en sort. ---
		{
			const { b, span } = nouvelleInstance();
			envoyer(span, "pointerdown"); envoyer(span, "focusin"); envoyer(span, "click");
			r.check("préalable : ouverte", ouverte(), true);
			const bulleEl = document.querySelector(".qb-terme-bulle");
			const positionAvant = bulleEl.style.top;
			// L'ancre a bougé (défilement) mais reste dans la fenêtre.
			rectAncre = { top: 120, bottom: 140, left: 60, right: 110, width: 50, height: 20 };
			envoyer(window, "scroll");
			r.check("ancre TOUJOURS visible après défilement : reste ouverte", ouverte(), true);
			r.check("… et REPOSITIONNÉE (nouvelle coordonnée)", bulleEl.style.top !== positionAvant, true);
			// L'ancre sort de la fenêtre.
			rectAncre = { top: -500, bottom: -480, left: 60, right: 110, width: 50, height: 20 };
			envoyer(window, "scroll");
			r.check("ancre HORS de la fenêtre : la bulle se FERME", ouverte(), false);
			rectAncre = { top: 400, bottom: 420, left: 100, right: 150, width: 50, height: 20 };
			b.destroy();
		}

		r.done();
	});
}

await verifierBulle();
