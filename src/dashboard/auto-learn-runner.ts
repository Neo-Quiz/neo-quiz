import { LOG_PREFIX } from "../branding";
import { currentHost } from "../host/current";
import { t } from "../i18n";
import { nomDeNote } from "../quiz-format";
import type { AiSettingsHost } from "./ai-settings-host";
import { nomDeSource, trouverLearn } from "./ai-sources";
import { UNKNOWN_RETRY_MS, USAGE_MAX_AGE_MS, decideGate, readAutoLearnSettings } from "./auto-learn-gate";
import type { GateVerdict, UsageSnapshot } from "./auto-learn-gate";
import { admit, autoChatId, autoKey, markState, recordStart, startsSince, toRequeue } from "./auto-learn-record";
import type { AutoEntry, AutoLearnLog } from "./auto-learn-record";
import { categorieDuDossier } from "./categorie-quiz";
import type { ChatRecord } from "./chat-record";
import { newChatId } from "./chat-session";
import { newRequestId } from "./chat-requests";
import { figerReglages, setAutoGate } from "./file-generation-app";
import type { DemandeFile, FileGenerationApp, LigneGeneration } from "./file-generation-app";
import { MAX_AMBIGUOUS_PER_CALL, classifyName, isPdf, lectureFolderOf, parseLectureVerdicts, readFreshFiles } from "./lecture-detect";
import type { FreshFile } from "./lecture-detect";
import type { Scanner } from "./scanner";
import { startOfToday } from "./usage-format";

/* ══════════════════════════════════════════════════════════
   THE AUTOMATIC LEARN RUNNER (spec 2026-10-15-moodle-auto-learn)

   Flow: take the files a full Moodle sync downloaded for the first time ->
   classify their NAMES (rules, then one short AI call for the ambiguous
   ones) -> drop lectures that already have a Learn -> record them in the
   log (`admit`, the only door: a lecture delivered twice gives ONE Learn) ->
   queue them (mode "auto") or propose them in a notification (mode
   "propose", the click starts them) -> each line passes the gate (usage,
   daily cap, trusted folder) before it starts -> notify when ready/failed.

   Rulings:
   - Mode "off" takes the fresh files and DISCARDS them: turning it on later
     does not backfill.
   - Only `.pdf` lectures are generated (the app has no slide text
     extraction): `.pptx` / `.ppt` are never even classified.
   - A name over 120 characters is "other" without an AI call.
   - The request text is EMPTY: the model follows the lecture's language.
   - Propose notifications are always shown (the click is the only way to
     start); ready/failure notifications follow Silent mode.
   - A line that leaves the queue while its entry is still "queued" (stopped
     or closed by the user) becomes "failed": final, never requeued.
   - After the queue is ready, entries still "queued" but absent from it (a
     restart dropped the session-scoped queue) are queued once more
     (`toRequeue`).
   - Every path, from the bridge or from the log, is re-validated by
     `readFreshFiles` before use.
══════════════════════════════════════════════════════════ */

export interface AutoLearnRunnerDeps {
	queue: FileGenerationApp;
	settings: AiSettingsHost;
	scanner: Scanner;
	takeFresh(): Promise<unknown>;
	onFresh(cb: () => void): () => void;
	lectureMinutes(folder: string): number | undefined;
	notify(title: string, body: string, onClick?: () => void): Promise<boolean>;
	silent(): boolean;
	openQuiz(path: string): void;
	openChat(chatId: string): void;
	readLog(): Promise<AutoLearnLog>;
	writeLog(log: AutoLearnLog): Promise<void>;
	chats(): readonly ChatRecord[];
	readUsage(tool: "claude" | "codex"): Promise<UsageSnapshot | null>;
	isTrusted(folder: string): Promise<boolean>;
	classify(names: readonly string[]): Promise<string>;
	now(): number;
}

const MAX_PDF_BYTES = 64 * 1024 * 1024;
const MAX_NAME_FOR_CALL = 120;

const sansExtension = (name: string): string => name.replace(/\.[^.\\/]+$/, "");

export function startAutoLearnRunner(deps: AutoLearnRunnerDeps): () => void {
	const host = currentHost();
	let log: AutoLearnLog | null = null;
	let chaine: Promise<void> = Promise.resolve();
	/* One step at a time: a batch, a gate decision, a line that ends — the log is read-modify-written in order. */
	const enOrdre = (fn: () => Promise<void>): Promise<void> => (chaine = chaine.then(fn).catch(e => { console.warn(LOG_PREFIX, "automatic Learn:", e); }));
	const garder = async (l: AutoLearnLog): Promise<void> => { log = l; await deps.writeLog(l); };
	const courant = async (): Promise<AutoLearnLog> => log ?? (log = await deps.readLog());
	const vus = new Set<string>();   // keys seen in the queue this session

	setAutoGate(async (d) => {
		const s = readAutoLearnSettings(deps.settings.get().aiAutoLearn);
		const provider = d.reglages.aiProvider ?? "";
		const tool = provider === "claude-code" ? "claude" : provider === "codex" ? "codex" : null;
		const trusted = !!d.destination && await deps.isTrusted(d.destination).catch(() => false);
		const usage = tool && (s.session.on || s.weekly.on) ? await deps.readUsage(tool).catch(() => null) : null;
		let v: GateVerdict = { go: false, block: { kind: "unknown" }, retryAt: deps.now() + UNKNOWN_RETRY_MS };
		await enOrdre(async () => {
			const cur = await courant();
			v = decideGate({ settings: s, provider, trusted, usage, startsToday: startsSince(cur, startOfToday(deps.now())), now: deps.now() });
			if (v.go) await garder(recordStart(cur, deps.now()));
		});
		return v;
	});

	/** The name-classification call is an AI call too: it obeys the same usage rules and daily cap as a generation (no start is recorded, no tools are used so trust is not asked). */
	async function peutAppeler(): Promise<boolean> {
		const s = readAutoLearnSettings(deps.settings.get().aiAutoLearn);
		const provider = deps.settings.get().aiProvider ?? "";
		const tool = provider === "claude-code" ? "claude" : provider === "codex" ? "codex" : null;
		const usage = tool && (s.session.on || s.weekly.on) ? await deps.readUsage(tool).catch(() => null) : null;
		const cur = await courant();
		return decideGate({ settings: s, provider, trusted: true, usage, startsToday: startsSince(cur, startOfToday(deps.now())), now: deps.now() }).go;
	}

	/** The text of a lecture PDF, or null when it has none; throws when it cannot be read. */
	async function lire(f: FreshFile): Promise<string | null> {
		const path = host.paths.contractPath(host.paths.defaultRoot().id, f.relPath);
		if (!host.pdf) throw new Error("no PDF reader");
		const size = await host.fs.size(path);
		if (size === null || size > MAX_PDF_BYTES) throw new Error("PDF missing or too large");
		const text = await host.pdf.extractText(await host.fs.readBinary(path));
		return text.trim() ? text : null;
	}

	/** The queue request of a lecture, or the failure text. */
	async function demande(f: FreshFile, entry: AutoEntry, chatId: string): Promise<DemandeFile | string> {
		let content: string | null;
		try { content = await lire(f); } catch (e) { console.warn(LOG_PREFIX, "automatic Learn: read failed:", e); return t("ai.autoLearn.readFailed"); }
		if (content === null) return t("ai.autoLearn.noText");
		const root = host.paths.defaultRoot().id;
		const folder = host.paths.contractPath(root, lectureFolderOf(f.relPath));
		const path = host.paths.contractPath(root, f.relPath);
		return {
			// EMPTY on purpose: the model follows the lecture's language.
			text: "", notes: [{ name: f.name, content, path, source: "vault" }], images: [],
			mode: "learn", count: null, type: ["Mixte"] /* TYPE_VALUES[0] of ai.ts: a Learn */, destination: folder,
			reglages: figerReglages(deps.settings.get()), // No clarify call here: the lecture's folder is the only known subject clue.
			categorie: categorieDuDossier(folder, undefined),
			chatId, requestId: newRequestId(), sentAt: deps.now(),
			auto: { key: entry.key, relPath: f.relPath }, lectureMinutes: deps.lectureMinutes(folder),
		};
	}

	/** Does this lecture already have a Learn? */
	function dejaFait(f: FreshFile): boolean {
		const folder = host.paths.contractPath(host.paths.defaultRoot().id, lectureFolderOf(f.relPath));
		const source = nomDeSource([{ name: f.name }], "", f.name);
		return !!trouverLearn(deps.scanner.getQuizzes(), folder, source) || !!deps.scanner.getQuiz(folder + "/" + nomDeNote(source, "learn") + ".md");
	}

	/** The PDF lectures among these files: rules first, then the short AI call for the ambiguous names; already-done ones dropped. */
	async function trier(files: FreshFile[]): Promise<FreshFile[]> {
		const pdfs = files.filter(f => isPdf(f.name));
		const verdict = new Map<string, "lecture" | "other">();
		const ambigus: string[] = [];
		for (const f of pdfs) {
			const v = classifyName(f.name);
			if (v === "ambiguous") { if (f.name.length <= MAX_NAME_FOR_CALL && !ambigus.includes(f.name)) ambigus.push(f.name); } else verdict.set(f.name, v);
		}
		const appeler = ambigus.length > 0 && await peutAppeler().catch(() => false);   // gate closed: ambiguous names count as "other"
		for (let i = 0; appeler && i < ambigus.length; i += MAX_AMBIGUOUS_PER_CALL) {
			const chunk = ambigus.slice(i, i + MAX_AMBIGUOUS_PER_CALL);
			let res = new Map<string, "lecture" | "other">(chunk.map(n => [n, "other"]));
			try { res = parseLectureVerdicts(await deps.classify(chunk), chunk); } catch (e) { console.warn(LOG_PREFIX, "automatic Learn: classification failed:", e); }
			for (const [n, v] of res) verdict.set(n, v);
		}
		return pdfs.filter(f => verdict.get(f.name) === "lecture" && !dejaFait(f));
	}

	function notifierEchec(name: string, message: string): void {
		if (deps.silent()) return;
		void deps.notify(t("ai.autoLearn.failedTitle", { title: sansExtension(name) }), message);
	}

	/** Reads, builds and sends one line per admitted entry; one that cannot be read becomes "failed". Inside `enOrdre`. */
	async function envoyer(paires: { f: FreshFile; entry: AutoEntry }[], chatId: string): Promise<void> {
		for (const { f, entry } of paires) {
			const d = await demande(f, entry, chatId);
			if (typeof d === "string") {
				await garder(markState(await courant(), entry.key, "failed", deps.now()));
				notifierEchec(f.name, d);
			} else deps.queue.envoyer(d);
		}
	}

	/** Records and queues lectures: the ONLY way a lecture reaches the queue. Inside `enOrdre`. */
	async function mettreEnFile(lectures: FreshFile[]): Promise<void> {
		const { log: l1, chatId } = autoChatId(await courant(), deps.chats(), newChatId);
		const { log: l2, admitted } = admit(l1, lectures, deps.now());
		await garder(l2);
		const parCle = new Map(lectures.map(f => [autoKey(f.relPath, f.size), f]));
		await envoyer(admitted.flatMap(entry => { const f = parCle.get(entry.key); return f ? [{ f, entry }] : []; }), chatId);
	}

	/** One batch of fresh files, if the mode wants it. */
	async function traiter(): Promise<void> {
		const s = readAutoLearnSettings(deps.settings.get().aiAutoLearn);
		const files = readFreshFiles(await deps.takeFresh().catch(() => []));
		if (s.mode === "off" || !files.length) return;
		const lectures = await trier(files);
		if (!lectures.length) return;
		if (s.mode === "auto") { await enOrdre(() => mettreEnFile(lectures)); return; }
		const codes = [...new Set(lectures.map(f => f.code))];
		const titre = codes.length > 1 ? t("ai.autoLearn.proposeCourses", { count: lectures.length, courses: codes.length })
			: t(lectures.length === 1 ? "ai.autoLearn.proposeOne" : "ai.autoLearn.proposeMany", { count: lectures.length, code: codes[0] });
		void deps.notify(titre, t("ai.autoLearn.proposeAction"), () => {
			void enOrdre(() => mettreEnFile(lectures)).then(() => { if (log?.chatId) deps.openChat(log.chatId); });
		});
	}

	/** Entries still "queued" but absent from the (new) queue: queued once more, or closed when their file is no longer valid or already has its Learn. Inside `enOrdre`. */
	async function reprendre(): Promise<void> {
		const cur = await courant();
		const present = new Set(deps.queue.lignes().map(l => l.demande.auto?.key).filter((k): k is string => !!k));
		const paires: { f: FreshFile; entry: AutoEntry }[] = [];
		let l = cur;
		for (const entry of toRequeue(cur, present)) {
			const name = entry.relPath.split("/").pop() ?? "";
			// The code is not kept in the log: any valid one will do, only the validator needs it.
			const [f] = readFreshFiles([{ relPath: entry.relPath, code: "X", name, size: entry.size }]);
			if (!f) l = markState(l, entry.key, "failed", deps.now());
			else if (dejaFait(f)) l = markState(l, entry.key, "done", deps.now());
			else paires.push({ f, entry });
		}
		if (l !== cur) await garder(l);
		if (!paires.length) return;
		const r = autoChatId(await courant(), deps.chats(), newChatId);
		if (r.log !== (await courant())) await garder(r.log);
		await envoyer(paires, r.chatId);
	}

	/** Queue subscriber: announces a ready or failed line once, and fails the entry of a line that vanished. */
	function suivre(): void {
		const lignes: readonly LigneGeneration[] = deps.queue.lignes();
		const presentes = new Set<string>();
		const issues: { key: string; line: LigneGeneration }[] = [];
		for (const l of lignes) {
			const key = l.demande.auto?.key;
			if (!key) continue;
			presentes.add(key);
			vus.add(key);
			if (l.etat === "prete" || l.etat === "echouee") issues.push({ key, line: l });
		}
		// Taken now, not inside `enOrdre`: a line closed meanwhile must not look vanished after it ended.
		const disparues = [...vus].filter(k => !presentes.has(k));
		for (const k of disparues) vus.delete(k);
		if (!issues.length && !disparues.length) return;
		void enOrdre(async () => {
			const queued = async (key: string): Promise<AutoEntry | undefined> => (await courant()).entries.find(e => e.key === key && e.state === "queued");
			for (const { key, line } of issues) {
				const entry = await queued(key);
				if (!entry) continue;
				const chemin = line.etat === "prete" ? line.resultat?.chemin : "";
				const name = entry.relPath.split("/").pop() ?? entry.relPath;
				if (chemin) {
					await garder(markState(await courant(), key, "done", deps.now(), chemin));
					if (!deps.silent()) void deps.notify(t("ai.autoLearn.readyTitle", { title: line.resultat?.titre ?? sansExtension(name) }), "", () => deps.openQuiz(chemin));
				} else {
					await garder(markState(await courant(), key, "failed", deps.now()));
					notifierEchec(name, line.erreur ?? t(line.etat === "prete" ? "ai.autoLearn.noQuiz" : "ai.autoLearn.readFailed"));
				}
			}
			for (const key of disparues) {
				if (await queued(key)) await garder(markState(await courant(), key, "failed", deps.now()));
			}
		});
	}

	const stopQueue = deps.queue.abonner(suivre, () => false);
	void Promise.all([deps.queue.pret, deps.scanner.ready]).then(() => enOrdre(reprendre)).then(traiter);
	const stopFresh = deps.onFresh(() => { void traiter(); });
	return () => { stopFresh(); stopQueue(); setAutoGate(null); };
}
