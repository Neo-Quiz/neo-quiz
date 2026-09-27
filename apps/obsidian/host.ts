/* ══════════════════════════════════════════════════════════
   L'HÔTE OBSIDIAN

   L'implémentation du contrat `src/host/types.ts` pour Obsidian. C'est ici, et
   NULLE PART AILLEURS sous `src/`, que le code partagé touche `app.vault`,
   `metadataCache`, `Notice` ou MathJax.

   Ce fichier vit sous `apps/obsidian/` par construction : il est le SEUL
   endroit du dépôt où dépendre d'`obsidian` est le but, pas une dette. C'est
   pourquoi `npm run check:host`, qui balaie `src/`, ne le voit pas.

   PLUS DE DOUBLE : quatre logiques ont MIGRÉ ici et n'existent plus ailleurs —
   la création de dossier des exports (ex-`ensureFolder` de
   `src/engine/results-save.ts`), la révélation dans l'explorateur et
   l'ouverture par l'application par défaut (ex-`revealFileInObsidianExplorer`
   et `openWithDefaultAppFromVault` de `src/engine/resources.ts`), et la
   mémoïsation de `loadMathJax` (ex-`src/engine/mathjax.ts`). Le portage s'est
   fait dans cet ordre — hôte écrit et éprouvé d'abord, appelants basculés
   ensuite, originaux supprimés en dernier — pour que le greffon ne soit à
   aucun moment cassé ; il est terminé.

   Et c'est ici, uniquement, qu'un `TFile` devient un `HostFile` (`toHostFile`
   ci-dessous). Toute autre conversion recopiée à la main est un défaut : elle
   diverge en silence le jour où `HostFile` gagne un champ.
══════════════════════════════════════════════════════════ */

import { Notice, Platform, setIcon, getIconIds, loadMathJax, renderMath, finishRenderMath } from "obsidian";
import type { App, DataAdapter, EventRef, TAbstractFile, TFile, View, WorkspaceLeaf } from "obsidian";
import type { Host, HostFile, HostFileEvent, HostRoot } from "../../src/host/types";
import { estUrlHttps } from "../../src/host/url";
import { REVIEW_DIR, REVIEW_LOG_NAME } from "../../src/review/paths";

/** Shell Electron minimal (surface réellement consommée : shell.openPath). */
interface ElectronShellLike {
	openPath(path: string): Promise<string>;
}

/** L'API interne d'i18n d'Obsidian : absente d'`obsidian.d.ts`, mais c'est la
    SEULE source de la langue de l'interface (celle d'Obsidian, pas celle de
    l'OS). Même lecture que `detectObsidianLang` dans `src/i18n.ts`. */
interface I18nextLike { language?: string }

/**
 * Le seul endroit du dépôt où un `TFile` devient un `HostFile`.
 *
 * Laisser fuir un `TFile` dans le code partagé obligerait l'hôte Windows à en
 * fabriquer un faux — avec ses méthodes, son `vault` et son `parent` — pour
 * satisfaire un type dont il n'a que faire. Le `HostFile` est plat et
 * sérialisable ; l'ordre des champs suit `src/host/types.ts`.
 */
function toHostFile(f: TFile): HostFile {
	return {
		path: f.path,
		name: f.name,
		basename: f.basename,
		extension: f.extension,
		mtime: f.stat?.mtime ?? 0,
	};
}

/**
 * Discrimine un fichier d'un dossier par la PRÉSENCE d'`extension`, pas par
 * `instanceof TFile`.
 *
 * Un `TFolder` n'a pas d'`extension` : le test est exact au runtime. Et il est
 * ÉPROUVABLE — le bouchon `obsidian` des scripts de vérification ne peut pas
 * fabriquer un vrai `TFile`, donc exiger `instanceof` rendrait `getFile`,
 * `read` et `resolve` intestables, ce qui reviendrait à ne pas les contrôler.
 */
function asTFile(f: TAbstractFile | null | undefined): TFile | null {
	if (!f) return null;
	return typeof (f as TFile).extension === "string" ? (f as TFile) : null;
}

/** Le second paramètre est réduit à ce dont l'hôte a besoin — le manifeste,
    pour retrouver l'ANCIEN journal. Typer `Plugin` entier obligerait le jeu
    de cas à en fabriquer un, alors qu'un objet littéral suffit.

    PLUS DE COUTURES D'ENVIRONNEMENT NI DE CLI depuis la tâche 2 du chantier
    « greffon lecteur » (2026-09-13) : `modals`, `net` et `process` sont
    partis avec le tableau de bord et l'IA, qui en étaient les seuls
    consommateurs. Ce qui les rendait nécessaires (`buildChildEnv`,
    `lancerCli`, la citation `cmd.exe`…) est resté du côté de l'application,
    seul hôte qui lance encore des CLI. */
export function createObsidianHost(
	app: App,
	plugin: { manifest: { dir?: string } },
): Host {
	const adapter = (): DataAdapter => app.vault.adapter;

	/** Le `TFile` d'un chemin, ou null (dossier, absent). */
	const tfile = (path: string): TFile | null => asTFile(app.vault.getAbstractFileByPath(path));

	/* ─── fs ─── */

	/**
	 * Un chemin qu'Obsidian n'INDEXE PAS : un segment commençant par un point
	 * (« .obsidian/quiz-blocks-results/… », « .neo-quiz/… »). Le vault ignore
	 * ces dossiers de bout en bout — `vault.create` y échoue, et
	 * `getAbstractFileByPath` n'y trouvera jamais rien.
	 *
	 * La FORME du chemin, et pas un test d'existence : `write` doit choisir sa
	 * voie AVANT que le fichier existe, quand il n'y a rien d'autre à regarder.
	 * Même convention que le parcours de l'hôte Windows (`dossierIgnore`).
	 */
	const estCache = (path: string): boolean =>
		path.split("/").some(segment => segment.startsWith("."));

	/** Segment par segment — ni le vault ni l'adaptateur n'ont de création
	    récursive, et créer « a/b/c » d'un coup échoue si « a » manque.
	    (Boucle héritée d'`ensureFolder` de `engine/results-save.ts`.)

	    MÊME PARTAGE QUE `write`, et pour la même raison : `adapter().mkdir`
	    pose le dossier sur le disque sans qu'aucun `TFolder` n'entre à
	    l'index, alors que `vault.createFolder` en rend un. Or les deux appels
	    de `dashboard/folder-create.ts` (import d'un zip, « Nouveau quiz »)
	    enchaînent aussitôt sur un `fs.write` qui, lui, passe désormais par
	    `vault.create` : le parent doit être connu du vault à cet instant
	    précis. (`module-edit.ts` est le dernier à créer un dossier VISIBLE ;
	    il n'écrit rien derrière, mais son dossier n'en mérite pas moins
	    d'exister à l'index. Tous les autres appelants de `mkdirs` — journal
	    de révision, résultats exportés, migration — visent un dossier caché
	    et gardent donc exactement la conduite d'avant.)

	    Le partage se fait sur CHAQUE PRÉFIXE et non sur le chemin entier :
	    pour « Cours/.cache », « Cours » est un vrai dossier du vault et lui
	    seul est caché. Tester le chemin complet ferait échapper le parent à
	    l'index par contagion. */
	async function mkdirs(path: string): Promise<void> {
		const parts = path.split("/").filter(Boolean);
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (estCache(current)) {
				if (!(await adapter().exists(current))) await adapter().mkdir(current);
				continue;
			}
			try {
				await app.vault.createFolder(current);
			} catch (e) {
				/* `createFolder` REJETTE un dossier déjà là, et le contrat promet
				   l'idempotence. On avale sur PREUVE d'existence plutôt que sur le
				   message de l'erreur : ce texte n'est ni documenté ni traduit
				   stablement, et le comparer rendrait le contrôle dépendant d'une
				   chaîne d'Obsidian. Tout autre échec (droits, nom invalide)
				   remonte, comme avant. */
				if (!(await adapter().exists(current))) throw e;
			}
		}
	}

	const fs: Host["fs"] = {
		// `vault.read` quand le chemin est un fichier connu du vault, sinon
		// l'adaptateur : lui seul atteint les fichiers hors index (.obsidian/…),
		// où vivent justement les résultats exportés.
		async read(path) {
			const f = tfile(path);
			return f ? await app.vault.read(f) : await adapter().read(path);
		},
		// `cachedRead` est le chemin du BALAYAGE complet du vault : Obsidian sert
		// son cache au lieu de relire le disque. Ce n'est pas un alias de `read`.
		async readCached(path) {
			const f = tfile(path);
			return f ? await app.vault.cachedRead(f) : await adapter().read(path);
		},
		/* « Créer ou remplacer » — mais en gardant l'INDEX du vault juste.
		   `adapter().write` seul écrit sur le disque sans que le vault en sache
		   rien : la note existe, et `getAbstractFileByPath` la cherche pourtant
		   en vain jusqu'au passage du surveillant. C'est exactement ce qui
		   faisait échouer l'ouverture d'un quiz qu'on venait de créer
		   (`dashboard/folder-create.ts`, bouton « Nouveau quiz »). Le vault, lui,
		   indexe dans l'appel ; l'adaptateur ne reste que pour ce que le vault
		   n'indexe pas. */
		async write(path, data) {
			if (estCache(path)) {
				await adapter().write(path, data);
				return;
			}
			// `create` REJETTE une cible existante : c'est `modify` qui remplace.
			const f = tfile(path);
			if (f) {
				await app.vault.modify(f, data);
				return;
			}
			/* Sur le disque mais pas encore à l'index (écrit à l'instant hors
			   d'Obsidian, ou dossier que le vault n'a pas fini de parcourir) :
			   `vault.create` rejetterait, et `write` promet de REMPLACER, jamais
			   de rejeter parce que la cible est là. */
			if (await adapter().exists(path)) {
				await adapter().write(path, data);
				return;
			}
			await app.vault.create(path, data);
		},
		/* Même PARTAGE que `write`, mais SANS son test `estCache`, et c'est
		   voulu : `vault.process` exige un `TFile`, qu'un chemin caché n'a
		   jamais (« `getAbstractFileByPath` n'y trouvera jamais rien », plus
		   haut) — le test serait donc une branche que rien ne peut atteindre,
		   ni en fonctionnement ni dans un jeu de cas honnête. `write` en a
		   besoin, lui, parce que son dernier recours est `vault.create` ; ici
		   le dernier recours est déjà l'adaptateur.

		   La branche adaptateur DÉGRADE en lecture-écriture — c'est ce que la
		   fenêtre fait de toute façon, et aucun appelant de cette branche ne
		   partage sa note avec un autre écrivain (résultats exportés, journal).
		   `adapter().process` existerait (obsidian.d.ts) mais seulement depuis
		   1.7.2, au-dessus du `minAppVersion` déclaré du greffon (1.5.0) : s'en
		   servir casserait un utilisateur que le manifeste dit soutenir. */
		async process(path, mutate) {
			const f = tfile(path);
			if (f) {
				await app.vault.process(f, mutate);
				return;
			}
			await adapter().write(path, mutate(await adapter().read(path)));
		},
		/* `vault.createBinary` quand la cible est neuve et indexable, exactement
		   comme `write` passe par `vault.create` : une image écrite par le seul
		   adaptateur EXISTE sur le disque sans entrer à l'index, et
		   `getFirstLinkpathDest` ne la retrouve pas — l'aperçu de la question
		   afficherait alors une image cassée juste après le collage. C'est le
		   défaut que la tranche 2.6 a corrigé pour les notes ; il vaut à
		   l'identique pour les pièces jointes. */
		async writeBinary(path, data) {
			/* La vue, pas le tampon : `data.buffer` d'une vue partielle porte
			   plus d'octets que la vue elle-même, et l'image sortirait avec une
			   queue parasite. `share.ts` emploie encore la forme non bornée ;
			   ne pas la recopier. */
			const octets = data.buffer.slice(
				data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
			if (estCache(path)) {
				await adapter().writeBinary(path, octets);
				return;
			}
			const f = tfile(path);
			if (f) {
				await app.vault.modifyBinary(f, octets);
				return;
			}
			if (await adapter().exists(path)) {
				await adapter().writeBinary(path, octets);
				return;
			}
			await app.vault.createBinary(path, octets);
		},
		/* Le miroir de `read` : `vault.readBinary` pour un fichier indexé, sinon
		   l'adaptateur. Recopié en `Uint8Array` propre : un `ArrayBuffer` nu
		   n'est pas ce que le contrat promet, et l'appelant en fabrique un `File`. */
		async readBinary(path) {
			const f = tfile(path);
			const octets = f ? await app.vault.readBinary(f) : await adapter().readBinary(path);
			return new Uint8Array(octets);
		},
		/* `fileManager.trashFile` et NON `vault.delete` : lui seul respecte le
		   réglage « Fichiers supprimés » de l'utilisateur (corbeille système,
		   `.trash` du vault, ou définitif). Choisir à sa place serait décider
		   qu'un quiz supprimé est irrécupérable chez quelqu'un qui a demandé
		   l'inverse.

		   PAS de branche adaptateur, contrairement à `write` et `process` : un
		   chemin caché n'a jamais de `TFile`, et la seule suppression
		   RÉCUPÉRABLE de l'adaptateur (`trashLocal`) date de 1.7.2, au-dessus du
		   `minAppVersion` du greffon. Aucun appelant ne jette un chemin caché —
		   le journal s'ajoute, les résultats ne se suppriment pas — et rendre la
		   main vaut mieux que détruire définitivement ce qu'on a promis de
		   rendre récupérable. */
		async trash(path) {
			const f = tfile(path);
			// Déjà absent (ou hors index) : le contrat ne promet que l'ABSENCE au
			// chemin donné, et rejeter ferait échouer une suppression que
			// l'utilisateur voit comme réussie (même raison que `remove`).
			if (!f) return;
			await app.fileManager.trashFile(f);
		},
		async exists(path) {
			return await adapter().exists(path);
		},
		mkdirs,
		/* MÊME PARTAGE que `write`, et il est venu pour la FRAÎCHEUR
		   (`src/host/types.ts`, « LA FRAÎCHEUR APRÈS UNE ÉCRITURE »).
		   `adapter().append` seul écrit sur le disque sans que le vault en
		   sache rien : le `TFile` gardait son ancien `mtime`, et `getFile`
		   rendait donc une date PÉRIMÉE après un ajout — la seule des quatre
		   voies d'écriture à trahir la promesse. `vault.append` existe depuis
		   0.13.0, très en dessous du `minAppVersion` déclaré (1.5.0).

		   L'ajout reste ATOMIQUE des deux côtés : c'est la propriété pour
		   laquelle cette méthode existe, et le journal de révision en dépend.
		   Le journal, justement, écrit sous `.neo-quiz/` — jamais indexé, donc
		   toujours la branche adaptateur : sa conduite ne change pas d'un
		   octet. */
		async append(path, data) {
			const f = tfile(path);
			if (f) {
				await app.vault.append(f, data);
				return;
			}
			await adapter().append(path, data);
		},
		/* Les FICHIERS seulement : `ListedFiles` sépare déjà `files` et
		   `folders`. Un dossier absent n'est pas une erreur — `list` jette
		   dans ce cas, et le contrat demande `[]`. */
		async list(dir) {
			try {
				return (await adapter().list(dir)).files;
			} catch (e) {
				return [];
			}
		},
		/* Ne rejette pas sur un fichier déjà absent : deux fenêtres Obsidian
		   peuvent absorber le même fichier de conflit, et le perdant n'a rien
		   fait de mal. */
		async remove(path) {
			try {
				await adapter().remove(path);
			} catch (e) {
				if (await adapter().exists(path)) throw e;
			}
		},
		/* Garde EXPLICITE, pas une confiance en `adapter().rename` : la
		   migration du journal (tâche 3) s'appuie sur ce rejet pour ne jamais
		   écraser une sauvegarde `.migrated` déjà posée — un `rename` qui
		   écraserait la destination en silence détruirait la sauvegarde que
		   la migration vient de créer.

		   `adapter().rename` fonctionne aussi pour un DOSSIER (menu
		   « Déplacer vers… », tâche 3 de la tranche 9) : c'est une opération
		   au niveau du système de fichiers de l'adaptateur, agnostique du
		   type d'entrée — Obsidian l'utilise lui-même ainsi pour renommer un
		   dossier depuis l'explorateur de fichiers. Pas besoin de détourner
		   vers `app.vault.rename(TFolder)`, qui ne ferait qu'ajouter une
		   résolution de `TAbstractFile` inutile ici. */
		/* LIMITE CONNUE (revue 2026-09-27) : `exists` PUIS `rename` n'est PAS
		   atomique — `DataAdapter` d'Obsidian ne propose ni lien dur ni copie
		   exclusive pour fermer cette fenêtre (contrairement au processus
		   principal Electron, `apps/windows/electron/fichiers.ts`, qui pose la
		   garde sur `fs.link`/`COPYFILE_EXCL`). Une écriture concurrente vers
		   `to` entre les deux `await` — un second déplacement lancé au même
		   instant, ou une note créée sous ce nom pendant l'attente — peut
		   encore faire écraser silencieusement par `adapter().rename`. Risque
		   jugé faible sous ce hôte (un seul utilisateur, une seule fenêtre
		   Obsidian), non corrigé faute d'API adéquate. */
		async rename(from, to) {
			if (await adapter().exists(to)) throw new Error(`${to} existe déjà`);
			await adapter().rename(from, to);
		},
		listMarkdown() {
			return app.vault.getMarkdownFiles().map(toHostFile);
		},
		// TOUS les homonymes, casse ignorée : l'appelant prévient l'utilisateur
		// quand il y en a plusieurs. N'en rendre qu'un ferait disparaître
		// l'avertissement sans que rien ne le signale.
		findByName(name) {
			const cible = String(name ?? "").trim().toLowerCase();
			if (!cible) return [];
			return app.vault.getFiles()
				.filter(f => String(f?.name ?? "").trim().toLowerCase() === cible)
				.map(toHostFile);
		},
		getFile(path) {
			const f = tfile(path);
			return f ? toHostFile(f) : null;
		},
		/* TOUS les fichiers indexés, `.md` ou non : la recherche floue du
		   sélecteur « @ » note chaque chemin, images et PDF compris. */
		listFiles() {
			return app.vault.getFiles().map(toHostFile);
		},
		/* Les enfants d'un `TFolder`, réduits à des `DirEntry` — un dossier se
		   reconnaît à son tableau `children`, comme un fichier à son
		   `extension` (`asTFile`) : le bouchon des contrôles ne fabrique pas de
		   vrai `TFolder`, et `instanceof` rendrait ce chemin intestable. Un
		   chemin absent ou qui désigne un fichier rend `[]`, comme `list`. */
		async listDir(dir) {
			const cible = dir ? app.vault.getAbstractFileByPath(dir) : app.vault.getRoot();
			const enfants = (cible as { children?: TAbstractFile[] } | null)?.children;
			if (!Array.isArray(enfants)) return [];
			return enfants.map(c => ({
				name: c.name,
				path: c.path,
				isFolder: Array.isArray((c as { children?: unknown }).children),
			}));
		},
		/* Les racines externes (`aiMentionExtraFolders`) n'ont plus d'appelant
		   sous Obsidian depuis la tâche 2 du chantier « greffon lecteur » :
		   son seul consommateur était le sélecteur « @ » de la génération IA
		   (`src/dashboard/file-sources.ts`, `prompt-paths.ts`), retiré du
		   greffon à la tâche 1. `HostFs.externe` reste OBLIGATOIRE au contrat
		   (l'application le fournit toujours, pour le même sélecteur) : ces
		   quatre méthodes restent donc là, mais réduites à leur réponse
		   « rien à montrer » — sans quoi ce fichier importerait encore Node
		   pour du code que plus rien n'appelle. */
		externe: {
			async list() { return []; },
			async stat() { return null; },
			async read(abs) { throw new Error("pas de disque sur cet hôte : " + abs); },
			async readBinary(abs) { throw new Error("pas de disque sur cet hôte : " + abs); },
		},
	};

	/* ─── links ─── */

	/* Ordre repris tel quel de `engine/sanitizer.ts` : le `metadataCache`
	   d'abord (lui seul comprend « schema.png » écrit depuis n'importe quelle
	   note), le chemin nu ensuite. Les deux appels sont gardés séparément :
	   une API interne qui jette ne doit pas emporter le repli avec elle.

	   Sorti de l'objet `links` pour être partagé par `resolve` ET
	   `resourceUrl` : le contrat impose à `resourceUrl` de RÉSOUDRE avant de
	   convertir, et deux résolutions écrites séparément divergent. Rend le
	   `TFile`, pas un `HostFile` : `getResourcePath` en a besoin. */
	function resoudreTFile(linkPath: string, fromPath: string): TFile | null {
		const raw = String(linkPath ?? "").trim();
		if (!raw) return null;

		try {
			if (app.metadataCache?.getFirstLinkpathDest) {
				const f = app.metadataCache.getFirstLinkpathDest(raw, fromPath || "");
				if (f) return f;
			}
		} catch (e) {
			console.warn("[Quiz] resolve (metadataCache) erreur:", e);
		}

		try {
			const f2 = asTFile(app.vault?.getAbstractFileByPath?.(raw));
			if (f2) return f2;
		} catch (e) {
			console.warn("[Quiz] resolve (getAbstractFileByPath) erreur:", e);
		}

		return null;
	}

	const links: Host["links"] = {
		resolve(linkPath, fromPath) {
			const f = resoudreTFile(linkPath, fromPath);
			return f ? toHostFile(f) : null;
		},
		/* « RÉSOUT puis convertit » (src/host/types.ts) : une chaîne passe par
		   `resoudreTFile` et rend `null` si rien ne correspond. L'ancien code
		   servait `adapter().getResourcePath(chemin)` sans rien vérifier — il
		   ne rendait donc JAMAIS `null` pour une chaîne non vide, ce qui
		   rendait morte la branche « chemin non résoluble » de son unique
		   appelant (`src/engine/cards.ts`) et laissait cassé un nom nu
		   (« schema.png ») référencé depuis un sous-dossier.

		   `null` et JAMAIS la chaîne vide : un `src=""` fait recharger la page
		   courante comme image — requête inutile et image cassée. */
		resourceUrl(target, fromPath) {
			try {
				const f = typeof target === "string"
					? resoudreTFile(target, fromPath || "")
					: tfile(target.path);
				return (f && app.vault.getResourcePath(f)) || null;
			} catch (e) {
				console.warn("[Quiz] resourceUrl erreur:", e);
				return null;
			}
		},
	};

	/* ─── watcher ─── */

	const watcher: Host["watcher"] = {
		/* Les quatre évènements du vault, traduits en `HostFileEvent`. `rename`
		   reste distinct de delete+create : le journal de révision suit ses clés
		   par renommage, et deux évènements ne se recollent pas.
		   Seuls les fichiers remontent — un dossier créé ne concerne personne. */
		onChange(cb) {
			const refs: EventRef[] = [];
			const emettre = (ev: HostFileEvent): void => {
				try { cb(ev); } catch (e) { console.warn("[Quiz] watcher: rappel en erreur:", e); }
			};

			refs.push(app.vault.on("create", (f: TAbstractFile) => {
				const file = asTFile(f);
				if (file) emettre({ kind: "create", file: toHostFile(file) });
			}));
			refs.push(app.vault.on("modify", (f: TAbstractFile) => {
				const file = asTFile(f);
				if (file) emettre({ kind: "modify", file: toHostFile(file) });
			}));
			// `delete` ne porte que le chemin : le fichier n'existe plus, rien à
			// convertir, et le contrat le dit ainsi.
			refs.push(app.vault.on("delete", (f: TAbstractFile) => {
				if (asTFile(f)) emettre({ kind: "delete", path: f.path });
			}));
			refs.push(app.vault.on("rename", (f: TAbstractFile, oldPath: string) => {
				const file = asTFile(f);
				if (file) emettre({ kind: "rename", file: toHostFile(file), oldPath });
			}));

			return () => {
				for (const ref of refs) {
					try { app.vault.offref(ref); } catch (e) { /* best effort */ }
				}
				refs.length = 0;
			};
		},
		/* `asTFile` rend null pour un DOSSIER : c'est exactement le cas que
		   `onChange` écarte, et celui dont le journal a besoin. Obsidian émet
		   le même évènement pour les deux, avec la même signature
		   (`TAbstractFile`) — d'où ce second abonnement plutôt qu'un champ
		   « isDir » que l'app ne saurait pas remplir honnêtement. */
		onRenameDir(cb) {
			const ref = app.vault.on("rename", (f: TAbstractFile, oldPath: string) => {
				if (asTFile(f)) return;
				try { cb({ from: oldPath, to: f.path }); } catch (e) { console.warn("[Quiz] onRenameDir: rappel en erreur:", e); }
			});
			return () => { try { app.vault.offref(ref); } catch (e) { /* best effort */ } };
		},
	};

	/* ─── ui ─── */

	const ui: Host["ui"] = {
		/* Le message arrive DÉJÀ TRADUIT par son appelant : l'hôte n'a aucune
		   chaîne de son cru. Le `try/catch` est le comportement actuel de
		   `quizNotice` — hors fenêtre Obsidian, `new Notice` jette, et une
		   notification perdue ne doit pas emporter le rendu avec elle. */
		notice(message, timeoutMs = 4000) {
			try { new Notice(String(message), timeoutMs); } catch (_) { console.log("[Quiz]", message); }
		},
		setIcon(el, name) {
			setIcon(el, name);
		},
		/* `getIconIds()` rend « lucide-x » ; le contrat veut « x ». Le préfixe
		   est retiré ICI et nulle part ailleurs, pour que le code partagé n'ait
		   jamais à savoir quel hôte le lui a donné (`icon-picker.ts` le faisait
		   lui-même, donc sous Obsidian seulement). */
		iconNames() {
			return getIconIds().map(id => id.replace(/^lucide-/, ""));
		},
	};

	/* ─── math ─── */

	/* Mémoïsation reprise de `engine/mathjax.ts` : MathJax n'est chargé qu'une
	   fois par session. Un ÉCHEC, lui, n'est pas mémoïsé — sinon une panne
	   transitoire (appel très tôt, environnement dégradé) tuerait le rendu
	   mathématique pour TOUTE la session, sans plus jamais retenter. */
	let mathReady: Promise<void> | null = null;

	const math: Host["math"] = {
		ready() {
			if (!mathReady) {
				mathReady = loadMathJax();
				mathReady.catch(() => { mathReady = null; });
			}
			return mathReady;
		},
		render(latex, display) {
			return renderMath(latex, display);
		},
		// Obsidian a besoin d'une passe finale après un lot de `renderMath`.
		// Sa promesse n'intéresse personne : le DOM est déjà en place.
		flush() {
			void finishRenderMath();
		},
	};

	/* ─── shell ─── */

	const shell: Host["shell"] = {
		/* Repris de `openWithDefaultAppFromVault` (engine/resources.ts).
		   Le contrat rend un booléen : la distinction « sélecteur système »
		   (Android) / « application par défaut » se redéduit chez l'appelant
		   depuis `platform.isMobile`, elle n'a pas à voyager ici. */
		async openExternal(file) {
			// Pas de racine externe sous le greffon : une chaîne (chemin ABSOLU
			// admis par le dialogue natif de l'application) n'a rien à ouvrir ici.
			if (typeof file === "string") return false;
			const f = file && tfile(file.path);
			if (!f) return false;
			try {
				// app.openWithDefaultApp : API non documentée dans obsidian.d.ts mais
				// bien présente au runtime (même convention de cast que dashboard/ai.ts).
				const appWithOpen = app as App & { openWithDefaultApp?: (path: string) => Promise<void> };
				if (typeof appWithOpen.openWithDefaultApp === "function") {
					await appWithOpen.openWithDefaultApp(f.path);
					return true;
				}
			} catch (e) {
				console.warn("[Quiz] app.openWithDefaultApp a échoué:", e);
			}
			try {
				// DataAdapter.getFullPath n'est déclaré que sur les classes concrètes
				// (FileSystemAdapter/CapacitorAdapter), pas sur l'interface générique.
				const ad = adapter() as DataAdapter & { getFullPath?: (path: string) => string };
				const absPath = ad?.getFullPath?.(f.path);
				const electronRequire = (window as Window & { require?: (id: string) => { shell?: ElectronShellLike } }).require;
				const electronShell = electronRequire?.("electron")?.shell;
				if (absPath && electronShell?.openPath) {
					// openPath rend la chaîne vide en cas de SUCCÈS, un message sinon.
					const result = await electronShell.openPath(absPath);
					if (result === "") return true;
				}
			} catch (e) {
				console.warn("[Quiz] fallback Electron openPath a échoué:", e);
			}
			return false;
		},
		/* Repris de `revealFileInObsidianExplorer` (engine/resources.ts). Rendre
		   `false` n'est pas une erreur : l'appelant enchaîne sur l'ouverture. */
		async revealInHost(file) {
			const f = file && tfile(file.path);
			if (!f) return false;
			try {
				let leaf: WorkspaceLeaf | null = (app.workspace?.getLeavesOfType?.("file-explorer") || [])[0];
				if (!leaf && typeof app.workspace?.getLeftLeaf === "function") {
					leaf = app.workspace.getLeftLeaf(false);
					if (leaf && typeof leaf.setViewState === "function") await leaf.setViewState({ type: "file-explorer", active: false });
				}
				if (!leaf) return false;
				// L'explorateur vient peut-être d'être ouvert : sa vue n'est montée
				// qu'au tick suivant, `revealInFolder` n'existerait pas encore.
				await new Promise<void>(r => setTimeout(r, 60));
				const view = leaf?.view as (View & { revealInFolder?: (file: TFile) => Promise<void> }) | undefined;
				if (view && typeof view.revealInFolder === "function") {
					await view.revealInFolder(f);
					try { app.workspace?.revealLeaf?.(leaf); } catch (_) {}
					return true;
				}
			} catch (e) {
				console.warn("[Quiz] revealInFolder a échoué:", e);
			}
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

	/* ─── platform ─── */

	const platform: Host["platform"] = {
		isMobile: Platform.isMobile,
		isMacOS: Platform.isMacOS,
		isWindows: Platform.isWin,
		/* La même source qu'`isMobile` : c'est Obsidian qui sait s'il tourne
		   dans son enveloppe Electron de bureau ou dans l'application mobile,
		   et c'est la seule question que la génération IA a le droit de poser
		   (un CLI local, un réseau atteignable). */
		isDesktopApp: Platform.isDesktopApp,
		/* Accesseur et non valeur figée : la langue d'Obsidian change sans
		   recharger le greffon, et une constante lue à l'installation resterait
		   celle du démarrage.
		   L'étiquette est rendue BRUTE (« fr », « fr-FR ») : c'est `src/i18n.ts`
		   qui décide ce qu'il en fait, pas l'hôte. `window.i18next` n'est PAS une
		   API publique (absente d'obsidian.d.ts) — d'où le repli sur
		   `<html lang>` puis l'anglais. */
		get uiLanguage(): string {
			try {
				const i18next = (window as unknown as { i18next?: I18nextLike }).i18next;
				const raw = i18next && typeof i18next.language === "string" ? i18next.language : "";
				return raw || document.documentElement.lang || "en";
			} catch (e) {
				return "en";
			}
		},
	};

	/* ─── paths ─── */

	/* UNE SEULE RACINE, d'identifiant VIDE : les chemins du greffon restent
	   exactement ce qu'ils ont toujours été, et `localPath` est l'identité.
	   C'est ce qui garantit que la clé du journal ne change pas d'un octet
	   pour les notes déjà journalisées. */
	const racine: HostRoot = {
		id: "",
		name: app.vault.getName(),
		/* Le greffon ne s'exécute QUE dans un vault : la question ne se pose pas. */
		vault: true,
		reviewLog: `${REVIEW_DIR}/${REVIEW_LOG_NAME}`,
		/* L'ancien journal : `manifest.dir` tel que l'API le donne, jamais
		   recomposé. Il est optionnel (PluginManifest.dir), et son absence
		   signifie seulement qu'il n'y a rien à migrer. */
		legacyReviewLog: plugin.manifest.dir ? `${plugin.manifest.dir}/${REVIEW_LOG_NAME}` : null,
	};

	const paths: Host["paths"] = {
		/* NE CHANGE PAS, et ignore son argument : les fichiers de résultats
		   déjà écrits chez l'utilisateur vivent là. Même nature de piège que
		   `PLUGIN_ID` et `QUIZ_BLOCK_LANGUAGE`. */
		resultsDirFor() {
			return ".obsidian/quiz-blocks-results";
		},
		/* Obsidian décide, et il déduplique déjà contre ce qui existe. On ne
		   recalcule rien : le réglage a des modes RELATIFS à la note (« ./ »,
		   « ./images ») que reproduire ici ferait diverger au premier
		   changement d'Obsidian. */
		attachmentPathFor: (name, sourcePath) =>
			app.fileManager.getAvailablePathForAttachment(name, sourcePath),
		roots() {
			return [racine];
		},
		/* Une seule racine sous Obsidian : c'est forcément elle. */
		defaultRoot() {
			return racine;
		},
		rootOf() {
			return racine;
		},
		localPath(path) {
			return path;
		},
		contractPath(_rootId, localPath) {
			return localPath;
		},
	};

	/* PLUS de `modals`, `net`, `process` NI `pdf` depuis la tâche 2 du chantier
	   « greffon lecteur » (2026-09-13) : les trois n'avaient plus qu'un
	   consommateur, le tableau de bord (modales, IA), retiré du greffon à la
	   tâche 1. Les trois membres sont OPTIONNELS au contrat
	   (`src/host/types.ts`) précisément pour cet hôte ; un appelant partagé
	   qui les redemanderait quand même échoue proprement par `requireHost`
	   (`src/host/current.ts`), qui NOMME le membre absent plutôt que de
	   planter sur un `undefined` muet. */

	return { fs, links, watcher, ui, math, shell, platform, paths };
}
