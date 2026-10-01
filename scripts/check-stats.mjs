/**
 * L'HISTORIQUE DES TENTATIVES du magasin de stats (`src/dashboard/stats-store.ts`).
 * Ce qu'il empêche : un meilleur score qui ne redescend pas quand on supprime
 * la tentative qui le portait, un score d'avant l'historique perdu ou
 * impossible à supprimer, une annulation qui ne remet pas l'état d'avant.
 *     npm run check:stats
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/stats-store.ts", ({ createStatsStore, tentativesDe, MAX_TENTATIVES }) => {
	const r = makeReporter("Stats — historique des tentatives");
	const fabriquer = (initial = {}) => {
		let ecrit = null;
		const store = createStatsStore({ getStats: () => structuredClone(initial), saveStats: async (d) => { ecrit = d; } });
		store.load();
		return { store, ecrit: () => ecrit };
	};

	const { store } = fabriquer();
	store.updateRecord("a.md", { bestScore: 40, questionsDone: 5, totalQuestions: 10 });
	store.updateRecord("a.md", { bestScore: 80, questionsDone: 8, totalQuestions: 10 });
	store.updateRecord("a.md", { bestScore: 60, questionsDone: 7, totalQuestions: 10 });
	const a = store.getRecord("a.md");
	r.check("trois tentatives gardées", a.tentatives.length, 3);
	r.check("meilleur score et tentatives dérivés", [a.bestScore, a.attempts], [80, 3]);
	const la80 = a.tentatives.find(x => x.pct === 80);
	const retiree = store.supprimerTentative("a.md", la80.date);
	r.check("supprimer rend la tentative retirée", retiree?.pct, 80);
	r.check("le meilleur redescend à la suivante", store.getRecord("a.md").bestScore, 60);
	r.check("le nombre de tentatives suit", store.getRecord("a.md").attempts, 2);
	store.restaurerTentative("a.md", retiree);
	r.check("annuler remet le meilleur", [store.getRecord("a.md").bestScore, store.getRecord("a.md").attempts, store.getRecord("a.md").questionsDone], [80, 3, 8]);
	for (const x of [...store.getRecord("a.md").tentatives]) store.supprimerTentative("a.md", x.date);
	const vide = store.getRecord("a.md");
	r.check("plus aucune tentative : 0 %, 0 tentative, 0 question faite", [vide.bestScore, vide.attempts, vide.questionsDone], [0, 0, 0]);
	r.check("supprimer une date inconnue ne fait rien", store.supprimerTentative("a.md", 12345), null);

	const { store: s2 } = fabriquer({ "b.md": { bestScore: 0, questionsDone: 3, totalQuestions: 10, lastPlayed: 1000, attempts: 3 } });
	r.check("un score d'avant l'historique se lit comme une tentative", tentativesDe(s2.getRecord("b.md")), [{ date: 1000, pct: 0, ancienne: true }]);
	r.check("et se supprime", s2.supprimerTentative("b.md", 1000)?.ancienne, true);
	r.check("il ne reste rien", [s2.getRecord("b.md").attempts, s2.getRecord("b.md").bestScore], [0, 0]);

	const { store: s3 } = fabriquer({ "c.md": { bestScore: 70, questionsDone: 3, totalQuestions: 10, lastPlayed: 500, attempts: 2 } });
	s3.updateRecord("c.md", { bestScore: 50, questionsDone: 4, totalQuestions: 10 });
	const c = s3.getRecord("c.md");
	r.check("l'ancien score devient la première tentative de la liste", c.tentatives.map(x => x.ancienne === true), [false, true]);
	r.check("le meilleur tient compte de l'ancien", c.bestScore, 70);

	const { store: s6 } = fabriquer();
	s6.updateRecord("f.md", { bestScore: 50, questionsDone: 5, totalQuestions: 10 });
	const seule = s6.supprimerTentative("f.md", s6.getRecord("f.md").tentatives[0].date);
	r.check("supprimer la seule tentative : 0 question faite", s6.getRecord("f.md").questionsDone, 0);
	s6.restaurerTentative("f.md", seule);
	r.check("annuler cette suppression rend l'avancement", s6.getRecord("f.md").questionsDone, 5);

	const { store: s7 } = fabriquer({ "g.md": { bestScore: 90, questionsDone: 2, totalQuestions: 2, lastPlayed: 3000, attempts: 3,
		tentatives: [{ date: 3000, pct: 90 }, { date: 2000, pct: 40 }, { date: 1000, pct: 10 }] } });
	s7.supprimerTentative("g.md", 3000);
	r.check("la dernière partie jouée suit la tentative restante la plus récente", s7.getRecord("g.md").lastPlayed, 2000);
	s7.supprimerTentative("g.md", 2000);
	s7.supprimerTentative("g.md", 1000);
	r.check("plus aucune tentative : dernière partie à 0", s7.getRecord("g.md").lastPlayed, 0);

	const { store: s4 } = fabriquer();
	s4.updateRecord("d.md", { bestScore: 0, questionsDone: 4, totalQuestions: 4, texteLibre: true });
	r.check("réponses libres : pourcentage nul (null)", s4.getRecord("d.md").tentatives[0].pct, null);
	r.check("réponses libres : meilleur score 0", s4.getRecord("d.md").bestScore, 0);

	const { store: s5 } = fabriquer();
	s5.updateRecord("e.md", { bestScore: 95, questionsDone: 1, totalQuestions: 1 });
	for (let i = 0; i < MAX_TENTATIVES + 5; i++) s5.updateRecord("e.md", { bestScore: 10, questionsDone: 1, totalQuestions: 1 });
	const e = s5.getRecord("e.md");
	r.check("plafond de tentatives", e.tentatives.length, MAX_TENTATIVES);
	r.check("la meilleure est toujours gardée", e.bestScore, 95);
	r.check("tentativesDe : du plus récent au plus ancien", tentativesDe(e)[0].date >= tentativesDe(e)[1].date, true);

	/* A Test's attempt keeps its right answers found with a hint (spec
	   2026-09-29 §2.2) — through a deletion and its undo too; none, no field. */
	const { store: sAide } = fabriquer();
	sAide.updateRecord("g.md", { bestScore: 80, questionsDone: 15, totalQuestions: 15, withHint: 2 });
	sAide.updateRecord("g.md", { bestScore: 60, questionsDone: 15, totalQuestions: 15, withHint: 0 });
	const [sansAide, avecAide] = tentativesDe(sAide.getRecord("g.md"));
	r.check("an attempt keeps its hint count, and has none without a hint", [avecAide.withHint, "withHint" in sansAide], [2, false]);
	const retireeAide = sAide.supprimerTentative("g.md", avecAide.date);
	sAide.restaurerTentative("g.md", retireeAide);
	r.check("… through a deletion and its undo", tentativesDe(sAide.getRecord("g.md")).find(x => x.date === avecAide.date)?.withHint, 2);

	/* An attempt played in Exam mode (hints off + a time limit, spec
	   2026-09-29-test-setup-modal-design.md §3) says so; any other attempt has
	   no field — through a deletion and its undo too. */
	const { store: sExamen } = fabriquer();
	sExamen.updateRecord("h.md", { bestScore: 70, questionsDone: 10, totalQuestions: 10, exam: true });
	sExamen.updateRecord("h.md", { bestScore: 50, questionsDone: 10, totalQuestions: 10, exam: false });
	const [normale, examen] = tentativesDe(sExamen.getRecord("h.md"));
	r.check("an Exam attempt is marked, a plain one is not", [examen.exam, "exam" in normale], [true, false]);
	const retireeExamen = sExamen.supprimerTentative("h.md", examen.date);
	sExamen.restaurerTentative("h.md", retireeExamen);
	r.check("… through a deletion and its undo", tentativesDe(sExamen.getRecord("h.md")).find(x => x.date === examen.date)?.exam, true);

	/* RELOAD (the synced folder delivered other devices' attempts): the store
	   takes the host's table again, UNLESS a save of its own is still pending:
	   reloading then would drop the attempt that save is about to write. */
	let table = { "r.md": { bestScore: 10, questionsDone: 1, totalQuestions: 2, lastPlayed: 5, attempts: 1, tentatives: [{ date: 5, pct: 10 }] } };
	const sRecharge = createStatsStore({ getStats: () => structuredClone(table), saveStats: async () => {} });
	sRecharge.load();
	table = { ...table, "r.md": { ...table["r.md"], attempts: 2, tentatives: [{ date: 9, pct: 90 }, { date: 5, pct: 10 }] } };
	r.check("reload with nothing pending takes the host's table", [sRecharge.reload(), sRecharge.getRecord("r.md").attempts], [true, 2]);
	sRecharge.updateRecord("r.md", { bestScore: 40, questionsDone: 2, totalQuestions: 2 });
	table = { ...table, "other.md": { bestScore: 1, questionsDone: 1, totalQuestions: 1, lastPlayed: 1, attempts: 1, tentatives: [{ date: 1, pct: 1 }] } };
	r.check("reload with a save pending refuses and keeps the pending attempt", [sRecharge.reload(), sRecharge.getRecord("r.md").attempts, sRecharge.getRecord("other.md")], [false, 3, null]);
	sRecharge.destroy();
	r.done();
});
