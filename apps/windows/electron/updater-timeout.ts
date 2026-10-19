import type { EventEmitter } from "node:events";

/* ══════════════════════════════════════════════════════════
   A REAL TIMEOUT FOR THE UPDATER'S REQUESTS (2026-10-19)

   electron-updater (6.8.9, builder-util-runtime 9.7.0, still the latest)
   arms its 60 s timeout on the request's "socket" event. Its requests go
   through Electron's `net` module, whose ClientRequest NEVER emits
   "socket": the timeout never fires. Replayed in a real Electron against a
   server that sends a few bytes then goes silent: still pending after 75 s.
   A connection that stalls (Wi-Fi switch, the PC waking from sleep) left
   the check or the download pending forever, and electron-updater hands
   that same pending promise to every later check or download: the update
   sat at its percentage, or never showed up, until the app restarted.

   `armInactivityTimeout` replaces the library's `addTimeOutHandler` on the
   updater's own HTTP executor (`installInactivityTimeout`): the timer starts
   with the request, restarts on the response and on every chunk received,
   and stops when the response ends or the request aborts or fails. On silence it
   aborts the request and fails it, so electron-updater emits "error" and
   `mise-a-jour.ts` schedules a retry. `check:updater` replays it on a real
   silent server, and fails if the library renames the hook.
══════════════════════════════════════════════════════════ */

export interface Timers {
	set(fn: () => void, ms: number): unknown;
	clear(handle: unknown): void;
}

const REAL_TIMERS: Timers = {
	set: (fn, ms) => setTimeout(fn, ms),
	clear: handle => clearTimeout(handle as NodeJS.Timeout),
};

type Request = EventEmitter & { abort(): void };

/** Fails `request` through `callback` after `timeoutMs` without any data; never twice. */
export function armInactivityTimeout(request: Request, callback: (error: Error) => void, timeoutMs: number, timers: Timers = REAL_TIMERS): void {
	let handle: unknown = null;
	let done = false;
	const stop = (): void => {
		if (handle !== null) timers.clear(handle);
		handle = null;
		done = true;
	};
	const fire = (): void => {
		if (done) return;
		stop();
		request.abort();
		callback(new Error(`Request timed out: no data for ${Math.round(timeoutMs / 1000)} s`));
	};
	const restart = (): void => {
		if (done) return;
		if (handle !== null) timers.clear(handle);
		handle = timers.set(fire, timeoutMs);
	};
	restart();
	request.on("response", (response: EventEmitter) => {
		restart();
		response.on("data", restart);
		response.on("end", stop);
		response.on("error", stop);
		response.on("aborted", stop);
	});
	/* Never on "close": Electron's ClientRequest emits it right after `end()`
	   (its writable side), before the response even arrives. Measured: close
	   at 11 ms, response at 79 ms. */
	request.on("abort", stop);
	request.on("error", stop);
}

/** Puts `armInactivityTimeout` on the updater's HTTP executor. False when the
    library no longer has the hook (the check then stays the library's own). */
export function installInactivityTimeout(updater: object): boolean {
	const executor = (updater as { httpExecutor?: { addTimeOutHandler?: unknown } | null }).httpExecutor;
	if (!executor || typeof executor.addTimeOutHandler !== "function") return false;
	executor.addTimeOutHandler = (request: Request, callback: (error: Error) => void, timeout: number): void => {
		armInactivityTimeout(request, callback, timeout > 0 ? timeout : 60_000);
	};
	return true;
}
