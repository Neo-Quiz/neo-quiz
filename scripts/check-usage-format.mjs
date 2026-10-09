/**
 * Non-regression of the plan status line formats (src/dashboard/usage-format.ts):
 * colour level by threshold, which windows the line shows and in which order,
 * and the time left before the reset (countdown within 24 h, weekday beyond).
 *
 *     npm run check:usage-format
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/dashboard/usage-format.ts", "src/dashboard/usage-cadence.ts", "src/dashboard/codex-resets.ts"], ({ usageLevel, usageStatusRows, usageResetText, usageWindowTitle, usageRemainingPercent, usageResetIn, usageWaitText }, { newCadence, cadenceVerdict, cadenceSuccess, cadenceRateLimited }, { parseResetCredits, parseConsumeOutcome, readResetsRequest, isCreditId, spendable }) => {
	const r = makeReporter("Usage line formats");

	r.check("0 % : ok", usageLevel(0), "ok");
	r.check("74 % : ok", usageLevel(74), "ok");
	r.check("75 % : warn", usageLevel(75), "warn");
	r.check("89 % : warn", usageLevel(89), "warn");
	r.check("90 % : high", usageLevel(90), "high");
	r.check("100 % : high", usageLevel(100), "high");
	r.check("NaN : ok", usageLevel(Number.NaN), "ok");

	const session = { kind: "session", usedPercent: 40, resetsAt: null };
	const week = { kind: "weekly-all", usedPercent: 52, resetsAt: null };
	const model = { kind: "weekly-model", modelName: "Opus", usedPercent: 10, resetsAt: null };
	r.check("claude : session puis semaine, sans ligne par modèle",
		usageStatusRows([model, week, session]).map(x => x.kind), ["session", "weekly-all"]);
	const w5 = { kind: "window", windowMinutes: 300, usedPercent: 1, resetsAt: null };
	const w7 = { kind: "window", windowMinutes: 10080, usedPercent: 2, resetsAt: null };
	r.check("codex : fenêtres de la plus courte à la plus longue",
		usageStatusRows([w7, w5]).map(x => x.windowMinutes), [300, 10080]);
	r.check("aucune ligne", usageStatusRows([]), []);

	const now = Date.UTC(2026, 9, 9, 10, 0, 0);
	r.check("remise à zéro passée : rien", usageResetText(now - 1, now, "en"), null);
	r.check("inconnue : rien", usageResetText(null, now, "en"), null);
	r.check("dans 56 min", usageResetText(now + 56 * 60000, now, "en"), "56 min");
	r.check("dans 1 h 30", usageResetText(now + 90 * 60000, now, "en"), "1 h 30 min");
	r.check("juste sous 24 h : compte à rebours", /^23 h/.test(usageResetText(now + 86399000, now, "en") || ""), true);
	const far = usageResetText(now + 3 * 86400000, now, "en") || "";
	r.check("au-delà de 24 h : jour de la semaine en toutes lettres", /^[A-Z][a-z]{5,8}/.test(far), true);
	r.check("au-delà de 24 h : heure présente", /\d{2}:\d{2}|\d{1,2}:\d{2}/.test(far), true);

	r.check("title: session", usageWindowTitle(session), "5-hour limit");
	r.check("title: weekly", usageWindowTitle(week), "Weekly limit");
	r.check("title: codex 5 h", usageWindowTitle(w5), "5-hour limit");
	r.check("title: codex 7 d", usageWindowTitle(w7), "Weekly limit");
	r.check("title: codex 3 d", usageWindowTitle({ kind: "window", windowMinutes: 4320, usedPercent: 0, resetsAt: null }), "3-day limit");
	r.check("remaining 4 -> 96", usageRemainingPercent(4), 96);
	r.check("remaining clamps over 100", usageRemainingPercent(130), 0);
	r.check("remaining NaN -> 100", usageRemainingPercent(Number.NaN), 100);
	r.check("resets in 3h 38m", usageResetIn(now + (3 * 60 + 38) * 60000, now), "3h 38m");
	r.check("resets in 4d 11h", usageResetIn(now + (4 * 24 + 11) * 3600000 + 600000, now), "4d 11h");
	r.check("resets in exact days", usageResetIn(now + 2 * 86400000, now), "2d");
	r.check("resets in 45m", usageResetIn(now + 45 * 60000, now), "45m");
	r.check("resets past: null", usageResetIn(now - 1, now), null);

	r.check("wait 18 s", usageWaitText(18000), "18 s");
	r.check("wait 60 s -> 1 min", usageWaitText(60000), "1 min");
	r.check("wait 61 s rounds up", usageWaitText(61000), "2 min");

	// Read cadence, simulated clock (one shared state per provider).
	const T = 1_000_000;
	const c = newCadence();
	r.check("cadence: first read allowed", cadenceVerdict(c, T).ok, true);
	cadenceSuccess(c, T);
	const g = cadenceVerdict(c, T + 12000);
	r.check("cadence: 12 s after a read is refused", g.ok === false && g.reason === "gap" && g.waitMs === 18000, true);
	r.check("cadence: 29.9 s refused", cadenceVerdict(c, T + 29900).ok, false);
	r.check("cadence: 30 s allowed", cadenceVerdict(c, T + 30000).ok, true);
	// Shared clock: a second holder of the SAME state sees the first one's read.
	const shared = c;
	r.check("cadence: shared clock refuses the other block", cadenceVerdict(shared, T + 5000).ok, false);
	// 429 without header: 60 s, 2, 4, 8 min, cap 15 min.
	const b = newCadence();
	const waits = [];
	for (let i = 0; i < 7; i++) { cadenceRateLimited(b, T, null); const v = cadenceVerdict(b, T); waits.push(v.ok ? 0 : v.waitMs / 60000); }
	r.check("cadence: back-off 1, 2, 4, 8, 15, 15", waits.slice(0, 6), [1, 2, 4, 8, 15, 15]);
	r.check("cadence: no read during back-off", cadenceVerdict(b, T + 14 * 60000).ok, false);
	r.check("cadence: read after back-off", cadenceVerdict(b, T + 15 * 60000).ok, true);
	// Retry-After wins over the back-off, and is capped.
	const h = newCadence();
	cadenceRateLimited(h, T, 281);
	const hv = cadenceVerdict(h, T);
	r.check("cadence: Retry-After 281 s used", hv.ok === false && hv.waitMs === 281000, true);
	cadenceRateLimited(h, T, 99999);
	const hv2 = cadenceVerdict(h, T);
	r.check("cadence: Retry-After capped at 15 min", hv2.ok === false && hv2.waitMs === 900000, true);
	// A success resets the back-off.
	cadenceSuccess(b, T + 15 * 60000);
	cadenceRateLimited(b, T + 16 * 60000, null);
	const rv = cadenceVerdict(b, T + 16 * 60000);
	r.check("cadence: success resets the back-off to 60 s", rv.ok === false && rv.waitMs === 60000, true);

	// Codex banked resets: the pure parser and the request judge (simulated JSON-RPC results).
	const server = {
		rateLimitResetCredits: {
			availableCount: 2,
			credits: [
				{ id: "c-1", resetType: "codexRateLimits", status: "available", expiresAt: 1795000000, title: "Full reset (Weekly + 5 hr)", description: "<b>x</b> Thanks!" },
				{ id: "c-2", status: "redeemed", expires_at: "2026-12-01T00:00:00Z" },
				{ id: "bad id with spaces", status: "available" },
				{ status: "available" },
				"junk",
			],
		},
	};
	const parsed = parseResetCredits(server);
	r.check("resets: count and the credits with a usable id (junk and bad ids dropped)", [parsed.availableCount, parsed.credits.map(c => c.id)], [2, ["c-1", "c-2"]]);
	r.check("resets: title and description come from the server as plain strings", [parsed.credits[0].title, parsed.credits[0].description], ["Full reset (Weekly + 5 hr)", "<b>x</b> Thanks!"]);
	r.check("resets: seconds, ISO strings and the snake_case key all read as epoch ms", [parsed.credits[0].expiresAt, parsed.credits[1].expiresAt], [1795000000000, Date.parse("2026-12-01T00:00:00Z")]);
	r.check("resets: only the available credits are spendable", spendable(parsed).map(c => c.id), ["c-1"]);
	r.check("resets: the snake_case container and count are read", parseResetCredits({ rate_limit_reset_credits: { available_count: 3 } }), { availableCount: 3, credits: [] });
	r.check("resets: a result without the field is null (older Codex)", [parseResetCredits({ rateLimits: {} }), parseResetCredits(null), parseResetCredits("x"), parseResetCredits({ rateLimitResetCredits: { availableCount: "2" } })], [null, null, null, null]);
	r.check("resets: a negative or huge count is clamped", [parseResetCredits({ rateLimitResetCredits: { availableCount: -4 } }).availableCount, parseResetCredits({ rateLimitResetCredits: { availableCount: 1e9 } }).availableCount], [0, 999]);
	r.check("resets: the four outcomes read, anything else is null",
		["reset", "nothingToReset", "noCredit", "alreadyRedeemed", "RESET", "ok", 1, null].map(o => parseConsumeOutcome({ outcome: o })), ["reset", "nothingToReset", "noCredit", "alreadyRedeemed", null, null, null, null]);
	r.check("resets: no outcome at all is null", [parseConsumeOutcome({}), parseConsumeOutcome(null)], [null, null]);
	r.check("resets: the request judge accepts exactly read and consume+id",
		[readResetsRequest({ action: "read" }), readResetsRequest({ action: "consume", creditId: "c-1" })], [{ action: "read" }, { action: "consume", creditId: "c-1" }]);
	r.check("resets: the request judge refuses extra keys, bad ids, other actions",
		[{ action: "read", x: 1 }, { action: "consume", creditId: "c 1" }, { action: "consume", creditId: "c-1", method: "m" }, { action: "exec" }, [], null].map(readResetsRequest), [null, null, null, null, null, null]);
	r.check("resets: a credit id is short and id-shaped", ["a", "A1._:-x", "x".repeat(128)].map(isCreditId).concat(["", "-a", "a b", "x".repeat(129), "a/b"].map(isCreditId)), [true, true, true, false, false, false, false, false]);

	r.done();
});
