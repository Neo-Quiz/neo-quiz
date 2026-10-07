/* ══════════════════════════════════════════════════════════
   SETTINGS › MOODLE (docs/superpowers/specs/2026-10-07-moodle-sync-design.md)

   Five blocks: the site, the account, the courses, the sync, the assignments.
   Everything goes through `pont().moodle` (electron/moodle/*): the window
   never sees the token, a file URL or a path. The `moodle` setting (site,
   chosen courses) is GUARDED in the main process: a new host asks a native
   confirmation there, and a refusal rejects the write. Settings is a modal:
   flat buttons only (no 3D effect). Absent on a phone (the files arrive by
   sync), so `pont().moodle` is undefined there and this page is not built.
══════════════════════════════════════════════════════════ */

import { pont } from "../host/pont";
import type { CoursMoodle, DevoirMoodle, EtatMoodle, ResumeSyncMoodle } from "../../electron/pont";
import { CLE_REGLAGES_MOODLE } from "../../electron/pont";
import { currentHost } from "../../../../src/host/current";
import { t, currentLang, currentHourCycle, hourOptions } from "../../../../src/i18n";
import type { TransKey } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";

const SONDE_MS = 2000;
const ATTENTE_MAX_MS = 10 * 60 * 1000;

/** A plain https origin, the only shape the main process accepts. */
function origineValide(brut: string): string | null {
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

function echeance(d: DevoirMoodle): string {
	if (!d.due) return t("settings.moodle.noDue");
	return d.remaining < 0 ? t("settings.moodle.lateBy", { span: span(-d.remaining) }) : t("settings.moodle.dueIn", { span: span(d.remaining) });
}

function quand(ms: number): string {
	const date = new Date(ms);
	const locale = currentLang() === "fr" ? "fr-FR" : "en-US";
	const heure = new Intl.DateTimeFormat(locale, { minute: "2-digit", ...hourOptions(currentHourCycle()) }).format(date);
	const memeJour = date.toDateString() === new Date().toDateString();
	const jour = memeJour ? t("settings.moodle.today") : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date);
	return `${jour} ${heure}`;
}

function resume(r: ResumeSyncMoodle): string {
	if (r.erreur) {
		const cle: Record<string, TransKey> = {
			"not-connected": "settings.moodle.errNotConnected",
			expired: "settings.moodle.errExpired",
			"no-courses": "settings.moodle.errNoCourses",
			network: "settings.moodle.errNetwork",
			failed: "settings.moodle.errFailed",
		};
		return t(cle[r.erreur] ?? "settings.moodle.errFailed");
	}
	return t("settings.moodle.lastResult", { when: quand(Date.now()), created: r.nouveaux, updated: r.mis_a_jour, failed: r.echecs });
}

/** A card row: name (and help) on the left, the control on the right. */
function ligne(carte: HTMLElement, nom: string, aide?: string): { texte: HTMLElement; controle: HTMLElement; aide: HTMLElement | null; ligne: HTMLElement } {
	const l = ajouter(carte, "div", "nq-set-ligne");
	const texte = ajouter(l, "div", "nq-set-ligne-texte");
	ajouter(texte, "span", "nq-reglages-nom", nom);
	const a = aide ? ajouter(texte, "span", "nq-set-ligne-aide", aide) : null;
	return { texte, controle: ajouter(l, "div", "nq-set-ligne-controle"), aide: a, ligne: l };
}

function bloc(parent: HTMLElement, titre: string): HTMLElement {
	const s = ajouter(parent, "section", "nq-reglages-section");
	ajouter(s, "h3", "nq-reglages-titre", titre);
	return ajouter(s, "div", "nq-set-carte");
}

function bouton(parent: HTMLElement, libelle: string, surClic: () => void): HTMLButtonElement {
	const b = ajouter(parent, "button", "nq-reglages-changer", libelle);
	b.type = "button";
	b.addEventListener("click", surClic);
	return b;
}

export function mountMoodleSettings(page: HTMLElement): () => void {
	const api = pont().moodle;
	if (!api) return () => undefined;
	let detruit = false;
	let etat: EtatMoodle | null = null;
	let enAttenteDepuis = 0;
	let sonde: ReturnType<typeof setInterval> | null = null;
	let derniereSync: string | null = null;
	let coursChoisis: number[] = [];

	const racine = ajouter(page, "div", "nq-moodle");
	const blocSite = bloc(racine, t("settings.moodle.siteTitle"));
	const blocCompte = bloc(racine, t("settings.moodle.accountTitle"));
	const blocCours = bloc(racine, t("settings.moodle.coursesTitle"));
	const blocSync = bloc(racine, t("settings.moodle.syncTitle"));
	const blocDevoirs = bloc(racine, t("settings.moodle.assignmentsTitle"));

	/* ── Site ── */
	const site = ligne(blocSite, t("settings.moodle.siteName"), t("settings.moodle.siteHint"));
	const champ = ajouter(site.controle, "input", "nq-set-nombre nq-moodle-site");
	champ.type = "text";
	champ.placeholder = t("settings.moodle.sitePlaceholder");
	champ.spellcheck = false;
	champ.setAttribute("aria-label", t("settings.moodle.siteName"));
	const erreurSite = ajouter(site.texte, "span", "nq-set-ligne-aide nq-moodle-rouge");
	erreurSite.hidden = true;
	let siteEnregistre = "";
	champ.addEventListener("change", () => { void enregistrerSite(); });
	async function enregistrerSite(): Promise<void> {
		const brut = champ.value.trim();
		erreurSite.hidden = true;
		if (brut === siteEnregistre) return;
		const origine = brut === "" ? "" : origineValide(brut);
		if (origine === null) {
			erreurSite.textContent = t("settings.moodle.siteInvalid");
			erreurSite.hidden = false;
			return;
		}
		try {
			const courant = (await pont().reglages.lire(CLE_REGLAGES_MOODLE).catch(() => null)) as { site?: string; courses?: number[] } | null;
			const valeur: { site?: string; courses?: number[] } = {};
			if (origine) valeur.site = origine;
			if (courant?.courses) valeur.courses = courant.courses;
			await pont().reglages.ecrire(CLE_REGLAGES_MOODLE, valeur);
			siteEnregistre = origine;
			champ.value = origine;
		} catch {
			/* Refused by the native confirmation, or by the guard. */
			champ.value = siteEnregistre;
			erreurSite.textContent = t("settings.moodle.siteRefused");
			erreurSite.hidden = false;
		}
		await rafraichir();
	}

	/* ── Account ── */
	const compte = ligne(blocCompte, "");
	const compteNom = compte.texte.querySelector<HTMLElement>(".nq-reglages-nom")!;
	const compteAide = ajouter(compte.texte, "span", "nq-set-ligne-aide");

	function peindreCompte(): void {
		compte.controle.replaceChildren();
		compteAide.classList.remove("nq-moodle-rouge");
		compteAide.textContent = "";
		const e = etat;
		if (!e) { compteNom.textContent = t("settings.moodle.notConnected"); return; }
		const erreur = e.error === "secure-storage-unavailable" ? "settings.moodle.errorStorage"
			: e.error === "login-failed" ? "settings.moodle.errorLogin"
				: e.error === "site-not-allowed" ? "settings.moodle.errorSite" : null;
		if (erreur) { compteAide.textContent = t(erreur); compteAide.classList.add("nq-moodle-rouge"); }
		if (e.loginPending) {
			compteNom.textContent = t("settings.moodle.waiting");
			bouton(compte.controle, t("settings.moodle.cancel"), () => { void annulerConnexion(); });
		} else if (e.state === "connected" || e.connected) {
			compteNom.textContent = t("settings.moodle.connectedAs", { name: e.fullname });
			bouton(compte.controle, t("settings.moodle.signOut"), () => { void api!.deconnecter().then(rafraichir); });
		} else if (e.state === "expired") {
			compteNom.textContent = t("settings.moodle.expired");
			const b = bouton(compte.controle, t("settings.moodle.signInAgain"), () => { void connecter(); });
			b.disabled = !e.site;
		} else {
			compteNom.textContent = t("settings.moodle.notConnected");
			if (!e.site) compteAide.textContent = t("settings.moodle.noSite");
			const b = bouton(compte.controle, t("settings.moodle.signIn"), () => { void connecter(); });
			b.disabled = !e.site;
		}
	}

	async function connecter(): Promise<void> {
		try { await api!.connecter(); } catch { /* no site / no secure storage: the state says why */ }
		enAttenteDepuis = Date.now();
		demarrerSonde();
		await rafraichir();
	}
	async function annulerConnexion(): Promise<void> {
		/* No cancel verb in the bridge: forgetting the token also drops the pending wait. */
		try { await api!.deconnecter(); } catch { /* nothing */ }
		await rafraichir();
	}
	function demarrerSonde(): void {
		if (sonde) return;
		sonde = setInterval(() => {
			if (detruit || Date.now() - enAttenteDepuis > ATTENTE_MAX_MS) { arreterSonde(); return; }
			void rafraichir();
		}, SONDE_MS);
	}
	function arreterSonde(): void {
		if (sonde) clearInterval(sonde);
		sonde = null;
	}

	/* ── Courses ── */
	function peindreCours(cours: CoursMoodle[]): void {
		blocCours.replaceChildren();
		coursChoisis = cours.filter(c => !c.exclu && !!c.code).map(c => c.id);
		if (!cours.length) {
			ajouter(ajouter(blocCours, "div", "nq-set-ligne"), "span", "nq-set-ligne-aide", t("settings.moodle.coursesEmpty"));
			return;
		}
		for (const c of cours) {
			const dossier = c.folder
				? (c.folderExists ? t("settings.moodle.toFolder", { folder: c.folder }) : t("settings.moodle.toNewFolder", { folder: c.folder }))
				: t("settings.moodle.noCode");
			const r = ligne(blocCours, c.name, c.code ? `${c.code} ${dossier}` : dossier);
			const l = ajouter(r.controle, "label", "nq-moodle-interrupteur");
			const sw = ajouter(l, "input", "nq-set-interrupteur");
			sw.type = "checkbox";
			sw.setAttribute("role", "switch");
			sw.setAttribute("aria-label", c.name);
			sw.checked = !c.exclu && !!c.code;
			sw.disabled = !c.code;
			sw.addEventListener("change", () => {
				// Interim: the full Moodle page replaces these switches (course exclusion).
				void api!.exclure(c.id, !sw.checked).then(() => { coursChoisis = sw.checked ? [...new Set([...coursChoisis, c.id])] : coursChoisis.filter(id => id !== c.id); }, () => { sw.checked = !sw.checked; });
			});
		}
	}

	/* ── Sync ── */
	const sync = ligne(blocSync, "", t("settings.moodle.syncNote"));
	const resultat = sync.texte.querySelector<HTMLElement>(".nq-reglages-nom")!;
	const boutonSync = bouton(sync.controle, t("settings.moodle.syncNow"), () => { void synchroniser(); });
	let enCours = false;
	async function synchroniser(): Promise<void> {
		if (enCours) return;
		enCours = true;
		boutonSync.disabled = true;
		resultat.textContent = t("settings.moodle.syncingStart");
		const r = await api!.synchroniser().catch((): ResumeSyncMoodle => ({ nouveaux: 0, mis_a_jour: 0, echecs: 0, ignores: 0, erreur: "failed" }));
		enCours = false;
		if (detruit) return;
		derniereSync = resume(r);
		await rafraichir();
	}
	function peindreSync(): void {
		const e = etat;
		const actif = enCours || !!e?.syncing;
		boutonSync.disabled = actif || !e || e.state !== "connected";
		if (actif) {
			resultat.textContent = e?.progress ? t("settings.moodle.syncing", { done: e.progress.done, total: e.progress.total }) : t("settings.moodle.syncingStart");
		} else if (derniereSync) {
			resultat.textContent = derniereSync;
		} else if (e?.lastSync) {
			resultat.textContent = quand(e.lastSync);
		} else {
			resultat.textContent = t("settings.moodle.never");
		}
	}

	/* ── Assignments ── */
	function peindreDevoirs(devoirs: DevoirMoodle[], cours: CoursMoodle[]): void {
		blocDevoirs.replaceChildren();
		if (!devoirs.length) {
			ajouter(ajouter(blocDevoirs, "div", "nq-set-ligne"), "span", "nq-set-ligne-aide", t("settings.moodle.assignmentsEmpty"));
			return;
		}
		for (const d of devoirs) {
			const code = cours.find(c => c.name === d.course)?.code ?? d.course;
			const r = ligne(blocDevoirs, d.name);
			r.ligne.classList.add("nq-moodle-devoir");
			const aide = ajouter(r.texte, "span", "nq-set-ligne-aide nq-moodle-" + (d.state === "late" ? "rouge" : d.state === "urgent" ? "ambre" : "neutre"), `${code} · ${echeance(d)}`);
			aide.title = d.course;
			const b = bouton(r.controle, t("settings.moodle.open"), () => { void api!.ouvrirDevoir(d.cmid); });
			currentHost().ui.setIcon(ajouter(b, "span", "nq-moodle-lien-icone"), "external-link");
		}
	}

	async function rafraichir(): Promise<void> {
		const e = await api!.etat().catch(() => null);
		if (detruit) return;
		const avant = etat;
		etat = e;
		if (e && !e.loginPending) { arreterSonde(); }
		else if (e?.loginPending) { if (!enAttenteDepuis) enAttenteDepuis = Date.now(); demarrerSonde(); }
		if (e && !siteEnregistre && document.activeElement !== champ) { siteEnregistre = e.site; champ.value = e.site; }
		peindreCompte();
		peindreSync();
		/* Courses and assignments only repaint when the connection changes, not on
		   every sync progress push. */
		if (!avant || avant.state !== e?.state || avant.connected !== e?.connected || avant.syncing !== e?.syncing) {
			const cours = e && (e.state === "connected" || e.connected) ? await api!.cours().catch(() => []) : [];
			const devoirs = cours.length ? await api!.devoirs().catch(() => []) : [];
			if (detruit) return;
			peindreCours(cours);
			peindreDevoirs(devoirs, cours);
		}
	}

	const desabonner = api.surEtat(() => { void rafraichir(); });
	void rafraichir();
	return () => { detruit = true; arreterSonde(); desabonner(); };
}
