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
import { currentHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";

type Pack = "python" | "c";

/** Bytes as whole megabytes, the unit a 120 MB pack is read in. */
function megaOctets(octets: number): number {
	return Math.max(1, Math.round(octets / 1_000_000));
}

function mountRow(section: HTMLElement, pack: Pack, isDestroyed: () => boolean): void {
	const row = ajouter(section, "div", "nq-reglages-dossier nq-langage");
	currentHost().ui.setIcon(ajouter(row, "span", "nq-reglages-icone"), pack === "python" ? "file-code-2" : "file-code");
	const text = ajouter(row, "div", "nq-reglages-texte");
	ajouter(text, "span", "nq-reglages-nom", t(pack === "python" ? "settings.languages.python" : "settings.languages.c"));
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

export function mountLanguagePackSettings(section: HTMLElement): () => void {
	let destroyed = false;
	for (const pack of ["python", "c"] as const) mountRow(section, pack, () => destroyed);
	return () => { destroyed = true; };
}
