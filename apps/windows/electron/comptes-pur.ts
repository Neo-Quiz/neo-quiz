import type { UsageRow } from "../../../src/dashboard/usage-format";

/* ══════════════════════════════════════════════════════════
   COMPTES IA — la partie PURE : lire une identité sans rien en laisser fuir.

   Trois des quatre comptes ne se lisent que dans des fichiers de SECRETS. Ce
   module reçoit leur contenu déjà lu et n'en ressort QUE l'adresse et le nom
   du forfait. Il ne connaît ni disque, ni réseau, ni horloge : c'est ce qui le
   rend éprouvable (`npm run check:electron-comptes`), et c'est là que vit
   l'assertion qui compte — aucune de ces fonctions ne recopie son entrée.
══════════════════════════════════════════════════════════ */

/** Les trois outils dont le PRINCIPAL lit le compte. Ollama n'en est pas :
    son compte se sonde depuis le rendu (`checkOllamaCompte`, HTTP local). */
export type OutilCompte = "claude" | "codex" | "agy";

/** Le second segment d'un JWT, décodé. `null` dès que la forme n'y est pas :
    un jeton trafiqué ne doit produire ni exception ni adresse inventée. */
export function lireClaims(idToken: unknown): Record<string, unknown> | null {
	if (typeof idToken !== "string") return null;
	const parts = idToken.split(".");
	if (parts.length !== 3) return null;
	try {
		const json = Buffer.from(parts[1], "base64url").toString("utf8");
		const o: unknown = JSON.parse(json);
		return o && typeof o === "object" ? (o as Record<string, unknown>) : null;
	} catch (e) {
		return null;
	}
}

/** L'adresse et le plan d'un `~/.codex/auth.json` DÉJÀ LU. Deux champs en
    sortent, jamais l'objet : c'est lui qui porte `access_token`,
    `refresh_token` et parfois une clé d'API. */
export function comptCodex(auth: unknown): { email: string | null; plan: string | null } {
	const vide = { email: null, plan: null };
	if (!auth || typeof auth !== "object") return vide;
	const tokens = (auth as { tokens?: unknown }).tokens;
	if (!tokens || typeof tokens !== "object") return vide;
	const claims = lireClaims((tokens as { id_token?: unknown }).id_token);
	if (!claims) return vide;
	const email = typeof claims.email === "string" ? claims.email : null;
	const bloc = claims["https://api.openai.com/auth"];
	const brut = bloc && typeof bloc === "object"
		? (bloc as { chatgpt_plan_type?: unknown }).chatgpt_plan_type
		: undefined;
	return { email, plan: typeof brut === "string" && brut ? majuscule(brut) : null };
}

/** « max » + « default_claude_max_5x » → « Max (5x) ». Le multiplicateur ne
    vit que dans le palier : absent pour les forfaits qui n'en ont pas, et on
    n'en invente pas un « (1x) ». */
export function planClaude(oauth: unknown): string | null {
	if (!oauth || typeof oauth !== "object") return null;
	const type = (oauth as { subscriptionType?: unknown }).subscriptionType;
	if (typeof type !== "string" || !type) return null;
	const tier = (oauth as { rateLimitTier?: unknown }).rateLimitTier;
	const mult = /_(\d+)x\b/.exec(typeof tier === "string" ? tier : "");
	return mult ? majuscule(type) + " (" + mult[1] + "x)" : majuscule(type);
}

/** La sortie de `claude auth status --json`. Une sortie qui n'est pas du JSON
    (CLI absent, message d'erreur) vaut « déconnecté » et ne jette pas. */
export function comptClaude(stdout: string): { connecte: boolean; email: string | null; plan: string | null } {
	const vide = { connecte: false, email: null, plan: null };
	let o: unknown;
	try { o = JSON.parse(stdout); } catch (e) { return vide; }
	if (!o || typeof o !== "object") return vide;
	const d = o as { loggedIn?: unknown; email?: unknown };
	if (d.loggedIn !== true) return vide;
	return {
		connecte: true,
		email: typeof d.email === "string" ? d.email : null,
		plan: planClaude(o),
	};
}

/** L'adresse du compte qu'Antigravity CLI vient d'AUTHENTIFIER, lue dans le
    journal qu'il écrit à chaque lancement (`--log-file`), sur la ligne
    `server_oauth.go:…] applyAuthResult: email=<adresse>, authMethod=…`.

    POURQUOI LE JOURNAL ET PAS UN FICHIER DE COMPTE : `~/.gemini/
    google_accounts.json` (`active`) est un VESTIGE de Gemini CLI, comme
    `oauth_creds.json` que la tâche 1 avait démasqué — mesuré le 2026-09-21 :
    il disait `ahmedmili435@…` quand le CLI s'authentifiait en
    `houdhaypha95@…`. Les jetons d'Antigravity vivent au gestionnaire
    d'identifiants Windows, et seul le CLI sait quel compte ils ouvrent. Le
    journal est donc la seule source qui dit le compte RÉELLEMENT connecté.
    Seule l'adresse sort ; le reste du journal n'est jamais recopié. */
export function emailAntigravityDepuisJournal(journal: unknown): string | null {
	if (typeof journal !== "string") return null;
	const m = /applyAuthResult: email=([^,\s]+)/.exec(journal);
	return m ? m[1] : null;
}

/** Les quotas d'UNE ligne de rollout Codex. `null` quand la ligne ne parle pas
    de quotas : c'est ce qui distingue « pas encore vu » de « vu, et vide ». */
export function usageCodexDepuisLigne(ligne: string): UsageRow[] | null {
	let o: unknown;
	try { o = JSON.parse(ligne); } catch (e) { return null; }
	const rl = (o as { payload?: { rate_limits?: unknown } } | null)?.payload?.rate_limits;
	if (!rl || typeof rl !== "object") return null;
	const fenetre = (w: unknown): UsageRow | null => {
		if (!w || typeof w !== "object") return null;
		const d = w as { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown };
		if (typeof d.used_percent !== "number") return null;
		return {
			kind: "window",
			windowMinutes: typeof d.window_minutes === "number" ? d.window_minutes : 0,
			usedPercent: d.used_percent,
			// `resets_at` est en SECONDES epoch dans les rollouts Codex.
			resetsAt: typeof d.resets_at === "number" ? d.resets_at * 1000 : null,
		};
	};
	const r = rl as { primary?: unknown; secondary?: unknown };
	return [fenetre(r.primary), fenetre(r.secondary)].filter((x): x is UsageRow => x !== null);
}

interface LimiteBrute {
	kind?: unknown;
	percent?: unknown;
	utilization?: unknown;
	resets_at?: unknown;
	scope?: { model?: { display_name?: unknown } } | null;
}

/** `resets_at` est une chaîne ISO 8601 ABSOLUE (« 2026-09-21T10:00:00Z… »),
    jamais une durée : `Date.parse` la convertit en ms epoch, `null` si elle
    ne se lit pas — jamais une exception ni une date inventée. */
function resetsAtDepuis(brut: unknown): number | null {
	if (typeof brut !== "string") return null;
	const ms = Date.parse(brut);
	return Number.isFinite(ms) ? ms : null;
}

function ligneDepuisLimite(l: LimiteBrute, percent: unknown): UsageRow | null {
	if (typeof percent !== "number") return null;
	const resetsAt = resetsAtDepuis(l.resets_at);
	if (l.kind === "session") return { kind: "session", usedPercent: percent, resetsAt };
	if (l.kind === "weekly_all") return { kind: "weekly-all", usedPercent: percent, resetsAt };
	const modelName = l.scope?.model?.display_name;
	if (typeof modelName === "string" && modelName) {
		return { kind: "weekly-model", modelName, usedPercent: percent, resetsAt };
	}
	return null;
}

/** La réponse (déjà décodée en JSON) de `GET /api/oauth/usage` de Claude, en
    lignes affichables. PURE : aucune horloge, `resets_at` est absolu.
 *
 * Deux formes coexistent dans la même réponse, mesurées sur un vrai compte le
 * 2026-09-21 : `limits[]` (chaque entrée porte `kind` et `percent`), lue EN
 * PREMIER, et les champs historiques `five_hour`/`seven_day`/`seven_day_opus`
 * (chacun porte `utilization`, pas `percent`) — repli seulement si `limits[]`
 * est absent, vide, ou n'a produit aucune ligne exploitable : un compte de
 * référence ne renvoie QUE ces champs historiques, et sans ce repli l'écran
 * serait vide. */
export function usageClaudeDepuisReponse(corps: unknown): UsageRow[] {
	if (!corps || typeof corps !== "object") return [];
	const d = corps as { limits?: unknown; five_hour?: LimiteBrute; seven_day?: LimiteBrute; seven_day_opus?: LimiteBrute };
	if (Array.isArray(d.limits)) {
		const rows = (d.limits as LimiteBrute[])
			.map(l => ligneDepuisLimite(l, l?.percent))
			.filter((r): r is UsageRow => r !== null);
		if (rows.length > 0) return rows;
	}
	const repli: UsageRow[] = [];
	const session = d.five_hour ? ligneDepuisLimite({ ...d.five_hour, kind: "session" }, d.five_hour.utilization) : null;
	const semaine = d.seven_day ? ligneDepuisLimite({ ...d.seven_day, kind: "weekly_all" }, d.seven_day.utilization) : null;
	const opus = d.seven_day_opus
		? ligneDepuisLimite({ resets_at: d.seven_day_opus.resets_at, scope: { model: { display_name: "Opus" } } }, d.seven_day_opus.utilization)
		: null;
	if (session) repli.push(session);
	if (semaine) repli.push(semaine);
	if (opus) repli.push(opus);
	return repli;
}

function majuscule(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ── ANTIGRAVITY QUOTAS (2026-10-17) ──
   Antigravity meters its quota per MODEL GROUP, not in 5-hour or weekly
   windows: `fetchAvailableModels` (the call `agy` makes for `/usage`) gives
   each model a `quotaInfo { remainingFraction, resetTime }`. Models that
   report the same numbers share one quota, so they are grouped by value
   (reset compared to the minute); untouched quotas stay apart by family so
   unrelated pools never merge. Proto JSON omits a zero `remainingFraction`:
   a reset time without a fraction is a spent quota. Only models with a
   display name are listed (the others are internal: tab completion...). */

type FamilleAgy = "Gemini" | "Claude & GPT-OSS";

function familleAgy(cle: string): FamilleAgy | null {
	if (cle.startsWith("gemini")) return "Gemini";
	if (cle.startsWith("claude") || cle.startsWith("gpt-oss")) return "Claude & GPT-OSS";
	return null;
}

/** "Gemini 3.1 Pro (High)" → "Gemini 3.1 Pro": the effort is not a quota. */
function nomDeBase(nom: string): string {
	return nom.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export function usageAntigravityDepuisModeles(corps: unknown): UsageRow[] {
	if (!corps || typeof corps !== "object") return [];
	const modeles = (corps as { models?: unknown }).models;
	if (!modeles || typeof modeles !== "object") return [];
	const groupes = new Map<string, { famille: FamilleAgy; utilise: number; reset: number | null; noms: string[] }>();
	for (const [cle, m] of Object.entries(modeles as Record<string, unknown>)) {
		if (!m || typeof m !== "object") continue;
		const nom = (m as { displayName?: unknown }).displayName;
		const famille = familleAgy(cle);
		if (typeof nom !== "string" || !nom.trim() || !famille) continue;
		const q = (m as { quotaInfo?: unknown }).quotaInfo;
		if (!q || typeof q !== "object") continue;
		const brutFraction = (q as { remainingFraction?: unknown }).remainingFraction;
		const brutReset = (q as { resetTime?: unknown }).resetTime;
		const reset = typeof brutReset === "string" && Number.isFinite(Date.parse(brutReset)) ? Date.parse(brutReset) : null;
		let restant: number;
		if (typeof brutFraction === "number" && Number.isFinite(brutFraction)) restant = Math.min(1, Math.max(0, brutFraction));
		else if (brutFraction === undefined && reset !== null) restant = 0;
		else continue;
		const utilise = Math.round((1 - restant) * 1000) / 10;
		const intact = restant >= 1;
		const cleGroupe = famille + "|" + (intact ? "full" : utilise + "|" + (reset === null ? "-" : Math.floor(reset / 60000)));
		/* An untouched quota reports a reset five hours from NOW, moving with
		   every read (measured on 2026-10-17): it is no reset time, none is shown. */
		const resetUtile = intact ? null : reset;
		const g = groupes.get(cleGroupe) ?? { famille, utilise, reset: resetUtile, noms: [] };
		const base = nomDeBase(nom);
		if (!g.noms.includes(base)) g.noms.push(base);
		if (resetUtile !== null && (g.reset === null || resetUtile < g.reset)) g.reset = resetUtile;
		groupes.set(cleGroupe, g);
	}
	const liste = [...groupes.values()];
	return liste
		.map((g): UsageRow => {
			// The family names the pool when it is the only one of its family.
			const seul = liste.filter(x => x.famille === g.famille).length === 1;
			const noms = g.noms.length > 3 ? g.noms.slice(0, 3).join(", ") + " +" + (g.noms.length - 3) : g.noms.join(", ");
			return { kind: "weekly-model", modelName: seul ? g.famille : noms, usedPercent: g.utilise, resetsAt: g.reset };
		})
		.sort((a, b) => (a.modelName ?? "").localeCompare(b.modelName ?? "") || b.usedPercent - a.usedPercent);
}


/* ── OLLAMA USAGE (2026-10-17), read like the owner's status line does ──
   Ollama publishes no usage API: the numbers only live on the signed-in page
   https://ollama.com/settings, rendered by the server. Two quota models: an
   "Included usage" monthly budget in dollars ("$0.97 of $60 used", "Resets in
   4 weeks", the exact instant on a `data-time` attribute), or "Session usage"
   (5 h) and "Weekly usage" in "xx.x% used". Only the numbers leave this
   function; the page itself (the account's settings) never does. */

/** "in 6 minutes", "in 3 days" → that many ms from `maintenant`, or null. */
export function resetOllama(texte: string | null, maintenant: number): number | null {
	const m = /in\s+(\d+|an?|one)\s+(minute|hour|day|week|month)s?/i.exec(texte ?? "");
	if (!m) return null;
	const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
	const unite: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 };
	return maintenant + n * unite[m[2].toLowerCase()];
}

function texteBrut(html: string): string {
	return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

/** The usage rows of the settings page's HTML (already read, bounded). */
export function usageOllamaDepuisPage(html: string, maintenant: number): UsageRow[] {
	const rows: UsageRow[] = [];
	const fenetre = (label: string, fin: number): string | null => {
		const i = html.indexOf(label);
		if (i === -1) return null;
		return html.slice(i, fin > i ? fin : i + 12_000);
	};
	const resetDe = (t: string): string | null => /Resets (in [^.]+?)\s*\./.exec(t)?.[1] ?? null;
	/* The CREDITS page (measured on 2026-10-17): "Monthly credits $37.76
	   Refills to $60 on October 21, 2026." and, further down, "Monthly
	   credits used $22.24". The used amount, else the limit minus the balance. */
	const tout = texteBrut(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " "));
	const recharge = /Refills to \$\s*([\d,]+(?:\.\d+)?) on ([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(tout);
	if (recharge) {
		const limite = Number(recharge[1].replace(/,/g, ""));
		const utiliseTexte = /Monthly credits used \$\s*([\d,]+(?:\.\d+)?)/.exec(tout)?.[1];
		const solde = /Monthly credits \$\s*([\d,]+(?:\.\d+)?)\s*Refills/.exec(tout)?.[1];
		const utilise = utiliseTexte !== undefined ? Number(utiliseTexte.replace(/,/g, "")) : solde !== undefined ? limite - Number(solde.replace(/,/g, "")) : NaN;
		if (Number.isFinite(limite) && limite > 0 && Number.isFinite(utilise) && utilise >= 0) {
			const date = Date.parse(recharge[2]);
			const montant = utiliseTexte ?? (Math.round(utilise * 100) / 100).toFixed(2);
			rows.push({ kind: "monthly", amount: "$" + montant + " / $" + recharge[1], usedPercent: Math.min(100, Math.round(utilise / limite * 1000) / 10), resetsAt: Number.isFinite(date) ? date : null });
			return rows;
		}
	}
	const mensuel = fenetre("Monthly usage", html.indexOf("Models used this month"));
	if (mensuel) {
		const t = texteBrut(mensuel);
		const m = /\$\s*([\d,]+(?:\.\d+)?)\s*of\s*\$\s*([\d,]+(?:\.\d+)?)\s*used/.exec(t);
		const utilise = m ? Number(m[1].replace(/,/g, "")) : NaN;
		const limite = m ? Number(m[2].replace(/,/g, "")) : NaN;
		if (m && Number.isFinite(utilise) && Number.isFinite(limite) && limite > 0) {
			const instant = /data-time="([^"]+)"[^>]*>\s*Resets/.exec(mensuel)?.[1];
			const exact = instant && Number.isFinite(Date.parse(instant)) ? Date.parse(instant) : null;
			rows.push({ kind: "monthly", amount: "$" + m[1] + " / $" + m[2], usedPercent: Math.round(utilise / limite * 1000) / 10, resetsAt: exact ?? resetOllama(resetDe(t), maintenant) });
		}
	}
	const si = html.indexOf("Session usage");
	const wi = html.indexOf("Weekly usage");
	for (const [label, kind, fin] of [["Session usage", "session", wi > si ? wi : -1], ["Weekly usage", "weekly-all", -1]] as const) {
		const f = fenetre(label, fin);
		if (!f) continue;
		const t = texteBrut(f);
		const p = /([\d.]+)\s*%\s*used/.exec(t);
		const pct = p ? Number(p[1]) : NaN;
		if (!Number.isFinite(pct)) continue;
		rows.push({ kind, usedPercent: Math.min(100, Math.max(0, pct)), resetsAt: resetOllama(resetDe(t), maintenant) });
	}
	return rows;
}

/** The rows of the status line's cache (`~/.claude/ollama-usage-cache.json`,
    written by the owner's `ollama-usage.py`), when no cookie is at hand. */
export function usageOllamaDepuisCache(cache: unknown): { rows: UsageRow[]; mesureAt: number | null } {
	const vide = { rows: [], mesureAt: null };
	if (!cache || typeof cache !== "object") return vide;
	const c = cache as Record<string, unknown>;
	const quand = typeof c.fetched_at === "number" && Number.isFinite(c.fetched_at) ? c.fetched_at * 1000 : null;
	const rows: UsageRow[] = [];
	const nombre = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
	const m = c.monthly && typeof c.monthly === "object" ? c.monthly as Record<string, unknown> : null;
	if (m && nombre(m.utilization) !== null) {
		const r = typeof m.resets_at === "string" && Number.isFinite(Date.parse(m.resets_at)) ? Date.parse(m.resets_at) : null;
		const amount = typeof m.used === "string" && typeof m.limit === "string" && /^[\d.,]{1,12}$/.test(m.used) && /^[\d.,]{1,12}$/.test(m.limit) ? "$" + m.used + " / $" + m.limit : undefined;
		rows.push({ kind: "monthly", ...(amount ? { amount } : {}), usedPercent: Math.min(100, Math.max(0, nombre(m.utilization)!)), resetsAt: r });
	}
	for (const [cle, kind] of [["session", "session"], ["weekly", "weekly-all"]] as const) {
		const w = c[cle] && typeof c[cle] === "object" ? c[cle] as Record<string, unknown> : null;
		const pct = w ? nombre(w.utilization) : null;
		if (pct === null) continue;
		rows.push({ kind, usedPercent: Math.min(100, Math.max(0, pct)), resetsAt: quand !== null ? resetOllama(typeof w!.reset === "string" ? w!.reset : null, quand) : null });
	}
	return { rows, mesureAt: rows.length ? quand : null };
}


/* ── ANTIGRAVITY'S QUOTA SUMMARY (2026-10-17) ──
   `retrieveUserQuotaSummary`, the call behind agy's `/usage` panel and the
   Antigravity app's: groups of models ("Gemini Models", "Claude and GPT
   models"), each with a "weekly" and a "5h" bucket (`remainingFraction`,
   `resetTime`). Within a group, models share both limits. */
export function usageAntigravityDepuisResume(corps: unknown): UsageRow[] {
	if (!corps || typeof corps !== "object") return [];
	const groupes = (corps as { groups?: unknown }).groups;
	if (!Array.isArray(groupes)) return [];
	const rows: UsageRow[] = [];
	for (const g of groupes.slice(0, 12)) {
		if (!g || typeof g !== "object") continue;
		const nom = (g as { displayName?: unknown }).displayName;
		const seaux = (g as { buckets?: unknown }).buckets;
		if (typeof nom !== "string" || !nom.trim() || !Array.isArray(seaux)) continue;
		for (const b of seaux.slice(0, 6)) {
			if (!b || typeof b !== "object") continue;
			const fenetre = (b as { window?: unknown }).window;
			const kind = fenetre === "5h" ? "session" : fenetre === "weekly" ? "weekly-all" : null;
			if (!kind) continue;
			const f = (b as { remainingFraction?: unknown }).remainingFraction;
			const brutReset = (b as { resetTime?: unknown }).resetTime;
			const reset = typeof brutReset === "string" && Number.isFinite(Date.parse(brutReset)) ? Date.parse(brutReset) : null;
			// Proto JSON omits a zero fraction: a bucket without one is spent.
			const restant = typeof f === "number" && Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0;
			const intact = restant >= 1;
			rows.push({ kind, group: nom.trim().slice(0, 60), usedPercent: Math.round((1 - restant) * 1000) / 10, resetsAt: intact ? null : reset });
		}
	}
	return rows;
}
