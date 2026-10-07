/* ══════════════════════════════════════════════════════════
   THE REST CLIENT OF THE EMBEDDED SYNCTHING

   Task 6 of the Android v1 plan. Only the calls the three bridge verbs and
   the sync loop NEED exist here — a REST call nobody needs is a call a
   compromised main process could not be stopped from adding anywhere else.
   Every call sends `X-API-Key` (the key lives in the main process's memory,
   never in a file and never in the window), and every non-2xx status throws.

   Every id that becomes a path segment (`/rest/config/devices/<id>`) is
   checked first: a device id or folder id is never allowed to carry a `/`, a
   `..` or a query string into the URL.

   No Node import: the transport is injected (`fetch` of Node 18+ by default),
   so `scripts/check-electron-syncthing.mjs` can point it at a fake server.
   Paths checked against Syncthing 2.x's REST documentation and the real
   v2.1.5 binary.
══════════════════════════════════════════════════════════ */

import type { EvenementSync } from "./syncthing-regles";

export type FetchLike = (url: string, init?: {
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface DeviceConfig {
	deviceID: string;
	name: string;
	addresses: string[];
	[cle: string]: unknown;
}

export interface FolderStatus {
	state?: string;
	globalBytes?: number;
	inSyncBytes?: number;
}

export interface PendingFolders {
	[folderId: string]: { offeredBy?: { [deviceId: string]: { label?: string; time?: string } } };
}

export interface PendingDevices {
	[deviceId: string]: { name?: string; address?: string; time?: string };
}

export interface DeviceStats {
	[deviceId: string]: { lastSeen?: string };
}

export interface Connections {
	connections: { [deviceId: string]: { connected?: boolean; inBytesTotal?: number; outBytesTotal?: number; type?: string; isLocal?: boolean; clientVersion?: string } };
}

const TIMEOUT_MS = 15_000;
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function segment(s: string): string {
	if (typeof s !== "string" || !SEGMENT.test(s) || s.includes("..")) throw new Error("syncthing: bad id in a path");
	return encodeURIComponent(s);
}

export function createRest(port: number, apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike) {
	const base = `http://127.0.0.1:${port}`;

	async function appeler(method: string, chemin: string, corps?: unknown): Promise<string> {
		const headers: Record<string, string> = { "X-API-Key": apiKey };
		let body: string | undefined;
		if (corps !== undefined) {
			headers["Content-Type"] = "application/json";
			body = JSON.stringify(corps);
		}
		const rep = await fetchImpl(base + chemin, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
		const texte = await rep.text();
		if (!rep.ok) throw new Error(`syncthing REST ${method} ${chemin.split("?")[0]}: HTTP ${rep.status}`);
		return texte;
	}
	const json = async <T>(method: string, chemin: string, corps?: unknown): Promise<T> => {
		const t = await appeler(method, chemin, corps);
		return (t.trim() ? JSON.parse(t) : {}) as T;
	};

	return {
		async ping(): Promise<void> { await appeler("GET", "/rest/system/ping"); },
		async myId(): Promise<string> {
			const s = await json<{ myID?: string }>("GET", "/rest/system/status");
			if (typeof s.myID !== "string") throw new Error("syncthing: no device id in the status");
			return s.myID;
		},
		devices: () => json<DeviceConfig[]>("GET", "/rest/config/devices"),
		/* The whole config: `remoteIgnoredDevices` has no endpoint of its own. */
		config: () => json<Record<string, unknown>>("GET", "/rest/config"),
		async putConfig(c: Record<string, unknown>): Promise<void> { await appeler("PUT", "/rest/config", c); },
		async putDevice(d: { deviceID: string; [cle: string]: unknown }): Promise<void> {
			await appeler("PUT", `/rest/config/devices/${segment(d.deviceID)}`, d);
		},
		async deleteDevice(id: string): Promise<void> { await appeler("DELETE", `/rest/config/devices/${segment(id)}`); },
		folders: () => json<Array<{ id: string; devices?: Array<{ deviceID: string }>; [cle: string]: unknown }>>("GET", "/rest/config/folders"),
		async putFolder(f: { id: string; [cle: string]: unknown }): Promise<void> {
			await appeler("PUT", `/rest/config/folders/${segment(f.id)}`, f);
		},
		async patchOptions(partiel: Record<string, unknown>): Promise<void> { await appeler("PATCH", "/rest/config/options", partiel); },
		async setIgnores(folderId: string, lignes: readonly string[]): Promise<void> {
			await appeler("POST", `/rest/db/ignores?folder=${segment(folderId)}`, { ignore: lignes });
		},
		pendingFolders: () => json<PendingFolders>("GET", "/rest/cluster/pending/folders"),
		pendingDevices: () => json<PendingDevices>("GET", "/rest/cluster/pending/devices"),
		/** Events after `since`, long-polling at most `attenteS` seconds (1 by
		    default; the event loop waits longer, bounded under the HTTP timeout). */
		events: (since: number, types?: readonly string[], attenteS = 1) =>
			json<EvenementSync[]>("GET", `/rest/events?since=${Math.max(0, Math.floor(since))}&timeout=${Math.min(10, Math.max(1, Math.floor(attenteS)))}${types?.length ? "&events=" + encodeURIComponent(types.join(",")) : ""}`),
		/** Scans these paths of the folder NOW (relative, `/`), instead of
		    waiting for the watcher: what makes a change of the app leave at once. */
		async scan(folderId: string, subs: readonly string[]): Promise<void> {
			const q = subs.slice(0, 50).map(s => "&sub=" + encodeURIComponent(s)).join("");
			await appeler("POST", `/rest/db/scan?folder=${segment(folderId)}${q}`);
		},
		folderStatus: (id: string) => json<FolderStatus>("GET", `/rest/db/status?folder=${segment(id)}`),
		/** Dismisses ONE pending device (the owner chose Ignore); it may come back the next time that device tries. */
		async dismissPendingDevice(id: string): Promise<void> { await appeler("DELETE", `/rest/cluster/pending/devices?device=${segment(id)}`); },
		deviceStats: () => json<DeviceStats>("GET", "/rest/stats/device"),
		/* `remoteState`: "valid" (it shares the folder with us), "notSharing", "paused", "unknown". */
		completion: (folder: string, device: string) =>
			json<{ remoteState?: unknown; completion?: unknown }>("GET", `/rest/db/completion?folder=${segment(folder)}&device=${segment(device)}`),
		/** The engine's log: `{messages:[{when,message,level}]}`, `when` an RFC 3339 string. */
		log: () => json<{ messages?: Array<{ when?: unknown; message?: unknown; level?: unknown }> }>("GET", "/rest/system/log"),
		connections: () => json<Connections>("GET", "/rest/system/connections"),
		async shutdown(): Promise<void> { await appeler("POST", "/rest/system/shutdown"); },
	};
}

export type Rest = ReturnType<typeof createRest>;
