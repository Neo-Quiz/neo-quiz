/* ══════════════════════════════════════════════════════════
   THE C/C++ LANGUAGE PACK — download, verify, install, delete

   Task 9 of docs/superpowers/plans/2026-09-28-c-cpp-execution.md: Clang,
   LLD, the WASI sysroot and the browser WASI shim ship in a single pack
   (`language-c-<version>.zip.gz`, a release asset of `Neo-Quiz/neo-quiz`,
   built by `scripts/build-language-pack.mjs`), downloaded on first use and
   served under `neo-code://app/languages/c/...` (`code-sandbox.ts`'s
   `resoudreFichierCode`, task 3), whose `run` answers `not-installed` for
   `c`/`cpp` until `languages/c/manifest.json` exists (task 8) — the exact
   file `etatLangage` below reads too, so the two can never disagree about
   whether the pack is there.

   THE PIN. `PACK_C.sha256` is written HERE, in the app's own code, never
   read from the release: a pack whose downloaded bytes hash to anything
   else is refused before a single byte is written under its final name —
   the whole point of pinning a hash is that the app, not the network,
   decides what it trusts. `scripts/build-language-pack.mjs` prints the
   hash to copy in by hand after building; nothing here computes or trusts
   one from the wire.

   THE DOWNLOAD, hashed while it streams, lands at `<dossier>/c.part.zip.gz`
   — never under its final name before the hash matches. On success it is
   gunzipped and its ZIP entries (`buildZip`/`parseZip`, src/dashboard/
   zip.ts) are written under `<dossier>/c.part/`, and ONLY THEN does
   `<dossier>/c.part` become `<dossier>/c` by a single `rename`, same volume
   same folder — the same atomic-rename discipline as
   `video-installation.ts`'s yt-dlp download, reusing its transport
   (`telechargement.ts`) and its error shape (`ErreurInstallation`,
   `code: "reseau" | "empreinte"`).

   EVERY ARCHIVE ENTRY NAME IS DISTRUSTED before it becomes a path
   (`nomEntreeAdmis`): no `..` segment, no empty segment, no drive letter or
   drive-relative name (`C:`, `C:evil`), no leading `/`, no backslash at
   all (a UNC root `\\server\share`, or `\` used as a separator — the
   pack's own entries never carry one, `buildZip` always writes `/`). A
   released pack passed the pin above, but the pin defends the BYTES, not
   what a crafted or corrupted archive's central directory CLAIMS its
   entries are named — this is that second, independent defence. */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { LOG_PREFIX } from "../../../src/branding";
import { parseZip } from "../../../src/dashboard/zip";
import type { ZipEntry } from "../../../src/dashboard/zip";
import { demander, erreurInstallation, estErreurInstallation, transportDefaut } from "./telechargement";
import type { TransportInstallation } from "./telechargement";
export type { ErreurInstallation, CodeInstallation } from "./telechargement";
export { estErreurInstallation } from "./telechargement";

/** The pinned pack: a release asset of `Neo-Quiz/neo-quiz`
    (`language-c-<version>` names BOTH the release tag and the asset,
    `make_latest: false` so it never displaces the app's own `latest.yml`).
    `sha256`/`taille` are `scripts/build-language-pack.mjs`'s own printed
    values for THIS exact build (run 2026-09-28) — a downloaded pack whose
    hash differs is refused, see the header. */
export const PACK_C = {
	version: "22.0.0-git20542-10",
	url: "https://github.com/Neo-Quiz/neo-quiz/releases/download/language-c-22.0.0-git20542-10/language-c-22.0.0-git20542-10.zip.gz",
	sha256: "aef5e5cc2f9fa27f6cc72d5a1294c2bc7cf3de291a49eb550010f894a3409a16",
	taille: 28432790,
} as const;

/** Placeholder pin of the Python (Pyodide) pack: the empty `url` makes
    `installerLangage` refuse it with `reseau` until the real pack is
    published (task 2 of the python-pack plan) and its values written here. */
export const PACK_PYTHON = {
	version: "314.0.7",
	url: "",
	sha256: "",
	taille: 0,
} as const;

/** A pack's name. `c` carries C AND C++ (`code-sandbox.ts` shares ONE pack
    directory for both: one shared LLVM `Application` compiles either, spec
    §6); `python` carries Pyodide. */
export type NomPack = "c" | "python";

/** A pinned pack. `marqueur` is a file (relative to the pack directory)
    whose presence proves the pack is really in place, not just that its
    manifest was written (an antivirus may quarantine the big wasm alone). */
export interface Pin {
	version: string;
	url: string;
	sha256: string;
	taille: number;
	marqueur: string;
}

/** The table of packs: every pin the app trusts, by name. */
export const PACKS: Record<NomPack, Pin> = {
	c: { ...PACK_C, marqueur: "clang/llvm.core.wasm" },
	python: { ...PACK_PYTHON, marqueur: "pyodide.asm.wasm" },
};

/** `dossier` is always the pack ROOT (`userData/languages`), never a
    per-pack path. */
function dossierLangue(dossier: string, nom: NomPack): string {
	return join(dossier, nom);
}

/** Total bytes under `dir`, recursively — for Settings › Languages, "398 MB
    installed" rather than a raw file count. */
function tailleDossier(dir: string): number {
	let total = 0;
	for (const nom of readdirSync(dir)) {
		const p = join(dir, nom);
		const s = statSync(p);
		total += s.isDirectory() ? tailleDossier(p) : s.size;
	}
	return total;
}

/**
 * The pack's state, read from `<dossier>/<nom>/manifest.json` alone — the SAME
 * file `code-sandbox.ts`'s `run` checks with `existsSync`, so the engine
 * and Settings › Languages can never disagree about whether the pack is
 * usable. `installe: false` on ANY read failure (absent, unreadable,
 * malformed JSON, no string `version`) — a half-written pack must never
 * report itself installed, and this function never throws.
 */
export async function etatLangage(dossier: string, nom: NomPack): Promise<{ installe: boolean; version: string | null; octets: number }> {
	const cible = dossierLangue(dossier, nom);
	try {
		const manifeste = JSON.parse(readFileSync(join(cible, "manifest.json"), "utf8")) as { version?: unknown };
		if (typeof manifeste.version !== "string") return { installe: false, version: null, octets: 0 };
		return { installe: true, version: manifeste.version, octets: tailleDossier(cible) };
	} catch {
		return { installe: false, version: null, octets: 0 };
	}
}

/**
 * Distrusts an archive entry's name before it becomes a filesystem path:
 * refuses any `..` segment (path traversal), an empty segment (`a//b`), a
 * drive letter or drive-relative name (`C:/evil`, `C:evil` — both are
 * absolute or app-directory-relative on Windows even without a leading
 * slash), a leading `/` (an absolute path), and ANY backslash at all (a
 * UNC root `\\server\share`, or `\` used as a separator — this pack's own
 * entries never carry one: `buildZip`/`build-language-pack.mjs` always
 * write `/`). `null` when refused; the unchanged name, ready for
 * `join(dest, ...nom.split("/"))`, otherwise. PURE and exported so each
 * refused form is provable on its own; the check also installs a crafted
 * test pack (the `pack` seam of `installerLangage`) to prove the whole
 * install refuses it and writes nothing.
 */
export function nomEntreeAdmis(nom: string): string | null {
	if (typeof nom !== "string" || !nom || nom.includes("\0") || nom.includes("\\")) return null;
	if (nom.startsWith("/")) return null;
	if (/^[a-zA-Z]:/.test(nom)) return null;
	const segments = nom.split("/");
	if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
	return nom;
}

/** Writes every entry under `dest`, each name checked by `nomEntreeAdmis`
    FIRST, and the resolved path re-checked to still fall under `dest`
    (defence in depth: `nomEntreeAdmis` is the rule, this is a second,
    independent gate that would still catch a bug in the first). */
function ecrireEntrees(dest: string, entries: ZipEntry[]): void {
	const destAbs = resolve(dest);
	for (const entree of entries) {
		const nom = nomEntreeAdmis(entree.name);
		if (!nom) throw erreurInstallation("empreinte", "unsafe entry name in the language pack: " + JSON.stringify(entree.name));
		const cible = resolve(dest, ...nom.split("/"));
		if (cible !== destAbs && !cible.startsWith(destAbs + sep)) {
			throw erreurInstallation("empreinte", "entry escapes the pack directory: " + entree.name);
		}
		mkdirSync(dirname(cible), { recursive: true });
		writeFileSync(cible, Buffer.from(entree.content, "latin1"));
	}
}

/**
 * Downloads the pack `PACKS[nom]`, verifies its SHA-256, and installs it
 * atomically under `<dossier>/<nom>`. Rejects `ErreurInstallation` with code `"reseau"`
 * (unreachable, a redirect outside the host list, an HTTP error) or
 * `"empreinte"` (hash mismatch, truncated download, an unsafe or unreadable
 * archive) — in EVERY failure, nothing is left on disk: the `.part` archive
 * and the `.part` directory are removed in a `finally`, and the final
 * `<dossier>/c` is never touched before the rename that makes it appear.
 *
 * `progression` reports bytes received against `PACK_C.taille` (the pack's
 * size is PINNED, unlike yt-dlp's HEAD-read total — no separate request
 * needed to know it upfront).
 *
 * `transport` and `pack` are the CHECK's seams
 * (`scripts/check-electron-langages.mjs`): a fake release, and a small
 * test pack with its own pin — the real pack's gzip bytes depend on the
 * zlib that built it, so a check that had to rebuild it bit for bit on CI
 * would test zlib, not this installer. The IPC channel passes neither
 * (canaux.ts): in the app, the pin is always `PACKS[nom]`.
 */
export async function installerLangage(
	dossier: string,
	nom: NomPack,
	progression: (recus: number, total: number) => void,
	transport: TransportInstallation = transportDefaut,
	pack: { url: string; sha256: string; taille: number } = PACKS[nom],
): Promise<void> {
	const cible = dossierLangue(dossier, nom);
	const partielDossier = cible + ".part";
	const ancien = cible + ".old";
	/* A pack not published yet (placeholder pin): nothing to download. */
	if (!pack.url) throw erreurInstallation("reseau", "the " + nom + " language pack has no download URL yet");
	mkdirSync(dossier, { recursive: true });
	try {
		/* A `.part` or `.old` left by an aborted install is never reused. */
		rmSync(partielDossier, { recursive: true, force: true });
		rmSync(ancien, { recursive: true, force: true });

		const reponse = await demander(pack.url, "GET", transport);
		if (reponse.status !== 200) throw erreurInstallation("reseau", "status " + reponse.status + " for the language pack");

		/* The body is kept IN MEMORY (28 MB), hashed as it arrives, and the
		   very same buffer is decompressed (security review 2026-09-28): a
		   file re-read from disk after hashing would let unpinned bytes
		   reach `gunzipSync`. A body longer than the pinned size is cut at
		   once instead of being taken in whole before the hash refuses it. */
		const hache = createHash("sha256");
		const paquets: Uint8Array[] = [];
		let recus = 0;
		const recevoir = (paquet: Uint8Array): void => {
			recus += paquet.length;
			if (recus > pack.taille) throw erreurInstallation("empreinte", "the language pack is larger than its pin");
			hache.update(paquet);
			paquets.push(paquet);
			progression(recus, pack.taille);
		};
		if (reponse.octets) {
			for await (const paquet of reponse.octets()) recevoir(paquet);
		} else {
			/* A transport that does not stream: the whole body as latin1,
			   the same fallback `video-installation.ts` uses. */
			recevoir(Buffer.from(await reponse.texte(), "latin1"));
		}
		if (hache.digest("hex") !== pack.sha256) {
			throw erreurInstallation("empreinte", "SHA-256 of the downloaded pack does not match its pin");
		}

		let entries: ZipEntry[];
		try {
			entries = parseZip(gunzipSync(Buffer.concat(paquets)));
		} catch {
			throw erreurInstallation("empreinte", "the downloaded pack's archive could not be read");
		}
		ecrireEntrees(partielDossier, entries);

		/* THE FINAL DIRECTORY APPEARS BY A RENAME, same volume same folder.
		   A previous install is first RENAMED aside, never deleted in place:
		   a recursive delete that fails halfway (EBUSY, an antivirus, a file
		   the sandbox is serving) could leave a `manifest.json` without its
		   `clang/`, a broken pack reporting itself installed. */
		if (existsSync(cible)) renameSync(cible, ancien);
		try {
			renameSync(partielDossier, cible);
		} catch (e) {
			/* The new pack could not take its place (an antivirus scanning
			   `.part`): the previous one goes back, rather than being
			   deleted by the `finally` below with nothing to replace it. */
			if (existsSync(ancien) && !existsSync(cible)) renameSync(ancien, cible);
			throw e;
		}
	} catch (e) {
		if (estErreurInstallation(e)) throw e;
		/* The raw message may carry local paths (the user's name) or a
		   signed redirect URL: logged here, never sent to the renderer. */
		console.warn(LOG_PREFIX, "language pack install failed:", e);
		throw erreurInstallation("reseau", "unexpected error during the install");
	} finally {
		/* FAILURE OR SUCCESS: a `.part` never survives this call; nor does
		   the previous install once the new one is in place. */
		/* A cleanup that fails (EBUSY) is logged, never turned into a failed
		   install: the pack in place is already the right one. */
		for (const reste of [partielDossier, ancien]) {
			try { rmSync(reste, { recursive: true, force: true }); } catch (e) { console.warn(LOG_PREFIX, "language pack leftover not removed:", reste, e); }
		}
	}
}

/** Deletes the installed pack. Re-downloadable, so nothing more is asked
    than the button that calls this (Settings › Languages, task 10). */
export async function supprimerLangage(dossier: string, nom: NomPack): Promise<void> {
	/* `manifest.json` first: if the recursive delete then fails halfway, the
	   pack reads as NOT installed (and re-downloads), never as a broken one
	   that `code-sandbox.ts` would still try to serve. */
	rmSync(join(dossierLangue(dossier, nom), "manifest.json"), { force: true });
	rmSync(dossierLangue(dossier, nom), { recursive: true, force: true });
}
