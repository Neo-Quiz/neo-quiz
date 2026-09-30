/**
 * RESUMABLE CLI RUNS — `apps/windows/electron/resumable-runs.ts`, the
 * registry that lets a generation survive a reload of its page (2026-09-30).
 *
 * What this script prevents: a reload that kills the CLI again (the quota
 * spent for nothing), a reload that leaves it running forever when nobody
 * claims it (the bug of 2026-09-29: an orphan CLI holding its lock), a run
 * attached by ANOTHER window, a result delivered twice, a transcript that
 * loses what was said while the page was reloading, and a window closed
 * without its runs being stopped.
 *
 * Pure: the page is any value, the timers are simulated — no Electron, no
 * process, no waiting.
 *
 *     npm run check:cli-resume
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/electron/resumable-runs.ts", async ({ creerReprises, estCleReprise }) => {
	const r = makeReporter("Resumable CLI runs");

	/* Simulated timers: `avancer` fires the ones that are due. */
	let maintenant = 0;
	let minuteurs = [];
	const minuteries = {
		poser: (fn, ms) => { const m = { fn, a: maintenant + ms, vivant: true }; minuteurs.push(m); return m; },
		annuler: (m) => { m.vivant = false; },
	};
	const avancer = (ms) => {
		maintenant += ms;
		for (const m of minuteurs) if (m.vivant && m.a <= maintenant) { m.vivant = false; m.fn(); }
		minuteurs = minuteurs.filter(m => m.vivant);
	};
	const tick = () => new Promise(res => setTimeout(res, 0));

	/* A fake CLI: it emits what it is told, and ends when told. */
	const faux = () => {
		let emettre = null;
		let finir = null;
		const demarrer = (e) => { emettre = e; return new Promise(res => { finir = res; }); };
		return { demarrer, dire: (t) => emettre(t), finir: (stdout) => finir({ ok: true, stdout, stderr: "", code: 0 }) };
	};

	r.check("key: a plain id is accepted", estCleReprise("abc12345-3-1727700000000"), true);
	r.check("key: too short, a path, or not a string is refused",
		[estCleReprise("abc"), estCleReprise("../../x/abcdefgh"), estCleReprise(42), estCleReprise(undefined)], [false, false, false, false]);

	// 1. An ordinary run, never reloaded: delivered once, nothing held.
	{
		const reg = creerReprises({ delaiMs: 60000, tailleMax: 100, minuteries });
		const cli = faux();
		const vus = [];
		const p = reg.lancer("page", "cle-ordinaire", "E", new AbortController(), cli.demarrer, t => vus.push(t));
		cli.dire("a"); cli.dire("b");
		cli.finir("fini");
		const res = await p;
		r.check("live run: the output is relayed as it comes", vus, ["a", "b"]);
		r.check("live run: the result reaches the caller", res.stdout, "fini");
		r.check("live run: nothing is held afterwards", reg.taille(), 0);
	}

	// 2. The page reloads mid-run, then attaches again: same process, output replayed.
	{
		const reg = creerReprises({ delaiMs: 60000, tailleMax: 100, minuteries });
		const cli = faux();
		const controleur = new AbortController();
		const avant = [];
		void reg.lancer("page", "cle-reload", "E", controleur, cli.demarrer, t => avant.push(t));
		cli.dire("un ");
		reg.detacher("page");
		cli.dire("deux ");
		r.check("detached: the old page hears nothing more", avant, ["un "]);
		r.check("detached: the CLI is NOT stopped", controleur.signal.aborted, false);
		r.check("another window never attaches it", reg.rattacher("autre-page", "cle-reload", "E", null), null);
		const apres = [];
		const rattache = reg.rattacher("page", "cle-reload", "E", t => apres.push(t));
		r.check("the reloaded page attaches to the same run", rattache?.controleur === controleur, true);
		r.check("attached: what was said before AND during the reload is replayed", apres.join(""), "un deux ");
		cli.dire("trois");
		r.check("attached: then the live output follows", apres.join(""), "un deux trois");
		avancer(120000);
		r.check("attached: the delay no longer stops it", controleur.signal.aborted, false);
		cli.finir("quiz");
		r.check("attached: the result reaches the new page", (await rattache.resultat).stdout, "quiz");
		await tick();
		r.check("attached: nothing is held once delivered", reg.taille(), 0);
		r.check("a key is attached once: a second attach finds nothing", reg.rattacher("page", "cle-reload", "E", null), null);
	}

	// 3. The run ENDS while the page is reloading: the result waits for it.
	{
		const reg = creerReprises({ delaiMs: 60000, tailleMax: 100, minuteries });
		const cli = faux();
		void reg.lancer("page", "cle-finie", "E", new AbortController(), cli.demarrer, null);
		reg.detacher("page");
		cli.finir("tenu");
		await tick();
		r.check("ended while detached: the result is held", reg.taille(), 1);
		const rattache = reg.rattacher("page", "cle-finie", "E", null);
		r.check("ended while detached: the reloaded page gets it", (await rattache.resultat).stdout, "tenu");
		r.check("ended while detached: then it is forgotten", reg.taille(), 0);
	}

	// 4. Nobody claims it: stopped after the delay, not before.
	{
		const reg = creerReprises({ delaiMs: 60000, tailleMax: 100, minuteries });
		const cli = faux();
		const controleur = new AbortController();
		void reg.lancer("page", "cle-orpheline", "E", controleur, cli.demarrer, null);
		reg.detacher("page");
		avancer(59000);
		r.check("unclaimed: still running before the delay", controleur.signal.aborted, false);
		avancer(2000);
		r.check("unclaimed: stopped after the delay", controleur.signal.aborted, true);
		r.check("unclaimed: forgotten", [reg.taille(), reg.rattacher("page", "cle-orpheline", "E", null)], [0, null]);
	}

	// 5. The window is destroyed: its runs stop at once, another window's do not.
	{
		const reg = creerReprises({ delaiMs: 60000, tailleMax: 100, minuteries });
		const a = new AbortController();
		const b = new AbortController();
		void reg.lancer("fenetre-1", "cle-fenetre-1", "E", a, faux().demarrer, null);
		void reg.lancer("fenetre-2", "cle-fenetre-2", "E", b, faux().demarrer, null);
		reg.detruire("fenetre-1");
		r.check("destroyed: its run is stopped now, the other window's is not", [a.signal.aborted, b.signal.aborted], [true, false]);
		r.check("destroyed: only the other window's run is held", reg.taille(), 1);
	}

	// 6. The buffer is bounded; the result is not.
	{
		const reg = creerReprises({ delaiMs: 60000, tailleMax: 5, minuteries });
		const cli = faux();
		void reg.lancer("page", "cle-bornee", "E", new AbortController(), cli.demarrer, null);
		cli.dire("abc"); cli.dire("defgh"); cli.dire("ij");
		reg.detacher("page");
		const vus = [];
		const rattache = reg.rattacher("page", "cle-bornee", "E", t => vus.push(t));
		r.check("bounded: the replay stops at the limit, with no hole in the middle", vus.join(""), "abc");
		cli.finir("resultat entier");
		r.check("bounded: the result is whole", (await rattache.resultat).stdout, "resultat entier");
	}

	// 7. A launch that rejects still gives an envelope to whoever attaches.
	{
		const reg = creerReprises({ delaiMs: 60000, tailleMax: 100, minuteries });
		void reg.lancer("page", "cle-rejet", "E", new AbortController(), () => Promise.reject(Object.assign(new Error("tué"), { name: "annule" })), null).catch(() => {});
		reg.detacher("page");
		await tick();
		const rattache = reg.rattacher("page", "cle-rejet", "E", null);
		r.check("a rejection is held as a named envelope", await rattache?.resultat, { ok: false, nom: "annule", message: "tué" });
	}

	// 8. A run still attached is never shared with a second call of the same key.
	{
		const reg = creerReprises({ delaiMs: 60000, tailleMax: 100, minuteries });
		void reg.lancer("page", "cle-partagee", "E", new AbortController(), faux().demarrer, null);
		r.check("still attached: the key is not free", reg.libre("cle-partagee"), false);
		r.check("still attached: not attachable", reg.rattacher("page", "cle-partagee", "E", null), null);
	}

	/* 9. Security review of 2026-09-30: ANOTHER window sending a held key
	   never evicts that run — evicted, it could no longer be detached nor
	   stopped, and would run on with its tool's lock. */
	{
		const reg = creerReprises({ delaiMs: 60000, tailleMax: 100, minuteries });
		const a = new AbortController();
		void reg.lancer("fenetre-1", "cle-convoitee", "E", a, faux().demarrer, null);
		const autre = faux();
		void reg.lancer("fenetre-2", "cle-convoitee", "E", new AbortController(), autre.demarrer, null);
		reg.detruire("fenetre-1");
		r.check("a held key is not overwritten: closing its window still stops it", a.signal.aborted, true);
		r.check("the other window's call ran unregistered", reg.taille(), 0);
	}

	// 10. An attach must ask the same thing: another request never gets this answer.
	{
		const reg = creerReprises({ delaiMs: 60000, tailleMax: 100, minuteries });
		void reg.lancer("page", "cle-empreinte", "quiz CM1", new AbortController(), faux().demarrer, null);
		reg.detacher("page");
		r.check("fingerprint: a different request is not attached", reg.rattacher("page", "cle-empreinte", "quiz CM2", null), null);
		r.check("fingerprint: the same request is", reg.rattacher("page", "cle-empreinte", "quiz CM1", null) !== null, true);
	}

	r.done();
});
