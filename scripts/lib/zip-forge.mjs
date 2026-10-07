/**
 * A zip WRITER for tests and fixtures only: it can produce what the app's own
 * writer never does (deflate, data in the shape other tools use, legacy
 * code-page names, zip64, symlink attributes, overlapping entries, wrong
 * checksums...), so `readZip` is exercised on the archives the world makes,
 * not only on its own output. Deterministic: same input, same bytes (a fixed
 * DOS date, no clock).
 *
 * Not shipped, not imported by the app.
 */
import { deflateRawSync } from "node:zlib";

const crcTable = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
	return t;
})();
export function crc32(data) {
	let c = 0xffffffff;
	for (const b of data) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

const w16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff); return b; };
const w32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
const w64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };

/** Info-ZIP Unicode Path extra field (0x7075) for `rawName`. */
export function unicodePathExtra(rawName, utf8Name) {
	const body = Buffer.concat([Buffer.from([1]), w32(crc32(rawName)), Buffer.from(utf8Name, "utf8")]);
	return Buffer.concat([w16(0x7075), w16(body.length), body]);
}

/**
 * entries: [{ name | nameBytes, bytes (string | Uint8Array), method = 8,
 *   flags = 0, crc, size (declared), compressed (raw body to store as is),
 *   extra (central), localExtra, madeBy = 20 (host << 8 | version), attrs = 0,
 *   localNameBytes, zip64 (sizes and offset in a zip64 extra),
 *   localOffsetOf (index: point this entry's central record at that entry's
 *   local header, an overlap), noLocal }]
 * opts: { zip64End, diskNumber, comment }
 */
export function forgeZip(entries, opts = {}) {
	const parts = [];
	const central = [];
	const offsets = [];
	let off = 0;
	entries.forEach((e, i) => {
		const raw = Buffer.from(typeof e.bytes === "string" ? Buffer.from(e.bytes, "utf8") : (e.bytes ?? []));
		const name = Buffer.from(e.nameBytes ?? Buffer.from(e.name, "utf8"));
		const lname = Buffer.from(e.localNameBytes ?? name);
		const method = e.method ?? 8;
		const body = e.compressed ? Buffer.from(e.compressed) : method === 8 ? deflateRawSync(raw) : raw;
		const crc = e.crc ?? crc32(raw);
		const size = e.size ?? raw.length;
		const flags = e.flags ?? 0;
		const lextra = Buffer.from(e.localExtra ?? []);
		offsets.push(off);
		if (!e.noLocal) {
			const local = Buffer.concat([w32(0x04034b50), w16(20), w16(flags), w16(method), w16(0), w16(0x5a21), w32(crc), w32(body.length), w32(size), w16(lname.length), w16(lextra.length), lname, lextra, body]);
			parts.push(local);
			off += local.length;
		}
	});
	entries.forEach((e, i) => {
		const raw = Buffer.from(typeof e.bytes === "string" ? Buffer.from(e.bytes, "utf8") : (e.bytes ?? []));
		const name = Buffer.from(e.nameBytes ?? Buffer.from(e.name, "utf8"));
		const method = e.method ?? 8;
		const body = e.compressed ? Buffer.from(e.compressed) : method === 8 ? deflateRawSync(raw) : raw;
		const crc = e.crc ?? crc32(raw);
		const size = e.size ?? raw.length;
		const flags = e.flags ?? 0;
		const local = e.localOffsetOf !== undefined ? offsets[e.localOffsetOf] : offsets[i];
		let extra = Buffer.from(e.extra ?? []);
		let cSize = body.length; let uSize = size; let cLocal = local;
		if (e.zip64) {
			extra = Buffer.concat([extra, w16(0x0001), w16(24), w64(size), w64(body.length), w64(local)]);
			cSize = 0xffffffff; uSize = 0xffffffff; cLocal = 0xffffffff;
		}
		central.push(Buffer.concat([w32(0x02014b50), w16(e.madeBy ?? 20), w16(20), w16(flags), w16(method), w16(0), w16(0x5a21), w32(crc), w32(cSize), w32(uSize), w16(name.length), w16(extra.length), w16(0), w16(0), w16(0), w32(e.attrs ?? 0), w32(cLocal), name, extra]));
	});
	const cd = Buffer.concat(central);
	const cdOff = off;
	const comment = Buffer.from(opts.comment ?? "");
	const disk = opts.diskNumber ?? 0;
	const tail = [];
	if (opts.zip64End) {
		const rec = Buffer.concat([w32(0x06064b50), w64(44), w16(45), w16(45), w32(0), w32(0), w64(entries.length), w64(entries.length), w64(cd.length), w64(cdOff)]);
		const recOff = cdOff + cd.length;
		tail.push(rec, Buffer.concat([w32(0x07064b50), w32(0), w64(recOff), w32(1)]));
		tail.push(Buffer.concat([w32(0x06054b50), w16(disk), w16(0), w16(0xffff), w16(0xffff), w32(0xffffffff), w32(0xffffffff), w16(comment.length), comment]));
	} else {
		tail.push(Buffer.concat([w32(0x06054b50), w16(disk), w16(0), w16(entries.length), w16(entries.length), w32(cd.length), w32(cdOff), w16(comment.length), comment]));
	}
	return new Uint8Array(Buffer.concat([...parts, cd, ...tail]));
}
