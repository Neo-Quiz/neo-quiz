/* ══════════════════════════════════════════════════════════
   AUTOMATIC UPDATE: the electron-updater wiring

   Everything lives here, in the MAIN process: the renderer only sees a state
   pushed through the bridge (`CANAUX.miseAJourEtat`) and gives three orders.
   The feed is `resources/app-update.yml`, written by electron-builder (the
   `publish` key of the config): the repository's GitHub releases, nothing else.

   WHEN IT CHECKS: at startup (after the window, never before: a network
   error at boot must not delay anything), when the window regains focus
   with a fifteen-minute guard, and every four hours. Offline is a NORMAL
   state: the error is logged, never shown as a Notice.

   A STALLED CONNECTION (2026-10-19): electron-updater's own request timeout
   never fires under Electron (`updater-timeout.ts`), so a check or a download
   that stalled stayed pending until a restart. The timeout is now real, and
   a failed check or download is tried again two minutes later, three times
   in a row at most; after that the usual checks (focus, four hours) take
   over. Every updater line also goes to `logs/updater.log` (`updater-log.ts`).

   HOW IT INSTALLS: through the existing CLOSE path. `installer()` arms a
   flag then closes the window; `main.ts` flushes the renderer's deferred
   writes as for the close button, and once everything is closed,
   `quitAndInstall(true, true)` (silent NSIS, forced relaunch) replaces
   `app.quit()`. A pending keystroke is never lost to an update.
   ONLY ON A CLICK (2026-10-16): `autoInstallOnAppQuit` is false. A
   downloaded version used to install itself at the next close without
   anyone asking; it now waits, shown as "ready", until the user clicks
   Install. `check:updater` pins the flag.

   METERED CONNECTION (2026-10-07): `autoDownload` is OFF; this module
   decides, on each `update-available`, from `deps.limitee()` (see
   `connexion-limitee.ts`: when in doubt, NOT metered). Free: the download
   starts at once, as before. Metered: phase "disponible", nothing comes
   down before the click on Download (the `miseAJourInstaller` channel,
   which on Windows only served the "ready" state). While a version waits,
   the connection is measured again every five minutes (and on focus): once
   it is free again, the download starts by itself.

   IN DEVELOPMENT (`app.isPackaged === false`): nothing, said once.
   electron-updater has no `app-update.yml` to read outside a package.
══════════════════════════════════════════════════════════ */

import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { LOG_PREFIX } from "../../../src/branding";
import { ETAT_INITIAL, transition } from "./mise-a-jour-etat";
import type { EtatMiseAJour, EvenementMiseAJour } from "./mise-a-jour-etat";
import { installInactivityTimeout } from "./updater-timeout";
import type { LogLevel } from "./updater-log";

const GARDE_FOCUS_MS = 15 * 60 * 1000;
const PERIODE_MS = 4 * 60 * 60 * 1000;
/** While a version waits on a metered connection: how often to ask again. */
const REMESURE_MS = 5 * 60 * 1000;
/** After a failed check or download: how long before trying again, and how many times in a row. */
const RETRY_MS = 2 * 60 * 1000;
const MAX_RETRIES = 3;

export interface MiseAJour {
	etat(): EtatMiseAJour;
	/** At startup, AFTER the window: arms the timer and runs the first check.
	    NO PARAMETER since 2026-09-17: there is no setting left to read,
	    automatic update is the only mode. */
	initialiser(): void;
	/** False when no check ran (a dev build, `app.isPackaged` false): the
	    "Check for updates" menu entry then says so instead of staying silent. */
	verifier(): Promise<boolean>;
	/** True when a ready update was armed for installation: the caller then
	    closes the window, and calls `installerArmee()` once everything is closed. */
	armerInstallation(): boolean;
	installationArmee(): boolean;
	/** Sizes of the downloaded installer and of the installed software (`null` when unpublished), for the update window. */
	tailles(): { paquet: number; installe: number | null };
	/** `quitAndInstall`: does not return when all goes well. */
	installerArmee(): void;
	/** Starts the download of a version that waits on a metered connection (the click on Download). */
	telecharger(): Promise<boolean>;
	surFocus(): void;
	arreter(): void;
	/** The last install did not land (`expected-update.ts`): the logo menu says so until a retry downloads. */
	signalerInachevee(): void;
	/** Windows says the connection is metered; false when unknown (never rejects). */
	connexionLimitee(): Promise<boolean>;
}

export function creerMiseAJour(deps: {
	envoyer(etat: EtatMiseAJour): void;
	/** Called once whenever the updater enters the ready-to-install phase. */
	surPrete?: () => void;
	/** True when Windows says the connection is metered; false when unknown (never rejects). */
	limitee(): Promise<boolean>;
	/** Where each updater line is kept on disk (`updater-log.ts`); the console always gets it. */
	journal?: (level: LogLevel, message: string) => void;
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
	let retry: NodeJS.Timeout | null = null;
	let retries = 0;

	const log = (level: LogLevel, m: unknown): void => {
		const text = m instanceof Error ? (m.stack ?? m.message) : String(m);
		if (level === "error") console.error(LOG_PREFIX, "update:", text);
		else if (level === "warn") console.warn(LOG_PREFIX, "update:", text);
		else console.log(LOG_PREFIX, "update:", text);
		deps.journal?.(level, text);
	};

	const appliquer = (ev: EvenementMiseAJour): void => {
		const phasePrecedente = etat.phase;
		etat = transition(etat, ev);
		deps.envoyer(etat);
		if (phasePrecedente !== "prete" && etat.phase === "prete") deps.surPrete?.();
	};

	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = false;
	autoUpdater.allowPrerelease = false;
	autoUpdater.logger = {
		info: (m: unknown) => log("info", m),
		warn: (m: unknown) => log("warn", m),
		error: (m: unknown) => log("error", m),
		debug: () => {},
	};
	if (!installInactivityTimeout(autoUpdater)) log("warn", "request timeout not installed: electron-updater has no addTimeOutHandler hook");
	autoUpdater.on("checking-for-update", () => appliquer({ type: "checking-for-update" }));
	autoUpdater.on("update-available", info => { decision = surDisponible(info.version).catch(e => log("warn", e)); });
	autoUpdater.on("update-not-available", () => { retries = 0; appliquer({ type: "update-not-available" }); });
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
		retries = 0;
		appliquer({ type: "update-downloaded", version: info.version });
	});
	// The event's type is `(error: Error, message?: string) => void`: `error`
	// is never missing, whatever a `catch` would suggest.
	autoUpdater.on("error", error => {
		appliquer({ type: "error", message: error.message });
		planifierNouvelEssai();
	});

	/** A failed check or download is tried again RETRY_MS later, MAX_RETRIES
	    times in a row; a downloaded version, or a check that finds nothing,
	    resets the count. A ready version is never fetched again. */
	function planifierNouvelEssai(): void {
		if (etat.phase === "prete" || retry || retries >= MAX_RETRIES || !app.isPackaged) return;
		retries++;
		log("info", `retry ${retries}/${MAX_RETRIES} in ${RETRY_MS / 60_000} min`);
		retry = setTimeout(() => {
			retry = null;
			void verifier();
		}, RETRY_MS);
	}

	function lancerTelechargement(version: string): void {
		if (versionDemandee === version) return;
		versionDemandee = version;
		/* The `error` event already turns a failure into a state; the catch only
		   keeps the rejected promise from surfacing as "unhandled". */
		autoUpdater.downloadUpdate().catch(e => {
			versionDemandee = null;
			log("warn", `download failed: ${e instanceof Error ? e.message : String(e)}`);
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
			console.log(LOG_PREFIX, "update: skipped outside a package (app.isPackaged false)");
			return false;
		}
		derniereVerification = Date.now();
		try {
			await autoUpdater.checkForUpdates();
			await decision;
		} catch (e) {
			// Already turned into a state by the `error` event; caught here only
			// so that a rejected promise does not surface as "unhandled".
			log("warn", `check failed: ${e instanceof Error ? e.message : String(e)}`);
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
		connexionLimitee: () => deps.limitee(),
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
			if (retry) clearTimeout(retry);
			retry = null;
			arreterRemesure();
		},
	};
}

/* NO MORE `lireReglageAuto` NOR `CLE_REGLAGES_MAJ` (2026-09-17): automatic
   update can no longer be turned off. Removing the only READ of that key was
   the point: with the switch gone, a `{ auto: false }` already written on an
   install would have turned its updates off forever, with nothing left to
   turn them back on. What remains in `settings.json` is ignored, never erased. */
