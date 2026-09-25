import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { markViewEnter } from "./view-enter";
import { t, currentLang, hourOptions } from "../i18n";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import { quizFrere } from "./course-pairs";
import type { QuizStatRecord, StatsStore } from "./stats-store";
import { quizModeLabel, quizTypeLabel } from "./quiz-card";
import { getCanal, getProvider, setBrandLogo, libelleModele } from "./ai-providers";
import { openTypePickerModal, openConfirmModal } from "../editor/modals";
import { closeAllSelects } from "./ui-select";
import { mathifyElement } from "../engine/mathjax";
import { loadQuizDraft, saveQuizDraft, questionText, draftIsStale } from "./detail-io";
import type { QuizDraft, QuizLoadError } from "./detail-io";
import { renderQuestionView, renderQuestionEdit } from "./detail-question";
import { renderExamPanel } from "./detail-exam";
import { oublierFiche, renderFiche } from "./detail-fiche";
import type { FicheOrigine } from "./detail-fiche";
import { mountSlideHost, setSlide, slideTo, reserveTallest, finish as finishSlide } from "./detail-slide";
import type { SlideHost } from "./detail-slide";
import { makeDefault } from "../editor/utils";
import type { DraftQuestion } from "../editor/utils";

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
	/** Ligne sous le titre (chemin de la note). Vide → ligne masquée. */
	subtitle: string;
	/** Compte ANNONCÉ, le temps du chargement (badge du header). */
	questionCount: number;
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
	/** L'AUTRE mode du même cours (course-pairs.ts) : la fiche montre alors un
	    sélecteur Learn | Practice qui ouvre ce quiz. */
	autreMode?: { quiz: QuizIndexEntry; open(): void };
	/** Le menu « ⋮ » de la fiche : celui de la carte du quiz (hôte). */
	menu?(anchor: HTMLElement): void;
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

	return {
		render(container: HTMLElement, quiz: QuizIndexEntry, host: DetailHostSpec): void {
			page.render(container, {
				key: quiz.path,
				title: quiz.title,
				subtitle: quiz.path,
				questionCount: quiz.questions,
				stats: quiz,
				load: () => loadQuizDraft(quiz.path),
				save: (draft) => saveQuizDraft(draft),
				onBack: host.onBack,
				start: {
					label: t("dashboard.detail.play"),
					icon: "play",
					// `ctx.openQuiz` et non un appel direct : c'est L'HÔTE qui
					// décide ce que « jouer » veut dire. Sous Obsidian il vaut
					// exactement l'ancien appel (`src/dashboard.ts:205`) ; dans
					// la fenêtre il monte la page du moteur. Le fichier qui
					// portait cet appel est parti dans `apps/obsidian/` : il ne
					// parlait que d'onglets.
					onClick: () => ctx.openQuiz(quiz),
				},
				isStale: host.isStale,
				startEditing: host.startEditing,
				animateEntry: host.animateEntry,
				initialQuestion: host.initialQuestion,
				onQuestionChange: host.onQuestionChange,
				ouverture: host.ouverture,
				autreMode: (() => {
					if (ctx.settings.quizzesGroupModes === false) return undefined;
					const frere = quizFrere(quiz, ctx.scanner.getQuizzes());
					return frere ? { quiz: frere, open: () => ctx.navigate("detail", { quiz: frere }) } : undefined;
				})(),
				/* Le menu de la carte, avec un repeint qui relit le quiz : renommé,
				   la page le reprend ; supprimé ou déplacé hors du catalogue, on
				   revient en arrière. */
				menu: ctx.openCardMenu ? (anchor) => ctx.openCardMenu!(quiz, anchor, () => {
					const frais = ctx.scanner.getQuiz(quiz.path);
					if (frais) ctx.navigate("detail", { quiz: frais });
					else host.onBack();
				}) : undefined,
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
	/** Badge du header : le compte ANNONCÉ (spec) devient le compte RÉEL dès
	    que le brouillon est lu — un onglet qui ne connaît pas son quiz à
	    l'avance affichait « 0 » jusqu'au premier repaint. */
	let countEl: HTMLElement | null = null;
	/** Détache l'écoute clavier de la page précédente. */
	let keyCleanup: (() => void) | null = null;

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
		// Un glissement encore en vol vise des nœuds que container.replaceChildren() va
		// détruire : le terminer d'abord évite un timer orphelin qui écrirait
		// dans un DOM mort.
		if (slideHost) { finishSlide(slideHost); slideHost = null; }
		// Un menu portalé au <body> survivrait à la destruction de son ancre :
		// il resterait ouvert au-dessus d'une page qui n'existe plus.
		closeAllSelects();
		container.replaceChildren();
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
		renderHeader(page, spec);

		const body = ajouter(page, "div", "qbd-qz-body");
		const listCol = ajouter(body, "div", "qbd-qz-list");
		// La navigation ‹ › vit SOUS le panneau, pas dedans (référence) : la
		// carte de question garde ainsi une surface pleine, sans réserver un
		// couloir en bas.
		const main = ajouter(body, "div", "qbd-qz-main");
		const panel = ajouter(main, "div", "qbd-qz-panel");
		const nav = ajouter(main, "div", "qbd-qz-nav");

		bindArrowKeys(page, listCol, panel, nav, spec);

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
			activeIdx = Math.min(activeIdx, Math.max(0, draft.questions.length - 1));
			if (countEl) countEl.textContent = String(draft.questions.length);
			paint(listCol, panel, nav, spec);
		});
	}

	/* ── Header : fil d'Ariane, nom + chemin, Editor / Start ── */
	function renderHeader(page: HTMLElement, spec: QuizPageSpec): void {
		const header = ajouter(page, "div", "qbd-qz-header");

		// Flèche SUR LA LIGNE du titre, à sa gauche (capture StudySmarter
		// 2026-07-21) — pas au-dessus. Mêmes classes que le retour du
		// drill-down : un seul bouton retour dans tout le dashboard.
		const back = ajouter(header, "button", "qbd-quizzes-crumb-back qbd-qz-back");
		back.type = "button";
		back.setAttribute("aria-label", t("dashboard.quiz.back"));
		// Flèche dessinée en CSS (masque), comme tout bouton retour du dashboard.
		ajouter(back, "span", "qbd-quizzes-crumb-icon");
		back.addEventListener("click", () => {
			void flushSave();
			spec.onBack();
		});

		const info = ajouter(header, "div", "qbd-qz-headline");
		const titleRow = ajouter(info, "div", "qbd-qz-title-row");
		ajouter(titleRow, "h2", "qbd-qz-title", spec.title);
		const count = draft ? draft.questions.length : spec.questionCount;
		countEl = ajouter(titleRow, "span", "qbd-qz-count", String(count));
		if (spec.subtitle) ajouter(info, "p", "qbd-qz-path", spec.subtitle);
		renderMeta(info, spec);

		const actions = ajouter(header, "div", "qbd-qz-actions");

		// Modifier ↔ Terminé : la MÊME page bascule (référence : « Éditeur »
		// n'ouvre pas un autre écran, il change le contenu de la carte).
		const edit = ajouter(actions, "button", "qbd-btn qbd-btn--ghost qbd-qz-edit-btn" + (editing ? " is-on" : ""));
		currentHost().ui.setIcon(ajouter(edit, "span", "qbd-btn-icon"), editing ? "check" : "square-pen");
		// « Editor » (et non « Edit ») : le bouton ouvre un MODE, il ne
		// déclenche pas une action — demande d'Ahmed 2026-07-21.
		ajouter(edit, "span", undefined, t(editing ? "dashboard.quiz.editDone" : "dashboard.quiz.editor"));
		edit.addEventListener("click", () => toggleEditing(page));

		for (const action of spec.actions || []) {
			const btn = ajouter(actions, "button", "qbd-btn qbd-btn--ghost");
			currentHost().ui.setIcon(ajouter(btn, "span", "qbd-btn-icon"), action.icon);
			ajouter(btn, "span", undefined, action.label);
			btn.addEventListener("click", () => {
				void flushSave();
				action.onClick(btn);
			});
		}

		// Pilule INVERSÉE (blanche sur thème sombre) : le même bouton que
		// « Nouveau dossier » — demande d'Ahmed « mets Start en blanc comme
		// nos autres boutons ». Jamais l'accent bleu.
		const startSpec = spec.start;
		if (startSpec) {
			const start = ajouter(actions, "button", "qbd-btn--create qbd-qz-start");
			currentHost().ui.setIcon(ajouter(start, "span", "qbd-btn-icon"), startSpec.icon);
			ajouter(start, "span", undefined, startSpec.label);
			start.addEventListener("click", () => {
				void flushSave();
				startSpec.onClick(start);
			});
		}
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
		if (!editing) void flushSave();

		const body = page.querySelector(".qbd-qz-body");
		if (!body || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
			repaint();
			return;
		}

		/* L'ENTRÉE d'abord retirée : les deux classes portent chacune un
		   `animation … both`, et `--entering` est déclarée plus bas dans la
		   feuille — présente toutes les deux, c'est elle qui gagne, et la
		   sortie ne joue tout simplement pas. Comme `--entering` reste posée
		   après son animation, le défaut frappait dès la DEUXIÈME bascule :
		   Ahmed voyait un clignotement au lieu du fondu qu'il a demandé. */
		body.classList.remove("qbd-qz-body--entering");
		body.classList.add("qbd-qz-body--leaving");
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
			if (!neuf) return;
			neuf.classList.add("qbd-qz-body--entering");
			/* Et retirée dès la fin : une classe d'état qui survit à son
			   animation finit toujours par croiser la suivante.
			   `e.target === neuf` : les événements d'animation BOUILLONNENT, et
			   le corps est plein d'enfants qui ont les leurs (la pulsation de
			   l'icône du bouton, l'entrée des cartes). Sans ce test, la première
			   animation d'un enfant retirait la classe et coupait le fondu. */
			const fini = (e: Event): void => {
				if (e.target !== neuf) return;
				neuf.classList.remove("qbd-qz-body--entering");
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
		/* L'heure suit le RÉGLAGE (24 h par défaut), pas la langue : l'anglais
		   écrivait « 06:35 PM » (`hourOptions`, src/i18n.ts). */
		return d.toLocaleString(currentLang() === "fr" ? "fr-FR" : "en-US", {
			day: "numeric", month: "short", year: "numeric", minute: "2-digit", ...hourOptions(),
		});
	}

	/** Stats du quiz, un enregistrement neutre s'il n'a jamais été joué. */
	function statOf(quiz: QuizIndexEntry): QuizStatRecord {
		const rec = ctx.statsStore ? ctx.statsStore.getRecord(quiz.path) : null;
		return rec || { bestScore: 0, questionsDone: 0, totalQuestions: quiz.questions, lastPlayed: 0, attempts: 0 };
	}

	/* ── Ligne d'infos sous le titre ──
	   Elle remplace la rangée de tuiles d'avant : des tuiles pour des
	   métadonnées se lisaient comme des boutons, et se confondaient avec les
	   tuiles des questions — les seules qu'on clique (Ahmed, 2026-09-23).
	   Absente pour un quiz qui n'existe pas encore (résultat d'une
	   génération) : ni score, ni tentative, ni date. */
	function renderMeta(parent: HTMLElement, spec: QuizPageSpec): void {
		const quiz = spec.stats;
		if (!quiz) return;
		const stat = statOf(quiz);
		const line = ajouter(parent, "div", "qbd-qz-meta");
		const item = (text: string, title?: string): HTMLElement => {
			const el = ajouter(line, "span", "qbd-qz-meta-item");
			ajouter(el, "span", undefined, text);
			if (title) el.title = title;
			return el;
		};

		item(t(quiz.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: quiz.questions }));
		item(quizTypeLabel(quiz.quizType));
		item(quizModeLabel(quiz.mode));

		// Qui a généré ce quiz, et QUAND — absente pour une note écrite à la
		// main ou pour un quiz partagé sans frontmatter.
		const o = origineDe(quiz);
		if (o) {
			const el = item(t("dashboard.detail.metaGenerated", { model: o.source, date: o.date }), o.tooltip);
			const logo = ajouter(el, "span", "qbd-provider-logo qbd-qz-meta-logo qbd-provider-logo--" + o.logo);
			el.prepend(logo);
			setBrandLogo(logo, o.logo);
		}

		// Jamais joué : ni meilleur score, ni date, ni tentatives — rien que
		// des tirets à montrer (demande d'Ahmed 2026-07-21).
		if (stat.attempts > 0) {
			const best = item(t("dashboard.detail.metaBest", { score: stat.bestScore }));
			if (stat.bestScore >= 80) best.classList.add("is-good");
			else if (stat.bestScore >= 60) best.classList.add("is-fair");
			if (ctx.statsStore) item(t("dashboard.detail.metaLast", { when: ctx.statsStore.formatRelativeTime(stat.lastPlayed) }));
			item(t(stat.attempts === 1 ? "dashboard.detail.metaAttemptsOne" : "dashboard.detail.metaAttemptsOther", { count: stat.attempts }));
		}
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
		renderFiche(body, {
			quiz,
			questions: draft.questions,
			stat: statOf(quiz),
			origine: origineDe(quiz),
			onStart: (el) => { void flushSave(); start.onClick(el); },
			onEdit: () => toggleEditing(page),
			onBack: () => { void flushSave(); spec.onBack(); },
			autreMode: spec.autreMode ? { mode: spec.autreMode.quiz.mode, open: () => { void flushSave(); spec.autreMode!.open(); } } : undefined,
			menu: spec.menu,
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
		if (paintFiche(listCol, panel, nav, spec)) return;
		paintList(listCol, panel, nav, spec);
		paintPanel(listCol, panel, nav, spec);
	}

	/** Change de question EN GLISSANT (carrousel du moteur), puis repeint la
	    liste et la navigation. `activeIdx` bouge ici et nulle part ailleurs :
	    la direction du glissement se déduit de l'écart. */
	function goToQuestion(target: number, listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		if (!draft) return;
		const clamped = Math.max(0, Math.min(target, draft.questions.length - 1));
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
		const hops = Math.abs(clamped - activeIdx);
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
		ajouter(head, "span", "qbd-qz-list-title", t("dashboard.quiz.questionsTitle", { n: draft.questions.length }));
		if (editing) {
			const add = ajouter(head, "button", "qbd-qz-list-add");
			add.type = "button";
			add.setAttribute("aria-label", t("dashboard.quiz.addQuestion"));
			currentHost().ui.setIcon(add, "plus");
			// Le TYPE se choisit à la création, comme dans l'éditeur : une
			// question ajoutée d'office en « choix unique » puis reconvertie
			// perdrait ses réponses au passage.
			add.addEventListener("click", () => {
				openTypePickerModal((key) => {
					if (!draft) return;
					const q = makeDefault(key);
					// « Question N » non traduit : motif du titre auto écrit dans
					// le .md et relu par l'éditeur (cf. editor/ui.ts).
					q.title = `Question ${draft.questions.length + 1}`;
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

		const items = ajouter(listCol, "div", "qbd-qz-list-items");
		draft.questions.forEach((q, i) => {
			const card = ajouter(items, "div", "qbd-qz-card" + (i === activeIdx && !showingWelcome() ? " is-active" : ""));
			const num = ajouter(card, "span", "qbd-qz-card-num", String(i + 1));
			num.setAttribute("aria-hidden", "true");
			const text = questionText(q);
			const label = ajouter(card, "span", "qbd-qz-card-text" + (text ? "" : " is-empty"), text || t("dashboard.quiz.promptEmpty"));
			// LaTeX $…$ de la vignette : rendu comme dans la liste de l'éditeur
			// (qui le faisait déjà). Sans ça, une question de maths s'y lisait
			// avec ses dollars bruts.
			if (text.includes("$")) void mathifyElement(label);
			card.addEventListener("click", () => goToQuestion(i, listCol, panel, nav, spec));

			if (!editing || !draft) return;

			const acts = ajouter(card, "div", "qbd-qz-card-acts");

			// Réordonnancement : l'ordre des questions EST le déroulé du quiz.
			// Les flèches restent visibles (grisées) aux extrémités plutôt que
			// de disparaître — une rangée d'actions qui change de largeur d'une
			// carte à l'autre fait sautiller la liste.
			const move = (dir: -1 | 1, icon: string, aria: string): void => {
				const btn = ajouter(acts, "button", "qbd-qz-card-act");
				btn.type = "button";
				btn.setAttribute("aria-label", aria);
				currentHost().ui.setIcon(btn, icon);
				const target = i + dir;
				btn.disabled = target < 0 || target >= draft!.questions.length;
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
					const title = q.title || `Question ${i + 1}`;
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

		// ── Mode du quiz (édition seulement) ──
		if (!editing) return;
		renderExamPanel(listCol, {
			get: () => draft?.examOptions ?? null,
			set: (value) => { if (draft) draft.examOptions = value; },
			onChange: () => scheduleSave(),
			onStructureChange: () => paintList(listCol, panel, nav, spec),
		});
	}

	/** Met à jour le texte de la vignette de la question COURANTE — la seule
	    que l'édition peut changer. Les parcourir toutes à chaque frappe
	    réécrivait, et re-mathifiait, des libellés identiques. */
	function refreshListLabels(listCol: HTMLElement): void {
		if (!draft) return;
		const q = draft.questions[activeIdx];
		const el = listCol.querySelectorAll<HTMLElement>(".qbd-qz-card-text")[activeIdx];
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
		if (editing) {
			renderQuestionEdit(content, q, {
				onChange: () => {
					scheduleSave();
					// Rafraîchir les LIBELLÉS, pas reconstruire la liste : à chaque
					// frappe on détruisait sinon les cartes (et le bloc « Mode du
					// quiz », son sélecteur compris) sous le curseur de
					// l'utilisateur, pour n'en changer qu'une ligne de texte.
					refreshListLabels(listCol);
				},
				// Re-peindre le PANNEAU seul : la liste vient d'être refaite par
				// onChange, et re-rendre tout volerait le focus de la frappe.
				onStructureChange: () => paintPanel(listCol, panel, nav, spec),
			// Le chemin de la NOTE : une image collée doit atterrir là où le
			// réglage de l'utilisateur le dit, y compris dans ses modes
			// relatifs à la note. Absent pour un quiz encore en mémoire.
			}, draft?.file?.path);
		} else {
			renderQuestionView(content, q, index, draft?.file?.path);
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
			// Page HORS ÉCRAN (onglet en arrière-plan, autre vue du dashboard) :
			// son DOM existe encore et son écoute est toujours posée sur le
			// document. Sans ce garde, une flèche pressée ailleurs faisait aussi
			// naviguer les pages invisibles — trois hôtes, trois écoutes.
			if (!page.offsetParent && page.style.display !== "contents") return;
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
			goToQuestion(activeIdx + (e.key === "ArrowRight" ? 1 : -1), listCol, panel, nav, spec);
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
		// 40px de chevrons + 10px de gouttière + 8px de padding du panneau.
		return Math.max(0, main.clientHeight - 58);
	}

	function paintPanel(listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		if (!draft) return;
		// Un glissement en vol tient un timer et un listener `transitionend` sur
		// une piste que `panel.replaceChildren()` va détacher : le conclure d'abord, sinon
		// ils survivent jusqu'à leur échéance en visant un DOM mort.
		if (slideHost) finishSlide(slideHost);
		panel.replaceChildren();
		slideHost = null;
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
			questions.map((qq, i) => (slide: HTMLElement) => fillSlide(slide, qq, i, listCol, panel, nav, spec)),
			availableHeight(panel),
		);
	}

	/** Navigation ‹ › — deux cercles nus, comme StudySmarter : aucun compteur
	    entre eux (la position se lit dans la liste de gauche). Repeinte seule
	    à chaque glissement, pour que l'état désactivé suive sans reconstruire
	    la question. */
	function paintNav(listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		nav.replaceChildren();
		if (!draft || draft.questions.length <= 1) return;

		const prev = ajouter(nav, "button", "qbd-qz-nav-btn");
		prev.type = "button";
		prev.setAttribute("aria-label", t("dashboard.quiz.prev"));
		currentHost().ui.setIcon(prev, "chevron-left");
		prev.disabled = activeIdx === 0;
		prev.addEventListener("click", () => goToQuestion(activeIdx - 1, listCol, panel, nav, spec));

		const next = ajouter(nav, "button", "qbd-qz-nav-btn");
		next.type = "button";
		next.setAttribute("aria-label", t("dashboard.quiz.next"));
		currentHost().ui.setIcon(next, "chevron-right");
		next.disabled = activeIdx >= draft.questions.length - 1;
		next.addEventListener("click", () => goToQuestion(activeIdx + 1, listCol, panel, nav, spec));
	}

	/** Écrit MAINTENANT ce qui est en attente (sortie de page, lancement,
	    ouverture d'un autre quiz). Vise le brouillon FIGÉ au moment de la
	    frappe, jamais celui affiché à cet instant.

	    Rend LA CHAÎNE, pas seulement l'écriture qu'on vient de lancer : une
	    écriture partie par la minuterie un instant plus tôt est encore en vol,
	    et une fenêtre qui se ferme sur « rien en attente » l'aurait coupée en
	    plein milieu. La chaîne ne rejette jamais (`runSave`). */
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
		questions.forEach((qq, idx) => {
			if (!qq._userModifiedTitle && /^Question \d+$/.test(qq.title || "")) qq.title = `Question ${idx + 1}`;
		});
	}


	function dispose(): Promise<void> {
		// L'écriture est CAPTURÉE avant que l'état ne soit remis à zéro : le
		// brouillon en attente est figé dans `pendingSave`, pas relu ici.
		const ecrit = flushSave();
		// Un menu portalé au <body> n'est pas dans le conteneur de la page : sans
		// ça il resterait affiché par-dessus Obsidian, écoutes comprises.
		closeAllSelects();
		if (keyCleanup) keyCleanup();
		if (slideHost) { finishSlide(slideHost); slideHost = null; }
		draft = null;
		currentSpec = null;
		currentContainer = null;
		currentPath = null;
		countEl = null;
		return ecrit;
	}

	return { render, flush: flushSave, dispose };
}
