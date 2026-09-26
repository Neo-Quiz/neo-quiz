/**
 * COLORATION SYNTAXIQUE — les deux propriétés qu'une revue de code a
 * démontré manquantes après le commit 9f214809 (docs/…/blocs-code-review.md) :
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
 *     aléatoires) : bash, csharp et php, les trois pires de la revue.
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

/** Les pires motifs mesurés dans la revue (superlinéaires sur ces
    grammaires), répétés bien au-delà du plafond par bloc : la fonction doit
    les couper à `PLAFOND_CARACTERES_PAR_BLOC` avant de tokeniser, donc rester
    rapide quelle que soit la longueur de départ. */
const MOTIFS_HOSTILES = {
	bash: "'\"`/*<!--${(",
	csharp: "a.",
	php: "'\"`/*<!--${(",
};

async function verifierDureeBornee() {
	const r = makeReporter("Coloration — durée bornée sur des motifs répétés (C2)");
	// Un seuil LARGE (300 ms) : le pire mesuré dans la revue, une fois coupé
	// au plafond de 3000 caractères, tombe autour de 70-100 ms sur une
	// machine rapide (voir le rapport) — la marge absorbe une machine modeste.
	const SEUIL_MS = 300;

	await withSrcModule("src/engine/code-highlight.ts", ({ colorerCode, PLAFOND_CARACTERES_PAR_BLOC }) => {
		for (const [langue, motif] of Object.entries(MOTIFS_HOSTILES)) {
			// Bien au-delà du plafond, pour que la coupe soit ce qui est
			// mesuré (pas la taille d'entrée).
			const taille = PLAFOND_CARACTERES_PAR_BLOC * 4;
			let code = "";
			while (code.length < taille) code += motif;
			const t0 = performance.now();
			const resultat = colorerCode(code, langue, (s) => s, PLAFOND_CARACTERES_PAR_BLOC);
			const dt = performance.now() - t0;
			r.check(`${langue} : coloré (motif répété, ${taille} caractères en entrée)`, !!resultat, true);
			r.check(`${langue} : coloré sur au plus le plafond (${PLAFOND_CARACTERES_PAR_BLOC})`,
				resultat ? resultat.colore <= PLAFOND_CARACTERES_PAR_BLOC : "aucun résultat", true);
			r.check(`${langue} : sous ${SEUIL_MS} ms (mesuré ${dt.toFixed(1)} ms)`, dt < SEUIL_MS, true);
		}
	});

	r.done();
	return r;
}

// `makeReporter(...).done()` pose déjà `process.exitCode = 1` en cas
// d'échec (voir scripts/lib/load-src.mjs) : rien à agréger ici.
await verifierAucunEffetGlobal();
await verifierDureeBornee();
