/* ══════════════════════════════════════════════════════════
   WHAT A PC TELLS THE OTHER DEVICES ABOUT ITSELF (PURE)

   `<root>/.neo-quiz/devices/<device>.json` = { v: 1, device, name, kind,
   claudeModels: [{ id, label }], updatedAt }. Each PC writes ONLY its own
   file, at start and when its CONTENT changes (never on a timer, `updatedAt`
   is not content). Everything read from another device is data from a
   synced folder: size-capped by the caller BEFORE `JSON.parse`, then checked
   here field by field. An unknown version or a file that is not an object is
   ignored; a bad model entry is dropped alone. Nothing read here ever
   reaches an argument: the model list is only what the phone offers; the PC
   re-checks a requested model against its OWN current list.
   No DOM, no host, no clock: `now` is always an input.
══════════════════════════════════════════════════════════ */

export const DEVICES_DIR = "devices";
/** A device file is a few KB; the caller refuses anything longer before parsing. */
export const MAX_DEVICE_CHARS = 20_000;
const MAX_MODELS = 20;
const MAX_NAME = 64;
const MAX_LABEL = 80;
/** A model id as a request may carry it and as the CLI template accepts it: never starts with a dash (an option). */
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
/** The device id shape (a file name `<uuid>.json`); a conflict copy never matches. */
const DEVICE_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i;
const TEXT_UNSAFE = /[\u0000-\u001f\u007f-\u009f­​-‏\u2028-‮⁠-⁯﻿￰-￿]/;

export type DeviceKind = "laptop" | "desktop";
export interface ModelEntry { id: string; label: string }
export interface DeviceFile { v: 1; device: string; name: string; kind: DeviceKind; claudeModels: ModelEntry[]; updatedAt: number }

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** The device id a file name designates, or null (conflict copy, temp file, anything else). */
export function deviceOfFileName(name: string): string | null {
	return DEVICE_FILE.exec(name)?.[1] ?? null;
}

/** A clean one-line text of at most `max` characters, or "" when unusable. */
function cleanText(x: unknown, max: number): string {
	if (typeof x !== "string") return "";
	const s = x.trim();
	return s.length > max || TEXT_UNSAFE.test(s) ? "" : s;
}

/** The model entries a PC may publish: bounded, ids the request charset allows. Used on both ends (writer and reader). */
export function cleanModels(list: unknown): ModelEntry[] {
	if (!Array.isArray(list)) return [];
	const out: ModelEntry[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < Math.min(list.length, 200) && out.length < MAX_MODELS; i++) {
		const e: unknown = list[i];
		if (!isObj(e) || typeof e.id !== "string" || !MODEL_ID.test(e.id) || seen.has(e.id)) continue;
		const label = cleanText(e.label, MAX_LABEL) || e.id;
		seen.add(e.id);
		out.push({ id: e.id, label });
	}
	return out;
}

/** Reads one device file. `fileDevice` is the id taken from the file name: the file must say the same. Null when unusable. */
export function readDevice(raw: unknown, fileDevice: string): DeviceFile | null {
	if (!isObj(raw) || raw.v !== 1) return null;
	if (typeof raw.device !== "string" || raw.device.toLowerCase() !== fileDevice.toLowerCase()) return null;
	if (raw.kind !== "laptop" && raw.kind !== "desktop") return null;
	if (typeof raw.updatedAt !== "number" || !Number.isFinite(raw.updatedAt)) return null;
	return { v: 1, device: fileDevice, name: cleanText(raw.name, MAX_NAME), kind: raw.kind, claudeModels: cleanModels(raw.claudeModels), updatedAt: raw.updatedAt };
}

/** The file a PC writes for itself. Names and models are cleaned the same way a reader would. */
export function buildDevice(i: { device: string; name: string; kind: DeviceKind; models: ReadonlyArray<{ id: string; label: string }> }, now: number): DeviceFile {
	return { v: 1, device: i.device, name: cleanText(i.name, MAX_NAME), kind: i.kind, claudeModels: cleanModels(i.models), updatedAt: now };
}

/** What counts as a change: everything but `updatedAt`. */
export function contentKey(f: DeviceFile): string {
	return JSON.stringify({ ...f, updatedAt: 0 });
}

/** Whether to write: at start (nothing written yet) or when the content differs from the last write. */
export function shouldWriteDevice(lastKey: string | null, next: DeviceFile): boolean {
	return lastKey === null || lastKey !== contentKey(next);
}

/** The device file of `device`, if read. */
export function deviceInfo(files: ReadonlyArray<DeviceFile>, device: string | null): DeviceFile | null {
	if (!device) return null;
	return files.find(f => f.device.toLowerCase() === device.toLowerCase()) ?? null;
}

/** The icon of a PC from its `kind`: a laptop when unknown. */
export function pcIcon(info: Pick<DeviceFile, "kind"> | null): "laptop" | "monitor" {
	return info?.kind === "desktop" ? "monitor" : "laptop";
}

/** The only PC online by its paired-device link, as a device id, or null. The generations file and the Syncthing link name a PC differently (journal id vs Syncthing id), so the two are matched by NAME (the computer name both publish): exactly one connected, unpaused peer and exactly one device file of that name, else null (never a guess). */
export function soleOnlinePc(peers: ReadonlyArray<{ name: string; connected: boolean; paused: boolean }>, files: ReadonlyArray<Pick<DeviceFile, "device" | "name">>): string | null {
	const online = peers.filter(p => p.connected && !p.paused);
	if (online.length !== 1) return null;
	const name = online[0].name.trim().toLowerCase();
	if (!name) return null;
	const same = files.filter(f => f.name.trim().toLowerCase() === name);
	return same.length === 1 ? same[0].device : null;
}
