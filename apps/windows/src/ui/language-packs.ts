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
	ajouter(source, "span", undefined, t("settings.languages.source") + " ");
	const href = PAGES_PACKS[pack];
	const link = ajouter(source, "a", "nq-langage-lien");
	link.href = href;
	ajouter(link, "span", undefined, href.replace("https://", ""));
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

	/* Delete is a red bin IN the row (2026-10-04), like a paired device's;
	   Download stays a button under it. */
	const remove = ajouter(row, "button", "qbd-sync-action qbd-sync-action-danger");
	remove.type = "button";
	remove.hidden = true;
	remove.setAttribute("aria-label", t("settings.languages.delete"));
	remove.title = t("settings.languages.delete");
	currentHost().ui.setIcon(remove, "trash-2");
	remove.addEventListener("click", () => {
		remove.disabled = true;
		void pont().langages.supprimer(pack).catch(() => undefined).then(draw);
	});
	const actions = ajouter(section, "div", "nq-reglages-actions");

	function button(icon: string, label: string): HTMLButtonElement {
		const b = ajouter(actions, "button", "qbd-btn--create");
		b.type = "button";
		currentHost().ui.setIcon(ajouter(b, "span", "qbd-btn-icon"), icon);
		ajouter(b, "span", undefined, label);
		return b;
	}

	async function draw(): Promise<void> {
		const st = await pont().langages.etat(pack).catch(() => ({ installe: false, version: null, octets: 0 }));
		if (isDestroyed()) return;
		actions.replaceChildren();
		remove.hidden = !st.installe;
		remove.disabled = false;
		if (st.installe) {
			state.textContent = t("settings.languages.installed", { version: st.version ?? "", size: megaOctets(st.octets) });
			return;
		}
		state.textContent = t("settings.languages.notInstalled");
		const download = button("download", t("settings.languages.download"));
		download.addEventListener("click", () => {
			download.disabled = true;
			void pont().langages.installer(pack, (received, total) => {
				if (!isDestroyed()) state.textContent = t("settings.languages.downloading", { percent: Math.floor((received * 100) / Math.max(1, total)) });
			}).then(result => {
				if (isDestroyed()) return;
				if (!result.ok) currentHost().ui.notice(t(result.code === "empreinte" ? "settings.languages.refused" : "settings.languages.offline"));
				return draw();
			}, () => { if (!isDestroyed()) { currentHost().ui.notice(t("settings.languages.offline")); void draw(); } });
		});
	}

	void draw();
}

export function mountLanguagePackSettings(section: HTMLElement): () => void {
	let destroyed = false;
	for (const pack of ["python", "c"] as const) mountRow(section, pack, () => destroyed);
	return () => { destroyed = true; };
}
