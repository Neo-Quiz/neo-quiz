/* ══════════════════════════════════════════════════════════
   THE PAIRING QR CODE THAT CHANGES (pure, no Node import)

   The "Show my ID" dialog shows a QR code that changes every `PERIODE_MS`:
   `neo-quiz://pair?device=<our id>&code=<code>`. A phone that scans it adds
   this PC by its id AND announces the code in the device name it presents
   (`Xiaomi 13T Pro [NQ:K7Q2M9XPAB]`): the name is the only field the REST
   API of Syncthing 2.x shows for a device we do not know yet
   (`/rest/cluster/pending/devices`). Same scheme as Neo Calendar
   (`src-tauri/src/sync/pairing.rs`), with ONE difference, the owner's choice
   for Neo Quiz (2026-10-03): a request that carries a valid code is NOT
   accepted on its own. It only opens the native confirmation by itself,
   worded "<name> scanned your QR code"; the rule "every pairing is
   confirmed natively" stays.

   Why a code at all, then: a photo of the screen taken over the shoulder
   is worth nothing after `VALIDITE_MS`, and a request with a WRONG code is
   never even shown.

   The display can change as often as we like: what bounds the risk is how
   long a code stays ACCEPTED, not how often a new one is drawn. The phone
   needs a few seconds to tens of seconds (discovery, TLS) between reading
   the QR and its request reaching us, so a code is accepted `VALIDITE_MS`
   after it was shown, whatever the display period.
══════════════════════════════════════════════════════════ */

/** How often the dialog asks for a new code. */
export const PERIODE_MS = 2_000;
/** How long a code shown once stays accepted. */
export const VALIDITE_MS = 90_000;
/** Wrong codes presented while the window is open before it closes. */
export const ESSAIS_MAX = 10;
/** Codes kept alive at once (90 s / 2 s = 45): a window that asks faster
    than the period cannot grow the set without bound. */
const CODES_MAX = 64;

/** 32 characters, without 0/O and 1/I, which read alike on a screen. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LONGUEUR = 10;
const TAG = /\s*\[NQ:([A-HJ-NP-Z2-9]{10})\]\s*$/;

/** A fresh code from `octets` random bytes (one byte per character; 256 is a
    multiple of 32, so every character is equally likely). */
export function nouveauCode(octets: Uint8Array): string {
	if (octets.length < LONGUEUR) throw new Error("pairing: not enough random bytes");
	let s = "";
	for (let i = 0; i < LONGUEUR; i++) s += ALPHABET[octets[i]! % ALPHABET.length];
	return s;
}

/** What the QR code carries. `deviceId` is ours, already validated. */
export function texteQr(deviceId: string, code: string): string {
	return `neo-quiz://pair?device=${deviceId}&code=${code}`;
}

/** The code a device announced at the end of its name, or `null`. */
export function codeDansNom(nom: unknown): string | null {
	if (typeof nom !== "string") return null;
	const m = TAG.exec(nom);
	return m ? m[1]! : null;
}

/** The name without the announced code: what the dialog shows and what the
    config keeps. */
export function sansCode(nom: string): string {
	return nom.replace(TAG, "").trim();
}

/** Constant-time comparison: stopping at the first different character would
    let response times tell a code character by character. */
function memeCode(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export interface FenetreAppairage {
	/** A new code, which opens the window if it was closed. */
	tourner(): string;
	/** `true` exactly when `code` was shown less than `VALIDITE_MS` ago in
	    the open window; a match closes the window (every code dies). */
	verifier(code: string): boolean;
	/** A request carried a wrong code: the `ESSAIS_MAX`-th closes the window. */
	echec(): void;
	ouverte(): boolean;
	fermer(): void;
}

export function creerFenetreAppairage(alea: (n: number) => Uint8Array, maintenant: () => number): FenetreAppairage {
	let codes: Array<{ code: string; montre: number }> = [];
	let echecs = 0;
	const vivants = (): typeof codes => {
		const t = maintenant();
		codes = codes.filter(c => t - c.montre < VALIDITE_MS);
		return codes;
	};
	const fermer = (): void => { codes = []; echecs = 0; };
	return {
		tourner() {
			if (vivants().length === 0) echecs = 0;
			const code = nouveauCode(alea(LONGUEUR));
			codes = [...codes, { code, montre: maintenant() }].slice(-CODES_MAX);
			return code;
		},
		verifier(code) {
			/* Every live code is compared, without stopping at the first match:
			   the time taken does not say which one matched. */
			let trouve = false;
			for (const c of vivants()) trouve = memeCode(c.code, code) || trouve;
			if (trouve) fermer();
			return trouve;
		},
		echec() {
			if (vivants().length === 0) return;
			if (++echecs >= ESSAIS_MAX) fermer();
		},
		ouverte() { return vivants().length > 0; },
		fermer,
	};
}
