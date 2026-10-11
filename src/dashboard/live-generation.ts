/**
 * LIVE GENERATIONS OF THE GENERATE PAGE (2026-10-11, spec
 * 2026-10-11-live-cli-sessions-design, sections 1, 4.3 and 7).
 *
 * Claude Code and Codex, when they run as agents, are no longer launched
 * once per request: each chat keeps ONE live session per tool (`HostLive`),
 * in the Neo Quiz root, and each generation is a TURN of it: the first
 * message of a chat starts the session, the next ones are sent to it, and a
 * chat reopened after a restart resumes its last run (`start({ runId })`).
 * The chat keeps the ids of its runs (`chat-record.ts`, `runIds`).
 *
 * What it prevents:
 * - a turn that ends with the wrong text: the end of a turn is read from
 *   its own lines (`live-turn.ts`), as the one-shot call read its output;
 * - a line shown twice after a reload: the page reads the store, then drops
 *   every live `line` whose `seq` it already has;
 * - a generation sent twice after a reload: the turn's place in the run
 *   (`fromSeq`) is kept in the window's session storage under the line's
 *   resume key; a reloaded line whose turn still runs WAITS for it, one whose
 *   turn ended takes its result from the store, and only a dead one is sent
 *   again;
 * - Stop killing the session: it interrupts the turn, the session stays;
 * - the next request of the chat sent while a stopped turn is still winding
 *   down (2026-10-11): Stop interrupts the turn, but the turn stays the
 *   chat's running turn, and its promise rejects (`aborted`), freeing the
 *   chat for the queue, only once the session says it ended (`turnEnd`,
 *   `exit`). Settled at once, the queue sent the next request into the
 *   dying turn: its first `result` (the interrupted one) ended the new
 *   request, and each later request took the result of the one before. A
 *   turn that does not end within `STOP_GRACE_MS` has its session closed
 *   (process killed); the next message resumes it.
 *
 * Model text, tool input and output stay strings here: the view
 * (`work-view.ts`) writes them with `textContent` only.
 */
import { currentHost } from "../host/current";
import type { ModeAgent } from "../host/claude-outils";
import type { HostLive, LiveEvent } from "../host/types";
import { addUserMessage, answerPermission, applyLive, emptyThread } from "./live-thread";
import type { Thread } from "./live-thread";
import { collectLine, emptyOutcome } from "./live-turn";
import type { TurnOutcome } from "./live-turn";
import { forgetAllSaved, readAll, readSaved, turnFromStore, writeSaved } from "./live-turn-store";
import type { Saved } from "./live-turn-store";
import { addRunId, runIdsOf } from "./chat-record";
import type { ChatRun } from "./chat-record";
import { getChats, setChats } from "./chat-store";
import { chatDevice, notifyChatsChanged } from "./chat-session";

export type LiveTool = "claude" | "codex";
export interface LiveImage { mediaType: string; base64: string }
type LiveMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
const MEDIA_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export interface LiveTurnSpec {
	tool: LiveTool;
	chatId: string;
	model: string;
	effort?: string;
	mode: ModeAgent;
	/** The whole message of the turn (system prompt and request). */
	text: string;
	images: readonly LiveImage[];
	/** The resume key of the generation: the same after a reload. */
	key: string;
	/** Receives the function that stops the turn (the page's Stop). */
	abortable(stop: () => void): void;
}

/** The session could not run live (folder not trusted, a form the main
    process refused, a picture type it does not take): the caller runs its
    one-shot call instead. */
export class LiveUnavailable extends Error {}

/** One turn as the page shows it. */
export interface LiveTurnView { runId: string; thread: Thread }

interface Turn {
	runId: string;
	thread: Thread;
	outcome: TurnOutcome;
	fromSeq: number;
	toSeq: number | null;
	settle: ((err: Error | null) => void) | null;
	/** Stop was asked: the turn ends as `aborted`, whatever it brings back. */
	stopping?: boolean;
	/** The `STOP_GRACE_MS` timer of a stopped turn. */
	grace?: ReturnType<typeof setTimeout>;
}
interface Session {
	runId: string;
	maxSeq: number;
	current: Turn | null;
	last: Turn | null;
	/** Events received while the store is read, applied after it. */
	buffer: LiveEvent[] | null;
}

/** How long a stopped turn may take to end before its session is closed. */
export const STOP_GRACE_MS = 15_000;

const sessions = new Map<string, Session>();
/** The run of each chat and tool (`chatId|tool`). */
const bound = new Map<string, string>();
/** Each turn by the key of its generation; the oldest dropped past the cap. */
const turns = new Map<string, Turn>();
const MAX_TURNS = 200;
const loading = new Set<string>();
/** Keys whose stored run is gone (deleted): never read again. */
const absent = new Set<string>();
const listeners = new Set<(key: string) => void>();
let unsubscribe: (() => void) | null = null;

const nameOf = (e: unknown): string => (e instanceof Error ? e.name : "");
const keysOf = (turn: Turn): string[] => [...turns].filter(([, x]) => x === turn).map(([k]) => k);

function notify(turn: Turn): void {
	for (const key of keysOf(turn)) for (const l of [...listeners]) { try { l(key); } catch { /* a view never stops a run */ } }
}

/** Called with the key of a turn each time its thread changes. */
export function onLiveTurn(cb: (key: string) => void): () => void {
	listeners.add(cb);
	return () => { listeners.delete(cb); };
}

function keep(key: string, turn: Turn): void {
	turns.delete(key);
	turns.set(key, turn);
	while (turns.size > MAX_TURNS) turns.delete(turns.keys().next().value as string);
}

function subscribe(live: HostLive): void {
	if (unsubscribe) return;
	unsubscribe = live.onEvent(e => {
		const s = sessions.get(e.runId);
		if (!s) return;
		if (s.buffer) s.buffer.push(e);
		else apply(s, e);
	});
}

function apply(s: Session, e: LiveEvent): void {
	if (e.kind === "line") {
		if (e.seq <= s.maxSeq) return;
		s.maxSeq = e.seq;
	}
	const turn = s.current ?? s.last;
	if (!turn) return;
	// A pending permission is sent again after a reattach: shown once.
	const again = e.kind === "permission" && turn.thread.items.some(i => i.kind === "permission" && i.requestId === e.requestId);
	if (!again) applyLive(turn.thread, e);
	if (e.kind === "line") { collectLine(turn.outcome, e.line); turn.toSeq = e.seq; }
	if (turn === s.current && (e.kind === "turnEnd" || e.kind === "exit")) {
		const err = turn.stopping ? stopped()
			: e.kind === "exit" && !turn.outcome.ended ? Object.assign(new Error("The CLI exited"), { name: "exited" }) : null;
		settle(s, turn, err);
	}
	notify(turn);
}

const stopped = (): Error => Object.assign(new Error("Stopped"), { name: "aborted" });

function settle(s: Session, turn: Turn, err: Error | null): void {
	if (turn.grace !== undefined) clearTimeout(turn.grace);
	turn.grace = undefined;
	if (s.current === turn) s.current = null;
	s.last = turn;
	turn.thread.running = false;
	for (const key of keysOf(turn)) writeSaved(key, { runId: turn.runId, fromSeq: turn.fromSeq, toSeq: turn.toSeq ?? s.maxSeq });
	const done = turn.settle;
	turn.settle = null;
	done?.(err);
}

function session(runId: string): Session {
	let s = sessions.get(runId);
	if (!s) { s = { runId, maxSeq: -1, current: null, last: null, buffer: null }; sessions.set(runId, s); }
	return s;
}

/** The turn of a generation, to draw. A turn of before a reload is read
    from the store, once, and announced by `onLiveTurn` when it is ready. */
export function liveTurnView(key: string): LiveTurnView | null {
	const turn = turns.get(key);
	if (turn) return { runId: turn.runId, thread: turn.thread };
	const live = currentHost().live;
	const saved = readSaved(key);
	if (!live || !saved || loading.has(key) || absent.has(key)) return null;
	loading.add(key);
	void readAll(live, saved.runId).then(run => {
		if (!run) { absent.add(key); return; }
		if (turns.has(key)) return;
		const turn: Turn = { runId: saved.runId, ...turnFromStore(run, saved, saved.toSeq === null && !run.live), fromSeq: saved.fromSeq, toSeq: saved.toSeq, settle: null };
		keep(key, turn);
		notify(turn);
	}).catch(() => undefined).finally(() => loading.delete(key));
	return null;
}

/** Where the FINISHED turn of a generation sits in its run, to keep with
    its request in the chat record (`ChatRequest.runs`); `null` while it
    runs or for a generation that never ran live. */
export function liveTurnPlace(key: string): ChatRun | null {
	const saved = readSaved(key);
	return saved && saved.toSeq !== null && saved.toSeq >= saved.fromSeq ? { runId: saved.runId, fromSeq: saved.fromSeq, toSeq: saved.toSeq } : null;
}

/** The AI work of a recorded request's turn (a chat reopened after a
    restart, a request whose line left the queue), read back from the run
    store page by page; `null` when the run is gone or this host has none. */
export async function recordedTurn(run: ChatRun): Promise<Thread | null> {
	const live = currentHost().live;
	if (!live) return null;
	const stored = await readAll(live, run.runId).catch(() => null);
	if (!stored) return null;
	return turnFromStore(stored, run, false).thread;
}

/** The full output of one tool call of a recorded turn ("Show all"). */
export function recordedToolOutput(runId: string, toolId: string): Promise<string | null> {
	const live = currentHost().live;
	return live ? live.toolOutput(runId, toolId) : Promise.resolve(null);
}

/** Is the turn of this generation running now (a message may join it)?
    A stopped turn winding down takes no message: it goes to the queue. */
export function liveTurnRunning(key: string): boolean {
	const turn = turns.get(key);
	return !!turn && !turn.stopping && sessions.get(turn.runId)?.current === turn;
}

/** A message written while the turn runs: shown in its thread and sent to
    the session (Claude takes it after its current step, Codex steers the
    turn). False when the turn is no longer running. */
export async function sendDuringTurn(key: string, text: string, images: readonly LiveImage[]): Promise<boolean> {
	const live = currentHost().live;
	const turn = turns.get(key);
	if (!live || !turn || !liveTurnRunning(key) || !images.every(i => MEDIA_TYPES.includes(i.mediaType))) return false;
	addUserMessage(turn.thread, text);
	notify(turn);
	await live.send(turn.runId, { kind: "message", text, images: images.map(i => ({ mediaType: i.mediaType as LiveMediaType, base64: i.base64 })) });
	return true;
}

/** The user's answer to a permission card of a turn. */
export function answerLivePermission(key: string, requestId: string, allow: boolean): void {
	const live = currentHost().live;
	const turn = turns.get(key);
	if (!live || !turn) return;
	answerPermission(turn.thread, requestId, allow);
	notify(turn);
	void live.send(turn.runId, { kind: "permission", requestId, allow }).catch(e => console.warn("[neo-quiz] permission answer not sent:", e));
}

/** The full output of one tool call of a turn, fetched on "Show all". */
export function liveToolOutput(key: string, toolId: string): Promise<string | null> {
	const live = currentHost().live;
	const turn = turns.get(key);
	return live && turn ? live.toolOutput(turn.runId, toolId) : Promise.resolve(null);
}

/** Deletes the runs of a deleted chat from the PC, by lots the main
    process takes (it keeps any run whose header names another chat), and
    forgets them here. */
export async function removeRuns(runIds: readonly string[], chatId: string): Promise<void> {
	const live = currentHost().live;
	if (!live || !runIds.length) return;
	for (let i = 0; i < runIds.length; i += 500) await live.removeRuns(runIds.slice(i, i + 500), chatId);
	forgetRuns(runIds);
}

/** "Delete all": every run of the PC's store, known to a chat or not. */
export async function removeAllRuns(): Promise<void> {
	const live = currentHost().live;
	if (!live) return;
	await live.removeAllRuns();
	forgetAllSaved();
	forgetRuns([...sessions.keys(), ...bound.values(), ...[...turns.values()].map(x => x.runId)]);
}

/** Forgets runs removed from the store. A session with a turn running stays
    known until its `exit` (the main process closed it first): its turn
    must still end. */
function forgetRuns(runIds: readonly string[]): void {
	const gone = new Set(runIds);
	for (const id of gone) if (!sessions.get(id)?.current) sessions.delete(id);
	for (const [k, id] of [...bound]) if (gone.has(id)) bound.delete(k);
	for (const [k, turn] of [...turns]) if (gone.has(turn.runId) && sessions.get(turn.runId)?.current !== turn) turns.delete(k);
}

/** `start`, asking the user to trust the Neo Quiz root when the main process
    says it is not (the page's own trust question). Not trusted, or a form
    the main process refused: `LiveUnavailable`. */
async function startTrusted(live: HostLive, o: Parameters<HostLive["start"]>[0]): Promise<string> {
	try {
		return (await live.start(o)).runId;
	} catch (e) {
		if (nameOf(e) === "refused" && o.runId === undefined) throw new LiveUnavailable("refused");
		if (nameOf(e) !== "untrusted") throw e;
	}
	const host = currentHost();
	const root = host.paths.contractPath(host.paths.defaultRoot().id, "");
	let answer = "unavailable";
	try { answer = (await host.process?.trustFolder?.(root)) ?? "unavailable"; } catch { answer = "unavailable"; }
	if (answer !== "trusted") throw new LiveUnavailable("untrusted");
	try {
		return (await live.start(o)).runId;
	} catch (e) {
		if (nameOf(e) === "untrusted" || (nameOf(e) === "refused" && o.runId === undefined)) throw new LiveUnavailable(nameOf(e));
		throw e;
	}
}

/** The run a chat already has for this tool: the newest stored one. */
async function storedRun(live: HostLive, chatId: string, tool: LiveTool): Promise<string | undefined> {
	for (const id of runIdsOf(getChats(), chatId).reverse().slice(0, 20)) {
		const p = await live.readRun(id, { offset: 0, limit: 1 }).catch(() => null);
		if (p?.header.tool === tool) return id;
	}
	return undefined;
}

const settingsOf = (spec: LiveTurnSpec) => ({ tool: spec.tool, chatId: spec.chatId, model: spec.model, mode: spec.mode, ...(spec.effort ? { effort: spec.effort } : {}) });

/** The chat's session for this tool, started or resumed. */
async function ensureSession(live: HostLive, spec: LiveTurnSpec): Promise<Session> {
	const mapKey = spec.chatId + "|" + spec.tool;
	let known = bound.get(mapKey) ?? await storedRun(live, spec.chatId, spec.tool);
	let runId: string;
	try {
		runId = await startTrusted(live, known ? { ...settingsOf(spec), runId: known } : settingsOf(spec));
	} catch (e) {
		// A stored run deleted meanwhile (or another window's): a new run.
		if (!known || nameOf(e) !== "refused") throw e;
		known = undefined;
		runId = await startTrusted(live, settingsOf(spec));
	}
	bound.set(mapKey, runId);
	if (runId !== known) {
		setChats(addRunId(getChats(), spec.chatId, runId, chatDevice(), Date.now()));
		notifyChatsChanged();
	}
	return session(runId);
}

/** The `seq` the next line of the run will have at least. */
async function nextSeq(live: HostLive, s: Session): Promise<number> {
	try {
		const head = await live.readRun(s.runId, { offset: 0, limit: 1 });
		if (head && head.total > 0) {
			const last = await live.readRun(s.runId, { offset: head.total - 1, limit: 1 });
			const seq = last?.events[0]?.seq;
			if (typeof seq === "number" && seq > s.maxSeq) s.maxSeq = seq;
		}
	} catch { /* no store: the live lines alone */ }
	return s.maxSeq + 1;
}

/** Waits for the end of `turn`, stoppable by the page. Stop interrupts the
    turn and waits for its end (`turnEnd`, `exit`) before rejecting
    `aborted`; past `STOP_GRACE_MS` the session is closed. */
function waitFor(live: HostLive, s: Session, turn: Turn, spec: LiveTurnSpec): Promise<void> {
	const done = new Promise<void>((resolve, reject) => { turn.settle = err => (err ? reject(err) : resolve()); });
	spec.abortable(() => {
		if (s.current !== turn || turn.stopping) return;
		turn.stopping = true;
		void live.send(turn.runId, { kind: "interrupt" }).catch(() => undefined);
		turn.grace = setTimeout(() => {
			turn.grace = undefined;
			if (s.current !== turn) return;
			// Still not ended: its process is killed, the next message resumes the session.
			void live.close(turn.runId).catch(() => undefined).finally(() => { if (s.current === turn) settle(s, turn, stopped()); });
		}, STOP_GRACE_MS);
	});
	return done;
}

/** A turn sent before a reload: its result if it ended, a wait if it still
    runs, `null` if its process is gone (the caller sends it again). */
async function reattach(live: HostLive, spec: LiveTurnSpec, saved: Saved): Promise<TurnOutcome | null> {
	const s = session(saved.runId);
	s.buffer = [];
	try {
		const run = await readAll(live, saved.runId);
		if (!run) return null;
		const turn: Turn = { runId: saved.runId, ...turnFromStore(run, saved, false), fromSeq: saved.fromSeq, toSeq: saved.toSeq, settle: null };
		for (const e of run.events) if (e.seq > s.maxSeq) s.maxSeq = e.seq;
		keep(spec.key, turn);
		s.last = turn;
		if (turn.outcome.ended) { settle(s, turn, null); notify(turn); return turn.outcome; }
		if (!run.live) return null;
		bound.set(spec.chatId + "|" + spec.tool, saved.runId);
		turn.thread.running = true;
		s.current = turn;
		const done = waitFor(live, s, turn, spec);
		try {
			await live.start({ ...settingsOf(spec), runId: saved.runId });
		} catch (e) {
			// Not reattached: the chat is not left with a turn that never ends.
			turn.settle = null;
			if (s.current === turn) s.current = null;
			turn.thread.running = false;
			throw e;
		}
		const buffered = s.buffer;
		s.buffer = null;
		for (const e of buffered) apply(s, e);
		notify(turn);
		await done;
		return turn.outcome;
	} finally {
		if (s.buffer) {
			const buffered = s.buffer;
			s.buffer = null;
			for (const e of buffered) apply(s, e);
		}
	}
}

/** Runs one turn of the chat's live session and resolves with what it
    brought back once it ends. Rejects with `LiveUnavailable` when the
    session cannot run live, with an Error named `aborted` on Stop, `exited`
    when the CLI died mid-turn, or the host's code (`busy`, `failed`,
    `not-installed`, `refused`). */
export async function runLiveTurn(spec: LiveTurnSpec): Promise<TurnOutcome> {
	const live = currentHost().live;
	if (!live || !spec.images.every(i => MEDIA_TYPES.includes(i.mediaType))) throw new LiveUnavailable("unsupported");
	subscribe(live);
	const saved = readSaved(spec.key);
	if (saved && saved.toSeq === null) {
		const back = await reattach(live, spec, saved);
		if (back) return back;
	}
	const s = await ensureSession(live, spec);
	if (s.current) throw Object.assign(new Error("A turn is already running"), { name: "busy" });
	const fromSeq = await nextSeq(live, s);
	const turn: Turn = { runId: s.runId, thread: emptyThread(), outcome: emptyOutcome(), fromSeq, toSeq: null, settle: null };
	turn.thread.running = true;
	keep(spec.key, turn);
	s.current = turn;
	s.last = turn;
	writeSaved(spec.key, { runId: s.runId, fromSeq, toSeq: null });
	notify(turn);
	const done = waitFor(live, s, turn, spec);
	try {
		await live.send(s.runId, { kind: "message", text: spec.text, images: spec.images.map(i => ({ mediaType: i.mediaType as LiveMediaType, base64: i.base64 })) });
	} catch (e) {
		turn.settle = null;
		if (s.current === turn) s.current = null;
		turn.thread.running = false;
		// Never sent: a retry must send again, not wait for this turn.
		writeSaved(spec.key, { runId: s.runId, fromSeq, toSeq: s.maxSeq });
		notify(turn);
		throw e;
	}
	await done;
	return turn.outcome;
}
