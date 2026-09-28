/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS

   L'implémentation ELECTRON du contrat `src/host/types.ts`. C'est ici, et
   NULLE PART AILLEURS sous `src/`, que le code partagé touche le disque, le
   sélecteur natif ou le protocole des ressources — et « toucher » veut dire
   « demander au processus principal par le pont » (`window.neo`) : la fenêtre
   n'a aucun accès direct, `contextIsolation` et `sandbox` le lui interdisent.

   Ce fichier vit sous `apps/windows/` par construction, comme
   `apps/obsidian/host.ts` : il est l'un des deux seuls endroits du dépôt où
   dépendre d'un hôte est le but, pas une dette. `npm run check:host` balaie
   `src/` (aucun import d'`obsidian`) ET `apps/windows/src/` (aucun non plus,
   assertion 3) — les deux implémentations ne peuvent pas se contaminer.

   Depuis cette tâche, l'hôte est COMPOSITE : `carte` (`./roots.ts`) porte
   TOUTES les racines ouvertes, et ce module ne fait plus que la consommer —
   il ne connaît lui-même aucun chemin absolu ni aucune conversion de préfixe.
══════════════════════════════════════════════════════════ */

import { LOG_PREFIX } from "../../../../src/branding";
import type { Host } from "../../../../src/host/types";
import { estUrlHttps } from "../../../../src/host/url";
import { pont } from "./pont";
import { createWindowsFs, createWindowsWatcher } from "./fs";
import type { MiroirDisque } from "./fs";
import { attachmentPathFor as attachmentPathForRacine, resultsDirFor as resultsDirForRacine } from "./roots";
import type { CarteRacines } from "./roots";
import { createWindowsLinks } from "./links";
import { createWindowsMath } from "./math";
import { createWindowsModals } from "./modal";
import { createWindowsNet } from "./net";
import { createWindowsPlatform } from "./platform";
import { createWindowsPdf } from "./pdf";
import { createWindowsProcess } from "./process";
import { createWindowsUi } from "./ui";
import { createWindowsCollage } from "./collage";
import { createWindowsVideo } from "./video";
import { createWindowsCode } from "./code";

export { createWindowsIndex } from "./fs";
export type { MiroirDisque, WindowsIndex } from "./fs";
export { creerCarteRacines } from "./roots";
export type { CarteRacines, RacineOuverte } from "./roots";

/** L'hôte, à partir de la carte des racines et du MIROIR de l'index que
    `createWindowsIndex` a construit (abonné au surveillant du principal PUIS
    hydraté — voir `./fs.ts`). Le miroir sert deux fois : comme index pour les
    trois lectures synchrones du contrat, et comme source du `HostWatcher`. */
export function createWindowsHost(carte: CarteRacines, index: MiroirDisque): Host {
	/* NOMMÉ ici, et non construit dans le littéral rendu en fin de fonction :
	   `paths.attachmentPathFor` a besoin d'interroger le disque, et le seul
	   endroit du dépôt qui sait convertir un chemin du contrat en chemin absolu
	   est cet objet-ci. Le construire deux fois donnerait deux `HostFs` pour un
	   seul hôte — sans conséquence aujourd'hui (il ne porte aucun état), mais
	   c'est exactement le genre de double qui finit par en porter un. */
	const fs = createWindowsFs(carte, index);

	const shell: Host["shell"] = {
		/* `systeme.ouvrir` du pont (`shell.openPath` côté principal, BORNÉ au
		   périmètre) : l'application par défaut du système, exactement comme
		   `app.openWithDefaultApp` sous Obsidian. Le principal rend un booléen —
		   `shell.openPath` rend une chaîne vide en cas de succès, et l'appelant
		   (`engine/resources.ts`) a besoin d'un booléen pour décider s'il doit
		   prévenir l'utilisateur. */
		async openExternal(file) {
			/* Une CHAÎNE est un chemin ABSOLU déjà admis au périmètre (dialogue
			   natif, `HostFs.externe.pickFiles`) : passée telle quelle, sans
			   passer par l'index du contrat qui ne la connaît pas. */
			const a = typeof file === "string" ? file : (file && index.get(file.path) ? carte.absolu(file.path) : null);
			if (!a) return false;
			try {
				return await pont().systeme.ouvrir(a);
			} catch (e) {
				/* La cause est LOGGÉE, jamais affichée : ce rejet peut porter un
				   message du processus principal (« chemin hors des dossiers
				   ouverts »), qui n'est pas traduit par `t()` — le montrer dans
				   une Notice ferait fuiter une phrase française dans une interface
				   anglaise. L'appelant sait quoi dire d'un `false`. */
				console.warn(LOG_PREFIX, "ouverture externe refusée:", e);
				return false;
			}
		},
		/* `revealInHost` rend TOUJOURS false : l'app n'a pas d'explorateur de
		   fichiers interne à faire défiler. Ce n'est PAS une erreur — le contrat
		   le dit, et `engine/resources.ts` enchaîne sur l'ouverture externe.
		   (`shell.showItemInFolder` d'Electron sait révéler un fichier dans
		   l'explorateur de WINDOWS, mais ce n'est pas ce que le contrat
		   demande : il parle de l'explorateur
		   de l'HÔTE, celui qu'on garde sous les yeux. Ouvrir une fenêtre du
		   système par-dessus l'application serait une autre action, décidée par
		   l'appelant, pas glissée ici sous le même nom.) */
		async revealInHost() {
			return false;
		},
		/* `window.open` et non un canal IPC : le principal intercepte toute
		   fenêtre demandée par la page (`setWindowOpenHandler`, main.ts) et remet
		   au navigateur ce qui est du `https?:`, le filtre qui existe déjà pour
		   les liens d'un quiz partagé. Aucun chemin de plus vers `shell`. */
		async openUrl(url) {
			if (!estUrlHttps(url)) return false;
			window.open(url, "_blank", "noopener");
			return true;
		},
	};

	const paths: Host["paths"] = {
		/* Le dossier des résultats dépend de la RACINE de la note : une
		   constante enverrait les résultats d'un quiz du dossier B dans le
		   dossier A. Dans un vault, on écrit là où le greffon écrit déjà ;
		   hors d'un vault, il n'y a pas de `.obsidian/` et en créer un serait
		   poser un dossier de configuration Obsidian fantôme.
		   Logique extraite dans `roots.ts` (PURE, donc éprouvable) : ce
		   fichier-ci importe MathLive, qu'esbuild ne charge pas hors de la
		   fenêtre. */
		resultsDirFor(sourcePath) { return resultsDirForRacine(carte, sourcePath); },
		/* Même extraction, et pour la même raison : la logique vit dans
		   `roots.ts` (PURE, donc éprouvable par `npm run check:windows-host`) et
		   ce fichier-ci ne fait que lui passer le test d'existence de l'hôte. */
		attachmentPathFor(name, sourcePath) {
			return attachmentPathForRacine(c => fs.exists(c), name, sourcePath);
		},
		roots() { return carte.hostRoots(); },
		/* Toujours le premier : `savedFolders` place le dossier par défaut
		   devant (tâche 1). */
		defaultRoot() { return carte.hostRoots()[0]; },
		rootOf(path) {
			const r = carte.pour(path);
			if (!r) return null;
			return carte.hostRoots().find(h => h.id === r.id) ?? null;
		},
		localPath(path) { return carte.local(path); },
		contractPath(rootId, localPath) { return carte.contrat(rootId, localPath); },
	};

	return {
		fs,
		links: createWindowsLinks(carte, index),
		watcher: createWindowsWatcher(index),
		/* `premierPlan` passe par le pont, que `ui.ts` n'importe pas (son
		   harnais de contrôle le charge sans l'IPC) : il est greffé ici. */
		ui: { ...createWindowsUi(), premierPlan: () => pont().fenetre.premierPlan() },
		math: createWindowsMath(),
		modals: createWindowsModals(),
		net: createWindowsNet(),
		/* Extrait dans `./process.ts`, comme `net.ts` : un passe-plat vers le
		   pont, dont `run` rejette `indisponible` jusqu'à la tâche 7. */
		process: createWindowsProcess(),
		/* Extraite dans `./platform.ts` (PURE, donc éprouvable), comme `roots.ts`
		   et pour la même raison : ce fichier-ci importe MathLive. */
		platform: createWindowsPlatform(),
		shell,
		paths,
		/* `pdf` depuis le 2026-09-17 (`./pdf.ts`, pdfjs-dist chargé à la
		   demande). Le membre était ABSENT avant, et c'était une divergence
		   écrite (tranche 5, tâche 6) : sans lui, la page « Générer » refusait
		   un PDF joint avec la Notice `ai.error.pdfUnsupportedInApp` plutôt que
		   d'attacher un texte vide en silence. `ai.ts` n'a pas bougé : c'est
		   exactement ce que le contrat promettait. Le greffon lecteur, lui, ne
		   porte plus ce membre (il ne génère plus). */
		pdf: createWindowsPdf(),
		/* L'attente d'une réponse copiée (spec 2026-09-18, §4) : un passe-plat
		   vers le pont, comme `process` et `net`. */
		collage: createWindowsCollage(pont),
		/* La lecture d'une vidéo YouTube (tâche 4, spec 2026-09-22, § 3.3) :
		   membre OPTIONNEL du contrat, absent sous le greffon. Un
		   passe-plat vers le pont, comme `process` et `net`. */
		video: createWindowsVideo(pont),
		/* Code execution (spec 2026-09-23-exercice-python, generalised at
		   task 4 of 2026-09-28-c-cpp-execution): OPTIONAL member, absent
		   under the plugin. A pass-through to the bridge. */
		code: createWindowsCode(pont),
		/* Disposer les fenêtres, glisser un fichier (la même résolution de
		   chemin qu'`openExternal` : un `HostFile` du contrat → absolu par
		   l'index ; une chaîne = un absolu déjà admis), et finir. */
		depot: {
			disposer: options => pont().depot.disposer(options).catch(e => { console.warn(LOG_PREFIX, "disposition impossible:", e); }),
			// L'application colle elle-même : la carte d'attente le sait par la
			// seule présence du membre.
			surColle: () => { /* rien : c'est un drapeau de capacité */ },
			async preparer(fichiers) {
				const absolus = fichiers
					.map(f => typeof f === "string" ? f : (f && index.get(f.path) ? carte.absolu(f.path) : null))
					.filter((a): a is string => !!a);
				if (absolus.length === 0) return;
				try { await pont().depot.preparer(absolus); } catch (e) { console.warn(LOG_PREFIX, "préparation du glisser impossible:", e); }
			},
			ecrire: (nom, octets) => pont().depot.ecrire(nom, octets).catch(e => { console.warn(LOG_PREFIX, "écriture pour le glisser impossible:", nom, e); return null; }),
			async glisser(fichiers, saisi = 0, image) {
				const absolus = fichiers
					.map(f => typeof f === "string" ? f : (f && index.get(f.path) ? carte.absolu(f.path) : null))
					.filter((a): a is string => !!a);
				if (absolus.length === 0) return "impossible";
				try { return await pont().depot.glisser(absolus, Math.max(0, Math.min(saisi, absolus.length - 1)), image); } catch (e) { console.warn(LOG_PREFIX, "glisser impossible:", e); return "impossible"; }
			},
			terminer: () => pont().depot.terminer().catch(e => { console.warn(LOG_PREFIX, "fin de disposition impossible:", e); }),
		},
	};
}
