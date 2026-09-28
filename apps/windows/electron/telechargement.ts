/* ══════════════════════════════════════════════════════════
   THE DOWNLOAD TRANSPORT — MANUAL REDIRECTS, EVERY HOP RE-JUDGED

   Extracted from video-installation.ts at task 9 of
   docs/superpowers/plans/2026-09-28-c-cpp-execution.md (the C/C++ language
   pack): a GET/HEAD transport that follows redirects BY HAND, re-judging
   every `Location` against `hoteAutorise` (reseau.ts) before following it —
   a `redirect: "follow"` fetch would let a listed host designate any other
   host as the actual download source. Also the shared error shape
   (`code: "reseau" | "empreinte"`, video-installation.ts's own vocabulary,
   kept unchanged: a rename here would touch every caller for no behaviour
   change) and the byte-stream reader both installers use to drive a
   progress callback.

   `video-installation.ts` (yt-dlp) and `langages.ts` (the C/C++ pack) both
   need this: a copy would eventually drift, and `video-installation.ts`'s
   own public names (`ErreurInstallation`, `estErreurInstallation`,
   `CodeInstallation`) are unchanged — it re-exports them from here, so no
   caller of either module had to change for a behaviour that did not.
   ══════════════════════════════════════════════════════════ */

import { hoteAutorise } from "./reseau";

/** A download response, reduced to what an installer reads: `entete` a
    single header by name (the LENGTH of a HEAD, the DESTINATION of a
    redirect), `texte` the whole body (a checksums file), `octets` the body
    streamed in chunks (an executable or archive, for progress) — present
    only when the body is one. */
export interface ReponseInstallation {
	status: number;
	entete(nom: string): string | null;
	texte(): Promise<string>;
	octets?(): AsyncIterable<Uint8Array>;
}

/** The transport: the seam a check injects (a fake release served from a
    temp folder, NEVER the network), production laying it over the main
    process's global `fetch`. Every call is judged against the host list
    BEFORE the transport — the transport does not decide, it obeys. */
export type TransportInstallation = (url: string, init: { method: "GET" | "HEAD" }) => Promise<ReponseInstallation>;

/** A fetch body's chunks, read by an explicit reader: undici's
    ReadableStream is iterable at runtime, but its typed shape varies by
    library (DOM vs undici-types) — the explicit reader is the one stable
    bridge. */
export async function* paquetsDe(corps: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } }): AsyncGenerator<Uint8Array> {
	const lecteur = corps.getReader();
	while (true) {
		const suite = await lecteur.read();
		if (suite.done) return;
		if (suite.value) yield suite.value;
	}
}

/** THE DEFAULT TRANSPORT: the main process's global `fetch`, with MANUAL
    redirects — every hop is re-judged against the host list by `demander`
    below (github.com redirects an asset to release-assets…, both listed; a
    foreign host would not be). `octets` reads the stream chunk by chunk:
    it is what carries progress. */
export const transportDefaut: TransportInstallation = async (url, init) => {
	const reponse = await globalThis.fetch(url, { method: init.method, redirect: "manual" });
	/* undici's ReadableStream is iterable at runtime, but its typed shape
	   varies by library (DOM, undici-types) — the explicit reader is the one
	   stable bridge. */
	const corps = reponse.body as unknown as { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null;
	return {
		status: reponse.status,
		entete: (nom) => reponse.headers.get(nom),
		texte: () => reponse.text(),
		octets: corps ? () => paquetsDe(corps) : undefined,
	};
};

/** The codes an installer's caller judges: `reseau` (the release is
    unreachable, outside the host list, unreadable) and `empreinte` (a
    checksum that does not name the asset, or bytes that do not match it).
    The user-facing message is each caller's own decision — only the CODE
    lives here. */
export type CodeInstallation = "reseau" | "empreinte";

/** An installer's error: `code` carries the decision, `detail` the last
    300 characters for the log. */
export interface ErreurInstallation extends Error {
	code: CodeInstallation;
	detail?: string;
}

export function erreurInstallation(code: CodeInstallation, detail?: string): ErreurInstallation {
	const e = new Error("installation: " + code + (detail ? " — " + detail : "")) as ErreurInstallation;
	e.name = code;
	e.code = code;
	if (detail) e.detail = detail;
	return e;
}

/** Exported for the bridge channel: a rejection that is not from an
    installer (a bug, a failure elsewhere) is reduced to `reseau` on the
    renderer side, never an untranslated message. */
export function estErreurInstallation(e: unknown): e is ErreurInstallation {
	const o = e as { code?: string };
	return !!o && (o.code === "reseau" || o.code === "empreinte");
}

/** Redirects followed BY HAND, each re-judged against the host list AFTER
    every hop: a `redirect: "follow"` fetch would trust wherever a listed
    host points. Too many hops (or a host outside the list) rejects
    `reseau` — the list is not negotiable. `maxSauts` defaults to 3: two
    real hops (github.com → release-assets.githubusercontent.com, or the
    equivalent object storage host) plus one — a third would be suspect. */
export async function demander(url: string, method: "GET" | "HEAD", transport: TransportInstallation, maxSauts = 3): Promise<ReponseInstallation> {
	let courant = url;
	for (let saut = 0; saut < maxSauts; saut++) {
		if (!hoteAutorise(courant)) throw erreurInstallation("reseau", "host outside the list: " + courant);
		const reponse = await transport(courant, { method });
		if (reponse.status < 300 || reponse.status >= 400) return reponse;
		const lieu = reponse.entete("location");
		if (!lieu) throw erreurInstallation("reseau", "redirect without a destination: " + courant);
		courant = new URL(lieu, courant).toString();
	}
	throw erreurInstallation("reseau", "too many redirects: " + url);
}
