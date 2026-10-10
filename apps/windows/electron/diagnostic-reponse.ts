import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/* ══════════════════════════════════════════════════════════
   THE RAW ANSWER OF A MODEL THAT WAS NOT A QUIZ (2026-10-10).

   A 30-minute generation failed on "JSON5: invalid character 'R' at 1:1",
   and nothing was left to tell why: the answer was gone. When an answer
   cannot be read, the page sends it here and it is written, as TEXT, to the
   app's `logs` folder (`app.getPath("logs")`, given by `canaux.ts`).

   What a compromised window can do with this channel is bounded: the MAIN
   process names the file (a timestamp, `.txt`), the content is cut at 2 MB,
   only the last ten files are kept, and nothing ever runs or opens one.
══════════════════════════════════════════════════════════ */

/** The most bytes written for one answer. */
export const DIAGNOSTIC_MAX_OCTETS = 2 * 1024 * 1024;
/** How many diagnostic files are kept (the oldest go first). */
export const DIAGNOSTICS_GARDES = 10;
const PREFIXE = "ai-response-";
const FORME = /^ai-response-\d{8}-\d{6}-\d{3}(?:-\d+)?\.txt$/;

/** The file name for `instant`: `ai-response-YYYYMMDD-HHMMSS-mmm.txt`, local time. */
export function nomDiagnostic(instant: number): string {
	const d = new Date(instant);
	const n = (v: number, l = 2): string => String(v).padStart(l, "0");
	return PREFIXE + n(d.getFullYear(), 4) + n(d.getMonth() + 1) + n(d.getDate()) + "-" + n(d.getHours()) + n(d.getMinutes()) + n(d.getSeconds()) + "-" + n(d.getMilliseconds(), 3) + ".txt";
}

/** The bytes written for `texte`: UTF-8, cut at `DIAGNOSTIC_MAX_OCTETS`. */
export function octetsDiagnostic(texte: string): Buffer {
	const brut = Buffer.from(texte, "utf8");
	return brut.length > DIAGNOSTIC_MAX_OCTETS ? brut.subarray(0, DIAGNOSTIC_MAX_OCTETS) : brut;
}

/** Writes `texte` to a new diagnostic file of `dossier`, then keeps only the
    last `DIAGNOSTICS_GARDES`. Returns the path written, or `null` when the
    input is not a non-empty string or the write failed (never throws: a
    diagnostic must not turn into a second error). */
export async function ecrireDiagnostic(dossier: string, texte: unknown, instant = Date.now()): Promise<string | null> {
	if (typeof texte !== "string" || texte.length === 0) return null;
	try {
		await mkdir(dossier, { recursive: true });
		let nom = nomDiagnostic(instant);
		const existants = new Set(await readdir(dossier));
		for (let i = 2; existants.has(nom); i++) nom = nomDiagnostic(instant).replace(/\.txt$/, "-" + i + ".txt");
		const chemin = join(dossier, nom);
		await writeFile(chemin, octetsDiagnostic(texte), { flag: "wx" });
		const miens = (await readdir(dossier)).filter(f => FORME.test(f)).sort();
		for (const vieux of miens.slice(0, Math.max(0, miens.length - DIAGNOSTICS_GARDES))) {
			await rm(join(dossier, vieux), { force: true });
		}
		return chemin;
	} catch (e) {
		return null;
	}
}
