/**
 * A LIVE TURN READ BACK (2026-10-11, `live-generation.ts`): where a turn of
 * a generation sits in its run, kept in the window's session storage under
 * the generation's resume key, and its thread rebuilt from the run store.
 *
 * What it prevents: after a reload, a generation sent twice (its turn's
 * place is known, so the page waits for it or takes its result), or the AI
 * work of a finished line lost (its thread is read back from the store,
 * between the turn's first and last `seq`, its prompt left out: the
 * request's bubble already shows it).
 */
import type { HostLive, RunEvent } from "../host/types";
import { threadFromRun } from "./live-thread";
import type { Thread } from "./live-thread";
import { collectLine, emptyOutcome, isEcho, isPromptLine } from "./live-turn";
import type { TurnOutcome } from "./live-turn";

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A turn's place in its run: from `fromSeq`, to `toSeq` once it ended. */
export interface Saved { runId: string; fromSeq: number; toSeq: number | null }

const STORAGE = "neo-quiz.live-turn.";

export function readSaved(key: string): Saved | null {
	try {
		const v = JSON.parse(sessionStorage.getItem(STORAGE + key) ?? "null") as Saved | null;
		return v && typeof v.runId === "string" && Number.isSafeInteger(v.fromSeq) && (v.toSeq === null || Number.isSafeInteger(v.toSeq)) ? v : null;
	} catch { return null; }
}

export function writeSaved(key: string, v: Saved): void {
	try { sessionStorage.setItem(STORAGE + key, JSON.stringify(v)); } catch { /* the turn lasts the page */ }
}

/** Forgets every turn place of the window ("Delete all"): a line still in
    the queue no longer points into a deleted run, nor records it again. */
export function forgetAllSaved(): void {
	try {
		for (let i = sessionStorage.length - 1; i >= 0; i--) {
			const k = sessionStorage.key(i);
			if (k?.startsWith(STORAGE)) sessionStorage.removeItem(k);
		}
	} catch { /* no storage: nothing kept */ }
}

export interface StoredRun { events: RunEvent[]; live: boolean; interrupted: boolean; truncated: boolean }

/** Every event of a stored run, page by page, with the last page's flags. */
export async function readAll(live: HostLive, runId: string): Promise<StoredRun | null> {
	const events: RunEvent[] = [];
	let offset = 0;
	for (;;) {
		const p = await live.readRun(runId, { offset, limit: 2000 });
		if (!p) return offset === 0 ? null : { events, live: false, interrupted: true, truncated: false };
		events.push(...p.events);
		offset += p.events.length;
		if (!p.events.length || offset >= p.total) return { events, live: p.live, interrupted: p.interrupted, truncated: p.truncated };
	}
}

/** The thread and outcome of one turn of a stored run: its events from
    `fromSeq` (to `toSeq`), its prompt line left out. */
export function turnFromStore(run: Pick<StoredRun, "events" | "truncated">, saved: Saved, interrupted: boolean): { thread: Thread; outcome: TurnOutcome } {
	const mine = run.events.filter(e => e.seq >= saved.fromSeq && (saved.toSeq === null || e.seq <= saved.toSeq));
	const prompt = mine.findIndex(e => e.dir === "in" && isPromptLine(e.l));
	const shown = prompt >= 0 ? [...mine.slice(0, prompt), ...mine.slice(prompt + 1)] : mine;
	const outcome = emptyOutcome();
	for (const e of mine) if (e.dir === "out") collectLine(outcome, e.l);
	/* A Claude message written during the turn and not taken yet (its echo
	   has not come): the session still works for this turn, whatever result
	   came before it. Only when the CLI echoes at all (an older one never
	   does, and its result is the end). */
	const written = mine.filter(e => e.dir === "in" && isRec(e.l) && e.l.type === "user").length;
	const echoed = mine.filter(e => e.dir === "out" && isEcho(e.l)).length;
	if (echoed > 0 && written > echoed) outcome.ended = false;
	return { thread: threadFromRun({ events: shown, interrupted, truncated: run.truncated }), outcome };
}
