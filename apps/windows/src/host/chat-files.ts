import { LOG_PREFIX } from "../../../../src/branding";
import { REVIEW_DIR, isConflictCopy } from "../../../../src/review/paths";
import { CHATS_DIR, GENERATIONS_DIR, REQUESTS_DIR, chatsFromFile, chatsToFile } from "../../../../src/shared-state/chat-merge";
import { boundChats, readChats } from "../../../../src/dashboard/chat-record";
import type { ChatRecord } from "../../../../src/dashboard/chat-record";
import { readGenerations as parseGenerations } from "../../../../src/shared-state/generations";
import type { GenerationsFile } from "../../../../src/shared-state/generations";
import { DEVICES_DIR, MAX_DEVICE_CHARS, deviceOfFileName, readDevice } from "../../../../src/shared-state/devices";
import type { DeviceFile } from "../../../../src/shared-state/devices";
import { DEVICE, MAX_REQUEST_CHARS, SLUG, validateRemote } from "../../../../src/shared-state/remote-request";
import type { RemoteRequest } from "../../../../src/shared-state/remote-request";
import { validateSetting } from "../../../../src/shared-state/remote-setting";
import type { SettingRequest } from "../../../../src/shared-state/remote-setting";
import type { SharedFs } from "./shared-state";

/* ══════════════════════════════════════════════════════════
   THE CHAT FILES of the synced folder: `<root>/.neo-quiz/chats/<device>.json`.
   Same rules as the exams files of `shared-state.ts`: this device writes
   only its own file (temp file, remove, rename), reads every other, ignores
   what it cannot read, and never replaces its own file with a partial list.
══════════════════════════════════════════════════════════ */

/** A chat file past this is not read (a chat file is a few hundred KB at most). */
export const MAX_FILE_CHARS = 2_000_000;
/** A save stays under this (margin below the read cap): the oldest live chats leave until it fits, so our own file never becomes unreadable to us. */
export const MAX_WRITE_CHARS = 1_800_000;

/** A request file read from another device, not yet validated (the validator is the PC runner's). */
export interface IncomingFile { fileDevice: string; fileId: string; raw: unknown }

export interface ChatFilesDeps { fs: SharedFs & { listDir(dir: string): Promise<Array<{ name: string; isFolder: boolean }>> }; rootId: string; deviceId: string; now?: () => number }

export interface ChatFiles {
	/** This device's id. */
	device: string;
	/** Reads every file of the folder (own included). Never throws. */
	load(): Promise<void>;
	/** Reads the OTHER devices' files again (own memory is the truth for what this device wrote). */
	refresh(): Promise<void>;
	/** This device's chats, paths absolute (contract paths). */
	own(): ChatRecord[];
	/** One list per other file (conflict copies included), paths absolute. */
	others(): ChatRecord[][];
	/** Replaces this device's file (bounded to 200 live chats + tombstones). Serialised; a failure rejects its own caller only. */
	saveOwn(chats: ReadonlyArray<ChatRecord>): Promise<void>;
	/** Rewrites this device's generations file (temp file, remove, rename). */
	writeGenerations(file: GenerationsFile): Promise<void>;
	/** Every OTHER device's valid generations file, read fresh. */
	readGenerations(): Promise<Array<{ device: string; file: GenerationsFile }>>;
	/** Removes our generations file (app closing cleanly). */
	clearGenerations(): Promise<void>;
	/** Rewrites this device's `devices/<device>.json` (temp file, remove, rename). */
	writeDevice(file: DeviceFile): Promise<void>;
	/** Our own device file as a previous run left it, null when absent or unreadable. */
	readOwnDevice(): Promise<DeviceFile | null>;
	/** Every OTHER device's valid device file, read bounded and strictly; conflict copies and garbage skipped. */
	readDevices(): Promise<DeviceFile[]>;
	/** Writes `requests/<our device>/<id>.json` (temp file, remove, rename). */
	writeRequest(req: RemoteRequest | SettingRequest): Promise<void>;
	/** Our own valid requests, newest first. */
	listOwnRequests(): Promise<RemoteRequest[]>;
	/** Our own valid setting requests (provider switches), newest first; generation requests are not listed here. */
	listOwnSettings(): Promise<SettingRequest[]>;
	/** Deletes one of OUR requests (only the writer deletes). */
	deleteOwnRequest(id: string): Promise<void>;
	/** Every `*.json` under `requests/<other device>/` as parsed JSON, size-bounded; conflict copies and torn files skipped. */
	readIncoming(): Promise<IncomingFile[]>;
}

/** A scan examines at most this many sender folders and request files per sender. */
export const MAX_SENDERS = 8;
export const MAX_REQUEST_FILES = 20;

/** A generations file is a few KB; past this it is not read. */
const MAX_GENERATIONS_CHARS = 100_000;

const baseName = (full: string): string => full.slice(full.lastIndexOf("/") + 1);

export function createChatFiles(deps: ChatFilesDeps): ChatFiles {
	const { fs, rootId, deviceId } = deps;
	const clock = deps.now ?? Date.now;
	const dir = `${rootId}/${REVIEW_DIR}/${CHATS_DIR}`;
	const ownName = `${deviceId}.json`;
	const ownPath = `${dir}/${ownName}`;
	let own: ChatRecord[] = [];
	let others: ChatRecord[][] = [];
	/** Our file exists but could not be read: never replaced by a partial list. */
	let locked = false;
	let queue: Promise<unknown> = Promise.resolve();

	async function readOne(path: string): Promise<ChatRecord[] | null> {
		try {
			if (!(await smallEnough(path, MAX_FILE_CHARS))) { console.warn(`${LOG_PREFIX} chat file too large or unreadable, ignored:`, path); return null; }
			const raw = await fs.readBounded(path, 4 * MAX_FILE_CHARS);
			if (raw.length > MAX_FILE_CHARS) { console.warn(`${LOG_PREFIX} chat file too large, ignored:`, path); return null; }
			const parsed: unknown = JSON.parse(raw);
			// A valid envelope with every chat dropped is still a valid file; anything else is not one.
			if (!parsed || typeof parsed !== "object" || (parsed as { v?: unknown }).v !== 1 || !Array.isArray((parsed as { chats?: unknown }).chats)) return null;
			return chatsFromFile(readChats(parsed), rootId);
		} catch {
			console.warn(`${LOG_PREFIX} chat file unreadable, ignored:`, path);
			return null;
		}
	}

	/** Names to read: every `.json` (conflict copies included, read-only); a `.json.tmp` stands in for a missing `.json`. */
	async function sources(): Promise<string[] | null> {
		let names: Set<string>;
		try { names = new Set((await fs.list(dir)).map(baseName)); } catch (e) { console.warn(`${LOG_PREFIX} chats folder unreadable:`, e); return null; }
		const out = new Set<string>();
		for (const n of names) {
			if (n.endsWith(".json")) out.add(n);
			else if (n.endsWith(".json.tmp") && !names.has(n.slice(0, -4))) out.add(n.slice(0, -4));
		}
		return [...out];
	}

	async function readNamed(full: string): Promise<ChatRecord[] | null> {
		const hasMain = await fs.exists(full).catch(() => false);
		return (hasMain ? await readOne(full) : null) ?? ((await fs.exists(full + ".tmp").catch(() => false)) ? await readOne(full + ".tmp") : null);
	}

	async function readOther(names: string[]): Promise<ChatRecord[][]> {
		const lists: ChatRecord[][] = [];
		for (const n of names) {
			if (n === ownName) continue;
			const list = await readNamed(`${dir}/${n}`);
			if (list) lists.push(list);
		}
		return lists;
	}

	async function load(): Promise<void> {
		const names = await sources();
		others = await readOther(names ?? []);
		locked = false;
		own = [];
		if (names) { if (!names.includes(ownName)) return; }
		else {
			// The listing failed: our file is only known absent when both probes say so; otherwise stay locked.
			const present = await Promise.all([ownPath, `${ownPath}.tmp`].map(p => fs.exists(p).then(x => x, () => true)));
			if (!present.some(Boolean)) return;
		}
		const list = await readNamed(ownPath);
		if (list) { own = list; return; }
		locked = true;
		try {
			if (!(await smallEnough(ownPath, MAX_FILE_CHARS))) return;
			const raw = await fs.readBounded(ownPath, 4 * MAX_FILE_CHARS);
			if (raw.trim()) await fs.write(`${ownPath}.corrupt-${clock()}`, raw);
		} catch { /* kept aside is best effort */ }
	}

	const refresh = async (): Promise<void> => { others = await readOther((await sources()) ?? []); };

	const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
		const run = queue.then(job, job);
		queue = run.catch(() => {});
		return run;
	};

	function saveOwn(chats: ReadonlyArray<ChatRecord>): Promise<void> {
		return enqueue(async () => {
			if (locked) throw new Error(`own chats file unreadable: ${ownPath}`);
			let kept = boundChats(chats);
			let json = JSON.stringify({ v: 1, chats: chatsToFile(kept, rootId) });
			// Over the cap: drop the OLDEST live chat (the newest, the one on screen, stays; tombstones are never dropped).
			while (json.length > MAX_WRITE_CHARS) {
				const live = kept.filter(c => !c.deleted);
				if (live.length <= 1) break;
				const oldest = live.reduce((a, b) => (b.updatedAt < a.updatedAt ? b : a));
				kept = kept.filter(c => c !== oldest);
				json = JSON.stringify({ v: 1, chats: chatsToFile(kept, rootId) });
			}
			await fs.mkdirs(dir);
			await fs.write(`${ownPath}.tmp`, json);
			if (await fs.exists(ownPath)) await fs.remove(ownPath);
			await fs.rename(`${ownPath}.tmp`, ownPath);
			own = [...kept];
		});
	}

	const genDir = `${rootId}/${REVIEW_DIR}/${GENERATIONS_DIR}`;
	const genOwn = `${genDir}/${ownName}`;

	/** A synced file is size-checked BEFORE it is read (a UTF-8 character is at
	    most 4 bytes, so `max` characters is at most `4 * max` bytes): another
	    device controls its size, and reading it whole would crash this process.
	    An unknown size is refused. */
	async function smallEnough(path: string, maxChars: number): Promise<boolean> {
		const n = await fs.size(path);
		return n !== null && n <= 4 * maxChars;
	}

	async function readGenerations(): Promise<Array<{ device: string; file: GenerationsFile }>> {
		let names: string[];
		try { names = (await fs.list(genDir)).map(baseName); } catch { return []; }
		const out: Array<{ device: string; file: GenerationsFile }> = [];
		for (const n of names) {
			if (!n.endsWith(".json") || n === ownName) continue;
			try {
				if (!(await smallEnough(`${genDir}/${n}`, MAX_GENERATIONS_CHARS))) continue;
				const raw = await fs.readBounded(`${genDir}/${n}`, 4 * MAX_GENERATIONS_CHARS);
				if (raw.length > MAX_GENERATIONS_CHARS) continue;
				const file = parseGenerations(JSON.parse(raw));
				if (file) out.push({ device: n.slice(0, -5), file });
			} catch { console.warn(`${LOG_PREFIX} generations file unreadable, ignored:`, n); }
		}
		return out;
	}

	const writeGenerations = (file: GenerationsFile): Promise<void> => enqueue(async () => {
		await fs.mkdirs(genDir);
		await fs.write(`${genOwn}.tmp`, JSON.stringify(file));
		if (await fs.exists(genOwn)) await fs.remove(genOwn);
		await fs.rename(`${genOwn}.tmp`, genOwn);
	});

	const clearGenerations = (): Promise<void> => enqueue(async () => { if (await fs.exists(genOwn)) await fs.remove(genOwn); });

	const devDir = `${rootId}/${REVIEW_DIR}/${DEVICES_DIR}`;
	const devOwn = `${devDir}/${ownName}`;

	async function readDevices(): Promise<DeviceFile[]> {
		let names: string[];
		try { names = (await fs.list(devDir)).map(baseName); } catch { return []; }
		const out: DeviceFile[] = [];
		for (const n of names) {
			// Only `<uuid>.json`: a Syncthing conflict copy or a temp file never matches, our own file is not read back.
			const id = deviceOfFileName(n);
			if (!id || n === ownName) continue;
			try {
				if (!(await smallEnough(`${devDir}/${n}`, MAX_DEVICE_CHARS))) continue;
				const raw = await fs.readBounded(`${devDir}/${n}`, 4 * MAX_DEVICE_CHARS);
				if (raw.length > MAX_DEVICE_CHARS) continue;
				const file = readDevice(JSON.parse(raw), id);
				if (file) out.push(file);
			} catch { console.warn(`${LOG_PREFIX} device file unreadable, ignored:`, n); }
		}
		return out;
	}

	async function readOwnDevice(): Promise<DeviceFile | null> {
		try {
			if (!(await smallEnough(devOwn, MAX_DEVICE_CHARS))) return null;
			const raw = await fs.readBounded(devOwn, 4 * MAX_DEVICE_CHARS);
			return raw.length > MAX_DEVICE_CHARS ? null : readDevice(JSON.parse(raw), deviceId);
		} catch { return null; }
	}

	const writeDevice = (file: DeviceFile): Promise<void> => enqueue(async () => {
		await fs.mkdirs(devDir);
		await fs.write(`${devOwn}.tmp`, JSON.stringify(file));
		if (await fs.exists(devOwn)) await fs.remove(devOwn);
		await fs.rename(`${devOwn}.tmp`, devOwn);
	});

	const reqDir = `${rootId}/${REVIEW_DIR}/${REQUESTS_DIR}`;
	const ownReqDir = `${reqDir}/${deviceId}`;

	async function readIncoming(): Promise<IncomingFile[]> {
		let senders: Array<{ name: string; isFolder: boolean }>;
		try { senders = await fs.listDir(reqDir); } catch { return []; }
		const out: IncomingFile[] = [];
		const eligible = senders.filter(s => s.isFolder && DEVICE.test(s.name) && s.name.toLowerCase() !== deviceId.toLowerCase()).sort((a, b) => a.name < b.name ? -1 : 1);
		if (eligible.length > MAX_SENDERS) console.warn(`${LOG_PREFIX} too many request folders, only the first ${MAX_SENDERS} are examined`);
		for (const s of eligible.slice(0, MAX_SENDERS)) {
			let names: string[];
			try { names = (await fs.list(`${reqDir}/${s.name}`)).map(baseName); } catch { continue; }
			// Request ids start with a base-36 timestamp: sorted by name, the OLDEST come first.
			for (const n of names) if (n.endsWith(".json") && isConflictCopy(n)) console.warn(`${LOG_PREFIX} request file ignored (conflict copy):`, s.name, n);
			const candidates = names.filter(n => n.endsWith(".json") && !isConflictCopy(n) && SLUG.test(n.slice(0, -5))).sort();
			if (candidates.length > MAX_REQUEST_FILES) console.warn(`${LOG_PREFIX} too many request files from ${s.name}, only the first ${MAX_REQUEST_FILES} are examined`);
			for (const n of candidates.slice(0, MAX_REQUEST_FILES)) {
				try {
					if (!(await smallEnough(`${reqDir}/${s.name}/${n}`, MAX_REQUEST_CHARS))) { console.warn(`${LOG_PREFIX} request file ignored (too large):`, s.name, n); continue; }
					const raw = await fs.readBounded(`${reqDir}/${s.name}/${n}`, 4 * MAX_REQUEST_CHARS);
					if (raw.length > MAX_REQUEST_CHARS) { console.warn(`${LOG_PREFIX} request file ignored (too large):`, s.name, n); continue; }
					out.push({ fileDevice: s.name, fileId: n.slice(0, -5), raw: JSON.parse(raw) });
				} catch { console.warn(`${LOG_PREFIX} request file unreadable, ignored:`, s.name, n); }
			}
		}
		return out;
	}

	const writeRequest = (req: RemoteRequest | SettingRequest): Promise<void> => enqueue(async () => {
		if (!SLUG.test(req.id)) throw new Error("request id refused");
		if (req.from.toLowerCase() !== deviceId.toLowerCase()) throw new Error("request is not ours");
		const body = JSON.stringify(req);
		if (body.length > MAX_REQUEST_CHARS) throw new Error("request too large");
		const target = `${ownReqDir}/${req.id}.json`;
		await fs.mkdirs(ownReqDir);
		await fs.write(`${target}.tmp`, body);
		if (await fs.exists(target)) await fs.remove(target);
		await fs.rename(`${target}.tmp`, target);
	});

	const deleteOwnRequest = (id: string): Promise<void> => enqueue(async () => {
		if (!SLUG.test(id)) throw new Error("request id refused");
		await fs.remove(`${ownReqDir}/${id}.json`);
	});

	async function listOwnRequests(): Promise<RemoteRequest[]> {
		let names: string[];
		try { names = (await fs.list(ownReqDir)).map(baseName); } catch { return []; }
		const out: RemoteRequest[] = [];
		for (const n of names) {
			if (!n.endsWith(".json") || isConflictCopy(n)) continue;
			try {
				if (!(await smallEnough(`${ownReqDir}/${n}`, MAX_REQUEST_CHARS))) continue;
				const raw = await fs.readBounded(`${ownReqDir}/${n}`, 4 * MAX_REQUEST_CHARS);
				if (raw.length > MAX_REQUEST_CHARS) continue;
				const parsed: unknown = JSON.parse(raw);
				const o = (parsed && typeof parsed === "object" ? parsed : {}) as { target?: unknown; at?: unknown };
				// Only the schema is judged here: age and target are not the sender's concern.
				const v = validateRemote(parsed, { device: String(o.target), fileDevice: deviceId, fileId: n.slice(0, -5), now: Number(o.at) });
				if (v.ok) out.push(v.request);
			} catch { /* a torn own request is simply not listed */ }
		}
		return out.sort((a, b) => b.at - a.at);
	}

	async function listOwnSettings(): Promise<SettingRequest[]> {
		let names: string[];
		try { names = (await fs.list(ownReqDir)).map(baseName); } catch { return []; }
		const out: SettingRequest[] = [];
		for (const n of names) {
			if (!n.endsWith(".json") || isConflictCopy(n)) continue;
			try {
				if (!(await smallEnough(`${ownReqDir}/${n}`, MAX_REQUEST_CHARS))) continue;
				const raw = await fs.readBounded(`${ownReqDir}/${n}`, 4 * MAX_REQUEST_CHARS);
				if (raw.length > MAX_REQUEST_CHARS) continue;
				const parsed: unknown = JSON.parse(raw);
				const o = (parsed && typeof parsed === "object" ? parsed : {}) as { target?: unknown; at?: unknown };
				// Only the schema is judged here, as for generation requests: age and target are not the sender's concern.
				const v = validateSetting(parsed, { device: String(o.target), fileDevice: deviceId, fileId: n.slice(0, -5), now: Number(o.at) });
				if (v.ok) out.push(v.request);
			} catch { /* a torn own request is simply not listed */ }
		}
		return out.sort((a, b) => b.at - a.at);
	}

	return { writeRequest, listOwnRequests, listOwnSettings, deleteOwnRequest, readIncoming, device: deviceId, load, refresh, own: () => [...own], others: () => others.map(l => [...l]), saveOwn, writeGenerations, readGenerations, clearGenerations, writeDevice, readDevices, readOwnDevice };
}
