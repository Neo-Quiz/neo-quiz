/* ══════════════════════════════════════════════════════════
   THE PYTHON INSTALLER of the main process (task 3 of
   docs/superpowers/plans/2026-10-22-native-python-run.md)

   Downloads the pinned CPython embeddable zip and the pinned wheels
   (`catalogue.ts`) and lays them out under `userData/python`:

     interpreteur/                 the embeddable zip, unpacked
     interpreteur/python312._pth   rewritten after every install/uninstall
     libs/<package>-<version>/     one wheel each

   THE PINS DECIDE, the network does not: every file is fetched through
   `demander` (https only, every redirect hop re-judged against the host
   list), streamed into a buffer of exactly its pinned size, refused past
   that size, and refused when its SHA-256 differs from the pin, before a
   single byte is unpacked. One file is held at a time: every download goes
   through ONE queue, so a torch wheel (124 MB) never shares memory with
   another.

   EVERY UNPACK goes to `<final>.part` (zip-lecture.ts's `extraireZip`, which
   distrusts every name), then becomes `<final>` by one rename; a failure at
   any step removes the `.part`. A folder that exists under its final name
   is therefore complete, and "installed" is read from the disk alone:
   `libs/<package>-<version>/` for a library, `interpreteur/` plus a marker
   carrying the pin's SHA-256 for the interpreter (a new pin replaces it).

   A WHEEL's `<name>.data/purelib/` and `platlib/` are merged at its root
   (they are what pip would put in site-packages); `scripts/`, `headers/`
   and `data/` are dropped: nothing here runs a package's scripts.

   THE `_pth` FILE is the interpreter's whole `sys.path`: `python312.zip`,
   `.`, then one absolute line per installed library folder, and no
   `import site` (no user site-packages, no `.pth` hooks of a package). It
   is rewritten from the disk after every change, and also whenever a task
   finds its work already done (which heals a crash between a rename and
   the `_pth` write). An uninstall renames the folder aside to `.suppr`
   BEFORE the `_pth` stops naming it, and puts it back if the `_pth` write
   fails: a folder still in use by a running `python.exe` (a loaded `.pyd`
   is locked on Windows) cannot be renamed, so the uninstall fails with
   nothing changed.

   ORDER. Installs and uninstalls run in one queue, each queued at the
   moment it is asked, and each re-reads the disk when its turn comes. Two
   installs of the same package share one queued download (a map of
   promises); a library whose dependency or interpreter is missing when its
   turn comes (the dependency's download failed) is refused rather than
   installed broken; and an uninstall asked while a dependent is being
   installed waits for it, then sees it and is refused.
   ══════════════════════════════════════════════════════════ */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LOG_PREFIX } from "../../../../src/branding";
import { demander, transportDefaut } from "../telechargement";
import type { CodeInstallation, TransportInstallation } from "../telechargement";
import { INTERPRETE, PAQUETS, fermeture } from "./catalogue";
import { ErreurZip, extraireZip } from "./zip-lecture";
import type { BornesZip } from "./zip-lecture";

/** The codes of a Python install error, each a different message for the
    user:
    - `reseau`: unreachable, a redirect to `http:` or off the host list, an
      HTTP error, a response without a body stream;
    - `empreinte`: bytes that do not match their pin, or an archive refused;
    - `io`: the disk refused (ENOSPC, EBUSY, EPERM, EACCES…);
    - `absent`: the interpreter or a dependency is missing when a library's
      turn comes (its own install failed first, or its folder was removed);
    - `occupe`: a folder to remove is in use (a running `python.exe` holds
      one of its files); nothing was changed. */
export type CodePython = CodeInstallation | "io" | "absent" | "occupe";

export interface ErreurPython extends Error {
	code: CodePython;
	detail?: string;
}

/** Same shape as `telechargement.ts`'s `erreurInstallation`, so a `reseau`
    or `empreinte` from here reads like one from the other installers. */
export function erreurPython(code: CodePython, detail?: string): ErreurPython {
	const e = new Error("python install: " + code + (detail ? " — " + detail : "")) as ErreurPython;
	e.name = code;
	e.code = code;
	if (detail) e.detail = detail;
	return e;
}

const CODES_PYTHON: ReadonlySet<string> = new Set(["reseau", "empreinte", "io", "absent", "occupe"]);
export function estErreurPython(e: unknown): e is ErreurPython {
	const o = e as { code?: unknown } | null;
	return !!o && typeof o.code === "string" && CODES_PYTHON.has(o.code);
}

/** Node's errno codes that mean the DISK refused, not the network. */
const CODES_DISQUE: ReadonlySet<string> = new Set(["ENOSPC", "EDQUOT", "EBUSY", "EPERM", "EACCES", "EROFS", "EIO", "EMFILE", "ENFILE", "ENOENT", "EEXIST", "ENOTEMPTY", "ENOTDIR", "EISDIR", "EXDEV"]);
/** The ones a rename of a folder in use answers on Windows. */
const CODES_OCCUPE: ReadonlySet<string> = new Set(["EBUSY", "EPERM", "EACCES"]);
const codeSysteme = (e: unknown): string => {
	const c = (e as { code?: unknown } | null)?.code;
	return typeof c === "string" ? c : "";
};

/** A pinned file: where it is, and the only bytes accepted from there. */
export interface FichierEpingle { version: string; url: string; sha256: string; taille: number }

/** What the installer trusts. The app always passes the real one
    (`PAQUETS`, `INTERPRETE`); the check passes a fake one. */
export interface CataloguePython {
	interprete: FichierEpingle;
	paquets: Record<string, FichierEpingle & { dependances: readonly string[] }>;
}

/** The two disk writes the check makes fail (a folder in use, a full
    disk). The app passes nothing. */
export interface DisquePython {
	renommer(de: string, vers: string): void;
	ecrire(chemin: string, texte: string): void;
}
const DISQUE_REEL: DisquePython = { renommer: renameSync, ecrire: (chemin, texte) => writeFileSync(chemin, texte, "utf8") };

export interface EtatPython {
	interprete: boolean;
	version: string | null;
	/** Installed libraries, by name; `requisPar` the installed libraries
	    whose closure includes it (an uninstall of it is refused). */
	paquets: { nom: string; version: string; octets: number; requisPar: string[] }[];
	/** Bytes on disk of the interpreter folder plus every library folder. */
	octetsTotal: number;
}

export interface InstallationPython {
	etat(): Promise<EtatPython>;
	/** Installs the interpreter if absent, then the closure of `cibles`
	    (root package names; `[]` = the interpreter only) minus what is
	    installed. Rejects `ErreurPython` (`reseau`, `empreinte`, `io`,
	    `absent`); an unknown name throws a plain `Error` before anything is
	    downloaded. */
	installer(cibles: string[], progression: (recus: number, total: number) => void): Promise<void>;
	/** `{ ok: false, requisPar }` when an installed library needs it.
	    Rejects `ErreurPython` `occupe` (its folder is in use) or `io`, with
	    the folder still installed and the `_pth` unchanged. */
	desinstaller(paquet: string): Promise<{ ok: true } | { ok: false; requisPar: string[] }>;
	/** Every library (dependents first), then the interpreter. Stops at the
	    first folder that cannot be removed: what is left is still a
	    consistent install. */
	supprimerTout(): Promise<{ ok: true } | { ok: false; code: "occupe" | "io" }>;
	/** `executable` is `python.exe`; `dossier` the interpreter folder. */
	chemins(): { executable: string; dossier: string };
}

/* Bounds of the unpack, measured on the real pins (2026-10-22): the
   embeddable zip has 35 entries, 22.5 MB inflated, ratio 3.6 at most; the
   largest wheel is torch (12 990 entries, 476 MB inflated), the highest
   ratio a scipy test data file (228). The pins are hashed first, so these
   only bound a pin taken on a bad file; they leave room for the next
   versions of the same libraries. */
const BORNES_INTERPRETE: BornesZip = { maxEntrees: 500, maxOctets: 128 * 1024 * 1024, maxRatio: 200 };
const BORNES_ROUE: BornesZip = { maxEntrees: 50_000, maxOctets: 1536 * 1024 * 1024, maxRatio: 2000 };

/** Written into the interpreter folder: the pin it was installed from. */
const MARQUEUR = "neo-quiz-interpreteur.json";
/** The queue key of the interpreter (no package name has a `#`). */
const INTERPRETE_CLE = "#interpreteur";

const aPropre = (o: object, cle: string): boolean => Object.prototype.hasOwnProperty.call(o, cle);

function estDossier(chemin: string): boolean {
	try { return lstatSync(chemin).isDirectory(); } catch { return false; }
}

/** Bytes under `dir`, links not followed. A folder or file that vanishes
    while it is counted (an uninstall, an antivirus) counts as 0. */
function tailleDossier(dir: string): number {
	let noms: string[];
	try { noms = readdirSync(dir); } catch { return 0; }
	let total = 0;
	for (const nom of noms) {
		const p = join(dir, nom);
		try {
			const s = lstatSync(p);
			total += s.isDirectory() ? tailleDossier(p) : s.size;
		} catch { /* vanished */ }
	}
	return total;
}

/** A leftover that could not be removed (EBUSY, an antivirus) is logged,
    never turned into a failure: the next install or uninstall retries. */
function retirer(chemin: string): void {
	try { rmSync(chemin, { recursive: true, force: true }); } catch (e) { console.warn(LOG_PREFIX, "python leftover not removed:", chemin, e); }
}

/** Moves every entry of `src` into `dest`, merging folders; a file that
    would replace another is refused (pip would overwrite it silently). */
function fusionner(src: string, dest: string): void {
	for (const nom of readdirSync(src)) {
		const de = join(src, nom);
		const vers = join(dest, nom);
		if (!existsSync(vers)) renameSync(de, vers);
		else if (estDossier(de) && estDossier(vers)) fusionner(de, vers);
		else throw erreurPython("empreinte", "a wheel's data folder collides with its own files: " + nom);
	}
}

/** `*.data/purelib|platlib/` merged at the root, the rest of `*.data/` dropped. */
function aplatirData(dossier: string): void {
	for (const nom of readdirSync(dossier)) {
		const data = join(dossier, nom);
		if (!/\.data$/i.test(nom) || !estDossier(data)) continue;
		for (const sous of readdirSync(data)) {
			if (/^(purelib|platlib)$/i.test(sous) && estDossier(join(data, sous))) fusionner(join(data, sous), dossier);
		}
		rmSync(data, { recursive: true, force: true });
	}
}

/**
 * The installer over `racine` (`userData/python`). `transport`, `catalogue`
 * and `disque` are the check's seams; the app passes none of them.
 */
export function creerInstallationPython(
	racine: string,
	transport: TransportInstallation = transportDefaut,
	catalogue: CataloguePython = { interprete: INTERPRETE, paquets: PAQUETS },
	disque: DisquePython = DISQUE_REEL,
): InstallationPython {
	const base = resolve(racine);
	const dossierInterprete = join(base, "interpreteur");
	const dossierLibs = join(base, "libs");
	const [majeure, mineure] = catalogue.interprete.version.split(".");
	const nomPth = `python${majeure}${mineure}._pth`;
	const nomZipStdlib = `python${majeure}${mineure}.zip`;

	const connu = (nom: string): boolean => aPropre(catalogue.paquets, nom);
	const nomDossier = (nom: string): string => nom + "-" + catalogue.paquets[nom].version;
	const dossierPaquet = (nom: string): string => join(dossierLibs, nomDossier(nom));
	const installe = (nom: string): boolean => estDossier(dossierPaquet(nom));
	const installes = (): string[] => Object.keys(catalogue.paquets).filter(installe).sort();
	const fermetureDe = (nom: string): string[] => fermeture(nom, catalogue.paquets);

	function interpreteOk(): boolean {
		try {
			const m = JSON.parse(readFileSync(join(dossierInterprete, MARQUEUR), "utf8")) as { sha256?: unknown };
			return m.sha256 === catalogue.interprete.sha256 && existsSync(join(dossierInterprete, "python.exe"));
		} catch {
			return false;
		}
	}

	const requisPar = (nom: string): string[] => installes().filter((n) => n !== nom && fermetureDe(n).includes(nom));

	/** Rewrites the `_pth` from the disk, in one synchronous step (no other
	    task can interleave): a temp file, then a rename over the old one. */
	function ecrirePth(): void {
		if (!interpreteOk()) return;
		const lignes = [nomZipStdlib, ".", ...installes().map(dossierPaquet)];
		const cible = join(dossierInterprete, nomPth);
		disque.ecrire(cible + ".tmp", lignes.join("\n") + "\n");
		disque.renommer(cible + ".tmp", cible);
	}

	/** Anything in `libs/` that is not a current pin's folder: `.part` and
	    `.suppr` folders of an aborted task, versions of an older catalogue.
	    Only ever called from inside the queue, so no task's `.part` is live. */
	function nettoyerLibs(): void {
		if (!estDossier(dossierLibs)) return;
		const attendus = new Set(Object.keys(catalogue.paquets).map(nomDossier));
		for (const nom of readdirSync(dossierLibs)) if (!attendus.has(nom)) retirer(join(dossierLibs, nom));
	}

	/** The pinned file's bytes, or `reseau` / `empreinte`. The buffer is
	    allocated once at the pinned size; nothing past it is ever kept. */
	async function telecharger(pin: FichierEpingle, surRecus: (recus: number) => void): Promise<Uint8Array> {
		const reponse = await demander(pin.url, "GET", transport);
		if (reponse.status !== 200) throw erreurPython("reseau", "status " + reponse.status + " for " + pin.url);
		/* No body stream: refused rather than read whole by `texte()`, which
		   would buffer an unbounded body before any size check. */
		if (!reponse.octets) throw erreurPython("reseau", "the response has no body stream: " + pin.url);
		const tampon = Buffer.allocUnsafe(pin.taille);
		const hache = createHash("sha256");
		let recus = 0;
		for await (const morceau of reponse.octets()) {
			if (recus + morceau.length > pin.taille) throw erreurPython("empreinte", "larger than its pin: " + pin.url);
			tampon.set(morceau, recus);
			recus += morceau.length;
			hache.update(morceau);
			surRecus(recus);
		}
		if (hache.digest("hex") !== pin.sha256) throw erreurPython("empreinte", "SHA-256 does not match its pin: " + pin.url);
		/* The very buffer that was hashed is the one unpacked: never re-read. */
		return tampon.subarray(0, recus);
	}

	async function deballer(octets: Uint8Array, dest: string, bornes: BornesZip): Promise<void> {
		try {
			await extraireZip(octets, dest, bornes);
		} catch (e) {
			if (e instanceof ErreurZip) throw erreurPython("empreinte", "archive refused (" + e.code + "): " + e.message);
			throw e;
		}
	}

	async function installerInterprete(surRecus: (recus: number) => void): Promise<void> {
		const partiel = dossierInterprete + ".part";
		const ancien = dossierInterprete + ".old";
		/* A previous install that failed between its two renames, and could
		   not put the old interpreter back, left it at `.old`: back first. */
		if (!existsSync(dossierInterprete) && estDossier(ancien)) disque.renommer(ancien, dossierInterprete);
		if (interpreteOk()) {
			mkdirSync(dossierLibs, { recursive: true });
			ecrirePth();
			return;
		}
		let garderAncien = false;
		try {
			retirer(partiel);
			retirer(ancien);
			const octets = await telecharger(catalogue.interprete, surRecus);
			await deballer(octets, partiel, BORNES_INTERPRETE);
			if (!existsSync(join(partiel, "python.exe"))) throw erreurPython("empreinte", "the interpreter archive has no python.exe");
			writeFileSync(join(partiel, MARQUEUR), JSON.stringify({ version: catalogue.interprete.version, sha256: catalogue.interprete.sha256 }));
			/* An older interpreter is renamed aside, never deleted in place: a
			   delete that fails halfway would leave a broken one in place. */
			if (existsSync(dossierInterprete)) disque.renommer(dossierInterprete, ancien);
			try {
				disque.renommer(partiel, dossierInterprete);
			} catch (e) {
				if (existsSync(ancien) && !existsSync(dossierInterprete)) {
					/* If even that fails, `.old` is the only interpreter left:
					   it is kept, and the next install puts it back. */
					try { disque.renommer(ancien, dossierInterprete); } catch (e2) { garderAncien = true; console.warn(LOG_PREFIX, "previous python interpreter not put back:", e2); }
				}
				throw e;
			}
			/* An installed interpreter always has its libs/ folder. */
			mkdirSync(dossierLibs, { recursive: true });
			ecrirePth();
		} finally {
			retirer(partiel);
			if (!garderAncien) retirer(ancien);
		}
	}

	async function installerPaquet(nom: string, surRecus: (recus: number) => void): Promise<void> {
		nettoyerLibs();
		if (installe(nom)) { ecrirePth(); return; }
		if (!interpreteOk()) throw erreurPython("absent", "the interpreter is not installed");
		for (const d of catalogue.paquets[nom].dependances) {
			if (!installe(d)) throw erreurPython("absent", "dependency " + d + " of " + nom + " is not installed");
		}
		const final = dossierPaquet(nom);
		const partiel = final + ".part";
		try {
			retirer(partiel);
			const octets = await telecharger(catalogue.paquets[nom], surRecus);
			await deballer(octets, partiel, BORNES_ROUE);
			aplatirData(partiel);
			disque.renommer(partiel, final);
			ecrirePth();
		} finally {
			retirer(partiel);
		}
	}

	/** Moves an installed folder aside to `<dossier>.suppr`. A folder in use
	    gives `occupe`, any other refusal `io`; a move the system half did is
	    put back. */
	function mettreDeCote(dossier: string): string {
		const aCote = dossier + ".suppr";
		retirer(aCote);
		try {
			disque.renommer(dossier, aCote);
		} catch (e) {
			if (!estDossier(dossier) && estDossier(aCote)) {
				try { disque.renommer(aCote, dossier); } catch (e2) { console.warn(LOG_PREFIX, "python folder not put back:", dossier, e2); }
			}
			throw erreurPython(CODES_OCCUPE.has(codeSysteme(e)) ? "occupe" : "io", "cannot move " + dossier + " aside (" + codeSysteme(e) + ")");
		}
		return aCote;
	}

	/** Removes one library: aside, `_pth` rewritten without it, deleted. A
	    `_pth` that cannot be written puts the folder back. */
	function retirerPaquet(nom: string): void {
		const final = dossierPaquet(nom);
		const aCote = mettreDeCote(final);
		try {
			ecrirePth();
		} catch (e) {
			try { disque.renommer(aCote, final); } catch (e2) { console.warn(LOG_PREFIX, "python library not put back:", final, e2); }
			throw e;
		}
		retirer(aCote);
	}

	/* ── The queue and the map of in-flight installs ── */
	let file: Promise<unknown> = Promise.resolve();
	function enFile<T>(tache: () => Promise<T>): Promise<T> {
		const suite = file.then(tache);
		file = suite.catch(() => undefined);
		return suite;
	}

	/** An `ErreurPython` passes as is; a disk errno becomes `io`, anything
	    else `reseau`. The raw message (local paths, a signed URL) goes to the
	    log only. */
	async function garder<T>(tache: () => Promise<T>): Promise<T> {
		try {
			return await tache();
		} catch (e) {
			if (estErreurPython(e)) throw e;
			console.warn(LOG_PREFIX, "python install failed:", e);
			throw CODES_DISQUE.has(codeSysteme(e)) ? erreurPython("io", "disk error " + codeSysteme(e)) : erreurPython("reseau", "unexpected error during the install");
		}
	}

	interface EnCours { promesse: Promise<void>; abonnes: Set<(recus: number) => void> }
	const enCours = new Map<string, EnCours>();

	function planifier(cle: string): EnCours {
		const deja = enCours.get(cle);
		if (deja) return deja;
		const abonnes = new Set<(recus: number) => void>();
		const diffuser = (recus: number): void => { for (const f of abonnes) f(recus); };
		const promesse = enFile(() => garder(() => (cle === INTERPRETE_CLE ? installerInterprete(diffuser) : installerPaquet(cle, diffuser))));
		const entree: EnCours = { promesse, abonnes };
		enCours.set(cle, entree);
		/* Also marks the promise handled: a caller that stops at an earlier
		   failure never awaits the later ones. */
		promesse.catch(() => undefined).finally(() => { if (enCours.get(cle) === entree) enCours.delete(cle); });
		return entree;
	}

	return {
		async etat() {
			const interprete = interpreteOk();
			const paquets = installes().map((nom) => ({
				nom,
				version: catalogue.paquets[nom].version,
				octets: tailleDossier(dossierPaquet(nom)),
				requisPar: requisPar(nom),
			}));
			return {
				interprete,
				version: interprete ? catalogue.interprete.version : null,
				paquets,
				octetsTotal: tailleDossier(dossierInterprete) + paquets.reduce((s, p) => s + p.octets, 0),
			};
		},

		async installer(cibles, progression) {
			const plan: string[] = [];
			for (const c of cibles) {
				if (!connu(c)) throw new Error("Unknown package: " + c);
				for (const n of fermetureDe(c)) if (!plan.includes(n)) plan.push(n);
			}
			const cles = [INTERPRETE_CLE, ...plan];
			/* Queued NOW, in this order: an uninstall asked after this call
			   runs after these installs. */
			const entrees = cles.map(planifier);
			const tailles = cles.map((k) => (k === INTERPRETE_CLE ? (interpreteOk() ? 0 : catalogue.interprete.taille) : installe(k) ? 0 : catalogue.paquets[k].taille));
			const total = tailles.reduce((s, t) => s + t, 0);
			let fait = 0;
			progression(0, total);
			for (let i = 0; i < cles.length; i++) {
				const ecoute = (recus: number): void => progression(fait + Math.min(recus, tailles[i]), total);
				entrees[i].abonnes.add(ecoute);
				try {
					await entrees[i].promesse;
				} finally {
					entrees[i].abonnes.delete(ecoute);
				}
				fait += tailles[i];
				if (tailles[i]) progression(fait, total);
			}
		},

		desinstaller(paquet) {
			if (!connu(paquet)) return Promise.reject(new Error("Unknown package: " + paquet));
			return enFile(() => garder(async () => {
				nettoyerLibs();
				if (!installe(paquet)) { ecrirePth(); return { ok: true as const }; }
				const dependants = requisPar(paquet);
				if (dependants.length) return { ok: false as const, requisPar: dependants };
				retirerPaquet(paquet);
				return { ok: true as const };
			}));
		},

		supprimerTout() {
			return enFile(async () => {
				try {
					nettoyerLibs();
					/* Dependents first: stopped half-way, what is left still
					   has every dependency it needs. */
					const ordre: string[] = [];
					for (const n of installes()) for (const d of fermetureDe(n)) if (!ordre.includes(d)) ordre.push(d);
					for (const nom of ordre.reverse()) if (installe(nom)) retirerPaquet(nom);
					if (existsSync(dossierInterprete)) retirer(mettreDeCote(dossierInterprete));
					for (const reste of [dossierLibs, dossierInterprete + ".part", dossierInterprete + ".old"]) retirer(reste);
					return { ok: true as const };
				} catch (e) {
					console.warn(LOG_PREFIX, "python removal stopped:", e);
					return { ok: false as const, code: estErreurPython(e) && e.code === "occupe" ? ("occupe" as const) : ("io" as const) };
				}
			});
		},

		chemins() {
			return { executable: join(dossierInterprete, "python.exe"), dossier: dossierInterprete };
		},
	};
}
