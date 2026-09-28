/**
 * THE CODE SANDBOX, in a REAL Electron (spec 2026-09-23-exercice-python-
 * design.md §3; generalised from Python-only to a code sandbox at task 3 of
 * docs/superpowers/sdd/2026-09-28-c-cpp-execution — no behaviour change for
 * Python). What it prevents: a trapped SHARED quiz reading a file off disk
 * or reaching the network from the code it runs; an infinite loop blocking
 * the next exercise; `input()` not behaving like a terminal. Mandatory
 * before each release (docs/superpowers/notes/controles.md); in CI on the
 * Windows job.
 *
 *     npm run check:code-sandbox
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { makeReporter } from "./lib/load-src.mjs";
import { copierBacASable } from "../apps/windows/electron/code/copier.mjs";

const tmp = mkdtempSync(join(tmpdir(), "neo-code-"));
try {
	const racine = join(tmp, "code");
	const langages = join(tmp, "languages"); // no pack installed yet (task 9); an empty dir is enough to prove the traversal case
	await copierBacASable(racine);
	await build({
		entryPoints: { harnais: "scripts/fixtures/code-sandbox/harnais.ts", preload: "apps/windows/electron/code-preload.ts" },
		outdir: tmp, outExtension: { ".js": ".cjs" }, bundle: true, platform: "node", format: "cjs",
		target: "node22", external: ["electron"], logLevel: "silent",
	});
	writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "harnais", main: "harnais.cjs" }));
	const require = createRequire(resolve("apps/windows/package.json"));
	const electron = require("electron");
	const p = spawnSync(electron, [tmp], {
		env: { ...process.env, NEO_CODE_RACINE: racine, NEO_CODE_LANGAGES: langages, NEO_CODE_PRELOAD: join(tmp, "preload.cjs") },
		encoding: "utf8", timeout: 180000,
	});
	/* I4 (d): a SECOND Electron process, with a single sandbox WITHOUT a
	   CSP — two `creerBacASable` in the same process make the second
	   `protocol.handle` of the privileged scheme fail (measured:
	   `ERR_FAILED`, an Electron implementation detail), so never combined in
	   the same `p`. */
	const pSansCsp = spawnSync(electron, [tmp], {
		env: { ...process.env, NEO_CODE_RACINE: racine, NEO_CODE_LANGAGES: langages, NEO_CODE_PRELOAD: join(tmp, "preload.cjs"), NEO_CODE_SANS_CSP: "1" },
		encoding: "utf8", timeout: 30000,
	});
	const cas = {};
	for (const l of `${p.stdout}\n${p.stderr}\n${pSansCsp.stdout}\n${pSansCsp.stderr}`.split("\n")) {
		const m = /^CAS (\S+) (.*)$/.exec(l.trim());
		if (m) cas[m[1]] = JSON.parse(m[2]);
	}
	const r = makeReporter("Code sandbox — real Electron");
	r.check("simple", [cas.simple?.status, cas.simple?.stdout], ["ok", "bonjour 42\n"]);
	r.check("input() echoed, like a terminal", cas.echo?.stdout, "Saisir un entier a : 24\nSaisir un entier b : 18\nLe maximum est a = 24\n");
	r.check("one input() too many: readable EOFError", [cas.eof?.status, /EOFError/.test(cas.eof?.error ?? "")], ["error", true]);
	r.check("no variable survives from one trial to the next", cas.isolement?.stdout, "False\n");
	r.check("asserts that pass", cas["asserts-ok"]?.status, "ok");
	r.check("failing assert: AssertionError in checks.py", [cas["asserts-ko"]?.status, /AssertionError/.test(cas["asserts-ko"]?.error ?? ""), /checks\.py/.test(cas["asserts-ko"]?.error ?? "")], ["error", true, true]);
	/* `reseau`/`fichier` (other origin, `mode: "no-cors"`): CORS hides the
	   BODY of the response, never the fact that it was SENT — a readable
	   status (200) or a resolved opaque response (0) both count as a leak;
	   only a rejection (no "LU" at all) proves nothing leaked.
	   `traversee` (same origin): the response is readable normally, a
	   403/404 from our own handler proves nothing, only a 200 would. */
	r.check("network escape: request never sent (no LU)", /LU/.test(cas.reseau?.stdout ?? "LU missing"), false);
	r.check("file escape: neither content (200) nor opaque read (0)", /LU (200|0)\b/.test(cas.fichier?.stdout ?? "LU missing"), false);
	r.check("traversal escape: nothing read (200)", /LU 200\b/.test(cas.traversee?.stdout ?? "LU missing"), false);

	/* (N3): these two cases discriminate NONE of our layers — see the
	   `EVASION_LOADPACKAGE` comment in the harness. `loadpackage-http` fails
	   with "Failed to fetch" even without CSP or `webRequest` (CORS rejects
	   `loadPackage`'s `cors` request after it is sent); `loadpackage-file`
	   fails on its own, Pyodide refusing `file:///` as a package name before
	   any request. Kept as documentation, not as proof of security: the
	   network proof rests on `reseau`/`sanscsp-reseau` (`no-cors` mode). */
	r.check("loadPackage(http): request never completes (CORS or webRequest)", /Failed to fetch/.test(cas["loadpackage-http"]?.stdout ?? ""), true);
	r.check("loadPackage(file): refused by Pyodide before any request", /CHARGE/.test(cas["loadpackage-file"]?.stdout ?? "CHARGE missing"), false);
	/* I4 (c): the CSP alone, on code that touches neither the network nor
	   disk — Pyodide wraps the JS refusal in a `JsException`, never a Python
	   `EvalError`. */
	r.check("CSP: Function refused (JsException)", /^REFUSE JsException$/.test((cas.csp?.stdout ?? "").trim()), true);
	/* I4 (d): a sandbox WITHOUT a CSP — `webRequest` must block the network
	   ALONE, on a `mode: "no-cors"` request that Chromium would normally let
	   THROUGH (see the harness comment). No "LU": the request is never sent. */
	r.check("without CSP: webRequest blocks the network alone (no LU)", /LU/.test(cas["sanscsp-reseau"]?.stdout ?? "LU missing"), false);

	/* I1: a fresh interpreter per trial — no leak from one trial to the
	   next, even via a patch of `pyodide.code.eval_code_async`. */
	r.check("I1: trial 1's patch has no effect on the next trial", (cas["fuite-essai2"]?.stdout ?? "").trim(), "False");
	r.check("I1: trial 2's `after` fails as expected (fresh interpreter)", cas["fuite-essai2"]?.status, "error");

	/* N2: nothing survives in the partition (IndexedDB) from one trial to the next. */
	r.check("N2: trial 1 writes to IDBFS", cas["idbfs-essai1"]?.stdout, "ECRIT\n");
	r.check("N2: trial 2 never reads back what trial 1 left", cas["idbfs-essai2"]?.stdout, "False\n");

	/* I2: an asyncio task started but never awaited by trial 1 does not
	   survive its `terminate()` — it never gets a chance to write its marker. */
	r.check("I2: trial 1 starts the task then returns right away", cas["asyncio-essai1"]?.stdout, "LANCE\n");
	r.check("I2: trial 1's task did not survive to write", cas["asyncio-essai2"]?.stdout, "False\n");

	/* I3: a hard Pyodide stop (`os._exit(0)`) does not freeze the session —
	   the next trial must run normally. */
	r.check("I3: the next trial works after os._exit(0)", [cas["apres-exit"]?.status, cas["apres-exit"]?.stdout], ["ok", "encore-vivant\n"]);

	r.check("infinite loop stopped at the deadline", [cas.boucle?.status, cas.boucle?.ms < 5000], ["timeout", true]);
	r.check("the next trial works", [cas["apres-boucle"]?.status, cas["apres-boucle"]?.stdout], ["ok", "encore\n"]);
	r.check("print flood: too-long or timeout, never stuck", ["too-long", "timeout"].includes(cas.flot?.status), true);

	/* I4 (b): `resoudreFichierCode` in pure, outside Electron/Python. */
	r.check("resoudreFichierCode: a valid path is accepted", cas["resoudre-valide"]?.refuse, false);
	for (const nom of ["backslash-encode", "chemin-absolu", "autre-hote"]) {
		r.check(`resoudreFichierCode: ${nom} refused`, cas[`resoudre-${nom}`]?.refuse, true);
	}

	r.check("unknown language refused", cas["langue-inconnue"]?.status, "unavailable");
	r.check("no traversal out of the packs directory", /REFUSE|LU 403/.test(cas["schema-langues-traversee"]?.stdout ?? ""), true);

	r.done();
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
