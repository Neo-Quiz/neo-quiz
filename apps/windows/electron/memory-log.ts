/**
 * In-memory ring buffer of the main process's `console.warn` / `console.error`
 * output, kept for bug reports. Every line is scrubbed when captured AND again
 * when read (`scrubLog`), cut to `LIMITS.logLine` characters, and only the last
 * `LIMITS.logLines` lines are kept. Nothing is written to disk.
 */
import { LIMITS, scrubLog } from "../../../src/bug-report";

export interface MemoryLog {
	add(level: "warn" | "error", args: unknown[]): void;
	excerpt(): string;
	clear(): void;
}

function toText(a: unknown): string {
	if (typeof a === "string") return a;
	// Message only: a stack carries absolute paths (and so the user name).
	if (a instanceof Error) return a.message;
	try {
		return JSON.stringify(a) ?? String(a);
	} catch {
		return "[unserializable]";
	}
}

export function createMemoryLog(): MemoryLog {
	let lines: string[] = [];
	return {
		add(_niveau, args) {
			let text: string;
			try {
				text = scrubLog(args.map(toText).join(" "));
			} catch {
				return;
			}
			for (const l of text.split(/\r?\n/)) {
				lines.push(l.length > LIMITS.logLine ? l.slice(0, LIMITS.logLine) : l);
			}
			if (lines.length > LIMITS.logLines) lines = lines.slice(-LIMITS.logLines);
		},
		excerpt: () => scrubLog(lines.join("\n")),
		clear() {
			lines = [];
		},
	};
}

/** Wraps `console.warn` / `console.error` (originals still called). Returns the uninstaller. */
export function installMemoryLog(j: MemoryLog): () => void {
	const warn = console.warn;
	const error = console.error;
	console.warn = (...args: unknown[]) => {
		j.add("warn", args);
		warn.apply(console, args);
	};
	console.error = (...args: unknown[]) => {
		j.add("error", args);
		error.apply(console, args);
	};
	return () => {
		console.warn = warn;
		console.error = error;
	};
}
