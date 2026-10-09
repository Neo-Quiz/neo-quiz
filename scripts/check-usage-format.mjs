/**
 * Non-regression of the plan status line formats (src/dashboard/usage-format.ts):
 * colour level by threshold, which windows the line shows and in which order,
 * and the time left before the reset (countdown within 24 h, weekday beyond).
 *
 *     npm run check:usage-format
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/usage-format.ts", ({ usageLevel, usageStatusRows, usageResetText }) => {
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

	r.done();
});
