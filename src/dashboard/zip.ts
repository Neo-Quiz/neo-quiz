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

/* ── Reading a RECEIVED archive (2026-10-01, hardened 2026-10-07). `parseZip`
   above walks the local headers of OUR own store-only archives and silently
   skipped everything else: an archive zipped by Explorer, macOS or 7-Zip
   (deflate) imported as "empty", and one written with data descriptors misread
   its sizes. `readZip` goes through the CENTRAL directory (the only place
   sizes are always right), reads stored and deflated entries, and BOUNDS
   everything: the archive comes from a third party.

   NOTHING is dropped silently: every entry that is not read comes back in
   `skipped` with its name and a reason, and the caller shows it. Only the
   operating-system litter a zip tool adds on its own (`__MACOSX/`, `._x`,
   `.DS_Store`, `Thumbs.db`, `desktop.ini`) is counted apart as `junk`. ── */

export const IMPORT_LIMITS = {
	/** The archive as received. */
	archive: 64 * 1024 * 1024,
	/** Entries read (a zip bomb of a million empty files). */
	entries: 2000,
	/** One entry, once inflated. */
	entry: 16 * 1024 * 1024,
	/** All entries together, once inflated. */
	total: 64 * 1024 * 1024,
	/** An entry over `ratioFrom` bytes inflated may not exceed this
	    inflated/stored ratio (a few KB that inflate to megabytes of zeros). */
	ratio: 100,
	ratioFrom: 4 * 1024 * 1024,
};

/** Why an entry of the archive was not read. */
export type ZipSkipReason =
	| "encrypted" | "method" | "too-big" | "total" | "ratio"
	| "corrupt" | "bad-crc" | "name-mismatch" | "symlink" | "zip64";

export interface ZipSkip { name: string; reason: ZipSkipReason }

export interface ReadZipResult {
	files: ZipFile[];
	/** Entries NOT read, each with its name and why. The caller must show it. */
	skipped: ZipSkip[];
	/** System litter filtered out before reading (not the user's content). */
	junk: number;
}

/** The archive cannot be read at all. `zip64` and `multi-disk` are valid
    archives this reader does not support: they get their own message instead
    of "damaged". `overlap` is an archive whose entries share bytes (a zip-bomb
    technique, or damage). `unsafe-path` is an archive naming a path that tries
    to leave the target folder (`../x`, `/x`, `C:x`, a UNC share): no zip tool
    writes one, so the WHOLE archive is refused, not just that entry. */
export type ZipReadCode = "invalid" | "too-large" | "too-many" | "zip64" | "multi-disk" | "overlap" | "unsafe-path";
export class ZipReadError extends Error {
	readonly code: ZipReadCode;
	constructor(code: ZipReadCode) {
		super(`zip-${code}`);
		this.code = code;
	}
}

/** A path that climbs out (a `..` segment, either separator), is absolute
    (`/x`, `\x`, a UNC share), names a drive (`C:x`), or holds a NUL. */
export function isUnsafeEntryPath(name: string): boolean {
	if (/^[\\/]/.test(name) || /^[a-zA-Z]:/.test(name) || name.includes("\u0000")) return true;
	return name.split(/[\\/]/).includes("..");
}

/** Entries a zip tool adds on its own, whatever the folder they sit in. */
export function isJunkEntry(name: string): boolean {
	const parts = name.split(/[\\/]/);
	if (parts.includes("__MACOSX")) return true;
	const last = (parts[parts.length - 1] ?? "").toLowerCase();
	return last.startsWith("._") || last === ".ds_store" || last === "thumbs.db" || last === "desktop.ini";
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

/** Code page 437 for bytes 0x80..0xFF: what a zip tool writes when it sets no
    UTF-8 flag (legacy DOS/Windows tools). Exported so a check pins its size. */
export const CP437_HIGH = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

function decodeCp437(raw: Uint8Array): string {
	let out = "";
	for (const b of raw) out += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
	return out;
}

/** The name of an entry: the Info-ZIP Unicode Path field (0x7075) when its
    checksum matches the stored name; else UTF-8 when the flag (bit 11) says
    so, or when the bytes ARE valid UTF-8 (many tools write UTF-8 without the
    flag); else code page 437. */
function decodeEntryName(raw: Uint8Array, flags: number, extra: Uint8Array): string {
	for (let p = 0; p + 4 <= extra.length;) {
		const id = extra[p] | (extra[p + 1] << 8);
		const len = extra[p + 2] | (extra[p + 3] << 8);
		if (p + 4 + len > extra.length) break;
		if (id === 0x7075 && len > 5 && extra[p + 4] === 1) {
			const dv = new DataView(extra.buffer, extra.byteOffset + p + 5, 4);
			if (dv.getUint32(0, true) === crc32(raw)) return new TextDecoder().decode(extra.subarray(p + 9, p + 4 + len));
		}
		p += 4 + len;
	}
	if ((flags & 0x800) !== 0) return new TextDecoder().decode(raw);
	try { return new TextDecoder("utf-8", { fatal: true }).decode(raw); } catch { return decodeCp437(raw); }
}

/** A 64-bit little-endian value as a number, or `null` past 2^53. */
function u64(dv: DataView, at: number): number | null {
	const v = dv.getBigUint64(at, true);
	return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
}

interface CentralEntry {
	name: string; flags: number; method: number; crc: number;
	compSize: number; size: number; local: number; symlink: boolean;
	/** The 32-bit fields said "see the zip64 extra" and it was missing or short. */
	zip64Missing: boolean;
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
	if (dv.getUint16(end + 4, true) !== 0 || dv.getUint16(end + 6, true) !== 0) throw new ZipReadError("multi-disk");
	let count = dv.getUint16(end + 10, true);
	let cdOffset = dv.getUint32(end + 16, true);
	if (count === 0xffff || cdOffset === 0xffffffff || dv.getUint32(end + 12, true) === 0xffffffff) {
		// zip64: the real values sit in the zip64 end record, found by its locator.
		const loc = end - 20;
		if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
			const rec = u64(dv, loc + 8);
			if (rec === null || rec + 56 > bytes.length || dv.getUint32(rec, true) !== 0x06064b50) throw new ZipReadError("zip64");
			if (dv.getUint32(rec + 16, true) !== 0 || dv.getUint32(rec + 20, true) !== 0) throw new ZipReadError("multi-disk");
			const n = u64(dv, rec + 32);
			const off = u64(dv, rec + 48);
			if (n === null || off === null) throw new ZipReadError("zip64");
			count = n; cdOffset = off;
		} else if (cdOffset === 0xffffffff) {
			throw new ZipReadError("zip64");
		}
	}
	if (count > limits.entries) throw new ZipReadError("too-many");

	// Pass 1: the central directory.
	const entries: CentralEntry[] = [];
	let off = cdOffset;
	for (let n = 0; n < count; n++) {
		if (off < 0 || off + 46 > bytes.length || dv.getUint32(off, true) !== 0x02014b50) throw new ZipReadError("invalid");
		const madeBy = dv.getUint16(off + 4, true);
		const flags = dv.getUint16(off + 8, true);
		const method = dv.getUint16(off + 10, true);
		const crc = dv.getUint32(off + 16, true);
		let compSize = dv.getUint32(off + 20, true);
		let size = dv.getUint32(off + 24, true);
		const nameLen = dv.getUint16(off + 28, true);
		const extraLen = dv.getUint16(off + 30, true);
		const commentLen = dv.getUint16(off + 32, true);
		const attrs = dv.getUint32(off + 38, true);
		let local = dv.getUint32(off + 42, true);
		if (off + 46 + nameLen + extraLen + commentLen > bytes.length) throw new ZipReadError("invalid");
		const rawName = bytes.subarray(off + 46, off + 46 + nameLen);
		const extra = bytes.subarray(off + 46 + nameLen, off + 46 + nameLen + extraLen);
		const name = decodeEntryName(rawName, flags, extra);
		if (isUnsafeEntryPath(name)) throw new ZipReadError("unsafe-path");
		// zip64 extra field (0x0001): the fields that were 0xffffffff, in this order.
		let zip64Missing = false;
		if (size === 0xffffffff || compSize === 0xffffffff || local === 0xffffffff) {
			zip64Missing = true;
			for (let p = 0; p + 4 <= extra.length;) {
				const id = extra[p] | (extra[p + 1] << 8);
				const len = extra[p + 2] | (extra[p + 3] << 8);
				if (p + 4 + len > extra.length) break;
				if (id === 0x0001) {
					const edv = new DataView(extra.buffer, extra.byteOffset + p + 4, len);
					let q = 0;
					let ok = true;
					const take = (): number => {
						if (q + 8 > len) { ok = false; return -1; }
						const v = u64(edv, q);
						q += 8;
						if (v === null) { ok = false; return -1; }
						return v;
					};
					if (size === 0xffffffff) size = take();
					if (compSize === 0xffffffff) compSize = take();
					if (local === 0xffffffff) local = take();
					zip64Missing = !ok;
				}
				p += 4 + len;
			}
		}
		const symlink = (madeBy >> 8) === 3 && ((attrs >>> 16) & 0xf000) === 0xa000;
		entries.push({ name, flags, method, crc, compSize, size, local, symlink, zip64Missing });
		off += 46 + nameLen + extraLen + commentLen;
	}

	// Pass 2: where each entry's bytes sit. Two entries that share bytes are a
	// zip-bomb technique (one stored blob read many times) or damage: the
	// whole archive is refused.
	const spans: { start: number; end: number }[] = [];
	const headers = new Map<CentralEntry, { dataStart: number; nameOk: boolean } | null>();
	for (const e of entries) {
		if (e.name.endsWith("/") || e.zip64Missing || e.local < 0 || e.local + 30 > bytes.length || dv.getUint32(e.local, true) !== 0x04034b50) { headers.set(e, null); continue; }
		const lName = dv.getUint16(e.local + 26, true);
		const lExtra = dv.getUint16(e.local + 28, true);
		const dataStart = e.local + 30 + lName + lExtra;
		if (dataStart + e.compSize > bytes.length) { headers.set(e, null); continue; }
		const localName = decodeEntryName(bytes.subarray(e.local + 30, e.local + 30 + lName), dv.getUint16(e.local + 6, true), bytes.subarray(e.local + 30 + lName, dataStart));
		headers.set(e, { dataStart, nameOk: localName === e.name });
		spans.push({ start: e.local, end: dataStart + e.compSize });
	}
	spans.sort((a, b) => a.start - b.start || a.end - b.end);
	for (let i = 1; i < spans.length; i++) if (spans[i].start < spans[i - 1].end) throw new ZipReadError("overlap");

	// Pass 3: read.
	const files: ZipFile[] = [];
	const skipped: ZipSkip[] = [];
	let junk = 0;
	let total = 0;
	for (const e of entries) {
		if (e.name.endsWith("/")) continue;
		if (isJunkEntry(e.name)) { junk++; continue; }
		const skip = (reason: ZipSkipReason) => { skipped.push({ name: e.name, reason }); };
		if (e.zip64Missing) { skip("zip64"); continue; }
		if ((e.flags & 1) !== 0) { skip("encrypted"); continue; }
		if (e.method !== 0 && e.method !== 8) { skip("method"); continue; }
		if (e.symlink) { skip("symlink"); continue; }
		if (e.size > limits.entry) { skip("too-big"); continue; }
		if (total + e.size > limits.total) { skip("total"); continue; }
		if (e.size > limits.ratioFrom && e.size / Math.max(1, e.compSize) > limits.ratio) { skip("ratio"); continue; }
		const h = headers.get(e);
		if (!h) { skip("corrupt"); continue; }
		if (!h.nameOk) { skip("name-mismatch"); continue; }
		const raw = bytes.subarray(h.dataStart, h.dataStart + e.compSize);
		const data = e.method === 0 ? (e.compSize === e.size ? raw : null) : await inflateBounded(raw, e.size);
		if (!data || data.length !== e.size) { skip("corrupt"); continue; }
		if (crc32(data) !== e.crc) { skip("bad-crc"); continue; }
		total += e.size;
		files.push({ name: e.name, bytes: data });
	}
	return { files, skipped, junk };
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

/** Why an archive entry that could have been imported was not. */
export type IgnoreReason = "unsupported-type" | "bad-name" | "image-too-large" | "duplicate-image";
export interface IgnoredEntry { name: string; reason: IgnoreReason }

/** What a received archive holds that may be imported: the notes (as text) and
    the images, each under its flattened, sanitised name. Everything else is
    listed in `ignored` with its reason (a `.exe`, a `.pdf`, a reserved name...),
    never dropped silently. */
export interface ImportedArchive {
	notes: ZipEntry[];
	images: ZipFile[];
	ignored: IgnoredEntry[];
	/** System litter (`__MACOSX/`...) filtered out, not the user's content. */
	junk: number;
}

export function classerArchive(files: ZipFile[]): ImportedArchive {
	const decoder = new TextDecoder();
	const out: ImportedArchive = { notes: [], images: [], ignored: [], junk: 0 };
	const imageNames = new Map<string, ZipFile>();
	for (const f of files) {
		if (isJunkEntry(f.name)) { out.junk++; continue; }
		const note = nomNoteImportee(f.name);
		if (note !== null) { out.notes.push({ name: `${note}.md`, content: decoder.decode(f.bytes) }); continue; }
		const image = nomImageImportee(f.name);
		if (image !== null) {
			if (f.bytes.length > IMAGE_IMPORT_MAX_BYTES) { out.ignored.push({ name: f.name, reason: "image-too-large" }); continue; }
			const key = image.toLowerCase();
			const same = imageNames.get(key);
			if (same) {
				// The identical image twice (two sub-folders): nothing is lost.
				const identical = same.bytes.length === f.bytes.length && same.bytes.every((b, i) => b === f.bytes[i]);
				if (!identical) out.ignored.push({ name: f.name, reason: "duplicate-image" });
				continue;
			}
			const entry = { name: image, bytes: f.bytes };
			imageNames.set(key, entry);
			out.images.push(entry);
			continue;
		}
		const dernier = f.name.split(/[\\/]/).pop() ?? "";
		const ext = dernier.slice(dernier.lastIndexOf(".") + 1).toLowerCase();
		// A note or image extension whose NAME was refused is a name problem;
		// anything else is a type this import never writes.
		out.ignored.push({ name: f.name, reason: ext === "md" || IMAGE_IMPORT_EXTENSIONS.includes(ext) ? "bad-name" : "unsupported-type" });
	}
	return out;
}
