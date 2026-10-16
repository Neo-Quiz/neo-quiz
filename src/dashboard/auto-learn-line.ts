import type { AiSettings } from "../types/dashboard-ctx";

/* AN AUTOMATIC LINE of the generation queue (spec 2026-10-15-moodle-auto-learn):
   the Learn of a new Moodle lecture, queued with nobody at this PC.
   - It ALWAYS runs in the Supervised form (read-only tools, Claude Code tail
     `ARGS_OUTILS_CLAUDE`, Codex `-s read-only`), whatever the user's agent
     mode: the lecture is a PDF from the Internet, processed with nobody
     watching, so a prompt injection hidden in it must find no tool that
     writes, runs a command or talks to the network.
   - It NEVER runs as a turn of the chat's live session: a live session loads
     the user's own settings, hooks, skills and MCP servers, none of which a
     document nobody read should reach.
   Pure: `check:partage` proves that no user mode and no frozen value lifts it. */

/** An automatic Learn of a new Moodle lecture: its de-duplication key and its path relative to the default root. */
export interface AutoLine { key: string; relPath: string }

/** The provider key of a gate pause: it holds the automatic chat only, never the manual lines of that provider (a real usage-limit pause still uses the bare provider). */
export const AUTO_PAUSE_PREFIX = "auto:";

/** The settings a line runs with: the live settings, then the frozen ones; an automatic line is forced to Supervised LAST, so nothing frozen or stored can lift it. */
export function reglagesDeLigne(vivants: AiSettings, d: { reglages: Partial<AiSettings>; auto?: AutoLine }): AiSettings {
	const s: AiSettings = { ...vivants, ...d.reglages };
	return d.auto ? { ...s, aiAgentMode: "supervised" } : s;
}

/** May this line run as a turn of the chat's live session? Never a request from another device, never an automatic line (a live session loads the user's own hooks, skills and MCP servers). */
export function liveDeLigne(d: { fromDevice?: string; auto?: AutoLine }): boolean {
	return !d.fromDevice && !d.auto;
}
