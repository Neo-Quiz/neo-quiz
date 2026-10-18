/* GitHub device flow for the bug report (main process), plus the one HTTP
   helper every bug report request goes through: allowed hosts only, redirects
   never followed, 15 s timeout, body capped at 64 KB. The flow uses the
   Client ID only (no secret) and runs one at a time. */

import { hoteAutorise } from "./adresse";

export type Transport = (url: string, init: RequestInit) => Promise<Response>;
/** Calls `fn` after `ms`; returns a function that cancels it. Injected by tests. */
export type Minuteur = (ms: number, fn: () => void) => () => void;
export type Pause = (ms: number, signal: AbortSignal) => Promise<void>;

export const DELAI_MS = 15_000;
export const CORPS_MAX = 64 * 1024;

export const minuteurReel: Minuteur = (ms, fn) => {
	const t = setTimeout(fn, ms);
	return () => clearTimeout(t);
};
export const pauseReelle: Pause = (ms, signal) => new Promise(resolve => {
	if (signal.aborted) { resolve(); return; }
	const fin = (): void => { clearTimeout(t); signal.removeEventListener("abort", fin); resolve(); };
	const t = setTimeout(fin, ms);
	signal.addEventListener("abort", fin);
});

async function lireCorps(res: Response): Promise<string> {
	if (!res.body) return "";
	const lecteur = res.body.getReader();
	const morceaux: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await lecteur.read();
		if (done) break;
		total += value.byteLength;
		if (total > CORPS_MAX) {
			await lecteur.cancel().catch(() => undefined);
			throw new Error("answer too large");
		}
		morceaux.push(value);
	}
	return Buffer.concat(morceaux).toString("utf8");
}

/** One request; resolves with the parsed JSON, throws on anything else (a 3xx
    included). The status is NOT judged: the JSON shape is. */
export async function appelJson(
	transport: Transport, url: string, init: RequestInit, relay: string,
	opts: { minuteur?: Minuteur; signal?: AbortSignal } = {},
): Promise<unknown> {
	if (!hoteAutorise(url, relay)) throw new Error("host refused");
	const ac = new AbortController();
	const stop = (opts.minuteur ?? minuteurReel)(DELAI_MS, () => ac.abort());
	const relais = (): void => ac.abort();
	opts.signal?.addEventListener("abort", relais);
	if (opts.signal?.aborted) ac.abort();
	try {
		const res = await transport(url, { ...init, redirect: "manual", signal: ac.signal });
		if ((res.status >= 300 && res.status < 400) || res.type === "opaqueredirect") throw new Error("redirect refused");
		return JSON.parse(await lireCorps(res)) as unknown;
	} finally {
		stop();
		opts.signal?.removeEventListener("abort", relais);
	}
}

export interface DepsFlux {
	transport: Transport;
	clientId: string;
	relay: string;
	maintenant: () => number;
	pause?: Pause;
	minuteur?: Minuteur;
}
export type ResultatFlux =
	| { accessToken: string; login: string }
	| { error: "denied" | "expired" | "cancelled" | "failed" };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);
const ENTETES = { Accept: "application/json", "User-Agent": "Neo-Quiz" };

export interface Flux {
	/** Starts a flow. Rejects `busy` when one runs, `refused` for a foreign verification host. */
	demarrer(): Promise<{ userCode: string; verificationUri: string; expiresIn: number }>;
	attendre(): Promise<ResultatFlux>;
	annuler(): void;
}

export function creerFlux(deps: DepsFlux): Flux {
	const pause = deps.pause ?? pauseReelle;
	let demarrage = false;
	let actif: { deviceCode: string; intervalle: number; limite: number; ac: AbortController } | null = null;
	const appel = (url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> =>
		appelJson(deps.transport, url, init, deps.relay, { minuteur: deps.minuteur, signal });

	return {
		async demarrer() {
			if (demarrage || actif) throw new Error("busy");
			demarrage = true;
			try {
				const j = obj(await appel("https://github.com/login/device/code", {
					method: "POST",
					headers: { ...ENTETES, "Content-Type": "application/json" },
					body: JSON.stringify({ client_id: deps.clientId }),
				}));
				if (!j || typeof j.device_code !== "string" || typeof j.user_code !== "string"
					|| typeof j.verification_uri !== "string" || typeof j.expires_in !== "number" || !(j.expires_in > 0)) {
					throw new Error("failed");
				}
				if (j.user_code.length > 32 || !hoteAutorise(j.verification_uri, deps.relay)) throw new Error("refused");
				const intervalle = typeof j.interval === "number" && j.interval >= 1 ? j.interval : 5;
				actif = { deviceCode: j.device_code, intervalle: intervalle * 1000, limite: deps.maintenant() + j.expires_in * 1000, ac: new AbortController() };
				return { userCode: j.user_code, verificationUri: j.verification_uri, expiresIn: j.expires_in };
			} finally {
				demarrage = false;
			}
		},
		async attendre() {
			const f = actif;
			if (!f) return { error: "failed" };
			try {
				for (;;) {
					await pause(f.intervalle, f.ac.signal);
					if (f.ac.signal.aborted) return { error: "cancelled" };
					if (deps.maintenant() >= f.limite) return { error: "expired" };
					let j: Record<string, unknown> | null;
					try {
						j = obj(await appel("https://github.com/login/oauth/access_token", {
							method: "POST",
							headers: { ...ENTETES, "Content-Type": "application/json" },
							body: JSON.stringify({
								client_id: deps.clientId, device_code: f.deviceCode,
								grant_type: "urn:ietf:params:oauth:grant-type:device_code",
							}),
						}, f.ac.signal));
					} catch {
						return { error: f.ac.signal.aborted ? "cancelled" : "failed" };
					}
					if (!j) return { error: "failed" };
					if (typeof j.access_token === "string" && j.access_token !== "" && j.access_token.length <= 255) {
						const accessToken = j.access_token;
						try {
							const u = obj(await appel("https://api.github.com/user", {
								headers: { ...ENTETES, Authorization: "Bearer " + accessToken },
							}, f.ac.signal));
							if (!u || typeof u.login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(u.login)) return { error: "failed" };
							return { accessToken, login: u.login };
						} catch {
							return { error: f.ac.signal.aborted ? "cancelled" : "failed" };
						}
					}
					if (j.error === "authorization_pending") continue;
					if (j.error === "slow_down") { f.intervalle += 5000; continue; }
					if (j.error === "expired_token") return { error: "expired" };
					if (j.error === "access_denied") return { error: "denied" };
					return { error: "failed" };
				}
			} finally {
				if (actif === f) actif = null;
			}
		},
		annuler() {
			const f = actif;
			actif = null;
			f?.ac.abort();
		},
	};
}
