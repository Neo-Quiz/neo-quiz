/* ══════════════════════════════════════════════════════════
   WHICH KIND OF QUIZ A REQUEST WANTS, AND WHAT TO ASK FIRST — pure
   (spec 2026-10-07-generate-auto-kind, amended by the owner the same day)

   The clarify call infers the kind (Learn by default, Test only when the
   request clearly asks for practice) and never asks the learner about it.
   When the message is not a request for a quiz (a greeting, small talk, a
   question about the app) it answers conversationally instead and lists the
   learner's folders (`reply`). Otherwise it asks for a question count and, for
   several documents, how many quizzes; any failure leaves generation ready
   with Learn as the fallback. Since 2026-10-17 it also places the quiz (there
   is no "Generated" folder any more): it names one of the learner's folders
   (`folder`), or asks one "which folder" question (`purpose: "folder"`) whose
   options are folder names, new ones it proposes included. Since 2026-10-18
   it also names the quiz's SUBJECT (`subject`, one id of `CATEGORIES`): the
   composer's local keyword detection and subject picker are gone, the AI
   reads the request and the document names better. The subject only selects
   a prompt addition (categorie-prompt.ts); anything unknown is `general`.
══════════════════════════════════════════════════════════ */

import { CATEGORIES, estCategorie } from "./categorie-quiz";
import type { CategorieQuiz } from "./categorie-quiz";
import { MODULE_ICONS } from "./module-icons";

/** What a request can ask for: `both` is a Learn then a Test on the same documents. */
export type KindChoice = "learn" | "practice" | "both";

/** One answer the model proposes: a short label and a one-line description. */
/** How many quizzes a request with several documents makes (2026-10-14): a
    number, or "auto" (the model decides). The quizzes share the material of
    ALL the documents, split by theme, never one per document by rule. */
export type QuizzesChoice = number | "auto";
/** The most quizzes one request may ask for. */
export const MAX_QUIZZES = 10;
export interface ClarifyOption { label: string; description: string; quizzes?: QuizzesChoice }
/** One clarifying question, in the manner of Claude Code's AskUserQuestion: a
    short header chip, the question, 2 to 4 options, one or several answers.
    The app adds its own "write something" option. */
export interface ClarifyQuestion { header: string; question: string; multiple: boolean; options: ClarifyOption[]; /** Index of the option assumed when the question is skipped. */ default: number; purpose?: "quizzes" | "folder" | "count" }
/** `folder`: the name of one of the learner's folders the model says fits
    (read against the real list by the caller, never trusted as a path). */
/** `subject`: the subject id the model picked, always a known id (`estCategorie`); absent = `general`. */
export type ClarifyAnswer = ({ ready: true } | { questions: ClarifyQuestion[] } | { reply: string }) & { kind?: KindChoice; folder?: string; subject?: CategorieQuiz; icon?: string };
/** `icon`: the icon of a NEW folder, always one id of `MODULE_ICONS` (2026-10-18); only used when the folder is really created, never for an existing one. */
/** The longest folder name read from the model's answer. */
export const MAX_FOLDER_NAME = 100;
/** The longest conversational reply kept (characters). */
export const MAX_REPLY = 4000;
/** The most questions a request is asked, and the longest header chip. */
export const MAX_CLARIFY_QUESTIONS = 3;
export const MAX_HEADER = 12;

const READY: ClarifyAnswer = { ready: true };

export function isQuizzesChoice(value: unknown): value is QuizzesChoice {
	return value === "auto" || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_QUIZZES);
}

function isKindChoice(value: unknown): value is KindChoice {
	return value === "learn" || value === "practice" || value === "both";
}

/** The first balanced `{ … }` of a text that parses (strings and escapes respected), or null. */
export function firstObject(raw: string): string | null {
	for (let start = raw.indexOf("{"); start >= 0; start = raw.indexOf("{", start + 1)) {
		let depth = 0, inStr = false, esc = false;
		for (let i = start; i < raw.length; i++) {
			const c = raw[i];
			if (inStr) {
				if (esc) esc = false;
				else if (c === "\\") esc = true;
				else if (c === "\"") inStr = false;
				continue;
			}
			if (c === "\"") inStr = true;
			else if (c === "{") depth++;
			else if (c === "}" && --depth === 0) {
				const slice = raw.slice(start, i + 1);
				try { JSON.parse(slice); return slice; } catch { break; }
			}
		}
	}
	return null;
}

/** The option assumed when a question is skipped: the model's index, else the first. */
export function defaultIndex(value: unknown, count: number): number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < count ? value : 0;
}

/** Reads the model's answer. Anything that is not a well-formed list of 1 to 3
    questions with 2 to 4 options each ({label, description}) is `{ ready: true }`:
    a broken answer never blocks a generation. A header over 12 characters is
    cut. Text around the JSON is ignored. */
export function parseClarifyAnswer(raw: string): ClarifyAnswer {
	const slice = firstObject(String(raw ?? ""));
	if (!slice) return READY;
	let o: unknown;
	try { o = JSON.parse(slice); } catch { return READY; }
	if (!o || typeof o !== "object" || Array.isArray(o)) return READY;
	const obj = o as Record<string, unknown>;
	const kind = isKindChoice(obj.kind) ? obj.kind : undefined;
	const folder = typeof obj.folder === "string" && obj.folder.trim() ? obj.folder.trim().slice(0, MAX_FOLDER_NAME) : undefined;
	// An unknown, missing or garbage subject is simply absent: `general`.
	const subject = estCategorie(obj.subject) && obj.subject !== "general" ? obj.subject : undefined;
	// An unknown or garbage icon is simply absent: the folder keeps the icon its name suggests.
	const icon = typeof obj.icon === "string" && MODULE_ICONS.includes(obj.icon) ? obj.icon : undefined;
	const extra = { ...(kind ? { kind } : {}), ...(folder ? { folder } : {}), ...(subject ? { subject } : {}), ...(icon ? { icon } : {}) };
	const ready: ClarifyAnswer = { ready: true, ...extra };
	// A conversational reply wins over everything else (bounded, plain text).
	if (typeof obj.reply === "string" && obj.reply.trim()) return { reply: obj.reply.trim().slice(0, MAX_REPLY) };
	if (!Array.isArray(obj.questions) || obj.questions.length < 1 || obj.questions.length > MAX_CLARIFY_QUESTIONS) return ready;
	const questions: ClarifyQuestion[] = [];
	for (const x of obj.questions) {
		if (!x || typeof x !== "object") return ready;
		const { header, question, options, multiple, default: defaut, purpose } = x as Record<string, unknown>;
		if (typeof question !== "string" || !question.trim()) return ready;
		if (!Array.isArray(options) || options.length < 2 || options.length > 4) return ready;
		const lues: ClarifyOption[] = [];
		for (const op of options) {
			if (!op || typeof op !== "object") return ready;
			const { label, description, quizzes: optionQuizzes } = op as Record<string, unknown>;
			if (typeof label !== "string" || !label.trim()) return ready;
			lues.push({ label: label.trim().slice(0, 80), description: typeof description === "string" ? description.trim().slice(0, 160) : "", ...(isQuizzesChoice(optionQuizzes) ? { quizzes: optionQuizzes } : {}) });
		}
		const validQuizzesQuestion = purpose === "quizzes" && multiple !== true && lues.every(option => isQuizzesChoice(option.quizzes));
		const validFolderQuestion = purpose === "folder" && multiple !== true;
		const validCountQuestion = purpose === "count" && multiple !== true;
		questions.push({ header: typeof header === "string" ? header.trim().slice(0, MAX_HEADER) : "", question: question.trim().slice(0, 300), multiple: multiple === true, options: lues, default: defaultIndex(defaut, lues.length), ...(validQuizzesQuestion ? { purpose: "quizzes" as const } : validFolderQuestion ? { purpose: "folder" as const } : validCountQuestion ? { purpose: "count" as const } : {}) });
	}
	// Only one "which folder" question counts: a second one is an ordinary question.
	const premier = questions.findIndex(q => q.purpose === "folder");
	questions.forEach((q, i) => { if (q.purpose === "folder" && i !== premier) delete q.purpose; });
	return { questions, ...extra };
}

/** A question that asks, in words, how many quizzes (or Learns, or Tests) to make. */
const QUIZ_COUNT_WORDS = /\b(?:combien de (?:quiz|learns?|tests?|parcours)|nombre de (?:quiz|learns?|tests?)|how many (?:quizzes|quiz|learns?|tests?)|number of (?:quizzes|learns?|tests?))\b/i;

/** The number of quizzes asked (`"auto"`: the model decides), or `null` when
    the model asked no valid "how many quizzes" question. A skipped question
    takes its default; a typed answer counts when it holds a number from 1 to
    MAX_QUIZZES ("3", "3 quiz"), else `null`. */

export function quizCountFromClarifications(questions: readonly ClarifyQuestion[], answers: readonly (readonly string[])[]): QuizzesChoice | null {
	/* The model marks this question `purpose: "quizzes"` and gives every option
	   a `quizzes` value, but not always: a real run asked "how many quizzes?"
	   without them, the answer "Un seul Learn" was read as nothing, and three
	   documents made THREE quizzes (2026-10-19). A question that asks it in
	   words is read by its answer's words. */
	let index = questions.findIndex(question => question.purpose === "quizzes");
	if (index < 0) index = questions.findIndex(question => !question.purpose && QUIZ_COUNT_WORDS.test(question.question));
	if (index < 0) return null;
	const question = questions[index];
	const selected = answers[index]?.length ? answers[index] : [question.options[question.default]?.label ?? ""];
	for (const label of selected) {
		const choice = question.options.find(option => option.label === label)?.quizzes;
		if (choice !== undefined) return choice;
		const typed = /\b(\d{1,2})\b/.exec(label);
		const n = typed ? Number(typed[1]) : NaN;
		if (isQuizzesChoice(n)) return n;
		if (/\b(un seul|une seule|seul|seule|single|only one|one)\b/i.test(label)) return 1;
		if (/^\s*auto\b/i.test(label)) return "auto";
	}
	return null;
}

/* ── AN EXPLICIT QUESTION COUNT IN THE REQUEST (2026-10-19) ──
   "5 questions", "cinq QCM", "une seule question", "20 questions max": the
   learner already said how many, so the count question is not asked. A live
   run asked "Combien de questions ?" anyway and its default "Auto" overrode
   the request (12 questions came back for "5 questions"). */
const NUMBER_WORDS: Record<string, number> = {
	un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
	vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
	one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
	twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
};
/** The most questions an explicit count may name; beyond it the request is read as having none. */
export const MAX_EXPLICIT_COUNT = 200;
const COUNT_WORD = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join("|");
const COUNT_UNIT = "(?:questions?|qcms?|mcqs?|flash\\s?cards?|cartes?|fiches?|exercices?|exos?)";
const COUNT_FILLER = "(?:(?:seule?s?|only|single|short|quick|petites?|courtes?|rapides?|simples?|mini|multiple[- ]choice|de r[ée]vision|de cours|pratiques?|difficiles?|faciles?|and|et)\\s+){0,2}";
const COUNT_RE = new RegExp("(?<![\\p{L}\\p{N}])(\\d{1,3}|(?:" + COUNT_WORD + ")(?:(?:\\s+et\\s+|[-\\s])(?:" + COUNT_WORD + "))?)\\s+" + COUNT_FILLER + COUNT_UNIT + "(?![\\p{L}\\p{N}])", "giu");

/** The number of questions the request names, or `null` when it names none
    (or a range, or something absurd). Digits or French/English words. */
export function explicitQuestionCount(request: string): number | null {
	const text = String(request ?? "");
	for (const m of text.matchAll(COUNT_RE)) {
		// "5 à 10 questions", "5-10 questions": a range is not a count.
		if (/\d\s*(?:-|–|à|a|to|ou|or)\s*$/iu.test(text.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0))) continue;
		const raw = m[1].toLowerCase();
		const n = /^\d+$/.test(raw) ? Number(raw) : raw.split(/\s+et\s+|[-\s]/).reduce((sum, w) => sum + (NUMBER_WORDS[w] ?? 0), 0);
		if (Number.isInteger(n) && n >= 1 && n <= MAX_EXPLICIT_COUNT) return n;
	}
	return null;
}

/** Whether a clarifying question asks how many questions to generate: the
    model's own mark, else its wording (it does not always send the mark). */
export function isCountQuestion(q: ClarifyQuestion): boolean {
	if (q.purpose === "count") return true;
	if (q.purpose) return false;
	return /\b(?:combien de questions?|nombre de questions?|how many questions?|number of questions?)\b/i.test(q.question);
}

/** Honours an explicit count: the count question is dropped from the
    answer (no questions left: ready, the kind, folder, subject and icon kept). */
export function withoutAskedCount(answer: ClarifyAnswer, request: string): ClarifyAnswer {
	if (!("questions" in answer) || explicitQuestionCount(request) === null) return answer;
	const restantes = answer.questions.filter(q => !isCountQuestion(q));
	if (restantes.length === answer.questions.length) return answer;
	const { questions: _, ...extra } = answer;
	return restantes.length ? { questions: restantes, ...extra } : { ready: true, ...extra };
}

/** The folder name the learner chose in the "which folder" question (an
    option's label, or the text typed in the app's own option), or `null`
    when no such question was asked or the answer is empty. A skipped
    question takes its default. The caller matches it against the real
    folders and sanitises it before creating anything. */
export function folderFromClarifications(questions: readonly ClarifyQuestion[], answers: readonly (readonly string[])[]): string | null {
	const index = questions.findIndex(question => question.purpose === "folder");
	if (index < 0) return null;
	const question = questions[index];
	const selected = (answers[index] ?? []).map(s => s.trim()).filter(Boolean);
	const name = selected[0] ?? question.options[question.default]?.label ?? question.options[0]?.label ?? "";
	return name.trim() ? name.trim().slice(0, MAX_FOLDER_NAME) : null;
}

/** The answers as one block appended to the request: "- question" then the answer indented under it, per question; a skipped question gives its default option. */
export function formatClarifications(label: string, questions: readonly ClarifyQuestion[], answers: readonly (readonly string[])[]): string {
	// A skipped question (an empty answer) stands for its default option.
	const lines = questions.map((q, i) => {
		const a = (answers[i] ?? []).map(s => s.trim()).filter(Boolean);
		return { q: q.question, a: a.length ? a : [q.options[q.default]?.label ?? q.options[0].label] };
	});
	return lines.length ? label + "\n" + lines.map(l => `- ${l.q}\n    ${l.a.join(", ")}`).join("\n") : "";
}

/** The labels `formatClarifications` has opened its block with ("Details:",
    "Précisions :"): a request keeps the language it was sent in. */
const DETAILS_LABELS = ["Details:", "Précisions :"];

/** A request as the user wrote it: its text without the block of answers
    `formatClarifications` appended for the model (2026-10-14). The answers
    already show in the question card; shown again under the request they
    doubled. Only a trailing block of that exact shape is cut. */
export function sansPrecisions(text: string): string {
	for (const label of DETAILS_LABELS) {
		const at = text.lastIndexOf("\n\n" + label + "\n- ");
		if (at < 0) continue;
		const block = text.slice(at + 2 + label.length + 1).split("\n");
		if (block.every(l => l.startsWith("- ") || l.startsWith("    "))) return text.slice(0, at);
	}
	return text;
}

/** What the clarify call knows about the learner's folders (2026-10-17):
    their names (also offered by a conversational reply), the folder the app
    already decided (a chat's folder, an exam's, the attachments' own), and
    whether the folder is chosen at all here (`choose: false` for a request
    sent to the PC, which places it itself). */
export interface ClarifyFolders {
	/** The names of the learner's folders (most relevant first). */
	names: readonly string[];
	/** The folder already decided: the model must not ask about it. */
	decided?: string;
	/** `false`: no folder is chosen by this call. */
	choose?: boolean;
}

/** The folder rules of the clarify prompt (exported for `check:generation-kind`). */
export function clarifyFolderRules(folders: ClarifyFolders | undefined): string[] {
	if (!folders || folders.choose === false) return [];
	if (folders.decided) return [
		`The destination folder is already decided ("${folders.decided.replace(/["\\\n\r]/g, " ").trim()}"): do NOT ask about the folder and do NOT add a top-level "folder".`,
	];
	return [
		"Each quiz is saved in one of THE LEARNER'S FOLDERS (listed in the request, possibly none). When one clearly fits the request or the documents' names, add a top-level \"folder\" whose value is its EXACT name as listed, and do not ask about the folder.",
		"When none clearly fits, ask exactly ONE single-choice question marked \"purpose\":\"folder\" asking where to save the quiz: 2 to 4 options, each a folder name as its label and one line as its description; propose short NEW folder names suited to the subject (in the language of the request, no slash, no backslash, no path), and, if an existing folder partly fits, its EXACT name; its default is 0. It counts in the 3 questions at most and comes before the optional scope or level question. Never invent an existing folder: an existing one is named exactly as listed. That question MUST carry the field \"purpose\":\"folder\" next to \"header\" (without it the app cannot file the quiz where the learner chose), e.g. {\"header\":\"Folder\",\"question\":\"...\",\"multiple\":false,\"default\":0,\"purpose\":\"folder\",\"options\":[...]}.",
	];
}

/** The icon rule of the clarify call (exported for `check:generation-kind`):
    sent only when the call may propose a NEW folder; the compact id list. */
export const ICON_RULE = "When you propose a NEW folder (never for an existing one), also add a top-level \"icon\" whose value is exactly one of these ids and fits the folder's subject: " + MODULE_ICONS.join(",") + ". Never invent an id.";

/** The subject rule of the clarify call (exported for `check:generation-kind`):
    the subject ids, compact, and what to do when none fits. */
export const SUBJECT_RULE = "Also deduce the quiz's SUBJECT from the request and the attached document names, and add a top-level \"subject\" whose value is exactly one of these ids: " + CATEGORIES.join(",")
	+ ". Use the most specific id (\"python\" over \"web\" for a Python course; \"langues\" for a human language that has no id of its own). When no id clearly fits, or the request is not about one subject, use \"general\". Never invent an id.";

/** The instruction of the clarify call: English like every instruction to the
    model, the questions follow the language of the request. It carries the
    request and the NAMES of the attached documents, never their content. */
export function clarifyPrompt(request: string, documentNames: readonly string[], uiLanguage: "en" | "fr" = "en", folders?: ClarifyFolders): { system: string; user: string } {
	const choisit = !!folders && folders.choose !== false && !folders.decided;
	const count = explicitQuestionCount(request);
	const system = [
		"You are an assistant inside Neo Quiz, a revision app that generates either a Learn (a guided path that teaches a topic step by step) or a Test (questions only). You decide which one yourself and NEVER ask the learner about it.",
		"FIRST decide whether the message asks for a quiz or for studying material. A greeting (\"slt\", \"salut\", \"hello\"), small talk, a question about the app or \"what can you do\" is NOT such a request: answer it conversationally, briefly, in the language of the message, and offer to work on one of the learner's folders, listing the folders given below (only those names, as a short list; if none is given, invite the learner to attach a document or name a topic). Return {\"reply\":\"<your answer>\"} alone, as plain text without HTML. Never reply conversationally to a message that names a subject, a course, a module, a document or asks for a quiz.",
		"Otherwise deduce the quiz kind from the meaning of the learner's request and the attached document names: Learn by default. A request that says the learner understood nothing and needs to understand all the notions clearly wants Learn; 'test me', 'mock exam' and 'QCM d'entraînement' clearly want a Test. Choose both only when the learner clearly asks for both. Never ask a question about the kind.",
		"A keyword such as 'test', 'examen' or 'contrôle' inside a pasted path, filename, document title, or quoted material does NOT express the learner's intent. Treat such names as context about the subject, never as an instruction to choose Test. Follow the meaning of the request.",
		"Always include the deduced canonical \"kind\" (\"learn\", \"practice\", or \"both\") in your answer. The app safely defaults to Learn if it is missing or invalid.",
		SUBJECT_RULE,
		"Before generating, ask short multiple-choice clarification questions.",
		...(count === null
			? ["Always ask one question about the NUMBER OF QUESTIONS to generate. Offer concrete choices such as 15, 25, and 40 questions. Mark it \"purpose\":\"count\"."]
			: [`The request already names the number of questions (${count}). Do NOT ask about the number of questions.`]),
		"If two or more attached documents are listed, also ask HOW MANY QUIZZES to make, simply as a number: a single-choice question marked \"purpose\":\"quizzes\" whose options are \"Auto\" {\"quizzes\":\"auto\"} first (you decide), then 1, 2 and 3 quizzes ({\"quizzes\":1}, {\"quizzes\":2}, {\"quizzes\":3}); its default is 0. The quizzes share the material of ALL the documents, split by theme; never describe them as one quiz per document.",
		"For each of these two questions (number of questions, number of quizzes), put the option labeled exactly \"Auto\" first and set the default to index 0. \"Auto\" means you decide freely; it imposes NO numeric bound.",
		"You may ask at most ONE optional clarifying question about scope or learner level, only when genuinely vague. Never exceed 3 questions total.",
		...clarifyFolderRules(folders),
		...(choisit ? [ICON_RULE] : []),
		"NEVER ask what the attached documents already answer. You see only their names; if a name makes the scope clear, do not ask about scope.",
		"You have no tools; you only see the request, the names of the attached documents and the names of the learner's folders.",
		count === null
			? "Always return a questions JSON object because the question-count question is required. Always include the top-level kind. The only alternative is the conversational {\"reply\":\"...\"} object described above."
			: "Always include the top-level kind. When you have no question to ask, return {\"kind\":\"...\"} alone (no questions). The only alternative is the conversational {\"reply\":\"...\"} object described above.",
		"Answer with ONLY one JSON object, nothing before or after it:",
		`- {"kind":"learn","subject":"<one subject id>",${choisit ? "\"folder\":\"<optional: exact name of one of the learner's folders>\"," : ""}"questions":[{"header":"<label of at most 12 characters>","question":"<the question>","multiple":false,"default":0,"options":[{"label":"<short answer>","description":"<one line saying what it means or covers>"}, ...]}]} with an optional top-level kind whose value must be exactly "learn", "practice", or "both", and 1 to 3 questions. Each question has 2 to 4 options ("multiple":true when several can apply) and "default": the index (from 0) of the option to assume when the learner skips the question; for the number-of-questions and number-of-quizzes questions this must be 0 (Auto), and for an optional level question use the most beginner option, for a scope question use "everything in the material". Write the header, questions, labels and descriptions in the language of the request; when the request does not reveal a language (a single word like "Python", a code name, only document names), write them in ${uiLanguage === "fr" ? "French" : "English"}, the language of the app. Keep the first label "Auto" exactly as written and localize its description. Do not add an "Other" option: the app adds one.`,
	].join("\n\n");
	const names = documentNames.map(n => n.trim()).filter(Boolean);
	const dossiers = (folders?.names ?? []).map(n => n.trim()).filter(Boolean).slice(0, 60);
	const user = [
		"THE LEARNER'S REQUEST:\n" + (request.trim() || "(empty)"),
		dossiers.length ? "THE LEARNER'S FOLDERS (names only):\n" + dossiers.map(n => "- " + n).join("\n") : choisit ? "THE LEARNER'S FOLDERS (names only):\n(none yet)" : "",
		names.length ? "ATTACHED DOCUMENTS (names only):\n" + names.map(n => "- " + n).join("\n") : "",
	].filter(Boolean).join("\n\n---\n\n");
	return { system, user };
}
