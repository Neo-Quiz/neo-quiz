import { SIMULATOR_GUIDE } from "../interactive-page-guide";
import JSON5 from "json5";
import { currentHost, requireHost } from "../host/current";
import { jetonFichier, jetonHome, jetonPieces, jetonSortie, nouveauMarqueur } from "../host/jetons";
import { ARGS_AGY_SANS_OUTILS, ARGS_IMAGES_CLAUDE, ARGS_OUTILS_CLAUDE, argsAgentAntigravity, argsAgentClaude, argsAgentCodex, lireModeAgent, optionInconnue } from "../host/claude-outils";
import type { ModeAgent } from "../host/claude-outils";
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
import { newRunId, runIdDeCle } from "./run-id";
import { clarifyPrompt, type ClarifyFolders } from "./generation-kind";
import { lectureClassifyPrompt } from "./lecture-detect";
import { READING_MAX_CHARS } from "../lecture-style";
import { claudeResultDuFlux, createTranscriptDecoder } from "./transcript";
import { inertRemoteImages } from "./remote-images";
import { UsageLimitError, cliErrorText, detectUsageLimit } from "./usage-limit";
import { detectModelLimit } from "./model-limit";
import type { TranscriptEvent } from "./transcript";
import { LiveUnavailable, runLiveTurn } from "./live-generation";
import type { LiveTool } from "./live-generation";
import type { TurnOutcome } from "./live-turn";

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
	/** SEVERAL QUIZZES OVER ALL THE DOCUMENTS (2026-10-14): 2 or more, or
	    "auto" (the model decides how many). The material of every document is
	    split by theme into that many quizzes, read by `parseReponseParties`.
	    Never with `documents`. */
	parties?: number | "auto";
	/** The folder of the quiz, a CONTRACT path (2026-10-09). With Claude
	    Code, the host is asked whether the user trusts it
	    (`HostProcess.trustFolder`, a native dialog the first time); trusted,
	    the CLI runs IN it with read-only tools. Absent, refused, or another
	    provider: no tool at all, as before. Never set for a request that
	    came from another device. */
	dossier?: string;
	/** Nobody at this PC asked for this generation (an automatic Learn, spec
	    2026-10-15-moodle-auto-learn): the trust question is NEVER asked. Only
	    a `dossier` the user already trusted counts, read without any dialog
	    (`HostProcess.isFolderTrusted`); any other answer stops the run with
	    `FolderNotTrusted` before a CLI starts, instead of opening a modal
	    nobody will answer while the line holds its slot. */
	neverAskTrust?: boolean;
	/** Learn only (2026-10-16): the length, in minutes, of ONE class session of
	    the target folder (its class-session settings). It sets the slice cap
	    (`learnMaxSlices`) and tells the model how long the lecture was, so the
	    path teaches as much as the lecture did. Absent: unchanged prompt. */
	lectureMinutes?: number;
	/** A LIVE session (2026-10-11, `live-generation.ts`): the chat this
	    generation belongs to and its resume key. With `dossier`, Claude Code
	    and Codex run as a turn of the chat's live session when the host has
	    them (`HostLive`); otherwise the one-shot call, as before. */
	live?: LiveOptions;
	/** The chat this generation belongs to (2026-10-19): every one-shot CLI
	    call it makes then keeps its raw output in the run store
	    (`HostProcess.run` `registre`), so a stopped or finished generation
	    keeps its transcript. The runs are listed in `AiClient.lastRuns`. */
	chatId?: string;
}

/** See `GenerateOptions.live`. */
export interface LiveOptions { chatId: string; key: string }

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

/** How many characters of an unreadable answer the error shows. */
export const APERCU_REPONSE = 160;

/** The start of a model's answer, as one line of TEXT for an error message. */
export function apercuReponse(texte: string): string {
	return texte.trim().replace(/\s+/g, " ").slice(0, APERCU_REPONSE);
}

/**
 * Reads a model's answer with `lire`; when it is not a quiz, the error says
 * WHY in words the learner can act on (2026-10-10). A size limit named by the
 * CLI (`erreurCli`: its error events, or the raw stream) or at the start of
 * the answer becomes "the answer / the request was too long". Any other
 * unreadable answer keeps the reader's error (which shows the first
 * `APERCU_REPONSE` characters of the answer), and the WHOLE raw answer goes
 * to `garder` (the host's diagnostic file) before the error is thrown. A
 * model's explicit "no quiz" (`NoQuizAnswer`) is not a failure to read.
 */
export function lireOuDiagnostiquer(texte: string, lire: LireReponse, erreurCli = "", garder?: (brut: string) => void): ReponseQuiz & { lot?: ReponseDocument[] } {
	try {
		return lire(texte);
	} catch (e) {
		if (e instanceof NoQuizAnswer) throw e;
		const limite = detectModelLimit(erreurCli, texte);
		if (limite) throw new Error(t(limite === "output" ? "ai.err.outputLimit" : "ai.err.contextLimit"));
		if (garder) { try { garder(texte); } catch { /* a diagnostic never replaces the error */ } }
		throw e;
	}
}

/**
 * The part of an Antigravity output that may say WHY it failed (2026-10-18).
 * In agent mode its `stream-json` output carries everything the agent did, tool
 * outputs included: scanning it all for "401", "quota", "not recognized" or
 * "introuvable" blamed a missing install on a quiz whose own commands had
 * printed one of them. Only the `result` and `error` events count; an output
 * that is not a stream (a plain error text) is taken as it is, its end only.
 */
export function diagnosticAntigravity(stdout: string): string {
	const lignes = String(stdout || "").split("\n").map(l => l.trim()).filter(Boolean);
	if (!lignes.some(l => l.startsWith("{\"event\":"))) return lignes.join(" ").slice(-2000);
	const out: string[] = [];
	for (const l of lignes) {
		if (!l.startsWith("{\"event\":\"result\"") && !l.startsWith("{\"event\":\"error\"")) continue;
		try {
			const v = JSON.parse(l) as { result?: { status?: string; error?: string }; error?: unknown; message?: unknown };
			out.push(String(v.result?.error ?? ""), v.result?.status && v.result.status !== "SUCCESS" ? String(v.result.status) : "", typeof v.error === "string" ? v.error : "", typeof v.message === "string" ? v.message : "");
		} catch { /* a cut line says nothing */ }
	}
	return out.join(" ");
}

/**
 * The quiz array hidden in a longer answer (2026-10-18). An agent that read a
 * PDF may answer with the text it extracted FIRST (95 KB of notes, measured on
 * GLM-5.3 Flash through Claude Code), then the quiz, then "Done.": the whole is
 * not JSON5, yet the quiz is whole inside it. Every line that opens an array of
 * objects is a candidate start, tried from the LAST one backwards (notes quote
 * code with lists of dicts, the quiz comes after them), each read up to the last
 * `]`; the first that parses as a list of question objects wins. Never a
 * guess: a cut or malformed array stays unreadable, and the caller reports it.
 */
export function extraireTableauQuiz(texte: string): unknown[] | null {
	const fin = texte.lastIndexOf("]");
	if (fin < 0) return null;
	const debuts: number[] = [];
	for (const m of texte.matchAll(/(?:^|\n)[ \t]*\[[ \t]*\r?\n?[ \t]*\{/g)) {
		debuts.push(texte.indexOf("[", m.index ?? 0));
	}
	for (const debut of debuts.slice(-20).reverse()) {
		if (debut >= fin) continue;
		try {
			const v = JSON5.parse(texte.slice(debut, fin + 1)) as unknown;
			if (Array.isArray(v) && v.length > 0 && v.every(q => typeof q === "object" && q !== null && !Array.isArray(q))
				&& v.some(q => "prompt" in (q as object) || "title" in (q as object))) return v;
		} catch { /* not this start */ }
	}
	return null;
}

/** One correction round asked of the model (2026-10-18): what its previous
    answer was, and the message that tells it what is wrong with it. */
export interface Correction {
	/** The message sent to the model: the exact error, an excerpt of ITS answer, the instruction. */
	note: string;
	/** Its previous answer, resent with the request when no live session holds the conversation. */
	precedent: string;
	/** 1-based round and the number of rounds allowed. */
	tour: number;
	max: number;
}

/** The text a parser read, kept on its error so the excerpt of a correction
    quotes the lines the error numbers (the answer after the fence and LaTeX
    repairs), not the raw answer. */
export type ErreurLecture = Error & { texteLu?: string };

/** The `L:C` of a JSON5 error message ("invalid character 'c' at 153:1375"). */
export function positionDErreur(message: string): { ligne: number; colonne: number } | null {
	const m = /\bat (\d+):(\d+)\b/.exec(message);
	return m ? { ligne: Number(m[1]), colonne: Number(m[2]) } : null;
}

/** Lines `ligne - 5 .. ligne + 5` of `texte`, numbered; a line longer than 240
    characters shows the 200 around the error column, with a caret under it. */
export function extraitNumerote(texte: string, ligne: number, colonne: number, marge = 5): string {
	const lignes = texte.split("\n");
	const debut = Math.max(1, ligne - marge);
	const fin = Math.min(lignes.length, ligne + marge);
	const sortie: string[] = [];
	for (let n = debut; n <= fin; n++) {
		let l = (lignes[n - 1] ?? "").replace(/\r$/, "");
		let decalage = 0;
		if (l.length > 240) {
			const de = n === ligne ? Math.max(0, colonne - 100) : 0;
			decalage = de;
			l = (de > 0 ? "…" : "") + l.slice(de, de + (n === ligne ? 200 : 160)) + (l.length > de + 200 ? "…" : "");
		}
		sortie.push(String(n).padStart(5) + " | " + l);
		if (n === ligne) {
			const pos = Math.max(0, colonne - 1 - decalage) + (decalage > 0 ? 1 : 0);
			sortie.push("      | " + " ".repeat(Math.min(pos, 240)) + "^ here");
		}
	}
	return sortie.join("\n");
}

/** The message of one correction round: the error word for word, where it is,
    the lines around it in the model's own answer, and what to send back. */
export function noteDeCorrection(erreur: unknown, texteLu: string, tour: number, max: number): string {
	const brute = (erreur as { erreurBrute?: string } | undefined)?.erreurBrute;
	const message = (brute ?? (erreur instanceof Error ? erreur.message : String(erreur))).slice(0, 600);
	const pos = positionDErreur(message);
	const source = (erreur as ErreurLecture | undefined)?.texteLu ?? texteLu;
	const extrait = pos ? "\n\nThe lines around the error, numbered, taken from your own answer as the app read it:\n" + extraitNumerote(source, pos.ligne, pos.colonne) : "";
	return "AUTOMATIC CORRECTION " + tour + "/" + max + ": the app could not accept your last answer.\n\nThe error, word for word: " + message
		+ (pos ? "\nIt is at line " + pos.ligne + ", column " + pos.colonne + "." : "")
		+ extrait
		+ "\n\nFix that mistake yourself and resend the COMPLETE corrected quiz: the whole JSON5 array in one answer, nothing before it except the first line comment, nothing after it, every object, array and string closed. Do not apologise and do not explain.";
}

/** The model's mistakes the app can name as a fixed schema (2026-10-18): a
    question that offers options without saying which is right, or whose
    answer points outside them. `null` when every question is sound. */
export function validerQuestions(questions: readonly unknown[]): string | null {
	let n = 0;
	for (const q of questions) {
		if (typeof q !== "object" || q === null || Array.isArray(q)) continue;
		const o = q as Record<string, unknown>;
		if (!Array.isArray(o.options)) continue;
		n++;
		const nom = "Question " + n + (typeof o.title === "string" && o.title ? " (" + o.title.slice(0, 50) + ")" : "");
		if (o.options.length < 2) return nom + ": \"options\" has fewer than 2 entries.";
		const indices = Array.isArray(o.correctIndices) ? o.correctIndices : o.correctIndex !== undefined ? [o.correctIndex] : null;
		if (o.ordering === true || o.matching === true || o.cloze !== undefined || o.numeric === true || typeof o.answer === "string") continue;
		if (!indices || indices.length === 0) return nom + ": it has \"options\" but neither \"correctIndex\" nor \"correctIndices\".";
		for (const i of indices) {
			if (!Number.isInteger(i) || (i as number) < 0 || (i as number) >= (o.options as unknown[]).length) return nom + ": the correct index " + JSON.stringify(i) + " is not an index of its " + (o.options as unknown[]).length + " options (0 to " + ((o.options as unknown[]).length - 1) + ").";
		}
	}
	return null;
}

/** An answer the app refused for its schema, not for its syntax. */
export class ErreurSchema extends Error {}

/** A title that is a file name, not a name for a student: "cours1",
    "cours1_linear_fit", "CM2", or the attached document's own name. */
export function titreDeFichier(titre: string, document?: string): boolean {
	const t = titre.trim();
	const nom = (document ?? "").replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").trim();
	return /_/.test(t) || /^[\p{L}]+-?\d+$/u.test(t) || (nom !== "" && t.localeCompare(nom, undefined, { sensitivity: "base" }) === 0);
}

/** The quizzes of an answer that have no real title (missing, or a file name),
    named for the model; empty when every quiz has one. */
export function titresManquants(r: ReponseQuiz & { lot?: ReponseDocument[] }): string[] {
	if (r.lot) return r.lot.filter(d => !d.titre || titreDeFichier(d.titre, d.document)).map(d => d.document);
	return !r.titre || titreDeFichier(r.titre) ? [""] : [];
}

/** The message of a title round: the quiz was read, only its name is missing,
    so the model sends the title line(s) alone, never the whole quiz again. */
export function noteDeTitre(manquants: readonly string[], lot: boolean, tour: number, max: number): string {
	const quoi = lot ? "These quizzes have no real title: " + manquants.map(d => "\"" + d + "\"").join(", ") + "." : "Your quiz has no real title.";
	const forme = lot ? "Answer with one line per quiz listed, in that order, and nothing else: '// title: <name>'." : "Answer with ONE line and nothing else: '// title: <name>'.";
	return "AUTOMATIC CORRECTION " + tour + "/" + max + ": " + quoi + " A title is what a student would write on the cover: 3 to 8 words naming the subject and scope, in the language of the content, never a file name (no \"cours1\", no underscore). " + forme + " Do not resend the quiz.";
}

/** The titles of a title round's answer, in order. */
function titresDeReponse(texte: string): string[] {
	const titres: string[] = [];
	for (const m of texte.matchAll(/\/\/\s*title\s*:\s*(.+?)\s*$/gim)) {
		const t = nettoyerTitre(m[1]);
		if (t) titres.push(t);
	}
	return titres;
}

/**
 * One model call and its reading, with the model's own CORRECTION (2026-10-18,
 * "we're talking about an AI: it can fix its mistake itself"): an answer the
 * app cannot read (cut, malformed, prose) or that fails the question schema
 * is sent back to THE SAME model with the exact error, the numbered lines
 * around it and the order to resend the whole block, up to `tours` rounds.
 * `appel` asks the model (round 0: the request; after: the correction, which
 * a live session answers in the same conversation and a one-shot call gets
 * with the previous answer attached). Never corrected: a model's explicit "no
 * quiz", a usage limit, a context limit, a Stop. After the last round the
 * error of the LAST answer is thrown.
 */
export async function lireEtCorriger(o: {
	appel: (correction: Correction | null) => Promise<string>;
	lire: LireReponse;
	annule?: () => boolean;
	tours?: number;
	/** Called before each correction round (the transcript shows it as a step). */
	surCorrection?: (tour: number, max: number, erreur: string) => void;
}): Promise<ReponseQuiz & { lot?: ReponseDocument[] }> {
	const max = o.tours ?? 3;
	let brut = await o.appel(null);
	for (let tour = 1; ; tour++) {
		let lu: (ReponseQuiz & { lot?: ReponseDocument[] }) | null = null;
		try {
			const r = o.lire(brut);
			const faute = validerQuestions(r.lot ? r.lot.flatMap(d => d.questions) : r.questions);
			if (faute) throw Object.assign(new ErreurSchema(faute), { texteLu: brut });
			lu = r;
		} catch (e) {
			if ((o.annule && o.annule()) || e instanceof NoQuizAnswer || e instanceof UsageLimitError || (e instanceof Error && e.message === t("ai.err.contextLimit")) || tour > max) throw e;
			o.surCorrection?.(tour, max, e instanceof Error ? e.message : String(e));
			try {
				brut = await o.appel({ note: noteDeCorrection(e, brut, tour, max), precedent: brut, tour, max });
			} catch { throw e; }
		}
		if (lu) return await avecTitres(lu, brut, o);
	}
}

/** Title rounds (2026-10-19): a quiz read whole but named after its file
    ("cours1_linear_fit") or not named at all goes back to the model for its
    title alone, at most twice. The quiz is never lost for a title: after the
    rounds, it keeps what it has. */
async function avecTitres(lu: ReponseQuiz & { lot?: ReponseDocument[] }, brut: string, o: { appel: (c: Correction | null) => Promise<string>; annule?: () => boolean; surCorrection?: (tour: number, max: number, erreur: string) => void }): Promise<ReponseQuiz & { lot?: ReponseDocument[] }> {
	const max = 2;
	for (let tour = 1; tour <= max; tour++) {
		const manquants = titresManquants(lu);
		if (!manquants.length || (o.annule && o.annule())) break;
		o.surCorrection?.(tour, max, lu.lot ? "quizzes without a real title" : "quiz without a real title");
		let reponse: string;
		try { reponse = await o.appel({ note: noteDeTitre(manquants, !!lu.lot, tour, max), precedent: brut, tour, max }); } catch { break; }
		const titres = titresDeReponse(reponse);
		if (lu.lot) {
			lu = { ...lu, lot: lu.lot.map(d => {
				const titre = titres[manquants.indexOf(d.document)];
				return titre && !titreDeFichier(titre, d.document) ? { ...d, titre } : d;
			}) };
		} else if (titres[0] && !titreDeFichier(titres[0])) lu = { ...lu, titre: titres[0] };
	}
	return lu;
}

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

/** A failure of the CLI's own connection (a stream cut by the network, a
    server that is busy): asking again is the cure, never a message to the
    learner (2026-10-18: an Antigravity run ended with "The stream was
    interrupted. Please continue the task you were working on." after its own
    retry failed, the generation lost with it). */
export class TransientCliError extends Error {}

/** Does this error text of a CLI describe a connection or server hiccup? */
export function estTransitoire(texte: string): boolean {
	return /stream was interrupted|interrupted|connection (reset|aborted|closed|refused)|connexion .{0,40}(abandonn|interrompu|ferm)|econnreset|etimedout|socket hang up|temporarily unavailable|service unavailable|overloaded|try again|\b50[234]\b/i.test(String(texte || "").slice(0, 600));
}

/** A call retried when it fails with a `TransientCliError`: at most `max` more
    times, a pause between them; a Stop is never retried. */
export async function avecRelances<T>(appel: () => Promise<T>, annule: () => boolean, max = 2, pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms)), delaiMs = 4000): Promise<T> {
	for (let i = 0; ; i++) {
		try {
			return await appel();
		} catch (e) {
			if (!(e instanceof TransientCliError) || i >= max || annule()) throw e;
			await pause(delaiMs * (i + 1));
		}
	}
}

/** Thrown before any CLI starts when a run sent with `neverAskTrust` meets a
    folder that is not already trusted: the queue pauses the line as
    "untrusted" (its "Trust this folder" button), never asks by itself. */
export class FolderNotTrusted extends Error {
	constructor(readonly folder: string) {
		super("folder not trusted");
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
	/** The quiz's folder, a CONTRACT path (2026-10-14), as
	    `GenerateOptions.dossier`: once the user trusts it, Claude Code and
	    Codex run in it as agents, with the composer's agent mode. */
	dossier?: string;
	/** A turn of the chat's live session (2026-10-14), as a generation:
	    `followUp` is sent when the session already holds the conversation;
	    a new session gets the whole text. */
	live?: LiveOptions & { followUp?: string };
	/** The resume key of this call (2026-10-14, `HostProcess.run`), as
	    `GenerateOptions.reprise`: stable across a reload of the page, so the
	    queue restored after it attaches to the CLI still running instead of
	    launching the same call again. Each CLI call gets its own key from it. */
	reprise?: string;
	/** As `GenerateOptions.chatId`. */
	chatId?: string;
	/** A command of Claude Code (2026-10-15): the last user turn is sent AS IT
	    IS to the chat's live session, with no system prompt and no context.
	    Without a live session (or with another provider) it rejects with
	    `ai.commands.needsLive`: nothing is sent. */
	raw?: boolean;
}

/** The AI client, returned by `createAiClient`. */
export interface AiClient {
	/** With `options.documents`, resolves with `lot` (one quiz per document, in
	    the documents' order) and an empty `questions`; otherwise one quiz. */
	generate(prompt: string, options?: GenerateOptions): Promise<ReponseQuiz & { lot?: ReponseDocument[] }>;
	/** A CONVERSATION with Claude Code or Codex (2026-09-29), answered as
	    prose. With `options.live` and a trusted `options.dossier`, a turn of
	    the chat's live session (2026-10-14): `live.followUp` when the session
	    already holds the conversation, the whole history when it starts.
	    Otherwise one call per message with the whole history — the CLI
	    stateless, launched with the same forms as a one-shot generation: as
	    an agent in `options.dossier` once trusted, otherwise without tools.
	    `context` is attached text (notes read by the page). Any other
	    provider rejects with a message saying so. */
	chat(history: ChatTurn[], options?: ChatOptions): Promise<string>;
	/** "/exam": the model reads every document, then plans the quizzes. `[]`: no plan (unsupported provider or unreadable answer). */
	planifier(demande: string, documents: string, typeImpose: "learn" | "practice" | undefined, options?: { onTranscript?: (event: TranscriptEvent) => void; reprise?: string; dossier?: string; live?: LiveOptions; chatId?: string }): Promise<EtapePlan[]>;
	/** The short call that may ask clarifying questions before a vague request
	    generates (spec 2026-10-07-generate-auto-kind): the request and the NAMES of the
	    documents only, the lowest effort, 30 s at most. Resolves with the
	    model's raw text (`parseClarifyAnswer` reads it); rejects on any failure,
	    including a provider that cannot hold the exchange. `folders`: the
	    learner's folder names and the folder already decided, if any. */
	clarify(request: string, documentNames: readonly string[], folders?: ClarifyFolders): Promise<string>;
	/** The short call that sorts ambiguous file names (`lectureClassifyPrompt`): names only, no tools, lowest effort, 30 s at most; the raw text, read by `parseLectureVerdicts`; rejects on any failure. */
	classifyLectures(names: readonly string[]): Promise<string>;
	abort(): void;
	/** Consommation de la DERNIÈRE génération réussie ; null si le fournisseur
	    n'a rien publié (cf. ai-usage.ts : on n'estime jamais un compteur absent). */
	lastUsage: AiUsage | null;
	/** The runs (ids in the run store, in call order) of the LAST generation,
	    chat message or plan given a `chatId`, kept even when it was stopped
	    or failed: empty when none was recorded. */
	lastRuns: string[];
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
/** The most slices a generated Learn holds (2026-10-10): about 30 cards and
    10 readings, one sitting. Without a cap one lecture PDF gave 28 slices. */
export const LEARN_MAX_SLICES = 10;

/** The slice cap of a Learn whose lecture length is known (2026-10-16): one
    slice per 20 minutes of class, between 6 and 16, so a 5 h lecture is not
    squeezed into the template of a 1 h one. Absent (or not a positive
    number): the default cap, unchanged. */
export function learnMaxSlices(lectureMinutes?: number): number {
	if (typeof lectureMinutes !== "number" || !Number.isFinite(lectureMinutes) || lectureMinutes <= 0) return LEARN_MAX_SLICES;
	return Math.min(16, Math.max(6, Math.round(lectureMinutes / 20)));
}

/** "3 h", "1 h 30", "45 min": a lecture length as the prompt states it. */
function lectureLength(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = Math.round(minutes - h * 60);
	return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m}`;
}

/** A Learn cites where each reading comes from: the document and its pages,
    read on the "[p. N]" marks of an attached PDF. */
const LEARN_SOURCES = `SOURCES OF THE READINGS: when the content comes from attached documents, EVERY "read" card has "cite": the document's file name and the page or pages it draws on, read on the "[p. N]" marks that open each page of a PDF — for example "cite": "CM3 - Réseaux.pdf, p. 12-14". Rephrase freely to explain better than the document does; the source says where to read the original. A document without page marks is cited by its name alone. No "cite" when nothing is attached.

`;

/** A reading may SHOW a page of an attached PDF (2026-10-08): the model
    names the page, the application draws it (dashboard/figures.ts). */

/** A reading carries an interactive page in the style its notion fits (2026-10-09; required for those notions since 2026-10-10, when every reading of a generated Learn came out as the same plain steps), shown in a sandboxed iframe. */
export const LEARN_HTML = `INTERACTIVE PAGES: AT LEAST 8 READINGS IN 10 carry "html", an INTERACTIVE page in one of the STYLES below (see ITS STYLE in the slice) where the learner ACTS on the course: reading alone is passive, and one learns by doing. It is a COMPLETE, self-contained HTML page (starting with <!doctype html>), shown under the reading in a frame the learner can interact with, like a claude.ai artifact. It fits notation and symbol tables (drawn in inline SVG), diagrams, a sequence diagram, a process, a state machine, a small simulator, an animation, a clickable mini-quiz. NEVER a page that only SHOWS text, a list or a table that Markdown already shows: the page always makes the learner do something (tap to reveal, toggle two cases, step through a process, sort or classify items, vary a value, predict then check). Rules: no external resource and no network (no <script src>, no CDN, no web font, no remote image: everything inline, images as data: URIs); the page may run inline scripts, but cannot submit forms, open windows, or reach the app; fluid width (it is shown from 320 px to 900 px wide, use max-width: 100% and viewBox on SVG), no fixed height, no scrollbar; dark-friendly: use the CSS variables --nq-bg, --nq-fg, --nq-muted, --nq-accent and --nq-border and font-family: var(--nq-font), a transparent background, never a hard-coded white page; CODE: put every piece of code, in any language, in <pre> or <code>: the application colours it itself, like the course's code blocks; never colour code by hand. COLOURS: a button or label that holds code (an index [0], a key ["titre"]) shows it in <code> with the syntax colours the application gives, never a colour of its own; the pairing colours var(--nq-c1) to var(--nq-c6) are used ONLY when two different places on the screen must be matched and nothing else links them, never to decorate isolated terms. LAYOUT: the page is shown RIGHT UNDER the step of the reading that holds its code, so never copy that code or its data again (no list of the indexes and values the code already shows): the page only adds what the learner acts on and the result. It sits directly in the reading, with NO outer border, box, shadow or background around it. A list, array or dictionary is drawn ONE ELEMENT PER LINE, its index or key at the start of the line, as one reads it in a debugger, never as a grid of cards; each such line fits on ONE line at 320 px (show a short form of a long value) and never wraps; at most 60 KB. The page is a JSON string: escape its double quotes with a backslash and write each line break as a backslash followed by n. The reading's text still explains the notion; the page illustrates it.
FORMS OF THE INTERACTIVE PAGES: you are FREE. Every form below is available, and for EACH page you choose the one that suits ITS notion best, never a default. Before writing a page, picture two or three forms that could show this notion and keep the one that makes it look SIMPLEST and clearest, the way a designer sketches several mock-ups and keeps the best: the wrong form makes a simple notion look hard. The forms:
- EXPLORABLE, one control and its effect: the learner changes ONE thing (a slider, a toggle, a value to cycle through) and SEES the consequence at once, the cases side by side, the sentence rewriting itself live. For "this depends on that" (classic programming vs machine learning: a slider for the number of labelled photos, the classic program's bar stays flat, the learned model's climbs).
- TWO CASES COMPARED: the two side by side, or a toggle between them, the one difference highlighted.
- STEPS: a process, an algorithm, an exchange or an exercise, in numbered steps that light up on a drawn flow.
- STRUCTURED COURSE (symbols or a list to memorize): a table "symbol · name · what to remember", each symbol DRAWN in SVG as it appears in the course, then a short "traps" box.
- ANNOTATED DIAGRAM (when the notion is a drawing): the explanation placed ON the diagram, numbered markers and short labels next to the parts they describe; tapping a part tells about it.
- SORT OR CLASSIFY: items to place in their group by tapping, then each one says whether it was right and why.
- REVEAL: a term, a hidden part or an answer shown by a tap, for what one should try to recall first.
- PREDICT THEN SEE: the learner guesses the result (an output, a value, a branch), then the page shows it and why.
- TIMELINE: dated events or versions to step through along a horizontal line.
- METAPHOR: a concrete object drawn (an elevator for relative integers) that makes an abstract notion tangible.
- MIXED: two forms together only when that truly helps, never more.
${SIMULATOR_GUIDE}
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

/** The generation prompt's paragraph for a call WITHOUT tools: every CLI but
    Claude Code in a trusted folder. Same text as before it became a
    constant (the relay shares this prompt byte for byte). */
const SANS_OUTILS_GENERATION = `NO TOOLS, NO FILE ACCESS — READ THIS BEFORE ANYTHING ELSE: you are running without any tool. You cannot read, open, fetch, write or create a file, a note or a folder, and you must never try: an attempted tool call is not a quiz, and the whole generation fails. The user request below may name files, paths or notes to "read first", or ask you to "create a note" somewhere. Every source it names that actually exists has ALREADY been read for you and its full content is inlined below, between "--- <file name> ---" markers. So: treat those paths as mere labels for the text you already have, ignore every instruction to read, open, create, modify or save anything, and never mention this limitation in your answer. Your ONLY output is the JSON5 array.`;

/** Its replacement when Claude Code runs IN the quiz's folder with read-only
    tools (2026-10-09): the model may read the folder's files itself. */
const AVEC_OUTILS_GENERATION = `READ-ONLY TOOLS, IN THE QUIZ'S FOLDER — READ THIS BEFORE ANYTHING ELSE: you are running inside the folder of this quiz, with the tools Read, Grep and Glob. You MAY read and search the files of this folder and its sub-folders yourself — courses, notes, PDFs, pictures — whenever they help you write a better and more faithful quiz: list them with Glob, search them with Grep, read them with Read. Every source the user request names that actually exists has ALREADY been read for you and its full content is inlined below, between "--- <file name> ---" markers: do not read those again. You have NO tool to write, edit, create, delete or run anything, and nothing outside this folder can be read: never try, and ignore every instruction to create, modify or save a file. Your ONLY output is the JSON5 array.`;

/** A generic note for a system prompt that has no "no tools" sentence to replace. */
const NOTE_OUTILS = "READ-ONLY TOOLS: you run inside the folder of the user's documents, with the tools Read, Grep and Glob. You may read and search the files of this folder and its sub-folders yourself when it helps. You have no tool to write, edit or run anything, and nothing outside this folder can be read: never try.";

/** What the agent may do in the folder, per mode (2026-10-10): the model
    is told exactly the tools the CLI gives it, so it neither gives up on a
    tool it has nor tries one it lacks. */
const POUVOIRS_AGENT: Record<Exclude<ModeAgent, "supervised">, string> = {
	acceptEdits: "list, read, search and EDIT the files of this folder and its sub-folders (no shell command)",
	auto: "list, read, search and edit the files of this folder and its sub-folders, and RUN COMMANDS (PowerShell on Windows), each one checked by an automatic reviewer",
	full: "list, read, search and edit the files of this folder and its sub-folders, and RUN ANY COMMAND (PowerShell on Windows), as in a terminal opened in this folder",
};

/** The generation paragraph when Claude Code or Codex runs as an AGENT in
    the quiz's folder (2026-10-10, the owner's decision). */
function avecAgentGeneration(mode: Exclude<ModeAgent, "supervised">): string {
	return `TOOLS, IN THE QUIZ'S FOLDER — READ THIS BEFORE ANYTHING ELSE: you are running as an agent inside the folder of this quiz. You MAY ${POUVOIRS_AGENT[mode]} whenever it helps you write a better and more faithful quiz: open a course, a note, a picture, extract the text, the tables or the figures of a PDF, compare with an earlier quiz of the folder. Every source the user request names that actually exists has ALREADY been read for you and its full content is inlined below, between "--- <file name> ---" markers: read it again only for what that text lost (a figure, the layout of a table). The APPLICATION writes the quiz: never create, modify or save the quiz note yourself, never touch the ".neo-quiz" folder, and never delete or move a file. Never invoke a skill or a slash command: this prompt already defines the whole task and its output format, and a skill written for another use (notes, courses) would change them. Your ONLY final output is the JSON5 array.`;
}

/* The chat's "no tools" sentences (the Explain window, the chat of a
   question): the call without tools keeps them; in the quiz's trusted
   folder `remplacementsOutils` turns them into the tools note. */
const CHAT_NO_TOOLS = "You have no tools and cannot open files: everything you know about the course is in this conversation. If something is missing, say what you would need.";
/* With pictures attached (the Explain window), the ONE thing the model may
   open is those pictures, with the read tool the call grants for them. */
const CHAT_PICTURES = "You cannot open files, except the course pictures listed in the context: read the ones the question needs with the Read tool before answering, and never read anything else. Everything else you know about the course is in this conversation. If something is missing, say what you would need.";

/** The chat's paragraph when Claude Code or Codex runs IN the quiz's folder
    (2026-10-14, as the generation does): the model looks for what the
    conversation does not give in the course itself. The quiz note is only
    changed through the app's proposals, never by the model. */
function chatAvecOutils(pouvoirs: string): string {
	return `TOOLS, IN THE QUIZ'S FOLDER: you run inside the folder of this quiz and its course. You may ${pouvoirs} whenever it helps you answer: the course notes, PDFs and pictures, the other quizzes of the folder. The quiz and the course the app already read are in this conversation: open a file again only for what that text lost (a figure, a table, a part not included), and read the course pictures listed in the context when the question needs them. Never edit, create or save a quiz note yourself (a change of a card or a question goes in your answer, as asked), never touch the ".neo-quiz" folder, and never delete or move a file. Never invoke a skill or a slash command.`;
}

/** The "no tools" sentences of the prompts, and what each says instead when
    the CLI runs in a trusted folder, per mode. The SECOND pair is the generic
    note `consigneAvecOutils` appends to a prompt without such a sentence. */
function remplacementsOutils(mode: ModeAgent): ReadonlyArray<readonly [string, string]> {
	if (mode === "supervised") {
		const chat = chatAvecOutils("list, read and search the files of this folder and its sub-folders (Read, Grep and Glob: no tool to write, edit or run anything, and nothing outside this folder can be read)");
		return [
			[SANS_OUTILS_GENERATION, AVEC_OUTILS_GENERATION],
			["You have no tools: the documents are in the message.", "The documents are in the message. " + NOTE_OUTILS],
			[CHAT_NO_TOOLS, chat],
			[CHAT_PICTURES, chat],
		];
	}
	const note = `TOOLS: you run as an agent inside the folder of the user's documents. You may ${POUVOIRS_AGENT[mode]} when it helps. Never delete or move a file, and never touch the ".neo-quiz" folder. Never invoke a skill or a slash command: this prompt already defines the whole task and its output format, and a skill written for another use (notes, courses) would change them.`;
	const chat = chatAvecOutils(POUVOIRS_AGENT[mode]);
	return [
		[SANS_OUTILS_GENERATION, avecAgentGeneration(mode)],
		["You have no tools: the documents are in the message.", "The documents are in the message. " + note],
		[CHAT_NO_TOOLS, chat],
		[CHAT_PICTURES, chat],
	];
}

/** The system prompt as Claude Code with read-only tools must read it: its
    "no tools" sentence replaced (by `split`/`join`, never a replacement
    string that a `$` in the text could rewrite), or the note appended. */
export function consigneAvecOutils(systemPrompt: string, mode: ModeAgent = "supervised"): string {
	let out = systemPrompt;
	const remplacements = remplacementsOutils(mode);
	for (const [sans, avec] of remplacements) out = out.split(sans).join(avec);
	return out === systemPrompt ? systemPrompt + "\n\n" + remplacements[1][1].replace("The documents are in the message. ", "") : out;
}

export function composerPrompts(prompt: string, options: GenerateOptions = {}): { systemPrompt: string; userPrompt: string } {
	const { count = null, source = "topic", mode = "practice", planTranches, categorie, preparation } = options;
	const types = normalizeTypes(options.type);
	const documents = (options.documents?.length ?? 0) >= 2 ? options.documents as string[] : null;
	const learn = mode === "learn";
	/* The lecture length sets the cap of a Learn; ignored elsewhere. */
	const lectureMinutes = learn && typeof options.lectureMinutes === "number" && Number.isFinite(options.lectureMinutes) && options.lectureMinutes > 0 ? options.lectureMinutes : undefined;
	const maxSlices = learnMaxSlices(lectureMinutes);
	const lectureNote = lectureMinutes !== undefined
		? `\n\tLECTURE LENGTH: This lecture lasted about ${lectureLength(lectureMinutes)}: the path must carry as much as the lecture taught, without compressing it; a small source still never gets padded.`
		: "";

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
	const quantite = count != null && learn
		/* A Learn asked for a count (2026-10-19): a request that says "5
		   questions" got the Learn's usual two questions per slice (6 for 3). */
		? `QUANTITY: the learner asked for exactly ${count} question${count === 1 ? "" : "s"}. The path contains EXACTLY ${count} question card${count === 1 ? "" : "s"} in total (MCQ questions and flashcards both count, reading cards do not), whatever the per-slice counts of the MODE below say: use as many slices as needed (one to three question cards each, at most one flashcard per slice), every slice keeps its reading card. Never exceed ${count} and never fall short; this number wins over any other count in the request.`
		: count != null
		? `QUANTITY: generate exactly ${count} questions — this number wins over any other count, range or list of themes stated in the user request below. If the request asks for more themes than ${count} questions, cover the most important ones; never exceed ${count}.`
		: learn
		/* A Learn is CAPPED (2026-10-10): "one slice per notion" with 2 to 3
		   MCQs and 1 to 2 flashcards each turned one lecture PDF into 28 slices
		   and 112 cards, judged far too long. The readings still carry the
		   whole course; the questions go to the most examinable points. */
		? `QUANTITY: AT MOST ${maxSlices} slices, each with the counts of the MODE below (2 MCQ questions, at most 1 flashcard): a Learn is done in one ${lectureMinutes !== undefined ? "evening" : "sitting"}, and a longer one is never finished. The readings carry the whole course; the questions go to its MOST EXAMINABLE points — a fact, definition, rule, method or classic trap the exam can ask about —, NEVER two questions on the same point, no trivia, no filler. A small course needs fewer slices: never pad.`
		: "QUANTITY: exactly as many questions as the source has EXAMINABLE POINTS — no more, no less: one question per fact, definition, rule, method or classic trap the exam can ask about, NEVER two on the same point, no trivia, no filler, and no examinable point left out. The number follows the source, never a target — EXCEPT when the user request below states how many questions it wants (per quiz): that stated number then wins, exactly, in EACH quiz; cover the most important points if the source has more.";

	const blocMode = learn ? `MODE: LEARN. You are writing a guided LEARNING PATH through the source — not a test, and not a summary to read. It is done on a phone, often tired: BY DEFAULT the learner only TAPS. A Learn contains ONLY the reading cards, MCQ questions in the style of the course's real exam, and flashcards; the FIRST question of a slice is EASY, right after the notion it checks, and the following ones come closer to the exam.
	WHO IT IS FOR: the learner did NOT follow the lecture (a long class where the teacher explained for hours: attention dropped and much was forgotten). Assume NO PRIOR KNOWLEDGE of the course and teach from zero, in plain language.${lectureNote}
	TERMS DEFINED AT FIRST USE: in a reading, the sentence that FIRST uses a technical term (or an abbreviation) defines it in plain words right there, for example "a **list**, an ordered sequence of values written between \`[]\`", even when the glossary also has it. A question never uses a term that no earlier reading has defined.
	PREREQUISITES STEP: when the lecture relies on notions it does not teach (prerequisites, or notions from EARLIER lectures of the course, which the learner did not follow either), the path opens with ONE extra slice, slice 1, whose read card is titled in the quiz language ("Ce qu'il faut savoir avant" in French, "What you need to know first" in English). It teaches each such notion in two or three lines with a tiny example, then has its usual questions. Leave it out when the lecture assumes nothing. It counts in the cap below.
	COVERAGE: cover EVERY notion of the provided material, in the order of the source, never a sample, in at most ${maxSlices} slices: a slice groups the related notions of one part of the course. Each slice teaches first, with a short plain-language reading (what it is, why it matters, a worked example with its code and its output when relevant), and its recall questions come after it and only check what the slice has just taught.
	FIDELITY OF THE READINGS: together, the readings carry EVERY piece of information of the material — every definition, rule, notation, value, example and warning; nothing the course says is lost. They never copy the course sentence by sentence: they REPHRASE it to be easier to understand than the original (plain words, one idea per sentence, the why before the how, a concrete example). They may ADD related knowledge the course does not state when it really helps to understand (an analogy, a classic pitfall, the link with a notion seen before), never something false or off-topic, and never at the cost of a piece of the course.
	Split the source into SLICES (steps), numbered from 1 in "slice", each small enough for ONE screen of reading. Every slice contains, in this order:
	  1. zero or one question with "role": "pre", asked BEFORE the reading, ONLY when the slice brings a genuinely NEW idea the learner could reason about beforehand — not for a syntax detail nor a plain fact. The learner is expected to fail: it is a SINGLE-choice question with "explain". It also has "hint": a clue that lets someone who has NOT read the slice yet reason toward the answer (the principle to apply, an analogy, what a key word means) — never the answer itself.
	  2. exactly one card with "role": "read": "title" names the slice, "lecture" is "etapes", "prompt" is a one-sentence introduction and "etapes" lists 2 to 4 SHORT paragraphs, one idea each, EACH AT MOST 3 SHORT SENTENCES, keeping the teacher's technical terms EXACTLY as in the source. They are shown as flowing text, NEVER as a numbered list: never write "1.", "Step 1" or a row of definitions. The whole reading (title, introduction, paragraphs and key points together) aims to stay under ${READING_MAX_CHARS} characters: a RECOMMENDED maximum. When a notion needs more than that, SPLIT it into another slice rather than lengthen the reading: more steps, never a dense reading (only a worked example that cannot be cut may run past it). When a slice covers several notions, each notion is its own short part, opened by a **bold** subheading (never numbered: the step number is shown by the app), with its own example. A read card has no options and no answer. TEACH BY EXAMPLE FIRST, the way a good tutor answers "what is this?": the FIRST paragraph is a fully WORKED EXAMPLE on concrete values, correct — the code in a fenced block naming its language, with WHAT IT PRINTS (or its result) written right under the line that prints it, as a comment; when the slice is not about code, a worked case with figures. The next paragraph shows the CONTRAST when there is one: the same example WITHOUT the notion, and what changes. Only then one or two short sentences say, in plain words, what the example showed. NEVER explain a notion through another one the path has not taught yet (an f-string is NOT explained as a \`+\` concatenation with \`str()\`): an equivalent form, if any, comes last and uses only notions already taught. Every compact line of an example is explained by its result on the example's values. Example: { "role": "read", "slice": 1, "title": "f-strings", "lecture": "etapes", "prompt": "An f-string puts the value of a variable inside a text.", "etapes": ["\`\`\`python\ntitle = 'The Shining'\nprint(f'The film {title} does not exist')\n# The film The Shining does not exist\n\`\`\`", "Without the \`f\`, the braces stay plain text:\n\n\`\`\`python\nprint('The film {title} does not exist')\n# The film {title} does not exist\n\`\`\`", "The \`f\` glued before the quotes tells Python to replace what is between \`{}\` by the value of the variable."] }.
	  ITS STYLE: the reading also carries an "html" page in the FORM that shows its notion best, chosen FREELY among the FORMS OF THE INTERACTIVE PAGES below (explorable, two cases compared, steps, structured course, annotated diagram, sort or classify, reveal, predict then see, timeline, metaphor, mixed when that helps). AT LEAST 8 READINGS IN 10 carry their page, in EVERY kind of course, technical or not (a classification to sort, a timeline to step through, two cases to toggle, a term to reveal by tapping, a scenario to choose a branch in). Each form is chosen for its own notion, and notions differ, so the readings VARY along the path: a path where every page has the same form means the forms were not chosen notion by notion. Plain steps alone are only for a notion that truly offers nothing to act on. A path whose readings are mostly plain steps, or all the same kind of page, is wrong.
	  HOOK: EVERY read card has "accroche": { "forme": "analogie" | "histoire" | "image" | "mnemo", "texte": "..." }, one or two sentences that make the notion stick: "analogie" compares it to something everyday, "histoire" sets it in a short scene, "image" gives a vivid picture to see, "mnemo" a memory trick (acronym, rhyme, a phrase whose initials are the items). True and about the notion, in the quiz language. The forms VARY along the path: never the same form twice in a row, and at least three different forms in a Learn of four slices or more. Example: "accroche": { "forme": "analogie", "texte": "A list is like a row of numbered lockers: each value has its place, counted from 0." }
	  KEY POINTS: EVERY read card has "retenir", ALWAYS { "forme": "cartes", "items": [{ "recto": "a cue: a short question or the term", "verso": "the answer in a few words" }, ...] }: 2 to 4 cards the learner tries to recall before flipping them (active recall, never a list to read), each on a different point, never a copy of a later question's answer.
	  3. then 2 MCQ questions per slice in all, the optional "pre" one counted: the others have "role": "recall", each with 3 to 5 options ("options"), "explain" and "hint", written like the written MCQ of the course's real exam: ONE OR SEVERAL correct answers ("correctIndex" for one; "multiSelect": true with "correctIndices" for several — the statement never says how many), often a SHORT code snippet in a fenced block to read and predict, PLAUSIBLE distractors (the classic confusions), never "all of the above". The first question of the slice is easy, answered by recognising what the reading said; the next ones are closer to the exam. Never two recalls on the same point.
	  4. at most ONE FLASHCARD per slice, with "role": "recall": set "flashcard": true, put the question in "prompt" (front) and the expected answer in "answer" (back), add "explain"; no "options", no "type". A flashcard is for a pure FACT or SYNTAX whose answer fits in one sentence, one formula or one line of code (a definition, a syntax, the output of a short expression); a slice that introduces TERMS, DEFINITIONS or FACTS to memorize has one.
	NOTHING ELSE, unless the request explicitly asks for other types or the QUESTION TYPES line at the end names them: a Learn contains no free-text question (no "type": "text"), no fill-in-the-blanks, no ordering, no matching, no numeric answer, no code exercise and no question asking the learner to write an explanation. Only then may you use other types, in the format of the question types of the request.
	HINTS IN LEARN: EVERY MCQ question of the path has "hint", pre and recall alike; only the read cards and the flashcards have none.
	EXPLAIN IN LEARN: the correction must TEACH. In every MCQ question, "explain" first says WHY the right answer(s) are right, in 1 to 2 sentences, then gives ONE line PER wrong option naming the confusion it stands for (for example "B mixes up X and Y"). A flashcard's "explain" says why its answer holds.
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

	/* SEVERAL QUIZZES OVER ALL THE DOCUMENTS (2026-10-14): the number of
	   quizzes is the learner's (the clarifying "how many quizzes"), never one
	   per document by rule: a quiz takes a THEME from every document that
	   treats it. Read by `parseReponseParties`. */
	const parties = !documents && options.parties !== undefined && (options.parties === "auto" || options.parties >= 2) ? options.parties : null;
	const blocParties = parties !== null ? `SEVERAL QUIZZES OVER ALL THE DOCUMENTS — THIS OVERRIDES THE "JSON5 array of questions" FORMAT ABOVE: read ALL the attached documents first, then split the WHOLE material into ${parties === "auto" ? `as many parts as it needs, from 2 to ${MAX_PARTIES}, each the size of one quiz` : `EXACTLY ${parties} parts`} by THEME, never one part per document: a part draws from every document that treats its theme. Write ONE quiz per part, in a sensible learning order. Together the quizzes cover every notion of the material, with no question repeated across quizzes, and each quiz stands on its own.
	Your answer is ONE JSON5 array with one element per quiz: { "part": <its number, from 1>, "title": "<the quiz title, see QUIZ TITLE>", "quiz": [ ...the array of questions described above, configuration object last... ] }. The QUIZ TITLE goes in "title" of each element, not in a comment. Every rule above (QUANTITY, MODE, GLOSSARY, LANGUAGE…) applies to EACH quiz on its own.

	` : "";

	/* The question fields. A Learn is answered by TAPPING (single choice, flashcards): its list names no typed, ordered, matched or computed answer. The Test keeps the full list, unchanged. */
	const learnFields = `	- title: REQUIRED on every question: the notion it tests, as a short noun phrase of 2 to 6 words in the quiz language, shown as "Question N: <title>" above the prompt (e.g. "La requête préparée", "Le nombre de colonnes", "La SQLi en aveugle"); never a question, never the prompt repeated, never the answer, never a number such as "Question 3"
	- prompt: full question text
	- options: array of 3 to 5 options
	- correctIndex: index of the correct answer (one correct answer)
	- correctIndices: array of indices of the correct answers (several correct answers)
	- multiSelect: true when several answers are correct
	- answer: the back of a flashcard
	- explain: the explanation shown after the answer
	- hint: a nudge shown on demand — a string
`;
	const champs = learn && auto ? learnFields : `	- title: REQUIRED on every question: the notion it tests, as a short noun phrase of 2 to 6 words in the quiz language, shown as "Question N: <title>" above the prompt (e.g. "La requête préparée", "Le nombre de colonnes", "La SQLi en aveugle"); never a question, never the prompt repeated, never the answer, never a number such as "Question 3"
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

	${SANS_OUTILS_GENERATION}

${blocPreparation(preparation, learn)}${learn ? LEARN_SOURCES + LEARN_FIGURES + LEARN_HTML : ""}	THE ONLY EXCEPTION: when the user request below EXPLICITLY asks you NOT to make a quiz (for example "don't generate a quiz", "no quiz, just explain"), write no quiz at all: your first line is exactly ${NO_QUIZ_MARKER}, then answer the request in Markdown prose, in the language of the request. Never take this exception on your own: any other request, a question included, gets a quiz.

	${blocLot}${blocParties}${quantite}

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
			return { questions: inertRemoteImages(assemblerQuestionsOllama(obj)), titre: nettoyerTitre(typeof obj.title === "string" ? obj.title : "") };
		}

		if (Array.isArray(parsed)) {
			return { questions: inertRemoteImages(parsed), titre: titreEnCommentaire(cleaned) };
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
	/* No remote image survives a model's answer (2026-10-09,
	   `remote-images.ts`): every return below goes through `inertRemoteImages`. */
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
		if (lu && Array.isArray(parsed)) return { questions: inertRemoteImages(sansFauxTitres(parsed)), titre: titreEnCommentaire(cleaned) };
		/* A MISSING OPENING `[` must not cost a generation (2026-10-12): a model
		   that "resumes from slice 3" writes the question objects as a
		   comma-separated run WITHOUT the root array's opening bracket (it still
		   closes with `]`), and JSON5 then fails on the comma after the first
		   object ("invalid character ',' at …"). Re-add the bracket and retry.
		   Only PREFIXING `[` is attempted (never appending `]`): a truncated
		   answer whose last object is cut off stays malformed and is reported,
		   rather than silently accepted as a shorter quiz. */
		/* A forgotten `]` before the next field of the object: see `reparerTableauNonFerme`. */
		for (const base of [cleaned, repare]) {
			const ferme = reparerTableauNonFerme(base);
			if (ferme === base) continue;
			try {
				const v = JSON5.parse(ferme) as unknown;
				if (Array.isArray(v)) return { questions: inertRemoteImages(sansFauxTitres(v)), titre: titreEnCommentaire(cleaned) };
			} catch { /* the original error follows */ }
		}
		const enveloppe = envelopperEnTableau(cleaned) ?? envelopperEnTableau(repare);
		if (enveloppe && enveloppe.length > 0) return { questions: inertRemoteImages(sansFauxTitres(enveloppe)), titre: titreEnCommentaire(cleaned) };
		/* Un quiz MAL FORMÉ garde l'erreur du parseur : elle situe le défaut
		   (ligne, colonne), ce qu'aucune paraphrase ne ferait mieux. Une
		   réponse qui n'est pas un quiz du tout, elle, mérite qu'on dise ce
		   qu'elle est — sinon l'utilisateur reçoit « invalid character '\'
		   at 1:2 » pour une phrase en français (vécu le 2026-07-30). Le
		   discriminant est la présence de champs de question, pas le premier
		   caractère : de la prose peut commencer par « [ » (lien markdown,
		   ponctuation échappée). */
		/* The quiz may sit inside a longer answer (notes first, the array, then a closing word): see `extraireTableauQuiz`. */
		const extrait = extraireTableauQuiz(cleaned) ?? extraireTableauQuiz(content);
		if (extrait) return { questions: inertRemoteImages(sansFauxTitres(extrait)), titre: titreEnCommentaire(cleaned) };
		const looksLikeQuiz = /["']?(prompt|title|options|correctIndex|answer)["']?\s*:/.test(cleaned);
		/* The parser's position AND the start of the answer (2026-10-10): "invalid
		   character 'R' at 1:1" alone could not tell what the model had written
		   on line 1. */
		if (looksLikeQuiz) throw Object.assign(new Error(t("ai.err.malformedQuiz", { error: err instanceof Error ? err.message : String(err), preview: apercuReponse(content) })), { texteLu: cleaned, erreurBrute: err instanceof Error ? err.message : String(err) });
		throw nonQuizResponseError(content);
	}

	if (!Array.isArray(parsed)) {
		throw new Error(t("ai.err.notAnArray"));
	}

	return { questions: inertRemoteImages(sansFauxTitres(parsed)), titre: titreEnCommentaire(cleaned) };
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
/** The most quizzes "auto" may make in one answer. */
export const MAX_PARTIES = 6;

/**
 * The answer of SEVERAL QUIZZES OVER ALL THE DOCUMENTS (`GenerateOptions.parties`):
 * one element `{ part, title, quiz }` per quiz. A number asked must be met
 * exactly; "auto" accepts 1 to 10. Each quiz gets a unique key in `document`
 * (its title, or "Quiz N"), which `enregistrerLot` keys its saves by.
 */
export function parseReponseParties(content: string, parties: number | "auto"): ReponseDocument[] {
	const lu = parseReponseQuiz(content).questions;
	const elements = lu.map(el => {
		const o = el && typeof el === "object" && !Array.isArray(el) ? el as { title?: unknown; quiz?: unknown } : null;
		if (!o || !Array.isArray(o.quiz)) throw new Error(t("ai.err.lotShape"));
		return { titre: typeof o.title === "string" ? nettoyerTitre(o.title) : undefined, questions: sansFauxTitres(o.quiz) };
	});
	const attendu = parties === "auto" ? null : parties;
	if (attendu !== null ? elements.length !== attendu : elements.length < 1 || elements.length > 10) throw new Error(t("ai.err.lotCount", { expected: attendu ?? MAX_PARTIES, got: elements.length }));
	const vus = new Set<string>();
	return elements.map((el, i) => {
		if (el.questions.length === 0) throw new Error(t("ai.err.lotEmpty", { name: el.titre ?? `Quiz ${i + 1}` }));
		let cle = el.titre ?? `Quiz ${i + 1}`;
		if (vus.has(cleDocument(cle))) cle = `${cle} (${i + 1})`;
		vus.add(cleDocument(cle));
		return { document: cle, questions: el.questions, titre: el.titre };
	});
}

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
/** Tente de lire un tableau de questions auquel il manque le `[` d'ouverture
    (un modèle qui « reprend à la slice N » écrit les objets d'un seul tenant,
    séparés par des virgules, souvent avec un `]` final mais sans le crochet
    ouvrant). On n'AJOUTE qu'un `[` en tête, jamais un `]` en queue : une
    réponse tronquée en plein objet reste illisible et sera signalée plutôt
    qu'acceptée en silence comme un quiz plus court. `undefined` si rien ne se
    lit en tableau. */
function envelopperEnTableau(texte: string): unknown[] | undefined {
	const t = texte.trim();
	if (!t || t.startsWith("[")) return undefined;
	for (const cand of ["[" + texte, "[" + texte + "\n]"]) {
		try {
			const p = JSON5.parse(cand);
			if (Array.isArray(p)) return p;
		} catch { /* candidat suivant */ }
	}
	return undefined;
}

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

/**
 * An array a model forgot to close (2026-10-18): `"etapes": [ "a", "b",` then,
 * with no `]`, the next FIELD of the object (`"html": "…"`) — GLM-5.3 Flash did
 * it on a 10-question Learn, the parser stopping at "invalid character ':'".
 * Inside an array a key can only mean the array ended: the scanner (strings,
 * comments and brackets tracked, nothing else touched) writes the missing `],`
 * before it. Anything it does not recognise is left exactly as it was.
 */
export function reparerTableauNonFerme(source: string): string {
	const pile: string[] = [];
	let sortie = "";
	let i = 0;
	const n = source.length;
	let repare = false;
	while (i < n) {
		const c = source[i];
		// A value starts here: is it really a `key:` of the object the array was in?
		if (pile[pile.length - 1] === "[" && pile.length > 1 && pile[pile.length - 2] === "{" && !/\s/.test(c) && /[\s,]/.test(source[i - 1] ?? "[")
			&& /^(?:"[A-Za-z_][\w-]*"|'[A-Za-z_][\w-]*'|[A-Za-z_]\w*)\s*:/.test(source.slice(i, i + 80))) {
			sortie = sortie.replace(/,?\s*$/, "") + "\n],\n";
			pile.pop();
			repare = true;
		}
		if (c === "\"" || c === "'") {
			let j = i + 1;
			while (j < n && source[j] !== c) j += source[j] === "\\" ? 2 : 1;
			sortie += source.slice(i, j + 1);
			i = j + 1;
			continue;
		}
		if (c === "/" && source[i + 1] === "/") {
			const j = source.indexOf("\n", i);
			const fin = j < 0 ? n : j;
			sortie += source.slice(i, fin);
			i = fin;
			continue;
		}
		if (c === "/" && source[i + 1] === "*") {
			const j = source.indexOf("*/", i + 2);
			const fin = j < 0 ? n : j + 2;
			sortie += source.slice(i, fin);
			i = fin;
			continue;
		}
		if (c === "{" || c === "[") pile.push(c);
		else if (c === "}" || c === "]") pile.pop();
		sortie += c;
		i++;
	}
	return repare ? sortie : source;
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
	return new Error(t("ai.err.notQuiz", { preview: apercuReponse(text) }));
}

/** The `result` line of Claude Code: `--output-format json` (and the last
    line of `stream-json`) publish the REAL usage of the call: tokens (those
    served by the cache included) and cost in dollars. */
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
	/** The key base the call count belongs to. A generation asked AGAIN under
	    the same base (the unreadable answer asked once more) goes on counting:
	    restarting at 0 would reuse the key, and run id, of a call that already
	    ended. After a reload the client is new and counts from 0 again, which
	    is what makes the replay name the same calls. */
	let baseDuCompte: string | null = null;
	function commencerCompte(base: string | null): void {
		if (base === null || base !== baseDuCompte) appelsCli = 0;
		baseDuCompte = base;
	}
	/** The chat whose generation is running (its CLI calls are recorded in the
	    run store), the runs it made so far, and those of the last one. */
	let registreChat: string | null = null;
	let runsFaits: string[] = [];
	let derniersRuns: string[] = [];
	/** The raw stream of the last Claude Code call, read only when its answer
	    is not a quiz: a size limit may be named there and not in the answer. */
	let derniereSortieClaude = "";
	/** The folder of the running generation or plan (`GenerateOptions.dossier`):
	    Claude Code may run in it with read-only tools once it is trusted. */
	let dossierOutils: string | null = null;
	/** True while `callClaudeCodeTexte` runs an OLLAMA model (`ollamaParClaude`). */
	let viaOllama = false;
	/** `GenerateOptions.neverAskTrust` of the running generation; false for
	    every other call (a chat, a plan, the clarify call). */
	let neverAskTrust = false;
	/** May the CLI of this run get tools in `dossier`? Asks the host's trust
	    question, except for a run nobody at this PC asked for
	    (`neverAskTrust`): only a folder ALREADY trusted counts there, and an
	    untrusted one (or a failed read) throws `FolderNotTrusted`. A failure
	    to ask is "no tools", never an error. */
	async function folderTrusted(proc: NonNullable<ReturnType<typeof currentHost>["process"]>, dossier: string): Promise<boolean> {
		if (neverAskTrust) {
			let ok = false;
			try { ok = (await proc.isFolderTrusted?.(dossier)) === true; } catch (e) { console.warn("[quiz-blocks] trust read failed:", e); }
			if (!ok) throw new FolderNotTrusted(dossier);
			return true;
		}
		/* A run asked FROM THIS PC runs in its folder as in a terminal
		   (2026-10-17, "exactly as if launched in Warp"): no trust question.
		   The main process still checks the folder is one the app opened. */
		return !!proc.run;
	}
	/** The live session of the running generation or plan (`GenerateOptions.live`),
	    or of the running chat message (`ChatOptions.live`). */
	let liveCtx: LiveOptions | null = null;
	/** The short follow-up of a live chat turn (`ChatOptions.live.followUp`),
	    sent when the session already holds the conversation. Never set by a
	    generation or a plan. */
	let texteSuite: string | null = null;
	/** The correction round being asked (`lireEtCorriger`): a live session gets its note alone (it holds the conversation), a one-shot call the request, the previous answer and the note (`suiteCorrection`). */
	let correctionCourante: Correction | null = null;
	/** What a one-shot call appends to its request during a correction round. */
	function suiteCorrection(): string {
		const c = correctionCourante;
		if (!c) return "";
		return "\n\nYOUR PREVIOUS ANSWER (the app could not accept it):\n<<<\n" + c.precedent.slice(0, 150000) + "\n>>>\n\n" + c.note;
	}
	/** Runs one call of a correction loop with its round set, whatever the outcome. */
	async function avecCorrection<T>(c: Correction | null, appel: () => Promise<T>): Promise<T> {
		correctionCourante = c;
		try { return await appel(); } finally { correctionCourante = null; }
	}
	/** The round shows in the transcript as a step of the AI's own work, with the error it fixes. */
	function signalerCorrection(tour: number, max: number, erreur: string): void {
		const id = "fix-" + tour + "-" + Date.now();
		transcriptSink?.({ kind: "tool", name: t("ai.fix.step"), id, input: tour + "/" + max + " \u00b7 " + erreur.replace(/\s+/g, " ").slice(0, 160) });
		transcriptSink?.({ kind: "toolResult", id, status: "ok" });
	}

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
		/** The trusted folder of a read-only tools run (contract path). */
		dossier?: string;
		/** Claude Code on an Ollama model (the host points it at its local server). */
		ollama?: boolean;
	}): Promise<SortieCli> {
		const ac = new AbortController();
		abortCurrent = () => { aborted = true; try { ac.abort(); } catch (e) { /* déjà avorté */ } };
		/* The live transcript: the output decoded line by line as it arrives,
		   for the two CLIs that stream a format we read. */
		const sink = transcriptSink;
		const decode = sink ? createTranscriptDecoder(spec.tool) : null;
		/* The resume key of THIS call; the run id is made from it, so the
		   replay of the line after a reload names the SAME run (the CLI's
		   output is recorded once, by the call that launched it). */
		const cleAppel = repriseBase ? `${repriseBase}-${appelsCli++}` : undefined;
		const runId = cleAppel ? runIdDeCle(cleAppel) : newRunId();
		if (registreChat) runsFaits.push(runId);
		return requireHost("process").run({
			onStdout: decode && sink ? (chunk) => { for (const ev of decode(chunk)) sink(ev); } : undefined,
			tool: spec.tool,
			args: spec.args,
			stdin: spec.stdin,
			signal: ac.signal,
			marqueur: spec.marqueur,
			fichiers: spec.fichiers,
			sortieFichier: spec.sortieFichier,
			dossier: spec.dossier,
			...(spec.ollama ? { ollama: true } : {}),
			reprise: cleAppel,
			...(registreChat ? { registre: { runId, chatId: registreChat } } : {}),
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

	/** One turn of the chat's live session (`live-generation.ts`), for an
	    agent generation (a folder given, never a request from another
	    device). `null`: no live session here, or it cannot run live (root not
	    trusted, a form refused): the caller makes its one-shot call. Stop
	    interrupts the turn; the session stays. */
	async function tourVivant(tool: LiveTool, model: string, effort: string | undefined, mode: ModeAgent, texte: string, images: ImagePayload[]): Promise<TurnOutcome | null> {
		const ctx = liveCtx;
		if (!ctx || !dossierOutils || !currentHost().live) return null;
		let arreter: (() => void) | null = null;
		abortCurrent = () => { aborted = true; arreter?.(); };
		try {
			return await runLiveTurn({
				tool, chatId: ctx.chatId, key: ctx.key, model, mode, text: correctionCourante ? correctionCourante.note : (texteSuite ?? texte),
				...(texteSuite && !correctionCourante ? { freshText: texte } : {}),
				...(effort ? { effort } : {}),
				images: images.map(i => ({ mediaType: i.mediaType || "image/png", base64: i.base64 })),
				abortable: stop => { arreter = stop; if (aborted) stop(); },
			});
		} catch (e) {
			if (e instanceof LiveUnavailable) return null;
			if (aborted) throw e;
			const nom = e instanceof Error ? e.name : "";
			if (nom === "busy") throw userError(t("ai.live.busy"));
			if (nom === "exited") throw userError(t("ai.live.exited"));
			if (nom === "not-installed") throw new Error(t(tool === "claude" ? "ai.err.claudeNotInstalled" : "ai.err.codexNotInstalled"));
			const detail = (e instanceof Error ? e.message : String(e)).slice(0, 300);
			throw new Error(tool === "claude" ? t("ai.err.claudeCode", { detail }) : t("ai.err.codex", { detail }));
		}
	}

	async function generate(prompt: string, options: GenerateOptions = {}): Promise<ReponseQuiz> {
		aborted = false;
		transcriptSink = options.onTranscript ?? null;
		repriseBase = options.reprise ?? null;
		registreChat = options.chatId ?? options.live?.chatId ?? null; runsFaits = [];
		commencerCompte(repriseBase);
		dossierOutils = options.dossier ?? null;
		neverAskTrust = !!options.neverAskTrust;
		liveCtx = options.live ?? null;
		texteSuite = null;
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
			derniersRuns = runsFaits; registreChat = null;
			dossierOutils = null;
			neverAskTrust = false;
			liveCtx = null;
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
		const parties = options.parties;
		const lireBrut: LireReponse = documents && documents.length >= 2
			? (texte) => ({ questions: [], lot: parseReponseLot(texte, documents) })
			: parties === "auto" || (typeof parties === "number" && parties >= 2)
			? (texte) => ({ questions: [], lot: parseReponseParties(texte, parties) })
			: parseReponseQuiz;
		/* An unreadable answer: a size limit told in words, or the raw answer
		   kept in the host's diagnostic file (`lireOuDiagnostiquer`). */
		derniereSortieClaude = "";
		const diag = currentHost().process?.diagnosticReponse;
		const lire: LireReponse = (texte) => lireOuDiagnostiquer(
			texte,
			lireBrut,
			cliErrorText(derniereSortieClaude) + " " + (detectModelLimit("", derniereSortieClaude) === "output" ? derniereSortieClaude : ""),
			diag ? (brut) => { void diag.call(currentHost().process, brut).catch(() => { /* best effort */ }); } : undefined,
		);

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
			return avecRelances(() => callOllama(model, systemPrompt, userPrompt, ollamaUrl, authHeader, images, effort, lire), () => aborted);
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
		return lireEtCorriger({ appel: c => avecCorrection(c, () => avecRelances(() => callAntigravityTexte(model, systemPrompt, userPrompt, images), () => aborted)), lire, annule: () => aborted, surCorrection: signalerCorrection });
	}

	/** The call itself, returning the model's TEXT: a quiz for `generate`, a
	    prose answer for `chat`. */
	async function callAntigravityTexte(model: string, systemPrompt: string, userPrompt: string, images: ImagePayload[] = []): Promise<string> {
		userPrompt = userPrompt + suiteCorrection();
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
		/* AN AGENT IN THE QUIZ'S FOLDER (2026-10-17), like Claude Code and
		   Codex: once the user trusted it, with the composer's agent mode
		   (`argsAgentAntigravity`); the main process judges the folder again.
		   Otherwise `--mode plan` first: it reads and answers, never writes. */
		const mode = lireModeAgent(settings.get().aiAgentMode);
		const dossier = dossierOutils;
		// A line nobody at this PC asked for never gets Antigravity's tools (its `.agents` and MCP config load).
		const outils = dossier && !neverAskTrust ? await folderTrusted(requireHost("process"), dossier) : false;
		const fullPrompt = (outils ? consigneAvecOutils(systemPrompt, mode) : systemPrompt) + "\n\n" + userPrompt;
		/* UNE ligne : le CLI lit un événement par ligne, et `JSON.stringify`
		   échappe les sauts de ligne du prompt. */
		const entree = JSON.stringify({ event: "user", message: { content: fullPrompt } }) + "\n";

		/** La cartographie des messages, au patron d'`erreurClaude` et
		    d'`erreurCodex`. Les mots cherchés sont ceux du CLI : « Authentication
		    required » sans compte, « quota » quand le forfait est épuisé. */
		const erreurAntigravity = (e: ExecError): Error => {
			console.error("[quiz-blocks] Antigravity CLI error:", e.message, e.stderr || "");
			const detail = ((e.stderr || "") + " " + diagnosticAntigravity(e.stdout || "") + " " + e.message).toLowerCase();
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
				args: outils
					? ["--input-format", "stream-json", "--output-format", "stream-json", ...(model ? ["--model", model] : []), ...argsAgentAntigravity(mode)]
					: [...ARGS_AGY_SANS_OUTILS, "--input-format", "stream-json", "--output-format", "stream-json", ...(model ? ["--model", model] : [])],
				marqueur,
				stdin: entree,
				fichiers: [],
				...(outils && dossier ? { dossier } : {}),
			});
		} catch (err) {
			/* Une ANNULATION n'est pas une erreur (voir `callClaudeCode`). */
			if (aborted) throw err;
			throw erreurIndisponible(err) || erreurAntigravity(execErrorDepuisRejet(err));
		}
		if (res.code !== 0) throw erreurAntigravity(execErrorDepuisCode(res));

		const resultat = lireResultatAntigravity(res.stdout);
		if (resultat.erreur) {
			const e = erreurAntigravity({ message: resultat.erreur, stdout: res.stdout, stderr: res.stderr } as ExecError);
			// The CLI lost its connection mid-run: asked again by the caller (`avecRelances`), not shown.
			throw estTransitoire(resultat.erreur) ? new TransientCliError(e.message) : e;
		}
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
		return lireEtCorriger({ appel: c => avecCorrection(c, () => callClaudeCodeTexte(model, systemPrompt, userPrompt, images)), lire, annule: () => aborted, surCorrection: signalerCorrection });
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
		userPrompt = userPrompt + suiteCorrection();
		if (!currentHost().platform.isDesktopApp) {
			throw new Error(t("ai.hint.claudeDesktopOnly"));
		}
		if (!/^[a-zA-Z0-9._:-]+$/.test(model)) {
			throw new Error(t("ai.err.invalidModelClaude", { model }));
		}

		/* Pictures: the HOST writes them to temporary files (and deletes them),
		   and replaces the token of the N-th one with its absolute path, here
		   in the PROMPT, which Claude then reads with the Read tool
		   (multimodal, read-only). The MARKER is drawn at random for THIS call:
		   the prompt holds the user's request and the content of their notes,
		   and a fixed form would have collided there (see `src/host/jetons.ts`).
		   Without a picture, `--tools` gets an EMPTY string: a really empty
		   argument, not the two characters `""`; under `cp.exec` the shell
		   stripped the quotes of `--tools ""`, and the CLI refuses the literal
		   pair (measured: `Invalid setting source: ""`). */
		const marqueur = nouveauMarqueur();
		const fichiers = piecesJointes(images);
		// Instruction au MODÈLE (pas de l'UI) → anglais, comme le prompt
		// système ; la langue du quiz reste celle de la demande.
		const imageNote = fichiers.length > 0
			? "\n\n" + imageInstruction + "\n" +
				fichiers.map((_, i) => "- " + jetonFichier(marqueur, i + 1)).join("\n")
			: "";

		const mode = lireModeAgent(settings.get().aiAgentMode);
		/* A LIVE SESSION (2026-10-11): an agent generation of the Generate
		   page is a turn of the chat's Claude Code session, in the Neo Quiz
		   root; the pictures go with the message itself. `null`: it cannot
		   run live, the one-shot call below runs instead. */
		// An Ollama model never runs live: the chat's session is the claude.ai account's.
		const vivant = viaOllama ? null : await tourVivant("claude", model, effort ?? undefined, mode, consigneAvecOutils(systemPrompt, mode) + "\n\n" + userPrompt, images);
		if (vivant) {
			derniereSortieClaude = vivant.claudeResult ? JSON.stringify(vivant.claudeResult) : "";
			return lireResultatClaude(vivant.claudeResult as ClaudeResult | null, model);
		}

		/* READ-ONLY TOOLS IN THE QUIZ'S FOLDER (2026-10-09), only once the
		   user trusted it in the host's native dialog. The page never decides
		   it alone: the main process judges the folder again before running
		   anything there. Any failure to ask is "no tools", never an error. */
		const dossier = dossierOutils;
		let outils = false;
		const proc = requireHost("process");
		if (dossier) outils = await folderTrusted(proc, dossier);
		// Claude Code on an Ollama model only ever runs as an agent (`ollamaParClaude`).
		if (viaOllama && !outils) throw new Error(t("ai.err.ollamaNeedsFolder"));
		/* Pictures without a trusted folder (2026-10-09): Read only, with the
		   same confinement as the tools form; the main process runs it IN the
		   attachments folder. Without a picture, no tool at all. */
		const argsSansOutils = [
			"-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", model,
			...(effort ? ["--effort", effort] : []),
			...(fichiers.length > 0
				? ARGS_IMAGES_CLAUDE
				: ["--tools", "", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config"]),
		];
		const argsOutils = [
			"-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", model,
			...(effort ? ["--effort", effort] : []),
			// A line nobody at this PC asked for keeps the confined read-only form.
			...(neverAskTrust ? ARGS_OUTILS_CLAUDE : argsAgentClaude(mode)),
			// The pictures live in the host's temporary folder: the only other folder readable.
			...(fichiers.length > 0 ? ["--add-dir", jetonPieces(marqueur)] : []),
		];

		const promptDe = (avecOutils: boolean): string =>
			(avecOutils ? consigneAvecOutils(systemPrompt, mode) : systemPrompt) + "\n\n" + userPrompt + imageNote;

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
			/* A usage limit is told apart BEFORE the generic failure: the queue pauses the line until the window resets.
			   Never read in raw stdout (the MODEL's output): only its structured error events (`cliErrorText`). */
			const limite = detectUsageLimit((e.stderr || "") + " " + cliErrorText(e.stdout || "") + " " + e.message, Date.now());
			if (limite) return new UsageLimitError("claude", limite.resetAt, t("ai.err.claudeRateLimit"));
			const taille = detectModelLimit((e.stderr || "") + " " + cliErrorText(e.stdout || "") + " " + e.message);
			if (taille) return new Error(t(taille === "output" ? "ai.err.outputLimit" : "ai.err.contextLimit"));
			if (detail.includes("login") || detail.includes("api key") || detail.includes("authentication") || detail.includes("credential")) {
				return erreurConnexion("claude", t("ai.err.claudeNotLoggedIn"));
			}
			return new Error(t("ai.err.claudeCode", { detail: (e.stderr || e.message).trim().slice(0, 300) }));
		};

		let res: SortieCli;
		try {
			/* A STREAM (2026-09-29): the text arrives as it is written, for
			   the live transcript; the last line, `result`, is the object
			   `--output-format json` used to print (`claudeResultDuFlux`). */
			const lancer = (avecOutils: boolean): Promise<SortieCli> => runCli({
				tool: "claude",
				args: avecOutils ? argsOutils : argsSansOutils,
				marqueur,
				stdin: promptDe(avecOutils),
				fichiers,
				dossier: avecOutils && dossier ? dossier : undefined,
				...(viaOllama ? { ollama: true } : {}),
			});
			res = await lancer(outils);
			/* A Claude Code older than the options of the tools form says it
			   does not know one: the same call without tools, as before. */
			if (outils && !viaOllama && res.code !== 0 && optionInconnue(res.stderr) && !aborted) {
				console.warn("[quiz-blocks] Claude Code does not know the read-only tools options, running without tools:", res.stderr.trim().slice(0, 200));
				res = await lancer(false);
			}
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
		derniereSortieClaude = stdout;
		return lireResultatClaude(claudeResultDuFlux(stdout) as ClaudeResult | null, model);
	}

	/** The `result` line of a Claude Code run (one-shot stream or live turn):
	    its usage, its error mapped to the user's words, or its text. */
	function lireResultatClaude(data: ClaudeResult | null, model: string): string {
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
			const limite = detectUsageLimit(msg, Date.now());
			if (limite) throw new UsageLimitError("claude", limite.resetAt, t("ai.err.claudeRateLimit"));
			const taille = detectModelLimit(msg);
			if (taille) throw new Error(t(taille === "output" ? "ai.err.outputLimit" : "ai.err.contextLimit"));
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
		return lireEtCorriger({ appel: c => avecCorrection(c, () => callCodexTexte(model, systemPrompt, userPrompt, images, effort, fast)), lire, annule: () => aborted, surCorrection: signalerCorrection });
	}

	/** The call itself, returning the model's TEXT (see `callClaudeCodeTexte`). */
	async function callCodexTexte(model: string, systemPrompt: string, userPrompt: string, images: ImagePayload[] = [], effort = "medium", fast = false): Promise<string> {
		userPrompt = userPrompt + suiteCorrection();
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
		/* AN AGENT IN THE QUIZ'S FOLDER (2026-10-10), as Claude Code: once the
		   user trusted the folder in the host's native dialog, Codex runs IN
		   it with the sandbox of the chosen mode; the main process judges the
		   folder again. Otherwise the old read-only call in the home folder. */
		const dossier = dossierOutils;
		const mode = lireModeAgent(settings.get().aiAgentMode);
		/* A LIVE SESSION (2026-10-11), as for Claude Code: a turn of the
		   chat's Codex session (`codex app-server`) in the Neo Quiz root; its
		   answer is the turn's last agent message, as `-o` held it. */
		const vivant = await tourVivant("codex", model, effortVal, mode, consigneAvecOutils(systemPrompt, mode) + "\n\n" + userPrompt, images);
		if (vivant) {
			if (vivant.codexError) {
				const limite = detectUsageLimit(vivant.codexError, Date.now());
				if (limite) throw new UsageLimitError("codex", limite.resetAt, t("ai.err.codexRateLimit"));
				throw new Error(t("ai.err.codex", { detail: vivant.codexError.trim().slice(0, 300) }));
			}
			if (!vivant.codexText.trim()) throw new Error(t("ai.err.codexEmpty"));
			return vivant.codexText;
		}
		let agent = false;
		const proc = requireHost("process");
		if (dossier) agent = await folderTrusted(proc, dossier);
		const args = [
			"exec", "--json", "-m", model,
			"-c", "model_reasoning_effort=" + effortVal,
			// Fast (1.5x speed, more usage) : service tier « priority » — la
			// valeur vient de models_cache.json (service_tiers[].id).
			...(fast ? ["-c", "service_tier=priority"] : []),
			...(agent
				// The user's own Codex config, as in a terminal; never for a line nobody at this PC asked for.
				? [...argsAgentCodex(mode), "--skip-git-repo-check", ...(neverAskTrust ? ["--ignore-user-config"] : [])]
				: ["-s", "read-only", "--skip-git-repo-check", "--ignore-user-config", "-C", jetonHome(marqueur)]),
			"-o", jetonSortie(marqueur),
			...fichiers.flatMap((_, i) => ["-i", jetonFichier(marqueur, i + 1)]),
		];
		const promptAgent = agent ? consigneAvecOutils(systemPrompt, mode) + "\n\n" + userPrompt : fullPrompt;

		/** La cartographie des messages, INCHANGÉE (voir `erreurClaude`). */
		const erreurCodex = (e: ExecError): Error => {
			console.error("[quiz-blocks] Codex error:", e.message, e.stderr || "");
			const detail = ((e.stderr || "") + " " + (e.stdout || "") + " " + e.message).toLowerCase();
			if (e.code === "ENOENT" || e.code === 127 || detail.includes("not recognized") || detail.includes("introuvable") || detail.includes("command not found")) {
				return new Error(t("ai.err.codexNotInstalled"));
			}
			const limite = detectUsageLimit((e.stderr || "") + " " + cliErrorText(e.stdout || "") + " " + e.message, Date.now());
			if (limite) return new UsageLimitError("codex", limite.resetAt, t("ai.err.codexRateLimit"));
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
			res = await runCli({ tool: "codex", marqueur, args, stdin: promptAgent, fichiers, sortieFichier: CODEX_FICHIER_SORTIE, dossier: agent && dossier ? dossier : undefined });
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

	/** CLAUDE CODE AS OLLAMA'S AGENT (2026-10-17, the owner's choice): in a
	    trusted folder, the Ollama model runs INSIDE Claude Code, as
	    `ollama launch claude` does, with Claude Code's tools and the composer's
	    agent mode; the host points Claude Code at its LOCAL Ollama server
	    (`ollama: true`, judged again by the main process). `null`: no folder,
	    not trusted, Ollama not on this PC or Claude Code missing — the plain
	    HTTP call then runs, without tools, as before. */
	async function ollamaParClaude(model: string, systemPrompt: string, userPrompt: string, images: ImagePayload[], imageInstruction?: string): Promise<string | null> {
		const proc = currentHost().process;
		if (!currentHost().platform.isDesktopApp || !proc || !dossierOutils) return null;
		const url = (settings.get().aiOllamaUrl || "http://localhost:11434").trim();
		if (!/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?\/?$/.test(url)) return null;
		if (!/^[a-zA-Z0-9._:-]+$/.test(model)) return null;
		if (!(await folderTrusted(proc, dossierOutils))) return null;
		viaOllama = true;
		try {
			return await callClaudeCodeTexte(model, systemPrompt, userPrompt, images, null, imageInstruction);
		} catch (e) {
			// Claude Code is not installed: the call without tools, rather than no answer.
			if (!aborted && e instanceof Error && e.message === t("ai.err.claudeNotInstalled")) return null;
			throw e;
		} finally {
			viaOllama = false;
		}
	}

	async function callOllama(model: string, systemPrompt: string, userPrompt: string, ollamaUrl?: string, authHeaders?: Record<string, string>, images: ImagePayload[] = [], effort: string | null = null, lire: LireReponse = parseReponseQuiz): Promise<ReponseQuiz> {
		/* As an agent in a trusted folder (Claude Code on the Ollama server) or by the API: decided at the first call, kept for the correction rounds. */
		let viaAgent: boolean | null = null;
		return lireEtCorriger({
			appel: c => avecCorrection(c, async () => {
				if (viaAgent !== false) {
					const agent = await ollamaParClaude(model, systemPrompt, userPrompt, images);
					if (agent !== null) { viaAgent = true; return agent; }
					viaAgent = false;
				}
				return await callOllamaTexte(model, systemPrompt, userPrompt, ollamaUrl, authHeaders, images, effort, true);
			}),
			lire: texte => (viaAgent ? lire(texte) : parseOllamaResponse(texte)),
			annule: () => aborted,
			surCorrection: signalerCorrection,
		});
	}

	/** The call itself, returning the model's TEXT. `quizSchema` constrains the
	    answer to the quiz JSON schema (generation); `chat` passes false and gets
	    free prose. */
	async function callOllamaTexte(model: string, systemPrompt: string, userPrompt: string, ollamaUrl?: string, authHeaders?: Record<string, string>, images: ImagePayload[] = [], effort: string | null = null, quizSchema = false): Promise<string> {
		userPrompt = userPrompt + suiteCorrection();
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
			// A server that restarts or drops a connection is asked again by the caller (`avecRelances`); the message is the one the learner reads if it stays down.
			throw Object.assign(new TransientCliError(t("ai.err.ollamaUnreachable", { url: ollamaUrl })), { userFacing: true });
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
						required: ["title", "questions"]
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
	   model; the answer follows the language of the conversation. Its "no
	   tools" sentence (`CHAT_NO_TOOLS`) becomes the tools note in a trusted
	   folder (`remplacementsOutils`). */
	const CHAT_SYSTEM = [
		"You are a patient tutor inside Neo Quiz, a revision app. The learner is studying for an exam and asks you questions about their course, a quiz question, or anything they did not understand.",
		"Answer in the language the learner writes in; in French, ALWAYS address the learner as « tu » (tu, ton, ta, tes), never « vous ». Be clear and concrete: start with the direct answer, then explain WHY and HOW (the reason behind a fact is what makes it stick), ground every abstract idea in a concrete example, and when a procedure is involved work one example through step by step. When you use an analogy, say where it stops holding. Do not pad: precise beats long. When it helps the learner, end with one short question that lets them check their own understanding, without giving its answer. Use Markdown (short paragraphs, lists, **bold** for the key idea, fenced code blocks naming their language for any code, $…$ for math).",
		CHAT_NO_TOOLS,
	].join("\n\n");

	/** THE PLAN OF AN EXAM PREPARATION (2026-09-30): the model reads EVERY
	    document at once, then chooses the quizzes that will cover everything
	    that can come up — their number, their order, what each covers.
	    `typeImpose`: the Learn | Test selector, which the plan follows. */
	async function planifier(demande: string, documents: string, typeImpose: "learn" | "practice" | undefined, options: { onTranscript?: (event: TranscriptEvent) => void; reprise?: string; dossier?: string; live?: LiveOptions; chatId?: string } = {}): Promise<EtapePlan[]> {
		aborted = false;
		pendingUsage = null;
		transcriptSink = options.onTranscript ?? null;
		repriseBase = options.reprise ?? null;
		registreChat = options.chatId ?? options.live?.chatId ?? null; runsFaits = [];
		dossierOutils = options.dossier ?? null;
		neverAskTrust = false;
		liveCtx = options.live ?? null;
		texteSuite = null;
		commencerCompte(repriseBase);
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
			derniersRuns = runsFaits; registreChat = null;
			dossierOutils = null;
			neverAskTrust = false;
			liveCtx = null;
		}
	}

	/** The clarify call of "Generate": same provider as the generation, same
	    call forms (no tool, no new option), the LOWEST effort the provider
	    offers, and 30 s at most. */
	async function clarify(request: string, documentNames: readonly string[], folders?: ClarifyFolders): Promise<string> {
		const { system, user } = clarifyPrompt(request, documentNames, currentLang(), folders);
		return appelCourt(system, user);
	}

	/** The short call that sorts ambiguous Moodle file names: names only, never a tool. */
	async function classifyLectures(names: readonly string[]): Promise<string> {
		const { system, user } = lectureClassifyPrompt(names);
		return appelCourt(system, user);
	}

	/** A short call without tools: same provider as the generation, the lowest effort it offers, 30 s at most. */
	async function appelCourt(system: string, user: string): Promise<string> {
		aborted = false;
		pendingUsage = null;
		transcriptSink = null;
		// The clarify call never gets tools: request and document names only.
		dossierOutils = null;
		neverAskTrust = false;
		liveCtx = null;
		repriseBase = null;
		registreChat = null;
		await refreshCliCaches();
		const limite = window.setTimeout(() => { if (abortCurrent) abortCurrent(); }, DECIDE_TIMEOUT_MS);
		try {
			const provider = settings.get().aiProvider || "";
			let model = settings.get().aiModel || (provider ? getProvider(provider).defaultModel : "");
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

	/** A command of Claude Code, sent as typed to the chat's live session. */
	async function commandeClaude(provider: string, model: string, texte: string): Promise<string> {
		if (provider !== "claude-code") throw userError(t("ai.commands.needsLive"));
		const effort = effortClaude();
		const vivant = await tourVivant("claude", model, effort ?? undefined, lireModeAgent(settings.get().aiAgentMode), texte, []);
		if (!vivant) throw userError(t("ai.commands.needsLive"));
		const r = vivant.claudeResult as ClaudeResult | null;
		// A command may print nothing (a setting changed): not an error.
		if (r && !r.is_error && !(r.result || "").trim()) return t("ai.commands.noOutput");
		return lireResultatClaude(r, model).trim();
	}

	async function chat(history: ChatTurn[], options: ChatOptions = {}): Promise<string> {
		aborted = false;
		pendingUsage = null;
		transcriptSink = options.onTranscript ?? null;
		/* The quiz's folder (2026-10-14): Claude Code and Codex answer as the
		   generation runs, as agents IN it once it is trusted, with the agent
		   mode of the composer; no folder, or not trusted, the call without
		   tools (the pictures only). One live turn per message when the queue
		   gives `live`; otherwise one call per message. */
		dossierOutils = options.dossier ?? null;
		neverAskTrust = false;
		liveCtx = options.live ? { chatId: options.live.chatId, key: options.live.key } : null;
		texteSuite = options.live?.followUp || null;
		try {
			// Inside the `try`: should it throw, `finally` still resets the live state above.
			repriseBase = options.reprise ?? null;
			registreChat = options.chatId ?? null; runsFaits = [];
			commencerCompte(repriseBase);
			await refreshCliCaches();
			const provider = settings.get().aiProvider || "";
			let model = settings.get().aiModel || (provider ? getProvider(provider).defaultModel : "");
			const turns = history.filter(h => h.text.trim());
			const last = turns[turns.length - 1];
			if (!last || last.role !== "user") throw new Error(t("ai.chat.empty"));
			if (options.raw) return await commandeClaude(provider, provider === "claude-code" ? resolveClaudeModel(model) : model, last.text.trim());
			const earlier = turns.slice(0, -1).map(h => (h.role === "user" ? "LEARNER" : "TUTOR") + ":\n" + h.text.trim()).join("\n\n");
			const userPrompt = [
				options.context?.trim() ? "CONTEXT (quiz and course material):\n" + options.context.trim() : "",
				earlier ? "CONVERSATION SO FAR:\n" + earlier : "",
				"LEARNER'S NEW MESSAGE:\n" + last.text.trim(),
			].filter(Boolean).join("\n\n---\n\n");
			const systeme = [
				(options.images?.length ? CHAT_SYSTEM.replace(CHAT_NO_TOOLS, CHAT_PICTURES) : CHAT_SYSTEM),
				options.style === "explain" ? "The learner is studying the quiz below. When their position on it is known, it is given at the END of their message (\"WHERE THE LEARNER IS NOW\"): \"this question\", \"the answer\", \"explain it to me\" and the like refer to that question unless the learner says otherwise; without it, ask which question they mean when it is not clear. Answer what they ask, using the quiz and the course; when they ask for an explanation, assume they know nothing and build it step by step (define every term the first time, say what each wrong choice gets wrong, use a concrete everyday example)." : "",
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
				const agent = await ollamaParClaude(model, systeme, userPrompt, options.images ?? [], "The course's pictures (figures, diagrams). Read them with the Read tool when the question needs them:");
				if (agent !== null) return agent.trim();
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
				const e = new Error("Chat cancelled") as Error & { aborted?: boolean };
				e.aborted = true;
				throw e;
			}
			throw err;
		} finally {
			abortCurrent = null;
			transcriptSink = null;
			dossierOutils = null;
			neverAskTrust = false;
			liveCtx = null;
			texteSuite = null;
			repriseBase = null;
			derniersRuns = runsFaits; registreChat = null;
		}
	}

	return {
		generate,
		chat,
		clarify,
		classifyLectures,
		planifier,
		abort: () => { if (abortCurrent) abortCurrent(); },
		get lastUsage() { return lastUsage; },
		get lastRuns() { return derniersRuns; }
	};
}
