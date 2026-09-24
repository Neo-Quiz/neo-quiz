import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { renderQuizCard } from "./quiz-card";
import { regrouperParCours } from "./course-pairs";
import { renderModuleCard } from "./module-card";
import { moduleForQuiz, buildModuleGroups, buildUeGroups, buildFolderGroups, estLeSas } from "./quiz-modules";
import type { ModuleMap, ModuleGroup, UeGroup } from "./quiz-modules";
import { computeQuizState } from "./quiz-mastery";
import { buildRecentModuleGroups } from "./quiz-recent";
import type { RecentGroupKey } from "./quiz-recent";
import { moduleAccent } from "./module-color";
import { renderCollapsibleSection } from "./collapsible";
import { suggestIcons } from "./icon-suggest";
import { renderFolderSections } from "./folder-sections";

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
	archivedQuizzes: QuizIndexEntry[] = []
): void {
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
	const alwaysInclude = Object.keys(deps.ctx.settings.quizzesModuleOverrides || {})
		.filter(f => !archivedFolders.includes(f));
	const modules = buildModuleGroups(filtered, stats, map, alwaysInclude);
	/* LE SAS DES QUIZ GÉNÉRÉS EXISTE MÊME VIDE : c'est là que les générations
	   arrivent, et le vider le faisait disparaître de la page (2026-09-20).
	   Ajouté sans quiz s'il n'y est pas déjà, avec l'override de dossier
	   (couleur, icône) s'il en a un. */
	const sasVide = deps.ctx.generatedFolder?.();
	if (sasVide && !modules.some(m => m.path === sasVide)) {
		const nom = sasVide.split("/").pop() || sasVide;
		const info = map.byFolder.get(nom);
		modules.push({ folder: nom, name: info?.name ?? nom, ue: info?.ue ?? null, color: info?.color, icon: info?.icon, path: sasVide, quizzes: [], total: 0, mastered: 0 });
		modules.sort((a, b) => a.name.localeCompare(b.name));
	}

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
		const archivedModules = buildModuleGroups(archivedQuizzes, stats, map, archivedFolders);
		const body = renderCollapsibleSection(deps, treeEl, "archived:", t("dashboard.quizzes.archivedSection"), archivedModules.length, { entryDelay, defaultOpen: false });
		renderModuleGrid(deps, body, archivedModules, map, entryDelay);
	}
}

/** Drill-down d'un module ouvert : grille de ses quiz + panneau « Progrès »
    (design claude.ai, capture 2026-07-20). Le fil d'Ariane et le titre vivent
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
	rerender: () => void
): void {
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

	// ── Layout 2 colonnes : colonne principale (grille + sections du dossier)
	// + panneau « Progrès » (repli 1 colonne sous une largeur seuil, cf.
	// dashboard-quizzes.css). ──
	/* Le SAS n'a pas de panneau « Progrès » : on n'y progresse pas, on y
	   passe. La colonne principale prend alors toute la largeur (une seule
	   colonne de layout, cf. `.qbd-quizzes-drill-layout--plein`). Reconnu par
	   le CHEMIN du dossier ouvert, comme la carte. */
	const sas = !!ctx.generatedFolder && cheminOuvert !== undefined && cheminOuvert === ctx.generatedFolder();
	const accent = moduleAccent(info ?? { folder: openModuleFolder }, { generated: sas });
	const layout = ajouter(treeEl, "div", "qbd-quizzes-drill-layout" + (sas ? " qbd-quizzes-drill-layout--plein" : ""));
	layout.style.setProperty("--accent", accent);
	const principal = ajouter(layout, "div", "qbd-quizzes-drill-main");
	if (inModule.length === 0) {
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
	const cartes = regrouperParCours(inModule, ctx.settings.quizzesGroupModes !== false);
	for (const [index, { quiz, frere }] of cartes.entries()) {
		renderQuizCard(grid, quiz, stats[quiz.path], (q) => ctx.navigate("detail", { quiz: q }), {
			frere,
			statsFrere: frere ? stats[frere.path] : undefined,
			onPlay: (q) => ctx.openQuiz(q),
			// Absent côté application (menus et modals = tranche 2.6) : la
			// carte se rend alors sans bouton « ⋯ », `onMenu?` étant opt-in —
			// même patron que home.ts. L'hôte ouvre le menu lui-même (tour de
			// correction 1, tâche 6).
			onMenu: ctx.openCardMenu ? (q, anchor) => ctx.openCardMenu!(q, anchor, rerender) : undefined,
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

	if (!sas) renderProgressPanel(layout, inModule, stats);
}

/** Donut structurel du handoff 7a : un anneau conique de 150 px et un disque
    central opaque. Le centre fait partie du donut, le pourcentage ne peut donc
    plus dériver hors du trou selon les métriques de police. */
function renderDonut(container: HTMLElement, mastered: number, review: number, total: number, centerPct: number): void {
	const masteredEnd = total > 0 ? mastered / total * 100 : 0;
	const reviewEnd = total > 0 ? (mastered + review) / total * 100 : 0;
	const donut = ajouter(container, "div", "qbd-progress-donut");
	donut.style.setProperty("--qbd-donut-mastered-end", `${masteredEnd}%`);
	donut.style.setProperty("--qbd-donut-review-end", `${reviewEnd}%`);
	donut.setAttribute("role", "img");
	donut.setAttribute("aria-label", `${centerPct}%`);

	const centerLabel = ajouter(donut, "div", "qbd-progress-donut-center");
	ajouter(centerLabel, "b", "qbd-progress-donut-pct", String(centerPct));
	ajouter(centerLabel, "span", "qbd-progress-donut-pct-sign", "%");
}

/** Panneau « Progrès » : donut (mastered/review/à-apprendre) + légende, à
    côté de la grille du module ouvert. `inModule` = TOUS les quiz du dossier
    (pas juste ceux filtrés par une recherche) : c'est un statut du dossier
    entier. Regroupement des 4 états de computeQuizState en 3 catégories —
    "review" (quiz raté, seuil déjà atteint) reste seul (correspondance
    directe avec « à réviser ») ; "progress" (en cours, pas fini) ET "fresh"
    (jamais commencé) fusionnent dans « à apprendre » : aucun des deux n'est
    encore acquis, et le triplé de la référence ne laisse pas de 4e case. */
function renderProgressPanel(parent: HTMLElement, inModule: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): void {
	const total = inModule.length;
	let masteredN = 0, reviewN = 0, learnN = 0;
	for (const quiz of inModule) {
		const { state } = computeQuizState(quiz, stats[quiz.path]);
		if (state === "mastered") masteredN++;
		else if (state === "review") reviewN++;
		else learnN++;
	}
	const pctOf = (n: number): number => total > 0 ? Math.round(n / total * 100) : 0;

	const panel = ajouter(parent, "div", "qbd-progress-panel");
	const head = ajouter(panel, "div", "qbd-progress-panel-head");
	ajouter(head, "div", "qbd-progress-panel-title", t("dashboard.quizzes.progressTitle"));
	ajouter(head, "div", "qbd-progress-panel-count", t("dashboard.quizzes.progressCount", { done: masteredN, total }));

	const donutWrap = ajouter(panel, "div", "qbd-progress-donut-wrap");
	renderDonut(donutWrap, masteredN, reviewN, total, pctOf(masteredN));

	const legend = ajouter(panel, "div", "qbd-progress-legend");
	const addRow = (dotMod: string, label: string, n: number): void => {
		const row = ajouter(legend, "div", "qbd-progress-legend-row");
		ajouter(row, "div", `qbd-progress-legend-dot qbd-progress-legend-dot--${dotMod}`);
		ajouter(row, "div", "qbd-progress-legend-label", label);
		ajouter(row, "div", "qbd-progress-legend-pct", `${pctOf(n)}%`);
	};
	addRow("mastered", t("dashboard.card.mastered"), masteredN);
	addRow("review", t("dashboard.card.review"), reviewN);
	addRow("learn", t("dashboard.quizzes.progressToLearn"), learnN);
}
