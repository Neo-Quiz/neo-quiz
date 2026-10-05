/** What the Sync page shows, and what the bridge (`Pont.sync`) hands over.
    Types (and one bound) only: the page lives in the shared code and must not import from
    `apps/`, so the shape is defined here and both sides import it. */
export interface EtatSync {
	/** The embedded Syncthing is running. */
	actif: boolean;
	/** This device's id (what the other devices add), `null` when not running. */
	appareil: string | null;
	/** This device's own name (the computer name, the phone's model), shown
	    next to its code. Empty when sync is not running. */
	nom: string;
	/** The paired devices, with the name Syncthing reports for them and when
	    they were last seen (milliseconds, `null` = never). */
	/** `demande`: a request THIS device sent, still shown on the other side
	    ("envoyee") or expired ("expiree": it can be sent again). */
	/** `progression`: how much of the folder this connected device has, 0 to
	    100 (Syncthing's completion), absent when unknown. */
	appareils: Array<{ id: string; nom: string; connecte: boolean; vuLe: number | null; demande?: "envoyee" | "expiree"; progression?: number }>;
	/** Devices that added THIS one and are waiting to be accepted. Names are the
	    remote's, at most 64 characters: render as text only. */
	demandes: Array<{ id: string; nom: string }>;
	/** How many more requests exist than `demandes` lists (the page shows "+N"). */
	demandesPlus: number;
	dossier: { etat: "idle" | "syncing" | "error" | "absent"; pourcentage: number | null };
	/** The recent changes to the synced folder, newest first, at most
	    `MAX_CHANGEMENTS`. Optional: a host that does not collect them (the
	    Android app, for now) leaves it out and the page hides the section. */
	changements?: Changement[];
}

/** One change to the synced folder, by this device or another. `appareil` is
    a device NAME (the remote's own, at most 64 characters: render as text
    only), `chemin` a path relative to the folder with `/` separators, and
    `quand` milliseconds since the epoch. */
export interface Changement {
	appareil: string;
	action: "ajoute" | "modifie" | "supprime";
	dossier: boolean;
	chemin: string;
	quand: number;
}

/** One line of the embedded Syncthing's log (`/rest/system/log`), as the
    "Log" row of the Sync page shows it (2026-10-04, same rows as Neo
    Calendar's page). `quand` is milliseconds (`0` when the time could not be
    read), `niveau` and `message` are Syncthing's own strings. */
export interface LigneJournal {
	quand: number;
	niveau: string;
	message: string;
}

/** How many lines a host hands over, newest first (`/rest/system/log`, sliced client side). */
export const MAX_JOURNAL = 200;

/** How many changes a host keeps and hands over. */
export const MAX_CHANGEMENTS = 200;
