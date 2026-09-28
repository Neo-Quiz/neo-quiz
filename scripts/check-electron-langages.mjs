/**
 * THE C/C++ LANGUAGE PACK INSTALLER of the main process
 * (apps/windows/electron/langages.ts) — task 9 of
 * docs/superpowers/plans/2026-09-28-c-cpp-execution.md.
 *
 * WHAT THESE CASES PREVENT, which no typecheck sees:
 * — a download whose bytes differ from the pin (one byte flipped, or cut
 *   short) being installed, or leaving anything on disk;
 * — a redirect to a host outside the list being followed;
 * — an archive entry named `../x`, `C:x`, `\\srv\x`… escaping the pack
 *   directory, even inside a pack whose hash matches its pin;
 * — the installed files landing anywhere but where the C/C++ worker
 *   fetches them (`c/clang/bundle.js`, `c/wasi-shim/index.js`,
 *   `c/manifest.json` — worker-clang.mjs, code-sandbox.ts);
 * — a delete leaving the pack behind.
 *
 * NEVER THE NETWORK: an INJECTED transport serves a small test pack built
 * here, with its own pin (the `pack` seam). The real pack's gzip bytes
 * depend on the zlib that built them, so a check that rebuilt it bit for
 * bit would test zlib, not the installer. The REAL pin is still checked
 * when `dist-pack/` holds the built pack (`npm run build:language-pack`):
 * its size and SHA-256 must be exactly `PACK_C`'s, and it installs.
 *
 *     npm run check:electron-langages
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const r = makeReporter("Language pack installer");
const tmp = mkdtempSync(join(tmpdir(), "neo-langages-"));
const URL_TEST = "https://github.com/Neo-Quiz/neo-quiz/releases/download/language-c-test/language-c-test.zip.gz";

/** A response of the injected transport: the whole body, streamed in two
    chunks so progress is seen more than once. */
function reponse(status, corps, entetes = {}) {
	return {
		status,
		entete: (nom) => entetes[nom.toLowerCase()] ?? null,
		texte: async () => Buffer.from(corps ?? []).toString("latin1"),
		octets: corps ? async function* () { const m = corps.length >> 1; yield corps.subarray(0, m); yield corps.subarray(m); } : undefined,
	};
}

/** A transport serving `corps` at `URL_TEST`; `demandees` lists every URL
    it was asked for (a host outside the list must never reach it). */
function transportServant(corps, options = {}) {
	const demandees = [];
	const t = async (url) => {
		demandees.push(url);
		if (options.redirigeVers && url === URL_TEST) return reponse(302, null, { location: options.redirigeVers });
		if (url === URL_TEST) return reponse(200, corps);
		return reponse(404, Buffer.alloc(0));
	};
	t.demandees = demandees;
	return t;
}

const pinDe = (corps) => ({ url: URL_TEST, sha256: createHash("sha256").update(corps).digest("hex"), taille: corps.length });
const nouveauDossier = (nom) => join(tmp, nom);
const codeDuRejet = (p) => p.then(() => "no rejection", (e) => e?.code ?? "no code: " + String(e));
/** Nothing but the (possibly absent) root: no `c`, no `.part` left. */
const resteSurDisque = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

try {
	await withSrcModule("src/dashboard/zip.ts", async ({ buildZip }) => {
		await withSrcModule("apps/windows/electron/langages.ts", async ({ PACK_C, etatLangage, installerLangage, supprimerLangage, nomEntreeAdmis }) => {
			/* THE TEST PACK: the exact layout the worker loads, tiny files. */
			const entrees = [
				{ name: "clang/bundle.js", content: "export const runClang = () => {};" },
				{ name: "wasi-shim/index.js", content: "export {};" },
				{ name: "LICENSES/NOTICE.txt", content: "test" },
				{ name: "manifest.json", content: JSON.stringify({ version: "test" }) },
			];
			const pack = Buffer.from(gzipSync(buildZip(entrees)));
			const pin = pinDe(pack);

			// ── A good pack installs, where the worker looks ──
			const dir = nouveauDossier("ok");
			const vues = [];
			await installerLangage(dir, (recus, total) => vues.push([recus, total]), transportServant(pack), pin);
			const st = await etatLangage(dir);
			r.check("installs and reports", [st.installe, st.version], [true, "test"]);
			r.check("files served where the worker looks",
				["clang/bundle.js", "wasi-shim/index.js", "manifest.json"].map((f) => existsSync(join(dir, "c", ...f.split("/")))), [true, true, true]);
			r.check("progress reaches the pinned size", vues.at(-1), [pack.length, pack.length]);
			r.check("no .part left after a success", resteSurDisque(dir), ["c"]);

			// ── Bytes that do not match the pin ──
			const modifie = Buffer.from(pack);
			modifie[modifie.length >> 1] ^= 0xff;
			const dir2 = nouveauDossier("modifie");
			r.check("wrong hash refused, nothing left",
				[await codeDuRejet(installerLangage(dir2, () => {}, transportServant(modifie), pin)), resteSurDisque(dir2)], ["empreinte", []]);
			/* The cases above are also caught by gzip's own CRC; this one only
			   by the pin: a VALID pack, just not the pinned one. */
			const autre = Buffer.from(gzipSync(buildZip([...entrees.slice(0, -1), { name: "manifest.json", content: JSON.stringify({ version: "other" }) }])));
			const dirAutre = nouveauDossier("autre");
			r.check("a valid pack other than the pinned one refused, nothing left",
				[await codeDuRejet(installerLangage(dirAutre, () => {}, transportServant(autre), pin)), resteSurDisque(dirAutre)], ["empreinte", []]);
			const dir3 = nouveauDossier("tronque");
			r.check("truncated download never installed",
				[await codeDuRejet(installerLangage(dir3, () => {}, transportServant(pack.subarray(0, pack.length >> 1)), pin)), resteSurDisque(dir3)], ["empreinte", []]);

			// ── A redirect outside the host list ──
			const dir4 = nouveauDossier("redirige");
			const t4 = transportServant(pack, { redirigeVers: "https://evil.example/x" });
			r.check("a host outside the list is never followed",
				[await codeDuRejet(installerLangage(dir4, () => {}, t4, pin)), t4.demandees, resteSurDisque(dir4)], ["reseau", [URL_TEST], []]);

			// ── An archive entry that would escape, in a pack whose hash MATCHES ──
			for (const nom of ["../evil.txt", "clang/../../evil.txt", "C:evil.txt", "/evil.txt", "a\\..\\..\\evil.txt"]) {
				const piege = Buffer.from(gzipSync(buildZip([...entrees, { name: nom, content: "pwned" }])));
				const d = nouveauDossier("piege-" + readdirSync(tmp).length);
				r.check("entry " + JSON.stringify(nom) + " refused, nothing written",
					[await codeDuRejet(installerLangage(d, () => {}, transportServant(piege), pinDe(piege))), resteSurDisque(d), existsSync(join(tmp, "evil.txt"))], ["empreinte", [], false]);
			}
			r.check("entry names: every unsafe form refused",
				["..", "a/../b", "a//b", "./a", "C:/x", "c:x", "/x", "\\\\srv\\share\\x", "a\\b", "a\0b", ""].map((n) => nomEntreeAdmis(n)),
				[null, null, null, null, null, null, null, null, null, null, null]);
			r.check("entry names: the pack's own forms admitted", ["clang/bundle.js", "manifest.json", "LICENSES/NOTICE.txt"].map((n) => nomEntreeAdmis(n)),
				["clang/bundle.js", "manifest.json", "LICENSES/NOTICE.txt"]);

			// ── A previous install is replaced, a delete removes it ──
			await installerLangage(dir, () => {}, transportServant(pack), pin);
			r.check("reinstall over an installed pack", (await etatLangage(dir)).installe, true);
			await supprimerLangage(dir);
			r.check("delete removes the directory", [(await etatLangage(dir)).installe, existsSync(join(dir, "c"))], [false, false]);
			r.check("state of a never-installed pack", await etatLangage(nouveauDossier("jamais")), { installe: false, version: null, octets: 0 });

			// ── The REAL pin against the built pack, when it has been built ──
			const reel = join("dist-pack", `language-c-${PACK_C.version}.zip.gz`);
			if (existsSync(reel)) {
				const octets = readFileSync(reel);
				r.check("the built pack is exactly PACK_C (size, SHA-256)",
					[octets.length, createHash("sha256").update(octets).digest("hex")], [PACK_C.taille, PACK_C.sha256]);
				const t = async (url) => (url === PACK_C.url ? reponse(200, octets) : reponse(404, Buffer.alloc(0)));
				const dirReel = nouveauDossier("reel");
				await installerLangage(dirReel, () => {}, t);
				r.check("the real pack installs with the app's own pin",
					[(await etatLangage(dirReel)).version, existsSync(join(dirReel, "c", "clang", "llvm.core.wasm"))], [PACK_C.version, true]);
			} else {
				console.log("(dist-pack/ absent: the real pin was not compared — run `npm run build:language-pack` first)");
			}
			r.check("PACK_C downloads from the app's own releases", PACK_C.url.startsWith("https://github.com/Neo-Quiz/neo-quiz/releases/download/language-c-"), true);
		});
	});
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
r.done();
