/* ══════════════════════════════════════════════════════════
   THE WINDOW OF A MISSING PROVIDER: THE OFFICIAL COMMAND, TO COPY

   Spec "usable by anyone" (2026-09-17, section 3b), reworked on 2026-09-30:
   the AUTOMATIC installation (a button that had the host open PowerShell and
   run the recipe) is gone. Less code that launches commands is less security
   surface to watch, and the manual way is easy and fully reliable. The
   window says what the tool is in one sentence, shows the official command
   (copyable), offers an "Open a terminal" button (the host opens an EMPTY
   PowerShell window and runs nothing: `HostProcess.openTerminal`, no
   argument), and keeps, collapsed, a "Doesn't work?" help block with the
   failures seen in practice.

   Two states: `initial` (the probe of the provider runs every 3 s from the
   moment the window opens) and `detecte` (the page wrote the provider to the
   settings, the window closes by itself). The probe is stopped on close AND
   on detection: never an orphan timer.
══════════════════════════════════════════════════════════ */
import { LOG_PREFIX } from "../branding";
import { getProvider, setBrandLogo } from "./ai-providers";
import { commandeInstallation } from "../cli-install-cmd";
import { ajouter } from "../dom";
import { currentHost, requireHost } from "../host/current";
import { t } from "../i18n";
import { renderCollapsibleSection } from "./collapsible";

export type InstallProvider = "claude-code" | "codex" | "ollama" | "antigravity-cli";

export interface InstallModalDeps {
	provider: InstallProvider;
	/** The provider's probe, forced (no TTL). */
	probe(): Promise<{ ok: true; version?: string } | { ok: false }>;
	/** Called once on detection: the page writes the provider to the settings. */
	onDetected(): Promise<void>;
	/** Called on close, whatever the state: the page refreshes statuses and
	    hints. `detecte` says whether the close follows a DETECTION rather than
	    an abandon: the page uses it to chain on the sign-in without waiting
	    for one more click. */
	onClose(detecte: boolean): void;
	copyText?(texte: string): Promise<boolean>;
	renderCodeBlock?(host: HTMLElement, code: string, lang: string): void;
}

const NOMS: Record<InstallProvider, string> = { "claude-code": "Claude Code", codex: "Codex CLI", ollama: "Ollama", "antigravity-cli": "Antigravity CLI" };
const OUTILS: Record<InstallProvider, "claude" | "codex" | "ollama" | "agy"> = { "claude-code": "claude", codex: "codex", ollama: "ollama", "antigravity-cli": "agy" };
const DOCS: Record<InstallProvider, string> = {
	"claude-code": "https://code.claude.com/docs/en/setup",
	codex: "https://learn.chatgpt.com/docs/codex/cli",
	ollama: "https://ollama.com/download",
	"antigravity-cli": "https://antigravity.google/docs/cli/install",
};
const SONDE_MS = 3000;

/** The winget fallback for Claude Code (publisher Anthropic PBC), shown in the
    help block for a blocked network and for an install stuck on "Setting up". */
const WINGET_CLAUDE = "winget install --id Anthropic.ClaudeCode -e";

/* The command itself lives in `src/cli-install-cmd.ts`: see its header. */
/* Coloring of one shell line WITHOUT an embedded highlighter: the commands of
   the window are a few known lines (powershell, curl, winget), not arbitrary
   code, so a four-token grammar is enough (string "…", flag -x/--xx, pipe |,
   the rest being the command at the head of a segment). Each token is a
   span, the text goes through textContent: nothing is interpreted. */
export function colorerCommande(code: HTMLElement, ligne: string): void {
	const re = /"[^"]*"|\|| +|[^\s"|]+/g;
	let debutSegment = true;
	for (const m of ligne.match(re) || []) {
		let cls: string | undefined;
		if (m.startsWith('"')) cls = "qbd-tok-string";
		else if (m === "|") { cls = "qbd-tok-pipe"; debutSegment = true; }
		else if (m.trim() === "") cls = undefined;
		else if (m.startsWith("-")) cls = "qbd-tok-flag";
		else if (debutSegment) { cls = "qbd-tok-cmd"; debutSegment = false; }
		else if (/^https?:\/\//.test(m)) cls = "qbd-tok-url";
		if (cls) ajouter(code, "span", cls, m);
		else code.appendChild(document.createTextNode(m));
		if (m.startsWith('"')) {
			// A string holds a command itself (irm … | iex): color it in turn,
			// but inside a string span.
			const inner = code.lastElementChild as HTMLElement;
			inner.textContent = "";
			inner.appendChild(document.createTextNode('"'));
			colorerCommande(inner, m.slice(1, -1));
			inner.appendChild(document.createTextNode('"'));
		}
	}
}

export function installCmd(provider: InstallProvider, isWindows: boolean): { code: string; lang: string } {
	return commandeInstallation(OUTILS[provider], isWindows);
}

/** The help block: a collapsed "Doesn't work?" section with short lines for
    the failures seen in practice. Windows only (every line is about the
    PowerShell scripts or winget). Links go through `host.shell.openUrl`. */
function renderHelp(c: HTMLElement, provider: InstallProvider): void {
	const host = currentHost();
	let ouvert = false;
	/* `defaultOpen: false`, never `ouvert`: `wireCollapseToggle` computes
	   `collapsed = defaultOpen ? isExpanded(key) : !isExpanded(key)`; with
	   `isExpanded: () => ouvert` (true = open), `false` gives `collapsed =
	   !ouvert`, which is what we want. The state is local, never persisted. */
	// The badge of the row counts the lines below it.
	const lignes = (provider === "ollama" ? 0 : 1) + 2 + (provider === "claude-code" ? 2 : 0);
	const corps = renderCollapsibleSection(
		{ isExpanded: () => ouvert, toggleExpanded: () => { ouvert = !ouvert; } },
		c, "install-help", t("ai.install.help.title"), lignes, { defaultOpen: false, rowClass: "qbd-install-manual-row" },
	);
	const liste = ajouter(corps, "ul", "qbd-install-help");
	if (provider !== "ollama") {
		ajouter(liste, "li", undefined, t("ai.install.help.path", { command: OUTILS[provider] }));
	}
	const antivirus = ajouter(liste, "li", undefined, t("ai.install.help.antivirus") + " ");
	const lien = ajouter(antivirus, "a", "qbd-install-help-link", DOCS[provider]);
	lien.href = DOCS[provider];
	lien.addEventListener("click", (e) => {
		e.preventDefault();
		void host.shell.openUrl(DOCS[provider]);
	});
	ajouter(liste, "li", undefined, t("ai.install.help.network"));
	if (provider === "claude-code") {
		ajouter(ajouter(liste, "li", undefined, t("ai.install.help.networkClaude") + " "), "code", "qbd-install-help-code", WINGET_CLAUDE);
		ajouter(ajouter(liste, "li", undefined, t("ai.install.help.stuck") + " "), "code", "qbd-install-help-code", WINGET_CLAUDE);
	}
}

export function openInstallModal(deps: InstallModalDeps): void {
	const host = currentHost();
	const name = NOMS[deps.provider];
	const win = host.platform.isWindows;
	let sonde: number | null = null;
	const couperSonde = (): void => { if (sonde !== null) { window.clearInterval(sonde); sonde = null; } };
	// Set to `true` ONLY on a real detection (not on an early close by the
	// cross): it is what `onClose` hands to the page.
	let detecte = false;

	/* The BRAND LOGO in the title row (2026-09-18): colored, no badge, no
	   outline. The provider and its color come from the shared catalogue
	   (`ai-providers.ts`), the same as the menu's: a second table would end up
	   diverging. */
	const marque = getProvider(deps.provider);
	requireHost("modals").open({
		className: "qbd-install-modal",
		title: t(`ai.install.title.${deps.provider}`),
		titleIcon: (el) => {
			setBrandLogo(el, marque.logo);
			el.style.color = marque.couleur;
		},
		onOpen: (m) => {
			const c = m.contentEl;
			m.panelEl.dataset.state = "initial";
			ajouter(c, "p", "qbd-install-what", t(`ai.install.what.${deps.provider}`));

			const etapes = ajouter(c, "ol", "qbd-install-steps");
			const li1 = ajouter(etapes, "li", undefined, t(win ? "ai.install.step1" : "ai.install.step1Unix"));
			/* "Open a terminal": only where the host can (the app, on Windows).
			   The host opens an EMPTY window and runs nothing; the user pastes
			   the command of the next step into it. */
			if (win && host.process) {
				const ouvrir = ajouter(li1, "button", "qbd-btn qbd-install-terminal");
				ouvrir.type = "button";
				host.ui.setIcon(ajouter(ouvrir, "span", "qbd-btn-icon qbd-btn-icon--sm"), "terminal");
				ajouter(ouvrir, "span", undefined, t("ai.install.openTerminal"));
				ouvrir.addEventListener("click", async () => {
					ouvrir.disabled = true;
					let verdict: "lance" | "indisponible" = "indisponible";
					try {
						verdict = await host.process!.openTerminal();
					} catch (e) {
						console.warn(LOG_PREFIX, "terminal not opened:", e);
					}
					ouvrir.disabled = false;
					if (verdict !== "lance") host.ui.notice(t("ai.install.terminalFailed"));
				});
			}
			const li2 = ajouter(etapes, "li", undefined, t("ai.install.step2"));
			const cmd = installCmd(deps.provider, win);
			const bloc = ajouter(li2, "div", "qbd-install-code markdown-rendered markdown-preview-view");
			if (deps.renderCodeBlock) deps.renderCodeBlock(bloc, cmd.code, cmd.lang);
			else colorerCommande(ajouter(ajouter(bloc, "pre"), "code", "language-" + cmd.lang), cmd.code);
			/* INSIDE the block, top right, revealed on hover: the gesture of
			   Obsidian and of every code block people know. Under the block it
			   overlapped the icon and its label overflowed. Here it is
			   positioned, so its size no longer constrains anything. */
			const copier = ajouter(bloc, "button", "qbd-btn qbd-install-copy");
			copier.type = "button";
			const copierIcone = ajouter(copier, "span", "qbd-btn-icon qbd-btn-icon--sm");
			host.ui.setIcon(copierIcone, "copy");
			/* THE ICON ALONE: the word doubled a pictogram everyone knows, in a
			   corner where room is tight. The label survives OFF SCREEN (a
			   button without an accessible name is mute for a screen reader)
			   and it is what says "Copied" after the click. */
			const copierTexte = ajouter(copier, "span", "qbd-sr-only", t("ai.install.copy"));
			copier.addEventListener("click", async () => {
				/* Through the host whenever it can copy: in the app window,
				   `navigator.clipboard` is refused by the main process and would
				   fail silently, which is why `copyText` exists. */
				const ok = deps.copyText
					? await deps.copyText(cmd.code)
					: await navigator.clipboard.writeText(cmd.code).then(() => true, () => false);
				if (!ok) return;
				/* The confirmation covers BOTH: the icon alone changed while the
				   word "Copy" stayed, which reads as an invitation to click
				   again. The button stays visible while it lasts (`data-copie`),
				   even if the mouse left the block. */
				copierIcone.replaceChildren();
				host.ui.setIcon(copierIcone, "check");
				copierTexte.textContent = t("ai.install.copied");
				copier.dataset.copie = "1";
				window.setTimeout(() => {
					copierIcone.replaceChildren();
					host.ui.setIcon(copierIcone, "copy");
					copierTexte.textContent = t("ai.install.copy");
					delete copier.dataset.copie;
				}, 1500);
			});
			ajouter(etapes, "li", undefined, t(`ai.install.step3.${deps.provider}`));
			ajouter(etapes, "li", undefined, t("ai.install.step4"));

			if (win) renderHelp(c, deps.provider);

			/* The state row: a spinner while the probe waits, a check when the
			   tool is seen. */
			const etat = ajouter(c, "div", "qbd-install-state");
			ajouter(etat, "span", "qbd-install-spinner");
			ajouter(etat, "span", undefined, t("ai.install.waiting"));

			const lien = ajouter(c, "a", "qbd-install-learn", t("ai.install.learnMore"));
			lien.href = DOCS[deps.provider];
			lien.target = "_blank";
			lien.rel = "noopener";

			sonde = window.setInterval(() => {
				void deps.probe().then(async (res) => {
					if (!res.ok || sonde === null) return;
					couperSonde();
					await deps.onDetected();
					detecte = true;
					/* The window shows its check and closes: the page takes over
					   (the sign-in wait, for the tools that have an account). */
					m.panelEl.dataset.state = "detecte";
					etat.replaceChildren();
					host.ui.setIcon(ajouter(etat, "span", "qbd-install-check"), "check");
					ajouter(etat, "span", undefined, res.version
						? t("ai.install.detected", { name, version: res.version })
						: t("ai.install.detectedNoVersion", { name }));
					/* It closes BY ITSELF, a second and a half after the check: the
					   user opened it to USE this tool, not to click "Continue". */
					window.setTimeout(() => m.close(), 1500);
				});
			}, SONDE_MS);
		},
		onClose: () => {
			couperSonde();
			deps.onClose(detecte);
		},
	});
}
