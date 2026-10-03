/* ══════════════════════════════════════════════════════════
   THE EMBEDDED SYNCTHING — PROCESS LIFECYCLE

   Task 6 of the Android v1 plan. The app embeds the official Syncthing binary
   (pinned by hash, `scripts/syncthing-pins.mjs`) and runs ONE instance of it,
   private to the app, to sync ONE folder (`neo-quiz`, the default folder
   `C:\Neo Quiz`) between the owner's devices. This is the most sensitive
   capability of the bridge: a launched binary plus an API that could share
   any folder of the disk. What bounds it:

   - the binary is the packaged `resources/syncthing/syncthing.exe` (or the
     vendored one in development), a path `main.ts` decides, NEVER anything
     from the window;
   - the GUI/REST port is a free port on 127.0.0.1 and the API key is 32
     random bytes held in this module's memory only (not in a file, not in the
     window, not logged); the window never sees either, it only calls the
     three verbs (`etat`, `appairer`, `oublier`) and subscribes to pushes;
   - the instance has its OWN home (`userData/syncthing`), its own listen
     port (22100, so the owner's personal Syncthing on 22000 is untouched),
     and `STNOUPGRADE=1` (the app updates the binary, Syncthing never does);
   - only the `neo-quiz` folder is ever configured, shared only with devices
     the owner paired; offers from anybody else are ignored
     (`syncthing-regles.ts`).

   The process is started lazily: when the Sync page first asks for its state,
   or at launch if sync was already switched on by a first pairing.
══════════════════════════════════════════════════════════ */

import { execFile, spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import { createServer } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import type { Changement, EtatSync } from "../../../src/dashboard/sync-etat";
import { creerFenetreAppairage, codeDansNom, PERIODE_MS, sansCode, texteQr } from "./appairage-qr";
import { createRest } from "./syncthing-rest";
import type { Rest } from "./syncthing-rest";
import {
	EVENEMENTS_CHANGEMENT,
	ajouterChangement,
	changementDepuis,
	FOLDER_ID,
	IGNORES,
	LISTEN_PORT,
	acceptOffer,
	creerDetecteurReception,
	dernierVu,
	demandesDepuis,
	nomSur,
	plusDemandes,
	folderConfig,
	folderEtat,
	hasValidCheckDigits,
	isDeviceId,
	launchArgs,
	configXmlSansEcoute,
	launchEnv,
	optionsFixees,
} from "./syncthing-regles";

/** `annule`: the owner declined the native confirmation. */
export type ResultatAppairage = "ok" | "invalide" | "indisponible" | "annule";

export interface SyncHandle {
	etat(): Promise<EtatSync>;
	/** `viaQr`: the request carried a valid code of the pairing QR code
	    (`appairage-qr.ts`); the confirmation says so, and is still shown. */
	appairer(deviceId: string, viaQr?: boolean): Promise<ResultatAppairage>;
	/** Our own device id. */
	idPropre(): string;
	/** The devices asking to pair, with the name they announce (raw, may end
	    with a pairing code). Never throws: no request when unreadable. */
	demandesBrutes(): Promise<Array<{ id: string; nom: string }>>;
	oublier(deviceId: string): Promise<void>;
	/** The owner chose Ignore on a pairing request: forget that request. */
	ignorer(deviceId: string): Promise<void>;
	surEtat(rappel: (etat: EtatSync) => void): () => void;
	/** Fired once when another device's changes have landed (see
	    `creerDetecteurReception`). */
	surDonneesRecues(rappel: () => void): () => void;
	stop(): Promise<void>;
}

export interface StartOpts {
	exe: string;
	home: string;
	root: string;
	/** The native confirmation shown BEFORE a device is paired (a modal
	    dialog with the device id and, if known, its name; default answer
	    Cancel). Injected by `main.ts`; the window can never answer it. A
	    rejection counts as a refusal. */
	confirmer(deviceId: string, nom: string, viaQr?: boolean): Promise<boolean>;
	/** The process table, injectable for checks. */
	sys?: SysSync;
	/** Poll period of the loop. 10 s in the app; shorter only in checks. */
	intervalMs?: number;
}

const EVENEMENTS = ["StateChanged", "ItemFinished", "DeviceConnected", ...EVENEMENTS_CHANGEMENT] as const;
const MAX_APPAREILS = 16;
const ETAT_ABSENT: EtatSync = { actif: false, appareil: null, nom: "", appareils: [], demandes: [], demandesPlus: 0, dossier: { etat: "absent", pourcentage: null } };

const pause = (ms: number): Promise<void> => new Promise(ok => setTimeout(ok, ms));

/** A free TCP port on the loopback. */
function portLibreBoucle(): Promise<number> {
	return new Promise((ok, ko) => {
		const s = createServer();
		s.once("error", ko);
		s.listen(0, "127.0.0.1", () => {
			const port = (s.address() as { port: number }).port;
			s.close(() => ok(port));
		});
	});
}

/** Is the pinned listen port free (all interfaces)? */
function portLibre(port: number): Promise<boolean> {
	return new Promise(ok => {
		const s = createServer();
		s.once("error", () => ok(false));
		s.listen(port, () => s.close(() => ok(true)));
	});
}

/** Kills the process AND its children. On Windows Syncthing 2.x runs as a pair
    (a wrapper process and the real one, both with the same command line, the
    real one being a child of the first, observed on 2.1.5 even with
    `--no-restart`): killing the wrapper alone would leave the real one
    running, holding the port and the folder. `taskkill /T` takes the tree. */
function tuerArbre(child: ChildProcess): void {
	if (child.pid === undefined) return;
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
	} else {
		child.kill("SIGKILL");
	}
}

/* ─────────── orphans left by a hard kill of the app ─────────── */

type Ou<T> = T | Promise<T>;

/** What cleaning up an orphan needs from the system. */
export interface SysSync {
	/** Pids of `syncthing.exe` processes launched with this home. */
	trouver(home: string): Ou<number[]>;
	/** Image name of a live pid, `null` if there is none. */
	imageDe(pid: number): Ou<string | null>;
	tuerArbre(pid: number): Ou<void>;
}

function executer(cmd: string, args: string[], env?: Record<string, string>): Promise<string> {
	return new Promise(ok => {
		execFile(cmd, args, { windowsHide: true, encoding: "utf8", env: env ? { ...process.env, ...env } : process.env, timeout: 15_000 }, (_e, out) => ok(typeof out === "string" ? out : ""));
	});
}

export const sysReel: SysSync = {
	async trouver(home) {
		if (process.platform !== "win32") return [];
		/* The home travels in the environment, never spliced into the script. */
		const sortie = await executer("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
			"Get-CimInstance Win32_Process -Filter \"Name='syncthing.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('--home=' + $env:NQ_SYNC_HOME) } | ForEach-Object { $_.ProcessId }"],
		{ NQ_SYNC_HOME: home });
		return sortie.split(/\r?\n/).map(l => Number(l.trim())).filter(n => Number.isInteger(n) && n > 0);
	},
	async imageDe(pid) {
		if (process.platform !== "win32") return null;
		const sortie = await executer("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
		const m = /^"([^"]+)","(\d+)"/m.exec(sortie);
		return m && Number(m[2]) === pid ? m[1] : null;
	},
	async tuerArbre(pid) {
		if (process.platform !== "win32") return;
		await executer("taskkill", ["/PID", String(pid), "/T", "/F"]);
	},
};

const FICHIER_PID = "syncthing.pid";
const estSyncthing = (image: string | null): boolean => image !== null && image.toLowerCase() === "syncthing.exe";

/**
 * Kills a Syncthing that survived a hard kill of the app (Task Manager, crash):
 * it would keep the home locked and the listen port taken, so the next start
 * could not run. Two sources: the pid written at the last start (killed ONLY if
 * that pid is still a live `syncthing.exe`: a pid reused by another program is
 * never touched), and any `syncthing.exe` launched with this very home (the
 * real child of the wrapper, whose own pid is not the one we wrote). Waits
 * until they are gone; returns the pids it killed.
 */
export async function libererHome(home: string, sys: SysSync = sysReel): Promise<number[]> {
	const cibles = new Set<number>();
	let ecrit = NaN;
	try { ecrit = Number((await fs.readFile(path.join(home, FICHIER_PID), "utf8")).trim()); } catch { /* none */ }
	if (Number.isInteger(ecrit) && ecrit > 0 && estSyncthing(await sys.imageDe(ecrit))) cibles.add(ecrit);
	for (const pid of await sys.trouver(home)) cibles.add(pid);
	for (const pid of cibles) await sys.tuerArbre(pid);
	const limite = Date.now() + 5000;
	while (cibles.size && Date.now() < limite) {
		const vivants = new Set(await sys.trouver(home));
		for (const pid of cibles) if (estSyncthing(await sys.imageDe(pid))) vivants.add(pid);
		if (vivants.size === 0) break;
		await pause(200);
	}
	await fs.rm(path.join(home, FICHIER_PID), { force: true });
	return [...cibles];
}

interface Lancement {
	child: ChildProcess;
	rest: Rest;
	ownId: string;
	/** Resolves when the process has exited. */
	fini: Promise<void>;
}

/** Before EVERY launch (Windows): make sure the home has a config and that it
    does not listen. The default config binds 0.0.0.0, which makes Windows
    Defender Firewall prompt the owner at the first start, before the REST
    patch can run. */
async function preparerConfig(opts: StartOpts): Promise<void> {
	if (process.platform !== "win32") return;
	const fichier = path.join(opts.home, "config.xml");
	let xml: string;
	try {
		xml = await fs.readFile(fichier, "utf8");
	} catch {
		await new Promise<void>((ok, ko) => {
			execFile(opts.exe, ["generate", "--home=" + opts.home], { windowsHide: true, env: launchEnv(process.env) }, e => (e ? ko(new Error("syncthing exited during first-run generate")) : ok()));
		});
		xml = await fs.readFile(fichier, "utf8");
	}
	const sortie = configXmlSansEcoute(xml, process.platform);
	if (sortie !== xml) await fs.writeFile(fichier, sortie, "utf8");
}

async function lancer(opts: StartOpts): Promise<Lancement> {
	try {
		await fs.access(opts.exe);
	} catch {
		throw new Error(`syncthing.exe not found: ${opts.exe}`);
	}
	await fs.mkdir(opts.home, { recursive: true });
	await fs.mkdir(opts.root, { recursive: true });
	/* A survivor of a previous run (hard kill, or a child left behind when the
	   wrapper died) would hold the home lock: clear it first. */
	await libererHome(opts.home, opts.sys ?? sysReel);
	await preparerConfig(opts);
	const port = await portLibreBoucle();
	const cle = randomBytes(32).toString("hex");
	const child = spawn(opts.exe, launchArgs(opts.home, port, cle), {
		windowsHide: true,
		env: launchEnv(process.env),
		stdio: "ignore",
	});
	if (child.pid !== undefined) await fs.writeFile(path.join(opts.home, FICHIER_PID), String(child.pid)).catch(() => undefined);
	const fini = new Promise<void>(ok => { child.once("exit", () => ok()); child.once("error", () => ok()); });
	let sorti = false;
	void fini.then(() => { sorti = true; });
	const rest = createRest(port, cle);
	try {
		const limite = Date.now() + 30_000;
		for (;;) {
			if (sorti) throw new Error("syncthing exited during startup");
			try { await rest.ping(); break; } catch { /* not listening yet */ }
			if (Date.now() > limite) throw new Error("syncthing did not answer in time");
			await pause(250);
		}
		const ownId = await rest.myId();
		await rest.patchOptions(optionsFixees(await portLibre(LISTEN_PORT), process.platform));
		const appareils = await rest.devices();
		const moi = appareils.find(d => d.deviceID === ownId);
		const nom = os.hostname();
		if (moi && moi.name !== nom) await rest.putDevice({ ...moi, name: nom });
		const paires = appareils.filter(d => d.deviceID !== ownId).map(d => d.deviceID);
		await rest.putFolder(folderConfig(opts.root, ownId, paires));
		await rest.setIgnores(FOLDER_ID, IGNORES);
		return { child, rest, ownId, fini };
	} catch (e) {
		/* Never leave the process behind a failed start. */
		tuerArbre(child);
		await Promise.race([fini, pause(3000)]);
		throw e;
	}
}

export async function startSync(opts: StartOpts): Promise<SyncHandle> {
	const intervalle = opts.intervalMs ?? 10_000;
	let courant: Lancement = await lancer(opts);
	let arrete = false;
	let redemarre = false;
	let mort = false;
	let since = 0;
	let detecteur = creerDetecteurReception();
	let dernier = "";
	let enTick = false;
	const abonnesEtat = new Set<(e: EtatSync) => void>();
	const abonnesDonnees = new Set<() => void>();
	/** The "Recent changes" of the Sync page, in memory only: Syncthing keeps
	    no history across restarts either. */
	let changements: Changement[] = [];

	/** Devices of the config that are not us. */
	async function pairesCourants(): Promise<string[]> {
		return (await courant.rest.devices()).filter(d => d.deviceID !== courant.ownId).map(d => d.deviceID);
	}

	/** The folder shared with exactly ourselves and the paired devices. */
	async function aligner(paires: readonly string[]): Promise<void> {
		await courant.rest.putFolder(folderConfig(opts.root, courant.ownId, paires));
	}

	async function calculerEtat(): Promise<EtatSync> {
		if (mort) return ETAT_ABSENT;
		const { rest, ownId } = courant;
		const [devices, connexions] = await Promise.all([rest.devices(), rest.connections()]);
		let statut = null;
		try { statut = await rest.folderStatus(FOLDER_ID); } catch { /* not configured: absent */ }
		/* Both are extras: failing to read them must not hide the rest. */
		let vus: Awaited<ReturnType<Rest["deviceStats"]>> = {};
		try { vus = await rest.deviceStats(); } catch { /* no last-seen times */ }
		let attente: unknown = {};
		try { attente = await rest.pendingDevices(); } catch { /* no requests shown */ }
		const paires = devices.filter(d => d.deviceID !== ownId).map(d => d.deviceID);
		return {
			actif: true,
			appareil: ownId,
			nom: os.hostname().slice(0, 64),
			appareils: devices
				.filter(d => d.deviceID !== ownId)
				.map(d => ({
					id: d.deviceID,
					nom: d.name || d.deviceID.slice(0, 7),
					connecte: connexions.connections?.[d.deviceID]?.connected === true,
					vuLe: dernierVu(vus[d.deviceID]?.lastSeen),
				})),
			demandes: demandesDepuis(attente, paires, ownId),
			demandesPlus: plusDemandes(attente, paires, ownId),
			dossier: folderEtat(statut),
			changements,
		};
	}

	async function diffuser(): Promise<void> {
		const e = await calculerEtat();
		const s = JSON.stringify(e);
		if (s === dernier) return;
		dernier = s;
		for (const a of abonnesEtat) a(e);
	}

	async function tick(): Promise<void> {
		if (arrete || mort || enTick) return;
		enTick = true;
		try {
			const { rest } = courant;
			let recu = false;
			/* Names by short id (the first group of a device id, what `modifiedBy`
			   carries), read at most once per tick and only when a change came. */
			let noms: Map<string, string> | null = null;
			const nomDe = (court: string): string => {
				if (court && courant.ownId.startsWith(court)) return os.hostname().slice(0, 64);
				for (const [id, nom] of noms ?? []) if (court && id.startsWith(court)) return nom || id.slice(0, 7);
				return court || "?";
			};
			for (const ev of await rest.events(since, EVENEMENTS)) {
				if (typeof ev.id === "number" && ev.id > since) since = ev.id;
				if (detecteur.observer(ev)) recu = true;
				if ((EVENEMENTS_CHANGEMENT as readonly string[]).includes(ev.type)) {
					if (!noms) {
						try { noms = new Map((await rest.devices()).map(d => [d.deviceID, d.name])); } catch { noms = new Map(); }
					}
					const c = changementDepuis(ev, nomDe);
					if (c) changements = ajouterChangement(changements, c);
				}
				/* The name Syncthing reports for a device that connected, kept
				   when we have none yet (a device paired by id has no name). */
				if (ev.type === "DeviceConnected" && typeof ev.data?.id === "string" && typeof ev.data.deviceName === "string" && ev.data.deviceName.trim()) {
					const cfg = (await rest.devices()).find(d => d.deviceID === ev.data!.id);
					if (cfg && !cfg.name) await rest.putDevice({ ...cfg, name: ev.data.deviceName.trim().slice(0, 64) });
				}
			}
			/* Offers: accepted only for our folder, from a paired device. The
			   folder is already shared with every paired device, so an offer that
			   is still pending means it was not (a device paired a moment ago):
			   re-aligning the folder with the paired list is the whole
			   acceptance. Anything else stays pending and is never touched. */
			const paires = await pairesCourants();
			const offres = await rest.pendingFolders();
			let reAligner = false;
			for (const [folderId, o] of Object.entries(offres)) {
				for (const deviceId of Object.keys(o.offeredBy ?? {})) {
					if (acceptOffer({ folderId, deviceId }, paires)) reAligner = true;
				}
			}
			if (reAligner) await aligner(paires);
			await diffuser();
			if (recu) for (const a of abonnesDonnees) a();
		} catch (e) {
			if (arrete) return; // the shutdown cut the call: expected
			console.warn("[syncthing] poll failed:", e instanceof Error ? e.message : String(e));
		} finally {
			enTick = false;
		}
	}

	/* One restart on an unexpected exit, then give up (the page shows sync as
	   off rather than the app looping on a binary that cannot run). */
	function surveiller(l: Lancement): void {
		void l.fini.then(async () => {
			if (arrete || l !== courant) return;
			if (redemarre) { mort = true; void diffuser().catch(() => undefined); return; }
			redemarre = true;
			try {
				/* The wrapper died: the real child may still be running and
				   holding the home; `lancer` clears it before spawning. */
				courant = await lancer(opts);
				since = 0;
				detecteur = creerDetecteurReception();
				surveiller(courant);
			} catch (e) {
				console.warn("[syncthing] restart failed:", e instanceof Error ? e.message : String(e));
				mort = true;
			}
			dernier = "";
			void diffuser().catch(() => undefined);
		});
	}
	surveiller(courant);
	const minuteur = setInterval(() => { void tick(); }, intervalle);
	minuteur.unref();

	return {
		etat: calculerEtat,

		idPropre: () => courant.ownId,

		async demandesBrutes() {
			if (mort) return [];
			let attente: Awaited<ReturnType<Rest["pendingDevices"]>> = {};
			try { attente = await courant.rest.pendingDevices(); } catch { return []; }
			return Object.entries(attente).filter(([id]) => isDeviceId(id)).map(([id, d]) => ({ id, nom: typeof d?.name === "string" ? d.name : "" }));
		},

		async appairer(brut, viaQr = false) {
			const id = typeof brut === "string" ? brut.trim() : "";
			if (!isDeviceId(id) || !hasValidCheckDigits(id) || id === courant.ownId || mort) return "invalide";
			try {
				const paires = await pairesCourants();
				if (paires.includes(id)) return "ok";
				if (paires.length >= MAX_APPAREILS) return "invalide";
				const attente = (await courant.rest.pendingDevices())[id];
				/* A pairing code at the end of the announced name is not part of
				   the name: never shown, never kept in the config. */
				const nom = nomSur(sansCode(typeof attente?.name === "string" ? attente.name : ""));
				/* Nothing is paired without the owner's say: a native dialog,
				   decided in the main process, that the window cannot answer. */
				let accord = false;
				try { accord = await opts.confirmer(id, nom, viaQr); } catch { accord = false; }
				if (!accord) return "annule";
				await courant.rest.putDevice({
					deviceID: id,
					name: nom,
					addresses: ["dynamic"],
					introducer: false,
					autoAcceptFolders: false,
					paused: false,
				});
				await aligner([...paires, id]);
				void diffuser().catch(() => undefined);
				return "ok";
			} catch (e) {
				console.warn("[syncthing] pairing failed:", e instanceof Error ? e.message : String(e));
				return "indisponible";
			}
		},

		async oublier(brut) {
			const id = typeof brut === "string" ? brut.trim() : "";
			if (!isDeviceId(id) || id === courant.ownId || mort) return;
			const paires = await pairesCourants();
			if (!paires.includes(id)) return;
			/* The folder first: a device still referenced by a folder cannot go. */
			await aligner(paires.filter(p => p !== id));
			await courant.rest.deleteDevice(id);
			void diffuser().catch(() => undefined);
		},

		async ignorer(brut) {
			const id = typeof brut === "string" ? brut.trim() : "";
			if (!isDeviceId(id) || id === courant.ownId || mort) return;
			try { await courant.rest.dismissPendingDevice(id); } catch { /* nothing pending: nothing to dismiss */ }
			void diffuser().catch(() => undefined);
		},

		surEtat(rappel) { abonnesEtat.add(rappel); return () => { abonnesEtat.delete(rappel); }; },
		surDonneesRecues(rappel) { abonnesDonnees.add(rappel); return () => { abonnesDonnees.delete(rappel); }; },

		async stop() {
			if (arrete) return;
			arrete = true;
			clearInterval(minuteur);
			const { rest, child, fini } = courant;
			try { await rest.shutdown(); } catch { /* it may already be gone */ }
			const parti = await Promise.race([fini.then(() => true), pause(5000).then(() => false)]);
			if (!parti) {
				tuerArbre(child);
				await Promise.race([fini, pause(3000)]);
			}
			await fs.rm(path.join(opts.home, FICHIER_PID), { force: true }).catch(() => undefined);
		},
	};
}

/* ─────────── the lazily started instance the bridge talks to ─────────── */

export interface GestionSync {
	etat(): Promise<EtatSync>;
	appairer(deviceId: string): Promise<ResultatAppairage>;
	oublier(deviceId: string): Promise<void>;
	ignorer(deviceId: string): Promise<void>;
	surEtat(rappel: (etat: EtatSync) => void): () => void;
	surDonneesRecues(rappel: () => void): () => void;
	/** The "Show my ID" dialog asks for the next QR code every `periodeMs`;
	    each call also looks for a request that carries a live code. `null`
	    when sync cannot start. */
	qrSuivant(): Promise<{ texte: string; periodeMs: number } | null>;
	/** The dialog closed: every code dies at once. */
	qrFermer(): void;
	/** At launch: starts the instance if sync was switched on. */
	demarrerSiActif(): Promise<void>;
	arreter(): Promise<void>;
}

export interface OptionsGestion {
	exe: string;
	home: string;
	/** The default folder NOW. Only used the first time sync starts, to pin it
	    as the shared folder; never read again (the window can change the
	    default folder, and the shared folder must not follow). */
	racineParDefaut(): string;
	/** The pinned shared folder (`syncRoot`), `null` until the first start. */
	lireRoot(): Promise<string | null>;
	poserRoot(root: string): Promise<void>;
	confirmer(deviceId: string, nom: string, viaQr?: boolean): Promise<boolean>;
	/** Random bytes for the pairing codes (`crypto.randomBytes` in the app). */
	alea(n: number): Uint8Array;
	sys?: SysSync;
	lireActif(): Promise<boolean>;
	/** Called after a first successful pairing: sync stays on from then. */
	poserActif(): Promise<void>;
}

export function creerGestionSync(o: OptionsGestion, demarrer: typeof startSync = startSync): GestionSync {
	let handle: SyncHandle | null = null;
	let demarrage: Promise<SyncHandle | null> | null = null;
	let fin = false;
	let appairageEnCours = false;
	const abonnesEtat = new Set<(e: EtatSync) => void>();
	const abonnesDonnees = new Set<() => void>();
	const fenetreQr = creerFenetreAppairage(n => o.alea(n), () => Date.now());
	/** Device + code pairs already judged in this window: a wrong code is
	    counted once, not at every 2 s call, and a phone that scans again
	    (a new code in its name) is judged again. Emptied when the window closes. */
	const jugesQr = new Set<string>();

	/** One pairing at a time, whoever asks (the page, or a scanned QR code). */
	async function appairerUnSeul(h: SyncHandle, id: string, viaQr: boolean): Promise<ResultatAppairage> {
		if (appairageEnCours) return "annule";
		appairageEnCours = true;
		try {
			const res = await h.appairer(id, viaQr);
			if (res === "ok") { try { await o.poserActif(); } catch (e) { console.warn("[syncthing] setting not saved:", e); } }
			return res;
		} finally {
			appairageEnCours = false;
		}
	}

	/** A request that carries a live code opens the native confirmation; a
	    wrong code counts against the window and is never shown. */
	async function verifierDemandesQr(h: SyncHandle): Promise<void> {
		if (!fenetreQr.ouverte() || appairageEnCours) return;
		for (const d of await h.demandesBrutes()) {
			const code = codeDansNom(d.nom);
			const cle = d.id + "|" + code;
			if (!code || jugesQr.has(cle)) continue;
			jugesQr.add(cle);
			if (!fenetreQr.verifier(code)) { fenetreQr.echec(); continue; }
			jugesQr.clear();
			void appairerUnSeul(h, d.id, true);
			return;
		}
	}

	function obtenir(): Promise<SyncHandle | null> {
		if (handle) return Promise.resolve(handle);
		return demarrage ??= (async () => {
			try {
				let root = await o.lireRoot();
				if (!root) {
					root = path.resolve(o.racineParDefaut());
					await o.poserRoot(root);
				}
				const h = await demarrer({ exe: o.exe, home: o.home, root, confirmer: o.confirmer, sys: o.sys });
				if (fin) { await h.stop(); return null; }
				h.surEtat(e => { for (const a of abonnesEtat) a(e); });
				h.surDonneesRecues(() => { for (const a of abonnesDonnees) a(); });
				handle = h;
				return h;
			} catch (e) {
				console.warn("[syncthing] unavailable:", e instanceof Error ? e.message : String(e));
				demarrage = null; // the next call retries
				return null;
			}
		})();
	}

	return {
		async etat() { return (await obtenir())?.etat() ?? ETAT_ABSENT; },
		async appairer(id) {
			/* One native dialog at a time (like `partage.ts`): a second call while
			   one is open is dropped, so a window cannot stack dialogs. */
			if (appairageEnCours) return "annule";
			const h = await obtenir();
			if (!h) return "indisponible";
			return appairerUnSeul(h, id, false);
		},
		async oublier(id) { await (await obtenir())?.oublier(id); },
		async ignorer(id) { await (await obtenir())?.ignorer(id); },
		surEtat(rappel) { abonnesEtat.add(rappel); return () => { abonnesEtat.delete(rappel); }; },
		surDonneesRecues(rappel) { abonnesDonnees.add(rappel); return () => { abonnesDonnees.delete(rappel); }; },
		async qrSuivant() {
			const h = await obtenir();
			if (!h) return null;
			const code = fenetreQr.tourner();
			try { await verifierDemandesQr(h); } catch { /* the next call looks again */ }
			return { texte: texteQr(h.idPropre(), code), periodeMs: PERIODE_MS };
		},
		qrFermer() { fenetreQr.fermer(); jugesQr.clear(); },
		async demarrerSiActif() { if (await o.lireActif()) await obtenir(); },
		async arreter() {
			fin = true;
			const h = handle ?? (demarrage ? await demarrage : null);
			handle = null;
			await h?.stop();
		},
	};
}
