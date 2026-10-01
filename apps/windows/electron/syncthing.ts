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

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import { createServer } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import type { EtatSync } from "../../../src/dashboard/sync-etat";
import { createRest } from "./syncthing-rest";
import type { Rest } from "./syncthing-rest";
import {
	FOLDER_ID,
	IGNORES,
	LISTEN_PORT,
	acceptOffer,
	creerDetecteurReception,
	folderConfig,
	folderEtat,
	hasValidCheckDigits,
	isDeviceId,
	launchArgs,
	launchEnv,
	optionsFixees,
} from "./syncthing-regles";

export type ResultatAppairage = "ok" | "invalide" | "indisponible";

export interface SyncHandle {
	etat(): Promise<EtatSync>;
	appairer(deviceId: string): Promise<ResultatAppairage>;
	oublier(deviceId: string): Promise<void>;
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
	/** Poll period of the loop. 10 s in the app; shorter only in checks. */
	intervalMs?: number;
}

const EVENEMENTS = ["StateChanged", "ItemFinished", "DeviceConnected"] as const;
const MAX_APPAREILS = 16;
const ETAT_ABSENT: EtatSync = { actif: false, appareil: null, appareils: [], dossier: { etat: "absent", pourcentage: null } };

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

interface Lancement {
	child: ChildProcess;
	rest: Rest;
	ownId: string;
	/** Resolves when the process has exited. */
	fini: Promise<void>;
}

async function lancer(opts: StartOpts): Promise<Lancement> {
	try {
		await fs.access(opts.exe);
	} catch {
		throw new Error(`syncthing.exe not found: ${opts.exe}`);
	}
	await fs.mkdir(opts.home, { recursive: true });
	await fs.mkdir(opts.root, { recursive: true });
	const port = await portLibreBoucle();
	const cle = randomBytes(32).toString("hex");
	const child = spawn(opts.exe, launchArgs(opts.home, port, cle), {
		windowsHide: true,
		env: launchEnv(process.env),
		stdio: "ignore",
	});
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
		await rest.patchOptions(optionsFixees(await portLibre(LISTEN_PORT)));
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
		return {
			actif: true,
			appareil: ownId,
			appareils: devices
				.filter(d => d.deviceID !== ownId)
				.map(d => ({ id: d.deviceID, nom: d.name || d.deviceID.slice(0, 7), connecte: connexions.connections?.[d.deviceID]?.connected === true })),
			dossier: folderEtat(statut),
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
			for (const ev of await rest.events(since, EVENEMENTS)) {
				if (typeof ev.id === "number" && ev.id > since) since = ev.id;
				if (detecteur.observer(ev)) recu = true;
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

		async appairer(brut) {
			const id = typeof brut === "string" ? brut.trim() : "";
			if (!isDeviceId(id) || !hasValidCheckDigits(id) || id === courant.ownId || mort) return "invalide";
			try {
				const paires = await pairesCourants();
				if (paires.includes(id)) return "ok";
				if (paires.length >= MAX_APPAREILS) return "invalide";
				const attente = (await courant.rest.pendingDevices())[id];
				await courant.rest.putDevice({
					deviceID: id,
					name: attente?.name?.trim().slice(0, 64) ?? "",
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
		},
	};
}

/* ─────────── the lazily started instance the bridge talks to ─────────── */

export interface GestionSync {
	etat(): Promise<EtatSync>;
	appairer(deviceId: string): Promise<ResultatAppairage>;
	oublier(deviceId: string): Promise<void>;
	surEtat(rappel: (etat: EtatSync) => void): () => void;
	surDonneesRecues(rappel: () => void): () => void;
	/** At launch: starts the instance if sync was switched on. */
	demarrerSiActif(): Promise<void>;
	arreter(): Promise<void>;
}

export interface OptionsGestion {
	exe: string;
	home: string;
	/** Read at each start: the default folder can change between two. */
	root(): string;
	lireActif(): Promise<boolean>;
	/** Called after a first successful pairing: sync stays on from then. */
	poserActif(): Promise<void>;
}

export function creerGestionSync(o: OptionsGestion): GestionSync {
	let handle: SyncHandle | null = null;
	let demarrage: Promise<SyncHandle | null> | null = null;
	let fin = false;
	const abonnesEtat = new Set<(e: EtatSync) => void>();
	const abonnesDonnees = new Set<() => void>();

	function obtenir(): Promise<SyncHandle | null> {
		if (handle) return Promise.resolve(handle);
		return demarrage ??= (async () => {
			try {
				const h = await startSync({ exe: o.exe, home: o.home, root: path.resolve(o.root()) });
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
			const h = await obtenir();
			if (!h) return "indisponible";
			const res = await h.appairer(id);
			if (res === "ok") { try { await o.poserActif(); } catch (e) { console.warn("[syncthing] setting not saved:", e); } }
			return res;
		},
		async oublier(id) { await (await obtenir())?.oublier(id); },
		surEtat(rappel) { abonnesEtat.add(rappel); return () => { abonnesEtat.delete(rappel); }; },
		surDonneesRecues(rappel) { abonnesDonnees.add(rappel); return () => { abonnesDonnees.delete(rappel); }; },
		async demarrerSiActif() { if (await o.lireActif()) await obtenir(); },
		async arreter() {
			fin = true;
			const h = handle ?? (demarrage ? await demarrage : null);
			handle = null;
			await h?.stop();
		},
	};
}
