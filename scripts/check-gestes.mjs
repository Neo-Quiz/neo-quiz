/**
 * LES GESTES d'édition d'une question (`src/editor/gestes.ts`), purs.
 * Ce qu'ils empêchent : une question sans bonne réponse, deux emplacements
 * d'un classement sur le même élément, des indices qui ne suivent pas un
 * ajout ou un retrait d'option.
 *     npm run check:gestes
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/editor/gestes.ts", ({
	basculerBonne, ajouterOption, retirerOption, placerOrdre, associer, ajouterVariante, retirerVariante,
	changerType, memeFamille, retirerPossibilite, retirerLigne, retirerChoix,
}) => {
	const r = makeReporter("Gestes d'édition d'une question");

	// --- basculerBonne : choix unique ---
	{
		const q = { options: ["a", "b", "c"], correctIndex: 1 };
		r.check("single : bascule change la bonne réponse", [basculerBonne(q, 2), q.correctIndex], [true, 2]);
		r.check("single : bascule sur la bonne déjà en place → refusé", [basculerBonne(q, 2), q.correctIndex], [false, 2]);
	}

	// --- basculerBonne : choix multiple ---
	{
		const q = { correctIndices: [0] };
		r.check("multi : ajoute une bonne réponse", [basculerBonne(q, 2), q.correctIndices], [true, [0, 2]]);
		r.check("multi : retire une bonne réponse", [basculerBonne(q, 0), q.correctIndices], [true, [2]]);
		r.check("multi : retirer la dernière bonne → refusé", [basculerBonne(q, 2), q.correctIndices], [false, [2]]);
	}

	// --- ajouterOption ---
	{
		const q = { options: ["a", "b", "c"], correctIndex: 2 };
		r.check("ajout après un indice : options et correctIndex décalés", (() => {
			const ok = ajouterOption(q, 0);
			return [ok, q.options, q.correctIndex];
		})(), [true, ["a", "", "b", "c"], 3]);
		r.check("ajout en tête (-1)", (() => {
			const ok = ajouterOption(q, -1);
			return [ok, q.options, q.correctIndex];
		})(), [true, ["", "a", "", "b", "c"], 4]);
	}

	// --- retirerOption : choix unique ---
	{
		const q1 = { options: ["a", "b", "c"], correctIndex: 1 };
		r.check("single : retirer la bonne réponse → refusé", retirerOption(q1, 1), false);
		const q2 = { options: ["a", "b"], correctIndex: 0 };
		r.check("single : retirer sous deux options → refusé", retirerOption(q2, 1), false);
		const q3 = { options: ["a", "b", "c"], correctIndex: 2 };
		r.check("single : retirer une option avant la bonne décrémente correctIndex", (() => {
			const ok = retirerOption(q3, 0);
			return [ok, q3.options, q3.correctIndex];
		})(), [true, ["b", "c"], 1]);
	}

	// --- retirerOption : choix multiple ---
	{
		const q = { options: ["a", "b", "c", "d"], correctIndices: [1, 3] };
		r.check("multi : retirer une option décale les indices au-delà", (() => {
			const ok = retirerOption(q, 0);
			return [ok, q.options, q.correctIndices];
		})(), [true, ["b", "c", "d"], [0, 2]]);
	}

	// --- retirerOption : multi, une bonne réponse → refusé (revue finale) ---
	{
		const q = { options: ["a", "b", "c"], correctIndices: [0, 2] };
		r.check("multi : retirer une option BONNE → refusé", [retirerOption(q, 2), q.options, q.correctIndices], [false, ["a", "b", "c"], [0, 2]]);
	}

	// --- retirer un élément, une ligne, un choix (revue finale, 2026-09-27) ---
	{
		const o = { possibilities: ["A", "B", "C"], slots: ["1", "2", "3"], correctOrder: [2, 0, 1] };
		r.check("classement : retirer un élément garde une permutation (plus de case vers un disparu)",
			[retirerPossibilite(o, 2), o.possibilities, o.correctOrder, o.slots], [true, ["A", "B"], [0, 1], ["1", "2"]]);
		const o2 = { possibilities: ["A", "B", "C"], slots: ["1", "2", "3"], correctOrder: [2, 0, 1] };
		r.check("classement : retirer le premier décale les éléments au-delà",
			[retirerPossibilite(o2, 0), o2.correctOrder], [true, [1, 0]]);
		r.check("classement : jamais sous un élément", retirerPossibilite({ possibilities: ["A"], correctOrder: [0] }, 0), false);
		const m = { rows: ["x", "y", "z"], choices: ["X", "Y", "Z"], correctMap: [2, 1, 0] };
		r.check("appariement : retirer un choix — les lignes suivent leur choix",
			[retirerChoix(m, 0), m.choices, m.correctMap], [true, ["Y", "Z"], [1, 0, 0]]);
		const m2 = { rows: ["x", "y", "z"], choices: ["X", "Y", "Z"], correctMap: [2, 1, 0] };
		r.check("appariement : retirer une ligne emporte sa paire, les autres gardent la leur",
			[retirerLigne(m2, 0), m2.rows, m2.correctMap], [true, ["y", "z"], [1, 0]]);
	}

	// --- placerOrdre ---
	{
		const q = { correctOrder: [0, 1, 2] };
		r.check("classement : échange (jamais deux emplacements sur le même élément)", (() => {
			const ok = placerOrdre(q, 0, 2);
			return [ok, q.correctOrder];
		})(), [true, [2, 1, 0]]);
		r.check("classement : déjà en place → refusé", placerOrdre(q, 1, 1), false);
	}

	// --- associer ---
	{
		const q = { rows: ["x", "y"], choices: ["p", "q"], correctMap: [0, 0] };
		r.check("appariement : associe une ligne", (() => {
			const ok = associer(q, 1, 1);
			return [ok, q.correctMap];
		})(), [true, [0, 1]]);
		r.check("appariement : indice hors bornes borné au dernier choix", (() => {
			const ok = associer(q, 0, 9);
			return [ok, q.correctMap];
		})(), [true, [1, 1]]);
	}

	// --- variantes ---
	{
		const q = { acceptedAnswers: ["seule"] };
		r.check("variante : retirer la dernière → refusé", retirerVariante(q, 0), false);
		r.check("variante : ajouter en pousse une nouvelle", (() => {
			const ok = ajouterVariante(q);
			return [ok, q.acceptedAnswers];
		})(), [true, ["seule", ""]]);
		r.check("variante : retirer n'est plus la dernière → accepté", (() => {
			const ok = retirerVariante(q, 1);
			return [ok, q.acceptedAnswers];
		})(), [true, ["seule"]]);
	}

	// --- changerType ---
	{
		const commun = { _id: "x", title: "T", prompt: "P", hint: "", explain: "E", resourceButton: null, _useHtmlPrompt: false };
		const q = { ...commun, _type: "single", options: ["a", "b", "c"], correctIndex: 2 };
		r.check("type : même type → refusé", changerType(q, { ...commun, _type: "single", options: ["", ""], correctIndex: 0 }), false);
		r.check("type : unique → multiple garde les options, la bonne devient la seule bonne", (() => {
			const ok = changerType(q, { ...commun, _type: "multi", options: ["", ""], correctIndices: [] });
			return [ok, q._type, q.options, q.correctIndices, q.correctIndex];
		})(), [true, "multi", ["a", "b", "c"], [2], undefined]);
		r.check("type : multiple → unique, la première bonne devient LA bonne", (() => {
			q.correctIndices = [1, 2];
			const ok = changerType(q, { ...commun, _type: "single", options: ["", ""], correctIndex: 0 });
			return [ok, q.options, q.correctIndex, q.correctIndices];
		})(), [true, ["a", "b", "c"], 1, undefined]);
		r.check("type : choix → classement, les options partent, les champs communs restent", (() => {
			const ok = changerType(q, { ...commun, _type: "ordering", slots: ["1", "2"], possibilities: ["", ""], correctOrder: [0, 1] });
			return [ok, q.options, q.correctIndex, q.possibilities, q.title, q.prompt, q.explain];
		})(), [true, undefined, undefined, ["", ""], "T", "P", "E"]);
		const s = { ...commun, _type: "cmd", acceptedAnswers: ["dir"], caseSensitive: true, commandPrefix: "C:\\>", placeholder: "", _variantKey: "terminalVariant", _variantValue: "cmd" };
		r.check("type : terminal → texte garde les réponses et la casse, perd l'invite et la variante écrite", (() => {
			const ok = changerType(s, { ...commun, _type: "text", acceptedAnswers: [""], caseSensitive: false, placeholder: "Réponse" });
			return [ok, s.acceptedAnswers, s.caseSensitive, s.commandPrefix, s._variantKey, s.placeholder];
		})(), [true, ["dir"], true, undefined, undefined, "Réponse"]);
		r.check("type : indices bornés aux nouvelles longueurs (bonnes réponses, ordre)", (() => {
			// Un défaut qui viserait des éléments absents, une source hors bornes.
			const o = { ...commun, _type: "single", options: ["a", "b"], correctIndex: 0 };
			const okO = changerType(o, { ...commun, _type: "ordering", slots: ["1", "2"], possibilities: ["", ""], correctOrder: [0, 7, 1] });
			const u = { ...commun, _type: "multi", options: ["a", "b"], correctIndices: [4, 9] };
			const okU = changerType(u, { ...commun, _type: "single", options: ["", ""], correctIndex: 0 });
			return [okO, o.correctOrder, okU, u.correctIndex];
		})(), [true, [0, 1], true, 0]);
		r.check("type : unique → multiple, une bonne hors bornes retombe sur la première", (() => {
			const x = { ...commun, _type: "single", options: ["a", "b"], correctIndex: 6 };
			changerType(x, { ...commun, _type: "multi", options: ["", ""], correctIndices: [] });
			return x.correctIndices;
		})(), [0]);
		r.check("type : famille — choix et saisie ne se transposent pas", [memeFamille("single", "multi"), memeFamille("text", "bash"), memeFamille("single", "text")], [true, true, false]);
	}

	r.done();
});
