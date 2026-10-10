/* ══════════════════════════════════════════════════════════
   THE COLOUR ICON OF A FILE, by its extension — pure, no DOM

   The "@" picker shows VS Code's file icons (Material Icon Theme, MIT,
   embedded by src/file-icons.ts). The Lucide table of file-icons.ts stays
   the rule for every other surface; this module only maps an extension to
   a key of FILE_ICONS. Unknown extensions fall back to `document`, which
   is the theme's plain-text icon (the theme has no generic "file" icon in
   the set we embed).
══════════════════════════════════════════════════════════ */

import { FILE_ICONS } from "../file-icons";

/** Extension (lower case, no dot) → key of FILE_ICONS. */
const KEY_BY_EXTENSION: Readonly<Record<string, string>> = {
	md: "markdown",
	pdf: "pdf",
	txt: "document",
	doc: "word", docx: "word", odt: "word", rtf: "word",
	ppt: "powerpoint", pptx: "powerpoint", odp: "powerpoint",
	xls: "table", xlsx: "table", ods: "table", csv: "table",
	png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", bmp: "image",
	mp4: "video", webm: "video", mkv: "video", mov: "video", avi: "video",
	mp3: "audio", wav: "audio", m4a: "audio", ogg: "audio", flac: "audio",
	zip: "zip", "7z": "zip", rar: "zip", tar: "zip", gz: "zip",
	py: "python", c: "c", h: "c", cpp: "cpp", java: "java",
	html: "html", css: "css", json: "json", xml: "xml", yaml: "yaml", yml: "yaml",
	ps1: "powershell",
};

const FALLBACK_KEY = "document";

/** The key of the icon of a file, by its name (extension decides). */
function keyOfFile(name: string): string {
	const point = name.lastIndexOf(".");
	const ext = point > 0 ? name.slice(point + 1).toLowerCase() : "";
	return KEY_BY_EXTENSION[ext] ?? FALLBACK_KEY;
}

/** Data URI of the colour icon of a file (for an <img src>). */
export function fileIconSvg(name: string): string {
	return FILE_ICONS[keyOfFile(name)] ?? FILE_ICONS[FALLBACK_KEY] ?? "";
}

/** Data URI of the colour icon of a closed folder. */
export function folderIconSvg(): string {
	return FILE_ICONS["folder-base"] ?? "";
}
