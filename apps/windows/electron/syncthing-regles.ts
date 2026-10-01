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

export const FOLDER_ID = "neo-quiz";
/** The port this app's Syncthing listens on (TCP and QUIC). The owner's
    personal Syncthing, if any, keeps the default 22000. */
export const LISTEN_PORT = 22100;

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
export function optionsFixees(portLibre: boolean): Record<string, unknown> {
	return {
		listenAddresses: listenAddresses(portLibre),
		startBrowser: false,
		urAccepted: -1,
		crashReportingEnabled: false,
		autoUpgradeIntervalH: 0,
	};
}

export interface FolderConfig {
	id: string;
	label: string;
	path: string;
	type: "sendreceive";
	devices: Array<{ deviceID: string; introducedBy: string; encryptionPassword: string }>;
	fsWatcherEnabled: boolean;
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
		/* Permission bits mean nothing between Windows and Android. */
		ignorePerms: true,
	};
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
	data?: Record<string, unknown>;
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
