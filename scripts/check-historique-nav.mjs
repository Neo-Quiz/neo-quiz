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

/* THE LEAVING GUARD OF AN EXAM (`apps/windows/src/ui/leave-guard.ts`, spec
   2026-09-29 §3.4): leaving the quiz screen while an Exam is running asks
   first, and NOTHING moves until the question is answered — "Continue the
   exam" stays, "Leave" leaves, once. */
await withSrcModule("apps/windows/src/ui/leave-guard.ts", ({ createLeaveGuard, setActiveLeaveGuard, clearActiveLeaveGuard, requestLeave }) => {
	const r = makeReporter("Leaving guard of an exam");
	let enCours = false;
	let reponse = null;
	let questions = 0;
	const garde = createLeaveGuard({
		mustAsk: () => enCours,
		ask: (answer) => { questions++; reponse = answer; },
	});
	const departs = [];
	const partir = () => departs.push("left");

	garde.request(partir);
	r.check("no exam running: leaves at once, no question", [departs.length, questions], [1, 0]);

	enCours = true;
	departs.length = 0;
	garde.request(partir);
	r.check("an exam running: asks, and nothing moves before the answer", [departs.length, questions, garde.isAsking()], [0, 1, true]);
	garde.request(partir);
	r.check("a second request while asking: ignored, one question", [departs.length, questions], [0, 1]);
	reponse(false);
	r.check("\"Continue the exam\": stays", [departs.length, garde.isAsking()], [0, false]);

	garde.request(partir);
	reponse(true);
	reponse(true);
	r.check("\"Leave\": leaves, once", [departs.length, questions], [1, 2]);

	/* A RELOAD from outside the quiz screen (Ctrl+R, the View menu, a setting)
	   asks the guard of the screen on display; none on display → at once. */
	const rechargements = [];
	const recharger = () => rechargements.push("reload");
	requestLeave(recharger);
	r.check("no quiz screen on display: the reload goes at once", rechargements.length, 1);
	setActiveLeaveGuard(garde);
	requestLeave(recharger);
	r.check("an exam running on the screen: the reload waits for the answer", [rechargements.length, questions], [1, 3]);
	reponse(false);
	r.check("… and \"Continue the exam\" cancels it", rechargements.length, 1);
	clearActiveLeaveGuard(createLeaveGuard({ mustAsk: () => true, ask: () => {} }));
	requestLeave(recharger);
	r.check("clearing ANOTHER guard leaves the screen's in place", [rechargements.length, questions], [1, 4]);
	reponse(false);
	clearActiveLeaveGuard(garde);
	requestLeave(recharger);
	r.check("the screen gone: reloads go at once again", rechargements.length, 2);
	r.done();
});
