/**
 * LES FICHIERS LIBÉRÉS NE REVIENNENT PAS EN ARRIÈRE.
 *
 * `check:host` attrape déjà les extensions DOM d'Obsidian (assertion 4) —
 * mais SEULEMENT dans les fichiers qui n'importent plus Obsidian. Un
 * `import { setIcon } from "obsidian"` remis « pour aller vite » en tranche 3
 * ferait rentrer un de ces fichiers dans `RESTANTS`, et ses extensions DOM
 * redeviendraient invisibles au contrôle — pas rejetées, simplement plus
 * regardées.
 *
 * `LIBERES` nomme ce qui est libéré POUR DE BON : les huit modules d'interface
 * portés en tranche 2.5 (rail, accueil, page « Mes quiz », cartes, sections
 * repliables, magasin de stats), les trois modules purs qu'ils ont fait
 * naître en cours de route (`module-map-note.ts`, tâche 2 ; `folder-archive.ts`
 * et `module-icons.ts`, tâche 6, extraits pour que l'app puisse importer ces
 * pages sans tirer `ui-select.ts`/`icon-picker.ts`), les cinq fichiers
 * libérés en tranche 2.6, et ceux de la tranche 3 (l'entrée/sortie du bloc,
 * les trois satellites de la page « quiz », puis la page elle-même —
 * `detail.ts`, celle qui sert trois hôtes — et le menu « ⋯ » des cartes,
 * `quiz-menu.ts`, la dernière conversion), puis les trois fichiers du
 * sélecteur « @ » libérés en tranche 5 (tâche 5). Contrairement à `RESTANTS`,
 * cette liste ne peut que
 * GRANDIR : un fichier qui y figure sans plus être libre (import d'Obsidian
 * retrouvé, extension DOM réintroduite) fait échouer le contrôle au lieu d'en
 * sortir en silence.
 *
 * LA PORTÉE N'EST PAS `src/dashboard/` — le nom du script dit d'où il vient,
 * pas ce qu'il garde. La liste est un simple ensemble de CHEMINS : rien dans
 * le code ci-dessous ne les borne à un dossier, et `src/editor/utils.ts`
 * (libéré en tranche 2.6, tâche 4) y figure pour cette raison. C'est même là
 * que le filet compte le plus : la tranche 3 est précisément celle qui
 * rouvrira `src/editor/`.
 *
 *     npm run check:dashboard-dom
 */
import { readFileSync, existsSync } from "node:fs";

/* Les mêmes trois formes que check-host.mjs : une seule échappatoire à la
   fois suffit à faire fuir Obsidian dans le bundle de l'application. */
const IMPORTE_OBSIDIAN = /(?:from\s*|require\s*\(\s*|(?<![.\w$])import\s*\(\s*)["']obsidian["']/;

/* Les extensions posées par Obsidian sur `HTMLElement`, qu'aucun `import` ne
   trahit — le même motif que check-host.mjs, assertion 4. */
const EXTENSIONS_DOM = /\.(createEl|createDiv|createSpan|empty|setText|addClass|removeClass|toggleClass|detach|appendText|setAttr)\s*\(/;

const LIBERES = [
	"src/dashboard/collapsible.ts",
	"src/dashboard/quiz-card.ts",
	"src/dashboard/module-card.ts",
	"src/dashboard/nav.ts",
	"src/dashboard/home.ts",
	// The home page redesign (2026-09-29).
	"src/dashboard/home-tasks.ts",
	"src/dashboard/home-folders.ts",
	"src/dashboard/home-week.ts",
	"src/dashboard/quizzes.ts",
	"src/dashboard/quizzes-render.ts",
	"src/dashboard/stats-store.ts",
	"src/dashboard/module-map-note.ts",
	"src/dashboard/folder-archive.ts",
	"src/dashboard/module-icons.ts",
	"src/dashboard/ui-select.ts",
	"src/dashboard/icon-picker.ts",
	"src/dashboard/folder-create.ts",
	"src/dashboard/module-edit.ts",
	"src/dashboard/detail-io.ts",
	"src/dashboard/detail-form-bridge.ts",
	"src/dashboard/detail-question.ts",
	"src/dashboard/detail.ts",
	"src/dashboard/quiz-menu.ts",
	"src/editor/utils.ts",
	// Tranche 5, tâche 5 : le sélecteur « @ » sur le contrat.
	"src/dashboard/file-sources.ts",
	"src/dashboard/mention-picker.ts",
	"src/dashboard/prompt-paths.ts",
	/* Tranche 5, tâche 6 : la page « Générer » elle-même, et les deux modules
	   qu'elle a fait naître ou libérer — `usage-format.ts` (les types et le
	   formatage de l'usage, extraits d'`ai-usage.ts`, qui reste lié) et
	   `hotkey-format.ts` (la plateforme vient du contrat). C'est le fichier
	   le plus exposé du lot : 92 extensions DOM y ont été converties d'un
	   coup, et un `import { setIcon } from "obsidian"` remis « pour aller
	   vite » les rendrait toutes invisibles à `check:host`. */
	"src/dashboard/ai.ts",
	"src/dashboard/usage-format.ts",
	"src/hotkey-format.ts",
	/* Les trois sections d'un dossier (2026-09-17), nées directement sans
	   Obsidian — sur la liste dès leur premier jour, pour que la règle vaille
	   pour un fichier neuf comme pour un fichier porté. */
	"src/dashboard/folder-contents.ts",
	"src/dashboard/folder-sections.ts",
	"src/dashboard/file-icons.ts",
	// Tâche 4, 2026-09-26 : l'onglet Planning de révisions, né directement
	// sans Obsidian.
	"src/dashboard/folder-planning.ts",
	// Refonte de l'éditeur, 2026-09-26 : l'en-tête de la page d'un quiz hors
	// fiche et la barre de mise en forme des champs, nés sans Obsidian.
	"src/dashboard/detail-head.ts",
	"src/editor/format-toolbar.ts",
	// Édition dans le rendu corrigé, 2026-09-26 : la page d'édition, le rendu
	// modifiable, ses gestes et ses cibles, le collage d'image partagé.
	"src/dashboard/detail-edition.ts",
	"src/dashboard/edition-rendu.ts",
	"src/dashboard/edition-rendu-gestes.ts",
	"src/dashboard/edition-rendu-cibles.ts",
	"src/editor/collage-image.ts",
];

/** Retire les commentaires : une extension CITÉE en commentaire (par exemple
    pour expliquer pourquoi on ne l'emploie plus) n'est pas un appel. */
function codeNu(src) {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/[^\n]*/g, "");
}

let echecs = 0;
const rate = (msg) => { console.error("ÉCHEC  " + msg); echecs++; };

for (const f of LIBERES) {
	if (!existsSync(f)) {
		rate(`${f} n'existe pas : retirez l'entrée de LIBERES.`);
		continue;
	}
	const source = readFileSync(f, "utf8");
	if (IMPORTE_OBSIDIAN.test(source)) {
		rate(`${f} réimporte « obsidian » : cette page est censée en être libérée pour de bon.`);
	}
	const m = codeNu(source).match(EXTENSIONS_DOM);
	if (m) {
		rate(`${f} emploie « ${m[1]} », une extension DOM d'Obsidian : passez par « ajouter » (src/dom.ts).`);
	}
}

if (echecs) {
	console.error(`\nFrontière des fichiers libérés : ${echecs} problème(s)`);
	// exitCode, jamais exit() — la pile doit se dérouler proprement.
	process.exitCode = 1;
} else {
	console.log(`Frontière des fichiers libérés : ${LIBERES.length} fichier(s) libéré(s), toujours libres.`);
}
