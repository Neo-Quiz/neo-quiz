import { currentHost } from "../host/current";
import { parseModuleMap, type ModuleMap } from "./quiz-modules";

/**
 * The module table, read from the mapping note.
 *
 * Written twice, identically (Home and "My quizzes"), before this file, and
 * the original comment says why both pages must read the SAME thing: a quiz
 * filed in a sub-folder of its module otherwise got the sub-folder's accent on
 * one page and the module's on the other, two colours for one quiz.
 *
 * Goes through the HOST: `links.resolve` understands "Dashboard" written
 * without a path, and `fs.readCached` serves the cached copy.
 *
 * An EMPTY table is a normal state: the note does not exist, or the setting is
 * empty. Modules then fall back on their parent folder (`moduleForQuiz`), the
 * historical behaviour.
 */
export const MODULE_MAP_VIDE: ModuleMap = { byFolder: new Map(), ueOrder: [] };

/** The table of the last read, for SYNCHRONOUS readers that cannot await one
    (the review catalogue, which pauses the reviews of hidden folders by the
    same folder rule as the pages). Empty until a first read. */
let last: ModuleMap = MODULE_MAP_VIDE;
export const lastModuleMap = (): ModuleMap => last;

export async function lireModuleMap(nomNote: string): Promise<ModuleMap> {
	return last = await read(nomNote);
}

async function read(nomNote: string): Promise<ModuleMap> {
	const nom = String(nomNote ?? "").trim();
	if (!nom) return MODULE_MAP_VIDE;
	try {
		const fichier = currentHost().links.resolve(nom, "");
		if (!fichier) return MODULE_MAP_VIDE;
		return parseModuleMap(await currentHost().fs.readCached(fichier.path));
	} catch (e) {
		/* Unreadable note: an empty table rather than a page that cannot
		   render. Modules fall back on their parent folder. */
		return MODULE_MAP_VIDE;
	}
}
