/* ══════════════════════════════════════════════════════════
   THE PC RUNNER: a valid remote request becomes an ordinary queue line

   THIS IS WHERE A SYNCED FILE LAUNCHES A CLI. Everything a request may
   influence is decided here, and it is deliberately little:
   - `validateRemote` (strict schema) and `admit` (one at a time, six per hour,
     never twice) run first; an invalid, foreign, future or expired request is
     ignored and never recorded.
   - The request text is DATA: it is the `text` of the line and nothing else.
     It never reaches an argument, a path, a flag or a setting.
   - A remote line ALWAYS runs with Claude Code (the no-tool call shape), whatever
     the PC's own provider is. The model is the request's optional `model` only
     if it is in the PC's CURRENT Claude list (`claudeModels`), else the request
     is refused with a recorded message and a notification (never replaced,
     never passed through); without `model`, the PC's own Claude default. The
     rest (effort, destination "") is the PC's own frozen choice
     (`figerReglages(settings())`). Types are
     kept only when canonical; the documents are read through the host
     (the bridge perimeter) from RELATIVE paths the validator already cleaned.
   - Exactly once: the local taken log (never synced) is written BEFORE the
     line exists, keyed on sender + id, and an entry lives 25 h (a request is
     refused after 24 h). A request taken but neither in the queue nor
     recorded was cut by a restart: it is reported "interrupted", never run
     again.
   No DOM here; the clock and every effect are injected.
══════════════════════════════════════════════════════════ */

import { LOG_PREFIX, PRODUCT_NAME } from "../branding";
import type { AiSettings } from "../types/dashboard-ctx";
import { figerReglages } from "./file-generation-app";
import type { DemandeFile, FileGenerationApp } from "./file-generation-app";
import { CANONICAL_TYPES, normalizeTypes } from "./ai-client";
import { categorieChoisie, indicesCategorie } from "./categorie-quiz";
import type { NoteAttachment } from "./generation-demande";
import { admit, validateRemote } from "../shared-state/remote-request";
import type { RemoteRequest, TakenEntry } from "../shared-state/remote-request";
import { admitSetting, isSettingRaw, validateSetting } from "../shared-state/remote-setting";
import type { SettingRequest } from "../shared-state/remote-setting";
import { t } from "../i18n";
import { remoteProviderAllowed } from "./remote-providers";
export { remoteProviderAllowed };

/** Entries older than this are dropped: past the 24 h age limit a request is refused anyway. */
export const TAKEN_KEEP_MS = 25 * 3600 * 1000;
/** Six requests an hour over 25 h is 150: 200 never prunes a young entry. */
export const MAX_TAKEN = 200;
const INTERRUPTED_AFTER_MS = 10_000;
const NOTIFY_TITLE_MAX = 80;
const NOTIFY_BODY_MAX = 200;

export interface TakenLogEntry extends TakenEntry { reported?: true }

export interface RunnerDeps {
	device: string;
	now(): number;
	readIncoming(): Promise<Array<{ fileDevice: string; fileId: string; raw: unknown }>>;
	/** Ids of requests already recorded in a chat (finished). */
	recordedIds(): Set<string>;
	queue: Pick<FileGenerationApp, "lignes" | "envoyer" | "abonner" | "pret">;
	/** Reads one RELATIVE document path through the host (perimeter); null when missing, unreadable or over 1 MB. */
	readDocument(rel: string): Promise<NoteAttachment | null>;
	settings(): AiSettings;
	/** The Claude model ids THIS PC's CLI cache offers now (selectable ones). */
	claudeModels(): Promise<ReadonlyArray<string>>;
	/** The local log of requests taken (settings key `remoteTaken`, never synced). */
	takenLog: { read(): Promise<TakenLogEntry[]>; write(list: TakenLogEntry[]): Promise<void> };
	/** Records a failure for a request that never produced a line (no provider, unreadable document, interrupted). */
	recordFailure(req: RemoteRequest, message: string): void;
	notify(title: string, body: string): void;
	/** Provider switch asked by the phone (`remote-setting.ts`). Absent: setting requests are ignored. */
	providerSwitch?: {
		/** Whether the Claude Code CLI runs on this PC. */
		claudeAvailable(): Promise<boolean>;
		/** The model the provider picker sets when it picks Claude Code. */
		claudeDefaultModel(): string;
		/** Applies the patch through the same settings path as the provider picker (the main-process guard applies). Rejects when the write is refused. */
		apply(patch: { aiProvider: "claude-code"; aiModel: string }): Promise<void>;
		/** Runs after a successful switch (the device file is republished). */
		applied(): void;
		/** Separate local log of the switches taken (never synced), with its own hourly limit. */
		takenLog: { read(): Promise<TakenLogEntry[]>; write(list: TakenLogEntry[]): Promise<void> };
	};
}

const sameEntry = (e: { id: string; from?: string }, r: { id: string; from: string }): boolean =>
	e.id === r.id && (e.from ?? "").toLowerCase() === r.from.toLowerCase();

/** The log as kept: young entries only (never pruned before their time), bounded. */
function pruned(log: readonly TakenLogEntry[], now: number): TakenLogEntry[] {
	return log.filter(e => now - e.at < TAKEN_KEEP_MS).slice(-MAX_TAKEN);
}

export function createRemoteRunner(deps: RunnerDeps): { scan(): Promise<void> } {
	let scanning = false, again = false;
	/** Ids already logged as invalid, so the console is not spammed on every scan. */
	const refused = new Set<string>();
	const live = (): boolean => deps.queue.lignes().some(l => !!l.demande.fromDevice && (l.etat === "attente" || l.etat === "cours" || l.etat === "enregistrement"));
	const inQueue = (id: string): boolean => deps.queue.lignes().some(l => l.demande.requestId === id);

	/** True when the log changed. */
	async function one(file: { fileDevice: string; fileId: string; raw: unknown }, log: TakenLogEntry[]): Promise<boolean> {
		const v = validateRemote(file.raw, { device: deps.device, fileDevice: file.fileDevice, fileId: file.fileId, now: deps.now() });
		if (!v.ok) {
			const key = file.fileDevice + "/" + file.fileId;
			if (!refused.has(key)) { refused.add(key); console.warn(LOG_PREFIX, "remote request ignored:", file.fileDevice, file.fileId, v.reason); }
			return false;
		}
		const req = v.request;
		const taken = log.find(e => sameEntry(e, req));
		if (taken) {
			if (!taken.reported && !inQueue(req.id) && !deps.recordedIds().has(req.id) && deps.now() - taken.at > INTERRUPTED_AFTER_MS) {
				taken.reported = true;
				deps.recordFailure(req, t("ai.remote.interrupted"));
				return true;
			}
			return false;
		}
		// Already recorded in a chat (the taken log was lost, e.g. a settings reset): note it as taken, never run it again.
		if (deps.recordedIds().has(req.id)) {
			log.push({ id: req.id, from: req.from, at: deps.now(), reported: true });
			return true;
		}
		if (admit(req, { taken: log, busy: live() }, deps.now()) !== "run") return false;
		// ONE frozen copy for the whole admission: the live settings may change while documents are read.
		const frozen = figerReglages(deps.settings());
		const failAndNotify = (message: string): true => {
			log.push({ id: req.id, from: req.from, at: deps.now(), reported: true });
			deps.recordFailure(req, message);
			deps.notify(t("ai.remote.notifyTitle", { device: req.fromName || t("ai.remote.unknownDevice") }).slice(0, NOTIFY_TITLE_MAX), message.slice(0, NOTIFY_BODY_MAX));
			return true;
		};
		// A phone request never forces Claude Code over the PC's own provider: refused when the PC (frozen at admission) is not on Claude Code.
		if (frozen.aiProvider !== "claude-code") return failAndNotify(t("ai.remote.pcNotClaudeCode"));
		// The requested model must be in the PC's CURRENT Claude list: otherwise refused, never swapped for another.
		if (req.model !== undefined && !(await deps.claudeModels()).includes(req.model)) {
			return failAndNotify(t("ai.remote.modelNotOffered", { model: req.model }));
		}
		// No `model`: the PC's own Claude model.
		const s = { ...frozen, aiModel: req.model ?? frozen.aiModel };
		const notes: NoteAttachment[] = [];
		for (const d of req.documents) {
			const note = await deps.readDocument(d.path);
			if (!note) {
				log.push({ id: req.id, from: req.from, at: deps.now(), reported: true });
				deps.recordFailure(req, t("ai.remote.missingDocument", { path: d.path }));
				return true;
			}
			notes.push(note);
		}
		// The log is written BEFORE the line exists: a crash between the two loses
		// one request (reported as interrupted), it never runs one twice.
		log.push({ id: req.id, from: req.from, at: deps.now() });
		await deps.takenLog.write(pruned(log, deps.now()));
		const types = (req.types ?? []).filter(x => CANONICAL_TYPES.includes(x));
		const demande: DemandeFile = {
			text: req.text, notes, images: [], mode: req.mode, count: req.count ?? null,
			type: normalizeTypes(types), destination: "", reglages: s,
			categorie: categorieChoisie("auto", indicesCategorie(notes, req.text, s.aiOutputFolder ?? "")),
			chatId: req.chatId, requestId: req.id, sentAt: req.at, fromDevice: req.from,
		};
		deps.queue.envoyer(demande);
		const title = t("ai.remote.notifyTitle", { device: req.fromName || t("ai.remote.unknownDevice") }).slice(0, NOTIFY_TITLE_MAX);
		deps.notify(title, (req.text.split("\n").find(l => l.trim()) ?? "").trim().slice(0, NOTIFY_BODY_MAX));
		return true;
	}

	/** A provider switch: never touches anything but `aiProvider`, once per id. */
	async function setting(file: { fileDevice: string; fileId: string; raw: unknown }, sw: NonNullable<RunnerDeps["providerSwitch"]>): Promise<void> {
		const v = validateSetting(file.raw, { device: deps.device, fileDevice: file.fileDevice, fileId: file.fileId, now: deps.now() });
		if (!v.ok) {
			const key = file.fileDevice + "/" + file.fileId;
			if (!refused.has(key)) { refused.add(key); console.warn(LOG_PREFIX, "setting request ignored:", file.fileDevice, file.fileId, v.reason); }
			return;
		}
		const req: SettingRequest = v.request;
		const log = await sw.takenLog.read();
		if (admitSetting(req, log, deps.now()) !== "run") return;
		const device = (req.fromName || t("ai.remote.unknownDevice")).slice(0, 64);
		const say = (body: string): void => deps.notify(PRODUCT_NAME.slice(0, NOTIFY_TITLE_MAX), body.slice(0, NOTIFY_BODY_MAX));
		// Written BEFORE anything is applied or said: a crash loses this request, it never applies one twice.
		log.push({ id: req.id, from: req.from, at: deps.now(), reported: true });
		await sw.takenLog.write(pruned(log, deps.now()));
		if (deps.settings().aiProvider === "claude-code") return;
		if (!(await sw.claudeAvailable())) { say(t("ai.remote.providerNoCli")); return; }
		try {
			// Exactly what the picker sets (provider + its default model, so no stale model id of another provider survives); no effort, path or folder.
			await sw.apply({ aiProvider: "claude-code", aiModel: sw.claudeDefaultModel() });
		} catch (e) {
			console.warn(LOG_PREFIX, "provider switch refused:", e);
			say(t("ai.remote.providerRefused"));
			return;
		}
		say(t("ai.remote.providerSet", { device }));
		sw.applied();
	}

	async function scan(): Promise<void> {
		if (scanning) { again = true; return; }
		scanning = true;
		try {
			await deps.queue.pret;
			do {
				again = false;
				const log = await deps.takenLog.read();
				let changed = false;
				for (const f of await deps.readIncoming()) {
					if (isSettingRaw(f.raw)) { if (deps.providerSwitch) await setting(f, deps.providerSwitch); }
					else if (await one(f, log)) changed = true;
				}
				if (changed) await deps.takenLog.write(pruned(log, deps.now()));
			} while (again);
		} catch (e) {
			console.warn(LOG_PREFIX, "remote request scan failed:", e);
		} finally {
			scanning = false;
		}
	}

	deps.queue.abonner(() => { void scan(); }, () => false);
	return { scan };
}
