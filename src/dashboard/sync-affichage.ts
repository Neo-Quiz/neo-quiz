/** Pure display rules of the Sync page's device rows (2026-10-07): which state
    a row shows, how long a shown state is kept, and how a speed is written.
    No DOM, no host, no clock: `now` is an input. */
import type { EtatSync } from "./sync-etat";

type Appareil = EtatSync["appareils"][number];

/** What a connected device's row says. Only these three are held (`garderEtat`). */
export type CleEtat = "scanning" | "syncing" | "uptodate" | "paused" | "error" | "offline";

/** A state shown stays at least this long, so a 100 ms scan is visible. */
export const DUREE_MIN_ETAT_MS = 800;

/** The state of a device row, by priority: paused, not connected, folder
    error, local folder scanning, syncing (local, or remote completion under
    100), else up to date. A pending request is not handled here (the page
    shows it first). */
export function cleEtatAppareil(e: EtatSync, a: Appareil): CleEtat {
	if (a.enPause === true) return "paused";
	if (!a.connecte) return "offline";
	if (e.dossier.etat === "error") return "error";
	if (e.dossier.etat === "scanning") return "scanning";
	if (e.dossier.etat === "syncing" || (a.progression !== undefined && a.progression < 100)) return "syncing";
	return "uptodate";
}

export interface EtatAffiche { cle: CleEtat; depuis: number }

const TENUS: readonly CleEtat[] = ["scanning", "syncing", "uptodate"];

/** The state to show given the one shown so far. A change between two of the
    held states waits until the previous one has been shown `DUREE_MIN_ETAT_MS`;
    any other change (paused, offline, error) is immediate. `attente` is the
    time left to hold in ms (0 = nothing to wait for): the page repaints then. */
export function garderEtat(prec: EtatAffiche | undefined, nouveau: CleEtat, maintenant: number): { affiche: EtatAffiche; attente: number } {
	if (!prec || prec.cle === nouveau) return { affiche: prec ?? { cle: nouveau, depuis: maintenant }, attente: 0 };
	const ecoule = maintenant - prec.depuis;
	if (TENUS.includes(prec.cle) && TENUS.includes(nouveau) && ecoule >= 0 && ecoule < DUREE_MIN_ETAT_MS) {
		return { affiche: prec, attente: DUREE_MIN_ETAT_MS - ecoule };
	}
	return { affiche: { cle: nouveau, depuis: maintenant }, attente: 0 };
}

/** "512 B/s", "40 kB/s", "1.2 MB/s" (1024-based, like Syncthing). */
export function formaterDebit(octetsParSeconde: number, langue?: string): string {
	const v = Number.isFinite(octetsParSeconde) && octetsParSeconde > 0 ? octetsParSeconde : 0;
	const unites = ["B", "kB", "MB", "GB"];
	let x = v;
	let i = 0;
	while (x >= 1024 && i < unites.length - 1) { x /= 1024; i++; }
	const nombre = new Intl.NumberFormat(langue, { maximumFractionDigits: i === 0 ? 0 : x < 10 ? 1 : 0 }).format(x);
	return `${nombre} ${unites[i]}/s`;
}
