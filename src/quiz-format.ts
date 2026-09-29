import type { QuestionRole } from "./types/quiz";
import { findQuizModeConfigIndex, parseQuizSource, QUIZ_BLOCK_RE } from "./quiz-utils";
import { aIndice } from "./quiz-hint";
import { runInLastHintProbleme } from "./code-languages";

export { EXAM_DURATION_MIN, EXAM_DURATION_MAX, clampExamDuration, fallbackExamDuration } from "./quiz-utils";

/**
 * THE LEARN / TEST FORMAT — a PURE module: no host, no DOM, no clock.
 *
 * Specs: docs/superpowers/specs/2026-09-23-learn-practice-design.md §1-§2,
 * superseded in part by 2026-09-29-test-practice-exam-design.md §1. Two
 * kinds of quiz: a Learn (`mode: "learn"`) and a Test, which is either a
 * Practice (no mode) or an Exam (`mode: "exam"`, timed). Any other block is
 * a Practice — including the retired `lesson` mode and the `examMode` /
 * `learnMode` booleans, which the format no longer knows.
 *
 * This module is the VOCABULARY shared by three readers that must never
 * diverge: the prompt (`composerPrompts` describes `CHAMPS_DECRITS`), the
 * arrival check (`verifierFormat`), and Practice generation, which attaches
 * the slice plan of the Learn (`planDesTranches`). `npm run
 * check:quiz-format` and `npm run check:prompt` hold it.
 */

export type ModeQuiz = "learn" | "practice" | "exam";

/** What a GENERATION produces: a Learn or a Test file (`"practice"`). An
    Exam is never generated (spec 2026-09-29-test-setup-modal §4): a Test
    becomes one when it is started, or when "Keep exam mode" writes
    `mode: "exam"` into its configuration (`dashboard/exam-keep.ts`). */
export type ModeGeneration = Exclude<ModeQuiz, "exam">;

/** What the prompt of EACH generated type must name, word for word: a field
    the arrival check requires but the prompt keeps quiet about is never
    produced (test of 2026-09-23: `explain` missing from the prompt, no
    explanation at all). */
export const CHAMPS_DECRITS: Readonly<Record<ModeGeneration, readonly string[]>> = {
	learn: ['"slice"', '"role"', '"pre"', '"read"', '"explain"', '"recall"', '"hint"', 'mode: "learn"', '"objectives"', '"topic"', '"flashcard"',
		// Reading styles (2026-09-26, reading styles spec §4): the keys and their values.
		'"lecture"', '"page"', '"etapes"', '"tableau"', '"colonnes"', '"lignes"', '"retenir"', '"forme"', '"cartes"', '"recap"', '"recto"', '"verso"', '"methode"',
		// Glossary (batch D, 2026-09-27, spec §6): generation writes it in the
		// final configuration, next to `objectives`.
		'"glossary"', '"term"', '"definition"',
		// Code execution (2026-09-28, task 7 of the C/C++ plan): the field that
		// unlocks ▶ on the question's program once its last hint level is
		// revealed.
		"runInLastHint"],
	practice: ['"explain"', '"hint"', '"topic"', '"slice"',
		// Glossary (batch D, 2026-09-27): replaces "No configuration object".
		'"glossary"', '"term"', '"definition"',
		"runInLastHint"],
};

/** What no prompt may mention any more: the retired modes and fields, and the
    pre-rendered HTML fields — a quiz is written in markdown, as in Discord and
    Obsidian (2026-09-26): naming `promptHtml` to the model invites it to write
    one. */
const COMMON_FORBIDDEN_WORDS: readonly RegExp[] = [
	/\blesson\b/i, /\bexamMode\b/,
	// Retired on 2026-09-29 (spec §1.1): no longer read nor written. A prompt
	// that still named them would have the model write keys nothing reads.
	/\blearnMode\b/, /\bexamAutoSubmit\b/, /\bexamShowTimer\b/,
	/\bpromptHtml\b/, /\bexplainHtml\b/, /\blessonHtml\b/, /\bpassageHtml\b/, /\boptionHtml\b/,
	// The per-question countdown was dropped (2026-09-28): never implemented
	// in the engine, then judged useless. A prompt that still named it would
	// have the model write a field that nothing reads.
	/\btimeLimit\b/,
];

/** The forbidden words of EACH generated type's prompt: the common list,
    plus the Exam's configuration. `mode: "exam"` and its duration stay out of
    the Learn and Test prompts, both: a model that reads them writes an Exam
    nobody asked for (a Test is taken as an Exam only when it is started). */
export const MOTS_INTERDITS: Readonly<Record<ModeGeneration, readonly RegExp[]>> = {
	learn: [...COMMON_FORBIDDEN_WORDS, /mode:\s*"exam"/, /\bexamDurationMinutes\b/],
	practice: [...COMMON_FORBIDDEN_WORDS, /mode:\s*"exam"/, /\bexamDurationMinutes\b/],
};

/** The passages the prompt of EACH mode must contain word for word: the
    markdown instruction. Without it, a model readily writes its readings in
    `<p>`, `<strong>`, `<code>` — which the editor showed as is. */
export const PASSAGES_REQUIS: readonly string[] = [
	"FORMATTING — MARKDOWN ONLY",
	"**bold**, *italic*, `code`",
	"paragraphs separated by an empty line",
	"NEVER write an HTML tag",
	// Request of 2026-09-26: a code block without a language renders without
	// colours (engine/code-highlight.ts) — the prompt must always require it.
	"A code block ALWAYS names its language right on the opening backticks",
];

export type Manque =
	| { kind: "sansExplication"; questions: string[] }
	| { kind: "trancheIncomplete"; slice: number; rolesManquants: QuestionRole[] }
	| { kind: "sansTranche"; questions: string[] }
	| { kind: "trancheInconnue"; questions: string[] }
	| { kind: "sansObjectifs" }
	/** A pre-question without a hint: it is asked BEFORE the reading, knowing
	    nothing — with no help at all, it discourages (2026-09-23). */
	| { kind: "preSansIndice"; questions: string[] }
	/** ANOTHER Learn question without a hint (explain, recall): EVERY
	    question of a Learn has one (feedback of 2026-09-26, #1 and #10).
	    Except readings and flashcards, which have nothing to guess. */
	| { kind: "sansIndice"; questions: string[] }
	/** A flashcard without a back: flipped, it would show nothing to compare. */
	| { kind: "carteSansReponse"; questions: string[] }
	/** `runInLastHint: true` on a question `runInLastHintProbleme`
	    (src/code-languages.ts) rejects: no runnable block in the statement,
	    fewer than two hint levels, or a program output question (task 7 of
	    the C/C++ execution plan, 2026-09-28). */
	| { kind: "runInLastHintInvalide"; questions: string[] };

interface Element {
	title?: unknown; prompt?: unknown; explain?: unknown; explainHtml?: unknown; hint?: unknown;
	slice?: unknown; role?: unknown; mode?: unknown; objectives?: unknown;
	flashcard?: unknown; answer?: unknown; runInLastHint?: unknown;
}

const texte = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const estTranche = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;

/** A flashcard: `flashcard: true`, nothing else (flashcards spec §2). */
export function estCarte(q: unknown): boolean {
	return !!q && typeof q === "object" && (q as { flashcard?: unknown }).flashcard === true;
}

/** A question's name in a notice: its title, else the start of its prompt,
    else its rank. */
function nom(q: Element, i: number): string {
	const t = texte(q.title) ? q.title.trim() : texte(q.prompt) ? q.prompt.trim() : "";
	if (!t) return `#${i + 1}`;
	return t.length > 40 ? t.slice(0, 39) + "…" : t;
}

/** The questions (objects only, original rank kept) and the configuration
    object if there is one. */
function separer(items: readonly unknown[]): { questions: { q: Element; i: number }[]; config: Element | null } {
	const idx = findQuizModeConfigIndex(items);
	const questions: { q: Element; i: number }[] = [];
	items.forEach((it, i) => {
		if (i === idx || !it || typeof it !== "object" || Array.isArray(it)) return;
		questions.push({ q: it as Element, i });
	});
	const config = idx >= 0 ? (items[idx] as Element) : null;
	return { questions, config };
}

/** The block's mode: `mode: "learn"` → Learn, `mode: "exam"` → Exam
    (case and spaces tolerated, as `normalizeQuizMode` does); anything else,
    retired values included, → Practice. */
export function modeDuBloc(items: readonly unknown[]): ModeQuiz {
	const { config } = separer(items);
	const m = config && typeof config.mode === "string" ? config.mode.trim().toLowerCase() : "";
	return m === "learn" ? "learn" : m === "exam" ? "exam" : "practice";
}

/** The mode suffix of a file name: " — Learn" / " — Practice" / " — Exam".
    Persisted data: never translated. */
function suffixeDeMode(mode: ModeQuiz): string {
	return ` — ${mode === "learn" ? "Learn" : mode === "exam" ? "Exam" : "Practice"}`;
}

/** The file name of a generated note: `<base> — Learn` / `<base> — Practice`
    / `<base> — Exam`. The mode stays READABLE in Obsidian's file explorer,
    which has no badge; the application strips it from the displayed title
    (`titreSansMode`) and shows it as a badge right of the type (2026-09-23). */
export function nomDeNote(base: string, mode: ModeQuiz): string {
	return base + suffixeDeMode(mode);
}

/** A note name split into its base and the counter `freeNotePath`
    (dashboard/folder-create.ts) adds on a collision — "CM1 — Exam (2)" →
    { base: "CM1", counter: " (2)" } for an Exam. `null` when the name does
    not end with the suffix of `mode` (with or without a counter). */
export function separerNomDeNote(nom: string, mode: ModeQuiz): { base: string; counter: string } | null {
	const suffixe = suffixeDeMode(mode);
	const m = nom.match(/ \(\d+\)$/);
	const counter = m ? m[0] : "";
	const sans = counter ? nom.slice(0, -counter.length) : nom;
	if (!sans.endsWith(suffixe) || sans.length <= suffixe.length) return null;
	return { base: sans.slice(0, -suffixe.length), counter };
}

/** A note's displayed title: its name WITHOUT the suffix of its mode, which
    the badge already says — a collision counter stays ("CM1 — Exam (2)" →
    "CM1 (2)"). Only the suffix of the block's REAL mode is stripped: a
    Practice named "… — Learn" by hand keeps its whole name. */
export function titreSansMode(nom: string, mode: ModeQuiz): string {
	const parts = separerNomDeNote(nom, mode);
	return parts ? parts.base + parts.counter : nom;
}

export function verifierFormat(mode: ModeQuiz, items: readonly unknown[], tranchesConnues?: readonly number[]): Manque[] {
	const { questions, config } = separer(items);
	const manques: Manque[] = [];
	const cartesSansVerso = questions.filter(({ q }) => estCarte(q) && !texte(q.answer)).map(({ q, i }) => nom(q, i));
	/* `runInLastHint` (task 7 of the C/C++ execution plan, 2026-09-28): shared
	   by every mode, computed before the branch so it ends up in both returns
	   instead of being duplicated. */
	const runInvalides = questions.filter(({ q }) => q.runInLastHint === true && runInLastHintProbleme(q) !== null).map(({ q, i }) => nom(q, i));
	if (runInvalides.length) manques.push({ kind: "runInLastHintInvalide", questions: runInvalides });
	/* A Test (spec 2026-09-29 §4.6; `mode` is the block's REAL mode, so a model
	   that wrote `mode: "exam"` anyway is checked like a Test): an explanation
	   everywhere — it is the whole correction view once the test is handed
	   in — and no flashcard without a back. */
	if (mode !== "learn") {
		const sans = questions.filter(({ q }) => !texte(q.explain) && !texte(q.explainHtml)).map(({ q, i }) => nom(q, i));
		if (sans.length) manques.push({ kind: "sansExplication", questions: sans });
		if (tranchesConnues) {
			const connues = new Set(tranchesConnues);
			const inconnues = questions.filter(({ q }) => estTranche(q.slice) && !connues.has(q.slice)).map(({ q, i }) => nom(q, i));
			if (inconnues.length) manques.push({ kind: "trancheInconnue", questions: inconnues });
		}
		if (cartesSansVerso.length) manques.push({ kind: "carteSansReponse", questions: cartesSansVerso });
		return manques;
	}
	const objectifs = config?.objectives;
	if (!Array.isArray(objectifs) || !objectifs.some(texte)) manques.push({ kind: "sansObjectifs" });
	const horsTranche = questions.filter(({ q }) => !estTranche(q.slice)).map(({ q, i }) => nom(q, i));
	if (horsTranche.length) manques.push({ kind: "sansTranche", questions: horsTranche });
	const roles = new Map<number, Set<string>>();
	for (const { q } of questions) {
		if (!estTranche(q.slice)) continue;
		const s = roles.get(q.slice) ?? new Set<string>();
		s.add(typeof q.role === "string" ? q.role : "test");
		roles.set(q.slice, s);
	}
	const exiges: QuestionRole[] = ["pre", "read", "recall"];
	for (const slice of [...roles.keys()].sort((a, b) => a - b)) {
		const presents = roles.get(slice) as Set<string>;
		const rolesManquants = exiges.filter(r => !presents.has(r));
		if (rolesManquants.length) manques.push({ kind: "trancheIncomplete", slice, rolesManquants });
	}
	// `hint`: a string or an array of levels (src/quiz-hint.ts).
	const preSansIndice = questions.filter(({ q }) => q.role === "pre" && !aIndice(q.hint)).map(({ q, i }) => nom(q, i));
	if (preSansIndice.length) manques.push({ kind: "preSansIndice", questions: preSansIndice });
	const sansIndice = questions
		.filter(({ q }) => q.role !== "pre" && q.role !== "read" && !estCarte(q) && !aIndice(q.hint))
		.map(({ q, i }) => nom(q, i));
	if (sansIndice.length) manques.push({ kind: "sansIndice", questions: sansIndice });
	if (cartesSansVerso.length) manques.push({ kind: "carteSansReponse", questions: cartesSansVerso });
	return manques;
}

/** Two (or more) CONSECUTIVE configuration objects at the end of the array —
    a model sometimes answers in two chunks one after the other, one for the
    mode and the objectives, another for the glossary, in any order:
    `{ mode: "learn", objectives }` then `{ glossary }`, or the reverse.
    Without merging, `findQuizModeConfigIndex` (quiz-utils.ts) keeps only ONE
    — the first order saves the Learn as a Practice with a phantom question
    (the mode is lost, left on the middle object); the second loses the
    glossary AND adds the phantom question (batch D spec §5).
    PURE: reuses the recognition of `findQuizModeConfigIndex`
    (`src/quiz-utils.ts`) rather than writing a second one — removes the
    objects recognised as configuration ONE BY ONE from the end, as long as
    each one is in LAST position (never an object in the middle: that would
    merge a real question). On a key present in two merged configurations,
    a non-empty `mode` and `glossary` win — they are the two fields that make
    the merge worth it; other keys keep the LAST occurrence met. Returns a new
    array; 0 or 1 configuration found → nothing to merge, unchanged copy. */
export function fusionnerConfigsFinales(items: readonly unknown[]): unknown[] {
	const reste = [...items];
	const configs: Record<string, unknown>[] = [];
	while (reste.length > 0 && findQuizModeConfigIndex(reste) === reste.length - 1) {
		configs.unshift(reste.pop() as Record<string, unknown>);
	}
	if (configs.length <= 1) return [...items];
	const nonVide = (v: unknown): boolean =>
		Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : v != null;
	const fusion: Record<string, unknown> = {};
	for (const config of configs) {
		for (const [cle, valeur] of Object.entries(config)) {
			if ((cle === "mode" || cle === "glossary") && !nonVide(valeur) && nonVide(fusion[cle])) continue;
			fusion[cle] = valeur;
		}
	}
	reste.push(fusion);
	return reste;
}

/** A REQUESTED Learn whose model forgot `mode: "learn"`: the configuration is
    completed rather than the path saved as a Practice bank. Gemini 3.5
    Flash-Lite returned a complete path (roles pre / read / explain / recall)
    with `{ objectives: [...] }` last, without `mode` (2026-09-24): the note
    was labelled Practice and the objectives object became an empty question.
    Nothing is touched when no question carries a path role: that would be
    inventing a Learn. Merges split configurations first
    (`fusionnerConfigsFinales`, batch D): without it, a Learn whose glossary
    arrives in a second object would still gain its `mode`, but keep a
    phantom question for the lost glossary.
    PURE: returns a new array. */
export function completerConfigLearn(items: readonly unknown[]): unknown[] {
	const fusionne = fusionnerConfigsFinales(items);
	if (modeDuBloc(fusionne) === "learn") return fusionne;
	const { questions } = separer(fusionne);
	const parcours = questions.some(({ q }) => q.role === "pre" || q.role === "read" || q.role === "explain" || q.role === "recall");
	if (!parcours) return fusionne;
	const copie = [...fusionne];
	/* The objectives object, without a prompt: it is the configuration the
	   model meant to write. It keeps its objectives and receives the mode. */
	const idx = copie.findIndex(it => !!it && typeof it === "object" && !Array.isArray(it)
		&& Array.isArray((it as Element).objectives) && !texte((it as Element).prompt));
	if (idx >= 0) {
		copie[idx] = { ...(copie[idx] as object), mode: "learn" };
		return copie;
	}
	copie.push({ mode: "learn" });
	return copie;
}

export function planDesTranches(items: readonly unknown[]): { slice: number; titre: string }[] {
	const titres = new Map<number, string>();
	for (const { q, i } of separer(items).questions) {
		if (!estTranche(q.slice)) continue;
		if (q.role === "read" || !titres.has(q.slice)) titres.set(q.slice, nom(q, i));
	}
	return [...titres.entries()].sort((a, b) => a[0] - b[0]).map(([slice, titre]) => ({ slice, titre }));
}

/** The first `quiz-blocks` block of a note, decoded; `null` without a block
    or on unreadable JSON5 — never an exception: a damaged Learn note must not
    make the generation of its Practice fail. */
export function lireBlocQuiz(markdown: string): unknown[] | null {
	const m = markdown.match(QUIZ_BLOCK_RE);
	if (!m) return null;
	try {
		return parseQuizSource(m[1], { logErrors: false }) as unknown[];
	} catch {
		return null;
	}
}
