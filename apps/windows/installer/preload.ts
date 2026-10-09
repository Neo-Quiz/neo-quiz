/* Le préchargement n'expose que le contrat nommé du bootstrapper. Le rendu ne
   reçoit ni `ipcRenderer`, ni Electron, ni Node : une future injection HTML
   dans la fenêtre d'installation ne devient donc pas une primitive système. */
import { contextBridge, ipcRenderer } from "electron";
import type { PageLegale } from "./noyau";
import {
	CANAUX_INSTALLATEUR,
	type ChoixDossierInstallateur,
	type EtatInstallateur,
	type InfosDisqueInstallateur,
	type InitResult,
	type PontInstallateur,
} from "./protocole";

const pont: PontInstallateur = {
	initialiser: () => ipcRenderer.invoke(CANAUX_INSTALLATEUR.initialiser) as Promise<InitResult>,
	retry: () => ipcRenderer.invoke(CANAUX_INSTALLATEUR.retry) as Promise<void>,
	copy: (text: string) => ipcRenderer.send(CANAUX_INSTALLATEUR.copy, text),
	copyLogPath: () => ipcRenderer.send(CANAUX_INSTALLATEUR.copyLogPath),
	choisirDossier: (courant: string) =>
		ipcRenderer.invoke(CANAUX_INSTALLATEUR.choisirDossier, courant) as Promise<ChoixDossierInstallateur | null>,
	espaceDisque: (dossier: string) =>
		ipcRenderer.invoke(CANAUX_INSTALLATEUR.espaceDisque, dossier) as Promise<InfosDisqueInstallateur>,
	installer: (dossier: string) => ipcRenderer.invoke(CANAUX_INSTALLATEUR.installer, dossier) as Promise<void>,
	annuler: () => ipcRenderer.invoke(CANAUX_INSTALLATEUR.annuler) as Promise<void>,
	reduire: () => ipcRenderer.send(CANAUX_INSTALLATEUR.reduire),
	commentaires: () => ipcRenderer.send(CANAUX_INSTALLATEUR.commentaires),
	ouvrirLien: (page: PageLegale) => ipcRenderer.send(CANAUX_INSTALLATEUR.ouvrirLien, page),
	ouvrirApplication: () => ipcRenderer.send(CANAUX_INSTALLATEUR.ouvrirApplication),
	fermer: () => ipcRenderer.send(CANAUX_INSTALLATEUR.fermer),
	surEtat(rappel: (etat: EtatInstallateur) => void) {
		ipcRenderer.on(CANAUX_INSTALLATEUR.etat, (_event, etat: EtatInstallateur) => rappel(etat));
	},
};

contextBridge.exposeInMainWorld("neoInstaller", pont);
