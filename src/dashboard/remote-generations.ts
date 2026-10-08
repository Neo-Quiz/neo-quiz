/* ══════════════════════════════════════════════════════════
   WHAT THE OTHER DEVICES ARE GENERATING, as last read (MODULE STATE)

   The generations files of the other devices (`generations/<device>.json`)
   are read from the synced folder by the host, and the list is kept here so
   the sidebar and the thread paint it without reading the disk themselves.
   Setting a list equal to the last one changes nothing and notifies no one,
   so a periodic read does not repaint the page for nothing.
══════════════════════════════════════════════════════════ */

import { LOG_PREFIX } from "../branding";
import { latestDevice, staleKey } from "../shared-state/generations";
import type { GenerationsFile } from "../shared-state/generations";
import type { RemoteRequest } from "../shared-state/remote-request";

export interface RemoteGenerations { device: string; file: GenerationsFile }

/* The last PC ever seen, kept across sessions (a local view preference, never synced): a phone
   sends to it when no PC is fresh. Storage may be missing or blocked: then nothing is remembered. */
const LAST_PC_KEY = "neoquiz.lastPc";

/** The PC seen most recently, fresh or not, or null when none was ever seen. */
export function lastPcEver(): string | null {
	try { return globalThis.localStorage?.getItem(LAST_PC_KEY) || null; } catch { return null; }
}

function rememberPc(device: string): void {
	try { globalThis.localStorage?.setItem(LAST_PC_KEY, device); } catch { /* not remembered: the next read tries again */ }
}

let current: RemoteGenerations[] = [];
let last = "[]";
let lastStale = "";
const listeners = new Set<() => void>();

/** The last list read. Empty until the first read. */
export function getRemoteGenerations(): ReadonlyArray<RemoteGenerations> {
	return current;
}

/** Keeps `list`. When it differs from the one kept before, the listeners run and true is returned. */
export function setRemoteGenerations(list: ReadonlyArray<RemoteGenerations>, now: number = Date.now()): boolean {
	const latest = latestDevice(list);
	if (latest) rememberPc(latest);
	const json = JSON.stringify(list);
	// A file that stops changing (its PC was killed) goes stale with the clock alone: that is a change too.
	const stale = staleKey(list, now);
	if (json === last && stale === lastStale) return false;
	last = json;
	lastStale = stale;
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

let peerConnected = false;

/** Whether the embedded Syncthing is connected to at least one paired device, as last reported by the Sync state. */
export function getPeerConnected(): boolean {
	return peerConnected;
}

/** Keeps the connection state; listeners run only when it changed (a PC going on or off repaints the "away" notes). */
export function setPeerConnected(connected: boolean): void {
	if (connected === peerConnected) return;
	peerConnected = connected;
	for (const cb of [...listeners]) {
		try { cb(); } catch (e) { console.warn(LOG_PREFIX, "remote generations listener failed:", e); }
	}
}

/** A device paired through Sync, as the Sync page reports it (names are the remote's own: text only). */
export interface PairedPeer { id: string; name: string; connected: boolean; paused: boolean; seenAt: number | null }

let peers: PairedPeer[] = [];

/** The paired devices as last reported by the Sync state. */
export function getPairedPeers(): ReadonlyArray<PairedPeer> {
	return peers;
}

/** Keeps the paired devices; listeners run only when the list changed. */
export function setPairedPeers(list: ReadonlyArray<PairedPeer>): void {
	const next = list.map(p => ({ ...p, name: p.name.slice(0, 64) }));
	if (JSON.stringify(next) === JSON.stringify(peers)) return;
	peers = next;
	for (const cb of [...listeners]) {
		try { cb(); } catch (e) { console.warn(LOG_PREFIX, "remote generations listener failed:", e); }
	}
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
