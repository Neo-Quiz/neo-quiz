import { access, statfs } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { CANAUX_INSTALLATEUR, type InfosDisqueInstallateur } from "./protocole";
import { urlLegale } from "./noyau";

const URL_COMMENTAIRES = "https://github.com/Neo-Quiz/neo-quiz/issues/new";
const LARGEUR_FENETRE = 720;
const HAUTEUR_FENETRE = 640;

/* Le processus principal historique garde toute la logique sensible
   d'installation. Cette couche n'ajoute que les besoins de présentation du
   mockup afin de ne pas mêler l'habillage de la fenêtre à l'élévation UAC. */

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

async function infosDisque(dossier: string): Promise<InfosDisqueInstallateur> {
	const base = await ancetreExistant(dossier);
	const stats = await statfs(base);
	return {
		espaceDisponible: Math.max(0, stats.bavail * stats.bsize),
		espaceTotal: Math.max(0, stats.blocks * stats.bsize),
	};
}

ipcMain.handle(CANAUX_INSTALLATEUR.espaceDisque, async (_event, dossier: unknown) => {
	if (typeof dossier !== "string") throw new Error("dossier invalide");
	return await infosDisque(dossier);
});

ipcMain.on(CANAUX_INSTALLATEUR.reduire, event => {
	const fenetre = BrowserWindow.fromWebContents(event.sender);
	if (fenetre && !fenetre.isDestroyed()) fenetre.minimize();
});

ipcMain.on(CANAUX_INSTALLATEUR.commentaires, () => {
	void shell.openExternal(URL_COMMENTAIRES);
});

/* Les deux pages légales. La valeur vient du rendu et n'est pas crue : tout
   ce qui n'est pas l'un des deux noms est ignoré, et l'URL est composée
   par le noyau — jamais reçue telle quelle. */
ipcMain.on(CANAUX_INSTALLATEUR.ouvrirLien, (_event, page: unknown) => {
	if (page !== "terms" && page !== "privacy") return;
	void shell.openExternal(urlLegale(page));
});

void app.whenReady().then(() => {
	/* Le gabarit précédent dominait nettement la fenêtre de référence. Ce léger
	   surplus horizontal conserve l'identité Neo Quiz sans retrouver les 920 px
	   qui donnaient au bootstrapper l'allure d'une fenêtre d'application. */
	const fenetre = BrowserWindow.getAllWindows()[0];
	if (!fenetre || fenetre.isDestroyed()) return;
	fenetre.setMaximumSize(LARGEUR_FENETRE, HAUTEUR_FENETRE);
	fenetre.setMinimumSize(LARGEUR_FENETRE, HAUTEUR_FENETRE);
	fenetre.setSize(LARGEUR_FENETRE, HAUTEUR_FENETRE);
	fenetre.center();
});
