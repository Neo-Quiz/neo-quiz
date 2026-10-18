/* GitHub device flow for the bug report (main process), plus the one HTTP
   helper every bug report request goes through: allowed hosts only, redirects
   never followed, 15 s timeout, body capped at 64 KB. The flow uses the
   Client ID only (no secret) and runs one at a time. */

import { isAllowedHost } from "./host-rule";

export type Transport = (url: string, init: RequestInit) => Promise<Response>;
/** Calls `fn` after `ms`; returns a function that cancels it. Injected by tests. */
export type Timer = (ms: number, fn: () => void) => () => void;
export type Pause = (ms: number, signal: AbortSignal) => Promise<void>;

export const TIMEOUT_MS = 15_000;
export const BODY_MAX = 64 * 1024;

export const realTimer: Timer = (ms, fn) => {
	const t = setTimeout(fn, ms);
	return () => clearTimeout(t);
};
export const realPause: Pause = (ms, signal) => new Promise(resolve => {
	if (signal.aborted) { resolve(); return; }
	const finish = (): void => { clearTimeout(t); signal.removeEventListener("abort", finish); resolve(); };
	const t = setTimeout(finish, ms);
	signal.addEventListener("abort", finish);
});

async function readBody(res: Response): Promise<string> {
	if (!res.body) return "";
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > BODY_MAX) {
			await reader.cancel().catch(() => undefined);
			throw new Error("answer too large");
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString("utf8");
}

/** One request; resolves with the parsed JSON, throws on anything else (a 3xx
    included). The status is NOT judged: the JSON shape is. */
export async function callJson(
	transport: Transport, url: string, init: RequestInit, relay: string,
	opts: { timer?: Timer; signal?: AbortSignal } = {},
): Promise<unknown> {
	if (!isAllowedHost(url, relay)) throw new Error("host refused");
	const ac = new AbortController();
	const stop = (opts.timer ?? realTimer)(TIMEOUT_MS, () => ac.abort());
	const forward = (): void => ac.abort();
	opts.signal?.addEventListener("abort", forward);
	if (opts.signal?.aborted) ac.abort();
	try {
		const res = await transport(url, { ...init, redirect: "manual", signal: ac.signal });
		if ((res.status >= 300 && res.status < 400) || res.type === "opaqueredirect") throw new Error("redirect refused");
		return JSON.parse(await readBody(res)) as unknown;
	} finally {
		stop();
		opts.signal?.removeEventListener("abort", forward);
	}
}

export interface DeviceFlowDeps {
	transport: Transport;
	clientId: string;
	relay: string;
	now: () => number;
	pause?: Pause;
	timer?: Timer;
}
export type DeviceFlowResult =
	| { accessToken: string; login: string }
	| { error: "denied" | "expired" | "cancelled" | "failed" };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);
const HEADERS = { Accept: "application/json", "User-Agent": "Neo-Quiz" };

export interface DeviceFlow {
	/** Starts a flow. Rejects `busy` when one runs, `refused` for a foreign verification host. */
	start(): Promise<{ userCode: string; verificationUri: string; expiresIn: number }>;
	wait(): Promise<DeviceFlowResult>;
	cancel(): void;
}

export function createDeviceFlow(deps: DeviceFlowDeps): DeviceFlow {
	const pause = deps.pause ?? realPause;
	let starting = false;
	let active: { deviceCode: string; interval: number; deadline: number; ac: AbortController; promise?: Promise<DeviceFlowResult> } | null = null;
	const appel = (url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> =>
		callJson(deps.transport, url, init, deps.relay, { timer: deps.timer, signal });

	return {
		async start() {
			// A flow left behind (page reloaded, never awaited) is free once past its expiry.
			if (active && deps.now() >= active.deadline) { active.ac.abort(); active = null; }
			if (starting || active) throw new Error("busy");
			starting = true;
			try {
				const j = obj(await appel("https://github.com/login/device/code", {
					method: "POST",
					headers: { ...HEADERS, "Content-Type": "application/json" },
					body: JSON.stringify({ client_id: deps.clientId }),
				}));
				if (!j || typeof j.device_code !== "string" || typeof j.user_code !== "string"
					|| typeof j.verification_uri !== "string" || typeof j.expires_in !== "number" || !(j.expires_in > 0)) {
					throw new Error("failed");
				}
				if (j.user_code.length > 32 || !isAllowedHost(j.verification_uri, deps.relay)) throw new Error("refused");
				const interval = typeof j.interval === "number" && j.interval >= 1 ? j.interval : 5;
				active = { deviceCode: j.device_code, interval: interval * 1000, deadline: deps.now() + j.expires_in * 1000, ac: new AbortController() };
				return { userCode: j.user_code, verificationUri: j.verification_uri, expiresIn: j.expires_in };
			} finally {
				starting = false;
			}
		},
		wait() {
			const f = active;
			if (!f) return Promise.resolve({ error: "failed" });
			// Single flight: later callers share the one poll.
			f.promise ??= poll(f);
			return f.promise;
		},
		cancel() {
			const f = active;
			active = null;
			f?.ac.abort();
		},
	};

	async function poll(f: NonNullable<typeof active>): Promise<DeviceFlowResult> {
			try {
				for (;;) {
					await pause(f.interval, f.ac.signal);
					if (f.ac.signal.aborted) return { error: "cancelled" };
					if (deps.now() >= f.deadline) return { error: "expired" };
					let j: Record<string, unknown> | null;
					try {
						j = obj(await appel("https://github.com/login/oauth/access_token", {
							method: "POST",
							headers: { ...HEADERS, "Content-Type": "application/json" },
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
								headers: { ...HEADERS, Authorization: "Bearer " + accessToken },
							}, f.ac.signal));
							if (!u || typeof u.login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(u.login)) return { error: "failed" };
							return { accessToken, login: u.login };
						} catch {
							return { error: f.ac.signal.aborted ? "cancelled" : "failed" };
						}
					}
					if (j.error === "authorization_pending") continue;
					if (j.error === "slow_down") { f.interval += 5000; continue; }
					if (j.error === "expired_token") return { error: "expired" };
					if (j.error === "access_denied") return { error: "denied" };
					return { error: "failed" };
				}
			} finally {
				if (active === f) active = null;
			}
	}
}
