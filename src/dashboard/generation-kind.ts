/* ══════════════════════════════════════════════════════════
   WHICH KIND OF QUIZ A REQUEST WANTS (spec 2026-10-07-generate-auto-kind) — pure

   The Generate page has no Learn | Test selector any more. On send the kind
   is decided: by keywords when the request says it plainly (no AI call), else
   by ONE short AI call that answers a kind or a question with clickable
   answers. Anything unreadable falls back to the default question.
══════════════════════════════════════════════════════════ */

/** What a request can ask for: `both` is a Learn then a Test on the same documents. */
export type KindChoice = "learn" | "practice" | "both";
export interface KindOption { label: string; kind: KindChoice }
export interface KindQuestion { ask: string; options: KindOption[] }
export type KindAnswer = { kind: KindChoice } | KindQuestion;

const KINDS: readonly string[] = ["learn", "practice", "both"];
const isKind = (x: unknown): x is KindChoice => typeof x === "string" && KINDS.includes(x);

/** Lower case, accents and combining marks removed, apostrophes straightened. */
function plain(text: string): string {
	return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[‘’ʼ]/g, "'").toLowerCase();
}

/* Word-bounded on the ASCII-folded text. The lists are the ones of the spec
   (FR + EN): a request that matches BOTH families, or neither, goes to the AI. */
const LEARN_WORDS = /\b(apprendre|apprends|apprenez|apprentissage|decouvrir|decouvre|comprendre|comprends|expliquer|explique|explique-moi|expliques|cours|lecon|lecons|debutant|learn|learning|teach me|teach|explain|beginner|from scratch|i don'?t know|i do not know|je ne connais pas|je connais rien|je sais pas|je ne sais pas)\b/;
const TEST_WORDS = /\b(qcm|test|tests|testez|tester|examen|examens|controle|controles|entraine|entraine-moi|entrainer|entrainement|revise|reviser|revision|revisions|interro|quiz me|practice|practise|exam|exams|mock|drill)\b/;

/** `"learn"` or `"practice"` when the request clearly says one, `null` when it
    says both or none (the AI is asked). */
export function decideByKeywords(text: string): "learn" | "practice" | null {
	const p = plain(text);
	const learn = LEARN_WORDS.test(p);
	const test = TEST_WORDS.test(p);
	if (learn === test) return null;
	return learn ? "learn" : "practice";
}

/** The first balanced `{ … }` of a text (strings and escapes respected), or null. */
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

/** Reads the model's answer: a kind, or a question with 2 to 4 options. Text
    around the JSON is ignored. Anything else (malformed, unknown kind, fewer
    than 2 or more than 4 options, an empty label) is `null`: the caller shows
    the default question. */
export function parseKindAnswer(raw: string): KindAnswer | null {
	const slice = firstObject(String(raw ?? ""));
	if (!slice) return null;
	let o: unknown;
	try { o = JSON.parse(slice); } catch { return null; }
	if (!o || typeof o !== "object" || Array.isArray(o)) return null;
	const obj = o as Record<string, unknown>;
	if ("kind" in obj) return isKind(obj.kind) ? { kind: obj.kind } : null;
	if (typeof obj.ask !== "string" || !obj.ask.trim() || !Array.isArray(obj.options)) return null;
	if (obj.options.length < 2 || obj.options.length > 4) return null;
	const options: KindOption[] = [];
	for (const x of obj.options) {
		if (!x || typeof x !== "object") return null;
		const { label, kind } = x as Record<string, unknown>;
		if (typeof label !== "string" || !label.trim() || !isKind(kind)) return null;
		options.push({ label: label.trim().slice(0, 80), kind });
	}
	return { ask: obj.ask.trim().slice(0, 300), options };
}

/** "Do you want to learn or to practise?" with Learn / Test / Both. */
export function defaultKindQuestion(t: (key: string) => string): KindQuestion {
	return {
		ask: t("ai.kind.question"),
		options: [
			{ label: t("ai.kind.learn"), kind: "learn" },
			{ label: t("ai.kind.practice"), kind: "practice" },
			{ label: t("ai.kind.both"), kind: "both" },
		],
	};
}

/** The instruction of the decide call: English like every instruction to the
    model, the answer follows the language of the request. It carries the
    request and the NAMES of the attached documents, never their content. */
export function kindDecisionPrompt(request: string, documentNames: readonly string[]): { system: string; user: string } {
	const system = [
		"You are a router inside Neo Quiz, a revision app that generates two kinds of quiz: LEARN (a guided path that teaches a topic step by step: short readings, questions, instant feedback; for someone who does not know the subject yet) and PRACTICE (a test: questions only, to check or train what someone already studied).",
		"Decide which kind the learner's request wants. You have no tools; you only see the request and the names of the attached documents.",
		"Answer with ONLY one JSON object, nothing before or after it:",
		"- {\"kind\":\"learn\"} or {\"kind\":\"practice\"} when the request makes it clear;",
		"- {\"kind\":\"both\"} when it asks to learn AND then be tested;",
		"- otherwise ask ONE short question, in the language of the request: {\"ask\":\"<the question>\",\"options\":[{\"label\":\"<short answer>\",\"kind\":\"learn|practice|both\"}, ...]} with 2 to 4 options, each label a short answer the learner can click, in the language of the request.",
	].join("\n\n");
	const names = documentNames.map(n => n.trim()).filter(Boolean);
	const user = [
		"THE LEARNER'S REQUEST:\n" + (request.trim() || "(empty)"),
		names.length ? "ATTACHED DOCUMENTS (names only):\n" + names.map(n => "- " + n).join("\n") : "",
	].filter(Boolean).join("\n\n---\n\n");
	return { system, user };
}
