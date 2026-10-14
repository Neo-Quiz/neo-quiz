/* ══════════════════════════════════════════════════════════
   WHICH KIND OF QUIZ A REQUEST WANTS, AND WHAT TO ASK FIRST — pure
   (spec 2026-10-07-generate-auto-kind, amended by the owner the same day)

   The clarify call infers the kind from the request's meaning and document
   names. It asks about Learn/Test only when that intent is genuinely unclear.
   It always asks for a question count and asks how many quizzes for multiple
   documents; any failure leaves generation ready with Learn as the fallback.
══════════════════════════════════════════════════════════ */

/** What a request can ask for: `both` is a Learn then a Test on the same documents. */
export type KindChoice = "learn" | "practice" | "both";

/** One answer the model proposes: a short label and a one-line description. */
/** How many quizzes a request with several documents makes (2026-10-14): a
    number, or "auto" (the model decides). The quizzes share the material of
    ALL the documents, split by theme, never one per document by rule. */
export type QuizzesChoice = number | "auto";
/** The most quizzes one request may ask for. */
export const MAX_QUIZZES = 10;
export interface ClarifyOption { label: string; description: string; kind?: KindChoice; quizzes?: QuizzesChoice }
/** One clarifying question, in the manner of Claude Code's AskUserQuestion: a
    short header chip, the question, 2 to 4 options, one or several answers.
    The app adds its own "write something" option. */
export interface ClarifyQuestion { header: string; question: string; multiple: boolean; options: ClarifyOption[]; /** Index of the option assumed when the question is skipped. */ default: number; purpose?: "kind" | "quizzes" }
export type ClarifyAnswer = ({ ready: true } | { questions: ClarifyQuestion[] }) & { kind?: KindChoice };
/** The most questions a request is asked, and the longest header chip. */
export const MAX_CLARIFY_QUESTIONS = 3;
export const MAX_HEADER = 12;

const READY: ClarifyAnswer = { ready: true };

function isQuizzesChoice(value: unknown): value is QuizzesChoice {
	return value === "auto" || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_QUIZZES);
}

function isKindChoice(value: unknown): value is KindChoice {
	return value === "learn" || value === "practice" || value === "both";
}

/** The first balanced `{ … }` of a text that parses (strings and escapes respected), or null. */
function firstObject(raw: string): string | null {
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
	const ready: ClarifyAnswer = kind ? { ready: true, kind } : READY;
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
			const { label, description, kind: optionKind, quizzes: optionQuizzes } = op as Record<string, unknown>;
			if (typeof label !== "string" || !label.trim()) return ready;
			lues.push({ label: label.trim().slice(0, 80), description: typeof description === "string" ? description.trim().slice(0, 160) : "", ...(isKindChoice(optionKind) ? { kind: optionKind } : {}), ...(isQuizzesChoice(optionQuizzes) ? { quizzes: optionQuizzes } : {}) });
		}
		const validKindQuestion = purpose === "kind" && multiple !== true && lues.every(option => isKindChoice(option.kind));
		const validQuizzesQuestion = purpose === "quizzes" && multiple !== true && lues.every(option => isQuizzesChoice(option.quizzes));
		questions.push({ header: typeof header === "string" ? header.trim().slice(0, MAX_HEADER) : "", question: question.trim().slice(0, 300), multiple: multiple === true, options: lues, default: defaultIndex(defaut, lues.length), ...(validKindQuestion ? { purpose: "kind" as const } : validQuizzesQuestion ? { purpose: "quizzes" as const } : {}) });
	}
	return { questions, ...(kind ? { kind } : {}) };
}

/** Resolve a type choice; malformed or custom answers safely fall back to Learn. */
export function kindFromClarifications(kind: KindChoice | undefined, questions: readonly ClarifyQuestion[], answers: readonly (readonly string[])[]): KindChoice {
	const index = questions.findIndex(question => question.purpose === "kind");
	if (index >= 0) {
		const question = questions[index];
		const selected = answers[index]?.length ? answers[index] : [question.options[question.default]?.label ?? question.options[0]?.label ?? ""];
		for (const label of selected) {
			const choice = question.options.find(option => option.label === label)?.kind;
			if (isKindChoice(choice)) return choice;
		}
	}
	return kind ?? "learn";
}

/** The number of quizzes asked (`"auto"`: the model decides), or `null` when
    the model asked no valid "how many quizzes" question. A skipped question
    takes its default; a typed answer counts when it holds a number from 1 to
    MAX_QUIZZES ("3", "3 quiz"), else `null`. */
export function quizCountFromClarifications(questions: readonly ClarifyQuestion[], answers: readonly (readonly string[])[]): QuizzesChoice | null {
	const index = questions.findIndex(question => question.purpose === "quizzes");
	if (index < 0) return null;
	const question = questions[index];
	const selected = answers[index]?.length ? answers[index] : [question.options[question.default]?.label ?? ""];
	for (const label of selected) {
		const choice = question.options.find(option => option.label === label)?.quizzes;
		if (choice !== undefined) return choice;
		const typed = /\b(\d{1,2})\b/.exec(label);
		const n = typed ? Number(typed[1]) : NaN;
		if (isQuizzesChoice(n)) return n;
	}
	return null;
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

/** The instruction of the clarify call: English like every instruction to the
    model, the questions follow the language of the request. It carries the
    request and the NAMES of the attached documents, never their content. */
export function clarifyPrompt(request: string, documentNames: readonly string[], uiLanguage: "en" | "fr" = "en"): { system: string; user: string } {
	const system = [
		"You are an assistant inside Neo Quiz, a revision app that generates either a Learn (a guided path that teaches a topic step by step), a Test (questions only), or both.",
		"Deduce the quiz kind from the meaning of the learner's request and the attached document names. If the intent is clear, return its kind and do not ask a kind question. A request that says the learner understood nothing and needs to understand all the notions clearly wants Learn; 'test me', 'mock exam' and 'QCM d'entraînement' clearly want a Test. Choose both only when the learner clearly asks for both.",
		"A keyword such as 'test', 'examen' or 'contrôle' inside a pasted path, filename, document title, or quoted material does NOT express the learner's intent. Treat such names as context about the subject, never as an instruction to choose Test. Follow the meaning of the request.",
		"Ask a Learn/Test/Both question ONLY when the intended kind is genuinely ambiguous. Mark that single-choice question with \"purpose\":\"kind\" and give each option its canonical object: {\"kind\":\"learn\"}, {\"kind\":\"practice\"}, or {\"kind\":\"both\"}; choose Learn as its default. This uses the one optional clarification slot, so do not also ask a scope or level question.",
		"Always include the deduced canonical \"kind\" (\"learn\", \"practice\", or \"both\") when the intent is clear. If it is ambiguous, omit the top-level kind and ask the type question. The app safely defaults to Learn if the kind is missing or invalid.",
		"Before generating, ask short multiple-choice clarification questions.",
		"Always ask one question about the NUMBER OF QUESTIONS to generate, even if the request already names a count. Offer concrete choices such as 15, 25, and 40 questions.",
		"If two or more attached documents are listed, also ask HOW MANY QUIZZES to make, simply as a number: a single-choice question marked \"purpose\":\"quizzes\" whose options are \"Auto\" {\"quizzes\":\"auto\"} first (you decide), then 1, 2 and 3 quizzes ({\"quizzes\":1}, {\"quizzes\":2}, {\"quizzes\":3}); its default is 0. The quizzes share the material of ALL the documents, split by theme; never describe them as one quiz per document.",
		"For each of these two questions (number of questions, number of quizzes), put the option labeled exactly \"Auto\" first and set the default to index 0. \"Auto\" means you decide freely; it imposes NO numeric bound.",
		"You may ask at most ONE optional clarifying question: ask about kind when it is ambiguous, otherwise ask about scope or learner level only when genuinely vague. Never exceed 3 questions total.",
		"NEVER ask what the attached documents already answer. You see only their names; if a name makes the scope clear, do not ask about scope.",
		"You have no tools; you only see the request and the names of the attached documents.",
		"Always return a questions JSON object because the question-count question is required. Include a top-level kind when the intent is clear; omit it only when asking the kind question. The parser also accepts a kind-only answer for compatibility, but your required question count still takes priority.",
		"Answer with ONLY one JSON object, nothing before or after it:",
		`- {"kind":"learn","questions":[{"header":"<label of at most 12 characters>","question":"<the question>","multiple":false,"default":0,"options":[{"label":"<short answer>","description":"<one line saying what it means or covers>"}, ...]}]} with an optional top-level kind whose value must be exactly "learn", "practice", or "both", and 1 to 3 questions; a kind question has "purpose":"kind" and each option has its own canonical "kind" value. Each question has 2 to 4 options ("multiple":true when several can apply) and "default": the index (from 0) of the option to assume when the learner skips the question; for the number-of-questions and number-of-quizzes questions this must be 0 (Auto), and for an optional level question use the most beginner option, for a scope question use "everything in the material". Write the header, questions, labels and descriptions in the language of the request; when the request does not reveal a language (a single word like "Python", a code name, only document names), write them in ${uiLanguage === "fr" ? "French" : "English"}, the language of the app. Keep the first label "Auto" exactly as written and localize its description. Do not add an "Other" option: the app adds one.`,
	].join("\n\n");
	const names = documentNames.map(n => n.trim()).filter(Boolean);
	const user = [
		"THE LEARNER'S REQUEST:\n" + (request.trim() || "(empty)"),
		names.length ? "ATTACHED DOCUMENTS (names only):\n" + names.map(n => "- " + n).join("\n") : "",
	].filter(Boolean).join("\n\n---\n\n");
	return { system, user };
}
