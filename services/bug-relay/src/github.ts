/** GitHub calls of the relay. Every call goes through the injected fetch. */

export interface KVLike {
	get(k: string): Promise<string | null>;
	put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void>;
}

export interface GhEnv {
	GITHUB_APP_ID: string;
	GITHUB_INSTALLATION_ID: string;
	GITHUB_APP_PRIVATE_KEY: string;
}

export const REPO = "Neo-Quiz/neo-quiz";
export const LABELS = ["from-app", "needs-triage"];
const API = "https://api.github.com";

type F = typeof fetch;
export class UpstreamError extends Error {}

const b64url = (b: ArrayBuffer | Uint8Array | string): string => {
	const u = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
	let s = "";
	for (const c of u) s += String.fromCharCode(c);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const derLen = (n: number): number[] => (n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255]);

/** PEM to PKCS#8 DER. A PKCS#1 key ("BEGIN RSA PRIVATE KEY") is wrapped in the PKCS#8 envelope. */
function keyDer(pem: string): Uint8Array<ArrayBuffer> {
	const pkcs1 = /BEGIN RSA PRIVATE KEY/.test(pem);
	const raw = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), c => c.charCodeAt(0));
	if (!pkcs1) return raw;
	const algo = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
	const inner = [0x02, 0x01, 0x00, ...algo, 0x04, ...derLen(raw.length)];
	return Uint8Array.from([0x30, ...derLen(inner.length + raw.length), ...inner, ...raw]);
}

export async function appJwt(env: GhEnv, nowSec: number): Promise<string> {
	const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const pay = b64url(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: env.GITHUB_APP_ID }));
	const key = await crypto.subtle.importKey("pkcs8", keyDer(env.GITHUB_APP_PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
	const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + pay));
	return head + "." + pay + "." + b64url(sig);
}

const headers = (token: string): Record<string, string> => ({
	Authorization: "Bearer " + token,
	Accept: "application/vnd.github+json",
	"X-GitHub-Api-Version": "2022-11-28",
	"User-Agent": "neo-quiz-bug-relay",
	"Content-Type": "application/json",
});

async function json(res: Response): Promise<Record<string, unknown>> {
	try {
		const v = await res.json();
		if (typeof v === "object" && v !== null) return v as Record<string, unknown>;
	} catch { /* fall through */ }
	throw new UpstreamError("non-JSON answer");
}

export async function installationToken(env: GhEnv, nowSec: number, f: F): Promise<string> {
	const jwt = await appJwt(env, nowSec);
	const res = await f(`${API}/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`, { method: "POST", headers: headers(jwt) });
	if (!res.ok) throw new UpstreamError("installation token " + res.status);
	const t = (await json(res)).token;
	if (typeof t !== "string") throw new UpstreamError("no token");
	return t;
}

/** The login behind a user token; null when GitHub refuses the token. */
export async function getUser(token: string, f: F): Promise<string | null> {
	const res = await f(`${API}/user`, { headers: headers(token) });
	if (res.status === 401) return null;
	if (!res.ok) throw new UpstreamError("user " + res.status);
	const login = (await json(res)).login;
	if (typeof login !== "string") throw new UpstreamError("no login");
	return login;
}

export type Created = { ok: true; url: string; number: number } | { ok: false; status: number };

/** Creates the issue; a missing label (422) is retried without labels. */
export async function createIssue(token: string, issue: { title: string; body: string }, f: F): Promise<Created> {
	const post = (labels: boolean) => f(`${API}/repos/${REPO}/issues`, {
		method: "POST", headers: headers(token), body: JSON.stringify(labels ? { ...issue, labels: LABELS } : issue),
	});
	let res = await post(true);
	if (res.status === 422) res = await post(false);
	if (!res.ok) return { ok: false, status: res.status };
	const j = await json(res);
	if (typeof j.html_url !== "string" || typeof j.number !== "number") throw new UpstreamError("bad issue answer");
	return { ok: true, url: j.html_url, number: j.number };
}
