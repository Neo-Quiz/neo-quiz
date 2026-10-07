/* The course rules of the Moodle module (pure but for `fs` reads of folder
   names): which courses are followed by default, how a course URL is read,
   which folder a hand-in opens, and whether a path stays inside a folder. */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Course } from "./pur";

export const FIN_DE_COURS_MS = 30 * 24 * 3600 * 1000;

/** In progress: no end date, or ended less than 30 days ago. */
export function enCours(c: { enddate: number }, now: number): boolean {
	return c.enddate === 0 || c.enddate * 1000 > now - FIN_DE_COURS_MS;
}

export interface ReglageCours { favoris: number[]; exclus: number[]; extra: number[] }
export interface CoursChoisi { course: Course; favori: boolean; exclu: boolean; enCours: boolean; extra: boolean }

/** The listed courses: enrolled courses with a code and in progress, plus
    `extra` and `favoris` (whatever they are), each flagged; excluded ones stay
    listed (so they can be put back) with `exclu`. Favourites first, then by name.
    The courses actually FOLLOWED are the ones that are not `exclu` (and have a code). */
export function ensembleParDefaut(inscrits: Course[], connus: Course[], r: ReglageCours, now: number): CoursChoisi[] {
	const par = new Map<number, Course>();
	for (const c of [...connus, ...inscrits]) par.set(c.id, c);
	const out: CoursChoisi[] = [];
	for (const c of par.values()) {
		const inscritActif = inscrits.some(i => i.id === c.id) && c.code !== null && enCours(c, now);
		const extra = r.extra.includes(c.id);
		const favori = r.favoris.includes(c.id);
		if (!inscritActif && !extra && !favori) continue;
		out.push({ course: c, favori, exclu: r.exclus.includes(c.id), enCours: enCours(c, now), extra });
	}
	return out.sort((a, b) => Number(b.favori) - Number(a.favori) || a.course.name.localeCompare(b.course.name, "fr"));
}

export const suivis = (l: CoursChoisi[]): CoursChoisi[] => l.filter(c => !c.exclu && c.course.code !== null);

/** The id of a course URL on THE configured site, or null: same origin
    (scheme, host, port), path `/course/view.php`, a plain positive id. */
export function idDepuisUrl(brut: unknown, site: string): number | null {
	if (typeof brut !== "string" || brut.length > 500 || brut !== brut.trim()) return null;
	let u: URL;
	let s: URL;
	try { u = new URL(brut); s = new URL(site); } catch { return null; }
	if (u.origin !== s.origin || u.username || u.password) return null;
	if (u.pathname !== "/course/view.php") return null;
	const id = u.searchParams.get("id");
	if (id === null || !/^[1-9]\d{0,9}$/.test(id)) return null;
	const n = Number(id);
	return Number.isSafeInteger(n) ? n : null;
}

/** Where a hand-in is dropped: the `Rendus…` sub-folder of the module when
    there is one (the plugin's rule), else the module folder; null when the
    module folder does not exist. */
export function dossierDepot(dir: string): string | null {
	try {
		const sub = fs.readdirSync(dir, { withFileTypes: true })
			.filter(e => e.isDirectory() && /rendus/i.test(e.name))
			.map(e => e.name)
			.sort((a, b) => a.localeCompare(b))[0];
		return sub ? path.join(dir, sub) : dir;
	} catch {
		return null;
	}
}

/** `enfant` is strictly inside `parent` (after resolution). */
export function estDans(parent: string, enfant: string): boolean {
	const rel = path.relative(path.resolve(parent), path.resolve(enfant));
	return rel !== "" && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}
