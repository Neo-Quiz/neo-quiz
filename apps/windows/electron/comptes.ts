import { readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOG_PREFIX } from "../../../src/branding";
import type { EtatCompte } from "../../../src/host/types";
import type { UsageRead } from "../../../src/dashboard/usage-format";
import { comptClaude, comptCodex, emailAntigravityDepuisJournal, usageAntigravityDepuisModeles, usageAntigravityDepuisResume, usageClaudeDepuisReponse, usageCodexDepuisLigne, usageOllamaDepuisCache, usageOllamaDepuisPage } from "./comptes-pur";
import type { OutilCompte } from "./comptes-pur";
import { ARGS_COMPTE } from "./gabarits-cli";
import { dossierPersonnel, environnementEnfant, lancer, resoudreExecutable } from "./process";

/* ══════════════════════════════════════════════════════════
   COMPTES IA — la lecture. Le SEUL endroit qui ouvre les fichiers de jetons.

   PAS `run()` DU MÊME MODULE, ET C'EST DÉLIBÉRÉ : `run` prend un verrou par
   outil (`process.ts`) et attend jusqu'à un quart de minute derrière une
   génération en cours. Le survol d'une ligne de compte serait alors muet
   pendant toute génération. Ces lectures n'écrivent rien et ne concurrencent
   rien : elles passent par `lancer`, sans verrou, avec un délai court.
══════════════════════════════════════════════════════════ */

/** Au-delà, la lecture est abandonnée : un écran de réglages n'attend pas. */
const DELAI_MS = 5000;

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA = "oauth-2025-04-20";

/** L'état vide : ni installé ni connecté, aucune donnée. Toute lecture qui
    échoue y retombe — jamais une exception qui emporterait les deux autres
    comptes lus en parallèle. */
function etatVide(outil: EtatCompte["outil"]): EtatCompte {
	return { outil, installe: false, connecte: false, email: null, plan: null };
}

async function etatClaude(env: NodeJS.ProcessEnv): Promise<EtatCompte> {
	const executable = resoudreExecutable("claude", env);
	if (!executable) return etatVide("claude");
	try {
		const { stdout } = await lancer({
			executable,
			args: ["auth", "status", "--json"],
			stdin: "",
			timeoutMs: DELAI_MS,
			env: environnementEnfant(env),
		});
		// `claude auth status --json` publie l'adresse et le forfait
		// (`subscriptionType`) dès que la connexion est celle de claude.ai. Il
		// ne les publie PAS quand une variable `ANTHROPIC_AUTH_TOKEN` /
		// `ANTHROPIC_API_KEY` est dans l'environnement : la connexion est alors
		// « oauth_token » ou « apiKey », sans compte. C'est ce qui s'est vu le
		// 2026-09-21 en lançant l'app depuis une session `ollama launch claude`
		// (qui pose ces variables), et qui a fait croire à tort que le CLI ne
		// publiait rien. Aucun repli sur `~/.claude.json` ni `.credentials.json`
		// : ils décrivent le compte claude.ai, pas celui que le CLI UTILISE.
		const { connecte, email, plan } = comptClaude(stdout);
		return { outil: "claude", installe: true, connecte, email, plan };
	} catch (e) {
		// Sonde expirée ou lancement raté : l'exécutable EXISTE (résolu plus
		// haut) — « non installé » ferait proposer d'installer un outil déjà
		// présent (vu à l'écran le 2026-09-21, `agy` lent au démarrage à froid).
		// « Non connecté » est l'état le moins faux.
		return { outil: "claude", installe: true, connecte: false, email: null, plan: null };
	}
}

/** Le dossier `.codex`, respectant `$CODEX_HOME` comme le CLI Codex l'honore
    lui-même — MÊME RÈGLE que `cheminCache` de `process.ts` : l'ignorer ferait
    lire (ou effacer, ou ignorer l'échéance de) l'auth d'une AUTRE
    installation que celle qui répond, sans qu'aucune erreur ne le dise. */
function dossierCodex(env: NodeJS.ProcessEnv): string {
	return env.CODEX_HOME || join(dossierPersonnel(env), ".codex");
}

async function etatCodex(env: NodeJS.ProcessEnv): Promise<EtatCompte> {
	try {
		const executable = resoudreExecutable("codex", env);
		const installe = executable !== null;
		const { email, plan } = await (async () => {
			try {
				const brut = await readFile(join(dossierCodex(env), "auth.json"), "utf8");
				return comptCodex(JSON.parse(brut) as unknown);
			} catch (e) {
				// Fichier absent, illisible ou pas du JSON : rien à afficher.
				return { email: null, plan: null };
			}
		})();
		// `auth.json` SURVIT à l'expiration de la session : un `id_token` dont
		// les claims portent une adresse ne veut pas dire que la session
		// MARCHE ENCORE. `connecte` vient donc du CODE DE SORTIE de
		// `codex login status` — la même question que l'ancienne sonde —
		// jamais de la seule présence du fichier. Par `lancer`, PAS `run()` du
		// même module : `run` prend un verrou par outil et attendrait jusqu'à
		// 15 s derrière une génération en cours (voir l'en-tête du fichier).
		let connecte = false;
		if (executable) {
			try {
				const { code } = await lancer({
					executable,
					args: ["login", "status"],
					stdin: "",
					timeoutMs: DELAI_MS,
					env: environnementEnfant(env),
				});
				connecte = code === 0;
			} catch (e) {
				connecte = false;
			}
		}
		return { outil: "codex", installe, connecte, email, plan };
	} catch (e) {
		return etatVide("codex");
	}
}

async function etatAntigravity(env: NodeJS.ProcessEnv): Promise<EtatCompte> {
	const executable = resoudreExecutable("agy", env);
	if (!executable) return etatVide("agy");
	// Le journal de la sonde, dans un fichier à nous : `agy` y écrit à chaque
	// lancement le compte qu'il vient d'authentifier (`applyAuthResult`), et
	// c'est la SEULE source qui dise le compte réellement connecté (voir
	// `emailAntigravityDepuisJournal`). Retiré sur toutes les issues, sonde
	// expirée comprise : il peut porter plus que l'adresse.
	const journal = join(tmpdir(), "neo-quiz-agy-" + process.pid + "-" + Date.now() + ".log");
	try {
		const { stdout, code } = await lancer({
			executable,
			// Le drapeau AVANT la sous-commande : après, `agy models` le rejette
			// (« Usage: agy.exe models [flags] », mesuré).
			args: ["--log-file", journal, "models"],
			stdin: "",
			timeoutMs: DELAI_MS,
			env: environnementEnfant(env),
		});
		const connecte = code === 0 && stdout.trim().length > 0;
		if (!connecte) return { outil: "agy", installe: true, connecte: false, email: null, plan: null };
		let email: string | null = null;
		try {
			email = emailAntigravityDepuisJournal(await readFile(journal, "utf8"));
		} catch (e) { /* pas d'adresse à afficher, la connexion reste vraie */ }
		// Antigravity ne publie aucun forfait, ni dans ce journal ni ailleurs
		// (cherché le 2026-09-21) : la colonne reste vide plutôt qu'inventée.
		return { outil: "agy", installe: true, connecte: true, email, plan: null };
	} catch (e) {
		// Sonde expirée (`agy models` a mesuré jusqu'à 2,3 s sain, mais un
		// démarrage à froid peut dépasser le délai) : l'exécutable EXISTE —
		// « non installé » ferait proposer d'installer un outil déjà présent
		// (vu à l'écran le 2026-09-21). « Non connecté » est l'état le moins
		// faux ; rouvrir les réglages re-sonde.
		return { outil: "agy", installe: true, connecte: false, email: null, plan: null };
	} finally {
		await rm(journal, { force: true }).catch(() => { /* déjà absent */ });
	}
}

/** L'état des trois comptes que le principal peut lire, en PARALLÈLE. Un
    échec sur l'un ne doit jamais faire disparaître les deux autres.

    `outils` FILTRE quelles sondes sont lancées (Ahmed, 2026-09-21) : les
    sondes périodiques d'un flux de connexion (`comptes.ts`, `ai-providers.ts`,
    toutes les trois secondes) n'ont besoin que d'un seul outil, et
    `etatAntigravity` lance `agy models` (~1 s, un aller-retour réseau) — lire
    les trois à chaque tick lançait des dizaines d'appels sans rapport avec ce
    que l'utilisateur fait, jusque dans le sondage d'un flux OAuth de deux
    minutes. Omis, les trois sont lues, comme avant (la section « Comptes »
    des réglages). `ollama` n'a pas de sonde ici (son compte se lit en HTTP
    depuis le rendu) : le filtrer ne change rien. */
export async function etatComptes(
	env: NodeJS.ProcessEnv = process.env,
	outils?: EtatCompte["outil"][],
): Promise<EtatCompte[]> {
	const veut = (o: EtatCompte["outil"]): boolean => !outils || outils.includes(o);
	return Promise.all([
		veut("claude") ? etatClaude(env) : null,
		veut("codex") ? etatCodex(env) : null,
		veut("agy") ? etatAntigravity(env) : null,
	]).then(etats => etats.filter((e): e is EtatCompte => e !== null));
}

/** Traduit le statut HTTP de l'endpoint de quotas Claude en `UsageReadError`,
    par la même règle que l'ancien module : 429 nomme sa fenêtre de reprise,
    401/403 valent « pas de session exploitable », tout le reste est muet. */
function erreurDepuisStatut(statut: number, headers: Headers): UsageRead["error"] {
	if (statut === 429) {
		const retry = headers.get("Retry-After");
		const n = retry ? Number(retry) : NaN;
		return { kind: "rate-limited", retryAfterSec: Number.isFinite(n) ? n : null };
	}
	if (statut === 401 || statut === 403) return { kind: "unauthenticated" };
	return { kind: "unavailable" };
}

/** Les quotas du forfait Claude, lus DIRECTEMENT (`fetch`) : le jeton qui les
    obtient ne quitte jamais ce module. */
async function usageClaude(env: NodeJS.ProcessEnv): Promise<UsageRead> {
	let brut: string;
	try {
		brut = await readFile(join(dossierPersonnel(env), ".claude", ".credentials.json"), "utf8");
	} catch (e) {
		return { rows: [], error: { kind: "unauthenticated" }, mesureAt: null };
	}
	let oauth: { accessToken?: unknown } | undefined;
	try {
		oauth = (JSON.parse(brut) as { claudeAiOauth?: { accessToken?: unknown } }).claudeAiOauth;
	} catch (e) {
		return { rows: [], error: { kind: "unauthenticated" }, mesureAt: null };
	}
	if (typeof oauth?.accessToken !== "string" || !oauth.accessToken) {
		return { rows: [], error: { kind: "unauthenticated" }, mesureAt: null };
	}
	let resp: Response;
	try {
		resp = await fetch(CLAUDE_USAGE_URL, {
			headers: {
				"Authorization": "Bearer " + oauth.accessToken,
				"anthropic-beta": CLAUDE_OAUTH_BETA,
				"Content-Type": "application/json",
			},
			// The token goes to this URL only, never to where a redirect points.
			redirect: "error",
			signal: AbortSignal.timeout(DELAI_MS),
		});
	} catch (e) {
		return { rows: [], error: { kind: "unavailable" }, mesureAt: null };
	}
	if (!resp.ok) return { rows: [], error: erreurDepuisStatut(resp.status, resp.headers), mesureAt: null };
	let corps: unknown;
	try {
		corps = await resp.json();
	} catch (e) {
		return { rows: [], error: { kind: "unavailable" }, mesureAt: null };
	}
	// REQUÊTE EN TEMPS RÉEL : l'instant de la lecture EST l'instant de la
	// mesure, contrairement à Codex qui lit un fichier écrit plus tôt.
	return { rows: usageClaudeDepuisReponse(corps), error: null, mesureAt: Date.now() };
}

/** Le plus récent `.jsonl` sous `~/.codex/sessions/`, en ne descendant que les
    deux mois les plus récents : c'est là que vit une session en cours. */
async function dernierRolloutCodex(env: NodeJS.ProcessEnv): Promise<string | null> {
	const racine = join(dossierCodex(env), "sessions");
	let annees: string[];
	try {
		annees = (await readdir(racine, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort().reverse();
	} catch (e) {
		return null;
	}
	for (const annee of annees) {
		let mois: string[];
		try {
			mois = (await readdir(join(racine, annee), { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort().reverse();
		} catch (e) { continue; }
		for (const m of mois.slice(0, 2)) {
			let jours: string[];
			try {
				jours = (await readdir(join(racine, annee, m), { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort().reverse();
			} catch (e) { continue; }
			for (const j of jours) {
				let fichiers: string[];
				try {
					fichiers = (await readdir(join(racine, annee, m, j))).filter(f => f.endsWith(".jsonl")).sort().reverse();
				} catch (e) { continue; }
				if (fichiers.length > 0) return join(racine, annee, m, j, fichiers[0]);
			}
		}
	}
	return null;
}

async function usageCodex(env: NodeJS.ProcessEnv): Promise<UsageRead> {
	const fichier = await dernierRolloutCodex(env);
	if (!fichier) return { rows: [], error: { kind: "jamais-lance" }, mesureAt: null };
	let brut: string;
	try {
		brut = await readFile(fichier, "utf8");
	} catch (e) {
		return { rows: [], error: { kind: "jamais-lance" }, mesureAt: null };
	}
	// PHOTO, PAS ÉTAT COURANT : les chiffres décrivent l'instant où Codex a
	// ÉCRIT ce fichier (dernier lancement), jamais celui où NOUS venons de le
	// lire — `stat` plutôt que `Date.now()`. Un `stat` qui échoue (fichier
	// disparu entre la lecture du répertoire et celle-ci) rend `null`, jamais
	// un repli sur l'heure courante qui mentirait sur l'âge de la mesure.
	let mesureAt: number | null = null;
	try {
		mesureAt = (await stat(fichier)).mtimeMs;
	} catch (e) { /* mesureAt reste null */ }
	const lignes = brut.split("\n");
	for (let i = lignes.length - 1; i >= 0; i--) {
		const ligne = lignes[i].trim();
		if (!ligne) continue;
		const rows = usageCodexDepuisLigne(ligne);
		if (rows) return { rows, error: null, mesureAt };
	}
	return { rows: [], error: { kind: "unavailable" }, mesureAt: null };
}

/* ── ANTIGRAVITY QUOTAS, READ LIKE `agy /usage` DOES (2026-10-17) ──
   The quota used to show only in agy's own REPL, opened in a terminal. It
   comes from two Cloud Code calls, made here with agy's OWN sign-in:
   `loadCodeAssist` (the account's project), then `fetchAvailableModels`
   (each model's `quotaInfo`). The token is read from the Windows credential
   `gemini:antigravity` (target WRITTEN HERE, never received from the window)
   by a CONSTANT PowerShell script; it is used for these two requests to
   Google only and never leaves this module. Nothing is ever written back.
   An expired token is renewed by agy itself (`agy models`, the sign-in
   probe), never by a client secret of ours. */
const AGY_CRED_SCRIPT = [
	"$ErrorActionPreference='Stop'",
	"Add-Type -TypeDefinition @'",
	"using System; using System.Runtime.InteropServices;",
	"public static class NqAgyCred {",
	"  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct C { public int Flags; public int Type; public string TargetName; public string Comment; public long LastWritten; public int Size; public IntPtr Blob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }",
	"  [DllImport(\"advapi32.dll\", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CredReadW(string t, int type, int flags, out IntPtr c);",
	"  [DllImport(\"advapi32.dll\")] static extern void CredFree(IntPtr c);",
	"  public static string Read() { IntPtr p; if (!CredReadW(\"gemini:antigravity\", 1, 0, out p)) return \"\"; try { var c = (C)Marshal.PtrToStructure(p, typeof(C)); var b = new byte[c.Size]; Marshal.Copy(c.Blob, b, 0, b.Length); return Convert.ToBase64String(b); } finally { CredFree(p); } }",
	"}",
	"'@",
	"[Console]::Out.Write([NqAgyCred]::Read())",
].join("\n");
/* WHERE AND AS WHOM (measured on 2026-10-17 by watching agy 1.4.1's own
   requests): agy calls the "daily" Cloud Code host and names itself
   `antigravity/cli/<version> (…)`. Only that host with a recent agy version
   in the user agent answers the "Gemini 4 Argon" group (a separate weekly
   quota of paid Pro plans); the plain host leaves it out. The version is the
   one of the agy installed on THIS PC (`versionAgy`), never written here, so
   the read keeps working for anyone as agy updates. Without it, the plain
   host and user agent, as before. */
const AGY_HOTE_DAILY = "https://daily-cloudcode-pa.googleapis.com/v1internal:";
const AGY_HOTE = "https://cloudcode-pa.googleapis.com/v1internal:";
/** A token this close to its expiry is renewed first: it must not lapse mid-request. */
const AGY_MARGE_MS = 60_000;

/** agy's access token and its expiry (null when the blob has none), or null
    (not signed in, unreadable). PowerShell gets only what it needs to start:
    no other variable of this process reaches it. */
async function jetonAgy(env: NodeJS.ProcessEnv): Promise<{ jeton: string; expire: number | null } | null> {
	const systemRoot = env.SystemRoot || "C:\\Windows";
	try {
		const { stdout, code } = await lancer({
			executable: join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
			args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(AGY_CRED_SCRIPT, "utf16le").toString("base64")],
			stdin: "",
			timeoutMs: 15_000,
			env: { SystemRoot: systemRoot, TEMP: env.TEMP ?? "", TMP: env.TMP ?? "", PATH: join(systemRoot, "System32") },
		});
		// A credential blob is about 1.5 KB: anything far larger is not agy's.
		if (code !== 0 || !stdout.trim() || stdout.length > 64_000) return null;
		const blob = JSON.parse(Buffer.from(stdout.trim(), "base64").toString("utf8")) as { token?: { access_token?: unknown; expiry?: unknown } };
		const jeton = blob.token?.access_token;
		const expire = typeof blob.token?.expiry === "string" ? Date.parse(blob.token.expiry) : NaN;
		return typeof jeton === "string" && jeton ? { jeton, expire: Number.isFinite(expire) ? expire : null } : null;
	} catch (e) {
		return null;
	}
}

/** The version of the agy installed on this PC (`agy --version`, "1.4.1"),
    read once per run of the app; null when agy is missing or says nothing
    of that shape. Only digits and dots ever reach the user agent. */
let versionAgyLue: Promise<string | null> | null = null;
function versionAgy(env: NodeJS.ProcessEnv): Promise<string | null> {
	versionAgyLue ??= (async () => {
		const executable = resoudreExecutable("agy", env);
		if (!executable) return null;
		try {
			const { stdout, code } = await lancer({ executable, args: ["--version"], stdin: "", timeoutMs: DELAI_MS * 2, env: environnementEnfant(env) });
			const v = /\b(\d{1,4}\.\d{1,4}\.\d{1,6})\b/.exec(stdout)?.[1];
			return code === 0 && v ? v : null;
		} catch (e) {
			return null;
		}
	})();
	return versionAgyLue;
}

/** One Cloud Code call: no redirect is followed (the token goes to this URL
    only), the body is read up to 1 MB and parsed. Throws on any failure but
    an HTTP status, which is returned. */
async function postAgy(url: string, jeton: string, corps: unknown, agent = "antigravity"): Promise<{ ok: true; json: unknown } | { ok: false; status: number; headers: Headers }> {
	const resp = await fetch(url, {
		method: "POST",
		headers: { "Authorization": "Bearer " + jeton, "User-Agent": agent, "Content-Type": "application/json" },
		body: JSON.stringify(corps),
		redirect: "error",
		signal: AbortSignal.timeout(DELAI_MS * 2),
	});
	if (!resp.ok) { await resp.body?.cancel().catch(() => undefined); return { ok: false, status: resp.status, headers: resp.headers }; }
	const lecteur = resp.body?.getReader();
	if (!lecteur) throw new Error("empty body");
	const morceaux: Uint8Array[] = [];
	let taille = 0;
	for (;;) {
		const { done, value } = await lecteur.read();
		if (done) break;
		taille += value.byteLength;
		if (taille > 1_000_000) { await lecteur.cancel().catch(() => undefined); throw new Error("answer too large"); }
		morceaux.push(value);
	}
	return { ok: true, json: JSON.parse(Buffer.concat(morceaux).toString("utf8")) as unknown };
}

async function lireUsageAntigravity(env: NodeJS.ProcessEnv): Promise<UsageRead> {
	if (process.platform !== "win32") return { rows: [], error: { kind: "unavailable" }, mesureAt: null };
	let lu = await jetonAgy(env);
	if (lu && lu.expire !== null && lu.expire <= Date.now() + AGY_MARGE_MS) {
		// agy renews its own token and stores it again: the sign-in probe does it.
		const executable = resoudreExecutable("agy", env);
		if (!executable) return { rows: [], error: { kind: "unauthenticated" }, mesureAt: null };
		await lancer({ executable, args: ["models"], stdin: "", timeoutMs: DELAI_MS * 2, env: environnementEnfant(env) }).catch(() => null);
		lu = await jetonAgy(env);
		if (lu && lu.expire !== null && lu.expire <= Date.now()) lu = null;
	}
	if (!lu) return { rows: [], error: { kind: "unauthenticated" }, mesureAt: null };
	try {
		const charge = await postAgy(AGY_HOTE + "loadCodeAssist", lu.jeton, { metadata: { ideType: "ANTIGRAVITY" } });
		if (!charge.ok) return { rows: [], error: erreurDepuisStatut(charge.status, charge.headers), mesureAt: null };
		const p = charge.json && typeof charge.json === "object" ? (charge.json as { cloudaicompanionProject?: unknown }).cloudaicompanionProject : null;
		const projet = typeof p === "string" ? p : p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string" ? (p as { id: string }).id : null;
		const corps = projet ? { project: projet } : {};
		/* The summary first, as agy's `/usage` reads it (daily host, agy's own
		   user agent: the Argon group comes only so); then the plain host;
		   then the per-model quotas when both are empty. */
		const version = await versionAgy(env);
		const resume = version
			? await postAgy(AGY_HOTE_DAILY + "retrieveUserQuotaSummary", lu.jeton, corps, "antigravity/cli/" + version).catch(() => null)
			: null;
		let lignes = resume && resume.ok ? usageAntigravityDepuisResume(resume.json) : [];
		// The daily host has been seen to leave the Gemini group out with an old version: the plain one has it.
		if (!lignes.some(r => /gemini models/i.test(r.group ?? ""))) {
			const simple = await postAgy(AGY_HOTE + "retrieveUserQuotaSummary", lu.jeton, corps).catch(() => null);
			const deBase = simple && simple.ok ? usageAntigravityDepuisResume(simple.json) : [];
			const vus = new Set(lignes.map(r => r.group));
			lignes = [...deBase.filter(r => !vus.has(r.group)), ...lignes];
		}
		if (lignes.length) return { rows: lignes, error: null, mesureAt: Date.now() };
		const modeles = await postAgy(AGY_HOTE + "fetchAvailableModels", lu.jeton, corps);
		if (!modeles.ok) return { rows: [], error: erreurDepuisStatut(modeles.status, modeles.headers), mesureAt: null };
		const rows = usageAntigravityDepuisModeles(modeles.json);
		return rows.length ? { rows, error: null, mesureAt: Date.now() } : { rows: [], error: { kind: "unavailable" }, mesureAt: null };
	} catch (e) {
		return { rows: [], error: { kind: "unavailable" }, mesureAt: null };
	}
}

/* Each read launches PowerShell (and agy near the token's expiry): one at a
   time, and its answer kept 60 s, so no window can turn hovering into a
   stream of processes. */
let usageAgyGarde: { at: number; lecture: Promise<UsageRead> } | null = null;
function usageAntigravity(env: NodeJS.ProcessEnv): Promise<UsageRead> {
	if (usageAgyGarde && Date.now() - usageAgyGarde.at < 60_000) return usageAgyGarde.lecture;
	const lecture = lireUsageAntigravity(env);
	usageAgyGarde = { at: Date.now(), lecture };
	return lecture;
}

/* ── OLLAMA USAGE (2026-10-17), the owner's status line's way ──
   Ollama has no usage API: the page https://ollama.com/settings is read with
   the account's session cookie, which the owner keeps in
   `~/.claude/ollama-cookie.local` for his status line (the browsers encrypt
   theirs). The cookie goes to ollama.com only, no redirect is followed (a
   signed-out page redirects to the sign-in), the page is read up to 2 MB and
   only its numbers leave (`usageOllamaDepuisPage`). Without a cookie, the
   status line's own cache is read instead, dated by its `fetched_at`. */
const OLLAMA_SETTINGS_URL = "https://ollama.com/settings";

async function usageOllama(env: NodeJS.ProcessEnv): Promise<UsageRead> {
	const claude = join(dossierPersonnel(env), ".claude");
	let cookie: string | null = null;
	try {
		const brut = (await readFile(join(claude, "ollama-cookie.local"), "utf8")).trim();
		// A bare value is the `__Secure-session` cookie; a line with `=` is the whole header.
		if (brut && !/[\r\n]/.test(brut) && brut.length < 8000) cookie = brut.includes("=") ? brut : "__Secure-session=" + brut;
	} catch (e) { /* no cookie: the cache below */ }
	if (cookie) {
		try {
			const resp = await fetch(OLLAMA_SETTINGS_URL, {
				headers: { "Cookie": cookie, "User-Agent": "Mozilla/5.0" },
				redirect: "manual",
				signal: AbortSignal.timeout(DELAI_MS * 3),
			});
			if (resp.status >= 300 && resp.status < 400) { await resp.body?.cancel().catch(() => undefined); return { rows: [], error: { kind: "unauthenticated" }, mesureAt: null }; }
			if (!resp.ok) { await resp.body?.cancel().catch(() => undefined); return { rows: [], error: erreurDepuisStatut(resp.status, resp.headers), mesureAt: null }; }
			const lecteur = resp.body?.getReader();
			const morceaux: Uint8Array[] = [];
			let taille = 0;
			for (;;) {
				if (!lecteur) break;
				const { done, value } = await lecteur.read();
				if (done) break;
				taille += value.byteLength;
				if (taille > 2_000_000) { await lecteur.cancel().catch(() => undefined); break; }
				morceaux.push(value);
			}
			const rows = usageOllamaDepuisPage(Buffer.concat(morceaux).toString("utf8"), Date.now());
			if (rows.length) return { rows, error: null, mesureAt: Date.now() };
		} catch (e) { /* unreachable: the cache below, if any */ }
	}
	try {
		const lu = usageOllamaDepuisCache(JSON.parse(await readFile(join(claude, "ollama-usage-cache.json"), "utf8")) as unknown);
		if (lu.rows.length) return { rows: lu.rows, error: null, mesureAt: lu.mesureAt };
	} catch (e) { /* no cache either */ }
	return { rows: [], error: { kind: cookie ? "unavailable" : "unauthenticated" }, mesureAt: null };
}

/* Each Ollama read is one page load: one at a time, kept 60 s. */
let usageOllamaGarde: { at: number; lecture: Promise<UsageRead> } | null = null;

/** Les quotas du forfait, pour les quatre fournisseurs qui les publient. */
export async function usageCompte(outil: "claude" | "codex" | "agy" | "ollama", env: NodeJS.ProcessEnv = process.env): Promise<UsageRead> {
	if (outil === "ollama") {
		if (usageOllamaGarde && Date.now() - usageOllamaGarde.at < 60_000) return usageOllamaGarde.lecture;
		const lecture = usageOllama(env);
		usageOllamaGarde = { at: Date.now(), lecture };
		return lecture;
	}
	return outil === "claude" ? usageClaude(env) : outil === "codex" ? usageCodex(env) : usageAntigravity(env);
}

/* ── ONE ACCOUNT OPERATION AT A TIME (2026-10-10) ──
   A sign-out and a browser sign-in, of any tool, never run together: two
   OAuth flows racing, or a sign-out landing in the middle of a sign-in,
   would leave the account in a state nobody chose. The lock lives HERE, in
   the main process, released on every outcome (`finally`); a second request
   gets `occupe`, never a wait. */
let operationEnCours: { annuler: AbortController } | null = null;

/** Seams for `check:electron-process`: the launcher (a fake one sees the
    executable and the arguments) and the sign-in's time limit. */
export interface OptionsCompte {
	env?: NodeJS.ProcessEnv;
	lancer?: typeof lancer;
	delaiConnexionMs?: number;
}

/** Signs a CLI out, without a terminal. `confirmer` is the NATIVE box of
    `canaux.ts` (2026-10-10): it is asked FIRST, under the lock, and nothing
    is launched unless it answers yes (`annule` otherwise). It is a parameter,
    not an option, so no caller can forget it. */
export async function deconnecterCompte(outil: OutilCompte | "ollama", confirmer: () => Promise<boolean>, options: OptionsCompte = {}): Promise<"ok" | "echec" | "indisponible" | "occupe" | "annule"> {
	if (operationEnCours) return "occupe";
	const annuler = new AbortController();
	operationEnCours = { annuler };
	try {
		let oui = false;
		try { oui = await confirmer(); } catch (e) { oui = false; }
		if (!oui) return "annule";
		if (outil === "agy") return await deconnecterAntigravity();
		const env = options.env ?? process.env;
		const args: readonly string[] = outil === "ollama" ? ["signout"] : ARGS_COMPTE[outil].deconnexion;
		const executable = resoudreExecutable(outil, env);
		if (!executable) return "indisponible";
		try {
			const { code } = await (options.lancer ?? lancer)({
				executable,
				args: [...args],
				stdin: "",
				signal: annuler.signal,
				timeoutMs: DELAI_MS,
				env: environnementEnfant(env),
				cwd: dossierPersonnel(env),
			});
			return code === 0 ? "ok" : "echec";
		} catch (e) {
			return "echec";
		}
	} finally {
		operationEnCours = null;
	}
}

/** How long the browser sign-in may take before its tree is killed. */
export const DELAI_CONNEXION_MS = 10 * 60000;

/**
 * SIGNS IN THROUGH THE CLI'S OWN BROWSER FLOW (2026-10-10, as MonoCode does):
 * `claude auth login` / `codex login` (`ARGS_COMPTE`), hidden, in the home
 * folder. The CLI opens the browser, receives the answer on its own local
 * callback and stores its own credentials: Neo Quiz never sees, reads or
 * keeps a token, it only waits for the exit code. `stdin` stays open
 * (`garderStdin`), as in a terminal. One operation at a time (`occupe`);
 * `annulerConnexionCompte` or the 10-minute limit kill the WHOLE tree.
 */
export async function connecterCompte(outil: "claude" | "codex", options: OptionsCompte = {}): Promise<"ok" | "echec" | "annule" | "expire" | "occupe" | "indisponible"> {
	if (outil !== "claude" && outil !== "codex") return "indisponible";
	if (operationEnCours) return "occupe";
	const annuler = new AbortController();
	operationEnCours = { annuler };
	try {
		const env = options.env ?? process.env;
		const executable = resoudreExecutable(outil, env);
		if (!executable) return "indisponible";
		try {
			const { code } = await (options.lancer ?? lancer)({
				executable,
				args: [...ARGS_COMPTE[outil].connexion],
				stdin: "",
				garderStdin: true,
				signal: annuler.signal,
				timeoutMs: options.delaiConnexionMs ?? DELAI_CONNEXION_MS,
				env: environnementEnfant(env),
				cwd: dossierPersonnel(env),
			});
			return code === 0 ? "ok" : "echec";
		} catch (e) {
			const nom = e instanceof Error ? e.name : "";
			if (nom === "annule") return "annule";
			if (nom === "timeout") return "expire";
			if (nom === "introuvable") return "indisponible";
			console.warn(LOG_PREFIX, "browser sign-in failed:", e);
			return "echec";
		}
	} finally {
		operationEnCours = null;
	}
}

/** Stops the running sign-in, if any: its tree is killed by `lancer`. */
export function annulerConnexionCompte(): void {
	operationEnCours?.annuler.abort();
}

/** Antigravity garde ses jetons au gestionnaire d'identifiants Windows, cible
    `gemini:antigravity` ÉCRITE EN DUR ici, jamais reçue du rendu ni recomposée
    depuis un argument. `cmdkey.exe` n'a pas à entrer dans la liste blanche
    `OUTILS` : ni le programme ni son argument ne viennent du rendu, exactement
    comme les `spawn("powershell.exe", …)` déjà posés dans `process.ts`. */
async function deconnecterAntigravity(): Promise<"ok" | "echec" | "indisponible"> {
	if (process.platform !== "win32") return "indisponible";
	try {
		// CHEMIN ABSOLU, pas un nom nu résolu sur le PATH : c'est l'appel le
		// plus sensible du lot, il supprime une entrée du gestionnaire
		// d'identifiants Windows. `%SystemRoot%` est presque toujours défini ;
		// `C:\Windows` est le repli du système lui-même quand elle manque.
		const systemRoot = process.env.SystemRoot || "C:\\Windows";
		// Codes mesurés le 2026-09-21 : 0 quand l'entrée est supprimée, 1 quand
		// il n'y avait rien à supprimer.
		const { code } = await lancer({
			executable: join(systemRoot, "System32", "cmdkey.exe"),
			args: ["/delete:gemini:antigravity"],
			stdin: "",
			timeoutMs: DELAI_MS,
			env: process.env,
		});
		return code === 0 ? "ok" : "echec";
	} catch (e) {
		console.warn(LOG_PREFIX, "déconnexion Antigravity impossible:", e);
		return "echec";
	}
}
