/* ══════════════════════════════════════════════════════════
   LA MISE À JOUR AUTOMATIQUE — le câblage d'electron-updater

   Tout vit ici, dans le PRINCIPAL : le rendu ne voit qu'un état poussé par
   le pont (`CANAUX.miseAJourEtat`) et donne trois ordres. Le flux est
   `resources/app-update.yml`, écrit par electron-builder (clé `publish` de
   la config) : les releases GitHub du dépôt, et rien d'autre.

   QUAND ON VÉRIFIE : au démarrage (après la fenêtre, jamais avant : une
   erreur réseau au boot ne doit rien retarder), au retour du focus avec un
   garde de quinze minutes, et toutes les quatre heures. Hors ligne est un
   état NORMAL : l'erreur est journalisée, jamais affichée en Notice.

   COMMENT ON INSTALLE : par le chemin de FERMETURE existant. `installer()`
   arme un drapeau puis ferme la fenêtre ; `main.ts` fait vider les
   écritures différées du rendu comme pour une croix, et quand tout est
   fermé, c'est `quitAndInstall(true, true)` — silencieux, relance forcée —
   qui remplace `app.quit()`. Une frappe en attente ne se perd pas dans une
   mise à jour. Sans clic, `autoInstallOnAppQuit` installe à la prochaine
   fermeture (sans relance).

   CONNEXION LIMITÉE (2026-10-07) : `autoDownload` est COUPÉ ; c'est ce module
   qui décide, à chaque `update-available`, selon `deps.limitee()` (voir
   `connexion-limitee.ts` : en cas de doute, NON limitée). Libre : on
   télécharge aussitôt, comme avant. Limitée : phase « disponible », rien ne
   descend avant le clic sur « Télécharger » (le canal `miseAJourInstaller`,
   qui sur Windows ne servait qu'à l'état « prête »). Tant qu'une version
   attend, on remesure toutes les cinq minutes (et au focus) : si la
   connexion redevient libre, le téléchargement part tout seul.

   EN DÉVELOPPEMENT (`app.isPackaged === false`) : rien, dit une fois.
   electron-updater n'a pas d'`app-update.yml` à lire hors d'un paquet.
══════════════════════════════════════════════════════════ */

import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { LOG_PREFIX } from "../../../src/branding";
import { ETAT_INITIAL, transition } from "./mise-a-jour-etat";
import type { EtatMiseAJour, EvenementMiseAJour } from "./mise-a-jour-etat";

const GARDE_FOCUS_MS = 15 * 60 * 1000;
const PERIODE_MS = 4 * 60 * 60 * 1000;
/** While a version waits on a metered connection: how often to ask again. */
const REMESURE_MS = 5 * 60 * 1000;

export interface MiseAJour {
	etat(): EtatMiseAJour;
	/** Au démarrage, APRÈS la fenêtre : arme le minuteur et lance la première
	    vérification. SANS PARAMÈTRE depuis le 2026-09-17 — il n'y a plus de
	    réglage à lire, la mise à jour automatique est le seul mode. */
	initialiser(): void;
	/** False when no check ran (a dev build, `app.isPackaged` false): the
	    "Check for updates" menu entry then says so instead of staying silent. */
	verifier(): Promise<boolean>;
	/** Vrai si une mise à jour prête a été armée pour l'installation : c'est
	    à l'appelant de fermer la fenêtre, puis d'appeler `installerArmee()`
	    quand tout est fermé. */
	armerInstallation(): boolean;
	installationArmee(): boolean;
	/** Sizes of the downloaded installer and of the installed software (`null` when unpublished), for the update window. */
	tailles(): { paquet: number; installe: number | null };
	/** `quitAndInstall` : ne revient pas si tout va bien. */
	installerArmee(): void;
	/** Starts the download of a version that waits on a metered connection (the click on Download). */
	telecharger(): Promise<boolean>;
	surFocus(): void;
	arreter(): void;
	/** The last install did not land (`expected-update.ts`): the logo menu says so until a retry downloads. */
	signalerInachevee(): void;
}

export function creerMiseAJour(deps: {
	envoyer(etat: EtatMiseAJour): void;
	/** True when Windows says the connection is metered; false when unknown (never rejects). */
	limitee(): Promise<boolean>;
}): MiseAJour {
	let etat: EtatMiseAJour = ETAT_INITIAL;
	let armee = false;
	let derniereVerification = 0;
	let minuteur: NodeJS.Timeout | null = null;
	let remesure: NodeJS.Timeout | null = null;
	/** The version whose download this module already started: never twice. */
	let versionDemandee: string | null = null;
	/** The decision (metered or not) of the last `update-available`: a manual check waits for it, so its answer reads the settled state. */
	let decision: Promise<void> = Promise.resolve();
	let tailles: { paquet: number; installe: number | null } = { paquet: 0, installe: null };

	const appliquer = (ev: EvenementMiseAJour): void => {
		etat = transition(etat, ev);
		deps.envoyer(etat);
	};

	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.allowPrerelease = false;
	autoUpdater.logger = {
		info: (m: unknown) => console.log(LOG_PREFIX, "mise à jour:", m),
		warn: (m: unknown) => console.warn(LOG_PREFIX, "mise à jour:", m),
		error: (m: unknown) => console.error(LOG_PREFIX, "mise à jour:", m),
		debug: () => {},
	};
	autoUpdater.on("checking-for-update", () => appliquer({ type: "checking-for-update" }));
	autoUpdater.on("update-available", info => { decision = surDisponible(info.version).catch(e => console.warn(LOG_PREFIX, "mise à jour:", e)); });
	autoUpdater.on("update-not-available", () => appliquer({ type: "update-not-available" }));
	autoUpdater.on("download-progress", p => appliquer({ type: "download-progress", percent: p.percent, transferred: p.transferred, total: p.total }));
	autoUpdater.on("update-downloaded", info => {
		/* The update window measures the installation against these two sizes
		   (`installer/noyau.ts`, `progressionInstallation`). `installedSize` is the
		   optional root key the CI publishes in `latest.yml`; absent, the window's
		   bar stays indeterminate. */
		const racine = info as unknown as { files?: { size?: unknown }[]; installedSize?: unknown };
		const paquet = Number(racine.files?.[0]?.size);
		const installe = Number(racine.installedSize);
		tailles = {
			paquet: Number.isSafeInteger(paquet) && paquet > 0 ? paquet : 0,
			installe: Number.isSafeInteger(installe) && installe > 0 ? installe : null,
		};
		appliquer({ type: "update-downloaded", version: info.version });
	});
	// Le type de l'événement est `(error: Error, message?: string) => void` :
	// `error` n'est jamais absent, contrairement à ce qu'un `catch` laisserait
	// penser.
	autoUpdater.on("error", error => appliquer({ type: "error", message: error.message }));

	function lancerTelechargement(version: string): void {
		if (versionDemandee === version) return;
		versionDemandee = version;
		/* The `error` event already turns a failure into a state; the catch only
		   keeps the rejected promise from surfacing as "unhandled". */
		autoUpdater.downloadUpdate().catch(e => {
			versionDemandee = null;
			console.warn(LOG_PREFIX, "mise à jour: téléchargement impossible:", e);
		});
	}

	function arreterRemesure(): void {
		if (remesure) clearInterval(remesure);
		remesure = null;
	}

	/** While a version waits: ask again, and download as soon as the link is free. */
	async function remesurer(): Promise<void> {
		if (etat.phase !== "disponible") { arreterRemesure(); return; }
		if (await deps.limitee()) return;
		await telecharger();
	}

	async function surDisponible(version: string): Promise<void> {
		const limitee = await deps.limitee();
		appliquer({ type: "update-available", version, limitee });
		if (etat.phase === "disponible") {
			if (!remesure) remesure = setInterval(() => { void remesurer(); }, REMESURE_MS);
		} else {
			arreterRemesure();
			/* "telechargement" only: a version already "prete" is not fetched again. */
			if (etat.phase === "telechargement") lancerTelechargement(version);
		}
	}

	async function telecharger(): Promise<boolean> {
		if (etat.phase !== "disponible" || !etat.version) return false;
		arreterRemesure();
		const version = etat.version;
		appliquer({ type: "download-started" });
		lancerTelechargement(version);
		return true;
	}

	async function verifier(): Promise<boolean> {
		if (!app.isPackaged) {
			console.log(LOG_PREFIX, "mise à jour: ignorée hors d'un paquet (app.isPackaged faux)");
			return false;
		}
		derniereVerification = Date.now();
		try {
			await autoUpdater.checkForUpdates();
			await decision;
		} catch (e) {
			// Déjà traduit en état par l'événement `error` ; ici seulement pour
			// qu'une promesse rejetée ne remonte pas en « unhandled ».
			console.warn(LOG_PREFIX, "mise à jour: vérification impossible:", e);
		}
		return true;
	}

	function armerMinuteur(): void {
		if (minuteur) clearInterval(minuteur);
		minuteur = setInterval(() => { void verifier(); }, PERIODE_MS);
	}

	return {
		etat: () => etat,
		initialiser() {
			armerMinuteur();
			void verifier();
		},
		verifier,
		armerInstallation() {
			if (etat.phase !== "prete") return false;
			armee = true;
			return true;
		},
		installationArmee: () => armee,
		signalerInachevee: () => appliquer({ type: "unfinished" }),
		tailles: () => tailles,
		installerArmee() {
			autoUpdater.quitAndInstall(true, true);
		},
		telecharger,
		surFocus() {
			if (etat.phase === "disponible") void remesurer();
			if (Date.now() - derniereVerification < GARDE_FOCUS_MS) return;
			void verifier();
		},
		arreter() {
			if (minuteur) clearInterval(minuteur);
			minuteur = null;
			arreterRemesure();
		},
	};
}

/* PLUS DE `lireReglageAuto` NI DE `CLE_REGLAGES_MAJ` (2026-09-17) : la mise à
   jour automatique ne se coupe plus. Retirer la seule LECTURE de cette clé
   était le point important — l'interrupteur parti, un `{ auto: false }` déjà
   écrit sur une installation aurait éteint ses mises à jour pour toujours,
   sans plus rien pour les rallumer. Ce qui reste dans `settings.json` est
   ignoré, jamais effacé. */
