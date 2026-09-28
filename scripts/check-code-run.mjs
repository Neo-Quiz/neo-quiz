/**
 * The « Run » button of a code block (src/engine/code-run.ts) — finding M4
 * of the 2026-09-27 review: a program's output (stdout or error) is text
 * whose author is not necessarily the quiz's own (a SHARED quiz is
 * hostile). This script loads the REAL module with a fake `HostCode` whose
 * `run()` returns an HTML payload, and checks that nothing of the sort ever
 * appears as an ELEMENT under `.quiz-code-output` — only as text, set
 * through `textContent`.
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

	// `data-lang` (grammaire-blocs.ts, task 5) names the block's language:
	// a fixture built by hand must carry it, or `bindCodeRunButtons` would
	// read an empty string and treat the block as unsupported by the host.
	function fabriquerBloc(langue = "python") {
		const container = document.createElement("div");
		container.innerHTML =
			`<div class="quiz-code-block quiz-code-block-executable" data-lang="${langue}">` +
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

	// Task 5 (C/C++ execution plan): a block of a language the TABLE names
	// (src/code-languages.ts) but the current host does not implement yet
	// loses its bar, same treatment as no `HostCode` at all — never an inert
	// button a click on which silently does nothing.
	{
		const container = fabriquerBloc("c");
		const ctx = { container, host: { code: { languages: () => ["python"], run: async () => ({ status: "ok", stdout: "" }), warm: () => {} } } };
		const { bindCodeRunButtons } = createCodeRunHandlers(ctx);
		bindCodeRunButtons();
		const bloc = container.querySelector(".quiz-code-block");
		r.check("table language not offered by the host: toolbar removed", bloc.querySelector(".quiz-code-toolbar"), null);
		r.check("table language not offered by the host: executable class removed", bloc.classList.contains("quiz-code-block-executable"), false);
	}

	r.done();
});
