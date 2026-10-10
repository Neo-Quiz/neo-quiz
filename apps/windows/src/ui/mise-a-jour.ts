/* ══════════════════════════════════════════════════════════
   LA MISE À JOUR, VUE DU RENDU

   One bridge subscription, one current state, and ONE place on desktop that
   shows it: the "about" row of the application menu opened by the logo
   (2026-10-10). It checks, shows the download, and installs; the logo only
   carries a dot. The rail's own update button is gone. Settings showed a
   second one until 2026-09-17. On the phone: the Settings row only.

   This module imports nothing that pulls in Node: `EtatMiseAJour` is a type,
   `pont()` reads `window.neo` when called.
══════════════════════════════════════════════════════════ */

import type { EtatMiseAJour } from "../../electron/pont";
import { pont } from "../host/pont";
import { t, currentLang } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";
import { suivreMajCli } from "../../../../src/dashboard/cli-updates";

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
    waits for a click (metered connection) or is ready to install, or the last
    install did not finish (the safety net, `electron/expected-update.ts`). */
export function majEnVue(e: EtatMiseAJour): boolean {
	return e.phase === "telechargement" || e.phase === "prete" || (e.phase === "disponible" && e.limitee === true) || majInachevee(e);
}

/** The last install restarted the app on an older version. */
export function majInachevee(e: EtatMiseAJour): boolean {
	return e.phase === "erreur" && e.message === "unfinished";
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
	/* The app's own update, or a CLI update to show (`cli-updates.ts`). */
	let app = false;
	let cli = false;
	const peindre = (): void => { logo.classList.toggle("has-maj", app || cli); };
	const desabonner = abonner(e => {
		app = majEnVue(e);
		logo.classList.toggle("is-maj-prete", e.phase === "prete" || majInachevee(e));
		peindre();
	});
	/* A running CLI update is silent: the dot only for one that needs the user. */
	const desabonnerCli = suivreMajCli(etats => { cli = etats.some(e => e.phase !== "en-cours"); peindre(); });
	return () => { desabonner(); desabonnerCli(); point.remove(); logo.classList.remove("has-maj", "is-maj-prete"); };
}

/* ══════════════════════════════════════════════════════════
   ANDROID: the Settings row of the in-app updater

   Same channels as the desktop menu row (`miseAJour.*`), answered in Kotlin by
   `update/UpdateEngine.kt`. A check never downloads: the row offers
   "Install", and only that tap starts the download (no data spent without
   it). Everything about updates happens in Settings on the phone
   (2026-10-10): the banner above the bottom bar is gone. `message` of an
   error state is a CODE the page translates.
══════════════════════════════════════════════════════════ */

/** The sentence under an error / permission state, or null when there is none. */
function texteEtat(e: EtatMiseAJour): string | null {
	if (e.phase === "autorisation") return t("app.update.android.allow");
	if (e.phase !== "erreur") return null;
	const code = e.message === "invalid" || e.message === "mismatch" || e.message === "install" ? e.message : "network";
	return t(`app.update.android.err.${code}` as const);
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
