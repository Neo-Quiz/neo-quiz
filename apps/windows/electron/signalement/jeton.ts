/* The GitHub session of the bug report (main process only): one access token
   and the login it belongs to, encrypted with Electron's `safeStorage` like
   `moodle/jeton.ts`. Never written in clear: when encryption is unavailable
   the session is refused. Neither the token nor this file reaches the window. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Chiffrement } from "../moodle/jeton";

export interface Session { accessToken: string; login: string }

export interface MagasinJetonGithub {
	/** The stored session, or null when none or unreadable. */
	lire(): Promise<Session | null>;
	/** Throws `nostorage` when encryption is unavailable: nothing is written. */
	ecrire(s: Session): Promise<void>;
	effacer(): Promise<void>;
}

function valide(v: unknown): v is Session {
	if (!v || typeof v !== "object") return false;
	const s = v as Record<string, unknown>;
	return typeof s.accessToken === "string" && s.accessToken.length > 0 && s.accessToken.length <= 255
		&& typeof s.login === "string" && s.login.length > 0;
}

export function creerMagasinJetonGithub(fichier: string, chiffrement: Chiffrement): MagasinJetonGithub {
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
				return valide(v) ? { accessToken: v.accessToken, login: v.login } : null;
			} catch {
				return null;
			}
		},
		async ecrire(s) {
			if (!chiffrement.disponible()) throw new Error("nostorage");
			const chiffre = chiffrement.chiffrer(JSON.stringify({ accessToken: s.accessToken, login: s.login }));
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
