import { LOG_PREFIX } from "../../../../src/branding";
import { REVIEW_DIR, isConflictCopy } from "../../../../src/review/paths";
import { DEVICE, SLUG } from "../../../../src/shared-state/remote-request";
import { CODE_RUNS_DIR, MAX_REQUEST_CHARS, MAX_RESULT_CHARS, MAX_OUTPUT } from "../../../../src/shared-state/code-run-request";
import type { CodeRunRequest, CodeRunResult } from "../../../../src/shared-state/code-run-request";
import type { CodeRunFiles, IncomingCodeRun } from "../../../../src/dashboard/code-run-remote";
import { MAX_REQUEST_FILES, MAX_SENDERS } from "./chat-files";
import type { SharedFs } from "./shared-state";

/* ══════════════════════════════════════════════════════════
   THE CODE-RUN FILES of the synced folder (dashboard/code-run-remote.ts):
   `<root>/.neo-quiz/code-runs/requests/<device>/<id>.json` (the phone's) and
   `results/<device>/<id>.json` (the PC's). Same rules as the request files of
   `chat-files.ts`: this device writes only its own folders (temp file,
   remove, rename), reads the others size-checked BEFORE reading (another
   device controls their size), skips conflict copies, temp files and
   anything not named `<slug>.json`, and never throws on a bad file.
══════════════════════════════════════════════════════════ */

export interface CodeRunFilesDeps { fs: SharedFs & { listDir(dir: string): Promise<Array<{ name: string; isFolder: boolean }>> }; rootId: string; deviceId: string }

const baseName = (full: string): string => full.slice(full.lastIndexOf("/") + 1);

export function createCodeRunFiles(deps: CodeRunFilesDeps): CodeRunFiles {
	const { fs, rootId, deviceId } = deps;
	const base = `${rootId}/${REVIEW_DIR}/${CODE_RUNS_DIR}`;
	const reqDir = `${base}/requests`, resDir = `${base}/results`;
	const own = (kind: "requests" | "results"): string => `${base}/${kind}/${deviceId}`;
	let queue: Promise<unknown> = Promise.resolve();
	const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
		const run = queue.then(job, job);
		queue = run.catch(() => {});
		return run;
	};

	/** A UTF-8 character is at most 4 bytes: `max` characters fit in `4 * max` bytes. An unknown size is refused. */
	async function readJson(path: string, maxChars: number): Promise<unknown> {
		try {
			const n = await fs.size(path);
			if (n === null || n > 4 * maxChars) return null;
			const raw = await fs.readBounded(path, 4 * maxChars);
			return raw.length > maxChars ? null : JSON.parse(raw);
		} catch { return null; }
	}

	const writeOwn = (kind: "requests" | "results", id: string, body: string): Promise<void> => enqueue(async () => {
		const dir = own(kind), target = `${dir}/${id}.json`;
		await fs.mkdirs(dir);
		await fs.write(`${target}.tmp`, body);
		if (await fs.exists(target)) await fs.remove(target);
		await fs.rename(`${target}.tmp`, target);
	});

	async function writeRequest(req: CodeRunRequest): Promise<void> {
		if (!SLUG.test(req.id)) throw new Error("request id refused");
		if (req.from.toLowerCase() !== deviceId.toLowerCase()) throw new Error("request is not ours");
		const body = JSON.stringify(req);
		if (body.length > MAX_REQUEST_CHARS) throw new Error("request too large");
		await writeOwn("requests", req.id, body);
	}

	async function writeResult(res: CodeRunResult): Promise<void> {
		if (!SLUG.test(res.id)) throw new Error("result id refused");
		// JSON escaping can grow an output (a control character becomes six): cut further until the file fits.
		let r = res, body = JSON.stringify(r);
		for (let cap = MAX_OUTPUT; body.length > MAX_RESULT_CHARS && cap > 0; cap = Math.floor(cap / 2)) {
			r = { ...res, stdout: res.stdout.slice(0, cap), ...(res.error !== undefined ? { error: res.error.slice(0, cap) } : {}) };
			body = JSON.stringify(r);
		}
		if (body.length > MAX_RESULT_CHARS) throw new Error("result too large");
		await writeOwn("results", res.id, body);
	}

	const deleteOwnRequest = (id: string): Promise<void> => enqueue(async () => {
		if (!SLUG.test(id)) throw new Error("request id refused");
		const path = `${own("requests")}/${id}.json`;
		if (await fs.exists(path)) await fs.remove(path);
	});

	async function readResult(device: string, id: string): Promise<unknown> {
		if (!DEVICE.test(device) || !SLUG.test(id)) return null;
		return readJson(`${resDir}/${device}/${id}.json`, MAX_RESULT_CHARS);
	}

	async function readIncoming(known: (fileDevice: string, fileId: string) => boolean): Promise<IncomingCodeRun[]> {
		let senders: Array<{ name: string; isFolder: boolean }>;
		try { senders = await fs.listDir(reqDir); } catch { return []; }
		const out: IncomingCodeRun[] = [];
		const eligible = senders.filter(s => s.isFolder && DEVICE.test(s.name) && s.name.toLowerCase() !== deviceId.toLowerCase()).sort((a, b) => a.name < b.name ? -1 : 1);
		for (const s of eligible.slice(0, MAX_SENDERS)) {
			let names: string[];
			try { names = (await fs.list(`${reqDir}/${s.name}`)).map(baseName); } catch { continue; }
			// Ids start with a base-36 timestamp: sorted by name, the oldest come first.
			const ids = names.filter(n => n.endsWith(".json") && !isConflictCopy(n)).map(n => n.slice(0, -5)).filter(id => SLUG.test(id) && !known(s.name, id)).sort();
			for (const id of ids.slice(0, MAX_REQUEST_FILES)) {
				const raw = await readJson(`${reqDir}/${s.name}/${id}.json`, MAX_REQUEST_CHARS);
				// Named all the same: the caller remembers it, so it stops taking one of the 20 slots of every pass.
				if (raw === null) { console.warn(`${LOG_PREFIX} code run request unreadable or too large, ignored:`, s.name, id); out.push({ fileDevice: s.name, fileId: id, raw: null, unreadable: true }); continue; }
				out.push({ fileDevice: s.name, fileId: id, raw });
			}
		}
		return out;
	}

	/* Each file is judged and removed inside the write queue: a temp file being
	   written right now is never read half-written, nor removed under its rename.
	   A `.json.tmp` left by an interrupted write carries the same body: judged alike. */
	async function sweepOwn(kind: "requests" | "results", maxAgeMs: number, now: number): Promise<void> {
		const dir = own(kind);
		let names: string[];
		try { names = (await fs.list(dir)).map(baseName); } catch { return; }
		for (const n of names) {
			if (!n.endsWith(".json") && !n.endsWith(".json.tmp")) continue;
			await enqueue(async () => {
				if (!(await fs.exists(`${dir}/${n}`))) return;
				const raw = await readJson(`${dir}/${n}`, kind === "requests" ? MAX_REQUEST_CHARS : MAX_RESULT_CHARS);
				const at = raw && typeof raw === "object" ? (raw as { at?: unknown }).at : undefined;
				if (typeof at === "number" && Number.isFinite(at) && now - at <= maxAgeMs) return;
				await fs.remove(`${dir}/${n}`);
			}).catch(() => {});
		}
	}

	return { writeRequest, deleteOwnRequest, readResult, readIncoming, writeResult, sweepOwn };
}
