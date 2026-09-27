/**
 * LES CHANGEMENTS D'ÉCRAN PENDANT UNE TRANSITION — le noyau pur
 * `apps/windows/src/ui/transition-etat.ts`, qui décide du sort d'une demande
 * (lancer un quiz, en revenir) arrivée pendant les 500 ms de la transition
 * de lancement (`ui/transition-quiz.ts`).
 *
 * Ce que ce script empêche :
 *   - un double clic sur « Commencer le quiz » qui lancerait deux moteurs, ou
 *     sur la flèche retour qui remonterait deux coquilles ;
 *   - un retour cliqué pendant que le quiz monte, AVALÉ en silence : il doit
 *     partir à la fin de l'entrée ;
 *   - une fin jouée deux fois (le dernier `finish`, la fenêtre masquée et le
 *     minuteur de secours peuvent tous y mener) : la même vue démontée deux
 *     fois, ou l'écran qu'on vient de monter retiré avec les sortants ;
 *   - une transition animée dans une fenêtre MASQUÉE, dont la fin dépendrait
 *     d'images qui ne sont jamais peintes.
 *
 *     npm run check:transition
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/src/ui/transition-etat.ts", ({ etatInitial, demander, finir, choisirMode, uneFois, vuesARetirer }) => {
	const r = makeReporter("Transition d'écran — noyau pur");

	{
		let e = etatInitial();
		const a = demander(e, { sens: "ouvrir", donnee: "quiz A" });
		r.check("au repos, ouvrir part tout de suite", a.action, "lancer");
		e = a.etat;
		r.check("… et la transition d'entrée est en cours", e.enCours, "ouvrir");

		const b = demander(e, { sens: "ouvrir", donnee: "quiz A" });
		r.check("double clic sur lancer pendant l'entrée : ignoré", b.action, "ignorer");
		r.check("… sans rien mettre en file", b.etat.enFile, null);
		e = b.etat;

		const c = demander(e, { sens: "retour", donnee: "retour 1" });
		r.check("retour pendant l'entrée : mis en file", c.action, "enfiler");
		e = c.etat;
		r.check("… la transition en cours n'est pas interrompue", e.enCours, "ouvrir");

		const d = demander(e, { sens: "retour", donnee: "retour 2" });
		r.check("second retour pendant l'entrée : ignoré (double clic)", d.action, "ignorer");
		r.check("… la file garde le premier", d.etat.enFile?.donnee, "retour 1");
		e = d.etat;

		const f = finir(e);
		r.check("fin de l'entrée : le retour en file ressort", f.suivante, { sens: "retour", donnee: "retour 1" });
		r.check("… et l'état revient au repos, file vide", f.etat, { enCours: null, enFile: null });

		const g = demander(f.etat, f.suivante);
		r.check("le retour resoumis au repos part", g.action, "lancer");
		r.check("… en transition de sortie", g.etat.enCours, "retour");

		const h = demander(g.etat, { sens: "ouvrir", donnee: "quiz B" });
		r.check("lancer pendant la sortie : mis en file", h.action, "enfiler");
		const i = finir(h.etat);
		r.check("fin de la sortie : le lancement en file ressort", i.suivante?.donnee, "quiz B");
	}
	{
		const f = finir(etatInitial());
		r.check("finir sans rien en file : aucune suite", f.suivante, null);
	}

	r.check("mouvement normal, fenêtre visible : animé", choisirMode(false, false), "anime");
	r.check("fenêtre masquée : état final direct", choisirMode(false, true), "immediat");
	r.check("mouvement réduit : état final direct", choisirMode(true, false), "immediat");

	{
		let n = 0;
		const fin = uneFois(() => { n++; });
		fin(); fin(); fin();
		r.check("la fin ne s'exécute qu'une fois, quel que soit le nombre de chemins", n, 1);
	}

	r.check("les sortants sont retirés", vuesARetirer(["coquille"], ["quiz"]), ["coquille"]);
	r.check("une vue listée deux fois n'est retirée qu'une fois", vuesARetirer(["coquille", "coquille"], ["quiz"]), ["coquille"]);
	r.check("la vue utile n'est jamais retirée, même listée parmi les sortants", vuesARetirer(["coquille", "quiz"], ["quiz"]), ["coquille"]);

	/* LA PILE DE FEUILLES (2026-09-27) : lancer un quiz depuis la coquille ne
	   la démonte plus, elle est GARDÉE (`main.ts`, `vueGardee`) — `ui/transition-
	   quiz.ts` l'ajoute à la liste des vues « utiles » de `vuesARetirer`, au même
	   titre que l'entrant, pour qu'elle ne soit jamais retirée du DOM. */
	r.check("une vue GARDÉE n'est jamais retirée, même seule sortante", vuesARetirer(["coquille"], ["quiz", "coquille"]), []);
	r.check("… la vue gardée protège aussi une AUTRE sortante", vuesARetirer(["coquille", "reglages"], ["quiz", "coquille"]), ["reglages"]);
	r.check("retour vers une vue gardée : elle redevient l'entrante, seul le quiz est retiré", vuesARetirer(["coquille", "quiz"], ["coquille"]), ["quiz"]);

	r.done();
});
