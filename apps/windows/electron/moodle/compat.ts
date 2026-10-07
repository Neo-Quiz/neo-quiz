/* Is a Moodle site usable by Neo Quiz? (main process only)
 *
 * The Moodle mobile app asks every site, BEFORE any login, for its public
 * configuration: the token-less web service `tool_mobile_get_public_config`
 * (declared `ajax: true, loginrequired: false` in admin/tool/mobile/db/services.php),
 * reached through the no-login AJAX entry point
 *     POST <site>/lib/ajax/service-nologin.php?info=tool_mobile_get_public_config
 *     body [{"index":0,"methodname":"tool_mobile_get_public_config","args":{}}]
 * and answered by `[{"error":false,"data":{...}}]`. Sources:
 *   https://github.com/moodle/moodle/blob/main/public/admin/tool/mobile/db/services.php
 *   https://github.com/moodle/moodle/blob/main/public/admin/tool/mobile/classes/external.php
 *     (get_public_config_returns: sitename, httpswwwroot, enablewebservices,
 *      enablemobilewebservice, typeoflogin = "1 for app, 2 for browser, 3 for
 *      embedded", launchurl = "SSO login launch URL")
 *   https://moodledev.io/docs/apis/subsystems/external (external functions)
 *   https://docs.moodle.org/en/Moodle_app_guide_for_admins (mobile web service,
 *   "Type of login")
 *
 * COMPATIBLE means, and only means:
 *   enablewebservices = 1 AND enablemobilewebservice = 1  (the token and the
 *   mobile service exist), AND typeoflogin is 2 (browser) or 3 (embedded): the
 *   login goes through `admin/tool/mobile/launch.php` (our only flow: the
 *   browser opens it with `urlscheme`, Moodle answers with a token link).
 *   typeoflogin 1 (credentials typed in the app) is NOT supported: we never
 *   ask for a password.
 * One request: https only, 10 s, 64 KB, no cookie sent or kept, redirects only
 * within the same origin (2 hops at most). Nothing else is sent or stored. */

import * as http from "node:http";
import * as https from "node:https";
import { creerLookup, nomHoteInterdit, type Resolveur } from "./adresse";

export type RaisonRefus = "unreachable" | "not-moodle" | "mobile-disabled" | "login-unsupported";
export interface VerdictSite { compatible: boolean; sitename?: string; reason?: RaisonRefus }

export const COMPAT_TIMEOUT = 10000;
export const COMPAT_MAX_BYTES = 64 * 1024;
const MAX_HOPS = 2;
const CHEMIN = "/lib/ajax/service-nologin.php?info=tool_mobile_get_public_config";
const CORPS = JSON.stringify([{ index: 0, methodname: "tool_mobile_get_public_config", args: {} }]);

/** Pure: the verdict from a parsed answer (any value). */
export function decider(json: unknown): VerdictSite {
	const first = Array.isArray(json) ? json[0] : null;
	const data = first && typeof first === "object" && (first as { error?: unknown }).error === false ? (first as { data?: unknown }).data : null;
	if (!data || typeof data !== "object" || Array.isArray(data)) return { compatible: false, reason: "not-moodle" };
	const d = data as Record<string, unknown>;
	if (typeof d.sitename !== "string" || typeof d.typeoflogin !== "number") return { compatible: false, reason: "not-moodle" };
	// eslint-disable-next-line no-control-regex
	const sitename = d.sitename.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 100) || undefined;
	if (Number(d.enablewebservices) !== 1 || Number(d.enablemobilewebservice) !== 1) return { compatible: false, sitename, reason: "mobile-disabled" };
	if (d.typeoflogin !== 2 && d.typeoflogin !== 3) return { compatible: false, sitename, reason: "login-unsupported" };
	return { compatible: true, sitename };
}

export interface OptionsCompat {
	timeoutMs?: number;
	maxBytes?: number;
	/** Tests only (`check:moodle`): the local server speaks `http:`. */
	allowHttpForTests?: boolean;
	/** Tests only: replaces the DNS resolver the connection-time address check uses. */
	resolveur?: Resolveur;
}

/** The origins found compatible during this run: the guarded `moodle` setting
    only accepts a NEW site that is in this set (`canaux.ts`). */
const verifies = new Set<string>();
export const siteVerifie = (origine: string): boolean => verifies.has(origine);

export function verifierSite(origine: string, opts: OptionsCompat = {}): Promise<VerdictSite> {
	const scheme = opts.allowHttpForTests ? "http:" : "https:";
	const lib = opts.allowHttpForTests ? http : https;
	const timeout = opts.timeoutMs ?? COMPAT_TIMEOUT;
	const max = Math.min(opts.maxBytes ?? COMPAT_MAX_BYTES, COMPAT_MAX_BYTES);
	let site: URL;
	try {
		site = new URL(origine);
	} catch {
		return Promise.resolve({ compatible: false, reason: "unreachable" });
	}
	if (site.protocol !== scheme || site.origin !== origine) return Promise.resolve({ compatible: false, reason: "unreachable" });
	// A public name only: no trailing dot, no `localhost`/`.internal`/`.lan` suffix, and (below) no private address.
	if (!opts.allowHttpForTests && nomHoteInterdit(site.hostname)) return Promise.resolve({ compatible: false, reason: "unreachable" });
	const lookup = opts.allowHttpForTests ? undefined : creerLookup(opts.resolveur);
	const fin = (v: VerdictSite): VerdictSite => {
		if (v.compatible) verifies.add(origine);
		return v;
	};
	return new Promise(resolve => {
		let done = false;
		const end = (v: VerdictSite): void => { if (!done) { done = true; clearTimeout(timer); resolve(fin(v)); } };
		let current: http.ClientRequest | null = null;
		const timer = setTimeout(() => { current?.destroy(); end({ compatible: false, reason: "unreachable" }); }, timeout);
		const hop = (url: URL, n: number): void => {
			const req = lib.request(url, {
				method: "POST",
				agent: false,
				// Every hop is resolved here and refused when it lands on a private address (DNS rebinding included).
				lookup,
				timeout,
				headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(CORPS), Accept: "application/json" },
			}, res => {
				const code = res.statusCode ?? 0;
				if (code >= 300 && code < 400 && res.headers.location) {
					res.resume();
					let next: URL;
					try { next = new URL(res.headers.location, url); } catch { return end({ compatible: false, reason: "unreachable" }); }
					if (n >= MAX_HOPS || next.origin !== site.origin || next.username || next.password) return end({ compatible: false, reason: "unreachable" });
					return hop(next, n + 1);
				}
				if (code === 404 || code === 403) { res.resume(); return end({ compatible: false, reason: "not-moodle" }); }
				if (code !== 200) { res.resume(); return end({ compatible: false, reason: "unreachable" }); }
				const chunks: Buffer[] = [];
				let total = 0;
				res.on("data", (c: Buffer) => {
					total += c.length;
					if (total > max) { req.destroy(); end({ compatible: false, reason: "not-moodle" }); }
					else chunks.push(c);
				});
				res.on("error", () => end({ compatible: false, reason: "unreachable" }));
				res.on("end", () => {
					let json: unknown;
					try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return end({ compatible: false, reason: "not-moodle" }); }
					end(decider(json));
				});
			});
			current = req;
			req.on("timeout", () => req.destroy());
			req.on("error", () => end({ compatible: false, reason: "unreachable" }));
			req.end(CORPS);
		};
		hop(new URL(CHEMIN, origine), 0);
	});
}
