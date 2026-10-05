import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { renderQuizCard } from "./quiz-card";
import { quizDeLaCarte, regrouperParCours } from "./course-pairs";
import { renderModuleCard } from "./module-card";
import { moduleForQuiz, buildModuleGroups, buildUeGroups, buildFolderGroups, declaredFolders, estLeSas, modulesAffiches } from "./quiz-modules";
import type { ModuleMap, ModuleGroup, UeGroup } from "./quiz-modules";
import { computeQuizState } from "./quiz-mastery";
import { renderFolderProgress } from "./folder-progress";
import { renderFolderPlanning } from "./folder-planning";
import { renderNextStep } from "./folder-next";
import { buildRecentModuleGroups } from "./quiz-recent";
import type { RecentGroupKey } from "./quiz-recent";
import { moduleAccent } from "./module-color";
import { renderCollapsibleSection } from "./collapsible";
import { suggestIcons } from "./icon-suggest";
import { renderFolderSections } from "./folder-sections";
import { renderEmptyFolder } from "./folder-add";

/* ══════════════════════════════════════════════════════════
   QUIZZES RENDER — extrait de quizzes.ts (Task 4) pour rester
   sous le plafond de 350 lignes : TOUT ce qui peint le contenu
   de « Mes quiz » (les 4 axes + le drill-down d'un module) vit
   ici. quizzes.ts reste le contrôleur : état, réglages, header/
   recherche/filtres/sélecteur, dispatch vers ce module.
══════════════════════════════════════════════════════════ */

/* Trois axes depuis le 2026-09-24 : « Récent » et « Dossier », valables pour
   tout le monde, puis « UE », PERSONNALISÉ — il suppose un cursus déclaré
   (Ahmed : « c'est pas toutes les personnes qui utilisent l'app qui sont à
   l'Efrei »). « module » et « type » restent retirés. */
export type GroupingKey = "recent" | "folder" | "ue";

/** Dépendances d'ÉTAT fournies par le contrôleur (réglages, recherche,
    re-rendu) — tout ce qui n'est pas pur DOM reste côté quizzes.ts. */
export interface GridDeps {
	ctx: DashboardShellCtx;
	isExpanded: (key: string) => boolean;
	toggleExpanded: (key: string) => void;
	rerender: () => void;
	openModule: (folder: string) => void;
}

const RECENT_GROUP_LABEL_KEYS: Record<RecentGroupKey, TransKey> = {
	"recent:7d": "dashboard.quizzes.recentWeek",
	"recent:30d": "dashboard.quizzes.recentMonth",
	"recent:older": "dashboard.quizzes.recentOlder",
};


/** Grille plate de cartes de module (mode « module » et corps d'un groupe d'UE).
    La carte affiche toujours son sous-titre UE (demande d'Ahmed : l'UE sur la
    carte façon StudySmarter, même sous un en-tête d'UE — comme StudySmarter
    garde le sous-titre d'une carte dans une section groupée). */
function renderModuleGrid(deps: GridDeps, parent: HTMLElement, groups: ModuleGroup[], map: ModuleMap, entryDelay: () => string): void {
	const grid = ajouter(parent, "div", "qbd-module-grid");
	// Menu ⋯ d'une carte de module : l'hôte OUVRE lui-même le menu (il ouvre
	// des modals — partage, « Modifier dossier », suppression — que
	// l'application n'a pas encore, D5). Absente = pas de bouton ⋯,
	// `renderModuleCard` le prévoit déjà par son `onMenu?` opt-in. La carte
	// ne compose plus les items ni n'importe `ui-select.ts` elle-même (tour
	// de correction 1, tâche 6).
	const onMenu = deps.ctx.openModuleMenu
		? (g: ModuleGroup, anchor: HTMLElement): void => deps.ctx.openModuleMenu!(g, anchor, deps.rerender, map)
		: undefined;
	// Raccourci « changer l'icône » depuis la pastille de la carte : picker
	// portalé au body (pas de modal ici) → override + save + rerender. Le
	// picker lui-même (icon-picker.ts, `getIconIds` d'Obsidian) est fourni
	// par l'hôte ; absent côté application, la pastille n'est simplement pas
	// cliquable (`renderModuleCard`, `onPickIcon?` opt-in).
	const pickIcon = deps.ctx.pickIcon
		? (group: ModuleGroup, anchor: HTMLElement): void => {
			deps.ctx.pickIcon!(anchor, group.icon, (name) => {
				const overrides = { ...(deps.ctx.settings.quizzesModuleOverrides || {}) };
				overrides[group.folder] = { ...(overrides[group.folder] || {}), icon: name };
				deps.ctx.settings.quizzesModuleOverrides = overrides;
				deps.ctx.saveSettings().catch(() => {});
				deps.rerender();
			}, suggestIcons(group.name, group.ue));
		}
		: undefined;
	const sas = deps.ctx.generatedFolder?.();
	for (const g of groups) {
		const card = renderModuleCard(grid, g, (m) => deps.openModule(m.folder), onMenu, pickIcon,
			{ generated: estLeSas(g, sas) });
		card.style.setProperty("--qbd-card-delay", entryDelay());
	}
}

/* En-tête d'UE repliable + grille de cartes de module dessous. Badge = nombre
   d'éléments DIRECTS de la section (les modules), comme le compteur des
   sections « Mes dossiers » de StudySmarter. */
function renderUeGroup(deps: GridDeps, parent: HTMLElement, ue: UeGroup, map: ModuleMap, entryDelay: () => string): void {
	const body = renderCollapsibleSection(deps, parent, ue.key, ue.ue ?? t("dashboard.quizzes.noUe"), ue.modules.length, { entryDelay });
	renderModuleGrid(deps, body, ue.modules, map, entryDelay);
}

/** Contenu de la grille pour les 4 axes (pas le drill-down) : dispatch par
    mode. `filtered` est DÉJÀ passé au tamis recherche/pilule par l'appelant. */
export function renderQuizGrid(
	deps: GridDeps,
	treeEl: HTMLElement,
	mode: GroupingKey,
	filtered: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>,
	map: ModuleMap,
	/** Quiz des DOSSIERS archivés — rendus en CARTES DE DOSSIER dans une
	    section repliable en pied de grille (jamais de cartes de quiz :
	    l'archivage n'existe qu'au niveau dossier, Ahmed 2026-07-19). */
	archivedQuizzes: QuizIndexEntry[] = [],
	/** Keeps only the folders it accepts (the subject filter, 2026-09-29).
	    Applied to the FOLDERS, not to the quizzes: a declared folder with no
	    quiz shows as a card too, and must leave with the others. */
	garder?: (m: ModuleGroup) => boolean,
): void {
	/* The "Generated" folder is not a card of the grid: the page's top bar
	   has its own button for it (quizzes.ts), and it is counted in no group. */
	const sasCache = deps.ctx.generatedFolder?.();
	const garde = (m: ModuleGroup): boolean => !estLeSas(m, sasCache) && (!garder || garder(m));
	treeEl.replaceChildren();
	// Cascade d'ENTRÉE globale : un seul compteur traverse toutes les
	// sections (en-têtes ET cartes de dossier) — même formule que les cartes
	// du drill (quiz-card.ts). Les délais sont posés à chaque rendu mais
	// restent inertes hors .qbd-quizzes-enter (aucune animation à consommer).
	let entryIndex = 0;
	const entryDelay = (): string => `${100 + entryIndex++ * 45}ms`;
	const archivedFolders = deps.ctx.settings.quizzesArchivedFolders || [];
	if (filtered.length === 0 && archivedQuizzes.length === 0 && archivedFolders.length === 0) {
		const empty = ajouter(treeEl, "div", "qbd-empty-state");
		ajouter(empty, "p", undefined, t("dashboard.quizzes.empty"));
		return;
	}

	// Les deux axes affichent des cartes de MODULE (règle Ahmed 2026-07-18 :
	// « Recent » ne montre que les dossiers, jamais des quiz). Les dossiers
	// déclarés par le modal Nouveau dossier / Modifier dossier existent même
	// sans quiz (alwaysInclude) — SAUF archivés : leur carte vit uniquement
	// dans la section « Archivés » (sinon elle resterait en grille à 0 quiz).
	const sasVide = deps.ctx.generatedFolder?.();
	const modules = modulesAffiches(filtered, stats, map,
		declaredFolders(deps.ctx.settings.quizzesModuleOverrides), archivedFolders, sasVide).filter(garde);
	if (!garder && modules.length === 0 && archivedQuizzes.length === 0 && archivedFolders.length === 0) {
		ajouter(ajouter(treeEl, "div", "qbd-empty-state"), "p", undefined, t("dashboard.quizzes.empty"));
		return;
	}
	if (garder && modules.length === 0) ajouter(ajouter(treeEl, "div", "qbd-empty-state"), "p", undefined, t("dashboard.quizzes.noSubjectMatch"));

	if (mode === "recent") {
		for (const g of buildRecentModuleGroups(modules, stats, sasVide)) {
			const body = renderCollapsibleSection(deps, treeEl, g.key, t(RECENT_GROUP_LABEL_KEYS[g.key]), g.modules.length, { entryDelay });
			renderModuleGrid(deps, body, g.modules, map, entryDelay);
		}
	} else if (mode === "folder") {
		// Axe Dossier : un en-tête par dossier parent. Clé « folder: » : « : »
		// est interdit dans un chemin, aucune collision avec les autres axes.
		for (const g of buildFolderGroups(modules)) {
			const body = renderCollapsibleSection(deps, treeEl, "folder:" + g.parent, g.label || t("dashboard.quizzes.noFolder"), g.modules.length, { entryDelay });
			renderModuleGrid(deps, body, g.modules, map, entryDelay);
		}
	} else {
		// Axe UE (défaut) : en-tête d'UE repliable, cartes de module dessous ;
		// « Sans UE » (modules non résolus) en dernier (garanti par buildUeGroups).
		for (const ue of buildUeGroups(modules, map)) renderUeGroup(deps, treeEl, ue, map, entryDelay);
	}

	// ── Section « Archivés » en pied de grille (tous les axes) — repliée par
	// défaut, CARTES DE DOSSIER (menu ⋯ complet : Unarchive direct, drill au
	// clic). Les dossiers archivés sans quiz restent listés (alwaysInclude =
	// tous les dossiers du flag). Clé « archived: » : « : » est interdit dans
	// un chemin Obsidian, aucune collision possible.
	if (archivedQuizzes.length > 0 || archivedFolders.length > 0) {
		const archivedModules = buildModuleGroups(archivedQuizzes, stats, map, archivedFolders).filter(garde);
		if (archivedModules.length === 0) return;
		const body = renderCollapsibleSection(deps, treeEl, "archived:", t("dashboard.quizzes.archivedSection"), archivedModules.length, { entryDelay, defaultOpen: false });
		renderModuleGrid(deps, body, archivedModules, map, entryDelay);
	}
}

/** Les trois onglets d'un dossier ouvert (2026-09-25, planning 2026-09-26) :
    son contenu, sa progression, et son planning de révisions. */
export type OngletDossier = "contenu" | "progression" | "planning";

/** Les trois vues d'un dossier ; `progression` et `planning` sont absentes
    dans le sas. */
export interface VuesDossier {
	contenu: HTMLElement;
	progression: HTMLElement | null;
	planning: HTMLElement | null;
}

/** Drill-down d'un module ouvert : l'étape suivante, la grille de ses quiz et
    les ressources du dossier, et la vue « Progression » de l'autre onglet. Le fil d'Ariane et le titre vivent
    désormais dans quizzes.ts (le header EST le titre du dossier) ; `inModule`
    arrive déjà filtré par module — mêmes quiz que les stats du header
    (calculés UNE fois par render(), cf. quizzes.ts). */
export function renderModuleDrill(
	treeEl: HTMLElement,
	ctx: DashboardShellCtx,
	inModule: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>,
	map: ModuleMap,
	openModuleFolder: string,
	/* Re-rendu SANS refermer le drill-down (reset de stats depuis le menu ⋯). */
	rerender: () => void,
	onglet: OngletDossier
): VuesDossier {
	treeEl.replaceChildren();

	// Module ouvert : sert à l'accent des cartes (le nom est déjà porté par le
	// titre du header, quizzes.ts).
	const info = map.byFolder.get(openModuleFolder);

	/* Le CHEMIN du dossier ouvert : déclaré, sinon déduit d'un quiz. Il sert
	   trois fois — reconnaître le sas, lister le contenu du dossier, et rien
	   d'autre. `undefined` pour un dossier déclaré avant le 2026-09-17 sans
	   quiz : ni sections, ni sas, la grille seule comme avant. */
	const cheminOuvert = info?.path ?? (inModule.length > 0 ? moduleForQuiz(inModule[0].path, map).path : undefined);

	/* PLUS de retour anticipé sur un dossier sans quiz : un dossier de cours
	   qu'on vient de déclarer (« Ouvrir un dossier existant ») n'a aucun quiz
	   et TOUS ses documents — c'est précisément là qu'il faut voir les trois
	   sections, et le bouton pour générer. L'état vide reste, à la place de la
	   grille, avec la phrase qui dit quoi faire. */

	/* Le SAS n'a ni onglet « Progression » ni étape suivante : on n'y
	   progresse pas, on y passe. Reconnu par le CHEMIN du dossier ouvert,
	   comme la carte. */
	const sas = !!ctx.generatedFolder && cheminOuvert !== undefined && cheminOuvert === ctx.generatedFolder();
	const accent = moduleAccent(info ?? { folder: openModuleFolder }, { generated: sas });
	const layout = ajouter(treeEl, "div", "qbd-quizzes-drill-layout");
	layout.style.setProperty("--accent", accent);
	const principal = ajouter(layout, "div", "qbd-quizzes-drill-main");
	if (inModule.length === 0 && !sas && cheminOuvert !== undefined && ctx.createQuiz) {
		renderEmptyFolder(principal, ctx, cheminOuvert, rerender);
	} else if (inModule.length === 0) {
		const empty = ajouter(principal, "div", "qbd-empty-state");
		ajouter(empty, "p", undefined, t("dashboard.quizzes.empty"));
		/* L'indice d'un dossier vide renvoie aux « documents et notes
		   ci-dessous » : dans le sas, ils ne sont plus là, il dirait donc de
		   regarder du vide. Le sas a le sien, qui dit d'où viennent ses quiz. */
		if (sas) ajouter(empty, "p", "qbd-empty-state-hint", t("dashboard.quizzes.emptyGeneratedHint"));
		else if (cheminOuvert !== undefined) ajouter(empty, "p", "qbd-empty-state-hint", t("dashboard.quizzes.emptyFolderHint"));
	}
	const grid = ajouter(principal, "div", "qbd-home-grid qbd-quizzes-drill-grid");
	/* UN COURS, UNE CARTE : le Learn et le Practice d'un même cours sont
	   réunis (course-pairs.ts), sauf si le réglage l'a désactivé. */
	const cartes = regrouperParCours(inModule, true);
	/* LE CHEMIN RÉEL, jamais la clé de module : l'écriture (« Ajouter du
	   contenu ») veut un chemin du contrat (correctif 2026-09-17), et
	   `renderFolderPlanning` en a besoin pour le même geste dans son propre
	   composer (tâche 5). */
	const dossier = cheminOuvert ?? openModuleFolder;
	// Le Learn avant le Practice d'un même cours : ordre des cartes,
	// consommé par l'étape suivante (ci-dessous) ET par le Planning.
	const ordre = cartes.flatMap(quizDeLaCarte);
	/* La rangée d'actions au-dessus de la grille (2026-09-25, d'après
	   StudySmarter) : « Ajouter du contenu » à gauche, l'étape suivante à
	   droite, à parts égales. Absente dans le sas, qui ne se remplit que par
	   la génération (son bouton « Générer » est dans l'en-tête). */
	if (!sas) {
		const rangee = ajouter(principal, "div", "qbd-quizzes-drill-next");
		principal.insertBefore(rangee, grid);
		renderNextStep(rangee, ctx, ordre, stats);
		if (!rangee.firstChild) rangee.remove();
	}
	for (const [index, { quiz, freres }] of cartes.entries()) {
		renderQuizCard(grid, quiz, stats[quiz.path], (q) => ctx.navigate("detail", { quiz: q }), {
			freres,
			statsFreres: freres.map(f => stats[f.path]),
			// Le dossier est le titre de la page : ne pas le répéter sur chaque carte.
			showPath: false,
			// L'avancement vit dans l'onglet « Progression » du dossier.
			showRing: false,
			onPlay: (q) => ctx.openQuiz(q),
			// Absent côté application (menus et modals = tranche 2.6) : la
			// carte se rend alors sans bouton « ⋯ », `onMenu?` étant opt-in —
			// même patron que home.ts. L'hôte ouvre le menu lui-même (tour de
			// correction 1, tâche 6).
			onMenu: ctx.openCardMenu ? (q, anchor) => ctx.openCardMenu!(q, anchor, rerender, map) : undefined,
			accent,
			entryIndex: index,
		});
	}

	/* Les trois sections (Documents, Liens, Notes) sous la grille, pour tout
	   dossier dont on connaît le chemin — SAUF LE SAS (demande d'Ahmed,
	   2026-09-20). On avait fait l'inverse en pensant qu'on voudrait y revoir
	   le PDF d'origine ; mais le sas ne reçoit QUE des quiz écrits par la
	   génération, jamais un document déposé, et ses trois sections y restaient
	   vides à demeure — trois grands cadres qui ne disent rien sous la grille.
	   Les sources, elles, vivent dans le dossier du cours. */
	if (cheminOuvert !== undefined && !sas) {
		renderFolderSections(principal, { ctx, folder: cheminOuvert, rerender });
	}

	// Le groupe du dossier ouvert : même forme pour Progression et Planning,
	// jamais deux constructions qui pourraient diverger.
	const group: ModuleGroup = {
		folder: openModuleFolder, name: info?.name || openModuleFolder, ue: info?.ue ?? null, path: cheminOuvert,
		color: info?.color, icon: info?.icon, quizzes: inModule, total: inModule.length, mastered: 0,
	};
	const progression = sas ? null : renderFolderProgress(treeEl, inModule, stats, { ctx, map, rerender, cartes, group });
	const planning = sas ? null : renderFolderPlanning(treeEl, inModule, ordre, stats, { ctx, map, rerender, cartes, group, folder: dossier });
	const vues: VuesDossier = { contenu: layout, progression, planning };
	const disponibles: Record<OngletDossier, HTMLElement | null> = vues;
	const montree = disponibles[onglet] ?? layout;
	layout.hidden = montree !== layout;
	if (progression) progression.hidden = montree !== progression;
	if (planning) planning.hidden = montree !== planning;
	return vues;
}
