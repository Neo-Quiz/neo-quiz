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

await withSrcModule(["src/dashboard/work-view.ts", "src/host/current.ts"], async ({ renderThread }, { installHost }) => {
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

	r.done();
});
