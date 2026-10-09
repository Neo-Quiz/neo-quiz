import { LOG_PREFIX } from "../../../../src/branding";
import { REVIEW_DIR, isConflictCopy } from "../../../../src/review/paths";
import type { SessionQuiz } from "../../../../src/engine/session";
import { derniereEcriture, fusionnerPhotos, porterRejugees } from "../../../../src/shared-state/session-merge";
import type { SharedFs } from "./shared-state";

/* ══════════════════════════════════════════════════════════
   THE QUIZZES IN PROGRESS, IN THE SYNCED FOLDER (2026-10-09)

   Where the player stopped in a quiz (its snapshot, src/engine/session.ts)
   lived in this app's private settings: a Learn begun on the phone started
   again from zero on the laptop. Now each root holds, under `.neo-quiz/`,

     sessions/<deviceId>.json   this device's snapshots for the root, by quiz
                                path, replaced through a temp file;

   the same scheme as the exams and folder settings (shared-state.ts): a
   device writes ONLY its own file, reads every device's, and merges. For a
   quiz, the snapshots are merged QUESTION BY QUESTION
   (shared-state/session-merge.ts): the snapshot written last no longer wins
   whole, it used to bring a 54-question Learn back to 6 when a device
   reopened an old snapshot. A device writes in its own file the MERGED
   snapshot of what it sees, so that reopening an old one never republishes it. A quiz finished or restarted leaves a TOMBSTONE (`{ tombe: true,
   ecrite }`), so that the older snapshot of another device does not bring
   it back; tombstones older than 60 days are dropped when the file is
   written.

   A snapshot from another file is checked for its shape only; the engine's
   own reader (`session.ts`) still refuses one that does not fit the quiz.
══════════════════════════════════════════════════════════ */

export const SESSIONS_DIR = "sessions";

export interface Tombe { tombe: true; ecrite: number }
export type SessionStockee = SessionQuiz | Tombe;
export type TableSessions = Record<string, SessionStockee>;

/** Past this many entries a file is not trusted further. */
const MAX_ENTREES = 3000;
/** A file larger than this is not read (a snapshot is a few KB). */
const MAX_OCTETS = 16 * 1024 * 1024;
/** A stamp more than a day ahead of this clock is a wrong clock: dropped
    (it would outrank every later snapshot). */
const FUTUR_MS = 24 * 3600 * 1000;
const TOMBE_MAX_MS = 60 * 24 * 3600 * 1000;

const rootOf = (key: string): string => key.split("/")[0];
const baseName = (full: string): string => full.slice(full.lastIndexOf("/") + 1);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const estTombe = (s: SessionStockee): s is Tombe => (s as Tombe).tombe === true;

/** The valid entries of one file: keys under `root`, a finite stamp not in
    the future, a tombstone or a snapshot of version 1. */
export function lireTableSessions(raw: unknown, root: string, now: number): TableSessions {
	const out: TableSessions = {};
	if (!isRecord(raw)) return out;
	let n = 0;
	for (const [cle, v] of Object.entries(raw)) {
		if (n >= MAX_ENTREES) break;
		if (!cle || cle.length > 1000 || rootOf(cle) !== root || !isRecord(v)) continue;
		if (typeof v.ecrite !== "number" || !Number.isFinite(v.ecrite) || v.ecrite > now + FUTUR_MS) continue;
		if (v.tombe === true) { out[cle] = { tombe: true, ecrite: v.ecrite }; n++; continue; }
		if (v.v !== 1 || !isRecord(v.questions)) continue;
		const photo = v as unknown as SessionQuiz;
		// `depuis` only means something as a stamp not after the write.
		if (photo.depuis !== undefined && !(typeof photo.depuis === "number" && Number.isFinite(photo.depuis) && photo.depuis <= photo.ecrite)) delete photo.depuis;
		out[cle] = photo;
		n++;
	}
	return out;
}

/** Every device's entries for each quiz. */
function parCle(tables: readonly TableSessions[]): Record<string, SessionStockee[]> {
	const out: Record<string, SessionStockee[]> = {};
	for (const t of tables) for (const [cle, s] of Object.entries(t)) (out[cle] ??= []).push(s);
	return out;
}

/** The snapshots in progress, every device merged question by question. */
export function fusionnerSessions(tables: readonly TableSessions[]): Record<string, SessionQuiz> {
	const out: Record<string, SessionQuiz> = {};
	for (const [cle, entrees] of Object.entries(parCle(tables))) {
		const f = fusionnerPhotos(entrees);
		if (f) out[cle] = f;
	}
	return out;
}

/** The own table as it is written: old tombstones dropped. */
export function aEcrire(table: TableSessions, now: number): TableSessions {
	const out: TableSessions = {};
	for (const [cle, s] of Object.entries(table)) if (!estTombe(s) || now - s.ecrite < TOMBE_MAX_MS) out[cle] = s;
	return out;
}

export interface SessionsPartagees {
	/** Reads every root's files (own and others). */
	load(): Promise<void>;
	/** Reads again the OTHER devices' files (ours: memory is the truth). */
	refresh(): Promise<void>;
	toutes(): Record<string, SessionQuiz>;
	/** True when this quiz's root was loaded: the synced files decide for it. */
	gere(chemin: string): boolean;
	/** Records a snapshot as this device's (written by `ecrire`). */
	poser(chemin: string, s: SessionQuiz): void;
	/** Leaves a tombstone above whatever any device holds for this quiz. */
	effacer(chemin: string): void;
	/** A quiz or a folder (by prefix) moved: the winning entries follow it, as
	    this device's, with tombstones at the old keys. */
	renommer(de: string, vers: string): void;
	/** Copies legacy snapshots (the old settings key) into THIS device's
	    file, where it holds nothing for that quiz yet; the merge then keeps
	    the latest of every device's (the first device to migrate used to
	    block the others' newer progress). Returns how many were placed. */
	migrer(legacy: Record<string, SessionQuiz>): number;
	/** Writes the own files of the roots changed since the last write. */
	ecrire(): Promise<void>;
}

export function createSharedSessions(deps: { fs: SharedFs; roots: () => string[]; deviceId: string; now?: () => number }): SessionsPartagees {
	const { fs, deviceId } = deps;
	const clock = deps.now ?? Date.now;
	const dossier = (root: string): string => `${root}/${REVIEW_DIR}/${SESSIONS_DIR}`;
	const fichier = (root: string): string => `${dossier(root)}/${deviceId}.json`;
	interface Racine { own: TableSessions; autres: TableSessions[]; verrou: boolean }
	const racines = new Map<string, Racine>();
	const modifiees = new Set<string>();
	let cache: Record<string, SessionQuiz> | null = null;
	let lastAt = 0;
	let fileEcriture: Promise<void> = Promise.resolve();
	const nextAt = (min = 0): number => (lastAt = Math.max(clock(), lastAt + 1, min));

	async function lireFichier(chemin: string, root: string): Promise<TableSessions | null> {
		const taille = await fs.size(chemin);
		if (taille === null) return null;
		if (taille > MAX_OCTETS) throw new Error(`sessions file too large: ${chemin}`);
		return lireTableSessions(JSON.parse(await fs.readBounded(chemin, MAX_OCTETS)), root, clock());
	}

	async function chargerRacine(root: string, garder?: Racine): Promise<void> {
		const etat: Racine = garder ? { own: garder.own, autres: [], verrou: garder.verrou } : { own: {}, autres: [], verrou: false };
		let noms: Set<string>;
		try { noms = new Set((await fs.list(dossier(root))).map(baseName)); } catch (e) {
			/* A folder that is there but cannot be listed: our file may be in it,
			   so this root is never written (a partial table would replace it). */
			if (await fs.exists(dossier(root)).catch(() => true)) { racines.set(root, { own: garder?.own ?? {}, autres: [], verrou: true }); cache = null; console.warn(LOG_PREFIX, "sessions folder unreadable:", root, e); return; }
			noms = new Set();
		}
		const proprio = `${deviceId}.json`;
		/* A `.json.tmp` whose `.json` is missing is a write cut between the
		   removal and the rename: complete (written first), it stands in. */
		const sources = new Set<string>();
		for (const n of noms) {
			if (isConflictCopy(n)) continue;
			if (n.endsWith(".json")) sources.add(n);
			else if (n.endsWith(".json.tmp") && !noms.has(n.slice(0, -4))) sources.add(n.slice(0, -4));
		}
		for (const n of sources) {
			if (garder && n === proprio) continue;
			let table: TableSessions | null = null;
			for (const f of [`${dossier(root)}/${n}`, `${dossier(root)}/${n}.tmp`]) {
				if (!noms.has(baseName(f))) continue;
				try { table = await lireFichier(f, root); if (table) break; } catch (e) { console.warn(LOG_PREFIX, "sessions file unreadable:", f, e); }
			}
			if (n === proprio) {
				// Ours unreadable: never replaced by a partial table; this root's progress is then local only.
				if (table) etat.own = table; else etat.verrou = true;
			} else if (table) etat.autres.push(table);
		}
		racines.set(root, etat);
		cache = null;
	}

	const tables = (): TableSessions[] => [...racines.values()].flatMap(r => [r.own, ...r.autres]);
	const racineDe = (chemin: string): Racine | null => racines.get(rootOf(chemin)) ?? null;
	const entrees = (chemin: string): SessionStockee[] => tables().flatMap(t => (t[chemin] ? [t[chemin]] : []));
	const toucher = (chemin: string): void => { modifiees.add(rootOf(chemin)); cache = null; };

	return {
		async load() {
			racines.clear();
			for (const root of deps.roots()) {
				try { await chargerRacine(root); } catch (e) { console.warn(LOG_PREFIX, "sessions not loaded for", root, e); }
			}
		},
		async refresh() {
			for (const root of deps.roots()) {
				try { await chargerRacine(root, racines.get(root)); } catch (e) { console.warn(LOG_PREFIX, "sessions not refreshed for", root, e); }
			}
		},
		toutes: () => (cache ??= fusionnerSessions(tables())),
		gere: chemin => racines.has(rootOf(chemin)),
		poser(chemin, s) {
			const r = racineDe(chemin);
			if (!r) return;
			const toutes = entrees(chemin);
			const au = derniereEcriture(toutes);
			/* Above whatever any device holds for this quiz, whatever the clocks
			   say: the snapshot being played is the latest by definition. */
			const jouee: SessionQuiz = s.ecrite > au ? { ...s } : { ...s, ecrite: nextAt(au + 1) };
			/* The attempt it belongs to: the one under way, or a NEW one (nothing
			   merged: first answer, or right after a restart's tombstone). */
			const courante = fusionnerPhotos(toutes);
			/* A fresh start is stamped only after a restart's tombstone. Two
			   devices starting a never-played quiz at once (Syncthing not yet
			   through, or clocks apart) would otherwise each stamp its own start
			   and the later one would drop the other's answers: unstamped, they
			   merge. */
			const apresTombe = toutes.some(e => "tombe" in e && e.tombe === true);
			if (jouee.depuis === undefined) jouee.depuis = courante?.depuis ?? (courante || !apresTombe ? undefined : jouee.ecrite);
			if (jouee.depuis === undefined) delete jouee.depuis;
			/* What is written is the MERGE of what this device sees, not its local
			   view alone: a device that reopened an old snapshot would republish it. */
			const autres = toutes.filter(e => e !== r.own[chemin]);
			/* The engine never writes `rejugee`: the withdrawals this device sees
			   (its own file included) are carried onto what it plays, or its own
			   next write would let another device's older "right" win again. */
			const portee = porterRejugees(jouee, courante);
			r.own[chemin] = fusionnerPhotos([portee, ...autres]) ?? portee;
			toucher(chemin);
		},
		effacer(chemin) {
			const r = racineDe(chemin);
			if (!r) return;
			const toutes = entrees(chemin);
			if (!fusionnerPhotos(toutes)) return;
			r.own[chemin] = { tombe: true, ecrite: nextAt(derniereEcriture(toutes) + 1) };
			toucher(chemin);
		},
		renommer(de, vers) {
			const g = fusionnerSessions(tables());
			for (const [cle, s] of Object.entries(g)) {
				if (!(cle === de || cle.startsWith(de + "/"))) continue;
				const neuve = vers + cle.slice(de.length);
				const rv = racineDe(neuve), rd = racineDe(cle);
				const au = derniereEcriture(entrees(cle));
				if (rv) { rv.own[neuve] = { ...s, ecrite: nextAt(au + 1) }; toucher(neuve); }
				if (rd) { rd.own[cle] = { tombe: true, ecrite: nextAt(au + 1) }; toucher(cle); }
			}
		},
		migrer(legacy) {
			let n = 0;
			for (const [cle, s] of Object.entries(legacy)) {
				const r = racineDe(cle);
				if (!r || r.own[cle] || !isRecord(s) || s.v !== 1 || !isRecord(s.questions) || typeof s.ecrite !== "number" || !Number.isFinite(s.ecrite) || s.ecrite > clock() + FUTUR_MS) continue;
				r.own[cle] = s;
				toucher(cle);
				n++;
			}
			return n;
		},
		/* ONE write at a time: the 400 ms timer and the flush at closing used to
		   run together on the same `.tmp`, and the older one could win the
		   rename, losing the last answer for the other devices. */
		ecrire() {
			const tour = fileEcriture.then(ecrireMaintenant, ecrireMaintenant);
			fileEcriture = tour.catch(() => {});
			return tour;
		},
	};

	async function ecrireMaintenant(): Promise<void> {
			for (const root of [...modifiees]) {
				modifiees.delete(root);
				const r = racines.get(root);
				if (!r || r.verrou) continue;
				const cible = fichier(root);
				try {
					await fs.mkdirs(dossier(root));
					await fs.write(`${cible}.tmp`, JSON.stringify(aEcrire(r.own, clock())));
					if (await fs.exists(cible)) await fs.remove(cible);
					await fs.rename(`${cible}.tmp`, cible);
				} catch (e) {
					modifiees.add(root);
					throw e;
				}
			}
	}
}
