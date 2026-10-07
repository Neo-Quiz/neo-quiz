/* Small helpers shared by Settings > Moodle and the Moodle page: wording of
   times and deadlines, the https-origin check, a flat button. No Moodle call
   here. The word "sync" never appears in Moodle UI: it means the device sync. */

import type { DevoirMoodle, ResumeSyncMoodle } from "../../electron/pont";
import { currentHourCycle, currentLang, hourOptions, t } from "../../../../src/i18n";
import type { TransKey } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";

/** A plain https origin, the only shape the main process accepts. */
export function origineValide(brut: string): string | null {
	try {
		const u = new URL(brut.trim());
		if (u.protocol !== "https:" || u.pathname !== "/" || u.search || u.hash || u.username || u.password || u.port) return null;
		return u.origin;
	} catch { return null; }
}

function span(ms: number): string {
	const min = Math.max(1, Math.round(ms / 60_000));
	if (min < 60) return t("settings.moodle.spanMinutes", { n: min });
	const h = Math.round(min / 60);
	if (h < 48) return t("settings.moodle.spanHours", { n: h });
	const d = Math.round(h / 24);
	return t(d === 1 ? "settings.moodle.spanDay" : "settings.moodle.spanDays", { n: d });
}

export function echeance(d: DevoirMoodle): string {
	if (!d.due) return t("settings.moodle.noDue");
	return d.remaining < 0 ? t("settings.moodle.lateBy", { span: span(-d.remaining) }) : t("settings.moodle.dueIn", { span: span(d.remaining) });
}

/** "11:20", or "Today 11:20" is never needed: the line says "checked 11:20" and
    a date is added only when the moment is not today. */
export function heure(ms: number): string {
	const date = new Date(ms);
	const locale = currentLang() === "fr" ? "fr-FR" : "en-US";
	const h = new Intl.DateTimeFormat(locale, { minute: "2-digit", ...hourOptions(currentHourCycle()) }).format(date);
	if (date.toDateString() === new Date().toDateString()) return h;
	return `${new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date)} ${h}`;
}

export function erreurLancement(r: ResumeSyncMoodle): string | null {
	if (!r.erreur) return null;
	const cle: Record<string, TransKey> = {
		"not-connected": "settings.moodle.runNotConnected",
		expired: "settings.moodle.runExpired",
		"no-courses": "settings.moodle.runNoCourses",
		network: "settings.moodle.runNetwork",
		busy: "settings.moodle.runBusy",
		failed: "settings.moodle.runFailed",
	};
	return t(cle[r.erreur] ?? "settings.moodle.runFailed");
}

export function resumeLancement(r: ResumeSyncMoodle): string {
	return erreurLancement(r) ?? t("settings.moodle.runResult", { created: r.nouveaux, updated: r.mis_a_jour, failed: r.echecs });
}

/** A flat button (no 3D effect: Settings is a modal, and the page keeps one look). */
export function boutonPlat(parent: HTMLElement, libelle: string, surClic: () => void): HTMLButtonElement {
	const b = ajouter(parent, "button", "nq-reglages-changer", libelle);
	b.type = "button";
	b.addEventListener("click", surClic);
	return b;
}
