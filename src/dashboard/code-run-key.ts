/* ══════════════════════════════════════════════════════════
   THE PHONE'S SIGNING KEY FOR PYTHON RUN REQUESTS

   Syncthing tells the PC which paired device made a file, but that claim is
   the sending device's own word: a compromised paired device could write a
   request in the phone's folder and say the phone made it. So each phone
   signs its requests (code-run-request.ts, `signedMessage`) with an ECDSA
   P-256 key made here once, and the PC pins the public key on the owner's
   first "Allow" (apps/windows/electron/python/distant.ts).

   The private key is a NON-EXTRACTABLE WebCrypto key kept in IndexedDB (a
   `CryptoKey` survives structured cloning, its bytes never reach script):
   page code can sign while it runs, nothing can copy the key elsewhere.
   Losing it (app data cleared) only means a new key, which the PC refuses
   until the owner removes the device in Settings and allows it again.
══════════════════════════════════════════════════════════ */

import { keyFingerprint } from "../shared-state/code-run-request";

export interface RequestSigner {
	/** base64url of the raw (65-byte, uncompressed) public key. */
	publicKey(): Promise<string>;
	/** base64url of the 64-byte P1363 signature of the UTF-8 bytes of `message`. */
	sign(message: string): Promise<string>;
}

const BASE = "neo-quiz-code-run-key";
const MAGASIN = "keys";
const CLE = "p256";
const ALGO = { name: "ECDSA", namedCurve: "P-256" } as const;

export function base64url(bytes: Uint8Array): string {
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

const estPaire = (v: unknown): v is CryptoKeyPair =>
	!!v && typeof v === "object" && (v as CryptoKeyPair).privateKey instanceof CryptoKey && (v as CryptoKeyPair).publicKey instanceof CryptoKey;

/** The key pair, made and stored once. A key that cannot be STORED is never
    used: a key kept only in memory would change at the next start, and the
    PC would refuse it. */
async function paire(): Promise<CryptoKeyPair> {
	/* Persistent storage: under storage pressure Android may otherwise evict
	   IndexedDB, and a new key would be refused by the PC (security review
	   2026-10-26). A refusal changes nothing here. */
	try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
	const lue = await transaction("readonly", s => s.get(CLE) as IDBRequest<unknown>);
	if (estPaire(lue)) return lue;
	const neuve = await crypto.subtle.generateKey(ALGO, false, ["sign", "verify"]);
	/* `add`, not `put`: two first runs at once (two windows) must not each
	   keep a different key; the loser reads the winner's. */
	try { await transaction("readwrite", s => s.add(neuve, CLE)); }
	catch {
		const autre = await transaction("readonly", s => s.get(CLE) as IDBRequest<unknown>);
		if (estPaire(autre)) return autre;
		throw new Error("code run key not stored");
	}
	return neuve;
}

/** The short code of `key` (`keyFingerprint`), hashed with Web Crypto. */
export async function fingerprintOf(key: string): Promise<string> {
	return keyFingerprint(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))));
}

let signataire: RequestSigner | null = null;
/** This device's one signer: the run requests, the run warning and Settings
    all show or use the same key. */
export function deviceSigner(): RequestSigner {
	signataire ??= createIndexedDbSigner();
	return signataire;
}

/** The phone's signer, its key pair read (or made) on first use. */
export function createIndexedDbSigner(): RequestSigner {
	let p: Promise<CryptoKeyPair> | null = null;
	const obtenir = (): Promise<CryptoKeyPair> => {
		/* A failure is not cached: the next run tries again. */
		p ??= paire().catch(e => { p = null; throw e; });
		return p;
	};
	return {
		async publicKey() {
			return base64url(new Uint8Array(await crypto.subtle.exportKey("raw", (await obtenir()).publicKey)));
		},
		async sign(message) {
			const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, (await obtenir()).privateKey, new TextEncoder().encode(message));
			return base64url(new Uint8Array(sig));
		},
	};
}
