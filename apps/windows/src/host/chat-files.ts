import { LOG_PREFIX } from "../../../../src/branding";
import { REVIEW_DIR } from "../../../../src/review/paths";
import { CHATS_DIR, GENERATIONS_DIR, chatsFromFile, chatsToFile } from "../../../../src/shared-state/chat-merge";
import { boundChats, readChats } from "../../../../src/dashboard/chat-record";
import type { ChatRecord } from "../../../../src/dashboard/chat-record";
import { readGenerations as parseGenerations } from "../../../../src/shared-state/generations";
import type { GenerationsFile } from "../../../../src/shared-state/generations";
import type { SharedFs } from "./shared-state";

/* ══════════════════════════════════════════════════════════
   THE CHAT FILES of the synced folder: `<root>/.neo-quiz/chats/<device>.json`.
   Same rules as the exams files of `shared-state.ts`: this device writes
   only its own file (temp file, remove, rename), reads every other, ignores
   what it cannot read, and never replaces its own file with a partial list.
══════════════════════════════════════════════════════════ */

/** A chat file past this is not read (a chat file is a few hundred KB at most). */
export const MAX_FILE_CHARS = 2_000_000;

export interface ChatFilesDeps { fs: SharedFs; rootId: string; deviceId: string; now?: () => number }

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
}

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
			const raw = await fs.read(path);
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
			const raw = await fs.read(ownPath);
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
			const kept = boundChats(chats);
			await fs.mkdirs(dir);
			await fs.write(`${ownPath}.tmp`, JSON.stringify({ v: 1, chats: chatsToFile(kept, rootId) }));
			if (await fs.exists(ownPath)) await fs.remove(ownPath);
			await fs.rename(`${ownPath}.tmp`, ownPath);
			own = [...kept];
		});
	}

	const genDir = `${rootId}/${REVIEW_DIR}/${GENERATIONS_DIR}`;
	const genOwn = `${genDir}/${ownName}`;

	async function readGenerations(): Promise<Array<{ device: string; file: GenerationsFile }>> {
		let names: string[];
		try { names = (await fs.list(genDir)).map(baseName); } catch { return []; }
		const out: Array<{ device: string; file: GenerationsFile }> = [];
		for (const n of names) {
			if (!n.endsWith(".json") || n === ownName) continue;
			try {
				const raw = await fs.read(`${genDir}/${n}`);
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

	return { device: deviceId, load, refresh, own: () => [...own], others: () => others.map(l => [...l]), saveOwn, writeGenerations, readGenerations, clearGenerations };
}
