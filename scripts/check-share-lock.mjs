/**
 * THE SHARE LOCK (`apps/windows/electron/partage.ts`), on a fake clock and a
 * fake child process: nothing is launched, no panel is opened.
 *
 * What it prevents: "A share is already in progress" staying on screen with
 * no panel (desktop 1.20.42). The lock was released only when PowerShell
 * exited, and the script waited for a `ShareCanceled` event that
 * `DataTransferManager` does not have, so a dismissed panel held the lock for
 * up to six minutes. Every outcome must release the lock exactly once, the
 * hard bounds must hold, and the answer to the window must be true.
 *     npm run check:share-lock
 */
import { EventEmitter } from "node:events";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/electron/partage.ts", async ({ lancerPartageNatif, creerVerrou, verrouNatif, verrouSync, creerPartageFichier, scriptPartageNatif, BORNE_SANS_SIGNAL_MS, BORNE_TOTALE_MS }) => {
	const r = makeReporter("Share lock - released on every outcome");

	/** A fake clock: timers fire when `avancer` passes them. */
	const horloge = () => {
		let now = 0; let id = 0; const tim = new Map();
		return {
			set: (f, ms) => { tim.set(++id, { f, at: now + ms }); return id; },
			clear: (h) => { tim.delete(h); },
			avancer(ms) {
				const cible = now + ms;
				for (;;) {
					const due = [...tim.entries()].filter(([, v]) => v.at <= cible).sort((a, b) => a[1].at - b[1].at)[0];
					if (!due) break;
					now = due[1].at; tim.delete(due[0]); due[1].f();
				}
				now = cible;
			},
			get restants() { return tim.size; },
		};
	};
	const faux = () => {
		const e = new EventEmitter();
		e.stdout = new EventEmitter(); e.stderr = new EventEmitter();
		e.tue = 0; e.kill = () => { e.tue++; };
		return e;
	};
	/** Runs one share against a fake child; `jouer(child, clock)` plays the outcome. */
	const essai = async (jouer, { sync = false } = {}) => {
		const h = horloge(); const e = faux(); let liberations = 0; let montre = 0;
		const p = lancerPartageNatif({ titre: "t", fichier: "C:/x.md" }, () => { liberations++; }, { lancer: () => e, minuteur: h, surMontre: () => { montre++; } });
		let resultat; p.then(x => { resultat = x; });
		await jouer(e, h);
		await Promise.resolve(); await Promise.resolve();
		return { resultat, liberations, tue: e.tue, montre, timersRestants: h.restants };
	};
	const dit = (e, s) => e.stdout.emit("data", Buffer.from(s));

	const spawnError = await essai((e) => e.emit("error", new Error("ENOENT")));
	r.check("spawn error: lock released once, answer is false", [spawnError.liberations, spawnError.resultat?.ok, spawnError.resultat?.raison], [1, false, "lancement"]);

	const early = await essai((e) => e.emit("exit", 0));
	r.check("exit before the panel is shown: released once, answer false", [early.liberations, early.resultat?.ok], [1, false]);

	const nonZero = await essai((e) => { e.stderr.emit("data", "boom"); e.emit("exit", 1); e.emit("close", 1); });
	r.check("non-zero exit with stderr: released once (exit and close both fire), the message is kept", [nonZero.liberations, nonZero.resultat?.ok, nonZero.resultat?.message], [1, false, "boom"]);

	const errSignal = await essai((e) => dit(e, "ERROR:WinRT unavailable\r\n"));
	r.check("ERROR signal: released at once, process killed, real message returned", [errSignal.liberations, errSignal.tue, errSignal.resultat?.message], [1, 1, "WinRT unavailable"]);

	const shown = await essai((e) => { dit(e, "SHOWN\n"); });
	r.check("SHOWN: answered true, lock still held while the panel is open", [shown.resultat?.ok, shown.liberations, shown.montre], [true, 0, 1]);

	const shownThenExit = await essai((e) => { dit(e, "SHOWN\n"); e.emit("exit", 0); });
	r.check("SHOWN then exit (panel dismissed, script ended): released once, answer stays true", [shownThenExit.resultat?.ok, shownThenExit.liberations], [true, 1]);

	const split = await essai((e) => { dit(e, "SHO"); dit(e, "WN\r"); dit(e, "\nCHOSEN\n"); });
	r.check("a signal split across chunks is still read", split.resultat?.ok, true);

	const noSignal = await essai((e, h) => h.avancer(BORNE_SANS_SIGNAL_MS));
	r.check("no SHOWN within 30 s: killed, released, answer false (timeout)", [noSignal.liberations, noSignal.tue, noSignal.resultat?.ok, noSignal.resultat?.raison], [1, 1, false, "delai"]);

	const justBefore = await essai((e, h) => h.avancer(BORNE_SANS_SIGNAL_MS - 1));
	r.check("one ms before the bound nothing is released yet", [justBefore.liberations, justBefore.resultat], [0, undefined]);

	const longOpen = await essai((e, h) => { dit(e, "SHOWN\n"); h.avancer(BORNE_TOTALE_MS - 1); });
	r.check("panel open: still held one ms before 90 s", longOpen.liberations, 0);
	const hard = await essai((e, h) => { dit(e, "SHOWN\n"); h.avancer(BORNE_TOTALE_MS); });
	r.check("panel open (or dismissed without any event): killed and released at 90 s, never later", [hard.liberations, hard.tue], [1, 1]);

	const exitAfterTimeout = await essai((e, h) => { h.avancer(BORNE_SANS_SIGNAL_MS); e.emit("exit", 1); e.emit("close", 1); });
	r.check("the exit that follows a timeout kill does not release a second time", exitAfterTimeout.liberations, 1);

	const clean = await essai((e) => { dit(e, "SHOWN\n"); e.emit("exit", 0); });
	r.check("timers are cleared once released (nothing left to fire later)", clean.timersRestants, 0);

	// Launch itself throwing.
	{
		const h = horloge(); let lib = 0;
		const res = await lancerPartageNatif({ titre: "t", fichier: "x" }, () => { lib++; }, { lancer: () => { throw new Error("EACCES"); }, minuteur: h });
		r.check("a launch that throws: released once, answer false", [lib, res.ok, res.raison], [1, false, "lancement"]);
	}

	// The lock itself.
	let t = 0; let reprises = 0;
	const v = creerVerrou(BORNE_TOTALE_MS, 0, () => t, () => { reprises++; });
	const j1 = v.prendre();
	t = 10;
	r.check("held: a second take is refused", v.prendre(), null);
	t = BORNE_TOTALE_MS;
	const j2 = v.prendre();
	r.check("after the bound the next click takes the lock over, and it is logged", [j2 !== null, reprises], [true, 1]);
	v.rendre(j1);
	r.check("the late release of the old holder does not free the new one", v.prendre(), null);
	v.rendre(j2);
	t += 1;
	r.check("no minimum spacing: released, the next take is immediate (no false toast)", v.prendre() !== null, true);

	// The two production locks are separate objects with the bound.
	const jn = verrouNatif.prendre();
	r.check("the sync-ID lock is separate from the file lock", [jn !== null, verrouSync.prendre() !== null], [true, true]);
	verrouNatif.rendre(jn);
	const jn2 = verrouNatif.prendre();
	r.check("the production file lock has no spacing: released then taken again at once", jn2 !== null, true);
	verrouNatif.rendre(jn2);
	r.check("hard bounds are 30 s and 90 s", [BORNE_SANS_SIGNAL_MS, BORNE_TOTALE_MS], [30_000, 90_000]);

	/* A NEW click while the previous panel is still held. The panel may have been
	   closed without choosing an app (no event says so), so after SHOWN a click
	   replaces the old share instead of answering "busy". */
	{
		const h = horloge();
		const enfants = [];
		const tues = [];
		let lancements = 0; let liberations = 0;
		const lancerFaux = () => { const e = faux(); e.pid = 1000 + lancements++; enfants.push(e); return e; };
		const lanceur = (p, fin, deps) => lancerPartageNatif(p, fin, { ...deps, lancer: lancerFaux, minuteur: h, tuerArbre: (pid) => tues.push(pid) });
		const verrou = creerVerrou(BORNE_TOTALE_MS, 0, () => 0);
		const verrouEspion = { prendre: () => verrou.prendre(), rendre: (j) => { liberations++; verrou.rendre(j); } };
		const ctrl = creerPartageFichier({ verrou: verrouEspion, ecrire: async (nom) => `C:/tmp/${nom}`, lancer: lanceur });
		const attendre = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

		const p1 = ctrl.demander("a.zip", new Uint8Array([1]));
		const p1bis = ctrl.demander("a.zip", new Uint8Array([1]));
		await attendre();
		r.check("a double click BEFORE the panel is shown joins the call: one process, no error", lancements, 1);
		dit(enfants[0], "SHOWN\n");
		await attendre();
		const [ok1, ok1bis] = await Promise.all([p1, p1bis]);
		r.check("both calls of the double click get the same true answer", [ok1, ok1bis], [true, true]);

		const p2 = ctrl.demander("b.zip", new Uint8Array([2]));
		await attendre();
		r.check("a NEW click after SHOWN does not answer busy: the old process tree is killed (kill and taskkill) and a new one started",
			[lancements, enfants[0].tue, tues, liberations], [2, 1, [1000], 1]);
		dit(enfants[1], "SHOWN\n");
		await attendre();
		r.check("the new share is the one holding the lock, and it resolves true", [await p2, verrou.prendre()], [true, null]);

		enfants[0].emit("exit", 1);
		await attendre();
		r.check("the late exit of the killed process does not release the new share's lock", verrou.prendre(), null);
		enfants[1].emit("exit", 0);
		await attendre();
		const p3 = ctrl.demander("c.zip", new Uint8Array([3]));
		await attendre();
		r.check("after the panel is over the next click starts at once", lancements, 3);
		dit(enfants[2], "SHOWN\n");
		await attendre();
		await p3;
		// A lock held by something that is not a share of ours stays "busy".
		const autre = creerVerrou(BORNE_TOTALE_MS, 0, () => 0);
		autre.prendre();
		const ctrl2 = creerPartageFichier({ verrou: autre, ecrire: async (n) => n, lancer: lanceur });
		let message = "";
		try { await ctrl2.demander("d.zip", new Uint8Array([4])); } catch (e) { message = String(e.message); }
		r.check("a lock held by something else (no share of ours to replace) still answers busy", message, "partage-occupe");
	}

	// The script reports its state and stays constant.
	const s = scriptPartageNatif();
	r.check("the script signals SHOWN, CHOSEN and ERROR on stdout", ["'SHOWN'", "'CHOSEN'", "'ERROR:'"].every(x => s.includes(x)), true);
	r.check("the script no longer waits for an event that does not exist", s.includes("ShareCanceled"), false);
	r.done();
});
