import type { PageLegale, PaquetInstallable } from "./noyau";

/* ══════════════════════════════════════════════════════════
   CONTRAT DU BOOTSTRAPPER

   Même raison que `electron/pont.ts` : la fenêtre ne reçoit jamais
   `ipcRenderer` brut. Elle ne connaît que ces opérations, et le travailleur
   (élevé ou non) n'échange que ces messages JSON sérialisables. Aucun type ici ne
   dépend de Node ni d'Electron pour que le rendu puisse l'importer sans ouvrir
   une porte vers le système.
══════════════════════════════════════════════════════════ */

export const CANAUX_INSTALLATEUR = {
	initialiser: "neo-installer:initialiser",
	choisirDossier: "neo-installer:choisir-dossier",
	espaceDisque: "neo-installer:espace-disque",
	installer: "neo-installer:installer",
	annuler: "neo-installer:annuler",
	reduire: "neo-installer:reduire",
	commentaires: "neo-installer:commentaires",
	ouvrirLien: "neo-installer:ouvrir-lien",
	ouvrirApplication: "neo-installer:ouvrir-application",
	fermer: "neo-installer:fermer",
	etat: "neo-installer:etat",
} as const;

export type CodeErreurInstallateur =
	| "release"
	| "network"
	| "elevation"
	| "integrity"
	| "installation"
	| "launch"
	| "generic";

export interface InfosInitialesInstallateur {
	version: string;
	tailleTelechargement: number;
	dossier: string;
	espaceDisponible: number;
	/** Neo Quiz est-il DÉJÀ installé dans ce dossier ? Le bootstrapper ne sert
	    qu'à la PREMIÈRE installation : les mises à jour arrivent par
	    electron-updater, depuis l'application elle-même. */
	dejaInstalle: boolean;
	/** L'utilisateur ne peut-il PAS écrire dans ce dossier ? Seul ce cas passe
	    par l'UAC (bouclier sur le bouton) ; le dossier par défaut, dans
	    `%LOCALAPPDATA%`, s'installe sans elle. */
	elevationRequise: boolean;
}

export interface ChoixDossierInstallateur {
	dossier: string;
	espaceDisponible: number;
	elevationRequise: boolean;
}

export interface InfosDisqueInstallateur {
	espaceDisponible: number;
	espaceTotal: number;
}

export type EtatInstallateur =
	| { phase: "pret" }
	| { phase: "elevation" }
	| { phase: "telechargement"; recus: number; total: number }
	| { phase: "verification" }
	| { phase: "installation"; pourcent: number | null }
	| { phase: "demarrage" }
	| { phase: "annule" }
	| { phase: "erreur"; code: CodeErreurInstallateur };

export interface PontInstallateur {
	initialiser(): Promise<InfosInitialesInstallateur>;
	choisirDossier(courant: string): Promise<ChoixDossierInstallateur | null>;
	espaceDisque(dossier: string): Promise<InfosDisqueInstallateur>;
	installer(dossier: string): Promise<void>;
	annuler(): Promise<void>;
	reduire(): void;
	commentaires(): void;
	/** Ouvre une des deux pages légales du site dans le navigateur. Le rendu
	    ne nomme que la PAGE : l'URL est composée par le principal
	    (`installer/noyau.ts`, `urlLegale`) —
	    un rendu compromis ne fait ouvrir que l'une de ces deux adresses. */
	ouvrirLien(page: PageLegale): void;
	/** Ouvre l'installation DÉJÀ présente. Le rendu ne nomme aucun chemin : le
	    principal lance l'exécutable du dossier qu'il connaît, et seulement s'il
	    existe — un rendu compromis ne peut pas faire lancer autre chose. */
	ouvrirApplication(): void;
	fermer(): void;
	surEtat(rappel: (etat: EtatInstallateur) => void): void;
}

export interface ChargeTravailleur {
	secret: string;
	dossier: string;
	paquet: PaquetInstallable;
}

export type MessageTravailleur =
	| { type: "auth"; secret: string }
	| { type: "telechargement"; recus: number; total: number }
	| { type: "verification" }
	| { type: "installation"; pourcent: number | null }
	| { type: "termine"; executable: string }
	| { type: "annule" }
	| { type: "erreur"; code: CodeErreurInstallateur };

export type CommandeTravailleur = { type: "annuler" };

declare global {
	interface Window {
		readonly neoInstaller: PontInstallateur;
	}
}
