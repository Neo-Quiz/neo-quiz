/**
 * Abuse limits of the relay. KNOWN LIMIT: Workers KV is eventually consistent
 * and has no atomic increment, so two simultaneous requests can both read the
 * same count. The caps are therefore approximate, which is acceptable for a
 * spam brake (the hard stop is the global daily cap plus the kill switch).
 */
import type { KVLike } from "./github";

export const MAX_PER_IP_10MIN = 3;
export const MAX_PER_IP_DAY = 10;
export const MAX_ISSUES_PER_DAY = 30;
export const WINDOW_MS = 600_000;
export const DAY_TTL = 86_400;
/** Hard cap on the bytes read from a request body. */
export const MAX_BODY_BYTES = 16_384;

export const dayKey = (now: number): string => new Date(now).toISOString().slice(0, 10);

async function count(kv: KVLike, key: string): Promise<number> {
	const n = Number(await kv.get(key));
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Counts this attempt for the IP; false when it is over a cap. */
export async function admitIp(kv: KVLike, ip: string, now: number): Promise<boolean> {
	const k10 = `ip10:${ip}:${Math.floor(now / WINDOW_MS)}`;
	const kd = `ipd:${ip}:${dayKey(now)}`;
	const [n10, nd] = await Promise.all([count(kv, k10), count(kv, kd)]);
	if (n10 >= MAX_PER_IP_10MIN || nd >= MAX_PER_IP_DAY) return false;
	await kv.put(k10, String(n10 + 1), { expirationTtl: 1200 });
	await kv.put(kd, String(nd + 1), { expirationTtl: DAY_TTL * 2 });
	return true;
}

export async function globalFull(kv: KVLike, now: number): Promise<boolean> {
	return (await count(kv, `day:${dayKey(now)}`)) >= MAX_ISSUES_PER_DAY;
}

export async function globalBump(kv: KVLike, now: number): Promise<void> {
	const k = `day:${dayKey(now)}`;
	await kv.put(k, String((await count(kv, k)) + 1), { expirationTtl: DAY_TTL * 2 });
}

export async function sha256Hex(text: string): Promise<string> {
	const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function isDuplicate(kv: KVLike, hash: string): Promise<boolean> {
	return (await kv.get("dup:" + hash)) !== null;
}

export async function markDuplicate(kv: KVLike, hash: string): Promise<void> {
	await kv.put("dup:" + hash, "1", { expirationTtl: DAY_TTL });
}
