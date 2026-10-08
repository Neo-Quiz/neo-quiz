import { LOG_PREFIX } from "../branding";
import { buildDevice, contentKey, shouldWriteDevice } from "../shared-state/devices";
import type { DeviceFile, DeviceKind } from "../shared-state/devices";

/* Publishes this PC's own device file (name, kind, Claude models) in the synced folder.
   `check()` is a local comparison and writes ONLY when the content differs from the last
   successful write (the first call writes): no timer here, an idle app writes nothing. */

export interface DevicePublisherDeps {
	device: string;
	/** Name and kind of this computer (main process); null when unavailable. */
	info(): Promise<{ name: string; kind: DeviceKind } | null>;
	/** The Claude models this PC's own CLI cache offers right now. */
	models(): Promise<ReadonlyArray<{ id: string; label: string }>> | ReadonlyArray<{ id: string; label: string }>;
	write(file: DeviceFile): Promise<void>;
	/** Our own file as left on disk by a previous run (null when none or unreadable): a restart or a page reload with the same content writes nothing. */
	readOwn?(): Promise<DeviceFile | null>;
	now?: () => number;
}

export function createDevicePublisher(deps: DevicePublisherDeps): { check(): Promise<boolean> } {
	let lastKey: string | null = null;
	let chain: Promise<unknown> = Promise.resolve();
	const run = async (): Promise<boolean> => {
		try {
			const info = await deps.info();
			if (!info) return false;
			const next = buildDevice({ device: deps.device, name: info.name, kind: info.kind, models: await deps.models() }, (deps.now ?? Date.now)());
			if (lastKey === null && deps.readOwn) {
				const onDisk = await deps.readOwn().catch(() => null);
				if (onDisk && contentKey(onDisk) === contentKey(next)) { lastKey = contentKey(next); return false; }
			}
			if (!shouldWriteDevice(lastKey, next)) return false;
			await deps.write(next);
			lastKey = contentKey(next);
			return true;
		} catch (e) {
			console.warn(LOG_PREFIX, "device file not published:", e);
			return false;
		}
	};
	return { check: () => (chain = chain.then(run, run)) as Promise<boolean> };
}
