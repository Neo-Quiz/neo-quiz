import { LOG_PREFIX } from "../../../../src/branding";
import { REVIEW_DIR, isConflictCopy } from "../../../../src/review/paths";
import { currentHost } from "../../../../src/host/current";
import type { ExamenDossier } from "../../../../src/types/dashboard-ctx";
import { recalculer, tentativesDe } from "../../../../src/dashboard/stats-store";
import type { QuizStatRecord, Tentative } from "../../../../src/dashboard/stats-store";
import { MODULE_FIELDS, diffModules, foldAttemptState, mergeExams, mergeModules, winningStamps } from "../../../../src/shared-state/merge";
import type { AttemptEvent, ModuleField, ModuleValues, StoredExam, StoredModules } from "../../../../src/shared-state/merge";
import { brancherExamens, ecrireReglage, lireExamens, lireReglage } from "./folder";

/* ══════════════════════════════════════════════════════════
   EXAMS AND ATTEMPTS IN THE SYNCED FOLDER (2026-10-01)

   They used to live in this app's private `settings.json`, so a second device
   syncing the same folder never saw them (and, with no exam in sight, nothing
   was due for review there). Now each root holds, under `.neo-quiz/`:

     exams/<deviceId>.json      this device's whole exam table for the root
                                (entries carry `modifiedAt`, deletions are
                                tombstones), replaced through a temp file;
     attempts/<deviceId>.jsonl  this device's attempt events, append only;
     modules/<deviceId>.json    this device's folder settings (colour, icon,
                                name, UE, path), one stamp per field, replaced
                                through a temp file (2026-10-07).

   A device writes ONLY its own two files, so a sync tool never sees two
   writers on one file; every device reads all of them and merges
   (`src/shared-state/merge.ts`). A Syncthing conflict copy is never read.
   The root of a module key or a quiz path is its FIRST segment; an entry
   whose key does not start with the root of the file holding it is ignored
   (a copied or hand-edited file must not smuggle data into another root).

   Files are read once, at startup (`load`); another device's later changes
   show at the next start, like the review journal.
══════════════════════════════════════════════════════════ */

export const EXAMS_DIR = "exams";
export const ATTEMPTS_DIR = "attempts";
export const MODULES_DIR = "modules";

/** The part of `HostFs` this module uses. */
export interface SharedFs {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	append(path: string, data: string): Promise<void>;
	list(dir: string): Promise<string[]>;
	remove(path: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	mkdirs(path: string): Promise<void>;
}

export interface SharedStateDeps {
	fs: SharedFs;
	/** The ids of the open roots. */
	roots: () => string[];
	deviceId: string;
	now?: () => number;
}

export type ExamPair = readonly [string, string, boolean?];

export interface SharedState {
	load(): Promise<void>;
	/** Reads again the files other devices wrote since `load()`; see the
	    implementation for the `adoptStats` contract. */
	refresh(adoptStats?: () => boolean): Promise<void>;
	/** The merged exams of every loaded root. */
	exams(): Record<string, ExamenDossier[]>;
	/** The stats records folded from the merged attempts. */
	stats(): Record<string, QuizStatRecord>;
	saveExam(module: string, exam: ExamenDossier): Promise<void>;
	deleteExam(module: string, id: string): Promise<void>;
	/** Carries exams from old module keys to new ones (a folder move), as
	    THIS device's entries; the third element true COPIES (old key kept). */
	moveExams(pairs: readonly ExamPair[]): Promise<void>;
	recordAttempt(path: string, attempt: Tentative, progress?: { questionsDone: number; totalQuestions: number }): Promise<void>;
	deleteAttempt(path: string, date: number): Promise<void>;
	/** Writes the difference between the stats table the store holds and the
	    last one this call saw, as add/del events. */
	syncStats(table: Record<string, QuizStatRecord>): Promise<void>;
	/** Copies legacy settings into this device's files, skipping what is
	    already there. Returns the keys it could not place (root not open). */
	/** The merged folder settings (a fresh copy: callers may mutate it). */
	modules(): Record<string, ModuleValues>;
	/** Writes, as THIS device's stamps, the difference between the merged
	    settings and `desired`; a key goes to the file of the root of its `path`,
	    else of the first open root. Never touches another device's file. */
	syncModules(desired: Record<string, ModuleValues>): Promise<void>;
	/** Copies the legacy `quizzesModuleOverrides` as the oldest possible
	    stamps, skipping every field already stamped anywhere. */
	migrateModules(legacy: Record<string, ModuleValues>): Promise<void>;
	migrate(legacy: { exams: Record<string, ExamenDossier[]>; stats: Record<string, QuizStatRecord> }): Promise<string[]>;
}

const rootOf = (key: string): string => key.split("/")[0];
const baseName = (full: string): string => full.slice(full.lastIndexOf("/") + 1);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Valid exam entries of one file; keys outside `root` and malformed entries
    are dropped. */
export function readExamTable(raw: unknown, root: string): Record<string, StoredExam[]> {
	const out: Record<string, StoredExam[]> = {};
	if (!isRecord(raw)) return out;
	for (const [key, list] of Object.entries(raw)) {
		if (rootOf(key) !== root || !Array.isArray(list)) continue;
		const ok = list.filter((e): e is StoredExam => isRecord(e)
			&& typeof e.id === "string" && e.id !== "" && typeof e.nom === "string" && typeof e.date === "string"
			&& typeof e.modifiedAt === "number" && Number.isFinite(e.modifiedAt));
		if (ok.length) out[key] = ok;
	}
	return out;
}

/** Valid events of one JSONL file; a truncated or foreign line is skipped. */
export function readAttemptEvents(text: string, root: string): AttemptEvent[] {
	const out: AttemptEvent[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let ev: unknown;
		try { ev = JSON.parse(line); } catch { continue; }
		if (!isRecord(ev) || typeof ev.path !== "string" || rootOf(ev.path) !== root
			|| typeof ev.at !== "number" || !Number.isFinite(ev.at)) continue;
		if (ev.t === "add" && isRecord(ev.attempt) && typeof ev.attempt.date === "number" && Number.isFinite(ev.attempt.date)
			&& (ev.attempt.pct === null || typeof ev.attempt.pct === "number")) out.push(ev as unknown as AttemptEvent);
		else if (ev.t === "del" && typeof ev.date === "number" && Number.isFinite(ev.date)) out.push(ev as unknown as AttemptEvent);
	}
	return out;
}

/** Valid stamps of one modules file; unknown fields and malformed entries are dropped. */
export function readModuleTable(raw: unknown): StoredModules {
	const out = new Map<string, StoredModules[string]>();
	if (!isRecord(raw)) return {};
	for (const [key, fields] of Object.entries(raw)) {
		if (!key || !isRecord(fields)) continue;
		const clean: StoredModules[string] = {};
		for (const f of MODULE_FIELDS) {
			const s = fields[f];
			if (!isRecord(s) || typeof s.at !== "number" || !Number.isFinite(s.at)) continue;
			if (s.v === undefined) clean[f] = { at: s.at };
			else if (typeof s.v === "string" || (f === "ue" && s.v === null)) clean[f] = { v: s.v, at: s.at };
		}
		if (Object.keys(clean).length) out.set(key, clean);
	}
	return Object.fromEntries(out);
}

interface RootState {
	ownModules: StoredModules;
	otherModules: StoredModules[];
	own: Record<string, StoredExam[]>;
	others: Array<Record<string, StoredExam[]>>;
	ownEvents: AttemptEvent[];
	otherEvents: AttemptEvent[];
	/** The own attempts file ends in a torn line: the next append starts a new one. */
	needsNewline: boolean;
}

export function createSharedState(deps: SharedStateDeps): SharedState {
	const { fs, deviceId } = deps;
	const clock = deps.now ?? Date.now;
	const dir = (root: string, sub: string): string => `${root}/${REVIEW_DIR}/${sub}`;
	const examsFile = (root: string): string => `${dir(root, EXAMS_DIR)}/${deviceId}.json`;
	const attemptsFile = (root: string): string => `${dir(root, ATTEMPTS_DIR)}/${deviceId}.jsonl`;

	const roots = new Map<string, Promise<RootState>>();
	const loaded = new Map<string, RootState>();
	let queue: Promise<unknown> = Promise.resolve();
	let lastAt = 0;
	let examsCache: Record<string, ExamenDossier[]> | null = null;
	/** What the stats store is known to hold, per path and attempt date. */
	let seen = new Map<string, Map<number, Tentative>>();

	/** Serialises every write; a failure rejects its own caller only. */
	const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
		const run = queue.then(job, job);
		queue = run.catch(() => {});
		return run;
	};
	const nextAt = (): number => (lastAt = Math.max(clock(), lastAt + 1));

	async function readExamFile(path: string, root: string): Promise<Record<string, StoredExam[]> | null> {
		try { return readExamTable(JSON.parse(await fs.read(path)), root); } catch { return null; }
	}

	/** `keep`: a refresh. OUR files are not read again (memory is the truth
	    for what this device wrote, and an unreadable own file must not block
	    the refresh), only the other devices' are. */
	async function loadRoot(root: string, keep?: RootState): Promise<RootState> {
		const state: RootState = keep
			? { ownModules: keep.ownModules, otherModules: [], own: keep.own, others: [], ownEvents: keep.ownEvents, otherEvents: [], needsNewline: keep.needsNewline }
			: { ownModules: {}, otherModules: [], own: {}, others: [], ownEvents: [], otherEvents: [], needsNewline: false };
		const examDir = dir(root, EXAMS_DIR);
		const names = new Set((await fs.list(examDir)).map(baseName));
		const ownName = `${deviceId}.json`;
		/* A `.json.tmp` whose `.json` is missing is a write interrupted between
		   the removal of the old file and the rename: its content is complete
		   (it was written first), so it stands in for the missing file. */
		const sources = new Set<string>();
		for (const n of names) {
			if (isConflictCopy(n)) continue;
			if (n.endsWith(".json")) sources.add(n);
			else if (n.endsWith(".json.tmp") && !names.has(n.slice(0, -4))) sources.add(n.slice(0, -4));
		}
		for (const n of sources) {
			if (keep && n === ownName) continue;
			const main = `${examDir}/${n}`;
			let table: Record<string, StoredExam[]> | null = null;
			let raw = "";
			let readFailed = false;
			if (names.has(n)) {
				try { raw = await fs.read(main); } catch { readFailed = true; }
				if (!readFailed) { try { table = readExamTable(JSON.parse(raw), root); } catch { /* kept aside below */ } }
			}
			if (!table && names.has(n + ".tmp")) table = await readExamFile(main + ".tmp", root);
			if (!table) {
				if (n === ownName && names.has(n)) {
					/* Our own file could not be READ: the next write would replace
					   it with only the new entry and lose every exam and tombstone
					   it holds. Refuse (the root is then read-only), like attempts. */
					if (readFailed) throw new Error(`own exams file unreadable: ${main}`);
					/* Read but unparseable: keep the bytes aside before a write replaces it. */
					if (raw.trim()) await fs.write(`${main}.corrupt-${clock()}`, raw);
				}
				console.warn(`${LOG_PREFIX} exams file unreadable:`, main);
				continue;
			}
			if (n === ownName) state.own = table; else state.others.push(table);
		}
		const attDir = dir(root, ATTEMPTS_DIR);
		const ownAtt = `${deviceId}.jsonl`;
		for (const full of await fs.list(attDir)) {
			const n = baseName(full);
			if (!n.endsWith(".jsonl") || isConflictCopy(n) || (keep && n === ownAtt)) continue;
			let text: string;
			try { text = await fs.read(`${attDir}/${n}`); } catch (e) {
				if (n === ownAtt) throw e; // never append to a file we could not read
				console.warn(`${LOG_PREFIX} attempts file unreadable:`, n, e);
				continue;
			}
			const events = readAttemptEvents(text, root);
			if (n === ownAtt) { state.ownEvents = events; state.needsNewline = text.length > 0 && !text.endsWith("\n"); }
			else state.otherEvents.push(...events);
		}
		await loadModules(root, state, !!keep);
		loaded.set(root, state);
		return state;
	}

	/** The modules files of a root; same safety rules as the exams files. */
	async function loadModules(root: string, state: RootState, keep: boolean): Promise<void> {
		const modDir = dir(root, MODULES_DIR);
		const names = new Set((await fs.list(modDir)).map(baseName));
		const ownName = `${deviceId}.json`;
		for (const n of names) {
			if (!n.endsWith(".json") || isConflictCopy(n) || (keep && n === ownName)) continue;
			const full = `${modDir}/${n}`;
			let raw: string;
			try { raw = await fs.read(full); } catch (e) {
				if (n === ownName) throw new Error(`own modules file unreadable: ${full}`);
				console.warn(`${LOG_PREFIX} modules file unreadable:`, full, e);
				continue;
			}
			let table: StoredModules;
			try { table = readModuleTable(JSON.parse(raw)); } catch {
				// A corrupt file is ignored, never fatal; ours is kept aside before a write replaces it.
				if (n === ownName && raw.trim()) await fs.write(`${full}.corrupt-${clock()}`, raw);
				console.warn(`${LOG_PREFIX} modules file unreadable:`, full);
				continue;
			}
			if (n === ownName) state.ownModules = table; else state.otherModules.push(table);
		}
	}

	const known = (root: string): boolean => deps.roots().includes(root);
	function rootState(root: string): Promise<RootState> {
		if (!known(root)) return Promise.reject(new Error(`unknown root: ${root}`));
		let p = roots.get(root);
		if (!p) {
			roots.set(root, p = loadRoot(root));
			// A failed load is not cached: the next call retries.
			p.catch(() => { if (roots.get(root) === p) roots.delete(root); });
		}
		return p;
	}

	const allEvents = (): AttemptEvent[] => [...loaded.values()].flatMap(s => [...s.otherEvents, ...s.ownEvents]);
	const foldAll = () => foldAttemptState(allEvents());
	function resnapshot(): void {
		examsCache = null;
		seen = new Map();
		for (const [path, f] of Object.entries(foldAll())) seen.set(path, new Map(f.attempts.map(a => [a.date, a])));
	}

	async function load(): Promise<void> {
		const ids = deps.roots();
		const results = await Promise.allSettled(ids.map(rootState));
		results.forEach((res, i) => {
			if (res.status === "rejected") console.warn(`${LOG_PREFIX} shared state unreadable for ${ids[i]}:`, res.reason);
		});
		resnapshot();
	}

	/** Re-reads the OTHER devices' files of every loaded root (Syncthing
	    delivered something). Runs in the write queue, so it never interleaves
	    with a write. `adoptStats` is called right after, in the same queue slot:
	    the stats store reloads its table from `stats()` and answers `true`, and
	    only then does the diff base of `syncStats` move with it. Moving it
	    while the store still holds an older table would make the next save
	    DELETE the attempts of other devices the store has never seen; so a
	    store with a save pending answers `false` and keeps its base (it will
	    pick the new attempts up at the next refresh). A root that cannot be
	    read keeps what it had. */
	const refresh = (adoptStats?: () => boolean): Promise<void> => enqueue(async () => {
		for (const [root, previous] of [...loaded]) {
			if (!known(root)) continue;
			try {
				const fresh = await loadRoot(root, previous);
				roots.set(root, Promise.resolve(fresh));
			} catch (e) {
				console.warn(`${LOG_PREFIX} refresh failed for ${root}, kept as it was:`, e);
			}
		}
		examsCache = null;
		if (adoptStats?.()) resnapshot();
	});

	const moduleTables = (): StoredModules[] => [...loaded.values()].flatMap(s => [s.ownModules, ...s.otherModules]);
	const modules = (): Record<string, ModuleValues> => mergeModules(moduleTables());

	async function writeModules(root: string, s: RootState): Promise<void> {
		const target = `${dir(root, MODULES_DIR)}/${deviceId}.json`;
		await fs.mkdirs(dir(root, MODULES_DIR));
		await fs.write(`${target}.tmp`, JSON.stringify(s.ownModules));
		if (await fs.exists(target)) await fs.remove(target);
		await fs.rename(`${target}.tmp`, target);
	}

	/** Stamps `changes` into this device's files; `at` is always above the
	    stamp it replaces, whatever the clocks say (`minAt`: a fixed stamp, for
	    the migration). */
	async function stampModules(changes: Array<{ key: string; field: ModuleField; v?: string | null }>, desired: Record<string, ModuleValues>, minAt?: number): Promise<void> {
		if (!changes.length) return;
		const first = deps.roots()[0];
		const best = winningStamps(moduleTables());
		const current = modules();
		const touched = new Set<string>();
		for (const c of changes) {
			const path = desired[c.key]?.path ?? current[c.key]?.path;
			const root = path && known(rootOf(path)) ? rootOf(path) : first;
			if (!root) continue;
			const s = await rootState(root);
			const prev = best.get(c.key)?.[c.field]?.at ?? 0;
			const at = minAt ?? Math.max(nextAt(), prev + 1);
			(s.ownModules[c.key] ??= {})[c.field] = c.v === undefined ? { at } : { v: c.v, at };
			touched.add(root);
		}
		for (const root of touched) await writeModules(root, loaded.get(root)!);
	}

	const syncModules = (desired: Record<string, ModuleValues>): Promise<void> => enqueue(async () => {
		await stampModules(diffModules(modules(), desired), desired);
	});

	const migrateModules = (legacy: Record<string, ModuleValues>): Promise<void> => enqueue(async () => {
		if (!deps.roots().length) throw new Error("no open root");
		const best = winningStamps(moduleTables());
		const changes: Array<{ key: string; field: ModuleField; v?: string | null }> = [];
		for (const [key, ov] of Object.entries(legacy)) {
			if (!key) continue;
			for (const f of MODULE_FIELDS) {
				// Anything already stamped (an edit, a tombstone) is newer than the settings.
				if (ov[f] !== undefined && !best.get(key)?.[f]) changes.push({ key, field: f, v: ov[f] });
			}
		}
		await stampModules(changes, legacy, 1);
	});

	function exams(): Record<string, ExamenDossier[]> {
		return examsCache ??= mergeExams([...loaded.values()].flatMap(s => [s.own, ...s.others]));
	}
	/** The winning entry (tombstone included) of an exam id. */
	function winner(module: string, id: string): StoredExam | undefined {
		let best: StoredExam | undefined;
		for (const s of loaded.values()) {
			for (const table of [s.own, ...s.others]) {
				for (const e of table[module] ?? []) {
					if (e.id === id && (!best || e.modifiedAt > best.modifiedAt || (e.modifiedAt === best.modifiedAt && !!e.deleted))) best = e;
				}
			}
		}
		return best;
	}

	/** Writes the root's own exam table: temp file, then the swap. */
	async function writeExams(root: string, s: RootState): Promise<void> {
		const target = examsFile(root);
		await fs.mkdirs(dir(root, EXAMS_DIR));
		await fs.write(`${target}.tmp`, JSON.stringify(s.own));
		if (await fs.exists(target)) await fs.remove(target);
		await fs.rename(`${target}.tmp`, target);
	}

	function put(s: RootState, module: string, entry: StoredExam): void {
		s.own[module] = [...(s.own[module] ?? []).filter(e => e.id !== entry.id), entry];
		examsCache = null;
	}
	function stamp(module: string, exam: ExamenDossier, deleted?: true): StoredExam {
		const prev = winner(module, exam.id);
		const { modifiedAt: _m, deleted: _d, ...fields } = exam as StoredExam;
		return { ...fields, modifiedAt: Math.max(clock(), (prev?.modifiedAt ?? 0) + 1), ...(deleted ? { deleted } : {}) };
	}

	const saveExam = (module: string, exam: ExamenDossier): Promise<void> => enqueue(async () => {
		const root = rootOf(module);
		const s = await rootState(root);
		put(s, module, stamp(module, exam));
		await writeExams(root, s);
	});

	const deleteExam = (module: string, id: string): Promise<void> => enqueue(async () => {
		const root = rootOf(module);
		const s = await rootState(root);
		const prev = winner(module, id);
		if (!prev || prev.deleted) return;
		put(s, module, stamp(module, prev, true));
		await writeExams(root, s);
	});

	const moveExams = (pairs: readonly ExamPair[]): Promise<void> => enqueue(async () => {
		const touched = new Set<string>();
		for (const [from, to, copy] of pairs) {
			if (from === to) continue;
			const list = exams()[from];
			if (!list) continue;
			const target = await rootState(rootOf(to));
			const source = await rootState(rootOf(from));
			const there = new Set((exams()[to] ?? []).map(e => e.id));
			for (const e of list) {
				if (!there.has(e.id)) { put(target, to, stamp(to, e)); touched.add(rootOf(to)); }
				// A moved exam leaves a tombstone; a copied one stays.
				if (!copy) { put(source, from, stamp(from, e, true)); touched.add(rootOf(from)); }
			}
		}
		for (const root of touched) await writeExams(root, loaded.get(root)!);
	});

	async function appendEvents(root: string, s: RootState, events: AttemptEvent[]): Promise<void> {
		if (!events.length) return;
		await fs.mkdirs(dir(root, ATTEMPTS_DIR));
		const body = events.map(e => JSON.stringify(e)).join("\n") + "\n";
		await fs.append(attemptsFile(root), (s.needsNewline ? "\n" : "") + body);
		s.needsNewline = false;
		s.ownEvents.push(...events);
	}

	const recordAttempt = (path: string, attempt: Tentative, progress?: { questionsDone: number; totalQuestions: number }): Promise<void> => enqueue(async () => {
		const root = rootOf(path);
		const s = await rootState(root);
		await appendEvents(root, s, [{ t: "add", path, attempt, at: nextAt(), ...(progress ? { qd: progress.questionsDone, tq: progress.totalQuestions } : {}) }]);
	});

	const deleteAttempt = (path: string, date: number): Promise<void> => enqueue(async () => {
		const root = rootOf(path);
		const s = await rootState(root);
		await appendEvents(root, s, [{ t: "del", path, date, at: nextAt() }]);
	});

	function stats(): Record<string, QuizStatRecord> {
		const out: Record<string, QuizStatRecord> = {};
		for (const [path, f] of Object.entries(foldAll())) {
			out[path] = recalculer({ bestScore: 0, questionsDone: f.questionsDone, totalQuestions: f.totalQuestions, lastPlayed: 0, attempts: 0 }, f.attempts);
		}
		return out;
	}

	const syncStats = (table: Record<string, QuizStatRecord>): Promise<void> => enqueue(async () => {
		const batches = new Map<string, AttemptEvent[]>();
		const push = (path: string, ev: AttemptEvent): void => {
			const root = rootOf(path);
			if (!known(root)) { console.warn(`${LOG_PREFIX} attempt outside the open folders, not shared:`, path); return; }
			if (!batches.has(root)) batches.set(root, []);
			batches.get(root)!.push(ev);
		};
		const next = new Map<string, Map<number, Tentative>>();
		for (const [path, rec] of Object.entries(table)) {
			const list = tentativesDe(rec);
			if (!list.length) continue;
			const before = seen.get(path);
			next.set(path, new Map(list.map(a => [a.date, a])));
			for (const a of list) {
				if (!before?.has(a.date)) push(path, { t: "add", path, attempt: a, at: nextAt(), qd: rec.questionsDone, tq: rec.totalQuestions });
			}
		}
		for (const [path, before] of seen) {
			const now = next.get(path);
			for (const date of before.keys()) if (!now?.has(date)) push(path, { t: "del", path, date, at: nextAt() });
		}
		const failed = new Set<string>();
		for (const [root, events] of batches) {
			try { await appendEvents(root, await rootState(root), events); } catch (e) {
				failed.add(root);
				console.warn(`${LOG_PREFIX} attempts not written for ${root}:`, e);
			}
		}
		// A root that failed keeps its previous snapshot, so the next save retries.
		const kept = new Map(next);
		for (const root of failed) {
			for (const p of new Set([...seen.keys(), ...next.keys()])) {
				if (rootOf(p) !== root) continue;
				const old = seen.get(p);
				if (old) kept.set(p, old); else kept.delete(p);
			}
		}
		seen = kept;
		if (failed.size) throw new Error(`attempts not written for: ${[...failed].join(", ")}`);
	});

	const migrate = (legacy: { exams: Record<string, ExamenDossier[]>; stats: Record<string, QuizStatRecord> }): Promise<string[]> => enqueue(async () => {
		const skipped: string[] = [];
		const touched = new Set<string>();
		for (const [module, list] of Object.entries(legacy.exams)) {
			const root = rootOf(module);
			if (!known(root)) { skipped.push(module); continue; }
			const s = await rootState(root);
			for (const e of list) {
				// Anything already there (an edit, a tombstone) is newer than the settings.
				if (winner(module, e.id)) continue;
				put(s, module, { ...e, modifiedAt: nextAt() });
				touched.add(root);
			}
		}
		for (const root of touched) await writeExams(root, loaded.get(root)!);
		const batches = new Map<string, AttemptEvent[]>();
		for (const [path, rec] of Object.entries(legacy.stats)) {
			const root = rootOf(path);
			if (!known(root)) { skipped.push(path); continue; }
			const s = await rootState(root);
			// A date this device already wrote, added OR deleted, is never rewritten.
			const done = new Set(s.ownEvents.map(e => `${e.path}\n${e.t === "add" ? e.attempt.date : e.date}`));
			for (const a of tentativesDe(rec)) {
				if (done.has(`${path}\n${a.date}`)) continue;
				if (!batches.has(root)) batches.set(root, []);
				batches.get(root)!.push({ t: "add", path, attempt: a, at: nextAt(), qd: rec.questionsDone, tq: rec.totalQuestions });
			}
		}
		for (const [root, events] of batches) await appendEvents(root, await rootState(root), events);
		resnapshot();
		return skipped;
	});

	return { load, refresh, modules, syncModules, migrateModules, exams, stats, saveExam, deleteExam, moveExams, recordAttempt, deleteAttempt, syncStats, migrate };
}

/* ══════════════════════════════════════════════════════════
   THE ONE-TIME MIGRATION AND THE APP SINGLETON
══════════════════════════════════════════════════════════ */

const FLAG = "sharedStateMigrated";

export interface SettingsIo {
	lire(key: string): Promise<unknown>;
	ecrire(key: string, value: unknown): Promise<void>;
}

/** Copies the legacy `examens` (and `examDates`) and `quizStats` settings into
    the root files, once. The settings are only READ: they stay as a backup.
    The flag is set only when every entry found a root; otherwise the next
    start tries again (the copy skips what is already there, deletions
    included, so a retry never brings back what the user removed). A setting
    that cannot be read throws: no flag, nothing half-migrated. */
export async function migrateLegacy(state: SharedState, settings: SettingsIo): Promise<void> {
	if (await settings.lire(FLAG) === true) return;
	const exams = lireExamens(await settings.lire("examens"), await settings.lire("examDates"));
	const rawStats = await settings.lire("quizStats");
	const stats = isRecord(rawStats) ? rawStats as Record<string, QuizStatRecord> : {};
	const skipped = await state.migrate({ exams, stats });
	if (skipped.length) {
		console.warn(`${LOG_PREFIX} legacy entries outside the open folders, left in the settings:`, skipped);
		return;
	}
	await settings.ecrire(FLAG, true);
}

const MODULES_FLAG = "sharedModulesMigrated";

/** Copies the legacy `quizzesModuleOverrides` setting into the device files,
    once. The setting is only READ and stays as a backup; the flag is set only
    after a successful write, so a failure retries at the next start. */
export async function migrateLegacyModules(state: SharedState, settings: SettingsIo): Promise<void> {
	if (await settings.lire(MODULES_FLAG) === true) return;
	const raw = await settings.lire("quizzesModuleOverrides");
	const legacy: Record<string, ModuleValues> = {};
	if (isRecord(raw)) {
		for (const [key, ov] of Object.entries(raw)) {
			if (!isRecord(ov)) continue;
			const v: Record<string, unknown> = {};
			for (const f of MODULE_FIELDS) {
				const x = ov[f];
				if (typeof x === "string" || (f === "ue" && x === null)) v[f] = x;
			}
			if (Object.keys(v).length) legacy[key] = v as ModuleValues;
		}
	}
	await state.migrateModules(legacy);
	await settings.ecrire(MODULES_FLAG, true);
}

let courant: SharedState | null = null;
export const sharedState = (): SharedState => {
	if (!courant) throw new Error("shared state not loaded");
	return courant;
};

/** Startup: reads every root's files, migrates the settings once (BEFORE
    anything reads the state), then connects the exam and stats code to it. */
export async function loadSharedState(roots: string[], deviceId: string): Promise<SharedState> {
	const state = createSharedState({ fs: currentHost().fs, roots: () => roots, deviceId });
	await state.load();
	try {
		await migrateLegacy(state, { lire: k => lireReglage(k), ecrire: ecrireReglage });
	} catch (e) {
		// Not migrated, flag unset: the next start tries again; the settings are untouched.
		console.warn(`${LOG_PREFIX} migration to the synced folder failed:`, e);
	}
	try {
		await migrateLegacyModules(state, { lire: k => lireReglage(k), ecrire: ecrireReglage });
	} catch (e) {
		console.warn(`${LOG_PREFIX} folder settings migration failed:`, e);
	}
	installSharedState(state);
	return state;
}

/** Makes `state` the app's one; also wires the exam table of `host/folder.ts`. */
export function installSharedState(state: SharedState): void {
	courant = state;
	brancherExamens({
		exams: () => state.exams(),
		save: (m, e) => state.saveExam(m, e),
		remove: (m, id) => state.deleteExam(m, id),
		move: pairs => state.moveExams(pairs),
	});
}

export const saveExam = (m: string, e: ExamenDossier): Promise<void> => sharedState().saveExam(m, e);
export const deleteExam = (m: string, id: string): Promise<void> => sharedState().deleteExam(m, id);
export const recordAttempt = (path: string, a: Tentative): Promise<void> => sharedState().recordAttempt(path, a);
export const deleteAttempt = (path: string, date: number): Promise<void> => sharedState().deleteAttempt(path, date);
