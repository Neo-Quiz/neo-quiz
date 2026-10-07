/* THE GUARD OF THE `moodle` SETTING (pure: no `electron`, no `node:*`, so
   `check:electron-reglages` and `check:moodle` load the REAL code).

   The `moodle` key is written by the window and read by the main process to
   decide where it sends a login token: `site` must be a plain https origin,
   and a site the user did not already approve is asked of the user through a
   NATIVE dialog (`canaux.ts`), which a compromised renderer can neither
   write nor answer. Same pattern as `aiOllamaUrl` (`garde-ia.ts`). */

import { hoteEstPrive } from "../garde-ia";

/** The verdict on a value of the `moodle` key. Never confused:
    - `ok`: write it; `admettre` is the host to add to the network list now
      (`null` when the site is empty or unchanged);
    - `refus`: write nothing, with the cause NAMED;
    - `confirmer`: a NEW host: only the user can allow it. */
export type VerdictMoodle =
	| { ok: true; admettre: string | null }
	| { refus: string }
	| { confirmer: string };

export interface OptionsSite { /** Tests only: accept `http:` and a port. */ http?: boolean }

/** The https origin of a site, or null. Rejects userinfo, a port other than
    443, a path/query/hash, an IP address, a single-label or local host: a
    Moodle site is a public DNS name over https. */
export function origineSite(brut: unknown, opts: OptionsSite = {}): string | null {
	if (typeof brut !== "string" || !brut || brut !== brut.trim()) return null;
	let u: URL;
	try {
		u = new URL(brut);
	} catch {
		return null;
	}
	if (u.protocol !== (opts.http ? "http:" : "https:")) return null;
	if (u.username || u.password || u.search || u.hash) return null;
	if (u.pathname !== "/" || brut.replace(/\/$/, "").length !== u.origin.length) return null;
	if (!opts.http) {
		if (u.port) return null;
		const h = u.hostname;
		if (!h.includes(".") || h.endsWith(".local") || /^[\d.]+$/.test(h) || h.startsWith("[") || hoteEstPrive(h)) return null;
	}
	return u.origin;
}

/** The courses of the setting: an array of positive safe integers, bounded. */
export function coursValides(valeur: unknown): valeur is number[] {
	return Array.isArray(valeur) && valeur.length <= 500
		&& valeur.every(n => typeof n === "number" && Number.isSafeInteger(n) && n > 0);
}

/**
 * `siteActuel`: the origin the setting already holds (null when none). A site
 * equal to it needs no new question; any other, once readable, is confirmed.
 * The other fields are refused: the key holds `site` and `courses`, nothing else.
 */
export function validerReglagesMoodle(valeur: unknown, siteActuel: string | null, opts: OptionsSite = {}): VerdictMoodle {
	if (!valeur || typeof valeur !== "object" || Array.isArray(valeur)) {
		return { refus: "Moodle settings refused: the value is not an object" };
	}
	const { site, courses, ...autres } = valeur as { site?: unknown; courses?: unknown };
	if (Object.keys(autres).length) {
		return { refus: "Moodle settings refused: unknown field " + Object.keys(autres)[0] };
	}
	if (courses !== undefined && !coursValides(courses)) {
		return { refus: "Moodle settings refused: courses must be an array of positive integers" };
	}
	if (site === undefined || site === "") return { ok: true, admettre: null };
	const origine = origineSite(site, opts);
	if (!origine) return { refus: "Moodle settings refused: site must be a plain https origin (https://host)" };
	if (siteActuel && origine === siteActuel) return { ok: true, admettre: new URL(origine).hostname.toLowerCase() };
	return { confirmer: new URL(origine).hostname.toLowerCase() };
}
