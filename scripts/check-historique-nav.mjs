/**
 * L'HISTORIQUE DE NAVIGATION des boutons de souris — le noyau pur
 * (`apps/windows/src/ui/historique-nav.ts`, `creerHistorique`).
 *
 * Ce que ce script empêche : un « précédent » qui ne ramène pas à la page
 * quittée, un « suivant » qui survit à une nouvelle navigation (on
 * retournerait vers une page qu'on n'a plus devant soi), un doublon qui
 * obligerait à cliquer deux fois pour reculer d'une page, et une pile qui
 * grandit sans fin.
 *
 *     npm run check:historique-nav
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/src/ui/historique-nav.ts", ({ creerHistorique }) => {
	const r = makeReporter("Historique de navigation — boutons de souris");
	const meme = (a, b) => a === b;

	const h = creerHistorique(meme);
	r.check("vide : rien à reculer ni à avancer", [h.reculer("A"), h.avancer("A"), h.peutReculer(), h.peutAvancer()], [null, null, false, false]);

	h.enregistrer("accueil");
	h.enregistrer("mes-quiz");
	r.check("reculer ramène à la page quittée, puis à la précédente",
		[h.reculer("dossier"), h.reculer("mes-quiz"), h.reculer("accueil")], ["mes-quiz", "accueil", null]);
	r.check("avancer refait le chemin inverse",
		[h.avancer("accueil"), h.avancer("mes-quiz"), h.avancer("dossier")], ["mes-quiz", "dossier", null]);

	const g = creerHistorique(meme);
	g.enregistrer("accueil");
	g.reculer("mes-quiz");
	g.enregistrer("accueil");
	r.check("une nouvelle navigation efface le « suivant »", g.peutAvancer(), false);

	const d = creerHistorique(meme);
	d.enregistrer("accueil");
	d.enregistrer("accueil");
	r.check("deux fois le même état : une seule entrée", [d.reculer("x"), d.reculer("accueil")], ["accueil", null]);

	const b = creerHistorique(meme, 3);
	["a", "b", "c", "d", "e"].forEach(e => b.enregistrer(e));
	r.check("la pile arrière est bornée, les plus anciens tombent",
		[b.reculer("f"), b.reculer("e"), b.reculer("d"), b.reculer("c")], ["e", "d", "c", null]);

	r.done();
});
