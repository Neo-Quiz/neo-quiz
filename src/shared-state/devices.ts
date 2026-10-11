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
const TEXT_UNSAFE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff0-\uffff]/;

export type DeviceKind = "laptop" | "desktop";
export interface ModelEntry { id: string; label: string }
/** `provider` is the PC's own AI provider id (`claude-code`, `ollama`...), optional: a file from an older version has none. */
export interface DeviceFile { v: 1; device: string; name: string; kind: DeviceKind; claudeModels: ModelEntry[]; provider?: string; updatedAt: number }
/** A provider id as a device file may carry it. */
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const cleanProvider = (x: unknown): string | undefined => typeof x === "string" && PROVIDER_ID.test(x) ? x : undefined;

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

const withProvider = (provider: string | undefined): { provider?: string } => provider ? { provider } : {};

/** Reads one device file. `fileDevice` is the id taken from the file name: the file must say the same. Null when unusable. */
export function readDevice(raw: unknown, fileDevice: string): DeviceFile | null {
	if (!isObj(raw) || raw.v !== 1) return null;
	if (typeof raw.device !== "string" || raw.device.toLowerCase() !== fileDevice.toLowerCase()) return null;
	if (raw.kind !== "laptop" && raw.kind !== "desktop") return null;
	if (typeof raw.updatedAt !== "number" || !Number.isFinite(raw.updatedAt)) return null;
	return { v: 1, device: fileDevice, name: cleanText(raw.name, MAX_NAME), kind: raw.kind, claudeModels: cleanModels(raw.claudeModels), ...withProvider(cleanProvider(raw.provider)), updatedAt: raw.updatedAt };
}

/** The file a PC writes for itself. Names and models are cleaned the same way a reader would. */
export function buildDevice(i: { device: string; name: string; kind: DeviceKind; models: ReadonlyArray<{ id: string; label: string }>; provider?: string }, now: number): DeviceFile {
	return { v: 1, device: i.device, name: cleanText(i.name, MAX_NAME), kind: i.kind, claudeModels: cleanModels(i.models), ...withProvider(cleanProvider(i.provider)), updatedAt: now };
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

/* ONE ENTRY PER MACHINE. A device id is per installation and per profile: an
   isolated test instance of the PC app (its own user-data folder) gets a new
   id and publishes its own file under the SAME computer name, so a phone
   listed one PC nine times (2026-10-11). Files of the same name (trimmed,
   case-folded) and kind are one machine, and the most recently updated
   device stands for it: the later of its file's `updatedAt` and its last
   sign of life in `activity` (its generations file's `at`). `updatedAt`
   alone would let a test instance started once today win over the real PC,
   whose file is only rewritten when its content changes. A tie goes to the
   smaller id (never the read order). A file without a name is never merged. */

type MachineFile = Pick<DeviceFile, "device" | "name" | "kind" | "updatedAt">;
/** A device's last sign of life outside its device file (its generations file's `at`). */
export interface DeviceActivity { device: string; at: number }

const machineKey = (f: MachineFile): string => {
	const name = f.name.trim().toLowerCase();
	return name ? `name:${f.kind}:${name}` : `id:${f.device.toLowerCase()}`;
};

/** The ranking of each file: the later of its `updatedAt` and its device's activity. */
function rankOf(activity: ReadonlyArray<DeviceActivity>): (f: MachineFile) => number {
	const last = new Map<string, number>();
	for (const a of activity) {
		if (!Number.isFinite(a.at)) continue;
		const id = a.device.toLowerCase();
		last.set(id, Math.max(last.get(id) ?? -Infinity, a.at));
	}
	return f => Math.max(f.updatedAt, last.get(f.device.toLowerCase()) ?? -Infinity);
}

const newer = (rank: (f: MachineFile) => number, a: MachineFile, b: MachineFile): boolean =>
	rank(a) !== rank(b) ? rank(a) > rank(b) : a.device.toLowerCase() < b.device.toLowerCase();

/** One file per machine (same name and kind), the most recently updated one, in the order of the input. */
export function uniqueDevices<T extends MachineFile>(files: ReadonlyArray<T>, activity: ReadonlyArray<DeviceActivity> = []): T[] {
	const rank = rankOf(activity);
	const best = new Map<string, T>();
	for (const f of files) {
		const key = machineKey(f);
		const cur = best.get(key);
		if (!cur || newer(rank, f, cur)) best.set(key, f);
	}
	const kept = new Set(best.values());
	return files.filter(f => kept.has(f));
}

/** The device id that stands for `device`'s machine (see `uniqueDevices`): itself when it is the most recent of its machine, the most recent one otherwise; null when no file names it. */
export function canonicalDevice(files: ReadonlyArray<MachineFile>, device: string | null, activity: ReadonlyArray<DeviceActivity> = []): string | null {
	const own = device ? files.find(f => f.device.toLowerCase() === device.toLowerCase()) : undefined;
	if (!own) return null;
	const rank = rankOf(activity);
	const key = machineKey(own);
	let best = own;
	for (const f of files) if (machineKey(f) === key && newer(rank, f, best)) best = f;
	return best.device;
}

/** The icon of a PC from its `kind`: a laptop when unknown. */
export function pcIcon(info: Pick<DeviceFile, "kind"> | null): "laptop" | "monitor" {
	return info?.kind === "desktop" ? "monitor" : "laptop";
}

/** The only PC online by its paired-device link, as a device id, or null. The generations file and the Syncthing link name a PC differently (journal id vs Syncthing id), so the two are matched by NAME (the computer name both publish): exactly one connected, unpaused peer and exactly one device file of that name, else null (never a guess). */
export function soleOnlinePc(peers: ReadonlyArray<{ name: string; connected: boolean; paused: boolean }>, files: ReadonlyArray<MachineFile>, activity: ReadonlyArray<DeviceActivity> = []): string | null {
	const online = peers.filter(p => p.connected && !p.paused);
	if (online.length !== 1) return null;
	const name = online[0].name.trim().toLowerCase();
	if (!name) return null;
	// Duplicate files of one machine (see `uniqueDevices`) are one PC, not an ambiguity.
	const same = uniqueDevices(files, activity).filter(f => f.name.trim().toLowerCase() === name);
	return same.length === 1 ? same[0].device : null;
}
