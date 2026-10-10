import { ajouter } from "../dom";
import { t } from "../i18n";
import { currentHost } from "../host/current";
import type { UsageTool } from "./usage-line";

/* ══════════════════════════════════════════════════════════
   THE ACCOUNT ROW OF THE USAGE POPOVER (2026-10-10): "Switch account" and
   "Sign out" for a signed-in CLI, "Sign in" for a signed-out one.

   Everything that matters runs in the HOST: the sign-out is confirmed in its
   own native box (`deconnecterCli`), the sign-in runs the CLI's own browser
   flow (`connecterCompteNavigateur`, the CLI opens the browser and keeps its
   credentials; no token ever reaches the page). "Switch account" is a
   sign-out followed by a sign-in. One operation at a time, shared by every
   popover (the host refuses a second one anyway).

   If the browser does not open, the row shows the exact command and a button
   that opens a plain terminal (`openTerminal`, which runs nothing): the
   sign-in is never done behind the user's back in a terminal.
══════════════════════════════════════════════════════════ */

/** The command shown for a sign-in by hand: the same words the host runs
    (`ARGS_COMPTE` of the main process). */
export const SIGN_IN_COMMAND: Record<UsageTool, string> = { claude: "claude auth login", codex: "codex login" };

type MessageKey =
	| "ai.usage.signedIn" | "ai.usage.signedOut" | "ai.usage.signInFailed" | "ai.usage.signInExpired"
	| "ai.usage.signOutFailed" | "ai.usage.accountBusy" | "ai.usage.accountUnavailable";

interface AccountState {
	op: { tool: UsageTool; kind: "signin" | "signout" } | null;
	message: { tool: UsageTool; key: MessageKey } | null;
}
const etat: AccountState = { op: null, message: null };

export interface AccountHooks {
	/** Signed in (`true`), signed out (`false`), not read yet (`null`). */
	connected: boolean | null;
	/** Redraws every open popover. */
	redraw(): void;
	/** The account may have changed: read the address and the plan again. */
	changed(): void;
}

/** True when this host can sign in and out from the popover. */
export function canManageAccount(): boolean {
	const proc = currentHost().process;
	return !!proc && currentHost().platform.isDesktopApp && typeof proc.connecterCompteNavigateur === "function";
}

/** Forgets the last outcome (the popover closed). */
export function clearAccountMessage(): void {
	etat.message = null;
}

const SIGN_IN_KEYS: Record<string, MessageKey | null> = {
	ok: "ai.usage.signedIn", echec: "ai.usage.signInFailed", expire: "ai.usage.signInExpired",
	occupe: "ai.usage.accountBusy", indisponible: "ai.usage.accountUnavailable", annule: null,
};
const SIGN_OUT_KEYS: Record<string, MessageKey | null> = {
	ok: "ai.usage.signedOut", echec: "ai.usage.signOutFailed", occupe: "ai.usage.accountBusy",
	indisponible: "ai.usage.accountUnavailable", annule: null,
};

async function signIn(tool: UsageTool, hooks: AccountHooks): Promise<void> {
	const proc = currentHost().process;
	if (!proc?.connecterCompteNavigateur) return;
	etat.op = { tool, kind: "signin" };
	etat.message = null;
	hooks.redraw();
	let verdict: string;
	try { verdict = await proc.connecterCompteNavigateur(tool); } catch { verdict = "echec"; }
	etat.op = null;
	const key = SIGN_IN_KEYS[verdict] ?? null;
	etat.message = key ? { tool, key } : null;
	hooks.changed();
	hooks.redraw();
}

async function signOut(tool: UsageTool, thenSignIn: boolean, hooks: AccountHooks): Promise<void> {
	const proc = currentHost().process;
	if (!proc) return;
	etat.op = { tool, kind: "signout" };
	etat.message = null;
	hooks.redraw();
	let verdict: string;
	try { verdict = await proc.deconnecterCli(tool, thenSignIn); } catch { verdict = "echec"; }
	etat.op = null;
	if (verdict === "ok") hooks.changed();
	if (verdict === "ok" && thenSignIn) { await signIn(tool, hooks); return; }
	const key = SIGN_OUT_KEYS[verdict] ?? null;
	etat.message = key ? { tool, key } : null;
	hooks.redraw();
}

function button(parent: HTMLElement, label: string, primary: boolean, disabled: boolean, on: () => void): HTMLButtonElement {
	const b = ajouter(parent, "button", "qbd-usage-reset-btn" + (primary ? " is-primary" : ""), label) as HTMLButtonElement;
	b.type = "button";
	b.disabled = disabled;
	b.addEventListener("click", on);
	return b;
}

/** Draws the account row at the end of the popover `pop`. */
export function drawAccount(pop: HTMLElement, tool: UsageTool, hooks: AccountHooks): void {
	if (!canManageAccount()) return;
	const proc = currentHost().process;
	const sec = ajouter(pop, "div", "qbd-usage-pop-account");
	const mine = etat.op && etat.op.tool === tool ? etat.op : null;
	const busy = etat.op !== null;
	if (mine?.kind === "signin") {
		const status = ajouter(sec, "div", "qbd-usage-account-status", t("ai.usage.signingIn"));
		status.setAttribute("role", "status");
		const actions = ajouter(sec, "div", "qbd-usage-account-actions");
		button(actions, t("ai.usage.cancelSignIn"), false, false, () => { void proc?.annulerConnexionNavigateur?.(); });
		ajouter(sec, "div", "qbd-usage-account-hint", t("ai.usage.terminalHint"));
		ajouter(sec, "code", "qbd-usage-account-command", SIGN_IN_COMMAND[tool]);
		const fallback = ajouter(sec, "div", "qbd-usage-account-actions");
		const copy = currentHost().shell.copyText;
		if (copy) button(fallback, t("ai.usage.copyCommand"), false, false, () => { void copy.call(currentHost().shell, SIGN_IN_COMMAND[tool]); });
		button(fallback, t("ai.usage.openTerminal"), false, false, () => { void proc?.openTerminal(); });
	} else if (mine?.kind === "signout") {
		const status = ajouter(sec, "div", "qbd-usage-account-status", t("ai.usage.signingOut"));
		status.setAttribute("role", "status");
	} else if (hooks.connected !== null) {
		const actions = ajouter(sec, "div", "qbd-usage-account-actions");
		if (hooks.connected) {
			button(actions, t("ai.usage.switchAccount"), false, busy, () => { void signOut(tool, true, hooks); });
			button(actions, t("ai.usage.signOut"), false, busy, () => { void signOut(tool, false, hooks); });
		} else {
			button(actions, t("ai.usage.signIn"), true, busy, () => { void signIn(tool, hooks); });
		}
	}
	if (etat.message && etat.message.tool === tool) {
		const msg = ajouter(sec, "div", "qbd-usage-reset-message", t(etat.message.key));
		msg.setAttribute("role", "status");
	}
	if (!sec.firstChild) sec.remove();
}
