import type { HostFs } from "./host/types";
import type { ResultsSaveState } from "./types/quiz";

/* ══════════════════════════════════════════════════════════
   RESULTS FILES: the pure rules of the automatic save of a quiz's results
   and of their deletion (2026-10-09).

   A finished quiz writes ONE JSON file per attempt under the results folder
   the host gives for its note (`host.paths.resultsDirFor`). The attempt of the
   dashboard history (`stats-store.ts`, recorded at the same hand-in) carries
   that file's path (`Tentative.results`), so deleting the attempt later can
   move the file to the host's trash too.

   That path comes back from a synced file another device wrote: it is never
   trusted. `isDeletableResultsPath` is the ONLY gate before a `trash`: a
   `.json` directly inside the results folder, named for THIS quiz (several
   quizzes of one folder share that results folder: an attempt forged for one
   quiz must not trash another quiz's results), never the `latest.json`
   mirror, never a sub-folder, never a quiz note.
══════════════════════════════════════════════════════════ */

/** The mirror of the last save, rewritten at each save (external tooling). */
export const RESULTS_MIRROR = "latest.json";

/** The slug a quiz's results file names carry: the note's name without its
    extension, folded to `[a-z0-9-]` (the saver builds `<stamp>_<slug>_<mode>-
    <random>.json` with it). The slug never contains `_`, so `_<slug>_` cannot
    match inside another quiz's longer slug. */
export function resultsSlug(quizPath: unknown): string {
	const source = String(quizPath || "quiz");
	const fileName = source.split(/[\\/]/).pop() || source;
	const base = fileName.replace(/\.[^.]+$/, "") || "quiz";
	const slug = base
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return slug || "quiz";
}

/** Whether `path` names a results file of the quiz `quizPath` that this app
    may move to the trash. A file saved before the quiz was renamed carries
    the old slug and is left in place (refusing is the safe side). */
export function isDeletableResultsPath(path: unknown, resultsDir: string, quizPath: string): path is string {
	if (typeof path !== "string" || typeof resultsDir !== "string" || !resultsDir) return false;
	const dir = resultsDir.replace(/\/+$/, "");
	if (!dir || !path.startsWith(dir + "/")) return false;
	const name = path.slice(dir.length + 1);
	if (!name || name.length > 255 || name === RESULTS_MIRROR) return false;
	// One segment only, no stream (`x.json:evil`), no control character.
	if (/[\\/:\u0000-\u001f]/.test(name) || name.startsWith(".")) return false;
	if (typeof quizPath !== "string" || !quizPath || !name.includes(`_${resultsSlug(quizPath)}_`)) return false;
	return name.endsWith(".json");
}

/** Moves a results file (and the mirror, when it mirrors that file) to the
    host's trash. Returns whether the file itself was trashed; a path that
    fails the gate throws, an absent file returns `false`. */
export async function trashResultsFile(fs: Pick<HostFs, "exists" | "read" | "trash">, resultsDir: string, quizPath: string, path: string): Promise<boolean> {
	if (!isDeletableResultsPath(path, resultsDir, quizPath)) throw new Error(`not a results file: ${path}`);
	const dir = resultsDir.replace(/\/+$/, "");
	let trashed = false;
	if (await fs.exists(path)) {
		await fs.trash(path);
		trashed = true;
	}
	const mirror = `${dir}/${RESULTS_MIRROR}`;
	try {
		if (await fs.exists(mirror)) {
			const raw = JSON.parse(await fs.read(mirror)) as { savedResultPath?: unknown };
			if (raw && raw.savedResultPath === path) await fs.trash(mirror);
		}
	} catch (_) { /* the mirror is best-effort, like its write */ }
	return trashed;
}

/** Deleting an attempt from the folder progress: the file's BYTES are read
    first and handed to `keep`, so "Undo" can write them back (the file in the
    trash is not reachable through the contract). A failed read does not stop
    the deletion. */
export async function readThenTrashResultsFile(fs: Pick<HostFs, "exists" | "read" | "readBinary" | "trash">, resultsDir: string, quizPath: string, path: string, keep: (bytes: Uint8Array) => void): Promise<boolean> {
	if (!isDeletableResultsPath(path, resultsDir, quizPath)) throw new Error(`not a results file: ${path}`);
	try { keep(await fs.readBinary(path)); } catch (_) { /* deleted all the same, Undo drops the link */ }
	return trashResultsFile(fs, resultsDir, quizPath, path);
}

/** "Undo" of an attempt deletion: the attempt to restore, WITH its results
    link when the file is back at its path (written again from `bytes` when
    absent), without it otherwise. A path that fails the gate was never
    trashed: the attempt comes back as it was. */
export async function restoreResultsFile<T extends { results?: unknown }>(fs: Pick<HostFs, "exists" | "writeBinary">, resultsDir: string, quizPath: string, attempt: T, bytes: Uint8Array | null): Promise<T> {
	const path = attempt.results;
	if (!isDeletableResultsPath(path, resultsDir, quizPath)) return attempt;
	const { results: _gone, ...unlinked } = attempt;
	try {
		if (await fs.exists(path)) return attempt;
		if (!bytes) return unlinked as T;
		await fs.writeBinary(path, bytes);
		return attempt;
	} catch (_) {
		return unlinked as T;
	}
}

/** The state before any hand-in (or after "Start over"). `attempt` only grows:
    a save still in flight from an older attempt never touches a newer one. */
export function noResultsSave(attempt = 0): ResultsSaveState {
	return { attempt, status: "none", path: null, attemptDate: null, error: null };
}

/** A hand-in: a NEW attempt, to be saved at `path` (`null`: nothing to save,
    the quiz has no note). */
export function handedInResults(prev: ResultsSaveState | null | undefined, path: string | null, attemptDate: number | null): ResultsSaveState {
	const attempt = (prev?.attempt ?? 0) + 1;
	return path ? { attempt, status: "pending", path, attemptDate, error: null } : noResultsSave(attempt);
}

/** Starting over: the next attempt has nothing saved yet. */
export function resetResultsSave(prev: ResultsSaveState | null | undefined): ResultsSaveState {
	return noResultsSave((prev?.attempt ?? 0) + 1);
}

/** Whether a save must start now: once per attempt, again only on an explicit
    retry after a failure. Re-rendering the results never saves twice. */
export function canStartResultsSave(state: ResultsSaveState | null | undefined, retry = false): boolean {
	if (!state?.path) return false;
	return state.status === "pending" || (retry && state.status === "failed");
}

/** The date of the history attempt recorded with `path` (the store's return
    value), else its last attempt; `null` when the store gave nothing. */
export function attemptDateOf(record: unknown, path: string | null): number | null {
	if (!record || typeof record !== "object") return null;
	const r = record as { tentatives?: Array<{ date?: unknown; results?: unknown }>; lastPlayed?: unknown };
	const own = path && Array.isArray(r.tentatives) ? r.tentatives.find(x => x?.results === path) : undefined;
	const date = own ? own.date : r.lastPlayed;
	return typeof date === "number" && Number.isFinite(date) && date > 0 ? date : null;
}
