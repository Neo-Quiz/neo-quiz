import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/electron/tray-lifecycle.ts", ({
	decide,
	isHiddenLaunch,
}) => {
	const r = makeReporter("Tray lifecycle decision");
	const state = (overrides = {}) => ({
		quitting: false,
		trayAvailable: true,
		windowVisible: false,
		updateReady: false,
		busy: false,
		hiddenLaunch: false,
		...overrides,
	});

	r.check("startup shows a normal launch", decide("startup", state()), "show");
	r.check("startup stays hidden when the tray is available",
		decide("startup", state({ hiddenLaunch: true })), "stay-hidden");
	r.check("startup shows when the tray is unavailable",
		decide("startup", state({ hiddenLaunch: true, trayAvailable: false })), "show");
	r.check("close hides when the tray is available",
		decide("close-button", state()), "hide");
	r.check("close quits when already quitting",
		decide("close-button", state({ quitting: true })), "quit");
	r.check("close quits when tray creation failed",
		decide("close-button", state({ trayAvailable: false })), "quit");
	r.check("session end always quits",
		decide("session-end", state({ hiddenLaunch: true })), "quit");
	r.check("quit request always quits",
		decide("quit-request", state()), "quit");
	r.check("tray click shows the window",
		decide("tray-click", state()), "show");
	r.check("second instance shows the window",
		decide("second-instance", state()), "show");
	r.check("ready hidden update installs silently",
		decide("update-ready", state({ updateReady: true })), "install-silently");
	r.check("ready update waits while the window is visible",
		decide("update-ready", state({ updateReady: true, windowVisible: true })), "nothing");
	r.check("ready update waits for a busy CLI run",
		decide("update-ready", state({ updateReady: true, busy: true })), "nothing");
	r.check("hidden event installs a ready update",
		decide("window-hidden", state({ updateReady: true })), "install-silently");
	r.check("ended run installs a ready update",
		decide("run-ended", state({ updateReady: true })), "install-silently");
	r.check("update does not install during quit",
		decide("run-ended", state({ quitting: true, updateReady: true })), "nothing");

	// Review focus: a missing tray must never strand the app behind a hidden window.
	r.check("review: close after tray failure quits",
		decide("close-button", state({ trayAvailable: false })), "quit");
	// Review focus: Windows logoff and shutdown must follow the real quit path.
	r.check("review: session end quits while hidden",
		decide("session-end", state({ hiddenLaunch: true })), "quit");
	// Review focus: a running job must finish before a silent update is installed.
	r.check("review: busy work blocks a silent update",
		decide("update-ready", state({ updateReady: true, busy: true })), "nothing");
	// Review focus: a consumed relaunch flag cannot affect a later normal startup.
	r.check("review: startup shows after the relaunch flag is cleared",
		decide("startup", state({ hiddenLaunch: false })), "show");
	// Review focus: visible-window updates keep the existing update-window flow.
	r.check("review: visible update does not install silently",
		decide("update-ready", state({ updateReady: true, windowVisible: true })), "nothing");

	r.check("hidden flag in argv", isHiddenLaunch(["x", "--hidden"], undefined), true);
	r.check("true relaunch setting", isHiddenLaunch([], true), true);
	r.check("string relaunch setting is ignored", isHiddenLaunch([], "true"), false);
	r.check("missing relaunch setting is ignored", isHiddenLaunch([], undefined), false);

	r.done();
});
