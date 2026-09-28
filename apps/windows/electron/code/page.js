/* THE SANDBOX PAGE: receives a job from the main process (through the
   preload `window.neoCode`), passes it to the right worker, renders the
   result. One job at a time: the main process queues them.

   ONE WORKER FILE PER LANGUAGE (`worker-${job.language}.mjs`), and ONE FRESH
   WORKER PER TRIAL, per language (security review 2026-09-27, I1-I3, still
   true once more languages join): a REUSED interpreter would let a hostile
   quiz patch `pyodide.code` or `builtins` and taint every later trial (I1),
   leave an asyncio task running past the end of the trial (I2), or stay
   stuck for good after `os._exit(0)` (I3). Each worker is therefore
   TERMINATED as soon as its result is rendered (or at the deadline), and the
   next worker for that language is pre-warmed right away: the reload (~1 s)
   happens while the student reads the result. */
"use strict";
const PLAFOND = 20000;
/* Loading the language runtime has its own budget (M7): the TRIAL's own
   deadline only starts at the worker's "ready" message, never before —
   otherwise a short deadline (minimum 100 ms) would expire during
   `loadPyodide` and the worker, killed, would restart from zero without
   ever running. */
const DELAI_CHARGEMENT_MS = 30000;

/* `c` and `cpp` both point at the Clang/WASM worker (task 8); an unknown
   language is refused before any worker is ever created. */
const LANGUES = { python: "worker-python.mjs", c: "worker-clang.mjs", cpp: "worker-clang.mjs" };
const prets = new Map(); // language -> the worker warmed for its NEXT job
const nouveauWorker = (langue) => new Worker(LANGUES[langue], { type: "module" });
const preparer = (langue) => { let w = prets.get(langue); if (!w) { w = nouveauWorker(langue); prets.set(langue, w); } return w; };
const chauffer = (langue) => { if (Object.hasOwn(LANGUES, langue)) preparer(langue).postMessage({ type: "chauffer" }); };

/* Defence in depth (M2, then security review 2026-09-28): the page never
   forwards what a worker posted as it came. The result is REBUILT from an
   allowlist — the three fields the main process reads
   (`normaliserResultat`), each typed and capped — so a worker (which runs
   the quiz's code) cannot smuggle an extra field, a huge `stdout` or a
   non-string across the IPC boundary. */
const borner = (res) => ({
	/* Never `String(res.status)`: an object whose `toString` is not a
	   function makes it throw, and the result would never be sent. */
	status: typeof res?.status === "string" ? res.status.slice(0, 32) : "error",
	stdout: typeof res?.stdout === "string" ? res.stdout.slice(0, PLAFOND) : "",
	...(typeof res?.error === "string" ? { error: res.error.slice(0, PLAFOND) } : {}),
});

window.neoCode.surChauffe(chauffer);

window.neoCode.surTravail((job) => {
	if (!Object.hasOwn(LANGUES, job.language)) { window.neoCode.rendre(job.id, { status: "unavailable", stdout: "" }); return; }
	const w = preparer(job.language);
	prets.delete(job.language); // CONSUMED: never reused for another trial
	let fini = false;
	let minuterieEssai = null;
	const finir = (res) => {
		if (fini) return;
		fini = true;
		clearTimeout(minuterieChargement);
		if (minuterieEssai) clearTimeout(minuterieEssai);
		w.removeEventListener("message", surMessage);
		w.removeEventListener("error", surErreur);
		w.terminate(); // kills any code still alive (I1, I2), even on success
		chauffer(job.language); // pre-warm the next worker while the student reads the result
		window.neoCode.rendre(job.id, borner(res));
	};
	const surMessage = (e) => {
		if (!e.data || e.data.id !== job.id) return;
		if (e.data.type === "pret") {
			/* Loading is done: hand off to the trial's own deadline, and tell
			   the main process (N1 bis) so it only arms its own fallback from
			   here — never during the language runtime's loading. */
			clearTimeout(minuterieChargement);
			minuterieEssai = setTimeout(() => finir({ status: "timeout", stdout: "" }), job.timeoutMs);
			window.neoCode.pret(job.id);
			return;
		}
		finir(e.data.res);
	};
	/* A fatal runtime (I3: `os._exit(0)`, WASM abort) closes the worker
	   without a message: without this net, the trial would never get an
	   answer. */
	const surErreur = () => finir({ status: "error", stdout: "", error: "worker" });
	w.addEventListener("message", surMessage);
	w.addEventListener("error", surErreur);
	const minuterieChargement = setTimeout(() => finir({ status: "timeout", stdout: "" }), DELAI_CHARGEMENT_MS);
	w.postMessage({ type: "executer", id: job.id, language: job.language, code: job.code, stdin: job.stdin, after: job.after || "" });
});
