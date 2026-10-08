import { LOG_PREFIX } from "../branding";
import type { FileGenerationApp } from "./file-generation-app";
import { groupLines } from "./chat-requests";
import { entryOfGroup, shouldWrite, WRITE_EVERY_MS } from "../shared-state/generations";
import type { GenerationsFile } from "../shared-state/generations";

export interface PublisherDeps {
	queue: Pick<FileGenerationApp, "lignes" | "transcript" | "abonner" | "abonnerTranscript">;
	write(file: GenerationsFile): Promise<void>;
	device: string;
	now?: () => number;
}

/** Publishes what this window is generating, throttled (`shouldWrite`). The final state (nothing running) is written when the last entry leaves and when `stop` is called. While idle it holds no timer and writes nothing. */
export function publishGenerations(deps: PublisherDeps): () => void {
	const clock = deps.now ?? Date.now;
	let last: { json: string; at: number } | null = null;
	let ids = new Set<string>();
	let wrote = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const snapshot = (): GenerationsFile => {
		const entries = groupLines(deps.queue.lignes())
			.map(g => entryOfGroup(g, id => deps.queue.transcript(id)?.text ?? "", deps.device))
			.filter((e): e is NonNullable<typeof e> => !!e);
		return { v: 1, at: clock(), running: entries };
	};

	function tick(): void {
		const next = snapshot();
		const nowIds = new Set(next.running.map(e => e.requestId));
		const left = [...ids].some(id => !nowIds.has(id));
		ids = nowIds;
		if (next.running.length === 0) {
			// Idle: no timer. Only the end of the last entry is worth a write.
			if (timer) { clearTimeout(timer); timer = null; }
			if (!left || !wrote) return;
		} else if (!timer) {
			// Held-back chunks and the 60 s keep-alive both need a later look.
			timer = setTimeout(() => { timer = null; tick(); }, WRITE_EVERY_MS);
		}
		if (!shouldWrite(last, next, next.at, left)) return;
		wrote = true;
		last = { json: JSON.stringify({ ...next, at: 0 }), at: next.at };
		deps.write(next).catch(e => console.warn(LOG_PREFIX, "generations not published:", e));
	}

	const off1 = deps.queue.abonner(tick, () => false);
	const off2 = deps.queue.abonnerTranscript(() => tick());
	return () => {
		off1(); off2();
		if (timer) clearTimeout(timer);
		timer = null;
		if (wrote) deps.write({ v: 1, at: clock(), running: [] }).catch(() => {});
	};
}
