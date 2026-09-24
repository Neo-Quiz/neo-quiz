/*
 * LA COMPILATION DU PROCESSUS PRINCIPAL — SÉPARÉE DE CELLE DU RENDU
 *
 * Tâche 3 de la migration Tauri → Electron. Deux paquets, deux sorties, qui ne
 * se rencontrent jamais : Vite écrit le rendu dans `dist/`, ce script écrit le
 * principal et le préchargement dans `dist-electron/`. Le rendu ne peut donc
 * pas embarquer Node par accident — et c'est vérifiable d'un coup d'œil au
 * contenu des deux dossiers.
 *
 * POURQUOI ESBUILD ET NON `tsc`, comme le plan l'écrivait. Trois raisons, dont
 * aucune n'est une préférence :
 *
 * 1. `sandbox: true` oblige le PRÉCHARGEMENT à être du CommonJS — un
 *    préchargement sandboxé ne sait pas charger de module ES. Or
 *    `apps/windows/package.json` porte `"type": "module"` : un `.js` y est lu
 *    comme un module ES. La sortie doit donc être `.cjs`, ce que `tsc` ne sait
 *    pas produire sans renommer les SOURCES en `.cts`.
 * 2. `chokidar@5` est un paquet ES pur. Le charger depuis du CommonJS
 *    dépendrait de `require(esm)`, dont la disponibilité varie avec la version
 *    de Node embarquée par Electron. Bundlé, il n'y a plus de question.
 * 3. Un émis `tsc` en modules ES exigerait que chaque import relatif porte son
 *    extension `.js` — donc de réécrire les imports des tâches 1 et 2, et ceux
 *    que le RENDU fait déjà vers `electron/catalogue`. Trois fichiers déjà
 *    éprouvés changeraient pour une contrainte de compilateur.
 *
 * Le TYPAGE, lui, reste à `tsc` : `npm run typecheck:electron`
 * (`tsconfig.electron.json`). esbuild ne vérifie aucun type — l'un compile,
 * l'autre juge, et c'est le second qui referme le trou signalé par les
 * tâches 1 et 2 (aucun `tsconfig` ne couvrait `apps/windows/electron/`).
 */

import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ici = fileURLToPath(new URL(".", import.meta.url));

/* `external: ["electron"]` : le module `electron` est fourni par le runtime
   lui-même, le bundler ne doit pas tenter de le résoudre. Les modules `node:*`
   le sont déjà par `platform: "node"`. */
await build({
	entryPoints: [`${ici}main.ts`, `${ici}preload.ts`, `${ici}python-preload.ts`],
	outdir: `${ici}../dist-electron`,
	outExtension: { ".js": ".cjs" },
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node22",
	external: ["electron"],
	sourcemap: true,
	logLevel: "info",
});

/* LA FENÊTRE DE MISE À JOUR est une page chargée par `file://` depuis l'asar,
   sans chaîne de construction : son HTML et son décor sont COPIÉS tels quels.
   Le décor est celui de l'installeur, par chemin relatif — un second fichier
   identique finirait par diverger de celui qu'on regarde. */
const sortieMaj = join(ici, "..", "dist-electron", "maj");
await mkdir(sortieMaj, { recursive: true });
await Promise.all([
	copyFile(join(ici, "maj", "index.html"), join(sortieMaj, "index.html")),
	copyFile(join(ici, "..", "installer", "fond.png"), join(sortieMaj, "fond.png")),
]);

/* LE BAC À SABLE PYTHON : page, worker et fichiers de Pyodide, copiés tels
   quels (spec 2026-09-23-exercice-python-design.md §3.4). */
const { copierBacASable } = await import("./python/copier.mjs");
await copierBacASable(join(ici, "..", "dist-electron", "python"));
