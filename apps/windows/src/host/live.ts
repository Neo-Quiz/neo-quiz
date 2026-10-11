/* ══════════════════════════════════════════════════════════
   LIVE AI SESSIONS, SEEN FROM THE WINDOW (2026-10-11)

   `HostLive` (`src/host/types.ts`) over the bridge (`window.neo.live`): a
   pass-through. Every value is rebuilt field by field before it crosses (a
   stray property of the page's object never reaches the main process, which
   refuses it anyway), and an envelope's refusal becomes an Error whose
   `name` is its code (`untrusted`, `not-installed`, `refused`, `failed`).
   Nothing here pulls Node (`check:host`): `Pont` is a type.
══════════════════════════════════════════════════════════ */

import type { HostLive, LiveInput } from "../../../../src/host/types";
import type { EnveloppeLive, Pont } from "../../electron/pont";

function valeur<T>(r: EnveloppeLive<T>): T {
	if (r.ok) return r.valeur;
	const e = new Error(r.message);
	e.name = r.code;
	throw e;
}

function entree(input: LiveInput): LiveInput {
	if (input.kind === "message") return { kind: "message", text: input.text, images: input.images.map(i => ({ mediaType: i.mediaType, base64: i.base64 })) };
	if (input.kind === "permission") return { kind: "permission", requestId: input.requestId, allow: input.allow };
	return { kind: "interrupt" };
}

export function createWindowsLive(pont: () => Pont): HostLive {
	return {
		async start(o) {
			return valeur(await pont().live.start({
				tool: o.tool, chatId: o.chatId, model: o.model, mode: o.mode,
				...(o.effort !== undefined ? { effort: o.effort } : {}),
				...(o.runId !== undefined ? { runId: o.runId } : {}),
			}));
		},
		async send(runId, input) { valeur(await pont().live.send(runId, entree(input))); },
		async close(runId) { valeur(await pont().live.close(runId)); },
		onEvent: cb => pont().live.surEvenement(cb),
		readRun: (runId, page) => pont().live.lireRun(runId, page ? { offset: page.offset, limit: page.limit } : undefined),
		toolOutput: (runId, toolUseId) => pont().live.sortieOutil(runId, toolUseId),
		async removeRuns(runIds) { valeur(await pont().live.supprimerRuns([...runIds])); },
		storeSize: () => pont().live.tailleRuns(),
	};
}
