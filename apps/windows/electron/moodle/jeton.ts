/* The login token's storage (main process only): encrypted with Electron's
   `safeStorage` (DPAPI on Windows) in a file of the app's own data folder. It
   is NEVER written in plain text: when encryption is unavailable the token is
   refused, not stored. It never reaches the renderer, the synced folder or a log. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MoodleError } from "./erreurs";

/** The part of `safeStorage` this module uses (injectable for tests). */
export interface Chiffrement {
	disponible(): boolean;
	chiffrer(clair: string): Buffer;
	dechiffrer(chiffre: Buffer): string;
}

export interface Jeton { token: string; userid: number; fullname: string; at: number; site: string }

export interface MagasinJeton {
	/** The stored token; null when none, or when it cannot be decrypted (it is
	    then useless and a new login replaces it). */
	lire(): Promise<Jeton | null>;
	/** Throws `nostorage` when encryption is unavailable: nothing is written. */
	ecrire(jeton: Jeton): Promise<void>;
	effacer(): Promise<void>;
}

function valide(v: unknown): v is Jeton {
	if (!v || typeof v !== "object") return false;
	const j = v as Record<string, unknown>;
	return typeof j.token === "string" && /^[0-9a-f]{32}$/i.test(j.token)
		&& typeof j.userid === "number" && Number.isSafeInteger(j.userid)
		&& typeof j.fullname === "string" && typeof j.at === "number" && typeof j.site === "string";
}

export function creerMagasinJeton(fichier: string, chiffrement: Chiffrement): MagasinJeton {
	return {
		async lire() {
			let brut: Buffer;
			try {
				brut = await fs.readFile(fichier);
			} catch {
				return null;
			}
			if (!chiffrement.disponible()) return null;
			try {
				const v: unknown = JSON.parse(chiffrement.dechiffrer(brut));
				return valide(v) ? v : null;
			} catch {
				return null;
			}
		},
		async ecrire(jeton) {
			if (!chiffrement.disponible()) {
				throw new MoodleError("nostorage", "Secure storage is unavailable on this computer: the login is not saved.");
			}
			const chiffre = chiffrement.chiffrer(JSON.stringify({
				token: jeton.token, userid: jeton.userid, fullname: jeton.fullname, at: jeton.at, site: jeton.site,
			}));
			await fs.mkdir(path.dirname(fichier), { recursive: true });
			const tmp = `${fichier}.${process.pid}.tmp`;
			await fs.writeFile(tmp, chiffre);
			await fs.rename(tmp, fichier);
		},
		async effacer() {
			await fs.rm(fichier, { force: true });
		},
	};
}
