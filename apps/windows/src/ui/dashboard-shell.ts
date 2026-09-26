/* ══════════════════════════════════════════════════════════
   LA COQUILLE DU TABLEAU DE BORD, CÔTÉ APPLICATION

   Sous Obsidian, `src/dashboard.ts` était un `ItemView` : il portait le cycle
   de vie d'un onglet et un `Scope` de raccourcis, qui ne sont pas portables.
   Ce fichier fait les choses que `dashboard.ts` faisait et qui comptent :
   monter le rail, router entre les pages, assembler le `ctx` — et, depuis le
   2026-09-25, l'historique des boutons « précédent » / « suivant » de la
   souris (`historique-nav.ts`).

   Les PAGES, elles, sont les mêmes qu'Obsidian : `src/dashboard/nav.ts`,
   `home.ts`, `quizzes.ts`, et depuis la tranche 3 la page d'un quiz,
   `detail.ts` (questions à gauche, question courante à droite, bouton
   « Editor »). Une copie divergerait, et les deux tableaux de bord
   finiraient par compter différemment.

   La page d'un quiz est une VUE de la coquille (`vueCourante === "detail"`),
   exactement comme sous Obsidian (`dashboard.ts`, `case "detail"`), et non
   un écran que `main.ts` monterait à la place de la coquille : le retour
   doit rouvrir le DOSSIER du quiz (`quizzes.openFolderOfQuiz`), et c'est
   l'instance de `createQuizzesHandlers` restée vivante qui sait le faire.
   Seul le MOTEUR (jouer) remplace la coquille — c'est `main.ts` qui le
   monte, par `deps.onOpenQuiz`.

   Ce module n'importe AUCUN CSS — même contrainte que les modules d'hôte :
   un import de CSS y tire les fontes MathLive, pour lesquelles le harnais
   des scripts de contrôle n'a pas de chargeur. Les classes (`qbd-layout`,
   `qbd-sidebar`, `qbd-content`…) viennent de `src/assets/css/`, déjà chargé
   par `main.ts`.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../../../../src/dom";
import { creerHistorique } from "./historique-nav";
import { t } from "../../../../src/i18n";
import { currentHost } from "../../../../src/host/current";
import { createNavHandlers } from "../../../../src/dashboard/nav";
import { createHomeHandlers } from "../../../../src/dashboard/home";
import { createQuizzesHandlers } from "../../../../src/dashboard/quizzes";
import { createDetailHandlers } from "../../../../src/dashboard/detail";
import { createAiHandlers } from "../../../../src/dashboard/ai";
import { aiSettingsDefaults } from "../../../../src/dashboard/ai-settings-host";
import type { AiSettingsHost } from "../../../../src/dashboard/ai-settings-host";
import { openIconPicker } from "../../../../src/dashboard/icon-picker";
import { openCreateFolderModal } from "../../../../src/dashboard/folder-create";
import { openAddContentModal } from "../../../../src/dashboard/folder-add";
import { ouvrirPartage } from "./partage";
import { annulerDerniereSuppression, buildModuleCardMenu, buildQuizCardMenu } from "../../../../src/dashboard/quiz-menu";
import { moduleIcon } from "../../../../src/dashboard/module-icons";
import { moduleAccent } from "../../../../src/dashboard/module-color";
import { createSelect, openActionMenu } from "../../../../src/dashboard/ui-select";
import type { DashboardPageSettings, DashboardShellCtx, DashboardViewName, NavigateData } from "../../../../src/types/dashboard-ctx";
import type { QuizIndexEntry, Scanner } from "../../../../src/dashboard/scanner";
import type { StatsStore } from "../../../../src/dashboard/stats-store";
import type { ReviewStore } from "../../../../src/review/review-store";
import type { ModuleOverride } from "../../../../src/dashboard/quiz-modules";
import { ecrireReglage, estVaultObsidian, examDates, lireReglage, pickFolder, savedFolders, setExamDate as setExamDateReglage } from "../host/folder";
import { cleModule } from "../review/catalogue";
import { pont } from "../host/pont";
import { monterBoutonRail } from "./mise-a-jour";
import { noterVue } from "./reprise";
import type { DerniereVue } from "./reprise";
import type { SessionsApp } from "../review/sessions";

/* ══════════════════════════════════════════════════════════
   LES RÉGLAGES DES PAGES « ACCUEIL » / « MES QUIZ »

   Mêmes CINQ clés que côté greffon (plugin.ts DEFAULT_SETTINGS), sur le
   modèle d'`examDates` (host/folder.ts) : un cache en mémoire chargé au
   démarrage, une fonction qui écrit. Les noms de clés persistées sont
   repris À L'IDENTIQUE — ce sont les mêmes que `ctx.settings` côté greffon,
   et les renommer « parce que c'est l'app » créerait deux vocabulaires pour
   la même donnée.

   `reglagesPages()` renvoie CET OBJET, pas une copie : les pages le MUTENT
   en place (dossier déplié, axe de regroupement changé) puis appellent
   `ctx.saveSettings()` — une copie romprait ce contrat, les mutations se
   perdraient sans jamais atteindre le disque.
══════════════════════════════════════════════════════════ */

let reglagesPagesCache: DashboardPageSettings = {};

/**
 * À charger UNE FOIS au démarrage (main.ts, comme `chargerExamDates`) :
 * sans cet appel, la première page de la session verrait des réglages vides
 * (aucun dossier déplié, axe par défaut) jusqu'au premier `saveSettings()`.
 */
export async function chargerReglagesPages(): Promise<DashboardPageSettings> {
	reglagesPagesCache = {
		quizzesExpandedFolders: (await lireReglage<string[]>("quizzesExpandedFolders")) ?? undefined,
		quizzesGrouping: (await lireReglage<string>("quizzesGrouping")) ?? undefined,
		quizzesModuleOverrides: (await lireReglage<Record<string, ModuleOverride>>("quizzesModuleOverrides")) ?? undefined,
		quizzesModuleMapNote: (await lireReglage<string>("quizzesModuleMapNote")) ?? undefined,
		quizzesArchivedFolders: (await lireReglage<string[]>("quizzesArchivedFolders")) ?? undefined,
		quizzesGroupModes: (await lireReglage<boolean>("quizzesGroupModes")) ?? undefined,
	};
	return reglagesPagesCache;
}

/** Réunir Learn et Practice d'un même cours en une carte : oui par défaut.
    Lu et écrit PAR LE CACHE des réglages de pages, jamais directement dans
    le fichier : la page « Mes quiz » réécrit ce cache à chaque changement, et
    une écriture à côté serait écrasée au suivant. */
export function regroupementModes(): boolean {
	return reglagesPagesCache.quizzesGroupModes !== false;
}

export async function reglerRegroupementModes(actif: boolean): Promise<void> {
	reglagesPagesCache.quizzesGroupModes = actif;
	await ecrireReglage("quizzesGroupModes", actif);
}

function reglagesPages(): DashboardPageSettings {
	return reglagesPagesCache;
}

async function enregistrerReglagesPages(): Promise<void> {
	// `?? null`/`?? []` : un réglage effacé par la page (retour à « aucun »)
	// doit s'écrire comme tel, jamais laisser une ancienne valeur trainer.
	await ecrireReglage("quizzesExpandedFolders", reglagesPagesCache.quizzesExpandedFolders ?? []);
	await ecrireReglage("quizzesGrouping", reglagesPagesCache.quizzesGrouping ?? null);
	await ecrireReglage("quizzesModuleOverrides", reglagesPagesCache.quizzesModuleOverrides ?? {});
	await ecrireReglage("quizzesModuleMapNote", reglagesPagesCache.quizzesModuleMapNote ?? null);
	await ecrireReglage("quizzesArchivedFolders", reglagesPagesCache.quizzesArchivedFolders ?? []);
	await ecrireReglage("quizzesGroupModes", reglagesPagesCache.quizzesGroupModes ?? null);
}

/* ══════════════════════════════════════════════════════════
   LA COQUILLE
   ══════════════════════════════════════════════════════════ */

/**
 * Vue actuellement affichée par le tableau de bord. Volontairement au niveau
 * du MODULE, et non locale à `monterDashboard` : ce module est un singleton
 * (une seule fenêtre), et c'est cette persistance qui fait qu'ouvrir un quiz
 * puis revenir remonte la coquille sur la page d'où l'on venait, plutôt que
 * de toujours repartir sur « Accueil » (`main.ts` démonte puis remonte
 * entièrement la coquille à chaque aller-retour vers un quiz ou les
 * réglages — un état local serait perdu à chaque fois). Initialisée à
 * "home" : la toute première fois que l'application démarre.
 */
let vueCourante: DashboardViewName = "home";

/**
 * Le quiz de la page « detail », et la vue d'où l'on y est entré — au niveau
 * du MODULE pour la même raison que `vueCourante` : jouer un quiz depuis sa
 * page remplace la coquille par le moteur, et le retour doit ramener SUR
 * CETTE PAGE (comme sous Obsidian, où le tableau de bord reste sur le détail
 * pendant que la note s'ouvre à côté), puis sa flèche retour au bon endroit.
 * C'est le `selectedQuiz`/`previousView` de `QuizDashboardView`.
 * `vuePrecedente` ne vaut jamais "detail" : elle n'est prise qu'en QUITTANT
 * une autre vue (le greffon, lui, la recopie sans garde et peut ainsi
 * renvoyer un détail vers lui-même).
 */
let quizSelectionne: QuizIndexEntry | null = null;
let vuePrecedente: DashboardViewName = "home";

/**
 * L'HISTORIQUE des boutons « précédent » et « suivant » de la souris (2026-09-25,
 * portage de l'historique de l'ancienne vue Obsidian) : la page, le dossier
 * ouvert dans « Mes quiz » et le quiz de la page « detail ». Au niveau du
 * MODULE, comme `vueCourante` : jouer un quiz démonte la coquille, et revenir
 * ne doit pas effacer le chemin parcouru. État d'interface, jamais persisté.
 */
interface EtatNav {
	vue: DashboardViewName;
	/** Dossier ouvert — seulement quand `vue` vaut "quizzes". */
	dossier: string | null;
	/** Quiz affiché — seulement quand `vue` vaut "detail". */
	quiz: QuizIndexEntry | null;
}
const memeEtatNav = (a: EtatNav, b: EtatNav): boolean =>
	a.vue === b.vue && a.dossier === b.dossier && (a.quiz?.path ?? null) === (b.quiz?.path ?? null);
const historiqueNav = creerHistorique<EtatNav>(memeEtatNav);

/**
 * La question COURANTE au tout premier rendu de la page « detail » (celle sur
 * laquelle l'éditeur s'ouvre ; la fiche reste l'écran d'ouverture), posée
 * par `reprendre()` au démarrage (reprise de session) et consommée par le
 * prochain `peindre()` — même patron que `editionEnAttente`, un état posé
 * une fois et remis à `undefined` aussitôt lu, pour qu'un aller-retour
 * ultérieur sur ce quiz reparte de la question courante et non de celle
 * de la session précédente.
 */
let questionInitiale: number | undefined;

/**
 * Pose l'état de la coquille AVANT le tout premier `monterDashboard`, pour
 * reprendre la session précédente : appelée par `main.ts`, juste après avoir
 * chargé le réglage (`chargerReprise`) et juste avant de monter. Fonction de
 * MODULE et non de `monterDashboard` : `ctx.canOpen` n'existe qu'une fois la
 * coquille montée, et la reprise doit poser son état AVANT ce montage. Sa
 * seule garde ici est celle qu'`ctx.canOpen` vaut de toute façon dans cette
 * application — `() => true`, toutes les vues sont ouvertes (voir `ctx`
 * ci-dessous) : les deux ne peuvent pas diverger tant que ce reste vrai.
 *
 * `"detail"` exige que le quiz existe ENCORE dans le catalogue : une note
 * supprimée entre deux lancements n'est pas une erreur, elle ramène
 * silencieusement à l'accueil (pas de Notice, voir le brief). Rend `false`
 * dans ce seul cas — l'appelant laisse alors la coquille démarrer sur son
 * défaut ("home").
 */
export function reprendre(vue: DerniereVue, scanner: Scanner): boolean {
	if (vue.vue === "detail") {
		const quiz = vue.quiz ? scanner.getQuiz(vue.quiz) : undefined;
		if (!quiz) return false;
		quizSelectionne = quiz;
		vuePrecedente = "quizzes";
		vueCourante = "detail";
		questionInitiale = vue.question;
		return true;
	}
	vueCourante = vue.vue;
	return true;
}

export interface MonterDashboardDeps {
	scanner: Scanner;
	statsStore: StatsStore;
	/** Le journal de révision — l'application le fournit toujours (construit
	    par `creerJournalApp`), contrairement au greffon où `plugin._reviewStore`
	    peut manquer. Le champ reste néanmoins celui de `DashboardShellCtx`
	    (optionnel), pour ne pas inventer un second contrat. */
	reviewStore: ReviewStore;
	/** Les réglages IA de l'application (`main.ts`), pour la page « Générer ». */
	aiSettings: AiSettingsHost;
	/** Traduit un chemin ABSOLU du disque en chemin du CONTRAT, ou `null` s'il
	    ne relève d'aucune racine ouverte. C'est `depuisAbsolu` de la carte des
	    racines (`main.ts`), passée et non recopiée : elle porte la règle « la
	    plus longue racine gagne », sans laquelle un dossier ouvert dans un
	    autre donnerait deux chemins pour le même fichier — donc deux
	    historiques de révision. */
	cheminDuContrat(absolu: string): string | null;
	/** L'inverse : chemin du contrat → chemin ABSOLU, ou `null` hors racines.
	    Pour `ctx.openPath` (ouvrir un document avec le système), qui parle au
	    principal en chemin absolu — `systeme.ouvrir`, borné au périmètre. */
	cheminAbsolu(contrat: string): string | null;
	onOpenQuiz(entry: QuizIndexEntry): void;
	onOpenSettings(): void;
	/** Les sessions en cours (2026-09-26) : reprendre un quiz là où on
	    s'était arrêté. Lues par `sessionOf` (le « Reprendre » du dossier) ;
	    absentes, pas de « Reprendre ». */
	sessions?: SessionsApp;
}

/**
 * Monte le rail + la page courante dans `root`, et rend le démontage.
 *
 * `root` DOIT être vide à l'appel (comme pour `renderSettings`/`openQuizPage`) :
 * c'est `main.ts` qui vide le conteneur avant chaque changement d'écran, au
 * même titre que le `demonterCourant` qu'il appelle avant tout remontage.
 *
 * Le démontage rend une PROMESSE : il démonte tout de suite (abonnement au
 * scanner, écoute clavier de la page d'un quiz), et se résout quand
 * l'écriture que cette page tenait en attente est TERMINÉE. Un changement
 * d'écran n'a pas à l'attendre ; la fermeture de la fenêtre, si — c'est
 * `main.ts` qui décide lequel des deux il est.
 */
export function monterDashboard(root: HTMLElement, deps: MonterDashboardDeps): () => Promise<void> {
	const layout = ajouter(root, "div", "qbd-layout");
	// `qbd-sidebar` et non `qbd-nav` : c'est la classe que `src/assets/css/
	// dashboard/dashboard-base.css` habille (largeur, fond transparent) — le
	// rail est PEUPLÉ de nœuds `qbd-nav-*` (brand, items, footer) par
	// `nav.render()`, mais son propre conteneur porte `qbd-sidebar`, exactement
	// comme sous Obsidian (`dashboard.ts`, `onOpen`). Un conteneur `qbd-nav`
	// nu n'a AUCUNE règle : le rail se serait retrouvé sans largeur ni fond.
	const navEl = ajouter(layout, "div", "qbd-sidebar");
	const contentEl = ajouter(layout, "div", "qbd-content");

	/* Dernière vue effectivement PEINTE dans CE montage — jamais persistée
	   au niveau du module, à l'inverse de `vueCourante` : le DOM est neuf à
	   chaque montage (root vidé par main.ts), donc le tout premier rendu
	   doit toujours jouer son entrée, y compris au retour d'un quiz. */
	let dernierePeinte: DashboardViewName | null = null;

	/* Le presse-papiers du pont, partagé par le menu « ⋯ » (copier un chemin)
	   et le modal d'installation (`ai-install-modal.ts`, copier une commande) :
	   `navigator.clipboard` est refusé côté rendu, le principal seul peut
	   écrire dans le presse-papiers système. */
	const copierTexte = async (texte: string): Promise<boolean> => {
		try { await pont().systeme.copierTexte(texte); return true; } catch { return false; }
	};

	const ctx: DashboardShellCtx = {
		scanner: deps.scanner,
		statsStore: deps.statsStore,
		settings: reglagesPages(),
		saveSettings: () => enregistrerReglagesPages(),
		navigate: (vue, data) => naviguer(vue, data),
		/* L'historique des boutons de souris : la page « Mes quiz » l'appelle
		   juste avant d'entrer dans un dossier ou d'en sortir, qui ne passe pas
		   par `navigate`. */
		recordNav: () => enregistrerNav(),
		/* JOUER DEPUIS N'IMPORTE OÙ RAMÈNE À LA PAGE DU QUIZ (2026-09-26). La
		   coquille est démontée pendant le jeu puis remontée au retour, sur
		   `vueCourante` : lancé depuis la pastille Learn d'une carte, le retour
		   retombait sur « Mes quiz »… à la grille RACINE, le dossier ouvert
		   étant un état de l'instance détruite. On se place donc sur la fiche
		   du quiz AVANT de partir ; sa flèche retour rouvre ensuite le dossier
		   (`openFolderOfQuiz`, voir `onBack` plus bas). Depuis la fiche
		   elle-même, rien ne change. */
		openQuiz: (quiz) => {
			if (vueCourante !== "detail" || quizSelectionne?.path !== quiz.path) {
				if (!memeEtatNav(etatCourant(), { vue: "detail", dossier: null, quiz })) enregistrerNav();
				if (vueCourante !== "detail") vuePrecedente = vueCourante;
				quizSelectionne = quiz;
				vueCourante = "detail";
				ouvertureEnAttente = true;
				noterVue({ vue: "detail", quiz: quiz.path });
			}
			deps.onOpenQuiz(quiz);
		},
		openSettings: () => deps.onOpenSettings(),
		/* Toutes les vues, la génération comprise (tranche 5, tâche 6) : la page
		   « Générer » tourne ici, Ollama pour de bon ; Claude et Codex jusqu'à
		   ce que l'hôte sache lancer un CLI (tâche 7 — d'ici là, une Notice
		   « fournisseur indisponible » propre, jamais un composer mort). */
		canOpen: () => true,
		reviewStore: deps.reviewStore,
		sessionOf: (path) => {
			const s = deps.sessions?.toutes()[path];
			const quiz = deps.scanner.getQuiz(path);
			if (!s || !quiz || s.courante === null) return null;
			const i = quiz.items.findIndex(it => it.id === s.courante);
			return i < 0 ? null : { question: i + 1, total: quiz.items.length, ecrite: s.ecrite };
		},
		pickIcon: (anchor, courante, onPick, suggestions) => {
			openIconPicker(anchor, courante, onPick, document.body, suggestions ?? []);
		},
		createFolder: (map, quizzes, done) => openCreateFolderModal(ctx, map, quizzes, done),
		openExistingFolder: (done) => { void ouvrirDossierExistant(done); },
		/* Le SAS des quiz générés : le MÊME calcul que `saveGeneratedQuiz`
		   (ai.ts, `defaultDestination`) — racine par défaut + `aiOutputFolder`.
		   Lu à chaque appel : le réglage peut changer sans remonter la coquille. */
		/* Ouvrir un document (PDF, image) du dossier avec l'application du
		   système : `systeme.ouvrir` du pont, BORNÉ au périmètre par le principal
		   et fermé aux extensions exécutables (`EXTENSIONS_EXECUTABLES`). Le
		   rendu ne transmet qu'un chemin qu'il a lui-même traduit depuis le
		   contrat — jamais un chemin venu d'ailleurs. */
		openPath: async (path) => {
			const absolu = deps.cheminAbsolu(path);
			if (!absolu) return false;
			try { return await pont().systeme.ouvrir(absolu); } catch { return false; }
		},
		/* Une note de VAULT s'ouvre dans Obsidian, par l'URI `obsidian://open`
		   (le principal la remet à `shell.openExternal`, comme un lien web).
		   Le nom du vault est le nom de son dossier — c'est ainsi qu'Obsidian
		   les nomme —, et le chemin de la note est LOCAL à la racine, sans
		   `.md`. Un dossier qui n'est pas un vault rend `false`, et l'appelant
		   ouvre la note par le système. */
		openInObsidian: async (path) => {
			const host = currentHost();
			const racine = host.paths.rootOf(path);
			if (!racine) return false;
			const absolu = deps.cheminAbsolu(racine.id);
			if (!absolu || !(await estVaultObsidian(absolu))) return false;
			const vault = absolu.replace(/\/+$/, "").split("/").pop() ?? "";
			if (!vault) return false;
			const local = host.paths.localPath(path).replace(/\.md$/i, "");
			window.open(`obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(local)}`, "_blank");
			return true;
		},
		/* `fichiers.stat` du pont, borné au périmètre par le principal comme
		   toute lecture — `null` si absent ou si c'est un dossier. */
		fileMtime: async (path) => {
			const absolu = deps.cheminAbsolu(path);
			if (!absolu) return null;
			try { return (await pont().fichiers.stat(absolu))?.mtime ?? null; } catch { return null; }
		},
		/* Le chemin absolu, pour le presse-papiers. Les SÉPARATEURS sont ceux
		   du système : le pont parle en « / » partout, mais un chemin Windows
		   collé dans l'explorateur ou envoyé à quelqu'un s'écrit avec des
		   « \\ ». Le test porte sur la LETTRE DE LECTEUR et non sur une
		   variable d'environnement : c'est la seule chose qui distingue ici un
		   chemin Windows d'un chemin POSIX, et `pack:linux` existe. */
		copyText: copierTexte,
		absolutePath: (path) => {
			const absolu = deps.cheminAbsolu(path);
			if (!absolu) return null;
			return /^[a-zA-Z]:\//.test(absolu) ? absolu.replace(/\//g, "\\") : absolu;
		},
		generatedFolder: () => {
			const host = currentHost();
			const local = deps.aiSettings.get().aiOutputFolder || aiSettingsDefaults().aiOutputFolder;
			return host.paths.contractPath(host.paths.defaultRoot().id, local);
		},
		renderGroupingSelect: (container, opts) => createSelect(container, opts),
		/* Les MÊMES bâtisseurs que le greffon (`src/dashboard.ts`), sur le
		   même `ctx` : le menu « ⋯ » ne demande que `DashboardShellCtx` depuis
		   la tranche 3 (tâche 9), et c'est l'hôte qui l'OUVRE (`openActionMenu`,
		   portalé au `<body>`) avec le `rerender` de la page qui l'affiche. */
		openCardMenu: (quiz, anchor, rerender) => {
			openActionMenu(anchor, buildQuizCardMenu(ctx, rerender)(quiz));
		},
		openModuleMenu: (group, anchor, rerender, map) => {
			openActionMenu(anchor, buildModuleCardMenu(ctx, rerender, map)(group, anchor));
		},
		/* LA DATE D'EXAMEN D'UN DOSSIER, saisie dans « Modifier dossier »
		   (menu « ⋯ » d'une carte de module) — elle n'a plus de section dans
		   les Réglages depuis le 2026-09-17 : la régler à l'endroit où on voit
		   le dossier vaut mieux qu'une liste plate de toutes les matières,
		   dont deux pouvaient porter le même nom.

		   LA CONVERSION DE CLÉ EST ICI, et nulle part ailleurs : le code
		   partagé ne connaît qu'un nom de segment, l'ordonnanceur veut une clé
		   qui porte la racine. N'IMPORTE QUEL quiz du groupe la donne — ils
		   sont tous dans le même dossier, donc tous sous la même clé (la page
		   n'appelle jamais ces membres sur un groupe vide, et `cleModule`
		   n'aurait alors rien à lire). */
		examDate: group => {
			const quiz = group.quizzes[0];
			return quiz ? examDates()[cleModule(quiz.path, currentHost().paths)] : undefined;
		},
		setExamDate: (group, date) => {
			const quiz = group.quizzes[0];
			if (!quiz) return;
			/* `setExamDate` met la table à jour EN MÉMOIRE de façon synchrone
			   avant d'écrire : le plan, qui la relit à chaque calcul, est déjà
			   juste quand la promesse d'écriture est encore en vol. */
			void setExamDateReglage(cleModule(quiz.path, currentHost().paths), date ?? "");
		},
		// « Nouveau quiz » : une note vierge, puis sa page en ÉDITION par
		// `openQuizPath` ci-dessous — l'éditeur existe désormais dans la fenêtre.
		createQuiz: (folder, done) => openAddContentModal(ctx, folder, done),
		/* La page d'un quiz PAR CHEMIN, pour une note que le catalogue n'a pas
		   forcément encore. Son seul appelant (`createQuizInFolder`,
		   folder-create.ts) l'appelle juste après `fs.write`, AVANT que le
		   surveillant (débouncé de 300 ms, `host/fs.ts`) n'ait fait indexer la
		   note par le scanner : passer par `scanner.getQuiz(path)` ici rendait
		   `null` une fois sur une. La page, elle, pourrait s'ouvrir aussitôt
		   (`loadQuizDraft` lit l'hôte, dont l'index est recalé à l'écriture —
		   « LA FRAÎCHEUR APRÈS UNE ÉCRITURE », `src/host/types.ts`) ; mais son
		   bouton « Start » et sa rangée de stats exigent une `QuizIndexEntry`.
		   Plutôt que de l'attendre du surveillant ou de la FABRIQUER depuis le
		   brouillon (une seconde façon de calculer `questions`/`quizType`/`items`,
		   qui divergerait du scanner), on demande au scanner d'indexer CE
		   fichier maintenant : `scanFile` est son chemin incrémental normal,
		   celui que le surveillant emprunte, et le `HostFile` frais vient de
		   `getFile`. L'évènement `create` qui arrivera ensuite retrouvera une
		   entrée identique et ne notifiera rien (comparaison hors `mtime`).
		   Mêmes Notices que le greffon (`openQuizPathInEditor`). */
		openQuizPath: async (path, opts) => {
			const file = currentHost().fs.getFile(path);
			if (!file) { currentHost().ui.notice(t("dashboard.detail.fileNotFound")); return; }
			await deps.scanner.scanFile(file);
			const entry = deps.scanner.getQuiz(path);
			if (!entry) { currentHost().ui.notice(t("dashboard.detail.noBlockInNote")); return; }
			naviguer("detail", { quiz: entry, edit: opts?.edit });
		},
		/* Partager : le modal du greffon, porté le 2026-09-25 — le fichier
		   est construit dans la fenêtre, écrit et lancé par le principal
		   (`electron/partage.ts`). */
		shareQuiz: (cible) => ouvrirPartage(cible),
		/* renameQuiz : ABSENT À DESSEIN. `renameQuiz` exige de réécrire
		   les wikilinks ENTRANTS ([[ancien nom]]), ce que seul l'index de liens
		   d'Obsidian sait faire (`fileManager.renameFile`) ; le poser sur
		   `HostFs.rename` déplacerait la note et casserait ces liens EN
		   SILENCE — une entrée absente vaut mieux qu'une entrée qui ment
		   (`types/dashboard-ctx.ts`). Il reste optionnel côté
		   `DashboardShellCtx` pour que cette absence soit un état PRÉVU, pas
		   une erreur de compilation. */
	};

	const nav = createNavHandlers(ctx);
	const home = createHomeHandlers(ctx);
	const quizzes = createQuizzesHandlers(ctx);
	const detail = createDetailHandlers(ctx);
	/* La page « Générer », la MÊME que sous Obsidian (`src/dashboard/ai.ts`),
	   sur ce que l'application sait fournir : ses réglages, le catalogue, la
	   navigation. Ni onglets ouverts (`openFiles`), ni écran d'usage (`usage`,
	   resté au greffon), ni moteur Markdown (`renderCodeBlock`, un `<pre>` nu
	   porte la même commande) : trois absences PRÉVUES par `AiPageDeps`, pas
	   des trous. */
	const ai = createAiHandlers({
		settings: deps.aiSettings,
		scanner: deps.scanner,
		statsStore: deps.statsStore,
		navigate: (vue, data) => naviguer(vue, data),
		quizFolders: () => dossiersDeQuiz(),
		copyText: copierTexte,
	});

	/**
	 * Les dossiers proposés comme destination d'un quiz généré.
	 *
	 * DEUX sources, et il faut les deux. Les dossiers DÉCLARÉS (« Créer un
	 * dossier vide », « Ouvrir un dossier existant ») portent leur chemin dans
	 * les réglages : c'est la seule trace d'un dossier encore vide, celui
	 * qu'on vient justement de désigner pour y écrire. Et les dossiers où des
	 * quiz vivent DÉJÀ, déduits du catalogue : ils n'ont jamais été déclarés,
	 * mais ce sont les plus probables.
	 *
	 * Le dossier PARENT de chaque quiz, et non son module : un quiz rangé dans
	 * un sous-dossier de sa matière doit proposer SON dossier, là où le module
	 * renverrait toute une UE sur un seul emplacement.
	 */
	function dossiersDeQuiz(): { path: string; name: string; icon: string; color: string; root: string }[] {
		const vus = new Map<string, string>();
		for (const [cle, ov] of Object.entries(ctx.settings.quizzesModuleOverrides || {})) {
			if (ov?.path) vus.set(ov.path, ov.name?.trim() || cle);
		}
		for (const q of deps.scanner.getQuizzes()) {
			const coupe = q.path.lastIndexOf("/");
			if (coupe <= 0) continue;
			const dossier = q.path.slice(0, coupe);
			if (!vus.has(dossier)) vus.set(dossier, dossier.split("/").pop() as string);
		}
		/* L'icône, la couleur et la RACINE de chaque dossier, pour que le menu
		   « Destination » les montre : deux dossiers homonymes (« Generated » dans
		   Neo Quiz et dans Personal) étaient indiscernables (Ahmed, 2026-09-17).
		   Même règle d'icône et d'accent que la carte du dossier (`moduleIcon`,
		   `moduleAccent`) : une icône choisie l'emporte, le SAS des générés a son
		   étincelle, le reste son livre. */
		function decrire(path: string, name: string): { path: string; name: string; icon: string; color: string; root: string } {
			const overrides = ctx.settings.quizzesModuleOverrides || {};
			const ov = Object.values(overrides).find(o => o?.path === path) ?? overrides[name];
			const generated = path === ctx.generatedFolder?.();
			return {
				path, name,
				icon: moduleIcon({ icon: ov?.icon, name, ue: ov?.ue }, { generated }),
				color: moduleAccent({ folder: name, color: ov?.color }, { generated }),
				root: currentHost().paths.rootOf(path)?.name ?? "",
			};
		}
		return [...vus.entries()].map(([path, name]) => decrire(path, name)).sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * « Ouvrir un dossier existant » : le sélecteur natif, puis la DÉCLARATION
	 * du dossier choisi.
	 *
	 * Ce n'est PAS `addFolder` (qui ouvre une RACINE), et la distinction est
	 * tout l'intérêt : le dossier visé est presque toujours dans une racine
	 * déjà ouverte — un dossier de cours dans un vault. L'ajouter comme
	 * seconde racine donnerait deux chemins du contrat pour les mêmes fichiers,
	 * donc deux historiques de révision pour les mêmes questions. Ici on ne
	 * déclare qu'un DOSSIER DE QUIZ : une entrée dans les overrides, avec son
	 * chemin, que « Nouveau quiz » et la page « Générer » savent viser.
	 */
	async function ouvrirDossierExistant(done: () => void): Promise<void> {
		const choisi = await pickFolder();
		// Annulation : ce n'est pas une erreur, c'est la réponse « non ».
		if (!choisi) return;
		const contrat = deps.cheminDuContrat(choisi);
		if (!contrat) {
			/* Hors racines : deux causes, deux messages. Un dossier qui CONTIENT
			   une racine ouverte mérite le sien — répondre « il est dehors »
			   quand on vient de désigner le parent de son vault ne dit pas quoi
			   faire. Dans les deux cas on refuse : l'ouvrir ferait la racine
			   gigogne que `depuisAbsolu` existe pour empêcher. */
			const racines = await savedFolders();
			const prefixe = choisi.toLowerCase() + "/";
			const contient = racines.some(r => r.path.toLowerCase().startsWith(prefixe));
			currentHost().ui.notice(t(contient
				? "dashboard.quizzes.createOpenContains"
				: "dashboard.quizzes.createOpenOutside"));
			return;
		}
		/* La CLÉ reste un segment (c'est ce que lisent `moduleForQuiz` et les
		   overrides), le CHEMIN est ce qui rend le dossier écrivable. Un nom
		   déjà déclaré n'est pas écrasé : on ne fait que lui donner son chemin. */
		const cle = contrat.split("/").pop() as string;
		const overrides: Record<string, ModuleOverride> = { ...(ctx.settings.quizzesModuleOverrides || {}) };
		overrides[cle] = { ...(overrides[cle] || {}), name: overrides[cle]?.name || cle, path: contrat };
		ctx.settings.quizzesModuleOverrides = overrides;
		await ctx.saveSettings();
		currentHost().ui.notice(t("dashboard.quizzes.createOpenDone", { name: cle }));
		done();
	}

	/** Demande « ouvrir en édition » posée par `naviguer("detail", { edit })`
	    et consommée par le prochain `peindre()` — une seule fois, le mode
	    appartient ensuite à l'utilisateur (`pendingEdit` du greffon). Locale
	    au montage : elle est toujours consommée dans le même tour. */
	let editionEnAttente = false;
	/** Posée par `naviguer("detail")` et consommée par le prochain `peindre()` :
	    l'utilisateur OUVRE la page, qui repart donc de sa fiche même sur le
	    quiz déjà ouvert. Un repeint (annulation d'une suppression) la laisse
	    fausse et garde l'écran en cours. */
	let ouvertureEnAttente = false;
	/** D'où l'on arrive sur la page du quiz (`NavigateData.entree`), consommé au rendu. */
	let entreeDetail: "generation" | undefined;

	/** Redessine la page COURANTE. Appelée à la navigation (entrée réelle) et
	    par le scanner (simple rafraîchissement) — dans les deux cas le calcul
	    d'`entering` est le même : vrai seulement si la vue diffère de la
	    dernière peinte. */
	function peindre(): void {
		contentEl.replaceChildren();
		const entering = vueCourante !== dernierePeinte;
		dernierePeinte = vueCourante;
		switch (vueCourante) {
			case "quizzes":
				// Pas de paramètre `entering` : `quizzes.ts` gère sa propre
				// transition d'entrée, calée sur son état de drill-down interne
				// (voir `createQuizzesHandlers`), pas sur celui de la coquille.
				quizzes.render(contentEl);
				break;
			case "detail": {
				const quiz = quizSelectionne;
				if (!quiz) {
					// Vue persistée sans quiz (ne devrait pas arriver : `naviguer`
					// les pose ensemble) : l'accueil plutôt qu'un contenu vide.
					vueCourante = "home";
					nav.setActive("home");
					home.render(contentEl, entering);
					break;
				}
				const edit = editionEnAttente;
				editionEnAttente = false;
				/* La cible du retour est FIXÉE à l'arrivée sur la page, comme
				   sous Obsidian (`dashboard.ts`, `case "detail"`) : lue au clic,
				   elle aurait pu être écrasée entre-temps. */
				const cible = vuePrecedente;
				// Consommée ici : le prochain rendu de CE quiz (frappe, retour
				// arrière) repart de la question courante, pas de la question
				// de la session précédente.
				const initial = questionInitiale;
				questionInitiale = undefined;
				const ouverture = ouvertureEnAttente;
				ouvertureEnAttente = false;
				const entreeAnimee = entreeDetail === "generation";
				entreeDetail = undefined;
				detail.render(contentEl, quiz, {
					startEditing: edit,
					animateEntry: entreeAnimee,
					onBack: () => {
						naviguer(cible);
						// Retour vers « Mes quiz » : le DOSSIER du quiz, pas la
						// grille racine — `naviguer` vient de refermer le drill
						// (`resetDrilldown`), d'où la réouverture, sur l'instance
						// de `quizzes` restée vivante (même geste que le greffon).
						if (cible === "quizzes") quizzes.openFolderOfQuiz(quiz.path);
					},
					isStale: () => vueCourante !== "detail",
					initialQuestion: initial,
					ouverture,
					onQuestionChange: (i) => noterVue({ vue: "detail", quiz: quiz.path, question: i }),
				});
				break;
			}
			case "ai":
				void ai.render(contentEl);
				break;
			case "home":
			default:
				home.render(contentEl, entering);
				break;
		}
	}

	/**
	 * Route un changement de vue demandé par une page (rail, carte, bouton).
	 *
	 * - `"detail"` : la page d'un quiz (`detail.ts`, la même que sous Obsidian),
	 *   demandée par une carte (`home.ts`, `quizzes-render.ts`), l'entrée
	 *   « Éditer » du menu « ⋯ » (`edit: true`) ou `openQuizPath` après
	 *   « Nouveau quiz ». Avant la tranche 3 ce cas court-circuitait vers
	 *   `deps.onOpenQuiz` (jouer), faute d'éditeur portable ; JOUER est
	 *   désormais le bouton « Start » de cette page, par `ctx.openQuiz`.
	 *   Sans quiz dans `data`, rien ne se passe — il n'y a pas de page à
	 *   montrer, et le greffon garde alors son `selectedQuiz` précédent, ce qui
	 *   afficherait ICI un quiz que l'utilisateur n'a pas demandé.
	 * - `"ai"` : la page « Générer » (tranche 5, tâche 6), demandée par le rail
	 *   ou par le bouton « Générer » de l'accueil (CTA d'en-tête ET onboarding),
	 *   qui appelle `ctx.navigate("ai")` SANS consulter `ctx.canOpen` — celui-ci
	 *   ne gouverne que l'état du rail. Le routeur le consulte quand même :
	 *   une SEULE source de vérité entre le rail et lui.
	 */
	/* ── Boutons « précédent » / « suivant » de la souris ── */
	let enRestauration = false;
	const etatCourant = (): EtatNav => ({
		vue: vueCourante,
		// Le dossier n'est un état restaurable que VU depuis « Mes quiz » : hors
		// de cette vue, `openModuleFolder` peut traîner en résidu.
		dossier: vueCourante === "quizzes" ? quizzes.getOpenFolder() : null,
		quiz: vueCourante === "detail" ? quizSelectionne : null,
	});
	/** On QUITTE l'état courant : il part sur la pile arrière. Une restauration
	    n'est pas une navigation, elle n'empile rien. */
	function enregistrerNav(): void {
		if (!enRestauration) historiqueNav.enregistrer(etatCourant());
	}
	function appliquerNav(etat: EtatNav): void {
		enRestauration = true;
		try {
			naviguer(etat.vue, etat.quiz ? { quiz: etat.quiz } : undefined);
			// `naviguer` vient de refermer le dossier : rouvrir celui de l'état.
			if (etat.vue === "quizzes" && etat.dossier !== null) quizzes.openFolder(etat.dossier);
		} finally {
			enRestauration = false;
		}
	}
	/* En CAPTURE, sur les deux phases : le bouton est consommé dès l'appui
	   (Chromium pourrait sinon y voir une navigation), l'action part au
	   relâchement. Pile vide : le clic ne fait rien. */
	const surBoutonSouris = (e: MouseEvent): void => {
		if (e.button !== 3 && e.button !== 4) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.type !== "mouseup") return;
		const cible = e.button === 3 ? historiqueNav.reculer(etatCourant()) : historiqueNav.avancer(etatCourant());
		if (cible) appliquerNav(cible);
	};

	function naviguer(vue: DashboardViewName, data?: NavigateData): void {
		/* « Créer avec l'IA » depuis un dossier : le préréglage est posé sur
		   la page AVANT qu'elle se peigne — c'est son premier `render` qui
		   joint les sources, et il a besoin de la destination déjà connue. */
		if (vue === "ai" && data?.aiPreset) ai.preset(data.aiPreset);
		/* L'état QUITTÉ va dans l'historique — sauf si la navigation est
		   refusée, ou immobile (re-clic du rail sur la page courante). */
		if (vue === "detail" ? !data?.quiz : !ctx.canOpen(vue)) return;
		if (!memeEtatNav(etatCourant(), { vue, dossier: null, quiz: vue === "detail" ? data?.quiz ?? null : null })) enregistrerNav();
		if (vue === "detail") {
			if (!data?.quiz) return;
			quizSelectionne = data.quiz;
			editionEnAttente = !!data.edit;
			ouvertureEnAttente = true;
			entreeDetail = data.entree;
			if (vueCourante !== "detail") vuePrecedente = vueCourante;
			vueCourante = "detail";
			// Aucun bouton du rail ne porte "detail" : `setActive` éteint donc
			// la carte active, comme sous Obsidian.
			nav.setActive("detail");
			// Notée SANS la question : `onQuestionChange` la précisera au premier
			// changement. Ouvrir un quiz montre sa fiche ; sa question courante
			// reste celle sur laquelle l'éditeur s'ouvre.
			noterVue({ vue: "detail", quiz: data.quiz.path });
			peindre();
			return;
		}
		if (!ctx.canOpen(vue)) return;
		// Même refermeture qu'au greffon (dashboard.ts, navigate()) : entrer
		// dans un module puis revenir par le rail doit rouvrir la GRILLE, pas
		// le module laissé ouvert.
		if (vue === "quizzes") quizzes.resetDrilldown();
		vueCourante = vue;
		nav.setActive(vue);
		noterVue({ vue });
		peindre();
	}

	nav.render(navEl);
	// Le bouton « Redémarrer pour mettre à jour » vit dans le pied du rail,
	// posé une fois pour toute la durée de la coquille — un seul abonnement
	// au pont pour toute la fenêtre (`mise-a-jour.ts`).
	const demonterMaj = monterBoutonRail(navEl);
	// Synchronise le rail sur la vue persistée (retour d'un quiz sur « Mes
	// quiz », par exemple) : `createNavHandlers` démarre chaque fois avec son
	// propre `activeNav` interne à "home".
	nav.setActive(vueCourante);
	peindre();

	// Redessine la page courante à chaque changement du catalogue — `entering:
	// false` via `peindre()` (dernierePeinte déjà à jour) : un re-render du
	// scanner ne doit pas rejouer la transition d'entrée, sinon la page
	// clignote à chaque sauvegarde de note.
	// SAUF la page d'un quiz (même exclusion que le greffon) : elle ÉCRIT dans
	// la note, donc réveille le scanner, et se ferait repeindre sous les
	// doigts à chaque frappe — brouillon et mode d'édition perdus.
	// SAUF aussi la page « Générer » (même exclusion que le greffon) : elle
	// porte un composer en cours de frappe et un popover d'options qu'un
	// rendu détruirait.
	const desabonner = deps.scanner.onChange(() => { if (vueCourante !== "detail" && vueCourante !== "ai") peindre(); });

	/* Le retour DÉSABONNE, et l'appelant DOIT l'invoquer avant tout
	   remontage — même contrat que `renderSettings`/`openQuizPage` : sans lui,
	   chaque aller-retour empilerait un abonnement de plus, et une
	   modification de note redessinerait la page courante autant de fois
	   qu'elle a été montée.
	   Il DÉMONTE aussi la page d'un quiz (`detail.dispose()`) : elle tient une
	   écoute clavier sur le `document` et, peut-être, une écriture en attente
	   — l'oublier fuyait une instance par ouverture. Le démontage est fait
	   avant le premier `await` ; seule l'écriture est attendue. Idempotent :
	   un second appel rend une promesse déjà résolue. */
	let demonte: Promise<void> | null = null;
	/* Ctrl+Z hors d'un champ : annule la dernière suppression de quiz (Ahmed,
	   2026-09-19). Dans un champ, c'est l'annulation de frappe du navigateur,
	   qu'on ne touche pas. Un menu ou une modale ne l'interceptent pas non
	   plus : supprimer, c'est déjà avoir refermé la confirmation. */
	const surCtrlZ = (e: KeyboardEvent): void => {
		if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey || e.key.toLowerCase() !== "z") return;
		const cible = e.target;
		if (cible instanceof HTMLElement && (cible.tagName === "INPUT" || cible.tagName === "TEXTAREA" || cible.isContentEditable)) return;
		e.preventDefault();
		void annulerDerniereSuppression(ctx).then(restaure => { if (restaure) peindre(); });
	};
	document.addEventListener("keydown", surCtrlZ);
	document.addEventListener("mousedown", surBoutonSouris, true);
	document.addEventListener("mouseup", surBoutonSouris, true);

	return () => {
		if (demonte) return demonte;
		document.removeEventListener("keydown", surCtrlZ);
		document.removeEventListener("mousedown", surBoutonSouris, true);
		document.removeEventListener("mouseup", surBoutonSouris, true);
		desabonner();
		demonterMaj();
		/* La page « Générer » aussi : une génération en vol, son écoute Échap
		   sur le document, son sondage Ollama et les URL d'objet de ses images
		   survivraient sinon à la coquille (même geste que l'`onClose` du
		   greffon). */
		ai.dispose();
		demonte = detail.dispose();
		return demonte;
	};
}
