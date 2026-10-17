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

/** The confinement shared by both forms that give the model a tool. */
const RESTRICTIONS: readonly string[] = [
	"--allowedTools", "Read(./**)",
	"--disallowedTools", "Bash,PowerShell,Write,Edit,MultiEdit,NotebookEdit,Task,Agent,WebFetch,WebSearch,mcp__*,Read(./.neo-quiz/**),Grep(./.neo-quiz/**),Glob(./.neo-quiz/**)",
	"--permission-mode", "dontAsk",
	"--permission-prompts", "none",
	"--restricted",
	"--no-session-persistence",
	"--setting-sources", "",
	"--settings", "{\"disableAllHooks\":true}",
	"--strict-mcp-config",
	"--mcp-config", "{\"mcpServers\":{}}",
];

/** Read, search and list, in a folder the user trusted. */
export const ARGS_OUTILS_CLAUDE: readonly string[] = ["--tools", "Read,Grep,Glob", ...RESTRICTIONS];

/** Read only, to look at the attached pictures, with no trusted folder:
    the main process runs it IN the temporary folder of the attachments. */
export const ARGS_IMAGES_CLAUDE: readonly string[] = ["--tools", "Read", ...RESTRICTIONS];

/** True when a CLI's error output says it does not know one of these
    options (a Claude Code older than the one they were measured on): the
    call is then made again WITHOUT tools, as before 2026-10-09, rather than
    failing the generation. */
export function optionInconnue(stderr: string): boolean {
	return /unknown option|unrecognized option|invalid option/i.test(String(stderr || ""));
}

/* ══════════════════════════════════════════════════════════
   AGENT MODES (2026-10-10)

   The owner's decision: Claude Code and Codex run for real in the quiz's
   folder, "as if a PowerShell terminal had been opened in it", with the four
   modes of MonoCode. Prompt injection by a received file was explained and
   accepted. The folder is still one the user trusted in the native dialog,
   and the main process still judges it (`canaux.ts`); it keeps its OWN copy
   of these forms (`apps/windows/electron/gabarits-cli.ts`), compared by
   `npm run check:partage`.

   Measured on Claude Code 2.1.296 and Codex 0.162.1 under Windows, in a
   throwaway folder:
   - Claude `acceptEdits` with `--restricted`: a Write lands, a shell command
     is not run. `auto`: the classifier approved and ran `echo > d.txt`.
     `--dangerously-skip-permissions`: commands run.
   - Codex `-s workspace-write` stays READ-ONLY on Windows (it refused to
     create a file), so the two middle modes use `--approve-for-me` (an AI
     reviewer approves; it ran the command). `--dangerously-bypass-approvals-
     and-sandbox`: commands run.
══════════════════════════════════════════════════════════ */

export type ModeAgent = "supervised" | "acceptEdits" | "auto" | "full";
export const MODES_AGENT: readonly ModeAgent[] = ["supervised", "acceptEdits", "auto", "full"];
/** A stored mode, or Full access (the owner's choice) for anything else. */
export function lireModeAgent(v: unknown): ModeAgent {
	return MODES_AGENT.includes(v as ModeAgent) ? v as ModeAgent : "full";
}

/* AS IN A TERMINAL (2026-10-17, the owner's decision: "exactly as if I had
   launched it in Warp"). A call made FROM THIS PC loads the user's own
   settings, hooks, skills, MCP servers and CLAUDE.md, as a terminal opened in
   the folder would; Neo Quiz adds no restriction of its own, only the mode of
   the composer's chip. `--permission-prompts none`: headless, a prompt nobody
   can answer is denied instead of hanging. Measured modes of Claude Code
   2.1.302: acceptEdits, auto, bypassPermissions, manual, dontAsk, plan. */
export function argsAgentClaude(mode: ModeAgent): readonly string[] {
	switch (mode) {
		case "supervised": return ["--permission-mode", "dontAsk"];
		case "acceptEdits": return ["--permission-mode", "acceptEdits", "--permission-prompts", "none"];
		case "auto": return ["--permission-mode", "auto", "--permission-prompts", "none"];
		case "full": return ["--dangerously-skip-permissions"];
	}
}

/* ANTIGRAVITY (2026-10-17): `agy` runs as an agent too, the owner's choice.
   Measured on the agy of that day in a throwaway folder: `--mode plan` reads
   and answers but writes nothing and runs nothing; `--mode accept-edits`
   writes a file, a command is auto-denied (headless mode cannot ask);
   `--mode auto` falls back to that default where the account lacks it;
   `--dangerously-skip-permissions` writes and runs. The call WITHOUT tools
   puts `--mode plan` FIRST (`ARGS_AGY_SANS_OUTILS`): the default mode wrote
   files in the home folder it runs in. */
export const ARGS_AGY_SANS_OUTILS: readonly string[] = ["--mode", "plan"];

/** The mode options of the Antigravity call in a trusted folder, per mode. */
export function argsAgentAntigravity(mode: ModeAgent): readonly string[] {
	switch (mode) {
		case "supervised": return ["--mode", "plan"];
		case "acceptEdits": return ["--mode", "accept-edits"];
		case "auto": return ["--mode", "auto"];
		case "full": return ["--dangerously-skip-permissions"];
	}
}

/** The sandbox options of the Codex call in a trusted folder, per mode. */
export function argsAgentCodex(mode: ModeAgent): readonly string[] {
	switch (mode) {
		case "supervised": return ["-s", "read-only"];
		case "acceptEdits": case "auto": return ["--approve-for-me"];
		case "full": return ["--dangerously-bypass-approvals-and-sandbox"];
	}
}
