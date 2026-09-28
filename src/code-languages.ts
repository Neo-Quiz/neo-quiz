/* ══════════════════════════════════════════════════════════
   THE RULES OF CODE EXECUTION, PURE (2026-09-28, spec
   2026-09-28-c-cpp-execution-design.md §3-§5).

   One place for what the engine (▶ on a block), the format check (the
   `runInLastHint` field) and the editor (its switch) must all decide the
   same way: which block languages run, which question asks for a
   program's OUTPUT, when `runInLastHint` makes sense, and when ▶ shows.
   No DOM, no host, no engine context.
   ══════════════════════════════════════════════════════════ */
import { niveauxIndice } from "./quiz-hint";

export type CodeLanguage = "python" | "c" | "cpp";

const ALIASES: Readonly<Record<string, CodeLanguage>> = {
	python: "python", py: "python",
	c: "c", h: "c",
	cpp: "cpp", "c++": "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
};

/** The language a fenced block's tag names, or `null` if it does not run.
    Same class of bug as `code-highlight.ts`'s M1 (review of 2026-09-26):
    `ALIASES` is a plain object literal, so a tag of `constructor` or
    `__proto__` would otherwise read the INHERITED property of that name on
    `Object.prototype` (a function, an object — always truthy) instead of
    falling through to `null`. Surfaced here by task 5 of the C/C++
    execution plan (2026-09-28): once every table entry gets a runnable
    wrapper, that inherited truthy value wrongly wrapped a plain
    "```constructor" block as if it were executable. `hasOwnProperty.call`,
    not `Object.hasOwn` (ES2022): outside this repo's ES2020 TS target,
    same as `code-highlight.ts`. */
export function langageDeBloc(tag: string): CodeLanguage | null {
	const cle = String(tag ?? "").trim().toLowerCase();
	return Object.prototype.hasOwnProperty.call(ALIASES, cle) ? ALIASES[cle] : null;
}

/* ── Program-output questions (moved from engine/terminal.ts) ── */

/** Variant name of a terminal, brought to its canonical form.
    Lives at the MODULE level and is EXPORTED, because the editor needs it as much
    as the engine: `editor/convert.ts` recognized only `terminalVariant: 'cmd'`,
    `textVariant: 'powershell'` and `textVariant: 'bash'` — three exact forms. 22 real
    Cisco questions write `textVariant: 'command'`, which the engine displays well
    in terminal `cmd` but which the editor took for plain text: the first save erased
    the variant AND its prompt (`Town-Hall#`, `Router>`…). A single table of aliases,
    two readers. */
export function normalizeTerminalVariantName(value: unknown): string | null {
	const raw = String(value ?? "").trim().toLowerCase();
	if (!raw) return null;

	if ([
		"command",
		"cmd",
		"windows-cmd",
		"windows cmd",
		"invite-de-commandes",
		"invite de commandes"
	].includes(raw)) return "cmd";

	if ([
		"powershell",
		"ps",
		"pwsh",
		"windows-powershell",
		"windows powershell",
		"power-shell",
		"power shell"
	].includes(raw)) return "powershell";

	if ([
		"bash",
		"shell",
		"sh",
		"zsh",
		"terminal",
		"linux"
	].includes(raw)) {
		return (raw === "terminal" || raw === "linux") ? "bash" : raw;
	}

	return raw.replace(/\s+/g, "-");
}

/** The true command prompts (return #2, 2026-09-26 evening): they alone
    keep the fake-terminal (prompt + simulated caret, single line). Any
    other normalized variant (`python`, `java`…) is a PROGRAM LANGUAGE:
    its answer is OUTPUT, not a command to type — see `isProgramOutputQuestion`. */
const SHELL_VARIANTS = new Set(["cmd", "powershell", "bash", "sh", "zsh"]);

export const isShellVariant = (variant: string | null | undefined): boolean =>
	!!variant && SHELL_VARIANTS.has(variant);

function isTextQuestion(q: unknown): q is Record<string, unknown> {
	if (!q || typeof q !== "object") return false;
	const o = q as { type?: unknown; text?: unknown };
	return o.type === "text" || o.text === true;
}

/** The terminal variant a text question names, the engine's own reading. */
export function terminalVariantOf(q: unknown): string | null {
	if (!isTextQuestion(q)) return null;
	const o = q as { terminalVariant?: unknown; textVariant?: unknown; text?: { variant?: unknown }; terminal?: { variant?: unknown }; command?: unknown };
	for (const candidate of [o.terminalVariant, o.textVariant, o.text?.variant, o.terminal?.variant]) {
		const normalized = normalizeTerminalVariantName(candidate);
		if (normalized) return normalized;
	}
	return o.command === true ? "cmd" : null;
}

/** A question whose answer is what a PROGRAM prints (a terminal variant that
    is a language, not a shell prompt). */
export function isProgramOutputQuestion(q: unknown): boolean {
	const v = terminalVariantOf(q);
	return !!v && !isShellVariant(v);
}

/* ── Runnable blocks of a text, and `runInLastHint` ── */

const FENCE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n]*\n[\s\S]*?\n[ \t]*\1[ \t]*$/gm;

/** Languages of the fenced blocks of `markdown` that can run, in order. */
export function blocsExecutablesDe(markdown: string): CodeLanguage[] {
	const out: CodeLanguage[] = [];
	for (const m of String(markdown ?? "").matchAll(FENCE_RE)) {
		const lang = langageDeBloc(m[2]);
		if (lang) out.push(lang);
	}
	return out;
}

export type RunInLastHintProbleme = "noRunnableBlock" | "notEnoughHintLevels" | "programOutput";

/** Why `runInLastHint` cannot apply to this question, or `null` if it can. */
export function runInLastHintProbleme(q: unknown): RunInLastHintProbleme | null {
	const o = (q ?? {}) as { prompt?: unknown; hint?: unknown };
	if (blocsExecutablesDe(typeof o.prompt === "string" ? o.prompt : "").length === 0) return "noRunnableBlock";
	if (niveauxIndice(o.hint).length < 2) return "notEnoughHintLevels";
	if (isProgramOutputQuestion(q)) return "programOutput";
	return null;
}

/** Does ▶ show on a block? A statement's program only once corrected — or,
    for a question carrying `runInLastHint`, once all its hint levels have
    been revealed. Readings, explanations and hints: always. */
export function executionVisible(p: { inStatement: boolean; reading: boolean; corrected: boolean; runInLastHint: boolean; allHintLevelsSeen: boolean }): boolean {
	if (!p.inStatement || p.reading || p.corrected) return true;
	return p.runInLastHint && p.allHintLevelsSeen;
}
