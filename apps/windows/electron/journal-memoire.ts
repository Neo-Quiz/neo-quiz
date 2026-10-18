/**
 * In-memory ring buffer of the main process's `console.warn` / `console.error`
 * output, kept for bug reports. Every line is scrubbed when captured AND again
 * when read (`scrubLog`), cut to `LIMITS.logLine` characters, and only the last
 * `LIMITS.logLines` lines are kept. Nothing is written to disk.
 */
import { LIMITS, scrubLog } from "../../../src/bug-report";

export interface JournalMemoire {
	ajouter(niveau: "warn" | "error", args: unknown[]): void;
	extrait(): string;
	vider(): void;
}

function enTexte(a: unknown): string {
	if (typeof a === "string") return a;
	// Message only: a stack carries absolute paths (and so the user name).
	if (a instanceof Error) return a.message;
	try {
		return JSON.stringify(a) ?? String(a);
	} catch {
		return "[unserializable]";
	}
}

export function creerJournalMemoire(): JournalMemoire {
	let lignes: string[] = [];
	return {
		ajouter(_niveau, args) {
			let texte: string;
			try {
				texte = scrubLog(args.map(enTexte).join(" "));
			} catch {
				return;
			}
			for (const l of texte.split(/\r?\n/)) {
				lignes.push(l.length > LIMITS.logLine ? l.slice(0, LIMITS.logLine) : l);
			}
			if (lignes.length > LIMITS.logLines) lignes = lignes.slice(-LIMITS.logLines);
		},
		extrait: () => scrubLog(lignes.join("\n")),
		vider() {
			lignes = [];
		},
	};
}

/** Wraps `console.warn` / `console.error` (originals still called). Returns the uninstaller. */
export function installerJournalMemoire(j: JournalMemoire): () => void {
	const warn = console.warn;
	const error = console.error;
	console.warn = (...args: unknown[]) => {
		j.ajouter("warn", args);
		warn.apply(console, args);
	};
	console.error = (...args: unknown[]) => {
		j.ajouter("error", args);
		error.apply(console, args);
	};
	return () => {
		console.warn = warn;
		console.error = error;
	};
}
