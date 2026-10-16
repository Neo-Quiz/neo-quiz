/* The automatic Learn log (`auto-learn-record.ts`) kept in IndexedDB. Unlike
   the generation queue it is NOT session-scoped: it must survive a restart,
   that is its whole point. Every failure only means the log is not kept (an
   empty one is read); nothing here ever rejects. */

import { LOG_PREFIX } from "../branding";
import { emptyLog, readLog, type AutoLearnLog } from "./auto-learn-record";

const BASE = "neo-quiz-auto-learn";
const MAGASIN = "log";
const CLE = "log";

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

/* Writes are CHAINED: two saves in a row land in their order. */
let ecriture: Promise<void> = Promise.resolve();

export function writeAutoLog(log: AutoLearnLog): Promise<void> {
	ecriture = ecriture.then(() => transaction("readwrite", s => s.put(log, CLE)).then(() => undefined))
		.catch(e => { console.warn(LOG_PREFIX, "automatic Learn log not saved:", e); });
	return ecriture;
}

export async function readAutoLog(): Promise<AutoLearnLog> {
	try { return readLog(await transaction("readonly", s => s.get(CLE))); }
	catch (e) { console.warn(LOG_PREFIX, "automatic Learn log not read:", e); return emptyLog(); }
}
