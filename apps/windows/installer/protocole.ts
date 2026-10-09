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
	retry: "neo-installer:retry",
	copy: "neo-installer:copy",
	copyLogPath: "neo-installer:copy-log-path",
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
	| { phase: "retrying"; action: RetryAction }
	/* `diagnosis` is absent only for the UAC refusal (`elevation`), which has
	   its own blocking dialog. */
	| { phase: "erreur"; code: CodeErreurInstallateur; diagnosis?: InstallerDiagnosis };

/** The step that was running when an attempt failed. */
export type InstallerStep =
	| "init"
	| "worker"
	| "download"
	| "verify"
	| "launch"
	| "install"
	| "postcheck"
	| "open"
	| "connection";

/** What the worker (or the main process) observed when a step failed: the raw
    facts only, never a sentence. `diagnosis.ts` turns them into a cause. */
export interface InstallerErrorDetail {
	step: InstallerStep;
	/** Node errno or OpenSSL code: `ECONNRESET`, `CERT_HAS_EXPIRED`, `ENOSPC`... */
	errno?: string;
	http?: number;
	host?: string;
	/** NSIS exit code, or the worker's own exit code before it connected. */
	exitCode?: number;
	/** A short raw message, for the technical details only. */
	message?: string;
	/** Was `neo-quiz.exe` running when NSIS failed? */
	appRunning?: boolean;
	/** The package was fully downloaded AND verified before the failure. */
	downloadVerified?: boolean;
}

/** The closed list of causes the window can explain. `unknown` is the last
    resort, never a default for something a rule can name. */
export type InstallerCause =
	| "offline"
	| "blocked"
	| "tlsInspection"
	| "integrity"
	| "publishing"
	| "server"
	| "diskFull"
	| "antivirus"
	| "windowsRefused"
	| "appOpen"
	| "launch"
	| "unknown";

/** Where "Try again" resumes. */
export type RetryResume = "init" | "download" | "install" | "open";

export interface InstallerDiagnosis {
	cause: InstallerCause;
	/** Display name of an active VPN (`NordLynx`), or null. */
	vpn: string | null;
	/** NSIS exit code, shown in the `windowsRefused` explanation. */
	exitCode: number | null;
	/** The same cause as the attempt this one retried. */
	again: boolean;
	resume: RetryResume;
	/** Raw technical lines, shown under "Technical details" and copied as is. */
	details: string;
}

export type RetryAction = "connection" | "release" | "download" | "install" | "open";

export type InitResult =
	| { ok: true; infos: InfosInitialesInstallateur }
	| { ok: false; diagnosis: InstallerDiagnosis };

export interface PontInstallateur {
	initialiser(): Promise<InitResult>;
	/** Retries from the step that failed (main decides, from its last diagnosis). */
	retry(): Promise<void>;
	/** Writes a bounded text to the clipboard. */
	copy(text: string): void;
	/** Copies the log file path; the renderer never names a path. */
	copyLogPath(): void;
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
	| { type: "erreur"; code: CodeErreurInstallateur; detail?: InstallerErrorDetail };

export type CommandeTravailleur = { type: "annuler" };

declare global {
	interface Window {
		readonly neoInstaller: PontInstallateur;
	}
}
