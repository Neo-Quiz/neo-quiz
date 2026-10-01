import { IMAGE_IMPORT_EXTENSIONS, IMAGE_IMPORT_MAX_BYTES, SHARE_MAX_BYTES, ZIP_END_BYTES, buildZipFiles, zipEntryOverhead } from "./zip";
import type { ZipEntry, ZipFile } from "./zip";

/* ══════════════════════════════════════════════════════════
   WHAT A SHARE CARRIES (2026-10-01). A shared folder used to be the quiz
   notes only: every `![[schema.png]]` of a quiz was dead on the receiving
   side. Now the images the quizzes EMBED travel with them, within the same
   16 MB bound as before; what does not fit is left out and COUNTED, so the
   window can say so instead of failing or dropping silently. Course PDFs,
   attachments and everything a quiz does not embed stay out on purpose.
   Pure: `check:partage` exercises it.
══════════════════════════════════════════════════════════ */

/** The targets of the images a note embeds: `![[a.png|200]]`, `![[a.png#x]]`
    and `![alt](a.png)` (web and `data:` sources are not files). */
export function embedTargets(content: string): string[] {
	const out: string[] = [];
	for (const m of content.matchAll(/!\[\[([^\]\n]+?)\]\]/g)) {
		const target = m[1].split("|")[0].split("#")[0].trim();
		if (target) out.push(target);
	}
	for (const m of content.matchAll(/!\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
		const target = m[1].trim().replace(/^<|>$/g, "").split(/\s+"/)[0];
		if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
		try { out.push(decodeURI(target)); } catch { out.push(target); }
	}
	return out;
}

/** Is this file name an image a quiz can embed and a share may carry? */
export function isShareableImage(name: string): boolean {
	const point = name.lastIndexOf(".");
	return point > 0 && IMAGE_IMPORT_EXTENSIONS.includes(name.slice(point + 1).toLowerCase());
}

export interface PackedShare {
	/** The archive, or `null` when the notes ALONE are over the bound. */
	bytes: Uint8Array | null;
	imagesIn: number;
	/** Images left out: over the size bound, too big on their own, or a name already taken. */
	imagesOut: number;
}

/** Packs the notes, then as many images as fit under `limit`, in order. */
export function packShare(notes: ZipEntry[], images: ZipFile[], now: Date, limit = SHARE_MAX_BYTES): PackedShare {
	const encoder = new TextEncoder();
	const files: ZipFile[] = [];
	const names = new Set<string>();
	let size = ZIP_END_BYTES;
	for (const n of notes) {
		const bytes = encoder.encode(n.content);
		size += zipEntryOverhead(n.name) + bytes.length;
		files.push({ name: n.name, bytes });
		names.add(n.name.toLowerCase());
	}
	if (size > limit) return { bytes: null, imagesIn: 0, imagesOut: images.length };
	let imagesIn = 0;
	let imagesOut = 0;
	for (const img of images) {
		const cost = zipEntryOverhead(img.name) + img.bytes.length;
		if (img.bytes.length === 0 || img.bytes.length > IMAGE_IMPORT_MAX_BYTES || names.has(img.name.toLowerCase()) || size + cost > limit) { imagesOut++; continue; }
		size += cost;
		files.push(img);
		names.add(img.name.toLowerCase());
		imagesIn++;
	}
	return { bytes: buildZipFiles(files, now), imagesIn, imagesOut };
}
