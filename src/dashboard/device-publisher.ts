import { LOG_PREFIX } from "../branding";
import { buildDevice, contentKey, shouldWriteDevice } from "../shared-state/devices";
import type { DeviceFile, DeviceKind } from "../shared-state/devices";

/* Publishes this PC's own device file (name, kind, Claude models) in the synced folder.
   `check()` writes ONLY when the content differs from the last successful write (the first
   call writes) or, with `readOwn`, from what is on disk: no timer here, an idle app writes nothing. */

export interface DevicePublisherDeps {
	device: string;
	/** Name and kind of this computer (main process); null when unavailable. */
	info(): Promise<{ name: string; kind: DeviceKind } | null>;
	/** The Claude models this PC's own CLI cache offers right now. */
	models(): Promise<ReadonlyArray<{ id: string; label: string }>> | ReadonlyArray<{ id: string; label: string }>;
	/** The PC's own AI provider id right now (optional). */
	provider?(): string | undefined;
	write(file: DeviceFile): Promise<void>;
	/** Our own file as it is on disk right now (null when none or unreadable): read at every check, so a restart writes nothing when identical and a file overwritten by a peer is restored. */
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
			const next = buildDevice({ device: deps.device, name: info.name, kind: info.kind, models: await deps.models(), provider: deps.provider?.() }, (deps.now ?? Date.now)());
			// The file on disk is re-read at EVERY check, not only the first: a paired peer may overwrite our own file, and a fake would otherwise persist because we only rewrite when our in-memory content changes. Identical on disk: no write (an idle app writes nothing).
			if (deps.readOwn) {
				const onDisk = await deps.readOwn().catch(() => null);
				if (onDisk && contentKey(onDisk) === contentKey(next)) { lastKey = contentKey(next); return false; }
			} else if (!shouldWriteDevice(lastKey, next)) return false;
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
