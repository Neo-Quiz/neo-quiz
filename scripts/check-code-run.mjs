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

await withSrcModule(["src/engine/code-run.ts", "src/code-exercise/besoin-en-ligne.ts"], async ({ createCodeRunHandlers }, { besoinEnLigne, URL_EN_LIGNE }) => {
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

	// "Run online": classification on the REAL strings of the Pyodide sandbox
	// (task 3 and 4 reports), then the button's wiring.
	const OUI = [
		"ModuleNotFoundError: No module named 'torch'",
		"ModuleNotFoundError: No module named 'numpy'\nThe module 'numpy' is included in the Pyodide distribution, but it is not installed.",
		"ImportError: dynamic module does not define module export function (PyInit_base)",
		"RuntimeError: TLS not supported in this environment",
		"ValueError: Can't find a pure Python 3 wheel for 'pygame'.",
		"ValueError: Can't fetch metadata for 'x'. Please make sure you have entered a correct package name",
		"pyodide.ffi.JsException: TypeError: Failed to fetch",
	];
	const NON = [
		"NameError: name 'x' is not defined",
		"SyntaxError: invalid syntax",
		"AssertionError: 3 != 4",
		"ZeroDivisionError: division by zero",
		"ImportError: cannot import name 'foo' from 'math'",
		"FileNotFoundError: [Errno 44] No such file or directory: 'a.txt'",
		"",
	];
	for (const e of OUI) r.check(`online needed: ${e.slice(0, 50)}`, besoinEnLigne(e), true);
	for (const e of NON) r.check(`ordinary error: ${e.slice(0, 50)}`, besoinEnLigne(e), false);

	{
		const calls = [];
		const container = fabriquerBloc();
		const host = {
			code: { languages: () => ["python"], run: async () => ({ status: "error", stdout: "", error: "ModuleNotFoundError: No module named 'torch'" }), warm: () => {} },
			ui: { setIcon: () => {} },
			shell: { copyText: async t => { calls.push(["copy", t]); return true; }, openUrl: async u => { calls.push(["open", u]); return true; } },
		};
		createCodeRunHandlers({ container, host }).bindCodeRunButtons();
		container.querySelector(".quiz-code-run-btn").dispatchEvent(new document.defaultView.Event("click"));
		await new Promise(res => setTimeout(res, 0));
		await new Promise(res => setTimeout(res, 0));
		const online = container.querySelector(".quiz-code-online-btn");
		r.check("online button shown for a blocked import", !!online, true);
		online.dispatchEvent(new document.defaultView.Event("click"));
		await new Promise(res => setTimeout(res, 0));
		await new Promise(res => setTimeout(res, 0));
		r.check("click copies the code then opens Colab", JSON.stringify(calls), JSON.stringify([["copy", 'print("x")'], ["open", URL_EN_LIGNE]]));
		// an ordinary error offers nothing
		host.code.run = async () => ({ status: "error", stdout: "", error: "NameError: name 'x' is not defined" });
		container.querySelector(".quiz-code-run-btn").dispatchEvent(new document.defaultView.Event("click"));
		await new Promise(res => setTimeout(res, 0));
		await new Promise(res => setTimeout(res, 0));
		r.check("no online button for a NameError (and the old one is gone)", container.querySelector(".quiz-code-online-btn"), null);
	}

	r.done();
});
