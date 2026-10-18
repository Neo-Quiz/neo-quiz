/**
 * THE BUG REPORT MAIN-PROCESS PIECES (`apps/windows/electron/journal-memoire.ts`
 * and `apps/windows/electron/signalement/*`).
 * Prevents: a log buffer that grows without bound, keeps a user name, an
 * e-mail or a stack path, throws on a circular argument, swallows the real
 * console call, or leaves console patched after uninstall; a bug report that
 * follows a redirect, reaches a foreign host, trusts the window's environment
 * or token, leaks the GitHub token into a return value, or polls GitHub
 * faster than it asked.
 * Discriminance: the redirect guard and the host rule are replayed on MUTANTS
 * of the real source and must then misbehave: a case that stays green whatever
 * the code does proves nothing.
 *     npm run check:signalement
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const SIG = "apps/windows/electron/signalement/";

/** A mutant of the service bundle: `from` replaced by `to` in `file`'s source. */
async function mutantService(file, from, to) {
	const src = fs.readFileSync(file, "utf8");
	if (!src.includes(from)) throw new Error("mutation does not apply: " + from);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sig-mutant-"));
	const out = path.join(dir, "mutant.mjs");
	const abs = path.resolve(file);
	const res = await build({
		entryPoints: [path.resolve(SIG + "service.ts")], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
		plugins: [{ name: "mutate", setup(b) {
			b.onLoad({ filter: /\.ts$/ }, (a) => (path.resolve(a.path) === abs ? { contents: src.replace(from, to), loader: "ts" } : undefined));
		} }],
	});
	fs.writeFileSync(out, res.outputFiles[0].text);
	return { mod: await import(pathToFileURL(out).href), dir };
}

await withSrcModule(["apps/windows/electron/journal-memoire.ts", SIG + "adresse.ts", SIG + "jeton.ts", SIG + "service.ts", "src/bug-report.ts"], async (JM, AD, JT, SV, BR) => {
	const r = makeReporter("Signalement");
	const calls = [];
	const origWarn = console.warn;
	const origError = console.error;
	console.warn = (...a) => { calls.push(["warn", a]); };
	console.error = (...a) => { calls.push(["error", a]); };
	const patchedWarn = console.warn;
	const patchedError = console.error;
	try {
		const j = JM.creerJournalMemoire();
		for (let i = 0; i < 250; i++) j.ajouter("warn", ["line " + i]);
		const lines = j.extrait().split("\n");
		r.check("journal: keeps the last 200 lines", [lines.length, lines[0], lines[199]], [200, "line 50", "line 249"]);

		j.vider();
		j.ajouter("error", ["x".repeat(2000)]);
		r.check("journal: a long line is cut to 500", j.extrait().length <= 500, true);

		j.vider();
		j.ajouter("warn", ["open C:\\Users\\Ahmed\\x failed for a.b@example.com"]);
		const e = new Error("boom C:\\Users\\Ahmed\\y");
		j.ajouter("error", [e]);
		const out = j.extrait();
		r.check("journal: no user name or e-mail", [/Ahmed/.test(out), /example\.com/.test(out)], [false, false]);
		r.check("journal: an Error becomes its message", [/boom/.test(out), /at .*\(/.test(out)], [true, false]);

		j.vider();
		const c = {}; c.self = c;
		let threw = false;
		try { j.ajouter("warn", [c]); } catch { threw = true; }
		r.check("journal: circular arg does not throw", threw, false);

		j.vider();
		const un = JM.installerJournalMemoire(j);
		r.check("journal: install wraps both", [console.warn !== patchedWarn, console.error !== patchedError], [true, true]);
		console.warn("hello", 3);
		console.error("bad");
		r.check("journal: originals still called", calls.map((c) => c[0]), ["warn", "error"]);
		r.check("journal: captured", j.extrait(), "hello 3\nbad");
		un();
		r.check("journal: uninstall restores", [console.warn === patchedWarn, console.error === patchedError], [true, true]);
	} finally {
		console.warn = origWarn;
		console.error = origError;
	}
	await sections(r, { AD, JT, SV, BR });
	r.done();
});

async function sections(r, { AD, JT, SV, BR }) {
	const RELAY = "https://relay.example.workers.dev";
	const TOKEN = "gho_SECRETTOKEN123";
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sig-check-"));
	try {
		// adresse
		const ok = (u) => AD.hoteAutorise(u, RELAY);
		r.check("adresse: relay, github.com, api.github.com accepted",
			[ok(RELAY + "/report"), ok("https://github.com/login/device"), ok("https://api.github.com/user"), ok("https://github.com:443/x")], [true, true, true, true]);
		r.check("adresse: http, other host, lookalike, userinfo, other port refused",
			[ok("http://github.com/x"), ok("https://example.com/x"), ok("https://github.com.evil.io/x"), ok("https://user@github.com/x"),
				ok("https://github.com:8443/x"), ok("https://relay.example.workers.dev:8443/x"), ok("nonsense"), AD.hoteAutorise("https://github.com/x", "http://relay.example")],
			[false, false, false, false, false, false, false, false]);

		// jeton
		const chif = (dispo = true) => ({ disponible: () => dispo, chiffrer: (c) => Buffer.from(c, "utf8").reverse(), dechiffrer: (b) => Buffer.from(b).reverse().toString("utf8") });
		const clair = { disponible: () => true, chiffrer: (c) => Buffer.from(c), dechiffrer: (b) => b.toString() };
		const f1 = path.join(tmp, "a", "signalement-github.bin");
		const m1 = JT.creerMagasinJetonGithub(f1, chif());
		await m1.ecrire({ accessToken: TOKEN, login: "octo" });
		r.check("jeton: round trip", await m1.lire(), { accessToken: TOKEN, login: "octo" });
		r.check("jeton: bytes are not clear text", fs.readFileSync(f1).toString("latin1").includes("SECRET"), false);
		const f2 = path.join(tmp, "b.bin");
		let refuse = "";
		try { await JT.creerMagasinJetonGithub(f2, chif(false)).ecrire({ accessToken: TOKEN, login: "octo" }); } catch (e) { refuse = e.message; }
		r.check("jeton: unavailable encryption refuses and writes nothing", [refuse, fs.existsSync(f2), fs.readdirSync(tmp).filter((n) => n.endsWith(".tmp"))], ["nostorage", false, []]);
		fs.writeFileSync(f2, "garbage");
		r.check("jeton: corrupt file reads as null", await JT.creerMagasinJetonGithub(f2, chif()).lire(), null);
		fs.writeFileSync(f2, JSON.stringify({ accessToken: 3 }));
		r.check("jeton: wrong shape reads as null", await JT.creerMagasinJetonGithub(f2, clair).lire(), null);
		await m1.effacer();
		r.check("jeton: effacer removes the file", fs.existsSync(f1), false);

		// service helpers
		const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
		const memoire = (session) => {
			let s = session;
			return { lire: async () => s, ecrire: async (x) => { s = x; }, effacer: async () => { s = null; }, get: () => s };
		};
		const ENV = { app: "9.9.9", os: "Windows 11", platform: "windows" };
		const mk = (transport, over = {}) => SV.creerServiceSignalement({
			transport, magasin: memoire(null), journal: { extrait: () => "line" }, env: () => ENV, maintenant: () => 0,
			relay: RELAY, clientId: "Iv1.client", ...over,
		});
		const RAPPORT = { v: 1, what: "it broke", env: { app: "evil", os: "evil", platform: "android" }, log: "hello a.b@example.com" };
		const OKREP = { ok: true, url: "https://github.com/Neo-Quiz/neo-quiz/issues/7", number: 7 };

		// send: body
		{
			const vus = [];
			const t = async (url, init) => { vus.push({ url, init, corps: JSON.parse(init.body) }); return json(OKREP); };
			const anon = mk(t);
			const res = await anon.envoyer(RAPPORT);
			r.check("send: success passes url and number", res, OKREP);
			r.check("send: posted to <relay>/report, manual redirect", [vus[0].url, vus[0].init.redirect, vus[0].init.method], [RELAY + "/report", "manual", "POST"]);
			const attendu = BR.validateReport(RAPPORT).report;
			r.check("send: anonymous body = validated report with the main process env, scrubbed log, no token",
				vus[0].corps, { ...attendu, env: ENV, log: BR.scrubLog(RAPPORT.log) });
			r.check("send: the log is scrubbed again", /example\.com/.test(vus[0].corps.log), false);
			const co = mk(t, { magasin: memoire({ accessToken: TOKEN, login: "octo" }) });
			await co.envoyer({ ...RAPPORT, githubToken: "gho_FROMWINDOW" });
			r.check("send: connected body carries the stored token only", vus[1].corps.githubToken, TOKEN);
			r.check("send: invalid input is refused before any request", [await anon.envoyer({ v: 2 }), await anon.envoyer("x"), vus.length], [{ ok: false, code: "invalid" }, { ok: false, code: "invalid" }, 2]);
		}

		// redirect
		const redirigeVers = (n) => async function t(url, init) {
			n.count++;
			if (init.redirect !== "manual") return t("https://evil.example/x", { ...init, redirect: "manual" });   // what fetch would do
			return new Response(null, { status: 302, headers: { Location: "https://evil.example/x" } });
		};
		{
			const n = { count: 0 };
			const res = await mk(redirigeVers(n)).envoyer(RAPPORT);
			r.check("send: redirect to another host is not followed", [res, n.count], [{ ok: false, code: "upstream" }, 1]);
		}

		// token never in a return value
		{
			const resultats = [];
			const t = async (url, init) => {
				if (url.endsWith("/report")) return json(JSON.parse(init.body).githubToken ? { ok: false, code: "token_invalid" } : OKREP);
				return json({ ok: false, code: "upstream" });
			};
			const s = mk(t, { magasin: memoire({ accessToken: TOKEN, login: "octo" }) });
			resultats.push(await s.apercu(), await s.envoyer(RAPPORT), await s.github.etat(), await s.github.attendre());
			const s2 = mk(async () => { throw new Error("boom " + TOKEN); }, { magasin: memoire({ accessToken: TOKEN, login: "octo" }) });
			resultats.push(await s2.envoyer(RAPPORT), await s2.github.etat());
			r.check("send: the token is in no return value", JSON.stringify(resultats).includes(TOKEN), false);
		}

		// token_invalid retried once anonymously
		{
			const corps = [];
			const t = async (url, init) => { const b = JSON.parse(init.body); corps.push(b); return json(b.githubToken ? { ok: false, code: "token_invalid" } : OKREP); };
			const mag = memoire({ accessToken: TOKEN, login: "octo" });
			const res = await mk(t, { magasin: mag }).envoyer(RAPPORT);
			r.check("send: token_invalid erases the session and retries once anonymously", [res, corps.length, !!corps[1].githubToken, mag.get()], [OKREP, 2, false, null]);
			const t2 = async () => { corps.push(1); return json({ ok: false, code: "token_invalid" }); };
			corps.length = 0;
			const res2 = await mk(t2, { magasin: memoire({ accessToken: TOKEN, login: "octo" }) }).envoyer(RAPPORT);
			r.check("send: a second token_invalid is upstream, no third request", [res2, corps.length], [{ ok: false, code: "upstream" }, 2]);
		}

		// timeout, pass-through, malformed
		{
			const hang = (url, init) => new Promise((_, rej) => { if (init.signal.aborted) rej(new Error("aborted")); init.signal.addEventListener("abort", () => rej(new Error("aborted"))); });
			let ms = 0;
			const res = await mk(hang, { minuteur: (d, fn) => { ms = d; fn(); return () => {}; } }).envoyer(RAPPORT);
			r.check("send: relay timeout (15 s) gives upstream", [res, ms], [{ ok: false, code: "upstream" }, 15000]);
			for (const code of ["rate_limited", "duplicate", "disabled", "invalid", "upstream"]) {
				r.check("send: " + code + " passes through", await mk(async () => json({ ok: false, code }, 429)).envoyer(RAPPORT), { ok: false, code });
			}
			const up = { ok: false, code: "upstream" };
			r.check("send: oversized answer is upstream", await mk(async () => new Response("x".repeat(70 * 1024))).envoyer(RAPPORT), up);
			r.check("send: malformed answers are upstream",
				[await mk(async () => new Response("not json")).envoyer(RAPPORT), await mk(async () => json({ ok: true })).envoyer(RAPPORT),
					await mk(async () => json({ ok: false, code: "weird" })).envoyer(RAPPORT), await mk(async () => json([1])).envoyer(RAPPORT),
					await mk(async () => json({ ok: true, url: "https://evil.example/i/1", number: 1 })).envoyer(RAPPORT)],
				[up, up, up, up, up]);
			r.check("send: a 401 on an identified send stays what the relay said (upstream)",
				await mk(async () => json({ ok: false, code: "upstream" }, 401), { magasin: memoire({ accessToken: TOKEN, login: "octo" }) }).envoyer(RAPPORT), up);
		}

		// flow
		{
			const mkFlux = (reponses, over = {}) => {
				const reqs = [];
				const horloge = { t: 0 };
				const pauses = [];
				const t = async (url, init) => {
					reqs.push({ url, body: init.body ? JSON.parse(init.body) : null, auth: init.headers && init.headers.Authorization });
					return json(reponses.shift());
				};
				const mag = memoire(null);
				const s = mk(t, {
					magasin: mag, maintenant: () => horloge.t,
					pause: async (d) => { pauses.push(d); horloge.t += d; if (over.surPause) over.surPause(pauses.length); },
					...over.deps,
				});
				return { s, reqs, pauses, mag, horloge };
			};
			const DEV = { device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 };
			const PEND = { error: "authorization_pending" };

			let F = mkFlux([DEV]);
			const d = await F.s.github.connecter();
			r.check("flow: start returns user_code, verification_uri, expires_in", d, { userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresIn: 900 });
			r.check("flow: start sends the Client ID only", F.reqs[0].body, { client_id: "Iv1.client" });
			let busy = "";
			try { await F.s.github.connecter(); } catch (e) { busy = e.message; }
			r.check("flow: a second connecter while one runs rejects", busy, "busy");

			F = mkFlux([DEV, PEND, { error: "slow_down" }, PEND, { access_token: TOKEN }, { login: "octo" }, DEV]);
			await F.s.github.connecter();
			const ok1 = await F.s.github.attendre();
			r.check("flow: waits interval, adds 5 s on slow_down", F.pauses, [5000, 5000, 10000, 10000]);
			r.check("flow: success returns only the login and stores the session", [ok1, F.mag.get(), F.reqs[5].url, F.reqs[5].auth], [{ login: "octo" }, { accessToken: TOKEN, login: "octo" }, "https://api.github.com/user", "Bearer " + TOKEN]);
			r.check("flow: no token in the result", JSON.stringify(ok1).includes(TOKEN), false);
			r.check("flow: a new flow can start after one ended", (await F.s.github.connecter()).userCode, "ABCD-1234");

			F = mkFlux([{ ...DEV, expires_in: 12 }, PEND, PEND, PEND]);
			await F.s.github.connecter();
			r.check("flow: stops at expires_in", [await F.s.github.attendre(), F.reqs.length], [{ error: "expired" }, 3]);
			F = mkFlux([DEV, { error: "expired_token" }]);
			await F.s.github.connecter();
			r.check("flow: expired_token", await F.s.github.attendre(), { error: "expired" });
			F = mkFlux([DEV, { error: "access_denied" }]);
			await F.s.github.connecter();
			r.check("flow: access_denied", await F.s.github.attendre(), { error: "denied" });
			F = mkFlux([DEV, { error: "weird" }]);
			await F.s.github.connecter();
			r.check("flow: unknown error is failed", await F.s.github.attendre(), { error: "failed" });

			F = mkFlux([DEV, PEND, PEND], { surPause: (n) => { if (n === 2) F.s.github.annuler(); } });
			await F.s.github.connecter();
			r.check("flow: annuler stops the poll with no request after cancel", [await F.s.github.attendre(), F.reqs.length], [{ error: "cancelled" }, 2]);

			F = mkFlux([{ ...DEV, verification_uri: "https://evil.example/device" }, DEV]);
			let refus = "";
			try { await F.s.github.connecter(); } catch (e) { refus = e.message; }
			r.check("flow: a verification_uri on another host is refused", refus, "refused");
			r.check("flow: after a refusal a new flow can start", (await F.s.github.connecter()).userCode, "ABCD-1234");

			F = mkFlux([DEV, { access_token: TOKEN }, { login: "octo" }], { deps: { magasin: { lire: async () => null, ecrire: async () => { throw new Error("nostorage"); }, effacer: async () => {} } } });
			await F.s.github.connecter();
			r.check("flow: storage refused gives failed, no token leaked", JSON.stringify(await F.s.github.attendre()), JSON.stringify({ error: "failed" }));
		}

		// etat / disconnect
		{
			const f = path.join(tmp, "etat.bin");
			const mag = JT.creerMagasinJetonGithub(f, chif());
			await mag.ecrire({ accessToken: TOKEN, login: "octo" });
			const s = mk(async () => json(OKREP), { magasin: mag });
			const e = await s.github.etat();
			r.check("etat: login only", [e, JSON.stringify(e).includes(TOKEN)], [{ login: "octo" }, false]);
			await s.github.deconnecter();
			r.check("etat: disconnect erases the file", [fs.existsSync(f), await s.github.etat()], [false, null]);
		}

		// ipc
		{
			const canaux = fs.readFileSync("apps/windows/electron/canaux.ts", "utf8");
			const pont = fs.readFileSync("apps/windows/electron/pont.ts", "utf8");
			const preload = fs.readFileSync("apps/windows/electron/preload.ts", "utf8");
			r.check("ipc: no access token field outside signalement/", [/accessToken/.test(canaux), /accessToken/.test(pont), /accessToken/.test(preload)], [false, false, false]);
			const noms = ["signalementApercu", "signalementEnvoyer", "signalementGithubConnecter", "signalementGithubAttendre", "signalementGithubAnnuler", "signalementGithubEtat", "signalementGithubDeconnecter"];
			r.check("ipc: every channel is declared, handled and exposed", noms.map((n) => [pont.includes(n + ":"), canaux.includes("CANAUX." + n), preload.includes("CANAUX." + n)]), noms.map(() => [true, true, true]));
		}

		// discriminance
		{
			const n = { count: 0 };
			const m1 = await mutantService(SIG + "flux.ts", 'redirect: "manual"', 'redirect: "follow"');
			const s1 = m1.mod.creerServiceSignalement({ transport: redirigeVers(n), magasin: memoire(null), journal: { extrait: () => "" }, env: () => ENV, maintenant: () => 0, relay: RELAY, clientId: "c" });
			await s1.envoyer(RAPPORT);
			r.check("mutant: without redirect manual the redirect IS followed (so the real case above can fail)", n.count, 2);
			fs.rmSync(m1.dir, { recursive: true, force: true });

			const m2 = await mutantService(SIG + "adresse.ts", "let u: URL;", "return true; let u: URL;");
			const evil = { device_code: "dc", user_code: "ABCD", verification_uri: "https://evil.example/device", expires_in: 900, interval: 5 };
			const avec = (mod) => mod.creerServiceSignalement({ transport: async () => json(evil), magasin: memoire(null), journal: { extrait: () => "" }, env: () => ENV, maintenant: () => 0, relay: RELAY, clientId: "c" });
			let accepte = true;
			try { await avec(m2.mod).github.connecter(); } catch { accepte = false; }
			r.check("mutant: with hoteAutorise always true a foreign verification_uri is accepted", accepte, true);
			fs.rmSync(m2.dir, { recursive: true, force: true });
		}
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}
