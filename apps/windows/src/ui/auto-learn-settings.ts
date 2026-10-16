/* SETTINGS › MOODLE › New lectures: the automatic Learn preference (mode, the
   usage limits). Painted once at mount from the stored setting; every change
   saves the whole `aiAutoLearn` value. The tool is NOT chosen here: it is the
   model of the AI page composer, shown read-only with its live usage line. */

import { t } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";
import { currentHost } from "../../../../src/host/current";
import type { AiSettingsHost } from "../../../../src/dashboard/ai-settings-host";
import { AUTO_LEARN_LIMITS, quotaApplies, readAutoLearnSettings } from "../../../../src/dashboard/auto-learn-gate";
import type { AutoLearnSettings } from "../../../../src/dashboard/auto-learn-gate";
import { getProvider, libelleModele } from "../../../../src/dashboard/ai-providers";
import { placerIndicateur } from "../../../../src/dashboard/seg-indic";
import { mountUsageLine } from "../../../../src/dashboard/usage-line";
import { interrupteurReglage, ligneReglage } from "./moodle-common";

type Rule = "session" | "weekly" | "daily";

export function mountAutoLearnSettings(parent: HTMLElement, ai: AiSettingsHost): () => void {
	let detruit = false;
	let usage: { destroy(): void } | null = null;

	function peindre(): void {
		usage?.destroy();
		usage = null;
		parent.replaceChildren();
		const reglage = readAutoLearnSettings(ai.get().aiAutoLearn);
		/* The latest value handed to a save: two quick edits before the repaint must not overwrite each other. */
		let courant = reglage;
		const p = ai.get().aiProvider || "";
		const sec = ajouter(parent, "section", "nq-reglages-section");
		ajouter(sec, "h3", "nq-reglages-titre", t("settings.moodle.newLectures"));
		const carte = ajouter(sec, "div", "nq-set-carte");

		const enregistrer = (fn: (cur: AutoLearnSettings) => AutoLearnSettings): void => {
			const suivant = fn(courant);
			courant = suivant;
			void ai.save({ aiAutoLearn: suivant }).catch(() => undefined).finally(() => { if (!detruit) peindre(); });
		};

		/* 1. Mode: the segmented selector of the planning dialogs. */
		const mode = ligneReglage(carte, t("settings.moodle.autoLearnMode"), t("settings.moodle.autoLearnModeHelp"));
		const seg = ajouter(mode.controle, "div", "qbd-planning-unit");
		seg.setAttribute("role", "radiogroup");
		seg.setAttribute("aria-label", t("settings.moodle.autoLearnMode"));
		const indic = ajouter(seg, "div", "qbd-planning-unit-indic");
		const libelles = { off: "settings.moodle.autoLearnOff", propose: "settings.moodle.autoLearnPropose", auto: "settings.moodle.autoLearnAuto" } as const;
		const boutons = (["off", "propose", "auto"] as const).map(m => {
			const b = ajouter(seg, "button", "qbd-planning-unit-btn", t(libelles[m]));
			b.type = "button";
			b.setAttribute("role", "radio");
			b.classList.toggle("is-active", m === reglage.mode);
			b.setAttribute("aria-checked", String(m === reglage.mode));
			b.addEventListener("click", () => { if (m !== courant.mode) enregistrer(cur => ({ ...cur, mode: m })); });
			return { m, b };
		});
		requestAnimationFrame(() => {
			const actif = boutons.find(x => x.m === reglage.mode)?.b;
			if (actif && actif.isConnected) placerIndicateur(indic, actif, false);
		});

		/* 2. Tool: read-only. */
		const outil = ligneReglage(carte, t("settings.moodle.autoLearnTool"), t("settings.moodle.autoLearnToolHelp"));
		ajouter(outil.controle, "span", "nq-moodle-outil",
			p ? `${getProvider(p).name} · ${libelleModele(p, ai.get().aiModel || "")}` : t("settings.moodle.autoLearnNoTool"));
		const proc = currentHost().process;
		if ((p === "claude-code" || p === "codex") && proc?.usageCompte) {
			const emplacement = ajouter(carte, "div", "nq-moodle-usage");
			usage = mountUsageLine(emplacement, p === "claude-code" ? "claude" : "codex", o => proc.usageCompte(o));
		}

		/* 3. Rules. */
		const regle = (cle: Rule, titre: "autoLearnSession" | "autoLearnWeekly" | "autoLearnDaily", pct: boolean, actif: boolean): void => {
			const nom = t(`settings.moodle.${titre}`);
			const l = ligneReglage(carte, nom);
			const [min, max] = AUTO_LEARN_LIMITS[cle];
			const champ = ajouter(l.controle, "input", "nq-set-nombre");
			champ.type = "number";
			champ.min = String(min);
			champ.max = String(max);
			champ.step = "1";
			champ.value = String(reglage[cle].value);
			champ.setAttribute("aria-label", nom);
			if (pct) ajouter(l.controle, "span", "nq-set-suffixe", "%");
			const sw = interrupteurReglage(l.controle, nom, reglage[cle].on, v => enregistrer(cur => ({ ...cur, [cle]: { ...cur[cle], on: v } })));
			champ.addEventListener("change", () => {
				const n = Number(champ.value);
				if (champ.value.trim() === "" || !Number.isInteger(n) || n < min || n > max) {
					champ.setAttribute("aria-invalid", "true");
					return;
				}
				champ.removeAttribute("aria-invalid");
				enregistrer(cur => ({ ...cur, [cle]: { ...cur[cle], value: n } }));
			});
			champ.disabled = !actif;
			sw.disabled = !actif;
		};
		const quota = quotaApplies(p);
		regle("session", "autoLearnSession", true, quota);
		regle("weekly", "autoLearnWeekly", true, quota);
		if (!quota) ajouter(carte, "div", "nq-set-ligne-aide nq-moodle-indice", t("settings.moodle.autoLearnNoQuota"));
		regle("daily", "autoLearnDaily", false, true);

		/* 4. Slides. */
		ajouter(carte, "div", "nq-set-ligne-aide nq-moodle-indice", t("settings.moodle.autoLearnSlides"));
	}

	peindre();
	return () => { detruit = true; usage?.destroy(); usage = null; };
}
