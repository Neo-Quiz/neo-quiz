import { validateReport, buildIssue } from "../../../src/bug-report";
import { installationToken, createIssue, getUser, type KVLike, type GhEnv, type Created } from "./github";
import { admitIp, globalFull, globalBump, sha256Hex, isDuplicate, markDuplicate, MAX_BODY_BYTES } from "./limits";

export type { KVLike };
export interface Env extends GhEnv { RELAY_ENABLED?: string; STATE: KVLike }
export interface Deps { fetch?: typeof fetch; now?: () => number }

const STATUS = { invalid: 400, rate_limited: 429, duplicate: 409, upstream: 502, token_invalid: 401, disabled: 503 } as const;
type Code = keyof typeof STATUS;

const reply = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fail = (code: Code): Response => reply({ ok: false, code }, STATUS[code]);

/** Reads at most MAX_BODY_BYTES + 1 bytes; null when the body is over the limit. */
async function readBody(req: Request): Promise<string | null> {
	if (!req.body) return "";
	const reader = req.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (total <= MAX_BODY_BYTES) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		chunks.push(value);
	}
	if (total > MAX_BODY_BYTES) { await reader.cancel().catch(() => {}); return null; }
	const all = new Uint8Array(total);
	let o = 0;
	for (const c of chunks) { all.set(c, o); o += c.length; }
	return new TextDecoder("utf-8", { fatal: true }).decode(all);
}

export async function handle(req: Request, env: Env, deps: Deps = {}): Promise<Response> {
	const f = deps.fetch ?? fetch;
	const now = (deps.now ?? Date.now)();
	const path = new URL(req.url).pathname;
	if (path === "/health") return req.method === "GET" ? reply({ ok: true }) : reply({ ok: false }, 405);
	if (path !== "/report") return reply({ ok: false }, 404);
	if (env.RELAY_ENABLED === "false") return fail("disabled");
	if (req.method !== "POST") return reply({ ok: false, code: "invalid" }, 405);
	if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return fail("invalid");

	let raw: unknown;
	try {
		const text = await readBody(req);
		if (text === null) return fail("invalid");
		raw = JSON.parse(text);
	} catch { return fail("invalid"); }
	const v = validateReport(raw);
	if (!v.ok) return fail("invalid");
	const report = v.report;

	const kv = env.STATE;
	const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
	if (!(await admitIp(kv, ip, now))) return fail("rate_limited");
	// The token is not part of the identity of a report.
	const { githubToken, ...rest } = report;
	const hash = await sha256Hex(JSON.stringify(rest));
	if (await isDuplicate(kv, hash)) return fail("duplicate");
	if (await globalFull(kv, now)) return fail("rate_limited");

	try {
		let created: Created | undefined;
		let login: string | null = null;
		if (githubToken) {
			login = await getUser(githubToken, f);
			if (login === null) return fail("token_invalid");
			created = await createIssue(githubToken, buildIssue(report), f);
			// The reporter cannot write to the repo: fall back to the App, crediting them.
			if (!created.ok && (created.status === 403 || created.status === 404)) created = undefined;
		}
		if (!created) {
			const inst = await installationToken(env, Math.floor(now / 1000), f);
			created = await createIssue(inst, buildIssue(report, login ? { reportedBy: login } : undefined), f);
		}
		if (!created.ok) return fail("upstream");
		await markDuplicate(kv, hash);
		await globalBump(kv, now);
		return reply({ ok: true, url: created.url, number: created.number });
	} catch {
		return fail("upstream");
	}
}

export default { fetch: (req: Request, env: Env) => handle(req, env) };
