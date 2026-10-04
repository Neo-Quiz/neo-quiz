/* ══════════════════════════════════════════════════════════
   SETTINGS › LANGUAGES — the downloadable language packs, seen from the
   renderer (task 10 of docs/superpowers/plans/2026-09-28-c-cpp-execution.md).

   One row today, "C and C++ (Clang)": its state (installed version and size,
   or not installed) and a Download button, or a red bin to Delete. Deleting asks
   nothing more than the bin: the pack is re-downloadable, and ▶ on a C
   block downloads it again by itself. Everything goes through the bridge
   (`pont().langages`, electron/langages.ts): the renderer only NAMES the
   pack, never a URL or a path. `pont()` is read at call time, never captured
   at module load (same rule as fond.ts).
══════════════════════════════════════════════════════════ */

import { pont } from "../host/pont";
import { currentHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";

/** Bytes as whole megabytes, the unit a 120 MB pack is read in. */
function megaOctets(octets: number): number {
	return Math.max(1, Math.round(octets / 1_000_000));
}

export function mountLanguagePackSettings(section: HTMLElement): () => void {
	let destroyed = false;
	const row = ajouter(section, "div", "nq-reglages-dossier");
	currentHost().ui.setIcon(ajouter(row, "span", "nq-reglages-icone"), "file-code");
	const text = ajouter(row, "div", "nq-reglages-texte");
	ajouter(text, "span", "nq-reglages-nom", t("settings.languages.c"));
	const state = ajouter(text, "span", "nq-reglages-chemin");
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
		void pont().langages.supprimer("c").catch(() => undefined).then(draw);
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
		const st = await pont().langages.etat("c").catch(() => ({ installe: false, version: null, octets: 0 }));
		if (destroyed) return;
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
			void pont().langages.installer("c", (received, total) => {
				if (!destroyed) state.textContent = t("settings.languages.downloading", { percent: Math.floor((received * 100) / Math.max(1, total)) });
			}).then(result => {
				if (destroyed) return;
				if (!result.ok) currentHost().ui.notice(t(result.code === "empreinte" ? "settings.languages.refused" : "settings.languages.offline"));
				return draw();
			}, () => { if (!destroyed) { currentHost().ui.notice(t("settings.languages.offline")); void draw(); } });
		});
	}

	void draw();
	return () => { destroyed = true; };
}
