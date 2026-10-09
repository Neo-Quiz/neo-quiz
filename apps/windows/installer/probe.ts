/* ══════════════════════════════════════════════════════════
   WHAT THE BOOTSTRAPPER OBSERVES AROUND A FAILURE (Node side)

   The few system facts `diagnosis.ts` needs to name a cause: the log file,
   an active VPN interface, whether DNS works for a host other than GitHub,
   and whether Neo Quiz is running. Every probe is bounded in time and never
   throws: a probe that fails must not hide the error it was meant to explain.
══════════════════════════════════════════════════════════ */

import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { appendFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { detectVpn } from "./diagnosis";

/** `%TEMP%\neo-quiz-installer.log`. An elevated worker running under another
    account writes to that account's temp folder. */
export const LOG_PATH = join(tmpdir(), "neo-quiz-installer.log");

/** Best effort: the worker has no console, and logging never fails anything. */
export async function appendLog(message: string): Promise<void> {
	try {
		await appendFile(LOG_PATH, `${new Date().toISOString()} [${process.pid}] ${message}\n`);
	} catch {
		// Logging must never fail the installation.
	}
}

export function activeVpn(): { name: string; iface: string } | null {
	try {
		return detectVpn(networkInterfaces());
	} catch {
		return null;
	}
}

/** The host Windows itself resolves to decide whether the PC is online
    (Network Connectivity Status Indicator): present on every Windows network
    that has Internet access, and unrelated to GitHub. */
const OTHER_HOST = "www.msftconnecttest.com";

/** Does DNS work for a host other than GitHub? `false` with GitHub failing
    too means the PC is offline, `true` means GitHub alone is blocked. */
export async function dnsWorksElsewhere(timeoutMs = 4_000): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			lookup(OTHER_HOST).then(() => true, () => false),
			new Promise<boolean>(resolvePromise => { timer = setTimeout(() => resolvePromise(false), timeoutMs); }),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** `%SystemRoot%` when it is a plain `X:\Windows` (any drive, any case),
    else null. The variable belongs to whoever launched the worker: an
    elevated worker that trusted any value would run
    `<value>\System32\tasklist.exe` as administrator, wherever it points. */
export function racineSystemeFiable(value: unknown): string | null {
	return typeof value === "string" && /^[A-Za-z]:\\Windows$/i.test(value) ? value : null;
}

/** Is `neo-quiz.exe` running? Asked only after NSIS failed, to tell "the app
    is open" from "Windows refused". `tasklist` from System32 with constant
    arguments: nothing from a file, a message or the user reaches the command.
    `system` is a root that `racineSystemeFiable` accepted. */
export async function isAppRunning(system: string, timeoutMs = 5_000): Promise<boolean> {
	return await new Promise<boolean>(resolvePromise => {
		let output = "";
		let done = false;
		const finish = (value: boolean): void => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolvePromise(value);
		};
		const child = spawn(join(system, "System32", "tasklist.exe"), ["/FI", "IMAGENAME eq neo-quiz.exe", "/FO", "CSV", "/NH"], {
			windowsHide: true,
			stdio: ["ignore", "pipe", "ignore"],
		});
		const timer = setTimeout(() => {
			try { child.kill(); } catch { /* already gone */ }
			finish(false);
		}, timeoutMs);
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", chunk => { output += chunk; });
		child.once("error", () => finish(false));
		child.once("exit", () => finish(/"neo-quiz\.exe"/i.test(output)));
	});
}
