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

/** Construit une archive ZIP (store) à partir d'entrées texte UTF-8. */
export function buildZip(entries: ZipEntry[]): Uint8Array {
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;

	const u16 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
	const u32 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);
	const concat = (parts: Uint8Array[]): Uint8Array => {
		const total = parts.reduce((s, p) => s + p.length, 0);
		const out = new Uint8Array(total);
		let pos = 0;
		for (const p of parts) { out.set(p, pos); pos += p.length; }
		return out;
	};

	for (const entry of entries) {
		const nameBytes = encoder.encode(entry.name);
		const data = encoder.encode(entry.content);
		const crc = crc32(data);
		// Bit 11 du flag = noms en UTF-8 (les titres de notes ont des accents).
		const common = concat([
			u16(20), u16(0x0800), u16(0), u16(0), u16(0),
			u32(crc), u32(data.length), u32(data.length),
			u16(nameBytes.length), u16(0),
		]);
		const local = concat([u32(0x04034b50), common, nameBytes, data]);
		central.push(concat([
			u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0),
			u32(offset), nameBytes,
		]));
		chunks.push(local);
		offset += local.length;
	}

	const centralBlob = concat(central);
	const end = concat([
		u32(0x06054b50), u16(0), u16(0),
		u16(entries.length), u16(entries.length),
		u32(centralBlob.length), u32(offset), u16(0),
	]);
	return concat([...chunks, centralBlob, end]);
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
	const nom = dernier.slice(0, -3)
		.replace(/[:*?"<>|\u0000-\u001f]/g, "-")
		.replace(/^[\s.]+|[\s.]+$/g, "");
	return nom.length > 0 && nom.length <= 150 ? nom : null;
}
