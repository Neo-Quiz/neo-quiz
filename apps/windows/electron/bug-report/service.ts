/* The bug report service (main process): builds the final report from what
   the window sends (re-validated, own environment, re-scrubbed log), posts it
   to the relay, and holds the optional GitHub session. The window only ever
   learns a login: the token appears in no return value, log line or message. */

import { LIMITS, scrubLog, validateReport } from "../../../../src/bug-report";
import type { BugReport, BugReportEnv } from "../../../../src/bug-report";
import { isAllowedHost } from "./host-rule";
import { callJson, createDeviceFlow } from "./device-flow";
import type { Timer, Pause, Transport } from "./device-flow";
import type { GithubTokenStore } from "./token-store";

export type SendResult = { ok: true; url: string; number: number } | { ok: false; code: string };

export interface BugReportService {
	preview(): Promise<{ env: BugReportEnv; log: string }>;
	send(raw: unknown): Promise<SendResult>;
	github: {
		connect(): Promise<{ userCode: string; verificationUri: string; expiresIn: number }>;
		wait(): Promise<{ login: string } | { error: "denied" | "expired" | "cancelled" | "failed" }>;
		cancel(): void;
		state(): Promise<{ login: string } | null>;
		disconnect(): Promise<void>;
	};
}

export interface BugReportDeps {
	transport: Transport;
	tokenStore: GithubTokenStore;
	log: { excerpt(): string };
	env: () => BugReportEnv;
	now: () => number;
	relay: string;
	clientId: string;
	pause?: Pause;
	timer?: Timer;
}

const RELAY_CODES = new Set(["invalid", "rate_limited", "duplicate", "upstream", "disabled"]);
const SPACING_MS = 5000;
const UPSTREAM: SendResult = { ok: false, code: "upstream" };

export function createBugReportService(deps: BugReportDeps): BugReportService {
	const flow = createDeviceFlow(deps);
	let inProgress = false;
	let lastSend: number | null = null;
	let generation = 0;
	let pending: Promise<{ login: string } | { error: "denied" | "expired" | "cancelled" | "failed" }> | null = null;
	const reportUrl = deps.relay.replace(/\/+$/, "") + "/report";

	/** One POST to the relay; `token_invalid` is returned as such for the caller to handle. */
	async function post(report: BugReport): Promise<SendResult> {
		const body = JSON.stringify(report);
		// The token is added after the 16 KB check on the report itself; leave room for it only.
		if (Buffer.byteLength(body) > LIMITS.body + 300) return { ok: false, code: "invalid" };
		let j: unknown;
		try {
			j = await callJson(deps.transport, reportUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: body,
			}, deps.relay, { timer: deps.timer });
		} catch {
			return UPSTREAM;
		}
		if (!j || typeof j !== "object" || Array.isArray(j)) return UPSTREAM;
		const r = j as Record<string, unknown>;
		if (r.ok === true) {
			if (typeof r.url === "string" && isAllowedHost(r.url, deps.relay) && typeof r.number === "number" && Number.isSafeInteger(r.number)) {
				return { ok: true, url: r.url, number: r.number };
			}
			return UPSTREAM;
		}
		if (r.ok === false && typeof r.code === "string" && (r.code === "token_invalid" || RELAY_CODES.has(r.code))) {
			return { ok: false, code: r.code };
		}
		return UPSTREAM;
	}

	return {
		async preview() {
			return { env: deps.env(), log: scrubLog(deps.log.excerpt()).slice(0, LIMITS.log) };
		},
		async send(raw) {
			if (inProgress) return { ok: false, code: "rate_limited" };
			const v = validateReport(raw);
			if (!v.ok) return { ok: false, code: "invalid" };
			const t = deps.now();
			if (lastSend !== null && t - lastSend < SPACING_MS) return { ok: false, code: "rate_limited" };
			inProgress = true;
			lastSend = t;
			try {
				return await sendValid(v.report);
			} finally {
				inProgress = false;
			}
		},
		github: {
			connect: () => flow.start(),
			wait() {
				pending ??= (async () => {
					const g = generation;
					try {
						const r = await flow.wait();
						if ("error" in r) return r;
						if (g !== generation) return { error: "cancelled" } as const;
						try {
							await deps.tokenStore.write({ accessToken: r.accessToken, login: r.login });
						} catch {
							return { error: "failed" } as const;
						}
						if (g !== generation) {
							await deps.tokenStore.clear().catch(() => undefined);
							return { error: "cancelled" } as const;
						}
						return { login: r.login };
					} finally {
						pending = null;
					}
				})();
				return pending;
			},
			cancel: () => flow.cancel(),
			async state() {
				const s = await deps.tokenStore.read();
				return s ? { login: s.login } : null;
			},
			async disconnect() {
				generation++;
				flow.cancel();
				await deps.tokenStore.clear().catch(() => undefined);
			},
		},
	};

	async function sendValid(report: BugReport): Promise<SendResult> {
		// The window supplies neither the token nor the environment's value: it only
		// says whether to send one (its `env` key present), and main fills it in.
		const base: BugReport = { ...report };
		delete base.githubToken;
		if (report.env !== undefined) base.env = deps.env(); else delete base.env;
		if (base.log !== undefined) base.log = scrubLog(base.log).slice(0, LIMITS.log);
		// Same 16 KB limit for connected and anonymous users: judged before the token is added.
		if (Buffer.byteLength(JSON.stringify(base)) > LIMITS.body) return { ok: false, code: "invalid" };
		const session = await deps.tokenStore.read();
		const r = await post(session ? { ...base, githubToken: session.accessToken } : base);
		if (r.ok || r.code !== "token_invalid") return r;
		// Revoked token: forget the session, retry once anonymously.
		await deps.tokenStore.clear().catch(() => undefined);
		const r2 = await post(base);
		return !r2.ok && r2.code === "token_invalid" ? UPSTREAM : r2;
	}
}
