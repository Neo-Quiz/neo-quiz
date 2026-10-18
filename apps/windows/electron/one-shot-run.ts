/* ══════════════════════════════════════════════════════════
   THE RAW OUTPUT OF A ONE-SHOT CLI CALL, KEPT IN THE RUN STORE (2026-10-19).

   Until now only the live sessions of Claude Code and Codex wrote the run
   store. Every other generation (Antigravity, Claude Code on an Ollama model,
   a one-shot Claude or Codex call) printed its work to the window as it came
   and kept NOTHING: a stopped Antigravity run lost its whole transcript (only
   "Stopped" remained), and nobody could check that the transcript the window
   showed was complete.

   A call that carries `registre` ({ runId, chatId }) is recorded here:
   - line 1 the header (`mode: "one-shot"`), then `{dir:"out", l}` for every
     line the CLI prints (parsed JSON when it is JSON, else the text), a
     `{meta:{stderr}}` note when it printed errors, and a final `{end}`;
   - the SAME store, cap and read path as the live sessions
     (`run-store.ts`, `HostLive.readRun`), so one reader serves both;
   - a recording failure NEVER stops or fails the call: it is a log.

   PURE of Electron: the store is a parameter (`check:run-store` drives it
   on a real temp folder).
══════════════════════════════════════════════════════════ */

import type { RunHeader } from "../../../src/host/types";
import type { RunStore } from "./run-store";

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The longest chat id kept in a header (a chat id is a short slug or UUID). */
const MAX_CHAT_ID = 200;
/** The stderr note is bounded; the store's own cap bounds the rest. */
const MAX_STDERR = 8 * 1024;
const TOOLS = ["claude", "codex", "agy"] as const;
type RecordedTool = (typeof TOOLS)[number];

/** What the window may send: a run id and a chat id, nothing else. `null`
    for anything else (the call then runs unrecorded). */
export function validerRegistre(v: unknown, tool: string): { runId: string; chatId: string } | null {
	if (!(TOOLS as readonly string[]).includes(tool)) return null;
	if (!v || typeof v !== "object") return null;
	const { runId, chatId } = v as { runId?: unknown; chatId?: unknown };
	if (typeof runId !== "string" || !RUN_ID.test(runId)) return null;
	if (typeof chatId !== "string" || !chatId || chatId.length > MAX_CHAT_ID || /[\u0000-\u001f]/.test(chatId)) return null;
	return { runId, chatId };
}

/** The model named in a call's arguments (`--model x` / `-m x`), for the header only. */
export function modeleDesArguments(args: readonly string[]): string {
	const i = args.findIndex(a => a === "--model" || a === "-m");
	const v = i >= 0 ? args[i + 1] : "";
	return typeof v === "string" && v.length <= 200 && !v.startsWith("-") ? v : "";
}

export interface EnregistreurRun {
	/** A chunk of standard output, cut anywhere; whole lines are written. */
	sortie(chunk: string): void;
	/** The call is over. Resolves once everything is written; never rejects. */
	fin(o: { code: number | null; annule: boolean; stderr?: string }): Promise<void>;
}

export function ouvrirEnregistreur(store: RunStore, reg: { runId: string; chatId: string }, o: { tool: RecordedTool; model: string; cwd: string; maintenant?: () => number; surErreur?: (e: unknown) => void }): EnregistreurRun {
	const surErreur = o.surErreur ?? (() => undefined);
	const header: RunHeader = { v: 1, tool: o.tool, model: o.model, mode: "one-shot", runId: reg.runId, cwd: o.cwd, chatId: reg.chatId, start: (o.maintenant ?? Date.now)() };
	let seq = 0;
	let reste = "";
	// Every write goes after the header, in order, whatever fails.
	let chaine: Promise<void> = store.open(header).catch(surErreur);
	const ecrire = (rec: Parameters<RunStore["append"]>[1]): void => {
		const avec = { ...rec, seq: seq++ } as Parameters<RunStore["append"]>[1];
		chaine = chaine.then(() => store.append(reg.runId, avec)).catch(surErreur);
	};
	const ligne = (texte: string): void => {
		const brut = texte.replace(/\r$/, "");
		if (!brut.trim()) return;
		let l: unknown = brut;
		if (brut.trimStart().startsWith("{")) { try { l = JSON.parse(brut); } catch { /* kept as text */ } }
		ecrire({ dir: "out", l });
	};
	return {
		sortie(chunk) {
			reste += chunk;
			const lignes = reste.split("\n");
			reste = lignes.pop() ?? "";
			for (const x of lignes) ligne(x);
		},
		async fin({ code, annule, stderr }) {
			if (reste) { ligne(reste); reste = ""; }
			const err = (stderr ?? "").trim();
			if (err) ecrire({ meta: { stderr: err.length > MAX_STDERR ? err.slice(0, MAX_STDERR) : err } });
			ecrire({ end: { code, cancelled: annule } });
			await chaine;
		},
	};
}
