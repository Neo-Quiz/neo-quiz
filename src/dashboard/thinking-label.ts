/* PURE helpers for the "thinking" lines, after claude.ai (2026-10-18): while
   the model thinks, a short rotating phrase (no timer, no token count); once
   it has finished, one grey summary line, else a plain "Thought". No DOM, no
   host: `check:work-view` loads it as is. */

/** How long each rotating phrase stays on screen. */
export const VERB_STEP_MS = 4000;

/** The longest summary shown for a finished thought (characters). */
export const SUMMARY_MAX = 100;

/** The rotating phrase for a given elapsed time. `verbs` is the `|`-separated
    list of the dictionary (`ai.queue.verbs`). It follows the time elapsed
    since the thinking STARTED, so every repaint and every clock tick agree on
    it without any state. */
export function verbAt(verbs: string, elapsedMs: number): string {
	const list = verbs.split("|").map(v => v.trim()).filter(Boolean);
	if (list.length === 0) return "";
	return list[Math.floor(Math.max(0, elapsedMs) / VERB_STEP_MS) % list.length];
}

/** The summary line of a finished thought: its first sentence (or line), cut
    to `SUMMARY_MAX` characters, markdown emphasis marks removed. "" when the
    model shared no text. */
export function thoughtSummary(text: string | undefined): string {
	const clean = (text ?? "").replace(/[*_`#>]+/g, "").trim();
	if (!clean) return "";
	const line = clean.split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? "";
	const sentence = /^(.+?[.!?…])(\s|$)/.exec(line)?.[1] ?? line;
	if (sentence.length <= SUMMARY_MAX) return sentence;
	return sentence.slice(0, SUMMARY_MAX - 1).trimEnd() + "…";
}

/** True while a running reply has shown no sign of work yet: the preparation
    step and a transcript with no text, no reasoning and no tool. The line then
    wears the pulsing dot alone (no logo, no words). */
export function avantPremierJeton(etape: string, tr: { text: string; thinking: string; thinkingTokens: number; tools: readonly unknown[] } | null | undefined): boolean {
	if (etape !== "preparation") return false;
	return !tr || (!tr.text && !tr.thinking && tr.thinkingTokens === 0 && tr.tools.length === 0);
}

/** Which label a thinking row wears: the live phrase, the summary of the
    finished thought, or the plain fallback ("Thought"). */
export function thinkingLabel(opts: { live: boolean; text?: string; verbs: string; elapsedMs: number; fallback: string }): string {
	if (opts.live) return verbAt(opts.verbs, opts.elapsedMs) || opts.fallback;
	return thoughtSummary(opts.text) || opts.fallback;
}
