import { MODULE_ICONS } from "./module-icons";
import { cleanName } from "./share-names";

/* ══════════════════════════════════════════════════════════
   THE MANIFEST OF A SHARED ARCHIVE (format 1, 2026-10-07).

   A shared .zip now carries `neo-quiz.json` as its first entry: the format
   and its version, the kind of share (a whole folder or a selection of
   quizzes), the name and the visual settings of the folder, and the list of
   files with their size and SHA-256. The importer uses it to detect an
   altered or missing file and to give a NEW folder the look of the original.

   Rules that keep sharing from breaking between versions:
   - An archive WITHOUT a manifest is format 0 (every archive made before
     this one) and is always read with the legacy rules.
   - The manifest only ADDS checks; it never gates. A manifest that is
     unreadable is ignored with a notice; one that announces a NEWER format
     than this app knows is imported at best (notes and images recognised)
     with a notice to update the app, never refused.
   - Unknown fields are ignored (a later version may add some).

   Pure (no host, no DOM, no Node): `crypto.subtle` exists in Chromium, in the
   Android WebView and in Node.
══════════════════════════════════════════════════════════ */

export const MANIFEST_NAME = "neo-quiz.json";
export const SHARE_FORMAT = "neo-quiz-share";
/** The newest manifest version this build writes and fully understands. */
export const SHARE_VERSION = 1;

export type ShareKind = "folder" | "quizzes";

/** The visual settings of a folder that travel with it. */
export interface FolderSettings {
	name?: string;
	color?: string;
	icon?: string;
	ue?: string;
}

export interface ManifestFile {
	path: string;
	kind: "note" | "image";
	size: number;
	sha256: string;
}

export interface ShareManifest {
	format: typeof SHARE_FORMAT;
	version: number;
	app: string;
	created: string;
	kind: ShareKind;
	name: string;
	folder?: FolderSettings;
	files: ManifestFile[];
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
	return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

/** Folder settings cut to what the receiving app accepts: a `#rrggbb` colour,
    an icon from the curated list, a bounded name and unit. Anything else is
    dropped (never trusted, never written as is). */
export function sanitizeFolderSettings(raw: unknown): FolderSettings | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	const out: FolderSettings = {};
	if (typeof o.color === "string" && /^#[0-9a-f]{6}$/i.test(o.color)) out.color = o.color.toLowerCase();
	if (typeof o.icon === "string" && (MODULE_ICONS as readonly string[]).includes(o.icon)) out.icon = o.icon;
	if (typeof o.name === "string") { const n = cleanName(o.name).slice(0, 100); if (n) out.name = n; }
	if (typeof o.ue === "string") { const u = o.ue.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80); if (u) out.ue = u; }
	return Object.keys(out).length > 0 ? out : null;
}

export interface BuildManifestInput {
	app: string;
	now: Date;
	kind: ShareKind;
	name: string;
	folder?: FolderSettings | null;
	files: { path: string; kind: "note" | "image"; bytes: Uint8Array }[];
}

export async function buildManifest(input: BuildManifestInput): Promise<ShareManifest> {
	const folder = sanitizeFolderSettings(input.folder);
	const files: ManifestFile[] = [];
	for (const f of input.files) files.push({ path: f.path, kind: f.kind, size: f.bytes.length, sha256: await sha256Hex(f.bytes) });
	const m: ShareManifest = {
		format: SHARE_FORMAT,
		version: SHARE_VERSION,
		app: input.app,
		created: input.now.toISOString().replace(/\.\d{3}Z$/, "Z"),
		kind: input.kind,
		name: input.name,
		files,
	};
	if (folder) m.folder = folder;
	return m;
}

export function manifestBytes(m: ShareManifest): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(m, null, 2) + "\n");
}

export type ManifestRead =
	| { status: "none" }
	| { status: "invalid" }
	| { status: "newer"; version: number }
	| { status: "ok"; manifest: ShareManifest };

/** The most files a manifest may list: the same bound as the entries read from an archive (`IMPORT_LIMITS.entries`, pinned by `check:partage`). */
export const MANIFEST_MAX_FILES = 2000;

/** Reads the bytes of `neo-quiz.json`. Never throws. A `version` above
    `SHARE_VERSION` is `newer`: its content is not trusted for checks. */
export function readManifest(bytes: Uint8Array | null): ManifestRead {
	if (!bytes) return { status: "none" };
	let o: Record<string, unknown>;
	try {
		const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
		if (!v || typeof v !== "object" || Array.isArray(v)) return { status: "invalid" };
		o = v as Record<string, unknown>;
	} catch { return { status: "invalid" }; }
	if (o.format !== SHARE_FORMAT || typeof o.version !== "number" || !Number.isInteger(o.version) || o.version < 1) return { status: "invalid" };
	if (o.version > SHARE_VERSION) return { status: "newer", version: o.version };
	if (!Array.isArray(o.files)) return { status: "invalid" };
	// An archive holds at most `IMPORT_LIMITS.entries` files: a longer list is not ours (and would make the checks quadratic).
	if (o.files.length > MANIFEST_MAX_FILES) return { status: "invalid" };
	const files: ManifestFile[] = [];
	for (const f of o.files as unknown[]) {
		if (!f || typeof f !== "object") return { status: "invalid" };
		const e = f as Record<string, unknown>;
		if (typeof e.path !== "string" || typeof e.size !== "number" || typeof e.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(e.sha256)) return { status: "invalid" };
		files.push({ path: e.path.normalize("NFC"), kind: e.kind === "image" ? "image" : "note", size: e.size, sha256: e.sha256 });
	}
	const folder = sanitizeFolderSettings(o.folder);
	const manifest: ShareManifest = {
		format: SHARE_FORMAT,
		version: o.version,
		app: typeof o.app === "string" ? o.app.slice(0, 40) : "",
		created: typeof o.created === "string" ? o.created.slice(0, 40) : "",
		kind: o.kind === "folder" ? "folder" : "quizzes",
		name: typeof o.name === "string" ? o.name : "",
		files,
	};
	if (folder) manifest.folder = folder;
	return { status: "ok", manifest };
}
