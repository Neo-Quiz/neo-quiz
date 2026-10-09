import JSON5 from "json5";
import { currentHost, requireHost } from "../host/current";
import { jetonFichier, jetonHome, jetonSortie, nouveauMarqueur } from "../host/jetons";
import {
	resolveClaudeModel,
	resolveCodexModel, resolveAntigravityModel, antigravityModelId, niveauAntigravity, resolveOllamaSelection,
	resolveEffort,
	getCodexModels,
	getEfforts,
	getProvider,
	isOllamaCloudModel,
	refreshCliCaches,
	erreurOllamaHorsPlan,
} from "./ai-providers";
import type { AiSettingsHost } from "./ai-settings-host";
import type { AiUsage } from "./usage-format";
import { currentLang, t } from "../i18n";
import type { ModeGeneration } from "../quiz-format";
import type { CategorieQuiz } from "./categorie-quiz";
import { complementCategorie } from "./categorie-prompt";
import { clarifyPrompt } from "./generation-kind";
import { READING_MAX_CHARS } from "../lecture-style";
import { claudeResultDuFlux, createTranscriptDecoder } from "./transcript";
import type { TranscriptEvent } from "./transcript";

/* ══════════════════════════════════════════════════════════
   AI CLIENT — Claude Code + Codex + Ollama

   TOUT passe par le contrat d'hôte depuis la tranche 5, tâche 4 :
   — Claude et Codex par `host.process.run`. Ce module ne garde que la
     CONSTRUCTION des arguments et le PARSING de la sortie ; le `spawn`, le
     `stdin` écrit puis fermé, les deux flux lus séparément, le `taskkill` de
     l'arbre à l'annulation et le dossier temporaire des images vivent dans
     l'hôte. Les pièces jointes ne sont plus des CHEMINS mais des jetons
     (`src/host/jetons.ts`) que l'hôte remplace : le rendu de l'application n'a
     pas de disque, et n'apprend donc aucun chemin. Les jetons portent un
     MARQUEUR tiré au sort par appel — sans lui, une note jointe qui cite un
     moteur de gabarits (`{{home}}` chez Handlebars, Jinja, Mustache) faisait
     partir un chemin absolu de la machine au modèle.
   — Ollama par `host.net.fetchJson`, qui rend le CORPS d'un statut d'erreur
     (c'est là qu'Ollama met son diagnostic, et c'est pourquoi ce module
     employait `fetch` plutôt que `requestUrl`).
══════════════════════════════════════════════════════════ */

/* NO TIME LIMIT on a generation (2026-10-08). A fixed limit (3 min, then
   15 min) killed runs that were still working: a reasoning model fed eighteen
   course PDFs thought for more than 12 minutes and was killed at 15, a minute
   after it had started writing, and everything it had produced was lost. The
   run now lasts as long as the model works, as in MonoCode; the user stops it
   with Stop, and the live transcript shows that it is working. */
/** The clarify call of "Generate" gives up after this long (the default question shows). */
const DECIDE_TIMEOUT_MS = 30000;

/** The effort levels `claude --effort` accepts. "ultracode" is a Claude Code
    mode, not a level: it runs at the highest one. */
function claudeEffortArg(effort: string): string | null {
	if (effort === "ultracode") return "max";
	return /^(low|medium|high|xhigh|max)$/.test(effort) ? effort : null;
}

/** Le NOM du fichier que Codex écrit avec `-o`, relu par l'hôte et rendu dans
    `sortie`. Le chemin absolu, lui, ne quitte jamais l'hôte : les arguments
    l'écrivent avec `jetonSortie(marqueur)`. */
const CODEX_FICHIER_SORTIE = "last-message.txt";

/** Image jointe à la génération (vision). */
export interface ImagePayload {
	base64: string;
	mediaType?: string;
}

/** Options de génération (nombre, type, source, images). */
export interface GenerateOptions {
	/** `null` : « Auto », le nombre suit la source (bornes du mode). */
	count?: number | null;
	/** Canonical type VALUES: a list, or one string (a request saved by an
	    earlier version of the queue); see `normalizeTypes`. */
	type?: string | string[];
	source?: string;
	images?: ImagePayload[];
	/** Absent: Test (`"practice"`), like a block without a mode object. */
	mode?: ModeGeneration;
	/** Practice only: the slices of the Learn of the same source, to set
	    `slice` (spec §2). Ignored in Learn. */
	planTranches?: { slice: number; titre: string }[];
	/** "/exam": the step of the preparation this generation is. */
	preparation?: PreparationExamen;
	/** La catégorie du quiz (categorie-quiz.ts), figée à l'envoi : son
	    complément s'ajoute au prompt système. Absente ou `general` : rien. */
	categorie?: CategorieQuiz;
	/** The live transcript (2026-09-29, `transcript.ts`): each event of the
	    CLI's work as it happens — Claude Code and Codex only; the other
	    providers answer in one piece. */
	onTranscript?: (event: TranscriptEvent) => void;
	/** The resume key of this generation (2026-09-30, `HostProcess.run`):
	    stable across a reload of the page, so the queue restored after it
	    attaches to the CLI still running instead of launching a new one.
	    Each CLI call of the generation gets its own key from it. */
	reprise?: string;
	/** ONE PASS OVER N DOCUMENTS (2026-10-01): the names of the attached
	    documents, in order, when the request asks for ONE quiz PER document
	    from a single reading of all of them. At least two: the prompt then
	    names them and asks for one quiz per document, each wrapped with its
	    document name (`parseReponseLot` reads that answer). Absent or fewer
	    than two: the usual single-quiz prompt, unchanged. */
	documents?: string[];
	/** With `documents`: the slice plan of the Learn of each document (same
	    order, `undefined` for a document with no Learn) — a Test follows the
	    Learn of ITS document. */
	plansParDocument?: ({ slice: number; titre: string }[] | undefined)[];
}

/** Une réponse LUE : les questions, et le titre que le modèle a choisi
    pour le quiz (`// title:` en tête du tableau ; `title` de l'objet pour
    Ollama). `titre` absent quand le modèle n'en a pas donné : le nom du
    fichier retombe alors sur la demande. */
/** One step of an exam preparation ("/exam"): the Learn (`palier` 0), then
    the Tests of level 1 to `paliers`, the last at the exam's level. */
export interface PreparationExamen {
	examen?: { nom: string; date: string; module: string };
	palier: number;
	paliers: number;
	/** A Learn covers ONE of the exam's documents (its name); the Tests, all of them. */
	document?: string;
	/** The preparation this step belongs to, and its place in it (1-based):
	    the queue shows the request once, then names each step. Not in the prompt. */
	lot?: string;
	etape?: number;
	etapes?: number;
	/** The step of the PLAN the model made after reading every document
	    (2026-09-30): its title, what it covers, and the whole plan's titles. */
	titre?: string;
	focus?: string;
	plan?: string[];
	/** The EXAMINABLE POINTS this quiz covers, listed by the plan: one
	    question each, no other (2026-09-30). */
	points?: string[];
}

/** One step of the plan of an exam preparation, chosen by the model. */
export interface EtapePlan {
	titre: string;
	type: "learn" | "practice";
	focus: string;
	/** Every examinable point of this quiz: the quiz asks one question per point. */
	points: string[];
}

/** Reads the plan the model wrote (a JSON array, possibly fenced): only valid
    steps are kept, of the allowed type when one is imposed; at most 12. */
export function lirePlan(texte: string, typeImpose?: "learn" | "practice"): EtapePlan[] {
	const brut = retirerFence(texte).trim();
	const debut = brut.indexOf("[");
	const fin = brut.lastIndexOf("]");
	if (debut < 0 || fin <= debut) return [];
	let liste: unknown;
	try { liste = JSON5.parse(brut.slice(debut, fin + 1)); } catch { return []; }
	if (!Array.isArray(liste)) return [];
	const etapes: EtapePlan[] = [];
	for (const x of liste) {
		if (!x || typeof x !== "object") continue;
		const o = x as Record<string, unknown>;
		const titre = typeof o.title === "string" ? o.title.trim() : "";
		const focus = typeof o.covers === "string" ? o.covers.trim() : "";
		const type = o.type === "test" || o.type === "practice" ? "practice" : o.type === "learn" ? "learn" : null;
		if (!titre || !type) continue;
		const points = Array.isArray(o.points) ? o.points.filter((x): x is string => typeof x === "string" && !!x.trim()).map(x => x.trim()) : [];
		etapes.push({ titre, focus, type: typeImpose ?? type, points });
	}
	return etapes.slice(0, 12);
}

export interface ReponseQuiz {
	questions: unknown[];
	titre?: string;
}

/** How a CLI's text becomes a `ReponseQuiz`: one quiz, or (one pass over N
    documents) `lot`, one quiz per document. */
type LireReponse = (texte: string) => ReponseQuiz & { lot?: ReponseDocument[] };

/** The quiz of ONE document in the answer of a one-pass generation. */
export interface ReponseDocument {
	/** The document's name, as it was given in `GenerateOptions.documents`. */
	document: string;
	questions: unknown[];
	titre?: string;
}

/** The first line of an answer written INSTEAD of a quiz: Generate always
    makes a quiz, unless the request explicitly asks for none (2026-09-30). */
export const NO_QUIZ_MARKER = "NO_QUIZ";

/** Thrown by the parser when the model answered in prose on request
    (`NO_QUIZ_MARKER`): not a failure, the text is the answer to show. */
export class NoQuizAnswer extends Error {
	constructor(readonly texte: string) {
		super("no quiz requested");
	}
}

/** One turn of a conversation with the model (`AiClient.chat`). */
export interface ChatTurn {
	role: "user" | "assistant";
	text: string;
}

/** Options of `AiClient.chat`. */
export interface ChatOptions {
	context?: string;
	onTranscript?: (event: TranscriptEvent) => void;
	/** `explain`: the "Explain" button of a question — the model assumes the
	    learner knows nothing of the subject (2026-09-29). */
	style?: "explain";
	/** Pictures that go with the conversation (the course's figures), through
	    the same attachment path as a generation's images: Claude Code reads
	    them, Codex gets `-i`, Ollama takes base64. Antigravity cannot receive
	    pictures: it gets `imageNames` as text instead. */
	images?: ImagePayload[];
	/** The pictures' file names, for a provider that cannot see them. */
	imageNames?: string[];
	/** The longest answer wanted, in characters (the model is asked for it). */
	maxChars?: number;
}

/** Client IA — retour de createAiClient(plugin). */
export interface AiClient {
	/** With `options.documents`, resolves with `lot` (one quiz per document, in
	    the documents' order) and an empty `questions`; otherwise one quiz. */
	generate(prompt: string, options?: GenerateOptions): Promise<ReponseQuiz & { lot?: ReponseDocument[] }>;
	/** A CONVERSATION with Claude Code or Codex (2026-09-29): the whole
	    history goes with each message — the CLI stays stateless, launched
	    with the same fixed options and no tool as a generation — and the
	    answer comes back as prose. `context` is attached text (notes read by
	    the page). Any other provider rejects with a message saying so. */
	chat(history: ChatTurn[], options?: ChatOptions): Promise<string>;
	/** "/exam": the model reads every document, then plans the quizzes. `[]`: no plan (unsupported provider or unreadable answer). */
	planifier(demande: string, documents: string, typeImpose: "learn" | "practice" | undefined, options?: { onTranscript?: (event: TranscriptEvent) => void; reprise?: string }): Promise<EtapePlan[]>;
	/** The short call that may ask clarifying questions before a vague request
	    generates (spec 2026-10-07-generate-auto-kind): the request and the NAMES of the
	    documents only, the lowest effort, 30 s at most. Resolves with the
	    model's raw text (`parseClarifyAnswer` reads it); rejects on any failure,
	    including a provider that cannot hold the exchange. */
	clarify(request: string, documentNames: readonly string[]): Promise<string>;
	abort(): void;
	/** Consommation de la DERNIÈRE génération réussie ; null si le fournisseur
	    n'a rien publié (cf. ai-usage.ts : on n'estime jamais un compteur absent). */
	lastUsage: AiUsage | null;
}

/** Erreur d'exécution CLI, à la forme que `child_process.exec` produisait.
    Elle SURVIT au passage par `host.process.run` (qui, lui, rejette avec un
    `name` nommé ou rend un code de sortie non nul) parce que toute la
    cartographie des messages plus bas est écrite dessus : la ramener à cette
    forme, c'est garder cette cartographie au mot près. */
type ExecError = Error & {
	code?: string | number;
	stderr?: string;
	stdout?: string;
	killed?: boolean;
};

/** Ce que `run` rend quand il ne rejette pas. */
interface SortieCli {
	stdout: string;
	stderr: string;
	code: number | null;
	sortie?: string;
}

/**
 * Un rejet NOMMÉ de `host.process.run`, ramené à l'`ExecError` d'avant.
 *
 * `introuvable` était un `ENOENT` de `cp.exec` ; `timeout` était un `killed`
 * (c'est `cp.exec` qui tuait après son `timeout`). Les deux branches de test
 * qui suivent, dans chaque `callX`, sont donc inchangées — et `refuse` ou un
 * `name` inconnu retombent sur le message générique, comme n'importe quelle
 * autre panne de lancement.
 */
function execErrorDepuisRejet(err: unknown): ExecError {
	const source = err as Error;
	const e = new Error(source?.message || String(err)) as ExecError;
	e.stdout = "";
	e.stderr = "";
	if (source?.name === "introuvable") e.code = "ENOENT";
	else if (source?.name === "timeout") e.killed = true;
	return e;
}

/**
 * Un CODE DE SORTIE NON NUL, ramené à la même forme.
 *
 * `cp.exec` appelait son callback avec une erreur dès que le code n'était pas
 * 0 ; `run` RÉSOUT et rend le code. Sans cette traduction, un CLI qui échoue
 * (non connecté, quota dépassé — il écrit son diagnostic sur `stderr` et sort
 * en 1) passerait pour une génération réussie à la sortie vide, et
 * l'utilisateur lirait « réponse illisible » au lieu de « compte non
 * connecté ».
 */
function execErrorDepuisCode(res: SortieCli): ExecError {
	const e = new Error("exit code " + String(res.code)) as ExecError;
	e.code = res.code === null ? undefined : res.code;
	e.stdout = res.stdout;
	e.stderr = res.stderr;
	return e;
}

/** `indisponible` = l'hôte ne sait pas lancer de CLI (l'application jusqu'à la
    tâche 7). Ce n'est ni une panne ni une absence d'installation : le dire
    autrement enverrait l'utilisateur réinstaller un CLI qu'il a déjà. */
function erreurIndisponible(err: unknown): UserFacingError | null {
	return (err as Error)?.name === "indisponible"
		? userError(t("ai.error.providerUnavailable"))
		: null;
}

/** Erreur DÉJÀ formulée pour l'utilisateur (message traduit, affiché tel quel
    par l'écran d'erreur de la vue « Générer »). */
type UserFacingError = Error & { userFacing?: boolean };

/* Le drapeau remplace les tests sur le TEXTE du message (« Le modèle… »,
   « Mémoire insuffisante… ») que faisait callOllama pour distinguer ses
   propres erreurs des pannes réseau : une fois les messages traduits, ces
   préfixes ne correspondent plus dans une autre langue, et l'erreur précise
   serait écrasée par « Impossible de contacter Ollama ». */
function userError(message: string): UserFacingError {
	const e = new Error(message) as UserFacingError;
	e.userFacing = true;
	return e;
}

/** Une erreur dont la CAUSE est un compte non connecté, et qui le dit
    autrement que par son texte : `besoinConnexion` nomme l'outil à connecter.
    C'est ce drapeau, jamais le message, que la page « Générer » lit pour
    remplacer « Réessayer » par « Se connecter ». */
export type LoginRequiredError = Error & { besoinConnexion?: "claude" | "codex" | "ollama" | "agy" };
/** Une erreur dont la CAUSE est un plan insuffisant (Ollama 402) : la carte
    d'erreur remplace « Réessayer » par « Mettre à niveau », parce que
    réessayer rendrait le même 402. */
export type UpgradeRequiredError = Error & { besoinPlan?: true };

/* POURQUOI UN DRAPEAU ET PAS UNE COMPARAISON DE MESSAGE : le message est
   TRADUIT (`ai.err.codexNotLoggedIn`). Le comparer marcherait en anglais et
   plus en français, et le bouton de connexion disparaîtrait dans une langue
   sans qu'aucun contrôle ne rougisse. Même raison que `userFacing`
   ci-dessus. `userFacing` est posé ICI (et pas seulement sur `LoginRequiredError`)
   parce que le bloc Ollama rejette cette erreur DANS le même `try` que son
   catch générique (`if (e.userFacing) throw err`, sinon message générique
   « Ollama injoignable ») : sans ce drapeau, un 401/403 perdrait son
   `besoinConnexion` en traversant ce catch et retomberait sur le message
   réseau générique au lieu de la carte « Se connecter ». */
function erreurConnexion(tool: "claude" | "codex" | "ollama" | "agy", message: string): LoginRequiredError & UserFacingError {
	const e = new Error(message) as LoginRequiredError & UserFacingError;
	e.besoinConnexion = tool;
	e.userFacing = true;
	return e;
}

/** Une erreur « plan insuffisant » (Ollama 402), déjà formulée pour
    l'utilisateur : la carte d'erreur affiche le message tel quel et pose le
    bouton « Mettre à niveau » plutôt que « Réessayer ». */
function erreurPlan(message: string): UpgradeRequiredError & UserFacingError {
	const e = new Error(message) as UpgradeRequiredError & UserFacingError;
	e.besoinPlan = true;
	e.userFacing = true;
	return e;
}

/**
 * Une promesse RÉSEAU, qui rend la main dès l'abandon.
 *
 * LE FILET DE LA VOIE NON ANNULABLE, et rien de plus. Un hôte peut honorer le
 * `signal` (l'application le relaie par son canal `reseau.annuler` ; le greffon
 * emploie `fetch` pour la boucle locale, donc pour Ollama en local) — là, la
 * requête est vraiment COUPÉE et cette course ne sert à rien. Mais un hôte peut
 * aussi l'IGNORER, et le contrat le dit en toutes lettres : le greffon passe par
 * `requestUrl`, qui n'accepte aucun signal, dès que l'URL n'est pas locale — un
 * Ollama sur une autre machine, réglage que le composer expose. Sans cette
 * course, un clic sur Stop y laisserait la page « Générer » figée jusqu'à ce que
 * le modèle ait fini. La requête, elle, continue : son résultat est jeté, et
 * `generate()` a déjà traduit l'abandon en retour à l'état initial.
 */
function courseAbandon<T>(promesse: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(new Error("abandon"));
	return new Promise<T>((resolve, reject) => {
		const surAbandon = (): void => reject(new Error("abandon"));
		signal.addEventListener("abort", surAbandon, { once: true });
		promesse.then(
			v => { signal.removeEventListener("abort", surAbandon); resolve(v); },
			e => { signal.removeEventListener("abort", surAbandon); reject(e as Error); },
		);
	});
}

/** La phrase qui clôt le prompt système d'un CLI. EXPORTÉE parce que le
    canal web la remplace par sa consigne de forme (`texteWeb`, ai-web.ts) :
    une copie divergerait en silence. */
export const PHRASE_FINALE_CLI = "Reply ONLY with the JSON5 array, with no explanation and no formatting.";

/**
 * The two prompts of a generation, PURE: the same text for a CLI, for
 * Ollama and for a website. Moved out of `generateInner` on 2026-09-18 so
 * that the Generate page composes them itself when the channel is a site.
 * In ENGLISH, and INDEPENDENT of the UI language (see the LANGUAGE rule in
 * the prompt); `type` is the canonical VALUE (see TYPE_VALUES in ai.ts).
 * One prompt PER TYPE: Learn and Test (Learn/Practice spec §2). No prompt
 * asks for an Exam: how a Test is taken is chosen when it starts.
 */
/** A Learn cites where each reading comes from: the document and its pages,
    read on the "[p. N]" marks of an attached PDF. */
const LEARN_SOURCES = `SOURCES OF THE READINGS: when the content comes from attached documents, EVERY "read" card has "cite": the document's file name and the page or pages it draws on, read on the "[p. N]" marks that open each page of a PDF — for example "cite": "CM3 - Réseaux.pdf, p. 12-14". Rephrase freely to explain better than the document does; the source says where to read the original. A document without page marks is cited by its name alone. No "cite" when nothing is attached.

`;

/** A reading may SHOW a page of an attached PDF (2026-10-08): the model
    names the page, the application draws it (dashboard/figures.ts). */

/** A reading MAY carry an interactive page (2026-10-09), shown in a sandboxed iframe. */
export const LEARN_HTML = `INTERACTIVE PAGES: a "read" card MAY carry "html": a COMPLETE, self-contained HTML page (starting with <!doctype html>), shown under the reading in a frame the learner can interact with, like a claude.ai artifact. Use it ONLY when a drawn or interactive page explains better than text: notation and symbol tables (drawn in inline SVG), diagrams, a sequence diagram, a process, a state machine, a small simulator, an animation, a clickable mini-quiz. NEVER for plain text, a list or a table that Markdown already shows. Rules: no external resource and no network (no <script src>, no CDN, no web font, no remote image: everything inline, images as data: URIs); the page may run inline scripts, but cannot submit forms, open windows, or reach the app; fluid width (it is shown from 320 px to 900 px wide, use max-width: 100% and viewBox on SVG), no fixed height, no scrollbar; dark-friendly: use the CSS variables --nq-bg, --nq-fg, --nq-muted, --nq-accent and --nq-border and font-family: var(--nq-font), a transparent background, never a hard-coded white page; at most 60 KB. The page is a JSON string: escape its double quotes with a backslash and write each line break as a backslash followed by n. The reading's text still explains the notion; the page illustrates it.
STYLES OF THE INTERACTIVE PAGES, chosen by the content and MIXED when that helps (one page may combine them):
- EXPLORABLE (the default whenever a notion has values, parameters or choices the learner can vary): the learner changes something on a drawing or a control and SEES the consequence at once, the explanatory sentence rewriting itself live ("what if I put 0..1 here instead of 1..*?"). Learning becomes active: they understand by trying. Examples: click a multiplicity to cycle through 1, 0..1, 0..*, 1..* and the sentence says what it now means; a slider for a parameter; a toggle between two cases; a step button that advances a process.
- STRUCTURED COURSE (when there are symbols or a list of things to memorize): a table "symbol · name · what to remember", each symbol DRAWN in SVG as it appears in the course, then a short "traps" box.
- ANNOTATED DIAGRAM (when the notion is a drawing): the explanation placed ON the diagram, with numbered markers and short labels next to the parts they describe, never far from them.
`;
const LEARN_FIGURES = `FIGURES OF THE READINGS: a course PDF often holds diagrams, schemas and tables, and its text shows where: on such a page the words read like the labels of a drawing (boxes, arrows, multiplicities such as 0..* or 1, stereotypes such as «include», actor and state names, axis names, a table's cells). When a "read" card explains a notion that one of those pages DRAWS, the card shows that page: add "figure": the PDF's file name EXACTLY as written in its "--- name ---" header, then ONE page from its "[p. N]" marks, for example "figure": "CM2 - UML.pdf, p. 7". The application draws that page above the reading, so the reading's text explains what the figure shows. Give a figure to EVERY reading whose notion is drawn on a page of the documents; none to a reading with no such page, and never a figure for a document that is not a PDF. One figure per reading.

`;

/** The instructions of one step of an exam preparation ("/exam"). */
function blocPreparation(p: PreparationExamen | undefined, learn: boolean): string {
	if (!p) return "";
	/* A step of the model's own PLAN: the whole plan, then exactly this
	   quiz's part — the other quizzes cover the rest. */
	if (p.titre) {
		const examenP = p.examen ? ` for the exam "${p.examen.nom}" (${p.examen.module}, on ${p.examen.date})` : "";
		const plan = (p.plan ?? []).map((x, i) => `${i + 1}. ${x}`).join("\n\t");
		const points = (p.points ?? []).map(x => "- " + x).join("\n\t");
		const liste = points
			? `\n\tITS EXAMINABLE POINTS, the only ones this quiz asks about — ONE question per point (two only for a point with two genuinely different angles), no question outside this list, no point left without its question:\n\t${points}`
			: " Cover EXACTLY that part, with one question per examinable point of it (the QUANTITY below).";
		return `EXAM PREPARATION${examenP}: after reading all the documents you planned these quizzes, which together cover everything that can come up:\n\t${plan}\n\tTHIS QUIZ is number ${p.etape ?? 1}, "${p.titre}": ${p.focus || p.titre}, from the basics up to the exam's level; the other quizzes cover the rest, so never ask about their points.${liste}\n\n\t`;
	}
	const examen = p.examen ? ` for the exam "${p.examen.nom}" (${p.examen.module}, on ${p.examen.date})` : "";
	const but = `EXAM PREPARATION${examen}: this quiz is one step of a full preparation made from the SAME sources — a Learn path, then ${p.paliers} Tests of rising difficulty. Together they must cover EVERYTHING that can come up in the exam: every notion, definition, method, calculation and classic exercise of the sources, not a sample. The work is split between the quizzes: each asks exactly what its part needs.`;
	const etape = learn
		? `THIS STEP: the Learn path${p.document ? ` of the document "${p.document}" (one Learn per document of the exam; the Tests cover them all)` : ""}, from the basics up to the exam's level, in the order the notions build on each other.`
		: p.palier >= p.paliers
			? `THIS STEP: Test ${p.palier} of ${p.paliers}, AT THE EXAM'S LEVEL — the hardest: questions like the real exam, combining notions, traps, full exercises.`
			: p.palier === 1
				? `THIS STEP: Test 1 of ${p.paliers}, the FUNDAMENTALS: definitions, direct application, one notion per question.`
				: `THIS STEP: Test ${p.palier} of ${p.paliers}, a notch harder: applying and linking notions, fewer direct recalls.`;
	const etapeNom = learn ? (p.document ? `Learn ${p.document.replace(/\.[^.]+$/, "")}` : "Learn") : `Test ${p.palier}`;
	const titre = p.examen ? ` Title it after the exam and the step, for example "// title: ${p.examen.nom} — ${etapeNom}".` : "";
	return `${but}
	${etape}${titre}

	`;
}

/** The canonical value of "Auto" (the AI chooses). */
export const TYPE_AUTO = "Mixte";

/** Any shape of the `type` option (a list, a legacy single string from a
    restored queue entry, nothing) as a non-empty list of canonical values. */
export function normalizeTypes(type?: string | string[] | null): string[] {
	const l = (Array.isArray(type) ? type : [type]).filter((x): x is string => typeof x === "string" && x.trim() !== "");
	return l.length ? [...new Set(l)] : [TYPE_AUTO];
}

/** One sentence per canonical type, for a prompt that names its types. */
const TYPE_SENTENCES: Record<string, string> = {
	"Choix unique": "single-choice questions (exactly one correct answer)",
	"Choix multiple": "multiple-choice questions (several correct answers)",
	"Texte libre": "free-text questions",
	"Réponse numérique": 'numeric-answer questions ("numeric": true, with a tolerance when the result is rounded)',
	"Texte à trous": 'fill-in-the-blanks questions (the "cloze" field)',
	"Classement": 'ordering questions ("ordering": true)',
	"Association": 'matching questions ("matching": true)',
	"Sortie de code": 'code-output questions (a text question with "terminalVariant", asking what a program prints)',
	"Compréhension": `COMPREHENSION questions, ALL of them based on ONE source document that you write yourself.
	Write a substantial passage (250-450 words: an article extract, a case study, a scenario, a piece of code — whatever suits the topic) and put it in the "passage" field of the FIRST question, together with "passageId": "doc1" and a "passageTitle" naming the document.
	EVERY other question repeats ONLY "passageId": "doc1" (no "passage", no "passageTitle" — the engine shares the document automatically).
	The questions must be ANSWERABLE FROM THE DOCUMENT ALONE and test understanding — main idea, inference, meaning in context, cause and effect, the author's intent, what can or cannot be concluded — NOT recall of outside knowledge`,
};

/** Every type string a request may name: the canonical values, nothing else. */
export const CANONICAL_TYPES: readonly string[] = [TYPE_AUTO, ...Object.keys(TYPE_SENTENCES)];

const QCM_EXPLAIN_RULE = 'EVERY question has "explain": SHORT, 1 to 3 sentences saying why the right answer is right and naming the trap. NO step-by-step correction and NO paragraph per wrong option.';

const QCM_FORMAT_BLOCK = `WRITTEN MCQ EXAM FORMAT: write the quiz as the written MCQ (QCM) of an engineering-school exam.
	- Every question has a SHORT "title" naming the notion tested (e.g. "Same IP network membership"), a statement in "prompt", and 3 or 4 options.
	- Most questions have exactly ONE correct answer. About one question in four has SEVERAL correct answers ("multiSelect": true with "correctIndices"). The statement never says HOW MANY answers are correct; at most it says to check all those that apply.
	- Mix concept questions (compare two models, the role of a mechanism), SHORT CALCULATIONS on a concrete given case (is this address in that network, which subnet fits 500 hosts), and SERIES of linked questions that share ONE scenario stated in each of their prompts (same network, same figures, a different question each time). Include AT LEAST ONE such series of 2 or 3 questions whenever the source teaches something that can be applied to a concrete case (a calculation, a program, a configuration).
	- Distractors are PLAUSIBLE: the common confusions and classic mistakes. NEVER an "all of the above" or "none of the above" option.
	- Use only single-choice and multiple-choice questions.`;

export function composerPrompts(prompt: string, options: GenerateOptions = {}): { systemPrompt: string; userPrompt: string } {
	const { count = null, source = "topic", mode = "practice", planTranches, categorie, preparation } = options;
	const types = normalizeTypes(options.type);
	const documents = (options.documents?.length ?? 0) >= 2 ? options.documents as string[] : null;
	const learn = mode === "learn";

	/* The written MCQ exam format: exactly {single, multiple} asked for in a
	   Test, or a request that mentions a QCM/MCQ while the types are Auto. */
	const auto = types.includes(TYPE_AUTO);
	const isQcmList = types.length === 2 && types.includes("Choix unique") && types.includes("Choix multiple");
	const qcm = !learn && (isQcmList || (auto && /\b(qcm|mcq)s?\b/i.test(prompt)));

	// « Mixte » est la valeur canonique d'« Auto » : le mode choisit le mélange.
	const typeInstruction = qcm
		? "a WRITTEN MCQ EXAM (see the WRITTEN MCQ EXAM FORMAT above)"
		: learn && auto
		? "MCQ questions and flashcards, as the MODE above describes (other question types only if the request explicitly asks for them)"
		: auto
		? (
			"the mix of question types that best fits a written exam on this subject: single choice, multiple choice, free text, numeric, ordering, matching, code output")
		: (types.length === 1 ? "" : "ONLY these question types, in a balanced mix: ")
			+ types.map(x => TYPE_SENTENCES[x] ?? x).join("; ")
			// Comprehension alone keeps its own mix of answer types, as before.
			+ (types.length === 1 && types[0] === "Compréhension" ? ". Mix single-choice, multiple-choice and free-text among them" : "")
			+ (types.length > 1 ? (learn ? ". In the learning path these types apply to the pre, explain and recall questions; read cards are unchanged" : "") + ". Use no other question type" : "");

	/* A preparation keeps the usual QUANTITY of one quiz (2026-09-30): an
	   uncapped one gave eight Learns of 52 to 113 questions — some 600 in
	   all, and an hour of generation. The plan splits the program; each
	   quiz of it stays one quiz. */
	const quantite = count != null
		? `QUANTITY: generate exactly ${count} questions — this number wins over any other count, range or list of themes stated in the user request below. If the request asks for more themes than ${count} questions, cover the most important ones; never exceed ${count}.`
		: learn
		? "QUANTITY: cover EVERY EXAMINABLE POINT of the source — a fact, definition, rule, method or classic trap the exam can ask about — across the slices, and no more: each slice has the counts of the MODE below (2 to 3 single-choice questions, 1 to 2 flashcards), NEVER two questions on the same point, no trivia, no filler, and no examinable point left without its question. A slice is a real notion, not a detail: group the small related points of one notion in the same slice."
		: "QUANTITY: exactly as many questions as the source has EXAMINABLE POINTS — no more, no less: one question per fact, definition, rule, method or classic trap the exam can ask about, NEVER two on the same point, no trivia, no filler, and no examinable point left out. The number follows the source, never a target — EXCEPT when the user request below states how many questions it wants (per quiz): that stated number then wins, exactly, in EACH quiz; cover the most important points if the source has more.";

	const blocMode = learn ? `MODE: LEARN. You are writing a guided LEARNING PATH through the source — not a test, and not a summary to read. It is done on a phone, often tired: BY DEFAULT the learner only TAPS. A Learn contains ONLY the reading cards, MCQ questions in the style of the course's real exam, and flashcards; the FIRST question of a slice is EASY, right after the notion it checks, and the following ones come closer to the exam.
	WHO IT IS FOR: the learner did NOT follow the lecture (a long class where the teacher explained for hours: attention dropped and much was forgotten). Assume NO PRIOR KNOWLEDGE of the course and teach from zero, in plain language.
	COVERAGE: cover EVERY notion of the provided material, in the order of the source, never a sample: one slice per notion. Each slice teaches first, with a short plain-language reading (what it is, why it matters, a worked example with its code and its output when relevant), and its recall questions come after it and only check what the slice has just taught.
	FIDELITY OF THE READINGS: together, the readings carry EVERY piece of information of the material — every definition, rule, notation, value, example and warning; nothing the course says is lost. They never copy the course sentence by sentence: they REPHRASE it to be easier to understand than the original (plain words, one idea per sentence, the why before the how, a concrete example). They may ADD related knowledge the course does not state when it really helps to understand (an analogy, a classic pitfall, the link with a notion seen before), never something false or off-topic, and never at the cost of a piece of the course.
	Split the source into SLICES (steps), numbered from 1 in "slice", each small enough for ONE screen of reading. Every slice contains, in this order:
	  1. zero or one question with "role": "pre", asked BEFORE the reading, ONLY when the slice brings a genuinely NEW idea the learner could reason about beforehand — not for a syntax detail nor a plain fact. The learner is expected to fail: it is a SINGLE-choice question with "explain". It also has "hint": a clue that lets someone who has NOT read the slice yet reason toward the answer (the principle to apply, an analogy, what a key word means) — never the answer itself.
	  2. exactly one card with "role": "read": "title" names the slice, "lecture" is ALWAYS "etapes", "prompt" is a one-sentence introduction and "etapes" lists 3 to 5 SHORT steps, one idea per string, keeping the teacher's technical terms EXACTLY as in the source, in the order the notion builds up. The whole reading (title, introduction, steps and key points together) stays under ${READING_MAX_CHARS} characters. A read card has no options and no answer. ONE of the steps is a fully WORKED EXAMPLE, correct, step by step: the code in a fenced block naming its language, then WHAT IT PRINTS (or its result); when the slice is not about code, a worked case with figures. Every idiom or compact line of the example is explained IN FULL, the way a good tutor does: the compact form, its result, then the developed equivalent (for example \`[2 * i for i in range(4)]\` gives \`[0, 2, 4, 6]\`, the same as a \`for\` loop that calls \`append\` on an empty list); never leave a compact line unexplained. Example: { "role": "read", "slice": 1, "title": "Lists", "lecture": "etapes", "prompt": "A list holds several values in order.", "etapes": ["Write the values between square brackets.", "Count from 0: the first value is at index 0.", "Worked example:\n\n\`\`\`python\nfruits = ['apple', 'pear']\nprint(fruits[1])\n\`\`\`\n\nThis prints \`pear\`, the value at index 1."] }.
	  KEY POINTS: a read card may add "retenir", what to keep from it: { "forme": "cartes", "items": [{ "recto": "term", "verso": "its meaning in a few words" }, ...] } for TERMS to memorize (flip cards), or { "forme": "recap", "items": ["fact to keep", ...] } for FACTS to keep (a checked recap); 2 to 5 items, never a copy of a later question's answer. Omit "retenir" when it adds nothing.
	  3. then 2 to 3 MCQ questions per slice in all, the optional "pre" one counted: the others have "role": "recall", each with 3 to 5 options ("options"), "explain" and "hint", written like the written MCQ of the course's real exam: ONE OR SEVERAL correct answers ("correctIndex" for one; "multiSelect": true with "correctIndices" for several — the statement never says how many), often a SHORT code snippet in a fenced block to read and predict, PLAUSIBLE distractors (the classic confusions), never "all of the above". The first question of the slice is easy, answered by recognising what the reading said; the next ones are closer to the exam. Never two recalls on the same point.
	  4. 1 to 2 FLASHCARDS per slice, with "role": "recall": set "flashcard": true, put the question in "prompt" (front) and the expected answer in "answer" (back), add "explain"; no "options", no "type". A flashcard is for a pure FACT or SYNTAX whose answer fits in one sentence, one formula or one line of code (a definition, a syntax, the output of a short expression); a slice that introduces TERMS, DEFINITIONS or FACTS to memorize has AT LEAST ONE.
	NOTHING ELSE, unless the request explicitly asks for other types or the QUESTION TYPES line at the end names them: a Learn contains no free-text question (no "type": "text"), no fill-in-the-blanks, no ordering, no matching, no numeric answer, no code exercise and no question asking the learner to write an explanation. Only then may you use other types, in the format of the question types of the request.
	HINTS IN LEARN: EVERY MCQ question of the path has "hint", pre and recall alike; only the read cards and the flashcards have none.
	A "read" passage NEVER contains the exact sentence that a later question of the same slice asks for: recall must be recognition of the idea, not copying.
	"topic": optional short label of a family of notions that are easily confused, shared by the questions that test it.
	The LAST element of the array is the configuration object, with no prompt field: { mode: "learn", "objectives": ["...", "..."], "glossary": [{ "term": "...", "definition": "..." }, ...] } — 3 to 6 learning objectives of the source, each starting with a verb, and the glossary described under GLOSSARY below.`
	: `MODE: PRACTICE. You are writing an exam-preparation bank on the source, in the FORMAT OF A UNIVERSITY EXAM on it.
	Write APPLICATION questions (use a notion in a new case), DISCRIMINATION questions (tell apart two notions that are easily confused) and MULTI-STEP PROBLEMS — not definitions to recite. Calibrate the difficulty UP: a question a student answers without having studied is useless.
	${qcm ? QCM_EXPLAIN_RULE : 'EVERY question has "explain": why the right answer is right AND, for EACH wrong option, one short sentence saying why it is wrong.'}
	"hint": optional — add one when a question deserves it (see HINTS below), and leave it out otherwise.
	${qcm ? QCM_FORMAT_BLOCK + "\n\t" : ""}"topic": a short label of the family of notions the question tests; questions on notions that are easily confused share the same "topic".
	"slice": when a SLICE PLAN of the learning path is given in the request, the number of the slice that teaches what the question tests; otherwise omit it.
	The LAST element of the array is a configuration object, with no prompt field: { mode: "quiz", "glossary": [{ "term": "...", "definition": "..." }, ...] } — the glossary described under GLOSSARY below.`;

	/* Le complément de la CATÉGORIE (retour #7) : une section de plus, entre
	   les consignes du mode et le titre ; rien pour `general`. */
	const complement = complementCategorie(categorie);
	const categorieBloc = complement ? `\n\t${complement}\n` : "";

	/* The text fields the code and markdown rules apply to. */
	const textFields = "title, prompt, options, explain, hint, answer";
	const hintFields = `	- hint: a nudge shown on demand — a string, or for a DIFFICULT question an array of 2 or 3 levels (see HINTS below)
	- runInLastHint: true ONLY on a DIFFICULT question whose prompt holds a python, c or cpp code block and whose "hint" has 2 or 3 levels, when running that program helps without answering in the learner's place (find the bug, choose the fix, explain a behaviour): once the last hint level is revealed, the learner may run it. NEVER on a question asking what a program prints (its answer IS the output), never on an easy question.
`;
	const hintsBlock = `
	HINTS: a "hint" helps without giving the answer away. The learner can open it BEFORE any attempt, from a button under the question: never write it as if an answer had already been given ("you got it wrong", "try again"). Write it as a string, or, for a DIFFICULT question, as an array of 2 or 3 strings from the lightest clue to the most revealing one — the learner reveals them one by one. Put the KEY WORDS of every hint in **bold** (the reader colors them). Every hint gives a CONCRETE, DETAILED example, e.g. "like \`range(1, 3)\`, which gives \`[1, 2]\`". When the answer is written in the reading of the slice, the first level may send the learner back to it ("reread the paragraph on …").
`;

	/* ONE PASS OVER N DOCUMENTS (2026-10-01): the model reads them ALL first,
	   then writes one quiz per document, each focused on its own document but
	   written with the whole set in view. The answer wraps each quiz with its
	   document name (`parseReponseLot`). */
	const blocLot = documents ? `ONE QUIZ PER DOCUMENT — THIS OVERRIDES THE "JSON5 array of questions" FORMAT ABOVE: the request attaches ${documents.length} documents, in this order:
${documents.map((d, i) => `\t${i + 1}. ${d}`).join("\n")}
	Read ALL of them first, to have the whole set in view, then write EXACTLY ${documents.length} quizzes: one per document, in that order. Each quiz is focused on ITS document only, with no question repeated across quizzes — a notion that appears in several documents is asked in the quiz of the document that treats it best — and an explanation may refer to another document when it helps.
	Your answer is ONE JSON5 array with ${documents.length} elements, one per document: { "document": "<the document's name, EXACTLY as listed above>", "title": "<the quiz title, see QUIZ TITLE>", "quiz": [ ...the array of questions described above, configuration object last... ] }. The QUIZ TITLE goes in "title" of each element, not in a comment. Every rule above (QUANTITY, MODE, GLOSSARY, LANGUAGE…) applies to EACH quiz on its own.

	` : "";

	/* The question fields. A Learn is answered by TAPPING (single choice, flashcards): its list names no typed, ordered, matched or computed answer. The Test keeps the full list, unchanged. */
	const learnFields = `	- title: short question title
	- prompt: full question text
	- options: array of 3 to 5 options
	- correctIndex: index of the correct answer (one correct answer)
	- correctIndices: array of indices of the correct answers (several correct answers)
	- multiSelect: true when several answers are correct
	- answer: the back of a flashcard
	- explain: the explanation shown after the answer
	- hint: a nudge shown on demand — a string
`;
	const champs = learn && auto ? learnFields : `	- title: short question title
	- prompt: full question text
	- options: array of options (for single/multiple choice, 3-5 options)
	- correctIndex: index of the correct answer (single choice)
	- correctIndices: array of indices of the correct answers (multiple choice)
	- multiSelect: true for multiple choice
	- type: "text" for free text, omitted otherwise
	- answer: expected answer (free text)
	- explain: the explanation shown after the answer
${hintFields}	- mathInput: true for a text question whose answer is a mathematical expression (the learner answers in a visual EQUATION EDITOR)
	- answerTemplate: a LaTeX template pre-filled in the answer field of a mathInput question, with \\\\placeholder{} for each blank to fill (e.g. 'x = \\\\placeholder{}' ; two solutions: 'x_1 = \\\\placeholder{},\\\\; x_2 = \\\\placeholder{}'). RULES for mathInput: the question text NEVER gives answer-format instructions (no "as a fraction", "comma-separated", "e.g. 1/2") — the equation editor makes all of that pointless; prefer an answerTemplate that guides instead; acceptedAnswers are the COMPLETE content of the field once the template is filled, in LaTeX (e.g. 'x_1 = \\\\frac{1}{2},\\\\; x_2 = 3'), and add variants where relevant (solutions in reverse order)
	- terminalVariant: "python", "bash", "powershell" or "cmd" for a text question answered in a terminal (a command, or the output of a program)
	- cloze: a FILL-IN-THE-BLANK text. Put the whole sentence, paragraph or code in this field and wrap each blank in DOUBLE BRACES, with accepted variants separated by "|": "The capital of France is {{Paris}} and its currency is {{the euro|euro}}." Use double BRACES, never double brackets — double brackets are Obsidian's internal-link syntax and would be rewritten before the quiz is read. Keep "prompt" as the SHORT instruction only ("Complete the text below"), never repeat the text there. 2 to 5 blanks per question, each on a key term, never on a word the sentence already gives away. A blank NEVER sits between the delimiters that frame its answer: chevrons, brackets, parentheses or quotes around it go INSIDE the blank, with the answer — #include {{<stdio.h>}}, never #include <{{stdio.h}}>; printf({{"%d"}}, n), never printf("{{%d}}", n). Left outside, they give away what kind of answer is expected, and the blank becomes too easy. Add "blankMaxLengths": one whole number per blank, in the order of the blanks: the most characters the learner may type in that blank. Take about half again the length of its longest accepted answer, and at least 3 more; never exactly its length, which would give the answer away ({{append}} → 9, {{len}} → 6, {{<stdio.h>}} → 14)
	- numeric / tolerance / tolerancePercent / unit: for a free-text question whose answer is a NUMBER. Set "numeric": true and the answer is compared as a value, not as a string, so "3.14", "3,14" and "3.140" all pass. Add "tolerance" (absolute margin) or "tolerancePercent" (relative margin) whenever the expected answer is a measurement or a rounded result, and "unit" (e.g. "m/s") when one is expected — the learner may write it or omit it. ALWAYS prefer this over a plain text answer for any question that asks "how much", "how many" or a computed value
	- ordering / slots / possibilities / correctOrder: a question where the learner puts items in the RIGHT ORDER. Set "ordering": true, "slots" naming each position (e.g. ['1st','2nd','3rd','4th']), "possibilities" listing the items in a DELIBERATELY WRONG order, and "correctOrder" giving, for each slot in turn, the INDEX of the item of "possibilities" that belongs there. Use it for a chronology, a protocol exchange, the steps of a procedure or a calculation, the lines of a program. Each item of "possibilities" is ONE single line: a line of code is written as inline \`code\` between single backticks, NEVER as a fenced \`\`\` block
	- matching / rows / choices / correctMap: a question where the learner PAIRS two columns. Set "matching": true, "rows" (the left column: terms, devices, codes…), "choices" (the right column: definitions, roles…, listed in a different order from the rows) and "correctMap" giving, for each row in turn, the INDEX of its matching entry in "choices". Use it to oppose notions that are easily confused
	- passage / passageId / passageTitle: a SOURCE DOCUMENT to read before answering (comprehension). "passage" holds the full text, "passageTitle" names it, and "passageId" is a shared key: every question carrying the SAME passageId shows the SAME document, so write the text ONCE on the first question of the group and give the others only their passageId`;

	const systemPrompt = `You are a quiz generator. Generate the quiz questions as a JSON5 array. Each question may have:
${champs}

	${blocMode}
${hintsBlock}
	EXPLANATIONS: in every "explain", put the two or three KEY WORDS in **bold** — no more; the reader colors them.
	ANSWER KEYS: work out every answer (count the items, run the code in your head, do the calculation) BEFORE writing its correctIndex, correctIndices, answer or acceptedAnswers. An "explain" states the result, it never recounts nor corrects itself ("on recounting…", "actually…"): if you find a mistake while writing it, fix the answer key so the two agree.

	GLOSSARY: the configuration object at the end of the array (see above) carries a "glossary" of 5 to 15 KEY TERMS of the source — the technical notions a student must know, never everyday words. Each entry is { "term": "...", "definition": "..." }, plus an optional "aliases": ["..."] for another form of the SAME term used in the text (an acronym, an abbreviation, e.g. "LIFO" for "stack"). Write "term" EXACTLY as it appears in the readings and explanations — same spelling, same form; a term written differently is never matched and never underlined. Write "term" in PLAIN TEXT, NEVER between backticks, even for a keyword or a function of the language: the bare name is the term (e.g. "yield", not \`yield\`) — it is still recognized wherever that name appears inside inline \`code\`. "definition" is ONE OR TWO SENTENCES in markdown (**bold**, \`code\`, a $formula$), understandable on its own WITHOUT the course, and NEVER a copy of a question's answer or explanation. No duplicate term, no filler word.
${categorieBloc}
	QUIZ TITLE: the very first line of the array, right after the opening bracket, is a JSON5 line comment giving the quiz a name: '// title: <name>'. The name is what a student would write on the cover: 3 to 8 words naming its subject and scope (e.g. "Python : types, listes et exceptions"), in the language of the content, WITHOUT the word "quiz" and without a trailing period. Exactly one such line, nowhere else.
	ADDRESSING THE LEARNER: when the quiz is in French, every text that speaks to the learner (prompt, hint, explain, reading) says « tu » (tu, ton, ta, tes, toi), never « vous ».

	LANGUAGE — THIS IS A HARD RULE: write ALL the content you produce (title, prompt, options, answer, explain, hint, objectives, glossary) in THE SAME LANGUAGE AS THE USER REQUEST BELOW. If the request is in French, write the quiz in French; in Arabic, in Arabic; in English, in English. When the request provides source material (a text, a note, images), follow the language of that material. NEVER translate the content into English just because these instructions are in English. The FIELD NAMES (title, prompt, options…) and the JSON5 structure always stay exactly as specified above, in English. Keep the technical terms of the source exactly as the source writes them.

	CODE: every piece of code written inside a sentence — an identifier, a keyword, a command, an option, a file name, a path, an expression — goes between backticks in EVERY text field (${textFields}): \`__init__\`, \`find /var/log -name '*.log'\`, \`i ** 2\`. Without them, \`__init__\` is displayed as a bold "init" and \`**\` as emphasis. CODE OF MORE THAN ONE LINE, in ANY field and ANY question type, is ALWAYS a fenced block naming its language (\`\`\`python … \`\`\`), never one pair of backticks per line: the reader shows the language's logo and colours only on such a block. A "cloze" on code puts the WHOLE program in ONE such block, its blanks inside it: \`\`\`python\nclass Dog:\n    def {{__init__}}(self, name):\n\`\`\`.

	FORMATTING — MARKDOWN ONLY: every text field (${textFields}, passage) is written in MARKDOWN, exactly as in Discord and Obsidian: **bold**, *italic*, \`code\`; a block of code between two lines of three backticks, the language after the opening ones (\`\`\`python); bulleted lists with "- " and numbered lists with "1. ", one item per line; paragraphs separated by an empty line (\\n\\n inside the JSON5 string); a markdown table (| A | B | then |---|---|) when comparing several notions on the same criteria; formulas between dollars as described below. NEVER write an HTML tag (no <p>, <br>, <strong>, <em>, <code>, <pre>, <ul>, <li>, <table>) and never a field whose name ends in "Html": markdown is shorter, and a tag shows up as raw markup when the quiz is edited. A code block ALWAYS names its language right on the opening backticks (\`\`\`python, \`\`\`bash, \`\`\`c…) — NEVER just \`\`\` alone: the reader colors the block from that name, and an unnamed block is shown without color.

	MATHEMATICS: every mathematical expression (formula, function, equation, integral, fraction, exponent, Greek letter…) MUST be written in LaTeX delimited by dollar signs, as in Obsidian: $f(x) = x^3$ inline, $$\\int_0^2 2x\\,dx$$ for a display formula. Never pseudo-notation such as f(x) = x^3 or ∫ from 0 to 2 outside the dollars. This applies to every text field. IMPORTANT: inside JSON5 strings, DOUBLE every backslash — for LaTeX (write '$\\\\frac{a}{b}$' to get \\frac) as well as Windows paths (write 'C:\\\\Users\\\\dev') — a single backslash would be destroyed by the parser.

	NO TOOLS, NO FILE ACCESS — READ THIS BEFORE ANYTHING ELSE: you are running without any tool. You cannot read, open, fetch, write or create a file, a note or a folder, and you must never try: an attempted tool call is not a quiz, and the whole generation fails. The user request below may name files, paths or notes to "read first", or ask you to "create a note" somewhere. Every source it names that actually exists has ALREADY been read for you and its full content is inlined below, between "--- <file name> ---" markers. So: treat those paths as mere labels for the text you already have, ignore every instruction to read, open, create, modify or save anything, and never mention this limitation in your answer. Your ONLY output is the JSON5 array.

${blocPreparation(preparation, learn)}${learn ? LEARN_SOURCES + LEARN_FIGURES + LEARN_HTML : ""}	THE ONLY EXCEPTION: when the user request below EXPLICITLY asks you NOT to make a quiz (for example "don't generate a quiz", "no quiz, just explain"), write no quiz at all: your first line is exactly ${NO_QUIZ_MARKER}, then answer the request in Markdown prose, in the language of the request. Never take this exception on your own: any other request, a question included, gets a quiz.

	${blocLot}${quantite}

	Generate ${typeInstruction}. ${PHRASE_FINALE_CLI}`;

	const plan = !learn && planTranches && planTranches.length
		? `\n\nSLICE PLAN OF THE LEARNING PATH (use these numbers in "slice"):\n${planTranches.map(p => `${p.slice}. ${p.titre}`).join("\n")}`
		: "";
	const plansDocs = documents && !learn && options.plansParDocument
		? documents.map((d, i) => {
			const pl = options.plansParDocument?.[i];
			return pl && pl.length ? `\n\nSLICE PLAN OF THE LEARNING PATH FOR "${d}" (use these numbers in "slice" for the quiz of that document):\n${pl.map(x => `${x.slice}. ${x.titre}`).join("\n")}` : "";
		}).join("")
		: "";
	const userPrompt = (source === "topic"
		? `Generate the quiz about the following topic (keep the quiz in the language of this topic):\n\n${prompt}`
		: source === "text"
		? `Generate the quiz based on the following text (keep the quiz in the language of this text):\n\n${prompt}`
		: `Generate the quiz based on the provided images (keep the quiz in the language of the images and of this request): ${prompt}`) + plan + plansDocs;

	return { systemPrompt, userPrompt };
}

/* Répare le LaTeX à backslash simple qu'un modèle écrit malgré la consigne
   JSON5 (ex. `$\frac{1}{2}$`) : `\f` deviendrait un form feed, `\t` un
   tab, AVALE le backslash des séquences inconnues (\int → int) et JETTE
   une SyntaxError sur \x/\u non-hex ($\xi$, \underline) : LaTeX détruit
   AVANT le parse, irréparable après (baselines gemma4 + review
   multi-angles 2026-07-11). Réparation SCOPÉE AUX SEGMENTS MATH de la
   chaîne brute : dans $...$ / $$...$$ TOUT backslash simple est du LaTeX
   (aucun échappement JSON n'y est légitime) → doublé, paires déjà
   correctes préservées ; hors segments, RIEN n'est touché (\n, \t, \"
   restent des échappements voulus — un placeholder « col1\tcol2 » garde
   sa tabulation, et \right/\neq/\xi ne peuvent plus être corrompus
   puisqu'ils vivent dans les dollars). */
function repairLatexBackslashes(source: string): string {
	// Segments : $$...$$ d'abord (sauts de ligne possibles), puis
	// $...$ inline (mêmes gardes anti-dollar-monétaire que le rendu :
	// collé au contenu des deux côtés, pas de \n).
	const mathFixed = source.replace(/\$\$[^$]+?\$\$|\$(?!\s)[^$\n]*?[^$\s]\$/g, (seg: string) =>
		// L'alternative (\\\\) consomme les paires correctes en
		// premier — sans elle le 2e backslash de « \\frac » (modèle
		// qui échappe bien) produirait « \\\frac » → form feed.
		seg.replace(/(\\\\)|\\([a-zA-Z,;! ])/g,
			(m: string, pair: string | undefined, ch: string | undefined) => pair ? pair : "\\\\" + ch));
	// Hors math : SEULS les \x/\u NON suivis d'hexa valide sont
	// doublés — un \xGG/\uGGGG invalide fait JETER JSON5.parse
	// (SyntaxError), donc ce doublement ne peut jamais casser un
	// échappement légitime. Sauve les chemins Windows des quiz cmd
	// (« cd C:\utils », « C:\x64 ») : sans ça, génération perdue.
	// (\t/\n dans « C:\temp\new » restent indécidables — le prompt
	// système exige désormais les backslashes doublés partout.)
	return mathFixed
		.replace(/(\\\\)|\\x(?![0-9a-fA-F]{2})/g, (m: string, pair: string | undefined) => pair ? pair : "\\\\x")
		.replace(/(\\\\)|\\u(?![0-9a-fA-F]{4})/g, (m: string, pair: string | undefined) => pair ? pair : "\\\\u");
}

/** Le contenu du bloc de code qui ENVELOPPE la réponse, s'il y en a un ;
    sinon la réponse telle quelle. Les fences se cherchent EN DÉBUT DE LIGNE
    seulement, de la première ouvrante à la DERNIÈRE fermante : une question
    de programmation porte un bloc ` ```python ` DANS son énoncé, et
    l'ancienne expression `/```…```/` prenait ce bloc intérieur pour celui du
    quiz — trois lignes de Python à parser, « pas un quiz » (vu par Ahmed le
    2026-09-19). Un bloc intérieur ne commence jamais une ligne : il vit dans
    une chaîne JSON5, sur la ligne de son champ, avec des `\n` littéraux. */
function retirerFence(content: string): string {
	const lignes = content.trim().split("\n");
	const ouvre = lignes.findIndex(l => /^\s*```/.test(l));
	if (ouvre < 0) return content.trim();
	let ferme = -1;
	for (let i = lignes.length - 1; i > ouvre; i--) {
		if (/^\s*```\s*$/.test(lignes[i])) { ferme = i; break; }
	}
	if (ferme < 0) return content.trim();
	return lignes.slice(ouvre + 1, ferme).join("\n").trim();
}

/** An element WITHOUT a prompt that already carries `mode`, `objectives` or
    `glossary`: the model slipped its configuration INTO `questions`, as
    before the fix (the `format` schema described it nowhere). The same
    minimal recognition as `quiz-format.ts` (`separer`): the position depends
    mostly on the ABSENCE of a prompt, not on a complete list of markers — a
    mistake here costs a duplicated glossary at worst, never a lost question
    (the existing object stays in every case). */
function estDejaUneConfig(q: unknown): boolean {
	if (!q || typeof q !== "object" || Array.isArray(q)) return false;
	const o = q as { prompt?: unknown; mode?: unknown; objectives?: unknown; glossary?: unknown };
	return !o.prompt && ("mode" in o || "objectives" in o || "glossary" in o);
}

/** Rebuilds the `questions` array expected by the rest of the pipeline
 * (`findQuizModeConfigIndex`, `extractExamOptions`…) from Ollama's
 * STRUCTURED response: `mode`, `objectives` and `glossary` arrive at the ROOT level of the object (next to `questions`,
 * never INSIDE the schema of a question — see the comment of the `format`
 * schema in `callOllama`), so never in the array itself. A final
 * configuration object is appended from these root fields; EXCEPT when the
 * model already slipped one into `questions` despite the schema
 * (`estDejaUneConfig`) — then nothing is added, the existing object is
 * enough and adding a second one would have split the configuration (batch D
 * spec §5). PURE: never mutates `obj.questions`.
 */
export function assemblerQuestionsOllama(obj: { questions: unknown[]; mode?: unknown; objectives?: unknown; glossary?: unknown }): unknown[] {
	if (obj.questions.some(estDejaUneConfig)) return obj.questions;
	const config: Record<string, unknown> = {};
	if (typeof obj.mode === "string" && obj.mode.trim()) config.mode = obj.mode;
	if (Array.isArray(obj.objectives) && obj.objectives.length > 0) config.objectives = obj.objectives;
	if (Array.isArray(obj.glossary) && obj.glossary.length > 0) config.glossary = obj.glossary;
	if (Object.keys(config).length === 0) return obj.questions;
	return [...obj.questions, config];
}

export function parseOllamaResponse(content: string): ReponseQuiz {
	let cleaned = retirerFence(content);
	cleaned = repairLatexBackslashes(cleaned);

	// Ollama with format: structured JSON wraps the array in an object
	// e.g. { "title": "…", "questions": [...], "mode": "…", "glossary": [...] }
	try {
		const parsed: unknown = JSON5.parse(cleaned);

		// If it's an object with a "questions" key, extract the array
		if (parsed && !Array.isArray(parsed) && Array.isArray((parsed as { questions?: unknown }).questions)) {
			const obj = parsed as { questions: unknown[]; title?: unknown; mode?: unknown; objectives?: unknown; glossary?: unknown };
			return { questions: assemblerQuestionsOllama(obj), titre: nettoyerTitre(typeof obj.title === "string" ? obj.title : "") };
		}

		if (Array.isArray(parsed)) {
			return { questions: parsed, titre: titreEnCommentaire(cleaned) };
		}

		throw new Error("Format inattendu");
	} catch (err) {
		// Try the generic parser as fallback
		return parseReponseQuiz(content);
	}
}

/** Le titre que le modèle a écrit en commentaire de tête (`// title: …`),
    ou `undefined`. Il doit précéder la PREMIÈRE question : seuls des
    commentaires (le jeton du canal web) et le crochet ouvrant peuvent le
    devancer. Un `// title:` plus loin serait le texte d'une question. */
function titreEnCommentaire(json5: string): string | undefined {
	for (const ligne of json5.split("\n")) {
		const l = ligne.trim();
		if (!l || l === "[") continue;
		if (!l.startsWith("//")) return undefined;
		const m = l.match(/^\/\/\s*title\s*:\s*(.+?)\s*$/i);
		if (m) return nettoyerTitre(m[1]);
	}
	return undefined;
}

/** Un titre bon pour un nom de fichier : guillemets d'enrobage retirés,
    caractères interdits par Windows remplacés, point final ôté, borné à 80
    caractères sur un mot entier ; `undefined` s'il n'en reste rien. */
export function nettoyerTitre(brut: string): string | undefined {
	let titre = brut.trim().replace(/^["'«“]+|["'»”]+$/g, "").trim();
	/* « Python : E/S » → « Python - E S » : les deux-points, fréquents dans
	   un titre, deviennent un tiret ; les autres caractères interdits, une
	   espace. */
	titre = titre.replace(/\s*:\s*/g, " - ").replace(/[<>"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
	if (titre.length > 80) {
		const coupe = titre.slice(0, 80);
		const espace = coupe.lastIndexOf(" ");
		titre = (espace > 40 ? coupe.slice(0, espace) : coupe).replace(/[\s:,;–-]+$/, "");
	}
	return titre || undefined;
}

/** Lit une réponse copiée depuis un CLI, Ollama ou un site : fence markdown,
 * prose autour, LaTeX à backslash simple réparé, et distingue « pas un
 * quiz » (erreur nommée) de « quiz mal formé » (erreur du parseur, avec
 * position). Renommée `parseQuizResponse` → `parseReponseQuiz` et sortie de
 * la closure de `createAiClient` le 2026-09-18 : la page « Générer » la lit
 * aussi pour le canal web. */
export function parseReponseQuiz(content: string): ReponseQuiz {
	const sansQuiz = content.trim().match(new RegExp("^" + NO_QUIZ_MARKER + "[ \\t]*(?:\\r?\\n|$)"));
	if (sansQuiz) throw new NoQuizAnswer(content.trim().slice(sansQuiz[0].length).trim());
	let cleaned = retirerFence(content);
	cleaned = repairLatexBackslashes(cleaned);

	let parsed: unknown;
	let lu = false;
	try {
		parsed = JSON5.parse(cleaned);
		lu = true;
	} catch (err) {
		/* UNE VIRGULE OUBLIÉE entre deux champs ne doit pas coûter une
		   génération : Gemini 3.5 Flash-Lite a rendu un quiz entier, juste,
		   avec deux `"explain": "…"` suivis à la ligne d'un `"hint"` sans
		   virgule (2026-09-24) — « invalid character '"' at 67:5 », et tout
		   était à refaire. Seconde lecture après réparation ; si elle échoue
		   aussi, l'erreur rapportée reste celle de la réponse d'ORIGINE. */
		const repare = reparerVirgulesManquantes(cleaned);
		if (repare !== cleaned) {
			try { parsed = JSON5.parse(repare); lu = true; } catch { /* l'erreur d'origine suit */ }
		}
		if (lu && Array.isArray(parsed)) return { questions: sansFauxTitres(parsed), titre: titreEnCommentaire(cleaned) };
		/* Un quiz MAL FORMÉ garde l'erreur du parseur : elle situe le défaut
		   (ligne, colonne), ce qu'aucune paraphrase ne ferait mieux. Une
		   réponse qui n'est pas un quiz du tout, elle, mérite qu'on dise ce
		   qu'elle est — sinon l'utilisateur reçoit « invalid character '\'
		   at 1:2 » pour une phrase en français (vécu le 2026-07-30). Le
		   discriminant est la présence de champs de question, pas le premier
		   caractère : de la prose peut commencer par « [ » (lien markdown,
		   ponctuation échappée). */
		const looksLikeQuiz = /["']?(prompt|title|options|correctIndex|answer)["']?\s*:/.test(cleaned);
		if (looksLikeQuiz) throw err;
		throw nonQuizResponseError(content);
	}

	if (!Array.isArray(parsed)) {
		throw new Error(t("ai.err.notAnArray"));
	}

	return { questions: sansFauxTitres(parsed), titre: titreEnCommentaire(cleaned) };
}

/** The name of a document for matching a quiz's tag: case, accents and the
    spaces around it do not count (a model rewrites a tag slightly), but two
    DIFFERENT names never collapse into one. */
function cleDocument(nom: string): string {
	return nom.normalize("NFC").trim().toLowerCase();
}

/** Reads the answer of a ONE-PASS generation over `documents` (2026-10-01):
    a JSON5 array of `{ document, title?, quiz: [...] }`, one element per
    document. Returns one entry per document, IN THE DOCUMENTS' ORDER whatever
    the order of the answer. Anything else is an ERROR, never a partial result
    and never a guessed mapping: a wrong number of quizzes, a tag matching no
    document (or the same document twice), a quiz with no question, or an
    answer that is not this shape — saving fewer quizzes than documents, or a
    quiz under the wrong document, would be silent. */
export function parseReponseLot(content: string, documents: readonly string[]): ReponseDocument[] {
	const lu = parseReponseQuiz(content).questions;
	const elements = lu.map(el => {
		const o = el && typeof el === "object" && !Array.isArray(el) ? el as { document?: unknown; title?: unknown; quiz?: unknown } : null;
		if (!o || typeof o.document !== "string" || !Array.isArray(o.quiz)) throw new Error(t("ai.err.lotShape"));
		return { document: o.document, titre: typeof o.title === "string" ? nettoyerTitre(o.title) : undefined, questions: sansFauxTitres(o.quiz) };
	});
	if (elements.length !== documents.length) throw new Error(t("ai.err.lotCount", { expected: documents.length, got: elements.length }));
	const parCle = new Map<string, ReponseDocument>();
	for (const el of elements) {
		const cle = cleDocument(el.document);
		if (!documents.some(d => cleDocument(d) === cle)) throw new Error(t("ai.err.lotUnknown", { name: el.document.trim() }));
		if (parCle.has(cle)) throw new Error(t("ai.err.lotDuplicate", { name: el.document.trim() }));
		if (el.questions.length === 0) throw new Error(t("ai.err.lotEmpty", { name: el.document.trim() }));
		parCle.set(cle, el);
	}
	return documents.map(d => ({ ...(parCle.get(cleDocument(d)) as ReponseDocument), document: d }));
}

/** Ajoute la virgule qu'un modèle a oubliée en fin de ligne, entre une
    valeur qui se termine (chaîne, nombre, littéral, `]`, `}`) et une ligne
    qui commence un nouvel élément ou un nouveau champ. Une ligne de
    commentaire n'est jamais touchée. Ne sert qu'en SECONDE lecture, après
    l'échec de la première : une réponse valide ne passe jamais ici. */
export function reparerVirgulesManquantes(source: string): string {
	const lignes = source.split("\n");
	const finDeValeur = /(["'\d\]}]|\btrue|\bfalse|\bnull)\s*$/;
	const debutDElement = /^\s*(["'{[\d-]|[A-Za-z_$][\w$]*\s*:)/;
	for (let i = 0; i < lignes.length - 1; i++) {
		const cur = lignes[i];
		if (/^\s*\/\//.test(cur) || !finDeValeur.test(cur)) continue;
		let j = i + 1;
		while (j < lignes.length && !lignes[j].trim()) j++;
		if (j < lignes.length && debutDElement.test(lignes[j])) lignes[i] = cur.replace(/\s*$/, ",");
	}
	return lignes.join("\n");
}

/** Retire les faux titres de section qu'un modèle glisse entre les
    questions, `{ "// title": "Partie 2" }` : un objet dont TOUTES les clés
    sont des commentaires n'est pas une question, et deviendrait une carte
    vide dans le quiz (vu avec Gemini 3.5 Flash-Lite le 2026-09-24). */
function sansFauxTitres(items: unknown[]): unknown[] {
	return items.filter(it => {
		if (!it || typeof it !== "object" || Array.isArray(it)) return true;
		const cles = Object.keys(it);
		return cles.length === 0 || !cles.every(k => k.trim().startsWith("//"));
	});
}

/* Le modèle a répondu autre chose qu'un quiz : nommer QUOI, et surtout
   pourquoi, quand la cause est structurelle.
   Cas vécu (2026-07-30) : une demande qui suppose l'accès aux fichiers
   (« lis ce PDF », « d'après cette note ») — le CLI est lancé SANS aucun
   outil, le modèle tente quand même un appel, et sa tentative ressort
   sérialisée en texte. Rien n'est réparable côté parseur : ce qu'il faut
   dire, c'est que le générateur ne voit que le composer, et que les sources
   se JOIGNENT (le plugin sait lire notes, .md, .txt et PDF). */
function nonQuizResponseError(content: string): Error {
	const text = content.trim();
	/* SEULE la tentative d'outil sérialisée dans la RÉPONSE prouve le mur
	   de l'accès fichiers. La seconde signature d'origine — « la DEMANDE
	   cite des chemins » — a été retirée le 2026-07-31 : depuis que
	   prompt-paths.ts joint automatiquement les chemins cités, un chemin
	   dans la demande n'implique plus rien, et cette heuristique
	   REBAPTISAIT en « pas d'accès aux fichiers » tout échec de parsing
	   (sources pourtant jointes, chips à l'écran), en masquant la seule
	   chose utile au diagnostic : ce que le modèle a réellement répondu.
	   Faute de preuve, on montre donc la réponse. */
	if (/application\/vnd\.ant\.toolu|\btool_use\b/i.test(text)) {
		return new Error(t("ai.err.noFileAccess"));
	}
	console.warn("[quiz-blocks] réponse non-quiz (" + text.length + " car.) :", text.slice(0, 2000));
	return new Error(t("ai.err.notQuiz", { preview: text.replace(/\s+/g, " ").slice(0, 160) }));
}

export function createAiClient(settings: AiSettingsHost): AiClient {
	// ── Annulation (bouton stop / Esc) ──
	// Chaque appel CLI/HTTP enregistre sa fonction d'arrêt ici ; abort()
	// l'invoque. L'erreur qui en résulte (process tué, fetch avorté) est
	// traduite en erreur marquée `aborted` que l'UI traite comme un retour
	// à l'état initial, pas comme une erreur.
	let abortCurrent: (() => void) | null = null;
	let aborted = false;
	/** Where the running generation's transcript goes (`GenerateOptions`). */
	let transcriptSink: ((event: TranscriptEvent) => void) | null = null;
	/** The resume key of the running generation or plan, and how many CLI
	    calls it has made: call N is resumed under `<key>-N`. The order of
	    calls depends only on the request and the answers, so the replay of
	    a line after a reload asks the same keys in the same order. */
	let repriseBase: string | null = null;
	let appelsCli = 0;

	/* ── Compteurs de la génération en cours ──
	   Chaque `callX` dépose ici ce que SON fournisseur a publié ; generate()
	   complète avec ce qu'il est seul à savoir (fournisseur, modèle, durée) et
	   scelle le tout dans `lastUsage`. Ce qu'un fournisseur ne publie pas reste
	   à 0 / null — jamais estimé (cf. ai-usage.ts). */
	let pendingUsage: Partial<AiUsage> | null = null;
	let lastUsage: AiUsage | null = null;

	/* Demande en cours, retenue POUR LE SEUL diagnostic d'un échec de parsing
	   (cf. nonQuizResponseError) : le parseur ne voit que la réponse, or la
	   cause d'une réponse hors-sujet se lit souvent dans la question. */
	let lastRequestText = "";

	/* Lecture par FONCTION, jamais directement : `pendingUsage` est rempli
	   depuis une closure appelée derrière un `await`, ce que l'analyse de flux
	   de TypeScript ne voit pas — un `if (pendingUsage)` posé après l'await
	   narrowerait la variable à `never` sur la foi du `= null` initial. */
	const takePendingUsage = (): Partial<AiUsage> | null => pendingUsage;

	/**
	 * Un appel de CLI, annulable. Le `signal` part à l'hôte, qui tue l'ARBRE de
	 * process (`claude` et `codex` en spawnent) — c'est l'ancien `killTree` de ce
	 * module, déménagé là où vit `child_process`.
	 */
	function runCli(spec: {
		/* Les CLI que la génération lance. `ollama` n'y est pas : il est
		   interrogé par le réseau, pas par un processus. */
		tool: "claude" | "codex" | "agy";
		marqueur: string;
		args: string[];
		stdin: string;
		fichiers?: Array<{ nom: string; base64: string }>;
		sortieFichier?: string;
	}): Promise<SortieCli> {
		const ac = new AbortController();
		abortCurrent = () => { aborted = true; try { ac.abort(); } catch (e) { /* déjà avorté */ } };
		/* The live transcript: the output decoded line by line as it arrives,
		   for the two CLIs that stream a format we read. */
		const sink = transcriptSink;
		const decode = sink && (spec.tool === "claude" || spec.tool === "codex") ? createTranscriptDecoder(spec.tool) : null;
		return requireHost("process").run({
			onStdout: decode && sink ? (chunk) => { for (const ev of decode(chunk)) sink(ev); } : undefined,
			tool: spec.tool,
			args: spec.args,
			stdin: spec.stdin,
			signal: ac.signal,
			marqueur: spec.marqueur,
			fichiers: spec.fichiers,
			sortieFichier: spec.sortieFichier,
			reprise: repriseBase ? `${repriseBase}-${appelsCli++}` : undefined,
		});
	}

	/** Les images de la génération, en pièces jointes de l'appel : l'hôte les
	    écrit et remplace le jeton de chacune par son chemin. L'extension suit le
	    type MIME — le CLI la lit pour décider comment décoder l'image. */
	function piecesJointes(images: ImagePayload[]): Array<{ nom: string; base64: string }> {
		return images.map((img, i) => {
			const ext = ((img.mediaType || "image/png").split("/")[1] || "png").replace("jpeg", "jpg");
			return { nom: "image-" + (i + 1) + "." + ext, base64: img.base64 };
		});
	}

	async function generate(prompt: string, options: GenerateOptions = {}): Promise<ReponseQuiz> {
		aborted = false;
		transcriptSink = options.onTranscript ?? null;
		repriseBase = options.reprise ?? null;
		appelsCli = 0;
		pendingUsage = null;
		lastUsage = null;
		/* L'INSTANTANÉ des fichiers de CLI, relu AVANT l'appel : `resolveCodexModel`
		   et `getCodexModels` (plus bas) sont synchrones et lisent un instantané de
		   module que seul `refreshCliCaches` remplit. Sans cette ligne, une
		   génération lancée avant tout affichage de liste choisirait son modèle
		   dans le repli embarqué — et un modèle du repli retiré du compte donne un
		   404 au CLI. Ne rejette jamais. */
		await refreshCliCaches();
		const startedAt = Date.now();
		try {
			const reponse = await generateInner(prompt, options);
			const u = takePendingUsage();
			if (u) {
				lastUsage = {
					provider: u.provider || settings.get().aiProvider || "",
					model: u.model || settings.get().aiModel || "",
					inputTokens: u.inputTokens || 0,
					outputTokens: u.outputTokens || 0,
					cachedInputTokens: u.cachedInputTokens || 0,
					costUsd: u.costUsd ?? null,
					durationMs: Date.now() - startedAt,
					sessionId: u.sessionId
				};
			}
			return reponse;
		} catch (err) {
			if (aborted) {
				const e = new Error("Génération annulée") as Error & { aborted?: boolean };
				e.aborted = true;
				throw e;
			}
			throw err;
		} finally {
			abortCurrent = null;
			transcriptSink = null;
			repriseBase = null;
		}
	}

	async function generateInner(prompt: string, options: GenerateOptions = {}): Promise<ReponseQuiz> {
		const { images = [] } = options;
		lastRequestText = prompt;
		const provider = settings.get().aiProvider || "claude-code";
		// Le défaut vient du registry, JAMAIS d'une copie locale : une seconde
		// table avait divergé (« sonnet » ici, « opus » dans PROVIDERS), donc le
		// composer annonçait un modèle et la génération en lançait un autre.
		let model = settings.get().aiModel || getProvider(provider).defaultModel;
		// Fable 5 masqué si la promo n'est plus proposée → retombe sur le défaut Claude
		if (provider === "claude-code") {
			model = resolveClaudeModel(model);
		}
		// Codex : si le modèle persisté n'est pas dans la liste réelle du
		// compte (~/.codex/models_cache.json — ex. bascule récente de
		// provider, slug retiré), retombe sur le défaut Codex.
		if (provider === "codex") {
			model = resolveCodexModel(model);
		}
		// Antigravity : la valeur persistée si `agy models` la connaît, sinon le
		// premier de la liste, sinon rien — et `--model` est omis.
		if (provider === "antigravity-cli") {
			model = resolveAntigravityModel(model);
		}

		const { systemPrompt, userPrompt } = composerPrompts(prompt, options);
		/* ONE PASS (2026-10-01): with two documents or more the answer is one
		   quiz per document, read by `parseReponseLot` (a wrong count is an
		   error, never fewer quizzes). Ollama never gets `documents`: its
		   structured answer holds a single quiz (`lectureEnUnePasse`). */
		const documents = options.documents;
		const lire: LireReponse = documents && documents.length >= 2
			? (texte) => ({ questions: [], lot: parseReponseLot(texte, documents) })
			: parseReponseQuiz;

		if (provider === "ollama") {
			/* Le composer persiste le choix par défaut ; si la génération part
			   avant (réglage vide), le premier de la sélection sert de repli —
			   jamais une chaîne vide au serveur. */
			if (!model) model = resolveOllamaSelection(settings.get().aiOllamaModels, settings.get().aiOllamaCatalog)[0]?.value || "";
			// Un seul endpoint local : sert les modèles locaux ET cloud (:cloud).
			// Clé optionnelle (le daemon connecté via `ollama signin` n'en a pas
			// besoin) ; envoyée en Authorization si l'utilisateur en a défini une.
			const ollamaUrl = (settings.get().aiOllamaUrl || "http://localhost:11434").replace(/\/+$/, "");
			const key = (settings.get().aiOllamaCloudKey || "").trim();
			const authHeader: Record<string, string> = key ? { "Authorization": "Bearer " + key } : {};
			// Effort réel : niveau `think` (low/medium/high/max) passé à l'API
			// pour les modèles à raisonnement (ignoré sinon, cf. callOllama).
			const effort = resolveEffort("ollama", settings.get().aiEffort);
			return callOllama(model, systemPrompt, userPrompt, ollamaUrl, authHeader, images, effort);
		} else if (provider === "codex") {
			// Effort clampé aux niveaux supportés par CE modèle (ex. ultra
			// persisté + gpt-5.5 → xhigh), sinon le CLI rejetterait la valeur.
			const effort = resolveEffort("codex", settings.get().aiEffort, model);
			// Mode Fast (éclair du popover effort) : service tier « priority »,
			// seulement si CE modèle l'expose (cf. models_cache service_tiers).
			const m = getCodexModels().find(x => x.value === model);
			const fast = !!settings.get().aiCodexFast && !!(m && m.fast);
			return callCodex(model, systemPrompt, userPrompt, images, effort, fast, lire);
		} else if (provider === "antigravity-cli") {
			/* `model` est la FAMILLE (« gemini-3.8-flash ») ; le CLI attend la
			   variante au niveau retenu pour ELLE (« gemini-3.8-flash-high »). */
			const effort = niveauAntigravity(settings.get().aiAntigravityLevels, model);
			return callAntigravity(antigravityModelId(model, effort), systemPrompt, userPrompt, images, lire);
		} else {
			return callClaudeCode(model, systemPrompt, userPrompt, images, lire);
		}
	}

	/* ── Gemini via Antigravity CLI (`agy`, compte Google) ──
	   Le remplaçant de Gemini CLI, que Google a fermé aux comptes individuels
	   en juin 2026 (`IneligibleTierError: UNSUPPORTED_CLIENT`, vécu le
	   2026-09-20 après un jeton OAuth pourtant accepté). Aucune clé API : le
	   CLI est connecté au compte Google de l'utilisateur, identifiants dans le
	   gestionnaire d'identifiants Windows.

	   LE PROMPT PART PAR STDIN, EN `stream-json` : en mode texte, `-p` veut
	   le prompt EN ARGUMENT (« --print took "--output-format" as its prompt »,
	   mesuré) et n'accepte rien de stdin — or un cours inliné dépasse la
	   ligne de commande de Windows. `--input-format stream-json` lit sur stdin
	   un événement `user` par ligne, de la taille qu'on veut (41 Ko éprouvés,
	   fin du texte relue), et `--output-format stream-json` rend un flux
	   NDJSON dont le dernier événement, `result`, porte `status`, `response`
	   et `error` — la même enveloppe que `--output-format json`. Doc :
	   antigravity.google/docs/cli/headless, lue le 2026-09-20.

	   LES OUTILS. Antigravity est un AGENT : il a des outils, là où Claude
	   Code reçoit `--tools ""` et Codex `-s read-only`. En headless, son mode
	   de permission est `request-review` : les outils qui écrivent, exécutent
	   ou naviguent demandent une confirmation qui ne peut pas être donnée,
	   et ne tournent donc pas. Ce qui tient pour le reste, c'est le PROMPT :
	   il interdit les outils en toutes lettres et INLINE toutes les sources
	   (paragraphe « NO TOOLS » de `composerPrompts`). Même décision que pour
	   Gemini CLI (Ahmed, 2026-09-20), en connaissance de cause.

	   LE MODÈLE vient de `agy models` (voir `ai-providers.ts`), jamais d'ici ;
	   sans modèle connu, `--model` est omis et le CLI prend le sien. Le
	   niveau de raisonnement est DANS le nom du modèle (`…-high`, `…-low`),
	   donc pas d'effort à passer. */
	async function callAntigravity(model: string, systemPrompt: string, userPrompt: string, images: ImagePayload[] = [], lire: LireReponse = parseReponseQuiz): Promise<ReponseQuiz> {
		return lire(await callAntigravityTexte(model, systemPrompt, userPrompt, images));
	}

	/** The call itself, returning the model's TEXT: a quiz for `generate`, a
	    prose answer for `chat`. */
	async function callAntigravityTexte(model: string, systemPrompt: string, userPrompt: string, images: ImagePayload[] = []): Promise<string> {
		if (!currentHost().platform.isDesktopApp) {
			throw new Error(t("ai.hint.antigravityDesktopOnly"));
		}
		if (model && !/^[a-zA-Z0-9._:-]+$/.test(model)) {
			throw new Error(t("ai.err.invalidModelAntigravity", { model }));
		}
		/* UNE IMAGE NE PEUT PAS PARTIR PAR CE CANAL, et c'est dit plutôt que
		   perdu : Claude Code lit les images jointes avec son outil `Read` ;
		   ici aucun outil n'est donné, et l'entrée `stream-json` n'accepte que
		   des blocs de texte (« text is the only supported block type », doc).
		   Même patron que le PDF refusé par l'application sur le canal web. */
		if (images.length > 0) {
			throw new Error(t("ai.err.antigravityNoImages"));
		}

		const marqueur = nouveauMarqueur();
		const fullPrompt = systemPrompt + "\n\n" + userPrompt;
		/* UNE ligne : le CLI lit un événement par ligne, et `JSON.stringify`
		   échappe les sauts de ligne du prompt. */
		const entree = JSON.stringify({ event: "user", message: { content: fullPrompt } }) + "\n";

		/** La cartographie des messages, au patron d'`erreurClaude` et
		    d'`erreurCodex`. Les mots cherchés sont ceux du CLI : « Authentication
		    required » sans compte, « quota » quand le forfait est épuisé. */
		const erreurAntigravity = (e: ExecError): Error => {
			console.error("[quiz-blocks] Antigravity CLI error:", e.message, e.stderr || "");
			const detail = ((e.stderr || "") + " " + (e.stdout || "") + " " + e.message).toLowerCase();
			if (e.code === "ENOENT" || e.code === 127 || detail.includes("not recognized") || detail.includes("introuvable") || detail.includes("command not found")) {
				return new Error(t("ai.err.antigravityNotInstalled"));
			}
			if (detail.includes("authentication required") || detail.includes("authentication failed") || detail.includes("sign in") || detail.includes("unauthorized") || detail.includes("401")) {
				/* Le bouton « Se connecter » de la carte d'erreur, comme pour
				   Claude et Codex : la sonde est `agy models`
				   (`checkAntigravityLogin`), la connexion le terminal
				   (`commandeConnexion`, `process.ts`). */
				return erreurConnexion("agy", t("ai.err.antigravityNotLoggedIn"));
			}
			if (detail.includes("quota") || detail.includes("rate limit") || detail.includes("resource_exhausted") || detail.includes("429")) {
				return new Error(t("ai.err.antigravityRateLimit"));
			}
			return new Error(t("ai.err.antigravity", { detail: (e.stderr || e.message).trim().slice(0, 300) }));
		};

		let res: SortieCli;
		try {
			res = await runCli({
				tool: "agy",
				args: ["--input-format", "stream-json", "--output-format", "stream-json", ...(model ? ["--model", model] : [])],
				marqueur,
				stdin: entree,
				fichiers: [],
			});
		} catch (err) {
			/* Une ANNULATION n'est pas une erreur (voir `callClaudeCode`). */
			if (aborted) throw err;
			throw erreurIndisponible(err) || erreurAntigravity(execErrorDepuisRejet(err));
		}
		if (res.code !== 0) throw erreurAntigravity(execErrorDepuisCode(res));

		const resultat = lireResultatAntigravity(res.stdout);
		if (resultat.erreur) throw erreurAntigravity({ message: resultat.erreur, stdout: res.stdout, stderr: res.stderr } as ExecError);
		const raw = resultat.reponse;
		if (!raw.trim()) {
			throw new Error(t("ai.err.antigravityEmpty"));
		}
		console.log("[quiz-blocks] Antigravity success - response length:", raw.length);
		return raw;
	}

	/** Le flux `stream-json` d'Antigravity : une ligne = un événement, et c'est
	    l'événement `result` qui porte la réponse. Les `text_delta` des
	    `agent_response` ne sont PAS reconstitués : `result.response` est déjà
	    le texte entier, et le reconstituer ferait deux sources pour une
	    valeur. Un `status` autre que `SUCCESS` est rendu comme erreur, avec
	    son message. */
	function lireResultatAntigravity(stdout: string): { reponse: string; erreur: string | null } {
		let reponse = "";
		let erreur: string | null = null;
		for (const line of String(stdout || "").split("\n")) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("{")) continue;
			let evt: { event?: string; result?: { status?: string; response?: string; error?: string } };
			try { evt = JSON.parse(trimmed); } catch (e) { continue; }
			if (evt.event !== "result" || !evt.result) continue;
			if (evt.result.status !== "SUCCESS") erreur = evt.result.error || ("status " + String(evt.result.status));
			reponse = typeof evt.result.response === "string" ? evt.result.response : "";
		}
		return { reponse, erreur };
	}

	/* ── Claude via le CLI Claude Code (compte par abonnement) ──
	   Aucune clé API : réutilise la session du CLI connecté au
	   compte Pro/Max/Team/Enterprise. Prompt complet par stdin
	   (aucun échappement d'argument), sortie --output-format json. */
	async function callClaudeCode(model: string, systemPrompt: string, userPrompt: string, images: ImagePayload[] = [], lire: LireReponse = parseReponseQuiz): Promise<ReponseQuiz> {
		return lire(await callClaudeCodeTexte(model, systemPrompt, userPrompt, images));
	}

	/** The effort chosen in the composer, as `claude --effort` reads it. It
	    was never passed before 2026-10-08 (the CLI had no such flag when the
	    picker was added): every run took the CLI's default, and a "medium"
	    chosen in the app still thought at the CLI's level. */
	const effortClaude = (): string | null => claudeEffortArg(resolveEffort("claude-code", settings.get().aiEffort));

	/** The call itself, returning the model's TEXT: a quiz for `generate`, a
	    prose answer for `chat` (2026-09-29). `effort`: the level passed to the
	    CLI, the composer's by default. */
	async function callClaudeCodeTexte(model: string, systemPrompt: string, userPrompt: string, images: ImagePayload[] = [], effort: string | null = effortClaude(), imageInstruction = "First read these images with the Read tool, then base the quiz on their content:"): Promise<string> {
		if (!currentHost().platform.isDesktopApp) {
			throw new Error(t("ai.hint.claudeDesktopOnly"));
		}
		if (!/^[a-zA-Z0-9._:-]+$/.test(model)) {
			throw new Error(t("ai.err.invalidModelClaude", { model }));
		}

		/* Images : l'HÔTE les écrit en fichiers temporaires (et les efface), et
		   remplace le jeton de la N-ième par son chemin absolu — ici dans le
		   PROMPT, que Claude lit ensuite avec le tool Read (multimodal,
		   read-only). Le MARQUEUR est tiré au sort pour CET appel : le prompt
		   contient la demande de l'utilisateur et le contenu de ses notes, et une
		   forme fixe y aurait collisionné (voir `src/host/jetons.ts`).
		   `--tools` reçoit la liste des outils autorisés, et une chaîne VIDE
		   quand il n'y a pas d'image : c'est un argument réellement vide, pas
		   les deux caractères `""` — sous `cp.exec`, le shell retirait les
		   guillemets de `--tools ""`, et le CLI refuse la paire littérale
		   (mesuré : « Invalid setting source: "" »). */
		const marqueur = nouveauMarqueur();
		const fichiers = piecesJointes(images);
		const tools = fichiers.length > 0 ? "Read" : "";
		// Instruction au MODÈLE (pas de l'UI) → anglais, comme le prompt
		// système ; la langue du quiz reste celle de la demande.
		const imageNote = fichiers.length > 0
			? "\n\n" + imageInstruction + "\n" +
				fichiers.map((_, i) => "- " + jetonFichier(marqueur, i + 1)).join("\n")
			: "";

		const fullPrompt = systemPrompt + "\n\n" + userPrompt + imageNote;

		/** La cartographie des messages, INCHANGÉE — chaque clé était déjà là.
		    Elle est sortie du `catch` parce qu'un échec arrive désormais par DEUX
		    chemins : un rejet nommé de `run`, et un code de sortie non nul que
		    `run` RÉSOUT au lieu de rejeter. Les deux sont ramenés à l'`ExecError`
		    qu'elle a toujours lue. */
		const erreurClaude = (e: ExecError): Error => {
			console.error("[quiz-blocks] Claude Code error:", e.message, e.stderr || "");
			const detail = ((e.stderr || "") + " " + (e.stdout || "") + " " + e.message).toLowerCase();
			if (e.code === "ENOENT" || e.code === 127 || detail.includes("not recognized") || detail.includes("introuvable") || detail.includes("command not found")) {
				return new Error(t("ai.err.claudeNotInstalled"));
			}
			if (detail.includes("login") || detail.includes("api key") || detail.includes("authentication") || detail.includes("credential")) {
				return erreurConnexion("claude", t("ai.err.claudeNotLoggedIn"));
			}
			return new Error(t("ai.err.claudeCode", { detail: (e.stderr || e.message).trim().slice(0, 300) }));
		};

		let res: SortieCli;
		try {
			res = await runCli({
				tool: "claude",
				/* A STREAM (2026-09-29): the text arrives as it is written, for
				   the live transcript; the last line, `result`, is the object
				   `--output-format json` used to print (`claudeResultDuFlux`). */
				args: [
					"-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", model,
					...(effort ? ["--effort", effort] : []),
					"--tools", tools, "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config",
				],
				marqueur,
				stdin: fullPrompt,
				fichiers,
			});
		} catch (err) {
			/* Une ANNULATION n'est pas une erreur. L'hôte tue l'arbre de process
			   et rejette `annule` — ce que la branche « killed » prendrait pour un
			   depassement de delai — et le journal se remplissait d'erreurs a
			   chaque clic sur Stop. `generate()` traduit ensuite ce rejet en
			   erreur `aborted`, que l'UI traite comme un retour a l'etat initial. */
			if (aborted) throw err;
			throw erreurIndisponible(err) || erreurClaude(execErrorDepuisRejet(err));
		}
		if (res.code !== 0) throw erreurClaude(execErrorDepuisCode(res));
		const stdout = res.stdout;

		/* `--output-format json` publie l'usage RÉEL de l'appel : tokens (dont
		   ceux servis par le cache) et coût en dollars — Claude Code est le seul
		   des quatre à chiffrer la requête. */
		interface ClaudeResult {
			is_error?: boolean;
			result?: string;
			session_id?: string;
			total_cost_usd?: number;
			usage?: {
				input_tokens?: number;
				output_tokens?: number;
				cache_read_input_tokens?: number;
				cache_creation_input_tokens?: number;
			};
		}
		const data = claudeResultDuFlux(stdout) as ClaudeResult | null;
		if (!data) throw new Error(t("ai.err.claudeUnreadable"));

		const u = data.usage;
		if (u) {
			// L'entrée facturée = tokens frais + écriture de cache + lecture de
			// cache : les trois traversent le modèle, les trois se paient.
			const cacheRead = u.cache_read_input_tokens || 0;
			pendingUsage = {
				provider: "claude-code",
				model,
				inputTokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + cacheRead,
				outputTokens: u.output_tokens || 0,
				cachedInputTokens: cacheRead,
				costUsd: typeof data.total_cost_usd === "number" ? data.total_cost_usd : null,
				sessionId: data.session_id
			};
		}

		if (data.is_error) {
			const msg = String(data.result || t("ai.err.unknown"));
			const msgLower = msg.toLowerCase();
			if (msgLower.includes("login") || msgLower.includes("api key") || msgLower.includes("credential")) {
				throw erreurConnexion("claude", t("ai.err.claudeNotLoggedIn"));
			}
			if (msgLower.includes("rate limit") || msgLower.includes("usage limit")) {
				throw new Error(t("ai.err.claudeRateLimit"));
			}
			throw new Error(t("ai.err.claude", { detail: msg.slice(0, 300) }));
		}

		const content = data.result || "";
		if (!content.trim()) {
			throw new Error(t("ai.err.claudeEmpty"));
		}

		console.log("[quiz-blocks] Claude Code success - response length:", content.length);
		return content;
	}

	/* ── ChatGPT via le CLI Codex (abonnement ChatGPT) ──
	   `codex exec` en non-interactif : prompt par stdin, modèle via -m,
	   effort de raisonnement via -c model_reasoning_effort=…, réponse finale
	   écrite dans un fichier (-o) pour un parsing propre. Sandbox read-only et
	   --ignore-user-config isolent la génération (pas de MCP/hooks perso). */
	async function callCodex(model: string, systemPrompt: string, userPrompt: string, images: ImagePayload[] = [], effort = "medium", fast = false, lire: LireReponse = parseReponseQuiz): Promise<ReponseQuiz> {
		return lire(await callCodexTexte(model, systemPrompt, userPrompt, images, effort, fast));
	}

	/** The call itself, returning the model's TEXT (see `callClaudeCodeTexte`). */
	async function callCodexTexte(model: string, systemPrompt: string, userPrompt: string, images: ImagePayload[] = [], effort = "medium", fast = false): Promise<string> {
		if (!currentHost().platform.isDesktopApp) {
			// Même libellé que le hint du composer (« Codex CLI » explicite).
			throw new Error(t("ai.hint.codexDesktopOnly"));
		}
		if (!/^[a-zA-Z0-9._:-]+$/.test(model)) {
			throw new Error(t("ai.err.invalidModelCodex", { model }));
		}
		const effortVal = /^[a-z]+$/.test(effort) ? effort : "medium";

		// Images : l'HÔTE les écrit dans son dossier temporaire et remplace le
		// jeton de chacune par son chemin ; elles sont attachées au prompt
		// initial par `-i`. Marqueur tiré au sort pour CET appel.
		const marqueur = nouveauMarqueur();
		const fichiers = piecesJointes(images);
		const fullPrompt = systemPrompt + "\n\n" + userPrompt;
		/* `--json` : stdout devient un flux d'events JSONL, seul endroit où le CLI
		   publie les tokens consommés (`turn.completed.usage`) et l'identifiant de
		   thread qui mène à ses quotas. La réponse finale, elle, continue d'être
		   lue dans le fichier `-o` — que l'hôte relit et rend dans `sortie`.
		   Le dossier personnel et le chemin du fichier de sortie sont du savoir
		   d'HÔTE — le rendu de l'application n'a ni l'un ni l'autre : ce sont des
		   jetons. */
		const args = [
			"exec", "--json", "-m", model,
			"-c", "model_reasoning_effort=" + effortVal,
			// Fast (1.5x speed, more usage) : service tier « priority » — la
			// valeur vient de models_cache.json (service_tiers[].id).
			...(fast ? ["-c", "service_tier=priority"] : []),
			"-s", "read-only", "--skip-git-repo-check", "--ignore-user-config",
			"-C", jetonHome(marqueur),
			"-o", jetonSortie(marqueur),
			...fichiers.flatMap((_, i) => ["-i", jetonFichier(marqueur, i + 1)]),
		];

		/** La cartographie des messages, INCHANGÉE (voir `erreurClaude`). */
		const erreurCodex = (e: ExecError): Error => {
			console.error("[quiz-blocks] Codex error:", e.message, e.stderr || "");
			const detail = ((e.stderr || "") + " " + (e.stdout || "") + " " + e.message).toLowerCase();
			if (e.code === "ENOENT" || e.code === 127 || detail.includes("not recognized") || detail.includes("introuvable") || detail.includes("command not found")) {
				return new Error(t("ai.err.codexNotInstalled"));
			}
			if (detail.includes("not logged in") || detail.includes("login") || detail.includes("unauthorized") || detail.includes("401") || detail.includes("credential") || detail.includes("authenticat")) {
				return erreurConnexion("codex", t("ai.err.codexNotLoggedIn"));
			}
			if (detail.includes("usage limit") || detail.includes("rate limit") || detail.includes("quota")) {
				return new Error(t("ai.err.codexRateLimit"));
			}
			return new Error(t("ai.err.codex", { detail: (e.stderr || e.message).trim().slice(0, 300) }));
		};

		let res: SortieCli;
		try {
			res = await runCli({ tool: "codex", marqueur, args, stdin: fullPrompt, fichiers, sortieFichier: CODEX_FICHIER_SORTIE });
		} catch (err) {
			/* Une ANNULATION n'est pas une erreur. L'hôte tue l'arbre de process
			   et rejette `annule` — ce que la branche « killed » prendrait pour un
			   depassement de delai — et le journal se remplissait d'erreurs a
			   chaque clic sur Stop. `generate()` traduit ensuite ce rejet en
			   erreur `aborted`, que l'UI traite comme un retour a l'etat initial. */
			if (aborted) throw err;
			throw erreurIndisponible(err) || erreurCodex(execErrorDepuisRejet(err));
		}
		if (res.code !== 0) throw erreurCodex(execErrorDepuisCode(res));

		readCodexEvents(res.stdout, model);
		// Le fichier -o contient la réponse finale nette ; à défaut (l'hôte rend
		// alors `undefined`), elle se reconstitue depuis les events (stdout est du
		// JSONL depuis --json, et le donner brut au parseur JSON5 serait illisible).
		const raw = res.sortie !== undefined ? res.sortie : extractCodexText(res.stdout);

		if (!raw || !raw.trim()) {
			throw new Error(t("ai.err.codexEmpty"));
		}
		console.log("[quiz-blocks] Codex success - response length:", raw.length);
		return raw;
	}

	/* Events `codex exec --json` : une ligne = un objet. Deux seulement nous
	   intéressent — `thread.started` (l'identifiant qui mène au fichier de
	   session, donc aux quotas du compte) et `turn.completed` (les tokens). */
	interface CodexTurnUsage {
		input_tokens?: number;
		cached_input_tokens?: number;
		output_tokens?: number;
		reasoning_output_tokens?: number;
	}

	function readCodexEvents(stdout: string, model: string): void {
		let threadId = "";
		let usage: CodexTurnUsage | null = null;

		for (const line of String(stdout || "").split("\n")) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("{")) continue;
			let evt: { type?: string; thread_id?: string; usage?: CodexTurnUsage };
			try { evt = JSON.parse(trimmed); } catch (e) { continue; }
			if (evt.type === "thread.started" && typeof evt.thread_id === "string") threadId = evt.thread_id;
			if (evt.type === "turn.completed" && evt.usage) usage = evt.usage;
		}
		if (!usage) return;

		pendingUsage = {
			provider: "codex",
			model,
			// `input_tokens` inclut déjà les tokens servis par le cache.
			inputTokens: usage.input_tokens || 0,
			// Le raisonnement est facturé en sortie : l'omettre sous-estimerait
			// d'autant un modèle à effort élevé.
			outputTokens: (usage.output_tokens || 0) + (usage.reasoning_output_tokens || 0),
			cachedInputTokens: usage.cached_input_tokens || 0,
			// Abonnement ChatGPT : aucun prix par requête n'est publié.
			costUsd: null,
			sessionId: threadId
		};
	}

	/** Réponse finale reconstituée depuis les events (secours si le fichier -o manque). */
	function extractCodexText(stdout: string): string {
		const parts: string[] = [];
		for (const line of String(stdout || "").split("\n")) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("{")) continue;
			try {
				const evt = JSON.parse(trimmed) as { type?: string; item?: { type?: string; text?: unknown } };
				if (evt.type !== "item.completed" || evt.item?.type !== "agent_message") continue;
				if (typeof evt.item.text === "string") parts.push(evt.item.text);
			} catch (e) { /* ligne non-JSON → ignorée */ }
		}
		return parts.join("\n");
	}

	async function callOllama(model: string, systemPrompt: string, userPrompt: string, ollamaUrl?: string, authHeaders?: Record<string, string>, images: ImagePayload[] = [], effort: string | null = null): Promise<ReponseQuiz> {
		return parseOllamaResponse(await callOllamaTexte(model, systemPrompt, userPrompt, ollamaUrl, authHeaders, images, effort, true));
	}

	/** The call itself, returning the model's TEXT. `quizSchema` constrains the
	    answer to the quiz JSON schema (generation); `chat` passes false and gets
	    free prose. */
	async function callOllamaTexte(model: string, systemPrompt: string, userPrompt: string, ollamaUrl?: string, authHeaders?: Record<string, string>, images: ImagePayload[] = [], effort: string | null = null, quizSchema = false): Promise<string> {
		if (!ollamaUrl) {
			ollamaUrl = (settings.get().aiOllamaUrl || "http://localhost:11434").replace(/\/+$/, "");
		}
		authHeaders = authHeaders || {};

		// Annulation : un AbortController couvre les fetch de ce call.
		const ac = new AbortController();
		abortCurrent = () => { aborted = true; try { ac.abort(); } catch (e) { /* déjà avorté */ } };

		// ── Step 1 : serveur joignable ? Un modèle cloud (:cloud) tourne à la
		// demande via le daemon connecté (absent de /api/tags) → on ne vérifie
		// PAS qu'il est installé ; un modèle local, si. ──
		const isCloud = isOllamaCloudModel(model);
		let installedModels: string[] = [];
		let tagModels: Array<{ name: string; capabilities?: string[] }> = [];
		try {
			const tagsResp = await courseAbandon(requireHost("net").fetchJson({
				url: `${ollamaUrl}/api/tags`, method: "GET", headers: authHeaders, signal: ac.signal,
			}), ac.signal);
			// `null` = échec RÉSEAU (cf. le contrat) ; un statut d'erreur, lui,
			// arrive avec son corps. Les deux valent ici « serveur injoignable ».
			if (!tagsResp || tagsResp.status < 200 || tagsResp.status >= 300) {
				throw new Error("ollama_unreachable");
			}
			const tagsData = JSON.parse(tagsResp.body) as { models?: Array<{ name: string; capabilities?: string[] }> };
			tagModels = tagsData?.models || [];
			installedModels = tagModels.map(m => m.name);
			console.log("[quiz-blocks] Ollama installed models:", installedModels.join(", "));

			if (!isCloud) {
				// Check if model is installed — Ollama model names may include :latest
				const modelBase = model.replace(/:latest$/, "");
				const isInstalled = installedModels.some(m => {
					const mBase = m.replace(/:latest$/, "");
					return mBase === modelBase || mBase.startsWith(modelBase + ":");
				});

				if (!isInstalled) {
					throw userError(t("ai.err.ollamaModelMissing", {
						model,
						models: installedModels.length > 0 ? installedModels.join(", ") : t("ai.err.none")
					}));
				}
			}
		} catch (err) {
			// Seule l'erreur « modèle absent » ci-dessus est déjà formulée pour
			// l'utilisateur ; tout le reste (sentinelle ollama_unreachable, JSON
			// illisible, réseau) devient le diagnostic serveur.
			const e = err as UserFacingError;
			if (e.userFacing) throw err;
			throw userError(t("ai.err.ollamaUnreachable", { url: ollamaUrl }));
		}

		// Le modèle expose-t-il un raisonnement (`think`) ? Cloud → oui (le param
		// est ignoré sans erreur si le modèle ne raisonne pas, vérifié) ; local →
		// capability « thinking » lue de /api/tags. Statut prix jamais figé ici.
		let supportsThinking: boolean;
		if (isCloud) {
			supportsThinking = true;
		} else {
			const norm = model.replace(/:latest$/, "");
			const found = tagModels.find(m => {
				const mb = m.name.replace(/:latest$/, "");
				return mb === norm || mb.startsWith(norm + ":");
			});
			supportsThinking = !!(found && (found.capabilities || []).includes("thinking"));
		}
		const thinkLevel = (supportsThinking && effort) ? effort : null;
		if (thinkLevel) console.log("[quiz-blocks] Ollama think level:", thinkLevel);

		// ── Step 2: Call /api/chat for better instruction following ──
		// Use fetch() to read error response bodies (requestUrl hides them)
		// Build user message with images for multimodal support
		const userMessage = {
			role: "user",
			content: userPrompt,
			...(images.length > 0 ? { images: images.map(img => img.base64) } : {})
		};

		let data: {
			error?: unknown;
			message?: { content?: string };
			/* Compteurs Ollama : tokens du prompt évalués et tokens générés.
			   Aucun coût — le modèle tourne en local (ou sur le forfait cloud,
			   qui ne chiffre pas la requête). */
			prompt_eval_count?: number;
			eval_count?: number;
		};
		try {
			const resp = await courseAbandon(requireHost("net").fetchJson({
				url: `${ollamaUrl}/api/chat`,
				method: "POST",
				signal: ac.signal,
				headers: { "Content-Type": "application/json", ...authHeaders },
				body: JSON.stringify({
					model,
					messages: [
						{ role: "system", content: systemPrompt },
						userMessage
					],
					stream: false,
					...(thinkLevel ? { think: thinkLevel } : {}),
					/* `mode`, `objectives` and `glossary` are
					   described at the ROOT level, NEXT TO `questions` — never INSIDE
					   the schema of each question, which requires "title" and "prompt":
					   the final configuration object has neither, and describing it
					   there would have made it a phantom question (batch D review,
					   2026-09-27). Before that fix the schema knew none of them: Ollama
					   OMITTED them from the quiz, or improvised an object that became
					   an empty question. `assemblerQuestionsOllama` (further down)
					   rebuilds the final array from these root fields. */
					...(quizSchema ? { format: {
						type: "object",
						properties: {
							title: { type: "string" },
							questions: {
								type: "array",
								items: {
									type: "object",
									properties: {
										title: { type: "string" },
										prompt: { type: "string" },
										options: { type: "array", items: { type: "string" } },
										correctIndex: { type: "number" },
										correctIndices: { type: "array", items: { type: "number" } },
										multiSelect: { type: "boolean" },
										type: { type: "string" },
										answer: { type: "string" },
										lesson: { type: "string" },
										passage: { type: "string" },
										passageId: { type: "string" },
										passageTitle: { type: "string" }
									},
									required: ["title", "prompt"]
								}
							},
							mode: { type: "string" },
							objectives: { type: "array", items: { type: "string" } },
							glossary: {
								type: "array",
								items: {
									type: "object",
									properties: {
										term: { type: "string" },
										definition: { type: "string" },
										aliases: { type: "array", items: { type: "string" } }
									},
									required: ["term", "definition"]
								}
							}
						},
						required: ["questions"]
					} } : {})
				})
			}), ac.signal);

			/* `null` = échec RÉSEAU, et c'est la SEULE chose que le contrat traite
			   comme une panne : un statut d'erreur arrive avec son CORPS, là où
			   Ollama met son diagnostic (« model not found », « more system
			   memory »). C'est toute la raison pour laquelle ce module employait
			   `fetch` et non `requestUrl`, et le contrat la tient désormais. */
			if (!resp) throw new Error("ollama_unreachable");
			data = JSON.parse(resp.body);

			if (resp.status < 200 || resp.status >= 300) {
				const rawErr: unknown = data?.error;
				const errMsg: unknown = typeof rawErr === "string" ? rawErr : (rawErr || t("ai.err.httpStatus", { status: resp.status }));
				console.error("[quiz-blocks] Ollama error:", resp.status, errMsg);

				// Erreurs connues → message clair, déjà traduit (userError).
				const errLower = typeof errMsg === "string" ? errMsg.toLowerCase() : "";
				if (errLower.includes("more system memory") || errLower.includes("not enough memory") || errLower.includes("out of memory")) {
					const memMatch = typeof errMsg === "string" ? errMsg.match(/(\d+[\.,]?\d*)\s*GiB/g) : null;
					const detail = memMatch ? " (" + memMatch.join(" / ") + ")" : "";
					throw userError(t("ai.err.ollamaOutOfMemory", { detail }));
				}
				if (errLower.includes("not found") || errLower.includes("model not found")) {
					throw userError(t("ai.err.ollamaModelNotFound", { model }));
				}
				// Modèle cloud réservé à un abonnement (Ollama Pro/Max) : 403
				// « requires a subscription ». Distinct d'un défaut de connexion.
				if (errLower.includes("subscription") || errLower.includes("upgrade for access")) {
					throw userError(t("ai.err.ollamaSubscription"));
				}
				/* Un modèle hors plan : 402 « this model is not included in your
				   free usage … upgrade for included usage » (mesuré 2026-09-19).
				   Jusqu'ici il tombait dans `ollamaHttp` générique. Le verdict est
				   APPRIS ici comme par la sonde à zéro token (voir ai-providers.ts,
				   sonderPlanOllama) : la prochaine ouverture du menu classe ce
				   modèle « Pro » avant même de cliquer. */
				if (erreurOllamaHorsPlan(resp.status, errLower)) {
					const appris = { ...(settings.get().aiOllamaPlansAppris || {}) };
					if (appris[model] !== "payant") {
						appris[model] = "payant";
						// Le cache appris n'est pas critique : un échec de sauvegarde (IPC,
						// disque) ne doit pas empêcher `erreurPlan` d'être levée juste après,
						// sinon le catch générique ci-dessous la remplacerait par « injoignable ».
						try { await settings.save({ aiOllamaPlansAppris: appris }); }
						catch (e) { console.warn("[quiz-blocks] plan appris non sauvé:", e); }
					}
					throw erreurPlan(t("ai.err.ollamaPlan", { model }));
				}
				if (isCloud && (resp.status === 401 || resp.status === 403 || errLower.includes("sign in") || errLower.includes("signin") || errLower.includes("unauthorized") || errLower.includes("authenticat") || errLower.includes("api key"))) {
					throw erreurConnexion("ollama", t("ai.err.ollamaSignin"));
				}
				throw userError(t("ai.err.ollamaHttp", { status: resp.status, detail: String(errMsg) }));
			}
		} catch (err) {
			// Les erreurs ci-dessus sont déjà formulées → re-jetées telles quelles.
			const e = err as UserFacingError;
			if (e.userFacing) throw err;
			throw userError(t("ai.err.ollamaUnreachableShort", { url: ollamaUrl }));
		}

		if (data.error) {
			const errMsg = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
			throw new Error(t("ai.err.ollama", { detail: errMsg }));
		}

		const content = data?.message?.content || "";
		if (!content.trim()) {
			throw new Error(t("ai.err.ollamaEmpty"));
		}

		if (typeof data.prompt_eval_count === "number" || typeof data.eval_count === "number") {
			pendingUsage = {
				provider: "ollama",
				model,
				inputTokens: data.prompt_eval_count || 0,
				outputTokens: data.eval_count || 0,
				cachedInputTokens: 0,
				costUsd: null
			};
		}

		console.log("[quiz-blocks] Ollama response length:", content.length);
		return content;
	}

	/* The chat's system prompt: in English, as every instruction to the
	   model; the answer follows the language of the conversation. */
	const CHAT_NO_TOOLS = "You have no tools and cannot open files: everything you know about the course is in this conversation. If something is missing, say what you would need.";
	/* With pictures attached (the Explain window), the ONE thing the model may
	   open is those pictures, with the read tool the call grants for them. */
	const CHAT_PICTURES = "You cannot open files, except the course pictures listed in the context: read the ones the question needs with the Read tool before answering, and never read anything else. Everything else you know about the course is in this conversation. If something is missing, say what you would need.";
	const CHAT_SYSTEM = [
		"You are a patient tutor inside Neo Quiz, a revision app. The learner is studying for an exam and asks you questions about their course, a quiz question, or anything they did not understand.",
		"Answer in the language the learner writes in; in French, ALWAYS address the learner as « tu » (tu, ton, ta, tes), never « vous ». Be clear and concrete: start with the direct answer, then explain WHY and HOW (the reason behind a fact is what makes it stick), ground every abstract idea in a concrete example, and when a procedure is involved work one example through step by step. When you use an analogy, say where it stops holding. Do not pad: precise beats long. When it helps the learner, end with one short question that lets them check their own understanding, without giving its answer. Use Markdown (short paragraphs, lists, **bold** for the key idea, fenced code blocks naming their language for any code, $…$ for math).",
		CHAT_NO_TOOLS,
	].join("\n\n");

	/** THE PLAN OF AN EXAM PREPARATION (2026-09-30): the model reads EVERY
	    document at once, then chooses the quizzes that will cover everything
	    that can come up — their number, their order, what each covers.
	    `typeImpose`: the Learn | Test selector, which the plan follows. */
	async function planifier(demande: string, documents: string, typeImpose: "learn" | "practice" | undefined, options: { onTranscript?: (event: TranscriptEvent) => void; reprise?: string } = {}): Promise<EtapePlan[]> {
		aborted = false;
		pendingUsage = null;
		transcriptSink = options.onTranscript ?? null;
		repriseBase = options.reprise ?? null;
		appelsCli = 0;
		await refreshCliCaches();
		try {
			const provider = settings.get().aiProvider || "";
			let model = settings.get().aiModel || (provider ? getProvider(provider).defaultModel : "");
			const genre = !typeImpose
				? "a LEARN path first (\"type\": \"learn\", teaching the program step by step, one per part of it), then TESTS (\"type\": \"test\") in rising difficulty, the last ones at the exam's level"
				: typeImpose === "learn"
				? "LEARN paths only (\"type\": \"learn\"): each one teaches a part of the program step by step"
				: "TESTS only (\"type\": \"test\"): in rising difficulty, the last ones at the exam's level";
			const systeme = [
				"You plan the revision of a learner for an exam, inside Neo Quiz. You have no tools: the documents are in the message.",
				`First read ALL the documents, to see the whole program. Then list EVERY EXAMINABLE POINT of it — a fact, definition, rule, method or classic trap an exam can ask about; one point per distinct thing, never the same thing twice, at the GRAIN OF ONE EXAM QUESTION: the variants of one rule are ONE point ("the modes r, w and a of open" is one point, not three; "the arithmetic operators" splits only where a trap lies, like / versus //). The plain FACTS the course states are examinable too — who created what, dates, names, definitions ("who created Python?" is a real exam question); only course logistics and installation steps are not. Then group the points into the quizzes that will cover them: as many quizzes as the program needs (usually 3 to 8), never one per document by reflex; related points together. Every point in exactly ONE quiz: the quizzes together cover 100% of what can come up, and nothing twice. Plan ${genre}.`,
				"Answer with ONLY a JSON array, one object per quiz, in the order to take them: { \"title\": \"short title of the quiz, in the language of the documents\", \"type\": \"learn\" or \"test\", \"covers\": \"one sentence: what this quiz covers\", \"points\": [\"each examinable point of this quiz, a short phrase in the language of the documents\", ...] }. Nothing before or after the array.",
			].join("\n\n");
			const userPrompt = [documents.trim() ? "THE DOCUMENTS:\n" + documents.trim() : "", "THE LEARNER'S REQUEST:\n" + demande.trim()].filter(Boolean).join("\n\n---\n\n");
			let texte: string;
			if (provider === "claude-code") {
				model = resolveClaudeModel(model);
				texte = await callClaudeCodeTexte(model, systeme, userPrompt);
			} else if (provider === "codex") {
				model = resolveCodexModel(model);
				const effort = resolveEffort("codex", settings.get().aiEffort, model);
				const m = getCodexModels().find(x => x.value === model);
				texte = await callCodexTexte(model, systeme, userPrompt, [], effort, !!settings.get().aiCodexFast && !!(m && m.fast));
			} else {
				// A provider that cannot hold this exchange: the fixed plan of before.
				return [];
			}
			return lirePlan(texte, typeImpose);
		} catch (err) {
			if (aborted) {
				const e = new Error("Planification annulée") as Error & { aborted?: boolean };
				e.aborted = true;
				throw e;
			}
			throw err;
		} finally {
			abortCurrent = null;
			transcriptSink = null;
			repriseBase = null;
		}
	}

	/** The clarify call of "Generate": same provider as the generation, same
	    call forms (no tool, no new option), the LOWEST effort the provider
	    offers, and 30 s at most. */
	async function clarify(request: string, documentNames: readonly string[]): Promise<string> {
		aborted = false;
		pendingUsage = null;
		transcriptSink = null;
		repriseBase = null;
		await refreshCliCaches();
		const limite = window.setTimeout(() => { if (abortCurrent) abortCurrent(); }, DECIDE_TIMEOUT_MS);
		try {
			const provider = settings.get().aiProvider || "";
			let model = settings.get().aiModel || (provider ? getProvider(provider).defaultModel : "");
			const { system, user } = clarifyPrompt(request, documentNames, currentLang());
			const plusBas = (id: string, m?: string): string => getEfforts(id, m)[0]?.value ?? "";
			if (provider === "claude-code") {
				model = resolveClaudeModel(model);
				return await callClaudeCodeTexte(model, system, user, [], claudeEffortArg(plusBas("claude-code", model)));
			}
			if (provider === "codex") {
				model = resolveCodexModel(model);
				const m = getCodexModels().find(x => x.value === model);
				return await callCodexTexte(model, system, user, [], plusBas("codex", model), !!settings.get().aiCodexFast && !!(m && m.fast));
			}
			if (provider === "ollama") {
				if (!model) model = resolveOllamaSelection(settings.get().aiOllamaModels, settings.get().aiOllamaCatalog)[0]?.value || "";
				const ollamaUrl = (settings.get().aiOllamaUrl || "http://localhost:11434").replace(/\/+$/, "");
				const key = (settings.get().aiOllamaCloudKey || "").trim();
				const authHeader: Record<string, string> = key ? { "Authorization": "Bearer " + key } : {};
				return await callOllamaTexte(model, system, user, ollamaUrl, authHeader, [], plusBas("ollama") || null);
			}
			if (provider === "antigravity-cli") {
				model = resolveAntigravityModel(model);
				// The effort is in the model's name: the lowest variant of the family.
				return await callAntigravityTexte(antigravityModelId(model, plusBas("antigravity-cli", model)), system, user);
			}
			throw new Error(t("ai.chat.providerUnsupported"));
		} finally {
			window.clearTimeout(limite);
			abortCurrent = null;
		}
	}

	async function chat(history: ChatTurn[], options: ChatOptions = {}): Promise<string> {
		aborted = false;
		pendingUsage = null;
		transcriptSink = options.onTranscript ?? null;
		await refreshCliCaches();
		try {
			const provider = settings.get().aiProvider || "";
			let model = settings.get().aiModel || (provider ? getProvider(provider).defaultModel : "");
			const turns = history.filter(h => h.text.trim());
			const last = turns[turns.length - 1];
			if (!last || last.role !== "user") throw new Error(t("ai.chat.empty"));
			const earlier = turns.slice(0, -1).map(h => (h.role === "user" ? "LEARNER" : "TUTOR") + ":\n" + h.text.trim()).join("\n\n");
			const userPrompt = [
				options.context?.trim() ? "CONTEXT (quiz and course material):\n" + options.context.trim() : "",
				earlier ? "CONVERSATION SO FAR:\n" + earlier : "",
				"LEARNER'S NEW MESSAGE:\n" + last.text.trim(),
			].filter(Boolean).join("\n\n---\n\n");
			const systeme = [
				(options.images?.length ? CHAT_SYSTEM.replace(CHAT_NO_TOOLS, CHAT_PICTURES) : CHAT_SYSTEM),
				options.style === "explain" ? "The learner opened this chat from a question of the quiz below; that question is marked in it. \"This question\", \"the answer\", \"explain it to me\" and the like refer to the marked question unless the learner says otherwise. Answer what they ask, using the quiz and the course; when they ask for an explanation, assume they know nothing and build it step by step (define every term the first time, say what each wrong choice gets wrong, use a concrete everyday example)." : "",
				options.maxChars && options.maxChars > 0 ? `Your whole answer must stay under ${Math.round(options.maxChars)} characters: keep only what helps understanding. The text of a fenced html page does not count in that limit.` : "",
			].filter(Boolean).join("\n\n");
			if (provider === "claude-code") {
				model = resolveClaudeModel(model);
				return (await callClaudeCodeTexte(model, systeme, userPrompt, options.images ?? [], undefined, "The course's pictures (figures, diagrams). Read them with the Read tool when the question needs them:")).trim();
			}
			if (provider === "codex") {
				model = resolveCodexModel(model);
				const effort = resolveEffort("codex", settings.get().aiEffort, model);
				const m = getCodexModels().find(x => x.value === model);
				const fast = !!settings.get().aiCodexFast && !!(m && m.fast);
				return (await callCodexTexte(model, systeme, userPrompt, options.images ?? [], effort, fast)).trim();
			}
			if (provider === "ollama") {
				if (!model) model = resolveOllamaSelection(settings.get().aiOllamaModels, settings.get().aiOllamaCatalog)[0]?.value || "";
				const ollamaUrl = (settings.get().aiOllamaUrl || "http://localhost:11434").replace(/\/+$/, "");
				const key = (settings.get().aiOllamaCloudKey || "").trim();
				const authHeader: Record<string, string> = key ? { "Authorization": "Bearer " + key } : {};
				const effort = resolveEffort("ollama", settings.get().aiEffort);
				return (await callOllamaTexte(model, systeme, userPrompt, ollamaUrl, authHeader, options.images ?? [], effort)).trim();
			}
			if (provider === "antigravity-cli") {
				model = resolveAntigravityModel(model);
				const effort = niveauAntigravity(settings.get().aiAntigravityLevels, model);
				// No picture support: the names go as text.
				const sansImages = options.imageNames?.length ? userPrompt + "\n\nThe course also has these pictures, which you cannot see: " + options.imageNames.join(", ") : userPrompt;
				return (await callAntigravityTexte(antigravityModelId(model, effort), systeme, sansImages)).trim();
			}
			throw new Error(t("ai.chat.providerUnsupported"));
		} catch (err) {
			if (aborted) {
				const e = new Error("Discussion annulée") as Error & { aborted?: boolean };
				e.aborted = true;
				throw e;
			}
			throw err;
		} finally {
			abortCurrent = null;
			transcriptSink = null;
		}
	}

	return {
		generate,
		chat,
		clarify,
		planifier,
		abort: () => { if (abortCurrent) abortCurrent(); },
		get lastUsage() { return lastUsage; }
	};
}
