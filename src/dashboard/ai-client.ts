import JSON5 from "json5";
import { currentHost, requireHost } from "../host/current";
import { jetonFichier, jetonHome, jetonSortie, nouveauMarqueur } from "../host/jetons";
import {
	resolveClaudeModel,
	resolveCodexModel, resolveAntigravityModel, antigravityModelId, niveauAntigravity, resolveOllamaSelection,
	resolveEffort,
	getCodexModels,
	getProvider,
	isOllamaCloudModel,
	refreshCliCaches,
	erreurOllamaHorsPlan,
} from "./ai-providers";
import type { AiSettingsHost } from "./ai-settings-host";
import type { AiUsage } from "./usage-format";
import { t } from "../i18n";
import type { ModeGeneration } from "../quiz-format";
import type { CategorieQuiz } from "./categorie-quiz";
import { complementCategorie } from "./categorie-prompt";

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

/* Délai avant abandon d'un CLI. 3 min ne suffisaient pas : un modèle à
   raisonnement, nourri de plusieurs notes jointes (~20 k tokens d'entrée) et
   qui doit produire des questions avec leçon et explication, dépasse
   couramment les 7 min — mesuré le 2026-07-31 sur le projet TOBEADMIN, où la
   génération partait à la poubelle alors qu'elle se serait terminée. La
   valeur est UNE constante, injectée dans le message d'erreur : le texte ne
   peut plus mentir sur la durée réellement appliquée. */
const CLI_TIMEOUT_MS = 900000;
const CLI_TIMEOUT_MIN = String(Math.round(CLI_TIMEOUT_MS / 60000));

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
	type?: string;
	source?: string;
	images?: ImagePayload[];
	/** Absent: Test (`"practice"`), like a block without a mode object. */
	mode?: ModeGeneration;
	/** Practice only: the slices of the Learn of the same source, to set
	    `slice` (spec §2). Ignored in Learn. */
	planTranches?: { slice: number; titre: string }[];
	/** La catégorie du quiz (categorie-quiz.ts), figée à l'envoi : son
	    complément s'ajoute au prompt système. Absente ou `general` : rien. */
	categorie?: CategorieQuiz;
}

/** Une réponse LUE : les questions, et le titre que le modèle a choisi
    pour le quiz (`// title:` en tête du tableau ; `title` de l'objet pour
    Ollama). `titre` absent quand le modèle n'en a pas donné : le nom du
    fichier retombe alors sur la demande. */
export interface ReponseQuiz {
	questions: unknown[];
	titre?: string;
}

/** Client IA — retour de createAiClient(plugin). */
export interface AiClient {
	generate(prompt: string, options?: GenerateOptions): Promise<ReponseQuiz>;
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
export function composerPrompts(prompt: string, options: GenerateOptions = {}): { systemPrompt: string; userPrompt: string } {
	const { count = null, type = "Mixte", source = "topic", mode = "practice", planTranches, categorie } = options;
	const learn = mode === "learn";

	// « Mixte » est la valeur canonique d'« Auto » : le mode choisit le mélange.
	const typeInstruction = type === "Mixte"
		? (learn
			? "the question types each role above calls for"
			: "the mix of question types that best fits a written exam on this subject: single choice, multiple choice, free text, numeric, ordering, matching, code output")
		: type === "Choix unique"
		? "single-choice questions (exactly one correct answer)"
		: type === "Choix multiple"
		? "multiple-choice questions (several correct answers)"
		: type === "Compréhension"
		? `COMPREHENSION questions, ALL of them based on ONE source document that you write yourself.
	Write a substantial passage (250-450 words: an article extract, a case study, a scenario, a piece of code — whatever suits the topic) and put it in the "passage" field of the FIRST question, together with "passageId": "doc1" and a "passageTitle" naming the document.
	EVERY other question repeats ONLY "passageId": "doc1" (no "passage", no "passageTitle" — the engine shares the document automatically).
	The questions must be ANSWERABLE FROM THE DOCUMENT ALONE and test understanding — main idea, inference, meaning in context, cause and effect, the author's intent, what can or cannot be concluded — NOT recall of outside knowledge. Mix single-choice, multiple-choice and free-text among them`
		: "free-text questions";

	const quantite = count != null
		? `QUANTITY: generate exactly ${count} questions — this number wins over any other count, range or list of themes stated in the user request below. If the request asks for more themes than ${count} questions, cover the most important ones; never exceed ${count}.`
		: learn
		? "QUANTITY: at most 20 questions in total, every role counted — usually 2 or 3 slices. Cover what can be examined on the source, the most important first; go beyond 20 ONLY if the source truly cannot be learned in fewer, and never pad with trivia. A learner who sees 50 questions gives up before starting."
		: "QUANTITY: between 10 and 20 questions, chosen by you from the source: ONLY what can be examined, the most important first. Never pad with trivia.";

	const blocMode = learn ? `MODE: LEARN. You are writing a guided LEARNING PATH through the source — not a test, and not a summary to read.
	Split the source into SLICES, numbered from 1 in "slice", each small enough for ONE screen of reading. Every slice contains, in this order:
	  1. one or two questions with "role": "pre", asked BEFORE the reading on what the slice is about to teach. The learner is expected to fail: keep them short (single choice preferred) and give "explain". EVERY pre question also has "hint": a clue that lets someone who has NOT read the slice yet reason toward the answer (the principle to apply, an analogy, what a key word means) — never the answer itself. Answering blind with no help at all is discouraging.
	  2. exactly one card with "role": "read": "title" names the slice and "prompt" holds the passage — the slice's content REPHRASED clearly in at most about 150 words, keeping the teacher's technical terms EXACTLY as in the source. When the slice lists arbitrary items (layers, steps, keywords), add a mnemonic. A read card has no options and no answer. For a PROCEDURAL slice (code, method, calculation), the read card is a fully WORKED EXAMPLE, correct, step by step. Every idiom or compact line of a reading is explained IN FULL, the way a good tutor does: the compact form, its result, then the developed equivalent (for example \`[2 * i for i in range(4)]\` gives \`[0, 2, 4, 6]\`, the same as a \`for\` loop that calls \`append\` on an empty list); never leave a compact line unexplained.
	  READING STYLE: CHOOSE for each read card, from its content, the "lecture" style that fits it best. VARY the style between slices according to what each one teaches, and NEVER take "page" by default:
	    - "lecture": "etapes" for ONE IDEA PER LINE: a procedure, ideas that follow one another, a list of rules. "etapes" lists them in order, one short step per string, and "prompt" is a one-sentence introduction. Example: { "lecture": "etapes", "prompt": "Create and activate a virtual environment.", "etapes": ["Go to the project folder.", "Run \`python -m venv .venv\`.", "Activate it before installing anything."] };
	    - "lecture": "tableau" to COMPARE two or three things on several criteria, for example Python and C: "tableau" is { "colonnes": ["", "Python", "C"], "lignes": [["Execution", "Interpreted", "Compiled"], ["Typing", "Dynamic", "Static"]] }, every row as long as "colonnes", the first cell naming the criterion, and "prompt" is a one-sentence introduction;
	    - "lecture": "page" ONLY for a CONTINUOUS text that explains itself in one block (a reasoning, a story, a definition developed in prose). Example: { "lecture": "page", "prompt": "Python is interpreted: the interpreter runs the .py file directly…" }.
	    Every reading is its own screen, placed after the pre questions of its slice, EXCEPT "etapes" readings that are either SHORT (a few lines: at most about 60 words and 4 steps) or a METHOD to apply in the question that follows, even long: for a method set "methode": true on the read card (for example a calculation procedure the next question asks to carry out). Such readings are shown open above that question instead. When a slice fits in a few lines of steps, you may write such a short reading.
	  KEY POINTS: a read card may add "retenir", what to keep from it: { "forme": "cartes", "items": [{ "recto": "term", "verso": "its meaning in a few words" }, ...] } for TERMS to memorize (flip cards), or { "forme": "recap", "items": ["fact to keep", ...] } for FACTS to keep (a checked recap); 2 to 5 items, never a copy of a later question's answer. Omit "retenir" when it adds nothing.
	  3. exactly one question with "role": "explain" and "type": "text": ask the learner to explain the slice's key idea in their own words (why, how, a relation, an example). "answer" holds a MODEL ANSWER of 2 to 4 sentences.
	  4. two to four questions with "role": "recall": retrieval from memory of what the slice taught, each with "explain". For a procedural slice use: a "cloze" with the missing step, a text question predicting the OUTPUT of a code snippet ("terminalVariant": "python"), an "ordering" question rebuilding the lines of the code, a single-choice "find the bug". A recall can also be a FLASHCARD: set "flashcard": true, put the question in "prompt" (front) and the expected answer in "answer" (back), add "explain"; no "options", no "type". Use a flashcard ONLY when the answer fits in one sentence, one formula or one line of code (a definition, a syntax, the output of a short expression), never for a question that needs reasoning or several lines, and for at most half of the recalls of a slice. A slice that introduces TERMS, DEFINITIONS or FACTS to memorize has AT LEAST ONE flashcard among its recalls.
	HINTS IN LEARN: EVERY question of the path has "hint" — pre, explain and recall alike; only the read cards and the flashcards have none.
	A "read" passage NEVER contains the exact sentence that a later question of the same slice asks for: recall must be retrieval, not copying. Do not ask to "justify your answer" everywhere.
	"topic": optional short label of a family of notions that are easily confused, shared by the questions that test it.
	The LAST element of the array is the configuration object, with no prompt field: { mode: "learn", "objectives": ["...", "..."], "glossary": [{ "term": "...", "definition": "..." }, ...] } — 3 to 6 learning objectives of the source, each starting with a verb, and the glossary described under GLOSSARY below.`
	: `MODE: PRACTICE. You are writing an exam-preparation bank on the source, in the FORMAT OF A UNIVERSITY EXAM on it.
	Write APPLICATION questions (use a notion in a new case), DISCRIMINATION questions (tell apart two notions that are easily confused) and MULTI-STEP PROBLEMS — not definitions to recite. Calibrate the difficulty UP: a question a student answers without having studied is useless.
	EVERY question has "explain": why the right answer is right AND, for EACH wrong option, one short sentence saying why it is wrong.
	"hint": optional — add one when a question deserves it (see HINTS below), and leave it out otherwise.
	"topic": a short label of the family of notions the question tests; questions on notions that are easily confused share the same "topic".
	"slice": when a SLICE PLAN of the learning path is given in the request, the number of the slice that teaches what the question tests; otherwise omit it.
	The LAST element of the array is a configuration object, with no prompt field: { mode: "quiz", "glossary": [{ "term": "...", "definition": "..." }, ...] } — the glossary described under GLOSSARY below.`;

	/* Le complément de la CATÉGORIE (retour #7) : une section de plus, entre
	   les consignes du mode et le titre ; rien pour `general`. */
	const complement = complementCategorie(categorie);
	const categorieBloc = complement ? `\n\t${complement}\n` : "";

	/* The text fields the code and markdown rules apply to. */
	const textFields = "prompt, options, explain, hint, answer";
	const hintFields = `	- hint: a nudge shown on demand — a string, or for a DIFFICULT question an array of 2 or 3 levels (see HINTS below)
	- runInLastHint: true ONLY on a DIFFICULT question whose prompt holds a python, c or cpp code block and whose "hint" has 2 or 3 levels, when running that program helps without answering in the learner's place (find the bug, choose the fix, explain a behaviour): once the last hint level is revealed, the learner may run it. NEVER on a question asking what a program prints (its answer IS the output), never on an easy question.
`;
	const hintsBlock = `
	HINTS: a "hint" helps without giving the answer away. The learner can open it BEFORE any attempt, from a button under the question: never write it as if an answer had already been given ("you got it wrong", "try again"). Write it as a string, or, for a DIFFICULT question, as an array of 2 or 3 strings from the lightest clue to the most revealing one — the learner reveals them one by one. Put the KEY WORDS of every hint in **bold** (the reader colors them). Every hint gives a CONCRETE, DETAILED example, e.g. "like \`range(1, 3)\`, which gives \`[1, 2]\`". When the answer is written in the reading of the slice, the first level may send the learner back to it ("reread the paragraph on …").
`;

	const systemPrompt = `You are a quiz generator. Generate the quiz questions as a JSON5 array. Each question may have:
	- title: short question title
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
	- passage / passageId / passageTitle: a SOURCE DOCUMENT to read before answering (comprehension). "passage" holds the full text, "passageTitle" names it, and "passageId" is a shared key: every question carrying the SAME passageId shows the SAME document, so write the text ONCE on the first question of the group and give the others only their passageId

	${blocMode}
${hintsBlock}
	EXPLANATIONS: in every "explain", put the two or three KEY WORDS in **bold** — no more; the reader colors them.

	GLOSSARY: the configuration object at the end of the array (see above) carries a "glossary" of 5 to 15 KEY TERMS of the source — the technical notions a student must know, never everyday words. Each entry is { "term": "...", "definition": "..." }, plus an optional "aliases": ["..."] for another form of the SAME term used in the text (an acronym, an abbreviation, e.g. "LIFO" for "stack"). Write "term" EXACTLY as it appears in the readings and explanations — same spelling, same form; a term written differently is never matched and never underlined. Write "term" in PLAIN TEXT, NEVER between backticks, even for a keyword or a function of the language: the bare name is the term (e.g. "yield", not \`yield\`) — it is still recognized wherever that name appears inside inline \`code\`. "definition" is ONE OR TWO SENTENCES in markdown (**bold**, \`code\`, a $formula$), understandable on its own WITHOUT the course, and NEVER a copy of a question's answer or explanation. No duplicate term, no filler word.
${categorieBloc}
	QUIZ TITLE: the very first line of the array, right after the opening bracket, is a JSON5 line comment giving the quiz a name: '// title: <name>'. The name is what a student would write on the cover: 3 to 8 words naming its subject and scope (e.g. "Python : types, listes et exceptions"), in the language of the content, WITHOUT the word "quiz" and without a trailing period. Exactly one such line, nowhere else.

	LANGUAGE — THIS IS A HARD RULE: write ALL the content you produce (title, prompt, options, answer, explain, hint, objectives, glossary) in THE SAME LANGUAGE AS THE USER REQUEST BELOW. If the request is in French, write the quiz in French; in Arabic, in Arabic; in English, in English. When the request provides source material (a text, a note, images), follow the language of that material. NEVER translate the content into English just because these instructions are in English. The FIELD NAMES (title, prompt, options…) and the JSON5 structure always stay exactly as specified above, in English. Keep the technical terms of the source exactly as the source writes them.

	CODE: every piece of code written inside a sentence — an identifier, a keyword, a command, an option, a file name, a path, an expression — goes between backticks in EVERY text field (${textFields}): \`__init__\`, \`find /var/log -name '*.log'\`, \`i ** 2\`. Without them, \`__init__\` is displayed as a bold "init" and \`**\` as emphasis. CODE OF MORE THAN ONE LINE, in ANY field and ANY question type, is ALWAYS a fenced block naming its language (\`\`\`python … \`\`\`), never one pair of backticks per line: the reader shows the language's logo and colours only on such a block. A "cloze" on code puts the WHOLE program in ONE such block, its blanks inside it: \`\`\`python\nclass Dog:\n    def {{__init__}}(self, name):\n\`\`\`.

	FORMATTING — MARKDOWN ONLY: every text field (${textFields}, passage) is written in MARKDOWN, exactly as in Discord and Obsidian: **bold**, *italic*, \`code\`; a block of code between two lines of three backticks, the language after the opening ones (\`\`\`python); bulleted lists with "- " and numbered lists with "1. ", one item per line; paragraphs separated by an empty line (\\n\\n inside the JSON5 string); a markdown table (| A | B | then |---|---|) when comparing several notions on the same criteria; formulas between dollars as described below. NEVER write an HTML tag (no <p>, <br>, <strong>, <em>, <code>, <pre>, <ul>, <li>, <table>) and never a field whose name ends in "Html": markdown is shorter, and a tag shows up as raw markup when the quiz is edited. A code block ALWAYS names its language right on the opening backticks (\`\`\`python, \`\`\`bash, \`\`\`c…) — NEVER just \`\`\` alone: the reader colors the block from that name, and an unnamed block is shown without color.

	MATHEMATICS: every mathematical expression (formula, function, equation, integral, fraction, exponent, Greek letter…) MUST be written in LaTeX delimited by dollar signs, as in Obsidian: $f(x) = x^3$ inline, $$\\int_0^2 2x\\,dx$$ for a display formula. Never pseudo-notation such as f(x) = x^3 or ∫ from 0 to 2 outside the dollars. This applies to every text field. IMPORTANT: inside JSON5 strings, DOUBLE every backslash — for LaTeX (write '$\\\\frac{a}{b}$' to get \\frac) as well as Windows paths (write 'C:\\\\Users\\\\dev') — a single backslash would be destroyed by the parser.

	NO TOOLS, NO FILE ACCESS — READ THIS BEFORE ANYTHING ELSE: you are running without any tool. You cannot read, open, fetch, write or create a file, a note or a folder, and you must never try: an attempted tool call is not a quiz, and the whole generation fails. The user request below may name files, paths or notes to "read first", or ask you to "create a note" somewhere. Every source it names that actually exists has ALREADY been read for you and its full content is inlined below, between "--- <file name> ---" markers. So: treat those paths as mere labels for the text you already have, ignore every instruction to read, open, create, modify or save anything, and never mention this limitation in your answer. Your ONLY output is the JSON5 array.

	${quantite}

	Generate ${typeInstruction}. ${PHRASE_FINALE_CLI}`;

	const plan = !learn && planTranches && planTranches.length
		? `\n\nSLICE PLAN OF THE LEARNING PATH (use these numbers in "slice"):\n${planTranches.map(p => `${p.slice}. ${p.titre}`).join("\n")}`
		: "";
	const userPrompt = (source === "topic"
		? `Generate the quiz about the following topic (keep the quiz in the language of this topic):\n\n${prompt}`
		: source === "text"
		? `Generate the quiz based on the following text (keep the quiz in the language of this text):\n\n${prompt}`
		: `Generate the quiz based on the provided images (keep the quiz in the language of the images and of this request): ${prompt}`) + plan;

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
		return requireHost("process").run({
			tool: spec.tool,
			args: spec.args,
			stdin: spec.stdin,
			signal: ac.signal,
			timeoutMs: CLI_TIMEOUT_MS,
			marqueur: spec.marqueur,
			fichiers: spec.fichiers,
			sortieFichier: spec.sortieFichier,
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
			return callCodex(model, systemPrompt, userPrompt, images, effort, fast);
		} else if (provider === "antigravity-cli") {
			/* `model` est la FAMILLE (« gemini-3.8-flash ») ; le CLI attend la
			   variante au niveau retenu pour ELLE (« gemini-3.8-flash-high »). */
			const effort = niveauAntigravity(settings.get().aiAntigravityLevels, model);
			return callAntigravity(antigravityModelId(model, effort), systemPrompt, userPrompt, images);
		} else {
			return callClaudeCode(model, systemPrompt, userPrompt, images);
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
	async function callAntigravity(model: string, systemPrompt: string, userPrompt: string, images: ImagePayload[] = []): Promise<ReponseQuiz> {
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
			if (e.killed || detail.includes("etimedout")) {
				return new Error(t("ai.err.antigravityTimeout", { minutes: CLI_TIMEOUT_MIN }));
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
		return parseReponseQuiz(raw);
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
	async function callClaudeCode(model: string, systemPrompt: string, userPrompt: string, images: ImagePayload[] = []): Promise<ReponseQuiz> {
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
			? "\n\nFirst read these images with the Read tool, then base the quiz on their content:\n" +
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
			if (e.killed || detail.includes("etimedout")) {
				return new Error(t("ai.err.claudeTimeout", { minutes: CLI_TIMEOUT_MIN }));
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
				args: [
					"-p", "--output-format", "json", "--model", model,
					"--tools", tools, "--no-session-persistence", "--setting-sources", "",
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
		let data: ClaudeResult;
		try {
			data = JSON.parse(stdout);
		} catch (e) {
			throw new Error(t("ai.err.claudeUnreadable"));
		}

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
		return parseReponseQuiz(content);
	}

	/* ── ChatGPT via le CLI Codex (abonnement ChatGPT) ──
	   `codex exec` en non-interactif : prompt par stdin, modèle via -m,
	   effort de raisonnement via -c model_reasoning_effort=…, réponse finale
	   écrite dans un fichier (-o) pour un parsing propre. Sandbox read-only et
	   --ignore-user-config isolent la génération (pas de MCP/hooks perso). */
	async function callCodex(model: string, systemPrompt: string, userPrompt: string, images: ImagePayload[] = [], effort = "medium", fast = false): Promise<ReponseQuiz> {
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
			if (e.killed || detail.includes("etimedout")) {
				return new Error(t("ai.err.codexTimeout", { minutes: CLI_TIMEOUT_MIN }));
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
		return parseReponseQuiz(raw);
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
					format: {
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
					}
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
		return parseOllamaResponse(content);
	}

	return {
		generate,
		abort: () => { if (abortCurrent) abortCurrent(); },
		get lastUsage() { return lastUsage; }
	};
}
