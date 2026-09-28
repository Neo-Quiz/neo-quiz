/**
 * COLORATION SYNTAXIQUE — les propriétés que deux revues de code ont
 * démontré manquantes (docs/…/blocs-code-review.md, puis une re-revue) :
 *
 * C1. Aucun effet de bord global. Le greffon tourne DANS Obsidian, qui a son
 *     PROPRE `window.Prism`/`globalThis.Prism` (chargé à la demande par son
 *     propre moteur de rendu). Notre coloration ne doit JAMAIS le lire, ni
 *     l'écrire, ni poser un hook dessus, ni programmer un `highlightAll`.
 *     Preuve, ci-dessous, que l'ANCIEN code (import de `prismjs`, même via
 *     `prismjs/components/prism-core`) le fait : voir « Preuve historique »
 *     dans le rapport de la tâche — un `globalThis.Prism` posé avant l'import
 *     de l'ancien module en ressortait REMPLACÉ (identité perdue, marqueur
 *     perdu, hooks écrasés). Ce script prouve que le code ACTUEL (refractor)
 *     ne fait rien de tel.
 * C2. Durée bornée même sur des motifs RÉPÉTÉS hostiles (pas seulement
 *     aléatoires). Le premier plafond (3000 caractères par bloc, tour 2)
 *     ne suffisait pas : une re-revue a trouvé `q3` (un guillemet, une
 *     apostrophe, un accent grave, répétés) à 334-408 ms sur du bash à
 *     3000 caractères. Ce script mesure `q3`, sur CE plafond (1000
 *     caractères), pour CHAQUE langage chargé — voir « Preuve historique »
 *     du rapport pour la mesure qui montre l'ancien plafond dépasser le
 *     seuil sur ce même motif.
 *
 *     npm run check:code-highlight
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/* ── C1 : aucun effet de bord global ────────────────────────────────── */

async function verifierAucunEffetGlobal() {
	const r = makeReporter("Coloration — aucun effet de bord global (C1)");

	// Cas A : un `globalThis.Prism` existe déjà (celui d'Obsidian). Posé
	// AVANT l'import de notre module, pour le même ordre que dans la vraie
	// fenêtre : le greffon peut se recharger APRÈS qu'Obsidian a déjà chargé
	// son propre Prism sur une note en lecture.
	const espionHighlightAll = { appele: false };
	const fauxPrismObsidian = {
		manual: true,
		marqueurObsidian: "vault-original",
		hooks: { all: { "before-tokenize": ["hook-obsidian"] } },
		highlightAll: () => { espionHighlightAll.appele = true; },
	};
	globalThis.Prism = fauxPrismObsidian;
	// Une fenêtre Electron a TOUJOURS un `window` et un `document` réels ;
	// on ne les fabrique pas ici (linkedom n'est pas nécessaire : le point
	// est justement que notre module ne les touche jamais). On vérifie
	// seulement `globalThis.Prism`, la seule globale que l'ancien code
	// touchait (voir la preuve historique du rapport).

	await withSrcModule("src/engine/code-highlight.ts", ({ colorerCode }) => {
		// On UTILISE vraiment le module (plusieurs langages), pas seulement
		// son import : un effet de bord pourrait n'apparaître qu'à l'usage.
		colorerCode("def f():\n    return 1", "python", (s) => s, 3000);
		colorerCode("<?php echo 1; ?>", "php", (s) => s, 3000);
		colorerCode("SELECT 1", "sql", (s) => s, 3000);

		r.check("le `globalThis.Prism` de l'hôte garde la MÊME référence",
			globalThis.Prism === fauxPrismObsidian, true);
		r.check("son marqueur n'est pas écrasé",
			globalThis.Prism.marqueurObsidian, "vault-original");
		r.check("ses hooks ne sont pas remplacés",
			JSON.stringify(globalThis.Prism.hooks.all), JSON.stringify({ "before-tokenize": ["hook-obsidian"] }));
		r.check("son `highlightAll` n'est jamais appelé", espionHighlightAll.appele, false);
	});

	delete globalThis.Prism;

	// Cas B : AUCUN `globalThis.Prism` avant l'import (greffon activé avant
	// qu'Obsidian n'ait rendu son premier bloc de code). L'ancien code en
	// créait un et programmait un `highlightAll` au prochain tick.
	await withSrcModule("src/engine/code-highlight.ts", ({ colorerCode }) => {
		colorerCode("1 + 1", "javascript", (s) => s, 3000);
		r.check("sans Prism préexistant, aucun `globalThis.Prism` n'est créé",
			typeof globalThis.Prism, "undefined");
	});

	r.done();
	return r;
}

/* ── C2 : durée bornée sur des motifs RÉPÉTÉS hostiles ─────────────── */

/** TOUS les langages enregistrés par `code-highlight.ts` (la même liste que
    ses imports) : la re-revue exige `q3` sur chacun, pas seulement les
    trois pires trouvés au tour précédent. */
const TOUS_LES_LANGAGES = [
	"clike", "markup", "css", "javascript", "typescript", "python", "c", "cpp",
	"java", "bash", "powershell", "sql", "json", "yaml", "go", "rust", "php", "csharp",
];

/** Les motifs hostiles à mesurer sur chaque langage. `q3` (un guillemet,
    une apostrophe, un accent grave) est celui que la re-revue a trouvé pire
    que tout ce que le tour précédent avait essayé — jusqu'à 408 ms sur du
    bash à 3000 caractères, avec l'ancien plafond. Les deux autres viennent
    de la première revue (bash/php, csharp) : gardés pour ne pas perdre leur
    couverture. */
const MOTIFS_HOSTILES = {
	q3: "\"'`",
	melange: "'\"`/*<!--${(",
	point: "a.",
};

async function verifierDureeBornee() {
	const r = makeReporter("Coloration — durée bornée sur des motifs répétés (C2)");
	// Un seuil LARGE (300 ms), demandé explicitement : le pire mesuré (`q3`
	// sur bash), une fois coupé au plafond de 1000 caractères, tombe autour
	// de 34 ms sur une machine rapide (voir le rapport) — la marge absorbe
	// une machine modeste ou un motif encore pire qu'on n'aurait pas essayé.
	const SEUIL_MS = 300;

	await withSrcModule(["src/engine/code-highlight.ts", "src/code-catalogue.ts"], ({ colorerCode, PLAFOND_CARACTERES_PAR_BLOC }, { CODE_CATALOGUE }) => {
		// Plus every grammar the language catalogue colours with (2026-09-28),
		// read from the catalogue itself: a grammar added there is measured
		// here without anyone having to remember this list.
		const langues = [...new Set([...TOUS_LES_LANGAGES, ...CODE_CATALOGUE.map(e => e.grammar).filter(Boolean)])];
		for (const langue of langues) {
			for (const [nomMotif, motif] of Object.entries(MOTIFS_HOSTILES)) {
				// Bien au-delà du plafond, pour que la coupe soit ce qui est
				// mesuré (pas la taille d'entrée).
				const taille = PLAFOND_CARACTERES_PAR_BLOC * 4;
				let code = "";
				while (code.length < taille) code += motif;
				const t0 = performance.now();
				const resultat = colorerCode(code, langue, (s) => s, PLAFOND_CARACTERES_PAR_BLOC);
				const dt = performance.now() - t0;
				r.check(`${langue}/${nomMotif} : coloré (motif répété, ${taille} caractères en entrée)`, !!resultat, true);
				r.check(`${langue}/${nomMotif} : coloré sur au plus le plafond (${PLAFOND_CARACTERES_PAR_BLOC})`,
					resultat ? resultat.colore <= PLAFOND_CARACTERES_PAR_BLOC : "aucun résultat", true);
				r.check(`${langue}/${nomMotif} : sous ${SEUIL_MS} ms (mesuré ${dt.toFixed(1)} ms)`, dt < SEUIL_MS, true);
			}
		}
	});

	r.done();
	return r;
}

/* ── Budget PAR RENDU, éprouvé sur les VRAIS appelants (tour 4) ─────── */

/* Le motif `q3` en bash, bien au-delà du plafond : chaque bloc coloré
   consomme le plafond entier. */
const Q3 = "\"'`";
const CODE_HOSTILE = Q3.repeat(1000).slice(0, 3000);
const BLOC_HOSTILE = "```bash\n" + CODE_HOSTILE + "\n```";
/** Nombre de blocs bash COLORÉS dans un HTML (un bloc échappé n'a pas de
    `<span>` de jeton en tête de son `<code>`). */
const blocsColores = (html) => (html.match(/<code class="language-bash">(?=<span)/g) || []).length;

/**
 * Un DOM (linkedom) pour les appelants réels, qui posent leur HTML dans des
 * éléments. `getComputedStyle`, `requestAnimationFrame` : les deux seuls
 * points du navigateur que `openHintModal` touche avant de rendre l'indice
 * (le reste est gardé par `typeof`). `requestAnimationFrame` ne rappelle
 * jamais : l'animation d'ouverture n'est pas ce qu'on vérifie ici.
 */
async function installerDom() {
	const { parseHTML, NodeFilter } = await import("linkedom");
	const { document, window, Node } = parseHTML("<html><body></body></html>");
	globalThis.document = document;
	// `sanitizeQuizHtml` lit `Node.COMMENT_NODE` : une globale du navigateur.
	globalThis.Node = Node;
	globalThis.NodeFilter = NodeFilter;
	globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
	globalThis.requestAnimationFrame = () => 0;
	globalThis.cancelAnimationFrame = () => {};
	globalThis.window = globalThis.window || window;
}

/**
 * La re-revue du tour 3 avait mesuré 8,4 s pour un quiz de 50 questions,
 * 3,5 s pour une carte d'aperçu à 21 champs : le budget se remettait à zéro
 * à CHAQUE CHAMP (`texteQuizHtml`). La revue du tour 4 a ensuite montré que
 * l'ancien cas de ce script ne prouvait rien — il REPRODUISAIT la boucle au
 * lieu d'appeler le code — et trouvé deux défauts qu'il ne voyait pas :
 * la conversion HTML → markdown (`html-vers-markdown.ts`) remettait le
 * budget à plein à chaque comparaison (9 à 18 s à l'ouverture d'un quiz
 * hostile), et l'indice ouvert au clic héritait d'un budget épuisé.
 * Chaque cas ci-dessous charge le VRAI appelant :
 *   A. `renderQuizPreviewCard` (l'aperçu de l'éditeur) sur UNE carte de 50
 *      champs hostiles — rougit si `texteQuizHtml` remet le budget ;
 *   B. `htmlVersMarkdown` / `texteBaliseVersMarkdown` sur 50 champs
 *      hostiles — rougit si la comparaison colore (temps) ou touche au
 *      budget du rendu en cours (valeur rendue intacte) ;
 *   C. `openHintModal` après un rendu qui a épuisé le budget — rougit si
 *      l'indice ne remet pas le budget à zéro.
 * `engine.ts` (`render`, `refreshQuestionSlide`) et `detail-fiche.ts`
 * (`renderGrille`, privée, atteinte seulement par `renderFiche` qui monte
 * toute la page) ne sont pas chargés ici : voir le rapport de la tâche.
 */
async function verifierBudgetSurLesVraisAppelants() {
	const r = makeReporter("Coloration — budget par rendu, sur les vrais appelants (tour 4)");
	// Seuil LARGE : mesuré ~0,1 s pour chaque cas corrigé, contre 3,5 à 17 s
	// avant (voir le rapport).
	const SEUIL_MS = 1500;
	await installerDom();

	await withSrcModule(
		[
			"src/editor/question-preview.ts",
			"src/editor/html-vers-markdown.ts",
			"src/engine/hint.ts",
			"src/engine/sanitizer.ts",
			"src/engine/code-highlight.ts",
			"src/host/current.ts",
		],
		(apercu, conversion, indice, sanitizer, budget, hote) => {
			const { BUDGET_COLORATION_PAR_RENDU, PLAFOND_CARACTERES_PAR_BLOC } = budget;
			const maxColores = Math.ceil(BUDGET_COLORATION_PAR_RENDU / PLAFOND_CARACTERES_PAR_BLOC);
			hote.installHost({
				links: { resourceUrl: () => null },
				ui: { setIcon: () => {} },
			});

			/* A. Une carte d'aperçu de 50 champs : l'énoncé et 49 options. */
			{
				const q = {
					_type: "single",
					title: "Q",
					prompt: "Énoncé\n\n" + BLOC_HOSTILE,
					options: Array.from({ length: 49 }, (_, i) => `Option ${i}\n\n${BLOC_HOSTILE}`),
					correctIndex: 0,
				};
				const conteneur = document.createElement("div");
				const t0 = performance.now();
				apercu.renderQuizPreviewCard(conteneur, q, { fallbackTitle: "Q" });
				const dt = performance.now() - t0;
				const colores = blocsColores(conteneur.innerHTML);
				const total = (conteneur.innerHTML.match(/<code class="language-bash">/g) || []).length;
				console.log(`  A. aperçu, 1 carte de 50 champs hostiles : ${dt.toFixed(0)} ms, ${colores} blocs colorés`);
				r.check("A. aperçu : les 50 blocs sont rendus", total, 50);
				r.check(`A. aperçu, 1 carte de 50 champs : au plus ${maxColores} blocs colorés (obtenu ${colores})`, colores <= maxColores, true);
				r.check("A. aperçu : au moins un bloc reste coloré", colores > 0, true);
				r.check(`A. aperçu : sous ${SEUIL_MS} ms (mesuré ${dt.toFixed(0)} ms)`, dt < SEUIL_MS, true);
			}

			/* B. La conversion HTML → markdown, faite pour chaque champ à
			   l'ouverture d'une page de quiz (detail-io.ts → convert.ts). */
			{
				const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
				const html = "<p>x</p>" + `<pre><code class="language-bash">${esc(CODE_HOSTILE)}</code></pre>`.repeat(7);
				const texte = "<b>x</b>\n\n" + (BLOC_HOSTILE + "\n\n").repeat(7);
				// Un rendu EN COURS a déjà consommé une partie de son budget : la
				// conversion ne doit ni le recharger ni le vider.
				budget.reinitialiserBudgetRendu();
				budget.consommerBudget(1234);
				const avant = budget.budgetRestant();
				const t0 = performance.now();
				let convertis = 0;
				for (let i = 0; i < 25; i++) if (conversion.htmlVersMarkdown(html) !== null) convertis++;
				for (let i = 0; i < 25; i++) if (conversion.texteBaliseVersMarkdown(texte) !== null) convertis++;
				const dt = performance.now() - t0;
				console.log(`  B. conversion de 50 champs hostiles : ${dt.toFixed(0)} ms`);
				r.check("B. conversion : les 50 champs sont convertis", convertis, 50);
				r.check("B. conversion : le budget du rendu en cours est rendu INTACT", budget.budgetRestant(), avant);
				r.check(`B. conversion de 50 champs hostiles : sous ${SEUIL_MS} ms (mesuré ${dt.toFixed(0)} ms)`, dt < SEUIL_MS, true);
				// Et une conversion qui jette rend quand même le budget.
				budget.reinitialiserBudgetRendu();
				budget.consommerBudget(77);
				try { budget.sansColoration(() => { throw new Error("x"); }); } catch { /* attendu */ }
				r.check("B. `sansColoration` rend le budget même si la fonction jette",
					budget.budgetRestant(), BUDGET_COLORATION_PAR_RENDU - 77);
			}

			/* C. L'indice ouvert au clic, APRÈS un rendu qui a épuisé le budget. */
			{
				budget.reinitialiserBudgetRendu();
				for (let i = 0; i < maxColores + 2; i++) sanitizer.rendreTexteQuiz(BLOC_HOSTILE, { embed: () => "", image: () => "" });
				r.check("C. préalable : le budget est épuisé", budget.budgetRestant() <= 0, true);
				const ctx = {
					HINT_OVERLAY_ID: "indice-test",
					HINT_TITLE_ID: "indice-test-titre",
					escapeHtmlAttr: (s) => String(s),
					__quizGlobalCleanups: [],
					currentAsyncEpoch: () => 0,
					isQuizInstanceAlive: () => false,
					// L'indice pose le bouton « Exécuter » de ses blocs Python
					// (engine/code-run.ts) : hors sujet ici, un stub suffit.
					codeRun: { bindCodeRunButtons: () => {} },
					// Idem pour les termes du glossaire (engine/termes.ts) : ce
					// script éprouve la coloration, pas le soulignement.
					termes: { poserTermes: () => {} },
				};
				ctx.sanitize = sanitizer.createSanitizer({ host: hote.currentHost(), sourcePath: "" });
				indice.createHintHandlers(ctx).openHintModal("Indice\n\n" + BLOC_HOSTILE);
				const corps = document.getElementById("indice-test")?.querySelector(".quiz-hint-modal-body");
				r.check("C. l'indice ouvert au clic est coloré malgré un budget épuisé", corps ? blocsColores(corps.innerHTML) : "pas de corps", 1);
			}

			hote.uninstallHost();
		},
	);

	r.done();
	return r;
}

// `makeReporter(...).done()` pose déjà `process.exitCode = 1` en cas
// d'échec (voir scripts/lib/load-src.mjs) : rien à agréger ici.
await verifierAucunEffetGlobal();
await verifierDureeBornee();
await verifierBudgetSurLesVraisAppelants();
