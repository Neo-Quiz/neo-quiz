/* ══════════════════════════════════════════════════════════
   A PYTHON RUN ASKED BY A PHONE, DECIDED IN THE MAIN PROCESS (final review I2, I3)

   The phone writes `<synced root>/.neo-quiz/code-runs/requests/<device>/<id>.json`
   (src/shared-state/code-run-request.ts). This PC's window notices it and
   asks this process to run it, naming only the request file
   (`{ appareil, demande }`) and the code it found. NOTHING the window says is
   trusted: a compromised window could have written that file itself. So,
   before any spawn, this module:

   1. reads the request file from the disk ITSELF, under the Syncthing folder
      (the pinned `syncRoot`, never a path from the window), size-bounded,
      validates it with the shared pure validator (schema, sender = folder,
      target = this PC, age) and checks its ECDSA P-256 signature against
      the public key it carries (`signatureValide`);
   2. asks the embedded Syncthing (REST key held here) who wrote it:
      `/rest/db/file` → `global.modifiedBy`, the 7-character short id of the
      device that made the current version, and `global.blocksHash`, which
      for a file of one block (every request: a few KB, the smallest block is
      128 KiB) is base64(SHA-256(SHA-256(bytes))). The bytes read in step 1
      must hash to it, `modifiedBy` must be exactly one PAIRED device and
      never this one. Measured on the real v2.1.5 binary (2026-10-22): a file
      written on this PC is "no such object" until scanned, then
      `modifiedBy` = this device; a file of the phone overwritten here keeps
      the phone's `modifiedBy` until the rescan, but its bytes no longer
      match `blocksHash`. Either way the window's file is refused;
   3. reads the note itself, finds the Python block by the request's SHA-256
      (src/code-blocks.ts, the engine's own grammar) and requires the code
      the window sent to be that block, byte for byte;
   4. asks the owner, ONCE per device, with a native dialog
      (`garde.ts`): the Neo Quiz device id is bound to the Syncthing device
      seen writing for it AND to the request's public key. Syncthing's
      `modifiedBy` is the sending device's own claim (a compromised paired
      device can name another one), so after that first "Allow" the KEY is
      what proves the phone: a later request with another key, from another
      Syncthing device, or naming another Neo Quiz id through a Syncthing
      device already bound, is refused without asking (`unknown-key`); a
      refused Syncthing device is refused without asking until the owner
      removes it in Settings. What remains is trust on first use: before the
      owner's first "Allow", a compromised paired device could pose as the
      phone, and the dialog says to allow only right after pressing Run;
   5. checks again, right before the run, that the request still exists and
      is still young enough (`MAX_AGE_MS`), and bounds the run so that it
      ends before the phone stops waiting (`PHONE_WAIT_MS`);
   6. never starts an install the phone could not wait for: it answers
      `not-installed` with `pc-installing` and starts the download in the
      background, so the next try finds the library.

   Each request runs at most once here (a key kept in memory: a request is
   only valid for `MAX_AGE_MS`, a restart costs one more run of the same
   approved code at worst). No Electron import: every dependency is injected
   (`canaux.ts` in the app, `scripts/check-python-service.mjs` in checks).
══════════════════════════════════════════════════════════ */

import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import type { CodeRun } from "../../../../src/host/types";
import { blocsPython } from "../../../../src/code-blocks";
import { MAX_AGE_MS, MAX_REQUEST_CHARS, PHONE_WAIT_MS, parseRequestPath, signedMessage, validerDemandeCode } from "../../../../src/shared-state/code-run-request";
import type { CodeRunRequest } from "../../../../src/shared-state/code-run-request";
import type { ServicePython } from "./service";
import type { AutorisationsAppareils, GardePython } from "./garde";

/** What Syncthing says of one file (`/rest/db/file`, its `global` record). */
export interface InfoFichierSync {
	modifiedBy: string;
	blocksHash: string;
	deleted: boolean;
	invalid: boolean;
	type: string;
}

/** The embedded Syncthing as this module needs it; `null` when sync is not running. */
export interface OrigineSync {
	/** The shared folder (absolute). */
	racine: string;
	/** This device's full Syncthing id. */
	idPropre: string;
	/** The paired devices (full ids and the names this PC shows). */
	pairs: Array<{ id: string; nom: string }>;
	/** `null` when the file is not in the index (404) or the call failed. */
	fichier(rel: string): Promise<InfoFichierSync | null>;
}

export interface DepsDistant {
	sync(): Promise<OrigineSync | null>;
	/** This PC's Neo Quiz device id (the `target` a request names). */
	idAppareil(): Promise<string | null>;
	autorisations: AutorisationsAppareils;
	garde: Pick<GardePython, "autoriserAppareil">;
	service: Pick<ServicePython, "run" | "installer" | "octetsAInstaller" | "installationEnCours">;
	now(): number;
	/** The disk: the app passes nothing (node:fs); the check may. */
	disque?: { lire(abs: string, max: number): Promise<Buffer | null>; existe(abs: string): Promise<boolean>; reel(abs: string): Promise<string> };
}

/** The phone's result codes this module adds (`engine.code.pcRefused`, `engine.code.pcInstalling`). */
export const ERREUR_REFUS = "refused";
export const ERREUR_INSTALLATION = "pc-installing";
/** The request is signed by a key this PC does not know for that device (`engine.code.pcUnknownKey`). */
export const ERREUR_CLE = "unknown-key";

/** A note past this is not read (same bound as the window's reader). */
const MAX_NOTE = 4_000_000;
/** The run ends this long before the phone stops waiting (its last poll, the sync of the result). */
const MARGE_TELEPHONE_MS = 8_000;
/** An install the phone may wait for: estimated at 1 MB/s plus 10 s of unpacking. */
const DEBIT_ESTIME = 1_000_000;
const COUT_FIXE_INSTALL_MS = 10_000;
/** Remembered request keys (each runs at most once). */
const MAX_VUES = 2_000;

const indisponible = (error?: string): CodeRun => (error ? { status: "unavailable", stdout: "", error } : { status: "unavailable", stdout: "" });

/** base64(SHA-256(SHA-256(bytes))): Syncthing's `blocksHash` of a one-block file. */
export function blocksHashUnBloc(octets: Uint8Array): string {
	const bloc = createHash("sha256").update(octets).digest();
	return createHash("sha256").update(bloc).digest("base64");
}

/** Whether `sig` is a valid ECDSA P-256 / SHA-256 signature, by `key`, of the
    request's `signedMessage`. Any malformed key or signature: false. */
export function signatureValide(d: Pick<CodeRunRequest, "id" | "at" | "from" | "target" | "path" | "sha256" | "key" | "sig">): boolean {
	try {
		const point = Buffer.from(d.key, "base64url");
		const sig = Buffer.from(d.sig, "base64url");
		if (point.length !== 65 || point[0] !== 4 || sig.length !== 64) return false;
		const cle = createPublicKey({ key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") }, format: "jwk" });
		return verify("sha256", Buffer.from(signedMessage(d), "utf8"), { key: cle, dsaEncoding: "ieee-p1363" }, sig);
	} catch { return false; }
}

/** The paired device that made this version of the file, or why not. Pure. */
export function jugerOrigine(info: InfoFichierSync | null, octets: Uint8Array, idPropre: string, pairs: ReadonlyArray<{ id: string; nom: string }>): { ok: true; pair: { id: string; nom: string } } | { ok: false; raison: string } {
	if (!info) return { ok: false, raison: "not-indexed" };
	if (info.deleted || info.invalid || info.type !== "FILE_INFO_TYPE_FILE") return { ok: false, raison: "not-a-file" };
	if (octets.length > 128 * 1024 || info.blocksHash !== blocksHashUnBloc(octets)) return { ok: false, raison: "bytes-differ" };
	const court = info.modifiedBy;
	if (typeof court !== "string" || !/^[A-Z2-7]{7}$/.test(court)) return { ok: false, raison: "no-modifier" };
	if (idPropre.slice(0, 7) === court) return { ok: false, raison: "written-here" };
	const candidats = pairs.filter((p) => p.id !== idPropre && p.id.slice(0, 7) === court);
	if (candidats.length !== 1) return { ok: false, raison: "not-paired" };
	return { ok: true, pair: candidats[0] };
}

const disqueReel = {
	async lire(abs: string, max: number): Promise<Buffer | null> {
		try {
			const s = await stat(abs);
			if (!s.isFile() || s.size > max) return null;
			const b = await readFile(abs);
			return b.length > max ? null : b;
		} catch { return null; }
	},
	async existe(abs: string): Promise<boolean> {
		try { return (await stat(abs)).isFile(); } catch { return false; }
	},
	reel: (abs: string) => realpath(abs),
};

/** `abs` is `racine` itself or inside it (both already resolved). */
function sous(racine: string, abs: string): boolean {
	const r = relative(racine, abs);
	return r !== "" && !r.startsWith("..") && !isAbsolute(r);
}

export interface ExecutionDistante {
	executer(job: { code: string; distant: unknown; signal?: AbortSignal }): Promise<CodeRun>;
}

export function creerExecutionDistante(deps: DepsDistant): ExecutionDistante {
	const disque = deps.disque ?? disqueReel;
	const vues = new Set<string>();
	const marquer = (cle: string): void => {
		vues.add(cle);
		for (const vieille of vues) { if (vues.size <= MAX_VUES) break; vues.delete(vieille); }
	};

	return {
		async executer(job) {
			/* 1. The request file, named exactly. */
			const d = job.distant as { appareil?: unknown; demande?: unknown } | null;
			if (!d || typeof d !== "object" || typeof d.appareil !== "string") return indisponible();
			const nom = parseRequestPath(d.demande);
			if (!nom || nom.device !== d.appareil) return indisponible();
			const origine = await deps.sync().catch(() => null);
			if (!origine) return indisponible();
			const idPc = await deps.idAppareil().catch(() => null);
			if (!idPc) return indisponible();
			const rel = d.demande as string;
			const absDemande = join(origine.racine, ...rel.split("/"));
			/* A junction under the folder must not lead the read elsewhere. */
			let racineReelle: string;
			try {
				racineReelle = await disque.reel(origine.racine);
				if (!sous(racineReelle, await disque.reel(absDemande))) return indisponible();
			} catch { return indisponible(); }
			const octets = await disque.lire(absDemande, 4 * MAX_REQUEST_CHARS);
			if (!octets) return indisponible();
			let brut: unknown;
			try { brut = JSON.parse(octets.toString("utf8")); } catch { return indisponible(); }
			const verdict = validerDemandeCode(brut, { device: idPc, fileDevice: nom.device, fileId: nom.id, now: deps.now() });
			if (!verdict.ok) return indisponible();
			const demande = verdict.demande;
			if (!signatureValide(demande)) {
				console.warn("[python] remote request refused: bad-signature", rel);
				return indisponible();
			}

			/* 2. Who wrote it, per Syncthing. */
			const qui = jugerOrigine(await origine.fichier(rel).catch(() => null), octets, origine.idPropre, origine.pairs);
			if (!qui.ok) {
				console.warn("[python] remote request refused:", qui.raison, rel);
				return indisponible();
			}

			/* Each request once. */
			const cle = nom.device + "/" + nom.id;
			if (vues.has(cle)) return indisponible();
			marquer(cle);

			/* 3. The note, read here; the code must be its block. */
			const absNote = join(origine.racine, ...demande.path.split("/"));
			let noteReelle: string;
			try { noteReelle = await disque.reel(absNote); } catch { return indisponible("changed"); }
			if (!sous(racineReelle, noteReelle)) return indisponible("changed");
			const note = await disque.lire(noteReelle, MAX_NOTE);
			if (!note) return indisponible("changed");
			const bloc = blocsPython(note.toString("utf8")).find((b) => createHash("sha256").update(b, "utf8").digest("hex") === demande.sha256);
			if (bloc === undefined || bloc !== job.code) return indisponible("changed");

			/* 4. The owner's authorization of this device and key, once. */
			const st = qui.pair.id;
			if (deps.autorisations.refuse(st)) return indisponible(ERREUR_REFUS);
			const connu = deps.autorisations.trouver(demande.from);
			if (connu || deps.autorisations.parSyncthing(st)) {
				/* Pinned: this Neo Quiz id, through this Syncthing device, signed by this key. */
				if (!connu || connu.syncthing !== st || connu.cle !== demande.key) return indisponible(ERREUR_CLE);
			} else {
				const reponse = await deps.garde.autoriserAppareil(qui.pair.nom || st.slice(0, 7));
				if (reponse === null) return indisponible();
				if (reponse === "refuser") {
					deps.autorisations.refuser({ syncthing: st, nom: qui.pair.nom, at: deps.now() });
					return indisponible(ERREUR_REFUS);
				}
				deps.autorisations.ajouter({ appareil: demande.from, syncthing: st, cle: demande.key, nom: qui.pair.nom, at: deps.now() });
			}

			/* 5. Still asked, still young, and the time the phone still waits. */
			const encoreValide = async (): Promise<boolean> => deps.now() - demande.at <= MAX_AGE_MS && (await disque.existe(absDemande));
			const restant = (): number => demande.at + PHONE_WAIT_MS - MARGE_TELEPHONE_MS - deps.now();
			if (!(await encoreValide()) || restant() < 1000) return indisponible();
			/* An install under way (this one's, from an earlier try, or the
			   owner's): the run would only wait behind it. */
			if (deps.service.installationEnCours()) return { status: "not-installed", stdout: "", error: ERREUR_INSTALLATION };

			let run = await deps.service.run({ code: bloc, timeoutMs: Math.min(60_000, restant()), signal: job.signal });
			if (run.status !== "not-installed") return run;

			/* 6. Missing libraries: installed now only when the phone can wait for it. */
			const manquants = run.missing ?? [];
			const octetsInstall = await deps.service.octetsAInstaller(manquants);
			if (!Number.isFinite(octetsInstall)) return indisponible();
			const duree = COUT_FIXE_INSTALL_MS + (octetsInstall / DEBIT_ESTIME) * 1000;
			if (duree + 3000 > restant()) {
				void deps.service.installer(manquants, () => {}).catch(() => undefined);
				return { status: "not-installed", stdout: "", error: ERREUR_INSTALLATION };
			}
			const installe = await deps.service.installer(manquants, () => {});
			if (!installe.ok) return indisponible();
			if (!(await encoreValide()) || restant() < 1000) return indisponible();
			run = await deps.service.run({ code: bloc, timeoutMs: Math.min(60_000, restant()), signal: job.signal });
			return run.status === "not-installed" ? indisponible() : run;
		},
	};
}
