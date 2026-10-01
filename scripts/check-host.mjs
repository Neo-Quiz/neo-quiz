/**
 * FRONTIÈRE D'HÔTE — aucun fichier de `src/` n'importe Obsidian, et le rendu
 * de l'application n'importe jamais un module qui tire Node (assertion 6).
 *
 * Même rôle que la section pureté de check-scheduler.mjs, avec une propriété
 * de plus : le noyau de l'ordonnanceur est DÉJÀ pur, alors que `src/` ne le
 * sera qu'à la fin du chantier. La liste RESTANTS nomme ce qui n'est pas
 * encore migré — et l'assertion 2 ci-dessous interdit qu'elle moisisse.
 *
 *     npm run check:host
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, posix, sep } from "node:path";

/* Les TROIS formes de dépendance, pas seulement les deux statiques :
   `from "obsidian"`, `require("obsidian")` ET `import("obsidian")`. La
   dernière a été oubliée au premier jet alors que le dépôt avait déjà
   l'idiome du chargement différé (`require("./dashboard/quiz-open")`) — un
   `const o = await import("obsidian")` passait donc au vert. */
const IMPORTE_OBSIDIAN = /(?:from\s*|require\s*\(\s*|(?<![.\w$])import\s*\(\s*)["']obsidian["']/;

/* `.mts` et `.cts` comptent : un fichier qui ne finit pas par `.ts` n'était
   pas collecté, donc jamais examiné — une échappatoire d'un caractère. */
const EXTENSIONS_TS = [".ts", ".tsx", ".mts", ".cts"];

/**
 * Fichiers de `src/` qui importent ENCORE Obsidian, avec la tranche qui les
 * libère. Cette liste ne peut que RÉTRÉCIR : un fichier qui y figure sans
 * importer Obsidian fait échouer le contrôle (assertion 2), ce qui force à
 * l'en retirer au lieu de le laisser couvrir une régression future.
 */
const RESTANTS = [
	// Vide depuis la tâche 2 du chantier « greffon lecteur » (2026-09-13) :
	// `src/types/dashboard-ctx.ts`, dernier fichier de `src/` à importer
	// Obsidian, a perdu `DashboardCtx`/`DashboardView`/`DashboardPlugin` (le
	// littéral `ctx` et l'hôte `this` de l'ex-vue dashboard) — plus rien
	// sous `src/` ne dépend d'Obsidian. Le tableau reste en place, vide,
	// même statut de cliquet qu'`EXCEPTIONS_APPS` juste plus bas.
];

function fichiersTs(racine) {
	const trouves = [];
	if (!existsSync(racine)) return trouves;
	for (const nom of readdirSync(racine)) {
		const chemin = join(racine, nom);
		/* `node_modules`, `dist` et les artefacts Rust ne sont pas du code du
		   dépôt : les balayer ferait échouer le contrôle sur les typages
		   d'Obsidian eux-mêmes. */
		if (nom === "node_modules" || nom === "dist" || nom === "target" || nom === "gen") continue;
		if (statSync(chemin).isDirectory()) trouves.push(...fichiersTs(chemin));
		else if (EXTENSIONS_TS.some(e => nom.endsWith(e))) trouves.push(chemin.split(sep).join(posix.sep));
	}
	return trouves;
}

const attendus = new Set(RESTANTS);
let echecs = 0;
const rate = (msg) => { console.error("ÉCHEC  " + msg); echecs++; };

// 1. Aucune NOUVELLE dépendance dans la zone partagée.
const importeurs = new Set();
for (const f of fichiersTs("src")) {
	if (IMPORTE_OBSIDIAN.test(readFileSync(f, "utf8"))) importeurs.add(f);
}
for (const f of importeurs) {
	if (!attendus.has(f)) rate(`${f} importe « obsidian » : le code partagé passe par src/host/.`);
}

// 2. LE CLIQUET : une entrée qui n'importe plus rien doit être retirée, sinon
//    la liste devient un tapis sous lequel on balaie.
for (const f of attendus) {
	if (!existsSync(f)) rate(`RESTANTS contient ${f}, qui n'existe pas : retirez l'entrée.`);
	else if (!importeurs.has(f)) rate(`${f} n'importe plus « obsidian » : retirez-le de RESTANTS.`);
}

/* 3. L'app Windows n'a jamais rien à faire d'Obsidian.
      On balaie TOUT `apps/windows`, pas seulement son `src/` : la config Vite,
      `tauri.conf` ou un script racine sont des `.ts` du même projet, et un
      fichier posé juste à côté de `src/` échappait au contrôle. */
for (const f of fichiersTs("apps/windows")) {
	if (IMPORTE_OBSIDIAN.test(readFileSync(f, "utf8"))) rate(`${f} importe « obsidian » : ce n'est pas son hôte.`);
}

/* 4. LES EXTENSIONS DOM D'OBSIDIAN — le trou que les trois assertions
      précédentes ne pouvaient pas voir.

      Obsidian pose sur `HTMLElement` des méthodes bien pratiques
      (`createDiv`, `createEl`, `empty`, `setText`…) qui n'existent nulle part
      ailleurs. C'est une dépendance à Obsidian qu'AUCUN `import` ne trahit :
      elle est partie une fois dans le bundle de l'application, via
      `renderParagraph` de `quiz-utils.ts`, et y aurait planté si on l'avait
      atteinte.

      La règle se passe d'une seconde liste : un fichier qui importe encore
      Obsidian est DÉJÀ déclaré dans RESTANTS, et ses extensions DOM partiront
      avec lui. Ce sont les AUTRES qu'on interdit — et le jour où une tranche
      future retire un fichier de RESTANTS, ses extensions DOM deviennent une
      erreur du même coup. Le cliquet se referme tout seul.

      `src/dom.ts` fournit le remplaçant (`ajouter`), en DOM standard. */
const EXTENSIONS_DOM = /\.(createEl|createDiv|createSpan|empty|setText|addClass|removeClass|toggleClass|detach|appendText|setAttr)\s*\(/;

/** Retire les COMMENTAIRES : une extension CITÉE dans un commentaire
    (« DOM standard, PAS `container.createEl()` ») n'est pas un appel. */
function codeNu(src) {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/[^\n]*/g, "");
}

for (const f of fichiersTs("src")) {
	if (importeurs.has(f)) continue; // déjà déclaré : il partira avec son import
	const m = codeNu(readFileSync(f, "utf8")).match(EXTENSIONS_DOM);
	if (m) rate(`${f} emploie « ${m[1]} », une extension DOM d'Obsidian absente des autres hôtes : passez par « ajouter » (src/dom.ts).`);
}

/* 5. LE SENS DES DÉPENDANCES. `src/` est le code partagé : il ne connaît pas
      ses hôtes. Les exceptions sont nommées
      (`EXCEPTIONS_APPS`, vide aujourd'hui) : sans cette assertion, « juste un import depuis apps/ » serait la
      façon la plus rapide de contourner tout le reste du contrôle, sans
      qu'aucune des quatre assertions précédentes ne s'en aperçoive. */
const IMPORTE_APPS = /(?:from\s*|require\s*\(\s*|(?<![.\w$])import\s*\(\s*)["'][^"']*\bapps\//;
/* La seconde exception a VÉCU ce que le cliquet ci-dessous promet :
   `ai-client.ts` consommait `buildChildEnv` d'un hôte tant
   qu'il lançait ses CLI lui-même (tranche 5, tâche 3). La tâche 4 l'a fait
   passer par `host.process.run` — l'import a disparu, et l'entrée avec lui. */
/* `src/dashboard.ts` a disparu à la tâche 1 du chantier « greffon lecteur »
   (2026-09-13) : c'était la seule exception. Liste vidée, gardée en place
   pour un retour en arrière — même statut de cliquet que RESTANTS. */
const EXCEPTIONS_APPS = new Set();
for (const f of fichiersTs("src")) {
	if (EXCEPTIONS_APPS.has(f)) continue;
	if (IMPORTE_APPS.test(codeNu(readFileSync(f, "utf8")))) {
		rate(`${f} importe depuis apps/ : le code partagé ne connaît pas ses hôtes.`);
	}
}
/* ET LE CLIQUET DANS L'AUTRE SENS, comme l'assertion 2 le fait pour RESTANTS.
   Sans lui, une exception SURVIT à ce qui la justifiait : le jour où la tâche 4
   retire de `ai-client.ts` son import de `buildChildEnv` sans retirer la ligne
   d'ici, l'entrée reste — et couvre en silence la PROCHAINE violation dans ce
   fichier. Une liste d'exceptions qui ne peut que rétrécir n'est pas un tapis
   sous lequel on balaie. */
for (const f of EXCEPTIONS_APPS) {
	if (!existsSync(f)) rate(`EXCEPTIONS_APPS contient ${f}, qui n'existe pas : retirez l'entrée.`);
	else if (!IMPORTE_APPS.test(codeNu(readFileSync(f, "utf8")))) {
		rate(`${f} n'importe plus depuis apps/ : retirez-le d'EXCEPTIONS_APPS.`);
	}
}

/* 6. LE RENDU DE L'APPLICATION N'IMPORTE JAMAIS UN MODULE QUI TIRE NODE.

      La règle est née à la tâche 2 de la migration Tauri → Electron
      (`CLAUDE.md`, « Structure du dépôt ») et AUCUN contrôle ne la tenait
      (revue finale, I2). Le rendu tourne dans Chromium avec `contextIsolation`
      et sans `nodeIntegration` : un `import { readFile } from "node:fs"` dans
      `apps/windows/src/host/fs.ts` ne rougit NULLE PART — Vite EXTERNALISE
      `node:fs` avec un simple avertissement, `check:app` passe, et c'est à
      l'exécution que `readFile` est `undefined`. Pire : `perimetre.ts`,
      `fichiers.ts` ou `canaux.ts` importés du rendu recréeraient, côté
      Chromium, l'accès disque total que le pont existe pour retirer — et
      `sandbox: true` ne protège que de ce qui est réellement chargé.

      Ce qui est interdit dans `apps/windows/src/` hors `import type` : tout
      spécificateur `node:*`, `chokidar`, `electron`, et tout module de
      `apps/windows/electron/` sauf ceux SANS import Node — `SANS_NODE`, dont
      chaque entrée est VÉRIFIÉE ici même (un `node:fs` ajouté à
      `ressources.ts` « pour aller vite » ferait rougir la liste, pas passer
      le rendu). `import type` reste admis : effacé à la compilation, il ne
      charge rien — c'est ainsi que `fs.ts` lit le type `EvenementDisque`. */
const SANS_NODE = new Set(["catalogue", "ressources", "pont"]);
const SPECIFICATEUR_NODE = /^(node:|chokidar$|electron$)/;
const MODULE_ELECTRON = /(?:^|\/)electron\/([^/"']+?)(?:\.[cm]?ts)?$/;

/** Les spécificateurs importés POUR DE VRAI (pas `import type`), sous leurs
    trois formes plus la réexportation `export … from`. `import { type X }`
    compte comme un vrai import : TypeScript ne l'efface que si TOUS les
    membres sont `type`, et en douter coûte un faux rouge, pas un trou. */
function specificateursCharges(src) {
	const nu = codeNu(src);
	const trouves = [];
	const statique = /(?:^|[^\w$.])(import|export)\s+(type\s+)?[^;'"]*?from\s*["']([^"']+)["']/g;
	let m;
	while ((m = statique.exec(nu))) if (!m[2]) trouves.push(m[3]);
	const nuImport = /(?:^|[^\w$.])import\s*["']([^"']+)["']/g;
	while ((m = nuImport.exec(nu))) trouves.push(m[1]);
	const dynamique = /(?:require\s*\(\s*|(?<![.\w$])import\s*\(\s*)["']([^"']+)["']/g;
	while ((m = dynamique.exec(nu))) trouves.push(m[1]);
	return trouves;
}

for (const f of fichiersTs("apps/windows/src")) {
	for (const spec of specificateursCharges(readFileSync(f, "utf8"))) {
		if (SPECIFICATEUR_NODE.test(spec)) {
			rate(`${f} importe « ${spec} » : le rendu tourne dans Chromium, sans Node — passez par le pont (window.neo).`);
			continue;
		}
		const em = spec.match(MODULE_ELECTRON);
		if (em && !SANS_NODE.has(em[1])) {
			rate(`${f} importe « ${spec} » : ce module du processus principal tire Node ; seuls ${[...SANS_NODE].join(", ")} sont importables du rendu.`);
		}
	}
}
for (const nom of SANS_NODE) {
	const f = `apps/windows/electron/${nom}.ts`;
	if (!existsSync(f)) {
		rate(`SANS_NODE contient ${nom}, mais ${f} n'existe pas : retirez l'entrée.`);
		continue;
	}
	for (const spec of specificateursCharges(readFileSync(f, "utf8"))) {
		const em = spec.match(MODULE_ELECTRON);
		if (SPECIFICATEUR_NODE.test(spec) || (em && !SANS_NODE.has(em[1]))) {
			rate(`${f} importe « ${spec} » alors qu'il est déclaré SANS Node (SANS_NODE) : le rendu l'importe, il vient de tirer Node avec lui.`);
		}
	}
}

if (echecs) {
	console.error(`\nFrontière d'hôte : ${echecs} problème(s)`);
	// exitCode, jamais exit() — cohérent avec les autres scripts du dépôt.
	process.exitCode = 1;
} else {
	console.log(`Frontière d'hôte : ${importeurs.size} fichier(s) encore lié(s) à Obsidian, tous déclarés.`);
}
