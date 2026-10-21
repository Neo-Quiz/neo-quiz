import { LOG_PREFIX } from "../branding";
import type { CodeJob, CodeRun } from "../host/types";
import { blocsPython, sha256Hex } from "../code-blocks";
import { relativeToRoot } from "../shared-state/chat-merge";
import { MAX_TAKEN, RESULT_TTL_MS, admettre, construireResultat, lireResultat, validerDemandeCode } from "../shared-state/code-run-request";
import type { CodeRunRequest, CodeRunResult, TakenRun } from "../shared-state/code-run-request";
import { activityOf, pcReachable, pickTarget, preferredPc } from "./remote-send";
import type { GenerationsFile } from "../shared-state/generations";
import { soleOnlinePc } from "../shared-state/devices";
import type { DeviceFile } from "../shared-state/devices";
import type { PairedPeer } from "./remote-generations";

/* ══════════════════════════════════════════════════════════
   PYTHON FROM THE PHONE, RUN ON THE PC (host-agnostic, through deps)

   The phone never runs Python and never sends code (spec §9): its Run button
   writes a request naming the note and the SHA-256 of the block it shows
   (`executerSurPc`), then waits for the PC's result file. The PC
   (`traiterDemandes`, every 2 s while the app runs) validates each request
   (code-run-request.ts), reads the note ITSELF, runs only the block whose hash
   matches (code-blocks.ts) through its own `HostCode.run` — no modal: the
   phone already showed the warning and `accepted` is its answer — and writes
   the result in its own folder. One run at a time, 20 per sender per hour,
   each request run once (local taken list, settings `codeRunsTaken`). Each
   device writes only its own folders: the phone deletes its request, the PC
   its results older than 10 minutes.
══════════════════════════════════════════════════════════ */

/** A request file of another device, not yet validated. */
export interface IncomingCodeRun { fileDevice: string; fileId: string; raw: unknown; /** Too large, unreadable or not JSON: never a request, but named so it stops taking a reading slot. */ unreadable?: true }

/** The code-run files of the synced folder (apps/windows/src/host/code-run-files.ts). */
export interface CodeRunFiles {
	writeRequest(req: CodeRunRequest): Promise<void>;
	deleteOwnRequest(id: string): Promise<void>;
	/** `results/<device>/<id>.json`, parsed and size-bounded; null when absent or unreadable. Never throws. */
	readResult(device: string, id: string): Promise<unknown>;
	/** `requests/<other device>/*.json`, skipping (unread) the files `known` names; a file that cannot be read comes back `unreadable`. Never throws. */
	readIncoming(known: (fileDevice: string, fileId: string) => boolean): Promise<IncomingCodeRun[]>;
	writeResult(res: CodeRunResult): Promise<void>;
	/** Removes this device's request or result files older than `maxAgeMs` (or unreadable). Never throws. */
	sweepOwn(kind: "requests" | "results", maxAgeMs: number, now: number): Promise<void>;
}

/* ── The PC ── */

/** `refused`: request files not to read again, by sender + file name, with the time they may be read again
    (`Infinity`: never). `runs`: the runs of the last hour, for the per-sender limit, kept apart from
    the 200-entry taken list so that other senders' runs never push a sender's own out of its count. */
export interface PcState { busy: boolean; taken: TakenRun[] | null; runs: TakenRun[] | null; refused: Map<string, number>; lastSweep: number }
export const newPcState = (): PcState => ({ busy: false, taken: null, runs: null, refused: new Map(), lastSweep: -Infinity });

/** At most this many refused files are remembered (the oldest are forgotten first). */
export const MAX_REFUSED = 2_000;
/** A file unreadable now (still syncing) or a little ahead of our clock is read again after this. */
export const RETRY_MS = 30_000;
/** `missing` names the root packages to install: at most this many, each a package name. */
const MAX_MISSING = 20;
const PACKAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export interface PcDeps {
	device: string;
	now(): number;
	files: CodeRunFiles;
	/** The note at a path relative to the synced root, bounded; null when absent or unreadable. */
	readNote(rel: string): Promise<string | null>;
	/** The PC's own `HostCode.run` (the Run button's). */
	run(job: CodeJob): Promise<CodeRun>;
	/** The PC's `HostCode.installer` for Python: pinned libraries only (checked in the main process). */
	install?(missing: string[]): Promise<"ok" | "offline" | "refused" | "failed">;
	takenLog: { read(): Promise<TakenRun[]>; write(list: TakenRun[]): Promise<void> };
	state: PcState;
}

const RUN_TIMEOUT_MS = 60_000;
const SWEEP_EVERY_MS = 60_000;
const keyOf = (device: string, id: string): string => device.toLowerCase() + "/" + id;

async function runBlock(deps: PcDeps, req: CodeRunRequest): Promise<CodeRun> {
	const note = await deps.readNote(req.path);
	if (note === null) return { status: "unavailable", stdout: "", error: "changed" };
	let code: string | null = null;
	for (const b of blocsPython(note)) if (await sha256Hex(b) === req.sha256) { code = b; break; }
	if (code === null) return { status: "unavailable", stdout: "", error: "changed" };
	const job: CodeJob = { language: "python", code, stdin: "", timeoutMs: RUN_TIMEOUT_MS };
	let run = await deps.run(job);
	// Missing pinned libraries are installed once, as after a click on the PC, then the block runs once more.
	if (run.status === "not-installed" && deps.install) {
		/* Defence in depth: the main process installs pinned roots only, but a list
		   longer than any real one, or a name that is not a package name, never leaves here. */
		const missing = run.missing ?? [];
		if (missing.length > MAX_MISSING || !missing.every(n => typeof n === "string" && PACKAGE_NAME.test(n))) return { status: "unavailable", stdout: "" };
		const installed = await deps.install([...missing]);
		if (installed !== "ok") return { status: "unavailable", stdout: "" };
		run = await deps.run(job);
	}
	return run.status === "not-installed" ? { status: "unavailable", stdout: "" } : run;
}

/** One pass of the PC: every new request of the other devices, one at a time. Returns at once while a run is in progress. Never throws. */
export async function traiterDemandes(deps: PcDeps): Promise<void> {
	const st = deps.state;
	if (st.busy) return;
	st.busy = true;
	try {
		if (st.taken === null) st.taken = (await deps.takenLog.read().catch(() => [])).slice(-MAX_TAKEN);
		const taken = st.taken;
		const now0 = deps.now();
		// The runs of the last hour: seeded from the taken list, then counted apart from it.
		st.runs = (st.runs ?? taken.map(t => ({ ...t }))).filter(t => !Number.isFinite(t.at) || now0 - t.at < 3600_000);
		const runs = st.runs;
		const refuse = (fileDevice: string, fileId: string, until: number): void => {
			const k = keyOf(fileDevice, fileId);
			st.refused.delete(k);
			st.refused.set(k, until);
			// A Map keeps insertion order: the first keys are the oldest.
			for (const old of st.refused.keys()) { if (st.refused.size <= MAX_REFUSED) break; st.refused.delete(old); }
		};
		const isRefused = (k: string): boolean => {
			const until = st.refused.get(k);
			if (until === undefined) return false;
			if (deps.now() < until) return true;
			st.refused.delete(k);
			return false;
		};
		if (deps.now() - st.lastSweep >= SWEEP_EVERY_MS) {
			st.lastSweep = deps.now();
			await deps.files.sweepOwn("results", RESULT_TTL_MS, deps.now());
		}
		const known = (fileDevice: string, fileId: string): boolean =>
			isRefused(keyOf(fileDevice, fileId)) || taken.some(t => keyOf(t.from, t.id) === keyOf(fileDevice, fileId));
		for (const f of await deps.files.readIncoming(known)) {
			if (f.unreadable) { refuse(f.fileDevice, f.fileId, deps.now() + RETRY_MS); continue; }
			const verdict = validerDemandeCode(f.raw, { device: deps.device, fileDevice: f.fileDevice, fileId: f.fileId, now: deps.now() });
			if (!verdict.ok) {
				// Never read again; a clock a little ahead may still become valid: read again later.
				refuse(f.fileDevice, f.fileId, verdict.raison === "futur" ? deps.now() + RETRY_MS : Infinity);
				if (verdict.raison !== "age") console.warn(`${LOG_PREFIX} code run request refused (${verdict.raison}):`, f.fileDevice, f.fileId);
				continue;
			}
			const req = verdict.demande;
			const admission = admettre(req, { taken, busy: false, runs }, deps.now());
			if (admission === "known") continue;
			if (admission === "rate") {
				refuse(req.from, req.id, Infinity);
				await deps.files.writeResult(construireResultat(req.id, { status: "unavailable", stdout: "" }, deps.now())).catch(() => {});
				continue;
			}
			// Taken BEFORE the run: a crash mid-run never runs it a second time.
			taken.push({ id: req.id, from: req.from, at: deps.now() });
			runs.push({ id: req.id, from: req.from, at: deps.now() });
			if (taken.length > MAX_TAKEN) taken.splice(0, taken.length - MAX_TAKEN);
			await deps.takenLog.write([...taken]).catch(e => console.warn(`${LOG_PREFIX} code run taken list not saved:`, e));
			let run: CodeRun;
			try { run = await runBlock(deps, req); } catch { run = { status: "unavailable", stdout: "" }; }
			await deps.files.writeResult(construireResultat(req.id, run, deps.now())).catch(e => console.warn(`${LOG_PREFIX} code run result not written:`, e));
		}
	} catch (e) {
		console.warn(`${LOG_PREFIX} code run requests not handled:`, e);
	} finally {
		st.busy = false;
	}
}

/* ── The phone ── */

export interface PhoneDeps {
	device: string;
	/** The synced root's id: the note path is sent relative to it. */
	rootId: string;
	now(): number;
	sleep(ms: number): Promise<void>;
	newId(): string;
	files: CodeRunFiles;
	/** The PC to ask, and whether it can answer now (`choosePc`). */
	pc(): { target: string | null; reachable: boolean };
	pollMs?: number;
	waitMs?: number;
}

export const POLL_MS = 1_000;
export const WAIT_MS = 90_000;

/** Which PC runs the phone's Python: the remote generation's choice (`pickTarget`), reachable as `pcReachable` says; no paired device at all is no PC. */
export function choosePc(i: { files: ReadonlyArray<{ device: string; file: GenerationsFile }>; now: number; lastEver: string | null; chosen: string | null; devices: ReadonlyArray<DeviceFile>; peers: ReadonlyArray<PairedPeer>; peerConnected: boolean }): { target: string | null; reachable: boolean } {
	if (i.peers.length === 0) return { target: null, reachable: false };
	const seen = activityOf(i.files);
	const target = pickTarget(null, i.files, i.now, i.lastEver, preferredPc(i.chosen, i.devices, seen), soleOnlinePc(i.peers, i.devices, seen));
	return { target, reachable: pcReachable(target, i.files, i.now, i.peerConnected) };
}

/** Runs a Python block of the note on screen on the PC. `unavailable` with `error: "no-pc"` (no PC to ask), `"pc-silent"` (no answer in time) or `"changed"` (the PC found no such block). Never throws. */
export async function executerSurPc(job: CodeJob, deps: PhoneDeps): Promise<CodeRun> {
	if (job.language !== "python") return { status: "unavailable", stdout: "" };
	const pc = deps.pc();
	if (!pc.target || !pc.reachable) return { status: "unavailable", stdout: "", error: "no-pc" };
	const target = pc.target;
	// A note outside the synced folder: the PC cannot read it.
	const path = relativeToRoot(job.sourcePath ?? "", deps.rootId);
	let req: CodeRunRequest;
	try {
		const raw = { v: 1, id: deps.newId(), at: deps.now(), from: deps.device, target, path, sha256: await sha256Hex(job.code), accepted: true };
		// The PC's own validator judges first: a request it would refuse is never written.
		const verdict = validerDemandeCode(raw, { device: target, fileDevice: deps.device, fileId: raw.id, now: raw.at });
		if (!verdict.ok) return { status: "unavailable", stdout: "" };
		req = verdict.demande;
		await deps.files.writeRequest(req);
	} catch (e) {
		console.warn(`${LOG_PREFIX} code run request not written:`, e);
		return { status: "unavailable", stdout: "" };
	}
	const poll = deps.pollMs ?? POLL_MS, wait = deps.waitMs ?? WAIT_MS;
	const start = deps.now();
	let result: CodeRunResult | null = null;
	try {
		while (deps.now() - start < wait) {
			await deps.sleep(poll);
			// Only the target's own folder: a result written by any other device is never read.
			result = lireResultat(await deps.files.readResult(target, req.id), req.id);
			if (result) break;
		}
	} finally {
		await deps.files.deleteOwnRequest(req.id).catch(() => {});
	}
	if (!result) return { status: "unavailable", stdout: "", error: "pc-silent" };
	// The phone installs nothing: a PC that could not install answers `unavailable`.
	if (result.status === "not-installed") return { status: "unavailable", stdout: "" };
	const run: CodeRun = { status: result.status, stdout: result.stdout };
	if (result.error !== undefined) run.error = result.error;
	if (result.unsupported) run.unsupported = result.unsupported;
	return run;
}
