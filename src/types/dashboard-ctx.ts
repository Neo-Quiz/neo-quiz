/**
 * Types du sous-système dashboard consommés par LES DEUX hôtes (le contrat
 * `DashboardShellCtx`/`DashboardPageSettings`/`DashboardViewName`, plus
 * `AiSettings`, le sous-ensemble des réglages persistés que la page
 * « Générer » lit).
 *
 * `DashboardCtx`, `DashboardView` et `DashboardPlugin` — le littéral `ctx` et
 * l'hôte `this` de l'ex-`QuizDashboardView` (`src/dashboard.ts`), tous deux
 * typés en `App`/`ItemView`/`Plugin`/`TFile` d'Obsidian — sont partis à la
 * tâche 2 du chantier « greffon lecteur » (2026-09-13) : le greffon n'a plus
 * de vue dashboard, et plus aucun fichier de `src/` ni de `apps/` ne les
 * importait. Ce fichier était le DERNIER de `src/` à importer Obsidian
 * (`scripts/check-host.mjs`, `RESTANTS`) ; il ne le fait plus.
 */

import type { Scanner, QuizIndexEntry } from "../dashboard/scanner";
import type { StatsStore } from "../dashboard/stats-store";
import type { Hotkey } from "../hotkey-format";
import type { ModelDef, OllamaCatalogEntry } from "../dashboard/ai-providers";
import type { AiUsageEntry } from "../dashboard/usage-format";
import type { ModuleOverride, ModuleGroup, ModuleMap } from "../dashboard/quiz-modules";
import type { ReviewStore } from "../review/review-store";
import type { OngletDossier } from "../dashboard/quizzes-render";
import type { ActionMenuItem } from "../dashboard/ui-select";

/**
 * Un examen d'un dossier (« plusieurs examens par dossier », 2026-09-26).
 * Déclaré ici et non dans `apps/windows/src/host/folder.ts` : `src/` ne peut
 * pas importer `apps/`, alors que le sens inverse est permis — `folder.ts`
 * réexporte `export type Examen = ExamenDossier` en l'important en
 * `import type` depuis ce fichier. Date au format `AAAA-MM-JJ`.
 */
export interface ExamenDossier {
	id: string;
	nom: string;
	date: string;
	/** Weight of the exam in the course's grade, a number in (0, 100]: a
	    coefficient or a percentage depending on `weightUnit`. Optional. */
	coefficient?: number;
	/** What `coefficient` means; absent is "coef", so exams saved before the
	    percentage existed stay valid. Only ever written as "percent". */
	weightUnit?: "coef" | "percent";
	/** Continuous assessment: the dates of ALL its sessions (sorted, unique
	    `YYYY-MM-DD`, at most 60). An exam WITH `seances` is graded over those
	    sessions instead of on one day; its `date` is ALWAYS its last session,
	    so every reader of `date` (sorting, validation, lists) keeps working.
	    It never drives the review schedule. */
	seances?: string[];
}

/** Vues possibles du dashboard (dashboard.js:23 currentView, navigate, previousView). */
export type DashboardViewName = "home" | "quizzes" | "detail" | "ai" | "moodle";

/**
 * Réglages IA du plugin (src/plugin.js DEFAULT_SETTINGS, encore .js). Couvre
 * le sous-ensemble « génération IA » réellement lu par le lot IA (ai.ts /
 * ai-client.ts) — Task 8c. La dictée a été retirée le 2026-09-11 ; ses
 * réglages persistés existent encore au runtime (ignorés, pas effacés) mais
 * ne sont plus typés ici. Les champs non listés existent au runtime,
 * simplement pas encore déclarés ici.
 */
export interface AiSettings {
	aiProvider?: string;
	aiModel?: string;
	aiEffort?: string;
	aiCodexFast?: boolean;
	/** Antigravity : le niveau retenu PAR famille (`{ "gemini-3.1-pro": "low" }`),
	    comme le sélecteur d'Antigravity garde le sien à chaque modèle. */
	aiAntigravityLevels?: Record<string, string>;
	/** Antigravity : la dernière liste lue sur `agy models`, gardée pour
	    l'afficher tout de suite au lancement suivant (la lecture interroge le
	    réseau, une seconde) ; relue en arrière-plan. */
	aiAntigravityModels?: ModelDef[] | null;
	aiOllamaUrl?: string;
	aiOllamaCloudKey?: string;
	// `null` = sentinelle « défaut » réellement persistée par le plugin
	// (plugin.ts DEFAULT_SETTINGS) ; les helpers ollama la traitent comme « unset ».
	aiOllamaModels?: string[] | null;
	aiOllamaCatalog?: OllamaCatalogEntry[] | null;
	/** Verdict de plan appris par la SONDE à zéro token (`sonderPlanOllama`) et
	    par le 402 à la génération, par tag de modèle cloud (« kimi-k3:cloud »
	    → « payant »). `"inconnu"` n'est jamais écrit ici (rien à retenir).
	    Vidé quand le plan du compte change. */
	aiOllamaPlansAppris?: Record<string, "inclus" | "payant">;
	/** Le dernier plan vu par `/api/me` (« free », « pro »…) ; "" = inconnu. */
	aiOllamaPlanCompte?: string;
	/** Les identifiants des canaux PAYANTS que l'utilisateur a retirés du menu
	    des fournisseurs (Réglages de l'application ; `ai-providers.ts`,
	    `canalVisible`). Un canal gratuit ne s'y ajoute JAMAIS. Vide : rien de
	    masqué. */
	aiCanauxPayantsMasques?: string[];
	/** Les canaux web dont l'utilisateur a coché « Ne plus afficher » sur le
	    modal d'avertissement (« claude-web »). Un tableau : chaque site aura
	    peut-être le sien. */
	aiWebAvertissementMasque?: string[];
	/** Journal des générations IA (dashboard/ai-usage.ts). */
	aiUsageLog?: AiUsageEntry[];
	hotkeyAddFiles?: Hotkey | null;
	/** IGNORÉ depuis le 2026-09-17 (le bouton « Add notes » n'existe plus) ;
	    jamais effacé, comme les réglages de la dictée. */
	hotkeyAddNotes?: Hotkey | null;
	aiMentionExtraFolders?: string[];
	/** Chemin relatif persistant du dossier qui reçoit les quiz générés. */
	aiOutputFolder?: string;
	/** The message "Explain" sends about a played question (2026-09-29,
	    `explain-prompt.ts` placeholders). Empty: the translated default. */
	aiExplainPrompt?: string;
	/** The request "/exam" writes for the learner (2026-09-30, `exam-command.ts`,
	    placeholders {exam}, {module}, {date}). Empty: the translated default. */
	aiExamPrompt?: string;
	/** The longest explanation "Explain" asks for, in characters. */
	aiExplainMaxChars?: number;
	/* PLUS DE CHEMINS D'EXÉCUTABLE DE CLI (2026-09-17). Deux champs des
	   Réglages désignaient l'exécutable à lancer quand la sonde automatique
	   échouait. Le processus principal fusionne désormais le `PATH` du REGISTRE
	   dans le sien au démarrage (`electron/process.ts`, `chargerPathRegistre`),
	   ce qui rattrape la cause réelle — un `PATH` de processus figé au
	   lancement — sans rien demander, et sans qu'aucun chemin de programme
	   vienne plus de la fenêtre. */
	/* NB : cette interface s'appelle « AiSettings » mais elle est en réalité
	   le sous-ensemble des réglages du plugin que le DASHBOARD lit — le nom
	   ne suit plus. Le champ ci-dessous n'a rien d'IA ; le renommage est un
	   travail à part (plugin.js n'est pas encore converti), à signaler au
	   rapport plutôt qu'à faire ici. */
	quizzesExpandedFolders?: string[];
	/** Axe de regroupement de « Mes quiz » (module/ue/recent/type) — même remarque
	    que ci-dessus, aucun rapport avec l'IA. Cf. plugin.ts DEFAULT_SETTINGS. */
	quizzesGrouping?: "module" | "ue" | "recent" | "type" | "folder";
	/** Note de correspondance UE → module. Cf. plugin.ts DEFAULT_SETTINGS. */
	quizzesModuleMapNote?: string;
	/** DOSSIERS archivés (clé `folder` de module) — l'archivage n'existe qu'au
	    niveau dossier. Cf. plugin.ts DEFAULT_SETTINGS. */
	quizzesArchivedFolders?: string[];
	/** Overrides « Modifier dossier » (module-edit.ts). Cf. plugin.ts. */
	quizzesModuleOverrides?: Record<string, ModuleOverride>;
}

/* ════════════════════════════════════════════════════════
   DashboardShellCtx — ce dont les pages PORTÉES (accueil, « Mes
   quiz ») ont besoin, et RIEN de plus (plan tranche 2.5, tâche 2,
   décision D3).
   ════════════════════════════════════════════════════════ */

/** Les cinq réglages que les pages accueil / « Mes quiz » lisent, et rien
    d'autre — sous-ensemble nommé de `AiSettings` (mêmes clés, cf. plus haut).
    `quizzesGrouping` reste `string` : les pages ne valident qu'un sous-axe
    (« ue » / « recent ») au lecture, la forme complète appartient au plugin. */
export interface DashboardPageSettings {
	quizzesExpandedFolders?: string[];
	quizzesGrouping?: string;
	quizzesModuleOverrides?: Record<string, ModuleOverride>;
	quizzesModuleMapNote?: string;
	quizzesArchivedFolders?: string[];
}

/** Ce qu'une page transmet à la suivante en naviguant. */
export interface NavigateData {
	quiz?: QuizIndexEntry;
	edit?: boolean;
	/** D'où l'on arrive sur la page du quiz : `"generation"` quand le quiz
	    vient d'être créé — elle entre alors avec une animation ; rien depuis
	    « Mes quiz » (Ahmed, 2026-09-19 : seulement depuis une génération). */
	entree?: "generation";
	/** « Créer avec l'IA » DEPUIS UN DOSSIER (2026-09-17) : la page « Générer »
	    arrive avec la destination réglée sur ce dossier et ses sources déjà
	    jointes — les documents et les notes du dossier, en chemins du contrat,
	    joints par le même chemin que le picker « @ ». Un PDF est lu par l'hôte
	    (`HostPdf`), une note par son texte. */
	aiPreset?: AiPreset;
}

export interface AiPreset {
	/** Chemin du contrat du dossier où le quiz généré sera écrit. */
	destination: string;
	/** Chemins du contrat à joindre, dans l'ordre. */
	attach: string[];
	/** Texte à mettre dans le composer (écrit dans le champ du Planning). */
	prompt?: string;
	/** Lancer la génération dès que les pièces sont jointes. */
	lancer?: boolean;
}

/**
 * Ce dont les pages Accueil et Mes quiz ont besoin, et RIEN de plus.
 */
export interface DashboardShellCtx {
	scanner: Scanner;
	statsStore: StatsStore;
	/** Les cinq réglages ci-dessus. Mutés en place puis persistés par
	    `saveSettings()`, comme avant (même objet que `plugin.settings` côté
	    greffon — jamais une copie, sinon un autre onglet ou un rechargement
	    écrirait dans le vide). */
	settings: DashboardPageSettings;
	saveSettings(): Promise<void>;
	/* Le plan (D3) déclarait `navigate(view: DashboardViewName): void`, sans
	   second paramètre — mais `home.ts` (typé, lui, en `DashboardShellCtx`)
	   et quiz-menu.ts (passé à `DashboardShellCtx` en tranche 3, tâche 9),
	   ai.ts (toujours typé en `DashboardCtx`, il importe encore Obsidian)
	   appellent TOUS `ctx.navigate("detail", { quiz, edit? })`.
	   `detail.ts` est passé à `DashboardShellCtx` en tranche 3 (tâche 8) : ses
	   trois lectures de `ctx.view` sont remontées chez l'appelant, dans la
	   `DetailHostSpec` que `src/dashboard.ts` construit.
	   Perdre ce paramètre ici cassait leur compilation : signature restaurée
	   à l'identique de l'ancienne `DashboardCtx.navigate` (bug du plan,
	   corrigé — cf. rapport de tâche).
	   `folder-create.ts`, lui, est passé à `DashboardShellCtx` en tranche 2.6
	   (il n'appelle que `navigate("ai")`, à un seul argument). */
	navigate(view: DashboardViewName, data?: NavigateData): void;
	/** Historique boutons souris (spec 2026-07-20-mouse-nav-history) : empile
	    l'état de navigation COURANT avant un changement — appelé par quizzes.ts
	    juste avant drill in/out. */
	recordNav(): void;
	/** Joue un quiz. L'hôte décide ce que « jouer » veut dire : ouvrir la
	    note sous Obsidian, monter la page de quiz dans l'application. */
	openQuiz(quiz: QuizIndexEntry): void;
	/** Ouvre les réglages de l'hôte (l'onglet du plugin sous Obsidian). */
	openSettings(): void;
	/** Pages que cet hôte sait ouvrir. Une entrée du rail absente d'ici est
	    rendue DÉSACTIVÉE, pas masquée : la génération atterrira dans
	    l'application (tranche 4) et y sera exclusive — le greffon la perdra.
	    Une barre de navigation qui change de forme entre deux versions se
	    remarque plus qu'une entrée visiblement à venir. */
	canOpen(view: DashboardViewName): boolean;
	/** Le journal de révision, pour la carte « À réviser aujourd'hui ».
	    Absent = la section ne s'affiche pas. Le greffon le fournit depuis
	    `plugin._reviewStore` ; l'application depuis `creerJournalApp`. */
	reviewStore?: ReviewStore;
	/** La session EN COURS d'un quiz (reprendre là où on s'était arrêté) :
	    numéro 1-based de la question courante, total, heure d'écriture.
	    Absent côté hôte sans reprise : pas de « Reprendre ». */
	sessionOf?(path: string): { question: number; total: number; ecrite: number } | null;
	/** La couleur d'AMBIANCE de l'hôte (2026-09-26) : « Mes quiz » l'appelle
	    à chaque rendu avec l'accent du dossier ouvert, `null` hors dossier.
	    L'application en teinte la lueur autour de son panneau central.
	    Absente = pas d'ambiance, la page n'en dépend pas. */
	ambiance?(accent: string | null): void;
	/** The SHEET STACK (2026-09-29): an open folder rises as a sheet over
	    the grid, which stays behind it. "Folders" hands the host its
	    repaints: `open` repaints the page with the folder, `close` paints
	    the grid into the target it is given. `sync` is called on every
	    render with the number of sheets the page stands on (1 in a folder,
	    0 on the grid). Absent = plain repaints. */
	sheetStack?: {
		open(paint: () => void): void;
		close(paint: (target: HTMLElement) => void): void;
		sync(depth: number): void;
	};
	/** OUVRE le menu « ⋯ » d'une carte de quiz sur `anchor` (le bouton « ⋯ »),
	    appelée par la page avec SON propre `rerender` — le menu doit pouvoir
	    repeindre la page qui l'affiche. Absente = pas de bouton « ⋯ », ce que
	    `renderQuizCard` prévoit déjà par son `onMenu?` opt-in.
	    Tour de correction 1 (tâche 6) : la carte ne compose plus le menu et
	    ne l'ouvre plus elle-même (`renderQuizCard`/`renderModuleCard`
	    importaient `openActionMenu` d'`ui-select.ts`, donc Obsidian, de façon
	    INCONDITIONNELLE — même quand aucun menu n'était fourni au runtime,
	    ce qui rendait TOUTE carte, et tout ce qui la consomme, irrémédiablement
	    liée à Obsidian). L'ouverture appartient maintenant à l'hôte : c'est
	    lui qui importe `ui-select.ts` (le greffon le fait déjà, `dashboard.ts`
	    reste dans RESTANTS) et compose les items AU CLIC. */
	/* `map` (tranche 9, tâche « Move to ») : le sous-menu « Déplacer vers »
	   liste les dossiers connus groupés par UE, tirés de la même table que
	   `openModuleMenu`. `extra`: lines put above the card's own, a quiz's
	   page in editing ("Vocabulary", detail.ts). */
	openCardMenu?: (quiz: QuizIndexEntry, anchor: HTMLElement, rerender: () => void, map: ModuleMap, extra?: ActionMenuItem[]) => void;
	/** Même rôle qu'`openCardMenu`, pour le menu « ⋯ » d'une carte de MODULE
	    (« Mes quiz », tâche 6) : partage, « Modifier dossier », suppression —
	    autant de modals que l'application n'a pas encore. Absente = pas de
	    bouton « ⋯ », ce que `renderModuleCard` prévoit déjà par son `onMenu?`
	    opt-in — l'application ne la fournit pas (menus et modals = tranche
	    2.6, D5). */
	openModuleMenu?: (group: ModuleGroup, anchor: HTMLElement, rerender: () => void, map: ModuleMap) => void;
	/* ── LES EXAMENS D'UN DOSSIER ──

	   Ils ne passent PAS par `quizzesModuleOverrides`, alors que le modal
	   « Modifier dossier » écrit tout le reste là-bas, et c'est une correction
	   de bug : les overrides sont indexés par `ModuleGroup.folder`, qui est un
	   NOM DE SEGMENT (« Generated »), sans l'identifiant de la racine. Deux
	   dossiers ouverts ayant chacun un sous-dossier de ce nom — « Neo
	   Quiz/Generated » et « Personal/Generated », le cas d'Ahmed — partageaient
	   donc la même entrée. Pour une couleur, c'est un défaut visible ; pour un
	   HORIZON DE RÉTENTION, c'est une matière dont les révisions se resserrent
	   à cause de l'examen d'une autre. L'ordonnanceur lit une clé qui porte la
	   racine (`apps/windows/src/review/catalogue.ts`, `cleModule`), et c'est
	   l'HÔTE qui fait la conversion : le code partagé ne connaît ni les racines
	   ni leurs identifiants.

	   « Plusieurs examens par dossier » (2026-09-26) : PLUS d'`examDate`/
	   `setExamDate` (une seule date) — l'onglet Planning (tâche 4) les a
	   remplacés. Absents = pas de liste d'examens dans l'onglet. */
	examens?: (group: ModuleGroup) => ExamenDossier[];
	/** A folder or quiz moved from `from` to `to` (contract paths): rename every
	    key the host keeps under that prefix (exams, sessions, per-folder
	    settings). `quizPathsBefore`: every quiz path of the catalogue as it was
	    BEFORE the rename (the watcher may already have refreshed the live one).
	    Optional: a host that keeps none of them omits it. */
	movedPrefix?(from: string, to: string, quizPathsBefore?: readonly string[]): Promise<void>;
	/** Ajoute ou remplace (même `id`) un examen du dossier. */
	enregistrerExamen?: (group: ModuleGroup, e: ExamenDossier) => void;
	/** Retire un examen du dossier par son `id`. */
	retirerExamen?: (group: ModuleGroup, id: string) => void;
	/** Ouvre « Mes quiz » sur ce dossier, à l'onglet donné — appelé par
	    « Modifier dossier » (bouton « Gérer les examens ») qui a fermé son
	    modal et n'a plus de champ de date à éditer sur place. Absent = le
	    bouton n'a nulle part où aller (aucun hôte ne le fournit encore sans
	    onglet Planning). */
	openFolderTab?: (folder: string, onglet: OngletDossier) => void;
	/** Sélecteur d'icône d'un module (clic sur la pastille de la carte).
	    Absent = la pastille n'est pas cliquable — `renderModuleCard` prévoit
	    déjà `onPickIcon?` en opt-in. `suggestions` (calculées par la PAGE
	    depuis le nom/l'UE du module, pur — icon-suggest.ts) est simplement
	    transmis ; c'est l'HÔTE qui appelle `openIconPicker` et lui donne son
	    conteneur de portail (les deux passent `document.body` aujourd'hui).
	    `icon-picker.ts` ne tire plus Obsidian depuis la tranche 2.6 — les noms
	    d'icônes viennent d'`HostUi.iconNames()` —, et l'application fournit
	    donc réellement ce membre. */
	pickIcon?: (anchor: HTMLElement, courante: string | undefined, onPick: (nom: string) => void, suggestions?: string[]) => void;
	/** Création d'un quiz dans le dossier OUVERT (drill-down de « Mes
	    quiz »). Absente = le bouton « Nouveau quiz » du header n'est pas
	    rendu. Les modals ne sont plus la raison de cette absence (elles sont
	    dans le contrat depuis la tranche 2.6) : c'est que « Nouveau quiz »
	    écrit une note VIERGE puis l'ouvre en édition, et que l'application
	    n'a pas d'éditeur avant la tranche 3 — un quiz vide qu'on ne peut pas
	    remplir est une impasse, pas une fonctionnalité
	    (apps/windows/src/ui/dashboard-shell.ts). */
	createQuiz?: (folder: string, done: () => void) => void;
	/** Création d'un dossier (racine de « Mes quiz »). Absente = le bouton
	    « Nouveau dossier » n'est pas rendu. `map`/`quizzes` : mêmes données
	    que `openCreateFolderModal` (l'import d'un .zip partagé cherche le parent
	    commun des modules déjà résolus — folder-create.ts). */
	createFolder?: (map: ModuleMap, quizzes: QuizIndexEntry[], done: () => void) => void;
	/** Picks a folder that already exists and declares it as a quiz folder
	    ("Open an existing folder" card of the create modal). Absent = the card
	    is not rendered. The host opens its native picker, translates the
	    absolute path into a contract path (opening it as a new root when it is
	    outside every open one) and writes the override: only it knows its roots. */
	openExistingFolder?: (done: () => void) => void;
	/** Le chemin du CONTRAT du dossier où atterrissent les quiz générés
	    (`<racine par défaut>/<aiOutputFolder>`). Ce dossier est un SAS, pas
	    une matière : sa carte porte l'icône de l'IA et ni lui ni sa page
	    n'affichent de progression — on y range ce qui vient d'être généré,
	    on l'en sort vers sa vraie matière. Reconnu par son CHEMIN, jamais par
	    son nom : l'utilisateur peut renommer le réglage, et un autre dossier
	    peut s'appeler « Generated » dans un vault. Absent = aucun dossier n'est
	    le sas (le greffon). */
	generatedFolder?: () => string | undefined;
	/** Opens the Moodle page (PC only): a "Moodle" button of the Folders top bar
	    when present. Absent on a phone and in the plugin. */
	openMoodle?: () => void;
	/** Ouvre N'IMPORTE QUEL fichier du dossier (chemin du contrat) avec
	    l'application du système — un PDF, une image. `shell.openExternal` ne
	    prend qu'un `HostFile`, donc une NOTE de l'index ; les documents de la
	    page d'un dossier n'y sont pas. `false` = pas ouvert, et l'appelant le
	    dit. Absent = les documents ne s'ouvrent pas d'un clic (le greffon :
	    Obsidian les ouvre lui-même depuis l'explorateur). */
	openPath?: (path: string) => Promise<boolean>;
	/** Le chemin ABSOLU d'un fichier du dossier (chemin du contrat), tel que
	    le système l'écrit — c'est ce qu'on colle dans un explorateur ou un
	    terminal, là où le chemin du contrat ne désigne rien hors de
	    l'application. `null` si la racine n'est plus ouverte. Absent = pas
	    d'entrée « Copier le chemin » dans le menu ⋯ (le greffon : Obsidian
	    a la sienne dans son explorateur). */
	absolutePath?: (path: string) => string | null;
	/** Écrit du texte dans le presse-papiers ; `false` si l'hôte a refusé.
	    L'hôte, et non `navigator.clipboard` : dans la fenêtre de
	    l'application, l'écriture directe passe par une demande de permission
	    `clipboard-read` que le processus principal refuse (mesuré le
	    2026-09-17), et l'appel échoue en `NotAllowedError`. */
	copyText?: (texte: string) => Promise<boolean>;
	/** The time limit (minutes) a quiz was last played with, if any: what the
	    "Keep exam mode" menu item writes as the duration. The remembered setups
	    live in the application's settings, so only the application has them;
	    absent = the note's own duration, else the fallback rule. */
	rememberedTestMinutes?: (path: string) => Promise<number | null>;
	/** Ouvre une NOTE dans Obsidian (`obsidian://open`), quand la racine de ce
	    chemin est un vault. `false` = pas un vault, ou Obsidian absent : pas
	    une erreur, l'appelant enchaîne sur l'ouverture par le système. C'est ce
	    qu'Ahmed a demandé (2026-09-17) pour « Créer une note » : la note vit
	    dans un vault, c'est là qu'elle s'écrit. */
	openInObsidian?: (path: string) => Promise<boolean>;
	/** La date de dernière modification d'un fichier (ms), ou `null`. Le
	    contrat ne date que les NOTES (`HostFile.mtime`, relevé sur les seuls
	    `.md` — un `stat` par image d'un dossier de cours serait une dépense
	    sans acheteur) ; un document, lui, se date à la demande, ici. Sert à la
	    confirmation de suppression (Ahmed, 2026-09-17 : la date s'affiche
	    avant d'effacer). Absent = pas de date dans la modale. */
	fileMtime?: (path: string) => Promise<number | null>;
	/** Sélecteur d'axe de regroupement (UE / Récent, ligne au-dessus de la
	    grille). `createSelect` (ui-select.ts) a été libéré d'Obsidian en
	    tranche 2.6 et les DEUX hôtes consomment désormais le MÊME dropdown
	    partagé — l'application n'en a pas porté un second, ce qui aurait
	    donné deux composants à faire évoluer ensemble. Le membre reste
	    optionnel parce qu'un hôte a le droit de ne pas offrir de bouton :
	    l'axe déjà persisté (réglage `quizzesGrouping`) resterait actif.
	    Renvoie l'élément du déclencheur pour que l'appelant y ajoute sa
	    propre classe, comme `createSelect`. */
	renderGroupingSelect?: (
		container: HTMLElement,
		opts: {
			value: string; options: { value: string; label: string }[]; onChange: (value: string) => void;
			/* Optional drawing of the trigger and of each option (the subject
			   filter puts its icon before the name, 2026-09-29). Passed
			   through to `createSelect` as is. */
			renderTrigger?: (labelEl: HTMLElement, current: { value: string; label: string } | null) => void;
			renderOption?: (optBtn: HTMLElement, option: { value: string; label: string }) => void;
		},
	) => { el: HTMLElement };
	/** Ouvre la note d'un quiz, éventuellement en édition. Optionnel et ABSENT
	    côté application jusqu'à la tranche 3 : ouvrir un quiz vierge qu'on ne
	    peut pas éditer n'est pas une fonctionnalité, c'est une impasse.
	    L'appelant garde donc son appel optionnel (`?.`) plutôt que de tester
	    l'hôte. */
	openQuizPath?: (path: string, opts?: { edit?: boolean }) => Promise<void>;
	/** Ouvre le partage d'un quiz ou d'un module (zip, Discord, enregistrer).
	    Optionnel et ABSENT côté application : `dashboard/share.ts` livre par
	    `child_process` et `electron.shell`, c'est-à-dire par le sous-contrat de
	    lancement de processus de la tranche 4 — et la spec §7 range de toute
	    façon « la distribution aux camarades » hors de ce chantier. L'entrée
	    « Partager » du menu « ⋯ » n'est simplement pas rendue dans la fenêtre
	    (quiz-menu.ts). Union et non deux champs optionnels : une cible sans
	    quiz ni module ne se construit pas. */
	shareQuiz?: (cible: { quiz: QuizIndexEntry } | { group: ModuleGroup }) => void;
	/** Renomme la note d'un quiz EN METTANT LES LIENS À JOUR. Optionnel et
	    absent côté application : seul Obsidian tient l'index des liens
	    ENTRANTS que cette opération exige (`fileManager.renameFile`).
	    `HostFs.rename` ne convient pas — il déplace des octets sans rien
	    réécrire ailleurs, et la migration du journal dépend de sa sémantique
	    actuelle. Sans ce membre, l'entrée « Renommer » n'est pas rendue.

	    `nom` est le futur basename, déjà ASSAINI par la modale (sans
	    extension ni dossier) ; l'hôte compose la cible dans le dossier de la
	    note, avec son extension.

	    RÉSULTAT : `true` si la note est renommée, `false` sinon — et jamais un
	    rejet. Un `Promise<void>` ne suffisait pas : la modale partagée reste
	    OUVERTE sur un échec, pour que l'utilisateur corrige le nom au lieu de
	    le retaper, et se ferme seulement sur succès ; il lui faut distinguer
	    les deux. C'est l'HÔTE qui affiche la cause (Notice « existe déjà »,
	    « impossible », « introuvable ») : lui seul la connaît.

	    LA GARDE DE COLLISION est donc à l'hôte, et sa force dépend de son index.
	    Le greffon regarde `vault.getAbstractFileByPath(cible)`, qui voit un
	    DOSSIER au chemin cible comme une collision. Un hôte qui n'aurait que
	    `HostFs.getFile` (l'application, le jour où elle tiendra un index des
	    liens entrants) ne verrait que les FICHIERS catalogués : un dossier au
	    nom cible ne déclencherait pas « existe déjà », et l'opération irait
	    jusqu'au renommage pour échouer autrement (« impossible »). Aucun
	    écrasement possible, un message moins précis — limite connue, laissée
	    telle quelle : la corriger serait un membre de contrat de plus. */
	renameQuiz?: (quiz: QuizIndexEntry, nom: string) => Promise<boolean>;
}
