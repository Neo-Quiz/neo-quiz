/**
 * SETTINGS > LANGUAGES > PYTHON (`apps/windows/src/ui/language-packs.ts`), on
 * a linkedom DOM and a fake `window.neo.python`. What it prevents: a library
 * list that hides what takes disk space, an Uninstall that is live on a
 * library other ones need (the main process would refuse, the button must say
 * so first), a "busy" refusal that vanishes silently, and the phone getting
 * download / delete / list controls for a Python that only runs on the PC.
 *
 *     npm run check:python-settings
 */
import { parseHTML } from "linkedom";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const { window, document } = parseHTML("<html><body></body></html>");
globalThis.window = window;
globalThis.document = document;
globalThis.HTMLElement = window.HTMLElement;

await withSrcModule(["apps/windows/src/ui/language-packs.ts", "src/host/current.ts"], async (L, H) => {
	const rep = makeReporter("Settings - Python interpreter and libraries");
	const r = { check: (nom, cond) => rep.check(nom, Boolean(cond), true), done: () => rep.done() };
	const notices = [];
	H.installHost({ ui: { setIcon(el, name) { el.dataset.icon = name; }, notice: m => { notices.push(m); } }, shell: { openUrl: async () => {} } });

	let etat;
	let desinstalleReponse = { ok: true };
	const appels = { desinstaller: [], supprimerTout: 0 };
	const lecture = { interprete: true, version: "3.14.0", octetsTotal: 2_600_000_000 };
	etat = {
		...lecture,
		paquets: [
			{ nom: "torch", version: "2.9.0", octets: 2_400_000_000, requisPar: [] },
			{ nom: "numpy", version: "2.3.0", octets: 15_000_000, requisPar: ["torch"] },
			{ nom: "six", version: "1.17.0", octets: 400_000, requisPar: [] },
		],
	};
	window.neo = {
		reglages: { lire: async () => [], ecrire: async () => {} },
		python: {
			etat: async () => structuredClone(etat),
			installer: async () => ({ ok: true }),
			desinstaller: async nom => { appels.desinstaller.push(nom); if (desinstalleReponse.ok) etat.paquets = etat.paquets.filter(p => p.nom !== nom); return desinstalleReponse; },
			supprimerTout: async () => { appels.supprimerTout++; return { ok: true }; },
		},
		langages: { etat: async () => ({ installe: false, version: null, octets: 0 }), installer: async () => ({ ok: true }), supprimer: async () => {} },
	};
	const attendre = () => new Promise(res => setTimeout(res, 20));
	const monter = async () => {
		document.body.replaceChildren();
		const section = document.createElement("div");
		document.body.append(section);
		const demonter = L.mountLanguagePackSettings(section);
		await attendre();
		return { section, demonter };
	};

	// Desktop: the list, the sizes, the disabled dependency.
	{
		const { section, demonter } = await monter();
		const lignes = [...section.querySelectorAll(".nq-python-lib")];
		r.check("one plain row per installed library", lignes.length === 3);
		r.check("a row carries name, version and size", lignes[0].textContent.includes("torch 2.9.0") && lignes[0].textContent.includes("2400 MB"));
		r.check("one decimal under 10 MB", lignes[2].textContent.includes("0.4 MB"));
		r.check("heading gives the total of the libraries", section.querySelector(".nq-python-libs-titre").textContent === "Installed libraries · 2415 MB");
		const boutons = lignes.map(l => l.querySelector("button"));
		r.check("a library other ones need has Uninstall off", boutons[1].disabled === true);
		r.check("... and the line names who needs it", lignes[1].textContent.includes("Needed by torch"));
		r.check("a leaf has Uninstall on", boutons[0].disabled === false && boutons[2].disabled === false);
		r.check("no native title tooltip on the list", !section.querySelector(".nq-python-libs [title]"));
		// Uninstall a leaf.
		boutons[2].dispatchEvent(new window.Event("click"));
		await attendre();
		r.check("Uninstall on a leaf calls desinstaller with its name", appels.desinstaller.join() === "six");
		r.check("the row leaves the list after", section.querySelectorAll(".nq-python-lib").length === 2);
		// Busy refusal shows a notice.
		desinstalleReponse = { ok: false, code: "occupe" };
		section.querySelector(".nq-python-lib button:not(:disabled)").dispatchEvent(new window.Event("click"));
		await attendre();
		r.check("a busy refusal shows the busy notice", notices.at(-1) === "Python is running: try again in a moment.");
		desinstalleReponse = { ok: true };
		// Delete = supprimerTout.
		section.querySelector(".nq-python .qbd-sync-action-danger").dispatchEvent(new window.Event("click"));
		await attendre();
		r.check("the row's bin removes everything", appels.supprimerTout === 1);
		demonter();
	}

	// Interpreter without libraries: the hint, no heading.
	{
		etat = { ...lecture, paquets: [] };
		const { section, demonter } = await monter();
		r.check("no library: the hint line, no rows", section.querySelectorAll(".nq-python-lib").length === 0 && section.querySelector(".nq-python-lib-vide").textContent.startsWith("No library installed yet"));
		demonter();
	}

	// Not installed: Download, no list.
	{
		etat = { interprete: false, version: null, paquets: [], octetsTotal: 0 };
		const { section, demonter } = await monter();
		const dl = section.querySelector(".nq-python .nq-langage-telecharger");
		r.check("not installed: Download shown, bin hidden, list hidden", dl.hidden === false && section.querySelector(".nq-python .qbd-sync-action-danger").hidden === true && section.querySelector(".nq-python-libs").hidden === true);
		demonter();
	}

	// Phone: one line.
	{
		globalThis.neoPlatform = { mobile: true };
		etat = { ...lecture, paquets: [{ nom: "torch", version: "2.9.0", octets: 1, requisPar: [] }] };
		const { section, demonter } = await monter();
		const py = section.querySelector(".nq-python");
		r.check("phone: only the on-PC line", py.textContent.includes("Python runs on your PC.") && !py.querySelector("button") && !section.querySelector(".nq-python-libs"));
		demonter();
		delete globalThis.neoPlatform;
	}

	r.done();
});
