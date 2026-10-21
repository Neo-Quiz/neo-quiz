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
   list), held IN MEMORY while it is hashed, refused past its pinned size,
   and refused when its SHA-256 differs from the pin, before a single byte
   is unpacked. One file is held at a time: every download goes through ONE
   queue, so a torch wheel (124 MB) never shares memory with another.

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
   `import site` (no user site-packages, no `.pth` hooks of a package). An
   uninstall renames the folder aside BEFORE the `_pth` stops naming it, so
   a folder still in use by a running `python.exe` (a loaded `.pyd` is
   locked on Windows) makes the uninstall fail with nothing changed.

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
import { demander, erreurInstallation, estErreurInstallation, transportDefaut } from "../telechargement";
import type { TransportInstallation } from "../telechargement";
import { INTERPRETE, PAQUETS, fermeture } from "./catalogue";
import { ErreurZip, extraireZip } from "./zip-lecture";
import type { BornesZip } from "./zip-lecture";

/** A pinned file: where it is, and the only bytes accepted from there. */
export interface FichierEpingle { version: string; url: string; sha256: string; taille: number }

/** What the installer trusts. The app always passes the real one
    (`PAQUETS`, `INTERPRETE`); the check passes a fake one. */
export interface CataloguePython {
	interprete: FichierEpingle;
	paquets: Record<string, FichierEpingle & { dependances: readonly string[] }>;
}

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
	    installed. Rejects `ErreurInstallation` (`reseau` | `empreinte`); an
	    unknown name throws a plain `Error` before anything is downloaded. */
	installer(cibles: string[], progression: (recus: number, total: number) => void): Promise<void>;
	desinstaller(paquet: string): Promise<{ ok: true } | { ok: false; requisPar: string[] }>;
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

/** Bytes under `dir`, links not followed. */
function tailleDossier(dir: string): number {
	let total = 0;
	for (const nom of readdirSync(dir)) {
		const p = join(dir, nom);
		const s = lstatSync(p);
		total += s.isDirectory() ? tailleDossier(p) : s.size;
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
		else throw erreurInstallation("empreinte", "a wheel's data folder collides with its own files: " + nom);
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
 * The installer over `racine` (`userData/python`). `transport` and
 * `catalogue` are the check's seams; the app passes neither.
 */
export function creerInstallationPython(
	racine: string,
	transport: TransportInstallation = transportDefaut,
	catalogue: CataloguePython = { interprete: INTERPRETE, paquets: PAQUETS },
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
		writeFileSync(cible + ".tmp", lignes.join("\n") + "\n", "utf8");
		renameSync(cible + ".tmp", cible);
	}

	/** Anything in `libs/` that is not a current pin's folder: `.part` and
	    aside folders of an aborted task, versions of an older catalogue.
	    Only ever called from inside the queue, so no task's `.part` is live. */
	function nettoyerLibs(): void {
		if (!estDossier(dossierLibs)) return;
		const attendus = new Set(Object.keys(catalogue.paquets).map(nomDossier));
		for (const nom of readdirSync(dossierLibs)) if (!attendus.has(nom)) retirer(join(dossierLibs, nom));
	}

	/** The pinned file's bytes, or `reseau` / `empreinte`. */
	async function telecharger(pin: FichierEpingle, surRecus: (recus: number) => void): Promise<Uint8Array> {
		const reponse = await demander(pin.url, "GET", transport);
		if (reponse.status !== 200) throw erreurInstallation("reseau", "status " + reponse.status + " for " + pin.url);
		const hache = createHash("sha256");
		const morceaux: Uint8Array[] = [];
		let recus = 0;
		const recevoir = (morceau: Uint8Array): void => {
			recus += morceau.length;
			if (recus > pin.taille) throw erreurInstallation("empreinte", "larger than its pin: " + pin.url);
			hache.update(morceau);
			morceaux.push(morceau);
			surRecus(recus);
		};
		if (reponse.octets) {
			for await (const morceau of reponse.octets()) recevoir(morceau);
		} else {
			recevoir(Buffer.from(await reponse.texte(), "latin1"));
		}
		if (hache.digest("hex") !== pin.sha256) throw erreurInstallation("empreinte", "SHA-256 does not match its pin: " + pin.url);
		/* The very buffer that was hashed is the one unpacked: never re-read. */
		return Buffer.concat(morceaux);
	}

	async function deballer(octets: Uint8Array, dest: string, bornes: BornesZip): Promise<void> {
		try {
			await extraireZip(octets, dest, bornes);
		} catch (e) {
			if (e instanceof ErreurZip) throw erreurInstallation("empreinte", "archive refused (" + e.code + "): " + e.message);
			throw e;
		}
	}

	async function installerInterprete(surRecus: (recus: number) => void): Promise<void> {
		if (interpreteOk()) return;
		const partiel = dossierInterprete + ".part";
		const ancien = dossierInterprete + ".old";
		try {
			retirer(partiel);
			retirer(ancien);
			const octets = await telecharger(catalogue.interprete, surRecus);
			await deballer(octets, partiel, BORNES_INTERPRETE);
			if (!existsSync(join(partiel, "python.exe"))) throw erreurInstallation("empreinte", "the interpreter archive has no python.exe");
			writeFileSync(join(partiel, MARQUEUR), JSON.stringify({ version: catalogue.interprete.version, sha256: catalogue.interprete.sha256 }));
			/* An older interpreter is renamed aside, never deleted in place: a
			   delete that fails halfway would leave a broken one in place. */
			if (existsSync(dossierInterprete)) renameSync(dossierInterprete, ancien);
			try {
				renameSync(partiel, dossierInterprete);
			} catch (e) {
				if (existsSync(ancien) && !existsSync(dossierInterprete)) renameSync(ancien, dossierInterprete);
				throw e;
			}
			/* An installed interpreter always has its libs/ folder. */
			mkdirSync(dossierLibs, { recursive: true });
			ecrirePth();
		} finally {
			retirer(partiel);
			retirer(ancien);
		}
	}

	async function installerPaquet(nom: string, surRecus: (recus: number) => void): Promise<void> {
		nettoyerLibs();
		if (installe(nom)) return;
		if (!interpreteOk()) throw erreurInstallation("reseau", "the interpreter is not installed");
		for (const d of catalogue.paquets[nom].dependances) {
			if (!installe(d)) throw erreurInstallation("reseau", "dependency " + d + " of " + nom + " is not installed");
		}
		const final = dossierPaquet(nom);
		const partiel = final + ".part";
		try {
			retirer(partiel);
			const octets = await telecharger(catalogue.paquets[nom], surRecus);
			await deballer(octets, partiel, BORNES_ROUE);
			aplatirData(partiel);
			renameSync(partiel, final);
			ecrirePth();
		} finally {
			retirer(partiel);
		}
	}

	/* ── The queue and the map of in-flight installs ── */
	let file: Promise<unknown> = Promise.resolve();
	function enFile<T>(tache: () => Promise<T>): Promise<T> {
		const suite = file.then(tache);
		file = suite.catch(() => undefined);
		return suite;
	}

	/** Reduces anything that is not an install error to `reseau`; the raw
	    message (local paths, a signed URL) goes to the log only. */
	async function garder(tache: () => Promise<void>): Promise<void> {
		try {
			await tache();
		} catch (e) {
			if (estErreurInstallation(e)) throw e;
			console.warn(LOG_PREFIX, "python install failed:", e);
			throw erreurInstallation("reseau", "unexpected error during the install");
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
			const octetsInterprete = estDossier(dossierInterprete) ? tailleDossier(dossierInterprete) : 0;
			return {
				interprete,
				version: interprete ? catalogue.interprete.version : null,
				paquets,
				octetsTotal: octetsInterprete + paquets.reduce((s, p) => s + p.octets, 0),
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
			return enFile(async () => {
				nettoyerLibs();
				const final = dossierPaquet(paquet);
				if (!estDossier(final)) { ecrirePth(); return { ok: true as const }; }
				const dependants = requisPar(paquet);
				if (dependants.length) return { ok: false as const, requisPar: dependants };
				const aCote = final + ".suppr";
				retirer(aCote);
				/* A folder in use (a `.pyd` loaded by a running python.exe)
				   cannot be renamed: the uninstall throws with nothing changed. */
				renameSync(final, aCote);
				ecrirePth();
				retirer(aCote);
				return { ok: true as const };
			});
		},

		chemins() {
			return { executable: join(dossierInterprete, "python.exe"), dossier: dossierInterprete };
		},
	};
}
