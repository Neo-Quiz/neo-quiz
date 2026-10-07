/* ══════════════════════════════════════════════════════════
   METERED CONNECTION (2026-10-07)

   Neo Quiz must not spend a metered plan on its own: the update (~150 MB) and
   the Moodle files wait for a click while Windows says the connection is
   metered. Electron and Chromium expose NO metered-connection API on desktop
   (`net.online` is a plain on/off, and the renderer's `navigator.connection`
   is absent or unreliable in Electron), and Node has no WinRT. The only
   reliable source is Windows itself:
   `NetworkInformation.GetInternetConnectionProfile().GetConnectionCost()`, the
   very value behind Settings > Network > "Metered connection". That needs ONE
   short PowerShell, so the discipline is the one of `partage.ts`:

   - the script is a CONSTANT (`SCRIPT_COUT`): nothing is interpolated into it,
     no environment variable, no value from the window;
   - `windowsHide: true`, a 5 s timeout, no stdin;
   - the answer is CACHED for 5 minutes (one PowerShell per window of five
     minutes at most, however many callers) and a call in flight is shared;
   - `invalider()` (called on `powerMonitor` "resume") forgets the cache.
     Electron's main process has no network-change event, so the cache expiry
     is the only other trigger.

   WHAT COUNTS AS METERED. `Fixed` (a capped plan) and `Variable` (pay per
   use, what Windows sets when the user ticks "Metered connection"), plus
   `Roaming`, `OverDataLimit` and `ApproachingDataLimit` whatever the cost
   type says. `Unrestricted` alone is free.

   ANY FAILURE (not Windows, PowerShell missing or blocked by policy, timeout,
   no connection profile, unreadable output) IS "NOT METERED" — today's
   behaviour. The opposite choice ("unknown, so hold back") would stop
   updates and Moodle for good on every machine where the probe cannot run,
   and a user who really is on a metered link can still see the update wait
   only if Windows says so. Unknown never blocks.

   `lireCout` and `SCRIPT_COUT` are PURE; `creerSonde` takes an injected
   executor and clock: `npm run check:partage` proves the rules, and the real
   PowerShell is replayed on Windows.
══════════════════════════════════════════════════════════ */

import { execFile } from "node:child_process";

/** The constant script. Prints one line: `<cost> <roaming> <over> <approaching>`, or `none`. */
export const SCRIPT_COUT = `$ErrorActionPreference = 'Stop'
[void][Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
$p = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
if ($null -eq $p) { 'none' } else { $c = $p.GetConnectionCost(); "$($c.NetworkCostType) $($c.Roaming) $($c.OverDataLimit) $($c.ApproachingDataLimit)" }
`;

export const DUREE_CACHE_MS = 5 * 60 * 1000;
export const DELAI_MS = 5000;

/** True when the script output says "metered"; false for anything else, unreadable output included. */
export function lireCout(sortie: unknown): boolean {
	if (typeof sortie !== "string") return false;
	const m = /^(Unrestricted|Fixed|Variable|Unknown) (True|False) (True|False) (True|False)\s*$/.exec(sortie.trim());
	if (!m) return false;
	return m[1] === "Fixed" || m[1] === "Variable" || m[2] === "True" || m[3] === "True" || m[4] === "True";
}

export interface Sonde {
	/** Cached for five minutes; never rejects; false when unknown. */
	limitee(): Promise<boolean>;
	invalider(): void;
}

export function creerSonde(deps: {
	/** Runs the script and returns its output, or null on any failure. Tests inject it. */
	executer(): Promise<string | null>;
	maintenant?(): number;
	/** Development only (the caller guards it with `!app.isPackaged`): force the answer. */
	forcer?(): boolean | null;
}): Sonde {
	const maintenant = deps.maintenant ?? Date.now;
	let cache: { at: number; valeur: boolean } | null = null;
	let enCours: Promise<boolean> | null = null;
	return {
		limitee() {
			const f = deps.forcer?.();
			if (typeof f === "boolean") return Promise.resolve(f);
			if (cache && maintenant() - cache.at < DUREE_CACHE_MS) return Promise.resolve(cache.valeur);
			if (enCours) return enCours;
			const p = (async () => {
				let valeur = false;
				try { valeur = lireCout(await deps.executer()); } catch { valeur = false; }
				return valeur;
			})();
			enCours = p;
			/* Cache and in-flight slot settle in the SAME callback, registered before any
			   caller can await `p`: a caller resuming after the answer never sees a stale slot. */
			void p.then(valeur => { cache = { at: maintenant(), valeur }; if (enCours === p) enCours = null; });
			return p;
		},
		invalider() { cache = null; },
	};
}

/** The real executor: PowerShell on Windows, nothing elsewhere. */
export function executerPowerShell(): Promise<string | null> {
	if (process.platform !== "win32") return Promise.resolve(null);
	return new Promise(resolve => {
		try {
			const encode = Buffer.from(SCRIPT_COUT, "utf16le").toString("base64");
			execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encode],
				{ windowsHide: true, timeout: DELAI_MS, maxBuffer: 4096 },
				(err, stdout) => resolve(err ? null : String(stdout)));
		} catch {
			resolve(null);
		}
	});
}
