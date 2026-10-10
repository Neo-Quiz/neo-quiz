/* ══════════════════════════════════════════════════════════
   A MODEL'S LIMIT, TOLD IN WORDS THE LEARNER CAN ACT ON (2026-10-10).

   A long Learn generation ended after half an hour on "JSON5: invalid
   character 'R' at 1:1": the answer was not a quiz, and the error said
   nothing a learner could act on. When a CLI hits a size limit it says so in
   a recognisable sentence; this module recognises it so the page can say
   "the answer was too long" or "the request was too long" instead. PURE.

   Recognised sentences (only what the CLIs actually print):
   - output: Claude Code's "API Error: Claude's response exceeded the 32000
     output token maximum. To configure this behavior, set the
     CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable." (read in
     `claude.exe`);
   - context: the API's "prompt is too long", Codex's "ran out of room in
     the model's context window" and "exceeds the context window", and the
     error code `context_length_exceeded`.
══════════════════════════════════════════════════════════ */

export type ModelLimit = "output" | "context";

const SORTIE = [
	/response exceeded the [\d,.\s]+ output token maximum/i,
	/\bCLAUDE_CODE_MAX_OUTPUT_TOKENS\b/,
];
const CONTEXTE = [
	/\bprompt is too long\b/i,
	/\bcontext_length_exceeded\b/i,
	/\bexceeds the context window\b/i,
	/ran out of room in the model'?s context window/i,
];

/** How much of a model's TEXT is searched for a context sentence: an error
    message is short and comes first, while a quiz about language models may
    well quote one of these sentences further down. */
const DEBUT_TEXTE = 600;

/** Which limit `erreur` (the CLI's own error text: stderr, error events) or
    the start of `texte` (the answer that could not be read) names, or `null`. */
export function detectModelLimit(erreur: string, texte = ""): ModelLimit | null {
	const debut = texte.slice(0, DEBUT_TEXTE);
	if (SORTIE.some(re => re.test(erreur) || re.test(texte))) return "output";
	if (CONTEXTE.some(re => re.test(erreur) || re.test(debut))) return "context";
	return null;
}
