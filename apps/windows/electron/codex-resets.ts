/* ══════════════════════════════════════════════════════════
   CODEX BANKED RESETS, main-process side.

   Launches `codex app-server` (JSON-RPC, one JSON per line, on stdio), runs
   `initialize` (with `experimentalApi`) then `initialized`, then calls ONE
   method: `account/rateLimits/read` (the limits and the banked reset
   credits) or `account/rateLimitResetCredit/consume`. The process tree is
   killed on EVERY outcome; probes go through a queue, one at a time; 15 s in
   all, 12 s per request.

   WHAT THE WINDOW CAN DO (the window is assumed compromised, see `pont.ts`):
   it names an action (`read` or `consume`) and, for `consume`, a credit id.
   The id is short, shaped like an id, AND present in the LAST read this
   process made: the window cannot spend a credit it was not shown. Nothing
   else crosses: no method name, no params, no path, no argument. The
   executable is resolved from its NAME on the PATH like every other Codex
   launch, and its arguments are the exact form of `gabarits-cli.ts`. This
   module never reads nor writes `auth.json`: Codex uses its own sign-in.
   Never call `consume` on a real account from a test: `check:electron-process`
   runs a FAKE app-server.
══════════════════════════════════════════════════════════ */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { LOG_PREFIX } from "../../../src/branding";
import { ligneCmd } from "../../../src/host/cli-args";
import { parseConsumeOutcome, parseResetCredits, readResetsRequest, spendable } from "../../../src/dashboard/codex-resets";
import type { ResetsError, ResetsResult } from "../../../src/dashboard/codex-resets";
import { ARGS_CODEX_APP_SERVER, argumentsAppServer } from "./gabarits-cli";
import { dossierPersonnel, environnementEnfant, resoudreExecutable, tuerArbre } from "./process";

export const DELAI_TOTAL_MS = 15000;
export const DELAI_REQUETE_MS = 12000;
/** More buffered output than this without a newline is not Codex: dropped. */
const LIGNE_MAX = 4 * 1024 * 1024;

export interface DepsResets {
	/** How to start the app-server: the default resolves `codex` on the PATH.
	    A check passes a fake (a script that speaks JSON-RPC). */
	lancement?: (args: readonly string[]) => { executable: string; args: string[] } | null;
	env?: NodeJS.ProcessEnv;
	delaiTotalMs?: number;
	delaiRequeteMs?: number;
	tuer?: (pid: number | undefined) => Promise<void>;
}

class ErreurResets extends Error {
	constructor(readonly code: ResetsError, message: string) { super(message); }
}

/** The ids of the credits the LAST read showed; a consume must name one. */
let idsVus = new Set<string>();
export function oublierLectures(): void { idsVus = new Set(); }

let file: Promise<unknown> = Promise.resolve();

/** One probe at a time: they all start the same program. */
function enfiler<T>(travail: () => Promise<T>): Promise<T> {
	const suite = file.then(travail, travail);
	file = suite.catch(() => undefined);
	return suite;
}

function lancementParDefaut(env: NodeJS.ProcessEnv) {
	return (args: readonly string[]): { executable: string; args: string[] } | null => {
		const executable = resoudreExecutable("codex", env);
		return executable ? { executable, args: [...args] } : null;
	};
}

/** Classifies a JSON-RPC error message from the server. */
export function classerErreurServeur(message: string): ResetsError {
	const m = message.toLowerCase();
	if (m.includes("authentication required") || m.includes("not logged in") || m.includes("sign in") || m.includes("unauthorized")) return "not-signed-in";
	return "unavailable";
}

/** Runs `initialize`, `initialized`, then ONE method; kills the tree at the end. */
async function appeler(methode: "account/rateLimits/read" | "account/rateLimitResetCredit/consume", params: unknown, deps: DepsResets): Promise<unknown> {
	const env = deps.env ?? process.env;
	const total = deps.delaiTotalMs ?? DELAI_TOTAL_MS;
	const parRequete = deps.delaiRequeteMs ?? DELAI_REQUETE_MS;
	const tuer = deps.tuer ?? tuerArbre;
	// The launch is the one form the template allows, and nothing else.
	if (!argumentsAppServer("codex", ARGS_CODEX_APP_SERVER)) throw new ErreurResets("refused", "app-server form refused");
	const cible = (deps.lancement ?? lancementParDefaut(env))(ARGS_CODEX_APP_SERVER);
	if (!cible) throw new ErreurResets("not-installed", "codex not found");

	const options = { env: environnementEnfant(env), cwd: dossierPersonnel(env), windowsHide: true, stdio: ["pipe", "pipe", "ignore"] as ["pipe", "pipe", "ignore"], detached: process.platform !== "win32" };
	let enfant: ChildProcess;
	const parCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(cible.executable) && existsSync(cible.executable);
	try {
		enfant = parCmd
			? spawn(env.ComSpec || "cmd.exe", ["/d", "/s", "/c", ligneCmd(cible.executable, cible.args)], Object.assign({ windowsVerbatimArguments: true }, options))
			: spawn(cible.executable, cible.args, options);
	} catch {
		throw new ErreurResets("not-installed", "codex could not start");
	}

	const attentes = new Map<number, { ok: (v: unknown) => void; ko: (e: Error) => void }>();
	let tampon = "";
	let mort: Error | null = null;
	const echouerTout = (e: Error): void => {
		mort = mort ?? e;
		for (const a of attentes.values()) a.ko(e);
		attentes.clear();
	};
	const envoyer = (obj: object): void => {
		try { enfant.stdin?.write(JSON.stringify(obj) + "\n"); } catch { /* the close event settles */ }
	};
	const surLigne = (ligne: string): void => {
		let msg: unknown;
		try { msg = JSON.parse(ligne); } catch { return; }
		if (typeof msg !== "object" || msg === null) return;
		const m = msg as { id?: unknown; method?: unknown; result?: unknown; error?: { message?: unknown } };
		if (typeof m.id === "number" && typeof m.method !== "string") {
			const a = attentes.get(m.id);
			if (!a) return;
			attentes.delete(m.id);
			if (m.error) a.ko(new ErreurResets(classerErreurServeur(String(m.error.message ?? "")), String(m.error.message ?? "error")));
			else a.ok(m.result);
		} else if (m.id !== undefined && typeof m.method === "string") {
			// A request from the server (an approval, an elicitation...): refused, never granted.
			envoyer({ id: m.id, error: { code: -32601, message: "Method not found" } });
		}
	};
	enfant.stdout?.on("data", (d: unknown) => {
		tampon += String(d);
		if (tampon.length > LIGNE_MAX) { echouerTout(new ErreurResets("unavailable", "response too long")); return; }
		let i: number;
		while ((i = tampon.indexOf("\n")) >= 0) {
			const ligne = tampon.slice(0, i).trim();
			tampon = tampon.slice(i + 1);
			if (ligne) surLigne(ligne);
		}
	});
	enfant.stdin?.on("error", () => { /* close settles */ });
	enfant.on("error", (e: NodeJS.ErrnoException) => echouerTout(new ErreurResets(e.code === "ENOENT" ? "not-installed" : "unavailable", e.message)));
	enfant.on("close", () => echouerTout(new ErreurResets("unavailable", "app-server exited")));

	let prochain = 1;
	const requete = (nom: string, parametres: unknown): Promise<unknown> => new Promise((ok, ko) => {
		if (mort) { ko(mort); return; }
		const id = prochain++;
		const minuteur = setTimeout(() => { attentes.delete(id); ko(new ErreurResets("timeout", nom + " timed out")); }, parRequete);
		attentes.set(id, { ok: v => { clearTimeout(minuteur); ok(v); }, ko: e => { clearTimeout(minuteur); ko(e); } });
		envoyer({ id, method: nom, params: parametres });
	});

	let delai: ReturnType<typeof setTimeout> | undefined;
	try {
		const travail = (async () => {
			await requete("initialize", { clientInfo: { name: "neo-quiz", title: "Neo Quiz", version: "1.0.0" }, capabilities: { experimentalApi: true } });
			envoyer({ method: "initialized" });
			return requete(methode, params);
		})();
		// An overall timeout leaves `travail` pending: its rejection is taken.
		travail.catch(() => undefined);
		return await Promise.race([
			travail,
			new Promise<never>((_, ko) => { delai = setTimeout(() => ko(new ErreurResets("timeout", "app-server probe timed out")), total); }),
		]);
	} finally {
		if (delai) clearTimeout(delai);
		echouerTout(new ErreurResets("unavailable", "closed"));
		// The whole tree, on every outcome; awaited so a probe never overlaps the next.
		await tuer(enfant.pid);
	}
}

function enResultat(e: unknown): ResetsResult {
	if (e instanceof ErreurResets) return { ok: false, error: e.code };
	console.warn(LOG_PREFIX, "codex resets failed:", e instanceof Error ? e.message : e);
	return { ok: false, error: "unavailable" };
}

/** The channel's entry: `raw` comes from the window and is judged here. */
export function codexResets(raw: unknown, deps: DepsResets = {}): Promise<ResetsResult> {
	const req = readResetsRequest(raw);
	if (!req) return Promise.resolve({ ok: false, error: "refused" });
	if (req.action === "consume" && !idsVus.has(req.creditId)) return Promise.resolve({ ok: false, error: "unknown-credit" });
	return enfiler(async (): Promise<ResetsResult> => {
		try {
			if (req.action === "read") {
				const resultat = await appeler("account/rateLimits/read", {}, deps);
				// A Codex without the banked-reset fields has none to show.
				const resets = parseResetCredits(resultat) ?? { availableCount: 0, credits: [] };
				idsVus = new Set(spendable(resets).map(c => c.id));
				return { ok: true, action: "read", resets };
			}
			// Re-checked inside the queue: an earlier probe may have used it.
			if (!idsVus.has(req.creditId)) return { ok: false, error: "unknown-credit" };
			const resultat = await appeler("account/rateLimitResetCredit/consume", { idempotencyKey: randomUUID(), creditId: req.creditId }, deps);
			const outcome = parseConsumeOutcome(resultat);
			if (!outcome) return { ok: false, error: "unavailable" };
			// Spent, or known to be unusable: a new read must show it again.
			idsVus.delete(req.creditId);
			return { ok: true, action: "consume", outcome };
		} catch (e) {
			return enResultat(e);
		}
	});
}
