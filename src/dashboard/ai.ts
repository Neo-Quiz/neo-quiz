import JSON5 from "json5";
import type { AiPreset, DashboardViewName, NavigateData } from "../types/dashboard-ctx";
import type { ModeGeneration } from "../quiz-format";
import { completerConfigLearn, fusionnerConfigsFinales } from "../quiz-format";
import { quizModeIcon, quizModeLabel } from "./quiz-card";
import { debutDeDemande } from "./ai-sources";
import { brouillonDe, composerDemande, decouperParFichier, dossierParDefaut, enregistrerLot, enregistrerQuiz, lectureEnUnePasse, lienLearn, canChooseQuizCount } from "./generation-demande";
import type { AttachmentSource, DemandeTexte, NoteAttachment } from "./generation-demande";
import { fileDeGeneration, figerReglages } from "./file-generation-app";
import type { FileGenerationApp, LigneGeneration, ReglagesFiges } from "./file-generation-app";
import { creerVueFile } from "./file-generation-vue";
import type { HostFile, HostModalHandle, ImageDeGlisser } from "../host/types";
import { currentHost, requireHost } from "../host/current";
import { ajouter } from "../dom";
import { attachHoverTip } from "./hover-tip";
import { openConfirmModal } from "../editor/modals";
import { LOG_PREFIX } from "../branding";
import * as aiProviders from "./ai-providers";
import { monterBandeauMaj } from "./cli-updates";
import { demarrerConnexionCli, poserCroixAnnuler } from "./connexion-cli";
import { composerPrompts, createAiClient, parseReponseLot, parseReponseQuiz } from "./ai-client";
import { nouveauJeton, texteWeb, preparerOuverture } from "./ai-web";
import type { ResultatOuverture } from "./ai-web";
import type { Scanner, QuizIndexEntry } from "./scanner";
import type { StatsStore } from "./stats-store";
import { aiSettingsDefaults, destinationMemorisee } from "./ai-settings-host";
import type { AiSettingsHost } from "./ai-settings-host";
import { GENERATED_MODULE_ICON } from "./module-icons";
import { GENERATED_MODULE_ACCENT } from "./module-color";
import { closeAllSelects, openModelMenu, openProviderMenu, openEffortSlider, openOptionsMenu, openNotePicker, openActionMenu } from "./ui-select";
import { ouvrirMenuPlus } from "./composer-plus";
import { categorieChoisie, detecterCategorie, estCategorie } from "./categorie-quiz";
import type { CategorieQuiz, IndicesCategorie } from "./categorie-quiz";
import { choixCategories, libelleDetecte, peindreAvisCategorie } from "./categorie-affichage";
import { attachmentKey, creerPiecesJointes, effetEnCours, entrerVignette, poserCroix, poserImage } from "./composer-attachments";
import { poserNouvelleDemande } from "./conversation-mode";
import { contexteConversation, documentsHeritiers } from "./conversation-context";
import { activeChatId, chatDevice, notifyChatsChanged, onChatsChanged, setActiveChat } from "./chat-session";
import { getChats, setChats } from "./chat-store";
import { threadItems, toursOfThread } from "./chat-thread";
import { getRemoteGenerations } from "./remote-generations";
import { addClarify, answerClarify, resumeSource, chatOfLine, newRequestId, runningLineOfChat } from "./chat-requests";
import { rankFolders, suggestFolders } from "./folder-suggest";
import type { FileRef, FolderRef } from "./folder-suggest";
import { decideByKeywords, formatClarifications, parseClarifyAnswer } from "./generation-kind";
import type { ClarifyAnswer, KindChoice } from "./generation-kind";
import { poserListeChats, suivreConversations } from "./chat-sidebar";
import { ouvrirRecherche } from "./chat-search";
import { poserPlan } from "./plan-sidebar";
import { ouvrirDocumentsExam } from "./exam-documents";
import { PALIERS_TEST, attachExamCommand, promptPreparation, retirerCommandeExam } from "./exam-command";
import type { ExamCible, ExamCommandHandle } from "./exam-command";
import { badgeDeFichier, couperNomAuMilieu } from "./file-icons";
import { composerImageDeGlisser } from "./image-de-glisser";
import { renderMarkdownPreview } from "../markdown-preview";
import { mathifyElement } from "../engine/mathjax";
import type { ProviderBrandOption, ProviderMenuHandle } from "./ui-select";
import { formatHotkey, eventToHotkey } from "../hotkey-format";
import { attachMentionPicker } from "./mention-picker";
import type { MentionPickerHandle } from "./mention-picker";
import { formatTokens, formatCost, formatDuration, totalTokens, tightestRow, usageRowLabel, providerPublishesPlan } from "./usage-format";
import type { AiUsage, AiUsageEntry, PlanUsage } from "./usage-format";
import { scanPromptPaths, MAX_PROMPT_PATHS } from "./prompt-paths";
import { createQuizPage } from "./detail";
import type { QuizPageHandlers } from "./detail";
import type { QuizDraft } from "./detail-io";
import { exportAll } from "../editor/export";
import { currentLang, t } from "../i18n";
import type { TransKey } from "../i18n";
import { openInstallModal } from "./ai-install-modal";
import type { InstallProvider } from "./ai-install-modal";
import { creerTuilesVideo, type TuilesVideo } from "./video-tile";
import { liensNonLus } from "../video/youtube";

/* ══════════════════════════════════════════════════════════
   AI VIEW — Dashboard
   Formulaire de génération IA (onglets Sujet/Image/Texte)
   + preview (idle / loading / result / error).
   Providers, logos et modèles : voir ai-providers.ts.
══════════════════════════════════════════════════════════ */

/* `connexion` : l'échec vient d'un compte non connecté, l'utilisateur a
   cliqué « Se connecter », un terminal est ouvert et la page ATTEND que la
   sonde voie le compte arriver. Un état à part et non un drapeau sur
   `error` : le composer, la bulle de la demande et le bouton d'envoi s'y
   comportent comme pendant une génération (rien à renvoyer tant que ça
   tourne), et c'est la phase qui le dit partout d'un seul mot.
   Plus de phase « loading » depuis la file de génération (2026-09-26) : une
   génération par CLI ne bloque plus la page, elle devient une ligne de la
   file (`file-generation-app.ts`). */
type Phase = "idle" | "result" | "error" | "connexion" | "web";

/** Les trois outils qui ont un compte à connecter (pas les modèles locaux
    Ollama, qui n'en ont pas besoin). */
type OutilCompte = "claude" | "codex" | "ollama" | "agy";
/** L'identifiant de fournisseur de chaque outil à compte, et l'inverse. */
const ID_DE_OUTIL: Record<OutilCompte, string> = { claude: "claude-code", codex: "codex", ollama: "ollama", agy: "antigravity-cli" };

/** Le pas de la sonde de connexion, le même que celui du modal
    d'installation : trois secondes, assez court pour que la détection semble
    immédiate, assez long pour ne pas lancer un CLI en boucle serrée. */
const SONDE_CONNEXION_MS = 3000;

type GreetingSlot = "morning" | "afternoon" | "evening" | "night";

/** The part of the day for a local hour: morning 5–12, afternoon 12–18,
    evening 18–23, night otherwise. */
function greetingSlot(hour: number): GreetingSlot {
	if (hour >= 5 && hour < 12) return "morning";
	if (hour >= 12 && hour < 18) return "afternoon";
	if (hour >= 18 && hour < 23) return "evening";
	return "night";
}

/** The page greetings, claude.ai style: short (they are set in a 46px
    serif and must hold on one line above the composer), a few per part of
    the day, plus a pool that fits any hour. KEYS, not strings: `t()` runs
    at render, so a language change applies to the greeting already picked. */
const GREETINGS: Record<GreetingSlot | "any", readonly TransKey[]> = {
	morning: ["ai.greeting.morning1", "ai.greeting.morning2", "ai.greeting.morning3"],
	afternoon: ["ai.greeting.afternoon1", "ai.greeting.afternoon2", "ai.greeting.afternoon3"],
	evening: ["ai.greeting.evening1", "ai.greeting.evening2", "ai.greeting.evening3"],
	night: ["ai.greeting.night1", "ai.greeting.night2", "ai.greeting.night3"],
	any: ["ai.greeting.any1", "ai.greeting.any2", "ai.greeting.any3", "ai.greeting.any4"],
};

function pickGreeting(slot: GreetingSlot): TransKey {
	const pool = [...GREETINGS[slot], ...GREETINGS.any];
	return pool[Math.floor(Math.random() * pool.length)] ?? "ai.greeting.any1";
}

/* Les pièces jointes et la demande vivent dans `generation-demande.ts`,
   partagé avec la file de génération ; ré-exportées pour leurs lecteurs. */
export type { AttachmentSource, NoteAttachment } from "./generation-demande";

/** Une tuile de la modale d'attente du canal web : ce qui s'affiche, et le
    fichier que l'hôte fera partir au glisser (`HostDepot.glisser`). */
interface TuileDepot {
	name: string;
	/** La page d'un PDF ou l'image elle-même ; absent pour une note. */
	thumb?: string;
	cible: HostFile | string;
}

/** Image jointe (vignette + objet fichier). */
interface ComposerImage {
	file: File;
	url: string;
}

/** Message PARTI vers un SITE (canal web) — ce que le composer contenait
    au moment de l'envoi. Le composer, lui, GARDE la demande pendant
    l'attente (Ahmed, 2026-09-19 : derrière la modale d'étape, un champ vidé
    laissait croire la demande effacée). Un envoi par CLI, lui, part dans la
    file (`DemandeFile`) et vide le composer. */
type SentMessage = DemandeTexte<ComposerImage>;

/** Le contrôle fournisseur : son bouton (un logo seul dans le pied du
    composer) et de quoi redessiner le menu ouvert quand un statut de CLI
    arrive après coup. Ce n'est plus un `createSelect` depuis que le menu a
    DEUX niveaux (marque, puis canal) : voir `openProviderMenu`. */
interface ProviderControl {
	el: HTMLElement;
	refreshMenu(): void;
}

/** Élément de la liste Ollama (décorée pour le menu). */
interface OllamaListItem {
	value: string;
	label: string;
	cloud: boolean;
	thinking: boolean;
	installed: boolean;
	icon: string | null;
	horsPlan: boolean;
}

/** État partagé du contrôle Ollama (liste + refresh). */
interface OllamaCtl {
	options: OllamaListItem[];
	detected: aiProviders.OllamaDetectedModel[] | null;
	refreshTrigger: (() => void) | null;
}

interface ProviderStatusEntry {
	dot: string;
	text: string;
}

/** Arguments (fixés par le render) de refreshProviderStatuses. */
interface RefreshArgs {
	providerSelect: ProviderControl | null;
	hintZone: HTMLElement | null;
	provider: string;
	currentModel: string;
	modelSelect: unknown;
	ollamaCtl: OllamaCtl | null;
	buildOllamaList: (detected: aiProviders.OllamaDetectedModel[] | null) => OllamaListItem[];
	force?: boolean;
}

/** Action optionnelle d'un hint contextuel. */
interface HintAction {
	label: string;
	icon?: string;
	onClick: () => void;
}
/** Options du hint contextuel (renderHint). */
interface HintOptions {
	type?: string;
	icon?: string;
	text: string;
	action?: HintAction;
}


/** L'écran d'usage du forfait — OPTIONNEL, et fourni par le seul greffon.
    Décision du 2026-09-12 : le modal d'usage (`usage-modal.ts`, `ai-usage.ts`)
    n'est pas porté dans l'application ; il reste lié à Obsidian, et la page ne
    l'importe plus. Absent, la page ne rend ni le bouton d'usage du composer
    ni la relecture du forfait après une génération — les compteurs de la
    génération elle-même (tokens, coût, durée) restent affichés : ils viennent
    du client, pas d'ici. */
export interface AiUsageDeps {
	/** Ouvre l'écran d'usage avec la dernière lecture connue ; `onData` retient
	    ce qu'il lit pour le survol du bouton. */
	open(opts: { provider: string; usage: AiUsage | null; known: PlanUsage | null; onData: (data: PlanUsage) => void }): Promise<void>;
	/** Journalise une génération. Ne doit jamais faire échouer la génération
	    qui, elle, a réussi. */
	record(entry: AiUsageEntry): Promise<void>;
	/** Relit le forfait du fournisseur qui vient de répondre. */
	fetchPlan(usage: AiUsage): Promise<PlanUsage>;
	/** Le forfait Claude connu localement (badge de Fable dans le menu). */
	claudePlan(): aiProviders.ClaudePlanHint;
}

/** Ce que la page « Générer » demande à son hôte, et rien de plus. Plus de
    `DashboardCtx` ni de `plugin` (tâche 6 de la tranche 5) : l'application
    construit ce littéral sans greffon (`apps/windows/src/ui/dashboard-shell.ts`),
    le greffon le construit dans `src/dashboard.ts`. */
export interface AiPageDeps {
	settings: AiSettingsHost;
	/** Pour indexer la note où le quiz vient d'être inséré, puis ouvrir sa page. */
	scanner: Scanner;
	statsStore: StatsStore;
	navigate(view: DashboardViewName, data?: NavigateData): void;
	/** The upcoming exams of every folder, for the "/exam" menu. Absent: an empty menu. */
	upcomingExams?(): ExamCible[];
	/** Opens the Settings on the "/exam" prompt (the pencil of its tile). Absent: no pencil. */
	openExamPromptSettings?(): void;
	/** Opens the page of the folder where generated quizzes are written ("Generated quizzes"
	    of the sidebar). Absent: no such entry. */
	openGenerated?(): void;
	/** Les notes OUVERTES dans l'hôte (onglets Obsidian), en tête des deux
	    pickers de notes. Absent = aucune : l'application n'a pas d'onglets. */
	openFiles?(): HostFile[];
	usage?: AiUsageDeps;
	/**
	 * Les dossiers où la page peut écrire le quiz généré, en plus du dossier
	 * par défaut (`<racine par défaut>/<aiOutputFolder>`, toujours proposé en
	 * premier). Absente = pas de section « Destination » dans le popover des
	 * options, et la génération écrit là où elle a toujours écrit : c'est le
	 * cas du GREFFON, qui n'a qu'un vault ouvert et donc aucun choix à offrir.
	 *
	 * `path` est un chemin du CONTRAT complet (« Efrei/…/XTI301 »), le seul
	 * que `fs.write` accepte ; c'est l'hôte qui le connaît, pas cette page.
	 *
	 * `icon`, `color`, `root` : l'apparence de la carte du dossier et le nom
	 * de sa racine, pour que deux dossiers homonymes se distinguent.
	 */
	quizFolders?(): { path: string; name: string; icon: string; color: string; root: string }[];
	/** Rend un BLOC de code (commande d'installation d'un CLI) dans `host`.
	    Sous Obsidian, le moteur Markdown de l'app : coloration Prism, style de
	    bloc de l'utilisateur, bouton « copier » du post-processeur natif.
	    Absent, la page pose un `<pre><code>` nu — le texte est le même. */
	renderCodeBlock?(host: HTMLElement, code: string, lang: string): void;
	/** Le presse-papiers par l'hôte (le modal d'installation copie une
	    commande) ; dans la fenêtre de l'app, `navigator.clipboard` est refusé. */
	copyText?(texte: string): Promise<boolean>;
}

/** Handlers de la vue « Générer » — retour de createAiHandlers(deps). */
export interface AiHandlers {
	render(container: HTMLElement): Promise<void>;
	openAddFiles(): void;
	/** Rend ce que la page tient au système à la fermeture de la vue :
	    observateur de taille, écoute « focus fenêtre », page du quiz généré,
	    et URL d'objet des images encore en mémoire. Sans lui, chaque
	    ouverture/fermeture du dashboard en laissait une série derrière elle. */
	dispose(): void;
	/** « Créer avec l'IA » depuis un dossier : règle la destination et joint
	    les sources AVANT le prochain `render`. Appelé par l'hôte à la
	    navigation (`NavigateData.aiPreset`), jamais par la page elle-même. */
	preset(p: AiPreset): void;
}

export function createAiHandlers(deps: AiPageDeps): AiHandlers {
	const host = currentHost();
	/* Lus À CHAQUE usage, jamais copiés : une génération lit le fournisseur,
	   le modèle et l'effort au moment où elle part. */
	const settings = () => deps.settings.get();
	const saveSettings = (patch: Parameters<AiSettingsHost["save"]>[0]) => deps.settings.save(patch);
	/* The greeting picked for the welcome hero. The page re-renders often
	   (provider change, attachment, settings), and a greeting redrawn on
	   each would flicker under the user's eyes: it is kept until the part of
	   the day changes, the hero comes back after a request, or the page is
	   entered again (`entrer`). */
	let greeting: { slot: GreetingSlot; key: TransKey } | null = null;
	let heroShown = false;
	let composerText = "";
	/* Caret du composer, préservé à travers les render() : render détruit et
	   recrée le textarea, et sans ça tout attachement (chip, image, mention)
	   renvoie le curseur en fin de texte. */
	let composerCaret: number | null = null;
	// Sources texte attachées (PLUSIEURS — maquette 2026-07-11 231626) :
	// notes du vault (path) et fichiers texte du disque (.md/.txt).
	let noteAttachments: NoteAttachment[] = []; // [{ name, content, path? }]
	/** `null` : « Auto », le nombre suit la source (spec §2). */
	let questionCount: number | null = null;
	/** The TYPE of quiz to generate: a Learn to learn, or a Test to train
	    (`"practice"`, the format's name for a Test file). How a Test is taken
	    (hints, time limit, Exam mode) is chosen when it starts, never here.
	    Holds for the page session, like the count and the type. */
	let modeGeneration: ModeGeneration = "learn";
	/** The request waiting for its kind (spec 2026-10-07-generate-auto-kind):
	    shown at the end of the thread with a status line while the decide call
	    runs. */
	let attenteGenre: { text: string; documents: { name: string; path?: string }[] } | null = null;
	/** The clarifying questions asked and not answered yet, by request id: what the click
	    needs to generate (the documents' text is only in memory). A question
	    read back from an earlier session has no entry: it cannot be answered. */
	const questionsEnAttente = new Map<string, { envoi: DemandeTexte; genre: KindChoice; oneQuiz: boolean }>();
	/** The exam picked in the "/exam" menu: the next send is a whole
	    preparation for it (`exam-command.ts`). Cleared once sent. */
	let examCible: ExamCible | null = null;
	/** The destination was set by the exam (its course folder): giving up
	    the exam gives it back to the default folder. */
	let destinationParExam = false;
	/* "N quizzes <-> 1 quiz" (spec 2026-09-29 §4.3): `true` = ONE quiz over all
	   the attached documents, `false` = one quiz per document. Only offered
	   with at least two documents and no image (`decouperParFichier` keeps a
	   single quiz otherwise). The default is N quizzes, in Learn and in Test
	   alike, and is reset each time the type changes and each time the
	   composer is emptied. */
	let oneQuiz = false;
	let oneQuizBtn: HTMLElement | null = null;
	const paintOneQuiz = (): void => {
		if (!oneQuizBtn?.isConnected) return;
		oneQuizBtn.setAttribute("aria-pressed", String(oneQuiz));
		oneQuizBtn.classList.toggle("is-on", oneQuiz);
	};
	/** The checked question types (canonical values); `null` = untouched, i.e.
	    the default of the current mode (`effectiveTypes`). */
	let questionTypes: string[] | null = null;
	/* Destination du quiz généré : un chemin du CONTRAT, ou "" pour le dossier
	   par défaut. Le CHOIX fait dans les options ou les suggestions est
	   persisté (`aiComposerDestination`) et relu à chaque arrivée sur la page
	   (`entrer`) ; un préréglage ou une destination d'examen ne l'est pas. */
	let destination = "";
	/* La destination vient d'un PRÉRÉGLAGE (« Créer avec l'IA » depuis un
	   dossier) et non d'un choix dans les options : l'envoi la vide avec le
	   reste du composer (spec de la file, 2026-09-26). */
	let destinationDuPreset = false;
	/** Repaints the output-folder row of the composer, set at each render. */
	let paintDestination: (() => void) | null = null;
	/** The chat the destination picker was already offered for on arrival
	    (spec 2026-10-07): it opens once per arrival and per new chat, never
	    again while the user types in the same chat. `entrer` clears it. */
	let dossierProposePour: string | null = null;
	/** The row of folder suggestions under the composer, and its debounce. */
	let suggestionsEl: HTMLElement | null = null;
	let suggestionsTimer = 0;
	/* La CATÉGORIE du quiz (retour #7, 2026-09-26) : `null` = Automatique,
	   déduite à l'envoi des pièces jointes, du dossier et de la demande
	   (categorie-quiz.ts) ; sinon celle choisie dans les options. Comme le
	   nombre et le type, elle vaut pour la session de la page. */
	let categorieChoix: CategorieQuiz | null = null;
	/** L'avis « Python détecté » près du bouton des options. */
	let avisCategorieEl: HTMLElement | null = null;
	/* La file de génération de l'APPLICATION, partagée par toutes les pages :
	   la page s'y abonne pour peindre ses lignes, elle ne la possède pas. */
	const fileGen: FileGenerationApp = fileDeGeneration({
		settings: deps.settings,
		scanner: deps.scanner,
		recordUsage: deps.usage ? (entry) => deps.usage!.record(entry) : undefined,
	});
	// Every conversation is saved as it goes, for the sidebar's list of chats.
	suivreConversations(fileGen);
	/** The chat on screen as the thread shows it: recorded requests + live lines. */
	const chatSurEcran = () => {
		const id = activeChatId();
		return { id, record: getChats().find(c => c.id === id) ?? null };
	};
	const filDuChat = () => { const c = chatSurEcran(); return threadItems(c.record, fileGen.lignes(), c.id, getRemoteGenerations()); };
	const chatAContenu = (): boolean => filDuChat().length > 0 || attenteGenre !== null;
	const vueFile = creerVueFile({
		file: fileGen,
		ouvrir: (chemin) => {
			const quiz = deps.scanner.getQuiz(chemin);
			if (quiz) deps.navigate("detail", { quiz, entree: "generation" });
			else host.ui.notice(t("ai.queue.missing"));
		},
		ouvrirSansEnregistrer: (l) => ouvrirSansEnregistrer(l),
		copier: deps.copyText,
		chat: chatSurEcran,
		attente: () => attenteGenre,
		repondre: (id, reponses) => repondreQuestions(id, reponses),
		reprenable: (id) => reprenable(id),
	});

	/* ── La page en CONVERSATION (`conversation-mode.ts`) : elle suit la
	   file, passe en conversation au premier envoi et en sort quand la liste
	   se vide ; entre-temps, seuls le bouton d'envoi (■ pendant une
	   génération) et « Nouvelle demande » bougent. ── */
	let modeConversation = false;
	let majNouvelle: () => void = () => {};
	const desabonnerPage = fileGen.abonner(() => {
		if (!stageRef || !stageRef.isConnected) return;
		if ((phase === "idle" || phase === "error") && chatAContenu() !== modeConversation) { void render(containerRef); return; }
		updateGenerateBtn(boutonEnvoi);
		majNouvelle();
	}, () => !!stageRef?.isConnected);
	/* Switching or starting a chat: the page follows (conversation <-> home). */
	const desabonnerChats = onChatsChanged(() => {
		if (!stageRef || !stageRef.isConnected) return;
		if ((phase === "idle" || phase === "error") && chatAContenu() !== modeConversation) { void render(containerRef); return; }
		updateGenerateBtn(boutonEnvoi);
		majNouvelle();
	});

	/** « Ouvrir sans enregistrer » : le quiz d'une ligne dont seule la note a
	    échoué s'affiche dans la page résultat (la même que pour un site), avec
	    son bouton Enregistrer et « Insérer dans une note ». La ligne reste dans
	    la file tant que la note n'est pas écrite : quitter la page ne perd rien. */
	function ouvrirSansEnregistrer(l: LigneGeneration): void {
		const p = l.demande.produit;
		if (!p) return;
		// Une attente de site ou de connexion tient la page : ne pas l'écraser.
		if (phase === "web" || phase === "connexion") { host.ui.notice(t("ai.queue.busy")); return; }
		dropSentMessage();
		/* ONE PASS: the line holds one quiz per document; the first one not
		   written yet opens, alone, with its own document. */
		const restant = p.lot?.find(q => !(p.faits ?? []).some(f => f.document === q.document));
		const indice = restant && p.lot ? p.lot.indexOf(restant) : -1;
		const notes = restant ? l.demande.notes.filter(n => n.name === restant.document) : l.demande.notes;
		sentMessage = { text: l.demande.text, notes, images: [] };
		generatedQuestions = restant ? restant.questions : p.questions;
		generatedTitre = restant ? restant.titre : p.titre;
		lastUsage = p.usage;
		planTranchesEnvoye = restant ? p.liens?.[indice]?.plan : p.planTranches;
		noteLearnLiee = restant ? p.liens?.[indice]?.note : p.noteLearn;
		resultatFige = { mode: l.demande.mode, destination: l.demande.destination, reglages: l.demande.reglages, ligne: l.id };
		generationId++;
		generatedDraft = null;
		phase = "result";
		void render(containerRef);
	}
	/* Les sources qu'un préréglage demande de joindre, consommées par le
	   PREMIER `render` qui suit : joindre exige un composer rendu (les chips
	   et la vignette d'une image y vivent), et `preset` est appelé avant. */
	let aJoindre: string[] = [];
	/* Lancer la génération dès que les sources du préréglage sont jointes
	   (composer du Planning, tâche 5) : posé par `preset`, consommé et remis
	   à `false` par le même `render` qui joint `aJoindre`. */
	let lancerApresJointes = false;

	function preset(p: AiPreset): void {
		/* Un résultat affiché ou une erreur sont balayés par un clic sur
		   « Créer avec l'IA » depuis un dossier : on repart d'un composer vide,
		   comme le fait `resetGeneration` quand un quiz généré est enregistré.
		   Les générations de la FILE, elles, continuent : elles ne tiennent
		   plus le composer. */
		epochPreset++;
		if (phase !== "idle") resetGeneration();
		/* Les pièces du dossier REMPLACENT celles du composer : arriver depuis
		   XTI302 avec les fichiers d'XTI301 encore joints (préréglage
		   précédent, jamais envoyé) mêlait deux cours dans une génération
		   écrite dans un seul dossier (vu le 2026-09-24). Le texte tapé, lui,
		   reste : c'est une consigne, pas une source. */
		for (const img of images) URL.revokeObjectURL(img.url);
		images = [];
		noteAttachments = [];
		destination = p.destination;
		destinationDuPreset = true;
		aJoindre = [...p.attach];
		// Un texte du préréglage REMPLACE celui du composer : c'est la demande
		// tapée dans le dossier, pas une consigne à empiler sur un reste.
		if (p.prompt && p.prompt.trim()) composerText = p.prompt;
		lancerApresJointes = !!p.lancer;
	}
	let images: ComposerImage[] = [];
	/* ── Les vidéos YouTube (spec « Vidéos YouTube » § 3.4 et § 5) ──
	   Une tuile par lien YouTube du composer ; le module tient son état à
	   travers les rendus (il ne naît qu'une fois par page), est INERTE sans
	   `host.video` (le greffon), et son `rerendre` ne redessine que SES
	   zones : une tuile qui arrive ou se règle ne doit ni détruire le champ
	   (le caret y vit) ni fermer un menu ouvert. */
	let zoneVideo: HTMLElement | null = null;
	let zoneNoticeVideo: HTMLElement | null = null;
	const retuiler = (): void => {
		if (zoneVideo?.isConnected) tuilesVideo?.rendre(zoneVideo);
		if (zoneNoticeVideo?.isConnected) tuilesVideo?.rendreNotice(zoneNoticeVideo);
	};
	const tuilesVideo: TuilesVideo = creerTuilesVideo({ host, rerendre: retuiler, ouvrirApercu });
	// Ref du dernier render : cible du raccourci Ctrl+E (openAddFiles).
	let fileInputRef: HTMLInputElement | null = null;
	// Écouteur du raccourci « Ajouter des fichiers », posé sur le conteneur
	// de la page à chaque render (cf. plus bas) et retiré ici comme dans
	// `dispose` avant d'en reposer un nouveau — jamais deux à la fois.
	let raccourciComposer: { retirer(): void } | null = null;
	/* Le composer ACTIF (contour accent) : posé par un clic ou un focus
	   DEDANS, retiré par un clic ou un focus AILLEURS dans la page — et par
	   rien d'autre (Ahmed, 2026-09-19). `:focus-within` ne suffisait pas : le
	   focus quitte le composer dès qu'un de ses boutons ouvre un menu (portalé
	   au <body>), et le contour changeait au clic. Une variable et non la seule
	   classe : `render` recrée le composer. */
	let composerActif = false;
	let veilleComposerActif: { retirer(): void } | null = null;
	/* Depuis quand la zone des pièces jointes est-elle ouverte ? Son contenu
	   ne descend en fondu (claude.ai : `translateY(-8px)`, 0,2 s) qu'à
	   l'OUVERTURE — rejoué seulement par un rendu qui tombe PENDANT ces
	   0,2 s (cf. `effetEnCours`, composer-attachments.ts). */
	let zonePieces: object | null = null;
	const debutsZonePieces = new WeakMap<object, number>();
	// Listener « focus fenêtre » du re-check des statuts CLI (remplacé à
	// chaque render, retiré quand la zone de hint disparaît).
	let __focusRecheck: (() => void) | null = null;
	/** Sondage « le serveur Ollama a-t-il démarré ? ». Retenu ici pour être
	    annulable : sans ça il continuait de tourner (et de redessiner la page)
	    après la fermeture de la vue. */
	let ollamaPoll: number | null = null;
	/** L'outil que l'échec courant demande de connecter (`besoinConnexion` de
	    `ai-client.ts`), ou `null` quand l'erreur est d'une autre nature. C'est
	    lui qui décide du bouton de la carte d'erreur. */
	let errorLogin: OutilCompte | null = null;
	/* L'attente d'une réponse copiée (canal web, spec 2026-09-18). Non nulle
	   en phase « web » seulement : le jeton de CETTE ouverture, ce qui a été
	   ouvert (adresse ou presse-papier), la fonction qui arrête la veille du
	   principal (null sous un hôte sans `collage`), et les écouteurs à retirer. */
	/** `depose` : les fichiers ont été relâchés hors de l'application, sur le site. */
	let attenteWeb: { jeton: string; ouverture: ResultatOuverture; site: string; aGlisser: TuileDepot[]; arreter: (() => void) | null; retirer: () => void; depose?: boolean } | null = null;
	/** Le site de la dernière ouverture, gardé au-delà de `attenteWeb` (remis à
	    null avant l'écran d'erreur) : c'est lui que « Rouvrir {site} » affiche. */
	let attenteWebSite = "";
	/** Le corps de la modale d'attente ouverte, pour la redessiner en « reçu ». */
	let webModalCorps: HTMLElement | null = null;
	/* La carte d'attente du canal web vit dans une MODALE centrée depuis le
	   2026-09-19 (demande d'Ahmed : la carte pleine largeur au-dessus du
	   composer prenait trop de place). La fermer — Échap, le fond, la croix —
	   c'est annuler l'attente. `webModalFermetureInterne` distingue une
	   fermeture demandée par la page (réponse reçue, annulation déjà faite)
	   d'une fermeture par l'utilisateur, la seule qui doive annuler. */
	let webModal: HostModalHandle | null = null;
	let webModalFermetureInterne = false;
	/* L'attente de CONNEXION vit elle aussi dans une modale centrée (Ahmed,
	   2026-09-19 : « c'est plus propre »), même patron que `webModal` : la
	   fermer, c'est annuler. `loginModalCorps` est redessiné à chaque
	   `render`, pour que la coche remplace le spinner sans rouvrir. */
	/**
	 * UNE MODALE PAR PHASE, même mécanique pour toutes (Ahmed, 2026-09-19 :
	 * « tout ce qui peut apparaître au-dessus de l'invite doit devenir une
	 * modale centrée ») : ouverte tant que sa phase est active, son corps
	 * redessiné à chaque `render`, fermée par la page dès qu'on sort de la
	 * phase — et, fermée par l'UTILISATEUR (Échap, fond, croix), elle appelle
	 * `annuler`. `interne` distingue les deux fermetures.
	 */
	function creerModalePhase(spec: { phase: Phase; className: string; rendre: (corps: HTMLElement) => void; annuler: () => void }): () => void {
		let modale: HostModalHandle | null = null;
		let corps: HTMLElement | null = null;
		let interne = false;
		return () => {
			if (phase === spec.phase) {
				if (!modale) {
					modale = requireHost("modals").open({
						className: spec.className,
						onOpen: (m) => { corps = m.contentEl; poserCroixAnnuler(m); },
						onClose: () => {
							modale = null;
							corps = null;
							const parLaPage = interne;
							interne = false;
							if (!parLaPage && phase === spec.phase) spec.annuler();
						},
					});
				}
				if (corps) { corps.replaceChildren(); spec.rendre(corps); }
			} else if (modale) {
				interne = true;
				modale.close();
			}
		};
	}
	/** L'action de l'écran d'erreur : « Rouvrir <site> » quand la réponse
	    copiée n'était pas un quiz (réessayer relancerait une génération que
	    l'application n'a jamais faite) ; « upgrade » quand Ollama a répondu
	    402 (modèle hors plan) — réessayer rendrait la même erreur. */
	let errorAction: "reopen" | "upgrade" | null = null;
	/** L'abonnement à « la fenêtre du terminal est posée » (l'instant où la
	    modale d'attente remonte), retiré dès qu'il a servi, à l'annulation ou
	    à un lancement qui échoue. */
	let desabonnerPose: (() => void) | null = null;
	/** Et à « le navigateur de la connexion s'est ouvert » (les deux colonnes). */
	let desabonnerNav: (() => void) | null = null;
	/** Sondage « le compte est-il connecté ? », pour la même raison que
	    `ollamaPoll` : sans être retenu, il survivrait à la fermeture de la vue
	    et repeindrait un conteneur détaché. Coupé à la détection, à
	    l'annulation et au démontage. */
	let loginPoll: number | null = null;
	/** Le délai d'une seconde entre « compte détecté » et la relance, retenu
	    pour la même raison : sans lui, fermer la vue pendant ce battement
	    relancerait une génération dans une page qui n'existe plus. */
	let loginTimer: number | null = null;
	/** La sonde vient de voir le compte connecté : la carte d'attente passe à
	    la coche, et la relance suit une seconde plus tard. Une VARIABLE et non
	    une écriture directe dans le DOM — un re-render (redimensionnement,
	    changement de réglage) effacerait la coche sans elle. */
	let connexionVue = false;
	/** D'où la carte d'attente a été ouverte : depuis la carte d'ERREUR (retour
	    à `error` si on annule) ou depuis le HINT sous le composer (retour à
	    `idle` : il n'y a pas d'erreur à remontrer, la demande n'est jamais
	    partie). */
	let connexionOrigine: "erreur" | "hint" = "erreur";
	/** L'adresse de connexion rendue par `/api/me` d'Ollama (401), à ouvrir
	    dans le navigateur au clic sur « Se connecter ». `null` = inconnue. */
	let ollamaSigninUrl: string | null = null;
	/** Un seul passage de sonde de plan (zéro token) à la fois : un compte
	    gratuit n'a qu'une requête simultanée sur le démon, et deux `render()`
	    qui se chevauchent (composer redessiné pendant que la sonde tourne) ne
	    doivent pas relancer une boucle sur les mêmes tags. */
	let sondePlansEnCours = false;
	/** L'heure du dernier rafraîchissement du catalogue cloud (ollama.com), et
	    le TTL qui espace les requêtes : une par session de page, puis une par
	    tranche de six heures pour une fenêtre qu'on laisse ouverte des jours.
	    En MÉMOIRE et non dans les réglages : au lancement le menu part du
	    cache persistant (`aiOllamaCatalog`), la requête ne fait que le mettre
	    à jour, et un horodatage persisté n'aurait servi qu'à ÉVITER cette
	    unique requête — pas un réglage pour ça. */
	let catalogueOllamaRafraichiA = 0;
	const CATALOGUE_OLLAMA_TTL = 6 * 60 * 60 * 1000;
	/** Tags choisis EXPLICITEMENT depuis « Plus de modèles » dans CETTE session
	    de page : le repli automatique d'un modèle courant devenu payant (voir
	    `sonderPlansOllama`) ne doit jamais défaire un choix que l'utilisateur
	    vient de faire lui-même. */
	/** La vue a été fermée : plus rien ne doit repeindre ni démarrer. */
	let disposed = false;
	// ResizeObserver de la carte composer (mesure du text-indent des chips) :
	// déconnecté et recréé à chaque render (composer recréé) — cf. layoutChipsRow.
	let composerResizeObserver: ResizeObserver | null = null;
	/* Le bouton d'envoi du DERNIER rendu : une lecture de PDF qui finit, ou la
	   file qui change, le remet à jour sans redessiner la page. */
	let boutonEnvoi: HTMLButtonElement | null = null;
	let phase: Phase = "idle";
	/* Demande PARTIE vers un site. Non nulle dès l'envoi, remise à null quand
	   la demande est rendue au composer (annulation) ou qu'on recommence. Le
	   signal du rail (`qbd-generating`) est posé par la file, pas ici. */
	let sentMessage: SentMessage | null = null;
	/* UN QUIZ PAR FICHIER JOINT (2026-09-23), sur le canal web : `lot` dit où
	   en est l'envoi (« 2 sur 3 ») ; null hors lot. Sur un CLI, chaque
	   fichier devient une ligne de la file. */
	let lot: { index: number; total: number; nom: string } | null = null;
	/* Canal web : les fichiers qui attendent leur tour. Le site s'ouvre pour
	   le suivant dès que la réponse du précédent est enregistrée ; la page
	   du PREMIER quiz s'ouvre à la fin. */
	let lotWebRestant: SentMessage[] = [];
	let lotWebPremier: (() => void) | null = null;
	/** La demande partie sur le site en ce moment (un fichier du lot, ou
	    l'envoi entier) : c'est elle qui nomme la note reçue. */
	let demandeWeb: SentMessage | null = null;
	/** One pass on a site: the Learn each document follows (same order). */
	let lotWebLiens: ({ plan?: { slice: number; titre: string }[]; note?: string } | undefined)[] | undefined;
	/** Oublie le lot web : plus de fichier en attente, plus de progression. */
	function oublierLotWeb(): void {
		lotWebRestant = [];
		lotWebPremier = null;
		demandeWeb = null;
		lot = null;
	}
	/* Page « quiz » de la zone résultat — la MÊME que celle d'un quiz du
	   vault. Créée à la première génération, réutilisée ensuite : elle garde
	   son état (question courante, mode) tant que la clé ne change pas.
	   generationId invalide le brouillon à chaque nouvelle génération. */
	let resultPage: QuizPageHandlers | null = null;
	/** Brouillon éditable du quiz généré, lié à SA génération. */
	let generatedDraft: { genId: number; draft: QuizDraft } | null = null;
	let generationId = 0;
	let generatedQuestions: unknown[] = [];
	/** Le titre que le modèle a donné au quiz (`ReponseQuiz.titre`) ; c'est
	    le nom du fichier quand il existe, la demande sinon. */
	let generatedTitre: string | undefined;
	/* Le plan des tranches ENVOYÉ avec la demande Practice, relu à
	   l'enregistrement pour vérifier les `slice` produits (spec §2). */
	let planTranchesEnvoye: { slice: number; titre: string }[] | undefined;
	/* Le nom de la note Learn dont ce plan vient : le lien `learn: "[[…]]"`
	   du Practice enregistré. */
	let noteLearnLiee: string | undefined;
	/* Le quiz affiché en page résultat vient d'une ligne de la FILE dont
	   l'enregistrement a échoué (« Ouvrir sans enregistrer ») : son mode, sa
	   destination et ses réglages figés à l'envoi, et la ligne à fermer une
	   fois la note écrite. `null` pour le canal web. */
	let resultatFige: { mode: ModeGeneration; destination: string; reglages: ReglagesFiges; ligne: number } | null = null;
	/* La réponse copiée VIENT D'ARRIVER : la modale d'attente le dit sur
	   place (coche, « Réponse reçue », le nom du quiz) pendant que le quiz
	   s'enregistre, avant de se fermer sur sa page. Sans cet état, la page
	   du quiz remplaçait la modale dans la même image (Ahmed, 2026-09-19). */
	let reponseRecue: { titre?: string } | null = null;
	let errorMessage = "";
	let containerRef: HTMLElement | null = null;
	/* La SCÈNE posée par le dernier `render` dans `containerRef`. Le conteneur,
	   lui, est celui de la coquille : il reste dans le document quand elle y
	   peint une AUTRE vue, et `containerRef.isConnected` ne dit donc jamais si
	   « Générer » est à l'écran. La scène, si : la coquille la détache en
	   peignant ailleurs. `null` = la prochaine peinture est une vraie entrée. */
	let stageRef: HTMLElement | null = null;
	/* Incrémentée à chaque préréglage : la jonction en arrière-plan d'un
	   préréglage s'arrête dès qu'un autre est posé, pour que deux dossiers ne
	   mêlent pas leurs pièces dans un même composer. */
	let epochPreset = 0;
	/* Ce que la DERNIÈRE génération affichée a consommé — null quand le
	   fournisseur ne publie aucun compteur (et toujours sur un site). */
	let lastUsage: AiUsage | null = null;
	/* Dernier état de forfait CONNU — sert au seul survol du bouton d'usage :
	   passer la souris ne déclenche jamais de lecture réseau, c'est le modal
	   qui va chercher des chiffres frais quand on l'ouvre. */
	let lastPlan: PlanUsage | null = null;

	// Le type de questions a DEUX faces, à ne jamais confondre : une VALEUR
	// canonique, envoyée telle quelle au modèle (ai-client la compare à
	// « Mixte »/« Choix unique »… pour construire le prompt), et un LIBELLÉ
	// traduit, seul affiché. Traduire la valeur casserait la génération dès que
	// l'UI passe en anglais. Les deux listes restent parallèles (même ordre).
	const TYPE_VALUES = ["Mixte", "Choix unique", "Choix multiple", "Texte libre", "Réponse numérique", "Texte à trous", "Classement", "Association", "Sortie de code", "Compréhension"];
	const TYPE_KEYS: TransKey[] = ["ai.type.mixed", "ai.type.single", "ai.type.multiple", "ai.type.text", "ai.type.numeric", "ai.type.cloze", "ai.type.ordering", "ai.type.matching", "ai.type.codeOutput", "ai.type.comprehension"];
	/** What an untouched selection means: a Test is a written MCQ, a Learn
	    lets its roles pick the types. Choosing Auto explicitly is Auto in both. */
	const effectiveTypes = (kind: ModeGeneration = modeGeneration): string[] => questionTypes ?? (kind === "learn" ? [TYPE_VALUES[0]] : [TYPE_VALUES[1], TYPE_VALUES[2]]);
	/** The grey value of the Type row and of the options tip. */
	const typesResume = (values: string[]): string => {
		const v = values.length ? values : [TYPE_VALUES[0]];
		if (v.length === 1) return v[0] === TYPE_VALUES[0] ? t("ai.options.auto") : typeLabel(v[0]);
		if (v.length === 2 && v.includes(TYPE_VALUES[1]) && v.includes(TYPE_VALUES[2])) return t("ai.type.mcq");
		return t("ai.type.count", { count: v.length });
	};
	// Libellés recalculés à chaque usage (menu, tooltip) : jamais figés dans la
	// langue du chargement.
	const typeLabels = (): string[] => TYPE_KEYS.map(k => t(k));
	const typeLabel = (value: string): string => {
		const i = TYPE_VALUES.indexOf(value);
		return i < 0 ? value : t(TYPE_KEYS[i]);
	};
	const typeValue = (label: string): string => {
		const i = typeLabels().indexOf(label);
		return i < 0 ? TYPE_VALUES[0] : TYPE_VALUES[i];
	};

	/** The window of the exam's documents (`exam-documents.ts`): a click
	    joins one, as "@CM1.pdf" would. */
	function choisirDocumentsExam(exam: ExamCible): void {
		ouvrirDocumentsExam({
			examen: exam.nom,
			dossier: exam.dossier,
			racine: exam.racine,
			nomDossier: exam.module,
			/* The quizzes of a preparation go to the exam's course folder, not
			   to "Generated": the destination follows the exam. */
			onDossier: (chemin) => {
				exam.dossier = chemin;
				if (examCible !== exam || destination === chemin) return;
				destination = chemin;
				destinationDuPreset = false;
				destinationParExam = true;
				void render(containerRef);
			},
			estQuiz: (p) => !!deps.scanner.getQuiz(p),
			joints: () => noteAttachments.map(n => n.path).filter((p): p is string => !!p),
			joindre: (p) => attachVaultPath(p),
		});
	}

	function canGenerate(): boolean {
		/* Une demande EN VOL sur un site, ou une attente de connexion, ne
		   repart pas : le composer la montre encore, et le clic comme Entrée
		   passent par ici. Une génération de la FILE ne bloque rien : le
		   composer est libre dès l'envoi. */
		if (phase === "web" || phase === "connexion") return false;
		const providerId = settings().aiProvider || "";
		if (!providerId) return false;
		// Un fournisseur desktop-only (Claude Code CLI) est inutilisable sur
		// mobile : on bloque l'envoi à la source (le bouton d'envoi lit
		// canGenerate) plutôt que de laisser l'utilisateur envoyer un prompt
		// qui échouera — sinon composer « cassé ». Le hint « desktop
		// uniquement » explique déjà pourquoi.
		const provider = aiProviders.getProvider(providerId);
		if (provider && provider.desktopOnly && host.platform.isMobile) return false;
		/* Un document encore EN LECTURE (ou dont la lecture a échoué) : son
		   texte n'est pas là, rien ne part sans lui. */
		if (noteAttachments.some(n => n.lecture)) return false;
		return !!(composerText.trim() || images.length > 0 || noteAttachments.length > 0 || examCible);
	}

	/* Les cartes de pièces jointes et la lecture immédiate d'un PDF
	   (`composer-attachments.ts`). */
	const pieces = creerPiecesJointes({
		notes: () => noteAttachments,
		rendre: () => { void render(containerRef); },
		majEnvoi: () => updateGenerateBtn(boutonEnvoi),
	});
	const joindrePdf = pieces.joindrePdf;

	/** Le contenu d'une carte d'IMAGE : la photo remplit la carte, recadrée
	    (référence claude.ai : une image jointe est un carré plein, sa forme
	    n'est pas une information comme l'est celle d'une page). */
	function poserCarteImage(chip: HTMLElement, image: ComposerImage): void {
		/* Déjà prête (le fichier est local) : la vignette finale d'emblée,
		   avec la montée et le fondu flou → net de claude.ai, une fois. */
		chip.classList.add("qbd-ai-note-chip--prete", "qbd-ai-note-chip--thumb", "qbd-ai-note-chip--image");
		chip.title = image.file.name;
		entrerVignette(chip, image);
		poserImage(chip, image, image.url, image.file.name);
		/* Le clic OUVRE L'APERÇU, comme la carte d'un document ; la croix de
		   retrait garde son rôle. */
		chip.classList.add("qbd-ai-note-chip--toggle");
		chip.addEventListener("click", (e) => {
			if ((e.target as HTMLElement).closest(".qbd-ai-note-chip-remove")) return;
			ouvrirApercuImage(image);
		});
	}

	/** L'aperçu d'une image jointe : l'image entière, à sa taille, bornée par
	    la fenêtre ; le nom en titre. */
	function ouvrirApercuImage(image: ComposerImage): void {
		requireHost("modals").open({
			className: "qbd-ai-preview-modal qbd-ai-preview-modal--image",
			title: image.file.name,
			onOpen: (m) => {
				const img = ajouter(m.contentEl, "img", "qbd-ai-preview-image");
				img.src = image.url;
				img.alt = image.file.name;
				img.draggable = false;
			},
		});
	}

	/** L'aperçu d'une pièce jointe, dans une modale (référence claude.ai,
	    Ahmed 2026-09-17).
	    - Une NOTE : la ligne de métadonnées (poids, lignes, chemin), puis la
	      note RENDUE — titres, listes, encadrés — par `renderMarkdownPreview`.
	    - Un PDF : sa première page en pile de feuilles, « N pages » dessous,
	      et au survol « Ouvrir », qui l'ouvre dans l'application par défaut du
	      système. Une seule page dessinée, à l'ouverture : c'est une vitrine,
	      pas un lecteur — l'application par défaut est le lecteur. */
	function ouvrirApercu(note: NoteAttachment): void {
		const estPdf = !!note.bytes;
		requireHost("modals").open({
			className: "qbd-ai-preview-modal" + (estPdf ? " qbd-ai-preview-modal--pdf" : ""),
			title: note.name,
			onOpen: (m) => {
				const c = m.contentEl;
				if (estPdf) { poserApercuPdf(c, note); return; }

				const meta = ajouter(c, "div", "qbd-ai-preview-meta");
				const octets = new TextEncoder().encode(note.content).length;
				const ko = new Intl.NumberFormat(currentLang(), { maximumFractionDigits: 2 }).format(octets / 1024);
				const puce = () => ajouter(meta, "span", "qbd-ai-preview-meta-sep", "•");
				ajouter(meta, "span", undefined, t("ai.preview.size", { kb: ko }));
				puce();
				const lignes = note.content.split(/\r?\n/).length;
				ajouter(meta, "span", undefined, t(lignes === 1 ? "ai.preview.linesOne" : "ai.preview.linesOther", { n: lignes }));
				if (note.path) { puce(); ajouter(meta, "span", "qbd-ai-preview-meta-path", note.path).title = note.path; }

				/* UNE NOTE SE VOIT RENDUE — titres, listes, encadrés, tableaux,
				   code, propriétés — par `renderMarkdownPreview`, qui n'écrit que
				   ses propres balises et passe tout le texte par la première porte
				   (`renderInlineText`). C'est le seul `innerHTML` de cette page, et
				   il ne reçoit jamais autre chose que cette sortie. Les formules
				   `$…$` gardées par l'inline sont posées ensuite par l'hôte. */
				const corps = ajouter(c, "div", "qbd-ai-preview-md markdown-preview-view");
				corps.innerHTML = renderMarkdownPreview(note.content);

				/* Les propriétés sont masquées par défaut ; ce bouton les montre.
				   L'état n'est pas persisté : c'est un aperçu. */
				const props = corps.querySelector<HTMLElement>(".mdp-frontmatter");
				if (props) {
					const btn = ajouter(meta, "button", "qbd-ai-preview-props");
					btn.type = "button";
					host.ui.setIcon(ajouter(btn, "span", "qbd-btn-icon qbd-btn-icon--sm"), "list");
					ajouter(btn, "span", undefined, t("ai.preview.props"));
					btn.setAttribute("aria-pressed", "false");
					btn.addEventListener("click", () => {
						props.hidden = !props.hidden;
						btn.setAttribute("aria-pressed", String(!props.hidden));
					});
				}
				poserIconesCallouts(corps);

				void mathifyElement(corps);
			},
		});
	}

	/* Les icônes des encadrés, posées APRÈS le rendu : le HTML pur ne sait pas
	   dessiner un Lucide ; `data-icon` vient de la table fixe du rendu
	   (`ICONES_CALLOUT` dans `markdown-preview.ts`). */
	function poserIconesCallouts(corps: HTMLElement): void {
		for (const el of Array.from(corps.querySelectorAll<HTMLElement>(".callout"))) {
			const icone = el.querySelector<HTMLElement>(".callout-icon");
			if (!icone) continue;
			icone.replaceChildren();
			host.ui.setIcon(icone, icone.dataset.icon || "pencil");
		}
	}

	/** Le PDF : la pile de feuilles (première page dessinée à 270 px), la
	    légende « N pages », et « Ouvrir » au survol. UN PDF SE VOIT DESSINÉ,
	    TOUJOURS (Ahmed : « ceci ne doit plus jamais arriver », à propos d'un
	    aperçu en texte) : si le dessin échoue, la modale le DIT et la console
	    nomme la cause — jamais du texte brut avec une excuse. */
	function poserApercuPdf(c: HTMLElement, note: NoteAttachment): void {
		const zone = ajouter(c, "div", "qbd-ai-preview-pdf");
		const pile = ajouter(zone, "div", "qbd-ai-preview-stack");
		const legende = ajouter(zone, "div", "qbd-ai-preview-caption");
		const pages = ajouter(legende, "span", "qbd-ai-preview-caption-pages", t("ai.preview.rendering"));

		/* « Ouvrir » : par le contrat (`shell.openExternal`). Un PDF venu d'une
		   racine externe ou du dialogue natif a un chemin ABSOLU que l'hôte a
		   admis ; un PDF déposé (`source: "file"`) n'en a pas et garde son
		   aperçu sans bouton — proposer une action qui échouerait vaudrait
		   moins que rien. */
		const fichier: HostFile | string | null = note.path
			? (note.source === "vault" ? host.fs.getFile(note.path) : note.source === "external" ? note.path : null)
			: null;
		if (fichier) {
			const ouvrir = ajouter(legende, "button", "qbd-ai-preview-open");
			ouvrir.type = "button";
			/* `square-arrow-out-up-right`, et non `external-link` : à 16 px, le cadre
			   ÉCHANCRÉ de celle-ci — un rectangle auquel il manque un coin, que la
			   flèche traverse — se lit comme un trait cassé. Le carré FERMÉ tient la
			   petite taille, et la flèche en sort par-dessus au lieu de le trouer.
			   Choisie par Ahmed sur planche, 2026-09-17. */
			host.ui.setIcon(ajouter(ouvrir, "span", "qbd-ai-preview-open-icon"), "square-arrow-out-up-right");
			ajouter(ouvrir, "span", undefined, t("ai.preview.open"));
			/* LA CIBLE EST LA ZONE ENTIÈRE, comme sur la référence (un `<a>` qui
			   enveloppe la page et sa légende) : c'est elle qui s'éventaille au
			   survol et qui montre « Ouvrir », donc c'est elle qui prend la main
			   du curseur et le clic. Une main sur une zone qui ne répond pas
			   serait un mensonge, et une cible de 60 px au milieu d'une page de
			   267 en serait un autre.
			   UN SEUL écouteur, et il est posé ici : le clic du bouton — souris
			   comme Entrée au clavier — BOUILLONNE jusqu'à la zone. En doubler
			   un sur le bouton ouvrirait le fichier deux fois. */
			zone.classList.add("is-openable");
			zone.addEventListener("click", () => {
				void host.shell.openExternal(fichier).then(ok => {
					if (!ok) host.ui.notice(t("ai.preview.openFailed", { name: note.name }));
				});
			});
		}

		const dessiner = host.pdf?.renderPages
			? host.pdf.renderPages(note.bytes as Uint8Array, { width: 270, max: 1 })
			: Promise.reject(new Error("renderPages absent"));
		void dessiner.then(({ pages: images, total }) => {
			if (!zone.isConnected) return;
			if (images[0]) {
				/* La feuille ENVELOPPE l'image : c'est elle qui porte les deux
				   feuilles de dessous (pseudo-éléments) et l'ombre. Sans cette
				   enveloppe, elles se calaient sur le CONTENEUR — une boîte de
				   taille fixe — et dépassaient d'une page portrait par le bas.
				   Là, elles suivent la page, quelle que soit sa forme. */
				const feuille = ajouter(pile, "div", "qbd-ai-preview-sheet");
				const img = ajouter(feuille, "img", "qbd-ai-preview-stack-page");
				img.src = images[0];
				img.alt = t("ai.preview.pageAlt", { n: 1 });
				img.draggable = false;
				pile.classList.add("is-ready");
			}
			pages.textContent = t(total === 1 ? "ai.preview.pagesOne" : "ai.preview.pagesOther", { n: total });
		}).catch((e) => {
			console.warn(LOG_PREFIX, "aperçu PDF impossible:", note.name, e);
			if (!zone.isConnected) return;
			pages.textContent = t("ai.preview.renderFailed");
		});
	}

	/* The SHELL's entry (and any host's): a real navigation to "Generate"
	   must paint, even if the previous stage was detached. A visit is also
	   what draws a new greeting, like each new chat on claude.ai. */
	function entrer(container: HTMLElement): Promise<void> {
		stageRef = null;
		heroShown = false;
		dossierProposePour = null;
		// Un préréglage (« Créer avec l'IA ») ou un dossier d'examen est posé AVANT
		// cette arrivée (`naviguer` appelle `preset` d'abord) : il l'emporte.
		if (!destinationDuPreset && !destinationParExam) destination = destinationMemoriseeCourante();
		return render(container);
	}

	async function render(container: HTMLElement | null): Promise<void> {
		if (!container) return;
		/* Repeint INTERNE (une pièce jointe lue en arrière-plan, une réponse,
		   un statut) alors que la coquille a peint une autre vue : ne pas
		   écraser cette vue. Seule `entrer` rouvre la page. */
		if (stageRef && !stageRef.isConnected) return;
		containerRef = container;
		closeAllSelects();
		// Tooltips portalés au <body> (stop, effort) : un re-render détruit
		// leur anchor sans mouseleave → purge pour éviter les orphelins.
		document.querySelectorAll(".qbd-hover-tip").forEach(t => t.remove());
		// Le composer (et son ResizeObserver) est détruit par container.replaceChildren() :
		// déconnecter AVANT, sinon l'ancien observer continue de viser un élément
		// détaché (fuite silencieuse, un de plus à chaque render).
		if (composerResizeObserver) { composerResizeObserver.disconnect(); composerResizeObserver = null; }
		container.replaceChildren();

		// ── Scène unique (le layout 2 colonnes est supprimé — maquette
		// validée 2026-07-10) : idle/loading/error → titre + composer
		// CENTRÉS dans la page (référence claude.ai, plus de zone
		// « Aperçu » vide) ; result → l'ÉDITEUR embarqué pleine page et
		// le composer EN BAS (variante B « chat »). `formCol` reste le
		// nom du parent du composer pour ne pas réécrire tout le bloc.
		/* EN CONVERSATION dès qu'une demande est partie dans la file (référence
		   claude.ai, 2026-09-26 : /new devient une conversation à l'envoi) : le
		   titre s'efface, les tours s'empilent dans un fil qui défile, et le
		   composer se range en bas. On en sort par « Nouvelle demande », ou
		   quand la liste se vide. */
		const conversation = (phase === "idle" || phase === "error") && chatAContenu();
		modeConversation = conversation;
		/* THE SIDEBAR, on the left of the page like claude.ai's: a new chat, the
		   quizzes generated so far (the folder they are written to), and every
		   chat by day (`chat-sidebar.ts`). */
		/* The row layout keys on the sidebar being there (`:has`), never on a
		   class set on `container`: it is the panel shared by every page, and a
		   class left on it laid Folders out in two columns after Generate. */
		const lateral = ajouter(container, "nav", "qbd-ai-lateral");
		/* "Search", first, like claude.ai's: a window over the quizzes and the
		   chats (`chat-search.ts`). The entries stay put, only the chats scroll. */
		const recherche = ajouter(lateral, "button", "qbd-ai-lateral-recherche");
		recherche.type = "button";
		host.ui.setIcon(ajouter(recherche, "span", "qbd-ai-lateral-icone"), "search");
		ajouter(recherche, "span", undefined, t("ai.search.placeholder"));
		recherche.addEventListener("click", () => ouvrirRecherche({
			quizzes: () => deps.scanner.getQuizzes(),
			iconeQuiz: (chemin) => quizModeIcon(deps.scanner.getQuiz(chemin)?.mode ?? "practice"),
			ouvrirQuiz: (chemin) => {
				const quiz = deps.scanner.getQuiz(chemin);
				if (quiz) deps.navigate("detail", { quiz });
				else host.ui.notice(t("ai.queue.missing"));
			},
			ouvrirSession: (id) => setActiveChat(id),
		}));
		majNouvelle = poserNouvelleDemande(lateral, chatAContenu);
		if (deps.openGenerated) {
			const genere = ajouter(lateral, "button", "qbd-ai-lateral-item");
			genere.type = "button";
			host.ui.setIcon(ajouter(genere, "span", "qbd-ai-lateral-icone"), "folder-open");
			ajouter(genere, "span", undefined, t("ai.side.generated"));
			genere.addEventListener("click", () => deps.openGenerated?.());
		}
		/* The plan of an "/exam" preparation, while it lasts (plan-sidebar.ts). */
		poserPlan(lateral, fileGen, (chemin) => {
			const quiz = deps.scanner.getQuiz(chemin);
			if (quiz) deps.navigate("detail", { quiz, entree: "generation" });
			else host.ui.notice(t("ai.queue.missing"));
		}, () => activeChatId());
		poserListeChats(lateral);
		const stage = ajouter(container, "div", "qbd-ai-stage qbd-ai-stage--" + phase + (conversation ? " qbd-ai-stage--conversation" : ""));
		stageRef = stage;
		// Zone résultat créée AVANT le composer : l'ordre DOM le met en bas.
		const resultZone = phase === "result" ? ajouter(stage, "div", "qbd-ai-result-zone") : null;
		const formCol = stage;
		if (conversation) {
			vueFile.rendre(ajouter(stage, "div", "qbd-ai-fil"));
		}

		// ── Page header ──
		// Absent in result (the quiz page carries its own title) and as soon
		// as a request has left: on claude.ai the welcome hero gives way to
		// the conversation the second you send. Keeping it above the bubble
		// would feel like never having left.
		const showHero = phase !== "result" && !sentMessage && !conversation;
		if (showHero) {
			const titleRow = ajouter(formCol, "div", "qbd-ai-title-row");
			const titleIcon = ajouter(titleRow, "span", "qbd-ai-title-icon");
			// BARE brand glyph next to the serif title, like claude.ai's
			// asterisk — "sparkles" picked on a comparison board (2026-07-16).
			host.ui.setIcon(titleIcon, "sparkles");
			// A greeting rather than a fixed "Generate a quiz" (2026-09-29):
			// the page is the app's welcome, not a form label.
			const slot = greetingSlot(new Date().getHours());
			if (!greeting || greeting.slot !== slot || !heroShown) greeting = { slot, key: pickGreeting(slot) };
			ajouter(titleRow, "h2", "qbd-ai-title", t(greeting.key));
		}
		heroShown = showHero;


		// Zone du loader de génération : AU-DESSUS du composer (demande
		// 2026-07-10 — le loader préfigure le résultat, qui vit en haut).
		// display: contents en CSS → la carte reste un enfant flex direct.
		/* L'erreur se lit SOUS la demande, au-dessus du composer — comme la
		   réponse qu'elle remplace. Rendue en dernier, elle passait sous le
		   composer : on lisait la demande, puis un champ vide, puis seulement
		   l'échec. */

		// ── Fournisseur : bouton LOGO SEUL dans le pied du composer (la
		// carte « Modèle IA » est supprimée) — le menu garde logos, statut
		// et sous-titre ; le tooltip au survol porte nom + statut.
		// Aucun fournisseur par défaut : le choix reste la première étape,
		// le contrôle Modèle n'apparaît qu'une fois le fournisseur choisi.
		/* Un fournisseur devenu INVISIBLE (masqué dans les Réglages pendant
		   qu'il était retenu, ici ou depuis l'autre hôte) ne reste pas retenu :
		   le menu ne le montrerait plus et l'envoi partirait sur un canal
		   invisible. Le repli (premier canal gratuit visible) est persisté
		   tout de suite, sans attendre — sinon le prochain rendu retomberait
		   sur le même réglage mort. */
		const providerMasques = settings().aiCanauxPayantsMasques;
		const providerResolu = aiProviders.resoudreApresMasquage(settings().aiProvider || "", providerMasques);
		if (providerResolu !== (settings().aiProvider || "")) {
			void saveSettings({ aiProvider: providerResolu, aiModel: providerResolu ? aiProviders.getProvider(providerResolu).defaultModel : "" });
		}
		const provider = providerResolu;
		const currentModel = provider
			? (settings().aiModel || aiProviders.getProvider(provider).defaultModel)
			: "";

		let providerSelect: ProviderControl | null = null;
		/* Ouvre le menu des marques. Posé par buildProviderControl, appelé
		   aussi par le contrôle du milieu quand le canal est un SITE : il n'y
		   a alors pas de modèle à choisir, et le seul réglage atteignable
		   depuis ce bouton est le canal lui-même. */
		let ouvrirMenuFournisseur: (() => void) | null = null;
		const buildProviderControl = (parent: HTMLElement): void => {
			const btn = ajouter(parent, "button", "qbd-select qbd-provider-trigger-logo");
			btn.type = "button";
			const p = provider ? aiProviders.getProvider(provider) : null;
			// An icon-only button: its name says what it selects and which one is
			// selected, or the invitation to pick one.
			const marque = (provider && aiProviders.getMarque(provider)?.name) || "";
			btn.setAttribute("aria-label", marque ? t("ai.provider.label", { name: marque }) : t("ai.provider.choose"));
			if (p) {
				const logo = ajouter(btn, "span", "qbd-provider-logo qbd-provider-logo--" + p.logo);
				aiProviders.setBrandLogo(logo, p.logo);
			} else {
				// Aucun fournisseur : slot vide, le tooltip guide.
				const ic = ajouter(btn, "span", "qbd-provider-logo");
				host.ui.setIcon(ic, "circle-dashed");
			}

			let menu: ProviderMenuHandle | null = null;
			const ouvrir = (): void => {
				// Re-vérifie les CLI à CHAQUE ouverture du menu (force = sans TTL) :
				// après un « claude/codex update », la version affichée se met à
				// jour toute seule, le menu ouvert est redessiné à l'arrivée des
				// résultats (setStatus → refreshMenu).
				refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList, force: true });
				menu = openProviderMenu(btn, {
					brands: optionsMarques(),
					moreBrands: optionsMarques(true),
					current: provider,
					renderLogo: (el, logo) => aiProviders.setBrandLogo(el, logo),
					onPick: (id) => {
						/* Changer de fournisseur pendant « En attente de la connexion »
						   laissait la sonde tourner sur l'ancien outil et la carte à
						   l'écran (vu le 2026-09-18). L'attente est celle d'un
						   fournisseur : on la quitte avec lui. */
						annulerConnexion();
						void saveSettings({ aiProvider: id, aiModel: aiProviders.getProvider(id).defaultModel })
							.then(() => render(container))
							.then(() => ouvrirAvertissementWeb(id));
					},
					// Un canal DÉSACTIVÉ (CLI absent) ne se sélectionne pas : il
					// ouvre son modal d'installation, avec le même rafraîchissement
					// que le bouton du hint.
					onDisabledClick: (id) => ouvrirModalInstallation(id as InstallProvider, () => refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList, force: true }))
				});
			};
			btn.addEventListener("click", ouvrir);
			ouvrirMenuFournisseur = ouvrir;
			providerSelect = {
				el: btn,
				/* `menu` survit à la fermeture (le handle n'a pas de rappel de
				   fermeture) : on ne redessine que si un menu est réellement
				   dans le document, sinon on repositionnerait un menu détaché. */
				refreshMenu: () => { if (document.querySelector(".qbd-provider-menu")) menu?.refresh(); }
			};

			// Tooltip : marque, canal et statut, relus à chaque survol (les
			// détections async peuvent arriver après le rendu).
			let tip: HTMLElement | null = null;
			const hide = () => { if (tip) { tip.remove(); tip = null; } };
			btn.addEventListener("mouseenter", () => {
				if (tip) return;
				// Sans fournisseur, la bulle permanente dit déjà « Select a provider ».
				if (!(settings().aiProvider || "")) return;
				tip = ajouter(document.body, "div", "qbd-hover-tip");
				const actuel = settings().aiProvider || "";
				const marque = aiProviders.getMarque(actuel);
				const canal = aiProviders.getCanal(actuel);
				ajouter(tip, "div", "qbd-hover-tip-title", marque ? marque.name : t("ai.provider.choose"));
				const st = actuel ? providerStatus[actuel] : null;
				const corps = st ? st.text : (canal ? canal.label : "");
				if (corps) ajouter(tip, "div", "qbd-hover-tip-body", corps);
				const r = btn.getBoundingClientRect();
				tip.style.visibility = "hidden";
				const tr = tip.getBoundingClientRect();
				const left = Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), window.innerWidth - tr.width - 8);
				let top = r.top - tr.height - 8;
				if (top < 8) top = r.bottom + 8;
				tip.style.left = left + "px";
				tip.style.top = top + "px";
				tip.style.visibility = "";
			});
			btn.addEventListener("mouseleave", hide);
			btn.addEventListener("click", hide);
		};

		// Le contrôle Modèle + effort vit désormais dans le pied du composer
		// (façon claude.ai) : on prépare ici sa fabrique, appelée plus bas.
		// La zone de hint reste sous le sélecteur de fournisseur.
		let hintZone: HTMLElement | null = null;
		let buildModelControl: ((parent: HTMLElement) => void) | null = null;
		// modelSelect : vestige de l'ancien contrôle, jamais assigné — conservé
		// pour la signature de refreshProviderStatuses.
		const modelSelect: unknown = null;
		// État partagé du contrôle Ollama : options mutables, derniers modèles
		// locaux détectés et rafraîchissement du libellé. La liste est reconstruite
		// à CHAQUE ouverture du menu (et sur détection async) → reflète toujours la
		// sélection courante des réglages, même éditée après le rendu de la vue.
		let ollamaCtl: OllamaCtl | null = null;

		// Construit les options Ollama depuis la sélection de l'utilisateur
		// (settings.aiOllamaModels, ordre réglable) + les locaux installés hors
		// sélection. `detected` = res.models de checkOllama ([{name,capabilities}])
		// ou null. Renvoie un tableau plat = UNE liste scrollable (façon app
		// Ollama), jusqu'à OLLAMA_MAX_MODELS.
		const buildOllamaList = (detected: aiProviders.OllamaDetectedModel[] | null): OllamaListItem[] => {
			const byNorm = new Map<string, aiProviders.OllamaDetectedModel>();
			(detected || []).forEach(m => byNorm.set(m.name.replace(/:latest$/, ""), m));
			const isInstalled = (v: string) => byNorm.has(v.replace(/:latest$/, ""));
			const iconFor = (cloud: boolean, installed: boolean): string | null => cloud ? "cloud" : (installed ? null : "download");
			const planCompte = settings().aiOllamaPlanCompte || "";
			const appris = settings().aiOllamaPlansAppris || {};
			// Le verdict vient de la sonde à zéro token (`sonderPlansOllama` en
			// arrière-plan) et du 402 appris à la génération — plus de recommandations.
			const horsPlan = (meta: aiProviders.OllamaModelMeta): boolean =>
				meta.cloud && planCompte === "free" && appris[meta.value] === "payant";
			const decorate = (meta: aiProviders.OllamaModelMeta): OllamaListItem => {
				const installed = meta.cloud ? true : isInstalled(meta.value);
				return { value: meta.value, label: meta.label, cloud: meta.cloud,
					thinking: meta.thinking !== false, installed, icon: iconFor(meta.cloud, installed), horsPlan: horsPlan(meta) };
			};
			const catalog = settings().aiOllamaCatalog;
			const list = aiProviders.resolveOllamaSelection(settings().aiOllamaModels, catalog).map(decorate);
			/* TOUT le catalogue cloud, après la sélection, sans doublon, sous le
			   plafond — quel que soit le plan. Jusqu'au 2026-09-20 seuls les
			   modèles déjà classés « inclus » d'un compte GRATUIT s'ajoutaient ici :
			   un compte payant ne voyait jamais que les sept de la sélection par
			   défaut, et un compte gratuit jamais un modèle payant hors de cette
			   sélection — or le gestionnaire de sélection vivait dans les réglages
			   du greffon, parti au chantier lecteur, et l'application n'en a pas.
			   Un catalogue rafraîchi qui ne peut pas atteindre l'écran ne détecte
			   rien (Ahmed : « il nous manque des modèles payants »). Le classement
			   par plan reste celui de `repartirParPlan` à l'ouverture du menu : sur
			   un compte gratuit, un payant part dans « Plus de modèles » avec son
			   badge, un modèle pas encore sondé reste dans la liste principale le
			   temps que la sonde le classe — exactement comme la sélection. */
			for (const entry of aiProviders.getOllamaCatalog(catalog)) {
				if (list.length >= aiProviders.OLLAMA_MAX_MODELS) break;
				if (!aiProviders.isOllamaCloudModel(entry.value)) continue;
				if (list.some(o => o.value === entry.value)) continue;
				list.push(decorate(aiProviders.getOllamaModelMeta(entry.value, catalog)));
			}
			// Modèles locaux installés hors sélection → ajoutés en fin de liste.
			(detected || []).forEach(m => {
				const norm = m.name.replace(/:latest$/, "");
				if (list.some(o => o.value === m.name || o.value.replace(/:latest$/, "") === norm)) return;
				list.push({ value: m.name, label: m.name.replace(":latest", ""), cloud: false,
					installed: true, thinking: (m.capabilities || []).includes("thinking"), icon: null, horsPlan: false });
			});
			// Modèle courant hors liste → placé en tête.
			const cur = settings().aiModel || currentModel;
			if (cur && !list.some(o => o.value === cur)) {
				list.unshift(decorate(aiProviders.getOllamaModelMeta(cur, catalog)));
			}
			return list;
		};
		// Claude Code et Codex (ChatGPT) partagent le même contrôle modèle+effort
		// (menu façon claude.ai). Seules changent la liste de modèles, la liste
		// d'efforts et la résolution du modèle (Fable expire côté Claude).
		/* ANTIGRAVITY : la réplique du sélecteur d'Antigravity (capture du
		   2026-09-20) — UN bouton « Gemini 3.8 Flash  High ⌄ », un menu titré
		   « Model » avec une ligne par famille, son niveau en gris après le
		   nom, et pour les familles à niveaux un flyout Low / Medium / High
		   à droite, au survol. Pas le contrôle à deux boutons de Claude et
		   Codex : chaque outil a le sien. La liste vient de `agy models` ;
		   tant qu'elle n'est pas lue (CLI absent, compte non connecté), le
		   bouton dit « modèle du CLI » et la génération part sans `--model`.
		   Ce que la référence montre et qu'AUCUNE source ne donne au CLI est
		   laissé de côté plutôt qu'inventé : la pastille « Fast » des Flash
		   et le panneau « View Usage » (pas de sous-commande d'usage dans
		   `agy`, vérifié le 2026-09-20). */
		if (provider === "antigravity-cli") {
			buildModelControl = (parent: HTMLElement): void => {
				/* La liste du lancement précédent, tout de suite (réglage
				   `aiAntigravityModels`) ; `agy models` la relit derrière et la
				   persiste si elle a changé. */
				const gardee = settings().aiAntigravityModels;
				if (gardee && gardee.length) aiProviders.seedAntigravityModels(gardee);
				const persister = (): void => {
					const liste = aiProviders.getAntigravityModels();
					if (liste.length && JSON.stringify(liste) !== JSON.stringify(settings().aiAntigravityModels || null)) {
						void saveSettings({ aiAntigravityModels: liste });
					}
				};
				const modeles = (): aiProviders.ModelDef[] => aiProviders.getAntigravityModels();
				const courant = (): string => aiProviders.resolveAntigravityModel(settings().aiModel || currentModel);
				/* Le niveau EN USAGE d'une famille : le sien (réglage par famille,
				   comme chez Antigravity), clampé à ses niveaux (Gemini 3.1 Pro
				   n'a pas de medium). C'est ce que chaque ligne affiche en gris,
				   et ce qui partirait. */
				const niveauDe = (famille: string): string => aiProviders.niveauAntigravity(settings().aiAntigravityLevels, famille);
				const NIVEAU: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };
				const trigger = ajouter(parent, "button", "qbd-select qbd-model-trigger");
				trigger.type = "button";
				const trigLabel = ajouter(trigger, "span", "qbd-select-label");
				const trigChev = ajouter(trigger, "span", "qbd-select-chevron");
				host.ui.setIcon(trigChev, "chevron-down");
				const refresh = (): void => {
					const cur = modeles().find(m => m.value === courant());
					trigLabel.replaceChildren();
					/* Aucune liste (tout premier lancement, juste après
					   l'installation) : un spinner le temps de la lecture, et non
					   « modèle du CLI » posé comme un état stable (2026-09-20). */
					if (!cur && modeles().length === 0) ajouter(trigLabel, "span", "qbd-install-spinner qbd-model-trigger-spinner");
					ajouter(trigLabel, "span", "qbd-model-trigger-name", cur ? cur.label : t("ai.model.cliDefault"));
					if (cur && cur.efforts && cur.efforts.length) {
						const n = niveauDe(cur.value);
						ajouter(trigLabel, "span", "qbd-model-trigger-effort", NIVEAU[n] || n);
					}
				};
				refresh();
				/* La liste est relue en arrière-plan (au plus toutes les six
				   heures) et l'étiquette redessinée si elle a changé — sans
				   re-rendu du composer, qui effacerait le message en cours. */
				void aiProviders.refreshAntigravityModels().then(change => {
					persister();
					if ((change || modeles().length) && trigger.isConnected) refresh();
				});
				trigger.addEventListener("click", async () => {
					await aiProviders.refreshAntigravityModels();
					if (!trigger.isConnected) return;
					const liste = modeles();
					if (liste.length === 0) { host.ui.notice(t("ai.model.cliListUnavailable")); return; }
					openModelMenu(trigger, {
						head: t("dashboard.select.modelHead"),
						models: liste.map(m => {
							const niveaux = aiProviders.getEfforts(provider, m.value);
							if (!niveaux.length) return { value: m.value, label: m.label };
							const n = niveauDe(m.value);
							return {
								value: m.value, label: m.label,
								level: NIVEAU[n] || n,
								levels: niveaux.map(e => ({ value: e.value, label: NIVEAU[e.value] || e.label })),
								currentLevel: n
							};
						}),
						currentModel: courant(),
						efforts: [],
						onPickModel: async (v) => {
							await saveSettings({ aiModel: v });
							refresh();
						},
						onPickLevel: async (v, niveau) => {
							await saveSettings({ aiModel: v, aiAntigravityLevels: { ...(settings().aiAntigravityLevels || {}), [v]: niveau } });
							refresh();
						}
					});
				});
			};
		} else if (provider === "claude-code" || provider === "codex") {
			const isClaude = provider === "claude-code";
			// Liste relue à CHAQUE usage (trigger + ouverture du menu) : côté
			// Claude, Fable expire à date ; côté Codex, la liste suit
			// ~/.codex/models_cache.json (nouveau modèle du compte → présent au
			// prochain clic, sans mise à jour manuelle du plugin).
			const getModels = (): aiProviders.ModelDef[] => isClaude ? aiProviders.getClaudeModels(deps.usage?.claudePlan()) : aiProviders.getDefaultModels("codex");
			const resolveMv = (v?: string): string => isClaude ? aiProviders.resolveClaudeModel(v, deps.usage?.claudePlan()) : aiProviders.resolveCodexModel(v);
			// Modèle et effort = DEUX boutons séparés (référence claude.ai /
			// ChatGPT). Le modèle ouvre le menu de modèles (sans ligne Effort) ;
			// l'effort ouvre le popover slider (openEffortSlider), variante
			// claude ou codex. Les efforts Codex dépendent du modèle courant
			// (supported_reasoning_levels) → tout est relu à chaque usage.
			buildModelControl = (parent: HTMLElement): void => {
				const currentMv = () => resolveMv(settings().aiModel || currentModel);
				const currentEfforts = () => aiProviders.getEfforts(provider, currentMv());
				const currentEv = () => aiProviders.resolveEffort(provider, settings().aiEffort, currentMv());

				// Référence Claude Code : « Opus 4.8  Max » — libellés nus,
				// SANS chevrons, rapprochés (l'effort en Capitalisé).
				const trigger = ajouter(parent, "button", "qbd-select qbd-model-trigger qbd-composer-plain");
				trigger.type = "button";
				const trigLabel = ajouter(trigger, "span", "qbd-select-label");

				const effortBtn = ajouter(parent, "button", "qbd-select qbd-effort-trigger qbd-composer-plain");
				effortBtn.type = "button";
				const effortLabel = ajouter(effortBtn, "span", "qbd-select-label qbd-effort-trigger-label");

				const EFFORT_DISPLAY: Record<string, string> = {
					low: "Low", medium: "Medium", high: "High",
					xhigh: "Extra", max: "Max", ultracode: "Ultracode", ultra: "Ultra"
				};

				const refreshTriggers = () => {
					trigLabel.replaceChildren();
					const models = getModels();
					const cur = models.find(m => m.value === currentMv())
						|| (isClaude ? aiProviders.getClaudeMoreModels(deps.usage?.claudePlan()).find(m => m.value === currentMv()) : undefined)
						|| models[0];
					// Fast actif (codex) → éclair à gauche du nom du modèle,
					// comme la pill du composer ChatGPT.
					if (!isClaude && settings().aiCodexFast && cur.fast) {
						const z = ajouter(trigLabel, "span", "qbd-model-trigger-zap");
						host.ui.setIcon(z, "zap");
					}
					ajouter(trigLabel, "span", "qbd-model-trigger-name", cur.label);
					const ev = currentEv();
					const ef = currentEfforts().find(e => e.value === ev);
					effortLabel.textContent = (EFFORT_DISPLAY[ev] || (ef ? ef.label : ev));
					effortBtn.classList.toggle("is-ultra", !!(ef && ef.accent));
				};
				refreshTriggers();
				/* L'INSTANTANÉ des fichiers de CLI (tranche 5, tâche 3) :
				   `getModels()` est synchrone et lit un instantané de module que
				   seul `refreshCliCaches` remplit. L'étiquette vient d'être
				   dessinée avec ce qu'on avait ; on la redessine UNE fois si
				   l'instantané a changé — `refreshTriggers` et non un re-rendu du
				   composer, qui effacerait le message en cours de frappe. */
				void aiProviders.refreshCliCaches().then(change => {
					if (change && trigger.isConnected) refreshTriggers();
				});
				/* Et EN DIRECT ensuite : Claude Code retélécharge son catalogue
				   à chaque session, Codex son cache — le bouton suit sans clic. */
				aiProviders.suivreModelesCli(() => { if (trigger.isConnected) refreshTriggers(); });

				/* RELU À L'OUVERTURE, comme avant : la liste suivait
				   `~/.codex/models_cache.json` à chaque clic (un modèle neuf du
				   compte y apparaissait sans mise à jour du plugin). La lecture
				   est devenue asynchrone, l'attente aussi — quelques
				   millisecondes avant que le menu ne s'ouvre. */
				trigger.addEventListener("click", async () => {
					await aiProviders.refreshCliCaches();
					if (!trigger.isConnected) return;
					openModelMenu(trigger, {
						models: getModels(),
						// Claude : les anciens modèles du catalogue (section
						// `overflow`), sous « Plus de modèles », comme dans le CLI.
						moreModels: isClaude ? aiProviders.getClaudeMoreModels(deps.usage?.claudePlan()) : undefined,
						currentModel: currentMv(),
						// L'effort a son propre bouton → pas de ligne Effort ici.
						efforts: [],
						onPickModel: async (v) => {
							await saveSettings({ aiModel: v });
							refreshTriggers();
						}
					});
				});

				effortBtn.addEventListener("click", () => {
					// Éclair Fast (codex) : seulement si CE modèle expose le tier
					// « priority » (models_cache) — toggle persisté aiCodexFast.
					const curModel = getModels().find(m => m.value === currentMv());
					const fast = (!isClaude && curModel && curModel.fast) ? {
						on: !!settings().aiCodexFast,
						onToggle: async (v: boolean) => {
							await saveSettings({ aiCodexFast: v });
							refreshTriggers(); // éclair du bouton modèle
						}
					} : null;
					openEffortSlider(effortBtn, {
						variant: isClaude ? "claude" : "codex",
						efforts: currentEfforts(),
						currentEffort: currentEv(),
						fast,
						onPickEffort: async (v) => {
							await saveSettings({ aiEffort: v });
							refreshTriggers();
						}
					});
				});
			};
		} else if (aiProviders.estCanalWeb(provider)) {
			/* Un SITE n'a pas de modèle à choisir : c'est lui qui décide, avec le
			   compte de l'utilisateur. Le contrôle du milieu dit donc le SITE
			   seul (« claude.ai »), là où un CLI dit son modèle. La marque, c'est
			   le logo juste à côté : « Claude · claude.ai » la disait deux fois
			   (Ahmed, 2026-09-19). ET IL NE SE CLIQUE PAS : jusqu'au 2026-09-20 il
			   rouvrait le menu des marques, avec un chevron — mais rien ne se
			   règle ici, et un bouton qui ne mène qu'à un menu déjà accessible
			   par le logo trompe (Ahmed : « on n'est pas censé pouvoir cliquer
			   dessus »). Un libellé, sans chevron ni curseur. */
			buildModelControl = (parent: HTMLElement): void => {
				const libelle = ajouter(parent, "div", "qbd-select qbd-model-trigger qbd-channel-trigger qbd-channel-trigger--inerte");
				const label = ajouter(libelle, "span", "qbd-select-label");
				const canal = aiProviders.getCanal(provider);
				ajouter(label, "span", "qbd-model-trigger-name", canal ? canal.label : provider);
			};
		} else if (provider) {
			// Ollama partage le MÊME contrôle modèle+effort que Claude/Codex
			// (openModelMenu). L'effort est réel : câblé sur le param `think` de
			// l'API Ollama (low/medium/high/max). La ligne Effort n'apparaît que
			// pour un modèle à raisonnement (thinking). Les icônes nuage/
			// téléchargement/rien reproduisent l'app Ollama.
			const efforts = aiProviders.getEfforts(provider);
			// `detected` = derniers modèles locaux vus par checkOllama (pour les
			// ré-annexer à la reconstruction). La liste est reconstruite à CHAQUE
			// ouverture du menu → reflète toujours la sélection courante des réglages.
			ollamaCtl = { options: buildOllamaList(null), detected: null, refreshTrigger: null };
			const ctl = ollamaCtl;
			buildModelControl = (parent: HTMLElement): void => {
				const trigger = ajouter(parent, "button", "qbd-select qbd-model-trigger");
				trigger.type = "button";
				const trigLabel = ajouter(trigger, "span", "qbd-select-label");
				const trigChev = ajouter(trigger, "span", "qbd-select-chevron");
				host.ui.setIcon(trigChev, "chevron-down");
				/* LE MODÈLE PAR DÉFAUT EST CHOISI ICI, et PERSISTÉ, quand le
				   réglage est vide ou ne désigne plus rien de la liste : un modèle
				   LOCAL installé d'abord (rien à payer, rien à joindre), sinon le
				   premier qui n'est pas hors plan, sinon le premier. Rejoué à
				   chaque redessin : les locaux détectés et les plans appris
				   arrivent après le premier rendu, et le choix s'affine avec eux
				   tant que l'utilisateur n'en a pas fait un lui-même. */
				const choisirOllamaParDefaut = (): void => {
					const mv = settings().aiModel || "";
					if (mv && ctl.options.some(o => o.value === mv)) return;
					const choix = ctl.options.find(o => o.installed && !o.cloud)
						|| ctl.options.find(o => !o.horsPlan)
						|| ctl.options[0];
					if (choix && choix.value !== mv) void saveSettings({ aiModel: choix.value });
				};
				const curOpt = (): OllamaListItem | undefined => {
					const mv = settings().aiModel || currentModel;
					return ctl.options.find(o => o.value === mv)
						|| ctl.options.find(o => o.installed && !o.cloud)
						|| ctl.options.find(o => !o.horsPlan)
						|| ctl.options[0];
				};
				const refreshTrigger = () => {
					choisirOllamaParDefaut();
					trigLabel.replaceChildren();
					const cur = curOpt();
					const mv = settings().aiModel || currentModel;
					ajouter(trigLabel, "span", "qbd-model-trigger-name", cur ? cur.label : (mv || "").replace(":latest", ""));
					if (cur && cur.thinking) {
						ajouter(trigLabel, "span", "qbd-model-trigger-effort", aiProviders.getEffortLabel(aiProviders.resolveEffort(provider, settings().aiEffort), provider));
					}
					if (cur && cur.horsPlan) ajouter(trigLabel, "span", "qbd-model-option-badge", t("ai.badge.pro"));
				};
				refreshTrigger();
				ctl.refreshTrigger = refreshTrigger;
				trigger.addEventListener("click", () => {
					// Reconstruit à l'ouverture → la liste suit la sélection des
					// réglages (settings.aiOllamaModels) même modifiée après le rendu.
					ctl.options = buildOllamaList(ctl.detected);
					refreshTrigger();
					const cur = curOpt();
					// Répartition en deux listes : « Plus de modèles » (payant, sur un
					// compte gratuit) n'apparaît QUE là, avec le badge Pro et le lien
					// de mise à niveau — la liste principale ne porte ni l'un ni l'autre.
					const { principal, plus } = aiProviders.repartirParPlan(
						ctl.options, settings().aiOllamaPlanCompte || "", settings().aiOllamaPlansAppris || {});
					openModelMenu(trigger, {
						models: principal,
						moreModels: plus.map(o => ({
							...o,
							badge: t("ai.badge.pro"),
							upgrade: { label: t("ai.upgrade.button"), onClick: () => { void host.shell.openUrl(aiProviders.OLLAMA_UPGRADE_URL); } },
						})),
						searchable: true,
						currentModel: settings().aiModel || currentModel,
						efforts: (cur && cur.thinking) ? efforts : [],
						currentEffort: aiProviders.resolveEffort(provider, settings().aiEffort),
						onPickModel: async (v) => {
							await saveSettings({ aiModel: v });
							refreshTrigger();
						},
						onPickEffort: async (v) => {
							await saveSettings({ aiEffort: v });
							refreshTrigger();
						}
					});
				});
			};
		}


		// ── Composer (champ unique + bouton « + » d'attachements) ──
		let generateBtnRef: HTMLButtonElement | null = null;

		const composer = ajouter(formCol, "div", "qbd-ai-composer");
		composer.classList.toggle("qbd-ai-composer--actif", composerActif);
		const activer = (): void => {
			composerActif = true;
			composer.classList.add("qbd-ai-composer--actif");
		};
		composer.addEventListener("pointerdown", activer);
		composer.addEventListener("focusin", activer);
		/* AILLEURS = dans l'arbre de la page (le même enfant du <body> que le
		   composer) mais hors du composer. Un menu ou une modale ouverts DEPUIS
		   le composer vivent dans un autre enfant du <body> (portalés) : y
		   cliquer ne le désactive pas. */
		veilleComposerActif?.retirer();
		const surAilleurs = (e: Event): void => {
			if (!composerActif || !composer.isConnected) return;
			const cible = e.target as Node | null;
			if (!cible || composer.contains(cible)) return;
			let haut: Node = cible;
			while (haut.parentNode && haut.parentNode !== document.body) haut = haut.parentNode;
			if (!haut.contains(composer)) return;
			composerActif = false;
			composer.classList.remove("qbd-ai-composer--actif");
		};
		document.addEventListener("pointerdown", surAilleurs, true);
		document.addEventListener("focusin", surAilleurs, true);
		veilleComposerActif = { retirer: () => {
			document.removeEventListener("pointerdown", surAilleurs, true);
			document.removeEventListener("focusin", surAilleurs, true);
		} };

		/* The OUTPUT FOLDER, at the top of the composer (2026-09-29, after
		   Monocode's "Current checkout" row): where the quiz will be written is
		   seen before sending, not found in the options menu afterwards. A click
		   opens the same destinations as the options menu; with a single one
		   (the default) the row only informs and opens nothing. */
		const destRow = ajouter(composer, "div", "qbd-ai-composer-dest");
		const destBtn = ajouter(destRow, "button", "qbd-ai-dest");
		destBtn.type = "button";
		paintDestination = (): void => {
			const options = destinationOptions();
			const current = options.find(d => d.value === destination) ?? options[0];
			destBtn.replaceChildren();
			/* A folder glyph and the name, nothing else (no root, no chevron):
			   a plain folder icon rather than the module's own, tinted with its
			   colour, so the row reads as "where it goes" at a glance. The
			   root stays in the menu. */
			const icon = ajouter(destBtn, "span", "qbd-ai-dest-icon");
			host.ui.setIcon(icon, "folder");
			if (current.color) icon.style.color = current.color;
			ajouter(destBtn, "span", "qbd-ai-dest-label", current.label);
			destBtn.disabled = options.length <= 1;
			destBtn.setAttribute("aria-label", t("ai.composer.destination", { folder: current.label }));
		};
		paintDestination();
		destBtn.addEventListener("click", () => {
			openActionMenu(destBtn, destinationOptions().map(d => ({
				icon: d.icon || "folder",
				iconColor: d.color || undefined,
				label: d.label,
				hint: d.sub,
				onClick: () => {
					destination = d.value;
					destinationDuPreset = false;
					memoriserDestination(d.value);
					majAvisCategorie();
					paintDestination?.();
				},
			})), { className: "qbd-menu-claude" });
		});
		/* Folder suggestions, under the composer; and the picker offered on
		   arrival (like "Choose a provider"): a popover anchored to the chip,
		   once per arrival and per new chat, only while nothing is chosen. */
		suggestionsEl = ajouter(formCol, "div", "qbd-ai-suggestions");
		suggestionsEl.setAttribute("aria-live", "polite");
		if (provider && dossierProposePour !== activeChatId() && !destination && !examCible && !composerText && destinationOptions().length > 1) {
			dossierProposePour = activeChatId();
			window.setTimeout(() => { if (!disposed && destBtn.isConnected && !document.querySelector(".qbd-action-menu")) destBtn.click(); }, 450);
		}
		planifierSuggestions();
		/* The SUBJECT notice (feedback #7), right of the folder since
		   2026-09-29 — it sat before the Options icon, in the bottom bar:
		   "Python detected", text and icon, no badge; hidden for `general`.
		   Where the quiz goes and what it is about read together, before
		   sending. Repainted on each composer change (`updateGenerateBtn`).
		   Without a provider the options are hidden: the notice too. */
		avisCategorieEl = null;
		if (provider) {
			const avis = ajouter(destRow, "span", "qbd-ai-categorie");
			avis.hidden = true;
			avisCategorieEl = avis;
			majAvisCategorie();
		}

		// Zone de texte : le textarea et la rangée de chips « notes »
		// partagent ce conteneur (position relative). La rangée se
		// superpose en absolu sur la PREMIÈRE ligne du texte — un
		// <textarea> ne pouvant contenir aucun élément, c'est la seule
		// façon de les mettre « sur la ligne » sans passer en
		// contenteditable (interdit : casserait dictée/caret/auto-grow/
		// collage). `layoutChipsRow` (posé après la création du textarea)
		// mesure la largeur réelle de la rangée et pose `text-indent` en
		// conséquence — ou bascule en repli (rangée au-dessus, en flux
		// normal) si elle est trop large pour laisser de la place au texte.
		const textZone = ajouter(composer, "div", "qbd-ai-composer-textzone");
		let chipsRow: HTMLElement | null = null;
		const avecPieces = images.length > 0 || noteAttachments.length > 0;
		if (avecPieces) {
			/* LA ZONE qui s'ouvre au-dessus du texte (claude.ai) : une grille
			   `overflow: hidden` qui déborde de 8 px en haut et sur les côtés —
			   la place de la croix, posée à 8 px HORS de la vignette — et dont
			   le contenu descend en fondu à l'ouverture seulement. */
			const zone = ajouter(textZone, "div", "qbd-ai-composer-pieces");
			const contenuZone = ajouter(zone, "div", "qbd-ai-composer-pieces-contenu");
			zonePieces ??= {};
			if (effetEnCours(debutsZonePieces, zonePieces, 200)) contenuZone.classList.add("qbd-ai-composer-pieces-contenu--entree");
			// En flux normal DÈS la création : `layoutChipsRow` attend une image,
			// qu'une fenêtre masquée ne dessine jamais.
			chipsRow = ajouter(contenuZone, "div", "qbd-ai-composer-chips qbd-ai-composer-chips--stacked");
			/* Les images sont des cartes de la MÊME rangée que les documents
			   (retour Ahmed 2026-09-19, référence claude.ai : un JPG et un PDF
			   côte à côte, même gabarit). Elles avaient leur propre rangée de
			   vignettes de 56 px au-dessus : deux tailles, deux lignes. */
			for (let i = 0; i < images.length; i++) {
				const chip = ajouter(chipsRow, "div", "qbd-ai-note-chip");
				poserCarteImage(chip, images[i]);
				const image = images[i];
				poserCroix(chip, image.file.name, () => {
					const idx = images.indexOf(image);
					if (idx < 0) return;
					URL.revokeObjectURL(image.url);
					images.splice(idx, 1);
					render(containerRef);
				});
			}
			for (const note of noteAttachments) {
				/* Une CARTE, pas une pastille (retour Ahmed 2026-09-17, référence
				   claude.ai) : le nom sur deux lignes, et l'EXTENSION en badge en
				   bas — pas d'icône, le badge dit le type. */
				const chip = ajouter(chipsRow, "div", "qbd-ai-note-chip");
				pieces.peindreCarte(chip, note);
				/* Le clic OUVRE L'APERÇU : le texte d'une note, les pages d'un
				   PDF — une fois lu. Le chemin est dans la modale, et le tooltip
				   natif le porte encore. */
				chip.addEventListener("click", (e) => {
					if ((e.target as HTMLElement).closest(".qbd-ai-note-chip-remove")) return;
					if (!note.lecture) ouvrirApercu(note);
				});
			}
			/* "N quizzes <-> 1 quiz" (spec 2026-09-29 §4.3), right under the
			   documents it is about: text with its icon, no frame (a bordered
			   button inside the composer's card would be a tile within a tile).
			   `aria-pressed` = ONE quiz over all the documents. */
			oneQuizBtn = null;
			// Not for an exam: its preparation makes one Learn per document anyway.
			if (canChooseQuizCount(noteAttachments.length, images.length) && !examCible) {
				const toggle = ajouter(contenuZone, "button", "qbd-ai-onequiz");
				toggle.type = "button";
				host.ui.setIcon(ajouter(toggle, "span", "qbd-ai-onequiz-icon"), "layers");
				ajouter(toggle, "span", "qbd-ai-onequiz-label", t("ai.oneQuiz.label"));
				oneQuizBtn = toggle;
				paintOneQuiz();
				toggle.addEventListener("click", () => {
					oneQuiz = !oneQuiz;
					paintOneQuiz();
				});
				attachHoverTip(toggle, (tip) => {
					ajouter(tip, "div", "qbd-hover-tip-title", t("ai.oneQuiz.label"));
					ajouter(tip, "div", "qbd-hover-tip-body", t(oneQuiz ? "ai.oneQuiz.tipOne" : "ai.oneQuiz.tipMany", { count: noteAttachments.length }));
				});
			}
		}
		if (!avecPieces) { zonePieces = null; oneQuizBtn = null; }

		/* LES TUILES VIDÉO (spec « Vidéos YouTube » § 3.4) : leur rangée est
		   TOUJOURS là, dans la même bande que les chips, pour qu'une tuile
		   née du débounce (le lien vient d'être collé) puisse se dessiner
		   sans repasser par un rendu complet. Inerte sans `host.video`, la
		   rangée reste vide — et sans trace (CSS :empty). */
		zoneVideo = ajouter(textZone, "div", "qbd-ai-video-row");
		tuilesVideo.rendre(zoneVideo);

		/* The exam picked in the "/exam" menu: the request is WRITTEN for the
		   learner, as a prompt tile above the field (the Explain window's
		   tile); what is typed in the field is added under it. Its cross gives
		   up the preparation. Drawn in place, never by a render (a render would
		   take the focus from the field). */
		const tuileExam = ajouter(textZone, "div", "qbd-ai-exam-cible");
		/* With documents joined, the tile opens THEIR row, on the same line
		   (claude.ai: the pasted text and the files side by side). */
		if (chipsRow) chipsRow.prepend(tuileExam);
		const composerInput = ajouter(textZone, "textarea", "qbd-ai-composer-input");
		let mentions: MentionPickerHandle | null = null;
		let commandeExam: ExamCommandHandle | null = null;
		// UN SEUL placeholder, quoi qu'il y ait de joint (demande Ahmed,
		// 2026-09-17). La variante « Ajouter des instructions (facultatif) »
		// qui apparaissait dès la première pièce jointe changeait le texte sous
		// les yeux, et la parenthèse gênait. Le champ RESTE facultatif avec une
		// pièce jointe (`canGenerate` accepte texte OU images OU notes) ; c'est
		// seulement le texte qui ne bouge plus.
		const peindreExamCible = (): void => {
			tuileExam.replaceChildren();
			tuileExam.hidden = !examCible;
			composerInput.placeholder = t(examCible ? "ai.exam.addDetails" : "ai.composer.placeholder");
			if (!examCible) return;
			ajouter(tuileExam, "div", "qbd-ai-exam-cible-texte", promptPreparation(examCible, settings().aiExamPrompt));
			const pied = ajouter(tuileExam, "div", "qbd-ai-exam-cible-pied");
			ajouter(pied, "span", "qbd-ai-exam-cible-nom", t("ai.exam.tileName"));
			// The pencil opens the Settings on the prompt, like the Explain tile's.
			if (deps.openExamPromptSettings) {
				const crayon = ajouter(pied, "button", "qbd-ai-exam-cible-edit");
				crayon.type = "button";
				crayon.title = t("ai.exam.tileEdit");
				crayon.setAttribute("aria-label", t("ai.exam.tileEdit"));
				host.ui.setIcon(crayon, "pencil");
				crayon.addEventListener("click", () => deps.openExamPromptSettings?.());
			}
			// The round cross in the corner, shown on hover (claude.ai's pasted text).
			const croix = ajouter(tuileExam, "button", "qbd-ai-exam-cible-retirer");
			croix.type = "button";
			croix.title = t("ai.exam.remove");
			croix.setAttribute("aria-label", t("ai.exam.remove"));
			host.ui.setIcon(croix, "x");
			croix.addEventListener("click", () => {
				examCible = null;
				if (destinationParExam) { destination = destinationMemoriseeCourante(); destinationParExam = false; void render(containerRef); return; }
				peindreExamCible();
				updateGenerateBtn(generateBtnRef);
			});
		};
		peindreExamCible();
		composerInput.value = composerText;
		/* Les tuiles suivent le texte VIVANT à chaque rendu (retour d'une
		   demande annulée, préréglage, collage par le picker « @ ») : le
		   débounce relit le même texte et ne fait rien quand il n'a pas
		   changé. */
		tuilesVideo.suivreTexte(composerText);
		composerInput.rows = 2;
		const autoGrow = () => {
			composerInput.style.height = "auto";
			composerInput.style.height = Math.min(composerInput.scrollHeight, 220) + "px";
		};
		// Fait suivre la rangée de chips au défilement interne du textarea
		// (max-height: 220px, overflow-y: auto) : sans ça, la rangée reste
		// ancrée au CADRE (top: 0 de .qbd-ai-composer-textzone) pendant que
		// le texte défile dessous, et une chip au fond opaque vient amputer
		// le début des lignes qui défilent sous elle. En appliquant le MÊME
		// décalage que le scroll interne, la rangée se comporte comme si elle
		// faisait partie de la ligne 0 : elle défile et disparaît avec elle.
		// `overflow: hidden` sur .qbd-ai-composer-textzone (CSS) l'empêche de
		// déborder du cadre une fois remontée. Rien à faire en mode --stacked
		// (flux normal, ne chevauche jamais le texte) : transform vidé.
		const syncChipsScroll = () => {
			if (!chipsRow) return;
			const stacked = chipsRow.classList.contains("qbd-ai-composer-chips--stacked");
			chipsRow.style.transform = stacked ? "" : "translateY(-" + composerInput.scrollTop + "px)";
		};
		composerInput.addEventListener("scroll", syncChipsScroll);
		// Mesure la rangée de chips (superposée à la 1ʳᵉ ligne) et pose le
		// text-indent en conséquence — RECALCULÉ à chaque appel (jamais codé
		// en dur : police, contenu et nombre de chips varient). Au-delà de
		// ~55 % de la largeur du composer, la rangée ne tient plus à côté du
		// texte : repli en flux normal au-dessus (classe --stacked), sans
		// text-indent. Ça arrive avec PLUSIEURS chips (chaque chip est
		// plafonnée à 240px de large) — JAMAIS avec une seule, même dépliée
		// sur son chemin complet : à 240px de max-width, une chip seule ne
		// peut pas dépasser 0,55 × largeur usuelle du composer (~732px) =
		// ~402px. (Ce commentaire promettait l'inverse — corrigé : ce projet
		// s'est déjà fait piéger deux fois par un commentaire qui annonce
		// autre chose que ce que fait le code.)
		/* TOUJOURS au-dessus du champ, en flux normal, en rangée DÉFILANTE
		   (2026-09-17, cartes façon claude.ai — retour Ahmed). La superposition
		   à la première ligne du texte (un `text-indent` mesuré à la largeur
		   des pastilles, avec repli quand elles ne tenaient pas) n'a plus de
		   sens pour des cartes de cent pixels de haut : le mode « stacked » est
		   le seul qui reste, et la mesure est partie avec l'autre. L'observateur
		   de redimensionnement ci-dessous rappelle cette fonction : il ne coûte
		   plus qu'un ajout de classe déjà posée. */
		const layoutChipsRow = () => {
			if (!chipsRow || !chipsRow.isConnected) return;
			chipsRow.classList.add("qbd-ai-composer-chips--stacked");
			composerInput.style.textIndent = "";
			syncChipsScroll();
		};
		// Re-mesure quand la carte change de largeur (pane redimensionné, zoom
		// Obsidian) : sans ça, la valeur de text-indent posée au premier
		// render reste périmée — pattern repris de engine/viewport.ts
		// (bindViewportResizeObserver) : ResizeObserver + comparaison de
		// largeur pour ignorer les callbacks qui ne changent rien (un
		// changement de HAUTEUR de la carte, ex. bascule --stacked, redéclenche
		// l'observer sans que la largeur ait bougé). Déconnecté au prochain
		// render (cf. le début de render()) — jamais réutilisé tel quel : ce
		// n'est pas le MÊME domaine (pas de piste de slides ici), seulement la
		// même technique.
		if (chipsRow && typeof ResizeObserver !== "undefined") {
			let lastComposerWidth = Math.round(composer.getBoundingClientRect().width || 0);
			composerResizeObserver = new ResizeObserver((entries) => {
				const entry = entries[0];
				if (!entry) return;
				const width = Math.round(entry.contentRect.width || composer.getBoundingClientRect().width || 0);
				if (width === lastComposerWidth) return;
				lastComposerWidth = width;
				layoutChipsRow();
			});
			composerResizeObserver.observe(composer);
		}
		composerInput.addEventListener("input", (e) => {
			const ta = e.target as HTMLTextAreaElement;
			/* Le texte d'invite qui RÉAPPARAÎT (le champ vient de se vider)
			   entre en fondu, 0,5 s linéaire — `cds-fade-in` de claude.ai.
			   Retirer la classe et relire une mesure relance l'animation. */
			if (!ta.value && composerText) {
				ta.classList.remove("qbd-ai-composer-input--invite");
				void ta.offsetWidth;
				ta.classList.add("qbd-ai-composer-input--invite");
			}
			composerText = ta.value;
			composerCaret = ta.selectionStart;
			autoGrow();
			updateGenerateBtn(generateBtnRef);
			tuilesVideo.suivreTexte(composerText);
		});
		// Un simple déplacement du caret (clic souris, flèches) ne déclenche
		// PAS d'événement "input" (la valeur ne change pas) : sans ce filet,
		// repositionner le curseur puis attacher via le menu « + » ou un
		// glisser-déposer (aucune frappe entre les deux) le renvoyait quand
		// même en fin de texte, composerCaret restant figé sur la dernière
		// frappe.
		const captureCaret = () => { composerCaret = composerInput.selectionStart; };
		composerInput.addEventListener("keyup", captureCaret);
		composerInput.addEventListener("click", captureCaret);
		// Coller une image directement dans le champ
		composerInput.addEventListener("paste", (e) => {
			const files = Array.from(e.clipboardData?.files || []).filter(f => f.type.startsWith("image/"));
			if (files.length > 0) {
				e.preventDefault();
				addImageFiles(files);
			}
		});
		// Enter = générer, Shift+Enter = saut de ligne (référence claude.ai).
		// Enter nu n'insère JAMAIS de retour (même champ vide / pendant une
		// génération) ; isComposing protège la saisie IME.
		composerInput.addEventListener("keydown", (e) => {
			// Le menu « @ » a le clavier tant qu'il est ouvert (recherche) :
			// ni Entrée (le picker gère sa propre sélection) ni Backspace
			// (sinon effacer une lettre de sa recherche supprimerait une
			// pièce jointe) ne doivent lui être volés.
			if (mentions && mentions.isOpen()) return;
			if (commandeExam && commandeExam.isOpen()) return;
			// Backspace en tout début de champ (rien à gauche du caret,
			// aucune sélection) : retire la DERNIÈRE pièce jointe —
			// convention chips (Gmail, Slack). Un Backspace avec du texte à
			// gauche du caret garde son comportement normal.
			if (e.key === "Backspace" && composerInput.selectionStart === 0 && composerInput.selectionEnd === 0
				&& (noteAttachments.length > 0 || images.length > 0)) {
				e.preventDefault();
				removeLastAttachment();
				return;
			}
			if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
			e.preventDefault();
			if (canGenerate()) void startGeneration(containerRef);
		});
		requestAnimationFrame(() => { autoGrow(); layoutChipsRow(); });

		mentions = attachMentionPicker(composerInput, composer, {
			onPickVaultFile: (path) => { void attachVaultPath(path); },
			onPickExternalFile: (path) => { void attachExternalPath(path); },
			onTextReplaced: (value) => {
				composerText = value;
				composerCaret = composerInput.selectionStart;
				autoGrow();
				updateGenerateBtn(generateBtnRef);
				// Un remplacement programmatique ne déclenche PAS d'« input » :
				// les tuiles vidéo ne liraient jamais le texte écrit ici.
				tuilesVideo.suivreTexte(composerText);
			},
			// Lu au rendu (le réglage peut changer sans rouvrir la vue).
			getExtraRoots: () => settings().aiMentionExtraFolders || [],
		});
		commandeExam = attachExamCommand(composerInput, composer, {
			exams: () => deps.upcomingExams?.() ?? [],
			onPick: (exam) => {
				examCible = exam;
				peindreExamCible();
				updateGenerateBtn(generateBtnRef);
				// Which documents is the exam marked on? Asked at once.
				choisirDocumentsExam(exam);
			},
			onTextReplaced: (value) => {
				composerText = value;
				composerCaret = 0;
				autoGrow();
				updateGenerateBtn(generateBtnRef);
			},
		});

		// Rangée du bas : bouton « + » (gauche), puis à droite le modèle +
		// effort (façon claude.ai) et le bouton d'envoi.
		const composerBottom = ajouter(composer, "div", "qbd-ai-composer-bottom");
		const addBtn = ajouter(composerBottom, "button", "qbd-ai-composer-add");
		addBtn.type = "button";
		addBtn.setAttribute("aria-label", t("ai.composer.addContent"));
		host.ui.setIcon(addBtn, "plus");

		/* No Learn | Test selector any more (spec 2026-10-07-generate-auto-kind):
		   the kind is decided when the request is sent (`decideGenre`). */
		const optsBtn = ajouter(composerBottom, "button", "qbd-ai-composer-opts");
		optsBtn.type = "button";
		host.ui.setIcon(optsBtn, "settings-2");
		labelIconButton(optsBtn, t("ai.composer.quizOptions"));
		optsBtn.addEventListener("click", () => {
			// The menu only knows labels: translate on the way in, and map the
			// selection back to its canonical value on the way out. The output
			// folder is not here: it has its own row at the top of the composer.
			openOptionsMenu(optsBtn, {
				count: questionCount ?? 10,
				countAuto: questionCount === null, onCountAuto: () => { questionCount = null; },
				type: "", types: typeLabels().slice(1),
				typesActifs: effectiveTypes().filter(v => v !== TYPE_VALUES[0]).map(typeLabel),
				// An empty selection is Auto, chosen explicitly (not the mode's default).
				onTypes: (labels) => { questionTypes = labels.length ? labels.map(typeValue) : [TYPE_VALUES[0]]; },
				typesResume: (labels) => typesResume(labels.map(typeValue)),
				onCount: (n) => { questionCount = n; },
				/* The subject: Automatic says what it detects, otherwise the
				   choice forces the prompt's (feedback #7). A value that is not
				   a known subject (a group row) is never kept. */
				categories: choixCategories(),
				categorie: categorieChoix,
				categorieDetectee: libelleDetecte(detecterCategorie(indicesCategorie(noteAttachments, composerText))),
				onCategorie: (value) => {
					categorieChoix = estCategorie(value) ? value : null;
					majAvisCategorie();
				},
			});
		});
		// Hover tooltip: the current state ("5 questions · Mixed"), re-read
		// on each hover — attachHoverTip pattern. The folder no longer shows
		// here: the composer's own row always does.
		attachHoverTip(optsBtn, (tip) => {
			const nb = questionCount === null ? t("ai.options.auto") : t("dashboard.common.questionsOther", { count: questionCount });
			const ty = typesResume(effectiveTypes());
			ajouter(tip, "div", "qbd-hover-tip-title", `${nb} · ${ty}`);
		});

		/* Consultation du forfait, à sa place de contrôle : dans le composer,
		   avec le « + » et les options (référence Ahmed 2026-07-30). Savoir ce
		   qu'il reste n'a d'intérêt que si on peut le demander SANS dépenser,
		   d'où un bouton toujours accessible plutôt qu'un badge d'après-coup.
		   Réservé aux fournisseurs qui publient réellement un forfait — et aux
		   hôtes qui savent le lire (`deps.usage`, le greffon seul). */
		const usage = deps.usage;
		if (usage && host.platform.isDesktopApp && providerPublishesPlan(settings().aiProvider || "")) {
			const usageBtn = ajouter(composerBottom, "button", "qbd-ai-composer-usage");
			usageBtn.type = "button";
			host.ui.setIcon(usageBtn, "gauge");
			labelIconButton(usageBtn, t("ai.usage.title"));
			attachHoverTip(usageBtn, (tip) => {
				ajouter(tip, "div", "qbd-hover-tip-title", t("ai.usage.title"));
				const tightest = tightestRow(lastPlan?.rows || []);
				if (tightest) {
					ajouter(tip, "div", "qbd-hover-tip-body", `${usageRowLabel(tightest)} · ${t("ai.usage.usedPercent", { n: Math.round(tightest.usedPercent) })}`);
				}
			});
			usageBtn.addEventListener("click", () => void openUsage(usage));
		}

		// Groupe droite : logo fournisseur, sélecteur modèle + effort, puis
		// bouton d'envoi.
		const composerTools = ajouter(composerBottom, "div", "qbd-ai-composer-tools");
		buildProviderControl(composerTools);
		if (buildModelControl) buildModelControl(composerTools);
		// L'icône Options est à droite du modèle (2026-09-23).
		composerTools.appendChild(optsBtn);

		// Bouton générer dans le composer (façon bouton d'envoi claude.ai) :
		// caché tant que le champ est vide, flèche ↑ blanche sur fond accent.
		// Il reste un bouton d'ENVOI pendant une génération : l'arrêt vit sur
		// la ligne de la file (■).
		const sendBtn = ajouter(composerTools, "button", "qbd-ai-composer-send");
		sendBtn.type = "button";
		const sendIcon = ajouter(sendBtn, "span", "qbd-ai-composer-send-icon");
		if (aiProviders.estCanalWeb(provider)) {
			/* Sur un canal web, le bouton n'ENVOIE pas : il OUVRE le site, avec
			   la question déjà écrite. Deux gestes différents méritent deux
			   boutons différents — d'où le libellé, là où la flèche seule
			   promettrait une génération qui ne part pas d'ici. `startGeneration`
			   bifurque vers `ouvrirSite`, qui dit « non câblé » pour les canaux
			   web sans adresse mesurée (chatgpt.com, perplexity.ai). */
			sendBtn.classList.add("qbd-ai-composer-send--wide");
			host.ui.setIcon(sendIcon, "external-link");
			ajouter(sendBtn, "span", "qbd-ai-composer-send-label", t("ai.composer.open"));
			sendBtn.addEventListener("click", () => {
				if (canGenerate()) void startGeneration(containerRef);
			});
		} else {
			sendBtn.setAttribute("aria-label", t("ai.composer.generate"));
			host.ui.setIcon(sendIcon, "arrow-up");
			sendBtn.addEventListener("click", () => {
				/* Le ■ de claude.ai : composer vide pendant une génération, le
				   bouton ARRÊTE celle qui tourne (`updateGenerateBtn`). */
				if (sendBtn.classList.contains("qbd-ai-composer-send--stop")) {
					const enCours = runningLineOfChat(fileGen.lignes(), activeChatId());
					if (enCours) fileGen.annuler(enCours.id);
					return;
				}
				if (canGenerate()) void startGeneration(containerRef);
			});
		}
		generateBtnRef = sendBtn;
		boutonEnvoi = sendBtn;
		updateGenerateBtn(generateBtnRef);

		// PAS d'attribut accept : le dialogue Windows affiche alors « Tous
		// les fichiers (*.*) » (référence claude.ai, capture Ahmed) au lieu
		// d'une liste d'extensions illisible — la validation par type se
		// fait dans addComposerFiles, avec explication en cas de refus.
		const fileInput = ajouter(composer, "input", "qbd-ai-file-input");
		fileInput.type = "file";
		fileInput.multiple = true;
		fileInput.addEventListener("change", (e) => {
			const target = e.target as HTMLInputElement;
			if (target.files?.length) addComposerFiles(Array.from(target.files));
			// Re-choisir le même fichier doit re-déclencher `change`.
			target.value = "";
		});
		fileInputRef = fileInput;

		/* Le « + » ouvre son MENU, réplique de celui de claude.ai (2026-09-26) :
		   « Ajouter des fichiers ou des images » avec le raccourci, une note
		   du vault, la mention « @ ». */
		addBtn.addEventListener("click", () => ouvrirMenuPlus(addBtn, {
			raccourci: formatHotkey(settings().hotkeyAddFiles),
			ajouterFichiers: openAddFiles,
			champ: composerInput
		}));

		// Toute la carte est cliquable pour écrire (demande 2026-07-10) :
		// un clic hors des contrôles focus le champ, caret en fin de texte.
		// mousedown natif du textarea préservé (positionnement du caret).
		composer.addEventListener("mousedown", (e) => {
			if ((e.target as HTMLElement).closest("button, textarea, .qbd-select, .qbd-ai-note-chip")) return;
			e.preventDefault(); // pas de blur/re-focus visible
			const len = composerInput.value.length;
			composerInput.focus();
			composerInput.setSelectionRange(len, len);
			composerCaret = len;
		});

		// Glisser-déposer de fichiers (images, .md, .txt) sur tout le composer
		composer.addEventListener("dragover", (e) => {
			e.preventDefault();
			if (!provider) return;
			composer.classList.add("qbd-ai-composer--dragover");
		});
		composer.addEventListener("dragleave", () => composer.classList.remove("qbd-ai-composer--dragover"));
		composer.addEventListener("drop", (e) => {
			e.preventDefault();
			composer.classList.remove("qbd-ai-composer--dragover");
			if (!provider) return;
			if (e.dataTransfer?.files?.length) addComposerFiles(Array.from(e.dataTransfer.files));
		});

		/* SANS FOURNISSEUR, le composer est INERTE (demande du 2026-09-23) :
		   rien ne se tape, ne se joint, ne se règle tant qu'aucun canal n'est
		   choisi — sans quoi on rédige une demande qui ne peut partir nulle
		   part. Seul le bouton du fournisseur reste actif, et une bulle posée
		   juste au-dessus de lui le désigne. Choisir un fournisseur redessine
		   tout le composer (`render`) : l'état se pose donc une seule fois. */
		if (!provider) {
			composer.classList.add("qbd-ai-composer--sans-fournisseur");
			composerInput.disabled = true;
			addBtn.disabled = true;
			optsBtn.hidden = true;
			// Posé par buildProviderControl, dans une fermeture : TS ne le voit pas.
			const bouton = (providerSelect as ProviderControl | null)?.el;
			if (bouton) {
				const bulle = ajouter(composerTools, "button", "qbd-ai-provider-nudge", t("ai.provider.choose"));
				bulle.type = "button";
				bulle.addEventListener("click", () => ouvrirMenuFournisseur?.());
				// Centrée sur le bouton, mesurée une fois le composer dans le document.
				requestAnimationFrame(() => {
					bulle.style.left = `${bouton.offsetLeft + bouton.offsetWidth / 2 - bulle.offsetWidth / 2}px`;
					bulle.classList.add("is-placed");
				});
			}
		}

		// Le raccourci « Ajouter des fichiers » : dans l'application, rien ne
		// le liait depuis la tâche 1 du greffon lecteur — le menu affichait un
		// raccourci mort. Posé sur le conteneur de la page, relu à chaque frappe
		// (le réglage peut changer), retiré dans `dispose`.
		if (raccourciComposer) raccourciComposer.retirer();
		const surTouche = (e: KeyboardEvent): void => {
			/* L'input de fichier n'existe que tant que la page « Générer » est
			   rendue ; le conteneur, lui, est PARTAGÉ par toutes les vues
			   (tâche 8) et survit à la navigation. Sans cette garde, `openAddFiles`
			   préférant désormais le dialogue natif (sans le repli
			   `fileInputRef.isConnected` de `fileInput.click()`), Ctrl+E depuis
			   une autre page ouvrirait quand même un dialogue de fichiers. */
			if (!fileInputRef || !fileInputRef.isConnected) return;
			if (!(settings().aiProvider || "")) return;
			const hk = eventToHotkey(e);
			const voulu = settings().hotkeyAddFiles;
			if (!hk || !voulu || hk.key !== voulu.key) return;
			const a = [...(hk.modifiers || [])].sort().join("+");
			const b = [...(voulu.modifiers || [])].sort().join("+");
			if (a !== b) return;
			e.preventDefault();
			openAddFiles();
		};
		container.addEventListener("keydown", surTouche);
		raccourciComposer = { retirer: () => container.removeEventListener("keydown", surTouche) };

		// La notice des autres liens (spec « Vidéos YouTube » § 5.4) : SOUS
		// le composer, une ligne discrète qui dit qu'un lien http(s) non
		// YouTube ne sera pas lu — sans jamais bloquer l'envoi. Vide (CSS
		// :empty) tant qu'aucun tel lien n'est écrit.
		zoneNoticeVideo = ajouter(formCol, "div", "qbd-ai-video-notice");
		tuilesVideo.rendreNotice(zoneNoticeVideo);

		// Hint contextuel du fournisseur (CLI absent, serveur offline…) :
		// sous le composer depuis la suppression de la carte « Modèle IA ».
		// :empty → masqué ; rempli par refreshProviderStatuses/renderHint.
		if (provider) hintZone = ajouter(formCol, "div", "qbd-ai-model-hint");

		/* "Update available" for Claude Code and Codex (`cli-updates.ts`):
		   after an update, the providers and their models are read again. */
		if (provider) monterBandeauMaj(formCol, () => refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList, force: true }), { copyText: deps.copyText });

		/* Hors conversation (un site ou une connexion tient la page), les tours
		   de la file restent sous le composer ; la page d'un quiz ouvert
		   (`result`) ne les montre pas — rien ne s'y perd, on les retrouve en
		   revenant. */
		if (!conversation && phase !== "result") vueFile.rendre(formCol);

		// Détections async (statut fournisseur + modèles réels) : APRÈS la
		// création de hintZone — l'appel fige ses arguments, et un hintZone
		// encore null rendait renderHint muet : « ChatGPT sélectionné, CLI
		// absent, aucun message » (vécu Ahmed, Codex CLI). Aussi après le
		// contrôle modèle (modelSelect existe). ollamaCtl et buildOllamaList
		// sont locaux à render → passés en paramètres (les référencer depuis
		// la fonction sœur lançait un ReferenceError, statut Ollama gelé).
		refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList });

		// Retour de focus fenêtre = l'utilisateur revient du terminal où il
		// vient d'installer/connecter un CLI : re-vérifier automatiquement
		// tant qu'un problème est affiché — sinon le hint d'erreur reste
		// figé et « l'installation n'est pas détectée » (vécu Codex CLI).
		if (__focusRecheck) window.removeEventListener("focus", __focusRecheck);
		__focusRecheck = () => {
			if (!hintZone || !hintZone.isConnected) {
				if (__focusRecheck) window.removeEventListener("focus", __focusRecheck);
				__focusRecheck = null;
				return;
			}
			const aCompte = ["claude-code", "codex", "ollama"].includes(settings().aiProvider || "");
			if (!aCompte && !hintZone.querySelector(".qbd-ai-hint--err, .qbd-ai-hint--warn")) return;
			refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList, force: true });
		};
		window.addEventListener("focus", __focusRecheck);

		// (Les options Questions/Type vivent dans le popover du bouton
		// sliders du composer — l'ancienne carte « Options » est supprimée.)

		// ── État de la scène : loader AU-DESSUS du composer, erreur sous
		// le composer, ou l'éditeur embarqué dans la zone résultat. ──
		if (phase === "result") renderResult(resultZone!);
		synchroniserModales();

		// Onglet ouvert → saisie immédiate sans clic (demande 2026-07-10).
		// Pas en phase résultat : le focus serait volé à l'éditeur embarqué
		// à chaque re-render.
		if (phase === "idle" || phase === "error") {
			requestAnimationFrame(() => {
				if (composerInput.isConnected) {
					composerInput.focus({ preventScroll: true });
					if (composerCaret !== null) {
						const p = Math.min(composerCaret, composerInput.value.length);
						composerInput.setSelectionRange(p, p);
					}
				}
			});
		}

		/* Les sources du préréglage, jointes UNE fois, par le même chemin que
		   le picker « @ » (`attachVaultPath` : note, PDF par l'hôte, image).
		   La liste est vidée AVANT de joindre : `attachVaultPath` provoque des
		   re-rendus, et une liste encore pleine se rejouerait à chacun. Dans
		   l'ORDRE, pas en parallèle — deux lectures de PDF de front doublent la
		   mémoire pour rien, et l'ordre des chips est celui du dossier. */
		if (aJoindre.length > 0) {
			const sources = aJoindre;
			aJoindre = [];
			const doitLancer = lancerApresJointes;
			lancerApresJointes = false;
			const epoque = epochPreset;
			void (async () => {
				for (const path of sources) {
					// Un autre préréglage est arrivé : ses pièces remplacent
					// celles-ci, on n'en joint pas une de plus.
					if (epoque !== epochPreset) return;
					await attachVaultPath(path);
				}
				if (epoque !== epochPreset) return;
				/* Pas de génération hors de l'écran : si l'on a quitté
				   « Générer » pendant la jonction, les pièces restent dans le
				   composer et l'envoi attend un geste. */
				if (doitLancer && stageRef?.isConnected && canGenerate()) void startGeneration(containerRef);
			})();
		} else if (lancerApresJointes) {
			// Dossier sans document à joindre (préréglage sans pièce) : lancer
			// directement, une seule fois.
			lancerApresJointes = false;
			if (stageRef?.isConnected && canGenerate()) void startGeneration(containerRef);
		}
	}

	/* Derniers statuts connus par provider : { dot, text }.
	   Lus par le sélecteur de fournisseur (trigger + options). */
	const providerStatus: Record<string, ProviderStatusEntry> = {};

	/* Les options du sélecteur de fournisseur, reconstruites à chaque appel :
	   `disabled` suit `providerStatus`, rempli en asynchrone (setStatus la
	   rappelle dès qu'un statut arrive), donc un fournisseur qui échoue pendant
	   que le menu est déjà construit devient bien non sélectionnable. Extraite
	   ici pour ne calculer qu'UNE fois la règle (« err » → désactivé), appelée
	   par buildProviderControl comme par setStatus. */
	/* Les MARQUES du menu, chacune avec ses canaux. Le sous-titre d'un canal
	   est son STATUT quand on en a un (« Claude Code CLI 2.1.4 » en dit plus
	   que « Sur ta machine ») et son libellé générique sinon — un site n'a
	   rien à détecter, il n'aura donc jamais de statut. */
	function optionsMarques(secondaires = false): ProviderBrandOption[] {
		/* Les canaux PAYANTS masqués (Réglages) sortent du menu : un canal
		   gratuit n'y entre jamais (canalVisible le garantit), un canal
		   inconnu non plus. Le réglage brut est relu à CHAQUE ouverture —
		   c'est lui qui décide, pas une copie figée au rendu du composer. */
		const masques = settings().aiCanauxPayantsMasques;
		return aiProviders.MARQUES.filter(m => !!m.secondaire === secondaires).map(m => ({
			value: m.id,
			label: m.name,
			logo: m.logo,
			channels: m.canaux.filter(c => aiProviders.canalVisible(c.id, masques)).map(c => ({
				value: c.id,
				label: c.label,
				sub: providerStatus[c.id]?.text || c.sub,
				// Le logo du CANAL s'il en a un (Claude Code, Codex,
				// Antigravity), sinon celui de la marque — la ligne web montre
				// donc le logo de marque déjà présent, le CLI le sien propre
				// (Ahmed, 2026-09-21).
				logo: c.logo || m.logo,
				// La ligne de marque nomme le SITE en usage (« claude.ai »), pas
				// « Dans votre navigateur » — ça, c'est le flyout qui le dit.
				resume: c.type === "web" ? c.label : undefined,
				// La pastille « Gratuit » uniquement sur les canaux gratuits :
				// un canal payant se lit à l'ABSENCE de pastille (décision du
				// 2026-09-22, cf. `Canal.gratuit`).
				badge: c.gratuit ? t("ai.badge.free") : undefined,
				disabled: providerStatus[c.id]?.dot === "err",
				// Pastille SEULEMENT quand quelque chose ne va pas (demande
				// d'Ahmed, 2026-09-17) : orange « ça marcherait, mais le serveur
				// est arrêté », rouge « absent ». Un fournisseur qui répond n'en
				// porte pas — sa version dans le sous-titre le dit déjà.
				dot: providerStatus[c.id]?.dot ?? null
			}))
		}));
	}

	/* Dernier hint connu par provider (null = rien à signaler). Le sélecteur
	   affiche déjà le statut de CHAQUE fournisseur : le hint correspondant est
	   donc calculé pour tous, pas seulement pour l'actif, et ré-affiché
	   instantanément au changement de fournisseur — plus d'attente de la
	   détection avant de voir « Ollama n'est pas installé ». La détection
	   continue de tourner derrière et corrige l'affichage si l'état a changé. */
	const providerHint: Record<string, HintOptions | null> = {};

	function setHint(id: string, zone: HTMLElement | null, active: string, opts: HintOptions | null): void {
		providerHint[id] = opts;
		/* LA ZONE COURANTE, pas celle qu'on tenait : une sonde part d'un rendu
		   et revient après le suivant. Rendue dans la zone morte de l'ancien,
		   sa réponse n'atteignait pas l'écran — et le nouveau rendu, dessiné
		   entre-temps d'après `providerHint`, gardait « pas connecté » alors
		   que le compte venait de l'être (vu le 2026-09-20 après une
		   installation d'Antigravity). */
		const cible = zone && zone.isConnected ? zone : (containerRef?.querySelector<HTMLElement>(".qbd-ai-model-hint") ?? null);
		if (id === active) renderHint(cible, opts);
	}

	/** Ce que `sonderPlansOllama` a besoin de toucher dans le contrôle Ollama de
	    la CE render en cours : `ollamaCtl` et `buildOllamaList` sont des locales
	    de `render()`, jamais visibles depuis `verifierCompte` (top-level de
	    cette closure) sans être passées explicitement — même raison que
	    `RefreshArgs` un peu plus haut. */
	type OllamaSondeArgs = { ctl: OllamaCtl | null; buildList: (detected: aiProviders.OllamaDetectedModel[] | null) => OllamaListItem[] };

	/** Le premier modèle de `principal` (jamais hors plan par construction) —
	    ou `undefined` si la répartition ne laisse rien, cas dégénéré. */
	function premierModeleInclus(args: OllamaSondeArgs): OllamaListItem | undefined {
		const liste = args.buildList(args.ctl?.detected ?? null);
		const { principal } = aiProviders.repartirParPlan(liste, settings().aiOllamaPlanCompte || "", settings().aiOllamaPlansAppris || {});
		return principal[0];
	}

	/**
	 * Le catalogue cloud SE RAFRAÎCHIT TOUT SEUL. Il vivait dans l'onglet de
	 * réglages du greffon (bouton « rafraîchir » + tâche de fond à
	 * l'ouverture), retiré au chantier lecteur (d123caa) et jamais reporté :
	 * pendant une semaine `fetchOllamaCloudCatalog` n'a eu aucun appelant, et
	 * le menu est resté sur le repli figé au 2026-08-29 — DeepSeek V4.1 Flash,
	 * sorti le 10 septembre, n'y était pas (Ahmed, 2026-09-20). Ici : à chaque
	 * relecture des statuts avec Ollama choisi, au plus une fois par TTL, en
	 * arrière-plan. Un échec (hors ligne, JSON absent) garde le cache ou le
	 * repli sans un mot : `fetchOllamaCloudCatalog` LÈVE plutôt que de rendre
	 * un catalogue vide, c'est pour ça. Un catalogue neuf reconstruit la liste
	 * du menu et relance la sonde de plan : les familles découvertes n'ont pas
	 * encore de verdict, et sur un compte gratuit elles iraient dans la liste
	 * principale sans badge « Pro » tant qu'on ne les a pas sondées.
	 */
	function rafraichirCatalogueOllama(args: OllamaSondeArgs): void {
		const maintenant = Date.now();
		if (maintenant - catalogueOllamaRafraichiA < CATALOGUE_OLLAMA_TTL) return;
		catalogueOllamaRafraichiA = maintenant;
		void aiProviders.fetchOllamaCloudCatalog().then(async (catalogue) => {
			if (disposed) return;
			const actuel = settings().aiOllamaCatalog;
			const inchange = Array.isArray(actuel) && actuel.length === catalogue.length
				&& actuel.every((m, i) => m.value === catalogue[i].value && m.label === catalogue[i].label);
			if (inchange) return;
			await saveSettings({ aiOllamaCatalog: catalogue });
			if (disposed || (settings().aiProvider || "") !== "ollama") return;
			if (args.ctl) {
				args.ctl.options = args.buildList(args.ctl.detected);
				if (args.ctl.refreshTrigger) args.ctl.refreshTrigger();
			}
			if (settings().aiOllamaPlanCompte === "free") void sonderPlansOllama(args);
		}).catch(() => {
			// Hors ligne, ou ollama.com a changé de forme : on retentera au
			// prochain TTL, et d'ici là le cache ou le repli font l'affaire.
			catalogueOllamaRafraichiA = 0;
		});
	}

	/**
	 * La sonde de plan EN ARRIÈRE-PLAN (tâche 8, correctif de T5) : sur un
	 * compte `free`, `required_plan` des recommandations ne couvre presque
	 * rien (5 modèles) — on SONDE donc chaque modèle cloud à zéro token (voir
	 * `aiProviders.sonderPlanOllama`) au lieu d'attendre un 402 à la
	 * génération. Un par un, JAMAIS en parallèle (un compte gratuit n'a qu'une
	 * requête simultanée sur le démon), et un seul passage à la fois
	 * (`sondePlansEnCours`).
	 */
	async function sonderPlansOllama(args?: OllamaSondeArgs): Promise<void> {
		if (settings().aiOllamaPlanCompte !== "free") return;
		if (sondePlansEnCours) return;
		sondePlansEnCours = true;
		try {
			const catalog = settings().aiOllamaCatalog;
			// Les tags cloud du catalogue complet, PLUS ceux de la sélection et le
			// modèle courant s'il est cloud — un Set déduplique naturellement.
			const tags = new Set<string>();
			for (const m of aiProviders.getOllamaCatalog(catalog)) {
				if (aiProviders.isOllamaCloudModel(m.value)) tags.add(m.value);
			}
			for (const m of aiProviders.resolveOllamaSelection(settings().aiOllamaModels, catalog)) {
				if (m.cloud) tags.add(m.value);
			}
			const curModel = settings().aiModel || "";
			if (aiProviders.isOllamaCloudModel(curModel)) tags.add(curModel);
			// Ce qui est déjà su (verdict "inclus" ou "payant") n'a pas besoin
			// d'être resondé — seul "inconnu" n'est jamais écrit dans les réglages.
			const dejaSu = settings().aiOllamaPlansAppris || {};
			for (const tag of tags) {
				if (dejaSu[tag] === "inclus" || dejaSu[tag] === "payant") continue;
				if (disposed) return;
				const verdict = await aiProviders.sonderPlanOllama(settings().aiOllamaUrl, tag);
				if (disposed) return;
				if (verdict === "inconnu") continue; // rien à retenir
				await saveSettings({ aiOllamaPlansAppris: { ...(settings().aiOllamaPlansAppris || {}), [tag]: verdict } });
				if (args?.ctl) {
					args.ctl.options = args.buildList(args.ctl.detected);
					args.ctl.refreshTrigger?.();
				}
				// Repli : le modèle COURANT vient d'être classé payant. Un modèle
				// hors plan ne se choisit plus depuis le menu (sa ligne mène à la
				// page des prix, Ahmed 2026-09-19) : on ne le laisse jamais réglé.
				if (verdict === "payant" && args && tag === (settings().aiModel || "")) {
					const repli = premierModeleInclus(args);
					if (repli) await saveSettings({ aiModel: repli.value });
				}
			}
		} finally {
			sondePlansEnCours = false;
		}
	}

	/**
	 * Le compte est-il connecté ? Appelée pour le fournisseur ACTIF seulement,
	 * au rendu, au choix du fournisseur et au retour de focus (l'utilisateur
	 * revient du navigateur ou du terminal). Pas connecté → le hint `warn` et
	 * son bouton « Se connecter » ; connecté → rien. Le bouton Envoyer reste
	 * actif : la sonde peut se tromper (CLI d'une version qui ne répond pas au
	 * statut), et la carte d'erreur reste le filet. Le hint PRÉVIENT avant.
	 *
	 * Un hint d'ERREUR déjà posé (outil absent, serveur arrêté) prime : on ne
	 * demande pas de se connecter à un outil qui n'est pas là.
	 */
	function verifierCompte(tool: OutilCompte, hintZone: HTMLElement | null, provider: string, ollamaArgs?: OllamaSondeArgs): void {
		const id = ID_DE_OUTIL[tool];
		if (provider !== id) return;
		if (tool === "ollama" && !aiProviders.isOllamaCloudModel(settings().aiModel || "")) {
			/* Un modèle local n'a pas besoin de compte : si le hint affiché est
			   celui du compte, il tombe. */
			if (providerHint[id]?.icon === "log-in") setHint(id, hintZone, provider, null);
			return;
		}
		const sonde = tool === "ollama"
			? aiProviders.checkOllamaCompte(settings().aiOllamaUrl).then(c => {
				ollamaSigninUrl = c.connecte ? null : c.signinUrl;
				// Le plan est appris par les 402 (ai-client.ts) ; un compte qui
				// CHANGE (autre connexion, upgrade) rend cet appris obsolète.
				if (c.connecte && c.plan !== settings().aiOllamaPlanCompte) {
					void saveSettings({ aiOllamaPlanCompte: c.plan, aiOllamaPlansAppris: {} });
				}
				// La sonde de plan en arrière-plan ne tourne que sur un compte
				// connecté ; elle-même filtre sur le plan "free" (aucune double
				// vérification ici).
				if (c.connecte) void sonderPlansOllama(ollamaArgs);
				return c.connecte;
			})
			: aiProviders.sondeConnexion(tool)();
		void sonde.then(connecte => {
			if (disposed || (settings().aiProvider || "") !== id) return;
			const courant = providerHint[id];
			if (courant && courant.type === "err") return;
			/* Une ATTENTE de connexion est en cours (terminal ou navigateur
			   ouverts) : la carte d'attente le dit déjà. Poser en plus « pas
			   connecté » sous le composer faisait lire un échec avant la réussite
			   (vu avec Codex dans la VM, 2026-09-19). */
			if (!connecte && (phase === "connexion" || loginPoll !== null)) return;
			if (connecte) {
				if (courant?.icon === "log-in") setHint(id, hintZone, provider, null);
				return;
			}
			setHint(id, hintZone, provider, {
				type: "warn", icon: "log-in",
				text: t(`ai.login.reason.${tool}`),
				action: {
					label: t("ai.login.button"), icon: "log-in",
					onClick: () => { void demarrerConnexion(tool, null, "hint"); },
				},
			});
		});
	}

	function setStatus(id: string, providerSelect: ProviderControl | null, dot: string, text: string): void {
		providerStatus[id] = { dot, text };
		// Un fournisseur ABSENT ne se sélectionne pas — mais un `aiProvider`
		// persisté n'était jamais revalidé : les réglages survivent à une
		// désinstallation (voulu), et une VM réinstallée affichait « GPT-5.6 »
		// avec le Codex CLI manquant (vécu 2026-09-17). La sélection retombe
		// à « aucun », comme si l'on n'avait jamais choisi.
		if (dot === "err" && settings().aiProvider === id) {
			void saveSettings({ aiProvider: "", aiModel: "" }).then(() => render(containerRef));
			return;
		}
		// Redessine les options du menu s'il est ouvert (versions re-détectées à
		// l'ouverture, et `disabled` recalculé : un fournisseur peut passer en
		// erreur — ou en sortir — pendant que le menu est déjà construit).
		if (providerSelect && providerSelect.el.isConnected) providerSelect.refreshMenu();
	}

	/* Le modal d'un fournisseur absent — ouvert depuis l'option du menu (qui
	   ne se sélectionne pas) comme depuis le bouton du hint. Sur détection, le
	   fournisseur devient celui des réglages ; à la fermeture, statuts et
	   hints sont relus pour que le menu dise le nouvel état. */
	function ouvrirModalInstallation(id: InstallProvider, rafraichir: () => void): void {
		/* CHAQUE fournisseur a SA sonde : celle d'Antigravity retombait sur
		   Ollama, qui tourne ici — le modal disait « détecté » sans rapport
		   avec `agy`, et rien n'enchaînait (vécu le 2026-09-20). */
		const probe = id === "claude-code" ? () => aiProviders.checkClaudeCode(true)
			: id === "codex" ? () => aiProviders.checkCodex(true)
			: id === "antigravity-cli" ? () => aiProviders.checkAntigravity(true)
			: () => aiProviders.checkOllama(settings().aiOllamaUrl, true);
		openInstallModal({
			provider: id,
			probe: async () => {
				const res = await probe();
				return res.ok ? { ok: true, version: "version" in res ? res.version : undefined } : { ok: false };
			},
			onDetected: async () => {
				annulerConnexion();
				if (settings().aiProvider === id) return;
				await saveSettings({ aiProvider: id, aiModel: aiProviders.getProvider(id).defaultModel });
			},
			/* Statuses and hints are re-read. No sign-in wait is chained any
			   more (2026-09-30): it was the automatic install's terminal that
			   signed in, and there is none. If the tool is not signed in, the
			   page shows its usual "Sign in" hint. */
			onClose: () => {
				rafraichir();
				render(containerRef);
			},
			copyText: deps.copyText,
			renderCodeBlock: deps.renderCodeBlock,
		});
	}

	/**
	 * Le modal qui montre le bandeau que le site affichera, aux couleurs du
	 * site, et dit pourquoi il est là. Ouvert au CHOIX du canal (demande
	 * d'Ahmed, 2026-09-18 : « à la place [du callout dans la carte], on ne
	 * devrait le voir que lorsque l'on sélectionne claude.ai »), et plus dans
	 * la carte d'attente. « Ne plus afficher » est un tableau de canaux dans
	 * les réglages : chaque site aura peut-être le sien.
	 */
	function ouvrirAvertissementWeb(canalId: string): void {
		const canal = aiProviders.getCanal(canalId);
		if (!canal || !canal.avertissement) return;
		if ((settings().aiWebAvertissementMasque || []).includes(canalId)) return;
		const site = canal.label;
		let masquer = false;
		requireHost("modals").open({
			className: "qbd-web-warn-modal",
			title: t("ai.web.warnTitle", { site }),
			onOpen: (m) => {
				const c = m.contentEl;
				const callout = ajouter(c, "div", "qbd-web-warn-callout");
				host.ui.setIcon(ajouter(callout, "span", "qbd-web-warn-callout-icon"), "triangle-alert");
				ajouter(callout, "p", "qbd-web-warn-callout-text", t("ai.web.callout", { site }));
				const row = ajouter(c, "label", "qbd-web-warn-dismiss");
				const box = ajouter(row, "input") as HTMLInputElement;
				box.type = "checkbox";
				box.addEventListener("change", () => { masquer = box.checked; });
				ajouter(row, "span", undefined, t("ai.web.warnDismiss"));
				const actions = ajouter(c, "div", "qbd-web-warn-actions");
				const ok = ajouter(actions, "button", "qbd-btn--create", t("ai.web.warnOk"));
				ok.type = "button";
				ok.addEventListener("click", () => m.close());
			},
			onClose: () => {
				if (!masquer) return;
				const liste = [...(settings().aiWebAvertissementMasque || [])];
				if (!liste.includes(canalId)) liste.push(canalId);
				void saveSettings({ aiWebAvertissementMasque: liste });
			},
		});
	}

	/* Hint contextuel sous la rangée modèle : icône + texte
	   + action optionnelle (lien externe, réglages, commande).
	   Grille : [icône | texte | action]. */
	function renderHint(zone: HTMLElement | null, opts: HintOptions | null): void {
		if (!zone || !zone.isConnected) return;
		zone.replaceChildren();
		if (!opts) return;
		const hint = ajouter(zone, "div", "qbd-ai-hint qbd-ai-hint--" + (opts.type || "info"));
		const icon = ajouter(hint, "span", "qbd-ai-hint-icon");
		host.ui.setIcon(icon, opts.icon || (opts.type === "err" ? "alert-circle" : "info"));
		const body = ajouter(hint, "div", "qbd-ai-hint-body");
		ajouter(body, "span", "qbd-ai-hint-text", opts.text);
		if (opts.action) {
			const btn = ajouter(hint, "button", "qbd-ai-hint-action");
			btn.type = "button";
			if (opts.action.icon) {
				const aIcon = ajouter(btn, "span", "qbd-ai-hint-action-icon");
				host.ui.setIcon(aIcon, opts.action.icon);
			}
			ajouter(btn, "span", undefined, opts.action.label);
			btn.addEventListener("click", opts.action.onClick);
		}
	}

	/* Détections async : statut de chaque provider (trigger + menu du
	   sélecteur), et pour le provider actif, hint contextuel + liste
	   réelle de modèles. */
	function refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList, force }: RefreshArgs): void {
		const ollamaUrl = settings().aiOllamaUrl;

		// Affichage IMMÉDIAT du dernier hint connu pour ce fournisseur : les
		// détections ci-dessous ne font que le confirmer ou le corriger.
		if (provider in providerHint) renderHint(hintZone, providerHint[provider]);

		aiProviders.checkClaudeCode(force).then(res => {
			if (res.ok) {
				setStatus("claude-code", providerSelect, "ok", t("ai.status.claudeOk", { version: res.version }));
			} else if (res.reason === "mobile") {
				setStatus("claude-code", providerSelect, "warn", t("ai.status.desktopOnly"));
			} else {
				setStatus("claude-code", providerSelect, "err", t("ai.status.claudeMissing"));
			}
			if (res.ok) {
				setHint("claude-code", hintZone, provider, null);
				verifierCompte("claude", hintZone, provider);
			} else if (res.reason === "mobile") {
				setHint("claude-code", hintZone, provider, {
					type: "warn", icon: "monitor",
					text: t("ai.hint.claudeDesktopOnly")
				});
			} else {
				setHint("claude-code", hintZone, provider, {
					type: "err", icon: "download",
					text: t("ai.hint.claudeNotInstalled"),
					action: {
						label: t("ai.hint.installClaude"), icon: "download",
						onClick: () => ouvrirModalInstallation("claude-code", () => refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList, force: true }))
					}
				});
			}
		});

		aiProviders.checkCodex(force).then(res => {
			if (res.ok) {
				setStatus("codex", providerSelect, "ok", t("ai.status.codexOk", { version: res.version }));
			} else if (res.reason === "mobile") {
				setStatus("codex", providerSelect, "warn", t("ai.status.desktopOnly"));
			} else {
				setStatus("codex", providerSelect, "err", t("ai.status.codexMissing"));
			}
			if (res.ok) {
				setHint("codex", hintZone, provider, null);
				verifierCompte("codex", hintZone, provider);
			} else if (res.reason === "mobile") {
				setHint("codex", hintZone, provider, {
					type: "warn", icon: "monitor",
					text: t("ai.hint.codexDesktopOnly")
				});
			} else {
				// « Codex CLI », jamais « Codex » nu : l'APPLICATION Codex
				// (bureau) n'installe pas la commande « codex » — l'installer
				// ne détecte rien (vécu Ahmed 2026-07-12). Commande = celle
				// de l'installateur OFFICIEL de la plateforme
				// (learn.chatgpt.com, « la meilleure méthode » — choix
				// Ahmed) ; npm reste détecté aussi.
				setHint("codex", hintZone, provider, {
					type: "err", icon: "download",
					text: t("ai.hint.codexNotInstalled"),
					action: {
						label: t("ai.hint.installCodex"), icon: "download",
						onClick: () => ouvrirModalInstallation("codex", () => refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList, force: true }))
					}
				});
			}
		});

		/* ANTIGRAVITY — même patron que Codex, à une chose près, qui vient du
		   CLI lui-même : il n'a AUCUNE sonde de connexion non interactive (ses
		   identifiants vont au gestionnaire d'identifiants Windows), donc pas
		   de `verifierCompte` ici. Un compte non connecté se découvre à la
		   génération, où le message dit quoi faire ; the sign-in itself goes
		   through the "Sign in" hint once the tool is installed. */
		aiProviders.checkAntigravity(force).then(res => {
			if (res.ok) {
				setStatus("antigravity-cli", providerSelect, "ok", t("ai.status.antigravityOk", { version: res.version }));
			} else if (res.reason === "mobile") {
				setStatus("antigravity-cli", providerSelect, "warn", t("ai.status.desktopOnly"));
			} else {
				setStatus("antigravity-cli", providerSelect, "err", t("ai.status.antigravityMissing"));
			}
			if (res.ok) {
				setHint("antigravity-cli", hintZone, provider, null);
				// Installé : le compte est-il connecté ? (même filet que Claude
				// et Codex — le hint « pas connecté » avec son bouton).
				verifierCompte("agy", hintZone, provider);
			} else if (res.reason === "mobile") {
				setHint("antigravity-cli", hintZone, provider, {
					type: "warn", icon: "monitor",
					text: t("ai.hint.antigravityDesktopOnly")
				});
			} else {
				setHint("antigravity-cli", hintZone, provider, {
					type: "err", icon: "download",
					text: t("ai.hint.antigravityNotInstalled"),
					action: {
						label: t("ai.hint.installAntigravity"), icon: "download",
						onClick: () => ouvrirModalInstallation("antigravity-cli", () => refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList, force: true }))
					}
				});
			}
		});

		// Le catalogue cloud vient d'ollama.com, pas du démon local : il se
		// rafraîchit que le serveur réponde ou non (un démon arrêté n'empêche
		// pas de voir la liste à jour une fois démarré).
		if (provider === "ollama") rafraichirCatalogueOllama({ ctl: ollamaCtl, buildList: buildOllamaList });
		aiProviders.checkOllama(ollamaUrl, force).then(async (res) => {
			if (res.ok) {
				// Affiche la version d'Ollama installée (comme Claude/Codex), ex.
				// « Ollama v0.31.2 ». Repli sur l'état du cache si version absente.
				const n = res.models.length;
				// Deux clés plutôt qu'un pluriel calculé : « local » ne s'accorde
				// qu'en français, et c'est à chaque langue de le décider.
				const fallback = n > 0
					? t(n > 1 ? "ai.status.ollamaLocalMany" : "ai.status.ollamaLocalOne", { count: n })
					: t("ai.status.ollamaCloudReady");
				setStatus("ollama", providerSelect, "ok", res.version ? t("ai.status.ollamaOk", { version: res.version }) : fallback);
				// Conditionné : sinon chaque re-détection (toutes les
				// `CLAUDE_CODE_TTL`) effacerait le hint du compte posé par
				// `verifierCompte` juste après.
				if (providerHint["ollama"]?.icon !== "log-in") setHint("ollama", hintZone, provider, null);
				if (provider !== "ollama") return;
				// Reconstruit les options (sélection + locaux réellement installés,
				// avec capability thinking) et rafraîchit le libellé du contrôle. Le
				// badge « Pro » vient du verdict appris (sonde + 402) : voir
				// `buildOllamaList` et `sonderPlansOllama`.
				if (ollamaCtl) {
					ollamaCtl.detected = res.models;
					ollamaCtl.options = buildOllamaList(res.models);
					if (ollamaCtl.refreshTrigger) ollamaCtl.refreshTrigger();
				}
				verifierCompte("ollama", hintZone, provider, { ctl: ollamaCtl, buildList: buildOllamaList });
				// Second point d'appel : le plan persiste d'une session à l'autre, et
				// `verifierCompte` ne sonde pas quand le modèle COURANT est local (pas
				// besoin de compte) — sans cette ligne, un compte free resterait sur un
				// menu non trié tant qu'aucun modèle cloud n'a été choisi. Sans effet
				// s'il n'y a plus rien à sonder (tout appris) ou si un passage tourne déjà.
				if (settings().aiOllamaPlanCompte === "free") void sonderPlansOllama({ ctl: ollamaCtl, buildList: buildOllamaList });
			} else {
				// Le plugin DIAGNOSTIQUE lui-même (demande Ahmed : jamais
				// de « Serveur non détecté » sec ni de « si Ollama n'est
				// pas installé » laissé à l'utilisateur) — le diagnostic
				// sert le STATUT du menu fournisseur ET le hint :
				// installé mais arrêté → « Démarrer Ollama » (le plugin
				// lance l'app et re-render dès que le serveur répond) ;
				// absent → « Télécharger Ollama ».
				const inst = await aiProviders.checkOllamaInstalled(force);
				setStatus("ollama", providerSelect,
					inst.installed ? "warn" : "err",
					inst.installed ? t("ai.status.serverStopped") : t("ai.status.notInstalled"));
				if (inst.installed) {
					setHint("ollama", hintZone, provider, {
						type: "warn", icon: "server-off",
						text: t("ai.hint.ollamaServerOff"),
						action: {
							label: t("ai.hint.startOllama"), icon: "circle-play",
							onClick: () => {
								// ASYNCHRONE depuis la tranche 5 (dans l'application,
								// le démarrage traverse l'IPC) : rien à attendre ici,
								// c'est le poll ci-dessous qui constate le résultat.
								void aiProviders.startOllamaApp();
								// Poll : vert automatique dès que le
								// serveur répond (10 s max).
								let tries = 0;
								if (ollamaPoll) window.clearInterval(ollamaPoll);
								ollamaPoll = window.setInterval(() => {
									tries++;
									// force : le serveur vient de démarrer, le cache
									// de détection dirait encore « injoignable ».
									aiProviders.checkOllama(ollamaUrl, true).then(r2 => {
										if (!r2.ok && tries < 10) return;
										if (ollamaPoll) { window.clearInterval(ollamaPoll); ollamaPoll = null; }
										if (r2.ok) render(containerRef);
									});
								}, 1000);
							}
						}
					});
				} else {
					setHint("ollama", hintZone, provider, {
						type: "err", icon: "download",
						text: t("ai.hint.ollamaNotInstalled"),
						action: {
							label: t("ai.hint.installOllama"), icon: "download",
							onClick: () => ouvrirModalInstallation("ollama", () => refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList, force: true }))
						}
					});
				}
			}
		});
	}

	function addImageFiles(files: File[]): void {
		for (const file of files) {
			if (!file.type.startsWith("image/")) continue;
			images.push({ file, url: URL.createObjectURL(file) });
		}
		render(containerRef);
	}

	/* Retire la dernière pièce jointe (bonus Backspace, cf. keydown du
	   composer). Priorité à la dernière NOTE : c'est elle qui vit
	   visuellement contre le caret (chip superposée à la 1ʳᵉ ligne, ou
	   repliée juste au-dessus) ; à défaut, la dernière image. */
	function removeLastAttachment(): void {
		if (noteAttachments.length > 0) {
			noteAttachments.pop();
		} else if (images.length > 0) {
			const removed = images.pop();
			if (removed) URL.revokeObjectURL(removed.url);
		} else {
			return;
		}
		render(containerRef);
	}

	/* Route les fichiers du picker/drop : images → vignettes (vision),
	   texte (.md/.txt) et PDF (texte extrait localement) → sources texte
	   (mêmes chips que les notes). Autres formats : refusés avec
	   explication.
	   `origin` : connu SEULEMENT quand l'appelant sait d'où vient le fichier
	   (attachVaultPath / attachExternalPath, toujours UN seul fichier à la
	   fois) — sinon (menu « + », glisser-déposer, plusieurs fichiers
	   possibles) la pièce est de source « file », dédoublonnée par nom
	   seul faute de chemin connu. Dédoublonnage centralisé via
	   attachmentKey : un doublon ignoré produit une Notice EXACTE (jamais
	   un skip silencieux — régression corrigée ici). */
	async function addComposerFiles(
		files: File[],
		origin?: { source: "vault" | "external"; path: string },
		// Preset epoch of the ORIGINAL caller (it may have awaited a disk read
		// already); by default, the epoch at the time of this call.
		epoque: number = epochPreset
	): Promise<void> {
		const imgs: File[] = [];
		const rejected: string[] = [];
		const lectures: Promise<void>[] = [];
		const source: AttachmentSource = origin?.source ?? "file";
		for (const file of files) {
			if (file.type.startsWith("image/")) {
				imgs.push(file);
			} else if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
				// La carte paraît tout de suite, la lecture suit (`joindrePdf`).
				lectures.push(joindrePdf(file.name, async () => new Uint8Array(await file.arrayBuffer()), source, origin?.path));
			} else if (/\.(md|txt)$/i.test(file.name) || file.type.startsWith("text/")) {
				try {
					const content = await file.text();
					// A read started before a preset must not land in the new preset's composer.
					if (epoque !== epochPreset) return;
					const key = attachmentKey({ source, path: origin?.path, name: file.name });
					if (noteAttachments.some(n => attachmentKey(n) === key)) {
						host.ui.notice(t("ai.notice.noteAlreadyAttached", { name: file.name }));
					} else {
						noteAttachments.push({ name: file.name, content, path: origin?.path, source });
					}
				} catch (e) {
					rejected.push(file.name);
				}
			} else {
				rejected.push(file.name);
			}
		}
		// Same guard after the last await: a stale batch adds nothing (no notice either).
		if (epoque !== epochPreset) return;
		if (imgs.length) {
			addImageFiles(imgs); // render inclus
		} else {
			render(containerRef);
		}
		if (rejected.length) {
			host.ui.notice(t("ai.notice.unsupportedFormat", { files: rejected.join(", ") }));
		}
		await Promise.all(lectures);
	}

	/* Attache une note du vault comme source du quiz (menu « Ajouter des
	   notes » et raccourci — remplace l'ancienne « note active »). */
	async function attachNoteVaultFile(file: HostFile): Promise<void> {
		// Dédoublonnage par attachmentKey (source « vault » + path), PAS par
		// name seul : sinon un « AGENTS.md » du vault percute à tort un
		// « AGENTS.md » externe/déposé de contenu différent (régression
		// corrigée ici — cf. rapport de tâche).
		const epoque = epochPreset;
		const key = attachmentKey({ source: "vault", path: file.path, name: file.name });
		if (noteAttachments.some(n => attachmentKey(n) === key)) {
			host.ui.notice(t("ai.notice.noteAlreadyAttached", { name: file.basename }));
			return;
		}
		try {
			const content = await host.fs.read(file.path);
			// A read started before a preset must not land in the new preset's composer.
			if (epoque !== epochPreset) return;
			// file.name (PAS file.basename) : la chip affiche le nom complet
			// AVEC son extension, comme les fichiers .md/.txt/PDF attachés via
			// addComposerFiles (déjà sur file.name).
			noteAttachments.push({ name: file.name, content, path: file.path, source: "vault" });
			render(containerRef);
		} catch (e) {
			host.ui.notice(t("ai.notice.noteReadFailed", { name: file.basename }));
		}
	}

	/* MIME d'après l'extension. Nécessaire quand on fabrique un File depuis
	   le disque ou le vault : addComposerFiles teste file.type EN PREMIER
	   pour les images, et un File sans type finirait en chip texte. */
	function mimeForName(name: string): string {
		const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
		if (ext === "pdf") return "application/pdf";
		if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"].includes(ext)) {
			return "image/" + (ext === "jpg" ? "jpeg" : ext);
		}
		return "text/plain";
	}

	/* Attache un fichier du VAULT choisi via « @ ». Les notes passent par
	   attachNoteVaultFile (qui dédoublonne par attachmentKey et garde le
	   lien vers la note) ; les PDF et images passent par addComposerFiles,
	   seule à savoir extraire un PDF et router une image vers la vision —
	   origin: { source: "vault", path } transmis pour que CE fichier
	   partage le même dédoublonnage cohérent (source « vault » + chemin),
	   pas un dédoublonnage par nom seul qui le confondrait avec un fichier
	   externe homonyme. */
	async function attachVaultPath(path: string): Promise<void> {
		const epoque = epochPreset;
		const f = host.fs.getFile(path);
		if (!f) return;
		const ext = f.extension.toLowerCase();
		if (ext === "md" || ext === "txt") { await attachNoteVaultFile(f); return; }
		// Un PDF : sa carte AVANT la lecture disque.
		if (ext === "pdf") { await joindrePdf(f.name, () => host.fs.readBinary(f.path), "vault", f.path); return; }
		try {
			const octets = await host.fs.readBinary(f.path);
			// A read started before a preset must not land in the new preset's composer.
			if (epoque !== epochPreset) return;
			// `slice()` : un `Uint8Array` sur un tampon partagé n'est pas un `BlobPart`.
			const file = new File([octets.slice()], f.name, { type: mimeForName(f.name) });
			await addComposerFiles([file], { source: "vault", path: f.path }, epoque);
		} catch (e) {
			host.ui.notice(t("ai.notice.noteReadFailed", { name: f.name }));
		}
	}

	/* Attache un fichier hors vault (picker « @ »). On fabrique un File à
	   partir du disque pour réutiliser addComposerFiles tel quel : images,
	   PDF et texte y sont déjà routés. Desktop uniquement (fs).
	   Dédoublonnage par attachmentKey (source « external » + chemin ABSOLU),
	   PAS par nom seul : deux fichiers homonymes de dossiers différents
	   (ex. deux « Styling Coiffure.pdf ») restent deux pièces jointes
	   distinctes, joignables ENSEMBLE — c'était impossible avant (régression
	   corrigée ici, cf. rapport de tâche). Vérifié AVANT la lecture disque :
	   pas de lecture pour un doublon détecté à l'avance. */
	async function attachExternalPath(path: string): Promise<void> {
		if (!host.platform.isDesktopApp) return;
		const epoque = epochPreset;
		const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
		const key = attachmentKey({ source: "external", path, name });
		if (noteAttachments.some(n => attachmentKey(n) === key)) {
			host.ui.notice(t("ai.notice.noteAlreadyAttached", { name }));
			return;
		}
		// Un PDF : sa carte AVANT la lecture disque.
		if (/\.pdf$/i.test(name)) { await joindrePdf(name, () => host.fs.externe.readBinary(path), "external", path); return; }
		try {
			/* Par le contrat (`externe.readBinary`, chemin ABSOLU) : dans
			   l'application, c'est un canal BORNÉ au périmètre, pas un `fs`. */
			const octets = await host.fs.externe.readBinary(path);
			// A read started before a preset must not land in the new preset's composer.
			if (epoque !== epochPreset) return;
			// mimeForName : addComposerFiles teste file.type EN PREMIER pour les
			// images, un File sans type finirait en chip texte au lieu d'une vignette.
			const file = new File([octets.slice()], name, { type: mimeForName(name) });
			await addComposerFiles([file], { source: "external", path }, epoque);
		} catch (e) {
			host.ui.notice(t("ai.notice.noteReadFailed", { name }));
		}
	}

	/* Cible du raccourci Ctrl+E et du clic sur le « + » — actif seulement si
	   le composer est rendu (vue Générer). L'ancien binding par Scope
	   Obsidian a disparu avec la vue dashboard (tâche 2, greffon lecteur) ;
	   l'écoute clavier vit désormais dans `render()`, ci-dessus. */
	function openAddFiles(): void {
		/* Par le dialogue natif quand l'hôte en a un : les chemins reviennent,
		   admis en lecture, et l'aperçu d'un PDF pourra l'OUVRIR. Sans lui, le
		   `<input type="file">` du navigateur, dont le File n'a aucun chemin. */
		const natif = host.fs.externe.pickFiles;
		if (natif) {
			/* Toutes les cartes D'UN COUP (référence claude.ai) : les lectures
			   de PDF, elles, se suivent d'elles-mêmes (`lecturesPdf`). */
			void natif("documents").then(chemins => Promise.all(chemins.map(attachExternalPath)));
			return;
		}
		if (fileInputRef && fileInputRef.isConnected) fileInputRef.click();
	}

	/** Fige la demande qui part. Le composer la GARDE, affichée derrière la
	    modale d'étape et le bouton d'envoi grisé (`updateGenerateBtn`) : il
	    ne se vide qu'au succès (`resetGeneration`). Il y a quinze jours il
	    se vidait pour qu'on « sente » l'envoi ; c'est désormais la modale qui
	    le dit, et un champ vide derrière elle laissait croire la demande
	    effacée (Ahmed, 2026-09-19). Les tableaux sont COPIÉS : la génération
	    lit cette copie, jamais l'état du composer. */
	function takeComposerMessage(jointesVideo: NoteAttachment[] = []): SentMessage {
		dropSentMessage();
		/* Les documents des vidéos YouTube prêtes (la tuile, `prets`) partent
		   comme des notes jointes : mêmes canaux, même bulle — cf. § 5.2. */
		const msg: SentMessage = { text: composerText, notes: [...noteAttachments, ...jointesVideo], images: [...images] };
		sentMessage = msg;
		return msg;
	}

	/** Le composer est-il resté vierge depuis l'envoi ? */
	function composerIsEmpty(): boolean {
		return !composerText.trim() && noteAttachments.length === 0 && images.length === 0;
	}

	/** Rend la demande partie au composer (annulation, réessai). Le composer
	    l'a gardée : il n'y a rien à y remettre, sauf s'il a été vidé entre-
	    temps — alors seulement la copie y retourne. Si une AUTRE demande y
	    est, elle prime et la copie est abandonnée. */
	function restoreComposerMessage(): void {
		if (!sentMessage) return;
		if (!composerIsEmpty()) { dropSentMessage(); return; }
		composerText = sentMessage.text;
		/* Les pièces des vidéos ne deviennent PAS des chips : elles vivent
		   dans leur tuile (toujours là, le texte les recontient) et seraient
		   DOUBLÉES au prochain envoi — une note jointe ET une tuile prête. */
		noteAttachments = sentMessage.notes.filter(n => n.source !== "video");
		images = sentMessage.images;
		sentMessage = null;
	}

	/** Abandonne la demande partie et révoque les URL d'objet de ses images
	    — sauf celles que le composer affiche encore : il partage les mêmes
	    images tant qu'il garde la demande. */
	function dropSentMessage(): void {
		if (!sentMessage) return;
		const affichees = new Set(images.map(img => img.url));
		for (const img of sentMessage.images) if (!affichees.has(img.url)) URL.revokeObjectURL(img.url);
		sentMessage = null;
	}

	function renderError(parent: HTMLElement): void {
		const errorEl = ajouter(parent, "div", "qbd-ai-preview-error");
		const errorIcon = ajouter(errorEl, "div", "qbd-ai-error-icon");
		host.ui.setIcon(errorIcon, "alert-triangle");
		ajouter(errorEl, "p", "qbd-ai-error-title", t("ai.error.title"));

		/* UN compte non connecté n'est pas une panne : réessayer donnerait le
		   même échec, puisque rien n'a changé entre les deux clics. Le bouton
		   devient donc l'action qui MANQUE — ouvrir la connexion — et ne
		   redevient « Réessayer » que si l'hôte ne sait pas ouvrir de terminal
		   (le greffon n'a plus de `process` du tout). */
		const tool = errorLogin;
		// Ollama se connecte par le navigateur (T4) : l'hôte n'a pas besoin de
		// savoir lancer un terminal (`host.process`) pour proposer ce bouton.
		const offreConnexion = !!tool && (tool === "ollama" || !!host.process);
		/* Le message d'échec porte l'INSTRUCTION (« dans un terminal, lancez
		   codex login ») tant que l'utilisateur doit la suivre lui-même. Dès
		   que le bouton la remplace, la garder dirait de faire à la main ce
		   qu'un clic fait — vu à l'écran le 2026-09-18, les deux ensemble. */
		ajouter(errorEl, "p", "qbd-ai-error-msg",
			offreConnexion ? t(`ai.login.reason.${tool as OutilCompte}`) : errorMessage);

		/* La réponse copiée n'était pas un quiz : rouvrir le site (avec un
		   jeton neuf) est la seule action qui a du sens, pas « Réessayer »,
		   qui relancerait une génération que l'application n'a jamais faite. */
		if (errorAction === "reopen" && attenteWebSite) {
			const reopenBtn = ajouter(errorEl, "button", "qbd-btn qbd-btn--ghost qbd-ai-error-retry", t("ai.web.reopen", { site: attenteWebSite }));
			reopenBtn.type = "button";
			reopenBtn.addEventListener("click", () => { relancerApresErreur(); });
			return;
		}

		/* Hors plan : réessayer rendrait le même 402. La seule action qui a du
		   sens est d'aller changer de plan — ou de choisir un autre modèle dans
		   le menu, qui reste ouvert au-dessus. */
		if (errorAction === "upgrade") {
			const upBtn = ajouter(errorEl, "button", "qbd-btn qbd-btn--ghost qbd-ai-error-retry", t("ai.upgrade.button"));
			upBtn.type = "button";
			upBtn.addEventListener("click", () => { void host.shell.openUrl(aiProviders.OLLAMA_UPGRADE_URL); });
			return;
		}

		if (tool && offreConnexion) {
			const loginBtn = ajouter(errorEl, "button", "qbd-btn qbd-btn--ghost qbd-ai-error-retry");
			loginBtn.type = "button";
			host.ui.setIcon(ajouter(loginBtn, "span", "qbd-btn-icon qbd-btn-icon--sm"), "log-in");
			ajouter(loginBtn, "span", undefined, t("ai.login.button"));
			loginBtn.addEventListener("click", () => { void demarrerConnexion(tool, loginBtn, "erreur"); });
			return;
		}

		const retryBtn = ajouter(errorEl, "button", "qbd-btn qbd-btn--ghost qbd-ai-error-retry", t("ai.error.retry"));
		// Réessayer = RENVOYER la même demande (référence claude.ai), pas la
		// rendre au composer : le passage par restore/take garde un seul
		// chemin d'envoi (startGeneration reprend le message tel quel).
		retryBtn.addEventListener("click", () => { relancerApresErreur(); });
	}

	/** Le seul chemin de relance après un échec, partagé par « Réessayer » et
	    par la détection de connexion : renvoyer la MÊME demande, jamais la
	    rendre au composer (`restore`/`take` garde un unique chemin d'envoi). */
	function relancerApresErreur(): void {
		if (!sentMessage) { phase = "idle"; render(containerRef); return; }
		restoreComposerMessage();
		void startGeneration(containerRef);
	}

	function couperSondeConnexion(): void {
		if (loginPoll !== null) { window.clearInterval(loginPoll); loginPoll = null; }
		if (loginTimer !== null) { window.clearTimeout(loginTimer); loginTimer = null; }
	}

	/** Annule l'attente : coupe la sonde, puis revient d'où l'on venait. Depuis
	    la carte d'erreur, la demande envoyée est toujours là (`sentMessage`) et
	    l'erreur se remontre ; depuis le hint, rien n'était parti. */
	function annulerConnexion(): void {
		couperSondeConnexion();
		desabonnerPose?.();
		desabonnerPose = null;
		desabonnerNav?.();
		desabonnerNav = null;
		if (phase !== "connexion") return;
		phase = connexionOrigine === "erreur" && sentMessage ? "error" : "idle";
		render(containerRef);
	}

	/**
	 * Le clic sur « Se connecter », depuis la carte d'erreur ou depuis le hint :
	 * Claude et Codex → l'hôte ouvre un terminal sur la recette de connexion ;
	 * Ollama → le navigateur s'ouvre sur l'adresse que `/api/me` a rendue
	 * (c'est `ollama signin` sans le terminal). Puis la page attend que la
	 * sonde voie le compte.
	 *
	 * Les trois verdicts de l'hôte sont traités, y compris le rejet du pont
	 * (outil hors liste blanche, panne d'IPC) : sans ça, un bouton désactivé
	 * restait muet, exactement le défaut corrigé dans le modal d'installation.
	 */
	async function demarrerConnexion(tool: OutilCompte, bouton: HTMLButtonElement | null, origine: "erreur" | "hint"): Promise<void> {
		if (bouton) bouton.disabled = true;
		let verdict: "lance" | "annule" | "indisponible";
		if (tool === "ollama") {
			// `ollamaSigninUrl` n'est rafraîchie que par `verifierCompte` (sonde
			// périodique). Si la carte d'ERREUR Ollama s'affiche sans sonde
			// préalable (401 direct à la génération), elle vaut encore `null` :
			// sonder une dernière fois avant de renoncer, sinon le bouton répond
			// « indisponible » alors qu'une adresse de connexion existe bel et bien.
			if (!ollamaSigninUrl) {
				const c = await aiProviders.checkOllamaCompte(settings().aiOllamaUrl);
				if (!c.connecte && c.signinUrl) ollamaSigninUrl = c.signinUrl;
			}
			verdict = ollamaSigninUrl && await host.shell.openUrl(ollamaSigninUrl) ? "lance" : "indisponible";
		} else {
			/* La modale d'attente est OUVERTE AVANT le terminal (par
			   `attendreCompte`, qui passe `phase` à « connexion » et rend),
			   pour être mesurée : c'est sous elle qu'il se pose. Le geste
			   lui-même — mesure, abonnements, verdict — vit dans
			   `connexion-cli.ts`, partagé avec la section « Comptes » des
			   réglages. Si le lancement échoue, `annulerConnexion` la referme. */
			attendreCompte(tool, origine);
			verdict = await demarrerConnexionCli(tool, {
				modaleEl: document.querySelector<HTMLElement>(".qbd-login-wait-modal"),
				// `lance` : les deux abonnements restent actifs (le terminal ou
				// le navigateur peuvent encore se poser après ce retour) —
				// c'est `annulerConnexion` qui les coupera, à SA fin d'attente.
				onDesabonner: (off) => { desabonnerPose = off; desabonnerNav = null; },
			});
		}
		if (verdict !== "lance") {
			desabonnerPose?.();
			desabonnerPose = null;
			desabonnerNav?.();
			desabonnerNav = null;
			if (tool !== "ollama") annulerConnexion();
			if (bouton) bouton.disabled = false;
			// `annule` = l'utilisateur a dit non : rien de plus à dire.
			if (verdict === "indisponible") host.ui.notice(t("ai.login.terminalFailed"));
			return;
		}
		if (tool === "ollama") attendreCompte(tool, origine);
	}

	/** The wait card and its probe, until the account is seen. Split from
	    `demarrerConnexion` so the wait can start BEFORE the terminal is launched
	    (the modal is measured first; the terminal is placed under it). */
	function attendreCompte(tool: OutilCompte, origine: "erreur" | "hint"): void {
		couperSondeConnexion();
		/* Le hint « pas connecté » a pu être posé juste AVANT l'attente (sonde
		   du retour de modal) : il tombe ici, la carte d'attente le remplace. */
		const idAttendu = ID_DE_OUTIL[tool];
		if (providerHint[idAttendu]?.icon === "log-in") providerHint[idAttendu] = null;
		connexionVue = false;
		connexionOrigine = origine;
		phase = "connexion";
		render(containerRef);
		const sonde = tool === "ollama"
			? () => aiProviders.checkOllamaCompte(settings().aiOllamaUrl).then(c => c.connecte)
			: aiProviders.sondeConnexion(tool);
		loginPoll = window.setInterval(() => {
			void sonde().then(connecte => {
				// `loginPoll === null` : l'utilisateur a annulé pendant que la
				// sonde tournait — son résultat ne doit plus rien déclencher.
				if (!connecte || loginPoll === null || disposed) return;
				couperSondeConnexion();
				connexionVue = true;
				/* Connecté : c'est CET outil qu'on voulait utiliser (demande
				   d'Ahmed, 2026-09-19 — on installe et on connecte Claude Code
				   pour s'en servir). S'il n'est pas le fournisseur choisi, il
				   le devient ici, avec son modèle par défaut. */
				const idOutil = ID_DE_OUTIL[tool];
				providerHint[idOutil] = null;
				if ((settings().aiProvider || "") !== idOutil) {
					void saveSettings({ aiProvider: idOutil, aiModel: aiProviders.getProvider(idOutil).defaultModel });
				}
				/* L'utilisateur est dans le terminal ou le navigateur : Neo Quiz
				   revient au PREMIER PLAN, prêt à générer (Ahmed, 2026-09-19). */
				void host.ui.premierPlan?.().catch(() => { /* la page reste juste derrière */ });
				providerHint[settings().aiProvider || ""] = null;
				render(containerRef);
				/* La seconde d'attente est ce qui rend la détection LISIBLE :
				   sans elle, la coche et ce qui suit se remplaceraient dans la
				   même image. */
				loginTimer = window.setTimeout(() => {
					loginTimer = null;
					if (disposed) return;
					if (connexionOrigine === "erreur" && sentMessage) relancerApresErreur();
					else { phase = "idle"; render(containerRef); }
				}, 1000);
			});
		}, SONDE_CONNEXION_MS);
	}

	/** La carte d'attente : spinner tant que le compte n'est pas vu, coche
	    quand il l'est. Mêmes classes que le modal d'installation — c'est la
	    même promesse faite à l'utilisateur (« continuez là-bas, je regarde
	    ici »), elle doit se présenter pareil. */
	function renderConnexion(parent: HTMLElement): void {
		const el = ajouter(parent, "div", "qbd-ai-preview-loading qbd-ai-login-wait");
		// Le balayage de la carte s'arrête sur `ok` (CSS) : c'est lui, plus que
		// la coche, qui dit que l'attente est finie.
		el.dataset.etat = connexionVue ? "ok" : "attente";
		if (connexionVue) {
			host.ui.setIcon(ajouter(el, "span", "qbd-install-check"), "check");
			/* « Nouvelle tentative » seulement s'il y a une demande à renvoyer :
			   venue du hint ou d'une installation, l'attente n'en a pas, et la
			   page revient simplement au composer. */
			ajouter(el, "p", "qbd-ai-loading-title", connexionOrigine === "erreur" && sentMessage ? t("ai.login.detected") : t("ai.login.connected"));
			return;
		}
		ajouter(el, "span", "qbd-install-spinner");
		ajouter(el, "p", "qbd-ai-loading-title", t("ai.login.waiting"));
		ajouter(el, "p", "qbd-ai-login-hint", settings().aiProvider === "ollama" ? t("ai.login.hintBrowser") : t("ai.login.hint"));
		/* Pas de bouton Annuler : c'est la croix de la modale (ou Échap). */
	}

	/* `poserCroixAnnuler` vit désormais dans `connexion-cli.ts`, partagée avec
	   la section « Comptes » des réglages — même apparence pour toutes les
	   attentes de la page (voir son en-tête). */

	/* Les deux modales de phase de la page (la génération n'en a plus : elle
	   passe par la file) : connexion (fermer = annuler l'attente),
	   erreur (fermer = reprendre la demande dans le composer). */
	const syncLoginModal = creerModalePhase({
		phase: "connexion", className: "qbd-web-wait-modal qbd-login-wait-modal",
		rendre: renderConnexion, annuler: annulerConnexion,
	});
	const syncErrorModal = creerModalePhase({
		phase: "error", className: "qbd-web-wait-modal qbd-error-modal",
		rendre: renderError,
		annuler: () => { restoreComposerMessage(); phase = "idle"; render(containerRef); },
	});

	/**
	 * La modale d'attente du canal web suit la PHASE : ouverte tant que
	 * `phase === "web"`, fermée dès qu'on en sort (réponse reçue, annulation,
	 * erreur). Appelée à la fin de chaque `render`, c'est le seul endroit qui
	 * l'ouvre ou la ferme — un `render` de plus ne rouvre rien.
	 */
	/** Ouvre ou ferme chaque modale de phase selon `phase`. Appelée partout où
	    `phase` change sans que la page soit re-rendue. */
	function synchroniserModales(): void {
		syncWebModal();
		syncLoginModal();
		syncErrorModal();
	}

	function syncWebModal(): void {
		/* En « reçu », la modale est déjà ouverte et se redessine sur place ;
		   `phase` est encore "web" jusqu'à la navigation. */
		if (phase === "web" && webModal && reponseRecue && webModalCorps) {
			webModalCorps.replaceChildren();
			renderWeb(webModalCorps);
			return;
		}
		if (phase === "web" && !webModal && attenteWeb) {
			webModal = requireHost("modals").open({
				/* Plus large quand il y a des fichiers : ils tiennent sur UNE rangée
				   (retour Ahmed 2026-09-19, cinq fichiers sur trois lignes). */
				className: "qbd-web-wait-modal" + (attenteWeb.aGlisser.length > 0 && host.depot ? " qbd-web-wait-modal--files" : ""),
				onOpen: (m) => {
					webModalCorps = m.contentEl;
					renderWeb(m.contentEl);
					poserCroixAnnuler(m);
				},
				onClose: () => {
					webModal = null;
					webModalCorps = null;
					const interne = webModalFermetureInterne;
					webModalFermetureInterne = false;
					/* Fermée par l'utilisateur (Échap, fond, croix) pendant
					   l'attente : une CONFIRMATION d'abord (2026-09-20) — un clic
					   sur la croix jetait une génération en cours sur le site.
					   Refusée, la modale d'attente revient (la phase est encore
					   « web », `syncWebModal` la rouvre). */
					if (!interne && phase === "web") {
						openConfirmModal(
							t("ai.web.cancelTitle", { site: attenteWebSite }),
							t("ai.web.cancelMessage", { site: attenteWebSite }),
							t("ai.web.cancelConfirm"),
							t("ai.web.cancelKeep"),
							(confirme) => {
								if (phase !== "web") return;
								if (confirme) annulerAttenteWeb();
								else syncWebModal();
							},
							undefined,
							"x-circle",
						);
					}
				},
			});
		} else if (phase !== "web" && webModal) {
			webModalFermetureInterne = true;
			webModal.close();
		}
	}

	/** Le contenu de la modale d'attente : l'icône d'où partent des ondes
	    (l'attente se lit là, pas dans un balayage qui dirait « ça génère »
	    alors que rien ne tourne), une seule phrase qui dit les DEUX gestes
	    dans l'ordre (envoyer, puis copier), et Rouvrir. */
	function renderWeb(parent: HTMLElement): void {
		/* REÇU : la même carte, coche à la place du presse-papier (ses ondes
		   s'arrêtent), le nom du quiz, et rien d'autre — ni fichiers ni
		   « Rouvrir », il n'y a plus rien à faire. La modale se ferme d'elle-
		   même sur la page du quiz (`recevoirReponse`). */
		if (reponseRecue) {
			const carte = ajouter(parent, "div", "qbd-ai-web-card qbd-ai-web-card--recu");
			const iconWrap = ajouter(carte, "div", "qbd-ai-loading-icon qbd-web-wait-icon");
			iconWrap.dataset.etat = "ok";
			host.ui.setIcon(iconWrap, "check");
			ajouter(carte, "p", "qbd-ai-loading-title qbd-web-wait-title", t("ai.web.received"));
			ajouter(carte, "p", "qbd-ai-web-line", reponseRecue.titre ? t("ai.web.creatingNamed", { name: reponseRecue.titre }) : t("ai.web.creating"));
			return;
		}
		if (!attenteWeb) return;
		const site = attenteWeb.site;
		const carte = ajouter(parent, "div", "qbd-ai-web-card");
		const iconWrap = ajouter(carte, "div", "qbd-ai-loading-icon qbd-web-wait-icon");
		host.ui.setIcon(iconWrap, "clipboard-list");
		/* Avec des fichiers, le TITRE dit de les glisser, et la ligne dessous
		   d'envoyer puis de copier (Ahmed, 2026-09-19 : glisser les fichiers
		   est aussi important que le reste, et c'est le premier geste). */
		const aGlisser = attenteWeb.aGlisser.length > 0 && !!host.depot;
		const plusieurs = attenteWeb.aGlisser.length > 1;
		const coller = attenteWeb.ouverture.mode === "presse-papier";
		/* LES ÉTAPES, NUMÉROTÉES, dès qu'il y en a plus d'une (2026-09-20) :
		   coller le prompt quand il est parti par le presse-papier, glisser les
		   fichiers quand il y en a, envoyer puis copier. Trois phrases posées
		   les unes sous les autres se lisaient comme trois consignes
		   concurrentes ; une liste dit l'ordre. Une seule étape : le titre
		   d'avant suffit. */
		/* L'étape du collage porte `data-etape="coller"` : quand l'hôte dit
		   avoir collé (`surColle`), elle passe en « fait » sans redessiner la
		   carte, dont les tuiles à glisser tiennent un état. */
		const etapes: Array<{ texte: string; cle?: string }> = [];
		/* L'étape « collez » n'existe que là où l'hôte NE COLLE PAS lui-même
		   (le greffon) : dans l'application, le prompt arrive dans la page sans
		   un geste, et la dire, même une seconde, était de trop (2026-09-20). */
		const hoteColle = !!host.depot && "surColle" in host.depot;
		if (coller && !hoteColle) etapes.push({ texte: t("ai.web.step.paste", { site }), cle: "coller" });
		/* L'ENVOI est dans l'étape des fichiers quand il y en a (on glisse, on
		   envoie), seul sinon ; la dernière étape est l'attente du bloc de code
		   et sa copie (formulation d'Ahmed, 2026-09-20). */
		/* Une fois déposé, le texte ne change pas : la ligne s'ATTÉNUE
		   seulement, sous celle qui reste à faire (2026-09-20). */
		if (aGlisser) etapes.push({ texte: t(plusieurs ? "ai.web.step.dropMany" : "ai.web.step.drop"), cle: attenteWeb.depose ? "fait" : "glisser" });
		/* Rien à coller ni à glisser : UNE phrase, envoyer puis copier — pas une
		   liste d'une étape (2026-09-20). */
		if (etapes.length > 0) etapes.push({ texte: t("ai.web.step.copy") });
		if (etapes.length > 1) {
			ajouter(carte, "p", "qbd-ai-loading-title qbd-web-wait-title", t("ai.web.stepsTitle", { site }));
			const liste = ajouter(carte, "ol", "qbd-ai-web-etapes");
			for (const e of etapes) {
				const li = ajouter(liste, "li", e.cle === "fait" ? "is-fait" : undefined);
				poserTexteMisEnAvant(li, e.texte);
				if (e.cle) li.dataset.etape = e.cle;
			}
			/* Pas d'étape « courante » : l'application ne sait pas si le prompt
			   est parti. À faire = encre pleine, fait = atténué, rien d'autre
			   (2026-09-20 : sans fichier, « Envoyez » paraissait déjà fait). */
		} else {
			/* Un titre court en gras, une ligne en dessous : la phrase entière en
			   gras faisait quatre lignes (2026-09-20). SEUL « Send the prompt »
			   porte la couleur d'accent, pas le site qui suit (Ahmed, 2026-09-21)
			   — l'emphase vient de la clé, rendue comme la ligne du dessous. */
			const titre = ajouter(carte, "p", "qbd-ai-loading-title qbd-web-wait-title");
			poserTexteMisEnAvant(titre, t("ai.web.title", { site }));
			poserTexteMisEnAvant(ajouter(carte, "p", "qbd-ai-web-line qbd-ai-web-line--first"), t("ai.web.thenCopy"));
		}
		/* LES FICHIERS À GLISSER, en tuiles — les mêmes cartes que le composer
		   (`poserCarte`) : on les saisit et on les lâche sur le site à gauche,
		   c'est le vrai fichier qui part (`host.depot.glisser`, pendant le
		   `dragstart`, le seul moment où Chromium accepte un glisser natif). */
		if (aGlisser && host.depot) {
			/* LES PILES — la même pile de feuilles que l'aperçu d'un PDF
			   (`poserApercuPdf`, classes `qbd-ai-preview-*`), donc la même
			   animation au survol (la page bascule, les feuilles s'éventaillent,
			   la légende passe du nom à « Glisser »). Le NOM du fichier est la
			   légende, toujours lisible au repos (Ahmed, 2026-09-19). Saisir
			   n'importe quelle pile emporte TOUS les fichiers d'un seul geste. */
			const rangee = ajouter(carte, "div", "qbd-ai-web-files");
			const cibles = attenteWeb.aGlisser.map(tuile => tuile.cible);
			void host.depot.preparer(cibles);
			/* L'image qui suivra le curseur, une par pile saisissable : la pile
			   en éventail, le fichier saisi devant, le nombre dans le badge bleu
			   de l'Explorateur (`image-de-glisser.ts`). Dessinée maintenant, le
			   `dragstart` ne peut pas l'attendre ; tant qu'elle manque, l'hôte
			   prend l'icône de type. */
			const imagesDeGlisser: Array<ImageDeGlisser | undefined> = [];
			const echelle = window.devicePixelRatio || 1;
			const cartes = attenteWeb.aGlisser.map(tuile => ({ thumb: tuile.thumb, badge: badgeDeFichier(tuile.name) }));
			cartes.forEach((_, i) => {
				void composerImageDeGlisser(cartes, i, echelle)
					.then(png => { if (png) imagesDeGlisser[i] = { png, echelle }; })
					.catch(err => console.warn(LOG_PREFIX, "image du glisser impossible:", err));
			});
			for (const [i, note] of attenteWeb.aGlisser.entries()) {
				/* Pas de `title` : l'infobulle native du chemin se posait sur la
				   pile au survol, par-dessus la légende (vu par Ahmed le
				   2026-09-19) ; le nom est déjà écrit dessous. */
				const pile = ajouter(rangee, "div", "qbd-ai-preview-pdf qbd-ai-web-pile is-openable");
				const stack = ajouter(pile, "div", "qbd-ai-preview-stack is-ready");
				const feuille = ajouter(stack, "div", "qbd-ai-preview-sheet");
				if (note.thumb) {
					const img = ajouter(feuille, "img", "qbd-ai-preview-stack-page");
					img.src = note.thumb;
					img.alt = note.name;
					img.draggable = false;
				} else {
					/* Une note n'a pas de page dessinée : une feuille blanche qui
					   porte le badge de son extension, aux mêmes proportions. */
					const page = ajouter(feuille, "div", "qbd-ai-preview-stack-page qbd-ai-web-page--texte");
					ajouter(page, "span", "qbd-ai-note-chip-badge", badgeDeFichier(note.name));
				}
				const legende = ajouter(pile, "div", "qbd-ai-preview-caption");
				/* LE TYPE DU FICHIER RESTE TOUJOURS VISIBLE (règle d'Ahmed,
				   2026-09-19) : la coupe AU MILIEU est PARTAGÉE avec la tuile
				   vidéo (`couperNomAuMilieu`, file-icons.ts) — la règle vit
				   là-bas, plus une seule fois en ligne ici. */
				const nom = ajouter(legende, "span", "qbd-ai-preview-caption-pages qbd-ai-web-pile-nom");
				const { tete, queue } = couperNomAuMilieu(note.name);
				ajouter(nom, "span", "qbd-ai-web-pile-nom-tete", tete);
				if (queue) ajouter(nom, "span", "qbd-ai-web-pile-nom-queue", queue);
				const indice = ajouter(legende, "span", "qbd-ai-preview-open");
				host.ui.setIcon(ajouter(indice, "span", "qbd-ai-preview-open-icon"), "hand");
				ajouter(indice, "span", undefined, t(plusieurs ? "ai.web.dragAll" : "ai.web.dragOne"));
				pile.draggable = true;
				pile.addEventListener("dragstart", (ev) => {
					ev.preventDefault();
					void host.depot!.glisser(cibles, i, imagesDeGlisser[i]).then(resultat => {
						if (resultat === "impossible") { host.ui.notice(t("ai.web.dropFailed")); return; }
						/* Relâché hors de l'application, donc sur le site : l'étape
						   « glissez » passe en « fait » (2026-09-20). */
						if (resultat === "depose") {
							if (attenteWeb) attenteWeb.depose = true;
							const li = document.querySelector<HTMLElement>(".qbd-ai-web-etapes li[data-etape='glisser']");
							if (li) {
								li.dataset.etape = "fait";
								li.classList.add("is-fait");
							}
						}
					});
				});
			}
		}
		/* UNE seule phrase à l'écran (demande d'Ahmed, 2026-09-19) : le titre dit
		   déjà les deux gestes, et « le quiz se crée ici tout seul » est ce que
		   l'utilisateur VERRA arriver. La ligne ne reste que là où il doit agir
		   autrement : sans veille du presse-papier (collage manuel). */
		if (!host.collage) ajouter(carte, "p", "qbd-ai-web-line qbd-ai-web-line--strong", t("ai.web.manual"));
		const actions = ajouter(carte, "div", "qbd-ai-web-actions");
		/* Une seule action : annuler, c'est la croix de la modale (ou Échap). */
		const reopen = ajouter(actions, "button", "qbd-btn qbd-btn--primary");
		reopen.type = "button";
		host.ui.setIcon(ajouter(reopen, "span", "qbd-btn-icon qbd-btn-icon--sm"), "external-link");
		ajouter(reopen, "span", undefined, t("ai.web.reopen", { site }));
		reopen.addEventListener("click", rouvrirSite);
	}

	/** Pose un texte dont les passages entre `**` sont MIS EN AVANT (gras et
	    accent) : « copy the code block » doit sauter aux yeux dans la carte
	    d'attente (2026-09-20). Du texte, jamais du HTML : les morceaux sont
	    des nœuds texte. */
	function poserTexteMisEnAvant(parent: HTMLElement, texte: string): void {
		const morceaux = texte.split("**");
		morceaux.forEach((m, k) => {
			if (!m) return;
			if (k % 2 === 1) ajouter(parent, "strong", "qbd-ai-web-em", m);
			else parent.appendChild(document.createTextNode(m));
		});
	}

	/** Ouvre l'écran d'usage en lui passant la dernière lecture connue (il ne
	    rappellera l'endpoint que si elle a vieilli) et retient ce qu'il lit,
	    pour que le survol du bouton puisse le résumer sans relire. */
	async function openUsage(usage: AiUsageDeps): Promise<void> {
		/* L'écran d'usage lit lui aussi l'instantané de `~/.claude.json` (Fable
		   proposé ?, notes promo en cours) par `ai-providers`. Une entrée
		   d'affichage de plus, donc un `await` de plus — le seul du fichier avec
		   le menu de modèles. */
		await aiProviders.refreshCliCaches();
		await usage.open({
			provider: settings().aiProvider || "",
			usage: lastUsage,
			known: lastPlan,
			onData: (data) => { lastPlan = data; }
		});
	}

	/* Zone résultat (pleine page, composer en bas) : barre compacte +
	   l'ÉDITEUR DE QUIZ COMPLET embarqué — exigence explicite, pas une
	   liste simplifiée. */
	function renderResult(container: HTMLElement): void {
		// La MÊME page qu'un quiz du vault (dashboard/detail.ts) : liste des
		// questions à gauche, question courante à droite, bouton « Editor »
		// qui bascule le mode. L'éditeur en trois colonnes qui vivait ici
		// n'était pas assez simple (retour Ahmed 2026-07-31) — et il n'avait
		// aucune raison d'être un écran différent de celui d'un quiz existant.
		/* `page` et non `host` : `host` est l'HÔTE de ce module (`currentHost()`),
		   et le masquer ici rendrait illisible tout ajout futur à cette fonction. */
		const page = ajouter(container, "div", "qbd-ai-quiz-page");
		if (!resultPage) resultPage = createQuizPage({ statsStore: deps.statsStore });

		resultPage.render(page, {
			// La clé change à chaque génération : la page repart alors de la
			// question 1, en consultation. Un re-render de la scène (statut de
			// fournisseur, quota) garde la même clé, donc l'édition en cours.
			key: "generated:" + generationId,
			title: generatedTitle(),
			// Ligne discrète du header : ce que la génération a coûté, là où
			// un quiz du vault affiche son chemin.
			subtitle: usageLine(),
			load: () => Promise.resolve(loadGeneratedDraft()),
			// Cette page ne reste visible que si l'enregistrement automatique a
			// échoué. Le brouillon édité permet alors de réessayer sans perte.
			onBack: () => restartGeneration(),
			start: {
				label: t("ai.result.save"),
				icon: "save",
				onClick: () => { void saveGeneratedQuiz(); },
			},
			actions: [{
				label: t("ai.result.insert"),
				icon: "plus",
				// Ancré sur le bouton : le picker se positionne sur son rectangle.
				onClick: (btn) => openInsertPicker(btn),
			}],
			isStale: () => phase !== "result",
		});
	}

	/** Enregistre le quiz puis ouvre sa page détail, qui porte déjà le bouton
	    principal « Lancer ». Toujours la racine PAR DÉFAUT de l'hôte (demande
	    d'Ahmed du 2026-09-13) : le dossier « Generated » doit rester dans
	    C:\Neo Quiz, quelle que soit la note jointe par « @ ». */
	/** Le dossier par défaut, en chemin du contrat : `<racine par défaut>/<aiOutputFolder>`. */
	function defaultDestination(): string {
		return dossierParDefaut(settings().aiOutputFolder);
	}

	/** The destination the user last chose, if its folder still exists;
	    otherwise the default (""). What an arrival or a cancelled preset falls
	    back to. */
	function destinationMemoriseeCourante(): string {
		return destinationMemorisee(settings().aiComposerDestination, destinationOptions().map(o => o.value).filter(v => v !== ""));
	}

	/** Remembers a folder the user chose in the composer's row or suggestions.
	    A preset or an exam's folder is never remembered: it is for one send. */
	function memoriserDestination(chemin: string): void {
		void saveSettings({ aiComposerDestination: chemin });
	}

	/** The destinations offered by the composer's output-folder row: the
	    default first (value `""`), then the folders the host declares. The
	    default is removed from the others if it appears there — the same
	    folder twice in a list of choices is a display defect, not one more
	    option. */
	function destinationOptions(): { value: string; label: string; icon: string; color: string; sub: string }[] {
		const defaut = defaultDestination();
		const racine = host.paths.defaultRoot();
		const options = [{
			value: "",
			label: settings().aiOutputFolder || aiSettingsDefaults().aiOutputFolder,
			icon: GENERATED_MODULE_ICON,
			color: GENERATED_MODULE_ACCENT,
			sub: racine.name,
		}];
		const vus = new Set([defaut]);
		const dossiers: { path: string; name: string; icon: string; color: string; root: string }[] = [];
		for (const d of deps.quizFolders?.() ?? []) {
			if (!d.path || vus.has(d.path)) continue;
			vus.add(d.path);
			dossiers.push(d);
		}
		// Most recently changed first (the latest file change inside each folder).
		const ordre = rankFolders(dossiers.map(d => ({ path: d.path, name: d.name || d.path })), fichiersDesDossiers());
		for (const o of ordre) {
			const d = dossiers.find(x => x.path === o.path);
			if (d) options.push({ value: d.path, label: d.name || d.path, icon: d.icon, color: d.color, sub: d.root });
		}
		return options;
	}

	/** What the folders' recency and suggestions read: every note of the index
	    (quizzes and documents), with its last change — in memory, no disk walk. */
	function fichiersDesDossiers(): FileRef[] {
		return host.fs.listMarkdown().map(f => ({ path: f.path, mtime: f.mtime, title: f.basename }));
	}

	/** The folders a request's words match, shown under the composer as "Put it
	    in X?" chips; one tap chooses, nothing is ever chosen on its own. Debounced
	    250 ms: it runs on each keystroke. */
	function planifierSuggestions(): void {
		window.clearTimeout(suggestionsTimer);
		suggestionsTimer = window.setTimeout(() => {
			const el = suggestionsEl;
			if (!el || !el.isConnected) return;
			el.replaceChildren();
			if (examCible || destinationParExam) return;
			const options = destinationOptions().filter(o => o.value !== "");
			const dossiers: FolderRef[] = options.map(o => ({ path: o.value, name: o.label }));
			const choisi = destination || defaultDestination();
			for (const d of suggestFolders(composerText, dossiers, fichiersDesDossiers(), { except: choisi })) {
				const b = ajouter(el, "button", "qbd-ai-suggest");
				b.type = "button";
				host.ui.setIcon(ajouter(b, "span", "qbd-ai-suggest-icone"), "folder-input");
				ajouter(b, "span", "qbd-ai-suggest-texte", t("ai.suggest.put", { folder: d.name }));
				b.addEventListener("click", () => {
					destination = d.path;
					destinationDuPreset = false;
					memoriserDestination(d.path);
					majAvisCategorie();
					paintDestination?.();
					el.replaceChildren();
				});
			}
		}, 250);
	}

	/** Enregistre le quiz généré et ouvre sa page. Avec `differerNavigation`,
	    rend la navigation à faire au lieu de la faire : l'appelant choisit
	    quand la page du quiz remplace ce qui est à l'écran. `false` si rien
	    n'a pu être enregistré (notice déjà affichée). */
	async function saveGeneratedQuiz(options: { differerNavigation?: boolean; demande?: SentMessage } = {}): Promise<false | (() => void)> {
		/* La demande qui a produit CE quiz : dans un lot (un quiz par fichier
		   joint), c'est le sous-message du fichier, pas l'envoi entier — sinon
		   chaque note prendrait le nom du premier fichier. */
		const demande = options.demande ?? sentMessage;
		/* Un quiz de la FILE ouvert sans note garde le mode, la destination et
		   les réglages de SON envoi, pas ceux du composer d'aujourd'hui. */
		const fige = resultatFige;
		const mode = fige ? fige.mode : modeGeneration;
		const reglages = { ...settings(), ...fige?.reglages };
		/* A REQUESTED Learn whose model forgot `mode: "learn"` stays a Learn
		   (`completerConfigLearn`): BEFORE the draft, which reads
		   `generatedQuestions`. It is idempotent, so a queue result, already
		   fixed on arrival, is left as it is (and its draft, possibly edited,
		   kept). */
		if (mode === "learn") {
			const complete = completerConfigLearn(generatedQuestions);
			if (JSON.stringify(complete) !== JSON.stringify(generatedQuestions)) {
				generatedQuestions = complete;
				generatedDraft = null;
			}
		}
		/* L'écriture, le nommage et le rangement sont ceux de la file
		   (`enregistrerQuiz`) : une seule façon de faire une note générée. */
		const draft = loadGeneratedDraft();
		if (!draft.questions.length) return false;
		const entry = await enregistrerQuiz({
			draft, questions: generatedQuestions, modeDemande: mode, titreModele: generatedTitre, demande,
			destination: fige ? fige.destination : destination, reglages, usage: lastUsage,
			planTranches: planTranchesEnvoye, noteLearn: noteLearnLiee, scanner: deps.scanner,
		});
		if (!entry) {
			host.ui.notice(t("ai.notice.saveFailed"));
			return false;
		}
		// Enregistré depuis la page résultat : la ligne en échec n'a plus d'objet.
		if (fige) fileGen.fermer(fige.ligne);
		/* La page du quiz ENTRE avec une animation quand elle vient d'une
		   génération (`entree: "generation"`), pas quand on l'ouvre depuis
		   « Mes quiz » (Ahmed, 2026-09-19). */
		const naviguer = (): void => {
			resetGeneration();
			deps.navigate("detail", { quiz: entry, entree: "generation" });
		};
		if (!options.differerNavigation) naviguer();
		return naviguer;
	}

	/** Titre de la page d'un quiz fraîchement généré : la DEMANDE, abrégée.
	    Elle dit de quoi parle le quiz mieux que « Nouveau quiz », et c'est ce
	    que l'utilisateur vient d'écrire — il le reconnaît. */
	function generatedTitle(): string {
		// Couper au dernier MOT entier (`debutDeDemande`) : « …sur le modele
		// OSI : un texte a t… » se lit mal.
		const { texte, coupee } = debutDeDemande(sentMessage?.text || "");
		if (!texte) return t("ai.result.untitled");
		return coupee ? texte + "…" : texte;
	}

	/** Practice sur un site : le Learn de la même source et son plan des
	    tranches (`lienLearn`, le même que la file), retenus pour
	    l'enregistrement de la réponse. */
	async function preparerLienLearn(msg: SentMessage): Promise<void> {
		const learn = await lienLearn(deps.scanner, modeGeneration, destination || defaultDestination(), msg);
		planTranchesEnvoye = learn.plan;
		noteLearnLiee = learn.note;
	}

	/** « 6 questions · 54k tokens · $0.73 · 2 min 33 s » — la ligne du header,
	    à la place du chemin de note qu'un quiz du vault y affiche. */
	function usageLine(): string {
		const parts = [t("ai.result.count", { count: loadGeneratedDraft().questions.length })];
		if (lastUsage) {
			parts.push(t("ai.usage.badge", { tokens: formatTokens(totalTokens(lastUsage)) }));
			const cost = formatCost(lastUsage.costUsd);
			if (cost) parts.push(cost);
			const dur = formatDuration(lastUsage.durationMs);
			if (dur) parts.push(dur);
		}
		return parts.join("  ·  ");
	}

	/** Brouillon éditable à partir des questions générées. Passe par la MÊME
	    conversion que la lecture d'une note (editor/convert.ts) : un quiz
	    généré et un quiz relu d'un .md doivent être le même objet. */
	function loadGeneratedDraft(): QuizDraft {
		if (generatedDraft && generatedDraft.genId === generationId) return generatedDraft.draft;
		// `file: null` : ce quiz n'a pas de note — d'où l'absence de `save`.
		const draft = brouillonDe(generatedQuestions);
		generatedDraft = { genId: generationId, draft };
		return draft;
	}

	/** Picker d'insertion : notes OUVERTES en tête + recherche dans tout le vault. */
	function openInsertPicker(anchor: HTMLElement): void {
		openNotePicker(anchor, {
			openFiles: deps.openFiles?.() ?? [],
			allFiles: host.fs.listMarkdown(),
			onPick: (file) => insertIntoNote(file)
		});
	}

	/** « Recommencer » — désormais la FLÈCHE RETOUR de la page (demande Ahmed
	    2026-07-31) : sortir du quiz généré, c'est revenir au composer vide. */
	function restartGeneration(): void {
		resetGeneration();
		render(containerRef);
	}

	/** Remet la page « Générer » à neuf SANS la redessiner — pour l'appelant
	    qui va de toute façon quitter la vue (insertion dans une note). */
	function resetGeneration(): void {
		couperSondeConnexion();
		arreterAttenteWeb();
		oublierLotWeb();
		errorAction = null;
		attenteWebSite = "";
		phase = "idle";
		errorLogin = null;
		generatedQuestions = [];
		generatedTitre = undefined;
		generatedDraft = null;
		resultatFige = null;
		dropSentMessage();
		viderComposer();
		/* Les modales de phase suivent `phase`, mais ne se synchronisaient qu'à
		   la fin de `render` — et le succès d'une génération NAVIGUE vers le
		   quiz enregistré sans re-rendre la page : la modale d'attente restait
		   ouverte par-dessus le quiz créé (vu par Ahmed le 2026-09-19). */
		synchroniserModales();
	}

	/** Vide le composer : texte, pièces jointes, images et tuiles vidéo (dont
	    les transcriptions en vol sont abandonnées, l'arbre yt-dlp tué). Les
	    URL d'objet des vignettes se libèrent ici, sinon elles resteraient
	    allouées jusqu'à la fermeture de la fenêtre. */
	function viderComposer(): void {
		tuilesVideo.vider();
		composerText = "";
		composerCaret = null;
		noteAttachments = [];
		for (const img of images) URL.revokeObjectURL(img.url);
		images = [];
		oneQuiz = false;
	}

	/** Ce que la détection de catégorie lit d'une demande : les noms des
	    pièces jointes, le dossier de destination, le texte. */
	function indicesCategorie(notes: readonly { name: string }[], texte: string): IndicesCategorie {
		return {
			pieces: notes.map(n => n.name),
			dossier: destination || dossierParDefaut(settings().aiOutputFolder),
			demande: texte,
		};
	}

	/** La catégorie qui partirait maintenant avec le composer. */
	function categorieCourante(): CategorieQuiz {
		return categorieChoisie(categorieChoix ?? "auto", indicesCategorie(noteAttachments, composerText));
	}

	/** Repeint l'avis près du bouton des options (texte, pièces, dossier
	    ou choix changé). Rien pour `general`. */
	function majAvisCategorie(): void {
		if (!avisCategorieEl) return;
		peindreAvisCategorie(avisCategorieEl, categorieCourante(), categorieChoix === null);
	}

	function updateGenerateBtn(btn: HTMLButtonElement | null): void {
		majAvisCategorie();
		planifierSuggestions();
		if (!btn) return;
		// Le bouton d'envoi n'apparaît qu'avec du contenu (texte/image/note),
		// et reste désactivé tant que la génération n'est pas possible
		// (aucun fournisseur configuré). En vol sur un site ou en attente de
		// connexion, `canGenerate` est faux : le bouton reste visible (le
		// composer garde la demande) mais grisé.
		const hasContent = !!(composerText.trim() || images.length > 0 || noteAttachments.length > 0 || examCible);
		/* Composer VIDE pendant qu'une génération tourne : le bouton devient le
		   ■ de claude.ai, qui l'arrête. Avec du contenu, la flèche envoie dans
		   la file, derrière elle. Pas sur le bouton « Ouvrir » d'un site. */
		const arret = !hasContent && !btn.classList.contains("qbd-ai-composer-send--wide")
			&& !!runningLineOfChat(fileGen.lignes(), activeChatId());
		if (btn.classList.contains("qbd-ai-composer-send--stop") !== arret) {
			btn.classList.toggle("qbd-ai-composer-send--stop", arret);
			const icone = btn.querySelector<HTMLElement>(".qbd-ai-composer-send-icon");
			if (icone) host.ui.setIcon(icone, arret ? "square" : "arrow-up");
			btn.setAttribute("aria-label", arret ? t("ai.composer.stop") : t("ai.composer.generate"));
		}
		const canGen = arret || canGenerate();
		btn.classList.toggle("is-visible", hasContent || arret);
		btn.disabled = !canGen;
		btn.classList.toggle("qbd-ai-composer-send--disabled", !canGen);
		// La flèche grisée dit POURQUOI quand c'est une lecture qui la retient.
		btn.title = arret ? t("ai.composer.stop")
			: noteAttachments.some(n => n.lecture === "cours") ? t("ai.attach.reading")
			: noteAttachments.some(n => n.lecture === "erreur") ? t("ai.attach.blocked") : "";
	}

	/* Nomme un bouton-icône SANS déclencher de seconde bulle. `aria-label` (et
	   `title`) fait afficher à Obsidian sa PROPRE infobulle : sur un bouton qui
	   porte déjà une bulle maison, les deux s'empilent et répètent le même mot
	   (constaté 2026-07-30 sur le bouton d'usage). Le nom accessible passe donc
	   par un texte hors écran, lu par les lecteurs d'écran, invisible à la
	   souris. À appeler APRÈS setIcon, qui réécrit le contenu du bouton. */
	function labelIconButton(btn: HTMLElement, label: string): void {
		ajouter(btn, "span", "qbd-sr-only", label);
	}

	/* Les chemins écrits dans le prompt sont attachés AVANT l'envoi : le
	   modèle n'a aucun accès disque, mais le plugin sait lire ces fichiers
	   (mêmes fonctions que le picker « @ » → mêmes formats, même
	   dédoublonnage, mêmes chips). Sans ça, « d'après Cours/TD3.md »
	   partait sans sa source et revenait en ai.err.noFileAccess. */
	async function attachPromptPaths(): Promise<void> {
		const text = composerText.trim();
		if (!text) return;
		const roots = settings().aiMentionExtraFolders || [];
		const { refs, unresolved, ambiguous, truncated } = await scanPromptPaths(roots, text);

		// Déjà joint (via « @ » ou « + ») : on ne le redit pas. Le passer à
		// attach*Path afficherait « déjà attachée » pour un doublon que
		// l'utilisateur n'a jamais demandé deux fois.
		const fresh = refs.filter(r => {
			const key = attachmentKey({ source: r.kind, path: r.path, name: r.name });
			return !noteAttachments.some(n => attachmentKey(n) === key)
				&& !images.some(i => i.file.name === r.name);
		});
		for (const r of fresh) {
			if (r.kind === "vault") await attachVaultPath(r.path);
			else await attachExternalPath(r.path);
		}
		if (fresh.length) {
			host.ui.notice(t("ai.notice.pathsAttached", {
				files: fresh.map(r => r.name).join(", ")
			}));
		}
		if (truncated) {
			host.ui.notice(t("ai.notice.pathsTooMany", { max: String(MAX_PROMPT_PATHS) }));
		}
		for (const a of ambiguous) {
			host.ui.notice(t("ai.notice.pathsAmbiguous", { file: a.text, count: String(a.count) }));
		}
		if (unresolved.length) {
			host.ui.notice(t("ai.notice.pathsUnresolved", { files: unresolved.join(", ") }));
		}
		/* UNE ADRESSE WEB N'EST PAS LUE, SAUF UNE VIDÉO YOUTUBE — que la tuile
		   joint désormais à la demande (2026-09-22). La notice ne parle donc
		   plus que des AUTRES liens : `liensNonLus` fait la MÊME distinction
		   que la ligne discrète sous le composer (spec « Vidéos YouTube »
		   § 5.4), en un seul endroit du noyau. */
		if (liensNonLus(text).length > 0) {
			host.ui.notice(t("ai.notice.linksNotRead"));
		}
	}

	/** Une génération est-elle DÉJÀ partie ? Posé avant le moindre `await`. */
	let demarrage = false;

	/** La demande pour un site quand les fichiers sont DÉPOSÉS à côté : la
	    consigne de l'utilisateur et les noms des documents, dont le contenu
	    arrivera par le glisser-déposer — pas inliné. Adressé au modèle, donc en
	    anglais ; la règle de langue du prompt système fait le reste. */
	function demandeAvecFichiersDeposes(msg: SentMessage): { source: "text"; prompt: string } {
		const noms = [...msg.images.map(i => i.file.name), ...msg.notes.map(n => n.name)].join(", ");
		const consigne = msg.text.trim();
		return {
			source: "text",
			prompt: (consigne ? consigne + "\n\n" : "")
				+ "The source documents are attached to this message as files (" + noms + "): read them and build the quiz from their content, in their language.",
		};
	}

	/** Les tuiles à glisser sur le site, dans l'ordre du composer (images puis
	    documents). Une pièce qui a un chemin part telle quelle ; les autres
	    sont écrites par l'hôte (`depot.ecrire`). `null` si l'une d'elles ne
	    peut pas l'être : rien ne part plutôt qu'une demande incomplète. */
	async function tuilesDeDepot(msg: SentMessage, depot: NonNullable<typeof host.depot>): Promise<TuileDepot[] | null> {
		const tuiles: TuileDepot[] = [];
		for (const image of msg.images) {
			const cible = await depot.ecrire(image.file.name, new Uint8Array(await image.file.arrayBuffer()));
			if (!cible) return null;
			tuiles.push({ name: image.file.name, thumb: image.url, cible });
		}
		for (const note of msg.notes) {
			let cible: HostFile | string | null = null;
			/* La pièce d'une VIDÉO a un IDENTIFIANT (`youtube:<id>`), pas un
			   fichier : elle part comme les pièces sans chemin, écrite par
			   l'hôte (contenu markdown) pour être glissée sur le site. */
			if (note.path && note.source !== "video") {
				cible = note.source === "vault" ? host.fs.getFile(note.path) : note.path;
			}
			if (!cible) cible = await depot.ecrire(note.name, note.bytes ?? new TextEncoder().encode(note.content));
			if (!cible) return null;
			tuiles.push({ name: note.name, thumb: note.thumb, cible });
		}
		return tuiles;
	}

	async function startGeneration(container: HTMLElement | null): Promise<void> {
		/* VERROU d'abord, et de façon synchrone : sans lui, Entrée ou un
		   second clic pendant l'attente ci-dessous envoyait la MÊME demande
		   une seconde fois (revue codex 2026-07-31). */
		if (demarrage) return;
		demarrage = true;
		/* Les documents des vidéos YouTube prêtes partent avec la demande
		   (spec « Vidéos YouTube » § 5.2). L'attente vit DANS le verrou :
		   une transcription peut durer le temps qu'elle dure, et un second
		   Entrée pendant ce temps ne repart pas. Les tuiles en `erreur` ou
		   en `installer` ne sont pas jointes — une notice le dit. */
		let jointesVideo: NoteAttachment[] = [];
		try {
			/* Les chemins écrits dans le prompt deviennent des pièces jointes
			   AVANT la capture : elles doivent partir avec la demande, et
			   apparaître dans la ligne « envoyé » de la file. */
			await attachPromptPaths();
			const attente = await tuilesVideo.prets();
			if (attente.ecartees > 0) {
				host.ui.notice(t(attente.ecartees === 1 ? "ai.video.notJoinedOne" : "ai.video.notJoinedOther", { count: attente.ecartees }));
			}
			jointesVideo = attente.jointes;
		} finally {
			// Le verrou ne couvre que la fenêtre entre le clic et l'envoi.
			demarrage = false;
		}

		/* Une génération qui part reprend la main sur l'attente de connexion.
		   Sans ça, l'utilisateur qui se lasse et renvoie une demande pendant que
		   la sonde tourne voyait, à la détection, son composer RÉÉCRIT par la
		   demande précédente au milieu de la génération en cours. La relance de
		   la sonde passe elle-même par ici, et couper deux fois ne coûte
		   rien. */
		couperSondeConnexion();
		/* Changer de fournisseur PENDANT une attente web (canal CLI choisi puis
		   envoyé) ne l'arrête pas d'elle-même : sans cet appel, sa sonde et ses
		   écouteurs `document` (Esc, collage) continueraient de tourner sous la
		   génération CLI qui vient de partir. */
		arreterAttenteWeb();
		const web = aiProviders.estCanalWeb(settings().aiProvider || "");
		const commandeExam = !!examCible || retirerCommandeExam(composerText).commande;
		/* The kind comes from the words of the request alone (a Learn unless it
		   says it wants to practise); an "/exam" preparation plans both. */
		const genre: KindChoice = decideByKeywords(composerText);
		if (web) { await lancerSurSite(container, jointesVideo, genre); return; }
		if (!commandeExam && settings().aiProvider) {
			demarrage = true;
			let pris = false;
			try { pris = await clarifier(container, jointesVideo, genre); } finally { demarrage = false; }
			if (pris) return;
		}
		envoyerDansLaFile(capturerEnvoi(jointesVideo), commandeExam ? "exam" : genre, { dejaVide: false });
		render(container);
	}

	/** Le canal web : le composer GARDE la demande pendant l'attente du site ;
	    tout ce qui suit lit `msg`, jamais l'état du composer. Un site ne reçoit
	    qu'une demande à la fois : le premier fichier part, les autres attendent
	    la réponse du précédent (`recevoirReponse`). A site cannot make both
	    kinds from one request: `both` starts with the Learn. */
	async function lancerSurSite(container: HTMLElement | null, jointesVideo: NoteAttachment[], genre: KindChoice): Promise<void> {
		modeGeneration = genre === "practice" ? "practice" : "learn";
		/* ONE PASS (2026-10-01): with several documents the site gets ALL of
		   them in one request and answers with one quiz per document. */
		const parFichier = decouperParFichier(takeComposerMessage(jointesVideo), oneQuiz, lectureEnUnePasse(settings().aiProvider || ""));
		lotWebRestant = parFichier.slice(1);
		lotWebPremier = null;
		lot = parFichier.length > 1 ? { index: 1, total: parFichier.length, nom: parFichier[0].notes[0]?.name ?? "" } : null;
		await ouvrirSite(parFichier[0], container);
	}

	/** What the composer holds, as a request (a copy: the generation never
	    reads the composer's state). */
	function capturerEnvoi(jointesVideo: NoteAttachment[]): DemandeTexte {
		return { text: composerText, notes: [...noteAttachments, ...jointesVideo], images: images.map(i => ({ file: i.file })) };
	}

	/* ── CLARIFYING QUESTIONS (spec 2026-10-07-generate-auto-kind) ──
	   ONE short call to the same provider, with the request and the names of
	   the documents, says whether the request is ready or asks 1 to 3 quick
	   questions. Any failure or unreadable answer is "ready": generation is
	   never blocked. Questions are cards in the thread; when all are answered
	   the generation starts with the answers appended to the request.
	   Returns true when the request was taken over (sent, or questions put). */
	async function clarifier(container: HTMLElement | null, jointesVideo: NoteAttachment[], genre: KindChoice): Promise<boolean> {
		const envoi = capturerEnvoi(jointesVideo);
		const pieces = [...envoi.notes.map(n => (n.path ? { name: n.name, path: n.path } : { name: n.name })), ...envoi.images.map(i => ({ name: i.file.name }))];
		const seulQuiz = oneQuiz;
		attenteGenre = { text: envoi.text, documents: pieces };
		viderComposer();
		render(container);
		let reponse: ClarifyAnswer = { ready: true };
		try {
			reponse = parseClarifyAnswer(await createAiClient(deps.settings).clarify(envoi.text, pieces.map(p => p.name)));
		} catch (err) {
			console.warn(LOG_PREFIX, "clarify call failed, generating right away", err);
		} finally {
			attenteGenre = null;
		}
		if ("questions" in reponse) {
			const id = newRequestId();
			setChats(addClarify(getChats(), activeChatId(), chatDevice(), Date.now(), { id, text: envoi.text, documents: pieces, mode: genre === "practice" ? "practice" : "learn" }, { questions: reponse.questions, genre }));
			questionsEnAttente.set(id, { envoi, genre, oneQuiz: seulQuiz });
			notifyChatsChanged();
		} else {
			envoyerDansLaFile(envoi, genre, { dejaVide: true, oneQuiz: seulQuiz });
		}
		render(container);
		return true;
	}

	/** Every clarifying card is answered: records the answers and starts the
	    generation, the answers appended to the request ("Details: …"). */
	function repondreQuestions(requestId: string, reponses: string[][]): void {
		const chatId = activeChatId();
		const requete = getChats().find(c => c.id === chatId)?.requests.find(q => q.id === requestId);
		if (!requete?.clarify) return;
		/* The in-memory request (documents' text included), or — after a reload
		   of the page — what the record alone can rebuild (a request with no
		   document). Neither: the card could not have been offered (`reprenable`). */
		const gardee = questionsEnAttente.get(requestId);
		const reprise = gardee ? null : resumeSource(requete);
		const attente = gardee ?? (reprise ? { envoi: { text: reprise.text, notes: [], images: [] } as DemandeTexte, genre: reprise.genre as KindChoice, oneQuiz: false } : null);
		if (!attente) { host.ui.notice(t("ai.clarify.expired")); return; }
		const r = answerClarify(getChats(), chatId, requestId, reponses, Date.now());
		if (!r.changed) return;
		questionsEnAttente.delete(requestId);
		setChats(r.chats);
		notifyChatsChanged();
		const precisions = formatClarifications(t("ai.clarify.details"), requete.clarify.questions, reponses);
		const envoi: DemandeTexte = { ...attente.envoi, text: [attente.envoi.text.trim(), precisions].filter(Boolean).join("\n\n") };
		envoyerDansLaFile(envoi, attente.genre, { dejaVide: true, oneQuiz: attente.oneQuiz, requestId, sentAt: requete.at });
		render(containerRef);
	}

	/** May the pending card of this request still be answered? True with its
	    in-memory request, or when the record can rebuild it. */
	function reprenable(requestId: string): boolean {
		if (questionsEnAttente.has(requestId)) return true;
		const req = getChats().flatMap(c => c.requests).find(q => q.id === requestId);
		return !!req && resumeSource(req) !== null;
	}

	/** Un envoi par CLI part dans la FILE de l'application (spec 2026-09-26) :
	    une ligne par fichier joint (un quiz par fichier), chacune avec le
	    mode, les options, la destination et les réglages du moment — changer
	    un réglage ensuite ne touche que les envois suivants. Le composer se
	    vide aussitôt et reste libre : on peut préparer la demande suivante
	    pendant que celle-ci tourne. */
	function envoyerDansLaFile(envoi: DemandeTexte, genre: KindChoice | "exam", repris: { dejaVide: boolean; oneQuiz?: boolean; requestId?: string; sentAt?: number }): void {
		const seulQuiz = repris.oneQuiz ?? oneQuiz;
		const vider = (): void => { if (!repris.dejaVide) viderComposer(); };
		/* A FOLLOW-UP carries the chat's history: the earlier requests of the
		   chat on screen (live or read back from its record), their documents
		   (kept when this one attaches none) and what the quizzes produced
		   contain. A chat of an earlier session only has what its record keeps:
		   the names of the documents, the titles and files of the quizzes, the
		   written answers. */
		const chatId = activeChatId();
		// The request being sent is not its own history (a question card keeps its record).
		const tours = toursOfThread(filDuChat().filter(i => i.key !== repris.requestId));
		if (tours.length) {
			envoi.contexte = contexteConversation(tours);
			if (!envoi.notes.length && !envoi.images.length) {
				const herites = documentsHeritiers(tours);
				// Only documents the queue still holds can be attached again (their text).
				const parNom = new Map(fileGen.lignes().filter(l => chatOfLine(l) === chatId).flatMap(l => l.demande.notes).map(n => [n.name, n] as const));
				envoi.notes = herites.map(h => parNom.get(h.name)).filter((n): n is NoteAttachment => !!n);
			}
		}
		/* THE IDENTITY of the send: the chat on screen, ONE request id for every
		   line it makes, and the time. */
		const identite = { chatId, requestId: repris.requestId ?? newRequestId(), sentAt: repris.sentAt ?? Date.now() };
		const reglages = figerReglages(settings());
		/* "/exam": a whole PREPARATION over every document at once — a Learn
		   over everything that can come up, then Tests of rising difficulty,
		   the last at the exam's level. Each is a line of the queue, run one
		   after the other with the same sources. */
		const commande = retirerCommandeExam(envoi.text);
		if (examCible || commande.commande) {
			/* An exam is prepared FROM ITS DOCUMENTS: none joined, the window
			   that lists them opens again instead of sending. */
			if (examCible && envoi.notes.length === 0 && envoi.images.length === 0) {
				host.ui.notice(t("ai.exam.needDocuments"));
				choisirDocumentsExam(examCible);
				return;
			}
			/* With an exam picked, the request is the prompt written for the
			   learner, the documents it covers named, what they typed added under it. */
			const precisions = commande.texte.trim();
			const noms = envoi.notes.map(n => n.name);
			const texte = examCible
				? [promptPreparation(examCible, settings().aiExamPrompt), noms.length ? t("ai.exam.documentsLine", { list: noms.join(", ") }) : "", precisions].filter(Boolean).join("\n\n")
				: commande.texte;
			const d: DemandeTexte = { ...envoi, text: texte };
			const categorie = categorieChoisie(categorieChoix ?? "auto", indicesCategorie(d.notes, d.text));
			const examen = examCible ?? undefined;
			const base = { count: null, type: effectiveTypes("learn"), destination, reglages, categorie };
			/* THE RIGHT NUMBER OF QUIZZES: one Learn per document (CM1, CM2, CM3
			   each get their path), then the Tests of rising difficulty over
			   all of them together. One `lot`: the queue shows the request once
			   and names each step (file-generation-vue.ts). */
			/* ONE LINE, the PLAN (2026-09-30): the model reads every document,
			   then chooses the quizzes; each comes behind it in the queue, and
			   the sidebar shows the plan as it goes. Learn | Test decides the
			   kind of quizzes planned. */
			fileGen.envoyer({ ...d, ...base, ...identite, mode: "learn", mixte: true, planifier: true, preparation: { examen, palier: 0, paliers: PALIERS_TEST, lot: Date.now().toString(36) } });
			examCible = null;
			vider();
			if (destinationDuPreset) { destination = destinationMemoriseeCourante(); destinationDuPreset = false; }
			return;
		}
		/* ONE PASS (2026-10-01): N quizzes = ONE line of the queue, ONE
		   generation that reads every document and writes one quiz per
		   document (Ollama keeps one line per document: `lectureEnUnePasse`). */
		/* `both` (spec 2026-10-07-generate-auto-kind): a Learn, then a Test on
		   the same documents, behind it in the queue, one request. */
		const genres: ModeGeneration[] = genre === "both" ? ["learn", "practice"] : [genre === "practice" ? "practice" : "learn"];
		for (const mode of genres) {
			for (const d of decouperParFichier(envoi, seulQuiz, lectureEnUnePasse(reglages.aiProvider || ""))) {
				/* La catégorie est FIGÉE à l'envoi, par fichier : un CM Python et
				   un CM SQL envoyés ensemble ont chacun la leur (retour #7). */
				const categorie = categorieChoisie(categorieChoix ?? "auto", indicesCategorie(d.notes, d.text));
				fileGen.envoyer({ ...d, ...identite, mode, count: questionCount, type: effectiveTypes(mode), destination, reglages, categorie });
			}
		}
		vider();
		// Le préréglage part avec l'envoi ; un dossier CHOISI dans les options reste.
		if (destinationDuPreset) { destination = destinationMemoriseeCourante(); destinationDuPreset = false; }
	}


	/**
	 * Le canal web : le site s'ouvre avec la question, l'application attend la
	 * réponse copiée. Trois gestes pour l'utilisateur (Ouvrir, Envoyer,
	 * Copier), et rien à confirmer ici : c'est la contrainte de la spec.
	 */
	async function ouvrirSite(msg: SentMessage, container: HTMLElement | null): Promise<void> {
		demandeWeb = msg;
		const canalId = settings().aiProvider || "";
		const canal = aiProviders.getCanal(canalId);
		const site = canal ? canal.label : canalId;
		/* Non câblé (chatgpt.com, perplexity.ai tant qu'ils ne sont pas
		   mesurés) : la notice, et la demande revient au composer. */
		if (!canal || !canal.web) {
			host.ui.notice(t("ai.channel.notWiredYet", { site }));
			restoreComposerMessage();
			phase = "idle";
			render(container);
			return;
		}
		/* Ni une adresse ni un presse-papier texte ne transportent une image :
		   rien ne part, le composer garde tout. Même patron que le PDF refusé
		   dans l'application. */
		if (msg.images.length > 0 && !host.depot) {
			host.ui.notice(t("ai.channel.noImages"));
			restoreComposerMessage();
			phase = "idle";
			render(container);
			return;
		}
		/* LES PIÈCES JOINTES SONT GLISSÉES, PAS INLINÉES, quand l'hôte sait les
		   montrer (`host.depot`, l'application) : le prompt qui part dans
		   l'adresse ne porte que la demande et les NOMS des fichiers, et
		   l'Explorateur s'ouvre LÀ OÙ ILS SONT, le premier sélectionné, pour un
		   glisser-déposer sur le site (Ahmed, 2026-09-19 : « ce serait mieux si
		   le fichier était uploadé comme on le fait habituellement »). Le PDF
		   arrive alors en PDF, et l'adresse tient toujours. Une pièce sans
		   chemin (déposée sans origine connue) ne peut pas être montrée : tout
		   est inliné, comme sans `host.depot`. */
		/* Une pièce SANS chemin (image collée, fichier déposé depuis
		   l'Explorateur) est écrite par l'hôte dans un fichier glissable : elle
		   ne retire plus toutes les tuiles, comme le faisait l'ancienne
		   condition « toutes les pièces ont un chemin » (vu le 2026-09-19). */
		let aGlisser: TuileDepot[] = [];
		if (host.depot && (msg.notes.length > 0 || msg.images.length > 0)) {
			const tuiles = await tuilesDeDepot(msg, host.depot);
			if (!tuiles) {
				host.ui.notice(t("ai.web.dropFailed"));
				restoreComposerMessage();
				phase = "idle";
				render(container);
				return;
			}
			aGlisser = tuiles;
		}
		const deposer = aGlisser.length > 0;
		const { source, prompt } = deposer ? demandeAvecFichiersDeposes(msg) : composerDemande(msg);
		const jeton = nouveauJeton();
		await preparerLienLearn(msg);
		const planTranches = planTranchesEnvoye;
		const categorie = categorieChoisie(categorieChoix ?? "auto", indicesCategorie(msg.notes, msg.text));
		/* ONE PASS: the documents named in order, each with ITS Learn plan. */
		const documents = msg.parDocument && msg.notes.length >= 2 ? msg.notes.map(n => n.name) : undefined;
		lotWebLiens = undefined;
		if (documents) {
			const dossier = destination || defaultDestination();
			lotWebLiens = await Promise.all(msg.notes.map(async n => {
				const l = await lienLearn(deps.scanner, modeGeneration, dossier, { ...msg, notes: [n], parDocument: false });
				return l.plan || l.note ? l : undefined;
			}));
		}
		const texte = texteWeb(composerPrompts(prompt, { count: questionCount, type: effectiveTypes(), mode: modeGeneration, source, planTranches, categorie, documents, plansParDocument: lotWebLiens?.map(l => l?.plan) }), jeton);
		const ouverture = preparerOuverture(texte, canal.web);
		if (ouverture.mode === "presse-papier") {
			const ok = deps.copyText ? await deps.copyText(ouverture.texte) : false;
			if (!ok) { echecOuverture(t("ai.channel.copyFailed"), container); return; }
		}
		/* LA DISPOSITION AVANT L'OUVERTURE : Neo Quiz passe à droite et
		   l'Explorateur s'ouvre sur le fichier PENDANT que le principal guette le
		   navigateur ; celui-ci est posé à gauche dès qu'il apparaît, puis
		   l'Explorateur revient devant. Ouvrir d'abord le site faisait bouger
		   trois fenêtres l'une après l'autre sous les yeux (Ahmed, 2026-09-19 :
		   « le plus proprement possible »). */
		/* Les fichiers à glisser : ceux de la demande, tels que l'hôte saura les
		   résoudre (vault → `HostFile` par l'index ; externe ou choisi par le
		   dialogue → chemin absolu déjà admis). */
		/* Le prompt parti par le presse-papier est COLLÉ par l'hôte dans la
		   page une fois chargée (meilleur effort, voir `HostDepot.disposer`). */
		if (host.depot) await host.depot.disposer({ coller: ouverture.mode === "presse-papier" });
		if (!(await host.shell.openUrl(ouverture.url))) { echecOuverture(t("ai.channel.openFailed"), container); return; }
		arreterAttenteWeb();
		/* Écouteurs de la phase : Esc annule ; un collage hors du composer est
		   la réponse (le composer, lui, sert à écrire une nouvelle demande).
		   Posés sur `document` pour jusqu'à 30 minutes (ECHEANCE_MS) — le temps
		   que l'utilisateur peut passer sur une AUTRE vue du tableau de bord
		   (éditeur d'un autre quiz, recherche…) pendant que la veille tourne.
		   Chacun se garde donc d'agir si la carte d'attente n'est PLUS à
		   l'écran : sinon un Esc qui ferme une modale ailleurs annulait cette
		   attente, et un Ctrl+V dans un champ de la page courante se voyait
		   avalé et peint en « pas un quiz » par-dessus la vue qu'on regardait. */
		const carteAttenteVisible = (): boolean => !!document.querySelector(".qbd-ai-web-card");
		const surTouche = (e: KeyboardEvent): void => {
			if (!carteAttenteVisible()) return;
			if (e.key === "Escape") { e.preventDefault(); annulerAttenteWeb(); }
		};
		const surCollage = (e: ClipboardEvent): void => {
			if (phase !== "web" || !carteAttenteVisible()) return;
			const cible = e.target as HTMLElement | null;
			/* Toute cible ÉDITABLE garde son collage normal — pas seulement le
			   composer : un champ de recherche, un textarea, un champ portalé
			   (menu, modale…). Ce n'est que hors de tout champ que le collage
			   est interprété comme la réponse du site. */
			if (cible && cible.closest("input, textarea, [contenteditable=''], [contenteditable='true'], .qbd-ai-composer")) return;
			const colle = e.clipboardData?.getData("text/plain") || "";
			if (!colle.trim()) return;
			/* SON PROPRE PROMPT N'EST PAS UNE RÉPONSE : le Ctrl+V que l'hôte
			   envoie au navigateur peut retomber ici si le focus a changé entre
			   temps. Le texte est alors celui qu'on vient de copier ; le lire
			   comme une réponse aurait peint « pas un quiz » sur la carte. */
			if (attenteWeb && attenteWeb.ouverture.mode === "presse-papier" && colle.trim() === attenteWeb.ouverture.texte.trim()) return;
			e.preventDefault();
			void recevoirReponse(colle);
		};
		document.addEventListener("keydown", surTouche);
		document.addEventListener("paste", surCollage, true);
		attenteWeb = {
			jeton, ouverture, site, aGlisser,
			arreter: host.collage ? host.collage.attendre(jeton, texteRecu => void recevoirReponse(texteRecu)) : null,
			retirer: () => { document.removeEventListener("keydown", surTouche); document.removeEventListener("paste", surCollage, true); },
		};
		attenteWebSite = site;
		errorMessage = "";
		errorLogin = null;
		errorAction = null;
		phase = "web";
		render(container);
	}

	function echecOuverture(message: string, container: HTMLElement | null): void {
		errorMessage = message;
		errorLogin = null;
		errorAction = null;
		phase = "error";
		render(container);
	}

	/** Rouvrir = rejouer l'ouverture, avec un jeton neuf : le même chemin que
	    « Réessayer » (restore puis startGeneration), qui repasse par
	    ouvrirSite. */
	function rouvrirSite(): void {
		arreterAttenteWeb(true);
		relancerApresErreur();
	}

	/** Arrête la veille et retire les écouteurs ; ne touche pas à la phase. */
	function arreterAttenteWeb(garderDisposition = false): void {
		if (!attenteWeb) return;
		attenteWeb.arreter?.();
		attenteWeb.retirer();
		attenteWeb = null;
		/* La disposition des fenêtres prend fin avec l'attente (réponse reçue,
		   annulation) : l'Explorateur se ferme, Neo Quiz revient devant,
		   centré. Sauf pour « Rouvrir », qui relance une attente tout de
		   suite : la rendre puis la refaire ferait sauter les fenêtres. */
		if (!garderDisposition) void host.depot?.terminer();
	}

	/** Annuler = défaire l'ouverture : la demande revient dans le composer. */
	function annulerAttenteWeb(): void {
		arreterAttenteWeb();
		/* Au milieu d'un lot, les quiz déjà reçus sont enregistrés : annuler
		   les suivants ouvre le premier, plutôt que de rendre au composer des
		   fichiers déjà traités. */
		const premier = lotWebPremier;
		oublierLotWeb();
		if (premier) { resetGeneration(); premier(); return; }
		restoreComposerMessage();
		phase = "idle";
		render(containerRef);
	}

	/**
	 * LE SEUL chemin par lequel une réponse copiée devient un quiz, qu'elle
	 * vienne de la veille du principal ou d'un collage manuel. Ensuite, la
	 * même suite qu'une génération : la page du quiz enregistré.
	 */
	async function recevoirReponse(texte: string): Promise<void> {
		if (phase !== "web" || disposed) return;
		arreterAttenteWeb();
		/* La livraison peut arriver pendant que l'utilisateur est sur une AUTRE
		   vue (`host.collage` a reçu le texte côté principal pendant la veille,
		   sans que la page « Générer » soit à l'écran) : `render(containerRef)`
		   plus bas repeindrait alors la vue courante par-dessus. On revient
		   d'abord sur « Générer » — le chemin de succès d'une génération CLI le
		   fait déjà pour la page détail, ceci est son équivalent en entrée.
		   La SCÈNE et non le conteneur : celui de la coquille reste dans le
		   document quelle que soit la vue peinte. */
		if (!stageRef?.isConnected) deps.navigate("ai");
		if (demandeWeb?.parDocument && demandeWeb.notes.length >= 2) { await recevoirLotWeb(texte, demandeWeb); return; }
		try {
			const reponse = parseReponseQuiz(texte);
			// Configuration scindée en deux objets consécutifs (lot D §5) : fusionnée
			// ICI, avant toute lecture de la position du dernier élément.
			generatedQuestions = fusionnerConfigsFinales(reponse.questions);
			generatedTitre = reponse.titre;
			resultatFige = null;
			if (generatedQuestions.length === 0) throw new Error(t("ai.err.notAnArray"));
		} catch (err) {
			errorMessage = (err as Error).message || t("ai.error.checkSettings");
			errorLogin = null;
			errorAction = "reopen";
			generatedQuestions = [];
			phase = "error";
			render(containerRef);
			return;
		}
		lastUsage = null;
		generationId++;
		generatedDraft = null;
		/* LA RÉCEPTION SE VOIT : la modale reste ouverte et passe à « reçu »
		   (coche, nom du quiz) ; l'enregistrement se fait pendant ce temps, et
		   la modale ne se ferme qu'après la seconde qui rend l'état lisible
		   — la même seconde que la détection de connexion. Neo Quiz revient
		   devant pour qu'on la voie : l'utilisateur vient de copier dans le
		   navigateur. */
		reponseRecue = { titre: generatedTitre };
		void host.ui.premierPlan?.().catch(() => { /* la page reste juste derrière */ });
		render(containerRef);
		const [navigated] = await Promise.all([
			saveGeneratedQuiz({ differerNavigation: true, demande: demandeWeb ?? undefined }),
			new Promise<void>(resolve => window.setTimeout(resolve, 1000)),
		]);
		reponseRecue = null;
		if (disposed) return;
		/* UN QUIZ PAR FICHIER JOINT : un autre fichier attend son tour → le site
		   se rouvre pour lui, avec la même consigne. La page du PREMIER quiz
		   enregistré s'ouvre quand le dernier est reçu. */
		if (lotWebRestant.length > 0) {
			if (navigated && !lotWebPremier) lotWebPremier = navigated;
			const suivant = lotWebRestant.shift() as SentMessage;
			const fait = lot?.nom ?? "";
			const total = lot?.total ?? lotWebRestant.length + 2;
			lot = { index: (lot?.index ?? 1) + 1, total, nom: suivant.notes[0]?.name ?? "" };
			host.ui.notice(t("ai.batch.webNext", { file: fait, next: lot.nom }));
			await ouvrirSite(suivant, containerRef);
			return;
		}
		const premier = lotWebPremier ?? navigated;
		oublierLotWeb();
		if (premier) { premier(); return; }
		phase = "result";
		render(containerRef);
	}

	/** ONE PASS on a site (2026-10-01): the answer holds one quiz per document.
	    A wrong count, an unknown tag or an empty quiz is an error shown with
	    "reopen" (nothing is saved); otherwise one note per document is written
	    (`enregistrerLot`, the names of a generation made for each document
	    alone) and the page of the FIRST one opens. */
	async function recevoirLotWeb(texte: string, msg: SentMessage): Promise<void> {
		const mode = modeGeneration;
		let quiz: { document: string; questions: unknown[]; titre?: string }[];
		try {
			quiz = parseReponseLot(texte, msg.notes.map(n => n.name)).map(q => {
				const brut = fusionnerConfigsFinales(q.questions);
				return { ...q, questions: mode === "learn" ? completerConfigLearn(brut) : brut };
			});
		} catch (err) {
			errorMessage = (err as Error).message || t("ai.error.checkSettings");
			errorLogin = null;
			errorAction = "reopen";
			phase = "error";
			render(containerRef);
			return;
		}
		lastUsage = null;
		reponseRecue = { titre: t("ai.queue.lotSaved", { count: quiz.length }) };
		void host.ui.premierPlan?.().catch(() => { /* la page reste juste derrière */ });
		render(containerRef);
		const [faits] = await Promise.all([
			enregistrerLot({
				demande: msg, lot: quiz, liens: lotWebLiens, modeDemande: mode, destination,
				reglages: settings(), usage: null, scanner: deps.scanner,
			}),
			new Promise<void>(resolve => window.setTimeout(resolve, 1000)),
		]);
		reponseRecue = null;
		if (disposed) return;
		if (!faits) {
			oublierLotWeb();
			host.ui.notice(t("ai.notice.saveFailed"));
			phase = "idle";
			render(containerRef);
			return;
		}
		oublierLotWeb();
		host.ui.notice(t("ai.queue.lotSaved", { count: faits.length }));
		const premier = deps.scanner.getQuiz(faits[0].chemin);
		resetGeneration();
		if (premier) deps.navigate("detail", { quiz: premier, entree: "generation" });
	}

	/* Insère le quiz dans la note choisie via le picker (« Insérer dans une
	   note »). L'état ÉDITÉ de l'éditeur embarqué prime sur les questions
	   générées brutes (les retouches faites dans l'éditeur sont insérées). */
	async function insertIntoNote(file: HostFile): Promise<void> {
		if (!file) return;
		let quizJson: string;
		// L'état ÉDITÉ prime sur les questions générées brutes : les retouches
		// faites dans la page (réponses, ordre, mode) sont ce qu'on insère.
		const draft = generatedDraft && generatedDraft.genId === generationId ? generatedDraft.draft : null;
		if (draft && draft.questions.length) {
			quizJson = exportAll(draft.questions, draft.examOptions);
		} else if (generatedQuestions.length) {
			quizJson = JSON5.stringify(generatedQuestions, null, 2);
		} else {
			return;
		}

		try {
			const quizBlock = "```quiz-blocks\n" + quizJson + "\n```";
			/* `fs.process` et non `read` + `write` : entre les deux, une
			   modification faite ailleurs (éditeur markdown, synchro) était
			   écrasée — et l'insertion annonçait quand même « Quiz inséré ».
			   Ici la lecture et l'écriture sont indivisibles (voir le contrat),
			   et le contenu ajouté l'est à ce qui EST dans le fichier, pas à ce
			   qu'on avait lu. La détection d'un bloc existant se fait dans le même
			   passage : la tester avant laissait la place à un bloc arrivé
			   entre-temps. */
			let dejaUnBloc = false;
			await host.fs.process(file.path, (content) => {
				// Le rappel peut être rejoué : repartir de zéro à chaque essai.
				dejaUnBloc = content.includes("```quiz-blocks");
				if (dejaUnBloc) return content;
				return content + "\n\n" + quizBlock;
			});
			if (dejaUnBloc) {
				host.ui.notice(t("ai.notice.blockExists", { name: file.basename }));
				return;
			}
			host.ui.notice(t("ai.notice.quizInserted", { name: file.basename }));

			/* Le quiz a maintenant une NOTE : on va sur sa page, celle qui écrit
			   dans le fichier. Rester sur la page « Générer » laisserait deux
			   copies du même quiz — une en mémoire qui ne se sauvegarde nulle
			   part, une sur le disque — et la première retouche irait dans le
			   vide. Le scan du seul fichier suffit à obtenir son entrée : le
			   scan de vault complet arriverait trop tard. */
			const hostFile = host.fs.getFile(file.path);
			if (hostFile) await deps.scanner.scanFile(hostFile);
			const entry = deps.scanner.getQuiz(file.path);
			if (entry) {
				resetGeneration();
				deps.navigate("detail", { quiz: entry });
			}
		} catch (err) {
			host.ui.notice(t("ai.notice.insertFailed"));
		}
	}

	function dispose(): void {
		/* Les générations de la FILE survivent à la vue (spec 2026-09-26) :
		   elle ne fait que s'en désabonner. Leurs lignes réapparaissent au
		   prochain montage de la page. */
		disposed = true;
		vueFile.liberer();
		desabonnerPage();
		desabonnerChats();
		if (ollamaPoll) { window.clearInterval(ollamaPoll); ollamaPoll = null; }
		couperSondeConnexion();
		arreterAttenteWeb();
		closeAllSelects();
		if (composerResizeObserver) { composerResizeObserver.disconnect(); composerResizeObserver = null; }
		if (__focusRecheck) { window.removeEventListener("focus", __focusRecheck); __focusRecheck = null; }
		raccourciComposer?.retirer();
		raccourciComposer = null;
		veilleComposerActif?.retirer();
		veilleComposerActif = null;
		// `void` : après un échec d'écriture, ce brouillon n'a toujours pas de
		// note à autosauvegarder ; la promesse rendue est déjà résolue.
		void resultPage?.dispose();
		resultPage = null;
		generatedDraft = null;
		dropSentMessage();
		/* Une transcription en vol survit au DOM mais pas à la vue : l'arbre
		   de yt-dlp est tué avec elle. */
		tuilesVideo.vider();
		for (const img of images) URL.revokeObjectURL(img.url);
		images = [];
		zoneVideo = null;
		zoneNoticeVideo = null;
		containerRef = null;
		stageRef = null;
	}

	return { render: entrer, openAddFiles, dispose, preset };
}
