/**
 * Charge un module `src/**.ts` dans Node, hors de toute application.
 *
 * Les scripts de vérification doivent éprouver le CODE RÉEL : une réplique
 * finirait par diverger de l'originale et validerait le vide. esbuild bundle
 * le module demandé. Aucun bouchon d'hôte n'est posé : un import d'`obsidian`
 * dans le code partagé (que `check:host` interdit) échouerait ici à la
 * résolution, bruyamment.
 *
 * UN `require` QUI MARCHE. Les modules du processus principal Electron
 * s'appuient sur `require("child_process")` pour lancer les CLI et lire leurs
 * fichiers de cache. La sortie de ce harnais est de l'ESM, et esbuild y
 * remplace chaque `require` par un `__require` qui JETTE — « Dynamic require
 * of "child_process" is not supported ». Un `try/catch` autour (c'est le cas
 * de `lireCache`) avalait alors ce jet et rendait « pas de cache » : un cas
 * VERT sur un code qui n'avait rien lu. Le `BANNER` ci-dessous pose un vrai
 * `require` de Node ; le `__require` d'esbuild le détecte
 * (`typeof require !== "undefined"`) et lui délègue.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Posé en tête de chaque sortie : voir « ET UN `require` QUI MARCHE ». */
const BANNER = [
	"import { createRequire as __creerRequire } from 'node:module';",
	"var require = __creerRequire(import.meta.url);",
].join("\n");

/**
 * @param {string | string[]} entry un module source ("src/editor/export.ts"),
 *   ou plusieurs — le rappel reçoit alors un module par entrée, dans l'ordre.
 * @param {(...mods: Record<string, unknown>[]) => Promise<void> | void} run
 */
export async function withSrcModule(entry, run) {
	const entries = Array.isArray(entry) ? entry : [entry];
	const dir = mkdtempSync(join(tmpdir(), "quiz-check-"));
	try {
		let sorties;
		if (entries.length > 1) {
			/* UN SEUL build, avec `splitting` : un module importé par plusieurs
			   entrées (ex. `src/host/current.ts`, dont l'état d'hôte installé est
			   un singleton) devient un chunk PARTAGÉ, chargé une seule fois — donc
			   une seule instance de son état module-scope. Un build par entrée (la
			   forme utilisée quand une seule est demandée) donnerait à chaque
			   entrée sa propre copie, et un hôte installé depuis l'une resterait
			   invisible de l'autre. */
			const outdir = join(dir, "out");
			await build({
				entryPoints: entries,
				bundle: true,
				splitting: true,
				format: "esm",
				platform: "node",
				outdir,
				// `outbase` fixé à la racine du dépôt : sans lui, esbuild le
				// déduit du plus petit ancêtre commun des entrées demandées
				// (parfois "src/editor/" au lieu de "src/"), et le chemin de
				// sortie recalculé ci-dessous ne correspondrait plus au fichier
				// réel. La racine, et non "src" : une entrée sous `apps/` sort
				// alors de `outbase`, et esbuild réécrit son `..` en `_.._`.
				outbase: ".",
				logLevel: "warning",
				banner: { js: BANNER },
			});
			// `outbase: "."` fixe la racine : "src/host/current.ts" devient
			// toujours "<outdir>/src/host/current.js", quelles que soient les entrées.
			sorties = entries.map((e) => join(outdir, e.replace(/\.tsx?$/, ".js")));
		} else {
			// Une seule entrée : `outdir` déduirait le nom du chemin source, ce
			// qui suffit ici (pas de risque de collision à une seule sortie).
			const outfile = join(dir, "module0.mjs");
			await build({
				entryPoints: [entries[0]],
				bundle: true,
				format: "esm",
				platform: "node",
				outfile,
				logLevel: "warning",
				banner: { js: BANNER },
			});
			sorties = [outfile];
		}
		const mods = [];
		for (const s of sorties) mods.push(await import(pathToFileURL(s).href));
		await run(...mods);
	} finally {
		/* Ce `finally` ne s'exécute QUE si le rappel laisse la pile se dérouler.
		   Un `process.exit()` dedans le saute, et chaque exécution laissait un
		   dossier `quiz-check-*` dans le répertoire temporaire (revue codex
		   2026-07-31, treize retrouvés). D'où `process.exitCode` — jamais
		   `process.exit` — dans les scripts qui appellent cette fonction. */
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Petit rapporteur commun : `attendu`/`obtenu` comparés en JSON. */
export function makeReporter(titre) {
	let echecs = 0;
	let total = 0;
	return {
		check(nom, obtenu, attendu) {
			total++;
			if (JSON.stringify(obtenu) === JSON.stringify(attendu)) return;
			echecs++;
			console.error("ÉCHEC  " + nom);
			console.error("       attendu : " + JSON.stringify(attendu));
			console.error("       obtenu  : " + JSON.stringify(obtenu));
		},
		done() {
			if (echecs) {
				console.error("\n" + titre + " : " + echecs + "/" + total + " cas en échec");
				// `exitCode` et non `exit()` : la pile doit se dérouler pour que le
				// dossier temporaire soit nettoyé. Les jeux de cas suivants
				// s'exécutent quand même — voir TOUS les échecs vaut mieux que
				// s'arrêter au premier.
				process.exitCode = 1;
				return;
			}
			console.log(titre + " : " + total + "/" + total + " cas passent");
		},
	};
}
