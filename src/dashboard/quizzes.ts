import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import { importSharedFolder } from "./folder-create";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { applyModuleOverrides, moduleForQuiz } from "./quiz-modules";
import type { ModuleMap } from "./quiz-modules";
import { isFolderArchived } from "./folder-archive";
import { renderQuizGrid, renderModuleDrill } from "./quizzes-render";
import type { GroupingKey, OngletDossier, VuesDossier } from "./quizzes-render";
import { renderOngletsDossier, basculerVueDossier } from "./folder-progress";
import { moduleAccent } from "./module-color";
import { lireModuleMap } from "./module-map-note";
import { markViewEnter } from "./view-enter";
import { moduleIcon } from "./module-icons";
import { declaredFolders, modulesAffiches, estLeSas } from "./quiz-modules";
import type { ModuleGroup } from "./quiz-modules";
import { CATEGORIES, categorieDuDossier } from "./categorie-quiz";
import type { CategorieQuiz } from "./categorie-quiz";
import { peindreIconeCategorie, libelleCategorie } from "./categorie-affichage";

/* ══════════════════════════════════════════════════════════
   QUIZZES VIEW — Dashboard
   Contrôleur : état, réglages, header/recherche/filtres/sélecteur.
   Le PEINTRE (grille module/UE/activité/type + drill-down) vit dans
   quizzes-render.ts — extrait pour rester sous le plafond de 350
   lignes (cf. rapport Task 4).
══════════════════════════════════════════════════════════ */

export interface QuizzesHandlers {
	render(container: HTMLElement): void;
	/** Referme le drill-down d'un module (état d'interface non persisté).
	    Appelé par le dashboard quand on (re)navigue vers « Mes quiz » via le
	    rail : sans ça, entrer dans un module puis revenir par le rail rouvrirait
	    le module au lieu de la grille (le fil d'Ariane, lui, le remet déjà). */
	resetDrilldown(): void;
	/** Dossier ouvert du drill-down (null = grille) — lu par captureNav()
	    (historique boutons souris, dashboard.ts). */
	getOpenFolder(): string | null;
	/** Restauration d'historique : rouvre un dossier par le MÊME chemin de
	    code qu'un clic de carte (openModule) — le recordNav interne est
	    neutralisé par la garde isRestoringNav de la vue. */
	openFolder(folder: string): void;
	/** Ouvre le dossier CONTENANT ce quiz. Sortir d'un quiz doit ramener dans
	    son dossier, pas à la racine de « Mes quiz » (demande Ahmed
	    2026-07-21) — et la correspondance chemin → dossier de module vit ici,
	    avec la note de correspondance et les overrides. */
	openFolderOfQuiz(quizPath: string, retour?: () => void): void;
	/** The same folder as `openFolderOfQuiz`, set WITHOUT painting nor
	    recording history: the host paints it itself, into the back sheet
	    that comes forward when a quiz's page closes (`sheetStack.close`). */
	selectFolderOfQuiz(quizPath: string): void;
	/** Ouvre un dossier à un ONGLET donné (« Gérer les examens » de
	    module-edit.ts, via `ctx.openFolderTab`) : même geste qu'`openFolder`,
	    mais fixe aussi l'onglet AVANT le rendu — sans quoi `render()` le
	    ramènerait à « Contenu » (changement de dossier détecté). */
	openFolderTab(folder: string, onglet: OngletDossier): void;
}

export function createQuizzesHandlers(ctx: DashboardShellCtx): QuizzesHandlers {
	/* L'accès réel aux réglages est `ctx.settings.<clé>` (même objet que
	   `plugin.settings`, nommé — tâche 2). Lu à CHAQUE rendu : le réglage
	   peut changer sous nos pieds (autre appareil, rechargement). Le
	   réglage liste les groupes DÉPLIÉS
	   (replié = défaut) : à 200 quiz, tout déplier d'office reproduit le mur
	   qu'on cherche à éviter — cf. défaut n°1, Ahmed 2026-07-17. */
	function expandedSet(): Set<string> {
		return new Set(ctx.settings.quizzesExpandedFolders || []);
	}

	function toggleExpanded(path: string): void {
		const set = expandedSet();
		if (set.has(path)) set.delete(path); else set.add(path);
		ctx.settings.quizzesExpandedFolders = [...set];
		// Même canal que quizStats (stats-store.ts) ; l'échec d'écriture ne
		// doit pas casser le rendu.
		ctx.saveSettings().catch(() => {});
	}

	/* Axe de regroupement (2026-09-24) : « Récent » (défaut) et « Dossier »
	   pour tout le monde, puis « UE », personnalisé. Une valeur historique
	   inconnue (« module », « type »…) retombe sur le défaut. */
	function currentGrouping(): GroupingKey {
		const g = ctx.settings.quizzesGrouping;
		return g === "folder" || g === "ue" ? g : "recent";
	}

	function setGrouping(g: GroupingKey): void {
		ctx.settings.quizzesGrouping = g;
		// Switching the grouping rebuilds the whole grid: the entry cascade
		// goes with the change (decision of 2026-07-20). The only cascade the
		// grid still has — see `render`.
		regrouping = true;
		ctx.saveSettings().catch(() => {});
	}

	/* Le conteneur du dernier rendu : sans cette référence, un clic (chevron,
	   carte, retour) ne pourrait pas re-rendre depuis un callback capturé
	   dans quizzes-render.ts. Même patron qu'ai.ts:179/215. Réassigné à
	   chaque rendu — ne JAMAIS capturer un nœud DOM d'un rendu précédent,
	   `render` fait `container.replaceChildren()`. */
	let containerRef: HTMLElement | null = null;

	/* Table module lue depuis la note de correspondance, mise en cache : la
	   lecture est ASYNC (lireModuleMap) alors que render() est synchrone.
	   null tant que non chargée → dégradation (moduleForQuiz retombe sur le
	   dossier parent, sans UE). loadModuleMap() la peuple à l'ouverture de la
	   vue puis re-rend. */
	let moduleMap: ModuleMap | null = null;
	let moduleMapLoaded = false;
	/* Quiz dont le dossier doit s'ouvrir dès que la table sera lue. Un
	   `openFolderOfQuiz` reçu AVANT `moduleMap` (la fenêtre Windows recrée
	   ces handlers à chaque remontage de sa coquille, et le retour d'un quiz
	   arrive alors avant la première lecture) résolvait le dossier sur la
	   table VIDE : le parent immédiat, là où la note de correspondance
	   pouvait désigner un ancêtre — un dossier fantôme, vide, dans le fil
	   d'Ariane. Différer la résolution à la lecture est ce qui rend la
	   promesse « revenir dans SON module » vraie sous les deux hôtes. */
	let dossierAttenduPour: string | null = null;
	/* Module ouvert (drill-down) : null = grille ; sinon on affiche les quiz de
	   ce module + un fil d'Ariane. État d'interface, non persisté. */
	let openModuleFolder: string | null = null;
	/* The SUBJECT filter of the grid (2026-09-29, after StudySmarter's
	   "All subjects"): `null` = every folder. Interface state, not
	   persisted, like the open folder. */
	let sujetFiltre: CategorieQuiz | null = null;
	/** A folder's subject, deduced from its path and name (categorie-quiz.ts). */
	const sujetDe = (m: ModuleGroup): CategorieQuiz => categorieDuDossier(m.path ?? m.folder, m.name);

	/* Last view PAINTED ("root" or the open folder's path): render() compares
	   it with the current view to tell an ENTRY (the entry transition plays)
	   from an internal re-render (rename, archive, icon — no replay). null =
	   the next painting is an entry. */
	let lastPaintedView: string | null = null;
	/* The grid itself has NO entry transition since 2026-09-29: StudySmarter
	   plays none when its Library is opened from the rail (measured: only the
	   rail button's highlight fades). Only a change of grouping replays the
	   grid's cascade (`setGrouping`); a folder keeps its own entry. */
	let regrouping = false;

	async function loadModuleMap(): Promise<void> {
		moduleMapLoaded = true;
		// Cède TOUJOURS avant de poursuivre : sans ce yield, quand la note de
		// correspondance est absente, lireModuleMap renvoie MODULE_MAP_VIDE sans
		// jamais attendre, et la branche « map vide » ci-dessous ne traverse
		// alors AUCUN await réel —
		// la fonction (jusqu'à son `if (containerRef) render(...)` final)
		// s'exécute donc de façon SYNCHRONE et RÉENTRANTE, depuis l'intérieur
		// du render() qui vient de l'appeler (juste après `void loadModuleMap()`
		// ligne ~175), avant que CE render() ait fini de construire header/
		// recherche/sélecteur/filtres/contenu. Le render() imbriqué peint une
		// copie complète ; le render() externe reprend ensuite et peint une
		// SECONDE copie par-dessus, sans container.replaceChildren() entre les
		// deux → header/recherche/sélecteur/groupe/arbre dupliqués dans le DOM.
		// Ce yield garantit que le render() déclencheur s'est entièrement
		// déroulé avant toute réentrée, quelle que soit la branche empruntée
		// plus bas.
		await Promise.resolve();
		// Le brief demandait `|| ""` : passer une chaîne vide aurait fait
		// perdre le repli sur la note « Dashboard » (DEFAULT_SETTINGS,
		// plugin.ts) que l'ancien bloc appliquait — un comportement différent
		// si le réglage est vide ou pas encore migré. `"Dashboard"` restaure
		// exactement l'ancien fallback (bug du plan, corrigé — même correctif
		// que home.ts).
		moduleMap = await lireModuleMap(ctx.settings.quizzesModuleMapNote || "Dashboard");
		// Un retour de quiz reçu pendant la lecture : résolu MAINTENANT, sur la
		// vraie table, et peint par le rendu ci-dessous (pas `openModule` : ce
		// serait un second rendu, et un `recordNav` pour une restauration).
		if (dossierAttenduPour !== null) {
			const folder = moduleForQuiz(dossierAttenduPour, effectiveMap()).folder;
			dossierAttenduPour = null;
			if (folder) openModuleFolder = folder;
		}
		// Le premier rendu (map absente) est repeint ici quelques ms plus
		// tard : sans ré-armement, ce second rendu couperait net la transition
		// d'entrée à peine commencée (cartes soudain opaques).
		lastPaintedView = null;
		if (containerRef) render(containerRef);
	}

	/** Map effective au rendu : la note si chargée (sinon map vide), TOUJOURS
	    recouverte par les overrides du modal « Modifier dossier » (réglages) —
	    relus à chaque rendu, ils peuvent changer sous nos pieds. */
	function effectiveMap(): ModuleMap {
		const base = moduleMap ?? { byFolder: new Map(), ueOrder: [] };
		return applyModuleOverrides(base, ctx.settings.quizzesModuleOverrides || {});
	}

	function openModule(folder: string): void {
		// Mouse button history: the state being left (grid or another
		// folder) must stay restorable (spec 2026-07-20-mouse-nav-history).
		ctx.recordNav();
		const fromGrid = openModuleFolder === null;
		openModuleFolder = folder;
		const container = containerRef;
		if (!container) return;
		/* From the grid, the folder rises as a sheet over it (the host's
		   `sheetStack`); from another folder, a plain repaint. */
		if (fromGrid && ctx.sheetStack) ctx.sheetStack.open(() => render(container));
		else render(container);
	}

	/** Filtre de la GRILLE : exclut les quiz des DOSSIERS archivés (l'archivage
	    n'existe qu'au niveau dossier). Recherche et pilules d'état ont été
	    RETIRÉES (demande Ahmed 2026-07-18). */
	function applyFilters(quizzes: QuizIndexEntry[]): QuizIndexEntry[] {
		const map = effectiveMap();
		return quizzes.filter(q => !isFolderArchived(ctx, moduleForQuiz(q.path, map).folder));
	}

	/* Bascule entre la grille et le drill-down d'un module ouvert. `inModule`
	   (déjà filtré, PAS d'applyFilters au drill : on entre aussi dans un
	   dossier ARCHIVÉ depuis sa carte de la section « Archivés » et on y voit
	   son contenu) est calculé UNE fois par render() — mêmes quiz que les
	   stats du header. */
	/* L'onglet du dossier ouvert : celui où ce dossier avait été laissé (« Contenu »
	   la première fois) quand on change de dossier, inchangé sur un re-rendu du
	   même dossier. */
	let ongletDossier: OngletDossier = "contenu";
	let ongletPour: string | null = null;
	/* The last tab each folder was left on, for the session: a folder reopens
	   where it was, "Content" only the first time. */
	const ongletsMemorises = new Map<string, OngletDossier>();
	let vuesDossier: VuesDossier | null = null;
	/* Where the back arrow of the open folder goes instead of the grid, when the
	   folder was opened from another page (Generate's "Generated quizzes"). One
	   shot: set with the folder, dropped by the first back or any other
	   navigation (`resetDrilldown`). */
	let retourDossier: (() => void) | null = null;

	function renderContent(treeEl: HTMLElement, quizzes: QuizIndexEntry[], inModule: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): void {
		if (openModuleFolder !== null) {
			vuesDossier = renderModuleDrill(treeEl, ctx, inModule, stats, effectiveMap(), openModuleFolder, () => { if (containerRef) render(containerRef); }, ongletDossier);
		} else {
			const map = effectiveMap();
			const archivedQuizzes = quizzes.filter(q => isFolderArchived(ctx, moduleForQuiz(q.path, map).folder));
			renderQuizGrid({
				ctx,
				isExpanded: (key) => expandedSet().has(key),
				toggleExpanded,
				rerender: () => { if (containerRef) render(containerRef); },
				openModule,
			}, treeEl, currentGrouping(), applyFilters(quizzes), stats, map, archivedQuizzes,
				sujetFiltre === null ? undefined : (m) => sujetDe(m) === sujetFiltre);
		}
	}

	// Ordre FIXE : les tris par défaut, puis la section « Personnalisé » —
	// libellés SANS « By/Par » (demande Excalidraw 2026-07-18).
	const GROUPING_ORDER: GroupingKey[] = ["recent", "folder", "ue"];
	const GROUPING_LABEL_KEYS: Record<GroupingKey, TransKey> = {
		recent: "dashboard.quizzes.groupByActivity",
		folder: "dashboard.quizzes.groupByFolder",
		ue: "dashboard.quizzes.groupByUE"
	};

	/* "All subjects" and the subjects of the folders on screen, each with its
	   icon — never a subject no folder has: choosing it could only empty the
	   page. `general` is left out (it is "no subject found", not a subject);
	   those folders stay under "All subjects". A chosen subject that no
	   longer matches any folder falls back to "All subjects". */
	function renderSubjectFilter(parent: HTMLElement, quizzes: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): void {
		if (!ctx.renderGroupingSelect) return;
		const presents = new Set(modulesAffiches(applyFilters(quizzes), stats, effectiveMap(),
			declaredFolders(ctx.settings.quizzesModuleOverrides), ctx.settings.quizzesArchivedFolders || [], ctx.generatedFolder?.()).filter(m => !estLeSas(m, ctx.generatedFolder?.())).map(sujetDe));
		const sujets = CATEGORIES.filter(c => c !== "general" && presents.has(c));
		if (sujetFiltre !== null && !sujets.includes(sujetFiltre)) sujetFiltre = null;
		const TOUS = "";
		const icone = (el: HTMLElement, value: string): void => {
			const ic = ajouter(el, "span", "qbd-quizzes-subject-icon");
			if (value === TOUS) currentHost().ui.setIcon(ic, "layout-grid");
			else peindreIconeCategorie(ic, value as CategorieQuiz);
		};
		const select = ctx.renderGroupingSelect(parent, {
			value: sujetFiltre ?? TOUS,
			options: [
				{ value: TOUS, label: t("dashboard.quizzes.allSubjects") },
				...sujets.map(c => ({ value: c, label: libelleCategorie(c) })),
			],
			onChange: (v) => {
				sujetFiltre = v === TOUS ? null : v as CategorieQuiz;
				if (containerRef) render(containerRef);
			},
			renderTrigger: (labelEl, current) => {
				icone(labelEl, current?.value ?? TOUS);
				ajouter(labelEl, "span", undefined, current?.label ?? t("dashboard.quizzes.allSubjects"));
			},
			renderOption: (optBtn, option) => {
				icone(optBtn, option.value);
				ajouter(optBtn, "span", "qbd-select-option-label", option.label);
			},
		});
		select.el.classList.add("qbd-quizzes-group-select", "qbd-quizzes-subject-select");
	}

	/* The "Generated quizzes" folder is no card of the grid: a button of the
	   top bar opens it, with the number of quizzes it holds (0 while empty or
	   not created yet). Opening goes through `openModule`, like a card did, so
	   the same sheet transition plays. Recognised by its PATH. */
	/** The phone's floating buttons, on `<body>` (see `render`). */
	let boutonsFlottants: HTMLElement[] = [];

	function renderGeneratedButton(parent: HTMLElement, quizzes: QuizIndexEntry[], stats: Record<string, QuizStatRecord>, flottant = false): HTMLElement | null {
		const sas = ctx.generatedFolder?.();
		if (!sas) return null;
		const groupe = modulesAffiches(quizzes, stats, effectiveMap(), [], [], sas).find(m => estLeSas(m, sas));
		if (!groupe) return null;
		/* On a phone it floats at the bottom left, where StudySmarter puts its
		   blue button (2026-10-05): the top keeps one row of filters. */
		const btn = ajouter(parent, "button", flottant
			? "qbd-quizzes-fab qbd-quizzes-fab--gauche"
			: "qbd-select qbd-quizzes-group-select qbd-quizzes-subject-select qbd-quizzes-generated-btn");
		btn.type = "button";
		const label = ajouter(btn, "span", "qbd-select-label");
		currentHost().ui.setIcon(ajouter(label, "span", "qbd-quizzes-subject-icon"), "sparkles");
		ajouter(label, "span", undefined, t("ai.side.generated"));
		ajouter(label, "span", "qbd-quizzes-node-badge", String(groupe.quizzes.length));
		btn.addEventListener("click", () => openModule(groupe.folder));
		return btn;
	}

	function render(container: HTMLElement): void {
		containerRef = container;
		container.replaceChildren();
		for (const f of boutonsFlottants) f.remove();
		boutonsFlottants = [];

		// Entry transition (spec 2026-07-20): the class is set ONLY when the
		// view changes — mechanism shared with the home page (view-enter.ts).
		if (openModuleFolder !== ongletPour) {
			ongletDossier = (openModuleFolder !== null ? ongletsMemorises.get(openModuleFolder) : undefined) ?? "contenu";
			ongletPour = openModuleFolder;
		}
		vuesDossier = null;
		const viewKey = openModuleFolder ?? "root";
		const entering = viewKey === "root" ? regrouping : viewKey !== lastPaintedView;
		regrouping = false;
		lastPaintedView = viewKey;
		markViewEnter(container, entering, "qbd-quizzes-enter");
		// A folder stands on one back sheet (the grid), the grid on none.
		ctx.sheetStack?.sync(openModuleFolder !== null ? 1 : 0);

		const quizzes: QuizIndexEntry[] = ctx.scanner ? ctx.scanner.getQuizzes() : [];
		const stats: Record<string, QuizStatRecord> = ctx.statsStore ? ctx.statsStore.getAll() : {};

		// Chargement paresseux, UNE fois : la note de correspondance est lue en
		// async (lireModuleMap) alors que render() est synchrone — le premier
		// rendu se fait donc sans UE/noms résolus, puis loadModuleMap() re-rend.
		if (!moduleMapLoaded) { void loadModuleMap(); }

		const map = effectiveMap();
		// Quiz du dossier ouvert : calculé UNE fois, réutilisé par la grille ET
		// l'onglet « Progression » (renderModuleDrill) — les deux comptent
		// alors exactement les mêmes quiz, jamais deux totaux qui divergent.
		const inModule: QuizIndexEntry[] = openModuleFolder !== null
			? quizzes.filter(q => moduleForQuiz(q.path, map).folder === openModuleFolder)
			: [];
		const openModuleInfo = openModuleFolder !== null ? map.byFolder.get(openModuleFolder) : undefined;
		/* Le SAS des quiz générés (`ctx.generatedFolder`) : accent bleu et icône
		   de l'IA à défaut d'un choix à la main, et pas de « maîtrisés » dans
		   l'en-tête — même règle que sa carte et que sa page (quizzes-render.ts,
		   `estLeSas`). Reconnu par le CHEMIN du dossier ouvert : déclaré, sinon
		   déduit d'un quiz. C'est aussi le chemin que « Nouveau quiz » utilise. */
		const cheminOuvert = openModuleInfo?.path
			?? (inModule.length > 0 ? moduleForQuiz(inModule[0].path, map).path : undefined);
		const sas = !!ctx.generatedFolder && cheminOuvert !== undefined && cheminOuvert === ctx.generatedFolder();
		const openModuleAccent = openModuleFolder !== null
			? moduleAccent(openModuleInfo ?? { folder: openModuleFolder }, { generated: sas })
			: null;
		// La lueur de l'hôte prend la couleur du dossier ouvert (null hors dossier).
		ctx.ambiance?.(openModuleAccent);

		/* Le dossier ouvert possède sa bannière. Plus de halo derrière le
		   titre (2026-09-25) : la lueur salissait toute la page ; la couleur
		   du dossier ne tient plus que dans l'icône du titre. */
		let headerParent = container;
		if (openModuleAccent !== null) {
			const hero = ajouter(container, "div", "qbd-quizzes-folder-hero");
			hero.style.setProperty("--accent", openModuleAccent);
			headerParent = ajouter(hero, "div", "qbd-quizzes-folder-hero-inner");
		}

		// ── Header ──
		// Racine : AUCUN header — le titre vit dans le rail et la pilule
		// « + New folder » sur la ligne du regroupement (demande Ahmed
		// 2026-07-20), même ligne que le chip UE/Recent.
		if (openModuleFolder !== null) {
			/* Retour AU-DESSUS du titre (2026-09-25) : à sa gauche, la flèche
			   décalait le titre et se lisait mal. Un seul bouton retour dans
			   tout le dashboard. */
			/* The back arrow and, on its right, the Content | Progress | Review
			   plan tabs, wider (2026-10-05): the title row keeps the name and
			   the actions. */
			const ligneHaut = ajouter(headerParent, "div", "qbd-quizzes-toprow");
			const back = ajouter(ligneHaut, "button", "qbd-quizzes-crumb-back qbd-quizzes-header-back");
			const header = ajouter(headerParent, "div", "qbd-quizzes-header");
			back.type = "button";
			back.setAttribute("aria-label", t("dashboard.quizzes.backToModules"));
			// Flèche dessinée en CSS (masque), comme tout bouton retour du dashboard.
			ajouter(back, "span", "qbd-quizzes-crumb-icon");
			back.addEventListener("click", () => {
				const retour = retourDossier;
				retourDossier = null;
				if (retour) { retour(); return; }
				ctx.recordNav();
				openModuleFolder = null;
				// The folder's sheet slides back down, uncovering the grid.
				if (ctx.sheetStack) ctx.sheetStack.close(target => render(target));
				else if (containerRef) render(containerRef);
			});
			// Dans un dossier : le header EST le titre du dossier — icône + nom du
			// module, teinte à l'accent du dossier (comme sa carte). Le nom n'est
			// donc plus répété dans le fil d'Ariane (cf. quizzes-render.ts).
			// Colonne texte + soulignement dégradé (référence claude.ai) sous le nom.
			const titleBlock = ajouter(header, "div", "qbd-quizzes-title-block");
			const titleEl = ajouter(titleBlock, "h2", "qbd-quizzes-title");
			const titleIcon = ajouter(titleEl, "span", "qbd-quizzes-title-icon");
			/* With the folder's NAME even when the module table has no entry for it,
			   as its card does (module-card.ts): without it, a folder named after
			   its subject ("XTI301 - Python") showed its `{ }` on the card and the
			   default book on its own page (2026-09-29). */
			currentHost().ui.setIcon(titleIcon, moduleIcon({ ...openModuleInfo, name: openModuleInfo?.name || openModuleFolder }, { generated: sas }));
			ajouter(titleEl, "span", "qbd-quizzes-title-text", openModuleInfo?.name || openModuleFolder);
			ajouter(titleBlock, "div", "qbd-quizzes-title-underline");

			// ── À droite : Contenu | Progression. Plus de compteurs ni de
			// « Nouveau quiz » (2026-09-25) : les chiffres sont dans l'onglet
			// Progression, et « Ajouter du contenu » est à côté de l'étape
			// suivante, au-dessus de la grille (quizzes-render.ts).
			if (!sas) {
				renderOngletsDossier(ligneHaut, ongletDossier, (onglet) => {
					ongletDossier = onglet;
					if (openModuleFolder !== null) ongletsMemorises.set(openModuleFolder, onglet);
					if (vuesDossier) basculerVueDossier(vuesDossier, onglet);
				});
			}
			const headerActions = ajouter(header, "div", "qbd-quizzes-header-actions");

			/* « Nouveau quiz », entre les onglets et le ⋯ (2026-09-26) : la
			   barre « Ajouter du contenu » pleine largeur au-dessus de la grille
			   est partie. Même pilule que « Nouveau dossier » de « Mes quiz ».
			   Absent dans le sas, qui ne se remplit que par la génération. */
			/* Not while the folder is empty (2026-09-29): its options are then
			   on the page itself (`renderEmptyFolder`, folder-add.ts). */
			const { createQuiz } = ctx;
			if (createQuiz && !sas && inModule.length > 0) {
				const nouveau = ajouter(headerActions, "button", "qbd-btn--create");
				nouveau.type = "button";
				currentHost().ui.setIcon(ajouter(nouveau, "span", "qbd-btn-icon"), "plus");
				ajouter(nouveau, "span", undefined, t("dashboard.quizzes.newQuiz"));
				const dossier = cheminOuvert ?? openModuleFolder;
				nouveau.addEventListener("click", () => createQuiz(dossier, () => { if (containerRef) render(containerRef); }));
			}

			/* No "Share" button here any more (2026-09-29): the ⋯ menu below
			   already opens the same share modal, and the button took the room
			   that a long folder title needs. */

			/* « ⋯ » : le menu du dossier (Modifier, Ouvrir dans l'explorateur,
			   Archiver…), le MÊME que celui de sa carte dans « Mes quiz »
			   (2026-09-26, comme StudySmarter). Absent si l'hôte n'en a pas. */
			const { openModuleMenu } = ctx;
			if (openModuleMenu && openModuleFolder !== null) {
				const plus = ajouter(headerActions, "button", "qbd-folder-more-btn");
				plus.type = "button";
				plus.setAttribute("aria-label", t("dashboard.card.more"));
				currentHost().ui.setIcon(plus, "ellipsis-vertical");
				const groupe = {
					folder: openModuleFolder, name: openModuleInfo?.name || openModuleFolder, ue: openModuleInfo?.ue ?? null,
					path: cheminOuvert, color: openModuleInfo?.color, icon: openModuleInfo?.icon,
					quizzes: inModule, total: inModule.length, mastered: 0,
				};
				plus.addEventListener("click", () => openModuleMenu(groupe, plus, () => { if (containerRef) render(containerRef); }, effectiveMap()));
			}

			/* LE SAS : « Générer », et non « Nouveau quiz » (demande d'Ahmed,
			   2026-09-20). La génération est la SEULE façon dont un quiz arrive
			   ici : les deux autres options du modal — vierge, import — écrivent
			   dans le dossier de leur choix, jamais dans le sas. Proposer un
			   geste qui ne remplit pas le dossier qu'on regarde est un bouton
			   qui ment. MASQUÉ (pas grisé) si l'hôte ne sert pas « ai », même
			   règle que le bouton de l'accueil : un bouton d'ACTION mort au clic
			   est pire qu'absent. */
			if (sas) {
				if (ctx.canOpen("ai")) {
					const genBtn = ajouter(headerActions, "button", "qbd-btn--create");
					const genIcon = ajouter(genBtn, "span", "qbd-btn-icon");
					currentHost().ui.setIcon(genIcon, "sparkles");
					ajouter(genBtn, "span", undefined, t("dashboard.nav.generate"));
					genBtn.addEventListener("click", () => ctx.navigate("ai"));
				}
			}
		}

		// ── Regroupement (UE / Récent) ──
		// Masqué en drill-down : l'axe de regroupement n'a pas de sens à
		// l'intérieur d'un module (spec Task 4). Le déclencheur affiche
		// TOUJOURS le mode courant en toutes lettres, jamais une icône seule :
		// sans ça, un utilisateur qui revient après plusieurs jours en mode
		// « Par activité » croirait à un bug plutôt qu'à un mode qu'il a choisi
		// (retour Ahmed 2026-07-17 — StudySmarter est l'inspiration, pas le contrat).
		// `&& (...)` : le conteneur n'est créé QUE s'il aura un enfant — côté
		// application (D5) ni renderGroupingSelect ni createFolder n'existent,
		// et une coquille vide hériterait quand même du margin-top 61px de
		// `.qbd-quizzes-group` (dashboard-quizzes.css), poussant la grille pour rien.
		if (openModuleFolder === null && (ctx.renderGroupingSelect || ctx.createFolder)) {
			const groupWrap = ajouter(container, "div", "qbd-quizzes-group");
			// The two selects on the left, "New folder" on the right.
			const selects = ajouter(groupWrap, "div", "qbd-quizzes-group-selects");
			renderSubjectFilter(selects, quizzes, stats);
			// Vrai SELECT (createSelect, ui-select.ts), pas un menu d'actions :
			// options exclusives dont une active → menu d'OPTIONS à la largeur
			// du trigger, check accent à droite, bordure accent à l'ouverture
			// (aria-expanded) — l'état « après clic » StudySmarter (annotation
			// Ahmed 2026-07-18). openActionMenu imposait son min-width 248px,
			// son icône à gauche et aucun état ouvert.
			// `createSelect` (ui-select.ts) importe encore Obsidian (D5, cf.
			// plan tranche 2.5 « ce que la tranche laisse ouvert ») : le
			// rendu passe donc par `ctx.renderGroupingSelect`, optionnel.
			// Absent côté application : l'axe déjà persisté reste actif, sans
			// bouton pour le changer (bouton MASQUÉ, Ruling 7).
			const groupSelect = ctx.renderGroupingSelect?.(selects, {
				value: currentGrouping(),
				options: GROUPING_ORDER.map(g => ({ value: g, label: t(GROUPING_LABEL_KEYS[g]), section: g === "ue" ? t("dashboard.quizzes.groupCustom") : undefined })),
				onChange: (v) => { setGrouping(v as GroupingKey); render(container); }
			});
			groupSelect?.el.classList.add("qbd-quizzes-group-select");
			// The Generated folder's own entry, after the two selects: it left the
			// grid (9f6b0356), and was unreachable from Folders while this call
			// was missing (night QA, 2026-10-01).
			/* ON A PHONE (2026-10-05, StudySmarter's Library): the top keeps ONE
			   row, the two filters; "Generated quizzes" floats at the bottom
			   left and "New folder" is a round + at the bottom right. */
			/* The floating buttons live on `<body>`: an ancestor of the page
			   makes `position: fixed` relative to itself on a phone, and they
			   ended up under the last card. Removed at each render; hidden by
			   CSS whenever the folders grid is not on screen. */
			const mobile = currentHost().platform.isMobile;
			if (!mobile && ctx.openMoodle) {
				const moodle = ajouter(selects, "button", "qbd-select qbd-quizzes-group-select qbd-quizzes-subject-select qbd-quizzes-generated-btn");
				moodle.type = "button";
				const lm = ajouter(moodle, "span", "qbd-select-label");
				currentHost().ui.setIcon(ajouter(lm, "span", "qbd-quizzes-subject-icon"), "graduation-cap");
				ajouter(lm, "span", undefined, t("settings.moodle.title"));
				moodle.addEventListener("click", () => ctx.openMoodle?.());
			}
			const genere = renderGeneratedButton(mobile ? document.body : selects, quizzes, stats, mobile);
			if (mobile && genere) boutonsFlottants.push(genere);

			if (ctx.createFolder && mobile) {
				const fab = ajouter(document.body, "button", "qbd-quizzes-fab qbd-quizzes-fab--droite");
				boutonsFlottants.push(fab);
				fab.type = "button";
				fab.setAttribute("aria-label", t("dashboard.quizzes.new"));
				currentHost().ui.setIcon(fab, "plus");
				fab.addEventListener("click", () => {
					ctx.createFolder!(effectiveMap(), quizzes, () => { if (containerRef) render(containerRef); });
				});
			}

			// « Nouveau dossier » sur la MÊME ligne que le chip UE/Recent, calé à
			// droite, même pilule que « Nouveau quiz » du drill (demande Ahmed
			// 2026-07-20 — le header racine a disparu avec lui). Absent côté
			// application (modals hors périmètre, D5) : bouton MASQUÉ (Ruling 7).
			/* "Import" beside "New folder" (2026-10-05): what was received has
			   its own button, the modal only creates. The same 3D pill as "New
			   folder" in the translucent colours of the library's secondary 3D
			   button (`button/cta-3d--lifted-face-shimmer`, "Jump ahead"): a
			   page action, never a modal one. A quiz is imported from "New quiz" in its folder. */
			if (ctx.createFolder && !mobile) {
				const importBtn = ajouter(groupWrap, "button", "qbd-btn--create qbd-btn--import qbd-quizzes-import");
				importBtn.type = "button";
				currentHost().ui.setIcon(ajouter(importBtn, "span", "qbd-btn-icon"), "download");
				ajouter(importBtn, "span", undefined, t("dashboard.quizzes.import"));
				/* The format it takes, always shown (a touch screen has no hover). */
				ajouter(importBtn, "span", "qbd-btn-ext", ".zip");
				importBtn.addEventListener("click", () => {
					void importSharedFolder(ctx, effectiveMap(), quizzes, () => { if (containerRef) render(containerRef); });
				});
			}
			if (ctx.createFolder && !mobile) {
				const newBtn = ajouter(groupWrap, "button", "qbd-btn--create");
				const newIcon = ajouter(newBtn, "span", "qbd-btn-icon");
				currentHost().ui.setIcon(newIcon, "plus");
				ajouter(newBtn, "span", undefined, t("dashboard.quizzes.new"));
				newBtn.addEventListener("click", () => {
					ctx.createFolder!(effectiveMap(), quizzes, () => { if (containerRef) render(containerRef); });
				});
			}
		}

		// ── Contenu : grille (UE/Récent) ou drill-down d'un module ──
		const treeEl = ajouter(container, "div", "qbd-quizzes-tree");
		renderContent(treeEl, quizzes, inModule, stats);
	}

	return {
		render,
		// `dossierAttenduPour` aussi : une refermeture demandée pendant la
		// lecture de la table ne doit pas être annulée par un retour différé.
		resetDrilldown() { openModuleFolder = null; retourDossier = null; dossierAttenduPour = null; lastPaintedView = null; },
		getOpenFolder() { return openModuleFolder; },
		openFolder(folder: string) { openModule(folder); },
		openFolderTab(folder: string, onglet: OngletDossier) {
			ctx.recordNav();
			openModuleFolder = folder;
			// Fixé AVANT le rendu : `render()` ne réinitialise l'onglet que
			// quand `openModuleFolder !== ongletPour` (changement de dossier).
			ongletDossier = onglet;
			ongletPour = folder;
			ongletsMemorises.set(folder, onglet);
			if (containerRef) render(containerRef);
		},
		openFolderOfQuiz(quizPath: string, retour?: () => void) {
			retourDossier = retour ?? null;
			// Table pas encore lue (`lireModuleMap` rend toujours un objet, même
			// vide : `null` veut dire « en cours ») : c'est `loadModuleMap` qui
			// ouvrira, sur la vraie table. Voir `dossierAttenduPour`.
			if (moduleMap === null) { dossierAttenduPour = quizPath; return; }
			// Dossier inconnu (quiz à la racine du vault) → on reste sur la
			// grille plutôt que d'ouvrir un dossier fantôme.
			const folder = moduleForQuiz(quizPath, effectiveMap()).folder;
			if (folder) openModule(folder);
		},
		selectFolderOfQuiz(quizPath: string) {
			if (moduleMap === null) { dossierAttenduPour = quizPath; return; }
			openModuleFolder = moduleForQuiz(quizPath, effectiveMap()).folder || null;
		},
	};
}
