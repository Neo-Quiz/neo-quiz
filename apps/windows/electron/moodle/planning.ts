/* THE TIMETABLE OF THE MOODLE WINDOW (main process only): the link, its
   download and the cache of its sessions. Pure reading: `planning-pur.ts`.

   - The LINK holds a personal token: it is stored encrypted (`safeStorage`,
     like the Moodle token, never in plain text), and NOTHING returned to the
     window carries it, only its host. It is never logged.
   - The DOWNLOAD goes to exactly the link's host over https, every redirect
     hop included; the host must resolve to a public address (`creerLookup`).
     It is bounded in size and time. The window cannot name a URL to fetch:
     only the stored link is ever fetched.
   - The CACHE (`moodle-planning.json`) keeps the sessions (title and
     description, start, minutes), not the link (only a SHA-256 of it, to know
     a re-pasted link is the same one); it is refreshed at most every 6 h.
     Sessions ACCUMULATE: a feed that drops its past (`fusionnerSeances`) does
     not take the hours already done away from a module. */

import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";
import { creerLookup, type Resolveur } from "./adresse";
import type { EtatPlanning } from "../pont";
import type { Chiffrement } from "./jeton";
import { createHash } from "node:crypto";
import { MAX_ICS_OCTETS, MAX_SEANCES, fusionnerSeances, lienPlanning, lireIcs, seancesDuCode, volumesParCode, type Seance, type SeanceDetail, type Volume } from "./planning-pur";

export const PLANNING_TTL = 6 * 3600 * 1000;
const TIMEOUT = 30000;
const DEADLINE = 60000;
const MAX_REDIRECTS = 3;
/** A year holds ~30 modules; the cap bounds the matching work the window can ask for. */
const MAX_CODES = 100;


export interface DepsPlanning {
	dossierDonnees: string;
	chiffrement: Chiffrement;
	maintenant?(): number;
	/** Tests only: http and a local server, a fake resolver. Never set by the app. */
	essai?: { http?: boolean; resolveur?: Resolveur; timeout?: number };
}

export interface ServicePlanning {
	etat(): Promise<EtatPlanning>;
	/** Stores the link (already confirmed by the caller when its host is unknown) and downloads it. */
	poser(url: unknown): Promise<EtatPlanning>;
	effacer(): Promise<EtatPlanning>;
	/** Hours and sessions per code, downloading first when the cache is older than 6 h. */
	volumes(codes: unknown): Promise<Record<string, Volume>>;
	/** The sessions of one module from the cache (no download), for its detail. */
	seances(code: unknown): Promise<SeanceDetail[]>;
}

export class ErreurPlanning extends Error {
	constructor(readonly code: Exclude<EtatPlanning["erreur"], null> | "badlink") { super(code); }
}

/** GET of the timetable: same host on every hop, public address, bounded. The
    error never carries the URL (it holds the token). */
export function telechargerIcs(url: string, opts: { http?: boolean; resolveur?: Resolveur; timeout?: number } = {}): Promise<string> {
	const debut = new URL(url);
	const lib = opts.http ? http : https;
	const agent = new lib.Agent(opts.http ? {} : { lookup: creerLookup(opts.resolveur) });
	const hop = (cible: URL, redirections: number): Promise<string> => new Promise((resolve, reject) => {
		if (cible.protocol !== debut.protocol || cible.host !== debut.host || cible.username || cible.password) { reject(new ErreurPlanning("refused")); return; }
		const req = lib.request(cible, { agent, method: "GET", timeout: opts.timeout ?? TIMEOUT, headers: { Accept: "text/calendar, text/plain;q=0.5" } }, res => {
			const loc = res.headers.location;
			if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
				res.resume();
				if (redirections >= MAX_REDIRECTS) { reject(new ErreurPlanning("refused")); return; }
				let suivante: URL;
				try { suivante = new URL(loc, cible); } catch { reject(new ErreurPlanning("refused")); return; }
				hop(suivante, redirections + 1).then(resolve, reject);
				return;
			}
			if (res.statusCode !== 200) { res.resume(); reject(new ErreurPlanning("refused")); return; }
			const annonce = Number(res.headers["content-length"]);
			if (Number.isFinite(annonce) && annonce > MAX_ICS_OCTETS) { res.resume(); reject(new ErreurPlanning("toolarge")); return; }
			const morceaux: Buffer[] = [];
			let total = 0;
			res.on("data", (c: Buffer) => {
				total += c.length;
				if (total > MAX_ICS_OCTETS) req.destroy(new ErreurPlanning("toolarge"));
				else morceaux.push(c);
			});
			res.on("error", () => reject(new ErreurPlanning("network")));
			res.on("end", () => resolve(Buffer.concat(morceaux).toString("utf8")));
		});
		const limite = setTimeout(() => req.destroy(new ErreurPlanning("network")), DEADLINE);
		req.on("close", () => clearTimeout(limite));
		req.on("timeout", () => req.destroy(new ErreurPlanning("network")));
		req.on("error", e => reject(e instanceof ErreurPlanning ? e : new ErreurPlanning("network")));
		req.end();
	});
	return hop(debut, 0).finally(() => agent.destroy());
}

interface Cache { at: number; hote: string; empreinte: string; seances: Seance[] }

function cacheValide(v: unknown): Cache | null {
	if (!v || typeof v !== "object") return null;
	const o = v as Record<string, unknown>;
	if (typeof o.at !== "number" || typeof o.hote !== "string" || typeof o.empreinte !== "string" || !Array.isArray(o.seances)) return null;
	const seances = o.seances.slice(0, MAX_SEANCES).filter((s): s is Seance => !!s && typeof s === "object"
		&& typeof (s as Seance).texte === "string" && typeof (s as Seance).cle === "string"
		&& [(s as Seance).minutes, (s as Seance).debut].every(n => typeof n === "number" && Number.isFinite(n)));
	return { at: o.at, hote: o.hote, empreinte: o.empreinte, seances };
}

export function creerPlanning(deps: DepsPlanning): ServicePlanning {
	const maintenant = deps.maintenant ?? Date.now;
	const fichierLien = path.join(deps.dossierDonnees, "moodle-planning.bin");
	const fichierCache = path.join(deps.dossierDonnees, "moodle-planning.json");
	let erreur: EtatPlanning["erreur"] = null;
	let enCours: Promise<void> | null = null;
	/** A failed download is not retried for 10 minutes: each window opening would hit the school server. */
	let echecA = 0;
	let memo: { cle: string; res: Record<string, Volume> } | null = null;

	const empreinteDe = (url: string): string => createHash("sha256").update(url).digest("hex");
	async function lireLien(): Promise<{ url: string; hote: string } | null> {
		let brut: Buffer;
		try { brut = await fs.readFile(fichierLien); } catch { return null; }
		if (!deps.chiffrement.disponible()) return null;
		try { return lienPlanning(JSON.parse(deps.chiffrement.dechiffrer(brut)).url, { http: deps.essai?.http }); } catch { return null; }
	}
	async function lireCache(): Promise<Cache | null> {
		try { return cacheValide(JSON.parse(await fs.readFile(fichierCache, "utf8"))); } catch { return null; }
	}
	async function ecrireAtomique(fichier: string, data: string | Buffer): Promise<void> {
		await fs.mkdir(deps.dossierDonnees, { recursive: true });
		const tmp = `${fichier}.${process.pid}.tmp`;
		await fs.writeFile(tmp, data);
		await fs.rename(tmp, fichier);
	}
	async function etat(): Promise<EtatPlanning> {
		const lien = await lireLien();
		const cache = lien ? await lireCache() : null;
		return { hote: lien?.hote ?? null, at: lien && cache && cache.empreinte === empreinteDe(lien.url) ? cache.at : null, erreur: lien ? erreur : null };
	}
	/** One download at a time; a failure keeps the previous cache. */
	function rafraichir(): Promise<void> {
		enCours ??= (async () => {
			const lien = await lireLien();
			if (!lien) return;
			try {
				const nouvelles = lireIcs(await telechargerIcs(lien.url, deps.essai ?? {}));
				if (!nouvelles.length) throw new ErreurPlanning("empty");
				const empreinte = empreinteDe(lien.url);
				const ancien = await lireCache();
				const connues = ancien && ancien.empreinte === empreinte ? ancien.seances : [];
				await ecrireAtomique(fichierCache, JSON.stringify({ at: maintenant(), hote: lien.hote, empreinte, seances: fusionnerSeances(connues, nouvelles) }));
				erreur = null;
				echecA = 0;
			} catch (e) {
				erreur = e instanceof ErreurPlanning && e.code !== "badlink" ? e.code : "network";
				echecA = maintenant();
			}
		})().finally(() => { enCours = null; });
		return enCours;
	}
	async function poser(url: unknown): Promise<EtatPlanning> {
		const lien = lienPlanning(url, { http: deps.essai?.http });
		if (!lien) throw new ErreurPlanning("badlink");
		if (!deps.chiffrement.disponible()) throw new ErreurPlanning("nostorage");
		await ecrireAtomique(fichierLien, deps.chiffrement.chiffrer(JSON.stringify({ url: lien.url })));
		// Another link: the sessions known so far belong to another timetable. The same one re-pasted keeps them.
		const cache = await lireCache();
		if (cache && cache.empreinte !== empreinteDe(lien.url)) await fs.rm(fichierCache, { force: true });
		erreur = null;
		echecA = 0;
		await rafraichir();
		return etat();
	}
	async function effacer(): Promise<EtatPlanning> {
		await fs.rm(fichierLien, { force: true });
		await fs.rm(fichierCache, { force: true });
		erreur = null;
		return etat();
	}
	async function volumes(codes: unknown): Promise<Record<string, Volume>> {
		if (!Array.isArray(codes) || codes.length > MAX_CODES) return {};
		const liste = codes.filter((c): c is string => typeof c === "string" && /^[A-Za-z0-9-]{2,32}$/.test(c));
		const lien = await lireLien();
		if (!lien) return {};
		let cache = await lireCache();
		const empreinte = empreinteDe(lien.url);
		const perime = !cache || cache.empreinte !== empreinte || maintenant() - cache.at > PLANNING_TTL;
		if (perime && maintenant() - echecA > 10 * 60 * 1000) {
			await rafraichir();
			cache = await lireCache();
		}
		if (!cache || cache.empreinte !== empreinte) return {};
		// The same question on the same cache: the last answer (the window asks at every opening).
		const cle = `${cache.at}|${liste.join(",")}`;
		if (memo?.cle !== cle) memo = { cle, res: volumesParCode(cache.seances, liste) };
		return memo.res;
	}
	async function seances(code: unknown): Promise<SeanceDetail[]> {
		if (typeof code !== "string" || !/^[A-Za-z0-9-]{2,32}$/.test(code)) return [];
		const lien = await lireLien();
		const cache = lien ? await lireCache() : null;
		return lien && cache && cache.empreinte === empreinteDe(lien.url) ? seancesDuCode(cache.seances, code) : [];
	}
	return { etat, poser, effacer, volumes, seances };
}
