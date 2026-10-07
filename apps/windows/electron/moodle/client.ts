/* The Moodle network client (main process only). Every request, and every
   redirect hop, goes to EXACTLY the configured site's origin over https: a
   file URL on another host is skipped by the caller (`memeSite`), and a
   redirect to another host is never followed. The token travels in the POST
   body of API calls and as `?token=` on file downloads, never in a message. */

import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import { pipeline, Transform } from "node:stream";
import { MoodleError, TokenError, masquer } from "./erreurs";
import { limiter } from "./pur";

export const API_CONCURRENCY = 16;
export const API_TIMEOUT = 30000;      // ms per API call
export const IDLE_TIMEOUT = 60000;     // ms without data before a download is dropped
export const MAX_REDIRECTS = 3;
const MAX_API_BYTES = 32 * 1024 * 1024;
/** Hard cap on one file, whatever the server announces. */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
export const API_DEADLINE = 120000;     // ms in total per API call
export const FILE_DEADLINE = 600000;    // ms in total per file download

export interface OptionsClient {
	apiTimeout?: number;
	idleTimeout?: number;
	apiDeadline?: number;
	fileDeadline?: number;
	/** Tests only: a lower per-file cap (never above MAX_FILE_BYTES). */
	maxFileBytes?: number;
	/** Tests only (`check:moodle`): the local server speaks `http:`. The app
	    never sets it; `check:moodle` greps the app's own files for it. */
	allowHttpForTests?: boolean;
}

export interface Client {
	readonly origin: string;
	call(fn: string, params?: Record<string, string | number>): Promise<any>;
	/** Whether `url` is on the site's own origin (scheme, host and port). */
	memeSite(url: string): boolean;
	/** Downloads `url` (with the token appended) into `tmp`. */
	fetchToFile(url: string, tmp: string, expected: number | null): Promise<void>;
	close(): void;
}

function toError(json: { errorcode?: string; message?: string }): MoodleError {
	const code = json.errorcode || "moodle";
	const message = json.message || code;
	// An expired token: "accessexception" (Invalid token - token expired) at the
	// first call, then "invalidtoken", Moodle having deleted it meanwhile.
	if (code === "invalidtoken" || (code === "accessexception" && /token/i.test(message))) return new TokenError(code, message);
	return new MoodleError(code, message);
}

export function createClient(token: string, origin: string, opts: OptionsClient = {}): Client {
	const scheme = opts.allowHttpForTests ? "http:" : "https:";
	const site = new URL(origin);
	if (site.protocol !== scheme || site.origin !== origin) throw new MoodleError("badsite", "The site must be a plain " + scheme + " origin.");
	const apiTimeout = opts.apiTimeout ?? API_TIMEOUT;
	const idleTimeout = opts.idleTimeout ?? IDLE_TIMEOUT;
	const apiDeadline = opts.apiDeadline ?? API_DEADLINE;
	const fileDeadline = opts.fileDeadline ?? FILE_DEADLINE;
	const maxFile = Math.min(opts.maxFileBytes ?? MAX_FILE_BYTES, MAX_FILE_BYTES);
	const lib = scheme === "http:" ? http : https;
	const agent = new lib.Agent({ keepAlive: true, maxSockets: API_CONCURRENCY });
	const limit = limiter(API_CONCURRENCY);

	const memeSite = (url: string): boolean => {
		try {
			const u = new URL(url);
			return u.protocol === scheme && u.host === site.host && !u.username && !u.password;
		} catch {
			return false;
		}
	};
	const refuseHote = (): MoodleError => new MoodleError("offhost", "Refused: the address is not on the Moodle site.");

	function call(fn: string, params: Record<string, string | number> = {}): Promise<any> {
		return limit(() => new Promise((resolve, reject) => {
			const body = new URLSearchParams({ wstoken: token, moodlewsrestformat: "json", wsfunction: fn });
			for (const [k, v] of Object.entries(params)) body.append(k, String(v));
			const data = body.toString();
			const req = lib.request(new URL("/webservice/rest/server.php", origin), {
				agent,
				method: "POST",
				timeout: apiTimeout,
				headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(data) },
			}, res => {
				const chunks: Buffer[] = [];
				let total = 0;
				res.on("data", (c: Buffer) => {
					total += c.length;
					if (total > MAX_API_BYTES) req.destroy(new MoodleError("toolarge", "Moodle answer too large."));
					else chunks.push(c);
				});
				res.on("error", reject);
				res.on("end", () => {
					let json: any;
					try {
						json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
					} catch {
						reject(new MoodleError("badjson", `Unreadable answer from Moodle (HTTP ${res.statusCode}).`));
						return;
					}
					if (json && json.exception) reject(toError(json));
					else resolve(json);
				});
			});
			// An overall deadline too: a server dripping bytes must not hold the call forever.
			const deadline = setTimeout(() => req.destroy(new MoodleError("timeout", "Moodle took too long to answer.")), apiDeadline);
			req.on("close", () => clearTimeout(deadline));
			req.on("timeout", () => req.destroy(new MoodleError("timeout", "Moodle does not answer (30 s).")));
			req.on("error", e => reject(e instanceof MoodleError ? e : new MoodleError((e as NodeJS.ErrnoException).code || "network", masquer(e.message, token))));
			req.end(data);
		}));
	}

	function fetchHop(url: string, tmp: string, expected: number | null, redirects: number): Promise<void> {
		return new Promise((resolve, reject) => {
			// EVERY hop, the first one included, must be on the site's origin.
			if (!memeSite(url)) { reject(refuseHote()); return; }
			const req = lib.request(new URL(url), { agent, method: "GET", timeout: idleTimeout }, res => {
				const location = res.headers.location;
				if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location && redirects < MAX_REDIRECTS) {
					res.resume();
					let next: string;
					try { next = new URL(location, url).href; } catch { reject(new MoodleError("refused", "Moodle sent an invalid redirect.")); return; }
					fetchHop(next, tmp, expected, redirects + 1).then(resolve, reject);
					return;
				}
				// A Moodle error (token refused...) arrives as JSON instead of the file.
				if (res.statusCode !== 200 || /json/i.test(String(res.headers["content-type"] || ""))) {
					res.resume();
					reject(new MoodleError("refused", `Moodle refused the file (HTTP ${res.statusCode}).`));
					return;
				}
				// Never more than announced (or the hard cap): a server cannot fill the disk.
				const maxBytes = Math.min(expected ?? maxFile, maxFile);
				let seen = 0;
				const cap = new Transform({
					transform(chunk: Buffer, _enc, cb) {
						seen += chunk.length;
						cb(seen > maxBytes ? new MoodleError("incomplete", "The file is larger than announced.") : null, chunk);
					},
				});
				pipeline(res, cap, fs.createWriteStream(tmp, { flags: "wx" }), err => (err ? reject(err) : resolve()));
			});
			const deadline = setTimeout(() => req.destroy(new MoodleError("timeout", "Download took too long.")), fileDeadline);
			req.on("close", () => clearTimeout(deadline));
			req.on("timeout", () => req.destroy(new MoodleError("timeout", "Download interrupted: no data for 60 s.")));
			req.on("error", e => reject(e instanceof MoodleError ? e : new MoodleError((e as NodeJS.ErrnoException).code || "network", masquer(e.message, token))));
			req.end();
		});
	}

	return {
		origin,
		call,
		memeSite,
		fetchToFile(url, tmp, expected) {
			if (!memeSite(url)) return Promise.reject(refuseHote());
			const u = new URL(url);
			u.searchParams.set("token", token);
			return fetchHop(u.href, tmp, expected, 0);
		},
		close() { agent.destroy(); },
	};
}

export async function siteInfo(client: Client): Promise<{ userid: number; fullname: string }> {
	const r = await client.call("core_webservice_get_site_info");
	const userid = Number(r && r.userid);
	if (!Number.isSafeInteger(userid) || userid <= 0) throw new MoodleError("badjson", "Unexpected site information.");
	return { userid, fullname: String(r.fullname ?? "") };
}
