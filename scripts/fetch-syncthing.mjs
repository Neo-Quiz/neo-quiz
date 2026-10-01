/**
 * Downloads the pinned Syncthing zip, verifies its SHA-256, extracts ONLY
 * `syncthing.exe`, verifies its SHA-256 too, and writes it to
 * `apps/windows/vendor/syncthing/syncthing.exe` (git-ignored, never committed).
 * Nothing is written unless both hashes match.
 *
 *     npm run fetch:syncthing
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { SYNCTHING } from "./syncthing-pins.mjs";

const sha256 = b => createHash("sha256").update(b).digest("hex");

/** The bytes of one entry of a zip (central directory, stored or deflated). */
export function entreeZip(zip, nom) {
	let eocd = -1;
	for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
		if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
	}
	if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");
	const n = zip.readUInt16LE(eocd + 10);
	let p = zip.readUInt32LE(eocd + 16);
	for (let k = 0; k < n; k++) {
		if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt central directory");
		const methode = zip.readUInt16LE(p + 10);
		const tailleComp = zip.readUInt32LE(p + 20);
		const lenNom = zip.readUInt16LE(p + 28);
		const lenExtra = zip.readUInt16LE(p + 30);
		const lenCom = zip.readUInt16LE(p + 32);
		const local = zip.readUInt32LE(p + 42);
		const nomEntree = zip.toString("utf8", p + 46, p + 46 + lenNom);
		if (nomEntree === nom) {
			const debut = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
			const brut = zip.subarray(debut, debut + tailleComp);
			if (methode === 0) return brut;
			if (methode === 8) return inflateRawSync(brut);
			throw new Error("unsupported zip method " + methode);
		}
		p += 46 + lenNom + lenExtra + lenCom;
	}
	throw new Error("entry not found in the zip: " + nom);
}

async function main() {
	const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
	const sortie = join(racine, "apps", "windows", "vendor", "syncthing", "syncthing.exe");
	if (existsSync(sortie) && sha256(readFileSync(sortie)) === SYNCTHING.exeSha256) {
		console.log("syncthing.exe already present and matching its pin");
		return;
	}
	const rep = await fetch(SYNCTHING.zipUrl);
	if (!rep.ok) throw new Error(`download failed: HTTP ${rep.status}`);
	const zip = Buffer.from(await rep.arrayBuffer());
	if (sha256(zip) !== SYNCTHING.zipSha256) throw new Error("zip SHA-256 differs from the pin: nothing written");
	const exe = entreeZip(zip, SYNCTHING.exeEntry);
	if (sha256(exe) !== SYNCTHING.exeSha256) throw new Error("syncthing.exe SHA-256 differs from the pin: nothing written");
	mkdirSync(dirname(sortie), { recursive: true });
	writeFileSync(sortie + ".tmp", exe);
	renameSync(sortie + ".tmp", sortie);
	console.log("syncthing.exe written to " + sortie);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().catch(e => { console.error(String(e && e.message || e)); process.exitCode = 1; });
}
