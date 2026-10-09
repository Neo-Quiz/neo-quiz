import { t, hourOptions } from "../i18n";

/* ══════════════════════════════════════════════════════════
   USAGE IA — LA PARTIE PURE : les types et le formatage.

   Extraite d'`ai-usage.ts` à la tâche 6 de la tranche 5, et pour une seule
   raison : la page « Générer » (`ai.ts`) affiche ce qu'une génération a coûté
   (« 5 questions · 14k tokens · 44 s ») sous les DEUX hôtes, et ces
   formateurs vivaient dans un module qui importe `Platform` et `requestUrl`
   d'Obsidian — le journal persisté et la lecture des quotas du compte, que
   l'application ne porte pas (décision du 2026-09-12 : l'écran d'usage reste
   au greffon). Un import de plus, et le paquet Vite de l'application tirait
   Obsidian. Rien ici ne touche un hôte : `t()` et `hourOptions()` seulement, au rendu.

   `ai-usage.ts` réexporte tout ce fichier, ses appelants n'ont pas bougé.
══════════════════════════════════════════════════════════ */

/**
 * Une limite de forfait telle que le fournisseur la publie.
 *
 * `kind` porte le SENS de la ligne, jamais son libellé : traduire ici figerait
 * le texte dans la langue du moment de la lecture, alors que l'écran est
 * redessiné (et la langue peut changer) longtemps après. Le nom de modèle,
 * lui, est une donnée de l'API — il ne se traduit pas.
 */
export interface UsageRow {
	kind: "session" | "weekly-all" | "weekly-model" | "window";
	/** kind « weekly-model » : nom publié par l'API (« Fable », « Opus »). */
	modelName?: string;
	/** kind « window » (Codex) : durée de la fenêtre, mise en mots au rendu. */
	windowMinutes?: number;
	usedPercent: number;
	/** Fin de la fenêtre courante, en ms epoch ; null si le fournisseur ne la donne pas. */
	resetsAt: number | null;
}

/**
 * Pourquoi une lecture n'a rien rapporté.
 *
 * Sans cette distinction, TOUT échec (jeton absent, quota de lecture atteint,
 * réseau) retombe sur « aucune ligne » — que l'écran ne peut lire que comme
 * « ce fournisseur ne publie pas son forfait ». C'est faux, et c'est
 * exactement l'inverse de la règle de ce module : ce qu'on ne sait pas reste
 * absent, mais on ne raconte jamais à sa place.
 */
export type UsageReadError =
	/** L'endpoint d'usage limite lui-même la fréquence des lectures (429). */
	| { kind: "rate-limited"; retryAfterSec: number | null }
	/** Pas de session CLI exploitable (jeton absent, expiré, refusé). */
	| { kind: "unauthenticated" }
	/** Injoignable ou réponse inattendue. */
	| { kind: "unavailable" }
	/** Codex n'a jamais tourné sur cette machine : il n'y a pas de fichier de
	    session à lire. Distinct d'`unavailable` — il n'y a rien à réparer, et
	    « aucune session » n'est pas une panne. */
	| { kind: "jamais-lance" };

/** Résultat brut d'une lecture : des lignes, ou la raison de leur absence.
 *
 * `mesureAt` distingue l'instant de la LECTURE (quand on a interrogé la
 * source) de l'instant de la MESURE (ce que les chiffres décrivent
 * réellement). Pour Claude, une requête réseau, les deux coïncident. Pour
 * Codex, les chiffres viennent du dernier fichier de session écrit sur
 * disque — potentiellement vieux de plusieurs jours — et les confondre
 * afficherait « lu à l'instant » sur une mesure obsolète : une date fausse,
 * plus trompeuse qu'une date absente. `null` quand la source de l'instant
 * (le mtime du fichier) n'a pas pu être lue.
 */
export interface UsageRead {
	rows: UsageRow[];
	error: UsageReadError | null;
	mesureAt: number | null;
}

/** Fournisseurs dont le forfait est réellement lisible sur cette machine.
    Ailleurs (Ollama en local), il n'y a rien à consulter — et le
    dire est une information, pas un échec. */
export function providerPublishesPlan(provider: string): boolean {
	return provider === "claude-code" || provider === "codex";
}

/** État du forfait à un instant donné : ce qui remplit le modal d'usage. */
export interface PlanUsage {
	/** Forfait avec son palier (« Max (5x) »), pour le titre de l'écran.
	    null si le fournisseur ne le publie pas. */
	plan: string | null;
	/** Le même sans palier (« Max »), pour la PROSE : « inclus dans votre
	    forfait Max » — l'écran officiel n'y répète pas le multiplicateur. */
	planName: string | null;
	rows: UsageRow[];
	/** Instant de la LECTURE — « Dernière mise à jour : … » en dépend. */
	fetchedAt: number;
	/** null quand la lecture a abouti (même sans ligne à montrer). */
	error: UsageReadError | null;
}

/** Consommation d'UNE génération. */
export interface AiUsage {
	provider: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	/** Tokens d'entrée servis par le cache (sous-ensemble de inputTokens selon le fournisseur). */
	cachedInputTokens: number;
	/** Coût réel en dollars — `null` dès que le fournisseur ne le publie pas. */
	costUsd: number | null;
	durationMs: number;
	/** Identifiant de session du fournisseur, quand il sert à retrouver ses quotas. */
	sessionId?: string;
}

/** Entrée persistée de l'historique (usage + horodatage + volume produit). */
export interface AiUsageEntry extends AiUsage {
	at: number;
	questionCount: number;
}

export const totalTokens = (u: AiUsage): number => u.inputTokens + u.outputTokens;

/** « 12,4k » — un ordre de grandeur lisible d'un coup d'œil, pas une comptabilité. */
export function formatTokens(n: number): string {
	if (!Number.isFinite(n) || n <= 0) return "0";
	if (n < 1000) return String(Math.round(n));
	if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, "") + "k";
	return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
}

/** Coût en dollars ; `null` (fournisseur muet) n'est JAMAIS rendu comme « 0 $ ». */
export function formatCost(usd: number | null): string | null {
	if (usd == null || !Number.isFinite(usd)) return null;
	if (usd < 0.01) return "<$0.01";
	return "$" + usd.toFixed(usd < 1 ? 3 : 2);
}

export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "";
	if (ms < 1000) return Math.round(ms) + " ms";
	const s = ms / 1000;
	if (s < 60) return s.toFixed(s < 10 ? 1 : 0).replace(/\.0$/, "") + " s";
	const m = Math.floor(s / 60);
	return m + " min " + Math.round(s - m * 60) + " s";
}

/** Temps restant avant réarmement, à la minute près (« 4 h 31 min ») : c'est la
    précision de claude.ai, et arrondir à l'heure ferait mentir un compte à
    rebours qu'on regarde justement quand il touche à sa fin. */
export function formatCountdown(resetsAt: number | null, now: number): string | null {
	if (resetsAt == null) return null;
	const ms = resetsAt - now;
	if (ms <= 0) return null;
	const minutes = Math.floor(ms / 60000);
	const days = Math.floor(minutes / 1440);
	if (days >= 1) return t("ai.usage.durationDays", { n: days });
	const hours = Math.floor(minutes / 60);
	if (hours >= 1) return t("ai.usage.durationHoursMinutes", { h: hours, m: minutes - hours * 60 });
	return t("ai.usage.durationMinutes", { m: Math.max(1, minutes) });
}

/** Moment absolu du réarmement (« mer. 07:00 ») — ce que claude.ai affiche pour
    les fenêtres longues, où un « dans 5 j » ne dit pas quand on est débloqué.
    Formaté par Intl dans la langue de l'UI, pas par une table de jours maison. */
export function formatResetMoment(resetsAt: number | null, lang: string, weekday: "short" | "long" = "short"): string | null {
	if (resetsAt == null) return null;
	try {
		/* ARRONDI À LA MINUTE : l'API renvoie un instant à la seconde près, qui
		   dérive d'un appel à l'autre (…06:59:34 pour une fenêtre qui rouvre à
		   07:00). Tronquer afficherait « 06:59 » là où l'écran officiel dit
		   « 07:00 » — un décalage d'une minute qui se lit comme un bug. */
		const minute = Math.round(resetsAt / 60000) * 60000;
		// L'heure suit le réglage (24 h par défaut), pas la langue (`hourOptions`).
		return new Intl.DateTimeFormat(lang, {
			weekday, minute: "2-digit", ...hourOptions()
		}).format(new Date(minute));
	} catch {
		return null;
	}
}

/** « à l'instant » / « il y a 3 min » — fraîcheur de la lecture affichée. */
export function formatAge(fetchedAt: number, now: number): string {
	const minutes = Math.floor(Math.max(0, now - fetchedAt) / 60000);
	if (minutes < 1) return t("ai.usage.justNow");
	if (minutes < 60) return t("ai.usage.minutesAgo", { n: minutes });
	return t("ai.usage.hoursAgo", { n: Math.floor(minutes / 60) });
}

export interface UsageSummary {
	generations: number;
	inputTokens: number;
	outputTokens: number;
	costUsd: number | null;
	questions: number;
}

/** Cumul des entrées postérieures à `since` (epoch ms). */
export function summarize(log: AiUsageEntry[], since = 0): UsageSummary {
	const rows = log.filter(e => e && e.at >= since);
	// `costUsd` reste null tant qu'AUCUNE entrée n'a de coût : additionner des
	// zéros implicites ferait passer un forfait pour de la gratuité mesurée.
	const withCost = rows.filter(e => typeof e.costUsd === "number");
	return {
		generations: rows.length,
		inputTokens: rows.reduce((s, e) => s + (e.inputTokens || 0), 0),
		outputTokens: rows.reduce((s, e) => s + (e.outputTokens || 0), 0),
		costUsd: withCost.length ? withCost.reduce((s, e) => s + (e.costUsd || 0), 0) : null,
		questions: rows.reduce((s, e) => s + (e.questionCount || 0), 0)
	};
}

export const startOfToday = (now: number): number => {
	const d = new Date(now);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
};

/** Nom du forfait sous ses deux formes. Nom de produit : jamais traduit,
    jamais deviné — sans `subscriptionType`, pas de nom affiché du tout. */
export interface PlanName { label: string; name: string }

/** Libellé d'une ligne, traduit AU RENDU (le modèle, lui, vient de l'API). */
export function usageRowLabel(row: UsageRow): string {
	if (row.kind === "session") return t("ai.usage.sessionCurrent");
	if (row.kind === "weekly-all") return t("ai.usage.allModels");
	if (row.kind === "weekly-model") return row.modelName || t("ai.usage.allModels");
	const mins = row.windowMinutes || 0;
	if (mins >= 1440) return t("ai.usage.windowDays", { n: Math.round(mins / 1440) });
	if (mins > 0) return t("ai.usage.windowHours", { n: Math.max(1, Math.round(mins / 60)) });
	return t("ai.usage.windowPlan");
}

/** Résumé d'un coup d'œil pour le survol du bouton : la jauge la plus
    contrainte, celle qui décide s'il reste de la marge. */
export function tightestRow(rows: UsageRow[]): UsageRow | null {
	return rows.slice().sort((a, b) => b.usedPercent - a.usedPercent)[0] || null;
}

/* ── The always-visible status line under the composer ── */

/** Colour level of a window: accent, then orange from 75 %, red from 90 %. */
export type UsageLevel = "ok" | "warn" | "high";

export function usageLevel(percent: number): UsageLevel {
	if (!Number.isFinite(percent)) return "ok";
	if (percent >= 90) return "high";
	if (percent >= 75) return "warn";
	return "ok";
}

/** The windows the line shows: the session and the weekly "all models" window
    of Claude, the windows of Codex. Per-model weekly rows stay in the detail
    screen. Shortest window first. */
export function usageStatusRows(rows: UsageRow[]): UsageRow[] {
	const span = (r: UsageRow): number => r.kind === "session" ? 300 : r.kind === "weekly-all" ? 10080 : (r.windowMinutes || Number.MAX_SAFE_INTEGER);
	return rows
		.filter(r => r.kind === "session" || r.kind === "weekly-all" || r.kind === "window")
		.sort((a, b) => span(a) - span(b));
}

/** Short window label: "5h" / "7d" ("7j" in French), translated at render time. */
export function usageShortLabel(row: UsageRow): string {
	const mins = row.kind === "session" ? 300 : row.kind === "weekly-all" ? 10080 : (row.windowMinutes || 0);
	if (mins >= 1440) return t("ai.usage.shortDays", { n: Math.round(mins / 1440) });
	if (mins > 0) return t("ai.usage.shortHours", { n: Math.max(1, Math.round(mins / 60)) });
	return t("ai.usage.windowPlan");
}

/** Time left before the reset: a countdown within 24 h ("56 min"), the weekday
    and time beyond ("Wednesday 07:00", in the UI locale). null when unknown or past. */
export function usageResetText(resetsAt: number | null, now: number, lang: string): string | null {
	if (resetsAt == null || resetsAt <= now) return null;
	if (resetsAt - now >= 86400000) return formatResetMoment(resetsAt, lang, "long");
	return formatCountdown(resetsAt, now);
}

/* ── The popover opened from the status block ── */

/** Window title: "5-hour limit", "Weekly limit", "3-day limit". Claude's two
    windows have fixed spans; a Codex window is named after its duration. */
export function usageWindowTitle(row: UsageRow): string {
	const mins = row.kind === "session" ? 300 : row.kind === "weekly-all" ? 10080 : (row.windowMinutes || 0);
	if (mins === 10080) return t("ai.usage.limitWeekly");
	if (mins >= 1440) return t("ai.usage.limitDays", { n: Math.round(mins / 1440) });
	if (mins > 0) return t("ai.usage.limitHours", { n: Math.max(1, Math.round(mins / 60)) });
	return t("ai.usage.limitPlan");
}

/** Share left, clamped to 0..100 like the used share. */
export function usageRemainingPercent(usedPercent: number): number {
	const used = Number.isFinite(usedPercent) ? Math.max(0, Math.min(100, Math.round(usedPercent))) : 0;
	return 100 - used;
}

/** "3h 38m" within a day, "4d 11h" beyond (hours dropped when zero); null when unknown or past. */
export function usageResetIn(resetsAt: number | null, now: number): string | null {
	if (resetsAt == null || resetsAt <= now) return null;
	const minutes = Math.max(1, Math.floor((resetsAt - now) / 60000));
	const days = Math.floor(minutes / 1440);
	if (days >= 1) {
		const hours = Math.floor((minutes - days * 1440) / 60);
		return hours ? t("ai.usage.inDaysHours", { d: days, h: hours }) : t("ai.usage.inDays", { d: days });
	}
	const hours = Math.floor(minutes / 60);
	return hours ? t("ai.usage.inHoursMinutes", { h: hours, m: minutes - hours * 60 }) : t("ai.usage.inMinutes", { m: minutes });
}

/** A wait in words: seconds under a minute ("18 s"), else whole minutes rounded up ("1 min"). */
export function usageWaitText(ms: number): string {
	const s = Math.max(1, Math.ceil(ms / 1000));
	if (s < 60) return t("ai.usage.seconds", { n: s });
	return t("ai.usage.durationMinutes", { m: Math.ceil(s / 60) });
}
