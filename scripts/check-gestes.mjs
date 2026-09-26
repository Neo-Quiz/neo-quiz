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

	r.done();
});
