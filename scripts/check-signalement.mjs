/**
 * THE BUG REPORT MAIN-PROCESS PIECES (`apps/windows/electron/journal-memoire.ts`).
 * Prevents: a log buffer that grows without bound, keeps a user name, an
 * e-mail or a stack path, throws on a circular argument, swallows the real
 * console call, or leaves console patched after uninstall.
 *     npm run check:signalement
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["apps/windows/electron/journal-memoire.ts"], (JM) => {
	const r = makeReporter("Signalement");
	const calls = [];
	const origWarn = console.warn;
	const origError = console.error;
	console.warn = (...a) => { calls.push(["warn", a]); };
	console.error = (...a) => { calls.push(["error", a]); };
	const patchedWarn = console.warn;
	const patchedError = console.error;
	try {
		const j = JM.creerJournalMemoire();
		for (let i = 0; i < 250; i++) j.ajouter("warn", ["line " + i]);
		const lines = j.extrait().split("\n");
		r.check("journal: keeps the last 200 lines", [lines.length, lines[0], lines[199]], [200, "line 50", "line 249"]);

		j.vider();
		j.ajouter("error", ["x".repeat(2000)]);
		r.check("journal: a long line is cut to 500", j.extrait().length <= 500, true);

		j.vider();
		j.ajouter("warn", ["open C:\\Users\\Ahmed\\x failed for a.b@example.com"]);
		const e = new Error("boom C:\\Users\\Ahmed\\y");
		j.ajouter("error", [e]);
		const out = j.extrait();
		r.check("journal: no user name or e-mail", [/Ahmed/.test(out), /example\.com/.test(out)], [false, false]);
		r.check("journal: an Error becomes its message", [/boom/.test(out), /at .*\(/.test(out)], [true, false]);

		j.vider();
		const c = {}; c.self = c;
		let threw = false;
		try { j.ajouter("warn", [c]); } catch { threw = true; }
		r.check("journal: circular arg does not throw", threw, false);

		j.vider();
		const un = JM.installerJournalMemoire(j);
		r.check("journal: install wraps both", [console.warn !== patchedWarn, console.error !== patchedError], [true, true]);
		console.warn("hello", 3);
		console.error("bad");
		r.check("journal: originals still called", calls.map((c) => c[0]), ["warn", "error"]);
		r.check("journal: captured", j.extrait(), "hello 3\nbad");
		un();
		r.check("journal: uninstall restores", [console.warn === patchedWarn, console.error === patchedError], [true, true]);
	} finally {
		console.warn = origWarn;
		console.error = origError;
	}
	r.done();
});
