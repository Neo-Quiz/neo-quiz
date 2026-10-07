/* ══════════════════════════════════════════════════════════
   WHICH KIND OF QUIZ A REQUEST WANTS, AND WHAT TO ASK FIRST — pure
   (spec 2026-10-07-generate-auto-kind, amended by the owner the same day)

   There is no Learn | Test selector. The kind comes from the words of the
   request alone: a LEARN by default, a Test only when the request says it
   wants to practise, both only when it says so. No AI call is made for the
   kind. A vague request ("Python", "le CM4") gets ONE short AI call that
   returns either `{"ready":true}` or 1 or 2 clarifying questions; any failure
   of that call means "ready": generation is never blocked.
══════════════════════════════════════════════════════════ */

/** What a request can ask for: `both` is a Learn then a Test on the same documents. */
export type KindChoice = "learn" | "practice" | "both";

/** Lower case, accents and combining marks removed, apostrophes straightened. */
function plain(text: string): string {
	return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[‘’ʼ]/g, "'").toLowerCase();
}

/* Word-bounded on the ASCII-folded text (FR + EN). */
const BOTH_WORDS = /\b(les deux|both|learn (then|and then|puis|et) (a )?test|learn puis test|apprendre (puis|et) (me )?(tester|m'entrainer|s'entrainer)|apprendre et test|cours et test)\b/;
const PRACTICE_WORDS = /\b(qcm|test|tests|teste-moi|testez|tester|examen|examens|examen blanc|controle|controles|entraine|entraine-moi|entrainer|entrainement|m'entrainer|s'entrainer|revise|reviser|revision|revisions|interro|quiz me|practice|practise|exam|exams|mock|mock exam|drill)\b/;

/** `learn` unless the request says it wants to practise (`practice`) or says
    both (`both`). Ambiguous or empty: `learn`. */
export function decideByKeywords(text: string): KindChoice {
	const p = plain(text);
	if (BOTH_WORDS.test(p)) return "both";
	return PRACTICE_WORDS.test(p) ? "practice" : "learn";
}

/** One answer the model proposes: a short label and a one-line description. */
export interface ClarifyOption { label: string; description: string }
/** One clarifying question, in the manner of Claude Code's AskUserQuestion: a
    short header chip, the question, 2 to 4 options, one or several answers.
    The app adds its own "write something" option. */
export interface ClarifyQuestion { header: string; question: string; multiple: boolean; options: ClarifyOption[] }
export type ClarifyAnswer = { ready: true } | { questions: ClarifyQuestion[] };
/** The most questions a request is asked, and the longest header chip. */
export const MAX_CLARIFY_QUESTIONS = 2;
export const MAX_HEADER = 12;

const READY: ClarifyAnswer = { ready: true };

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

/** Reads the model's answer. Anything that is not a well-formed list of 1 or 2
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
	if (!Array.isArray(obj.questions) || obj.questions.length < 1 || obj.questions.length > MAX_CLARIFY_QUESTIONS) return READY;
	const questions: ClarifyQuestion[] = [];
	for (const x of obj.questions) {
		if (!x || typeof x !== "object") return READY;
		const { header, question, options, multiple } = x as Record<string, unknown>;
		if (typeof question !== "string" || !question.trim()) return READY;
		if (!Array.isArray(options) || options.length < 2 || options.length > 4) return READY;
		const lues: ClarifyOption[] = [];
		for (const op of options) {
			if (!op || typeof op !== "object") return READY;
			const { label, description } = op as Record<string, unknown>;
			if (typeof label !== "string" || !label.trim()) return READY;
			lues.push({ label: label.trim().slice(0, 80), description: typeof description === "string" ? description.trim().slice(0, 160) : "" });
		}
		questions.push({ header: typeof header === "string" ? header.trim().slice(0, MAX_HEADER) : "", question: question.trim().slice(0, 300), multiple: multiple === true, options: lues });
	}
	return { questions };
}

/** The answers as one block appended to the request: "- question" then the answer indented under it, per question. */
export function formatClarifications(label: string, questions: readonly ClarifyQuestion[], answers: readonly (readonly string[])[]): string {
	const lines = questions.map((q, i) => ({ q: q.question, a: (answers[i] ?? []).map(s => s.trim()).filter(Boolean) })).filter(l => l.a.length);
	return lines.length ? label + "\n" + lines.map(l => `- ${l.q}\n    ${l.a.join(", ")}`).join("\n") : "";
}

/** The instruction of the clarify call: English like every instruction to the
    model, the questions follow the language of the request. It carries the
    request and the NAMES of the attached documents, never their content. */
export function clarifyPrompt(request: string, documentNames: readonly string[], uiLanguage: "en" | "fr" = "en"): { system: string; user: string } {
	const system = [
		"You are an assistant inside Neo Quiz, a revision app that generates a quiz from a learner's request (Learn: a guided path that teaches a topic step by step; or a Test: questions only). Before generating, you may ask the learner a question or two, the way a coding assistant asks a multiple-choice question.",
		"Ask FEW questions: prefer none, sometimes one, at most 2. Ask ONLY when the request is vague about something that really changes the quiz: the scope or which parts of the subject, the learner's level, the goal or deadline, the number of questions. Examples of vague requests: \"Python\", \"le CM4\", \"networks\".",
		"Ask NOTHING when the request is already precise, and NEVER ask what the attached documents already answer (you see only their names: if a name makes the scope clear, ask nothing). When in doubt, ask nothing.",
		"You have no tools; you only see the request and the names of the attached documents.",
		"Answer with ONLY one JSON object, nothing before or after it:",
		"- {\"ready\":true} when nothing needs to be asked;",
		`- otherwise {"questions":[{"header":"<label of at most 12 characters>","question":"<the question>","multiple":false,"options":[{"label":"<short answer>","description":"<one line saying what it means or covers>"}, ...]}]} with 1 or 2 questions, each with 2 to 4 options ("multiple":true when several can apply). Write the header, questions, labels and descriptions in the language of the request; when the request does not reveal a language (a single word like "Python", a code name, only document names), write them in ${uiLanguage === "fr" ? "French" : "English"}, the language of the app. Do not add an "Other" option: the app adds one.`,
	].join("\n\n");
	const names = documentNames.map(n => n.trim()).filter(Boolean);
	const user = [
		"THE LEARNER'S REQUEST:\n" + (request.trim() || "(empty)"),
		names.length ? "ATTACHED DOCUMENTS (names only):\n" + names.map(n => "- " + n).join("\n") : "",
	].filter(Boolean).join("\n\n---\n\n");
	return { system, user };
}
