import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { applyModuleOverrides, moduleForQuiz } from "./quiz-modules";
import type { ModuleMap } from "./quiz-modules";
import { isFolderArchived } from "./folder-archive";
import { renderQuizGrid, renderModuleDrill } from "./quizzes-render";
import type { GroupingKey } from "./quizzes-render";
import { moduleAccent } from "./module-color";
import { lireModuleMap } from "./module-map-note";
import { markViewEnter } from "./view-enter";
import { moduleIcon } from "./module-icons";

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
	openFolderOfQuiz(quizPath: string): void;
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
		// La bascule d'axe reconstruit toute la grille : la cascade d'entrée
		// accompagne le changement (décision Ahmed, spec 2026-07-20).
		lastPaintedView = null;
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

	/* Dernière vue PEINTE ("root" ou chemin du dossier ouvert) : render() la
	   compare à la vue courante pour distinguer une ENTRÉE (navigation, drill
	   in/out, bascule d'axe — la transition d'entrée joue) d'un re-render
	   interne (renommage, archivage, icône — aucun replay). null = la
	   prochaine peinture est une entrée. */
	let lastPaintedView: string | null = null;

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
		// Historique boutons souris : l'état quitté (grille ou autre dossier)
		// doit rester restaurable (spec 2026-07-20-mouse-nav-history).
		ctx.recordNav();
		openModuleFolder = folder;
		if (containerRef) render(containerRef);
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
	function renderContent(treeEl: HTMLElement, quizzes: QuizIndexEntry[], inModule: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): void {
		if (openModuleFolder !== null) {
			renderModuleDrill(treeEl, ctx, inModule, stats, effectiveMap(), openModuleFolder, () => { if (containerRef) render(containerRef); });
		} else {
			const map = effectiveMap();
			const archivedQuizzes = quizzes.filter(q => isFolderArchived(ctx, moduleForQuiz(q.path, map).folder));
			renderQuizGrid({
				ctx,
				isExpanded: (key) => expandedSet().has(key),
				toggleExpanded,
				rerender: () => { if (containerRef) render(containerRef); },
				openModule,
			}, treeEl, currentGrouping(), applyFilters(quizzes), stats, map, archivedQuizzes);
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

	function render(container: HTMLElement): void {
		containerRef = container;
		container.replaceChildren();

		// Transition d'entrée (spec 2026-07-20) : classe posée SEULEMENT quand la
		// vue change — mécanisme partagé avec l'accueil (view-enter.ts).
		const viewKey = openModuleFolder ?? "root";
		const entering = viewKey !== lastPaintedView;
		lastPaintedView = viewKey;
		markViewEnter(container, entering, "qbd-quizzes-enter");

		const quizzes: QuizIndexEntry[] = ctx.scanner ? ctx.scanner.getQuizzes() : [];
		const stats: Record<string, QuizStatRecord> = ctx.statsStore ? ctx.statsStore.getAll() : {};

		// Chargement paresseux, UNE fois : la note de correspondance est lue en
		// async (lireModuleMap) alors que render() est synchrone — le premier
		// rendu se fait donc sans UE/noms résolus, puis loadModuleMap() re-rend.
		if (!moduleMapLoaded) { void loadModuleMap(); }

		const map = effectiveMap();
		// Quiz du dossier ouvert : calculé UNE fois, réutilisé par les stats du
		// header ET le panneau Progrès (renderModuleDrill) — les deux comptent
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
			const back = ajouter(headerParent, "button", "qbd-quizzes-crumb-back qbd-quizzes-header-back");
			const header = ajouter(headerParent, "div", "qbd-quizzes-header");
			back.type = "button";
			back.setAttribute("aria-label", t("dashboard.quizzes.backToModules"));
			// Flèche dessinée en CSS (masque), comme tout bouton retour du dashboard.
			ajouter(back, "span", "qbd-quizzes-crumb-icon");
			back.addEventListener("click", () => {
				ctx.recordNav();
				openModuleFolder = null;
				if (containerRef) render(containerRef);
			});
			// Dans un dossier : le header EST le titre du dossier — icône + nom du
			// module, teinte à l'accent du dossier (comme sa carte). Le nom n'est
			// donc plus répété dans le fil d'Ariane (cf. quizzes-render.ts).
			// Colonne texte + soulignement dégradé (référence claude.ai) sous le nom.
			const titleBlock = ajouter(header, "div", "qbd-quizzes-title-block");
			const titleEl = ajouter(titleBlock, "h2", "qbd-quizzes-title");
			const titleIcon = ajouter(titleEl, "span", "qbd-quizzes-title-icon");
			currentHost().ui.setIcon(titleIcon, moduleIcon(openModuleInfo ?? {}, { generated: sas }));
			ajouter(titleEl, "span", "qbd-quizzes-title-text", openModuleInfo?.name || openModuleFolder);
			ajouter(titleBlock, "div", "qbd-quizzes-title-underline");

			// ── Action du header : la pilule « Nouveau quiz », à droite. Plus de
			// compteurs « N quiz | N maîtrisés » (2026-09-25) : le nombre de
			// quiz est dans le panneau « Progrès », qui dit aussi les maîtrisés.
			const headerActions = ajouter(header, "div", "qbd-quizzes-header-actions");

			// Drill-down : créer un dossier ICI n'a pas de sens (demande Ahmed
			// 2026-07-19) → une seule pilule « Nouveau quiz », qui ouvre le MÊME
			// modal à trois options que « Nouveau dossier » (IA / vierge /
			// import), décliné pour le dossier OUVERT — homogénéité demandée.
			// Absente côté application (modals = tranche 2.6, D5) : le bouton
			// est alors MASQUÉ, pas grisé (Ruling 7 — un bouton d'action absent
			// ne déroute personne, contrairement au rail de navigation).
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
			} else if (ctx.createQuiz) {
				/* LE CHEMIN RÉEL, jamais le segment (correctif 2026-09-17) :
				   `openModuleFolder` est une CLÉ de module (« Generated »), et
				   l'écriture veut un chemin du contrat (« Neo Quiz/Generated »).
				   Passer le segment faisait échouer « Nouveau quiz » dans TOUT
				   dossier qui n'était pas posé à la racine d'un dossier ouvert —
				   `fs.write` rendait « chemin hors des dossiers ouverts », et
				   l'utilisateur ne voyait qu'un « Impossible de créer le quiz ».
				   Le défaut est né avec l'application : sous Obsidian, les
				   chemins sont relatifs au vault, donc le segment y suffisait.
				   Ordre : la déclaration, sinon le chemin déduit d'un quiz du
				   dossier, sinon le segment (comportement d'avant). */
				const folder = cheminOuvert ?? openModuleFolder;
				// Le reflet qui défile, comme « Commencer le quiz » (2026-09-25).
				const newQuizBtn = ajouter(headerActions, "button", "qbd-btn--create qbd-btn--shine");
				const newQuizIcon = ajouter(newQuizBtn, "span", "qbd-btn-icon");
				currentHost().ui.setIcon(newQuizIcon, "plus");
				ajouter(newQuizBtn, "span", undefined, t("dashboard.quizzes.newQuiz"));
				ajouter(newQuizBtn, "span", "qbd-btn-shine").setAttribute("aria-hidden", "true");
				newQuizBtn.addEventListener("click", () => {
					ctx.createQuiz!(folder, () => { if (containerRef) render(containerRef); });
				});
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
			const groupSelect = ctx.renderGroupingSelect?.(groupWrap, {
				value: currentGrouping(),
				options: GROUPING_ORDER.map(g => ({ value: g, label: t(GROUPING_LABEL_KEYS[g]), section: g === "ue" ? t("dashboard.quizzes.groupCustom") : undefined })),
				onChange: (v) => { setGrouping(v as GroupingKey); render(container); }
			});
			groupSelect?.el.classList.add("qbd-quizzes-group-select");

			// « Nouveau dossier » sur la MÊME ligne que le chip UE/Recent, calé à
			// droite, même pilule que « Nouveau quiz » du drill (demande Ahmed
			// 2026-07-20 — le header racine a disparu avec lui). Absent côté
			// application (modals hors périmètre, D5) : bouton MASQUÉ (Ruling 7).
			if (ctx.createFolder) {
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
		resetDrilldown() { openModuleFolder = null; dossierAttenduPour = null; lastPaintedView = null; },
		getOpenFolder() { return openModuleFolder; },
		openFolder(folder: string) { openModule(folder); },
		openFolderOfQuiz(quizPath: string) {
			// Table pas encore lue (`lireModuleMap` rend toujours un objet, même
			// vide : `null` veut dire « en cours ») : c'est `loadModuleMap` qui
			// ouvrira, sur la vraie table. Voir `dossierAttenduPour`.
			if (moduleMap === null) { dossierAttenduPour = quizPath; return; }
			// Dossier inconnu (quiz à la racine du vault) → on reste sur la
			// grille plutôt que d'ouvrir un dossier fantôme.
			const folder = moduleForQuiz(quizPath, effectiveMap()).folder;
			if (folder) openModule(folder);
		},
	};
}
