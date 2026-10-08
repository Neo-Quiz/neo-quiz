/**
 * The native notification channel's rules (`electron/notification.ts`): the
 * window supplies two strings and nothing else (no icon path, no URL, no
 * action, no sound). Prevents: a compromised page flooding the desktop, or
 * smuggling control characters / huge text into a system notification.
 *     npm run check:electron-notification
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/electron/notification.ts", (N) => {
	const r = makeReporter("Electron notification");
	r.check("plain strings pass", N.cleanNotification("Request from Pixel", "Make a quiz"), { title: "Request from Pixel", body: "Make a quiz" });
	r.check("control characters become spaces, then trimmed", N.cleanNotification("a\u0000b\nc", "x\ty"), { title: "a b c", body: "x y" });
	r.check("title and body are cut to their bounds", [N.cleanNotification("t".repeat(500), "b".repeat(900)).title.length, N.cleanNotification("t".repeat(500), "b".repeat(900)).body.length], [80, 200]);
	for (const [n, t, b] of [["number title", 3, "x"], ["object body", "x", {}], ["blank title", "  ", "x"], ["null", null, null]]) {
		r.check("refused: " + n, N.cleanNotification(t, b), null);
	}
	r.check("a blank body is allowed", N.cleanNotification("T", "")?.body, "");
	let t = 1_000_000; const g = N.createNotificationGate(() => t);
	r.check("first call allowed", g.allow(), true);
	r.check("a second call within 2 s is refused", g.allow(), false);
	t += 2_000; r.check("after 2 s allowed again", g.allow(), true);
	const h = N.createNotificationGate(() => t);
	let allowed = 0; for (let i = 0; i < 100; i++) { t += 2_000; if (h.allow()) allowed++; }
	r.check("at most 30 per hour", allowed, 30);
	t += 3_600_000; r.check("the hour passes: allowed again", h.allow(), true);
	r.check("invisible and bidi characters are removed", N.cleanNotification("a\u200bb\u202ec\u2066d\ufeffe", "x\u200fy")?.title, "abcde");
	r.check("C1 controls become spaces", N.cleanNotification("a\u0085b", "")?.title, "a b");
	r.check("a surrogate pair is not cut at the bound", N.cleanNotification("a".repeat(79) + "\u{1F600}", "")?.title, "a".repeat(79) + "\u{1F600}");
	const t0 = Date.now(); const big = N.cleanNotification("x".repeat(10_000_000), "y".repeat(10_000_000));
	r.check("a 10 MB input is cut quickly", [big.title.length, big.body.length, Date.now() - t0 < 200], [80, 200, true]);
	r.check("the raw input is cut before cleaning (4 x the bound)", N.cleanNotification(" ".repeat(1_000_000) + "abc", ""), null);
	let u = 5_000_000; const g2 = N.createNotificationGate(() => u);
	r.check("prepare passes when allowed", N.prepareNotification(g2, "T", "b"), { title: "T", body: "b" });
	r.check("prepare refuses over the rate; a refused call consumed the gate first", [N.prepareNotification(g2, "T", "b"), (u += 2_000, N.prepareNotification(g2, 3, 3)), N.prepareNotification(g2, "T", "b")], [null, null, null]);
	r.done();
});
