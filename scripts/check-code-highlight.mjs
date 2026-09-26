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

	await withSrcModule("src/engine/code-highlight.ts", ({ colorerCode, PLAFOND_CARACTERES_PAR_BLOC }) => {
		for (const langue of TOUS_LES_LANGAGES) {
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

/* ── Budget PAR RENDU, pas par carte (tour 4) ──────────────────────── */

/**
 * La re-revue du tour 3 a mesuré 8,4 s pour un quiz moteur de 50 questions,
 * 8,2 s pour la grille de 50 cartes, 3,5 s pour une seule carte d'aperçu à
 * 21 champs — parce que le budget se remettait à zéro À CHAQUE CARTE
 * (`questionCardHtml`, `texteQuizHtml`) au lieu d'une fois par rendu
 * complet. Le tour 4 retire ce reset des deux et le pose à la place dans
 * `engine.ts` (avant `slideMap.map` et dans `refreshQuestionSlide`),
 * `dashboard/detail-fiche.ts` (avant la boucle de la grille) et
 * `editor/question-preview.ts` (`renderQuizPreviewCard`, une fois par
 * carte de l'aperçu).
 *
 * Ce script ne charge ni `engine.ts` (assemblage de `ctx` trop lourd pour
 * ce contrôle) ni `question-preview.ts` (a besoin d'un DOM) : il reproduit
 * le MÊME MÉCANISME que ces appelants réels partagent — un seul
 * `reinitialiserBudgetRendu()` puis PLUSIEURS appels à `rendreTexteQuiz`
 * sans reset entre eux — directement sur `sanitizer.ts`, ce qui est
 * exactement ce que `code-highlight.ts` voit dans les deux cas (le module
 * ne sait pas, et n'a pas à savoir, s'il est appelé depuis une boucle de
 * cartes moteur ou une boucle de cartes de grille).
 */
async function verifierBudgetParRenduPasParCarte() {
	const r = makeReporter("Coloration — budget par RENDU, pas par carte (tour 4)");

	await withSrcModule(
		["src/engine/sanitizer.ts", "src/engine/code-highlight.ts"],
		({ rendreTexteQuiz }, { reinitialiserBudgetRendu, BUDGET_COLORATION_PAR_RENDU, PLAFOND_CARACTERES_PAR_BLOC }) => {
			const IMG = { embed: () => "", image: () => "" };
			const q3 = "\"'`";
			// Une « carte » : un seul bloc bash largement au-dessus du plafond,
			// pour que chaque carte colorée EN CONSOMME LE MAXIMUM.
			const carte = () => "```bash\n" + q3.repeat(1000).slice(0, 3000) + "\n```\n\n";
			const N = 50;
			const estColoree = (html) => /<code class="language-bash">(?=<span)/.test(html);
			const cartesMaxColorables = Math.ceil(BUDGET_COLORATION_PAR_RENDU / PLAFOND_CARACTERES_PAR_BLOC);

			// LE COMPORTEMENT RÉEL (tour 4) : un seul reset avant la boucle de
			// N cartes, comme `engine.ts` / `detail-fiche.ts`.
			reinitialiserBudgetRendu();
			let coloreesUnSeulReset = 0;
			for (let i = 0; i < N; i++) if (estColoree(rendreTexteQuiz(carte(), IMG))) coloreesUnSeulReset++;
			r.check(`${N} cartes à la suite, UN SEUL reset : au plus ${cartesMaxColorables} colorées (budget ${BUDGET_COLORATION_PAR_RENDU} / plafond ${PLAFOND_CARACTERES_PAR_BLOC})`,
				coloreesUnSeulReset <= cartesMaxColorables, true);
			r.check(`${N} cartes à la suite, UN SEUL reset : au moins une carte reste colorée`,
				coloreesUnSeulReset > 0, true);

			// LA PREUVE QUE ÇA ROUGIT AVEC L'ANCIEN COMPORTEMENT (reset PAR
			// CARTE, retiré de `questionCardHtml`/`texteQuizHtml` par ce tour) :
			// reproduit ici à l'identique, sur les MÊMES données.
			let coloreesResetParCarte = 0;
			for (let i = 0; i < N; i++) {
				reinitialiserBudgetRendu(); // le point que le tour 4 a retiré
				if (estColoree(rendreTexteQuiz(carte(), IMG))) coloreesResetParCarte++;
			}
			r.check(`${N} cartes, reset PAR CARTE (ancien comportement, tour 3) : TOUTES colorées — dépasserait le budget d'un rendu (rougirait sur l'assertion précédente)`,
				coloreesResetParCarte, N);
		},
	);

	r.done();
	return r;
}

// `makeReporter(...).done()` pose déjà `process.exitCode = 1` en cas
// d'échec (voir scripts/lib/load-src.mjs) : rien à agréger ici.
await verifierAucunEffetGlobal();
await verifierDureeBornee();
await verifierBudgetParRenduPasParCarte();
