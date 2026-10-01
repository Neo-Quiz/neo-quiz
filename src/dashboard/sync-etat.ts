/** What the Sync page shows, and what the bridge (`Pont.sync`) hands over.
    Types only: the page lives in the shared code and must not import from
    `apps/`, so the shape is defined here and both sides import it. */
export interface EtatSync {
	/** The embedded Syncthing is running. */
	actif: boolean;
	/** This device's id (what the other devices add), `null` when not running. */
	appareil: string | null;
	/** The paired devices, with the name Syncthing reports for them. */
	appareils: Array<{ id: string; nom: string; connecte: boolean }>;
	dossier: { etat: "idle" | "syncing" | "error" | "absent"; pourcentage: number | null };
}
