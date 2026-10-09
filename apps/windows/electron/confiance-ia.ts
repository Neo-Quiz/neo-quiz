/* ══════════════════════════════════════════════════════════
   TRUSTED FOLDERS FOR THE AI (2026-10-09)

   Claude Code may work INSIDE the folder of a quiz, with read-only tools
   (`gabarits-cli.ts`, `argumentsAvecOutils`), only once the user has trusted
   that folder, as Claude Code itself asks the first time it opens one. The
   decision belongs to the MAIN process:
   - the question is a NATIVE dialog the main process words and shows
     (`canaux.ts`); the window can only ask for it, never answer it;
   - the answer is kept in the main process's settings under a key the
     generic settings write refuses (`CLE_CONFIANCE_IA`, `canaux.ts`);
   - each entry keeps the folder's resolved path (`fs.realpath`), and a run
     is judged on the resolved path of the folder it names: a junction or a
     `..` cannot turn an approved folder into another one.

   A folder covers its sub-folders: the dialog says so.

   No Electron here: `npm run check:electron-reglages` and `check:partage`
   load this module as it is, on real temporary folders.
══════════════════════════════════════════════════════════ */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { normaliser } from "./parcours";

/** The settings key of the trusted folders. Written by the main process only. */
export const CLE_CONFIANCE_IA = "aiTrustedFolders";

/** At most this many folders are kept: a list that grows without end is a list nobody reads. */
export const MAX_DOSSIERS_APPROUVES = 100;

/** One trusted folder. */
export interface DossierApprouve {
	/** The folder as the user saw it in the dialog (resolved, `/` separators). */
	path: string;
	/** Its real path on the disk (`fs.realpath`), what runs are judged on. */
	real: string;
	/** When it was trusted (ISO 8601). */
	at: string;
}

/** The trusted folders a stored value holds. Tolerant on the shape (a
    damaged value is an empty list, never an error), strict on each entry. */
export function lireApprouves(valeur: unknown): DossierApprouve[] {
	if (!Array.isArray(valeur)) return [];
	const out: DossierApprouve[] = [];
	for (const e of valeur) {
		if (!e || typeof e !== "object") continue;
		const { path: p, real, at } = e as Record<string, unknown>;
		if (typeof p !== "string" || typeof real !== "string" || !p.trim() || !real.trim()) continue;
		if (!path.isAbsolute(real)) continue;
		out.push({ path: p, real: normaliser(real), at: typeof at === "string" ? at : "" });
		if (out.length >= MAX_DOSSIERS_APPROUVES) break;
	}
	return out;
}

/** True when `chemin` is `base` or lies under it. Both are resolved paths;
    the comparison ignores case and separators, as Windows does. */
export function estSousDossier(chemin: string, base: string): boolean {
	const c = normaliser(chemin).replace(/\/+$/, "").toLowerCase();
	const b = normaliser(base).replace(/\/+$/, "").toLowerCase();
	if (!c || !b) return false;
	return c === b || c.startsWith(b + "/");
}

/** True when the resolved folder `reel` is covered by a trusted folder. */
export function estApprouve(reel: string, approuves: readonly DossierApprouve[]): boolean {
	return approuves.some(a => estSousDossier(reel, a.real));
}

/**
 * THE RULE A RUN WITH TOOLS MUST PASS, pure. The working directory of the
 * read-only tools form is accepted only when the folder:
 * - resolved on the disk (`reel`, from `dossierCanonique`), and is a folder;
 * - is inside the perimeter of the bridge (the folders the user opened);
 * - is covered by a folder the user trusted through the native dialog.
 * Anything else: `false`, and `canaux.ts` refuses the call.
 */
export function jugerDossierOutils(o: {
	reel: string | null;
	estDossier: boolean;
	dansPerimetre: boolean;
	approuves: readonly DossierApprouve[];
}): boolean {
	if (!o.reel || !o.estDossier || !o.dansPerimetre) return false;
	return estApprouve(o.reel, o.approuves);
}

/** The list with `entree` added (an already covered real path is not added twice). */
export function ajouterApprouve(liste: readonly DossierApprouve[], entree: DossierApprouve): DossierApprouve[] {
	if (liste.some(a => a.real.toLowerCase() === entree.real.toLowerCase())) return [...liste];
	return [...liste, entree].slice(-MAX_DOSSIERS_APPROUVES);
}

/** The list without the folder shown as `chemin` (by its shown or its real path). */
export function retirerApprouve(liste: readonly DossierApprouve[], chemin: string): DossierApprouve[] {
	const c = normaliser(String(chemin || "")).toLowerCase();
	return liste.filter(a => a.path.toLowerCase() !== c && a.real.toLowerCase() !== c);
}

/**
 * A folder named by the window, as the disk knows it: an absolute string,
 * `..` folded, links and junctions followed (`fs.realpath`), and an existing
 * DIRECTORY. `null` for anything else (relative, missing, a file, not a
 * string). Never throws.
 */
export async function dossierCanonique(chemin: unknown): Promise<{ path: string; real: string } | null> {
	if (typeof chemin !== "string" || !chemin.trim() || chemin.includes("\0")) return null;
	if (!path.isAbsolute(chemin)) return null;
	try {
		const resolu = path.resolve(chemin);
		const reel = await fs.realpath(resolu);
		if (!(await fs.stat(reel)).isDirectory()) return null;
		return { path: normaliser(resolu), real: normaliser(reel) };
	} catch {
		return null;
	}
}
