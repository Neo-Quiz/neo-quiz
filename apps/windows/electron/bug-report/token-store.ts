/* The GitHub session of the bug report (main process only): one access token
   and the login it belongs to, encrypted with Electron's `safeStorage` like
   `moodle/jeton.ts`. Never written in clear: when encryption is unavailable
   the session is refused. Neither the token nor this file reaches the window. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Chiffrement } from "../moodle/jeton";

export interface Session { accessToken: string; login: string }

export interface GithubTokenStore {
	/** The stored session, or null when none or unreadable. */
	read(): Promise<Session | null>;
	/** Throws `nostorage` when encryption is unavailable: nothing is written. */
	write(s: Session): Promise<void>;
	clear(): Promise<void>;
}

function isValid(v: unknown): v is Session {
	if (!v || typeof v !== "object") return false;
	const s = v as Record<string, unknown>;
	return typeof s.accessToken === "string" && s.accessToken.length > 0 && s.accessToken.length <= 255
		&& typeof s.login === "string" && s.login.length > 0;
}

export function createGithubTokenStore(file: string, cipher: Chiffrement): GithubTokenStore {
	return {
		async read() {
			let raw: Buffer;
			try {
				raw = await fs.readFile(file);
			} catch {
				return null;
			}
			if (!cipher.disponible()) return null;
			try {
				const v: unknown = JSON.parse(cipher.dechiffrer(raw));
				return isValid(v) ? { accessToken: v.accessToken, login: v.login } : null;
			} catch {
				return null;
			}
		},
		async write(s) {
			if (!cipher.disponible()) throw new Error("nostorage");
			const encrypted = cipher.chiffrer(JSON.stringify({ accessToken: s.accessToken, login: s.login }));
			await fs.mkdir(path.dirname(file), { recursive: true });
			const tmp = `${file}.${process.pid}.tmp`;
			await fs.writeFile(tmp, encrypted);
			await fs.rename(tmp, file);
		},
		async clear() {
			await fs.rm(file, { force: true });
		},
	};
}
