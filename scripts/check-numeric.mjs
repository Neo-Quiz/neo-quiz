/**
 * Vérification de la RÉPONSE NUMÉRIQUE saisie dans l'éditeur d'équations.
 *
 * Une question numérique posée en LaTeX ouvre MathLive et son clavier : la
 * réponse arrive en LaTeX (« 1{,}5 », « \frac{3}{4} », « 2^{10} »). Ce
 * script éprouve `latexEnNombre` (engine/numeric.ts) et la comparaison en
 * valeur qui la suit : une saisie juste reconnue juste, une saisie qu'on ne
 * sait pas évaluer jamais comptée juste à tort, la tolérance conservée.
 *
 *     npm run check:numeric
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/engine/numeric.ts"], async (n) => {
	const r = makeReporter("Réponse numérique en LaTeX");
	const { latexEnNombre, matchesNumericAnswer } = n;

	// La conversion.
	r.check("entier", latexEnNombre("765"), "765");
	r.check("virgule décimale MathLive", latexEnNombre("1{,}5"), "1.5");
	r.check("virgule nue", latexEnNombre("1,5"), "1.5");
	r.check("fraction", latexEnNombre("\\frac{3}{4}"), "0.75");
	r.check("dfrac", latexEnNombre("\\dfrac{1}{2}"), "0.5");
	r.check("fraction imbriquée", latexEnNombre("\\frac{1}{\\frac{1}{4}}"), "4");
	r.check("puissance", latexEnNombre("2^{10}"), "1024");
	r.check("produit", latexEnNombre("3\\times 255"), "765");
	r.check("produit cdot", latexEnNombre("3\\cdot 5"), "15");
	r.check("signe moins", latexEnNombre("-12"), "-12");
	r.check("parenthèses", latexEnNombre("\\left(2+3\\right)\\cdot 4"), "20");
	r.check("produit implicite", latexEnNombre("3(2+1)"), "9");
	r.check("espaces LaTeX", latexEnNombre("1\\,000"), "1000");
	r.check("unité en texte", latexEnNombre("9{,}81\\text{m/s}"), "9.81 m/s");
	r.check("dollars d'auteur", latexEnNombre("$42$"), "42");
	// Inévaluable : la saisie brute revient, jamais un nombre inventé.
	r.check("lettre", latexEnNombre("u_0"), "u_0");
	r.check("racine non évaluée", latexEnNombre("\\sqrt{2}"), "\\sqrt{2}");
	r.check("parenthèse orpheline", latexEnNombre("(2+3"), "(2+3");
	r.check("vide", latexEnNombre(""), "");

	// La comparaison qui suit.
	const q = { type: "text", numeric: true, prompt: "Calculer $u_0 + \\dots + u_7$" };
	r.check("765 juste", matchesNumericAnswer(q, ["765"], latexEnNombre("765")), true);
	r.check("3×255 juste", matchesNumericAnswer(q, ["765"], latexEnNombre("3\\times 255")), true);
	r.check("764 faux", matchesNumericAnswer(q, ["765"], latexEnNombre("764")), false);
	r.check("u_0 faux", matchesNumericAnswer(q, ["765"], latexEnNombre("u_0")), false);
	const qt = { type: "text", numeric: true, tolerance: 0.01, prompt: "$\\pi$ ?" };
	r.check("tolérance gardée", matchesNumericAnswer(qt, ["3.14159"], latexEnNombre("3{,}14")), true);
	r.check("hors tolérance", matchesNumericAnswer(qt, ["3.14159"], latexEnNombre("3{,}1")), false);
	r.check("fraction contre décimal", matchesNumericAnswer(q, ["0.75"], latexEnNombre("\\frac{3}{4}")), true);

	// "%" is a scale, not a unit (2026-09-28): a probability answered in percent.
	const qp = { type: "text", numeric: true, tolerance: 0.0001 };
	r.check("percent for a probability", matchesNumericAnswer(qp, ["0.625"], "62,5 %"), true);
	r.check("percent without a space", matchesNumericAnswer(qp, ["0.625"], "62,5%"), true);
	r.check("percent from the math keyboard", matchesNumericAnswer(qp, ["0.625"], latexEnNombre("62{,}5\\%")), true);
	r.check("0,625 % is not 0.625", matchesNumericAnswer(qp, ["0.625"], "0,625 %"), false);
	r.check("expected answer written in percent", matchesNumericAnswer(qp, ["62.5%"], "0,625"), true);
	const qpc = { type: "text", numeric: true, unit: "%" };
	r.check("question counted in percent: 25 %", matchesNumericAnswer(qpc, ["25"], "25 %"), true);
	r.check("question counted in percent: 25", matchesNumericAnswer(qpc, ["25"], "25"), true);
	r.check("question counted in percent: 0,25 is not 25", matchesNumericAnswer(qpc, ["25"], "0,25"), false);
	r.check("leading decimal point", matchesNumericAnswer(qp, ["0.49"], ".49"), true);
	r.check("leading decimal comma", matchesNumericAnswer(qp, ["0.49"], ",49"), true);

	r.done();
});

/* An EQUATION answer (a math field with a template): MathLive rewrites what
   the learner types, and the comparison must see through that rewriting
   (2026-09-28, measured by typing into the real field). */
await withSrcModule(["src/engine/math-input.ts"], async (m) => {
	const r = makeReporter("Equation answer written in the math field");
	const { matchesMathAnswer } = m;
	const q = (answers) => ({ type: "text", acceptedAnswers: answers });
	r.check("prime rewritten as ^{\prime}", matchesMathAnswer(String.raw`f^{\prime}(3)=6`, q([`f'(3) = 6`])), true);
	r.check("second derivative", matchesMathAnswer(String.raw`f^{\prime\prime}(x)=6x`, q([`f''(x) = 6x`])), true);
	r.check("prime, wrong value", matchesMathAnswer(String.raw`f^{\prime}(3)=5`, q([`f'(3) = 6`])), false);
	r.check("decimal comma", matchesMathAnswer(String.raw`\lim_{n\to+\infty}u_{n}=1,5`, q([String.raw`\lim_{n \to +\infty} u_n = 1.5`])), true);
	r.check("decimal comma, MathLive form", matchesMathAnswer(String.raw`x=1{,}5`, q([`x = 1.5`])), true);
	r.check("a list comma stays a separator", matchesMathAnswer(String.raw`x=1,y=2`, q([`x = 1.2`])), false);
	r.check("slash for a fraction", matchesMathAnswer(String.raw`x=15/7,\;y=17/7`, q([String.raw`x = \frac{15}{7},\; y = \frac{17}{7}`])), true);
	r.check("fraction, wrong value", matchesMathAnswer(String.raw`x=15/8`, q([String.raw`x = \frac{15}{7}`])), false);
	r.check("u_{n} and \left( still equal", matchesMathAnswer(String.raw`f^{\prime}(x)=6x\left(x^2-4\right)^2`, q([String.raw`f'(x) = 6x(x^2-4)^2`])), true);
	r.done();
});
