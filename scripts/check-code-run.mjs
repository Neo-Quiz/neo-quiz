/**
 * Le bouton « Exécuter » d'un bloc de code (src/engine/code-run.ts) — cas de
 * contrôle M4 de la revue du 2026-09-27 : la sortie d'un programme (stdout
 * ou erreur) est du texte dont l'auteur du quiz n'est pas forcément maître
 * (un quiz PARTAGÉ est hostile). Ce script charge le VRAI module avec un
 * `HostCode` factice dont `run()` renvoie une charge HTML, et vérifie que
 * rien de tel n'apparaît jamais comme ÉLÉMENT sous `.quiz-code-output` —
 * seulement comme texte, posé par `textContent`.
 *
 *     npm run check:code-run
 */
import { parseHTML } from "linkedom";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const { document } = parseHTML("<html><body></body></html>");
globalThis.document = document;

await withSrcModule(["src/engine/code-run.ts"], async ({ createCodeRunHandlers }) => {
	const r = makeReporter("Bouton « Exécuter » — sortie jamais interprétée (M4)");

	const CHARGE = '<img src=x onerror=alert(1)>';

	function fabriquerBloc() {
		const container = document.createElement("div");
		container.innerHTML =
			`<div class="quiz-code-block quiz-code-block-executable">` +
			`<div class="quiz-code-toolbar"><button type="button" class="quiz-code-run-btn" data-quiz-code-run hidden></button></div>` +
			`<pre class="quiz-md-code"><code>print("x")</code></pre>` +
			`<div class="quiz-code-output" hidden></div></div>`;
		return container;
	}

	async function executerEtLireSortie(resultat) {
		const container = fabriquerBloc();
		const ctx = { container, host: { code: { languages: () => ["python"], run: async () => resultat, warm: () => {} } } };
		const { bindCodeRunButtons } = createCodeRunHandlers(ctx);
		bindCodeRunButtons();
		const btn = container.querySelector(".quiz-code-run-btn");
		btn.dispatchEvent(new document.defaultView.Event("click"));
		// `executer` est asynchrone (un seul `await`) : laisser le microtâche courir.
		await new Promise(res => setTimeout(res, 0));
		await new Promise(res => setTimeout(res, 0));
		return container.querySelector(".quiz-code-output");
	}

	const sortieOk = await executerEtLireSortie({ status: "ok", stdout: CHARGE });
	r.check("stdout hostile : aucun <img> comme élément", sortieOk.querySelector("img"), null);
	r.check("stdout hostile : le texte brut reste lisible en textContent", sortieOk.textContent, CHARGE);

	const sortieErr = await executerEtLireSortie({ status: "error", error: CHARGE, stdout: "" });
	r.check("erreur hostile : aucun <img> comme élément", sortieErr.querySelector("img"), null);
	r.check("erreur hostile : postée en textContent, jamais en HTML", sortieErr.innerHTML.includes("<img"), false);

	r.done();
});
