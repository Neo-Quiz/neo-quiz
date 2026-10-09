/* ══════════════════════════════════════════════════════════
   CLAUDE CODE WITH READ-ONLY TOOLS: THE OPTIONS THE PAGE SENDS (2026-10-09)

   The tail of the `claude -p` call that runs in a folder the user trusted,
   after the model and the effort. PURE (no Node, no DOM): `ai-client.ts`
   builds its call from it, and `npm run check:partage` checks that this
   exact list is the form the main process accepts
   (`apps/windows/electron/gabarits-cli.ts`, `argumentsAvecOutils`), which
   keeps its OWN copy: the main process never trusts the page's list, and a
   change on one side alone turns the check red.

   What each option does, and how it was measured, is written next to the
   main process's copy.
══════════════════════════════════════════════════════════ */

export const ARGS_OUTILS_CLAUDE: readonly string[] = [
	"--tools", "Read,Grep,Glob",
	"--allowedTools", "Read(./**)",
	"--disallowedTools", "Bash,PowerShell,Write,Edit,MultiEdit,NotebookEdit,Task,Agent,WebFetch,WebSearch,mcp__*",
	"--permission-mode", "dontAsk",
	"--permission-prompts", "none",
	"--restricted",
	"--no-session-persistence",
	"--setting-sources", "",
	"--settings", "{\"disableAllHooks\":true}",
	"--strict-mcp-config",
	"--mcp-config", "{\"mcpServers\":{}}",
];

/** True when a CLI's error output says it does not know one of these
    options (a Claude Code older than the one they were measured on): the
    call is then made again WITHOUT tools, as before 2026-10-09, rather than
    failing the generation. */
export function optionInconnue(stderr: string): boolean {
	return /unknown option|unrecognized option|invalid option/i.test(String(stderr || ""));
}
