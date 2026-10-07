/* File and folder names of the Moodle sync (pure). Ported from the owner's
   Obsidian plugin "moodle-sync" (engine.js + main.js v2.3.0), plus the
   Windows hardening a name coming from a remote server needs. */

import * as path from "node:path";

/** NFC first: Moodle sometimes serves NFD names, which would create
    invisible duplicates. Path separators and Windows-forbidden characters
    become "-". */
export function sanitize(name: string): string {
	return String(name).normalize("NFC").replace(/[<>:"/\|?*\x00-\x1f]/g, "-").replace(/\s+/g, " ").trim();
}

const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** A name that is safe as ONE path segment on Windows: no separators (so no
    `..` traversal), never "." or "..", no trailing dot or space (Windows drops
    them silently), no reserved device name, never empty. */
export function safeSegment(name: string, max = 120): string {
	let s = sanitize(name).replace(/[. ]+$/, "").replace(/^\.+/, "");
	if (s.length > max) s = s.slice(0, max).replace(/[. ]+$/, "");
	if (!s) return "_";
	if (RESERVED.test(s.split(".")[0])) s = "_" + s;
	return s;
}

export function decodeEntities(s: unknown): string {
	// &amp; last: "&amp;lt;" must give "&lt;", not "<".
	return String(s ?? "").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
		.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

const MAX_STEM = 110;   // the full path must stay far from Windows' 260 characters

/** Moodle name -> { seance, stem }: no module code, no "Etudiant", no "_".
    "XTI302-CYB-Seance2_TP_Socle_Etudiant.pdf" -> { seance: 2, stem: "TP Socle" }. */
export function cleanName(name: string): { seance: number | null; stem: string } {
	const ext = path.extname(name);
	let stem = path.basename(name, ext);
	stem = stem.replace(/^[A-Z]{2,5}-?\d{3}(?:-[A-Z]{2,5})?\s*-?\s*/, "");
	let seance: number | null = null;
	stem = stem.replace(/(?:^|[\s_-]+)s[eé]ance[\s_]*(\d+)(?=$|[\s_-])/i, (_m, n: string) => {
		seance = Number(n);
		return " ";
	});
	stem = stem
		.replace(/(?:^|[\s_-]+)(?:version[\s_]+)?[eé]tudiant(?:e|es|s)?(?=$|[\s_-])/gi, " ")
		.replace(/[\s_-]+v\d+$/i, "")
		.replace(/_/g, " ")
		.replace(/\s+-\s+$|^\s*-\s+/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return { seance, stem: stem || path.basename(name, ext) };
}

/** Largest-font lines of page 1 -> title, or null when unreliable. Kept for a
    future PDF title extraction (pdf.js is not available in the main process,
    so `prettyName` is called without a title for now). */
export function pickTitle(lines: readonly string[], course: { name?: string } = {}): string | null {
	let t = "";
	for (const raw of lines || []) {
		const l = String(raw).replace(/\s+/g, " ").trim();
		if (!l) continue;
		// A line starting in lower case continues a long title, it is no subtitle.
		t = !t ? l : /[-—–:]$/.test(t) || /^[-—–:]/.test(l) || /^\p{Ll}/u.test(l) ? `${t} ${l}` : `${t} - ${l}`;
	}
	t = t.normalize("NFC").replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
	if (t.length < 6 || t.length > MAX_STEM) return null;
	if (/[:]$/.test(t) || /intitulé du cours/i.test(t)) return null;
	// A part title ("Partie 1 - …", "I - …", "1. …") is not the document's title.
	if (/^(?:partie\s*\d|[IVX]+\s*[-.–—]\s|\d+[.)]\s)/i.test(t)) return null;
	if (/\b[A-Z]{2,5}-?\d{3}\b/.test(t)) return null;
	// A title made of the module's own words is a cover page common to all lectures.
	const norm = (x: string): string => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
	const courseWords = new Set(norm(String(course.name || "").replace(/^\S+\s*-\s*/, "")).match(/[a-z0-9]{3,}/g) || []);
	const titleWords = norm(t).match(/[a-z0-9]{3,}/g) || [];
	if (courseWords.size && titleWords.length
		&& titleWords.filter(w => courseWords.has(w)).length / titleWords.length >= 0.75) return null;
	if (/\p{L}\d\p{L}/u.test(t)) return null;
	const words = t.split(" ").filter(w => /\p{L}/u.test(w));
	const tiny = words.filter(w => w.length <= 2 && !/^(?:TP|TD|CM|IA|à|a|de|du|le|la|et|en|un|l'|d')$/i.test(w));
	if (!words.length || tiny.length / words.length > 0.25) return null;
	return t;
}

/** Final name: "Séance 2 - TP Socle - Écrire ses premiers scripts shell.pdf".
    Always a safe single path segment. */
export function prettyName(name: string, title: string | null = null): string {
	const ext = path.extname(name);
	const { seance, stem } = cleanName(name);
	let base = title || stem;
	// "TP4.pdf" + "Partie 1 - NumPy": the short reference of the Moodle name stays first.
	const ref = /^(?:TP|TD|CM|DM|QCM)\s*\d+$/i.test(stem) ? stem : null;
	const squash = (x: string): string => x.replace(/\s+/g, "").toLowerCase();
	if (title && ref && !squash(title).includes(squash(ref))) base = `${ref} - ${title}`;
	if (seance != null && !/s[eé]ance\s*\d/i.test(base)) base = `Séance ${seance} - ${base}`;
	base = sanitize(base).replace(/[. ]+$/, "");
	if (base.length > MAX_STEM) base = base.slice(0, MAX_STEM).replace(/[\s-]+\S*$/, "");
	return safeSegment(`${base}${ext.toLowerCase()}`, 140);
}

/** The folder a course gets when none starts with its code:
    "XTI302 - Administration système avancées & Scripting". */
export function newFolderName(code: string, courseName: string): string {
	const title = courseName.replace(/^\S+\s*-\s*/, "").trim();
	return safeSegment(title ? `${code} - ${title}` : code, 80);
}
