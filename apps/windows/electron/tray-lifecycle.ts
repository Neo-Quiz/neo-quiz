export type LifecycleEvent =
	| "startup"
	| "close-button"
	| "session-end"
	| "quit-request"
	| "tray-click"
	| "second-instance"
	| "update-ready"
	| "window-hidden"
	| "run-ended";

export interface LifecycleState {
	quitting: boolean;
	trayAvailable: boolean;
	windowVisible: boolean;
	updateReady: boolean;
	busy: boolean;
	hiddenLaunch: boolean;
}

export type LifecycleAction =
	| "show"
	| "stay-hidden"
	| "hide"
	| "quit"
	| "install-silently"
	| "nothing";

export const HIDDEN_FLAG = "--hidden";
export const RELAUNCH_HIDDEN_KEY = "relaunchHidden";

export function decide(event: LifecycleEvent, s: LifecycleState): LifecycleAction {
	switch (event) {
		case "startup":
			// See docs/superpowers/specs/2026-10-12-tray-autostart-design.md: keep the page alive, but never hide it if the tray failed.
			return s.hiddenLaunch && s.trayAvailable ? "stay-hidden" : "show";
		case "close-button":
			// See docs/superpowers/specs/2026-10-12-tray-autostart-design.md: hide only with a reachable tray; keep the real quit flush path.
			return s.quitting || !s.trayAvailable ? "quit" : "hide";
		case "session-end":
		case "quit-request":
			// See docs/superpowers/specs/2026-10-12-tray-autostart-design.md: logoff, shutdown, and explicit Quit are real quits.
			return "quit";
		case "tray-click":
		case "second-instance":
			// See docs/superpowers/specs/2026-10-12-tray-autostart-design.md: a tray click or another launch restores the window.
			return "show";
		case "update-ready":
		case "window-hidden":
		case "run-ended":
			// See docs/superpowers/specs/2026-10-12-tray-autostart-design.md: install silently only while hidden, idle, and not quitting.
			return !s.quitting && s.updateReady && !s.windowVisible && !s.busy
				? "install-silently"
				: "nothing";
	}
}

export function isHiddenLaunch(argv: readonly string[], relaunchHidden: unknown): boolean {
	return argv.includes(HIDDEN_FLAG) || relaunchHidden === true;
}
