/* ══════════════════════════════════════════════════════════
   WHAT THE OTHER DEVICES ARE GENERATING, as last read (MODULE STATE)

   The generations files of the other devices (`generations/<device>.json`)
   are read from the synced folder by the host, and the list is kept here so
   the sidebar and the thread paint it without reading the disk themselves.
   Setting a list equal to the last one changes nothing and notifies no one,
   so a periodic read does not repaint the page for nothing.
══════════════════════════════════════════════════════════ */

import { LOG_PREFIX } from "../branding";
import type { GenerationsFile } from "../shared-state/generations";
import type { RemoteRequest } from "../shared-state/remote-request";

export interface RemoteGenerations { device: string; file: GenerationsFile }

let current: RemoteGenerations[] = [];
let last = "[]";
const listeners = new Set<() => void>();

/** The last list read. Empty until the first read. */
export function getRemoteGenerations(): ReadonlyArray<RemoteGenerations> {
	return current;
}

/** Keeps `list`. When it differs from the one kept before, the listeners run and true is returned. */
export function setRemoteGenerations(list: ReadonlyArray<RemoteGenerations>): boolean {
	const json = JSON.stringify(list);
	if (json === last) return false;
	last = json;
	current = [...list];
	for (const cb of [...listeners]) {
		try { cb(); } catch (e) { console.warn(LOG_PREFIX, "remote generations listener failed:", e); }
	}
	return true;
}

/** Runs `cb` each time the list changes. Returns the unsubscribe function. */
export function onRemoteGenerations(cb: () => void): () => void {
	listeners.add(cb);
	return () => { listeners.delete(cb); };
}

let ownRequests: RemoteRequest[] = [];

/** The phone's own requests still waiting on disk (not yet taken or recorded), as last read. */
export function setOwnRequests(list: RemoteRequest[]): void {
	ownRequests = [...list];
}

/** The own requests as last set. Empty until the first read. */
export function getOwnRequests(): ReadonlyArray<RemoteRequest> {
	return ownRequests;
}

let reader: (() => Promise<ReadonlyArray<RemoteGenerations>>) | null = null;

/** The host's read of the other devices' files, set once the synced folder is there. */
export function setRemoteReader(read: () => Promise<ReadonlyArray<RemoteGenerations>>): void {
	reader = read;
}

/** Reads the other devices' files now and keeps them. A failed read keeps the last list. */
export async function refreshRemoteGenerations(): Promise<boolean> {
	if (!reader) return false;
	try {
		return setRemoteGenerations(await reader());
	} catch (e) {
		console.warn(LOG_PREFIX, "remote generations not read:", e);
		return false;
	}
}
