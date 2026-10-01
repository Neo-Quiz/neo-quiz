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
	["apps/windows/electron/syncthing-regles.ts", "apps/windows/electron/syncthing-rest.ts", "apps/windows/electron/syncthing.ts"],
	async (regles, rest, sync) => {
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
		await cas(r, "planPartage", async () => {
			const { planPartage } = regles;
			const textes = { sujet: "My code & more", corps: "Code: " + ID };
			const mail = planPartage("courriel", ID, textes);
			r.check("courriel is a mailto with encoded subject and body, nothing copied",
				mail, { url: "mailto:?subject=" + encodeURIComponent(textes.sujet) + "&body=" + encodeURIComponent(textes.corps), copier: null });
			r.check("discord copies the text and opens only discord://", planPartage("discord", ID, textes), { url: "discord://", copier: textes.corps });
			r.check("a channel outside the closed set gives nothing, whatever it carries",
				["https://evil.example", "file:///c:/x.bat", "systeme", "", undefined, 3, { toString: () => "courriel" }].map(c => planPartage(c, ID, textes)), Array(7).fill(null));
			r.check("an id that is not a device id is refused (nothing from the window is ever spliced)",
				[planPartage("courriel", "javascript:alert(1)", textes), planPartage("courriel", null, textes)], [null, null]);
			const tous = [planPartage("courriel", ID, { sujet: "\r\nBcc: x", corps: "%0d%0a" }), planPartage("discord", ID, textes)];
			r.check("only the two fixed schemes ever reach openExternal", tous.every(p => p && /^(mailto:\?|discord:\/\/$)/.test(p.url)), true);
			r.check("a subject with a line break stays encoded in one URL", tous[0].url.includes("\n") || tous[0].url.includes("\r"), false);
		});

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
			r.check("scanning is not syncing", folderEtat({ state: "scanning", globalBytes: 1, inSyncBytes: 1 }).etat, "idle");
			r.check("no status = absent", folderEtat(null), { etat: "absent", pourcentage: null });
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
						r.check("a cancelled confirmation pairs nothing and says so", [await h.appairer(AUTRE_ID), (await h.etat()).appareils.length, demandes.map(d => d[0])], ["annule", 0, [AUTRE_ID]]);
						reponse = true;
						r.check("a confirmed pairing works", await h.appairer(AUTRE_ID), "ok");
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
