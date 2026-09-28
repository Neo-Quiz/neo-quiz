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
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
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

/** The only language this pack carries. `code-sandbox.ts` shares ONE pack
    directory for `c` AND `cpp` (one shared LLVM `Application` compiles
    either — spec §6), so `dossier`'s argument here is always the pack
    ROOT (`userData/languages`), never a per-language path. */
const NOM_LANGUE = "c";

function dossierLangue(dossier: string): string {
	return join(dossier, NOM_LANGUE);
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
 * The pack's state, read from `<dossier>/c/manifest.json` alone — the SAME
 * file `code-sandbox.ts`'s `run` checks with `existsSync`, so the engine
 * and Settings › Languages can never disagree about whether the pack is
 * usable. `installe: false` on ANY read failure (absent, unreadable,
 * malformed JSON, no string `version`) — a half-written pack must never
 * report itself installed, and this function never throws.
 */
export async function etatLangage(dossier: string): Promise<{ installe: boolean; version: string | null; octets: number }> {
	const cible = dossierLangue(dossier);
	try {
		const manifeste = JSON.parse(readFileSync(join(cible, "manifest.json"), "utf8")) as { version?: unknown };
		return { installe: true, version: typeof manifeste.version === "string" ? manifeste.version : null, octets: tailleDossier(cible) };
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
 * Downloads `PACK_C`, verifies its SHA-256, and installs it atomically
 * under `<dossier>/c`. Rejects `ErreurInstallation` with code `"reseau"`
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
 * (canaux.ts): in the app, the pin is always `PACK_C`.
 */
export async function installerLangage(
	dossier: string,
	progression: (recus: number, total: number) => void,
	transport: TransportInstallation = transportDefaut,
	pack: { url: string; sha256: string; taille: number } = PACK_C,
): Promise<void> {
	const cible = dossierLangue(dossier);
	const partielArchive = cible + ".part.zip.gz";
	const partielDossier = cible + ".part";
	mkdirSync(dossier, { recursive: true });
	try {
		/* A `.part` left by a previous aborted install must never be reused:
		   a hash that happened to match by chance would validate bytes that
		   are not this download's. */
		rmSync(partielArchive, { force: true });
		rmSync(partielDossier, { recursive: true, force: true });

		const reponse = await demander(pack.url, "GET", transport);
		if (reponse.status !== 200) throw erreurInstallation("reseau", "status " + reponse.status + " for the language pack");

		const hache = createHash("sha256");
		let recus = 0;
		const descripteur = openSync(partielArchive, "w");
		try {
			const ecrire = (paquet: Uint8Array): void => {
				writeSync(descripteur, paquet);
				hache.update(paquet);
				recus += paquet.length;
				progression(recus, pack.taille);
			};
			if (reponse.octets) {
				for await (const paquet of reponse.octets()) ecrire(paquet);
			} else {
				/* A transport that does not stream: the whole body as latin1,
				   the same fallback `video-installation.ts` uses. */
				ecrire(Buffer.from(await reponse.texte(), "latin1"));
			}
		} finally {
			closeSync(descripteur);
		}

		if (hache.digest("hex") !== pack.sha256) {
			throw erreurInstallation("empreinte", "SHA-256 of the downloaded pack does not match its pin");
		}

		let entries: ZipEntry[];
		try {
			entries = parseZip(gunzipSync(readFileSync(partielArchive)));
		} catch {
			throw erreurInstallation("empreinte", "the downloaded pack's archive could not be read");
		}
		ecrireEntrees(partielDossier, entries);

		/* THE FINAL DIRECTORY APPEARS BY THIS ONE RENAME, same volume same
		   folder: atomic. A stale `cible` (a previous install) is removed
		   first so the rename lands cleanly; nothing under `cible` before
		   this line. */
		rmSync(cible, { recursive: true, force: true });
		renameSync(partielDossier, cible);
	} catch (e) {
		if (estErreurInstallation(e)) throw e;
		throw erreurInstallation("reseau", String((e as Error)?.message ?? e).slice(-300));
	} finally {
		/* FAILURE OR SUCCESS: a `.part` never survives this call. On success
		   both were already consumed (the archive is no longer needed once
		   verified, the directory was renamed away) — this is then a no-op. */
		rmSync(partielArchive, { force: true });
		rmSync(partielDossier, { recursive: true, force: true });
	}
}

/** Deletes the installed pack. Re-downloadable, so nothing more is asked
    than the button that calls this (Settings › Languages, task 10). */
export async function supprimerLangage(dossier: string): Promise<void> {
	rmSync(dossierLangue(dossier), { recursive: true, force: true });
}
