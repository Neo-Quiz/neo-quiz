/* ══════════════════════════════════════════════════════════
   LA MISE À JOUR, VUE DU RENDU

   One bridge subscription, one current state, and ONE place on desktop that
   shows it: the "about" row of the application menu opened by the logo
   (2026-10-10). It checks, shows the download, and installs; the logo only
   carries a dot. The rail's own update button is gone. Settings showed a
   second one until 2026-09-17. On the phone: a banner and a Settings row.

   This module imports nothing that pulls in Node: `EtatMiseAJour` is a type,
   `pont()` reads `window.neo` when called.
══════════════════════════════════════════════════════════ */

import type { EtatMiseAJour } from "../../electron/pont";
import { pont } from "../host/pont";
import { t, currentLang } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";

let etat: EtatMiseAJour = { phase: "inactif" };
const abonnes = new Set<(etat: EtatMiseAJour) => void>();
let desabonnerPont: (() => void) | null = null;
let pousse = false;

/** Un seul abonnement au pont pour toute la fenêtre, posé au premier appel. */
function garantirAbonnement(): void {
	if (desabonnerPont) return;
	desabonnerPont = pont().miseAJour.surEtat(e => {
		pousse = true;
		etat = e;
		for (const a of abonnes) a(etat);
	});
	// La lecture initiale rattrape l'état d'AVANT l'abonnement ; si un état a
	// été poussé pendant l'aller-retour, il est plus récent que cette réponse
	// et gagne, sinon une mise à jour prête disparaîtrait jusqu'au prochain événement.
	void pont().miseAJour.etat().then(e => {
		if (!pousse) {
			etat = e;
			for (const a of abonnes) a(etat);
		}
	});
}

function abonner(rappel: (etat: EtatMiseAJour) => void): () => void {
	garantirAbonnement();
	abonnes.add(rappel);
	rappel(etat);
	return () => { abonnes.delete(rappel); };
}

/** What a manual check came to, for the button of the application menu. */
export type ResultatVerification =
	| { kind: "up-to-date" }
	| { kind: "downloading"; version: string }
	| { kind: "ready"; version: string }
	| { kind: "waiting"; version: string }
	| { kind: "failed"; message: string }
	| { kind: "dev-build" };

/**
 * "CHECK FOR UPDATES..." of the application menu: checks now and RETURNS what
 * came of it; the menu button shows it where the pointer clicked (no notice).
 * From then on a download or a ready version is followed live by that row.
 *
 * The state is read AFTER `verifier()` resolves: the main process sends
 * electron-updater's events to the window before answering the call, so the
 * state is then the check's own outcome.
 */
export async function verifierMaintenant(): Promise<ResultatVerification> {
	const lire = (e: EtatMiseAJour): ResultatVerification => {
		const version = e.version ?? "";
		if (e.phase === "telechargement") return { kind: "downloading", version };
		if (e.phase === "prete") return { kind: "ready", version };
		if (e.phase === "disponible") return { kind: "waiting", version };
		if (e.phase === "erreur") return { kind: "failed", message: e.message ?? "" };
		return { kind: "up-to-date" };
	};
	/* Already downloading or ready: the menu row already shows it live. */
	const avant = await pont().miseAJour.etat();
	if (avant.phase === "telechargement" || avant.phase === "prete") return lire(avant);
	if (!await pont().miseAJour.verifier()) return { kind: "dev-build" };
	return lire(await pont().miseAJour.etat());
}

/**
 * "<done> MB / <total> MB" for a download in progress, or null when the size
 * is unknown. Whole megabytes (bytes / 1 048 576, rounded); one decimal when
 * the total is under 10 MB, with the decimal separator of the UI language.
 */
function detailTaille(recus: number | null | undefined, total: number | null | undefined): string | null {
	if (typeof recus !== "number" || typeof total !== "number" || !(total > 0) || recus < 0) return null;
	const mo = (n: number): string => {
		const v = n / 1_048_576;
		if (total / 1_048_576 >= 10) return String(Math.round(v));
		return v.toFixed(1).replace(".", currentLang() === "fr" ? "," : ".");
	};
	return t("app.update.size", { done: mo(recus), total: mo(total) });
}

/** True while the menu has something to say on its own: a version downloads,
    waits for a click (metered connection) or is ready to install. */
export function majEnVue(e: EtatMiseAJour): boolean {
	return e.phase === "telechargement" || e.phase === "prete" || (e.phase === "disponible" && e.limitee === true);
}

/** Follows the update state (one bridge subscription for the whole window). */
export function suivreMiseAJour(rappel: (etat: EtatMiseAJour) => void): () => void {
	return abonner(rappel);
}

/** Install a ready version, or start the download a metered connection held. */
export function installerMiseAJour(): void {
	void pont().miseAJour.installer();
}

/** The download's size for a screen reader, or null when it is unknown. */
export function tailleTelechargement(e: EtatMiseAJour): string | null {
	return detailTaille(e.octetsRecus, e.octetsTotal);
}

/**
 * THE DOT ON THE LOGO. Everything about updates happens in the application
 * menu that the logo opens (2026-10-10; the rail had its own update button
 * until then, apart from the menu's "Check for updates"). The logo only says
 * that the menu has news: a dot while a version downloads, waits or is ready.
 */
export function monterPointLogo(logo: HTMLElement): () => void {
	const point = ajouter(logo, "span", "nq-rail-logo-point");
	point.setAttribute("aria-hidden", "true");
	const desabonner = abonner(e => {
		const visible = majEnVue(e);
		logo.classList.toggle("has-maj", visible);
		logo.classList.toggle("is-maj-prete", e.phase === "prete");
	});
	return () => { desabonner(); point.remove(); logo.classList.remove("has-maj", "is-maj-prete"); };
}

/* ══════════════════════════════════════════════════════════
   ANDROID: the banner and the Settings row of the in-app updater

   Same channels as the desktop menu row (`miseAJour.*`), answered in Kotlin by
   `update/UpdateEngine.kt`. A check never downloads: the banner offers
   "Install", and only that tap starts the download (no data spent without
   it). `message` of an error state is a CODE the page translates.
══════════════════════════════════════════════════════════ */

/** The sentence under an error / permission state, or null when there is none. */
function texteEtat(e: EtatMiseAJour): string | null {
	if (e.phase === "autorisation") return t("app.update.android.allow");
	if (e.phase !== "erreur") return null;
	const code = e.message === "invalid" || e.message === "mismatch" || e.message === "install" ? e.message : "network";
	return t(`app.update.android.err.${code}` as const);
}

/**
 * The banner above the bottom bar: "Update available (x.y.z)" with Install, then
 * the progress, then the reason of a failure. Only where the app really offers
 * a version or says something about a tapped install; silent otherwise.
 */
export function monterBanniereMajAndroid(): () => void {
	let banniere: HTMLElement | null = null;
	const retirer = (): void => { banniere?.remove(); banniere = null; };
	const demonter = abonner(e => {
		const installer = e.phase === "disponible" || e.phase === "autorisation" || (e.phase === "erreur" && !!e.version);
		const enCours = e.phase === "telechargement" || e.phase === "prete";
		if (!installer && !enCours) { retirer(); return; }
		if (!banniere) {
			banniere = document.createElement("div");
			banniere.className = "nq-maj-banniere";
			banniere.setAttribute("role", "status");
			document.body.append(banniere);
		}
		banniere.textContent = "";
		const version = e.version ?? "";
		const texte = ajouter(banniere, "div", "nq-maj-banniere-texte");
		const titre = e.phase === "telechargement"
			? t("app.update.android.downloading", { version }) + (typeof e.pourcent === "number" ? " " + e.pourcent + " %" : "")
			: e.phase === "prete" ? t("app.update.android.ready", { version })
				: t("app.update.android.available", { version });
		ajouter(texte, "span", "nq-maj-banniere-titre", titre);
		const detail = texteEtat(e);
		if (detail) ajouter(texte, "span", "nq-maj-banniere-detail", detail);
		if (installer) {
			const bouton = ajouter(banniere, "button", "nq-maj-banniere-bouton", t("app.update.android.install"));
			bouton.type = "button";
			bouton.addEventListener("click", () => { void pont().miseAJour.installer(); });
		}
	});
	return () => { demonter(); retirer(); };
}

/**
 * The "Updates" row of the phone's Settings: the installed version under the
 * name, and ONE button that follows the updater (2026-10-09: the owner had to
 * leave Settings to reach the banner's Install). "Check" while nothing is on
 * offer; a BLUE "Install" as soon as a version is (a manual check ignores the
 * 6 h interval); then the download's progress, disabled, until Android takes
 * over.
 */
export function monterLigneMajAndroid(controle: HTMLElement, aide: HTMLElement): () => void {
	const bouton = ajouter(controle, "button", "nq-reglages-changer", t("app.update.android.check"));
	bouton.type = "button";
	let verification = false;
	let installable = false;
	let enCours = false;
	const peindre = (e: EtatMiseAJour | null): void => {
		installable = !!e && (e.phase === "disponible" || e.phase === "autorisation" || (e.phase === "erreur" && !!e.version));
		enCours = !!e && (e.phase === "telechargement" || e.phase === "prete");
		bouton.classList.toggle("is-installer", installable);
		bouton.disabled = verification || enCours;
		bouton.textContent = verification ? t("app.update.android.checking")
			: e && e.phase === "telechargement" ? (typeof e.pourcent === "number" ? e.pourcent + " %" : t("app.update.android.downloading", { version: e.version ?? "" }))
				: e && e.phase === "prete" ? t("app.update.android.ready", { version: e.version ?? "" })
					: installable ? t("app.update.android.install")
						: t("app.update.android.check");
	};
	let dernier: EtatMiseAJour | null = null;
	bouton.addEventListener("click", () => {
		if (verification || enCours) return;
		if (installable) { void pont().miseAJour.installer(); return; }
		verification = true;
		peindre(dernier);
		void pont().miseAJour.verifier().catch(() => false).then(() => {
			verification = false;
			peindre(dernier);
		});
	});
	return abonner(e => {
		dernier = e;
		peindre(e);
		const actuelle = e.actuelle ? t("app.update.android.version", { version: e.actuelle }) : "";
		const suite = e.phase === "a-jour" ? t("app.update.android.upToDate")
			: e.phase === "disponible" ? t("app.update.android.available", { version: e.version ?? "" })
				: texteEtat(e);
		aide.textContent = [actuelle, suite].filter(Boolean).join(" · ");
	});
}
