/* THE MOODLE SERVICE (main process): login, state, courses, downloads,
   assignments. The bridge (`canaux.ts`) only relays verbs to it; the token
   lives here and in `jeton.ts`, and no value returned to the window carries
   it (nor a file URL). Read-only towards Moodle: nothing is ever uploaded,
   nothing is deleted locally. */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import type { Stats } from "node:fs";
import * as path from "node:path";
import { LOG_PREFIX } from "../../../../src/branding";
import { isConflictCopy } from "../../../../src/review/paths";
import type {
	ActiviteMoodle, CoursMoodle, DevoirMoodle, ModuleMoodle, EtatMoodle, FichierMoodle, FichierNouveauMoodle, ResultatRechercheMoodle, ResumeMoodle, ResumeSyncMoodle,
} from "../pont";
import { CLE_REGLAGES_MOODLE } from "../pont";
import { hoteAutorise } from "../reseau";
import type { Reglages } from "../reglages";
import { coursesByIds, listCourses, scanCourseBrut, searchCourses } from "./api";
import { createClient, siteInfo, MAX_FILE_BYTES, type Client, type OptionsClient } from "./client";
import { ensembleParDefaut, estDans, dossierDepot, idDepuisUrl, suivis, type CoursChoisi } from "./cours";
import { applyStatus, dejaPresent, dossierDuCours, downloadFiles, targetName, type Garde, type Job } from "./disque";
import { MoodleError, TokenError, masquer } from "./erreurs";
import { MAX_IDS, SITE_DEFAUT, coursValides, origineSite } from "./garde";
import { creerMagasinJeton, type Chiffrement, type Jeton } from "./jeton";
import { depuisAncien, ecrireTable, fusionner, lireTable, poser, type ListeCle, type TableListes } from "./listes";
import { extensionRefusee } from "../ressources";
import { allFiles, decisionAuto, depositState, launchUrl, lienExterne, limiter, pendingDeposits, uniqueJobs, verifyLaunchToken, withinBudget, RUN_MAX_FILES, RUN_MAX_BYTES, type Course, type MoodleFile, type Scan } from "./pur";

export const LOGIN_TTL = 10 * 60 * 1000;
export const AUTO_SYNC_INTERVAL = 3600 * 1000;
const DEVOIRS_TTL = 5 * 60 * 1000;
export const OPEN_INTERVAL = 2000;
export const SYNC_INTERVAL = 10000;
const MAX_FICHIERS = 2000;
const MAX_TEXTE = 100;
/** The catalogue is kept this long, and a verb called twice within the floor gets the first answer. */
export const CATALOGUE_TTL = 30000;
export const VERB_FLOOR = 1000;
/** The gap between two calls of a verb when it is not `VERB_FLOOR`: a module is
    read three at a time (`MODULES_EN_VOL`), so the window's check of a year
    of ~25 modules takes seconds, not half a minute, and still never more than
    ~3 module reads per second reach the school server. */
const ECART_VERBES: Readonly<Record<string, number>> = { module: 300 };
export const MODULES_EN_VOL = 3;
/** What Moodle said about a course is reused this long (kept on disk, so an app
    restart does not ask again): opening the window, a module, a file or the
    hand-ins never reaches the school server inside it. Refresh (F5) forces. A
    burst of requests at every start of a development build looked like a robot
    to the school's firewall (2026-10-17). */
export const SCAN_TTL = 3 * 3600 * 1000;
/** The automatic sync wants fresher news: a scan older than this is fetched again. */
const SCAN_TTL_SYNC = AUTO_SYNC_INTERVAL - 5 * 60 * 1000;
const MAX_SCANS = 200;
/** Followed `extra` courses (the rest of the setting is kept but not fetched). */
export const MAX_EXTRA_SUIVIS = 50;
/** New files of full syncs kept for the window until it takes them (the oldest go first). */
export const MAX_NOUVEAUX = 500;

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
	/** Opens a file or a folder of the quiz root with the system (the service
	    has already bounded the path and refused executable types). */
	ouvrirChemin(abs: string): Promise<boolean>;
	envoyer(etat: EtatMoodle): void;
	/** A full sync downloaded new files: tells the window to take them (`prendreNouveaux`). Absent in most tests. */
	signalerNouveaux?(): void;
	/** True when the connection is metered (`connexion-limitee.ts`); absent = never. Only AUTOMATIC runs ask. */
	limitee?(): Promise<boolean>;
	maintenant?(): number;
	/** Runs `fn` every `ms` until the returned function is called. Tests inject a fake clock. */
	planifier?(fn: () => void, ms: number): () => void;
	/** Tests only (`check:moodle`): see `OptionsClient`. Never set by the app. */
	essai?: OptionsClient;
	/** Tests only: no catalogue cache and no per-verb floor (most cases call a verb twice on purpose). */
	essaiSansLimite?: boolean;
	/** Tests only: the per-run budget of an automatic download. */
	budget?: { fichiers: number; octets: number };
}

export interface ServiceMoodle {
	etat(): Promise<EtatMoodle>;
	connecter(): Promise<void>;
	/** A `neo-quiz://token=` link: true when it was consumed as the answer to a
	    pending login (accepted or refused), false when none is pending. */
	recevoirJeton(b64: string): Promise<boolean>;
	deconnecter(): Promise<void>;
	cours(): Promise<CoursMoodle[]>;
	chercher(texte: unknown): Promise<ResultatRechercheMoodle[]>;
	ajouterParUrl(url: unknown): Promise<CoursMoodle>;
	favori(id: unknown, on: unknown): Promise<number[]>;
	exclure(id: unknown, on: unknown): Promise<number[]>;
	ajouter(id: unknown): Promise<number[]>;
	retirer(id: unknown): Promise<number[]>;
	fichiers(courseId: unknown): Promise<FichierMoodle[]>;
	/** `force` true asks Moodle now; otherwise a scan younger than `SCAN_TTL` is reused. */
	module(courseId: unknown, force?: unknown): Promise<ModuleMoodle>;
	telechargerCours(courseId: unknown): Promise<ResumeSyncMoodle>;
	telechargerFichier(courseId: unknown, nom: unknown): Promise<ResumeSyncMoodle>;
	ouvrirDossier(courseId: unknown): Promise<boolean>;
	ouvrirFichier(courseId: unknown, nom: unknown): Promise<boolean>;
	synchroniser(): Promise<ResumeSyncMoodle>;
	devoirs(): Promise<DevoirMoodle[]>;
	ouvrirDevoir(cmid: unknown): Promise<boolean>;
	ouvrirActivite(type: unknown, cmid: unknown): Promise<boolean>;
	deposer(cmid: unknown): Promise<boolean>;
	devoirVu(cmid: unknown): Promise<void>;
	ignorerDevoir(cmid: unknown, on: unknown): Promise<number[]>;
	/** At app start: a first automatic check, then one every hour while the app runs. */
	demarrerAuto(): Promise<void>;
	/** The new files of the last FULL syncs, oldest first, at most `MAX_NOUVEAUX`; taking them clears them. */
	prendreNouveaux(): Promise<FichierNouveauMoodle[]>;
}

interface Reglage {
	site: string;
	auto: boolean;
	favoris: number[];
	exclus: number[];
	extra: number[];
	ignores: number[];
	vus: number[];
}
interface FichierEtat { lastSync: number | null; expired: boolean; summary: ResumeMoodle | null }
interface DevoirBrut { cmid: number; courseId: number; course: string; dossier: string; name: string; state: DevoirMoodle["state"]; due: number; remaining: number }
/** The app's device id (`apps/windows/src/host/device.ts`), which names this device's shared lists file. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FICHIER_LISTES = 256 * 1024;
const MAX_FICHIERS_LISTES = 64;

const msg = (e: unknown, secret?: string): string => masquer(e instanceof Error ? e.message : String(e), secret).slice(0, 200);
const entierPositif = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
function idOuErreur(v: unknown): number {
	if (!entierPositif(v)) throw new MoodleError("badid", "Invalid id.");
	return v;
}
function boolOuErreur(v: unknown): boolean {
	if (typeof v !== "boolean") throw new MoodleError("badarg", "Expected a boolean.");
	return v;
}
const lireListe = (v: unknown): number[] => (coursValides(v) ? v : []);
const nomValide = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 255;

function resumeValide(v: unknown): ResumeMoodle | null {
	if (!v || typeof v !== "object") return null;
	const o = v as Record<string, unknown>;
	const n = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
	if (!n(o.nouveaux) || !n(o.misAJour) || !n(o.echecs) || !o.parCours || typeof o.parCours !== "object") return null;
	const parCours: Record<string, number> = {};
	for (const [k, x] of Object.entries(o.parCours as Record<string, unknown>).slice(0, MAX_IDS)) {
		if (n(x) && /^[A-Za-z0-9]{1,16}$/.test(k)) parCours[k] = x;
	}
	return { nouveaux: o.nouveaux, misAJour: o.misAJour, echecs: o.echecs, parCours };
}

export function creerMoodle(deps: DepsMoodle): ServiceMoodle {
	const maintenant = deps.maintenant ?? Date.now;
	const planifier = deps.planifier ?? ((fn: () => void, ms: number) => {
		const h = setInterval(fn, ms);
		h.unref?.();
		return () => clearInterval(h);
	});
	const magasin = creerMagasinJeton(path.join(deps.dossierDonnees, "moodle-token.bin"), deps.chiffrement);
	const fichierEtat = path.join(deps.dossierDonnees, "moodle-etat.json");
	let jeton: Jeton | null | undefined;
	let persistant: FichierEtat | null = null;
	let attente: { passport: string; site: string; expire: number } | null = null;
	let erreur: string | null = null;
	let enCours: Promise<ResumeSyncMoodle> | null = null;
	let progress: { done: number; total: number } | null = null;
	/** The last automatic run was skipped because the connection is metered. */
	let pauseLimitee = false;
	let dernierOuvert = 0;
	let dernierSync: { at: number; res: ResumeSyncMoodle } | null = null;
	let cache: { at: number; liste: DevoirBrut[] } | null = null;
	let arreterHoraire: (() => void) | null = null;
	/** Fresh files of full syncs not taken by the window yet. Kept here, not pushed:
	    the first automatic run can finish before the window listens. */
	let enAttente: FichierNouveauMoodle[] = [];
	let ecriture: Promise<unknown> = Promise.resolve();
	const echecsFichiers = new Map<number, Set<string>>();
	let catCache: { at: number; userid: number; liste: CoursChoisi[] } | null = null;
	const memos = new Map<string, { at: number; val: Promise<unknown> }>();
	const modulesEnVol = limiter(MODULES_EN_VOL);
	const fichierScans = path.join(deps.dossierDonnees, "moodle-scans.json");
	let scans: Map<number, { at: number; brut: Scan }> | null = null;
	let ecritureScans: Promise<unknown> = Promise.resolve();
	async function chargerScans(): Promise<Map<number, { at: number; brut: Scan }>> {
		if (scans) return scans;
		const m = new Map<number, { at: number; brut: Scan }>();
		try {
			const v: unknown = JSON.parse(await fs.readFile(fichierScans, "utf-8"));
			for (const [k, e] of Object.entries(v && typeof v === "object" ? v as Record<string, unknown> : {}).slice(0, MAX_SCANS)) {
				const o = e as { at?: unknown; brut?: { sections?: unknown; external?: unknown } } | null;
				if (!entierPositif(Number(k)) || !o || typeof o.at !== "number" || !o.brut || !Array.isArray(o.brut.sections) || !Array.isArray(o.brut.external)) continue;
				m.set(Number(k), { at: o.at, brut: o.brut as Scan });
			}
		} catch { /* none yet, or unreadable: asked again */ }
		scans = m;
		return m;
	}
	/** The scan of a course with its local statuses: Moodle's answer kept on
	    disk is reused while younger than `ttl` (0 asks Moodle now). */
	async function scanEnCache(client: Client, id: number, dir: string | null, ttl: number): Promise<{ scan: Scan; at: number }> {
		const m = await chargerScans();
		const e = m.get(id);
		if (e && ttl > 0 && maintenant() - e.at < ttl && e.at <= maintenant()) return { scan: applyStatus(structuredClone(e.brut), dir), at: e.at };
		const brut = await scanCourseBrut(client, id);
		const at = maintenant();
		m.delete(id);
		m.set(id, { at, brut: structuredClone(brut) });
		while (m.size > MAX_SCANS) m.delete(m.keys().next().value as number);
		const run = ecritureScans.then(async () => {
			await fs.mkdir(deps.dossierDonnees, { recursive: true });
			const tmp = `${fichierScans}.${process.pid}.tmp`;
			await fs.writeFile(tmp, JSON.stringify(Object.fromEntries(m)), "utf-8");
			await fs.rename(tmp, fichierScans);
		});
		ecritureScans = run.catch(e2 => console.warn(LOG_PREFIX, "Moodle: scan cache not written:", msg(e2)));
		return { scan: applyStatus(brut, dir), at };
	}
	const dernierVerbe = new Map<string, number>();
	/** Forgets what the throttle kept: after a write or a download, the next read is fresh. */
	const oublier = (): void => {
		catCache = null;
		for (const k of memos.keys()) if (!k.startsWith("telechargerCours|")) memos.delete(k);
	};
	/** 1 s floor per verb: the same call within the floor returns the first answer;
	    another call of the verb waits for its turn, 1 s (or `ECART_VERBES`) after
	    the previous one (a page cannot hammer the school server). */
	function limite<T>(verbe: string, cle: string, fn: () => Promise<T>): Promise<T> {
		if (deps.essaiSansLimite) return fn();
		const k = verbe + "|" + cle;
		const m = memos.get(k);
		const t = maintenant();
		if (m && t - m.at < VERB_FLOOR) return m.val as Promise<T>;
		const attente = Math.max(0, (dernierVerbe.get(verbe) ?? 0) + (ECART_VERBES[verbe] ?? VERB_FLOOR) - t);
		dernierVerbe.set(verbe, t + attente);
		const val = (attente ? new Promise<void>(r => setTimeout(r, attente)) : Promise.resolve()).then(fn);
		memos.set(k, { at: t + attente, val });
		val.catch(() => { if (memos.get(k)?.val === val) memos.delete(k); });
		return val;
	}

	async function lireEtat(): Promise<FichierEtat> {
		if (persistant) return persistant;
		try {
			const v = JSON.parse(await fs.readFile(fichierEtat, "utf-8")) as Partial<FichierEtat>;
			persistant = { lastSync: typeof v.lastSync === "number" ? v.lastSync : null, expired: v.expired === true, summary: resumeValide(v.summary) };
		} catch {
			persistant = { lastSync: null, expired: false, summary: null };
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
	async function brut(): Promise<Record<string, unknown>> {
		let v: unknown;
		try { v = await deps.reglages().lire(CLE_REGLAGES_MOODLE); } catch { v = undefined; }
		return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
	}
	async function reglage(): Promise<Reglage> {
		const o = await brut();
		// No site written: the school's own. A written site that is not a plain https origin: none.
		const site = o.site === undefined || o.site === "" ? SITE_DEFAUT : (origineSite(o.site, { http: !!deps.essai?.allowHttpForTests }) ?? "");
		const l = await listes(o);
		return {
			site, auto: o.auto !== false,
			favoris: l.favoris, exclus: l.exclus, extra: l.extra, ignores: l.devoirsIgnores, vus: l.devoirsVus,
		};
	}
	/** The private lists of the setting: before the shared file, and without a device id. */
	const anciennes = (o: Record<string, unknown>): Record<ListeCle, number[]> => ({
		favoris: lireListe(o.favoris), exclus: lireListe(o.exclus), extra: lireListe(o.extra),
		devoirsIgnores: lireListe(o.devoirsIgnores), devoirsVus: lireListe(o.devoirsVus),
	});
	async function appareil(): Promise<string | null> {
		let v: unknown;
		try { v = await deps.reglages().lire("deviceId"); } catch { return null; }
		return typeof v === "string" && UUID.test(v) ? v : null;
	}
	const dossierListes = (): string => path.join(deps.racine(), ".neo-quiz", "moodle");
	async function lireFichierListes(abs: string): Promise<TableListes | null> {
		let st: Stats;
		try { st = await fs.stat(abs); } catch { return null; }
		// Present but too big or unreadable: an empty table, never a reason to start over from the old list.
		if (!st.isFile() || st.size > MAX_FICHIER_LISTES) return {};
		try {
			return lireTable(JSON.parse(await fs.readFile(abs, "utf-8")), maintenant() + 24 * 3600 * 1000);
		} catch {
			// Unreadable: kept aside once, never silently lost when this device rewrites its own file.
			await fs.copyFile(abs, `${abs}.bad`).catch(() => undefined);
			return {};
		}
	}
	/** This device's file (null when it has none yet) and every other device's. */
	async function lirePartage(id: string): Promise<{ own: TableListes | null; autres: TableListes[] }> {
		const dir = dossierListes();
		const ownNom = `${id}.json`;
		const own = await lireFichierListes(path.join(dir, ownNom));
		let noms: string[] = [];
		try { noms = await fs.readdir(dir); } catch { /* no device has written yet */ }
		const autres: TableListes[] = [];
		for (const nom of noms.filter(n => n !== ownNom && n.endsWith(".json") && !n.startsWith(".") && !isConflictCopy(n)).sort().slice(0, MAX_FICHIERS_LISTES)) {
			const t = await lireFichierListes(path.join(dir, nom));
			if (t) autres.push(t);
		}
		return { own, autres };
	}
	async function ecrirePartage(id: string, t: TableListes): Promise<void> {
		const dir = dossierListes();
		await fs.mkdir(dir, { recursive: true });
		const cible = path.join(dir, `${id}.json`);
		const tmp = `${cible}.${process.pid}.tmp`;
		await fs.writeFile(tmp, ecrireTable(t), "utf-8");
		await fs.rename(tmp, cible);
	}
	/** One write at a time, on the same queue as the setting. */
	function enFile<T>(fn: () => Promise<T>): Promise<T> {
		const run = ecriture.then(fn);
		ecriture = run.catch(() => undefined);
		return run;
	}
	/** The lists every part of the service reads: the merge of every device's file, or the private ones without a device id. */
	async function listes(o: Record<string, unknown>): Promise<Record<ListeCle, number[]>> {
		const id = await appareil();
		if (!id) return anciennes(o);
		const { own, autres } = await lirePartage(id);
		let base = own;
		if (!base) {
			// First read on this device: the old private list becomes its file, so the other devices see it too.
			// Checked again inside the queue: a gesture written meanwhile must not be overwritten by the old list.
			base = await enFile(async () => {
				const deja = await lireFichierListes(path.join(dossierListes(), `${id}.json`));
				if (deja) return deja;
				const t = depuisAncien(anciennes(await brut()));
				await ecrirePartage(id, t);
				return t;
			}).catch(e => {
				console.warn(LOG_PREFIX, "Moodle: could not write the shared lists:", msg(e));
				return depuisAncien(anciennes(o));
			});
		}
		const f = fusionner([base, ...autres]);
		for (const k of Object.keys(f) as ListeCle[]) f[k] = f[k].slice(-MAX_IDS);
		return f;
	}
	/** Read-modify-write of the key, one at a time (two quick clicks never lose one). */
	function modifier(fn: (o: Record<string, unknown>) => void): Promise<void> {
		const run = ecriture.then(async () => {
			const o = await brut();
			fn(o);
			await deps.reglages().ecrire(CLE_REGLAGES_MOODLE, o);
			oublier();
		});
		ecriture = run.catch(() => undefined);
		return run;
	}
	/** Adds or removes `id` in one list and returns the new list: in this device's
	    shared file, or in the setting when the app has no device id yet. */
	async function basculer(cle: ListeCle, id: number, on: boolean, ancien: "refuser" | "oublier"): Promise<number[]> {
		const appareilId = await appareil();
		if (appareilId) {
			return enFile(async () => {
				const { own, autres } = await lirePartage(appareilId);
				const base = own ?? depuisAncien(anciennes(await brut()));
				const avant = fusionner([base, ...autres])[cle];
				if (on && !avant.includes(id) && avant.length >= MAX_IDS && ancien === "refuser") throw new MoodleError("toomany", "Too many entries.");
				// Later than any gesture already known for this id, whatever the other device's clock says.
				const dejaVu = [base, ...autres].reduce((m, t) => Math.max(m, t[cle]?.[String(id)]?.at ?? 0), 0);
				const t = poser(base, cle, id, on, Math.max(maintenant(), dejaVu + 1));
				await ecrirePartage(appareilId, t);
				oublier();
				return fusionner([t, ...autres])[cle].slice(-MAX_IDS);
			});
		}
		let res: number[] = [];
		await modifier(o => {
			let l = lireListe(o[cle]).filter(x => x !== id);
			if (on) {
				if (l.length >= MAX_IDS) {
					if (ancien === "refuser") throw new MoodleError("toomany", "Too many entries.");
					l = l.slice(l.length - MAX_IDS + 1);
				}
				l.push(id);
			}
			o[cle] = l;
			res = l;
		});
		return res;
	}
	/** The site, only when the network list admits its host. */
	async function siteAdmis(): Promise<string> {
		const { site } = await reglage();
		return site && hoteAutorise(site) ? site : "";
	}
	const nouveauClient = (token: string, site: string): Client => createClient(token, site, deps.essai);

	async function etat(): Promise<EtatMoodle> {
		const { site, auto } = await reglage();
		const j = await lireJeton();
		const p = await lireEtat();
		const lie = !!j && !!site && j.site === site;
		let state: EtatMoodle["state"] = !lie ? "off" : p.expired ? "expired" : "connected";
		let err = erreur;
		if (site && !hoteAutorise(site)) { state = "error"; err = "site-not-allowed"; }
		else if (err && state !== "connected") state = "error";
		return {
			site, connected: state === "connected", fullname: lie ? j.fullname : "", state, error: state === "error" ? err : null,
			lastSync: p.lastSync, auto, lastCheck: p.lastSync, lastSummary: p.summary, pausedMetered: auto && pauseLimitee,
			syncing: enCours !== null, loginPending: !!attente && maintenant() <= attente.expire, progress,
		};
	}
	async function pousser(): Promise<void> {
		try { deps.envoyer(await etat()); } catch { /* the window may be gone */ }
	}
	async function marquerExpire(): Promise<void> {
		oublier();
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
		let connecte = false;
		try {
			const info = await siteInfo(client);
			await magasin.ecrire({ token, userid: info.userid, fullname: info.fullname, at: maintenant(), site });
			jeton = { token, userid: info.userid, fullname: info.fullname, at: maintenant(), site };
			erreur = null;
			cache = null;
			oublier();
			await poserEtat({ expired: false });
			connecte = true;
		} catch (e) {
			jeton = null;
			erreur = e instanceof MoodleError && e.code === "nostorage" ? "secure-storage-unavailable" : "login-failed";
			console.warn(LOG_PREFIX, "Moodle: login failed:", msg(e, token));
		} finally {
			client.close();
		}
		await pousser();
		// Right after sign-in: a first download (only when `auto` is on).
		if (connecte) void verifierAuto().catch(() => undefined);
		return true;
	}

	async function deconnecter(): Promise<void> {
		attente = null;
		pauseLimitee = false;
		enAttente = [];
		jeton = null;
		erreur = null;
		cache = null;
		oublier();
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
	/** One authenticated call sequence: client opened, closed, a dead token marked. */
	async function avecClient<T>(fn: (client: Client, s: { j: Jeton; site: string }) => Promise<T>): Promise<T | null> {
		const s = await session();
		if (!s) return null;
		const client = nouveauClient(s.j.token, s.site);
		try {
			return await fn(client, s);
		} catch (e) {
			if (e instanceof TokenError) await marquerExpire();
			if (e instanceof MoodleError && ["badid", "badarg", "badurl", "nocourse", "nocode", "toomany", "unknown-course"].includes(e.code)) throw e;
			throw new Error(msg(e, s.j.token));
		} finally {
			client.close();
		}
	}

	/** The listed courses: enrolled in progress with a code, added, favourites. */
	async function catalogue(client: Client, userid: number): Promise<CoursChoisi[]> {
		if (!deps.essaiSansLimite && catCache && catCache.userid === userid && maintenant() - catCache.at < CATALOGUE_TTL) return catCache.liste;
		const liste = await catalogueFrais(client, userid);
		catCache = { at: maintenant(), userid, liste };
		return liste;
	}
	async function catalogueFrais(client: Client, userid: number): Promise<CoursChoisi[]> {
		const inscrits = await listCourses(client, userid);
		const lu = await reglage();
		// Only the last MAX_EXTRA_SUIVIS added courses are followed (and fetched).
		const r = { ...lu, extra: lu.extra.slice(-MAX_EXTRA_SUIVIS) };
		const manquants = [...new Set([...r.extra, ...r.favoris])].filter(id => !inscrits.some(c => c.id === id));
		let connus: Course[] = [];
		if (manquants.length) {
			try { connus = await coursesByIds(client, manquants); } catch (e) { if (e instanceof TokenError) throw e; }
		}
		return ensembleParDefaut(inscrits, connus, r, maintenant());
	}
	function versCours(c: CoursChoisi): CoursMoodle {
		const f = c.course.code ? dossierDuCours(deps.racine(), c.course.code, c.course.name, new Date(maintenant())) : null;
		return {
			id: c.course.id, name: c.course.name, code: c.course.code, folder: f ? f.name : null, folderExists: f ? f.exists : false,
			favori: c.favori, exclu: c.exclu, enCours: c.enCours, extra: c.extra,
			annee: c.course.yearKey, cohorte: c.course.cohort,
		};
	}
	async function coursConnu(client: Client, userid: number, id: number): Promise<CoursChoisi> {
		const c = (await catalogue(client, userid)).find(x => x.course.id === id);
		if (!c) throw new MoodleError("unknown-course", "Unknown course.");
		return c;
	}

	function cours(): Promise<CoursMoodle[]> {
		return limite("cours", "", async () => (await avecClient(async (client, s) => (await catalogue(client, s.j.userid)).map(versCours))) ?? []);
	}

	async function chercher(texte: unknown): Promise<ResultatRechercheMoodle[]> {
		if (typeof texte !== "string") throw new MoodleError("badarg", "Expected a text.");
		const t = texte.trim();
		if (t.length > MAX_TEXTE) throw new MoodleError("badarg", "Search text too long.");
		if (!t) return [];
		return limite("chercher", t, async () => (await avecClient(async (client, s) => {
			const trouves = await searchCourses(client, t);
			const connus = new Set((await catalogue(client, s.j.userid)).map(c => c.course.id));
			return trouves.filter(c => c.code).slice(0, 50).map(c => ({ id: c.id, name: c.name, code: c.code as string, dansListe: connus.has(c.id) }));
		})) ?? []);
	}

	/** Moodle must know the course, and it must have a code (else nothing could be filed). */
	async function verifierCours(client: Client, id: number): Promise<Course> {
		const c = (await coursesByIds(client, [id])).find(x => x.id === id);
		if (!c) throw new MoodleError("nocourse", "Moodle does not know this course.");
		if (!c.code) throw new MoodleError("nocode", "This course has no module code.");
		return c;
	}
	async function ajouter(id: unknown): Promise<number[]> {
		const n = idOuErreur(id);
		const res = await avecClient(async client => { await verifierCours(client, n); return basculer("extra", n, true, "refuser"); });
		if (!res) throw new MoodleError("notconnected", "Not connected to Moodle.");
		return res;
	}
	async function retirer(id: unknown): Promise<number[]> {
		return basculer("extra", idOuErreur(id), false, "refuser");
	}
	async function ajouterParUrl(url: unknown): Promise<CoursMoodle> {
		const site = await siteAdmis();
		const id = site ? idDepuisUrl(url, site) : null;
		if (id === null) throw new MoodleError("badurl", "Not a course address of this Moodle site.");
		const res = await avecClient(async (client, s) => {
			await verifierCours(client, id);
			await basculer("extra", id, true, "refuser");
			return versCours(await coursConnu(client, s.j.userid, id));
		});
		if (!res) throw new MoodleError("notconnected", "Not connected to Moodle.");
		return res;
	}
	const favori = async (id: unknown, on: unknown): Promise<number[]> => basculer("favoris", idOuErreur(id), boolOuErreur(on), "refuser");
	const exclure = async (id: unknown, on: unknown): Promise<number[]> => basculer("exclus", idOuErreur(id), boolOuErreur(on), "refuser");

	/** Where a file is, or will go, below the module folder. */
	function cheminRelatif(f: MoodleFile): string {
		if (f.status === "present") return f.localName ?? f.name;
		return targetName(f);
	}

	function versFichier(f: MoodleFile, dossier: string, echecs: Set<string> | undefined): FichierMoodle {
		const status = f.status === "present" ? "present" : echecs?.has(f.name) ? "failed" : f.status === "outdated" ? "outdated" : "missing";
		return {
			name: f.name, section: "", size: f.size, status, date: f.timemodified,
			relPath: [dossier, ...cheminRelatif(f).split(/[\/]/)].join("/"),
		};
	}

	async function fichiers(courseId: unknown): Promise<FichierMoodle[]> {
		const id = idOuErreur(courseId);
		return limite("fichiers", String(id), async () => (await avecClient(async (client, s) => {
			const c = await coursConnu(client, s.j.userid, id);
			const code = c.course.code;
			if (!code) return [];
			const { dir, name: dossier } = dossierDuCours(deps.racine(), code, c.course.name, new Date(maintenant()));
			const { scan } = await scanEnCache(client, id, dir, SCAN_TTL);
			const echecs = echecsFichiers.get(id);
			const out: FichierMoodle[] = [];
			for (const sec of scan.sections) for (const a of sec.activities) for (const f of a.files) {
				if (out.length >= MAX_FICHIERS) break;
				out.push({ ...versFichier(f, dossier, echecs), section: sec.name });
			}
			return out;
		})) ?? []);
	}

	/** The course as its page shows it. Same bounds as `fichiers`; a course
	    without a code has no folder, so its files are not offered. */
	async function moduleDuCours(courseId: unknown, forcer?: unknown): Promise<ModuleMoodle> {
		const id = idOuErreur(courseId);
		const force = forcer === true;
		const vide: ModuleMoodle = { sections: [], externes: 0, verifieA: null };
		/* A fresh scan in the cache is read from the disk only: no pacing for it,
		   the spacing and the three-at-a-time limit are for the school server. */
		const run = async (): Promise<ModuleMoodle> => (await avecClient(async (client, s) => {
			const c = await coursConnu(client, s.j.userid, id);
			const code = c.course.code;
			if (!code) return vide;
			const { dir, name: dossier } = dossierDuCours(deps.racine(), code, c.course.name, new Date(maintenant()));
			const { scan, at: verifieA } = await scanEnCache(client, id, dir, force ? 0 : SCAN_TTL);
			const echecs = echecsFichiers.get(id);
			const ignores = (await reglage()).ignores;
			let total = 0;
			const sections = scan.sections.map(sec => ({
				name: sec.name,
				activites: sec.activities.map((a): ActiviteMoodle => {
					const fichiers = a.files.slice(0, Math.max(0, MAX_FICHIERS - total)).map(f => ({ ...versFichier(f, dossier, echecs), section: sec.name }));
					total += fichiers.length;
					let depot: ActiviteMoodle["depot"] = null;
					if (a.deposit) {
						const st = depositState(a.deposit, maintenant());
						depot = {
							state: st.state, due: st.due, cutoff: a.deposit.cutoff, remaining: st.remaining,
							brouillon: a.deposit.status === "draft", deposeLe: a.deposit.submittedAt,
							fichiers: a.deposit.files.map(f => f.name).slice(0, 20),
						};
					}
					return { id: a.id, name: a.name, type: a.type, fichiers, depot, masque: !!a.deposit && ignores.includes(a.id), lien: a.type === "url" ? lienExterne(a.external[0]) : null };
				}),
			}));
			return { sections, externes: scan.external.length, verifieA };
		})) ?? vide;
		const m = await chargerScans();
		const e = m.get(id);
		if (!force && e && maintenant() - e.at < SCAN_TTL && e.at <= maintenant()) return run();
		return limite("module", `${id}|${force}`, () => modulesEnVol(run));
	}

	interface Cible { ids: number[] | null; nom?: string }
	interface JobCours extends Job { fresh: boolean; courseId: number; code: string }

	/** The fresh downloads as the window may see them: inside the quiz root, relative to it, a regular file each. */
	async function versNouveaux(faits: readonly (JobCours & { ok: boolean })[]): Promise<FichierNouveauMoodle[]> {
		const racine = deps.racine();
		const out: FichierNouveauMoodle[] = [];
		for (const o of faits) {
			const abs = path.resolve(o.dir, o.target ?? o.file.name);
			if (!estDans(racine, abs)) continue;
			const rel = path.relative(path.resolve(racine), abs).split(path.sep).join("/");
			let size: number;
			try {
				const st = await fs.lstat(abs);
				if (!st.isFile()) continue;
				size = st.size;
			} catch { continue; }
			out.push({ relPath: rel, code: o.code, name: path.basename(abs), size });
		}
		return out;
	}

	async function faireSync(cible: Cible): Promise<{ res: ResumeSyncMoodle; resume: ResumeMoodle }> {
		const res: ResumeSyncMoodle = { nouveaux: 0, mis_a_jour: 0, echecs: 0, ignores: 0, erreur: null };
		const resume: ResumeMoodle = { nouveaux: 0, misAJour: 0, echecs: 0, parCours: {} };
		const s = await session();
		if (!s) return { res: { ...res, erreur: (await lireJeton()) && (await lireEtat()).expired ? "expired" : "not-connected" }, resume };
		const client = nouveauClient(s.j.token, s.site);
		try {
			const liste = await catalogue(client, s.j.userid);
			// A manual request may name an excluded course; the automatic set never holds one.
			const choisis = cible.ids === null ? suivis(liste) : liste.filter(c => cible.ids?.includes(c.course.id) && c.course.code !== null);
			if (!choisis.length) return { res: { ...res, erreur: cible.ids === null ? "no-courses" : "failed" }, resume };
			const jobs: JobCours[] = [];
			const devoirs: DevoirBrut[] = [];
			for (const c of choisis) {
				const code = c.course.code as string;
				const { dir } = dossierDuCours(deps.racine(), code, c.course.name, new Date(maintenant()));
				if (!(await deps.garde.contient(dir))) { res.echecs++; continue; }
				// A course that fails (no access, a hostile id) is skipped; it never aborts the run.
				let scan: Scan;
				try {
					({ scan } = await scanEnCache(client, c.course.id, dir, SCAN_TTL_SYNC));
				} catch (e) {
					if (e instanceof TokenError) throw e;
					res.echecs++;
					continue;
				}
				for (const d of pendingDeposits(scan)) {
					devoirs.push({ cmid: d.id, courseId: c.course.id, course: c.course.name, dossier: dir, name: d.name, state: d.state as DevoirMoodle["state"], due: d.due, remaining: d.remaining });
				}
				for (const f of allFiles(scan)) {
					if (cible.nom !== undefined && f.name !== cible.nom) continue;
					if (f.status !== "missing" && f.status !== "outdated") continue;
					const job: JobCours = { file: f, dir, target: targetName(f), fresh: f.status === "missing", courseId: c.course.id, code };
					// A file on another host, or a copy already there and not older: skipped.
					if (!client.memeSite(f.url) || extensionRefusee(job.target as string) || dejaPresent(job)) { res.ignores++; continue; }
					jobs.push(job);
				}
			}
			if (cible.ids === null) cache = { at: maintenant(), liste: devoirs };
			// A run downloads at most 500 files / 2 GB; the rest waits for the next run.
			const budget = deps.budget ?? { fichiers: RUN_MAX_FILES, octets: RUN_MAX_BYTES };
			const { kept: todo, left } = withinBudget(uniqueJobs(jobs), MAX_FILE_BYTES, budget.fichiers, budget.octets);
			res.ignores += left;
			progress = { done: 0, total: todo.length };
			await pousser();
			const out = await downloadFiles(client, todo, deps.garde, () => {
				if (progress) progress.done++;
				void pousser();
			});
			for (const o of out) {
				const echecs = echecsFichiers.get(o.courseId) ?? new Set<string>();
				if (o.ok) {
					echecs.delete(o.file.name);
					if (o.fresh) { res.nouveaux++; resume.nouveaux++; } else { res.mis_a_jour++; resume.misAJour++; }
					resume.parCours[o.code] = (resume.parCours[o.code] ?? 0) + 1;
				} else if (o.skipped) res.ignores++;
				else {
					res.echecs++;
					resume.echecs++;
					if (echecs.size < MAX_FICHIERS) echecs.add(o.file.name);
				}
				echecsFichiers.set(o.courseId, echecs);
			}
			/* Only a FULL sync (hourly check or "Sync now"): a per-course or
			   per-file download from the Moodle page is a manual pick of past
			   material, never a "new lecture" (spec 2026-10-15-moodle-auto-learn). */
			if (cible.ids === null) {
				const nouveaux = await versNouveaux(out.filter(o => o.ok && o.fresh));
				if (nouveaux.length) {
					enAttente = [...enAttente, ...nouveaux].slice(-MAX_NOUVEAUX);
					try { deps.signalerNouveaux?.(); } catch { /* the window may be gone */ }
				}
			}
			resume.echecs = res.echecs;
			if (cible.ids === null) await poserEtat({ lastSync: maintenant(), summary: resume });
			return { res, resume };
		} catch (e) {
			if (e instanceof TokenError) { await marquerExpire(); return { res: { ...res, erreur: "expired" }, resume }; }
			console.warn(LOG_PREFIX, "Moodle: sync failed:", msg(e, s.j.token));
			const code = (e as { code?: string }).code ?? "";
			return { res: { ...res, erreur: ["timeout", "network", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(code) ? "network" : "failed" }, resume };
		} finally {
			client.close();
			progress = null;
		}
	}

	/** One download run at a time, whoever asks. */
	function lancer(cible: Cible): Promise<ResumeSyncMoodle> {
		const run = faireSync(cible).then(r => r.res).finally(() => { enCours = null; oublier(); void pousser(); });
		enCours = run;
		void pousser();
		return run;
	}
	const occupe = (): ResumeSyncMoodle => ({ nouveaux: 0, mis_a_jour: 0, echecs: 0, ignores: 0, erreur: "busy" });

	function synchroniser(): Promise<ResumeSyncMoodle> {
		if (enCours) return enCours;
		// A finished sync cannot be re-triggered within 10 s: the last answer is returned.
		if (dernierSync && maintenant() - dernierSync.at < SYNC_INTERVAL) return Promise.resolve(dernierSync.res);
		return lancer({ ids: null }).then(res => { dernierSync = { at: maintenant(), res }; return res; });
	}
	async function telechargerCours(courseId: unknown): Promise<ResumeSyncMoodle> {
		const id = idOuErreur(courseId);
		return limite("telechargerCours", String(id), async () => (enCours ? occupe() : lancer({ ids: [id] })));
	}
	async function telechargerFichier(courseId: unknown, nom: unknown): Promise<ResumeSyncMoodle> {
		const id = idOuErreur(courseId);
		if (!nomValide(nom)) throw new MoodleError("badarg", "Invalid file name.");
		return enCours ? occupe() : lancer({ ids: [id], nom });
	}

	/** The folder of a known course, only when it exists as a plain folder inside the quiz root and the perimeter. */
	async function dossierExistant(c: CoursChoisi): Promise<string | null> {
		if (!c.course.code) return null;
		const f = dossierDuCours(deps.racine(), c.course.code, c.course.name, new Date(maintenant()));
		if (!f.exists || !estDans(deps.racine(), f.dir)) return null;
		try { if (!(await fs.lstat(f.dir)).isDirectory()) return null; } catch { return null; }
		return (await deps.garde.contient(f.dir)) ? f.dir : null;
	}
	async function ouvrirDossier(courseId: unknown): Promise<boolean> {
		const id = idOuErreur(courseId);
		const dir = await avecClient(async (client, s) => dossierExistant(await coursConnu(client, s.j.userid, id)));
		return dir ? deps.ouvrirChemin(dir) : false;
	}
	async function ouvrirFichier(courseId: unknown, nom: unknown): Promise<boolean> {
		const id = idOuErreur(courseId);
		if (!nomValide(nom)) return false;
		const cible = await avecClient(async (client, s) => {
			const c = await coursConnu(client, s.j.userid, id);
			const dir = await dossierExistant(c);
			if (!dir) return null;
			const f = allFiles((await scanEnCache(client, id, dir, SCAN_TTL)).scan).find(x => x.name === nom && (x.status === "present" || x.status === "outdated"));
			if (!f) return null;
			return { dir, abs: path.resolve(dir, cheminRelatif(f)) };
		});
		if (!cible) return false;
		const { dir, abs } = cible;
		let avant: Stats;
		try {
			// A regular file, not a link, strictly inside the quiz root and the perimeter, never an executable type.
			avant = await fs.lstat(abs, { bigint: true }) as unknown as Stats;
			if (!avant.isFile() || avant.isSymbolicLink()) return false;
		} catch { return false; }
		const dedans = async (): Promise<boolean> => estDans(deps.racine(), abs) && estDans(dir, abs) && !extensionRefusee(abs) && (await deps.garde.contient(abs));
		if (!(await dedans())) return false;
		// Re-check right before the hand-off: the same file (inode and device), still a regular file, still inside.
		// RESIDUAL RISK, accepted: `shell.openPath` takes a path, not a handle, so a swap in the few
		// microseconds after this check is still possible; it needs local write access to the module
		// folder, which already holds the user's own files (no privilege is gained).
		try {
			const apres = await fs.lstat(abs, { bigint: true }) as unknown as Stats;
			if (!apres.isFile() || apres.isSymbolicLink() || apres.ino !== avant.ino || apres.dev !== avant.dev) return false;
		} catch { return false; }
		if (!(await dedans())) return false;
		return deps.ouvrirChemin(abs);
	}

	function visibles(liste: DevoirBrut[], r: Reglage): DevoirMoodle[] {
		return liste.filter(d => !r.ignores.includes(d.cmid)).map(d => ({
			cmid: d.cmid, courseId: d.courseId, course: d.course, name: d.name, state: d.state, due: d.due, remaining: d.remaining,
			nouveau: !r.vus.includes(d.cmid),
		}));
	}
	/** One scan at a time: two callers within the scan (the window opening, a
	    refresh, a hand-in) used to start two full serial scans of every module. */
	let devoirsEnCours: Promise<DevoirBrut[]> | null = null;
	function devoirsBruts(): Promise<DevoirBrut[]> {
		if (cache && maintenant() - cache.at < DEVOIRS_TTL) return Promise.resolve(cache.liste);
		devoirsEnCours ??= scannerDevoirs().finally(() => { devoirsEnCours = null; });
		return devoirsEnCours;
	}
	async function scannerDevoirs(): Promise<DevoirBrut[]> {
		const res = await avecClient(async (client, s) => {
			const liste: DevoirBrut[] = [];
			for (const c of suivis(await catalogue(client, s.j.userid))) {
				const code = c.course.code as string;
				const { dir } = dossierDuCours(deps.racine(), code, c.course.name, new Date(maintenant()));
				for (const d of pendingDeposits((await scanEnCache(client, c.course.id, null, SCAN_TTL)).scan)) {
					liste.push({ cmid: d.id, courseId: c.course.id, course: c.course.name, dossier: dir, name: d.name, state: d.state as DevoirMoodle["state"], due: d.due, remaining: d.remaining });
				}
			}
			cache = { at: maintenant(), liste };
			return liste;
		});
		return res ?? [];
	}
	async function devoirs(): Promise<DevoirMoodle[]> {
		const liste = await devoirsBruts();
		return visibles(liste, await reglage());
	}

	const ouvrirDevoir = (cmid: unknown): Promise<boolean> => ouvrirActivite("assign", cmid);
	/** Opens `<site>/mod/<type>/view.php?id=<cmid>` in the browser: an activity that is
	    not a file (forum, link, page...). Only the configured site: a link that leads
	    outside Moodle is followed by Moodle's own page, never handed to the window. */
	async function ouvrirActivite(type: unknown, cmid: unknown): Promise<boolean> {
		const site = await siteAdmis();
		if (!site || !entierPositif(cmid) || typeof type !== "string" || !/^[a-z][a-z0-9_]{0,29}$/.test(type)) return false;
		if (maintenant() - dernierOuvert < OPEN_INTERVAL) return false;
		dernierOuvert = maintenant();
		const url = new URL(`/mod/${type}/view.php`, site);
		url.searchParams.set("id", String(cmid));
		await deps.ouvrirExterne(url.href);
		return true;
	}
	/** Hand in, like the plugin: the assignment page in the browser AND the
	    `Rendus...` sub-folder of the module (else the module folder) in Explorer. */
	async function deposer(cmid: unknown): Promise<boolean> {
		if (!(await ouvrirDevoir(cmid))) return false;
		try {
			let liste = cache?.liste;
			if (!liste?.some(d => d.cmid === cmid)) liste = await devoirsBruts().catch(() => []);
			const d = liste.find(x => x.cmid === cmid);
			const cible = d ? dossierDepot(d.dossier) : null;
			if (cible && estDans(deps.racine(), cible) && (await fs.lstat(cible)).isDirectory() && (await deps.garde.contient(cible))) {
				await deps.ouvrirChemin(cible);
			}
		} catch (e) {
			console.warn(LOG_PREFIX, "Moodle: deposit folder not opened:", msg(e));
		}
		return true;
	}
	async function devoirVu(cmid: unknown): Promise<void> {
		await basculer("devoirsVus", idOuErreur(cmid), true, "oublier");
	}
	async function ignorerDevoir(cmid: unknown, on: unknown): Promise<number[]> {
		return basculer("devoirsIgnores", idOuErreur(cmid), boolOuErreur(on), "refuser");
	}

	/** Never when `auto` is off, nor when not connected, nor on a metered connection (recorded: `pausedMetered`). */
	async function verifierAuto(): Promise<void> {
		const { auto } = await reglage();
		if (!(await session())) return;
		/* A failing probe means "not metered" (see `connexion-limitee.ts`). */
		const limitee = auto && deps.limitee ? await deps.limitee().catch(() => false) : false;
		const regle = decisionAuto(auto, limitee);
		const avant = pauseLimitee;
		pauseLimitee = regle === "metered"; // `off` clears it too
		if (pauseLimitee !== avant) await pousser();
		if (regle !== "run") return;
		await synchroniser();
	}
	async function demarrerAuto(): Promise<void> {
		// The hourly check is armed once; each tick re-reads `auto`.
		if (!arreterHoraire) arreterHoraire = planifier(() => { void verifierAuto().catch(e => console.warn(LOG_PREFIX, "Moodle: automatic check:", msg(e))); }, AUTO_SYNC_INTERVAL);
		// Not at every start: a sync less than an hour old is enough (a development build restarts all day).
		const { lastSync } = await lireEtat();
		if (lastSync !== null && maintenant() - lastSync < AUTO_SYNC_INTERVAL && lastSync <= maintenant()) return;
		await verifierAuto();
	}

	async function prendreNouveaux(): Promise<FichierNouveauMoodle[]> {
		const l = enAttente;
		enAttente = [];
		return l;
	}

	return {
		etat, connecter, recevoirJeton, deconnecter, cours, chercher, ajouterParUrl, favori, exclure, ajouter, retirer,
		fichiers, module: moduleDuCours, telechargerCours, telechargerFichier, ouvrirDossier, ouvrirFichier, synchroniser, devoirs, ouvrirDevoir, deposer,
		devoirVu, ignorerDevoir, ouvrirActivite, demarrerAuto, prendreNouveaux,
	};
}
