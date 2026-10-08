/* ══════════════════════════════════════════════════════════
   LA FENÊTRE QUI SURVIT À SA PROPRE MISE À JOUR — le câblage

   Le noyau, et le RAISONNEMENT qui le justifie, vivent dans
   `fenetre-maj-liens.ts` (sans Electron, donc éprouvable :
   `npm run check:fenetre-maj`). Ici il ne reste que ce qui touche Electron :
   lancer le processus, et montrer la fenêtre.

   DEUX PIÈGES QUI RENDRAIENT TOUT MUET SANS UNE ERREUR :

   - `--user-data-dir` PROPRE. Sans lui, le verrou d'instance unique
     (`requestSingleInstanceLock`, `main.ts`) joue entre cette fenêtre et
     l'application : soit la fenêtre quitte aussitôt, soit — bien pire — elle
     garde le verrou et c'est l'application RELANCÉE par NSIS qui quitte.
   - La fenêtre se lance AVANT l'installation. `installerArmee` ne revient pas,
     et NSIS tue aussitôt le processus de l'application : du code placé après
     ne s'exécuterait jamais.
══════════════════════════════════════════════════════════ */

import { spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { LOG_PREFIX, PRODUCT_NAME } from "../../../src/branding";
import { setLanguage, t } from "../../../src/i18n";
import { suivre, suiviInitial, type BaremeInstallation } from "../installer/noyau";
import { etatFenetreMaj, formatOctets, libellesProgression } from "../installer/presentation";
import { tailleDossier, tailleTemporairesNsis } from "../installer/sondage";
import {
	cheminTemoin,
	donneesMajDepuisArguments,
	DRAPEAU_FENETRE_MAJ,
	type LangueFenetre,
	preparerReflet,
} from "./fenetre-maj-liens";

export {
	DRAPEAU_FENETRE_MAJ,
	donneesMajDepuisArguments,
	langueDepuisArguments,
	marquerDemarrage,
	nettoyerLiensMaj,
	versionDepuisArguments,
} from "./fenetre-maj-liens";

/** Prépare le reflet puis LANCE la fenêtre, détachée de l'application qui va
    mourir. Renvoie vrai si la fenêtre a bien démarré.

    Si le reflet échoue (volume différent, temporaire inaccessible), la mise à
    jour se fait comme avant, en silence : une mise à jour sans fenêtre vaut
    mieux qu'une mise à jour empêchée. */
export async function lancerFenetreMaj(
	version: string,
	langue: LangueFenetre,
	tailles: { paquet: number; installe: number | null } = { paquet: 0, installe: null },
): Promise<boolean> {
	if (process.platform !== "win32") return false;
	const executable = app.getPath("exe");
	const exeLie = await preparerReflet(dirname(executable), basename(executable));
	if (!exeLie) return false;
	try {
		const enfant = spawn(exeLie, [
			DRAPEAU_FENETRE_MAJ,
			version,
			langue,
			/* What the window needs to measure the installation (read-only). */
			`--neo-quiz-maj-paquet=${tailles.paquet}`,
			...(tailles.installe === null ? [] : [`--neo-quiz-maj-installe=${tailles.installe}`]),
			`--neo-quiz-maj-dossier=${dirname(executable)}`,
			`--neo-quiz-maj-pid=${process.pid}`,
			/* Le profil est à cette fenêtre SEULE — voir l'en-tête. */
			`--user-data-dir=${join(dirname(exeLie), "profil")}`,
		], { detached: true, windowsHide: false, stdio: "ignore" });
		enfant.unref();
		return true;
	} catch (erreur) {
		console.error(LOG_PREFIX, "fenêtre de mise à jour non lancée:", erreur);
		await rm(dirname(exeLie), { recursive: true, force: true }).catch(() => undefined);
		return false;
	}
}

/** Au-delà, la fenêtre s'efface quoi qu'il arrive. Une mise à jour qui échoue
    ne doit pas laisser un bandeau perpétuel sur le bureau : le pire qu'on
    risque alors est une fenêtre partie trop tôt, jamais une fenêtre coincée.
    La mise à jour mesurée dure 10,5 s sur NVMe ; trois minutes couvrent un
    disque lent avec une marge que personne n'atteindra. */
const EXPIRATION_MS = 3 * 60 * 1000;
const INTERVALLE_TEMOIN_MS = 400;
/** How long the "did not finish" message stays before the window goes by itself. */
const ECHEC_VISIBLE_MS = 60 * 1000;

/** LE PROCESSUS FENÊTRE : ouvre la fenêtre, attend le témoin de l'application
    relancée, puis rend la main. */
export async function afficherFenetreMaj(
	version: string,
	langue: LangueFenetre,
	donnees = donneesMajDepuisArguments(process.argv),
): Promise<void> {
	setLanguage(langue);
	const temoin = cheminTemoin();
	/* Le témoin d'un démarrage PASSÉ ne doit pas faire refermer la fenêtre
	   aussitôt : on efface avant d'ouvrir, et seul un témoin neuf compte. */
	await rm(temoin, { force: true }).catch(() => undefined);

	const fenetre = new BrowserWindow({
		width: 480,
		height: 300,
		resizable: false,
		minimizable: true,
		maximizable: false,
		fullscreenable: false,
		center: true,
		frame: false,
		/* Comme le bootstrapper : sans `thickFrame`, Windows 11 ne dessine ni
		   contour ni coins arrondis — c'est le CSS qui porte l'arrondi, et la
		   fenêtre doit donc être transparente. */
		thickFrame: false,
		transparent: true,
		show: false,
		title: PRODUCT_NAME,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			/* Exposes one function: minimise this window. */
			preload: join(__dirname, "maj-preload.cjs"),
		},
	});
	fenetre.setMenuBarVisibility(false);
	/* NEVER always-on-top (2026-10-08): it stayed above every other window,
	   and above the installer's own error box too, so a failed update looked
	   like a window frozen at 60 % that hid the one message explaining why.
	   An ordinary window: the installer's dialogs come up over it. */
	const reduire = (e: Electron.IpcMainEvent): void => {
		if (!fenetre.isDestroyed() && e.sender === fenetre.webContents) fenetre.minimize();
	};
	ipcMain.on("neo-maj-reduire", reduire);
	let fermer: () => void = () => undefined;
	const surFermer = (e: Electron.IpcMainEvent): void => {
		if (!fenetre.isDestroyed() && e.sender === fenetre.webContents) fermer();
	};
	ipcMain.on("neo-maj-fermer", surFermer);

	await fenetre.loadFile(join(__dirname, "maj", "index.html"));
	/* Sober on purpose: title, current step, and the version in small text. */
	const detailFixe = version ? t("installer.version", { version }) : "";
	/* Texts are SET after loading: the page has no script of its own (its
	   security policy forbids it) and only shows what the main process gives it. */
	const poser = (code: string): Promise<unknown> => fenetre.webContents.executeJavaScript(code).catch(() => undefined);
	await poser(
		`document.getElementById("titre").textContent = ${JSON.stringify(t("app.update.window.title"))};` +
		`document.getElementById("detail").textContent = ${JSON.stringify(detailFixe)};` +
		`document.getElementById("min").title = ${JSON.stringify(t("installer.minimize"))};` +
		`document.getElementById("min").setAttribute("aria-label", ${JSON.stringify(t("installer.minimize"))});` +
		`document.getElementById("min").addEventListener("click", () => window.neoMaj.reduire());` +
		`document.getElementById("fermer").title = ${JSON.stringify(t("app.update.window.close"))};` +
		`document.getElementById("fermer").setAttribute("aria-label", ${JSON.stringify(t("app.update.window.close"))});` +
		`document.getElementById("fermer").addEventListener("click", () => window.neoMaj.fermer());`,
	);
	fenetre.show();

	const debut = Date.now();
	const arreterSuivi = demarrerSuivi(fenetre, donnees, poser);
	const vuTemoin = await new Promise<boolean>(termine => {
		const minuteur = setInterval(() => {
			void (async () => {
				let vu = false;
				try {
					vu = (await stat(temoin)).mtimeMs >= debut;
				} catch { /* pas encore de témoin */ }
				if (vu || Date.now() - debut > EXPIRATION_MS) {
					clearInterval(minuteur);
					termine(vu);
				}
			})();
		}, INTERVALLE_TEMOIN_MS);
	});
	arreterSuivi();
	/* NO RESTARTED APP after the delay: the update did not finish. Say so
	   instead of vanishing (the user was left facing an empty desktop, or a
	   bar frozen mid-way), with a close button; still gone by itself after a
	   minute, so it never becomes a window stuck on the desktop. */
	if (!vuTemoin && !fenetre.isDestroyed()) {
		fenetre.setProgressBar(-1);
		await poser(
			`document.getElementById("statut").textContent = ${JSON.stringify(t("app.update.window.failed"))};` +
			`document.getElementById("barre").hidden = true;` +
			`document.getElementById("fermer").hidden = false;`,
		);
		fenetre.flashFrame(true);
		await new Promise<void>(fin => {
			const delai = setTimeout(fin, ECHEC_VISIBLE_MS);
			fermer = () => { clearTimeout(delai); fin(); };
		});
	}
	ipcMain.removeListener("neo-maj-reduire", reduire);
	ipcMain.removeListener("neo-maj-fermer", surFermer);
	if (!fenetre.isDestroyed()) {
		fenetre.setProgressBar(-1);
		fenetre.close();
	}
}

/** Probes the installation every 150 ms like the bootstrapper's worker does
    (same `suivre` core, same probes) and shows the step with the shared
    presentation: verification while the launching app is still alive, then the
    installation with its percentage and installed size. Mirrors the percentage
    on the taskbar button. Returns the function that stops it. */
function demarrerSuivi(
	fenetre: BrowserWindow,
	donnees: ReturnType<typeof donneesMajDepuisArguments>,
	poser: (code: string) => Promise<unknown>,
): () => void {
	const bareme: BaremeInstallation | null = donnees.dossier && donnees.paquet > 0
		? { paquet: donnees.paquet, installe: donnees.installe, initial: 0 }
		: null;
	const depart = Date.now();
	let suivi: ReturnType<typeof suiviInitial> | null = null;
	let baremeVivant: BaremeInstallation | null = null;
	let enCours = false;
	let dernierAffiche = "";
	const vivante = (): boolean => {
		if (donnees.pid === null) return false;
		try {
			process.kill(donnees.pid, 0);
			return true;
		} catch (e) {
			return (e as NodeJS.ErrnoException).code === "EPERM";
		}
	};
	const sonder = async (): Promise<void> => {
		if (enCours || fenetre.isDestroyed()) return;
		enCours = true;
		try {
			const appEnCours = vivante();
			let pourcent: number | null = null;
			let installe = "";
			if (!appEnCours && bareme && donnees.dossier) {
				const [courant, temporaire] = await Promise.all([tailleDossier(donnees.dossier), tailleTemporairesNsis(depart)]);
				/* `initial` is the folder weight when the app has just quit: NSIS
				   then starts by uninstalling the old version, like an update. */
				baremeVivant ??= { ...bareme, initial: courant };
				suivi ??= suiviInitial(baremeVivant);
				suivi = suivre(baremeVivant, suivi, { ecoule: Date.now() - depart, dossier: courant, temporaire });
				pourcent = suivi.dernier;
				if (pourcent !== null && bareme.installe) {
					installe = ` — ${t("installer.status.installDetail", {
						done: formatOctets(bareme.installe * pourcent / 100),
						total: formatOctets(bareme.installe),
					})}`;
				}
			}
			const { pourcent: valeur, statut } = libellesProgression(etatFenetreMaj(appEnCours, pourcent), null);
			const texte = `${statut}${installe}`;
			const cle = `${texte}|${valeur}`;
			if (cle === dernierAffiche || fenetre.isDestroyed()) return;
			dernierAffiche = cle;
			fenetre.setProgressBar(valeur === null ? 2 : valeur / 100, { mode: valeur === null ? "indeterminate" : "normal" });
			await poser(
				`document.getElementById("statut").textContent = ${JSON.stringify(texte)};` +
				`document.getElementById("barre").classList.toggle("indeterminee", ${valeur === null});` +
				`document.getElementById("rempli").style.width = ${JSON.stringify(valeur === null ? "" : `${valeur}%`)};`,
			);
		} catch {
			/* A probe must never get in the way of the installation. */
		} finally {
			enCours = false;
		}
	};
	const minuterie = setInterval(() => { void sonder(); }, 150);
	return () => clearInterval(minuterie);
}
