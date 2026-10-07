import { currentHost } from "../host/current";
import { DIRECTORY, foldPath, importDirs, planImport } from "./share-plan";
import type { ImportPlan, PreparedFile } from "./share-plan";
import { sha256Hex } from "./share-manifest";
import { fitsPath, fitsWindowsPath } from "./share-names";
import { readZip } from "./zip";
import type { ZipSkip } from "./zip";

/* ══════════════════════════════════════════════════════════
   APPLYING AN IMPORT (2026-10-07). `share-plan.ts` decides; this module
   writes, and it never writes into the final place directly:

   1. everything goes into a STAGING folder next to the target
      (`<parent>/.import-<random>`: a hidden folder, so neither the catalogue
      nor a sync tool sees it, and on the same volume);
   2. a NEW folder is then put in place by ONE rename of the staging folder;
      files for an EXISTING folder are moved in one by one (a rename never
      overwrites: the host rejects an existing destination);
   3. on any error the staging folder is emptied and set aside and what was
      already moved is taken out again, so a failed import leaves nothing.
   All of it goes through `HostFs`, hence through the bridge and its perimeter.
══════════════════════════════════════════════════════════ */

export interface ReceivedArchive { files: PreparedFile[]; skipped: ZipSkip[]; junk: number }

/** Reads a received archive and hashes its files. Throws `ZipReadError`. */
export async function receiveArchive(bytes: Uint8Array): Promise<ReceivedArchive> {
	const { files, skipped, junk } = await readZip(bytes);
	const prepared: PreparedFile[] = [];
	for (const f of files) prepared.push({ name: f.name, bytes: f.bytes, sha256: await sha256Hex(f.bytes) });
	return { files: prepared, skipped, junk };
}

/** An imported file whose target path would pass `PATH_MAX`. Thrown BEFORE
    anything is written, so the refusal leaves the disk untouched. */
export class ImportPathTooLongError extends Error {
	constructor(readonly fileName: string) { super(`import-path-too-long: ${fileName}`); }
}

const join = (a: string, b: string): string => (a && b ? `${a}/${b}` : a || b);

/** What is already in the target folder, for the directories the archive may
    write into: folded relative path -> SHA-256. A file is hashed only when its
    name looks like one of the archive's (same stem, optional " (n)"); any
    other entry is mapped to a value no archive file can equal. */
export async function scanTarget(folder: string, files: { name: string }[]): Promise<Map<string, string>> {
	const fs = currentHost().fs;
	const out = new Map<string, string>();
	const stems = files.map(f => (f.name.split(/[\\/]/).pop() ?? "").normalize("NFC").toLowerCase().replace(/\.[^.]*$/, ""));
	const looksLike = (name: string): boolean => {
		const n = name.normalize("NFC").toLowerCase().replace(/\.[^.]*$/, "").replace(/ \(\d+\)$/, "");
		return stems.some(s => s.replace(/[:*?"<>|]/g, "-") === n || s === n);
	};
	if (!(await fs.exists(folder))) return out;
	for (const dir of importDirs(files)) {
		const entries = await fs.listDir(join(folder, dir)).catch(() => []);
		for (const e of entries) {
			const rel = join(dir, e.name);
			if (e.isFolder) { out.set(foldPath(rel), DIRECTORY); continue; }
			let hash = "<unread>";
			if (looksLike(e.name)) {
				try { hash = await sha256Hex(await fs.readBinary(join(folder, rel))); } catch { /* unreadable: treated as different */ }
			}
			out.set(foldPath(rel), hash);
		}
	}
	return out;
}

export function planFor(received: ReceivedArchive, existing: Map<string, string>, quizOnly: boolean, fallbackName: string): ImportPlan {
	return planImport({ files: received.files, skipped: received.skipped, junk: received.junk, quizOnly, existing, fallbackName });
}

const randomId = (): string => {
	const b = new Uint8Array(6);
	crypto.getRandomValues(b);
	return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
};

/** Throws `ImportPathTooLongError` naming the first file that would not fit: the relative path against
    `PATH_MAX`, and on Windows the ABSOLUTE path (root, folder, staging folder, file) against its 260. */
export function checkPaths(folder: string, plan: ImportPlan, windows: boolean = currentHost().platform.isWindows): void {
	for (const w of plan.writes) {
		const name = `${w.path} (99)`;
		if (!fitsPath(folder, name) || (windows && !fitsWindowsPath(folder, name))) throw new ImportPathTooLongError(w.path);
	}
}

export type Destination =
	| { kind: "new"; parent: string; name: string }
	| { kind: "into"; folder: string };

/** Writes the plan. Returns the folder that now holds the files. Throws, with
    nothing left behind, when anything fails. */
export async function applyPlan(plan: ImportPlan, dest: Destination): Promise<string> {
	const fs = currentHost().fs;
	let finalFolder: string;
	if (dest.kind === "new") {
		const root = join(dest.parent, dest.name);
		finalFolder = root;
		// The DISK decides (`exists`), not the index, which never lists a folder.
		for (let n = 2; await fs.exists(finalFolder); n++) finalFolder = `${root} (${n})`;
	} else {
		finalFolder = dest.folder;
	}
	checkPaths(finalFolder, plan);
	const parent = finalFolder.includes("/") ? finalFolder.slice(0, finalFolder.lastIndexOf("/")) : "";
	const staging = join(parent, `.import-${randomId()}`);
	const staged: string[] = [];
	const moved: string[] = [];
	// Folders this import created in the TARGET (not in staging): set aside again on failure.
	const created: string[] = [];
	const makeDirs = async (full: string): Promise<void> => {
		const parts = full.split("/");
		for (let i = 1; i <= parts.length; i++) {
			const prefix = parts.slice(0, i).join("/");
			if (await fs.exists(prefix)) continue;
			await fs.mkdirs(prefix);
			created.push(prefix);
		}
	};
	try {
		await fs.mkdirs(staging);
		for (const w of plan.writes) {
			const slash = w.path.lastIndexOf("/");
			if (slash > 0) await fs.mkdirs(join(staging, w.path.slice(0, slash)));
			await fs.writeBinary(join(staging, w.path), w.bytes);
			staged.push(join(staging, w.path));
		}
		if (dest.kind === "new") {
			await fs.rename(staging, finalFolder);
			return finalFolder;
		}
		await makeDirs(finalFolder);
		for (const w of plan.writes) {
			const target = join(finalFolder, w.path);
			const slash = w.path.lastIndexOf("/");
			if (slash > 0) await makeDirs(join(finalFolder, w.path.slice(0, slash)));
			// Never overwrite: the plan saw the folder, but it may have changed since.
			if (await fs.exists(target)) throw new Error(`import-target-exists: ${w.path}`);
			await fs.rename(join(staging, w.path), target);
			moved.push(target);
		}
		await discardStaging(staging, staged);
		return finalFolder;
	} catch (e) {
		for (const m of moved) await fs.remove(m).catch(() => {});
		for (const d of created.reverse()) await fs.trash(d).catch(() => {});
		await discardStaging(staging, staged);
		throw e;
	}
}

/** Takes the leftover files out of the staging folder and sets the (now empty)
    folder aside in the host's recoverable trash: no folder removal exists in
    the contract, and a hidden empty folder is the least that can remain. */
async function discardStaging(staging: string, files: string[]): Promise<void> {
	const fs = currentHost().fs;
	for (const f of files) await fs.remove(f).catch(() => {});
	await fs.trash(staging).catch(() => {});
}
