import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";

/* ══════════════════════════════════════════════════════════
   THE UPDATER'S LOG ON DISK (2026-10-19)

   The updater only logged to the console, so an update that stalled left no
   trace to find its cause. Each line (check, download, install, error,
   retry) is appended to `updater.log` in the app's `logs` folder; past
   1 MB the file becomes `updater.old.log` and a new one starts, so two
   generations at most. Writes are queued one after another and never throw:
   a log must not turn into a second failure.
══════════════════════════════════════════════════════════ */

export const UPDATER_LOG_MAX_BYTES = 1024 * 1024;

export type LogLevel = "info" | "warn" | "error";

export function createUpdaterLog(folder: string): (level: LogLevel, message: string) => void {
	const file = join(folder, "updater.log");
	let queue: Promise<void> = Promise.resolve();
	return (level, message) => {
		const line = `${new Date().toISOString()} ${level} ${message.replace(/\r?\n/g, "\n    ")}\n`;
		queue = queue.then(async () => {
			try {
				await mkdir(folder, { recursive: true });
				const size = await stat(file).then(s => s.size, () => 0);
				if (size > UPDATER_LOG_MAX_BYTES) await rename(file, join(folder, "updater.old.log"));
				await appendFile(file, line, "utf8");
			} catch {
				// A log that cannot be written is dropped.
			}
		});
	};
}
