import type { ExamenDossier } from "../types/dashboard-ctx";
import type { Tentative } from "../dashboard/stats-store";

/* ══════════════════════════════════════════════════════════
   EXAMS AND ATTEMPTS, MERGED ACROSS DEVICES (PURE, no host)

   Each device writes ONLY its own files under `<root>/.neo-quiz/` (so a sync
   tool never sees two writers on one file) and every device reads them all.
   These two functions are the whole merge:

   - exams: a table per device; per module key and exam `id` the entry with
     the highest `modifiedAt` wins, and a winning tombstone (`deleted`) hides
     the exam. Tombstones are never dropped: an exam deleted on one device
     must not come back from another device's older copy.
   - attempts: an append-only event list per device, folded in `at` order.
     An attempt is identified by (path, date). A delete that sorts BEFORE its
     add (clock skew between devices) finds nothing to remove, so the attempt
     stays: losing an attempt to a wrong clock is worse than keeping one the
     user deleted.
══════════════════════════════════════════════════════════ */

export interface StoredExam extends ExamenDossier { modifiedAt: number; deleted?: true }

export type AttemptEvent =
	| { t: "add"; path: string; attempt: Tentative; at: number; qd?: number; tq?: number }
	| { t: "del"; path: string; date: number; at: number };

/** Whether `a` should win over `b` (both entries for the same exam id). */
function wins(a: StoredExam, b: StoredExam): boolean {
	if (a.modifiedAt !== b.modifiedAt) return a.modifiedAt > b.modifiedAt;
	if (!!a.deleted !== !!b.deleted) return !!a.deleted;
	// Same instant, same kind: any deterministic rule, identical on every device.
	return JSON.stringify(a) > JSON.stringify(b);
}

export function mergeExams(perDevice: Array<Record<string, StoredExam[]>>): Record<string, ExamenDossier[]> {
	const best = new Map<string, Map<string, StoredExam>>();
	for (const table of perDevice) {
		for (const [module, list] of Object.entries(table)) {
			let byId = best.get(module);
			if (!byId) best.set(module, byId = new Map());
			for (const e of list) {
				const cur = byId.get(e.id);
				if (!cur || wins(e, cur)) byId.set(e.id, e);
			}
		}
	}
	const out: Record<string, ExamenDossier[]> = {};
	for (const [module, byId] of best) {
		const live = [...byId.values()].filter(e => !e.deleted).map(e => {
			const { modifiedAt: _m, deleted: _d, ...exam } = e;
			return exam as ExamenDossier;
		}).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
		if (live.length) out[module] = live;
	}
	return out;
}

export interface FoldedPath {
	/** Most recent first. */
	attempts: Tentative[];
	/** Progress carried by the events (see `AttemptEvent.qd` / `tq`). */
	questionsDone: number;
	totalQuestions: number;
}

/** The full fold: attempts per path, with the progress of the remaining
    attempts (max `qd`, latest `tq`). Paths left with no attempt are dropped. */
export function foldAttemptState(events: readonly AttemptEvent[]): Record<string, FoldedPath> {
	const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map(x => x.e);
	const live = new Map<string, Map<number, Extract<AttemptEvent, { t: "add" }>>>();
	for (const ev of sorted) {
		let byDate = live.get(ev.path);
		if (ev.t === "add") {
			if (!byDate) live.set(ev.path, byDate = new Map());
			byDate.set(ev.attempt.date, ev);
		} else {
			byDate?.delete(ev.date);
		}
	}
	const out: Record<string, FoldedPath> = {};
	for (const [path, byDate] of live) {
		if (!byDate.size) continue;
		const adds = [...byDate.values()].sort((a, b) => b.attempt.date - a.attempt.date);
		const latest = [...adds].sort((a, b) => b.at - a.at)[0];
		out[path] = {
			attempts: adds.map(a => a.attempt),
			questionsDone: Math.max(0, ...adds.map(a => a.qd ?? 0)),
			totalQuestions: latest.tq ?? 0,
		};
	}
	return out;
}

export function foldAttempts(events: AttemptEvent[]): Record<string, Tentative[]> {
	return Object.fromEntries(Object.entries(foldAttemptState(events)).map(([p, f]) => [p, f.attempts]));
}

/* ══════════════════════════════════════════════════════════
   FOLDER SETTINGS (colour, icon, name, teaching unit, path), MERGED ACROSS
   DEVICES (2026-10-07)

   Each device writes `<root>/.neo-quiz/modules/<deviceId>.json`: per module key
   (the folder's segment, as in `quizzesModuleOverrides`) and per FIELD a stamp
   `{ v?, at }`. The merge is per field, the highest `at` wins: a colour changed
   on the phone and a rename made on the PC both survive. A stamp without `v`
   is a CLEARED field (a tombstone, never dropped: an older value on another
   device must not come back); `ue: null` ("no UE") is a value, distinct from
   cleared. Ties break on the serialised stamp, identical on every device.
══════════════════════════════════════════════════════════ */

export const MODULE_FIELDS = ["name", "ue", "color", "icon", "path"] as const;
export type ModuleField = (typeof MODULE_FIELDS)[number];
export interface ModuleStamp { v?: string | null; at: number }
export type StoredModules = Record<string, Partial<Record<ModuleField, ModuleStamp>>>;
export interface ModuleValues { name?: string; ue?: string | null; color?: string; icon?: string; path?: string }

function stampWins(a: ModuleStamp, b: ModuleStamp): boolean {
	if (a.at !== b.at) return a.at > b.at;
	return JSON.stringify(a) > JSON.stringify(b);
}

/** The winning stamp of every (key, field), tombstones included. */
export function winningStamps(perDevice: readonly StoredModules[]): Map<string, Partial<Record<ModuleField, ModuleStamp>>> {
	const best = new Map<string, Partial<Record<ModuleField, ModuleStamp>>>();
	for (const table of perDevice) {
		for (const [key, fields] of Object.entries(table)) {
			let cur = best.get(key);
			if (!cur) best.set(key, cur = {});
			for (const f of MODULE_FIELDS) {
				const s = fields[f];
				if (s && (!cur[f] || stampWins(s, cur[f]!))) cur[f] = s;
			}
		}
	}
	return best;
}

export function mergeModules(perDevice: readonly StoredModules[]): Record<string, ModuleValues> {
	const out: Array<[string, ModuleValues]> = [];
	for (const [key, fields] of winningStamps(perDevice)) {
		const v: Record<string, string | null> = {};
		for (const f of MODULE_FIELDS) {
			const s = fields[f];
			if (s && s.v !== undefined) v[f] = s.v;
		}
		if (Object.keys(v).length) out.push([key, v as ModuleValues]);
	}
	return Object.fromEntries(out.sort((a, b) => a[0].localeCompare(b[0])));
}

/** Re-applies `local`'s unsaved edits (its difference from `base`) on top of
    `merged`: a sync that lands while an edit is pending must not drop it. */
export function rebaseModules(base: Record<string, ModuleValues>, local: Record<string, ModuleValues>, merged: Record<string, ModuleValues>): Record<string, ModuleValues> {
	const out: Record<string, Record<string, string | null>> = {};
	for (const [k, v] of Object.entries(merged)) out[k] = { ...v };
	for (const c of diffModules(base, local)) {
		const cur = out[c.key] ?? (out[c.key] = {});
		if (c.v === undefined) delete cur[c.field]; else cur[c.field] = c.v;
		if (!Object.keys(cur).length) delete out[c.key];
	}
	return out as Record<string, ModuleValues>;
}

/** The field changes that turn `merged` into `desired` (both override tables). */
export function diffModules(merged: Record<string, ModuleValues>, desired: Record<string, ModuleValues>): Array<{ key: string; field: ModuleField; v?: string | null }> {
	const out: Array<{ key: string; field: ModuleField; v?: string | null }> = [];
	for (const key of new Set([...Object.keys(merged), ...Object.keys(desired)])) {
		for (const field of MODULE_FIELDS) {
			const was = merged[key]?.[field];
			const now = desired[key]?.[field];
			if (was === now) continue;
			out.push(now === undefined ? { key, field } : { key, field, v: now });
		}
	}
	return out;
}

/* ══════════════════════════════════════════════════════════
   A FOLDER'S EXAMS UNDER ITS OLD KEY (PURE, no host, 2026-10-07)

   An exam table is keyed `<root>/<folder>`. A folder that changes root (moved
   from the vault "Efrei" to "C:\Neo Quiz") gets a new key, and its exams stay
   under the old one: read by the new key, the folder finds nothing.

   The old key is found by the folder's NAME, the part after the root, under
   three rules: the exact key wins whenever it holds exams; an old key is
   claimed only when no other current folder carries the same name (a key owned
   by another folder carries that folder's name, so this covers it; two homonyms
   under two roots: nothing is claimed, the guess would be a coin toss); several
   unambiguous old keys are
   merged, an exam id kept once. Nothing is written here: the caller takes the
   `anciennes` over at the next write of this folder.
══════════════════════════════════════════════════════════ */

export interface ExamKeyResolution<T extends { id: string; date: string }> {
	/** The key the folder's exams are read from and written to. */
	cle: string;
	/** The exams to show for the folder, sorted by date then id. */
	examens: T[];
	/** The old keys whose exams are in `examens`, to take over at the next write. */
	anciennes: string[];
}

/** The folder name of a `<root>/<folder>` key: everything after the root. `null`
    when the key has no root part (nothing to match on). */
function nomDuDossier(cle: string): string | null {
	const i = cle.indexOf("/");
	return i < 0 ? null : cle.slice(i + 1);
}

/**
 * Resolves the exams of the folder whose current key is `cle`.
 * `dossiersCourants` is the key of EVERY current folder, `cle` included.
 */
export function resoudreCleExamens<T extends { id: string; date: string }>(
	table: Record<string, T[]>,
	cle: string,
	dossiersCourants: readonly string[],
): ExamKeyResolution<T> {
	const exacts = table[cle] ?? [];
	if (exacts.length) return { cle, examens: exacts, anciennes: [] };
	const vide: ExamKeyResolution<T> = { cle, examens: [], anciennes: [] };
	const nom = nomDuDossier(cle);
	if (!nom) return vide;
	const courants = new Set(dossiersCourants);
	courants.add(cle);
	// Two current folders with this name, under two roots: an old key cannot say which one it was.
	if ([...courants].filter(k => nomDuDossier(k) === nom).length > 1) return vide;
	const anciennes = Object.keys(table)
		.filter(k => k !== cle && nomDuDossier(k) === nom && (table[k]?.length ?? 0) > 0)
		.sort();
	if (!anciennes.length) return vide;
	const parId = new Map<string, T>();
	for (const k of anciennes) for (const e of table[k]!) if (!parId.has(e.id)) parId.set(e.id, e);
	const examens = [...parId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
	return { cle, examens, anciennes };
}
