import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { t } from "../i18n";
import { MODES_AGENT, lireModeAgent } from "../host/claude-outils";
import type { ModeAgent } from "../host/claude-outils";
import { openActionMenu } from "./ui-select";

/* THE AGENT MODE CHIP (2026-10-10, MonoCode's chip): how freely the CLI acts in
   the quiz's trusted folder. Read by `ai-client.ts` (`lireModeAgent`), judged
   again by the main process. Shared by the composer of the AI page and the one
   of the "Explain" chat (2026-10-17): both run the same agent, both show it. */

const ICONES_MODE: Record<ModeAgent, string> = { supervised: "lock", acceptEdits: "file-pen-line", auto: "sparkles", full: "shield-alert" };

export interface AgentModePillDeps {
	/** The stored `aiAgentMode` (read at each paint). */
	read: () => unknown;
	save: (mode: ModeAgent) => Promise<void>;
	/** Codex words "accept edits" its own way. */
	isClaude: () => boolean;
}

/** Adds the chip to `parent` and returns its repaint. */
export function mountAgentModePill(parent: HTMLElement, deps: AgentModePillDeps): { el: HTMLButtonElement; paint: () => void } {
	const host = currentHost();
	const modeBtn = ajouter(parent, "button", "qbd-select qbd-agent-mode-trigger qbd-composer-plain");
	modeBtn.type = "button";
	const modeIcone = ajouter(modeBtn, "span", "qbd-agent-mode-icon");
	const modeLabel = ajouter(modeBtn, "span", "qbd-select-label");
	const paint = (): void => {
		const m = lireModeAgent(deps.read());
		host.ui.setIcon(modeIcone, ICONES_MODE[m]);
		modeLabel.textContent = t(`ai.agentMode.${m}`);
		modeBtn.classList.toggle("is-full", m === "full");
		modeBtn.setAttribute("aria-label", t("ai.agentMode.label") + " : " + t(`ai.agentMode.${m}`));
	};
	paint();
	modeBtn.addEventListener("click", () => {
		const courant = lireModeAgent(deps.read());
		openActionMenu(modeBtn, MODES_AGENT.map(m => ({
			icon: ICONES_MODE[m],
			label: t(`ai.agentMode.${m}`),
			sub: t(!deps.isClaude() && m === "acceptEdits" ? "ai.agentMode.acceptEditsCodexSub" : `ai.agentMode.${m}Sub`),
			checked: m === courant,
			onClick: () => { void deps.save(m).then(paint); },
		})), { className: "qbd-agent-mode-menu" });
	});
	return { el: modeBtn, paint };
}
