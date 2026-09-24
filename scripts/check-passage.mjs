/**
 * Vérification du SUPPORT affiché au-dessus d'une question (engine/passage.ts).
 *
 * Dans un Learn, chaque rôle a sa règle : le cours est caché avant la lecture
 * ("pre") et pendant un rappel de mémoire ("recall"), ouvert sur la lecture,
 * et OUVERT au-dessus d'une question "explain" — on explique avec le cours
 * sous les yeux (2026-09-24). Un Learn généré n'a pas de champ `passage` :
 * le cours d'une "explain" est la carte de lecture de la même étape.
 *
 *     npm run check:passage
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/engine/passage.ts"], ({ passageVisibility, createPassageHandlers }) => {
	const r = makeReporter("Support d'une question");

	const vis = (role, checked = false) => passageVisibility({ role, checked, isLesson: true });
	r.check("Learn : visibilité par rôle",
		[vis("pre"), vis("read"), vis("recall"), vis("recall", true), vis("explain"), vis("test")],
		["hidden", "open", "hidden", "open", "open", "collapsible"]);
	r.check("hors Learn : repliable", passageVisibility({ role: "explain", checked: false, isLesson: false }), "collapsible");

	const quiz = [
		{ title: "Avant", prompt: "?", slice: 1, role: "pre" },
		{ title: "Les tubes", prompt: "Un tube relie la sortie d'une commande à l'entrée de la suivante.", slice: 1, role: "read" },
		{ title: "À toi", prompt: "Explique un tube.", slice: 1, role: "explain" },
		{ title: "Lecture 2", prompt: "Les redirections.", slice: 2, role: "read" },
		{ title: "À toi 2", prompt: "Explique.", slice: 2, role: "explain" },
		{ title: "Rappel", prompt: "?", slice: 2, role: "recall" },
		{ title: "Sans lecture", prompt: "Explique.", slice: 3, role: "explain" },
	];
	const ctx = (lesson) => ({
		quiz,
		isLessonMode: () => lesson,
		roleOfQuestion: (i) => quiz[i].role,
		sliceOfQuestion: (i) => quiz[i].slice ?? null,
		textOnly: { isChecked: () => false },
	});
	const h = createPassageHandlers(ctx(true));
	const lu = (qi) => { const p = h.resolvePassage(qi); return p ? [p.title, p.text] : null; };
	r.check("explain : la lecture de SON étape", [lu(2), lu(4)],
		[["Les tubes", "Un tube relie la sortie d'une commande à l'entrée de la suivante."], ["Lecture 2", "Les redirections."]]);
	r.check("explain sans lecture dans l'étape : rien", lu(6), null);
	r.check("les autres rôles ne reçoivent pas la lecture", [lu(0), lu(5)], [null, null]);
	r.check("hors Learn : rien", createPassageHandlers(ctx(false)).resolvePassage(2), null);
	r.done();
});
