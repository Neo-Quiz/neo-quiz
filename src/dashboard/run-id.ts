/* A run id for a one-shot CLI call (2026-10-19). The run store only takes a
   lowercase UUID. The id of a call that has a resume key is DERIVED from it:
   the replay of a line after a page reload asks the same key, attaches to
   the CLI still running (`resumable-runs.ts`), and must name the SAME run,
   which the launching call recorded. A call without a key gets a random id.
   Not a security boundary (the main process checks the shape and the chat);
   a plain, stable 128-bit mix of the key. */

/** cyrb128: four 32-bit words from a string. */
function mix(text: string): [number, number, number, number] {
	let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
	for (let i = 0; i < text.length; i++) {
		const k = text.charCodeAt(i);
		h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
		h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
		h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
		h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
	}
	h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
	h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
	h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
	h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
	return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

function asUuid(words: readonly number[]): string {
	const hex = words.map(w => (w >>> 0).toString(16).padStart(8, "0")).join("");
	const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The run id of the call under this resume key: the same key, the same id. */
export function runIdDeCle(key: string): string {
	return asUuid(mix(key));
}

/** A fresh random run id (a call with no resume key). */
export function newRunId(): string {
	return crypto.randomUUID();
}
