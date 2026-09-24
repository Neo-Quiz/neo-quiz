/* LA PAGE DU BAC À SABLE : reçoit un travail du principal (par le
   préchargement `window.neoPython`), le passe au worker, rend le résultat.
   Un travail à la fois : le principal les met en file. Le délai est tenu
   ICI (worker.terminate), le principal n'a qu'un délai de secours. */
"use strict";
let worker = null;
const nouveauWorker = () => new Worker("worker.mjs", { type: "module" });
const assurer = () => { if (!worker) worker = nouveauWorker(); return worker; };

window.neoPython.surChauffe(() => { assurer().postMessage({ type: "chauffer" }); });

window.neoPython.surTravail((job) => {
	const w = assurer();
	let fini = false;
	const finir = (res) => {
		if (fini) return;
		fini = true;
		clearTimeout(minuterie);
		w.removeEventListener("message", surMessage);
		window.neoPython.rendre(job.id, res);
	};
	const surMessage = (e) => { if (e.data && e.data.id === job.id) finir(e.data.res); };
	w.addEventListener("message", surMessage);
	const minuterie = setTimeout(() => {
		/* Boucle infinie : on TUE le worker. Le prochain travail en recrée
		   un, qui recharge Python (~1 s, mesuré). */
		w.terminate();
		worker = null;
		finir({ status: "timeout", stdout: "" });
	}, job.timeoutMs);
	w.postMessage({ type: "executer", id: job.id, code: job.code, stdin: job.stdin, after: job.after || "" });
});
