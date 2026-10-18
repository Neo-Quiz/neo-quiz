/**
 * THE BUG REPORT RELAY (`services/bug-relay/`): the Cloudflare Worker between
 * the app and the public issue tracker, driven with an in-memory KV, a fake
 * clock and a FAKE GitHub (no network).
 * Prevents: a report accepted without limits (spam, duplicates, a body over the
 * byte cap), a kill switch that still calls GitHub, a user token that leaks to
 * a response, a log or the KV, a missing label that loses the report, and an
 * App JWT GitHub would not accept.
 *     npm run check:bug-relay
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateKeyPairSync, verify } from "node:crypto";
import { makeReporter } from "./lib/load-src.mjs";

const ENTRY = "services/bug-relay/src/index.ts";

/** Bundles the Worker; `mutate` may rewrite a source file (to build a MUTANT). */
async function load(dir, name, mutate) {
	const plugin = {
		name: "mutate",
		setup(b) {
			b.onLoad({ filter: /bug-relay[\\/]src[\\/].*\.ts$/ }, (a) => {
				const src = readFileSync(a.path, "utf8");
				return { contents: mutate ? mutate(a.path.replace(/\\/g, "/"), src) : src, loader: "ts" };
			});
		},
	};
	const outfile = join(dir, name + ".mjs");
	await build({ entryPoints: [ENTRY], bundle: true, format: "esm", platform: "neutral", mainFields: ["module", "main"], outfile, logLevel: "warning", plugins: [plugin] });
	return import(pathToFileURL(outfile).href);
}

/** Replaces `from` by `to` in the one file ending with `file`; throws if absent. */
const mutant = (file, from, to) => (path, src) => {
	if (!path.endsWith(file)) return src;
	if (!src.includes(from)) throw new Error("mutant target not found: " + from);
	return src.replace(from, to);
};

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PKCS8 = privateKey.export({ type: "pkcs8", format: "pem" });
const PKCS1 = privateKey.export({ type: "pkcs1", format: "pem" });
const USER_TOKEN = "ghu_" + "A1b2C3d4E5".repeat(4);
const b64 = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

const json = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

/** A fresh world: env with a Map-backed KV, a settable clock, a recording fake GitHub. */
function world(over = {}, key = PKCS8) {
	const store = new Map();
	const w = {
		store, calls: [], t: Date.UTC(2026, 9, 18, 10, 0, 0), n: 0,
		behave: { user: () => json(200, { login: "octo" }), userIssue: null, instIssue: null, labels422: false, install: () => json(201, { token: "ghs_inst" }) },
		env: {
			GITHUB_APP_ID: "123", GITHUB_INSTALLATION_ID: "456", GITHUB_APP_PRIVATE_KEY: key, ...over,
			STATE: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } },
		},
	};
	w.fetch = async (url, init = {}) => {
		const u = String(url);
		const auth = init.headers?.Authorization ?? "";
		const body = init.body ? JSON.parse(init.body) : null;
		w.calls.push({ url: u, method: init.method ?? "GET", auth, body });
		if (u.endsWith("/access_tokens")) return w.behave.install();
		if (u.endsWith("/user")) return w.behave.user();
		if (u.endsWith("/issues")) {
			const viaUser = auth === "Bearer " + USER_TOKEN;
			const custom = viaUser ? w.behave.userIssue : w.behave.instIssue;
			if (custom) return custom(body);
			if (w.behave.labels422 && body.labels) return json(422, { message: "Validation Failed" });
			w.n++;
			return json(201, { html_url: "https://github.com/Neo-Quiz/neo-quiz/issues/" + w.n, number: w.n });
		}
		return json(404, {});
	};
	w.post = (report, o = {}) => {
		const raw = o.raw ?? JSON.stringify(report);
		const req = new Request("https://relay.test" + (o.path ?? "/report"), {
			method: o.method ?? "POST",
			headers: { "content-type": o.type ?? "application/json", "CF-Connecting-IP": o.ip ?? "1.1.1.1" },
			body: (o.method ?? "POST") === "POST" ? raw : undefined,
		});
		return o.relay.handle(req, w.env, { fetch: w.fetch, now: () => w.t });
	};
	return w;
}

const rep = (i, extra = {}) => ({ v: 1, what: "bug number " + i, ...extra });
const MIN = 60_000;

/** The behaviours the mutants must break: rate limits and duplicates. */
async function limitsSuite(relay, r) {
	const go = (w, report, o = {}) => w.post(report, { relay, ...o }).then(async (res) => ({ s: res.status, b: await res.json() }));

	let w = world();
	const codes = [];
	for (let i = 0; i < 4; i++) codes.push((await go(w, rep(i))).b.code ?? "ok");
	r.check("rate limit per IP: 3 in 10 min pass, the 4th is refused", codes, ["ok", "ok", "ok", "rate_limited"]);
	w.t += 10 * MIN;
	r.check("rate limit per IP: one passes again after 10 min", (await go(w, rep(10))).b.ok, true);
	// 10 per day: windows of 3 every 10 min.
	w = world();
	const day = [];
	for (let i = 0; i < 12; i++) {
		day.push((await go(w, rep(i))).b.ok === true);
		if (i % 3 === 2) w.t += 10 * MIN;
	}
	r.check("rate limit per IP: the 11th in one day is refused", day, [true, true, true, true, true, true, true, true, true, true, false, false]);
	w = world();
	for (let i = 0; i < 3; i++) await go(w, rep(i));
	r.check("rate limit per IP: another IP is independent", [(await go(w, rep(7), { ip: "2.2.2.2" })).b.ok, (await go(w, rep(8))).b.code], [true, "rate_limited"]);

	w = world();
	const first = await go(w, rep(1));
	const again = await go(w, rep(1));
	r.check("duplicate: the same body within 24 h is refused", [first.b.ok, again.b.code, again.s], [true, "duplicate", 409]);
	const withToken = await go(w, { ...rep(1), githubToken: USER_TOKEN });
	r.check("duplicate: the hash ignores githubToken", withToken.b.code, "duplicate");
	w.t += 24 * 3600_000 + MIN;
	// the KV mock ignores TTLs: emulate expiry
	for (const k of [...w.store.keys()]) if (k.startsWith("dup:")) w.store.delete(k);
	r.check("duplicate: passes again after 24 h", (await go(w, rep(1), { ip: "9.9.9.9" })).b.ok, true);
}

const dir = mkdtempSync(join(tmpdir(), "bug-relay-"));
try {
	const relay = await load(dir, "real");
	const r = makeReporter("Bug relay");
	const go = (w, report, o = {}) => w.post(report, { relay, ...o }).then(async (res) => ({ s: res.status, b: await res.json() }));

	// Anonymous creation, App JWT.
	{
		const w = world();
		const res = await go(w, rep(1, { title: "T" }));
		const [tokCall, issueCall] = w.calls;
		const jwt = tokCall.auth.replace("Bearer ", "").split(".");
		const head = JSON.parse(b64(jwt[0]).toString());
		const pay = JSON.parse(b64(jwt[1]).toString());
		const sigOk = verify("sha256", Buffer.from(jwt[0] + "." + jwt[1]), publicKey, b64(jwt[2]));
		r.check("anonymous: creates the issue", [res.s, res.b.ok, res.b.number, res.b.url.startsWith("https://github.com/Neo-Quiz/neo-quiz/issues/")], [200, true, 1, true]);
		r.check("anonymous: installation token request", [tokCall.method, tokCall.url], ["POST", "https://api.github.com/app/installations/456/access_tokens"]);
		r.check("anonymous: JWT is RS256, verifies, claims", [head.alg, sigOk, pay.iss, pay.exp - pay.iat], ["RS256", true, "123", 600]);
		r.check("anonymous: JWT iat is now - 60", pay.iat, Math.floor(w.t / 1000) - 60);
		r.check("anonymous: issue call", [issueCall.url, issueCall.auth, issueCall.body.labels], ["https://api.github.com/repos/Neo-Quiz/neo-quiz/issues", "Bearer ghs_inst", ["from-app", "needs-triage"]]);
		r.check("anonymous: no Reported by", issueCall.body.body.includes("Reported by"), false);
	}
	// A PKCS#1 key is accepted too.
	{
		const w = world({}, PKCS1);
		const res = await go(w, rep(1));
		const [tokCall] = w.calls;
		const jwt = tokCall.auth.replace("Bearer ", "").split(".");
		r.check("PKCS#1 key: accepted, JWT verifies", [res.b.ok, verify("sha256", Buffer.from(jwt[0] + "." + jwt[1]), publicKey, b64(jwt[2]))], [true, true]);
	}
	// Invalid input.
	{
		const cases = {};
		let w = world();
		cases.unknown = await go(w, { ...rep(1), nope: 1 });
		const padded = (n) => '{"v":1,"what":"x"}' + " ".repeat(n - 18);
		w = world(); cases.b16385 = await go(w, null, { raw: padded(16385) });
		w = world(); cases.b16384 = await go(w, null, { raw: padded(16384) });
		w = world(); cases.type = await go(w, rep(1), { type: "text/plain" });
		w = world(); cases.get = await go(w, null, { method: "GET", path: "/report" });
		w = world(); cases.badjson = await go(w, null, { raw: "{nope" });
		w = world(); cases.multibyte = await go(w, { v: 1, what: "é".repeat(4000) });
		w = world(); cases.none = await go(w, rep(1), { path: "/nothing" });
		r.check("invalid: unknown field", [cases.unknown.s, cases.unknown.b], [400, { ok: false, code: "invalid" }]);
		r.check("invalid: 16385-byte body refused, 16384 accepted", [cases.b16385.b.code, cases.b16384.b.ok], ["invalid", true]);
		r.check("invalid: wrong content-type", cases.type.b.code, "invalid");
		r.check("invalid: GET /report is 405", cases.get.s, 405);
		r.check("invalid: malformed JSON", cases.badjson.b.code, "invalid");
		r.check("invalid: multibyte text under the byte cap passes", cases.multibyte.b.ok, true);
		r.check("invalid: unknown path is 404", cases.none.s, 404);
		w = world();
		await go(w, { ...rep(1), nope: 1 });
		await go(w, null, { raw: padded(16385) });
		await go(w, rep(1), { type: "text/plain" });
		await go(w, null, { method: "GET" });
		r.check("invalid: no GitHub call", w.calls.length, 0);
		w = world();
		const h = await w.post(null, { relay, method: "GET", path: "/health" });
		const rf = await w.post({ refreshToken: "x" }, { relay, path: "/refresh" });
		r.check("health: 200; /refresh does not exist", [h.status, rf.status], [200, 404]);
	}

	await limitsSuite(relay, r);

	// Global cap.
	{
		const w = world();
		const out = [];
		for (let i = 0; i < 31; i++) out.push((await go(w, rep(i), { ip: "10.0.0." + i })).b.ok === true);
		r.check("global cap: the 31st issue of a day is refused", [out.filter(Boolean).length, out[30]], [30, false]);
		w.t += 24 * 3600_000;
		r.check("global cap: the next day resets", (await go(w, rep(99), { ip: "10.1.1.1" })).b.ok, true);
	}
	// Kill switch.
	{
		const w = world({ RELAY_ENABLED: "false" });
		const res = await go(w, rep(1));
		r.check("kill switch: disabled, nothing called", [res.b, w.calls.length], [{ ok: false, code: "disabled" }, 0]);
		const w2 = world({ RELAY_ENABLED: "true" });
		r.check("kill switch: any other value stays enabled", (await go(w2, rep(1))).b.ok, true);
	}
	// Identified.
	{
		let w = world();
		let res = await go(w, rep(1, { githubToken: USER_TOKEN }));
		r.check("identified: GET /user then the issue with the USER token", [w.calls.map(c => c.method + " " + c.url.replace("https://api.github.com", "")), w.calls[0].auth, w.calls[1].auth, res.b.ok], [["GET /user", "POST /repos/Neo-Quiz/neo-quiz/issues"], "Bearer " + USER_TOKEN, "Bearer " + USER_TOKEN, true]);
		r.check("identified: no Reported by", w.calls[1].body.body.includes("Reported by"), false);

		w = world();
		w.behave.userIssue = () => json(403, { message: "forbidden" });
		res = await go(w, rep(1, { githubToken: USER_TOKEN }));
		const last = w.calls[w.calls.length - 1];
		r.check("identified fallback: installation token and Reported by", [res.b.ok, last.auth, last.body.body.startsWith("Reported by @octo")], [true, "Bearer ghs_inst", true]);

		w = world();
		w.behave.user = () => json(401, { message: "Bad credentials" });
		res = await go(w, rep(1, { githubToken: USER_TOKEN }));
		r.check("identified: GET /user 401 is token_invalid, no issue", [res.s, res.b, w.calls.length], [401, { ok: false, code: "token_invalid" }, 1]);
	}
	// The user token never leaks.
	{
		const logged = [];
		const saved = {};
		for (const m of ["log", "info", "warn", "error", "debug"]) { saved[m] = console[m]; console[m] = (...a) => logged.push(a.join(" ")); }
		const bodies = [];
		const ws = [];
		try {
			for (const mode of ["ok", "fallback", "invalid"]) {
				const w = world();
				if (mode === "fallback") w.behave.userIssue = () => json(403, {});
				if (mode === "invalid") w.behave.user = () => json(401, {});
				const res = await w.post(rep(1, { githubToken: USER_TOKEN }), { relay });
				bodies.push(await res.text());
				ws.push(w);
			}
		} finally { for (const m in saved) console[m] = saved[m]; }
		const inKv = ws.some(w => [...w.store].some(([k, v]) => k.includes(USER_TOKEN) || v.includes(USER_TOKEN)));
		r.check("user token never leaks: responses, console, KV", [bodies.some(b => b.includes(USER_TOKEN)), logged.some(l => l.includes(USER_TOKEN)), inKv], [false, false, false]);
	}
	// Missing label.
	{
		const w = world();
		w.behave.labels422 = true;
		const res = await go(w, rep(1));
		const posts = w.calls.filter(c => c.url.endsWith("/issues"));
		r.check("missing label: retried without labels, succeeds", [res.b.ok, posts.length, posts[0].body.labels !== undefined, posts[1].body.labels], [true, 2, true, undefined]);
	}
	// Upstream failures.
	{
		let w = world();
		w.behave.instIssue = () => json(500, { message: "boom" });
		r.check("upstream: GitHub 500", (await go(w, rep(1))).b, { ok: false, code: "upstream" });
		w = world();
		w.behave.instIssue = () => json(201, "<html>not json");
		r.check("upstream: non-JSON answer", (await go(w, rep(1))).b.code, "upstream");
		w = world();
		w.fetch = async () => { throw new TypeError("network down"); };
		r.check("upstream: rejected fetch", (await go(w, rep(1))).b.code, "upstream");
		w = world();
		w.behave.install = () => json(401, {});
		const res = await go(w, rep(1));
		r.check("upstream: refused installation token, nothing counted", [res.b.code, [...w.store.keys()].some(k => k.startsWith("day:") || k.startsWith("dup:"))], ["upstream", false]);
	}
	r.done();

	// Discriminance: the limits suite must FAIL on mutants with the check cut out.
	const silent = () => { const s = { fails: 0 }; return { check(_n, got, want) { if (JSON.stringify(got) !== JSON.stringify(want)) s.fails++; }, done() {}, s }; };
	for (const [name, file, from, to] of [
		["rate limit", "limits.ts", "n10 >= MAX_PER_IP_10MIN || nd >= MAX_PER_IP_DAY", "false"],
		["duplicate", "limits.ts", '(await kv.get("dup:" + hash)) !== null', "false"],
	]) {
		const m = await load(dir, "mut-" + name.replace(" ", "-"), mutant(file, from, to));
		const rr = silent();
		await limitsSuite(m, rr);
		const d = makeReporter("Bug relay discriminance");
		d.check("discriminance: the " + name + " check is load-bearing (mutant fails)", rr.s.fails > 0, true);
		d.done();
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}
