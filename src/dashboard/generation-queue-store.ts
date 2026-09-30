/* ══════════════════════════════════════════════════════════
   THE GENERATION QUEUE, KEPT ACROSS A RELOAD OF THE PAGE (2026-09-30)

   The queue lives in the page's memory (`file-generation-app.ts`): a reload
   (Ctrl+R, a setting that reloads, a renderer crash, Vite in `app:dev`) lost
   the generation in progress AND every request waiting behind it — a whole
   "/exam" plan of eight quizzes. The queue is now saved here after each
   change and read back when the page starts again.

   IndexedDB, not sessionStorage: a request carries the TEXT of its
   documents (hundreds of KB per PDF, repeated on each line of an "/exam"
   plan) and its images as `File` objects, which only IndexedDB stores as
   they are (structured clone).

   SCOPED TO THE WINDOW, like the running CLIs the main process keeps for it:
   the snapshot carries the window's session id, kept in sessionStorage,
   which survives a reload but not a restart of the application. A snapshot
   of another session is never restored (it is deleted): after a restart,
   its CLIs are gone, and replaying its lines would launch them all again.

   Every failure (no IndexedDB, storage refused, quota) only means the queue
   is not kept — the behaviour of before, never an error for the user.
══════════════════════════════════════════════════════════ */

import { LOG_PREFIX } from "../branding";

const BASE = "neo-quiz-generation";
const MAGASIN = "file";
const CLE = "courante";
const CLE_SESSION = "neo-quiz.generation-session";
/** A read that never answers must not hold the queue forever. */
const DELAI_LECTURE_MS = 3000;

let sessionCache: string | null = null;

/** The window's session id: the same after a reload, new after a restart.
    `[a-z0-9]` only, so a resume key built from it stays valid. */
export function sessionDeFenetre(): string {
	if (sessionCache) return sessionCache;
	let id: string | null = null;
	try { id = sessionStorage.getItem(CLE_SESSION); } catch { /* no storage: a session per page */ }
	if (!id || !/^[a-z0-9]{8,40}$/.test(id)) {
		id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
		try { sessionStorage.setItem(CLE_SESSION, id); } catch { /* idem */ }
	}
	sessionCache = id;
	return id;
}

function ouvrir(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === "undefined") { reject(new Error("no IndexedDB")); return; }
		const req = indexedDB.open(BASE, 1);
		req.onupgradeneeded = () => { req.result.createObjectStore(MAGASIN); };
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function transaction<T>(mode: IDBTransactionMode, faire: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const db = await ouvrir();
	try {
		return await new Promise<T>((resolve, reject) => {
			const tx = db.transaction(MAGASIN, mode);
			const req = faire(tx.objectStore(MAGASIN));
			tx.oncomplete = () => resolve(req.result);
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

interface Instantane<T> { session: string; etat: T }

/* Writes are CHAINED: two saves in a row land in their order, the last
   state always wins. */
let ecriture: Promise<void> = Promise.resolve();

/** Saves the queue's state for this window. Never rejects. */
export function garderFile<T>(etat: T): Promise<void> {
	const instantane: Instantane<T> = { session: sessionDeFenetre(), etat };
	ecriture = ecriture.then(() => transaction("readwrite", s => s.put(instantane, CLE)).then(() => undefined))
		.catch(e => { console.warn(LOG_PREFIX, "generation queue not saved:", e); });
	return ecriture;
}

/** The queue saved by this window before its reload, or `null`. A snapshot
    of another session is deleted, not returned. Never rejects. */
export async function relireFile<T>(): Promise<T | null> {
	const lecture = (async (): Promise<T | null> => {
		const lu = await transaction("readonly", s => s.get(CLE)) as Instantane<T> | undefined;
		if (!lu) return null;
		if (lu.session !== sessionDeFenetre()) {
			await transaction("readwrite", s => s.delete(CLE));
			return null;
		}
		return lu.etat;
	})();
	const delai = new Promise<null>(resolve => setTimeout(() => resolve(null), DELAI_LECTURE_MS));
	try {
		return await Promise.race([lecture, delai]);
	} catch (e) {
		console.warn(LOG_PREFIX, "generation queue not read back:", e);
		return null;
	}
}
