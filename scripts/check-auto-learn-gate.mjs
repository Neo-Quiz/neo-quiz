/**
 * The automatic Learn gate (`src/dashboard/auto-learn-gate.ts`).
 * What it prevents: a generation that overspends the owner's quota, a stale
 * or failed usage reading taken as 0 %, a damaged stored setting guessed.
 *     npm run check:auto-learn-gate
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/auto-learn-gate.ts", (G) => {
	const r = makeReporter("Automatic Learn gate");
	const D = G.autoLearnDefaults();
	r.check("defaults: auto, 80 %, 90 %, 6 a day, all on", D, { mode: "auto", session: { on: true, value: 80 }, weekly: { on: true, value: 90 }, daily: { on: true, value: 6 } });
	r.check("a stored value is read field by field", G.readAutoLearnSettings({ mode: "propose", session: { on: false, value: 50 }, weekly: { on: true, value: 70 }, daily: { on: true, value: 3 } }),
		{ mode: "propose", session: { on: false, value: 50 }, weekly: { on: true, value: 70 }, daily: { on: true, value: 3 } });
	for (const [n, v] of [["null", null], ["a string", "auto"], ["an array", []], ["unknown mode", { mode: "always" }]]) r.check("damaged (" + n + "): defaults", G.readAutoLearnSettings(v), D);
	r.check("out of range or not integers fall back per field", G.readAutoLearnSettings({ mode: "off", session: { on: true, value: 0 }, weekly: { on: "yes", value: 101 }, daily: { on: false, value: 51 } }),
		{ mode: "off", session: { on: true, value: 80 }, weekly: { on: true, value: 90 }, daily: { on: false, value: 6 } });
	r.check("NaN, a string number, a fraction fall back", [G.readAutoLearnSettings({ session: { on: true, value: NaN } }).session.value, G.readAutoLearnSettings({ session: { on: true, value: "50" } }).session.value, G.readAutoLearnSettings({ daily: { on: true, value: 2.5 } }).daily.value], [80, 80, 6]);

	const now = new Date(2026, 9, 16, 14, 0).getTime();
	const reset5h = now + 3600_000, resetWeek = now + 3 * 86400_000;
	const claude = (s, w) => ({ rows: [{ kind: "session", usedPercent: s, resetsAt: reset5h }, { kind: "weekly-all", usedPercent: w, resetsAt: resetWeek }], at: now - 60_000 });
	const go = (o) => G.decideGate({ settings: D, provider: "claude-code", trusted: true, usage: claude(10, 10), startsToday: 0, now, ...o });
	r.check("under every rule: go", go({}), { go: true });
	r.check("5-hour at 86 %: blocked until its reset", go({ usage: claude(86, 10) }), { go: false, block: { kind: "session", percent: 86 }, retryAt: reset5h });
	r.check("exactly 80 % is not above 80 %", go({ usage: claude(80, 10) }), { go: true });
	r.check("weekly at 95 %: blocked until its reset", go({ usage: claude(10, 95) }), { go: false, block: { kind: "weekly", percent: 95 }, retryAt: resetWeek });
	r.check("both: the one that retries last", go({ usage: claude(99, 95) }).block.kind, "weekly");
	r.check("a rule off is never judged", G.decideGate({ settings: { ...D, session: { on: false, value: 80 } }, provider: "claude-code", trusted: true, usage: claude(100, 10), startsToday: 0, now }), { go: true });
	r.check("a reading 6 minutes old is unknown: retry in 15 minutes", go({ usage: { ...claude(10, 10), at: now - 6 * 60_000 } }), { go: false, block: { kind: "unknown" }, retryAt: now + 15 * 60_000 });
	r.check("no reading at all: unknown, never 0 %", go({ usage: null }).block, { kind: "unknown" });
	r.check("a reading with no row: unknown", go({ usage: { rows: [], at: now } }).block, { kind: "unknown" });
	r.check("a missing window is not judged when the reading has rows", go({ usage: { rows: [{ kind: "session", usedPercent: 10, resetsAt: reset5h }], at: now } }), { go: true });
	r.check("a full window without a reset time retries in 15 minutes", go({ usage: { rows: [{ kind: "session", usedPercent: 90, resetsAt: null }], at: now } }).retryAt, now + 15 * 60_000);
	const codex = { rows: [{ kind: "window", windowMinutes: 300, usedPercent: 85, resetsAt: reset5h }, { kind: "window", windowMinutes: 10080, usedPercent: 20, resetsAt: resetWeek }], at: now };
	r.check("Codex windows: 300 min is the 5-hour, 10080 the week", [G.windowUsage(codex.rows, "session"), G.windowUsage(codex.rows, "weekly")], [{ percent: 85, resetsAt: reset5h }, { percent: 20, resetsAt: resetWeek }]);
	r.check("Ollama: no usage needed, quota rules not applied", G.decideGate({ settings: D, provider: "ollama", trusted: true, usage: null, startsToday: 0, now }), { go: true });
	r.check("quota applies to Claude Code and Codex only", ["claude-code", "codex", "ollama", "antigravity-cli", ""].map(G.quotaApplies), [true, true, false, false, false]);
	r.check("6 starts today: blocked until the next local midnight", go({ startsToday: 6 }), { go: false, block: { kind: "daily", count: 6 }, retryAt: new Date(2026, 9, 17).getTime() });
	r.check("5 starts today: go", go({ startsToday: 5 }), { go: true });
	r.check("the next midnight from 23:59 and from 00:00", [G.nextLocalMidnight(new Date(2026, 9, 16, 23, 59).getTime()), G.nextLocalMidnight(new Date(2026, 9, 17, 0, 0).getTime())], [new Date(2026, 9, 17).getTime(), new Date(2026, 9, 18).getTime()]);
	r.check("an untrusted folder waits for the user (no retry time)", go({ trusted: false }), { go: false, block: { kind: "untrusted" }, retryAt: null });
	r.check("a stored block is read back; anything else is dropped", [G.readGateBlock({ kind: "session", percent: 86 }), G.readGateBlock({ kind: "daily", count: 6 }), G.readGateBlock({ kind: "untrusted" }), G.readGateBlock({ kind: "session", percent: "86" }), G.readGateBlock({ kind: "x" }), G.readGateBlock(null)],
		[{ kind: "session", percent: 86 }, { kind: "daily", count: 6 }, { kind: "untrusted" }, undefined, undefined, undefined]);
	r.done();
});
