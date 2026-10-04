/* ══════════════════════════════════════════════════════════
   THE RULES OF THE EMBEDDED SYNCTHING (pure, no Node import)

   Task 6 of the Android v1 plan. The main process launches Syncthing and
   talks to its REST API, which could share ANY folder of the disk. Everything
   that decides WHAT may be shared, WITH WHOM, and HOW the binary is launched
   lives here, as pure functions, so `scripts/check-electron-syncthing.mjs`
   can break each rule and watch it go red:

   - one folder only: `FOLDER_ID` (`neo-quiz`), at the app's default folder;
   - a device is a device the owner PAIRED (typed its id, or scanned it) — an
     offer from anybody else is ignored, whatever it offers;
   - a device id coming from the window is validated (format AND the Luhn
     check characters Syncthing writes into every id) before it reaches a
     config;
   - the launch arguments carry nothing but their parameters, and the
     environment is cleaned of every `ST*` variable (Syncthing reads
     `STGUIADDRESS`, `STHOMEDIR`… from it: a stray one in the user's
     environment would silently redirect this instance, or the personal
     Syncthing's settings).

   Verified against the pinned binary (v2.1.5): every flag of `launchArgs`
   appears in `syncthing serve --help`; `GET /rest/system/status`,
   `/rest/config/*`, `/rest/db/status`, `/rest/cluster/pending/*` and
   `/rest/events` answer with the shapes read below.
══════════════════════════════════════════════════════════ */

import { CLE_SYNC_ACTIF, CLE_SYNC_ROOT } from "./pont";
import { MAX_CHANGEMENTS, type Changement } from "../../../src/dashboard/sync-etat";

export const FOLDER_ID = "neo-quiz";

/** Settings only the main process writes: whether Syncthing starts at launch,
    and which folder it shares. The generic settings write refuses them. */
export function reglageReserve(cle: string): boolean {
	return cle === CLE_SYNC_ACTIF || cle === CLE_SYNC_ROOT;
}
/** The port this app's Syncthing listens on (TCP and QUIC). The owner's
    personal Syncthing, if any, keeps the default 22000. */
export const LISTEN_PORT = 22100;
/** UDP port of this app's local discovery (Syncthing's own default is 21027). */
export const PORT_ANNONCE_LAN = 21028;

/** Lines of the folder's `.stignore`. `(?d)` lets Syncthing delete the
    ignored files when they block the removal of a directory. Conflict copies
    under `.neo-quiz/` are the app's to merge, never to propagate. */
export const IGNORES: readonly string[] = [
	"(?d).neo-quiz/**/*.sync-conflict-*",
	"(?d).trash",
];

const RELAIS_DYNAMIQUE = "dynamic+https://relays.syncthing.net/endpoint";

/** 8 groups of 7 characters in base32 (A-Z, 2-7), dashes between. */
const FORMAT_ID = /^[A-Z2-7]{7}(?:-[A-Z2-7]{7}){7}$/;

export function isDeviceId(s: unknown): s is string {
	return typeof s === "string" && FORMAT_ID.test(s);
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Syncthing's Luhn-32 check character of 13 data characters. */
function luhn32(donnees: string): string {
	let facteur = 1;
	let somme = 0;
	for (const c of donnees) {
		let ajout = facteur * ALPHABET.indexOf(c);
		facteur = facteur === 2 ? 1 : 2;
		ajout = Math.floor(ajout / 32) + (ajout % 32);
		somme += ajout;
	}
	return ALPHABET[(32 - (somme % 32)) % 32];
}

/** A device id is four blocks of 13 characters, each followed by its own
    check character (that is how 52 become 56 = 8 x 7). A mistyped character
    fails here instead of silently pairing with a device that does not exist. */
export function hasValidCheckDigits(id: string): boolean {
	if (!isDeviceId(id)) return false;
	const brut = id.replace(/-/g, "");
	for (let i = 0; i < 4; i++) {
		const bloc = brut.slice(i * 14, i * 14 + 14);
		if (luhn32(bloc.slice(0, 13)) !== bloc[13]) return false;
	}
	return true;
}

/** An offer is accepted only for the one folder, from a device the owner paired. */
export function acceptOffer(o: { folderId: string; deviceId: string }, paired: readonly string[]): boolean {
	return o.folderId === FOLDER_ID && paired.includes(o.deviceId);
}

const CLE_API = /^[0-9a-f]{64}$/;

/** The arguments of `syncthing serve`. Every flag was checked against
    `syncthing serve --help` of v2.1.5. `--no-upgrade` is the flag form of
    `STNOUPGRADE=1` (set too, see `launchEnv`): the app updates the binary
    with itself, never the other way round. */
export function launchArgs(home: string, guiPort: number, apiKey: string): string[] {
	if (typeof home !== "string" || home.trim() === "") throw new Error("syncthing: empty home");
	if (!Number.isInteger(guiPort) || guiPort < 1024 || guiPort > 65535) throw new Error("syncthing: bad GUI port");
	if (!CLE_API.test(apiKey)) throw new Error("syncthing: bad API key");
	return [
		"serve",
		"--home=" + home,
		"--no-browser",
		"--no-restart",
		"--no-upgrade",
		"--gui-address=127.0.0.1:" + guiPort,
		"--gui-apikey=" + apiKey,
	];
}

/** The environment of the child: the parent's, minus every `ST*` variable
    Syncthing would read, plus `STNOUPGRADE=1`. */
export function launchEnv(base: Record<string, string | undefined>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(base)) {
		if (v === undefined || /^ST[A-Z0-9_]*$/.test(k)) continue;
		out[k] = v;
	}
	out.STNOUPGRADE = "1";
	return out;
}

/** TCP and QUIC on the pinned port; when it is taken, any port. The relay
    pool stays so that two devices that are both behind a NAT can meet. */
export function listenAddresses(portLibre: boolean): string[] {
	const port = portLibre ? LISTEN_PORT : 0;
	return [`tcp://:${port}`, `quic://:${port}`, RELAIS_DYNAMIQUE];
}

/** The options this app pins at every start: no browser, no usage report, no
    crash report, no self-upgrade. Everything else stays at Syncthing's default
    (global and local discovery, NAT traversal, relays). */
export function optionsFixees(portLibre: boolean, platform: string): Record<string, unknown> {
	/* On Windows the app instance never LISTENS: a listening socket on a
	   non-loopback address makes Windows Defender Firewall prompt the owner
	   the first time. Only the relay pool stays in `listenAddresses` (a relay
	   listener dials OUT to the relay, it binds nothing locally). LAN announce
	   binds UDP, so it is off; global discovery stays on, and so do relays and
	   outbound dialing: the PC connects to the phone/tablet, which keep
	   listening. NAT traversal (UPnP / NAT-PMP) may open ports: off. */
	const sansEcoute = platform === "win32";
	return {
		listenAddresses: sansEcoute ? [RELAIS_DYNAMIQUE] : listenAddresses(portLibre),
		...(sansEcoute ? { localAnnounceEnabled: false, globalAnnounceEnabled: true, natEnabled: false, relaysEnabled: true } : {}),
		startBrowser: false,
		urAccepted: -1,
		crashReportingEnabled: false,
		autoUpgradeIntervalH: 0,
		/* LAN discovery on its OWN port. Syncthing's default (21027, UDP) is
		   already bound by a personal Syncthing on the same machine: observed on
		   2.1.5, the second instance's IPv4 local discovery fails to bind
		   ("Only one usage of each socket address") and so cannot hear other
		   devices on the LAN. Every Neo Quiz instance uses `PORT_ANNONCE_LAN`,
		   so they still find each other; the personal one is left alone. */
		localAnnouncePort: PORT_ANNONCE_LAN,
		localAnnounceMCAddr: `[ff12::8384]:${PORT_ANNONCE_LAN}`,
	};
}

/** The same rule applied to `config.xml` BEFORE the first launch: patching
    through the REST API only happens once the process runs, and the default
    config already listens on 0.0.0.0 (the firewall prompt fires on that bind,
    however briefly). Text edit of the `<options>` block only; a no-op off
    Windows. */
export function configXmlSansEcoute(xml: string, platform: string): string {
	if (platform !== "win32") return xml;
	const fin = xml.indexOf("</options>");
	const debut = xml.indexOf("<options");
	if (debut < 0 || fin < 0) return xml;
	let opts = xml.slice(debut, fin);
	let place = false;
	opts = opts.replace(/[ \t]*<listenAddress>[^<]*<\/listenAddress>\r?\n?/g, () => {
		if (place) return "";
		place = true;
		return `        <listenAddress>${RELAIS_DYNAMIQUE}</listenAddress>\n`;
	});
	for (const [cle, val] of [["localAnnounceEnabled", "false"], ["globalAnnounceEnabled", "true"], ["natEnabled", "false"], ["relaysEnabled", "true"]]) {
		opts = opts.replace(new RegExp(`<${cle}>[^<]*</${cle}>`), `<${cle}>${val}</${cle}>`);
	}
	return xml.slice(0, debut) + opts + xml.slice(fin);
}

export interface FolderConfig {
	id: string;
	label: string;
	path: string;
	type: "sendreceive";
	devices: Array<{ deviceID: string; introducedBy: string; encryptionPassword: string }>;
	fsWatcherEnabled: boolean;
	fsWatcherDelayS: number;
	fsWatcherTimeoutS: number;
	pullerDelayS: number;
	ignorePerms: boolean;
	[cle: string]: unknown;
}

/** THE folder, shared with ourselves and with every paired device, once each. */
export function folderConfig(root: string, ownId: string, paired: readonly string[]): FolderConfig {
	const ids = [...new Set([ownId, ...paired])];
	return {
		id: FOLDER_ID,
		label: "Neo Quiz",
		path: root,
		type: "sendreceive",
		devices: ids.map(deviceID => ({ deviceID, introducedBy: "", encryptionPassword: "" })),
		fsWatcherEnabled: true,
		/* Real time (2026-10-03, same values as Neo Calendar 1.91.5, measured
		   there between two real engines): a change made OUTSIDE the app is
		   seen after 1 s instead of Syncthing's 10 s, and the receiving side
		   pulls at once instead of waiting 1 s in `sync-waiting`. A change made
		   BY the app does not wait for the watcher at all: it is scanned the
		   moment it is written (`signalerEcriture`). Re-put at every start, so
		   an existing folder gets them too. */
		fsWatcherDelayS: 1,
		/* A deletion is held back fsWatcherTimeoutS (6 x the delay by default):
		   an old note deleted outside the app took 6.1 s, 1.1 s with this
		   (measured by Neo Calendar, 2026-10-03). */
		fsWatcherTimeoutS: 1,
		pullerDelayS: 0,
		/* Permission bits mean nothing between Windows and Android. */
		ignorePerms: true,
	};
}

/** The path to scan for an absolute path the app just wrote: relative to the
    shared folder, with `/`, or `null` when it is not under it (another
    root, the folder itself). Windows paths compare case-insensitively. */
export function cheminAScanner(root: string, abs: string): string | null {
	const norm = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");
	const r = norm(root);
	const a = norm(abs);
	const memeCasse = /^[A-Za-z]:\//.test(r);
	const rr = memeCasse ? r.toLowerCase() : r;
	const aa = memeCasse ? a.toLowerCase() : a;
	if (!aa.startsWith(rr + "/")) return null;
	const rel = a.slice(r.length + 1);
	if (!rel || rel.split("/").some(s => s === "" || s === "." || s === "..")) return null;
	return rel;
}

export interface EtatDossier {
	etat: "idle" | "syncing" | "error" | "absent";
	pourcentage: number | null;
}

/** `GET /rest/db/status` → what the Sync page shows. `null` = the folder is not
    configured. Scanning counts as idle: nothing is being transferred. */
export function folderEtat(s: { state?: string; globalBytes?: number; inSyncBytes?: number } | null): EtatDossier {
	if (!s) return { etat: "absent", pourcentage: null };
	if (s.state === "error") return { etat: "error", pourcentage: null };
	if (s.state === "syncing" || s.state === "sync-preparing" || s.state === "sync-waiting") {
		const total = s.globalBytes ?? 0;
		if (total <= 0) return { etat: "syncing", pourcentage: null };
		const fait = Math.min(total, Math.max(0, s.inSyncBytes ?? 0));
		return { etat: "syncing", pourcentage: Math.floor((fait / total) * 100) };
	}
	return { etat: "idle", pourcentage: null };
}

export interface EvenementSync {
	id?: number;
	type: string;
	/** RFC 3339, as Syncthing writes it. */
	time?: string;
	data?: Record<string, unknown>;
}

/** Whether pairing `id` must first be confirmed by a native dialog. NOT when
    the device asked (it is pending) and the owner accepts it from the page's
    request notification: that click is the answer (owner's decision,
    2026-10-03). Always when nothing asked for it (an id typed in "Add a
    device"), and always for a request that came by the QR code (code +
    confirmation, the owner's choice for that flow). */
export function confirmationRequise(enAttente: boolean, viaQr: boolean): boolean {
	return viaQr || !enAttente;
}

/** The two events behind Syncthing's "Recent changes": a change found on
    this device's disk, and one applied from another device. */
export const EVENEMENTS_CHANGEMENT = ["LocalChangeDetected", "RemoteChangeDetected"] as const;

const ACTIONS: Readonly<Record<string, Changement["action"]>> = { added: "ajoute", modified: "modifie", deleted: "supprime" };

/**
 * One "Recent changes" event → what the Sync page shows, or `null` for
 * anything it must not: another folder, an unknown action, a path that is
 * not a plain relative one (bounded at 512 characters), or a HIDDEN path
 * (a segment starting with `.`: `.neo-quiz/` journals, `.stfolder`,
 * `.trash`, Syncthing's temporary files), which would bury the user's own
 * notes under the app's bookkeeping. `nomDe` turns the short device id of
 * `modifiedBy` into a name.
 */
export function changementDepuis(ev: EvenementSync, nomDe: (idCourt: string) => string): Changement | null {
	if (!(EVENEMENTS_CHANGEMENT as readonly string[]).includes(ev.type)) return null;
	const d = ev.data ?? {};
	if (d.folder !== FOLDER_ID) return null;
	const action = typeof d.action === "string" ? ACTIONS[d.action] : undefined;
	if (!action) return null;
	if (typeof d.path !== "string" || !d.path || d.path.length > 512) return null;
	const chemin = d.path.replace(/\\/g, "/");
	const segments = chemin.split("/");
	if (chemin.startsWith("/") || /^[A-Za-z]:/.test(chemin) || segments.some(s => s === "" || s === ".." || s.startsWith("."))) return null;
	const quand = typeof ev.time === "string" ? Date.parse(ev.time) : NaN;
	if (!Number.isFinite(quand)) return null;
	const court = typeof d.modifiedBy === "string" ? d.modifiedBy : "";
	return { appareil: nomDe(court).slice(0, 64), action, dossier: d.type === "dir", chemin, quand };
}

/** Adds a change in front, newest first. The same device doing the same thing
    to the same path again REPLACES the older line (an editor that saves
    three times in a row is one change, at its last time), and the list is
    bounded at `max`. */
export function ajouterChangement(liste: readonly Changement[], c: Changement, max: number = MAX_CHANGEMENTS): Changement[] {
	const reste = liste.filter(x => !(x.appareil === c.appareil && x.action === c.action && x.chemin === c.chemin));
	return [c, ...reste].sort((a, b) => b.quand - a.quand).slice(0, max);
}

/**
 * Decides when OTHER devices' changes have landed, so the window can reload
 * the journals and the shared state they live in.
 *
 * Syncthing 2.x emits `ItemFinished` ONLY for items the puller applied, i.e.
 * items that came from another device (a local change produces
 * `LocalIndexUpdated`, and only that). Then the folder goes back to `idle`
 * (`StateChanged`, `to: "idle"`). So: an error-free `ItemFinished` of our
 * folder arms the detector; the next `StateChanged` to `idle` of our folder
 * fires it once and disarms. A scan that ends in `idle` with nothing armed
 * (the owner's own edits) never fires.
 */
export function creerDetecteurReception(): { observer(ev: EvenementSync): boolean } {
	let arme = false;
	return {
		observer(ev) {
			const d = ev.data ?? {};
			if (d.folder !== FOLDER_ID) return false;
			if (ev.type === "ItemFinished") {
				if (!d.error) arme = true;
				return false;
			}
			if (ev.type === "StateChanged" && d.to === "idle" && arme) {
				arme = false;
				return true;
			}
			return false;
		},
	};
}

/* ───────── incoming requests, last seen, sharing the id ───────── */

export interface DemandeSync {
	id: string;
	nom: string;
}

/** At most this many pending requests are shown: Syncthing lists every unknown
    device that ever tried to connect, and the list is not the owner's to scroll. */
export const MAX_DEMANDES = 8;
const NOM_MAX = 64;

/** `GET /rest/cluster/pending/devices` → the devices that added US and that we
    have not paired. Only well-formed ids (format and check characters) that are
    neither ours nor already paired; the name is the REMOTE's and untrusted: cut
    to 64, control characters dropped, and the page renders it as text only. */
export function demandesDepuis(pending: unknown, paires: readonly string[], ownId: string, max: number = MAX_DEMANDES): DemandeSync[] {
	return candidats(pending, paires, ownId).slice(0, max);
}

/** How many valid requests the cap of `demandesDepuis` hides (the page says "+N"). */
export function plusDemandes(pending: unknown, paires: readonly string[], ownId: string, max: number = MAX_DEMANDES): number {
	return Math.max(0, candidats(pending, paires, ownId).length - max);
}

/** Every valid request, the most recent first (an unreadable time counts as oldest). */
function candidats(pending: unknown, paires: readonly string[], ownId: string): DemandeSync[] {
	if (!pending || typeof pending !== "object" || Array.isArray(pending)) return [];
	const lus: Array<DemandeSync & { t: number }> = [];
	for (const [id, info] of Object.entries(pending as Record<string, { name?: unknown; time?: unknown } | null>)) {
		if (!hasValidCheckDigits(id) || id === ownId || paires.includes(id)) continue;
		const t = typeof info?.time === "string" ? Date.parse(info.time) : NaN;
		lus.push({ id, nom: nomSur(info?.name) || id.slice(0, 7), t: Number.isFinite(t) ? t : 0 });
	}
	return lus.sort((a, b) => b.t - a.t).map(({ id, nom }) => ({ id, nom }));
}

/** A name announced by ANOTHER device, made safe to show anywhere, a native
    dialog included: control characters (so no forged line), the Unicode line and
    paragraph separators, and the bidi overrides/isolates (so no reordered text)
    are dropped, then trimmed and cut to 64. Never trust the raw name. */
export function nomSur(brut: unknown): string {
	if (typeof brut !== "string") return "";
	// eslint-disable-next-line no-control-regex
	return brut.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, NOM_MAX);
}

/** `lastSeen` of `GET /rest/stats/device` → milliseconds, `null` when the
    device was never seen (Syncthing writes the zero date) or the text is junk. */
export function dernierVu(texte: unknown): number | null {
	if (typeof texte !== "string") return null;
	const ms = Date.parse(texte);
	return Number.isFinite(ms) && ms > Date.UTC(2000, 0, 1) ? ms : null;
}

/** The config's `remoteIgnoredDevices` with [id] added (Ignore on a request:
    Syncthing then stops showing it, where dismissing the pending entry alone
    let it come back at the next connection attempt, 2026-10-04) or removed
    (the device is paired after all). Other entries are kept as they are. */
export function avecIgnore(liste: unknown, id: string, ignorer: boolean, maintenant = new Date()): Array<Record<string, unknown>> {
	const autres = (Array.isArray(liste) ? liste : []).filter((d): d is Record<string, unknown> =>
		typeof d === "object" && d !== null && (d as { deviceID?: unknown }).deviceID !== id);
	return ignorer ? [...autres, { deviceID: id, name: "", address: "", time: maintenant.toISOString() }] : autres;
}

/** True when [id] is in the config's `remoteIgnoredDevices`. */
export function estIgnore(liste: unknown, id: string): boolean {
	return Array.isArray(liste) && liste.some(d => typeof d === "object" && d !== null && (d as { deviceID?: unknown }).deviceID === id);
}

/** How long a pairing request waits for Accept before it is ignored on its
    own (2026-10-04): a request left there forever kept the page asking. */
export const DEMANDE_DUREE_MS = 60_000;

/** Keeps `premieres` (device id -> first time its request was seen) in step
    with the pending requests `attente` and returns the ids whose request has
    waited `DEMANDE_DUREE_MS` or more. A request that went away is forgotten,
    so the same device asking again later gets the full time again. */
export function demandesExpirees(attente: unknown, premieres: Map<string, number>, maintenant: number): string[] {
	const ids = attente && typeof attente === "object" && !Array.isArray(attente) ? Object.keys(attente) : [];
	for (const id of [...premieres.keys()]) if (!ids.includes(id)) premieres.delete(id);
	const expirees: string[] = [];
	for (const id of ids) {
		const debut = premieres.get(id);
		if (debut === undefined) premieres.set(id, maintenant);
		else if (maintenant - debut >= DEMANDE_DUREE_MS) expirees.push(id);
	}
	return expirees;
}
