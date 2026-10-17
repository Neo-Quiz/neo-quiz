/* THE MOODLE ID LISTS, SHARED ACROSS DEVICES (pure, no disk).

   Favourites, hidden and added courses, ignored and seen assignments used to
   live in this app's private settings: each PC had its own list, and a course
   unstarred on one PC stayed starred on the other. They now live in the synced
   quiz root, `<root>/.neo-quiz/moodle/<deviceId>.json`, one file per device
   (a device writes only its own; `service.ts` does the disk part).

   Each file holds, per list and per course id, the last gesture made on that
   device: `{ on, at }`. Merging keeps, per id, the gesture with the highest
   `at`; on a tie the removal wins (the same rule on every device). A removal
   stays in the file as a tombstone, so an older "on" from another device never
   brings the id back.

   The first time a device writes its file, its old private list is carried
   over with `at` = 1, 2, 3... (older than any real gesture, in list order):
   nothing is lost, and any dated gesture of another device wins over it. */

export const LISTES = ["favoris", "exclus", "extra", "devoirsIgnores", "devoirsVus"] as const;
export type ListeCle = typeof LISTES[number];

export interface Geste { on: boolean; at: number }
export type TableListes = Partial<Record<ListeCle, Record<string, Geste>>>;

/** Entries kept per list in one device's file (tombstones included). */
export const MAX_ENTREES = 1000;

const idValide = (k: string): boolean => /^[1-9][0-9]{0,15}$/.test(k) && Number.isSafeInteger(Number(k));

/** A device file read from the synced folder: anything malformed is dropped, never trusted. */
export function lireTable(brut: unknown): TableListes {
	const out: TableListes = {};
	if (!brut || typeof brut !== "object" || Array.isArray(brut)) return out;
	const listes = (brut as Record<string, unknown>).lists;
	if (!listes || typeof listes !== "object" || Array.isArray(listes)) return out;
	for (const cle of LISTES) {
		const l = (listes as Record<string, unknown>)[cle];
		if (!l || typeof l !== "object" || Array.isArray(l)) continue;
		const t: Record<string, Geste> = {};
		let n = 0;
		for (const [k, g] of Object.entries(l as Record<string, unknown>)) {
			if (n >= MAX_ENTREES) break;
			if (!idValide(k) || !g || typeof g !== "object") continue;
			const { on, at } = g as Record<string, unknown>;
			if (typeof on !== "boolean" || typeof at !== "number" || !Number.isFinite(at) || at < 0) continue;
			t[k] = { on, at };
			n++;
		}
		out[cle] = t;
	}
	return out;
}

export function ecrireTable(t: TableListes): string {
	return JSON.stringify({ v: 1, lists: t }, null, "\t");
}

const gagne = (a: Geste, b: Geste): boolean => a.at !== b.at ? a.at > b.at : !a.on && b.on;

/** The merged lists: the ids whose winning gesture is "on", oldest gesture first. */
export function fusionner(tables: readonly TableListes[]): Record<ListeCle, number[]> {
	const out = {} as Record<ListeCle, number[]>;
	for (const cle of LISTES) {
		const best = new Map<string, Geste>();
		for (const t of tables) {
			for (const [k, g] of Object.entries(t[cle] ?? {})) {
				const cur = best.get(k);
				if (!cur || gagne(g, cur)) best.set(k, g);
			}
		}
		out[cle] = [...best].filter(([, g]) => g.on)
			.sort(([ka, a], [kb, b]) => a.at - b.at || Number(ka) - Number(kb))
			.map(([k]) => Number(k));
	}
	return out;
}

/** The old private lists, as a first device file (see the header). */
export function depuisAncien(listes: Partial<Record<ListeCle, readonly number[]>>): TableListes {
	const out: TableListes = {};
	for (const cle of LISTES) {
		const l = listes[cle] ?? [];
		if (!l.length) continue;
		const t: Record<string, Geste> = {};
		l.forEach((id, i) => { t[String(id)] = { on: true, at: i + 1 }; });
		out[cle] = t;
	}
	return out;
}

/** `own` with one more gesture, trimmed to the `MAX_ENTREES` most recent of that list. */
export function poser(own: TableListes, cle: ListeCle, id: number, on: boolean, at: number): TableListes {
	const l = { ...(own[cle] ?? {}) };
	delete l[String(id)];
	l[String(id)] = { on, at };
	const gardes = Object.entries(l).sort(([, a], [, b]) => b.at - a.at).slice(0, MAX_ENTREES);
	return { ...own, [cle]: Object.fromEntries(gardes) };
}
