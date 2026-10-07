import { baseNameVerdict } from "./share-names";

/* ══════════════════════════════════════════════════════════
   ZIP — écrivain minimal (méthode « store », sans compression).
   Suffisant pour des notes Markdown (petits fichiers texte) et sans
   dépendance : ni JSZip ni zlib, donc identique desktop/mobile.
   Format : local file headers + central directory + end record
   (spec PKZIP APPNOTE, sous-ensemble strict).
══════════════════════════════════════════════════════════ */

/** Table CRC-32 (polynôme réfléchi 0xEDB88320), calculée une fois. */
const CRC_TABLE: Uint32Array = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(data: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
	/** Nom DANS l'archive (séparateur « / », jamais de chemin absolu). */
	name: string;
	content: string;
}

/** A file of an archive, as bytes (images travel with the notes). */
export interface ZipFile {
	name: string;
	bytes: Uint8Array;
}

/** What a shared file may weigh: the SAME bound on the sending side (the
    window checks before asking the main process) and in the main process
    (`electron/partage.ts`, the Android bridge). */
export const SHARE_MAX_BYTES = 16 * 1024 * 1024;

const concatBytes = (parts: Uint8Array[]): Uint8Array => {
	const total = parts.reduce((s, p) => s + p.length, 0);
	const out = new Uint8Array(total);
	let pos = 0;
	for (const p of parts) { out.set(p, pos); pos += p.length; }
	return out;
};

/** Bytes a stored entry costs in an archive (both headers, the name twice). */
export function zipEntryOverhead(name: string): number {
	return 30 + 46 + 2 * new TextEncoder().encode(name).length;
}
/** End-of-central-directory record. */
export const ZIP_END_BYTES = 22;

/** Builds a ZIP archive (store) from byte entries. A shared archive passes
    `now`, so its DOS date is a REAL one (the old writer stored 0: month 0,
    day 0, which `unzip` prints as year 1980 month 0 and stricter readers
    reject). Without `now` the bytes stay DETERMINISTIC, as the pinned language
    pack (`PACK_C`, `check:electron-langages`) requires. */
export function buildZipFiles(files: ZipFile[], now?: Date): Uint8Array {
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	const dosTime = now ? (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1) : 0;
	const dosDate = now ? (Math.max(0, now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate() : 0;

	const u16 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
	const u32 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);

	for (const file of files) {
		const nameBytes = encoder.encode(file.name);
		const data = file.bytes;
		const crc = crc32(data);
		// Bit 11 of the flag = UTF-8 names (note titles carry accents).
		const common = concatBytes([
			u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
			u32(crc), u32(data.length), u32(data.length),
			u16(nameBytes.length), u16(0),
		]);
		const local = concatBytes([u32(0x04034b50), common, nameBytes, data]);
		central.push(concatBytes([
			u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0),
			u32(offset), nameBytes,
		]));
		chunks.push(local);
		offset += local.length;
	}

	const centralBlob = concatBytes(central);
	const end = concatBytes([
		u32(0x06054b50), u16(0), u16(0),
		u16(files.length), u16(files.length),
		u32(centralBlob.length), u32(offset), u16(0),
	]);
	return concatBytes([...chunks, centralBlob, end]);
}

/** Builds a ZIP archive (store) from UTF-8 text entries. */
export function buildZip(entries: ZipEntry[], now?: Date): Uint8Array {
	const encoder = new TextEncoder();
	return buildZipFiles(entries.map(e => ({ name: e.name, bytes: encoder.encode(e.content) })), now);
}

/** Lit une archive ZIP « store » (inverse de buildZip) : parcourt les en-têtes
    de fichier locaux (signature 0x04034b50), extrait nom + contenu texte. Les
    entrées compressées (method ≠ 0) sont ignorées — on n'importe que nos propres
    archives, toujours « store ». Robuste aux zips d'autres outils tant que le
    contenu texte est en store ; sinon l'entrée est simplement sautée. */
export function parseZip(bytes: Uint8Array): ZipEntry[] {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const decoder = new TextDecoder();
	const out: ZipEntry[] = [];
	let off = 0;
	while (off + 30 <= bytes.length && dv.getUint32(off, true) === 0x04034b50) {
		const method = dv.getUint16(off + 8, true);
		const compSize = dv.getUint32(off + 18, true);
		const nameLen = dv.getUint16(off + 26, true);
		const extraLen = dv.getUint16(off + 28, true);
		const nameStart = off + 30;
		const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen));
		const dataStart = nameStart + nameLen + extraLen;
		if (method === 0 && !name.endsWith("/")) {
			out.push({ name, content: decoder.decode(bytes.subarray(dataStart, dataStart + compSize)) });
		}
		off = dataStart + compSize;
	}
	return out;
}

/** Le NOM DE NOTE (sans extension) sous lequel importer une entrée d'une
    archive REÇUE, ou `null` pour l'écarter (2026-09-25). Une archive partagée
    vient d'un tiers : ses noms ne sont pas des chemins à suivre. On garde le
    DERNIER segment, coupé sur « / » ET sur « \ » (un nom `..\..\x.md` créait
    la note hors du dossier du cours, sous Windows), on retire les caractères
    interdits et les points de tête (fichier caché, `..`), et seul un `.md`
    passe : nos partages n'écrivent que des notes, et un `.exe` ou un `.lnk`
    reçu n'a rien à faire dans un dossier de cours. */
export function nomNoteImportee(nomDansArchive: string): string | null {
	const dernier = nomDansArchive.split(/[\\/]/).pop() ?? "";
	if (!/\.md$/i.test(dernier)) return null;
	// Name rules shared with the exporter (`share-names.ts`: NFC, Windows
	// device names by the part before the first dot, length cap).
	const v = baseNameVerdict(dernier.slice(0, -3));
	return v.ok ? v.name : null;
}

/* ── Reading a RECEIVED archive (2026-10-01). `parseZip` above walks the local
   headers of OUR own store-only archives and silently skipped everything
   else: an archive zipped by Explorer, macOS or 7-Zip (deflate) imported as
   "empty", and one written with data descriptors misread its sizes. `readZip`
   goes through the CENTRAL directory (the only place sizes are always right),
   reads stored and deflated entries, and BOUNDS everything: the archive comes
   from a third party. ── */

export const IMPORT_LIMITS = {
	/** The archive as received. */
	archive: 64 * 1024 * 1024,
	/** Entries read (a zip bomb of a million empty files). */
	entries: 2000,
	/** One entry, once inflated. */
	entry: 16 * 1024 * 1024,
	/** All entries together, once inflated. */
	total: 64 * 1024 * 1024,
};

export interface ReadZipResult {
	files: ZipFile[];
	/** Entries NOT read: encrypted, an unknown method, too big, a bad checksum. */
	skipped: number;
}

/** The archive cannot be read at all (not a zip, truncated, or past a bound). */
export class ZipReadError extends Error {
	readonly code: "invalid" | "too-large" | "too-many";
	constructor(code: "invalid" | "too-large" | "too-many") {
		super(`zip-${code}`);
		this.code = code;
	}
}

/** Inflates a raw deflate stream, stopping as soon as it passes `max` bytes
    (a few KB of input can inflate to gigabytes). `null` when over the bound
    or not a valid stream. */
async function inflateBounded(data: Uint8Array, max: number): Promise<Uint8Array | null> {
	try {
		const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
		const reader = stream.getReader();
		const parts: Uint8Array[] = [];
		let size = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > max) { await reader.cancel().catch(() => {}); return null; }
			parts.push(value);
		}
		return concatBytes(parts);
	} catch {
		return null;
	}
}

export async function readZip(bytes: Uint8Array, limits = IMPORT_LIMITS): Promise<ReadZipResult> {
	if (bytes.length > limits.archive) throw new ZipReadError("too-large");
	if (bytes.length < 22) throw new ZipReadError("invalid");
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let end = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
		if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
	}
	if (end < 0) throw new ZipReadError("invalid");
	const count = dv.getUint16(end + 10, true);
	const cdOffset = dv.getUint32(end + 16, true);
	if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipReadError("invalid"); // zip64
	if (count > limits.entries) throw new ZipReadError("too-many");
	const decoder = new TextDecoder();
	const files: ZipFile[] = [];
	let skipped = 0;
	let total = 0;
	let off = cdOffset;
	for (let n = 0; n < count; n++) {
		if (off + 46 > bytes.length || dv.getUint32(off, true) !== 0x02014b50) throw new ZipReadError("invalid");
		const flags = dv.getUint16(off + 8, true);
		const method = dv.getUint16(off + 10, true);
		const crc = dv.getUint32(off + 16, true);
		const compSize = dv.getUint32(off + 20, true);
		const size = dv.getUint32(off + 24, true);
		const nameLen = dv.getUint16(off + 28, true);
		const extraLen = dv.getUint16(off + 30, true);
		const commentLen = dv.getUint16(off + 32, true);
		const local = dv.getUint32(off + 42, true);
		if (off + 46 + nameLen > bytes.length) throw new ZipReadError("invalid");
		const name = decoder.decode(bytes.subarray(off + 46, off + 46 + nameLen));
		off += 46 + nameLen + extraLen + commentLen;
		if (name.endsWith("/")) continue;
		if ((flags & 1) !== 0 || (method !== 0 && method !== 8) || size === 0xffffffff || compSize === 0xffffffff) { skipped++; continue; }
		if (size > limits.entry || total + size > limits.total) { skipped++; continue; }
		if (local + 30 > bytes.length || dv.getUint32(local, true) !== 0x04034b50) { skipped++; continue; }
		const dataStart = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
		if (dataStart + compSize > bytes.length) { skipped++; continue; }
		const raw = bytes.subarray(dataStart, dataStart + compSize);
		const data = method === 0 ? (compSize === size ? raw : null) : await inflateBounded(raw, size);
		if (!data || data.length !== size || crc32(data) !== crc) { skipped++; continue; }
		total += size;
		files.push({ name, bytes: data });
	}
	return { files, skipped };
}

/** The raster formats a quiz can embed and a share may carry (no SVG: it can
    carry script). */
export const IMAGE_IMPORT_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"];
/** One imported image, once read. */
export const IMAGE_IMPORT_MAX_BYTES = 8 * 1024 * 1024;

/** The file name (flattened, without a path, WITH its extension) under which
    to import an IMAGE of a received archive, or `null` to drop it: the same
    rules as `nomNoteImportee`, restricted to `IMAGE_IMPORT_EXTENSIONS`. */
export function nomImageImportee(nomDansArchive: string): string | null {
	const dernier = nomDansArchive.split(/[\\/]/).pop() ?? "";
	const point = dernier.lastIndexOf(".");
	if (point <= 0) return null;
	const ext = dernier.slice(point + 1).toLowerCase();
	if (!IMAGE_IMPORT_EXTENSIONS.includes(ext)) return null;
	const v = baseNameVerdict(dernier.slice(0, point));
	return v.ok ? `${v.name}.${ext}` : null;
}

/** What a received archive holds that may be imported: the notes (as text) and
    the images, each under its flattened, sanitised name. Anything else is
    counted as `ignored` (a `.exe`, a `.pdf`, a hidden file...). */
export interface ImportedArchive {
	notes: ZipEntry[];
	images: ZipFile[];
	ignored: number;
}

export function classerArchive(files: ZipFile[]): ImportedArchive {
	const decoder = new TextDecoder();
	const out: ImportedArchive = { notes: [], images: [], ignored: 0 };
	for (const f of files) {
		const note = nomNoteImportee(f.name);
		if (note !== null) { out.notes.push({ name: `${note}.md`, content: decoder.decode(f.bytes) }); continue; }
		const image = nomImageImportee(f.name);
		if (image !== null && f.bytes.length <= IMAGE_IMPORT_MAX_BYTES) { out.images.push({ name: image, bytes: f.bytes }); continue; }
		out.ignored++;
	}
	return out;
}
