/* LA PAGE DU BAC À SABLE : reçoit un travail du principal (par le
   préchargement `window.neoPython`), le passe au worker, rend le résultat.
   Un travail à la fois : le principal les met en file.

   UN WORKER NEUF PAR ESSAI (revue de sécurité 2026-09-27, I1-I3) : un
   interpréteur RÉUTILISÉ laisse un quiz hostile patcher `pyodide.code` ou
   `builtins` et fausser tous les essais suivants (I1), laisser une tâche
   asyncio tourner après la fin de l'essai (I2), ou rester bloqué pour de bon
   après `os._exit(0)` (I3). Le worker est donc TERMINÉ dès le résultat rendu
   (ou au délai), et un worker suivant est préchauffé tout de suite : la
   recharge (~1 s) se fait pendant que l'élève lit le résultat. */
"use strict";
const PLAFOND = 20000;
/* Le chargement de Pyodide a son propre budget (M7) : le délai de l'ESSAI ne
   démarre qu'au message « pret » du worker, jamais avant — sinon un délai
   court (minimum 100 ms) expire pendant `loadPyodide` et le worker, tué,
   repart de zéro sans jamais exécuter. */
const DELAI_CHARGEMENT_MS = 30000;

let worker = null; // le worker PRÉCHAUFFÉ, prêt pour le PROCHAIN essai
const nouveauWorker = () => new Worker("worker.mjs", { type: "module" });
const preparer = () => { if (!worker) worker = nouveauWorker(); return worker; };
const chauffer = () => { preparer().postMessage({ type: "chauffer" }); };

/* Défense en profondeur (M2) : re-tronquer ici aussi, même si le worker l'a
   déjà fait — la page ne doit jamais transmettre une erreur sans plafond. */
const borner = (res) => {
	if (res && typeof res.error === "string" && res.error.length > PLAFOND) {
		return { ...res, error: res.error.slice(0, PLAFOND) };
	}
	return res;
};

window.neoPython.surChauffe(chauffer);

window.neoPython.surTravail((job) => {
	const w = preparer();
	worker = null; // ce worker est CONSOMMÉ : jamais réutilisé pour un autre essai
	let fini = false;
	let minuterieEssai = null;
	const finir = (res) => {
		if (fini) return;
		fini = true;
		clearTimeout(minuterieChargement);
		if (minuterieEssai) clearTimeout(minuterieEssai);
		w.removeEventListener("message", surMessage);
		w.removeEventListener("error", surErreur);
		w.terminate(); // tue tout code encore vivant (I1, I2), même sur un succès
		chauffer(); // préchauffe le prochain worker pendant que l'élève lit le résultat
		window.neoPython.rendre(job.id, borner(res));
	};
	const surMessage = (e) => {
		if (!e.data || e.data.id !== job.id) return;
		if (e.data.type === "pret") {
			/* Chargement fini : place au délai de l'essai lui-même. */
			clearTimeout(minuterieChargement);
			minuterieEssai = setTimeout(() => finir({ status: "timeout", stdout: "" }), job.timeoutMs);
			return;
		}
		finir(e.data.res);
	};
	/* Un Pyodide fatal (I3 : `os._exit(0)`, abort WASM) ferme le worker sans
	   message : sans ce filet, l'essai n'aurait jamais de réponse. */
	const surErreur = () => finir({ status: "error", stdout: "", error: "worker" });
	w.addEventListener("message", surMessage);
	w.addEventListener("error", surErreur);
	const minuterieChargement = setTimeout(() => finir({ status: "timeout", stdout: "" }), DELAI_CHARGEMENT_MS);
	w.postMessage({ type: "executer", id: job.id, code: job.code, stdin: job.stdin, after: job.after || "" });
});
