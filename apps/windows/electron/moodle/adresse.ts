/* Address rules of the Moodle client (pure but for `dns`, which the caller can
   replace): a Moodle site is a PUBLIC host, so a name that resolves to a
   loopback, private, link-local, CGNAT, unique-local or reserved address is
   refused AT CONNECTION TIME (a custom `lookup`), which also covers DNS
   rebinding and names like `x.nip.io` that no name check can see. */

import * as dns from "node:dns";
import * as net from "node:net";

/** Host names that are never a public Moodle site, whatever they resolve to. */
export function nomHoteInterdit(hostname: string): boolean {
	const h = hostname.trim().toLowerCase();
	if (!h || h.endsWith(".")) return true;
	return h === "localhost" || [".localhost", ".internal", ".lan", ".local", ".localdomain", ".home.arpa"].some(s => h.endsWith(s));
}

function v4Prive(a: number, b: number, c: number): boolean {
	return a === 0 || a === 10 || a === 127 || a >= 224
		|| (a === 100 && b >= 64 && b <= 127)
		|| (a === 169 && b === 254)
		|| (a === 172 && b >= 16 && b <= 31)
		|| (a === 192 && b === 168)
		|| (a === 192 && b === 0 && c === 0)
		|| (a === 198 && (b === 18 || b === 19));
}

/** Expands an IPv6 text to 8 groups, or null. */
function groupesV6(ip: string): number[] | null {
	let s = ip.toLowerCase().replace(/%.*$/, "");
	const dernier = s.lastIndexOf(":");
	if (s.includes(".")) {
		const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s.slice(dernier + 1));
		if (!m) return null;
		const [a, b, c, d] = m.slice(1).map(Number);
		s = s.slice(0, dernier + 1) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
	}
	const [tete, queue, trop] = s.split("::");
	if (trop !== undefined) return null;
	const t = tete ? tete.split(":") : [];
	const q = queue === undefined ? [] : queue ? queue.split(":") : [];
	if (queue === undefined ? t.length !== 8 : t.length + q.length > 7) return null;
	const g = queue === undefined ? t : [...t, ...Array(8 - t.length - q.length).fill("0"), ...q];
	const n = g.map(x => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN));
	return n.some(Number.isNaN) ? null : n;
}

/** True when `ip` (v4 or v6 text) must never be reached by the Moodle client.
    Anything unreadable counts as private. */
export function adresseEstPrivee(ip: string): boolean {
	const v = net.isIP(ip);
	if (v === 4) {
		const [a, b, c] = ip.split(".").map(Number);
		return v4Prive(a, b, c);
	}
	if (v === 6) {
		const g = groupesV6(ip);
		if (!g) return true;
		if (g.every(x => x === 0) || (g.slice(0, 7).every(x => x === 0) && g[7] === 1)) return true;   // :: and ::1
		if ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00) return true;   // ULA, link-local, multicast
		const embarque = (hi: number, lo: number): boolean => v4Prive(hi >> 8, hi & 255, lo >> 8);
		if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return embarque(g[6], g[7]);   // ::ffff:a.b.c.d
		if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return embarque(g[6], g[7]);   // NAT64
		if (g[0] === 0x2002) return embarque(g[1], g[2]);   // 6to4
		return false;
	}
	return true;
}

export interface Resolu { address: string; family: number }
export type Resolveur = (hote: string) => Promise<Resolu[]>;
const resolveurSysteme: Resolveur = hote => dns.promises.lookup(hote, { all: true, verbatim: true });

type Rappel = (err: NodeJS.ErrnoException | null, adresse: string | dns.LookupAddress[], famille?: number) => void;

/** A `lookup` for `http(s).request` / an Agent: refuses a name that is forbidden
    or resolves (even partly) to a private address. `resolveur` is injected by tests. */
export function creerLookup(resolveur: Resolveur = resolveurSysteme): net.LookupFunction {
	return (hote: string, options: dns.LookupOptions, rappel: Rappel): void => {
		const cb = rappel;
		const opts = options ?? {};
		const refuser = (): void => {
			const e: NodeJS.ErrnoException = new Error("Refused: the Moodle host is not a public address.");
			e.code = "EPRIVATE";
			cb(e, "");
		};
		if (nomHoteInterdit(hote)) return refuser();
		resolveur(hote).then(liste => {
			if (!liste.length || liste.some(r => adresseEstPrivee(r.address))) return refuser();
			const voulue = opts.family === 4 || opts.family === 6 ? liste.filter(r => r.family === opts.family) : liste;
			if (!voulue.length) return refuser();
			if (opts.all) cb(null, voulue.map(r => ({ address: r.address, family: r.family })));
			else cb(null, voulue[0].address, voulue[0].family);
		}, (e: NodeJS.ErrnoException) => cb(e, ""));
	};
}
