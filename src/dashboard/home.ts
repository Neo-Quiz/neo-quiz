import { PRODUCT_NAME } from "../branding";
import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { renderQuizCard as renderSharedQuizCard } from "./quiz-card";
import { regrouperParCours } from "./course-pairs";
import { isFolderArchived } from "./folder-archive";
import { moduleForQuiz, applyModuleOverrides } from "./quiz-modules";
import type { ModuleMap } from "./quiz-modules";
import { moduleAccent } from "./module-color";
import { lireModuleMap } from "./module-map-note";
import { renderCollapsibleSection } from "./collapsible";
import { markViewEnter } from "./view-enter";
import { createOptionCard, importSharedFolder } from "./folder-create";
import { openNewFolderModal } from "./module-edit";

/* ══════════════════════════════════════════════════════════
   HOME VIEW — Dashboard
   Header + stats grid + sections "À reprendre" / "Complétés"
══════════════════════════════════════════════════════════ */

/** Cartes affichées par section : 2 rangées de 3 sur large, ni plus (l'accueil
    n'est pas « Mes quiz »), ni moins (une seule rangée ne relance pas assez). */
const HOME_GRID_MAX = 6;

/** Carte de la grille de stats (statCards ci-dessous). */
interface StatCard {
	label: string;
	value: string;
	sub: string;
	icon: string;
	highlight?: boolean;
}

export interface HomeHandlers {
	/** `entering` = on ARRIVE sur la page (la transition d'entrée se joue).
	    L'hôte le sait : c'est lui qui compare la vue peinte à la vue demandée
	    (dashboard.ts). Un re-render déclenché par le scanner du vault ou par le
	    menu ⋯ d'une carte passe `false` — sinon la page clignote à chaque
	    sauvegarde de note. */
	render(container: HTMLElement, entering?: boolean): void;
}

export function createHomeHandlers(ctx: DashboardShellCtx): HomeHandlers {

	/* Dernier conteneur peint : le menu ⋯ d'une carte (archivage, reset de
	   stats) doit pouvoir repeindre l'accueil sans repasser par la navigation. */
	let containerRef: HTMLElement | null = null;
	/* Valeur d'`entering` du dernier rendu : quand la table des modules arrive
	   (lecture async) et déclenche un repeint, il doit REJOUER l'entrée si le
	   rendu interrompu en était une — sinon la cascade se coupe net à peine
	   commencée (même piège que quizzes.ts). */
	let lastEntering = true;

	/* Table des modules lue dans la note de correspondance, comme « Mes quiz ».
	   Sans elle, un quiz rangé dans un SOUS-dossier de son module se voyait
	   attribuer l'accent (et le dossier d'archivage) du sous-dossier ici, celui
	   du module là-bas : deux couleurs pour un même quiz selon la page. */
	let moduleMap: ModuleMap | null = null;
	let moduleMapLoaded = false;

	async function loadModuleMap(): Promise<void> {
		moduleMapLoaded = true;
		// Cède TOUJOURS avant de poursuivre : sans ce yield, la branche « note
		// absente » ne traverse aucun await réel et re-rendrait DEPUIS le render()
		// en cours, qui peindrait ensuite une seconde copie par-dessus (piège
		// documenté au long dans quizzes.ts).
		await Promise.resolve();
		// Le brief demandait `|| ""` : passer une chaîne vide aurait fait
		// perdre le repli sur la note « Dashboard » (DEFAULT_SETTINGS,
		// plugin.ts) que l'ancien bloc appliquait — un comportement différent
		// si le réglage est vide ou pas encore migré. `"Dashboard"` restaure
		// exactement l'ancien fallback (bug du plan, corrigé).
		moduleMap = await lireModuleMap(ctx.settings.quizzesModuleMapNote || "Dashboard");
		if (containerRef) render(containerRef, lastEntering);
	}

	/** Re-render déclenché par la page elle-même (menu ⋯) : jamais d'entrée. */
	function rerender(): void {
		if (containerRef) render(containerRef, false);
	}

	function render(container: HTMLElement, entering = true): void {
		containerRef = container;
		lastEntering = entering;
		markViewEnter(container, entering, "qbd-home-enter");
		container.replaceChildren();

		// Cascade d'entrée : UN seul compteur pour toute la page (tuiles de
		// stats, en-têtes de section, cartes) — même formule que « Mes quiz ».
		let entryIndex = 0;
		const entryDelay = (): string => `${100 + entryIndex++ * 45}ms`;

		// Les quiz des DOSSIERS ARCHIVÉS (menu ⋯ d'une carte de dossier de
		// « Mes quiz ») n'existent plus pour l'accueil : ni stats, ni sections.
		// Ils ne reviennent que sous la section « Archivés » de « Mes quiz ».
		// Même table effective que « Mes quiz » : la note (chargée en tâche de
		// fond au premier rendu) recouverte par les overrides du modal
		// « Modifier dossier », relus à chaque rendu.
		if (!moduleMapLoaded) { void loadModuleMap(); }
		const map: ModuleMap = applyModuleOverrides(
			moduleMap ?? { byFolder: new Map(), ueOrder: [] },
			ctx.settings.quizzesModuleOverrides || {}
		);
		const allQuizzes: QuizIndexEntry[] = ctx.scanner ? ctx.scanner.getQuizzes() : [];
		const quizzes = allQuizzes.filter(q => !isFolderArchived(ctx, moduleForQuiz(q.path, map).folder));
		const stats: Record<string, QuizStatRecord> = ctx.statsStore ? ctx.statsStore.getAll() : {};

		// ── Premier usage : aucun quiz → onboarding guidé ──
		if (allQuizzes.length === 0) {
			renderOnboarding(container, map, allQuizzes);
			return;
		}

		// ── Classement des quiz par état (utilisé par le hero + les sections) ──
		const inProgress = quizzes.filter(q => {
			const s = stats[q.path];
			return s && s.questionsDone > 0 && s.questionsDone < q.questions;
		});
		const notStarted = quizzes.filter(q => {
			const s = stats[q.path];
			return !s || s.questionsDone === 0;
		});
		const completed = quizzes.filter(q => {
			const s = stats[q.path];
			return s && s.questionsDone >= q.questions;
		});

		// ── Header ──
		const header = ajouter(container, "div", "qbd-home-header");
		const headerLeft = ajouter(header, "div", "qbd-home-header-left");
		ajouter(headerLeft, "h2", "qbd-home-title", PRODUCT_NAME);

		// Sous-titre orientant : annonce les deux actions principales. (La note
		// active reste dans le footer de la sidebar, et la vue Générer la relit.)
		const subtitle = inProgress.length > 0
			? t("dashboard.home.subtitleResume")
			: t("dashboard.home.subtitleStart");
		ajouter(headerLeft, "p", "qbd-home-subtitle", subtitle);

		// Pilule claire IDENTIQUE à « + New folder » de « Mes quiz » : une seule
		// grammaire d'action primaire dans le dashboard (contrat 2026-07-28).
		// MASQUÉ (pas grisé) si l'hôte ne sait pas servir "ai" : un bouton
		// d'ACTION mort au clic est pire qu'absent, contrairement au rail
		// (forme fixe et mémorisée) que canOpen se contente de griser.
		if (ctx.canOpen("ai")) {
			const genBtn = ajouter(header, "button", "qbd-btn--create");
			const genIcon = ajouter(genBtn, "span", "qbd-btn-icon");
			currentHost().ui.setIcon(genIcon, "sparkles");
			ajouter(genBtn, "span", undefined, t("dashboard.home.generate"));
			genBtn.addEventListener("click", () => ctx.navigate("ai"));
		}

		// ── Reprendre : dernier quiz en cours (action primaire du returning user) ──
		const resumeQuiz = inProgress
			.slice()
			.sort((a, b) => {
				const la = (stats[a.path] && stats[a.path].lastPlayed) || 0;
				const lb = (stats[b.path] && stats[b.path].lastPlayed) || 0;
				return lb - la;
			})[0];
		if (resumeQuiz) {
			renderResumeHero(container, resumeQuiz, stats[resumeQuiz.path], accentOf(resumeQuiz, map));
		}

		// ── Stats grid ──
		const statsGrid = ajouter(container, "div", "qbd-home-stats");

		const totalQuestions = ctx.scanner ? ctx.scanner.getTotalQuestions() : 0;
		const mastered = quizzes.filter(q => {
			const s = stats[q.path];
			return s && s.bestScore >= 80;
		}).length;

		// Construit DANS render : les libellés sont traduits à chaque rendu (une
		// constante de module serait figée dans la langue du démarrage).
		const statCards: StatCard[] = [
			{ label: t("dashboard.home.statQuizzes"), value: String(quizzes.length), sub: t("dashboard.home.statQuizzesSub"), icon: "layers" },
			{ label: t("dashboard.home.statQuestions"), value: String(totalQuestions), sub: t("dashboard.home.statQuestionsSub"), icon: "list" },
			{
				label: t("dashboard.home.statMastered"), value: `${mastered}/${quizzes.length}`, sub: t("dashboard.home.statMasteredSub"),
				icon: "award", highlight: true
			}
		];

		for (const card of statCards) {
			const el = ajouter(statsGrid, "div", `qbd-stat-card${card.highlight ? " qbd-stat-card--highlight" : ""}`);
			el.style.setProperty("--qbd-card-delay", entryDelay());
			const head = ajouter(el, "div", "qbd-stat-head");
			const icon = ajouter(head, "span", "qbd-stat-icon");
			currentHost().ui.setIcon(icon, card.icon);
			ajouter(head, "p", "qbd-stat-label", card.label);
			ajouter(el, "p", "qbd-stat-value", card.value);
			// Aucune barre de progression sur une tuile de stats : même règle que
			// les cartes de dossier (contrat visuel « Mes quiz »), le chiffre porte
			// déjà l'information.
			ajouter(el, "p", "qbd-stat-sub", card.sub);
		}

		// ── Sections de quiz ──
		// Mêmes en-têtes que « Mes quiz » : rangée 52px, chevron animé, libellé
		// 16px, badge compteur, repli persisté (contrat visuel 2026-07-28). Les
		// micro-capitales 10px, propres à l'accueil, ont disparu avec eux.
		const collapse = {
			isExpanded: (key: string) => new Set(ctx.settings.quizzesExpandedFolders || []).has(key),
			toggleExpanded: (key: string) => {
				const set = new Set(ctx.settings.quizzesExpandedFolders || []);
				if (set.has(key)) set.delete(key); else set.add(key);
				ctx.settings.quizzesExpandedFolders = [...set];
				ctx.saveSettings().catch(() => {});
			},
		};

		// À faire (en cours + à commencer). La grille est PLAFONNÉE (revue design
		// 2026-07-28) : 54 cartes faisaient de l'accueil un doublon de « Mes
		// quiz ». Deux rangées de trois suffisent à reprendre le travail ; le
		// reste vit derrière « See all », qui affiche le total resté dehors.
		/* Une section = en-tête repliable + grille plafonnée + « See all » vers
		   « Mes quiz ». TOUTE section plafonnée porte ce lien : sans lui, les
		   quiz au-delà du 6e n'auraient aucune sortie depuis l'accueil. */
		const renderSection = (key: string, label: string, quizzes: QuizIndexEntry[], defaultOpen: boolean): void => {
			/* Un cours, une carte (course-pairs.ts), comme dans « Mes quiz » : le
			   compteur et le plafond comptent des COURS, pas des fichiers. */
			const list = regrouperParCours(quizzes, ctx.settings.quizzesGroupModes !== false);
			const shown = list.slice(0, HOME_GRID_MAX);
			const section = ajouter(container, "div", "qbd-home-section");
			const body = renderCollapsibleSection(collapse, section, key, label, list.length, {
				rowClass: "qbd-home-node-row",
				entryDelay,
				defaultOpen,
				// « See all » vit à CÔTÉ de l'en-tête, jamais dedans : l'en-tête
				// est lui-même un <button> (un bouton dans un bouton est invalide).
				headRow: (row) => {
					const seeAll = ajouter(row, "button", "qbd-btn qbd-btn--subtle");
					seeAll.type = "button";
					ajouter(seeAll, "span", undefined,
						list.length > shown.length
							? t("dashboard.home.seeAllCount", { count: list.length })
							: t("dashboard.home.seeAll")
					);
					const chevron = ajouter(seeAll, "span", "qbd-btn-icon qbd-btn-icon--sm");
					currentHost().ui.setIcon(chevron, "chevron-right");
					seeAll.addEventListener("click", () => ctx.navigate("quizzes"));
				},
			});

			const grid = ajouter(body, "div", "qbd-home-grid");
			for (const { quiz, frere } of shown) {
				renderQuizCard(grid, quiz, stats[quiz.path], map, frere, frere ? stats[frere.path] : undefined).style
					.setProperty("--qbd-card-delay", entryDelay());
			}
		};

		/* ── À réviser aujourd'hui ──
		   L'ordonnanceur rend des CLÉS de question (`chemin::id`) ; l'accueil
		   les regroupe par note pour rester actionnable — le seul geste
		   possible aujourd'hui est d'ouvrir un quiz. La session composée de
		   questions venant de plusieurs notes est le chantier suivant.

		   `reviewStore` peut être absent : la task 7 le fait DÉGRADER plutôt
		   que bloquer le greffon, donc l'accueil doit vivre sans lui — c'est
		   pourquoi ce membre de `DashboardShellCtx` est optionnel. */
		const plan = ctx.reviewStore?.plan(Date.now());
		if (plan && plan.today.length) {
			const parNote = new Map<string, number>();
			for (const cle of plan.today) {
				const sep = cle.lastIndexOf("::");
				// Une clé sans séparateur ne vient pas du catalogue : on la
				// laisse tomber plutôt que de fabriquer un chemin vide.
				if (sep <= 0) continue;
				const path = cle.slice(0, sep);
				parNote.set(path, (parNote.get(path) ?? 0) + 1);
			}

			// Nombre décroissant, puis chemin : ordre TOTAL, donc stable d'un
			// rendu à l'autre — l'ordre de `plan.today` sert la SESSION (il
			// entrelace les familles), pas l'affichage.
			const lignes = [...parNote.entries()]
				.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
				.map(([path, n]) => ({ quiz: ctx.scanner?.getQuiz(path), n }))
				// Note disparue entre le scan et le rendu : rien à ouvrir.
				.filter((l): l is { quiz: QuizIndexEntry; n: number } => !!l.quiz);

			// Une section vide n'a rien à dire : si toutes les notes dues ont
			// disparu, on n'affiche pas un en-tête qui ne mène nulle part.
			if (lignes.length > 0) {
				const section = ajouter(container, "div", "qbd-home-section");
				// Même helper que « À faire » et « Complétés » : rangée 52px,
				// chevron animé, libellé, badge compteur. Un balisage écrit à
				// la main ici serait une VARIANTE de l'anatomie, ce que le
				// contrat visuel du 2026-07-28 interdit.
				const body = renderCollapsibleSection(
					collapse, section, "home:review", t("dashboard.review.title"), plan.today.length,
					{ rowClass: "qbd-home-node-row", entryDelay, defaultOpen: true },
				);

				const liste = ajouter(body, "div", "qbd-review-list");
				for (const { quiz, n } of lignes) {
					const row = ajouter(liste, "button", "qbd-review-row");
					row.type = "button";
					const icone = ajouter(row, "span", "qbd-review-icon");
					currentHost().ui.setIcon(icone, "rotate-ccw");
					ajouter(row, "span", "qbd-review-title", quiz.title);
					ajouter(row, "span", "qbd-review-count",
						t(n === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: n }),
					);
					row.addEventListener("click", () => ctx.openQuiz(quiz));
				}

				/* Le report est une INFORMATION, pas un reproche : il dit que le
				   budget du jour a tenu, pas que l'utilisateur est en retard. */
				if (plan.deferred.length) {
					ajouter(liste, "p", "qbd-review-deferred",
						t(
							plan.deferred.length === 1 ? "dashboard.review.deferredOne" : "dashboard.review.deferredOther",
							{ count: plan.deferred.length },
						),
					);
				}
			}
		}

		// À faire (en cours + à commencer). La grille est PLAFONNÉE (revue design
		// 2026-07-28) : 54 cartes faisaient de l'accueil un doublon de « Mes
		// quiz ». Deux rangées de trois suffisent à reprendre le travail ; le
		// reste vit derrière « See all », qui affiche le total resté dehors.
		const todo = [...inProgress, ...notStarted];
		if (todo.length > 0) {
			renderSection("home:todo", t("dashboard.home.todo"), todo, true);
		}

		// Complétés — repliés par défaut : le badge dit combien, la grille ne
		// repousse plus « À faire » hors de l'écran.
		if (completed.length > 0) {
			renderSection("home:completed", t("dashboard.home.completed"), completed, false);
		}

	}

	/* Héros « Reprendre » — teinté par l'accent du DOSSIER du quiz, comme sa
	   carte (revue design 2026-07-28) : liseré vertical, halo, label, barre et
	   bouton en dérivent. C'est ce qui règle la concurrence d'accents : la
	   pilule claire reste l'action de page (« Generate a quiz »), le héros parle
	   la couleur de son module au lieu du bleu d'interface. */
	function renderResumeHero(container: HTMLElement, quiz: QuizIndexEntry, stats: QuizStatRecord | null | undefined, accent: string): void {
		const total = quiz.questions || (stats && stats.totalQuestions) || 0;
		const done = stats ? stats.questionsDone : 0;
		const pct = total > 0 ? Math.round(done / total * 100) : 0;

		const hero = ajouter(container, "div", "qbd-resume-hero");
		hero.style.setProperty("--accent", accent);
		const open = () => ctx.navigate("detail", { quiz });
		hero.addEventListener("click", open);

		// Halo derrière le contenu : boîte propre, entièrement contenue (une
		// ellipse qui dépasserait se ferait couper net par un ancêtre à scroll).
		ajouter(hero, "div", "qbd-resume-halo");

		const info = ajouter(hero, "div", "qbd-resume-info");

		const label = ajouter(info, "div", "qbd-resume-label");
		const labelIcon = ajouter(label, "span", "qbd-resume-label-icon");
		currentHost().ui.setIcon(labelIcon, "history");
		ajouter(label, "span", undefined, t("dashboard.home.resumeLabel"));

		ajouter(info, "p", "qbd-resume-title", quiz.title);

		// Dossier parent, même source que la ligne des cartes : le héros dit d'où
		// vient le quiz, sinon sa couleur d'accent n'a aucun référent à l'écran.
		const segs = quiz.path.split("/").slice(0, -1).filter(Boolean);
		if (segs.length > 0) {
			ajouter(info, "p", "qbd-resume-path", segs[segs.length - 1]);
		}

		const progress = ajouter(info, "div", "qbd-resume-progress");
		const bar = ajouter(progress, "div", "qbd-resume-bar");
		const fill = ajouter(bar, "div", "qbd-resume-bar-fill");
		fill.style.width = `${pct}%`;
		// L'accord se joue sur le TOTAL (« 0/1 question », « 3/10 questions ») :
		// le compteur formé est ensuite inséré tel quel dans la ligne de progression.
		const questions = t(total === 1 ? "dashboard.common.questionsOfOne" : "dashboard.common.questionsOfOther", { done, total });
		ajouter(progress, "span", "qbd-resume-progress-text", t("dashboard.home.resumeProgress", { questions, pct }));

		const btn = ajouter(hero, "button", "qbd-btn qbd-resume-btn");
		const btnIcon = ajouter(btn, "span", "qbd-btn-icon");
		currentHost().ui.setIcon(btnIcon, "play");
		ajouter(btn, "span", undefined, t("dashboard.home.resumeBtn"));
		btn.addEventListener("click", (e) => { e.stopPropagation(); open(); });
	}

	function renderOnboarding(container: HTMLElement, map: ModuleMap, allQuizzes: QuizIndexEntry[]): void {
		const wrap = ajouter(container, "div", "qbd-onboarding");

		const icon = ajouter(wrap, "div", "qbd-onboarding-icon");
		currentHost().ui.setIcon(icon, "graduation-cap");

		ajouter(wrap, "h2", "qbd-onboarding-title", t("dashboard.onboarding.title"));
		ajouter(wrap, "p", "qbd-onboarding-lead", t("dashboard.onboarding.lead"));

		// Action primaire évidente — MÊME pilule claire que l'accueil peuplé et
		// que « + New folder » : une seule grammaire d'action primaire.
		// MASQUÉ (pas grisé) si l'hôte ne sait pas servir "ai" : c'est ici le
		// cas le plus grave (dossier vide, SEULE action primaire de l'écran).
		if (ctx.canOpen("ai")) {
			const primary = ajouter(wrap, "button", "qbd-btn--create qbd-onboarding-cta");
			const pIcon = ajouter(primary, "span", "qbd-btn-icon");
			currentHost().ui.setIcon(pIcon, "sparkles");
			ajouter(primary, "span", undefined, t("dashboard.onboarding.generate"));
			primary.addEventListener("click", () => ctx.navigate("ai"));
		}

		// Séparateur
		const divider = ajouter(wrap, "div", "qbd-onboarding-divider");
		ajouter(divider, "span", undefined, t("dashboard.onboarding.or"));

		/* Les trois cartes du modal « Créer un dossier », rendues sur place
		   (spec « utilisable par n'importe qui », § 1) : personne ne crée un quiz
		   à la main dans un bloc de code, et « Générer » au-dessus EST la carte
		   IA. Même composant, même CSS : aucune apparence de plus à tenir. */
		const cartes = ajouter(wrap, "div", "qbd-onboarding-cards");
		createOptionCard(null, cartes, "folder-plus", "#4573ff", t("dashboard.quizzes.createEmptyTitle"), t("dashboard.quizzes.createEmptyDesc"),
			() => openNewFolderModal(ctx, map, allQuizzes, rerender));
		if (ctx.openExistingFolder) {
			createOptionCard(null, cartes, "folder-open", "#f5a524", t("dashboard.quizzes.createOpenTitle"), t("dashboard.quizzes.createOpenDesc"),
				() => ctx.openExistingFolder!(rerender));
		}
		createOptionCard(null, cartes, "download", "#a78bfa", t("dashboard.quizzes.createImportTitle"), t("dashboard.quizzes.createImportDesc"),
			() => void importSharedFolder(ctx, map, allQuizzes, rerender));
	}

	/** Accent du DOSSIER d'un quiz — même source que « Mes quiz ». */
	function accentOf(quiz: QuizIndexEntry, map: ModuleMap): string {
		const folder = moduleForQuiz(quiz.path, map).folder;
		return moduleAccent(map.byFolder.get(folder) ?? { folder });
	}

	/* Carte de quiz — MÊME anatomie que « Mes quiz » : verre, teinte du dossier
	   parent, bouton lecture et menu ⋯. L'accueil et « Mes quiz » ne parlaient
	   pas la même langue visuelle ; depuis le contrat 2026-07-28, une carte de
	   quiz a UNE seule apparence. Le cran de cascade est posé par l'appelant :
	   il continue le compteur de la page (stats et en-têtes l'ont déjà avancé). */
	function renderQuizCard(
		container: HTMLElement,
		quiz: QuizIndexEntry,
		stats: QuizStatRecord | null | undefined,
		map: ModuleMap,
		frere?: QuizIndexEntry,
		statsFrere?: QuizStatRecord
	): HTMLDivElement {
		return renderSharedQuizCard(container, quiz, stats, (q) => ctx.navigate("detail", { quiz: q }), {
			frere,
			statsFrere,
			onPlay: (q) => ctx.openQuiz(q),
			// Absent côté application (menus et modals = tranche 2.6) : la carte
			// se rend alors sans bouton « ⋯ », `onMenu?` étant opt-in. L'hôte
			// OUVRE le menu lui-même (tour de correction 1, tâche 6) — la carte
			// ne fait plus que signaler le clic et son ancre.
			onMenu: ctx.openCardMenu ? (q, anchor) => ctx.openCardMenu!(q, anchor, rerender, map) : undefined,
			accent: accentOf(quiz, map),
		});
	}

	return { render };
}
