/**
 * THE BUG REPORT FORMAT (`src/bug-report.ts`): shared by the app and the relay.
 * Prevents: an oversized or malformed report accepted, user text that pings
 * people or injects HTML into a public issue, a log that breaks out of its
 * fence, and a log that leaks a user name, a token or a device ID.
 *     npm run check:bug-report
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/bug-report.ts"], (BR) => {
	const r = makeReporter("Bug report");
	const ok = (raw) => BR.validateReport(raw).ok;
	const rep = (o) => BR.validateReport(o);

	r.check("validate: accepts a minimal report", ok({ v: 1, what: "x" }), true);
	r.check("validate: refuses unknown field", ok({ v: 1, what: "x", extra: 1 }), false);
	r.check("validate: refuses __proto__ key", ok(JSON.parse('{"v":1,"what":"x","__proto__":{"a":1}}')), false);
	r.check("validate: refuses other v", [ok({ v: 2, what: "x" }), ok({ what: "x" })], [false, false]);
	r.check("validate: refuses empty or blank what", [ok({ v: 1, what: "" }), ok({ v: 1, what: "  \n" }), ok({ v: 1 })], [false, false, false]);
	r.check("validate: refuses non-string fields", [ok({ v: 1, what: 1 }), ok({ v: 1, what: "x", steps: 2 }), ok({ v: 1, what: "x", log: {} })], [false, false, false]);
	r.check("validate: refuses non-object bodies", [ok([]), ok(null), ok("x"), ok(3)], [false, false, false, false]);

	const L = BR.LIMITS;
	r.check("validate: caps", [
		ok({ v: 1, what: "a".repeat(4000) }), ok({ v: 1, what: "a".repeat(4001) }),
		ok({ v: 1, what: "x", steps: "a".repeat(2000) }), ok({ v: 1, what: "x", steps: "a".repeat(2001) }),
		ok({ v: 1, what: "x", expected: "a".repeat(2000) }), ok({ v: 1, what: "x", expected: "a".repeat(2001) }),
		ok({ v: 1, what: "x", log: "a".repeat(8000) }), ok({ v: 1, what: "x", log: "a".repeat(8001) }),
	], [true, false, true, false, true, false, true, false]);
	const big = { v: 1, title: "t".repeat(80), what: "a".repeat(4000), steps: "b".repeat(2000), expected: "c".repeat(2000), log: "d".repeat(8000), env: { app: "e".repeat(100), os: "f".repeat(100), platform: "windows" }, githubToken: "g".repeat(255) };
	r.check("validate: the full-size body fits the fields", JSON.stringify(big).length > L.body, true);
	r.check("validate: a body over 16384 is refused though each field fits", ok(big), false);
	r.check("validate: strips control characters", rep({ v: 1, what: "a\u0000b\u001b[31mc\u007f\nd\te" }).report?.what, "ab[31mc\nd\te");
	r.check("validate: returns a fresh object", (() => { const raw = { v: 1, what: "x" }; return rep(raw).report !== raw; })(), true);
	r.check("validate: env must be well formed", [ok({ v: 1, what: "x", env: { app: "1", os: "w", platform: "windows" } }), ok({ v: 1, what: "x", env: { app: "1", os: "w", platform: "linux" } }), ok({ v: 1, what: "x", env: { app: "1", os: "w", platform: "android", z: 1 } })], [true, false, false]);

	const n = BR.neutralise("@everyone @org/team @a <img src=x onerror=1>");
	r.check("neutralise: no @ before a letter", /@[A-Za-z]/.test(n), false);
	r.check("neutralise: no <", n.includes("<"), false);

	const bad = "before\n```\n</details>\n````\nafter";
	const iss = BR.buildIssue({ v: 1, what: "w", log: bad }).body;
	r.check("buildIssue: fence breakout keeps one details pair", [iss.split("<details>").length - 1, iss.split("</details>").length - 1], [1, 1]);
	const m = /<summary>Log<\/summary>\n\n(`+)\n[\s\S]*\n\1\n\n<\/details>/.exec(iss);
	r.check("buildIssue: the log stays in one fence longer than any run inside it", [m !== null, (m?.[1].length ?? 0) > 4], [true, true]);

	const full = BR.buildIssue({ v: 1, what: "It broke", steps: "s1", expected: "e1", env: { app: "1.2.3", os: "Win 11", platform: "windows" }, log: "l" }).body;
	r.check("buildIssue: skeleton headings", ["### Steps to reproduce", "### Expected", "### Environment"].map(h => full.includes(h)), [true, true, true]);
	r.check("buildIssue: final line", full.trimEnd().split("\n").pop(), "_Sent from the Neo Quiz app._");
	const min = BR.buildIssue({ v: 1, what: "It broke" }).body;
	r.check("buildIssue: no empty headings", [min.includes("###"), min.includes("<details>")], [false, false]);

	r.check("buildIssue: title", [
		BR.buildIssue({ v: 1, what: "x" }, {}).title,
		BR.buildIssue({ v: 1, what: "first line\nsecond" }).title,
		BR.buildIssue({ v: 1, what: "a".repeat(200) }).title.length,
		BR.buildIssue({ v: 1, what: "x", title: "Mine" }).title,
		BR.buildIssue({ v: 1, what: "\n\nx" }).title.length > 0,
	], ["x", "first line", 80, "Mine", true]);
	r.check("buildIssue: title fallback", BR.buildIssue({ v: 1, what: " \n " }).title, "Bug report");
	r.check("buildIssue: reportedBy", [
		BR.buildIssue({ v: 1, what: "w" }, { reportedBy: "bad name" }).body.includes("Reported by"),
		BR.buildIssue({ v: 1, what: "w" }, { reportedBy: "octo-cat" }).body.split("\n")[0],
	], [false, "Reported by @octo-cat"]);

	const S = BR.scrubLog;
	const paths = ["C:\\Users\\Ahmed\\AppData\\x", "C:\\Users\\Ahmed\\OneDrive\\x", "\\\\srv\\share\\Ahmed\\x", "/Users/Ahmed/x", "/home/Ahmed/x", "C:/Users/Ahmed/x"];
	r.check("scrubLog: paths", paths.map(p => S("open " + p + " failed").includes("Ahmed")), paths.map(() => false));
	const gh = "ghp_" + "A1b2".repeat(9);
	const hex = "0123456789abcdef0123456789ABCDEF";
	const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz";
	const dev = "ABCDEFG-HIJKLMN-OPQRSTU-VWXYZ23-4567ABC-DEFGHIJ-KLMNOPQ-RSTUVWX";
	const leaks = [["a.b@example.com", "example.com"], [gh, gh], ["github_pat_" + "Z9y8".repeat(10), "Z9y8Z9y8"], ["Authorization: Bearer abc.def", "abc.def"], [hex, hex], [jwt, "eyJhbGci"], ["x".repeat(10) + "AbCdEf0123456789".repeat(3), "AbCdEf0123456789AbCdEf"], ["password=hunter2", "hunter2"]];
	r.check("scrubLog: secrets removed", leaks.map(([s, needle]) => S("v " + s + " w").includes(needle)), leaks.map(() => false));
	r.check("scrubLog: query token redacted, rest kept", S("GET https://x/y?token=abc123&a=1 ok"), "GET https://x/y?token=<redacted>&a=1 ok");
	r.check("scrubLog: Syncthing ID cut to 7 chars", S("dev " + dev + " up"), "dev ABCDEFG up");

	const lines = Array.from({ length: 500 }, (_, i) => "line" + i).join("\n");
	const cut = S(lines).split("\n");
	r.check("scrubLog: last 200 lines", [cut.length, cut[0], cut[199]], [200, "line300", "line499"]);
	r.check("scrubLog: lines cut to 500", S("a ".repeat(1000)).length, 500);
	r.check("scrubLog: total at most 8000", S(Array.from({ length: 100 }, () => "word ".repeat(100)).join("\n")).length <= 8000, true);
	const mix = "C:\\Users\\Ahmed\\x a@b.co " + gh + " token=zzz\n" + dev;
	r.check("scrubLog: idempotent", S(S(mix)), S(mix));
	r.check("scrubLog: ordinary text unchanged", S("Started 12:00\nOpened quiz 'Lists' in 35 ms"), "Started 12:00\nOpened quiz 'Lists' in 35 ms");

	// Fix round 1.
	const esc = ["C:\\\\Users\\\\Ahmed\\\\x", "\\\\\\\\srv\\\\share\\\\Ahmed\\\\x", "C:\\Users\\John Smith\\x", "/mnt/c/Users/Ahmed/x"];
	r.check("scrubLog: doubled-backslash, spaced and /mnt paths hide the name", esc.map(p => /Ahmed|John|Smith/.test(S("at " + p))), esc.map(() => false));
	r.check("scrubLog: spaced name leaves the rest of the path", S("C:\\Users\\John Smith\\x"), "%USERPROFILE%\\x");
	const jsonSecrets = ['{"token":"abc123"}', '{"password": "hunter2"}', '{"secret":"s3","a":1}', '{"key":"k9"}', "secret=s3", "x?sig=abc", "Authorization: Basic dXNlcjpwYXNz"];
	r.check("scrubLog: JSON-form and other secrets", jsonSecrets.map(x => /abc|hunter2|s3|k9|dXNl/.test(S(x))), jsonSecrets.map(() => false));
	r.check("scrubLog: Bearer does not swallow the next line", S("Bearer abc\nnext line"), "Bearer <redacted>\nnext line");
	r.check("scrubLog: long input keeps the tail and finishes", S("x ".repeat(500000) + "\nend").endsWith("\nend"), true);
	r.check("scrubLog: no split surrogate pair", /[\ud800-\udbff]$/.test(S("\ud83d\ude00".repeat(300))), false);

	const t = (title) => BR.buildIssue({ v: 1, what: "w", title }).title;
	r.check("title: neutralised then cut to 80", [t("<".repeat(100)).length <= 80, t("@".repeat(100)).length <= 80, /&l?t?$/.test(t("a".repeat(79) + "<"))], [true, true, false]);
	r.check("title: newlines collapse", t("a\nb\r\nc"), "a b c");
	r.check("title: no raw < or bare @name", [t("<b>x").includes("<"), /@[A-Za-z]/.test(t("@everyone hi"))], [false, false]);

	r.check("validate: env newline refused", [ok({ v: 1, what: "x", env: { app: "1\n# h", os: "w", platform: "windows" } }), ok({ v: 1, what: "x", env: { app: "1", os: "w\nx", platform: "windows" } })], [false, false]);
	r.check("validate: strips C1, bidi and separators", rep({ v: 1, what: "a\u0085b\u202ec\u2066d\u2028e\u2029f\ng" }).report?.what, "abcdef\ng");
	r.check("neutralise: zero-width space is U+200B", BR.neutralise("@a"), "@\u200ba");

	r.done();
});

await withSrcModule(["src/bug-report-config.ts"], (CFG) => {
	const r = makeReporter("Bug report config");
	r.check("config: not configured while a constant is empty", CFG.bugReportConfigured(), false);
	r.done();
});
