/**
 * Non-regression of the embedded Syncthing (Task 6 of the Android v1 plan):
 * the PURE RULES (`syncthing-regles.ts`), the REST client
 * (`syncthing-rest.ts`) against a local fake HTTP server, the lifecycle
 * (`syncthing.ts`) with a missing binary and, on Windows when the pinned
 * binary has been fetched (`npm run fetch:syncthing`), with the real one.
 *
 * What it prevents: the bridge launches a binary and talks to an API that
 * could share ANY folder of the disk. So: only the `neo-quiz` folder is ever
 * accepted, only from a device the owner paired, a device id typed in the
 * window is validated before it reaches a config, the launch arguments carry
 * nothing but their parameters, and every REST call carries the key.
 *
 *     npm run check:electron-syncthing
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

async function cas(r, nom, fn) {
	try {
		await fn();
	} catch (e) {
		r.check(nom, "EXCEPTION: " + (e && e.message ? e.message : String(e)), "no exception");
	}
}

const ID = "CJXCUH3-SLWCMGX-7FKY3GZ-TAJCUWC-V5GKRYB-3APQ7CN-LPPVSJS-OZLDAQJ";
/* A second id, with correct check characters, produced by the real binary
   (`syncthing generate` in a throwaway home): the oracle is Syncthing's own,
   not a copy of our rule. A throwaway device, never paired for real. */
const AUTRE_ID = "XJ6SOIF-RNGCUTX-2KULCG5-CEH4D3K-YNQRMY6-JT7O5CR-XXML5WU-J5ZVOAH";
const CLE = "ab".repeat(32);

await withSrcModule(
	["apps/windows/electron/syncthing-regles.ts", "apps/windows/electron/syncthing-rest.ts", "apps/windows/electron/syncthing.ts", "apps/windows/electron/appairage-qr.ts", "src/dashboard/sync-affichage.ts"],
	async (regles, rest, sync, qrMod, aff) => {
		const r = makeReporter("Electron: Syncthing");

		/* ───────── pure rules ───────── */
		await cas(r, "constants", async () => {
			r.check("constants", { f: regles.FOLDER_ID, p: regles.LISTEN_PORT }, { f: "neo-quiz", p: 22100 });
		});

		await cas(r, "isDeviceId", async () => {
			const { isDeviceId } = regles;
			r.check("isDeviceId accepts the real format", isDeviceId(ID), true);
			r.check("isDeviceId refuses lowercase", isDeviceId(ID.toLowerCase()), false);
			r.check("isDeviceId refuses 7 groups", isDeviceId(ID.split("-").slice(0, 7).join("-")), false);
			r.check("isDeviceId refuses 9 groups", isDeviceId(ID + "-AAAAAAA"), false);
			r.check("isDeviceId refuses a path", isDeviceId("../../etc/passwd"), false);
			r.check("isDeviceId refuses a digit outside base32 (0, 1, 8, 9)", isDeviceId(ID.replace("CJXCUH3", "CJXCUH0")), false);
			r.check("isDeviceId refuses a trailing newline", isDeviceId(ID + "\n"), false);
			r.check("isDeviceId refuses a short group", isDeviceId(ID.replace("CJXCUH3", "CJXCUH")), false);
			r.check("isDeviceId refuses the empty string and non strings", [isDeviceId(""), isDeviceId(undefined), isDeviceId(42)], [false, false, false]);
		});

		await cas(r, "hasValidCheckDigits", async () => {
			const { hasValidCheckDigits } = regles;
			r.check("the real id has valid check characters", hasValidCheckDigits(ID), true);
			const abime = ID.slice(0, 3) + (ID[3] === "A" ? "B" : "A") + ID.slice(4);
			r.check("a mistyped character is caught", hasValidCheckDigits(abime), false);
			r.check("the generated test id is valid", hasValidCheckDigits(AUTRE_ID), true);
		});

		await cas(r, "acceptOffer", async () => {
			const { acceptOffer } = regles;
			r.check("acceptOffer: the neo-quiz folder from a paired device", acceptOffer({ folderId: "neo-quiz", deviceId: ID }, [ID]), true);
			r.check("acceptOffer refuses an unknown device", acceptOffer({ folderId: "neo-quiz", deviceId: AUTRE_ID }, [ID]), false);
			r.check("acceptOffer refuses another folder id, even from a paired device", acceptOffer({ folderId: "default", deviceId: ID }, [ID]), false);
			r.check("acceptOffer refuses a folder id that merely contains ours", acceptOffer({ folderId: "neo-quiz-2", deviceId: ID }, [ID]), false);
			r.check("acceptOffer refuses everyone when nobody is paired", acceptOffer({ folderId: "neo-quiz", deviceId: ID }, []), false);
		});

		/* An incoming pairing request: a device that added us and that we have not
		   (the Sync page then offers Accept / Ignore, and Accept goes through the
		   same native confirmation as typing a code). */
		await cas(r, "demandesDepuis", async () => {
			const { demandesDepuis } = regles;
			const attente = {
				[AUTRE_ID]: { name: "  Phone  ", address: "tcp://1.2.3.4:22000", time: "2026-10-01T10:00:00Z" },
				[ID]: { name: "Already paired" },
				"not-an-id": { name: "Forged" },
				[ID.slice(0, 3) + (ID[3] === "A" ? "B" : "A") + ID.slice(4)]: { name: "Bad check characters" },
			};
			r.check("a valid unknown device is listed, name trimmed", demandesDepuis(attente, [ID], "OWN"), [{ id: AUTRE_ID, nom: "Phone" }]);
			r.check("a paired device or our own id is never a request", demandesDepuis({ [AUTRE_ID]: { name: "x" }, [ID]: { name: "y" } }, [AUTRE_ID], ID), []);
			r.check("a name is cut to 64 characters, control characters dropped, text only",
				demandesDepuis({ [AUTRE_ID]: { name: "a\u0000<b>" + "z".repeat(100) } }, [], ID)[0].nom, ("a<b>" + "z".repeat(100)).slice(0, 64));
			r.check("no name falls back to the first 7 characters of the id", demandesDepuis({ [AUTRE_ID]: {} }, [], ID), [{ id: AUTRE_ID, nom: AUTRE_ID.slice(0, 7) }]);
			const hostile = "Eve" + [10, 13, 0x2028, 0x2029, 0x202e, 0x2066, 0x2069, 0x85].map(c => String.fromCharCode(c)).join("") + "Device ID: " + ID;
			r.check("nomSur: no control, line/paragraph separator or bidi override survives a hostile name",
				regles.nomSur(hostile), ("EveDevice ID: " + ID).slice(0, 64));
			r.check("nomSur: non strings give nothing, length capped at 64", [regles.nomSur(7), regles.nomSur("y".repeat(99)).length], ["", 64]);
			r.check("a hostile pending name cannot forge a line in the list either", [...demandesDepuis({ [AUTRE_ID]: { name: hostile } }, [], "OWN")[0].nom].some(c => [10, 13, 0x2028, 0x2029, 0x202e].includes(c.charCodeAt(0))), false);
			{
				const dates = { [AUTRE_ID]: { name: "old", time: "2026-10-01T08:00:00Z" }, [ID]: { name: "new", time: "2026-10-01T09:00:00Z" } };
				r.check("the most recent request comes first", demandesDepuis(dates, [], "OWN").map(d => d.nom), ["new", "old"]);
				r.check("plusDemandes counts what the cap hides (none here)", regles.plusDemandes(dates, [], "OWN"), 0);
				r.check("plusDemandes with a cap of 1 hides one", regles.plusDemandes(dates, [], "OWN", 1), 1);
				r.check("the cap keeps the newest", demandesDepuis(dates, [], "OWN", 1).map(d => d.nom), ["new"]);
			}
			r.check("garbage input gives nothing", [demandesDepuis(null, [], ID), demandesDepuis("x", [], ID), demandesDepuis([], [], ID)], [[], [], []]);
		});

		await cas(r, "dernierVu", async () => {
			r.check("a real date is milliseconds, Syncthing's never (year 1) and garbage are null",
				[regles.dernierVu("2026-10-01T10:00:00Z"), regles.dernierVu("0001-01-01T00:00:00Z"), regles.dernierVu("1970-01-01T00:00:00Z"), regles.dernierVu("nope"), regles.dernierVu(undefined)],
				[Date.parse("2026-10-01T10:00:00Z"), null, null, null, null]);
		});

		/* Sharing this device's id: the window names a CHANNEL from a closed set;
		   the URL and the text are built here, from the validated own id. */
		await cas(r, "launchArgs / launchEnv", async () => {
			const { launchArgs, launchEnv } = regles;
			r.check("launchArgs is exactly the verified flag list",
				launchArgs("C:/home", 8384, CLE),
				["serve", "--home=C:/home", "--no-browser", "--no-restart", "--no-upgrade", "--gui-address=127.0.0.1:8384", "--gui-apikey=" + CLE]);
			let refus = 0;
			for (const f of [() => launchArgs("C:/home", 80.5, CLE), () => launchArgs("C:/home", 70000, CLE), () => launchArgs("C:/home", 8384, "short"), () => launchArgs("C:/home", 8384, "zz".repeat(32)), () => launchArgs("", 8384, CLE)]) {
				try { f(); } catch { refus++; }
			}
			r.check("launchArgs refuses a bad port, a bad key, an empty home", refus, 5);
			const env = launchEnv({ PATH: "x", STGUIADDRESS: "0.0.0.0:1", STHOMEDIR: "C:/other", SystemRoot: "C:/Windows", STNOUPGRADE: "0" });
			r.check("launchEnv strips ST* variables and pins STNOUPGRADE", env, { PATH: "x", SystemRoot: "C:/Windows", STNOUPGRADE: "1" });
		});

		await cas(r, "config builders", async () => {
			const { listenAddresses, folderConfig, IGNORES } = regles;
			r.check("listenAddresses on the pinned port", listenAddresses(true), ["tcp://:22100", "quic://:22100", "dynamic+https://relays.syncthing.net/endpoint"]);
			r.check("listenAddresses falls back to any port", listenAddresses(false), ["tcp://:0", "quic://:0", "dynamic+https://relays.syncthing.net/endpoint"]);
			r.check("ignores", IGNORES, ["(?d).neo-quiz/**/*.sync-conflict-*", "(?d).trash"]);
			const f = folderConfig("C:/Neo Quiz", ID, [AUTRE_ID, ID, AUTRE_ID]);
			r.check("folderConfig: one folder, shared with the paired, once each, plus ourselves",
				{ id: f.id, path: f.path, type: f.type, devices: f.devices.map(d => d.deviceID) },
				{ id: "neo-quiz", path: "C:/Neo Quiz", type: "sendreceive", devices: [ID, AUTRE_ID] });
		});

		await cas(r, "optionsFixees", async () => {
			const o = regles.optionsFixees(true, "linux");
			r.check("local discovery avoids the personal Syncthing's 21027",
				[o.localAnnouncePort, o.localAnnounceMCAddr, o.localAnnounceEnabled], [21028, "[ff12::8384]:21028", undefined]);
			const w = regles.optionsFixees(true, "win32");
			r.check("win32: listens on nothing, only the relay pool (the PC dials out)", w.listenAddresses, ["dynamic+https://relays.syncthing.net/endpoint"]);
			r.check("win32: no LAN announce (binds UDP), global discovery on, no NAT traversal, relays and dialing stay",
				[w.localAnnounceEnabled, w.globalAnnounceEnabled, w.natEnabled, w.relaysEnabled], [false, true, false, true]);
			r.check("other platforms keep listening on the pinned port",
				[o.listenAddresses, o.localAnnounceEnabled, o.natEnabled], [["tcp://:22100", "quic://:22100", "dynamic+https://relays.syncthing.net/endpoint"], undefined, undefined]);
			r.check("nothing phones home", [o.urAccepted, o.crashReportingEnabled, o.autoUpgradeIntervalH, o.startBrowser], [-1, false, 0, false]);
		});

		await cas(r, "configXmlSansEcoute", async () => {
			const xml = "<configuration><options>\n        <listenAddress>tcp://0.0.0.0:1</listenAddress>\n        <listenAddress>dynamic+https://relays.syncthing.net/endpoint</listenAddress>\n        <listenAddress>quic://0.0.0.0:1</listenAddress>\n        <globalAnnounceEnabled>false</globalAnnounceEnabled>\n        <localAnnounceEnabled>true</localAnnounceEnabled>\n        <relaysEnabled>true</relaysEnabled>\n        <natEnabled>true</natEnabled>\n    </options>\n<gui><listenAddress>127.0.0.1:8384</listenAddress></gui></configuration>";
			const w = regles.configXmlSansEcoute(xml, "win32");
			r.check("win32: one relay listenAddress, no tcp/quic", w.match(/<listenAddress>[^<]*<\/listenAddress>/g), ["<listenAddress>dynamic+https://relays.syncthing.net/endpoint</listenAddress>", "<listenAddress>127.0.0.1:8384</listenAddress>"]);
			r.check("win32: flags rewritten", [/<localAnnounceEnabled>false</.test(w), /<globalAnnounceEnabled>true</.test(w), /<natEnabled>false</.test(w), /<relaysEnabled>true</.test(w)], [true, true, true, true]);
			r.check("idempotent", regles.configXmlSansEcoute(w, "win32"), w);
			r.check("other platforms untouched", regles.configXmlSansEcoute(xml, "linux"), xml);
		});

		await cas(r, "folderEtat", async () => {
			const { folderEtat } = regles;
			r.check("idle", folderEtat({ state: "idle", globalBytes: 10, inSyncBytes: 10 }), { etat: "idle", pourcentage: null });
			r.check("syncing with a percentage", folderEtat({ state: "syncing", globalBytes: 200, inSyncBytes: 50 }), { etat: "syncing", pourcentage: 25 });
			r.check("syncing with nothing to measure", folderEtat({ state: "sync-preparing", globalBytes: 0, inSyncBytes: 0 }), { etat: "syncing", pourcentage: null });
			r.check("error", folderEtat({ state: "error" }), { etat: "error", pourcentage: null });
			/* 2026-10-07: scanning used to read as idle, so every device said "Up to date" all the time. */
			for (const st of ["scanning", "scan-waiting", "cleaning", "clean-waiting"]) r.check(st + " is scanning", folderEtat({ state: st }).etat, "scanning");
			r.check("no status = absent", folderEtat(null), { etat: "absent", pourcentage: null });
		});

		await cas(r, "transfer rates", async () => {
			const { calculerDebit, typeConnexion } = regles;
			const c = (i, o, extra = {}) => ({ connected: true, inBytesTotal: i, outBytesTotal: o, ...extra });
			const p1 = calculerDebit(undefined, c(1000, 500), 10_000);
			r.check("first sample: no rate yet", [p1.bas, p1.haut, p1.echantillon], [0, 0, { t: 10_000, bas: 1000, haut: 500 }]);
			const p2 = calculerDebit(p1.echantillon, c(3000, 500), 12_000);
			r.check("bytes per second over the gap", [p2.bas, p2.haut], [1000, 0]);
			const p3 = calculerDebit(p2.echantillon, c(9000, 9000), 12_300, { bas: p2.bas, haut: p2.haut });
			r.check("a gap under one second keeps the old sample and rates", [p3.bas, p3.haut, p3.echantillon.t], [1000, 0, 12_000]);
			r.check("a counter that went down restarts", calculerDebit(p2.echantillon, c(10, 10), 20_000).bas, 0);
			r.check("not connected: nothing kept", calculerDebit(p2.echantillon, { connected: false, inBytesTotal: 99999 }, 20_000), { bas: 0, haut: 0, echantillon: undefined });
			r.check("junk counters count as zero", calculerDebit(p1.echantillon, c("x", -5), 12_000).bas, 0);
			r.check("relay type", typeConnexion({ connected: true, type: "relay-client" }), "relais");
			r.check("local", typeConnexion({ connected: true, type: "tcp-client", isLocal: true }), "lan");
			r.check("direct", typeConnexion({ connected: true, type: "quic-server", isLocal: false }), "direct");
			r.check("not connected", typeConnexion({ connected: false }), undefined);
		});

		await cas(r, "device row display", async () => {
			const { cleEtatAppareil, garderEtat, formaterDebit, DUREE_MIN_ETAT_MS } = aff;
			const dev = (o = {}) => ({ id: "X", nom: "X", connecte: true, vuLe: null, ...o });
			const et = (etat, a, pct = null) => ({ actif: true, appareil: "O", nom: "", appareils: [a], demandes: [], demandesPlus: 0, dossier: { etat, pourcentage: pct } });
			r.check("scanning shows scanning", cleEtatAppareil(et("scanning", dev()), dev()), "scanning");
			r.check("remote under 100 shows syncing", cleEtatAppareil(et("idle", dev()), dev({ progression: 60 })), "syncing");
			r.check("local syncing shows syncing", cleEtatAppareil(et("syncing", dev()), dev()), "syncing");
			r.check("idle and complete is up to date", cleEtatAppareil(et("idle", dev()), dev({ progression: 100 })), "uptodate");
			r.check("paused beats everything", cleEtatAppareil(et("scanning", dev()), dev({ enPause: true, connecte: false })), "paused");
			r.check("not connected", cleEtatAppareil(et("scanning", dev()), dev({ connecte: false })), "offline");
			r.check("error beats scanning", cleEtatAppareil(et("error", dev()), dev()), "error");
			const a = garderEtat(undefined, "scanning", 1000);
			r.check("first state is shown at once", a, { affiche: { cle: "scanning", depuis: 1000 }, attente: 0 });
			const b = garderEtat(a.affiche, "uptodate", 1100);
			r.check("a 100 ms scan stays visible, 700 ms left", [b.affiche.cle, b.attente], ["scanning", DUREE_MIN_ETAT_MS - 100]);
			r.check("after 800 ms it changes", garderEtat(a.affiche, "uptodate", 1800).affiche, { cle: "uptodate", depuis: 1800 });
			r.check("leaving to offline is immediate", garderEtat(a.affiche, "offline", 1100).affiche.cle, "offline");
			r.check("same state keeps its start", garderEtat(a.affiche, "scanning", 5000).affiche.depuis, 1000);
			r.check("speed units", [formaterDebit(512, "en"), formaterDebit(40 * 1024, "en"), formaterDebit(1.2 * 1024 * 1024, "en"), formaterDebit(NaN, "en")], ["512 B/s", "40 kB/s", "1.2 MB/s", "0 B/s"]);
		});

		await cas(r, "reload detector", async () => {
			const { creerDetecteurReception } = regles;
			const ev = (type, data) => ({ id: 1, type, data });
			const idle = ev("StateChanged", { folder: "neo-quiz", from: "scanning", to: "idle" });
			let d = creerDetecteurReception();
			r.check("local only: scan then idle does not fire",
				[d.observer(ev("LocalIndexUpdated", { folder: "neo-quiz" })), d.observer(idle)], [false, false]);
			d = creerDetecteurReception();
			r.check("a remote item finished then idle fires once",
				[d.observer(ev("ItemFinished", { folder: "neo-quiz", item: "a.md", action: "update" })), d.observer(ev("StateChanged", { folder: "neo-quiz", from: "idle", to: "syncing" })), d.observer(idle), d.observer(idle)],
				[false, false, true, false]);
			d = creerDetecteurReception();
			r.check("an item that failed is not a reception",
				[d.observer(ev("ItemFinished", { folder: "neo-quiz", item: "a.md", error: "boom" })), d.observer(idle)], [false, false]);
			d = creerDetecteurReception();
			r.check("another folder never counts",
				[d.observer(ev("ItemFinished", { folder: "other", item: "a.md" })), d.observer(ev("StateChanged", { folder: "other", to: "idle" })), d.observer(idle)], [false, false, false]);
			d = creerDetecteurReception();
			r.check("a remote item then the NEXT local-only idle does not fire again",
				[d.observer(ev("ItemFinished", { folder: "neo-quiz", item: "a.md" })), d.observer(idle), d.observer(ev("LocalIndexUpdated", { folder: "neo-quiz" })), d.observer(idle)], [false, true, false, false]);
		});

		await cas(r, "real time", async () => {
			const { cheminAScanner, folderConfig } = regles;
			const racine = String.raw`C:\Neo Quiz`;
			const f = folderConfig(racine, ID, []);
			r.check("the folder sees outside changes and deletions after 1 s and pulls at once", [f.fsWatcherDelayS, f.fsWatcherTimeoutS, f.pullerDelayS], [1, 1, 0]);
			r.check("a written path under the folder is scanned by its relative path", cheminAScanner(racine, String.raw`C:\Neo Quiz\XTI301\Cours.md`), "XTI301/Cours.md");
			r.check("Windows paths compare without case, and forward slashes work", cheminAScanner(racine, "c:/neo quiz/.neo-quiz/journal/a.jsonl"), ".neo-quiz/journal/a.jsonl");
			r.check("outside the folder, a sibling with the same prefix, or the folder itself: nothing",
				[String.raw`C:\Other\x.md`, String.raw`C:\Neo Quiz 2\x.md`, racine, String.raw`C:\Neo Quiz\a\..\..\x.md`].map(p => cheminAScanner(racine, p)), [null, null, null, null]);
		});

		await cas(r, "demandesExpirees", async () => {
			const { demandesExpirees, DEMANDE_DUREE_MS } = regles;
			const m = new Map();
			r.check("a new request is only timed, never expired at once", demandesExpirees({ A: {} }, m, 1000), []);
			r.check("still within its time: kept", demandesExpirees({ A: {} }, m, 1000 + DEMANDE_DUREE_MS - 1), []);
			r.check("its time is up: expired", demandesExpirees({ A: {} }, m, 1000 + DEMANDE_DUREE_MS), ["A"]);
			demandesExpirees({}, m, 5000 + DEMANDE_DUREE_MS);
			r.check("a request that went away is forgotten, and gets the full time again", demandesExpirees({ A: {} }, m, 9000 + DEMANDE_DUREE_MS), []);
			r.check("junk instead of requests: nothing expires", demandesExpirees(null, new Map(), 0), []);
		});
		await cas(r, "avecIgnore", async () => {
			const { avecIgnore, estIgnore } = regles;
			const A = "A".repeat(7), B = "B".repeat(7);
			const t0 = new Date("2026-10-04T10:00:00Z");
			const un = avecIgnore([{ deviceID: B, name: "x" }], A, true, t0);
			r.check("Ignore adds the device and keeps the others", un.map(d => d.deviceID), [B, A]);
			r.check("an ignored device is known as such", estIgnore(un, A), true);
			r.check("ignoring twice keeps one entry", avecIgnore(un, A, true, t0).filter(d => d.deviceID === A).length, 1);
			r.check("pairing it after all takes it out", avecIgnore(un, A, false).map(d => d.deviceID), [B]);
			r.check("junk in the list is dropped, never thrown on", avecIgnore([null, 3, "x"], A, false), []);
		});
		await cas(r, "confirmationRequise", async () => {
			const { confirmationRequise } = regles;
			r.check("a pending device accepted from the page: no native dialog", confirmationRequise(true, false), false);
			r.check("an id typed in Add a device (nothing pending): no native dialog, the click on Add is the answer", confirmationRequise(false, false), false);
			r.check("a request that came by the QR code: no native dialog either, the scan is the answer", [confirmationRequise(true, true), confirmationRequise(false, true)], [false, false]);
		});
		/* A `neo-quiz://pair` link comes from OUTSIDE (a click in the browser):
		   only a well-formed id with valid check characters goes on. */
		await cas(r, "lienAppairageExterne", async () => {
			const { lienAppairageExterne, lienDansArguments } = regles;
			r.check("a valid link, its name cleaned and kept",
				lienAppairageExterne(`neo-quiz://pair?device=${ID.toLowerCase()}&name=Laptop%E2%80%AE%0A`), `neo-quiz://pair?device=${ID}&name=Laptop`);
			r.check("no name: the id alone", lienAppairageExterne(`neo-quiz://pair?device=${ID}`), `neo-quiz://pair?device=${ID}`);
			r.check("wrong check characters are refused",
				lienAppairageExterne(`neo-quiz://pair?device=${ID.slice(0, 3)}${ID[3] === "A" ? "B" : "A"}${ID.slice(4)}`), null);
			r.check("another scheme or host is refused",
				[lienAppairageExterne(`https://pair?device=${ID}`), lienAppairageExterne(`neo-quiz://open?device=${ID}`)], [null, null]);
			r.check("junk is refused, never thrown on",
				[lienAppairageExterne("neo-quiz:"), lienAppairageExterne(42), lienAppairageExterne(`neo-quiz://pair?device=${ID}&name=${"x".repeat(600)}`)], [null, null, null]);
			r.check("found among the arguments of a second instance",
				lienDansArguments(["C:\\neo-quiz.exe", "--flag", `neo-quiz://pair?device=${ID}&name=PC`]), `neo-quiz://pair?device=${ID}&name=PC`);
			r.check("no link among the arguments", lienDansArguments(["C:\\neo-quiz.exe"]), null);
		});

		await cas(r, "recent changes", async () => {
			const { changementDepuis, ajouterChangement } = regles;
			const nomDe = court => (court === "CJXCUH3" ? "DESKTOP" : "?");
			const ev = (data, type = "RemoteChangeDetected", time = "2026-10-03T16:30:15+02:00") =>
				({ id: 1, type, time, data: { folder: "neo-quiz", action: "modified", type: "file", path: "Cours\\Neo Quiz.md", modifiedBy: "CJXCUH3", ...data } });
			r.check("a remote change becomes a line, with / separators and the device name", changementDepuis(ev({}), nomDe),
				{ appareil: "DESKTOP", action: "modifie", dossier: false, chemin: "Cours/Neo Quiz.md", quand: Date.parse("2026-10-03T16:30:15+02:00") });
			r.check("a local change too, and a directory is a folder", changementDepuis(ev({ action: "added", type: "dir", path: "XTI301" }, "LocalChangeDetected"), nomDe)?.dossier, true);
			r.check("deleted maps to supprime", changementDepuis(ev({ action: "deleted" }), nomDe)?.action, "supprime");
			r.check("another folder is ignored", changementDepuis(ev({ folder: "Personal" }), nomDe), null);
			r.check("another event type is ignored", changementDepuis(ev({}, "ItemFinished"), nomDe), null);
			r.check("an unknown action is ignored", changementDepuis(ev({ action: "renamed" }), nomDe), null);
			r.check("hidden paths are ignored (journal, trash, Syncthing files)",
				[".neo-quiz/journal/a.jsonl", "a/.trash/x.md", ".stfolder", "a/.syncthing.x.md.tmp"].map(path => changementDepuis(ev({ path }), nomDe)), [null, null, null, null]);
			r.check("a path that is not relative is ignored",
				["/etc/passwd", "C:\\x.md", "a/../b.md", "a//b.md", "x".repeat(513)].map(path => changementDepuis(ev({ path }), nomDe)), [null, null, null, null, null]);
			r.check("an event without a readable time is ignored", changementDepuis(ev({}, "RemoteChangeDetected", "never"), nomDe), null);
			const a = { appareil: "DESKTOP", action: "modifie", dossier: false, chemin: "a.md", quand: 1000 };
			const b = { ...a, chemin: "b.md", quand: 2000 };
			let l = ajouterChangement(ajouterChangement([], a), b);
			r.check("newest first", l.map(c => c.chemin), ["b.md", "a.md"]);
			l = ajouterChangement(l, { ...a, quand: 3000 });
			r.check("the same change again replaces the older line", l.map(c => `${c.chemin}@${c.quand}`), ["a.md@3000", "b.md@2000"]);
			r.check("another action on the same path is its own line", ajouterChangement(l, { ...a, action: "supprime", quand: 4000 }).length, 3);
			r.check("the list is bounded", ajouterChangement(Array.from({ length: 5 }, (_, i) => ({ ...a, chemin: i + ".md", quand: i })), b, 3).length, 3);
		});

		await cas(r, "main-only settings", async () => {
			const { reglageReserve } = regles;
			r.check("syncActif and syncRoot cannot be written from the window; others can",
				[reglageReserve("syncActif"), reglageReserve("syncRoot"), reglageReserve("defaultFolder"), reglageReserve("language")], [true, true, false, false]);
		});

		/* ───────── orphan cleanup, with a fake process table ───────── */
		const tmpO = mkdtempSync(join(tmpdir(), "neo-sync-orphan-"));
		const faux = (procs) => ({
			procs,
			tues: [],
			trouver: (home) => [...procs].filter(([, p]) => p.home === home).map(([pid]) => pid),
			imageDe: (pid) => procs.get(pid)?.image ?? null,
			tuerArbre(pid) { this.tues.push(pid); procs.delete(pid); },
		});
		await cas(r, "libererHome", async () => {
			const home = join(tmpO, "home");
			mkdirSync(home, { recursive: true });
			writeFileSync(join(home, "syncthing.pid"), "4242");
			let sys = faux(new Map([[4242, { image: "syncthing.exe", home }], [4300, { image: "syncthing.exe", home }], [900, { image: "syncthing.exe", home: "other" }]]));
			const tues = await sync.libererHome(home, sys);
			r.check("the pid file's live syncthing and the child found by home are killed, another home is not", [[...tues].sort(), sys.tues.sort(), [...sys.procs.keys()]], [[4242, 4300], [4242, 4300], [900]]);
			r.check("the pid file is removed", existsSync(join(home, "syncthing.pid")), false);
			writeFileSync(join(home, "syncthing.pid"), "777");
			sys = faux(new Map([[777, { image: "notepad.exe", home: "none" }]]));
			r.check("a reused pid that is another program is never killed", [await sync.libererHome(home, sys), sys.tues, [...sys.procs.keys()]], [[], [], [777]]);
			writeFileSync(join(home, "syncthing.pid"), "not a pid");
			sys = faux(new Map());
			r.check("a garbage pid file is ignored", await sync.libererHome(home, sys), []);
			r.check("no pid file, nothing running: nothing to do", await sync.libererHome(join(tmpO, "none"), faux(new Map())), []);
		});

		/* ───────── the lazily started instance: root and pairing confirmation ───────── */
		await cas(r, "creerGestionSync root", async () => {
			const memoire = {};
			const demarres = [];
			const ignores = [];
			const faussaire = async (o) => { demarres.push(o.root); return { etat: async () => ({ actif: true }), appairer: async () => "ok", oublier: async () => {}, ignorer: async (id) => { ignores.push(id); }, surEtat: () => () => {}, surDonneesRecues: () => () => {}, stop: async () => {} }; };
			const fabriquer = (defaut) => sync.creerGestionSync({
				exe: "x", home: "h", racineParDefaut: () => defaut,
				lireRoot: async () => memoire.root ?? null, poserRoot: async (v) => { memoire.root = v; },
				lireActif: async () => true, poserActif: async () => {}, confirmer: async () => true,
			}, faussaire);
			const g1 = fabriquer(join(tmpO, "A"));
			await g1.etat();
			r.check("the first start pins the default folder as syncRoot", [memoire.root, demarres[0]], [join(tmpO, "A"), join(tmpO, "A")]);
			await g1.ignorer(AUTRE_ID);
			r.check("ignorer reaches the running instance", ignores, [AUTRE_ID]);
			{
				/* One pairing dialog at a time: a second call while one is open returns at once. */
				let liberer = () => {};
				let appels = 0;
				const lent = async () => ({ etat: async () => ({ actif: true }), appairer: () => { appels++; return new Promise(ok => { liberer = () => ok("ok"); }); }, oublier: async () => {}, ignorer: async () => {}, surEtat: () => () => {}, surDonneesRecues: () => () => {}, stop: async () => {} });
				const g = sync.creerGestionSync({ exe: "x", home: "h", racineParDefaut: () => join(tmpO, "C"), lireRoot: async () => null, poserRoot: async () => {}, lireActif: async () => true, poserActif: async () => {}, confirmer: async () => true }, lent);
				const premier = g.appairer(AUTRE_ID);
				await new Promise(ok => setTimeout(ok, 20));
				r.check("a second pairing while one is open returns at once, without reaching the instance", [await g.appairer(AUTRE_ID), appels], ["annule", 1]);
				liberer();
				r.check("the first one still completes", await premier, "ok");
				const apres = g.appairer(AUTRE_ID);
				await new Promise(ok => setTimeout(ok, 20));
				liberer();
				r.check("the lock is released afterwards", [await apres, appels], ["ok", 2]);
				await g.arreter();
			}
			await g1.arreter();
			const g2 = fabriquer(join(tmpO, "B"));
			await g2.etat();
			r.check("changing the default folder afterwards does not move the shared folder", [memoire.root, demarres[1]], [join(tmpO, "A"), join(tmpO, "A")]);
			await g2.arreter();
		});

		/* ───────── the pairing QR code that changes ───────── */
		await cas(r, "pairing QR code (pure)", async () => {
			const { creerFenetreAppairage, codeDansNom, sansCode, texteQr, nouveauCode, VALIDITE_MS, ESSAIS_MAX } = qrMod;
			let horloge = 1_000_000;
			let graine = 0;
			const alea = n => Uint8Array.from({ length: n }, () => (graine = (graine + 1) % 256));
			const f = creerFenetreAppairage(alea, () => horloge);
			r.check("closed until a code is drawn", f.ouverte(), false);
			const c1 = f.tourner();
			r.check("a code is 10 characters without 0, O, 1 or I", /^[A-HJ-NP-Z2-9]{10}$/.test(c1), true);
			r.check("the QR text carries the id and the code", texteQr(ID, c1), "neo-quiz://pair?device=" + ID + "&code=" + c1);
			r.check("the QR text carries the PC's name, encoded", texteQr(ID, c1, "PC d'Alex&x"), "neo-quiz://pair?device=" + ID + "&code=" + c1 + "&name=PC%20d'Alex%26x");
			horloge += 2_000;
			const c2 = f.tourner();
			r.check("a new code each turn", c1 !== c2, true);
			r.check("an unknown code is refused", f.verifier("AAAAAAAAAA"), false);
			horloge += VALIDITE_MS - 2_001;
			r.check("an older code shown less than VALIDITE_MS ago is still accepted", f.verifier(c1), true);
			r.check("a match closes the window: every code dies", [f.ouverte(), f.verifier(c2)], [false, false]);
			const c3 = f.tourner();
			horloge += VALIDITE_MS;
			r.check("a code shown VALIDITE_MS ago is refused", f.verifier(c3), false);
			const c4 = f.tourner();
			for (let i = 0; i < ESSAIS_MAX; i++) f.echec();
			r.check("ESSAIS_MAX wrong codes close the window", [f.ouverte(), f.verifier(c4)], [false, false]);
			f.tourner(); f.fermer();
			r.check("fermer closes it", f.ouverte(), false);
			r.check("the code at the end of a name is read, the name without it kept",
				[codeDansNom("Xiaomi 13T Pro [NQ:K7Q2M9XPAB]"), sansCode("Xiaomi 13T Pro [NQ:K7Q2M9XPAB]")], ["K7Q2M9XPAB", "Xiaomi 13T Pro"]);
			r.check("no code: in the middle, wrong alphabet, wrong length, not a string",
				[codeDansNom("[NQ:K7Q2M9XPAB] Xiaomi"), codeDansNom("x [NQ:K7Q2M9XPA0]"), codeDansNom("x [NQ:K7Q2M9XPA]"), codeDansNom(42)], [null, null, null, null]);
			r.check("bytes 0..31 give the 32 characters once each, and b and b + 32 the same one",
				[new Set([0, 10, 20, 22].flatMap(k => [...nouveauCode(Uint8Array.from({ length: 10 }, (_, j) => k + j))])).size, nouveauCode(Uint8Array.from({ length: 10 }, (_, j) => j)) === nouveauCode(Uint8Array.from({ length: 10 }, (_, j) => j + 224))], [32, true]);
		});

		await cas(r, "pairing QR code (wired)", async () => {
			const confirmations = [];
			const appaires = [];
			let compteurAlea = 0;
			let demandes = [];
			const faussaire = async () => ({
				etat: async () => ({ actif: true }), idPropre: () => ID, demandesBrutes: async () => demandes,
				appairer: async (id, viaQr) => { appaires.push([id, viaQr]); confirmations.push(viaQr); return "ok"; },
				oublier: async () => {}, ignorer: async () => {}, surEtat: () => () => {}, surDonneesRecues: () => () => {}, stop: async () => {},
			});
			const g = sync.creerGestionSync({
				exe: "x", home: "h", racineParDefaut: () => join(tmpO, "Q"), lireRoot: async () => null, poserRoot: async () => {},
				lireActif: async () => true, poserActif: async () => {}, confirmer: async () => true,
				alea: n => Uint8Array.from({ length: n }, () => (compteurAlea = (compteurAlea + 1) % 256)),
			}, faussaire);
			const q1 = await g.qrSuivant();
			const code = new URLSearchParams(q1.texte.split("?")[1]).get("code");
			r.check("qrSuivant gives our id and a 2 s period", [q1.texte.startsWith("neo-quiz://pair?device=" + ID + "&code="), q1.periodeMs], [true, 2000]);
			demandes = [{ id: AUTRE_ID, nom: "Phone [NQ:AAAAAAAAAA]" }];
			await g.qrSuivant();
			r.check("a request with a wrong code is never paired nor shown", appaires, []);
			demandes = [{ id: AUTRE_ID, nom: "Phone [NQ:" + code + "]" }];
			await g.qrSuivant();
			r.check("a code of this window is not taken for the wrong one judged before", appaires.length, 1);
			appaires.length = 0;
			demandes = [];
			g.qrFermer();
			const q2 = await g.qrSuivant();
			const code2 = new URLSearchParams(q2.texte.split("?")[1]).get("code");
			demandes = [{ id: AUTRE_ID, nom: "Phone [NQ:" + code2 + "]" }];
			await g.qrSuivant();
			await new Promise(ok => setTimeout(ok, 10));
			r.check("a request with a live code goes to the pairing, marked viaQr, and paired with no native dialog", appaires, [[AUTRE_ID, true]]);
			demandes = [{ id: ID.replace("CJXCUH3", "CJXCUH4"), nom: "Other [NQ:" + code2 + "]" }];
			await g.qrSuivant();
			await new Promise(ok => setTimeout(ok, 10));
			r.check("a code that served once is dead", appaires.length, 1);
			demandes = [{ id: AUTRE_ID, nom: "Phone [NQ:" + code2 + "]" }];
			g.qrFermer();
			r.check("after qrFermer no request is looked at", appaires.length, 1);
			await g.arreter();
		});

		/* ───────── REST client, against a fake server ───────── */
		const requetes = [];
		const serveur = createServer((req, res) => {
			let corps = "";
			req.on("data", c => { corps += c; });
			req.on("end", () => {
				requetes.push({ method: req.method, url: req.url, cle: req.headers["x-api-key"] ?? null, corps });
				const bonne = req.headers["x-api-key"] === CLE;
				if (!bonne) { res.statusCode = 403; res.end("Forbidden"); return; }
				if (req.url === "/rest/system/ping") { res.end('{"ping":"pong"}'); return; }
				if (req.url === "/rest/system/status") { res.end(JSON.stringify({ myID: ID })); return; }
				if (req.url === "/rest/boom") { res.statusCode = 500; res.end("boom"); return; }
				if (req.url.startsWith("/rest/events")) { res.end("[]"); return; }
				if (req.url.startsWith("/rest/db/status")) { res.end(JSON.stringify({ state: "idle", globalBytes: 1, inSyncBytes: 1 })); return; }
				if (req.url === "/rest/config/devices") { res.end(JSON.stringify([{ deviceID: ID, name: "x" }])); return; }
				res.statusCode = 200;
				res.end("{}");
			});
		});
		await new Promise(ok => serveur.listen(0, "127.0.0.1", ok));
		const port = serveur.address().port;
		try {
			const api = rest.createRest(port, CLE);
			await cas(r, "rest ping/myId", async () => {
				await api.ping();
				r.check("ping sends the key", requetes.at(-1), { method: "GET", url: "/rest/system/ping", cle: CLE, corps: "" });
				r.check("myId reads status", await api.myId(), ID);
			});
			await cas(r, "rest 403", async () => {
				const mauvais = rest.createRest(port, "00".repeat(32));
				let msg = null;
				try { await mauvais.ping(); } catch (e) { msg = String(e.message); }
				r.check("a 403 throws", !!msg && msg.includes("403"), true);
			});
			await cas(r, "rest 500", async () => {
				let msg = null;
				try { await rest.createRest(port, CLE, (u, i) => fetch(u.replace("/rest/system/ping", "/rest/boom"), i)).ping(); } catch (e) { msg = String(e.message); }
				r.check("a 500 throws", !!msg && msg.includes("500"), true);
			});
			await cas(r, "rest verbs", async () => {
				requetes.length = 0; // the 403 case above sent a wrong key on purpose
				await api.putDevice({ deviceID: ID, name: "n" });
				r.check("putDevice is a PUT of the device", { m: requetes.at(-1).method, u: requetes.at(-1).url, b: JSON.parse(requetes.at(-1).corps).deviceID }, { m: "PUT", u: "/rest/config/devices/" + ID, b: ID });
				await api.deleteDevice(ID);
				r.check("deleteDevice", { m: requetes.at(-1).method, u: requetes.at(-1).url }, { m: "DELETE", u: "/rest/config/devices/" + ID });
				await api.events(41, ["StateChanged", "ItemFinished"]);
				r.check("events carries since and the type filter", requetes.at(-1).url, "/rest/events?since=41&timeout=1&events=StateChanged%2CItemFinished");
				r.check("folderStatus", await api.folderStatus("neo-quiz"), { state: "idle", globalBytes: 1, inSyncBytes: 1 });
				r.check("folderStatus url", requetes.at(-1).url, "/rest/db/status?folder=neo-quiz");
				await api.setIgnores("neo-quiz", ["a", "b"]);
				r.check("setIgnores posts the lines", { m: requetes.at(-1).method, u: requetes.at(-1).url, b: JSON.parse(requetes.at(-1).corps) }, { m: "POST", u: "/rest/db/ignores?folder=neo-quiz", b: { ignore: ["a", "b"] } });
				await api.patchOptions({ startBrowser: false });
				r.check("patchOptions", { m: requetes.at(-1).method, u: requetes.at(-1).url }, { m: "PATCH", u: "/rest/config/options" });
				await api.shutdown();
				r.check("shutdown", { m: requetes.at(-1).method, u: requetes.at(-1).url }, { m: "POST", u: "/rest/system/shutdown" });
				await api.putFolder({ id: "neo-quiz" });
				r.check("putFolder", requetes.at(-1).url, "/rest/config/folders/neo-quiz");
				await api.dismissPendingDevice(AUTRE_ID);
				r.check("dismissPendingDevice is a DELETE of one pending device", { m: requetes.at(-1).method, u: requetes.at(-1).url }, { m: "DELETE", u: "/rest/cluster/pending/devices?device=" + AUTRE_ID });
				await api.deviceStats();
				r.check("deviceStats", { m: requetes.at(-1).method, u: requetes.at(-1).url }, { m: "GET", u: "/rest/stats/device" });
				await api.pendingFolders(); await api.pendingDevices(); await api.connections(); await api.devices(); await api.folders();
				r.check("every call sent the key", requetes.every(q => q.cle === CLE), true);
			});
			await cas(r, "rest refuses an id that is not a path segment", async () => {
				let refus = 0;
				for (const f of [() => api.dismissPendingDevice("x&device=y"), () => api.deleteDevice("../folders/x"), () => api.putFolder({ id: "../x" }), () => api.folderStatus("a&b=c")]) {
					try { await f(); } catch { refus++; }
				}
				r.check("path-like ids never reach a URL", refus, 4);
			});
		} finally {
			serveur.closeAllConnections();
			await new Promise(ok => serveur.close(ok));
		}
		await cas(r, "rest, server gone", async () => {
			let msg = null;
			try { await rest.createRest(port, CLE).ping(); } catch (e) { msg = String(e.message); }
			r.check("a dead server rejects", !!msg, true);
		});

		/* ───────── lifecycle ───────── */
		const tmp = mkdtempSync(join(tmpdir(), "neo-sync-check-"));
		const compter = () => {
			if (process.platform !== "win32") return 0;
			try { return execFileSync("tasklist", ["/FI", "IMAGENAME eq syncthing.exe", "/NH"], { encoding: "utf8" }).split("\n").filter(l => /syncthing\.exe/i.test(l)).length; } catch { return -1; }
		};
		try {
			await cas(r, "startSync with a missing exe", async () => {
				const avant = compter();
				let msg = null;
				try { await sync.startSync({ exe: join(tmp, "absent", "syncthing.exe"), home: join(tmp, "h1"), root: join(tmp, "r1") }); } catch (e) { msg = String(e.message); }
				r.check("a missing exe rejects, naming the file", !!msg && msg.includes("syncthing.exe"), true);
				r.check("no orphan process", compter(), avant);
			});

			await cas(r, "startSync with a binary that is not syncthing", async () => {
				/* node.exe stands in: it exits at once on the `serve` argument. The
				   start must reject with a clean error, not hang for 30 seconds. */
				const t0 = Date.now();
				let msg = null;
				const sysFaux = { tues: [], trouver: () => [31337], imageDe: () => null, tuerArbre(pid) { this.tues.push(pid); this.trouver = () => []; } };
				try { await sync.startSync({ exe: process.execPath, home: join(tmp, "h3"), root: join(tmp, "r3"), confirmer: async () => false, sys: sysFaux }); } catch (e) { msg = String(e.message); }
				r.check("a start first kills a survivor holding the same home", sysFaux.tues, [31337]);
				r.check("a binary that exits at startup rejects fast", [!!msg && msg.includes("exited"), Date.now() - t0 < 15000], [true, true]);
			});

			const exe = join("apps", "windows", "vendor", "syncthing", "syncthing.exe");
			if (process.platform === "win32" && existsSync(exe)) {
				await cas(r, "startSync with the real binary", async () => {
					const avant = compter();
					let reponse = false;
					const demandes = [];
					const h = await sync.startSync({ exe, home: join(tmp, "h2"), root: join(tmp, "r2"), confirmer: async (id, nom) => { demandes.push([id, nom]); return reponse; } });
					try {
						r.check("the pid file names the running process", /^\d+$/.test(readFileSync(join(tmp, "h2", "syncthing.pid"), "utf8").trim()), true);
						const etat = await h.etat();
						r.check("the state carries this device's id and the folder", { actif: etat.actif, id: regles.isDeviceId(etat.appareil ?? ""), dossier: etat.dossier.etat, appareils: etat.appareils }, { actif: true, id: true, dossier: "idle", appareils: [] });
						r.check("an invalid id is refused, nothing paired", [await h.appairer("not-an-id"), (await h.etat()).appareils.length], ["invalide", 0]);
						r.check("our own id is refused", await h.appairer(etat.appareil), "invalide");
						r.check("an id with wrong check characters is refused", await h.appairer(ID.slice(0, 3) + (ID[3] === "A" ? "B" : "A") + ID.slice(4)), "invalide");
						r.check("invalid ids never reach the confirmation dialog", demandes.length, 0);
						/* The QR flow pairs at once too (the scan is the answer, 2026-10-07), as does
						   an id typed in "Add a device" (the click on Add, 2026-10-05): no dialog. */
						r.check("a QR pairing pairs without asking", [await h.appairer(AUTRE_ID, true, "Laptop‮"), demandes.length], ["ok", 0]);
						/* The name of a pasted pairing link is kept, cleaned. */
						r.check("the pasted link's name names the device", (await h.etat()).appareils.map(a => a.nom), ["Laptop"]);
						const apres = await h.etat();
						r.check("the paired device is listed, not connected", apres.appareils.map(a => [a.id, a.connecte]), [[AUTRE_ID, false]]);
						await h.oublier(AUTRE_ID);
						r.check("forgetting removes it", (await h.etat()).appareils.length, 0);
					} finally {
						await h.stop();
					}
					r.check("stop leaves no process behind", compter(), avant);
					r.check("stop removes the pid file", existsSync(join(tmp, "h2", "syncthing.pid")), false);
				});
			} else {
				console.log("real-binary section skipped (no win32 or no vendored syncthing.exe)");
			}
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
		r.done();
	},
);
