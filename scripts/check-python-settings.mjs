/**
 * SETTINGS > LANGUAGES > PYTHON (`apps/windows/src/ui/language-packs.ts`), on
 * a linkedom DOM and a fake `window.neo.python`. What it prevents: a library
 * list that hides what takes disk space, an Uninstall that is live on a
 * library other ones need (the main process would refuse, the button must say
 * so first), a "busy" refusal that vanishes silently, and the phone getting
 * download / delete / list controls for a Python that only runs on the PC;
 * and a device allowed (or refused) to run Python here that the owner can
 * neither see nor remove.
 *
 *     npm run check:python-settings
 */
import { parseHTML } from "linkedom";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const { window, document } = parseHTML("<html><body></body></html>");
globalThis.window = window;
globalThis.document = document;
globalThis.HTMLElement = window.HTMLElement;

await withSrcModule(["apps/windows/src/ui/language-packs.ts", "src/host/current.ts", "src/i18n.ts"], async (L, H, I) => {
	I.setLanguage("en");
	const rep = makeReporter("Settings - Python interpreter and libraries");
	const r = { check: (nom, cond) => rep.check(nom, Boolean(cond), true), done: () => rep.done() };
	const notices = [];
	H.installHost({ ui: { setIcon(el, name) { el.dataset.icon = name; }, notice: m => { notices.push(m); } }, shell: { openUrl: async () => {} } });

	let etat;
	let desinstalleReponse = { ok: true };
	const appels = { desinstaller: [], supprimerTout: 0, oublier: [] };
	let appareils = [];
	const lecture = { interprete: true, version: "3.14.0", octetsTotal: 2_600_000_000 };
	/* B2: every installed package is in `paquets`; Settings lists `racines` only
	   (each with the dependencies no other installed root needs). */
	etat = {
		...lecture,
		paquets: [
			{ nom: "torch", version: "2.9.0", octets: 2_399_000_000, requisPar: [] },
			{ nom: "filelock", version: "3.0", octets: 1_000_000, requisPar: ["torch"] },
			{ nom: "numpy", version: "2.3.0", octets: 15_000_000, requisPar: ["pandas"] },
			{ nom: "pandas", version: "2.2.0", octets: 600_000, requisPar: [] },
			{ nom: "tzdata", version: "1", octets: 20_000, requisPar: ["pandas"] },
		],
		racines: [
			{ nom: "numpy", version: "2.3.0", octets: 15_000_000, requisPar: ["pandas"] },
			{ nom: "pandas", version: "2.2.0", octets: 620_000, requisPar: [] },
			{ nom: "torch", version: "2.9.0", octets: 2_400_000_000, requisPar: [] },
		],
	};
	window.neo = {
		reglages: { lire: async () => [], ecrire: async () => {} },
		python: {
			etat: async () => structuredClone(etat),
			installer: async () => ({ ok: true }),
			desinstaller: async nom => { appels.desinstaller.push(nom); if (desinstalleReponse.ok) etat.racines = etat.racines.filter(p => p.nom !== nom); return desinstalleReponse; },
			supprimerTout: async () => { appels.supprimerTout++; return { ok: true }; },
			appareils: async () => structuredClone(appareils),
			oublierAppareil: async id => { appels.oublier.push(id); appareils = appareils.filter(a => a.id !== id); },
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
		r.check("B2: one row per library a user installs, never a dependency alone", lignes.length === 3 && !section.textContent.includes("filelock") && !section.textContent.includes("tzdata"));
		r.check("B2: a row carries name, version and the size with its own dependencies", lignes[2].textContent.includes("torch 2.9.0") && lignes[2].textContent.includes("2,400 MB"));
		r.check("B3: one decimal under 10 MB", lignes[1].textContent.includes("0.6 MB"));
		r.check("heading gives the total of the libraries", section.querySelector(".nq-python-libs-titre").textContent === "Installed libraries · 2,416 MB");
		const boutons = lignes.map(l => l.querySelector("button"));
		r.check("B2: a library another one needs has Uninstall off", boutons[0].disabled === true);
		r.check("... and the line names who needs it", lignes[0].textContent.includes("Needed by pandas"));
		r.check("a library nothing needs has Uninstall on", boutons[1].disabled === false && boutons[2].disabled === false);
		r.check("no native title tooltip on the list", !section.querySelector(".nq-python-libs [title]"));
		// Uninstall a root.
		boutons[1].dispatchEvent(new window.Event("click"));
		await attendre();
		r.check("Uninstall calls desinstaller with the root's name", appels.desinstaller.join() === "pandas");
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

	// The devices of the Python gate: listed with their state, each removable.
	{
		appareils = [{ id: "TELTEL3-AAA", nom: "Pixel 9", etat: "autorise", at: 1 }, { id: "AUTRE45-BBB", nom: "Tablet", etat: "refuse", at: 2 }];
		const { section, demonter } = await monter();
		const bloc = [...section.querySelectorAll(".nq-python-libs")].find(b => b.textContent.includes("Devices that can ask"));
		const lignes = bloc ? [...bloc.querySelectorAll(".nq-python-lib")] : [];
		r.check("devices: one row per device, name and state", lignes.length === 2 && lignes[0].textContent.includes("Pixel 9") && lignes[0].textContent.includes("Allowed") && lignes[1].textContent.includes("Refused"));
		r.check("devices: each Remove names its device for screen readers", lignes[0]?.querySelector("button")?.getAttribute("aria-label") === "Remove Pixel 9");
		lignes[1]?.querySelector("button").dispatchEvent(new window.Event("click"));
		await attendre();
		r.check("devices: Remove forgets that device by its Syncthing id, the row leaves", appels.oublier.join() === "AUTRE45-BBB" && bloc.querySelectorAll(".nq-python-lib").length === 1);
		appareils = [];
		demonter();
		const vide = await monter();
		r.check("devices: none -> no heading", !vide.section.textContent.includes("Devices that can ask"));
		vide.demonter();
	}

	// Interpreter without libraries: the hint, no heading.
	{
		etat = { ...lecture, paquets: [], racines: [] };
		const { section, demonter } = await monter();
		r.check("no library: the hint line, no rows", section.querySelectorAll(".nq-python-lib").length === 0 && section.querySelector(".nq-python-lib-vide").textContent.startsWith("No library installed yet"));
		demonter();
	}

	// Not installed: Download, no list.
	{
		etat = { interprete: false, version: null, paquets: [], octetsTotal: 0, racines: [] };
		const { section, demonter } = await monter();
		const dl = section.querySelector(".nq-python .nq-langage-telecharger");
		r.check("not installed: Download shown, bin hidden, list hidden", dl.hidden === false && section.querySelector(".nq-python .qbd-sync-action-danger").hidden === true && section.querySelector(".nq-python-libs").hidden === true);
		demonter();
	}

	// B3: the UI language's decimal separator, and "< 0.1" instead of 0.
	{
		r.check("B3: English decimals, tiny sizes", [L.megaOctets(600_000), L.megaOctets(8_000), L.megaOctets(0), L.megaOctets(12_400_000)].join("|") === "0.6|< 0.1|< 0.1|12");
		I.setLanguage("fr");
		const fr = [L.megaOctets(600_000), L.megaOctets(8_000), L.megaOctets(2_400_000_000)];
		r.check("B3: French decimals (comma), French grouping, tiny sizes", fr[0] === "0,6" && fr[1] === "< 0,1" && fr[2] !== "2400" && fr[2].replace(/[^0-9]/g, "") === "2400");
		etat = { ...lecture, paquets: [], racines: [{ nom: "numpy", version: "2.3.0", octets: 15_000_000, requisPar: ["pandas"] }, { nom: "seaborn", version: "0.13", octets: 8_000, requisPar: [] }] };
		const { section, demonter } = await monter();
		const lignes = [...section.querySelectorAll(".nq-python-lib")];
		r.check("B2/B3 in French: Nécessaire à pandas, < 0,1 Mo", lignes[0].textContent.includes("Nécessaire à pandas") && lignes[1].textContent.includes("< 0,1 Mo"));
		r.check("B1: the hint says Python runs on this PC, C/C++ isolated (fr)", I.t("settings.languages.hint").includes("Python s'exécute sur ce PC avec accès à tes fichiers et à Internet") && I.t("settings.languages.hint").startsWith("C et C++"));
		demonter();
		I.setLanguage("en");
		r.check("B1: the hint says Python runs on this PC, C/C++ isolated (en)", I.t("settings.languages.hint").includes("Python runs on this PC with access to your files and the Internet") && I.t("settings.languages.hint").startsWith("C and C++"));
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
