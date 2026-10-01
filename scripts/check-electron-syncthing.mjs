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
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
				await api.pendingFolders(); await api.pendingDevices(); await api.connections(); await api.devices(); await api.folders();
				r.check("every call sent the key", requetes.every(q => q.cle === CLE), true);
			});
			await cas(r, "rest refuses an id that is not a path segment", async () => {
				let refus = 0;
				for (const f of [() => api.deleteDevice("../folders/x"), () => api.putFolder({ id: "../x" }), () => api.folderStatus("a&b=c")]) {
					try { await f(); } catch { refus++; }
				}
				r.check("path-like ids never reach a URL", refus, 3);
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
				try { await sync.startSync({ exe: process.execPath, home: join(tmp, "h3"), root: join(tmp, "r3") }); } catch (e) { msg = String(e.message); }
				r.check("a binary that exits at startup rejects fast", [!!msg && msg.includes("exited"), Date.now() - t0 < 15000], [true, true]);
			});

			const exe = join("apps", "windows", "vendor", "syncthing", "syncthing.exe");
			if (process.platform === "win32" && existsSync(exe)) {
				await cas(r, "startSync with the real binary", async () => {
					const avant = compter();
					const h = await sync.startSync({ exe, home: join(tmp, "h2"), root: join(tmp, "r2") });
					try {
						const etat = await h.etat();
						r.check("the state carries this device's id and the folder", { actif: etat.actif, id: regles.isDeviceId(etat.appareil ?? ""), dossier: etat.dossier.etat, appareils: etat.appareils }, { actif: true, id: true, dossier: "idle", appareils: [] });
						r.check("an invalid id is refused, nothing paired", [await h.appairer("not-an-id"), (await h.etat()).appareils.length], ["invalide", 0]);
						r.check("our own id is refused", await h.appairer(etat.appareil), "invalide");
						r.check("an id with wrong check characters is refused", await h.appairer(ID.slice(0, 3) + (ID[3] === "A" ? "B" : "A") + ID.slice(4)), "invalide");
						r.check("pairing a valid id works", await h.appairer(AUTRE_ID), "ok");
						const apres = await h.etat();
						r.check("the paired device is listed, not connected", apres.appareils.map(a => [a.id, a.connecte]), [[AUTRE_ID, false]]);
						await h.oublier(AUTRE_ID);
						r.check("forgetting removes it", (await h.etat()).appareils.length, 0);
					} finally {
						await h.stop();
					}
					r.check("stop leaves no process behind", compter(), avant);
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
