/** What the Sync page shows, and what the bridge (`Pont.sync`) hands over.
    Types only: the page lives in the shared code and must not import from
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
	appareils: Array<{ id: string; nom: string; connecte: boolean; vuLe: number | null }>;
	/** Devices that added THIS one and are waiting to be accepted. Names are the
	    remote's, at most 64 characters: render as text only. */
	demandes: Array<{ id: string; nom: string }>;
	/** How many more requests exist than `demandes` lists (the page shows "+N"). */
	demandesPlus: number;
	dossier: { etat: "idle" | "syncing" | "error" | "absent"; pourcentage: number | null };
}
