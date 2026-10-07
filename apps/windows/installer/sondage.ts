/* The two disk probes behind the installation percentage (`suivre` in
   `noyau.ts` turns their readings into a figure). Shared by the bootstrapper's
   worker and the update window, which both watch an NSIS they do not control.
   Node only, no Electron. */

import { type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Somme récursive des tailles de fichiers d'un dossier. NSIS écrit pendant
    qu'on lit : une entrée qui disparaît ou se verrouille entre le `readdir`
    et le `stat` (`ENOENT`, `EPERM`, `EBUSY`…) est normale, jamais fatale — le
    sondage ne doit jamais faire échouer l'installation, juste manquer un
    octet qu'un prochain passage recomptera. */
export async function tailleDossier(dossier: string): Promise<number> {
	let total = 0;
	let entrees: Dirent[];
	try {
		entrees = await readdir(dossier, { withFileTypes: true });
	} catch {
		return total;
	}
	for (const entree of entrees) {
		const chemin = join(dossier, entree.name);
		try {
			if (entree.isDirectory()) total += await tailleDossier(chemin);
			else if (entree.isFile()) total += (await stat(chemin)).size;
		} catch {
			// Entrée disparue ou verrouillée pendant l'écriture NSIS : ignorée.
		}
	}
	return total;
}

/** Les dossiers temporaires que NSIS s'est créés DEPUIS le lancement.

    NSIS crée son `$PLUGINSDIR` sous `%TEMP%`, sous la forme `nsXXXXX.tmp` :
    il y recopie l'archive de l'application puis l'y extrait, et le
    désinstalleur d'une mise à jour y DÉPLACE l'ancienne version avant de
    l'effacer. C'est donc là que se voit la majeure partie du travail.

    ON NE LUI IMPOSE PAS SON `%TEMP%`. Le faire aurait évité de reconnaître son
    dossier — mais `$PLUGINSDIR` est aussi d'où NSIS charge `UAC.dll`, dont
    dépend `UAC_IsAdmin`, et dont dépend à son tour la désinstallation de
    l'ancienne version (`multiUser.nsh` : `IfNot UAC_IsAdmin` → `Quit`,
    code 2). Passer un environnement à un processus qu'on ne contrôle pas, pour
    une simple mesure, n'en vaut pas le risque.

    La date de création borne ce qu'on compte : un installeur d'un autre
    logiciel lancé AVANT nous n'entre pas dans le total. Un lancé PENDANT le
    nôtre y entrerait — c'est la limite assumée de cette mesure, et elle est
    bornée par le total connu (`paquet + installe`). */
export async function tailleTemporairesNsis(depuis: number): Promise<number> {
	let total = 0;
	let entrees: Dirent[];
	try {
		entrees = await readdir(tmpdir(), { withFileTypes: true });
	} catch {
		return total;
	}
	for (const entree of entrees) {
		if (!entree.isDirectory() || !/^ns[0-9A-Za-z]+.tmp$/i.test(entree.name)) continue;
		const chemin = join(tmpdir(), entree.name);
		try {
			if ((await stat(chemin)).birthtimeMs < depuis) continue;
		} catch {
			continue;
		}
		total += await tailleDossier(chemin);
	}
	return total;
}
