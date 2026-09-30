/* ══════════════════════════════════════════════════════════
   THE INSTALL COMMAND OF A CLI: A SINGLE SOURCE

   This module is PURE: no DOM, no Node, no Obsidian, no translation. Its one
   consumer is `dashboard/ai-install-modal.ts`, which SHOWS the command in the
   manual path of the install window (colored by tokens, copyable).

   Until 2026-09-30 the same text was also RUN, in a terminal opened by an
   "Install automatically" button (`commandeInstallationLancee`, a variant with
   a few differences). That button is gone (decision of 2026-09-30: less code
   that launches commands means less security surface to watch; the manual way
   is easy and reliable), and with it the second form. What the user copies is
   now the only form there is.

   WHY `-NoProfile` ON WINDOWS. Codex's own documented form, run from a
   PowerShell whose profile loads, died in the owner's test VM on 2026-09-18
   with "The property 'OSArchitecture' cannot be found" (openai/codex issues
   #19559 and #36247: the failure comes from the PowerShell profile). Running
   the script in a sub-process that skips the profile avoids it, and the sub-
   process also keeps the `exit 1` that Claude's `install.ps1` performs on
   every failure from closing the window the user typed it in. Claude and
   Antigravity get the same wrapper as a precaution.

   THIS MODULE GIVES THE RENDERER NO RIGHT: nothing here crosses the IPC, and
   no command is ever sent to the main process.
══════════════════════════════════════════════════════════ */

/** The tools we can show an install command for. Deliberately this type and
    not the host contract's `CliTool`: this module depends on nothing. */
export type OutilInstallable = "claude" | "codex" | "ollama" | "agy";

/** The command SHOWN in the manual path of the install window. `lang` drives
    the coloring of the code block.

    Official forms, checked on 2026-07-14 (Claude: code.claude.com/docs/en/
    setup; Codex: learn.chatgpt.com/docs/codex/cli; Ollama: the official winget
    package). On Windows, the PowerShell scripts run in a `-NoProfile`
    sub-process (see the header). */
export function commandeInstallation(outil: OutilInstallable, windows: boolean): { code: string; lang: string } {
	if (outil === "claude") {
		return windows
			? { code: 'powershell -NoProfile -ExecutionPolicy ByPass -c "irm https://claude.ai/install.ps1 | iex"', lang: "powershell" }
			: { code: "curl -fsSL https://claude.ai/install.sh | bash", lang: "bash" };
	}
	if (outil === "codex") {
		return windows
			? { code: 'powershell -NoProfile -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"', lang: "powershell" }
			: { code: "curl -fsSL https://chatgpt.com/codex/install.sh | sh", lang: "bash" };
	}
	/* ANTIGRAVITY CLI (`agy`), the replacement of Gemini CLI, which Google closed
	   to individual accounts in June 2026 (`IneligibleTierError`). A Go binary
	   put in place by the official installer, like Claude and Codex: nothing to
	   have beforehand. Forms checked on 2026-09-20 against
	   antigravity.google/docs/cli/install. */
	if (outil === "agy") {
		return windows
			? { code: 'powershell -NoProfile -ExecutionPolicy ByPass -c "irm https://antigravity.google/cli/install.ps1 | iex"', lang: "powershell" }
			: { code: "curl -fsSL https://antigravity.google/cli/install.sh | bash", lang: "bash" };
	}
	return windows
		? { code: "winget install --id Ollama.Ollama -e", lang: "powershell" }
		: { code: "curl -fsSL https://ollama.com/install.sh | sh", lang: "bash" };
}
