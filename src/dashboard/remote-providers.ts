/* The allow-list of providers a REMOTE request (typed on another device) may
   run with. Its own module so the queue can enforce it at launch time too. */

/** Providers PROVEN tool-free in this code base: Claude Code launched with
    `--tools ""` (only when no image is attached: `ai-client.ts` then grants
    `Read`) and Ollama (an HTTP completion, no process). Codex has an
    always-on shell tool whose read-only sandbox still READS the whole disk,
    and Antigravity is an agent with tools: a request typed on another device
    (attacker text, if that device is compromised) must never reach them. */
const TOOL_FREE_PROVIDERS: readonly string[] = ["claude-code", "ollama"];

/** Whether a REMOTE request may run with this provider. Unknown or empty: refused. */
export function remoteProviderAllowed(provider: string | undefined, imageCount = 0): boolean {
	if (!provider || !TOOL_FREE_PROVIDERS.includes(provider)) return false;
	return !(provider === "claude-code" && imageCount > 0);
}
