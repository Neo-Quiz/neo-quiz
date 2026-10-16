import type { UsageRow } from "./usage-format";
import { providerPublishesPlan } from "./usage-format";
import type { GateBlock } from "./gate-block";
export type { GateBlock } from "./gate-block";
export { readGateBlock } from "./gate-block";

/* The pure gate of the automatic Learn (spec 2026-10-15-moodle-auto-learn):
   given the owner's rules, the provider, the trust of the folder and the usage
   reading, decide whether a generation may start now, and if not, why and when
   to look again. No clock, no DOM, no host: `now` is an input.
   Rulings: "above N %" is strictly greater; a reading older than 5 minutes
   (after the caller tried to refresh it) is "unknown", never 0 %; a reading
   that has rows but lacks the window of an enabled rule does not judge that
   rule (the provider does not publish it), whereas a reading with no row at
   all is "unknown"; quota rules apply only to providers that publish a plan,
   the daily cap to all; with several blocks, the one that retries LAST wins. */

export type AutoLearnMode = "off" | "propose" | "auto";
export interface AutoLearnRule { on: boolean; value: number }
export interface AutoLearnSettings { mode: AutoLearnMode; session: AutoLearnRule; weekly: AutoLearnRule; daily: AutoLearnRule }
export interface UsageSnapshot { rows: readonly UsageRow[]; at: number }
export type GateVerdict = { go: true } | { go: false; block: GateBlock; retryAt: number | null };

export const AUTO_LEARN_LIMITS = { session: [1, 100], weekly: [1, 100], daily: [1, 50] } as const;
export const USAGE_MAX_AGE_MS = 5 * 60_000;
export const UNKNOWN_RETRY_MS = 15 * 60_000;

export function autoLearnDefaults(): AutoLearnSettings {
	return { mode: "auto", session: { on: true, value: 80 }, weekly: { on: true, value: 90 }, daily: { on: true, value: 6 } };
}
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
function readRule(v: unknown, d: AutoLearnRule, [min, max]: readonly [number, number]): AutoLearnRule {
	const o = isObj(v) ? v : {};
	const value = typeof o.value === "number" && Number.isInteger(o.value) && o.value >= min && o.value <= max ? o.value : d.value;
	return { on: typeof o.on === "boolean" ? o.on : d.on, value };
}
/** A stored value is never trusted as typed: each field falls back to its default on its own. */
export function readAutoLearnSettings(v: unknown): AutoLearnSettings {
	const d = autoLearnDefaults();
	if (!isObj(v)) return d;
	const mode = v.mode === "off" || v.mode === "propose" || v.mode === "auto" ? v.mode : d.mode;
	return { mode, session: readRule(v.session, d.session, AUTO_LEARN_LIMITS.session), weekly: readRule(v.weekly, d.weekly, AUTO_LEARN_LIMITS.weekly), daily: readRule(v.daily, d.daily, AUTO_LEARN_LIMITS.daily) };
}
export const quotaApplies = (provider: string): boolean => providerPublishesPlan(provider);
export function windowUsage(rows: readonly UsageRow[], which: "session" | "weekly"): { percent: number; resetsAt: number | null } | null {
	const match = rows.filter(r => which === "session"
		? r.kind === "session" || (r.kind === "window" && (r.windowMinutes ?? 0) > 0 && (r.windowMinutes ?? 0) <= 600)
		: r.kind === "weekly-all" || r.kind === "weekly-model" || (r.kind === "window" && (r.windowMinutes ?? 0) >= 1440));
	if (!match.length) return null;
	const top = match.reduce((a, b) => (b.usedPercent > a.usedPercent || (b.usedPercent === a.usedPercent && (b.resetsAt ?? 0) > (a.resetsAt ?? 0)) ? b : a));
	return { percent: top.usedPercent, resetsAt: top.resetsAt };
}
export function nextLocalMidnight(now: number): number {
	const d = new Date(now);
	d.setHours(24, 0, 0, 0);
	return d.getTime();
}
export function decideGate(i: { settings: AutoLearnSettings; provider: string; trusted: boolean; usage: UsageSnapshot | null; startsToday: number; now: number }): GateVerdict {
	const { settings: s, now } = i;
	if (!i.trusted) return { go: false, block: { kind: "untrusted" }, retryAt: null };
	const blocks: { block: GateBlock; retryAt: number }[] = [];
	if (s.daily.on && i.startsToday >= s.daily.value) blocks.push({ block: { kind: "daily", count: i.startsToday }, retryAt: nextLocalMidnight(now) });
	if (quotaApplies(i.provider) && (s.session.on || s.weekly.on)) {
		const u = i.usage;
		if (!u || !u.rows.length || !Number.isFinite(u.at) || now - u.at > USAGE_MAX_AGE_MS) blocks.push({ block: { kind: "unknown" }, retryAt: now + UNKNOWN_RETRY_MS });
		else for (const which of ["session", "weekly"] as const) {
			const rule = s[which];
			const w = rule.on ? windowUsage(u.rows, which) : null;
			if (w && w.percent > rule.value) blocks.push({ block: { kind: which, percent: Math.round(w.percent) }, retryAt: w.resetsAt !== null && w.resetsAt > now ? w.resetsAt : now + UNKNOWN_RETRY_MS });
		}
	}
	if (!blocks.length) return { go: true };
	const last = blocks.reduce((a, b) => (b.retryAt > a.retryAt ? b : a));
	return { go: false, block: last.block, retryAt: last.retryAt };
}
