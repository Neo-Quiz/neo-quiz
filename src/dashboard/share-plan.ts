import { QUIZ_BLOCK_RE } from "../quiz-utils";
import { MANIFEST_NAME, readManifest } from "./share-manifest";
import type { FolderSettings } from "./share-manifest";
import { NAME_MAX, baseNameVerdict, cleanName, isReservedName } from "./share-names";
import { IMAGE_IMPORT_EXTENSIONS, IMAGE_IMPORT_MAX_BYTES, isJunkEntry } from "./zip";
import type { ZipSkip, ZipSkipReason } from "./zip";

/* ══════════════════════════════════════════════════════════
   THE IMPORT PLAN (2026-10-07). Importing a received archive is two steps:
   this module DECIDES (pure: no host, no disk, no clock, no randomness), then
   `share-import.ts` APPLIES the decision in a staging folder.

   Input: the entries of the archive (bytes and SHA-256) and the state of the
   target folder (the files already there, by path, with their SHA-256).
   Output: what to write and where, what was found identical and skipped, what
   was renamed, and every entry left out with its reason. Nothing is dropped
   without being listed.

   Rules:
   - Paths keep their sub-folders (an `img/photo.jpg` cited by a note must
     still be at `img/photo.jpg`); every segment goes through the shared name
     rules. A single root folder wrapping the whole archive (Explorer, Finder)
     is removed. Extensions are kept as written (`figure.PNG`).
   - Note bytes are never touched (BOM, CRLF, invalid UTF-8 survive).
   - Nothing existing is ever overwritten. A note identical to one already
     there (same SHA-256) is skipped; a different note with the same name
     becomes `Name (2)`. An image with a taken name and different bytes is NOT
     imported (quizzes cite images by name, the user's file stays).
   - A manifest (format 1) is verified: a file whose size or SHA-256 differs is
     refused as altered; a listed file that is absent is reported. A manifest
     of a NEWER format, or an unreadable one, only adds a notice.
══════════════════════════════════════════════════════════ */

export interface PreparedFile { name: string; bytes: Uint8Array; sha256: string }

export type DiscardReason =
	| ZipSkipReason
	| "unsupported-type" | "bad-name" | "image-too-large" | "duplicate-image" | "image-name-taken" | "no-quiz" | "altered";

export interface PlannedWrite {
	/** Relative to the target folder, "/" separated, NFC. */
	path: string;
	kind: "note" | "image";
	bytes: Uint8Array;
	sha256: string;
}

export type PlanNotice = "newer-format" | "manifest-invalid";

export interface ImportPlan {
	writes: PlannedWrite[];
	/** Identical to a file already there (or already in the plan): skipped. */
	duplicates: string[];
	/** A different note had the name: it is written under a new one. */
	renamed: { from: string; to: string }[];
	discarded: { name: string; reason: DiscardReason }[];
	/** Files the manifest lists that the archive does not hold. */
	missing: string[];
	junk: number;
	notices: PlanNotice[];
	/** Name for a NEW folder: the manifest's, else the archive file's. */
	folderName: string;
	/** Visual settings, only from a readable format-1 manifest. */
	settings: FolderSettings | null;
}

export interface PlanInput {
	files: PreparedFile[];
	skipped: ZipSkip[];
	junk: number;
	/** Each note must hold a quiz block (a note without one is left out). */
	quizOnly: boolean;
	/** Files already in the target, by folded path (`foldPath`) -> SHA-256.
	    A folder (or anything not comparable) maps to `DIRECTORY`. Empty for a
	    new folder. */
	existing: ReadonlyMap<string, string>;
	/** Folder name from the archive's file name, used when no manifest names it. */
	fallbackName: string;
}

export const DIRECTORY = "<directory>";

/** The comparison key of a path: NFC, case folded (NTFS, APFS). */
export const foldPath = (p: string): string => p.normalize("NFC").toLowerCase();

const NOTE_RE = /\.md$/i;
const QUIZ_FENCE = new RegExp(QUIZ_BLOCK_RE.source, QUIZ_BLOCK_RE.flags.replace("g", ""));

const slashes = (name: string): string => name.normalize("NFC").replace(/\\/g, "/");

/** One archive path, split into directory segments and a file name. */
function segments(name: string): string[] {
	return slashes(name).split("/").filter(s => s !== "" && s !== ".");
}

/** A directory segment as it may be written, or null. */
function dirSegment(raw: string): string | null {
	if (raw === "..") return null;
	let n = cleanName(raw);
	if (n.length > NAME_MAX) n = n.slice(0, NAME_MAX).replace(/[\s.]+$/, "");
	return n.length === 0 || isReservedName(n) ? null : n;
}

/** The sorted directories (relative, "" = the target itself) the plan may write
    into, so the caller lists them in the target before planning. Same
    normalisation as `planImport`. */
export function importDirs(files: { name: string }[]): string[] {
	const dirs = new Set<string>([""]);
	const entries = files.filter(f => slashes(f.name).toLowerCase() !== MANIFEST_NAME && !isJunkEntry(f.name)).map(f => segments(f.name)).filter(s => s.length > 0);
	const wrapped = entries.length > 0 && entries.every(s => s.length > 1 && s[0] === entries[0][0]);
	// A manifest-bearing archive is not unwrapped, so list both variants.
	for (const unwrap of wrapped ? [0, 1] : [0]) {
		for (const s of entries) {
			const dirParts: string[] = [];
			for (const seg of s.slice(unwrap, -1)) {
				const d = dirSegment(seg);
				if (d === null) break;
				dirParts.push(d);
				dirs.add(dirParts.join("/"));
			}
		}
	}
	return [...dirs].sort();
}

function fileParts(name: string): { stem: string; ext: string } {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: "" };
}

export function planImport(input: PlanInput): ImportPlan {
	const plan: ImportPlan = { writes: [], duplicates: [], renamed: [], discarded: [], missing: [], junk: input.junk, notices: [], folderName: input.fallbackName, settings: null };
	for (const s of input.skipped) plan.discarded.push({ name: s.name, reason: s.reason });

	// 1. The manifest, apart from the content.
	let manifestBytes: Uint8Array | null = null;
	const rest: PreparedFile[] = [];
	for (const f of input.files) {
		if (isJunkEntry(f.name)) { plan.junk++; continue; }
		if (slashes(f.name).toLowerCase() === MANIFEST_NAME) { manifestBytes = f.bytes; continue; }
		rest.push(f);
	}
	const read = readManifest(manifestBytes);
	if (read.status === "newer") plan.notices.push("newer-format");
	if (read.status === "invalid") plan.notices.push("manifest-invalid");

	// 2. Verify against the manifest (format 1 only).
	let candidates = rest;
	if (read.status === "ok") {
		const byPath = new Map(rest.map(f => [slashes(f.name), f]));
		const refused = new Set<PreparedFile>();
		for (const mf of read.manifest.files) {
			const f = byPath.get(mf.path);
			if (!f) {
				if (!input.skipped.some(s => slashes(s.name) === mf.path)) plan.missing.push(mf.path);
				continue;
			}
			if (f.bytes.length !== mf.size || f.sha256 !== mf.sha256) { refused.add(f); plan.discarded.push({ name: f.name, reason: "altered" }); }
		}
		candidates = rest.filter(f => !refused.has(f));
		plan.settings = read.manifest.folder ?? null;
		const named = baseNameVerdict(read.manifest.name);
		if (named.ok) plan.folderName = named.name;
	}

	// 3. Recognise what may be imported.
	interface Entry { file: PreparedFile; parts: string[]; kind: "note" | "image" }
	const entries: Entry[] = [];
	for (const f of candidates) {
		const parts = segments(f.name);
		const last = parts[parts.length - 1] ?? "";
		const { ext } = fileParts(last);
		const isNote = NOTE_RE.test(last);
		const isImage = IMAGE_IMPORT_EXTENSIONS.includes(ext.slice(1).toLowerCase());
		if (!isNote && !isImage) { plan.discarded.push({ name: f.name, reason: "unsupported-type" }); continue; }
		entries.push({ file: f, parts, kind: isNote ? "note" : "image" });
	}

	// 4. A single root folder wrapping everything is removed (not for format 1,
	// whose paths are written by the exporter and are authoritative).
	const unwrap = read.status !== "ok" && entries.length > 0 && entries.every(e => e.parts.length > 1 && e.parts[0] === entries[0].parts[0]);

	// 5. Sanitise, then resolve collisions in archive order.
	const taken = new Map<string, { sha: string; fromArchive: boolean }>();
	for (const [k, v] of input.existing) taken.set(k, { sha: v, fromArchive: false });

	for (const e of entries) {
		const parts = unwrap ? e.parts.slice(1) : e.parts;
		const dirs: string[] = [];
		let ok = true;
		for (const seg of parts.slice(0, -1)) {
			const d = dirSegment(seg);
			if (d === null) { ok = false; break; }
			dirs.push(d);
		}
		const { stem, ext } = fileParts(parts[parts.length - 1]);
		const verdict = ok ? baseNameVerdict(stem) : null;
		if (!verdict || !verdict.ok) { plan.discarded.push({ name: e.file.name, reason: "bad-name" }); continue; }
		const dirPath = dirs.join("/");
		const prefix = dirPath ? `${dirPath}/` : "";

		if (e.kind === "image") {
			if (e.file.bytes.length > IMAGE_IMPORT_MAX_BYTES) { plan.discarded.push({ name: e.file.name, reason: "image-too-large" }); continue; }
			const path = `${prefix}${verdict.name}${ext}`;
			const key = foldPath(path);
			const same = taken.get(key);
			if (same) {
				if (same.sha === e.file.sha256) plan.duplicates.push(path);
				else plan.discarded.push({ name: e.file.name, reason: same.fromArchive ? "duplicate-image" : "image-name-taken" });
				continue;
			}
			taken.set(key, { sha: e.file.sha256, fromArchive: true });
			plan.writes.push({ path, kind: "image", bytes: e.file.bytes, sha256: e.file.sha256 });
			continue;
		}

		if (input.quizOnly && !QUIZ_FENCE.test(new TextDecoder().decode(e.file.bytes))) {
			plan.discarded.push({ name: e.file.name, reason: "no-quiz" });
			continue;
		}
		// A note: identical content is skipped, a different one takes a free name.
		const wanted = `${prefix}${verdict.name}${ext}`;
		let path = wanted;
		let skip = false;
		for (let n = 2; ; n++) {
			const hit = taken.get(foldPath(path));
			if (!hit) break;
			if (hit.sha === e.file.sha256) { skip = true; break; }
			path = `${prefix}${verdict.name} (${n})${ext}`;
		}
		if (skip) { plan.duplicates.push(path); continue; }
		taken.set(foldPath(path), { sha: e.file.sha256, fromArchive: true });
		plan.writes.push({ path, kind: "note", bytes: e.file.bytes, sha256: e.file.sha256 });
		if (path !== wanted) plan.renamed.push({ from: wanted, to: path });
	}
	return plan;
}
