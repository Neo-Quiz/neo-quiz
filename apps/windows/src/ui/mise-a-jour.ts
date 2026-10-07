/* ══════════════════════════════════════════════════════════
   LA MISE À JOUR, VUE DU RENDU

   Un seul abonnement au pont, un état courant, et UN endroit qui le montre :
   le rail, où un bouton apparaît quand une version est prête à installer.
   Les Réglages en montraient un second — l'état complet, « Vérifier
   maintenant », l'interrupteur automatique — ; la section est partie le
   2026-09-17 avec le réglage lui-même (la mise à jour est toujours active) et
   le bouton de vérification, que le menu d'application porte déjà.

   Ce module n'importe rien qui tire Node : `EtatMiseAJour` est un type,
   `pont()` lit `window.neo` à l'appel.
══════════════════════════════════════════════════════════ */

import type { EtatMiseAJour } from "../../electron/pont";
import { pont } from "../host/pont";
import { currentHost } from "../../../../src/host/current";
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
	| { kind: "failed"; message: string }
	| { kind: "dev-build" };

/**
 * "CHECK FOR UPDATES..." of the application menu: checks now and RETURNS what
 * came of it; the menu button shows it where the pointer clicked (no notice).
 * The rail only speaks while a version downloads or waits to be installed.
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
		if (e.phase === "erreur") return { kind: "failed", message: e.message ?? "" };
		return { kind: "up-to-date" };
	};
	/* Already downloading or ready: checking again would only restart what
	   the rail is showing. */
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

/**
 * LE CONTRÔLE DU RAIL — la mise à jour telle que Neo Calendar la montre
 * (`src/ui/calendar/UpdateBadge.tsx`, `.nc-update-control`), portée au rail
 * de Neo Quiz (demande d'Ahmed, 2026-09-19) : une CARTE à la couleur
 * d'accent, la forme de l'élément actif du rail, et non une pilule.
 *
 * UN SEUL ÉLÉMENT du compteur au bouton, et c'est tout l'intérêt : pendant le
 * téléchargement, la carte porte le pourcentage à la place de l'icône ; à la
 * fin, le chiffre s'efface pendant que la flèche paraît, et le libellé
 * « Mise à jour » s'ouvre SOUS elle —
 * là où le rail met tous ses libellés (Ahmed, 2026-09-19 : Neo Calendar
 * l'ouvre dans la pilule, mais son rail à lui n'a pas de libellés ; ici la
 * pilule ouverte dépassait du rail). Deux éléments qui se relaient ne
 * pouvaient rien animer : l'œil ne voyait qu'une coupure.
 *
 * Elle n'existe que pendant le téléchargement et une fois prête ; le reste du
 * temps le rail n'a rien à dire. Sans pourcentage honnête (le serveur ne dit
 * pas la taille), elle tourne (`is-tourne`) au lieu d'afficher un chiffre.
 */
export function monterBoutonRail(navEl: HTMLElement): () => void {
	const footer = navEl.querySelector<HTMLElement>(".qbd-nav-footer");
	if (!footer) return () => {};
	let bouton: HTMLButtonElement | null = null;
	let pilule: HTMLElement | null = null;
	let compteur: HTMLElement | null = null;
	let libelle: HTMLElement | null = null;
	let phasePrecedente: EtatMiseAJour["phase"] = "inactif";
	let minuteurAnnonce: number | null = null;

	const creer = (): void => {
		bouton = document.createElement("button");
		bouton.type = "button";
		bouton.className = "qbd-nav-item nq-maj";
		pilule = ajouter(bouton, "span", "nq-maj-pilule");
		compteur = ajouter(pilule, "span", "nq-maj-compteur");
		compteur.setAttribute("aria-hidden", "true");
		currentHost().ui.setIcon(ajouter(pilule, "span", "nq-maj-icone"), "download");
		libelle = ajouter(bouton, "span", "qbd-nav-label nq-maj-libelle", t("app.update.install"));
		bouton.addEventListener("click", () => {
			if (!bouton || bouton.disabled || bouton.classList.contains("is-telechargement")) return;
			/* L'appui se VOIT (Ahmed, 2026-09-19) : la pilule s'enfonce, le
			   chiffre cède la place à un spinner et le libellé dit ce qui se
			   passe, jusqu'à ce que le principal ferme la fenêtre pour
			   installer. Un second clic ne relance rien. */
			bouton.disabled = true;
			bouton.classList.add("is-installation");
			if (libelle) libelle.textContent = t("app.update.installing");
			void pont().miseAJour.installer();
		});
		footer.prepend(bouton);
		/* L'arrivée : la pilule pousse depuis rien, le temps d'une image, puis
		   la classe tombe et les transitions reprennent la main. */
		bouton.classList.add("is-arrivee");
		window.requestAnimationFrame(() => bouton?.classList.remove("is-arrivee"));
	};
	const retirer = (): void => {
		if (minuteurAnnonce !== null) { window.clearTimeout(minuteurAnnonce); minuteurAnnonce = null; }
		bouton?.remove();
		bouton = null; pilule = null; compteur = null; libelle = null;
	};

	const desabonner = abonner(e => {
		const visible = e.phase === "telechargement" || e.phase === "prete";
		if (!visible) { retirer(); phasePrecedente = e.phase; return; }
		if (!bouton) creer();
		if (!bouton || !pilule || !compteur || !libelle) return;
		const telecharge = e.phase === "telechargement";
		const pourcent = typeof e.pourcent === "number" && e.pourcent >= 0 ? Math.min(100, Math.round(e.pourcent)) : null;
		bouton.classList.toggle("is-telechargement", telecharge);
		bouton.classList.toggle("is-prete", !telecharge);
		pilule.classList.toggle("is-tourne", telecharge && pourcent === null);
		/* Le dernier chiffre atteint reste en place, à l'opacité zéro, le
		   temps du fondu : un texte vidé au moment où il devrait s'effacer ne
		   s'efface pas, il disparaît. */
		if (telecharge && pourcent !== null) compteur.textContent = pourcent + " %";
		/* Not `disabled` while downloading: a disabled button takes no focus,
		   and the size detail must show on keyboard focus too. `aria-disabled`
		   keeps it inert for assistive tech; the click handler ignores it. */
		const detail = telecharge ? detailTaille(e.octetsRecus, e.octetsTotal) : null;
		bouton.toggleAttribute("aria-disabled", telecharge);
		if (telecharge) bouton.setAttribute("aria-disabled", "true");
		/* The label carries the size only while downloading; it opens on
		   hover/focus (shell.css). Without a known size it stays the install label
		   and stays closed. */
		libelle.textContent = detail ?? t("app.update.install");
		bouton.classList.toggle("has-detail", detail !== null);
		bouton.setAttribute("aria-label", telecharge
			? t("app.update.downloading") + (pourcent === null ? "" : " " + pourcent + " %") + (detail ? ", " + detail : "")
			: t("app.update.install") + (e.version ? " " + e.version : ""));
		/* S'ouvrir une fois, à l'instant où la descente s'achève — pas au
		   montage : une mise à jour déjà prête quand la fenêtre s'ouvre attend
		   depuis un moment, elle n'a pas de nouvelle à donner. */
		if (e.phase === "prete" && phasePrecedente === "telechargement") {
			bouton.classList.add("is-annonce");
			if (minuteurAnnonce !== null) window.clearTimeout(minuteurAnnonce);
			minuteurAnnonce = window.setTimeout(() => { bouton?.classList.remove("is-annonce"); minuteurAnnonce = null; }, 4000);
		}
		phasePrecedente = e.phase;
	});
	return () => { desabonner(); retirer(); };
}

/* ══════════════════════════════════════════════════════════
   ANDROID: the banner and the Settings row of the in-app updater

   Same channels as the rail button (`miseAJour.*`), answered in Kotlin by
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
 * name, and a "Check" button (a manual check ignores the 6 h interval). A
 * version on offer is installed from the banner.
 */
export function monterLigneMajAndroid(controle: HTMLElement, aide: HTMLElement): () => void {
	const bouton = ajouter(controle, "button", "nq-reglages-changer", t("app.update.android.check"));
	bouton.type = "button";
	let verification = false;
	bouton.addEventListener("click", () => {
		if (verification) return;
		verification = true;
		bouton.disabled = true;
		bouton.textContent = t("app.update.android.checking");
		void pont().miseAJour.verifier().catch(() => false).then(() => {
			verification = false;
			bouton.disabled = false;
			bouton.textContent = t("app.update.android.check");
		});
	});
	return abonner(e => {
		const actuelle = e.actuelle ? t("app.update.android.version", { version: e.actuelle }) : "";
		const suite = e.phase === "a-jour" ? t("app.update.android.upToDate")
			: e.phase === "disponible" ? t("app.update.android.available", { version: e.version ?? "" })
				: texteEtat(e);
		aide.textContent = [actuelle, suite].filter(Boolean).join(" · ");
	});
}
