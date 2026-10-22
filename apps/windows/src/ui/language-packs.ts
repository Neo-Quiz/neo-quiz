/* ══════════════════════════════════════════════════════════
   SETTINGS › LANGUAGES — the downloadable language packs, seen from the
   renderer (task 10 of docs/superpowers/plans/2026-09-28-c-cpp-execution.md,
   widened to Python by task 7 of 2026-10-04-python-pack).

   One row per pack, Python then "C and C++ (Clang)": its state (installed
   version and size, or not installed), where it comes from (the release page,
   a link that opens in the system browser: the page never fetches it), a
   switch that turns running off without deleting, and a Download button or a
   red bin to Delete. Deleting asks nothing more than the bin: the pack is
   re-downloadable, and ▶ on a block downloads it again by itself. Everything
   goes through the bridge (`pont().langages`, electron/langages.ts): the
   renderer only NAMES the pack, never a URL to fetch or a path. `pont()` is
   read at call time, never captured at module load (same rule as fond.ts).
══════════════════════════════════════════════════════════ */

import { pont } from "../host/pont";
import { PAGES_PACKS } from "../../electron/pont";
import { langageActif, reglerLangageActif } from "../host/code";
import { estMobile } from "../host/platform";
import { currentHost } from "../../../../src/host/current";
import { currentLang, t } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";

type Pack = "c";

/** Megabytes in the UI language's own digits (`Intl.NumberFormat`: "0,6"
    in French, "0.6" in English): one decimal under 10 MB, whole above, and
    "< 0,1" rather than a "0" for a library of a few KB. */
export function megaOctets(octets: number): string {
	const mo = octets / 1_000_000;
	const format = (decimales: number, n: number): string =>
		new Intl.NumberFormat(currentLang(), { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(n);
	if (mo < 0.05) return "< " + format(1, 0.1);
	return mo < 9.95 ? format(1, mo) : format(0, Math.round(mo));
}

function mountRow(section: HTMLElement, pack: Pack, isDestroyed: () => boolean): void {
	const row = ajouter(section, "div", "nq-reglages-dossier nq-langage");
	currentHost().ui.setIcon(ajouter(row, "span", "nq-reglages-icone"), "file-code");
	const text = ajouter(row, "div", "nq-reglages-texte");
	ajouter(text, "span", "nq-reglages-nom", t("settings.languages.c"));
	const state = ajouter(text, "span", "nq-reglages-chemin");
	const source = ajouter(text, "span", "nq-reglages-chemin nq-langage-source");
	ajouter(source, "span", "nq-langage-source-nom", t("settings.languages.source"));
	const href = PAGES_PACKS[pack];
	const link = ajouter(source, "a", "nq-langage-lien");
	link.href = href;
	/* Two spans so that, when the room runs out, the MIDDLE is what is cut: the
	   start shrinks with an ellipsis, the end (the version tag) never does. */
	const shown = href.replace("https://", "");
	const cut = shown.lastIndexOf("/") + 1;
	link.title = href;
	ajouter(link, "span", "nq-langage-lien-debut", shown.slice(0, cut));
	ajouter(link, "span", "nq-langage-lien-fin", shown.slice(cut));
	currentHost().ui.setIcon(ajouter(link, "span", "nq-langage-lien-icone"), "external-link");
	link.addEventListener("click", event => {
		event.preventDefault();
		void currentHost().shell.openUrl(href);
	});

	/* The switch: running off or on, the pack stays on disk. */
	const run = ajouter(row, "label", "nq-langage-interrupteur");
	run.title = t("settings.languages.run");
	const toggle = ajouter(run, "input", "nq-set-interrupteur");
	toggle.type = "checkbox";
	toggle.setAttribute("role", "switch");
	toggle.setAttribute("aria-label", t("settings.languages.run"));
	toggle.checked = langageActif(pack);
	toggle.addEventListener("change", () => {
		void reglerLangageActif(pack, toggle.checked).catch(() => { toggle.checked = langageActif(pack); });
	});

	/* ONE slot at the right of the row: the red bin when the pack is installed,
	   a FLAT Download button when it is not (no 3D effect in a modal), and the
	   progress stays in the state line. */
	const slot = ajouter(row, "div", "nq-langage-action");
	const remove = ajouter(slot, "button", "qbd-sync-action qbd-sync-action-danger");
	remove.type = "button";
	remove.hidden = true;
	remove.setAttribute("aria-label", t("settings.languages.delete"));
	remove.title = t("settings.languages.delete");
	currentHost().ui.setIcon(remove, "trash-2");
	remove.addEventListener("click", () => {
		remove.disabled = true;
		void pont().langages.supprimer(pack).catch(() => undefined).then(draw);
	});
	const download = ajouter(slot, "button", "qbd-sync-action nq-langage-telecharger");
	download.type = "button";
	download.hidden = true;
	download.setAttribute("aria-label", t("settings.languages.download"));
	download.title = t("settings.languages.download");
	const downloadIcon = ajouter(download, "span", "nq-langage-telecharger-icone");
	currentHost().ui.setIcon(downloadIcon, "download");
	const percentLabel = ajouter(download, "span", "nq-langage-pourcent");
	percentLabel.hidden = true;
	download.addEventListener("click", () => {
		download.disabled = true;
		downloadIcon.hidden = true;
		percentLabel.hidden = false;
		percentLabel.textContent = "0%";
		void pont().langages.installer(pack, (received, total) => {
			if (isDestroyed()) return;
			const percent = Math.floor((received * 100) / Math.max(1, total));
			state.textContent = t("settings.languages.downloading", { percent });
			percentLabel.textContent = percent + "%";
		}).then(result => {
			if (isDestroyed()) return;
			if (!result.ok) currentHost().ui.notice(t(result.code === "empreinte" ? "settings.languages.refused" : "settings.languages.offline"));
			return draw();
		}, () => { if (!isDestroyed()) { currentHost().ui.notice(t("settings.languages.offline")); void draw(); } });
	});

	async function draw(): Promise<void> {
		const st = await pont().langages.etat(pack).catch(() => ({ installe: false, version: null, octets: 0 }));
		if (isDestroyed()) return;
		remove.hidden = !st.installe;
		remove.disabled = false;
		download.hidden = st.installe;
		download.disabled = false;
		state.textContent = st.installe
			? t("settings.languages.installed", { version: st.version ?? "", size: megaOctets(st.octets) })
			: t("settings.languages.notInstalled");
	}

	void draw();
}

/* The NATIVE Python (`pont().python`): the managed interpreter, then one
   plain line per installed library A USER INSTALLS (torch, numpy, pandas…,
   `etat().racines`), never a line for a dependency on its own: each size
   counts the library and the dependencies no other installed one needs,
   which its uninstall removes with it. Libraries download by themselves the
   first time a block imports them; here they can only be removed, a library
   that another installed one needs being refused (button off, the line says
   by whom). On the phone Python runs on the PC, so the row is a single line. */
function mountPythonRow(section: HTMLElement, isDestroyed: () => boolean): void {
	const row = ajouter(section, "div", "nq-reglages-dossier nq-langage nq-python");
	currentHost().ui.setIcon(ajouter(row, "span", "nq-reglages-icone"), "file-code-2");
	const text = ajouter(row, "div", "nq-reglages-texte");
	ajouter(text, "span", "nq-reglages-nom", t("settings.languages.python"));
	const state = ajouter(text, "span", "nq-reglages-chemin");
	if (estMobile()) {
		state.textContent = t("settings.python.onPc");
		return;
	}

	const run = ajouter(row, "label", "nq-langage-interrupteur");
	const toggle = ajouter(run, "input", "nq-set-interrupteur");
	toggle.type = "checkbox";
	toggle.setAttribute("role", "switch");
	toggle.setAttribute("aria-label", t("settings.languages.run"));
	toggle.checked = langageActif("python");
	toggle.addEventListener("change", () => {
		void reglerLangageActif("python", toggle.checked).catch(() => { toggle.checked = langageActif("python"); });
	});

	const slot = ajouter(row, "div", "nq-langage-action");
	const remove = ajouter(slot, "button", "qbd-sync-action qbd-sync-action-danger");
	remove.type = "button";
	remove.hidden = true;
	remove.setAttribute("aria-label", t("settings.languages.delete"));
	currentHost().ui.setIcon(remove, "trash-2");
	const download = ajouter(slot, "button", "qbd-sync-action nq-langage-telecharger");
	download.type = "button";
	download.hidden = true;
	download.setAttribute("aria-label", t("settings.languages.download"));
	const downloadIcon = ajouter(download, "span", "nq-langage-telecharger-icone");
	currentHost().ui.setIcon(downloadIcon, "download");
	const percentLabel = ajouter(download, "span", "nq-langage-pourcent");
	percentLabel.hidden = true;

	const libs = ajouter(section, "div", "nq-python-libs");

	function refuse(code: string): void {
		currentHost().ui.notice(t(code === "occupe" ? "settings.python.busy" : "settings.python.failed"));
	}

	remove.addEventListener("click", () => {
		remove.disabled = true;
		void pont().python.supprimerTout().then(res => { if (!res.ok && !isDestroyed()) refuse(res.code); }, () => { if (!isDestroyed()) refuse("io"); }).then(draw);
	});
	download.addEventListener("click", () => {
		download.disabled = true;
		downloadIcon.hidden = true;
		percentLabel.hidden = false;
		percentLabel.textContent = "0%";
		void pont().python.installer([], (received, total) => {
			if (isDestroyed()) return;
			const percent = Math.floor((received * 100) / Math.max(1, total));
			state.textContent = t("settings.languages.downloading", { percent });
			percentLabel.textContent = percent + "%";
		}).then(result => {
			if (isDestroyed()) return;
			if (!result.ok) currentHost().ui.notice(t(result.code === "empreinte" ? "settings.languages.refused" : "settings.languages.offline"));
			return draw();
		}, () => { if (!isDestroyed()) { currentHost().ui.notice(t("settings.languages.offline")); void draw(); } });
	});

	async function draw(): Promise<void> {
		const st = await pont().python.etat().catch(() => ({ interprete: false, version: null, paquets: [], octetsTotal: 0, racines: [] }));
		if (isDestroyed()) return;
		remove.hidden = !st.interprete;
		remove.disabled = false;
		download.hidden = st.interprete;
		download.disabled = false;
		downloadIcon.hidden = false;
		percentLabel.hidden = true;
		state.textContent = st.interprete
			? t("settings.languages.installed", { version: st.version ?? "", size: megaOctets(st.octetsTotal) })
			: t("settings.languages.notInstalled");
		libs.replaceChildren();
		libs.hidden = !st.interprete;
		if (!st.interprete) return;
		const racines = st.racines ?? [];
		if (!racines.length) {
			ajouter(libs, "div", "nq-python-lib-vide", t("settings.python.none"));
			return;
		}
		const somme = st.paquets.reduce((n, p) => n + p.octets, 0);
		ajouter(libs, "div", "nq-python-libs-titre", t("settings.python.libraries", { size: megaOctets(somme) }));
		for (const p of racines) {
			const ligne = ajouter(libs, "div", "nq-python-lib");
			const nom = ajouter(ligne, "div", "nq-python-lib-texte");
			ajouter(nom, "span", "nq-python-lib-nom", p.nom + " " + p.version);
			const taille = t("settings.python.size", { size: megaOctets(p.octets) });
			ajouter(nom, "span", "nq-python-lib-detail", p.requisPar.length ? taille + " · " + t("settings.python.requiredBy", { names: p.requisPar.join(", ") }) : taille);
			const bouton = ajouter(ligne, "button", "qbd-sync-action qbd-sync-action-danger nq-python-lib-bouton", t("settings.python.uninstall"));
			bouton.type = "button";
			bouton.disabled = p.requisPar.length > 0;
			bouton.setAttribute("aria-label", t("settings.python.uninstall") + " " + p.nom);
			bouton.addEventListener("click", () => {
				bouton.disabled = true;
				void pont().python.desinstaller(p.nom).then(res => {
					if (!res.ok && "code" in res && !isDestroyed()) refuse(res.code);
				}, () => { if (!isDestroyed()) refuse("io"); }).then(draw);
			});
		}
	}

	void draw();
}

export function mountLanguagePackSettings(section: HTMLElement): () => void {
	let destroyed = false;
	mountPythonRow(section, () => destroyed);
	mountRow(section, "c", () => destroyed);
	return () => { destroyed = true; };
}
