/* ══════════════════════════════════════════════════════════
   NAME RULES OF A SHARE, in ONE place (2026-10-07). The exporter and the
   importer used to carry their own sanitising (a regex here, a reserved-name
   test there, a third in `freeNotePath`), and they drifted: an archive the
   app produced could hold a name the importer refused. Both sides now call
   this module, so what is exported is what is accepted.

   Pure: no host, no DOM, no Node. The rules, for a file name received from or
   sent to another machine:
   - Unicode NFC (macOS writes NFD: an `é` would otherwise differ from the
     `é` a note cites);
   - the characters Windows forbids and control characters become "-";
   - leading and trailing dots and spaces are trimmed;
   - a Windows device name is refused by the part BEFORE THE FIRST DOT:
     Windows reserves `CON` for every extension, so `con.txt.md` is as
     unusable as `CON.md`;
   - a base name is capped at `NAME_MAX` characters, a whole target path at
     `PATH_MAX`;
   - two names that differ only by case are the SAME name (NTFS, APFS).
══════════════════════════════════════════════════════════ */

/** Longest base name (without extension) kept; longer ones are cut. */
export const NAME_MAX = 100;
/** Longest full target path an import may write (Windows' 260 minus room for
    the " (n)" suffix, the extension and the long-path prefix). */
export const PATH_MAX = 240;

const FORBIDDEN = /[:*?"<>|\/\u0000-\u001f\u007f]/g;
/* CON PRN AUX NUL COM0-9 LPT0-9, the superscript digits Windows also
   reserves, and the console handles. Tested on the part before the first dot. */
const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/** NFC, forbidden characters to "-", dots and spaces trimmed. Never empty-checks. */
export function cleanName(raw: string): string {
	return raw.normalize("NFC").replace(FORBIDDEN, "-").replace(/^[\s.]+|[\s.]+$/g, "");
}

/** Is this (full or base) file name a Windows device name for any extension? */
export function isReservedName(name: string): boolean {
	const stem = name.normalize("NFC").split(".")[0].replace(/[\s]+$/, "");
	return RESERVED.test(stem);
}

export type NameVerdict =
	| { ok: true; name: string }
	| { ok: false; reason: "empty" | "reserved" };

/** A base name (no extension) as it may be written, cut to `NAME_MAX`, or the
    reason it cannot. */
export function baseNameVerdict(raw: string): NameVerdict {
	let name = cleanName(raw);
	if (name.length > NAME_MAX) name = name.slice(0, NAME_MAX).replace(/[\s.]+$/, "");
	if (name.length === 0) return { ok: false, reason: "empty" };
	if (isReservedName(name)) return { ok: false, reason: "reserved" };
	return { ok: true, name };
}

/** The same, for a name the app itself builds (an export): never refuses. A
    reserved or empty name gets an underscore or the fallback, so the archive
    holds nothing the importer would refuse. */
export function exportBaseName(raw: string, fallback: string): string {
	const v = baseNameVerdict(raw);
	if (v.ok) return v.name;
	if (v.reason === "reserved") {
		// The underscore goes right after the device word: `con.txt` -> `con_.txt`
		// (appended at the end it would still start with `con.`).
		const clean = cleanName(raw);
		const dot = clean.indexOf(".");
		const stem = (dot < 0 ? clean : clean.slice(0, dot)).replace(/\s+$/, "");
		return `${stem}_${dot < 0 ? "" : clean.slice(dot)}`.slice(0, NAME_MAX).replace(/[\s.]+$/, "");
	}
	return fallback;
}

/** Names unique when compared the way a file system does (NFC, case folded):
    the first keeps its name, the next ones get " (2)", " (3)"... before the
    extension. Order-stable. */
export function dedupeNames(names: string[]): string[] {
	const seen = new Set<string>();
	return names.map((name) => {
		const dot = name.lastIndexOf(".");
		const stem = dot > 0 ? name.slice(0, dot) : name;
		const ext = dot > 0 ? name.slice(dot) : "";
		let candidate = name;
		for (let n = 2; seen.has(candidate.normalize("NFC").toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
		seen.add(candidate.normalize("NFC").toLowerCase());
		return candidate;
	});
}

/** Does `parent/name` stay within `PATH_MAX`? */
export function fitsPath(parent: string, name: string): boolean {
	return (parent ? parent.length + 1 : 0) + name.length <= PATH_MAX;
}

/** The folder name for an imported archive, from the archive's FILE name:
    extension and a browser's " (1)" download suffix dropped, the same rules
    as any name, and `Import` when nothing usable is left (`CON.zip`). */
export function folderNameFromArchive(fileName: string): string {
	const stem = fileName.replace(/\.zip$/i, "").replace(/\s*\(\d+\)\s*$/, "");
	const v = baseNameVerdict(stem);
	return v.ok ? v.name : "Import";
}
