/* ══════════════════════════════════════════════════════════
   THE PYTHON PACKAGE PROXY (spec 2026-10-04-python-pack-design.md §2)

   The sandbox is CLOSED (no network, `webRequest` cancels everything that
   is not `neo-code:`). Packages reach it ONLY through this module, run by
   the main process:

   1. PYODIDE PACKAGES (numpy…): the pack carries `pyodide-lock.json`, whose
      `packages[*].file_name` + `sha256` are the allow-list. A file the lock
      does not name is a 404 and NO request leaves the machine. A listed file
      is downloaded from the pinned CDN (≤ 50 MB, redirects re-judged by
      `demander`), its SHA-256 compared with the lock's, written to
      `<pack>/paquets/<file>.part` then renamed. A mismatch leaves nothing.
   2. PURE PyPI WHEELS (micropip): the index answer is rewritten so every
      file points at `file:///pypi/files/…` (the worker resolves it to
      `neo-code://app/pypi/files/…`; micropip accepts no other local scheme) and only pure wheels
      stay; their `hashes.sha256` are recorded; a file is served only if its
      bytes match the digest PyPI announced for it.
   3. A shared BUDGET (500 MB of downloaded bytes per run of the app) stops
      a quiz that loops over packages from filling the disk or the line.

   The functions are PURE or take an injected transport, so
   `check:code-packages` proves them on the real code, never the network.
   ══════════════════════════════════════════════════════════ */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { demander, type TransportInstallation, transportDefaut } from "./telechargement";
import { CDN_PYODIDE } from "./langages";

/** Largest single package file, and the budget of one app run. */
export const PLAFOND_FICHIER = 50 * 1024 * 1024;
export const PLAFOND_BUDGET = 500 * 1024 * 1024;
/** Largest PyPI index answer. */
const PLAFOND_INDEX = 10 * 1024 * 1024;
const HOTE_FICHIERS = "https://files.pythonhosted.org/";
const ACCEPT_INDEX = "application/vnd.pypi.simple.v1+json";

/** A plain file name: no separators, no drive, no stream, no trailing dot. */
const NOM_FICHIER = /^[A-Za-z0-9_](?:[A-Za-z0-9._+-]*[A-Za-z0-9_])?$/;
const NOM_PROJET = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const SEGMENT_CHEMIN = /^[A-Za-z0-9_](?:[A-Za-z0-9._+~-]*[A-Za-z0-9_])?$/;

/** Bytes this process may still download. */
export class Budget {
	private reste: number;
	constructor(total: number = PLAFOND_BUDGET) { this.reste = total; }
	/** Spends `octets`; false (and nothing spent) if they do not fit. */
	prendre(octets: number): boolean {
		if (!(octets >= 0) || octets > this.reste) return false;
		this.reste -= octets;
		return true;
	}
}
const budgetGlobal = new Budget();

/** The lock's entry for this exact file name, or null. */
export function entreeDuLock(lock: unknown, fichier: string): { sha256: string } | null {
	const paquets = (lock as { packages?: unknown } | null)?.packages;
	if (!paquets || typeof paquets !== "object") return null;
	for (const p of Object.values(paquets as Record<string, unknown>)) {
		const e = p as { file_name?: unknown; sha256?: unknown } | null;
		if (e && e.file_name === fichier && typeof e.sha256 === "string" && /^[0-9a-f]{64}$/i.test(e.sha256)) {
			return { sha256: e.sha256.toLowerCase() };
		}
	}
	return null;
}

export function urlCdn(base: string, fichier: string): string {
	return base + fichier;
}

/** `simple/<name>/` -> the PyPI index, `files/<path>` -> the file host;
    anything else (`..`, odd segments, other shapes) null. */
export function urlPypi(chemin: string): string | null {
	const segs = chemin.replace(/^\/+/, "").split("/");
	if (segs[0] === "simple" && segs.length === 3 && segs[2] === "" && NOM_PROJET.test(segs[1])) {
		return `https://pypi.org/simple/${segs[1]}/`;
	}
	if (segs[0] === "files" && segs.length >= 2 && segs.slice(1).every((s) => SEGMENT_CHEMIN.test(s))) {
		return HOTE_FICHIERS + segs.slice(1).join("/");
	}
	return null;
}

/** Pure wheels only: `py3-none-any`, or a wheel built for Pyodide. A
    native `cp312-…-manylinux` wheel cannot run here and never gets in. */
export function roueAdmise(nom: string): boolean {
	const n = nom.toLowerCase();
	if (!n.endsWith(".whl")) return false;
	if (/-(?:py3|py2\.py3)-none-any\.whl$/.test(n)) return true;
	const plateforme = n.slice(0, -4).split("-").pop() ?? "";
	return /^(?:pyodide|pyemscripten|emscripten)_/.test(plateforme);
}

const sha256Hex = (octets: Uint8Array): string => createHash("sha256").update(octets).digest("hex");
const vide = (status: number): Response => new Response(null, { status });

/** Reads at most `plafond` bytes, spending them from `budget` as they
    arrive (a refused or failed download counts: it did use the line).
    `"trop-gros"` / `"budget"` say why it stopped. */
async function lireBorne(
	octets: () => AsyncIterable<Uint8Array>,
	plafond: number,
	budget: Budget,
): Promise<Buffer | "trop-gros" | "budget"> {
	const morceaux: Uint8Array[] = [];
	let total = 0;
	for await (const m of octets()) {
		total += m.length;
		if (total > plafond) return "trop-gros";
		if (!budget.prendre(m.length)) return "budget";
		morceaux.push(m);
	}
	return Buffer.concat(morceaux);
}

const lockMemo = new Map<string, unknown>();
function lireLock(dossierPack: string): unknown {
	const chemin = join(dossierPack, "pyodide-lock.json");
	if (lockMemo.has(chemin)) return lockMemo.get(chemin);
	let lock: unknown = null;
	try { lock = JSON.parse(readFileSync(chemin, "utf8")); } catch { /* no lock: nothing is listed */ }
	if (lock) lockMemo.set(chemin, lock);
	return lock;
}

const enCours = new Map<string, Promise<Response>>();

function repondre(octets: Buffer, type = "application/octet-stream"): Response {
	return new Response(new Uint8Array(octets), { status: 200, headers: { "content-type": type } });
}

/** A Pyodide package file the pack does not carry: cached, else downloaded
    from the CDN, hash-checked against the lock, cached, served. */
export function servirPaquet(
	dossierPack: string,
	fichier: string,
	transport: TransportInstallation = transportDefaut,
	budget: Budget = budgetGlobal,
	base: string = CDN_PYODIDE,
): Promise<Response> {
	if (!NOM_FICHIER.test(fichier)) return Promise.resolve(vide(404));
	const cle = join(dossierPack, "paquets", fichier);
	const deja = enCours.get(cle);
	if (deja) return deja.then((r) => r.clone());
	const p = servir(dossierPack, fichier, transport, budget, base).finally(() => { enCours.delete(cle); });
	enCours.set(cle, p);
	return p.then((r) => r.clone());
}

async function servir(dossierPack: string, fichier: string, transport: TransportInstallation, budget: Budget, base: string): Promise<Response> {
	const entree = entreeDuLock(lireLock(dossierPack), fichier);
	if (!entree) return vide(404);
	const dossier = join(dossierPack, "paquets");
	const cible = join(dossier, fichier);
	if (existsSync(cible)) {
		/* Re-judged on every read: the cache lives in the user's profile. */
		try {
			const octets = readFileSync(cible);
			if (sha256Hex(octets) === entree.sha256) return repondre(octets);
		} catch { /* unreadable: download again */ }
		rmSync(cible, { force: true });
	}
	let octets: Buffer | "trop-gros" | "budget";
	try {
		const rep = await demander(urlCdn(base, fichier), "GET", transport);
		if (rep.status !== 200 || !rep.octets) return vide(rep.status === 404 ? 404 : 502);
		octets = await lireBorne(rep.octets.bind(rep), PLAFOND_FICHIER, budget);
	} catch {
		return vide(503);
	}
	if (octets === "budget") return vide(503);
	if (octets === "trop-gros") return vide(502);
	if (sha256Hex(octets) !== entree.sha256) return vide(502);
	const part = cible + ".part";
	try {
		mkdirSync(dossier, { recursive: true });
		writeFileSync(part, octets);
		renameSync(part, cible);
	} catch {
		rmSync(part, { force: true });
		/* The bytes are verified: serving them without caching is harmless. */
	}
	return repondre(octets);
}

/** `neo-code://app/pypi/<chemin>`: the index (rewritten) or a pure wheel whose
    bytes match the digest the index announced. */
export async function servirPypi(
	chemin: string,
	transport: TransportInstallation,
	digests: Map<string, string>,
	budget: Budget = budgetGlobal,
): Promise<Response> {
	const url = urlPypi(chemin);
	if (!url) return vide(403);
	if (url.startsWith("https://pypi.org/simple/")) return servirIndex(url, transport, digests, budget);
	const nom = url.slice(url.lastIndexOf("/") + 1);
	const attendu = digests.get(url);
	if (!roueAdmise(nom) || !attendu) return vide(403);
	let octets: Buffer | "trop-gros" | "budget";
	try {
		const rep = await demander(url, "GET", transport);
		if (rep.status !== 200 || !rep.octets) return vide(rep.status === 404 ? 404 : 502);
		octets = await lireBorne(rep.octets.bind(rep), PLAFOND_FICHIER, budget);
	} catch {
		return vide(503);
	}
	if (octets === "budget") return vide(503);
	if (octets === "trop-gros") return vide(403);
	if (sha256Hex(octets) !== attendu) return vide(403);
	return repondre(octets, "application/zip");
}

async function servirIndex(url: string, transport: TransportInstallation, digests: Map<string, string>, budget: Budget): Promise<Response> {
	let corps: Buffer | "trop-gros" | "budget";
	let status: number;
	try {
		const rep = await demander(url, "GET", transport, 3, { Accept: ACCEPT_INDEX });
		status = rep.status;
		if (status !== 200 || !rep.octets) return vide(status === 404 ? 404 : 502);
		corps = await lireBorne(rep.octets.bind(rep), PLAFOND_INDEX, budget);
	} catch {
		return vide(503);
	}
	if (corps === "budget") return vide(503);
	if (corps === "trop-gros") return vide(502);
	let json: { files?: unknown } & Record<string, unknown>;
	try { json = JSON.parse(corps.toString("utf8")); } catch { return vide(502); }
	if (!json || typeof json !== "object" || !Array.isArray(json.files)) return vide(502);
	/* Keep only pure wheels with a SHA-256, point them back at the proxy,
	   and drop `core-metadata`: micropip then downloads the whole wheel
	   (judged here) instead of asking for a `.metadata` sibling. */
	const gardes: unknown[] = [];
	for (const f of json.files as Array<Record<string, unknown>>) {
		const fu = typeof f?.url === "string" ? f.url : "";
		const sha = (f?.hashes as { sha256?: unknown } | undefined)?.sha256;
		if (!fu.startsWith(HOTE_FICHIERS) || typeof sha !== "string" || !/^[0-9a-f]{64}$/i.test(sha)) continue;
		const rel = fu.slice(HOTE_FICHIERS.length);
		const canon = urlPypi("files/" + rel);
		if (!canon || !roueAdmise(rel.slice(rel.lastIndexOf("/") + 1))) continue;
		digests.set(canon, sha.toLowerCase());
		const { "core-metadata": _a, "data-dist-info-metadata": _b, ...reste } = f;
		gardes.push({ ...reste, url: `file:///pypi/files/${rel}` });
	}
	return new Response(JSON.stringify({ ...json, files: gardes }), {
		status: 200,
		headers: { "content-type": ACCEPT_INDEX },
	});
}
