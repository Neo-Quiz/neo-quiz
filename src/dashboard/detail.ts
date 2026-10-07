import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { markViewEnter } from "./view-enter";
import { t } from "../i18n";
import { formatDateHeure } from "./format-date";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import { quizFreres } from "./course-pairs";
import type { QuizStatRecord, StatsStore } from "./stats-store";
import { getCanal, getProvider, libelleModele } from "./ai-providers";
import { renderEntete, dossierDuQuiz, setActionBadge } from "./detail-head";
import type { Entete, EnteteAction } from "./detail-head";
import { glossaryHeaderAction, glossaryMenuItem, texteBadgeGlossaire } from "./glossaire-modal";
import { openTypePickerModal, openConfirmModal } from "../editor/modals";
import { closeAllSelects } from "./ui-select";
import type { ActionMenuItem } from "./ui-select";
import { mathifyElement } from "../engine/mathjax";
import { loadQuizDraft, saveQuizDraft, questionText, draftIsStale } from "./detail-io";
import type { QuizDraft, QuizLoadError } from "./detail-io";
import { renderQuestionView } from "./detail-question";
import { renderQuestionEditRendu } from "./detail-edition";
import { libererChamps } from "../editor/champ-direct";
import { oublierFiche, questionsTrouvees, renderFiche, renderInfosQuiz, renderRecherche, renderTop, suivreDebord } from "./detail-fiche";
import type { FicheOrigine } from "./detail-fiche";
import { mountSlideHost, setSlide, slideTo, reserveTallest, finish as finishSlide } from "./detail-slide";
import type { SlideHost } from "./detail-slide";
import { makeDefault } from "../editor/utils";
import { mountListSheet } from "./detail-list-sheet";
import type { DraftQuestion } from "../editor/utils";
import { lectureCourteDe, numeroAffiche, numerosAffiches, questionHote, questionsVisibles } from "../lecture-etape";
import { applyModuleOverrides } from "./quiz-modules";
import type { ModuleMap } from "./quiz-modules";
import { lireModuleMap } from "./module-map-note";

/* ══════════════════════════════════════════════════════════
   QUIZ PAGE — ce qu'on voit en cliquant un quiz (refonte 2026-07-21,
   contrat Excalidraw d'Ahmed).

   L'ancienne page « détail » (colonne de cartes de stats + aperçu mort
   des 5 premières questions) est remplacée par la page de travail de la
   référence : le quiz LUI-MÊME, questions à gauche, question courante à
   droite, stats compactées en haut à côté du nom.

   Un seul écran, deux modes — consultation (défaut) et édition — au lieu
   d'un aller-retour vers un éditeur en onglet. Pas de barre d'onglets,
   pas de panneau « Code » : demande explicite d'Ahmed.

   L'édition écrit dans la note (debounce) via detail-io, qui partage la
   chaîne de lecture/écriture de l'éditeur complet.
══════════════════════════════════════════════════════════ */

const SAVE_DEBOUNCE_MS = 600;

/** Ce qu'une page « quiz » a besoin de savoir de son quiz. Un quiz du vault
    et un quiz FRAÎCHEMENT GÉNÉRÉ (encore en mémoire, sans note) s'y décrivent
    de la même façon : c'est ce qui permet à la page « Générer » d'afficher la
    page de travail complète au lieu d'un éditeur à part. */
export interface QuizPageSpec {
	/** Identité de la page : changer de clé remet son état à zéro. */
	key: string;
	title: string;
	/** Ligne sous le titre, pour une page SANS entrée du catalogue (la ligne
	    d'usage d'une génération). Un quiz du catalogue montre son dossier,
	    tiré de `stats.path`. Vide → ligne masquée. */
	subtitle: string;
	load(): Promise<QuizDraft | QuizLoadError>;
	/** Écrit les modifications. Absent : quiz en mémoire, rien à persister. */
	save?(draft: QuizDraft): Promise<boolean>;
	/** Entrée du scanner, pour la rangée de stats. Absente : pas de rangée —
	    un quiz qui n'existe pas encore n'a ni score ni tentative. */
	stats?: QuizIndexEntry;
	/** Flèche retour : le SEUL chemin de sortie de la page. C'est la part de
	    l'HÔTE, comme `isStale` : la page ne sait pas d'où l'on vient (vue
	    précédente du tableau de bord, onglet à refermer, scène de génération
	    à relancer) — celui qui la monte le sait, et le dit ici. */
	onBack(): void;
	/** Bouton principal à droite. Absent → masqué. Reçoit son propre élément :
	    un menu flottant doit s'ancrer au bouton cliqué, pas à la page. */
	start?: { label: string; icon: string; onClick(el: HTMLElement): void };
	/** Actions supplémentaires, posées avant le bouton principal. */
	actions?: Array<{ label: string; icon: string; onClick(el: HTMLElement): void }>;
	/** Vrai quand la page n'est plus celle qu'on regarde (vue changée) : les
	    flèches ← → cessent alors de lui répondre. Part de l'HÔTE, lue à
	    chaque touche : seul lui connaît sa vue courante — la page, elle, ne
	    porte aucun état de navigation. */
	isStale?(): boolean;
	/** Ouvrir d'emblée en ÉDITION. Pour un quiz qu'on vient de créer : sa
	    question est vierge, la relire n'apprendrait rien. Ne vaut qu'à la
	    PREMIÈRE ouverture de cette clé — ensuite l'utilisateur décide. */
	startEditing?: boolean;
	/** ENTRER avec une animation (en-tête, puis la liste et le panneau) :
	    pour un quiz qui vient d'être généré, dont la page remplace la modale
	    d'attente. Ne vaut qu'au PREMIER rendu, comme `startEditing` : un
	    repeint interne (frappe, question suivante) ne rejoue rien. */
	animateEntry?: boolean;
	/** La question COURANTE au premier rendu de cette clé (bornée) : celle sur
	    laquelle l'éditeur s'ouvre depuis la fiche. Pour l'hôte qui rouvre là où on s'était
	    arrêté ; le greffon ne la passe pas. Ne vaut qu'à la première ouverture
	    de la clé, comme `startEditing`. Elle ne décide PAS de l'écran : une
	    arrivée montre toujours la fiche (voir `ouverture`). */
	initialQuestion?: number;
	/** Vrai quand l'utilisateur OUVRE la page (navigation) : elle repart de sa
	    fiche, même sur le quiz qu'elle montrait déjà — un aperçu ou une édition
	    laissés en partant ne doivent pas devenir le nouvel écran d'ouverture.
	    Faux (ou absent) pour un simple repeint. Consommée au rendu, comme
	    `startEditing` : la même spec sert à chaque repeint interne, et la
	    relire ramènerait la fiche à chaque clic. */
	ouverture?: boolean;
	/** Appelée à chaque changement de question courante, par `goToQuestion`
	    et nulle part ailleurs — c'est le seul endroit où `activeIdx` bouge. */
	onQuestionChange?(index: number): void;
	/** The OTHER modes of the same course (course-pairs.ts): the page then
	    shows a selector Learn | Practice | Exam that opens them. */
	autresModes?: Array<{ quiz: QuizIndexEntry; open(): void }>;
	/** The page's "⋮" menu: the quiz card's (host), with `extra` lines on
	    top (the editor's "Vocabulary"). */
	menu?(anchor: HTMLElement, extra?: ActionMenuItem[]): void;
}

/** Dépendances d'une page « quiz », indépendantes du dashboard — et de
    l'hôte. `app` et `plugin` d'Obsidian y figuraient : la page ne les
    lisait pas elle-même, elle les relayait à ses satellites (lecture et
    écriture du bloc, image collée), qui passent tous par le contrat d'hôte
    depuis la tranche 3. Il ne reste que le magasin de stats, et seulement
    pour la rangée d'un quiz du catalogue. */
export interface QuizPageDeps {
	statsStore?: StatsStore;
}

export interface QuizPageHandlers {
	render(container: HTMLElement, spec: QuizPageSpec): void;
	/** Écrit sur-le-champ ce qui est en attente (sortie de vue, fermeture).
	    La promesse se résout quand l'écriture est TERMINÉE — pas quand elle est
	    lancée. Un hôte qui ferme sa fenêtre doit pouvoir l'attendre : la
	    fenêtre Windows n'a pas de vault qui survit au processus, et fermer
	    juste après une frappe perdait la frappe sans un mot tant que ce
	    retour était `void`. Ne rejette jamais (l'échec est déjà signalé par
	    une Notice dans `runSave`). */
	flush(): Promise<void>;
	/** Écrit, puis rend TOUT ce que la page tient au système : écoute clavier
	    posée sur le document, glissement en vol, brouillon. Sans cet appel à
	    la fermeture de la vue, le listener ne se détachait qu'au prochain
	    appui de touche — et retenait d'ici là le DOM et le brouillon.
	    Le démontage du DOM et des écoutes est SYNCHRONE (fait avant le premier
	    `await`) ; la promesse ne porte que l'écriture, comme `flush`. */
	dispose(): Promise<void>;
}

/** La part de la spec que seul l'HÔTE du tableau de bord peut écrire pour un
    quiz du catalogue : où revenir, et si sa page est encore celle qu'on
    regarde. Le wrapper ci-dessous compose tout le reste depuis l'entrée du
    scanner ; ces deux clôtures, lui, il ne peut pas les deviner. Elles
    lisaient `ctx.view.previousView`, `ctx.view.quizzes` et
    `ctx.view.currentView` — la vue Obsidian, que `DashboardShellCtx` ne porte
    pas et que la fenêtre n'a pas. Les remonter chez l'appelant plutôt
    qu'élargir le ctx : la page sert déjà trois hôtes PAR UNE SPEC, et un
    membre de plus sur le ctx aurait forcé la fenêtre à fabriquer une fausse
    vue. C'est le même découpage que `QuizPageSpec.onBack`/`isStale`, dont
    ces champs sont la projection exacte. */
export type DetailHostSpec = Pick<QuizPageSpec, "onBack" | "isStale" | "startEditing" | "animateEntry" | "initialQuestion" | "onQuestionChange" | "ouverture">;

export interface DetailHandlers {
	render(container: HTMLElement, quiz: QuizIndexEntry, host: DetailHostSpec): void;
	/** Relayé à la page : appelé à la fermeture de la vue dashboard. Se résout
	    quand l'écriture en attente est terminée (voir `QuizPageHandlers`). */
	dispose(): Promise<void>;
}

/* ── La page « quiz » du dashboard : UNE instance, sur un quiz du vault. La
   page « Générer » en crée une autre, sur son quiz en mémoire — d'où la
   séparation entre createQuizPage (le composant) et ce wrapper (la vue). ── */
export function createDetailHandlers(ctx: DashboardShellCtx): DetailHandlers {
	const page = createQuizPage({ statsStore: ctx.statsStore });

	/* Table des modules pour le sous-menu « Déplacer vers » (menu ⋯ de la
	   fiche) — même patron paresseux que home.ts : chargée en tâche de fond,
	   au pire absente au premier clic (le menu montre alors moins de
	   dossiers, jamais une erreur), présente dès le rendu suivant. Cette page
	   n'a pas de `repaint()` exposé à l'extérieur pour forcer un rafraîchissement
	   dès que la lecture aboutit ; ce n'est pas nécessaire ici puisque le menu
	   ne lit `moduleMap` qu'AU CLIC, longtemps après ce premier rendu. */
	let moduleMap: ModuleMap | null = null;
	let moduleMapLoaded = false;
	async function loadModuleMap(): Promise<void> {
		moduleMapLoaded = true;
		await Promise.resolve();
		moduleMap = await lireModuleMap(ctx.settings.quizzesModuleMapNote || "Dashboard");
	}

	return {
		render(container: HTMLElement, quiz: QuizIndexEntry, host: DetailHostSpec): void {
			if (!moduleMapLoaded) void loadModuleMap();
			const map: ModuleMap = applyModuleOverrides(
				moduleMap ?? { byFolder: new Map(), ueOrder: [] },
				ctx.settings.quizzesModuleOverrides || {}
			);
			page.render(container, {
				key: quiz.path,
				title: quiz.title,
				subtitle: quiz.path,
				stats: quiz,
				load: () => loadQuizDraft(quiz.path),
				save: (draft) => saveQuizDraft(draft),
				onBack: host.onBack,
				start: {
					// The fiche's label in every mode: the button must not
					// change width when the page switches to the editor.
					label: t("dashboard.quiz.welcomeStart"),
					icon: "play",
					// `ctx.openQuiz` et non un appel direct : c'est L'HÔTE qui
					// décide ce que « jouer » veut dire. Dans
					// la fenêtre il monte la page du moteur.
					onClick: () => ctx.openQuiz(quiz),
				},
				isStale: host.isStale,
				startEditing: host.startEditing,
				animateEntry: host.animateEntry,
				initialQuestion: host.initialQuestion,
				onQuestionChange: host.onQuestionChange,
				ouverture: host.ouverture,
				autresModes: quizFreres(quiz, ctx.scanner.getQuizzes()).map(f => ({ quiz: f, open: () => ctx.navigate("detail", { quiz: f }) })),
				/* The card's menu, with a repaint that re-reads the quiz: renamed,
				   the page picks it up; deleted or moved out of the catalogue, we go
				   back. */
				menu: ctx.openCardMenu ? (anchor, extra) => ctx.openCardMenu!(quiz, anchor, () => {
					const frais = ctx.scanner.getQuiz(quiz.path);
					if (frais) ctx.navigate("detail", { quiz: frais });
					else host.onBack();
				}, map, extra) : undefined,
			});
		},
		dispose: () => page.dispose(),
	};
}

export function createQuizPage(ctx: QuizPageDeps): QuizPageHandlers {
	/* Spécification et conteneur du DERNIER rendu : la page se repeint
	   elle-même (bascule du mode édition) sans passer par son hôte — c'est
	   ce qui rend la transition possible et ce qui la rend réutilisable. */
	let currentSpec: QuizPageSpec | null = null;
	/* The header of the LAST render, and what repaints the questions after a
	   new search: the fiche's grid, or the editor's list. */
	let entete: Entete | null = null;
	let surRecherche: (() => void) | null = null;
	let currentContainer: HTMLElement | null = null;
	/* État de la page, gardé ENTRE deux rendus du même quiz : le dashboard
	   re-rend la vue sur des événements externes (changement de réglage), et
	   repartir à la question 1 en mode consultation à chaque fois rendrait
	   l'édition inutilisable. Remis à zéro quand on ouvre un AUTRE quiz. */
	let currentPath: string | null = null;
	let draft: QuizDraft | null = null;
	let activeIdx = 0;
	let editing = false;
	/** La fiche du quiz est demandée (voir `showingWelcome`) : vrai à
	    l'ouverture d'un quiz, faux dès qu'on ouvre une question. */
	let welcome = false;
	let saveTimer: number | null = null;
	/** Brouillon FIGÉ dont l'écriture est en attente, et sa fonction d'écriture
	    — pour que le débounce n'aille pas viser le quiz suivant. */
	let pendingSave: { draft: QuizDraft; save: (d: QuizDraft) => Promise<boolean> } | null = null;
	/** Les écritures s'ENCHAÎNENT, jamais en parallèle. Le débounce annule des
	    MINUTERIES, pas une écriture déjà partie : deux frappes assez espacées
	    en déclenchaient deux, et la seconde lisait le témoin (`blockSource`)
	    avant que la première ne l'ait actualisé — son compare-and-swap échouait,
	    sa version restait en mémoire, et la note gardait la précédente
	    (revue codex 2026-07-31, `[true, false]` reproduit). */
	let saveChain: Promise<void> = Promise.resolve();

	/** Met une écriture À LA SUITE des précédentes, et signale son échec. */
	function runSave(pending: QuizDraft, save: (d: QuizDraft) => Promise<boolean>): void {
		// `then(ok, err)` et non `.then().catch()` : la chaîne doit rester
		// TENABLE après un échec, sinon toutes les écritures suivantes de la
		// session seraient court-circuitées par un rejet définitif.
		saveChain = saveChain.then(() => save(pending)).then(
			(ok) => { if (!ok) currentHost().ui.notice(t("dashboard.quiz.saveError")); },
			() => { currentHost().ui.notice(t("dashboard.quiz.saveError")); },
		);
	}
	/** Piste du carrousel du panneau — recréée à chaque paintPanel. */
	let slideHost: SlideHost | null = null;
	/** Détache l'écoute clavier de la page précédente. */
	let keyCleanup: (() => void) | null = null;
	/** Nettoyage de la question montée en édition (detail-edition.ts). */
	let demonterEditionCourante: (() => void) | null = null;
	/** « Plus » ouvert ou fermé, gardé d'une question et d'un repeint à
	    l'autre tant que la page vit : le rouvrir à chaque question lassait. */
	let plusOuvert = false;

	/* LECTURES ABSORBÉES (src/lecture-etape.ts, 2026-09-26) : dans un Learn,
	   la carte de lecture d'une étape qui a d'autres questions n'est ni une
	   carte de la liste ni une question de la navigation ; son cours
	   s'affiche au-dessus de chaque question de l'étape. Tout est RECALCULÉ à
	   chaque usage, jamais gardé : l'édition change rôles, étapes et ordre, et
	   supprimer la dernière question d'une étape rend sa lecture autonome —
	   donc de nouveau visible. `activeIdx` reste un index du BROUILLON. */
	/** Le brouillon est un Learn — le mode que le moteur lit
	    (`readModeConfig` normalise comme `extractExamOptions`). Hors Learn,
	    rien n'est absorbé : le moteur jouerait chaque lecture comme un écran. */
	function estLecon(): boolean {
		return draft?.examOptions?.mode === "lesson";
	}
	function visibles(): number[] {
		return draft ? questionsVisibles(draft.questions, estLecon()) : [];
	}
	/** Numéro affiché de l'index `i` (1…n), 0 pour une lecture de Learn,
	    qui n'en a pas (src/lecture-etape.ts `numeroAffiche`). */
	function numeroDe(i: number): number {
		return draft ? numeroAffiche(draft.questions, estLecon(), i) : i + 1;
	}
	/** La question visible qui montre `i` (lui-même, sauf une lecture courte,
	    qui se lit au-dessus de sa question hôte). */
	function hote(i: number): number {
		return draft ? questionHote(draft.questions, estLecon(), i) : i;
	}
	/** La lecture COURTE lue au-dessus de `i` (src/lecture-etape.ts), qui
	    s'y modifie ; toute autre lecture a sa propre entrée. */
	function lectureDe(i: number): DraftQuestion | undefined {
		if (!draft) return undefined;
		const l = lectureCourteDe(draft.questions, estLecon(), i);
		return l === null ? undefined : draft.questions[l];
	}
	/** La question visible voisine de `i` (`dir` = ±1), ou -1 au bout. */
	function voisine(i: number, dir: 1 | -1): number {
		const v = visibles();
		const p = v.indexOf(i);
		return p < 0 ? -1 : (v[p + dir] ?? -1);
	}

	/** Démonte la question en édition : un texte ouvert y est validé, ses
	    écouteurs et ses champs retirés. Avant tout repeint du panneau. */
	function demonterEdition(): void {
		const d = demonterEditionCourante;
		demonterEditionCourante = null;
		d?.();
	}

	function scheduleSave(): void {
		// Pas de `save` : le quiz n'existe qu'en mémoire (résultat d'une
		// génération). Ses retouches vivent dans le brouillon jusqu'à
		// l'insertion dans une note — il n'y a rien à écrire d'ici là.
		if (!draft || !currentSpec?.save) return;
		if (saveTimer) window.clearTimeout(saveTimer);
		/* Le brouillon et son écrivain sont FIGÉS ici, pas relus à l'échéance :
		   ouvrir un autre quiz pendant les 600 ms remplaçait `draft` et
		   `currentSpec`, et la frappe du premier partait alors dans le second —
		   ou nulle part. */
		const pending = draft;
		const save = currentSpec.save;
		saveTimer = window.setTimeout(() => {
			saveTimer = null;
			pendingSave = null;
			runSave(pending, save);
		}, SAVE_DEBOUNCE_MS);
		pendingSave = { draft: pending, save };
	}

	/** Repeint la page telle qu'elle est — sans repasser par l'hôte, qui
	    reconstruirait toute la vue (et, sur la page « Générer », le composer). */
	function repaint(): void {
		if (currentContainer && currentSpec) render(currentContainer, currentSpec);
	}

	function render(container: HTMLElement, spec: QuizPageSpec): void {
		// La question en édition d'abord : un texte encore ouvert est validé
		// dans le brouillon AVANT que l'écriture en attente ne parte.
		demonterEdition();
		// Un glissement encore en vol vise des nœuds que container.replaceChildren() va
		// détruire : le terminer d'abord évite un timer orphelin qui écrirait
		// dans un DOM mort.
		if (slideHost) { finishSlide(slideHost); slideHost = null; }
		// Un menu portalé au <body> survivrait à la destruction de son ancre :
		// il resterait ouvert au-dessus d'une page qui n'existe plus.
		closeAllSelects();
		container.replaceChildren();
		// Les champs CodeMirror du formulaire qu'on vient de détacher gardent
		// sinon leurs écouteurs sur le document.
		libererChamps();
		currentContainer = container;
		currentSpec = spec;
		// Une ARRIVÉE sur la page : un autre quiz, ou le même rouvert par
		// l'utilisateur. Lue AVANT que la clé ne soit notée, consommée aussitôt.
		const arrivee = spec.key !== currentPath || !!spec.ouverture;
		spec.ouverture = false;
		// Une arrivée repart d'une fiche vierge : ni recherche, ni question
		// choisie laissées par la visite précédente du même quiz.
		if (arrivee) oublierFiche();
		if (spec.key !== currentPath) {
			// Le quiz précédent part MAINTENANT : sans ça, ouvrir un autre quiz
			// dans les 600 ms du débounce perdait la dernière frappe. `void` :
			// le rendu n'attend pas l'écriture, la chaîne la sérialise déjà.
			void flushSave();
			currentPath = spec.key;
			draft = null;
			activeIdx = 0;
			if (typeof spec.initialQuestion === "number") activeIdx = Math.max(0, Math.floor(spec.initialQuestion));
		} else if (draft && draftIsStale(draft)) {
			/* La note a changé DEHORS (éditeur markdown, synchro) pendant que la
			   page gardait son brouillon : on la relit, sinon la frappe suivante
			   réécrirait par-dessus. La modification externe gagne — mais on le
			   DIT, sinon des retouches en attente disparaîtraient sans un mot. */
			if (saveTimer) currentHost().ui.notice(t("dashboard.quiz.externalChange"));
			void flushSave();
			draft = null;
		}

		/* Toute arrivée montre la FICHE, y compris au redémarrage sur une
		   question notée par la reprise, et en rouvrant le quiz qu'on venait de
		   quitter sur un aperçu. Sans cette règle, l'état de la visite
		   précédente devenait l'écran d'ouverture : l'aperçu d'une question
		   remplaçait la fiche, qui semblait avoir disparu (Ahmed, 2026-09-23,
		   « je ne la vois plus »). L'édition demandée explicitement passe
		   après, juste en dessous. */
		if (arrivee) {
			welcome = true;
			editing = false;
		}

		/* Demande EXPLICITE d'ouvrir en édition (menu « Modifier », quiz qu'on
		   vient de créer). Elle se CONSOMME : la même spec est réutilisée telle
		   quelle à chaque repeint, et la relire faisait revenir le mode à la
		   seconde où l'on cliquait « Terminé ». L'hôte en fabrique une neuve à
		   chaque demande — c'est là que la prochaine viendra. */
		if (spec.startEditing) {
			spec.startEditing = false;
			editing = true;
		}
		const entering = !!spec.animateEntry;
		spec.animateEntry = false;

		const page = ajouter(container, "div", "qbd-qz");
		markViewEnter(page, entering, "qbd-qz-enter");
		entete = renderHeader(page, spec);

		const body = ajouter(page, "div", "qbd-qz-body");
		const listCol = ajouter(body, "div", "qbd-qz-list");
		// La navigation ‹ › vit SOUS le panneau, pas dedans (référence) : la
		// carte de question garde ainsi une surface pleine, sans réserver un
		// couloir en bas.
		const main = ajouter(body, "div", "qbd-qz-main");
		const panel = ajouter(main, "div", "qbd-qz-panel");
		const nav = ajouter(main, "div", "qbd-qz-nav");

		bindArrowKeys(page, listCol, panel, nav, spec);

		/* The search, in the header: it filters the fiche's grid as well as
		   the editor's list, and stays in place between the two. Only on a
		   catalogue quiz: the Generate page has no fiche. */
		surRecherche = null;
		if (spec.stats) renderRecherche(entete.center, spec.key, () => surRecherche?.());

		if (draft) {
			paint(listCol, panel, nav, spec);
			return;
		}

		ajouter(panel, "div", "qbd-qz-loading", t("dashboard.quiz.loading"));
		void spec.load().then(result => {
			// La page a pu être quittée (ou un autre quiz ouvert) pendant la
			// lecture du fichier : ne peindre que si le DOM est encore vivant.
			if (!panel.isConnected || spec.key !== currentPath) return;
			panel.replaceChildren();
			if (typeof result === "string") {
				// Clés énumérées, pas concaténées : t() est typé sur l'union des
				// clés du dictionnaire (une clé calculée ne compilerait pas, et
				// c'est précisément le garde-fou qui empêche les clés mortes).
				const msg = result === "fileNotFound" ? t("dashboard.detail.fileNotFound")
					: result === "noBlock" ? t("dashboard.detail.noBlock")
					: t("dashboard.detail.loadError");
				ajouter(panel, "div", "qbd-qz-error", msg);
				return;
			}
			draft = result;
			/* La pastille du bouton « Vocabulaire », posé avant que `draft`
			   n'existe (ci-dessus) : rafraîchie ICI plutôt qu'en repeignant tout
			   l'en-tête (`setActionBadge` retrouve le bouton par sa `key`, posée
			   par `renderEntete`). Sans `editing`, le bouton n'a pas été peint —
			   rien à mettre à jour. */
			if (editing) {
				const btn = page.querySelector<HTMLElement>('[data-qbd-key="glossary"]');
				if (btn) setActionBadge(btn, texteBadgeGlossaire(draft));
			}
			activeIdx = Math.min(activeIdx, Math.max(0, draft.questions.length - 1));
			paint(listCol, panel, nav, spec);
		});
	}

	/* ── The header, the same in every mode (detail-head.ts) ── */
	function renderHeader(page: HTMLElement, spec: QuizPageSpec): Entete {
		// Each action first writes what is pending: we leave the page, start
		// the quiz, insert the draft — the last keystroke must be in it.
		const avant = (fn: (el: HTMLElement) => void) => (el: HTMLElement): void => {
			void flushSave();
			fn(el);
		};
		const start = spec.start;
		const actions = (spec.actions || []).map(a => ({ label: a.label, icon: a.icon, onClick: avant(a.onClick) }));
		/* The editor's "Vocabulary" (task 4 of batch D). With a "⋮" menu, it is a
		   line of it (2026-09-29): the header then has the same buttons in both
		   modes, and nothing moves when the page switches. Without one (the
		   Generate page), a header button that fades in with the editor.
		   As soon as `editing` is true, NOT only once `draft` is loaded —
		   otherwise it is missing when arriving DIRECTLY in editing (the "Edit"
		   menu, creating a quiz): `renderHeader` runs before `spec.load()`.
		   `() => draft` reads the draft of the moment, on click; the button's
		   badge is refreshed once `draft` is ready (`render`). The editor has no
		   Practice / Exam switch any more: "Keep exam mode" in the "Set up your
		   test" modal writes the exam configuration of a note. */
		const menu = spec.menu;
		const editActions: EnteteAction[] = [];
		if (editing && !menu) {
			const gloss = glossaryHeaderAction(() => draft, scheduleSave);
			editActions.push({ ...gloss, onClick: avant(gloss.onClick) });
		}
		const lignesEdition = (): ActionMenuItem[] | undefined =>
			editing ? [glossaryMenuItem(() => draft, scheduleSave)] : undefined;
		const fiche = !!spec.stats && !!start;
		/* The info line, with the Learn | Practice selector of the course's
		   other modes: the SAME in the editor (2026-09-29). Without the
		   selector there, the row lost 8 px of height and everything on it
		   moved up at each switch; a segment opens the other mode's quiz, the
		   pending write first. */
		const autresModes = spec.autresModes?.filter(a => a.quiz.mode !== spec.stats?.mode)
			.map(a => ({ mode: a.quiz.mode, open: () => { void flushSave(); a.open(); } }));
		return renderEntete(page, {
			title: spec.title,
			// A catalogue quiz shows its FOLDER, not its path; the Generate
			// page keeps its usage line.
			kicker: spec.stats ? dossierDuQuiz(spec.stats.path) : spec.subtitle,
			editing,
			/* In editing, the arrow goes back to the quiz's FICHE, like "Done",
			   not out of the page: leaving the editor lands on the quiz, and the
			   fiche's own arrow then goes back to the folder. Without a fiche
			   (the Generate page), it leaves the page as before. */
			onBack: () => {
				void flushSave();
				if (editing && fiche) toggleEditing(page);
				else spec.onBack();
			},
			onToggleEditing: () => toggleEditing(page),
			actions,
			editActions,
			start: start ? { label: start.label, icon: start.icon, onClick: avant(start.onClick) } : undefined,
			enterStarts: showingWelcome(),
			menu: menu ? (anchor) => menu(anchor, lignesEdition()) : undefined,
			infos: spec.stats ? (p) => {
				renderInfosQuiz(p, spec.stats!, origineDe(spec.stats!), autresModes);
			} : undefined,
		});
	}

	/** Bascule consultation ⇄ édition AVEC transition : le corps s'estompe et
	    glisse légèrement, puis la page se repeint dans l'autre mode et entre.
	    Sans ce délai, la bascule est un saut sec — et c'est le bouton sur
	    lequel on revient le plus souvent. */
	function toggleEditing(page: HTMLElement): void {
		editing = !editing;
		/* L'édition ouvre sur une question ; en sortir ramène à la FICHE, qui
		   est la consultation du quiz — l'aperçu à deux colonnes, qu'on prenait
		   pour l'endroit où répondre, n'est plus un écran où l'on atterrit
		   (Ahmed, 2026-09-23). Sans fiche (page « Générer »), l'aperçu reste. */
		welcome = !editing;
		// « Terminé » : un texte encore ouvert dans le rendu rejoint le
		// brouillon avant que l'écriture ne parte.
		if (!editing) { demonterEdition(); void flushSave(); }

		const body = page.querySelector(".qbd-qz-body");
		if (!body || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
			repaint();
			return;
		}

		/* The ENTRY removed first: both classes each carry an
		   `animation … both`, and `--entering` is declared lower in the sheet —
		   with both present it wins, and the exit simply does not play. As
		   `--entering` stayed after its animation, the defect struck from the
		   SECOND switch on: a flash instead of the requested fade.
		   On the PAGE, not the body (2026-09-29): what fades is the body AND
		   the parts of the header only one mode has (`qbd-qz-swap`,
		   detail-head.ts); the title, the search, "Edit"/"Done" and "Start the
		   quiz" stay in place. */
		page.classList.remove("qbd-qz--entering");
		page.classList.add("qbd-qz--leaving");
		// La sortie est plus courte que l'entrée : la page repeinte doit
		// arriver, pas se faire attendre.
		const target = currentSpec;
		window.setTimeout(() => {
			// La page a pu être quittée pendant ces 130 ms : le conteneur est
			// PARTAGÉ par toutes les vues du dashboard, et repeindre ici
			// écraserait la destination avec l'ancien quiz.
			if (!page.isConnected || currentSpec !== target) return;
			repaint();
			const neuf = currentContainer?.querySelector(".qbd-qz-body");
			const nouvellePage = neuf?.parentElement;
			if (!neuf || !nouvellePage) return;
			nouvellePage.classList.add("qbd-qz--entering");
			/* Et retirée dès la fin : une classe d'état qui survit à son
			   animation finit toujours par croiser la suivante.
			   `e.target === neuf` : les événements d'animation BOUILLONNENT, et
			   le corps est plein d'enfants qui ont les leurs (la pulsation de
			   l'icône du bouton, l'entrée des cartes). Sans ce test, la première
			   animation d'un enfant retirait la classe et coupait le fondu. */
			const fini = (e: Event): void => {
				if (e.target !== neuf) return;
				nouvellePage.classList.remove("qbd-qz--entering");
				neuf.removeEventListener("animationend", fini);
			};
			neuf.addEventListener("animationend", fini);
		}, 130);
	}

	/** La date et l'heure d'une génération, dans la langue de l'APPLICATION et
	    non dans celle du système : « 20 sept. 2026, 12:57 ». Appelée au rendu,
	    comme `t()`, pour suivre un changement de langue.

	    `generatedAt` est une chaîne ISO écrite par `ecrireFrontmatterNeoQuiz`,
	    mais un frontmatter retouché à la main peut en porter une illisible :
	    elle est alors rendue TELLE QUELLE, plutôt qu'en « Invalid Date ». */
	function formatGeneratedAt(iso: string): string {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return iso;
		return formatDateHeure(d);
	}

	/** Stats du quiz, un enregistrement neutre s'il n'a jamais été joué. */
	function statOf(quiz: QuizIndexEntry): QuizStatRecord {
		const rec = ctx.statsStore ? ctx.statsStore.getRecord(quiz.path) : null;
		return rec || { bestScore: 0, questionsDone: 0, totalQuestions: quiz.questions, lastPlayed: 0, attempts: 0 };
	}

	/** Qui a généré le quiz, et quand — partagé par la ligne d'infos et la
	    fiche, qui l'écrivent chacune à sa façon. `null` pour une note écrite à
	    la main ou un quiz partagé sans frontmatter. */
	function origineDe(quiz: QuizIndexEntry): FicheOrigine | null {
		const g = quiz.generated;
		if (!g) return null;
		/* LE NOM LISIBLE DE LA SOURCE. Sur un site, `provider` et `model`
		   portent tous DEUX l'identifiant du canal (le modèle est celui du
		   site, inconnu d'ici — cf. l'écriture du frontmatter dans `ai.ts`) :
		   les afficher tels quels donnait « chatgpt-web » au-dessus de
		   « CHATGPT-WEB », l'identifiant technique deux fois (vu par Ahmed le
		   2026-09-20). Le canal, lui, connaît son nom d'affichage. Un CLI ou
		   Ollama montrent leur MODÈLE, qui est l'information utile, sous le nom
		   du menu des modèles : « Sonnet 5 », pas « claude-sonnet-5 », dont le
		   préfixe répétait le logo posé juste devant (Ahmed, 2026-09-23). Un
		   `provider` inconnu (réglage d'une version future) garde l'identifiant. */
		const canal = getCanal(g.provider);
		const web = !!canal && canal.type === "web";
		const source = web && canal ? canal.label : libelleModele(g.provider, g.model);
		return {
			source,
			/* La date et l'heure EXACTES : c'est le seul endroit de l'application
			   qui dise quand un quiz a été généré (demande d'Ahmed, 2026-09-20). */
			date: formatGeneratedAt(g.generatedAt),
			/* Le logo de l'ENTRÉE du fournisseur, pas de sa marque : un quiz généré
			   par Antigravity CLI porte l'Antigravity, pas l'étincelle Gemini. */
			logo: getProvider(g.provider).logo,
			/* L'infobulle garde l'identifiant EXACT du modèle, et l'effort d'un CLI,
			   qui n'a de sens que pour qui l'a réglé. */
			tooltip: g.effort
				? t("dashboard.detail.generatedBy", { model: web ? source : g.model, effort: g.effort })
				: t("dashboard.detail.generatedBySimple", { model: web ? source : g.model }),
		};
	}

	/** La FICHE du quiz (detail-fiche.ts) remplace tout le corps (liste +
	    panneau) et l'en-tête à l'ouverture. Rend vrai quand elle est peinte ;
	    faux dès qu'une question est ouverte, ou en édition. */
	function paintFiche(listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): boolean {
		const body = listCol.parentElement;
		const main = panel.parentElement;
		const page = body?.parentElement;
		if (!body || !main || !page || !draft) return false;
		body.querySelector(":scope > .qbd-fiche")?.remove();
		const quiz = spec.stats;
		const start = spec.start;
		const on = showingWelcome() && !!quiz && !!start;
		page.classList.toggle("qbd-qz--fiche", on);
		listCol.style.display = on ? "none" : "";
		main.style.display = on ? "none" : "";
		if (!on || !quiz || !start) return false;
		nav.replaceChildren();
		surRecherche = renderFiche(body, {
			quiz,
			questions: draft.questions,
			lecon: estLecon(),
			stat: statOf(quiz),
			origine: origineDe(quiz),
			onEditQuestion: (i) => { activeIdx = i; toggleEditing(page); },
			attirer: () => entete?.attirer(),
		});
		return true;
	}

	/** Vrai quand la page montre la fiche du quiz plutôt qu'une question.
	    Seulement pour un quiz du catalogue qu'on peut lancer, et jamais en
	    édition : l'éditeur ouvre toujours sur une question. */
	function showingWelcome(): boolean {
		return welcome && !editing && !!currentSpec?.stats && !!currentSpec.start;
	}

	/** Bandeau de l'aperçu : dit que la question n'est pas jouée ici, et
	    ramène à la fiche quand la page en a une. */
	function renderPreviewBanner(panel: HTMLElement, spec: QuizPageSpec, listCol: HTMLElement, nav: HTMLElement): void {
		const banner = ajouter(panel, "div", "qbd-qz-preview-banner");
		currentHost().ui.setIcon(ajouter(banner, "span", "qbd-qz-preview-icon"), "eye");
		ajouter(banner, "span", "qbd-qz-preview-text", t("dashboard.quiz.previewBanner"));
		if (!spec.stats || !spec.start) return;
		const back = ajouter(banner, "button", "qbd-qz-preview-back");
		back.type = "button";
		back.textContent = t("dashboard.quiz.previewBack");
		back.addEventListener("click", () => {
			welcome = true;
			paint(listCol, panel, nav, spec);
		});
	}

	/* ── Corps : liste des questions + question courante ── */
	function paint(listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		if (!draft) return;
		// Une reprise, une suppression ou un changement de rôle peut laisser
		// `activeIdx` sur une lecture absorbée : on montre la question qui l'affiche.
		activeIdx = hote(activeIdx);
		if (paintFiche(listCol, panel, nav, spec)) return;
		surRecherche = () => paintList(listCol, panel, nav, spec);
		paintList(listCol, panel, nav, spec);
		paintPanel(listCol, panel, nav, spec);
	}

	/** Change de question EN GLISSANT (carrousel du moteur), puis repeint la
	    liste et la navigation. `activeIdx` bouge ici et nulle part ailleurs :
	    la direction du glissement se déduit de l'écart. */
	function goToQuestion(target: number, listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		if (!draft) return;
		const clamped = hote(Math.max(0, Math.min(target, draft.questions.length - 1)));
		// Depuis la fiche : pas de glissement, la page change de nature
		// (fiche → aperçu), elle est repeinte.
		if (showingWelcome()) {
			welcome = false;
			activeIdx = clamped;
			spec.onQuestionChange?.(activeIdx);
			paint(listCol, panel, nav, spec);
			return;
		}
		if (!slideHost || clamped === activeIdx) return;
		const dir: 1 | -1 = clamped > activeIdx ? 1 : -1;
		// L'écart en questions VISIBLES : une lecture absorbée n'est pas un cran.
		const v = visibles();
		const hops = Math.max(1, Math.abs(v.indexOf(clamped) - v.indexOf(activeIdx)));
		activeIdx = clamped;
		spec.onQuestionChange?.(activeIdx);
		const q = draft.questions[activeIdx];
		slideTo(slideHost, (slide) => fillSlide(slide, q, activeIdx, listCol, panel, nav, spec), dir, hops);
		paintList(listCol, panel, nav, spec);
		paintNav(listCol, panel, nav, spec);
	}

	function paintList(listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		if (!draft) return;
		listCol.replaceChildren();

		const head = ajouter(listCol, "div", "qbd-qz-list-head");
		// Les lectures absorbées n'ont pas de carte : leur cours s'édite
		// au-dessus de chaque question de leur étape.
		const vis = visibles();
		ajouter(head, "span", "qbd-qz-list-title", t("dashboard.quiz.questionsTitle", { n: vis.filter(i => numeroDe(i) > 0).length }));
		/* Phone: while editing, the list is a bottom sheet over the page. */
		if (editing) mountListSheet(listCol, vis.length);

		const items = ajouter(listCol, "div", "qbd-qz-list-items");
		/* La liste s'efface en fondu à ses bords dès qu'il reste des questions
		   au-dessus ou au-dessous (2026-09-26) : une carte n'est plus coupée
		   net. Même mécanisme que les cartes de la grille. */
		suivreDebord(items);
		/* Filtered by the header's search, like the fiche's grid (a Generate
		   page has none: every question). A card keeps its number in the
		   quiz, not its rank in the results. */
		const trouvees = new Set(spec.stats ? questionsTrouvees(draft.questions, estLecon()) : vis);
		if (!vis.some(i => trouvees.has(i))) ajouter(items, "p", "qbd-fiche-empty", t("dashboard.fiche.searchEmpty"));
		vis.forEach((i, pos) => {
			if (!trouvees.has(i)) return;
			const q = draft!.questions[i];
			/* La carte de la GRILLE de la fiche (refonte de l'éditeur,
			   2026-09-26) : numéro en rond, une seule étiquette en texte simple
			   (icône + libellé du type, ou du rôle Lecture/Avec vos mots),
			   puis l'énoncé sur deux lignes. */
			const card = ajouter(items, "div", "qbd-qz-card" + (i === activeIdx && !showingWelcome() ? " is-active" : ""));
			// L'index du BROUILLON : la vignette se retrouve par lui, pas par
			// sa position dans la liste (qui saute les lectures absorbées).
			card.dataset.qi = String(i);
			// Numbered as on the fiche and in the quiz: a reading has none.
			const top = renderTop(card, q, numeroDe(i));
			top.classList.add("qbd-qz-card-top");
			const text = questionText(q);
			const label = ajouter(card, "span", "qbd-qz-card-text" + (text ? "" : " is-empty"), text || t("dashboard.quiz.promptEmpty"));
			// LaTeX $…$ de la vignette : rendu comme dans la liste de l'éditeur
			// (qui le faisait déjà). Sans ça, une question de maths s'y lisait
			// avec ses dollars bruts.
			if (text.includes("$")) void mathifyElement(label);
			card.addEventListener("click", () => goToQuestion(i, listCol, panel, nav, spec));

			if (!editing || !draft || i !== activeIdx) return;

			/* Sur une SECONDE ligne, et seulement dans la carte courante (tâche 5
			   de l'édition dans le rendu) : au bout de la ligne du numéro, même
			   invisibles, elles gardaient leur place et coupaient le nom du type
			   et le rôle ; posées en absolu, elles les recouvraient au survol.
			   Révélées au survol d'une autre carte, elles la feraient grandir
			   sous la souris. Déplacer une question : la choisir d'abord. */
			const acts = ajouter(card, "div", "qbd-qz-card-acts");

			// Réordonnancement : l'ordre des questions EST le déroulé du quiz.
			// Les flèches restent visibles (grisées) aux extrémités plutôt que
			// de disparaître — une rangée d'actions qui change de largeur d'une
			// carte à l'autre fait sautiller la liste.
			/* Échange avec la question VISIBLE voisine : une lecture absorbée
			   entre les deux ne bouge pas, et comme son étape tient à son champ
			   `slice` (pas à sa place dans le tableau), elle reste dans son
			   étape. */
			const move = (dir: -1 | 1, icon: string, aria: string): void => {
				const btn = ajouter(acts, "button", "qbd-qz-card-act");
				btn.type = "button";
				btn.setAttribute("aria-label", aria);
				currentHost().ui.setIcon(btn, icon);
				const target = voisine(i, dir);
				btn.disabled = target < 0;
				btn.addEventListener("click", (e) => {
					e.stopPropagation();
					if (!draft || btn.disabled) return;
					const qs = draft.questions;
					[qs[i], qs[target]] = [qs[target], qs[i]];
					renumberAuto(qs);
					if (activeIdx === i) activeIdx = target;
					else if (activeIdx === target) activeIdx = i;
					scheduleSave();
					paint(listCol, panel, nav, spec);
				});
			};
			move(-1, "chevron-up", t("dashboard.quiz.moveUp"));
			move(1, "chevron-down", t("dashboard.quiz.moveDown"));

			// Suppression : jamais la dernière (un bloc quiz-blocks vide ne se
			// relit pas).
			if (draft.questions.length > 1) {
				const del = ajouter(acts, "button", "qbd-qz-card-act qbd-qz-card-del");
				del.type = "button";
				del.setAttribute("aria-label", t("dashboard.quiz.deleteQuestion"));
				currentHost().ui.setIcon(del, "trash-2");
				del.addEventListener("click", (e) => {
					e.stopPropagation();
					if (!draft) return;
					const title = q.title || `Question ${pos + 1}`;
					// Confirmation, comme dans l'éditeur : la croix est révélée au
					// survol, l'écriture dans la note est immédiate, et rien ne
					// rattrape une question supprimée par erreur.
					openConfirmModal(
						t("editor.delete.title", { title }),
						t("editor.delete.message"),
						t("editor.action.delete"),
						t("editor.action.cancel"),
						(confirmed) => {
							if (!confirmed || !draft) return;
							draft.questions.splice(i, 1);
							// L'index actif suit la LISTE : supprimer une question
							// AVANT la courante la faisait sauter à la suivante.
							if (activeIdx > i) activeIdx--;
							else if (activeIdx === i) activeIdx = Math.min(i, draft.questions.length - 1);
							renumberAuto(draft.questions);
							scheduleSave();
							paint(listCol, panel, nav, spec);
						},
					);
				});
			}
		});

		/* « + Ajouter une question » EN BAS de la liste (refonte 2026-09-26) :
		   le « + » seul de l'en-tête de liste ne se remarquait pas. Même
		   action. Le TYPE se choisit à la création, comme dans l'éditeur : une
		   question ajoutée d'office en « choix unique » puis reconvertie
		   perdrait ses réponses au passage. */
		if (editing) {
			const add = ajouter(listCol, "button", "qbd-qz-list-add");
			add.type = "button";
			currentHost().ui.setIcon(ajouter(add, "span", "qbd-qz-list-add-icon"), "plus");
			ajouter(add, "span", undefined, t("dashboard.quiz.addQuestion"));
			add.addEventListener("click", () => {
				openTypePickerModal((key) => {
					if (!draft) return;
					const q = makeDefault(key);
					// « Question N » non traduit : motif du titre auto écrit dans
					// le .md et relu par l'éditeur (cf. editor/ui.ts).
					q.title = `Question ${visibles().length + 1}`;
					draft.questions.push(q);
					activeIdx = draft.questions.length - 1;
					// Le mode ÉDITION s'ouvre avec la question : on vient de la
					// créer vide, la relire n'apprendrait rien.
					editing = true;
					scheduleSave();
					repaint();
				});
			});
		}

		/* Plus de bloc « Mode du quiz » sous la liste (retiré le 2026-09-26) :
		   le mode d'un quiz se choisit à la génération, et un Learn et son
		   Practice sont deux notes distinctes. */
	}

	/** Met à jour le texte de la vignette de la question COURANTE — la seule
	    que l'édition peut changer. Les parcourir toutes à chaque frappe
	    réécrivait, et re-mathifiait, des libellés identiques. */
	function refreshListLabels(listCol: HTMLElement): void {
		if (!draft) return;
		const q = draft.questions[activeIdx];
		const el = listCol.querySelector<HTMLElement>(`.qbd-qz-card[data-qi="${activeIdx}"] .qbd-qz-card-text`);
		if (!q || !el) return;
		const text = questionText(q);
		// La classe est ajustée AVANT le retour anticipé : saisir exactement le
		// libellé de repli (« Question vide ») laissait sinon la vignette
		// marquée comme vide.
		el.classList.toggle("is-empty", !text);
		if (el.textContent === (text || t("dashboard.quiz.promptEmpty"))) return;
		el.textContent = text || t("dashboard.quiz.promptEmpty");
		if (text.includes("$")) void mathifyElement(el);
	}

	/** Contenu d'UNE slide : la question, en consultation ou en édition.
	    `index` est celui de la question rendue (pas forcément la courante :
	    la passe de mesure les rend toutes). */
	function fillSlide(slide: HTMLElement, q: DraftQuestion, index: number, listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		// Pas de bandeau « Question i / n » : le rendu réel affiche déjà le
		// TITRE de la question (h2 du moteur) — deux titres l'un sur l'autre.
		const content = ajouter(slide, "div", "qbd-qz-panel-body");
		// Le cours de l'étape (Learn), et le numéro AFFICHÉ pour le titre de
		// repli : « Question 2 » pour la question qui suit une lecture absorbée.
		// -1 pour une lecture de Learn, qui n'a pas de numéro : pas de
		// « Question N » de repli (detail-edition.ts, detail-question.ts).
		const lecture = lectureDe(index);
		const numero = numeroDe(index) - 1;
		if (editing) {
			/* La question s'édite dans son RENDU corrigé (detail-edition.ts).
			   Une seule question est montée à la fois : l'instance précédente
			   est démontée d'abord — sinon ses écouteurs et ses champs
			   CodeMirror survivraient à la slide qui s'en va. */
			demonterEdition();
			demonterEditionCourante = renderQuestionEditRendu(content, q, numero, {
				onChange: () => {
					scheduleSave();
					// Rafraîchir les LIBELLÉS, pas reconstruire la liste : à chaque
					// frappe on détruisait sinon les cartes sous le curseur de
					// l'utilisateur, pour n'en changer qu'une ligne de texte.
					refreshListLabels(listCol);
				},
				// Re-peindre le PANNEAU seul : re-rendre tout volerait le focus.
				onStructureChange: () => paintPanel(listCol, panel, nav, spec),
				// Le type ou le rôle : la carte de la liste les montre aussi.
				onListeChange: () => paint(listCol, panel, nav, spec),
				plusOuvert,
				setPlusOuvert: (v) => { plusOuvert = v; },
				estLecon: estLecon(),
				lecture,
			// Le chemin de la NOTE : une image collée doit atterrir là où le
			// réglage de l'utilisateur le dit, y compris dans ses modes
			// relatifs à la note. Absent pour un quiz encore en mémoire.
			}, draft?.file?.path);
		} else {
			renderQuestionView(content, q, numero, draft?.file?.path, lecture);
		}
	}

	/* ── Flèches ← / → : passer d'une question à l'autre ──
	   Écoute posée sur le DOCUMENT (une page sans focus ne reçoit aucune
	   touche), mais strictement gardée : seulement sur la page d'un quiz,
	   jamais quand la frappe va dans un champ (l'édition d'une réponse a
	   besoin de ses propres flèches), et jamais avec un modificateur (les
	   raccourcis d'Obsidian gardent la priorité). Le premier événement reçu
	   après la mort du DOM se détache tout seul : la page n'a pas de hook de
	   démontage à qui confier ce nettoyage. */
	function bindArrowKeys(page: HTMLElement, listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		if (keyCleanup) keyCleanup();
		const doc = page.ownerDocument;
		const onKey = (e: KeyboardEvent): void => {
			if (!page.isConnected) { detach(); return; }
			if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
			if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
			/* Déjà pris en charge plus bas dans la page : dans le rendu en
			   édition, les flèches déplacent un emplacement du classement
			   (edition-rendu-gestes.ts) — elles ne changent pas de question. */
			if (e.defaultPrevented) return;
			// Page HORS ÉCRAN (onglet en arrière-plan, autre vue du dashboard) :
			// son DOM existe encore et son écoute est toujours posée sur le
			// document. Sans ce garde, une flèche pressée ailleurs faisait aussi
			// naviguer les pages invisibles — trois hôtes, trois écoutes.
			if (!page.offsetParent && page.style.display !== "contents") return;
			// Kept behind a quiz being played (the shell is made inert under it):
			// the arrows belong to the quiz, never to this page.
			if (page.closest("[inert]")) return;
			/* Deux pages VISIBLES à la fois (vue partagée) avancent ensemble.
			   Le garde évident — n'accepter que le leaf `mod-active` — a été
			   essayé puis retiré : Obsidian ne pose cette classe qu'au leaf
			   FOCALISÉ, et regarder une page sans y avoir cliqué (on vient de
			   l'explorateur de fichiers) suffisait à ce que les flèches ne
			   répondent plus du tout. Casser le cas courant pour réparer le cas
			   rare n'en vaut pas la peine. */
			if (spec.isStale?.()) return;
			// `instanceof Element` et non un cast : la cible d'un keydown remonté
			// au document peut être le Document lui-même, qui n'a pas closest().
			const target = e.target;
			if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) return;
			/* Fiche : les flèches ne font rien. → ouvrait l'aperçu de la question
			   courante, le même écran qu'un clic sur une question, retiré pour la
			   même raison. */
			if (showingWelcome()) return;
			e.preventDefault();
			// La question VISIBLE voisine : une lecture absorbée n'est pas un cran.
			const cible = voisine(activeIdx, e.key === "ArrowRight" ? 1 : -1);
			if (cible >= 0) goToQuestion(cible, listCol, panel, nav, spec);
		};
		const detach = (): void => {
			doc.removeEventListener("keydown", onKey);
			if (keyCleanup === detach) keyCleanup = null;
		};
		doc.addEventListener("keydown", onKey);
		keyCleanup = detach;
	}

	/** Place réellement disponible pour la question, chevrons compris : la
	    réserve ne doit jamais les pousser hors de l'écran. */
	function availableHeight(panel: HTMLElement): number {
		const main = panel.parentElement;
		if (!main) return 0;
		// 40px de flèches + 4px de tranche + 10px de gouttière + 8px de padding du panneau.
		return Math.max(0, main.clientHeight - 62);
	}

	function paintPanel(listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		if (!draft) return;
		// Un glissement en vol tient un timer et un listener `transitionend` sur
		// une piste que `panel.replaceChildren()` va détacher : le conclure d'abord, sinon
		// ils survivent jusqu'à leur échéance en visant un DOM mort.
		if (slideHost) finishSlide(slideHost);
		demonterEdition();
		panel.replaceChildren();
		libererChamps();
		slideHost = null;
		// En édition, le panneau devient la CARTE du formulaire (verre) : posé
		// à même une photo de fond, un formulaire ne se lisait pas.
		panel.classList.toggle("is-editing", editing);
		// La fiche occupe le corps : `paint` l'a déjà peinte à la place du panneau.
		if (showingWelcome()) return;
		const q = draft.questions[activeIdx];
		if (!q) {
			ajouter(panel, "div", "qbd-qz-error", t("dashboard.detail.noBlock"));
			return;
		}

		if (!editing) renderPreviewBanner(panel, spec, listCol, nav);
		// Le panneau est une piste de carrousel : le changement de question y
		// glisse comme dans le quiz (detail-slide.ts).
		slideHost = mountSlideHost(panel);
		/* En consultation, l'aperçu est INERTE : ses champs de réponse se
		   lisaient comme un quiz en cours, on y tapait, et rien ne comptait. */
		slideHost.viewport.inert = !editing;
		setSlide(slideHost, (slide) => fillSlide(slide, q, activeIdx, listCol, panel, nav, spec));
		paintNav(listCol, panel, nav, spec);

		/* Les chevrons se posent à la hauteur de la question la PLUS HAUTE du
		   quiz, une fois pour toutes : ils ne bougent plus d'une question à
		   l'autre. Mesuré ici (pas à chaque navigation).

		   En ÉDITION, non : la mesure rendrait le FORMULAIRE COMPLET de chaque
		   question du quiz — trente formulaires pour en afficher un. Et la
		   réserve n'y sert à rien, le panneau ayant son propre ascenseur. */
		if (editing) return;
		const questions = draft.questions;
		reserveTallest(
			slideHost,
			visibles().map(i => (slide: HTMLElement) => fillSlide(slide, questions[i], i, listCol, panel, nav, spec)),
			availableHeight(panel),
		);
	}

	/** Navigation ‹ › — les flèches bleues 3D du quiz (`.quiz-question-nav
	    .quiz-nav-btn`, action-buttons.css : face bleue, tranche, enfoncement
	    au clic, grise et à plat quand désactivée), sans texte de position :
	    « Question 14 sur 20 » comptait les lectures, la liste dit 11
	    (2026-09-29). Refonte de l'éditeur, 2026-09-26 : les deux ronds
	    fantômes gris d'avant ne se lisaient pas comme des flèches. Repeinte seule à chaque
	    glissement, pour que l'état désactivé suive sans reconstruire la
	    question. */
	function paintNav(listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		nav.replaceChildren();
		// Position et bouts comptés sur les questions VISIBLES (sans les
		// lectures absorbées), comme la liste et les onglets du quiz.
		const vis = visibles();
		if (!draft || vis.length <= 1) return;
		nav.classList.add("quiz-question-nav");
		const pos = vis.indexOf(activeIdx);

		const prev = ajouter(nav, "button", "quiz-nav-btn");
		prev.type = "button";
		prev.setAttribute("aria-label", t("dashboard.quiz.prev"));
		currentHost().ui.setIcon(prev, "chevron-left");
		prev.disabled = pos <= 0;
		prev.addEventListener("click", () => {
			const cible = voisine(activeIdx, -1);
			if (cible >= 0) goToQuestion(cible, listCol, panel, nav, spec);
		});

		const next = ajouter(nav, "button", "quiz-nav-btn");
		next.type = "button";
		next.setAttribute("aria-label", t("dashboard.quiz.next"));
		currentHost().ui.setIcon(next, "chevron-right");
		next.disabled = pos < 0 || pos >= vis.length - 1;
		next.addEventListener("click", () => {
			const cible = voisine(activeIdx, 1);
			if (cible >= 0) goToQuestion(cible, listCol, panel, nav, spec);
		});
	}

	/** Writes what is pending NOW (leaving the page, starting the quiz,
	    opening another quiz). Aims at the draft FROZEN when it was typed,
	    never the one on display at this instant.

	    Returns THE CHAIN, not only the write just started: a write the timer
	    sent a moment earlier is still in flight, and a window closing on
	    "nothing pending" would have cut it in the middle. The chain never
	    rejects (`runSave`). */
	function flushSave(): Promise<void> {
		if (saveTimer && pendingSave) {
			window.clearTimeout(saveTimer);
			saveTimer = null;
			const { draft: pending, save } = pendingSave;
			pendingSave = null;
			// Même alerte que le chemin débouncé : une écriture ratée au moment où
			// l'on QUITTE la page est précisément celle qu'il faut signaler.
			runSave(pending, save);
		}
		return saveChain;
	}

	/** Les titres AUTOMATIQUES suivent l'ordre de la liste ; ceux que l'auteur
	    a écrits ne bougent jamais (même règle que l'éditeur). Appelé après
	    tout déplacement ET toute suppression — sans quoi supprimer « Question
	    2 » laissait « Question 1, Question 3… » dans la note. */
	function renumberAuto(questions: DraftQuestion[]): void {
		// Le numéro AFFICHÉ, qui saute les lectures absorbées (elles n'en ont
		// pas, et gardent leur titre).
		const numeros = numerosAffiches(questions, estLecon());
		questions.forEach((qq, idx) => {
			if (!numeros[idx]) return;
			if (!qq._userModifiedTitle && /^Question \d+$/.test(qq.title || "")) qq.title = `Question ${numeros[idx]}`;
		});
	}


	function dispose(): Promise<void> {
		// Un texte encore ouvert dans le rendu rejoint le brouillon, et
		// l'écriture qu'il planifie part avec le reste juste en dessous.
		demonterEdition();
		// L'écriture est CAPTURÉE avant que l'état ne soit remis à zéro : le
		// brouillon en attente est figé dans `pendingSave`, pas relu ici.
		const ecrit = flushSave();
		// Un menu portalé au <body> n'est pas dans le conteneur de la page : sans
		// ça il resterait affiché par-dessus Obsidian, écoutes comprises.
		closeAllSelects();
		if (keyCleanup) keyCleanup();
		if (slideHost) { finishSlide(slideHost); slideHost = null; }
		// Les champs du formulaire : la page n'est pas forcément déjà retirée
		// du document, d'où la racine passée en plus des champs détachés.
		libererChamps(currentContainer);
		draft = null;
		currentSpec = null;
		currentContainer = null;
		currentPath = null;
		return ecrit;
	}

	return { render, flush: flushSave, dispose };
}
