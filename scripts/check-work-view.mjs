/**
 * The full AI work view of a live session (src/dashboard/work-view.ts) —
 * Review Focus 4 of the live-CLI plan. A tool output, a tool input, a
 * permission request and model text come from the CLI, and the CLI's text
 * is not trusted: this script renders hostile strings through the REAL
 * `renderThread` and checks that no element appears from them, that the
 * text stays visible as text, that "Show all" fetches once and renders as
 * text, that a permission answer is sent once and then disabled, and that
 * re-rendering the same thread keeps the same nodes.
 *
 *     npm run check:work-view
 */
import { parseHTML } from "linkedom";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const { document } = parseHTML("<html><body></body></html>");
globalThis.document = document;
const flush = () => new Promise(res => setTimeout(res, 0));
const click = el => el.dispatchEvent(new document.defaultView.Event("click"));

await withSrcModule(["src/dashboard/work-view.ts", "src/host/current.ts", "src/dashboard/live-thread.ts"], async ({ renderThread, threadHasLiveRow }, { installHost }, { threadFromRun }) => {
	const r = makeReporter("Vue de travail — texte jamais interprété (Focus 4)");
	const CHARGE = "<img src=x onerror=alert(1)>";
	const FIN = "</pre><script>x</script>";

	const hote = {
		ui: { setIcon() {} },
		platform: { uiLanguage: "en" },
	};
	installHost(hote);

	const sorties = [];
	const reponses = [];
	const deps = {
		loadOutput: async id => { sorties.push(id); return CHARGE + "\n" + FIN; },
		answer: (id, allow) => reponses.push([id, allow]),
	};

	const fil = (items, running = false) => ({ items, running });

	// 1. Hostile tool item, short output (no "Show all") and long output.
	{
		const root = document.createElement("div");
		renderThread(root, fil([
			{ kind: "tool", id: "t1", name: CHARGE, input: FIN, preview: CHARGE, lines: 3, status: "ok", diff: null },
		]), deps);
		r.check("outil hostile : aucun img/script", root.querySelectorAll("img,script").length, 0);
		r.check("outil hostile : le nom reste du texte", root.textContent.includes(CHARGE), true);
		r.check("outil hostile : l'entrée reste du texte", root.textContent.includes(FIN), true);
	}

	// 2. Hostile text and thinking items.
	{
		const root = document.createElement("div");
		renderThread(root, fil([
			{ kind: "text", text: CHARGE },
			{ kind: "thinking", text: FIN },
			{ kind: "user", text: CHARGE },
		]), deps);
		r.check("texte hostile : aucun img/script", root.querySelectorAll("img,script").length, 0);
		r.check("texte hostile : visible en textContent", root.textContent.includes(CHARGE) && root.textContent.includes(FIN), true);
	}

	// 3. "Show all" calls loadOutput once and renders the result as text.
	{
		const root = document.createElement("div");
		renderThread(root, fil([
			{ kind: "tool", id: "t2", name: "Bash", input: "ls", preview: "a", lines: 40, status: "ok", diff: null },
		]), deps);
		click(root.querySelector(".qbd-work-tool-head"));
		const bouton = [...root.querySelectorAll("button")].find(b => b.textContent.includes("40"));
		r.check("Afficher tout : bouton présent quand lignes > aperçu", !!bouton, true);
		if (bouton) {
			click(bouton);
			click(bouton);
			await flush();
			await flush();
		}
		r.check("Afficher tout : loadOutput appelé une fois", sorties.length, 1);
		r.check("Afficher tout : sortie complète en texte", root.textContent.includes(CHARGE + "\n" + FIN), true);
		r.check("Afficher tout : aucun img/script", root.querySelectorAll("img,script").length, 0);
	}

	// 4. Diff lines: added and removed carry their classes; text stays text.
	{
		const root = document.createElement("div");
		renderThread(root, fil([
			{ kind: "tool", id: "t3", name: "Edit", input: "x", preview: "", lines: 0, status: "ok", diff: { added: [CHARGE], removed: ["old"] } },
		]), deps);
		click(root.querySelector(".qbd-work-tool-head"));
		r.check("diff : une ligne ajoutée", root.querySelectorAll(".qbd-work-diff-add").length, 1);
		r.check("diff : une ligne retirée", root.querySelectorAll(".qbd-work-diff-del").length, 1);
		r.check("diff : aucun img", root.querySelectorAll("img").length, 0);
	}

	// 5. Permission: Allow / Deny send one answer each, then both are disabled.
	{
		const root = document.createElement("div");
		renderThread(root, fil([
			{ kind: "permission", requestId: "r1", tool: CHARGE, input: FIN, state: "pending" },
			{ kind: "permission", requestId: "r2", tool: "Bash", input: "rm", state: "pending" },
		]), deps);
		const cartes = root.querySelectorAll(".qbd-work-permission");
		const autorise = cartes[0].querySelectorAll("button")[0];
		const refuse = cartes[1].querySelectorAll("button")[1];
		click(autorise);
		click(refuse);
		click(autorise);
		await flush();
		r.check("autoriser : answer(r1, true) une fois", JSON.stringify(reponses.filter(x => x[0] === "r1")), JSON.stringify([["r1", true]]));
		r.check("refuser : answer(r2, false) une fois", JSON.stringify(reponses.filter(x => x[0] === "r2")), JSON.stringify([["r2", false]]));
		r.check("après clic : boutons désactivés", [...root.querySelectorAll(".qbd-work-permission button")].every(b => b.disabled), true);
		r.check("permission : aucun img/script du nom hostile", root.querySelectorAll("img,script").length, 0);
	}

	// 6. Re-rendering the same thread keeps the same nodes, no duplicates.
	{
		const root = document.createElement("div");
		const items = [
			{ kind: "text", text: "un" },
			{ kind: "tool", id: "t4", name: "Read", input: "a", preview: "b", lines: 1, status: "running", diff: null },
		];
		renderThread(root, fil(items), deps);
		const avant = [...root.children];
		renderThread(root, fil(items), deps);
		const apres = [...root.children];
		r.check("rerendu : même nombre de nœuds", apres.length, 2);
		r.check("rerendu : mêmes nœuds (identité)", apres.every((n, i) => n === avant[i]), true);
		renderThread(root, fil([{ kind: "text", text: "un" }]), deps);
		r.check("moins d'éléments : nœuds retirés", root.children.length, 1);
	}


	// 7. Titles per tool kind, Claude Code style, Windows paths relative to the root.
	{
		const RACINE = "C:\\neo\\racine";
		const outil = (id, name, input) => ({ kind: "tool", id, name, input, preview: "", lines: 0, status: "ok", diff: null });
		const root = document.createElement("div");
		renderThread(root, fil([
			outil("a1", "Read", JSON.stringify({ file_path: RACINE + "\\XTI303\\CM1.pdf", offset: 1, limit: 120 })),
			outil("a2", "Bash", "ls -la\nsecond line"),
			outil("a3", "Grep", JSON.stringify({ pattern: "foo", path: RACINE + "\\src" })),
			outil("a4", "Glob", JSON.stringify({ pattern: "*.ts" })),
			outil("a5", "Write", JSON.stringify({ file_path: RACINE + "\\n.md" })),
			outil("a6", "Edit", JSON.stringify({ file_path: "C:\\autre\\b.md" })),
			outil("a7", "WebFetch", JSON.stringify({ url: "https://x.test/a" })),
			outil("a8", "WebSearch", JSON.stringify({ query: "quiz" })),
		]), { ...deps, root: RACINE });
		const titres = [...root.querySelectorAll(".qbd-work-title")].map(n => n.textContent);
		r.check("titre Read : chemin relatif, plage", titres[0], "Read(XTI303\\CM1.pdf · lines 1-120)");
		r.check("titre Bash : première ligne", titres[1], "Bash(ls -la)");
		r.check("titre Grep", titres[2], 'Search("foo" in src)');
		r.check("titre Glob", titres[3], "Find(*.ts)");
		r.check("titre Write", titres[4], "Write(n.md)");
		r.check("titre Edit hors racine : chemin absolu", titres[5], "Edit(C:\\autre\\b.md)");
		r.check("titre WebFetch", titres[6], "Fetch(https://x.test/a)");
		r.check("titre WebSearch", titres[7], 'WebSearch("quiz")');
	}

	// 8. openFile: an in-root file is clickable and gets its absolute path; an outside file is not.
	{
		const RACINE = "C:\\neo\\racine";
		const ouverts = [];
		const root = document.createElement("div");
		renderThread(root, fil([
			{ kind: "tool", id: "o1", name: "Read", input: JSON.stringify({ file_path: RACINE + "\\notes\\a.md" }), preview: "", lines: 0, status: "ok", diff: null },
			{ kind: "tool", id: "o2", name: "Read", input: JSON.stringify({ file_path: "C:\\autre\\b.md" }), preview: "", lines: 0, status: "ok", diff: null },
		]), { ...deps, root: RACINE, openFile: p => ouverts.push(p) });
		const liens = root.querySelectorAll(".qbd-work-path.is-link");
		r.check("chemin dans la racine : cliquable", liens.length, 1);
		r.check("chemin hors racine : aucun lien", root.querySelectorAll(".qbd-work-path").length, 2);
		if (liens[0]) click(liens[0]);
		r.check("openFile : chemin absolu, une fois", JSON.stringify(ouverts), JSON.stringify([RACINE + "\\notes\\a.md"]));
		const sansDep = document.createElement("div");
		renderThread(sansDep, fil([
			{ kind: "tool", id: "o3", name: "Read", input: JSON.stringify({ file_path: RACINE + "\\x.md" }), preview: "", lines: 0, status: "ok", diff: null },
		]), { ...deps, root: RACINE });
		r.check("sans openFile : aucun lien", sansDep.querySelectorAll(".is-link").length, 0);
	}

	// 9. Write and Edit: summary wording, gutter numbers, markers; a hostile diff line stays text.
	{
		const root = document.createElement("div");
		renderThread(root, fil([
			{ kind: "tool", id: "w1", name: "Write", input: JSON.stringify({ file_path: "C:\\x\\n.ts" }), preview: "", lines: 0, status: "ok", diff: { added: ["a", CHARGE, "c"], removed: [] } },
			{ kind: "tool", id: "w2", name: "Edit", input: JSON.stringify({ file_path: "C:\\x\\n.ts" }), preview: "", lines: 0, status: "ok", diff: { added: ["new"], removed: ["old"] } },
		]), deps);
		r.check("corps replié par défaut", root.querySelectorAll(".qbd-work-tool-body")[0].hidden, true);
		root.querySelectorAll(".qbd-work-tool-head").forEach(h => click(h));
		const resumes = root.querySelectorAll(".qbd-work-summary-text");
		r.check("Write : « Wrote 3 lines »", resumes[0]?.textContent, "Wrote 3 lines");
		r.check("Edit : « Added 1 line, removed 1 line »", resumes[1]?.textContent, "Added 1 line, removed 1 line");
		const numeros = [...root.querySelectorAll(".qbd-work-diff")[0].querySelectorAll(".qbd-work-gutter")].map(n => n.textContent);
		r.check("Write : numéros depuis 1", numeros.join(","), "1,2,3");
		const edition = root.querySelectorAll(".qbd-work-diff")[1];
		r.check("Edit : pas de numéros", [...edition.querySelectorAll(".qbd-work-gutter")].every(n => n.textContent === ""), true);
		r.check("Edit : une ligne retirée, une ajoutée", edition.querySelectorAll(".qbd-work-diff-del").length + edition.querySelectorAll(".qbd-work-diff-add").length, 2);
		r.check("marqueurs : − puis +", [...edition.querySelectorAll(".qbd-work-marker")].map(n => n.textContent).join(""), "-+");
		r.check("diff : aucun img/script hostile", root.querySelectorAll("img,script").length, 0);
		r.check("diff : la ligne hostile reste du texte", root.textContent.includes(CHARGE), true);
	}

	// 10. Bash: collapsed by default; a failed one stays collapsed with its first error line in red;
	//     a running one waiting for a permission opens with its card.
	{
		const root = document.createElement("div");
		const cmd = { kind: "tool", id: "b1", name: "Bash", input: "echo " + CHARGE + "\n" + FIN, preview: "", lines: 0, status: "ok", diff: null };
		renderThread(root, fil([cmd, { ...cmd, id: "b2", status: "error", preview: "boom " + FIN + "\nsuite" }]), deps);
		const corps = root.querySelectorAll(".qbd-work-tool-body");
		r.check("Bash ok : replié", corps[0].hidden, true);
		r.check("Bash en erreur : replié", corps[1].hidden, true);
		r.check("Bash en erreur : première ligne rouge", root.querySelector(".qbd-work-summary.is-error")?.textContent.includes("boom"), true);
		r.check("Bash : aucun img/script hostile", root.querySelectorAll("img,script").length, 0);
		const attente = document.createElement("div");
		renderThread(attente, fil([
			{ kind: "tool", id: "b3", name: "Bash", input: "rm -rf x", preview: "", lines: 0, status: "running", diff: null },
			{ kind: "permission", requestId: "p9", tool: "Bash", input: "rm -rf x", state: "pending" },
		], true), deps);
		r.check("Bash en attente de permission : ouvert", attente.querySelector(".qbd-work-tool-body").hidden, false);
		r.check("Bash en attente : carte Autoriser visible", attente.querySelectorAll(".qbd-work-permission").length, 1);
		const enCours = document.createElement("div");
		renderThread(enCours, fil([
			{ kind: "tool", id: "b4", name: "Bash", input: "sleep 9", preview: "", lines: 0, status: "running", diff: null },
		], true), deps);
		r.check("Bash en cours sans permission : replié", enCours.querySelector(".qbd-work-tool-body").hidden, true);
		renderThread(enCours, fil([], false), deps);
	}

	// 11. Grouping: consecutive OK reads fold; a running, failed or pending call stays on its own row.
	{
		const root = document.createElement("div");
		const lecture = (id, status) => ({ kind: "tool", id, name: "Read", input: JSON.stringify({ file_path: "C:\\x\\" + id + ".md" }), preview: "", lines: 0, status, diff: null });
		renderThread(root, fil([
			lecture("g1", "ok"), lecture("g2", "ok"), lecture("g3", "running"), lecture("g4", "ok"), lecture("g5", "error"),
			{ kind: "permission", requestId: "pg", tool: "Read", input: "", state: "pending" },
		]), deps);
		const groupes = root.querySelectorAll(".qbd-work-group");
		r.check("groupe : une ligne", groupes.length, 1);
		r.check("groupe : titre « Read 2 files »", groupes[0]?.querySelector(".qbd-work-group-title")?.textContent, "Read 2 files");
		r.check("groupe : chevron", groupes[0]?.querySelectorAll(".qbd-work-chevron").length, 1);
		r.check("en cours (permission demandée) : hors groupe, visible", root.querySelectorAll(".qbd-work-dot.is-running, .qbd-work-dot.is-waiting").length, 1);
		r.check("en erreur : hors groupe, visible", root.querySelectorAll(".qbd-work-dot.is-error").length, 1);
		r.check("permission : visible", root.querySelectorAll(".qbd-work-permission").length, 1);
		r.check("rien d'en cours ou en erreur dans le groupe", groupes[0] ? groupes[0].querySelectorAll(".is-running, .is-error").length : -1, 0);
	}

	// 12. Thinking: elapsed and tokens shown; the live sheen only while running.
	{
		const root = document.createElement("div");
		renderThread(root, fil([{ kind: "thinking", text: "", tokens: 1240 }], false), deps);
		r.check("réflexion finie : pas de temps écoulé", root.querySelector(".qbd-work-elapsed"), null);
		r.check("réflexion : jetons", root.querySelector(".qbd-work-tokens")?.textContent, "~1240 tokens");
		r.check("réflexion finie : pas de reflet", root.querySelectorAll(".is-live").length, 0);
		const vivant = document.createElement("div");
		renderThread(vivant, fil([{ kind: "thinking", text: "", tokens: 5 }], true), deps);
		r.check("réflexion en cours : reflet", vivant.querySelectorAll(".qbd-work-thinking-label.is-live").length, 1);
		renderThread(vivant, fil([{ kind: "thinking", text: "", tokens: 5 }], false), deps);
		r.check("réflexion arrêtée : reflet retiré", vivant.querySelectorAll(".is-live").length, 0);
	}

	// 13. Keyboard: an expandable row is a button; Enter opens it.
	{
		const root = document.createElement("div");
		renderThread(root, fil([
			{ kind: "tool", id: "k1", name: "Write", input: JSON.stringify({ file_path: "C:\\x\\a.md" }), preview: "", lines: 0, status: "ok", diff: { added: ["u"], removed: [] } },
		]), deps);
		const tete = root.querySelector(".qbd-work-tool-head");
		r.check("ligne : rôle bouton", tete?.getAttribute("role"), "button");
		r.check("ligne : au clavier", tete?.getAttribute("tabindex"), "0");
		const touche = new document.defaultView.Event("keydown");
		touche.key = "Enter";
		tete.dispatchEvent(touche);
		r.check("Entrée ouvre le corps", root.querySelector(".qbd-work-tool-body").hidden, false);
		r.check("corps ouvert : classe is-open", root.querySelector(".qbd-work-tool").classList.contains("is-open"), true);
	}


	// 14. Every tool kind, every state: no raw translation key ever reaches the page.
	{
		const root = document.createElement("div");
		const base = { preview: "p", lines: 2, diff: null };
		renderThread(root, fil([
			{ kind: "notice", text: "interrupted" },
			{ kind: "thinking", text: "", tokens: 3 },
			{ kind: "tool", id: "k1", name: "Read", input: JSON.stringify({ file_path: "C:\\neo\\racine\\a.md", limit: 5 }), status: "ok", ...base },
			{ kind: "tool", id: "k2", name: "Bash", input: "ls", status: "error", ...base },
			{ kind: "tool", id: "k3", name: "Grep", input: JSON.stringify({ pattern: "x" }), status: "refused", ...base },
			{ kind: "tool", id: "k4", name: "Glob", input: JSON.stringify({ pattern: "*" }), status: "ok", ...base },
			{ kind: "tool", id: "k5", name: "Write", input: JSON.stringify({ file_path: "C:\\neo\\racine\\w.md" }), status: "ok", preview: "", lines: 0, diff: { added: ["x"], removed: [] } },
			{ kind: "tool", id: "k6", name: "Edit", input: JSON.stringify({ file_path: "C:\\neo\\racine\\e.md" }), status: "ok", preview: "", lines: 0, diff: { added: ["x"], removed: ["y"] } },
			{ kind: "tool", id: "k7", name: "fileChange", input: "C:\\neo\\racine\\f.md", status: "ok", preview: "", lines: 0, diff: null },
			{ kind: "tool", id: "k8", name: "WebFetch", input: JSON.stringify({ url: "https://x.test" }), status: "running", preview: "", lines: 0, diff: null },
			{ kind: "tool", id: "k9", name: "WebSearch", input: JSON.stringify({ query: "q" }), status: "ok", preview: "", lines: 0, diff: null },
			{ kind: "tool", id: "k10", name: "Other", input: JSON.stringify({ a: 1 }), status: "ok", preview: "", lines: 0, diff: null },
			{ kind: "tool", id: "k11", name: "Bash", input: "ls", status: "ok", preview: "", lines: 0, diff: null },
			{ kind: "tool", id: "k12", name: "Bash", input: "ls", status: "ok", preview: "", lines: 0, diff: null },
			{ kind: "permission", requestId: "pz", tool: "Bash", input: "rm", state: "denied" },
			{ kind: "text", text: "fin" },
		]), { ...deps, root: "C:\\neo\\racine" });
		const brut = [...root.querySelectorAll("*")].some(n => [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.includes("ai.")));
		r.check("aucune clé de traduction brute à l'écran", brut, false);
		r.check("aucun texte « ai.work. »", root.textContent.includes("ai.work."), false);
	}

	// 15. A failed call: the summary is ONE line holding the first sentence; the full
	//     message is absent from the body until the row opens, then appears exactly once.
	{
		const root = document.createElement("div");
		const MESSAGE = "Read failed: file missing. Details here\nline two of stack";
		renderThread(root, fil([
			{ kind: "tool", id: "e1", name: "Read", input: JSON.stringify({ file_path: "C:\\neo\\racine\\a.md" }), preview: MESSAGE, lines: 2, status: "error", diff: null },
		]), deps);
		const resume = root.querySelector(".qbd-work-summary-text");
		r.check("erreur : résumé sur une ligne", resume?.textContent.includes("\n"), false);
		r.check("erreur : résumé = première phrase", resume?.textContent, "Read failed: file missing.");
		r.check("erreur : titre = message complet", resume?.getAttribute("title"), MESSAGE);
		r.check("erreur : corps replié, message absent avant ouverture", root.textContent.split("line two of stack").length - 1, 0);
		click(root.querySelector(".qbd-work-tool-head"));
		r.check("erreur : message complet une fois après ouverture", root.textContent.split("line two of stack").length - 1, 1);
		r.check("erreur : le corps est ouvert", root.querySelector(".qbd-work-tool-body").hidden, false);
	}

	// 16. A Claude Code `user` line carrying an Edit's structuredPatch: the diff keeps the
	//     file's real line numbers; context lines are plain. The line below is sanitized from the
	//     shape the CLI writes (empty hunks in the owner's run); the non-empty hunk follows the same
	//     documented fields (oldStart, newStart, lines with a one-character prefix).
	{
		const RACINE = "C:\\neo\\racine";
		const evenements = [
			{ dir: "out", l: { type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: "Edit", input: { file_path: RACINE + "\\a.md", old_string: "old line", new_string: "new line" } }] } } },
			{ dir: "out", l: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "The file has been updated.", is_error: false }] }, tool_use_result: { filePath: RACINE + "\\a.md", originalFile: "x", structuredPatch: [{ oldStart: 3, oldLines: 2, newStart: 3, newLines: 2, lines: [" keep", "-old line", "+new line", " tail"] }], type: "update", userModified: false } } },
		];
		const fil2 = threadFromRun({ events: evenements, interrupted: false, truncated: false });
		const diff = fil2.items[0].diff;
		r.check("patch : lignes réduites avec numéros réels", JSON.stringify((diff.lines ?? []).map(l => [l.kind, l.num])), JSON.stringify([["ctx", 3], ["del", 4], ["add", 4], ["ctx", 5]]));
		r.check("patch : compteurs", `${diff.added.length}/${diff.removed.length}`, "1/1");
		const vue = document.createElement("div");
		renderThread(vue, fil([{ kind: "tool", id: "tu1", name: "Edit", input: "", preview: "", lines: 0, status: "ok", diff }]), deps);
		click(vue.querySelector(".qbd-work-tool-head"));
		const numeros = [...vue.querySelectorAll(".qbd-work-gutter")].map(n => n.textContent).join(",");
		r.check("patch : numéros affichés", numeros, "3,4,4,5");
		r.check("patch : contexte sans teinte", vue.querySelectorAll(".qbd-work-diff-ctx").length, 2);
	}

	// 17. The quiz the model writes is ONE row: streaming it shows the question count and
	//     no raw JSON until the row opens; hostile HTML inside the quiz creates no element.
	{
		const PARTIEL = "Voici le quiz.\n```quiz-blocks\n[\n  {\n    title: \"Q\",\n    questions: [\n" +
			"      {prompt: \"Un\", options: [\"a\", \"b\"], correctIndex: 0},\n" +
			"      {prompt: \"Deux\", options: [\"a\", \"b\"], correctIndex: 1},\n" +
			"      {prompt: \"<img src=x onerror=alert(1)>\", options: [\"a\", \"b\"], correctIndex: 0,\n";
		const root = document.createElement("div");
		renderThread(root, fil([{ kind: "text", text: PARTIEL }], true), deps);
		const rangee = root.querySelector(".qbd-work-quiz");
		r.check("quiz en cours : une seule ligne", root.querySelectorAll(".qbd-work-quiz").length, 1);
		r.check("quiz en cours : titre « Writing the quiz »", rangee?.querySelector(".qbd-work-tool-name")?.textContent, "Writing the quiz");
		r.check("quiz en cours : « Question 3 »", rangee?.querySelector(".qbd-work-summary-text")?.textContent, "Question 3");
		r.check("quiz en cours : prose avant le bloc gardée", root.textContent.includes("Voici le quiz."), true);
		r.check("quiz en cours : JSON brut absent avant ouverture", root.textContent.includes("correctIndex"), false);
		click(rangee.querySelector(".qbd-work-tool-head"));
		r.check("quiz ouvert : JSON visible", root.textContent.includes("correctIndex"), true);
		r.check("quiz ouvert : aucun img hostile", root.querySelectorAll("img,script").length, 0);
		r.check("quiz ouvert : texte hostile visible", root.textContent.includes("<img src=x onerror=alert(1)>"), true);
		renderThread(root, fil([{ kind: "text", text: PARTIEL + "]\n```" }], false), deps);
		r.check("quiz fini : titre « Quiz written »", root.querySelector(".qbd-work-quiz .qbd-work-tool-name")?.textContent, "Quiz written");
	}

		// 17b. A quiz generation (`summarizeText`): the model's text is never shown,
		//      not even once opened; one summary line with its line count, the pen
		//      icon pulses only while the turn runs.
		{
			const HTML = "<!doctype html>\n<html><body><img src=x onerror=alert(1)></body></html>";
			const live = document.createElement("div");
			renderThread(live, fil([{ kind: "text", text: HTML }], true), { ...deps, summarizeText: true });
			r.check("résumé en cours : HTML brut absent", live.textContent.includes("<!doctype"), false);
			r.check("résumé en cours : aucun img créé", live.querySelectorAll("img").length, 0);
			r.check("résumé en cours : aucun bouton d'ouverture", live.querySelectorAll("button").length, 0);
			r.check("résumé en cours : icône qui pulse", live.querySelectorAll(".qbd-work-written-icon.is-writing").length, 1);
			r.check("résumé en cours : compte les lignes", live.querySelector(".qbd-work-written .qbd-work-tool-name")?.textContent, "Writing the quiz · 2 lines");
			const fini = document.createElement("div");
			renderThread(fini, fil([{ kind: "text", text: HTML }], false), { ...deps, summarizeText: true });
			r.check("résumé fini : icône figée", fini.querySelectorAll(".qbd-work-written-icon.is-writing").length, 0);
			r.check("résumé fini : « Wrote the quiz »", fini.querySelector(".qbd-work-written .qbd-work-tool-name")?.textContent, "Wrote the quiz · 2 lines");
			r.check("résumé fini : HTML brut absent", fini.textContent.includes("<!doctype"), false);
		}

	// 18. A live row carries its own spinner: the page's "Working" line stays hidden then.
	{
		const outil = { kind: "tool", id: "w9", name: "Bash", input: "sleep 9", preview: "", lines: 0, status: "running", diff: null };
		r.check("outil en cours : pas de ligne « Working »", threadHasLiveRow(fil([outil], true)), true);
		r.check("tour fini : la ligne « Working » ne reste pas", threadHasLiveRow(fil([{ ...outil, status: "ok" }], false)), false);
		r.check("réflexion en cours : pas de ligne « Working »", threadHasLiveRow(fil([{ kind: "thinking", text: "" }], true)), true);
	}

	// 19. Status dots: green when it succeeded, red when it failed or was refused, grey and
	//     pulsing while running, amber while waiting for a permission; the label is translated.
	{
		const outil = (id, status) => ({ kind: "tool", id, name: "Bash", input: "ls", preview: "", lines: 0, status, diff: null });
		const root = document.createElement("div");
		renderThread(root, fil([outil("d1", "ok"), outil("d2", "error"), outil("d3", "running")], true), deps);
		const pastilles = [...root.querySelectorAll(".qbd-work-tool-head .qbd-work-dot")];
		r.check("pastille réussie : verte", pastilles[0]?.classList.contains("is-ok"), true);
		r.check("pastille réussie : libellé", pastilles[0]?.getAttribute("aria-label"), "Succeeded");
		r.check("pastille en échec : rouge", pastilles[1]?.classList.contains("is-error"), true);
		r.check("pastille en échec : libellé", pastilles[1]?.getAttribute("aria-label"), "Failed");
		r.check("pastille en cours : pulsante", pastilles[2]?.classList.contains("is-running"), true);
		r.check("pastille en cours : libellé", pastilles[2]?.getAttribute("aria-label"), "Running");
		r.check("aucune icône Lucide de statut", root.querySelectorAll(".qbd-work-icon").length, 0);
		const attente = document.createElement("div");
		renderThread(attente, fil([
			outil("d4", "running"),
			{ kind: "permission", requestId: "pd", tool: "Bash", input: "rm", state: "pending" },
		], true), deps);
		r.check("pastille en attente : ambre", attente.querySelector(".qbd-work-tool-head .qbd-work-dot")?.classList.contains("is-waiting"), true);
		r.check("pastille en attente : libellé", attente.querySelector(".qbd-work-tool-head .qbd-work-dot")?.getAttribute("aria-label"), "Waiting for you");
		const groupe = document.createElement("div");
		renderThread(groupe, fil([outil("d5", "ok"), outil("d6", "ok")], false), deps);
		r.check("groupe réussi : pastille verte", groupe.querySelector(".qbd-work-group-head .qbd-work-dot")?.classList.contains("is-ok"), true);
	}

	// 20. A finished thinking row says how long it thought, or just "Thought"; never "0:00".
	{
		const root = document.createElement("div");
		renderThread(root, fil([{ kind: "thinking", text: "", started: 0, ended: 12000 }], false), deps);
		r.check("réflexion finie avec durée : « Thought for 0:12 »", root.querySelector(".qbd-work-thinking-label")?.textContent, "Thought for 0:12");
		r.check("réflexion finie : pas de compteur", root.querySelector(".qbd-work-elapsed"), null);
		const sansDuree = document.createElement("div");
		renderThread(sansDuree, fil([{ kind: "thinking", text: "", tokens: 222 }], false), deps);
		r.check("réflexion finie sans durée : « Thought »", sansDuree.querySelector(".qbd-work-thinking-label")?.textContent, "Thought");
		r.check("réflexion finie : jetons gardés", sansDuree.querySelector(".qbd-work-tokens")?.textContent, "~222 tokens");
	}

	// 21. Claude Code's Update view: a Write is a file preview (numbers, no marker, no add class);
	//     a removed line is plain dimmed text (no syntax spans).
	{
		const root = document.createElement("div");
		renderThread(root, fil([
			{ kind: "tool", id: "u1", name: "Write", input: JSON.stringify({ file_path: "C:\\x\\n.ts" }), preview: "", lines: 0, status: "ok", diff: { added: ["const a = 1"], removed: [] } },
			{ kind: "tool", id: "u2", name: "Edit", input: JSON.stringify({ file_path: "C:\\x\\n.ts" }), preview: "", lines: 0, status: "ok", diff: { added: [], removed: ["const b = 2"] } },
		]), deps);
		root.querySelectorAll(".qbd-work-tool-head").forEach(h => click(h));
		const ecrit = root.querySelector(".qbd-work-diff-write");
		r.check("Write : ligne numérotée sans marqueur", ecrit?.querySelector(".qbd-work-marker")?.textContent, "");
		r.check("Write : aucune classe d'ajout", root.querySelectorAll(".qbd-work-diff-add").length, 0);
		r.check("retrait : code sans coloration syntaxique", root.querySelectorAll(".qbd-work-diff-del .qbd-work-code span").length, 0);
		r.check("retrait : marqueur « - »", root.querySelector(".qbd-work-diff-del .qbd-work-marker")?.textContent, "-");
	}
	r.done();
});
