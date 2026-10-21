/* ══════════════════════════════════════════════════════════
   THE ZIP READER of the main process (task 1 of
   docs/superpowers/plans/2026-10-22-native-python-run.md)

   Unpacks the CPython embeddable zip and the PyPI wheels: deflated zips
   that came over the network. Their SHA-256 is pinned before they get
   here, but this reader is written as if they were hostile, so a wrong
   pin (or a pin taken on a bad file) still cannot write outside its folder
   or fill the disk. `src/dashboard/zip.ts`'s reader is the renderer's
   (async `DecompressionStream`, share archives, skips what it cannot
   read); this one is Node `zlib`, and refuses the WHOLE archive at the
   first doubt: an install is all or nothing.

   TWO WAYS IN. `extraireZip` is the installer's: it validates the whole
   central directory and every name against the destination first, then
   inflates and writes ONE entry at a time, yielding to the event loop
   between entries, so a torch wheel (about 124 MB compressed, 400 MB
   inflated) costs the input plus one entry, never the whole archive in
   memory, and never blocks the main process for seconds. `lireZip` +
   `ecrireSous` hold every entry at once: small archives and the check.
   Both share the same parsing (`analyserZip`) and the same inflate
   (`inflerFiche`).

   THE CENTRAL DIRECTORY IS THE TRUTH. Names, sizes, CRCs and methods are
   read from it; a local header is only used to find where the data starts,
   and must agree with it (same name, same method). Every bound is judged on
   the DECLARED sizes before a single byte is inflated, and the inflate is
   then capped at the declared size plus one byte: a stream that inflates to
   anything but its declared size is refused, so the bounds cannot be lied
   past.

   REFUSED, with an `ErreurZip` code:
   - "abime": not a zip, truncated, a wrong CRC, a size that lies, a method
     other than stored (0) or deflate (8), an encrypted entry, zip64,
     several disks, a local header that disagrees, bytes where none belong;
   - "nom": a name `nomEntreeAdmis` (langages.ts) refuses (`..`, drive,
     leading `/`, backslash, empty segment), or that Windows would read as
     another name or a device: `: * ? " < > |`, a control character, a
     segment ending in a dot or a space (Windows drops them, so `a./x` is
     `a/x`), a device name (`con.py`, `aux`, `nul.txt`), a non-ASCII name
     without the UTF-8 flag (a code page we would have to guess), bad UTF-8,
     a symbolic link (Unix mode `0xA000` in the external attributes: its
     content would be written as a plain file, never followed, but no wheel
     or interpreter zip carries one, so it is refused rather than reshaped);
   - "bombe": more entries than `maxEntrees`, a declared total over
     `maxOctets`, an entry whose inflated/compressed ratio exceeds
     `maxRatio`, entries whose data overlap (one stream counted many times).
     The ratio bound is PER ENTRY, with no size threshold: native libraries
     padded with zeros do exist in real wheels, so a caller chooses
     `maxRatio` knowing that a legitimate entry can compress far better than
     source code, and lets `maxOctets` carry the real bound on disk use;
   - "doublon": two names the case-insensitive Windows filesystem sees as
     one file, or a file that is also a folder (`a` and `a/b`).
   Directory entries (`pkg/`) are checked like the rest, then dropped: the
   folders are created from the file names.
   ══════════════════════════════════════════════════════════ */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { setImmediate as tour } from "node:timers/promises";
import { crc32, inflateRawSync } from "node:zlib";
import { isReservedName } from "../../../../src/dashboard/share-names";
import { nomEntreeAdmis } from "../langages";

export interface EntreeZip { nom: string; octets: Uint8Array }
export interface BornesZip { maxEntrees: number; maxOctets: number; maxRatio: number }
export type CodeErreurZip = "abime" | "nom" | "bombe" | "doublon";

export class ErreurZip extends Error {
	readonly code: CodeErreurZip;
	constructor(code: CodeErreurZip, message: string) {
		super(message);
		this.name = "ErreurZip";
		this.code = code;
	}
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_FIN = 0x06054b50;
const SIG_LOCALISATEUR_ZIP64 = 0x07064b50;
const TAILLE_FIN = 22;
const TAILLE_CENTRAL = 46;
const TAILLE_LOCAL = 30;
/* Bit 0 encrypted, bit 6 strong encryption, bit 13 encrypted central directory. */
const DRAPEAUX_CHIFFRES = 0x0001 | 0x0040 | 0x2000;
const DRAPEAU_UTF8 = 0x0800;

/* Characters a Windows file name cannot hold (`\` and NUL are refused by
   `nomEntreeAdmis` already): `:` would also open an NTFS stream (`a:b`). */
const INTERDITS_WINDOWS = /[:*?"<>|\u0000-\u001f\u007f]/;

/** The name rule, `nomEntreeAdmis` then Windows' own reading of a name.
    `null` when refused. */
function nomAdmis(nom: string): string | null {
	const admis = nomEntreeAdmis(nom);
	if (!admis || INTERDITS_WINDOWS.test(admis)) return null;
	for (const segment of admis.split("/")) {
		if (/[. ]$/.test(segment) || isReservedName(segment)) return null;
	}
	return admis;
}

/** Folded so two names NTFS treats as one compare equal. Upper then lower
    catches more pairs than either alone (`ſ`/`s`); a pair NTFS would keep
    apart and this folds together is refused, which is the safe side. */
const cle = (nom: string): string => nom.toUpperCase().toLowerCase();

/** Throws "nom" for a refused name and "doublon" for two names that are
    one file on Windows, or a file that is also a folder. `noms` are file
    names; `dossiers` the names of explicit directory entries (no slash). */
function verifierNoms(noms: string[], dossiers: string[] = []): void {
	const fichiers = new Set<string>();
	const parents = new Set<string>();
	for (const nom of [...noms, ...dossiers]) {
		if (nomAdmis(nom) === null) throw new ErreurZip("nom", "unsafe entry name: " + JSON.stringify(nom));
	}
	for (const nom of noms) {
		const k = cle(nom);
		if (fichiers.has(k)) throw new ErreurZip("doublon", "two entries are one file on Windows: " + JSON.stringify(nom));
		fichiers.add(k);
		const segments = k.split("/");
		for (let i = 1; i < segments.length; i++) parents.add(segments.slice(0, i).join("/"));
	}
	for (const d of dossiers) {
		const segments = cle(d).split("/");
		for (let i = 1; i <= segments.length; i++) parents.add(segments.slice(0, i).join("/"));
	}
	for (const p of parents) {
		if (fichiers.has(p)) throw new ErreurZip("doublon", "an entry is both a file and a folder: " + JSON.stringify(p));
	}
}

const abime = (message: string): ErreurZip => new ErreurZip("abime", message);

interface Fiche {
	nom: string; nomOctets: Uint8Array; dossier: boolean;
	methode: number; crc: number; compresse: number; decompresse: number; local: number;
	/** Where the entry's data starts and ends, set from its local header. */
	donnees: number; finDonnees: number;
}

/** Reads the name bytes of a central record: UTF-8 under flag 11, plain
    ASCII otherwise (anything else is a code page we would have to guess). */
function lireNom(octets: Uint8Array, drapeaux: number): string {
	if (!(drapeaux & DRAPEAU_UTF8) && octets.some((b) => b > 0x7e)) throw new ErreurZip("nom", "non-ASCII entry name without the UTF-8 flag");
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(octets);
	} catch {
		throw new ErreurZip("nom", "entry name is not valid UTF-8");
	}
}

/** Every check that needs no inflate: the end record, each central record,
    every name, duplicates, the bounds on the declared sizes, the local
    headers and overlaps. Returns the records, directories included, in
    central-directory order, each with its data range. */
function analyserZip(octets: Uint8Array, bornes: BornesZip): Fiche[] {
	for (const [cleBorne, v] of Object.entries(bornes)) {
		if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error("invalid zip bound " + cleBorne + ": " + String(v));
	}
	const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
	const n = octets.byteLength;

	/* The end record: the LAST signature whose comment ends exactly at the end. */
	let fin = -1;
	for (let p = n - TAILLE_FIN; p >= 0 && p >= n - TAILLE_FIN - 0xffff; p--) {
		if (vue.getUint32(p, true) === SIG_FIN && p + TAILLE_FIN + vue.getUint16(p + 20, true) === n) { fin = p; break; }
	}
	if (fin < 0) throw abime("no end of central directory record (not a zip, or truncated)");
	if (fin >= 20 && vue.getUint32(fin - 20, true) === SIG_LOCALISATEUR_ZIP64) throw abime("zip64 is not supported");
	const disque = vue.getUint16(fin + 4, true);
	const disqueCentral = vue.getUint16(fin + 6, true);
	const surDisque = vue.getUint16(fin + 8, true);
	const total = vue.getUint16(fin + 10, true);
	const tailleCentral = vue.getUint32(fin + 12, true);
	const debutCentral = vue.getUint32(fin + 16, true);
	if (total === 0xffff || tailleCentral === 0xffffffff || debutCentral === 0xffffffff) throw abime("zip64 is not supported");
	if (disque !== 0 || disqueCentral !== 0 || surDisque !== total) throw abime("multi-disk archives are not supported");
	if (total > bornes.maxEntrees) throw new ErreurZip("bombe", total + " entries, over the bound of " + bornes.maxEntrees);
	if (debutCentral + tailleCentral !== fin) throw abime("the central directory does not end where its end record starts");

	/* The central directory, walked within its declared bytes. */
	const fiches: Fiche[] = [];
	let p = debutCentral;
	for (let i = 0; i < total; i++) {
		if (p + TAILLE_CENTRAL > fin || vue.getUint32(p, true) !== SIG_CENTRAL) throw abime("central directory record " + i + " is missing");
		const drapeaux = vue.getUint16(p + 8, true);
		const methode = vue.getUint16(p + 10, true);
		const crc = vue.getUint32(p + 16, true);
		const compresse = vue.getUint32(p + 20, true);
		const decompresse = vue.getUint32(p + 24, true);
		const longueurNom = vue.getUint16(p + 28, true);
		const longueurExtra = vue.getUint16(p + 30, true);
		const longueurCommentaire = vue.getUint16(p + 32, true);
		const disqueDebut = vue.getUint16(p + 34, true);
		const attributs = vue.getUint32(p + 38, true);
		const local = vue.getUint32(p + 42, true);
		const suivant = p + TAILLE_CENTRAL + longueurNom + longueurExtra + longueurCommentaire;
		if (suivant > fin) throw abime("central directory record " + i + " runs past the directory");
		if (compresse === 0xffffffff || decompresse === 0xffffffff || local === 0xffffffff || disqueDebut === 0xffff) throw abime("zip64 is not supported");
		if (disqueDebut !== 0) throw abime("multi-disk archives are not supported");
		if (drapeaux & DRAPEAUX_CHIFFRES) throw abime("encrypted entries are not supported");
		if (methode !== 0 && methode !== 8) throw abime("compression method " + methode + " is not supported");
		const nomOctets = octets.subarray(p + TAILLE_CENTRAL, p + TAILLE_CENTRAL + longueurNom);
		const brut = lireNom(nomOctets, drapeaux);
		const dossier = brut.endsWith("/");
		const nom = dossier ? brut.slice(0, -1) : brut;
		if (nomAdmis(nom) === null) throw new ErreurZip("nom", "unsafe entry name: " + JSON.stringify(brut));
		if (((attributs >>> 16) & 0xf000) === 0xa000) throw new ErreurZip("nom", "symbolic link entry: " + JSON.stringify(brut));
		fiches.push({ nom, nomOctets, dossier, methode, crc, compresse, decompresse, local, donnees: 0, finDonnees: 0 });
		p = suivant;
	}
	if (p !== fin) throw abime("bytes between the central directory and its end record");

	verifierNoms(fiches.filter((f) => !f.dossier).map((f) => f.nom), fiches.filter((f) => f.dossier).map((f) => f.nom));

	/* The bounds, on the DECLARED sizes, before anything is inflated. */
	let somme = 0;
	for (const f of fiches) {
		if (f.dossier && f.decompresse !== 0) throw abime("directory entry " + JSON.stringify(f.nom) + " has content");
		if (f.methode === 0 && f.compresse !== f.decompresse) throw abime("stored entry " + JSON.stringify(f.nom) + " has two sizes");
		if (f.compresse === 0 && f.decompresse !== 0) throw abime("entry " + JSON.stringify(f.nom) + " inflates from nothing");
		if (f.decompresse > f.compresse * bornes.maxRatio) throw new ErreurZip("bombe", "entry " + JSON.stringify(f.nom) + " exceeds the compression ratio bound");
		somme += f.decompresse;
		if (somme > bornes.maxOctets) throw new ErreurZip("bombe", "the archive inflates past the bound of " + bornes.maxOctets + " bytes");
	}

	/* Local headers: where each entry's data lies; no two may overlap. */
	for (const f of fiches) {
		if (f.local + TAILLE_LOCAL > debutCentral || vue.getUint32(f.local, true) !== SIG_LOCAL) throw abime("local header of " + JSON.stringify(f.nom) + " is missing");
		if (vue.getUint16(f.local + 8, true) !== f.methode) throw abime("local header of " + JSON.stringify(f.nom) + " names another method");
		const longueurNom = vue.getUint16(f.local + 26, true);
		const debut = f.local + TAILLE_LOCAL + longueurNom + vue.getUint16(f.local + 28, true);
		const nomLocal = octets.subarray(f.local + TAILLE_LOCAL, f.local + TAILLE_LOCAL + longueurNom);
		if (nomLocal.length !== f.nomOctets.length || nomLocal.some((b, i) => b !== f.nomOctets[i])) throw abime("local header of " + JSON.stringify(f.nom) + " names another file");
		const finDonnees = debut + f.compresse;
		if (finDonnees > debutCentral) throw abime("data of " + JSON.stringify(f.nom) + " runs into the central directory");
		f.donnees = debut;
		f.finDonnees = finDonnees;
	}
	const triees = [...fiches].sort((a, b) => a.local - b.local);
	for (let i = 1; i < triees.length; i++) {
		if (triees[i].local < triees[i - 1].finDonnees) throw new ErreurZip("bombe", "two entries share their data");
	}
	return fiches;
}

/** One entry's content, inflated capped at the declared size + 1 (longer
    or shorter is a lie), then its CRC-32 checked. A stored entry is a view
    of `octets`; `lireZip` copies it out so its result never pins the
    whole archive. */
function inflerFiche(octets: Uint8Array, f: Fiche): Uint8Array {
	const brut = octets.subarray(f.donnees, f.finDonnees);
	let contenu: Uint8Array;
	if (f.methode === 0) contenu = brut;
	else {
		try {
			contenu = inflateRawSync(brut, { maxOutputLength: f.decompresse + 1 });
		} catch {
			throw abime("entry " + JSON.stringify(f.nom) + " does not inflate to its declared size");
		}
	}
	if (contenu.length !== f.decompresse) throw abime("entry " + JSON.stringify(f.nom) + " does not inflate to its declared size");
	if ((crc32(contenu) >>> 0) !== f.crc) throw abime("entry " + JSON.stringify(f.nom) + " has a wrong CRC-32");
	return contenu;
}

/**
 * Reads every file entry of `octets`, in central-directory order, each one
 * inflated and checked against its declared size and CRC-32. Throws
 * `ErreurZip` (see the header for each code); never returns part of an
 * archive. Holds every entry at once: for a large archive, `extraireZip`.
 */
export function lireZip(octets: Uint8Array, bornes: BornesZip): EntreeZip[] {
	const fiches = analyserZip(octets, bornes);
	/* Directories are inflated too: their CRC and size are checked like the rest. */
	const contenus = fiches.map((f) => inflerFiche(octets, f));
	const entrees: EntreeZip[] = [];
	fiches.forEach((f, i) => {
		if (!f.dossier) entrees.push({ nom: f.nom, octets: f.methode === 0 ? new Uint8Array(contenus[i]) : contenus[i] });
	});
	return entrees;
}

/** The absolute target of each name under `dest`: every name checked by
    the same rules as `lireZip` (duplicates included), then the resolved
    path re-checked to fall under `dest` (a second, independent gate that
    would still catch a bug in the first). Throws before returning anything. */
function ciblesSous(dest: string, noms: string[]): string[] {
	const destAbs = resolve(dest);
	verifierNoms(noms);
	return noms.map((nom) => {
		const cible = resolve(destAbs, ...nom.split("/"));
		if (!cible.startsWith(destAbs + sep)) throw new ErreurZip("nom", "entry escapes its folder: " + JSON.stringify(nom));
		return cible;
	});
}

/**
 * Unpacks `octets` under `dest` one entry at a time, and returns the
 * relative names written, in order. EVERYTHING that needs no inflate is
 * checked first (`analyserZip` and `ciblesSous`): an archive with one
 * hostile name, a duplicate or a bound exceeded anywhere in it writes
 * nothing at all. Then each entry is inflated, checked (size, CRC-32),
 * written with `wx` (an existing file is never overwritten) and dropped
 * before the next, with a turn of the event loop between entries: peak
 * memory is the input plus one entry.
 *
 * A failure found only at inflate time (a wrong CRC, a stream that lies
 * about its size) or a write error THROWS AFTER EARLIER ENTRIES WERE
 * WRITTEN: the caller extracts into a fresh staging folder and must remove
 * it on any rejection; this function never deletes anything.
 */
export async function extraireZip(octets: Uint8Array, dest: string, bornes: BornesZip): Promise<string[]> {
	const fiches = analyserZip(octets, bornes);
	const fichiers = fiches.filter((f) => !f.dossier);
	const cibles = ciblesSous(dest, fichiers.map((f) => f.nom));
	/* Directory entries carry no bytes, but their size and CRC are still checked. */
	for (const f of fiches) if (f.dossier) inflerFiche(octets, f);
	const ecrits: string[] = [];
	for (let i = 0; i < fichiers.length; i++) {
		const contenu = inflerFiche(octets, fichiers[i]);
		await mkdir(dirname(cibles[i]), { recursive: true });
		await writeFile(cibles[i], contenu, { flag: "wx" });
		ecrits.push(fichiers[i].nom);
		await tour();
	}
	return ecrits;
}

/**
 * Writes `entrees` under `dest`. EVERY name is checked first — the same
 * rules as `lireZip`, then the resolved path re-checked to fall under `dest`
 * (a second, independent gate that would still catch a bug in the first) —
 * and only then is anything written: a list holding one hostile name
 * writes nothing. Files are created with `wx`: an existing file is never
 * overwritten (the caller writes into a fresh staging folder).
 */
export async function ecrireSous(dest: string, entrees: EntreeZip[]): Promise<void> {
	const cibles = ciblesSous(dest, entrees.map((e) => e.nom));
	for (let i = 0; i < entrees.length; i++) {
		await mkdir(dirname(cibles[i]), { recursive: true });
		await writeFile(cibles[i], entrees[i].octets, { flag: "wx" });
	}
}
