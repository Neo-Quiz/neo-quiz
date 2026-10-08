import { composerPrompts, parseReponseQuiz, NoQuizAnswer } from "./ai-client";
import { nouveauJeton, texteWeb } from "./ai-web";
import { composerDemande } from "./generation-demande";
import type { NoteAttachment } from "./generation-demande";
import { decideByKeywords } from "./generation-kind";
import { verifierFormat } from "../quiz-format";

/* ══════════════════════════════════════════════════════════
   THE RELAY (spec addendum B), PURE

   Out: the SAME prompt the PC would run (`composerPrompts`), dressed with the
   web channel's shape instruction (`texteWeb`: one fenced block whose first
   line is `// neo-quiz <token>`), no clarification round. Back: the pasted
   answer is untrusted data: size-capped, parsed by the existing parser (JSON5,
   never executed), prototype keys dropped, non-finite numbers refused, format
   checked.

   The `*Html` keys (promptHtml, explainHtml…) are legitimate format keys and
   are KEPT: like every generated or shared quiz, they are sanitised at render
   time by the four doors (`sanitizeQuizHtml`), never trusted here.
══════════════════════════════════════════════════════════ */

export const MAX_ANSWER_CHARS = 1_000_000;

export interface RelayInput { text: string; mode?: "learn" | "practice"; types?: string[]; count?: number | null; documents: Array<{ name: string; content: string }> }

/** The text to share and the token its answer should carry. Same builders as the PC; Learn unless the words say a Test. */
export function buildRelayPrompt(input: RelayInput, token: string = nouveauJeton()): { text: string; token: string; mode: "learn" | "practice" } {
	const mode = input.mode ?? (decideByKeywords(input.text) === "practice" ? "practice" : "learn");
	const notes: NoteAttachment[] = input.documents.map(d => ({ name: d.name, content: d.content, source: "vault" as const }));
	const { source, prompt } = composerDemande({ text: input.text, notes, images: [] });
	const documents = notes.length >= 2 ? notes.map(n => n.name) : undefined;
	const prompts = composerPrompts(prompt, { count: input.count ?? null, type: input.types, source, mode, documents });
	return { text: texteWeb(prompts, token), token, mode };
}

export type RelayRefusal = "empty" | "too-large" | "none" | "several" | "other-request" | "invalid" | "no-questions" | "format";
export type Extracted = { ok: true; questions: unknown[]; title?: string } | { ok: false; reason: RelayRefusal; detail?: string };

const TOKEN_LINE = /^\s*\/\/\s*neo-quiz\s+([a-z0-9]{6,20})\s*$/;
const FENCE = /```([^\n`]*)\n([\s\S]*?)```/g;
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Copies the value without prototype keys; null if a non-finite number is met. */
function clean(value: unknown): { v: unknown } | null {
	if (typeof value === "number") return Number.isFinite(value) ? { v: value } : null;
	if (Array.isArray(value)) {
		const out: unknown[] = [];
		for (const x of value) { const c = clean(x); if (!c) return null; out.push(c.v); }
		return { v: out };
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, x] of Object.entries(value as Record<string, unknown>)) {
			if (BAD_KEYS.has(k)) continue;
			const c = clean(x);
			if (!c) return null;
			out[k] = c.v;
		}
		return { v: out };
	}
	return { v: value };
}

/** The candidate quiz bodies: `quiz-blocks` fences, and json5/json fences whose first line is the relay's token comment. */
function candidates(text: string): { bodies: string[]; tokens: string[] } {
	const bodies: string[] = [], tokens: string[] = [];
	for (const m of text.matchAll(FENCE)) {
		const lang = m[1].trim().toLowerCase(), body = m[2];
		const first = TOKEN_LINE.exec(body.split("\n", 1)[0]);
		if (first) tokens.push(first[1]);
		if (lang === "quiz-blocks" || ((lang === "json5" || lang === "json") && first)) bodies.push(body);
	}
	return { bodies, tokens };
}

/** Finds the quiz in a pasted answer, parses and checks it. Never throws. */
export function extractQuizAnswer(pasted: string, mode: "learn" | "practice", token?: string): Extracted {
	try {
		if (!pasted.trim()) return { ok: false, reason: "empty" };
		if (pasted.length > MAX_ANSWER_CHARS) return { ok: false, reason: "too-large" };
		const { bodies, tokens } = candidates(pasted);
		if (token && tokens.some(x => x !== token)) return { ok: false, reason: "other-request" };
		if (bodies.length > 1) return { ok: false, reason: "several" };
		let body: string;
		if (bodies.length === 1) body = bodies[0];
		else {
			const open = pasted.indexOf("["), close = pasted.lastIndexOf("]");
			if (open < 0 || close <= open) return { ok: false, reason: "none" };
			body = pasted.slice(open, close + 1);
		}
		let parsed;
		try { parsed = parseReponseQuiz(body); }
		catch (e) {
			if (e instanceof NoQuizAnswer) return { ok: false, reason: "none" };
			return { ok: false, reason: "invalid", detail: e instanceof Error ? e.message : String(e) };
		}
		const copy = clean(parsed.questions);
		if (!copy) return { ok: false, reason: "invalid", detail: "non-finite number" };
		const questions = (copy.v as unknown[]).filter(q => !!q && typeof q === "object" && !Array.isArray(q));
		if (questions.length === 0) return { ok: false, reason: "no-questions" };
		const manques = verifierFormat(mode, questions);
		if (manques.length) return { ok: false, reason: "format", detail: JSON.stringify(manques) };
		return { ok: true, questions, title: parsed.titre };
	} catch (e) {
		return { ok: false, reason: "invalid", detail: e instanceof Error ? e.message : String(e) };
	}
}
