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
	/* I4 (d) : un DEUXIÈME processus Electron, avec un seul bac SANS CSP —
	   deux `creerBacASable` dans le même processus font échouer le second
	   `protocol.handle` du schéma privilégié (mesuré : `ERR_FAILED`, un
	   détail d'Electron), donc jamais dans le même `p`. */
	const pSansCsp = spawnSync(electron, [tmp], {
		env: { ...process.env, NEO_PYTHON_RACINE: racine, NEO_PYTHON_PRELOAD: join(tmp, "preload.cjs"), NEO_PYTHON_SANS_CSP: "1" },
		encoding: "utf8", timeout: 30000,
	});
	const cas = {};
	for (const l of `${p.stdout}\n${p.stderr}\n${pSansCsp.stdout}\n${pSansCsp.stderr}`.split("\n")) {
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

	/* (N3) : ces deux cas ne discriminent AUCUNE de nos couches — voir le
	   commentaire de `EVASION_LOADPACKAGE` dans le harnais. `loadpackage-http`
	   échoue en « Failed to fetch » même sans CSP ni `webRequest` (CORS rejette
	   la requête `cors` de `loadPackage` après émission) ; `loadpackage-file`
	   échoue tout seul, Pyodide refusant `file:///` comme nom de paquet avant
	   toute requête. Gardés comme documentation, pas comme preuve de sécurité :
	   la preuve réseau tient sur `reseau`/`sanscsp-reseau` (mode `no-cors`). */
	r.check("loadPackage(http) : requête jamais aboutie (CORS ou webRequest)", /Failed to fetch/.test(cas["loadpackage-http"]?.stdout ?? ""), true);
	r.check("loadPackage(file) : refusé par Pyodide avant toute requête", /CHARGE/.test(cas["loadpackage-file"]?.stdout ?? "CHARGE manquant"), false);
	/* I4 (c) : la CSP seule, sur du code qui ne touche ni réseau ni disque —
	   Pyodide enveloppe le refus JS en `JsException`, jamais un `EvalError`
	   Python. */
	r.check("CSP : Function refusé (JsException)", /^REFUSE JsException$/.test((cas.csp?.stdout ?? "").trim()), true);
	/* I4 (d) : un bac SANS CSP — `webRequest` doit bloquer SEUL, sur un
	   `mode: "no-cors"` que Chromium laisserait normalement PARTIR (voir le
	   commentaire du harnais). Aucun « LU » : la requête n'est jamais émise. */
	r.check("sans CSP : webRequest bloque seul le réseau (aucun LU)", /LU/.test(cas["sanscsp-reseau"]?.stdout ?? "LU manquant"), false);

	/* I1 : un interpréteur neuf par essai — aucune fuite d'un essai à
	   l'autre, même via un patch de `pyodide.code.eval_code_async`. */
	r.check("I1 : essai 1 patche sans effet sur l'essai suivant", (cas["fuite-essai2"]?.stdout ?? "").trim(), "False");
	r.check("I1 : l'`after` de l'essai 2 échoue bien (interpréteur neuf)", cas["fuite-essai2"]?.status, "error");

	/* N2 : rien ne survit dans la partition (IndexedDB) d'un essai à l'autre. */
	r.check("N2 : essai 1 écrit bien dans IDBFS", cas["idbfs-essai1"]?.stdout, "ECRIT\n");
	r.check("N2 : essai 2 ne relit pas ce qu'essai 1 a laissé", cas["idbfs-essai2"]?.stdout, "False\n");

	/* I2 : une tâche asyncio non attendue par essai 1 ne survit pas à son
	   `terminate()` — elle n'a jamais l'occasion d'écrire son marqueur. */
	r.check("I2 : essai 1 lance la tâche puis rend la main tout de suite", cas["asyncio-essai1"]?.stdout, "LANCE\n");
	r.check("I2 : la tâche de l'essai 1 n'a pas survécu pour écrire", cas["asyncio-essai2"]?.stdout, "False\n");

	/* I3 : un Pyodide qui s'arrête pour de bon (`os._exit(0)`) n'immobilise
	   pas la session — l'essai suivant doit marcher normalement. */
	r.check("I3 : l'essai suivant marche après os._exit(0)", [cas["apres-exit"]?.status, cas["apres-exit"]?.stdout], ["ok", "encore-vivant\n"]);

	r.check("boucle infinie arrêtée au délai", [cas.boucle?.status, cas.boucle?.ms < 5000], ["timeout", true]);
	r.check("l'essai suivant marche", [cas["apres-boucle"]?.status, cas["apres-boucle"]?.stdout], ["ok", "encore\n"]);
	r.check("flot de print : trop long ou délai, jamais bloqué", ["too-long", "timeout"].includes(cas.flot?.status), true);

	/* I4 (b) : `resoudreFichierPython` en pur, hors Electron/Python. */
	r.check("resoudreFichierPython : chemin valide accepté", cas["resoudre-valide"]?.refuse, false);
	for (const nom of ["backslash-encode", "chemin-absolu", "autre-hote"]) {
		r.check(`resoudreFichierPython : ${nom} refusé`, cas[`resoudre-${nom}`]?.refuse, true);
	}

	r.done();
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
