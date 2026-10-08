import "../../../src/assets/css/index.css";
import "./theme/host-vars.css";
import "./assets/toast.css";
import "./assets/zoom.css";
import "./assets/shell.css";
import "./assets/perles.css";
import "./assets/quiz-bars.css";
import "./assets/modal.css";
import "./assets/moodle-modal.css";
import "./assets/math.css";
import { setLanguage, setHourCycle, t } from "../../../src/i18n";
import { chargerLangue } from "./ui/langue";
import { chargerFormatHeure } from "./ui/format-heure";
import { LOG_PREFIX } from "../../../src/branding";
import { createScanner } from "../../../src/dashboard/scanner";
import type { QuizIndexEntry, Scanner } from "../../../src/dashboard/scanner";
import { currentHost, installHost, requireHost } from "../../../src/host/current";
import type { HostModalHandle } from "../../../src/host/types";
import { deviceId } from "./host/device";
import { createWindowsHost, createWindowsIndex, creerCarteRacines } from "./host";
import type { CarteRacines, MiroirDisque } from "./host";
import type { RacineOuverte } from "./host";
import { pont } from "./host/pont";
import { lireFichierRecu } from "./ui/fichier-recu";
import { estVaultObsidian, relireExamens, savedFolders } from "./host/folder";
import type { ReviewStore } from "../../../src/review/review-store";
import type { StatsStore } from "../../../src/dashboard/stats-store";
import { creerJournalApp } from "./review/store";
import { loadSharedState, sharedState } from "./host/shared-state";
import { createChatFiles } from "./host/chat-files";
import { publishGenerations } from "../../../src/dashboard/generations-publisher";
import { onQueueCreated } from "../../../src/dashboard/file-generation-app";
import { MAX_TAKEN, createRemoteRunner } from "../../../src/dashboard/remote-runner";
import type { TakenLogEntry } from "../../../src/dashboard/remote-runner";
import { addFailedRequest } from "../../../src/dashboard/chat-requests";
import { getChats, setChats } from "../../../src/dashboard/chat-store";
import { absoluteInRoot } from "../../../src/shared-state/chat-merge";
import { notifyPc } from "./host/notify";
import { ecrireReglage, lireReglage } from "./host/folder";
import { startChatSync } from "../../../src/dashboard/chat-sync";
import { creerStatsApp } from "./review/stats";
import { creerSessionsApp } from "./review/sessions";
import type { SessionsApp } from "./review/sessions";
import { createRenameDetector } from "../../../src/review/rename-match";
import { adopterOverrides, chargerReglagesPages, overridesPartages, monterDashboard, reprendre } from "./ui/dashboard-shell";
import { chargerReprise } from "./ui/reprise";
import { aiSettingsDefaults } from "../../../src/dashboard/ai-settings-host";
import type { AiSettingsHost } from "../../../src/dashboard/ai-settings-host";
import type { AiSettings } from "../../../src/types/dashboard-ctx";
import { CLE_REGLAGES_IA } from "../electron/pont";
import { openQuizPage } from "./ui/quiz-page";
import type { DashboardHandle } from "./ui/dashboard-shell";
import { jouerTransition } from "./ui/transition-quiz";
import { demander, etatInitial, finir, retourVersGardee, vuesARetirer } from "./ui/transition-etat";
import type { SensEcran } from "./ui/transition-etat";
import { renderSettings, viserAjoutAppareil, viserPromptExpliquer } from "./ui/settings";
import { amorcerCacheComptes } from "./ui/comptes";
import { monterBarreTitre } from "./ui/barre-titre";
import { estMobile } from "./host/platform";
import { installRipple } from "./ui/ripple";
import { installBarreNative } from "./ui/barre-native";
import { installOverscrollStretch } from "./ui/overscroll-stretch";
import { installCodeFit } from "./ui/code-fit";
import { installStatusStrip } from "./ui/status-strip";
import { installKeyboardState } from "./ui/clavier";
import { retourAndroid } from "./ui/retour-android";
import { armerCalendrier } from "./ui/calendrier-android";
import { appliquerEffetsFond, appliquerFond, choisirFond, fondSuivant } from "./ui/fond";

/*
 * Démarrage de l'application.
 *
 * L'ordre des imports CSS compte : `host-vars.css` définit les variables
 * qu'Obsidian fournissait, il doit donc venir APRÈS l'arbre partagé pour que
 * ses valeurs gagnent à égalité de spécificité. Les feuilles propres à
 * l'application viennent ensuite, et c'est le SEUL endroit qui les importe :
 * ni `src/host/ui.ts` (toasts) ni `src/host/modal.ts` (modales) ne doivent
 * importer de CSS, sans quoi le harnais de `npm run check:windows-host` ne
 * peut plus les charger (les fontes MathLive n'y ont pas de chargeur).
 */
/**
 * Le démontage de l'écran actuellement affiché, ou `null` si rien n'est monté.
 *
 * UNE seule variable, au niveau du module : chaque montage appelle d'abord
 * celui du précédent. Sans ça, chaque aller-retour vers un quiz empilerait un
 * abonnement au scanner de plus, et une modification de note redessinerait la
 * liste autant de fois qu'elle a été ouverte. C'est le pendant du
 * `destroyQuiz()` du greffon.
 *
 * Il peut rendre une PROMESSE (la coquille du tableau de bord, dont la page
 * d'un quiz tient peut-être une écriture en attente) : le démontage lui-même
 * est synchrone, seule l'écriture est à attendre. Un changement d'écran ne
 * l'attend pas (`demonter()`, `void`) ; la fermeture de la fenêtre, si
 * (`onCloseRequested`, plus bas).
 */
/** Ce que `mount`/`ouvrirQuiz` posent pour l'écran affiché : de quoi le
    démonter, et — pour la coquille du tableau de bord seulement — de quoi la
    REPEINDRE (`DashboardHandle.repaint`), utilisé par la pile de feuilles
    ci-dessous. `repaint` est absent pour l'écran d'un quiz : il n'a rien à
    repeindre depuis l'extérieur. */
interface EcranActif {
	demonter: () => void | Promise<void>;
	repaint?: () => void;
}
let demonterCourant: EcranActif | null = null;

/* La carte des racines du démarrage, retenue pour la SEULE chose que le
   contrat d'hôte ne peut pas rendre : traduire un chemin ABSOLU du disque en
   chemin du contrat. `HostPaths` ne porte jamais de chemin absolu, et c'est
   voulu — mais le sélecteur natif, lui, n'en rend que. Une seconde
   implémentation de la règle « la plus longue racine gagne » (`depuisAbsolu`)
   divergerait en silence : on passe la carte, on ne la recopie pas. */
let carteCourante: CarteRacines | null = null;

/* Le MIROIR de l'index, retenu pour la SEULE chose qu'il reste à faire après
   `demarrer()` : lancer sa surveillance (voir `demarrer()` et `.finally()`
   plus bas — `createWindowsIndex`, `host/fs.ts`, n'hydrate plus qu'elle ne
   surveille). `null` tant que `demarrer()` n'a pas atteint cette ligne, ou
   si elle a échoué avant ; dans les deux cas, rien à démarrer. */
let miroirCourant: MiroirDisque | null = null;

/* ═══ LES RÉGLAGES IA — l'`AiSettingsHost` de l'application ═══

   La page « Générer » (`src/dashboard/ai.ts`) et le client de génération
   lisent leurs réglages par ce seul objet, sous les deux hôtes. Ici : un cache
   en mémoire, hydraté UNE FOIS au démarrage (`chargerReglagesIa`) sur la clé
   `CLE_REGLAGES_IA` de `neo.reglages` — la MÊME clé que le principal relit
   pour admettre l'hôte d'Ollama (`electron/main.ts`), d'où l'import depuis
   `pont.ts` plutôt qu'un littéral « ai » recopié. Les défauts sont ceux du
   greffon (`aiSettingsDefaults`, une seule liste pour les deux hôtes).

   `save` FUSIONNE dans le cache PUIS écrit l'objet entier : le principal GARDE
   cette clé (`garderReglagesIa`, `canaux.ts`) et peut REFUSER l'écriture (URL
   illisible, hôte refusé par l'utilisateur). Le refus rejette ici, et le cache
   est alors REMIS à ce qu'il était : sans ça, la page afficherait un réglage
   que le disque n'a pas — et qu'un redémarrage ferait disparaître sans un mot.
   `get` rend l'objet lui-même, jamais une copie : le client lit le fournisseur
   au moment où la génération part. */
let reglagesIaCache: AiSettings = aiSettingsDefaults();

async function chargerReglagesIa(): Promise<void> {
	const lu = await pont().reglages.lire(CLE_REGLAGES_IA);
	const persiste = lu && typeof lu === "object" && !Array.isArray(lu) ? (lu as Partial<AiSettings>) : {};
	/* L'ancien DÉFAUT d'« Ajouter des fichiers » (Ctrl+E, 2026-09-17) a été
	   écrit sur le disque avec le reste des réglages au premier `save` : aucun
	   écran ne le règle, ce n'est donc jamais un choix. Il suit le nouveau
	   défaut (Ctrl+U, celui de claude.ai, 2026-09-26). HYPOTHÈSE FRAGILE : le
	   jour où un écran permet de CHOISIR ce raccourci, un Ctrl+E voulu serait
	   pris pour l'ancien défaut — retirer alors cette migration. */
	const hk = persiste.hotkeyAddFiles;
	if (hk && hk.key === "e" && (hk.modifiers || []).join("+") === "Mod") delete persiste.hotkeyAddFiles;
	reglagesIaCache = { ...aiSettingsDefaults(), ...persiste };
}

const reglagesIa: AiSettingsHost = {
	get: () => reglagesIaCache,
	save: async (patch) => {
		const avant: AiSettings = { ...reglagesIaCache };
		Object.assign(reglagesIaCache, patch);
		try {
			await pont().reglages.ecrire(CLE_REGLAGES_IA, reglagesIaCache);
		} catch (e) {
			reglagesIaCache = avant;
			currentHost().ui.notice(t("app.aiSettings.refused", { error: e instanceof Error ? e.message : String(e) }));
			throw e;
		}
	},
};

/**
 * LA VUE GARDÉE (2026-09-27, « pile de feuilles », référence StudySmarter).
 *
 * Lancer un quiz depuis le tableau de bord ne DÉMONTE plus sa coquille :
 * elle reste montée derrière, `inert`, figée en pile par la classe statique
 * `nq-pile-fond` (`shell.css`, posée par `ui/transition-quiz.ts`). Au
 * retour, elle est REPEINTE (`DashboardHandle.repaint`) puis ramenée au
 * premier plan par l'animation inverse — jamais reconstruite : défilement,
 * onglet et dossiers dépliés survivent.
 *
 * UNE SEULE vue gardée à la fois : `ouvrirQuiz` ne peut en poser une nouvelle
 * que depuis la coquille (la seule à exposer `repaint`), qui n'ouvre jamais
 * un second quiz par-dessus le premier — il n'y a donc jamais de pile de
 * deux. `null` hors quiz, et aussi quand l'écran affiché au lancement n'était
 * pas la coquille seule (`.qbd-layout`) : dans ce cas, l'ancien
 * comportement s'applique, sans guarde.
 */
let vueGardee: { layout: HTMLElement; ecran: EcranActif; declencheur: HTMLElement | null } | null = null;

/** Démonte l'écran courant ET la vue gardée s'il y en a une, et rend ce qu'il
    reste à attendre (l'écriture en attente de la page d'un quiz), ou rien.
    `demonterCourant`/`vueGardee` sont remis à `null` AVANT de rendre : un
    second appel pendant l'attente ne démonte pas deux fois. Les DEUX sont
    démontés ici (fermeture de l'app pendant un quiz : la coquille gardée
    dessous doit, elle aussi, couper ses écouteurs et vider ses tampons). */
function demonter(): Promise<void> | void {
	const g = vueGardee;
	vueGardee = null;
	const d = demonterCourant;
	demonterCourant = null;
	const attentes = [g?.ecran.demonter(), d?.demonter()].filter((p): p is Promise<void> => p instanceof Promise);
	if (attentes.length > 0) return Promise.all(attentes).then(() => undefined);
}

/**
 * L'état des changements d'écran (lancer un quiz, en revenir), de la
 * demande jusqu'à la fin de sa transition (`ui/transition-quiz.ts`). Les
 * règles vivent dans le noyau pur `ui/transition-etat.ts` (`npm run
 * check:transition`) : pendant une transition, une demande du même sens est
 * un double clic, IGNORÉ ; une demande du sens contraire (retour cliqué
 * pendant que le quiz monte) est MISE EN FILE et part à la fin. La demande
 * porte de quoi se rejouer : l'appel lui-même.
 * Posé AVANT la lecture de la note, qui est asynchrone : c'est là que le
 * second clic arrivait.
 */
let etatEcran = etatInitial<() => void>();

/** Soumet une demande de changement d'écran ; vrai si elle part MAINTENANT. */
function soumettre(sens: SensEcran, rejouer: () => void): boolean {
	const r = demander(etatEcran, { sens, donnee: rejouer });
	etatEcran = r.etat;
	return r.action === "lancer";
}

/** Fin d'une transition : repos, puis la demande en file, s'il y en a une. */
function transitionFinie(): void {
	const r = finir(etatEcran);
	etatEcran = r.etat;
	r.suivante?.donnee();
}

/** Les écrans affichés dans la racine, qui vont céder la place au suivant. */
function ecransDe(root: HTMLElement): HTMLElement[] {
	return Array.from(root.children).filter((e): e is HTMLElement => e instanceof HTMLElement);
}

/* `document.createElement`, jamais les extensions DOM d'Obsidian (`createEl`,
   `createDiv`, `empty`) : elles n'existent pas dans la fenêtre de l'app.
   Au démarrage, la racine est vide : pas de transition. Au RETOUR d'un quiz,
   l'écran du quiz (déjà démonté) reste affiché et redescend pendant que la
   coquille revient derrière lui ; `jouerTransition` le retire à la fin. */
export function mount(root: HTMLElement, scanner: Scanner, store: ReviewStore, stats: StatsStore, sessions: SessionsApp): void {
	const sortants = ecransDe(root);
	// Au démarrage (racine vide), pas de transition, donc rien à soumettre.
	if (sortants.length > 0 && !soumettre("retour", () => mount(root, scanner, store, stats, sessions))) return;

	/* RETOUR VERS UNE VUE GARDÉE : elle n'est ni détruite ni reconstruite,
	   seulement repeinte puis ramenée au premier plan. Une vue gardée dont le
	   nœud n'est plus parmi les écrans affichés serait un résidu (ne devrait
	   pas arriver) : démontée par précaution plutôt que fuir. */
	if (vueGardee && !sortants.includes(vueGardee.layout)) {
		void vueGardee.ecran.demonter();
		vueGardee = null;
	}
	if (vueGardee) {
		const gardee = vueGardee;
		vueGardee = null;
		/* LE QUIZ SORTANT (l'ancien `demonterCourant`, posé par `ouvrirQuiz` sur
		   le retour d'`openQuizPage`) DOIT être démonté ici : c'est lui qui tient
		   l'instance du moteur (`__quizDestroy`) et les deux écouteurs souris de
		   `quiz-page.ts`. Sans cet appel, la branche « vue gardée » — le chemin
		   NORMAL de retour depuis la pile de feuilles — les laissait vivre pour
		   toujours (constat critique de la revue du 2026-09-27). `void` : un
		   changement d'écran n'attend jamais ce démontage (même règle que
		   `demonter()` ci-dessus), et `openQuizPage` le rend idempotent (`fait`)
		   au cas où un autre chemin (fermeture de l'app) l'aurait déjà appelé. */
		const { aDemonter, nouveauCourant } = retourVersGardee(demonterCourant, gardee.ecran);
		void aDemonter?.demonter();
		demonterCourant = nouveauCourant;
		gardee.layout.classList.remove("nq-pile-fond");
		gardee.layout.removeAttribute("aria-hidden");
		gardee.layout.inert = false;
		/* Repeinte AVANT l'animation inverse : le score, l'avancement et les
		   stats ont pu changer pendant le quiz — voir `DashboardHandle.repaint`.
		   `entering` y vaut faux (vue inchangée depuis la dernière peinture) :
		   pas de rejeu de l'entrée CSS par-dessus le retour animé (constat n°1
		   de `transition-review.md`). */
		gardee.ecran.repaint?.();
		/* LE FOCUS : à l'élément qui avait lancé le quiz, s'il vit encore dans
		   la vue gardée (une carte peut avoir disparu — quiz renommé/déplacé
		   pendant qu'on le jouait) ; sinon, au conteneur principal de la vue.
		   `preventScroll` : ni l'un ni l'autre ne doit faire défiler la page,
		   déjà à la bonne position (elle n'a jamais bougé). */
		const cible = gardee.declencheur && gardee.layout.contains(gardee.declencheur) ? gardee.declencheur : gardee.layout;
		/* Le `tabindex` du conteneur ne vit que le temps de RECEVOIR ce focus :
		   laissé en place, chaque clic dans le vide de la page refocalisait la
		   coquille entière, et la première touche (Shift suffit) y faisait
		   dessiner l'anneau `:focus-visible` autour de toute la fenêtre. */
		if (cible === gardee.layout && cible.tabIndex < 0) {
			cible.tabIndex = -1;
			cible.addEventListener("blur", () => cible.removeAttribute("tabindex"), { once: true });
		}
		void jouerTransition(root, sortants, gardee.layout, "sortie").finally(() => {
			cible.focus({ preventScroll: true });
			transitionFinie();
		});
		return;
	}

	void demonter();
	// Empilés AVANT le montage : la coquille se met en page à sa vraie place.
	if (sortants.length > 0) root.classList.add("nq-empile");
	const coquille: DashboardHandle = monterDashboard(root, {
		scanner,
		statsStore: stats,
		reviewStore: store,
		aiSettings: reglagesIa,
		cheminDuContrat: (absolu) => carteCourante?.depuisAbsolu(absolu) ?? null,
		cheminAbsolu: (contrat) => carteCourante?.absolu(contrat) ?? null,
		onOpenQuiz: (entry) => { void ouvrirQuiz(root, scanner, store, stats, sessions, entry); },
		onOpenSettings: (onClosed) => ouvrirReglages(onClosed),
		sessions,
	});
	demonterCourant = coquille;
	const entrant = root.lastElementChild;
	if (sortants.length === 0) return;
	if (!(entrant instanceof HTMLElement)) {
		for (const s of sortants) s.remove();
		root.classList.remove("nq-empile");
		transitionFinie();
		return;
	}
	void jouerTransition(root, sortants, entrant, "sortie").finally(transitionFinie);
}

/** La modale des réglages, quand elle est ouverte. Une SEULE à la fois : le
    bouton de la barre de titre reste cliquable pendant qu'elle est là, et deux
    panneaux empilés liraient les mêmes réglages sans jamais se voir l'un
    l'autre. */
let reglagesOuverts: HostModalHandle | null = null;

/**
 * Les « Réglages » : une MODALE centrée par-dessus l'écran courant, depuis
 * qu'elle a cessé d'être un écran à part entière.
 *
 * POURQUOI CE N'EST PLUS UN ÉCRAN. La page remplaçait le tableau de bord :
 * l'ouvrir le DÉTRUISAIT, et la fermer le reconstruisait depuis zéro
 * (`mount()`), page et défilement perdus — pour un écran dont on ne fait que
 * cocher une case. La modale, elle, laisse l'écran courant monté dessous : il
 * n'y a plus rien à reconstruire au retour.
 *
 * ELLE NE PASSE DONC PAS PAR `demonterCourant` : cette variable désigne
 * l'ÉCRAN, et l'écrire ici ferait démonter la modale à la place du tableau de
 * bord au prochain changement d'écran — le tableau de bord resterait dans le
 * DOM, ses écouteurs vivants, sous le suivant. Le démontage de la page se fait
 * dans `onClose`, que l'hôte appelle APRÈS la disparition.
 */
function ouvrirReglages(onClosed?: () => void): void {
	if (reglagesOuverts) return;
	let demonterReglages: (() => void) | null = null;
	reglagesOuverts = requireHost("modals").open({
		className: "nq-reglages-modal",
		title: t("review.settings.title"),
		onOpen: poignee => {
			demonterReglages = renderSettings(poignee.contentEl, {
				/* RECHARGER : ajouter ou retirer un dossier change les racines de
				   l'hôte, et l'hôte est installé une seule fois. Un remontage à
				   chaud laisserait vivre l'index et le surveillant de l'ancienne
				   liste. */
				onFoldersChanged: () => location.reload(),
				/* RECHARGER aussi : toutes les heures déjà écrites (la page sous
				   la modale, la section des comptes) repassent par `hourOptions`,
				   et la reprise rouvre la même page. */
				onTimeFormatChanged: () => location.reload(),
				/* Le MÊME hôte que la page « Générer » : la section « Canaux
				   payants » écrit à travers lui, le cache du client suit. */
				aiSettings: reglagesIa,
			});
		},
		onClose: () => {
			reglagesOuverts = null;
			demonterReglages?.();
			onClosed?.();
		},
	});
}

/**
 * PLAY a quiz (the engine): mount the engine's page over the shell; on return,
 * tear the engine down and bring the shell forward again, on the view the quiz
 * was launched from (the open folder, Home, the quiz's page…) — see
 * `vueGardee`, the shell is kept, not rebuilt. ALWAYS through
 * `demonterCourant`, called BEFORE each screen change. A quiz's page
 * (viewing, editing), for its part, is NOT a `main.ts` screen: it is a view of
 * the shell.
 *
 * L'affectation de `demonterCourant` se fait APRÈS l'`await` — `openQuizPage`
 * lit le fichier avant de rendre — mais le démontage de la liste, lui, a lieu
 * AVANT : entre les deux, `demonterCourant` vaut `null`, et un second clic ne
 * démonterait rien deux fois. `soumettre` l'ignore même tout à fait,
 * jusqu'à la fin de la transition.
 *
 * LA TRANSITION (2026-09-27, `ui/transition-quiz.ts`) : la coquille RESTE
 * affichée, inerte, pendant la lecture de la note et les 500 ms où l'écran
 * du quiz monte par-dessus elle ; il est invisible tant qu'il charge
 * (`nq-chargement`, `shell.css`).
 *
 * LA PILE DE FEUILLES (même date) : quand l'écran affiché est la coquille
 * SEULE (`.qbd-layout`, celle qui expose `repaint`), elle n'est PAS démontée
 * ici — elle est GARDÉE (`vueGardee`), figée en pile derrière le quiz plutôt
 * que détruite puis reconstruite au retour. Depuis un AUTRE écran (aucun
 * aujourd'hui, mais un futur écran non-coquille), l'ancien comportement
 * s'applique : démontage complet, pas de pile.
 */
async function ouvrirQuiz(root: HTMLElement, scanner: Scanner, store: ReviewStore, stats: StatsStore, sessions: SessionsApp, entry: QuizIndexEntry): Promise<void> {
	if (!soumettre("ouvrir", () => { void ouvrirQuiz(root, scanner, store, stats, sessions, entry); })) return;
	const sortants = ecransDe(root);
	/* `aria-hidden` posé EN MÊME TEMPS que `inert`, jamais des centaines de
	   millisecondes plus tard (`retirer()`, `transition-quiz.ts`) : sinon la
	   vue sortante est inerte au clavier sans l'être encore pour un lecteur
	   d'écran pendant toute l'animation. */
	for (const s of sortants) { s.inert = true; s.setAttribute("aria-hidden", "true"); }
	/* L'ÉLÉMENT QUI A LANCÉ LE QUIZ (la carte, le bouton « Commencer ») : gardé
	   pour lui rendre le focus au retour plutôt que de le laisser retomber sur
	   `<body>`. `null` s'il n'y en a pas (ouverture au clavier depuis un
	   endroit qui n'a jamais pris le focus, ou hors DOM après coup). */
	const declencheur = document.activeElement instanceof HTMLElement ? document.activeElement : null;

	/* Une seule coquille GARDABLE : l'écran affiché est ELLE SEULE, et son
	   `EcranActif` expose `repaint` (c'est ce qui la distingue de l'écran d'un
	   quiz, qui n'en a pas). Sinon, comportement d'avant : démontage complet. */
	const garder: HTMLElement[] = [];
	if (sortants.length === 1 && sortants[0].classList.contains("qbd-layout") && demonterCourant?.repaint) {
		vueGardee = { layout: sortants[0], ecran: demonterCourant, declencheur };
		demonterCourant = null;
		garder.push(sortants[0]);
	} else {
		void demonter();
	}
	root.classList.add("nq-empile", "nq-chargement");
	/* Le démontage rendu par `openQuizPage` appelle `__quizDestroy` : sans lui,
	   chaque aller-retour laisserait vivre une instance de moteur complète
	   (écouteurs document/window, ResizeObserver, timers). C'est le pendant
	   exact de l'`onunload` du MarkdownRenderChild côté greffon.
	   `store` ET `stats` PASSÉS TELS QUELS comme puits : `ReviewStore` et
	   `StatsStore` portent déjà exactement la FORME que `openQuizPage`
	   attend — les envelopper dans un objet littéral n'ajouterait rien. */
	try {
		const page = await openQuizPage(root, entry, () => {
			mount(root, scanner, store, stats, sessions);
		}, store, stats, sessions, estMobile() ? undefined : reglagesIa, () => { viserPromptExpliquer(); ouvrirReglages(); });
		/* A LAUNCH CANCELLED in the "Set up your test" modal (2026-09-29): the
		   page was never shown (its screen is out of `root` and was invisible
		   while loading), so nothing plays. The kept dashboard, exactly as it
		   was, becomes the current screen again — the reverse of the stacking
		   done above — with no transition, instead of a page that rises and
		   goes straight back down. */
		if (page.launchCancelled) {
			const gardee = vueGardee;
			if (gardee) {
				const { aDemonter, nouveauCourant } = retourVersGardee<EcranActif>({ demonter: page.teardown }, gardee.ecran);
				void aDemonter?.demonter();
				demonterCourant = nouveauCourant;
				vueGardee = null;
				for (const s of sortants) { s.inert = false; s.removeAttribute("aria-hidden"); }
				if (gardee.declencheur?.isConnected) gardee.declencheur.focus({ preventScroll: true });
			} else {
				// No dashboard was kept (a screen that is not the shell): the
				// ordinary way back, queued until this launch is over.
				page.teardown();
				mount(root, scanner, store, stats, sessions);
			}
			return;
		}
		demonterCourant = { demonter: page.teardown };
		root.classList.remove("nq-chargement");
		const entrant = root.lastElementChild;
		if (entrant instanceof HTMLElement && !sortants.includes(entrant)) {
			await jouerTransition(root, sortants, entrant, "entree", garder);
		}
	} finally {
		/* Sur TOUTES les issues, un rejet imprévu compris : aucune coquille
		   fantôme ne reste sous le quiz (sauf la vue GARDÉE, volontairement
		   laissée), l'écran du quiz (la vue UTILE) n'est jamais retiré, et le
		   verrou se rouvre — puis un retour demandé pendant la montée part.
		   Après une transition jouée, ces lignes ne trouvent plus rien à
		   retirer. */
		const courant = root.lastElementChild;
		const proteges = [courant, vueGardee?.layout].filter((v): v is HTMLElement => v instanceof HTMLElement);
		for (const s of vuesARetirer(sortants, proteges)) s.remove();
		root.classList.remove("nq-chargement");
		// La grille reste tant qu'une vue est gardée dessous.
		if (!vueGardee) root.classList.remove("nq-empile");
		transitionFinie();
	}
}

async function demarrer(): Promise<void> {
	const root = document.getElementById("neo-quiz-root");
	if (!root) throw new Error("#neo-quiz-root introuvable");
	/* Le réglage `language` : « auto » (la langue de l'hôte, sinon celle du
	   navigateur), ou la langue choisie — dans la page Réglages, ou par le
	   bootstrapper d'installation d'après la page du site d'où l'exe a été
	   téléchargé. Lu AVANT le premier `t()`. */
	setLanguage(await chargerLangue());
	// Le format de l'heure, lu avec la langue : 24 h tant que rien d'autre n'est choisi.
	setHourCycle(await chargerFormatHeure());
	document.title = t("app.window.title");
	/* Montée UNE FOIS, avant le premier écran : elle survit à tous les
	   changements d'écran qui suivent (coquille, réglages), qui eux se
	   démontent et se remontent par `demonterCourant`. */
	/* On a phone or tablet there is no window to drag, minimise or close, and
	   no application menu to open: no title bar, and `--nq-barre-ecran: 0px`
	   (shell.css, `.nq-mobile`) gives its 45 px back to the page. The class
	   `is-mobile` (the one Obsidian sets, which the shared CSS already styles)
	   follows the PHONE width only: a tablet keeps the desktop layout. */
	if (estMobile()) {
		document.documentElement.classList.add("nq-mobile");
		installRipple();
		installOverscrollStretch();
		installCodeFit();
		installStatusStrip();
		installKeyboardState();
		installBarreNative((window as unknown as { neoPlatform: Parameters<typeof installBarreNative>[0] }).neoPlatform);
		(window as unknown as { neoPlatform: { surRetour(g: () => boolean): void } }).neoPlatform.surRetour(retourAndroid);
		const etroit = window.matchMedia("(max-width: 600px)");
		const suivre = (): void => { document.body.classList.toggle("is-mobile", etroit.matches); };
		suivre();
		etroit.addEventListener("change", suivre);
	} else monterBarreTitre(document.body, {
		/* DIRECTEMENT la fonction : elle ne ferme plus sur l'écran courant
		   depuis que les Réglages sont une modale posée par-dessus lui. La
		   barre de titre est montée une seule fois, avant le premier écran —
		   c'est ce qui imposait l'indirection par une variable réaffectée à
		   chaque montage. */
		ouvrirReglages,
		fondSuivant: () => { void fondSuivant(); },
		choisirFond: () => { void choisirFond(); },
	});
	/* Le dossier du fond est DÉJÀ admis au périmètre par le principal
	   (`perimetreInitial`, avant l'ouverture de la fenêtre) : le rendu n'a
	   qu'à poser l'image, sans attendre les dossiers de quiz ci-dessous. */
	await appliquerFond();
	// Luminosité et flou de l'image : lus en même temps que l'image elle-même.
	await appliquerEffetsFond();
	try {
		/* No Obsidian vault is opened by itself any more (2026-10-04): Neo Quiz
		   reads ONE folder, the synced one (`savedFolders`). */
		const dossiers = await savedFolders();
		/* `dossiers` contient TOUJOURS au moins le dossier par défaut
		   (tranche 9) : `savedFolders()` le pose devant à chaque lecture. Il
		   n'y a donc plus d'écran « aucun dossier » à monter ici. */
		/* Les dossiers persistés sont DÉJÀ au périmètre du processus principal,
		   qui a lu la clé `folders` avant d'ouvrir la fenêtre — il n'y a plus
		   rien à « ouvrir » d'ici. Reste la détection de vault, qui décide où
		   vont les résultats de CE dossier : dans un vault, à l'endroit où le
		   greffon les écrit déjà, pour que les deux hôtes n'aient pas chacun
		   leur moitié. Un dossier disparu (clé USB retirée, dossier supprimé)
		   ne doit pas empêcher les autres de s'ouvrir — d'où le `catch` par
		   dossier plutôt qu'un `Promise.all` qui rejetterait en bloc. */
		const ouvertes: RacineOuverte[] = [];
		for (const d of dossiers) {
			try {
				ouvertes.push({ ...d, vault: await estVaultObsidian(d.path) });
			} catch (e) {
				console.warn(LOG_PREFIX, "dossier inaccessible, ignoré:", d.path, e);
			}
		}
		/* Plus d'écran de repli ici (`mountSansDossier` a disparu, tranche 9) :
		   le dossier par défaut est créé par le principal AVANT l'ouverture de
		   la fenêtre, `estVaultObsidian` ne jette jamais (elle rend `false`
		   sur une erreur — voir son propre `catch`), donc `ouvertes` ne peut
		   être vide qu'un instant entre la suppression du disque du dossier
		   par défaut et son prochain démarrage, un cas qu'aucun écran ne
		   protège mieux qu'une coquille simplement vide. */
		const idAppareil = await deviceId();
		const carte = creerCarteRacines(ouvertes, idAppareil);
		carteCourante = carte;
		const index = await createWindowsIndex(carte);
		/* Retenue pour `.finally()` plus bas, qui démarre la surveillance
		   APRÈS le signal `fenetre.prete()` — voir l'en-tête d'`host/fs.ts`
		   pour pourquoi ce n'est plus `createWindowsIndex` qui le fait. */
		miroirCourant = index;
		installHost(createWindowsHost(carte, index));
		/* Le scanner PARTAGÉ, sur l'hôte Windows : c'est lui qui décide ce
		   qu'est un quiz, sous Obsidian comme ici. `init()` branche le
		   surveillant PUIS scanne, dans cet ordre — l'inverse manquerait les
		   fichiers modifiés pendant le premier balayage. */
		const scanner = createScanner(currentHost());
		await scanner.init();
		/* Exams and attempts live per device in each root's `.neo-quiz/`
		   (`host/shared-state.ts`); the one-time migration of the old settings
		   runs inside, before anything reads them. Loaded before the shell is
		   mounted so the first review plan already sees the exam horizon. */
		await loadSharedState(ouvertes.map(r => r.id), idAppareil);
		/* Chats and generation progress live in the synced folder, one file per
		   device (`host/chat-files.ts`); the store moves onto them here, before the
		   Generate page can be shown. A failure leaves the window-storage chats
		   working (the store only switches once `attachChatBackend` ran). */
		let chatSync: Awaited<ReturnType<typeof startChatSync>> | null = null;
		const racineChats = currentHost().paths.defaultRoot();
		const chatFiles = createChatFiles({ fs: currentHost().fs, rootId: racineChats.id, deviceId: idAppareil });
		try {
			chatSync = await startChatSync({ files: chatFiles });
		} catch (e) {
			console.warn(LOG_PREFIX, "chat sync not started:", e);
		}
		/* What this PC generates is published for the other devices as soon as the
		   queue exists (it appears with the shell). Idle: no timer, no write. */
		let stopGenerations: (() => void) | null = null;
		/* Requests sent by the phone: the PC turns each valid one into an
		   ordinary queue line (`remote-runner.ts`). Started with the queue, on
		   the PC only; a delivery event, a periodic pass and the start itself
		   ask for a scan. */
		let remoteScan: (() => void) | null = null;
		let stopRemote: (() => void) | null = null;
		onQueueCreated(queue => {
			stopGenerations = publishGenerations({ queue, write: f => chatFiles.writeGenerations(f), device: idAppareil });
			if (estMobile()) return;
			const runner = createRemoteRunner({
				device: idAppareil,
				now: () => Date.now(),
				readIncoming: () => chatFiles.readIncoming(),
				recordedIds: () => new Set(getChats().flatMap(c => c.requests.map(q => q.id))),
				queue,
				readDocument: async rel => {
					const path = absoluteInRoot(rel, racineChats.id);
					if (!path) return null;
					try {
						const content = await currentHost().fs.read(path);
						return content.length > 1_000_000 ? null : { name: rel.slice(rel.lastIndexOf("/") + 1), content, path, source: "vault" };
					} catch { return null; }
				},
				settings: () => reglagesIa.get(),
				takenLog: {
					async read() {
						const raw = await lireReglage<unknown>("remoteTaken");
						if (!Array.isArray(raw)) return [];
						return raw.filter((e): e is TakenLogEntry => !!e && typeof e.id === "string" && typeof e.from === "string" && typeof e.at === "number" && Number.isFinite(e.at)).slice(-MAX_TAKEN);
					},
					write: list => ecrireReglage("remoteTaken", list),
				},
				recordFailure: (req, message) => { setChats(addFailedRequest(getChats(), req, idAppareil, racineChats.id, Date.now(), message)); },
				notify: (title, body) => { void notifyPc(title, body); },
			});
			remoteScan = () => { void runner.scan(); };
			const timer = setInterval(remoteScan, 60_000);
			stopRemote = () => { clearInterval(timer); remoteScan = null; };
			remoteScan();
		});
		/* Without this load, the very first mount of the shell (below) would see
		   empty page settings (no folder expanded, default axis) instead of
		   those of the previous session. */
		await chargerReglagesPages();
		/* Same for the AI settings: the "Generate" page reads the provider and
		   model of the previous session on its first render. */
		await chargerReglagesIa();
		const store = await creerJournalApp(currentHost(), scanner);
		/* Les STATISTIQUES par quiz : à côté du journal, mais un système
		   distinct (spec de l'ordonnanceur §9.1 — voir `review/stats.ts`).
		   Construit ici et non dans `creerJournalApp` : les deux stores
		   n'ont rien en commun, mélanger leur construction les lierait pour
		   rien. */
		const stats = await creerStatsApp(sharedState());
		/* LES SESSIONS en cours (2026-09-26) : reprendre un quiz là où on
		   s'était arrêté. À côté du journal et des stats, un troisième
		   système distinct (voir `review/sessions.ts`). */
		const sessions = await creerSessionsApp();
		/* OTHER DEVICES' CHANGES LANDED (the embedded Syncthing went back to
		   idle after receiving files): the journals and the shared state are
		   read from the synced folder only at load time, so without this the
		   answers, attempts and exams of the other devices would stay
		   invisible until the next start. The shell repaints afterwards. One
		   reload at a time: events that arrive during one ask for one more. */
		let rechargeEnCours = false;
		let rechargeDemandee = false;
		const rechargerApresSync = async (): Promise<void> => {
			if (rechargeEnCours) { rechargeDemandee = true; return; }
			rechargeEnCours = true;
			const avantOverrides = overridesPartages();
			try {
				do {
					rechargeDemandee = false;
					await store.load();
					/* `stats.reload()` refuses while a save of the store's own is
					   pending; the shared state then keeps its diff base (see
					   `SharedState.refresh`). */
					await sharedState().refresh(() => stats.reload());
					relireExamens();
					await chatSync?.afterSync();
					remoteScan?.();
				} while (rechargeDemandee);
				adopterOverrides(avantOverrides);
				demonterCourant?.repaint?.();
			} catch (e) {
				console.warn(LOG_PREFIX, "reload after sync failed:", e);
			} finally {
				rechargeEnCours = false;
			}
		};
		pont().sync?.surDonneesRecues(() => { void rechargerApresSync(); });
		/* A `neo-quiz://pair` link clicked in the browser (the pairing page of
		   the site): the settings open on Sync with "Add a device" filled in.
		   Read once at start (a link that launched the app) and at each push
		   (one clicked while it runs). The owner still clicks Add. */
		const lireLienAppairage = async (): Promise<void> => {
			const lien = await pont().sync?.lienAppairage().catch(() => null);
			if (!lien) return;
			viserAjoutAppareil(lien);
			ouvrirReglages();
		};
		pont().sync?.surLienAppairage(() => { void lireLienAppairage(); });
		void lireLienAppairage();
		/* VIDER LES TAMPONS D'ÉCRITURE AVANT DE PARTIR. Quatre écrivains différés
		   vivent ici : `store` (journal de révision, 500 ms, `log-file.ts`),
		   `stats` (même débounce, `dashboard/stats-store.ts`), la page d'un
		   quiz (600 ms, `dashboard/detail.ts`), tenue par l'écran courant, et
		   les sessions en cours (400 ms, `review/sessions.ts`, voir plus bas).
		   Deux sorties, deux mécanismes, parce qu'aucun ne couvre les deux :

		   1. FERMETURE DE LA FENÊTRE (croix, Alt+F4, barre des tâches) :
		      `neo.fenetre.surFermeture`. Le processus principal intercepte le
		      `close` de la `BrowserWindow`, POUSSE l'appel vers le rendu et
		      attend sa réponse avant de détruire la fenêtre (`electron/main.ts`),
		      avec un délai de garde — sans lui, un rendu figé rendrait la
		      fenêtre INFERMABLE, le piège exact rencontré côté Tauri. L'ARMEMENT
		      lui-même est attendu (`await`) : une fermeture survenue avant que le
		      principal ne sache qu'un rappel existe n'attendrait rien. C'est le
		      seul chemin qui sache ATTENDRE une écriture : la page d'un quiz rend
		      une promesse résolue quand la note est écrite, et sans cette attente
		      fermer juste après une frappe perdait la frappe, sans message.
		      Ce qu'il NE couvre PAS : un `location.reload()`, la fin du
		      processus par le système, et les deux stores, dont `destroy()`
		      LANCE l'écriture sans rendre de promesse (limite antérieure à cette
		      tranche, notée au rapport de la tâche 10 de la TRANCHE 3, celle
		      qui a écrit ce chemin sous Tauri). La valeur définitive du délai de
		      garde a été fixée sur mesure par la tâche 6 de la migration
		      Electron (`DELAI_GARDE_FERMETURE_MS`, `electron/main.ts` — elle
		      était la 5 avant que le renommage d'un dossier ne devienne la
		      tâche 5, Ruling 16).
		   2. RECHARGEMENT (`location.reload()` dans `choisirDossier` /
		      `onFoldersChanged`, depuis la page Réglages) : `beforeunload`, qui
		      ne peut rien attendre — on ne fait que LANCER les écritures au plus
		      tôt. Tolérable ici : ces deux chemins partent de la page Réglages,
		      où la page d'un quiz n'est plus montée (son démontage a déjà lancé
		      son écriture, bien avant que l'utilisateur ait choisi un dossier).
		      Une version synchrone serait pire : elle bloquerait l'interface
		      pour une garantie que le navigateur ne peut pas tenir.

		   Les deux `destroy()` sont idempotents (`detruit`, minuterie annulée) :
		   les appeler des deux côtés ne double aucune écriture. C'est le pendant
		   du `this._reviewStore?.destroy()` de l'`onunload` du greffon. */
		/* A reload (Ctrl+R, the View menu, a setting) with a quiz on screen unmounts it
		   first: leaving a test always saves it (spec 2026-09-29-test-setup-modal-design.md
		   §3), and the engine's destruction is what writes its snapshot, the time left
		   on a timed test included. Registered BEFORE the writers below so that the
		   write it triggers is launched by them. Idempotent: closing the window has
		   already unmounted through `surFermeture`. */
		window.addEventListener("beforeunload", () => { void demonter(); });
		window.addEventListener("beforeunload", () => { store.destroy(); stats.destroy(); });
		/* Les sessions ne portent pas de délai d'écriture symétrique aux deux
		   autres (`destroy()`) : `vider()` écrit immédiatement, sans annuler de
		   minuterie propre à un `destroy` — la page d'un quiz l'a déjà appelé à
		   son démontage. Posé ici pour couvrir le cas restant : une frappe qui
		   photographie la session juste avant une fermeture qui saute le
		   démontage normal. */
		window.addEventListener("beforeunload", () => { void sessions.vider(); });
		// The chat files' debounced write (`chat-store.ts`, 400 ms): launched here on a reload.
		window.addEventListener("beforeunload", () => { void chatSync?.flush(); });
		await pont().fenetre.surFermeture(async () => {
			try {
				await demonter();
			} catch (e) {
				// Un démontage qui échoue ne doit pas retenir la fenêtre ouverte :
				// on le dit, puis on laisse `destroy()` suivre.
				console.warn(LOG_PREFIX, "démontage incomplet à la fermeture:", e);
			}
			store.destroy();
			stats.destroy();
			// Awaited: the chat file is written before the window closes.
			await chatSync?.flush();
			// Closing cleanly: the file goes, so no other device waits for a dead PC.
			stopGenerations?.();
			stopRemote?.();
			await chatFiles.clearGenerations().catch(() => {});
			// Attendue : la fenêtre ne se ferme qu'une fois la session écrite.
			await sessions.vider();
		});
		/* L'appariement des renommages que le surveillant n'a pas su nommer.
		   BRANCHÉ CÔTÉ APPLICATION SEULEMENT : Obsidian émet un vrai `rename`, que
		   le contrat transmet tel quel — le greffon n'a rien à deviner. */
		const detecteur = createRenameDetector({
			onRename: (from, to) => store.renamed(from, to),
			now: () => Date.now(),
		});
		scanner.onChange(quizzes => detecteur.observer(quizzes));
		/* ROUVRIR LÀ OÙ ON S'ÉTAIT ARRÊTÉ : posé sur la coquille AVANT son
		   premier montage — `reprendre` échoue silencieusement (quiz supprimé
		   entre deux lancements) et laisse alors la coquille sur son défaut
		   ("home"), sans Notice : une note disparue n'est pas une erreur. */
		/* Android: a tap on the daily review notification lands on Home, where today's
		   review is, instead of the last view; and the page hands the notification the
		   next days' due counts each time it goes to the background. */
		const depuisNotification = estMobile() && await pont().android?.revisionDemandee().catch(() => false);
		if (estMobile()) armerCalendrier(store);
		const derniereVue = depuisNotification ? { vue: "home" as const } : await chargerReprise();
		if (derniereVue) reprendre(derniereVue, scanner);
		mount(root, scanner, store, stats, sessions);
		/* Android: a zip or note another app opened or shared with us ('Open with', 'Share to'),
		   read at start (it launched the app) and at each push (it arrived while the app runs). */
		const repeindreApresReception = (): void => { demonterCourant?.repaint?.(); };
		pont().android?.surFichierRecu(() => { void lireFichierRecu(scanner, repeindreApresReception); });
		void lireFichierRecu(scanner, repeindreApresReception);
	} catch (e) {
		root.textContent = t("app.error.startup", { error: e instanceof Error ? e.message : String(e) });
	}
}

void demarrer().finally(() => {
	/* C'est CE signal, et non `ready-to-show`, qui autorise la vraie fenêtre à
	   apparaître. En installation, le bootstrapper garde sa petite fenêtre
	   d'attente jusqu'à cet instant. Sur une erreur de démarrage, `demarrer`
	   a déjà posé le message dans le rendu : on montre donc aussi cette erreur. */
	void pont().fenetre.prete()
		.catch(e => console.error(LOG_PREFIX, "signal prêt impossible:", e))
		.finally(() => {
			/* LA SURVEILLANCE PART ICI, APRÈS LE SIGNAL — jamais avant : c'est
			   tout l'objet de cette tâche (voir l'en-tête d'`host/fs.ts`). Le
			   crawl initial de chokidar tourne dans le même processus principal,
			   mono-thread, que l'hydratation ; le lancer avant qu'elle ne soit
			   finie, ou avant que la fenêtre ne soit montrée, retardait l'une et
			   l'autre. `miroirCourant` est `null` si `demarrer()` a échoué avant
			   d'atteindre `createWindowsIndex` : rien à surveiller alors.
			   Un ÉCHEC ICI N'EST JAMAIS FATAL : contrairement au reste de
			   `demarrer()`, cet appel n'est plus dans son `try` — un surveillant
			   qui ne démarre pas ne doit pas remplacer l'écran, déjà montré, par
			   le message d'erreur de démarrage. */
			void miroirCourant?.demarrerSurveillance()
				.catch(e => console.warn(LOG_PREFIX, "surveillance différée: échec au démarrage:", e));
			/* Le cache des comptes CLI (« claude », « codex », « agy »), amorcé
			   ICI plutôt qu'à la première ouverture des réglages — voir
			   `amorcerCacheComptes`. Même place que la surveillance ci-dessus :
			   après le signal `prete()`, jamais avant, et sans jamais retarder
			   l'affichage de la fenêtre sur une sonde lente (~1 s, Antigravity). */
			amorcerCacheComptes();
		});
});
