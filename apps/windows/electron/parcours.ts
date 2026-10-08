/* ══════════════════════════════════════════════════════════
   LE PARCOURS D'UNE RACINE — DE QUOI HYDRATER LE MIROIR DU RENDU

   Tâche 3 de la migration Tauri → Electron. Ce module sert UNE méthode du pont,
   `fichiers.liste`, et il vit à part de `main.ts` parce que ce qu'il fait n'a
   rien à voir avec une fenêtre : il descend un dossier et rend ce qu'il y a
   dedans.

   POURQUOI UN PARCOURS DU DISQUE ET NON UNE LECTURE DE L'INDEX du processus
   principal — qui, lui, existe déjà. L'index se peuple au fil du parcours
   initial de chokidar, et RIEN n'en signale la fin : le lire au démarrage
   rendrait une liste incomplète, et le rendu montrerait un catalogue vide qui
   se remplirait sous les yeux de l'utilisateur. Voir `Pont.fichiers.liste`
   (`./pont.ts`) pour pourquoi le rendu a besoin de cette liste du tout : ses
   trois lectures synchrones du contrat (`listMarkdown`, `findByName`,
   `getFile`) ne peuvent PAS passer par l'IPC.
══════════════════════════════════════════════════════════ */

import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import { LOG_PREFIX } from "../../../src/branding";
import { dossierIgnore } from "./catalogue";
import { stat } from "./fichiers";
import type { EntreeDisque } from "./pont";

/** Concurrence des `stat` du parcours : plusieurs en vol, mais jamais mille
    d'un coup sur un disque réseau. Même valeur que l'hôte Tauri. */
const LOTS_STAT = 24;

/**
 * Sépare avec des `/` et retire le séparateur final.
 *
 * UNE SEULE FORME POUR TOUT CE QUI FRANCHIT LE PONT : Windows accepte les deux
 * séparateurs en lecture, donc un même fichier peut arriver ici sous deux
 * écritures. Si les deux franchissaient le pont, le miroir du rendu tiendrait
 * DEUX clés pour un seul fichier — et le journal de révision, dont les clés
 * dérivent de celles-là, deux historiques.
 */
export function normaliser(chemin: string): string {
	return String(chemin ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * TOUS les fichiers d'une racine, récursivement, avec le `mtime` des `.md`.
 *
 * Un sous-dossier illisible (droits, disque réseau absent) ne vide pas le
 * reste : on le signale et on continue. Les liens symboliques sont écartés —
 * un lien vers un dossier parent ferait boucler le parcours à l'infini, et la
 * fenêtre se figerait au démarrage sans aucun message.
 */
export async function listerRacine(racine: string): Promise<EntreeDisque[]> {
	const sortie: EntreeDisque[] = [];

	async function descendre(dossier: string): Promise<void> {
		let entrees: Dirent[];
		try {
			entrees = await fs.readdir(dossier, { withFileTypes: true });
		} catch (e) {
			console.warn(LOG_PREFIX, "lecture du dossier impossible:", dossier, e);
			return;
		}
		for (const entree of entrees) {
			if (entree.isSymbolicLink()) continue;
			const chemin = `${dossier}/${entree.name}`;
			if (entree.isDirectory()) {
				if (!dossierIgnore(entree.name)) await descendre(chemin);
			} else if (entree.isFile()) {
				sortie.push({ chemin, mtime: 0, ctime: 0 });
			}
		}
	}

	await descendre(normaliser(racine));

	/* `mtime` seulement sur les `.md` : seul le catalogue de quiz s'en sert
	   (tri « récents »), et un `stat` pour chaque image d'un dossier de cours
	   serait une dépense sans acheteur. Les autres gardent 0, ce que `HostFile`
	   autorise explicitement. */
	const aDater = sortie.filter(f => f.chemin.toLowerCase().endsWith(".md"));
	for (let i = 0; i < aDater.length; i += LOTS_STAT) {
		await Promise.all(aDater.slice(i, i + LOTS_STAT).map(async f => {
			const info = await stat(f.chemin);
			if (info) { f.mtime = info.mtime; f.ctime = info.ctime; }
		}));
	}
	return sortie;
}
