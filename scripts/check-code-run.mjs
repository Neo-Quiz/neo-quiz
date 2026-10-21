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

	// NATIVE PYTHON: missing libraries are downloaded, then the block runs ONCE more.
	const clic = async (container) => {
		container.querySelector(".quiz-code-run-btn").dispatchEvent(new document.defaultView.Event("click"));
		for (let i = 0; i < 6; i++) await new Promise(res => setTimeout(res, 0));
	};
	{
		const installs = [];
		const jobs = [];
		let appels = 0;
		const container = fabriquerBloc();
		const host = {
			code: {
				languages: () => ["python"],
				run: async job => {
					jobs.push(job);
					return ++appels === 1 ? { status: "not-installed", stdout: "", missing: ["torch"] } : { status: "ok", stdout: "tensor(1)" };
				},
				warm: () => {},
				installer: async (langue, progression, paquets) => { installs.push([langue, paquets]); progression(40); return "ok"; },
			},
			ui: { setIcon: () => {} },
		};
		createCodeRunHandlers({ container, host }).bindCodeRunButtons();
		await clic(container);
		r.check("missing torch: installer called once with [torch]", JSON.stringify(installs), JSON.stringify([["python", ["torch"]]]));
		r.check("missing torch: ran a second time, not more", appels, 2);
		r.check("python is given 60 s", jobs[0].timeoutMs, 60000);
		r.check("missing torch: the output is the second run's", container.querySelector(".quiz-code-output").textContent, "tensor(1)");
	}
	{
		// the interpreter alone missing: missing [] -> installer(python, [])
		const installs = [];
		let appels = 0;
		const container = fabriquerBloc();
		const host = { code: { languages: () => ["python"], run: async () => (++appels === 1 ? { status: "not-installed", stdout: "", missing: [] } : { status: "ok", stdout: "1" }), warm: () => {}, installer: async (l, p, paquets) => { installs.push(paquets); return "ok"; } }, ui: { setIcon: () => {} } };
		createCodeRunHandlers({ container, host }).bindCodeRunButtons();
		await clic(container);
		r.check("interpreter missing: installer([])", JSON.stringify(installs), "[[]]");
	}
	{
		// never a loop: still not-installed after the install -> exactly two runs
		let appels = 0;
		const container = fabriquerBloc();
		const host = { code: { languages: () => ["python"], run: async () => { appels++; return { status: "not-installed", stdout: "", missing: ["torch"] }; }, warm: () => {}, installer: async () => "ok" }, ui: { setIcon: () => {} } };
		createCodeRunHandlers({ container, host }).bindCodeRunButtons();
		await clic(container);
		r.check("no loop on a persistent not-installed", appels, 2);
	}
	for (const [res, cle] of [["offline", "offline"], ["refused", "refused"], ["failed", "failed"]]) {
		let appels = 0;
		const container = fabriquerBloc();
		const host = { code: { languages: () => ["python"], run: async () => { appels++; return { status: "not-installed", stdout: "", missing: ["torch"] }; }, warm: () => {}, installer: async () => res }, ui: { setIcon: () => {} } };
		createCodeRunHandlers({ container, host }).bindCodeRunButtons();
		await clic(container);
		r.check("install " + cle + ": no second run", appels, 1);
		r.check("install " + cle + ": a message, no element", container.querySelector(".quiz-code-output").children.length, 0);
	}
	{
		const container = fabriquerBloc();
		const host = { code: { languages: () => ["python"], run: async () => ({ status: "unsupported", stdout: "", unsupported: ["pygame", '<img src=x onerror=alert(1)>'] }), warm: () => {} }, ui: { setIcon: () => {} } };
		createCodeRunHandlers({ container, host }).bindCodeRunButtons();
		await clic(container);
		const sortie = container.querySelector(".quiz-code-output");
		r.check("unsupported: names the library", sortie.textContent.includes("pygame"), true);
		r.check("unsupported: shown as an error", sortie.classList.contains("quiz-code-output-error"), true);
		r.check("unsupported: no element under the output", sortie.children.length, 0);
	}
	// No "Run online" button for any Python status.
	for (const status of ["ok", "error", "compile-error", "timeout", "too-long", "unavailable", "not-installed", "unsupported"]) {
		const container = fabriquerBloc();
		const host = { code: { languages: () => ["python"], run: async () => ({ status, stdout: "", error: "ModuleNotFoundError: No module named 'torch'", missing: [], unsupported: ["x"] }), warm: () => {} }, ui: { setIcon: () => {} }, shell: { copyText: async () => true, openUrl: async () => true } };
		createCodeRunHandlers({ container, host }).bindCodeRunButtons();
		await clic(container);
		r.check("no online button: " + status, container.querySelector(".quiz-code-online-btn, .quiz-code-online"), null);
	}
	// C keeps the 10 s deadline.
	{
		const jobs = [];
		const container = fabriquerBloc("c");
		const host = { code: { languages: () => ["c"], run: async job => { jobs.push(job); return { status: "ok", stdout: "" }; }, warm: () => {} }, ui: { setIcon: () => {} } };
		createCodeRunHandlers({ container, host }).bindCodeRunButtons();
		await clic(container);
		r.check("C keeps 10 s", jobs[0]?.timeoutMs, 10000);
	}

	r.done();
});
