import { promises as fsp } from "node:fs";
import path from "node:path";

/* ══════════════════════════════════════════════════════════
   THE SYNCED FOLDER'S NAME, PUBLISHED (2026-10-27)

   The owner renamed the synced folder ("Neo Quiz" → "Efrei") and wants every
   device to follow. Each PC writes the name of its pinned folder (the basename
   of `syncRoot`) in `<root>/.neo-quiz/root-name/<deviceId>.json`, as
   `{ "v": 1, "name": "Efrei" }`; the phone renames its own folder to the name
   every PC agrees on (`apps/android/.../sync/RootRename.kt`, which reads these
   files as hostile). One file per device, written by that device only, like
   the rest of `.neo-quiz/`.
══════════════════════════════════════════════════════════ */

/** The app's device id (a UUID): it becomes a file name, nothing else passes. */
const ID_APPAREIL = /^[A-Za-z0-9-]{1,64}$/;

/** Where this device publishes its folder's name; `null` for an id that would not be a plain file name. */
export function fichierNomRacine(root: string, deviceId: string): string | null {
	if (!ID_APPAREIL.test(deviceId)) return null;
	return path.join(root, ".neo-quiz", "root-name", `${deviceId}.json`);
}

/** The file's bytes for the folder `root`; `null` for a drive root (no name to publish). */
export function contenuNomRacine(root: string): string | null {
	const nom = path.basename(path.resolve(root));
	return nom ? JSON.stringify({ v: 1, name: nom }) + "\n" : null;
}

/** The minimal file system it needs (injected by the check). */
export interface FsNomRacine {
	readFile(f: string, enc: "utf8"): Promise<string>;
	writeFile(f: string, data: string, enc: "utf8"): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	mkdir(d: string, o: { recursive: true }): Promise<unknown>;
}

/**
 * Writes this device's file when its content changed (a temporary file then a
 * rename: another device never reads half a file). `true` when written.
 */
export async function publierNomRacine(root: string, deviceId: string | null, fs: FsNomRacine = fsp): Promise<boolean> {
	if (!deviceId) return false;
	const fichier = fichierNomRacine(root, deviceId);
	const contenu = contenuNomRacine(root);
	if (!fichier || !contenu) return false;
	try {
		if (await fs.readFile(fichier, "utf8") === contenu) return false;
	} catch {
		// Absent or unreadable: written below.
	}
	await fs.mkdir(path.dirname(fichier), { recursive: true });
	const tmp = `${fichier}.tmp`;
	await fs.writeFile(tmp, contenu, "utf8");
	await fs.rename(tmp, fichier);
	return true;
}
