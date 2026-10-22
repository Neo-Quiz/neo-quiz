/**
 * THE PYTHON GATE OF THE MAIN PROCESS (apps/windows/electron/python/garde.ts
 * and distant.ts, final review I1, I2, I3): the only path from the bridge to
 * a native Python spawn, driven here with an injected native dialog, a fake
 * Syncthing index and a fake service that counts spawns, on a real temporary
 * folder.
 *
 * What it prevents:
 * - a window (possibly compromised) running Python without the owner seeing
 *   the code in a native dialog: no answer, Cancel, a bad note path, a
 *   dialog already open -> no spawn; "Don't show again" remembered in a
 *   main-only file, keyed on the note path and the SHA-256 of the code
 *   computed in the main process; another code asks again;
 * - a request file the window wrote itself (Syncthing says THIS device made
 *   it, or has not indexed it, or its bytes are not the ones indexed) making
 *   the main process run code; a request of a device the owner never
 *   allowed running without the native authorization; a refusal leaking out
 *   as a run; a request from an allowed device's folder written by another
 *   device; code that is not the note's block;
 * - a run starting after the phone gave up (request gone, too old, or no
 *   time left), or an install the phone cannot wait for.
 *
 *     npm run check:python-gate
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const r = makeReporter("Python gate (main process)");
const tmp = mkdtempSync(join(tmpdir(), "neo-python-gate-"));
const F = "```";
const attendre = (ms = 20) => new Promise((res) => setTimeout(res, ms));

const LIBELLES = {
	titre: "Run this code on your PC?", message: "M", lancer: "Run", annuler: "Cancel", nePlusAfficher: "Don't show again for this quiz",
	lignesRestantes: (n) => `… and ${n} more lines`, lignesLongues: "LONG", invisibles: "HIDDEN",
	appareilTitre: "T", appareilMessage: (nom) => `Allow ${nom} to run Python on this PC?`, appareilDetail: "D", autoriser: "Allow", refuser: "Refuse",
};

/** A native dialog that answers from a queue (or never, with `null`), recording each call. */
function faussesBoites() {
	const appels = [];
	const reponses = [];
	const f = (options) => {
		appels.push(options);
		const rep = reponses.length ? reponses.shift() : { response: 1, checkboxChecked: false };
		if (rep === null) return new Promise(() => {});
		if (rep instanceof Error) return Promise.reject(rep);
		if (typeof rep === "function") return rep(options);
		return Promise.resolve(rep);
	};
	f.appels = appels;
	f.repondre = (...rs) => reponses.push(...rs);
	return f;
}

/** A service that counts spawns and answers `ok` (or what `reponses` says). */
function fauxService() {
	const runs = [], installs = [];
	const s = {
		runs, installs, reponses: [], octets: 0, enCours: false,
		run: async (job) => { runs.push(job); return s.reponses.length ? s.reponses.shift() : { status: "ok", stdout: "ran\n" }; },
		installer: async (noms) => { installs.push(noms); return { ok: true }; },
		octetsAInstaller: async () => s.octets,
		installationEnCours: () => s.enCours,
	};
	return s;
}

try {
	await withSrcModule(["apps/windows/electron/python/garde.ts", "apps/windows/electron/python/distant.ts", "src/shared-state/code-run-request.ts"], async (G, D, Q) => {
		/* ══════════ A1: the local warning ══════════ */
		const fichierAv = join(tmp, "userData", "python", "avertissements.json");
		const boites = faussesBoites();
		const memoire = G.creerMemoireAvertissements(fichierAv);
		const garde = G.creerGardePython({ dialogue: boites, libelles: () => LIBELLES, avertissements: memoire });
		const service = fauxService();
		const porte = (job) => G.executerPorte({ timeoutMs: 60000, signal: new AbortController().signal, ...job }, { garde, distant: { executer: async () => ({ status: "ok", stdout: "remote" }) }, service, suivre: (op) => op() });

		boites.repondre(null);
		const enAttente = porte({ code: "print(1)\n", sourcePath: "Q/a.md" });
		await attendre();
		r.check("A1: no answer to the dialog -> no spawn", service.runs.length, 0);
		r.check("A1: a second run while the dialog is open -> refused at once, no second dialog",
			[(await porte({ code: "print(2)\n", sourcePath: "Q/a.md" })).status, boites.appels.length, service.runs.length], ["unavailable", 1, 0]);
		void enAttente;

		const g2 = G.creerGardePython({ dialogue: boites, libelles: () => LIBELLES, avertissements: memoire });
		const porte2 = (job) => G.executerPorte({ timeoutMs: 60000, signal: new AbortController().signal, ...job }, { garde: g2, distant: { executer: async () => ({ status: "ok", stdout: "remote" }) }, service, suivre: (op) => op() });
		boites.appels.length = 0;
		boites.repondre({ response: 1, checkboxChecked: true });
		r.check("A1: Cancel -> no spawn (even with the box ticked)", [(await porte2({ code: "print(1)\n", sourcePath: "Q/a.md" })).status, service.runs.length], ["unavailable", 0]);
		const o = boites.appels[0];
		r.check("A1: native warning: type, title, buttons, Cancel default and cancel id, checkbox",
			[o.type, o.title, o.message, o.buttons, o.defaultId, o.cancelId, o.checkboxLabel, o.checkboxChecked],
			["warning", LIBELLES.titre, LIBELLES.message, ["Run", "Cancel"], 1, 1, LIBELLES.nePlusAfficher, false]);
		r.check("A1: the detail is the code itself", o.detail, "print(1)");

		boites.repondre({ response: 0, checkboxChecked: false });
		await porte2({ code: "print(1)\n", sourcePath: "Q/a.md" });
		r.check("A1: Run -> one spawn, of exactly that code", service.runs.map((j) => j.code), ["print(1)\n"]);
		boites.repondre({ response: 0, checkboxChecked: false });
		await porte2({ code: "print(1)\n", sourcePath: "Q/a.md" });
		r.check("A1: Run without the box -> asked again next time", boites.appels.length, 3);

		boites.repondre({ response: 0, checkboxChecked: true });
		await porte2({ code: "print(1)\n", sourcePath: "Q/a.md" });
		const nAppels = boites.appels.length;
		await porte2({ code: "print(1)\n", sourcePath: "Q/a.md" });
		r.check("A1: box ticked -> the identical code runs without a dialog", [boites.appels.length, service.runs.length], [nAppels, 4]);
		const sha = createHash("sha256").update("print(1)\n").digest("hex");
		r.check("A1: remembered in the main-only file, key = path#sha256 (computed in main)", JSON.parse(readFileSync(fichierAv, "utf8")), { v: 1, cles: ["Q/a.md#" + sha] });
		boites.repondre({ response: 1, checkboxChecked: false });
		await porte2({ code: "print(1) \n", sourcePath: "Q/a.md" });
		r.check("A1: code changed by one character -> dialog again, no spawn", [boites.appels.length, service.runs.length], [nAppels + 1, 4]);
		boites.repondre({ response: 1, checkboxChecked: false });
		await porte2({ code: "print(1)\n", sourcePath: "Q/b.md" });
		r.check("A1: same code from another note -> dialog again", boites.appels.length, nAppels + 2);
		const g3 = G.creerGardePython({ dialogue: boites, libelles: () => LIBELLES, avertissements: G.creerMemoireAvertissements(fichierAv) });
		r.check("A1: the memory survives a restart (read back from the file)", await g3.autoriserLocal("Q/a.md", "print(1)\n"), true);
		/* What the window can write (`reglages`) is another store: the old renderer
		   key does not dismiss anything here. */
		const reglagesDeLaFenetre = new Map([["pythonWarningDismissed", ["Q/c.md#" + createHash("sha256").update("x\n").digest("hex")]]]);
		boites.repondre({ response: 1, checkboxChecked: false });
		r.check("A1: a key the window wrote in its settings dismisses nothing", [await g3.autoriserLocal("Q/c.md", "x\n"), reglagesDeLaFenetre.size], [false, 1]);
		for (const [nom, sp] of [["no path", undefined], ["a number", 3], ["an empty path", ""], ["a path past 1024", "x".repeat(1025)]]) {
			const avant = boites.appels.length;
			r.check("A1: " + nom + " -> refused, no dialog, no spawn", [(await porte2({ code: "print(9)\n", sourcePath: sp })).status, boites.appels.length - avant], ["unavailable", 0]);
		}
		boites.repondre(new Error("dialog failed"));
		r.check("A1: a dialog that fails -> no run", await g3.autoriserLocal("Q/z.md", "print(3)\n"), false);
		r.check("A1: a remote job never shows the local warning", [(await porte2({ code: "print(1)\n", distant: { appareil: "x", demande: "y" } })).stdout, boites.appels.at(-1)?.title], ["remote", LIBELLES.titre]);
		{
			const m = G.creerMemoireAvertissements(join(tmp, "cap", "av.json"));
			for (let i = 0; i < 501; i++) m.ajouter("k" + i);
			r.check("A1: at most 500 keys, the oldest dropped", [m.contient("k0"), m.contient("k1"), m.contient("k500")], [false, true, true]);
		}
		{
			const long = Array.from({ length: 25 }, (_, i) => "x = " + i).join("\n");
			const a = G.apercuCode(long);
			r.check("A1: 20 lines shown, the rest counted", [a.lignes.length, a.restantes], [20, 5]);
			r.check("A1: the count line is in the detail", G.detailAvertissement(long, LIBELLES).endsWith("\n\n… and 5 more lines"), true);
			const tres = "y = '" + "a".repeat(300) + "'";
			r.check("A1: a line cut at 200 characters, and said so", [G.apercuCode(tres).lignes[0].length, G.detailAvertissement(tres, LIBELLES).endsWith("LONG")], [201, true]);
			const bidi = "ok = True  # \u202Eesle\u202C\nprint(ok)\u200B";
			const ab = G.apercuCode(bidi);
			r.check("A1: bidi and invisible characters replaced, and said so", [ab.lignes.join("\n").includes("\u202E") || ab.lignes.join("\n").includes("\u200B"), ab.invisibles, G.detailAvertissement(bidi, LIBELLES).endsWith("HIDDEN")], [false, true, true]);
			r.check("A1: a short clean code has no note", G.detailAvertissement("print(1)\n", LIBELLES), "print(1)");
		}

		/* ══════════ A2 / A3: a phone's request ══════════ */
		const PC = "aaaaaaaa-0000-4000-8000-000000000001";
		const TEL = "bbbbbbbb-0000-4000-8000-000000000002";
		const ID_ST_PC = "PCPCPC2-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA";
		const ID_ST_TEL = "TELTEL3-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB";
		const ID_ST_AUTRE = "AUTRE45-CCCCCCC-CCCCCCC-CCCCCCC-CCCCCCC-CCCCCCC-CCCCCCC-CCCCCCC";
		const racine = join(tmp, "root");
		const CODE = "print('from the note')";
		mkdirSync(join(racine, "Cours"), { recursive: true });
		writeFileSync(join(racine, "Cours", "a.md"), [`${F}quiz-blocks`, "[", `  ${JSON.stringify({ prompt: `A\n\n${F}python\n${CODE}\n${F}`, type: "text", answer: "x" })}`, "]", F].join("\n"));
		const shaCode = createHash("sha256").update(CODE).digest("hex");
		let horloge = 1_800_000_000_000;
		let n = 0;
		/** Writes a request file of the phone; `modifie` says who Syncthing says made it. */
		function demande({ at = horloge, target = PC, from = TEL, sha = shaCode, path = "Cours/a.md" } = {}) {
			const id = "req-" + (++n).toString(36).padStart(4, "0");
			const rel = Q.requestPath(TEL, id);
			mkdirSync(join(racine, ".neo-quiz", "code-runs", "requests", TEL), { recursive: true });
			writeFileSync(join(racine, ...rel.split("/")), JSON.stringify({ v: 1, id, at, from, target, path, sha256: sha, accepted: true }));
			return { id, rel };
		}
		/** The index as Syncthing would answer, from the bytes on disk NOW (or as told). */
		const index = new Map();
		const indexer = (rel, modifiedBy, octets = readFileSync(join(racine, ...rel.split("/")))) =>
			index.set(rel, { modifiedBy, blocksHash: D.blocksHashUnBloc(octets), deleted: false, invalid: false, type: "FILE_INFO_TYPE_FILE" });
		const sync = { racine, idPropre: ID_ST_PC, pairs: [{ id: ID_ST_TEL, nom: "Pixel 9" }, { id: ID_ST_AUTRE, nom: "Tablet" }], fichier: async (rel) => index.get(rel) ?? null };
		const boitesD = faussesBoites();
		const fichierApp = join(tmp, "userData", "python", "appareils.json");
		function distant({ svc = fauxService(), autorisations = G.creerAutorisationsAppareils(fichierApp), syncOk = true } = {}) {
			const gd = G.creerGardePython({ dialogue: boitesD, libelles: () => LIBELLES, avertissements: G.creerMemoireAvertissements(join(tmp, "av2.json")) });
			return { svc, ex: D.creerExecutionDistante({ sync: async () => (syncOk ? sync : null), idAppareil: async () => PC, autorisations, garde: gd, service: svc, now: () => horloge }) };
		}
		const job = (d, code = CODE) => ({ code, distant: { appareil: TEL, demande: d.rel } });

		{
			const { svc, ex } = distant();
			const d = demande();
			indexer(d.rel, ID_ST_PC.slice(0, 7));
			r.check("A2: a request written on THIS PC (modifiedBy = self) -> refused, no dialog, no spawn",
				[(await ex.executer(job(d))).status, boitesD.appels.length, svc.runs.length], ["unavailable", 0, 0]);
			const d2 = demande();
			const verdict = async (d) => { const res = await ex.executer(job(d)); return [res.status, res.error ?? null, boitesD.appels.length, svc.runs.length]; };
			r.check("A2: a request Syncthing has not indexed -> refused, no dialog", await verdict(d2), ["unavailable", null, 0, 0]);
			const d3 = demande();
			indexer(d3.rel, ID_ST_TEL.slice(0, 7));
			writeFileSync(join(racine, ...d3.rel.split("/")), readFileSync(join(racine, ...d3.rel.split("/")), "utf8").replace('"at":' + horloge, '"at":' + (horloge - 1)));
			r.check("A2: the phone's file overwritten here before the rescan (bytes differ) -> refused, no dialog", await verdict(d3), ["unavailable", null, 0, 0]);
			const d4 = demande();
			indexer(d4.rel, "ZZZZZZZ");
			r.check("A2: written by a device that is not paired -> refused, no dialog", await verdict(d4), ["unavailable", null, 0, 0]);
			const d6 = demande();
			indexer(d6.rel, ID_ST_PC.slice(0, 7));
			r.check("A2: modifiedBy = this PC, checked again after the others -> refused, no dialog", await verdict(d6), ["unavailable", null, 0, 0]);
			const d5 = demande();
			indexer(d5.rel, ID_ST_TEL.slice(0, 7));
			r.check("A2: no sync running -> refused", (await distant({ svc, syncOk: false }).ex.executer(job(d5))).status, "unavailable");
		}
		{
			const { svc, ex } = distant();
			const d = demande();
			indexer(d.rel, ID_ST_TEL.slice(0, 7));
			boitesD.appels.length = 0;
			boitesD.repondre({ response: 1, checkboxChecked: false });
			const res = await ex.executer(job(d));
			r.check("A2: a device never allowed -> the native authorization, naming it", [boitesD.appels.length, boitesD.appels[0]?.message, boitesD.appels[0]?.buttons, boitesD.appels[0]?.defaultId, boitesD.appels[0]?.cancelId],
				[1, "Allow Pixel 9 to run Python on this PC?", ["Allow", "Refuse"], 1, 1]);
			r.check("A2: Refuse -> 'refused' result, no spawn, nothing remembered", [res.status, res.error, svc.runs.length, existsSync(fichierApp)], ["unavailable", "refused", 0, false]);
			const d2 = demande();
			indexer(d2.rel, ID_ST_TEL.slice(0, 7));
			boitesD.repondre({ response: 0, checkboxChecked: false });
			const ok = await ex.executer(job(d2));
			r.check("A2: Allow -> one spawn of the note's block", [ok.status, svc.runs.map((j) => j.code)], ["ok", [CODE]]);
			r.check("A2: Allow persisted in the main-only file, bound to the Syncthing device", JSON.parse(readFileSync(fichierApp, "utf8")).appareils.map((a) => [a.appareil, a.syncthing, a.nom]), [[TEL, ID_ST_TEL, "Pixel 9"]]);
			r.check("A2: a remote run never shows the per-run warning", boitesD.appels.every((a) => a.title === "T"), true);
			r.check("A2: the same request again -> refused (runs once)", [(await ex.executer(job(d2))).status, svc.runs.length], ["unavailable", 1]);
		}
		{
			/* A restart: the allowed device is read back, no dialog. */
			const { svc, ex } = distant();
			const avant = boitesD.appels.length;
			const d = demande();
			indexer(d.rel, ID_ST_TEL.slice(0, 7));
			r.check("A2: allowed device after a restart -> runs without a dialog", [(await ex.executer(job(d))).status, boitesD.appels.length - avant, svc.runs.length], ["ok", 0, 1]);
			const d2 = demande();
			indexer(d2.rel, ID_ST_AUTRE.slice(0, 7));
			r.check("A2: the allowed device's folder written by ANOTHER paired device -> refused, no dialog",
				[(await ex.executer(job(d2))).error, boitesD.appels.length - avant, svc.runs.length], ["refused", 0, 1]);
			const d3 = demande();
			indexer(d3.rel, ID_ST_TEL.slice(0, 7));
			r.check("A2: code that is not the note's block -> 'changed', no spawn", [(await ex.executer(job(d3, "import os; os.remove('x')"))).error, svc.runs.length], ["changed", 1]);
			const d4 = demande({ sha: "0".repeat(64) });
			indexer(d4.rel, ID_ST_TEL.slice(0, 7));
			r.check("A2: a hash no block of the note has -> 'changed'", [(await ex.executer(job(d4))).error, svc.runs.length], ["changed", 1]);
			const d5 = demande({ target: "cccccccc-0000-4000-8000-000000000003" });
			indexer(d5.rel, ID_ST_TEL.slice(0, 7));
			r.check("A2: addressed to another PC -> refused", [(await ex.executer(job(d5))).status, svc.runs.length], ["unavailable", 1]);
			for (const [nom, dist] of [
				["another device's folder", { appareil: TEL, demande: Q.requestPath("cccccccc-0000-4000-8000-000000000003", "req-zzzz") }],
				["a path outside the requests", { appareil: TEL, demande: "Cours/a.md" }],
				["a traversal", { appareil: TEL, demande: `.neo-quiz/code-runs/requests/${TEL}/../x.json` }],
				["not an object", "x"],
			]) r.check("A2: request named by " + nom + " -> refused", [(await ex.executer({ code: CODE, distant: dist })).status, svc.runs.length], ["unavailable", 1]);
			/* The window cannot write the allowed list: it is this file, read here only. */
			r.check("A2: the allowed list is the main-only file, not the window's settings", G.creerAutorisationsAppareils(join(tmp, "elsewhere.json")).trouver(TEL), null);
		}
		{
			/* A3: never run late. */
			const { svc, ex } = distant();
			const vieille = demande({ at: horloge - Q.MAX_AGE_MS - 1 });
			indexer(vieille.rel, ID_ST_TEL.slice(0, 7));
			r.check("A3: MAX_AGE_MS < the phone's wait - 15 s", Q.MAX_AGE_MS <= Q.PHONE_WAIT_MS - 15_000, true);
			r.check("A3: a request past MAX_AGE_MS -> refused", [(await ex.executer(job(vieille))).status, svc.runs.length], ["unavailable", 0]);
		}
		{
			/* A device asked for the first time while the phone waits: the request
			   withdrawn (Stop on the phone) or aged during the dialog never runs. */
			const fichier2 = join(tmp, "userData2", "appareils.json");
			const { svc, ex } = distant({ autorisations: G.creerAutorisationsAppareils(fichier2) });
			const d = demande();
			indexer(d.rel, ID_ST_TEL.slice(0, 7));
			boitesD.repondre(() => { unlinkSync(join(racine, ...d.rel.split("/"))); return Promise.resolve({ response: 0, checkboxChecked: false }); });
			r.check("A3: request deleted while the dialog was open -> no spawn", [(await ex.executer(job(d))).status, svc.runs.length], ["unavailable", 0]);
			const { svc: svc2, ex: ex2 } = distant({ autorisations: G.creerAutorisationsAppareils(join(tmp, "userData3", "appareils.json")) });
			const d2 = demande();
			indexer(d2.rel, ID_ST_TEL.slice(0, 7));
			boitesD.repondre(() => { horloge += Q.MAX_AGE_MS + 1; return Promise.resolve({ response: 0, checkboxChecked: false }); });
			r.check("A3: request too old once the owner answered -> no spawn", [(await ex2.executer(job(d2))).status, svc2.runs.length], ["unavailable", 0]);
		}
		{
			const { svc, ex } = distant();
			const d = demande();
			indexer(d.rel, ID_ST_TEL.slice(0, 7));
			await ex.executer(job(d));
			r.check("A3: the run ends before the phone stops waiting", svc.runs[0].timeoutMs <= Q.PHONE_WAIT_MS - 8000 && svc.runs[0].timeoutMs >= 1000, true);
			/* A big library: the phone cannot wait -> the background install, and its name. */
			const svcI = fauxService();
			svcI.reponses.push({ status: "not-installed", stdout: "", missing: ["torch"] });
			svcI.octets = 124_000_000;
			const exI = distant({ svc: svcI }).ex;
			const di = demande();
			indexer(di.rel, ID_ST_TEL.slice(0, 7));
			const resI = await exI.executer(job(di));
			r.check("A3: install longer than the phone waits -> not-installed + pc-installing", [resI.status, resI.error], ["not-installed", "pc-installing"]);
			r.check("A3: ...and the install started in the background, the block not run again", [svcI.installs, svcI.runs.length], [[["torch"]], 1]);
			const svcS = fauxService();
			svcS.reponses.push({ status: "not-installed", stdout: "", missing: ["seaborn"] });
			svcS.octets = 300_000;
			const ds = demande();
			indexer(ds.rel, ID_ST_TEL.slice(0, 7));
			const resS = await distant({ svc: svcS }).ex.executer(job(ds));
			r.check("A3: a small install the phone can wait for -> installed, then run once more", [resS.status, svcS.installs, svcS.runs.length], ["ok", [["seaborn"]], 2]);
			const svcE = fauxService();
			svcE.enCours = true;
			const de = demande();
			indexer(de.rel, ID_ST_TEL.slice(0, 7));
			const resE = await distant({ svc: svcE }).ex.executer(job(de));
			r.check("A3: an install under way -> pc-installing at once, nothing run", [resE.error, svcE.runs.length], ["pc-installing", 0]);
		}
		{
			const octets = Buffer.from(JSON.stringify({ hello: 1 }));
			r.check("Syncthing's blocksHash of a one-block file (measured on v2.1.5)", D.blocksHashUnBloc(octets), "zV2hexA6TsW8p11Qd/TjBPZrAby8mLn3Bqr6f/3dRt8=");
		}
	});
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
r.done();
