/* ══════════════════════════════════════════════════════════
   WHAT THE PROGRESS STEP SAYS — shared by the bootstrapper and the update window

   The bootstrapper (`renderer-reference.ts`) and the window shown while an
   update installs (`electron/fenetre-maj.ts`) present the same steps:
   download, verification, installation with its percentage. The wording, the
   number formats and the phase -> text mapping live here, once; a copy would
   drift without a word. Pure: only the i18n dictionary, no DOM, no Electron
   (`npm run check:installer` exercises it).
══════════════════════════════════════════════════════════ */

import { currentLang, t } from "../../../src/i18n";
import type { EtatInstallateur } from "./protocole";

export function formatOctets(octets: number): string {
	const langue = currentLang() === "fr" ? "fr-FR" : "en-US";
	let diviseur = 1_000_000;
	let unite = "megabyte";
	if (octets >= 1_000_000_000_000) {
		diviseur = 1_000_000_000_000;
		unite = "terabyte";
	} else if (octets >= 1_000_000_000) {
		diviseur = 1_000_000_000;
		unite = "gigabyte";
	}
	return new Intl.NumberFormat(langue, {
		style: "unit",
		unit: unite,
		unitDisplay: "short",
		maximumFractionDigits: 1,
	}).format(octets / diviseur);
}

export function formatPourcent(pourcent: number): string {
	return new Intl.NumberFormat(currentLang() === "fr" ? "fr-FR" : "en-US", {
		maximumFractionDigits: 1,
	}).format(Math.max(0, Math.min(100, pourcent)));
}

export function detailTelechargement(recus: number, total: number, debit: number | null): string {
	const restant = Math.max(0, total - recus);
	if (debit && debit > 0 && restant > 0) {
		return t("installer.status.downloadDetail", {
			downloaded: formatOctets(recus),
			total: formatOctets(total),
			seconds: Math.max(1, Math.ceil(restant / debit)),
		});
	}
	return t("installer.status.downloadDetailNoTime", {
		downloaded: formatOctets(recus),
		total: formatOctets(total),
	});
}

export interface LibellesProgression {
	pourcent: number | null;
	statut: string;
	detail: string | null;
}

/** The three values a progress step shows for a phase. `debit` is the measured
    download speed in bytes per second, when known. */
export function libellesProgression(etat: EtatInstallateur, debit: number | null): LibellesProgression {
	let pourcent: number | null = null;
	let statut = t("installer.status.downloadingPending");
	let detail: string | null = null;
	if (etat.phase === "telechargement") {
		pourcent = etat.total > 0 ? (etat.recus / etat.total) * 100 : 0;
		statut = t("installer.status.downloading", { percent: formatPourcent(pourcent) });
		detail = detailTelechargement(etat.recus, etat.total, debit);
	} else if (etat.phase === "verification") {
		/* The SHA-256 computation gives no usable progress. */
		statut = t("installer.status.verifying");
	} else if (etat.phase === "installation") {
		/* `null` while the percentage cannot be computed yet (a release without
		   a published installed size, an update whose folder has not shrunk). */
		if (etat.pourcent === null) {
			statut = t("installer.status.installing");
		} else {
			pourcent = etat.pourcent;
			statut = t("installer.status.installingProgress", { percent: formatPourcent(etat.pourcent) });
		}
	} else if (etat.phase === "demarrage") {
		pourcent = 100;
		statut = t("installer.status.launching");
	}
	return { pourcent, statut, detail };
}

/** The step the update window is in, from what its process can observe: the
    app that launched it is still running (the update was downloaded and
    verified by the app, NSIS has not started), or it is gone and NSIS is
    installing — with the percentage `progressionInstallation` computes. */
export function etatFenetreMaj(appEnCours: boolean, pourcent: number | null): EtatInstallateur {
	return appEnCours ? { phase: "verification" } : { phase: "installation", pourcent };
}
