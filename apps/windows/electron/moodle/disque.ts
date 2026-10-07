/* The disk side of the Moodle sync (main process). Nothing here ever deletes
   a file. Every folder and file it touches is checked against the perimeter
   (`Garde`), and a name that is not ONE path segment is refused. */

import * as fs from "node:fs";
import * as path from "node:path";
import { MoodleError } from "./erreurs";
import type { Client } from "./client";
import { extensionRefusee } from "../ressources";
import { newFolderName, prettyName } from "./noms";
import { allFiles, limiter, type MoodleFile, type Scan } from "./pur";

export const MTIME_TOLERANCE = 2000;    // ms: file systems round dates
export const DOWNLOAD_CONCURRENCY = 8;
const RENAMED_MIN_SIZE = 1024;          // below, two files of the same size prove nothing
const SKIP_DIRS = new Set(["node_modules", "__pycache__"]);

/** The content of the `Zone.Identifier` stream: "downloaded from the Internet"
    (ZoneId=3), with the SITE ORIGIN only as the host, never a tokenised file URL. */
export function contenuZone(origin: string): string {
	return `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=${new URL(origin).origin}\r\n`;
}

/** Mark-of-the-Web: tags a downloaded file so Windows (SmartScreen, Office
    Protected View) treats it as coming from the Internet. Best effort: it only
    exists on NTFS/Windows, and a failure never blocks or fails the download. */
export function marquerWeb(chemin: string, origin: string, plateforme: string = process.platform): boolean {
	if (plateforme !== "win32") return false;
	try {
		fs.writeFileSync(chemin + ":Zone.Identifier", contenuZone(origin));
		return true;
	} catch {
		return false;
	}
}

/** The perimeter, as the sync needs it: `contient` of `perimetre.ts`. */
export interface Garde { contient(chemin: string): Promise<boolean> }

/** The folder directly under `root` whose name starts with the course code
    (case ignored, and not followed by another digit), else the one to create. */
export function dossierDuCours(root: string, code: string, courseName: string): { dir: string; name: string; exists: boolean } {
	const re = new RegExp("^" + code.replace(/[^A-Za-z0-9]/g, "") + "(?!\\d)", "i");
	let found: string | undefined;
	try {
		found = fs.readdirSync(root, { withFileTypes: true })
			.filter(e => e.isDirectory() && re.test(e.name))
			.map(e => e.name)
			.sort((a, b) => a.localeCompare(b))[0];
	} catch {
		// the root does not exist yet: the folder will be created
	}
	const name = found ?? newFolderName(code, courseName);
	return { dir: path.join(root, name), name, exists: found !== undefined };
}

export function localStatus(file: { name: string; timemodified: number }, dir: string | null): "missing" | "present" | "outdated" {
	if (!dir) return "missing";
	let st: fs.Stats;
	try {
		st = fs.statSync(path.join(dir, file.name));
	} catch {
		return "missing";
	}
	// Newer on Moodle: the teacher replaced the file. A newer local copy
	// (an annotated PDF) stays "present": it is never overwritten.
	return file.timemodified * 1000 > st.mtimeMs + MTIME_TOLERANCE ? "outdated" : "present";
}

/** Size -> relative paths of the files of the module folder (sub-folders to
    depth 3, hidden folders and environments excluded): recognises a
    material renamed or filed elsewhere in the module. */
export function sizeIndex(dir: string | null): Map<number, string[]> {
	const index = new Map<number, string[]>();
	const walk = (rel: string, depth: number): void => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(path.join(dir as string, rel), { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
			const r = rel ? path.join(rel, e.name) : e.name;
			if (e.isDirectory()) {
				if (depth < 3) walk(r, depth + 1);
			} else if (e.isFile()) {
				let size: number;
				try { size = fs.statSync(path.join(dir as string, r)).size; } catch { continue; }
				if (size < RENAMED_MIN_SIZE) continue;
				const list = index.get(size);
				if (list) list.push(r); else index.set(size, [r]);
			}
		}
	};
	if (dir) walk("", 0);
	return index;
}

export function findRenamed(file: { name: string; size: number | null }, index: Map<number, string[]>): string | null {
	if (!file.size || file.size < RENAMED_MIN_SIZE) return null;
	const ext = path.extname(file.name).toLowerCase();
	return (index.get(file.size) || []).find(r => path.extname(r).toLowerCase() === ext) || null;
}

/** Recomputes the statuses from the disk, without touching running or failed files. */
export function applyStatus<T extends { sections: Scan["sections"] }>(scan: T, dir: string | null): T {
	let index: Map<number, string[]> | null = null;
	for (const f of allFiles(scan)) {
		if (f.status === "busy" || f.status === "failed") continue;
		f.status = localStatus(f, dir);
		delete f.localName;
		if (f.status !== "missing" || !dir) continue;
		index = index || sizeIndex(dir);
		const renamed = findRenamed(f, index);
		if (renamed) {
			f.status = "present";
			f.localName = renamed;
		}
	}
	return scan;
}

export function friendly(e: unknown): MoodleError {
	if (e instanceof MoodleError) return e;
	const err = e as NodeJS.ErrnoException;
	if (["EBUSY", "EPERM", "EACCES"].includes(err.code ?? "")) {
		return new MoodleError("locked", "File open in another application: close it and retry.");
	}
	return new MoodleError(err.code || "download", err.message);
}

export interface Job { file: MoodleFile; dir: string; /** Final name; defaults to the file's name. */ target?: string }
export type Outcome<J extends Job = Job> = J & { ok: boolean; error?: string; skipped?: boolean };

/* One download: a hidden temporary file first, then a rename, so a failure
   never touches the existing file. */
async function downloadOne(client: Client, job: Job, garde: Garde): Promise<void> {
	const { file, dir } = job;
	const name = job.target ?? file.name;
	const resolvedDir = path.resolve(dir);
	const target = path.resolve(dir, name);
	// ONE path segment, directly inside the folder: never `..`, never a separator.
	if (path.dirname(target) !== resolvedDir || name !== path.basename(name) || name === "." || name === "..") {
		throw new MoodleError("escape", "Refused: the file name leaves its folder.");
	}
	if (extensionRefusee(name)) throw new MoodleError("executable", "Refused: an executable file type.");
	const tmp = path.join(resolvedDir, `.${name}.moodle.tmp`);
	if (!(await garde.contient(resolvedDir)) || !(await garde.contient(target)) || !(await garde.contient(tmp))) {
		throw new MoodleError("perimeter", "Refused: outside the folders the app may write to.");
	}
	fs.mkdirSync(resolvedDir, { recursive: true });
	// Only a stale temp of OUR OWN making (a regular file, never a link) is removed;
	// the stream then creates it exclusively and fails if anything is there.
	try {
		const st = fs.lstatSync(tmp);
		if (!st.isFile()) throw new MoodleError("tmpexists", "Refused: the temporary name is taken.");
		fs.rmSync(tmp, { force: true });
	} catch (e) {
		if (e instanceof MoodleError) throw e;
	}
	try {
		await client.fetchToFile(file.url, tmp, file.size);
		const size = fs.statSync(tmp).size;
		if (file.size != null && size !== file.size) {
			throw new MoodleError("incomplete", `Incomplete file (${size} bytes of ${file.size}).`);
		}
		// Written on the temporary file BEFORE the date is set and the rename: the stream follows the rename.
		marquerWeb(tmp, client.origin);
		// Moodle's date becomes the file's: it is what `localStatus` compares.
		if (file.timemodified) fs.utimesSync(tmp, file.timemodified, file.timemodified);
		fs.renameSync(tmp, target);
	} catch (e) {
		fs.rmSync(tmp, { force: true });
		throw friendly(e);
	}
}

/** 8 downloads at once in total, whatever the number of modules; `onDone`
    after each. A file whose address is not on the site is skipped. */
export async function downloadFiles<J extends Job>(
	client: Client,
	jobs: J[],
	garde: Garde,
	onDone: (job: J, error: MoodleError | null) => void = () => {},
): Promise<Outcome<J>[]> {
	const limit = limiter(DOWNLOAD_CONCURRENCY);
	return Promise.all(jobs.map(job => limit(async (): Promise<Outcome<J>> => {
		try {
			if (!client.memeSite(job.file.url)) {
				onDone(job, null);
				return { ...job, ok: false, skipped: true };
			}
			await downloadOne(client, job, garde);
			onDone(job, null);
			return { ...job, ok: true };
		} catch (e) {
			const err = friendly(e);
			onDone(job, err);
			return { ...job, ok: false, error: err.message };
		}
	})));
}

/** The name a NEW file gets (`prettyName`); a replaced file keeps its name. */
export function targetName(file: MoodleFile): string {
	return file.status === "outdated" ? file.name : prettyName(file.name);
}

/** A local copy at the final name that is not older than Moodle's (an
    annotated PDF, a file already fetched under its pretty name) is never
    overwritten: the job is dropped before it starts. */
export function dejaPresent(job: Job): boolean {
	// A NEW file never replaces anything already at its final name.
	if (job.file.status === "missing" && fs.existsSync(path.join(job.dir, job.target ?? job.file.name))) return true;
	return localStatus({ name: job.target ?? job.file.name, timemodified: job.file.timemodified }, job.dir) === "present";
}
