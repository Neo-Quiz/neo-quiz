/* The bug report service (main process): builds the final report from what
   the window sends (re-validated, own environment, re-scrubbed log), posts it
   to the relay, and holds the optional GitHub session. The window only ever
   learns a login: the token appears in no return value, log line or message. */

import { LIMITS, scrubLog, validateReport } from "../../../../src/bug-report";
import type { BugReport, BugReportEnv } from "../../../../src/bug-report";
import { hoteAutorise } from "./adresse";
import { appelJson, creerFlux } from "./flux";
import type { Minuteur, Pause, Transport } from "./flux";
import type { MagasinJetonGithub } from "./jeton";

export type ResultatEnvoi = { ok: true; url: string; number: number } | { ok: false; code: string };

export interface ServiceSignalement {
	apercu(): Promise<{ env: BugReportEnv; log: string }>;
	envoyer(brut: unknown): Promise<ResultatEnvoi>;
	github: {
		connecter(): Promise<{ userCode: string; verificationUri: string; expiresIn: number }>;
		attendre(): Promise<{ login: string } | { error: "denied" | "expired" | "cancelled" | "failed" }>;
		annuler(): void;
		etat(): Promise<{ login: string } | null>;
		deconnecter(): Promise<void>;
	};
}

export interface DepsSignalement {
	transport: Transport;
	magasin: MagasinJetonGithub;
	journal: { extrait(): string };
	env: () => BugReportEnv;
	maintenant: () => number;
	relay: string;
	clientId: string;
	pause?: Pause;
	minuteur?: Minuteur;
}

const CODES_RELAIS = new Set(["invalid", "rate_limited", "duplicate", "upstream", "disabled"]);
const ESPACEMENT_MS = 5000;
const UPSTREAM: ResultatEnvoi = { ok: false, code: "upstream" };

export function creerServiceSignalement(deps: DepsSignalement): ServiceSignalement {
	const flux = creerFlux(deps);
	let enCours = false;
	let dernierEnvoi: number | null = null;
	let generation = 0;
	let attente: Promise<{ login: string } | { error: "denied" | "expired" | "cancelled" | "failed" }> | null = null;
	const adresseRapport = deps.relay.replace(/\/+$/, "") + "/report";

	/** One POST to the relay; `token_invalid` is returned as such for the caller to handle. */
	async function poster(rapport: BugReport): Promise<ResultatEnvoi> {
		const corps = JSON.stringify(rapport);
		// The token is added after the 16 KB check on the report itself; leave room for it only.
		if (Buffer.byteLength(corps) > LIMITS.body + 300) return { ok: false, code: "invalid" };
		let j: unknown;
		try {
			j = await appelJson(deps.transport, adresseRapport, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: corps,
			}, deps.relay, { minuteur: deps.minuteur });
		} catch {
			return UPSTREAM;
		}
		if (!j || typeof j !== "object" || Array.isArray(j)) return UPSTREAM;
		const r = j as Record<string, unknown>;
		if (r.ok === true) {
			if (typeof r.url === "string" && hoteAutorise(r.url, deps.relay) && typeof r.number === "number" && Number.isSafeInteger(r.number)) {
				return { ok: true, url: r.url, number: r.number };
			}
			return UPSTREAM;
		}
		if (r.ok === false && typeof r.code === "string" && (r.code === "token_invalid" || CODES_RELAIS.has(r.code))) {
			return { ok: false, code: r.code };
		}
		return UPSTREAM;
	}

	return {
		async apercu() {
			return { env: deps.env(), log: scrubLog(deps.journal.extrait()).slice(0, LIMITS.log) };
		},
		async envoyer(brut) {
			if (enCours) return { ok: false, code: "rate_limited" };
			const v = validateReport(brut);
			if (!v.ok) return { ok: false, code: "invalid" };
			const t = deps.maintenant();
			if (dernierEnvoi !== null && t - dernierEnvoi < ESPACEMENT_MS) return { ok: false, code: "rate_limited" };
			enCours = true;
			dernierEnvoi = t;
			try {
				return await envoyerValide(v.report);
			} finally {
				enCours = false;
			}
		},
		github: {
			connecter: () => flux.demarrer(),
			attendre() {
				attente ??= (async () => {
					const g = generation;
					try {
						const r = await flux.attendre();
						if ("error" in r) return r;
						if (g !== generation) return { error: "cancelled" } as const;
						try {
							await deps.magasin.ecrire({ accessToken: r.accessToken, login: r.login });
						} catch {
							return { error: "failed" } as const;
						}
						if (g !== generation) {
							await deps.magasin.effacer().catch(() => undefined);
							return { error: "cancelled" } as const;
						}
						return { login: r.login };
					} finally {
						attente = null;
					}
				})();
				return attente;
			},
			annuler: () => flux.annuler(),
			async etat() {
				const s = await deps.magasin.lire();
				return s ? { login: s.login } : null;
			},
			async deconnecter() {
				generation++;
				flux.annuler();
				await deps.magasin.effacer().catch(() => undefined);
			},
		},
	};

	async function envoyerValide(report: BugReport): Promise<ResultatEnvoi> {
		// The window supplies neither the token nor the environment.
		const base: BugReport = { ...report, env: deps.env() };
		delete base.githubToken;
		if (base.log !== undefined) base.log = scrubLog(base.log).slice(0, LIMITS.log);
		// Same 16 KB limit for connected and anonymous users: judged before the token is added.
		if (Buffer.byteLength(JSON.stringify(base)) > LIMITS.body) return { ok: false, code: "invalid" };
		const session = await deps.magasin.lire();
		const r = await poster(session ? { ...base, githubToken: session.accessToken } : base);
		if (r.ok || r.code !== "token_invalid") return r;
		// Revoked token: forget the session, retry once anonymously.
		await deps.magasin.effacer().catch(() => undefined);
		const r2 = await poster(base);
		return !r2.ok && r2.code === "token_invalid" ? UPSTREAM : r2;
	}
}
