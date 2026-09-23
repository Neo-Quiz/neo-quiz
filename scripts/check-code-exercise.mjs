/**
 * Le NOYAU de l'exercice de code (src/code-exercise/), chargé RÉEL.
 *
 * Ce qu'il empêche : une sortie juste refusée pour un `\r\n` ou un espace
 * de fin ; un écart mal situé (l'élève corrige la mauvaise ligne) ; une
 * traceback noyée dans les cadres internes de Pyodide ; une échelle qui
 * donne la solution trop tôt (abus d'indices) ou jamais (wheel-spinning),
 * ou qui compte comme un échec la revérification d'un code inchangé.
 *
 *     npm run check:code-exercise
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

{
	const r = makeReporter("Exercice de code — pureté du noyau");
	const INTERDITS = [
		[/from\s+["']obsidian["']/, "import obsidian"],
		[/\bdocument\./, "document"],
		[/\bwindow\./, "window"],
		[/\bDate\.now\s*\(/, "Date.now()"],
		[/\bnew\s+Date\s*\(/, "new Date()"],
		[/\bMath\.random\s*\(/, "Math.random()"],
		[/currentHost\s*\(/, "currentHost()"],
		[/from\s+["'][^"']*\/host\//, "import de l'hôte"],
	];
	const dir = "src/code-exercise";
	for (const f of readdirSync(dir).filter(n => n.endsWith(".ts"))) {
		const src = readFileSync(join(dir, f), "utf8");
		for (const [re, nom] of INTERDITS) r.check(`${f} sans ${nom}`, re.test(src), false);
	}
	r.done();
}

await withSrcModule("src/code-exercise/index.ts", (m) => {
	const r = makeReporter("Exercice de code — champs");
	r.check("discriminant : language non vide", [m.estQuestionCode({ language: "python" }), m.estQuestionCode({ language: " " }), m.estQuestionCode({ prompt: "x" }), m.estQuestionCode(null)], [true, false, false, false]);
	r.check("seul python s'exécute", [m.estExecutable({ language: "Python" }), m.estExecutable({ language: "js" })], [true, false]);
	r.check("hints prime sur hint, vides retirés", m.indicesDe({ language: "python", hint: "h", hints: ["a", " ", "b"] }), ["a", "b"]);
	r.check("hint seul sert de repli", m.indicesDe({ language: "python", hint: " h " }), ["h"]);
	r.check("sans indice", m.indicesDe({ language: "python" }), []);
	r.check("entrées par défaut : un essai sans entrée", m.entreesDe({ language: "python" }), [""]);
	r.check("entrées non textuelles ignorées", m.entreesDe({ language: "python", inputs: ["1", 2, "3"] }), ["1", "3"]);
	r.done();
});

await withSrcModule("src/code-exercise/index.ts", (m) => {
	const r = makeReporter("Exercice de code — sorties");
	r.check("CRLF, espaces de fin, lignes vides finales", m.comparerSorties("a\nb\n", "a  \r\nb\r\n\r\n\r\n"), { ok: true });
	r.check("espaces INTERNES comptent", m.comparerSorties("a b", "a  b"), { ok: false, ligne: 1, attendu: "a b", obtenu: "a  b" });
	r.check("casse compte", m.comparerSorties("Oui", "oui").ok, false);
	r.check("première ligne qui diffère", m.comparerSorties("1\n2\n3", "1\n9\n3"), { ok: false, ligne: 2, attendu: "2", obtenu: "9" });
	r.check("ligne manquante", m.comparerSorties("1\n2", "1"), { ok: false, ligne: 2, attendu: "2", obtenu: null });
	r.check("ligne en trop", m.comparerSorties("1", "1\n2"), { ok: false, ligne: 2, attendu: null, obtenu: "2" });
	r.check("deux sorties vides", m.comparerSorties("", "\n"), { ok: true });
	r.done();
});

await withSrcModule("src/code-exercise/index.ts", (m) => {
	const r = makeReporter("Exercice de code — traceback");
	const brute = readFileSync("scripts/fixtures/traceback-pyodide-314.txt", "utf8");
	r.check("cadres internes de Pyodide retirés", m.nettoyerTraceback(brute),
		"Traceback (most recent call last):\n  File \"main.py\", line 3, in <module>\n    print(x / 0)\n          ~~^~~\nZeroDivisionError: division by zero");
	const syntaxe = "Traceback (most recent call last):\n  File \"/lib/python314.zip/_pyodide/_base.py\", line 151, in _parse_and_compile_gen\n    mod = compile(source, filename, mode, flags | ast.PyCF_ONLY_AST)\n  File \"main.py\", line 1\n    def f(:\n          ^\nSyntaxError: invalid syntax";
	r.check("erreur de syntaxe : le cadre main.py sans « in »", m.nettoyerTraceback(syntaxe),
		"Traceback (most recent call last):\n  File \"main.py\", line 1\n    def f(:\n          ^\nSyntaxError: invalid syntax");
	r.check("texte sans traceback rendu tel quel (sans blancs de fin)", m.nettoyerTraceback("Erreur brève\n"), "Erreur brève");
	r.done();
});

await withSrcModule("src/code-exercise/index.ts", (m) => {
	const r = makeReporter("Exercice de code — échelle");
	let e = m.etatInitial("print(1)");
	r.check("état initial", e, { code: "print(1)", echecs: 0, dernierVerifie: null, solutionVue: false, reussi: false, passe: false });
	r.check("rien de débloqué au départ", [m.indicesVisibles(e, 3), m.solutionDebloquee(e, 3), m.passerDisponible(e), m.verdictCode(e)], [0, false, false, null]);

	let x = m.apresVerification(e, "print(2)", false); e = x.etat;
	r.check("1er échec : compté, indice 1, passer", [x.compte, e.echecs, m.indicesVisibles(e, 3), m.passerDisponible(e), m.solutionDebloquee(e, 3)], [true, 1, 1, true, false]);

	x = m.apresVerification(e, "print(2)  \r\n", false);
	r.check("même code (normalisé) : non compté", [x.compte, x.etat.echecs], [false, 1]);

	for (const c of ["print(3)", "print(4)"]) e = m.apresVerification(e, c, false).etat;
	r.check("3 échecs, 3 indices : tous visibles, solution pas encore", [m.indicesVisibles(e, 3), m.solutionDebloquee(e, 3)], [3, false]);
	e = m.apresVerification(e, "print(5)", false).etat;
	r.check("4e échec : solution débloquée (indices + 1)", [m.indicesVisibles(e, 3), m.solutionDebloquee(e, 3)], [3, true]);

	const zero = m.apresVerification(m.etatInitial(""), "a", false).etat;
	r.check("sans indice : solution au 2e échec, pas au 1er", [m.solutionDebloquee(zero, 0), m.solutionDebloquee(m.apresVerification(zero, "b", false).etat, 0)], [false, true]);

	const ok = m.apresVerification(e, "print(1)", true);
	r.check("réussite après indices = correct", [ok.compte, ok.etat.reussi, m.verdictCode(ok.etat)], [true, true, "correct"]);
	r.check("après réussite, plus rien ne compte", m.apresVerification(ok.etat, "autre", false).compte, false);

	r.check("solution vue = wrong, même si le code passe ensuite",
		m.verdictCode(m.apresVerification({ ...e, solutionVue: true }, "print(1)", true).etat), "wrong");
	r.check("passé = skipped", m.verdictCode({ ...e, passe: true }), "skipped");
	r.done();
});
