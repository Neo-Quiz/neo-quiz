import type { TextQuestion } from "../types/quiz";

/* ══════════════════════════════════════════════════════════
   RÉPONSE NUMÉRIQUE — comparer des NOMBRES, pas des chaînes.

   Une question de physique attend « 9,81 ». L'élève tape « 9.81 », ou
   « 9,810 », ou « 9.81 m/s² ». Comparées comme du texte, ces trois réponses
   justes sont fausses. C'est le défaut que ce module corrige.

   Deux niveaux, volontairement distincts :

   - NORMALISATION LOCALE (toujours active, cf. terminal.ts) : « 3,14 » et
     « 3.14 » sont la même écriture à la virgule décimale près. Aucun risque,
     aucune tolérance introduite.
   - MODE NUMÉRIQUE (déclaré par l'auteur : `numeric`, `tolerance`,
     `tolerancePercent` ou `unit`) : la réponse est un NOMBRE, comparé en
     valeur, à une marge près, l'unité étant acceptée en suffixe.

   Le mode n'est jamais déduit du contenu : une référence « 007 » est une
   chaîne, pas l'entier 7, et personne ne peut trancher à la place de l'auteur.
══════════════════════════════════════════════════════════ */

/** Champs numériques d'une question texte (extension de TextQuestion). */
export interface NumericFields {
	/** Force la comparaison numérique, même sans tolérance ni unité. */
	numeric?: boolean;
	/** Marge ABSOLUE acceptée : |saisi − attendu| ≤ tolerance. */
	tolerance?: number;
	/** Marge RELATIVE en pourcentage de la valeur attendue. */
	tolerancePercent?: number;
	/** Unité attendue (« m/s », « kg ») — acceptée en suffixe, jamais exigée. */
	unit?: string;
}

export type NumericQuestion = TextQuestion & NumericFields;

/** Valeur lue dans une saisie : le nombre et ce qui le suivait. */
export interface ParsedNumeric {
	value: number;
	unit: string;
}

export function isNumericQuestion(q: TextQuestion | null | undefined): boolean {
	const n = q as NumericQuestion | null | undefined;
	if (!n) return false;
	return n.numeric === true
		|| typeof n.tolerance === "number"
		|| typeof n.tolerancePercent === "number"
		|| (typeof n.unit === "string" && n.unit.trim().length > 0);
}

/* Séparateurs de milliers à ignorer : espace ordinaire, insécable, fine
   insécable et apostrophe (convention suisse). Le POINT n'y est jamais : il
   est décimal dans la moitié du monde, et « 1.234 » doit rester 1,234. */
const GROUPING = /[\s  ']/g;

/**
 * Lit un nombre en tête de chaîne, quelle que soit sa convention d'écriture :
 * virgule ou point décimal, séparateurs de milliers, notation scientifique,
 * fraction simple (« 1/2 »), signe. Ce qui suit est rendu comme unité.
 * `null` si rien de numérique ne commence la chaîne.
 */
export function parseNumericValue(raw: unknown): ParsedNumeric | null {
	let s = String(raw ?? "").trim();
	if (!s) return null;

	// Notations mathématiques d'un même nombre, ramenées à leur forme simple.
	s = s.replace(/^[+]/, "").replace(GROUPING, "");
	s = s.replace(/−/g, "-");   // signe moins typographique
	s = s.replace(/×10\^?/gi, "e").replace(/\*10\^?/g, "e");

	// Fraction « a/b » : une réponse légitime à toute question de proportion.
	const frac = s.match(/^(-?\d+(?:[.,]\d+)?)\s*\/\s*(-?\d+(?:[.,]\d+)?)(.*)$/);
	if (frac) {
		const num = Number(frac[1].replace(",", "."));
		const den = Number(frac[2].replace(",", "."));
		if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
			return { value: num / den, unit: frac[3].trim() };
		}
		return null;
	}

	const m = s.match(/^(-?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?)(.*)$/);
	if (!m) return null;
	const value = Number(m[1].replace(",", "."));
	if (!Number.isFinite(value)) return null;
	return { value, unit: m[2].trim() };
}

/** Toute la chaîne est-elle un nombre ? (sert à normaliser « 3,14 » → « 3.14 »
    sans toucher aux textes qui contiennent une virgule.) */
export function isPurelyNumeric(raw: unknown): boolean {
	const parsed = parseNumericValue(raw);
	return parsed !== null && parsed.unit === "";
}

/** Marge acceptée autour de la valeur attendue ; 0 = égalité de valeurs. */
function toleranceFor(q: NumericQuestion, expected: number): number {
	if (typeof q.tolerance === "number" && Number.isFinite(q.tolerance)) {
		return Math.abs(q.tolerance);
	}
	if (typeof q.tolerancePercent === "number" && Number.isFinite(q.tolerancePercent)) {
		return Math.abs(expected * q.tolerancePercent / 100);
	}
	return 0;
}

/** Comparaison d'unités : casse et espaces ignorés, ainsi que les variantes
    d'exposant qu'un clavier rend malaisées (m/s2 ≡ m/s² ≡ m/s^2). */
function normalizeUnit(raw: unknown): string {
	return String(raw ?? "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "")
		.replace(/\^/g, "")
		.replace(/²/g, "2")
		.replace(/³/g, "3")
		.replace(/·/g, ".");
}

/**
 * La saisie répond-elle à la question, numériquement ?
 * L'unité n'est vérifiée que si l'élève en a écrit une : l'exiger
 * transformerait une question de calcul en question de notation.
 */
export function matchesNumericAnswer(q: NumericQuestion, accepted: string[], value: unknown): boolean {
	const student = parseNumericValue(value);
	if (!student) return false;

	const expectedUnit = normalizeUnit(q.unit);
	if (student.unit && expectedUnit && normalizeUnit(student.unit) !== expectedUnit) return false;
	// Unité écrite alors qu'aucune n'est attendue : on ne la retient pas contre
	// l'élève tant que le nombre, lui, est bon.

	return accepted.some(raw => {
		const target = parseNumericValue(raw);
		if (!target) return false;
		const margin = toleranceFor(q, target.value);
		// Le zéro machine (0.1 + 0.2 ≠ 0.3) rendrait faux un « 0,3 » exact :
		// une marge nulle garde une épaisseur d'un ULP relatif.
		const epsilon = margin > 0 ? margin : Math.abs(target.value) * 1e-9 + 1e-12;
		return Math.abs(student.value - target.value) <= epsilon;
	});
}

/* ══════════════════════════════════════════════════════════
   SAISIE MATHLIVE D'UNE RÉPONSE NUMÉRIQUE

   Une question numérique posée en LaTeX (« Calculer $u_0 + … + u_7$ »)
   s'écrit dans l'éditeur d'équations, avec son clavier (Ahmed,
   2026-09-23). Sa réponse arrive donc en LaTeX : « 765 », mais aussi
   « 1{,}5 », « \frac{3}{4} », « 2^{10} » ou « 3\times 255 ». On la ramène
   à un nombre avant la comparaison en valeur, pour que la tolérance et
   l'unité restent celles de la question. Une écriture qu'on ne sait pas
   évaluer reste telle quelle : elle sera fausse, jamais juste à tort.
══════════════════════════════════════════════════════════ */

/** Le LaTeX d'une saisie ramené à une expression arithmétique, et l'unité
    écrite en `\text{…}` / `\mathrm{…}` à part. */
function latexEnExpression(latex: string): { expr: string; unit: string } {
	let s = latex.trim().replace(/^\$\$?|\$\$?$/g, "");
	let unit = "";
	s = s.replace(/\\(?:text|mathrm|operatorname)\{([^{}]*)\}/g, (_m, u: string) => { unit += u; return ""; });
	s = s.replace(/\{,\}/g, ".");
	s = s.replace(/\\left|\\right/g, "");
	s = s.replace(/\\[,;:! ]|~|\\quad|\\qquad/g, "");
	s = s.replace(/\\(?:cdot|times)/g, "*").replace(/\\div/g, "/");
	s = s.replace(/−/g, "-");
	// \frac{a}{b} (et ses variantes), répété pour les fractions imbriquées.
	for (let i = 0; i < 4; i++) s = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, "(($1)/($2))");
	// Accolades restantes : de simples groupements (exposants, etc.).
	s = s.replace(/\{/g, "(").replace(/\}/g, ")");
	s = s.replace(/\s+/g, "").replace(/,/g, ".");
	return { expr: s, unit: unit.trim() };
}

/** Évalue + − × ÷ ^ et parenthèses sur des décimaux ; `null` sur tout le
    reste (une lettre, une fonction, une parenthèse orpheline). */
function evaluer(expr: string): number | null {
	let i = 0;
	const voir = (): string => expr[i] ?? "";
	function somme(): number | null {
		let v = produit();
		while (v !== null && (voir() === "+" || voir() === "-")) {
			const op = expr[i++];
			const d = produit();
			if (d === null) return null;
			v = op === "+" ? v + d : v - d;
		}
		return v;
	}
	function produit(): number | null {
		let v = puissance();
		// Produit implicite : « 3(2) » ou « (2)(3) ».
		while (v !== null && (voir() === "*" || voir() === "/" || voir() === "(")) {
			const op = voir() === "(" ? "*" : expr[i++];
			const d = puissance();
			if (d === null) return null;
			v = op === "*" ? v * d : v / d;
		}
		return v;
	}
	function puissance(): number | null {
		const b = unaire();
		if (b === null) return null;
		if (voir() !== "^") return b;
		i++;
		const e = puissance();
		return e === null ? null : Math.pow(b, e);
	}
	function unaire(): number | null {
		if (voir() === "-") { i++; const v = unaire(); return v === null ? null : -v; }
		if (voir() === "+") { i++; return unaire(); }
		if (voir() === "(") {
			i++;
			const v = somme();
			if (voir() !== ")") return null;
			i++;
			return v;
		}
		const m = expr.slice(i).match(/^\d+(?:\.\d+)?(?:e[-+]?\d+)?/i);
		if (!m) return null;
		i += m[0].length;
		return Number(m[0]);
	}
	const v = somme();
	return v !== null && i === expr.length && Number.isFinite(v) ? v : null;
}

/** La saisie LaTeX d'une réponse numérique, écrite comme `parseNumericValue`
    la lit : « 765 », « 0.75 m/s ». Inévaluable : la saisie brute. */
export function latexEnNombre(latex: unknown): string {
	const brut = String(latex ?? "");
	const { expr, unit } = latexEnExpression(brut);
	if (!expr) return brut;
	const v = evaluer(expr);
	if (v === null) return brut;
	return unit ? `${v} ${unit}` : String(v);
}
