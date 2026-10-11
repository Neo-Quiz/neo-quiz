/* ══════════════════════════════════════════════════════════
   THE IPC CHANNELS OF LIVE AI SESSIONS AND THEIR RUN STORE (2026-10-11).

   `live.*` and `runs.*` of the bridge (`pont.ts`), registered by
   `canaux.ts`. Every channel:
   - answers the main window only (`depuisFenetrePrincipale`, the sender
     guard of the code channels): the code sandbox's hidden window, or any
     other frame, gets a refusal;
   - hands the RAW payload to the manager (`live-sessions.ts`), which
     validates every field (`live-session-rules.ts`) before a byte reaches a
     process; a run id is a lowercase UUID the main process created, and a
     run held by another window is refused;
   - never sends a whole run: `runs.read` gives pages of at most 2000 events
     and about 8 MB of JSON, a tool output is fetched alone by its id.

   ONE run store for the app (`<userData>/runs/`), one manager. The Neo Quiz
   root is the working folder, judged at every spawn like the agent forms
   (`dossierOutilsJuge`: resolved, inside the perimeter, trusted). Codex
   runs in the private home `<userData>/codex-home/default`, prepared from
   `CODEX_HOME` or `~/.codex` before EVERY spawn (`codex-home.ts`).
══════════════════════════════════════════════════════════ */

import { ipcMain, webContents } from "electron";
import { randomUUID } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { LOG_PREFIX } from "../../../src/branding";
import type { LiveErrorCode, RunPage } from "../../../src/host/types";
import { prepareCodexHome } from "./codex-home";
import { createLiveManager, LiveError } from "./live-sessions";
import type { LiveChild, LiveManager } from "./live-sessions";
import { isRunId, isSafeId, MAX_PAGE_CHARS, validatePage } from "./live-session-rules";
import { lancerVivant } from "./process";
import { CANAUX } from "./pont";
import type { EnveloppeLive } from "./pont";
import { createRunStore } from "./run-store";

const EXTENSIONS: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };
const STDERR_TAIL = 4096;
const MAX_REMOVE = 1000;

export interface DependancesLive {
	userData: string;
	version: string;
	/** The Neo Quiz root (the default folder), read at each call. */
	racine(): string;
	/** `canaux.ts`: the resolved folder if trusted and inside the perimeter. */
	dossierJuge(dossier: string): Promise<string | undefined>;
	depuisFenetrePrincipale(e: Electron.IpcMainInvokeEvent): boolean;
}

function enveloppe<T>(p: Promise<T>): Promise<EnveloppeLive<T>> {
	return p.then(valeur => ({ ok: true as const, valeur }), (e: unknown) => {
		const code: LiveErrorCode = e instanceof LiveError ? e.name as LiveErrorCode : "failed";
		const message = e instanceof Error ? e.message : String(e);
		if (code !== "refused") console.warn(LOG_PREFIX, "live session:", code, message);
		return { ok: false as const, code, message };
	});
}

/** The real process behind a session (`process.ts`, `lancerVivant`). */
function spawnReel(o: { tool: "claude" | "codex"; args: string[]; cwd: string; codexHome?: string }): LiveChild {
	let h: ReturnType<typeof lancerVivant>;
	try {
		h = lancerVivant({ tool: o.tool, args: o.args, cwd: o.cwd, envExtra: o.codexHome ? { CODEX_HOME: o.codexHome, CODEX_SQLITE_HOME: o.codexHome } : undefined });
	} catch (e) {
		throw new LiveError(e instanceof Error && e.name === "introuvable" ? "not-installed" : "failed", e instanceof Error ? e.message : String(e));
	}
	const child = h.child;
	let exitCb: ((code: number | null) => void) | null = null;
	let fini = false;
	let stderr = "";
	const fin = (code: number | null): void => {
		if (fini) return;
		fini = true;
		if (code !== 0 && stderr.trim()) console.warn(LOG_PREFIX, "live", o.tool, "exited", code, stderr.trim().slice(-1000));
		if (exitCb) exitCb(code);
	};
	child.stdout?.setEncoding("utf8");
	child.stderr?.setEncoding("utf8");
	child.stderr?.on("data", (d: string) => { stderr = (stderr + d).slice(-STDERR_TAIL); });
	child.on("error", e => { console.warn(LOG_PREFIX, "live", o.tool, "error:", e.message); fin(null); });
	child.on("close", code => fin(code));
	return {
		onStdout: cb => { child.stdout?.on("data", cb); },
		onExit: cb => { exitCb = cb; },
		write: h.write,
		kill: h.kill,
	};
}

/** One page of a run: by count, then by size (at least one event). */
function pageOf(run: NonNullable<Awaited<ReturnType<ReturnType<typeof createRunStore>["read"]>>>, offset: number, limit: number, live: boolean): RunPage {
	const events = [];
	let chars = 0;
	for (let i = offset; i < run.events.length && events.length < limit; i++) {
		chars += JSON.stringify(run.events[i]).length;
		if (events.length > 0 && chars > MAX_PAGE_CHARS) break;
		events.push(run.events[i]);
	}
	return { header: run.header, events, interrupted: run.interrupted && !live, truncated: run.truncated, offset, total: run.events.length, live };
}

/** Registers the channels; returns the manager (`killAll` on quit). */
export function enregistrerCanauxLive(deps: DependancesLive): LiveManager {
	const store = createRunStore(path.join(deps.userData, "runs"));
	const codexHome = path.join(deps.userData, "codex-home", "default");
	const codexSource = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
	const imagesDe = (runId: string) => path.join(os.tmpdir(), "neo-quiz-live", runId);

	const manager = createLiveManager({
		store,
		launch: spawnReel,
		root: async () => (await deps.dossierJuge(deps.racine())) ?? null,
		codex: { home: codexHome, prepare: () => prepareCodexHome({ source: codexSource, home: codexHome }) },
		emit(owner, e) {
			const wc = webContents.fromId(owner);
			if (wc && !wc.isDestroyed()) wc.send(CANAUX.liveEvenement, e);
		},
		version: deps.version,
		async writeImages(runId, images) {
			// `runId` was checked as a UUID; the names are the app's own.
			const dir = imagesDe(runId);
			await fsp.mkdir(dir, { recursive: true });
			const out: { path: string }[] = [];
			for (const im of images) {
				const file = path.join(dir, randomUUID() + EXTENSIONS[im.mediaType]);
				await fsp.writeFile(file, Buffer.from(im.base64, "base64"), { flag: "wx" });
				out.push({ path: file });
			}
			return out;
		},
		dropImages: runId => fsp.rm(imagesDe(runId), { recursive: true, force: true }),
		uuid: randomUUID,
		now: Date.now,
		timers: { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h as ReturnType<typeof setTimeout>) },
		log: (...a) => console.warn(LOG_PREFIX, ...a),
	});

	/* A reload (navigation, renderer crash) leaves 60 s to come back; a
	   destroyed window takes its sessions at once. */
	const suivies = new WeakSet<Electron.WebContents>();
	const suivre = (page: Electron.WebContents): number => {
		const id = page.id;
		if (suivies.has(page)) return id;
		suivies.add(page);
		page.on("did-start-navigation", (...a: unknown[]) => {
			const details = a[0] as { isMainFrame?: boolean; isSameDocument?: boolean } | undefined;
			const surPlace = typeof a[2] === "boolean" ? a[2] : details?.isSameDocument === true;
			const cadrePrincipal = typeof a[3] === "boolean" ? a[3] : details?.isMainFrame !== false;
			if (cadrePrincipal && !surPlace) manager.pageGone(id, false);
		});
		page.on("render-process-gone", () => manager.pageGone(id, false));
		page.once("destroyed", () => manager.pageGone(id, true));
		return id;
	};
	const refus = <T>(): Promise<EnveloppeLive<T>> => Promise.resolve({ ok: false, code: "refused", message: "refused" });

	ipcMain.handle(CANAUX.liveDemarrer, (e, o: unknown) => deps.depuisFenetrePrincipale(e) ? enveloppe(manager.start(suivre(e.sender), o)) : refus());
	ipcMain.handle(CANAUX.liveEnvoyer, (e, runId: unknown, input: unknown) =>
		deps.depuisFenetrePrincipale(e) ? enveloppe(manager.send(suivre(e.sender), runId, input).then(() => null)) : refus());
	ipcMain.handle(CANAUX.liveFermer, (e, runId: unknown) =>
		deps.depuisFenetrePrincipale(e) ? enveloppe(manager.close(suivre(e.sender), runId).then(() => null)) : refus());

	/** A run this window may read: a UUID not held by ANOTHER window. */
	const lisible = (e: Electron.IpcMainInvokeEvent, runId: unknown): runId is string =>
		deps.depuisFenetrePrincipale(e) && isRunId(runId) && manager.holder(e.sender.id, runId) !== "other";

	ipcMain.handle(CANAUX.runsLire, async (e, runId: unknown, page: unknown): Promise<RunPage | null> => {
		const p = validatePage(page);
		if (!p || !lisible(e, runId)) return null;
		const run = await store.read(runId);
		return run ? pageOf(run, p.offset, p.limit, manager.isLive(runId)) : null;
	});
	ipcMain.handle(CANAUX.runsSortie, async (e, runId: unknown, toolUseId: unknown): Promise<string | null> =>
		lisible(e, runId) && typeof toolUseId === "string" ? store.toolOutput(runId, toolUseId) : null);
	ipcMain.handle(CANAUX.runsSupprimer, (e, runIds: unknown, chatId: unknown): Promise<EnveloppeLive<null>> => {
		if (!deps.depuisFenetrePrincipale(e) || !Array.isArray(runIds) || runIds.length > MAX_REMOVE || !runIds.every(id => lisible(e, id)) || !isSafeId(chatId)) return refus();
		const owner = suivre(e.sender);
		return enveloppe((async () => {
			// A run still running is stopped first: its process would write on.
			for (const id of runIds as string[]) if (manager.holder(owner, id) === "own") await manager.close(owner, id);
			// Deleted for real (`run-store.ts`), and only the runs of THIS chat.
			await store.remove(runIds as string[], chatId);
			return null;
		})());
	});
	/* "Delete all": every run file, known to a chat or not (a chat deleted on
	   another device, ids past a chat's cap). This window's sessions are
	   closed first; a run another window holds live is kept. */
	ipcMain.handle(CANAUX.runsToutSupprimer, (e): Promise<EnveloppeLive<null>> => {
		if (!deps.depuisFenetrePrincipale(e)) return refus();
		const owner = suivre(e.sender);
		return enveloppe((async () => {
			await manager.closeOwn(owner);
			await store.removeAll(manager.heldElsewhere(owner));
			return null;
		})());
	});
	ipcMain.handle(CANAUX.runsTaille, (e) => (deps.depuisFenetrePrincipale(e) ? store.size() : 0));

	return manager;
}
