import { firstLineOf } from "../dashboard/chat-record";
import type { RequestGroup } from "../dashboard/chat-requests";
import { quizProgress } from "../dashboard/transcript";

/* ══════════════════════════════════════════════════════════
   WHAT A PC IS GENERATING, published in the synced folder (PURE)

   `<root>/.neo-quiz/generations/<device>.json`, rewritten at most every 5 s
   while something runs and once at each end. A reader judges it by its `at`:
   older than 2 minutes means the PC is off or the app closed; stamped in the
   future (clock skew) is stale too, or a PC with a fast clock would look
   alive forever.
══════════════════════════════════════════════════════════ */

export const STALE_MS = 120_000;
export const WRITE_EVERY_MS = 5_000;
/** Keep-alive: while something runs, the file is rewritten at least this often even if nothing changed. */
const KEEP_ALIVE_MS = 60_000;
const MAX_ENTRIES = 20;
const MAX_TEXT = 200;
/** A clock a few seconds ahead of ours is normal; more is skew. */
const FUTURE_TOLERANCE_MS = STALE_MS;

export interface RunningEntry {
	requestId: string; chatId: string; from: string; text: string; mode: "learn" | "practice";
	startedAt: number; provider: string; model: string;
	progress: { question: number; total?: number; quiz?: number; quizTotal?: number };
}
export interface GenerationsFile { v: 1; at: number; running: RunningEntry[] }

const isStr = (x: unknown): x is string => typeof x === "string";
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const count = (x: unknown): x is number => isNum(x) && x >= 0 && x <= 100_000;

/** A file is read from the synced folder, so every field is checked: a bad entry is dropped, never trusted. */
function readEntry(x: unknown): RunningEntry | null {
	if (!isObj(x) || !isStr(x.requestId) || !isStr(x.chatId) || !isStr(x.from) || !isStr(x.text) || !isNum(x.startedAt)) return null;
	if (x.mode !== "learn" && x.mode !== "practice") return null;
	if (!isStr(x.provider) || !isStr(x.model) || !isObj(x.progress) || !count(x.progress.question)) return null;
	const p: RunningEntry["progress"] = { question: x.progress.question };
	if (count(x.progress.total)) p.total = x.progress.total;
	if (count(x.progress.quiz)) p.quiz = x.progress.quiz;
	if (count(x.progress.quizTotal)) p.quizTotal = x.progress.quizTotal;
	return {
		requestId: x.requestId, chatId: x.chatId, from: x.from, text: x.text.slice(0, MAX_TEXT), mode: x.mode,
		startedAt: x.startedAt, provider: x.provider.slice(0, 80), model: x.model.slice(0, 120), progress: p,
	};
}

export function readGenerations(raw: unknown): GenerationsFile | null {
	if (!isObj(raw) || raw.v !== 1 || !isNum(raw.at) || !Array.isArray(raw.running)) return null;
	const running = raw.running.map(readEntry).filter((e): e is RunningEntry => !!e).slice(0, MAX_ENTRIES);
	return { v: 1, at: raw.at, running };
}

export function isStale(f: GenerationsFile, now: number): boolean {
	return now - f.at > STALE_MS || f.at - now > FUTURE_TOLERANCE_MS;
}

type Line = RequestGroup["lines"][number];
const live = (l: Line): boolean => l.etat === "attente" || l.etat === "cours" || l.etat === "enregistrement";

/** The entry a queue group publishes, or null when none of its lines is still live. */
export function entryOfGroup(g: RequestGroup, transcriptText: (lineId: number) => string, device: string): RunningEntry | null {
	const lines = g.lines.filter(live);
	if (!lines.length) return null;
	const l = lines.find(x => x.etat !== "attente") ?? lines[0];
	const d = l.demande;
	const batch = !!d.parDocument && d.notes.length >= 2;
	const p = quizProgress(l.etat === "attente" ? "" : transcriptText(l.id), { batch });
	const progress: RunningEntry["progress"] = { question: p.question };
	if (d.count) progress.total = d.count;
	if (batch && p.quiz !== null) { progress.quiz = p.quiz; progress.quizTotal = d.notes.length; }
	return {
		requestId: g.key, chatId: g.chatId, from: d.fromDevice ?? device, text: firstLineOf(d.text).slice(0, MAX_TEXT),
		mode: d.mode === "practice" ? "practice" : "learn", startedAt: l.debut ?? d.sentAt ?? 0,
		provider: d.reglages.aiProvider || "", model: d.reglages.aiModel || "", progress,
	};
}

/** Throttle: write when the content changed AND 5 s passed, or when `force` (an entry left). */
export function shouldWrite(last: { json: string; at: number } | null, next: GenerationsFile, now: number, force: boolean): boolean {
	if (!last || force) return true;
	// `at` is left out of the comparison: a new stamp alone is not a change.
	const same = JSON.stringify({ ...next, at: 0 }) === last.json;
	const since = now - last.at;
	if (same) return next.running.length > 0 && since >= KEEP_ALIVE_MS;
	return since >= WRITE_EVERY_MS;
}

/** The device whose file is the freshest non-stale one; null when none. */
export function lastPcSeen(files: ReadonlyArray<{ device: string; file: GenerationsFile }>, now: number): string | null {
	const fresh = files.filter(f => !isStale(f.file, now)).sort((a, b) => b.file.at - a.file.at);
	return fresh[0]?.device ?? null;
}
