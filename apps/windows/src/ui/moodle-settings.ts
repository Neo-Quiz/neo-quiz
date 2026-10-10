/* ══════════════════════════════════════════════════════════
   SETTINGS › MOODLE (docs/superpowers/specs/2026-10-07-moodle-sync-design.md,
   "Revision (owner, 2026-10-07 11:25)"): as little as possible. Not signed in:
   ONE button, plus a discreet "Another school?" link that reveals the address
   field. Signed in: who, one status line, the automatic-download switch, sign
   out, and a link to the Moodle page (courses, files, assignments live there).

   Everything goes through `pont().moodle`: the window never sees the token, a
   file URL or a path. The `moodle` setting is GUARDED in the main process: a
   host other than the built-in one asks a native confirmation there, and a
   refusal rejects the write. Settings is a modal: flat buttons only. Absent on
   a phone (the files arrive through the device sync), so `pont().moodle` is
   undefined there and this page is not built.
══════════════════════════════════════════════════════════ */

import { pont } from "../host/pont";
import type { EcoleMoodle, EtatMoodle } from "../../electron/pont";
import { CLE_REGLAGES_MOODLE } from "../../electron/pont";
import { t } from "../../../../src/i18n";
import type { TransKey } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";
import { boutonPlat, heure, origineValide } from "./moodle-common";
import { openMoodleModal } from "./moodle-modal";

const SONDE_MS = 2000;
const ATTENTE_MAX_MS = 10 * 60 * 1000;

export function mountMoodleSettings(page: HTMLElement): () => void {
	const api = pont().moodle;
	if (!api) return () => undefined;
	let detruit = false;
	let etat: EtatMoodle | null = null;
	let attenteDepuis = 0;
	let sonde: ReturnType<typeof setInterval> | null = null;
	let champOuvert = false;

	const racine = ajouter(page, "div", "nq-moodle");
	const carte = ajouter(racine, "div", "nq-set-carte");

	async function lireReglage(): Promise<Record<string, unknown>> {
		const v = await pont().reglages.lire(CLE_REGLAGES_MOODLE).catch(() => null);
		return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
	}

	function ligne(nom: string, aide?: string): { texte: HTMLElement; controle: HTMLElement; aide: HTMLElement } {
		const l = ajouter(carte, "div", "nq-set-ligne");
		const texte = ajouter(l, "div", "nq-set-ligne-texte");
		ajouter(texte, "span", "nq-reglages-nom", nom);
		const a = ajouter(texte, "span", "nq-set-ligne-aide", aide ?? "");
		a.hidden = !aide;
		return { texte, controle: ajouter(l, "div", "nq-set-ligne-controle"), aide: a };
	}

	function peindre(): void {
		carte.replaceChildren();
		const e = etat;
		if (!e) return;
		const erreur = e.error === "secure-storage-unavailable" ? "settings.moodle.errorStorage"
			: e.error === "login-failed" ? "settings.moodle.errorLogin"
				: e.error === "site-not-allowed" ? "settings.moodle.errorSite" : null;

		if (e.loginPending) {
			const l = ligne(t("settings.moodle.waiting"));
			boutonPlat(l.controle, t("settings.moodle.cancel"), () => { void api!.deconnecter().then(rafraichir); });
			return;
		}
		if (e.connected && e.state === "connected") {
			const l = ligne(t("settings.moodle.connectedAs", { name: e.fullname }), statut(e));
			boutonPlat(l.controle, t("settings.moodle.signOut"), () => { void api!.deconnecter().then(rafraichir); });
			const a = ligne(t("settings.moodle.auto"));
			const label = ajouter(a.controle, "label", "nq-moodle-interrupteur");
			const sw = ajouter(label, "input", "nq-set-interrupteur");
			sw.type = "checkbox";
			sw.setAttribute("role", "switch");
			sw.setAttribute("aria-label", t("settings.moodle.auto"));
			sw.checked = e.auto;
			sw.addEventListener("change", () => {
				void lireReglage().then(cur => pont().reglages.ecrire(CLE_REGLAGES_MOODLE, { ...cur, auto: sw.checked }))
					.catch(() => { sw.checked = !sw.checked; });
			});
			const p = ajouter(carte, "div", "nq-set-ligne");
			const lien = ajouter(p, "button", "nq-moodle-lien", t("settings.moodle.openPage"));
			lien.type = "button";
			/* Opened OVER the settings, which stay open below: closing the Moodle
			   window brings the user back where they were (host modals stack). */
			lien.addEventListener("click", () => openMoodleModal());
			return;
		}

		/* Not signed in: ONE prominent button; "Another school?" stays a quiet link. */
		const expire = e.state === "expired";
		const solo = ajouter(carte, "div", "nq-set-ligne nq-moodle-solo");
		if (expire) ajouter(solo, "span", "nq-set-ligne-aide", t("settings.moodle.expired"));
		const b = boutonPlat(solo, expire ? t("settings.moodle.signInAgain") : t("settings.moodle.signIn"), () => { void connecter(); });
		b.classList.add("nq-moodle-principal");
		b.disabled = !e.site;
		if (erreur) ajouter(solo, "span", "nq-set-ligne-aide nq-moodle-rouge", t(erreur));

		const autre = ajouter(carte, "div", "nq-set-ligne nq-moodle-autre");
		const lien = ajouter(autre, "button", "nq-moodle-lien", t("settings.moodle.otherSchool"));
		lien.type = "button";
		lien.hidden = champOuvert;
		const zone = ajouter(autre, "div", "nq-moodle-ecoles");
		zone.hidden = !champOuvert;
		lien.addEventListener("click", () => { champOuvert = true; lien.hidden = true; zone.hidden = false; void peindreEcoles(zone, e.site); });
		if (champOuvert) void peindreEcoles(zone, e.site);
	}

	/** The compatible schools (name and city), filtered as you type, the current one marked;
	    the last entry reveals an address field that is CHECKED before it is saved. */
	async function peindreEcoles(zone: HTMLElement, site: string): Promise<void> {
		zone.replaceChildren();
		const filtre = ajouter(zone, "input", "nq-set-nombre nq-moodle-filtre");
		filtre.type = "text";
		filtre.spellcheck = false;
		filtre.placeholder = t("settings.moodle.schoolSearch");
		filtre.setAttribute("aria-label", t("settings.moodle.schoolSearch"));
		const liste = ajouter(zone, "div", "nq-moodle-ecoles-liste");
		const msg = ajouter(zone, "span", "nq-set-ligne-aide nq-moodle-rouge");
		msg.hidden = true;
		const ecoles = await (api!.ecoles()).catch(() => [] as EcoleMoodle[]);
		if (detruit) return;
		const norm = (x: string): string => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
		const saisie = ajouter(zone, "div", "nq-moodle-saisie");
		saisie.hidden = true;
		const champ = ajouter(saisie, "input", "nq-set-nombre nq-moodle-site");
		champ.type = "text";
		champ.spellcheck = false;
		champ.placeholder = t("settings.moodle.sitePlaceholder");
		champ.setAttribute("aria-label", t("settings.moodle.siteName"));
		const ok = boutonPlat(saisie, t("settings.moodle.siteCheck"), () => { void verifierPuisChoisir(champ.value, msg, ok); });
		champ.addEventListener("keydown", ev => { if (ev.key === "Enter") ok.click(); });
		const dessiner = (): void => {
			liste.replaceChildren();
			const q = norm(filtre.value.trim());
			for (const ecole of ecoles.filter(x => !q || norm(x.name + " " + x.city).includes(q))) {
				const l = ajouter(liste, "button", "nq-moodle-ecole" + (ecole.url === site ? " is-actif" : ""));
				l.type = "button";
				ajouter(l, "span", "nq-moodle-ecole-nom", ecole.name);
				ajouter(l, "span", "nq-set-ligne-aide", ecole.city);
				l.addEventListener("click", () => { void choisirSite(ecole.url, msg); });
			}
			const n = ajouter(liste, "button", "nq-moodle-ecole nq-moodle-ecole-autre");
			n.type = "button";
			ajouter(n, "span", "nq-moodle-ecole-nom", t("settings.moodle.schoolNotListed"));
			n.addEventListener("click", () => { saisie.hidden = false; champ.focus(); });
		};
		filtre.addEventListener("input", dessiner);
		dessiner();
	}

	async function choisirSite(origine: string, msg: HTMLElement): Promise<void> {
		msg.hidden = true;
		try {
			const cur = await lireReglage();
			cur.site = origine;
			await pont().reglages.ecrire(CLE_REGLAGES_MOODLE, cur);
		} catch {
			/* Refused by the native confirmation, or by the guard. */
			msg.textContent = t("settings.moodle.siteRefused");
			msg.hidden = false;
			return;
		}
		await rafraichir();
	}

	/** An address typed by hand: checked FIRST (reachable, a Moodle, mobile access on, a supported login). */
	async function verifierPuisChoisir(brut: string, msg: HTMLElement, bouton: HTMLButtonElement): Promise<void> {
		msg.hidden = true;
		const origine = origineValide(brut);
		if (origine === null) { msg.textContent = t("settings.moodle.siteInvalid"); msg.hidden = false; return; }
		bouton.disabled = true;
		try {
			const r = await api!.verifierSite(origine);
			if (!r.compatible) {
				const cles: Record<string, TransKey> = {
					unreachable: "settings.moodle.reasonUnreachable",
					"not-moodle": "settings.moodle.reasonNotMoodle",
					"mobile-disabled": "settings.moodle.reasonMobileDisabled",
					"login-unsupported": "settings.moodle.reasonLoginUnsupported",
				};
				msg.textContent = t(cles[r.reason ?? ""] ?? "settings.moodle.reasonUnreachable");
				msg.hidden = false;
				return;
			}
			await choisirSite(origine, msg);
		} catch {
			msg.textContent = t("settings.moodle.reasonUnreachable");
			msg.hidden = false;
		} finally { bouton.disabled = false; }
	}

	/** The one status line: what the last check did, or that everything is current. */
	function statut(e: EtatMoodle): string {
		if (e.syncing) {
			return e.progress ? t("settings.moodle.checking", { done: e.progress.done, total: e.progress.total }) : t("settings.moodle.checkingStart");
		}
		/* Automatic downloads skipped on a metered connection (manual ones still work). */
		if (e.pausedMetered) return t("settings.moodle.pausedMetered");
		if (!e.lastCheck) return t("settings.moodle.neverChecked");
		const par = e.lastSummary?.parCours ?? {};
		const codes = Object.keys(par).filter(c => par[c] > 0);
		if (codes.length === 1) return t("settings.moodle.newFiles", { n: par[codes[0]], code: codes[0] });
		if (codes.length > 1) return t("settings.moodle.newFilesMany", { n: codes.reduce((s, c) => s + par[c], 0), count: codes.length });
		return t("settings.moodle.upToDate", { time: heure(e.lastCheck) });
	}

	async function connecter(): Promise<void> {
		try { await api!.connecter(); } catch { /* no site / no secure storage: the state says why */ }
		attenteDepuis = Date.now();
		demarrerSonde();
		await rafraichir();
	}
	function demarrerSonde(): void {
		if (sonde) return;
		sonde = setInterval(() => {
			if (detruit || Date.now() - attenteDepuis > ATTENTE_MAX_MS) { arreterSonde(); return; }
			void rafraichir();
		}, SONDE_MS);
	}
	function arreterSonde(): void {
		if (sonde) clearInterval(sonde);
		sonde = null;
	}

	async function rafraichir(): Promise<void> {
		const e = await api!.etat().catch(() => null);
		if (detruit) return;
		etat = e;
		if (e?.loginPending) { if (!attenteDepuis) attenteDepuis = Date.now(); demarrerSonde(); } else arreterSonde();
		/* Do not repaint under the user's fingers while the address field has the focus. */
		const actif = document.activeElement;
		if (!(actif instanceof HTMLInputElement && racine.contains(actif) && actif.type === "text")) peindre();
	}

	const desabonner = api.surEtat(() => { void rafraichir(); });
	void rafraichir();
	return () => { detruit = true; arreterSonde(); desabonner(); };
}
