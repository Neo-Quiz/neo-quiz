/* ══════════════════════════════════════════════════════════
   PROCESSUS PRINCIPAL DU BOOTSTRAPPER

   La fenêtre est volontairement NON élevée. Au clic sur Installer, le même
   portable est relancé dans un mode travailleur sans fenêtre : directement
   quand l'utilisateur peut écrire dans le dossier (le défaut, une
   installation par utilisateur sous `%LOCALAPPDATA%`), avec `runas` donc
   l'UAC seulement sinon. Le processus initial garde l'UI et lance
   l'application finale, afin que Neo Quiz démarre avec les droits ordinaires
   de l'utilisateur, jamais ceux d'un travailleur administrateur.
══════════════════════════════════════════════════════════ */

import { randomBytes, randomUUID } from "node:crypto";
import { access, rm, statfs, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { spawn } from "node:child_process";
import { app, BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import { setLanguage, t } from "../../../src/i18n";
import { PRODUCT_NAME } from "../../../src/branding";
import { langueDepuisLocale, NOM_EXECUTABLE, urlLatestYml, type LangueInstallateur, type PaquetInstallable } from "./noyau";
import {
	CANAUX_INSTALLATEUR,
	type ChargeTravailleur,
	type CodeErreurInstallateur,
	type EtatInstallateur,
	type InitResult,
	type InstallerCause,
	type InstallerDiagnosis,
	type InstallerErrorDetail,
	type InstallerStep,
	type MessageTravailleur,
} from "./protocole";
import { diagnose, parseErrorDetail, resumeFrom, retryAction, retryPlan, technicalDetails } from "./diagnosis";
import { activeVpn, appendLog, dnsWorksElsewhere, LOG_PATH } from "./probe";
import { ErreurTravailleur, executerTravailleur, lirePaquetPublie, lireTexteGithub } from "./worker";

const DRAPEAU_TRAVAILLEUR = "--neo-quiz-installer-worker";
/** Écrit à côté de l'exécutable extrait quand la fenêtre a peint son premier
    écran : le conteneur portable, qui affichait jusque-là ce même écran en
    image (`installer/ecran-initial.bmp`), retire alors la sienne. Même nom que
    `NEO_QUIZ_SPLASH_DONE` dans le template patché (`patches/app-builder-lib+*`). */
const SIGNAL_ECRAN_INITIAL = "neo-quiz-splash-done";
/** Le premier écran COMPLET : polices, icône et décor décodés, puis deux
    images produites. Montrée plus tôt, la fenêtre recouvrirait l'aperçu du
    conteneur par un écran sans son décor, qui apparaîtrait ensuite d'un coup. */
const PREMIER_ECRAN_COMPLET = `(async () => {
	await document.fonts.ready;
	const fond = new Image();
	fond.src = "./fond.png";
	await Promise.all([fond, ...document.images].map(image => image.decode().catch(() => {})));
	await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
})()`;
const DEUX_IMAGES = "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))";

let fenetre: BrowserWindow | null = null;
let paquetCourant: PaquetInstallable | null = null;
let socketTravailleur: Socket | null = null;
let serveurTube: Server | null = null;
/** Le processus lancé au clic, avant que le travailleur ne s'authentifie :
    PowerShell/RunAs quand l'élévation est requise, le travailleur sinon. */
let processusLancement: ReturnType<typeof spawn> | null = null;
let installationActive = false;
let fermetureAutorisee = false;
/** La langue de l'installeur : celle de Windows (`detecterLangue`). */
let langue: LangueInstallateur = "en";
/** Le dossier d'installation que le rendu affiche, tenu à jour par le
    principal : c'est LUI qui compose le chemin de l'exécutable à ouvrir. */
let dossierCourant = "";

function argumentsTravailleur(): { tube: string; charge: string } | null {
	const index = process.argv.indexOf(DRAPEAU_TRAVAILLEUR);
	if (index < 0) return null;
	const tube = process.argv[index + 1];
	const charge = process.argv[index + 2];
	return tube && charge ? { tube, charge } : null;
}

function envoyerEtat(etat: EtatInstallateur): void {
	if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send(CANAUX_INSTALLATEUR.etat, etat);
}

function codeErreur(value: unknown): CodeErreurInstallateur {
	return value === "network" || value === "elevation" || value === "integrity" ||
		value === "installation" || value === "release" || value === "launch"
		? value : "generic";
}

function decoderMessage(ligne: string): MessageTravailleur | null {
	try {
		const value: unknown = JSON.parse(ligne);
		if (!value || typeof value !== "object") return null;
		const v = value as Record<string, unknown>;
		switch (v.type) {
			case "auth":
				return typeof v.secret === "string" ? { type: "auth", secret: v.secret } : null;
			case "telechargement":
				return typeof v.recus === "number" && typeof v.total === "number"
					? { type: "telechargement", recus: v.recus, total: v.total } : null;
			case "verification": return { type: "verification" };
			case "installation":
				return v.pourcent === null || (typeof v.pourcent === "number" && Number.isFinite(v.pourcent))
					? { type: "installation", pourcent: v.pourcent } : null;
			case "termine": return typeof v.executable === "string" ? { type: "termine", executable: v.executable } : null;
			case "annule": return { type: "annule" };
			case "erreur": {
				const detail = parseErrorDetail(v.detail);
				return detail ? { type: "erreur", code: codeErreur(v.code), detail } : { type: "erreur", code: codeErreur(v.code) };
			}
			default: return null;
		}
	} catch {
		return null;
	}
}

async function ancetreExistant(dossier: string): Promise<string> {
	let courant = resolve(dossier);
	for (;;) {
		try {
			await access(courant);
			return courant;
		} catch {
			const parent = dirname(courant);
			if (parent === courant) throw new Error("aucun ancêtre accessible");
			courant = parent;
		}
	}
}

async function espaceDisponible(dossier: string): Promise<number> {
	const base = await ancetreExistant(dossier);
	const stats = await statfs(base);
	return Math.max(0, stats.bavail * stats.bsize);
}

function dossierDefaut(): string {
	/* `%LOCALAPPDATA%\Programs` (et non plus `Program Files`, 2026-09-18) :
	   c'est l'emplacement d'une installation PAR UTILISATEUR, le seul où écrire
	   ne demande pas l'élévation — ni maintenant, ni à chaque mise à jour. Même
	   dossier que VS Code et Discord. La raison complète est dans
	   `electron-builder.config.mjs`, `nsis.perMachine`.

	   La variable d'environnement est préférée au littéral pour respecter un
	   profil déplacé ; le repli reste le chemin conventionnel, et non
	   `Program Files`, qui ramènerait l'UAC par la porte de derrière. */
	const local = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? "C:\\Users\\Default", "AppData", "Local");
	return join(local, "Programs", PRODUCT_NAME);
}

/** Neo Quiz est-il DÉJÀ installé dans ce dossier ?

    LE BOOTSTRAPPER NE SERT QU'À LA PREMIÈRE INSTALLATION. Les mises à jour
    arrivent par electron-updater, depuis l'application elle-même, qui se
    ferme avant d'installer. Lancé PAR-DESSUS une installation existante, NSIS
    échoue dans `un.atomicRMDir` d'electron-builder — un `Rename` refusé, puis
    `un.restoreFiles` qui remet tout, puis `Abort` (code 2) — et l'utilisateur
    ne lit qu'« Échec de désinstallation des anciens fichiers d'application ».
    Vu à l'écran le 2026-09-16, y compris avec le bootstrapper PUBLIÉ : le
    défaut est antérieur à toute mesure de progression. Le dire AVANT le clic
    vaut mieux que de le laisser échouer après l'UAC et le téléchargement.

    LIMITE ASSUMÉE : on regarde le DOSSIER, pas le registre. Une installation
    déplacée ailleurs ne serait pas vue ici — NSIS, lui, la retrouverait par le
    registre et échouerait comme avant. Lire le registre demanderait `reg.exe`
    ou un module natif pour un cas qui ne s'est jamais produit. */
async function installationPresente(dossier: string): Promise<boolean> {
	try {
		await access(join(dossier, NOM_EXECUTABLE));
		return true;
	} catch {
		return false;
	}
}

/** L'utilisateur peut-il écrire dans ce dossier sans élévation ?

    L'installation est PAR UTILISATEUR depuis le 2026-09-18 (`/currentuser`,
    `noyau.ts`) : NSIS n'a besoin des droits administrateur que pour écrire
    là où l'utilisateur ne le peut pas. On l'éprouve pour de vrai, un fichier
    créé puis effacé dans le dossier ou son premier ancêtre existant, plutôt
    que de deviner d'après le chemin. Un refus, quel qu'il soit, garde l'UAC :
    se tromper dans ce sens ne coûte qu'une invite, jamais une installation. */
async function elevationRequise(dossier: string): Promise<boolean> {
	try {
		const sonde = join(await ancetreExistant(dossier), `.neo-quiz-sonde-${randomUUID()}`);
		await writeFile(sonde, "", { flag: "wx" });
		await rm(sonde, { force: true });
		return false;
	} catch {
		return true;
	}
}

function dossierValide(dossier: string): boolean {
	if (!isAbsolute(dossier)) return false;
	const normalise = resolve(dossier);
	return parse(normalise).root !== normalise;
}

/** The `latest.yml` of the release this bootstrapper comes from
    (`urlLatestYml`, `installer/noyau.ts`), read through github.com and not
    the REST API: WITHOUT the 60 requests per hour and per IP quota (see
    `URL_LATEST_YML`). `app.getVersion()` is the version of
    apps/windows/package.json, the one the file name carries. Read through the
    worker's HTTPS stack (`lirePaquetPublie`), so a failure carries the same
    raw facts (errno, HTTP status, host) as a failed download. */
async function chargerPaquet(): Promise<PaquetInstallable> {
	return await lirePaquetPublie(app.getVersion());
}

/* ─────────── diagnosis of a failure ─────────── */

/** The last diagnosis shown: "Try again" resumes from it. */
let dernierDiagnostic: InstallerDiagnosis | null = null;
/** The cause of the attempt being retried, to say "still blocked". */
let causeReessayee: InstallerCause | null = null;
/** The installed executable, when only its opening failed. */
let executableInstalle: string | null = null;
/** A retry is testing the connection or re-reading the release, before any
    worker exists; Cancel must still stop it. */
let reessaiEnCours = false;
let reessaiAnnule = false;

/** The raw facts of any error, for the window's diagnosis. */
function faitsDe(erreur: unknown, step: InstallerStep): InstallerErrorDetail {
	if (erreur instanceof ErreurTravailleur) return { ...erreur.faits, step };
	const code = (erreur as { code?: unknown } | null)?.code;
	const cause = (erreur as { cause?: { code?: unknown } } | null)?.cause?.code;
	const errno = typeof code === "string" ? code : typeof cause === "string" ? cause : undefined;
	return parseErrorDetail({ step, errno, message: String((erreur as Error)?.message ?? erreur) }) ?? { step };
}

/** Names the cause from the raw facts plus what this PC shows right now: an
    active VPN interface, DNS for another host (offline or GitHub alone
    blocked?), free space at the install location. */
async function diagnostiquer(detail: InstallerErrorDetail, code?: CodeErreurInstallateur): Promise<InstallerDiagnosis> {
	const vpn = activeVpn();
	const reseau = detail.errno !== undefined && detail.http === undefined && code !== "integrity" &&
		(detail.step === "init" || detail.step === "download" || detail.step === "connection");
	const dnsElsewhere = reseau ? await dnsWorksElsewhere() : null;
	let diskShort = false;
	if (paquetCourant && (detail.step === "install" || detail.errno === "ENOSPC")) {
		try {
			const besoin = paquetCourant.taille + (paquetCourant.tailleInstallee ?? paquetCourant.taille);
			diskShort = await espaceDisponible(dossierCourant) < besoin;
		} catch {
			// Unknown free space is not a full disk.
		}
	}
	const contexte = { vpn: vpn?.name ?? null, dnsElsewhere, diskShort };
	const cause = diagnose(detail, contexte, code);
	const diagnostic: InstallerDiagnosis = {
		cause,
		vpn: contexte.vpn,
		exitCode: detail.exitCode ?? null,
		again: causeReessayee === cause,
		resume: resumeFrom(detail, cause),
		details: technicalDetails(cause, detail, {
			...contexte,
			vpnInterface: vpn?.iface ?? null,
			version: app.getVersion(),
			logPath: LOG_PATH,
		}),
	};
	causeReessayee = null;
	dernierDiagnostic = diagnostic;
	await appendLog(`main: ${code ?? "error"} diagnosed as ${cause}\n${diagnostic.details}`);
	return diagnostic;
}

/** Ends the session and shows the diagnosed failure. */
async function signalerErreur(code: CodeErreurInstallateur, detail: InstallerErrorDetail): Promise<void> {
	nettoyerSession();
	envoyerEtat({ phase: "erreur", code, diagnosis: await diagnostiquer(detail, code) });
}

function nettoyerSession(): void {
	const lancement = processusLancement;
	processusLancement = null;
	if (lancement && !lancement.killed) {
		try { lancement.kill(); } catch { /* déjà terminé */ }
	}
	socketTravailleur?.destroy();
	socketTravailleur = null;
	if (serveurTube) {
		try { serveurTube.close(); } catch { /* déjà fermé */ }
	}
	serveurTube = null;
	installationActive = false;
}

async function traiterMessage(message: MessageTravailleur): Promise<void> {
	switch (message.type) {
		case "auth":
			return;
		case "telechargement":
			envoyerEtat({ phase: "telechargement", recus: message.recus, total: message.total });
			return;
		case "verification":
			envoyerEtat({ phase: "verification" });
			return;
		case "installation":
			envoyerEtat({ phase: "installation", pourcent: message.pourcent });
			return;
		case "annule":
			nettoyerSession();
			envoyerEtat({ phase: "annule" });
			return;
		case "erreur":
			await signalerErreur(message.code, message.detail ?? { step: "worker", message: "error without detail" });
			return;
		case "termine": {
			if (!isAbsolute(message.executable)) {
				await signalerErreur("installation", { step: "postcheck", message: "worker sent a relative executable path" });
				return;
			}
			/* L'installation est finie mais le bootstrapper RESTE à l'écran : le
			   rendu remplace la progression par un spinner pendant que Neo Quiz
			   s'initialise caché. Il ne disparaît qu'une fois la vraie fenêtre de
			   l'application devenue visible, donc réellement prête. */
			envoyerEtat({ phase: "demarrage" });
			executableInstalle = message.executable;
			const lancee = await lancerApplicationEtAttendre(message.executable);
			if (!lancee) {
				await signalerErreur("launch", { step: "open", downloadVerified: true, message: "the app window did not become visible within 30 s" });
				return;
			}
			nettoyerSession();
			fermetureAutorisee = true;
			fenetre?.close();
			app.quit();
			return;
		}
	}
}

async function ecouterTravailleur(nomTube: string, secret: string): Promise<void> {
	const serveur = createServer(socket => {
		if (socketTravailleur) {
			socket.destroy();
			return;
		}
		socket.setEncoding("utf8");
		let reste = "";
		let authentifie = false;
		socket.on("data", morceau => {
			reste += morceau;
			for (;;) {
				const fin = reste.indexOf("\n");
				if (fin < 0) break;
				const ligne = reste.slice(0, fin);
				reste = reste.slice(fin + 1);
				const message = decoderMessage(ligne);
				if (!message) continue;
				if (!authentifie) {
					if (message.type !== "auth" || message.secret !== secret) {
						socket.destroy();
						return;
					}
					authentifie = true;
					socketTravailleur = socket;
					continue;
				}
				void traiterMessage(message);
			}
		});
		socket.on("close", () => {
			if (socketTravailleur === socket) socketTravailleur = null;
		});
	});
	serveurTube = serveur;
	await new Promise<void>((resolvePromise, reject) => {
		const surErreur = (erreur: Error): void => reject(erreur);
		serveur.once("error", surErreur);
		serveur.listen(nomTube, () => {
			serveur.off("error", surErreur);
			resolvePromise();
		});
	});
}

/** La langue de l'installeur : celle de Windows, comme l'application en
    mode « auto » (`electron/main.ts`). `app.getLocale()` n'est fiable
    qu'après `ready` — d'où l'appel depuis `whenReady`. Rien n'est écrit
    dans les réglages de l'application : elle fera la même déduction. */
function detecterLangue(): void {
	langue = langueDepuisLocale(app.getLocale());
}

/** L'application garde maintenant sa vraie fenêtre CACHÉE jusqu'au signal
    explicite `fenetre.prete()` envoyé après l'initialisation du rendu. Attendre
    une fenêtre Win32 VISIBLE revient donc exactement à attendre que Neo Quiz
    soit configuré et utilisable, pas seulement que Chromium ait peint du HTML. */
async function attendreFenetreApplication(pid: number): Promise<boolean> {
	const script = [
		"$ErrorActionPreference='Stop'",
		"Add-Type -Namespace NeoQuiz -Name Native -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(System.IntPtr hWnd);'",
		"$p=[System.Diagnostics.Process]::GetProcessById([int]$env:NQ_APP_PID)",
		"$limite=[DateTime]::UtcNow.AddSeconds(30)",
		"while([DateTime]::UtcNow -lt $limite){$p.Refresh();if($p.HasExited){exit 3};$h=$p.MainWindowHandle;if($h -ne [IntPtr]::Zero -and [NeoQuiz.Native]::IsWindowVisible($h)){exit 0};Start-Sleep -Milliseconds 100}",
		"exit 2",
	].join("; ");
	return await new Promise<boolean>(resolvePromise => {
		const veille = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
			windowsHide: true,
			stdio: "ignore",
			env: { ...process.env, NQ_APP_PID: String(pid) },
		});
		veille.once("error", () => resolvePromise(false));
		veille.once("exit", code => resolvePromise(code === 0));
	});
}

/** Lance depuis le processus NON ÉLEVÉ, puis garde le bootstrapper à l'écran
    tant que Neo Quiz n'a pas rendu sa vraie fenêtre visible. Ce geste remplace
    `shell.openPath` précisément parce qu'il faut suivre le PID lancé. */
async function lancerApplicationEtAttendre(executable: string): Promise<boolean> {
	return await new Promise<boolean>(resolvePromise => {
		const enfant = spawn(executable, [], {
			detached: true,
			windowsHide: false,
			stdio: "ignore",
		});
		let resolu = false;
		const terminer = (ok: boolean): void => {
			if (resolu) return;
			resolu = true;
			resolvePromise(ok);
		};
		enfant.once("error", () => terminer(false));
		enfant.once("spawn", () => {
			const pid = enfant.pid;
			if (!pid) {
				terminer(false);
				return;
			}
			enfant.unref();
			void attendreFenetreApplication(pid).then(terminer);
		});
	});
}

async function lancerTravailleur(nomTube: string, charge: string, eleve: boolean): Promise<{ code: number; errno?: string }> {
	/* Le conteneur portable a déjà extrait Electron pour afficher l'UI.
	   Relancer PORTABLE_EXECUTABLE_FILE referait cette extraction (~100 Mo
	   dans les versions actuelles) avant le premier octet téléchargé.
	   Le binaire déjà extrait contient exactement la même app packagée et reste
	   vivant tant que cette fenêtre l'est : il peut donc servir de travailleur. */
	const executable = process.execPath;
	if (!isAbsolute(executable)) return { code: -1 };
	const script = [
		"$ErrorActionPreference='Stop'",
		"$a=@('--neo-quiz-installer-worker',$env:NQ_INSTALLER_PIPE,$env:NQ_INSTALLER_PAYLOAD)",
		"try { $p=Start-Process -FilePath $env:NQ_INSTALLER_EXE -ArgumentList $a -Verb RunAs -PassThru -Wait; exit $p.ExitCode } catch { exit 1223 }",
	].join("; ");
	return await new Promise<{ code: number; errno?: string }>(resolvePromise => {
		const enfant = eleve
			? spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
				windowsHide: true,
				stdio: "ignore",
				env: {
					...process.env,
					NQ_INSTALLER_EXE: executable,
					NQ_INSTALLER_PIPE: nomTube,
					NQ_INSTALLER_PAYLOAD: charge,
				},
			})
			: spawn(executable, [DRAPEAU_TRAVAILLEUR, nomTube, charge], {
				windowsHide: true,
				stdio: "ignore",
			});
		processusLancement = enfant;
		const terminer = (resultat: { code: number; errno?: string }): void => {
			if (processusLancement === enfant) processusLancement = null;
			resolvePromise(resultat);
		};
		/* A refused process creation (antivirus, Smart App Control) is named by
		   its errno instead of a bare -1. */
		enfant.once("error", erreur => terminer({ code: -1, errno: (erreur as NodeJS.ErrnoException).code ?? "UNKNOWN" }));
		enfant.once("exit", code => terminer({ code: code ?? -1 }));
	});
}

/** `repriseInstallation`: the package is already downloaded and verified (the
    worker checks it again), so the window says so instead of a 0 % download. */
async function demarrerInstallation(dossier: string, repriseInstallation = false): Promise<void> {
	/* A second click while an attempt runs is ignored, never turned into an
	   error over the running one. */
	if (installationActive) return;
	if (!paquetCourant) {
		await signalerErreur("release", { step: "init", message: "no release loaded" });
		return;
	}
	if (!dossierValide(dossier)) {
		await signalerErreur("generic", { step: "worker", message: "invalid install folder" });
		return;
	}
	installationActive = true;
	const eleve = await elevationRequise(dossier);
	envoyerEtat(eleve ? { phase: "elevation" }
		: repriseInstallation ? { phase: "retrying", action: "install" }
		: { phase: "telechargement", recus: 0, total: paquetCourant.taille });

	const nomTube = `\\\\.\\pipe\\neo-quiz-installer-${randomUUID()}`;
	const secret = randomBytes(32).toString("hex");
	const charge: ChargeTravailleur = { secret, dossier: resolve(dossier), paquet: paquetCourant };
	const encodee = Buffer.from(JSON.stringify(charge), "utf8").toString("base64url");

	try {
		await ecouterTravailleur(nomTube, secret);
	} catch (erreur) {
		await signalerErreur("generic", { step: "worker", message: `pipe: ${String(erreur)}`.slice(0, 300) });
		return;
	}

	const { code, errno } = await lancerTravailleur(nomTube, encodee, eleve);
	/* The worker reports every failure AFTER it authenticated. When no socket
	   ever authenticated, what is visible is the refusal of the Windows
	   elevation (1223, from the PowerShell script), or a worker that did not
	   start: its spawn errno or exit code, named in the diagnosis. */
	if (installationActive && !socketTravailleur && code !== 0) {
		if (eleve && code === 1223) {
			nettoyerSession();
			envoyerEtat({ phase: "erreur", code: "elevation" });
			return;
		}
		await signalerErreur("generic", { step: "worker", exitCode: code, ...(errno ? { errno } : {}), message: "the installer worker stopped before connecting" });
	}
}

/** "Try again": resumes at the step that failed, from the last diagnosis.
    A network, proxy or TLS cause first gets a quick request to GitHub, so a
    block still in place is said at once instead of after a new download; a
    version being published re-reads `latest.yml`; a verified download is not
    fetched again; a failed opening only reopens the app. */
async function reessayerInstallation(): Promise<void> {
	if (installationActive) return;
	const precedent = dernierDiagnostic;
	if (!precedent) {
		await demarrerInstallation(dossierCourant);
		return;
	}
	const plan = retryPlan(precedent);
	causeReessayee = precedent.cause;
	reessaiEnCours = true;
	reessaiAnnule = false;
	try {
		await reessayerSelonPlan(plan, precedent.resume === "install");
	} finally {
		reessaiEnCours = false;
	}
}

async function reessayerSelonPlan(plan: ReturnType<typeof retryPlan>, downloadVerified: boolean): Promise<void> {
	if (plan.resume === "open") {
		envoyerEtat({ phase: "demarrage" });
	} else {
		envoyerEtat({ phase: "retrying", action: retryAction(plan) });
	}

	if (plan.resume === "open") {
		if (executableInstalle && await lancerApplicationEtAttendre(executableInstalle)) {
			fermetureAutorisee = true;
			fenetre?.close();
			app.quit();
			return;
		}
		await signalerErreur("launch", { step: "open", downloadVerified: true, message: "the app window did not become visible within 30 s" });
		return;
	}
	if (plan.testConnection) {
		try {
			await lireTexteGithub(urlLatestYml(app.getVersion()), 8_000);
		} catch (erreur) {
			if (reessaiAnnule) return;
			await signalerErreur("network", { ...faitsDe(erreur, "connection"), ...(downloadVerified ? { downloadVerified } : {}) });
			return;
		}
		if (reessaiAnnule) return;
	}
	if (plan.reloadRelease) {
		try {
			paquetCourant = await chargerPaquet();
		} catch (erreur) {
			if (reessaiAnnule) return;
			await signalerErreur(erreur instanceof ErreurTravailleur ? erreur.code : "release",
				{ ...faitsDe(erreur, "connection"), ...(downloadVerified ? { downloadVerified } : {}) });
			return;
		}
		if (reessaiAnnule) return;
	}
	await demarrerInstallation(dossierCourant, plan.resume === "install");
}

function installerCanaux(): void {
	ipcMain.handle(CANAUX_INSTALLATEUR.initialiser, async (): Promise<InitResult> => {
		/* Called again by "Try again" after a failed start: same cause again
		   is "still blocked". */
		if (dernierDiagnostic?.resume === "init") causeReessayee = dernierDiagnostic.cause;
		const dossier = dossierDefaut();
		dossierCourant = dossier;
		try {
			paquetCourant = await chargerPaquet();
		} catch (erreur) {
			return { ok: false, diagnosis: await diagnostiquer(faitsDe(erreur, "init"), "release") };
		}
		causeReessayee = null;
		dernierDiagnostic = null;
		return {
			ok: true,
			infos: {
				version: paquetCourant.version,
				tailleTelechargement: paquetCourant.taille,
				dossier,
				espaceDisponible: await espaceDisponible(dossier),
				dejaInstalle: await installationPresente(dossier),
				elevationRequise: await elevationRequise(dossier),
			},
		};
	});
	ipcMain.handle(CANAUX_INSTALLATEUR.retry, async () => {
		await reessayerInstallation();
	});
	/* The clipboard is written by main: the sandboxed window has no reliable
	   clipboard access. Bounded text only; the log path is composed here, the
	   window never names a path. */
	ipcMain.on(CANAUX_INSTALLATEUR.copy, (_event, texte: unknown) => {
		if (typeof texte === "string") clipboard.writeText(texte.slice(0, 8_000));
	});
	ipcMain.on(CANAUX_INSTALLATEUR.copyLogPath, () => {
		clipboard.writeText(LOG_PATH);
	});
	ipcMain.handle(CANAUX_INSTALLATEUR.choisirDossier, async (_event, courant: unknown) => {
		if (typeof courant !== "string" || !dossierValide(courant) || !fenetre) return null;
		const choix = await dialog.showOpenDialog(fenetre, {
			title: t("installer.location.choose"),
			defaultPath: courant,
			properties: ["openDirectory", "createDirectory"],
		});
		const dossier = choix.canceled ? null : choix.filePaths[0];
		if (!dossier || !dossierValide(dossier)) return null;
		dossierCourant = dossier;
		return { dossier, espaceDisponible: await espaceDisponible(dossier), elevationRequise: await elevationRequise(dossier) };
	});
	ipcMain.handle(CANAUX_INSTALLATEUR.installer, async (_event, dossier: unknown) => {
		if (typeof dossier !== "string") {
			await signalerErreur("generic", { step: "worker", message: "install folder is not a string" });
			return;
		}
		/* A fresh click is a first attempt, not a retry. */
		causeReessayee = null;
		await demarrerInstallation(dossier);
	});
	ipcMain.handle(CANAUX_INSTALLATEUR.annuler, async () => {
		if (!installationActive) {
			/* Cancel during a retry's connection test: nothing to stop but the
			   test itself, which then starts nothing. */
			if (reessaiEnCours) {
				reessaiAnnule = true;
				envoyerEtat({ phase: "annule" });
			}
			return;
		}
		if (socketTravailleur) {
			socketTravailleur.write(`${JSON.stringify({ type: "annuler" })}\n`);
			return;
		}
		/* Avant l'authentification du travailleur, l'unique processus en attente
		   est PowerShell/RunAs (ou le travailleur non élevé qui démarre). Le
		   terminer ferme cette tentative sans laisser l'interface coincée sur un
		   faux état d'attente. */
		nettoyerSession();
		envoyerEtat({ phase: "annule" });
	});
	/* Le rendu ne transmet aucun chemin : le principal lance l'exécutable du
	   dossier qu'il a lui-même calculé, et seulement s'il existe. */
	ipcMain.on(CANAUX_INSTALLATEUR.ouvrirApplication, () => {
		void (async () => {
			const executable = join(dossierCourant, NOM_EXECUTABLE);
			if (!(await installationPresente(dossierCourant))) return;
			try {
				spawn(executable, [], { detached: true, windowsHide: false, stdio: "ignore" }).unref();
			} catch {
				return;
			}
			fermetureAutorisee = true;
			fenetre?.close();
		})();
	});
	ipcMain.on(CANAUX_INSTALLATEUR.fermer, () => {
		if (installationActive) return;
		fermetureAutorisee = true;
		fenetre?.close();
	});
}

/** Montre la fenêtre sur un premier écran complet, puis, une fois qu'elle a
    peint PAR-DESSUS l'aperçu du conteneur portable, dit à celui-ci de le
    retirer. Un script refusé ou une page déjà partie ne retiennent jamais la
    fenêtre : elle se montre quand même. */
async function montrerFenetre(): Promise<void> {
	const courante = fenetre;
	if (!courante || courante.isDestroyed()) return;
	try { await courante.webContents.executeJavaScript(PREMIER_ECRAN_COMPLET); } catch { /* montrer quand même */ }
	if (courante.isDestroyed()) return;
	courante.show();
	courante.focus();
	/* Seul le conteneur portable pose cette variable : lancé autrement, aucun
	   aperçu n'attend le signal. (`_DIR` et non `_FILE` : `check:installer`
	   garde que le principal ne relance jamais le conteneur.) */
	if (!process.env.PORTABLE_EXECUTABLE_DIR) return;
	try { await courante.webContents.executeJavaScript(DEUX_IMAGES); } catch { /* signaler quand même */ }
	try {
		await writeFile(join(dirname(process.execPath), SIGNAL_ECRAN_INITIAL), "");
	} catch {
		/* Sans signal, l'aperçu reste SOUS la fenêtre jusqu'à la fin, à la même
		   place : il ne se voit que si l'on déplace la fenêtre. */
	}
}

function creerFenetre(): void {
	fenetre = new BrowserWindow({
		width: 920,
		height: 640,
		minWidth: 920,
		minHeight: 640,
		maxWidth: 920,
		maxHeight: 640,
		frame: false,
		/* Sans `thickFrame`, Windows 11 ne dessine plus son contour DWM d'un
		   pixel clair autour de la fenêtre (visible sur fond noir). La fenêtre
		   n'est pas redimensionnable : la bordure de saisie ne manque à rien. */
		thickFrame: false,
		/* Sans `thickFrame`, Windows 11 n'arrondit plus les coins non plus :
		   la fenêtre devient TRANSPARENTE et c'est le CSS de `#app` qui porte
		   l'arrondi (`style-window.css`). Pas de `backgroundColor` : il
		   peindrait un rectangle opaque sous les coins. */
		transparent: true,
		resizable: false,
		show: false,
		icon: join(__dirname, "icon.png"),
		title: t("installer.windowTitle"),
		webPreferences: {
			preload: join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	fenetre.setMenuBarVisibility(false);
	/* La langue passe au rendu par l'URL : lue SYNCHRONEMENT avant le premier
	   rendu, là où un canal IPC arriverait après la première peinture — et le
	   rendu a sa propre instance d'i18n, `setLanguage` d'ici ne l'atteint pas. */
	void fenetre.loadFile(join(__dirname, "index.html"), { query: { lang: langue } });
	fenetre.webContents.once("dom-ready", () => {
		void montrerFenetre();
	});
	fenetre.on("close", evenement => {
		if (installationActive && !fermetureAutorisee) evenement.preventDefault();
	});
	fenetre.on("closed", () => { fenetre = null; });
}

const travailleur = argumentsTravailleur();
if (travailleur) {
	void app.whenReady().then(async () => {
		const code = await executerTravailleur(travailleur.tube, travailleur.charge);
		app.exit(code);
	});
} else {
	const verrou = app.requestSingleInstanceLock();
	if (!verrou) {
		app.quit();
	} else {
		app.on("second-instance", () => {
			if (!fenetre) return;
			if (fenetre.isMinimized()) fenetre.restore();
			fenetre.show();
			fenetre.focus();
		});
		void app.whenReady().then(() => {
			detecterLangue();
			setLanguage(langue);
			installerCanaux();
			creerFenetre();
		});
		app.on("window-all-closed", () => {
			if (!installationActive) app.quit();
		});
	}
}
