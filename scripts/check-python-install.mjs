/**
 * THE PYTHON INSTALLER of the main process
 * (apps/windows/electron/python/installation.ts), task 3 of
 * docs/superpowers/plans/2026-10-22-native-python-run.md: the pinned CPython
 * embeddable zip and the pinned wheels, unpacked under `userData/python`.
 *
 * WHAT THESE CASES PREVENT, which no typecheck sees:
 * - bytes that differ from their pin (one byte flipped, one byte too many)
 *   being installed, or leaving anything on disk;
 * - a redirect to `http:` or to a host off the list being followed, or the
 *   interpreter host missing from the list (every first install would fail);
 * - a wheel that fails half-way through its unpack (a wrong CRC found only
 *   at inflate time) leaving its `.part` folder behind;
 * - a library installed before its dependencies, or two downloads of the
 *   same file when two runs ask for it at once;
 * - `python312._pth` naming a folder that is not installed, or missing one
 *   that is (an import that fails, or one that reads a stale version);
 * - uninstalling a library that an installed library still needs;
 * - a wheel's `*.data/purelib|platlib` not merged at its root, or its
 *   `scripts`/`headers`/`data` kept;
 * - a size in Settings that is not the size on disk.
 *
 * NEVER THE NETWORK: an injected transport serves archives forged here
 * (scripts/lib/zip-forge.mjs) for a fake catalogue whose URLs sit on the
 * real hosts, so the real host list and the real `demander` judge them.
 *
 *     npm run check:python-install
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";
import { forgeZip } from "./lib/zip-forge.mjs";

const r = makeReporter("Python installer");
const tmp = mkdtempSync(join(tmpdir(), "neo-python-install-"));
/* B2 runs in its own folder: the snapshots of the other sections cover `tmp` whole. */
const tmpR = mkdtempSync(join(tmpdir(), "neo-python-install-roots-"));

const sha = (b) => createHash("sha256").update(b).digest("hex");

/** Every file and folder under `dir`, with content hashes, sorted. */
function snapshot(dir) {
	const out = [];
	const walk = (d, rel) => {
		for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const p = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) { out.push(`${p}/`); walk(join(d, e.name), p); } else out.push(`${p} ${sha(readFileSync(join(d, e.name)))}`);
		}
	};
	if (existsSync(dir)) walk(dir, "");
	return out;
}

/** Bytes under `dir`, counted independently of the module under test. */
function taille(dir) {
	let total = 0;
	for (const e of readdirSync(dir)) {
		const p = join(dir, e);
		const s = lstatSync(p);
		total += s.isDirectory() ? taille(p) : s.size;
	}
	return total;
}

/* ── The forged archives and their fake catalogue ── */

const PY = "https://www.python.org/ftp/python/3.12.10/";
const PH = "https://files.pythonhosted.org/packages/aa/bb/";

const interpreteZip = forgeZip([
	{ name: "python.exe", bytes: "MZ fake python" },
	{ name: "python312.dll", bytes: "fake dll ".repeat(200) },
	{ name: "python312.zip", bytes: "fake stdlib", method: 0 },
	{ name: "python312._pth", bytes: "python312.zip\n.\n\n# Uncomment to run site.main() automatically\n#import site\n" },
]);
const numpyZip = forgeZip([
	{ name: "numpy/", bytes: "", method: 0 },
	{ name: "numpy/__init__.py", bytes: "__version__ = '2.5.4'\n".repeat(20) },
	{ name: "numpy/_core.pyd", bytes: "binary ".repeat(500) },
	{ name: "numpy-2.5.4.dist-info/METADATA", bytes: "Name: numpy\nVersion: 2.5.4\n" },
]);
const tzdataZip = forgeZip([
	{ name: "tzdata/__init__.py", bytes: "IANA_VERSION = '2026a'\n" },
	{ name: "tzdata-2026.1.dist-info/METADATA", bytes: "Name: tzdata\n" },
]);
/* `*.data/purelib` and `platlib` merge at the root, `platlib/pandas/` INTO
   the existing `pandas/`; `scripts`, `headers` and `data` are dropped. */
const pandasZip = forgeZip([
	{ name: "pandas/__init__.py", bytes: "import numpy\n" },
	{ name: "pandas-3.0.6.dist-info/METADATA", bytes: "Name: pandas\nRequires-Dist: numpy\n" },
	{ name: "pandas-3.0.6.data/purelib/pandas_extra.py", bytes: "EXTRA = 1\n" },
	{ name: "pandas-3.0.6.data/platlib/pandas/_lib.pyd", bytes: "native ".repeat(100) },
	{ name: "pandas-3.0.6.data/scripts/pandas-tool.exe", bytes: "MZ tool" },
	{ name: "pandas-3.0.6.data/headers/pandas.h", bytes: "#pragma once\n" },
	{ name: "pandas-3.0.6.data/data/share/x.txt", bytes: "data\n" },
]);
const leafZip = forgeZip([{ name: "leaf/__init__.py", bytes: "LEAF = 1\n" }]);
/* Pinned (its hash matches) but hostile inside: the zip reader refuses it. */
const evasionZip = forgeZip([{ name: "ok/__init__.py", bytes: "x" }, { name: "../evil.py", bytes: "boom" }]);
/* Pinned, every name fine, but its second entry's CRC is wrong: found only
   at inflate time, AFTER the first entry was written into `.part`. */
const crcZip = forgeZip([{ name: "crc/__init__.py", bytes: "first entry\n".repeat(50) }, { name: "crc/second.py", bytes: "second entry\n", crc: 0x12345678 }]);
/* A wheel whose `.data/purelib` file collides with a root file. */
const collisionZip = forgeZip([{ name: "coll.py", bytes: "root" }, { name: "coll-1.0.data/purelib/coll.py", bytes: "data" }]);

const pin = (url, octets, version, dependances) => ({ version, url, sha256: sha(octets), taille: octets.length, ...(dependances ? { dependances } : {}) });

const CORPS = new Map([
	[PY + "python-3.12.10-embed-amd64.zip", interpreteZip],
	[PH + "numpy-2.5.4-cp312-cp312-win_amd64.whl", numpyZip],
	[PH + "tzdata-2026.1-py2.py3-none-any.whl", tzdataZip],
	[PH + "pandas-3.0.6-cp312-cp312-win_amd64.whl", pandasZip],
	[PH + "leaf-1.0-py3-none-any.whl", leafZip],
	[PH + "evasion-1.0-py3-none-any.whl", evasionZip],
	[PH + "crc-1.0-py3-none-any.whl", crcZip],
	[PH + "coll-1.0-py3-none-any.whl", collisionZip],
]);
const urlDe = (debut) => [...CORPS.keys()].find((u) => u.includes(debut));

const CATALOGUE = {
	interprete: pin(urlDe("python-3.12.10"), interpreteZip, "3.12.10"),
	paquets: {
		numpy: pin(urlDe("numpy-"), numpyZip, "2.5.4", []),
		pandas: pin(urlDe("pandas-"), pandasZip, "3.0.6", ["numpy", "tzdata"]),
		tzdata: pin(urlDe("tzdata-"), tzdataZip, "2026.1", []),
		leaf: pin(urlDe("leaf-"), leafZip, "1.0", []),
		evasion: pin(urlDe("evasion-"), evasionZip, "1.0", []),
		crc: pin(urlDe("crc-"), crcZip, "1.0", []),
		coll: pin(urlDe("coll-"), collisionZip, "1.0", []),
	},
};

/** A response of the injected transport, its body streamed in 3 chunks. */
function reponse(status, corps, entetes = {}) {
	return {
		status,
		entete: (nom) => entetes[nom.toLowerCase()] ?? null,
		texte: async () => Buffer.from(corps ?? []).toString("latin1"),
		octets: corps ? async function* () {
			const t = Math.ceil(corps.length / 3);
			for (let i = 0; i < corps.length; i += t) { await new Promise((ok) => setTimeout(ok, 1)); yield corps.subarray(i, i + t); }
		} : undefined,
	};
}

/** The fake network: `CORPS`, with per-URL overrides (`remplacer`: another
    body, or `{ redirige }`). `appels` lists every URL that reached it. */
function transportFaux() {
	const appels = [];
	const remplacements = new Map();
	const t = async (url) => {
		appels.push(url);
		t.surAppel(url);
		const autre = remplacements.get(url);
		if (autre && autre.sansFlux) return { status: 200, entete: () => null, texte: async () => "never read" };
		if (autre && autre.redirige) return reponse(302, null, { location: autre.redirige });
		if (autre && autre.status) return reponse(autre.status, Buffer.alloc(0));
		if (autre && autre.flux) return { status: 200, entete: () => null, texte: async () => "", octets: autre.flux };
		const corps = autre ?? CORPS.get(url);
		return corps ? reponse(200, corps) : reponse(404, Buffer.alloc(0));
	};
	t.appels = appels;
	t.surAppel = () => {};
	t.remplacer = (url, v) => remplacements.set(url, v);
	t.retablir = () => remplacements.clear();
	return t;
}

/** The `code` an installer call rejected with, or what happened instead. */
async function codeDe(promesse) {
	try { await promesse; return "no error"; } catch (e) { return e && e.code ? e.code : "not an install error: " + String(e && e.message); }
}

/** A disk that obeys `pannes`: each { op, quand, code } makes the matching
    rename or write throw an errno error, as Windows would. */
const pannes = [];
const panne = (op, ...args) => {
	const p = pannes.find((x) => x.op === op && x.quand(...args));
	if (p) { const e = new Error(p.code + " (injected)"); e.code = p.code; throw e; }
};
const DISQUE_FAUX = {
	renommer(de, vers) { panne("renommer", de, vers); renameSync(de, vers); },
	ecrire(chemin, texte) { panne("ecrire", chemin); writeFileSync(chemin, texte, "utf8"); },
};

const lirePth = (racine) => readFileSync(join(racine, "interpreteur", "python312._pth"), "utf8").split(/\r?\n/).filter((l) => l !== "");
const lib = (racine, dossier) => resolve(racine, "libs", dossier);

try {
	await withSrcModule("apps/windows/electron/python/installation.ts", async ({ creerInstallationPython, surHote }) => {
		/* ── 1. Fresh install: interpreter, then the closure, deps first ── */
		const racineA = join(tmp, "a", "python");
		const tA = transportFaux();
		const instA = creerInstallationPython(racineA, tA, CATALOGUE);
		r.check("a fresh root reads as nothing installed", await instA.etat(), { interprete: false, version: null, paquets: [], octetsTotal: 0, racines: [] });
		r.check("chemins: python.exe in the interpreter folder", instA.chemins(), { executable: join(resolve(racineA), "interpreteur", "python.exe"), dossier: join(resolve(racineA), "interpreteur") });

		const progres = [];
		await instA.installer(["pandas"], (recus, total) => progres.push([recus, total]));
		r.check("interpreter first, then dependencies before the package that needs them", tA.appels, [
			CATALOGUE.interprete.url, CATALOGUE.paquets.numpy.url, CATALOGUE.paquets.tzdata.url, CATALOGUE.paquets.pandas.url,
		]);
		const totalAttendu = interpreteZip.length + numpyZip.length + tzdataZip.length + pandasZip.length;
		r.check("progress ends at its total, the sum of the pinned sizes", progres.at(-1), [totalAttendu, totalAttendu]);
		r.check("progress never goes back nor past its total", progres.every(([a, t], i) => t === totalAttendu && a <= t && (i === 0 || a >= progres[i - 1][0])), true);
		r.check("the interpreter is unpacked", existsSync(join(racineA, "interpreteur", "python.exe")) && existsSync(join(racineA, "interpreteur", "python312.dll")), true);
		r.check("one folder per wheel, named <package>-<version>, nothing else in libs/", readdirSync(join(racineA, "libs")).sort(), ["numpy-2.5.4", "pandas-3.0.6", "tzdata-2026.1"]);
		r.check("wheel content lands at the folder root", existsSync(join(racineA, "libs", "numpy-2.5.4", "numpy", "__init__.py")) && existsSync(join(racineA, "libs", "numpy-2.5.4", "numpy-2.5.4.dist-info", "METADATA")), true);
		r.check("*.data/purelib and platlib merged at the root (platlib/pandas into pandas/), scripts/headers/data dropped",
			snapshot(join(racineA, "libs", "pandas-3.0.6")).map((l) => l.split(" ")[0]).sort(),
			["pandas-3.0.6.dist-info/", "pandas-3.0.6.dist-info/METADATA", "pandas/", "pandas/__init__.py", "pandas/_lib.pyd", "pandas_extra.py"].sort());
		r.check("_pth: python312.zip, '.', then exactly the installed folders, no 'import site'", lirePth(racineA), [
			"python312.zip", ".", lib(racineA, "numpy-2.5.4"), lib(racineA, "pandas-3.0.6"), lib(racineA, "tzdata-2026.1"),
		]);
		r.check("no .part left anywhere", snapshot(racineA).filter((l) => l.includes(".part")), []);

		/* ── 2. State ── */
		const etatA = await instA.etat();
		r.check("etat: interpreter and version", [etatA.interprete, etatA.version], [true, "3.12.10"]);
		r.check("etat: packages, versions and who needs them", etatA.paquets.map((p) => [p.nom, p.version, p.requisPar]), [
			["numpy", "2.5.4", ["pandas"]], ["pandas", "3.0.6", []], ["tzdata", "2026.1", ["pandas"]],
		]);
		r.check("etat: each package's size is its folder's size on disk", etatA.paquets.map((p) => p.octets), ["numpy-2.5.4", "pandas-3.0.6", "tzdata-2026.1"].map((d) => taille(join(racineA, "libs", d))));
		r.check("etat: octetsTotal is the sum of the interpreter folder and the library folders",
			etatA.octetsTotal, taille(join(racineA, "interpreteur")) + ["numpy-2.5.4", "pandas-3.0.6", "tzdata-2026.1"].reduce((s, d) => s + taille(join(racineA, "libs", d)), 0));

		tA.appels.length = 0;
		await instA.installer(["pandas"], () => {});
		r.check("what is installed is never downloaded again", tA.appels, []);

		/* ── 3. Two installs at once: one download per file ── */
		const racineB = join(tmp, "b", "python");
		const tB = transportFaux();
		const instB = creerInstallationPython(racineB, tB, CATALOGUE);
		const progresB2 = [];
		const [p1, p2, p3] = await Promise.allSettled([instB.installer(["pandas"], () => {}), instB.installer(["pandas"], (a, t) => progresB2.push([a, t])), instB.installer(["numpy"], () => {})]);
		const bornesFichiers = [0, interpreteZip.length, interpreteZip.length + numpyZip.length, interpreteZip.length + numpyZip.length + tzdataZip.length, totalAttendu];
		r.check("the second caller follows the shared download's progress, not only file boundaries", progresB2.some(([a]) => !bornesFichiers.includes(a)), true);
		r.check("...and ends at its total", progresB2.at(-1), [totalAttendu, totalAttendu]);
		r.check("three parallel installs all succeed", [p1.status, p2.status, p3.status], ["fulfilled", "fulfilled", "fulfilled"]);
		const parUrl = {};
		for (const u of tB.appels) parUrl[u] = (parUrl[u] ?? 0) + 1;
		r.check("one transport call per file for parallel installs", Object.values(parUrl), [1, 1, 1, 1]);
		r.check("parallel installs leave the same layout", readdirSync(join(racineB, "libs")).sort(), ["numpy-2.5.4", "pandas-3.0.6", "tzdata-2026.1"]);

		/* ── 4. [] = the interpreter only ── */
		const racineC = join(tmp, "c", "python");
		const tC = transportFaux();
		const instC = creerInstallationPython(racineC, tC, CATALOGUE);
		await instC.installer([], () => {});
		r.check("installer([]) installs the interpreter only", [tC.appels, existsSync(join(racineC, "interpreteur", "python.exe"))], [[CATALOGUE.interprete.url], true]);
		r.check("_pth with no library: python312.zip and '.'", lirePth(racineC), ["python312.zip", "."]);

		/* ── 5. Pinned hash: one byte off, one byte more ── */
		const avant = snapshot(tmp);
		const numpyFaux = Buffer.from(numpyZip); numpyFaux[numpyFaux.length >> 1] ^= 0x01;
		tC.remplacer(CATALOGUE.paquets.numpy.url, numpyFaux);
		r.check("a body one byte off its pin is refused: empreinte", await codeDe(instC.installer(["numpy"], () => {})), "empreinte");
		r.check("...and nothing is left but what was installed before", snapshot(tmp), avant);
		tC.remplacer(CATALOGUE.paquets.numpy.url, Buffer.concat([numpyZip, Buffer.from([0])]));
		r.check("a body one byte longer than its pin is refused: empreinte", await codeDe(instC.installer(["numpy"], () => {})), "empreinte");
		r.check("...and nothing is left", snapshot(tmp), avant);
		/* A VALID archive, smaller than the pin, that is not the pinned one:
		   the zip reader and the size cap both let it through, only the hash
		   stops it. */
		tC.remplacer(CATALOGUE.paquets.numpy.url, leafZip);
		r.check("a valid archive that is not the pinned one is refused: empreinte", await codeDe(instC.installer(["numpy"], () => {})), "empreinte");
		r.check("...and nothing is left", snapshot(tmp), avant);
		/* A body that never ends: the pin's size cuts it, the stream is not
		   read to its end before the hash refuses it. */
		let morceauxLus = 0;
		tC.remplacer(CATALOGUE.paquets.numpy.url, { flux: async function* () { for (let i = 0; i < 10_000; i++) { morceauxLus++; yield new Uint8Array(1024); } } });
		r.check("a body past its pinned size is refused: empreinte", await codeDe(instC.installer(["numpy"], () => {})), "empreinte");
		r.check("...and is cut at the pinned size, not read to its end", morceauxLus <= Math.ceil(numpyZip.length / 1024) + 1, true);
		r.check("...and nothing is left", snapshot(tmp), avant);
		tC.retablir();
		await instC.installer(["numpy"], () => {});
		r.check("after a refused download, the next call downloads again and installs", readdirSync(join(racineC, "libs")), ["numpy-2.5.4"]);

		/* ── 6. Network: http hop, host off the list, HTTP error ── */
		const racineD = join(tmp, "d", "python");
		const tD = transportFaux();
		const instD = creerInstallationPython(racineD, tD, CATALOGUE);
		const avantD = snapshot(tmp);
		tD.remplacer(CATALOGUE.interprete.url, { redirige: "http://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip" });
		r.check("a redirect to http: is refused: reseau", await codeDe(instD.installer([], () => {})), "reseau");
		r.check("...the http URL never reaches the transport", tD.appels.filter((u) => u.startsWith("http:")), []);
		tD.remplacer(CATALOGUE.interprete.url, { redirige: "https://evil.example/python.zip" });
		r.check("a redirect to a host off the list is refused: reseau", await codeDe(instD.installer([], () => {})), "reseau");
		r.check("...the foreign host never reaches the transport", tD.appels.filter((u) => u.includes("evil.example")), []);
		tD.remplacer(CATALOGUE.interprete.url, { status: 404 });
		r.check("an HTTP error is refused: reseau", await codeDe(instD.installer([], () => {})), "reseau");
		r.check("...and nothing is written", snapshot(tmp), avantD);
		tD.retablir();
		tD.remplacer(CATALOGUE.interprete.url, { redirige: PY + "mirror/python-3.12.10-embed-amd64.zip" });
		tD.remplacer(PY + "mirror/python-3.12.10-embed-amd64.zip", interpreteZip);
		r.check("a redirect to a listed https host is followed (www.python.org is on the list)", await codeDe(instD.installer([], () => {})), "no error");
		tD.retablir();
		const fauxHote = creerInstallationPython(join(tmp, "d2", "python"), transportFaux(), { ...CATALOGUE, interprete: { ...CATALOGUE.interprete, url: "https://python.example.org/x.zip" } });
		r.check("an interpreter URL off the list is refused: reseau", await codeDe(fauxHote.installer([], () => {})), "reseau");
		/* M1: each kind of file has ONE host. github.com and files.pythonhosted.org
		   are on the GLOBAL list, which used to be the only judge. */
		const tM = transportFaux();
		const interpreteAilleurs = creerInstallationPython(join(tmp, "d3", "python"), tM, { ...CATALOGUE, interprete: { ...CATALOGUE.interprete, url: PH + "python-3.12.10-embed-amd64.zip" } });
		r.check("M1: an interpreter pin on files.pythonhosted.org is refused: reseau", await codeDe(interpreteAilleurs.installer([], () => {})), "reseau");
		const roueAilleurs = creerInstallationPython(join(tmp, "d4", "python"), tM, { ...CATALOGUE, paquets: { ...CATALOGUE.paquets, leaf: { ...CATALOGUE.paquets.leaf, url: "https://github.com/x/leaf.whl" } } });
		await roueAilleurs.installer([], () => {});
		r.check("M1: a wheel pin on github.com (global list) is refused: reseau", await codeDe(roueAilleurs.installer(["leaf"], () => {})), "reseau");
		tM.remplacer(CATALOGUE.interprete.url, { redirige: PH + "python-3.12.10-embed-amd64.zip" });
		r.check("M1: an interpreter redirect to files.pythonhosted.org is refused: reseau", await codeDe(creerInstallationPython(join(tmp, "d5", "python"), tM, CATALOGUE).installer([], () => {})), "reseau");
		r.check("M1: ...and neither foreign URL reached the transport", tM.appels.filter((u) => u.includes("github.com") || u === PH + "python-3.12.10-embed-amd64.zip"), []);
		tM.retablir();
		r.check("M1: a port, credentials, http or a look-alike host are refused", [
			"https://www.python.org:8443/x.zip", "https://u:p@www.python.org/x.zip", "http://www.python.org/x.zip", "https://www.python.org.evil.example/x.zip",
		].map((u) => surHote("www.python.org")(u)), [false, false, false, false]);

		/* ── 7. Archives refused after their hash matched ── */
		const avantE = snapshot(tmp);
		r.check("a pinned wheel with a '../' name is refused: empreinte", await codeDe(instD.installer(["evasion"], () => {})), "empreinte");
		r.check("...nothing written, inside or outside the root", snapshot(tmp), avantE);
		r.check("a pinned wheel whose CRC fails mid-unpack is refused: empreinte", await codeDe(instD.installer(["crc"], () => {})), "empreinte");
		r.check("...and its .part folder is removed", snapshot(tmp), avantE);
		r.check("a wheel whose .data/purelib collides with a root file is refused: empreinte", await codeDe(instD.installer(["coll"], () => {})), "empreinte");
		r.check("...and its .part folder is removed", snapshot(tmp), avantE);

		/* ── 8. Unknown packages ── */
		tD.appels.length = 0;
		r.check("an unknown package is refused before any download", [await codeDe(instD.installer(["numpyy"], () => {})), tD.appels], ["not an install error: Unknown package: numpyy", []]);
		r.check("a prototype key is not a package", await codeDe(instD.installer(["constructor"], () => {})), "not an install error: Unknown package: constructor");
		r.check("uninstalling an unknown package throws", await codeDe(instD.desinstaller("__proto__")), "not an install error: Unknown package: __proto__");

		/* ── 9. Leftovers and stale versions are cleaned, never listed ── */
		mkdirSync(join(racineD, "libs", "numpy-1.0.0", "numpy"), { recursive: true });
		writeFileSync(join(racineD, "libs", "numpy-1.0.0", "numpy", "__init__.py"), "old");
		mkdirSync(join(racineD, "libs", "leaf-1.0.part"), { recursive: true });
		writeFileSync(join(racineD, "libs", "leaf-1.0.part", "half.py"), "half");
		r.check("a stale version is not listed by etat", (await instD.etat()).paquets.map((p) => p.nom), []);
		await instD.installer(["leaf"], () => {});
		r.check("after an install, stale versions and leftover .part folders are gone", readdirSync(join(racineD, "libs")).sort(), ["leaf-1.0"]);
		r.check("...and the _pth names only the current one", lirePth(racineD), ["python312.zip", ".", lib(racineD, "leaf-1.0")]);

		/* ── 10. A new interpreter pin replaces the old one, libraries kept ── */
		const interprete2 = forgeZip([{ name: "python.exe", bytes: "MZ newer python" }, { name: "python312.zip", bytes: "newer stdlib", method: 0 }]);
		const url2 = PY + "python-3.12.11-embed-amd64.zip";
		const tD2 = transportFaux();
		tD2.remplacer(url2, interprete2);
		const instD2 = creerInstallationPython(racineD, tD2, { ...CATALOGUE, interprete: pin(url2, interprete2, "3.12.10") });
		r.check("an interpreter installed from another pin reads as not installed", (await instD2.etat()).interprete, false);
		await instD2.installer([], () => {});
		r.check("the new pin replaces it", readFileSync(join(racineD, "interpreteur", "python.exe"), "utf8"), "MZ newer python");
		r.check("...the libraries stay and the new _pth names them", [readdirSync(join(racineD, "libs")), lirePth(racineD)], [["leaf-1.0"], ["python312.zip", ".", lib(racineD, "leaf-1.0")]]);
		r.check("...no .old or .part left", readdirSync(racineD).sort(), ["interpreteur", "libs"]);

		/* ── 11. Uninstall: dependents first ── */
		r.check("uninstalling numpy while pandas is installed is refused, naming pandas", await instA.desinstaller("numpy"), { ok: false, requisPar: ["pandas"] });
		r.check("...and numpy stays", existsSync(join(racineA, "libs", "numpy-2.5.4", "numpy", "__init__.py")), true);
		r.check("uninstalling pandas works", await instA.desinstaller("pandas"), { ok: true });
		r.check("...its folder is gone and the _pth no longer names it", [existsSync(join(racineA, "libs", "pandas-3.0.6")), lirePth(racineA)], [false, ["python312.zip", ".", lib(racineA, "numpy-2.5.4"), lib(racineA, "tzdata-2026.1")]]);
		r.check("then uninstalling numpy works", await instA.desinstaller("numpy"), { ok: true });
		r.check("...both folders gone, the _pth updated", [readdirSync(join(racineA, "libs")), lirePth(racineA)], [["tzdata-2026.1"], ["python312.zip", ".", lib(racineA, "tzdata-2026.1")]]);
		r.check("uninstalling what is not installed is a no-op", await instA.desinstaller("pandas"), { ok: true });
		const etatFin = await instA.etat();
		r.check("etat after uninstalls: octetsTotal still the sum of the folders", etatFin.octetsTotal, taille(join(racineA, "interpreteur")) + taille(join(racineA, "libs", "tzdata-2026.1")));

		/* ── 12. A dependency that fails: its dependent is never installed ── */
		const racineG = join(tmp, "g", "python");
		const tG = transportFaux();
		const instG = creerInstallationPython(racineG, tG, CATALOGUE);
		tG.remplacer(CATALOGUE.paquets.numpy.url, leafZip);
		r.check("a dependency refused fails the install with its own code", await codeDe(instG.installer(["pandas"], () => {})), "empreinte");
		await instG.installer([], () => {});
		r.check("...the dependent is never downloaded nor installed", [tG.appels.includes(CATALOGUE.paquets.pandas.url), existsSync(join(racineG, "libs", "pandas-3.0.6"))], [false, false]);
		r.check("...and the _pth does not name it", lirePth(racineG).some((l) => l.includes("pandas")), false);

		/* ── 13. Uninstall queued behind an install of a dependent ── */
		const racineF = join(tmp, "f", "python");
		const instF = creerInstallationPython(racineF, transportFaux(), CATALOGUE);
		await instF.installer(["numpy"], () => {});
		const installation = instF.installer(["pandas"], () => {});
		const retrait = instF.desinstaller("numpy");
		await installation;
		r.check("an uninstall asked during an install of a dependent waits, then is refused", await retrait, { ok: false, requisPar: ["pandas"] });

		/* ── 14. A response with no body stream is refused, never read whole ── */
		const racineH = join(tmp, "h", "python");
		const tH = transportFaux();
		const instH = creerInstallationPython(racineH, tH, CATALOGUE, DISQUE_FAUX);
		const avantH = snapshot(tmp);
		tH.remplacer(CATALOGUE.interprete.url, { sansFlux: true });
		r.check("a response without a body stream is refused: reseau", await codeDe(instH.installer([], () => {})), "reseau");
		r.check("...and nothing is written", snapshot(tmp), avantH);
		tH.retablir();
		await instH.installer(["pandas"], () => {});

		/* ── 15. A task that finds its work done rewrites the _pth ── */
		const pthComplet = lirePth(racineH);
		writeFileSync(join(racineH, "interpreteur", "python312._pth"), "python312.zip\n.\n");
		tH.appels.length = 0;
		await instH.installer(["numpy"], () => {});
		r.check("an install with nothing to download heals a _pth that missed a folder", [tH.appels, lirePth(racineH)], [[], pthComplet]);

		/* ── 16. Uninstall: a _pth that cannot be written, a folder in use ── */
		const avantU = snapshot(tmp);
		pannes.push({ op: "ecrire", quand: (c) => c.endsWith("._pth.tmp"), code: "ENOSPC" });
		r.check("an uninstall whose _pth write fails is refused: io", await codeDe(instH.desinstaller("pandas")), "io");
		r.check("...the folder is put back and the _pth unchanged", snapshot(tmp), avantU);
		pannes.length = 0;
		for (const code of ["EBUSY", "EPERM"]) {
			pannes.push({ op: "renommer", quand: (de) => de.endsWith("pandas-3.0.6"), code });
			r.check("an uninstall of a folder in use (" + code + ") is refused: occupe", await codeDe(instH.desinstaller("pandas")), "occupe");
			r.check("...and nothing changes (" + code + ")", snapshot(tmp), avantU);
			pannes.length = 0;
		}

		/* ── 16b. B2: Settings lists ROOTS; uninstalling a root takes its own dependencies ── */
		{
			/* `alt` shares tzdata with pandas (the leaf wheel's bytes under another name). */
			const CAT_R = { ...CATALOGUE, paquets: { ...CATALOGUE.paquets, alt: pin(urlDe("leaf-"), leafZip, "1.0", ["tzdata"]) }, racines: ["alt", "numpy", "pandas"] };
			const racineR = join(tmpR, "r", "python");
			const instR = creerInstallationPython(racineR, transportFaux(), CAT_R, DISQUE_FAUX);
			await instR.installer(["pandas"], () => {});
			const eR = await instR.etat();
			const tailleDe = (nom, version) => taille(join(racineR, "libs", nom + "-" + version));
			r.check("B2: etat.racines lists the roots only (tzdata is a dependency)", eR.racines.map((x) => x.nom), ["numpy", "pandas"]);
			r.check("B2: a root's size counts the dependencies no other root needs (pandas + tzdata, not numpy)",
				eR.racines.find((x) => x.nom === "pandas").octets, tailleDe("pandas", "3.0.6") + tailleDe("tzdata", "2026.1"));
			r.check("B2: a root another root needs says so (numpy needed by pandas)", eR.racines.find((x) => x.nom === "numpy").requisPar, ["pandas"]);
			r.check("B2: uninstalling a root another root needs is refused", await instR.desinstallerRacine("numpy"), { ok: false, requisPar: ["pandas"] });
			r.check("B2: a dependency is not a root: refused before anything moves", await codeDe(instR.desinstallerRacine("tzdata")), "not an install error: Not a root library: tzdata");
			const avantR = snapshot(tmpR);
			pannes.push({ op: "renommer", quand: (de) => de.endsWith("tzdata-2026.1"), code: "EBUSY" });
			r.check("B2: a dependency in use: occupe", await codeDe(instR.desinstallerRacine("pandas")), "occupe");
			r.check("B2: ...and the root moved aside first is put back: nothing changed", snapshot(tmpR), avantR);
			pannes.length = 0;
			pannes.push({ op: "ecrire", quand: (c) => c.endsWith("._pth.tmp"), code: "ENOSPC" });
			r.check("B2: a _pth that cannot be written: io, everything put back", [await codeDe(instR.desinstallerRacine("pandas")), JSON.stringify(snapshot(tmpR)) === JSON.stringify(avantR)], ["io", true]);
			pannes.length = 0;
			await instR.installer(["alt"], () => {});
			const eR2 = await instR.etat();
			r.check("B2: with alt installed, pandas' size no longer counts the shared tzdata", eR2.racines.find((x) => x.nom === "pandas").octets, tailleDe("pandas", "3.0.6"));
			r.check("B2: uninstalling pandas keeps tzdata (alt needs it) and numpy (a root)", [await instR.desinstallerRacine("pandas"), readdirSync(join(racineR, "libs")).sort()], [{ ok: true }, ["alt-1.0", "numpy-2.5.4", "tzdata-2026.1"]]);
			r.check("B2: uninstalling alt then takes tzdata with it", [await instR.desinstallerRacine("alt"), readdirSync(join(racineR, "libs")).sort(), lirePth(racineR)], [{ ok: true }, ["numpy-2.5.4"], ["python312.zip", ".", lib(racineR, "numpy-2.5.4")]]);
			r.check("B2: no .suppr left behind", readdirSync(join(racineR, "libs")).some((n) => n.endsWith(".suppr")), false);
		}

		/* ── 17. A disk error during an install is io, not reseau ── */
		pannes.push({ op: "renommer", quand: (de) => de.endsWith("leaf-1.0.part"), code: "ENOSPC" });
		r.check("a rename refused by the disk during an install: io", await codeDe(instH.installer(["leaf"], () => {})), "io");
		r.check("...and its .part is removed", snapshot(tmp), avantU);
		pannes.length = 0;

		/* ── 18. A dependency gone when its dependent's turn comes: absent ── */
		const racineI = join(tmp, "i", "python");
		const tI = transportFaux();
		const instI = creerInstallationPython(racineI, tI, CATALOGUE);
		tI.surAppel = (url) => { if (url === CATALOGUE.paquets.tzdata.url) rmSync(join(racineI, "libs", "numpy-2.5.4"), { recursive: true, force: true }); };
		r.check("a dependency removed before its dependent's turn: absent", await codeDe(instI.installer(["pandas"], () => {})), "absent");
		r.check("...the dependent is never downloaded", tI.appels.includes(CATALOGUE.paquets.pandas.url), false);

		/* ── 19. A new interpreter that cannot take its place: .old is kept ── */
		const racineJ = join(tmp, "j", "python");
		await creerInstallationPython(racineJ, transportFaux(), CATALOGUE).installer([], () => {});
		const urlJ = PY + "python-3.12.12-embed-amd64.zip";
		const zipJ = forgeZip([{ name: "python.exe", bytes: "MZ next python" }]);
		const tJ = transportFaux();
		tJ.remplacer(urlJ, zipJ);
		const dossierJ = resolve(racineJ, "interpreteur");
		pannes.push({ op: "renommer", quand: (de, vers) => vers === dossierJ, code: "EPERM" });
		r.check("a new interpreter that cannot be renamed into place, nor the old one back: io",
			await codeDe(creerInstallationPython(racineJ, tJ, { ...CATALOGUE, interprete: pin(urlJ, zipJ, "3.12.10") }, DISQUE_FAUX).installer([], () => {})), "io");
		pannes.length = 0;
		r.check("...the old interpreter is kept at .old, never deleted", [existsSync(dossierJ), existsSync(join(racineJ, "interpreteur.old", "python.exe")) ? readFileSync(join(racineJ, "interpreteur.old", "python.exe"), "utf8") : "no .old"], [false, "MZ fake python"]);
		const tJ2 = transportFaux();
		await creerInstallationPython(racineJ, tJ2, CATALOGUE).installer([], () => {});
		r.check("...and the next install puts it back without a download", [tJ2.appels, readFileSync(join(dossierJ, "python.exe"), "utf8"), existsSync(join(racineJ, "interpreteur.old"))], [[], "MZ fake python", false]);

		/* ── 20. supprimerTout: dependents first, stops at a folder in use ── */
		pannes.push({ op: "renommer", quand: (de) => de.endsWith("numpy-2.5.4"), code: "EBUSY" });
		r.check("remove everything with numpy in use: occupe", await instH.supprimerTout(), { ok: false, code: "occupe" });
		r.check("...its dependents went first, numpy and the interpreter stay, the _pth names numpy",
			[readdirSync(join(racineH, "libs")), existsSync(join(racineH, "interpreteur", "python.exe")), lirePth(racineH)],
			[["numpy-2.5.4"], true, ["python312.zip", ".", lib(racineH, "numpy-2.5.4")]]);
		pannes.length = 0;
		pannes.push({ op: "renommer", quand: (de) => de === resolve(racineH, "interpreteur"), code: "EBUSY" });
		r.check("remove everything with the interpreter in use: occupe", await instH.supprimerTout(), { ok: false, code: "occupe" });
		r.check("...the libraries are gone, the interpreter stays", [readdirSync(join(racineH, "libs")), existsSync(join(racineH, "interpreteur", "python.exe"))], [[], true]);
		pannes.length = 0;
		await instH.installer(["numpy"], () => {});
		pannes.push({ op: "ecrire", quand: (c) => c.endsWith("._pth.tmp"), code: "ENOSPC" });
		r.check("remove everything with a _pth that cannot be written: io", await instH.supprimerTout(), { ok: false, code: "io" });
		r.check("...numpy is put back", existsSync(join(racineH, "libs", "numpy-2.5.4", "numpy", "__init__.py")), true);
		pannes.length = 0;
		r.check("remove everything: ok", await instH.supprimerTout(), { ok: true });
		r.check("...nothing is left under the root", readdirSync(racineH), []);
		r.check("...etat reads nothing installed", await instH.etat(), { interprete: false, version: null, paquets: [], octetsTotal: 0, racines: [] });
		await instH.installer(["leaf"], () => {});
		r.check("...and a new install after it works", readdirSync(join(racineH, "libs")), ["leaf-1.0"]);
	});
} finally {
	rmSync(tmp, { recursive: true, force: true });
	rmSync(tmpR, { recursive: true, force: true });
}
r.done();
