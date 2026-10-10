/* The two disk probes behind the installation percentage (`suivre` in
   `noyau.ts` turns their readings into a figure). Shared by the bootstrapper's
   worker and the update window, which both watch an NSIS they do not control.

   THEY RUN UNDER ELECTRON, NOT PLAIN NODE (2026-10-10). Electron's patched
   `fs` treats every `.asar` file as an archive: a single `stat` of
   `resources/app.asar` opens it and keeps the handle for the life of the
   process. The update window weighs the install folder every few hundred
   milliseconds, so it held the INSTALLED `app.asar` open: NSIS replaced
   every other file, retried, then silently gave up on that one, and the app
   restarted on the old code under the new version number (1.20.69 binaries
   around a 1.20.63 `app.asar`, stalled near 79 %). Every call below goes
   through `sansAsar`, which is why the file is read as a plain file. */

import { type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Runs `f` with Electron's asar support off. The switch is read when the
    `fs` call is MADE, not when it settles, so it only needs to cover the
    synchronous call that starts an async operation: no other code of the
    process runs while it is on. Without Electron the property is inert. */
export function sansAsar<T>(f: () => T): T {
	const p = process as { noAsar?: boolean };
	const avant = p.noAsar;
	p.noAsar = true;
	try {
		return f();
	} finally {
		p.noAsar = avant;
	}
}

/** Recursive sum of a folder's file sizes. NSIS writes while we read: an
    entry that disappears or gets locked between `readdir` and `stat`
    (`ENOENT`, `EPERM`, `EBUSY`...) is normal, never fatal. The probe must
    never make the install fail, only miss a byte that a later pass counts. */
export async function tailleDossier(dossier: string): Promise<number> {
	let total = 0;
	let entrees: Dirent[];
	try {
		entrees = await sansAsar(() => readdir(dossier, { withFileTypes: true }));
	} catch {
		return total;
	}
	for (const entree of entrees) {
		const chemin = join(dossier, entree.name);
		try {
			if (entree.isDirectory()) total += await tailleDossier(chemin);
			else if (entree.isFile()) total += (await sansAsar(() => stat(chemin))).size;
		} catch {
			// Entry gone or locked while NSIS writes: skipped.
		}
	}
	return total;
}

/** The temp folders NSIS has created SINCE the launch.

    NSIS creates its `$PLUGINSDIR` under `%TEMP%`, as `nsXXXXX.tmp`: it copies
    the app archive there and extracts it there, and an update's uninstaller
    MOVES the old version there before deleting it. That is where most of the
    work shows.

    WE DO NOT IMPOSE ITS `%TEMP%`. Doing so would have spared recognising its
    folder, but `$PLUGINSDIR` is also where NSIS loads `UAC.dll` from, which
    `UAC_IsAdmin` depends on, which the old version's uninstall depends on in
    turn (`multiUser.nsh`: `IfNot UAC_IsAdmin` -> `Quit`, code 2). Passing an
    environment to a process we do not control, for a mere measurement, is not
    worth the risk.

    The creation date bounds what is counted: another program's installer
    started BEFORE ours is not in the total. One started DURING ours would be;
    that is the accepted limit of this measurement, and it is bounded by the
    known total (`paquet + installe`). */
export async function tailleTemporairesNsis(depuis: number): Promise<number> {
	let total = 0;
	let entrees: Dirent[];
	try {
		entrees = await sansAsar(() => readdir(tmpdir(), { withFileTypes: true }));
	} catch {
		return total;
	}
	for (const entree of entrees) {
		if (!entree.isDirectory() || !/^ns[0-9A-Za-z]+.tmp$/i.test(entree.name)) continue;
		const chemin = join(tmpdir(), entree.name);
		try {
			if ((await sansAsar(() => stat(chemin))).birthtimeMs < depuis) continue;
		} catch {
			continue;
		}
		total += await tailleDossier(chemin);
	}
	return total;
}
