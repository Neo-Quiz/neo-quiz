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
import { EVENEMENT_RETOUR, prendreRetour } from "./retour-android";
import { dossierParDefaut } from "../../../../src/dashboard/generation-demande";
import { t } from "../../../../src/i18n";
import { currentHost } from "../../../../src/host/current";
import { bindSwipe, nextTab, hapticTick, prefersReducedMotion, settleDuration, SETTLE_EASING } from "../../../../src/swipe";
import { createNavHandlers } from "../../../../src/dashboard/nav";
import { createHomeHandlers } from "../../../../src/dashboard/home";
import { createQuizzesHandlers } from "../../../../src/dashboard/quizzes";
import { createDetailHandlers } from "../../../../src/dashboard/detail";
import { createAiHandlers } from "../../../../src/dashboard/ai";
import { aiSettingsDefaults } from "../../../../src/dashboard/ai-settings-host";
import type { AiSettingsHost } from "../../../../src/dashboard/ai-settings-host";
import { openIconPicker } from "../../../../src/dashboard/icon-picker";
import { openCreateFolderModal } from "../../../../src/dashboard/folder-create";
import { openNewQuizModal } from "../../../../src/dashboard/folder-add";
import { ouvrirPartage } from "./partage";
import { annulerDerniereSuppression, buildModuleCardMenu, buildQuizCardMenu } from "../../../../src/dashboard/quiz-menu";
import { moduleIcon } from "../../../../src/dashboard/module-icons";
import { moduleAccent } from "../../../../src/dashboard/module-color";
import { createSelect, openActionMenu } from "../../../../src/dashboard/ui-select";
import type { DashboardPageSettings, DashboardShellCtx, DashboardViewName, NavigateData } from "../../../../src/types/dashboard-ctx";
import type { QuizIndexEntry, Scanner } from "../../../../src/dashboard/scanner";
import type { StatsStore } from "../../../../src/dashboard/stats-store";
import type { ReviewStore } from "../../../../src/review/review-store";
import type { ModuleGroup, ModuleOverride } from "../../../../src/dashboard/quiz-modules";
import { numeroDeReprise } from "../../../../src/lecture-etape";
import { sharedState } from "../host/shared-state";
import { rebaseModules } from "../../../../src/shared-state/merge";
import { addFolder, removeFolder, ecrireReglage, enregistrerExamen as enregistrerExamenReglage, estVaultObsidian, examens, lienAvecRacines, lireReglage, pickFolder, renommerExamens, retirerExamen as retirerExamenReglage, savedFolders } from "../host/folder";
import { cleModule, libelleModule } from "../review/catalogue";
import { viserPromptExam } from "./settings";
import { isoLocal, upcomingExams } from "../../../../src/dashboard/home-tasks";
import { pont } from "../host/pont";
import { openMoodleModal } from "./moodle-modal";
import { monterBoutonRail } from "./mise-a-jour";
import { noterVue } from "./reprise";
import { createSheetStack } from "./sheet-stack";
import { basculerMenuApp } from "./barre-titre";

/** The rail's mark (2026-09-29): a stack of cards with a mortarboard on the
    front one, an SVG (`assets/logo-rail.svg`) used as a CSS MASK
    over `currentColor` (shell.css `.nq-rail-logo-mark`) — it takes the
    rail's colour like its other icons, whatever the theme. */
function marqueRail(): HTMLElement {
	const mark = document.createElement("span");
	mark.className = "nq-rail-logo-mark";
	mark.setAttribute("aria-hidden", "true");
	return mark;
}
import type { DerniereVue } from "./reprise";
import type { SessionsApp } from "../review/sessions";
import { testSetups } from "../review/test-setups";
import { createMovedPrefix } from "../review/folder-move";

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

/** Folder settings (colour, icon, name, UE, path) live in the synced folder
    (`.neo-quiz/modules/<device>.json`, merged across devices) once the legacy
    `quizzesModuleOverrides` setting has been copied there. Until then (a failed
    migration) the setting stays the source and is still written. */
let modulesPartages = false;

async function lireOverrides(): Promise<Record<string, ModuleOverride> | undefined> {
	try {
		if (await lireReglage<boolean>("sharedModulesMigrated") === true) {
			const fusion = sharedState().modules() as Record<string, ModuleOverride>;
			modulesPartages = true;
			return fusion;
		}
	} catch (e) {
		console.warn("[quiz-blocks] shared folder settings unavailable, using the local ones:", e);
	}
	return (await lireReglage<Record<string, ModuleOverride>>("quizzesModuleOverrides")) ?? undefined;
}

/** Another device's folder settings landed (sync): adopt the merged view in
    place, the pages hold this very object. */
export function adopterOverrides(avant: Record<string, ModuleOverride>): void {
	if (!modulesPartages) return;
	/* An edit still pending in memory (the folder modal saves on close) is
	   re-applied on top of the merged view, never dropped. */
	reglagesPagesCache.quizzesModuleOverrides = rebaseModules(
		avant, reglagesPagesCache.quizzesModuleOverrides ?? {}, sharedState().modules(),
	) as Record<string, ModuleOverride>;
}

/** The merged view as it is NOW: the base `adopterOverrides` rebases from. */
export function overridesPartages(): Record<string, ModuleOverride> {
	return (modulesPartages ? sharedState().modules() : {}) as Record<string, ModuleOverride>;
}

/**
 * À charger UNE FOIS au démarrage (main.ts, comme `chargerExamDates`) :
 * sans cet appel, la première page de la session verrait des réglages vides
 * (aucun dossier déplié, axe par défaut) jusqu'au premier `saveSettings()`.
 */
export async function chargerReglagesPages(): Promise<DashboardPageSettings> {
	reglagesPagesCache = {
		quizzesExpandedFolders: (await lireReglage<string[]>("quizzesExpandedFolders")) ?? undefined,
		quizzesGrouping: (await lireReglage<string>("quizzesGrouping")) ?? undefined,
		quizzesModuleOverrides: await lireOverrides(),
		quizzesModuleMapNote: (await lireReglage<string>("quizzesModuleMapNote")) ?? undefined,
		quizzesArchivedFolders: (await lireReglage<string[]>("quizzesArchivedFolders")) ?? undefined,
	};
	return reglagesPagesCache;
}


/** The key of a folder's exams: its root and its name (`cleModule`), read
    from the FOLDER's own path. It used to come from the folder's first quiz
    only, so a folder with no quiz yet (a module just created, or emptied to
    start over) dropped the exam it was given without a word. A quiz still
    gives it when the group knows no path (folders declared before
    2026-09-17). `null`: nothing to key it with. */
function cleExamens(group: ModuleGroup): string | null {
	const paths = currentHost().paths;
	if (group.path) return cleModule(`${group.path}/_`, paths);
	const quiz = group.quizzes[0];
	return quiz ? cleModule(quiz.path, paths) : null;
}

function reglagesPages(): DashboardPageSettings {
	return reglagesPagesCache;
}

async function enregistrerReglagesPages(): Promise<void> {
	// `?? null`/`?? []` : un réglage effacé par la page (retour à « aucun »)
	// doit s'écrire comme tel, jamais laisser une ancienne valeur trainer.
	await ecrireReglage("quizzesExpandedFolders", reglagesPagesCache.quizzesExpandedFolders ?? []);
	await ecrireReglage("quizzesGrouping", reglagesPagesCache.quizzesGrouping ?? null);
	const overrides = reglagesPagesCache.quizzesModuleOverrides ?? {};
	if (modulesPartages) await sharedState().syncModules(overrides);
	else await ecrireReglage("quizzesModuleOverrides", overrides);
	await ecrireReglage("quizzesModuleMapNote", reglagesPagesCache.quizzesModuleMapNote ?? null);
	await ecrireReglage("quizzesArchivedFolders", reglagesPagesCache.quizzesArchivedFolders ?? []);
}

/* ══════════════════════════════════════════════════════════
   LA COQUILLE
   ══════════════════════════════════════════════════════════ */

/**
 * The view the dashboard is showing. Deliberately at MODULE level, not local
 * to `monterDashboard`: this module is a singleton (one window), and the
 * value must outlive a mount — the shell is remounted from scratch when the
 * app restarts on the last view (`reprendre`) rather than always starting on
 * Home. Playing a quiz does NOT touch it: the shell stays mounted behind the
 * quiz (`main.ts`, `vueGardee`) and the return repaints the view the quiz
 * was launched from. Initialised to "home": the very first start.
 */
let vueCourante: DashboardViewName = "home";

/**
 * The quiz of the "detail" page, and the view it was entered from — at
 * MODULE level for the same reason as `vueCourante` (restoring the last view
 * at startup, `reprendre`). `vuePrecedente` is never "detail": it is only
 * taken when LEAVING another view (the plugin copies it unguarded and can
 * thus send a detail page back to itself).
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

/** La séquence de la lueur, en millisecondes : à l'entrée d'un dossier, le
    bleu S'ÉTEINT ; à la sortie, il REVIENT. */
const LUEUR_ETEINT = 600;
const LUEUR_RETOUR = 400;

/** L'accent pour lequel la lueur est posée (`null` : hors dossier, le bleu),
    et l'animation en cours. Au niveau du MODULE : la lueur vit sur la racine
    du document et survit au démontage de la coquille (quiz lancé). */
let lueurCourante: string | null = null;
let lueurAnimation: Animation | null = null;

/**
 * La LUEUR de la fenêtre (`shell.css`, `--nq-lueur` et `--nq-lueur-force`).
 *
 * HORS DOSSIER (`null`) : la bande BLEUE, à pleine intensité ; si elle était
 * éteinte (on sort d'un dossier), elle revient en fondu.
 * DANS UN DOSSIER : la lueur S'ÉTEINT simplement, sans prendre la couleur
 * du dossier (Ahmed, 2026-09-26 : « la lueur devient étouffante » sur un
 * fond d'écran, puis « quand on arrive dans un dossier la lueur s'éteint
 * simplement ») — il ne reste aucune lueur dans le dossier.
 *
 * « Mes quiz » appelle ceci à CHAQUE rendu (un changement du catalogue
 * redessine la page) : le même accent ne rejoue donc rien. Un changement en
 * cours de séquence (entrer puis ressortir aussitôt) ANNULE l'animation, et
 * la suivante repart de l'intensité où l'autre en était : aucune lueur
 * coincée, aucun saut. L'état FINAL est toujours écrit en style en ligne,
 * sous l'animation : annulée ou non jouée (mouvement réduit), la lueur est
 * juste.
 */
function poserLueur(accent: string | null): void {
	if (accent === lueurCourante) return;
	lueurCourante = accent;
	const racine = document.documentElement;
	// Lue AVANT l'annulation : c'est la valeur animée, celle qu'on voit.
	const depart = Number.parseFloat(getComputedStyle(racine).getPropertyValue("--nq-lueur-force"));
	lueurAnimation?.cancel();
	lueurAnimation = null;

	// La couleur reste le bleu : dans un dossier, la lueur ne fait que s'éteindre.
	racine.style.removeProperty("--nq-lueur");
	racine.style.setProperty("--nq-lueur-force", accent ? "0" : "1");

	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const de = Number.isFinite(depart) ? String(depart) : "1";
	const animation = accent
		? racine.animate([
			{ "--nq-lueur-force": de },
			{ "--nq-lueur-force": "0" },
		], { duration: LUEUR_ETEINT, easing: "ease-in-out" })
		: racine.animate([
			{ "--nq-lueur-force": de },
			{ "--nq-lueur-force": "1" },
		], { duration: LUEUR_RETOUR, easing: "ease" });
	lueurAnimation = animation;
	animation.addEventListener("finish", () => { if (lueurAnimation === animation) lueurAnimation = null; });
}

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
	onOpenSettings(onClosed?: () => void): void;
	/** Les sessions en cours (2026-09-26) : reprendre un quiz là où on
	    s'était arrêté. Lues par `sessionOf` (le « Reprendre » du dossier) ;
	    absentes, pas de « Reprendre ». */
	sessions?: SessionsApp;
}

/**
 * Ce que rend `monterDashboard` : de quoi démonter la coquille, et de quoi la
 * REPEINDRE sans la reconstruire — le second sert à la « pile de feuilles »
 * (2026-09-27, `main.ts`, `vueGardee`) : lancer un quiz depuis la coquille ne
 * la démonte plus, elle reste montée derrière, inerte ; `repaint` est ce
 * qu'appelle `main.ts` juste avant l'animation de retour, pour que la vue
 * gardée affiche les données à jour (score, avancement) sans perdre son
 * défilement, son onglet ni ses dossiers dépliés — ce qu'un remontage complet
 * perdrait.
 */
export interface DashboardHandle {
	demonter: () => Promise<void>;
	repaint: () => void;
}

/**
 * Monte le rail + la page courante dans `root`, et rend la poignée
 * (`DashboardHandle`) qui permet de la démonter ou de la repeindre.
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
export function monterDashboard(root: HTMLElement, deps: MonterDashboardDeps): DashboardHandle {
	const layout = ajouter(root, "div", "qbd-layout");
	// `qbd-sidebar` et non `qbd-nav` : c'est la classe que `src/assets/css/
	// dashboard/dashboard-base.css` habille (largeur, fond transparent) — le
	// rail est PEUPLÉ de nœuds `qbd-nav-*` (brand, items, footer) par
	// `nav.render()`, mais son propre conteneur porte `qbd-sidebar`, exactement
	// comme sous Obsidian (`dashboard.ts`, `onOpen`). Un conteneur `qbd-nav`
	// nu n'a AUCUNE règle : le rail se serait retrouvé sans largeur ni fond.
	const navEl = ajouter(layout, "div", "qbd-sidebar");
	const contentEl = ajouter(layout, "div", "qbd-content");
	/* An open folder is a sheet over the grid, a quiz's page a sheet over
	   the page it was opened from (`sheet-stack.ts`). */
	const sheets = createSheetStack(layout, contentEl);
	/* The number of back sheets a quiz's page stands on: one more than the
	   page it was opened from, fixed when it is opened. */
	let detailDepth = 1;

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
		/* PLAYING RETURNS TO THE VIEW IT WAS LAUNCHED FROM. Launching a quiz
		   leaves the shell exactly as it is: it stays mounted behind the quiz
		   (`vueGardee` in `main.ts`, since 2026-09-27) and is only repainted
		   on return, so the open folder, its tab and the sheet stack are
		   still there — a folder's Resume button, a card's pill, a Home task
		   and the quiz page's Start button all come back to where they were
		   clicked. This used to switch to the quiz's page BEFORE leaving
		   (2026-09-26): back then the shell was unmounted while a quiz played
		   and remounted on `vueCourante`, and the open folder, being state of
		   the destroyed `quizzes` handlers, was lost — the return fell on the
		   Folders root grid. That workaround is gone: it made every return
		   land on the quiz's page, over the folder, even from the folder. */
		openQuiz: (quiz) => deps.onOpenQuiz(quiz),
		openSettings: (onClosed) => deps.onOpenSettings(onClosed),
		/* Toutes les vues, la génération comprise (tranche 5, tâche 6) : la page
		   « Générer » tourne ici, Ollama pour de bon ; Claude et Codex jusqu'à
		   ce que l'hôte sache lancer un CLI (tâche 7 — d'ici là, une Notice
		   « fournisseur indisponible » propre, jamais un composer mort). */
		/* The AI page and every entry that leads to it (rail, Home, folder
		   menus) are guarded by this: nothing generates on a phone or tablet. */
		canOpen: (vue) => vue !== "ai" || !currentHost().platform.isMobile,
		/* The Moodle window (a modal over the page). PC only. */
		openMoodle: pont().moodle && !currentHost().platform.isMobile ? () => openMoodleModal() : undefined,
		reviewStore: deps.reviewStore,
		sessionOf: (path) => {
			const s = deps.sessions?.toutes()[path];
			const quiz = deps.scanner.getQuiz(path);
			if (!s || !quiz || s.courante === null) return null;
			const i = quiz.items.findIndex(it => it.id === s.courante);
			if (i < 0) return null;
			/* Le numéro AFFICHÉ, qui saute les lectures absorbées par leur
			   étape (src/lecture-etape.ts), comme les onglets du quiz ; une
			   photo posée sur une lecture absorbée désigne la question qui la
			   montre. Le total est celui de la carte (`quiz.questions`). */
			// Hors Learn (au sens du moteur, `quiz.lecon`), rien n'est absorbé.
			const lecon = !!quiz.lecon;
			// Une lecture restée un écran n'a pas de numéro (2026-09-26) :
			// `numeroDeReprise` annonce la question qui la suit.
			return { question: numeroDeReprise(quiz.items, lecon, i), total: quiz.questions, ecrite: s.ecrite };
		},
		ambiance: (accent) => poserLueur(accent),
		sheetStack: sheets,
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
		// "Keep exam mode" writes the duration this quiz was last played with.
		rememberedTestMinutes: async (path) => (await testSetups()).read(path)?.timeLimitMinutes ?? null,
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
		openCardMenu: (quiz, anchor, rerender, map, extra) => {
			const items = buildQuizCardMenu(ctx, rerender, map)(quiz, anchor);
			// The page's own lines first, a rule before the card's.
			if (extra?.length && items[0]) items[0] = { ...items[0], sepBefore: true };
			openActionMenu(anchor, [...(extra ?? []), ...items]);
		},
		removeExtraRoot: async (rootId) => {
			await removeFolder(rootId);
			// Forget the folder declarations that pointed into the removed root.
			const overrides: Record<string, ModuleOverride> = { ...(ctx.settings.quizzesModuleOverrides || {}) };
			for (const [cle, o] of Object.entries(overrides)) {
				if (o.path === rootId || o.path?.startsWith(rootId + "/")) delete overrides[cle];
			}
			ctx.settings.quizzesModuleOverrides = overrides;
			await ctx.saveSettings();
			// Roots are installed once at startup: reload so the catalogue drops it.
			location.reload();
		},
		openModuleMenu: (group, anchor, rerender, map) => {
			openActionMenu(anchor, buildModuleCardMenu(ctx, rerender, map)(group, anchor));
		},
		/* « Gérer les examens » (module-edit.ts) ferme son modal et retombe
		   ici : naviguer vers « Mes quiz » PUIS ouvrir le dossier au bon onglet
		   sur l'instance de `quizzes` restée vivante — même geste que
		   `onBack` (`quizzes.openFolderOfQuiz`) plus bas. `quizzes` n'est
		   assigné que quelques lignes plus loin ; la fermeture ne le lit qu'à
		   l'appel, jamais à la construction de `ctx`. */
		openFolderTab: (folder, onglet) => {
			naviguer("quizzes");
			quizzes.openFolderTab(folder, onglet);
		},
		/* LES EXAMENS D'UN DOSSIER, gérés dans l'onglet Planning (tâche 4,
		   2026-09-26) — plus de section dans les Réglages depuis le
		   2026-09-17 : les régler à l'endroit où on voit le dossier vaut mieux
		   qu'une liste plate de toutes les matières, dont deux pouvaient porter
		   le même nom.

		   LA CONVERSION DE CLÉ EST ICI, et nulle part ailleurs (`cleExamens`) :
		   le code partagé ne connaît qu'un nom de segment, l'ordonnanceur veut
		   une clé qui porte la racine. */
		examens: group => {
			const cle = cleExamens(group);
			return cle ? (examens()[cle] ?? []) : [];
		},
		enregistrerExamen: (group, e) => {
			const cle = cleExamens(group);
			if (cle) void enregistrerExamenReglage(cle, e);
			else currentHost().ui.notice(t("dashboard.planning.examSaveFailed"));
		},
		retirerExamen: (group, id) => {
			const cle = cleExamens(group);
			if (cle) void retirerExamenReglage(cle, id);
		},
		/* A move carries what the app keeps by path or module key: exams,
		   sessions, remembered test setups, folder paths of the page settings
		   (`review/folder-move.ts`). */
		movedPrefix: createMovedPrefix({
			paths: () => currentHost().paths,
			quizPaths: () => deps.scanner.getQuizzes().map(q => q.path),
			renameExams: renommerExamens,
			sessions: deps.sessions,
			testSetups,
			pageSettings: reglagesPages,
			savePageSettings: enregistrerReglagesPages,
		}),
		// « Nouveau quiz » : une note vierge, puis sa page en ÉDITION par
		// `openQuizPath` ci-dessous — l'éditeur existe désormais dans la fenêtre.
		createQuiz: (folder, done) => openNewQuizModal(ctx, folder, done),
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
		// "Generated quizzes": the folder where generated quizzes are written, opened on its content.
		openGenerated: () => {
			/* The folder is found through a quiz written in it: the folders of the
			   page are keyed by the catalogue, not by the contract path. Nothing
			   generated yet: the list of folders. */
			const dossier = dossierParDefaut(deps.aiSettings.get().aiOutputFolder);
			const premier = deps.scanner.getQuizzes().find(q => q.path.startsWith(dossier + "/"));
			naviguer("quizzes");
			// Its back arrow returns to Generate, not to the grid of folders.
			if (premier) quizzes.openFolderOfQuiz(premier.path, () => naviguer("ai"));
		},
		quizFolders: () => dossiersDeQuiz(),
		copyText: copierTexte,
		// The pencil of the "/exam" tile: the Settings, on its prompt.
		openExamPromptSettings: () => { viserPromptExam(); deps.onOpenSettings(); },
		// The "/exam" menu: every upcoming exam of every folder, nearest first.
		upcomingExams: () => {
			const aujourdhui = isoLocal(Date.now());
			const quiz = deps.scanner.getQuizzes();
			/* The course folder of a key: the folder of any quiz filed under it
			   (the key is the catalogue's, the documents are listed by path). */
			const nfc = (s: string): string => s.normalize("NFC");
			const dossierDe = (cle: string): string | undefined => {
				const paths = currentHost().paths;
				const exact = quiz.find(x => cleModule(x.path, paths) === cle);
				if (exact) return exact.path.slice(0, exact.path.lastIndexOf("/"));
				/* A key written under another root id or another Unicode form
				   (seen on screen 2026-09-30: "folder not found" for a course of
				   eight quizzes): the folder is found by its NAME, the key's last
				   segment, anywhere in a quiz's path. */
				const nom = nfc(libelleModule(cle));
				for (const x of quiz) {
					const segments = x.path.split("/");
					const i = segments.findIndex(s => nfc(s) === nom);
					if (i >= 0 && i < segments.length - 1) return segments.slice(0, i + 1).join("/");
				}
				return undefined;
			};
			return Object.entries(examens())
				.flatMap(([cle, liste]) => upcomingExams(liste, aujourdhui).map(e => ({ id: e.id, nom: e.nom, date: e.date, module: libelleModule(cle), dossier: dossierDe(cle), racine: cle.split("/")[0] })))
				.sort((a, b) => a.date.localeCompare(b.date));
		},
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
	 * "Open an existing folder": the native picker, then the DECLARATION of the
	 * chosen folder as a quiz folder.
	 *
	 * Inside an already open root (a course folder in a vault) this is NOT
	 * `addFolder`: adding it as a second root would give the same files two
	 * contract paths, hence two review histories for the same questions. Only a
	 * quiz FOLDER is declared there: an override entry carrying its path, which
	 * "New quiz" and the Generate page know how to target.
	 *
	 * Outside every open root (e.g. an Obsidian vault folder on the PC), the
	 * folder becomes a new root through `addFolder`, then is declared the same
	 * way. Roots are only read at startup, so the page reloads once it is saved.
	 */
	async function ouvrirDossierExistant(done: () => void): Promise<void> {
		const choisi = await pickFolder();
		// Cancelling is not an error, it is the answer "no".
		if (!choisi) return;
		const host = currentHost();
		const racines = await savedFolders();
		const lien = lienAvecRacines(choisi, racines);
		/* A folder that contains an open root would nest roots, which
		   `depuisAbsolu` exists to prevent. */
		if (lien === "contient") { host.ui.notice(t("dashboard.quizzes.createOpenContains")); return; }
		const declarer = async (contrat: string): Promise<string> => {
			/* The KEY stays one segment (what `moduleForQuiz` and the overrides
			   read), the PATH is what makes the folder writable. A name already
			   declared is not overwritten: it only gets its path. */
			const cle = contrat.split("/").pop() as string;
			const overrides: Record<string, ModuleOverride> = { ...(ctx.settings.quizzesModuleOverrides || {}) };
			overrides[cle] = { ...(overrides[cle] || {}), name: overrides[cle]?.name || cle, path: contrat };
			ctx.settings.quizzesModuleOverrides = overrides;
			await ctx.saveSettings();
			return cle;
		};
		if (lien === "doublon") {
			const cle = deps.cheminDuContrat(choisi)?.split("/").pop();
			if (cle && ctx.settings.quizzesModuleOverrides?.[cle]) host.ui.notice(t("dashboard.quizzes.createOpenDone", { name: cle }));
			else host.ui.notice(t("dashboard.quizzes.createOpenAlready"));
			return;
		}
		if (lien === "dedans") {
			const contrat = deps.cheminDuContrat(choisi);
			if (!contrat) { host.ui.notice(t("dashboard.quizzes.createOpenOutside")); return; }
			const cle = await declarer(contrat);
			host.ui.notice(t("dashboard.quizzes.createOpenDone", { name: cle }));
			done();
			return;
		}
		// "libre": outside every root, so it becomes one.
		const apres = await addFolder(choisi);
		if (apres.length <= racines.length) { host.ui.notice(t("dashboard.quizzes.createOpenLimit")); return; }
		const nouvelle = apres.find(d => lienAvecRacines(choisi, [d]) === "doublon");
		/* The startup root map does not know the new root yet: its contract
		   path is its id (see `depuisAbsolu`). */
		if (!nouvelle) { host.ui.notice(t("dashboard.quizzes.createOpenOutside")); return; }
		const cle = await declarer(nouvelle.id);
		host.ui.notice(t("dashboard.quizzes.createOpenDone", { name: cle }) + " " + t("dashboard.quizzes.createOpenStaysHere"));
		// Roots are installed once at startup: reload so the catalogue and watcher see the new one.
		location.reload();
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
	function peindre(target: HTMLElement = contentEl): void {
		// The sheets each page stands on ("Folders" sets its own).
		if (vueCourante === "detail") sheets.sync(detailDepth);
		else if (vueCourante !== "quizzes") sheets.sync(0);
		target.replaceChildren();
		const entering = vueCourante !== dernierePeinte;
		dernierePeinte = vueCourante;
		switch (vueCourante) {
			case "quizzes":
				// Pas de paramètre `entering` : `quizzes.ts` gère sa propre
				// transition d'entrée, calée sur son état de drill-down interne
				// (voir `createQuizzesHandlers`), pas sur celui de la coquille.
				quizzes.render(target);
				break;
			case "detail": {
				const quiz = quizSelectionne;
				if (!quiz) {
					// Vue persistée sans quiz (ne devrait pas arriver : `naviguer`
					// les pose ensemble) : l'accueil plutôt qu'un contenu vide.
					vueCourante = "home";
					nav.setActive("home");
					home.render(target, entering);
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
				detail.render(target, quiz, {
					startEditing: edit,
					animateEntry: entreeAnimee,
					onBack: () => {
						/* Back to Folders or Home: the quiz's page slides down
						   and the page behind comes forward (`sheet-stack.ts`).
						   Back to "Folders", the quiz's FOLDER, not the root
						   grid — `naviguer` has just closed the drill-down
						   (`resetDrilldown`), hence the reopening, on the
						   `quizzes` instance still alive. Back to Generate, a
						   plain repaint: its page holds a composer that must
						   not be painted twice. */
						if (cible === "quizzes" || cible === "home") {
							naviguer(cible, undefined, () => {
								if (cible === "quizzes") quizzes.selectFolderOfQuiz(quiz.path);
								sheets.close(t => peindre(t));
							});
							return;
						}
						naviguer(cible);
					},
					isStale: () => vueCourante !== "detail",
					initialQuestion: initial,
					ouverture,
					onQuestionChange: (i) => noterVue({ vue: "detail", quiz: quiz.path, question: i }),
				});
				break;
			}
			case "ai":
				void ai.render(target);
				break;
			case "home":
			default:
				home.render(target, entering);
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
		/* Kept INERT behind a quiz screen (main.ts, the stack of sheets): the
		   buttons belong to the quiz, which handles them — moving the hidden
		   shell would land the user elsewhere when the quiz closes. */
		if (layout.inert) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.type !== "mouseup") return;
		const cible = e.button === 3 ? historiqueNav.reculer(etatCourant()) : historiqueNav.avancer(etatCourant());
		if (cible) appliquerNav(cible);
	};

	/* The Android back key (`retour-android.ts`): one step back in the same
	   history, unless the shell is kept inert behind a played quiz. An empty
	   history is left unhandled, so the key leaves the app. */
	const surRetourAndroid = (e: Event): void => {
		if (layout.inert || !historiqueNav.peutReculer()) return;
		if (!prendreRetour(e)) return;
		const cible = historiqueNav.reculer(etatCourant());
		if (cible) appliquerNav(cible);
	};

	function naviguer(vue: DashboardViewName, data?: NavigateData, repaint: () => void = peindre): void {
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
			const from = vueCourante;
			quizSelectionne = data.quiz;
			editionEnAttente = !!data.edit;
			ouvertureEnAttente = true;
			entreeDetail = data.entree;
			if (vueCourante !== "detail") vuePrecedente = vueCourante;
			vueCourante = "detail";
			// Aucun bouton du rail ne porte "detail" : `setActive` éteint donc
			// la carte active, comme sous Obsidian.
			nav.setActive("detail");
			// La page d'un quiz est HORS dossier : la bande bleue revient.
			poserLueur(null);
			// Notée SANS la question : `onQuestionChange` la précisera au premier
			// changement. Ouvrir un quiz montre sa fiche ; sa question courante
			// reste celle sur laquelle l'éditeur s'ouvre.
			noterVue({ vue: "detail", quiz: data.quiz.path });
			/* A quiz's page opened by a click rises as a sheet over the page
			   it was opened from; restored from history, or arriving from a
			   generation (which has its own entry), it is simply painted, on
			   the same stack. From another quiz's page, the stack stays. */
			if (from !== "detail") detailDepth = sheets.depth() + 1;
			if (from !== "detail" && !enRestauration && data.entree !== "generation") sheets.open(() => peindre());
			else peindre();
			return;
		}
		if (!ctx.canOpen(vue)) return;
		// Même refermeture qu'au greffon (dashboard.ts, navigate()) : entrer
		// dans un module puis revenir par le rail doit rouvrir la GRILLE, pas
		// le module laissé ouvert.
		if (vue === "quizzes") quizzes.resetDrilldown();
		/* Hors d'un dossier, la bande bleue ; « Mes quiz » rejoue le passage de
		   la couleur s'il rouvre un dossier (`ambiance`). */
		poserLueur(null);
		vueCourante = vue;
		nav.setActive(vue);
		noterVue({ vue });
		repaint();
	}

	nav.render(navEl);
	/* Phone: a horizontal swipe on a MAIN tab page moves to the neighbouring
	   tab, in bottom-bar order, by clicking that tab's button (the very path of
	   a tap on the bar: history, highlight and view transition stay the same).
	   Not on a quiz or folder page (sheets stacked), not under a menu. */
	const tabButtons = () => Array.from(navEl.querySelectorAll<HTMLElement>(".qbd-nav-item"))
		.filter(b => !b.classList.contains("qbd-nav-item--placeholder"));
	const tabKey = (b: HTMLElement) => b.dataset.nav ?? "settings";
	const tabTarget = (dir: "next" | "prev"): HTMLElement | null => {
		if (!currentHost().platform.isMobile || sheets.depth() > 0) return null;
		const btns = tabButtons();
		const current = btns.find(b => b.classList.contains("qbd-nav-item--active"));
		const target = current && nextTab(tabKey(current), dir, btns.map(tabKey));
		return target ? btns.find(b => tabKey(b) === target) ?? null : null;
	};
	let swipeAnim: Animation | null = null;
	bindSwipe(contentEl, dir => tabTarget(dir)?.click(), () => !!document.querySelector(".qbd-select-menu"), {
		canGo: dir => tabTarget(dir) !== null,
		drag: offset => {
			swipeAnim?.cancel(); swipeAnim = null;
			contentEl.style.transform = `translate3d(${offset}px, 0, 0)`;
			contentEl.style.opacity = String(Math.max(0.55, 1 - Math.abs(offset) / (window.innerWidth * 1.2)));
		},
		release: (dir, offset, _v, width) => {
			const reduced = prefersReducedMotion();
			const from = `translate3d(${offset}px, 0, 0)`;
			const clear = () => { contentEl.style.transform = ""; contentEl.style.opacity = ""; };
			const target = dir ? tabTarget(dir) : null;
			if (!dir || !target) {
				// Spring back.
				clear();
				if (!reduced) swipeAnim = contentEl.animate([{ transform: from, opacity: 1 }, { transform: "none", opacity: 1 }], { duration: settleDuration(offset, width), easing: SETTLE_EASING });
				return;
			}
			// The page leaves along the finger, the neighbour tab enters from the other side.
			const sign = dir === "next" ? -1 : 1;
			const exit = reduced ? 0 : Math.round(settleDuration(width - Math.abs(offset), width) * 0.5);
			const enter = () => {
				clear();
				target.click();
				hapticTick();
				if (!reduced) swipeAnim = contentEl.animate([{ transform: `translate3d(${-sign * width * 0.25}px, 0, 0)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 220, easing: SETTLE_EASING });
			};
			if (!exit) { enter(); return; }
			swipeAnim?.cancel();
			swipeAnim = contentEl.animate([{ transform: from, opacity: Number(contentEl.style.opacity || 1) }, { transform: `translate3d(${sign * width * 0.3}px, 0, 0)`, opacity: 0 }], { duration: exit, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
			swipeAnim.onfinish = () => { swipeAnim?.cancel(); enter(); };
		},
	});
	/* The app's mark at the top of the rail, above Home (StudySmarter's
	   layout), a line-drawn SVG in the rail's colour instead of the app's
	   bitmap icon (`shell.css`, `.nq-rail-logo`). Since 2026-09-29 it opens
	   the APPLICATION MENU (Neo Quiz, Edit, Display), in place of the title
	   bar's chevron, which is gone; the GitHub link it used to be is in that
	   menu. Set by the shell, not by `nav.ts`: it is the APPLICATION's
	   identity. */
	const logo = document.createElement("button");
	logo.type = "button";
	logo.className = "nq-rail-logo";
	logo.title = t("app.titlebar.menu");
	logo.setAttribute("aria-label", t("app.titlebar.menu"));
	logo.setAttribute("aria-haspopup", "menu");
	logo.append(marqueRail());
	logo.addEventListener("click", () => basculerMenuApp(logo));
	/* The application menu belongs to the title bar, which a phone does not have. */
	if (!currentHost().platform.isMobile) navEl.prepend(logo);
	// Le bouton « Redémarrer pour mettre à jour » vit dans le pied du rail,
	// posé une fois pour toute la durée de la coquille — un seul abonnement
	// au pont pour toute la fenêtre (`mise-a-jour.ts`).
	const demonterMaj = monterBoutonRail(navEl);
	// Synchronise le rail sur la vue persistée (retour d'un quiz sur « Mes
	// quiz », par exemple) : `createNavHandlers` démarre chaque fois avec son
	// propre `activeNav` interne à "home".
	nav.setActive(vueCourante);
	/* Au remontage (retour d'un quiz lancé depuis un dossier), la lueur est
	   restée celle du dossier, éteinte : hors « Mes quiz », la bande bleue
	   revient. Dans « Mes quiz », son rendu décide (`ambiance`). */
	if (vueCourante !== "quizzes") poserLueur(null);
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
	let demontage: Promise<void> | null = null;
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
	document.addEventListener(EVENEMENT_RETOUR, surRetourAndroid);

	const demonter = (): Promise<void> => {
		if (demontage) return demontage;
		document.removeEventListener("keydown", surCtrlZ);
		document.removeEventListener("mousedown", surBoutonSouris, true);
		document.removeEventListener("mouseup", surBoutonSouris, true);
		document.removeEventListener(EVENEMENT_RETOUR, surRetourAndroid);
		desabonner();
		demonterMaj();
		sheets.drop();
		/* La page « Générer » aussi : une génération en vol, son écoute Échap
		   sur le document, son sondage Ollama et les URL d'objet de ses images
		   survivraient sinon à la coquille (même geste que l'`onClose` du
		   greffon). */
		ai.dispose();
		demontage = detail.dispose();
		return demontage;
	};
	return { demonter, repaint: peindre };
}
