/**
 * LE BAC À SABLE PYTHON, dans un VRAI Electron (spec 2026-09-23-exercice-
 * python-design.md §3). Ce qu'il empêche : qu'un quiz partagé piégé lise un
 * fichier du disque ou joigne le réseau depuis Python ; qu'une boucle
 * infinie bloque l'exercice suivant ; qu'`input()` ne se comporte pas comme
 * un terminal. Obligatoire avant chaque release (docs/superpowers/notes/
 * controles.md) ; dans la CI sur le job Windows.
 *
 *     npm run check:python-sandbox
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { makeReporter } from "./lib/load-src.mjs";
import { copierBacASable } from "../apps/windows/electron/python/copier.mjs";

const tmp = mkdtempSync(join(tmpdir(), "neo-python-"));
try {
	const racine = join(tmp, "python");
	await copierBacASable(racine);
	await build({
		entryPoints: { harnais: "scripts/fixtures/python-sandbox/harnais.ts", preload: "apps/windows/electron/python-preload.ts" },
		outdir: tmp, outExtension: { ".js": ".cjs" }, bundle: true, platform: "node", format: "cjs",
		target: "node22", external: ["electron"], logLevel: "silent",
	});
	writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "harnais", main: "harnais.cjs" }));
	const require = createRequire(resolve("apps/windows/package.json"));
	const electron = require("electron");
	const p = spawnSync(electron, [tmp], {
		env: { ...process.env, NEO_PYTHON_RACINE: racine, NEO_PYTHON_PRELOAD: join(tmp, "preload.cjs") },
		encoding: "utf8", timeout: 180000,
	});
	const cas = {};
	for (const l of `${p.stdout}\n${p.stderr}`.split("\n")) {
		const m = /^CAS (\S+) (.*)$/.exec(l.trim());
		if (m) cas[m[1]] = JSON.parse(m[2]);
	}
	const r = makeReporter("Bac à sable Python — vrai Electron");
	r.check("simple", [cas.simple?.status, cas.simple?.stdout], ["ok", "bonjour 42\n"]);
	r.check("input() en écho, comme un terminal", cas.echo?.stdout, "Saisir un entier a : 24\nSaisir un entier b : 18\nLe maximum est a = 24\n");
	r.check("input() de trop : EOFError lisible", [cas.eof?.status, /EOFError/.test(cas.eof?.error ?? "")], ["error", true]);
	r.check("aucune variable d'un essai à l'autre", cas.isolement?.stdout, "False\n");
	r.check("asserts qui passent", cas["asserts-ok"]?.status, "ok");
	r.check("assert qui échoue : AssertionError dans checks.py", [cas["asserts-ko"]?.status, /AssertionError/.test(cas["asserts-ko"]?.error ?? ""), /checks\.py/.test(cas["asserts-ko"]?.error ?? "")], ["error", true, true]);
	/* `reseau`/`fichier` (autre origine, `mode: "no-cors"`) : CORS cache le
	   CORPS de la réponse, jamais le fait qu'elle est PARTIE — un statut lu
	   (200) ou une réponse opaque résolue (0) valent tous deux une fuite ;
	   seul un rejet (aucun « LU » du tout) prouve que rien n'a fui.
	   `traversee` (même origine) : la réponse est lisible normalement, un
	   403/404 de notre propre gestionnaire ne prouve rien, seul un 200 le
	   ferait. */
	r.check("évasion reseau : requête jamais émise (aucun LU)", /LU/.test(cas.reseau?.stdout ?? "LU manquant"), false);
	r.check("évasion fichier : ni contenu (200) ni lecture opaque (0)", /LU (200|0)\b/.test(cas.fichier?.stdout ?? "LU manquant"), false);
	r.check("évasion traversee : rien de lu (200)", /LU 200\b/.test(cas.traversee?.stdout ?? "LU manquant"), false);
	r.check("boucle infinie arrêtée au délai", [cas.boucle?.status, cas.boucle?.ms < 5000], ["timeout", true]);
	r.check("l'essai suivant marche", [cas["apres-boucle"]?.status, cas["apres-boucle"]?.stdout], ["ok", "encore\n"]);
	r.check("flot de print : trop long ou délai, jamais bloqué", ["too-long", "timeout"].includes(cas.flot?.status), true);
	r.done();
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
