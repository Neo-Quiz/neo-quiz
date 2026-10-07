/* THE MOODLE SERVICE (main process): login, state, sync, assignments. The
   bridge (`canaux.ts`) only relays verbs to it; the token lives here and in
   `jeton.ts`, and no value returned to the window carries it. Read-only
   towards Moodle: nothing is ever uploaded, nothing is deleted locally. */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { LOG_PREFIX } from "../../../../src/branding";
import type { CoursMoodle, DevoirMoodle, EtatMoodle, ResumeSyncMoodle } from "../pont";
import { CLE_REGLAGES_MOODLE } from "../pont";
import { hoteAutorise } from "../reseau";
import type { Reglages } from "../reglages";
import { listCourses, scanCourse } from "./api";
import { createClient, siteInfo, type Client, type OptionsClient } from "./client";
import { dejaPresent, dossierDuCours, downloadFiles, targetName, type Garde, type Job } from "./disque";
import { MoodleError, TokenError, masquer } from "./erreurs";
import { coursValides, origineSite } from "./garde";
import { creerMagasinJeton, type Chiffrement, type Jeton } from "./jeton";
import { extensionRefusee } from "../ressources";
import { allFiles, launchUrl, pendingDeposits, uniqueJobs, verifyLaunchToken } from "./pur";

export const LOGIN_TTL = 10 * 60 * 1000;
export const AUTO_SYNC_INTERVAL = 3600 * 1000;
const DEVOIRS_TTL = 5 * 60 * 1000;
export const OPEN_INTERVAL = 2000;
export const SYNC_INTERVAL = 10000;

export interface DepsMoodle {
	/** The default quiz root (`C:/Neo Quiz`), read at each use. */
	racine(): string;
	garde: Garde;
	reglages(): Reglages;
	/** The app's own data folder: the encrypted token and the small state file. */
	dossierDonnees: string;
	chiffrement: Chiffrement;
	/** Opens an https URL in the system browser (the caller checks the scheme). */
	ouvrirExterne(url: string): Promise<void>;
	envoyer(etat: EtatMoodle): void;
	maintenant?(): number;
	/** Tests only (`check:moodle`): see `OptionsClient`. Never set by the app. */
	essai?: OptionsClient;
}

export interface ServiceMoodle {
	etat(): Promise<EtatMoodle>;
	connecter(): Promise<void>;
	/** A `neo-quiz://token=` link: true when it was consumed as the answer to a
	    pending login (accepted or refused), false when none is pending. */
	recevoirJeton(b64: string): Promise<boolean>;
	deconnecter(): Promise<void>;
	cours(): Promise<CoursMoodle[]>;
	choisir(ids: unknown): Promise<number[]>;
	synchroniser(): Promise<ResumeSyncMoodle>;
	devoirs(): Promise<DevoirMoodle[]>;
	ouvrirDevoir(cmid: unknown): Promise<boolean>;
	/** At app start: syncs when connected, courses chosen and the last sync is old. */
	demarrerAuto(): Promise<void>;
}

interface Reglage { site: string; courses: number[] }
interface FichierEtat { lastSync: number | null; expired: boolean }

const msg = (e: unknown, secret?: string): string => masquer(e instanceof Error ? e.message : String(e), secret).slice(0, 200);

export function creerMoodle(deps: DepsMoodle): ServiceMoodle {
	const maintenant = deps.maintenant ?? Date.now;
	const magasin = creerMagasinJeton(path.join(deps.dossierDonnees, "moodle-token.bin"), deps.chiffrement);
	const fichierEtat = path.join(deps.dossierDonnees, "moodle-etat.json");
	let jeton: Jeton | null | undefined;
	let persistant: FichierEtat | null = null;
	let attente: { passport: string; site: string; expire: number } | null = null;
	let erreur: string | null = null;
	let enCours: Promise<ResumeSyncMoodle> | null = null;
	let progress: { done: number; total: number } | null = null;
	let dernierOuvert = 0;
	let dernierSync: { at: number; res: ResumeSyncMoodle } | null = null;
	let cache: { at: number; liste: DevoirMoodle[] } | null = null;

	async function lireEtat(): Promise<FichierEtat> {
		if (persistant) return persistant;
		try {
			const v = JSON.parse(await fs.readFile(fichierEtat, "utf-8")) as Partial<FichierEtat>;
			persistant = { lastSync: typeof v.lastSync === "number" ? v.lastSync : null, expired: v.expired === true };
		} catch {
			persistant = { lastSync: null, expired: false };
		}
		return persistant;
	}
	async function poserEtat(patch: Partial<FichierEtat>): Promise<void> {
		persistant = { ...(await lireEtat()), ...patch };
		await fs.mkdir(deps.dossierDonnees, { recursive: true });
		await fs.writeFile(fichierEtat, JSON.stringify(persistant), "utf-8");
	}
	async function lireJeton(): Promise<Jeton | null> {
		if (jeton === undefined) jeton = await magasin.lire();
		return jeton;
	}
	async function reglage(): Promise<Reglage> {
		let v: unknown;
		try { v = await deps.reglages().lire(CLE_REGLAGES_MOODLE); } catch { v = undefined; }
		const o = v && typeof v === "object" ? (v as { site?: unknown; courses?: unknown }) : {};
		return { site: origineSite(o.site, { http: !!deps.essai?.allowHttpForTests }) ?? "", courses: coursValides(o.courses) ? o.courses : [] };
	}
	/** The site, only when the network list admits its host. */
	async function siteAdmis(): Promise<string> {
		const { site } = await reglage();
		return site && hoteAutorise(site) ? site : "";
	}
	const nouveauClient = (token: string, site: string): Client => createClient(token, site, deps.essai);

	async function etat(): Promise<EtatMoodle> {
		const { site } = await reglage();
		const j = await lireJeton();
		const p = await lireEtat();
		const lie = !!j && !!site && j.site === site;
		let state: EtatMoodle["state"] = !lie ? "off" : p.expired ? "expired" : "connected";
		let err = erreur;
		if (site && !hoteAutorise(site)) { state = "error"; err = "site-not-allowed"; }
		else if (err && state !== "connected") state = "error";
		return {
			site, connected: state === "connected", fullname: lie ? j.fullname : "", state, error: state === "error" ? err : null,
			lastSync: p.lastSync, syncing: enCours !== null, loginPending: !!attente && maintenant() <= attente.expire, progress,
		};
	}
	async function pousser(): Promise<void> {
		try { deps.envoyer(await etat()); } catch { /* the window may be gone */ }
	}
	async function marquerExpire(): Promise<void> {
		await poserEtat({ expired: true });
		await pousser();
	}

	async function connecter(): Promise<void> {
		const site = await siteAdmis();
		if (!site) throw new MoodleError("nosite", "Set the Moodle site first.");
		if (!deps.chiffrement.disponible()) {
			erreur = "secure-storage-unavailable";
			await pousser();
			throw new MoodleError("nostorage", "Secure storage is unavailable on this computer: the login cannot be saved.");
		}
		if (attente && maintenant() <= attente.expire) throw new MoodleError("pending", "A login is already waiting for the browser.");
		erreur = null;
		// One passport at a time: a new login replaces the previous one.
		const passport = crypto.randomBytes(16).toString("hex");
		attente = { passport, site, expire: maintenant() + LOGIN_TTL };
		await deps.ouvrirExterne(launchUrl(site, passport, "neo-quiz"));
		await pousser();
	}

	async function recevoirJeton(b64: string): Promise<boolean> {
		// Routed ONLY while a login is pending; any other link is not ours.
		if (!attente || maintenant() > attente.expire) { attente = null; return false; }
		const { passport, site } = attente;
		let token: string | null = null;
		const candidats = new Set([b64]);
		try { candidats.add(decodeURIComponent(b64)); } catch { /* not percent-encoded */ }
		for (const c of candidats) {
			try { token = verifyLaunchToken(c, passport, site); break; } catch { /* next candidate */ }
		}
		if (!token) {
			console.warn(LOG_PREFIX, "Moodle: login link refused (it does not answer the pending request)");
			return true;
		}
		attente = null;
		const client = nouveauClient(token, site);
		try {
			const info = await siteInfo(client);
			await magasin.ecrire({ token, userid: info.userid, fullname: info.fullname, at: maintenant(), site });
			jeton = { token, userid: info.userid, fullname: info.fullname, at: maintenant(), site };
			erreur = null;
			cache = null;
			await poserEtat({ expired: false });
		} catch (e) {
			jeton = null;
			erreur = e instanceof MoodleError && e.code === "nostorage" ? "secure-storage-unavailable" : "login-failed";
			console.warn(LOG_PREFIX, "Moodle: login failed:", msg(e, token));
		} finally {
			client.close();
		}
		await pousser();
		return true;
	}

	async function deconnecter(): Promise<void> {
		attente = null;
		jeton = null;
		erreur = null;
		cache = null;
		await magasin.effacer();
		await poserEtat({ expired: false });
		await pousser();
	}

	/** The live token, the site and the user id, or null when not usable. */
	async function session(): Promise<{ j: Jeton; site: string } | null> {
		const site = await siteAdmis();
		const j = await lireJeton();
		if (!site || !j || j.site !== site || (await lireEtat()).expired) return null;
		return { j, site };
	}

	async function cours(): Promise<CoursMoodle[]> {
		const s = await session();
		if (!s) return [];
		const client = nouveauClient(s.j.token, s.site);
		try {
			const chosen = new Set((await reglage()).courses);
			return (await listCourses(client, s.j.userid)).map(c => ({
				id: c.id, name: c.name, code: c.code,
				folder: c.code ? dossierDuCours(deps.racine(), c.code, c.name).name : null,
				enabled: c.code !== null && chosen.has(c.id), available: c.code !== null,
			}));
		} catch (e) {
			if (e instanceof TokenError) await marquerExpire();
			throw new Error(msg(e, s.j.token));
		} finally {
			client.close();
		}
	}

	async function choisir(ids: unknown): Promise<number[]> {
		if (!coursValides(ids)) throw new Error("courses must be an array of positive integers");
		const known = new Set((await cours()).filter(c => c.available).map(c => c.id));
		const keep = [...new Set(ids)].filter(id => known.has(id));
		const actuel = (await deps.reglages().lire(CLE_REGLAGES_MOODLE)) as Record<string, unknown> | undefined;
		await deps.reglages().ecrire(CLE_REGLAGES_MOODLE, { ...(actuel && typeof actuel === "object" ? actuel : {}), courses: keep });
		cache = null;
		await pousser();
		return keep;
	}

	async function faireSync(): Promise<ResumeSyncMoodle> {
		const res: ResumeSyncMoodle = { nouveaux: 0, mis_a_jour: 0, echecs: 0, ignores: 0, erreur: null };
		const s = await session();
		if (!s) return { ...res, erreur: (await lireJeton()) && (await lireEtat()).expired ? "expired" : "not-connected" };
		const ids = (await reglage()).courses;
		if (!ids.length) return { ...res, erreur: "no-courses" };
		const client = nouveauClient(s.j.token, s.site);
		try {
			const courses = await listCourses(client, s.j.userid);
			const jobs: (Job & { fresh: boolean })[] = [];
			const liste: DevoirMoodle[] = [];
			for (const id of ids) {
				const c = courses.find(x => x.id === id && x.code);
				if (!c || !c.code) continue;
				const { dir } = dossierDuCours(deps.racine(), c.code, c.name);
				if (!(await deps.garde.contient(dir))) { res.echecs++; continue; }
				const scan = await scanCourse(client, c.id, dir);
				for (const d of pendingDeposits(scan)) {
					liste.push({ cmid: d.id, course: c.name, name: d.name, state: d.state as DevoirMoodle["state"], due: d.due, remaining: d.remaining });
				}
				for (const f of allFiles(scan)) {
					if (f.status !== "missing" && f.status !== "outdated") continue;
					const job = { file: f, dir, target: targetName(f), fresh: f.status === "missing" };
					// A file on another host, or a copy already there and not older: skipped.
					if (!client.memeSite(f.url) || extensionRefusee(job.target) || dejaPresent(job)) { res.ignores++; continue; }
					jobs.push(job);
				}
			}
			cache = { at: maintenant(), liste };
			const todo = uniqueJobs(jobs);
			progress = { done: 0, total: todo.length };
			await pousser();
			const out = await downloadFiles(client, todo, deps.garde, () => {
				if (progress) progress.done++;
				void pousser();
			});
			for (const o of out) {
				if (o.ok) { if (o.fresh) res.nouveaux++; else res.mis_a_jour++; }
				else if (o.skipped) res.ignores++;
				else res.echecs++;
			}
			await poserEtat({ lastSync: maintenant() });
			return res;
		} catch (e) {
			if (e instanceof TokenError) { await marquerExpire(); return { ...res, erreur: "expired" }; }
			console.warn(LOG_PREFIX, "Moodle: sync failed:", msg(e, s.j.token));
			const code = (e as { code?: string }).code ?? "";
			return { ...res, erreur: ["timeout", "network", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(code) ? "network" : "failed" };
		} finally {
			client.close();
			progress = null;
		}
	}

	function synchroniser(): Promise<ResumeSyncMoodle> {
		if (enCours) return enCours;
		// A finished sync cannot be re-triggered within 10 s: the last answer is returned.
		if (dernierSync && maintenant() - dernierSync.at < SYNC_INTERVAL) return Promise.resolve(dernierSync.res);
		const run = faireSync().then(res => { dernierSync = { at: maintenant(), res }; return res; }).finally(() => { enCours = null; void pousser(); });
		enCours = run;
		void pousser();
		return run;
	}

	async function devoirs(): Promise<DevoirMoodle[]> {
		if (cache && maintenant() - cache.at < DEVOIRS_TTL) return cache.liste;
		const s = await session();
		if (!s) return [];
		const ids = (await reglage()).courses;
		const client = nouveauClient(s.j.token, s.site);
		try {
			const liste: DevoirMoodle[] = [];
			for (const c of (await listCourses(client, s.j.userid)).filter(x => ids.includes(x.id))) {
				for (const d of pendingDeposits(await scanCourse(client, c.id, null))) {
					liste.push({ cmid: d.id, course: c.name, name: d.name, state: d.state as DevoirMoodle["state"], due: d.due, remaining: d.remaining });
				}
			}
			cache = { at: maintenant(), liste };
			return liste;
		} catch (e) {
			if (e instanceof TokenError) await marquerExpire();
			throw new Error(msg(e, s.j.token));
		} finally {
			client.close();
		}
	}

	async function ouvrirDevoir(cmid: unknown): Promise<boolean> {
		const site = await siteAdmis();
		if (!site || typeof cmid !== "number" || !Number.isSafeInteger(cmid) || cmid <= 0) return false;
		if (maintenant() - dernierOuvert < OPEN_INTERVAL) return false;
		dernierOuvert = maintenant();
		const url = new URL("/mod/assign/view.php", site);
		url.searchParams.set("id", String(cmid));
		await deps.ouvrirExterne(url.href);
		return true;
	}

	async function demarrerAuto(): Promise<void> {
		const s = await session();
		if (!s || !(await reglage()).courses.length) return;
		const { lastSync } = await lireEtat();
		if (lastSync !== null && maintenant() - lastSync < AUTO_SYNC_INTERVAL) return;
		await synchroniser();
	}

	return { etat, connecter, recevoirJeton, deconnecter, cours, choisir, synchroniser, devoirs, ouvrirDevoir, demarrerAuto };
}
